#!/usr/bin/env node
'use strict';

/**
 * Démon des tâches planifiées de Cerveau.
 *
 * Ce processus tourne en arrière-plan, sans interface, et déclenche les tâches
 * planifiées même quand l'application est fermée. Il partage les mêmes fichiers
 * d'état qu'elle : `planificateur.json`, `objectifs.json`, `memoire.json`.
 *
 * Points d'attention :
 *  - **Un seul démon à la fois.** Un verrou de fichier empêche deux instances de
 *    lancer la même tâche, ce qui doublerait les appels à l'IA.
 *  - **L'application reste prioritaire.** Si Cerveau est ouvert, c'est lui qui
 *    exécute : le démon se met en veille pour éviter le double travail.
 *  - **Rien n'est perdu.** L'état est relu avant chaque exécution et réécrit
 *    après, donc les deux processus partagent toujours la même vision.
 *
 * Usage :
 *   cerveau-daemon              démarre et reste au premier plan
 *   cerveau-daemon --une-fois   exécute ce qui est dû, puis sort
 *   cerveau-daemon --etat       affiche l'état et sort
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

/**
 * Où sont les modules de Cerveau ?
 *  - en développement : le démon est dans daemon/, les modules dans ../electron/
 *  - une fois installé : le démon est dans /usr/bin/, les modules dans
 *    /opt/cerveau/app/electron/. On essaie donc plusieurs emplacements.
 */
function trouverRacine() {
  const candidats = [
    path.join(__dirname, '..'),                    // développement
    path.join(__dirname, '..', '..'),              // au cas où
    '/opt/cerveau/app',                            // paquet installé
    path.join(process.env.CERVEAU_APP_DIR || '', '')  // surcharge explicite
  ].filter(Boolean);

  for (const base of candidats) {
    try {
      if (fs.existsSync(path.join(base, 'electron', 'planificateur.js'))) return base;
    } catch { /* emplacement invalide */ }
  }
  return path.join(__dirname, '..');
}

const RACINE = trouverRacine();
const { Planificateur } = require(path.join(RACINE, 'electron', 'planificateur.js'));
const { Objectifs } = require(path.join(RACINE, 'electron', 'objectifs.js'));
const { Memoire } = require(path.join(RACINE, 'electron', 'memoire.js'));
const config = require(path.join(RACINE, 'electron', 'config.js'));
const agent = require(path.join(RACINE, 'electron', 'agent.js'));

const ETAT_DIR = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'cerveau'
);

// Electron nomme son dossier de données « Cerveau » (majuscule) ; le démon
// utilise le même pour partager les fichiers d'état.
const DONNEES_DIR = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  process.env.CERVEAU_DATA_DIR || 'Cerveau'
);

const CHEMIN_PLAN = path.join(DONNEES_DIR, 'planificateur.json');
const CHEMIN_OBJ = path.join(DONNEES_DIR, 'objectifs.json');
const CHEMIN_MEM = path.join(DONNEES_DIR, 'memoire.json');
const CHEMIN_VERROU = path.join(DONNEES_DIR, 'daemon.lock');
const CHEMIN_JOURNAL = path.join(DONNEES_DIR, 'daemon.log');
const CHEMIN_PID = path.join(DONNEES_DIR, 'daemon.pid');
// Fichier distinct : sinon le démon lit son propre PID et se croit
// en présence de l'application, ce qui le met en veille indéfiniment.
const CHEMIN_PID_APP = path.join(DONNEES_DIR, 'app.pid');

const INTERVALLE_VERIFICATION = 30_000;

/* ------------------------------- journal -------------------------------- */

function journal(niveau, message) {
  const ligne = `${new Date().toISOString()} [${niveau}] ${message}\n`;
  try {
    fs.mkdirSync(path.dirname(CHEMIN_JOURNAL), { recursive: true });
    // rotation simple : au-delà de 1 Mo, on repart à zéro
    try {
      const taille = fs.statSync(CHEMIN_JOURNAL).size;
      if (taille > 1_048_576) fs.writeFileSync(CHEMIN_JOURNAL, '');
    } catch { /* fichier absent */ }
    fs.appendFileSync(CHEMIN_JOURNAL, ligne);
  } catch { /* le journal ne doit jamais faire tomber le démon */ }
  if (process.stdout.isTTY) process.stdout.write(ligne);
}

/* -------------------------------- verrou -------------------------------- */

