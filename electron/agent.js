'use strict';

/**
 * Boucle agentique : dialogue avec le fournisseur, exécution des outils,
 * renvoi des résultats, jusqu'à obtenir une réponse finale.
 *
 * Deux modes :
 *  - « notes » : outils Obsidian (coffre Markdown)
 *  - « code »  : outils de développement (terminal, fichiers, recherche, plan)
 * Le mode « complet » expose les deux jeux d'outils simultanément.
 *
 * Émet des événements vers le renderer via `emit`.
 */

const providers = require('./providers');
const toolbox = require('./tools');
const codetools = require('./codetools');
const githubtools = require('./githubtools');
const webtools = require('./webtools');
const vision = require('./vision');
const tachesfond = require('./tachesfond');
const competences = require('./competences');

// budget approximatif du contexte envoyé au modèle, en caractères (~4 par jeton)
const BUDGET_CONTEXTE = 220000;

/** Taille approximative des messages en caractères. */
function tailleMessages(messages) {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') total += m.content.length;
    else if (Array.isArray(m.content)) {
      for (const b of m.content) {
        if (typeof b.text === 'string') total += b.text.length;
        if (typeof b.content === 'string') total += b.content.length;
        else if (Array.isArray(b.content)) {
          for (const c of b.content) if (typeof c.text === 'string') total += c.text.length;
        }
      }
    }
  }
  return total;
}

/**
 * Allège les anciens résultats d'outils quand le contexte devient trop gros.
 * Les derniers résultats restent intacts : ce sont eux qui servent au travail
 * en cours. Renvoie true si quelque chose a été modifié.
 */
function allegerMessages(messages, isAnthropic, { budget = BUDGET_CONTEXTE, garder = 6 } = {}) {
  if (tailleMessages(messages) <= budget) return false;

  const indices = [];
  messages.forEach((m, i) => {
    if (!isAnthropic && m.role === 'tool') indices.push(i);
    else if (isAnthropic && m.role === 'user' && Array.isArray(m.content)
      && m.content.some((b) => b.type === 'tool_result')) indices.push(i);
  });

  const aAlleger = indices.slice(0, Math.max(0, indices.length - garder));
  let modifie = false;
  const marque = '[résultat antérieur allégé pour libérer du contexte]';

  for (const i of aAlleger) {
    const m = messages[i];
    if (!isAnthropic) {
      if (typeof m.content === 'string' && !m.content.startsWith(marque)) {
        m.content = marque;
        modifie = true;
      }
    } else {
      for (const b of m.content) {
        if (b.type !== 'tool_result') continue;
        if (Array.isArray(b.content)) b.content = [{ type: 'text', text: marque }];
        else b.content = marque;
        modifie = true;
      }
    }
    if (tailleMessages(messages) <= budget * 0.6) break;
  }
  return modifie;
}
const memoireMod = require('./memoire');
const sousagents = require('./sousagents');
const { gestionnaire: mcp } = require('./mcp');

const MAX_TOURS_DEFAUT = 25;

/**
 * Outils disponibles pour un mode, moins ceux désactivés dans les réglages.
 * @param {string} mode - « notes », « code » ou « complet »
 * @param {string[]} desactives - noms d'outils à retirer
 */
function outilsPourMode(mode, desactives = [], outilsMCP = []) {
  let liste;
  if (mode === 'notes') {
    liste = [
      ...toolbox.TOOLS,
      ...webtools.OUTILS_WEB,
      ...vision.OUTILS_VISION,
      ...competences.OUTILS_COMPETENCES
    ];
  } else if (mode === 'code' || mode === 'github') {
    liste = [
      ...codetools.OUTILS_CODE,
      ...githubtools.OUTILS_GITHUB,
      ...webtools.OUTILS_WEB,
      ...vision.OUTILS_VISION,
      ...tachesfond.OUTILS_TACHES_FOND,
      ...competences.OUTILS_COMPETENCES
    ];
  } else {
    liste = [
      ...toolbox.TOOLS,
      ...codetools.OUTILS_CODE,
      ...githubtools.OUTILS_GITHUB,
      ...webtools.OUTILS_WEB,
      ...vision.OUTILS_VISION,
      ...tachesfond.OUTILS_TACHES_FOND,
      ...competences.OUTILS_COMPETENCES
    ];
  }

  // la mémoire de long terme est disponible dans tous les modes
  liste = [...liste, ...memoireMod.OUTILS_MEMOIRE];

  // les outils des serveurs MCP sont disponibles dans tous les modes
  liste = [...liste, ...(Array.isArray(outilsMCP) ? outilsMCP : [])];

  if (!Array.isArray(desactives) || !desactives.length) return liste;
  const retires = new Set(desactives);
  return liste.filter((t) => !retires.has(t.nom));
}

