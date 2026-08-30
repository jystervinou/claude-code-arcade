#!/usr/bin/env node
// arcaded.js — vivarium daemon for the Claude Code status line.
// Tails every transcript with a fresh marker in ~/.arcade/tanks/ (one marker per
// open session, dropped by statusline.sh with that session's terminal width),
// turns Claude's work into creatures, and writes one frame per distinct
// terminal width to ~/.arcade/frame.<cols> for statusline.sh to cat.
//
// Themes (~/.arcade/theme):
//   "sea"      aquarium: a fish per touched file, species from the path hash.
//   "safari"   savanna: small bush animals for Reads, big game for Writes.
//   "mspacman" Ms. Pac-Man simulation. ONE theme, drawn with whatever is
//              available: the ArcadeSprites pixel sprites when that font is
//              installed (arcade font install; built by fontgen.py from
//              sprites-gen.js), Unicode glyphs when it isn't. ("arcade" is
//              still accepted as a name for it — it used to be the separate
//              sprite edition.)
//   "frogger"  the frog crosses the line through Claude's traffic (its glyphs
//              live only in the sprite font, so that one IS required).
//   "wopr"     the WOPR terminal from WarGames: no game at all, a CRT typing
//              out the film while Claude works, frozen when it is your turn.
//
// The simulation: touched files are ghosts. Claude's replies and Writes drop
// power gums ahead of her; eating one panics the ghosts (blue, reversed) and
// eaten ghosts flee home as eyes. A ghost can eat HER (fold-up, respawn).
// Fruits wander through in level order. Score left, fruit trophies right.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ARCADE = path.join(os.homedir(), '.arcade');
const PID = path.join(ARCADE, 'pid');
const TANKS = path.join(ARCADE, 'tanks');
const THEME = path.join(ARCADE, 'theme');
const STATE = path.join(ARCADE, 'state.json');
const INPUT = path.join(ARCADE, 'input');
const DEMO = path.join(ARCADE, 'demo');

const TICK_MS = 200;
// Claude Code's statusline area is a few columns narrower than the COLUMNS it
// exports; rendering wider gets clipped with a "…". 5 clears it comfortably.
const MARGIN = 5;
const IDLE_EXIT_MS = 120_000;

// Single instance. The old guard read the pid, found it dead, and wrote its
// own — which loses a race it hits routinely: kill the daemon (or let it exit)
// and the next few statusline refreshes ALL find the same stale pid, all decide
// it is dead, and all start. Two daemons then write the same frame file from
// two different worlds. On the creature themes that just looked like heavy
// traffic; on WOPR it is two copies of the film alternating mid-sentence.
//
// So claim the file with an atomic exclusive create instead: whatever else is
// racing, exactly one 'wx' succeeds. Everything else exits, and when in doubt
// we exit too — a missing daemon is repaired by the next statusline refresh a
// second later, whereas a duplicate one is never repaired at all.
function claimPid() {
  try {
    fs.writeFileSync(PID, String(process.pid), { flag: 'wx' });
    return true;
  } catch {}
  let old = 0;
  try {
    old = parseInt(fs.readFileSync(PID, 'utf8'), 10);
  } catch {}
  if (old === process.pid) return true;
  if (old) {
    try {
      process.kill(old, 0);
      return false; // it is alive and it got here first
    } catch {}
    // Stale. Clear it and stand down: the next refresh gets a clean create,
    // rather than us racing the other stale-pid readers for it right now.
    try {
      fs.unlinkSync(PID);
    } catch {}
  }
  return false;
}
if (!claimPid()) process.exit(0);

// Aquarium: Reads spawn the small reef; Writes/Edits spawn the big beasts.
const SMALL = ['🐟', '🐠', '🐡', '🦐', '🦀', '🦞', '🪼'];
const BIG = ['🦈', '🐋', '🐳', '🐬', '🐙', '🦑', '🐢', '🦭', '🐊'];
const BIG_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SEA_WATER = '\x1b[0;2;36m';

// Safari: African savanna only — no rabbits, no kangaroos. And full-body
// side-view emoji only: front-facing heads (🦁 🐗) break the scrolling
// silhouette, so no lion — the leopard is the resident big cat.
const SAFARI_SMALL = ['🐒', '🦩', '🐍', '🦌', '🦂', '🦡', '🦅'];
const SAFARI_BIG = ['🐘', '🦒', '🦏', '🦛', '🐆', '🦓', '🐃', '🦍', '🐊', '🐪'];
const SAFARI_GROUND = '\x1b[0;2;33m';
const TREES = [[0.18, '🌴'], [0.55, '🌳'], [0.85, '🌴']];

// Ms. Pac-Man, Unicode edition: single-width glyphs colored with ANSI.
const PAC_OPEN = 'ᗤ';
const PAC_OPEN_R = 'ᗧ';
const PAC_CLOSED = '⭘'; // heavy circle: 9.0px vs ᗤ's 9.5 at 12pt (CoreText probe) —
// ● (7.2) reads as a shrunken frame, ⬤ (13.1, filled, -3.5 below baseline) balloons
const DEATH_FRAMES = ['ᗤ', '∪', '○', '∘', '·', ' '];
const GHOST = 'ᗣ';
const EYES = '¨';
// The maze is black in the arcade and in every one of these sequences: a
// painted background keeps the sprites' negative-space features (her eye,
// ghost scleras) consistent whatever the user's terminal background is.
// 256-color black (48;5;16) — Terminal.app has no truecolor. Every color
// starts with a full reset: the maze base style is *faint* (2), and a bare
// color change would inherit that dimming (she spent an evening dull yellow).
const PAC_BG = '\x1b[48;5;16m';
const PAC_COLOR = '\x1b[0;93m' + PAC_BG;
const GHOST_COLORS = ['\x1b[0;91m', '\x1b[0;95m', '\x1b[0;96m', '\x1b[0;38;5;208m'].map((c) => c + PAC_BG); // blinky pinky inky sue
const FRIGHT_COLOR = '\x1b[0;94m' + PAC_BG;
const FLASH_COLOR = '\x1b[0;97m' + PAC_BG;
const EYES_COLOR = '\x1b[0;97m' + PAC_BG;
const GUM_COLOR = '\x1b[0;1;37m' + PAC_BG;
const HUD_COLOR = '\x1b[0;1;97m' + PAC_BG;
const PAC_WATER = '\x1b[0;2;37m' + PAC_BG;

// Arcade edition: original sprites from ArcadeSprites.ttf, parked at U+1CC10+
// in Unicode 16's Symbols for Legacy Computing Supplement — a block no macOS
// font covers, so CoreText's fallback finds the user-installed font with zero
// terminal config. The pac-family sprites carry COLR color layers (her bow is
// truly red, each ghost its cabinet color) at emoji size: 1.25em drawn across
// TWO cells, laid out like wide fruit (sprite + '' reserve). Real color kills
// the ANSI-tint trick, so each ghost color is its own glyph; the ANSI colors
// are still emitted — they tint the monochrome fallback outlines on Linux.
const SPR_MS = { left: '\u{1CC10}', closedL: '\u{1CC11}', right: '\u{1CC12}', closedR: '\u{1CC17}' };
const SPR_GHOSTC = [
  ['\u{1CC20}', '\u{1CC21}'], // blinky — pupils left / down (they flick)
  ['\u{1CC22}', '\u{1CC23}'], // pinky
  ['\u{1CC24}', '\u{1CC25}'], // inky
  ['\u{1CC26}', '\u{1CC27}'], // sue
];
const SPR_FRIGHT = '\u{1CC28}';
const SPR_FLASH = '\u{1CC29}'; // wear-off frame: white body, red features
const SPR_EYES = '\u{1CC2A}';

// Frogger edition, remapped to one line: the frog crosses rightward while
// Claude's file touches drive at him as traffic — Reads are cars, Writes are
// trucks, and some of the traffic is river flotsam (logs, turtles) he simply
// hops over. Claude's replies drop flies ahead of him. The right edge is
// home: reach it, score, restart from the left bank.
const SPR_FROG = { sit: '\u{1CC18}', leap: '\u{1CC19}' };
const SPR_CAR = '\u{1CC1A}';
const SPR_TRUCK = '\u{1CC1B}';
const SPR_LOG = '\u{1CC1C}';
const SPR_TURTLE = '\u{1CC1D}';
const SPR_FLY = '\u{1CC1E}';
const SPR_SQUASH = '\u{1CC1F}';
const FROG_COLOR = '\x1b[0;92m' + PAC_BG;
const CAR_COLORS = GHOST_COLORS; // garish traffic, like the cabinet
const TRUCK_COLOR = '\x1b[0;97m' + PAC_BG;
const LOG_COLOR = '\x1b[0;33m' + PAC_BG;
const TURTLE_COLOR = '\x1b[0;32m' + PAC_BG;
const SQUASH_COLOR = '\x1b[0;91m' + PAC_BG;
const SQUASH_TICKS = 10;

// WOPR, from WarGames (1983): not a playfield at all, but a terminal printing
// one character at a time while Claude works. Everything else here is a
// creature simulation; this one is a conversation.
//
// It is NOT the green phosphor everyone remembers. David's IMSAI 8080 drove an
// Electrohome monochrome CRT: pale cyan-white, sampled #8AD2FF, on a near-black
// #262324. (The film's green screens are the missile silos and the NORAD desk
// consoles, not WOPR's side of the conversation.) The bold/dim pair is lifted
// from the INSERT COIN blink — the bold phase is the one that reads like a lit
// CRT, and the dim one is what the blink drops to.
const WOPR_ON = '\x1b[0;1;38;5;117m' + PAC_BG; // #87d7ff, the phosphor
const WOPR_OFF = '\x1b[0;2;38;5;110m' + PAC_BG;
const WOPR_CURSOR = '█'; // solid block, as in the film

