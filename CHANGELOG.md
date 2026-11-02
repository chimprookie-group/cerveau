# Journal des modifications

Toutes les versions notables de Cerveau. Format inspiré de
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions selon
[SemVer](https://semver.org/lang/fr/).

## [2.3.2] — 2026-11-02

Première publication publique.

### Modifié
- Les exemples de serveurs MCP n'utilisent plus de chemins personnels : `$HOME` est
  développé à l'ajout du serveur.
- Captures d'écran ajoutées au README.
- L'autotest attend le rendu asynchrone des cartes fournisseurs avant de les compter.

## [2.3.1] — 2026-11-02

### Corrigé
- **Panneau latéral replié restait cliquable et rendu hors écran.** Le repli utilisait
  un `margin` négatif : le panneau mesurait toujours 400 px et s'étendait de 1680 à
  2080 px, invisible mais présent dans le DOM, capable d'intercepter des clics et de
  consommer des resources de rendu. Ajout de `visibility: hidden` et
  `pointer-events: none` au repli.
- Même défaut sur la **barre latérale gauche** (268 px rendus hors écran), corrigé de
  la même façon.

### Vérifié sans anomalie
- Les 6 volets du panneau latéral s'affichent au clic (Note, Dépôt, Travail, Recherche,
  Tags, Liens).
- Clic sur une note : ouverture, édition, enregistrement, annulation par Échap.
- Recherche (résultats, regex invalide, requête vide), nuage de tags, filtrage par tag,
  backlinks, panneau Dépôt (état de connexion), pied de barre latérale.
- Repli et réouverture des deux panneaux, y compris avec une note ouverte.
- Aucun débordement horizontal à 1680, 1280, 1100 et 980 px de large.
- Aucune duplication du DOM après 6 rafraîchissements successifs du coffre.

## [2.3.0] — 2026-11-02

Audit complet : 7 bugs corrigés.

### Corrigé
- **Blocage infini sur un serveur MCP défaillant.** Une commande inexistante faisait
  attendre indéfiniment l'envoi du message : l'événement d'échec `spawn` arrivait avant
  l'enregistrement de la requête. L'échec est désormais mémorisé et rejoué (0 ms au lieu
  de l'infini).
- **Serveurs MCP non arrêtés à la fermeture** : les processus survivaient à Cerveau.
  Nettoyage ajouté sur `before-quit`, `will-quit`, `exit`, `SIGINT` et `SIGTERM`.
- **Démarrage MCP séquentiel** : N serveurs lents bloquaient N × 10 s. Passage en
  parallèle (10 s maximum au total, quelle que soit la quantité).
- **Historique de conversation non borné** : une longue discussion dépassait la fenêtre
  de contexte et provoquait une erreur API. Borne à 40 messages / 120 000 caractères,
  en conservant les échanges les plus récents et le dernier message.
- **Réglage « plafond de sortie » sans effet** : le plafond existait dans l'interface
  mais n'était jamais appliqué. Un chunk dépassant la limite était écrit en entier ;
  troncature désormais exacte (vérifié à 1, 2, 5 et 60 Ko).
- **Scrutation périodique inutile** : le sélecteur de modèle interrogeait l'état toutes
  les 2,5 s. Remplacé par un abonnement aux changements de configuration.
- **Messages d'erreur techniques** : `terminated`, `socket hang up` ou `Erreur 400`
  s'affichaient tels quels. Traduits en explications actionnables.

### Vérifié sans anomalie
- Traversée de chemin (coffre et espace de travail) · fuite de clé vers le renderer ·
  configuration corrompue · coupure de flux SSE en cours de génération · commandes vides,
  longues ou à code de sortie non nul · isolation Electron.

## [2.2.1] — 2026-11-02

### Ajouté
- **Repli automatique** quand un modèle refuse les appels d'outils : un avertissement
  explicite est affiché et la conversation continue sans outils, au lieu d'échouer.

### Vérifié
- Les outils sont **indépendants du fournisseur et du modèle** : changer de modèle
  recharge le même jeu d'outils au message suivant (16 en Notes, 22 en Code, 36 en
  Complet, plus les serveurs MCP).
- Les outils désactivés dans les réglages restent désactivés après une bascule.

## [2.2.0] — 2026-11-02

