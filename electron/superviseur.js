'use strict';

/**
 * Superviseur — surveille un dépôt GitHub et transforme les demandes autorisées
 * en tickets exécutés par l'agent.
 *
 * Inspiré de l'idée de dsh-superagent (DeepSeek) : « prendre le moins d'attention
 * humaine possible, apporter le plus de valeur possible ». L'agent n'agit que
 * lorsqu'on le lui demande, ou qu'une règle écrite par l'équipe l'y autorise, et
 * ne parle que si quelqu'un doit agir ou peut tirer parti du résultat.
 *
 * Différence d'implémentation : ici il n'y a pas d'hôte cordis ni de sessions
 * DSH. Le Superviseur tourne dans le processus principal de Cerveau, interroge
 * l'API GitHub à intervalle régulier et exécute chaque ticket avec la boucle
 * agentique existante (`agent.run`).
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const github = require('./github');

const INTERVALLE_MIN = 60;        // secondes : jamais plus fréquent que 1 min
const INTERVALLE_DEFAUT = 300;    // 5 min
const MAX_TICKETS_ACTIFS = 3;     // exécutions simultanées
const MAX_TICKETS_GARDES = 200;

/* ------------------------------ utilitaires ----------------------------- */

function maintenant() {
  return Date.now();
}

function identifiant(prefixe) {
  return `${prefixe}_${maintenant().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Réduit un texte à une phrase courte, pour l'affichage. */
function resumer(texte, longueur = 90) {
  const propre = String(texte || '').replace(/\s+/g, ' ').trim();
  return propre.length > longueur ? `${propre.slice(0, longueur - 1)}…` : propre;
}

/**
 * Extrait la consigne d'un texte de déclenchement.
 * Reconnaît « @cerveau fais ceci », « /cerveau fais ceci », « @bot fais ceci ».
 */
function extraireConsigne(texte, motif = '@cerveau') {
  const brut = String(texte || '');
  const motifEchappe = motif.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${motifEchappe}[\\s,:]*([\\s\\S]*)`, 'i');
  const m = brut.match(re);
  if (!m) return null;
  const consigne = m[1].trim();
  return consigne || null;
}

/** Vrai si l'auteur fait partie de la liste autorisée. */
function auteurAutorise(auteur, liste) {
  if (!Array.isArray(liste) || !liste.length) return false;
  const nom = String(auteur || '').toLowerCase();
  return liste.some((x) => String(x).toLowerCase().trim() === nom);
}

/* -------------------------------- état ---------------------------------- */

/**
 * Le Superviseur conserve son état dans un fichier JSON distinct de la config,
 * pour ne pas la faire grossir et pour survivre aux redémarrages.
 */
class EtatSuperviseur {
  constructor(fichier) {
    this.fichier = fichier;
    this.donnees = { tickets: [], dernierPassage: null, erreurs: [] };
    this.charge = false;
  }

  async charger() {
    if (this.charge) return this.donnees;
    try {
      const brut = await fsp.readFile(this.fichier, 'utf8');
      const parse = JSON.parse(brut);
      this.donnees = {
        tickets: Array.isArray(parse.tickets) ? parse.tickets : [],
        dernierPassage: parse.dernierPassage || null,
        erreurs: Array.isArray(parse.erreurs) ? parse.erreurs : []
      };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // fichier illisible : on repart proprement sans perdre l'ancien
        try { await fsp.rename(this.fichier, `${this.fichier}.corrompu-${Date.now()}`); } catch { /* ignore */ }
      }
    }
    this.charge = true;
    return this.donnees;
  }

  async enregistrer() {
    // borne l'historique pour ne pas gonfler le fichier
    this.donnees.tickets = this.donnees.tickets
      .sort((a, b) => (b.creeLe || 0) - (a.creeLe || 0))
      .slice(0, MAX_TICKETS_GARDES);

    const dossier = path.dirname(this.fichier);
    await fsp.mkdir(dossier, { recursive: true });
    const temporaire = `${this.fichier}.tmp`;
    await fsp.writeFile(temporaire, JSON.stringify(this.donnees, null, 2), { mode: 0o600 });
    await fsp.rename(temporaire, this.fichier);
  }

  ajouterTicket(ticket) {
    this.donnees.tickets.unshift(ticket);
    if (this.donnees.tickets.length > MAX_TICKETS_GARDES) {
      this.donnees.tickets.length = MAX_TICKETS_GARDES;
    }
    return ticket;
  }

  trouverTicket(id) {
    return this.donnees.tickets.find((t) => t.id === id);
  }

  ticketsActifs() {
    return this.donnees.tickets.filter((t) => t.etat === 'en_cours' || t.etat === 'en_attente');
  }

  noterErreur(message) {
    this.donnees.erreurs.unshift({ quand: maintenant(), message: String(message).slice(0, 400) });
    this.donnees.erreurs = this.donnees.erreurs.slice(0, 30);
  }
}