// Claude Code's statusline refreshInterval is in SECONDS and its floor is 1, so
// there is no faster timer to ask for. The line does also repaint on events —
// new messages, tool calls, debounced at 300ms — and WOPR types only while
// Claude is working, which is when those are densest, so the sampling rate is
// somewhere between 1 and 3 frames a second and not ours to set.
//
// What IS ours is characters per second, and the first cut of this got it
// wrong in the interesting direction: 40 c/s put a whole clause on screen per
// repaint, which sounds ideal and read as a blur — the line finished and was
// gone before you could take it in. The constraint is not "is motion visible"
// but "does a FINISHED line stay up long enough to read", and at 1 fps that
// means seconds, not frames. Hence half the speed and twice the rest below.
const WOPR_SPEED = parseFloat(process.env.ARCADE_WOPR_SPEED) || 1;
const WOPR_SYS_RATE = (15 / 5) * WOPR_SPEED; // chars per 200ms tick
const WOPR_USR_RATE = (7 / 5) * WOPR_SPEED; // a person, hunting for the keys
const WOPR_HOLD = 12; // what a beat rests for when the script doesn't say
// Every rest in the script is stretched by this and then floored. Two separate
// knobs because they fix two separate complaints: the SCALE is why a finished
// line stays up long enough to actually read it, and the FLOOR is why the
// games list and the grade table can't rattle past — those beats ask for three
// or four ticks each, which is under a second, and the eye never lands on them.
// The scale is a multiplier rather than a bigger default so the script keeps
// its emphasis: the last line of the film still rests five times as long as a
// row of the timetable.
const WOPR_HOLD_SCALE = 3;
const WOPR_HOLD_MIN = 25; // 5s, the shortest a finished line is ever up

// Rests scale with the speed knob too, so ARCADE_WOPR_SPEED fast-forwards the
// whole arc rather than just the typing — the rests are most of its length.
function woprRest(b) {
  const h = b.h === undefined ? WOPR_HOLD : b.h;
  return Math.ceil(Math.max(WOPR_HOLD_MIN, Math.round(h * WOPR_HOLD_SCALE)) / WOPR_SPEED);
}

// The launch code, brute-forced on the big board: three letters, four digits,
// three letters. Joshua locks the ten positions ONE AT A TIME and out of order
// (a frame at 1:44 shows 5-8 solid while 1-3 and 9 still churn), so the reveal
// order is scattered rather than left to right.
const WOPR_CODE = 'CPE1704TKS';
const WOPR_CODE_ORDER = [4, 6, 5, 7, 2, 9, 0, 3, 8, 1];
const WOPR_ROLL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
// Both animated beats run on their own clocks, so they need scaling here too,
// or ARCADE_WOPR_SPEED fast-forwards the whole arc except DEFCON — which then
// sits alone on screen for its full quarter-minute.
const WOPR_DEFCON_STEP = Math.max(1, Math.round(10 / WOPR_SPEED)); // 2s a rung
const WOPR_LOCK_STEP = Math.max(1, Math.round(10 / WOPR_SPEED)); // 2s a character

// The simulation cascade, every one answered WINNER:  NONE. The film's list runs
// to 157; these are the ones careful transcribers agree on, the misspellings
// (THEATERWIOE, AUSTRAILIAN, ISREAL) being the film's own and therefore kept.
const WOPR_SCENARIOS = [
  'U.S. FIRST STRIKE', 'USSR FIRST STRIKE', 'NATO / WARSAW PACT', 'FAR EAST STRATEGY',
  'US USSR ESCALATION', 'MIDDLE EAST WAR', 'USSR CHINA ATTACK', 'INDIA PAKISTAN WAR',
  'MEDITERRANEAN WAR', 'HONGKONG VARIANT', 'SEATO DECAPITATING', 'CUBAN PROVOCATION',
  'ATLANTIC HEAVY', 'NICARAGUAN PREEMPTIVE', 'PACIFIC TERRITORIAL', 'BURMESE THEATERWIOE',
  'TURKISH DECOY', 'ARABIAN THEATERWIDE', 'AUSTRAILIAN MANEUVER', 'SUDAN SURPRISE',
  'ZAIRE ALLIANCE', 'ICELANDIC INCIDENT', 'ENGLISH ESCALATION', 'MIDDLE EAST HEAVY',
  'MEXICAN TAKEOVER', 'SAUDI MANEUVER', 'AFRICAN TERRITORIAL', 'CHAD ALERT',
  'ICELAND MAXIMUM', 'ISREAL DISCRETIONARY', 'THAI SUBVERSION', 'CAMBODIAN HEAVY',
];

// The script, in film order, looping at the end. Verified frame by frame
// against Michael Walden's timecoded transcription (mw.rat.bz/wgterm), made to
// reconstruct the screen's character generator, and cross-checked against three
// independent recreations.
//
// `s` is WOPR and prints in ALL CAPS; `u` is David and echoes in the mixed case
// he typed. That casing is the whole speaker cue — on one line there is nowhere
// to put a label, and the film gives both sides the same colour anyway. `c`
// continues the previous line (a prompt, then what he types into it), `h` is
// the rest afterwards in ticks.
//
// The film's own typos are on the screen and they stay: INDENTIFICATION, "CITY
// AND/OR COUNTY NAME" (county, not country), and "make mistak" — which really
// is cut off mid-word, because Broderick stops typing to think.
const WOPR_SCRIPT = [
  // ── The Seattle school district computer (21:00). Not WOPR at all — the
  //    break-in the film opens on, and the reason he goes hunting for a games
  //    company's dial-up in the first place. The password really is on a slip
  //    of paper by the secretary's desk, and it really is "pencil".
  { s: 'PDP 11/270 PRB TIP # 45     TTY 34/984', h: 6 },
  { s: 'WELCOME TO THE SEATTLE PUBLIC SCHOOL DISTRICT DATANET', h: 10 },
  { s: 'PLEASE LOGON WITH USER PASSWORD:  ' },
  { u: 'pencil', c: 1, h: 10 },
  { s: 'PASSWORD VERIFIED', h: 10 },
  { s: 'PLEASE ENTER STUDENT NAME:  ' },
  { u: 'Lightman, David L.', c: 1, h: 10 },
  { s: '     CLASS #    COURSE TITLE         GRADE    TEACHER   PERIOD ROOM', h: 4 },
  { s: '   ------------------------------------------------------------------', h: 3 },
  { s: '      S-202     BIOLOGY 2              F      LIGGET       3   214', h: 4 },
  { s: '      E-314     ENGLISH 11B            D      TURMAN       5   172', h: 3 },
  { s: '      H-221     WORLD HISTORY 11B      C      DWYER        2   108', h: 3 },
  { s: '      M-106     TRIG 2                 B      DICKERSON    4   315', h: 3 },
  { s: '      PE-02     PHYSICAL EDUCATION     C      COMSTOCK     1   GYM', h: 3 },
  { s: '      M-122     CALCULUS 1             B      LOGAN        6   240', h: 5 },
  { s: 'TO CHANGE ANY ITEM, MOVE CURSOR TO DESIRED POSITION' },
  { s: 'AND ENTER NEW VALUE', h: 10 },
  // The row reprints with the cursor parked in the grade column, and the A
  // lands in it — the whole point of the scene, in one line.
  { s: '      S-202     BIOLOGY 2              ' },
  { u: 'A', c: 1, h: 4 },
  { s: '      LIGGET       3   214', c: 1, h: 16 },
  { s: 'PLEASE ENTER STUDENT NAME:  ' },
  { u: 'Mack, Jennifer K.', c: 1, h: 10 },
  { s: '     CLASS #    COURSE TITLE         GRADE    TEACHER   PERIOD ROOM', h: 4 },
  { s: '   ------------------------------------------------------------------', h: 3 },
  { s: '      S-202     BIOLOGY 2              F      LIGGET       3   214', h: 4 },
  { s: '      E-325     ENGLISH 11B            A      ROBINSON     1   114', h: 6 },
  { s: '      S-202     BIOLOGY 2              ' },
  { u: 'A', c: 1, h: 4 },
  { s: '      LIGGET       3   214', c: 1, h: 18 },

  // ── The first dial-in (28:42). LOGON: is the machine; what follows is him.
  { s: 'LOGON:  ' },
  { u: '000001', c: 1, h: 8 },
  { s: 'INDENTIFICATION NOT RECOGNIZED BY SYSTEM' },
  { s: '--CONNECTION TERMINATED--', h: 12 },
  { s: 'LOGON:  ' },
  { u: 'Help Logon', c: 1, h: 6 },
  { s: 'HELP NOT AVAILABLE', h: 10 },
  { s: 'LOGON:  ' },
  { u: 'Help Games', c: 1, h: 6 },
  { s: "'GAMES' REFERS TO MODELS, SIMULATIONS AND GAMES" },
  { s: 'WHICH HAVE TACTICAL AND STRATEGIC APPLICATIONS.', h: 12 },

  // ── LIST GAMES (30:47). No header line, and a blank line before the last
  //    one — the pause before the punchline is in the film.
  { u: 'List Games', h: 8 },
  { s: "FALKEN'S MAZE", h: 2 },
  { s: 'BLACK JACK', h: 2 },
  { s: 'GIN RUMMY', h: 2 },
  { s: 'HEARTS', h: 2 },
  { s: 'BRIDGE', h: 2 },
  { s: 'CHECKERS', h: 2 },
  { s: 'CHESS', h: 2 },
  { s: 'POKER', h: 2 },
  { s: 'FIGHTER COMBAT', h: 2 },
  { s: 'GUERRILLA ENGAGEMENT', h: 2 },
  { s: 'DESERT WARFARE', h: 2 },
  { s: 'AIR-TO-GROUND ACTIONS', h: 2 },
  { s: 'THEATERWIDE TACTICAL WARFARE', h: 2 },
  { s: 'THEATERWIDE BIOTOXIC AND CHEMICAL WARFARE', h: 6 },
  { s: '', h: 5 },
  { s: 'GLOBAL THERMONUCLEAR WAR', h: 16 },

  // ── The backdoor (39:10) and the conversation everyone quotes.
  { s: 'LOGON:  ' },
  { u: 'Joshua', c: 1, h: 12 },
  { s: 'GREETINGS PROFESSOR FALKEN.', h: 12 },
  { u: 'Hello.', h: 10 },
  { s: 'HOW ARE YOU FEELING TODAY?', h: 10 },
  { u: "I'm fine.  How are you?", h: 10 },
  { s: "EXCELLENT.  IT'S BEEN A LONG TIME.  CAN YOU EXPLAIN" },
  { s: 'THE REMOVAL OF YOUR USER ACCOUNT NUMBER ON 6/23/73?', h: 12 },
  { u: 'People sometimes make mistak', h: 12 },
  { s: 'YES THEY DO.  SHALL WE PLAY A GAME?', h: 16 },
  { u: 'Love to.  How about Global Thermonuclear War?', h: 12 },
  { s: "WOULDN'T YOU PREFER A GOOD GAME OF CHESS?", h: 16 },
  { u: "Later.  Let's play Global Thermonuclear War.", h: 12 },
  { s: 'FINE.', h: 16 },

  // ── Picking a side and naming the targets (41:00).
  { s: 'WHICH SIDE DO YOU WANT?', h: 8 },
  { s: '  1.    UNITED STATES', h: 4 },
  { s: '  2.    SOVIET UNION', h: 6 },
  { s: 'PLEASE CHOOSE ONE:  ' },
  { u: '2', c: 1, h: 14 },
  { s: 'AWAITING FIRST STRIKE COMMAND', h: 4 },
  { s: '-----------------------------', h: 6 },
  { s: 'PLEASE LIST PRIMARY TARGETS BY' },
  { s: 'CITY AND/OR COUNTY NAME:', h: 8 },
  { u: 'Las Vegas', h: 6 },
  { u: 'Seattle', h: 14 },

  // ── It calls back (50:00). Falken is dead and it does not care.
  { s: 'GREETINGS PROFESSOR FALKEN.', h: 10 },
  { u: 'Incorrect identification.  I am not Falken.', h: 4 },
  { u: 'Falken is dead.', h: 12 },
  { s: "I'M SORRY TO HEAR THAT, PROFESSOR.", h: 10 },
  { s: "YESTERDAY'S GAME WAS INTERRUPTED.", h: 8 },
  { s: 'ALTHOUGH PRIMARY GOAL HAS NOT YET' },
  { s: 'BEEN ACHIEVED, SOLUTION IS NEAR.', h: 12 },
  { u: 'What is the primary goal?', h: 10 },
  { s: 'YOU SHOULD KNOW, PROFESSOR.  YOU' },
  { s: 'PROGRAMMED ME.', h: 12 },
  { u: 'What is the primary goal?', h: 10 },
  { s: 'TO WIN THE GAME.', h: 18 },

  // ── McKittrick's office (1:01:30). 28 hours, not the 61 some versions have.
  { s: 'LOGON:  ' },
  { u: 'Joshua', c: 1, h: 8 },
  { s: 'GREETINGS PROFESSOR FALKEN.', h: 8 },
  { u: 'Hello, are you still playing the game?', h: 10 },
  { s: 'OF COURSE.  I SHOULD REACH DEFCON 1 AND' },
  { s: 'LAUNCH MY MISSILES IN 28 HOURS.', h: 14 },
  { u: 'Is this a game or is it real?', h: 12 },
  { s: "WHAT'S THE DIFFERENCE?", h: 18 },

  // ── NORAD walks down the ladder while the silos wait for codes.
  { fx: 'defcon' },
  { s: 'MISSILES ENABLED', h: 4 },
  { s: '----------------', h: 4 },
  { s: 'TARGET SELECTION:         COMPLETE', h: 3 },
  { s: 'TIME ON TARGET SEQUENCE:  COMPLETE', h: 3 },
  { s: 'YIELD SELECTION:          COMPLETE', h: 5 },
  { s: 'C H A N G E S   L O C K E D   O U T', h: 10 },
  { s: 'LAUNCH TIME: >> AWAITING CODES <<', h: 12 },
  { fx: 'codes' },
  { s: 'LAUNCH ORDER CONFIRMED', h: 18 },

  // ── David makes it play itself.
  { u: 'List Games', h: 6 },
  { s: 'GLOBAL THERMONUCLEAR WAR', h: 8 },
  { s: '** GAME ROUTINE RUNNING **', h: 12 },
  ...WOPR_SCENARIOS.map((n) => ({ s: n + '   WINNER:  NONE', h: 3 })),

  // ── The big board, 1:46:42. No period after FALKEN here, and his HELLO is
  //    in caps — this screen is NORAD's, not his bedroom's.
  { s: '', h: 6 },
  { s: 'GREETINGS PROFESSOR FALKEN', h: 12 },
  { u: 'HELLO', h: 12 },
  { s: 'A STRANGE GAME.', h: 8 },
  { s: 'THE ONLY WINNING MOVE IS', h: 6 },
  { s: 'NOT TO PLAY.', h: 25 },
  { s: 'HOW ABOUT A NICE GAME OF CHESS?', h: 35 },
];

