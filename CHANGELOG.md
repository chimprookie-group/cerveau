# Journal des modifications

Toutes les versions notables de Cerveau. Format inspiré de
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions selon
[SemVer](https://semver.org/lang/fr/).

## [2.33.1] — 2026-11-06

### Corrigé
- **Régénération** : si la nouvelle requête échoue (fournisseur indisponible,
  réponse vide), l'ancienne réponse est **restaurée** au lieu d'être perdue.
- **Brouillons** : le texte est enregistré immédiatement avant de changer de
  conversation, sans attendre le délai d'écriture.
- **Autostart** : chemin correctement échappé si le lanceur contient des espaces.
- **Migration du thème** : ne bloque plus le démarrage si la configuration est en
  lecture seule.
- **Journal de crash** : écoute non intrusive (`uncaughtExceptionMonitor`).
- Petite remise en forme de la page « Comportement » des réglages.

## [2.33.0] — 2026-11-06

### Modifié
- **Plus de limite de tours configurable** : l'agent poursuit la tâche jusqu'à ce
  qu'elle soit réellement finie, comme le harnais de référence. Le réglage
  « Tours d'outils maximum » est retiré de l'interface et de la configuration.
- Un **garde-fou de sécurité** très haut (1000 tours) subsiste pour arrêter une
  boucle folle ; l'utilisateur garde le bouton d'arrêt à tout moment.
- Les sous-agents conservent leur propre limite, plus courte.

## [2.32.0] — 2026-11-06

### Modifié
- **Intelligence** : l'invite système gagne des règles de raisonnement et de
  qualité (reformuler, répondre d'abord le résultat, solution la plus simple,
  vérifier réellement, citer le web, protéger les secrets, confirmer les actions
  risquées).
- **Mémoire de long terme** classée aussi par **pertinence** avec la demande
  (mots-clés), en plus de l'usage et de la fraîcheur.
- **Résumé de compaction** plus précis : chemins exacts, commandes, résultats de
  tests, erreurs et solutions, décisions, suite du travail.
- **Performance** : le HTML des messages déjà rendus est mémorisé (cache) lors
  des va-et-vient entre conversations ; les animations sont suspendues quand la
  fenêtre est inactive.

## [2.31.0] — 2026-11-05

### Ajouté
- **Régénérer la dernière réponse** : un bouton sous la dernière réponse relance
  la même demande et remplace l'ancienne réponse, sans dupliquer la question.
- **Brouillons persistants** : le texte en cours d'écriture est conservé par
  conversation (stockage local) et restauré quand on y revient.
- **Bouton « Revenir en bas »** : apparaît quand on remonte dans le fil et ramène
  à la dernière réponse.

## [2.30.0] — 2026-11-05

### Ajouté
- **Intégration système complétée** :
  - **Lancer au démarrage** (fichier autostart du bureau), activable dans
    `Réglages → Général` ;
  - **Notifications système** quand une réponse arrive alors que la fenêtre est
    en arrière-plan ;
  - **Vérification des mises à jour** dans `À propos` (GitHub Releases) avec
    bouton d'ouverture de la release ;
  - **Journal de crash** : exceptions et promesses rejetées consignées dans
    `agent.log` ;
  - l'invite système liste désormais les capacités (plan, sous-agents,
    compétences, plugins, MCP, tâches de fond, vision, web, mémoire).

## [2.29.0] — 2026-11-05

### Ajouté
- **Thème « DeepSeek » par défaut** : sombre neutre, accents bleus — la nouvelle
  apparence de départ. Les anciens thèmes Sombre/Clair basculent une seule fois
  vers ce thème ; les six autres restent disponibles.
- **Détails du travail repliés** : après un tour, les étapes d'outils sont rangées
  dans un bloc « Détails du travail · N étape(s) », dépliable, pour une
  conversation plus lisible.
- **Historique progressif** : au-delà de 80 messages, la conversation s'affiche
  par tranche avec « Charger les N messages plus tôt ».

### Modifié
- Le texte en streaming n'est plus re-rendu à chaque jeton mais une fois par
  frame : moins de processeur, affichage toujours fluide.
- L'anneau de focus du compositeur et les couleurs d'outils suivent le thème.

## [2.28.1] — 2026-11-05

### Corrigé
- **Coins du panneau Réglages** : le fond de la navigation et du contenu débordait
  des coins arrondis en bas, laissant des angles carrés. Le contenu de la modale
  est désormais découpé par son cadre : les quatre coins restent nets.

## [2.28.0] — 2026-11-05

### Ajouté
- **Six thèmes** : Sombre (cuivré), Clair, **Matrix** (vert terminal sur noir),
  **Capucine** (crème chaude et orange), **Nord** (bleu arctique) et **Améthyste**
  (violet profond). Palette complète pour chacun : fonds, bordures, textes,
  accents, états et ombres.
- Sélecteur dans `Réglages → Apparence`, application immédiate et mémorisée ;
  la palette de commandes fait défiler les six thèmes.

## [2.27.0] — 2026-11-05

### Retiré
- **Le cerveau 3D et son onglet** sont supprimés de l'application, à la demande.
  Le panneau latéral retrouve ses six onglets (Note, Dépôt, Travail, Rech., Tags,
  Liens) ; la cartographie du coffre, son backend et ses styles sont retirés.
  Le reste de l'application (tours, plugins, vérification, pkexec…) est inchangé.

## [2.26.1] — 2026-11-05

### Modifié
- **Cerveau 3D** : le contour jaune (la silhouette lumineuse) est retiré. Le cerveau
  n'est plus dessiné que par son réseau de notes, de liens et de particules, toujours
  confiné à la forme cérébrale.

## [2.26.0] — 2026-11-05

