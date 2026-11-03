#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# Construit l'archive source distribuable de Cerveau.
#
#   npm run dist        → dist/cerveau-<version>.tar.gz + empreinte SHA-256
#
# L'archive contient Electron précompilé (aucune compilation côté
# utilisateur) ainsi que tout ce que la PKGBUILD attend.
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$RACINE/package.json').version")"
NOM="cerveau"
DIST="$RACINE/dist"
TRAVAIL="$DIST/build"

echo "▸ Cerveau $VERSION — préparation"

if [ ! -d "$RACINE/node_modules/electron/dist" ]; then
  echo "  Installation des dépendances…"
  ( cd "$RACINE" && npm install --no-audit --no-fund )
  ( cd "$RACINE" && node node_modules/electron/install.js )
fi

rm -rf "$TRAVAIL"
mkdir -p "$TRAVAIL/$NOM-$VERSION"

CIBLE="$TRAVAIL/$NOM-$VERSION"

echo "▸ Copie du moteur Electron"
cp -a "$RACINE/node_modules/electron/dist" "$CIBLE/electron"
# On CONSERVE resources/default_app.asar : Electron refuse de démarrer sans lui
# (il sert de repli quand aucun point d'entrée n'est trouvé). Le retirer provoque
# un arrêt immédiat avec code 1, sans le moindre message d'erreur.

echo "▸ Copie de l'application"
mkdir -p "$CIBLE/app"
cp -a "$RACINE/electron" "$CIBLE/app/electron"
cp -a "$RACINE/src" "$CIBLE/app/src"
cp -a "$RACINE/package.json" "$CIBLE/app/package.json"
mkdir -p "$CIBLE/app/build"
cp -a "$RACINE/build/icon.png" "$CIBLE/app/build/icon.png"
# retire l'autotest de la distribution publique
rm -f "$CIBLE/app/electron/selftest.js"

echo "▸ Métadonnées du paquet"
cp "$RACINE/pkg/cerveau.desktop" "$CIBLE/cerveau.desktop"
cp "$RACINE/pkg/cerveau.metainfo.xml" "$CIBLE/cerveau.metainfo.xml"
mkdir -p "$CIBLE/icons/scalable"
cp "$RACINE/pkg/icons/scalable/cerveau.svg" "$CIBLE/icons/scalable/cerveau.svg"
for taille in 16 24 32 48 64 128 256 512; do
  cp "$RACINE/build/icon-${taille}.png" "$CIBLE/icons/cerveau-${taille}.png"
done
cp "$RACINE/LICENSE" "$CIBLE/LICENSE"

echo "▸ Normalisation des permissions"
# Les fichiers de travail peuvent être en 600 (espace personnel) : on remet des
# droits lisibles par tous, sinon l'application installée ne peut pas se lire
# elle-même et échoue avec EACCES.
find "$CIBLE" -type d -exec chmod 755 {} +
find "$CIBLE" -type f -exec chmod 644 {} +
find "$CIBLE/electron" -type f -name 'electron' -exec chmod 755 {} +
find "$CIBLE/electron" -type f -name 'chrome_crashpad_handler' -exec chmod 755 {} +
find "$CIBLE/electron" -type f -name 'chrome-sandbox' -exec chmod 755 {} +
chmod 755 "$CIBLE/install.sh" 2>/dev/null || true

echo "▸ Archive"
ARCHIVE="$DIST/${NOM}-${VERSION}.tar.gz"
rm -f "$ARCHIVE"
( cd "$TRAVAIL" && tar czf "$ARCHIVE" "$NOM-$VERSION" )

echo "▸ Empreinte"
( cd "$DIST" && sha256sum "$(basename "$ARCHIVE")" | tee "${NOM}-${VERSION}.tar.gz.sha256" )

rm -rf "$TRAVAIL"

# makepkg exige que la source déclarée dans le PKGBUILD soit présente dans pkg/.
# On crée le lien ici pour que « cd pkg && makepkg -si » fonctionne sans étape
# manuelle, comme l'indique le README.
if [ -d "$RACINE/pkg" ]; then
  rm -f "$RACINE/pkg/${NOM}-${VERSION}.tar.gz"
  ln -s "../dist/${NOM}-${VERSION}.tar.gz" "$RACINE/pkg/${NOM}-${VERSION}.tar.gz"
  echo "▸ Lien de source créé dans pkg/"
fi

TAILLE="$(du -h "$ARCHIVE" | cut -f1)"
echo
echo "✓ Archive prête : $ARCHIVE ($TAILLE)"
echo
echo "  Construire le paquet :"
echo "    cd pkg && makepkg -si"
echo
echo "  Ou installer directement :"
echo "    sudo pacman -U pkg/cerveau-${VERSION}-1-x86_64.pkg.tar.zst"
