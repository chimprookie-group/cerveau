'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const path = require('node:path');
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
const { gestionnaire: mcpGestionnaire } = require('./mcp');
const { Superviseur } = require('./superviseur');

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

ipcMain.handle('providers:tester', async (_e, id, modeleChoisi) => {
  const creds = config.getProviderCredentials(id, modeleChoisi);
  if (!creds?.apiKey) return { ok: false, message: "Aucune clé d'API enregistrée." };
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

  // ZIMREAPER, s'il est installé
  const cheminsZim = [
    path.join(os.homedir(), 'Applications', 'ZimReaper-0.1.0-x86_64.AppImage'),
    path.join(os.homedir(), '.local', 'bin', 'zimreaper')
  ];
  const zim = cheminsZim.find((p) => { try { return require('node:fs').existsSync(p); } catch { return false; } });

  const outils = [
    { id: 'git', nom: 'Git', present: git.present, version: git.version,
      requis: true, paquet: 'git', usage: 'Projets, commits, différences' },
    { id: 'gh', nom: 'GitHub CLI', present: gh.present, version: gh.version,
      requis: true, paquet: 'github-cli', usage: 'Onglet Dépôt, pull requests, Superviseur' },
    { id: 'node', nom: 'Node.js', present: node.present, version: node.version,
      requis: true, paquet: 'nodejs', usage: 'Serveurs MCP (git, sqlite, mémoire…)' },
    { id: 'npm', nom: 'npm', present: npm.present, version: npm.version,
      requis: true, paquet: 'npm', usage: 'Installation des serveurs MCP via npx' },
    { id: 'zimreaper', nom: 'ZIMREAPER', present: Boolean(zim), version: zim ? 'installé' : null,
      requis: false, paquet: null, chemin: zim || null,
      usage: 'Navigateur piloté par l’agent (21 outils)' }
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
        permissions: params.permissions,
        confirmer: params.confirmer,
        outilsDesactives: cfg.outilsDesactives || [],
        agentMaxTours: cfg.agent?.maxTours,
        agentCapSortie: cfg.agent?.capSortie
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

      const outils = await mcpGestionnaire.charger([cible]);
      const etat = mcpGestionnaire.etatsServeurs()[nom];
      return {
        ok: Boolean(etat?.ok) && outils.length > 0,
        outils: outils.length,
        etats: mcpGestionnaire.etatsServeurs()
      };
    }

    const outils = await mcpGestionnaire.charger(serveurs);
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

ipcMain.handle('agent:envoyer', async (event, { historique, providerId, mode, modeles }) => {
  const coffre = coffreActif();
  const cfg = config.getConfig({ revealKeys: true });
  const pid = providerId || cfg.activeProvider;
  const modeleSession = modeles?.[pid] || null;
  const creds = config.getProviderCredentials(pid, modeleSession);
  const modeEffectif = mode || cfg.mode || 'complet';

  if (!creds?.apiKey) {
    const msg = `Aucune clé d'API configurée pour « ${pid} ». Ouvre les réglages pour en ajouter une.`;
    event.sender.send('agent:evenement', { type: 'erreur', message: msg });
    return { ok: false, erreur: msg };
  }

  generationEnCours?.abort();
  generationEnCours = new AbortController();

  const emit = (evt) => {
    if (!event.sender.isDestroyed()) event.sender.send('agent:evenement', evt);
  };

  const ctx = {
    mode: modeEffectif,
    vaultPath: coffre?.path || null,
    coffre,
    workspace: cfg.workspace || null,
    depotGithub: null,
    githubUtilisateur: null,
    systemPrompt: cfg.systemPrompt || '',
    outilsDesactives: Array.isArray(cfg.outilsDesactives) ? cfg.outilsDesactives : [],
    agentMaxTours: cfg.agent?.maxTours,
    agentCapSortie: cfg.agent?.capSortie,
    rechercheWeb: cfg.rechercheWeb || {},
    serveursMCP: Array.isArray(cfg.serveursMCP) ? cfg.serveursMCP : [],
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
    const cfg = config.getConfig();
    nativeTheme.themeSource = cfg.ui?.theme === 'clair' ? 'light' : 'dark';
    buildMenu();
    createWindow();

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
  try { mcpGestionnaire.arreterTout(); } catch { /* ignore */ }
  try { superviseur?.arreter(); } catch { /* ignore */ }
});

app.on('will-quit', () => {
  try { mcpGestionnaire.arreterTout(); } catch { /* ignore */ }
});

// Filet de sécurité si le processus se termine brutalement
process.on('exit', () => {
  try { mcpGestionnaire.arreterTout(); } catch { /* ignore */ }
});

process.on('SIGINT', () => {
  try { mcpGestionnaire.arreterTout(); } catch { /* ignore */ }
  process.exit(0);
});

process.on('SIGTERM', () => {
  try { mcpGestionnaire.arreterTout(); } catch { /* ignore */ }
  process.exit(0);
});
