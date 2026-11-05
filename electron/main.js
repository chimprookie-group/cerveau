'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme, Notification } = require('electron');
const path = require('node:path');

// Le nom de l'application détermine son dossier de données
// (~/.config/<nom>). Sans cette ligne, Electron retombe sur « Electron »
// quand le dossier de l'app est passé en argument — et le démon, qui lit
// ~/.config/Cerveau, ne verrait jamais les tâches ni la mémoire.
app.setName('cerveau');

/**
 * Récupère les données d'une installation antérieure.
 *
 * Les versions précédentes rangeaient leurs fichiers dans ~/.config/Cerveau
 * (majuscule) parce que le nom de l'application n'était pas fixé explicitement.
 * On rapatrie ces fichiers une fois, sans jamais écraser un fichier existant.
 */
function migrerDonneesAnciennes() {
  try {
    const dossierActuel = app.getPath('userData');
    const dossierAncien = path.join(path.dirname(dossierActuel), 'Cerveau');
    if (dossierAncien === dossierActuel) return;
    if (!fs.existsSync(dossierAncien)) return;

    const aMigrer = ['planificateur.json', 'objectifs.json', 'memoire.json',
                     'superviseur.json', 'app.pid', 'daemon.log'];
    let migres = 0;
    for (const nom of aMigrer) {
      const source = path.join(dossierAncien, nom);
      const cible = path.join(dossierActuel, nom);
      // on ne remplace jamais un fichier déjà présent
      if (!fs.existsSync(source) || fs.existsSync(cible)) continue;
      fs.mkdirSync(dossierActuel, { recursive: true });
      fs.copyFileSync(source, cible);
      fs.chmodSync(cible, 0o600);
      migres += 1;
    }
    if (migres) {
      console.log(`[cerveau] ${migres} fichier(s) repris depuis ${dossierAncien}`);
    }
  } catch { /* une migration ratée ne doit pas empêcher le démarrage */ }
}

const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const config = require('./config');
const obsidian = require('./obsidian');
const agent = require('./agent');
const providers = require('./providers');
const codetools = require('./codetools');
const github = require('./github');
const models = require('./models');
const webtools = require('./webtools');
const tachesfond = require('./tachesfond');
const competences = require('./competences');
const plugins = require('./plugins');
const { gestionnaire: mcpGestionnaire } = require('./mcp');
const { Superviseur } = require('./superviseur');
const { Memoire } = require('./memoire');
const { Objectifs } = require('./objectifs');
const { Planificateur, analyserIntervalle, NIVEAUX, permissionsDuNiveau } = require('./planificateur');

const isDev = !app.isPackaged;
let mainWindow = null;
let generationEnCours = null;   // AbortController
const confirmationsEnAttente = new Map();

/* ------------------------------ fenêtre -------------------------------- */

function createWindow() {
  const cfg = config.getConfig();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    title: 'Cerveau',
    backgroundColor: cfg.ui?.theme === 'clair' ? '#f7f7f8' : '#0f1115',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev && process.env.CERVEAU_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    if (process.env.CERVEAU_SELFTEST === '1') {
      require('./selftest').run(mainWindow, { config, obsidian, app }).catch((err) => {
        console.error('Autotest échoué :', err);
        app.exit(1);
      });
    }
  });

  // liens externes -> navigateur système
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

/* ------------------------------- menu ---------------------------------- */

