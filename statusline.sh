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

# session_id is Claude Code's own identifier for this window: stable for the
# life of the session, unique across concurrent ones, and the field the docs
# point at for exactly this — per-session state keyed by something that is not
# a process id. It names this window's marker and this window's frame.
re='"session_id"[[:space:]]*:[[:space:]]*"([^"]+)"'
[[ $j =~ $re ]] && sid="${BASH_REMATCH[1]}"
re='"transcript_path"[[:space:]]*:[[:space:]]*"([^"]+)"'
[[ $j =~ $re ]] && tp="${BASH_REMATCH[1]}"
if [ -n "${sid:-}" ] && [ -n "${tp:-}" ]; then
  printf '%s\n%s\n' "$tp" "$w" > "$ARCADE/tanks/$sid.path"
  # Upgrading from the build that named markers after the transcript file: the
  # two names differ only by '.jsonl', so leaving the old one behind makes this
  # session look like two, and every id prefix ambiguous.
  legacy="$ARCADE/tanks/${tp##*/}.path"
  [ "$legacy" != "$ARCADE/tanks/$sid.path" ] && rm -f "$legacy"
fi

# Start the daemon fully detached. Claude Code captures this script's output
# through a pipe and waits for end-of-file on it; a background child that the
# shell still tracks keeps that pipe alive, so the refresh that starts the
# daemon never returns and the frame it was fetching is never printed. Closing
# stdin and disowning the job is what makes this return immediately — measured:
# hangs indefinitely without, 0.0s with.
if ! kill -0 "$(cat "$ARCADE/pid" 2>/dev/null)" 2>/dev/null; then
  if [ -n "$NODE" ]; then
    nohup "$NODE" "$ARCADE/arcaded.js" >/dev/null 2>&1 </dev/null &
    disown
  fi
fi

# This session's own frame, and only ever this one — another window's frame is
# another window's game. Nothing yet means the daemon has not ticked.
[ -n "${sid:-}" ] && cat "$ARCADE/frame.$sid" 2>/dev/null && exit 0
printf ' '
