'use strict';

/**
 * Intégration GitHub via le CLI `gh` (déjà présent sur Omarchy) et `git`.
 *
 * Tout passe par des commandes non interactives :
 *  - authentification par jeton (`gh auth login --with-token`)
 *  - lecture des dépôts, branches, PR, issues (sortie JSON)
 *  - clone, commit, push via git
 *
 * Aucun secret n'est écrit dans la configuration de Cerveau : `gh` gère
 * lui-même le stockage sécurisé (keyring ou ~/.config/gh/hosts.yml).
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

/* ------------------------------ exécution ------------------------------- */

function executer(binaire, args, opts = {}) {
  return new Promise((resolve) => {
    const { cwd, stdin, timeout = 90000, env = {} } = opts;
    let stdout = '';
    let stderr = '';
    let termine = false;

    let enfant;
    try {
      enfant = spawn(binaire, args, {
        cwd,
        env: { ...process.env, ...env, GH_PAGER: 'cat', GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (err) {
      return resolve({ code: -1, stdout: '', stderr: String(err.message) });
    }

    const minuteur = setTimeout(() => {
      if (!termine) {
        try { enfant.kill('SIGKILL'); } catch { /* ignore */ }
        stderr += `\n[délai de ${Math.round(timeout / 1000)} s dépassé]`;
      }
    }, timeout);

    enfant.stdout.on('data', (d) => { stdout += d.toString(); });
    enfant.stderr.on('data', (d) => { stderr += d.toString(); });

    enfant.on('error', (err) => {
      clearTimeout(minuteur);
      termine = true;
      resolve({ code: -1, stdout, stderr: `${stderr}${err.message}` });
    });

    enfant.on('close', (code) => {
      clearTimeout(minuteur);
      termine = true;
      resolve({ code: code ?? -1, stdout, stderr });
    });

    if (stdin !== undefined && stdin !== null) {
      enfant.stdin.write(stdin);
    }
    try { enfant.stdin.end(); } catch { /* ignore */ }
  });
}

async function gh(args, opts = {}) {
  const r = await executer('gh', args, opts);
  if (r.code !== 0) {
    const msg = (r.stderr || r.stdout || '').trim() || `gh ${args[0]} a échoué (code ${r.code})`;
    throw new Error(nettoyerErreur(msg));
  }
  return r.stdout;
}

async function ghJson(args, opts = {}) {
  const sortie = await gh(args, opts);
  try {
    return JSON.parse(sortie);
  } catch {
    throw new Error(`Réponse GitHub illisible : ${sortie.slice(0, 200)}`);
  }
}

function nettoyerErreur(msg) {
  return String(msg)
    .replace(/To get started with GitHub CLI[\s\S]*$/i, 'Non authentifié. Connecte-toi à GitHub dans les réglages.')
    .replace(/gh auth login[\s\S]*$/i, 'Connecte-toi à GitHub dans les réglages.')
    .trim()
    .slice(0, 800);
}

async function git(args, cwd, opts = {}) {
  const r = await executer('git', args, { cwd, ...opts });
  return { code: r.code, stdout: r.stdout.trim(), stderr: r.stderr.trim(), ok: r.code === 0 };
}

/* ---------------------------- disponibilité ----------------------------- */

let cacheGh = null;

async function verifierGh() {
  if (cacheGh) return cacheGh;
  const r = await executer('gh', ['--version'], { timeout: 8000 });
  cacheGh = {
    present: r.code === 0,
    version: r.code === 0 ? (r.stdout.split('\n')[0] || '').trim() : null
  };
  return cacheGh;
}

/* --------------------------- authentification --------------------------- */

async function etatAuth({ forcer = false } = {}) {
  const dispo = await verifierGh();
  if (!dispo.present) {
    return { ghPresent: false, connecte: false, utilisateur: null, message: "Le CLI GitHub (gh) n'est pas installé." };
  }

  const r = await executer('gh', ['auth', 'status', '--json', 'hosts'], { timeout: 20000 });
  const sortie = `${r.stdout}${r.stderr}`;

  // 1) cas nominal : sortie JSON exploitable (code 0 ou non)
  if (r.stdout.trim()) {
    try {
      const resume = resumerAuth(JSON.parse(r.stdout), dispo.version);
      if (resume.connecte || resume.message) return resume;
    } catch { /* pas du JSON : on tente le repli texte */ }
  }

  if (r.code === 0) {
    return { ghPresent: true, version: dispo.version, connecte: false, utilisateur: null };
  }

  if (/not logged into any/i.test(sortie)) {
    return { ghPresent: true, version: dispo.version, connecte: false, utilisateur: null };
  }

  // 2) repli : analyse de la sortie texte de `gh auth status`
  const texte = await lireStatutTexte();
  if (texte) return texte;

  return {
    ghPresent: true,
    version: dispo.version,
    connecte: false,
    utilisateur: null,
    message: nettoyerErreur(sortie) || 'État GitHub indisponible.'
  };
}

/**
 * Repli quand --json n'est pas disponible : lit `gh auth status` en texte.
 * Format typique :
 *   github.com
 *     ✓ Logged in to github.com account chimprookie-group (keyring)
 *     - Active account: true
 *     - Git operations protocol: https
 *     - Token scopes: 'read:org', 'repo'
 */
async function lireStatutTexte() {
  const r = await executer('gh', ['auth', 'status'], { timeout: 20000 });
  const sortie = `${r.stdout}${r.stderr}`;
  if (/not logged into any/i.test(sortie)) return null;

  const mCompte = sortie.match(/Logged in to \S+ account (\S+)/i);
  if (!mCompte) return null;

  const mProto = sortie.match(/Git operations protocol:\s*(\w+)/i);
  const mScopes = sortie.match(/Token scopes:\s*(.+)/i);
  const scopes = mScopes
    ? mScopes[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    : [];

  return {
    ghPresent: true,
    version: null,
    connecte: true,
    utilisateur: mCompte[1],
    protocole: mProto ? mProto[1] : null,
    scopes,
    compteActif: true,
    source: 'texte'
  };
}

function resumerAuth(json, version) {
  const hosts = json?.hosts || {};
  const brut = hosts['github.com'] ?? Object.values(hosts)[0];
  if (!brut) {
    return { ghPresent: true, version, connecte: false, utilisateur: null };
  }

  // Deux formats coexistent selon la version de gh :
  //  - ancien : { users: [{ login, active, scopes: [] }], git_protocol }
  //  - récent : [ { login, active, scopes: "read:org, repo", gitProtocol, state, tokenSource } ]
  let comptes;
  if (Array.isArray(brut)) {
    comptes = brut;
  } else if (Array.isArray(brut.users)) {
    comptes = brut.users;
  } else {
    comptes = [];
  }

  const compte = comptes.find((u) => u && u.active) || comptes[0] || null;

  if (!compte) {
    return { ghPresent: true, version, connecte: false, utilisateur: null };
  }

  // les scopes sont tantôt une chaîne "a, b", tantôt un tableau
  const scopes = Array.isArray(compte.scopes)
    ? compte.scopes
    : String(compte.scopes || '').split(',').map((s) => s.trim()).filter(Boolean);

  const protocole = compte.gitProtocol || compte.git_protocol
    || (Array.isArray(brut) ? null : brut.git_protocol) || null;

  // un compte peut être listé mais invalide (jeton expiré, état "error")
  const etat = String(compte.state || '').toLowerCase();
  const valide = !etat || etat === 'success';

  if (!valide) {
    return {
      ghPresent: true,
      version,
      connecte: false,
      utilisateur: compte.login || null,
      message: `Le compte « ${compte.login || 'inconnu'} » est enregistré mais son jeton est invalide (${etat}). Reconnecte-toi.`
    };
  }

  return {
    ghPresent: true,
    version,
    connecte: Boolean(compte.login),
    utilisateur: compte.login || null,
    protocole,
    scopes,
    compteActif: compte.active !== false,
    source: compte.tokenSource || compte.state || null
  };
}

/**
 * Connexion par jeton personnel (PAT).
 * Le jeton est transmis sur stdin, jamais écrit dans notre configuration.
 */
async function connecter({ token, protocole = 'https' }) {
  if (!token || !String(token).trim()) {
    throw new Error('Jeton vide.');
  }
  const propre = String(token).trim();

  const r = await executer('gh', ['auth', 'login', '--with-token'], { stdin: propre, timeout: 45000 });
  if (r.code !== 0) {
    const msg = `${r.stderr}${r.stdout}`;
    if (/invalid|bad credentials|401/i.test(msg)) {
      throw new Error('Jeton refusé par GitHub. Vérifie qu\'il est valide et non expiré.');
    }
    throw new Error(nettoyerErreur(msg));
  }

  // configure git pour utiliser gh comme helper d'identifiants
  await executer('gh', ['auth', 'setup-git'], { timeout: 30000 });

  // définit le protocole git si demandé
  if (protocole && ['https', 'ssh'].includes(protocole)) {
    await executer('gh', ['config', 'set', 'git_protocol', protocole], { timeout: 15000 });
  }

  const etat = await etatAuth();
  if (!etat.connecte) {
    throw new Error("Connexion enregistrée mais l'état reste inconnu. Réessaie ou vérifie avec « gh auth status ».");
  }
  return etat;
}

async function deconnecter() {
  await executer('gh', ['auth', 'logout', '--hostname', 'github.com'], { timeout: 20000 });
  return { connecte: false };
}

/* ------------------------------- dépôts --------------------------------- */

async function listerDepots({ limite = 60 } = {}) {
  const champs = 'nameWithOwner,description,isPrivate,isFork,updatedAt,primaryLanguage,stargazerCount,viewerPermission,url';
  const liste = await ghJson([
    'repo', 'list',
    '--limit', String(limite),
    '--json', champs
  ], { timeout: 45000 });

  return liste.map((r) => ({
    nomComplet: r.nameWithOwner,
    nom: r.nameWithOwner.split('/')[1],
    proprietaire: r.nameWithOwner.split('/')[0],
    description: r.description || '',
    prive: Boolean(r.isPrivate),
    fork: Boolean(r.isFork),
    maj: r.updatedAt,
    langage: r.primaryLanguage?.name || null,
    etoiles: r.stargazerCount || 0,
    droits: r.viewerPermission || null,
    url: r.url
  }));
}

async function infosDepot(nomComplet) {
  const champs = 'nameWithOwner,description,defaultBranchRef,isPrivate,url,primaryLanguage,stargazerCount,pushedAt';
  const r = await ghJson(['repo', 'view', nomComplet, '--json', champs], { timeout: 30000 });
  return {
    nomComplet: r.nameWithOwner,
    description: r.description || '',
    brancheParDefaut: r.defaultBranchRef?.name || 'main',
    prive: Boolean(r.isPrivate),
    url: r.url,
    langage: r.primaryLanguage?.name || null,
    etoiles: r.stargazerCount || 0,
    dernierPush: r.pushedAt || null
  };
}

/**
 * Clone un dépôt dans un dossier cible et renvoie le chemin local.
 */
async function cloner({ nomComplet, dossierParent, nomLocal = null }) {
  if (!nomComplet || !nomComplet.includes('/')) {
    throw new Error('Nom de dépôt invalide (attendu : proprietaire/depot).');
  }
  const parent = path.resolve(dossierParent);
  await fsp.mkdir(parent, { recursive: true });

  const cible = path.join(parent, nomLocal || nomComplet.split('/')[1]);
  if (fs.existsSync(cible) && (await fsp.readdir(cible)).length > 0) {
    throw new Error(`Le dossier existe déjà et n'est pas vide : ${cible}`);
  }

  const r = await executer('gh', ['repo', 'clone', nomComplet, cible], { timeout: 600000 });
  if (r.code !== 0) {
    throw new Error(nettoyerErreur(`${r.stderr}${r.stdout}`));
  }
  return { chemin: cible, nomComplet };
}

/* -------------------------- état d'un dépôt local ----------------------- */

async function etatLocal(chemin) {
  if (!chemin || !fs.existsSync(chemin)) {
    return { depot: false };
  }

  const racine = await git(['rev-parse', '--show-toplevel'], chemin);
  if (!racine.ok) return { depot: false, chemin };

  const root = racine.stdout;

  const [branche, statut, distant, dernier, amont] = await Promise.all([
    git(['rev-parse', '--abbrev-ref', 'HEAD'], root),
    git(['status', '--porcelain'], root),
    git(['remote', '-v'], root),
    git(['log', '-1', '--pretty=%H%x09%an%x09%ar%x09%s'], root),
    git(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], root)
  ]);

  const fichiers = statut.stdout ? statut.stdout.split('\n').filter(Boolean) : [];
  const parType = { modifies: 0, ajoutes: 0, supprimes: 0, nonSuivis: 0 };

  for (const ligne of fichiers) {
    const code = ligne.slice(0, 2);
    if (code.includes('?')) parType.nonSuivis++;
    else if (code.includes('D')) parType.supprimes++;
    else if (code.includes('A')) parType.ajoutes++;
    else parType.modifies++;
  }

  let avance = 0;
  let retard = 0;
  if (amont.ok && amont.stdout) {
    const [a, r] = amont.stdout.split(/\s+/).map(Number);
    retard = a || 0;
    avance = r || 0;
  }

  const urlDistant = (distant.stdout.split('\n')[0] || '').split(/\s+/)[1] || null;
  const nomComplet = extraireNomComplet(urlDistant);

  let commit = null;
  if (dernier.ok && dernier.stdout) {
    const [hash, auteur, quand, sujet] = dernier.stdout.split('\t');
    commit = { hash: hash.slice(0, 8), auteur, quand, sujet };
  }

  const branches = (await git(['branch', '--format=%(refname:short)'], root)).stdout
    .split('\n').filter(Boolean);

  return {
    depot: true,
    chemin: root,
    branche: branche.stdout || 'HEAD',
    nomComplet,
    distant: urlDistant,
    modifie: fichiers.length > 0,
    fichiers: fichiers.slice(0, 60),
    compte: parType,
    avance,
    retard,
    commit,
    branches: branches.slice(0, 40),
    propage: avance === 0 && retard === 0
  };
}

function extraireNomComplet(url) {
  if (!url) return null;
  const m = String(url).match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/* ------------------------------ opérations ------------------------------ */

async function tirer(chemin) {
  const r = await git(['pull', '--ff-only'], chemin, { timeout: 180000 });
  if (!r.ok) {
    return { ok: false, message: r.stderr || r.stdout || 'Échec du tirage (conflit possible).', detail: r.stderr };
  }
  return { ok: true, message: r.stdout || 'Déjà à jour.' };
}

async function envoyer(chemin, { message, tous = true, branche = null } = {}) {
  if (!message || !String(message).trim()) {
    throw new Error('Message de commit vide.');
  }

  // ajout
  const ajout = tous
    ? await git(['add', '-A'], chemin)
    : await git(['add', '-u'], chemin);
  if (!ajout.ok) throw new Error(ajout.stderr || "Échec de l'ajout des fichiers.");

  // commit
  const commit = await git(['commit', '-m', String(message).trim()], chemin, { timeout: 60000 });
  if (!commit.ok) {
    if (/nothing to commit|rien à valider|no changes added/i.test(commit.stdout + commit.stderr)) {
      return { ok: false, message: 'Aucune modification à valider.' };
    }
    throw new Error(commit.stderr || commit.stdout || 'Échec du commit.');
  }

  // push
  const args = ['push'];
  if (branche) args.push('-u', 'origin', branche);
  const push = await git(args, chemin, { timeout: 180000 });
  if (!push.ok) {
    return { ok: false, message: `Commit créé mais l'envoi a échoué : ${push.stderr || push.stdout}` };
  }

  return { ok: true, message: 'Commit créé et envoyé.', detail: commit.stdout };
}

async function changerBranche(chemin, nom, { creer = false } = {}) {
  const args = creer ? ['checkout', '-b', nom] : ['checkout', nom];
  const r = await git(args, chemin, { timeout: 60000 });
  if (!r.ok) throw new Error(r.stderr || `Impossible de basculer sur ${nom}.`);
  return { ok: true, branche: nom };
}

async function historique(chemin, { limite = 25 } = {}) {
  const r = await git(
    ['log', `-${Math.min(Number(limite) || 25, 100)}`, '--pretty=%H%x09%an%x09%ar%x09%s'],
    chemin
  );
  if (!r.ok) return [];
  return r.stdout.split('\n').filter(Boolean).map((l) => {
    const [hash, auteur, quand, sujet] = l.split('\t');
    return { hash: hash.slice(0, 8), auteur, quand, sujet };
  });
}

async function difference(chemin) {
  const r = await git(['diff', '--stat'], chemin);
  const s = await git(['diff'], chemin);
  return {
    resume: r.stdout || '(aucune différence)',
    diff: (s.stdout || '').slice(0, 40000)
  };
}

/* ------------------------------ création -------------------------------- */

/**
 * Crée un dépôt GitHub. Si un dossier local est fourni et déjà initialisé
 * en git, on y ajoute le remote et on pousse la branche courante.
 */
async function creerDepot({ nom, dossierLocal = null, prive = true, description = '', pousser = true }) {
  const nomPropre = String(nom || '').trim();
  if (!nomPropre) throw new Error('Nom de dépôt manquant.');
  if (!/^[A-Za-z0-9._-]+$/.test(nomPropre)) {
    throw new Error('Nom invalide : lettres, chiffres, tirets, points et soulignés uniquement.');
  }

  const args = ['repo', 'create', nomPropre, '--description', String(description || '')];
  args.push(prive ? '--private' : '--public');

  if (dossierLocal && fs.existsSync(dossierLocal)) {
    const estDepot = (await git(['rev-parse', '--git-dir'], dossierLocal)).ok;
    if (!estDepot) {
      throw new Error("Le dossier n'est pas un dépôt git. Lance « git init » d'abord.");
    }
    if (pousser) {
      args.push('--source', dossierLocal, '--push');
    } else {
      args.push('--source', dossierLocal);
    }
  }

  const r = await executer('gh', args, { timeout: 180000 });
  if (r.code !== 0) {
    const msg = `${r.stderr}${r.stdout}`;
    if (/already exists/i.test(msg)) throw new Error(`Un dépôt nommé « ${nomPropre} » existe déjà sur ton compte.`);
    throw new Error(nettoyerErreur(msg));
  }

  // gh mêle messages git et URL : on isole la première URL github.com
  const mUrl = `${r.stdout}\n${r.stderr}`.match(/https:\/\/github\.com\/[^\s]+/);
  const proprietaire = (await ghJson(['api', 'user', '--jq', '{login: .login}'], { timeout: 20000 })).login;
  const nomComplet = proprietaire ? `${proprietaire}/${nomPropre}` : nomPropre;
  const url = mUrl ? mUrl[0].replace(/[.,;]+$/, '') : `https://github.com/${nomComplet}`;

  return { ok: true, nomComplet, url, prive, pousse: Boolean(dossierLocal && pousser) };
}

/* ------------------------------ pull requests --------------------------- */

async function listerPR(nomComplet, { etat = 'open', limite = 30 } = {}) {
  const champs = 'number,title,state,isDraft,author,createdAt,updatedAt,headRefName,baseRefName,url,mergeable,reviewDecision';
  const liste = await ghJson([
    'pr', 'list',
    '--repo', nomComplet,
    '--state', etat,
    '--limit', String(limite),
    '--json', champs
  ], { timeout: 45000 });

  return liste.map((p) => ({
    numero: p.number,
    titre: p.title,
    etat: p.state,
    brouillon: Boolean(p.isDraft),
    auteur: p.author?.login || '',
    cree: p.createdAt,
    maj: p.updatedAt,
    source: p.headRefName,
    cible: p.baseRefName,
    url: p.url,
    fusionnable: p.mergeable || null,
    revue: p.reviewDecision || null
  }));
}

async function creerPR(nomComplet, { titre, corps = '', source, cible = null, brouillon = false }) {
  if (!titre) throw new Error('Titre de PR manquant.');
  if (!source) throw new Error('Branche source manquante.');

  const args = [
    'pr', 'create',
    '--repo', nomComplet,
    '--title', String(titre),
    '--body', String(corps || ''),
    '--head', String(source)
  ];
  if (cible) args.push('--base', String(cible));
  if (brouillon) args.push('--draft');

  const r = await executer('gh', args, { timeout: 90000 });
  if (r.code !== 0) {
    const msg = `${r.stderr}${r.stdout}`;
    if (/already exists/i.test(msg)) {
      throw new Error('Une pull request existe déjà pour cette branche.');
    }
    if (/No commits between/i.test(msg)) {
      throw new Error('Aucun commit de différence avec la branche cible.');
    }
    throw new Error(nettoyerErreur(msg));
  }
  return { ok: true, url: r.stdout.trim().split('\n').pop() };
}

async function infosPR(nomComplet, numero) {
  const champs = 'number,title,body,state,isDraft,author,headRefName,baseRefName,url,mergeable,reviewDecision,statusCheckRollup,additions,deletions,changedFiles,comments';
  const p = await ghJson(['pr', 'view', String(numero), '--repo', nomComplet, '--json', champs], { timeout: 45000 });

  const controles = (p.statusCheckRollup || []).map((c) => ({
    nom: c.name || c.context || 'contrôle',
    etat: c.conclusion || c.state || 'inconnu'
  }));

  return {
    numero: p.number,
    titre: p.title,
    corps: p.body || '',
    etat: p.state,
    brouillon: Boolean(p.isDraft),
    auteur: p.author?.login || '',
    source: p.headRefName,
    cible: p.baseRefName,
    url: p.url,
    fusionnable: p.mergeable,
    revue: p.reviewDecision,
    ajouts: p.additions || 0,
    suppressions: p.deletions || 0,
    fichiers: p.changedFiles || 0,
    controles,
    commentaires: (p.comments || []).map((c) => ({
      auteur: c.author?.login || '',
      corps: (c.body || '').slice(0, 1200)
    }))
  };
}

async function fusionnerPR(nomComplet, numero, { methode = 'squash' } = {}) {
  const args = ['pr', 'merge', String(numero), '--repo', nomComplet];
  if (methode === 'squash') args.push('--squash');
  else if (methode === 'rebase') args.push('--rebase');
  else args.push('--merge');

  const r = await executer('gh', args, { timeout: 120000 });
  if (r.code !== 0) throw new Error(nettoyerErreur(`${r.stderr}${r.stdout}`));
  return { ok: true, message: r.stdout.trim() || 'Pull request fusionnée.' };
}

/* -------------------------------- issues -------------------------------- */

async function listerIssues(nomComplet, { etat = 'open', limite = 30 } = {}) {
  const champs = 'number,title,state,author,labels,createdAt,updatedAt,url,comments';
  const liste = await ghJson([
    'issue', 'list',
    '--repo', nomComplet,
    '--state', etat,
    '--limit', String(limite),
    '--json', champs
  ], { timeout: 45000 });

  return liste.map((i) => ({
    numero: i.number,
    titre: i.title,
    etat: i.state,
    auteur: i.author?.login || '',
    etiquettes: (i.labels || []).map((l) => l.name),
    cree: i.createdAt,
    maj: i.updatedAt,
    url: i.url,
    commentaires: (i.comments || []).length
  }));
}

async function creerIssue(nomComplet, { titre, corps = '', etiquettes = [] }) {
  if (!titre) throw new Error("Titre de l'issue manquant.");
  const args = ['issue', 'create', '--repo', nomComplet, '--title', String(titre), '--body', String(corps || '')];
  for (const e of etiquettes) args.push('--label', String(e));

  const r = await executer('gh', args, { timeout: 60000 });
  if (r.code !== 0) throw new Error(nettoyerErreur(`${r.stderr}${r.stdout}`));
  return { ok: true, url: r.stdout.trim().split('\n').pop() };
}

/* ------------------------------- workflows ------------------------------ */

async function listerRuns(nomComplet, { limite = 10 } = {}) {
  const champs = 'databaseId,displayTitle,workflowName,status,conclusion,headBranch,createdAt,url';
  try {
    const liste = await ghJson([
      'run', 'list',
      '--repo', nomComplet,
      '--limit', String(limite),
      '--json', champs
    ], { timeout: 45000 });
    return liste.map((r) => ({
      id: r.databaseId,
      titre: r.displayTitle || '',
      workflow: r.workflowName || '',
      statut: r.status,
      conclusion: r.conclusion,
      branche: r.headBranch,
      cree: r.createdAt,
      url: r.url
    }));
  } catch {
    return [];
  }
}

module.exports = {
  verifierGh,
  etatAuth,
  connecter,
  deconnecter,
  listerDepots,
  infosDepot,
  cloner,
  creerDepot,
  etatLocal,
  tirer,
  envoyer,
  changerBranche,
  historique,
  difference,
  listerPR,
  creerPR,
  infosPR,
  fusionnerPR,
  listerIssues,
  creerIssue,
  listerRuns,
  extraireNomComplet,
  executer,
  git,
  __testResumerAuth: resumerAuth
};