/* ------------------------- surveillance du dépôt ------------------------ */

/**
 * Interroge GitHub et renvoie les nouveaux déclencheurs depuis le dernier passage.
 *
 * Sources surveillées :
 *  - Issues ouvertes ou commentées où le motif d'invocation apparaît
 *  - Commentaires de pull requests
 *  - Nouvelles issues (si l'option est activée)
 */
async function collecterDeclencheurs(config, depuis) {
  const depot = config.depot;
  if (!depot) return [];

  const declencheurs = [];
  const motif = config.motifInvocation || '@cerveau';

  // 1. issues et commentaires récents
  let issues = [];
  try {
    issues = await github.ghJson([
      'issue', 'list', '--repo', depot, '--state', 'open',
      '--limit', String(Math.min(config.limiteParPassage || 20, 50)),
      '--json', 'number,title,body,author,createdAt,updatedAt,url,comments'
    ]);
  } catch (err) {
    throw new Error(`Lecture des issues impossible : ${err.message}`);
  }

  for (const issue of issues || []) {
    const auteur = issue.author?.login || '';
    const corps = issue.body || '';
    const jetons = [];

    // le corps de l'issue porte-t-il l'invocation ?
    const consigneCorps = extraireConsigne(corps, motif);
    if (consigneCorps) {
      jetons.push({
        genre: 'issue',
        numero: issue.number,
        titre: issue.title || '',
        texte: corps,
        consigne: consigneCorps,
        auteur,
        url: issue.url,
        quand: issue.createdAt
      });
    }

    // les commentaires portent-ils l'invocation ?
    for (const c of issue.comments || []) {
      const consigne = extraireConsigne(c.body || '', motif);
      if (!consigne) continue;
      const quand = c.createdAt || c.updatedAt;
      if (depuis && quand && new Date(quand).getTime() <= depuis) continue;
      jetons.push({
        genre: 'commentaire',
        numero: issue.number,
        titre: issue.title || '',
        texte: c.body || '',
        consigne,
        auteur: c.author?.login || '',
        url: c.url || issue.url,
        quand
      });
    }

    // nouvelle issue sans invocation mais autorisée par règle ?
    if (config.surveillerNouvellesIssues && !consigneCorps) {
      const cree = issue.createdAt ? new Date(issue.createdAt).getTime() : 0;
      if (!depuis || cree > depuis) {
        jetons.push({
          genre: 'nouvelle_issue',
          numero: issue.number,
          titre: issue.title || '',
          texte: corps,
          consigne: `${issue.title || ''}\n\n${corps}`.trim(),
          auteur,
          url: issue.url,
          quand: issue.createdAt,
          sansInvocation: true
        });
      }
    }

    declencheurs.push(...jetons);
  }

  // 2. commentaires de pull requests
  if (config.surveillerPullRequests) {
    try {
      const prs = await github.ghJson([
        'pr', 'list', '--repo', depot, '--state', 'open',
        '--limit', '15', '--json', 'number,title,url,updatedAt,comments'
      ]);
      for (const pr of prs || []) {
        for (const c of pr.comments || []) {
          const consigne = extraireConsigne(c.body || '', motif);
          if (!consigne) continue;
          const quand = c.createdAt;
          if (depuis && quand && new Date(quand).getTime() <= depuis) continue;
          declencheurs.push({
            genre: 'pull_request',
            numero: pr.number,
            titre: pr.title || '',
            texte: c.body || '',
            consigne,
            auteur: c.author?.login || '',
            url: c.url || pr.url,
            quand
          });
        }
      }
    } catch { /* les PR sont optionnelles : on n'échoue pas pour elles */ }
  }

  return declencheurs;
}

