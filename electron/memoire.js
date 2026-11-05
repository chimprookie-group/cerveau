'use strict';

/**
 * Mémoire durable de Cerveau.
 *
 * Retient des faits d'une session à l'autre : préférences de l'utilisateur,
 * décisions prises, conventions d'un projet. Contrairement à l'historique de
 * conversation (borné et par conversation), la mémoire est **globale** et
 * **permanente** : elle est injectée dans l'invite système de chaque échange.
 *
 * Elle est volontairement petite : une mémoire qui grossit sans limite finit
 * par coûter plus qu'elle ne rapporte. Chaque entrée a donc une catégorie, une
 * date et une fréquence d'usage, et les entrées les moins utiles sont évincées.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const MAX_ENTREES = 120;
const MAX_CARACTERES_INJECTES = 4000;
const CATEGORIES = ['preference', 'projet', 'decision', 'fait'];

function identifiant() {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Normalise un texte pour détecter les doublons proches. */
function normaliser(texte) {
  return String(texte || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class Memoire {
  constructor(fichier) {
    this.fichier = fichier;
    this.entrees = [];
    this.chargee = false;
  }

  async charger() {
    if (this.chargee) return this.entrees;
    try {
      const brut = await fsp.readFile(this.fichier, 'utf8');
      const parse = JSON.parse(brut);
      this.entrees = Array.isArray(parse.entrees) ? parse.entrees : [];
    } catch (err) {
      if (err.code !== 'ENOENT') {
        try { await fsp.rename(this.fichier, `${this.fichier}.corrompu-${Date.now()}`); } catch { /* ignore */ }
      }
      this.entrees = [];
    }
    this.chargee = true;
    return this.entrees;
  }

  async enregistrer() {
    const dossier = path.dirname(this.fichier);
    await fsp.mkdir(dossier, { recursive: true });
    const temporaire = `${this.fichier}.tmp`;
    const donnees = { version: 1, entrees: this.entrees.slice(0, MAX_ENTREES) };
    await fsp.writeFile(temporaire, JSON.stringify(donnees, null, 2), { mode: 0o600 });
    await fsp.rename(temporaire, this.fichier);
  }

  /**
   * Retient un fait. Si un fait très proche existe déjà, il est mis à jour
   * au lieu d'être dupliqué.
   */
  async retenir({ texte, categorie = 'fait', source = null }) {
    await this.charger();
    const contenu = String(texte || '').trim();
    if (!contenu) throw new Error('Rien à retenir : le texte est vide.');
    if (contenu.length > 500) throw new Error('Trop long pour être mémorisé (500 caractères maximum).');

    const cat = CATEGORIES.includes(categorie) ? categorie : 'fait';
    const cle = normaliser(contenu);

    const existante = this.entrees.find((e) => normaliser(e.texte) === cle);
    if (existante) {
      existante.usage = (existante.usage || 0) + 1;
      existante.majLe = Date.now();
      if (source) existante.source = source;
      await this.enregistrer();
      return { entree: existante, deja: true };
    }

    // Un fait presque identique est remplacé plutôt que dupliqué.
    // On compare les mots communs : deux phrases qui partagent la majorité
    // de leurs mots parlent du même sujet.
    const mots = (t) => new Set(normaliser(t).split(' ').filter((m) => m.length > 2));
    const proche = this.entrees.find((e) => {
      const a = normaliser(e.texte);
      if (a.length <= 20 || cle.length <= 20) return false;
      const ma = mots(e.texte);
      const mb = mots(contenu);
      if (!ma.size || !mb.size) return false;
      let communs = 0;
      for (const m of mb) if (ma.has(m)) communs += 1;
      const ratio = communs / Math.max(ma.size, mb.size);
      return ratio >= 0.6;
    });
    if (proche) {
      proche.texte = contenu;
      proche.categorie = cat;
      proche.majLe = Date.now();
      proche.usage = (proche.usage || 0) + 1;
      await this.enregistrer();
      return { entree: proche, remplace: true };
    }

    const entree = {
      id: identifiant(),
      texte: contenu,
      categorie: cat,
      creeLe: Date.now(),
      majLe: Date.now(),
      usage: 0,
      source
    };
    this.entrees.unshift(entree);

    // éviction : au-delà de la limite, on retire les moins utilisées et les plus anciennes
    if (this.entrees.length > MAX_ENTREES) {
      this.entrees.sort((a, b) => {
        const score = (x) => (x.usage || 0) * 1e12 + (x.majLe || x.creeLe || 0);
        return score(b) - score(a);
      });
      this.entrees = this.entrees.slice(0, MAX_ENTREES);
    }

    await this.enregistrer();
    return { entree, cree: true };
  }

  /** Cherche dans la mémoire. */
  async chercher(requete) {
    await this.charger();
    const q = normaliser(requete);
    if (!q) return this.entrees.slice();
    return this.entrees.filter((e) => normaliser(e.texte).includes(q));
  }

  async oublier(id) {
    await this.charger();
    const avant = this.entrees.length;
    this.entrees = this.entrees.filter((e) => e.id !== id);
    if (this.entrees.length === avant) return { supprimee: false };
    await this.enregistrer();
    return { supprimee: true };
  }

  async vider() {
    this.entrees = [];
    this.chargee = true;
    await this.enregistrer();
    return { videe: true };
  }

  /**
   * Bloc de texte injecté dans l'invite système.
   * Les entrées les plus utilisées et les plus récentes passent en premier,
   * et le total est plafonné pour ne pas noyer la consigne de l'utilisateur.
   */
  async blocPourInvite(requete = '') {
    await this.charger();
    if (!this.entrees.length) return '';

    // pertinence par rapport à la demande, puis usage et fraîcheur
    const mots = new Set(
      (String(requete).toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) || [])
    );
    const score = (x) => {
      const texte = String(x.texte || '').toLowerCase();
      let communs = 0;
      for (const m of mots) if (texte.includes(m)) communs += 1;
      return communs * 1e15 + (x.usage || 0) * 1e12 + (x.majLe || x.creeLe || 0);
    };
    const triees = [...this.entrees].sort((a, b) => score(b) - score(a));

    const groupes = { preference: [], projet: [], decision: [], fait: [] };
    for (const e of triees) (groupes[e.categorie] || groupes.fait).push(e);

    const titres = {
      preference: 'Préférences de l’utilisateur',
      projet: 'Contexte des projets',
      decision: 'Décisions prises',
      fait: 'Faits retenus'
    };

    const lignes = ['', 'Mémoire de long terme (ce que tu sais déjà) :'];
    let total = 0;
    for (const [cat, liste] of Object.entries(groupes)) {
      if (!liste.length) continue;
      lignes.push(`- ${titres[cat]} :`);
      for (const e of liste) {
        const ligne = `  · ${e.texte}`;
        if (total + ligne.length > MAX_CARACTERES_INJECTES) break;
        lignes.push(ligne);
        total += ligne.length;
      }
    }
    lignes.push('Utilise cette mémoire quand elle est pertinente, sans la répéter inutilement.');

    return lignes.join('\n');
  }
}

/* ------------------------------ les outils ------------------------------ */

const OUTILS_MEMOIRE = [
  {
    nom: 'memoire_retenir',
    description: "Retient un fait durable pour les prochaines conversations : une préférence de l'utilisateur, une convention de projet, une décision. À utiliser quand l'information restera vraie au-delà de la conversation en cours.",
    schema: {
      type: 'object',
      properties: {
        texte: { type: 'string', description: 'Le fait à retenir, en une phrase claire' },
        categorie: {
          type: 'string',
          enum: CATEGORIES,
          description: 'preference, projet, decision ou fait'
        }
      },
      required: ['texte']
    },
    risque: 'ecriture',
    executer: async (args, ctx) => {
      const r = await ctx.memoire.retenir({
        texte: args.texte,
        categorie: args.categorie || 'fait',
        source: 'agent'
      });
      return {
        retenu: r.entree.texte,
        categorie: r.entree.categorie,
        dejaConnu: Boolean(r.deja),
        remplace: Boolean(r.remplace)
      };
    }
  },
  {
    nom: 'memoire_chercher',
    description: 'Cherche dans la mémoire de long terme. À utiliser avant de poser une question dont la réponse a peut-être déjà été donnée.',
    schema: {
      type: 'object',
      properties: {
        requete: { type: 'string', description: 'Mots-clés à chercher (vide = tout)' }
      }
    },
    risque: 'lecture',
    executer: async (args, ctx) => {
      const entrees = await ctx.memoire.chercher(args.requete);
      return {
        total: entrees.length,
        entrees: entrees.slice(0, 20).map((e) => ({ texte: e.texte, categorie: e.categorie }))
      };
    }
  },
  {
    nom: 'memoire_oublier',
    description: 'Retire un fait de la mémoire de long terme. À utiliser quand une information memorisée est devenue fausse ou n’est plus souhaitée.',
    schema: {
      type: 'object',
      properties: {
        texte: { type: 'string', description: 'Le texte exact ou un extrait suffisant pour identifier le fait' }
      },
      required: ['texte']
    },
    risque: 'ecriture',
    executer: async (args, ctx) => {
      const trouvees = await ctx.memoire.chercher(args.texte);
      if (!trouvees.length) return { oublie: false, message: 'Aucun fait correspondant.' };
      const cible = trouvees[0];
      await ctx.memoire.oublier(cible.id);
      return { oublie: true, texte: cible.texte };
    }
  }
];

const PAR_NOM = new Map(OUTILS_MEMOIRE.map((t) => [t.nom, t]));

module.exports = { Memoire, OUTILS_MEMOIRE, PAR_NOM, normaliser, CATEGORIES };
