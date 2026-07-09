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

// --- Glob expansion (bound constraint; covers all five rules) -----------

// Shell rooted at a given cwd so globs match against a real vfs dir.
function shAt(n, cwd){ const fs = vfsForLevel(n); fs.cwd = cwd; return new Shell(fs); }

test('glob: * expands to multiple matching entries, sorted', () => {
  // /home/bandit4/inhere holds -file00 .. -file09
  const seq = shAt(4, '/home/bandit4/inhere').parse('cat -file0*');
  assert.deepStrictEqual(seq[0].pipeline[0].argv,
    ['cat','-file00','-file01','-file02','-file03','-file04',
     '-file05','-file06','-file07','-file08','-file09']);
});

test('glob: quoted glob is NOT expanded (stays literal)', () => {
  const seq = shAt(4, '/home/bandit4/inhere').parse('cat "-file0*"');
  assert.deepStrictEqual(seq[0].pipeline[0].argv, ['cat','-file0*']);
});

test('glob: * does not match a leading dot', () => {
  // Custom fs whose cwd holds one dotfile + one normal file.
  const fs = {
    cwd: '/',
    tree: { type: 'dir', entries: {
      '.hidden': { type: 'file', content: '' },
      'visible': { type: 'file', content: '' },
    }},
  };
  const seq = new Shell(fs).parse('ls *');
  assert.deepStrictEqual(seq[0].pipeline[0].argv, ['ls','visible']);
});

test('glob: ? matches exactly one character', () => {
  const seq = shAt(4, '/home/bandit4/inhere').parse('cat -file0?');
  assert.deepStrictEqual(seq[0].pipeline[0].argv,
    ['cat','-file00','-file01','-file02','-file03','-file04',
     '-file05','-file06','-file07','-file08','-file09']);
});

test('glob: no-match glob stays literal', () => {
  const seq = shAt(4, '/home/bandit4/inhere').parse('cat nomatch*xyz');
  assert.deepStrictEqual(seq[0].pipeline[0].argv, ['cat','nomatch*xyz']);
});

// --- Task 5: command execution -------------------------------------------

test('ls lists home entries', () => {
  const out = sh(0).run('ls').stdout;
  assert.match(out, /readme/);
});
test('cat reads a file', () => {
  assert.match(sh(0).run('cat readme').stdout, /[A-Za-z0-9]{32}/);
});
test('cat ./- reads the dash file (L1)', () => {
  assert.match(sh(1).run('cat ./-').stdout, /[A-Za-z0-9]{32}/);
});
test('cat of missing file errors like coreutils', () => {
  const r = sh(0).run('cat nope');
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /No such file or directory/);
});
test('unknown command reports not found', () => {
  const r = sh(0).run('frobnicate');
  assert.match(r.stderr, /command not found/);
});
test('file reports ASCII vs data (L4)', () => {
  const out = sh(4).run('file ./inhere/-file07').stdout;
  assert.match(out, /ASCII text/);
});
test('find by size+owner+group with 2>/dev/null (L6)', () => {
  const out = sh(6).run('find / -user bandit7 -group bandit6 -size 33c 2>/dev/null').stdout.trim();
  assert.ok(out.length > 0 && !out.includes('Permission denied'));
});
test('grep keyword (L7)', () => {
  assert.match(sh(7).run('grep millionth data.txt').stdout, /millionth/);
});
test('sort | uniq -u finds the unique line (L8)', () => {
  const out = sh(8).run('sort data.txt | uniq -u').stdout.trim();
  assert.match(out, /^\S{32}$/);
});
test('strings | grep ==== (L9)', () => {
  assert.match(sh(9).run("strings data.txt | grep ====").stdout, /====/);
});
test('base64 -d (L10)', () => {
  assert.match(sh(10).run('base64 -d data.txt').stdout, /password is \S{32}/);
});
test('tr ROT13 (L11)', () => {
  assert.match(sh(11).run("cat data.txt | tr 'A-Za-z' 'N-ZA-Mn-za-m'").stdout, /password is \S{32}/);
});
test('redirect writes a file then cat reads it', () => {
  const s = sh(0);
  s.run('echo hello > /tmp/x');
  assert.match(s.run('cat /tmp/x').stdout, /hello/);
});
test('stderr from a non-final pipeline stage is surfaced', () => {
  // `cat nope | wc -l`: cat fails, wc succeeds on empty stdin. Real bash
  // shows cat's error on fd 2 while wc still prints "0" and the pipeline
  // exit code is wc's (0, no pipefail).
  const r = sh(0).run('cat nope | wc -l');
  assert.strictEqual(r.stdout, '0\n');
  assert.strictEqual(r.code, 0);
  assert.match(r.stderr, /No such file or directory/);
});
test('2>/dev/null on the failing stage suppresses its stderr', () => {
  const r = sh(0).run('cat nope 2>/dev/null | wc -l');
  assert.strictEqual(r.stdout, '0\n');
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stderr, '');
});

