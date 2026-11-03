#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
#  Cerveau — installateur pour Omarchy / Arch Linux
#
#  Usage :
#    curl -fsSL https://raw.githubusercontent.com/chimprookie-group/cerveau/main/install.sh | bash
#
#  Ou, après téléchargement :
#    chmod +x install.sh && ./install.sh
#
#  Le script :
#    1. vérifie qu'on est bien sur Arch/Omarchy
#    2. installe les dépendances manquantes
#    3. récupère la dernière version publiée
#    4. installe le paquet avec pacman
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail

DEPOT="chimprookie-group/cerveau"
NOM="cerveau"

ROUGE=$'\033[0;31m'; VERT=$'\033[0;32m'; JAUNE=$'\033[0;33m'
BLEU=$'\033[0;34m'; GRAS=$'\033[1m'; RAZ=$'\033[0m'

info()  { printf '%s▸%s %s\n' "$BLEU" "$RAZ" "$*"; }
ok()    { printf '%s✓%s %s\n' "$VERT" "$RAZ" "$*"; }
attention() { printf '%s!%s %s\n' "$JAUNE" "$RAZ" "$*"; }
erreur() { printf '%s✗%s %s\n' "$ROUGE" "$RAZ" "$*" >&2; }
titre() { printf '\n%s%s%s\n' "$GRAS" "$*" "$RAZ"; }

# ── 1. Vérifications système ──────────────────────────────────────────
titre "Cerveau — installation"

if ! command -v pacman >/dev/null 2>&1; then
  erreur "Ce script est prévu pour Arch Linux ou Omarchy (pacman introuvable)."
  echo "  Sur une autre distribution, consulte la documentation du dépôt."
  exit 1
fi

if [ "$(uname -m)" != "x86_64" ] && [ "$(uname -m)" != "aarch64" ]; then
  erreur "Architecture non prise en charge : $(uname -m)"
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  erreur "Ne lance pas ce script en root."
  echo "  Il élèvera les privilèges lui-même (pkexec ou sudo)."
  exit 1
fi

# ── Élévation de privilèges ───────────────────────────────────────────
# On préfère pkexec : une fenêtre graphique s'ouvre, sans terminal.
# Repli sur sudo si pkexec est absent (serveur, session TTY).
if [ -n "${CERVEAU_ROOT_CMD:-}" ]; then
  ROOT_CMD="$CERVEAU_ROOT_CMD"
elif command -v pkexec >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  ROOT_CMD="pkexec"
elif command -v sudo >/dev/null 2>&1; then
  ROOT_CMD="sudo"
elif command -v pkexec >/dev/null 2>&1; then
  ROOT_CMD="pkexec"
else
  erreur "Ni pkexec ni sudo n'est disponible. Installe l'un des deux."
  exit 1
fi