### Ajouté
- **Recherche web** : `web_search` (DuckDuckGo sans clé, ou fournisseur externe type
  Tavily) et `web_fetch` (lecture d'une page, conversion HTML → texte). Publicités
  DuckDuckGo filtrées.
- **Serveurs MCP** : branchement d'outils externes par JSON-RPC 2.0 sur stdin/stdout
  (`initialize` → `tools/list` → `tools/call`). Gestion multi-serveurs, préfixage des
  noms, états par serveur, 4 exemples prêts à l'emploi.
- Section **Plugins et web** dans les réglages : moteur de recherche, test en un clic,
  ajout de serveur MCP, état de chargement.

### Corrigé
- **Réponse vide** quand le modèle terminait sa boucle d'outils sans rédiger de synthèse :
  une relance sans outils est désormais déclenchée.
- L'application n'était pas installée (désinstallation externe) : réinstallée et vérifiée.

### Modifié
- 36 outils au total (contre 34), répartis sur les modes Notes (16) et Complet (36).
- L'autotest passe à 129 vérifications, dont un vrai serveur MCP lancé en test.

## [2.1.0] — 2026-11-02

### Modifié
- **Panneau Réglages entièrement repensé** : barre latérale verticale à sections groupées
  (Application, Modèles, Espaces, Sécurité, Système) remplaçant les onglets horizontaux.
  Chaque section suit une présentation unifiée : titre, description, puis champs alignés
  à droite.

### Ajouté
- **Section Général** : mode au démarrage, panneau latéral ouvert, restauration de la
  dernière conversation, nombre de conversations conservées, dossier de configuration,
  réinitialisation.
- **Section Agent et outils** : nombre de tours d'outils maximum, appels parallèles,
  délai d'une commande, plafond de sortie, et **liste des 34 outils désactivables
  individuellement** quel que soit le mode.
- Composants d'interface : interrupteurs à bascule, champs numériques, étiquettes de
  valeur remplacée.

### Corrigé
- Les réglages de l'agent (tours maximum, outils désactivés, délai des commandes) sont
  désormais réellement appliqués à la boucle, plus seulement stockés.

## [2.0.0] — 2026-11-02

### Ajouté
- **Sélecteur de modèle à deux niveaux** (`Ctrl+M`) : liste des fournisseurs avec leur
  modèle courant et un compteur, puis les modèles du fournisseur choisi. Recherche
  unifiée sur les deux niveaux, navigation clavier (↑↓ ←→ Entrée Échap), fil d'Ariane.
- **Niveaux de raisonnement** : Rapide / Équilibré / Approfondi après le choix du modèle,
  affichés en badge dans l'en-tête.
- **Onglet Comportement** : 6 presets de style cumulables (Concis, Pédagogue, Ingénieur,
  Critique, Créatif, Rigueux), instructions personnalisées, température réglable.
- **Terminal intégré** dans le panneau Travail : historique ↑↓, coloration des erreurs,
  codes de sortie, mêmes garde-fous que l'agent.
- **Pièces jointes** : glisser-déposer de fichiers, collage d'images depuis le
  presse-papiers, bouton d'ajout. Images en base64, texte injecté avec son nom.

### Modifié
- Les anciens menus déroulants `Fournisseur` et `Modèle` disparaissent au profit du
  sélecteur unique.
- Le prompt système et la température sont transmis aux deux familles d'API.
- L'autotest passe à 107 vérifications.

## [1.4.2] — 2026-11-02

### Corrigé
- **Permissions refusées au démarrage** (`EACCES: permission denied, open 'main.js'`) :
  l'archive source reproduisait les permissions 600 des fichiers de travail, rendant
  le code illisible par l'utilisateur après installation. `dist.sh` normalise désormais
  l'archive en 644/755, et la PKGBUILD réapplique la normalisation côté paquet.
- Le `chmod 4755` de `chrome-sandbox` était écrasé par la normalisation : il est
  maintenant appliqué **en dernier**, sinon Electron refuse de démarrer sans sandbox.

## [1.4.1] — 2026-11-02

### Corrigé
- **L'application ne démarrait pas après installation** : le script de distribution
  supprimait `electron/resources/default_app.asar`. Sans ce fichier, Electron s'arrête
  immédiatement avec le code 1, **sans afficher le moindre message d'erreur** — d'où
  l'impression que rien ne se passait au lancement.
- Ajout d'un test de non-régression vérifiant que cet asset reste dans la distribution.

## [1.4.0] — 2026-11-02

### Ajouté
- **Palette de commandes** (`Ctrl+K`) : accès clavier à 20 actions (changer de mode,
  ouvrir les réglages, basculer le thème, créer une note, régénérer…) et recherche
  directe dans les notes du coffre. Navigation aux flèches, recherche insensible
  aux accents.
- **Régénération de la dernière réponse** depuis la palette.
- **Paquet Arch officiel** via `pkg/PKGBUILD` (build avec `makepkg`, plus de script maison).
- **Installateur en une ligne** (`install.sh`) : vérifie le système, installe les
  dépendances manquantes, télécharge la dernière version et contrôle son empreinte SHA-256.
- **Métadonnée AppStream** : Cerveau apparaît dans les logithèques avec description,
  captures et historique de versions.
- **Icône SVG vectorielle** en plus des PNG (net à toutes les tailles).
- Actions de raccourci bureau : `--new` (nouvelle conversation) et `--settings`.
- `LICENSE` MIT, `CHANGELOG.md`, script `scripts/release.sh`.

### Modifié
- Le `.desktop` déclare une seule catégorie principale (`Office`) pour éviter
  l'affichage en double dans le menu.
- Le lanceur force `--ozone-platform-hint=auto` : Wayland et X11 fonctionnent
  sans configuration.

### Corrigé
- La navigation clavier de la palette boucle correctement aux extrémités.

## [1.3.1] — 2026-11-02

### Corrigé
- **Le fournisseur « Compatible OpenAI » disparaissait** du sélecteur lorsqu'il était
  configuré avec des modèles mais sans URL de base. Il reste désormais visible dès
  qu'il possède une URL, une clé, un modèle par défaut ou une liste de modèles.
- Le sélecteur de modèle est élargi : les noms longs ne sont plus tronqués.
- En fenêtre étroite, l'en-tête passe sur deux lignes au lieu de comprimer le titre.
- L'autotest ne touche plus à la configuration réelle (vérification par empreinte).

## [1.3.0] — 2026-11-02

### Ajouté
- **Plusieurs modèles par fournisseur**, avec découverte automatique via `GET /v1/models`
  (LM Studio, Ollama, vLLM, OpenRouter…), ajout manuel et choix du modèle par défaut.
- Le modèle choisi dans l'en-tête est valable pour la session, sans modifier le défaut.

## [1.2.1] — 2026-11-02

### Corrigé
- Détection de l'authentification GitHub réparée : `gh` renvoie `hosts["github.com"]`
  sous forme de tableau depuis la v2.5x, l'ancien format objet n'est plus le seul géré.
  Repli sur la sortie texte si `--json` est indisponible.
- `display: flex` écrasait l'attribut `hidden` : les panneaux « connecté » et
  « non connecté » s'affichaient simultanément.

### Ajouté
- Création de dépôt GitHub, avec option d'envoi du contenu de l'espace de travail.

## [1.2.0] — 2026-11-02

### Ajouté
- **Intégration GitHub** via le CLI `gh` : connexion par jeton, liste des dépôts,
  clonage, branches, commit/push, pull requests, issues, workflows CI.
- Panneau **Dépôt** et panneau git permanent dans l'onglet Travail.
- 13 outils GitHub exposés à l'agent.
- Permissions dédiées pour `git push` et les écritures GitHub.

## [1.1.0] — 2026-11-02

### Ajouté
- **Mode Code** : terminal bash, lecture/écriture de fichiers, recherche, plan de tâches.
- Trois modes : Notes, Code, Complet.
- Panneau **Travail** avec espace de travail et plan de tâches en direct.
- Garde-fous : cloisonnement du dossier de travail, blocage des commandes destructrices,
  `pipefail` pour propager les codes de sortie.
- Icône singe.

## [1.0.0] — 2026-11-02

### Ajouté
- Version initiale : assistant IA francophone, coffre Obsidian intégré,
  multi-fournisseurs (Anthropic, DeepSeek, OpenAI, compatible), clés chiffrées,
  rendu Markdown, panneau de notes, recherche, tags, backlinks, journal quotidien.
