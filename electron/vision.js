'use strict';

/**
 * Outil « voir_image » : lit une image du coffre ou de l'espace de travail et
 * la joint au modèle (vision).
 *
 * Le rendu est un data URL transmis au processus principal ; l'agent le
 * présente ensuite au fournisseur dans le format attendu (bloc image pour
 * Anthropic, image_url pour OpenAI). Le texte du résultat d'outil ne contient
 * jamais le base64 complet.
 */

const path = require('node:path');
const fsp = require('node:fs/promises');

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

// Les API acceptent 5 Mo par image ; on garde de la marge pour le base64.
const MAX_OCTETS = 4 * 1024 * 1024;

function racines(ctx) {
  return [ctx?.workspace, ctx?.vaultPath]
    .filter(Boolean)
    .map((r) => path.resolve(r));
}

/** Résout un chemin d'image, en refusant toute sortie du coffre / workspace. */
async function resoudre(ctx, chemin) {
  const brut = String(chemin || '').trim();
  if (!brut) throw new Error('Chemin vide.');

  const racinesAutorisees = racines(ctx);
  if (!racinesAutorisees.length) {
    throw new Error("Aucun coffre ni espace de travail ouvert : impossible de lire une image.");
  }

  const essais = path.isAbsolute(brut)
    ? [path.resolve(brut)]
    : racinesAutorisees.map((r) => path.resolve(r, brut));

  for (const cible of essais) {
    const dedans = racinesAutorisees.some(
      (r) => cible === r || cible.startsWith(r + path.sep)
    );
    if (!dedans) continue;
    try {
      const st = await fsp.stat(cible);
      if (st.isFile()) return { cible, st };
    } catch { /* on essaie la racine suivante */ }
  }

  throw new Error(`Image introuvable dans le coffre ou l'espace de travail : ${brut}`);
}

const OUTILS_VISION = [
  {
    nom: 'voir_image',
    description: "Ouvre une image (capture d'écran, schéma, photo, graphique) du coffre ou de l'espace de travail et la montre au modèle. Formats : PNG, JPEG, WebP, GIF. À utiliser dès qu'une réponse dépend du contenu visuel d'un fichier.",
    schema: {
      type: 'object',
      properties: {
        chemin: {
          type: 'string',
          description: "Chemin de l'image, relatif au coffre ou à l'espace de travail (ou absolu dans l'un des deux)."
        }
      },
      required: ['chemin']
    },
    risque: 'lecture',
    executer: async (args, ctx) => {
      const { cible, st } = await resoudre(ctx, args.chemin);

      const extension = path.extname(cible).toLowerCase();
      const mediaType = MIME[extension];
      if (!mediaType) {
        throw new Error(`Format non pris en charge (${extension || 'inconnu'}) : PNG, JPEG, WebP ou GIF attendu.`);
      }
      if (st.size > MAX_OCTETS) {
        throw new Error(`Image trop lourde (${Math.round(st.size / 1024)} Ko) : maximum ${MAX_OCTETS / 1024 / 1024} Mo.`);
      }
      if (st.size === 0) throw new Error('Fichier image vide.');

      const base64 = (await fsp.readFile(cible)).toString('base64');
      const racine = racines(ctx).find((r) => cible === r || cible.startsWith(r + path.sep)) || path.dirname(cible);
      const relatif = path.relative(racine, cible) || path.basename(cible);

      return {
        nom: path.basename(cible),
        chemin: relatif,
        media_type: mediaType,
        taille_ko: Math.round(st.size / 1024),
        note: "L'image est jointe à la conversation : décris ce que tu y vois, puis réponds.",
        // champ interne : consommé par l'agent, retiré du texte du résultat
        image: {
          dataUrl: `data:${mediaType};base64,${base64}`,
          mime: mediaType,
          nom: path.basename(cible)
        }
      };
    }
  }
];

const PAR_NOM = new Map(OUTILS_VISION.map((o) => [o.nom, o]));

module.exports = { OUTILS_VISION, PAR_NOM, MIME, MAX_OCTETS, resoudre };
