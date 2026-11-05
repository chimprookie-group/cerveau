'use strict';

/**
 * Compétences : procédures réutilisables, stockées en Markdown dans
 * ~/.config/cerveau/competences/<id>/SKILL.md.
 *
 * Le prompt système n'annonce que le nom et la description (courts) ; le
 * contenu complet n'est chargé qu'à la demande, via « charger_competence ».
 * L'agent peut aussi enregistrer une procédure avec « enregistrer_competence ».
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const DOSSIER = path.join(config.APP_DIR, 'competences');
const FICHIER = 'SKILL.md';
const MAX_CONTENU = 60000;

const MODELES = {
  'revue-de-code': {
    nom: 'Revue de code',
    description: 'Relire un diff ou un fichier et signaler les vrais problèmes',
    contenu: `# Revue de code

Objectif : trouver ce qui va casser, pas seulement ce qui déplaît.

## Méthode

1. **Cadre** : demande le diff, la branche ou les fichiers concernés. Si le diff
   est gros, commence par la liste des fichiers et les zones critiques.
2. **Lis le contexte** : le fichier modifié *et* ses appelants. Un changement
   peut être correct localement et faux à l'usage.
3. **Cherche dans cet ordre** :
   - correction (cas limites, erreurs non gérées, types) ;
   - sécurité (injection, chemin, secrets, permissions) ;
   - régressions (comportement existant, compatibilité) ;
   - tests (ce qui n'est pas couvert) ;
   - lisibilité et performance, en dernier.
4. **Vérifie** : exécute les tests ou au moins un scénario réel si possible.

## Format de sortie

- **Bloquant** — fichier:ligne, problème, correction proposée.
- **Majeur** — idem.
- **Mineur** — suggestions, sans bloquer.
- Une phrase de synthèse : prêt à fusionner, ou non.

Ne liste pas des goûts personnels comme des bugs. Si tout va bien, dis-le
simplement.`,
  },
  'diagnostic-de-bug': {
    nom: 'Diagnostic de bug',
    description: 'Reproduire, isoler et corriger un bug sans casser le reste',
    contenu: `# Diagnostic de bug

## Méthode

1. **Reproduire** : la commande exacte, le fichier, le scénario. Sans reproduction,
   pas de correction fiable.
2. **Observer** : message d'erreur complet, pile d'appels, journaux. Lis l'erreur
   réelle au lieu de la paraphraser.
3. **Réduire** : plus petit cas qui échoue. Désactive les options une à une.
4. **Localiser** : recherche du message, lecture des fonctions concernées,
   \`git log\` sur les lignes suspectes. Une hypothèse = une vérification.
5. **Corriger** la cause, pas le symptôme. Évite les try/catch qui masquent.
6. **Vérifier** : un test de non-régression qui échouait avant et passe après,
   puis toute la suite.

## Pièges

- Ne modifie pas plusieurs choses à la fois : tu ne saurais plus ce qui a corrigé.
- Un bug de performance se mesure avant/après, jamais à l'œil.
- Si la correction est risquée, propose d'abord, applique ensuite.`,
  },
  'preparer-une-release': {
    nom: 'Préparer une release',
    description: 'Version, journal, tests, paquet et publication GitHub',
    contenu: `# Préparer une release

1. **État propre** : \`git status\`, branche à jour, aucune modification oubliée.
2. **Tests** : lance toute la suite (autotests inclus). Note les échecs et leur
   raison avant de publier.
3. **Version** : semver cohérent (correctif = patch, fonctionnalité = mineure),
   mise à jour dans \`package.json\` et \`pkg/PKGBUILD\`.
4. **Journal** : entrée \`CHANGELOG.md\` datée, en français, avec le *pourquoi* et
   pas seulement le *quoi*.
5. **Build** : \`bash scripts/release.sh\` — archive source, paquet pacman, empreintes.
6. **Vérifie le paquet** : version et fichiers attendus, empreinte SHA-256.
7. **Publication** : tag \`vX.Y.Z\`, notes issues du journal, assets (paquet,
   archive, sommes). Vérifie ensuite que tout est téléchargeable.
8. **Après** : installe la version publiée et teste un parcours réel.

Ne publie jamais une version dont les tests échouent sans le dire explicitement.`,
  }
};

/* -------------------------------- utilitaires --------------------------- */