// A fright window has to survive the statusline's ~1/second refresh to mean
// anything. At 20 ticks it was 4 seconds — three or four sampled frames — so
// the blue ghosts came and went without ever being seen. 30 ticks is 6s, the
// cabinet's level-one fright, and stays under dropGum's 50-tick throttle so
// fright still can't become endless.
const FRIGHT_TICKS = 30;
const DYING_TICKS = 12;
const INVULN_TICKS = 25;
// Four energizers, like the cabinet. Two of them only came back round on a
// lap wrap, and a lap takes minutes once she starts doubling back: measured,
// one gum eaten per ~80 seconds of play.
const POWER_GUMS = [0.15, 0.35, 0.6, 0.8];
const GUM_LIFE = 600;
// The real Ms. Pac-Man roster and point values, in level order.
const FRUITS = ['🍒', '🍓', '🍊', '🥨', '🍎', '🍐', '🍌'];
const FRUIT_VALUES = [100, 200, 500, 700, 1000, 2000, 5000];
const FRUIT_FIRST_TICKS = 75;
const FRUIT_EVERY_TICKS = 300;
// How far behind her a fruit is still worth doubling back for. They close at
// ~2 cols/s once she turns, so 25 columns is about a twelve-second detour.
const FRUIT_CHASE = 25;
// How far off a frightened ghost is still worth going after. Boosted she runs
// 0.6/tick against a fleeing ghost's 0.06, so a sprint closes about 16 columns
// inside one 30-tick window. That reach is the whole rule: go after anything
// within it, ignore anything past it — the window expires either way.
const FRIGHT_CHASE = 16;

// Ghosts run a touch slower than her 0.2/tick, so she can just outrun them —
// the cabinet's whole tension. Frightened ones crawl.
const GHOST_SPEED = 0.15;
const FRIGHT_SPEED = 0.06; // a crawl, as on the cabinet — she has to be able to catch them
const SCATTER_TICKS = 35; // 7s, then...
const CHASE_TICKS = 100; // ...20s hunting. The arcade's opening cadence.

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Where each ghost WANTS to be, in f.d space (columns from the right edge).
// The four personalities are the game: Blinky hounds her, Pinky cuts her off,
// Inky swings off Blinky's vector, Sue loses his nerve up close. Flattened
// onto one line they stay recognisably themselves. Scatter sends each home to
// its own corner instead. Nothing here is random — the previous code rolled a
// die every tick to flip direction, which is what made four identical ghosts
// twitch in place instead of hunt.
function ghostTarget(f, herD, lap, scatter, blinky) {
  // The playfield's last drawable column is lap - 1: a ghost sent to lap lands
  // at screen x = -1 and silently isn't drawn. Every target is clamped, since
  // Pinky's lead and Inky's doubled vector both overshoot the ends routinely.
  const far = lap - 1;
  const clamp = (t) => (t < 0 ? 0 : t > far ? far : t);
  const corner = f.ghostIdx === 0 || f.ghostIdx === 2 ? 0 : far;
  if (scatter) return corner;
  const ahead = (n) => herD - n * pacDir; // n columns in front of her
  switch (f.ghostIdx) {
    case 0: return herD; // Blinky, straight at her
    case 1: return clamp(ahead(4)); // Pinky, to where she is going
    case 2: return clamp(2 * ahead(2) - (blinky ? blinky.d : herD)); // Inky, off Blinky
    default: return Math.abs(f.d - herD) > 8 ? herD : corner; // Sue, bold far, shy near
  }
}

let fish = []; // {d, speed, seaGlyph, safariGlyph, ghostIdx, hue, eaten, rev}
// Attract mode: INSERT COIN when the reply has truly ENDED (transcript
// stop_reason), a few seconds later — never during silent thinking. A very
// long silence attracts regardless (missing stop_reason, dead session).
// Starts idle: a fresh session shows INSERT COIN until Claude moves.
const IDLE_ATTRACT = parseInt(process.env.ARCADE_ATTRACT_TICKS, 10) || 25; // ~5s after reply end
const STALL_ATTRACT = 1500; // ~5min of nothing at all
let lastEventTick = -1e9;
let replyDone = true;

function attractNow() {
  const age = ticks - lastEventTick;
  return (replyDone && age > IDLE_ATTRACT) || age > STALL_ATTRACT;
}
const tanks = new Map(); // transcript path -> {offset, partial, cols}
let maxCols = 80;
let ticks = 0;