### Modifié
- **Cerveau 3D interactif** : la cartographie 2D est remplacée par un vrai cerveau
  en volume — silhouette avec deux hémisphères, sillon central, circonvolutions et
  tronc cérébral, notes en nœuds dorés, liens en fibres courbes et **particules de
  flux** qui parcourent les connexions.
  - **glisser** pour tourner, **molette** pour zoomer, **double-clic** pour recentrer,
    rotation lente automatique (pause au survol) ;
  - survol : titre, dossier et tags ; clic : ouverture de la note ;
  - rendu canvas optimisé (DPI, arrêt quand l'onglet n'est pas visible, réseau
    masqué à l'intérieur de la silhouette).

## [2.25.0] — 2026-11-05

### Ajouté
- **Cerveau : cartographie du coffre** dans le panneau latéral (onglet « Cerveau »).
  Chaque note est un nœud lumineux, les liens wiki sont des fibres qui convergent
  vers un cœur central, sur un fond étoilé. Les nœuds sont répartis en deux
  hémisphères, avec un tronc cérébral et une lueur qui bat doucement.
  - survol : titre, dossier et tags de la note ; clic : ouverture de la note ;
  - compteur « N notes · N liens » et bouton de rafraîchissement ;
  - limité aux 320 notes les plus récentes (cache de 30 s) pour rester fluide.

### Corrigé
- Le contenu de la conversation ne déborde plus horizontalement quand le panneau
  latéral est ouvert (barre de défilement parasite).
- Les suggestions de l'accueil s'adaptent à la largeur disponible.

## [2.24.0] — 2026-11-05

### Ajouté
- **Navigation entre les tours**, comme dans l'interface de l'assistant : un rail de
  points à droite de la conversation, un par échange. Le point actif suit le
  défilement, le tour en cours clignote pendant le travail, et un survol affiche
  l'aperçu du message et de la réponse. Un clic fait défiler jusqu'au tour.
- Le sous-titre d'une conversation affiche désormais « N tour(s) · M message(s) ».

## [2.23.1] — 2026-11-05

### Corrigé
- **Vérification de fin de tâche** : délai de 20 s, pour qu'un modèle lent ne
  bloque pas la conversation ; elle est désactivée dans les sous-agents, qui
  doivent rester rapides.
- **Outils des plugins dans « Outils disponibles »** : on peut les désactiver
  individuellement sans retirer le plugin, et la liste se met à jour après une
  création.
- Nettoyage : code mort des anciens réglages de recherche, variable inutilisée.

### Modifié
- README : les 47 outils annoncés sont ceux de base ; les plugins ajoutent leurs
  propres outils (2 dans l'exemple fourni).

## [2.23.0] — 2026-11-05

### Ajouté
- **Plugins locaux.** Un fichier JavaScript dans `~/.config/cerveau/plugins/` peut
  ajouter des outils à l'agent (exposés sous `plugin_<fichier>_<outil>`). Un exemple
  est fourni au premier démarrage ; les outils des plugins sont disponibles dans
  tous les modes et suivent les permissions habituelles.
- **Création depuis les réglages** : `Réglages → Agent et outils → Plugins` liste
  les plugins chargés, affiche leurs erreurs, permet de **recharger**, d'**ouvrir
  le dossier**, de **retirer** un plugin, et d'en **créer un** via un formulaire
  pré-rempli (nom, description, code).
- **Compétence « Créer un plugin »** : l'agent connaît le format et peut rédiger le
  code à coller dans le formulaire. Il n'écrit pas lui-même dans le dossier de
  configuration.

### Sécurité
- Un plugin s'exécute avec les droits de l'application ; le formulaire et la
  documentation le rappellent. Seuls les fichiers du dossier de configuration sont
  chargés, et un plugin en erreur n'empêche pas les autres de fonctionner.

## [2.22.0] — 2026-11-05

### Ajouté
- **Privilèges administrateur via pkexec.** Quand une tâche a besoin de root,
  l'agent utilise `pkexec` et non `sudo` : l'application n'ayant pas de terminal,
  `pkexec` ouvre la fenêtre de mot de passe du système (polkit).
  - `executer_commande` convertit automatiquement `sudo …` en `pkexec …` ;
  - nouvelle option `privileges: true` pour exécuter toute la commande en root
    (`pkexec /bin/bash -lc '…'`) ;
  - l'invite système explique la règle et le message à reconnaître
    (« No authentication agent found » → proposer hyprpolkitagent ou polkit-gnome).

## [2.21.1] — 2026-11-05

### Corrigé
- **Arrêt silencieux au milieu d'une longue tâche.** Le contexte envoyé au modèle
  grossissait à chaque appel d'outil (plus de 2 millions de jetons cumulés sur 42
  appels dans la conversation concernée), sans allègement : le fournisseur pouvait
  refuser la requête, et l'erreur restait invisible sous le texte partiel.
  - les anciens résultats d'outils sont **allégés** au-delà d'un budget de contexte
    (les plus récents restent intacts) ;
  - une **erreur de contexte** du fournisseur déclenche un allègement plus agressif
    et **un nouvel essai automatique** ;
  - le modèle qui annonce une action au lieu de l'exécuter (« je nettoie… je
    vérifie… ») est relancé, même quand son texte est long ;
  - l'erreur d'arrêt est désormais **affichée dans la bulle**, plus seulement dans
    une notification fugace.
