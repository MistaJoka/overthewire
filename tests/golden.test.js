const test = require('node:test');
const assert = require('node:assert');
const { LEVELS } = require('../js/data.js');
const { Shell } = require('../js/shell.js');
const { vfsForLevel, FAKE_PW } = require('../js/vfs.js');

// Acceptance capstone: run every documented level 0-12 solution, verbatim,
// through the real shell interpreter and confirm it surfaces the next
// level's password. Prefers `lvl.solveExec` (a concrete, fully-runnable
// command list) when present; otherwise falls back to flattening the
// displayed `solve[].c` strings (which is what most levels run as-is).
for (const lvl of LEVELS.filter((l) => l.from <= 12)) {
  test(`golden: level ${lvl.from} -> ${lvl.to} reveals the password`, () => {
    const shell = new Shell(vfsForLevel(lvl.from));

    let lines;
    if (lvl.solveExec) {
      lines = lvl.solveExec.flatMap((c) => c.split('\n'));
    } else {
      const script = lvl.solve.map((s) => s.c).filter(Boolean).join('\n');
      lines = script.split('\n').filter((line) => !/<path>|<f>/.test(line));
    }

    let out = '';
    for (const line of lines) {
      out += shell.run(line).stdout;
    }

    assert.ok(
      out.includes(FAKE_PW[lvl.to]),
      `expected ${FAKE_PW[lvl.to]} in output for level ${lvl.from}->${lvl.to}, got:\n${out}`
    );
  });
}