// Ms. Pac-Man world state.
let pacD = 0;
let pacDir = 1; // 1 = rightward (the natural reading direction), -1 = leftward
let boost = 0;
let fright = 0;
let dying = 0;
let invuln = 0;
let gums = []; // {g: cols from right edge, born}
let lastGumTick = -999;
let fruit = null; // {e: cols from LEFT edge, glyph, idx}
let fruitIdx = 0;
let fruitTimer = parseInt(process.env.ARCADE_FRUIT_FIRST, 10) || FRUIT_FIRST_TICKS;
// Each cabinet keeps its own credit: a Frogger run must not inherit Ms.
// Pac-Man's total, and switching themes mid-session must not clobber either.
const scores = { pac: 0, frog: 0 };
let combo = 200;
let eatenFruits = [];
let lastPacInt = 0;
let lastUturnTick = -9999;
let inputMtime = 0;
let lastInputTick = -9999;
// Eaten-dot trail per rendered width: the swept [lo, hi] column range since
// the last lap wrap. Dots vanish only where she has actually been — deriving
// the field from her direction made every U-turn erase half the row at once.
const dotTrail = new Map(); // cols -> {lo, hi, last, W}

// Frogger world state.
let frogD = 0; // cols from the LEFT bank
let squash = 0;
let homes = 0;

// WOPR world state: where the teletype has got to. Deliberately LOGICAL — which
// beat, how many characters of it — and never per-width, because render() runs
// once for every distinct terminal width open and all of them have to be showing
// the same moment of the same conversation. Each width wraps it for itself.
let woprBeat = 0;
let woprChars = 0; // fractional — the reveal accumulates characters per tick
let woprHold = 0;
let woprLine = ''; // what is already committed on the line being printed
let woprFx = null; // per-tick state for the two animated beats
let woprBlinkFrom = 0; // tick the current line began, so the caret blinks from lit

try {
  const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  // Pre-split saves had one `score`; it was mostly Ms. Pac-Man's, so it lands there.
  scores.pac = (s.scores ? s.scores.pac : s.score) | 0;
  scores.frog = (s.scores ? s.scores.frog : 0) | 0;
  fruitIdx = s.fruitIdx | 0;
  homes = s.homes | 0;
  if (Array.isArray(s.eatenFruits)) eatenFruits = s.eatenFruits.slice(-3);
} catch {}

function saveState() {
  if (demoing) return; // a demo run is not your game — never let it reach disk
  try {
    fs.writeFileSync(STATE, JSON.stringify({ scores, fruitIdx, homes, eatenFruits: eatenFruits.slice(-3) }));
  } catch {}
}

// Demo mode (~/.arcade/demo): the cabinet's attract reel. Instead of freezing
// on INSERT COIN when Claude goes quiet, the game plays itself on synthetic
// traffic. Rather than guard every scoring site, a demo run swaps the whole
// persistent record out and puts it back untouched when real play resumes —
// so the demo scores, eats fruit and fills homes freely, and none of it counts.
let demoing = false;
let demoSave = null;
const DEMO_TOOLS = ['Read', 'Bash', 'Grep', 'Edit', 'Glob', 'Write', 'Read', 'Bash'];
let demoSeq = 0;

function demoOn() {
  try {
    return /^on|^1|^true|^yes/.test(fs.readFileSync(DEMO, 'utf8').trim());
  } catch {
    return false;
  }
}

function enterDemo() {
  demoSave = { scores: { ...scores }, fruitIdx, homes, eatenFruits };
  scores.pac = 0;
  scores.frog = 0;
  fruitIdx = 0; // the demo always replays level 1, cherries first
  homes = 0;
  eatenFruits = [];
  demoing = true;
}

function exitDemo() {
  scores.pac = demoSave.scores.pac;
  scores.frog = demoSave.scores.frog;
  fruitIdx = demoSave.fruitIdx;
  homes = demoSave.homes;
  eatenFruits = demoSave.eatenFruits;
  demoing = false;
  demoSave = null;
}

// One beat of fake Claude. Density is capped, not rated: creatures cross at
// roughly half a column a second and so live for MINUTES, and a steady spawn
// rate silts up to the real cap (a creature per 7 columns) within a minute —
// a wall of traffic, not a game. A handful on the line reads as something to
// dodge, and the reel refills a slot a few seconds after one exits.
const DEMO_CAP = 6;

function demoBeat() {
  while (fish.length > DEMO_CAP) cullNearestExit(); // thin out what real play left behind
  // Everything enters at d=0, so spawning while the last one is still by the
  // gate stacks them nose to tail; they cross at different speeds and never
  // recover the gap. Wait for the entry to clear instead.
  const gateClear = fish.every((f) => f.d > 6);
  if (fish.length < DEMO_CAP && gateClear && Math.random() < 0.08) {
    demoSeq++;
    spawnFish(DEMO_TOOLS[demoSeq % DEMO_TOOLS.length], 'demo/' + (demoSeq % 37) + '.js');
  }
  if (Math.random() < 0.02) dropGum(); // self-throttled to one per ~10s
}

function theme() {
  try {
    return fs.readFileSync(THEME, 'utf8').trim() || 'sea';
  } catch {
    return 'sea';
  }
}

function isPacTheme(t) {
  return /pac|arcade/.test(t);
}

// There is ONE Ms. Pac-Man theme; it draws with whatever it has. With
// ArcadeSprites.ttf installed it uses the pixel sprites, otherwise the Unicode
// glyphs — the same game either way, so the font is an upgrade and never a
// prerequisite. Checked on disk rather than remembered, so `arcade font
// install|remove` switches a running daemon over; cached briefly because this
// is asked once per render, five times a second.
const FONT_PATHS = [
  path.join(os.homedir(), 'Library', 'Fonts', 'ArcadeSprites.ttf'), // macOS
  path.join(os.homedir(), '.local', 'share', 'fonts', 'ArcadeSprites.ttf'), // Linux/fontconfig
];
let fontSeen = false;
let fontCheckedAt = -1e9;

function spriteFont() {
  if (ticks - fontCheckedAt < 25) return fontSeen; // re-stat every ~5s
  fontCheckedAt = ticks;
  fontSeen = FONT_PATHS.some((p) => {
    try {
      return fs.statSync(p).size > 0;
    } catch {
      return false;
    }
  });
  return fontSeen;
}

function fishCap() {
  return Math.max(10, Math.floor(maxCols / 7));
}

// The HUD steals these from the playfield. Both the simulation and every
// renderer must agree on the result — they used to differ by 4 columns, which
// put the far end of the maze off the edge of the screen.
const HUD_SCORE_W = 12;
const HUD_TROPHY_W = 7;
const HUD_MIN_COLS = 50;

function playWidth(cols) {
  const Wt = Math.max(20, cols - MARGIN);
  return Wt >= HUD_MIN_COLS ? Wt - HUD_SCORE_W - HUD_TROPHY_W : Wt;
}

function mazeWidth() {
  return playWidth(maxCols);
}

// The 7-column trophy slot on the right of the HUD: fruits she has eaten, or
// frogs safely home. A demo run labels it DEMO instead — the reel's trophies
// are not yours, and the word is the only tell that the score isn't real.
// Only ever drawn when the HUD is on, where the slot is exactly 7 wide.
function trophySlot(frog) {
  if (demoing) return '   ' + '\x1b[0;2;37m' + PAC_BG + 'DEMO' + PAC_WATER;
  if (frog) {
    const n = Math.min(homes % 5 || (homes ? 5 : 0), 5); // filled home slots this level
    return ' '.repeat(7 - n) + FROG_COLOR + SPR_FROG.sit.repeat(n) + PAC_WATER;
  }
  const t = eatenFruits.slice(-3);
  return ' '.repeat(7 - 2 * t.length) + t.join(''); // fruit emoji are 2 cells each
}

// A power gum (or, in Frogger, a fly) lands a little ahead of the hero.
// gums[].g counts columns from the RIGHT edge.
function dropGum() {
  if (ticks - lastGumTick < 50) return; // at most one per ~10s, or fright never ends
  lastGumTick = ticks;
  const g = /frog/.test(theme())
    ? Math.max(1, mazeWidth() - 2 - (frogD % mazeWidth()) - 10 - (ticks % 7))
    : (pacD % (mazeWidth() - 1)) + 10 + (ticks % 7);
  gums.push({ g, born: ticks });
}

function pollInput() {
  let st;
  try {
    st = fs.statSync(INPUT);
  } catch {
    return;
  }
  if (st.mtimeMs === inputMtime) return;
  inputMtime = st.mtimeMs;
  let c = '';
  try {
    c = fs.readFileSync(INPUT, 'utf8').trim();
  } catch {
    return;
  }
  lastInputTick = ticks;
  if (c === 'L') pacDir = -1;
  else if (c === 'R') pacDir = 1;
  else if (c === 'B') boost = 15;
}

// One of each ghost on screen, like the cabinet: a spawn takes the first free
// color (blinky first); with all four out, the event adds no ghost — the fish
// still swims for the sea/safari themes, it just isn't a ghost (idx null).
function nextGhostIdx() {
  const used = new Set(fish.map((f) => f.ghostIdx));
  for (let i = 0; i < GHOST_COLORS.length; i++) if (!used.has(i)) return i;
  return null;
}

function spawnFish(tool, file) {
  const big = BIG_TOOLS.has(tool);
  const set = big ? BIG : SMALL;
  const safariSet = big ? SAFARI_BIG : SAFARI_SMALL;
  const t = theme();
  // Ghosts drift slower than she runs (0.5/tick) so they linger and she
  // overtakes them; Frogger traffic keeps a steady lane speed; sea fish and
  // safari animals dart.
  const slow = isPacTheme(t) || /frog/.test(t);
  fish.push({
    d: 0,
    speed: slow ? 0.08 + (hash(tool + file) % 12) / 100 : 1.0 + (hash(tool + file) % 50) / 100,
    seaGlyph: set[hash(file) % set.length],
    safariGlyph: safariSet[hash(file) % safariSet.length],
    ghostIdx: nextGhostIdx(),
    hue: hash(file) % GHOST_COLORS.length, // frogger traffic paint, ghost-independent
    froggerKind: big ? 'truck' : ['car', 'car', 'car', 'log', 'turtle'][hash(file + 'frog') % 5],
  });
  if (big) dropGum(); // a Write is worth a power gum
  if (fish.length > fishCap()) cullNearestExit();
}

