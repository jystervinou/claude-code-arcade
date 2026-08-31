#!/usr/bin/env bash
# statusline.sh — Claude Code statusline: an aquarium.
# Receives the statusline JSON on stdin, tells the daemon which transcript to
# tail and how wide this terminal is, keeps the daemon alive, and prints the
# frame rendered for this width. Must stay fast: it runs on every refresh.
ARCADE="$HOME/.arcade"

# The off switch (`arcade off`), checked before anything else: while it is off
# this prints nothing and — the part that matters — does not restart the daemon
# below. Read with shell builtins only; this runs on every single refresh.
# A missing file means on, so an install that never flipped it plays.
en=on
[ -f "$ARCADE/enabled" ] && read -r en < "$ARCADE/enabled"
case "$en" in
  [Oo][Ff][Ff]|0|[Ff]alse|[Nn]o)
    cat > /dev/null # drain the statusline JSON rather than leave it a broken pipe
    exit 0 ;;
esac

# No personal paths: probe PATH first, then the usual install locations
# (statusline processes don't always inherit an interactive shell's PATH).
NODE="$(command -v node 2>/dev/null)"
if [ ! -x "$NODE" ]; then
  for n in "$HOME/.volta/bin/node" /opt/homebrew/bin/node /usr/local/bin/node \
           "$HOME/.local/bin/node" "$HOME/n/bin/node"; do
    [ -x "$n" ] && NODE="$n" && break
  done
fi

mkdir -p "$ARCADE/tanks"
j=$(cat)

# Claude Code exports COLUMNS to the statusline process; re-read every run so
# the tank follows window resizes.
w="${COLUMNS:-}"
[ -n "$w" ] || w="$(tput cols 2>/dev/null)"
[ -n "$w" ] || w=80

# Every open session drops a marker named by its transcript UUID; the daemon
# tails all fresh transcripts, so fish from every session share one tank.
re='"transcript_path"[[:space:]]*:[[:space:]]*"([^"]+)"'
if [[ $j =~ $re ]]; then
  tp="${BASH_REMATCH[1]}"
  printf '%s\n%s\n' "$tp" "$w" > "$ARCADE/tanks/${tp##*/}.path"
fi

if ! kill -0 "$(cat "$ARCADE/pid" 2>/dev/null)" 2>/dev/null; then
  [ -n "$NODE" ] && nohup "$NODE" "$ARCADE/arcaded.js" >/dev/null 2>&1 &
fi

cat "$ARCADE/frame.$w" 2>/dev/null && exit 0
# Right after a resize this width's frame may not exist yet; show any frame.
for f in "$ARCADE"/frame.*; do [ -f "$f" ] && cat "$f" && exit 0; done
printf '🫧 filling the tank…'
