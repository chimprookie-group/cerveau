'use strict';

/**
 * Outils de code, équivalents du harnais DSH : terminal, lecture/écriture de
 * fichiers, recherche, glob et plan de tâches.
 *
 * Toutes les opérations sont confinées à l'espace de travail (workspace) :
 * tout chemin qui en sort est refusé.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MAX_LECTURE = 400 * 1024;      // 400 Ko par lecture
const MAX_SORTIE = 60 * 1024;        // 60 Ko de sortie terminal
const TIMEOUT_DEFAUT = 120000;       // 2 minutes

const IGNORES = new Set([
  'node_modules', '.git', '.cache', 'dist', 'build', '__pycache__',
  '.venv', 'venv', 'target', '.next', '.nuxt', 'vendor', '.obsidian', '.trash'
]);

/* ------------------------------ utilitaires ----------------------------- */

function racine(ctx) {
  if (!ctx.workspace) {
    throw new Error("Aucun espace de travail ouvert. Ouvre un dossier dans Réglages → Espace de travail.");
  }
  return path.resolve(ctx.workspace);
}

function resoudre(ctx, rel) {
  const root = racine(ctx);
  const cible = path.resolve(root, String(rel || '.'));
  const r = path.relative(root, cible);
  if (r.startsWith('..') || path.isAbsolute(r)) {
    throw new Error(`Chemin hors de l'espace de travail refusé : ${rel}`);
  }
  return cible;
}

function afficher(ctx, abs) {
  const root = racine(ctx);
  const r = path.relative(root, abs);
  return r === '' ? '.' : r.split(path.sep).join('/');
}

