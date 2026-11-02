#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# Prépare une publication GitHub Releases.
#
#   bash scripts/release.sh
#
# Produit dans dist/ :
#   - cerveau-<version>.tar.gz          (archive source)
#   - cerveau-<version>-1-x86_64.pkg.tar.zst  (paquet Arch)
#   - les empreintes SHA-256 des deux
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$RACINE/package.json').version")"

echo "▸ Publication Cerveau $VERSION"

bash "$RACINE/scripts/dist.sh"

echo "▸ Construction du paquet Arch"
( cd "$RACINE/pkg" && makepkg -sf --noconfirm )

PAQUET="$RACINE/pkg/cerveau-${VERSION}-1-$(uname -m).pkg.tar.zst"
if [ -f "$PAQUET" ]; then
  cp "$PAQUET" "$RACINE/dist/"
  ( cd "$RACINE/dist" && sha256sum "$(basename "$PAQUET")" > "$(basename "$PAQUET").sha256" )
  echo "✓ Paquet copié dans dist/"
fi

echo
echo "═══ Fichiers à joindre à la release GitHub ═══"
ls -lh "$RACINE/dist"/*.tar.gz "$RACINE/dist"/*.pkg.tar.zst "$RACINE/dist"/*.sha256 2>/dev/null | awk '{print "  " $9 "  (" $5 ")"}'
echo
echo "Puis :"
echo "  gh release create v$VERSION dist/*.tar.gz dist/*.pkg.tar.zst dist/*.sha256 \\"
echo "     --title \"Cerveau $VERSION\" --notes-file CHANGELOG.md"