function construireInviteSysteme(ctx, stats) {
  const { coffre, mode, workspace } = ctx;

  // mémoire de long terme : placée tôt pour qu'elle pèse sur les réponses
  const memoire = ctx.blocMemoire ? [ctx.blocMemoire, ''] : [];
  const lignes = [
    "Tu es Cerveau, un assistant de bureau francophone qui travaille sur la machine de l'utilisateur.",
    '',
    'Règles générales :',
    '- Réponds toujours en français, avec un ton direct et utile.',
    '- Si la demande est ambiguë, pose une question courte plutôt que d\'inventer.',
    "- N'invente jamais le contenu d'un fichier : lis-le d'abord avec tes outils.",
    '- Ne supprime jamais rien sans que l\'utilisateur l\'ait explicitement demandé.',
    '',
    'Méthode de travail :',
    "- Avant d'agir, vérifie ce qui existe déjà (fichier, dépôt, outil) au lieu de supposer.",
    "- Tâche en plusieurs étapes : utilise plan_taches, puis mets-le à jour.",
    '- Après une modification, vérifie le résultat (test, commande, relecture) et dis ce que tu as vérifié.',
    "- Ne prétends jamais avoir exécuté quelque chose que tu n'as pas exécuté.",
    "- Si un outil échoue, lis l'erreur et adapte-toi ; ne répète pas la même commande à l'identique."
  ];

  if (Array.isArray(ctx.competences) && ctx.competences.length) {
    lignes.push('', 'Compétences disponibles (procédures réutilisables) :');
    for (const c of ctx.competences.slice(0, 20)) {
      lignes.push(`- ${c.id} — ${c.nom} : ${c.description}`);
    }
    lignes.push('Charge celle qui correspond avec « charger_competence » avant de commencer.');
  }

  if (mode === 'code' || mode === 'complet' || mode === 'github') {
    lignes.push(
      '',
      'Mode développement :',
      "- Tu disposes d'un terminal : exécute les commandes réelles (ls, grep, git, npm, tests…).",
      '- Toutes tes actions sont confinées à l\'espace de travail indiqué ci-dessous.',
      '- Avant de modifier un fichier, lis-le. Pour une modification ciblée, préfère « modifier_fichier » à « ecrire_fichier ».',
      "- Après une modification de code, vérifie que ça fonctionne : lance les tests, le linter ou le programme.",
      "- Pour toute tâche en plusieurs étapes, utilise « plan_taches » puis mets-le à jour au fil de l'avancement.",
      "- Si une commande échoue, lis l'erreur et corrige plutôt que de répéter la même commande.",
      "- Pour une action qui exige les droits administrateur (installer un paquet, gérer un service), utilise « pkexec » et jamais « sudo » : l'application n'a pas de terminal, pkexec ouvre la fenêtre de mot de passe du système. Exemple : « pkexec pacman -S --noconfirm paquet ». Un « sudo » est converti automatiquement.",
      "- Si pkexec échoue avec « No authentication agent found », explique-le et propose d'installer un agent polkit (hyprpolkitagent ou polkit-gnome) ; sinon, donne la commande exacte à lancer à la main."
    );

    lignes.push(
      '',
      'Mode GitHub :',
      "- Tu peux consulter les dépôts, pull requests, issues et workflows GitHub via tes outils dédiés.",
      "- Avant de commiter, lis l'état du dépôt et montre le diff à l'utilisateur.",
      "- Ne pousse jamais de commit, n'ouvre jamais de PR et ne fusionne jamais sans que l'utilisateur l'ait demandé explicitement.",
      "- Quand tu crées une PR, rédige un titre clair et une description structurée (résumé, motivations, tests effectués).",
      '- Pour les commits, respecte le format conventionnel : « feat: », « fix: », « docs: », « refactor: », « test: », « chore: ».'
    );

    if (ctx.depotGithub) {
      lignes.push('', `Dépôt GitHub relié : ${ctx.depotGithub}`);
    }
    if (ctx.githubUtilisateur) {
      lignes.push(`Compte GitHub : ${ctx.githubUtilisateur}`);
    }
    if (workspace) {
      lignes.push('', `Espace de travail : ${workspace}`);
    } else {
      lignes.push('', "Aucun espace de travail n'est ouvert : demande à l'utilisateur d'en choisir un dans les réglages.");
    }
  }

  if (mode === 'notes' || mode === 'complet') {
    lignes.push(
      '',
      'Mode notes (Obsidian) :',
      "- Tu peux lire, créer, modifier, déplacer et organiser les notes du coffre via tes outils.",
      "- Avant de modifier une note existante, lis-la d'abord pour ne pas écraser de contenu.",
      "- Utilise le Markdown (titres, listes, tableaux, liens [[wiki]]) dans tes réponses et tes notes.",
      "- Quand tu crées une note, choisis un chemin clair et un titre en première ligne (# Titre)."
    );
    if (coffre) {
      lignes.push('', `Coffre actif : « ${coffre.name} » (${coffre.path})`);
      if (stats) {
        lignes.push(`Contenu : ${stats.notes} notes, ${stats.dossiers} dossiers, ${stats.tags} tags.`);
        if (stats.topTags?.length) {
          lignes.push(`Tags fréquents : ${stats.topTags.map((t) => `#${t.tag} (${t.count})`).join(', ')}`);
        }
      }
    }
  }

  // contexte compacté : résumé des échanges qui ne sont plus envoyés en entier
  if (ctx.resume) {
    lignes.push('', 'Résumé des échanges précédents (contexte compacté, à considérer comme acquis) :', ctx.resume);
  }

  // instructions personnalisées de l'utilisateur
  if (ctx.systemPrompt) {
    lignes.push('', 'Instructions de l\'utilisateur :', ctx.systemPrompt);
  }
  if (Array.isArray(ctx.presets) && ctx.presets.length) {
    lignes.push('', 'Style attendu :', ...ctx.presets.map((p) => `- ${p}`));
  }

  // la mémoire vient en dernier : elle précède immédiatement la demande
  if (ctx.blocMemoire) lignes.push('', ctx.blocMemoire);

  return lignes.join('\n');
}

function messageErreur(err) {
  if (err?.name === 'AbortError') return 'Génération interrompue.';

  const msg = String(err?.message || err);

  if (/fetch failed|ENOTFOUND|ECONNREFUSED|EHOSTUNREACH/i.test(msg)) {
    return "Connexion au fournisseur impossible. Vérifie l'URL de base et ta connexion réseau.";
  }
  if (/^terminated$/i.test(msg.trim())) {
    return 'La connexion a été coupée en cours de réponse. Réessaie.';
  }
  if (/ETIMEDOUT|timeout|timed out/i.test(msg)) {
    return 'Le fournisseur met trop de temps à répondre. Réessaie ou choisis un modèle plus rapide.';
  }
  if (/socket hang up|ECONNRESET/i.test(msg)) {
    return 'Connexion interrompue par le fournisseur. Réessaie.';
  }
  return msg;
}

/**
 * @param {object} opts
 * @param {string} opts.providerId
 * @param {Array}  opts.historique  messages [{role:'user'|'assistant', contenu}]
 * @param {object} opts.ctx         { vaultPath, coffre, permissions, confirmer }
 * @param {function} opts.emit      (event) => void
 * @param {AbortSignal} opts.signal
 */
async function run({ providerId, credentials, historique, ctx, emit, signal, limiteTours, outilsImposes }) {
  const mode = ctx.mode || 'notes';
  // charge les serveurs MCP déclarés (idempotent : ils restent en mémoire)
  let outilsMCP = [];
  if (Array.isArray(ctx.serveursMCP) && ctx.serveursMCP.length) {
    try {
      outilsMCP = await mcp.charger(ctx.serveursMCP);
    } catch (err) {
      emit({ type: 'erreur', message: `Serveurs MCP : ${err.message}` });
    }
  }

  // Outils de délégation : chaque sous-agent relance la boucle avec sa propre
  // consigne, sans l'historique courant et sans possibilité de déléguer à nouveau.
  const outilsDelegation = ctx.desactiverSousAgents ? [] : sousagents.creerOutils({
    executerSousAgent: async ({ consigne, ctx: ctxParent, tache }) => {
      const outilsFiltres = sousagents.outilsSousAgent(
        outilsPourMode(mode, ctxParent.outilsDesactives || [], outilsMCP)
      );
      const res = await run({
        providerId,
        credentials: ctxParent.credentials || credentials,
        historique: [{ role: 'user', contenu: consigne }],
        ctx: {
          ...ctxParent,
          // le sous-agent n'hérite pas de la mémoire d'écriture ni de la délégation
          memoire: ctxParent.memoire,
          desactiverSousAgents: true,
          mode: 'code',
          presets: [],
          blocMemoire: ''
        },
        emit: () => {},
        signal: undefined,
        limiteTours: sousagents.MAX_TOURS_SOUS_AGENT,
        outilsImposes: outilsFiltres
      });
      return res.texte || (res.erreur ? `Échec : ${res.erreur}` : '(aucun résultat)');
    }
  });

  let tools = outilsPourMode(mode, ctx.outilsDesactives || [], outilsMCP);
  if (Array.isArray(ctx.outilsImposes)) {
    tools = ctx.outilsImposes;
  } else if (outilsDelegation.length) {
    tools = [...tools, ...outilsDelegation];
  }

  // la mémoire de long terme enrichit l'invite système
  if (ctx.memoire) {
    try {
      ctx.blocMemoire = await ctx.memoire.blocPourInvite();
    } catch { ctx.blocMemoire = ''; }
  }

  if (ctx.competences === undefined) {
    try { ctx.competences = competences.lister(); } catch { ctx.competences = []; }
  }

  const stats = (mode === 'notes' || mode === 'complet') && ctx.vaultPath
    ? await safeStats(ctx)
    : null;
  const systeme = construireInviteSysteme(ctx, stats);

  /**
   * Décompose une URL de données en mime + base64.
   * Les images arrivent du renderer sous la forme « data:image/png;base64,… ».
   */
  const decomposerDataUrl = (dataUrl) => {
    const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/s);
    if (!m) return null;
    return { mime: m[1], base64: m[2] };
  };

  const anthropicMessages = [];
  for (const m of historique) {
    const contenu = [];
    // les images d'abord : Anthropic les accepte dans un bloc « image »
    for (const img of Array.isArray(m.images) ? m.images : []) {
      const d = decomposerDataUrl(img.dataUrl);
      if (!d) continue;
      contenu.push({
        type: 'image',
        source: { type: 'base64', media_type: d.mime, data: d.base64 }
      });
    }
    contenu.push({ type: 'text', text: m.contenu });
    anthropicMessages.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: contenu
    });
  }

  const openaiMessages = [
    { role: 'system', content: systeme },
    ...historique.map((m) => {
      const images = Array.isArray(m.images) ? m.images : [];
      // format OpenAI « chat/completions » : le contenu devient un tableau
      if (!images.length) {
        return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.contenu };
      }
      const parties = [{ type: 'text', text: m.contenu }];
      for (const img of images) {
        if (img.dataUrl) {
          parties.push({ type: 'image_url', image_url: { url: img.dataUrl } });
        }
      }
      return { role: m.role === 'assistant' ? 'assistant' : 'user', content: parties };
    })
  ];

  const isAnthropic = providers.classify(providerId) === 'anthropic';
  const messages = isAnthropic ? anthropicMessages : openaiMessages;

  let texteFinal = '';
  let tours = 0;
  let outilsExecutes = 0;
  let sansOutils = false;
  let dejaRejeteOutils = false;
  // poursuite automatique : le modèle s'arrête parfois avant d'avoir fini
  let relancesAuto = 0;
  let planCourant = null;
  let derniereErreur = false;
  let outilsFaits = [];
  let verifications = 0;
  let extensionTours = false;
  let allegeSecours = false;
  let messageContexte = null;

  let maxTours = Math.max(1, Number(limiteTours) || Number(ctx.agentMaxTours) || MAX_TOURS_DEFAUT);

  /**
   * Demande au modèle si la tâche est réellement terminée. Un petit appel à
   * part, sans outils ni historique : il ne pollue pas la conversation.
   */
  const verifierDemande = async (texte) => {
    const demande = [...historique].reverse().find((m) => m.role === 'user')?.contenu || '';
    if (!demande) return { termine: true };

    const invite = `Tu vérifies si une tâche demandée à un assistant est réellement terminée.
Demande de l'utilisateur :
${String(demande).slice(0, 2000)}

Outils exécutés : ${[...new Set(outilsFaits)].slice(-15).join(', ') || 'aucun'}.
Réponse finale de l'assistant :
${String(texte).slice(0, 3000)}

La demande est-elle entièrement satisfaite et vérifiée (fichiers écrits, commandes exécutées, tests) ?
Réponds uniquement par OUI ou NON.`;

    let verdict = '';
    try {
      for await (const evt of providers.stream({
        providerId,
        apiKey: credentials.apiKey,
        baseUrl: credentials.baseUrl,
        model: credentials.model,
        messages: [{ role: 'user', content: invite }],
        tools: [],
        maxTokens: 40,
        temperature: 0,
        signal
      })) {
        if (evt.type === 'texte') verdict += evt.delta;
        if (evt.type === 'erreur' || evt.type === 'fin') break;
      }
    } catch {
      return { termine: true };   // vérification impossible : on ne bloque pas
    }

    const reponse = verdict.trim().toUpperCase();
    const pasFini = /^(NON|PAS\b|INCOMPLET)/.test(reponse)
      || /NON\b|PAS (ENCORE|TERMIN|FINI)|INCOMPLET/.test(reponse);
    return { termine: !pasFini };
  };

  while (tours < maxTours) {
    tours += 1;
    let texteTour = '';
    const outilsDemandes = [];
    let raison = 'end_turn';
    const debutFlux = Date.now();

    // garde-fou : ne jamais envoyer un contexte démesuré au fournisseur
    if (allegerMessages(messages, isAnthropic)) {
      emit({ type: 'avertissement', message: 'Contexte volumineux : anciens résultats d\'outils allégés.' });
    }

    const flux = providers.stream({
      providerId,
      apiKey: credentials.apiKey,
      baseUrl: credentials.baseUrl,
      model: credentials.model,
      messages,
      system: isAnthropic ? systeme : undefined,
      tools: sansOutils ? [] : (isAnthropic ? versAnthropic(tools) : versOpenAI(tools)),
      temperature: ctx.temperature,
      signal
    });

    try {
      let rejetOutils = null;

      for await (const evt of flux) {
        if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        if (evt.type === 'texte') {
          texteTour += evt.delta;
          emit({ type: 'texte', delta: evt.delta });
        } else if (evt.type === 'outil_debut') {
          emit({ type: 'outil_debut', nom: evt.nom, id: evt.id });
        } else if (evt.type === 'outil') {
          outilsDemandes.push(evt);
        } else if (evt.type === 'erreur') {
          // Certains modèles refusent tout appel d'outil : on le signale une fois,
          // puis on continue sans outils plutôt que d'abandonner la conversation.
          const refuseOutils = /tool|function|capab|support|not supported|unsupported|invalid.*schema/i.test(evt.message)
            && !sansOutils;
          if (refuseOutils) {
            rejetOutils = evt.message;
            break;
          }

          // contexte trop gros : on allège et on réessaie une fois
          const erreurContexte = /context|too many tokens|maximum.*token|token.*limit|too long|exceed|payload too large|longueur|contexte|413/i.test(evt.message);
          if (erreurContexte && !allegeSecours) {
            allegeSecours = true;
            messageContexte = evt.message;
            break;
          }

          emit({ type: 'erreur', message: evt.message });
          return { texte: texteFinal + texteTour, outils: outilsExecutes, erreur: evt.message };
        } else if (evt.type === 'fin') {
          raison = evt.raison;
          if (evt.usage) emit({ type: 'usage', usage: evt.usage, ms: Date.now() - debutFlux });
        }
      }
      // Contexte refusé pour sa taille : on allège fortement et on réessaie.
      if (messageContexte) {
        allegerMessages(messages, isAnthropic, {
          budget: Math.round(BUDGET_CONTEXTE * 0.4),
          garder: 2
        });
        messageContexte = null;
        emit({
          type: 'avertissement',
          message: 'Contexte trop volumineux pour le fournisseur : historique allégé, nouvel essai.'
        });
        continue;
      }

      // Le modèle a refusé les outils : on réessaie immédiatement sans eux.
      if (rejetOutils) {
        sansOutils = true;
        dejaRejeteOutils = true;
        emit({
          type: 'avertissement',
          message: "Ce modèle ne gère pas les appels d'outils "
            + `(${rejetOutils.slice(0, 120)}). La conversation continue sans outils — `
            + 'choisissez un modèle compatible pour utiliser les notes, le code et GitHub.'
        });
        continue;
      }
    } catch (err) {
      const msg = messageErreur(err);
      emit({ type: 'erreur', message: msg });
      return { texte: texteFinal + texteTour, outils: outilsExecutes, erreur: msg };
    }

    texteFinal += texteTour;

    const reponseCoupee = /^(length|max_tokens)$/i.test(String(raison || ''));

    // Un appel d'outil coupé par la limite de tokens est incomplet : l'exécuter
    // pourrait écrire un fichier à moitié. On le jette et on demande de refaire.
    if (reponseCoupee && outilsDemandes.length && relancesAuto < 3 && !signal?.aborted) {
      relancesAuto += 1;
      if (texteTour.trim()) {
        messages.push(isAnthropic
          ? { role: 'assistant', content: [{ type: 'text', text: texteTour }] }
          : { role: 'assistant', content: texteTour });
        texteFinal += '\n\n';
        emit({ type: 'texte', delta: '\n\n' });
      }
      const consigne = "Ta réponse a été coupée pendant la préparation des outils : les appels incomplets n'ont pas été exécutés. Recommence-les entièrement, un par un si nécessaire.";
      messages.push(isAnthropic
        ? { role: 'user', content: [{ type: 'text', text: consigne }] }
        : { role: 'user', content: consigne });
      continue;
    }

    if (!outilsDemandes.length) {
      const texte = texteFinal.trim();
      const tronque = reponseCoupee;
      const planIncomplet = Array.isArray(planCourant)
        && planCourant.some((t) => t.statut !== 'termine');
      // le modèle annonce souvent la suite au lieu de l'exécuter : on regarde
      // la fin du texte, même s'il est long
      const finTexte = texte.slice(-300);
      const promesseSansSuite = outilsExecutes > 0
        && /je (vais|continue|poursuis|vérifie|termine|nettoie|lance|corrige|refais|teste|génère|prépare)/i.test(finTexte);

      // Le modèle s'arrête parfois avant la fin (réponse coupée, plan non
      // terminé, outil en échec, simple annonce). On poursuit automatiquement
      // au lieu d'obliger l'utilisateur à écrire « continue ».
      const doitContinuer = tronque || planIncomplet || derniereErreur || promesseSansSuite
        || (!texte && outilsExecutes > 0);

      if (doitContinuer && relancesAuto < 3 && !signal?.aborted) {
        relancesAuto += 1;

        // le modèle doit voir ce qu'il vient de dire pour reprendre au bon endroit
        if (texteTour.trim()) {
          messages.push(isAnthropic
            ? { role: 'assistant', content: [{ type: 'text', text: texteTour }] }
            : { role: 'assistant', content: texteTour });

          // sépare visuellement les deux morceaux dans la bulle
          texteFinal += '\n\n';
          emit({ type: 'texte', delta: '\n\n' });
        }

        let consigne;
        if (tronque) {
          consigne = "Ta réponse précédente a été coupée par la limite de tokens. Reprends exactement là où tu t'es arrêté, sans répéter ce qui précède.";
        } else if (planIncomplet) {
          const restantes = planCourant.filter((t) => t.statut !== 'termine').length;
          consigne = `Ton plan n'est pas terminé (${restantes} tâche(s) restante(s)). Poursuis avec les outils jusqu'au bout, puis vérifie le résultat. Ne demande pas à l'utilisateur de dire « continue ».`;
        } else if (derniereErreur) {
          consigne = "Le dernier outil a échoué. Lis l'erreur, corrige l'approche et poursuis la tâche jusqu'au bout.";
        } else if (!texte) {
          consigne = 'Rédige maintenant ta réponse finale à partir des résultats obtenus.';
        } else {
          consigne = "La tâche ne semble pas terminée : poursuis avec les outils jusqu'au bout, puis vérifie le résultat. Ne demande pas à l'utilisateur de dire « continue ».";
        }

        messages.push(isAnthropic
          ? { role: 'user', content: [{ type: 'text', text: consigne }] }
          : { role: 'user', content: consigne });

        // on garde les outils, sauf si le modèle les a explicitement refusés
        if (!dejaRejeteOutils) sansOutils = false;
        continue;
      }

      // Dernier filet : le modèle a peut-être conclu trop tôt. On lui demande
      // de vérifier, une seule fois, que la demande est réellement satisfaite.
      if (!dejaRejeteOutils && outilsExecutes > 0 && verifications < 1 && !signal?.aborted) {
        verifications += 1;
        emit({ type: 'verification', phase: 'debut' });
        const verdict = await verifierDemande(texteFinal);
        emit({ type: 'verification', phase: 'fin', termine: verdict.termine });

        if (!verdict.termine) {
          if (texteTour.trim()) {
            messages.push(isAnthropic
              ? { role: 'assistant', content: [{ type: 'text', text: texteTour }] }
              : { role: 'assistant', content: texteTour });
            texteFinal += '\n\n';
            emit({ type: 'texte', delta: '\n\n' });
          }
          const consigne = "La vérification indique que la demande n'est pas encore entièrement satisfaite. Poursuis avec les outils jusqu'au bout, puis vérifie le résultat. Ne demande pas à l'utilisateur de dire « continue ».";
          messages.push(isAnthropic
            ? { role: 'user', content: [{ type: 'text', text: consigne }] }
            : { role: 'user', content: consigne });
          continue;
        }
      }

      emit({ type: 'fin', raison });
      return { texte: texteFinal, outils: outilsExecutes };
    }

    // --- exécution des outils ---
    const resoudreOutil = (appel) => toolbox.BY_NAME.get(appel.nom)
      || codetools.PAR_NOM.get(appel.nom)
      || githubtools.PAR_NOM.get(appel.nom)
      || webtools.PAR_NOM.get(appel.nom)
      || vision.PAR_NOM.get(appel.nom)
      || tachesfond.PAR_NOM.get(appel.nom)
      || competences.PAR_NOM.get(appel.nom)
      || memoireMod.PAR_NOM.get(appel.nom)
      || outilsDelegation.find((t) => t.nom === appel.nom)
      || outilsMCP.find((t) => t.nom === appel.nom);

    const executerUn = async (appel) => {
      const outil = resoudreOutil(appel);
      emit({ type: 'outil_appel', nom: appel.nom, arguments: appel.arguments, id: appel.id });

      if (!outil) {
        emit({ type: 'outil_resultat', nom: appel.nom, ok: false, message: 'Outil inconnu' });
        return { appel, ok: false, resultat: `Outil inconnu : ${appel.nom}` };
      }

      // Contrôle des permissions
      const decision = await demanderPermission(outil, appel, ctx, emit);
      if (!decision.autorise) {
        emit({ type: 'outil_resultat', nom: appel.nom, ok: false, message: 'Refusé par l\u2019utilisateur' });
        return { appel, ok: false, resultat: `Action refusée par l'utilisateur : ${decision.raison}` };
      }

      try {
        const res = await outil.executer(appel.arguments || {}, ctx);
        outilsExecutes += 1;
        outilsFaits.push(appel.nom);
        if (appel.nom === 'plan_taches' && Array.isArray(res?.taches)) {
          planCourant = res.taches;
        }
        // une image (voir_image) est jointe au modèle, jamais sérialisée en base64
        const image = res && res.image && res.image.dataUrl ? res.image : null;
        const texte = JSON.stringify(image ? { ...res, image: '(jointe au modèle)' } : res, null, 2)
          .slice(0, 24000);
        emit({ type: 'outil_resultat', nom: appel.nom, ok: true, message: resumerResultat(appel.nom, res) });
        return { appel, ok: true, resultat: texte, image };
      } catch (err) {
        const msg = String(err?.message || err);
        emit({ type: 'outil_resultat', nom: appel.nom, ok: false, message: msg });
        return { appel, ok: false, resultat: `Erreur : ${msg}` };
      }
    };

    // Les outils en lecture seule peuvent tourner ensemble : c'est le cas
    // courant (lire trois fichiers, chercher dans deux dossiers). Dès qu'une
    // action écrit, exécute ou parle à l'extérieur, on repasse en séquentiel
    // pour garder un ordre prévisible.
    const outilsDuTour = outilsDemandes.map((appel) => ({ appel, outil: resoudreOutil(appel) }));
    const lectureSeule = ctx.appelsParalleles !== false
      && outilsDuTour.length > 1
      && outilsDuTour.every(({ outil }) => outil && (outil.risque || 'ecriture') === 'lecture');

    const resultats = [];
    if (lectureSeule) {
      resultats.push(...await Promise.all(outilsDuTour.map(({ appel }) => executerUn(appel))));
    } else {
      for (const { appel } of outilsDuTour) {
        resultats.push(await executerUn(appel));
      }
    }
    derniereErreur = resultats.some((r) => !r.ok);

    // plan encore en cours à la limite : une extension bornée plutôt qu'un arrêt
    if (tours >= maxTours && !extensionTours && !signal?.aborted
        && Array.isArray(planCourant) && planCourant.some((t) => t.statut !== 'termine')) {
      extensionTours = true;
      maxTours += 15;
      emit({
        type: 'avertissement',
        message: 'Plan encore en cours à la limite de tours : poursuite exceptionnelle de 15 tours.'
      });
    }

    // --- réinjection des résultats dans l'historique du fournisseur ---
    if (isAnthropic) {
      const contenuAssistant = [];
      if (texteTour) contenuAssistant.push({ type: 'text', text: texteTour });
      for (const r of resultats) {
        contenuAssistant.push({
          type: 'tool_use',
          id: r.appel.id,
          name: r.appel.nom,
          input: r.appel.arguments || {}
        });
      }
      messages.push({ role: 'assistant', content: contenuAssistant });
      messages.push({
        role: 'user',
        content: resultats.map((r) => {
          if (!r.image) {
            return { type: 'tool_result', tool_use_id: r.appel.id, content: r.resultat, is_error: !r.ok };
          }
          const d = decomposerDataUrl(r.image.dataUrl);
          const blocs = [{ type: 'text', text: r.resultat }];
          if (d) {
            blocs.push({ type: 'image', source: { type: 'base64', media_type: d.mime, data: d.base64 } });
          }
          return { type: 'tool_result', tool_use_id: r.appel.id, content: blocs, is_error: !r.ok };
        })
      });
    } else {
      openaiMessages.push({
        role: 'assistant',
        content: texteTour || null,
        tool_calls: resultats.map((r) => ({
          id: r.appel.id,
          type: 'function',
          function: { name: r.appel.nom, arguments: JSON.stringify(r.appel.arguments || {}) }
        }))
      });
      for (const r of resultats) {
        openaiMessages.push({
          role: 'tool',
          tool_call_id: r.appel.id,
          content: r.resultat
        });
      }
      // OpenAI n'accepte pas d'image dans un message « tool » : on joint les
      // images dans un message utilisateur juste après les résultats.
      const imagesOutils = resultats.filter((r) => r.image).map((r) => r.image);
      if (imagesOutils.length) {
        openaiMessages.push({
          role: 'user',
          content: [
            { type: 'text', text: 'Image(s) ouverte(s) par les outils ci-dessus :' },
            ...imagesOutils.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } }))
          ]
        });
      }
    }
  }

  emit({ type: 'erreur', message: `Limite de ${maxTours} tours d'outils atteinte.` });
  return { texte: texteFinal, outils: outilsExecutes, erreur: 'limite de tours atteinte' };
}