function tronquer(texte, max = MAX_SORTIE) {
  const s = String(texte ?? '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[tronqué : ${s.length - max} caractères supplémentaires]`;
}

/** Refuse les commandes manifestement destructrices. */
const INTERDITS = [
  /rm\s+(-[a-zA-Z]*\s+)*\/(\s|$)/,
  /rm\s+(-[a-zA-Z]*\s+)*~(\s|$)/,
  /mkfs(\.\w+)?\s/,
  /dd\s+[^|]*of=\/dev\/(sd|nvme|hd)/,
  />\s*\/dev\/(sd|nvme|hd)/,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
  /chmod\s+-R\s+777\s+\/(\s|$)/,
  /shutdown|reboot|poweroff/,
  /pacman\s+-Rdd|pacman\s+-Rns\s+\/|--noconfirm\s+.*-R/,
  /userdel|passwd\s+root/,
  /curl\s+[^|]*\|\s*(sudo\s+)?(ba)?sh/,
  /wget\s+[^|]*\|\s*(sudo\s+)?(ba)?sh/
];

function verifierCommande(cmd) {
  const c = String(cmd || '').replace(/\s+/g, ' ').trim();
  if (!c) throw new Error('Commande vide.');
  for (const motif of INTERDITS) {
    if (motif.test(c)) {
      throw new Error(`Commande bloquée par sécurité : elle correspond à un motif destructeur (${motif}).`);
    }
  }
  return c;
}

/* ------------------------------- exécution ------------------------------ */

function executerShell(cmd, cwd, timeout = TIMEOUT_DEFAUT, onDonnee = null, plafond = MAX_SORTIE) {
  return new Promise((resolve) => {
    const debut = Date.now();
    let stdout = '';
    let stderr = '';
    let termine = false;

    const enfant = spawn('/bin/bash', ['-o', 'pipefail', '-lc', cmd], {
      cwd,
      env: {
        ...process.env,
        TERM: 'dumb',
        NO_COLOR: '1',
        GIT_PAGER: 'cat',
        PAGER: 'cat'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const minuteur = setTimeout(() => {
      if (!termine) {
        try { enfant.kill('SIGKILL'); } catch { /* ignore */ }
        stderr += `\n[commande interrompue après ${Math.round(timeout / 1000)} s]`;
      }
    }, timeout);

    // Un seul chunk peut dépasser le plafond : on le tronque au lieu de
    // l'ajouter en entier.
    enfant.stdout.on('data', (d) => {
      const t = d.toString();
      if (stdout.length >= plafond) return;
      const reste = plafond - stdout.length;
      const garde = t.length > reste ? t.slice(0, reste) : t;
      stdout += garde;
      if (onDonnee) onDonnee('stdout', garde);
    });

    enfant.stderr.on('data', (d) => {
      const t = d.toString();
      if (stderr.length >= plafond) return;
      const reste = plafond - stderr.length;
      const garde = t.length > reste ? t.slice(0, reste) : t;
      stderr += garde;
      if (onDonnee) onDonnee('stderr', garde);
    });

    enfant.on('error', (err) => {
      clearTimeout(minuteur);
      termine = true;
      resolve({ code: -1, stdout, stderr: stderr + String(err.message), duree: Date.now() - debut });
    });

    enfant.on('close', (code) => {
      clearTimeout(minuteur);
      termine = true;
      resolve({ code: code ?? -1, stdout, stderr, duree: Date.now() - debut });
    });
  });
}

/* --------------------------------- outils ------------------------------- */

const OUTILS_CODE = [
  {
    nom: 'executer_commande',
    description: "Exécute une commande shell dans l'espace de travail et renvoie sa sortie (stdout, stderr, code de sortie). À utiliser pour lister, compiler, tester, installer, lancer git, etc. Le répertoire courant est la racine de l'espace de travail.",
    schema: {
      type: 'object',
      properties: {
        commande: { type: 'string', description: 'Commande bash à exécuter' },
        repertoire: { type: 'string', description: 'Sous-dossier où exécuter la commande (optionnel)' },
        delai: { type: 'number', description: 'Délai maximum en secondes (défaut 120, max 600)' }
      },
      required: ['commande']
    },
    risque: 'commande',
    executer: async (args, ctx) => {
      const cmd = verifierCommande(args.commande);
      const cwd = args.repertoire ? resoudre(ctx, args.repertoire) : racine(ctx);
      if (!fs.existsSync(cwd)) throw new Error(`Répertoire introuvable : ${args.repertoire}`);
      const delai = Math.min(Math.max(Number(args.delai) || 120, 1), 600) * 1000;
      const plafond = Number(ctx.agentCapSortie) > 0 ? Number(ctx.agentCapSortie) * 1024 : MAX_SORTIE;
      const r = await executerShell(cmd, cwd, delai, ctx.onDonnee, plafond);
      return {
        commande: cmd,
        code: r.code,
        duree_ms: r.duree,
        stdout: tronquer(r.stdout) || '(vide)',
        stderr: tronquer(r.stderr) || '(vide)'
      };
    }
  },
  {
    nom: 'lister_fichiers',
    description: "Liste les fichiers de l'espace de travail, éventuellement filtrés par motif glob (ex. \"**/*.js\"). Les dossiers lourds (node_modules, .git, dist…) sont ignorés.",
    schema: {
      type: 'object',
      properties: {
        motif: { type: 'string', description: 'Motif glob relatif, ex. "src/**/*.ts". Défaut : tous les fichiers.' },
        limite: { type: 'number', description: 'Nombre maximum de résultats (défaut 300)' }
      }
    },
    risque: 'lecture',
    executer: async (args, ctx) => {
      const root = racine(ctx);
      const limite = Math.min(Number(args.limite) || 300, 2000);
      const motif = String(args.motif || '').trim();
      const fichiers = [];

      const regex = motif ? globVersRegex(motif) : null;

      async function parcourir(dir, profondeur) {
        if (profondeur > 12 || fichiers.length >= limite) return;
        let entrees;
        try { entrees = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entrees) {
          if (fichiers.length >= limite) return;
          if (IGNORES.has(e.name)) continue;
          const abs = path.join(dir, e.name);
          const rel = afficher(ctx, abs);
          if (e.isDirectory()) {
            await parcourir(abs, profondeur + 1);
          } else if (!regex || regex.test(rel)) {
            fichiers.push(rel);
          }
        }
      }

      await parcourir(root, 0);
      return { total: fichiers.length, fichiers };
    }
  },
  {
    nom: 'lire_fichier',
    description: "Lit un fichier de l'espace de travail. Renvoie le contenu avec les numéros de ligne. Utilise offset/limite pour les gros fichiers.",
    schema: {
      type: 'object',
      properties: {
        chemin: { type: 'string', description: 'Chemin relatif du fichier' },
        offset: { type: 'number', description: 'Première ligne (1-indexée, défaut 1)' },
        limite: { type: 'number', description: 'Nombre de lignes à lire (défaut 2000)' }
      },
      required: ['chemin']
    },
    risque: 'lecture',
    executer: async (args, ctx) => {
      const abs = resoudre(ctx, args.chemin);
      const st = await fsp.stat(abs);
      if (st.isDirectory()) throw new Error('Ce chemin est un dossier, pas un fichier.');
      if (st.size > MAX_LECTURE) {
        throw new Error(`Fichier trop volumineux (${Math.round(st.size / 1024)} Ko). Utilise offset et limite.`);
      }
      const brut = await fsp.readFile(abs, 'utf8');
      const lignes = brut.split(/\r?\n/);
      const offset = Math.max(1, Number(args.offset) || 1);
      const limite = Math.min(Math.max(Number(args.limite) || 2000, 1), 5000);
      const extrait = lignes.slice(offset - 1, offset - 1 + limite);
      const numerote = extrait.map((l, i) => `${String(offset + i).padStart(5)}→${l}`).join('\n');
      return {
        chemin: afficher(ctx, abs),
        lignes_total: lignes.length,
        offset,
        contenu: numerote
      };
    }
  },
  {
    nom: 'ecrire_fichier',
    description: "Crée ou remplace entièrement un fichier. Les dossiers intermédiaires sont créés automatiquement.",
    schema: {
      type: 'object',
      properties: {
        chemin: { type: 'string', description: 'Chemin relatif du fichier' },
        contenu: { type: 'string', description: 'Contenu complet du fichier' }
      },
      required: ['chemin', 'contenu']
    },
    risque: 'ecriture',
    executer: async (args, ctx) => {
      const abs = resoudre(ctx, args.chemin);
      const existait = fs.existsSync(abs);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, String(args.contenu ?? ''), 'utf8');
      return {
        chemin: afficher(ctx, abs),
        cree: !existait,
        octets: Buffer.byteLength(String(args.contenu ?? ''))
      };
    }
  },
  {
    nom: 'modifier_fichier',
    description: "Remplace un extrait de texte exact par un autre dans un fichier existant. C'est l'outil privilégié pour les modifications ciblées : il ne réécrit pas tout le fichier.",
    schema: {
      type: 'object',
      properties: {
        chemin: { type: 'string' },
        ancien: { type: 'string', description: 'Texte exact à remplacer (doit être unique)' },
        nouveau: { type: 'string', description: 'Texte de remplacement' },
        toutes: { type: 'boolean', description: 'Remplacer toutes les occurrences (défaut : une seule)' }
      },
      required: ['chemin', 'ancien', 'nouveau']
    },
    risque: 'ecriture',
    executer: async (args, ctx) => {
      const abs = resoudre(ctx, args.chemin);
      const contenu = await fsp.readFile(abs, 'utf8');
      const ancien = String(args.ancien ?? '');
      if (!ancien) throw new Error('Le texte à remplacer est vide.');
      const occurrences = contenu.split(ancien).length - 1;
      if (occurrences === 0) {
        throw new Error("Texte introuvable dans le fichier. Vérifie l'orthographe, les espaces et l'indentation exacte.");
      }
      if (occurrences > 1 && !args.toutes) {
        throw new Error(`Le texte apparaît ${occurrences} fois. Précise davantage le contexte ou passe toutes=true.`);
      }
      const suivant = args.toutes
        ? contenu.split(ancien).join(String(args.nouveau ?? ''))
        : contenu.replace(ancien, String(args.nouveau ?? ''));
      await fsp.writeFile(abs, suivant, 'utf8');
      return {
        chemin: afficher(ctx, abs),
        remplacements: args.toutes ? occurrences : 1
      };
    }
  },
  {
    nom: 'chercher_code',
    description: "Recherche une expression (texte ou regex) dans les fichiers de l'espace de travail et renvoie les lignes correspondantes avec numéros.",
    schema: {
      type: 'object',
      properties: {
        requete: { type: 'string', description: 'Texte ou expression régulière' },
        motif: { type: 'string', description: 'Filtre glob sur les fichiers, ex. "*.ts"' },
        limite: { type: 'number', description: 'Nombre maximum de fichiers (défaut 50)' }
      },
      required: ['requete']
    },
    risque: 'lecture',
    executer: async (args, ctx) => {
      const root = racine(ctx);
      const limite = Math.min(Number(args.limite) || 50, 300);
      const filtre = args.motif ? globVersRegex(args.motif) : null;
      let re;
      try {
        re = new RegExp(String(args.requete), 'i');
      } catch {
        re = new RegExp(String(args.requete).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }

      const resultats = [];
      async function parcourir(dir, profondeur) {
        if (profondeur > 12 || resultats.length >= limite) return;
        let entrees;
        try { entrees = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entrees) {
          if (resultats.length >= limite || IGNORES.has(e.name)) continue;
          const abs = path.join(dir, e.name);
          const rel = afficher(ctx, abs);
          if (e.isDirectory()) { await parcourir(abs, profondeur + 1); continue; }
          if (filtre && !filtre.test(rel)) continue;

          let st;
          try { st = await fsp.stat(abs); } catch { continue; }
          if (st.size > MAX_LECTURE || st.size === 0) continue;

          let texte;
          try { texte = await fsp.readFile(abs, 'utf8'); } catch { continue; }
          if (texte.includes('\u0000')) continue; // binaire

          const hits = [];
          const lignes = texte.split(/\r?\n/);
          for (let i = 0; i < lignes.length && hits.length < 6; i++) {
            if (re.test(lignes[i])) {
              hits.push({ ligne: i + 1, texte: lignes[i].slice(0, 240) });
            }
          }
          if (hits.length) resultats.push({ fichier: rel, correspondances: hits });
        }
      }
      await parcourir(root, 0);
      return { fichiers_trouves: resultats.length, resultats };
    }
  },
  {
    nom: 'plan_taches',
    description: "Enregistre ou met à jour le plan de tâches affiché à l'utilisateur. À utiliser dès qu'une tâche demande plusieurs étapes, puis à mettre à jour au fur et à mesure.",
    schema: {
      type: 'object',
      properties: {
        taches: {
          type: 'array',
          description: 'Liste complète des tâches (remplace la précédente)',
          items: {
            type: 'object',
            properties: {
              titre: { type: 'string', description: 'Description courte de la tâche' },
              statut: {
                type: 'string',
                enum: ['a_faire', 'en_cours', 'termine']
              }
            },
            required: ['titre', 'statut']
          }
        }
      },
      required: ['taches']
    },
    risque: 'lecture',
    executer: async (args, ctx) => {
      const taches = Array.isArray(args.taches) ? args.taches.slice(0, 50) : [];
      const propre = taches.map((t) => ({
        titre: String(t.titre || '').slice(0, 200),
        statut: ['a_faire', 'en_cours', 'termine'].includes(t.statut) ? t.statut : 'a_faire'
      }));
      if (ctx.onPlan) ctx.onPlan(propre);
      return {
        taches: propre,
        resume: {
          total: propre.length,
          faites: propre.filter((t) => t.statut === 'termine').length,
          en_cours: propre.filter((t) => t.statut === 'en_cours').length
        }
      };
    }
  }
];

/* ------------------------------- glob → regex --------------------------- */

function globVersRegex(motif) {
  let m = String(motif).trim();
  if (!m) return /.*/;
  if (!m.includes('/')) m = `**/${m}`;
  let re = '';
  for (let i = 0; i < m.length; i++) {
    const c = m[i];
    if (c === '*') {
      if (m[i + 1] === '*') {
        re += '.*';
        i++;
        if (m[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`, 'i');
}

const PAR_NOM = new Map(OUTILS_CODE.map((t) => [t.nom, t]));

module.exports = { OUTILS_CODE, PAR_NOM, globVersRegex, executerShell, verifierCommande };
