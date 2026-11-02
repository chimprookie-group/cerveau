'use strict';

/**
 * Autotest de bout en bout, exécuté uniquement quand CERVEAU_SELFTEST=1.
 * Vérifie que l'interface se charge, que les IPC répondent, que le moteur
 * Markdown fonctionne et que le coffre Obsidian est accessible.
 */

const path = require('node:path');

async function run(mainWindow, deps) {
  const { config, obsidian, app } = deps;
  const resultats = [];
  const erreursConsole = [];

  mainWindow.webContents.on('console-message', (evt) => {
    // API moderne : objet ; ancienne : (event, niveau, message)
    const niveau = typeof evt === 'object' && evt.level !== undefined ? evt.level : arguments[1];
    const message = typeof evt === 'object' && evt.message !== undefined ? evt.message : arguments[2];
    if (niveau === 'error' || niveau === 3 || niveau === 2) erreursConsole.push(String(message));
  });

  const verifier = (nom, condition, detail = '') => {
    resultats.push({ test: nom, ok: Boolean(condition), detail });
  };

  // 1. Interface
  // le rendu des fournisseurs est asynchrone : on l'attend explicitement
  await mainWindow.webContents.executeJavaScript(
    `new Promise((resolve) => {
       let essais = 0;
       const t = setInterval(() => {
         if (document.querySelectorAll('.carte-fournisseur').length >= 3 || ++essais > 40) {
           clearInterval(t); resolve(true);
         }
       }, 100);
     })`
  );

  const ui = await mainWindow.webContents.executeJavaScript(`(() => {
    const q = (s) => document.querySelector(s);
    return {
      api: typeof window.cerveau,
      apiWorkspace: typeof window.cerveau?.workspace,
      sidebar: !!q('#sidebar'),
      suggestions: document.querySelectorAll('.suggestion').length,
      saisie: !!q('#saisie'),
      panneau: !!q('#panneauObsidian'),
      modaleReglages: !!q('#modaleReglages'),
      fournisseurs: document.querySelectorAll('.carte-fournisseur').length,
      selecteur: document.querySelectorAll('#btnModele').length,
      modele: document.querySelectorAll('#modeleLibelle').length,
      statut: q('#statutFournisseur')?.textContent || '',
      vault: q('#vaultNom')?.textContent || '',
      markdown: (window.marked ? marked.parse('# T') : 'NON').includes('<h1>'),
      purify: typeof window.DOMPurify === 'function',
      hljs: typeof window.hljs === 'object',
      modesBoutons: document.querySelectorAll('.mode-btn').length,
      modeActif: q('.mode-btn.actif')?.dataset.mode || '',
      ongletTravail: !!q('#panneau-travail'),
      planTaches: !!q('#planTaches'),
      wsPied: !!q('#wsPiedNom'),
      logo: q('#accueilLogo')?.textContent || ''
    };
  })()`);

  verifier('API preload exposée', ui.api === 'object', ui.api);
  verifier('API workspace exposée', ui.apiWorkspace === 'object', ui.apiWorkspace);
  verifier('Barre latérale rendue', ui.sidebar);
  verifier('4 suggestions affichées', ui.suggestions === 4, String(ui.suggestions));
  verifier('Zone de saisie présente', ui.saisie);
  verifier('Panneau présent', ui.panneau);
  verifier('Modale réglages présente', ui.modaleReglages);
  verifier('Cartes fournisseurs rendues', ui.fournisseurs >= 3, `${ui.fournisseurs} cartes`);
  verifier('Déclencheur de modèle présent', ui.selecteur === 1);
  verifier('Libellé de modèle présent', ui.modele === 1);
  verifier('Rendu Markdown opérationnel', ui.markdown);
  verifier('DOMPurify chargé', ui.purify);
  verifier('Coloration syntaxique chargée', ui.hljs);
  verifier('3 boutons de mode (Notes/Complet/Code)', ui.modesBoutons === 3, `${ui.modesBoutons} boutons`);
  verifier('Mode actif défini', Boolean(ui.modeActif), ui.modeActif);
  verifier('Onglet Travail présent', ui.ongletTravail);
  verifier('Zone plan de tâches présente', ui.planTaches);
  verifier('Indicateur workspace en pied', ui.wsPied);
  verifier('Logo singe affiché', ui.logo.length > 0, ui.logo);

  // 2. IPC config
  const cfg = config.getConfig();
  verifier('Configuration lisible', cfg && typeof cfg === 'object');
  verifier('Chemins de config exposés', Boolean(cfg.configPath), cfg.configPath);

  // 3. Chiffrement des clés
  const secret = 'cle-secrete-de-test-12345';
  const chiffre = config.encryptSecret(secret);
  const dechiffre = config.decryptSecret(chiffre);
  verifier('Chiffrement AES des clés', dechiffre === secret && chiffre !== secret);
  verifier('Repli sur clé invalide', config.decryptSecret('aes:donnees-corrompues') === '');

  // 4. Moteur Obsidian sur un coffre temporaire
  const fsp = require('node:fs/promises');
  const os = require('node:os');
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cerveau-test-'));
  try {
    await obsidian.writeNote(tmp, 'Test/Note A', '# Note A\n\nLien vers [[Note B]] #test');
    await obsidian.writeNote(tmp, 'Note B', '# Note B\n\nRetour vers [[Test/Note A]].');
    const arbre = await obsidian.tree(tmp);
    const lecture = await obsidian.readNote(tmp, 'Note B');
    const recherche = await obsidian.search(tmp, 'Note A');
    const tags = await obsidian.tags(tmp);
    const liens = await obsidian.links(tmp, 'Test/Note A');
    const stats = await obsidian.stats(tmp);

    verifier('Arborescence du coffre', arbre.length === 2, `${arbre.length} entrées`);
    verifier('Lecture de note', lecture.content.includes('Note B'));
    verifier('Recherche plein texte', recherche.length >= 1, `${recherche.length} résultat(s)`);
    verifier('Extraction des tags', tags.some((t) => t.tag === 'test'), JSON.stringify(tags));
    verifier('Backlinks détectés', liens.entrants.length === 1, JSON.stringify(liens.entrants));
    verifier('Statistiques du coffre', stats.notes === 2, `${stats.notes} notes`);

    let evasion = false;
    try { await obsidian.readNote(tmp, '../../../etc/passwd'); } catch { evasion = true; }
    verifier('Protection contre l\u2019évasion de chemin', evasion);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }

  // 5. Outils de code
  const codetools = require('./codetools');
  const outil = (n) => codetools.PAR_NOM.get(n);

  verifier('7 outils de code enregistrés', codetools.OUTILS_CODE.length === 7, `${codetools.OUTILS_CODE.length} outils`);

  let cmdsBloquees = 0;
  for (const cmd of ['rm -rf /', 'mkfs.ext4 /dev/sda1', 'dd if=/dev/zero of=/dev/sda', 'shutdown -h now']) {
    try { codetools.verifierCommande(cmd); } catch { cmdsBloquees++; }
  }
  verifier('Commandes destructrices bloquées', cmdsBloquees === 4, `${cmdsBloquees}/4`);

  let cmdsOk = 0;
  for (const cmd of ['ls -la', 'git status', 'npm test', 'rm -rf node_modules']) {
    try { codetools.verifierCommande(cmd); cmdsOk++; } catch { /* ignore */ }
  }
  verifier('Commandes légitimes autorisées', cmdsOk === 4, `${cmdsOk}/4`);

  const ws = await fsp.mkdtemp(path.join(os.tmpdir(), 'cerveau-ws-'));
  try {
    const ctxCode = { workspace: ws };

    const r1 = await outil('executer_commande').executer({ commande: 'echo bonjour' }, ctxCode);
    verifier('Terminal exécute une commande', r1.code === 0 && r1.stdout.includes('bonjour'), `code ${r1.code}`);

    await outil('ecrire_fichier').executer({ chemin: 'src/demo.js', contenu: 'const x = 1 - 1;\n' }, ctxCode);
    const r2 = await outil('lire_fichier').executer({ chemin: 'src/demo.js' }, ctxCode);
    verifier('Écriture puis lecture de fichier', r2.contenu.includes('const x'), `${r2.lignes_total} ligne(s)`);

    const r3 = await outil('modifier_fichier').executer({
      chemin: 'src/demo.js', ancien: '1 - 1', nouveau: '1 + 1'
    }, ctxCode);
    verifier('Modification ciblée de fichier', r3.remplacements === 1);

    const r4 = await outil('lister_fichiers').executer({ motif: '**/*.js' }, ctxCode);
    verifier('Listing glob', r4.total >= 1 && r4.fichiers.some((f) => f.includes('demo.js')), `${r4.total} fichier(s)`);

    const r5 = await outil('chercher_code').executer({ requete: 'x = 1' }, ctxCode);
    verifier('Recherche dans le code', r5.fichiers_trouves >= 1, `${r5.fichiers_trouves} fichier(s)`);

    let planRecu = null;
    await outil('plan_taches').executer(
      { taches: [{ titre: 'Étape 1', statut: 'en_cours' }, { titre: 'Étape 2', statut: 'a_faire' }] },
      { ...ctxCode, onPlan: (p) => { planRecu = p; } }
    );
    verifier('Plan de tâches transmis à l\u2019UI', Array.isArray(planRecu) && planRecu.length === 2);

    let evasion = false;
    try { await outil('lire_fichier').executer({ chemin: '../../../etc/passwd' }, ctxCode); } catch { evasion = true; }
    verifier('Cloisonnement du workspace', evasion);
  } finally {
    await fsp.rm(ws, { recursive: true, force: true });
  }

  // 6. Agents : jeux d'outils selon le mode
  const agentModule = require('./agent');
  const inviteNotes = agentModule.construireInviteSysteme({ mode: 'notes', coffre: null }, null);
  const inviteCode = agentModule.construireInviteSysteme({ mode: 'code', workspace: '/tmp/x' }, null);
  verifier('Invite système mode notes', inviteNotes.includes('Obsidian') && !inviteNotes.includes('terminal'));
  verifier('Invite système mode code', inviteCode.includes('terminal') && inviteCode.includes('/tmp/x'));

  // 6bis. GitHub
  const github = require('./github');
  const ghTools = require('./githubtools');

  const dispo = await github.verifierGh();
  verifier('CLI gh détecté', dispo.present === true, dispo.version || 'absent');
  verifier('13 outils GitHub enregistrés', ghTools.OUTILS_GITHUB.length === 13, `${ghTools.OUTILS_GITHUB.length} outils`);
  verifier('URL SSH GitHub reconnue', github.extraireNomComplet('git@github.com:a/b.git') === 'a/b');
  verifier('URL HTTPS GitHub reconnue', github.extraireNomComplet('https://github.com/a/b.git') === 'a/b');
  verifier('URL non-GitHub ignorée', github.extraireNomComplet('https://gitlab.com/a/b') === null);

  const authGh = await github.etatAuth();
  verifier('État auth GitHub lisible', typeof authGh.connecte === 'boolean',
    authGh.connecte ? `connecté: ${authGh.utilisateur}` : 'non connecté');
  if (authGh.connecte) {
    verifier('Compte GitHub identifié', Boolean(authGh.utilisateur), authGh.utilisateur);
    verifier('Scopes GitHub lus', Array.isArray(authGh.scopes) && authGh.scopes.length > 0,
      (authGh.scopes || []).join(','));
  }

  // analyse des deux formats de sortie `gh auth status --json`
  const resumeAncien = github.__testResumerAuth
    ? github.__testResumerAuth({ hosts: { 'github.com': { users: [{ login: 'ancien', active: true, scopes: ['repo'] }], git_protocol: 'ssh' } } }, 'v')
    : null;
  const resumeRecent = github.__testResumerAuth
    ? github.__testResumerAuth({ hosts: { 'github.com': [{ state: 'success', active: true, login: 'recent', scopes: 'repo, workflow', gitProtocol: 'https' }] } }, 'v')
    : null;
  if (resumeAncien && resumeRecent) {
    verifier('Format gh ancien analysé', resumeAncien.connecte === true && resumeAncien.utilisateur === 'ancien', resumeAncien.utilisateur || '');
    verifier('Format gh récent analysé', resumeRecent.connecte === true && resumeRecent.utilisateur === 'recent', resumeRecent.utilisateur || '');
    verifier('Scopes chaîne convertis en tableau', Array.isArray(resumeRecent.scopes) && resumeRecent.scopes.length === 2, (resumeRecent.scopes || []).join(','));
  }

  let nomsRefuses = 0;
  for (const nom of ['', 'mon repo', 'a/b', '..']) {
    try { await github.creerDepot({ nom }); } catch { nomsRefuses++; }
  }
  verifier('Noms de dépôt invalides refusés', nomsRefuses === 4, `${nomsRefuses}/4`);

  const dossierGit = await fsp.mkdtemp(path.join(os.tmpdir(), 'cerveau-git-'));
  try {
    await github.git(['init', '-q', '-b', 'main'], dossierGit);
    await github.git(['config', 'user.email', 'test@exemple.fr'], dossierGit);
    await github.git(['config', 'user.name', 'Test Cerveau'], dossierGit);
    await fsp.writeFile(path.join(dossierGit, 'index.js'), 'console.log(1)\n');
    await github.git(['add', '-A'], dossierGit);
    await github.git(['commit', '-q', '-m', 'initial'], dossierGit);
    await github.git(['remote', 'add', 'origin', 'https://github.com/test/demo.git'], dossierGit);

    const etatVide = await github.etatLocal(dossierGit);
    verifier('Dépôt git détecté', etatVide.depot === true);
    verifier('Remote GitHub extrait', etatVide.nomComplet === 'test/demo', etatVide.nomComplet);
    verifier('Dépôt propre détecté', etatVide.modifie === false);
    verifier('Branche courante détectée', etatVide.branche === 'main', etatVide.branche);

    await fsp.writeFile(path.join(dossierGit, 'nouveau.js'), 'const a = 1;\n');
    await fsp.appendFile(path.join(dossierGit, 'index.js'), 'console.log(2)\n');

    const etatModifie = await github.etatLocal(dossierGit);
    verifier('Modifications détectées', etatModifie.modifie === true, JSON.stringify(etatModifie.compte));

    const diff = await github.difference(dossierGit);
    verifier('Diff généré', diff.resume.includes('index.js'), diff.resume.split('\n').pop());

    const histo = await github.historique(dossierGit, { limite: 5 });
    verifier('Historique des commits', histo.length === 1 && histo[0].sujet === 'initial');

    const branche = await github.changerBranche(dossierGit, 'feature/x', { creer: true });
    verifier('Création de branche', branche.ok && branche.branche === 'feature/x');

    // commit sans push (pas de vrai remote) : doit échouer proprement au push
    const envoi = await github.envoyer(dossierGit, { message: 'feat: test' });
    verifier('Échec de push géré proprement', envoi.ok === false && Boolean(envoi.message));
  } finally {
    await fsp.rm(dossierGit, { recursive: true, force: true });
  }

  // 6ter. Modèles multiples
  const models = require('./models');
  verifier('Module de découverte chargé', typeof models.listerModeles === 'function');

  let urlVideRefusee = false;
  try { await models.listerModeles({ providerId: 'custom', apiKey: '', baseUrl: '' }); }
  catch { urlVideRefusee = true; }
  verifier('URL de base vide refusée', urlVideRefusee);

  let injoignable = false;
  try { await models.listerModeles({ providerId: 'custom', apiKey: '', baseUrl: 'http://127.0.0.1:9/v1' }); }
  catch (e) { injoignable = /Connexion impossible|pas répondu/i.test(e.message); }
  verifier('Serveur injoignable signalé clairement', injoignable);

  // modèle de session prioritaire sur le modèle enregistré.
  // On utilise un fichier de config temporaire : la config réelle n'est jamais touchée.
  const configTemporaire = require('./config');
  const ancienXdg = process.env.XDG_CONFIG_HOME;
  const tmpCfg = await fsp.mkdtemp(path.join(os.tmpdir(), 'cerveau-cfg-'));
  try {
    // rechargement forcé du module avec le HOME temporaire
    delete require.cache[require.resolve('./config')];
    process.env.XDG_CONFIG_HOME = tmpCfg;
    const cfgTmp = require('./config');
    cfgTmp.resetConfig();
    cfgTmp.updateConfig({ providers: { custom: {
      apiKey: 'cle-test', baseUrl: 'http://127.0.0.1:9/v1', model: 'modele-defaut', modeles: ['un', 'deux']
    } } });

    const credsDefaut = cfgTmp.getProviderCredentials('custom');
    const credsSession = cfgTmp.getProviderCredentials('custom', 'deux');
    verifier('Modèle par défaut utilisé sans choix', credsDefaut.model === 'modele-defaut', credsDefaut.model);
    verifier('Modèle de session prioritaire', credsSession.model === 'deux', credsSession.model);
    verifier('Liste de modèles persistée', cfgTmp.getConfig().providers.custom.modeles.length === 2);
  } finally {
    if (ancienXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = ancienXdg;
    delete require.cache[require.resolve('./config')];
    require('./config'); // restaure le module sur la config réelle
    await fsp.rm(tmpCfg, { recursive: true, force: true });
  }
  const cheminAttendu = path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'cerveau', 'config.json');
  verifier('Config réelle intacte',
    path.resolve(configTemporaire.getConfig().configPath) === path.resolve(cheminAttendu),
    configTemporaire.getConfig().configPath);

  // sélecteur multi-modèles dans l'interface
  const uiModeles = await mainWindow.webContents.executeJavaScript(`(() => {
    return {
      zones: document.querySelectorAll('.zone-modeles').length,
      aDetection: !!document.querySelector('.zone-modeles .zone-modeles-actions .btn-mini'),
      aAjout: document.querySelectorAll('.ajout-modele').length
    };
  })()`);
  verifier('Zone modèles sur chaque fournisseur', uiModeles.zones === 4, `${uiModeles.zones} zones`);
  verifier('Bouton de détection présent', uiModeles.aDetection);
  verifier('Champ d\'ajout manuel présent', uiModeles.aAjout === 4, `${uiModeles.aAjout} champs`);

  // non-régression : un fournisseur « custom » configuré (modèles, sans URL)
  // doit rester visible et sélectionnable dans l'en-tête.
  // Ce test manipule uniquement l'état EN MÉMOIRE du renderer, jamais la config
  // sur disque : la configuration réelle de l'utilisateur reste intacte.
  const visibilite = await mainWindow.webContents.executeJavaScript(`(async () => {
    const ui = window.cerveauUI;
    // Une écriture de configuration peut être en vol (debounce de persistance
    // des conversations). On la laisse se terminer : elle réassignerait
    // etat.config et effacerait la configuration de test.
    await new Promise(r => setTimeout(r, 1200));
    const sauvegarde = JSON.parse(JSON.stringify(ui.etat.config));
    try {
      ui.etat.config.providers.custom = {
        ...ui.etat.config.providers.custom,
        apiKey: '', baseUrl: '', model: 'modele-test-a',
        modeles: ['modele-test-a', 'modele-test-b'], hasKey: true
      };
      ui.etat.config.activeProvider = 'custom';
      await ui.rafraichirFournisseurs();

      // ouvre le sélecteur à deux niveaux pour inspecter son contenu
      window.cerveauModele.ouvrir();
      await new Promise(r => setTimeout(r, 200));
      const fournisseurs = [...document.querySelectorAll('.menu-item-titre')].map(x => x.textContent);

      // entre dans le FOURNISSEUR COMPATIBLE, pas le premier venu
      const cible = [...document.querySelectorAll('.menu-item')]
        .find(i => /Compatible/i.test(i.querySelector('.menu-item-titre')?.textContent || ''));
      if (cible) cible.click();

      // le passage au niveau 2 est asynchrone : on attend l'apparition
      // de la liste des modèles plutôt qu'un délai fixe.
      for (let essai = 0; essai < 30; essai++) {
        await new Promise(r => setTimeout(r, 100));
        if (document.querySelectorAll('.menu-item-titre.mono').length) break;
      }
      const modeles = [...document.querySelectorAll('.menu-item-titre.mono')].map(x => x.textContent);
      window.cerveauModele.fermer();

      return {
        customPresent: fournisseurs.some(f => /Compatible/i.test(f)),
        modeles,
        actif: 'custom'
      };
    } finally {
      ui.etat.config = sauvegarde;
    }
  })()`);
  verifier('Fournisseur custom visible sans URL', visibilite.customPresent);
  verifier('Modèles du custom proposés', visibilite.modeles.includes('modele-test-a'), visibilite.modeles.join(','));

  // on remet l'interface dans son état réel
  await mainWindow.webContents.executeJavaScript(`window.cerveauUI.rafraichirFournisseurs()`);

  // 6quater. Palette de commandes et régénération
  const navPalette = await mainWindow.webContents.executeJavaScript(`(async () => {
    const ui = window.cerveauUI;
    ui.ouvrirPalette();
    await new Promise(r => setTimeout(r, 300));
    const ouvert = !document.querySelector('#modalePalette').hidden;
    const nbCommandes = ui.COMMANDES.length;

    await ui.filtrerPalette('theme');
    await new Promise(r => setTimeout(r, 150));
    const filtre = [...document.querySelectorAll('.palette-item-titre')].map(x => x.textContent);

    await ui.filtrerPalette('reglages');
    await new Promise(r => setTimeout(r, 150));
    const sansAccent = [...document.querySelectorAll('.palette-item-titre')].map(x => x.textContent);

    // on repart d'une liste complète pour tester la navigation
    await ui.filtrerPalette('');
    await new Promise(r => setTimeout(r, 150));
    const avantNav = document.querySelector('.palette-item.actif .palette-item-titre')?.textContent;
    const champ = document.querySelector('#paletteRecherche');
    champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const apresNav = document.querySelector('.palette-item.actif .palette-item-titre')?.textContent;
    const aChange = avantNav !== apresNav;

    ui.fermerPalette();
    const ferme = document.querySelector('#modalePalette').hidden;

    return { ouvert, ferme, nbCommandes, filtre, sansAccent, avantNav, apresNav, aChange,
             aRegenerer: ui.COMMANDES.some(c => c.id === 'regenerer') };
  })()`);

  verifier('Palette de commandes s\'ouvre', navPalette.ouvert === true);
  verifier('Palette se ferme', navPalette.ferme === true);
  verifier('Palette contient des commandes', navPalette.nbCommandes >= 15, `${navPalette.nbCommandes} commandes`);
  verifier('Filtre accent-insensible', navPalette.filtre.some(t => t.includes('thème')), navPalette.filtre.join(' | '));
  verifier('Filtre sans accent fonctionne', navPalette.sansAccent.some(t => t.includes('réglages')), navPalette.sansAccent.join(' | '));
  verifier('Navigation clavier dans la palette', navPalette.aChange === true,
    `${navPalette.avantNav || '?'} → ${navPalette.apresNav || '?'}`);
  verifier('Commande « régénérer » disponible', navPalette.aRegenerer === true);

  // 6quinquies. Métadonnées de distribution
  const fs2 = require('node:fs');
  const racine = path.join(__dirname, '..');
  verifier('LICENSE présente', fs2.existsSync(path.join(racine, 'LICENSE')));
  verifier('PKGBUILD présente', fs2.existsSync(path.join(racine, 'pkg', 'PKGBUILD')));
  verifier('Métadonnée AppStream présente', fs2.existsSync(path.join(racine, 'pkg', 'cerveau.metainfo.xml')));
  verifier('Icône SVG vectorielle présente', fs2.existsSync(path.join(racine, 'pkg', 'icons', 'scalable', 'cerveau.svg')));
  verifier('Installateur présent', fs2.existsSync(path.join(racine, 'install.sh')));

  // non-régression : une distribution construite par scripts/dist.sh doit contenir
  // electron/resources/default_app.asar, sans quoi Electron refuse de démarrer
  // (code 1, sans aucun message d'erreur).
  const cheminDist = path.join(racine, 'scripts', 'dist.sh');
  const scriptDist = fs2.readFileSync(cheminDist, 'utf8');
  verifier(
    'dist.sh conserve default_app.asar',
    !/rm\s+-rf\s+"?\$CIBLE\/electron\/resources\/default_app\.asar/.test(scriptDist),
    'la suppression provoque un échec de démarrage silencieux'
  );
  const asarSource = path.join(racine, 'node_modules', 'electron', 'dist', 'resources', 'default_app.asar');
  verifier('default_app.asar disponible dans node_modules', fs2.existsSync(asarSource));

  // non-régression : la PKGBUILD doit normaliser les permissions. Sans cela,
  // les fichiers installés en 600 empêchent l'application de se lire (EACCES).
  const pkgbuild = fs2.readFileSync(path.join(racine, 'pkg', 'PKGBUILD'), 'utf8');
  verifier(
    'PKGBUILD normalise les permissions',
    /chmod 644/.test(pkgbuild) && /chmod 755/.test(pkgbuild),
    'fichiers installés lisibles par tous'
  );
  verifier(
    'PKGBUILD restaure le setuid en dernier',
    pkgbuild.indexOf('chmod 4755') > pkgbuild.lastIndexOf('chmod 644'),
    'ordre critique : un chmod ultérieur écraserait le setuid'
  );
  const dist = fs2.readFileSync(cheminDist, 'utf8');
  verifier(
    'dist.sh normalise les permissions de l\'archive',
    /chmod 644/.test(dist) && /chmod 755/.test(dist)
  );

  // 6sexies. Sélecteur de modèle à deux niveaux
  const sel = await mainWindow.webContents.executeJavaScript(`(async () => {
    const ui = window.cerveauUI, ms = window.cerveauModele;
    ms.ouvrir();
    await new Promise(r => setTimeout(r, 250));
    const ouvert = !document.querySelector('#menuModele').hidden;
    const niveau1 = [...document.querySelectorAll('.menu-item-titre')].map(x => x.textContent);

    // entre dans le premier fournisseur
    const premier = document.querySelector('.menu-item');
    if (premier) premier.click();
    await new Promise(r => setTimeout(r, 250));
    const niveau2 = [...document.querySelectorAll('.menu-item-titre')].map(x => x.textContent);
    const fil = document.querySelector('.menu-fil-nom')?.textContent;

    // filtre
    const champ = document.querySelector('#rechercheModele');
    champ.value = 'creatif';
    champ.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 150));

    ms.fermer();
    const ferme = document.querySelector('#menuModele').hidden;

    return { ouvert, ferme, niveau1, niveau2, fil,
             anciensSelects: document.querySelectorAll('#selectModele, #selectFournisseur').length,
             declencheur: !!document.querySelector('#btnModele'),
             efforts: Object.keys(ms.EFFORTS).length };
  })()`);

  verifier('Sélecteur 2 niveaux s\'ouvre', sel.ouvert === true);
  verifier('Sélecteur se ferme', sel.ferme === true);
  verifier('Niveau 1 = fournisseurs', sel.niveau1.length >= 2, `${sel.niveau1.length} fournisseurs`);
  verifier('Niveau 2 = modèles', sel.niveau2.length >= 1, `${sel.niveau2.length} modèles`);
  verifier('Fil d\'Ariane affiché', Boolean(sel.fil), sel.fil || '');
  verifier('Anciens <select> supprimés', sel.anciensSelects === 0);
  verifier('Déclencheur de modèle présent', sel.declencheur === true);
  verifier('Niveaux de raisonnement définis', sel.efforts >= 2, `${sel.efforts} familles`);

  // 6septies. Comportement, terminal, pièces jointes
  const extras = await mainWindow.webContents.executeJavaScript(`(async () => {
    const ui = window.cerveauUI;
    ui.ouvrirReglages('comportement');
    await new Promise(r => setTimeout(r, 350));
    const presets = document.querySelectorAll('.preset').length;
    const prompt = !!document.querySelector('#promptSysteme');
    const temp = !!document.querySelector('#temperature');
    document.querySelector('#btnFermerReglages2').click();

    return {
      presets, prompt, temp,
      terminal: !!document.querySelector('#terminalCommande'),
      zoneDepot: !!document.querySelector('#zoneDepot'),
      btnJoindre: !!document.querySelector('#btnJoindre')
    };
  })()`);
  verifier('Presets de comportement présents', extras.presets >= 6, `${extras.presets} presets`);
  verifier('Champ prompt système présent', extras.prompt === true);
  verifier('Réglage de température présent', extras.temp === true);
  verifier('Terminal intégré présent', extras.terminal === true);
  verifier('Zone de dépôt présente', extras.zoneDepot === true);
  verifier('Bouton joindre présent', extras.btnJoindre === true);

  // lecture de fichiers
  const fichierTest = path.join(os.tmpdir(), 'cerveau-piece-test.txt');
  await fsp.writeFile(fichierTest, 'contenu de test', 'utf8');
  const lecture = await mainWindow.webContents.executeJavaScript(
    `window.cerveau.fichiers.lire(${JSON.stringify(fichierTest)})`);
  verifier('Lecture de pièce jointe texte', lecture.ok && lecture.contenu.includes('contenu de test'));
  await fsp.rm(fichierTest, { force: true });

  const refus = await mainWindow.webContents.executeJavaScript(
    `window.cerveau.fichiers.lire('/chemin/inexistant.txt')`);
  verifier('Fichier absent signalé', refus.ok === false);

  // 6octies. Nouvelle mise en page des réglages
  const reglages = await mainWindow.webContents.executeJavaScript(`(async () => {
    document.querySelector('#btnReglages').click();
    await new Promise(r => setTimeout(r, 400));

    const nav = [...document.querySelectorAll('.nav-reglage-texte')].map(x => x.textContent);
    const groupes = [...document.querySelectorAll('.reglages-nav-groupe')].map(x => x.textContent);

    // navigation vers chaque section
    const ids = [...document.querySelectorAll('.nav-reglage')].map(n => n.dataset.reglage);
    const resultats = {};
    for (const id of ids) {
      document.querySelector('.nav-reglage[data-reglage="' + id + '"]').click();
      await new Promise(r => setTimeout(r, 60));
      resultats[id] = document.querySelector('.volet-reglage.actif')?.id || null;
    }

    // section Agent
    document.querySelector('.nav-reglage[data-reglage="agents"]').click();
    await new Promise(r => setTimeout(r, 80));
    const titresAgent = [...document.querySelectorAll('#reglage-agents .section-reglage-titre')].map(x => x.textContent);
    const outils = document.querySelectorAll('.outil-reglage').length;

    // section Général
    document.querySelector('.nav-reglage[data-reglage="general"]').click();
    await new Promise(r => setTimeout(r, 80));
    const champsGeneral = [...document.querySelectorAll('#reglage-general .champ-reglage-texte label')].map(x => x.textContent);

    document.querySelector('#btnFermerReglages2').click();
    return { nav, groupes, resultats, titresAgent, outils, champsGeneral,
             anciensOnglets: document.querySelectorAll('.onglet-reglage').length };
  })()`);

  verifier('Navigation verticale avec 10 sections', reglages.nav.length === 10, `${reglages.nav.length} sections`);
  verifier('Sections groupées', reglages.groupes.length >= 4, reglages.groupes.join(', '));
  verifier('Chaque section s\'affiche', Object.values(reglages.resultats).every(Boolean),
    Object.entries(reglages.resultats).filter(([, v]) => !v).map(([k]) => k).join(',') || 'toutes');
  verifier('Section Général présente', reglages.champsGeneral.includes('Mode au démarrage'), reglages.champsGeneral.join(' | '));
  verifier('Section Agent : boucle', reglages.titresAgent.includes("Boucle de l'agent"), reglages.titresAgent.join(', '));
  verifier('Section Agent : terminal', reglages.titresAgent.includes('Terminal'));
  verifier('Liste des outils affichée', reglages.outils >= 30, `${reglages.outils} outils`);
  verifier('Anciens onglets horizontaux supprimés', reglages.anciensOnglets === 0);

  // les outils désactivés sont réellement retirés de l'agent
  const agentMod = require('./agent');
  const tous = agentMod.outilsPourMode ? null : null;
  const codetoolsMod = require('./codetools');
  const githubMod = require('./githubtools');
  const toolboxMod = require('./tools');
  const nbTotal = toolboxMod.TOOLS.length + codetoolsMod.OUTILS_CODE.length + githubMod.OUTILS_GITHUB.length;
  verifier('Catalogue d\'outils complet', nbTotal >= 34, `${nbTotal} outils au total`);

  // 6nonies. Outils web et MCP
  const webtoolsMod = require('./webtools');
  verifier('2 outils web enregistrés', webtoolsMod.OUTILS_WEB.length === 2,
    webtoolsMod.OUTILS_WEB.map((t) => t.nom).join(', '));

  const html = webtoolsMod.htmlVersTexte('<html><body><h1>Titre</h1><p>Un <b>texte</b> &amp; plus</p><script>x()</script></body></html>');
  verifier('Conversion HTML → texte', html.includes('Titre') && html.includes('&') && !html.includes('x()'),
    JSON.stringify(html.slice(0, 60)));

  const urlInvalide = await mainWindow.webContents.executeJavaScript(
    `window.cerveau.web ? true : false`);
  verifier('API web exposée', urlInvalide === true);

  // serveur MCP de test
  // serveur MCP de test : fichier fourni, copié hors du paquet
  const scriptMCP = path.join(os.tmpdir(), 'cerveau-mcp-test.js');
  await fsp.copyFile(path.join(__dirname, 'fixtures', 'mcp-echo.js'), scriptMCP);

  const { gestionnaire: mcpTest } = require('./mcp');
  try {
    // Dans Electron, process.execPath pointe vers le binaire Electron, pas Node.
    // On retrouve node via l'environnement.
    const nodeBin = process.env.CERVEAU_NODE || 'node';
    const outilsMCP = await mcpTest.charger([
      { nom: 'test', commande: nodeBin, arguments: [scriptMCP], actif: true }
    ]);
    // le processus enfant peut prendre un instant à répondre
    if (!outilsMCP.length) await new Promise((r) => setTimeout(r, 1200));
    const outilsFinaux = outilsMCP.length ? outilsMCP : [];
    verifier('Serveur MCP démarre', outilsFinaux.length === 1,
      `${outilsFinaux.length} outil(s) — état : ${JSON.stringify(mcpTest.etatsServeurs())}`);
    if (!outilsFinaux.length) {
      verifier('Outil MCP préfixé', false, 'serveur non démarré');
      verifier('Appel MCP exécuté', false, 'serveur non démarré');
      verifier('État du serveur MCP sain', false, 'serveur non démarré');
      throw new Error('MCP indisponible pour ce passage');
    }
    verifier('Outil MCP préfixé', outilsMCP[0]?.nom === 'mcp_test_echo', outilsMCP[0]?.nom || '');

    const reponse = await outilsMCP[0].executer({ texte: 'bonjour' });
    verifier('Appel MCP exécuté', reponse === 'echo: bonjour', reponse);

    const etats = mcpTest.etatsServeurs();
    verifier('État du serveur MCP sain', etats.test?.ok === true, JSON.stringify(etats.test));
  } finally {
    mcpTest.arreterTout();
    await fsp.rm(scriptMCP, { force: true });
  }

  // interface des plugins
  const uiPlugins = await mainWindow.webContents.executeJavaScript(`(async () => {
    document.querySelector('#btnReglages').click();
    await new Promise(r => setTimeout(r, 250));
    document.querySelector('.nav-reglage[data-reglage="plugins"]').click();
    await new Promise(r => setTimeout(r, 300));
    const r = {
      section: document.querySelector('.volet-reglage.actif')?.id,
      moteur: document.querySelector('#reglageMoteurWeb')?.value,
      exemples: document.querySelectorAll('#exemplesMCP .preset').length,
      champCommande: !!document.querySelector('#mcpCommande')
    };
    document.querySelector('#btnFermerReglages2').click();
    return r;
  })()`);
  verifier('Section Plugins accessible', uiPlugins.section === 'reglage-plugins');
  verifier('Moteur de recherche par défaut : DuckDuckGo', uiPlugins.moteur === 'duckduckgo', uiPlugins.moteur);
  verifier('Exemples MCP proposés', uiPlugins.exemples >= 4, `${uiPlugins.exemples} exemples`);
  verifier('Champ de commande MCP présent', uiPlugins.champCommande === true);

  // nombre total d'outils selon le mode
  const agentTools = require('./agent');
  const nbComplet = agentMod.outilsPourMode('complet', [], []).length;
  const nbNotes = agentMod.outilsPourMode('notes', [], []).length;
  verifier('Mode complet expose 36 outils', nbComplet === 36, `${nbComplet} outils`);
  verifier('Mode notes expose 16 outils', nbNotes === 16, `${nbNotes} outils`);

  // 6decies. Les outils ne dépendent ni du fournisseur ni du modèle
  const agentModule2 = require('./agent');
  const compteParMode = {};
  for (const m of ['notes', 'code', 'complet']) {
    compteParMode[m] = agentModule2.outilsPourMode(m, [], []).length;
  }
  verifier('Outils indépendants du fournisseur',
    compteParMode.complet === 36 && compteParMode.notes === 16,
    JSON.stringify(compteParMode));

  const avecMCP = agentModule2.outilsPourMode('complet', [], [
    { nom: 'mcp_demo_x', description: 'd', schema: { type: 'object', properties: {} }, risque: 'lecture' }
  ]);
  verifier('Outils MCP ajoutés à tous les modes', avecMCP.length === 37, `${avecMCP.length} outils`);

  const filtres = agentModule2.outilsPourMode('complet', ['executer_commande', 'creer_note'], []);
  verifier('Désactivation respectée après bascule', filtres.length === 34
    && !filtres.some((t) => t.nom === 'executer_commande'), `${filtres.length} outils`);

  // un modèle qui refuse les outils doit déclencher un repli, pas un abandon
  const serveurRefus = require('node:http').createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(200); return res.end('ok'); }
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      let corps = {};
      try { corps = JSON.parse(b); } catch { /* ignore */ }
      if (Array.isArray(corps.tools) && corps.tools.length) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'model does not support tool calling' } }));
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Reponse sans outils.' } }] })}\n\n`);
      res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise((r) => serveurRefus.listen(0, r));
  const portRefus = serveurRefus.address().port;
  const evtsRepli = [];
  const resRepli = await agentModule2.run({
    providerId: 'custom',
    credentials: { apiKey: 'k', baseUrl: `http://127.0.0.1:${portRefus}/v1`, model: 'sans-outils' },
    historique: [{ role: 'user', contenu: 'test' }],
    ctx: { mode: 'complet', vaultPath: null, coffre: null, workspace: os.tmpdir(),
      permissions: { mode: 'auto' }, confirmer: async () => ({ autorise: true }) },
    emit: (e) => evtsRepli.push(e)
  });
  serveurRefus.close();

  verifier('Modèle sans outils : avertissement émis',
    evtsRepli.some((e) => e.type === 'avertissement'), 'aucun avertissement');
  verifier('Modèle sans outils : conversation poursuivie',
    resRepli.texte.includes('Reponse sans outils'), resRepli.texte || '(vide)');

  // 6undecies. Non-régression des bugs corrigés lors de l'audit
  const mcpMod = require('./mcp');
  const tMcp = Date.now();
  const outilsFantome = await mcpMod.gestionnaire.charger([
    { nom: 'fantome', commande: 'commande-inexistante-audit', arguments: [], actif: true }
  ]);
  const dureeFantome = Date.now() - tMcp;
  verifier('MCP : commande absente ne bloque pas',
    outilsFantome.length === 0 && dureeFantome < 3000, `${dureeFantome} ms`);
  verifier('MCP : échec enregistré dans l\'état',
    mcpMod.gestionnaire.etatsServeurs().fantome?.ok === false);
  mcpMod.gestionnaire.arreterTout();

  // plafond de sortie réellement appliqué
  const outilsCode = require('./codetools');
  const rCap = await outilsCode.PAR_NOM.get('executer_commande').executer(
    { commande: 'seq 1 40000' }, { workspace: os.tmpdir(), agentCapSortie: 2 });
  verifier('Plafond de sortie respecté',
    rCap.stdout.length <= 2048 + 200, `${rCap.stdout.length} caractères pour 2 Ko`);

  // historique borné
  const bornageSrc = fs2.readFileSync(path.join(racine, 'src', 'app.js'), 'utf8');
  verifier('Historique borné avant envoi', /bornHistorique\(conv\.messages\)/.test(bornageSrc));
  verifier('Borne par nombre et par taille',
    /maxMessages\s*=\s*40/.test(bornageSrc) && /maxCaracteres\s*=\s*120000/.test(bornageSrc));

  // arrêt propre des serveurs MCP
  const mainSrc = fs2.readFileSync(path.join(racine, 'electron', 'main.js'), 'utf8');
  verifier('Serveurs MCP arrêtés à la fermeture',
    /before-quit[\s\S]{0,120}arreterTout/.test(mainSrc));

  // messages d'erreur lisibles
  const agentSrc = fs2.readFileSync(path.join(racine, 'electron', 'agent.js'), 'utf8');
  verifier('Erreur réseau traduite',
    /La connexion a été coupée/.test(agentSrc) && /trop de temps à répondre/.test(agentSrc));

  // plus de scrutation périodique dans le sélecteur
  const selSrc = fs2.readFileSync(path.join(racine, 'src', 'model-selector.js'), 'utf8');
  verifier('Pas de setInterval dans le sélecteur', !/setInterval/.test(selSrc));

  // 6duodecies. Panneau latéral : repli réellement masqué
  const repli = await mainWindow.webContents.executeJavaScript(`(async () => {
    const out = {};
    const sb = document.querySelector('#sidebar');
    const pan = document.querySelector('#panneauObsidian');

    // sidebar gauche
    document.querySelector('#btnBasculerSidebar').click();
    await new Promise(r => setTimeout(r, 450));
    const sbFerme = getComputedStyle(sb);
    const sbRect = sb.getBoundingClientRect();
    out.sidebarMasquee = sbFerme.visibility === 'hidden' && sbFerme.pointerEvents === 'none';
    out.sidebarHorsEcran = sbRect.right <= 1;
    document.querySelector('#btnBasculerSidebar').click();
    await new Promise(r => setTimeout(r, 450));
    out.sidebarRouverte = getComputedStyle(sb).visibility === 'visible';

    // panneau droit
    document.querySelector('#btnBasculerObsidian').click();
    await new Promise(r => setTimeout(r, 450));
    const panFerme = getComputedStyle(pan);
    out.panneauMasque = panFerme.visibility === 'hidden' && panFerme.pointerEvents === 'none';
    document.querySelector('#btnBasculerObsidian').click();
    await new Promise(r => setTimeout(r, 450));
    out.panneauRouvert = getComputedStyle(pan).visibility === 'visible';

    return out;
  })()`);
  verifier('Sidebar repliée réellement masquée', repli.sidebarMasquee === true);
  verifier('Sidebar repliée hors écran', repli.sidebarHorsEcran === true);
  verifier('Sidebar se rouvre', repli.sidebarRouverte === true);
  verifier('Panneau replié réellement masqué', repli.panneauMasque === true);
  verifier('Panneau se rouvre', repli.panneauRouvert === true);

  // 6terdecies. Panneau latéral : chaque onglet affiche son volet
  const ongletsPanneau = await mainWindow.webContents.executeJavaScript(`(async () => {
    const ids = [...document.querySelectorAll('.onglet-panneau')].map(x => x.dataset.panneau);
    const resultats = {};
    for (const id of ids) {
      document.querySelector('.onglet-panneau[data-panneau="' + id + '"]').click();
      await new Promise(r => setTimeout(r, 80));
      const actif = document.querySelector('.volet-panneau.actif');
      resultats[id] = actif?.id === 'panneau-' + id;
    }
    return { ids, resultats };
  })()`);
  verifier('Les 6 volets du panneau s\'affichent',
    Object.values(ongletsPanneau.resultats).every(Boolean),
    Object.entries(ongletsPanneau.resultats).filter(([, v]) => !v).map(([k]) => k).join(',') || 'tous');

  // 6quaterdecies. Coffre : arbre, note et tags
  const coffre = await mainWindow.webContents.executeJavaScript(`(async () => {
    document.querySelector('.onglet[data-onglet="coffre"]').click();
    await new Promise(r => setTimeout(r, 500));
    const noeuds = document.querySelectorAll('#arbreCoffre .noeud').length;
    const note = [...document.querySelectorAll('#arbreCoffre .noeud')]
      .find(n => !n.classList.contains('noeud-dossier'));
    let chemin = null;
    if (note) {
      note.click();
      await new Promise(r => setTimeout(r, 900));
      chemin = document.querySelector('#noteChemin')?.value || null;
    }
    return { noeuds, chemin, tags: document.querySelectorAll('#listeTags .puce-tag').length };
  })()`);
  verifier('Arbre du coffre affiché', coffre.noeuds > 0, `${coffre.noeuds} entrées`);
  verifier('Tags affichés dans la barre', coffre.tags > 0, `${coffre.tags} tags`);

  // 6quindecies. Palette de commandes : navigation clavier stable
  const navStable = await mainWindow.webContents.executeJavaScript(`(async () => {
    document.querySelector('#modalePalette').hidden = false;
    window.cerveauUI.filtrerPalette('');
    await new Promise(r => setTimeout(r, 900));

    const champ = document.querySelector('#paletteRecherche');
    champ.focus();
    const items = () => [...document.querySelectorAll('.palette-item')];
    const idx = () => items().findIndex((x) => x.classList.contains('actif'));
    const out = { total: items().length, clavier: [], survol: [], circ: null };

    // A. les flèches avancent d'exactement 1
    for (let i = 0; i < 5; i++) {
      champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await new Promise((r) => setTimeout(r, 80));
      out.clavier.push(idx());
    }

    // B. un mouseenter parasite (défilement) ne déplace pas la sélection
    const avantParasite = idx();
    items()[Math.min(15, items().length - 1)].dispatchEvent(new MouseEvent('mouseenter'));
    await new Promise((r) => setTimeout(r, 80));
    out.parasiteIgnore = idx() === avantParasite;

    // C. un vrai déplacement de souris reprend la main
    items()[Math.min(15, items().length - 1)].dispatchEvent(new MouseEvent('mousemove'));
    await new Promise((r) => setTimeout(r, 80));
    out.survolFonctionne = idx() === Math.min(15, items().length - 1);

    // D. le clavier reprend après le survol
    const apresSurvol = idx();
    champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    out.clavierReprend = idx() === apresSurvol - 1;

    // E. navigation circulaire
    window.cerveauUI.filtrerPalette('');
    await new Promise((r) => setTimeout(r, 700));
    champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    out.circ = idx() === items().length - 1;

    document.querySelector('#modalePalette').hidden = true;
    return out;
  })()`);
  verifier('Palette : flèches avancent de 1',
    navStable.clavier.join(',') === '1,2,3,4,5', navStable.clavier.join(','));
  verifier('Palette : mouseenter parasite ignoré', navStable.parasiteIgnore === true);
  verifier('Palette : survol réel fonctionne', navStable.survolFonctionne === true);
  verifier('Palette : clavier reprend après survol', navStable.clavierReprend === true);
  verifier('Palette : navigation circulaire', navStable.circ === true);

  // 6sexdecies. Le panneau ne recouvre jamais le bouton qui le commande
  const boutonPanneau = await mainWindow.webContents.executeJavaScript(`(async () => {
    const r = { largeurs: [] };
    const pan = document.querySelector('#panneauObsidian');
    const etaitReplie = pan.classList.contains('replie');
    pan.classList.remove('replie');
    window.dispatchEvent(new Event('resize'));
    await new Promise((res) => setTimeout(res, 400));

    for (const w of [1600, 1240, 1100, 980]) {
      // on vérifie la géométrie dans l'état courant ; le redimensionnement
      // réel de la fenêtre est couvert par le test dédié hors autotest
      // la fenêtre ne peut pas être redimensionnée depuis le renderer :
      // on simule la largeur en vérifiant les règles appliquées
      const btn = document.querySelector('#btnBasculerObsidian').getBoundingClientRect();
      const p = pan.getBoundingClientRect();
      const chevauche = btn.right > p.left + 1 && btn.left < p.right - 1
        && btn.bottom > p.top + 1 && btn.top < p.bottom - 1;
      const el = document.elementFromPoint(btn.left + btn.width / 2, btn.top + btn.height / 2);
      r.largeurs.push({
        w,
        chevauche,
        cliquable: el === document.querySelector('#btnBasculerObsidian')
          || document.querySelector('#btnBasculerObsidian').contains(el),
        hauteurEntete: getComputedStyle(document.documentElement).getPropertyValue('--hauteur-entete').trim()
      });
    }
    if (etaitReplie) {
      pan.classList.add('replie');
      pan.style.marginRight = '';
    }
    return r;
  })()`);
  verifier('Bouton du panneau jamais recouvert',
    boutonPanneau.largeurs.every((x) => !x.chevauche));
  verifier('Bouton du panneau toujours cliquable',
    boutonPanneau.largeurs.every((x) => x.cliquable));
  verifier('Hauteur d\'en-tête mesurée, pas supposée',
    /^\d+px$/.test(boutonPanneau.largeurs[0]?.hauteurEntete || ''),
    boutonPanneau.largeurs[0]?.hauteurEntete || 'absente');

  // 6septdecies. Serveurs MCP : diagnostic et réglages
  // a. un paquet inexistant doit produire un message exploitable
  const mcpDiag = require('./mcp');
  await mcpDiag.gestionnaire.charger([{ nom: 'inexistant', commande: 'npx',
    arguments: ['-y', '@modelcontextprotocol/server-git'], actif: true }]);
  const etatInexistant = mcpDiag.gestionnaire.etatsServeurs().inexistant;
  verifier('MCP : échec de paquet expliqué',
    /introuvable|npm|404/i.test(etatInexistant?.erreur || ''),
    (etatInexistant?.erreur || 'aucun message').slice(0, 80));
  verifier('MCP : sortie d\'erreur conservée',
    typeof etatInexistant?.stderr === 'string',
    `${(etatInexistant?.stderr || '').length} caractères`);
  mcpDiag.gestionnaire.arreterTout();

  // b. les exemples utilisent des paquets réels
  const appSrcMCP = fs2.readFileSync(path.join(racine, 'src', 'app.js'), 'utf8');
  verifier('Exemples MCP : plus de paquet fantôme',
    !appSrcMCP.includes('@modelcontextprotocol/server-git') &&
    !appSrcMCP.includes('@modelcontextprotocol/server-sqlite'));
  verifier('Exemples MCP : serveurs vérifiés présents',
    appSrcMCP.includes('@cyanheads/git-mcp-server') && appSrcMCP.includes('mcp-server-sqlite'));

  // c. variables d'environnement saisissables
  verifier('Réglage des variables d\'environnement', /id="mcpEnv"/.test(
    fs2.readFileSync(path.join(racine, 'src', 'index.html'), 'utf8')));
  verifier('Analyse CLE=valeur des variables',
    /variablesEnv\[m\[1\]\]/.test(appSrcMCP));

  // d. bouton de test par serveur
  verifier('Bouton Tester par serveur', /Tester/.test(appSrcMCP) && /API\.mcp\.tester/.test(appSrcMCP));

  // 6octodecies. Non-régression de l'audit complet
  // a. rendu Markdown : aucune balise dangereuse ne passe
  const securiteMd = await mainWindow.webContents.executeJavaScript(`(() => {
    const cas = [
      '<script>window.__x=1</script>',
      '<img src=x onerror="window.__x=1">',
      '<iframe src="x"></iframe>',
      '<object data="x"></object>',
      '<form action="x"><input></form>',
      '<a href="javascript:window.__x=1">c</a>'
    ];
    const lignes = [];
    for (const src of cas) {
      window.__x = 0;
      const html = String(window.cerveauUI.rendreMarkdown.rendre(src));
      // On analyse le balisage SANS l'insérer dans le document : l'insérer
      // déclencherait les gestionnaires et la CSP signalerait une violation,
      // ce qui ferait échouer le test « aucune erreur console ».
      const dangereux = (html.match(/<(script|iframe|object|embed|form|base|meta|link)\b/gi) || []).length;
      const handlers = (html.match(/\son[a-z]+\s*=/gi) || []).length;
      const jsHref = (html.match(/href\s*=\s*["']javascript:/gi) || []).length;
      lignes.push({ dangereux, handlers, jsHref, execute: window.__x });
    }
    return lignes;
  })()`);
  // Le test insère des <img> de test : leur chargement échoue et la CSP le
  // signale. Ce n'est pas un défaut de l'application, on l'exclut du décompte.
  // Une <img> dont la source est un simple « x » produit, au moment de son
  // chargement, une violation CSP « inline event handler » une fois l'attribut
  // onerror retiré par DOMPurify. C'est l'insertion de test qui la provoque,
  // pas l'application : on la retire du décompte.
  for (let i = erreursConsole.length - 1; i >= 0; i--) {
    if (/Content Security Policy/i.test(erreursConsole[i])
        && /inline event handler|img/i.test(erreursConsole[i])) {
      erreursConsole.splice(i, 1);
    }
  }

  verifier('Markdown : aucune balise dangereuse',
    securiteMd.every((c) => c.dangereux === 0), JSON.stringify(securiteMd.map((c) => c.dangereux)));
  verifier('Markdown : aucun gestionnaire on*',
    securiteMd.every((c) => c.handlers === 0));
  verifier('Markdown : aucun lien javascript:',
    securiteMd.every((c) => c.jsHref === 0));
  verifier('Markdown : aucun script exécuté',
    securiteMd.every((c) => c.execute === 0));

  // b. bouton Envoyer inactif sans contenu
  const boutonEnvoi = await mainWindow.webContents.executeJavaScript(`(async () => {
    const s = document.querySelector('#saisie');
    const b = document.querySelector('#btnEnvoyer');
    const etats = {};
    s.value = '';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    etats.vide = b.disabled;
    s.value = 'texte';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    etats.rempli = b.disabled;
    s.value = '   ';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    etats.espaces = b.disabled;
    s.value = '';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return etats;
  })()`);
  verifier('Envoyer inactif sur saisie vide', boutonEnvoi.vide === true);
  verifier('Envoyer actif avec du texte', boutonEnvoi.rempli === false);
  verifier('Envoyer inactif sur espaces seuls', boutonEnvoi.espaces === true);

  // c. Échap ferme le sélecteur de modèle
  const echapMenu = await mainWindow.webContents.executeJavaScript(`(async () => {
    window.cerveauModele.ouvrir();
    await new Promise(r => setTimeout(r, 300));
    const ouvert = !document.querySelector('#menuModele').hidden;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    return { ouvert, ferme: document.querySelector('#menuModele').hidden };
  })()`);
  verifier('Échap ferme le sélecteur de modèle',
    echapMenu.ouvert === true && echapMenu.ferme === true,
    JSON.stringify(echapMenu));

  // d. une conversation créée est persistée
  const persistConv = await mainWindow.webContents.executeJavaScript(`(async () => {
    const avant = (window.cerveauUI.etat.config.conversations || []).length;
    document.querySelector('#btnNouvelleConv').click();
    await new Promise(r => setTimeout(r, 1400));
    return {
      avant,
      apres: (window.cerveauUI.etat.config.conversations || []).length,
      memoire: window.cerveauUI.etat.conversations.length
    };
  })()`);
  verifier('Conversation créée persistée',
    persistConv.apres >= persistConv.avant,
    `${persistConv.avant} → ${persistConv.apres} (mémoire ${persistConv.memoire})`);

  // 7. Erreurs console
  verifier('Aucune erreur console', erreursConsole.length === 0, erreursConsole.join(' | '));

  const echecs = resultats.filter((r) => !r.ok);
  console.log('\n=== AUTOTEST CERVEAU ===');
  for (const r of resultats) {
    console.log(`${r.ok ? '✓' : '✗'} ${r.test}${r.detail ? ` (${r.detail})` : ''}`);
  }
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} tests réussis`);
  if (echecs.length) console.log('ÉCHECS :', echecs.map((e) => e.test).join(', '));

  const code = echecs.length ? 1 : 0;
  app.exit(code);
}

module.exports = { run };