- **Journal de diagnostic** : `~/.config/cerveau/agent.log` conserve les 200
  dernières fins de requête (modèle, erreur, nombre d'outils, taille de la réponse).

## [2.21.0] — 2026-11-05

### Corrigé
- **L'agent pouvait conclure trop tôt sans qu'aucun signe ne le trahisse.** Après un
  tour qui a utilisé des outils, une courte vérification demande au modèle si la
  demande est réellement satisfaite. S'il répond NON, l'agent reprend seul avec une
  consigne explicite ; une seule vérification par demande, dans un appel séparé qui
  ne pollue pas la conversation.
- **Limite de tours atteinte avec un plan inachevé** : une extension exceptionnelle
  de 15 tours, annoncée, au lieu d'un arrêt sec.
- L'indicateur de réflexion affiche « Vérification du résultat… » pendant ce contrôle.

### Modifié
- La vérification ne s'applique qu'après un tour ayant réellement exécuté des outils :
  une réponse simple ne déclenche aucun appel supplémentaire.

## [2.20.1] — 2026-11-05

### Modifié
- **L'indicateur de réflexion est placé comme dans l'interface de l'assistant** : une
  ligne discrète en fin de conversation, sous le dernier message, avec un séparateur
  fin, une roue animée et un texte scintillant « Réflexion approfondie depuis 3 s ··· ».
  La bulle de réponse reste vide tant que le modèle n'a rien produit ; la ligne se
  fige ensuite en « Terminé en 2 min 27 s ».

## [2.20.0] — 2026-11-05

### Ajouté
- **Indicateur de réflexion en direct.** Pendant une requête, la bulle affiche
  « Réflexion approfondie depuis 3 s ··· » avec un minuteur qui avance chaque
  seconde ; le libellé suit le niveau de raisonnement choisi. Il passe à
  « Exécution de <outil> » pendant un outil, puis se fige à la fin :
  « Réflexion approfondie · 1 min 12 s ». En cas d'erreur : « Interrompu après … ».
- L'ancien triple point muet est remplacé par cet indicateur.

## [2.19.1] — 2026-11-05

### Corrigé
- **L'agent s'arrêtait avant la fin et il fallait écrire « continue ».** Quand le
  modèle terminait son tour sur une réponse coupée (limite de tokens), un plan
  encore incomplet, un outil en échec ou une simple annonce (« je vais… »), la
  boucle s'arrêtait. Elle poursuit désormais seule, jusqu'à trois relances, avec
  une consigne adaptée : reprendre à la coupure, terminer le plan, corriger
  l'outil. Une réponse normale ne déclenche aucune relance.
- Les deux morceaux de la réponse sont séparés par un saut de ligne dans la bulle.

## [2.19.0] — 2026-11-05

### Ajouté
- **Compétences** : des procédures réutilisables dans
  `~/.config/cerveau/competences/<id>/SKILL.md`. Trois sont installées (revue de
  code, diagnostic de bug, préparation de release). L'invite n'annonce que le nom et
  la description ; l'agent charge le détail avec `charger_competence`, et peut
  enregistrer une nouvelle procédure avec `enregistrer_competence`. Section dédiée
  dans `Réglages → Agent et outils`.
- **Outils en lecture exécutés en parallèle.** Le réglage « Appels d'outils en
  parallèle » existait mais n'était pas appliqué : trois lectures prennent désormais
  le temps d'une seule (355 ms au lieu de ~900 ms dans le test).
- **Compactage du contexte.** Au-delà de 24 messages ou 60 000 caractères, les
  échanges anciens sont résumés par le modèle ; le résumé est conservé et réinjecté
  dans l'invite, l'historique complet reste affiché.
- **Réessais automatiques** sur 408/429/5xx, avec temporisation, avant le début du
  flux : une surcharge passagère du fournisseur ne fait plus échouer la requête.

### Modifié
- Invite système enrichie d'une **méthode de travail** : vérifier avant d'agir,
  vérifier après une modification, ne jamais prétendre avoir exécuté une action.
- 47 outils en mode complet (23 en notes, 33 en code).

## [2.18.0] — 2026-11-05

### Corrigé
- **Les serveurs MCP s'initialisaient mal.** `initialize` partait sans identifiant,
  comme une notification : les serveurs stricts répondaient « Server not initialized »
  à `tools/list` et n'exposaient aucun outil. La requête est désormais conforme
  (identifiant + version du client lue depuis `package.json`).
- **Une commande absente du PATH bloquait tout.** `npx` n'existe pas dans le PATH
  d'une application lancée depuis le menu quand Node vient de mise, nvm ou asdf. Les
  commandes sont résolues dans les dossiers usuels, et le PATH du serveur est enrichi
  — y compris pour le shebang `#!/usr/bin/env node`.
- **Démarrer ou consulter un serveur arrêtait les autres.** Un chargement partiel ne
  coupe plus les serveurs déjà lancés.
- **Le premier démarrage pouvait expirer.** Délai porté à 20 s pendant une
  conversation et 60 s pour un démarrage manuel : au premier lancement, `npx`
  télécharge le paquet.

### Ajouté
- Bouton **Tout démarrer** avec bilan : « 5/6 serveur(s) prêt(s) · échec : … ».
- Le message d'échec s'affiche **en clair sous la ligne** du serveur, plus seulement
  dans une infobulle.
- Le tableau se rafraîchit après une conversation, quand les serveurs ont démarré.

## [2.17.0] — 2026-11-05

### Ajouté
- **Statistiques sous la conversation.** Une barre discrète affiche les jetons
  consommés — total, entrée ↑, sortie ↓ — et l'état du dernier appel API : latence,
  requête en cours, erreur. Les compteurs sont cumulés par conversation, conservés
  au redémarrage, et détaillés au survol (nombre d'appels, modèle).
- La durée de chaque appel est mesurée par l'agent et transmise avec les jetons.

### Modifié
- Le sous-titre de l'en-tête garde le nombre de messages : il n'est plus écrasé par
  l'affichage des jetons.

## [2.16.0] — 2026-11-05

### Ajouté
- **Effets visuels futuristes, discrets et désactivables.** Halo multicolore qui
  dérive derrière l'accueil, grille fine estompée, anneau lumineux en rotation autour
  du logo, liseré qui balaie le bas de l'en-tête, lueur des contrôles actifs, reflet
  qui traverse le bouton d'envoi et pastille de connexion qui respire.
- Nouveau réglage **Apparence → Effets visuels**, activé par défaut. Les animations
  se coupent automatiquement si le système demande de les réduire
  (`prefers-reduced-motion`), et restent plus discrètes en thème clair.

## [2.15.0] — 2026-11-05

### Ajouté
- **Vision : l'agent peut ouvrir une image.** Nouvel outil `voir_image` (PNG, JPEG,
  WebP, GIF, 4 Mo max) : il lit une capture, un schéma ou une photo du coffre ou de
  l'espace de travail et la joint au modèle. Anthropic reçoit un bloc image dans le
  résultat d'outil ; les fournisseurs compatibles OpenAI un message image juste après.
- **Processus en arrière-plan.** `lancer_tache_fond` démarre un serveur, un build ou
  une suite de tests sans bloquer la conversation. `lister_taches_fond`,
  `sortie_tache_fond` et `arreter_tache_fond` permettent de suivre la sortie et
  d'arrêter le processus avec tous ses enfants. Le panneau **Travail** affiche les
  processus, leur sortie et un bouton d'arrêt ; tout est tué à la fermeture de
  l'application.
- Les deux apparaissent dans `Réglages → Agent → Outils` et se désactivent un par un.

### Modifié
- Le mode complet expose **44 outils** (20 en notes, 30 en code).

## [2.14.3] — 2026-11-05

### Modifié
- **L'exemple MCP « Navigateur piloté (ZIMREAPER) » est retiré.** ZIMREAPER n'a pas de
  release binaire, pèse 97 Mo et devait être compilé à la main : l'exemple ne menait
  nulle part. Pour le web, Cerveau s'appuie sur ses outils intégrés, sans clé ni
  installation : `web_search` (DuckDuckGo) et `web_fetch` (lecture de page).
- **Les outils web apparaissent dans `Réglages → Agent → Outils`**, avec la même
  possibilité de les désactiver un par un que les autres outils.
- Le diagnostic des outils système ne cherche plus ZIMREAPER.

## [2.14.2] — 2026-11-05

### Corrigé
- **Une clé d'API collée pouvait disparaître avant d'être enregistrée.** Un simple
  changement de thème, de permission ou de modèle redessine les cartes fournisseurs :
  la clé saisie dans le champ était effacée sans avoir été sauvegardée. Les valeurs en
  cours de saisie sont désormais conservées lors d'un redessin, et la touche **Entrée**
  enregistre la carte.
- **« Tester la connexion » ignorait la clé qui venait d'être collée.** Le test lisait
  la configuration enregistrée, pas le champ : il répondait « Aucune clé d'API
  enregistrée » alors que la clé était sous les yeux. Le test enregistre maintenant la
  carte avant d'interroger le fournisseur.
- **Les modèles détectés disparaissaient au redémarrage.** « Détecter » interrogeait
  l'API et affichait les modèles, mais ne les gardait qu'en mémoire. Ils sont
  désormais conservés dans `providers[x].modelesDecouverts` et rechargés au démarrage.
- **Un serveur local se voyait réclamer une clé.** Le fournisseur « Compatible
  OpenAI (local / autre) » fonctionne sans clé quand l'URL est renseignée (LM Studio,
  Ollama, vLLM) : le chat, le test, les tâches planifiées et les objectifs ne le
  bloquent plus, et l'en-tête `Authorization` n'est plus envoyé vide.

