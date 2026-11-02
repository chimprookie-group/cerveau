'use strict';

/**
 * Outils web : recherche et lecture de pages.
 *
 * - `web_search` interroge DuckDuckGo (HTML, sans clé) par défaut, ou un
 *   fournisseur compatible si l'utilisateur en configure un.
 * - `web_fetch` récupère une page et la convertit en texte lisible.
 *
 * Aucune donnée n'est envoyée ailleurs qu'au moteur interrogé.
 */

const MAX_TEXTE = 60000;
const DELAI = 20000;

const ENTETES_NAVIGATEUR = {
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

async function recuperer(url, opts = {}) {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), opts.delai || DELAI);
  try {
    const res = await fetch(url, {
      headers: ENTETES_NAVIGATEUR,
      redirect: 'follow',
      signal: controleur.signal
    });
    const texte = await res.text();
    return { ok: res.ok, status: res.status, url: res.url, texte, type: res.headers.get('content-type') || '' };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Délai dépassé (${Math.round((opts.delai || DELAI) / 1000)} s) pour ${url}`);
    throw new Error(`Impossible de joindre ${url} : ${err.message}`);
  } finally {
    clearTimeout(minuteur);
  }
}

/** Convertit du HTML en texte lisible, sans dépendance externe. */
function htmlVersTexte(html) {
  let s = String(html || '');

  // retire ce qui n'est pas du contenu
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');

  // blocs -> sauts de ligne
  s = s.replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '• ');
  s = s.replace(/<h([1-6])[^>]*>/gi, '\n\n');

  // retire toutes les balises restantes
  s = s.replace(/<[^>]+>/g, ' ');

  // entités usuelles
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&[a-z]+;/gi, ' ');

  // normalise les espaces
  s = s.replace(/[ \t\u00a0]+/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.split('\n').map((l) => l.trim()).join('\n');
  return s.trim();
}

/** Recherche via DuckDuckGo (HTML). */
async function rechercherDuckDuckGo(requete, limite) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(requete)}`;
  const r = await recuperer(url);
  if (!r.ok) throw new Error(`DuckDuckGo a répondu ${r.status}.`);

  const resultats = [];
  // chaque résultat : <a class="result__a" href="...">titre</a> … <a class="result__snippet">
  const reBloc = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="[^"]*result__a|$)/gi;
  let m;
  while ((m = reBloc.exec(r.texte)) !== null && resultats.length < limite) {
    let lien = m[1];
    // DuckDuckGo encapsule parfois l'URL
    const interne = lien.match(/uddg=([^&]+)/);
    if (interne) {
      try { lien = decodeURIComponent(interne[1]); } catch { /* garde tel quel */ }
    }
    if (lien.startsWith('//')) lien = `https:${lien}`;

    const titre = htmlVersTexte(m[2]).replace(/\s+/g, ' ').trim();
    const bloc = m[3] || '';
    const snippetMatch = bloc.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const extrait = snippetMatch ? htmlVersTexte(snippetMatch[1]).replace(/\s+/g, ' ').trim() : '';

    // écarte les annonces DuckDuckGo et les redirections publicitaires
    const estPub = /duckduckgo\.com\/y\.js|\/y\.js\?|ad_domain=|ad_provider=/.test(lien);
    if (titre && lien.startsWith('http') && !estPub) {
      resultats.push({ titre, url: lien, extrait });
    }
  }

  if (!resultats.length) {
    // repli : analyse générique des liens sortants
    const reLien = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]{5,200}?)<\/a>/gi;
    let l;
    const vus = new Set();
    while ((l = reLien.exec(r.texte)) !== null && resultats.length < limite) {
      const u = l[1];
      if (vus.has(u) || /duckduckgo\.com|ad_domain=/.test(u)) continue;
      vus.add(u);
      const t = htmlVersTexte(l[2]).replace(/\s+/g, ' ').trim();
      if (t) resultats.push({ titre: t, url: u, extrait: '' });
    }
  }

  return resultats;
}

/** Recherche via un fournisseur compatible Tavily/Serper si configuré. */
async function rechercherFournisseur(requete, limite, cfg) {
  const base = String(cfg.urlBase || '').replace(/\/+$/, '');
  if (!base || !cfg.cle) throw new Error('Fournisseur de recherche incomplet.');

  const res = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.cle}` },
    body: JSON.stringify({ query: requete, max_results: limite })
  });
  if (!res.ok) throw new Error(`Le fournisseur de recherche a répondu ${res.status}.`);
  const j = await res.json();
  const liste = j.results || j.organic || j.data || [];
  return liste.slice(0, limite).map((r) => ({
    titre: r.title || r.name || '',
    url: r.url || r.link || '',
    extrait: r.content || r.snippet || r.description || ''
  })).filter((r) => r.url);
}

const OUTILS_WEB = [
  {
    nom: 'web_search',
    description: "Recherche sur le web et renvoie une liste de résultats (titre, URL, extrait). À utiliser quand une information récente ou externe au projet est nécessaire.",
    schema: {
      type: 'object',
      properties: {
        requete: { type: 'string', description: 'La recherche, en mots-clés' },
        limite: { type: 'number', description: 'Nombre de résultats (défaut 6, max 15)' }
      },
      required: ['requete']
    },
    risque: 'lecture',
    executer: async (args, ctx) => {
      const requete = String(args.requete || '').trim();
      if (!requete) throw new Error('Recherche vide.');
      const limite = Math.min(Math.max(Number(args.limite) || 6, 1), 15);

      const cfg = ctx.rechercheWeb || {};
      let resultats;
      let moteur = 'DuckDuckGo';

      if (cfg.moteur === 'fournisseur' && cfg.urlBase && cfg.cle) {
        resultats = await rechercherFournisseur(requete, limite, cfg);
        moteur = 'fournisseur configuré';
      } else {
        resultats = await rechercherDuckDuckGo(requete, limite);
      }

      if (!resultats.length) {
        return { requete, moteur, total: 0, resultats: [], note: 'Aucun résultat exploitable.' };
      }
      return { requete, moteur, total: resultats.length, resultats };
    }
  },
  {
    nom: 'web_fetch',
    description: "Récupère le contenu texte d'une page web (article, documentation, issue GitHub…). Utile après une recherche pour lire une source en entier.",
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL complète (http:// ou https://)' },
        limite: { type: 'number', description: 'Nombre maximum de caractères à renvoyer (défaut 20000)' }
      },
      required: ['url']
    },
    risque: 'lecture',
    executer: async (args) => {
      const url = String(args.url || '').trim();
      if (!/^https?:\/\//i.test(url)) throw new Error('URL invalide : elle doit commencer par http:// ou https://');
      const limite = Math.min(Math.max(Number(args.limite) || 20000, 500), MAX_TEXTE);

      const r = await recuperer(url);
      if (!r.ok) throw new Error(`La page a répondu ${r.status}.`);

      const estTexte = /json|text\/plain|xml/.test(r.type);
      const texte = estTexte ? r.texte : htmlVersTexte(r.texte);

      const titre = (r.texte.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
      return {
        url: r.url,
        titre: titre ? htmlVersTexte(titre).replace(/\s+/g, ' ').trim() : '',
        typeContenu: r.type,
        longueurTotale: texte.length,
        contenu: texte.slice(0, limite),
        tronque: texte.length > limite
      };
    }
  }
];

const PAR_NOM = new Map(OUTILS_WEB.map((t) => [t.nom, t]));

module.exports = { OUTILS_WEB, PAR_NOM, htmlVersTexte };
