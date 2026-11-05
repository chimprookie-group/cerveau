'use strict';

/**
 * Processus en arrière-plan pilotés par l'agent.
 *
 * Un serveur de développement, une suite de tests ou un build peuvent durer
 * des minutes. `executer_commande` est bloquant : ici la commande est lancée
 * détachée, sa sortie est tamponnée, et l'agent peut la suivre puis l'arrêter
 * sans immobiliser la conversation.
 *
 * Chaque tâche tourne dans son propre groupe de processus : l'arrêt tue aussi
 * les enfants (vite, npm, pytest…), pas seulement le shell.
 */

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { verifierCommande } = require('./codetools');

const MAX_TACHES = 5;
const MAX_SORTIE = 200000;       // caractères conservés par tâche
const MAX_TERMINEES = 20;        // historique gardé en mémoire
const DELAI_SIGKILL = 3000;

class TachesFond extends EventEmitter {
  constructor() {
    super();
    this.taches = new Map();
    this.compteur = 0;
  }

  enCours() {
    return [...this.taches.values()].filter((t) => t.statut === 'en_cours').length;
  }

  /** Lance une commande détachée et rend immédiatement la main. */
  lancer({ commande, cwd, nom } = {}) {
    const cmd = verifierCommande(commande);
    if (this.enCours() >= MAX_TACHES) {
      throw new Error(`Limite de ${MAX_TACHES} processus simultanés atteinte. Arrête-en un avant d'en lancer un autre.`);
    }

    const id = `tache_${Date.now().toString(36)}_${++this.compteur}`;
    const repertoire = cwd || process.cwd();

    const enfant = spawn('/bin/bash', ['-lc', cmd], {
      cwd: repertoire,
      detached: true,              // son propre groupe : on peut tout tuer
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });

    const tache = {
      id,
      nom: String(nom || '').trim() || cmd,
      commande: cmd,
      cwd: repertoire,
      debut: Date.now(),
      fin: null,
      code: null,
      signal: null,
      statut: 'en_cours',
      enfant,
      pid: enfant.pid,
      sortie: '',
      base: 0,                     // caractères jetés au début (plafond atteint)
      total: 0,
      tronquee: false,
      arretDemande: false
    };
    this.taches.set(id, tache);

    enfant.stdout.on('data', (d) => this._ajouter(tache, d));
    enfant.stderr.on('data', (d) => this._ajouter(tache, d));

    enfant.on('error', (err) => {
      this._ajouter(tache, Buffer.from(`\n[erreur de lancement] ${err.message}\n`));
      this._terminer(tache, null, null);
    });

    enfant.on('close', (code, signal) => this._terminer(tache, code, signal));

    this._nettoyer();
    this.emit('change', this.resume(tache));
    return this.resume(tache);
  }

  _ajouter(tache, morceau) {
    const texte = morceau.toString('utf8');
    tache.sortie += texte;
    tache.total += texte.length;
    if (tache.sortie.length > MAX_SORTIE) {
      const coupe = tache.sortie.length - MAX_SORTIE;
      tache.sortie = tache.sortie.slice(coupe);
      tache.base += coupe;
      tache.tronquee = true;
    }
    this.emit('sortie', tache.id);
  }

  _terminer(tache, code, signal) {
    if (tache.statut !== 'en_cours') return;
    tache.fin = Date.now();
    tache.code = typeof code === 'number' ? code : null;
    tache.signal = signal || null;
    tache.statut = tache.arretDemande ? 'arrete' : (tache.code === 0 ? 'termine' : 'echec');
    this.emit('change', this.resume(tache));
  }

  resume(tache) {
    return {
      id: tache.id,
      nom: tache.nom,
      commande: tache.commande,
      cwd: tache.cwd,
      pid: tache.pid,
      statut: tache.statut,
      code: tache.code,
      signal: tache.signal,
      debut: tache.debut,
      duree_ms: (tache.fin || Date.now()) - tache.debut,
      tronquee: tache.tronquee
    };
  }

  lister() {
    const taches = [...this.taches.values()]
      .sort((a, b) => b.debut - a.debut)
      .map((t) => this.resume(t));
    return { taches, total: taches.length, en_cours: this.enCours() };
  }

  /** Renvoie la sortie depuis un décalage (0 = tout ce qui est conservé). */
  sortir({ id, depuis = 0 } = {}) {
    const tache = this.taches.get(id);
    if (!tache) throw new Error(`Tâche inconnue : ${id}`);
    const demande = Math.max(0, Number(depuis) || 0);
    const depart = Math.max(0, demande - tache.base);
    return {
      ...this.resume(tache),
      depuis: tache.total,
      tronquee: demande < tache.base || tache.tronquee,
      sortie: tache.sortie.slice(depart)
    };
  }

