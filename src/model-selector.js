'use strict';

/**
 * Sélecteur de modèle à deux niveaux.
 *
 * Niveau 1 : liste des fournisseurs (avec le modèle courant de chacun).
 * Niveau 2 : liste des modèles du fournisseur choisi.
 * Niveau 3 (optionnel) : niveau de raisonnement, pour les modèles qui le proposent.
 *
 * Navigation : ↑↓ pour parcourir, → ou Entrée pour entrer dans un niveau,
 * ← ou Échap pour remonter. La recherche filtre les deux niveaux à la fois.
 */

(function () {
  const API = window.cerveau;
  if (!API) return;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  /** Niveaux de raisonnement proposés selon la famille de modèle. */
  const EFFORTS = {
    anthropic: [
      { id: 'low', nom: 'Rapide', description: 'Réponses concises, moins de réflexion' },
      { id: 'medium', nom: 'Équilibré', description: 'Bon compromis par défaut' },
      { id: 'high', nom: 'Approfondi', description: 'Raisonnement étendu, plus lent' }
    ],
    openai: [
      { id: 'low', nom: 'Rapide', description: 'Effort de raisonnement minimal' },
      { id: 'medium', nom: 'Équilibré', description: 'Effort de raisonnement moyen' },
      { id: 'high', nom: 'Approfondi', description: 'Effort de raisonnement élevé' }
    ],
    deepseek: [
      { id: 'low', nom: 'Rapide', description: 'Réponses directes' },
      { id: 'high', nom: 'Approfondi', description: 'Raisonnement étendu (reasoner)' }
    ]
  };

  const etatMenu = {
    ouvert: false,
    niveau: 1,              // 1 = fournisseurs, 2 = modèles, 3 = effort
    fournisseur: null,
    index: 0,
    entrees: [],            // entrées affichées au niveau courant
    filtre: ''
  };

  /* --------------------------- utilitaires ---------------------------- */

  function normaliser(t) {
    return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function el(tag, attrs = {}, ...enfants) {
    return window.cerveauUI.el(tag, attrs, ...enfants);
  }

  function notifier(msg, type = 'info', duree = 3200) {
    window.cerveauUI.notifier(msg, type, duree);
  }

  /** Modèle actuellement retenu (session > défaut). */
  function modeleCourant() {
    const cfg = window.cerveauUI.etat.config;
    const pid = cfg.activeProvider;
    const p = cfg.providers?.[pid] || {};
    return {
      providerId: pid,
      providerNom: window.cerveauUI.NOMS_FOURNISSEURS?.[pid] || pid,
      model: window.cerveauUI.etat.modelesSession[pid] || p.model || '',
      effort: window.cerveauUI.etat.effortsSession?.[pid] || null
    };
  }

  /** Famille d'API pour choisir les efforts disponibles. */
  function famille(providerId) {
    if (providerId === 'anthropic') return 'anthropic';
    if (providerId === 'deepseek') return 'deepseek';
    return 'openai';
  }

  /* ---------------------------- rendu -------------------------------- */

  function rendreDeclencheur() {
    const c = modeleCourant();
    const libelle = $('#modeleLibelle');
    const pastille = $('#modelePastille');
    const badge = $('#modeleEffort');

    if (!libelle) return;

    if (!c.model) {
      libelle.textContent = 'Choisir un modèle';
      libelle.classList.add('vide');
      pastille.className = 'modele-pastille absent';
      if (badge) badge.hidden = true;
      return;
    }

    libelle.textContent = c.model;
    libelle.title = `${c.providerNom} · ${c.model}`;
    libelle.classList.remove('vide');

    const p = window.cerveauUI.etat.config.providers?.[c.providerId];
    const configure = Boolean(p?.hasKey);
    pastille.className = `modele-pastille${configure ? ' ok' : ' absent'}`;

    if (badge) {
      if (c.effort) {
        const liste = EFFORTS[famille(c.providerId)] || [];
        const e = liste.find((x) => x.id === c.effort);
        badge.hidden = false;
        badge.textContent = e ? e.nom : c.effort;
      } else {
        badge.hidden = true;
      }
    }
  }

  function ouvrirMenu() {
    const menu = $('#menuModele');
    if (!menu) return;
    etatMenu.ouvert = true;
    etatMenu.niveau = 1;
    etatMenu.fournisseur = null;
    etatMenu.filtre = '';
    etatMenu.index = 0;
    const champ = $('#rechercheModele');
    if (champ) champ.value = '';
    menu.hidden = false;
    rendreNiveau();
    setTimeout(() => champ?.focus(), 40);
  }

  function fermerMenu() {
    const menu = $('#menuModele');
    if (menu) menu.hidden = true;
    etatMenu.ouvert = false;
    etatMenu.entrees = [];
  }

  /** Fournisseurs proposés, avec leur modèle courant. */
  function fournisseursDisponibles() {
    const cfg = window.cerveauUI.etat.config;
    const resultat = [];
    for (const id of Object.keys(window.cerveauUI.NOMS_FOURNISSEURS || {})) {
      const p = cfg.providers?.[id];
      const modeles = window.cerveauUI.modelesDe ? window.cerveauUI.modelesDe(id) : [];
      const configure = Boolean(p?.baseUrl || p?.hasKey || p?.model || modeles.length);
      // on n'affiche pas un fournisseur totalement vide, sauf s'il est actif
      if (!configure && cfg.activeProvider !== id) continue;
      resultat.push({
        type: 'fournisseur',
        id,
        nom: window.cerveauUI.NOMS_FOURNISSEURS[id] || id,
        configure,
        nbModeles: modeles.length,
        courant: window.cerveauUI.etat.modelesSession[id] || p?.model || '',
        actif: cfg.activeProvider === id
      });
    }
    return resultat;
  }

  function rendreNiveau() {
    const corps = $('#menuModeleCorps');
    if (!corps) return;
    corps.innerHTML = '';
    etatMenu.entrees = [];

    const q = normaliser(etatMenu.filtre);

    if (etatMenu.niveau === 1) rendreFournisseurs(corps, q);
    else if (etatMenu.niveau === 2) rendreModeles(corps, q);
    else rendreEfforts(corps);

    // borne l'index
    if (etatMenu.index >= etatMenu.entrees.length) {
      etatMenu.index = Math.max(0, etatMenu.entrees.length - 1);
    }
    surligner(etatMenu.index);
  }

  function rendreFournisseurs(corps, q) {
    const liste = fournisseursDisponibles().filter((f) =>
      !q || normaliser(f.nom).includes(q) || normaliser(f.id).includes(q)
    );

    if (!liste.length) {
      corps.append(el('p', { class: 'menu-vide', text: 'Aucun fournisseur configuré.' }));
      corps.append(el('p', { class: 'menu-vide petit', text: 'Ouvre les réglages pour ajouter une clé d’API.' }));
      return;
    }

    corps.append(el('div', { class: 'menu-section', text: 'Fournisseurs' }));

    for (const f of liste) {
      const item = el('div', { class: 'menu-item' + (f.actif ? ' courant' : '') },
        el('span', {
          class: 'menu-item-pastille ' + (f.configure ? 'ok' : 'absent'),
          title: f.configure ? 'Configuré' : 'Clé manquante'
        }),
        el('div', { class: 'menu-item-corps' },
          el('div', { class: 'menu-item-titre', text: f.nom }),
          f.courant ? el('div', { class: 'menu-item-sous', text: f.courant }) : null
        ),
        f.nbModeles ? el('span', { class: 'menu-item-badge', text: String(f.nbModeles) }) : null,
        el('span', { class: 'menu-item-fleche', text: '›' })
      );
      item.addEventListener('click', () => entrerFournisseur(f.id));
      corps.append(item);
      etatMenu.entrees.push({ type: 'fournisseur', valeur: f.id, element: item });
    }
  }

  function rendreModeles(corps, q) {
    const pid = etatMenu.fournisseur;
    const nom = window.cerveauUI.NOMS_FOURNISSEURS?.[pid] || pid;
    const p = window.cerveauUI.etat.config.providers?.[pid] || {};
    const courant = window.cerveauUI.etat.modelesSession[pid] || p.model || '';

    // fil d'Ariane
    const fil = el('div', { class: 'menu-fil' },
      el('button', { class: 'menu-retour', text: '‹ Fournisseurs', onclick: () => retourNiveau() }),
      el('span', { class: 'menu-fil-nom', text: nom })
    );
    corps.append(fil);

    // un serveur local n'a pas besoin de clé
    const sansCle = pid === 'custom' && Boolean(String(p.baseUrl || '').trim());
    if (!p.hasKey && !sansCle) {
      corps.append(el('div', { class: 'menu-avertissement' },
        el('span', { text: 'Aucune clé d’API pour ce fournisseur.' }),
        el('button', {
          class: 'btn-mini', text: 'Ouvrir les réglages',
          onclick: () => { fermerMenu(); window.cerveauUI.ouvrirReglages('fournisseurs'); }
        })
      ));
    }

    const modeles = (window.cerveauUI.modelesDe ? window.cerveauUI.modelesDe(pid) : [])
      .filter((m) => !q || normaliser(m.id).includes(q));

    if (!modeles.length) {
      corps.append(el('p', { class: 'menu-vide', text: q ? 'Aucun modèle ne correspond.' : 'Aucun modèle configuré.' }));
      corps.append(el('button', {
        class: 'btn-mini', text: 'Gérer les modèles',
        onclick: () => { fermerMenu(); window.cerveauUI.ouvrirReglages('fournisseurs'); }
      }));
      return;
    }

    corps.append(el('div', { class: 'menu-section', text: `Modèles — ${nom}` }));

    for (const m of modeles) {
      const estCourant = m.id === courant;
      const item = el('div', { class: 'menu-item' + (estCourant ? ' courant' : '') },
        el('div', { class: 'menu-item-corps' },
          el('div', { class: 'menu-item-titre mono', text: m.id }),
          estCourant ? el('div', { class: 'menu-item-sous', text: 'sélectionné' }) : null
        ),
        estCourant ? el('span', { class: 'menu-item-coche', text: '✓' }) : null
      );
      item.addEventListener('click', () => choisirModele(pid, m.id));
      corps.append(item);
      etatMenu.entrees.push({ type: 'modele', valeur: m.id, element: item });
    }
  }

  function rendreEfforts(corps) {
    const pid = etatMenu.fournisseur;
    const courant = window.cerveauUI.etat.effortsSession?.[pid] || null;
    const liste = EFFORTS[famille(pid)] || [];

    const fil = el('div', { class: 'menu-fil' },
      el('button', { class: 'menu-retour', text: '‹ Modèles', onclick: () => { etatMenu.niveau = 2; rendreNiveau(); } }),
      el('span', { class: 'menu-fil-nom', text: 'Niveau de raisonnement' })
    );
    corps.append(fil);
    corps.append(el('div', { class: 'menu-section', text: 'Effort de raisonnement' }));

    for (const e of liste) {
      const actif = e.id === courant || (!courant && e.id === 'medium');
      const item = el('div', { class: 'menu-item' + (actif ? ' courant' : '') },
        el('div', { class: 'menu-item-corps' },
          el('div', { class: 'menu-item-titre', text: e.nom }),
          el('div', { class: 'menu-item-sous', text: e.description })
        ),
        actif ? el('span', { class: 'menu-item-coche', text: '✓' }) : null
      );
      item.addEventListener('click', () => choisirEffort(pid, e.id));
      corps.append(item);
      etatMenu.entrees.push({ type: 'effort', valeur: e.id, element: item });
    }
  }

  function surligner(index) {
    etatMenu.entrees.forEach((e, i) => e.element.classList.toggle('actif', i === index));
    const actif = etatMenu.entrees[index]?.element;
    if (actif) actif.scrollIntoView({ block: 'nearest' });
  }

  /* --------------------------- interactions --------------------------- */

  function entrerFournisseur(pid) {
    etatMenu.fournisseur = pid;
    etatMenu.niveau = 2;
    etatMenu.index = 0;
    rendreNiveau();
  }

  function retourNiveau() {
    if (etatMenu.niveau === 3) { etatMenu.niveau = 2; }
    else { etatMenu.niveau = 1; etatMenu.fournisseur = null; }
    etatMenu.index = 0;
    etatMenu.filtre = '';
    const champ = $('#rechercheModele');
    if (champ) champ.value = '';
    rendreNiveau();
  }

  async function choisirModele(pid, modelId) {
    const ui = window.cerveauUI;
    ui.etat.modelesSession[pid] = modelId;

    // le fournisseur actif suit le modèle choisi
    if (ui.etat.config.activeProvider !== pid) {
      await ui.enregistrerConfig({ activeProvider: pid });
    }
    ui.majStatutFournisseur();

    // propose le niveau de raisonnement si le modèle en gère
    const efforts = EFFORTS[famille(pid)] || [];
    if (efforts.length > 1) {
      etatMenu.fournisseur = pid;
      etatMenu.niveau = 3;
      etatMenu.index = 0;
      rendreNiveau();
      rendreDeclencheur();
      return;
    }

    fermerMenu();
    rendreDeclencheur();
    notifier(`Modèle : ${modelId}`, 'succes', 2000);
  }

  function choisirEffort(pid, effort) {
    if (!window.cerveauUI.etat.effortsSession) window.cerveauUI.etat.effortsSession = {};
    window.cerveauUI.etat.effortsSession[pid] = effort;
    fermerMenu();
    rendreDeclencheur();
    notifier(`Raisonnement : ${(EFFORTS[famille(pid)] || []).find((e) => e.id === effort)?.nom || effort}`, 'succes', 2000);
  }

  function executerEntree() {
    const e = etatMenu.entrees[etatMenu.index];
    if (!e) return;
    if (e.type === 'fournisseur') entrerFournisseur(e.valeur);
    else if (e.type === 'modele') choisirModele(etatMenu.fournisseur, e.valeur);
    else if (e.type === 'effort') choisirEffort(etatMenu.fournisseur, e.valeur);
  }

  /* ---------------------------- événements --------------------------- */

  function brancher() {
    $('#btnModele')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      etatMenu.ouvert ? fermerMenu() : ouvrirMenu();
    });

    $('#rechercheModele')?.addEventListener('input', (ev) => {
      etatMenu.filtre = ev.target.value;
      etatMenu.index = 0;
      rendreNiveau();
    });

    $('#rechercheModele')?.addEventListener('keydown', (ev) => {
      switch (ev.key) {
        case 'ArrowDown':
          ev.preventDefault();
          etatMenu.index = Math.min(etatMenu.index + 1, etatMenu.entrees.length - 1);
          surligner(etatMenu.index);
          break;
        case 'ArrowUp':
          ev.preventDefault();
          etatMenu.index = Math.max(etatMenu.index - 1, 0);
          surligner(etatMenu.index);
          break;
        case 'ArrowRight':
        case 'Enter': {
          ev.preventDefault();
          const e = etatMenu.entrees[etatMenu.index];
          if (e?.type === 'fournisseur') entrerFournisseur(e.valeur);
          else executerEntree();
          break;
        }
        case 'ArrowLeft':
          ev.preventDefault();
          retourNiveau();
          break;
        case 'Escape':
          ev.preventDefault();
          if (etatMenu.niveau > 1) retourNiveau();
          else { fermerMenu(); $('#btnModele')?.focus(); }
          break;
        default:
          break;
      }
    });

    document.addEventListener('click', (ev) => {
      if (!etatMenu.ouvert) return;
      const menu = $('#menuModele');
      const btn = $('#btnModele');
      if (menu && !menu.contains(ev.target) && !btn?.contains(ev.target)) fermerMenu();
    });

    document.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'm') {
        ev.preventDefault();
        etatMenu.ouvert ? fermerMenu() : ouvrirMenu();
        return;
      }
      // Échap ferme le menu où que soit le focus : sinon il reste ouvert
      // quand on a cliqué ailleurs avant de presser la touche.
      if (ev.key === 'Escape' && etatMenu.ouvert) {
        ev.preventDefault();
        ev.stopPropagation();
        fermerMenu();
      }
    });

    // rafraîchit le libellé sur événement, sans scrutation périodique
    const rafraichir = () => { try { rendreDeclencheur(); } catch { /* ignore */ } };
    window.cerveauUI.surConfigChangee?.push(rafraichir);
  }

  window.cerveauModele = {
    rendre: rendreDeclencheur,
    ouvrir: ouvrirMenu,
    fermer: fermerMenu,
    modeleCourant,
    EFFORTS
  };

  document.addEventListener('DOMContentLoaded', () => {
    brancher();
    setTimeout(rendreDeclencheur, 800);
  });
})();