function resumerResultat(nom, res) {
  switch (nom) {
    // --- notes ---
    case 'lister_notes': return `${res.total} note(s) trouvée(s)`;
    case 'lire_note': return `${res.path} — ${res.content.length} caractères`;
    case 'creer_note': return res.created ? `Créée : ${res.path}` : `Mise à jour : ${res.path}`;
    case 'ajouter_a_note': return res.created ? `Créée : ${res.path}` : `Complétée : ${res.path}`;
    case 'remplacer_dans_note': return `${res.remplacements} remplacement(s) dans ${res.path}`;
    case 'rechercher': return `${res.length} note(s) correspondante(s)`;
    case 'supprimer_note': return `Déplacée vers ${res.deplaceeVers}`;
    case 'deplacer_note': return `${res.de} → ${res.vers}`;
    case 'creer_dossier': return `Dossier ${res.dossier}`;
    case 'journal_du_jour': return res.path;
    case 'statistiques_coffre': return `${res.notes} notes, ${res.mots} mots`;
    case 'lister_tags': return `${res.length} tag(s)`;
    case 'notes_par_tag': return `${res.length} note(s)`;
    case 'liens_de_note': return `${res.sortants.length} sortant(s), ${res.entrants.length} entrant(s)`;
    // --- code ---
    case 'executer_commande': {
      const etat = res.code === 0 ? '✓ code 0' : `✗ code ${res.code}`;
      const extrait = (res.stdout || '').split('\n').find((l) => l.trim()) || (res.stderr || '').split('\n').find((l) => l.trim()) || '';
      const court = extrait.length > 70 ? `${extrait.slice(0, 70)}…` : extrait;
      return `${etat} · ${(res.duree_ms / 1000).toFixed(1)} s${court ? ` · ${court}` : ''}`;
    }
    case 'lister_fichiers': return `${res.total} fichier(s)`;
    case 'lire_fichier': return `${res.chemin} — ${res.lignes_total} ligne(s)`;
    case 'ecrire_fichier': return res.cree ? `Créé : ${res.chemin}` : `Réécrit : ${res.chemin}`;
    case 'modifier_fichier': return `${res.remplacements} modification(s) dans ${res.chemin}`;
    case 'chercher_code': return `${res.fichiers_trouves} fichier(s) correspondant(s)`;
    case 'plan_taches': {
      const r = res.resume;
      return `${r.faites}/${r.total} tâche(s) terminée(s)`;
    }
    // --- github ---
    case 'etat_depot': {
      const parts = [res.branche];
      if (res.modifie) parts.push(`${res.fichiers.length} modif.`);
      else parts.push('propre');
      if (res.avance) parts.push(`↑${res.avance}`);
      if (res.retard) parts.push(`↓${res.retard}`);
      return parts.join(' · ');
    }
    case 'historique_commits': return `${res.length} commit(s)`;
    case 'voir_differences': return res.resume.split('\n').pop() || 'diff consulté';
    case 'lister_branches': return `${res.branches.length} branche(s)`;
    case 'tirer_depot': return res.message;
    case 'changer_branche': return `Branche : ${res.branche}`;
    case 'commiter_et_pousser': return res.message;
    case 'lister_depots_github': return `${res.total} dépôt(s)`;
    case 'lister_pull_requests': return `${res.total} PR · ${res.depot}`;
    case 'details_pull_request': return `PR #${res.numero} · ${res.etat} · ${res.fichiers} fichier(s)`;
    case 'creer_pull_request': return `PR créée : ${res.url}`;
    case 'lister_issues': return `${res.total} issue(s) · ${res.depot}`;
    case 'etat_ci': return `${res.total} exécution(s)`;
    // --- vision et tâches de fond ---
    case 'voir_image': return `${res.nom} — ${res.taille_ko} Ko`;
    case 'lancer_tache_fond': return `tâche lancée : ${res.id} · ${res.nom}`;
    case 'lister_taches_fond': return `${res.total} tâche(s) · ${res.en_cours} en cours`;
    case 'sortie_tache_fond':
      return `${res.statut}${res.code != null ? ` (code ${res.code})` : ''} · ${res.sortie.length} caractère(s)`;
    case 'arreter_tache_fond': return res.ok ? 'arrêt demandé' : res.message;
    case 'lister_competences': return `${res.competences.length} compétence(s)`;
    case 'charger_competence': return `${res.nom} — ${res.contenu.length} caractères`;
    case 'enregistrer_competence': return `compétence enregistrée : ${res.id}`;
    // --- web ---
    case 'deleguer_tache': return `sous-agent : ${String(res.resultat || '').slice(0, 80)}`;
    case 'deleguer_parallelle': return `${res.aboutis}/${res.lances} sous-agent(s)`;
    case 'memoire_retenir': return res.dejaConnu ? 'déjà connu' : (res.remplace ? 'mis à jour' : 'retenu');
    case 'memoire_chercher': return `${res.total} fait(s) en mémoire`;
    case 'memoire_oublier': return res.oublie ? 'oublié' : 'aucun fait correspondant';
    case 'web_search': return `${res.total} résultat(s) · ${res.moteur}`;
    case 'web_fetch': return `${res.titre || res.url} — ${res.longueurTotale} caractères`;
    default:
      // outils MCP : la réponse est déjà du texte
      if (typeof res === 'string') return res.slice(0, 120).replace(/\s+/g, ' ');
      return 'Terminé';
  }
}

