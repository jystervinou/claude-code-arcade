# Claude Code Arcade

Little living scenes rendered across the Claude Code status line, fed by what
Claude is doing: every file Claude touches becomes a creature (its species from
the path hash, its size from the tool — `Read` small, `Write`/`Edit` big). All
open sessions share one world. When Claude thinks hard, it gets busy.

Ms. Pac-Man laps the maze eating the dots your session leaves behind, dodging
ghosts and doubling back for fruit. Or the frog crosses a road of Claude's tool
calls. When Claude goes quiet the line blinks **INSERT COIN** — or plays on by
itself, if you turn the attract reel on.

## Setup

Paste this into Claude Code (the `!` runs it as a shell command) or into any
terminal without the `!`:

```
!git clone https://github.com/jystervinou/claude-code-arcade.git ~/.arcade/src && bash ~/.arcade/src/install.sh
```

Then **fully quit your terminal app (⌘Q) and reopen it** — terminals cache
glyph lookups per process, so a new tab won't pick the sprite font up.

Needs Node (any recent version) and macOS or Linux. Nothing system-wide, no
sudo: it writes `~/.arcade/`, `~/.local/bin/arcade`, one font file in your user
font dir, and the `statusLine` key in `~/.claude/settings.json` — backing up
whatever was there. [Undo it all](#uninstalling) with one command.

## Playing

Four themes, switchable live:

```
arcade theme aquarium   🐟🐠🐡🦐🦀🦞🪼 / 🦈🐋🐳🐬🐙🦑🐢🦭🐊 — bubbles at the edge
arcade theme safari     🐒🦩🐍🦌🦂🦡🦅 / 🐘🦒🦏🦛🐆🦓🐃🦍🐊🐪 — dusty ground, trees, 💨
arcade theme mspacman   a Ms. Pac-Man simulation (see below)
arcade theme frogger    Frogger crossing the line — needs the sprite font
arcade font install     pixel sprites (upgrades mspacman, required by frogger)
arcade status           daemon + theme + font + sessions + scores
arcade play             joystick (optional)
arcade demo on|off      attract reel: keep playing while Claude is idle
```

`mspacman` draws with whatever it has: Unicode glyphs out of the box, real
pixel sprites once `arcade font install` puts ArcadeSprites.ttf in your user
font dir. Same game either way — the font is an upgrade, never a prerequisite,
and `arcade status` tells you which you're getting. The daemon re-checks every
few seconds, so installing or removing the font switches a running game over
without a restart (the terminal itself still needs a full quit + reopen to pick
the font up).

(The safari fields only full-body side-view emoji — front-facing heads like
🦁 break the scrolling silhouette, so the leopard is the resident big cat.)

## The Ms. Pac-Man simulation

Touched files are ghosts (classic colors by path hash) drifting through her
maze. She laps it forever, chomping the dot field. Claude's replies and
Writes drop power gums ● ahead of her; when she eats one the ghosts panic —
blue, reversed — and the ones that run into her get eaten: their eyes ¨
sprint home. A non-frightened ghost can eat HER: arcade fold-up death, then
respawn with blinking invulnerability. Bonus fruits 🍒🍓🍊🥨🍎🍐🍌 wander
through in level order; she eats those too.

Arcade scoring, persisted across daemon restarts in `~/.arcade/state.json`:
dots 10, power gums 50, ghosts 200→400→800→1600 per fright combo, fruits
their real values (cherry 100 … banana 5000). The score sits at the left end
of the line; the last three fruits she ate sit at the right end as trophies.
(The HUD appears when the terminal is at least ~50 columns wide.) Each game
keeps its own score — a Frogger run never inherits Ms. Pac-Man's total.

## INSERT COIN, and the attract reel

When Claude's reply actually ends, the game freezes a few seconds later and
the line blinks **INSERT COIN** — orange for Ms. Pac-Man, green for Frogger.
It reads turn boundaries from the transcript rather than raw silence, so long
silent thinking keeps the game running.

`arcade demo on` replaces that freeze with the cabinet's attract reel: the
game plays itself on synthetic traffic until you type again. A demo run is
scored from zero and marked `DEMO` where the trophies go, and none of it is
banked — the daemon swaps your real record out for the duration and puts it
back untouched, so `state.json` never sees a demo point.

Optional interaction: `arcade play` in any spare terminal pane is the joystick
(←/→ steer — she turns around, ᗧ — ↑ boost; F1/F2/F3 work too). Input goes
through `~/.arcade/input`, which the daemon polls; she returns to auto-pilot
~30s after the last input. A daemon can't read your keyboard directly (no
TTY), which is why the joystick is its own tiny process.

