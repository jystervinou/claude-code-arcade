#!/usr/bin/env bash
# install.sh — set up Claude Code Arcade.
#
# Everything it touches is user-level. No sudo, nothing system-wide, and every
# step is undone by uninstall.sh:
#
#   ~/.arcade/                          runtime: frames, theme, scores
#   ~/.local/bin/arcade                 the control CLI
#   ~/Library/Fonts/ArcadeSprites.ttf   the sprite font (macOS; Linux uses
#                                       ~/.local/share/fonts)
#   ~/.claude/settings.json             the statusLine key — and only that key;
#                                       any previous value is backed up first
#
# Nothing is written until a pre-flight pass has checked every one of those
# for something that isn't ours, and asked. ARCADE_FORCE=1 skips the asking.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCADE="$HOME/.arcade"
CLI="$HOME/.local/bin/arcade"
SETTINGS="$HOME/.claude/settings.json"
say() { printf '  %-12s %s\n' "$1" "$2"; }

# The daemon needs Node. Probe PATH first, then the usual install locations —
# a statusline process does not always inherit an interactive shell's PATH,
# which is why statusline.sh probes the same list at runtime.
NODE="$(command -v node 2>/dev/null || true)"
if [ ! -x "${NODE:-}" ]; then
  for n in "$HOME/.volta/bin/node" /opt/homebrew/bin/node /usr/local/bin/node \
           "$HOME/.local/bin/node" "$HOME/n/bin/node"; do
    [ -x "$n" ] && NODE="$n" && break
  done
fi
if [ ! -x "${NODE:-}" ]; then
  echo "Claude Code Arcade needs Node.js (any recent version) for its daemon." >&2
  echo "Install it — https://nodejs.org, or 'brew install node' — then re-run." >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin) FONTDIR="$HOME/Library/Fonts" ;;
  *) FONTDIR="$HOME/.local/share/fonts" ;;
esac

# ---------------------------------------------------------------- pre-flight
# Collect everything that already exists and isn't obviously ours, then ask
# once. Plenty of things live at ~/.arcade — this is not a name we own.
WARN=()

if [ -e "$ARCADE" ] && [ ! -d "$ARCADE" ]; then
  echo "~/.arcade exists and is not a directory. Move it aside and re-run." >&2
  exit 1
fi
if [ -d "$ARCADE" ] && [ -n "$(ls -A "$ARCADE" 2>/dev/null)" ]; then
  # Ours if it carries any of the runtime's own files.
  if [ -e "$ARCADE/arcaded.js" ] || [ -e "$ARCADE/statusline.sh" ] ||
     [ -e "$ARCADE/state.json" ] || [ -e "$ARCADE/theme" ]; then
    IS_UPGRADE=1
  else
    WARN+=("~/.arcade already exists and does NOT look like Claude Code Arcade."
           "    It holds: $(ls -A "$ARCADE" | head -5 | tr '\n' ' ')"
           "    Installing will add our files alongside whatever that is.")
  fi
fi

# Another tool could own the name 'arcade' on PATH. A symlink that sits next to
# an arcaded.js is a previous install of ours; anything else gets a question.
if [ -e "$CLI" ] || [ -L "$CLI" ]; then
  tgt="$(readlink "$CLI" 2>/dev/null || true)"
  if [ -z "$tgt" ] || [ ! -e "$(dirname "$tgt")/arcaded.js" ]; then
    WARN+=("~/.local/bin/arcade already exists and isn't ours — it would be replaced.")
  fi
fi

if [ -f "$SETTINGS" ]; then
  cur="$("$NODE" -e 'try{const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String((s.statusLine||{}).command||""))}catch{}' "$SETTINGS")"
  case "$cur" in
    ""|*".arcade/statusline.sh"*) ;;
    *) WARN+=("You already have a statusline: $cur"
              "    It will be backed up to ~/.arcade/statusline.backup.json and restored on uninstall.") ;;
  esac
fi

