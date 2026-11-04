'use strict';

/**
 * Sous-agents.
 *
 * Un sous-agent est une exécution isolée de l'agent, avec sa propre conversation
 * et ses propres outils, lancée pour traiter une tâche ciblée. Le sous-agent ne
 * voit pas l'historique de la conversation principale : il ne reçoit qu'une
 * consigne. Il renvoie un résultat, pas ses étapes intermédiaires.
 *
 * Deux usages :
 *  - **déléguer** : confier une tâche longue ou indépendante sans polluer la
 *    conversation principale (recherche, exploration de code, vérification) ;
 *  - **en parallèle** : lancer plusieurs sous-agents en même temps quand les
 *    tâches sont indépendantes.
 *
 * Un sous-agent ne peut pas déléguer à son tour : la profondeur est limitée à 1,
 * sinon une erreur de prompt suffirait à épuiser la machine.
 */

const MAX_PARALLELES = 3;
const MAX_TOURS_SOUS_AGENT = 12;

/** Noms d'outils qu'un sous-agent ne doit pas recevoir : récursion et mutations lourdes. */
const EXCLUS = new Set([
  'deleguer_tache',
  'deleguer_parallelle',
  'memoire_retenir',
  'memoire_oublier'
]);

/**
 * Filtre les outils d'un sous-agent : lecture et recherche d'abord, pas de
 * récursion, pas de modification de la mémoire globale sans supervision.
 */
function outilsSousAgent(outils) {
  return (outils || []).filter((t) => !EXCLUS.has(t.nom));
}

/** Construit la consigne d'un sous-agent à partir de la demande du parent. */
function construireConsigne({ tache, contexte = '', format = '' }) {
  const lignes = [
    'Tu es un sous-agent. Tu traites une tâche précise pour un agent principal.',
    'Tu ne vois pas la conversation d’origine : travaille uniquement avec ce qui suit.',
    '',
    'Tâche :',
    String(tache || '').trim()
  ];
  if (contexte) lignes.push('', 'Contexte utile :', String(contexte).trim());
  if (format) lignes.push('', 'Format de réponse attendu :', String(format).trim());
  lignes.push(
    '',
    'Règles :',
    '- Tu ne peux pas déléguer à un autre agent.',
    '- Sois concis : rends un résultat exploitable, pas un récit de tes étapes.',
    '- Si la tâche est impossible, dis-le et explique pourquoi en une phrase.',
    '- Réponds en français.'
  );
  return lignes.join('\n');
}

/**
 * Lance plusieurs sous-agents en parallèle et attend tous les résultats.
 * Un échec isolé ne fait pas échouer l'ensemble : il est rapporté tel quel.
 */
async function lancerEnParallele(taches, executerUn, { limite = MAX_PARALLELES } = {}) {
  const liste = (Array.isArray(taches) ? taches : []).slice(0, limite);
  if (!liste.length) return [];

  return Promise.all(liste.map(async (t, index) => {
    try {
      const texte = await executerUn(t, index);
      return { index, ok: true, tache: t.tache || '', resultat: String(texte || '').trim() };
    } catch (err) {
      return {
        index,
        ok: false,
        tache: t.tache || '',
        resultat: '',
        erreur: String(err?.message || err).slice(0, 300)
      };
    }
  }));
}

/** Résume les résultats pour le parent. */
function resumerResultats(resultats) {
  if (!resultats.length) return 'Aucun sous-agent n’a été lancé.';
  const parties = resultats.map((r) => {
    const entete = `— Sous-agent ${r.index + 1} : ${r.tache || '(sans titre)'}`;
    if (!r.ok) return `${entete}\nÉCHEC : ${r.erreur || 'raison inconnue'}`;
    return `${entete}\n${r.resultat || '(résultat vide)'}`;
  });
  const ok = resultats.filter((r) => r.ok).length;
  return `${ok}/${resultats.length} sous-agent(s) ont abouti.\n\n${parties.join('\n\n')}`;
}

/* ------------------------------ les outils ------------------------------ */

/**
 * Fabrique les outils de délégation. Ils ont besoin d'un exécuteur injecté par
 * le module appelant (agent.js), pour éviter une dépendance circulaire.
 */
function creerOutils({ executerSousAgent }) {
  return [
    {
      nom: 'deleguer_tache',
      description: "Confie une tâche ciblée à un sous-agent isolé, qui ne voit pas cette conversation. Utile pour une exploration longue, une recherche ou une vérification qui n'a pas besoin du contexte complet. Le sous-agent renvoie un résultat, pas ses étapes.",
      schema: {
        type: 'object',
        properties: {
          tache: { type: 'string', description: 'La tâche à confier, formulée clairement' },
          contexte: { type: 'string', description: 'Ce que le sous-agent doit savoir (facultatif)' },
          format: { type: 'string', description: 'Forme de réponse souhaitée (facultatif)' }
        },
        required: ['tache']
      },
      risque: 'lecture',
      executer: async (args, ctx) => {
        const consigne = construireConsigne(args);
        const texte = await executerSousAgent({ consigne, ctx, tache: args.tache });
        return { tache: args.tache, resultat: String(texte || '').trim() };
      }
    },
    {
      nom: 'deleguer_parallelle',
      description: "Lance plusieurs sous-agents en même temps, quand les tâches sont indépendantes les unes des autres. Maximum 3. Chaque sous-agent renvoie son propre résultat.",
      schema: {
        type: 'object',
        properties: {
          taches: {
            type: 'array',
            description: 'Liste de tâches indépendantes à confier',
            items: {
              type: 'object',
              properties: {
                tache: { type: 'string', description: 'La tâche' },
                contexte: { type: 'string', description: 'Contexte utile' }
              },
              required: ['tache']
            }
          }
        },
        required: ['taches']
      },
      risque: 'lecture',
      executer: async (args, ctx) => {
        const taches = (Array.isArray(args.taches) ? args.taches : []).slice(0, MAX_PARALLELES);
        if (!taches.length) throw new Error('Aucune tâche fournie.');

        const resultats = await lancerEnParallele(taches, async (t) => {
          const consigne = construireConsigne(t);
          return executerSousAgent({ consigne, ctx, tache: t.tache });
        });

        return {
          lances: resultats.length,
          aboutis: resultats.filter((r) => r.ok).length,
          resume: resumerResultats(resultats),
          resultats: resultats.map((r) => ({
            tache: r.tache,
            ok: r.ok,
            resultat: r.ok ? r.resultat.slice(0, 4000) : null,
            erreur: r.erreur || null
          }))
        };
      }
    }
  ];
}

module.exports = {
  creerOutils,
  outilsSousAgent,
  construireConsigne,
  lancerEnParallele,
  resumerResultats,
  MAX_PARALLELES,
  MAX_TOURS_SOUS_AGENT
};
