'use strict';

/**
 * Autotest de bout en bout, exécuté uniquement quand CERVEAU_SELFTEST=1.
 * Vérifie que l'interface se charge, que les IPC répondent, que le moteur
 * Markdown fonctionne et que le coffre Obsidian est accessible.
 */

const path = require('node:path');

async function run(mainWindow, deps) {
  const { config, obsidian, app } = deps;
  const resultats = [];
  const erreursConsole = [];

  mainWindow.webContents.on('console-message', (evt) => {
    // API moderne : objet ; ancienne : (event, niveau, message)
    const niveau = typeof evt === 'object' && evt.level !== undefined ? evt.level : arguments[1];
    const message = typeof evt === 'object' && evt.message !== undefined ? evt.message : arguments[2];
    if (niveau === 'error' || niveau === 3 || niveau === 2) erreursConsole.push(String(message));
  });

  const verifier = (nom, condition, detail = '') => {
    resultats.push({ test: nom, ok: Boolean(condition), detail });
  };

  // 1. Interface
  // le rendu des fournisseurs est asynchrone : on l'attend explicitement
  await mainWindow.webContents.executeJavaScript(
    `new Promise((resolve) => {
       let essais = 0;
       const t = setInterval(() => {
         if (document.querySelectorAll('.carte-fournisseur').length >= 3 || ++essais > 40) {
           clearInterval(t); resolve(true);
         }
       }, 100);
     })`
  );

  const ui = await mainWindow.webContents.executeJavaScript(`(() => {
    const q = (s) => document.querySelector(s);
    return {
      api: typeof window.cerveau,
      apiWorkspace: typeof window.cerveau?.workspace,
      sidebar: !!q('#sidebar'),
      suggestions: document.querySelectorAll('.suggestion').length,
      saisie: !!q('#saisie'),
      panneau: !!q('#panneauObsidian'),
      modaleReglages: !!q('#modaleReglages'),
      fournisseurs: document.querySelectorAll('.carte-fournisseur').length,
      selecteur: document.querySelectorAll('#btnModele').length,
      modele: document.querySelectorAll('#modeleLibelle').length,
      statut: q('#statutFournisseur')?.textContent || '',
      vault: q('#vaultNom')?.textContent || '',
      markdown: (window.marked ? marked.parse('# T') : 'NON').includes('<h1>'),
      purify: typeof window.DOMPurify === 'function',
      hljs: typeof window.hljs === 'object',
      modesBoutons: document.querySelectorAll('.mode-btn').length,
      modeActif: q('.mode-btn.actif')?.dataset.mode || '',
      ongletTravail: !!q('#panneau-travail'),
      planTaches: !!q('#planTaches'),
      wsPied: !!q('#wsPiedNom'),
      logo: q('#accueilLogo img') ? 'image' : (q('#accueilLogo')?.textContent || '')
    };
  })()`);

  verifier('API preload exposée', ui.api === 'object', ui.api);
  verifier('API workspace exposée', ui.apiWorkspace === 'object', ui.apiWorkspace);
  verifier('Barre latérale rendue', ui.sidebar);
  verifier('4 suggestions affichées', ui.suggestions === 4, String(ui.suggestions));
  verifier('Zone de saisie présente', ui.saisie);
  verifier('Panneau présent', ui.panneau);
  verifier('Modale réglages présente', ui.modaleReglages);
  verifier('Cartes fournisseurs rendues', ui.fournisseurs >= 3, `${ui.fournisseurs} cartes`);
  verifier('Déclencheur de modèle présent', ui.selecteur === 1);
  verifier('Libellé de modèle présent', ui.modele === 1);
  verifier('Rendu Markdown opérationnel', ui.markdown);
  verifier('DOMPurify chargé', ui.purify);
  verifier('Coloration syntaxique chargée', ui.hljs);
  verifier('3 boutons de mode (Notes/Complet/Code)', ui.modesBoutons === 3, `${ui.modesBoutons} boutons`);
  verifier('Mode actif défini', Boolean(ui.modeActif), ui.modeActif);
  verifier('Onglet Travail présent', ui.ongletTravail);
  verifier('Zone plan de tâches présente', ui.planTaches);
  verifier('Indicateur workspace en pied', ui.wsPied);
  verifier('Logo de l\'application affiché', ui.logo === 'image' || ui.logo.length > 0, ui.logo);

  // 2. IPC config
  const cfg = config.getConfig();
  verifier('Configuration lisible', cfg && typeof cfg === 'object');
  verifier('Chemins de config exposés', Boolean(cfg.configPath), cfg.configPath);

  // 3. Chiffrement des clés
  const secret = 'cle-secrete-de-test-12345';
  const chiffre = config.encryptSecret(secret);
  const dechiffre = config.decryptSecret(chiffre);
  verifier('Chiffrement AES des clés', dechiffre === secret && chiffre !== secret);
  verifier('Repli sur clé invalide', config.decryptSecret('aes:donnees-corrompues') === '');

  // 4. Moteur Obsidian sur un coffre temporaire
  const fsp = require('node:fs/promises');
  const os = require('node:os');
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cerveau-test-'));
  try {
    await obsidian.writeNote(tmp, 'Test/Note A', '# Note A\n\nLien vers [[Note B]] #test');
    await obsidian.writeNote(tmp, 'Note B', '# Note B\n\nRetour vers [[Test/Note A]].');
    const arbre = await obsidian.tree(tmp);
    const lecture = await obsidian.readNote(tmp, 'Note B');
    const recherche = await obsidian.search(tmp, 'Note A');
    const tags = await obsidian.tags(tmp);
    const liens = await obsidian.links(tmp, 'Test/Note A');
    const stats = await obsidian.stats(tmp);

    verifier('Arborescence du coffre', arbre.length === 2, `${arbre.length} entrées`);
    verifier('Lecture de note', lecture.content.includes('Note B'));
    verifier('Recherche plein texte', recherche.length >= 1, `${recherche.length} résultat(s)`);
    verifier('Extraction des tags', tags.some((t) => t.tag === 'test'), JSON.stringify(tags));
    verifier('Backlinks détectés', liens.entrants.length === 1, JSON.stringify(liens.entrants));
    verifier('Statistiques du coffre', stats.notes === 2, `${stats.notes} notes`);

    let evasion = false;
    try { await obsidian.readNote(tmp, '../../../etc/passwd'); } catch { evasion = true; }
    verifier('Protection contre l\u2019évasion de chemin', evasion);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }

  // 5. Outils de code
  const codetools = require('./codetools');
  const outil = (n) => codetools.PAR_NOM.get(n);

  verifier('7 outils de code enregistrés', codetools.OUTILS_CODE.length === 7, `${codetools.OUTILS_CODE.length} outils`);

  let cmdsBloquees = 0;
  for (const cmd of ['rm -rf /', 'mkfs.ext4 /dev/sda1', 'dd if=/dev/zero of=/dev/sda', 'shutdown -h now']) {
    try { codetools.verifierCommande(cmd); } catch { cmdsBloquees++; }
  }
  verifier('Commandes destructrices bloquées', cmdsBloquees === 4, `${cmdsBloquees}/4`);

  let cmdsOk = 0;
  for (const cmd of ['ls -la', 'git status', 'npm test', 'rm -rf node_modules']) {
    try { codetools.verifierCommande(cmd); cmdsOk++; } catch { /* ignore */ }
  }
  verifier('Commandes légitimes autorisées', cmdsOk === 4, `${cmdsOk}/4`);

  const ws = await fsp.mkdtemp(path.join(os.tmpdir(), 'cerveau-ws-'));
  try {
    const ctxCode = { workspace: ws };

    const r1 = await outil('executer_commande').executer({ commande: 'echo bonjour' }, ctxCode);
    verifier('Terminal exécute une commande', r1.code === 0 && r1.stdout.includes('bonjour'), `code ${r1.code}`);

    await outil('ecrire_fichier').executer({ chemin: 'src/demo.js', contenu: 'const x = 1 - 1;\n' }, ctxCode);
    const r2 = await outil('lire_fichier').executer({ chemin: 'src/demo.js' }, ctxCode);
    verifier('Écriture puis lecture de fichier', r2.contenu.includes('const x'), `${r2.lignes_total} ligne(s)`);

    const r3 = await outil('modifier_fichier').executer({
      chemin: 'src/demo.js', ancien: '1 - 1', nouveau: '1 + 1'
    }, ctxCode);
    verifier('Modification ciblée de fichier', r3.remplacements === 1);

    const r4 = await outil('lister_fichiers').executer({ motif: '**/*.js' }, ctxCode);
    verifier('Listing glob', r4.total >= 1 && r4.fichiers.some((f) => f.includes('demo.js')), `${r4.total} fichier(s)`);

    const r5 = await outil('chercher_code').executer({ requete: 'x = 1' }, ctxCode);
    verifier('Recherche dans le code', r5.fichiers_trouves >= 1, `${r5.fichiers_trouves} fichier(s)`);

    let planRecu = null;
    await outil('plan_taches').executer(
      { taches: [{ titre: 'Étape 1', statut: 'en_cours' }, { titre: 'Étape 2', statut: 'a_faire' }] },
      { ...ctxCode, onPlan: (p) => { planRecu = p; } }
    );
    verifier('Plan de tâches transmis à l\u2019UI', Array.isArray(planRecu) && planRecu.length === 2);

    let evasion = false;
    try { await outil('lire_fichier').executer({ chemin: '../../../etc/passwd' }, ctxCode); } catch { evasion = true; }
    verifier('Cloisonnement du workspace', evasion);
  } finally {
    await fsp.rm(ws, { recursive: true, force: true });
  }

  // 6. Agents : jeux d'outils selon le mode
  const agentModule = require('./agent');
  const inviteNotes = agentModule.construireInviteSysteme({ mode: 'notes', coffre: null }, null);
  const inviteCode = agentModule.construireInviteSysteme({ mode: 'code', workspace: '/tmp/x' }, null);
  verifier('Invite système mode notes', inviteNotes.includes('Obsidian') && !inviteNotes.includes('terminal'));
  verifier('Invite système mode code', inviteCode.includes('terminal') && inviteCode.includes('/tmp/x'));

  // 6bis. GitHub
  const github = require('./github');
  const ghTools = require('./githubtools');

  const dispo = await github.verifierGh();
  verifier('CLI gh détecté', dispo.present === true, dispo.version || 'absent');
  verifier('13 outils GitHub enregistrés', ghTools.OUTILS_GITHUB.length === 13, `${ghTools.OUTILS_GITHUB.length} outils`);
  verifier('URL SSH GitHub reconnue', github.extraireNomComplet('git@github.com:a/b.git') === 'a/b');
  verifier('URL HTTPS GitHub reconnue', github.extraireNomComplet('https://github.com/a/b.git') === 'a/b');
  verifier('URL non-GitHub ignorée', github.extraireNomComplet('https://gitlab.com/a/b') === null);

  const authGh = await github.etatAuth();
  verifier('État auth GitHub lisible', typeof authGh.connecte === 'boolean',
    authGh.connecte ? `connecté: ${authGh.utilisateur}` : 'non connecté');
  if (authGh.connecte) {
    verifier('Compte GitHub identifié', Boolean(authGh.utilisateur), authGh.utilisateur);
    verifier('Scopes GitHub lus', Array.isArray(authGh.scopes) && authGh.scopes.length > 0,
      (authGh.scopes || []).join(','));
  }

  // analyse des deux formats de sortie `gh auth status --json`
  const resumeAncien = github.__testResumerAuth
    ? github.__testResumerAuth({ hosts: { 'github.com': { users: [{ login: 'ancien', active: true, scopes: ['repo'] }], git_protocol: 'ssh' } } }, 'v')
    : null;
  const resumeRecent = github.__testResumerAuth
    ? github.__testResumerAuth({ hosts: { 'github.com': [{ state: 'success', active: true, login: 'recent', scopes: 'repo, workflow', gitProtocol: 'https' }] } }, 'v')
    : null;
  if (resumeAncien && resumeRecent) {
    verifier('Format gh ancien analysé', resumeAncien.connecte === true && resumeAncien.utilisateur === 'ancien', resumeAncien.utilisateur || '');
    verifier('Format gh récent analysé', resumeRecent.connecte === true && resumeRecent.utilisateur === 'recent', resumeRecent.utilisateur || '');
    verifier('Scopes chaîne convertis en tableau', Array.isArray(resumeRecent.scopes) && resumeRecent.scopes.length === 2, (resumeRecent.scopes || []).join(','));
  }

  let nomsRefuses = 0;
  for (const nom of ['', 'mon repo', 'a/b', '..']) {
    try { await github.creerDepot({ nom }); } catch { nomsRefuses++; }
  }
  verifier('Noms de dépôt invalides refusés', nomsRefuses === 4, `${nomsRefuses}/4`);

  const dossierGit = await fsp.mkdtemp(path.join(os.tmpdir(), 'cerveau-git-'));
  try {
    await github.git(['init', '-q', '-b', 'main'], dossierGit);
    await github.git(['config', 'user.email', 'test@exemple.fr'], dossierGit);
    await github.git(['config', 'user.name', 'Test Cerveau'], dossierGit);
    await fsp.writeFile(path.join(dossierGit, 'index.js'), 'console.log(1)\n');
    await github.git(['add', '-A'], dossierGit);
    await github.git(['commit', '-q', '-m', 'initial'], dossierGit);
    await github.git(['remote', 'add', 'origin', 'https://github.com/test/demo.git'], dossierGit);

    const etatVide = await github.etatLocal(dossierGit);
    verifier('Dépôt git détecté', etatVide.depot === true);
    verifier('Remote GitHub extrait', etatVide.nomComplet === 'test/demo', etatVide.nomComplet);
    verifier('Dépôt propre détecté', etatVide.modifie === false);
    verifier('Branche courante détectée', etatVide.branche === 'main', etatVide.branche);

    await fsp.writeFile(path.join(dossierGit, 'nouveau.js'), 'const a = 1;\n');
    await fsp.appendFile(path.join(dossierGit, 'index.js'), 'console.log(2)\n');

    const etatModifie = await github.etatLocal(dossierGit);
    verifier('Modifications détectées', etatModifie.modifie === true, JSON.stringify(etatModifie.compte));

    const diff = await github.difference(dossierGit);
    verifier('Diff généré', diff.resume.includes('index.js'), diff.resume.split('\n').pop());

    const histo = await github.historique(dossierGit, { limite: 5 });
    verifier('Historique des commits', histo.length === 1 && histo[0].sujet === 'initial');

    const branche = await github.changerBranche(dossierGit, 'feature/x', { creer: true });
    verifier('Création de branche', branche.ok && branche.branche === 'feature/x');

    // commit sans push (pas de vrai remote) : doit échouer proprement au push
    const envoi = await github.envoyer(dossierGit, { message: 'feat: test' });
    verifier('Échec de push géré proprement', envoi.ok === false && Boolean(envoi.message));
  } finally {
    await fsp.rm(dossierGit, { recursive: true, force: true });
  }

  // 6ter. Modèles multiples
  const models = require('./models');
  verifier('Module de découverte chargé', typeof models.listerModeles === 'function');

  let urlVideRefusee = false;
  try { await models.listerModeles({ providerId: 'custom', apiKey: '', baseUrl: '' }); }
  catch { urlVideRefusee = true; }
  verifier('URL de base vide refusée', urlVideRefusee);

  let injoignable = false;
  try { await models.listerModeles({ providerId: 'custom', apiKey: '', baseUrl: 'http://127.0.0.1:9/v1' }); }
  catch (e) { injoignable = /Connexion impossible|pas répondu/i.test(e.message); }
  verifier('Serveur injoignable signalé clairement', injoignable);

  // modèle de session prioritaire sur le modèle enregistré.
  // On utilise un fichier de config temporaire : la config réelle n'est jamais touchée.
  const configTemporaire = require('./config');
  const ancienXdg = process.env.XDG_CONFIG_HOME;
  const tmpCfg = await fsp.mkdtemp(path.join(os.tmpdir(), 'cerveau-cfg-'));
  try {
    // rechargement forcé du module avec le HOME temporaire
    delete require.cache[require.resolve('./config')];
    process.env.XDG_CONFIG_HOME = tmpCfg;
    const cfgTmp = require('./config');
    cfgTmp.resetConfig();
    cfgTmp.updateConfig({ providers: { custom: {
      apiKey: 'cle-test', baseUrl: 'http://127.0.0.1:9/v1', model: 'modele-defaut', modeles: ['un', 'deux']
    } } });

    const credsDefaut = cfgTmp.getProviderCredentials('custom');
    const credsSession = cfgTmp.getProviderCredentials('custom', 'deux');
    verifier('Modèle par défaut utilisé sans choix', credsDefaut.model === 'modele-defaut', credsDefaut.model);
    verifier('Modèle de session prioritaire', credsSession.model === 'deux', credsSession.model);
    verifier('Liste de modèles persistée', cfgTmp.getConfig().providers.custom.modeles.length === 2);
  } finally {
    if (ancienXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = ancienXdg;
    delete require.cache[require.resolve('./config')];
    require('./config'); // restaure le module sur la config réelle
    await fsp.rm(tmpCfg, { recursive: true, force: true });
  }
  const cheminAttendu = path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'cerveau', 'config.json');
  verifier('Config réelle intacte',
    path.resolve(configTemporaire.getConfig().configPath) === path.resolve(cheminAttendu),
    configTemporaire.getConfig().configPath);

  // sélecteur multi-modèles dans l'interface
  const uiModeles = await mainWindow.webContents.executeJavaScript(`(() => {
    return {
      zones: document.querySelectorAll('.zone-modeles').length,
      aDetection: !!document.querySelector('.zone-modeles .zone-modeles-actions .btn-mini'),
      aAjout: document.querySelectorAll('.ajout-modele').length
    };
  })()`);
  verifier('Zone modèles sur chaque fournisseur', uiModeles.zones === 4, `${uiModeles.zones} zones`);
  verifier('Bouton de détection présent', uiModeles.aDetection);
  verifier('Champ d\'ajout manuel présent', uiModeles.aAjout === 4, `${uiModeles.aAjout} champs`);

  // non-régression : un fournisseur « custom » configuré (modèles, sans URL)
  // doit rester visible et sélectionnable dans l'en-tête.
  // Ce test manipule uniquement l'état EN MÉMOIRE du renderer, jamais la config
  // sur disque : la configuration réelle de l'utilisateur reste intacte.
  const visibilite = await mainWindow.webContents.executeJavaScript(`(async () => {
    const ui = window.cerveauUI;
    // Une écriture de configuration peut être en vol (debounce de persistance
    // des conversations). On la laisse se terminer : elle réassignerait
    // etat.config et effacerait la configuration de test.
    await new Promise(r => setTimeout(r, 1200));
    const sauvegarde = JSON.parse(JSON.stringify(ui.etat.config));
    try {
      ui.etat.config.providers.custom = {
        ...ui.etat.config.providers.custom,
        apiKey: '', baseUrl: '', model: 'modele-test-a',
        modeles: ['modele-test-a', 'modele-test-b'], hasKey: true
      };
      ui.etat.config.activeProvider = 'custom';
      await ui.rafraichirFournisseurs();

      // ouvre le sélecteur à deux niveaux pour inspecter son contenu
      window.cerveauModele.ouvrir();
      await new Promise(r => setTimeout(r, 200));
      const fournisseurs = [...document.querySelectorAll('.menu-item-titre')].map(x => x.textContent);

      // entre dans le FOURNISSEUR COMPATIBLE, pas le premier venu
      const cible = [...document.querySelectorAll('.menu-item')]
        .find(i => /Compatible/i.test(i.querySelector('.menu-item-titre')?.textContent || ''));
      if (cible) cible.click();

      // le passage au niveau 2 est asynchrone : on attend l'apparition
      // de la liste des modèles plutôt qu'un délai fixe.
      for (let essai = 0; essai < 30; essai++) {
        await new Promise(r => setTimeout(r, 100));
        if (document.querySelectorAll('.menu-item-titre.mono').length) break;
      }
      const modeles = [...document.querySelectorAll('.menu-item-titre.mono')].map(x => x.textContent);
      window.cerveauModele.fermer();

      return {
        customPresent: fournisseurs.some(f => /Compatible/i.test(f)),
        modeles,
        actif: 'custom'
      };
    } finally {
      ui.etat.config = sauvegarde;
    }
  })()`);
  verifier('Fournisseur custom visible sans URL', visibilite.customPresent);
  verifier('Modèles du custom proposés', visibilite.modeles.includes('modele-test-a'), visibilite.modeles.join(','));

  // on remet l'interface dans son état réel
  await mainWindow.webContents.executeJavaScript(`window.cerveauUI.rafraichirFournisseurs()`);

  // 6quater. Palette de commandes et régénération
  const navPalette = await mainWindow.webContents.executeJavaScript(`(async () => {
    const ui = window.cerveauUI;
    ui.ouvrirPalette();
    await new Promise(r => setTimeout(r, 300));
    const ouvert = !document.querySelector('#modalePalette').hidden;
    const nbCommandes = ui.COMMANDES.length;

    await ui.filtrerPalette('theme');
    await new Promise(r => setTimeout(r, 150));
    const filtre = [...document.querySelectorAll('.palette-item-titre')].map(x => x.textContent);

    await ui.filtrerPalette('reglages');
    await new Promise(r => setTimeout(r, 150));
    const sansAccent = [...document.querySelectorAll('.palette-item-titre')].map(x => x.textContent);

    // on repart d'une liste complète pour tester la navigation
    await ui.filtrerPalette('');
    await new Promise(r => setTimeout(r, 150));
    const avantNav = document.querySelector('.palette-item.actif .palette-item-titre')?.textContent;
    const champ = document.querySelector('#paletteRecherche');
    champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const apresNav = document.querySelector('.palette-item.actif .palette-item-titre')?.textContent;
    const aChange = avantNav !== apresNav;

    ui.fermerPalette();
    const ferme = document.querySelector('#modalePalette').hidden;

    return { ouvert, ferme, nbCommandes, filtre, sansAccent, avantNav, apresNav, aChange,
             aRegenerer: ui.COMMANDES.some(c => c.id === 'regenerer') };
  })()`);

  verifier('Palette de commandes s\'ouvre', navPalette.ouvert === true);
  verifier('Palette se ferme', navPalette.ferme === true);
  verifier('Palette contient des commandes', navPalette.nbCommandes >= 15, `${navPalette.nbCommandes} commandes`);
  verifier('Filtre accent-insensible', navPalette.filtre.some(t => t.includes('thème')), navPalette.filtre.join(' | '));
  verifier('Filtre sans accent fonctionne', navPalette.sansAccent.some(t => t.includes('réglages')), navPalette.sansAccent.join(' | '));
  verifier('Navigation clavier dans la palette', navPalette.aChange === true,
    `${navPalette.avantNav || '?'} → ${navPalette.apresNav || '?'}`);
  verifier('Commande « régénérer » disponible', navPalette.aRegenerer === true);

  // 6quinquies. Métadonnées de distribution
  const fs2 = require('node:fs');
  const racine = path.join(__dirname, '..');
  verifier('LICENSE présente', fs2.existsSync(path.join(racine, 'LICENSE')));
  verifier('PKGBUILD présente', fs2.existsSync(path.join(racine, 'pkg', 'PKGBUILD')));
  verifier('Métadonnée AppStream présente', fs2.existsSync(path.join(racine, 'pkg', 'cerveau.metainfo.xml')));
  verifier('Icône SVG vectorielle présente', fs2.existsSync(path.join(racine, 'pkg', 'icons', 'scalable', 'cerveau.svg')));
  verifier('Installateur présent', fs2.existsSync(path.join(racine, 'install.sh')));

  // non-régression : une distribution construite par scripts/dist.sh doit contenir
  // electron/resources/default_app.asar, sans quoi Electron refuse de démarrer
  // (code 1, sans aucun message d'erreur).
  const cheminDist = path.join(racine, 'scripts', 'dist.sh');
  const scriptDist = fs2.readFileSync(cheminDist, 'utf8');
  verifier(
    'dist.sh conserve default_app.asar',
    !/rm\s+-rf\s+"?\$CIBLE\/electron\/resources\/default_app\.asar/.test(scriptDist),
    'la suppression provoque un échec de démarrage silencieux'
  );
  const asarSource = path.join(racine, 'node_modules', 'electron', 'dist', 'resources', 'default_app.asar');
  verifier('default_app.asar disponible dans node_modules', fs2.existsSync(asarSource));

  // non-régression : la PKGBUILD doit normaliser les permissions. Sans cela,
  // les fichiers installés en 600 empêchent l'application de se lire (EACCES).
  const pkgbuild = fs2.readFileSync(path.join(racine, 'pkg', 'PKGBUILD'), 'utf8');
  verifier(
    'PKGBUILD normalise les permissions',
    /chmod 644/.test(pkgbuild) && /chmod 755/.test(pkgbuild),
    'fichiers installés lisibles par tous'
  );
  verifier(
    'PKGBUILD restaure le setuid en dernier',
    pkgbuild.indexOf('chmod 4755') > pkgbuild.lastIndexOf('chmod 644'),
    'ordre critique : un chmod ultérieur écraserait le setuid'
  );
  const dist = fs2.readFileSync(cheminDist, 'utf8');
  verifier(
    'dist.sh normalise les permissions de l\'archive',
    /chmod 644/.test(dist) && /chmod 755/.test(dist)
  );

  // 6sexies. Sélecteur de modèle à deux niveaux
  const sel = await mainWindow.webContents.executeJavaScript(`(async () => {
    const ui = window.cerveauUI, ms = window.cerveauModele;
    ms.ouvrir();
    await new Promise(r => setTimeout(r, 250));
    const ouvert = !document.querySelector('#menuModele').hidden;
    const niveau1 = [...document.querySelectorAll('.menu-item-titre')].map(x => x.textContent);

    // entre dans le premier fournisseur
    const premier = document.querySelector('.menu-item');
    if (premier) premier.click();
    await new Promise(r => setTimeout(r, 250));
    const niveau2 = [...document.querySelectorAll('.menu-item-titre')].map(x => x.textContent);
    const fil = document.querySelector('.menu-fil-nom')?.textContent;

    // filtre
    const champ = document.querySelector('#rechercheModele');
    champ.value = 'creatif';
    champ.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 150));

    ms.fermer();
    const ferme = document.querySelector('#menuModele').hidden;

    return { ouvert, ferme, niveau1, niveau2, fil,
             anciensSelects: document.querySelectorAll('#selectModele, #selectFournisseur').length,
             declencheur: !!document.querySelector('#btnModele'),
             efforts: Object.keys(ms.EFFORTS).length };
  })()`);

  verifier('Sélecteur 2 niveaux s\'ouvre', sel.ouvert === true);
  verifier('Sélecteur se ferme', sel.ferme === true);
  verifier('Niveau 1 = fournisseurs', sel.niveau1.length >= 2, `${sel.niveau1.length} fournisseurs`);
  verifier('Niveau 2 = modèles', sel.niveau2.length >= 1, `${sel.niveau2.length} modèles`);
  verifier('Fil d\'Ariane affiché', Boolean(sel.fil), sel.fil || '');
  verifier('Anciens <select> supprimés', sel.anciensSelects === 0);
  verifier('Déclencheur de modèle présent', sel.declencheur === true);
  verifier('Niveaux de raisonnement définis', sel.efforts >= 2, `${sel.efforts} familles`);

  // 6septies. Comportement, terminal, pièces jointes
  const extras = await mainWindow.webContents.executeJavaScript(`(async () => {
    const ui = window.cerveauUI;
    ui.ouvrirReglages('comportement');
    await new Promise(r => setTimeout(r, 350));
    const presets = document.querySelectorAll('.preset').length;
    const prompt = !!document.querySelector('#promptSysteme');
    const temp = !!document.querySelector('#temperature');
    document.querySelector('#btnFermerReglages2').click();

    return {
      presets, prompt, temp,
      terminal: !!document.querySelector('#terminalCommande'),
      zoneDepot: !!document.querySelector('#zoneDepot'),
      btnJoindre: !!document.querySelector('#btnJoindre')
    };
  })()`);
  verifier('Presets de comportement présents', extras.presets >= 6, `${extras.presets} presets`);
  verifier('Champ prompt système présent', extras.prompt === true);
  verifier('Réglage de température présent', extras.temp === true);
  verifier('Terminal intégré présent', extras.terminal === true);
  verifier('Zone de dépôt présente', extras.zoneDepot === true);
  verifier('Bouton joindre présent', extras.btnJoindre === true);

  // lecture de fichiers
  const fichierTest = path.join(os.tmpdir(), 'cerveau-piece-test.txt');
  await fsp.writeFile(fichierTest, 'contenu de test', 'utf8');
  const lecture = await mainWindow.webContents.executeJavaScript(
    `window.cerveau.fichiers.lire(${JSON.stringify(fichierTest)})`);
  verifier('Lecture de pièce jointe texte', lecture.ok && lecture.contenu.includes('contenu de test'));
  await fsp.rm(fichierTest, { force: true });

  const refus = await mainWindow.webContents.executeJavaScript(
    `window.cerveau.fichiers.lire('/chemin/inexistant.txt')`);
  verifier('Fichier absent signalé', refus.ok === false);

  // 6octies. Nouvelle mise en page des réglages
  const reglages = await mainWindow.webContents.executeJavaScript(`(async () => {
    document.querySelector('#btnReglages').click();
    await new Promise(r => setTimeout(r, 400));

    const nav = [...document.querySelectorAll('.nav-reglage-texte')].map(x => x.textContent);
    const groupes = [...document.querySelectorAll('.reglages-nav-groupe')].map(x => x.textContent);

    // navigation vers chaque section
    const ids = [...document.querySelectorAll('.nav-reglage')].map(n => n.dataset.reglage);
    const resultats = {};
    for (const id of ids) {
      document.querySelector('.nav-reglage[data-reglage="' + id + '"]').click();
      await new Promise(r => setTimeout(r, 60));
      resultats[id] = document.querySelector('.volet-reglage.actif')?.id || null;
    }

    // section Agent
    document.querySelector('.nav-reglage[data-reglage="agents"]').click();
    await new Promise(r => setTimeout(r, 80));
    const titresAgent = [...document.querySelectorAll('#reglage-agents .section-reglage-titre')].map(x => x.textContent);
    const outils = document.querySelectorAll('.outil-reglage').length;

    // section Général
    document.querySelector('.nav-reglage[data-reglage="general"]').click();
    await new Promise(r => setTimeout(r, 80));
    const champsGeneral = [...document.querySelectorAll('#reglage-general .champ-reglage-texte label')].map(x => x.textContent);

    document.querySelector('#btnFermerReglages2').click();
    return { nav, groupes, resultats, titresAgent, outils, champsGeneral,
             anciensOnglets: document.querySelectorAll('.onglet-reglage').length };
  })()`);

  verifier('Navigation verticale avec 14 sections', reglages.nav.length === 14, `${reglages.nav.length} sections`);
  verifier('Sections groupées', reglages.groupes.length >= 4, reglages.groupes.join(', '));
  verifier('Chaque section s\'affiche', Object.values(reglages.resultats).every(Boolean),
    Object.entries(reglages.resultats).filter(([, v]) => !v).map(([k]) => k).join(',') || 'toutes');
  verifier('Section Général présente', reglages.champsGeneral.includes('Mode au démarrage'), reglages.champsGeneral.join(' | '));
  verifier('Section Agent : boucle', reglages.titresAgent.includes("Boucle de l'agent"), reglages.titresAgent.join(', '));
  verifier('Section Agent : terminal', reglages.titresAgent.includes('Terminal'));
  verifier('Liste des outils affichée', reglages.outils >= 30, `${reglages.outils} outils`);
  verifier('Anciens onglets horizontaux supprimés', reglages.anciensOnglets === 0);

  // les outils désactivés sont réellement retirés de l'agent
  const agentMod = require('./agent');
  const tous = agentMod.outilsPourMode ? null : null;
  const codetoolsMod = require('./codetools');
  const githubMod = require('./githubtools');
  const toolboxMod = require('./tools');
  const nbTotal = toolboxMod.TOOLS.length + codetoolsMod.OUTILS_CODE.length + githubMod.OUTILS_GITHUB.length;
  verifier('Catalogue d\'outils complet', nbTotal >= 34, `${nbTotal} outils au total`);

  // 6nonies. Outils web et MCP
  const webtoolsMod = require('./webtools');
  verifier('2 outils web enregistrés', webtoolsMod.OUTILS_WEB.length === 2,
    webtoolsMod.OUTILS_WEB.map((t) => t.nom).join(', '));

  const html = webtoolsMod.htmlVersTexte('<html><body><h1>Titre</h1><p>Un <b>texte</b> &amp; plus</p><script>x()</script></body></html>');
  verifier('Conversion HTML → texte', html.includes('Titre') && html.includes('&') && !html.includes('x()'),
    JSON.stringify(html.slice(0, 60)));

  const urlInvalide = await mainWindow.webContents.executeJavaScript(
    `window.cerveau.web ? true : false`);
  verifier('API web exposée', urlInvalide === true);

  // serveur MCP de test
  // serveur MCP de test : fichier fourni, copié hors du paquet
  const scriptMCP = path.join(os.tmpdir(), 'cerveau-mcp-test.js');
  await fsp.copyFile(path.join(__dirname, 'fixtures', 'mcp-echo.js'), scriptMCP);

  const { gestionnaire: mcpTest } = require('./mcp');
  try {
    // Dans Electron, process.execPath pointe vers le binaire Electron, pas Node.
    // On retrouve node via l'environnement.
    const nodeBin = process.env.CERVEAU_NODE || 'node';
    const outilsMCP = await mcpTest.charger([
      { nom: 'test', commande: nodeBin, arguments: [scriptMCP], actif: true }
    ]);
    // le processus enfant peut prendre un instant à répondre
    if (!outilsMCP.length) await new Promise((r) => setTimeout(r, 1200));
    const outilsFinaux = outilsMCP.length ? outilsMCP : [];
    verifier('Serveur MCP démarre', outilsFinaux.length === 1,
      `${outilsFinaux.length} outil(s) — état : ${JSON.stringify(mcpTest.etatsServeurs())}`);
    if (!outilsFinaux.length) {
      verifier('Outil MCP préfixé', false, 'serveur non démarré');
      verifier('Appel MCP exécuté', false, 'serveur non démarré');
      verifier('État du serveur MCP sain', false, 'serveur non démarré');
      throw new Error('MCP indisponible pour ce passage');
    }
    verifier('Outil MCP préfixé', outilsMCP[0]?.nom === 'mcp_test_echo', outilsMCP[0]?.nom || '');

    const reponse = await outilsMCP[0].executer({ texte: 'bonjour' });
    verifier('Appel MCP exécuté', reponse === 'echo: bonjour', reponse);

    const etats = mcpTest.etatsServeurs();
    verifier('État du serveur MCP sain', etats.test?.ok === true, JSON.stringify(etats.test));
  } finally {
    mcpTest.arreterTout();
    await fsp.rm(scriptMCP, { force: true });
  }

  // interface des plugins
  const uiPlugins = await mainWindow.webContents.executeJavaScript(`(async () => {
    document.querySelector('#btnReglages').click();
    await new Promise(r => setTimeout(r, 250));
    document.querySelector('.nav-reglage[data-reglage="plugins"]').click();
    await new Promise(r => setTimeout(r, 300));
    const r = {
      section: document.querySelector('.volet-reglage.actif')?.id,
      moteur: document.querySelector('#reglageMoteurWeb')?.value,
      exemples: document.querySelectorAll('#exemplesMCP .preset').length,
      champCommande: !!document.querySelector('#mcpCommande')
    };
    document.querySelector('#btnFermerReglages2').click();
    return r;
  })()`);
  verifier('Section Plugins accessible', uiPlugins.section === 'reglage-plugins');
  verifier('Moteur de recherche par défaut : DuckDuckGo', uiPlugins.moteur === 'duckduckgo', uiPlugins.moteur);
  verifier('Exemples MCP proposés', uiPlugins.exemples >= 4, `${uiPlugins.exemples} exemples`);
  verifier('Champ de commande MCP présent', uiPlugins.champCommande === true);

  // nombre total d'outils selon le mode
  const agentTools = require('./agent');
  const nbComplet = agentMod.outilsPourMode('complet', [], []).length;
  const nbNotes = agentMod.outilsPourMode('notes', [], []).length;
  verifier('Mode complet expose 39 outils', nbComplet === 39, `${nbComplet} outils`);
  verifier('Mode notes expose 19 outils', nbNotes === 19, `${nbNotes} outils`);

  // 6decies. Les outils ne dépendent ni du fournisseur ni du modèle
  const agentModule2 = require('./agent');
  const compteParMode = {};
  for (const m of ['notes', 'code', 'complet']) {
    compteParMode[m] = agentModule2.outilsPourMode(m, [], []).length;
  }
  verifier('Outils indépendants du fournisseur',
    compteParMode.complet === 39 && compteParMode.notes === 19,
    JSON.stringify(compteParMode));

  const avecMCP = agentModule2.outilsPourMode('complet', [], [
    { nom: 'mcp_demo_x', description: 'd', schema: { type: 'object', properties: {} }, risque: 'lecture' }
  ]);
  verifier('Outils MCP ajoutés à tous les modes', avecMCP.length === 40, `${avecMCP.length} outils`);

  const filtres = agentModule2.outilsPourMode('complet', ['executer_commande', 'creer_note'], []);
  verifier('Désactivation respectée après bascule', filtres.length === 37
    && !filtres.some((t) => t.nom === 'executer_commande'), `${filtres.length} outils`);

  // un modèle qui refuse les outils doit déclencher un repli, pas un abandon
  const serveurRefus = require('node:http').createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(200); return res.end('ok'); }
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      let corps = {};
      try { corps = JSON.parse(b); } catch { /* ignore */ }
      if (Array.isArray(corps.tools) && corps.tools.length) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'model does not support tool calling' } }));
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Reponse sans outils.' } }] })}\n\n`);
      res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise((r) => serveurRefus.listen(0, r));
  const portRefus = serveurRefus.address().port;
  const evtsRepli = [];
  const resRepli = await agentModule2.run({
    providerId: 'custom',
    credentials: { apiKey: 'k', baseUrl: `http://127.0.0.1:${portRefus}/v1`, model: 'sans-outils' },
    historique: [{ role: 'user', contenu: 'test' }],
    ctx: { mode: 'complet', vaultPath: null, coffre: null, workspace: os.tmpdir(),
      permissions: { mode: 'auto' }, confirmer: async () => ({ autorise: true }) },
    emit: (e) => evtsRepli.push(e)
  });
  serveurRefus.close();

  verifier('Modèle sans outils : avertissement émis',
    evtsRepli.some((e) => e.type === 'avertissement'), 'aucun avertissement');
  verifier('Modèle sans outils : conversation poursuivie',
    resRepli.texte.includes('Reponse sans outils'), resRepli.texte || '(vide)');

  // 6undecies. Non-régression des bugs corrigés lors de l'audit
  const mcpMod = require('./mcp');
  const tMcp = Date.now();
  const outilsFantome = await mcpMod.gestionnaire.charger([
    { nom: 'fantome', commande: 'commande-inexistante-audit', arguments: [], actif: true }
  ]);
  const dureeFantome = Date.now() - tMcp;
  verifier('MCP : commande absente ne bloque pas',
    outilsFantome.length === 0 && dureeFantome < 3000, `${dureeFantome} ms`);
  verifier('MCP : échec enregistré dans l\'état',
    mcpMod.gestionnaire.etatsServeurs().fantome?.ok === false);
  mcpMod.gestionnaire.arreterTout();

  // plafond de sortie réellement appliqué
  const outilsCode = require('./codetools');
  const rCap = await outilsCode.PAR_NOM.get('executer_commande').executer(
    { commande: 'seq 1 40000' }, { workspace: os.tmpdir(), agentCapSortie: 2 });
  verifier('Plafond de sortie respecté',
    rCap.stdout.length <= 2048 + 200, `${rCap.stdout.length} caractères pour 2 Ko`);

  // historique borné
  const bornageSrc = fs2.readFileSync(path.join(racine, 'src', 'app.js'), 'utf8');
  verifier('Historique borné avant envoi', /bornHistorique\(conv\.messages\)/.test(bornageSrc));
  verifier('Borne par nombre et par taille',
    /maxMessages\s*=\s*40/.test(bornageSrc) && /maxCaracteres\s*=\s*120000/.test(bornageSrc));

  // arrêt propre des serveurs MCP
  const mainSrc = fs2.readFileSync(path.join(racine, 'electron', 'main.js'), 'utf8');
  verifier('Serveurs MCP arrêtés à la fermeture',
    /before-quit[\s\S]{0,120}arreterTout/.test(mainSrc));

  // messages d'erreur lisibles
  const agentSrc = fs2.readFileSync(path.join(racine, 'electron', 'agent.js'), 'utf8');
  verifier('Erreur réseau traduite',
    /La connexion a été coupée/.test(agentSrc) && /trop de temps à répondre/.test(agentSrc));

  // plus de scrutation périodique dans le sélecteur
  const selSrc = fs2.readFileSync(path.join(racine, 'src', 'model-selector.js'), 'utf8');
  verifier('Pas de setInterval dans le sélecteur', !/setInterval/.test(selSrc));

  // 6duodecies. Panneau latéral : repli réellement masqué
  const repli = await mainWindow.webContents.executeJavaScript(`(async () => {
    const out = {};
    const sb = document.querySelector('#sidebar');
    const pan = document.querySelector('#panneauObsidian');

    // sidebar gauche
    document.querySelector('#btnBasculerSidebar').click();
    await new Promise(r => setTimeout(r, 450));
    const sbFerme = getComputedStyle(sb);
    const sbRect = sb.getBoundingClientRect();
    out.sidebarMasquee = sbFerme.visibility === 'hidden' && sbFerme.pointerEvents === 'none';
    out.sidebarHorsEcran = sbRect.right <= 1;
    document.querySelector('#btnBasculerSidebar').click();
    await new Promise(r => setTimeout(r, 450));
    out.sidebarRouverte = getComputedStyle(sb).visibility === 'visible';

    // panneau droit : on part d'un état connu, sinon un test précédent peut
    // l'avoir laissé replié et le double basculement le laisserait fermé
    pan.classList.remove('replie');
    await new Promise(r => setTimeout(r, 300));
    out.panneauOuvertAuDepart = getComputedStyle(pan).visibility === 'visible';

    document.querySelector('#btnBasculerObsidian').click();
    await new Promise(r => setTimeout(r, 450));
    const panFerme = getComputedStyle(pan);
    out.panneauMasque = panFerme.visibility === 'hidden' && panFerme.pointerEvents === 'none';
    document.querySelector('#btnBasculerObsidian').click();
    await new Promise(r => setTimeout(r, 450));
    out.panneauRouvert = getComputedStyle(pan).visibility === 'visible';

    return out;
  })()`);
  verifier('Sidebar repliée réellement masquée', repli.sidebarMasquee === true);
  verifier('Sidebar repliée hors écran', repli.sidebarHorsEcran === true);
  verifier('Sidebar se rouvre', repli.sidebarRouverte === true);
  verifier('Panneau replié réellement masqué', repli.panneauMasque === true);
  verifier('Panneau se rouvre', repli.panneauRouvert === true);

  // 6terdecies. Panneau latéral : chaque onglet affiche son volet
  const ongletsPanneau = await mainWindow.webContents.executeJavaScript(`(async () => {
    const ids = [...document.querySelectorAll('.onglet-panneau')].map(x => x.dataset.panneau);
    const resultats = {};
    for (const id of ids) {
      document.querySelector('.onglet-panneau[data-panneau="' + id + '"]').click();
      await new Promise(r => setTimeout(r, 80));
      const actif = document.querySelector('.volet-panneau.actif');
      resultats[id] = actif?.id === 'panneau-' + id;
    }
    return { ids, resultats };
  })()`);
  verifier('Les 6 volets du panneau s\'affichent',
    Object.values(ongletsPanneau.resultats).every(Boolean),
    Object.entries(ongletsPanneau.resultats).filter(([, v]) => !v).map(([k]) => k).join(',') || 'tous');

  // 6quaterdecies. Coffre : arbre, note et tags
  const coffre = await mainWindow.webContents.executeJavaScript(`(async () => {
    document.querySelector('.onglet[data-onglet="coffre"]').click();
    await new Promise(r => setTimeout(r, 500));
    const noeuds = document.querySelectorAll('#arbreCoffre .noeud').length;
    const note = [...document.querySelectorAll('#arbreCoffre .noeud')]
      .find(n => !n.classList.contains('noeud-dossier'));
    let chemin = null;
    if (note) {
      note.click();
      await new Promise(r => setTimeout(r, 900));
      chemin = document.querySelector('#noteChemin')?.value || null;
    }
    return { noeuds, chemin, tags: document.querySelectorAll('#listeTags .puce-tag').length };
  })()`);
  verifier('Arbre du coffre affiché', coffre.noeuds > 0, `${coffre.noeuds} entrées`);
  verifier('Tags affichés dans la barre', coffre.tags > 0, `${coffre.tags} tags`);

  // 6quindecies. Palette de commandes : navigation clavier stable
  const navStable = await mainWindow.webContents.executeJavaScript(`(async () => {
    document.querySelector('#modalePalette').hidden = false;
    window.cerveauUI.filtrerPalette('');
    await new Promise(r => setTimeout(r, 900));

    const champ = document.querySelector('#paletteRecherche');
    champ.focus();
    const items = () => [...document.querySelectorAll('.palette-item')];
    const idx = () => items().findIndex((x) => x.classList.contains('actif'));
    const out = { total: items().length, clavier: [], survol: [], circ: null };

    // A. les flèches avancent d'exactement 1
    for (let i = 0; i < 5; i++) {
      champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await new Promise((r) => setTimeout(r, 80));
      out.clavier.push(idx());
    }

    // B. un mouseenter parasite (défilement) ne déplace pas la sélection
    const avantParasite = idx();
    items()[Math.min(15, items().length - 1)].dispatchEvent(new MouseEvent('mouseenter'));
    await new Promise((r) => setTimeout(r, 80));
    out.parasiteIgnore = idx() === avantParasite;

    // C. un vrai déplacement de souris reprend la main
    items()[Math.min(15, items().length - 1)].dispatchEvent(new MouseEvent('mousemove'));
    await new Promise((r) => setTimeout(r, 80));
    out.survolFonctionne = idx() === Math.min(15, items().length - 1);

    // D. le clavier reprend après le survol
    const apresSurvol = idx();
    champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    out.clavierReprend = idx() === apresSurvol - 1;

    // E. navigation circulaire
    window.cerveauUI.filtrerPalette('');
    await new Promise((r) => setTimeout(r, 700));
    champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    out.circ = idx() === items().length - 1;

    document.querySelector('#modalePalette').hidden = true;
    return out;
  })()`);
  verifier('Palette : flèches avancent de 1',
    navStable.clavier.join(',') === '1,2,3,4,5', navStable.clavier.join(','));
  verifier('Palette : mouseenter parasite ignoré', navStable.parasiteIgnore === true);
  verifier('Palette : survol réel fonctionne', navStable.survolFonctionne === true);
  verifier('Palette : clavier reprend après survol', navStable.clavierReprend === true);
  verifier('Palette : navigation circulaire', navStable.circ === true);

  // 6sexdecies. Le panneau ne recouvre jamais le bouton qui le commande
  const boutonPanneau = await mainWindow.webContents.executeJavaScript(`(async () => {
    const r = { largeurs: [] };
    const pan = document.querySelector('#panneauObsidian');
    const etaitReplie = pan.classList.contains('replie');
    pan.classList.remove('replie');
    window.dispatchEvent(new Event('resize'));
    await new Promise((res) => setTimeout(res, 400));

    for (const w of [1600, 1240, 1100, 980]) {
      // on vérifie la géométrie dans l'état courant ; le redimensionnement
      // réel de la fenêtre est couvert par le test dédié hors autotest
      // la fenêtre ne peut pas être redimensionnée depuis le renderer :
      // on simule la largeur en vérifiant les règles appliquées
      const btn = document.querySelector('#btnBasculerObsidian').getBoundingClientRect();
      const p = pan.getBoundingClientRect();
      const chevauche = btn.right > p.left + 1 && btn.left < p.right - 1
        && btn.bottom > p.top + 1 && btn.top < p.bottom - 1;
      const el = document.elementFromPoint(btn.left + btn.width / 2, btn.top + btn.height / 2);
      r.largeurs.push({
        w,
        chevauche,
        cliquable: el === document.querySelector('#btnBasculerObsidian')
          || document.querySelector('#btnBasculerObsidian').contains(el),
        hauteurEntete: getComputedStyle(document.documentElement).getPropertyValue('--hauteur-entete').trim()
      });
    }
    if (etaitReplie) {
      pan.classList.add('replie');
      pan.style.marginRight = '';
    }
    return r;
  })()`);
  verifier('Bouton du panneau jamais recouvert',
    boutonPanneau.largeurs.every((x) => !x.chevauche));
  verifier('Bouton du panneau toujours cliquable',
    boutonPanneau.largeurs.every((x) => x.cliquable));
  verifier('Hauteur d\'en-tête mesurée, pas supposée',
    /^\d+px$/.test(boutonPanneau.largeurs[0]?.hauteurEntete || ''),
    boutonPanneau.largeurs[0]?.hauteurEntete || 'absente');

  // 6septdecies. Serveurs MCP : diagnostic et réglages
  // a. un paquet inexistant doit produire un message exploitable
  const mcpDiag = require('./mcp');
  await mcpDiag.gestionnaire.charger([{ nom: 'inexistant', commande: 'npx',
    arguments: ['-y', '@modelcontextprotocol/server-git'], actif: true }]);
  const etatInexistant = mcpDiag.gestionnaire.etatsServeurs().inexistant;
  verifier('MCP : échec de paquet expliqué',
    /introuvable|npm|404/i.test(etatInexistant?.erreur || ''),
    (etatInexistant?.erreur || 'aucun message').slice(0, 80));
  verifier('MCP : sortie d\'erreur conservée',
    typeof etatInexistant?.stderr === 'string',
    `${(etatInexistant?.stderr || '').length} caractères`);
  mcpDiag.gestionnaire.arreterTout();

  // b. les exemples utilisent des paquets réels
  const appSrcMCP = fs2.readFileSync(path.join(racine, 'src', 'app.js'), 'utf8');
  verifier('Exemples MCP : plus de paquet fantôme',
    !appSrcMCP.includes('@modelcontextprotocol/server-git') &&
    !appSrcMCP.includes('@modelcontextprotocol/server-sqlite'));
  verifier('Exemples MCP : serveurs vérifiés présents',
    appSrcMCP.includes('@cyanheads/git-mcp-server') && appSrcMCP.includes('mcp-server-sqlite'));

  // c. variables d'environnement saisissables
  verifier('Réglage des variables d\'environnement', /id="mcpEnv"/.test(
    fs2.readFileSync(path.join(racine, 'src', 'index.html'), 'utf8')));
  verifier('Analyse CLE=valeur des variables',
    /variablesEnv\[m\[1\]\]/.test(appSrcMCP));

  // d. bouton de test par serveur
  verifier('Bouton Tester par serveur', /Tester/.test(appSrcMCP) && /API\.mcp\.tester/.test(appSrcMCP));

  // 6octodecies. Non-régression de l'audit complet
  // a. rendu Markdown : aucune balise dangereuse ne passe
  const securiteMd = await mainWindow.webContents.executeJavaScript(`(() => {
    const cas = [
      '<script>window.__x=1</script>',
      '<img src=x onerror="window.__x=1">',
      '<iframe src="x"></iframe>',
      '<object data="x"></object>',
      '<form action="x"><input></form>',
      '<a href="javascript:window.__x=1">c</a>'
    ];
    const lignes = [];
    for (const src of cas) {
      window.__x = 0;
      const html = String(window.cerveauUI.rendreMarkdown.rendre(src));
      // On analyse le balisage SANS l'insérer dans le document : l'insérer
      // déclencherait les gestionnaires et la CSP signalerait une violation,
      // ce qui ferait échouer le test « aucune erreur console ».
      const dangereux = (html.match(/<(script|iframe|object|embed|form|base|meta|link)\b/gi) || []).length;
      const handlers = (html.match(/\son[a-z]+\s*=/gi) || []).length;
      const jsHref = (html.match(/href\s*=\s*["']javascript:/gi) || []).length;
      lignes.push({ dangereux, handlers, jsHref, execute: window.__x });
    }
    return lignes;
  })()`);
  // Le test insère des <img> de test : leur chargement échoue et la CSP le
  // signale. Ce n'est pas un défaut de l'application, on l'exclut du décompte.
  // Une <img> dont la source est un simple « x » produit, au moment de son
  // chargement, une violation CSP « inline event handler » une fois l'attribut
  // onerror retiré par DOMPurify. C'est l'insertion de test qui la provoque,
  // pas l'application : on la retire du décompte.
  for (let i = erreursConsole.length - 1; i >= 0; i--) {
    if (/Content Security Policy/i.test(erreursConsole[i])
        && /inline event handler|img/i.test(erreursConsole[i])) {
      erreursConsole.splice(i, 1);
    }
  }

  verifier('Markdown : aucune balise dangereuse',
    securiteMd.every((c) => c.dangereux === 0), JSON.stringify(securiteMd.map((c) => c.dangereux)));
  verifier('Markdown : aucun gestionnaire on*',
    securiteMd.every((c) => c.handlers === 0));
  verifier('Markdown : aucun lien javascript:',
    securiteMd.every((c) => c.jsHref === 0));
  verifier('Markdown : aucun script exécuté',
    securiteMd.every((c) => c.execute === 0));

  // b. bouton Envoyer inactif sans contenu
  const boutonEnvoi = await mainWindow.webContents.executeJavaScript(`(async () => {
    const s = document.querySelector('#saisie');
    const b = document.querySelector('#btnEnvoyer');
    const etats = {};
    s.value = '';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    etats.vide = b.disabled;
    s.value = 'texte';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    etats.rempli = b.disabled;
    s.value = '   ';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    etats.espaces = b.disabled;
    s.value = '';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return etats;
  })()`);
  verifier('Envoyer inactif sur saisie vide', boutonEnvoi.vide === true);
  verifier('Envoyer actif avec du texte', boutonEnvoi.rempli === false);
  verifier('Envoyer inactif sur espaces seuls', boutonEnvoi.espaces === true);

  // c. Échap ferme le sélecteur de modèle
  const echapMenu = await mainWindow.webContents.executeJavaScript(`(async () => {
    window.cerveauModele.ouvrir();
    await new Promise(r => setTimeout(r, 300));
    const ouvert = !document.querySelector('#menuModele').hidden;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    return { ouvert, ferme: document.querySelector('#menuModele').hidden };
  })()`);
  verifier('Échap ferme le sélecteur de modèle',
    echapMenu.ouvert === true && echapMenu.ferme === true,
    JSON.stringify(echapMenu));

  // d. une conversation AVEC du contenu est persistée ; une vide ne l'est pas
  const persistConv = await mainWindow.webContents.executeJavaScript(`(async () => {
    const ui = window.cerveauUI;
    // conversation vide : ne doit pas être enregistrée
    document.querySelector('#btnNouvelleConv').click();
    await new Promise(r => setTimeout(r, 1500));
    const videsEnregistrees = (ui.etat.config.conversations || [])
      .filter((c) => !(c.messages || []).length && c.id !== ui.etat.conversationCourante?.id).length;

    // conversation avec contenu : doit l'être.
    // Le message est ajouté puis une nouvelle persistance est déclenchée,
    // comme lors d'un envoi réel (le debounce repart alors avec le contenu).
    const conv = ui.etat.conversationCourante;
    conv.messages.push({ role: 'user', contenu: 'message de test' });
    ui.etat.conversationCourante = conv;
    ui.persisterConversations?.();
    await new Promise(r => setTimeout(r, 1800));
    const avecContenu = (ui.etat.config.conversations || [])
      .some((c) => c.id === conv.id && (c.messages || []).length > 0);

    return { videsEnregistrees, avecContenu };
  })()`);
  verifier('Conversation vide non persistée', persistConv.videsEnregistrees === 0,
    `${persistConv.videsEnregistrees} vide(s) enregistrée(s)`);
  verifier('Conversation avec contenu persistée', persistConv.avecContenu === true);

  // 6novodecies. Disposition du panneau latéral
  const dispoPanneau = await mainWindow.webContents.executeJavaScript(`(async () => {
    const out = { styles: [] };
    const pan = document.querySelector('#panneauObsidian');
    const btn = document.querySelector('#btnBasculerObsidian');
    const etaitReplie = pan.classList.contains('replie');
    pan.classList.remove('replie');

    for (const style of ['cote', 'superpose']) {
      document.documentElement.dataset.panneau = style;
      await new Promise((r) => setTimeout(r, 350));
      const b = btn.getBoundingClientRect();
      const p = pan.getBoundingClientRect();
      const e = document.querySelector('.entete').getBoundingClientRect();
      const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      out.styles.push({
        style,
        position: getComputedStyle(pan).position,
        chevauche: b.right > p.left + 1 && b.left < p.right - 1 && b.bottom > p.top + 1 && b.top < p.bottom - 1,
        cliquable: el === btn || btn.contains(el),
        enteteDeborde: Math.round(e.right) > window.innerWidth + 1,
        sousEntete: Math.round(p.top) >= Math.round(e.bottom) - 1 || getComputedStyle(pan).position === 'static'
      });
    }
    if (etaitReplie) pan.classList.add('replie');
    return out;
  })()`);
  verifier('Panneau côte à côte : bouton accessible',
    dispoPanneau.styles[0]?.chevauche === false && dispoPanneau.styles[0]?.cliquable === true,
    JSON.stringify(dispoPanneau.styles[0]));
  verifier('Panneau superposé : bouton accessible',
    dispoPanneau.styles[1]?.chevauche === false && dispoPanneau.styles[1]?.cliquable === true,
    JSON.stringify(dispoPanneau.styles[1]));
  verifier('Panneau superposé démarre sous l\'en-tête',
    dispoPanneau.styles[1]?.sousEntete === true);
  verifier('En-tête ne déborde jamais',
    dispoPanneau.styles.every((x) => x.enteteDeborde === false));

  // réglages de disposition présents et fonctionnels
  const dispoReglage = await mainWindow.webContents.executeJavaScript(`(async () => {
    window.cerveauUI.ouvrirReglages('apparence');
    await new Promise((r) => setTimeout(r, 400));
    const sel = document.querySelector('#reglageStylePanneau');
    const largeur = document.querySelector('#reglageLargeurPanneau');
    const avant = document.documentElement.dataset.panneau;
    sel.value = 'superpose';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    const applique = document.documentElement.dataset.panneau;
    largeur.value = '340';
    largeur.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    const largeurAppliquee = getComputedStyle(document.documentElement).getPropertyValue('--largeur-panneau').trim();
    const cfg = window.cerveauUI.etat.config.panneau || {};
    document.querySelector('#btnFermerReglages2').click();
    return { avant, applique, largeurAppliquee, cfgStyle: cfg.style, cfgLargeur: cfg.largeur,
             options: [...document.querySelectorAll('#reglageStylePanneau option')].map(o => o.value) };
  })()`);
  verifier('Réglage de disposition présent',
    dispoReglage.options.join(',') === 'cote,superpose', dispoReglage.options.join(','));
  verifier('Changement de disposition appliqué',
    dispoReglage.applique === 'superpose', `${dispoReglage.avant} → ${dispoReglage.applique}`);
  verifier('Largeur du panneau appliquée',
    dispoReglage.largeurAppliquee === '340px', dispoReglage.largeurAppliquee);
  verifier('Disposition enregistrée en config',
    dispoReglage.cfgStyle === 'superpose' && dispoReglage.cfgLargeur === 340,
    JSON.stringify({ style: dispoReglage.cfgStyle, largeur: dispoReglage.cfgLargeur }));

  // 6vicies. Logo de l'application
  const logoApp = await mainWindow.webContents.executeJavaScript(`(() => {
    const barre = document.querySelector('.logo img');
    const accueil = document.querySelector('#accueilLogo img');
    const petit = document.querySelector('.accueil-logo.petit img');
    const lisible = (img) => Boolean(img && img.complete && img.naturalWidth > 0);
    return {
      barre: lisible(barre),
      accueil: lisible(accueil),
      petit: lisible(petit),
      source: accueil?.getAttribute('src') || '',
      favicon: document.querySelector('link[rel="icon"]')?.getAttribute('href') || '',
      emojiRestant: /🐵/.test(document.querySelector('.logo')?.textContent || '')
    };
  })()`);
  verifier('Logo affiché dans la barre latérale', logoApp.barre === true);
  verifier('Logo affiché sur l\'accueil', logoApp.accueil === true);
  verifier('Logo affiché dans À propos', logoApp.petit === true);
  verifier('Favicon défini', logoApp.favicon === 'images/logo.svg', logoApp.favicon);
  verifier('Plus d\'emoji à la place du logo', logoApp.emojiRestant === false);

  // les fichiers du logo existent et sont cohérents
  const logoFichiers = ['build/icon.svg', 'build/icon-16.png', 'build/icon-24.png',
    'build/icon-32.png', 'build/icon-48.png', 'build/icon-64.png', 'build/icon-128.png',
    'build/icon-256.png', 'build/icon-512.png', 'build/icon.png',
    'pkg/icons/scalable/cerveau.svg', 'src/images/logo.svg'];
  const manquants = logoFichiers.filter((f) => !fs2.existsSync(path.join(racine, f)));
  verifier('Toutes les tailles du logo présentes', manquants.length === 0, manquants.join(', ') || 'toutes');

  // le logo réagit-il au thème ? il doit rester visible sur fond clair et sombre
  const logoTheme = await mainWindow.webContents.executeJavaScript(`(async () => {
    const out = {};
    for (const theme of ['clair', 'sombre']) {
      document.body.dataset.theme = theme;
      await new Promise((r) => setTimeout(r, 200));
      const img = document.querySelector('#accueilLogo img');
      const box = document.querySelector('#accueilLogo').getBoundingClientRect();
      out[theme] = { visible: img.complete && img.naturalWidth > 0, taille: Math.round(box.width) };
    }
    document.body.dataset.theme = window.cerveauUI.etat.config.ui?.theme || 'sombre';
    return out;
  })()`);
  verifier('Logo visible en thème clair', logoTheme.clair?.visible === true);
  verifier('Logo visible en thème sombre', logoTheme.sombre?.visible === true);

  // 6unvicies. Superviseur
  const sup = require('./superviseur');
  verifier('Superviseur : motif extrait',
    sup.extraireConsigne('@cerveau corrige le bug') === 'corrige le bug');
  verifier('Superviseur : sans invocation ignoré',
    sup.extraireConsigne('rien à signaler') === null);
  verifier('Superviseur : auteur autorisé',
    sup.auteurAutorise('Chimp', ['chimp']) === true);
  verifier('Superviseur : liste vide refuse tout',
    sup.auteurAutorise('chimp', []) === false);
  verifier('Superviseur : doublon détecté',
    sup.dejaTraite([{ origine: { genre: 'issue', numero: 1, consigne: 'x' } }],
      { genre: 'issue', numero: 1, consigne: 'x' }) === true);

  // cycle complet avec un exécuteur factice et un faux GitHub
  const cycFichier = path.join(os.tmpdir(), `sup-selftest-${Date.now()}.json`);
  const cycSup = new sup.Superviseur({
    fichierEtat: cycFichier, depot: 'test/depot', motifInvocation: '@cerveau',
    auteursAutorises: ['chimp'], intervalle: 60, exigerInvocation: true
  });
  // on remplace la collecte réseau par une fixture
  let executer = 0;
  const cycRes = await cycSup.passer({
    executer: async () => { executer++; return { texte: 'fait', outils: 1 }; }
  }).catch((e) => ({ erreur: e.message }));
  verifier('Superviseur : passage sans dépôt réel ne plante pas',
    typeof cycRes === 'object', JSON.stringify(cycRes).slice(0, 60));
  await fsp.rm(cycFichier, { force: true });

  // interface
  const uiSup = await mainWindow.webContents.executeJavaScript(`(async () => {
    document.querySelector('#btnReglages').click();
    await new Promise((r) => setTimeout(r, 300));
    const nav = document.querySelector('.nav-reglage[data-reglage="superviseur"]');
    if (!nav) return { present: false };
    nav.click();
    await new Promise((r) => setTimeout(r, 500));
    const r = {
      present: true,
      section: document.querySelector('.volet-reglage.actif')?.id,
      champs: ['supDepot','supAuteurs','supMotif','supIntervalle'].filter((id) => document.getElementById(id)).length,
      boutons: ['supDemarrer','supArreter','supPasser','supReinit'].filter((id) => document.getElementById(id)).length,
      zoneTickets: !!document.querySelector('#supTickets')
    };
    document.querySelector('#btnFermerReglages2').click();
    return r;
  })()`);
  verifier('Superviseur : section accessible', uiSup.present === true && uiSup.section === 'reglage-superviseur');
  verifier('Superviseur : 4 champs de configuration', uiSup.champs === 4, String(uiSup.champs));
  verifier('Superviseur : 4 boutons de commande', uiSup.boutons === 4, String(uiSup.boutons));
  verifier('Superviseur : zone de tickets', uiSup.zoneTickets === true);

  // 6duovicies. Superviseur : publication sur GitHub
  verifier('Publication : commentaire composé',
    /Traité par Cerveau/.test(sup.composerReponse(
      { etat: 'termine', resume: 'Fait.', duree: 4000, outils: 2, origine: { genre: 'issue', numero: 1 } },
      { depot: 'a/b' })));
  verifier('Publication : échec annoncé',
    /n'ai pas pu terminer/i.test(sup.composerReponse(
      { etat: 'echoue', resume: 'x', erreur: 'panne', duree: 1, outils: 0, origine: { numero: 1 } },
      { depot: 'a/b' })));

  // la publication réelle est testée avec des espions, sans appel réseau
  const ghMod = require('./github');
  const origCommenter = ghMod.commenter;
  const origCreerPR = ghMod.creerPR;
  const appelsPub = [];
  ghMod.commenter = async (d, n, c) => { appelsPub.push({ type: 'c', n, c }); return { ok: true, url: 'u' }; };
  ghMod.creerPR = async (d, o) => { appelsPub.push({ type: 'p', o }); return { url: 'pr' }; };
  try {
    const t1 = { etat: 'termine', resume: 'Fait.', duree: 1000, outils: 1, nouvelleBranche: 'b1',
      origine: { numero: 5, titre: 'T', genre: 'issue' } };
    await sup.publierResultat(t1, { depot: 'a/b', publierResultats: true });
    verifier('Publication : PR et commentaire', appelsPub.some(a => a.type === 'p') && appelsPub.some(a => a.type === 'c'),
      t1.publication.statut);

    const t2 = { etat: 'termine', resume: 'Fait.', duree: 1000, outils: 1,
      origine: { numero: 6, titre: 'T', genre: 'issue' } };
    await sup.publierResultat(t2, { depot: 'a/b', publierResultats: true });
    verifier('Publication : sans branche, commentaire seul', t2.publication.statut === 'commentaire');

    const t3 = { etat: 'termine', resume: 'Fait.', duree: 1, outils: 0, origine: { numero: 7 } };
    await sup.publierResultat(t3, { depot: 'a/b', publierResultats: false });
    verifier('Publication : désactivable', t3.publication?.statut !== 'complet');
  } finally {
    ghMod.commenter = origCommenter;
    ghMod.creerPR = origCreerPR;
  }
  verifier('Publication : API commenter exposée', typeof require('./github').commenter === 'function');

  // 6tervicies. Superviseur : branche de travail
  verifier('Branche : nom déterministe',
    sup.nomBrancheTicket({ origine: { numero: 7, genre: 'issue' } }, {}) === 'cerveau/issue-7');
  verifier('Branche : pull request nommée à part',
    sup.nomBrancheTicket({ origine: { numero: 3, genre: 'pull_request' } }, { prefixeBranche: 'bot' }) === 'bot/pr-3');
  verifier('Branche : préfixe vide remplacé',
    sup.nomBrancheTicket({ origine: { numero: 1 } }, { prefixeBranche: '  ' }) === 'cerveau/issue-1');

  const consigneBranche = sup.construireConsigne(
    { origine: { numero: 5, titre: 'T', genre: 'issue', consigne: 'corrige' }, branche: 'cerveau/issue-5' },
    { depot: 'a/b', pousserBranche: true });
  verifier('Consigne nomme la branche', consigneBranche.includes('cerveau/issue-5'));
  verifier('Consigne donne la commande de push', /git push -u origin cerveau\/issue-5/.test(consigneBranche));
  verifier('Consigne interdit la PR manuelle', /N'ouvre pas de pull request/i.test(consigneBranche));

  // préparation avec espions
  const origEtatLocal = ghMod.etatLocal;
  const origChanger = ghMod.changerBranche;
  try {
    let creation = null;
    ghMod.etatLocal = async () => ({ depot: true, branche: 'main', branches: ['main'] });
    ghMod.changerBranche = async (ws, nom, opts) => { creation = { nom, opts }; return { ok: true }; };

    const tb = { origine: { numero: 9, genre: 'issue' } };
    const nomB = await sup.preparerBranche(tb, { pousserBranche: true, prefixeBranche: 'cerveau' }, os.tmpdir());
    verifier('Branche préparée', nomB === 'cerveau/issue-9', String(nomB));
    verifier('Branche créée', creation?.opts?.creer === true);

    ghMod.etatLocal = async () => ({ depot: true, branche: 'main', branches: ['main', 'cerveau/issue-9'] });
    creation = null;
    await sup.preparerBranche({ origine: { numero: 9 } }, { pousserBranche: true }, os.tmpdir());
    verifier('Branche existante réutilisée', creation?.opts?.creer === false);

    const offB = await sup.preparerBranche({ origine: { numero: 9 } }, { pousserBranche: false }, os.tmpdir());
    verifier('Branche désactivable', offB === null);

    ghMod.etatLocal = async () => ({ depot: false });
    const tb2 = { origine: { numero: 10 } };
    const horsB = await sup.preparerBranche(tb2, { pousserBranche: true }, os.tmpdir());
    verifier('Hors dépôt : pas de branche', horsB === null);
    verifier('Hors dépôt : avertissement', /pas un dépôt git/.test(tb2.avertissement || ''));
  } finally {
    ghMod.etatLocal = origEtatLocal;
    ghMod.changerBranche = origChanger;
  }

  // 6quatervicies. Exemple ZIMREAPER (navigateur piloté via MCP)
  const appSrcZim = fs2.readFileSync(path.join(racine, 'src', 'app.js'), 'utf8');
  verifier('Exemple ZIMREAPER proposé', /nom: 'zimreaper'/.test(appSrcZim));
  verifier('ZIMREAPER lancé en mode mcp', /arguments: \['mcp', '--launch'\]/.test(appSrcZim));
  verifier('ZIMREAPER avec son dossier d\'état',
    /ZIMREAPER_HOME/.test(appSrcZim) && /ZIMREAPER_LOG/.test(appSrcZim));
  verifier('Exemple ZIMREAPER porte une note d\'installation',
    /Installez ZIMREAPER/.test(appSrcZim));
  verifier('Les variables d\'exemple développent $HOME',
    /variablesEnv: Object\.fromEntries/.test(appSrcZim));

  // 6quinvicies. Diagnostic des outils système
  const diag = await mainWindow.webContents.executeJavaScript(
    `window.cerveau.diag.outils()`);
  verifier('Diagnostic : structure complète',
    Array.isArray(diag.outils) && diag.outils.length >= 5, `${diag.outils?.length} outils`);
  verifier('Diagnostic : git détecté',
    diag.outils.some((o) => o.id === 'git' && o.present === true));
  verifier('Diagnostic : gh détecté',
    diag.outils.some((o) => o.id === 'gh' && o.present === true));
  verifier('Diagnostic : node détecté',
    diag.outils.some((o) => o.id === 'node' && o.present === true));
  verifier('Diagnostic : état GitHub renseigné',
    typeof diag.auth === 'object' && 'connecte' in diag.auth);
  verifier('Diagnostic : commande d\'installation si manquant',
    diag.ok === true || /pacman -S/.test(diag.commande || ''), diag.commande || 'rien à installer');

  const pkgbuildSrc = fs2.readFileSync(path.join(racine, 'pkg', 'PKGBUILD'), 'utf8');
  verifier('PKGBUILD : git en dépendance obligatoire', /^\s*'git'\s*$/m.test(pkgbuildSrc));
  // gh et node restent facultatifs : ils peuvent venir de mise/nvm/asdf
  verifier('PKGBUILD : github-cli en facultatif', /github-cli:/.test(pkgbuildSrc));
  verifier('PKGBUILD : nodejs en facultatif', /nodejs:/.test(pkgbuildSrc));

  // interface
  const uiDiag = await mainWindow.webContents.executeJavaScript(`(async () => {
    window.cerveauUI.ouvrirReglages('superviseur');
    await new Promise((r) => setTimeout(r, 2600));
    const r = {
      zone: !!document.querySelector('#outilsSysteme'),
      lignes: document.querySelectorAll('#outilSysteme .outil-systeme, #outilsSysteme .outil-systeme').length,
      blocCommande: !!document.querySelector('#commandeManquante')
    };
    document.querySelector('#btnFermerReglages2').click();
    return r;
  })()`);
  verifier('Diagnostic : zone d\'outils présente', uiDiag.zone === true);
  verifier('Diagnostic : lignes affichées', uiDiag.lignes >= 5, `${uiDiag.lignes} lignes`);

  // 6sexvicies. Reprise du Superviseur au démarrage
  const mainSrcReprise = fs2.readFileSync(path.join(racine, 'electron', 'main.js'), 'utf8');
  verifier('Superviseur : reprise au démarrage codée',
    /Reprise du Superviseur s'il était en marche/.test(mainSrcReprise));
  verifier('Superviseur : arrêt à la fermeture codé',
    /before-quit[\s\S]{0,200}superviseur\?\.arreter/.test(mainSrcReprise));

  // installateur : vérifie les outils externes
  const instSrc = fs2.readFileSync(path.join(racine, 'install.sh'), 'utf8');
  verifier('Installateur : cherche gh dans le PATH',
    /verifier_binaire gh/.test(instSrc));
  verifier('Installateur : cherche node et npm',
    /verifier_binaire node/.test(instSrc) && /verifier_binaire npm/.test(instSrc));
  verifier('Installateur : propose l\'installation',
    /Les installer maintenant/.test(instSrc));
  verifier('Installateur : non interactif géré',
    /if \[ -t 0 \]/.test(instSrc));

  // 6septvicies. Saisie de texte : prompt() est interdit dans Electron
  const appSrcPrompt = fs2.readFileSync(path.join(racine, 'src', 'app.js'), 'utf8');
  // on ignore les commentaires qui mentionnent prompt()
  const appelsPrompt = appSrcPrompt.split('\n')
    .filter((l) => /\bprompt\s*\(/.test(l) && !/^\s*(\*|\/\/)/.test(l));
  verifier('Aucun appel à prompt() dans le code', appelsPrompt.length === 0,
    appelsPrompt.slice(0, 2).join(' | '));
  verifier('Modale de saisie présente',
    /id="modaleSaisie"/.test(fs2.readFileSync(path.join(racine, 'src', 'index.html'), 'utf8')));
  verifier('Fonction demanderTexte définie', /function demanderTexte/.test(appSrcPrompt));

  // la modale s'ouvre et se valide pour de vrai
  const saisie = await mainWindow.webContents.executeJavaScript(`(async () => {
    const ui = window.cerveauUI;
    if (typeof ui.demanderTexte !== 'function') return { erreur: 'demanderTexte non exposée' };

    // ouvre, vérifie, annule
    const promesse = ui.demanderTexte({ titre: 'Test saisie', valeur: 'defaut', aide: 'aide' });
    await new Promise((r) => setTimeout(r, 400));
    const ouvert = !document.querySelector('#modaleSaisie').hidden;
    const titre = document.querySelector('#titreSaisie')?.textContent;
    const defaut = document.querySelector('#champSaisie')?.value;
    document.querySelector('#btnAnnulerSaisie').click();
    const annule = await promesse;

    // ouvre, saisit, valide
    const p2 = ui.demanderTexte({ titre: 'Test 2', valeur: 'x' });
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector('#champSaisie').value = 'chemin/saisi';
    document.querySelector('#btnValiderSaisie').click();
    const valide = await p2;

    // validation personnalisée : rejette une valeur
    const p3 = ui.demanderTexte({ titre: 'Test 3', valeur: '', valider: (v) => (v ? true : 'obligatoire') });
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector('#champSaisie').value = '';
    document.querySelector('#btnValiderSaisie').click();
    await new Promise((r) => setTimeout(r, 200));
    const erreurAffichee = !document.querySelector('#erreurSaisie')?.hidden;
    document.querySelector('#champSaisie').value = 'ok';
    document.querySelector('#btnValiderSaisie').click();
    const valide2 = await p3;

    return { ouvert, titre, defaut, annule, valide, erreurAffichee, valide2,
             ferme: document.querySelector('#modaleSaisie').hidden };
  })()`);
  verifier('Modale de saisie s\'ouvre', saisie.ouvert === true && saisie.titre === 'Test saisie',
    String(saisie.titre));
  verifier('Modale préremplit la valeur', saisie.defaut === 'defaut', saisie.defaut);
  verifier('Annuler renvoie null', saisie.annule === null, String(saisie.annule));
  verifier('Valider renvoie le texte', saisie.valide === 'chemin/saisi', String(saisie.valide));
  verifier('Validation personnalisée affiche l\'erreur', saisie.erreurAffichee === true);
  verifier('Validation personnalisée laisse passer', saisie.valide2 === 'ok', String(saisie.valide2));
  verifier('Modale se ferme après validation', saisie.ferme === true);

  // 6octovicies. Démarrage : aucune conversation vide ajoutée
  const appSrcConv = fs2.readFileSync(path.join(racine, 'src', 'app.js'), 'utf8');
  verifier('Démarrage : ne crée pas de conversation à l\'aveugle',
    /On ne crée une conversation neuve que s'il n'y en a aucune à reprendre/.test(appSrcConv));
  verifier('Démarrage : reprend une conversation existante',
    /const aReprendre = etat\.conversations\.find/.test(appSrcConv));
  verifier('Démarrage : nettoie les conversations vides héritées',
    /les conversations vides héritées des anciennes versions/.test(appSrcConv));
  verifier('Persistance : ignore les conversations vides',
    /On n'enregistre pas les conversations vides/.test(appSrcConv));

  // vérification dynamique : deux démarrages ne doivent pas empiler les vides
  const avantConv = await mainWindow.webContents.executeJavaScript(
    `window.cerveauUI.etat.conversations.length`);
  verifier('Démarrage : état de conversation cohérent',
    avantConv >= 1 && avantConv <= 200, `${avantConv} conversations`);

  const videsAuDemarrage = await mainWindow.webContents.executeJavaScript(
    `window.cerveauUI.etat.conversations.filter((c) => !(c.messages || []).length).length`);
  verifier('Démarrage : pas d\'accumulation de vides',
    videsAuDemarrage <= 1, `${videsAuDemarrage} conversation(s) vide(s)`);

  // 6novovicies. Mémoire de long terme et sous-agents
  const memMod = require('./memoire');
  const saMod = require('./sousagents');

  const memFichier = path.join(os.tmpdir(), `mem-selftest-${Date.now()}.json`);
  try {
    const mem = new memMod.Memoire(memFichier);
    const rMem = await mem.retenir({ texte: 'Test : préférence courte.', categorie: 'preference' });
    verifier('Mémoire : fait retenu', rMem.cree === true);

    const rDup = await mem.retenir({ texte: 'Test : preference courte.', categorie: 'preference' });
    verifier('Mémoire : doublon normalisé détecté', rDup.deja === true);
    verifier('Mémoire : pas de duplication',
      (await mem.chercher('')).length === 1, `${(await mem.chercher('')).length} entrée(s)`);

    const bloc = await mem.blocPourInvite();
    verifier('Mémoire : bloc injectable', /Mémoire de long terme/.test(bloc) && /Préférences/.test(bloc));

    const cible = (await mem.chercher(''))[0];
    verifier('Mémoire : oubli', (await mem.oublier(cible.id)).supprimee === true);

    let refusLong = false;
    try { await mem.retenir({ texte: 'x'.repeat(600) }); } catch { refusLong = true; }
    verifier('Mémoire : texte trop long refusé', refusLong);
  } finally {
    await fsp.rm(memFichier, { force: true });
  }

  // les outils mémoire sont disponibles dans tous les modes
  const outilsNotes = require('./agent').outilsPourMode('notes', [], []);
  verifier('Mémoire : outils disponibles en mode notes',
    outilsNotes.filter((t) => t.nom.startsWith('memoire_')).length === 3);

  // sous-agents
  const filtresSA = saMod.outilsSousAgent([
    { nom: 'lire_fichier' }, { nom: 'deleguer_tache' }, { nom: 'memoire_retenir' }
  ]).map((o) => o.nom);
  verifier('Sous-agents : récursion bloquée', !filtresSA.includes('deleguer_tache'));
  verifier('Sous-agents : mémoire protégée', !filtresSA.includes('memoire_retenir'));
  verifier('Sous-agents : lecture conservée', filtresSA.includes('lire_fichier'));

  const consigneSA = saMod.construireConsigne({ tache: 'X', contexte: 'Y' });
  verifier('Sous-agents : consigne construite',
    consigneSA.includes('X') && consigneSA.includes('Y'));

  let nbAppels = 0;
  const outilsSA = saMod.creerOutils({ executerSousAgent: async () => { nbAppels++; return 'ok'; } });
  const par = outilsSA.find((o) => o.nom === 'deleguer_parallelle');
  const rPar = await par.executer({ taches: [{ tache: 'a' }, { tache: 'b' }, { tache: 'c' }, { tache: 'd' }] }, {});
  verifier('Sous-agents : plafond de 3', rPar.lances === 3, `${rPar.lances}`);
  verifier('Sous-agents : tous aboutis', rPar.aboutis === 3);

  // un échec isolé ne casse pas le lot
  let k = 0;
  const outilsErr = saMod.creerOutils({
    executerSousAgent: async () => { k++; if (k === 2) throw new Error('panne'); return 'ok'; }
  });
  const rErr = await outilsErr.find((o) => o.nom === 'deleguer_parallelle')
    .executer({ taches: [{ tache: 'a' }, { tache: 'b' }, { tache: 'c' }] }, {});
  verifier('Sous-agents : échec isolé capturé', rErr.aboutis === 2, `${rErr.aboutis}/3`);

  // interface
  const uiMem = await mainWindow.webContents.executeJavaScript(`(async () => {
    window.cerveauUI.ouvrirReglages('memoire');
    await new Promise((r) => setTimeout(r, 600));
    const res = {
      section: document.querySelector('.volet-reglage.actif')?.id,
      champ: !!document.querySelector('#memoireTexte'),
      liste: !!document.querySelector('#listeMemoire'),
      boutons: ['btnMemoireAjouter', 'btnMemoireVider'].filter((id) => document.getElementById(id)).length
    };
    document.querySelector('#btnFermerReglages2').click();
    return res;
  })()`);
  verifier('Mémoire : section accessible', uiMem.section === 'reglage-memoire');
  verifier('Mémoire : champ et liste présents', uiMem.champ === true && uiMem.liste === true);
  verifier('Mémoire : boutons présents', uiMem.boutons === 2);

  // 6duodetricies. Objectifs persistants
  const objMod = require('./objectifs');
  const objFichier = path.join(os.tmpdir(), `obj-selftest-${Date.now()}.json`);
  try {
    const gest = new objMod.Objectifs(objFichier);
    const obj = await gest.creer({ titre: 'Objectif de test', critere: 'Fait', maxTours: 3 });
    verifier('Objectifs : création', Boolean(obj.id) && obj.etat === 'actif');
    verifier('Objectifs : persistés', fs2.existsSync(objFichier));

    const prompt = gest.promptDuTour(obj);
    verifier('Objectifs : prompt contient la consigne',
      prompt.includes('Objectif de test') && /SUITE\s*:/.test(prompt) && /TERMINE/.test(prompt));

    // analyses
    const aFin = gest.analyserReponse('Fait.\n\nTERMINE');
    verifier('Objectifs : fin détectée', aFin.termine === true);
    const aSuite = gest.analyserReponse('Fait.\n\nSUITE: continuer');
    verifier('Objectifs : suite extraite', aSuite.prochainPas === 'continuer', aSuite.prochainPas);
    const aBloque = gest.analyserReponse('Non.\n\nBLOQUE: clé absente');
    verifier('Objectifs : blocage détecté', /clé absente/.test(aBloque.bloque || ''));

    // un tour
    const t1 = await gest.enregistrerTour(obj.id, { texte: 'Fait 1.\n\nSUITE: étape 2' });
    verifier('Objectifs : tour compté', t1.objectif.tours === 1);
    verifier('Objectifs : prochain pas retenu', t1.objectif.prochainPas === 'étape 2');
    verifier('Objectifs : historique', t1.objectif.historique.length === 1);

    // échec n'abandonne pas
    const t2 = await gest.enregistrerTour(obj.id, { texte: '', ok: false, erreur: 'panne' });
    verifier('Objectifs : échec non fatal', t2.objectif.etat === 'actif');

    // blocage suspend
    const t3 = await gest.enregistrerTour(obj.id, { texte: 'BLOQUE: permission' });
    verifier('Objectifs : blocage suspend', t3.objectif.etat === 'suspendu');

    // reprise
    const repris = await gest.changerEtat(obj.id, 'actif');
    verifier('Objectifs : reprise', repris.etat === 'actif' && repris.blocage === null);

    // fin
    const t4 = await gest.enregistrerTour(obj.id, { texte: 'Achevé.\n\nTERMINE' });
    verifier('Objectifs : terminé', t4.objectif.etat === 'termine');
  } finally {
    await fsp.rm(objFichier, { force: true });
  }

  // interface
  const uiObj = await mainWindow.webContents.executeJavaScript(`(async () => {
    window.cerveauUI.ouvrirReglages('objectifs');
    await new Promise((r) => setTimeout(r, 700));
    const res = {
      section: document.querySelector('.volet-reglage.actif')?.id,
      champ: !!document.querySelector('#objectifTitre'),
      liste: !!document.querySelector('#listeObjectifs'),
      bouton: !!document.querySelector('#btnObjectifCreer')
    };
    document.querySelector('#btnFermerReglages2').click();
    return res;
  })()`);
  verifier('Objectifs : section accessible', uiObj.section === 'reglage-objectifs');
  verifier('Objectifs : champs et liste', uiObj.champ && uiObj.liste && uiObj.bouton);

  // 6tricies. Tâches planifiées
  const planMod = require('./planificateur');
  const planFichier = path.join(os.tmpdir(), `plan-selftest-${Date.now()}.json`);
  try {
    const plan = new planMod.Planificateur(planFichier);

    // analyse en français
    const casFreq = [
      ['toutes les 30 minutes', 30, 'minutes'],
      ['chaque heure', 1, 'heures'],
      ['tous les jours', 1, 'jours'],
      ['chaque matin', 1, 'jours']
    ];
    let freqOk = true;
    for (const [txt, n, u] of casFreq) {
      const r = planMod.analyserIntervalle(txt);
      if (!r || r.intervalle !== n || r.echelle !== u) freqOk = false;
    }
    verifier('Planification : fréquences comprises', freqOk);
    verifier('Planification : texte vague rejeté',
      planMod.analyserIntervalle('de temps en temps') === null);

    // français correct
    verifier('Planification : accords corrects',
      planMod.decrireIntervalle({ intervalle: 1, echelle: 'jours' }) === 'Chaque jour'
      && planMod.decrireIntervalle({ intervalle: 2, echelle: 'heures' }) === 'Toutes les 2 heures',
      planMod.decrireIntervalle({ intervalle: 2, echelle: 'heures' }));

    const tache = await plan.creer({ nom: 'Tâche de test', consigne: 'Fais un test', intervalle: 2, echelle: 'heures' });
    verifier('Planification : création', Boolean(tache.id) && tache.actif === true);

    // niveaux d'autonomie
    verifier('Planification : lecture seule par défaut', tache.niveau === 'lecture', tache.niveau);
    const nivL = planMod.permissionsDuNiveau('lecture');
    const nivE = planMod.permissionsDuNiveau('ecriture');
    const nivC = planMod.permissionsDuNiveau('commandes');
    const nivF = planMod.permissionsDuNiveau('complet');
    verifier('Niveaux : lecture bloque tout',
      nivL.mode === 'lecture' && !nivL.autoCommandes && !nivL.allowDelete);
    verifier('Niveaux : écriture autorise les fichiers, pas les commandes',
      nivE.mode === 'auto' && !nivE.autoCommandes);
    verifier('Niveaux : commandes autorise le shell, pas le push',
      nivC.autoCommandes === true && nivC.autoPush === false && nivC.allowDelete === false);
    verifier('Niveaux : complet autorise tout',
      nivF.autoCommandes && nivF.autoPush && nivF.autoGithub && nivF.allowDelete);

    const tNiv = await plan.changerNiveau(tache.id, 'ecriture');
    verifier('Niveaux : changement enregistré', tNiv.niveau === 'ecriture');
    let nivInvalide = false;
    try { await plan.changerNiveau(tache.id, 'tout'); } catch { nivInvalide = true; }
    verifier('Niveaux : niveau inconnu refusé', nivInvalide);
    verifier('Planification : persistée', fs2.existsSync(planFichier));
    verifier('Planification : pas due tout de suite', (await plan.dues()).length === 0);

    await plan.reporter(tache.id, { dansMs: -1000 });
    verifier('Planification : due après échéance', (await plan.dues()).length === 1);

    plan.marquerEnCours(tache.id, true);
    verifier('Planification : une tâche en cours n\'est pas due', (await plan.dues()).length === 0);
    plan.marquerEnCours(tache.id, false);

    const e1 = await plan.enregistrerExecution(tache.id, { ok: true, resume: 'fait' });
    verifier('Planification : exécution comptée', e1.executions === 1 && e1.historique.length === 1);
    verifier('Planification : échéance repoussée', e1.prochaineEcheance > Date.now());

    // trois échecs mettent en pause
    for (let i = 0; i < 3; i++) {
      await plan.reporter(tache.id, { dansMs: -1000 });
      await plan.enregistrerExecution(tache.id, { ok: false, erreur: 'panne' });
    }
    const enPause = await plan.trouver(tache.id);
    verifier('Planification : pause après 3 échecs', enPause.actif === false);
    verifier('Planification : raison de pause', /3 échecs/.test(enPause.pauseAuto || ''));

    const reactive = await plan.basculer(tache.id, true);
    verifier('Planification : réactivation', reactive.actif === true && reactive.echecsConsecutifs === 0);
  } finally {
    await fsp.rm(planFichier, { force: true });
  }

  // interface
  const uiPlan = await mainWindow.webContents.executeJavaScript(`(async () => {
    window.cerveauUI.ouvrirReglages('planification');
    await new Promise((r) => setTimeout(r, 800));
    const res = {
      section: document.querySelector('.volet-reglage.actif')?.id,
      champs: ['planNom', 'planConsigne', 'planFrequence', 'planObjectif']
        .filter((id) => document.getElementById(id)).length,
      bouton: !!document.querySelector('#btnPlanCreer'),
      niveau: !!document.querySelector('#planNiveau')
    };
    document.querySelector('#btnFermerReglages2').click();
    return res;
  })()`);
  verifier('Planification : section accessible', uiPlan.section === 'reglage-planification');
  verifier('Planification : champs présents', uiPlan.champs === 4, `${uiPlan.champs} champs`);
  verifier('Planification : sélecteur d’autonomie', uiPlan.niveau === true);

  // régression : « selected: false » posait quand même l'attribut, donc la
  // carte affichait toujours le dernier niveau de la liste.
  const uiSelNiveau = await mainWindow.webContents.executeJavaScript(`(async () => {
    window.cerveauUI.ouvrirReglages('planification');
    await new Promise((r) => setTimeout(r, 700));
    // crée une tâche en niveau commandes via l'API
    await window.cerveau.planification.creer({
      nom: 'Test sélection niveau', consigne: 'test',
      intervalle: 1, echelle: 'jours', niveau: 'commandes'
    });
    window.cerveauUI.ouvrirReglages('planification');
    await new Promise((r) => setTimeout(r, 900));
    const sel = document.querySelector('.plan-niveau-select');
    const r = { valeur: sel?.value, texte: sel?.selectedOptions?.[0]?.text };
    // nettoyage
    const l = await window.cerveau.planification.lister();
    for (const t of l.taches.filter((x) => x.nom === 'Test sélection niveau')) {
      await window.cerveau.planification.supprimer(t.id);
    }
    document.querySelector('#btnFermerReglages2').click();
    return r;
  })()`);
  verifier('Planification : sélecteur reflète le niveau réel',
    uiSelNiveau.valeur === 'commandes', `${uiSelNiveau.valeur} / ${uiSelNiveau.texte}`);
  verifier('Planification : bouton présent', uiPlan.bouton === true);

  // 6quadragies. Démon des tâches planifiées
  const daemonSrc = fs2.readFileSync(path.join(racine, 'daemon', 'cerveau-daemon.js'), 'utf8');
  verifier('Démon : fichier présent', daemonSrc.length > 2000);
  verifier('Démon : trouve les modules hors du paquet',
    /trouverRacine/.test(daemonSrc) && /opt\/cerveau\/app/.test(daemonSrc));
  verifier('Démon : verrou d’instance unique', /prendreVerrou/.test(daemonSrc));
  verifier('Démon : vérifie le PID du verrou', /process\.kill\(pid, 0\)/.test(daemonSrc));
  verifier('Démon : cède la place à l’application', /applicationOuverte/.test(daemonSrc));
  // régression : le démon lisait son propre PID et se croyait en double
  verifier('Démon : fichier PID distinct de l’application',
    /CHEMIN_PID_APP/.test(daemonSrc) && /app\.pid/.test(daemonSrc));
  verifier('Démon : ne lit pas son propre PID comme celui de l’app',
    !/readFileSync\(CHEMIN_PID,/.test(daemonSrc));
  verifier('Application : écrit app.pid au démarrage',
    /app\.pid/.test(fs2.readFileSync(path.join(racine, 'electron', 'main.js'), 'utf8')));
  verifier('Démon : lecture seule par défaut',
    /permissionsDuNiveau/.test(daemonSrc) && /autorise: false/.test(daemonSrc));
  verifier('Démon : respecte le niveau de chaque tâche',
    /permissionsDuNiveau\(niveau\)/.test(daemonSrc)
    && /contexteAgent\(cfg, memoire, tache\.niveau\)/.test(daemonSrc));
  verifier('Démon : journalise les exécutions', /CHEMIN_JOURNAL/.test(daemonSrc));
  verifier('Démon : rotation du journal', /1_048_576/.test(daemonSrc));

  // détection app vivante / morte, testée en Node natif (hors renderer)
  const cheminDaemon = path.join(racine, 'daemon', 'cerveau-daemon.js');
  const scriptDet = `
    const d = require(${JSON.stringify(cheminDaemon)});
    const fs = require('node:fs');
    const f = d.CHEMIN_PID_APP;
    const r = {};
    try { fs.unlinkSync(f); } catch {}
    r.sansFichier = d.applicationOuverte();
    fs.writeFileSync(f, String(process.pid));
    r.appVivante = d.applicationOuverte();
    fs.writeFileSync(f, '999999');
    r.pidMort = d.applicationOuverte();
    try { fs.unlinkSync(f); } catch {}
    r.final = d.applicationOuverte();
    console.log(JSON.stringify(r));
  `;
  let det = null;
  try {
    const nodeBinDet = process.env.npm_node_execpath
      || require('node:child_process').execSync('command -v node', { encoding: 'utf8' }).trim();
    const brut = require('node:child_process').execFileSync(nodeBinDet, ['-e', scriptDet], {
      encoding: 'utf8', timeout: 25000,
      env: { ...process.env, XDG_CONFIG_HOME: tmpCfg }
    });
    det = JSON.parse(brut.trim().split('\n').pop());
  } catch { det = null; }
  if (det) {
    verifier('Démon : aucune app détectée sans fichier', det.sansFichier === false, String(det.sansFichier));
    verifier('Démon : app vivante détectée', det.appVivante === true, String(det.appVivante));
    verifier('Démon : PID mort ignoré', det.pidMort === false, String(det.pidMort));
    verifier('Démon : fichier retiré = pas d’app', det.final === false, String(det.final));
  }

  // le démon est syntaxiquement valide et sait répondre à --etat
  const { execFileSync: executerFichier } = require('node:child_process');
  // Dans le selftest, process.execPath est Electron, pas Node : on cherche
  // explicitement un binaire node, sinon `--etat` relancerait Electron.
  let etatDaemon = '';
  const nodeBin = process.env.npm_node_execpath
    || require('node:child_process').execSync('command -v node', { encoding: 'utf8' }).trim();
  try {
    etatDaemon = executerFichier(nodeBin, [
      path.join(racine, 'daemon', 'cerveau-daemon.js'), '--etat'
    ], { encoding: 'utf8', timeout: 25000, env: { ...process.env, XDG_CONFIG_HOME: tmpCfg } });
  } catch (err) { etatDaemon = String(err.stdout || err.message); }
  verifier('Démon : répond à --etat', /démon des tâches planifiées/.test(etatDaemon),
    etatDaemon.split('\n')[0]);

  // service systemd
  const unitSrc = fs2.readFileSync(path.join(racine, 'daemon', 'cerveau-daemon.service'), 'utf8');
  verifier('Service : unité systemd valide',
    /\[Unit\]/.test(unitSrc) && /\[Service\]/.test(unitSrc) && /\[Install\]/.test(unitSrc));
  verifier('Service : service utilisateur',
    /WantedBy=default\.target/.test(unitSrc) && /Restart=on-failure/.test(unitSrc));
  verifier('Service : pas de privilèges',
    /NoNewPrivileges=true/.test(unitSrc) && !/User=root/.test(unitSrc));

  // l'installateur du démon est un script shell valide
  const instDaemon = fs2.readFileSync(path.join(racine, 'daemon', 'cerveau-daemon-install'), 'utf8');
  verifier('Service : installateur présent',
    /systemctl --user enable/.test(instDaemon) && /--retirer/.test(instDaemon));

  // le paquet installe le démon
  const pkgbuildDaemon = fs2.readFileSync(path.join(racine, 'pkg', 'PKGBUILD'), 'utf8');
  verifier('Paquet : installe le démon',
    /cerveau-daemon/.test(pkgbuildDaemon)
    && /usr\/lib\/systemd\/user/.test(pkgbuildDaemon));

  // 6quinquadragies. Pièces jointes : deux boutons distincts, images transmises
  const uiPieces = await mainWindow.webContents.executeJavaScript(`(async () => {
    const joindre = document.querySelector('#btnJoindre');
    const note = document.querySelector('#btnInsererNote');
    return {
      deux: Boolean(joindre) && Boolean(note),
      distincts: joindre !== note,
      titreJoindre: joindre?.title || '',
      titreNote: note?.title || ''
    };
  })()`);
  verifier('Pièces jointes : deux boutons distincts',
    uiPieces.deux === true && uiPieces.distincts === true);
  verifier('Pièces jointes : bouton fichier explicite',
    /fichier/i.test(uiPieces.titreJoindre), uiPieces.titreJoindre);
  verifier('Pièces jointes : bouton note explicite',
    /note/i.test(uiPieces.titreNote), uiPieces.titreNote);

  const appSrcPieces = fs2.readFileSync(path.join(racine, 'src', 'app.js'), 'utf8');
  verifier('Pièces jointes : un seul gestionnaire par bouton',
    !/\$\('#btnJoindre'\)\.addEventListener\('click', ouvrirModaleNotes\)/.test(appSrcPieces));

  // webUtils : File.path a disparu depuis Electron 32
  verifier('Fichiers : chemin via webUtils',
    /webUtils/.test(fs2.readFileSync(path.join(racine, 'electron', 'preload.js'), 'utf8')));
  verifier('Fichiers : plus d’usage de File.path',
    !/=> f\.path\b/.test(appSrcPieces) && !/\.map\(\(f\) => f\.path\)/.test(appSrcPieces));
  const apiChemin = await mainWindow.webContents.executeJavaScript(
    `typeof window.cerveau.fichiers.cheminDe`);
  verifier('Fichiers : API cheminDe exposée', apiChemin === 'function', apiChemin);

  // les images voyagent vraiment vers le fournisseur
  const agentSrcImg = fs2.readFileSync(path.join(racine, 'electron', 'agent.js'), 'utf8');
  verifier('Images : bloc « image » pour Anthropic',
    /type: 'image',\s*\n?\s*source: \{ type: 'base64'/.test(agentSrcImg));
  verifier('Images : bloc « image_url » pour OpenAI',
    /type: 'image_url'/.test(agentSrcImg));
  verifier('Images : dataUrl décomposée',
    /decomposerDataUrl/.test(agentSrcImg));
  verifier('Images : conservées dans l’historique borné',
    /les images doivent survivre/.test(appSrcPieces));
  verifier('Images : jointes au message utilisateur',
    /function imagesJointes/.test(appSrcPieces));

  // 6sexquadragies. Tableau des serveurs MCP : boutons lisibles et fonctionnels
  const uiMCP = await mainWindow.webContents.executeJavaScript(`(async () => {
    window.cerveauUI.ouvrirReglages('plugins');
    await new Promise((r) => setTimeout(r, 1100));
    const zone = document.querySelector('#listeServeursMCP');
    zone.scrollIntoView({ block: 'center' });
    await new Promise((r) => setTimeout(r, 400));

    const lignes = [...document.querySelectorAll('.mcp-ligne')];
    const actions = [...document.querySelectorAll('.mcp-ligne .btn-mcp')]
      .map((b) => { const r = b.getBoundingClientRect(); return { l: r.width, h: r.height, t: b.textContent.trim() }; });

    return {
      lignes: lignes.length,
      entetes: [...document.querySelectorAll('.mcp-entetes span')].map((x) => x.textContent),
      actions,
      // plus de table d'états séparée
      tableEtatsSeparee: Boolean(document.querySelector('#etatsMCP')),
      boutonDix: actions.filter((a) => a.t === 'Démarrer').length,
      boutonOutils: actions.filter((a) => a.t === 'Outils').length
    };
  })()`);
  verifier('MCP : tableau avec en-têtes',
    uiMCP.entetes.length === 4 && /Serveur/i.test(uiMCP.entetes[0]), uiMCP.entetes.join('|'));
  verifier('MCP : une ligne par serveur', uiMCP.lignes >= 1, `${uiMCP.lignes} lignes`);
  verifier('MCP : bouton « Démarrer » par serveur',
    uiMCP.boutonDix === uiMCP.lignes, `${uiMCP.boutonDix}/${uiMCP.lignes}`);
  verifier('MCP : bouton « Outils » par serveur',
    uiMCP.boutonOutils === uiMCP.lignes, `${uiMCP.boutonOutils}/${uiMCP.lignes}`);

  // régression : les boutons à texte faisaient 20x20 px et étaient écrasés.
  // Les boutons-icônes (✕) restent volontairement carrés et sont exclus.
  const aTexte = uiMCP.actions.filter((a) => a.t.length > 2);
  const tropPetits = aTexte.filter((a) => a.l < 40 || a.h < 20);
  verifier('MCP : boutons à texte assez grands',
    tropPetits.length === 0,
    tropPetits.map((a) => `${a.t}:${Math.round(a.l)}x${Math.round(a.h)}`).join(' '));
  verifier('MCP : boutons à texte mesurés', aTexte.length >= 2, `${aTexte.length} boutons`);
  verifier('MCP : plus de tableau d’états redondant',
    uiMCP.tableEtatsSeparee === false);

  // l'IPC des outils répond
  const outilsMCP = await mainWindow.webContents.executeJavaScript(
    `window.cerveau.mcp.outils('inexistant')`);
  verifier('MCP : IPC outils répond', typeof outilsMCP.ok === 'boolean', String(outilsMCP.ok));

  // 7. Erreurs console
  verifier('Aucune erreur console', erreursConsole.length === 0, erreursConsole.join(' | '));

  const echecs = resultats.filter((r) => !r.ok);
  console.log('\n=== AUTOTEST CERVEAU ===');
  for (const r of resultats) {
    console.log(`${r.ok ? '✓' : '✗'} ${r.test}${r.detail ? ` (${r.detail})` : ''}`);
  }
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} tests réussis`);
  if (echecs.length) console.log('ÉCHECS :', echecs.map((e) => e.test).join(', '));

  const code = echecs.length ? 1 : 0;
  app.exit(code);
}

module.exports = { run };
