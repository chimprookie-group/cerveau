'use strict';

/**
 * Régénère les captures d'écran du README.
 *
 *   node scripts/captures.js
 *
 * Chaque capture est prise depuis l'application réelle, avec une configuration
 * de démonstration isolée : la configuration personnelle n'est jamais touchée.
 * Le rendu est fixé à 2400 × 1425 (fenêtre 1600 × 950, densité 1,5) pour que
 * les six images aient exactement la même taille.
 */

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const RACINE = path.join(__dirname, '..');
const SORTIE = path.join(RACINE, 'docs');

// ---- préparation d'un coffre de démonstration ----------------------------
function preparerCoffreDemo() {
  const coffre = path.join(os.tmpdir(), 'cerveau-coffre-demo');
  fs.rmSync(coffre, { recursive: true, force: true });
  fs.mkdirSync(path.join(coffre, 'Journal'), { recursive: true });
  fs.mkdirSync(path.join(coffre, 'Projets'), { recursive: true });

  const notes = {
    'Bienvenue.md': `---
tags: [cerveau, notes]
---

# Bienvenue dans Cerveau

Un assistant qui vit sur votre machine, avec vos notes sous la main.

## Ce qu'il sait faire

- Lire et écrire dans un coffre Obsidian
- Explorer un projet et lancer ses tests
- Chercher sur internet quand c'est utile

Voir aussi [[Projets/Refonte site]] et [[Journal/2026-11-04]].
`,
    'Projets/Refonte site.md': `---
tags: [projet, web]
---

# Refonte site

Migration vers un rendu statique, avec un budget de performance strict.

## Étapes

1. Inventaire des pages existantes
2. Choix du générateur
3. Reprise des contenus

Statut : **en cours**.
`,
    'Journal/2026-11-04.md': `---
tags: [journal]
---

# 2026-11-04

## Fait

- Audit complet de l'application
- Correction du partage de fichiers entre l'application et le démon

## À suivre

- Vérifier les tâches planifiées sur une journée entière
`,
    'Idées de projets.md': `---
tags: [idées]
---

# Idées de projets

- Un journal qui se remplit tout seul
- Un tableau de bord des dépôts

#idées #projet #journal #web
`
  };
  for (const [nom, contenu] of Object.entries(notes)) {
    const chemin = path.join(coffre, nom);
    fs.mkdirSync(path.dirname(chemin), { recursive: true });
    fs.writeFileSync(chemin, contenu);
  }
  return coffre;
}

