const test = require('node:test');
const assert = require('node:assert');
const { vfsForLevel } = require('../js/vfs.js');

test('vfs module loads and returns an object', () => {
  const fs = vfsForLevel(0);
  assert.strictEqual(typeof fs, 'object');
});

const { nodeAt, resolvePath } = require('../js/vfs.js');

test('L0: readme exists in home with content', () => {
  const fs = vfsForLevel(0);
  const n = nodeAt(fs, '/home/bandit0/readme');
  assert.strictEqual(n.type, 'file');
  assert.match(n.content, /[A-Za-z0-9]{32}/);
});

test('L1: dash-named file exists', () => {
  const fs = vfsForLevel(1);
  assert.ok(nodeAt(fs, '/home/bandit1/-'));
});

test('L2: spaces-in-filename file exists', () => {
  const fs = vfsForLevel(2);
  assert.ok(nodeAt(fs, '/home/bandit2/spaces in this filename'));
});

test('L3: hidden dotfile in inhere', () => {
  const fs = vfsForLevel(3);
  assert.ok(nodeAt(fs, '/home/bandit3/inhere/...Hiding-From-You'));
});

test('L4: exactly one ASCII file among -file00..09', () => {
  const fs = vfsForLevel(4);
  const inhere = nodeAt(fs, '/home/bandit4/inhere');
  const ascii = Object.entries(inhere.entries)
    .filter(([,n]) => /^[\x09\x0a\x20-\x7e]*$/.test(n.content));
  assert.strictEqual(ascii.length, 1);
});

test('L5: one file is 1033 bytes, readable, non-exec', () => {
  const fs = vfsForLevel(5);
  const inhere = nodeAt(fs, '/home/bandit5/inhere');
  const hits = [];
  (function walk(d){ for (const [,n] of Object.entries(d.entries)){
    if (n.type==='dir') walk(n);
    else if (n.size===1033 && !(n.mode & 0o111)) hits.push(n);
  }})(inhere);
  assert.strictEqual(hits.length, 1);
});

test('L6: target file owned by bandit7, group bandit6, 33 bytes, somewhere on /', () => {
  const fs = vfsForLevel(6);
  let found = null;
  (function walk(d){ for (const [,n] of Object.entries(d.entries)){
    if (n.type==='dir') walk(n);
    else if (n.owner==='bandit7' && n.group==='bandit6' && n.size===33) found=n;
  }})(fs.tree);
  assert.ok(found);
});

test('L7: data.txt has a line containing "millionth"', () => {
  const fs = vfsForLevel(7);
  const n = nodeAt(fs, '/home/bandit7/data.txt');
  assert.match(n.content, /millionth\s+\S{32}/);
});

test('L8: data.txt has exactly one non-repeated line', () => {
  const fs = vfsForLevel(8);
  const lines = nodeAt(fs, '/home/bandit8/data.txt').content.split('\n').filter(Boolean);
  const counts = {}; lines.forEach(l => counts[l]=(counts[l]||0)+1);
  assert.strictEqual(Object.values(counts).filter(c=>c===1).length, 1);
});

test('L12: data.txt is a hex encoding with nested layers', () => {
  const fs = vfsForLevel(12);
  const n = nodeAt(fs, '/home/bandit12/data.txt');
  assert.strictEqual(n.encoding, 'hex');
  assert.ok(Array.isArray(n.layers) && n.layers.length >= 3);
});

const { Shell } = require('../js/shell.js');

function sh(n){ return new Shell(vfsForLevel(n)); }

test('tokenize splits on whitespace', () => {
  assert.deepStrictEqual(sh(0).tokenize('ls -l foo'), ['ls','-l','foo']);
});
test('tokenize keeps double-quoted spaces', () => {
  assert.deepStrictEqual(sh(2).tokenize('cat "spaces in this filename"'),
    ['cat','spaces in this filename']);
});
test('tokenize handles backslash-escaped space', () => {
  assert.deepStrictEqual(sh(2).tokenize('cat spaces\\ in\\ this\\ filename'),
    ['cat','spaces in this filename']);
});
test('tokenize treats ./- as a single literal token', () => {
  assert.deepStrictEqual(sh(1).tokenize('cat ./-'), ['cat','./-']);
});
test('parse splits a pipeline on |', () => {
  const seq = sh(8).parse('sort data.txt | uniq -u');
  assert.strictEqual(seq[0].pipeline.length, 2);
  assert.deepStrictEqual(seq[0].pipeline[0].argv, ['sort','data.txt']);
  assert.deepStrictEqual(seq[0].pipeline[1].argv, ['uniq','-u']);
});
test('parse captures redirect target', () => {
  const seq = sh(12).parse('xxd -r data.txt > data');
  assert.strictEqual(seq[0].pipeline[0].redirect.op, '>');
  assert.strictEqual(seq[0].pipeline[0].redirect.path, 'data');
});
test('parse strips 2>/dev/null into a flag', () => {
  const seq = sh(6).parse('find / -user bandit7 2>/dev/null');
  assert.strictEqual(seq[0].pipeline[0].stderrToNull, true);
  assert.ok(!seq[0].pipeline[0].argv.includes('2>/dev/null'));
});
test('parse splits && into separate sequences', () => {
  const seq = sh(12).parse('mkdir /tmp/w && cd /tmp/w');
  assert.strictEqual(seq.length, 2);
});