function identifiant(brut) {
  const id = String(brut || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (!id) throw new Error('Nom de compétence invalide.');
  return id;
}

function cheminDe(id) {
  const sur = identifiant(id);
  return path.join(DOSSIER, sur, FICHIER);
}

function decouperFrontmatter(texte) {
  const m = String(texte || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, corps: String(texte || '') };
  const meta = {};
  for (const ligne of m[1].split(/\r?\n/)) {
    const i = ligne.indexOf(':');
    if (i === -1) continue;
    meta[ligne.slice(0, i).trim().toLowerCase()] = ligne.slice(i + 1).trim();
  }
  return { meta, corps: String(texte).slice(m[0].length) };
}

function assurerDossier() {
  fs.mkdirSync(DOSSIER, { recursive: true, mode: 0o700 });

  // première utilisation : on installe trois procédures utiles
  const deja = fs.readdirSync(DOSSIER).filter((n) => !n.startsWith('.'));
  if (deja.length) return;

  for (const [id, modele] of Object.entries(MODELES)) {
    const dossier = path.join(DOSSIER, id);
    fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
    const contenu = `---\nnom: ${modele.nom}\ndescription: ${modele.description}\n---\n\n${modele.contenu}\n`;
    fs.writeFileSync(path.join(dossier, FICHIER), contenu, { mode: 0o600 });
  }
}

function lister() {
  assurerDossier();
  const competences = [];
  for (const nom of fs.readdirSync(DOSSIER)) {
    if (nom.startsWith('.')) continue;
    const fichier = path.join(DOSSIER, nom, FICHIER);
    try {
      if (!fs.statSync(fichier).isFile()) continue;
      const { meta, corps } = decouperFrontmatter(fs.readFileSync(fichier, 'utf8'));
      const premiere = corps.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) || '';
      competences.push({
        id: nom,
        nom: meta.nom || nom,
        description: (meta.description || premiere).slice(0, 200)
      });
    } catch { /* compétence illisible : ignorée */ }
  }
  return competences.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

function lire(nom) {
  assurerDossier();
  const id = identifiant(nom);
  const fichier = cheminDe(id);
  const brut = fs.readFileSync(fichier, 'utf8');
  const { meta, corps } = decouperFrontmatter(brut);
  return {
    id,
    nom: meta.nom || id,
    description: meta.description || '',
    chemin: fichier,
    contenu: corps.trim().slice(0, MAX_CONTENU)
  };
}

function enregistrer({ nom, description, contenu } = {}) {
  const id = identifiant(nom);
  const propre = String(contenu || '').trim();
  if (propre.length < 40) throw new Error('Le contenu de la compétence est trop court (40 caractères minimum).');

  const dossier = path.join(DOSSIER, id);
  fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
  const texte = `---\nnom: ${String(nom).trim()}\ndescription: ${String(description || '').trim()}\n---\n\n${propre}\n`;
  fs.writeFileSync(path.join(dossier, FICHIER), texte, { mode: 0o600 });
  return { id, chemin: path.join(dossier, FICHIER) };
}

/* --------------------------------- outils ------------------------------- */

const OUTILS_COMPETENCES = [
  {
    nom: 'lister_competences',
    description: "Liste les compétences disponibles (procédures réutilisables : revue de code, diagnostic de bug, release…). À consulter quand une tâche ressemble à une procédure déjà écrite.",
    schema: { type: 'object', properties: {} },
    risque: 'lecture',
    executer: async () => ({ competences: lister() })
  },
  {
    nom: 'charger_competence',
    description: "Charge le contenu complet d'une compétence et l'applique à la tâche en cours. Utilise l'identifiant rendu par lister_competences.",
    schema: {
      type: 'object',
      properties: {
        nom: { type: 'string', description: 'Identifiant de la compétence (ex. revue-de-code)' }
      },
      required: ['nom']
    },
    risque: 'lecture',
    executer: async (args) => {
      const c = lire(args.nom);
      return {
        id: c.id,
        nom: c.nom,
        description: c.description,
        consigne: 'Suis cette procédure pour la tâche en cours.',
        contenu: c.contenu
      };
    }
  },
  {
    nom: 'enregistrer_competence',
    description: "Enregistre une nouvelle compétence (procédure réutilisable) ou met à jour une existante, au format Markdown. À utiliser quand l'utilisateur demande de retenir une méthode.",
    schema: {
      type: 'object',
      properties: {
        nom: { type: 'string', description: 'Nom lisible (sert aussi d’identifiant)' },
        description: { type: 'string', description: 'Une ligne : quand l’utiliser' },
        contenu: { type: 'string', description: 'La procédure complète, en Markdown' }
      },
      required: ['nom', 'contenu']
    },
    risque: 'ecriture',
    executer: async (args) => enregistrer(args)
  }
];

const PAR_NOM = new Map(OUTILS_COMPETENCES.map((o) => [o.nom, o]));

module.exports = {
  DOSSIER,
  MODELES,
  OUTILS_COMPETENCES,
  PAR_NOM,
  lister,
  lire,
  enregistrer,
  assurerDossier
};