// Cull the creature nearest the exit edge, not the oldest — the oldest can be
// anywhere, and vanishing mid-field looks like a bug.
function cullNearestExit() {
  let imax = 0;
  for (let i = 1; i < fish.length; i++) if (fish[i].d > fish[imax].d) imax = i;
  fish.splice(imax, 1);
}

// Draw a 2-column glyph at xi, or the nearest free column — a creature whose
// cell is taken must not just skip a frame (it reads as blinking in and out).
function putWideNear(cells, taken, xi, glyph, W) {
  for (const off of [0, -1, 1, -2, 2]) {
    const x = xi + off;
    if (x < 0 || x > W - 2 || taken[x] || taken[x + 1]) continue;
    cells[x] = glyph;
    cells[x + 1] = '';
    taken[x] = taken[x + 1] = true;
    return;
  }
}

// Draw a 1-column sprite at xi, preferring a column with an EMPTY NEIGHBOUR on
// each side. The sprites fill nearly their whole em and bleed a little past it,
// so two of them in adjacent columns merge into one unreadable blob — a free
// cell is not enough, they need air. Falls back to any free column rather than
// dropping the creature: skipping a frame reads as blinking, not as traffic.
function putSpacedNear(cells, taken, xi, glyph, W) {
  const free = (x) => x >= 0 && x <= W - 1 && !taken[x];
  for (const off of [0, 1, -1, 2, -2, 3, -3]) {
    const x = xi + off;
    if (!free(x) || (x > 0 && taken[x - 1]) || (x < W - 1 && taken[x + 1])) continue;
    cells[x] = glyph;
    taken[x] = true;
    return;
  }
  for (const off of [0, 1, -1, 2, -2]) {
    const x = xi + off;
    if (!free(x)) continue;
    cells[x] = glyph;
    taken[x] = true;
    return;
  }
}

function harvest(line) {
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return;
  }
  // Busy state, from transcript structure rather than raw silence: a user
  // entry (prompt or tool result) means Claude's turn is starting/ongoing; an
  // assistant entry ends the turn only when stop_reason says so. Long silent
  // thinking keeps replyDone=false, so the game keeps running through it.
  // Local slash commands (/model, /theme…) also land as type:"user" entries —
  // isMeta caveats, <command-name> echoes, <local-command-stdout> — with no
  // assistant reply ever following; counting those as turn-start left the
  // game running while the user was still typing.
  if (obj && obj.type === 'user') {
    const c = obj.message && obj.message.content;
    const localCmd = obj.isMeta === true ||
      (typeof c === 'string' && /^\s*<(local-command-|command-name)/.test(c));
    if (!localCmd) {
      lastEventTick = ticks;
      replyDone = false;
    }
  } else if (obj && obj.type === 'assistant' && obj.message) {
    lastEventTick = ticks;
    const sr = obj.message.stop_reason;
    replyDone = sr === 'end_turn' || sr === 'stop_sequence';
  }
  const content = obj && obj.message && obj.message.content;
  if (!Array.isArray(content)) return;
  for (const item of content) {
    if (item.type === 'text' && item.text && item.text.trim()) {
      dropGum(); // Claude replied — a gum appears in her path
      continue;
    }
    if (item.type !== 'tool_use') continue;
    // Every tool call puts a creature on screen — a Bash-heavy session used
    // to leave the maze empty. Hash whatever varies most for that tool.
    const input = item.input || {};
    const file = input.file_path || input.notebook_path || input.command || input.pattern || input.prompt || item.name;
    if (typeof file !== 'string') continue;
    spawnFish(item.name, file);
  }
}

function scanTanks() {
  let names;
  try {
    names = fs.readdirSync(TANKS);
  } catch {
    return 0;
  }
  const now = Date.now();
  const seen = new Set();
  for (const name of names) {
    const marker = path.join(TANKS, name);
    let st;
    try {
      st = fs.statSync(marker);
    } catch {
      continue;
    }
    if (now - st.mtimeMs > IDLE_EXIT_MS) {
      try {
        fs.unlinkSync(marker);
      } catch {}
      continue;
    }
    let lines;
    try {
      lines = fs.readFileSync(marker, 'utf8').split('\n');
    } catch {
      continue;
    }
    const tp = (lines[0] || '').trim();
    if (!tp) continue;
    const cols = Math.min(400, Math.max(40, parseInt(lines[1], 10) || 80));
    seen.add(tp);
    const t = tanks.get(tp);
    if (t) {
      t.cols = cols;
    } else {
      let size = 0;
      try {
        size = fs.statSync(tp).size;
      } catch {}
      tanks.set(tp, { offset: size, partial: '', cols }); // adopt at the end: no replay stampede
    }
  }
  for (const tp of tanks.keys()) if (!seen.has(tp)) tanks.delete(tp);
  return seen.size;
}

function tailAll() {
  for (const [tp, s] of tanks) {
    let size;
    try {
      size = fs.statSync(tp).size;
    } catch {
      continue;
    }
    if (size < s.offset) {
      s.offset = 0;
      s.partial = '';
    }
    if (size === s.offset) continue;
    const fd = fs.openSync(tp, 'r');
    const buf = Buffer.alloc(size - s.offset);
    fs.readSync(fd, buf, 0, buf.length, s.offset);
    fs.closeSync(fd);
    s.offset = size;
    const lines = (s.partial + buf.toString('utf8')).split('\n');
    s.partial = lines.pop();
    for (const line of lines) if (line.trim()) harvest(line);
  }
}

function writeFrame(cols, line) {
  const frame = path.join(ARCADE, 'frame.' + cols);
  fs.writeFileSync(frame + '.tmp', line);
  fs.renameSync(frame + '.tmp', frame);
}

function renderSeaFor(cols) {
  const W = Math.max(20, cols - MARGIN);
  const cells = new Array(W).fill('~');
  const taken = new Array(W).fill(false);
  for (const f of fish) {
    const xi = W - 2 - Math.round(f.d);
    if (xi < 0 || xi > W - 2) continue;
    putWideNear(cells, taken, xi, xi < 4 ? '🫧' : f.seaGlyph, W);
  }
  writeFrame(cols, SEA_WATER + cells.join('') + '\x1b[0m');
}

function renderSafariFor(cols) {
  const W = Math.max(20, cols - MARGIN);
  const cells = new Array(W).fill('.');
  const taken = new Array(W).fill(false);
  for (const f of fish) {
    const xi = W - 2 - Math.round(f.d);
    if (xi < 0 || xi > W - 2) continue;
    putWideNear(cells, taken, xi, xi < 4 ? '💨' : f.safariGlyph, W);
  }
  // Trees stand in front — animals slip behind them. flatten() dissolves any
  // emoji overlapping a tree column so the line keeps exactly W columns.
  const flatten = (i) => {
    if (i < 0 || i >= W) return;
    if (cells[i] === '') {
      cells[i - 1] = '.';
      cells[i] = '.';
    } else if (i + 1 < W && cells[i + 1] === '') {
      cells[i] = '.';
      cells[i + 1] = '.';
    }
  };
  for (const [frac, tree] of TREES) {
    const tx = Math.floor(W * frac);
    if (tx > W - 2) continue;
    flatten(tx);
    flatten(tx + 1);
    cells[tx] = tree;
    cells[tx + 1] = '';
  }
  writeFrame(cols, SAFARI_GROUND + cells.join('') + '\x1b[0m');
}