/**
 * Deux déclencheurs portent-ils sur le même travail ?
 * Sert à ne pas créer deux tickets pour une même demande.
 */
function dejaTraite(tickets, decl) {
  return tickets.some((t) =>
    t.origine?.numero === decl.numero
    && t.origine?.genre === decl.genre
    && (t.origine?.consigne || '') === (decl.consigne || '')
  );
}

/* ------------------------------ exécution ------------------------------- */

/**
 * Détecte si l'agent a poussé une branche pendant son travail.
 * Sert à décider s'il faut ouvrir une pull request.
 */
async function branchePoussee(workspace, depot, avant) {
  try {
    const local = await github.etatLocal(workspace);
    if (!local?.depot) return null;
    const branche = local.branche;
    if (!branche || branche === avant) return null;
    if (/^(main|master)$/i.test(branche)) return null;
    return branche;
  } catch {
    return null;
  }
}

/** Compose le commentaire publié sur GitHub à la fin d'un ticket. */
function composerReponse(ticket, config) {
  const t = ticket.origine;
  const lignes = [];

  if (ticket.etat === 'termine') {
    lignes.push(`J'ai traité cette demande.`);
    lignes.push('');
    lignes.push(ticket.resume || 'Travail terminé.');
  } else {
    lignes.push(`Je n'ai pas pu terminer cette demande.`);
    lignes.push('');
    lignes.push(ticket.resume || 'Aucun détail disponible.');
  }

  if (ticket.erreur && ticket.etat !== 'termine') {
    lignes.push('');
    lignes.push(`Erreur : \`${String(ticket.erreur).slice(0, 300)}\``);
  }

  if (ticket.pullRequest) {
    lignes.push('');
    lignes.push(`Pull request ouverte : ${ticket.pullRequest}`);
  }

  lignes.push('');
  lignes.push('---');
  lignes.push(`*Traité par Cerveau (superviseur) en ${Math.round((ticket.duree || 0) / 1000)} s, `
    + `${ticket.outils || 0} outil(s) utilisé(s).*`);

  return lignes.join('\n');
}

/**
 * Publie le résultat sur GitHub : commentaire, et pull request si une branche
 * a été poussée. Ne bloque jamais le ticket en cas d'échec de publication.
 */
async function publierResultat(ticket, config) {
  if (config.publierResultats === false) {
    ticket.publication = { statut: 'desactivee' };
    return ticket;
  }

  const numero = ticket.origine?.numero;
  if (!numero) {
    ticket.publication = { statut: 'sans_numero' };
    return ticket;
  }

  const publication = { statut: 'aucune' };

  // 1. pull request, si une branche a été poussée
  if (ticket.etat === 'termine' && ticket.nouvelleBranche) {
    try {
      const pr = await github.creerPR(config.depot, {
        titre: `${ticket.origine.titre || 'Travail demandé'} (#${numero})`,
        corps: [
          `Répond à #${numero}.`,
          '',
          ticket.resume || ''
        ].join('\n'),
        source: ticket.nouvelleBranche,
        cible: config.brancheCible || null
      });
      ticket.pullRequest = pr?.url || null;
      publication.statut = 'pull_request';
      publication.url = pr?.url || null;
    } catch (err) {
      publication.erreurPr = String(err.message || err);
    }
  }

  // 2. commentaire de réponse
  try {
    const r = await github.commenter(config.depot, numero, composerReponse(ticket, config));
    publication.statut = publication.erreurPr ? 'commentaire_seul' : (publication.statut === 'pull_request' ? 'complet' : 'commentaire');
    publication.commentaire = r?.url || null;
  } catch (err) {
    publication.erreur = String(err.message || err);
  }

  ticket.publication = publication;
  return ticket;
}

