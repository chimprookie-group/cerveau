'use strict';

/**
 * Catalogue de plugins prêts à l'emploi.
 *
 * Les plugins marqués `defaut: true` sont installés automatiquement à la
 * première ouverture (sans écraser un fichier existant). Les autres sont
 * proposés dans Réglages → Agent et outils → Catalogue.
 *
 * Un plugin s'exécute dans le processus principal : uniquement du code local,
 * relu et versionné ici.
 */

const DATE_HEURE = `'use strict';

module.exports = {
  nom: 'Date et heure',
  description: 'Date, heure, fuseau et horodatage, sans dépendre du modèle',
  outils: [
    {
      nom: 'date_heure',
      description: "Renvoie la date, l'heure, le fuseau horaire et l'horodatage ISO actuels.",
      schema: {
        type: 'object',
        properties: {
          fuseau: { type: 'string', description: 'Fuseau IANA, ex. Europe/Paris (défaut : local)' }
        }
      },
      risque: 'lecture',
      executer: async (args) => {
        const maintenant = new Date();
        const fuseau = args.fuseau || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const formateur = new Intl.DateTimeFormat('fr-FR', {
          dateStyle: 'full', timeStyle: 'long', timeZone: fuseau
        });
        return {
          local: formateur.format(maintenant),
          iso: maintenant.toISOString(),
          fuseau,
          horodatage: maintenant.getTime()
        };
      }
    }
  ]
};
`;

const CALCULS = `'use strict';

// Évaluateur arithmétique sûr : ni eval, ni Function.
function evaluer(texte) {
  const s = String(texte || '').replace(/\\s+/g, '').toLowerCase();
  let i = 0;
  const nombre = () => {
    const depart = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i += 1;
    if (depart === i) throw new Error('Nombre attendu.');
    return Number(s.slice(depart, i));
  };
  const facteur = () => {
    if (s[i] === '(') {
      i += 1;
      const v = expression();
      if (s[i] !== ')') throw new Error('Parenthèse fermante manquante.');
      i += 1;
      return v;
    }
    if (s[i] === '-') { i += 1; return -facteur(); }
    if (s[i] === '+') { i += 1; return facteur(); }
    const noms = ['sqrt', 'abs', 'sin', 'cos', 'tan', 'log', 'exp', 'round', 'floor', 'ceil'];
    for (const nom of noms) {
      if (s.startsWith(nom, i)) {
        i += nom.length;
        if (s[i] !== '(') throw new Error('Parenthèse attendue après ' + nom + '.');
        i += 1;
        const v = expression();
        if (s[i] !== ')') throw new Error('Parenthèse fermante manquante.');
        i += 1;
        return Math[nom](v);
      }
    }
    if (s.startsWith('pi', i)) { i += 2; return Math.PI; }
    if (s[i] === 'e') { i += 1; return Math.E; }
    return nombre();
  };
  const puissance = () => {
    let v = facteur();
    while (s[i] === '^') { i += 1; v = Math.pow(v, facteur()); }
    return v;
  };
  const terme = () => {
    let v = puissance();
    while (s[i] === '*' || s[i] === '/' || s[i] === '%') {
      const op = s[i]; i += 1;
      const r = puissance();
      if (op === '*') v *= r;
      else if (op === '/') {
        if (r === 0) throw new Error('Division par zéro.');
        v /= r;
      } else {
        if (r === 0) throw new Error('Modulo par zéro.');
        v %= r;
      }
    }
    return v;
  };
  const expression = () => {
    let v = terme();
    while (s[i] === '+' || s[i] === '-') {
      const op = s[i]; i += 1;
      const r = terme();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const valeur = expression();
  if (i !== s.length) throw new Error('Expression invalide près de « ' + s.slice(i) + ' ».');
  if (!Number.isFinite(valeur)) throw new Error('Résultat non fini.');
  return valeur;
}

module.exports = {
  nom: 'Calculs',
  description: 'Calculs arithmétiques exacts, sans eval',
  outils: [
    {
      nom: 'calculer',
      description: 'Calcule une expression arithmétique : + - * / % ^, parenthèses, sqrt, abs, sin, cos, tan, log, exp, round, floor, ceil, pi, e.',
      schema: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Expression à calculer, ex. (12*7)+sqrt(81)' }
        },
        required: ['expression']
      },
      risque: 'lecture',
      executer: async (args) => ({ expression: args.expression, resultat: evaluer(args.expression) })
    }
  ]
};
`;

const PRESSE_PAPIERS = `'use strict';

const { clipboard } = require('electron');

module.exports = {
  nom: 'Presse-papiers',
  description: 'Lire et écrire le presse-papiers du bureau',
  outils: [
    {
      nom: 'lire_presse_papiers',
      description: 'Lit le texte actuellement dans le presse-papiers.',
      schema: { type: 'object', properties: {} },
      risque: 'lecture',
      executer: async () => ({ texte: clipboard.readText() })
    },
    {
      nom: 'ecrire_presse_papiers',
      description: 'Place un texte dans le presse-papiers.',
      schema: {
        type: 'object',
        properties: { texte: { type: 'string', description: 'Le texte à copier' } },
        required: ['texte']
      },
      risque: 'ecriture',
      executer: async (args) => {
        clipboard.writeText(String(args.texte || ''));
        return { copie: true, caracteres: String(args.texte || '').length };
      }
    }
  ]
};
`;

