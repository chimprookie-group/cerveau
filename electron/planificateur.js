'use strict';

/**
 * Tâches planifiées.
 *
 * Une tâche planifiée relance un objectif (ou une consigne simple) à intervalle
 * régulier : « chaque matin, résume les issues ouvertes », « toutes les heures,
 * vérifie que les tests passent ». C'est la suite logique des objectifs : au lieu
 * que l'utilisateur clique « tour suivant », l'horloge s'en charge.
 *
 * Trois principes :
 *  - **Rien ne s'exécute en douce** : une tâche dit quand elle repartira, et
 *    chaque exécution laisse une trace consultable.
 *  - **Pas d'emballement** : une tâche ne se relance jamais tant que la
 *    précédente n'est pas finie, et un échec répété met la tâche en pause.
 *  - **Persistant** : l'échéance est datée en absolu, donc un redémarrage ne
 *    provoque pas de rattrapage massif — au plus une exécution manquée.
 *
 * Le module ne déclenche rien lui-même : il calcule « quand », et l'application
 * appelle quand l'heure est venue. Cela garde la logique testable sans horloge.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const MAX_TACHES = 40;
const MAX_HISTORIQUE = 20;
const ECHELLES = ['minutes', 'heures', 'jours'];
const ECHELLE_MS = { minutes: 60_000, heures: 3_600_000, jours: 86_400_000 };
const MAX_ECHECS_CONSECUTIFS = 3;

/**
 * Niveaux d'autonomie d'une tâche planifiée.
 *
 * En arrière-plan, personne ne peut répondre à une demande d'autorisation.
 * Sans choix explicite, la tâche tourne donc en lecture seule. L'utilisateur
 * peut élever ce niveau tâche par tâche, en connaissance de cause.
 */
const NIVEAUX = {
  lecture: {
    id: 'lecture',
    nom: 'Lecture seule',
    description: 'Consultation seulement : rien ne peut être modifié, exécuté ni supprimé.'
  },
  ecriture: {
    id: 'ecriture',
    nom: 'Écriture de fichiers',
    description: 'Peut créer et modifier des fichiers dans l’espace de travail. Pas de commande shell.'
  },
  commandes: {
    id: 'commandes',
    nom: 'Commandes autorisées',
    description: 'Peut exécuter des commandes shell dans l’espace de travail. Pas de suppression ni de push.'
  },
  complet: {
    id: 'complet',
    nom: 'Complet',
    description: 'Commandes, écriture, git push et actions GitHub. À réserver aux tâches de confiance.'
  }
};

/** Traduit un niveau en réglages de permissions compréhensibles par l'agent. */
function permissionsDuNiveau(niveau) {
  const n = NIVEAUX[niveau] ? niveau : 'lecture';
  if (n === 'lecture') {
    return { mode: 'lecture', allowDelete: false, autoCommandes: false, autoPush: false, autoGithub: false };
  }
  if (n === 'ecriture') {
    return { mode: 'auto', allowDelete: false, autoCommandes: false, autoPush: false, autoGithub: false };
  }
  if (n === 'commandes') {
    return { mode: 'auto', allowDelete: false, autoCommandes: true, autoPush: false, autoGithub: false };
  }
  return { mode: 'auto', allowDelete: true, autoCommandes: true, autoPush: true, autoGithub: true };
}