/** Construit la consigne complète remise à l'agent. */
function construireConsigne(ticket, config) {
  const entete = [
    `Tu interviens sur le dépôt GitHub ${config.depot}.`,
    `Demande reçue de ${ticket.origine.auteur || 'un inconnu'} dans ${ticket.origine.genre} #${ticket.origine.numero} : « ${ticket.origine.titre} ».`,
    '',
    'Consigne demandée :',
    ticket.origine.consigne,
    '',
    'Règles :',
    '- Travaille dans l\'espace de travail indiqué. Ne touche à rien hors du dépôt.',
    '- Si le travail aboutit, pousse une branche et ouvre une pull request.',
    '- Termine par un résumé de ce que tu as fait, en français, sans jargon.',
    '- Si tu ne peux pas faire le travail, dis-le clairement et explique pourquoi.'
  ];
  return entete.join('\n');
}

/**
 * Exécute un ticket avec la boucle agentique de Cerveau.
 * `executeur` est injecté pour rester testable sans appel réseau.
 */
async function executerTicket(ticket, contexte) {
  const { config, gerer, executeur, emettre } = contexte;

  ticket.etat = 'en_cours';
  ticket.debutExecution = maintenant();

  // branche courante avant le travail, pour détecter un push
  let brancheAvant = null;
  try {
    const etatLocal = await github.etatLocal(config.workspace || contexte.workspace);
    brancheAvant = etatLocal?.branche || null;
  } catch { /* dépôt local absent : le push sera simplement impossible */ }

  emettre('ticket:debut', { ticket });

  const consigne = construireConsigne(ticket, config);
  const messages = [];

  try {
    const resultat = await executeur({
      consigne,
      providerId: contexte.providerId,
      credentials: contexte.credentials,
      workspace: config.workspace || contexte.workspace,
      mode: 'code',
      permissions: contexte.permissions,
      confirmer: contexte.confirmer,
      emit: (evt) => {
        if (evt.type === 'outil_debut') messages.push(`· ${evt.nom}`);
        if (evt.type === 'outil_resultat') messages.push(`  ${evt.nom} — ${evt.message || ''}`);
        if (evt.type === 'erreur') messages.push(`! ${evt.message}`);
      }
    });

    ticket.etat = 'termine';
    ticket.resume = resumer(resultat.texte || 'Travail terminé.', 400);
    ticket.outils = resultat.outils || 0;
    ticket.erreur = resultat.erreur || null;
    ticket.journal = messages.slice(-40);
  } catch (err) {
    ticket.etat = 'echoue';
    ticket.erreur = String(err.message || err);
    ticket.resume = `Échec : ${ticket.erreur}`;
  }

  ticket.finExecution = maintenant();
  ticket.duree = ticket.finExecution - ticket.debutExecution;

  // a-t-on une nouvelle branche à proposer en pull request ?
  if (ticket.etat === 'termine') {
    ticket.nouvelleBranche = await branchePoussee(config.workspace || contexte.workspace, config.depot, brancheAvant);
  }

  // publication sur GitHub : commentaire et éventuelle pull request
  try {
    await publierResultat(ticket, config);
  } catch (err) {
    ticket.publication = { statut: 'erreur', erreur: String(err.message || err) };
  }

  await gerer.enregistrer();
  emettre('ticket:fin', { ticket });

  return ticket;
}

/* ------------------------------ superviseur ----------------------------- */

class Superviseur {
  constructor(config) {
    this.config = config;
    this.etat = new EtatSuperviseur(config.fichierEtat);
    this.minuteur = null;
    this.enPassage = false;
    this.derniereErreur = null;
    this.abonnes = new Set();
  }

  surEvenement(cb) {
    this.abonnes.add(cb);
    return () => this.abonnes.delete(cb);
  }