## [2.14.1] — 2026-11-04

### Corrigé
- **Les captures du README montraient une interface qui n'existe plus.** Elles dataient
  du 2 novembre : quatre exemples MCP au lieu de six, aucune section Objectifs, Mémoire
  ni Tâches planifiées, et l'ancienne table « État des serveurs » à la place du nouveau
  tableau. Une personne découvrant le dépôt voyait donc une application différente de
  celle qu'elle installait.

### Ajouté
- **`scripts/captures.js`** régénère les neuf captures depuis l'application réelle
  (`npm run captures`). Il utilise une configuration et un coffre de démonstration :
  la configuration personnelle n'est jamais touchée. Les images se périment moins
  facilement, et se refaire prend une commande.
- Trois captures pour les nouveautés : **Mémoire**, **Objectifs** et **Tâches
  planifiées**, remplies d'exemples pour montrer à quoi ça ressemble en usage.

### Modifié
- Le README annonce **39 outils** en mode complet (19 en notes, 25 en code) au lieu
  de 36.

## [2.14.0] — 2026-11-04

Version issue d'un **audit complet** : chaque couche a été vérifiée, et chaque
défaut trouvé a été corrigé et verrouillé par un test.

### Corrigé — bugs critiques

- **L'application et le démon ne partageaient aucun fichier.** L'application
  écrivait dans `~/.config/cerveau` (minuscule) tandis que le démon lisait
  `~/.config/Cerveau` (majuscule), parce que le nom de l'application n'était jamais
  fixé explicitement. Conséquence : les tâches planifiées, les objectifs et la mémoire
  créés dans l'interface étaient **invisibles au démon**, qui tournait donc à vide.
  Le nom est maintenant fixé (`app.setName('cerveau')`) et le démon calcule le même
  chemin. Les données des versions précédentes sont **migrées automatiquement** au
  premier lancement, sans jamais écraser un fichier existant.

- **Le Superviseur travaillait avec un contexte incomplet.** Il n'avait ni mémoire,
  ni serveurs MCP, ni recherche web, ni presets, ni température — donc il ne pouvait
  pas utiliser les outils que le chat utilise. Son contexte est désormais complet.

### Corrigé — fuite mémoire et doubles actions

- **Chaque ouverture des réglages empilait des écouteurs.** Après onze ouvertures de
  la fenêtre, le moteur signalait une fuite mémoire ; au-delà, un seul clic déclenchait
  plusieurs fois la même action. Les branchements sont désormais uniques, les rendus
  restant rafraîchis à chaque ouverture. Vérifié : **20 ouvertures, zéro avertissement**,
  et un clic produit exactement une action.

### Corrigé — styles manquants

- Six classes utilisées n'avaient **aucune règle CSS** : `.btn-fermer`, `.moyenne`,
  `.liste-fournisseurs`, `.menu-contexte`, `.nav-reglage-texte`, `.raccourci`. Le bouton
  de fermeture de la modale des outils MCP était donc un texte nu, et le menu contextuel
  n'avait ni fond ni bordure.
- Ajout du style `.btn-mcp.outils` manquant.

### Ajouté — garde-fous d'audit
Un jeu de vérifications permanentes empêche ces régressions :
IPC main ↔ preload alignés, identifiants DOM existants, classes CSS définies, fonctions
déclarées une seule fois, contextes d'agent complets, chemins partagés.

### Vérifié
- **365 vérifications automatisées** passent.
- Les **14 sections de réglages** s'ouvrent sans une seule erreur console.
- Chat, notes du coffre et recherche web testés de bout en bout avec le vrai modèle :
  `PONG`, « 6 notes », `Paris`.

## [2.13.0] — 2026-11-04

### Modifié
- **Le tableau des serveurs MCP est entièrement refait.** Les boutons étaient
  illisibles : le style `.btn-modele` impose une boîte de **20 × 20 px** prévue pour
  une icône, et le mot « Tester » y était écrasé.

  Le nouveau tableau est une vraie grille à quatre colonnes — Serveur, Commande,
  État, Actions — avec :

  - des **boutons de taille réelle** : « Démarrer » (74 × 24) et « Outils » (51 × 24) ;
  - un **interrupteur** compact à la place de la case à cocher ;
  - l'**état intégré à la ligne** (non démarré / N outils / échec), avec une pastille
    verte, rouge ou grise et la raison de l'échec en infobulle ;
  - une **roue de progression** pendant le démarrage, au lieu du bouton qui affichait
    « … » ;
  - les lignes désactivées grisées ;
  - un empilement propre sur écran étroit (moins de 1100 px).

### Ajouté
- **Bouton « Outils »** : ouvre la liste des outils exposés par un serveur, avec leur
  description. Le serveur est démarré automatiquement si besoin. Nouvel IPC
  `mcp:outils` et méthode `outilsDuServeur()`.
- La section redondante « État des serveurs » est supprimée : l'état figure désormais
  dans le tableau, une seule source à maintenir.

### Vérifié en réel
- « Démarrer » sur `memory` : **Non démarré → 9 outils**, en vert.
- « Outils » sur `memory` : modale listant **9 outils**, avec `create_entities` et sa
  description.
- Désactivation de `git` : la ligne passe en grisé, l'état affiche « Non démarré ».
- Aucun bouton à texte ne mesure moins de 40 × 20 px.

## [2.12.1] — 2026-11-04

### Corrigé
- **Le bouton « joindre » ouvrait aussi la fenêtre des notes.** Deux gestionnaires
  étaient branchés sur le même bouton : le premier ouvrait le sélecteur de fichiers,
  le second la liste des notes du coffre — les deux s'exécutaient. Il y a maintenant
  **deux boutons distincts** : 📎 pour un fichier de votre ordinateur, ▤ pour une
  note du coffre.

- **Une image jointe n'était jamais transmise au modèle.** Elle était enregistrée,
  affichée en vignette, puis remplacée par le simple texte « [image jointe : nom] ».
  L'IA répondait donc qu'elle ne voyait rien — à juste titre. Les images partent
  désormais au format attendu par chaque fournisseur :

  | Fournisseur | Format |
  |---|---|
  | Anthropic | bloc `image` avec `source.base64` |
  | OpenAI et compatibles | bloc `image_url` |

