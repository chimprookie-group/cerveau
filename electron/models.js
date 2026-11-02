'use strict';

/**
 * Découverte des modèles disponibles auprès d'un fournisseur.
 *
 * - Compatible OpenAI / LM Studio / Ollama / vLLM : GET {base}/models
 * - Anthropic : GET {base}/v1/models (API publique)
 * - DeepSeek  : GET {base}/models
 *
 * Renvoie une liste normalisée triée, ou une erreur explicite.
 */

const providers = require('./providers');

function normaliser(urlBase, chemin) {
  const base = String(urlBase || '').replace(/\/+$/, '');
  if (!base) throw new Error("URL de base manquante.");
  // évite /v1/v1 si l'URL contient déjà la version
  if (/\/v\d+$/.test(base)) return `${base}${chemin}`;
  return `${base}/v1${chemin}`;
}

async function listerModeles({ providerId, apiKey, baseUrl }) {
  const famille = providers.classify(providerId);
  const url = normaliser(baseUrl, '/models');

  const entetes = { 'content-type': 'application/json' };
  if (famille === 'anthropic') {
    entetes['x-api-key'] = apiKey || '';
    entetes['anthropic-version'] = '2023-06-01';
    entetes['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (apiKey) {
    entetes.authorization = `Bearer ${apiKey}`;
  }

  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), 15000);

  let res;
  try {
    res = await fetch(url, { method: 'GET', headers: entetes, signal: controleur.signal });
  } catch (err) {
    clearTimeout(minuteur);
    if (err.name === 'AbortError') {
      throw new Error("Le fournisseur n'a pas répondu en 15 s. Vérifie l'URL de base (serveur local démarré ?).");
    }
    throw new Error(`Connexion impossible à ${url}. Vérifie l'URL de base et que le serveur est lancé.`);
  }
  clearTimeout(minuteur);

  if (!res.ok) {
    const texte = await res.text().catch(() => '');
    if (res.status === 401) throw new Error("Clé d'API refusée pour lister les modèles.");
    if (res.status === 404) {
      throw new Error(
        `Cet endpoint ne liste pas ses modèles (${url}). ` +
        "Ajoute-les à la main avec le bouton « Ajouter »."
      );
    }
    throw new Error(`Erreur ${res.status} en listant les modèles : ${texte.slice(0, 200)}`);
  }

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error('Réponse illisible du fournisseur (JSON attendu).');
  }

  const brut = Array.isArray(json?.data) ? json.data
    : Array.isArray(json?.models) ? json.models
    : Array.isArray(json) ? json
    : [];

  const modeles = brut
    .map((m) => (typeof m === 'string' ? m : m?.id || m?.name || m?.model || null))
    .filter((m) => typeof m === 'string' && m.trim())
    .map((m) => m.trim());

  // dédoublonnage + tri naturel
  const uniques = [...new Set(modeles)].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));

  return {
    url,
    total: uniques.length,
    modeles: uniques
  };
}

module.exports = { listerModeles };