  emettre(type, payload) {
    for (const cb of this.abonnes) {
      try { cb({ type, ...payload, quand: maintenant() }); } catch { /* ignore */ }
    }
  }

  /** Un passage : lit les déclencheurs, crée les tickets, exécute. */
  async passer(contexte) {
    if (this.enPassage) return { ignore: 'passage déjà en cours' };
    this.enPassage = true;

    try {
      await this.etat.charger();
      const depuis = this.etat.donnees.dernierPassage;

      let declencheurs = [];
      try {
        declencheurs = await collecterDeclencheurs(this.config, depuis);
        this.derniereErreur = null;
      } catch (err) {
        this.derniereErreur = err.message;
        this.etat.noterErreur(err.message);
        await this.etat.enregistrer();
        return { erreur: err.message };
      }

      const crees = [];
      for (const decl of declencheurs) {
        // autorisation : sans liste, personne n'est autorisé
        if (!auteurAutorise(decl.auteur, this.config.auteursAutorises)) continue;
        if (this.config.exigerInvocation && decl.sansInvocation) continue;
        if (dejaTraite(this.etat.donnees.tickets, decl)) continue;

        const ticket = this.etat.ajouterTicket({
          id: identifiant('ticket'),
          etat: 'en_attente',
          creeLe: maintenant(),
          depot: this.config.depot,
          origine: {
            genre: decl.genre,
            numero: decl.numero,
            titre: decl.titre,
            consigne: decl.consigne,
            auteur: decl.auteur,
            url: decl.url,
            quand: decl.quand
          },
          resume: resumer(decl.consigne, 120)
        });
        crees.push(ticket);
        this.emettre('ticket:cree', { ticket });
      }

      this.etat.donnees.dernierPassage = maintenant();
      await this.etat.enregistrer();

      // exécution des tickets en attente, dans la limite autorisée
      const aExecuter = this.etat.ticketsActifs()
        .filter((t) => t.etat === 'en_attente')
        .slice(0, Math.max(1, MAX_TICKETS_ACTIFS - this.etat.donnees.tickets.filter((t) => t.etat === 'en_cours').length));

      for (const ticket of aExecuter) {
        await executerTicket(ticket, { ...contexte, config: this.config, gerer: this.etat, emettre: (t, p) => this.emettre(t, p) });
      }

      return { declencheurs: declencheurs.length, crees: crees.length, executes: aExecuter.length };
    } finally {
      this.enPassage = false;
    }
  }

  demarrer(contexte) {
    this.arreter();
    const intervalle = Math.max(INTERVALLE_MIN, Number(this.config.intervalle) || INTERVALLE_DEFAUT) * 1000;
    this.minuteur = setInterval(() => {
      this.passer(contexte).catch(() => { /* déjà journalisé */ });
    }, intervalle);
    // un premier passage peu après le démarrage
    setTimeout(() => { this.passer(contexte).catch(() => {}); }, 3000);
    this.emettre('demarre', { intervalle });
    return { intervalle };
  }

  arreter() {
    if (this.minuteur) {
      clearInterval(this.minuteur);
      this.minuteur = null;
      this.emettre('arrete', {});
    }
  }

  estActif() {
    return Boolean(this.minuteur);
  }

  async instantane() {
    await this.etat.charger();
    return {
      actif: this.estActif(),
      config: {
        depot: this.config.depot,
        auteursAutorises: this.config.auteursAutorises,
        intervalle: this.config.intervalle,
        motifInvocation: this.config.motifInvocation
      },
      dernierPassage: this.etat.donnees.dernierPassage,
      derniereErreur: this.derniereErreur,
      tickets: this.etat.donnees.tickets.slice(0, 50),
      erreurs: this.etat.donnees.erreurs.slice(0, 10)
    };
  }
}

module.exports = {
  Superviseur,
  composerReponse,
  publierResultat,
  branchePoussee,
  collecterDeclencheurs,
  extraireConsigne,
  auteurAutorise,
  construireConsigne,
  dejaTraite,
  resumer,
  __test: { EtatSuperviseur }
};
