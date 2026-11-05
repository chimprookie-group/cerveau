'use strict';

/**
 * Plugins locaux : extensions JavaScript chargées dans le processus principal.
 *
 * Un fichier = un plugin, dans ~/.config/cerveau/plugins/<id>.js :
 *
 *   module.exports = {
 *     nom: 'Mon plugin',
 *     description: 'Ce qu’il apporte',
 *     outils: [{
 *       nom: 'mon_outil',
 *       description: 'Ce que fait l’outil',
 *       schema: { type: 'object', properties: {} },
 *       risque: 'lecture',              // lecture | ecriture | commande
 *       executer: async (args, ctx) => ({ resultat: '…' })
 *     }]
 *   };
 *
 * Les outils sont exposés à l'agent sous le nom plugin_<fichier>_<outil>.
 *
 * SÉCURITÉ : un plugin s'exécute avec les privilèges de l'application (accès aux
 * fichiers, réseau, processus). N'installe que du code que tu as lu ou écrit.
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const DOSSIER = path.join(config.APP_DIR, 'plugins');
const PREFIXE = 'plugin_';
const MAX_FICHIERS = 40;
const MAX_CODE = 200000;

const EXEMPLE = `'use strict';

// Exemple de plugin Cerveau — modifie-le ou supprime-le librement.
module.exports = {
  nom: 'Exemple',
  description: 'Deux outils de démonstration : heure locale et compteur de mots',

  outils: [
    {
      nom: 'heure',
      description: "Renvoie l'heure et la date locales.",
      schema: { type: 'object', properties: {} },
      risque: 'lecture',
      executer: async () => ({
        heure: new Date().toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'medium' })
      })
    },
    {
      nom: 'compter_mots',
      description: "Compte les mots d'un texte.",
      schema: {
        type: 'object',
        properties: { texte: { type: 'string', description: 'Le texte à compter' } },
        required: ['texte']
      },
      risque: 'lecture',
      executer: async (args) => ({
        mots: String(args.texte || '').trim().split(/\\s+/).filter(Boolean).length,
        caracteres: String(args.texte || '').length
      })
    }
  ]
};
`;

/* -------------------------------- utilitaires --------------------------- */

function identifiant(brut) {
  const id = String(brut || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  if (!id) throw new Error('Nom de plugin invalide.');
  return id;
}

function assurerDossier() {
  fs.mkdirSync(DOSSIER, { recursive: true, mode: 0o700 });
  const fichiers = fs.readdirSync(DOSSIER).filter((f) => f.endsWith('.js'));
  if (!fichiers.length) {
    fs.writeFileSync(path.join(DOSSIER, 'exemple.js'), EXEMPLE, { mode: 0o600 });
  }
}

function fichiersPlugins() {
  assurerDossier();
  return fs.readdirSync(DOSSIER)
    .filter((f) => f.endsWith('.js') && !f.startsWith('.'))
    .slice(0, MAX_FICHIERS)
    .sort();
}

/* -------------------------------- chargeur ------------------------------ */

const etat = { charge: false, outils: [], parNom: new Map(), plugins: [] };

function charger({ force = false } = {}) {
  if (etat.charge && !force) return resume();

  // les autotests vérifient des comptes d'outils stables : pas de plugins
  if (process.env.CERVEAU_SANS_PLUGINS === '1') {
    etat.charge = true;
    etat.outils = [];
    etat.parNom = new Map();
    etat.plugins = [];
    return resume();
  }

  const outils = [];
  const parNom = new Map();
  const plugins = [];

  for (const fichier of fichiersPlugins()) {
    const complet = path.join(DOSSIER, fichier);
    const id = path.basename(fichier, '.js');
    try {
      // rechargement à chaud : on repart du fichier sur le disque
      delete require.cache[require.resolve(complet)];
      const mod = require(complet);

      if (!mod || typeof mod !== 'object' || !Array.isArray(mod.outils)) {
        throw new Error("le module doit exporter un tableau « outils ».");
      }

      let ajoutes = 0;
      for (const outil of mod.outils) {
        if (!outil || typeof outil.nom !== 'string' || typeof outil.executer !== 'function') {
          continue;
        }
        const nom = `${PREFIXE}${identifiant(id)}_${identifiant(outil.nom)}`;
        const definition = {
          nom,
          description: `[plugin ${mod.nom || id}] ${outil.description || ''}`.trim(),
          schema: outil.schema || { type: 'object', properties: {} },
          risque: ['lecture', 'ecriture', 'commande', 'destructif'].includes(outil.risque)
            ? outil.risque : 'ecriture',
          executer: async (args, ctx) => outil.executer(args || {}, ctx)
        };
        outils.push(definition);
        parNom.set(nom, definition);
        ajoutes += 1;
      }

      plugins.push({
        fichier,
        id,
        nom: mod.nom || id,
        description: mod.description || '',
        outils: ajoutes,
        erreur: null
      });
    } catch (err) {
      plugins.push({
        fichier,
        id,
        nom: id,
        description: '',
        outils: 0,
        erreur: String(err?.message || err)
      });
    }
  }

  etat.charge = true;
  etat.outils = outils;
  etat.parNom = parNom;
  etat.plugins = plugins;
  return resume();
}

function resume() {
  return {
    dossier: DOSSIER,
    plugins: etat.plugins,
    outils: etat.outils.map((o) => ({ nom: o.nom, description: o.description, risque: o.risque })),
    total: etat.outils.length
  };
}

/** Outils chargés (charge au premier appel). */
function outils() {
  charger();
  return etat.outils;
}

const PAR_NOM = {
  get: (nom) => {
    charger();
    return etat.parNom.get(nom);
  },
  has: (nom) => {
    charger();
    return etat.parNom.has(nom);
  }
};

function recharger() {
  return charger({ force: true });
}

/* ------------------------------ édition --------------------------------- */

function ajouter({ nom, code, description = '' }) {
  const id = identifiant(nom);
  const propre = String(code || '').trim();
  if (!propre) throw new Error('Le code du plugin est vide.');
  if (propre.length > MAX_CODE) throw new Error('Code de plugin trop long (200 000 caractères max).');

  assurerDossier();
  const fichier = path.join(DOSSIER, `${id}.js`);
  const entete = description
    ? `// ${String(description).replace(/\n/g, ' ').slice(0, 200)}\n`
    : '';
  fs.writeFileSync(fichier, `${entete}${propre}\n`, { mode: 0o600 });
  return { ...charger({ force: true }), fichier };
}

function supprimer(fichier) {
  const base = path.basename(String(fichier || ''));
  if (!/^[a-z0-9_-]+\.js$/i.test(base)) throw new Error('Nom de fichier de plugin invalide.');
  const complet = path.join(DOSSIER, base);
  if (!complet.startsWith(DOSSIER + path.sep)) throw new Error('Chemin hors du dossier des plugins.');
  fs.rmSync(complet, { force: true });
  return charger({ force: true });
}

module.exports = {
  DOSSIER,
  PREFIXE,
  EXEMPLE,
  assurerDossier,
  charger,
  recharger,
  resume,
  outils,
  PAR_NOM,
  ajouter,
  supprimer
};
