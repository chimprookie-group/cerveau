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
  etat.config = await API.config.obtenir();
  etat.conversations = etat.config.conversations || [];

  // dossier personnel, pour développer les chemins des exemples MCP
  try {
    etat.dossierPersonnel = (await API.app.infos()).dossierPersonnel || '';
  } catch { /* l'information reste vide, les chemins absolus fonctionneront */ }

  appliquerTheme(etat.config.ui?.theme || 'sombre');
  appliquerEchelle(etat.config.ui?.fontScale || 1);

  if (etat.config.ui?.sidebarOpen === false) $('#sidebar').classList.add('repliee');
  if (etat.config.ui?.obsidianPanelOpen === false) $('#panneauObsidian').classList.add('replie');

  brancherEvenements();
  synchroniserHauteurEntete();
  window.addEventListener('resize', synchroniserHauteurEntete);
  initialiserTerminal();
  initialiserPieces();
  await rafraichirFournisseurs();
  await rafraichirCoffre();
  await rafraichirWorkspace();
  definirMode(etat.config.mode || 'complet');
  afficherConversations();
  nouvelleConversation({ silencieux: true });
  ajusterHauteurSaisie();

  synchroniserHauteurEntete();

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
  document.body.dataset.theme = theme;
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
  // puis les découverts
  for (const m of etat.modelesDecouverts[id] || []) ajouter(m, 'decouvert');
  // puis les intégrés
  for (const m of MODELES[id] || []) ajouter(m.id, 'integre');

  return liste;
}

function rafraichirModeles() {
  // Rendu désormais assuré par src/model-selector.js.
  window.cerveauModele?.rendre?.();
}

