'use strict';

/**
 * Objectifs persistants.
 *
 * Un objectif est un travail qui dépasse un seul échange : « migre le projet
 * vers TypeScript », « écris la documentation de l'API ». Cerveau avance d'un
 * tour à la fois, enregistre son avancement, et peut reprendre après un
 * redémarrage sans perdre le fil.
 *
 * Trois principes :
 *  - **Explicite** : un objectif s'énonce, il ne se devine pas.
 *  - **Progressif** : chaque tour produit un petit pas, pas une tentative de
 *    tout faire d'un coup. Un tour qui échoue n'annule pas l'objectif.
 *  - **Sous contrôle** : l'utilisateur voit où ça en est et peut arrêter,
 *    suspendre ou reprendre à tout moment.
 *
 * Le module ne lance rien de lui-même : il calcule le prochain tour et
 * enregistre l'avancement. C'est l'application qui décide quand appeler.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const ETATS = ['actif', 'suspendu', 'termine', 'abandonne'];
const MAX_TOURS_PAR_DEFAUT = 20;
const MAX_OBJECTIFS = 60;
const MAX_HISTORIQUE = 40;

function identifiant() {
  return `obj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Un objectif est-il encore en cours ? */
function estEnCours(obj) {
  return obj && (obj.etat === 'actif' || obj.etat === 'suspendu');
}

/** Progression en pourcentage, à partir des tours consommés. */
function progression(obj) {
  const max = Number(obj.maxTours) || MAX_TOURS_PAR_DEFAUT;
  if (obj.etat === 'termine') return 100;
  return Math.min(99, Math.round(((obj.tours || 0) / max) * 100));
}

class Objectifs {
  constructor(fichier) {
    this.fichier = fichier;
    this.objectifs = [];
    this.chargee = false;
  }

  async charger() {
    if (this.chargee) return this.objectifs;
    try {
      const brut = await fsp.readFile(this.fichier, 'utf8');
      const parse = JSON.parse(brut);
      this.objectifs = Array.isArray(parse.objectifs) ? parse.objectifs : [];
    } catch (err) {
      if (err.code !== 'ENOENT') {
        try { await fsp.rename(this.fichier, `${this.fichier}.corrompu-${Date.now()}`); } catch { /* ignore */ }
      }
      this.objectifs = [];
    }
    this.chargee = true;
    return this.objectifs;
  }

  async enregistrer() {
    const dossier = path.dirname(this.fichier);
    await fsp.mkdir(dossier, { recursive: true });
    const temporaire = `${this.fichier}.tmp`;
    const donnees = {
      version: 1,
      objectifs: this.objectifs
        .sort((a, b) => (b.creeLe || 0) - (a.creeLe || 0))
        .slice(0, MAX_OBJECTIFS)
    };
    await fsp.writeFile(temporaire, JSON.stringify(donnees, null, 2), { mode: 0o600 });
    await fsp.rename(temporaire, this.fichier);
  }

  /** Crée un objectif. */
  async creer({ titre, description = '', maxTours = MAX_TOURS_PAR_DEFAUT, critere = '' }) {
    await this.charger();
    const t = String(titre || '').trim();
    if (!t) throw new Error("L'objectif doit avoir un titre.");
    if (t.length > 200) throw new Error('Titre trop long (200 caractères maximum).');

    const obj = {
      id: identifiant(),
      titre: t,
      description: String(description || '').trim().slice(0, 2000),
      critere: String(critere || '').trim().slice(0, 500),
      etat: 'actif',
      creeLe: Date.now(),
      majLe: Date.now(),
      tours: 0,
      maxTours: Math.min(Math.max(Number(maxTours) || MAX_TOURS_PAR_DEFAUT, 1), 100),
      historique: [],
      prochainPas: '',
      blocage: null
    };
    this.objectifs.unshift(obj);
    await this.enregistrer();
    return obj;
  }

  async trouver(id) {
    await this.charger();
    return this.objectifs.find((o) => o.id === id) || null;
  }

  async lister({ etat = null } = {}) {
    await this.charger();
    if (!etat) return this.objectifs.slice();
    return this.objectifs.filter((o) => o.etat === etat);
  }

  /** L'objectif actif le plus récent, s'il y en a un. */
  async actif() {
    await this.charger();
    return this.objectifs.find((o) => o.etat === 'actif') || null;
  }

  /**
   * Construit le prompt du prochain tour.
   * Inclut la description, le critère de réussite et l'historique des pas déjà
   * faits : sans cela, l'agent recommencerait depuis le début à chaque tour.
   */
  promptDuTour(obj) {
    const lignes = [
      `Objectif : ${obj.titre}`,
      ''
    ];
    if (obj.description) lignes.push(obj.description, '');
    if (obj.critere) lignes.push(`Critère de réussite : ${obj.critere}`, '');

    lignes.push(`C'est le tour ${(obj.tours || 0) + 1} sur ${obj.maxTours} maximum.`);
    lignes.push('');

    if (obj.historique?.length) {
      lignes.push('Ce qui a déjà été fait :');
      for (const h of obj.historique.slice(-10)) {
        lignes.push(`- Tour ${h.tour} : ${h.resume}`);
      }
      lignes.push('');
    }

    if (obj.prochainPas) {
      lignes.push('Prochain pas prévu :', obj.prochainPas, '');
    }

    lignes.push(
      'Règles pour ce tour :',
      '- Fais un pas concret vers l\'objectif. Pas tout le travail d\'un coup.',
      '- Sois bref : ce que tu as fait (2 à 4 lignes), puis la suite.',
      '',
      'Tu DOIS terminer ta réponse par exactement l\'un de ces deux marqueurs,',
      'sur sa propre ligne, à la fin :',
      '',
      '  SUITE: <la prochaine action précise, en une phrase>',
      '',
      'ou, si l\'objectif est entièrement atteint :',
      '',
      '  TERMINE',
      '',
      'Si tu ne peux pas avancer du tout, écris à la place :',
      '',
      '  BLOQUE: <la raison, en une phrase>'
    );

    return lignes.join('\n');
  }