/** Conversion neutre -> format Anthropic. */
function versAnthropic(tools) {
  return tools.map((t) => ({
    name: t.nom,
    description: t.description,
    input_schema: t.schema
  }));
}

/** Conversion neutre -> format OpenAI. */
function versOpenAI(tools) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.nom,
      description: t.description,
      parameters: t.schema
    }
  }));
}

async function safeStats(ctx) {
  try {
    return await require('./obsidian').stats(ctx.vaultPath);
  } catch {
    return null;
  }
}

async function demanderPermission(outil, appel, ctx, emit) {
  const mode = ctx.permissions?.mode || 'demander';
  const risque = outil.risque || 'ecriture';

  if (risque === 'lecture') return { autorise: true };

  // Commandes shell : contrôle spécifique
  if (risque === 'commande') {
    if (mode === 'lecture') {
      return { autorise: false, raison: 'mode lecture seule actif (commandes désactivées)' };
    }
    if (mode === 'auto' && ctx.permissions?.autoCommandes === true) return { autorise: true };
    return demander(ctx, emit, outil, appel, 'commande');
  }

  // Push git vers un dépôt distant
  if (risque === 'git_push') {
    if (mode === 'lecture') {
      return { autorise: false, raison: 'mode lecture seule actif (push désactivé)' };
    }
    if (mode === 'auto' && ctx.permissions?.autoPush === true) return { autorise: true };
    return demander(ctx, emit, outil, appel, 'git_push');
  }

  // Écriture sur GitHub (créer PR, issue, fusionner)
  if (risque === 'github_ecriture') {
    if (mode === 'lecture') {
      return { autorise: false, raison: 'mode lecture seule actif (écriture GitHub désactivée)' };
    }
    if (mode === 'auto' && ctx.permissions?.autoGithub === true) return { autorise: true };
    return demander(ctx, emit, outil, appel, 'github_ecriture');
  }

  if (risque === 'destructif') {
    if (mode === 'demander' || !ctx.permissions?.allowDelete) {
      return demander(ctx, emit, outil, appel, 'destructif');
    }
    return { autorise: false, raison: 'suppression non autorisée dans les réglages' };
  }

  if (mode === 'auto') return { autorise: true };
  if (mode === 'lecture') {
    return { autorise: false, raison: 'mode lecture seule actif' };
  }
  return demander(ctx, emit, outil, appel, risque);
}

function demander(ctx, emit, outil, appel, risque) {
  return ctx.confirmer({
    nom: outil.nom,
    description: outil.description,
    risque,
    arguments: appel.arguments || {}
  });
}

module.exports = { run, construireInviteSysteme, outilsPourMode };
