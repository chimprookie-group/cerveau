#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Construit un paquet pacman installable (.pkg.tar.zst) pour Cerveau.
# Cible : Arch Linux / Omarchy (x86_64).
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$RACINE/package.json').version")"
NOM="cerveau"
REL="1"
ARCH="x86_64"

DIST="$RACINE/dist"
PKGROOT="$DIST/pkg"
PAQUET="$DIST/${NOM}-${VERSION}-${REL}-${ARCH}.pkg.tar.zst"

echo "▸ Nettoyage"
rm -rf "$DIST"
mkdir -p "$PKGROOT"

echo "▸ Copie du moteur Electron"
mkdir -p "$PKGROOT/opt/$NOM"
cp -a "$RACINE/node_modules/electron/dist/." "$PKGROOT/opt/$NOM/electron/"
# le binaire doit s'appeler 'electron' (c'est déjà le cas dans dist/)
chmod 4755 "$PKGROOT/opt/$NOM/electron/chrome-sandbox"

echo "▸ Copie de l'application"
mkdir -p "$PKGROOT/opt/$NOM/app"
cp -a "$RACINE/electron" "$PKGROOT/opt/$NOM/app/"
cp -a "$RACINE/src" "$PKGROOT/opt/$NOM/app/"
cp -a "$RACINE/build" "$PKGROOT/opt/$NOM/app/"
cp -a "$RACINE/package.json" "$PKGROOT/opt/$NOM/app/"

echo "▸ Lanceur"
mkdir -p "$PKGROOT/usr/bin"
cat > "$PKGROOT/usr/bin/$NOM" <<'LAUNCHER'
#!/bin/sh
# Lanceur Cerveau — assistant IA de bureau avec coffre Obsidian
exec /opt/cerveau/electron/electron \
  --ozone-platform-hint=auto \
  --enable-features=WaylandWindowDecorations \
  /opt/cerveau/app "$@"
LAUNCHER
chmod 755 "$PKGROOT/usr/bin/$NOM"

echo "▸ Fichier .desktop"
mkdir -p "$PKGROOT/usr/share/applications"
cat > "$PKGROOT/usr/share/applications/$NOM.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Cerveau
GenericName=Assistant IA
GenericName[fr]=Assistant IA
Comment=Assistant IA francophone avec coffre Obsidian intégré
Comment[fr]=Assistant IA francophone avec coffre Obsidian intégré
Exec=/usr/bin/cerveau %U
Icon=cerveau
Terminal=false
Categories=Office;Utility;Development;
Keywords=ia;ai;assistant;obsidian;notes;markdown;claude;deepseek;
StartupWMClass=Cerveau
StartupNotify=true
DESKTOP

echo "▸ Icônes"
for taille in 16 32 48 64 128 256 512; do
  src="$RACINE/build/icon-${taille}.png"
  [ -f "$src" ] || continue
  dossier="$PKGROOT/usr/share/icons/hicolor/${taille}x${taille}/apps"
  mkdir -p "$dossier"
  cp "$src" "$dossier/$NOM.png"
done
mkdir -p "$PKGROOT/usr/share/pixmaps"
cp "$RACINE/build/icon-256.png" "$PKGROOT/usr/share/pixmaps/$NOM.png"

echo "▸ Métadonnées du paquet"
TAILLE_INSTALLEE="$(du -sb "$PKGROOT" | cut -f1)"

cat > "$PKGROOT/.PKGINFO" <<PKGINFO
pkgname = $NOM
pkgbase = $NOM
pkgver = $VERSION-$REL
pkgdesc = Assistant IA francophone avec coffre Obsidian intégré
url = https://github.com/local/cerveau
builddate = $(date +%s)
packager = chimp <chimp@localhost>
size = $TAILLE_INSTALLEE
arch = $ARCH
license = MIT
depend = gtk3
depend = nss
depend = libxss
depend = libnotify
depend = libsecret
depend = alsa-lib
depend = libcups
depend = libdrm
depend = mesa
depend = libxkbcommon
depend = libglvnd
optdepend = obsidian: ouverture directe des notes dans l'application Obsidian
optdepend = github-cli: intégration GitHub (clone, commits, pull requests)
PKGINFO

cat > "$PKGROOT/.INSTALL" <<'INSTALL'
post_install() {
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true
  update-desktop-database -q /usr/share/applications 2>/dev/null || true
  echo "Cerveau installé. Lancez-le avec la commande « cerveau » ou depuis votre menu d'applications."
}

post_upgrade() { post_install; }

post_remove() {
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true
  update-desktop-database -q /usr/share/applications 2>/dev/null || true
}
INSTALL

> "$PKGROOT/.MTREE"

echo "▸ Empaquetage"
( cd "$PKGROOT" && bsdtar --zstd -cf "$PAQUET" .PKGINFO .INSTALL .MTREE opt usr )

echo
echo "✓ Paquet créé : $PAQUET"
echo "  Taille       : $(du -h "$PAQUET" | cut -f1)"
echo
echo "  Installation : sudo pacman -U $PAQUET"