/**
 * Verrou de fichier : un seul démon à la fois.
 * Le PID est vérifié pour qu'un fichier laissé par un plantage ne bloque pas
 * définitivement le démarrage.
 */
function prendreVerrou() {
  try {
    const existant = fs.readFileSync(CHEMIN_VERROU, 'utf8').trim();
    const pid = Number(existant);
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0); // le processus existe-t-il encore ?
        return { ok: false, pid };
      } catch { /* il est mort : on récupère le verrou */ }
    }
  } catch { /* pas de verrou : normal */ }

  try {
    fs.mkdirSync(path.dirname(CHEMIN_VERROU), { recursive: true });
    fs.writeFileSync(CHEMIN_VERROU, String(process.pid), { mode: 0o600 });
    fs.writeFileSync(CHEMIN_PID, String(process.pid), { mode: 0o600 });
    return { ok: true };
  } catch (err) {
    return { ok: false, erreur: err.message };
  }
}

function libererVerrou() {
  try {
    const pid = Number(fs.readFileSync(CHEMIN_VERROU, 'utf8').trim());
    if (pid === process.pid) fs.unlinkSync(CHEMIN_VERROU);
  } catch { /* déjà absent */ }
  try { fs.unlinkSync(CHEMIN_PID); } catch { /* déjà absent */ }
}

/**
 * L'application tourne-t-elle ? Si oui, c'est elle qui exécute.
 * On lit `app.pid`, écrit par Cerveau lui-même — surtout pas `daemon.pid`,
 * qui contient le PID du démon.
 */
