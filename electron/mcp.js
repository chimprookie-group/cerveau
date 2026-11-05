'use strict';

/**
 * Serveurs MCP (Model Context Protocol).
 *
 * Permet de brancher des outils externes à Cerveau : filesystem, git, bases de
 * données, navigateur, services web… Chaque serveur est un processus lancé par
 * Cerveau et piloté en JSON-RPC 2.0 sur son entrée/sortie standard.
 *
 * Protocole implémenté (sous-ensemble stable) :
 *   initialize → tools/list → tools/call
 *
 * Un serveur se déclare ainsi dans la configuration :
 *   { nom, commande, arguments: [], variablesEnv: {}, actif: true }
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const PROTOCOLE = '2025-06-18';
const DELAI_INIT = 20000;      // premier « npx » : le paquet peut être à télécharger
const DELAI_APPEL = 120000;

let VERSION_APP = '0';
try { VERSION_APP = require('../package.json').version; } catch { /* version inconnue */ }

/**
 * Dossiers où chercher une commande. Le PATH d'une application lancée depuis
 * le menu n'est pas celui d'un terminal : mise, nvm ou asdf n'y sont pas
 * toujours. On complète donc avec les emplacements usuels.
 */
function dossiersExecutables() {
  const perso = os.homedir();
  const liste = [];

  for (const dossier of String(process.env.PATH || '').split(':')) {
    if (dossier) liste.push(dossier);
  }

  const mise = path.join(perso, '.local', 'share', 'mise');
  liste.push(
    path.join(mise, 'shims'),
    path.join(mise, 'command-wrappers', 'bin'),
    path.join(mise, 'installs', 'node', 'latest', 'bin'),
    path.join(perso, '.local', 'bin'),
    '/usr/local/bin', '/usr/bin', '/bin', '/snap/bin'
  );

  // toutes les versions de Node installées par mise (latest n'est qu'un lien)
  try {
    const base = path.join(mise, 'installs', 'node');
    for (const version of fs.readdirSync(base)) {
      liste.push(path.join(base, version, 'bin'));
    }
  } catch { /* mise absent */ }

  return [...new Set(liste.filter(Boolean))];
}

/** Résout « npx », « node »… en chemin absolu, même hors du PATH du lanceur. */
function resoudreCommande(commande) {
  const brute = String(commande || '').trim();
  if (!brute) return null;
  if (path.isAbsolute(brute)) {
    try { return fs.statSync(brute).isFile() ? brute : null; } catch { return null; }
  }
  if (brute.includes('/')) return null;   // chemin relatif : laissé tel quel

  for (const dossier of dossiersExecutables()) {
    const cible = path.join(dossier, brute);
    try {
      if (fs.statSync(cible).isFile()) return cible;
    } catch { /* dossier suivant */ }
  }
  return null;
}

/** Environnement du serveur, avec un PATH enrichi pour « npx » et son shebang. */
function environnementServeur(extra = {}) {
  const env = { ...process.env, ...extra };
  const chemins = [...dossiersExecutables(), ...String(env.PATH || '').split(':')];
  env.PATH = [...new Set(chemins.filter(Boolean))].join(':');
  return env;
}

/* ----------------------------- un serveur ------------------------------- */

class ServeurMCP {
  constructor(config) {
    this.config = config;
    this.nom = config.nom;
    this.proc = null;
    this.tampon = '';
    this.enAttente = new Map();
    this.prochainId = 1;
    this.outils = [];
    this.initialise = false;
    this.erreur = null;
    this.stderr = '';
    // Échec survenu avant qu'une requête ne s'enregistre (spawn ENOENT, mort
    // immédiate) : rejoué pour toute requête suivante, sinon elle attendrait
    // indéfiniment la réponse d'un processus qui n'existe pas.
    this.echecDemarrage = null;
  }

