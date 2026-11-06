'use strict';

/* ═══════════════════════════════════════════════════════════════
   Cerveau — logique de l'interface
   ═══════════════════════════════════════════════════════════════ */

const API = window.cerveau;

const MODELES = {
  anthropic: [
    { id: 'claude-sonnet-4-5', nom: 'Claude Sonnet 4.5' },
    { id: 'claude-opus-4-1', nom: 'Claude Opus 4.1' },
    { id: 'claude-haiku-4-5', nom: 'Claude Haiku 4.5' },
    { id: 'claude-3-5-sonnet-20241022', nom: 'Claude 3.5 Sonnet' }
  ],
  deepseek: [
    { id: 'deepseek-chat', nom: 'DeepSeek Chat' },
    { id: 'deepseek-reasoner', nom: 'DeepSeek Reasoner' }
  ],
  openai: [
    { id: 'gpt-4o', nom: 'GPT-4o' },
    { id: 'gpt-4o-mini', nom: 'GPT-4o mini' },
    { id: 'o3-mini', nom: 'o3-mini' }
  ],
  custom: []
};

const NOMS_FOURNISSEURS = {
  anthropic: 'Anthropic (Claude)',
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  custom: 'Compatible OpenAI (local / autre)'
};

const PLACEHOLDERS = {
  anthropic: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com',
  openai: 'https://api.openai.com/v1',
  custom: 'http://localhost:1234/v1'
};

/* ------------------------------- état --------------------------------- */

const etat = {
  config: null,
  conversations: [],
  conversationCourante: null,
  enCours: false,
  noteCourante: null,
  modeEditionNote: false,
  confirmationEnAttente: null,
  arbre: [],
  mode: 'complet',           // 'notes' | 'code' | 'complet'
  workspace: null,
  plan: [],
  // modèle choisi pour la session, par fournisseur : { anthropic: 'claude-opus-4-1', … }
  modelesSession: {},
  dossierPersonnel: '',
  // modèles découverts auprès du fournisseur : { custom: ['a','b'] }
  modelesDecouverts: {},
  // niveau de raisonnement choisi, par fournisseur : { anthropic: 'high' }
  effortsSession: {}
};

const ACCUEILS = {
  notes: {
    logo: '🐵',
    titre: 'Bonjour. Que faisons-nous aujourd\'hui ?',
    texte: "Je peux lire, créer et organiser les notes de votre coffre Obsidian, chercher dedans, ou simplement réfléchir avec vous."
  },
  code: {
    logo: '🐵',
    titre: 'Prêt à coder. Sur quoi travaillons-nous ?',
    texte: "J'ai accès à un terminal et aux fichiers de votre espace de travail. Je peux explorer, corriger, tester et refactoriser — sous votre contrôle."
  },
  complet: {
    logo: '🐵',
    titre: 'Bonjour. Que faisons-nous aujourd\'hui ?',
    texte: "Notes Obsidian, code, terminal : je peux travailler sur les deux en même temps. Dites-moi simplement ce dont vous avez besoin."
  }
};

/* ------------------------------ helpers ------------------------------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function el(tag, attrs = {}, ...enfants) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('data-')) n.setAttribute(k, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const e of enfants.flat()) {
    if (e === null || e === undefined) continue;
    n.append(typeof e === 'string' ? document.createTextNode(e) : e);
  }
  return n;
}


function notifierMaj(version, url) {
  const n = el('div', {
    class: 'notification info maj',
    text: `Cerveau ${version} est disponible — cliquer pour ouvrir la page de téléchargement.`
  });
  n.style.cursor = 'pointer';
  n.title = url || '';
  n.addEventListener('click', () => {
    if (url) API.app.ouvrirUrl(url);
    n.remove();
  });
  $('#notifications').append(n);
  setTimeout(() => {
    n.style.opacity = '0';
    n.style.transform = 'translateX(20px)';
    n.style.transition = 'all 0.2s';
    setTimeout(() => n.remove(), 220);
  }, 20000);
}

function notifier(message, type = 'info', duree = 3600) {
  const n = el('div', { class: `notification ${type}`, text: message });
  $('#notifications').append(n);
  setTimeout(() => {
    n.style.opacity = '0';
    n.style.transform = 'translateX(20px)';
    n.style.transition = 'all 0.2s';
    setTimeout(() => n.remove(), 220);
  }, duree);
}

function echapper(texte) {
  return String(texte ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formaterDate(ts) {
  const d = new Date(ts);
  const auj = new Date();
  const memeJour = d.toDateString() === auj.toDateString();
  const hier = new Date(auj);
  hier.setDate(hier.getDate() - 1);
  if (memeJour) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === hier.toDateString()) return 'Hier';
  if (auj - d < 7 * 86400000) return d.toLocaleDateString('fr-FR', { weekday: 'long' });
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function identifiant(prefixe = 'id') {
  return `${prefixe}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/* --------------------------- rendu Markdown --------------------------- */

// cache du HTML rendu : éviter de re-rendre les mêmes messages à chaque
// va-et-vient entre conversations
const cacheHtmlMessages = new WeakMap();

const renduMarkdown = (() => {
  if (window.marked) {
    marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
  }

  function preparer(texte) {
    let s = String(texte ?? '');

    // frontmatter YAML : rendu comme un bloc de propriétés, pas comme du texte brut
    let frontmatter = null;
    const fmMatch = s.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (fmMatch) {
      frontmatter = fmMatch[1];
      s = s.slice(fmMatch[0].length);
    }

    // liens wiki [[Note]] / [[Note|alias]]
    s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, note, alias) => {
      const cible = note.trim();
      const libelle = (alias || cible).trim();
      return `<a class="wiki-lien" data-note="${echapper(cible)}">${echapper(libelle)}</a>`;
    });
    // tags inline
    s = s.replace(/(^|\s)#([\p{L}\p{N}_/-]{2,64})/gu, (m, pre, tag) => {
      if (/^\d+$/.test(tag)) return m;
      return `${pre}<span class="tag-inline" data-tag="${echapper(tag)}">#${echapper(tag)}</span>`;
    });

    if (frontmatter) {
      const lignes = frontmatter
        .split(/\r?\n/)
        .map((l) => `<span class="fm-ligne">${echapper(l)}</span>`)
        .join('\n');
      s = `<div class="frontmatter" title="Propriétés (frontmatter YAML)">${lignes}</div>\n\n` + s;
    }
    return s;
  }

  function rendre(texte) {
    let html;
    try {
      html = window.marked ? marked.parse(preparer(texte)) : `<p>${echapper(texte)}</p>`;
    } catch {
      html = `<p>${echapper(texte)}</p>`;
    }
    if (window.DOMPurify) {
      html = DOMPurify.sanitize(html, {
        ADD_ATTR: ['data-note', 'data-tag', 'target', 'rel', 'title'],
        ADD_TAGS: ['input'],
        // formulaires et cadres n'ont aucune raison d'apparaître dans une note :
        // une note est du contenu, pas une page web.
        FORBID_TAGS: ['form', 'object', 'embed', 'iframe', 'base', 'link', 'meta'],
        FORBID_ATTR: ['action', 'formaction', 'srcdoc', 'ping']
      });
    }
    return html;
  }

  function embellir(conteneur) {
    conteneur.querySelectorAll('pre code').forEach((bloc) => {
      if (window.hljs) {
        try { hljs.highlightElement(bloc); } catch { /* ignore */ }
      }
      const pre = bloc.parentElement;
      if (pre && !pre.querySelector('.btn-copier-code')) {
        const btn = el('button', { class: 'btn-copier-code', text: 'Copier' });
        btn.addEventListener('click', async () => {
          await navigator.clipboard.writeText(bloc.textContent || '');
          btn.textContent = 'Copié !';
          setTimeout(() => { btn.textContent = 'Copier'; }, 1400);
        });
        pre.append(btn);
      }
    });
    conteneur.querySelectorAll('.wiki-lien').forEach((a) => {
      a.addEventListener('click', () => ouvrirNote(a.dataset.note));
    });
    conteneur.querySelectorAll('.tag-inline').forEach((t) => {
      t.addEventListener('click', () => rechercherTag(t.dataset.tag));
    });
    conteneur.querySelectorAll('a[href^="http"]').forEach((a) => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
  }

  return { rendre, embellir };
})();

/* ═══════════════════════════ INITIALISATION ═══════════════════════════ */

async function demarrer() {
  // les animations s'arrêtent quand la fenêtre n'est pas active
  window.addEventListener('blur', () => document.body.classList.add('fenetre-inactive'));
  window.addEventListener('focus', () => document.body.classList.remove('fenetre-inactive'));

  etat.config = await API.config.obtenir();
  etat.conversations = etat.config.conversations || [];
  // le modèle et le niveau de raisonnement choisis survivent au redémarrage
  etat.effortsSession = { ...(etat.config.efforts || {}) };
  etat.modelesSession = Object.fromEntries(
    Object.entries(etat.config.providers || {})
      .map(([id, p]) => [id, p.model])
      .filter(([, modele]) => modele)
  );

  // dossier personnel, pour développer les chemins des exemples MCP
  try {
    etat.dossierPersonnel = (await API.app.infos()).dossierPersonnel || '';
  } catch { /* l'information reste vide, les chemins absolus fonctionneront */ }

  appliquerTheme(etat.config.ui?.theme || 'sombre');
  appliquerEchelle(etat.config.ui?.fontScale || 1);
  appliquerEffets(etat.config.ui?.effets !== false);

  if (etat.config.ui?.sidebarOpen === false) $('#sidebar').classList.add('repliee');
  // le réglage « panneau latéral ouvert » pilote l'état au démarrage
  if ((etat.config.general || {}).panneauOuvert === false) {
    $('#panneauObsidian').classList.add('replie');
  } else {
    $('#panneauObsidian').classList.remove('replie');
  }
  // la disposition et la largeur du panneau s'appliquent dès le démarrage,
  // sans attendre l'ouverture des réglages
  appliquerDispositionPanneau();

  brancherEvenements();
  synchroniserHauteurEntete();
  window.addEventListener('resize', synchroniserHauteurEntete);
  initialiserTerminal();
  initialiserPieces();
  await rafraichirFournisseurs();
  await rafraichirCoffre();
  await rafraichirWorkspace();
  definirMode((etat.config.general || {}).modeDemarrage || etat.config.mode || 'complet', { persister: false });
  // Nettoyage : les conversations vides héritées des anciennes versions
  // (une par lancement) sont retirées de la liste. On garde celle qui est
  // ouverte s'il n'y a rien d'autre, pour ne pas laisser l'écran vide.
  const general = etat.config.general || {};
  let nonVides = etat.conversations.filter((c) => Array.isArray(c.messages) && c.messages.length);
  // limite d'historique configurée
  const limite = Math.max(10, Number(general.historiqueMax) || 200);
  if (nonVides.length > limite) nonVides = nonVides.slice(0, limite);
  etat.conversations = nonVides;

  // « Restaurer la dernière conversation » décide si on rouvre l'ancienne ou
  // si on démarre sur une discussion neuve (les anciennes restent listées).
  const aReprendre = general.restaurerDerniere
    ? [...etat.conversations]
      .sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0))
      .find((c) => Array.isArray(c.messages) && c.messages.length)
    : null;
  if (aReprendre) {
    chargerConversation(aReprendre.id);
  } else {
    nouvelleConversation({ silencieux: true });
  }
  afficherConversations();
  ajusterHauteurSaisie();
  restaurerBrouillon();

  synchroniserHauteurEntete();

  API.app.surMajDisponible?.((info) => notifierMaj(info.version, info.url));
  API.agent.surEvenement(traiterEvenementAgent);
  API.menu.surAction(traiterActionMenu);

  const infos = await API.app.infos();
  $('#infoVersion').textContent = infos.version;
  $('#infoElectron').textContent = infos.electron;
  $('#infoNode').textContent = infos.node;
  $('#infoChrome').textContent = infos.chrome;
  $('#infoConfig').textContent = infos.configPath;

  if (!etat.config.vaults?.length) {
    setTimeout(() => notifier("Aucun coffre Obsidian configuré. Ouvre les réglages → Coffres pour en ajouter un.", 'info', 6000), 800);
  }
  if (!cleConfiguree()) {
    setTimeout(() => notifier("Ajoute une clé d'API dans Réglages → Fournisseurs pour commencer.", 'info', 6000), 1500);
  }
}

function cleConfiguree() {
  const p = etat.config.providers?.[etat.config.activeProvider];
  return Boolean(p && p.hasKey);
}

function appliquerTheme(theme) {
  const nom = theme === 'clair' ? 'clair' : 'sombre';
  document.body.dataset.theme = nom;
  // garde les menus/dialogues natifs en accord avec le thème de l'interface
  API.app?.definirTheme?.(nom)?.catch?.(() => {});
}

/** Active ou coupe les effets visuels (halo, grille, lueurs). */
function appliquerEffets(actif) {
  document.body.classList.toggle('effets', actif !== false);
}

function appliquerEchelle(valeur) {
  document.documentElement.style.setProperty('--echelle', String(valeur));
}

/* ═══════════════════════════ FOURNISSEURS ═══════════════════════════ */

async function rafraichirFournisseurs() {
  // Le sélecteur à deux niveaux (src/model-selector.js) remplace les anciens
  // menus déroulants. On lui laisse le rendu, on rafraîchit seulement les données.
  rafraichirModeles();
  majStatutFournisseur();
  rendreCartesFournisseurs();
  window.cerveauModele?.rendre?.();
}

/**
 * Liste complète des modèles d'un fournisseur :
 *  - modèles intégrés (Anthropic, DeepSeek, OpenAI)
 *  - modèles ajoutés par l'utilisateur (providers[x].modeles)
 *  - modèles découverts via l'API /v1/models
 */
function modelesDe(id) {
  const p = etat.config.providers?.[id] || {};
  const vus = new Set();
  const liste = [];

  const ajouter = (valeur, source) => {
    const v = String(valeur || '').trim();
    if (!v || vus.has(v)) return;
    vus.add(v);
    liste.push({ id: v, source });
  };

  // modèles de l'utilisateur d'abord (ce sont ceux qu'il a choisis)
  for (const m of p.modeles || []) ajouter(typeof m === 'string' ? m : m?.id, 'perso');
  // puis les découverts, conservés d'une session à l'autre
  for (const m of p.modelesDecouverts || []) ajouter(m, 'decouvert');
  for (const m of etat.modelesDecouverts[id] || []) ajouter(m, 'decouvert');
  // puis les intégrés
  for (const m of MODELES[id] || []) ajouter(m.id, 'integre');

  return liste;
}

function rafraichirModeles() {
  // Rendu désormais assuré par src/model-selector.js.
  window.cerveauModele?.rendre?.();
}

/** Un serveur local « Compatible OpenAI » n'exige pas de clé. */
function fournisseurSansCle(id, p) {
  return id === 'custom' && Boolean(String(p?.baseUrl || '').trim());
}

function majStatutFournisseur() {
  const id = etat.config.activeProvider;
  const p = etat.config.providers?.[id];
  const statut = $('#statutFournisseur');
  const nom = NOMS_FOURNISSEURS[id] || id;
  const modele = etat.modelesSession[id] || p?.model || 'modèle ?';
  statut.className = 'statut';
  if (p?.hasKey || fournisseurSansCle(id, p)) {
    statut.classList.add('ok');
    statut.textContent = `${nom} · ${modele}`;
    $('#infoContexte').textContent = `Coffre : ${etat.config.vaults?.find((v) => v.id === etat.config.activeVaultId)?.name || 'aucun'}`;
  } else {
    statut.classList.add('erreur');
    statut.textContent = `${nom} · clé manquante`;
    $('#infoContexte').textContent = "Ajoute une clé d'API dans les réglages";
  }
}

function rendreCartesFournisseurs() {
  const conteneur = $('#listeFournisseurs');

  // Conserve les valeurs saisies mais pas encore enregistrées : un simple
  // changement de thème (ou un test de connexion) redessine les cartes et
  // effaçait la clé d'API que l'utilisateur venait de coller.
  const saisies = new Map();
  for (const input of conteneur.querySelectorAll('input[data-provider][data-champ]')) {
    if (input.value) saisies.set(`${input.dataset.provider}:${input.dataset.champ}`, input.value);
  }
  const saisie = (id, champ) => saisies.get(`${id}:${champ}`);

  conteneur.innerHTML = '';
  const cfg = etat.config;

  for (const id of Object.keys(NOMS_FOURNISSEURS)) {
    const p = cfg.providers?.[id] || { apiKey: '', baseUrl: '', model: '', hasKey: false };
    const carte = el('div', {
      class: `carte-fournisseur${id === cfg.activeProvider ? ' actif' : ''}`,
      'data-provider-id': id
    });

    const entete = el('div', { class: 'carte-entete' },
      el('div', { class: 'carte-titre' },
        NOMS_FOURNISSEURS[id],
        p.hasKey ? el('span', { class: 'badge ok', text: 'clé enregistrée' })
          : fournisseurSansCle(id, p) ? el('span', { class: 'badge ok', text: 'sans clé (local)' })
          : el('span', { class: 'badge', text: 'non configuré' })
      ),
      el('button', {
        class: 'btn-mini',
        text: id === cfg.activeProvider ? '★ Par défaut' : 'Définir par défaut',
        onclick: async () => {
          await enregistrerConfig({ activeProvider: id });
          notifier(`Fournisseur par défaut : ${NOMS_FOURNISSEURS[id]}`, 'succes');
        }
      })
    );

    const grille = el('div', { class: 'grille-fournisseur' });

    const champCle = el('label', { class: 'champ pleine' },
      el('span', { text: "Clé d'API" }),
      el('input', {
        type: 'password',
        value: saisie(id, 'apiKey') || '',
        placeholder: p.hasKey ? '•••••••• (laisser vide pour conserver)' : 'sk-…',
        'data-champ': 'apiKey',
        'data-provider': id
      })
    );

    const champUrl = el('label', { class: 'champ' },
      el('span', { text: 'URL de base' }),
      el('input', {
        type: 'text',
        value: saisie(id, 'baseUrl') || p.baseUrl || PLACEHOLDERS[id] || '',
        placeholder: PLACEHOLDERS[id] || '',
        'data-champ': 'baseUrl',
        'data-provider': id
      })
    );

    const champModele = el('label', { class: 'champ pleine' },
      el('span', { text: 'Modèle par défaut' }),
      el('input', {
        type: 'text',
        value: saisie(id, 'model') || p.model || '',
        placeholder: MODELES[id]?.[0]?.id || 'nom-du-modèle',
        'data-champ': 'model',
        'data-provider': id
      })
    );

    // Entrée enregistre la carte : on colle souvent une clé puis on valide
    // au clavier, sans cliquer sur « Enregistrer ».
    for (const champ of [champCle, champUrl, champModele]) {
      champ.querySelector('input').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        sauverFournisseur(id);
      });
    }

    grille.append(champCle, champUrl, champModele);

    // --- gestion des modèles multiples ---
    const zoneModeles = el('div', { class: 'zone-modeles', 'data-zone': id });

    const enteteModeles = el('div', { class: 'zone-modeles-entete' },
      el('span', { class: 'zone-modeles-titre', text: `Modèles disponibles (${modelesDe(id).length + (p.model && !modelesDe(id).some((m) => m.id === p.model) ? 1 : 0)})` }),
      el('div', { class: 'zone-modeles-actions' },
        el('button', {
          class: 'btn-mini',
          'data-detecter': '',
          text: '⟳ Détecter',
          title: "Interroger le fournisseur pour lister ses modèles",
          onclick: () => detecterModeles(id)
        })
      )
    );

    const listeModeles = el('div', { class: 'liste-modeles' });
    rendreListeModeles(id, listeModeles);

    const ajout = el('div', { class: 'ajout-modele' },
      el('input', {
        type: 'text',
        class: 'champ-ajout-modele',
        placeholder: 'nom-du-modèle à ajouter…',
        'data-ajout': id
      }),
      el('button', {
        class: 'btn-mini',
        text: '+ Ajouter',
        onclick: () => ajouterModele(id, zoneModeles)
      })
    );

    ajout.querySelector('input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); ajouterModele(id, zoneModeles); }
    });

    zoneModeles.append(enteteModeles, listeModeles, ajout);
    grille.append(zoneModeles);
    carte._zoneModeles = zoneModeles;
    carte._listeModeles = listeModeles;

    const actions = el('div', { class: 'actions-fournisseur' });
    const resultat = el('span', { class: 'message-test' });
    const btnEnregistrer = el('button', { class: 'btn-secondaire', text: 'Enregistrer', onclick: () => sauverFournisseur(id) });
    const btnTester = el('button', { class: 'btn-mini', text: 'Tester la connexion', onclick: () => testerFournisseur(id) });
    actions.append(btnEnregistrer, btnTester, resultat);

    carte.append(entete, grille, actions);
    conteneur.append(carte);
  }

  const defaut = $('#fournisseurDefaut');
  defaut.innerHTML = '';
  for (const id of Object.keys(NOMS_FOURNISSEURS)) {
    const opt = el('option', { value: id, text: NOMS_FOURNISSEURS[id] });
    if (id === cfg.activeProvider) opt.selected = true;
    defaut.append(opt);
  }
}

/**
 * Réduit l'historique envoyé au modèle.
 *
 * Deux limites combinées :
 *  - un nombre maximum de messages (les plus récents) ;
 *  - une taille de texte cumulée, pour rester sous la fenêtre de contexte.
 * Le dernier message de l'utilisateur est toujours conservé.
 */
function bornHistorique(messages, { maxMessages = 40, maxCaracteres = 120000 } = {}) {
  if (!Array.isArray(messages) || !messages.length) return [];

  const recents = messages.slice(-maxMessages);
  const gardes = [];
  let total = 0;

  // on remonte du plus récent au plus ancien
  for (let i = recents.length - 1; i >= 0; i--) {
    const m = recents[i];
    const taille = String(m.contenu || '').length;
    if (gardes.length && total + taille > maxCaracteres) break;
    // les images doivent survivre à la réduction de l'historique
    gardes.unshift({
      role: m.role,
      contenu: m.contenu,
      ...(Array.isArray(m.images) && m.images.length ? { images: m.images } : {})
    });
    total += taille;
  }

  // un historique doit commencer par un message utilisateur
  while (gardes.length > 1 && gardes[0].role !== 'user') gardes.shift();

  return gardes;
}

/* ═══════════════════════════ PIÈCES JOINTES ═══════════════════════════ */

let piecesJointes = [];

function rendrePieces() {
  const zone = $('#listePieces');
  if (!zone) return;
  zone.innerHTML = '';
  if (!piecesJointes.length) {
    zone.hidden = true;
    return;
  }
  zone.hidden = false;
  for (let i = 0; i < piecesJointes.length; i++) {
    const p = piecesJointes[i];
    const puce = el('div', { class: 'piece' },
      p.type === 'image'
        ? el('img', {
            class: 'piece-vignette', src: p.dataUrl, alt: p.nom,
            title: 'Cliquer pour agrandir',
            onclick: () => ouvrirImage(p.dataUrl, p.nom)
          })
        : el('span', { class: 'piece-icone', text: '🗎' }),
      el('span', { class: 'piece-nom', text: p.nom, title: p.nom }),
      el('span', { class: 'piece-taille', text: `${Math.max(1, Math.round((p.taille || 0) / 1024))} Ko` }),
      el('button', {
        class: 'piece-retirer', text: '✕', title: 'Retirer',
        onclick: () => { piecesJointes.splice(i, 1); rendrePieces(); }
      })
    );
    zone.append(puce);
  }
}

async function ajouterFichiers(chemins) {
  for (const c of chemins.slice(0, 8)) {
    const r = await API.fichiers.lire(c);
    if (!r.ok) {
      notifier(`${c.split('/').pop()} : ${r.message}`, 'erreur', 4000);
      continue;
    }
    piecesJointes.push(r);
  }
  rendrePieces();
}

async function choisirFichiers() {
  const r = await API.fichiers.choisir();
  if (!r.ok) return;
  await ajouterFichiers(r.chemins);
}

/**
 * Compose le message final avec les pièces jointes.
 *
 * Le texte et les fichiers texte voyagent dans `contenu`. Les images sont
 * conservées à part : un modèle ne lit pas « [image jointe : chat.png] », il a
 * besoin des octets. Elles sont donc ajoutées au message sous forme structurée
 * (`images`), que l'agent transformera au format du fournisseur.
 */
function composerMessage(texte) {
  if (!piecesJointes.length) return texte;
  const morceaux = [texte];
  for (const p of piecesJointes) {
    if (p.type === 'texte') {
      morceaux.push(`\n\n<fichier nom="${p.nom}" langage="${p.langage}">\n${p.contenu}\n</fichier>`);
    } else if (p.type === 'image') {
      // repère lisible dans le texte, en plus des données structurées
      morceaux.push(`\n\n[image jointe : ${p.nom}]`);
    }
  }
  return morceaux.join('');
}

/** Images des pièces jointes courantes, au format attendu par l'agent. */
function imagesJointes() {
  return piecesJointes
    .filter((p) => p.type === 'image' && p.dataUrl)
    .map((p) => ({ nom: p.nom, dataUrl: p.dataUrl, mime: p.mime }));
}

function initialiserPieces() {
  const depot = document.querySelector('.principal');

  // glisser-déposer sur toute la zone principale
  ['dragenter', 'dragover'].forEach((evt) => {
    document.addEventListener(evt, (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const indic = $('#zoneDepot');
      if (indic) indic.hidden = false;
    });
  });

  ['dragleave', 'drop'].forEach((evt) => {
    document.addEventListener(evt, (e) => {
      if (evt === 'dragleave' && e.relatedTarget) return;
      const indic = $('#zoneDepot');
      if (indic) indic.hidden = true;
    });
  });

  document.addEventListener('drop', async (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    // File.path n'existe plus depuis Electron 32 : le chemin vient de webUtils.
    const chemins = [...e.dataTransfer.files]
      .map((f) => API.fichiers.cheminDe(f))
      .filter(Boolean);

    if (chemins.length) {
      await ajouterFichiers(chemins);
    } else {
      // repli : certains fichiers (captures, contenus distants) n'ont pas de chemin
      for (const f of e.dataTransfer.files) {
        if (!f.type.startsWith('image/')) continue;
        const dataUrl = await new Promise((res) => {
          const l = new FileReader();
          l.onload = () => res(l.result);
          l.readAsDataURL(f);
        });
        piecesJointes.push({
          type: 'image', nom: f.name || 'image.png', taille: f.size,
          mime: f.type, dataUrl
        });
      }
      rendrePieces();
    }
  });

  // collage d'image depuis le presse-papiers
  document.addEventListener('paste', async (e) => {
    const items = [...(e.clipboardData?.items || [])];
    for (const it of items) {
      if (it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (!f) continue;
        const lecteur = new FileReader();
        lecteur.onload = () => {
          piecesJointes.push({
            type: 'image', nom: f.name || 'collage.png', taille: f.size,
            mime: it.type, dataUrl: lecteur.result
          });
          rendrePieces();
          notifier('Image collée.', 'succes', 1600);
        };
        lecteur.readAsDataURL(f);
      }
    }
  });

  $('#btnJoindre')?.addEventListener('click', (e) => {
    e.preventDefault();
    choisirFichiers();
  });
}

/* ═══════════════════════════ TERMINAL INTÉGRÉ ═══════════════════════════ */

const historiqueTerminal = [];
let indexHistorique = -1;

function ajouterLigneTerminal(type, texte) {
  const zone = $('#terminalSortie');
  if (!zone) return;
  const ligne = el('div', { class: `terminal-ligne ${type}`, text: texte });
  zone.append(ligne);
  zone.scrollTop = zone.scrollHeight;
}