if [ ${#WARN[@]} -gt 0 ]; then
  echo
  echo "  Hold on:"
  echo
  # Entries starting with a space are continuation lines, not new bullets.
  for w in "${WARN[@]}"; do
    case "$w" in
      " "*) printf '  %s\n' "$w" ;;
      *) printf '  - %s\n' "$w" ;;
    esac
  done
  echo
  # -r /dev/tty can pass where actually opening it fails (piped, no controlling
  # terminal), so open it for real and let that be the test.
  if [ "${ARCADE_FORCE:-0}" = 1 ]; then
    echo "  ARCADE_FORCE=1 set — continuing."
  elif { exec 3< /dev/tty; } 2>/dev/null; then
    printf '  Continue? [y/N] '
    read -r ans <&3 || ans=""
    exec 3<&-
    case "$ans" in
      y|Y|yes|YES) ;;
      *) echo "  Aborted. Nothing was written."; exit 1 ;;
    esac
  else
    echo "  No terminal to ask on, so nothing was written."
    echo "  Re-run from a terminal, or force it:"
    echo "    ARCADE_FORCE=1 bash $SRC/install.sh"
    exit 1
  fi
  echo
fi

# ------------------------------------------------------------------ install
echo
echo "Claude Code Arcade"
echo

mkdir -p "$ARCADE/tanks"
ln -sfn "$SRC/arcaded.js" "$ARCADE/arcaded.js"
ln -sfn "$SRC/arcadectl.js" "$ARCADE/arcadectl.js"
ln -sfn "$SRC/statusline.sh" "$ARCADE/statusline.sh"
chmod +x "$SRC/statusline.sh" "$SRC/arcade" "$SRC/arcaded.js" "$SRC/arcadectl.js" 2>/dev/null || true
say "runtime" "~/.arcade"

mkdir -p "$(dirname "$CLI")"
ln -sfn "$SRC/arcade" "$CLI"
say "cli" "~/.local/bin/arcade"

# The sprite font upgrades mspacman from Unicode glyphs to pixel sprites, and
# frogger needs it outright — its whole cast lives only in that font.
mkdir -p "$FONTDIR"
cp "$SRC/ArcadeSprites.ttf" "$FONTDIR/ArcadeSprites.ttf"
say "font" "~${FONTDIR#$HOME}/ArcadeSprites.ttf"

[ -f "$ARCADE/theme" ] || printf 'mspacman\n' > "$ARCADE/theme"

# Rewrite settings.json with node rather than sed: it is the user's real config
# and every other key has to survive untouched.
mkdir -p "$(dirname "$SETTINGS")"
"$NODE" - "$SETTINGS" "$ARCADE/statusline.backup.json" <<'JS'
const fs = require('fs');
const [file, backup] = process.argv.slice(2);
let s = {};
try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
const want = { type: 'command', command: '~/.arcade/statusline.sh', padding: 0, refreshInterval: 1 };
const cur = s.statusLine;
// Back up only a statusline that is not already ours, and only once: re-running
// the installer must never overwrite a real backup with our own line.
if (cur && cur.command !== want.command && !fs.existsSync(backup)) {
  fs.writeFileSync(backup, JSON.stringify({ statusLine: cur }, null, 2) + '\n');
  console.log('  ' + 'backup'.padEnd(12) + ' your previous statusline → ~/.arcade/statusline.backup.json');
}
s.statusLine = want;
fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
JS
say "statusline" "~/.claude/settings.json"

echo
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *)
    echo "  One more thing — ~/.local/bin is not on your PATH, so the CLI needs:"
    echo
    echo "    echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc && exec zsh"
    echo
    ;;
esac
echo "  Now QUIT your terminal app completely (Cmd-Q) and reopen it."
echo "  Terminals cache glyph lookups per process, so a new tab will not do."
echo
echo "  Then pick a game:"
echo "    arcade theme mspacman     Ms. Pac-Man (the default)"
echo "    arcade theme frogger      Frogger"
echo "    arcade theme aquarium     fish"
echo "    arcade theme safari       savanna"
echo "    arcade demo on            keep playing while Claude is idle"
echo "    arcade status             what is running"
echo