- **Le glisser-déposer de fichiers ne faisait rien.** Il lisait `fichier.path`,
  propriété **supprimée depuis Electron 32** ; le projet utilise Electron 45. Le
  chemin vient maintenant de `webUtils.getPathForFile()`, exposé par le préchargement.
  Un repli lit directement les images sans chemin (captures d'écran, contenus distants).

- **L'icône du bouton « note » ne s'affichait pas** : le glyphe 🗎 manque dans les
  polices courantes et rendait un carré vide. Remplacé par ▤.

### Vérifié en réel
Image de test portant le mot « BANANE » en gros caractères, envoyée par le vrai
chemin d'envoi : le modèle a répondu **« BANANE »**. Avant ce correctif, il répondait
qu'il ne voyait aucun contenu.

## [2.12.0] — 2026-11-04

### Ajouté
- **Autonomie réglable par tâche planifiée.** En arrière-plan, personne ne peut répondre
  à une demande d'autorisation : une tâche tournait donc en lecture seule. Elle peut
  maintenant recevoir un niveau explicite, choisi en connaissance de cause.

  | Niveau | Fichiers | Commandes | Push / GitHub | Suppression |
  |---|---|---|---|---|
  | Lecture seule *(défaut)* | ✗ | ✗ | ✗ | ✗ |
  | Écriture de fichiers | ✓ | ✗ | ✗ | ✗ |
  | Commandes autorisées | ✓ | ✓ | ✗ | ✗ |
  | Complet | ✓ | ✓ | ✓ | ✓ |

  Le niveau se choisit à la création et se change directement dans la carte de la
  tâche. Le niveau « Complet » s'affiche en rouge : c'est un avertissement, pas une
  décoration.

### Vérifié en réel
- Niveau `lecture` : l'agent a tenté d'écrire un fichier → **refusé**, aucun fichier créé.
- Niveau `ecriture` : le fichier a été créé, mais la commande shell a été **refusée**.
- Niveau `commandes` : la commande shell a été **exécutée**, le fichier créé.
- Dans le vrai démon, avec le service systemd actif et l'application fermée : tâche de
  niveau `ecriture` → fichier créé dans l'espace de travail, sans aucune interaction.

### Limite connue
L'unité systemd utilise `PrivateTmp=true` : le démon voit un `/tmp` privé, distinct de
celui de la session. Une tâche qui écrit dans `/tmp` n'y laissera rien de visible pour
l'utilisateur. C'est voulu — un dossier temporaire privé évite d'écraser les fichiers
temporaires d'autres programmes — mais il faut le savoir. L'espace de travail, lui,
n'est pas isolé.

### Corrigé
- **La carte d'une tâche affichait toujours le dernier niveau de la liste.** L'attribut
  `selected` est une présence : `selected: false` le posait quand même. La valeur est
  désormais affectée après l'ajout des options.
- Accord au singulier dans la confirmation : « Tâche créée : 1 jour » au lieu de « 1 jours ».

## [2.11.0] — 2026-11-04

### Ajouté
- **Démon des tâches planifiées.** Les tâches s'exécutent désormais **même Cerveau
  fermé**, via un service *utilisateur* systemd — sans root, arrêté avec la session.

  - `cerveau-daemon-install` : installe et démarre le service
  - `cerveau-daemon --etat` : état des tâches et prochaine exécution
  - `cerveau-daemon --une-fois` : exécute ce qui est dû, puis sort

### Garde-fous
- **Instance unique** : un verrou de fichier avec vérification du PID empêche deux
  démons de lancer la même tâche — sans quoi les appels à l'IA seraient doublés.
- **L'application reste prioritaire** : si Cerveau est ouvert, le démon se met en
  veille pour éviter le double travail.
- **Lecture seule en arrière-plan** : les actions qui demanderaient une confirmation
  sont refusées, puisque personne ne peut répondre.
- **Journal avec rotation** : `daemon.log`, plafonné à 1 Mo, en plus du journal systemd.

### Corrigé pendant la mise au point
- **Le démon se mettait en veille indéfiniment.** Il écrivait son PID dans
  `daemon.pid`, puis relisait ce même fichier pour savoir si l'application était
  ouverte — et se prenait pour elle. Cerveau écrit désormais `app.pid`, distinct.
  Un test verrouille ce comportement.
- **L'activation du service échouait** : systemd refuse un lien symbolique
  (« Refusing to operate on linked unit file »). Le fichier est maintenant copié.

### Vérifié en réel
- Passage unique : une tâche due a été exécutée par le démon (20 fichiers `.js`
  comptés), échéance repoussée à dans 57 min, historique enregistré.
- Verrou : un second démarrage a été refusé (« Un démon tourne déjà, PID … »).
- Arrêt propre sur SIGTERM, verrou libéré.
- Le démon trouve ses modules aussi bien depuis les sources que depuis
  `/opt/cerveau/app` une fois installé.

## [2.10.0] — 2026-11-04

### Ajouté
- **Tâches planifiées.** Une consigne ou un objectif relancé automatiquement à intervalle
  régulier : « résume les issues chaque matin », « vérifie que les tests passent toutes
  les 2 heures ». C'est la suite logique des objectifs : au lieu de cliquer « tour
  suivant », l'horloge s'en charge.

  - Nouvelle section **Réglages → Tâches planifiées**.
  - La fréquence s'écrit **en français** : « toutes les 30 minutes », « chaque matin »,
    « toutes les 2 heures ». Le champ se colore en rouge si la formule n'est pas comprise.
  - Une tâche peut relancer **un tour d'objectif** au lieu d'une consigne libre.
  - Suivi : prochain passage, nombre d'exécutions, dernier résultat, historique.

### Garde-fous
- **Pas d'emballement** : une tâche ne se relance pas tant que la précédente tourne,
  et **trois échecs consécutifs la mettent en pause** avec la raison affichée.
- **Pas de rattrapage massif** : l'échéance est datée en absolu, donc une tâche due
  pendant une absence s'exécute **une fois**, pas autant de fois qu'il y a eu d'heures.
- Intervalle minimum d'une minute. L'application doit être ouverte pour que ça tourne.

### Vérifié en réel
- Tâche créée par l'interface avec « toutes les 2 heures » → description « Toutes les
  2 heures », prochaine exécution dans ~2 h.
- Exécution manuelle : l'agent a compté **20 fichiers `.js`**, historique enregistré,
  échéance repoussée.
- **Déclenchement automatique** : échéance forcée dans le passé → la tâche s'est
  exécutée d'elle-même (1 → 2 exécutions) sans aucune interaction.

## [2.9.1] — 2026-11-04

### Ajouté
- **Objectifs persistants.** Un objectif est un travail qui dépasse un seul échange :
  « migre le projet vers TypeScript », « écris la documentation de l'API ». Cerveau
  avance d'un tour à la fois, note ce qu'il a fait, et **reprend là où il s'est arrêté**,
  même après un redémarrage.

  - Nouvelle section **Réglages → Objectifs** : créer, suivre, lancer le tour suivant,
    suspendre, reprendre, abandonner.
  - Chaque tour reçoit le titre, les détails, le critère de réussite et **l'historique
    des pas déjà faits** — sans quoi il recommencerait depuis le début.
  - L'agent conclut chaque tour par `SUITE:` (prochaine action) ou `TERMINE`.
  - **Garde-fous** : budget de tours (20 par défaut, ajustable), suspension automatique
    si l'agent écrit `BLOQUE:`, et un échec de tour n'abandonne pas l'objectif.
  - Reprendre un objectif suspendu efface le blocage et redonne du budget.

### Vérifié en réel
- Objectif « compter les fichiers du dossier electron/ » : l'agent a constaté que le
  dossier n'existait pas dans l'espace de travail et a répondu `BLOQUE:` → objectif
  **suspendu automatiquement**, avec la raison affichée.
- Même objectif avec le bon espace de travail : **terminé en 1 tour**, 19 fichiers
  comptés, marqueur `TERMINE` reconnu.

## [2.9.0] — 2026-11-04

### Ajouté
- **Mémoire de long terme.** Cerveau retient des faits d'une conversation à l'autre :
  préférences, conventions de projet, décisions. Ils sont rappelés à l'IA au début de
  chaque échange, classés par catégorie, et utilisables sans avoir à les répéter.

  - Trois outils pour l'IA : `memoire_retenir`, `memoire_chercher`, `memoire_oublier`
  - Détection des doublons, y compris reformulés ou sans accents
  - Plafond de 120 faits, les moins utilisés étant évincés
  - Nouvelle section **Réglages → Mémoire** : ajouter, modifier, oublier, tout vider

- **Sous-agents.** Cerveau peut confier une tâche ciblée à un agent isolé, qui ne voit
  pas la conversation et renvoie un résultat sans ses étapes.

  - `deleguer_tache` : une tâche, un résultat
  - `deleguer_parallelle` : jusqu'à 3 sous-agents simultanés
  - Récursion bloquée (un sous-agent ne peut pas déléguer)
  - Écriture en mémoire interdite aux sous-agents
  - Un échec isolé n'annule pas les autres

- Les outils passent de 36 à **39** en mode Complet (19 en Notes, 25 en Code).

### Vérifié de bout en bout
- L'IA a retenu « je préfère les réponses courtes » via son outil, puis, dans une
  **nouvelle exécution sans le lui redire**, a répondu « Réponses courtes et directes,
  sans formule de politesse. C'est ce que j'ai en mémoire. »
- Délégation réelle : le sous-agent a compté 18 fichiers `.js`, l'agent principal a
  vérifié de son côté avec `find` — même résultat.

## [2.8.5] — 2026-11-03

### Corrigé
- **Une nouvelle conversation vide était créée à chaque ouverture.** Le démarrage
  appelait `nouvelleConversation()` sans regarder l'historique : la liste se remplissait
  d'entrées « Nouvelle conversation » vides, une par lancement. Cerveau reprend
  désormais la conversation la plus récente qui a du contenu, ou celle qui était
  ouverte, et n'en crée une neuve que s'il n'y a rien à reprendre.
- **Les conversations vides ne sont plus enregistrées.** Elles n'ont rien à reprendre
  et encombraient la liste. Celle qui est ouverte reste conservée pour ne pas
  disparaître sous les yeux.
- **Nettoyage automatique** des conversations vides héritées des versions précédentes.

### Vérifié
- Trois lancements successifs n'ajoutent aucune conversation.
- Une conversation réelle est reprise avec ses messages.
- Au tout premier lancement (historique vide), une conversation est bien créée, puis
  réutilisée aux suivants.
- Le bouton « Nouvelle conversation » continue de fonctionner.

## [2.8.4] — 2026-11-03

### Corrigé
- **Le bouton « Vers une note… » ne faisait rien.** Il appelait `prompt()`, que le
  processus de rendu d'Electron **ne supporte pas** : l'appel lève
  « prompt() is not supported » et renvoie `null`, donc l'export s'arrêtait
  silencieusement. Une boîte de saisie interne le remplace.
- **Trois autres fonctions étaient cassées pour la même raison** : créer une note,
  créer un dossier, et déplacer une note. Aucune n'avait jamais fonctionné.

### Ajouté
- **Boîte de saisie interne** : titre, valeur préremplie, texte d'aide, validation
  personnalisée avec message d'erreur, `Entrée` pour valider, `Échap` pour annuler.
  Elle remplace `prompt()` partout dans l'application.
- L'export vers une note affiche le nom du coffre et un chemin horodaté par défaut,
  et refuse un chemin contenant `..`.

### Vérifié de bout en bout
Bouton « Vers une note… » → boîte de saisie → écriture réelle dans le coffre → note
ouverte avec le bon contenu. Huit vérifications couvrent l'ouverture, l'annulation, la
validation, le rejet d'une valeur invalide et la fermeture.

## [2.8.3] — 2026-11-03

### Corrigé
- **Le Superviseur ne reprenait pas au démarrage.** L'arrêt à la fermeture était codé,
  mais pas la reprise : après un redémarrage de Cerveau, l'utilisateur croyait que son
  dépôt était encore surveillé alors que rien ne tournait. La reprise est restaurée,
  conditionnée à la présence d'un dépôt et d'au moins un auteur autorisé.
- **L'installateur ne vérifiait pas Node.js.** Il contrôlait `git` et `github-cli` via
  pacman, mais ignorait `node` et `npm` dont dépendent tous les serveurs MCP : un
  utilisateur découvrait que ses serveurs ne démarraient pas, sans explication.

### Modifié
- L'installateur cherche `gh`, `node` et `npm` **dans le PATH** plutôt que via pacman,
  car ils peuvent venir de `mise`, `nvm` ou `asdf`.
- Quand des outils manquent, il propose de les installer ; en mode non interactif
  (`curl | bash`), il affiche la commande à lancer.

## [2.8.2] — 2026-11-03

### Corrigé
- **Les dépendances système n'étaient pas déclarées.** `git`, `github-cli`, `nodejs` et
  `npm` étaient absents ou seulement facultatifs, alors que l'onglet Dépôt, le Superviseur
  et les serveurs MCP en dépendent : un nouvel utilisateur découvrait une erreur au moment
  d'utiliser la fonction. Ils sont désormais en dépendances obligatoires.

### Ajouté
- **Réglages → Superviseur → Outils système** : état réel de Git, GitHub CLI, Node.js,
  npm, ZIMREAPER et de la connexion GitHub, avec la commande `pacman` exacte à lancer
  si quelque chose manque, et un bouton pour la copier.
- Le README distingue ce que le paquet installe de ce qu'il faut ajouter.

### Note
ZIMREAPER reste facultatif et n'est pas embarqué : c'est un projet tiers de 97 Mo, sans
release binaire, qui doit être compilé. Le diagnostic le signale comme tel.

## [2.8.1] — 2026-11-03

### Ajouté
- **Exemple MCP « Navigateur piloté (ZIMREAPER) »** dans *Plugins et web*. ZIMREAPER est
  un navigateur Chromium qu'un agent pilote avec de vrais événements souris et clavier,
  via MCP. Ses **21 outils** (navigation, clic, saisie, réseau, captures, sessions)
  deviennent disponibles pour Cerveau en cochant un exemple.
- Les exemples MCP peuvent désormais porter des **variables d'environnement** avec
  `$HOME` développé, et une **note d'installation** affichée dans l'interface.

### Vérifié
- ZIMREAPER compilé et empaqueté en AppImage (97 Mo), puis connecté à Cerveau comme
  serveur MCP : **21 outils découverts**.
- Les 6 serveurs configurés chargent ensemble : **98 outils en 4,6 s**
  (filesystem 14, zimreaper 21, memory 9, sqlite 10, git 28, everything 16).

### Note
ZIMREAPER n'a pas de release précompilée : il faut le compiler. La procédure a demandé
trois contournements (binaire Electron absent du cache npm, module Python `PIL` manquant,
`appimagetool` absent), documentés dans la note de l'exemple.

## [2.8.0] — 2026-11-03

### Ajouté
- **Branche de travail par ticket.** Avant d'exécuter, le Superviseur crée une branche
  `préfixe/issue-N` dans le dépôt local et l'indique explicitement à l'agent, avec la
  commande de commit et de push à utiliser. La pull request est ensuite ouverte depuis
  cette branche.
- Réglages **Préparer une branche par ticket** et **Préfixe des branches**.
- La branche préparée réutilise une branche existante du même nom au lieu d'échouer,
  de sorte qu'un ticket rejoué ne crée pas de doublon.

### Corrigé
- **L'agent ignorait la branche préparée.** Il créait souvent la sienne : la détection
  regarde désormais d'abord la branche courante, puis celle qui avait été préparée.
- **Une pull request déjà existante était signalée comme un échec.** Elle est maintenant
  retrouvée et rattachée au ticket, marquée `dejaExistante`.
- Un dépôt local absent produit un avertissement explicite au lieu d'une erreur muette.

### Vérifié de bout en bout
Une issue demandant une modification du README a été créée. Le Superviseur l'a détectée,
l'agent a modifié le fichier, commité, poussé sur `test/cycle-complet-readme`, et la
**pull request #4 a été ouverte avec exactement le changement demandé** (+2 lignes).
Issue et PR ont ensuite été fermées et la branche supprimée.

## [2.7.1] — 2026-11-03

### Ajouté
- **Le Superviseur publie sa réponse sur GitHub.** À la fin d'un ticket, un commentaire
  est ajouté à l'issue d'origine : ce qui a été fait, le résumé, la durée et le nombre
  d'outils. Quand l'agent a poussé une branche, une **pull request** est ouverte et
  référencée dans le commentaire.
- Réglage **Publier la réponse**, activé par défaut, et **Branche cible** des pull
  requests (vide = branche par défaut du dépôt).
- Nouvelle fonction `commenter()` dans la couche GitHub, avec messages d'erreur explicites
  (ticket introuvable, droits insuffisants).

### Fiabilité
- Un échec de création de pull request n'empêche pas le commentaire d'être publié.
- Une publication impossible n'empêche jamais le ticket d'être enregistré.
- L'état de publication est conservé par ticket et affiché dans le panneau.

### Vérifié de bout en bout
Une issue réelle a été créée, détectée, exécutée par l'agent, et **la réponse a été
publiée automatiquement en commentaire sur GitHub** en 24 secondes (5 outils). L'issue
a ensuite été fermée.

### Corrigé
- Un test du panneau latéral dépendait de l'état laissé par un test précédent.

## [2.7.0] — 2026-11-03

### Ajouté
- **Superviseur** : Cerveau surveille un dépôt GitHub et transforme les demandes
  autorisées en tickets qu'il exécute lui-même. Inspiré de l'idée de `dsh-superagent`
  (DeepSeek) — « prendre le moins d'attention humaine possible, apporter le plus de
  valeur possible » — mais implémenté nativement, sans hôte cordis ni sessions DSH.

  - Surveillance des issues, commentaires et pull requests du dépôt choisi
  - **Liste d'auteurs autorisés** : sans elle, personne n'est autorisé
  - **Motif d'invocation** configurable (`@cerveau` par défaut)
  - Exécution par la boucle agentique existante, dans l'espace de travail
  - Cycle de vie complet : en attente → en cours → terminé / échoué
  - Historique persistant des tickets, résumés, durée et outils utilisés
  - Intervalle réglable (60 s minimum), démarrage et vérification à la demande
  - Reprise automatique au lancement si le superviseur était actif

### Vérifié de bout en bout
Une issue réelle a été créée sur le dépôt, détectée par le superviseur, transformée en
ticket et exécutée par l'agent en 7 secondes, puis l'issue a été fermée.

### Pourquoi pas le bundle d'origine
`dsh-superagent` est un bundle DSH privé qui exige 23 paquets internes et un hôte
cordis avec serveur web. Cerveau n'a aucune de ces briques : l'intégrer tel quel aurait
demandé de réécrire 17 600 lignes de TypeScript ou d'embarquer un second moteur.

## [2.6.0] — 2026-11-03

### Modifié
- **Nouveau logo.** Le singe à la loupe remplace l'emoji sur l'ensemble de
  l'application : icône du paquet, barre latérale, accueil, fenêtre « À propos »,
  favicon et icône de la barre des tâches.
- Le logo est décliné en huit tailles (16, 24, 32, 48, 64, 128, 256, 512). Aux tailles
  16 et 24 px, une **silhouette simplifiée** remplace le tracé détaillé, illisible en
  dessous de 32 px.
- Habillage « papier crème » : fond ivoire, trait terracotta en dégradé. Il se détache
  aussi bien sur le thème clair que sur le thème sombre, contrairement à un fond coloré.

### Corrigé
- `majAccueil()` écrasait le contenu du logo à chaque changement de mode. Le logo est
  désormais une image fixe, plus un texte remplacé par un emoji.

### Vérifié
- Logo affiché et chargé dans la barre latérale, l'accueil et « À propos »
- Rendu correct en thème clair et sombre
- Les huit tailles et les deux sources SVG présentes

## [2.5.0] — 2026-11-03

### Corrigé
- **Le bouton du panneau latéral passait sous le panneau.** L'en-tête avait
  `flex-shrink: 0` : il ne pouvait pas rétrécir, débordait de la zone principale et ses
  derniers boutons se retrouvaient recouverts par le panneau. Il rétrécit désormais, et
  c'est le sélecteur de modèle qui cède en premier (libellé tronqué, jamais les boutons).

### Ajouté
- **Deux dispositions du panneau, au choix** dans *Réglages → Apparence* :
  - **Côte à côte** — le panneau pousse le contenu. Rien ne se recouvre jamais.
  - **Superposé** — le panneau flotte au-dessus du contenu, sous l'en-tête, ce qui
    laisse toute la largeur au chat.
- **Largeur du panneau réglable** de 300 à 560 px.
- En dessous de 1280 px, la superposition est forcée : les trois colonnes ne tiennent
  plus côte à côte sans masquer des boutons.

### Modifié
- L'en-tête ne passe plus sur deux lignes sous 1240 px : il reste sur une seule ligne de
  55 px, avec un titre qui s'abrège et un sélecteur de modèle qui rétrécit.

### Vérifié
- Les deux dispositions, à 1600, 1280, 1100, 980 et 860 px : aucun chevauchement,
  bouton toujours cliquable, en-tête jamais en débordement.

## [2.4.2] — 2026-11-03

### Corrigé
- **La construction du paquet échouait pour un nouvel arrivant.** Le README indiquait
  `cd pkg && makepkg -si`, mais `makepkg` exige que l'archive source déclarée dans le
  PKGBUILD soit présente dans `pkg/`. Seul un lien manuel le permettait. `npm run dist`
  le crée désormais automatiquement.

### Vérifié depuis un clone Git vierge
- `git clone` puis `npm install` puis `npm start` : l'application se lance
  (Electron 45 télécharge son binaire au premier démarrage, sans script postinstall)
- `npm run dist` puis `cd pkg && makepkg -si` : le paquet se construit sans intervention
- L'installateur en une ligne résout correctement la dernière release
- Le paquet publié est téléchargeable, son empreinte SHA-256 correspond, et le paquet
  extrait se lance (0 erreur, `chrome-sandbox` en 4755)

## [2.4.1] — 2026-11-03

Audit complet : 4 bugs corrigés, sécurité du rendu renforcée.

### Corrigé
- **Les conversations n'étaient pas sauvegardées à leur création.** Une conversation
  ouverte puis fermée aussitôt disparaissait au redémarrage : la persistance n'était
  déclenchée qu'à la suppression et en fin de réponse.
- **Le bouton Envoyer restait actif sur une saisie vide.** Il n'était désactivé que
  pendant l'envoi. Il l'est désormais dès qu'il n'y a ni texte ni pièce jointe.
- **Échap ne fermait pas le sélecteur de modèle** quand le focus avait quitté le champ
  de recherche. La touche est maintenant traitée au niveau du document.
- **Un test de l'autotest échouait selon le moment** : une écriture de configuration en
  vol réassignait l'état et effaçait la configuration de test. Le test attend la fin des
  écritures avant de manipuler l'état.

### Sécurité
- Le rendu Markdown interdit désormais explicitement `form`, `object`, `embed`, `iframe`,
  `base`, `link`, `meta` ainsi que les attributs `action`, `formaction`, `srcdoc` et
  `ping`. DOMPurify laissait passer `form` jusqu'ici. Combiné à la CSP, aucune des
  attaques testées (script inline, `onerror`, `href=javascript:`, `svg onload`) ne
  produit d'exécution.

### Vérifié sans anomalie
- 14 outils Obsidian sur fichier vide, unicode, frontmatter cassé, gros fichier, liens
  cassés, recherche regex invalide
- 7 outils code : offsets limites, glob, fichiers absents, commandes destructrices bloquées
- 13 outils GitHub : messages clairs hors dépôt, fonctionnement correct dans un dépôt
- 7 réglages testés un par un : tous réellement enregistrés
- 64 handlers IPC, 64 appels preload : aucun orphelin
- Tous les raccourcis clavier, bascule de thème, échelle de police

## [2.4.0] — 2026-11-03

### Corrigé
- **Deux exemples de serveurs MCP pointaient vers des paquets inexistants.**
  `@modelcontextprotocol/server-git` et `@modelcontextprotocol/server-sqlite` renvoient
  une erreur 404 sur npm. Remplacés par des serveurs vérifiés : `@cyanheads/git-mcp-server`
  (28 outils) et `mcp-server-sqlite` (10 outils).
- **Les échecs de démarrage étaient muets.** Le message se limitait à « arrêté (code 1) »,
  sans indiquer la cause. La sortie d'erreur du processus est désormais jointe, avec une
  piste explicite quand le paquet est introuvable.

### Ajouté
- **Variables d'environnement par serveur** : beaucoup de serveurs MCP exigent une clé
  (`BRAVE_API_KEY`, `GITHUB_TOKEN`…). Saisie `CLE=valeur` à l'ajout, plusieurs séparées
  par des espaces.
- **Bouton « Tester » par serveur** : démarre uniquement le serveur visé, affiche le
  nombre d'outils chargés ou l'erreur exacte, sans être bloqué par un voisin défaillant.
- Un 5e exemple vérifié : `@modelcontextprotocol/server-everything`.

### Vérifié
- `@cyanheads/git-mcp-server` : 28 outils en 1,0 s
- `mcp-server-sqlite` : 10 outils en 1,0 s
- Message d'erreur d'un paquet absent : 404 npm cité, piste actionnable affichée

## [2.3.4] — 2026-11-03

### Corrigé
- **Le bouton du panneau latéral était recouvert par le panneau lui-même.** En dessous
  de 1180 px de large, le panneau passe en superposition à partir de `top: 0` et
  masquait l'en-tête complet — donc le bouton qui sert à le refermer. L'en-tête reste
  désormais au-dessus, et le panneau démarre sous lui.
- **Hauteur d'en-tête dynamique.** En dessous de 1240 px, l'en-tête passe sur deux
  lignes (130 px au lieu de 55). Le décalage du panneau est mesuré à l'exécution et
  recalculé à chaque redimensionnement, au lieu d'une valeur fixe qui laissait un vide.

### Vérifié
- Aucun chevauchement bouton/panneau de 1600 à 860 px de large
- Bouton accessible au clic à toutes ces largeurs
- Panneau replié toujours correctement masqué

## [2.3.3] — 2026-11-02

### Corrigé
- **Palette de commandes : les flèches sautaient.** Quand la souris survolait la
  palette, le défilement provoquait des `mouseenter` parasites qui déplaçaient la
  sélection sous le curseur : chaque `↓` avançait alors de plusieurs lignes, et la
  navigation devenait imprévisible. Le survol ne reprend désormais la main que sur un
  vrai déplacement de souris (`mousemove`), le clavier reste maître tant que la souris
  ne bouge pas.
- **Le survol ne sélectionnait pas le bon élément** : l'index était lu au moment de
  l'événement au lieu d'être capturé à la création. Survoler la 11e ligne renvoyait 0.
- **Cinq tests de la palette ne s'exécutaient pas** : ils référençaient une variable
  `palette` inexistante et passaient par erreur sans rien vérifier. Réparés.

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