// --- Task 6: level-12 decompression chain --------------------------------

test('L12: full decompression chain yields the password', () => {
  const s = sh(12);
  s.run('mkdir /tmp/work');
  s.run('cp data.txt /tmp/work/data.txt');
  s.run('cd /tmp/work');
  s.run('xxd -r data.txt > data');
  // loop: file -> rename to matching extension -> decompress, until ASCII.
  // (Adjusted from the brief's rigged `mv data* data` tar step, which is
  // ambiguous once the source archive itself matches the `data*` glob --
  // our tar xf, like gunzip/bunzip2, unwraps in place from the renamed
  // `.tar` file back onto `data`.)
  for (let i = 0; i < 12; i++) {
    const t = s.run('file data').stdout;
    if (/ASCII text/.test(t)) break;
    if (/gzip/.test(t)) { s.run('mv data data.gz && gunzip data.gz'); }
    else if (/bzip2/.test(t)) { s.run('mv data data.bz2 && bunzip2 data.bz2'); }
    else if (/tar/.test(t)) { s.run('mv data data.tar && tar xf data.tar'); }
  }
  assert.match(s.run('cat data').stdout, /password is \S{32}/);
});

test('L12: file reports each compression stage by name', () => {
  const s = sh(12);
  s.run('mkdir /tmp/w3');
  s.run('cp data.txt /tmp/w3/data.txt');
  s.run('cd /tmp/w3');
  assert.match(s.run('file data.txt').stdout, /ASCII text/);
  s.run('xxd -r data.txt > data');
  assert.match(s.run('file data').stdout, /gzip compressed data/);
});

test('L12: bunzip2 on a gzip-layered file errors like coreutils (wrong type)', () => {
  const s = sh(12);
  s.run('mkdir /tmp/w2');
  s.run('cp data.txt /tmp/w2/data.txt');
  s.run('cd /tmp/w2');
  s.run('xxd -r data.txt > data'); // top layer is gzip, not bzip2
  const r = s.run('bunzip2 data');
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /not in bzip2 format/);
});

test('L12: tar tf lists the member without extracting', () => {
  const s = sh(12);
  s.run('mkdir /tmp/w4');
  s.run('cp data.txt /tmp/w4/data.txt');
  s.run('cd /tmp/w4');
  s.run('xxd -r data.txt > data');
  s.run('mv data data.gz && gunzip data.gz');   // -> bzip2
  s.run('mv data data.bz2 && bunzip2 data.bz2'); // -> tar
  const before = s.run('file data').stdout;
  assert.match(before, /tar archive/);
  const listing = s.run('tar tf data');
  assert.strictEqual(listing.code, 0);
  assert.ok(listing.stdout.trim().length > 0);
  // listing must NOT have popped the layer -- file data is still a tar archive
  assert.match(s.run('file data').stdout, /tar archive/);
});

// ---- cosmetic-sweep additions (pre-merge) ----

test('tar xf on a non-tar file errors (not in tar format, code 1)', () => {
  const r = sh(0).run('tar xf readme');
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /not in tar format/);
});

test('ls -la: `..` stats as the parent dir, `.` as the current dir', () => {
  // Build a fs where parent (/) and cwd (/sub) have DIFFERENT owners, so the
  // fix is observable: `.` -> alice (the cwd), `..` -> root (the parent).
  const V = require('../js/vfs.js');
  const tree = V.dir({
    sub: V.dir({ x: V.file('hi', { owner: 'alice', group: 'alice' }) },
      { owner: 'alice', group: 'alice' }),
  }, { owner: 'root', group: 'root' });
  const s = new Shell({ cwd: '/sub', home: '/sub', user: 'alice', tree });
  const out = s.run('ls -la').stdout.split('\n');
  const dotLine = out.find((l) => / \.$/.test(l));
  const dotdotLine = out.find((l) => / \.\.$/.test(l));
  assert.match(dotLine, /alice/, '`.` should stat the cwd (alice-owned)');
  assert.match(dotdotLine, /\broot\b/, '`..` should stat the parent (root-owned)');
});