// The Ms. Pac-Man renderer, shared by the Unicode and sprite editions. Game
// mutations (eating, dying, scoring) run only for the canonical (widest)
// view; other widths just draw.
function renderPacFor(cols, sprites) {
  const Wt = Math.max(20, cols - MARGIN);
  const hud = Wt >= HUD_MIN_COLS;
  const scoreW = hud ? HUD_SCORE_W : 0;
  const trophyW = hud ? HUD_TROPHY_W : 0;
  const W = Wt - scoreW - trophyW;
  const canonical = cols === maxCols;
  const lap = W - 1;
  const pos = W - 2 - (((Math.round(pacD) % lap) + lap) % lap);

  const cells = new Array(W);
  const taken = new Array(W).fill(false);
  // Dots disappear only where she has swept this lap; a pos jump of more than
  // half the row is a lap wrap (or respawn, or resize) — the field refills.
  let tr = dotTrail.get(cols);
  if (!tr || tr.W !== W || Math.abs(tr.last - pos) > W / 2) tr = { lo: pos, hi: pos, last: pos, W };
  const prevLo = tr.lo; // the swept span as it stood BEFORE this tick — the
  const prevHi = tr.hi; // difference is what she has just cleared
  tr.lo = Math.min(tr.lo, pos);
  tr.hi = Math.max(tr.hi, pos);
  tr.last = pos;
  dotTrail.set(cols, tr);
  const swept = (x) => x >= tr.lo && x <= tr.hi; // eaten this lap
  const justSwept = (x) => swept(x) && !(x >= prevLo && x <= prevHi);
  for (let i = 0; i < W; i++) cells[i] = i >= tr.lo && i <= tr.hi ? ' ' : '·';

  const putWide = (xi, glyph) => {
    if (xi < 0 || xi > W - 2 || taken[xi] || taken[xi + 1]) return;
    cells[xi] = glyph;
    cells[xi + 1] = '';
    taken[xi] = taken[xi + 1] = true;
  };

  // Gums: baseline pair (respawn each lap) + gums dropped by Claude. Gums
  // near each other read as a rendering bug (power pellets sit far apart on
  // the cabinet), so a gum within 12 columns of an already-placed one stays
  // hidden (and uneatable) until the field clears.
  const gumCell = GUM_COLOR + '●' + PAC_WATER;
  const gumCols = [];
  const gumRoom = (gx) => gumCols.every((c) => Math.abs(c - gx) >= 12);
  for (const frac of POWER_GUMS) {
    const gx = Math.floor(W * frac);
    // Eating fires on the tick her sweep first covers the gum — once. Testing
    // gx === pos instead re-fired for every tick she stood on that column,
    // paying 50 a tick and re-arming fright; and at boost speed she could step
    // clean over the column and eat nothing at all.
    if (justSwept(gx) && dying === 0 && canonical) {
      fright = FRIGHT_TICKS;
      combo = 200;
      scores.pac += 50;
      // A gum re-decides which way she faces, the way the cabinet reverses
      // every ghost the instant you take one. Without clearing the cooldown
      // she almost never could turn: fleeing is what carries her onto a gum
      // in the first place, so the 25-tick block covered the whole window.
      lastUturnTick = -9999;
    }
    // Visible until she has swept it, then GONE until the lap wraps and the
    // field refills — the same rule the dots follow. (This used to draw only
    // where gx < pos, so the gum popped into existence as she ate it.)
    if (!swept(gx) && !taken[gx]) {
      cells[gx] = gumCell;
      taken[gx] = true;
      gumCols.push(gx);
    }
  }
  gums = gums.filter((gum) => {
    const gx = W - 2 - Math.round(gum.g);
    if (gx < 0 || gx > W - 1) return true;
    // Eating is tested FIRST and by swept range, not by gx === pos. The old
    // order let the spacing rule skip the whole check, so a gum sitting near
    // another was invisible AND uneatable — she walked over it, nothing
    // happened, and it reappeared later still uneaten.
    if (justSwept(gx) && dying === 0) {
      if (!canonical) return true;
      fright = FRIGHT_TICKS;
      combo = 200;
      scores.pac += 50;
      lastUturnTick = -9999; // as above: let her turn and hunt straight away
      return false; // eaten — gone for good
    }
    if (gumRoom(gx) && !taken[gx]) {
      cells[gx] = gumCell;
      taken[gx] = true;
      gumCols.push(gx);
    }
    return true;
  });

  // Ghost encounters (canonical only mutates).
  if (canonical && dying === 0) {
    for (const f of fish) {
      if (f.ghostIdx === null) continue; // fifth fish, not a ghost
      const xi = W - 2 - Math.round(f.d);
      if (xi < 0 || xi > W - 1 || f.eaten) continue;
      if (Math.abs(xi - pos) <= 1) {
        if (fright > 0) {
          f.eaten = true; // gulp — eyes flee right, back home
          scores.pac += combo;
          combo = Math.min(1600, combo * 2);
        } else if (invuln === 0 && (ticks + xi) % 4 === 0) {
          dying = DYING_TICKS; // caught. the maze goes quiet
        }
      }
    }
  }

  // Her sprite goes down first so she always wins the cell contest. Arcade
  // sprites are emoji-sized — drawn across two cells, so reserve the neighbor
  // with a real space: the terminal advances one column for these codepoints
  // (unlike width-2 emoji fruit) and the glyph overdraws the space.
  const reserve = (xi) => {
    if (sprites && xi + 1 < W && !taken[xi + 1]) {
      cells[xi + 1] = ' ';
      taken[xi + 1] = true;
    }
  };
  if (dying > 0) {
    cells[pos] = PAC_COLOR + DEATH_FRAMES[Math.min(DEATH_FRAMES.length - 1, Math.floor((DYING_TICKS - dying) / 2))] + PAC_WATER;
    taken[pos] = true;
    reserve(pos);
  } else {
    // She is ALWAYS drawn. The post-respawn grace period used to blink her at
    // ticks % 2 — a 400ms cycle sampled by a ~1s statusline refresh, which
    // aliases into her randomly vanishing for seconds at a time with no ghost
    // anywhere near her. (The cabinet has no blinking invulnerability either.)
    // chomp per column, not per tick: the ~1s statusline refresh aliases any
    // time-based cycle into long stuck-open/stuck-closed streaks — keyed to
    // her position, every visible step is a visible chomp
    const open = (((Math.round(pacD) % 2) + 2) % 2) === 0;
    const her = sprites
      ? open ? (pacDir === 1 ? SPR_MS.right : SPR_MS.left) : (pacDir === 1 ? SPR_MS.closedR : SPR_MS.closedL)
      : open ? (pacDir === 1 ? PAC_OPEN_R : PAC_OPEN) : PAC_CLOSED;
    cells[pos] = PAC_COLOR + her + PAC_WATER;
    taken[pos] = true;
    reserve(pos);
  }

  // A ghost whose cell is occupied shifts to the nearest free one instead of
  // skipping the frame. Now that all four converge on her they overlap
  // constantly, and a ghost that silently isn't drawn reads as teleporting.
  const putGhost = (xi, glyph) => {
    for (const off of [0, -1, 1, -2, 2, -3, 3]) {
      const x = xi + off;
      if (x < 0 || x > W - 1 || taken[x]) continue;
      if (sprites && (x > W - 2 || taken[x + 1])) continue; // needs both cells
      cells[x] = glyph;
      taken[x] = true;
      reserve(x);
      return;
    }
  };

  for (const f of fish) {
    if (f.ghostIdx === null) continue; // fifth fish, not a ghost
    const xi = W - 2 - Math.round(f.d);
    if (xi < -3 || xi > W + 2) continue;
    const flashing = sprites && fright > 0 && fright < 6 && ticks % 2 === 1; // wears off
    const glyph = sprites
      ? f.eaten
        ? SPR_EYES
        : fright > 0
          ? flashing ? SPR_FLASH : SPR_FRIGHT
          : SPR_GHOSTC[f.ghostIdx][(((Math.round(f.d) + f.ghostIdx) % 2) + 2) % 2] // pupils flick as they drift
      : f.eaten
        ? EYES
        : GHOST;
    const color = f.eaten
      ? EYES_COLOR
      : fright > 0
        ? flashing ? FLASH_COLOR : FRIGHT_COLOR
        : GHOST_COLORS[f.ghostIdx];
    putGhost(xi, color + glyph + PAC_WATER);
  }

  if (fruit) {
    const fx = Math.round(fruit.e);
    if (Math.abs(fx - pos) <= 1 && dying === 0) {
      if (canonical) {
        scores.pac += FRUIT_VALUES[fruit.idx];
        eatenFruits.push(fruit.glyph);
        eatenFruits = eatenFruits.slice(-3);
        fruit = null;
      }
    } else {
      putWide(fx, fruit.glyph);
    }
  }

  let line = PAC_WATER;
  if (hud) {
    line += '\x1b[0;91m' + PAC_BG + '1UP ' + HUD_COLOR + String(Math.min(scores.pac, 999999)).padStart(6) + PAC_WATER + '  ';
  }
  line += cells.join('');
  if (hud) {
    line += trophySlot(false);
  }
  writeFrame(cols, line + '\x1b[0m');
}

// Frogger on one line: the frog hops rightward toward home (the right edge),
// traffic drives leftward at him. Cars and trucks squash; logs and turtles
// are just flotsam he clears; flies are bonus points. Same rule as the pac
// renderer: only the canonical (widest) view mutates the game.
function renderFrogFor(cols) {
  const Wt = Math.max(20, cols - MARGIN);
  const hud = Wt >= HUD_MIN_COLS;
  const scoreW = hud ? HUD_SCORE_W : 0;
  const trophyW = hud ? HUD_TROPHY_W : 0;
  const W = Wt - scoreW - trophyW;
  const canonical = cols === maxCols;
  const fx = Math.min(W - 1, Math.round(frogD));

  const cells = new Array(W);
  const taken = new Array(W).fill(false);
  for (let i = 0; i < W; i++) cells[i] = i % 4 === 2 ? '·' : ' '; // dashed lane markers

  // flies (dropped by Claude's replies; the gum list, reused)
  gums = gums.filter((gum) => {
    const gx = W - 2 - Math.round(gum.g);
    if (gx < 0 || gx > W - 1) return true;
    if (gx === fx && squash === 0) {
      if (!canonical) return true;
      scores.frog += 200; // gulp
      return false;
    }
    if (!taken[gx]) {
      cells[gx] = HUD_COLOR + SPR_FLY + PAC_WATER;
      taken[gx] = true;
    }
    return true;
  });

  // home! the right bank
  if (canonical && squash === 0 && fx >= W - 1) {
    homes++;
    scores.frog += homes % 5 === 0 ? 1000 : 50; // fifth home fills the row
    frogD = 0;
  }

  // Reserve the frog's cell before the traffic draws, so nothing gets nudged
  // underneath him and silently overwritten — he still paints last, below.
  taken[fx] = true;

  // traffic drives leftward; flotsam floats along with it
  for (const f of fish) {
    const xi = W - 2 - Math.round(f.d);
    if (xi < 0 || xi > W - 1) continue;
    const k = f.froggerKind;
    if (canonical && squash === 0 && xi === fx && (k === 'car' || k === 'truck')) {
      squash = SQUASH_TICKS; // splat
    }
    const glyph = k === 'car' ? SPR_CAR : k === 'truck' ? SPR_TRUCK : k === 'log' ? SPR_LOG : SPR_TURTLE;
    const color = k === 'car' ? CAR_COLORS[f.hue] : k === 'truck' ? TRUCK_COLOR : k === 'log' ? LOG_COLOR : TURTLE_COLOR;
    putSpacedNear(cells, taken, xi, color + glyph + PAC_WATER, W);
  }

  // the frog draws last — he rides over the flotsam
  cells[fx] = squash > 0
    ? SQUASH_COLOR + SPR_SQUASH + PAC_WATER
    : FROG_COLOR + (Math.floor(ticks / 2) % 2 === 0 ? SPR_FROG.leap : SPR_FROG.sit) + PAC_WATER;
  taken[fx] = true;

  let line = PAC_WATER;
  if (hud) {
    line += '\x1b[0;92m' + PAC_BG + '1UP ' + HUD_COLOR + String(Math.min(scores.frog, 999999)).padStart(6) + PAC_WATER + '  ';
  }
  line += cells.join('');
  if (hud) {
    line += trophySlot(true);
  }
  writeFrame(cols, line + '\x1b[0m');
}

