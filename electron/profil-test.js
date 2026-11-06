'use strict';

/**
 * Profil hermétique pour l'autotest (`CERVEAU_SELFTEST=1`).
 *
 * L'autotest vérifie l'arbre du coffre, les tags et le tableau MCP : il exige
 * donc un coffre non vide et au moins un serveur MCP. Sans ce profil, il
 * échoue sur une installation neuve et écrit dans la configuration réelle de
 * l'utilisateur. On prépare ici un coffre temporaire et un serveur MCP inerte,
 * uniquement quand l'autotest est demandé.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MARQUEUR = 'cerveau-selftest-';

/** Vrai si le dossier a été créé par ce module (jamais nettoyé ailleurs). */
function estDossierDeTest(dossier) {
  return Boolean(dossier) && path.basename(dossier).startsWith(MARQUEUR);
}

/**
 * Supprime les dossiers jetables laissés par une exécution précédente.
 *
 * Le dossier de configuration d'un test ne peut pas être effacé pendant que
 * l'application tourne (fichiers verrouillés par Electron) : on le retire au
 * démarrage suivant.
 */
function nettoyerResidus() {
  const tmp = os.tmpdir();
  let entrees = [];
  try {
    entrees = fs.readdirSync(tmp);
  } catch {
    return 0;
  }
  let supprimes = 0;
  for (const nom of entrees) {
    if (!nom.startsWith(MARQUEUR)) continue;
    try {
      fs.rmSync(path.join(tmp, nom), { recursive: true, force: true });
      supprimes += 1;
    } catch { /* encore verrouillé : on réessaiera */ }
  }
  return supprimes;
}

/**
 * Crée un coffre jetable avec quelques notes et tags.
 * @returns {string} chemin absolu du coffre
 */
function creerCoffreTemporaire() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), MARQUEUR));
  const notes = {
    'Accueil.md': '# Accueil\n\nNote d\'entrée du coffre de test. #test #accueil\n',
    'Projets/Demo.md': '# Démo\n\nUn projet de démonstration. #projet #demo\n',
    'Projets/Archive.md': '# Archive\n\nAncien projet, conservé pour l\'arbre. #archive\n',
    'Journal/2026-01-01.md': '# Journal\n\nPremière entrée. #journal\n'
  };

  for (const [rel, contenu] of Object.entries(notes)) {
    const abs = path.join(racine, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contenu, 'utf8');
  }
  return racine;
}

/**
 * Serveur MCP inerte : il existe pour que le tableau ait une ligne à rendre,
 * mais on ne le démarre pas (aucun processus lancé pendant l'autotest).
 */
function serveurMCPDeTest() {
  return {
    nom: 'selftest',
    commande: 'node',
    arguments: ['-e', 'process.exit(0)'],
    variablesEnv: {},
    actif: false
  };
}

/**
 * Applique le profil de test à la configuration : coffre temporaire actif et
 * serveur MCP factice. Ne touche à rien si l'autotest n'est pas demandé.
 *
 * @param {object} config module electron/config
 * @returns {{actif: boolean, coffre?: string}}
 */
function appliquer(config) {
  if (process.env.CERVEAU_SELFTEST !== '1') return { actif: false };

  nettoyerResidus();
  const coffre = creerCoffreTemporaire();
  const vaultId = 'vault_selftest';

  config.updateConfig({
    vaults: [{ id: vaultId, name: 'Coffre de test', path: coffre }],
    activeVaultId: vaultId,
    serveursMCP: [serveurMCPDeTest()],
    // état neutre : l'autotest ne doit pas dépendre des réglages de la machine
    permissions: {
      mode: 'demander',
      allowDelete: false,
      autoCommandes: false,
      autoPush: false,
      autoGithub: false
    },
    conversations: [],
    memoriser: false
  });

  return { actif: true, coffre };
}

module.exports = { appliquer, creerCoffreTemporaire, estDossierDeTest, nettoyerResidus, MARQUEUR };