  /** Démarre le processus et négocie le protocole. */
  async demarrer({ delai = DELAI_INIT } = {}) {
    if (this.proc) return this;

    const demandee = this.config.commande;
    if (!demandee) throw new Error(`Serveur « ${this.nom} » : commande manquante.`);

    // Résout la commande hors du PATH du lanceur (mise, nvm, /usr/local/bin…).
    const commande = resoudreCommande(demandee);
    if (!commande) {
      throw new Error(
        `Serveur « ${this.nom} » : commande « ${demandee} » introuvable. `
        + 'Installe Node.js (npx) ou indique le chemin complet de la commande. '
        + `Cherché dans : ${dossiersExecutables().slice(0, 8).join(', ')}…`
      );
    }

    this.proc = spawn(commande, this.config.arguments || [], {
      cwd: this.config.repertoire || undefined,
      env: environnementServeur(this.config.variablesEnv || {}),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.proc.stdout.on('data', (d) => this._recevoir(d.toString()));
    this.proc.stderr.on('data', (d) => {
      this.stderr = (this.stderr + d.toString()).slice(-4000);
    });
    this.proc.on('error', (err) => {
      this.erreur = err.message;
      const echec = new Error(`Serveur « ${this.nom} » : ${err.message}`);
      if (!this.initialise) this.echecDemarrage = echec;
      this._rejeterTout(echec);
    });
    this.proc.on('exit', (code) => {
      // Un code de sortie seul n'aide personne : on joint la sortie d'erreur
      // du serveur et, si le paquet est absent, une piste concrète.
      const detail = this.stderr.trim().split('\n').filter(Boolean).slice(-4).join(' | ');
      const piste = /404|not found|ENOENT|command not found/i.test(this.stderr)
        ? ' — le paquet ou la commande est introuvable (vérifiez le nom sur npm)'
        : '';
      const echec = new Error(
        `Serveur « ${this.nom} » arrêté (code ${code})${piste}`
        + (detail ? ` : ${detail.slice(0, 300)}` : '')
      );
      if (!this.initialise && !this.echecDemarrage) this.echecDemarrage = echec;
      this._rejeterTout(echec);
      this.proc = null;
      this.initialise = false;
    });

    // « initialize » est une vraie requête (avec id) : sans identifiant, les
    // serveurs conformes la traitent comme une notification et refusent
    // ensuite « tools/list » (« Server not initialized »).
    const reponse = await this._envoyer('initialize', {
      protocolVersion: PROTOCOLE,
      capabilities: { roots: { listChanged: false } },
      clientInfo: { name: 'cerveau', version: VERSION_APP }
    }, delai);

    if (reponse?.error) {
      throw new Error(`« ${this.nom} » refuse l'initialisation : ${reponse.error.message}`);
    }
    if (!reponse?.result) {
      throw new Error(`« ${this.nom} » n'a pas répondu à l'initialisation.`);
    }

    // on accepte la version négociée par le serveur
    this.protocole = reponse.result.protocolVersion || PROTOCOLE;

    // notification obligatoire après l'initialisation
    this._notifier('notifications/initialized', {});
    this.initialise = true;

    await this.chargerOutils();
    return this;
  }

  /** Récupère la liste des outils exposés. */
  async chargerOutils() {
    const r = await this._envoyer('tools/list', {});
    if (r?.error) throw new Error(`« ${this.nom} » : ${r.error.message}`);
    this.outils = (r?.result?.tools || []).map((t) => ({
      nom: t.name,
      description: t.description || '',
      schema: t.inputSchema || { type: 'object', properties: {} }
    }));
    return this.outils;
  }

  /** Appelle un outil et renvoie son résultat sous forme de texte. */
  async appeler(nomOutil, args) {
    if (!this.initialise) await this.demarrer();
    const r = await this._envoyer('tools/call', {
      name: nomOutil,
      arguments: args || {}
    }, DELAI_APPEL);

    if (r?.error) throw new Error(r.error.message || 'Erreur MCP');

    const contenu = r?.result?.content;
    if (Array.isArray(contenu)) {
      const morceaux = contenu.map((c) => {
        if (c.type === 'text') return c.text;
        if (c.type === 'resource') return `[ressource] ${c.resource?.text || c.resource?.uri || ''}`;
        if (c.type === 'image') return `[image ${c.mimeType || ''}]`;
        return JSON.stringify(c);
      });
      return morceaux.join('\n');
    }
    return JSON.stringify(r?.result ?? null).slice(0, 20000);
  }

  arreter() {
    try { this.proc?.kill('SIGTERM'); } catch { /* ignore */ }
    setTimeout(() => { try { this.proc?.kill('SIGKILL'); } catch { /* ignore */ } }, 2000);
    this.proc = null;
    this.initialise = false;
  }

  /* ------------------------ transport JSON-RPC ------------------------ */

  _recevoir(morceau) {
    this.tampon += morceau;
    // les messages sont délimités par des retours à la ligne
    let index;
    while ((index = this.tampon.indexOf('\n')) !== -1) {
      const ligne = this.tampon.slice(0, index).trim();
      this.tampon = this.tampon.slice(index + 1);
      if (!ligne) continue;
      let msg;
      try { msg = JSON.parse(ligne); } catch { continue; }
      this._traiter(msg);
    }
  }

  _traiter(msg) {
    if (msg.id !== undefined && this.enAttente.has(msg.id)) {
      const { resolve, reject, minuteur } = this.enAttente.get(msg.id);
      clearTimeout(minuteur);
      this.enAttente.delete(msg.id);
      if (msg.error) resolve({ error: msg.error });
      else resolve({ result: msg.result });
    }
  }

  _envoyer(methode, params, delai = 60000, avecId = true) {
    // si le serveur n'a jamais pu démarrer, on échoue immédiatement
    if (this.echecDemarrage && !this.initialise) return Promise.reject(this.echecDemarrage);
    if (!this.proc || this.proc.pid === undefined) {
      const err = new Error(`Serveur « ${this.nom} » : processus indisponible.`);
      this.echecDemarrage = this.echecDemarrage || err;
      return Promise.reject(err);
    }

    const id = avecId ? this.prochainId++ : undefined;
    const message = { jsonrpc: '2.0', method: methode, params: params || {} };
    if (avecId) message.id = id;

    return new Promise((resolve, reject) => {
      const minuteur = setTimeout(() => {
        this.enAttente.delete(id);
        reject(new Error(`« ${this.nom} » n'a pas répondu à « ${methode} » en ${Math.round(delai / 1000)} s.`));
      }, delai);

      if (avecId) this.enAttente.set(id, { resolve, reject, minuteur });

      try {
        this.proc.stdin.write(`${JSON.stringify(message)}\n`);
        if (!avecId) { clearTimeout(minuteur); resolve(null); }
      } catch (err) {
        clearTimeout(minuteur);
        if (avecId) this.enAttente.delete(id);
        reject(err);
      }
    });
  }

  _notifier(methode, params) {
    if (!this.proc) return;
    try {
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: methode, params })}\n`);
    } catch { /* ignore */ }
  }

  _rejeterTout(err) {
    for (const { reject, minuteur } of this.enAttente.values()) {
      clearTimeout(minuteur);
      reject(err);
    }
    this.enAttente.clear();
  }
}

/* ---------------------------- gestionnaire ------------------------------ */

class GestionnaireMCP {
  constructor() {
    /** @type {Map<string, ServeurMCP>} */
    this.serveurs = new Map();
    this.etats = new Map();
  }

  /**
   * Démarre des serveurs et renvoie leurs outils agrégés.
   *
   * @param {Array} configurations
   * @param {{ partiel?: boolean, delai?: number }} opts
   *   partiel : ne pas arrêter les serveurs absents de la liste (test ou
   *   consultation d'un seul serveur, sans couper les autres).
   */
  async charger(configurations = [], { partiel = false, delai = DELAI_INIT } = {}) {
    const actives = configurations.filter((c) => c.actif !== false && c.commande);

    // arrête les serveurs qui ne sont plus déclarés (chargement complet seulement)
    if (!partiel) {
      for (const [nom, serveur] of this.serveurs) {
        if (!actives.some((c) => c.nom === nom)) {
          serveur.arreter();
          this.serveurs.delete(nom);
          this.etats.delete(nom);
        }
      }
    }

    // Démarrage en parallèle : un serveur lent ne retarde pas les autres.
    const resultats = await Promise.all(actives.map(async (config) => {
      try {
        let serveur = this.serveurs.get(config.nom);
        if (!serveur || JSON.stringify(serveur.config) !== JSON.stringify(config)) {
          serveur?.arreter();
          serveur = new ServeurMCP(config);
          this.serveurs.set(config.nom, serveur);
        }

        // garde-fou : un serveur qui ne répond pas ne doit jamais bloquer
        // l'envoi d'un message par l'utilisateur
        await Promise.race([
          serveur.demarrer({ delai }),
          new Promise((_, rej) => setTimeout(
            () => rej(new Error(`« ${config.nom} » n'a pas démarré en ${Math.round(delai / 1000)} s.`
              + ' Au premier lancement, « npx » télécharge le paquet : vérifie la connexion.')),
            delai + 3000))
        ]);

        this.etats.set(config.nom, { ok: true, outils: serveur.outils.length, erreur: null });

        return serveur.outils.map((o) => ({
          // préfixé pour éviter les collisions entre serveurs
          nom: `mcp_${sanitize(config.nom)}_${sanitize(o.nom)}`,
          nomOriginal: o.nom,
          serveur: config.nom,
          description: `[${config.nom}] ${o.description}`,
          schema: o.schema,
          risque: config.risque || 'ecriture',
          executer: async (args) => serveur.appeler(o.nom, args)
        }));
      } catch (err) {
        this.etats.set(config.nom, { ok: false, outils: 0, erreur: String(err.message || err) });
        return [];
      }
    }));

    const outils = resultats.flat();
    return outils;
  }

  /** État de chaque serveur, pour l'interface. */
  /**
   * Outils exposés par un serveur donné.
   * Un serveur non démarré renvoie une liste vide : c'est à l'appelant de
   * décider s'il faut le lancer d'abord.
   */
  outilsDuServeur(nom) {
    const serveur = this.serveurs.get(nom);
    if (!serveur || !Array.isArray(serveur.outils)) return [];
    return serveur.outils.map((o) => ({
      nom: o.nom || o.name,
      description: o.description || ''
    }));
  }

  etatsServeurs() {
    const sortie = {};
    for (const [nom, etat] of this.etats) {
      const serveur = this.serveurs.get(nom);
      sortie[nom] = {
        ...etat,
        // sortie d'erreur du processus, utile au diagnostic
        stderr: serveur ? serveur.stderr.trim().split('\n').filter(Boolean).slice(-5).join(' | ') : ''
      };
    }
    for (const [nom, serveur] of this.serveurs) {
      if (sortie[nom]) continue;
      sortie[nom] = {
        ok: serveur.initialise,
        outils: serveur.outils.length,
        erreur: serveur.erreur,
        stderr: serveur.stderr.trim().split('\n').filter(Boolean).slice(-5).join(' | ')
      };
    }
    return sortie;
  }

  arreterTout() {
    for (const s of this.serveurs.values()) s.arreter();
    this.serveurs.clear();
    this.etats.clear();
  }
}

function sanitize(nom) {
  return String(nom).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
}

const gestionnaire = new GestionnaireMCP();

module.exports = { gestionnaire, ServeurMCP, GestionnaireMCP, resoudreCommande, dossiersExecutables };