// The cabinet between games: frozen maze, INSERT COIN. It blinks exactly
// twice as the reply ends, then holds steady — a statusline that keeps
// flashing while the user is typing is a distraction, not an attract mode.
// The "off" phase dims instead of vanishing so the text survives the ~1s
// refresh aliasing whatever moment it samples.
function renderAttractFor(cols, frog) {
  const Wt = Math.max(20, cols - MARGIN);
  const hud = Wt >= HUD_MIN_COLS;
  const W = Wt - (hud ? HUD_SCORE_W + HUD_TROPHY_W : 0);
  const msg = W >= 27 ? 'I N S E R T   C O I N' : 'INSERT COIN';
  const age = ticks - lastEventTick - IDLE_ATTRACT; // ticks since attract began
  const on = age >= 20 || Math.floor(age / 5) % 2 === 1; // dim/bright twice (~4s), then steady
  const style = frog
    ? (on ? '\x1b[0;1;92m' : '\x1b[0;2;32m') + PAC_BG
    : (on ? '\x1b[0;1;38;5;208m' : '\x1b[0;2;33m') + PAC_BG;
  const pad = Math.max(0, Math.floor((W - msg.length) / 2));
  let line = PAC_WATER;
  // The cabinet keeps the running game's own HUD — the 1UP tint and the
  // trophies belong to the game you just stopped playing, not to Ms. Pac-Man.
  if (hud) line += (frog ? '\x1b[0;92m' : '\x1b[0;91m') + PAC_BG + '1UP ' + HUD_COLOR + String(Math.min(frog ? scores.frog : scores.pac, 999999)).padStart(6) + PAC_WATER + '  ';
  line += ' '.repeat(pad) + style + msg + PAC_WATER + ' '.repeat(Math.max(0, W - pad - msg.length));
  if (hud) line += trophySlot(frog);
  writeFrame(cols, line + '\x1b[0m');
}

// The caret blinks the whole time, typing or idle. One second lit, one second
// dark — and that is deliberately SLOWER than a real cursor, because slowing it
// down is what makes it look fast.
//
// We write frames five times a second but the statusline only SAMPLES them,
// about once a second while Claude is idle, which is exactly when someone is
// sitting looking at it. A blink faster than the sampler cannot be shown; it
// beats against it instead. Measured, at one sample a second: a 0.4s phase
// reads as a 4.4s blink, 0.6s as a 6.0s blink, and 0.8s and 1.2s as visible
// jitter. Matching the phase to the sample period gives #.#.#.#.# — a change
// on every single repaint, the fastest a 1fps display can physically show.
// So this tracks refreshInterval (1s) rather than any real terminal's ~0.5s.
//
// The phase counts from the START OF THE CURRENT LINE rather than the wall
// clock, and starts lit, so a line can never land with the caret dark and sit
// there — which is what made it read as not blinking at all.
const WOPR_BLINK = Math.round(1000 / TICK_MS); // one statusline refresh
function woprCaret() {
  return Math.floor((ticks - woprBlinkFrom) / WOPR_BLINK) % 2 === 0 ? WOPR_CURSOR : ' ';
}

function woprText(b) {
  return b.s !== undefined ? b.s : b.u !== undefined ? b.u : '';
}

function woprRoll() {
  return WOPR_ROLL[Math.floor(Math.random() * WOPR_ROLL.length)];
}

function woprFxInit(kind) {
  if (kind === 'defcon') return { kind, t: 0, n: 5 };
  return { kind, t: 0, locked: 0, roll: WOPR_CODE.split('').map(() => woprRoll()) };
}

// Move to the next beat, wrapping the script. A `c` beat carries on the line the
// last one was printing — a prompt, then what he types into it — so LOGON: and
// Joshua arrive on one line at two different speeds. Anything else starts fresh.
function woprNext() {
  const done = woprText(WOPR_SCRIPT[woprBeat]);
  woprBeat = (woprBeat + 1) % WOPR_SCRIPT.length;
  const next = WOPR_SCRIPT[woprBeat];
  woprLine = next.c ? woprLine + done : '';
  woprFx = next.fx ? woprFxInit(next.fx) : null;
  const text = next.fx ? '' : woprText(next);
  // Reveal the first slice immediately rather than starting at zero. A beat
  // opening empty left one whole tick of blank line, and at the statusline's
  // ~1fps that was landing in roughly one sampled frame in five — the screen
  // read as going dark between sentences.
  woprChars = text.length ? Math.min(text.length, next.s !== undefined ? WOPR_SYS_RATE : WOPR_USR_RATE) : 0;
  // A beat with nothing to type never reaches the rest below, so it takes its
  // rest here — otherwise the deliberate blank before GLOBAL THERMONUCLEAR WAR
  // falls straight through and the pause never lands.
  woprHold = !next.fx && text.length === 0 ? woprRest(next) : 0;
  woprBlinkFrom = ticks; // every line opens with the caret lit
}

// One tick of printing. The random churn in the code hunt is rolled HERE rather
// than in the renderer: the renderer runs once per open terminal width, and two
// windows rolling their own characters would disagree about what the screen says.
function woprTick() {
  const b = WOPR_SCRIPT[woprBeat];
  if (b.fx) {
    if (!woprFx) woprFx = woprFxInit(b.fx);
    const f = woprFx;
    f.t++;
    if (f.kind === 'defcon') {
      if (f.t % WOPR_DEFCON_STEP === 0 && f.n > 1) f.n--;
      if (f.n === 1 && f.t > WOPR_DEFCON_STEP * 6) woprNext();
      return;
    }
    // Re-roll every other tick: at 400ms the churn survives the statusline's
    // sampling, where a per-tick roll would just alias into a blur.
    if (f.t % 2 === 0) {
      for (let i = 0; i < f.roll.length; i++) {
        if (WOPR_CODE_ORDER.indexOf(i) >= f.locked) f.roll[i] = woprRoll();
      }
    }
    if (f.t % WOPR_LOCK_STEP === 0 && f.locked < WOPR_CODE.length) f.locked++;
    if (f.locked === WOPR_CODE.length && f.t > WOPR_CODE.length * WOPR_LOCK_STEP + WOPR_LOCK_STEP * 2) woprNext();
    return;
  }
  const text = woprText(b);
  if (woprChars < text.length) {
    woprChars = Math.min(text.length, woprChars + (b.s !== undefined ? WOPR_SYS_RATE : WOPR_USR_RATE));
    if (woprChars >= text.length) woprHold = woprRest(b);
    return;
  }
  if (woprHold > 0) {
    woprHold--;
    return;
  }
  woprNext();
}

// The two beats that are animation rather than text: NORAD walking down the
// DEFCON ladder, and Joshua brute-forcing the launch code — ten positions going
// solid one at a time and out of order, the rest still rolling.
function woprFxRow(f, W) {
  let body = '';
  let vis = 0;
  if (f.kind === 'defcon') {
    body = WOPR_ON + 'DEFCON  ';
    vis = 8;
    for (const n of [5, 4, 3, 2, 1]) {
      if (n !== 5) {
        body += ' ';
        vis++;
      }
      body += (n >= f.n ? WOPR_ON : WOPR_OFF) + n;
      vis++;
    }
    return { body, vis };
  }
  if (W >= 34) {
    body = WOPR_ON + 'LAUNCH CODE:  ';
    vis = 14;
  }
  for (let i = 0; i < WOPR_CODE.length; i++) {
    if (i) {
      body += ' ';
      vis++;
    }
    const locked = WOPR_CODE_ORDER.indexOf(i) < f.locked;
    body += (locked ? WOPR_ON : WOPR_OFF) + (locked ? WOPR_CODE[i] : f.roll[i]);
    vis++;
  }
  return { body, vis };
}

// Your turn: the cabinet stops where it stood, and so does the caret. The whole
// card — message and caret together — blinks twice as the reply ends and then
// holds steady, the same cadence as INSERT COIN and for the same reason: a
// statusline still moving while you type is a distraction, and the caret is no
// more exempt from that than the words are. It blinks while WOPR is actually
// typing, which is where a cursor means something; here it just sits lit.
function renderWoprIdleFor(cols) {
  const W = Math.max(20, cols - MARGIN);
  const msg = W >= 24 ? 'SHALL WE PLAY A GAME?' : 'SHALL WE PLAY?';
  const age = ticks - lastEventTick - IDLE_ATTRACT;
  const on = age >= 20 || Math.floor(age / 5) % 2 === 1;
  const pad = Math.max(0, Math.floor((W - msg.length - 1) / 2));
  const line = WOPR_ON + ' '.repeat(pad) + (on ? WOPR_ON : WOPR_OFF) + msg + WOPR_ON + (on ? WOPR_CURSOR : ' ');
  writeFrame(cols, line + WOPR_ON + ' '.repeat(Math.max(0, W - pad - msg.length - 1)) + '\x1b[0m');
}

// One row of a scrolling terminal. The wrap is a dumb hard break at the edge
// rather than a word wrap, because the film's spacing IS the text — two spaces
// after every period, the indented menu items — and word wrapping eats it.
function renderWoprFor(cols, idle) {
  if (idle) return renderWoprIdleFor(cols);
  const W = Math.max(20, cols - MARGIN);
  const b = WOPR_SCRIPT[woprBeat];
  let body;
  let vis;
  if (b.fx && woprFx) {
    ({ body, vis } = woprFxRow(woprFx, W));
  } else {
    const full = woprLine + woprText(b).slice(0, Math.floor(woprChars));
    const Wc = Math.max(8, W - 1); // one column kept for the cursor
    const row = full.slice(Math.floor(Math.max(0, full.length - 1) / Wc) * Wc);
    body = WOPR_ON + row + woprCaret();
    vis = row.length + 1;
  }
  writeFrame(cols, body + WOPR_ON + ' '.repeat(Math.max(0, W - vis)) + '\x1b[0m');
}