  /** Arrête la tâche et tous ses enfants (groupe de processus). */
  arreter(id) {
    const tache = this.taches.get(id);
    if (!tache) throw new Error(`Tâche inconnue : ${id}`);
    if (tache.statut !== 'en_cours') {
      return { ok: false, id, statut: tache.statut, message: 'La tâche est déjà terminée.' };
    }

    tache.arretDemande = true;
    const tuer = (signal) => {
      try { process.kill(-tache.pid, signal); }
      catch { try { tache.enfant.kill(signal); } catch { /* déjà mort */ } }
    };
    tuer('SIGTERM');
    const minuteur = setTimeout(() => {
      if (tache.statut === 'en_cours') tuer('SIGKILL');
    }, DELAI_SIGKILL);
    if (typeof minuteur.unref === 'function') minuteur.unref();

    return { ok: true, id, message: 'Arrêt demandé (SIGTERM, puis SIGKILL après 3 s).' };
  }

  arreterTout() {
    for (const t of this.taches.values()) {
      if (t.statut === 'en_cours') {
        try { process.kill(-t.pid, 'SIGKILL'); }
        catch { try { t.enfant.kill('SIGKILL'); } catch { /* ignore */ } }
      }
    }
  }

  _nettoyer() {
    const terminees = [...this.taches.values()]
      .filter((t) => t.statut !== 'en_cours')
      .sort((a, b) => b.debut - a.debut);
    for (const t of terminees.slice(MAX_TERMINEES)) this.taches.delete(t.id);
  }
}

/* ------------------------------- outils -------------------------------- */

function resoudreCwd(ctx, rel) {
  if (!ctx?.workspace) {
    throw new Error("Aucun espace de travail ouvert. Ouvre un dossier dans Réglages → Espace de travail.");
  }
  const racine = path.resolve(ctx.workspace);
  if (!rel) return racine;
  const cible = path.resolve(racine, String(rel));
  const r = path.relative(racine, cible);
  if (r.startsWith('..') || path.isAbsolute(r)) {
    throw new Error(`Répertoire hors de l'espace de travail refusé : ${rel}`);
  }
  return cible;
}

const gestionnaire = new TachesFond();

const OUTILS_TACHES_FOND = [
  {
    nom: 'lancer_tache_fond',
    description: "Lance une commande longue en arrière-plan et rend la main immédiatement (serveur de développement, build, suite de tests, téléchargement). Suis sa sortie avec sortie_tache_fond, liste-les avec lister_taches_fond, arrête-la avec arreter_tache_fond.",
    schema: {
      type: 'object',
      properties: {
        commande: { type: 'string', description: 'Commande bash à lancer' },
        repertoire: { type: 'string', description: "Sous-dossier de l'espace de travail (optionnel)" },
        nom: { type: 'string', description: 'Nom lisible pour retrouver la tâche (optionnel)' }
      },
      required: ['commande']
    },
    risque: 'commande',
    executer: async (args, ctx) => gestionnaire.lancer({
      commande: args.commande,
      cwd: resoudreCwd(ctx, args.repertoire),
      nom: args.nom
    })
  },
  {
    nom: 'lister_taches_fond',
    description: "Liste les processus lancés en arrière-plan avec leur état (en cours, terminé, échec, arrêté), leur code de sortie et leur durée.",
    schema: { type: 'object', properties: {} },
    risque: 'lecture',
    executer: async () => gestionnaire.lister()
  },
  {
    nom: 'sortie_tache_fond',
    description: "Renvoie la sortie accumulée d'un processus lancé en arrière-plan. Passe « depuis » avec la valeur rendue précédemment pour ne recevoir que les nouvelles lignes.",
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identifiant rendu par lancer_tache_fond' },
        depuis: { type: 'number', description: 'Décalage déjà lu (optionnel)' }
      },
      required: ['id']
    },
    risque: 'lecture',
    executer: async (args) => gestionnaire.sortir({ id: args.id, depuis: args.depuis })
  },
  {
    nom: 'arreter_tache_fond',
    description: "Arrête un processus lancé en arrière-plan, ainsi que ses processus enfants.",
    schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Identifiant de la tâche' } },
      required: ['id']
    },
    risque: 'commande',
    executer: async (args) => gestionnaire.arreter(args.id)
  }
];

const PAR_NOM = new Map(OUTILS_TACHES_FOND.map((o) => [o.nom, o]));

module.exports = {
  TachesFond,
  gestionnaire,
  OUTILS_TACHES_FOND,
  PAR_NOM,
  MAX_TACHES,
  MAX_SORTIE
};
