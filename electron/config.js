'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

/**
 * Stockage de configuration pour Cerveau.
 * - Fichier JSON dans ~/.config/cerveau/config.json (ou $XDG_CONFIG_HOME)
 * - Les clés d'API sont chiffrées via Electron safeStorage quand disponible,
 *   sinon via un chiffrement AES-256-GCM dérivé de la machine (repli explicite).
 */

const APP_DIR = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'cerveau'
);

const CONFIG_FILE = path.join(APP_DIR, 'config.json');

const DEFAULTS = {
  version: 1,
  vaults: [], // [{ id, name, path }]
  activeVaultId: null,
  providers: {
    anthropic: { apiKey: '', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5', modeles: [] },
    deepseek: { apiKey: '', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', modeles: [] },
    openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', modeles: [] },
    custom: { apiKey: '', baseUrl: '', model: '', modeles: [] }
  },
  activeProvider: 'anthropic',
  workspace: null,           // dossier de travail pour le mode Code
  workspacesRecents: [],     // [{ path, name, date }]
  mode: 'complet',           // 'notes' | 'code' | 'complet'
  permissions: {
    // 'demander' | 'auto' | 'lecture'
    mode: 'demander',
    allowDelete: false,
    autoCommandes: true,     // en mode auto, exécuter les commandes sans demander
    autoPush: false,         // en mode auto, autoriser git push sans demander
    autoGithub: false        // en mode auto, autoriser PR/issues sans demander
  },
  ui: {
    theme: 'sombre',
    fontScale: 1,
    sidebarOpen: true,
    obsidianPanelOpen: true
  },
  conversations: [], // historique léger (id, titre, date, messages)
  systemPrompt: '',
  presetsComportement: [],
  temperature: 0.7,
  // disposition du panneau latéral : « cote » (pousse) ou « superpose »
  panneau: { style: 'cote', largeur: 400 },
  // réglages avancés
  general: {
    modeDemarrage: 'complet',
    panneauOuvert: true,
    restaurerDerniere: false,
    historiqueMax: 200
  },
  agent: {
    maxTours: 25,
    appelsParalleles: true,
    delaiCommande: 120,
    capSortie: 60
  },
  outilsDesactives: [],
  // recherche web : 'duckduckgo' (sans clé) ou 'fournisseur'
  rechercheWeb: { moteur: 'duckduckgo', urlBase: '', cle: '' },
  // serveurs MCP : [{ nom, commande, arguments: [], variablesEnv: {}, actif }]
  serveursMCP: []
};

let cache = null;

function ensureDir() {
  fs.mkdirSync(APP_DIR, { recursive: true, mode: 0o700 });
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override ?? base;
  if (typeof base !== 'object' || base === null) return override ?? base;
  if (typeof override !== 'object' || override === null) return base;
  const out = { ...base };
  for (const k of Object.keys(override)) {
    out[k] = deepMerge(base[k], override[k]);
  }
  return out;
}

function load() {
  if (cache) return cache;
  ensureDir();
  let raw = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (err) {
    // config corrompue : on la sauvegarde et on repart sur les défauts
    try {
      fs.copyFileSync(CONFIG_FILE, `${CONFIG_FILE}.corrompu.${Date.now()}`);
    } catch { /* ignore */ }
    raw = {};
  }
  cache = deepMerge(structuredClone(DEFAULTS), raw);
  return cache;
}

function save() {
  ensureDir();
  const tmp = `${CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_FILE);
  try { fs.chmodSync(CONFIG_FILE, 0o600); } catch { /* ignore */ }
}

/* ------------------------- chiffrement des clés ------------------------- */

function machineKey() {
  // Clé déterministe par machine + utilisateur, pour le repli hors safeStorage.
  const seed = [
    os.hostname(),
    os.userInfo().username,
    os.homedir(),
    'cerveau-v1'
  ].join('|');
  return crypto.createHash('sha256').update(seed).digest();
}

function encryptSecret(plain) {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', machineKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `aes:${Buffer.concat([iv, tag, enc]).toString('base64')}`;
}

function decryptSecret(payload) {
  if (!payload) return '';
  if (!String(payload).startsWith('aes:')) return String(payload);
  try {
    const buf = Buffer.from(String(payload).slice(4), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', machineKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/* ------------------------------ API publique ---------------------------- */

function getConfig({ revealKeys = false } = {}) {
  const cfg = load();
  const clone = structuredClone(cfg);
  for (const id of Object.keys(clone.providers || {})) {
    const key = clone.providers[id].apiKey;
    if (!revealKeys) {
      clone.providers[id].apiKey = key ? '••••••••••••' : '';
      clone.providers[id].hasKey = Boolean(key);
    } else {
      clone.providers[id].apiKey = decryptSecret(key);
    }
  }
  clone.configPath = CONFIG_FILE;
  return clone;
}

function updateConfig(patch) {
  const cfg = load();
  // Les clés d'API en clair venant du renderer sont re-chiffrées.
  if (patch.providers && typeof patch.providers === 'object') {
    for (const id of Object.keys(patch.providers)) {
      const p = patch.providers[id];
      if (!p || typeof p !== 'object') continue;
      if (typeof p.apiKey === 'string') {
        if (p.apiKey === '••••••••••••') delete p.apiKey; // inchangé
        else if (p.apiKey === '') p.apiKey = '';
        else p.apiKey = encryptSecret(p.apiKey);
      }
      delete p.hasKey;
    }
  }
  const merged = deepMerge(cfg, patch);
  cache = merged;
  save();
  return getConfig();
}

function getProviderCredentials(id, modeleChoisi = null) {
  const cfg = load();
  const p = cfg.providers?.[id];
  if (!p) return null;
  const defaut = p.model || (Array.isArray(p.modeles) && p.modeles[0]) || '';
  return {
    id,
    apiKey: decryptSecret(p.apiKey),
    baseUrl: p.baseUrl,
    // un modèle choisi pour la session prime sur le modèle par défaut
    model: modeleChoisi || defaut
  };
}

function resetConfig() {
  cache = structuredClone(DEFAULTS);
  save();
  return getConfig();
}

module.exports = {
  APP_DIR,
  CONFIG_FILE,
  DEFAULTS,
  load,
  save,
  getConfig,
  updateConfig,
  getProviderCredentials,
  resetConfig,
  encryptSecret,
  decryptSecret
};
