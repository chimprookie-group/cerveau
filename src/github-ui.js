'use strict';

/**
 * Interface GitHub de Cerveau : connexion, liste des dépôts, clone,
 * opérations git et pull requests.
 *
 * Ce module est chargé après app.js et étend l'objet global `cerveauUI`.
 */

(function () {
  const API = window.cerveau;
  if (!API) return;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const gh = {
    etat: null,
    depots: [],
    depotSelectionne: null,
    dossierClone: null
  };

  /* ------------------------------- helpers ------------------------------ */

  function notifier(msg, type = 'info', duree = 3600) {
    if (window.cerveauUI?.notifier) return window.cerveauUI.notifier(msg, type, duree);
    const n = document.createElement('div');
    n.className = `notification ${type}`;
    n.textContent = msg;
    $('#notifications')?.append(n);
    setTimeout(() => n.remove(), duree);
  }

  function el(tag, attrs = {}, ...enfants) {
    return window.cerveauUI.el(tag, attrs, ...enfants);
  }

  function afficherErreur(sel, message) {
    const zone = $(sel);
    if (!zone) return;
    if (!message) {
      zone.hidden = true;
      zone.textContent = '';
      return;
    }
    zone.hidden = false;
    zone.textContent = message;
  }

  function formaterDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const j = Math.round((Date.now() - d) / 86400000);
      if (j === 0) return "aujourd'hui";
      if (j === 1) return 'hier';
      if (j < 30) return `il y a ${j} j`;
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    } catch {
      return '';
    }
  }

  /* ---------------------------- état connexion -------------------------- */

  async function rafraichirAuth() {
    const etat = await API.github.etatAuth();
    gh.etat = etat;

    const zoneNon = $('#ghNonConnecte');
    const zoneOui = $('#ghConnecte');
    if (!zoneNon || !zoneOui) return etat;

    if (etat.connecte) {
      zoneNon.hidden = true;
      zoneOui.hidden = false;
      $('#ghCompteNom').textContent = etat.utilisateur || 'Compte GitHub';
      $('#ghAvatar').textContent = (etat.utilisateur || 'G').charAt(0).toUpperCase();
      $('#ghVersion').textContent = etat.version || 'gh';
      await chargerDepots();
    } else {
      zoneNon.hidden = false;
      zoneOui.hidden = true;
      if (etat.message && !etat.ghPresent) {
        zoneNon.querySelector('.vide').textContent = etat.message;
      }
    }
    return etat;
  }

  async function chargerDepots() {
    const zone = $('#ghDepots');
    if (!zone) return;
    zone.innerHTML = '';
    zone.append(el('p', { class: 'vide', text: 'Chargement des dépôts…' }));

    const r = await API.github.listerDepots({ limite: 60 });
    if (!r.ok) {
      zone.innerHTML = '';
      zone.append(el('p', { class: 'vide', text: r.message || 'Impossible de charger les dépôts.' }));
      return;
    }

    gh.depots = r.depots || [];
    rendreDepots(gh.depots, zone);
  }

  function rendreDepots(depots, zone, surClic = null) {
    zone.innerHTML = '';
    if (!depots.length) {
      const vide = el('div', { class: 'gh-liste-vide' },
        el('p', { class: 'vide', text: gh.depots.length === 0
          ? 'Aucun dépôt sur ce compte pour le moment.'
          : 'Aucun dépôt ne correspond à ce filtre.' })
      );
      if (gh.depots.length === 0 && !surClic) {
        vide.append(el('button', {
          class: 'btn-principal petit',
          text: 'Créer mon premier dépôt',
          onclick: ouvrirModaleCreer
        }));
      }
      zone.append(vide);
      return;
    }

    for (const d of depots) {
      const item = el('div', { class: 'gh-depot' },
        el('div', { class: 'gh-depot-infos' },
          el('div', { class: 'gh-depot-nom', text: d.nom }),
          d.description ? el('div', { class: 'gh-depot-desc', text: d.description }) : null,
          el('div', { class: 'gh-depot-meta' },
            d.prive ? el('span', { class: 'gh-prive', text: '🔒 privé' }) : el('span', { text: 'public' }),
            d.langage ? el('span', { class: 'gh-lang', text: d.langage }) : null,
            d.etoiles ? el('span', { text: `★ ${d.etoiles}` }) : null,
            d.maj ? el('span', { text: formaterDate(d.maj) }) : null
          )
        )
      );

      item.addEventListener('click', () => {
        if (surClic) {
          $$('.gh-depot').forEach((x) => x.classList.remove('selectionne'));
          item.classList.add('selectionne');
          gh.depotSelectionne = d;
          surClic(d);
        } else {
          API.github.ouvrirUrl(d.url);
        }
      });

      zone.append(item);
    }
  }

  /* ------------------------------ connexion ----------------------------- */

  function ouvrirModaleGithub() {
    afficherErreur('#ghErreur', null);
    $('#ghToken').value = '';
    $('#modaleGithub').hidden = false;
    setTimeout(() => $('#ghToken').focus(), 100);
  }

  async function validerConnexionGithub() {
    const token = $('#ghToken').value.trim();
    const protocole = $('#ghProtocole').value;
    if (!token) return afficherErreur('#ghErreur', 'Colle un jeton pour continuer.');

    const btn = $('#btnValiderGithub');
    btn.disabled = true;
    btn.textContent = 'Connexion…';
    afficherErreur('#ghErreur', null);

    const r = await API.github.connecter({ token, protocole });
    btn.disabled = false;
    btn.textContent = 'Se connecter';

    if (!r.ok) {
      return afficherErreur('#ghErreur', r.message || 'Connexion refusée.');
    }

    $('#ghToken').value = '';
    $('#modaleGithub').hidden = true;
    notifier(`Connecté à GitHub en tant que ${r.utilisateur}.`, 'succes');
    await rafraichirAuth();
  }

  async function deconnecterGithub() {
    if (!confirm('Se déconnecter de GitHub ? Les dépôts clonés restent sur le disque.')) return;
    const r = await API.github.deconnecter();
    if (r.ok) {
      notifier('Déconnecté de GitHub.', 'info');
      await rafraichirAuth();
    } else {
      notifier(r.message || 'Échec de la déconnexion.', 'erreur');
    }
  }

  /* -------------------------------- clone ------------------------------- */

  function ouvrirModaleClone() {
    afficherErreur('#cloneErreur', null);
    $('#cloneRecherche').value = '';
    $('#modaleClone').hidden = false;
    if (!$('#cloneDossier').value) {
      $('#cloneDossier').value = `${window.cerveauUI?.etat?.workspaceParent || '~/Documents'}`;
    }
    rendreDepots(gh.depots, $('#cloneListe'), (d) => {
      gh.depotSelectionne = d;
      $('#btnValiderClone').disabled = false;
    });
    $('#btnValiderClone').disabled = true;
    gh.depotSelectionne = null;
    setTimeout(() => $('#cloneRecherche').focus(), 100);
  }

  function filtrerDepotsClone(filtre) {
    const f = String(filtre || '').toLowerCase();
    const liste = gh.depots.filter((d) =>
      !f || d.nom.toLowerCase().includes(f) || (d.description || '').toLowerCase().includes(f)
    );
    rendreDepots(liste, $('#cloneListe'), (d) => {
      gh.depotSelectionne = d;
      $('#btnValiderClone').disabled = false;
    });
  }

  async function choisirDossierClone() {
    const dossier = await API.github.choisirDossierClone();
    if (dossier) {
      $('#cloneDossier').value = dossier;
      gh.dossierClone = dossier;
    }
  }

  async function validerClone() {
    if (!gh.depotSelectionne) return;
    const dossierParent = $('#cloneDossier').value.trim() || gh.dossierClone;
    if (!dossierParent) return afficherErreur('#cloneErreur', 'Choisis un dossier de destination.');

    const btn = $('#btnValiderClone');
    btn.disabled = true;
    btn.textContent = 'Clonage…';
    afficherErreur('#cloneErreur', null);

    const r = await API.github.cloner({
      nomComplet: gh.depotSelectionne.nomComplet,
      dossierParent
    });

    btn.disabled = false;
    btn.textContent = 'Cloner';

    if (!r.ok) {
      return afficherErreur('#cloneErreur', r.message || 'Clonage échoué.');
    }

    $('#modaleClone').hidden = true;
    notifier(`« ${gh.depotSelectionne.nom} » cloné et ouvert.`, 'succes', 4000);
    await window.cerveauUI?.rafraichirWorkspace?.();
    await rafraichirGit();
    window.cerveauUI?.actifOngletPanneau?.('travail');
  }

  /* ----------------------------- nouveau dépôt -------------------------- */

  async function ouvrirModaleCreer() {
    afficherErreur('#creerErreur', null);
    $('#creerNom').value = '';
    $('#creerDescription').value = '';
    $('#creerPrive').checked = true;

    const ws = window.cerveauUI?.etat?.workspace || null;
    const caseWs = $('#creerDepuisWorkspace');
    caseWs.checked = Boolean(ws);
    caseWs.disabled = !ws;
    $('#creerAideWorkspace').hidden = !ws;
    if (!ws) {
      $('#creerAideWorkspace').hidden = true;
    }

    $('#modaleCreer').hidden = false;
    setTimeout(() => $('#creerNom').focus(), 100);
  }

  async function validerCreer() {
    const nom = $('#creerNom').value.trim();
    if (!nom) return afficherErreur('#creerErreur', 'Donne un nom au dépôt.');

    const btn = $('#btnValiderCreer');
    btn.disabled = true;
    btn.textContent = 'Création…';
    afficherErreur('#creerErreur', null);

    const depuisWs = $('#creerDepuisWorkspace').checked && window.cerveauUI?.etat?.workspace;
    const r = await API.github.creerDepot({
      nom,
      description: $('#creerDescription').value.trim(),
      prive: $('#creerPrive').checked,
      dossierLocal: depuisWs ? window.cerveauUI.etat.workspace : null,
      pousser: Boolean(depuisWs)
    });

    btn.disabled = false;
    btn.textContent = 'Créer';

    if (!r.ok) {
      return afficherErreur('#creerErreur', r.message || 'Création impossible.');
    }

    $('#modaleCreer').hidden = true;
    notifier(`Dépôt « ${r.nomComplet} » créé.`, 'succes', 4000);
    await chargerDepots();
    if (depuisWs) {
      await window.cerveauUI?.rafraichirWorkspace?.();
      await rafraichirGit();
    }
    if (r.url) setTimeout(() => API.github.ouvrirUrl(r.url), 800);
  }

  /* ---------------------------- état git local -------------------------- */

  async function rafraichirGit() {
    const panneau = $('#gitPanel');
    if (!panneau) return;

    const r = await API.github.etatLocal(null);
    if (!r.ok || !r.depot) {
      panneau.hidden = true;
      return;
    }

    panneau.hidden = false;
    $('#gitBranche').textContent = `⑂ ${r.branche}`;

    const sync = [];
    if (r.avance) sync.push(`↑${r.avance} à pousser`);
    if (r.retard) sync.push(`↓${r.retard} à tirer`);
    if (!sync.length) sync.push(r.nomComplet ? 'synchronisé' : 'pas de distant');
    $('#gitSync').textContent = sync.join(' · ');

    const zone = $('#gitFichiers');
    zone.innerHTML = '';
    if (!r.modifie) {
      zone.append(el('span', { class: 'f-new', text: 'Aucune modification en attente.' }));
    } else {
      for (const ligne of r.fichiers) {
        const code = ligne.slice(0, 2);
        const nom = ligne.slice(2).trim();
        let cls = 'f-mod';
        if (code.includes('D')) cls = 'f-del';
        else if (code.includes('A')) cls = 'f-add';
        else if (code.includes('?')) cls = 'f-new';
        zone.append(el('div', { class: cls, text: `${code.trim() || '·'} ${nom}` }));
      }
    }
  }

  async function tirerDepot() {
    const btn = $('#btnGitPull');
    btn.disabled = true;
    btn.textContent = '↓ …';
    const r = await API.github.tirer(null);
    btn.disabled = false;
    btn.textContent = '↓ Tirer';
    if (r.ok) {
      notifier(r.message || 'Dépôt à jour.', 'succes');
      await rafraichirGit();
      await window.cerveauUI?.rafraichirWorkspace?.();
    } else {
      notifier(r.message || 'Échec du tirage.', 'erreur', 6000);
    }
  }

  async function voirDiff() {
    const r = await API.github.difference(null);
    if (!r.ok) return notifier(r.message || 'Diff indisponible.', 'erreur');
    $('#diffContenu').textContent = r.diff?.trim() || r.resume || '(aucune modification)';
    $('#modaleDiff').hidden = false;
  }

  /* ------------------------------- commit ------------------------------- */

  async function ouvrirModaleCommit() {
    afficherErreur('#commitErreur', null);
    const r = await API.github.etatLocal(null);
    if (!r.ok || !r.depot) return notifier('Aucun dépôt ouvert.', 'erreur');
    if (!r.modifie) return notifier('Aucune modification à valider.', 'info');

    const zone = $('#commitFichiers');
    zone.innerHTML = '';
    for (const ligne of r.fichiers) {
      const code = ligne.slice(0, 2);
      const nom = ligne.slice(2).trim();
      let cls = 'f-mod';
      if (code.includes('D')) cls = 'f-del';
      else if (code.includes('A')) cls = 'f-add';
      else if (code.includes('?')) cls = 'f-new';
      zone.append(el('div', { class: cls, text: `${code.trim() || '·'} ${nom}` }));
    }

    $('#commitMessage').value = '';
    $('#modaleCommit').hidden = false;
    setTimeout(() => $('#commitMessage').focus(), 120);
  }

  async function validerCommit() {
    const message = $('#commitMessage').value.trim();
    if (!message) return afficherErreur('#commitErreur', 'Écris un message de commit.');

    const btn = $('#btnValiderCommit');
    btn.disabled = true;
    btn.textContent = 'Envoi…';
    afficherErreur('#commitErreur', null);

    const r = await API.github.envoyer(null, { message, tous: true });

    btn.disabled = false;
    btn.textContent = 'Commiter et pousser';

    if (!r.ok) {
      return afficherErreur('#commitErreur', r.message || 'Échec du commit.');
    }

    $('#modaleCommit').hidden = true;
    notifier('Commit créé et poussé sur GitHub.', 'succes', 4000);
    await rafraichirGit();
  }

  /* --------------------------------- PR --------------------------------- */

  async function ouvrirModalePR() {
    afficheErreurClear();
    const r = await API.github.etatLocal(null);
    if (!r.ok || !r.depot) return notifier('Aucun dépôt ouvert.', 'erreur');
    if (!r.nomComplet) return notifier("Ce dossier n'est pas relié à GitHub.", 'erreur');

    $('#prSource').value = r.branche;
    $('#prCible').value = 'main';
    $('#prTitre').value = '';
    $('#prCorps').value = '## Résumé\n\n\n## Tests effectués\n\n- [ ] ';
    $('#prBrouillon').checked = false;

    const champTitre = $('#prTitre');
    champTitre.placeholder = r.commit?.sujet || 'Résumé de la pull request';

    $('#modalePR').hidden = false;
    setTimeout(() => champTitre.focus(), 120);
  }

  function afficheErreurClear() {
    afficherErreur('#prErreur', null);
  }

  async function validerPR() {
    const etat = await API.github.etatLocal(null);
    if (!etat.ok || !etat.nomComplet) {
      return afficherErreur('#prErreur', "Ce dossier n'est pas relié à un dépôt GitHub.");
    }

    const titre = $('#prTitre').value.trim() || etat.commit?.sujet || '';
    if (!titre) return afficherErreur('#prErreur', 'Un titre est nécessaire.');

    const btn = $('#btnValiderPR');
    btn.disabled = true;
    btn.textContent = 'Création…';
    afficherErreur('#prErreur', null);

    const r = await API.github.creerPR(etat.nomComplet, {
      titre,
      corps: $('#prCorps').value,
      source: $('#prSource').value,
      cible: $('#prCible').value.trim() || null,
      brouillon: $('#prBrouillon').checked
    });

    btn.disabled = false;
    btn.textContent = 'Créer la pull request';

    if (!r.ok) {
      return afficherErreur('#prErreur', r.message || 'Création impossible.');
    }

    $('#modalePR').hidden = true;
    notifier('Pull request créée.', 'succes', 4000);
    if (r.url) API.github.ouvrirUrl(r.url);
  }

  /* ------------------------------ événements ---------------------------- */

  function brancher() {
    $('#btnGhConnecter')?.addEventListener('click', ouvrirModaleGithub);
    $('#btnGhDeconnecter')?.addEventListener('click', deconnecterGithub);
    $('#btnGhCloner')?.addEventListener('click', ouvrirModaleClone);
    $('#btnGhCreer')?.addEventListener('click', ouvrirModaleCreer);
    $('#btnFermerCreer')?.addEventListener('click', () => { $('#modaleCreer').hidden = true; });
    $('#btnAnnulerCreer')?.addEventListener('click', () => { $('#modaleCreer').hidden = true; });
    $('#btnValiderCreer')?.addEventListener('click', validerCreer);
    $('#creerNom')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') validerCreer(); });
    $('#btnGhRafraichir')?.addEventListener('click', challengerDepots);

    $('#btnFermerGithub')?.addEventListener('click', () => { $('#modaleGithub').hidden = true; });
    $('#btnAnnulerGithub')?.addEventListener('click', () => { $('#modaleGithub').hidden = true; });
    $('#btnValiderGithub')?.addEventListener('click', validerConnexionGithub);
    $('#ghToken')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') validerConnexionGithub();
    });

    $('#btnFermerClone')?.addEventListener('click', () => { $('#modaleClone').hidden = true; });
    $('#btnAnnulerClone')?.addEventListener('click', () => { $('#modaleClone').hidden = true; });
    $('#btnValiderClone')?.addEventListener('click', validerClone);
    $('#btnCloneChoisirDossier')?.addEventListener('click', choisirDossierClone);
    $('#cloneRecherche')?.addEventListener('input', (e) => filtrerDepotsClone(e.target.value));

    $('#btnGitPull')?.addEventListener('click', tirerDepot);
    $('#btnGitDiff')?.addEventListener('click', voirDiff);
    $('#btnGitCommit')?.addEventListener('click', ouvrirModaleCommit);
    $('#btnGitPR')?.addEventListener('click', ouvrirModalePR);

    $('#btnFermerCommit')?.addEventListener('click', () => { $('#modaleCommit').hidden = true; });
    $('#btnAnnulerCommit')?.addEventListener('click', () => { $('#modaleCommit').hidden = true; });
    $('#btnValiderCommit')?.addEventListener('click', validerCommit);
    $$('#suggestionsCommit .btn-mini').forEach((b) => {
      b.addEventListener('click', () => {
        const champ = $('#commitMessage');
        champ.value = `${b.dataset.msg}${champ.value.replace(/^\w+(\([^)]*\))?:\s*/, '')}`;
        champ.focus();
      });
    });

    $('#btnFermerPR')?.addEventListener('click', () => { $('#modalePR').hidden = true; });
    $('#btnAnnulerPR')?.addEventListener('click', () => { $('#modalePR').hidden = true; });
    $('#btnValiderPR')?.addEventListener('click', validerPR);

    $('#btnFermerDiff')?.addEventListener('click', () => { $('#modaleDiff').hidden = true; });
    $('#btnFermerDiff2')?.addEventListener('click', () => { $('#modaleDiff').hidden = true; });

    // modales : fermeture par le fond
    for (const id of ['modaleGithub', 'modaleCreer', 'modaleClone', 'modaleCommit', 'modalePR', 'modaleDiff']) {
      $(`#${id} .modale-fond`)?.addEventListener('click', () => { $(`#${id}`).hidden = true; });
    }

    $('#lienToken')?.addEventListener('click', (e) => {
      e.preventDefault();
      API.github.ouvrirUrl(e.target.href);
    });
  }

  async function challengerDepots() {
    notifier('Actualisation des dépôts…', 'info', 1500);
    await chargerDepots();
  }

  /* ------------------------------ démarrage ----------------------------- */

  window.cerveauGithub = {
    rafraichir: rafraichirAuth,
    rafraichirGit,
    ouvrirModaleGithub
  };

  document.addEventListener('DOMContentLoaded', () => {
    brancher();
    setTimeout(() => rafraichirAuth(), 1200);
  });
})();