  /**
   * Analyse la réponse d'un tour pour en extraire l'avancement.
   * Reconnaît « TERMINÉ », « BLOQUÉ : … » et une section « Suite ».
   */
  analyserReponse(texte) {
    const brut = String(texte || '');
    const resultat = { termine: false, bloque: null, prochainPas: '', resume: '' };

    // Marqueurs explicites demandés dans la consigne.
    if (/^\s*TERMIN[ÉE]S?\s*$/im.test(brut)) resultat.termine = true;

    const blocage = brut.match(/^\s*BLOQU[ÉE]\s*:?\s*([^\n]{0,300})/im)
      || brut.match(/BLOQU[ÉE]\s*:\s*([^\n]{0,300})/i);
    if (blocage) resultat.bloque = blocage[1].trim();

    // « SUITE: … » sur sa propre ligne
    const suite = brut.match(/^\s*SUITE\s*:?\s*([^\n]{0,600})/im);
    if (suite) {
      resultat.prochainPas = suite[1].trim();
    } else {
      // repli : ancienne forme « ## Suite » suivie du texte
      const section = brut.match(/(?:^|\n)\s*(?:#{1,6}\s*)?Suite\s*:?\s*\n([\s\S]*)$/i);
      if (section) {
        resultat.prochainPas = section[1].trim().split('\n').filter((l) => l.trim()).slice(0, 6).join('\n').slice(0, 600);
      }
    }

    // si l'agent n'a pas mis de marqueur mais que le texte annonce la fin
    if (!resultat.termine && /objectif (?:est )?atteint|travail (?:est )?termin[ée]/i.test(brut)) {
      resultat.termine = true;
    }

    // résumé du tour : premières lignes utiles
    resultat.resume = brut
      .replace(/^\s*(TERMIN[ÉE]S?|SUITE\s*:?|BLOQU[ÉE]\s*:?)\s*.*$/gim, '')
      .replace(/[#*`]/g, '')
      .split('\n').map((l) => l.trim()).filter(Boolean).join(' ')
      .slice(0, 300);

    return resultat;
  }

  /** Enregistre le résultat d'un tour. */
  async enregistrerTour(id, { texte, ok = true, erreur = null }) {
    const obj = await this.trouver(id);
    if (!obj) throw new Error('Objectif introuvable.');

    const analyse = this.analyserReponse(texte);
    obj.tours = (obj.tours || 0) + 1;
    obj.majLe = Date.now();

    obj.historique.push({
      tour: obj.tours,
      quand: Date.now(),
      resume: analyse.resume || (ok ? '(pas de résumé)' : `Échec : ${erreur || 'raison inconnue'}`),
      ok,
      erreur: erreur || null
    });
    if (obj.historique.length > MAX_HISTORIQUE) {
      obj.historique = obj.historique.slice(-MAX_HISTORIQUE);
    }

    if (!ok) {
      // un échec n'abandonne pas l'objectif : il est noté, et le tour suivant reprend
      obj.blocage = erreur || 'échec du tour';
    } else if (analyse.bloque) {
      obj.blocage = analyse.bloque;
      obj.etat = 'suspendu';
    } else {
      obj.blocage = null;
      obj.prochainPas = analyse.prochainPas || '';
    }

    if (analyse.termine) {
      obj.etat = 'termine';
      obj.prochainPas = '';
      obj.blocage = null;
    } else if (obj.tours >= obj.maxTours && (obj.etat === 'actif' || obj.etat === 'suspendu')) {
      // budget de tours épuisé : on suspend plutôt que de tourner sans fin.
      // Ce message prime sur un éventuel blocage du tour, c'est la vraie raison.
      obj.etat = 'suspendu';
      obj.blocage = `Limite de ${obj.maxTours} tours atteinte.`;
    }

    await this.enregistrer();
    return { objectif: obj, analyse };
  }

  async changerEtat(id, etat) {
    if (!ETATS.includes(etat)) throw new Error(`État inconnu : ${etat}`);
    const obj = await this.trouver(id);
    if (!obj) throw new Error('Objectif introuvable.');

    // reprendre un objectif suspendu efface le blocage et redonne du budget
    if (etat === 'actif' && obj.etat === 'suspendu') {
      obj.blocage = null;
      if (obj.tours >= obj.maxTours) obj.maxTours += 10;
    }
    obj.etat = etat;
    obj.majLe = Date.now();
    await this.enregistrer();
    return obj;
  }

  async supprimer(id) {
    await this.charger();
    const avant = this.objectifs.length;
    this.objectifs = this.objectifs.filter((o) => o.id !== id);
    if (this.objectifs.length === avant) return { supprime: false };
    await this.enregistrer();
    return { supprime: true };
  }

  /** Instantané pour l'interface. */
  async instantane() {
    await this.charger();
    const enrichis = this.objectifs.map((o) => ({
      ...o,
      progression: progression(o),
      enCours: estEnCours(o)
    }));
    return {
      total: enrichis.length,
      actifs: enrichis.filter((o) => o.etat === 'actif').length,
      termines: enrichis.filter((o) => o.etat === 'termine').length,
      objectifs: enrichis
    };
  }
}

module.exports = {
  Objectifs,
  estEnCours,
  progression,
  ETATS,
  MAX_TOURS_PAR_DEFAUT,
  MAX_OBJECTIFS
};
