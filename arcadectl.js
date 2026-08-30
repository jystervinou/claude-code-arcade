#!/usr/bin/env node
// arcadectl.js — joystick for the statusline Ms. Pac-Man.
// Run in any spare terminal pane: `node ~/.arcade/arcadectl.js`. Keys register while
// this pane has focus; the daemon polls ~/.arcade/input every tick. Without a
// joystick running she plays herself (and resumes auto-pilot ~30s after the
// last input).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const INPUT = path.join(os.homedir(), '.arcade', 'input');
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
console.log('🕹  Ms. Pac-Man joystick — ←/→ steer · ↑ boost · (F1/F2/F3 too) · q quits');

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
