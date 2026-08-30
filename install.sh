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
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCADE="$HOME/.arcade"
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

echo
echo "Claude Code Arcade"
echo

mkdir -p "$ARCADE/tanks"
ln -sfn "$SRC/arcaded.js" "$ARCADE/arcaded.js"
ln -sfn "$SRC/arcadectl.js" "$ARCADE/arcadectl.js"
ln -sfn "$SRC/statusline.sh" "$ARCADE/statusline.sh"
chmod +x "$SRC/statusline.sh" "$SRC/arcade" "$SRC/arcaded.js" "$SRC/arcadectl.js" 2>/dev/null || true
say "runtime" "~/.arcade"

mkdir -p "$HOME/.local/bin"
ln -sfn "$SRC/arcade" "$HOME/.local/bin/arcade"
say "cli" "~/.local/bin/arcade"

# The sprite font upgrades mspacman from Unicode glyphs to pixel sprites, and
# frogger needs it outright — its whole cast lives only in that font.
case "$(uname -s)" in
  Darwin) FONTDIR="$HOME/Library/Fonts" ;;
  *) FONTDIR="$HOME/.local/share/fonts" ;;
esac
mkdir -p "$FONTDIR"
cp "$SRC/ArcadeSprites.ttf" "$FONTDIR/ArcadeSprites.ttf"
say "font" "~${FONTDIR#$HOME}/ArcadeSprites.ttf"

[ -f "$ARCADE/theme" ] || printf 'mspacman\n' > "$ARCADE/theme"

# Rewrite settings.json with node rather than sed: it is the user's real config
# and every other key has to survive untouched.
mkdir -p "$HOME/.claude"
"$NODE" - "$HOME/.claude/settings.json" "$ARCADE/statusline.backup.json" <<'JS'
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
