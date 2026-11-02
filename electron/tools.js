'use strict';

/**
 * Outils que l'IA peut appeler pour piloter le coffre Obsidian.
 * Chaque outil possède une définition JSON Schema (format neutre) convertie
 * ensuite vers Anthropic ou OpenAI selon le fournisseur actif.
 */

const obsidian = require('./obsidian');

const TOOLS = [
  {
    nom: 'lister_notes',
    description: "Liste toutes les notes Markdown du coffre Obsidian avec leur chemin relatif. À utiliser pour découvrir l'organisation du coffre.",
    schema: {
      type: 'object',
      properties: {
        dossier: { type: 'string', description: 'Limiter à un sous-dossier (optionnel)' }
      }
    },
    risque: 'lecture',
    executer: async (args, ctx) => {
      const notes = await obsidian.listNotes(ctx.vaultPath);
      const filtre = args.dossier
        ? notes.filter((n) => n.path.startsWith(String(args.dossier)))
        : notes;
      return {
        total: filtre.length,
        notes: filtre.slice(0, 400).map((n) => ({ chemin: n.path, taille: n.size }))
      };
    }
  },
  {
    nom: 'lire_note',
    description: "Lit le contenu complet d'une note Markdown du coffre.",
    schema: {
      type: 'object',
      properties: { chemin: { type: 'string', description: 'Chemin relatif de la note, ex. "Projets/Idees.md"' } },
      required: ['chemin']
    },
    risque: 'lecture',
    executer: async (args, ctx) => obsidian.readNote(ctx.vaultPath, args.chemin)
  },
  {
    nom: 'creer_note',
    description: "Crée une nouvelle note Markdown (ou remplace entièrement une note existante). Le chemin peut inclure des sous-dossiers, l'extension .md est ajoutée automatiquement.",
    schema: {
      type: 'object',
      properties: {
        chemin: { type: 'string', description: 'Chemin relatif, ex. "Idées/Nouvelle idée.md"' },
        contenu: { type: 'string', description: 'Contenu Markdown complet de la note' }
      },
      required: ['chemin', 'contenu']
    },
    risque: 'ecriture',
    executer: async (args, ctx) => obsidian.writeNote(ctx.vaultPath, args.chemin, args.contenu)
  },
  {
    nom: 'ajouter_a_note',
    description: "Ajoute du contenu à la fin d'une note existante (crée la note si absente). Idéal pour journaliser ou compléter sans réécrire.",
    schema: {
      type: 'object',
      properties: {
        chemin: { type: 'string' },
        contenu: { type: 'string', description: 'Markdown à ajouter' }
      },
      required: ['chemin', 'contenu']
    },
    risque: 'ecriture',
    executer: async (args, ctx) => obsidian.appendToNote(ctx.vaultPath, args.chemin, args.contenu)
  },
  {
    nom: 'remplacer_dans_note',
    description: "Remplace un fragment de texte exact par un autre dans une note existante. Utile pour des corrections ciblées sans réécrire la note.",
    schema: {
      type: 'object',
      properties: {
        chemin: { type: 'string' },
        rechercher: { type: 'string', description: 'Texte exact à trouver' },
        remplacer: { type: 'string', description: 'Texte de remplacement' },
        toutes: { type: 'boolean', description: 'Remplacer toutes les occurrences (défaut : première seulement)' }
      },
      required: ['chemin', 'rechercher', 'remplacer']
    },
    risque: 'ecriture',
    executer: async (args, ctx) =>
      obsidian.patchNote(ctx.vaultPath, args.chemin, args.rechercher, args.remplacer, { all: Boolean(args.toutes) })
  },
  {
    nom: 'rechercher',
    description: "Recherche une expression (texte ou regex) dans toutes les notes du coffre et renvoie les extraits correspondants.",
    schema: {
      type: 'object',
      properties: {
        requete: { type: 'string', description: 'Texte ou expression régulière' },
        dossier: { type: 'string', description: 'Restreindre à un dossier (optionnel)' },
        limite: { type: 'number', description: 'Nombre maximum de notes (défaut 30)' }
      },
      required: ['requete']
    },
    risque: 'lecture',
    executer: async (args, ctx) =>
      obsidian.search(ctx.vaultPath, args.requete, { limit: args.limite || 30, dossier: args.dossier })
  },
  {
    nom: 'lister_tags',
    description: "Liste tous les tags du coffre avec leur nombre d'utilisations.",
    schema: { type: 'object', properties: {} },
    risque: 'lecture',
    executer: async (args, ctx) => obsidian.tags(ctx.vaultPath)
  },
  {
    nom: 'notes_par_tag',
    description: "Renvoie les notes portant un tag donné.",
    schema: {
      type: 'object',
      properties: { tag: { type: 'string', description: 'Tag sans le #' } },
      required: ['tag']
    },
    risque: 'lecture',
    executer: async (args, ctx) => obsidian.notesByTag(ctx.vaultPath, args.tag)
  },
  {
    nom: 'liens_de_note',
    description: "Renvoie les liens sortants ([[...]]) et les backlinks d'une note.",
    schema: {
      type: 'object',
      properties: { chemin: { type: 'string' } },
      required: ['chemin']
    },
    risque: 'lecture',
    executer: async (args, ctx) => obsidian.links(ctx.vaultPath, args.chemin)
  },
  {
    nom: 'deplacer_note',
    description: "Déplace ou renomme une note dans le coffre.",
    schema: {
      type: 'object',
      properties: {
        de: { type: 'string', description: 'Chemin actuel' },
        vers: { type: 'string', description: 'Nouveau chemin' }
      },
      required: ['de', 'vers']
    },
    risque: 'ecriture',
    executer: async (args, ctx) => obsidian.moveNote(ctx.vaultPath, args.de, args.vers)
  },
  {
    nom: 'creer_dossier',
    description: "Crée un dossier dans le coffre.",
    schema: {
      type: 'object',
      properties: { chemin: { type: 'string' } },
      required: ['chemin']
    },
    risque: 'ecriture',
    executer: async (args, ctx) => obsidian.makeFolder(ctx.vaultPath, args.chemin)
  },
  {
    nom: 'supprimer_note',
    description: "Déplace une note vers la corbeille du coffre (.trash). Action destructive : à n'utiliser qu'après confirmation explicite de l'utilisateur.",
    schema: {
      type: 'object',
      properties: { chemin: { type: 'string' } },
      required: ['chemin']
    },
    risque: 'destructif',
    executer: async (args, ctx) => obsidian.deleteNote(ctx.vaultPath, args.chemin, { corbeille: true })
  },
  {
    nom: 'journal_du_jour',
    description: "Ouvre (ou crée) la note de journal du jour et la renvoie.",
    schema: {
      type: 'object',
      properties: {
        dossier: { type: 'string', description: 'Dossier du journal (défaut "Journal")' }
      }
    },
    risque: 'ecriture',
    executer: async (args, ctx) => obsidian.journal(ctx.vaultPath, { dossier: args.dossier || 'Journal' })
  },
  {
    nom: 'statistiques_coffre',
    description: "Renvoie des statistiques sur le coffre : nombre de notes, dossiers, tags, mots.",
    schema: { type: 'object', properties: {} },
    risque: 'lecture',
    executer: async (args, ctx) => obsidian.stats(ctx.vaultPath)
  }
];

const BY_NAME = new Map(TOOLS.map((t) => [t.nom, t]));

/* --------- conversions vers les formats attendus par chaque API --------- */

function toAnthropicTools(tools = TOOLS) {
  return tools.map((t) => ({
    name: t.nom,
    description: t.description,
    input_schema: t.schema
  }));
}

function toOpenAITools(tools = TOOLS) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.nom,
      description: t.description,
      parameters: t.schema
    }
  }));
}

module.exports = { TOOLS, BY_NAME, toAnthropicTools, toOpenAITools };
