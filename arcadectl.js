#!/usr/bin/env node
// arcadectl.js — joystick for the statusline games (Ms. Pac-Man, R-Type,
// Frogger).
// Run in any spare terminal pane: `arcade play`, or `arcade play <session>` to
// steer one window. Keys register while this pane has focus; each running game
// polls its input file every tick. Without a
// joystick running they play themselves (and resume auto-pilot ~30s after the
// last input).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// `arcade play` sets ARCADE_INPUT when the joystick is aimed at one window;
// without it we write the shared input file, which every running game reads.
const INPUT = process.env.ARCADE_INPUT || path.join(os.homedir(), '.arcade', 'input');
const SEQ = [
  ['\x1b[D', 'L', '← left '],
  ['\x1bOP', 'L', 'F1 left '],
  ['\x1b[11~', 'L', 'F1 left '],
  ['\x1b[C', 'R', '→ right'],
  ['\x1bOQ', 'R', 'F2 right'],
  ['\x1b[12~', 'R', 'F2 right'],
  ['\x1b[A', 'B', '↑ boost!'],
  ['\x1bOR', 'B', 'F3 boost!'],
  ['\x1b[13~', 'B', 'F3 boost!'],
];

if (!process.stdin.isTTY) {
  console.error('arcadectl needs a terminal');
  process.exit(1);
}
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
console.log('🕹  arcade joystick — ←/→ steer · ↑ boost, or fire in R-Type · (F1/F2/F3 too) · q quits');

let buf = '';
process.stdin.on('data', (k) => {
  if (k === 'q' || k === '\x03') process.exit(0);
  buf = (buf + k).slice(-12);
  for (const [seq, cmd, label] of SEQ) {
    if (buf.endsWith(seq)) {
      buf = '';
      try {
        fs.writeFileSync(INPUT, cmd);
      } catch {}
      process.stdout.write('\r  ' + label + '  ');
    }
  }
});