async function executerTerminal() {
  const champ = $('#terminalCommande');
  if (!champ) return;
  const cmd = champ.value.trim();
  if (!cmd) return;

  historiqueTerminal.push(cmd);
  indexHistorique = historiqueTerminal.length;
  champ.value = '';

  ajouterLigneTerminal('commande', `$ ${cmd}`);
  const attente = el('div', { class: 'terminal-ligne attente', text: '…' });
  $('#terminalSortie')?.append(attente);

  const r = await API.terminal.executer(cmd, { delai: 60 });
  attente.remove();

  if (!r.ok) {
    ajouterLigneTerminal('erreur', r.message || 'Échec.');
    return;
  }
  if (r.stdout?.trim()) ajouterLigneTerminal('sortie', r.stdout.trimEnd());
  if (r.stderr?.trim()) ajouterLigneTerminal('erreur', r.stderr.trimEnd());
  if (!r.stdout?.trim() && !r.stderr?.trim()) ajouterLigneTerminal('muet', '(aucune sortie)');
  if (r.code !== 0) ajouterLigneTerminal('code', `code de sortie : ${r.code}`);
}

function initialiserTerminal() {
  const champ = $('#terminalCommande');
  if (!champ) return;

  champ.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executerTerminal();
      return;
    }
    // historique ↑ ↓
    if (e.key === 'ArrowUp' && historiqueTerminal.length) {
      e.preventDefault();
      indexHistorique = Math.max(0, indexHistorique - 1);
      champ.value = historiqueTerminal[indexHistorique] || '';
    } else if (e.key === 'ArrowDown' && historiqueTerminal.length) {
      e.preventDefault();
      indexHistorique = Math.min(historiqueTerminal.length, indexHistorique + 1);
      champ.value = historiqueTerminal[indexHistorique] || '';
    }
  });

  $('#btnTerminalExec')?.addEventListener('click', executerTerminal);
  $('#btnTerminalEffacer')?.addEventListener('click', () => {
    const zone = $('#terminalSortie');
    if (zone) zone.innerHTML = '';
  });
}

/* ═══════════════════════════ PLANIFICATION ═══════════════════════════ */

/** « dans 5 min », « dans 2 h », « maintenant ». */
function delaiLisible(ms) {
  if (ms == null) return '—';
  if (ms <= 2000) return 'maintenant';
  const min = Math.round(ms / 60000);
  if (min < 60) return `dans ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `dans ${h} h`;
  return `dans ${Math.round(h / 24)} j`;
}

async function rendrePlanification() {
  const zone = $('#listePlanification');
  if (!zone) return;

  const r = await API.planification.lister();
  zone.innerHTML = '';

  const taches = r.taches || [];
  const resume = $('#planResume');
  if (resume) {
    resume.textContent = taches.length
      ? `${taches.length} tâche(s) · ${r.actives} active(s)`
        + (r.prochaineMs != null ? ` · prochaine ${delaiLisible(r.prochaineMs)}` : '')
      : 'Aucune tâche planifiée.';
  }

  // alimente la liste déroulante des objectifs
  const select = $('#planObjectif');
  if (select) {
    const valeur = select.value;
    const obj = await API.objectif.lister();
    const utiles = (obj.objectifs || []).filter((o) => o.etat === 'actif' || o.etat === 'suspendu');
    select.innerHTML = '<option value="">— Aucun (consigne libre) —</option>';
    for (const o of utiles) {
      select.append(el('option', { value: o.id, text: o.titre.slice(0, 60) }));
    }
    select.value = valeur;
  }

  if (!taches.length) {
    zone.append(el('p', { class: 'vide petit', text: 'Rien de planifié.' }));
    return;
  }

  for (const t of taches) {
    const dernier = t.historique?.[t.historique.length - 1];
    const carte = el('div', { class: 'objectif' },
      el('div', { class: 'objectif-tete' },
        el('span', { class: `objectif-etat ${t.actif ? 'encours' : 'attente'}`,
          text: t.actif ? 'Active' : 'En pause' }),
        el('span', { class: 'objectif-titre', text: t.nom }),
        el('span', { class: 'objectif-tours', text: t.description })
      ),
      el('div', { class: 'objectif-critere', text: t.objectifId
        ? 'Relance un tour de l’objectif sélectionné.'
        : (t.consigne || '').slice(0, 160) }),
      (() => {
        const niveauActuel = t.niveau || 'lecture';
        const sel = el('select', {
          class: 'plan-niveau-select',
          onchange: async (e) => {
            const res = await API.planification.changerNiveau({
              id: t.id, niveau: e.target.value
            });
            if (res.ok) notifier('Autonomie modifiée.', 'succes', 2500);
            else notifier(res.message || 'Modification impossible.', 'erreur');
            await rendrePlanification();
          }
        },
          ...['lecture', 'ecriture', 'commandes', 'complet'].map((n) =>
            el('option', {
              value: n,
              text: { lecture: 'Lecture seule', ecriture: 'Écriture', commandes: 'Commandes', complet: 'Complet' }[n]
            })
          )
        );
        // la valeur se pose APRÈS l'ajout des options : l'attribut « selected »
        // est une présence, donc « selected: false » sélectionnait quand même.
        sel.value = niveauActuel;
        return el('div', { class: 'plan-niveau-ligne' },
          el('span', { text: 'Autonomie : ' }), sel);
      })(),
      t.actif && t.dansMs != null
        ? el('div', { class: 'objectif-suite', text: `Prochain passage ${delaiLisible(t.dansMs)}` })
        : null,
      t.pauseAuto ? el('div', { class: 'objectif-blocage', text: t.pauseAuto }) : null,
      t.executions ? el('div', { class: 'objectif-dernier', text:
        `${t.executions} exécution(s)` + (dernier
          ? ` · dernière ${formaterDate(dernier.quand)} : ${(dernier.resume || dernier.erreur || '').slice(0, 90)}`
          : '') }) : null,
      el('div', { class: 'objectif-actions' })
    );

    const actions = carte.querySelector('.objectif-actions');

    actions.append(el('button', {
      class: 'btn-mini', text: 'Exécuter maintenant',
      onclick: async (e) => {
        const b = e.currentTarget;
        b.disabled = true; b.textContent = 'En cours…';
        const res = await API.planification.executer(t.id);
        b.disabled = false; b.textContent = 'Exécuter maintenant';
        if (res.ok) notifier('Tâche exécutée.', 'succes', 3000);
        else notifier(res.message || 'Échec de la tâche.', 'erreur', 5000);
        await rendrePlanification();
      }
    }));

    actions.append(el('button', {
      class: 'btn-mini', text: t.actif ? 'Mettre en pause' : 'Reprendre',
      onclick: async () => {
        await API.planification.basculer({ id: t.id, actif: !t.actif });
        await rendrePlanification();
      }
    }));

    actions.append(el('button', {
      class: 'btn-modele danger', text: '✕', title: 'Supprimer',
      onclick: async () => {
        if (!confirm(`Supprimer « ${t.nom} » ?`)) return;
        await API.planification.supprimer(t.id);
        await rendrePlanification();
      }
    }));

    zone.append(carte);
  }
}

/** Branche les écouteurs — une seule fois dans la vie de l'application. */
function brancherPlanification() {
  if (brancherPlanification.fait) return;
  brancherPlanification.fait = true;

  $('#btnPlanCreer')?.addEventListener('click', async () => {
    const nom = $('#planNom')?.value.trim();
    const consigne = $('#planConsigne')?.value.trim();
    const frequence = $('#planFrequence')?.value.trim() || 'toutes les heures';
    const objectifId = $('#planObjectif')?.value || null;

    if (!nom) return notifier('Donnez un nom à la tâche.', 'erreur', 3000);
    if (!consigne && !objectifId) {
      return notifier('Écrivez une consigne, ou choisissez un objectif.', 'erreur', 4000);
    }

    // la fréquence est lue en français ; si elle est incomprise, on le dit
    const analyse = await API.planification.analyser(frequence);
    if (!analyse.ok) {
      return notifier(`Fréquence incomprise : « ${frequence} ». Essayez « toutes les 2 heures ».`, 'erreur', 6000);
    }

    const r = await API.planification.creer({
      nom, consigne, objectifId,
      intervalle: analyse.intervalle,
      echelle: analyse.echelle,
      niveau: $('#planNiveau')?.value || 'lecture'
    });

    if (r.ok) {
      if ($('#planNom')) $('#planNom').value = '';
      if ($('#planConsigne')) $('#planConsigne').value = '';
      const unites = { minutes: 'minute', heures: 'heure', jours: 'jour' };
      const mot = unites[analyse.echelle] || 'heure';
      notifier(`Tâche créée : ${analyse.intervalle} ${mot}${analyse.intervalle > 1 ? 's' : ''}.`, 'succes', 4000);
      await rendrePlanification();
    } else {
      notifier(r.message || 'Création impossible.', 'erreur', 4000);
    }
  });

  // aide sous le sélecteur d'autonomie
  const majAideNiveau = () => {
    const aide = $('#planNiveauAide');
    if (!aide) return;
    const textes = {
      lecture: 'Consultation seulement : rien ne peut être modifié, exécuté ni supprimé.',
      ecriture: 'Peut créer et modifier des fichiers dans l’espace de travail. Pas de commande shell.',
      commandes: 'Peut exécuter des commandes shell. Pas de suppression ni de push.',
      complet: 'Commandes, écriture, git push et actions GitHub. À réserver aux tâches de confiance.'
    };
    aide.textContent = textes[$('#planNiveau')?.value] || '';
    aide.style.color = $('#planNiveau')?.value === 'complet' ? 'var(--danger)' : '';
  };
  $('#planNiveau')?.addEventListener('change', majAideNiveau);
  majAideNiveau();

  // aperçu de la fréquence pendant la saisie
  let minuteurFreq = null;
  $('#planFrequence')?.addEventListener('input', () => {
    clearTimeout(minuteurFreq);
    minuteurFreq = setTimeout(async () => {
      const texte = $('#planFrequence')?.value.trim();
      if (!texte) return;
      const r = await API.planification.analyser(texte);
      const zone = $('#planFrequence');
      if (zone) zone.style.borderColor = r.ok ? '' : 'var(--danger)';
    }, 400);
  });

  API.planification.surEvenement((evt) => {
    if (evt.type === 'debut') notifier(`Tâche « ${evt.nom} » démarrée.`, 'info', 2500);
    if (evt.type === 'fin') {
      if (evt.ok) notifier(`Tâche « ${evt.nom} » terminée.`, 'succes', 3000);
      else notifier(`Tâche « ${evt.nom} » : ${evt.erreur || 'échec'}`, 'erreur', 6000);
      rendrePlanification();
    }
  });
}

/** Rafraîchit l'affichage — à chaque ouverture des réglages. */
function initialiserPlanification() {
  brancherPlanification();
  rendrePlanification();
}

/* ═══════════════════════════ OBJECTIFS ═══════════════════════════ */

const ETATS_OBJECTIF = {
  actif: { texte: 'En cours', classe: 'encours' },
  suspendu: { texte: 'Suspendu', classe: 'attente' },
  termine: { texte: 'Terminé', classe: 'ok' },
  abandonne: { texte: 'Abandonné', classe: 'echec' }
};

async function rendreObjectifs() {
  const zone = $('#listeObjectifs');
  if (!zone) return;

  const r = await API.objectif.lister();
  zone.innerHTML = '';

  const objectifs = r.objectifs || [];
  const resume = $('#objectifResume');
  if (resume) {
    if (!objectifs.length) {
      resume.textContent = "Aucun objectif pour le moment. Décrivez-en un ci-dessus.";
    } else {
      const actifs = objectifs.filter((o) => o.etat === 'actif').length;
      const termines = objectifs.filter((o) => o.etat === 'termine').length;
      resume.textContent = `${objectifs.length} objectif(s) · ${actifs} en cours · ${termines} terminé(s).`;
    }
  }

  if (!objectifs.length) {
    zone.append(el('p', { class: 'vide petit', text: 'Rien en cours.' }));
    return;
  }

  for (const o of objectifs) {
    const etat = ETATS_OBJECTIF[o.etat] || { texte: o.etat, classe: '' };
    const dernier = o.historique?.[o.historique.length - 1];

    const carte = el('div', { class: 'objectif' },
      el('div', { class: 'objectif-tete' },
        el('span', { class: `objectif-etat ${etat.classe}`, text: etat.texte }),
        el('span', { class: 'objectif-titre', text: o.titre }),
        el('span', { class: 'objectif-tours', text: `${o.tours || 0}/${o.maxTours} tours` })
      ),
      el('div', { class: 'objectif-barre' },
        el('div', { class: 'objectif-barre-remplie', style: `width:${o.progression || 0}%` })
      ),
      o.critere ? el('div', { class: 'objectif-critere', text: `Réussi si : ${o.critere}` }) : null,
      o.blocage ? el('div', { class: 'objectif-blocage', text: o.blocage }) : null,
      o.prochainPas ? el('div', { class: 'objectif-suite', text: `Suite : ${o.prochainPas.slice(0, 160)}` }) : null,
      dernier ? el('div', { class: 'objectif-dernier', text: `Dernier tour : ${dernier.resume.slice(0, 140)}` }) : null,
      el('div', { class: 'objectif-actions' })
    );

    const actions = carte.querySelector('.objectif-actions');

    if (o.etat === 'actif' || o.etat === 'suspendu') {
      actions.append(el('button', {
        class: 'btn-mini',
        text: o.etat === 'suspendu' ? 'Reprendre' : 'Tour suivant',
        onclick: async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          b.textContent = 'En cours…';
          if (o.etat === 'suspendu') {
            await API.objectif.changerEtat({ id: o.id, etat: 'actif' });
          }
          const res = await API.objectif.tour(o.id);
          b.disabled = false;
          b.textContent = 'Tour suivant';
          if (res.ok) {
            notifier(`Tour ${res.objectif.tours} terminé.`, 'succes', 3000);
            if (res.objectif.etat === 'termine') notifier('Objectif atteint.', 'succes', 5000);
          } else {
            notifier(res.message || 'Le tour a échoué.', 'erreur', 5000);
          }
          await rendreObjectifs();
        }
      }));

      if (o.etat === 'actif') {
        actions.append(el('button', {
          class: 'btn-mini', text: 'Suspendre',
          onclick: async () => {
            await API.objectif.changerEtat({ id: o.id, etat: 'suspendu' });
            await rendreObjectifs();
          }
        }));
      }
    }

    if (o.etat !== 'abandonne' && o.etat !== 'termine') {
      actions.append(el('button', {
        class: 'btn-mini danger', text: 'Abandonner',
        onclick: async () => {
          if (!confirm(`Abandonner « ${o.titre} » ?`)) return;
          await API.objectif.changerEtat({ id: o.id, etat: 'abandonne' });
          await rendreObjectifs();
        }
      }));
    }

    actions.append(el('button', {
      class: 'btn-modele danger', text: '✕', title: 'Supprimer',
      onclick: async () => {
        if (!confirm(`Supprimer définitivement « ${o.titre} » ?`)) return;
        await API.objectif.supprimer(o.id);
        await rendreObjectifs();
      }
    }));

    zone.append(carte);
  }
}

function brancherObjectifs() {
  if (brancherObjectifs.fait) return;
  brancherObjectifs.fait = true;

  $('#btnObjectifCreer')?.addEventListener('click', async () => {
    const titre = $('#objectifTitre')?.value.trim();
    if (!titre) return notifier("Donnez un titre à l'objectif.", 'erreur', 3000);

    const r = await API.objectif.creer({
      titre,
      description: $('#objectifDescription')?.value.trim() || '',
      critere: $('#objectifCritere')?.value.trim() || '',
      maxTours: Number($('#objectifMaxTours')?.value) || 20
    });

    if (r.ok) {
      if ($('#objectifTitre')) $('#objectifTitre').value = '';
      if ($('#objectifDescription')) $('#objectifDescription').value = '';
      if ($('#objectifCritere')) $('#objectifCritere').value = '';
      notifier('Objectif créé. Lancez le premier tour quand vous voulez.', 'succes', 4000);
      await rendreObjectifs();
    } else {
      notifier(r.message || 'Création impossible.', 'erreur', 4000);
    }
  });

  // les événements d'un tour mettent l'interface à jour
  API.objectif.surEvenement((evt) => {
    if (evt.type === 'tour:debut') {
      notifier(`Tour ${evt.tour} en cours…`, 'info', 2500);
    }
    if (evt.type === 'tour:fin') {
      rendreObjectifs();
      if (evt.objectif?.etat === 'termine') notifier('Objectif atteint.', 'succes', 6000);
      else if (evt.objectif?.etat === 'suspendu') notifier(`Objectif suspendu : ${evt.objectif.blocage || 'voir le suivi'}`, 'erreur', 6000);
    }
  });
}

function initialiserObjectifs() {
  brancherObjectifs();
  rendreObjectifs();
}

/* ═══════════════════════════ MÉMOIRE ═══════════════════════════ */

const NOMS_CATEGORIES = {
  preference: 'Préférence',
  projet: 'Projet',
  decision: 'Décision',
  fait: 'Fait'
};

async function rendreMemoire() {
  const zone = $('#listeMemoire');
  if (!zone) return;

  const r = await API.memoire.lister();
  zone.innerHTML = '';

  const entrees = r.entrees || [];
  const resume = $('#memoireResume');
  if (resume) {
    resume.textContent = entrees.length
      ? `${entrees.length} fait(s) retenu(s). Les plus utilisés sont rappelés en premier.`
      : "Aucun fait pour le moment. Cerveau en retiendra aussi de lui-même quand c'est utile.";
    resume.style.color = '';
  }

  if (!entrees.length) {
    zone.append(el('p', { class: 'vide petit', text: 'Rien en mémoire.' }));
    return;
  }

  for (const e of entrees) {
    const ligne = el('div', { class: 'fait-memoire' },
      el('span', { class: `fait-categorie cat-${e.categorie}`, text: NOMS_CATEGORIES[e.categorie] || 'Fait' }),
      el('div', { class: 'fait-corps' },
        el('div', { class: 'fait-texte', text: e.texte }),
        el('div', { class: 'fait-meta', text:
          `${e.source === 'agent' ? 'retenu par l’IA' : 'ajouté par vous'}`
          + (e.usage ? ` · utilisé ${e.usage} fois` : '')
          + (e.majLe ? ` · ${formaterDate(e.majLe)}` : '') })
      ),
      el('button', {
        class: 'btn-modele', text: 'Modifier', title: 'Modifier ce fait',
        onclick: async () => {
          const nouveau = await demanderTexte({
            titre: 'Modifier le fait retenu',
            valeur: e.texte,
            aide: 'Une phrase claire, 500 caractères maximum.'
          });
          if (!nouveau) return;
          const res = await API.memoire.modifier({ id: e.id, texte: nouveau });
          if (res.ok) { notifier('Fait modifié.', 'succes', 2000); await rendreMemoire(); }
          else notifier(res.message || 'Modification impossible.', 'erreur');
        }
      }),
      el('button', {
        class: 'btn-modele danger', text: '✕', title: 'Oublier ce fait',
        onclick: async () => {
          await API.memoire.supprimer(e.id);
          notifier('Fait oublié.', 'info', 2000);
          await rendreMemoire();
        }
      })
    );
    zone.append(ligne);
  }
}

function brancherMemoire() {
  if (brancherMemoire.fait) return;
  brancherMemoire.fait = true;

  $('#btnMemoireAjouter')?.addEventListener('click', async () => {
    const champ = $('#memoireTexte');
    const texte = champ?.value.trim();
    if (!texte) return notifier('Écrivez le fait à retenir.', 'erreur', 3000);

    const r = await API.memoire.ajouter({
      texte,
      categorie: $('#memoireCategorie')?.value || 'fait'
    });
    if (r.ok) {
      if (champ) champ.value = '';
      notifier(r.deja ? 'Ce fait était déjà connu.' : 'Fait retenu.', 'succes', 2500);
      await rendreMemoire();
    } else {
      notifier(r.message || 'Enregistrement impossible.', 'erreur', 4000);
    }
  });

  // Entrée valide depuis le champ
  $('#memoireTexte')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); $('#btnMemoireAjouter')?.click(); }
  });

  $('#btnMemoireVider')?.addEventListener('click', async () => {
    if (!confirm('Oublier définitivement tous les faits retenus ?')) return;
    await API.memoire.vider();
    notifier('Mémoire vidée.', 'info', 2500);
    await rendreMemoire();
  });
}

function initialiserMemoire() {
  brancherMemoire();
  rendreMemoire();
}

/* ═══════════════════════════ SUPERVISEUR ═══════════════════════════ */

/** Affiche l'état des outils externes dont dépendent les fonctions intégrées. */
async function rendreOutilsSysteme() {
  const zone = $('#outilsSysteme');
  if (!zone) return;

  const r = await API.diag.outils();
  zone.innerHTML = '';

  for (const o of r.outils || []) {
    const etat = o.present ? 'ok' : (o.requis ? 'manquant' : 'optionnel');
    const ligne = el('div', { class: 'outil-systeme' },
      el('span', { class: `outil-systeme-pastille ${etat}` }),
      el('div', { class: 'outil-systeme-corps' },
        el('div', { class: 'outil-systeme-nom', text: o.nom }),
        el('div', { class: 'outil-systeme-detail', text:
          o.present
            ? (o.version || 'présent')
            : o.requis
              ? `manquant — nécessaire pour : ${o.usage}`
              : `facultatif — ${o.usage}` })
      ),
      el('span', { class: 'outil-systeme-etat', text: o.present ? '✓' : (o.requis ? '✗' : '–') })
    );
    zone.append(ligne);
  }

  // état de la connexion GitHub
  const auth = r.auth || {};
  zone.append(el('div', { class: 'outil-systeme' },
    el('span', { class: `outil-systeme-pastille ${auth.connecte ? 'ok' : 'manquant'}` }),
    el('div', { class: 'outil-systeme-corps' },
      el('div', { class: 'outil-systeme-nom', text: 'Connexion GitHub' }),
      el('div', { class: 'outil-systeme-detail', text:
        auth.connecte
          ? (auth.detail || 'connecté')
          : 'non connecté — ouvrez l’onglet Dépôt pour vous connecter' })
    ),
    el('span', { class: 'outil-systeme-etat', text: auth.connecte ? '✓' : '✗' })
  ));

  // commande d'installation
  const bloc = $('#commandeManquante');
  if (bloc) {
    if (r.commande) {
      bloc.hidden = false;
      if ($('#texteCommandeManquante')) $('#texteCommandeManquante').textContent = r.commande;
    } else {
      bloc.hidden = true;
    }
  }
}

const ETATS_TICKET = {
  en_attente: { texte: 'En attente', classe: 'attente' },
  en_cours: { texte: 'En cours', classe: 'encours' },
  termine: { texte: 'Terminé', classe: 'ok' },
  echoue: { texte: 'Échec', classe: 'echec' }
};

function formaterDuree(ms) {
  if (!ms || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60}`;
}

function etiqueterPublication(p) {
  const parties = [];
  if (p.commentaire) parties.push('commentaire publié');
  else if (p.statut === 'commentaire' || p.statut === 'commentaire_seul' || p.statut === 'complet') parties.push('commentaire publié');
  if (p.url) parties.push('pull request ouverte');
  if (p.erreur) parties.push(`publication impossible : ${p.erreur}`);
  if (p.erreurPr) parties.push(`PR impossible : ${p.erreurPr}`);
  if (p.statut === 'desactivee') parties.push('publication désactivée');
  return parties.join(' · ') || 'aucune publication';
}

function rendreTickets(snap) {
  const zone = $('#supTickets');
  if (!zone) return;
  zone.innerHTML = '';

  const tickets = snap?.tickets || [];
  if (!tickets.length) {
    zone.append(el('p', { class: 'vide petit', text: 'Aucun ticket pour le moment.' }));
    return;
  }

  for (const t of tickets) {
    const etat = ETATS_TICKET[t.etat] || { texte: t.etat, classe: '' };
    const ligne = el('div', { class: 'ticket' },
      el('div', { class: 'ticket-tete' },
        el('span', { class: `ticket-etat ${etat.classe}`, text: etat.texte }),
        el('span', { class: 'ticket-origine', text: `${t.origine?.genre || ''} #${t.origine?.numero ?? '?'}` }),
        el('span', { class: 'ticket-auteur', text: t.origine?.auteur ? `par ${t.origine.auteur}` : '' })
      ),
      el('div', { class: 'ticket-titre', text: t.origine?.titre || t.resume || '' }),
      t.resume && t.etat !== 'en_attente' ? el('div', { class: 'ticket-resume', text: t.resume }) : null,
      t.erreur ? el('div', { class: 'ticket-erreur', text: t.erreur }) : null,
      t.branche ? el('div', { class: 'ticket-branche', text: `branche ${t.branche}` }) : null,
      t.avertissement ? el('div', { class: 'ticket-avert', text: t.avertissement }) : null,
      t.publication?.statut && t.publication.statut !== 'aucune'
        ? el('div', { class: 'ticket-publication' },
            el('span', { text: etiqueterPublication(t.publication) })
          )
        : null,
      el('div', { class: 'ticket-pied' },
        el('span', { text: t.creeLe ? formaterDate(t.creeLe) : '' }),
        t.duree ? el('span', { text: `· ${formaterDuree(t.duree)}` }) : null,
        t.outils ? el('span', { text: `· ${t.outils} outil(s)` }) : null
      )
    );
    zone.append(ligne);
  }
}

function majEtatSuperviseur(snap) {
  const texte = $('#supEtatTexte');
  if (texte) {
    if (snap?.actif) {
      const quand = snap.dernierPassage ? `Dernière vérification : ${formaterDate(snap.dernierPassage)}.` : 'Première vérification en cours…';
      texte.textContent = `En marche sur ${snap.config?.depot || '—'}, toutes les ${snap.config?.intervalle || 300} s. ${quand}`;
      texte.style.color = 'var(--succes)';
    } else {
      texte.textContent = snap?.depot ? 'Arrêté.' : 'Arrêté. Renseignez un dépôt puis démarrez.';
      texte.style.color = '';
    }
    if (snap?.derniereErreur) {
      texte.textContent += ` Dernière erreur : ${snap.derniereErreur}`;
      texte.style.color = 'var(--danger)';
    }
  }
  rendreTickets(snap);
}

/**
 * Branche les écouteurs du Superviseur — une seule fois.
 * Sans ce garde-fou, chaque ouverture des réglages empilait un écouteur
 * supplémentaire : au bout de onze, le moteur signalait une fuite mémoire.
 */
function brancherSuperviseur() {
  if (brancherSuperviseur.fait) return;
  brancherSuperviseur.fait = true;

  API.superviseur.surEvenement((evt) => {
    if (evt.type === 'ticket:cree') {
      notifier(`Nouveau ticket : ${evt.ticket?.origine?.titre || evt.ticket?.resume || ''}`, 'info', 4000);
    }
    if (evt.type === 'ticket:fin') {
      const t = evt.ticket;
      notifier(`Ticket #${t?.origine?.numero} ${t?.etat === 'termine' ? 'terminé' : 'échoué'}.`,
        t?.etat === 'termine' ? 'succes' : 'erreur', 5000);
    }
    rafraichirSuperviseur();
  });
}

/** Rafraîchit l'état du Superviseur affiché dans les réglages. */
async function rafraichirSuperviseur() {
  const r = await API.superviseur.etat();
  if (r.ok) majEtatSuperviseur(r);
  else notifier(r.message || 'Superviseur indisponible.', 'erreur', 4000);
}

