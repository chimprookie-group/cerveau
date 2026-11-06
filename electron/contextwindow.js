'use strict';

/**
 * Fenêtre de contexte approximative des modèles connus, en jetons.
 * Sert à compacter plus tard (et donc garder plus de détail) sur les grands
 * modèles, et plus tôt sur les petits. Une valeur inconnue reste prudente.
 */
function fenetreJetons(modele = '') {
  const m = String(modele || '').toLowerCase();
  if (/claude/.test(m)) return 200000;
  if (/gpt-5|gpt-6/.test(m)) return 400000;
  if (/gpt-4\.1/.test(m)) return 1000000;
  if (/gpt-4/.test(m)) return 128000;
  if (/\bo[1-9]\b|o[1-9]-/.test(m)) return 200000;
  if (/deepseek/.test(m)) return 128000;
  return 64000;
}

/** Budget en caractères (~4 par jeton), borné pour rester raisonnable. */
function budgetCaracteres(modele = '', ratio = 0.4) {
  const jetons = fenetreJetons(modele);
  return Math.max(60000, Math.min(400000, Math.round(jetons * 4 * ratio)));
}

module.exports = { fenetreJetons, budgetCaracteres };