To steer **from the Claude Code window itself** — where Claude Code owns
every keystroke — `arcade play global` runs a listen-only macOS key monitor
(`arcadekeys.swift`): F1 ←, F2 →, F3 boost, from any window. It reacts to
exactly those three keycodes, writes one letter to `~/.arcade/input`, keeps and
sends nothing, and can't swallow the keys (they still reach the focused
app). First run prompts for an Accessibility grant to your terminal app —
one-time, revocable in System Settings → Privacy & Security. On laptop
keyboards use fn+F1/F2/F3. (Claude Code's own `keybindings.json` was the
dream — no permissions — but its actions are a fixed internal list; it
can't run commands.)

## The arcade sprite font

Installing the font upgrades `mspacman` from Unicode glyphs to real pixel
sprites: three Ms. Pac-Man frames (mouth open left/right, closed — with her
bow and a see-through eye), a ghost with two pupil positions (their eyes flick
as they drift), a frightened ghost, and fleeing eyes. It also unlocks
`frogger`, whose whole cast (frog, car, truck, log, turtle, fly) exists only
here — that theme has no Unicode fallback.

```
arcade font install     # one 23KB file → your user font dir
# fully quit + reopen the terminal app to pick it up
arcade font remove      # reverts everything; mspacman falls back to Unicode
```

Safe by construction: `ArcadeSprites.ttf` is a plain user font — nothing under
`/System` is touched, no configuration changes, no terminal font switch.
The trick is *where* the sprites live: U+1CC10–1CC16, in Unicode 16's
"Symbols for Legacy Computing Supplement" block (fittingly), which no font
shipped with macOS covers. When the terminal's font has no glyph for a real
codepoint, CoreText searches every installed font — and finds ours. (The
same hijack via Private Use Area codepoints does *not* work: macOS
deliberately skips PUA in automatic fallback. And overriding Apple Color
Emoji with a patched copy in `~/Library/Fonts` — the macmoji approach — is
dead on macOS 26: the system copy always wins the name conflict.)

The pixel art is original, drawn procedurally on a 16×16 grid and compiled to
TTF contours with fontTools — one square per pixel, facial features left as
unfilled negative space. The pac-family glyphs carry COLR/CPAL color layers,
which CoreText honours even through fallback, so her bow is genuinely red
rather than ANSI-tinted. (The generator scripts aren't in this repo; the
built font is.)

Portability: the `mspacman` Unicode theme works on every platform Claude
Code runs on. The sprite font should port to Linux as-is (fontconfig does
the same fallback from `~/.local/share/fonts`); Windows Terminal has no
system-wide fallback for unknown blocks, so stick to the Unicode theme
there.

## How it works

```
statusline JSON (stdin) ──► statusline.sh ──► marker in ~/.arcade/tanks/<session>.path
                                  │            (transcript path + terminal width)
                                  └──► cat ~/.arcade/frame.<width>  (what you see)

arcaded.js (daemon, 200ms tick) ──► tails every fresh transcript in ~/.arcade/tanks/
                             ──► spawns/moves creatures, runs the simulation
                             ──► writes ~/.arcade/frame.<width> per distinct width
```

- `statusline.sh` — statusline entry point. Extracts `transcript_path` from
  the statusline JSON, reads the terminal width from `COLUMNS` (exported
  fresh on every refresh, so the world follows window resizes), drops a
  session marker, revives the daemon, prints the frame for this width.
- `arcaded.js` — the daemon. Single instance (pid file), tails all fresh
  transcripts, renders one frame per distinct terminal width in use, 5
  columns narrower than `COLUMNS` (the statusline area clips wider lines
  with a `…`). Emoji count as 2 columns; positions are measured from the
  right edge so every width shows the same world. Exits on its own 2 minutes
  after the last session closes.
- `arcadectl.js` — the joystick (`arcade play`).
- `arcade` — the CLI, symlinked at `~/.local/bin/arcade`.
- `~/.arcade/` — runtime state: `frame.<width>`, `pid`, `theme`, `input`,
  `tanks/`, and `statusline.backup.json` (the previous statusLine value).

## Settings

```json
"statusLine": {
  "type": "command",
  "command": "~/.arcade/statusline.sh",
  "padding": 0,
  "refreshInterval": 1
}
```

`refreshInterval` is in **seconds** (minimum 1), not milliseconds — an idle
world redraws once per second; during activity the statusline refreshes on
every message event, which is much faster. The daemon always ticks at 200ms
internally; the statusline samples whatever frame is current.

## Uninstalling

```
bash ~/.arcade/src/uninstall.sh
```

Puts your previous statusline back (from `~/.arcade/statusline.backup.json`),
or removes the `statusLine` key if you had none — and only if the key is still
ours, so it won't clobber a statusline you've since moved to. Removes the CLI,
the font, and the runtime; keeps your scores unless you add `--purge`. Then
restart your terminal.