let superviseurBranche = false;

async function initialiserSuperviseur() {
  brancherSuperviseur();
  const cfg = etat.config.superviseur || {};

  // Première ouverture : on branche tous les champs. Les suivantes se
  // contentent de rafraîchir l'affichage — sinon les écouteurs s'empilent.
  if (!superviseurBranche) {
    superviseurBranche = true;
    brancherChampsSuperviseur(cfg);
  }
  await rafraichirSuperviseur();
  await rendreOutilsSysteme();
}

function brancherChampsSuperviseur(cfg) {

  const depot = $('#supDepot');
  if (depot) {
    depot.value = cfg.depot || '';
    depot.addEventListener('change', async () => {
      await enregistrerConfig({ superviseur: { depot: depot.value.trim() } });
    });
  }

  const auteurs = $('#supAuteurs');
  if (auteurs) {
    auteurs.value = (cfg.auteursAutorises || []).join(', ');
    auteurs.addEventListener('change', async () => {
      const liste = auteurs.value.split(',').map((x) => x.trim()).filter(Boolean);
      auteurs.value = liste.join(', ');
      await enregistrerConfig({ superviseur: { auteursAutorises: liste } });
    });
  }

  const motif = $('#supMotif');
  if (motif) {
    motif.value = cfg.motifInvocation || '@cerveau';
    motif.addEventListener('change', async () => {
      await enregistrerConfig({ superviseur: { motifInvocation: motif.value.trim() || '@cerveau' } });
    });
  }

  const intervalle = $('#supIntervalle');
  if (intervalle) {
    intervalle.value = cfg.intervalle || 300;
    intervalle.addEventListener('change', async () => {
      const v = Math.min(Math.max(Number(intervalle.value) || 300, 60), 3600);
      intervalle.value = v;
      await enregistrerConfig({ superviseur: { intervalle: v } });
    });
  }

  const exiger = $('#supExigerInvocation');
  if (exiger) {
    exiger.checked = cfg.exigerInvocation !== false;
    exiger.addEventListener('change', async () => {
      await enregistrerConfig({ superviseur: { exigerInvocation: exiger.checked } });
    });
  }

  const pr = $('#supPR');
  if (pr) {
    pr.checked = cfg.surveillerPullRequests !== false;
    pr.addEventListener('change', async () => {
      await enregistrerConfig({ superviseur: { surveillerPullRequests: pr.checked } });
    });
  }

  const ws = $('#supWorkspace');
  if (ws) {
    ws.value = cfg.workspace || '';
    ws.addEventListener('change', async () => {
      await enregistrerConfig({ superviseur: { workspace: ws.value.trim() } });
    });
  }

  const publier = $('#supPublier');
  if (publier) {
    publier.checked = cfg.publierResultats !== false;
    publier.addEventListener('change', async () => {
      await enregistrerConfig({ superviseur: { publierResultats: publier.checked } });
    });
  }

  const cible = $('#supBrancheCible');
  if (cible) {
    cible.value = cfg.brancheCible || '';
    cible.addEventListener('change', async () => {
      await enregistrerConfig({ superviseur: { brancheCible: cible.value.trim() } });
    });
  }

  const pousser = $('#supPousser');
  if (pousser) {
    pousser.checked = cfg.pousserBranche !== false;
    pousser.addEventListener('change', async () => {
      await enregistrerConfig({ superviseur: { pousserBranche: pousser.checked } });
    });
  }

  const prefixe = $('#supPrefixe');
  if (prefixe) {
    prefixe.value = cfg.prefixeBranche || 'cerveau';
    prefixe.addEventListener('change', async () => {
      const v = (prefixe.value.trim() || 'cerveau').replace(/\s+/g, '-');
      prefixe.value = v;
      await enregistrerConfig({ superviseur: { prefixeBranche: v } });
    });
  }

  const rafraichir = rafraichirSuperviseur;

  $('#supDemarrer')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    const r = await API.superviseur.demarrer();
    b.disabled = false;
    if (r.ok) { notifier('Superviseur démarré.', 'succes'); await rafraichir(); }
    else notifier(r.message || 'Démarrage impossible.', 'erreur', 5000);
  });

  $('#supArreter')?.addEventListener('click', async () => {
    await API.superviseur.arreter();
    notifier('Superviseur arrêté.', 'info');
    await rafraichir();
  });

  $('#supPasser')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = 'Vérification…';
    const r = await API.superviseur.passer();
    b.disabled = false;
    b.textContent = 'Vérifier maintenant';
    if (r.ok) {
      notifier(`Vérification terminée : ${r.crees || 0} nouveau(x) ticket(s), ${r.executes || 0} exécuté(s).`, 'succes', 4000);
      majEtatSuperviseur(r);
    } else {
      notifier(r.message || 'Vérification impossible.', 'erreur', 5000);
    }
  });

  $('#btnCopierCommande')?.addEventListener('click', async () => {
    const texte = $('#texteCommandeManquante')?.textContent || '';
    if (!texte) return;
    await navigator.clipboard.writeText(texte);
    notifier('Commande copiée.', 'succes', 2000);
  });

  $('#supReinit')?.addEventListener('click', async () => {
    if (!confirm("Effacer tout l'historique des tickets ?")) return;
    await API.superviseur.reinitialiser();
    notifier('Historique effacé.', 'info');
    await rafraichirSuperviseur();
  });
}

/* ══════════════════ DISPOSITION DU PANNEAU LATÉRAL ══════════════════ */

const AIDES_PANNEAU = {
  cote: "Le panneau pousse le contenu vers la gauche : rien ne se recouvre jamais.",
  superpose: "Le panneau flotte au-dessus du contenu, sous l'en-tête, pour garder de la place au chat."
};

/** Applique la disposition et la largeur du panneau depuis la configuration. */
function appliquerDispositionPanneau(cfg = etat.config) {
  const p = cfg.panneau || {};
  const style = p.style === 'superpose' ? 'superpose' : 'cote';
  const largeur = Math.min(Math.max(Number(p.largeur) || 400, 300), 560);

  document.documentElement.dataset.panneau = style;
  document.documentElement.style.setProperty('--largeur-panneau', `${largeur}px`);

  const aide = $('#aideStylePanneau');
  if (aide) aide.textContent = AIDES_PANNEAU[style];

  // le sélecteur et le champ numérique doivent refléter l'état réel
  const sel = $('#reglageStylePanneau');
  if (sel && sel.value !== style) sel.value = style;
  const champ = $('#reglageLargeurPanneau');
  if (champ && document.activeElement !== champ && String(champ.value) !== String(largeur)) {
    champ.value = largeur;
  }

  // la hauteur d'en-tête sert au positionnement du panneau superposé
  synchroniserHauteurEntete();
}

let initialiserDispositionPanneauBranche = false;
function brancherDispositionPanneau() {
  // Les réglages sont réaffichés à chaque ouverture : on ne branche les
  // écouteurs qu'une fois, sinon ils s'empilent (fuite mémoire + double clic).
  if (initialiserDispositionPanneauBranche) return;
  initialiserDispositionPanneauBranche = true;
  const sel = $('#reglageStylePanneau');
  if (sel) {
    sel.addEventListener('change', async () => {
      await enregistrerConfig({ panneau: { style: sel.value } });
      appliquerDispositionPanneau();
      notifier(sel.value === 'superpose'
        ? 'Panneau superposé : il flotte au-dessus du contenu.'
        : 'Panneau côte à côte : il pousse le contenu.', 'info', 2600);
    });
  }

  const champ = $('#reglageLargeurPanneau');
  if (champ) {
    champ.addEventListener('change', async () => {
      const v = Math.min(Math.max(Number(champ.value) || 400, 300), 560);
      champ.value = v;
      await enregistrerConfig({ panneau: { largeur: v } });
      appliquerDispositionPanneau();
    });
  }

  appliquerDispositionPanneau();
}

/* ═══════════════════════════ PLUGINS ET WEB ═══════════════════════════ */

const EXEMPLES_MCP = [
  {
    nom: 'filesystem',
    titre: 'Système de fichiers',
    desc: 'Lire et écrire des fichiers hors du projet',
    commande: 'npx',
    arguments: ['-y', '@modelcontextprotocol/server-filesystem', '$HOME/Documents']
  },
  {
    nom: 'git',
    titre: 'Git avancé',
    desc: '28 outils : blame, changelog, branches, diffs',
    commande: 'npx',
    arguments: ['-y', '@cyanheads/git-mcp-server']
  },
  {
    nom: 'memory',
    titre: 'Mémoire persistante',
    desc: 'Graphe de connaissances entre sessions',
    commande: 'npx',
    arguments: ['-y', '@modelcontextprotocol/server-memory']
  },
  {
    nom: 'sqlite',
    titre: 'Base SQLite',
    desc: 'Requêtes et tables d\'une base .db',
    commande: 'npx',
    arguments: ['-y', 'mcp-server-sqlite', '--db', '$HOME/base.db']
  },
  {
    nom: 'everything',
    titre: 'Serveur de démonstration',
    desc: 'Référence du protocole, pour tester',
    commande: 'npx',
    arguments: ['-y', '@modelcontextprotocol/server-everything']
  }
];

/**
 * Tableau des serveurs MCP.
 *
 * Chaque ligne montre l'état réel du serveur (jamais démarré, en marche, en
 * échec), le nombre d'outils disponibles et deux actions explicites. L'état
 * est intégré à la ligne plutôt que dans une seconde liste : on voit d'un
 * coup d'œil ce qui fonctionne et ce qui bloque.
 */
let etatsMCPCourants = {};

async function rendreServeursMCP() {
  const zone = $('#listeServeursMCP');
  if (!zone) return;
  zone.innerHTML = '';

  const serveurs = etat.config.serveursMCP || [];

  if (!serveurs.length) {
    zone.append(el('p', { class: 'vide petit', text:
      'Aucun serveur MCP configuré. Utilisez un exemple prêt à l’emploi ci-dessous.' }));
    return;
  }

  // en-têtes du tableau
  zone.append(el('div', { class: 'mcp-entetes' },
    el('span', { text: 'Serveur' }),
    el('span', { text: 'Commande' }),
    el('span', { class: 'mcp-col-etat', text: 'État' }),
    el('span', { class: 'mcp-col-actions', text: 'Actions' })
  ));

  serveurs.forEach((srv, index) => {
    const info = etatsMCPCourants[srv.nom];
    const actif = srv.actif !== false;
    const enMarche = Boolean(info?.ok);
    const enEchec = info && !info.ok;
    const jamaisLance = !info;

    const etatTexte = enMarche
      ? `${info.outils} outil${info.outils > 1 ? 's' : ''}`
      : enEchec ? 'Échec' : jamaisLance ? 'Non démarré' : 'Inactif';
    const etatClasse = enMarche ? 'ok' : enEchec ? 'echec' : 'attente';

    const ligne = el('div', { class: 'mcp-ligne' + (actif ? '' : ' desactive') },
      // 1. nom + interrupteur
      el('div', { class: 'mcp-cellule-nom' },
        el('button', {
          class: `mcp-interrupteur${actif ? ' actif' : ''}`,
          title: actif ? 'Désactiver ce serveur' : 'Activer ce serveur',
          'aria-pressed': actif ? 'true' : 'false',
          onclick: async () => {
            const liste = [...(etat.config.serveursMCP || [])];
            liste[index] = { ...liste[index], actif: !actif };
            await enregistrerConfig({ serveursMCP: liste });
            rendreServeursMCP();
          }
        }, el('span', { class: 'mcp-interrupteur-pastille' })),
        el('span', { class: 'mcp-nom', text: srv.nom })
      ),

      // 2. commande
      el('div', {
        class: 'mcp-cellule-commande',
        title: `${srv.commande} ${(srv.arguments || []).join(' ')}`,
        text: `${srv.commande} ${(srv.arguments || []).join(' ')}`
      }),

      // 3. état
      el('div', { class: 'mcp-cellule-etat' },
        el('span', { class: `mcp-pastille ${etatClasse}` }),
        el('span', {
          class: `mcp-etat-txt ${etatClasse}`,
          text: etatTexte,
          title: enEchec ? (info.erreur || '') : ''
        })
      ),

      // 4. actions
      el('div', { class: 'mcp-cellule-actions' },
        el('button', {
          class: 'btn-mcp demarrer',
          title: 'Démarrer le serveur et lister ses outils',
          onclick: async (e) => {
            const b = e.currentTarget;
            const avant = b.innerHTML;
            b.disabled = true;
            b.classList.add('en-cours');
            b.innerHTML = '<span class="mcp-roue"></span>Démarrage…';
            try {
              const r = await API.mcp.tester(srv.nom);
              await rafraichirEtatsMCP();
              if (r.ok && r.outils > 0) {
                notifier(`« ${srv.nom} » : ${r.outils} outil(s) disponible(s).`, 'succes', 4000);
              } else {
                const e2 = r.etats?.[srv.nom];
                notifier(`« ${srv.nom} » n’a pas démarré : ${e2?.erreur || 'raison inconnue'}`, 'erreur', 10000);
              }
            } finally {
              b.disabled = false;
              b.classList.remove('en-cours');
              b.innerHTML = avant;
            }
          }
        }, 'Démarrer'),

        el('button', {
          class: 'btn-mcp outils',
          title: 'Voir les outils exposés par ce serveur',
          onclick: async (e) => {
            const b = e.currentTarget;
            b.disabled = true;
            try {
              const outils = await API.mcp.outils(srv.nom);
              afficherOutilsMCP(srv.nom, outils);
            } catch (err) {
              notifier(String(err.message || err), 'erreur', 5000);
            } finally {
              b.disabled = false;
            }
          }
        }, 'Outils'),

        el('button', {
          class: 'btn-mcp retirer',
          title: 'Retirer ce serveur',
          onclick: async () => {
            const liste = (etat.config.serveursMCP || []).filter((_, i) => i !== index);
            await enregistrerConfig({ serveursMCP: liste });
            rendreServeursMCP();
            rendreExemplesMCP();
            notifier(`Serveur « ${srv.nom} » retiré.`, 'info', 2000);
          }
        }, '✕')
      )
    );

    zone.append(ligne);

    // le message d'échec était uniquement dans une infobulle : on l'affiche
    if (enEchec && info?.erreur) {
      zone.append(el('div', {
        class: 'mcp-erreur',
        title: String(info.erreur),
        text: String(info.erreur).slice(0, 300)
      }));
    }
  });
}

/** Affiche la liste des outils d'un serveur. */
function afficherOutilsMCP(nom, outils) {
  const existante = document.querySelector('#modaleOutilsMCP');
  if (existante) existante.remove();

  const liste = Array.isArray(outils) ? outils : (outils?.outils || []);

  const modale = el('div', { class: 'modale', id: 'modaleOutilsMCP' },
    el('div', { class: 'modale-fond', onclick: () => modale.remove() }),
    el('div', { class: 'modale-contenu moyenne', role: 'dialog', 'aria-modal': 'true' },
      el('div', { class: 'modale-entete' },
        el('h2', { text: `Outils de « ${nom} »` }),
        el('button', { class: 'btn-fermer', text: '✕', onclick: () => modale.remove() })
      ),
      el('div', { class: 'modale-corps' },
        liste.length
          ? el('div', { class: 'liste-outils-mcp' },
              ...liste.map((o) => el('div', { class: 'outil-mcp' },
                el('div', { class: 'outil-mcp-nom', text: o.nom || o.name || '(sans nom)' }),
                o.description ? el('div', { class: 'outil-mcp-desc', text: o.description }) : null
              ))
            )
          : el('p', { class: 'vide petit', text:
              'Aucun outil. Démarrez d’abord le serveur avec « Démarrer ».' })
      )
    )
  );
  document.body.append(modale);
}

function rendreExemplesMCP() {
  const zone = $('#exemplesMCP');
  if (!zone) return;
  zone.innerHTML = '';
  const existants = new Set((etat.config.serveursMCP || []).map((s) => s.nom));

  for (const ex of EXEMPLES_MCP) {
    const deja = existants.has(ex.nom);
    zone.append(el('button', {
      class: 'preset' + (deja ? ' actif' : ''),
      disabled: deja ? '' : null,
      onclick: async () => {
        if (deja) return;
        const liste = [...(etat.config.serveursMCP || []), {
          nom: ex.nom,
          commande: ex.commande,
          // $HOME est développé ici : spawn ne le fait pas lui-même
          arguments: ex.arguments.map((a) => a.replace(/^\$HOME/, etat.dossierPersonnel || '')),
          variablesEnv: Object.fromEntries(
            Object.entries(ex.variablesEnv || {}).map(([k, v]) => [
              k, String(v).replace(/^\$HOME/, etat.dossierPersonnel || '')
            ])
          ),
          actif: true
        }];
        await enregistrerConfig({ serveursMCP: liste });
        rendreServeursMCP();
        rendreExemplesMCP();
        notifier(`Serveur « ${ex.titre} » ajouté. Il démarrera au prochain message.`, 'succes', 4000);
      }
    },
      el('div', { class: 'preset-nom', text: deja ? `${ex.titre} ✓` : ex.titre }),
      el('div', { class: 'preset-desc', text: ex.desc }),
      ex.note ? el('div', { class: 'preset-note', text: ex.note }) : null
    ));
  }
}