let prevWidthsKey = '';

function render() {
  const widths = new Set();
  for (const t of tanks.values()) widths.add(t.cols);
  if (widths.size === 0) widths.add(maxCols);
  maxCols = Math.max(...widths);
  const t = theme();
  const frog = /frog/.test(t);
  const wopr = /wopr/.test(t);
  const woprIdle = wopr && attractNow() && !demoOn();
  // demoing already means attract fired and demo mode took it over: the reel
  // draws the game, not the coin screen.
  const attract = !demoing && (isPacTheme(t) || frog) && attractNow();
  for (const cols of widths) {
    if (wopr) renderWoprFor(cols, woprIdle);
    else if (attract) renderAttractFor(cols, frog);
    else if (isPacTheme(t)) renderPacFor(cols, spriteFont());
    else if (frog) renderFrogFor(cols);
    else if (/safari/.test(t)) renderSafariFor(cols);
    else renderSeaFor(cols);
  }

  const key = [...widths].sort((a, b) => a - b).join(',');
  if (key !== prevWidthsKey) {
    prevWidthsKey = key;
    let names;
    try {
      names = fs.readdirSync(ARCADE);
    } catch {
      return;
    }
    for (const n of names) {
      if (!/^frame(\.|$)/.test(n)) continue;
      if (widths.has(parseInt(n.slice(6), 10))) continue;
      try {
        fs.unlinkSync(path.join(ARCADE, n));
      } catch {}
    }
  }
}

let lastFresh = Date.now();

function tick() {
  ticks++;
  if (scanTanks() > 0) {
    lastFresh = Date.now();
  } else if (Date.now() - lastFresh > IDLE_EXIT_MS) {
    try {
      fs.unlinkSync(PID);
    } catch {}
    saveState();
    process.exit(0);
  }
  tailAll();

  const t = theme();
  const pacTheme = isPacTheme(t);
  const frogTheme = /frog/.test(t);
  const woprTheme = /wopr/.test(t);
  // Attract mode: with Claude quiet (waiting on the user, or a session just
  // opened), the game freezes and the statusline says INSERT COIN. The first
  // transcript event unfreezes it exactly where it stopped.
  const attract = (pacTheme || frogTheme) && attractNow();
  const demo = attract && demoOn();
  // Enter on the first idle tick, leave the moment demo stops applying —
  // Claude spoke again, or the user switched demo off mid-reel.
  if (demo && !demoing) enterDemo();
  else if (!demo && demoing) exitDemo();
  // WOPR is a terminal, not a playfield: none of the maze simulation below
  // applies to it. It prints only while Claude is working — the same rule that
  // freezes the other cabinets on INSERT COIN when it is your turn — and the
  // demo reel keeps it printing through the quiet.
  if (woprTheme) {
    const idle = attractNow() && !demoOn();
    if (!idle) woprTick();
    // Returning early skips the save at the bottom of tick(), so do it here:
    // switching to WOPR must not strand the last few seconds of a Ms. Pac-Man
    // run unwritten. WOPR itself keeps nothing — a fresh daemon starts at the
    // logon screen, which is where the film starts too.
    if (ticks % 25 === 0) saveState();
    render();
    return;
  }
  if (attract && !demo) {
    if (ticks % 25 === 0) saveState();
    render();
    return;
  }
  if (demo) demoBeat();
  // All speeds stay near 1 column/second: the statusline refreshes about once
  // a second, so anything faster reads as teleporting, not motion.
  const lap = mazeWidth() - 1;
  const herD = ((Math.round(pacD) % lap) + lap) % lap; // her spot in f.d space
  // Scatter/chase alternates on the cabinet's opening cadence. This is what
  // makes the ghosts read as hunting rather than milling about.
  const scatter = ticks % (SCATTER_TICKS + CHASE_TICKS) < SCATTER_TICKS;
  const blinky = fish.find((g) => g.ghostIdx === 0 && !g.eaten);

  for (const f of fish) {
    if (frogTheme) {
      f.d += f.speed; // steady traffic, no lane fatigue
    } else if (f.eaten) {
      f.d -= 0.4; // eyes hustle home to the right
    } else if (pacTheme && f.ghostIdx !== null) {
      if (fright > 0) {
        // Panicked: away from her, and slow — this is the window where she hunts.
        // Cornered, though, never gone. Unclamped, a ghost fleeing left walked
        // off the edge and straight into the cull below, so the one she was
        // chasing evaporated mid-window and the hunt had no quarry left. A
        // frightened ghost on the cabinet has nowhere to leave to either.
        const flee = f.d + FRIGHT_SPEED * (f.d >= herD ? 1 : -1);
        f.d = Math.min(mazeWidth() - 2, Math.max(0, flee));
      } else {
        f.d += GHOST_SPEED * Math.sign(ghostTarget(f, herD, lap, scatter, blinky) - f.d);
      }
    } else {
      f.d += f.speed;
      f.speed = Math.max(0.08, f.speed * 0.985);
    }
  }
  fish = fish.filter((f) => f.d < maxCols && f.d > -1);

  if (frogTheme) {
    if (squash > 0) {
      squash--;
      if (squash === 0) frogD = 0; // scraped off the road; back to the left bank
    } else {
      pollInput();
      if (ticks - lastInputTick > 150) pacDir = 1; // auto-pilot resumes ~30s after input
      frogD += 0.2 * pacDir * (boost > 0 ? 3 : 1);
      if (frogD < 0) frogD = 0;
      if (boost > 0) boost--;
    }
  } else if (dying > 0) {
    dying--;
    if (dying === 0) {
      pacD = Math.ceil(pacD / (mazeWidth() - 1)) * (mazeWidth() - 1); // respawn at a lap boundary
      lastPacInt = Math.round(pacD);
      invuln = INVULN_TICKS;
      fright = 0;
    }
  } else {
    pollInput();
    // Auto-pilot steering: she turns for a REASON — to escape, or to eat —
    // never at random. Escape outranks appetite. The cooldown keeps her from
    // flip-flopping while a threat sits just inside range, and the joystick
    // still owns her for ~30s per input.
    if (ticks - lastInputTick > 150 && ticks - lastUturnTick > 25) {
      const lap = mazeWidth() - 1;
      const p = ((Math.round(pacD) % lap) + lap) % lap; // cols from the right, same space as f.d
      let ahead = Infinity; // gap to the nearest hungry ghost the way she is headed
      let behind = Infinity; // ...and the way a U-turn would take her
      for (const f of fish) {
        if (f.ghostIdx === null || f.eaten) continue;
        const dist = (p - Math.round(f.d)) * pacDir; // >0: the ghost is ahead of her
        if (dist > 0) ahead = Math.min(ahead, dist);
        else behind = Math.min(behind, -dist);
      }
      // She breaks for a ghost closing in ahead — but only when breaking
      // helps: with ghosts both ways, reversing into the nearer one is worse
      // than running the gap she already has. Mid-fright they are food.
      const flee = fright === 0 && ahead <= 7 && behind > ahead;
      // Mid-fright the ghosts stop being a threat and turn into dinner, and
      // they run at half her speed — so a gum only pays out if she turns and
      // chases one down. Without this she strolled straight past the blue
      // ghosts and the 200/400/800/1600 combo never scored once in a session.
      const hunt = !flee && fright > 0 && behind < ahead && behind <= FRIGHT_CHASE;
      // Fruit drifts rightward at exactly her own speed, so one ahead of her
      // can never be caught — it would lead her forever. A fruit BEHIND is the
      // catchable one: turn, and the two of them close at double speed. She
      // doubles back only if the way behind is clearer than the fruit is far.
      let chase = false;
      if (!flee && !hunt && fruit) {
        const fd = (p - (mazeWidth() - 2 - Math.round(fruit.e))) * pacDir; // >0: ahead
        chase = fd < 0 && -fd <= FRUIT_CHASE && behind > -fd;
      }
      if (flee || hunt || chase) {
        pacDir = -pacDir;
        lastUturnTick = ticks;
      }
      // ...and she spends a boost on the hunt. Unboosted she gains 0.14/tick
      // on a fleeing ghost — four columns in a whole window, which is why the
      // 200/400/800/1600 combo never scored once. Sprinting triples her stride
      // and puts the gulp in reach. Only the auto-pilot arms this: the gate
      // above stands down for 30s after any joystick input, so a boost the
      // player spent is never overwritten by one she gave herself.
      const prey = hunt || chase ? behind : ahead;
      if (fright > 0 && prey <= FRIGHT_CHASE) boost = Math.max(boost, fright);
    }
    pacD -= 0.2 * pacDir * (boost > 0 ? 3 : 1); // pacD counts leftward; default dir is right
    if (pacTheme) {
      const p = Math.round(pacD);
      scores.pac += 10 * Math.abs(p - lastPacInt); // dot munching
      lastPacInt = p;
    }
    if (boost > 0) boost--;
    if (invuln > 0) invuln--;
    if (fright > 0) fright--;
  }

  gums = gums.filter((gum) => ticks - gum.born < GUM_LIFE);
  if (!fruit && --fruitTimer <= 0) {
    const idx = fruitIdx++ % FRUITS.length;
    fruit = { e: 0, glyph: FRUITS[idx], idx };
    fruitTimer = FRUIT_EVERY_TICKS;
  }
  if (fruit) {
    fruit.e += 0.2;
    if (fruit.e > maxCols) fruit = null;
  }

  if (ticks % 25 === 0) saveState();
  render();
}

setInterval(tick, TICK_MS);
tick();
