'use strict';

/**
 * Outils GitHub exposés à l'IA : consultation des dépôts, pull requests et
 * issues, plus les opérations git locales (tirer, commiter, pousser).
 *
 * Les opérations d'écriture distantes (créer une PR, une issue, fusionner)
 * passent par le système de permissions de l'agent.
 */

const github = require('./github');

function requireDepotLocal(ctx) {
  if (!ctx.workspace) {
    throw new Error("Aucun espace de travail ouvert. Ouvre un dépôt dans l'onglet Dépôt.");
  }
  return ctx.workspace;
}

async function requireNomComplet(ctx) {
  if (ctx.depotGithub) return ctx.depotGithub;
  const etat = await github.etatLocal(requireDepotLocal(ctx));
  if (!etat.depot || !etat.nomComplet) {
    throw new Error(
      "Le dossier de travail n'est pas relié à un dépôt GitHub. " +
      "Ouvre-en un depuis l'onglet Dépôt, ou ajoute un remote avec « git remote add origin »."
    );
  }
  return etat.nomComplet;
}

const OUTILS_GITHUB = [
  {
    nom: 'etat_depot',
    description: "Renvoie l'état du dépôt git local : branche courante, fichiers modifiés, avance/retard par rapport au distant, dernier commit. À appeler avant toute opération git.",
    schema: { type: 'object', properties: {} },
    risque: 'lecture',
    executer: async (args, ctx) => {
      const etat = await github.etatLocal(requireDepotLocal(ctx));
      if (!etat.depot) throw new Error("Le dossier de travail n'est pas un dépôt git.");
      return etat;
    }
  },
  {
    nom: 'historique_commits',
    description: "Liste les derniers commits du dépôt local.",
    schema: {
      type: 'object',
      properties: {
        limite: { type: 'number', description: 'Nombre de commits (défaut 25, max 100)' }
      }
    },
    risque: 'lecture',
    executer: async (args, ctx) =>
      github.historique(requireDepotLocal(ctx), { limite: args.limite || 25 })
  },
  {
    nom: 'voir_differences',
    description: "Montre les modifications non validées du dépôt (résumé et diff).",
    schema: { type: 'object', properties: {} },
    risque: 'lecture',
    executer: async (args, ctx) => github.difference(requireDepotLocal(ctx))
  },
  {
    nom: 'lister_branches',
    description: "Liste les branches locales du dépôt.",
    schema: { type: 'object', properties: {} },
    risque: 'lecture',
    executer: async (args, ctx) => {
      const etat = await github.etatLocal(requireDepotLocal(ctx));
      return { brancheCourante: etat.branche, branches: etat.branches || [] };
    }
  },
  {
    nom: 'tirer_depot',
    description: "Récupère les dernières modifications depuis le dépôt distant (git pull --ff-only).",
    schema: { type: 'object', properties: {} },
    risque: 'ecriture',
    executer: async (args, ctx) => {
      const r = await github.tirer(requireDepotLocal(ctx));
      if (!r.ok) throw new Error(r.message);
      return r;
    }
  },
  {
    nom: 'changer_branche',
    description: "Bascule sur une branche existante, ou en crée une nouvelle.",
    schema: {
      type: 'object',
      properties: {
        nom: { type: 'string', description: 'Nom de la branche' },
        creer: { type: 'boolean', description: 'Créer la branche si elle n\'existe pas' }
      },
      required: ['nom']
    },
    risque: 'ecriture',
    executer: async (args, ctx) => {
      const r = await github.changerBranche(requireDepotLocal(ctx), args.nom, { creer: Boolean(args.creer) });
      ctx.depotBranche = args.nom;
      return r;
    }
  },
  {
    nom: 'commiter_et_pousser',
    description: "Ajoute toutes les modifications, crée un commit avec le message fourni, puis envoie sur le dépôt distant. Action visible publiquement : à n'utiliser qu'après avoir montré le diff à l'utilisateur et obtenu son accord.",
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message de commit, au format conventionnel si possible (feat:, fix:…)' },
        tous: { type: 'boolean', description: 'Ajouter aussi les fichiers non suivis (défaut true)' }
      },
      required: ['message']
    },
    risque: 'git_push',
    executer: async (args, ctx) => {
      const r = await github.envoyer(requireDepotLocal(ctx), {
        message: args.message,
        tous: args.tous !== false
      });
      if (!r.ok) throw new Error(r.message);
      return r;
    }
  },
  {
    nom: 'lister_depots_github',
    description: "Liste les dépôts GitHub de l'utilisateur connecté (les plus récemment modifiés en premier).",
    schema: {
      type: 'object',
      properties: {
        limite: { type: 'number', description: 'Nombre de dépôts (défaut 40)' }
      }
    },
    risque: 'lecture',
    executer: async (args) => {
      const liste = await github.listerDepots({ limite: args.limite || 40 });
      return { total: liste.length, depots: liste };
    }
  },
  {
    nom: 'lister_pull_requests',
    description: "Liste les pull requests d'un dépôt GitHub.",
    schema: {
      type: 'object',
      properties: {
        depot: { type: 'string', description: 'proprietaire/depot (défaut : le dépôt du dossier de travail)' },
        etat: { type: 'string', enum: ['open', 'closed', 'merged', 'all'], description: 'Filtre (défaut open)' },
        limite: { type: 'number' }
      }
    },
    risque: 'lecture',
    executer: async (args, ctx) => {
      const depot = args.depot || await requireNomComplet(ctx);
      const liste = await github.listerPR(depot, { etat: args.etat || 'open', limite: args.limite || 30 });
      return { depot, total: liste.length, pullRequests: liste };
    }
  },
  {
    nom: 'details_pull_request',
    description: "Détaille une pull request : description, contrôles CI, revue, commentaires, diff chiffré.",
    schema: {
      type: 'object',
      properties: {
        numero: { type: 'number', description: 'Numéro de la pull request' },
        depot: { type: 'string', description: 'proprietaire/depot (optionnel)' }
      },
      required: ['numero']
    },
    risque: 'lecture',
    executer: async (args, ctx) => {
      const depot = args.depot || await requireNomComplet(ctx);
      return github.infosPR(depot, args.numero);
    }
  },
  {
    nom: 'creer_pull_request',
    description: "Crée une pull request sur GitHub depuis la branche courante. Action publique : vérifie d'abord que la branche est poussée et que les changements sont voulus.",
    schema: {
      type: 'object',
      properties: {
        titre: { type: 'string' },
        corps: { type: 'string', description: 'Description Markdown de la PR' },
        source: { type: 'string', description: 'Branche source (défaut : branche courante)' },
        cible: { type: 'string', description: 'Branche cible (défaut : branche par défaut du dépôt)' },
        brouillon: { type: 'boolean' }
      },
      required: ['titre']
    },
    risque: 'github_ecriture',
    executer: async (args, ctx) => {
      const depot = args.depot || await requireNomComplet(ctx);
      const etat = await github.etatLocal(requireDepotLocal(ctx));
      return github.creerPR(depot, {
        titre: args.titre,
        corps: args.corps || '',
        source: args.source || etat.branche,
        cible: args.cible || null,
        brouillon: Boolean(args.brouillon)
      });
    }
  },
  {
    nom: 'lister_issues',
    description: "Liste les issues d'un dépôt GitHub.",
    schema: {
      type: 'object',
      properties: {
        depot: { type: 'string', description: 'proprietaire/depot (optionnel)' },
        etat: { type: 'string', enum: ['open', 'closed', 'all'] },
        limite: { type: 'number' }
      }
    },
    risque: 'lecture',
    executer: async (args, ctx) => {
      const depot = args.depot || await requireNomComplet(ctx);
      const liste = await github.listerIssues(depot, { etat: args.etat || 'open', limite: args.limite || 30 });
      return { depot, total: liste.length, issues: liste };
    }
  },
  {
    nom: 'etat_ci',
    description: "Affiche les derniers résultats des workflows GitHub Actions d'un dépôt.",
    schema: {
      type: 'object',
      properties: {
        depot: { type: 'string', description: 'proprietaire/depot (optionnel)' },
        limite: { type: 'number' }
      }
    },
    risque: 'lecture',
    executer: async (args, ctx) => {
      const depot = args.depot || await requireNomComplet(ctx);
      const runs = await github.listerRuns(depot, { limite: args.limite || 10 });
      return { depot, total: runs.length, executions: runs };
    }
  }
];

const PAR_NOM = new Map(OUTILS_GITHUB.map((t) => [t.nom, t]));

module.exports = { OUTILS_GITHUB, PAR_NOM, requireNomComplet };