async function ajouterServeurMCP() {
  const nom = $('#mcpNom')?.value.trim();
  const commande = $('#mcpCommande')?.value.trim();
  const argsBruts = $('#mcpArguments')?.value.trim() || '';
  const envBrut = $('#mcpEnv')?.value.trim() || '';

  if (!nom || !commande) return notifier('Renseignez un nom et une commande.', 'erreur', 3000);
  if ((etat.config.serveursMCP || []).some((s) => s.nom === nom)) {
    return notifier('Un serveur porte déjà ce nom.', 'erreur', 3000);
  }

  // découpe grossière respectant les guillemets
  const args = argsBruts.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((a) => a.replace(/^"|"$/g, '')) || [];

  // variables d'environnement : « CLE=valeur » séparées par des espaces
  const variablesEnv = {};
  for (const morceau of envBrut.match(/(?:[^\s"]+|"[^"]*")+/g) || []) {
    const m = morceau.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) variablesEnv[m[1]] = m[2].replace(/^"|"$/g, '');
  }

  const liste = [...(etat.config.serveursMCP || []), {
    nom, commande, arguments: args, variablesEnv, actif: true
  }];
  await enregistrerConfig({ serveursMCP: liste });

  if ($('#mcpNom')) $('#mcpNom').value = '';
  if ($('#mcpCommande')) $('#mcpCommande').value = '';
  if ($('#mcpArguments')) $('#mcpArguments').value = '';
  if ($('#mcpEnv')) $('#mcpEnv').value = '';
  rendreServeursMCP();
  rendreExemplesMCP();
  notifier(`Serveur « ${nom} » ajouté.`, 'succes', 3000);
}

async function rafraichirEtatsMCP() {
  const r = await API.mcp.etats();
  etatsMCPCourants = r.etats || {};
  // une seule liste : le tableau porte l'état, pas de doublon à maintenir
  rendreServeursMCP();
}

let initialiserPluginsBranche = false;
function brancherPlugins() {
  // Les réglages sont réaffichés à chaque ouverture : on ne branche les
  // écouteurs qu'une fois, sinon ils s'empilent (fuite mémoire + double clic).
  if (initialiserPluginsBranche) return;
  initialiserPluginsBranche = true;
  const rw = etat.config.rechercheWeb || {};
  const urlR = $('#reglageUrlRecherche');
  if (urlR) {
    urlR.value = rw.baseUrl || 'https://api.deepseek.com/v1/tools';
    urlR.addEventListener('change', async () => {
      await enregistrerConfig({ rechercheWeb: { baseUrl: urlR.value.trim() } });
    });
  }
  const cleR = $('#reglageCleRecherche');
  if (cleR) {
    cleR.value = rw.cle ? '••••••••' : '';
    cleR.addEventListener('change', async () => {
      if (cleR.value === '••••••••') return;
      await enregistrerConfig({ rechercheWeb: { cle: cleR.value.trim() } });
    });
  }
  const nbR = $('#reglageNbRecherche');
  if (nbR) {
    nbR.value = String(rw.count || 8);
    nbR.addEventListener('change', async () => {
      await enregistrerConfig({ rechercheWeb: { count: Math.min(Math.max(Number(nbR.value) || 8, 1), 50) } });
    });
  }

  $('#btnTesterRecherche')?.addEventListener('click', async () => {
    const cible = $('#resultatTestRecherche');
    if (cible) cible.textContent = 'Recherche en cours…';
    const r = await API.web.tester();
    if (cible) {
      cible.textContent = r.ok
        ? `${r.total} source(s) via ${r.moteur}. Exemple : ${r.exemple || '—'}`
        : `Échec : ${r.message}`;
      cible.style.color = r.ok ? 'var(--succes)' : 'var(--danger)';
    }
  });

  $('#btnDemarrerMCP')?.addEventListener('click', async () => {
    const bouton = $('#btnDemarrerMCP');
    const cible = $('#resultatMCP');
    const avant = bouton.textContent;
    bouton.disabled = true;
    bouton.textContent = '⟳ démarrage…';
    if (cible) { cible.textContent = ''; cible.style.color = ''; }
    try {
      const r = await API.mcp.tester();
      await rafraichirEtatsMCP();
      const etats = r.etats || {};
      const noms = Object.keys(etats);
      const prets = noms.filter((n) => etats[n].ok);
      const echecs = noms.filter((n) => !etats[n].ok);
      if (cible) {
        cible.textContent = `${prets.length}/${noms.length} serveur(s) prêt(s)`
          + (echecs.length ? ` · échec : ${echecs.join(', ')}` : '');
        cible.style.color = echecs.length ? 'var(--danger)' : 'var(--succes)';
      }
      if (echecs.length) {
        notifier(`Échec : ${echecs.join(', ')} — le détail est affiché sous la ligne.`, 'erreur', 8000);
      } else if (noms.length) {
        notifier(`${prets.length} serveur(s) MCP prêt(s).`, 'succes', 3000);
      }
    } catch (err) {
      if (cible) { cible.textContent = String(err.message || err); cible.style.color = 'var(--danger)'; }
    } finally {
      bouton.disabled = false;
      bouton.textContent = avant;
    }
  });

  $('#btnAjouterMCP')?.addEventListener('click', ajouterServeurMCP);
  rendreServeursMCP();
  rendreExemplesMCP();
  rafraichirEtatsMCP();
}

/**
 * Reporte la hauteur réelle de l'en-tête dans une variable CSS.
 *
 * En dessous de 1240 px, l'en-tête passe sur deux lignes. Le panneau superposé
 * doit démarrer exactement sous lui, sinon il recouvre le bouton qui sert à le
 * refermer. La hauteur est donc mesurée, jamais supposée.
 */
function synchroniserHauteurEntete() {
  const entete = $('.entete');
  if (!entete) return;
  const h = Math.round(entete.getBoundingClientRect().height);
  if (h > 0) document.documentElement.style.setProperty('--hauteur-entete', `${h}px`);
  adapterDispositionEntete();
}

/**
 * Le panneau reste côte à côte tant que l'en-tête y tient. Dès qu'il manque
 * de place, il passe sous l'en-tête pour laisser toute la largeur aux
 * commandes. On mesure l'encombrement réel au lieu de fixer une largeur :
 * le seuil suit la largeur du panneau et l'échelle du texte.
 */
function adapterDispositionEntete() {
  const html = document.documentElement;
  const entete = $('.entete');
  const panneau = $('#panneauObsidian');
  if (!entete || !panneau) return;
  html.classList.remove('entete-etroite');
  if (html.dataset.panneau === 'superpose') return;
  if (panneau.classList.contains('replie')) return;
  // Mesure sur la disposition côte à côte finale : la transition d'ouverture
  // du panneau fausserait la largeur disponible pendant quelques millisecondes.
  const transition = panneau.style.transition;
  panneau.style.transition = 'none';
  panneau.style.marginRight = '0';
  const manque = entete.scrollWidth > entete.clientWidth + 1;
  panneau.style.transition = transition;
  panneau.style.marginRight = '';
  if (manque) html.classList.add('entete-etroite');
}

/* ═══════════════════════════ RÉGLAGES AVANCÉS ═══════════════════════════ */

/** Outils connus, regroupés par famille, pour la section « Agent et outils ». */
const OUTILS_CONNUS = [
  { nom: 'lister_notes', famille: 'Notes' }, { nom: 'lire_note', famille: 'Notes' },
  { nom: 'creer_note', famille: 'Notes' }, { nom: 'ajouter_a_note', famille: 'Notes' },
  { nom: 'remplacer_dans_note', famille: 'Notes' }, { nom: 'rechercher', famille: 'Notes' },
  { nom: 'lister_tags', famille: 'Notes' }, { nom: 'notes_par_tag', famille: 'Notes' },
  { nom: 'liens_de_note', famille: 'Notes' }, { nom: 'deplacer_note', famille: 'Notes' },
  { nom: 'creer_dossier', famille: 'Notes' }, { nom: 'supprimer_note', famille: 'Notes' },
  { nom: 'journal_du_jour', famille: 'Notes' }, { nom: 'statistiques_coffre', famille: 'Notes' },
  { nom: 'executer_commande', famille: 'Code' }, { nom: 'lister_fichiers', famille: 'Code' },
  { nom: 'lire_fichier', famille: 'Code' }, { nom: 'ecrire_fichier', famille: 'Code' },
  { nom: 'modifier_fichier', famille: 'Code' }, { nom: 'chercher_code', famille: 'Code' },
  { nom: 'plan_taches', famille: 'Code' },
  { nom: 'etat_depot', famille: 'GitHub' }, { nom: 'historique_commits', famille: 'GitHub' },
  { nom: 'voir_differences', famille: 'GitHub' }, { nom: 'lister_branches', famille: 'GitHub' },
  { nom: 'tirer_depot', famille: 'GitHub' }, { nom: 'changer_branche', famille: 'GitHub' },
  { nom: 'commiter_et_pousser', famille: 'GitHub' }, { nom: 'lister_depots_github', famille: 'GitHub' },
  { nom: 'lister_pull_requests', famille: 'GitHub' }, { nom: 'details_pull_request', famille: 'GitHub' },
  { nom: 'creer_pull_request', famille: 'GitHub' }, { nom: 'lister_issues', famille: 'GitHub' },
  { nom: 'etat_ci', famille: 'GitHub' },
  // Les outils web sont intégrés (DuckDuckGo + lecture de page), sans clé ni
  // serveur MCP : ils se règlent comme les autres, ici.
  { nom: 'web_search', famille: 'Web' }, { nom: 'web_fetch', famille: 'Web' },
  { nom: 'lister_competences', famille: 'Compétences' },
  { nom: 'charger_competence', famille: 'Compétences' },
  { nom: 'enregistrer_competence', famille: 'Compétences' },
  { nom: 'voir_image', famille: 'Vision' },
  { nom: 'lancer_tache_fond', famille: 'Tâches de fond' },
  { nom: 'lister_taches_fond', famille: 'Tâches de fond' },
  { nom: 'sortie_tache_fond', famille: 'Tâches de fond' },
  { nom: 'arreter_tache_fond', famille: 'Tâches de fond' }
];

function ajouterLigneOutil(zone, o, desactives) {
  const actif = !desactives.includes(o.nom);
  zone.append(el('label', { class: 'outil-reglage' },
    el('input', {
      type: 'checkbox',
      class: 'champ-reglage-controle bascule',
      checked: actif ? '' : null,
      onchange: async (e) => {
        const liste = new Set(etat.config.outilsDesactives || []);
        if (e.target.checked) liste.delete(o.nom);
        else liste.add(o.nom);
        await enregistrerConfig({ outilsDesactives: [...liste] });
        notifier(e.target.checked ? `${o.nom} activé.` : `${o.nom} désactivé.`, 'info', 1800);
      }
    }),
    el('span', { class: 'outil-reglage-nom', text: o.nom }),
    el('span', { class: 'outil-reglage-famille', text: o.famille })
  ));
}

function rendreOutilsReglage() {
  const zone = $('#reglageOutils');
  if (!zone) return;
  zone.innerHTML = '';
  const desactives = etat.config.outilsDesactives || [];

  for (const o of OUTILS_CONNUS) ajouterLigneOutil(zone, o, desactives);

  // outils apportés par les plugins locaux (chargés dynamiquement)
  API.plugins.lister().then((r) => {
    for (const o of r.outils || []) {
      ajouterLigneOutil(zone, { nom: o.nom, famille: 'Plugin' }, desactives);
    }
  }).catch(() => { /* pas de plugins */ });
}

let initialiserReglagesAvancesBranche = false;
function brancherReglagesAvances() {
  // Les réglages sont réaffichés à chaque ouverture : on ne branche les
  // écouteurs qu'une fois, sinon ils s'empilent (fuite mémoire + double clic).
  if (initialiserReglagesAvancesBranche) return;
  initialiserReglagesAvancesBranche = true;
  const cfg = etat.config;
  const g = cfg.general || {};
  const a = cfg.agent || {};

  const lier = (sel, valeur, chemin, transform = (v) => v, defaut = null) => {
    const champ = $(sel);
    if (!champ) return;
    if (champ.type === 'checkbox') champ.checked = valeur !== undefined ? Boolean(valeur) : Boolean(defaut);
    else champ.value = valeur !== undefined && valeur !== null ? String(valeur) : '';

    const evt = champ.tagName === 'SELECT' || champ.type === 'checkbox' ? 'change' : 'change';
    champ.addEventListener(evt, async () => {
      const brut = champ.type === 'checkbox' ? champ.checked : champ.value;
      const propre = transform(brut);
      const patch = {};
      const [section, cle] = chemin.split('.');
      patch[section] = { [cle]: propre };
      await enregistrerConfig(patch);
      notifier('Réglage enregistré.', 'succes', 1400);
    });
  };

  lier('#reglageModeDemarrage', g.modeDemarrage, 'general.modeDemarrage', (v) => v, 'complet');
  lier('#reglagePanneauDemarrage', g.panneauOuvert, 'general.panneauOuvert', (v) => v, true);
  $('#reglagePanneauDemarrage')?.addEventListener('change', (e) => {
    $('#panneauObsidian')?.classList.toggle('replie', !e.target.checked);
  });
  lier('#reglageRestaurer', g.restaurerDerniere, 'general.restaurerDerniere', (v) => v, false);
  lier('#reglageAutostart', g.demarrerAuDemarrage, 'general.demarrerAuDemarrage', (v) => v, false);
  lier('#reglageNotifications', g.notifications, 'general.notifications', (v) => v, true);
  lier('#reglageTitresAuto', g.titresAuto, 'general.titresAuto', (v) => v, true);
  lier('#reglageMajAuto', g.verifierMajAuto, 'general.verifierMajAuto', (v) => v, true);
  lier('#reglageHistorique', g.historiqueMax, 'general.historiqueMax', (v) => Number(v) || 200, 200);

  lier('#reglageAppelsParalleles', a.appelsParalleles, 'agent.appelsParalleles', (v) => v, true);
  lier('#reglageDelaiCommande', a.delaiCommande, 'agent.delaiCommande', (v) => Number(v) || 120, 120);
  lier('#reglageDelaiReponse', a.delaiReponse, 'agent.delaiReponse', (v) => Number(v) || 0, 180);
  lier('#reglageFallback', a.fallbackProvider, 'agent.fallbackProvider', (v) => v, '');
  lier('#reglageCapSortie', a.capSortie, 'agent.capSortie', (v) => Number(v) || 60, 60);

  const chemin = $('#reglageCheminConfig');
  if (chemin) chemin.textContent = etat.config.configPath || '~/.config/cerveau/config.json';

  $('#reglageAutostart')?.addEventListener('change', async (e) => {
    const r = await API.app.definirAutostart(e.target.checked);
    if (!r.ok) {
      e.target.checked = !e.target.checked;
      await enregistrerConfig({ general: { demarrerAuDemarrage: e.target.checked } });
      notifier(r.message || 'Impossible de modifier le démarrage automatique.', 'erreur', 5000);
      return;
    }
    notifier(r.actif ? 'Cerveau démarrera avec la session.' : 'Démarrage automatique désactivé.', 'succes', 3000);
  });

  let urlMaj = '';
  $('#btnVerifierMaj')?.addEventListener('click', async () => {
    const info = $('#infoMaj');
    const ouvrir = $('#btnOuvrirMaj');
    if (info) info.textContent = 'Recherche…';
    if (ouvrir) ouvrir.hidden = true;
    const r = await API.app.verifierMaj();
    if (!r.ok) {
      if (info) info.textContent = 'Vérification impossible';
      notifier(r.message || 'GitHub injoignable.', 'erreur', 5000);
      return;
    }
    if (r.aJour) {
      if (info) info.textContent = `À jour (${r.actuelle})`;
      return;
    }
    if (info) info.textContent = `Version ${r.distante} disponible`;
    if (r.url && ouvrir) { urlMaj = r.url; ouvrir.hidden = false; }
  });
  $('#btnOuvrirMaj')?.addEventListener('click', () => { if (urlMaj) API.app.ouvrirUrl(urlMaj); });
  $('#btnOuvrirJournal')?.addEventListener('click', async () => {
    const r = await API.app.ouvrirJournal();
    if (!r.ok) notifier(r.message || 'Journal inaccessible.', 'erreur', 4000);
    else notifier('Journal de diagnostic ouvert.', 'succes', 2500);
  });

  $('#btnOuvrirConfig')?.addEventListener('click', () => API.app.ouvrirDossierConfig());
  $('#btnOuvrirCompetences')?.addEventListener('click', () => API.competences.ouvrirDossier());

  $('#btnRechargerPlugins')?.addEventListener('click', async () => {
    const r = await API.plugins.recharger();
    await rendrePlugins();
    if (r.ok) notifier(`${r.total} outil(s) de plugin chargé(s).`, 'succes', 3000);
    else notifier(r.message || 'Rechargement impossible.', 'erreur', 5000);
  });
  $('#btnOuvrirPlugins')?.addEventListener('click', () => API.plugins.ouvrirDossier());
  $('#btnNouveauPlugin')?.addEventListener('click', ouvrirModalePlugin);
  $('#btnFermerPlugin')?.addEventListener('click', () => { $('#modalePlugin').hidden = true; });
  $('#btnAnnulerPlugin')?.addEventListener('click', () => { $('#modalePlugin').hidden = true; });
  $('#modalePlugin .modale-fond')?.addEventListener('click', () => { $('#modalePlugin').hidden = true; });
  $('#btnCreerPlugin')?.addEventListener('click', creerPlugin);
  $('#btnReinitialiser2')?.addEventListener('click', async () => {
    if (!confirm('Réinitialiser tous les réglages ? Les clés d\'API et la liste des coffres seront effacées.')) return;
    etat.config = await API.config.reinitialiser();
    etat.conversations = [];
    notifier('Réglages réinitialisés.', 'succes');
    fermerReglages();
    await rafraichirFournisseurs();
    await rafraichirCoffre();
  });

  rendreOutilsReglage();
}

const MODELE_PLUGIN = `module.exports = {
  nom: 'Mon plugin',
  description: 'Ce que fait ce plugin',

  outils: [
    {
      nom: 'mon_outil',
      description: 'Décris ce que fait l’outil',
      schema: {
        type: 'object',
        properties: { texte: { type: 'string', description: 'Un texte' } },
        required: ['texte']
      },
      risque: 'lecture',
      executer: async (args) => ({ resultat: String(args.texte || '').toUpperCase() })
    }
  ]
};`;

/** Liste les plugins chargés (dossier de configuration). */
async function rendreCataloguePlugins() {
  const zone = $('#cataloguePlugins');
  if (!zone) return;
  zone.innerHTML = '';

  let catalogue = [];
  const installes = new Set();
  try {
    const [r, l] = await Promise.all([API.plugins.catalogue(), API.plugins.lister()]);
    catalogue = r.catalogue || [];
    for (const p of l.plugins || []) installes.add(p.id);
  } catch { /* catalogue indisponible */ }

  if (!catalogue.length) {
    zone.append(el('p', { class: 'vide petit', text: 'Catalogue indisponible.' }));
    return;
  }

  for (const item of catalogue) {
    const installe = installes.has(item.id);
    zone.append(el('div', { class: 'competence' },
      el('div', { class: 'competence-nom', text: `${item.nom}${item.defaut ? ' · par défaut' : ''}` }),
      el('div', { class: 'competence-desc', text: item.description }),
      el('div', { class: 'competence-outils', text: (item.outils || []).join(' · ') }),
      installe
        ? el('span', { class: 'badge ok', text: 'Installé' })
        : el('button', {
            class: 'btn-mini',
            text: 'Installer',
            onclick: async () => {
              const r = await API.plugins.installer(item.id);
              if (!r.ok) { notifier(r.message || 'Installation impossible.', 'erreur', 5000); return; }
              notifier(`Plugin « ${item.nom} » installé.`, 'succes', 2500);
              await rendrePlugins();
              rendreOutilsReglage();
              await rendreCataloguePlugins();
            }
          })
    ));
  }
}

async function rendrePlugins() {
  const zone = $('#listePlugins');
  if (!zone) return;
  zone.innerHTML = '';

  let r = { plugins: [] };
  try { r = await API.plugins.lister(); } catch { /* dossier inaccessible */ }

  const liste = r.plugins || [];
  if (!liste.length) {
    zone.append(el('p', { class: 'vide petit', text: 'Aucun plugin installé.' }));
    return;
  }

  for (const p of liste) {
    const carte = el('div', { class: 'competence' },
      el('div', { class: 'competence-nom', text: `${p.nom}${p.outils ? ` · ${p.outils} outil(s)` : ''}` }),
      el('div', { class: 'competence-desc', text: p.description || p.fichier }),
      p.erreur ? el('div', { class: 'competence-erreur', text: p.erreur }) : null,
      el('button', {
        class: 'btn-mini danger',
        text: 'Retirer',
        title: `Supprimer ${p.fichier}`,
        onclick: async () => {
          if (!confirm(`Supprimer le plugin « ${p.nom} » ?`)) return;
          const res = await API.plugins.supprimer(p.fichier);
          await rendrePlugins();
          if (res.ok) notifier(`Plugin « ${p.nom} » supprimé.`, 'succes', 3000);
          else notifier(res.message || 'Suppression impossible.', 'erreur', 5000);
        }
      })
    );
    zone.append(carte);
  }
}

function ouvrirModalePlugin() {
  $('#pluginNom').value = '';
  $('#pluginDescription').value = '';
  $('#pluginCode').value = MODELE_PLUGIN;
  $('#pluginErreur').hidden = true;
  $('#modalePlugin').hidden = false;
  $('#pluginNom').focus();
}

async function creerPlugin() {
  const nom = $('#pluginNom').value.trim();
  const description = $('#pluginDescription').value.trim();
  const code = $('#pluginCode').value;
  const erreur = $('#pluginErreur');

  if (!nom) {
    erreur.textContent = 'Donne un nom au plugin.';
    erreur.hidden = false;
    return;
  }
  if (!code.trim()) {
    erreur.textContent = 'Le code du plugin est vide.';
    erreur.hidden = false;
    return;
  }

  const r = await API.plugins.creer({ nom, description, code });
  if (!r.ok) {
    erreur.textContent = r.message || 'Création impossible.';
    erreur.hidden = false;
    return;
  }

  $('#modalePlugin').hidden = true;
  await rendrePlugins();
  rendreOutilsReglage();
  notifier(`Plugin « ${nom} » créé et chargé (${r.total} outil(s) au total).`, 'succes', 4000);
}

/** Liste les compétences installées (dossier de configuration). */
async function rendreCompetences() {
  const zone = $('#listeCompetences');
  if (!zone) return;
  zone.innerHTML = '';

  let r = { competences: [] };
  try { r = await API.competences.lister(); } catch { /* dossier inaccessible */ }

  const liste = r.competences || [];
  if (!liste.length) {
    zone.append(el('p', { class: 'vide petit', text: 'Aucune compétence installée.' }));
    return;
  }

  for (const c of liste) {
    zone.append(el('div', { class: 'competence' },
      el('div', { class: 'competence-nom', text: c.nom }),
      el('div', { class: 'competence-desc', text: c.description || '' })
    ));
  }
}

/* ═══════════════════════════ COMPORTEMENT ═══════════════════════════ */

const PRESETS = [
  { id: 'concis', nom: 'Concis', description: 'Réponses courtes, sans bavardage',
    prompt: 'Sois concis. Va droit au but. Pas de préambule, pas de reformulation de ma demande.' },
  { id: 'pedagogue', nom: 'Pédagogue', description: 'Explique étape par étape',
    prompt: 'Explique ton raisonnement étape par étape, avec des exemples concrets. Vérifie que je comprends.' },
  { id: 'code', nom: 'Ingénieur', description: 'Code propre, testé, sans dette',
    prompt: 'Écris du code de qualité production : lisible, testé, sans dépendance inutile. Signale les cas limites et les compromis.' },
  { id: 'critique', nom: 'Critique', description: 'Relève les faiblesses',
    prompt: 'Sois critique. Signale les risques, les oublis et les hypothèses fragiles avant de valider une idée.' },
  { id: 'creatif', nom: 'Créatif', description: 'Propose plusieurs pistes',
    prompt: 'Propose plusieurs pistes distinctes avant de converger. Favorise les idées originales sur les évidences.' },
  { id: 'rigoureux', nom: 'Rigoureux', description: 'Sources et incertitudes',
    prompt: "Distingue clairement ce que tu sais de ce que tu supposes. Si tu n'es pas certain, dis-le." }
];

function rendrePresetsComportement() {
  const zone = $('#presetsComportement');
  if (!zone) return;
  zone.innerHTML = '';
  const actifs = etat.config.presetsComportement || [];

  for (const p of PRESETS) {
    const actif = actifs.includes(p.id);
    const carte = el('button', {
      class: 'preset' + (actif ? ' actif' : ''),
      title: p.prompt,
      onclick: async () => {
        const liste = actifs.includes(p.id)
          ? actifs.filter((x) => x !== p.id)
          : [...actifs, p.id];
        await enregistrerConfig({ presetsComportement: liste });
        rendrePresetsComportement();
      }
    },
      el('div', { class: 'preset-nom', text: p.nom }),
      el('div', { class: 'preset-desc', text: p.description })
    );
    zone.append(carte);
  }
}

/* ------------------------------- employés ------------------------------- */

function listeEmployes() {
  return Array.isArray(etat.config.employes) ? etat.config.employes : [];
}

function employeParId(id) {
  return listeEmployes().find((e) => e.id === id) || null;
}

function employeCourant() {
  const id = etat.conversationCourante?.employeId;
  return id ? employeParId(id) : null;
}

function identiteAssistant() {
  const e = employeCourant();
  return e
    ? { nom: e.nom || 'Employé', emoji: e.emoji || '🤖' }
    : { nom: 'Cerveau', emoji: 'C' };
}

/** Employé transmis au modèle : uniquement le nécessaire, jamais d'identifiant. */
function employePourAgent() {
  const e = employeCourant();
  if (!e) return null;
  return { nom: e.nom, role: e.role || '', instructions: e.instructions || '' };
}

function majPuceEmploye() {
  const puce = $('#employeActif');
  if (!puce) return;
  const e = employeCourant();
  puce.textContent = e ? `${e.emoji || '🤖'} ${e.nom}` : '🧠 Cerveau';
  puce.title = e
    ? `Employé : ${e.nom}${e.role ? ` — ${e.role}` : ''}`
    : 'Aucun employé : conversation avec Cerveau';
}

async function utiliserEmploye(id) {
  const conv = etat.conversationCourante;
  if (!conv) return;
  conv.employeId = id || '';
  conv.date = Date.now();
  persisterConversations();
  majPuceEmploye();
  afficherConversation();
  const e = id ? employeParId(id) : null;
  notifier(e ? `Employé « ${e.nom} » activé pour cette conversation.` : 'Conversation avec Cerveau.', 'succes', 2600);
}

function rendreMenuEmployes() {
  const menu = $('#menuEmployes');
  if (!menu) return;
  if (!menu.hidden) { menu.hidden = true; return; }

  menu.innerHTML = '';
  const courant = etat.conversationCourante?.employeId || '';

  const option = (id, emoji, nom, role, actif) => {
    const bouton = el('button', {
      class: 'menu-employe-option' + (actif ? ' menu-employe-actif' : ''),
      onclick: async () => {
        menu.hidden = true;
        await utiliserEmploye(id);
      }
    },
      el('span', { text: emoji || '🤖' }),
      el('span', { class: 'menu-employe-libelle' }, el('div', { text: nom }), role ? el('div', { class: 'menu-employe-role', text: role }) : null)
    );
    menu.append(bouton);
  };

  option('', '🧠', 'Cerveau', 'Assistant par défaut', !courant);
  for (const e of listeEmployes()) option(e.id, e.emoji || '🤖', e.nom, e.role || '', e.id === courant);

  menu.append(el('div', { class: 'menu-employes-sep' }));
  menu.append(el('button', {
    class: 'menu-employe-option',
    onclick: () => {
      menu.hidden = true;
      ouvrirReglages('comportement');
    }
  }, el('span', { text: '⚙' }), el('span', { text: 'Gérer les employés…' })));

  menu.hidden = false;
}

function rendreEmployes() {
  const zone = $('#listeEmployes');
  if (!zone) return;
  zone.innerHTML = '';
  const employes = listeEmployes();
  const courant = etat.conversationCourante?.employeId || '';

  if (!employes.length) {
    zone.append(el('p', { class: 'aide petit', text: 'Aucun employé pour le moment. Crée un profil pour lui donner un rôle et des consignes.' }));
  }

  for (const e of employes) {
    const badge = etat.config.employeDefaut === e.id
      ? el('span', { class: 'employe-badge', text: 'Par défaut' })
      : null;
    const carte = el('div', { class: 'carte-employe' + (e.id === courant ? ' actif' : '') },
      el('div', { class: 'employe-emoji', text: e.emoji || '🤖' }),
      el('div', { class: 'employe-infos' },
        el('div', { class: 'employe-nom', text: e.nom }),
        el('div', { class: 'employe-role', text: e.role || 'Sans rôle précis' }),
        e.instructions ? el('div', { class: 'employe-instructions', text: e.instructions }) : null,
        badge
      ),
      el('div', { class: 'employe-actions' },
        (() => {
          const choisir = el('button', {
            class: 'btn-mini', text: e.id === courant ? 'Actif' : 'Choisir',
            title: 'Utiliser cet employé pour la conversation en cours',
            onclick: () => utiliserEmploye(e.id)
          });
          choisir.disabled = e.id === courant;
          return choisir;
        })(),
        el('button', { class: 'btn-icone', text: '✎', title: 'Modifier', onclick: () => ouvrirFormEmploye(e.id) }),
        el('button', { class: 'btn-icone', text: '🗑', title: 'Supprimer', onclick: () => supprimerEmploye(e.id) })
      )
    );
    zone.append(carte);
  }
}

function ouvrirFormEmploye(id = '') {
  const form = $('#formEmploye');
  if (!form) return;
  const e = id ? employeParId(id) : null;
  $('#employeId').value = e?.id || '';
  $('#employeEmoji').value = e?.emoji || '';
  $('#employeNom').value = e?.nom || '';
  $('#employeRole').value = e?.role || '';
  $('#employeInstructions').value = e?.instructions || '';
  const defaut = $('#employeDefautCheck');
  if (defaut) defaut.checked = Boolean(e && etat.config.employeDefaut === e.id);
  form.hidden = false;
  form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  setTimeout(() => $('#employeNom')?.focus(), 50);
}

function fermerFormEmploye() {
  const form = $('#formEmploye');
  if (form) form.hidden = true;
}

async function enregistrerFormulaireEmploye(evt) {
  evt.preventDefault();
  const nom = $('#employeNom').value.trim();
  if (!nom) { notifier('Donne un nom à l’employé.', 'erreur', 3000); $('#employeNom').focus(); return; }

  const id = $('#employeId').value || identifiant('emp');
  const employe = {
    id,
    nom: nom.slice(0, 40),
    emoji: ($('#employeEmoji').value.trim() || '🤖').slice(0, 4),
    role: $('#employeRole').value.trim().slice(0, 80),
    instructions: $('#employeInstructions').value.trim().slice(0, 8000)
  };

  const liste = listeEmployes().filter((e) => e.id !== id);
  liste.push(employe);

  let defaut = etat.config.employeDefaut || '';
  if ($('#employeDefautCheck')?.checked) defaut = id;
  else if (defaut === id) defaut = '';

  await enregistrerConfig({ employes: liste, employeDefaut: defaut });
  fermerFormEmploye();
  rendreEmployes();
  majPuceEmploye();
  notifier(`Employé « ${employe.nom} » enregistré.`, 'succes', 2500);
}

async function supprimerEmploye(id) {
  const e = employeParId(id);
  if (!e) return;
  const liste = listeEmployes().filter((x) => x.id !== id);
  const defaut = etat.config.employeDefaut === id ? '' : etat.config.employeDefaut;
  await enregistrerConfig({ employes: liste, employeDefaut: defaut });
  for (const conv of etat.conversations) {
    if (conv.employeId === id) conv.employeId = '';
  }
  persisterConversations();
  rendreEmployes();
  majPuceEmploye();
  afficherConversation();
  notifier(`Employé « ${e.nom} » supprimé.`, 'info', 2600);
}

let initialiserComportementBranche = false;
function brancherComportement() {
  // Les réglages sont réaffichés à chaque ouverture : on ne branche les
  // écouteurs qu'une fois, sinon ils s'empilent (fuite mémoire + double clic).
  if (initialiserComportementBranche) return;
  initialiserComportementBranche = true;
  const zone = $('#promptSysteme');
  if (zone) {
    zone.value = etat.config.systemPrompt || '';
    majCompteurPrompt();
    zone.addEventListener('input', majCompteurPrompt);
    zone.addEventListener('change', async () => {
      await enregistrerConfig({ systemPrompt: zone.value });
      notifier('Instructions enregistrées.', 'succes', 1800);
    });
  }

  $('#btnReinitialiserPrompt')?.addEventListener('click', async () => {
    const champ = $('#promptSysteme');
    if (champ) champ.value = '';
    majCompteurPrompt();
    await enregistrerConfig({ systemPrompt: '' });
    notifier('Instructions effacées.', 'info', 1800);
  });

  const temp = $('#temperature');
  if (temp) {
    const valeur = Math.round((etat.config.temperature ?? 0.7) * 10);
    temp.value = String(valeur);
    if ($('#valeurTemperature')) $('#valeurTemperature').textContent = (valeur / 10).toFixed(1).replace('.', ',');
    temp.addEventListener('input', () => {
      if ($('#valeurTemperature')) {
        $('#valeurTemperature').textContent = (Number(temp.value) / 10).toFixed(1).replace('.', ',');
      }
    });
    temp.addEventListener('change', async () => {
      await enregistrerConfig({ temperature: Number(temp.value) / 10 });
    });
  }

  rendrePresetsComportement();
  rendreEmployes();
  $('#btnNouvelEmploye')?.addEventListener('click', () => ouvrirFormEmploye());
  $('#btnAnnulerEmploye')?.addEventListener('click', fermerFormEmploye);
  $('#formEmploye')?.addEventListener('submit', enregistrerFormulaireEmploye);
  majPuceEmploye();
}

function majCompteurPrompt() {
  const champ = $('#promptSysteme');
  const c = $('#compteurPrompt');
  if (!champ || !c) return;
  const n = champ.value.length;
  c.textContent = `${n} caractère${n > 1 ? 's' : ''}`;
}

/* ------------------------ gestion des modèles ------------------------- */

/** Affiche la liste des modèles d'un fournisseur avec leurs actions. */
function rendreListeModeles(id, conteneur) {
  conteneur.innerHTML = '';
  const p = etat.config.providers?.[id] || {};
  const persos = (p.modeles || []).map((m) => (typeof m === 'string' ? m : m?.id)).filter(Boolean);
  const integres = (MODELES[id] || []).map((m) => m.id);
  const decouverts = [...new Set([...(p.modelesDecouverts || []), ...(etat.modelesDecouverts[id] || [])])];
  const defaut = p.model || '';

  const ligne = (nom, source) => {
    const estDefaut = nom === defaut;
    const item = el('div', { class: 'modele-item' + (estDefaut ? ' defaut' : '') },
      el('span', { class: 'modele-nom', text: nom, title: nom }),
      el('span', { class: `modele-source ${source}`, text:
        source === 'perso' ? 'ajouté'
        : source === 'decouvert' ? 'détecté'
        : source === 'defaut' ? 'par défaut'
        : 'intégré' })
    );

    const actions = el('div', { class: 'modele-actions' });

    if (!estDefaut) {
      actions.append(el('button', {
        class: 'btn-modele',
        text: '★',
        title: 'Définir comme modèle par défaut',
        onclick: async () => {
          const nouveau = [...new Set([...(p.modeles || []), nom])];
          await enregistrerConfig({ providers: { [id]: { model: nom, modeles: nouveau } } });
          rendreCartesFournisseurs();
          rafraichirModeles();
          majStatutFournisseur();
          notifier(`Modèle par défaut : ${nom}`, 'succes', 2200);
        }
      }));
    }

    if (source === 'perso') {
      actions.append(el('button', {
        class: 'btn-modele danger',
        text: '✕',
        title: 'Retirer ce modèle',
        onclick: async () => {
          const nouveau = persos.filter((m) => m !== nom);
          await enregistrerConfig({ providers: { [id]: { modeles: nouveau } } });
          rendreCartesFournisseurs();
          rafraichirModeles();
          notifier(`« ${nom} » retiré.`, 'info', 2000);
        }
      }));
    }

    item.append(actions);
    conteneur.append(item);
  };

  const affiches = new Set();

  // le modèle par défaut est toujours visible et marqué comme tel
  if (defaut) {
    ligne(defaut, 'defaut');
    affiches.add(defaut);
  }
  // modèles ajoutés par l'utilisateur
  for (const m of persos) {
    if (affiches.has(m)) continue;
    ligne(m, 'perso');
    affiches.add(m);
  }
  // modèles découverts non encore listés
  for (const m of decouverts) {
    if (affiches.has(m) || integres.includes(m)) continue;
    ligne(m, 'decouvert');
    affiches.add(m);
  }
  // modèles intégrés
  for (const m of integres) {
    if (affiches.has(m)) continue;
    ligne(m, 'integre');
    affiches.add(m);
  }

  if (!conteneur.children.length) {
    conteneur.append(el('p', { class: 'vide petit', text: 'Aucun modèle. Clique sur « Détecter » ou ajoute-en un.' }));
  }
}

/** Ajoute un modèle saisi à la main. */
async function ajouterModele(id, zone) {
  const champ = zone.querySelector(`input[data-ajout="${id}"]`);
  const nom = champ?.value.trim();
  if (!nom) return;

  const p = etat.config.providers?.[id] || {};
  const existants = (p.modeles || []).map((m) => (typeof m === 'string' ? m : m?.id)).filter(Boolean);
  if (existants.includes(nom)) {
    return notifier('Ce modèle est déjà dans la liste.', 'info', 2000);
  }

  await enregistrerConfig({ providers: { [id]: { modeles: [...existants, nom] } } });
  champ.value = '';
  rendreCartesFournisseurs();
  rafraichirModeles();
  notifier(`Modèle « ${nom} » ajouté.`, 'succes', 2200);
}

/** Valeurs actuellement saisies dans la carte d'un fournisseur. */
function valeursFournisseur(id) {
  const valeurs = {};
  for (const input of $$(`input[data-provider="${id}"][data-champ]`)) {
    const champ = input.dataset.champ;
    const valeur = input.value.trim();
    // une clé vide signifie « inchangé » ; l'URL et le modèle, eux, peuvent
    // être légitimement vidés.
    if (champ === 'apiKey' && valeur === '') continue;
    valeurs[champ] = valeur;
  }
  return valeurs;
}

async function sauverFournisseur(id, { silencieux = false } = {}) {
  const valeurs = valeursFournisseur(id);

  // La clé est re-chiffrée côté processus principal ; on vide le champ avant
  // le redessin pour qu'elle ne revienne pas en clair dans l'interface.
  const champCle = document.querySelector(`input[data-champ="apiKey"][data-provider="${id}"]`);
  if (champCle) champCle.value = '';

  await enregistrerConfig({ providers: { [id]: valeurs } });

  if (!silencieux) notifier(`Fournisseur ${NOMS_FOURNISSEURS[id]} enregistré.`, 'succes');
  rendreCartesFournisseurs();
  rafraichirModeles();
  majStatutFournisseur();
  return etat.config.providers?.[id] || null;
}

async function testerFournisseur(id) {
  // On enregistre d'abord la carte : sans cela, une clé collée mais pas
  // encore enregistrée n'était pas utilisée et le test répondait « Aucune
  // clé d'API enregistrée », comme si elle avait été perdue.
  await sauverFournisseur(id, { silencieux: true });

  const cible = document.querySelector(`.carte-fournisseur[data-provider-id="${id}"] .message-test`);
  if (!cible) return;
  cible.textContent = 'Test en cours…';
  cible.className = 'message-test';

  const champ = document.querySelector(`input[data-champ="model"][data-provider="${id}"]`);
  const modele = champ?.value.trim() || null;
  const res = await API.config.testerFournisseur(id, modele);

  // la carte a pu être redessinée pendant l'appel
  const cibleFinale = document.querySelector(`.carte-fournisseur[data-provider-id="${id}"] .message-test`) || cible;
  cibleFinale.textContent = res.ms ? `${res.message} (${res.ms} ms)` : res.message;
  cibleFinale.className = `message-test ${res.ok ? 'ok' : 'erreur'}`;
}

/** Interroge le fournisseur pour découvrir ses modèles. */
async function detecterModeles(id) {
  // La détection s'appuie sur la clé et l'URL saisies : on les enregistre
  // d'abord pour qu'elles ne soient pas perdues au prochain redessin.
  await sauverFournisseur(id, { silencieux: true });

  const p = etat.config.providers?.[id] || {};
  const urlInput = document.querySelector(`input[data-champ="baseUrl"][data-provider="${id}"]`);
  const baseUrl = urlInput?.value.trim() || p.baseUrl || '';

  if (!baseUrl) {
    return notifier("Renseigne d'abord l'URL de base.", 'erreur', 3000);
  }

  const bouton = document.querySelector(`.carte-fournisseur[data-provider-id="${id}"] button[data-detecter]`);
  const texte = bouton?.textContent || '';
  if (bouton) {
    bouton.disabled = true;
    bouton.textContent = '⟳ …';
  }

  // la clé enregistrée est lue côté processus principal
  const r = await API.models.lister({ providerId: id, baseUrl });

  if (bouton) {
    bouton.disabled = false;
    bouton.textContent = texte;
  }

  if (!r.ok) {
    return notifier(r.message, 'erreur', 7000);
  }
  if (!r.total) {
    return notifier('Le fournisseur n\'a renvoyé aucun modèle.', 'info', 4000);
  }

  etat.modelesDecouverts[id] = r.modeles;
  // la liste est conservée en configuration : elle survit au redémarrage
  await enregistrerConfig({ providers: { [id]: { modelesDecouverts: r.modeles } } });
  notifier(`${r.total} modèle(s) détecté(s). Clique sur ★ pour en choisir un par défaut.`, 'succes', 5000);
}

async function enregistrerConfig(patch) {
  etat.config = await API.config.mettreAJour(patch);

  // notifie les modules d'interface abonnés (sélecteur de modèle, etc.)
  for (const cb of window.cerveauUI?.surConfigChangee || []) {
    try { cb(); } catch { /* un abonné défaillant ne doit pas bloquer */ }
  }
  if (patch.ui) {
    if (patch.ui.theme) appliquerTheme(patch.ui.theme);
    if (patch.ui.fontScale) appliquerEchelle(patch.ui.fontScale);
  }
  await rafraichirFournisseurs();
  return etat.config;
}

/* ═══════════════════════════ CONVERSATIONS ═══════════════════════════ */

function nouvelleConversation({ silencieux = false } = {}) {
  viderFileAttente();
  sauverBrouillonImmediat();
  const conv = {
    id: identifiant('conv'),
    titre: 'Nouvelle conversation',
    date: Date.now(),
    messages: [],
    fournisseur: etat.config?.activeProvider || 'anthropic',
    employeId: etat.config?.employeDefaut || ''
  };
  etat.conversations.unshift(conv);
  etat.conversationCourante = conv;
  afficherConversation();
  afficherConversations();
  restaurerBrouillon();
  // sans cela, une conversation créée puis fermée aussitôt serait perdue
  persisterConversations();
  if (!silencieux) $('#saisie').focus();
}

function formaterJetons(n) {
  return Number(n || 0).toLocaleString('fr-FR');
}

/**
 * Barre de statistiques sous la conversation : jetons consommés (entrée /
 * sortie) et état du dernier appel API (latence, erreur).
 */
/* ------------------- recherche et statistiques ------------------------- */

let minuteurRecherche = null;
let statistiquesTexte = '';

let minuteurRechercheGlobale = null;

function ouvrirRechercheGlobale() {
  const modale = $('#modaleRechercheGlobale');
  const champ = $('#champRechercheGlobale');
  if (!modale || !champ) return;
  modale.hidden = false;
  $('#resultatsRechercheGlobale').innerHTML = '';
  setTimeout(() => champ.focus(), 40);
  if (champ.value.trim()) lancerRechercheGlobale();
}

function fermerRechercheGlobale() {
  const modale = $('#modaleRechercheGlobale');
  if (modale) modale.hidden = true;
}

function ouvrirResultatGlobal(convId, index) {
  fermerRechercheGlobale();
  convDeplies.add(convId);
  chargerConversation(convId);
  setTimeout(() => {
    const elMsg = document.querySelectorAll('#messages .message')[index];
    if (!elMsg) return;
    elMsg.scrollIntoView({ block: 'center', behavior: 'smooth' });
    elMsg.classList.add('surligne');
    setTimeout(() => elMsg.classList.remove('surligne'), 1800);
  }, 220);
}

function lancerRechercheGlobale() {
  const champ = $('#champRechercheGlobale');
  const zone = $('#resultatsRechercheGlobale');
  if (!champ || !zone) return;
  const requete = normaliserRecherche(champ.value.trim());
  zone.innerHTML = '';

  if (!requete) {
    zone.append(el('p', { class: 'vide petit', text: 'Tape un mot pour chercher dans tous les messages.' }));
    return;
  }

  const resultats = [];
  for (const conv of etat.conversations) {
    const messages = conv.messages || [];
    for (let i = 0; i < messages.length; i++) {
      const texte = String(messages[i].contenu || '');
      const pos = normaliserRecherche(texte).indexOf(requete);
      if (pos < 0) continue;
      const debut = Math.max(0, pos - 60);
      const extrait = texte.slice(debut, Math.min(texte.length, pos + requete.length + 90))
        .replace(/\s+/g, ' ').trim();
      resultats.push({
        conv,
        index: i,
        role: messages[i].role,
        extrait: `${debut > 0 ? '…' : ''}${extrait}${pos + requete.length + 90 < texte.length ? '…' : ''}`
      });
    }
  }

  resultats.sort((a, b) => (Number(b.conv.date) || 0) - (Number(a.conv.date) || 0));
  if (!resultats.length) {
    zone.append(el('p', { class: 'vide petit', text: 'Aucun message ne correspond.' }));
    return;
  }

  for (const r of resultats.slice(0, 40)) {
    zone.append(el('button', {
      class: 'resultat-global',
      type: 'button',
      onclick: () => ouvrirResultatGlobal(r.conv.id, r.index)
    },
      el('div', { class: 'resultat-global-titre', text: `${r.conv.titre || 'Conversation'} · ${r.role === 'user' ? 'Vous' : 'Assistant'}` }),
      el('div', { class: 'resultat-global-extrait', text: r.extrait })
    ));
  }
}

function ouvrirRechercheConversation() {
  const barre = $('#rechercheConversation');
  const champ = $('#champRechercheConversation');
  if (!barre || !champ) return;
  barre.hidden = false;
  champ.focus();
  champ.select();
  if (champ.value.trim()) lancerRechercheConversation(true);
}

function fermerRechercheConversation() {
  const barre = $('#rechercheConversation');
  if (!barre || barre.hidden) return;
  barre.hidden = true;
  const compte = $('#compteRecherche');
  if (compte) compte.textContent = '0';
  API.app.arreterRecherche().catch(() => {});
}

function lancerRechercheConversation(premier = false) {
  const champ = $('#champRechercheConversation');
  if (!champ) return;
  clearTimeout(minuteurRecherche);
  minuteurRecherche = setTimeout(() => {
    API.app.rechercher({ texte: champ.value, premier }).catch(() => {});
  }, 120);
}

function chercherSuivant(precedent = false) {
  const champ = $('#champRechercheConversation');
  if (!champ) return;
  API.app.rechercher({ texte: champ.value, suivant: !precedent, precedent }).catch(() => {});
}

function ouvrirImage(src, nom = '') {
  const modale = $('#modaleImage');
  const image = $('#imageAgrandie');
  if (!modale || !image || !src) return;
  image.src = src;
  image.alt = nom || 'image';
  modale.hidden = false;
}

function fermerImage() {
  const modale = $('#modaleImage');
  if (!modale || modale.hidden) return;
  modale.hidden = true;
  const image = $('#imageAgrandie');
  if (image) image.src = '';
}

function ouvrirStatistiques() {
  const conv = etat.conversationCourante;
  const corps = $('#corpsStatistiques');
  if (!corps) return;

  const usage = conv?.usage || {};
  const messages = conv?.messages?.length || 0;
  const tours = conv?.messages?.filter((m) => m.role === 'user').length || 0;
  const outils = conv?.messages?.reduce((n, m) => n + (m.outils?.length || 0), 0) || 0;
  const total = Number(usage.entree || 0) + Number(usage.sortie || 0);

  const lignes = [
    ['Conversation', conv?.titre || '—'],
    ['Mode', conv?.mode || '—'],
    ['Fournisseur', usage.fournisseur || '—'],
    ['Modèle', usage.modele || '—'],
    ['Messages', String(messages)],
    ['Tours', String(tours)],
    ['Appels API', String(usage.appels || 0)],
    ['Jetons entrée', formaterJetons(usage.entree || 0)],
    ['Jetons sortie', formaterJetons(usage.sortie || 0)],
    ['Jetons total', formaterJetons(total)],
    ['Dernière latence', usage.derniereMs ? `${usage.derniereMs} ms` : '—'],
    ['Étapes d’outils', String(outils)],
    ['Contexte compacté', conv?.resume ? 'oui' : 'non']
  ];

  corps.innerHTML = '';
  const table = el('table', { class: 'table-infos' });
  for (const [cle, valeur] of lignes) {
    table.append(el('tr', {}, el('td', { text: cle }), el('td', { text: valeur })));
  }
  corps.append(table);
  statistiquesTexte = lignes.map(([cle, valeur]) => `${cle} : ${valeur}`).join('\n');
  $('#modaleStatistiques').hidden = false;
}

function majStatistiquesConversation() {
  const conv = etat.conversationCourante;
  const usage = conv?.usage || null;
  const jetons = $('#statTokens');
  const api = $('#statApi');
  if (!jetons || !api) return;

  const entree = Number(usage?.entree || 0);
  const sortie = Number(usage?.sortie || 0);
  const total = entree + sortie;

  jetons.textContent = total
    ? `${formaterJetons(total)} jeton${total > 1 ? 's' : ''} · ${formaterJetons(entree)} ↑ / ${formaterJetons(sortie)} ↓`
    : 'Aucun jeton utilisé';
  jetons.title = usage?.appels
    ? `${usage.appels} appel(s) API depuis le début de la conversation`
    : 'Les jetons consommés apparaîtront après le premier échange';

  const statut = usage?.statut || 'pret';
  api.className = `stat-api ${statut === 'ok' ? 'ok' : statut}`;

  if (statut === 'erreur') {
    api.textContent = 'API · erreur';
    api.title = usage?.dernierMessage || 'La dernière requête a échoué';
    return;
  }
  if (statut === 'en_cours') {
    api.textContent = 'API · en cours';
    api.title = 'Une requête est en cours';
    return;
  }
  if (usage?.derniereMs != null) {
    const ms = Number(usage.derniereMs);
    api.textContent = `API · ${ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`}`;
    const modele = usage.modele ? ` · ${usage.modele}` : '';
    api.title = `Dernier appel réussi · ${usage.appels || 1} appel(s) au total${modele}`;
    return;
  }
  api.textContent = 'API · prête';
  api.title = 'Aucune requête envoyée dans cette conversation';

  const compacte = $('#statContexte');
  if (compacte) {
    compacte.hidden = !conv?.resume;
    compacte.title = conv?.resume || '';
  }
}

// conversations dont on a déjà chargé l'historique complet à l'écran
const convDeplies = new Set();

function afficherConversation() {
  const conv = etat.conversationCourante;
  if (typeof fermerRechercheConversation === 'function') fermerRechercheConversation();
  nettoyerReflexion();
  brancherRailTours();
  const messages = $('#messages');
  const accueil = $('#accueil');

  majPuceEmploye();
  $('#titreConversation').textContent = conv?.titre || 'Nouvelle conversation';
  const nbTours = conv ? conv.messages.filter((m) => m.role === 'user').length : 0;
  const sousTitre = conv?.messages?.length
    ? `${nbTours} tour(s) · ${conv.messages.length} message(s)`
    : 'Prêt à travailler';
  $('#sousTitreConversation').textContent = sousTitre;
  $('#sousTitreConversation').title = sousTitre;
  majStatistiquesConversation();

  if (!conv || conv.messages.length === 0) {
    accueil.style.display = '';
    messages.hidden = true;
    messages.innerHTML = '';
    rendreRailTours();
    return;
  }

  accueil.style.display = 'none';
  messages.hidden = false;
  messages.innerHTML = '';

  // les très longues discussions sont rendues par tranches : le chargement
  // reste instantané, et un bouton permet de remonter le fil
  const toutAfficher = convDeplies.has(conv.id);
  const debut = toutAfficher ? 0 : Math.max(0, conv.messages.length - 80);
  if (debut > 0) {
    messages.append(el('button', {
      class: 'btn-charger-plus',
      type: 'button',
      text: `Charger les ${debut} messages plus tôt`,
      onclick: () => { convDeplies.add(conv.id); afficherConversation(); }
    }));
  }
  for (const m of conv.messages.slice(debut)) ajouterMessageDOM(m);
  rendreRailTours();
  defilerEnBas();
}

function ajouterMessageDOM(m) {
  const messages = $('#messages');
  const estUtilisateur = m.role === 'user';

  const identite = estUtilisateur ? { nom: 'Vous', emoji: 'V' } : identiteAssistant();
  const bloc = el('div', { class: `message ${estUtilisateur ? 'utilisateur' : 'assistant'}` });
  bloc.append(
    el('div', { class: 'message-entete' },
      el('div', { class: 'avatar', text: identite.emoji }),
      el('span', { text: identite.nom })
    )
  );

  if (!estUtilisateur && m.outils?.length) {
    const outils = el('div', { class: 'outils-message' });
    for (const o of m.outils) {
      outils.append(el('div', { class: `outil-ligne ${o.ok ? 'ok' : 'refus'}` },
        el('span', { text: o.ok ? '✓' : '✕' }),
        el('span', { text: `${o.nom} — ${o.message || ''}` })
      ));
    }
    bloc.append(el('details', { class: 'details-travail' },
      el('summary', {}, `Détails du travail · ${m.outils.length} étape(s)`),
      outils
    ));
  }

  const corps = el('div', { class: 'message-corps markdown-corps' });
  if (estUtilisateur) {
    corps.textContent = m.contenu;
  } else {
    let html = cacheHtmlMessages.get(m);
    if (!html) {
      html = renduMarkdown.rendre(m.contenu);
      cacheHtmlMessages.set(m, html);
    }
    corps.innerHTML = html;
    renduMarkdown.embellir(corps);
  }
  bloc.append(corps);

  if (estUtilisateur && Array.isArray(m.images) && m.images.length) {
    const galerie = el('div', { class: 'images-message' });
    for (const img of m.images) {
      if (!img?.dataUrl) continue;
      const vignette = el('img', {
        class: 'image-message',
        src: img.dataUrl,
        alt: img.nom || 'image jointe',
        title: img.nom ? `${img.nom} — cliquer pour agrandir` : 'Cliquer pour agrandir'
      });
      vignette.addEventListener('click', () => ouvrirImage(img.dataUrl, img.nom));
      vignette.addEventListener('error', () => {
        vignette.replaceWith(el('span', {
          class: 'image-indisponible',
          text: `Image indisponible${img.nom ? ` · ${img.nom}` : ''}`
        }));
      });
      galerie.append(vignette);
    }
    if (galerie.children.length) bloc.append(galerie);
  }

  if (estUtilisateur && m.contenu) {
    const actions = el('div', { class: 'message-actions' },
      el('button', {
        class: 'btn-message', text: 'Copier',
        onclick: async () => {
          await navigator.clipboard.writeText(m.contenu);
          notifier('Message copié.', 'succes', 1800);
        }
      })
    );
    actions.append(el('button', {
      class: 'btn-message', text: 'Modifier',
      title: 'Replacer ce message dans la saisie (la suite du fil sera retirée)',
      onclick: () => modifierDernierMessage(m)
    }));
    bloc.append(actions);
  }

  if (!estUtilisateur && m.contenu) {
    const actions = el('div', { class: 'message-actions' },
      el('button', {
        class: 'btn-message', text: 'Copier',
        onclick: async () => {
          await navigator.clipboard.writeText(m.contenu);
          notifier('Réponse copiée.', 'succes', 1800);
        }
      }),
      el('button', {
        class: 'btn-message', text: 'Vers une note…',
        onclick: () => exporterVersCoffre(m.contenu)
      })
    );
    const estDerniere = etat.conversationCourante
      && etat.conversationCourante.messages[etat.conversationCourante.messages.length - 1] === m;
    if (estDerniere) {
      actions.append(el('button', {
        class: 'btn-message', text: 'Régénérer',
        onclick: () => regenererReponse()
      }));
    }
    bloc.append(actions);
  }

  messages.append(bloc);
  return bloc;
}

function afficherConversations() {
  const conteneur = $('#listeConversations');
  conteneur.innerHTML = '';
  const filtre = ($('#rechercheConv').value || '').toLowerCase();

  const liste = etat.conversations
    .filter((c) => !filtre || c.titre.toLowerCase().includes(filtre))
    .sort((a, b) => b.date - a.date);

  if (!liste.length) {
    conteneur.append(el('p', { class: 'vide', text: 'Aucune discussion.' }));
    return;
  }

  let dernierGroupe = '';
  for (const conv of liste) {
    const d = new Date(conv.date);
    const auj = new Date();
    let groupe;
    if (d.toDateString() === auj.toDateString()) groupe = "Aujourd'hui";
    else if (auj - d < 7 * 86400000) groupe = 'Cette semaine';
    else if (auj - d < 30 * 86400000) groupe = 'Ce mois-ci';
    else groupe = 'Plus ancien';

    if (groupe !== dernierGroupe) {
      conteneur.append(el('div', { class: 'groupe-date', text: groupe }));
      dernierGroupe = groupe;
    }

    const item = el('div', {
      class: `item-conv${conv.id === etat.conversationCourante?.id ? ' actif' : ''}`,
      onclick: () => chargerConversation(conv.id)
    },
      el('div', { class: 'item-conv-titre', text: conv.titre }),
      el('div', { class: 'item-conv-date', text: formaterDate(conv.date) })
    );

    const btnSuppr = el('button', {
      class: 'btn-suppr-conv', text: '✕', title: 'Supprimer'
    });
    btnSuppr.addEventListener('click', (e) => {
      e.stopPropagation();
      supprimerConversation(conv.id);
    });
    item.append(btnSuppr);
    conteneur.append(item);
  }
}

function chargerConversation(id) {
  const conv = etat.conversations.find((c) => c.id === id);
  if (!conv) return;
  viderFileAttente();
  sauverBrouillonImmediat();
  etat.conversationCourante = conv;
  afficherConversation();
  afficherConversations();
  restaurerBrouillon();
}

function supprimerConversation(id) {
  effacerBrouillon(id);
  etat.conversations = etat.conversations.filter((c) => c.id !== id);
  if (etat.conversationCourante?.id === id) {
    if (etat.conversations.length) chargerConversation(etat.conversations[0].id);
    else nouvelleConversation({ silencieux: true });
  }
  persisterConversations();
  afficherConversations();
}

let timerPersistance = null;
function persisterConversations() {
  clearTimeout(timerPersistance);
  timerPersistance = setTimeout(async () => {
    // On n'enregistre pas les conversations vides : elles n'ont aucun contenu
    // à reprendre et ne feraient qu'encombrer la liste. Celle qui est ouverte
    // est conservée, pour ne pas la faire disparaître sous les yeux.
    const utiles = etat.conversations.filter((c) =>
      (Array.isArray(c.messages) && c.messages.length)
      || c.id === etat.conversationCourante?.id
    );

    const limite = Math.max(10, Number(etat.config.general?.historiqueMax) || 200);
    const borne = utiles
      .sort((a, b) => b.date - a.date)
      .slice(0, limite)
      .map((c) => ({ ...c, messages: (c.messages || []).slice(-80) }));
    etat.config = await API.config.mettreAJour({ conversations: borne });
  }, 600);
}

/* ═══════════════════════════ ENVOI DE MESSAGE ═══════════════════════════ */

/* ═════════════════════ INDICATEUR DE RÉFLEXION ═════════════════════ */

/** Libellé selon le niveau de raisonnement choisi pour le fournisseur. */
function libelleReflexion() {
  const id = etat.config?.activeProvider;
  const effort = etat.effortsSession?.[id];
  if (effort === 'low') return 'Réflexion rapide';
  if (effort === 'medium') return 'Réflexion';
  return 'Réflexion approfondie';
}

function formaterDureeReflexion(ms) {
  const secondes = Math.max(0, Math.round(ms / 1000));
  if (secondes < 60) return `${secondes} s`;
  const minutes = Math.floor(secondes / 60);
  const reste = secondes % 60;
  return `${minutes} min${reste ? ` ${reste} s` : ''}`;
}

let reflexionActive = null;

/** Affiche la ligne « Réflexion approfondie depuis … ··· » en fin de conversation. */
function demarrerReflexion() {
  nettoyerReflexion();

  const texte = el('span', { class: 'reflexion-texte' });
  const ligne = el('div', { class: 'reflexion-ligne' },
    el('div', { class: 'reflexion-separateur' }),
    el('div', { class: 'reflexion-contenu' },
      el('span', { class: 'reflexion-icone' }),
      texte,
      el('span', { class: 'reflexion-points', text: '···' })
    )
  );

  $('#messages').append(ligne);
  $('#navTours')?.lastElementChild?.classList.add('occupe');
  reflexionActive = {
    ligne, texte, debut: Date.now(), label: libelleReflexion(), fige: false, minuteur: null
  };
  majReflexion();
  reflexionActive.minuteur = setInterval(majReflexion, 1000);
  defilerEnBas();
}

function majReflexion() {
  const r = reflexionActive;
  if (!r || r.fige) return;
  r.texte.textContent = `${r.label} depuis ${formaterDureeReflexion(Date.now() - r.debut)}`;
}

/** Fige la ligne : « Terminé en 2 min 27 s » ou « Interrompu après 34 s ». */
function figerReflexion(etat = 'termine') {
  const r = reflexionActive;
  if (!r || r.fige) return;
  r.fige = true;
  if (r.minuteur) clearInterval(r.minuteur);
  r.minuteur = null;

  const duree = formaterDureeReflexion(Date.now() - r.debut);
  r.ligne.classList.add(etat);
  r.texte.textContent = etat === 'erreur' ? `Interrompu après ${duree}` : `Terminé en ${duree}`;
  $('#navTours')?.querySelectorAll('.tour-mark.occupe').forEach((n) => n.classList.remove('occupe'));
}

/** Retire la ligne (nouvelle conversation, changement de discussion…). */
function nettoyerReflexion() {
  if (reflexionActive?.minuteur) clearInterval(reflexionActive.minuteur);
  reflexionActive = null;
  document.querySelectorAll('.reflexion-ligne').forEach((n) => n.remove());
  $('#navTours')?.querySelectorAll('.tour-mark.occupe').forEach((n) => n.classList.remove('occupe'));
}

/** Budget de compaction en caractères, adapté au modèle actif. */
function budgetCompaction() {
  const pid = etat.config.activeProvider;
  const modele = String(
    etat.modelesSession?.[pid] || etat.config.providers?.[pid]?.model || ''
  ).toLowerCase();
  let jetons = 64000;
  if (/claude/.test(modele)) jetons = 200000;
  else if (/gpt-5|gpt-6/.test(modele)) jetons = 400000;
  else if (/gpt-4\.1/.test(modele)) jetons = 1000000;
  else if (/gpt-4/.test(modele)) jetons = 128000;
  else if (/\bo[1-9]\b|o[1-9]-/.test(modele)) jetons = 200000;
  else if (/deepseek/.test(modele)) jetons = 128000;
  return Math.max(60000, Math.min(400000, Math.round(jetons * 4 * 0.35)));
}

/** Compacte les échanges anciens en un résumé quand le contexte devient gros. */
async function compacterSiBesoin(conv) {
  if (!conv || !Array.isArray(conv.messages)) return;
  const deja = conv.compacteJusqua || 0;
  const restants = conv.messages.slice(deja);
  const taille = restants.reduce((n, m) => n + String(m.contenu || '').length, 0);
  if (restants.length < 24 || taille < budgetCompaction()) return;

  const aResumer = restants.slice(0, restants.length - 8);
  if (aResumer.length < 8) return;

  const historique = aResumer.map((m) => {
    const role = m.role === 'user' ? 'Utilisateur' : 'Assistant';
    return `${role} : ${String(m.contenu || '').slice(0, 2000)}`;
  }).join('\n\n');

  const texte = (conv.resume ? `Résumé déjà existant :\n${conv.resume}\n\nNouveaux échanges :\n` : '')
    + historique;

  try {
    const r = await API.agent.resumer({ texte });
    if (!r?.ok) return;
    conv.resume = r.resume;
    conv.compacteJusqua = deja + aResumer.length;
    persisterConversations();
    notifier(`Contexte compacté : ${aResumer.length} échange(s) résumés.`, 'info', 4000);
    majStatistiquesConversation();
  } catch { /* en cas d'échec, l'historique reste simplement tronqué */ }
}

let minuteurBrouillon = null;
let restaurationRegeneration = null;
let fileAttente = [];

function cleBrouillon(id) {
  return `cerveau.brouillon.${id}`;
}

function ecrireBrouillon(id, valeur) {
  try {
    if (String(valeur || '').trim()) localStorage.setItem(cleBrouillon(id), valeur);
    else localStorage.removeItem(cleBrouillon(id));
  } catch { /* quota dépassé */ }
}

function sauverBrouillon() {
  const conv = etat.conversationCourante;
  const saisie = $('#saisie');
  if (!conv || !saisie) return;
  const valeur = saisie.value;
  clearTimeout(minuteurBrouillon);
  minuteurBrouillon = setTimeout(() => ecrireBrouillon(conv.id, valeur), 250);
}

/** Écrit le brouillon tout de suite (avant de changer de conversation). */
function sauverBrouillonImmediat() {
  const conv = etat.conversationCourante;
  const saisie = $('#saisie');
  if (!conv || !saisie) return;
  clearTimeout(minuteurBrouillon);
  ecrireBrouillon(conv.id, saisie.value);
}

function restaurerBrouillon() {
  const conv = etat.conversationCourante;
  const saisie = $('#saisie');
  if (!conv || !saisie) return;
  try { saisie.value = localStorage.getItem(cleBrouillon(conv.id)) || ''; } catch { saisie.value = ''; }
  ajusterHauteurSaisie();
}

function effacerBrouillon(id) {
  try { localStorage.removeItem(cleBrouillon(id)); } catch { /* ignore */ }
}

function majFileAttente() {
  const zone = $('#fileAttente');
  if (!zone) return;
  const n = fileAttente.length;
  zone.hidden = n === 0;
  if (!n) return;
  const premier = (fileAttente[0].texte || '').replace(/\s+/g, ' ').slice(0, 70);
  $('#texteFileAttente').textContent = `${n} message${n > 1 ? 's' : ''} en attente`
    + (premier ? ` · ${premier}${fileAttente[0].texte.length > 70 ? '…' : ''}` : '');
}

function viderFileAttente() {
  if (!fileAttente.length) return;
  fileAttente = [];
  majFileAttente();
}

/** Envoie le prochain message mis en attente pendant que l'agent travaillait. */
function traiterFileAttente() {
  if (etat.enCours || !fileAttente.length) return;
  const suivant = fileAttente.shift();
  majFileAttente();
  if (!etat.conversations.some((c) => c.id === suivant.convId)) return;
  if (etat.conversationCourante?.id !== suivant.convId) chargerConversation(suivant.convId);
  setTimeout(() => envoyerMessage({ texteFile: suivant.texte, piecesFile: suivant.pieces }), 250);
}

async function envoyerMessage(options = {}) {
  const regenerer = options?.regenerer === true;
  const depuisFile = typeof options?.texteFile === 'string';
  const saisie = $('#saisie');
  const conv = etat.conversationCourante;
  if (!conv || !saisie) return;

  // pendant une génération, le message part dans la file au lieu d'être perdu
  if (etat.enCours) {
    if (regenerer || depuisFile) return;
    const enAttente = saisie.value.trim();
    if (!enAttente && !piecesJointes.length) return;
    fileAttente.push({ convId: conv.id, texte: enAttente, pieces: piecesJointes.slice() });
    saisie.value = '';
    ajusterHauteurSaisie();
    piecesJointes = [];
    rendrePieces();
    effacerBrouillon(conv.id);
    majFileAttente();
    notifier(`Message en attente (${fileAttente.length}). Il partira dès que l'agent aura terminé.`, 'info', 3200);
    return;
  }

  let texte = depuisFile ? options.texteFile : saisie.value.trim();
  if (depuisFile) piecesJointes = Array.isArray(options.piecesFile) ? options.piecesFile : [];
  if (!regenerer && !texte && !piecesJointes.length) return;

  const providerId = etat.config.activeProvider;
  const modele = etat.modelesSession[providerId] || etat.config.providers?.[providerId]?.model || '';

  if (!etat.config.providers?.[providerId]?.hasKey) {
    notifier(`Aucune clé d'API pour ${NOMS_FOURNISSEURS[providerId]}. Ouvre les réglages.`, 'erreur', 5000);
    ouvrirReglages('fournisseurs');
    return;
  }

  if (regenerer) {
    const dernierUser = [...conv.messages].reverse().find((m) => m.role === 'user');
    if (!dernierUser) {
      notifier('Rien à régénérer dans cette conversation.', 'info', 2500);
      return;
    }
    texte = dernierUser.contenu;
    const dernier = conv.messages[conv.messages.length - 1];
    if (dernier?.role === 'assistant') {
      conv.messages.pop();
      restaurationRegeneration = { conv, message: dernier };
    }
  } else {
    restaurationRegeneration = null;
  }

  // contexte trop gros : on résume les échanges anciens avant d'envoyer
  await compacterSiBesoin(conv);

  if (!regenerer) {
    // message utilisateur
    const contenuComplet = composerMessage(texte);
    const images = imagesJointes();
    conv.messages.push({
      role: 'user',
      contenu: contenuComplet,
      // conservées pour que le modèle les voie vraiment, et pour l'historique
      ...(images.length ? { images } : {})
    });
    conv.date = Date.now();
    if (conv.titre === 'Nouvelle conversation') {
      conv.titre = texte.slice(0, 60) + (texte.length > 60 ? '…' : '');
    }
  }
  conv.fournisseur = providerId;
  if (!conv.usage) conv.usage = { entree: 0, sortie: 0, appels: 0 };
  conv.usage.statut = 'en_cours';
  conv.usage.fournisseur = NOMS_FOURNISSEURS[providerId] || providerId;
  conv.usage.modele = modele;
  majStatistiquesConversation();

  if (!regenerer) {
    if (!depuisFile) {
      saisie.value = '';
      ajusterHauteurSaisie();
      effacerBrouillon(conv.id);
    }
    piecesJointes = [];
    rendrePieces();
  }
  afficherConversation();
  afficherConversations();

  // bulle assistant en streaming
  etat.enCours = true;
  basculerEtatEnvoi(true);

  const bloc = el('div', { class: 'message assistant' });
  bloc.append(
    el('div', { class: 'message-entete' },
      el('div', { class: 'avatar', text: identiteAssistant().emoji }),
      el('span', { text: identiteAssistant().nom })
    )
  );
  const zoneOutils = el('div', { class: 'outils-message' });
  const corps = el('div', { class: 'message-corps markdown-corps' });

  bloc.append(zoneOutils, corps);
  // la bulle n'apparaît qu'au premier contenu : tant que le modèle réfléchit,
  // seule la ligne « Réflexion approfondie depuis … » est visible
  bloc.hidden = true;
  $('#messages').append(bloc);
  defilerEnBas();

  const etatFlux = { texte: '', outils: [], corps, zoneOutils, bloc };
  fluxActif = etatFlux;
  demarrerReflexion();

  try {
    const res = await API.agent.envoyer({
      providerId,
      mode: etat.mode,
      modeles: { ...etat.modelesSession },
      resume: conv.resume || '',
      employe: employePourAgent(),
      effort: etat.effortsSession?.[providerId] || null,
      // borne l'historique : au-delà, la fenêtre de contexte du modèle déborde
      // et l'API renvoie une erreur. On garde les échanges les plus récents, et
      // on n'envoie plus ceux déjà résumés. Le plancher protège le cas où des
      // messages ont été retirés (régénération) sous la marque de compaction.
      historique: bornHistorique(conv.messages.slice(
        Math.max(0, Math.min(conv.compacteJusqua || 0, conv.messages.length - 1))
      ))
    });

    finaliserMessage(conv, etatFlux, res);
  } catch (err) {
    if (restaurerReponseRegeneree(conv, err.message)) {
      etatFlux.bloc.remove();
    } else {
      etatFlux.bloc.hidden = false;
      figerReflexion('erreur');
      corps.textContent = `Erreur : ${err.message || err}`;
    }
    if (!conv.usage) conv.usage = { entree: 0, sortie: 0, appels: 0 };
    conv.usage.statut = 'erreur';
    conv.usage.dernierMessage = String(err.message || err);
    majStatistiquesConversation();
  } finally {
    fluxActif = null;
    etat.enCours = false;
    basculerEtatEnvoi(false);
    majStatutFournisseur();
    traiterFileAttente();
    if (modele) { /* le modèle actif reste celui des réglages */ }
  }
}

