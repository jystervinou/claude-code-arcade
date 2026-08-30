#!/usr/bin/env bash
# uninstall.sh — put everything back the way it was.
#
# Restores your previous statusline (or removes the key if you had none),
# removes the CLI and the font, and stops the daemon. Your scores in
# ~/.arcade/state.json are KEPT unless you pass --purge.
set -euo pipefail

ARCADE="$HOME/.arcade"
PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1

NODE="$(command -v node 2>/dev/null || true)"
if [ ! -x "${NODE:-}" ]; then
  for n in "$HOME/.volta/bin/node" /opt/homebrew/bin/node /usr/local/bin/node \
           "$HOME/.local/bin/node" "$HOME/n/bin/node"; do
    [ -x "$n" ] && NODE="$n" && break
  done
fi

echo
echo "Removing Claude Code Arcade"
echo

if [ -x "${NODE:-}" ]; then
  "$NODE" - "$HOME/.claude/settings.json" "$ARCADE/statusline.backup.json" <<'JS'
const fs = require('fs');
const [file, backup] = process.argv.slice(2);
let s;
try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { process.exit(0); }
let restored = null;
try { restored = JSON.parse(fs.readFileSync(backup, 'utf8')).statusLine; } catch {}
// Only touch the key if it is still ours — someone may have moved on to another
// statusline since, and clobbering that would be rude.
if (s.statusLine && String(s.statusLine.command || '').includes('.arcade/statusline.sh')) {
  if (restored) { s.statusLine = restored; console.log('  restored your previous statusline'); }
  else { delete s.statusLine; console.log('  removed the statusLine key'); }
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
} else {
  console.log('  statusLine is not ours any more — left alone');
}
JS
else
  echo "  no node found — edit ~/.claude/settings.json by hand to drop statusLine"
fi

pkill -f 'arcaded\.js' 2>/dev/null || true
rm -f "$HOME/.local/bin/arcade"
rm -f "$HOME/Library/Fonts/ArcadeSprites.ttf" "$HOME/.local/share/fonts/ArcadeSprites.ttf"
echo "  removed the CLI and the sprite font"

if [ "$PURGE" = 1 ]; then
  rm -rf "$ARCADE"
  echo "  purged ~/.arcade (scores included)"
else
  rm -f "$ARCADE"/frame.* "$ARCADE/pid" "$ARCADE/input"
  rm -f "$ARCADE/arcaded.js" "$ARCADE/arcadectl.js" "$ARCADE/statusline.sh"
  rm -rf "$ARCADE/tanks"
  echo "  kept ~/.arcade/state.json (your scores) — rerun with --purge to drop it"
fi

echo
echo "  Restart your terminal app to finish."
echo
