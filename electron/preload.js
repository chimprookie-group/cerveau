'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * Pont sécurisé entre l'interface et le processus principal.
 * Aucun accès direct à Node.js depuis la page.
 */

contextBridge.exposeInMainWorld('cerveau', {
  config: {
    obtenir: () => ipcRenderer.invoke('config:obtenir'),
    mettreAJour: (patch) => ipcRenderer.invoke('config:mettre-a-jour', patch),
    reinitialiser: () => ipcRenderer.invoke('config:reinitialiser'),
    testerFournisseur: (id, modele) => ipcRenderer.invoke('providers:tester', id, modele)
  },

  models: {
    lister: (payload) => ipcRenderer.invoke('models:lister', payload)
  },

  coffre: {
    choisir: () => ipcRenderer.invoke('coffre:choisir'),
    ajouterChemin: (p) => ipcRenderer.invoke('coffre:ajouter-chemin', p),
    activer: (id) => ipcRenderer.invoke('coffre:activer', id),
    retirer: (id) => ipcRenderer.invoke('coffre:retirer', id),
    ouvrirDansObsidian: (chemin) => ipcRenderer.invoke('coffre:ouvrir-dans-obsidian', chemin)
  },

  web: {
    tester: () => ipcRenderer.invoke('web:tester')
  },

  planification: {
    lister: () => ipcRenderer.invoke('planification:lister'),
    creer: (payload) => ipcRenderer.invoke('planification:creer', payload),
    analyser: (texte) => ipcRenderer.invoke('planification:analyser', texte),
    basculer: (payload) => ipcRenderer.invoke('planification:basculer', payload),
    executer: (id) => ipcRenderer.invoke('planification:executer', id),
    changerNiveau: (payload) => ipcRenderer.invoke('planification:niveau', payload),
    niveaux: () => ipcRenderer.invoke('planification:niveaux'),
    supprimer: (id) => ipcRenderer.invoke('planification:supprimer', id),
    surEvenement: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on('planification:evenement', h);
      return () => ipcRenderer.removeListener('planification:evenement', h);
    }
  },

  objectif: {
    lister: () => ipcRenderer.invoke('objectif:lister'),
    creer: (payload) => ipcRenderer.invoke('objectif:creer', payload),
    tour: (id) => ipcRenderer.invoke('objectif:tour', id),
    changerEtat: (payload) => ipcRenderer.invoke('objectif:etat', payload),
    supprimer: (id) => ipcRenderer.invoke('objectif:supprimer', id),
    surEvenement: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on('objectif:evenement', h);
      return () => ipcRenderer.removeListener('objectif:evenement', h);
    }
  },

  memoire: {
    lister: () => ipcRenderer.invoke('memoire:lister'),
    ajouter: (payload) => ipcRenderer.invoke('memoire:ajouter', payload),
    modifier: (payload) => ipcRenderer.invoke('memoire:modifier', payload),
    supprimer: (id) => ipcRenderer.invoke('memoire:supprimer', id),
    vider: () => ipcRenderer.invoke('memoire:vider')
  },

  diag: {
    outils: () => ipcRenderer.invoke('diag:outils')
  },

  superviseur: {
    etat: () => ipcRenderer.invoke('superviseur:etat'),
    demarrer: () => ipcRenderer.invoke('superviseur:demarrer'),
    arreter: () => ipcRenderer.invoke('superviseur:arreter'),
    passer: () => ipcRenderer.invoke('superviseur:passer'),
    reinitialiser: () => ipcRenderer.invoke('superviseur:reinitialiser'),
    surEvenement: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on('superviseur:evenement', h);
      return () => ipcRenderer.removeListener('superviseur:evenement', h);
    }
  },

  mcp: {
    etats: () => ipcRenderer.invoke('mcp:etats'),
    tester: (nom) => ipcRenderer.invoke('mcp:tester', nom),
    outils: (nom) => ipcRenderer.invoke('mcp:outils', nom),
    arreter: () => ipcRenderer.invoke('mcp:arreter')
  },

  fichiers: {
    lire: (chemin) => ipcRenderer.invoke('fichiers:lire', chemin),
    choisir: () => ipcRenderer.invoke('fichiers:choisir'),
    /**
     * Chemin réel d'un fichier déposé.
     * Depuis Electron 32, `File.path` a disparu : c'est `webUtils` qui le
     * fournit, et il n'existe que dans le processus de préchargement.
     */
    cheminDe: (fichier) => {
      try { return webUtils.getPathForFile(fichier); } catch { return null; }
    }
  },

  terminal: {
    executer: (cmd, opts) => ipcRenderer.invoke('terminal:executer', cmd, opts)
  },

  workspace: {
    choisir: () => ipcRenderer.invoke('workspace:choisir'),
    definir: (p) => ipcRenderer.invoke('workspace:definir', p),
    oublier: () => ipcRenderer.invoke('workspace:oublier'),
    infos: () => ipcRenderer.invoke('workspace:infos')
  },

  github: {
    etatAuth: () => ipcRenderer.invoke('github:etat-auth'),
    connecter: (payload) => ipcRenderer.invoke('github:connecter', payload),
    deconnecter: () => ipcRenderer.invoke('github:deconnecter'),
    listerDepots: (opts) => ipcRenderer.invoke('github:lister-depots', opts),
    cloner: (payload) => ipcRenderer.invoke('github:cloner', payload),
    creerDepot: (payload) => ipcRenderer.invoke('github:creer-depot', payload),
    choisirDossierClone: () => ipcRenderer.invoke('github:choisir-dossier-clone'),
    etatLocal: (chemin) => ipcRenderer.invoke('github:etat-local', chemin),
    historique: (chemin, opts) => ipcRenderer.invoke('github:historique', chemin, opts),
    difference: (chemin) => ipcRenderer.invoke('github:difference', chemin),
    tirer: (chemin) => ipcRenderer.invoke('github:tirer', chemin),
    envoyer: (chemin, payload) => ipcRenderer.invoke('github:envoyer', chemin, payload),
    changerBranche: (chemin, nom, creer) => ipcRenderer.invoke('github:changer-branche', chemin, nom, creer),
    listerPR: (depot, opts) => ipcRenderer.invoke('github:lister-pr', depot, opts),
    infosPR: (depot, numero) => ipcRenderer.invoke('github:infos-pr', depot, numero),
    creerPR: (depot, payload) => ipcRenderer.invoke('github:creer-pr', depot, payload),
    fusionnerPR: (depot, numero, methode) => ipcRenderer.invoke('github:fusionner-pr', depot, numero, methode),
    listerIssues: (depot, opts) => ipcRenderer.invoke('github:lister-issues', depot, opts),
    listerRuns: (depot, opts) => ipcRenderer.invoke('github:lister-runs', depot, opts),
    ouvrirUrl: (url) => ipcRenderer.invoke('github:ouvrir-url', url)
  },

  obs: {
    arborescence: () => ipcRenderer.invoke('obs:arborescence'),
    lister: () => ipcRenderer.invoke('obs:lister'),
    lire: (p) => ipcRenderer.invoke('obs:lire', p),
    ecrire: (p, c) => ipcRenderer.invoke('obs:ecrire', p, c),
    ajouter: (p, c) => ipcRenderer.invoke('obs:ajouter', p, c),
    prepend: (p, c) => ipcRenderer.invoke('obs:prepend', p, c),
    remplacer: (p, s, r, all) => ipcRenderer.invoke('obs:remplacer', p, s, r, all),
    deplacer: (de, vers) => ipcRenderer.invoke('obs:deplacer', de, vers),
    creerDossier: (p) => ipcRenderer.invoke('obs:creer-dossier', p),
    supprimer: (p) => ipcRenderer.invoke('obs:supprimer', p),
    rechercher: (q, opts) => ipcRenderer.invoke('obs:rechercher', q, opts),
    tags: () => ipcRenderer.invoke('obs:tags'),
    notesParTag: (t) => ipcRenderer.invoke('obs:notes-par-tag', t),
    liens: (p) => ipcRenderer.invoke('obs:liens', p),
    stats: () => ipcRenderer.invoke('obs:stats'),
    journal: (opts) => ipcRenderer.invoke('obs:journal', opts)
  },

  agent: {
    envoyer: (payload) => ipcRenderer.invoke('agent:envoyer', payload),
    arreter: () => ipcRenderer.invoke('agent:arreter'),
    surEvenement: (cb) => {
      const handler = (_e, data) => cb(data);
      ipcRenderer.on('agent:evenement', handler);
      return () => ipcRenderer.removeListener('agent:evenement', handler);
    },
    repondreConfirmation: (id, autorise, raison) =>
      ipcRenderer.send('agent:reponse-confirmation', { id, autorise, raison })
  },

  app: {
    infos: () => ipcRenderer.invoke('app:infos'),
    ouvrirDossierConfig: () => ipcRenderer.invoke('app:ouvrir-dossier-config'),
    ouvrirChemin: (p) => ipcRenderer.invoke('app:ouvrir-chemin', p),
    exporterConversation: (payload) => ipcRenderer.invoke('app:exporter-conversation', payload),
    exporterVersCoffre: (payload) => ipcRenderer.invoke('app:exporter-vers-coffre', payload)
  },

  menu: {
    surAction: (cb) => {
      const handler = (_e, action) => cb(action);
      ipcRenderer.on('menu', handler);
      return () => ipcRenderer.removeListener('menu', handler);
    }
  }
});