let fluxActif = null;

/** Replace le dernier message dans la saisie et retire la suite du fil. */
function modifierDernierMessage(message) {
  if (etat.enCours) {
    notifier('Attends la fin de la réponse avant de modifier le message.', 'info', 3000);
    return;
  }
  const conv = etat.conversationCourante;
  const index = conv?.messages?.indexOf(message);
  if (!conv || index < 0) return;

  viderFileAttente();
  conv.messages.splice(index);
  conv.date = Date.now();
  persisterConversations();
  afficherConversation();

  const saisie = $('#saisie');
  if (saisie) {
    saisie.value = message.contenu || '';
    ajusterHauteurSaisie();
    sauverBrouillon();
    saisie.focus();
  }
  piecesJointes = Array.isArray(message.images)
    ? message.images.map((img) => ({ ...img, type: 'image' }))
    : [];
  rendrePieces();
  notifier('Message replacé dans la saisie : modifie-le puis renvoie.', 'info', 4000);
}

function dupliquerConversation() {
  const conv = etat.conversationCourante;
  if (!conv) return;
  const copie = JSON.parse(JSON.stringify(conv));
  copie.id = identifiant('conv');
  copie.titre = `${conv.titre || 'Conversation'} (copie)`;
  copie.date = Date.now();
  delete copie.titreGenere;
  delete copie.titreTente;
  etat.conversations.unshift(copie);
  chargerConversation(copie.id);
  afficherConversations();
  persisterConversations();
  notifier('Conversation dupliquée.', 'succes', 2400);
}