function identifiant() {
  return `tache_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Décrit un intervalle en français. */
function decrireIntervalle(tache) {
  const n = Number(tache.intervalle) || 1;
  const unite = ECHELLES.includes(tache.echelle) ? tache.echelle : 'heures';
  // « jour » est masculin, « minute » et « heure » sont féminins.
  // Au singulier on écrit « chaque jour », « chaque heure », « chaque minute ».
  if (n === 1) {
    const mot = { minutes: 'minute', heures: 'heure', jours: 'jour' }[unite];
    return `Chaque ${mot}`;
  }
  const mot = { minutes: 'minutes', heures: 'heures', jours: 'jours' }[unite];
  return `${unite === 'jours' ? 'Tous les' : 'Toutes les'} ${n} ${mot}`;
}

/** Prochaine échéance à partir de maintenant. */
function calculerEcheance(tache, depuis = Date.now()) {
  const ms = (Number(tache.intervalle) || 1) * (ECHELLE_MS[tache.echelle] || ECHELLE_MS.heures);
  return depuis + Math.max(ms, 60_000); // jamais moins d'une minute
}

/**
 * Analyse une consigne de planification en français simple.
 * Reconnaît « toutes les 30 minutes », « chaque heure », « tous les jours »,
 * « chaque matin », « toutes les 2 heures ».
 */
function analyserIntervalle(texte) {
  const t = String(texte || '').toLowerCase();

  const nombre = t.match(/(?:tous les|toutes les|chaque)\s+(\d+)\s*(minutes?|heures?|jours?)/);
  if (nombre) {
    const n = Math.max(1, Math.min(1000, Number(nombre[1])));
    const unite = nombre[2].startsWith('minute') ? 'minutes'
      : nombre[2].startsWith('heure') ? 'heures' : 'jours';
    return { intervalle: n, echelle: unite };
  }

  if (/\b(chaque\s+heure|toutes\s+les\s+heures|horaire)\b/.test(t)) return { intervalle: 1, echelle: 'heures' };
  if (/\b(chaque\s+jour|tous\s+les\s+jours|quotidien|chaque\s+matin|tous\s+les\s+matins)\b/.test(t)) {
    return { intervalle: 1, echelle: 'jours' };
  }
  if (/\b(chaque\s+minute|toutes\s+les\s+minutes)\b/.test(t)) return { intervalle: 1, echelle: 'minutes' };
  if (/\b(chaque\s+semaine|hebdomadaire|toutes\s+les\s+semaines)\b/.test(t)) {
    return { intervalle: 7, echelle: 'jours' };
  }

  return null;
}

class Planificateur {
  constructor(fichier) {
    this.fichier = fichier;
    this.taches = [];
    this.chargee = false;
    this.enCours = new Set();
  }

  async charger() {
    if (this.chargee) return this.taches;
    try {
      const brut = await fsp.readFile(this.fichier, 'utf8');
      const parse = JSON.parse(brut);
      this.taches = Array.isArray(parse.taches) ? parse.taches : [];
    } catch (err) {
      if (err.code !== 'ENOENT') {
        try { await fsp.rename(this.fichier, `${this.fichier}.corrompu-${Date.now()}`); } catch { /* ignore */ }
      }
      this.taches = [];
    }
    this.chargee = true;
    return this.taches;
  }

  async enregistrer() {
    const dossier = path.dirname(this.fichier);
    await fsp.mkdir(dossier, { recursive: true });
    const temporaire = `${this.fichier}.tmp`;
    const donnees = {
      version: 1,
      taches: this.taches
        .sort((a, b) => (b.creeLe || 0) - (a.creeLe || 0))
        .slice(0, MAX_TACHES)
    };
    await fsp.writeFile(temporaire, JSON.stringify(donnees, null, 2), { mode: 0o600 });
    await fsp.rename(temporaire, this.fichier);
  }

  /**
   * Crée une tâche planifiée.
   * Si `objectifId` est fourni, l'exécution joue un tour de cet objectif ;
   * sinon, la consigne est envoyée telle quelle à l'agent.
   */
  async creer({ nom, consigne, intervalle, echelle, objectifId = null, maxTours = 1, actif = true, niveau = 'lecture' }) {
    await this.charger();
    const titre = String(nom || '').trim();
    if (!titre) throw new Error('La tâche doit avoir un nom.');

    const texte = String(consigne || '').trim();
    if (!texte && !objectifId) throw new Error('Il faut une consigne ou un objectif à relancer.');

    const n = Math.max(1, Math.min(1000, Number(intervalle) || 1));
    const u = ECHELLES.includes(echelle) ? echelle : 'heures';

    // garde-fou : pas de planification plus rapide qu'une minute
    if (u === 'minutes' && n < 1) throw new Error('Intervalle minimum : 1 minute.');

    const tache = {
      id: identifiant(),
      nom: titre,
      consigne: texte,
      objectifId,
      // lecture seule par défaut : c'est le choix sûr en arrière-plan
      niveau: NIVEAUX[niveau] ? niveau : 'lecture',
      intervalle: n,
      echelle: u,
      actif: Boolean(actif),
      creeLe: Date.now(),
      majLe: Date.now(),
      prochaineEcheance: calculerEcheance({ intervalle: n, echelle: u }),
      derniereExecution: null,
      executions: 0,
      echecsConsecutifs: 0,
      maxToursTotal: Math.max(1, Math.min(100, Number(maxTours) || 1)),
      historique: []
    };
    this.taches.unshift(tache);
    await this.enregistrer();
    return tache;
  }

  async trouver(id) {
    await this.charger();
    return this.taches.find((t) => t.id === id) || null;
  }

  async lister() {
    await this.charger();
    return this.taches.slice();
  }

  /** Les tâches dont l'échéance est passée, et qui ne tournent pas déjà. */
  async dues(maintenant = Date.now()) {
    await this.charger();
    return this.taches.filter((t) =>
      t.actif
      && !this.enCours.has(t.id)
      && Number(t.prochaineEcheance) <= maintenant
    );
  }

  /** Millisecondes avant la prochaine échéance, ou null si rien n'est planifié. */
  async delaiProchaine(maintenant = Date.now()) {
    await this.charger();
    const actives = this.taches.filter((t) => t.actif && Number(t.prochaineEcheance));
    if (!actives.length) return null;
    const min = Math.min(...actives.map((t) => Number(t.prochaineEcheance)));
    return Math.max(0, min - maintenant);
  }

  marquerEnCours(id, oui = true) {
    if (oui) this.enCours.add(id);
    else this.enCours.delete(id);
  }

  /**
   * Enregistre le résultat d'une exécution et recalcule l'échéance.
   * Un échec ne reprogramme pas immédiatement : la tâche repart à l'intervalle
   * normal, et trois échecs consécutifs la mettent en pause.
   */
  async enregistrerExecution(id, { ok = true, resume = '', erreur = null } = {}) {
    const t = await this.trouver(id);
    if (!t) throw new Error('Tâche introuvable.');

    this.marquerEnCours(id, false);
    t.derniereExecution = Date.now();
    t.executions = (t.executions || 0) + 1;
    t.majLe = Date.now();

    if (ok) {
      t.echecsConsecutifs = 0;
    } else {
      t.echecsConsecutifs = (t.echecsConsecutifs || 0) + 1;
      if (t.echecsConsecutifs >= MAX_ECHECS_CONSECUTIFS) {
        t.actif = false;
        t.pauseAuto = `Mise en pause après ${MAX_ECHECS_CONSECUTIFS} échecs consécutifs.`;
      }
    }

    t.prochaineEcheance = calculerEcheance(t);
    t.historique.push({
      quand: Date.now(),
      ok,
      resume: String(resume || '').slice(0, 400),
      erreur: erreur ? String(erreur).slice(0, 300) : null
    });
    if (t.historique.length > MAX_HISTORIQUE) {
      t.historique = t.historique.slice(-MAX_HISTORIQUE);
    }

    await this.enregistrer();
    return t;
  }

  /** Change le niveau d'autonomie d'une tâche. */
  async changerNiveau(id, niveau) {
    if (!NIVEAUX[niveau]) throw new Error(`Niveau inconnu : ${niveau}`);
    const t = await this.trouver(id);
    if (!t) throw new Error('Tâche introuvable.');
    t.niveau = niveau;
    t.majLe = Date.now();
    await this.enregistrer();
    return t;
  }

  async basculer(id, actif) {
    const t = await this.trouver(id);
    if (!t) throw new Error('Tâche introuvable.');
    t.actif = Boolean(actif);
    t.majLe = Date.now();
    if (t.actif) {
      t.echecsConsecutifs = 0;
      t.pauseAuto = null;
      t.prochaineEcheance = calculerEcheance(t);
    }
    await this.enregistrer();
    return t;
  }

  /** Décale l'échéance sans exécuter, pour tester ou éviter un rattrapage. */
  async reporter(id, { dansMs = null } = {}) {
    const t = await this.trouver(id);
    if (!t) throw new Error('Tâche introuvable.');
    t.prochaineEcheance = dansMs != null ? Date.now() + dansMs : calculerEcheance(t);
    t.majLe = Date.now();
    await this.enregistrer();
    return t;
  }

  async supprimer(id) {
    await this.charger();
    const avant = this.taches.length;
    this.taches = this.taches.filter((t) => t.id !== id);
    this.marquerEnCours(id, false);
    if (this.taches.length === avant) return { supprime: false };
    await this.enregistrer();
    return { supprime: true };
  }

  async instantane(maintenant = Date.now()) {
    await this.charger();
    const enrichies = this.taches.map((t) => ({
      ...t,
      description: decrireIntervalle(t),
      enCours: this.enCours.has(t.id),
      dansMs: t.prochaineEcheance ? Math.max(0, Number(t.prochaineEcheance) - maintenant) : null
    }));
    return {
      total: enrichies.length,
      actives: enrichies.filter((t) => t.actif).length,
      taches: enrichies,
      prochaineMs: await this.delaiProchaine(maintenant)
    };
  }
}

module.exports = {
  Planificateur,
  NIVEAUX,
  permissionsDuNiveau,
  analyserIntervalle,
  calculerEcheance,
  decrireIntervalle,
  ECHELLES,
  MAX_ECHECS_CONSECUTIFS,
  MAX_TACHES
};