# pkexec n'accepte pas les chemins relatifs : on impose l'absolu
as_root() {
  case "$ROOT_CMD" in
    pkexec)
      local abs="$1"; shift
      case "$abs" in
        /*) ;; # déjà absolu
        *) abs="$(command -v "$abs" 2>/dev/null || printf '%s' "$abs")" ;;
      esac
      pkexec "$abs" "$@"
      ;;
    *)
      $ROOT_CMD "$@"
      ;;
  esac
}

# Session graphique : utile pour prévenir des problèmes Wayland
SESSION="${XDG_SESSION_TYPE:-inconnue}"
info "Système : $(uname -m) · session $SESSION"
info "Élévation : $ROOT_CMD"

# ── 2. Dépendances ────────────────────────────────────────────────────
titre "Dépendances"

DEPENDANCES=(gtk3 nss libxss libnotify libsecret alsa-lib libcups libdrm
             mesa libxkbcommon libglvnd libxcomposite libxdamage libxrandr
             at-spi2-core pango cairo)

MANQUANTES=()
MANQUANTES_OPT=()
for paquet in "${DEPENDANCES[@]}"; do
  if ! pacman -Qq "$paquet" >/dev/null 2>&1; then
    MANQUANTES+=("$paquet")
  fi
done

if [ ${#MANQUANTES[@]} -gt 0 ]; then
  info "Installation de ${#MANQUANTES[@]} dépendance(s) manquante(s)…"
  as_root pacman -S --needed --noconfirm "${MANQUANTES[@]}"
else
  ok "Toutes les dépendances sont déjà présentes."
fi

# ── 3. Outils externes dont dépendent des fonctions intégrées ────────
# git est une dépendance du paquet. gh et node sont facultatifs dans le
# PKGBUILD car ils peuvent venir de mise/nvm/asdf : on les cherche donc
# dans le PATH, pas seulement via pacman, et on propose de les installer.
verifier_binaire() {
  command -v "$1" >/dev/null 2>&1
}

if ! verifier_binaire git; then
  attention "git absent — la gestion de version sera indisponible."
fi

if ! verifier_binaire gh; then
  MANQUANTES_OPT+=("github-cli")
  attention "GitHub CLI absent — l'onglet Dépôt, le Superviseur et les pull requests seront indisponibles."
fi

if ! verifier_binaire node || ! verifier_binaire npm; then
  MANQUANTES_OPT+=("nodejs" "npm")
  attention "Node.js ou npm absent — les serveurs MCP (git, sqlite, mémoire…) ne démarreront pas."
fi

if [ ${#MANQUANTES_OPT[@]} -gt 0 ]; then
  echo
  info "Ces paquets complètent les fonctions GitHub et MCP :"
  echo "    ${MANQUANTES_OPT[*]}"
  echo
  # sans terminal interactif (curl | bash), on n'attend pas de réponse
  if [ -t 0 ]; then
    printf 'Les installer maintenant ? [O/n] '
    read -r REPONSE
    case "${REPONSE:-O}" in
      O|o|Y|y|"")
        as_root pacman -S --needed --noconfirm "${MANQUANTES_OPT[@]}" \
          && ok "Outils complémentaires installés." \
          || attention "Installation partielle — utilisez Réglages → Superviseur → Outils système pour voir ce qui manque."
        ;;
      *) attention "Ignoré. Vous pourrez les installer plus tard : Réglages → Superviseur." ;;
    esac
  else
    info "Relancez : sudo pacman -S --needed ${MANQUANTES_OPT[*]}"
  fi
fi

if ! pacman -Qq obsidian >/dev/null 2>&1; then
  attention "Obsidian absent — le bouton « Ouvrir dans Obsidian » sera inactif (facultatif)."
fi

# ── 4. Téléchargement ─────────────────────────────────────────────────
titre "Téléchargement"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Dernière version publiée
if command -v curl >/dev/null 2>&1; then
  TELECURL="curl -fsSL"
elif command -v wget >/dev/null 2>&1; then
  TELECURL="wget -qO-"
else
  erreur "curl ou wget est requis."
  exit 1
fi

info "Recherche de la dernière version…"
API="https://api.github.com/repos/${DEPOT}/releases/latest"
VERSION=""
if REPONSE=$($TELECURL "$API" 2>/dev/null); then
  VERSION=$(printf '%s' "$REPONSE" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' \
            | head -1 | sed 's/.*"\([^"]*\)"$/\1/' | sed 's/^v//')
fi

if [ -z "$VERSION" ]; then
  erreur "Impossible de déterminer la dernière version."
  echo "  Vérifie ta connexion, ou installe manuellement depuis :"
  echo "  https://github.com/${DEPOT}/releases"
  exit 1
fi
ok "Dernière version : $VERSION"

PAQUET="${NOM}-${VERSION}-1-$(uname -m).pkg.tar.zst"
URL="https://github.com/${DEPOT}/releases/download/v${VERSION}/${PAQUET}"

info "Téléchargement du paquet ($PAQUET)…"
if ! $TELECURL "$URL" > "$TMP/$PAQUET" 2>/dev/null; then
  erreur "Téléchargement échoué : $URL"
  exit 1
fi

TAILLE=$(du -h "$TMP/$PAQUET" | cut -f1)
ok "Paquet téléchargé ($TAILLE)"

# ── 5. Vérification d'intégrité ───────────────────────────────────────
info "Vérification de la somme SHA-256…"
URLSOMME="${URL}.sha256"
if SOMME=$($TELECURL "$URLSOMME" 2>/dev/null); then
  ATTENDUE=$(printf '%s' "$SOMME" | awk '{print $1}')
  OBTENUE=$(sha256sum "$TMP/$PAQUET" | awk '{print $1}')
  if [ "$ATTENDUE" != "$OBTENUE" ]; then
    erreur "La somme SHA-256 ne correspond pas — téléchargement corrompu."
    exit 1
  fi
  ok "Intégrité vérifiée."
else
  attention "Somme SHA-256 indisponible, vérification ignorée."
fi

# ── 6. Installation ───────────────────────────────────────────────────
titre "Installation"
info "Installation avec pacman…"
as_root pacman -U --noconfirm "$TMP/$PAQUET"

# ── 7. Finalisation ───────────────────────────────────────────────────
gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true
update-desktop-database -q /usr/share/applications 2>/dev/null || true

titre "Terminé"
ok "Cerveau $VERSION est installé."
echo
echo "  Lance-le avec :  ${GRAS}cerveau${RAZ}"
echo "  Ou depuis ton menu d'applications (catégorie Bureau)."
echo
echo "  Première utilisation :"
echo "    1. Réglages → Fournisseurs : ajoute une clé d'API"
echo "    2. Réglages → Coffres : ouvre ton coffre Obsidian"
echo "    3. Réglages → Espace de travail : choisis un projet (mode Code)"
echo