function regenererReponse() {
  if (etat.enCours) {
    notifier('Une requête est déjà en cours.', 'info', 2500);
    return;
  }
  envoyerMessage({ regenerer: true });
}

function replierOutils(zoneOutils) {
  if (!zoneOutils || !zoneOutils.children.length) return;
  if (zoneOutils.closest('details.details-travail')) return;
  const nombre = zoneOutils.querySelectorAll('.outil-ligne').length;
  const details = el('details', { class: 'details-travail' },
    el('summary', {}, `Détails du travail · ${nombre} étape(s)`)
  );
  zoneOutils.replaceWith(details);
  details.append(zoneOutils);
  details.open = false;
}

function restaurerReponseRegeneree(conv, erreur) {
  const sauvegarde = restaurationRegeneration;
  if (!sauvegarde || sauvegarde.conv !== conv) return false;
  conv.messages.push(sauvegarde.message);
  conv.date = Date.now();
  restaurationRegeneration = null;
  persisterConversations();
  afficherConversation();
  notifier(
    `Régénération impossible${erreur ? ` (${String(erreur).slice(0, 80)})` : ''} : réponse précédente conservée.`,
    'erreur',
    5000
  );
  return true;
}

function finaliserMessage(conv, etatFlux, res) {
  const texteAvant = etatFlux.texte.trim();
  if (!texteAvant && restaurerReponseRegeneree(conv, res?.erreur || 'réponse vide')) {
    etatFlux.bloc.remove();
    return;
  }
  etatFlux.bloc.hidden = false;
  figerReflexion(res?.erreur ? 'erreur' : 'termine');
  replierOutils(etatFlux.zoneOutils);
  const texteFinal = etatFlux.texte.trim();
  if (texteFinal) restaurationRegeneration = null;
  etatFlux.corps.innerHTML = renduMarkdown.rendre(texteFinal || (res.erreur ? `⚠️ ${res.erreur}` : ''));
  renduMarkdown.embellir(etatFlux.corps);

  // une erreur en cours de route ne doit pas rester invisible sous un texte partiel
  if (res?.erreur && texteFinal) {
    etatFlux.bloc.append(el('div', {
      class: 'message-erreur',
      text: `⚠️ Arrêt : ${res.erreur}`
    }));
  }

  if (texteFinal) {
    conv.messages.push({
      role: 'assistant',
      contenu: texteFinal,
      outils: etatFlux.outils.length ? etatFlux.outils : undefined
    });
    const actions = el('div', { class: 'message-actions' },
      el('button', {
        class: 'btn-message', text: 'Copier',
        onclick: async () => {
          await navigator.clipboard.writeText(texteFinal);
          notifier('Réponse copiée.', 'succes', 1800);
        }
      }),
      el('button', {
        class: 'btn-message', text: 'Vers une note…',
        onclick: () => exporterVersCoffre(texteFinal)
      }),
      el('button', {
        class: 'btn-message', text: 'Régénérer',
        onclick: () => regenererReponse()
      })
    );
    etatFlux.bloc.append(actions);
  }

  conv.date = Date.now();
  persisterConversations();
  afficherConversations();
  defilerEnBas();
  rafraichirCoffre();
  demanderTitre(conv);
}

/** Demande au modèle un titre court après le premier échange. */
async function demanderTitre(conv) {
  if (!conv || etat.config.general?.titresAuto === false) return;
  if (conv.titreGenere || conv.titreTente) return;

  const demandes = conv.messages.filter((m) => m.role === 'user');
  if (demandes.length !== 1) return;
  const reponse = conv.messages.find((m) => m.role === 'assistant');
  if (!reponse) return;

  conv.titreTente = true;
  try {
    const r = await API.agent.titre({
      texte: `Utilisateur : ${demandes[0].contenu.slice(0, 1500)}\n`
        + `Assistant : ${reponse.contenu.slice(0, 1500)}`
    });
    if (!r?.ok || !r.titre) return;
    conv.titre = r.titre;
    conv.titreGenere = true;
    if (etat.conversationCourante === conv) $('#titreConversation').textContent = r.titre;
    afficherConversations();
    persisterConversations();
  } catch { /* le titre est un bonus, jamais bloquant */ }
}

function basculerEtatEnvoi(enCours) {
  const envoyer = $('#btnEnvoyer');
  if (envoyer) {
    envoyer.hidden = false;
    envoyer.disabled = false;
    envoyer.title = enCours
      ? 'Mettre le message en attente (il partira après la réponse en cours)'
      : 'Envoyer (Entrée)';
  }
  $('#btnArreter').hidden = !enCours;
  $('#saisie').disabled = false;
  if (!enCours) $('#saisie').focus();
}

function defilerEnBas() {
  const zone = $('#conversation');
  requestAnimationFrame(() => { zone.scrollTop = zone.scrollHeight; majBoutonRetourBas(); });
}

function majBoutonRetourBas() {
  const zone = $('#conversation');
  const bouton = $('#btnRetourBas');
  const messages = $('#messages');
  if (!zone || !bouton) return;
  const distance = zone.scrollHeight - zone.scrollTop - zone.clientHeight;
  bouton.hidden = !messages || messages.hidden || distance < 280;
}

/* --------------------- navigation entre les tours ---------------------- */

let railToursBranche = false;

function brancherRailTours() {
  if (railToursBranche) return;
  railToursBranche = true;
  const conv = $('#conversation');
  if (!conv) return;

  let frame = null;
  conv.addEventListener('scroll', () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      majMarqueActive();
      majBoutonRetourBas();
      masquerApercuTour();
    });
  }, { passive: true });

  $('#btnRetourBas')?.addEventListener('click', () => defilerEnBas());

  window.addEventListener('resize', majMarqueActive);
}

function utilisateursConversation() {
  return [...document.querySelectorAll('#messages .message.utilisateur')];
}

/** Un point par tour, à droite de la conversation. */
function rendreRailTours() {
  const nav = $('#navTours');
  const messages = $('#messages');
  if (!nav) return;

  nav.innerHTML = '';
  const utilisateurs = messages && !messages.hidden ? utilisateursConversation() : [];
  nav.hidden = utilisateurs.length < 2;
  if (nav.hidden) {
    masquerApercuTour();
    return;
  }

  utilisateurs.forEach((msg, i) => {
    const marque = el('button', {
      class: 'tour-mark',
      type: 'button',
      'aria-label': `Aller au tour ${i + 1}`
    });
    marque.addEventListener('click', () => {
      msg.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    marque.addEventListener('pointerenter', () => afficherApercuTour(marque, msg));
    marque.addEventListener('pointerleave', masquerApercuTour);
    marque.addEventListener('focus', () => afficherApercuTour(marque, msg));
    marque.addEventListener('blur', masquerApercuTour);
    nav.append(marque);
  });

  majMarqueActive();
}

function majMarqueActive() {
  const nav = $('#navTours');
  const conv = $('#conversation');
  if (!nav || nav.hidden || !conv) return;

  const utilisateurs = utilisateursConversation();
  const repere = conv.getBoundingClientRect().top + 90;
  let actif = 0;
  utilisateurs.forEach((m, i) => {
    if (m.getBoundingClientRect().top <= repere) actif = i;
  });
  [...nav.children].forEach((m, i) => m.classList.toggle('actif', i === actif));
}

function afficherApercuTour(marque, msg) {
  const apercu = $('#tourApercu');
  if (!apercu) return;

  const prompt = (msg.querySelector('.message-corps')?.textContent || '').trim();
  let suivant = msg.nextElementSibling;
  let reponse = '';
  while (suivant) {
    if (suivant.classList.contains('utilisateur')) break;
    if (suivant.classList.contains('assistant')) {
      reponse = (suivant.querySelector('.message-corps')?.textContent || '').trim();
    }
    suivant = suivant.nextElementSibling;
  }

  apercu.innerHTML = '';
  apercu.append(el('div', {
    class: 'tour-apercu-prompt',
    text: prompt || 'Tour sans message'
  }));
  if (reponse) {
    apercu.append(el('div', { class: 'tour-apercu-reponse', text: reponse }));
  }

  apercu.hidden = false;
  const r = marque.getBoundingClientRect();
  apercu.style.left = `${Math.max(8, r.left - apercu.offsetWidth - 16)}px`;
  apercu.style.top = `${Math.max(8, r.top + r.height / 2 - apercu.offsetHeight / 2)}px`;
}

function masquerApercuTour() {
  const apercu = $('#tourApercu');
  if (apercu) apercu.hidden = true;
}

/* ------------------ rendu différé du texte en streaming ------------------ */

/**
 * Re-rendre le Markdown à chaque jeton coûte cher. On regroupe les deltas sur
 * une frame : le rendu reste fluide et le processeur respire.
 */
function planifierRenduTexte(flux) {
  if (flux.renduTextePrevu) return;
  flux.renduTextePrevu = true;
  requestAnimationFrame(() => {
    flux.renduTextePrevu = false;
    if (!flux.bloc?.isConnected) return;
    flux.corps.innerHTML = renduMarkdown.rendre(flux.texte);
    defilerEnBas();
  });
}

/* --------------------- traitement des événements agent ----------------- */

function traiterEvenementAgent(evt) {
  // Les statistiques ne dépendent pas du flux : l'événement « usage » peut
  // arriver une fois la requête terminée, quand fluxActif est déjà remis à zéro.
  if (evt.type === 'usage') {
    const u = evt.usage || {};
    const conv = etat.conversationCourante;
    if (conv) {
      if (!conv.usage) conv.usage = { entree: 0, sortie: 0, appels: 0 };
      const entree = Number(u.input_tokens ?? u.prompt_tokens ?? 0) || 0;
      const sortie = Number(u.output_tokens ?? u.completion_tokens ?? 0) || 0;
      conv.usage.entree += entree;
      conv.usage.sortie += sortie;
      conv.usage.appels += 1;
      if (Number.isFinite(evt.ms)) conv.usage.derniereMs = evt.ms;
      conv.usage.statut = 'ok';
      conv.usage.dernierMessage = '';
    }
    majStatistiquesConversation();
    return;
  }

  const flux = fluxActif;
  if (!flux) return;

  const { corps, zoneOutils } = flux;

  switch (evt.type) {
    case 'texte': {
      const ind = corps.querySelector('.indicateur');
      if (ind) ind.remove();
      flux.bloc.hidden = false;
      flux.texte += evt.delta;
      planifierRenduTexte(flux);
      break;
    }
    case 'outil_debut': {
      flux.bloc.hidden = false;
      if (reflexionActive && !reflexionActive.fige) {
        reflexionActive.label = `Exécution de ${evt.nom || 'l’outil'}`;
        majReflexion();
      }
      // sépare le texte du tour précédent de celui qui suivra l'appel d'outil
      if (flux.texte && !flux.texte.endsWith('\n\n')) {
        flux.texte = `${flux.texte.replace(/\s+$/, '')}\n\n`;
        planifierRenduTexte(flux);
      }
      const ligne = el('div', {
        class: 'outil-ligne en-cours',
        'data-outil': evt.id || '',
        'data-nom': evt.nom || ''
      },
        el('div', { class: 'outil-spinner' }),
        el('span', { text: evt.nom })
      );
      zoneOutils.append(ligne);
      defilerEnBas();
      break;
    }
    case 'outil_appel':
      break;
    case 'outil_resultat': {
      const lignes = [...zoneOutils.querySelectorAll('.outil-ligne.en-cours')];
      const cible = lignes[lignes.length - 1];
      if (cible) {
        const nom = cible.dataset.nom || evt.nom || '';
        cible.classList.remove('en-cours');
        cible.classList.add(evt.ok ? 'ok' : 'refus');
        cible.innerHTML = '';
        cible.append(
          el('span', { text: evt.ok ? '✓' : '✕' }),
          el('span', { text: `${nom} — ${evt.message || ''}`.trim() })
        );
      }
      flux.outils.push({ nom: evt.nom, ok: evt.ok, message: evt.message });
      if (reflexionActive && !reflexionActive.fige) {
        reflexionActive.label = libelleReflexion();
        majReflexion();
      }
      rafraichirCoffre();
      break;
    }
    case 'confirmation_demande': {
      afficherConfirmation(evt);
      break;
    }
    case 'avertissement': {
      notifier(evt.message, 'erreur', 9000);
      const zone = zoneOutils;
      if (zone) {
        zone.append(el('div', { class: 'outil-ligne refus' },
          el('span', { text: '⚠' }),
          el('span', { text: evt.message })
        ));
      }
      break;
    }
    case 'plan': {
      rendrePlan(evt.taches);
      break;
    }
    case 'verification': {
      if (reflexionActive && !reflexionActive.fige) {
        reflexionActive.label = evt.phase === 'debut' ? 'Vérification du résultat' : libelleReflexion();
        majReflexion();
      }
      break;
    }
    case 'erreur': {
      const ind = corps.querySelector('.indicateur');
      if (ind) ind.remove();
      flux.bloc.hidden = false;
      figerReflexion('erreur');
      const convErr = etat.conversationCourante;
      if (convErr) {
        if (!convErr.usage) convErr.usage = { entree: 0, sortie: 0, appels: 0 };
        convErr.usage.statut = 'erreur';
        convErr.usage.dernierMessage = evt.message;
        majStatistiquesConversation();
      }
      notifier(evt.message, 'erreur', 6000);
      if (!fluxCourant?.texte) {
        corps.innerHTML = `<p style="color:var(--danger)">⚠️ ${echapper(evt.message)}</p>`;
      }
      break;
    }
    case 'termine': {
      figerReflexion('termine');
      // les serveurs MCP ont pu démarrer pendant la requête
      if ($('#modaleReglages') && !$('#modaleReglages').hidden) rafraichirEtatsMCP();
      break;
    }
    default:
      break;
  }
}

function afficherConfirmation(evt) {
  etat.confirmationEnAttente = evt.id;

  const titres = {
    ecriture: 'Autoriser la modification ?',
    commande: 'Autoriser cette commande ?',
    destructif: '⚠️ Action destructive — confirmer ?',
    lecture: 'Autoriser la lecture ?'
  };

  $('#titreConfirmation').textContent = titres[evt.risque] || 'Autoriser cette action ?';

  // pour une commande shell, on met la commande en avant
  if (evt.risque === 'commande' && evt.arguments?.commande) {
    const dossier = evt.arguments.repertoire ? `dans « ${evt.arguments.repertoire} »` : "à la racine du projet";
    $('#texteConfirmation').innerHTML =
      `Cerveau veut exécuter cette commande ${echapper(dossier)} :`;
    $('#argumentsConfirmation').textContent = String(evt.arguments.commande);
  } else {
    $('#texteConfirmation').innerHTML =
      `L'IA veut exécuter <strong>${echapper(evt.nom)}</strong>.<br><span class="aide">${echapper(evt.description || '')}</span>`;
    $('#argumentsConfirmation').textContent = JSON.stringify(evt.arguments, null, 2);
  }

  $('#modaleConfirmation').hidden = false;
  $('#btnAutoriserAction').focus();
}

function repondreConfirmation(autorise) {
  if (etat.confirmationEnAttente) {
    API.agent.repondreConfirmation(etat.confirmationEnAttente, autorise);
    etat.confirmationEnAttente = null;
  }
  $('#modaleConfirmation').hidden = true;
}

/* ═══════════════════════════ COFFRE OBSIDIAN ═══════════════════════════ */

async function rafraichirCoffre() {
  const coffre = etat.config.vaults?.find((v) => v.id === etat.config.activeVaultId);
  $('#vaultNom').textContent = coffre ? coffre.name : 'Aucun coffre';

  if (!coffre) {
    $('#arbreCoffre').innerHTML = '';
    $('#arbreCoffre').append(el('p', { class: 'vide', text: 'Aucun coffre ouvert. Réglages → Coffres.' }));
    $('#listeTags').innerHTML = '';
    return;
  }

  try {
    etat.arbre = await API.obs.arborescence();
    rendreArbre(etat.arbre);
  } catch (err) {
    $('#arbreCoffre').innerHTML = '';
    $('#arbreCoffre').append(el('p', { class: 'vide', text: err.message }));
    return;
  }

  try {
    const tags = await API.obs.tags();
    rendreTags(tags, $('#listeTags'));
    rendreTags(tags, $('#tagsPananeau'), true);
  } catch { /* ignore */ }
}

function rendreArbre(noeuds, conteneur = $('#arbreCoffre'), profondeur = 0) {
  if (profondeur === 0) conteneur.innerHTML = '';

  if (!noeuds.length) {
    if (profondeur === 0) conteneur.append(el('p', { class: 'vide', text: 'Coffre vide. Créez votre première note.' }));
    return;
  }

  for (const n of noeuds) {
    if (n.type === 'dossier') {
      const enfants = el('div', { class: 'enfants-dossier' });
      const ligne = el('div', { class: 'noeud noeud-dossier' },
        el('span', { class: 'noeud-icone', text: '▸' }),
        el('span', { class: 'noeud-nom', text: n.name })
      );
      ligne.addEventListener('click', () => {
        const icone = ligne.querySelector('.noeud-icone');
        const cache = enfants.classList.toggle('cache');
        icone.textContent = cache ? '▸' : '▾';
      });
      conteneur.append(ligne, enfants);
      rendreArbre(n.children || [], enfants, profondeur + 1);
    } else {
      const ligne = el('div', {
        class: `noeud${etat.noteCourante === n.path ? ' actif' : ''}`,
        title: n.path
      },
        el('span', { class: 'noeud-icone', text: '·' }),
        el('span', { class: 'noeud-nom', text: n.name.replace(/\.md$/, '') })
      );
      ligne.addEventListener('click', () => ouvrirNote(n.path));
      ligne.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        menuContextuelNote(e, n.path);
      });
      conteneur.append(ligne);
    }
  }
}