// ---- configuration de démonstration --------------------------------------
function preparerConfigDemo(coffreDemo) {
  // Les captures montrent le dossier de configuration. Pour qu'il soit lisible
  // et fidèle à une installation réelle (~/.config/cerveau), on fabrique un HOME
  // de démonstration plutôt que d'afficher le chemin d'un dossier temporaire.
  const dossier = path.join(os.homedir(), '.cache', 'cerveau-captures');
  const appDir = path.join(dossier, 'cerveau');
  fs.mkdirSync(appDir, { recursive: true });

  const config = {
    version: 1,
    vaults: [{ id: 'demo', name: 'Coffre démo', path: coffreDemo }],
    activeVaultId: 'demo',
    providers: {
      anthropic: { apiKey: '', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5', modeles: [] },
      deepseek: { apiKey: '', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', modeles: [] },
      openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', modeles: [] },
      custom: {
        apiKey: 'aes:demo',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'deepseek-ai/deepseek-v4.1-flash-1017',
        modeles: [
          'deepseek-ai/deepseek-v4.1-flash-1017',
          'zai-org/glm-5.3-flash',
          'anthropic/claude-sonnet-4.5'
        ]
      }
    },
    activeProvider: 'custom',
    mode: 'complet',
    workspace: path.join(os.homedir(), 'Projects'),
    ui: { theme: 'cyber', fontScale: 1 },
    general: { verifierMajAuto: false, notifications: false, titresAuto: false },
    panneau: { style: 'cote', largeur: 400 },
    permissions: {
      mode: 'auto', allowDelete: false,
      autoCommandes: true, autoPush: false, autoGithub: false
    },
    rechercheWeb: { baseUrl: 'https://api.deepseek.com/v1/tools', cle: '', count: 8 },
    serveursMCP: [
      { nom: 'memory', commande: 'npx', arguments: ['-y', '@modelcontextprotocol/server-memory'], actif: true },
      { nom: 'git', commande: 'npx', arguments: ['-y', '@cyanheads/git-mcp-server'], actif: true },
      { nom: 'filesystem', commande: 'npx', arguments: ['-y', '@modelcontextprotocol/server-filesystem', path.join(os.homedir(), 'Documents')], actif: true },
      { nom: 'sqlite', commande: 'npx', arguments: ['-y', 'mcp-server-sqlite', '--db', path.join(os.homedir(), 'Documents', 'notes.db')], actif: true }
    ],
    agent: { maxTours: 25, appelsParalleles: true, delaiCommande: 120, capSortie: 60 },
    conversations: [
      {
        id: 'conv_demo',
        titre: 'Synthèse du coffre et plan de refonte',
        date: Date.now() - 3600_000,
        fournisseur: 'custom',
        messages: [
          { role: 'user', contenu: 'Fais-moi une synthèse de mes notes et propose un plan pour la refonte du site.' },
          {
            role: 'assistant',
            contenu: `**Synthèse.** Trois notes, deux projets actifs. La refonte du site
reste le sujet principal ; le budget de performance est la contrainte à garder
en tête.

**Plan proposé.**
1. Inventorier les pages existantes et leurs dépendances.
2. Choisir le générateur statique et figer la structure des URL.
3. Migrer les contenus, puis mesurer avant/après.

Je peux commencer par l'inventaire et créer une note de suivi.`
          }
        ]
      },
      { id: 'conv_sql', titre: 'Requêtes sur la base SQLite', date: Date.now() - 86_400_000, fournisseur: 'custom', messages: [{ role: 'user', contenu: 'Liste les tables.' }] },
      { id: 'conv_doc', titre: 'Génère la documentation de l’API', date: Date.now() - 172_800_000, fournisseur: 'custom', messages: [{ role: 'user', contenu: 'Écris la doc.' }] }
    ]
  };

  fs.writeFileSync(path.join(appDir, 'config.json'), JSON.stringify(config, null, 2), { mode: 0o600 });

  // Contenus de démonstration : une capture vide n'explique rien.
  const memoire = {
    version: 1,
    entrees: [
      { id: 'mem_1', texte: 'Préfère les réponses courtes, sans formule de politesse.',
        categorie: 'preference', creeLe: Date.now() - 86400000, majLe: Date.now() - 3600000, usage: 12, source: 'agent' },
      { id: 'mem_2', texte: 'Le projet Cerveau utilise Electron 45 et Node 26.',
        categorie: 'projet', creeLe: Date.now() - 172800000, majLe: Date.now() - 7200000, usage: 7, source: 'agent' },
      { id: 'mem_3', texte: 'Les commits suivent le format conventionnel : feat, fix, docs.',
        categorie: 'decision', creeLe: Date.now() - 259200000, majLe: Date.now() - 86400000, usage: 4, source: 'utilisateur' },
      { id: 'mem_4', texte: 'Le coffre Obsidian principal s’appelle Rookie Vault.',
        categorie: 'fait', creeLe: Date.now() - 345600000, majLe: Date.now() - 172800000, usage: 2, source: 'utilisateur' }
    ]
  };
  fs.writeFileSync(path.join(appDir, 'memoire.json'), JSON.stringify(memoire, null, 2), { mode: 0o600 });

  const objectifs = {
    version: 1,
    objectifs: [
      {
        id: 'obj_1', titre: 'Migrer le projet vers TypeScript',
        description: 'Convertir les fichiers .js en .ts, module par module.',
        critere: 'Plus aucun fichier .js dans electron/', etat: 'actif',
        creeLe: Date.now() - 259200000, majLe: Date.now() - 3600000,
        tours: 7, maxTours: 20, prochainPas: 'Convertir electron/mcp.js', blocage: null,
        historique: [
          { tour: 6, quand: Date.now() - 7200000, resume: 'agent.js et codetools.js convertis, tests verts.', ok: true },
          { tour: 7, quand: Date.now() - 3600000, resume: 'config.js converti, 12 erreurs de typage corrigées.', ok: true }
        ]
      },
      {
        id: 'obj_2', titre: 'Écrire la documentation de l’API',
        description: 'Un fichier Markdown par module, avec exemples.',
        critere: 'Les 18 modules sont documentés', etat: 'termine',
        creeLe: Date.now() - 864000000, majLe: Date.now() - 86400000,
        tours: 12, maxTours: 20, prochainPas: '', blocage: null,
        historique: [{ tour: 12, quand: Date.now() - 86400000, resume: 'Dernier module documenté, relecture faite.', ok: true }]
      }
    ]
  };
  fs.writeFileSync(path.join(appDir, 'objectifs.json'), JSON.stringify(objectifs, null, 2), { mode: 0o600 });

  const planificateur = {
    version: 1,
    taches: [
      {
        id: 'tache_1', nom: 'Résumé des issues', niveau: 'lecture',
        consigne: 'Résume les nouvelles issues du dépôt et signale celles qui bloquent.',
        objectifId: null, intervalle: 1, echelle: 'jours', actif: true,
        creeLe: Date.now() - 604800000, majLe: Date.now() - 3600000,
        prochaineEcheance: Date.now() + 50400000, derniereExecution: Date.now() - 3600000,
        executions: 14, echecsConsecutifs: 0, maxToursTotal: 1,
        historique: [{ quand: Date.now() - 3600000, ok: true, resume: '3 nouvelles issues, aucune bloquante.', erreur: null }]
      },
      {
        id: 'tache_2', nom: 'Vérifier les tests', niveau: 'commandes',
        consigne: 'Lance npm test et signale les échecs.',
        objectifId: null, intervalle: 6, echelle: 'heures', actif: true,
        creeLe: Date.now() - 432000000, majLe: Date.now() - 7200000,
        prochaineEcheance: Date.now() + 14400000, derniereExecution: Date.now() - 7200000,
        executions: 38, echecsConsecutifs: 0, maxToursTotal: 1,
        historique: [{ quand: Date.now() - 7200000, ok: true, resume: '365 tests, tous verts.', erreur: null }]
      }
    ]
  };
  fs.writeFileSync(path.join(appDir, 'planificateur.json'), JSON.stringify(planificateur, null, 2), { mode: 0o600 });

  return dossier;
}

// ---- capture -------------------------------------------------------------
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function capture(win, nom) {
  await pause(700);
  const image = await win.webContents.capturePage();
  const chemin = path.join(SORTIE, nom);
  fs.writeFileSync(chemin, image.toPNG());
  const taille = fs.statSync(chemin).size;
  console.log(`✓ ${nom} — ${Math.round(taille / 1024)} Ko`);
}

async function principal() {
  fs.mkdirSync(SORTIE, { recursive: true });
  const coffre = preparerCoffreDemo();
  const dossierConfig = preparerConfigDemo(coffre);

  // Les captures montrent le dossier de configuration : on lui donne un chemin
  // lisible plutôt qu'un dossier temporaire, sans toucher au vrai.
  process.env.XDG_CONFIG_HOME = dossierConfig;

  // le module principal lit la config au chargement : on l'appelle après
  require(path.join(RACINE, 'electron', 'main.js'));

  await app.whenReady();
  await pause(3800);

  const win = BrowserWindow.getAllWindows()[0];
  win.setContentSize(1600, 950);
  await pause(2600);

  const ui = async (code) => win.webContents.executeJavaScript(code);

  // 1. accueil : une conversation ouverte, le panneau de notes à droite
  await ui(`(async () => {
    const ui = window.cerveauUI;
    const conv = ui.etat.conversations.find((c) => c.id === 'conv_demo');
    if (conv) { ui.etat.conversationCourante = conv; ui.afficherConversation(); }
    await ui.rafraichirCoffre();
    await ui.ouvrirNote('Bienvenue.md');
    document.querySelector('#listeConversations')?.scrollTo(0, 0);
    return true;
  })()`);
  await pause(900);
  await capture(win, '01-accueil.png');

  // 2. une note ouverte dans le panneau de droite
  await ui(`(async () => {
    const ui = window.cerveauUI;
    await ui.ouvrirNote('Projets/Refonte site.md');
    return true;
  })()`);
  await pause(1100);
  await capture(win, '02-note.png');

  // 3. le sélecteur de modèle ouvert
  await ui(`(async () => {
    const b = document.querySelector('#declencheurModele') || document.querySelector('.declencheur-modele');
    if (b) b.click();
    return true;
  })()`);
  await pause(900);
  await capture(win, '03-modeles.png');
  await ui(`document.body.click()`);
  await pause(400);

  // 4. réglages — général
  await ui(`(async () => {
    window.cerveauUI.ouvrirReglages('general');
    await new Promise((r) => setTimeout(r, 400));
    // le vrai chemin pointe vers un dossier de travail : on affiche celui
    // qu'aurait une installation normale, pour une capture lisible.
    const champ = document.querySelector('#reglageCheminConfig');
    if (champ) champ.textContent = '~/.config/cerveau/config.json';
    return true;
  })()`);
  await pause(1100);
  await capture(win, '04-reglages.png');

  // 5. agent et outils
  await ui(`(async () => {
    document.querySelector('.nav-reglage[data-reglage="agents"]').click();
    return true;
  })()`);
  await pause(1000);
  await capture(win, '05-outils.png');

  // 6. plugins et web — le nouveau tableau MCP
  await ui(`(async () => {
    document.querySelector('.nav-reglage[data-reglage="plugins"]').click();
    await new Promise((r) => setTimeout(r, 700));
    const zone = document.querySelector('.reglages-contenu');
    if (zone) zone.scrollTop = 0;
    return true;
  })()`);
  await pause(1100);
  await capture(win, '06-plugins.png');

  // 7. mémoire de long terme
  await ui(`(async () => {
    document.querySelector('.nav-reglage[data-reglage="memoire"]').click();
    await new Promise((r) => setTimeout(r, 600));
    return true;
  })()`);
  await pause(900);
  await capture(win, '07-memoire.png');

  // 8. objectifs et tâches planifiées
  await ui(`(async () => {
    document.querySelector('.nav-reglage[data-reglage="objectifs"]').click();
    await new Promise((r) => setTimeout(r, 600));
    return true;
  })()`);
  await pause(900);
  await capture(win, '08-objectifs.png');

  await ui(`(async () => {
    document.querySelector('.nav-reglage[data-reglage="planification"]').click();
    await new Promise((r) => setTimeout(r, 600));
    return true;
  })()`);
  await pause(900);
  await capture(win, '09-taches.png');

  fs.rmSync(coffre, { recursive: true, force: true });
  fs.rmSync(dossierConfig, { recursive: true, force: true });

  app.exit(0);
}

principal().catch((err) => {
  console.error('Échec des captures :', err);
  app.exit(1);
});