const NOTIFICATIONS = `'use strict';

const { Notification } = require('electron');

module.exports = {
  nom: 'Notifications',
  description: 'Envoyer une notification de bureau',
  outils: [
    {
      nom: 'notifier_desktop',
      description: "Affiche une notification de bureau (titre et message).",
      schema: {
        type: 'object',
        properties: {
          titre: { type: 'string', description: 'Titre court' },
          message: { type: 'string', description: 'Corps de la notification' }
        },
        required: ['titre', 'message']
      },
      risque: 'ecriture',
      executer: async (args) => {
        if (!Notification.isSupported()) throw new Error('Les notifications ne sont pas disponibles sur ce bureau.');
        new Notification({
          title: String(args.titre || 'Cerveau').slice(0, 80),
          body: String(args.message || '').slice(0, 400)
        }).show();
        return { envoyee: true };
      }
    }
  ]
};
`;

const SYSTEME = `'use strict';

const os = require('node:os');

module.exports = {
  nom: 'Système',
  description: 'Informations sur la machine : OS, CPU, mémoire, uptime',
  outils: [
    {
      nom: 'infos_systeme',
      description: "Renvoie l'OS, la version du noyau, l'architecture, le nombre de CPU, la mémoire et l'uptime.",
      schema: { type: 'object', properties: {} },
      risque: 'lecture',
      executer: async () => ({
        os: os.type(),
        version: os.release(),
        architecture: os.arch(),
        hote: os.hostname(),
        processeurs: os.cpus().length,
        memoireTotaleGo: Number((os.totalmem() / 1024 ** 3).toFixed(2)),
        memoireLibreGo: Number((os.freemem() / 1024 ** 3).toFixed(2)),
        uptimeHeures: Number((os.uptime() / 3600).toFixed(1))
      })
    }
  ]
};
`;

const OUVRIR = `'use strict';

const { shell } = require('electron');

module.exports = {
  nom: 'Ouvrir',
  description: 'Ouvrir un fichier, un dossier ou une URL sur le bureau',
  outils: [
    {
      nom: 'ouvrir_chemin',
      description: "Ouvre un fichier/dossier local ou une URL (http/https) avec l'application par défaut.",
      schema: {
        type: 'object',
        properties: { chemin: { type: 'string', description: 'Chemin absolu ou URL' } },
        required: ['chemin']
      },
      risque: 'commande',
      executer: async (args) => {
        const cible = String(args.chemin || '').trim();
        if (!cible) throw new Error('Chemin vide.');
        if (/^https?:\\/\\//i.test(cible)) {
          await shell.openExternal(cible);
          return { ouvert: cible, type: 'url' };
        }
        const erreur = await shell.openPath(cible);
        if (erreur) throw new Error(erreur);
        return { ouvert: cible, type: 'chemin' };
      }
    }
  ]
};
`;

const TEXTE = `'use strict';

module.exports = {
  nom: 'Texte',
  description: 'Statistiques simples sur un texte',
  outils: [
    {
      nom: 'analyser_texte',
      description: 'Compte les mots, caractères, lignes et paragraphes.',
      schema: {
        type: 'object',
        properties: { texte: { type: 'string', description: 'Le texte à analyser' } },
        required: ['texte']
      },
      risque: 'lecture',
      executer: async (args) => {
        const texte = String(args.texte || '');
        const mots = texte.trim() ? texte.trim().split(/\\s+/).filter(Boolean).length : 0;
        return {
          mots,
          caracteres: texte.length,
          caracteresSansEspaces: texte.replace(/\\s/g, '').length,
          lignes: texte ? texte.split(/\\r?\\n/).length : 0,
          paragraphes: texte.split(/\\n\\s*\\n/).filter((p) => p.trim()).length
        };
      }
    }
  ]
};
`;

const CATALOGUE = [
  { id: 'date-heure', nom: 'Date et heure', description: "Date, heure et fuseau, sans dépendre du modèle.", defaut: true, outils: ['date_heure'], code: DATE_HEURE },
  { id: 'calculs', nom: 'Calculs', description: 'Calculs exacts (sans eval) : arithmétique, racines, fonctions.', defaut: true, outils: ['calculer'], code: CALCULS },
  { id: 'presse-papiers', nom: 'Presse-papiers', description: 'Lire et écrire le presse-papiers du bureau.', defaut: true, outils: ['lire_presse_papiers', 'ecrire_presse_papiers'], code: PRESSE_PAPIERS },
  { id: 'notifications', nom: 'Notifications', description: 'Envoyer une notification de bureau.', defaut: true, outils: ['notifier_desktop'], code: NOTIFICATIONS },
  { id: 'systeme', nom: 'Système', description: 'OS, CPU, mémoire, uptime de la machine.', defaut: true, outils: ['infos_systeme'], code: SYSTEME },
  { id: 'ouvrir', nom: 'Ouvrir', description: 'Ouvrir un fichier, un dossier ou une URL.', defaut: false, outils: ['ouvrir_chemin'], code: OUVRIR },
  { id: 'texte', nom: 'Texte', description: 'Mots, caractères, lignes et paragraphes.', defaut: false, outils: ['analyser_texte'], code: TEXTE }
];

module.exports = { CATALOGUE };