function menuContextuelNote(e, chemin) {
  const existant = $('#menu-contexte');
  if (existant) existant.remove();

  const menu = el('div', { id: 'menu-contexte', class: 'menu-contexte' },
    el('button', {
      class: 'btn-pied', text: 'Ouvrir dans Obsidian',
      onclick: async () => {
        await API.coffre.ouvrirDansObsidian(chemin);
        menu.remove();
      }
    }),
    el('button', {
      class: 'btn-pied', text: 'Insérer dans le message',
      onclick: () => {
        insérerNoteDansMessage(chemin);
        menu.remove();
      }
    }),
    el('button', {
      class: 'btn-pied', text: 'Déplacer / renommer…',
      onclick: async () => {
        menu.remove();
        const nouveau = await demanderTexte({
          titre: 'Déplacer la note',
          valeur: chemin,
          aide: 'Nouveau chemin relatif dans le coffre.'
        });
        if (nouveau && nouveau !== chemin) {
          try {
            await API.obs.deplacer(chemin, nouveau);
            notifier('Note déplacée.', 'succes');
            await rafraichirCoffre();
            if (etat.noteCourante === chemin) ouvrirNote(nouveau);
          } catch (err) {
            notifier(err.message, 'erreur');
          }
        }
      }
    }),
    el('button', {
      class: 'btn-pied', text: 'Mettre à la corbeille',
      onclick: async () => {
        menu.remove();
        if (!confirm(`Déplacer « ${chemin} » vers la corbeille du coffre ?`)) return;
        try {
          await API.obs.supprimer(chemin);
          notifier('Note déplacée dans .trash.', 'succes');
          if (etat.noteCourante === chemin) {
            etat.noteCourante = null;
            $('#noteRendu').innerHTML = '<p class="vide">Sélectionnez une note dans le coffre.</p>';
            $('#noteChemin').value = '';
          }
          await rafraichirCoffre();
        } catch (err) {
          notifier(err.message, 'erreur');
        }
      }
    })
  );

  menu.style.position = 'fixed';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.style.zIndex = '3000';
  menu.style.background = 'var(--fond-3)';
  menu.style.border = '1px solid var(--bordure-claire)';
  menu.style.borderRadius = '8px';
  menu.style.padding = '5px';
  menu.style.boxShadow = 'var(--ombre)';
  menu.style.display = 'flex';
  menu.style.flexDirection = 'column';
  menu.style.minWidth = '210px';

  document.body.append(menu);
  setTimeout(() => {
    const fermer = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('mousedown', fermer);
      }
    };
    document.addEventListener('mousedown', fermer);
  }, 10);
}

function rendreTags(tags, conteneur, pleineTaille = false) {
  conteneur.innerHTML = '';
  if (!tags.length) {
    conteneur.append(el('p', { class: 'vide', text: 'Aucun tag.' }));
    return;
  }
  for (const t of tags) {
    const puce = el('button', { class: 'puce-tag', onclick: () => rechercherTag(t.tag) },
      `#${t.tag}`,
      el('span', { class: 'compte', text: String(t.count) })
    );
    if (pleineTaille) puce.style.fontSize = '11.5px';
    conteneur.append(puce);
  }
}

async function rechercherTag(tag) {
  actifOngletPanneau('tags');
  try {
    const notes = await API.obs.notesParTag(tag);
    const conteneur = $('#notesDuTag');
    conteneur.innerHTML = '';
    conteneur.append(el('div', { class: 'section-titre', text: `#${tag} — ${notes.length} note(s)` }));
    if (!notes.length) {
      conteneur.append(el('p', { class: 'vide', text: 'Aucune note avec ce tag.' }));
      return;
    }
    for (const n of notes) {
      const item = el('div', { class: 'lien-item', text: n.path });
      item.addEventListener('click', () => ouvrirNote(n.path));
      conteneur.append(item);
    }
  } catch (err) {
    notifier(err.message, 'erreur');
  }
}

async function ouvrirNote(chemin) {
  if (!etat.config.activeVaultId) {
    notifier('Aucun coffre ouvert.', 'erreur');
    return;
  }
  try {
    const resolution = await resoudreChemin(chemin);
    if (!resolution) {
      notifier(`Note introuvable : ${chemin}`, 'erreur');
      return;
    }
    const note = await API.obs.lire(resolution);
    etat.noteCourante = note.path;
    actifOngletPanneau('note');

    $('#noteChemin').value = note.path;
    const zone = $('#noteRendu');
    zone.innerHTML = renduMarkdown.rendre(note.content);
    renduMarkdown.embellir(zone);
    zone.hidden = false;
    $('#noteEditeur').hidden = true;
    $('#btnNoteEditer').hidden = false;
    $('#btnNoteEnregistrer').hidden = true;
    $('#noteEditeur').value = note.content;
    etat.modeEditionNote = false;

    await afficherLiens(note.path);
    $$('#arbreCoffre .noeud').forEach((n) => n.classList.remove('actif'));
    $$('#arbreCoffre .noeud').forEach((n) => {
      if (n.title === note.path) n.classList.add('actif');
    });
  } catch (err) {
    notifier(err.message, 'erreur');
  }
}

async function resoudreChemin(demande) {
  // accepte [[Note]] sans extension ni dossier
  const notes = await API.obs.lister();
  const d = String(demande).replace(/\.md$/, '');
  const exact = notes.find((n) => n.path === demande);
  if (exact) return exact.path;
  const avecMd = notes.find((n) => n.path === `${demande}.md`);
  if (avecMd) return avecMd.path;
  const parBase = notes.find((n) => n.name.replace(/\.md$/, '').toLowerCase() === d.toLowerCase());
  if (parBase) return parBase.path;
  const parFin = notes.find((n) => n.path.toLowerCase().endsWith(`/${d.toLowerCase()}.md`));
  return parFin ? parFin.path : null;
}

async function afficherLiens(chemin) {
  try {
    const liens = await API.obs.liens(chemin);
    const conteneur = $('#liensNote');
    conteneur.innerHTML = '';

    conteneur.append(el('div', { class: 'groupe-liens' },
      el('h4', { text: `Liens sortants (${liens.sortants.length})` })
    ));
    if (!liens.sortants.length) {
      conteneur.querySelector('.groupe-liens').append(el('p', { class: 'vide', text: 'Aucun lien sortant.' }));
    }
    for (const l of liens.sortants) {
      const item = el('div', { class: 'lien-item', text: `→ ${l}` });
      item.addEventListener('click', () => ouvrirNote(l));
      conteneur.querySelector('.groupe-liens').append(item);
    }

    const groupe2 = el('div', { class: 'groupe-liens' },
      el('h4', { text: `Backlinks (${liens.entrants.length})` })
    );
    if (!liens.entrants.length) groupe2.append(el('p', { class: 'vide', text: 'Aucune note ne pointe ici.' }));
    for (const l of liens.entrants) {
      const item = el('div', { class: 'lien-item', text: `← ${l.path}` });
      item.addEventListener('click', () => ouvrirNote(l.path));
      groupe2.append(item);
    }
    conteneur.append(groupe2);
  } catch { /* ignore */ }
}

/* ═══════════════════════════ RECHERCHE ═══════════════════════════ */

let timerRecherche = null;

async function lancerRecherche(query) {
  const conteneur = $('#resultatsRecherche');
  if (!query.trim()) {
    conteneur.innerHTML = '';
    return;
  }
  if (!etat.config.activeVaultId) {
    conteneur.innerHTML = '';
    conteneur.append(el('p', { class: 'vide', text: 'Aucun coffre ouvert.' }));
    return;
  }
  conteneur.innerHTML = '';
  conteneur.append(el('p', { class: 'vide', text: 'Recherche…' }));
  try {
    const res = await API.obs.rechercher(query, { limit: 40 });
    conteneur.innerHTML = '';
    if (!res.length) {
      conteneur.append(el('p', { class: 'vide', text: 'Aucun résultat.' }));
      return;
    }
    conteneur.append(el('div', { class: 'section-titre', text: `${res.length} note(s)` }));
    for (const r of res) {
      const item = el('div', { class: 'resultat-item' },
        el('div', { class: 'resultat-titre', text: r.titre }),
        el('div', { class: 'resultat-chemin', text: r.path }),
        ...r.extraits.map((e) => el('div', { class: 'resultat-extrait', text: e.extrait }))
      );
      item.addEventListener('click', () => ouvrirNote(r.path));
      conteneur.append(item);
    }
  } catch (err) {
    conteneur.innerHTML = '';
    conteneur.append(el('p', { class: 'vide', text: err.message }));
  }
}

/* ═══════════════════════════ MODE & WORKSPACE ═══════════════════════════ */

function definirMode(mode, { persister = true } = {}) {
  etat.mode = mode || 'complet';
  $$('.mode-btn').forEach((b) => b.classList.toggle('actif', b.dataset.mode === etat.mode));
  majAccueil();
  if (persister) enregistrerConfig({ mode: etat.mode });
  majContexte();
}

function majAccueil() {
  const a = ACCUEILS[etat.mode] || ACCUEILS.complet;
  const titre = $('#accueilTitre');
  if (titre) titre.textContent = a.titre;
  const texte = $('#accueilTexte');
  if (texte) texte.textContent = a.texte;
  // Le logo est une image fixe : on n'écrase plus son contenu.
  // On ne touche qu'à l'attribut d'accessibilité si le mode change le sens.
  const logo = $('#accueilLogo');
  if (logo && a.logoAlt) {
    const img = logo.querySelector('img');
    if (img) img.alt = a.logoAlt;
  }

  // affiche seulement les suggestions pertinentes pour le mode courant
  $$('.suggestion').forEach((b) => {
    const m = b.dataset.mode;
    b.style.display = (!m || m === etat.mode || etat.mode === 'complet') ? '' : 'none';
  });
}

async function choisirWorkspace() {
  const res = await API.workspace.choisir();
  if (!res) return;
  etat.config = await API.config.obtenir();
  await rafraichirWorkspace();
  notifier(`Espace de travail : ${res.name}`, 'succes');
}

async function definirWorkspaceManuel() {
  const champ = $('#cheminWorkspaceManuel');
  const chemin = champ?.value.trim();
  if (!chemin) return;
  try {
    await API.workspace.definir(chemin);
    if (champ) champ.value = '';
    etat.config = await API.config.obtenir();
    await rafraichirWorkspace();
    notifier('Espace de travail défini.', 'succes');
  } catch (err) {
    notifier(err.message, 'erreur');
  }
}

async function rafraichirWorkspace() {
  let infos;
  try {
    infos = await API.workspace.infos();
  } catch {
    infos = { actif: false };
  }
  etat.workspace = infos.actif ? infos.chemin : null;

  // pied de la barre latérale
  const nomPied = $('#wsPiedNom');
  if (nomPied) {
    nomPied.textContent = infos.actif ? infos.nom : 'Aucun projet';
    nomPied.title = infos.actif ? infos.chemin : "Choisir un espace de travail";
  }

  // volet Travail
  const zone = $('#wsInfos');
  if (zone) {
    zone.innerHTML = '';
    if (!infos.actif) {
      zone.append(el('p', { class: 'vide', text: 'Aucun dossier ouvert. Choisissez un projet pour activer le mode Code.' }));
    } else {
      zone.append(
        el('div', { class: 'ws-nom' }, el('span', { text: infos.nom })),
        el('div', { class: 'ws-chemin', text: infos.chemin }),
        el('div', { class: 'ws-meta' },
          infos.git ? el('span', { class: 'ws-badge', text: `git: ${infos.git}` }) : null,
          el('span', { class: 'ws-badge', text: `${infos.entrees} entrée(s)` })
        )
      );
    }
  }

  // réglages : dossier actuel
  const zone2 = $('#wsActuel');
  if (zone2) {
    zone2.innerHTML = '';
    if (!infos.actif) {
      zone2.append(el('p', { class: 'vide', text: 'Aucun espace de travail défini.' }));
    } else {
      zone2.append(
        el('div', { class: 'ws-nom' }, el('span', { text: infos.nom })),
        el('div', { class: 'ws-chemin', text: infos.chemin })
      );
    }
  }
  const oublierWs = $('#btnOublierWorkspace');
  if (oublierWs) oublierWs.hidden = !infos.actif;

  // réglages : dossiers récents
  const recents = etat.config?.workspacesRecents || [];
  const zone3 = $('#wsRecents');
  if (zone3) {
    zone3.innerHTML = '';
    if (!recents.length) {
      zone3.append(el('p', { class: 'vide', text: 'Aucun dossier récent.' }));
    } else {
      for (const w of recents) {
        const item = el('div', { class: 'ws-recent' },
          el('div', { class: 'ws-recent-infos' },
            el('div', { class: 'ws-recent-nom', text: w.name }),
            el('div', { class: 'ws-recent-chemin', text: w.path })
          )
        );
        item.addEventListener('click', async () => {
          try {
            await API.workspace.definir(w.path);
            etat.config = await API.config.obtenir();
            await rafraichirWorkspace();
            notifier(`Espace de travail : ${w.name}`, 'succes');
          } catch (err) {
            notifier(err.message, 'erreur');
          }
        });
        zone3.append(item);
      }
    }
  }

  majContexte();

  // met à jour l'état git si un dépôt est ouvert
  if (window.cerveauGithub?.rafraichirGit) {
    try { await window.cerveauGithub.rafraichirGit(); } catch { /* pas un dépôt */ }
  }
}

function majContexte() {
  const parties = [];
  const coffre = etat.config?.vaults?.find((v) => v.id === etat.config.activeVaultId);
  if (coffre) parties.push(`Coffre : ${coffre.name}`);
  if (etat.workspace) parties.push(`Projet : ${etat.workspace.split('/').pop()}`);
  const info = $('#infoContexte');
  if (info) {
    info.textContent = parties.length ? parties.join(' · ') : "Ajoute une clé d'API dans les réglages";
  }
}

/* --------------------------- plan de tâches --------------------------- */

function rendrePlan(taches) {
  etat.plan = Array.isArray(taches) ? taches : [];
  const conteneur = $('#planTaches');
  if (!conteneur) return;

  conteneur.innerHTML = '';
  if (!etat.plan.length) {
    conteneur.append(el('p', { class: 'vide', text: 'Aucune tâche en cours.' }));
    return;
  }

  for (const t of etat.plan) {
    conteneur.append(el('div', { class: `tache-item ${t.statut}` },
      el('div', { class: 'tache-puce', text: t.statut === 'termine' ? '✓' : '' }),
      el('div', { class: 'tache-titre', text: t.titre })
    ));
  }
}

/* ═════════════════════ TÂCHES EN ARRIÈRE-PLAN ═════════════════════ */

let tachesFond = [];

const LIBELLES_TACHE_FOND = {
  en_cours: 'en cours',
  termine: 'terminé',
  echec: 'échec',
  arrete: 'arrêté'
};

async function rafraichirTachesFond() {
  try {
    const r = await API.taches.lister();
    tachesFond = r.taches || [];
  } catch {
    tachesFond = [];
  }
  rendreTachesFond();
}

function rendreTachesFond() {
  const zone = $('#tachesFond');
  if (!zone) return;
  zone.innerHTML = '';

  if (!tachesFond.length) {
    zone.append(el('p', { class: 'vide petit', text: 'Aucun processus lancé.' }));
    return;
  }

  for (const t of tachesFond) {
    const actions = el('div', { class: 'tache-fond-actions' },
      el('button', {
        class: 'btn-mini', text: 'Sortie', title: 'Voir la sortie du processus',
        onclick: () => ouvrirSortieTache(t.id)
      }),
      t.statut === 'en_cours'
        ? el('button', {
            class: 'btn-mini danger', text: 'Arrêter', title: 'Arrêter le processus et ses enfants',
            onclick: async () => {
              await API.taches.arreter(t.id);
              await rafraichirTachesFond();
            }
          })
        : null
    );

    zone.append(el('div', { class: `tache-fond ${t.statut}` },
      el('span', { class: 'tache-fond-etat', text: LIBELLES_TACHE_FOND[t.statut] || t.statut }),
      el('div', { class: 'tache-fond-corps' },
        el('div', { class: 'tache-fond-nom', text: t.nom }),
        el('div', { class: 'tache-fond-cmd', text: t.commande, title: t.commande })
      ),
      actions
    ));
  }
}

async function ouvrirSortieTache(id) {
  try {
    const r = await API.taches.sortie(id, 0);
    $('#titreSortieTache').textContent = `Sortie · ${r.nom || r.id}`;
    const contenu = $('#sortieTacheContenu');
    contenu.textContent = (r.tronquee ? '… (début tronqué)\n' : '') + (r.sortie || '(aucune sortie)');
    contenu.scrollTop = contenu.scrollHeight;
    $('#modaleSortieTache').hidden = false;
  } catch (err) {
    notifier(`Sortie indisponible : ${err.message}`, 'erreur', 4000);
  }
}

/* ═══════════════════════════ PALETTE DE COMMANDES ═══════════════════════════ */

const COMMANDES = [
  { id: 'nouvelle', titre: 'Nouvelle conversation', raccourci: 'Ctrl+N', action: () => nouvelleConversation() },
  { id: 'reglages', titre: 'Ouvrir les réglages', raccourci: 'Ctrl+,', action: () => ouvrirReglages() },
  { id: 'fournisseurs', titre: 'Configurer les fournisseurs IA', action: () => ouvrirReglages('fournisseurs') },
  { id: 'workspace', titre: "Changer d'espace de travail", action: () => choisirWorkspace() },
  { id: 'coffres', titre: 'Gérer les coffres Obsidian', action: () => ouvrirReglages('coffres') },
  { id: 'permissions', titre: 'Régler les permissions', action: () => ouvrirReglages('permissions') },
  { id: 'theme', titre: 'Changer de thème', action: async () => {
      const ordre = ['sombre', 'clair'];
      const noms = { sombre: 'Sombre', clair: 'Clair' };
      const actuel = etat.config.ui?.theme || 'sombre';
      const suivant = ordre[(ordre.indexOf(actuel) + 1) % ordre.length];
      await enregistrerConfig({ ui: { theme: suivant } });
      appliquerTheme(suivant);
      notifier(`Thème : ${noms[suivant]}`, 'succes', 1600);
    } },
  { id: 'mode-notes', titre: 'Mode Notes (Obsidian)', action: () => definirMode('notes') },
  { id: 'mode-code', titre: 'Mode Code (terminal, fichiers)', action: () => definirMode('code') },
  { id: 'mode-complet', titre: 'Mode Complet', action: () => definirMode('complet') },
  { id: 'sidebar', titre: 'Basculer la barre latérale', raccourci: 'Ctrl+B', action: () => basculerSidebar() },
  { id: 'panneau', titre: 'Basculer le panneau latéral', raccourci: 'Ctrl+Maj+B', action: () => basculerPanneauObsidian() },
  { id: 'github', titre: 'Ouvrir le panneau GitHub', action: () => actifOngletPanneau('depot') },
  { id: 'travail', titre: 'Ouvrir le panneau Travail', action: () => actifOngletPanneau('travail') },
  { id: 'nouvelle-note', titre: 'Créer une note Obsidian', action: () => creerNoteRapide() },
  { id: 'journal', titre: 'Créer le journal du jour', action: async () => {
      try {
        const n = await API.obs.journal({});
        notifier(`Journal du jour : ${n.path}`, 'succes', 3000);
        await rafraichirCoffre();
        await ouvrirNote(n.path);
      } catch (err) { notifier(err.message, 'erreur'); }
    } },
  { id: 'exporter', titre: 'Exporter la conversation', action: () => exporterConversation() },
  { id: 'regenerer', titre: 'Régénérer la dernière réponse', action: () => regenerer() },
  { id: 'arreter', titre: 'Arrêter la génération', action: () => API.agent.arreter() },
  { id: 'dossiers', titre: 'Explorer les fichiers du projet', action: () => actifOngletPanneau('travail') }
];

let paletteIndex = 0;
let paletteResultats = [];
// vrai quand la dernière sélection vient des flèches : le survol ne doit
// alors plus la déplacer tant que la souris n'a pas bougé volontairement.
let paletteSelectionClavier = false;