function majStatutFournisseur() {
  const id = etat.config.activeProvider;
  const p = etat.config.providers?.[id];
  const statut = $('#statutFournisseur');
  const nom = NOMS_FOURNISSEURS[id] || id;
  const modele = etat.modelesSession[id] || p?.model || 'modèle ?';
  statut.className = 'statut';
  if (p?.hasKey) {
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
  conteneur.innerHTML = '';
  const cfg = etat.config;

  for (const id of Object.keys(NOMS_FOURNISSEURS)) {
    const p = cfg.providers?.[id] || { apiKey: '', baseUrl: '', model: '', hasKey: false };
    const carte = el('div', { class: `carte-fournisseur${id === cfg.activeProvider ? ' actif' : ''}` });

    const entete = el('div', { class: 'carte-entete' },
      el('div', { class: 'carte-titre' },
        NOMS_FOURNISSEURS[id],
        p.hasKey ? el('span', { class: 'badge ok', text: 'clé enregistrée' }) : el('span', { class: 'badge', text: 'non configuré' })
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
        placeholder: p.hasKey ? '•••••••• (laisser vide pour conserver)' : 'sk-…',
        'data-champ': 'apiKey',
        'data-provider': id
      })
    );

    const champUrl = el('label', { class: 'champ' },
      el('span', { text: 'URL de base' }),
      el('input', {
        type: 'text',
        value: p.baseUrl || PLACEHOLDERS[id] || '',
        placeholder: PLACEHOLDERS[id] || '',
        'data-champ': 'baseUrl',
        'data-provider': id
      })
    );

    const champModele = el('label', { class: 'champ pleine' },
      el('span', { text: 'Modèle par défaut' }),
      el('input', {
        type: 'text',
        value: p.model || '',
        placeholder: MODELES[id]?.[0]?.id || 'nom-du-modèle',
        'data-champ': 'model',
        'data-provider': id
      })
    );

    grille.append(champCle, champUrl, champModele);

    // --- gestion des modèles multiples ---
    const zoneModeles = el('div', { class: 'zone-modeles', 'data-zone': id });

    const enteteModeles = el('div', { class: 'zone-modeles-entete' },
      el('span', { class: 'zone-modeles-titre', text: `Modèles disponibles (${modelesDe(id).length + (p.model && !modelesDe(id).some((m) => m.id === p.model) ? 1 : 0)})` }),
      el('div', { class: 'zone-modeles-actions' },
        el('button', {
          class: 'btn-mini',
          text: '⟳ Détecter',
          title: "Interroger le fournisseur pour lister ses modèles",
          onclick: (e) => detecterModeles(id, e.target, zoneModeles)
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
    const btnEnregistrer = el('button', { class: 'btn-secondaire', text: 'Enregistrer', onclick: () => sauverFournisseur(id) });
    const btnTester = el('button', { class: 'btn-mini', text: 'Tester la connexion', onclick: () => testerFournisseur(id, resultat) });
    const resultat = el('span', { class: 'message-test' });
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
    gardes.unshift({ role: m.role, contenu: m.contenu });
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
        ? el('img', { class: 'piece-vignette', src: p.dataUrl, alt: p.nom })
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

/** Compose le message final avec les pièces jointes. */
function composerMessage(texte) {
  if (!piecesJointes.length) return texte;
  const morceaux = [texte];
  for (const p of piecesJointes) {
    if (p.type === 'texte') {
      morceaux.push(`\n\n<fichier nom="${p.nom}" langage="${p.langage}">\n${p.contenu}\n</fichier>`);
    } else {
      morceaux.push(`\n\n[image jointe : ${p.nom}]`);
    }
  }
  return morceaux.join('');
}

function initialiserPieces() {
  const zone = $('#zoneSaisie');
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
    const chemins = [...e.dataTransfer.files].map((f) => f.path).filter(Boolean);
    if (chemins.length) await ajouterFichiers(chemins);
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

/* ═══════════════════════════ SUPERVISEUR ═══════════════════════════ */

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

async function initialiserSuperviseur() {
  const cfg = etat.config.superviseur || {};

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

  const rafraichir = async () => {
    const r = await API.superviseur.etat();
    if (r.ok) majEtatSuperviseur(r);
    else notifier(r.message || 'Superviseur indisponible.', 'erreur', 4000);
  };

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

  $('#supReinit')?.addEventListener('click', async () => {
    if (!confirm("Effacer tout l'historique des tickets ?")) return;
    await API.superviseur.reinitialiser();
    notifier('Historique effacé.', 'info');
    await rafraichir();
  });

  // les événements du superviseur mettent l'interface à jour en direct
  API.superviseur.surEvenement((evt) => {
    if (evt.type === 'ticket:cree') {
      notifier(`Nouveau ticket : ${evt.ticket?.origine?.titre || evt.ticket?.resume || ''}`, 'info', 4000);
    }
    if (evt.type === 'ticket:fin') {
      const t = evt.ticket;
      notifier(`Ticket #${t?.origine?.numero} ${t?.etat === 'termine' ? 'terminé' : 'échoué'}.`,
        t?.etat === 'termine' ? 'succes' : 'erreur', 5000);
    }
    rafraichir();
  });

  await rafraichir();
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

function initialiserDispositionPanneau() {
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

function rendreServeursMCP() {
  const zone = $('#listeServeursMCP');
  if (!zone) return;
  zone.innerHTML = '';
  const serveurs = etat.config.serveursMCP || [];

  if (!serveurs.length) {
    zone.append(el('p', { class: 'vide petit', text: 'Aucun serveur MCP configuré. Utilisez un exemple ci-dessous.' }));
    return;
  }

  serveurs.forEach((srv, index) => {
    const item = el('div', { class: 'mcp-item' },
      el('input', {
        type: 'checkbox',
        class: 'champ-reglage-controle bascule',
        checked: srv.actif !== false ? '' : null,
        onchange: async (e) => {
          const liste = [...(etat.config.serveursMCP || [])];
          liste[index] = { ...liste[index], actif: e.target.checked };
          await enregistrerConfig({ serveursMCP: liste });
          rendreServeursMCP();
        }
      }),
      el('div', { class: 'mcp-infos' },
        el('div', { class: 'mcp-nom', text: srv.nom }),
        el('div', { class: 'mcp-commande', text: `${srv.commande} ${(srv.arguments || []).join(' ')}` })
      ),
      el('button', {
        class: 'btn-modele', text: 'Tester', title: 'Démarrer et lister les outils',
        onclick: async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          b.textContent = '…';
          const r = await API.mcp.tester(srv.nom);
          b.disabled = false;
          b.textContent = 'Tester';
          await rafraichirEtatsMCP();
          if (r.ok && r.outils > 0) {
            notifier(`« ${srv.nom} » : ${r.outils} outil(s) chargé(s).`, 'succes', 4000);
          } else {
            const etatSrv = r.etats?.[srv.nom];
            notifier(`« ${srv.nom} » n'a pas démarré : ${etatSrv?.erreur || 'raison inconnue'}`, 'erreur', 9000);
          }
        }
      }),
      el('button', {
        class: 'btn-modele danger', text: '✕', title: 'Retirer',
        onclick: async () => {
          const liste = (etat.config.serveursMCP || []).filter((_, i) => i !== index);
          await enregistrerConfig({ serveursMCP: liste });
          rendreServeursMCP();
          rendreExemplesMCP();
          notifier(`Serveur « ${srv.nom} » retiré.`, 'info', 2000);
        }
      })
    );
    zone.append(item);
  });
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
          variablesEnv: {},
          actif: true
        }];
        await enregistrerConfig({ serveursMCP: liste });
        rendreServeursMCP();
        rendreExemplesMCP();
        notifier(`Serveur « ${ex.titre} » ajouté. Il démarrera au prochain message.`, 'succes', 4000);
      }
    },
      el('div', { class: 'preset-nom', text: deja ? `${ex.titre} ✓` : ex.titre }),
      el('div', { class: 'preset-desc', text: ex.desc })
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
  const zone = $('#etatsMCP');
  if (!zone) return;
  const r = await API.mcp.etats();
  zone.innerHTML = '';
  const serveurs = etat.config.serveursMCP || [];
  if (!serveurs.length) {
    zone.append(el('p', { class: 'vide petit', text: 'Aucun serveur déclaré.' }));
    return;
  }
  for (const srv of serveurs) {
    const e = r.etats?.[srv.nom];
    const ok = e?.ok;
    zone.append(el('div', { class: 'mcp-etat' },
      el('span', { class: 'menu-item-pastille ' + (ok ? 'ok' : 'absent') }),
      el('span', { class: 'mcp-etat-nom', text: srv.nom }),
      el('span', {
        class: 'mcp-etat-detail',
        title: e?.erreur || '',
        text: ok ? `${e.outils} outil(s) chargé(s)`
          : e?.erreur ? e.erreur.slice(0, 110)
          : srv.actif === false ? 'désactivé' : 'pas encore démarré — cliquez sur Tester'
      })
    ));
  }
}

function initialiserPlugins() {
  const rw = etat.config.rechercheWeb || {};
  const moteur = $('#reglageMoteurWeb');
  if (moteur) {
    moteur.value = rw.moteur || 'duckduckgo';
    const majLignes = () => {
      const externe = moteur.value === 'fournisseur';
      if ($('#ligneUrlRecherche')) $('#ligneUrlRecherche').hidden = !externe;
      if ($('#ligneCleRecherche')) $('#ligneCleRecherche').hidden = !externe;
    };
    majLignes();
    moteur.addEventListener('change', async () => {
      await enregistrerConfig({ rechercheWeb: { moteur: moteur.value } });
      majLignes();
    });
  }

  const url = $('#reglageUrlRecherche');
  if (url) {
    url.value = rw.urlBase || '';
    url.addEventListener('change', async () => {
      await enregistrerConfig({ rechercheWeb: { urlBase: url.value.trim() } });
    });
  }
  const cle = $('#reglageCleRecherche');
  if (cle) {
    cle.value = rw.cle ? '••••••••' : '';
    cle.addEventListener('change', async () => {
      if (cle.value === '••••••••') return;
      await enregistrerConfig({ rechercheWeb: { cle: cle.value.trim() } });
    });
  }

  $('#btnTesterRecherche')?.addEventListener('click', async () => {
    const cible = $('#resultatTestRecherche');
    if (cible) cible.textContent = 'Recherche en cours…';
    const r = await API.web.tester();
    if (cible) {
      cible.textContent = r.ok
        ? `${r.total} résultat(s) via ${r.moteur}. Exemple : ${r.exemple || '—'}`
        : `Échec : ${r.message}`;
      cible.style.color = r.ok ? 'var(--succes)' : 'var(--danger)';
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
  { nom: 'etat_ci', famille: 'GitHub' }
];

function rendreOutilsReglage() {
  const zone = $('#reglageOutils');
  if (!zone) return;
  zone.innerHTML = '';
  const desactives = etat.config.outilsDesactives || [];

  for (const o of OUTILS_CONNUS) {
    const actif = !desactives.includes(o.nom);
    const ligne = el('label', { class: 'outil-reglage' },
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
    );
    zone.append(ligne);
  }
}

function initialiserReglagesAvances() {
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
  lier('#reglageRestaurer', g.restaurerDerniere, 'general.restaurerDerniere', (v) => v, false);
  lier('#reglageHistorique', g.historiqueMax, 'general.historiqueMax', (v) => Number(v) || 200, 200);

  lier('#reglageMaxTours', a.maxTours, 'agent.maxTours', (v) => Number(v) || 25, 25);
  lier('#reglageAppelsParalleles', a.appelsParalleles, 'agent.appelsParalleles', (v) => v, true);
  lier('#reglageDelaiCommande', a.delaiCommande, 'agent.delaiCommande', (v) => Number(v) || 120, 120);
  lier('#reglageCapSortie', a.capSortie, 'agent.capSortie', (v) => Number(v) || 60, 60);

  const chemin = $('#reglageCheminConfig');
  if (chemin) chemin.textContent = etat.config.configPath || '~/.config/cerveau/config.json';

  $('#btnOuvrirConfig')?.addEventListener('click', () => API.app.ouvrirDossierConfig());
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

function initialiserComportement() {
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
  const decouverts = etat.modelesDecouverts[id] || [];
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

/** Interroge le fournisseur pour découvrir ses modèles. */
async function detecterModeles(id, bouton, zone) {
  const p = etat.config.providers?.[id] || {};
  const urlInput = document.querySelector(`input[data-champ="baseUrl"][data-provider="${id}"]`);
  const baseUrl = urlInput?.value.trim() || p.baseUrl || '';
  const cleInput = document.querySelector(`input[data-champ="apiKey"][data-provider="${id}"]`);
  const apiKey = cleInput?.value.trim() || '';

  if (!baseUrl) {
    return notifier("Renseigne d'abord l'URL de base.", 'erreur', 3000);
  }

  const texte = bouton.textContent;
  bouton.disabled = true;
  bouton.textContent = '⟳ …';

  const r = await API.models.lister({ providerId: id, baseUrl, apiKey });

  bouton.disabled = false;
  bouton.textContent = texte;

  if (!r.ok) {
    return notifier(r.message, 'erreur', 7000);
  }
  if (!r.total) {
    return notifier('Le fournisseur n\'a renvoyé aucun modèle.', 'info', 4000);
  }

  etat.modelesDecouverts[id] = r.modeles;
  rendreCartesFournisseurs();
  rafraichirModeles();
  notifier(`${r.total} modèle(s) détecté(s). Clique sur ★ pour en choisir un par défaut.`, 'succes', 5000);
}

async function sauverFournisseur(id) {
  const patch = { providers: { [id]: {} } };
  // on ne touche pas à `modeles` : il est géré par la zone multi-modèles
  for (const input of $$(`input[data-provider="${id}"][data-champ]`)) {
    const champ = input.dataset.champ;
    const valeur = input.value.trim();
    if (champ === 'apiKey' && valeur === '') continue; // vide = inchangé
    patch.providers[id][champ] = valeur;
  }
  await enregistrerConfig(patch);
  notifier(`Fournisseur ${NOMS_FOURNISSEURS[id]} enregistré.`, 'succes');
  $$(`input[data-provider="${id}"]`).forEach((i) => {
    if (i.dataset.champ === 'apiKey') i.value = '';
  });
  rendreCartesFournisseurs();
  rafraichirModeles();
  majStatutFournisseur();
}

async function testerFournisseur(id, cible) {
  cible.textContent = 'Test en cours…';
  cible.className = 'message-test';
  const champ = document.querySelector(`input[data-champ="model"][data-provider="${id}"]`);
  const modele = champ?.value.trim() || null;
  const res = await API.config.testerFournisseur(id, modele);
  cible.textContent = res.ms ? `${res.message} (${res.ms} ms)` : res.message;
  cible.className = `message-test ${res.ok ? 'ok' : 'erreur'}`;
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
  const conv = {
    id: identifiant('conv'),
    titre: 'Nouvelle conversation',
    date: Date.now(),
    messages: [],
    fournisseur: etat.config?.activeProvider || 'anthropic'
  };
  etat.conversations.unshift(conv);
  etat.conversationCourante = conv;
  afficherConversation();
  afficherConversations();
  // sans cela, une conversation créée puis fermée aussitôt serait perdue
  persisterConversations();
  if (!silencieux) $('#saisie').focus();
}

function afficherConversation() {
  const conv = etat.conversationCourante;
  const messages = $('#messages');
  const accueil = $('#accueil');

  $('#titreConversation').textContent = conv?.titre || 'Nouvelle conversation';
  $('#sousTitreConversation').textContent = conv?.messages?.length
    ? `${conv.messages.filter((m) => m.role === 'user').length} message(s)`
    : 'Prêt à travailler';

  if (!conv || conv.messages.length === 0) {
    accueil.style.display = '';
    messages.hidden = true;
    messages.innerHTML = '';
    return;
  }

  accueil.style.display = 'none';
  messages.hidden = false;
  messages.innerHTML = '';
  for (const m of conv.messages) ajouterMessageDOM(m);
  defilerEnBas();
}

function ajouterMessageDOM(m) {
  const messages = $('#messages');
  const estUtilisateur = m.role === 'user';

  const bloc = el('div', { class: `message ${estUtilisateur ? 'utilisateur' : 'assistant'}` });
  bloc.append(
    el('div', { class: 'message-entete' },
      el('div', { class: 'avatar', text: estUtilisateur ? 'V' : 'C' }),
      el('span', { text: estUtilisateur ? 'Vous' : 'Cerveau' })
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
    bloc.append(outils);
  }

  const corps = el('div', { class: 'message-corps markdown-corps' });
  if (estUtilisateur) {
    corps.textContent = m.contenu;
  } else {
    corps.innerHTML = renduMarkdown.rendre(m.contenu);
    renduMarkdown.embellir(corps);
  }
  bloc.append(corps);

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
  etat.conversationCourante = conv;
  afficherConversation();
  afficherConversations();
}

function supprimerConversation(id) {
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
    // on garde un historique borné pour ne pas gonfler la config
    const borne = etat.conversations
      .sort((a, b) => b.date - a.date)
      .slice(0, 200)
      .map((c) => ({ ...c, messages: c.messages.slice(-80) }));
    etat.config = await API.config.mettreAJour({ conversations: borne });
  }, 600);
}

/* ═══════════════════════════ ENVOI DE MESSAGE ═══════════════════════════ */

async function envoyerMessage() {
  const saisie = $('#saisie');
  const texte = saisie.value.trim();
  if (!texte || etat.enCours) return;

  const conv = etat.conversationCourante;
  if (!conv) return;

  const providerId = etat.config.activeProvider;
  const modele = etat.modelesSession[providerId] || etat.config.providers?.[providerId]?.model || '';

  if (!etat.config.providers?.[providerId]?.hasKey) {
    notifier(`Aucune clé d'API pour ${NOMS_FOURNISSEURS[providerId]}. Ouvre les réglages.`, 'erreur', 5000);
    ouvrirReglages('fournisseurs');
    return;
  }

  // message utilisateur
  const contenuComplet = composerMessage(texte);
  conv.messages.push({ role: 'user', contenu: contenuComplet });
  conv.date = Date.now();
  if (conv.titre === 'Nouvelle conversation') {
    conv.titre = texte.slice(0, 60) + (texte.length > 60 ? '…' : '');
  }
  conv.fournisseur = providerId;
  saisie.value = '';
  piecesJointes = [];
  rendrePieces();
  ajusterHauteurSaisie();
  afficherConversation();
  afficherConversations();

  // bulle assistant en streaming
  etat.enCours = true;
  basculerEtatEnvoi(true);

  const bloc = el('div', { class: 'message assistant' });
  bloc.append(
    el('div', { class: 'message-entete' },
      el('div', { class: 'avatar', text: 'C' }),
      el('span', { text: 'Cerveau' })
    )
  );
  const zoneOutils = el('div', { class: 'outils-message' });
  const corps = el('div', { class: 'message-corps markdown-corps' });
  corps.append(el('div', { class: 'indicateur' }, el('span'), el('span'), el('span')));
  bloc.append(zoneOutils, corps);
  $('#messages').append(bloc);
  defilerEnBas();

  const etatFlux = { texte: '', outils: [], corps, zoneOutils, bloc };
  fluxActif = etatFlux;

  try {
    const res = await API.agent.envoyer({
      providerId,
      mode: etat.mode,
      modeles: { ...etat.modelesSession },
      // borne l'historique : au-delà, la fenêtre de contexte du modèle déborde
      // et l'API renvoie une erreur. On garde les échanges les plus récents.
      historique: bornHistorique(conv.messages)
    });

    finaliserMessage(conv, etatFlux, res);
  } catch (err) {
    corps.textContent = `Erreur : ${err.message || err}`;
  } finally {
    fluxActif = null;
    etat.enCours = false;
    basculerEtatEnvoi(false);
    majStatutFournisseur();
    if (modele) { /* le modèle actif reste celui des réglages */ }
  }
}

let fluxActif = null;

function finaliserMessage(conv, etatFlux, res) {
  const texteFinal = etatFlux.texte.trim();
  etatFlux.corps.innerHTML = renduMarkdown.rendre(texteFinal || (res.erreur ? `⚠️ ${res.erreur}` : ''));
  renduMarkdown.embellir(etatFlux.corps);

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
      })
    );
    etatFlux.bloc.append(actions);
  }

  conv.date = Date.now();
  persisterConversations();
  afficherConversations();
  defilerEnBas();
  rafraichirCoffre();
}

function basculerEtatEnvoi(enCours) {
  $('#btnEnvoyer').disabled = enCours;
  $('#btnArreter').hidden = !enCours;
  $('#btnEnvoyer').hidden = enCours;
  $('#saisie').disabled = enCours;
  if (!enCours) $('#saisie').focus();
}

function defilerEnBas() {
  const zone = $('#conversation');
  requestAnimationFrame(() => { zone.scrollTop = zone.scrollHeight; });
}

/* --------------------- traitement des événements agent ----------------- */

function traiterEvenementAgent(evt) {
  const flux = fluxActif;
  if (!flux) return;

  const { corps, zoneOutils } = flux;

  switch (evt.type) {
    case 'texte': {
      const ind = corps.querySelector('.indicateur');
      if (ind) ind.remove();
      flux.texte += evt.delta;
      corps.innerHTML = renduMarkdown.rendre(flux.texte);
      defilerEnBas();
      break;
    }
    case 'outil_debut': {
      // sépare le texte du tour précédent de celui qui suivra l'appel d'outil
      if (flux.texte && !flux.texte.endsWith('\n\n')) {
        flux.texte = `${flux.texte.replace(/\s+$/, '')}\n\n`;
        corps.innerHTML = renduMarkdown.rendre(flux.texte);
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
    case 'usage': {
      const u = evt.usage;
      const details = [];
      if (u.input_tokens) details.push(`${u.input_tokens} entrée`);
      if (u.output_tokens) details.push(`${u.output_tokens} sortie`);
      if (u.prompt_tokens) details.push(`${u.prompt_tokens} entrée`);
      if (u.completion_tokens) details.push(`${u.completion_tokens} sortie`);
      if (details.length) $('#sousTitreConversation').textContent = `jetons : ${details.join(' · ')}`;
      break;
    }
    case 'erreur': {
      const ind = corps.querySelector('.indicateur');
      if (ind) ind.remove();
      notifier(evt.message, 'erreur', 6000);
      if (!fluxCourant?.texte) {
        corps.innerHTML = `<p style="color:var(--danger)">⚠️ ${echapper(evt.message)}</p>`;
      }
      break;
    }
    case 'termine': {
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
        const nouveau = prompt('Nouveau chemin relatif :', chemin);
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

function definirMode(mode) {
  etat.mode = mode || 'complet';
  $$('.mode-btn').forEach((b) => b.classList.toggle('actif', b.dataset.mode === etat.mode));
  majAccueil();
  enregistrerConfig({ mode: etat.mode });
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

/* ═══════════════════════════ PALETTE DE COMMANDES ═══════════════════════════ */

const COMMANDES = [
  { id: 'nouvelle', titre: 'Nouvelle conversation', raccourci: 'Ctrl+N', action: () => nouvelleConversation() },
  { id: 'reglages', titre: 'Ouvrir les réglages', raccourci: 'Ctrl+,', action: () => ouvrirReglages() },
  { id: 'fournisseurs', titre: 'Configurer les fournisseurs IA', action: () => ouvrirReglages('fournisseurs') },
  { id: 'workspace', titre: "Changer d'espace de travail", action: () => choisirWorkspace() },
  { id: 'coffres', titre: 'Gérer les coffres Obsidian', action: () => ouvrirReglages('coffres') },
  { id: 'permissions', titre: 'Régler les permissions', action: () => ouvrirReglages('permissions') },
  { id: 'theme', titre: 'Basculer le thème clair / sombre', action: async () => {
      const suivant = (etat.config.ui?.theme || 'sombre') === 'sombre' ? 'clair' : 'sombre';
      await enregistrerConfig({ ui: { theme: suivant } });
      appliquerTheme(suivant);
      notifier(`Thème ${suivant}.`, 'succes', 1600);
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
  // saisie
  const saisie = $('#saisie');
  saisie.addEventListener('input', ajusterHauteurSaisie);
  saisie.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      envoyerMessage();
    }
  });

  $('#btnEnvoyer').addEventListener('click', envoyerMessage);
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

  // export
  $('#btnExporter').addEventListener('click', exporterConversation);
  $('#btnPalette')?.addEventListener('click', ouvrirPalette);

  // insertion de note
  $('#btnJoindre').addEventListener('click', ouvrirModaleNotes);
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
}

function basculerPanneauObsidian() {
  const p = $('#panneauObsidian');
  p.classList.toggle('replie');
  enregistrerConfig({ ui: { obsidianPanelOpen: !p.classList.contains('replie') } });
}

function actifOngletPanneau(nom) {
  $$('.onglet-panneau').forEach((x) => x.classList.toggle('actif', x.dataset.panneau === nom));
  $$('.volet-panneau').forEach((v) => v.classList.toggle('actif', v.id === `panneau-${nom}`));
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
  const nom = prompt('Nom de la nouvelle note :', 'Nouvelle note');
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
  const nom = prompt('Nom du nouveau dossier :', 'Nouveau dossier');
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
  const defaut = `Depuis Cerveau/${new Date().toISOString().slice(0, 10)} — ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h')}`;
  const chemin = prompt('Chemin de la note à créer dans le coffre :', defaut);
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

/* ------------------------------ réglages ---------------------------- */

function afficherSectionReglage(id) {
  if (!id) return;
  $$('.nav-reglage').forEach((x) => x.classList.toggle('actif', x.dataset.reglage === id));
  $$('.volet-reglage').forEach((v) => v.classList.toggle('actif', v.id === `reglage-${id}`));
  const zone = $('.reglages-contenu');
  if (zone) zone.scrollTop = 0;
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

  $('#modePermissions').value = etat.config.permissions?.mode || 'demander';
  $('#autoriserSuppression').checked = Boolean(etat.config.permissions?.allowDelete);
  const autoCmd = $('#autoCommandes');
  if (autoCmd) autoCmd.checked = etat.config.permissions?.autoCommandes !== false;
  const autoPush = $('#autoPush');
  if (autoPush) autoPush.checked = etat.config.permissions?.autoPush === true;
  const autoGh = $('#autoGithub');
  if (autoGh) autoGh.checked = etat.config.permissions?.autoGithub === true;
  $('#choixTheme').value = etat.config.ui?.theme || 'sombre';
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
