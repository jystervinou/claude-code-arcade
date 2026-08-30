# Claude Code Arcade

**Vibe code with an 80s arcade vibe.**

An arcade running in your Claude Code status line, animated by whatever Claude
is doing. It works, the arcade plays.

Ms. Pac-Man. Frogger. Or an aquarium and a safari, if you want something calmer.
They play themselves — grab the joystick if you want, but you don't have to.

![Ms. Pac-Man running in the Claude Code status line](docs/ms-pacman.png)

## Setup

Paste this into Claude Code (the `!` runs it as a shell command) or into any
terminal without the `!`:

```
!git clone https://github.com/jystervinou/claude-code-arcade.git ~/.claude-code-arcade && bash ~/.claude-code-arcade/install.sh
```

Then **fully quit your terminal app (⌘Q) and reopen it** — terminals cache
glyph lookups per process, so a new tab won't pick the sprite font up.

Needs Node (any recent version) and macOS or Linux. Nothing system-wide, no
sudo: it writes `~/.arcade/`, `~/.local/bin/arcade`, one font file in your user
font dir, and the `statusLine` key in `~/.claude/settings.json` — backing up
whatever was there. [Undo it all](#uninstalling) with one command.

It checks all of those first and stops to ask if anything already there isn't
its own — an existing `~/.arcade`, another `arcade` on your PATH, a statusline
you're already using.

## Playing

```
arcade theme mspacman   Ms. Pac-Man
arcade theme frogger    Frogger
arcade theme aquarium   🐟🐠🐡🦐🦀🦞🪼 / 🦈🐋🐳🐬🐙🦑🐢🦭🐊
arcade theme safari     🐒🦩🐍🦌🦂🦡🦅 / 🐘🦒🦏🦛🐆🦓🐃🦍🐊🐪
arcade demo on          keep playing while Claude is idle
arcade play             joystick (optional)
arcade status           what's running
```

Switch any time — it takes effect live.

She plays herself: laps the maze, eats the dots, runs from ghosts, doubles back
for fruit. Real arcade scoring, kept between sessions, one score per game.

## Taking the joystick (optional, and fiddly)

Ms. Pac-Man and Frogger can be steered. The catch is that Claude Code owns
every keystroke in its own window, so there are two ways in — neither is
seamless, and the games are perfectly happy without you:

```
arcade play          # in a SPARE terminal pane: ←/→ steer, ↑ boost
arcade play global   # F1 ←, F2 →, F3 boost from any window (macOS)
```

`global` needs a one-time Accessibility grant, and on laptops it's fn+F1/F2/F3.
It watches exactly those three keys, can't swallow them, and sends nothing
anywhere. Either way she goes back to playing herself ~30s after you stop.

## The sprite font

The installer sets this up for you; `arcade font remove` drops back to Unicode
glyphs, and `mspacman` plays fine either way.

The sprites are an original pixel font, and the trick is *where* they live:
U+1CC10–1CC16, in Unicode 16's
"Symbols for Legacy Computing Supplement" block (fittingly), which no font
shipped with macOS covers. When the terminal's font has no glyph for a real
codepoint, CoreText searches every installed font — and finds ours. (The
same hijack via Private Use Area codepoints does *not* work: macOS
deliberately skips PUA in automatic fallback. And overriding Apple Color
Emoji with a patched copy in `~/Library/Fonts` — the macmoji approach — is
dead on macOS 26: the system copy always wins the name conflict.)

Each glyph is drawn one square per pixel on a 16×16 grid, with color layers
baked in — her bow is genuinely red, not tinted.

Works on macOS and Linux. On Windows Terminal, stick to `mspacman`, which
needs no font at all.

## How it works

A small daemon watches your sessions and writes one frame every 200ms;
`statusline.sh` just prints the current one. All your open Claude Code windows
share the same world, and the daemon shuts itself down two minutes after the
last one closes.

## Settings

The installer sets this for you:

```json
"statusLine": {
  "type": "command",
  "command": "~/.arcade/statusline.sh",
  "padding": 0,
  "refreshInterval": 1
}
```

## Uninstalling

```
bash ~/.claude-code-arcade/uninstall.sh
```

Puts your old statusline back, removes the CLI and the font, keeps your scores
(add `--purge` to drop those too). Then restart your terminal.