/** Normalise pour une recherche insensible à la casse ET aux accents. */
function normaliserRecherche(texte) {
  return String(texte || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function ouvrirPalette() {
  const modale = $('#modalePalette');
  if (!modale) return;
  modale.hidden = false;
  const champ = $('#paletteRecherche');
  champ.value = '';
  champ.focus();
  filtrerPalette('');
}

function fermerPalette() {
  const modale = $('#modalePalette');
  if (modale) modale.hidden = true;
}

async function filtrerPalette(requete) {
  const q = normaliserRecherche(String(requete || '').trim());
  const conteneur = $('#paletteResultats');
  if (!conteneur) return;
  conteneur.innerHTML = '';
  paletteResultats = [];
  paletteIndex = 0;
  paletteSelectionClavier = false;

  // 1. commandes
  const cmds = COMMANDES.filter((c) => !q || normaliserRecherche(c.titre).includes(q));

  // 2. notes du coffre
  let notes = [];
  if (etat.config?.activeVaultId) {
    try {
      const toutes = await API.obs.lister();
      notes = toutes
        .filter((n) => !q || normaliserRecherche(n.path).includes(q))
        .slice(0, q ? 12 : 5);
    } catch { /* pas de coffre */ }
  }

  const ajouterEntete = (texte) => {
    conteneur.append(el('div', { class: 'palette-section', text: texte }));
  };

  if (cmds.length) {
    ajouterEntete('Commandes');
    for (const c of cmds) {
      const item = el('div', { class: 'palette-item' },
        el('span', { class: 'palette-item-titre', text: c.titre }),
        c.raccourci ? el('kbd', { text: c.raccourci }) : null
      );
      const index = paletteResultats.length;
      item.addEventListener('click', () => executerPalette());
      item.addEventListener('mousemove', () => {
        // seul un vrai déplacement de souris reprend la sélection
        if (paletteSelectionClavier || paletteIndex !== index) {
          paletteSelectionClavier = false;
          surlignerPalette(index);
        }
      });
      paletteResultats.push({ type: 'commande', item, executer: c.action, titre: c.titre });
      conteneur.append(item);
    }
  }

  if (notes.length) {
    ajouterEntete('Notes');
    for (const n of notes) {
      const item = el('div', { class: 'palette-item' },
        el('span', { class: 'palette-item-titre', text: n.name.replace(/\.md$/, '') }),
        el('span', { class: 'palette-item-chemin', text: n.path })
      );
      const executer = async () => { fermerPalette(); await ouvrirNote(n.path); };
      const index = paletteResultats.length;
      item.addEventListener('click', executer);
      item.addEventListener('mousemove', () => {
        if (paletteSelectionClavier || paletteIndex !== index) {
          paletteSelectionClavier = false;
          surlignerPalette(index);
        }
      });
      paletteResultats.push({ type: 'note', item, executer, titre: n.path });
      conteneur.append(item);
    }
  }

  if (!paletteResultats.length) {
    conteneur.append(el('p', { class: 'vide', text: 'Aucun résultat.' }));
  }
  surlignerPalette(0);
}

function surlignerPalette(index) {
  if (!paletteResultats.length) {
    paletteIndex = 0;
    return;
  }
  // bornage circulaire : la flèche bas sur le dernier élément revient au début
  const max = paletteResultats.length - 1;
  let cible = Number.isFinite(index) ? index : 0;
  if (cible < 0) cible = max;
  if (cible > max) cible = 0;

  paletteResultats.forEach((r, i) => r.item.classList.toggle('actif', i === cible));
  paletteIndex = cible;
  const actif = paletteResultats[cible]?.item;
  if (actif) actif.scrollIntoView({ block: 'nearest' });
}

function executerPalette() {
  const r = paletteResultats[paletteIndex];
  if (!r) return;
  fermerPalette();
  try {
    const res = r.executer();
    if (res && typeof res.catch === 'function') res.catch((err) => notifier(String(err.message || err), 'erreur'));
  } catch (err) {
    notifier(String(err.message || err), 'erreur');
  }
}

/* ═══════════════════════════ RÉGÉNÉRATION ═══════════════════════════ */

async function regenerer() {
  const conv = etat.conversationCourante;
  if (!conv || !conv.messages.length || etat.enCours) return;

  // retire la dernière réponse de l'assistant
  while (conv.messages.length && conv.messages[conv.messages.length - 1].role === 'assistant') {
    conv.messages.pop();
  }
  const dernier = conv.messages[conv.messages.length - 1];
  if (!dernier || dernier.role !== 'user') {
    return notifier('Rien à régénérer.', 'info', 2000);
  }

  // remet le message utilisateur dans la zone de saisie et relance
  const texte = dernier.contenu;
  conv.messages.pop();
  afficherConversation();
  $('#saisie').value = texte;
  ajusterHauteurSaisie();
  await envoyerMessage();
}

/* ═══════════════════════════ ÉVÉNEMENTS UI ═══════════════════════════ */

function brancherEvenements() {
  // processus en arrière-plan : l'état est poussé par le processus principal
  API.taches?.surEvenement?.(() => rafraichirTachesFond());
  rafraichirTachesFond();

  // employé de la conversation
  $('#employeActif')?.addEventListener('click', (e) => {
    e.stopPropagation();
    rendreMenuEmployes();
  });
  document.addEventListener('click', (e) => {
    const menu = $('#menuEmployes');
    if (!menu || menu.hidden) return;
    if (!menu.contains(e.target) && e.target.id !== 'employeActif') menu.hidden = true;
  });
  $('#btnDupliquer')?.addEventListener('click', dupliquerConversation);

  // recherche dans la conversation
  $('#statsConversation')?.addEventListener('click', ouvrirStatistiques);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && String(e.key).toLowerCase() === 'f') {
      e.preventDefault();
      ouvrirRechercheGlobale();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && String(e.key).toLowerCase() === 'f') {
      e.preventDefault();
      ouvrirRechercheConversation();
    }
  });
  $('#champRechercheConversation')?.addEventListener('input', () => lancerRechercheConversation(true));
  $('#champRechercheConversation')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      chercherSuivant(e.shiftKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      fermerRechercheConversation();
    }
  });
  $('#btnRecherchePrec')?.addEventListener('click', () => chercherSuivant(true));
  $('#btnRechercheSuiv')?.addEventListener('click', () => chercherSuivant(false));
  $('#btnFermerRecherche')?.addEventListener('click', fermerRechercheConversation);

  // recherche globale dans les messages
  $('#btnRechercheGlobale')?.addEventListener('click', ouvrirRechercheGlobale);
  $('#btnFermerRechercheGlobale')?.addEventListener('click', fermerRechercheGlobale);
  $('#modaleRechercheGlobale .modale-fond')?.addEventListener('click', fermerRechercheGlobale);
  $('#champRechercheGlobale')?.addEventListener('input', () => {
    clearTimeout(minuteurRechercheGlobale);
    minuteurRechercheGlobale = setTimeout(lancerRechercheGlobale, 160);
  });
  $('#champRechercheGlobale')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#resultatsRechercheGlobale .resultat-global')?.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      fermerRechercheGlobale();
    }
  });
  API.app.surResultatRecherche?.((r) => {
    const compte = $('#compteRecherche');
    if (!compte) return;
    compte.textContent = r.matches ? `${r.actif}/${r.matches}` : '0';
  });

  // statistiques
  for (const id of ['btnFermerStatistiques', 'btnFermerStatistiques2']) {
    $('#' + id)?.addEventListener('click', () => { $('#modaleStatistiques').hidden = true; });
  }
  $('#modaleStatistiques .modale-fond')?.addEventListener('click', () => {
    $('#modaleStatistiques').hidden = true;
  });
  $('#btnFermerImage')?.addEventListener('click', fermerImage);
  $('#modaleImage .modale-fond')?.addEventListener('click', fermerImage);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modaleImage')?.hidden) fermerImage();
  });

  $('#btnCopierStatistiques')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(statistiquesTexte);
    notifier('Statistiques copiées.', 'succes', 1800);
  });

  // saisie
  const saisie = $('#saisie');
  saisie.addEventListener('input', () => {
    ajusterHauteurSaisie();
    sauverBrouillon();
  });
  saisie.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      envoyerMessage();
    }
  });

  $('#btnEnvoyer').addEventListener('click', envoyerMessage);
  $('#btnViderFile')?.addEventListener('click', () => {
    const n = fileAttente.length;
    viderFileAttente();
    notifier(`${n} message(s) retiré(s) de la file.`, 'info', 2400);
  });
  $('#btnArreter').addEventListener('click', async () => {
    await API.agent.arreter();
    notifier('Génération interrompue.', 'info', 2000);
  });

  // suggestions
  $$('.suggestion').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.dataset.mode && b.dataset.mode !== etat.mode) definirMode(b.dataset.mode);
      $('#saisie').value = b.dataset.prompt;
      ajusterHauteurSaisie();
      envoyerMessage();
    });
  });

  // sélecteur de mode
  $$('.mode-btn').forEach((b) => {
    b.addEventListener('click', () => definirMode(b.dataset.mode));
  });

  // espace de travail
  $('#btnChoisirWorkspace')?.addEventListener('click', choisirWorkspace);
  $('#btnChoisirWorkspace2')?.addEventListener('click', choisirWorkspace);
  $('#btnWorkspaceRapide')?.addEventListener('click', () => ouvrirReglages('workspace'));
  $('#btnDefinirWorkspace')?.addEventListener('click', definirWorkspaceManuel);
  $('#btnOublierWorkspace')?.addEventListener('click', async () => {
    await API.workspace.oublier();
    etat.config = await API.config.obtenir();
    await rafraichirWorkspace();
    notifier('Espace de travail retiré.', 'info', 2500);
  });
  $('#cheminWorkspaceManuel')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') definirWorkspaceManuel();
  });

  // sidebar
  $('#btnNouvelleConv').addEventListener('click', () => nouvelleConversation());
  $('#btnBasculerSidebar').addEventListener('click', basculerSidebar);
  $('#btnBasculerObsidian').addEventListener('click', basculerPanneauObsidian);
  $('#btnFermerPanneau').addEventListener('click', basculerPanneauObsidian);

  $('#rechercheConv').addEventListener('input', afficherConversations);

  $$('.onglet').forEach((o) => {
    o.addEventListener('click', () => {
      $$('.onglet').forEach((x) => x.classList.remove('actif'));
      o.classList.add('actif');
      $$('.volet').forEach((v) => v.classList.remove('actif'));
      $(`#volet-${o.dataset.onglet}`).classList.add('actif');
    });
  });

  // coffre
  $('#btnNouvelleNote').addEventListener('click', creerNoteRapide);
  $('#btnNouveauDossier').addEventListener('click', creerDossierRapide);
  $('#btnOuvrirObsidian').addEventListener('click', () => {
    if (!etat.config.activeVaultId) return notifier('Aucun coffre ouvert.', 'erreur');
    API.coffre.ouvrirDansObsidian(etat.noteCourante || null);
  });
  $('#rechercheNotes').addEventListener('input', (e) => {
    const q = e.target.value;
    if (q.trim().length >= 2) {
      actifOngletPanneau('recherche');
      $('#recherchePanneau').value = q;
      lancerRecherche(q);
    }
  });

  // panneau
  $$('.onglet-panneau').forEach((o) => {
    o.addEventListener('click', () => actifOngletPanneau(o.dataset.panneau));
  });

  $('#btnNoteEditer').addEventListener('click', () => basculerEditionNote(true));
  $('#btnNoteEnregistrer').addEventListener('click', enregistrerNote);
  $('#btnNoteObsidian').addEventListener('click', () => {
    if (etat.noteCourante) API.coffre.ouvrirDansObsidian(etat.noteCourante);
  });

  $('#noteEditeur').addEventListener('keydown', (e) => {
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      enregistrerNote();
    }
    if (e.key === 'Escape') basculerEditionNote(false);
  });

  let timerPan = null;
  $('#recherchePanneau').addEventListener('input', (e) => {
    clearTimeout(timerPan);
    timerPan = setTimeout(() => lancerRecherche(e.target.value), 280);
  });

  // réglages
  $('#btnReglages').addEventListener('click', () => ouvrirReglages());
  $('#btnFermerReglages').addEventListener('click', fermerReglages);
  $('#btnFermerReglages2').addEventListener('click', fermerReglages);
  $('#modaleReglages .modale-fond').addEventListener('click', fermerReglages);

  $$('.nav-reglage').forEach((o) => {
    o.addEventListener('click', () => afficherSectionReglage(o.dataset.reglage));
  });

  $('#fournisseurDefaut').addEventListener('change', async (e) => {
    await enregistrerConfig({ activeProvider: e.target.value });
    rafraichirModeles();
    majStatutFournisseur();
    rendreCartesFournisseurs();
    window.cerveauModele?.rendre?.();
  });

  $('#listeFournisseurs').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.provider) {
      sauverFournisseur(e.target.dataset.provider);
    }
  });

  $('#modePermissions').addEventListener('change', async (e) => {
    await enregistrerConfig({ permissions: { mode: e.target.value } });
    notifier('Comportement des permissions mis à jour.', 'succes', 2200);
  });

  $('#autoriserSuppression').addEventListener('change', async (e) => {
    await enregistrerConfig({ permissions: { allowDelete: e.target.checked } });
  });

  $('#autoCommandes').addEventListener('change', async (e) => {
    await enregistrerConfig({ permissions: { autoCommandes: e.target.checked } });
    notifier(e.target.checked
      ? 'Les commandes seront exécutées sans confirmation en mode automatique.'
      : 'Chaque commande demandera une confirmation.', 'info', 3000);
  });

  $('#autoPush')?.addEventListener('change', async (e) => {
    await enregistrerConfig({ permissions: { autoPush: e.target.checked } });
    notifier(e.target.checked
      ? 'Les push GitHub seront autorisés sans confirmation.'
      : 'Chaque push demandera une confirmation.', 'info', 3000);
  });

  $('#autoGithub')?.addEventListener('change', async (e) => {
    await enregistrerConfig({ permissions: { autoGithub: e.target.checked } });
    notifier(e.target.checked
      ? 'La création de PR et d\'issues sera autorisée sans confirmation.'
      : 'Chaque action GitHub demandera une confirmation.', 'info', 3000);
  });

  $('#choixTheme').addEventListener('change', async (e) => {
    await enregistrerConfig({ ui: { theme: e.target.value } });
  });

  $('#reglageEffets')?.addEventListener('change', async (e) => {
    appliquerEffets(e.target.checked);
    await enregistrerConfig({ ui: { effets: e.target.checked } });
  });

  $('#echellePolice').addEventListener('input', (e) => {
    const v = Number(e.target.value) / 100;
    $('#valeurEchelle').textContent = `${e.target.value} %`;
    appliquerEchelle(v);
  });
  $('#echellePolice').addEventListener('change', async (e) => {
    await enregistrerConfig({ ui: { fontScale: Number(e.target.value) / 100 } });
  });

  $('#btnAjouterCoffre').addEventListener('click', ajouterCoffre);
  $('#btnAjouterChemin').addEventListener('click', ajouterCoffreParChemin);
  $('#cheminCoffreManuel').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ajouterCoffreParChemin();
  });

  $('#btnDossierConfig').addEventListener('click', () => API.app.ouvrirDossierConfig());
  $('#btnReinitialiser').addEventListener('click', async () => {
    if (!confirm('Réinitialiser tous les réglages ? Les clés d\'API et la liste des coffres seront effacées.')) return;
    etat.config = await API.config.reinitialiser();
    etat.conversations = [];
    notifier('Réglages réinitialisés.', 'succes');
    fermerReglages();
    await rafraichirFournisseurs();
    await rafraichirCoffre();
  });

  // confirmation d'outil
  $('#btnAutoriserAction').addEventListener('click', () => repondreConfirmation(true));
  $('#btnRefuserAction').addEventListener('click', () => repondreConfirmation(false));
  $('#modaleConfirmation .modale-fond').addEventListener('click', () => repondreConfirmation(false));

  // sortie d'un processus de fond
  $('#btnFermerSortieTache')?.addEventListener('click', () => { $('#modaleSortieTache').hidden = true; });
  $('#btnFermerSortieTache2')?.addEventListener('click', () => { $('#modaleSortieTache').hidden = true; });
  $('#modaleSortieTache .modale-fond')?.addEventListener('click', () => { $('#modaleSortieTache').hidden = true; });

  // export
  $('#btnExporter').addEventListener('click', exporterConversation);
  $('#btnPalette')?.addEventListener('click', ouvrirPalette);

  // insertion de note
  $('#btnInsererNote')?.addEventListener('click', ouvrirModaleNotes);
  $('#btnFermerNotes').addEventListener('click', () => { $('#modaleNotes').hidden = true; });
  $('#modaleNotes .modale-fond').addEventListener('click', () => { $('#modaleNotes').hidden = true; });
  $('#rechercheNoteInsert').addEventListener('input', (e) => filtrerNotesInsert(e.target.value));

  // palette de commandes
  $('#modalePalette .modale-fond')?.addEventListener('click', fermerPalette);
  $('#paletteRecherche')?.addEventListener('input', (e) => filtrerPalette(e.target.value));
  $('#paletteRecherche')?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      paletteSelectionClavier = true;
      surlignerPalette(paletteIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      paletteSelectionClavier = true;
      surlignerPalette(paletteIndex - 1);
    }
    else if (e.key === 'Enter') { e.preventDefault(); executerPalette(); }
    else if (e.key === 'Escape') { e.preventDefault(); fermerPalette(); }
  });

  // raccourcis globaux
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('#modalePalette').hidden ? ouvrirPalette() : fermerPalette();
      return;
    }
    if (e.key === 'Escape') {
      if (!$('#modalePalette').hidden) fermerPalette();
      else if (!$('#modaleConfirmation').hidden) repondreConfirmation(false);
      else if (!$('#modaleNotes').hidden) $('#modaleNotes').hidden = true;
      else if (!$('#modaleReglages').hidden) fermerReglages();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); nouvelleConversation(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'b' && !e.shiftKey) { e.preventDefault(); basculerSidebar(); }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); basculerPanneauObsidian(); }
    if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); ouvrirReglages(); }
  });
}

function ajusterHauteurSaisie() {
  const s = $('#saisie');
  s.style.height = 'auto';
  s.style.height = `${Math.min(s.scrollHeight, 220)}px`;

  // Le bouton Envoyer reste inactif tant qu'il n'y a rien à envoyer :
  // cliquer dessus ne doit produire ni message vide ni erreur silencieuse.
  const btn = $('#btnEnvoyer');
  if (btn && !etat.enCours) {
    const aDuTexte = s.value.trim().length > 0;
    const aDesPieces = Array.isArray(piecesJointes) && piecesJointes.length > 0;
    btn.disabled = !(aDuTexte || aDesPieces);
  }
}

function basculerSidebar() {
  const sb = $('#sidebar');
  sb.classList.toggle('repliee');
  enregistrerConfig({ ui: { sidebarOpen: !sb.classList.contains('repliee') } });
  synchroniserHauteurEntete();
}

function basculerPanneauObsidian() {
  const p = $('#panneauObsidian');
  p.classList.toggle('replie');
  {
    const ouvert = !p.classList.contains('replie');
    enregistrerConfig({ ui: { obsidianPanelOpen: ouvert }, general: { panneauOuvert: ouvert } });
  }
  synchroniserHauteurEntete();
}

function actifOngletPanneau(nom) {
  $$('.onglet-panneau').forEach((x) => x.classList.toggle('actif', x.dataset.panneau === nom));
  $$('.volet-panneau').forEach((v) => v.classList.toggle('actif', v.id === `panneau-${nom}`));
  if (nom === 'travail') rafraichirTachesFond();
  if ($('#panneauObsidian').classList.contains('replie')) basculerPanneauObsidian();
}

function traiterActionMenu(action) {
  switch (action) {
    case 'nouvelle-conversation': nouvelleConversation(); break;
    case 'reglages': ouvrirReglages(); break;
    case 'basculer-sidebar': basculerSidebar(); break;
    case 'basculer-obsidian': basculerPanneauObsidian(); break;
    case 'raccourcis':
      notifier('Ctrl+N : nouvelle discussion · Ctrl+B : barre latérale · Ctrl+Maj+B : panneau Obsidian · Ctrl+, : réglages · Ctrl+Entrée : envoyer depuis l\'éditeur de note', 'info', 9000);
      break;
    default: break;
  }
}

/* ------------------------- édition de note ---------------------------- */

function basculerEditionNote(actif) {
  if (!etat.noteCourante && actif) return notifier('Aucune note ouverte.', 'erreur');
  etat.modeEditionNote = actif;
  $('#noteRendu').hidden = actif;
  $('#noteEditeur').hidden = !actif;
  $('#btnNoteEditer').hidden = actif;
  $('#btnNoteEnregistrer').hidden = !actif;
  if (actif) {
    $('#noteEditeur').focus();
  } else {
    const zone = $('#noteRendu');
    zone.innerHTML = renduMarkdown.rendre($('#noteEditeur').value);
    renduMarkdown.embellir(zone);
  }
}

async function enregistrerNote() {
  if (!etat.noteCourante) return;
  try {
    const contenu = $('#noteEditeur').value;
    await API.obs.ecrire(etat.noteCourante, contenu);
    notifier('Note enregistrée.', 'succes', 2000);
    basculerEditionNote(false);
    await rafraichirCoffre();
  } catch (err) {
    notifier(err.message, 'erreur');
  }
}

async function creerNoteRapide() {
  if (!etat.config.activeVaultId) {
    notifier('Ouvre d\'abord un coffre dans les réglages.', 'erreur');
    return;
  }
  const nom = await demanderTexte({ titre: 'Nouvelle note', valeur: 'Nouvelle note' });
  if (!nom) return;
  try {
    const r = await API.obs.ecrire(nom, `# ${nom}\n\n`);
    notifier(`Note créée : ${r.path}`, 'succes');
    await rafraichirCoffre();
    await ouvrirNote(r.path);
    basculerEditionNote(true);
  } catch (err) {
    notifier(err.message, 'erreur');
  }
}

async function creerDossierRapide() {
  if (!etat.config.activeVaultId) {
    notifier('Ouvre d\'abord un coffre dans les réglages.', 'erreur');
    return;
  }
  const nom = await demanderTexte({ titre: 'Nouveau dossier', valeur: 'Nouveau dossier' });
  if (!nom) return;
  try {
    await API.obs.creerDossier(nom);
    notifier(`Dossier créé : ${nom}`, 'succes');
    await rafraichirCoffre();
  } catch (err) {
    notifier(err.message, 'erreur');
  }
}

/* --------------------------- insertion de note ------------------------ */

async function ouvrirModaleNotes() {
  if (!etat.config.activeVaultId) return notifier('Aucun coffre ouvert.', 'erreur');
  $('#modaleNotes').hidden = false;
  $('#rechercheNoteInsert').value = '';
  await filtrerNotesInsert('');
}

async function filtrerNotesInsert(filtre) {
  const conteneur = $('#listeNotesInsert');
  conteneur.innerHTML = '';
  try {
    const notes = await API.obs.lister();
    const f = filtre.toLowerCase();
    const liste = notes.filter((n) => !f || n.path.toLowerCase().includes(f)).slice(0, 300);
    if (!liste.length) {
      conteneur.append(el('p', { class: 'vide', text: 'Aucune note.' }));
      return;
    }
    for (const n of liste) {
      const item = el('div', { class: 'note-insert' },
        el('span', { text: n.name.replace(/\.md$/, '') }),
        el('span', { class: 'chemin', text: n.path })
      );
      item.addEventListener('click', () => {
        insérerNoteDansMessage(n.path);
        $('#modaleNotes').hidden = true;
      });
      conteneur.append(item);
    }
  } catch (err) {
    conteneur.append(el('p', { class: 'vide', text: err.message }));
  }
}

async function insérerNoteDansMessage(chemin) {
  try {
    const note = await API.obs.lire(chemin);
    const saisie = $('#saisie');
    const bloc = `\n\n<note chemin="${note.path}">\n${note.content}\n</note>\n\n`;
    saisie.value += bloc;
    ajusterHauteurSaisie();
    saisie.focus();
    notifier(`Note « ${note.path} » insérée dans le message.`, 'succes', 2400);
  } catch (err) {
    notifier(err.message, 'erreur');
  }
}

/* ----------------------------- export ------------------------------- */

async function exporterConversation() {
  const conv = etat.conversationCourante;
  if (!conv || !conv.messages.length) return notifier('Conversation vide.', 'info');

  const md = [
    `# ${conv.titre}`,
    '',
    `*Exporté depuis Cerveau le ${new Date().toLocaleString('fr-FR')}*`,
    '',
    ...conv.messages.flatMap((m) => [
      `## ${m.role === 'user' ? 'Vous' : 'Cerveau'}`,
      '',
      m.contenu,
      ''
    ])
  ].join('\n');

  const res = await API.app.exporterConversation({ titre: conv.titre, markdown: md });
  if (res.ok) notifier(`Exporté vers ${res.chemin}`, 'succes', 4000);
}

async function exporterVersCoffre(contenu) {
  if (!etat.config.activeVaultId) return notifier('Aucun coffre ouvert.', 'erreur');

  const nomCoffre = etat.config.vaults?.find((v) => v.id === etat.config.activeVaultId)?.name || 'le coffre';
  const horodatage = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  const defaut = `Depuis Cerveau/${new Date().toISOString().slice(0, 10)} — ${horodatage}`;

  const chemin = await demanderTexte({
    titre: 'Enregistrer dans une note',
    valeur: defaut,
    aide: `Chemin relatif dans « ${nomCoffre} ». Les dossiers manquants sont créés.`,
    valider: (v) => {
      if (!v) return 'Indiquez un chemin.';
      if (/\.\./.test(v)) return 'Le chemin ne doit pas remonter hors du coffre.';
      return true;
    }
  });
  if (!chemin) return;
  try {
    const r = await API.app.exporterVersCoffre({ chemin, markdown: contenu });
    notifier(`Enregistré dans ${r.path}`, 'succes', 3000);
    await rafraichirCoffre();
    await ouvrirNote(r.path);
  } catch (err) {
    notifier(err.message, 'erreur');
  }
}

/* ═══════════════════════ SAISIE DE TEXTE ═══════════════════════ */

/**
 * Remplace `prompt()`, que le processus de rendu d'Electron ne supporte pas :
 * il lève « prompt() is not supported » et renvoie toujours null.
 *
 * @returns {Promise<string|null>} le texte saisi, ou null si annulé
 */
function demanderTexte({ titre = 'Saisie', valeur = '', aide = '', valider = null } = {}) {
  return new Promise((resolve) => {
    const modale = $('#modaleSaisie');
    const champ = $('#champSaisie');
    const erreur = $('#erreurSaisie');
    if (!modale || !champ) { resolve(null); return; }

    $('#titreSaisie').textContent = titre;
    const zoneAide = $('#aideSaisie');
    if (zoneAide) {
      zoneAide.textContent = aide || '';
      zoneAide.hidden = !aide;
    }
    if (erreur) { erreur.hidden = true; erreur.textContent = ''; }

    champ.value = valeur;
    modale.hidden = false;
    setTimeout(() => { champ.focus(); champ.select(); }, 30);

    let termine = false;
    const cloturer = (reponse) => {
      if (termine) return;
      termine = true;
      modale.hidden = true;
      document.removeEventListener('keydown', surTouche, true);
      $('#btnValiderSaisie')?.removeEventListener('click', surValider);
      $('#btnAnnulerSaisie')?.removeEventListener('click', surAnnuler);
      modale.querySelector('.modale-fond')?.removeEventListener('click', surAnnuler);
      resolve(reponse);
    };

    const surValider = () => {
      const texte = champ.value.trim();
      if (valider) {
        const verdict = valider(texte);
        if (verdict !== true) {
          if (erreur) { erreur.textContent = verdict || 'Valeur invalide.'; erreur.hidden = false; }
          champ.focus();
          return;
        }
      }
      cloturer(texte);
    };
    const surAnnuler = () => cloturer(null);

    const surTouche = (ev) => {
      if (modale.hidden) return;
      if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); surValider(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); surAnnuler(); }
    };

    $('#btnValiderSaisie')?.addEventListener('click', surValider);
    $('#btnAnnulerSaisie')?.addEventListener('click', surAnnuler);
    modale.querySelector('.modale-fond')?.addEventListener('click', surAnnuler);
    document.addEventListener('keydown', surTouche, true);
  });
}

/* ------------------------------ réglages ---------------------------- */

function afficherSectionReglage(id) {
  if (!id) return;
  $$('.nav-reglage').forEach((x) => x.classList.toggle('actif', x.dataset.reglage === id));
  $$('.volet-reglage').forEach((v) => v.classList.toggle('actif', v.id === `reglage-${id}`));
  const zone = $('.reglages-contenu');
  if (zone) zone.scrollTop = 0;
}

/** Rappelés à chaque ouverture des réglages : branchent une fois, affichent toujours. */
function initialiserComportement() {
  brancherComportement();
  rendrePresetsComportement();
  const zone = $('#promptSysteme');
  if (zone) zone.value = etat.config.systemPrompt || '';
  majCompteurPrompt();
  const temp = $('#temperature');
  if (temp) {
    const valeur = Number(etat.config.temperature ?? 0.7);
    temp.value = String(valeur);
    const aff = $('#valeurTemperature');
    if (aff) aff.textContent = valeur.toFixed(1);
  }
}

function initialiserReglagesAvances() {
  brancherReglagesAvances();
  rendreCompetences();
  rendrePlugins();
  rendreCataloguePlugins();
  API.app.autostart().then((r) => {
    const case_ = $('#reglageAutostart');
    if (case_) case_.checked = Boolean(r?.actif);
  }).catch(() => { /* API indisponible */ });
}

function initialiserPlugins() {
  brancherPlugins();
  rendreServeursMCP();
  rendreExemplesMCP();
}

function initialiserDispositionPanneau() {
  brancherDispositionPanneau();
  appliquerDispositionPanneau();
}

function ouvrirReglages(onglet = null) {
  $('#modaleReglages').hidden = false;
  afficherSectionReglage(onglet || 'general');
  rendreCartesFournisseurs();
  rendreCoffresReglages();
  rafraichirWorkspace();
  initialiserComportement();
  initialiserReglagesAvances();
  initialiserPlugins();
  initialiserDispositionPanneau();
  initialiserSuperviseur();
  initialiserPlanification();
  initialiserObjectifs();
  initialiserMemoire();

  $('#modePermissions').value = etat.config.permissions?.mode || 'demander';
  $('#autoriserSuppression').checked = Boolean(etat.config.permissions?.allowDelete);
  const autoCmd = $('#autoCommandes');
  if (autoCmd) autoCmd.checked = etat.config.permissions?.autoCommandes !== false;
  const autoPush = $('#autoPush');
  if (autoPush) autoPush.checked = etat.config.permissions?.autoPush === true;
  const autoGh = $('#autoGithub');
  if (autoGh) autoGh.checked = etat.config.permissions?.autoGithub === true;
  $('#choixTheme').value = etat.config.ui?.theme || 'sombre';
  const effetsReglage = $('#reglageEffets');
  if (effetsReglage) effetsReglage.checked = etat.config.ui?.effets !== false;
  const echelle = Math.round((etat.config.ui?.fontScale || 1) * 100);
  $('#echellePolice').value = String(echelle);
  $('#valeurEchelle').textContent = `${echelle} %`;
}

function fermerReglages() {
  $('#modaleReglages').hidden = true;
  $('#retourReglages').textContent = '';
}

function rendreCoffresReglages() {
  const conteneur = $('#listeCoffres');
  conteneur.innerHTML = '';
  const coffres = etat.config.vaults || [];

  if (!coffres.length) {
    conteneur.append(el('p', { class: 'vide', text: 'Aucun coffre enregistré.' }));
    return;
  }

  for (const c of coffres) {
    const actif = c.id === etat.config.activeVaultId;
    const carte = el('div', { class: `carte-coffre${actif ? ' actif' : ''}` },
      el('div', { class: 'carte-coffre-infos' },
        el('div', { class: 'carte-coffre-nom', text: c.name + (actif ? '  ★' : '') }),
        el('div', { class: 'carte-coffre-chemin', text: c.path })
      )
    );
    if (!actif) {
      carte.append(el('button', {
        class: 'btn-mini', text: 'Activer',
        onclick: async () => {
          await API.coffre.activer(c.id);
          etat.config = await API.config.obtenir();
          rendreCoffresReglages();
          await rafraichirCoffre();
          notifier(`Coffre actif : ${c.name}`, 'succes');
        }
      }));
    }
    carte.append(el('button', {
      class: 'btn-mini', text: 'Retirer',
      onclick: async () => {
        if (!confirm(`Retirer le coffre « ${c.name} » de la liste ? Les fichiers ne seront pas supprimés.`)) return;
        await API.coffre.retirer(c.id);
        etat.config = await API.config.obtenir();
        rendreCoffresReglages();
        await rafraichirCoffre();
      }
    }));
    conteneur.append(carte);
  }
}

async function ajouterCoffre() {
  const res = await API.coffre.choisir();
  if (!res) return;
  etat.config = await API.config.obtenir();
  rendreCoffresReglages();
  await rafraichirCoffre();
  notifier(`Coffre « ${res.coffre.name} » ${res.nouveau ? 'ajouté' : 'activé'}.`, 'succes');
}

async function ajouterCoffreParChemin() {
  const chemin = $('#cheminCoffreManuel').value.trim();
  if (!chemin) return;
  try {
    await API.coffre.ajouterChemin(chemin);
    etat.config = await API.config.obtenir();
    $('#cheminCoffreManuel').value = '';
    rendreCoffresReglages();
    await rafraichirCoffre();
    notifier('Coffre ajouté.', 'succes');
  } catch (err) {
    notifier(err.message, 'erreur');
  }
}

/* ------------------------------- démarrage --------------------------- */

/* API partagée avec les modules d'interface complémentaires (github-ui.js) */
window.cerveauUI = {
  el,
  notifier,
  ajouterMessageDOM,
  afficherConversation,
  persisterConversations,
  demanderTexte,
  exporterVersCoffre,
  NOMS_FOURNISSEURS,
  modelesDe,
  enregistrerConfig,
  majStatutFournisseur,
  surConfigChangee: [],
  echapper,
  formaterDate,
  rendreMarkdown: renduMarkdown,
  definirMode,
  majAccueil,
  majContexte,
  rafraichirWorkspace,
  rafraichirCoffre,
  rafraichirFournisseurs,
  rafraichirModeles,
  actifOngletPanneau,
  ouvrirReglages,
  basculerPanneauObsidian,
  definirWorkspaceManuel,
  choisirWorkspace,
  rendrePlan,
  bornHistorique,
  ouvrirNote,
  resoudreChemin,
  ouvrirPalette,
  fermerPalette,
  filtrerPalette,
  executerPalette,
  regenerer,
  COMMANDES,
  etat
};

document.addEventListener('DOMContentLoaded', demarrer);