function buildMenu() {
  const template = [
    {
      label: 'Fichier',
      submenu: [
        {
          label: 'Nouvelle conversation',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu', 'nouvelle-conversation')
        },
        {
          label: 'Ouvrir un coffre Obsidian…',
          accelerator: 'CmdOrCtrl+O',
          click: () => choisirCoffre()
        },
        { type: 'separator' },
        { label: 'Réglages', accelerator: 'CmdOrCtrl+,', click: () => mainWindow?.webContents.send('menu', 'reglages') },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter' }
      ]
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'selectAll', label: 'Tout sélectionner' }
      ]
    },
    {
      label: 'Affichage',
      submenu: [
        { label: 'Basculer la barre latérale', accelerator: 'CmdOrCtrl+B', click: () => mainWindow?.webContents.send('menu', 'basculer-sidebar') },
        { label: 'Basculer le panneau Obsidian', accelerator: 'CmdOrCtrl+Shift+B', click: () => mainWindow?.webContents.send('menu', 'basculer-obsidian') },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Taille normale' },
        { role: 'zoomIn', label: 'Agrandir' },
        { role: 'zoomOut', label: 'Réduire' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' },
        { role: 'toggleDevTools', label: 'Outils de développement' }
      ]
    },
    {
      label: 'Aide',
      submenu: [
        { label: 'Raccourcis clavier', click: () => mainWindow?.webContents.send('menu', 'raccourcis') },
        { label: 'Dossier de configuration', click: () => shell.openPath(config.APP_DIR) },
        { label: `Version ${app.getVersion()}`, enabled: false }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------------------- coffre actif ----------------------------- */

function coffreActif() {
  const cfg = config.getConfig();
  if (!cfg.activeVaultId) return null;
  return cfg.vaults.find((v) => v.id === cfg.activeVaultId) || null;
}

async function choisirCoffre() {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choisir un coffre Obsidian',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Ouvrir ce dossier'
  });
  if (res.canceled || !res.filePaths.length) return null;
  return ajouterCoffre(res.filePaths[0]);
}

function ajouterCoffre(chemin) {
  const cfg = config.getConfig();
  const existing = cfg.vaults.find((v) => v.path === chemin);
  if (existing) {
    config.updateConfig({ activeVaultId: existing.id });
    return { coffre: existing, nouveau: false };
  }
  const id = `vault_${Date.now()}`;
  const coffre = { id, name: path.basename(chemin), path: chemin };
  config.updateConfig({ vaults: [...cfg.vaults, coffre], activeVaultId: id });
  return { coffre, nouveau: true };
}

function ctxPermissions() {
  const cfg = config.getConfig({ revealKeys: true });
  return cfg.permissions;
}

/**
 * Un fournisseur « Compatible OpenAI » local (LM Studio, Ollama, vLLM…)
 * fonctionne sans clé : une URL de base suffit. Les fournisseurs publics,
 * eux, en exigent une.
 */
function fournisseurSansCle(id, creds) {
  return id === 'custom' && Boolean(String(creds?.baseUrl || '').trim());
}

/* ------------------------- journal de l'agent -------------------------- */

/**
 * Journal court des fins de requête, pour diagnostiquer un arrêt inexpliqué.
 * Fichier : ~/.config/cerveau/agent.log (200 dernières lignes).
 */
process.on('uncaughtException', (err) => {
  journaliserAgent(`crash · ${String(err?.stack || err).slice(0, 2000)}`);
});
process.on('unhandledRejection', (err) => {
  journaliserAgent(`promesse rejetée · ${String(err?.stack || err).slice(0, 2000)}`);
});

function journaliserAgent(ligne) {
  try {
    const fichier = path.join(app.getPath('userData'), 'agent.log');
    let lignes = [];
    try {
      lignes = fs.readFileSync(fichier, 'utf8').split('\n').filter(Boolean).slice(-199);
    } catch { /* premier passage */ }
    lignes.push(`${new Date().toISOString()} · ${ligne}`);
    fs.writeFileSync(fichier, `${lignes.join('\n')}\n`, { mode: 0o600 });
  } catch { /* le journal ne doit jamais gêner une requête */ }
}

/* ------------------------- IPC : configuration ------------------------- */

ipcMain.handle('config:obtenir', () => config.getConfig());

ipcMain.handle('config:mettre-a-jour', (_e, patch) => {
  const cfg = config.updateConfig(patch || {});
  if (patch?.ui?.theme) {
    nativeTheme.themeSource = patch.ui.theme === 'clair' ? 'light' : 'dark';
  }
  return cfg;
});

ipcMain.handle('config:reinitialiser', () => config.resetConfig());

ipcMain.handle('competences:lister', () => {
  try {
    return { ok: true, dossier: competences.DOSSIER, competences: competences.lister() };
  } catch (err) {
    return { ok: false, dossier: competences.DOSSIER, competences: [], message: String(err.message || err) };
  }
});

ipcMain.handle('plugins:lister', () => {
  try { return { ok: true, ...plugins.charger() }; }
  catch (err) { return { ok: false, message: String(err.message || err), plugins: [], outils: [] }; }
});

ipcMain.handle('plugins:recharger', () => {
  try { return { ok: true, ...plugins.recharger() }; }
  catch (err) { return { ok: false, message: String(err.message || err), plugins: [], outils: [] }; }
});

ipcMain.handle('plugins:ouvrir-dossier', async () => {
  try {
    plugins.assurerDossier();
    await shell.openPath(plugins.DOSSIER);
    return { ok: true, dossier: plugins.DOSSIER };
  } catch (err) { return { ok: false, message: String(err.message || err) }; }
});

ipcMain.handle('plugins:creer', (_e, { nom, code, description } = {}) => {
  try { return { ok: true, ...plugins.ajouter({ nom, code, description }) }; }
  catch (err) { return { ok: false, message: String(err.message || err) }; }
});

ipcMain.handle('plugins:supprimer', (_e, fichier) => {
  try { return { ok: true, ...plugins.supprimer(fichier) }; }
  catch (err) { return { ok: false, message: String(err.message || err) }; }
});

ipcMain.handle('competences:ouvrir-dossier', async () => {
  try {
    competences.assurerDossier();
    await shell.openPath(competences.DOSSIER);
    return { ok: true, dossier: competences.DOSSIER };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

/**
 * Résume une conversation pour la compaction du contexte. Renvoie un texte
 * court ; en cas d'échec, l'appelant garde simplement l'historique tronqué.
 */
ipcMain.handle('agent:resumer', async (_e, { texte } = {}) => {
  const cfg = config.getConfig({ revealKeys: true });
  const creds = config.getProviderCredentials(cfg.activeProvider);
  if (!creds?.apiKey && !fournisseurSansCle(cfg.activeProvider, creds)) {
    return { ok: false, message: "Aucune clé d'API configurée." };
  }

  const contenu = String(texte || '').slice(0, 120000);
  if (!contenu.trim()) return { ok: false, message: 'Rien à résumer.' };

  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), 25000);
  try {
    let resume = '';
    const flux = providers.stream({
      providerId: cfg.activeProvider,
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      model: creds.model,
      messages: [{
        role: 'user',
        content: "Tu résumes une conversation pour libérer de la place dans la fenêtre de contexte.\n"
          + 'Écris en français un résumé dense et factuel (300 mots maximum), en sections courtes, qui conserve :\n'
          + "- la demande initiale et les objectifs, avec les contraintes ;\n"
          + '- les décisions prises, les préférences exprimées et le style demandé ;\n'
          + '- les fichiers créés ou modifiés (chemins exacts) et les commandes importantes ;\n'
          + '- les résultats de tests ou de vérifications, et les erreurs rencontrées avec leur solution ;\n'
          + '- les faits durables appris sur l’utilisateur ou le projet ;\n'
          + '- ce qui reste à faire, dans l’ordre.\n'
          + 'Conserve les identifiants, chemins, URL et noms tels quels. '
          + "N'invente rien, pas de formule de politesse, pas de répétition.\n\nConversation :\n" + contenu
      }],
      tools: [],
      maxTokens: 700,
      temperature: 0.2,
      signal: controleur.signal
    });

    for await (const evt of flux) {
      if (evt.type === 'texte') resume += evt.delta;
      if (evt.type === 'erreur') return { ok: false, message: evt.message };
      if (evt.type === 'fin') break;
    }

    resume = resume.trim();
    if (!resume) return { ok: false, message: 'Le fournisseur a renvoyé un résumé vide.' };
    return { ok: true, resume: resume.slice(0, 6000) };
  } catch (err) {
    const msg = err?.name === 'AbortError' ? 'Résumé interrompu (délai dépassé).' : String(err.message || err);
    return { ok: false, message: msg };
  } finally {
    clearTimeout(minuteur);
  }
});

ipcMain.handle('providers:tester', async (_e, id, modeleChoisi) => {
  const creds = config.getProviderCredentials(id, modeleChoisi);
  if (!creds?.apiKey && !fournisseurSansCle(id, creds)) {
    return { ok: false, message: "Aucune clé d'API enregistrée." };
  }
  if (!creds.model) return { ok: false, message: 'Aucun modèle défini.' };
  const debut = Date.now();
  try {
    let texte = '';
    const flux = providers.stream({
      providerId: id,
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      model: creds.model,
      messages: [{
        role: 'user',
        content: id === 'anthropic' ? [{ type: 'text', text: 'Réponds uniquement : OK' }] : 'Réponds uniquement : OK'
      }],
      tools: [],
      maxTokens: 32
    });
    for await (const evt of flux) {
      if (evt.type === 'texte') texte += evt.delta;
      if (evt.type === 'erreur') return { ok: false, message: evt.message, ms: Date.now() - debut };
      if (evt.type === 'fin') break;
      if (texte.length > 0) break;
    }
    return { ok: true, message: `Connexion réussie (${creds.model})`, ms: Date.now() - debut, apercu: texte.trim().slice(0, 60) };
  } catch (err) {
    return { ok: false, message: String(err?.message || err), ms: Date.now() - debut };
  }
});

/* --------------------------- IPC : coffres ----------------------------- */

ipcMain.handle('coffre:choisir', () => choisirCoffre());

ipcMain.handle('coffre:activer', (_e, id) => {
  config.updateConfig({ activeVaultId: id });
  return { coffre: coffreActif() };
});

ipcMain.handle('coffre:retirer', (_e, id) => {
  const cfg = config.getConfig();
  const vaults = cfg.vaults.filter((v) => v.id !== id);
  const activeVaultId = cfg.activeVaultId === id ? (vaults[0]?.id ?? null) : cfg.activeVaultId;
  config.updateConfig({ vaults, activeVaultId });
  return { coffres: config.getConfig().vaults };
});

ipcMain.handle('coffre:ajouter-chemin', (_e, chemin) => ajouterCoffre(chemin));

ipcMain.handle('coffre:ouvrir-dans-obsidian', async (_e, chemin) => {
  const coffre = coffreActif();
  if (!coffre) return { ok: false, message: 'Aucun coffre actif.' };
  const url = chemin
    ? `obsidian://open?vault=${encodeURIComponent(coffre.name)}&file=${encodeURIComponent(chemin)}`
    : `obsidian://open?vault=${encodeURIComponent(coffre.name)}`;
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

/* -------------------------- IPC : Obsidian ----------------------------- */

function requireCoffre() {
  const coffre = coffreActif();
  if (!coffre) throw new Error('Aucun coffre Obsidian sélectionné. Ouvre un coffre dans les réglages.');
  return coffre;
}

ipcMain.handle('obs:arborescence', async () => obsidian.tree(requireCoffre().path));
ipcMain.handle('obs:lister', async () => obsidian.listNotes(requireCoffre().path));
ipcMain.handle('obs:lire', async (_e, p) => obsidian.readNote(requireCoffre().path, p));
ipcMain.handle('obs:ecrire', async (_e, p, contenu) => obsidian.writeNote(requireCoffre().path, p, contenu));
ipcMain.handle('obs:ajouter', async (_e, p, contenu) => obsidian.appendToNote(requireCoffre().path, p, contenu));
ipcMain.handle('obs:prepend', async (_e, p, contenu) => obsidian.prependToNote(requireCoffre().path, p, contenu));
ipcMain.handle('obs:remplacer', async (_e, p, s, r, all) => obsidian.patchNote(requireCoffre().path, p, s, r, { all }));
ipcMain.handle('obs:deplacer', async (_e, de, vers) => obsidian.moveNote(requireCoffre().path, de, vers));
ipcMain.handle('obs:creer-dossier', async (_e, p) => obsidian.makeFolder(requireCoffre().path, p));
ipcMain.handle('obs:supprimer', async (_e, p) => obsidian.deleteNote(requireCoffre().path, p, { corbeille: true }));
ipcMain.handle('obs:rechercher', async (_e, q, opts) => obsidian.search(requireCoffre().path, q, opts || {}));
ipcMain.handle('obs:tags', async () => obsidian.tags(requireCoffre().path));
ipcMain.handle('obs:notes-par-tag', async (_e, t) => obsidian.notesByTag(requireCoffre().path, t));
ipcMain.handle('obs:liens', async (_e, p) => obsidian.links(requireCoffre().path, p));
ipcMain.handle('obs:stats', async () => obsidian.stats(requireCoffre().path));
ipcMain.handle('obs:journal', async (_e, opts) => obsidian.journal(requireCoffre().path, opts || {}));

/* ------------------------- IPC : modèles ------------------------------- */

ipcMain.handle('models:lister', async (_e, { providerId, baseUrl, apiKey } = {}) => {
  try {
    const creds = config.getProviderCredentials(providerId, null);
    const url = baseUrl || creds?.baseUrl || '';
    // clé fournie à la volée (avant enregistrement) sinon clé stockée
    const cle = apiKey && apiKey !== '••••••••••••' ? apiKey : creds?.apiKey || '';
    const r = await models.listerModeles({ providerId, apiKey: cle, baseUrl: url });
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

/* ----------------------- IPC : espace de travail ----------------------- */

function workspaceActif() {
  const cfg = config.getConfig();
  return cfg.workspace || null;
}

ipcMain.handle('workspace:choisir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "Choisir l'espace de travail (dossier de code)",
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Travailler dans ce dossier'
  });
  if (res.canceled || !res.filePaths.length) return null;
  return definirWorkspace(res.filePaths[0]);
});

function definirWorkspace(chemin) {
  const cfg = config.getConfig();
  const name = path.basename(chemin);
  const recents = [
    { path: chemin, name, date: Date.now() },
    ...(cfg.workspacesRecents || []).filter((w) => w.path !== chemin)
  ].slice(0, 8);
  config.updateConfig({ workspace: chemin, workspacesRecents: recents });
  return { workspace: chemin, name, recents };
}

ipcMain.handle('workspace:definir', (_e, chemin) => {
  if (!chemin || !fs.existsSync(chemin)) throw new Error('Dossier introuvable.');
  return definirWorkspace(chemin);
});

ipcMain.handle('workspace:oublier', () => {
  config.updateConfig({ workspace: null });
  return { ok: true };
});

ipcMain.handle('workspace:infos', async () => {
  const ws = workspaceActif();
  if (!ws || !fs.existsSync(ws)) return { actif: false };
  let git = null;
  try {
    const r = await codetools.executerShell('git rev-parse --abbrev-ref HEAD 2>/dev/null', ws, 5000);
    if (r.code === 0 && r.stdout.trim()) git = r.stdout.trim();
  } catch { /* pas un dépôt git */ }
  let entrees = 0;
  try {
    entrees = (await fsp.readdir(ws)).filter((n) => !n.startsWith('.')).length;
  } catch { /* ignore */ }
  return {
    actif: true,
    chemin: ws,
    nom: path.basename(ws),
    git,
    entrees
  };
});

/* ------------------------ IPC : tâches planifiées ----------------------- */

let planificateurInstance = null;
let minuteriePlanificateur = null;
let executionPlanifieeEnCours = false;

function obtenirPlanificateur() {
  if (!planificateurInstance) {
    planificateurInstance = new Planificateur(path.join(app.getPath('userData'), 'planificateur.json'));
  }
  return planificateurInstance;
}

/** Exécute une tâche planifiée : un tour d'objectif, ou une consigne libre. */
async function executerTachePlanifiee(tache) {
  const cfg = config.getConfig({ revealKeys: true });
  const creds = config.getProviderCredentials(cfg.activeProvider);
  if (!creds?.apiKey && !fournisseurSansCle(cfg.activeProvider, creds)) {
    throw new Error('Aucune clé d’API configurée.');
  }

  const coffre = coffreActif();
  const ctx = {
    mode: cfg.mode || 'complet',
    vaultPath: coffre?.path || null,
    coffre,
    workspace: cfg.workspace || null,
    depotGithub: null,
    githubUtilisateur: null,
    systemPrompt: cfg.systemPrompt || '',
    outilsDesactives: cfg.outilsDesactives || [],
    agentMaxTours: cfg.agent?.maxTours,
    appelsParalleles: cfg.agent?.appelsParalleles !== false,
    agentCapSortie: cfg.agent?.capSortie,
    temperature: cfg.temperature,
    presets: cfg.presetsComportement || [],
    permissions: permissionsDuNiveau(tache.niveau),
    confirmer: async ({ nom }) => ({
      autorise: false,
      raison: `Niveau « ${tache.niveau} » : ${nom} n’est pas autorisé pour cette tâche planifiée.`
    }),
    memoire: obtenirMemoire(),
    serveursMCP: Array.isArray(cfg.serveursMCP) ? cfg.serveursMCP : [],
    rechercheWeb: cfg.rechercheWeb || {}
  };

  // tâche liée à un objectif : on joue un tour de cet objectif
  if (tache.objectifId) {
    const r = await jouerTour(tache.objectifId);
    if (!r.ok) throw new Error(r.message || 'Le tour a échoué.');
    return {
      resume: `Tour ${r.objectif.tours}/${r.objectif.maxTours} — ${r.objectif.etat}`,
      texte: (r.texte || '').slice(0, 400)
    };
  }

  const r = await agent.run({
    providerId: cfg.activeProvider,
    credentials: creds,
    historique: [{ role: 'user', contenu: tache.consigne }],
    ctx,
    emit: () => {}
  });
  if (r.erreur) throw new Error(r.erreur);
  return { resume: (r.texte || '').slice(0, 300), texte: r.texte || '' };
}

/**
 * Vérifie les échéances et lance ce qui est dû.
 * Un seul passage à la fois : sans ce verrou, deux appels rapprochés
 * lanceraient deux fois la même tâche.
 */
async function passerEnRevue() {
  if (executionPlanifieeEnCours) return;
  executionPlanifieeEnCours = true;
  const gest = obtenirPlanificateur();
  try {
    const dues = await gest.dues();
    for (const tache of dues) {
      gest.marquerEnCours(tache.id, true);
      try {
        mainWindow?.webContents.send('planification:evenement', { type: 'debut', tacheId: tache.id, nom: tache.nom });
      } catch { /* ignore */ }

      try {
        const res = await executerTachePlanifiee(tache);
        const maj = await gest.enregistrerExecution(tache.id, { ok: true, resume: res.resume });
        try {
          mainWindow?.webContents.send('planification:evenement', {
            type: 'fin', tacheId: tache.id, nom: maj.nom, ok: true, resume: res.resume
          });
        } catch { /* ignore */ }
      } catch (err) {
        const maj = await gest.enregistrerExecution(tache.id, {
          ok: false, erreur: String(err.message || err)
        });
        try {
          mainWindow?.webContents.send('planification:evenement', {
            type: 'fin', tacheId: tache.id, nom: maj.nom, ok: false,
            erreur: String(err.message || err).slice(0, 200),
            enPause: maj.actif === false
          });
        } catch { /* ignore */ }
      }
    }
  } catch { /* une panne du planificateur ne doit pas arrêter l'app */ }
  finally {
    executionPlanifieeEnCours = false;
    planifierProchainPassage();
  }
}

/**
 * Programme le prochain passage, au plus tôt de l'échéance suivante.
 * Une minuterie unique plutôt qu'une par tâche : moins de ressources,
 * et un redémarrage ne provoque pas de rattrapage massif.
 */
function planifierProchainPassage() {
  clearTimeout(minuteriePlanificateur);
  minuteriePlanificateur = null;

  obtenirPlanificateur().delaiProchaine()
    .then((delai) => {
      if (delai == null) return;
      const attente = Math.min(Math.max(delai, 1000), 60_000);
      minuteriePlanificateur = setTimeout(() => { passerEnRevue(); }, attente);
      if (minuteriePlanificateur.unref) minuteriePlanificateur.unref();
    })
    .catch(() => { /* ignore */ });
}

ipcMain.handle('planification:lister', async () => {
  try { return { ok: true, ...(await obtenirPlanificateur().instantane()) }; }
  catch (err) { return { ok: false, message: String(err.message || err) }; }
});

ipcMain.handle('planification:creer', async (_e, payload) => {
  try {
    const t = await obtenirPlanificateur().creer(payload || {});
    planifierProchainPassage();
    return { ok: true, tache: t };
  } catch (err) { return { ok: false, message: String(err.message || err) }; }
});

ipcMain.handle('planification:analyser', async (_e, texte) => {
  try {
    const r = analyserIntervalle(texte);
    return { ok: true, ...(r || {}) };
  } catch (err) { return { ok: false, message: String(err.message || err) }; }
});

ipcMain.handle('planification:basculer', async (_e, { id, actif }) => {
  try {
    const t = await obtenirPlanificateur().basculer(id, actif);
    planifierProchainPassage();
    return { ok: true, tache: t };
  } catch (err) { return { ok: false, message: String(err.message || err) }; }
});

ipcMain.handle('planification:executer', async (_e, id) => {
  try {
    const gest = obtenirPlanificateur();
    const t = await gest.trouver(id);
    if (!t) return { ok: false, message: 'Tâche introuvable.' };
    if (gest.enCours.has(id)) return { ok: false, message: 'Cette tâche tourne déjà.' };

    gest.marquerEnCours(id, true);
    try {
      const res = await executerTachePlanifiee(t);
      const maj = await gest.enregistrerExecution(id, { ok: true, resume: res.resume });
      planifierProchainPassage();
      return { ok: true, tache: maj, resume: res.resume };
    } catch (err) {
      const maj = await gest.enregistrerExecution(id, { ok: false, erreur: String(err.message || err) });
      planifierProchainPassage();
      return { ok: false, message: String(err.message || err), tache: maj };
    }
  } catch (err) { return { ok: false, message: String(err.message || err) }; }
});

ipcMain.handle('planification:niveau', async (_e, { id, niveau }) => {
  try {
    const t = await obtenirPlanificateur().changerNiveau(id, niveau);
    return { ok: true, tache: t };
  } catch (err) { return { ok: false, message: String(err.message || err) }; }
});

ipcMain.handle('planification:niveaux', async () => ({
  ok: true,
  niveaux: Object.values(NIVEAUX)
}));

ipcMain.handle('planification:supprimer', async (_e, id) => {
  try {
    const r = await obtenirPlanificateur().supprimer(id);
    planifierProchainPassage();
    return { ok: true, ...r };
  } catch (err) { return { ok: false, message: String(err.message || err) }; }
});

/* --------------------------- IPC : objectifs ---------------------------- */

let objectifsInstance = null;
let objectifEnCours = null;

function obtenirObjectifs() {
  if (!objectifsInstance) {
    objectifsInstance = new Objectifs(path.join(app.getPath('userData'), 'objectifs.json'));
  }
  return objectifsInstance;
}

/** Contexte d'exécution d'un tour d'objectif. */
function contexteObjectif(cfg) {
  const providerId = cfg.activeProvider;
  return {
    providerId,
    credentials: config.getProviderCredentials(providerId),
    workspace: cfg.workspace,
    permissions: { ...cfg.permissions, mode: 'auto' },
    confirmer: async () => ({ autorise: true })
  };
}

/**
 * Exécute un tour d'objectif et enregistre l'avancement.
 * Un seul tour à la fois : deux tours simultanés sur le même objectif
 * produiraient des pas contradictoires.
 */
async function jouerTour(id, { annoncer = true } = {}) {
  if (objectifEnCours) return { ok: false, message: 'Un tour est déjà en cours.' };

  const gest = obtenirObjectifs();
  const obj = await gest.trouver(id);
  if (!obj) return { ok: false, message: 'Objectif introuvable.' };
  if (obj.etat === 'termine' || obj.etat === 'abandonne') {
    return { ok: false, message: `Objectif ${obj.etat}.` };
  }
  if (obj.etat === 'suspendu') {
    return { ok: false, message: 'Objectif suspendu : reprenez-le d’abord.' };
  }

  const cfg = config.getConfig({ revealKeys: true });
  const coffre = coffreActif();
  const contexte = contexteObjectif(cfg);
  if (!contexte.credentials?.apiKey && !fournisseurSansCle(cfg.activeProvider, contexte.credentials)) {
    return { ok: false, message: 'Aucune clé d’API configurée.' };
  }

  objectifEnCours = id;
  const envoyer = (type, payload) => {
    try { mainWindow?.webContents.send('objectif:evenement', { type, id, ...payload }); } catch { /* ignore */ }
  };

  if (annoncer) envoyer('tour:debut', { tour: (obj.tours || 0) + 1 });

  const prompt = gest.promptDuTour(obj);
  let resultat;
  try {
    resultat = await agent.run({
      providerId: contexte.providerId,
      credentials: contexte.credentials,
      historique: [{ role: 'user', contenu: prompt }],
      ctx: {
        mode: cfg.mode || 'complet',
        vaultPath: coffre?.path || null,
        coffre,
        workspace: cfg.workspace || null,
        depotGithub: null,
        githubUtilisateur: null,
        systemPrompt: cfg.systemPrompt || '',
        outilsDesactives: cfg.outilsDesactives || [],
        agentMaxTours: cfg.agent?.maxTours,
    appelsParalleles: cfg.agent?.appelsParalleles !== false,
        agentCapSortie: cfg.agent?.capSortie,
        temperature: cfg.temperature,
        presets: cfg.presetsComportement || [],
        permissions: contexte.permissions,
        confirmer: contexte.confirmer,
        memoire: obtenirMemoire(),
        serveursMCP: Array.isArray(cfg.serveursMCP) ? cfg.serveursMCP : [],
        rechercheWeb: cfg.rechercheWeb || {}
      },
      emit: (evt) => {
        if (evt.type === 'outil_resultat') envoyer('tour:outil', { nom: evt.nom, message: evt.message });
        if (evt.type === 'erreur') envoyer('tour:erreur', { message: evt.message });
      }
    });
  } catch (err) {
    objectifEnCours = null;
    const r = await gest.enregistrerTour(id, { texte: '', ok: false, erreur: String(err.message || err) });
    envoyer('tour:fin', { objectif: r.objectif });
    return { ok: false, message: String(err.message || err), objectif: r.objectif };
  }

  objectifEnCours = null;
  const r = await gest.enregistrerTour(id, {
    texte: resultat.texte || '',
    ok: !resultat.erreur,
    erreur: resultat.erreur || null
  });

  envoyer('tour:fin', { objectif: r.objectif, texte: resultat.texte || '' });
  return { ok: true, objectif: r.objectif, texte: resultat.texte || '', analyse: r.analyse };
}

ipcMain.handle('objectif:lister', async () => {
  try { return { ok: true, ...(await obtenirObjectifs().instantane()) }; }
  catch (err) { return { ok: false, message: String(err.message || err) }; }
});

ipcMain.handle('objectif:creer', async (_e, payload) => {
  try {
    const obj = await obtenirObjectifs().creer(payload || {});
    return { ok: true, objectif: obj };
  } catch (err) { return { ok: false, message: String(err.message || err) }; }
});

ipcMain.handle('objectif:tour', async (_e, id) => {
  try { return await jouerTour(id); }
  catch (err) { objectifEnCours = null; return { ok: false, message: String(err.message || err) }; }
});

ipcMain.handle('objectif:etat', async (_e, { id, etat }) => {
  try {
    const obj = await obtenirObjectifs().changerEtat(id, etat);
    return { ok: true, objectif: obj };
  } catch (err) { return { ok: false, message: String(err.message || err) }; }
});

ipcMain.handle('objectif:supprimer', async (_e, id) => {
  try { return { ok: true, ...(await obtenirObjectifs().supprimer(id)) }; }
  catch (err) { return { ok: false, message: String(err.message || err) }; }
});

/* ---------------------------- IPC : mémoire ----------------------------- */

let memoireInstance = null;
function obtenirMemoire() {
  if (!memoireInstance) {
    memoireInstance = new Memoire(path.join(app.getPath('userData'), 'memoire.json'));
  }
  return memoireInstance;
}

ipcMain.handle('memoire:lister', async () => {
  try {
    const mem = obtenirMemoire();
    const entrees = await mem.chercher('');
    return { ok: true, entrees, total: entrees.length };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('memoire:ajouter', async (_e, { texte, categorie }) => {
  try {
    const r = await obtenirMemoire().retenir({ texte, categorie, source: 'utilisateur' });
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('memoire:supprimer', async (_e, id) => {
  try {
    return { ok: true, ...(await obtenirMemoire().oublier(id)) };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('memoire:vider', async () => {
  try {
    const mem = obtenirMemoire();
    await mem.vider();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('memoire:modifier', async (_e, { id, texte }) => {
  try {
    const mem = obtenirMemoire();
    await mem.charger();
    const entree = mem.entrees.find((x) => x.id === id);
    if (!entree) return { ok: false, message: 'Fait introuvable.' };
    entree.texte = String(texte || '').trim().slice(0, 500);
    entree.majLe = Date.now();
    await mem.enregistrer();
    return { ok: true, entree };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

/* --------------------------- IPC : diagnostic --------------------------- */

/**
 * Vérifie que les outils externes dont dépendent les fonctions intégrées sont
 * présents. Un utilisateur qui installe le paquet doit savoir tout de suite ce
 * qui manque, plutôt que de découvrir une erreur au moment d'utiliser l'onglet.
 */
ipcMain.handle('diag:outils', async () => {
  const { executer } = require('./github');

  const verifier = async (commande, args = ['--version']) => {
    try {
      const r = await executer(commande, args, { timeout: 15000 });
      const brut = String(r.stdout || r.stderr || '').trim().split('\n')[0];
      return { present: r.code === 0, version: r.code === 0 ? brut.slice(0, 60) : null };
    } catch (err) {
      return { present: false, version: null, erreur: String(err.message || err).slice(0, 120) };
    }
  };

  const [git, gh, node, npm] = await Promise.all([
    verifier('git', ['--version']),
    verifier('gh', ['--version']),
    verifier('node', ['--version']),
    verifier('npm', ['--version'])
  ]);

  // authentification GitHub, via la même logique que l'onglet Dépôt
  let auth = { connecte: false };
  if (gh.present) {
    try {
      const resume = await require('./github').etatAuth();
      auth = {
        connecte: Boolean(resume.connecte),
        detail: resume.utilisateur
          ? `connecté comme ${resume.utilisateur}`
          : (resume.message || null),
        hint: resume.connecte
          ? null
          : "Si gh fonctionne dans un terminal, l'onglet Dépôt devrait fonctionner aussi. Sinon, connectez-vous depuis cet onglet."
      };
    } catch (err) {
      auth = { connecte: false, detail: String(err.message || err).slice(0, 120) };
    }
  }

  const outils = [
    { id: 'git', nom: 'Git', present: git.present, version: git.version,
      requis: true, paquet: 'git', usage: 'Projets, commits, différences' },
    { id: 'gh', nom: 'GitHub CLI', present: gh.present, version: gh.version,
      requis: true, paquet: 'github-cli', usage: 'Onglet Dépôt, pull requests, Superviseur' },
    { id: 'node', nom: 'Node.js', present: node.present, version: node.version,
      requis: true, paquet: 'nodejs', usage: 'Serveurs MCP (git, sqlite, mémoire…)' },
    { id: 'npm', nom: 'npm', present: npm.present, version: npm.version,
      requis: true, paquet: 'npm', usage: 'Installation des serveurs MCP via npx' }
  ];

  const manquants = outils.filter((o) => o.requis && !o.present);

  return {
    ok: manquants.length === 0,
    outils,
    manquants: manquants.map((o) => o.paquet),
    auth,
    // commande exacte à donner à l'utilisateur
    commande: manquants.length
      ? `sudo pacman -S --needed ${manquants.map((o) => o.paquet).join(' ')}`
      : null
  };
});

/* ---------------------------- IPC : superviseur ------------------------- */

let superviseur = null;
function obtenirSuperviseur() {
  const cfg = config.getConfig();
  const sc = { ...config.DEFAULTS.superviseur, ...(cfg.superviseur || {}) };
  const fichierEtat = path.join(app.getPath('userData'), 'superviseur.json');

  if (!superviseur) {
    superviseur = new Superviseur({ ...sc, fichierEtat });
    // les événements du superviseur sont poussés au renderer
    superviseur.surEvenement((evt) => {
      try { mainWindow?.webContents.send('superviseur:evenement', evt); } catch { /* ignore */ }
    });
  } else {
    superviseur.config = { ...sc, fichierEtat };
  }
  return superviseur;
}

/** Contexte d'exécution d'un ticket : mêmes crédences que l'agent normal. */
function contexteSuperviseur(cfg) {
  const providerId = cfg.activeProvider;
  const creds = config.getProviderCredentials(providerId);
  return {
    providerId,
    credentials: creds,
    workspace: cfg.superviseur?.workspace || cfg.workspace,
    permissions: { ...cfg.permissions, mode: 'auto' },
    confirmer: async () => ({ autorise: true }),
    executeur: async (params) => agent.run({
      providerId: params.providerId,
      credentials: params.credentials,
      historique: [{ role: 'user', contenu: params.consigne }],
      ctx: {
        mode: 'code',
        vaultPath: null,
        coffre: null,
        workspace: params.workspace,
        depotGithub: cfg.superviseur?.depot || null,
        githubUtilisateur: null,
        permissions: params.permissions,
        confirmer: params.confirmer,
        outilsDesactives: cfg.outilsDesactives || [],
        agentMaxTours: cfg.agent?.maxTours,
    appelsParalleles: cfg.agent?.appelsParalleles !== false,
        agentCapSortie: cfg.agent?.capSortie,
        temperature: cfg.temperature,
        presets: cfg.presetsComportement || [],
        systemPrompt: cfg.systemPrompt || '',
        // le Superviseur travaille comme le chat : mêmes outils, même mémoire
        memoire: obtenirMemoire(),
        serveursMCP: Array.isArray(cfg.serveursMCP) ? cfg.serveursMCP : [],
        rechercheWeb: cfg.rechercheWeb || {}
      },
      emit: params.emit
    })
  };
}

ipcMain.handle('superviseur:etat', async () => {
  try {
    const sup = obtenirSuperviseur();
    return { ok: true, ...(await sup.instantane()) };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('superviseur:demarrer', async () => {
  try {
    const cfg = config.getConfig();
    const sc = cfg.superviseur || {};
    if (!sc.depot) return { ok: false, message: 'Choisissez un dépôt à surveiller.' };
    if (!Array.isArray(sc.auteursAutorises) || !sc.auteursAutorises.length) {
      return { ok: false, message: 'Ajoutez au moins un auteur autorisé.' };
    }
    const sup = obtenirSuperviseur();
    sup.demarrer(contexteSuperviseur(cfg));
    await config.mettreAJour({ superviseur: { actif: true } });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('superviseur:arreter', async () => {
  try {
    const sup = obtenirSuperviseur();
    sup.arreter();
    await config.mettreAJour({ superviseur: { actif: false } });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('superviseur:passer', async () => {
  try {
    const cfg = config.getConfig();
    const sc = cfg.superviseur || {};
    if (!sc.depot) return { ok: false, message: 'Choisissez un dépôt à surveiller.' };
    const sup = obtenirSuperviseur();
    const r = await sup.passer(contexteSuperviseur(cfg));
    const snap = await sup.instantane();
    return { ok: true, ...r, ...snap };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('superviseur:reinitialiser', async () => {
  try {
    const sup = obtenirSuperviseur();
    sup.arreter();
    sup.etat.donnees = { tickets: [], dernierPassage: null, erreurs: [] };
    sup.etat.charge = true;
    await sup.etat.enregistrer();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

/* ----------------------------- IPC : web + MCP -------------------------- */

ipcMain.handle('web:tester', async () => {
  try {
    const cfg = config.getConfig();
    const rw = cfg.rechercheWeb || {};
    const outil = webtools.PAR_NOM.get('web_search');
    const r = await outil.executer(
      { requete: 'documentation electron', limite: 3 },
      { rechercheWeb: { moteur: rw.moteur, urlBase: rw.urlBase, cle: rw.cle } }
    );
    return {
      ok: r.total > 0,
      total: r.total,
      moteur: r.moteur,
      exemple: r.resultats?.[0]?.titre || ''
    };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('mcp:etats', async () => {
  try {
    return { ok: true, etats: mcpGestionnaire.etatsServeurs() };
  } catch (err) {
    return { ok: false, etats: {}, message: String(err.message || err) };
  }
});

ipcMain.handle('mcp:outils', async (_e, nom) => {
  try {
    if (!nom) return { ok: false, outils: [], message: 'Nom de serveur manquant.' };

    // On charge le serveur s'il ne tourne pas encore : l'utilisateur qui
    // clique « Outils » veut voir la liste, pas un message d'erreur.
    const cfg = config.getConfig();
    const cible = (cfg.serveursMCP || []).find((x) => x.nom === nom);
    if (!cible) return { ok: false, outils: [], message: `Serveur « ${nom} » introuvable.` };

    const dejaLa = mcpGestionnaire.etatsServeurs()[nom];
    if (!dejaLa?.ok) await mcpGestionnaire.charger([cible], { partiel: true });

    const outils = mcpGestionnaire.outilsDuServeur(nom);
    return { ok: true, outils, total: outils.length };
  } catch (err) {
    return { ok: false, outils: [], message: String(err.message || err) };
  }
});

ipcMain.handle('mcp:tester', async (_e, nom) => {
  try {
    const cfg = config.getConfig();
    const serveurs = cfg.serveursMCP || [];

    // On ne teste que le serveur demandé : charger les autres au passage
    // ferait échouer le test à cause d'un voisin mal configuré.
    if (nom) {
      const cible = serveurs.find((x) => x.nom === nom);
      if (!cible) return { ok: false, message: `Serveur « ${nom} » introuvable.` };

      // on force un redémarrage propre pour repartir d'un état sain
      const ancien = mcpGestionnaire.serveurs.get(nom);
      if (ancien) {
        ancien.arreter();
        mcpGestionnaire.serveurs.delete(nom);
      }
      mcpGestionnaire.etats.delete(nom);

      // « Démarrer » peut attendre : au premier lancement npx télécharge le paquet.
      const outils = await mcpGestionnaire.charger([cible], { partiel: true, delai: 60000 });
      const etat = mcpGestionnaire.etatsServeurs()[nom];
      return {
        ok: Boolean(etat?.ok) && outils.length > 0,
        outils: outils.length,
        etats: mcpGestionnaire.etatsServeurs()
      };
    }

    const outils = await mcpGestionnaire.charger(serveurs, { delai: 60000 });
    return { ok: true, outils: outils.length, etats: mcpGestionnaire.etatsServeurs() };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('mcp:arreter', async () => {
  mcpGestionnaire.arreterTout();
  return { ok: true };
});

/* --------------------------- IPC : fichiers ---------------------------- */

ipcMain.handle('fichiers:choisir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Joindre des fichiers',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Tous les fichiers', extensions: ['*'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      { name: 'Texte et code', extensions: ['txt', 'md', 'js', 'ts', 'json', 'py', 'css', 'html', 'yaml', 'yml', 'sh'] }
    ]
  });
  if (res.canceled) return { ok: false };
  return { ok: true, chemins: res.filePaths };
});

/**
 * Lit un fichier pour l'ajouter au message.
 * Les images sont renvoyées en base64 ; le texte en clair (borné).
 */
ipcMain.handle('fichiers:lire', async (_e, chemin) => {
  try {
    const abs = path.resolve(String(chemin));
    const st = await fsp.stat(abs);
    const nom = path.basename(abs);
    const ext = path.extname(abs).toLowerCase().replace('.', '');

    const IMAGES = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
    if (IMAGES.includes(ext)) {
      if (st.size > 8 * 1024 * 1024) {
        throw new Error(`Image trop volumineuse (${Math.round(st.size / 1024 / 1024)} Mo, maximum 8 Mo).`);
      }
      const donnees = await fsp.readFile(abs);
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      return {
        ok: true,
        type: 'image',
        nom,
        taille: st.size,
        mime,
        dataUrl: `data:${mime};base64,${donnees.toString('base64')}`
      };
    }

    if (st.size > 512 * 1024) {
      throw new Error(`Fichier trop volumineux (${Math.round(st.size / 1024)} Ko, maximum 512 Ko).`);
    }
    const texte = await fsp.readFile(abs, 'utf8');
    if (texte.includes('\u0000')) {
      throw new Error('Fichier binaire : non pris en charge.');
    }
    return { ok: true, type: 'texte', nom, taille: st.size, langage: ext, contenu: texte };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

/* ---------------------------- IPC : terminal --------------------------- */

ipcMain.handle('terminal:executer', async (_e, commande, opts = {}) => {
  try {
    const ws = workspaceActif();
    if (!ws) return { ok: false, message: "Aucun espace de travail ouvert." };
    const cmd = codetools.verifierCommande(commande);
    const cfg = config.getConfig();
    const delaiDefaut = Number(cfg.agent?.delaiCommande) || 120;
    const delai = Math.min(Number(opts.delai) || delaiDefaut, 600) * 1000;
    const plafond = (Number(cfg.agent?.capSortie) || 60) * 1024;
    const r = await codetools.executerShell(cmd, ws, delai, null, plafond);
    return {
      ok: true,
      code: r.code,
      stdout: r.stdout,
      stderr: r.stderr,
      duree: r.duree
    };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

/* --------------------------- presets de style -------------------------- */

/**
 * Textes des presets de comportement sélectionnés par l'utilisateur.
 * Tenus ici (côté processus principal) pour que l'agent n'ait jamais à
 * connaître l'interface.
 */
const TEXTES_PRESETS = {
  concis: 'Sois concis. Va droit au but, sans préambule ni reformulation de la demande.',
  pedagogue: 'Explique étape par étape, avec des exemples concrets, et vérifie que c\'est compris.',
  code: 'Écris du code de qualité production : lisible, testé, sans dépendance inutile. Signale les cas limites.',
  critique: 'Sois critique : signale les risques, les oublis et les hypothèses fragiles avant de valider une idée.',
  creatif: 'Propose plusieurs pistes distinctes avant de converger. Privilégie les idées originales.',
  rigoureux: "Distingue clairement ce que tu sais de ce que tu supposes. Signale ton niveau de confiance."
};

function presetsActifs(cfg) {
  const ids = Array.isArray(cfg.presetsComportement) ? cfg.presetsComportement : [];
  return ids.map((id) => TEXTES_PRESETS[id]).filter(Boolean);
}

/* ------------------------------ IPC : GitHub --------------------------- */

ipcMain.handle('github:etat-auth', async () => {
  try {
    return await github.etatAuth();
  } catch (err) {
    return { connecte: false, ghPresent: false, message: String(err.message || err) };
  }
});

ipcMain.handle('github:connecter', async (_e, { token, protocole }) => {
  try {
    const etat = await github.connecter({ token, protocole });
    return { ok: true, ...etat };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('github:deconnecter', async () => {
  try {
    await github.deconnecter();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('github:lister-depots', async (_e, opts) => {
  try {
    return { ok: true, depots: await github.listerDepots(opts || {}) };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('github:choisir-dossier-clone', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Où cloner le dépôt ?',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Cloner ici'
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('github:cloner', async (_e, { nomComplet, dossierParent }) => {
  try {
    const r = await github.cloner({ nomComplet, dossierParent });
    // ouvre automatiquement le dépôt cloné comme espace de travail
    definirWorkspace(r.chemin);
    return { ok: true, ...r, workspace: r.chemin };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('github:creer-depot', async (_e, payload) => {
  try {
    const r = await github.creerDepot(payload || {});
    if (payload?.dossierLocal) definirWorkspace(payload.dossierLocal);
    return r;
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('github:etat-local', async (_e, chemin) => {
  try {
    return { ok: true, ...(await github.etatLocal(chemin || workspaceActif())) };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('github:historique', async (_e, chemin, opts) => {
  try {
    return { ok: true, commits: await github.historique(chemin || workspaceActif(), opts || {}) };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('github:difference', async (_e, chemin) => {
  try {
    return { ok: true, ...(await github.difference(chemin || workspaceActif())) };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('github:tirer', async (_e, chemin) => {
  try {
    return { ok: true, ...(await github.tirer(chemin || workspaceActif())) };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('github:envoyer', async (_e, chemin, payload) => {
  try {
    const r = await github.envoyer(chemin || workspaceActif(), payload || {});
    return { ok: r.ok, ...r };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('github:changer-branche', async (_e, chemin, nom, creer) => {
  try {
    return { ok: true, ...(await github.changerBranche(chemin || workspaceActif(), nom, { creer: Boolean(creer) })) };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('github:lister-pr', async (_e, depot, opts) => {
  try {
    return { ok: true, prs: await github.listerPR(depot, opts || {}) };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('github:infos-pr', async (_e, depot, numero) => {
  try {
    return { ok: true, pr: await github.infosPR(depot, numero) };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('github:creer-pr', async (_e, depot, payload) => {
  try {
    return { ok: true, ...(await github.creerPR(depot, payload || {})) };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('github:fusionner-pr', async (_e, depot, numero, methode) => {
  try {
    return { ok: true, ...(await github.fusionnerPR(depot, numero, { methode: methode || 'squash' })) };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('github:lister-issues', async (_e, depot, opts) => {
  try {
    return { ok: true, issues: await github.listerIssues(depot, opts || {}) };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('github:lister-runs', async (_e, depot, opts) => {
  try {
    return { ok: true, runs: await github.listerRuns(depot, opts || {}) };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('github:ouvrir-url', async (_e, url) => {
  if (!/^https?:\/\//.test(String(url || ''))) return { ok: false };
  await shell.openExternal(String(url));
  return { ok: true };
});

/* --------------------------- IPC : agent ------------------------------- */

ipcMain.handle('agent:envoyer', async (event, { historique, providerId, mode, modeles, resume }) => {
  const coffre = coffreActif();
  const cfg = config.getConfig({ revealKeys: true });
  const pid = providerId || cfg.activeProvider;
  const modeleSession = modeles?.[pid] || null;
  const creds = config.getProviderCredentials(pid, modeleSession);
  const modeEffectif = mode || cfg.mode || 'complet';

  if (!creds?.apiKey && !fournisseurSansCle(pid, creds)) {
    const msg = `Aucune clé d'API configurée pour « ${pid} ». Ouvre les réglages pour en ajouter une.`;
    event.sender.send('agent:evenement', { type: 'erreur', message: msg });
    return { ok: false, erreur: msg };
  }

  generationEnCours?.abort();
  generationEnCours = new AbortController();

  const emit = (evt) => {
    if (evt?.type === 'erreur') {
      journaliserAgent(`erreur · ${pid} · ${creds.model} · ${String(evt.message || '').slice(0, 300)}`);
    }
    if (!event.sender.isDestroyed()) event.sender.send('agent:evenement', evt);
  };

  const ctx = {
    mode: modeEffectif,
    resume: typeof resume === 'string' ? resume : '',
    vaultPath: coffre?.path || null,
    coffre,
    workspace: cfg.workspace || null,
    depotGithub: null,
    githubUtilisateur: null,
    systemPrompt: cfg.systemPrompt || '',
    outilsDesactives: Array.isArray(cfg.outilsDesactives) ? cfg.outilsDesactives : [],
    agentMaxTours: cfg.agent?.maxTours,
    appelsParalleles: cfg.agent?.appelsParalleles !== false,
    agentCapSortie: cfg.agent?.capSortie,
    rechercheWeb: cfg.rechercheWeb || {},
    serveursMCP: Array.isArray(cfg.serveursMCP) ? cfg.serveursMCP : [],
    memoire: obtenirMemoire(),
    presets: presetsActifs(cfg),
    temperature: typeof cfg.temperature === 'number' ? cfg.temperature : undefined,
    permissions: ctxPermissions(),
    onPlan: (taches) => emit({ type: 'plan', taches }),
    onDonnee: (flux) => { /* la sortie live passe par le résumé final */ },
    confirmer: (demande) => new Promise((resolve) => {
      const id = `conf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      confirmationsEnAttente.set(id, resolve);
      emit({ type: 'confirmation_demande', id, ...demande });
      // sécurité : refus automatique après 5 minutes
      setTimeout(() => {
        if (confirmationsEnAttente.has(id)) {
          confirmationsEnAttente.delete(id);
          resolve({ autorise: false, raison: 'délai dépassé' });
        }
      }, 300000);
    })
  };

  // enrichit le contexte avec les infos GitHub si le mode le justifie
  if (modeEffectif !== 'notes') {
    try {
      const etatDepot = await github.etatLocal(cfg.workspace);
      if (etatDepot.depot && etatDepot.nomComplet) ctx.depotGithub = etatDepot.nomComplet;
    } catch { /* pas un dépôt git */ }
    try {
      const auth = await github.etatAuth();
      if (auth.connecte && auth.utilisateur) ctx.githubUtilisateur = auth.utilisateur;
    } catch { /* gh indisponible */ }
  }

  try {
    const res = await agent.run({
      providerId: pid,
      credentials: creds,
      historique,
      ctx,
      emit,
      signal: generationEnCours.signal
    });
    journaliserAgent(
      `fin · ${pid} · ${creds.model} · ${res.erreur ? `erreur : ${String(res.erreur).slice(0, 200)}` : 'ok'}`
      + ` · ${res.outils || 0} outil(s) · ${res.texte ? res.texte.length : 0} car.`
    );
    if (config.getConfig().general?.notifications !== false
        && mainWindow && !mainWindow.isFocused()) {
      try {
        new Notification({
          title: 'Cerveau',
          body: res.erreur ? 'La requête s’est arrêtée.' : 'La réponse est prête.'
        }).show();
      } catch { /* pas de serveur de notification */ }
    }
    emit({ type: 'termine', ...res });
    return { ok: !res.erreur, ...res };
  } catch (err) {
    const msg = String(err?.message || err);
    emit({ type: 'erreur', message: msg });
    return { ok: false, erreur: msg };
  } finally {
    generationEnCours = null;
  }
});

ipcMain.handle('agent:arreter', () => {
  generationEnCours?.abort();
  generationEnCours = null;
  return { ok: true };
});

ipcMain.on('agent:reponse-confirmation', (_e, { id, autorise, raison }) => {
  const resolve = confirmationsEnAttente.get(id);
  if (resolve) {
    confirmationsEnAttente.delete(id);
    resolve({ autorise: Boolean(autorise), raison: raison || '' });
  }
});

/* ------------------------ IPC : utilitaires ---------------------------- */

/* ----------------------- intégration au bureau ------------------------- */

function dossierAutostart() {
  return path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    'autostart'
  );
}

function cheminAutostart() {
  return path.join(dossierAutostart(), 'cerveau.desktop');
}

function autostartActif() {
  try { return fs.existsSync(cheminAutostart()); } catch { return false; }
}

function definirAutostart(actif) {
  const fichier = cheminAutostart();
  try {
    if (actif) {
      fs.mkdirSync(dossierAutostart(), { recursive: true });
      const lanceur = fs.existsSync('/usr/bin/cerveau')
        ? '/usr/bin/cerveau'
        : `${process.execPath} ${app.getAppPath()}`;
      fs.writeFileSync(fichier, `[Desktop Entry]
Type=Application
Name=Cerveau
Comment=Assistant de bureau
Exec=${lanceur}
Terminal=false
X-GNOME-Autostart-enabled=true
`, { mode: 0o644 });
    } else if (fs.existsSync(fichier)) {
      fs.rmSync(fichier, { force: true });
    }
    return { ok: true, actif: autostartActif() };
  } catch (err) {
    return { ok: false, message: String(err.message || err), actif: autostartActif() };
  }
}

ipcMain.handle('app:autostart', () => ({ actif: autostartActif() }));
ipcMain.handle('app:definir-autostart', (_e, actif) => definirAutostart(Boolean(actif)));

ipcMain.handle('app:verifier-mise-a-jour', async () => {
  try {
    const reponse = await fetch(
      'https://api.github.com/repos/chimprookie-group/cerveau/releases/latest',
      {
        headers: { 'user-agent': 'cerveau', accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(8000)
      }
    );
    if (!reponse.ok) throw new Error(`GitHub ${reponse.status}`);
    const data = await reponse.json();
    const distante = String(data.tag_name || '').replace(/^v/, '');
    const actuelle = app.getVersion();
    const comparer = (a, b) => {
      const pa = String(a).split('.').map(Number);
      const pb = String(b).split('.').map(Number);
      for (let i = 0; i < 3; i += 1) {
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
      }
      return 0;
    };
    return {
      ok: true,
      actuelle,
      distante,
      aJour: comparer(distante, actuelle) <= 0,
      url: data.html_url || ''
    };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
});

ipcMain.handle('app:ouvrir-url', async (_e, url) => {
  if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false };
  await shell.openExternal(String(url));
  return { ok: true };
});

ipcMain.handle('app:infos', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome,
  plateforme: process.platform,
  configPath: config.CONFIG_FILE,
  dossierDonnees: app.getPath('userData'),
  dossierPersonnel: os.homedir()
}));

ipcMain.handle('app:ouvrir-dossier-config', async () => shell.openPath(config.APP_DIR));
ipcMain.handle('app:ouvrir-chemin', async (_e, p) => shell.openPath(p));

ipcMain.handle('app:exporter-conversation', async (_e, { titre, markdown }) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Exporter la conversation',
    defaultPath: `${(titre || 'conversation').replace(/[^\w\- ]+/g, '').slice(0, 60)}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (res.canceled || !res.filePath) return { ok: false };
  await fsp.writeFile(res.filePath, markdown, 'utf8');
  return { ok: true, chemin: res.filePath };
});

ipcMain.handle('app:exporter-vers-coffre', async (_e, { chemin, markdown }) => {
  const coffre = requireCoffre();
  const r = await obsidian.writeNote(coffre.path, chemin, markdown);
  return { ok: true, ...r };
});

/* --------------------------- IPC : tâches de fond ----------------------- */

tachesfond.gestionnaire.on('change', (tache) => {
  try { mainWindow?.webContents.send('taches:evenement', tache); } catch { /* fenêtre fermée */ }
});

ipcMain.handle('taches:lister', () => tachesfond.gestionnaire.lister());
ipcMain.handle('taches:sortie', (_e, id, depuis) => tachesfond.gestionnaire.sortir({ id, depuis }));
ipcMain.handle('taches:arreter', (_e, id) => {
  try { return tachesfond.gestionnaire.arreter(id); }
  catch (err) { return { ok: false, message: String(err.message || err) }; }
});

/* ------------------------------ cycle de vie --------------------------- */

const instanceUnique = app.requestSingleInstanceLock();
if (!instanceUnique) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // après whenReady, app.getPath('userData') est fiable
    migrerDonneesAnciennes();

    const cfg = config.getConfig();
    nativeTheme.themeSource = cfg.ui?.theme === 'clair' ? 'light' : 'dark';
    buildMenu();
    createWindow();

    // Fichier PID de l'application : le démon s'en sert pour lui céder la
    // place. Sans lui, les deux exécuteraient les mêmes tâches en double.
    try {
      const fPid = path.join(app.getPath('userData'), 'app.pid');
      require('node:fs').writeFileSync(fPid, String(process.pid), { mode: 0o600 });
      app.on('will-quit', () => {
        try {
          const f = path.join(app.getPath('userData'), 'app.pid');
          if (require('node:fs').readFileSync(f, 'utf8').trim() === String(process.pid)) {
            require('node:fs').unlinkSync(f);
          }
        } catch { /* déjà absent */ }
      });
    } catch { /* sans ce fichier, le démon fera le travail */ }

    // Le planificateur repart avec l'application : une tâche due pendant
    // l'absence s'exécute une fois, pas autant de fois qu'il y a eu d'heures.
    planifierProchainPassage();

    // Reprise du Superviseur s'il était en marche avant la fermeture.
    // Sans cela, l'utilisateur croit qu'il surveille toujours son dépôt.
    if (cfg.superviseur?.actif && cfg.superviseur?.depot
        && Array.isArray(cfg.superviseur.auteursAutorises)
        && cfg.superviseur.auteursAutorises.length) {
      try {
        obtenirSuperviseur().demarrer(contexteSuperviseur(cfg));
      } catch { /* le diagnostic reste visible dans les réglages */ }
    }

    // Actions du raccourci bureau : --new, --settings
    const args = process.argv.slice(1);
    const action = args.includes('--settings') ? 'reglages'
      : args.includes('--new') ? 'nouvelle-conversation'
      : null;
    if (action) {
      mainWindow?.webContents.once('did-finish-load', () => {
        setTimeout(() => mainWindow?.webContents.send('menu', action), 600);
      });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

// Arrêt propre des serveurs MCP : sans cela, leurs processus survivraient
// à la fermeture de Cerveau.
app.on('before-quit', () => {
  clearTimeout(minuteriePlanificateur);
  try { mcpGestionnaire.arreterTout(); } catch { /* ignore */ }
  try { superviseur?.arreter(); } catch { /* ignore */ }
});

app.on('will-quit', () => {
  try { mcpGestionnaire.arreterTout(); } catch { /* ignore */ }
  try { tachesfond.gestionnaire.arreterTout(); } catch { /* ignore */ }
});

// Filet de sécurité si le processus se termine brutalement
process.on('exit', () => {
  try { mcpGestionnaire.arreterTout(); } catch { /* ignore */ }
  try { tachesfond.gestionnaire.arreterTout(); } catch { /* ignore */ }
});

process.on('SIGINT', () => {
  try { mcpGestionnaire.arreterTout(); } catch { /* ignore */ }
  process.exit(0);
});

process.on('SIGTERM', () => {
  try { mcpGestionnaire.arreterTout(); } catch { /* ignore */ }
  process.exit(0);
});
