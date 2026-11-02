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

const PROTOCOLE = '2025-06-18';
const DELAI_INIT = 8000;
const DELAI_APPEL = 120000;

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
  async demarrer() {
    if (this.proc) return this;

    const commande = this.config.commande;
    if (!commande) throw new Error(`Serveur « ${this.nom} » : commande manquante.`);

    this.proc = spawn(commande, this.config.arguments || [], {
      cwd: this.config.repertoire || undefined,
      env: { ...process.env, ...(this.config.variablesEnv || {}) },
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

    const reponse = await this._envoyer('initialize', {
      protocolVersion: PROTOCOLE,
      capabilities: { roots: { listChanged: false } },
      clientInfo: { name: 'cerveau', version: '2.2.0' }
    }, DELAI_INIT, false);

    if (reponse?.error) {
      throw new Error(`« ${this.nom} » refuse l'initialisation : ${reponse.error.message}`);
    }

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

  /** Démarre tous les serveurs actifs et renvoie leurs outils agrégés. */
  async charger(configurations = []) {
    const actives = configurations.filter((c) => c.actif !== false && c.commande);

    // arrête les serveurs qui ne sont plus déclarés
    for (const [nom, serveur] of this.serveurs) {
      if (!actives.some((c) => c.nom === nom)) {
        serveur.arreter();
        this.serveurs.delete(nom);
        this.etats.delete(nom);
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
          serveur.demarrer(),
          new Promise((_, rej) => setTimeout(
            () => rej(new Error(`« ${config.nom} » n'a pas démarré en 10 s.`)), 10000))
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

module.exports = { gestionnaire, ServeurMCP, GestionnaireMCP };