function applicationOuverte() {
  try {
    const pid = Number(fs.readFileSync(CHEMIN_PID_APP, 'utf8').trim());
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

/* ----------------------------- exécution -------------------------------- */

function contexteAgent(cfg, memoire) {
  return {
    mode: cfg.mode || 'complet',
    vaultPath: (cfg.vaults || []).find((v) => v.id === cfg.activeVaultId)?.path || null,
    coffre: (cfg.vaults || []).find((v) => v.id === cfg.activeVaultId) || null,
    workspace: cfg.workspace || null,
    depotGithub: null,
    githubUtilisateur: null,
    systemPrompt: cfg.systemPrompt || '',
    outilsDesactives: cfg.outilsDesactives || [],
    agentMaxTours: cfg.agent?.maxTours,
    agentCapSortie: cfg.agent?.capSortie,
    temperature: cfg.temperature,
    presets: cfg.presetsComportement || [],
    // en arrière-plan, personne ne peut confirmer : lecture seule par défaut
    permissions: { ...cfg.permissions, mode: cfg.permissions?.mode === 'auto' ? 'auto' : 'lecture' },
    confirmer: async () => ({ autorise: false, raison: 'Exécution en arrière-plan : action non confirmable.' }),
    memoire,
    serveursMCP: Array.isArray(cfg.serveursMCP) ? cfg.serveursMCP : [],
    rechercheWeb: cfg.rechercheWeb || {}
  };
}

async function executerTache(tache, { plan, objectifs, memoire }) {
  const cfg = config.getConfig({ revealKeys: true });
  const creds = config.getProviderCredentials(cfg.activeProvider);
  if (!creds?.apiKey) throw new Error('Aucune clé d’API configurée.');

  // tâche liée à un objectif : on joue un tour
  if (tache.objectifId) {
    const obj = await objectifs.trouver(tache.objectifId);
    if (!obj) throw new Error('Objectif introuvable.');
    if (obj.etat === 'termine' || obj.etat === 'abandonne') {
      throw new Error(`Objectif ${obj.etat} : plus rien à faire.`);
    }
    if (obj.etat === 'suspendu') throw new Error('Objectif suspendu.');

    const prompt = objectifs.promptDuTour(obj);
    const res = await agent.run({
      providerId: cfg.activeProvider,
      credentials: creds,
      historique: [{ role: 'user', contenu: prompt }],
      ctx: contexteAgent(cfg, memoire),
      emit: () => {}
    });
    const maj = await objectifs.enregistrerTour(obj.id, {
      texte: res.texte || '',
      ok: !res.erreur,
      erreur: res.erreur || null
    });
    return { resume: `Tour ${maj.objectif.tours}/${maj.objectif.maxTours} — ${maj.objectif.etat}` };
  }

  const res = await agent.run({
    providerId: cfg.activeProvider,
    credentials: creds,
    historique: [{ role: 'user', contenu: tache.consigne }],
    ctx: contexteAgent(cfg, memoire),
    emit: () => {}
  });
  if (res.erreur) throw new Error(res.erreur);
  return { resume: (res.texte || '').slice(0, 300) };
}

/* ------------------------------- passages ------------------------------- */

async function passage({ verbose = false } = {}) {
  const plan = new Planificateur(CHEMIN_PLAN);
  const objectifs = new Objectifs(CHEMIN_OBJ);
  const memoire = new Memoire(CHEMIN_MEM);

  const dues = await plan.dues();
  if (!dues.length) return { executees: 0 };

  let executees = 0;
  for (const tache of dues) {
    plan.marquerEnCours(tache.id, true);
    journal('info', `Démarrage « ${tache.nom} »`);
    try {
      const res = await executerTache(tache, { plan, objectifs, memoire });
      const maj = await plan.enregistrerExecution(tache.id, { ok: true, resume: res.resume });
      executees += 1;
      journal('info', `« ${maj.nom} » terminée — ${res.resume.slice(0, 120)}`);
    } catch (err) {
      const maj = await plan.enregistrerExecution(tache.id, {
        ok: false, erreur: String(err.message || err)
      });
      const niveau = maj.actif === false ? 'avert' : 'erreur';
      journal(niveau, `« ${maj.nom} » : ${err.message}`
        + (maj.actif === false ? ' — mise en pause après échecs répétés' : ''));
    }
  }
  return { executees };
}

/* --------------------------------- CLI ---------------------------------- */

async function afficherEtat() {
  const plan = new Planificateur(CHEMIN_PLAN);
  const snap = await plan.instantane();
  console.log('Cerveau — démon des tâches planifiées');
  console.log(`Données : ${DONNEES_DIR}`);
  console.log(`Tâches  : ${snap.total} (${snap.actives} active(s))`);

  const verrou = prendreVerrou();
  if (!verrou.ok) console.log(`Démon  : en cours (PID ${verrou.pid})`);
  else { libererVerrou(); console.log('Démon  : arrêté'); }

  if (snap.prochaineMs != null) {
    const min = Math.round(snap.prochaineMs / 60000);
    console.log(`Prochaine exécution : dans ${min} min`);
  }
  for (const t of snap.taches) {
    const etat = t.actif ? 'active' : 'pause';
    const dans = t.dansMs != null ? `dans ${Math.round(t.dansMs / 60000)} min` : '—';
    console.log(`  [${etat}] ${t.nom} — ${t.description} — ${dans}`);
  }
}

/* ------------------------------ démarrage ------------------------------- */

async function principal() {
  const args = process.argv.slice(2);

  if (args.includes('--etat')) { await afficherEtat(); return; }

  const uneFois = args.includes('--une-fois');

  if (!uneFois) {
    const verrou = prendreVerrou();
    if (!verrou.ok) {
      journal('avert', `Un démon tourne déjà (PID ${verrou.pid}). Arrêt.`);
      process.exitCode = 1;
      return;
    }
  }

  journal('info', `Début (${uneFois ? 'passage unique' : `PID ${process.pid}`})`);

  const arreter = (signal) => {
    journal('info', `Arrêt sur ${signal}`);
    if (!uneFois) libererVerrou();
    process.exit(0);
  };
  process.on('SIGINT', () => arreter('SIGINT'));
  process.on('SIGTERM', () => arreter('SIGTERM'));
  process.on('uncaughtException', (err) => {
    journal('erreur', `Exception non gérée : ${err.message}`);
  });

  if (uneFois) {
    const r = await passage({ verbose: true });
    journal('info', `Passage terminé : ${r.executees} tâche(s).`);
    return;
  }

  // boucle principale
  let actif = true;
  const boucle = async () => {
    while (actif) {
      try {
        if (applicationOuverte()) {
          // l'application gère elle-même ses tâches : le démon se met en veille
          await new Promise((r) => setTimeout(r, INTERVALLE_VERIFICATION));
          continue;
        }
        await passage();
      } catch (err) {
        journal('erreur', `Passage : ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, INTERVALLE_VERIFICATION));
    }
  };

  process.on('SIGTERM', () => { actif = false; });
  await boucle();
}

if (require.main === module) {
  principal().catch((err) => {
    journal('erreur', `Fatal : ${err.message}`);
    libererVerrou();
    process.exit(1);
  });
}

module.exports = { passage, executerTache, afficherEtat, applicationOuverte, DONNEES_DIR, CHEMIN_PID_APP };
