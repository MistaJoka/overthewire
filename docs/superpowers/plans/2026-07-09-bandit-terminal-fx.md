# Bandit Terminal Emulator + FX Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-browser terminal that genuinely solves Bandit levels 0–12 on a virtual filesystem, plus a purposeful reactive FX layer (CRT mode, generative background, flag-capture celebration).

**Architecture:** Split the current single 65KB HTML file into plain `<script src>` files (no build step, no ES modules — works from `file://` and GitHub Pages). A hand-rolled shell interpreter runs real commands against per-level virtual filesystem snapshots. The shell and vfs modules are dual-target (browser globals + Node exports) so a Node test harness can assert every documented solution yields the next password.

**Tech Stack:** Vanilla JS (ES2018, no modules), inline CSS, HTML5 canvas. Node 18+ for the test harness only (built-in `node:test` + `node:assert`, zero npm deps).

## Global Constraints

- No build step, no bundler, no npm runtime dependencies. Scripts load via `<script src>` in document order.
- No ES modules (`import`/`export` in the browser break on `file://`). Dual-target files use the `if (typeof module !== 'undefined' && module.exports)` guard only.
- Must work identically from `file://`, GitHub Pages, and claude.ai.
- All persistence goes through the existing `store` wrapper (soft-fails on localStorage errors). Keys: `bandit_progress_v3`, `bandit_notes_v1`, `bandit_theme_v1`, `bandit_drill_v1` (existing); `bandit_fx_v1`, `bandit_termhist_v1` (new).
- Emulator covers levels 0–12 only. Passwords in the emulator are realistic 32-char fakes, never real OTW passwords.
- All animation respects `prefers-reduced-motion` and the single fx kill-switch.
- Every documented level 0–12 solution must run verbatim through the shell and produce the next level's password. This is the acceptance bar.
- Existing features (guide, drill, notes, search, themes, print) must remain functional after the file split.

## File layout (target)

```
bandit-walkthrough.html   markup + inline CSS + ordered <script src> tags
js/data.js                LEVELS + TOOLS + ENTRY/entryFor + sshPw + HOST/PORT (moved verbatim)
js/vfs.js                 FAKE_PW, vfsForLevel(n), path helpers (dual-target)
js/shell.js               Shell class: tokenize, parse pipes/redir, run commands (dual-target)
js/term.js                Terminal class: DOM UI, input, history, typed output, ssh flow
js/fx.js                  FX: CRT toggle, generative canvas, capture celebration
js/app.js                 existing render/persistence/drill logic + terminal-tab wiring
tests/shell.test.js       Node: tokenizer + per-command unit tests
tests/golden.test.js      Node: every level 0–12 solution → next password
tests/run.sh              convenience: node --test tests/
```

---

### Task 1: Extract JS into `js/data.js` and `js/app.js` (behavior-preserving split)

Pure refactor. Move the inline `<script>` out of the HTML into two files and wire them with `<script src>`. No behavior changes. This de-risks every later task by giving us small files to edit.

**Files:**
- Modify: `bandit-walkthrough.html` (remove inline JS body, add script tags before `</body>`)
- Create: `js/data.js` (lines currently defining `HOST`, `PORT`, `sshPw`, `ENTRY`, `entryFor`, `LEVELS`, `TOOLS`, `compose`)
- Create: `js/app.js` (everything from the `RENDER LAYER` comment onward: state vars, render/wire/persistence/drill/nav functions, and the bottom event-listener block + `loadState()` call)

**Interfaces:**
- Consumes: nothing (first task).
- Produces (browser globals used by later tasks): `LEVELS` (array of level objects, each with `from`,`to`,`t`,`tags`,`goal`,`hint`,`solve[{n,c}]`,`source`,`concept`, optional `gotcha`,`yields`), `TOOLS`, `entryFor(n)`, `store` (`{get(k),set(k,v)}`), `done` (Set of solved `to` numbers), `saveProgress()`, `renderSide()`, `renderDetail()`, `firstUnsolved()`, `selLevel`, `view`.

- [ ] **Step 1: Verify current behavior in the browser (baseline)**

Run: `mcp__Claude_Preview__preview_start` with name from `.claude/launch.json`, then load `bandit-walkthrough.html`.
Expected: sidebar lists levels, clicking a level shows the guide, drill tab works. Note this as the baseline to match after the split.

- [ ] **Step 2: Create `js/data.js`**

Cut the block from `const HOST=...` (line ~218) through the end of `function compose(l){...}` (the close of the `LAYER 3 — COMPOSE` section, line ~595) out of the HTML and paste verbatim into `js/data.js`. No edits to the code itself.

- [ ] **Step 3: Create `js/app.js`**

Cut the block from the `RENDER LAYER` comment (line ~598) through the final line of the inline script (the closing of the event-listener block and `loadState()` invocation) into `js/app.js`. Verbatim.

- [ ] **Step 4: Replace the inline `<script>` with ordered src tags**

In `bandit-walkthrough.html`, replace the now-empty `<script>...</script>` block (just before `</body>`) with:

```html
<script src="js/data.js"></script>
<script src="js/app.js"></script>
```

- [ ] **Step 5: Reload and confirm parity**

Run: reload the preview (`window.location.reload()`), then `preview_console_logs` (level error) and `preview_snapshot`.
Expected: zero console errors; sidebar + level detail + drill behave exactly as the Step 1 baseline.

- [ ] **Step 6: Commit**

```bash
git add bandit-walkthrough.html js/data.js js/app.js
git commit -m "refactor: split walkthrough JS into js/data.js + js/app.js"
```

---

### Task 2: Node test harness scaffold

Stand up the zero-dependency Node runner so subsequent shell tasks are TDD from step one. This task's deliverable is a passing trivial test proving the harness loads a dual-target file.

**Files:**
- Create: `tests/shell.test.js`
- Create: `tests/run.sh`
- Create: `js/vfs.js` (stub with dual-target export, filled in Task 3)

**Interfaces:**
- Consumes: nothing.
- Produces: the dual-target pattern every later JS module follows, and `tests/run.sh` as the canonical test command.

- [ ] **Step 1: Create `js/vfs.js` stub with dual-target guard**

```javascript
/* Virtual filesystem for Bandit levels 0-12. Dual-target: browser global + Node export. */
const FAKE_PW = {}; // filled in Task 3

function vfsForLevel(n) { return { n }; } // stub, replaced in Task 3

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FAKE_PW, vfsForLevel };
}
```

- [ ] **Step 2: Write the harness smoke test**

`tests/shell.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { vfsForLevel } = require('../js/vfs.js');

test('vfs module loads and returns an object', () => {
  const fs = vfsForLevel(0);
  assert.strictEqual(typeof fs, 'object');
});
```

- [ ] **Step 3: Create `tests/run.sh`**

```bash
#!/usr/bin/env bash
# Run the full Node test suite (no npm deps).
set -e
node --test "$(dirname "$0")"
```

Then: `chmod +x tests/run.sh`

- [ ] **Step 4: Run the harness**

Run: `node --test tests/`
Expected: PASS — 1 test passing.

- [ ] **Step 5: Commit**

```bash
git add js/vfs.js tests/shell.test.js tests/run.sh
git commit -m "test: add zero-dep Node test harness + vfs stub"
```

---

### Task 3: Virtual filesystem snapshots (`js/vfs.js`)

Build the real per-level filesystems with all the traps. No shell yet — this task is verified by direct assertions on the returned tree.

**Files:**
- Modify: `js/vfs.js`
- Modify: `tests/shell.test.js` (add vfs structure tests)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `FAKE_PW`: object mapping level number (0–13) → 32-char fake password string. `FAKE_PW[13]` is the password bandit12's solution reveals (level 12→13 target); levels use `FAKE_PW[to]`.
  - `vfsForLevel(n)`: returns a fresh deep-copied filesystem object:
    ```
    { cwd: '/home/bandit'+n, home: '/home/bandit'+n, user: 'bandit'+n,
      tree: <dir node> }
    ```
  - Node shape: a **dir node** is `{ type:'dir', entries:{ name: node } }`. A **file node** is `{ type:'file', content:<string>, mode:0o644, owner:'banditN', group:'banditN', size:<bytes>, encoding?:<'hex'|'gzip'|'bzip2'|'tar'>, layers?:[...] }`. `size` defaults to `content.length` when omitted.
  - Helper exports for the shell: `resolvePath(fs, p)` → absolute path string; `nodeAt(fs, absPath)` → node or `null`; `parentAndName(fs, absPath)` → `{parent, name}`.

- [ ] **Step 1: Write failing tests for the trap files**

Append to `tests/shell.test.js`:

```javascript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/`
Expected: FAIL — `nodeAt is not a function` / assertions failing.

- [ ] **Step 3: Implement path helpers and node builders in `js/vfs.js`**

Replace the stub. Implement:
- `FAKE_PW`: hardcode a distinct 32-char alphanumeric string for keys `0`–`13`. Level N's solution reveals `FAKE_PW[N+1]` (e.g. level 0's `readme` content is `FAKE_PW[1]`).
- `dir(entries)`, `file(content, opts)` builder helpers (compute `size` from content unless `opts.size` given; default `mode:0o644`, `owner/group` from a passed level user).
- `resolvePath(fs, p)`: join against `fs.cwd`, collapse `.`/`..`, return absolute string.
- `nodeAt(fs, abs)`: walk `fs.tree.entries` by path segments; return node or `null`. `/` returns `fs.tree`.
- `parentAndName(fs, abs)`: return `{parent:<dir node>, name:<last segment>}`.
- `vfsForLevel(n)`: `switch (n)` building each level's tree. Use `JSON.parse(JSON.stringify(...))`-style fresh construction each call (build inside the function so every call is independent). For levels 0–12 encode the real traps:
  - **0:** `readme` = `FAKE_PW[1]`.
  - **1:** file named `-` = `FAKE_PW[2]`.
  - **2:** `spaces in this filename` = `FAKE_PW[3]`.
  - **3:** `inhere/...Hiding-From-You` = `FAKE_PW[4]` (dotfile).
  - **4:** `inhere/-file00`..`-file09`; nine have non-printable bytes (`content` with chars like `\x00\x01`), one (`-file07`) is `FAKE_PW[5]` ASCII.
  - **5:** `inhere/maybehere00..19/` dirs each with decoy files; exactly one file is `size:1033`, `mode:0o644` (non-exec), printable ASCII = `FAKE_PW[6]`. Others differ in size or have `mode:0o755`.
  - **6:** place the target somewhere under `/` (e.g. `/var/lib/dfltd/x.txt`) with `owner:'bandit7', group:'bandit6', size:33, content:FAKE_PW[7]`. Add a few sibling decoys owned by other users with `mode` that would yield "Permission denied" when the shell reads them as bandit6.
  - **7:** `data.txt` = many `word<TAB>garbage` lines plus one `millionth<TAB>FAKE_PW[8]`.
  - **8:** `data.txt` = ~1000 duplicated lines + exactly one unique line = `FAKE_PW[9]`.
  - **9:** `data.txt` = binary-ish content (non-printable runs) with an embedded `======== FAKE_PW[10]` printable run (≥4 chars around it).
  - **10:** `data.txt` = base64 of `The password is FAKE_PW[11]\n` (compute at build time with `Buffer`/`btoa` shim — see note).
  - **11:** `data.txt` = ROT13 of `The password is FAKE_PW[12]\n`.
  - **12:** `data.txt` = `{ encoding:'hex', layers:[...] }` — see Task 6 for how the shell peels it; here just store `content` as the hexdump-formatted string and `layers` describing the chain ending in `FAKE_PW[13]`.

  **Base64/ROT13 at build time:** provide tiny pure-JS `b64encode(str)` and `rot13(str)` helpers in vfs.js (do not rely on `Buffer` or `btoa` being present — implement base64 with a standard alphabet lookup) so the same code runs in browser and Node.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/`
Expected: PASS — all vfs structure tests green.

- [ ] **Step 5: Commit**

```bash
git add js/vfs.js tests/shell.test.js
git commit -m "feat: virtual filesystem snapshots for bandit levels 0-12"
```

---

### Task 4: Shell tokenizer + pipeline parser (`js/shell.js`)

Parse a command line into a pipeline of commands with args, honoring quotes, escapes, globs, `|`, `>`/`>>`/`2>/dev/null`, and `&&`. No command execution yet — parser output is asserted directly.

**Files:**
- Create: `js/shell.js`
- Modify: `tests/shell.test.js` (add parser tests)

**Interfaces:**
- Consumes: `vfsForLevel`, `nodeAt`, `resolvePath` from vfs.js (for glob expansion).
- Produces:
  - `class Shell { constructor(fs) }` where `fs` is a `vfsForLevel(n)` result.
  - `Shell.prototype.parse(line)` → array of "sequences" split on `&&`; each sequence is `{ pipeline:[cmd,...] }`; each `cmd` is `{ argv:[string,...], redirect:{op:'>'|'>>'|null, path:string|null}, stderrToNull:boolean }`.
  - `Shell.prototype.tokenize(line)` → array of raw tokens (exported for direct testing).
  - `Shell.prototype.expandGlobs(tokens)` → tokens with `*`/`?` expanded against cwd (used inside parse).

- [ ] **Step 1: Write failing parser tests**

Append to `tests/shell.test.js`:

```javascript
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/`
Expected: FAIL — `Shell is not a constructor`.

- [ ] **Step 3: Implement tokenizer + parser**

In `js/shell.js` (dual-target guard at bottom). Require vfs helpers via `typeof require !== 'undefined'` for Node and rely on globals in browser:

```javascript
const V = (typeof require !== 'undefined') ? require('./vfs.js') : window;
```

Implement:
- `tokenize(line)`: character scan with states for unquoted / single-quote / double-quote; `\` escapes next char outside single quotes; emit a token on unquoted whitespace. Do NOT split on `|`,`>`,`&` here — those are separate: instead recognize them as their own tokens when unquoted (emit `|`, `>`, `>>`, `&&`, and the literal `2>/dev/null` as standalone tokens; scan for the multi-char operators first).
- `expandGlobs(tokens)`: for any unquoted token containing `*` or `?`, list the cwd dir's entries and match via a regex built from the glob (`*`→`.*`, `?`→`.`, escape the rest; `*` does not match leading `.` — matching real bash). If no match, leave the token literal. (Track "was quoted" so quoted globs are not expanded — a `quoted` parallel array from `tokenize`.)
- `parse(line)`: tokenize → expandGlobs → split token stream on `&&` into sequences → within each, split on `|` into commands → within each command, pull out `>`/`>>` (next token is path), set `stderrToNull` if the `2>/dev/null` token is present, remaining tokens are `argv`.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/`
Expected: PASS — all parser tests green.

- [ ] **Step 5: Commit**

```bash
git add js/shell.js tests/shell.test.js
git commit -m "feat: shell tokenizer + pipeline/redirect parser"
```

---

### Task 5: Core command execution — filesystem & text tools

Implement the command set needed for levels 0–11 (everything except the level-12 compression chain). Execution runs a parsed pipeline, threading stdin→stdout, applying redirects, honoring permissions.

**Files:**
- Modify: `js/shell.js`
- Modify: `tests/shell.test.js`

**Interfaces:**
- Consumes: parser from Task 4, vfs helpers from Task 3.
- Produces:
  - `Shell.prototype.run(line)` → `{ stdout:string, stderr:string, code:number }` (runs all `&&` sequences, short-circuiting on non-zero code; concatenates output).
  - Internal `Shell.prototype.exec1(cmd, stdin)` → `{stdout,stderr,code}` dispatching on `cmd.argv[0]`.
  - Commands implemented: `ls cd pwd cat file find grep sort uniq strings base64 tr xxd head tail wc mkdir cp mv echo whoami hostname clear reset exit`. (`gzip/gunzip/bzip2/bunzip2/tar` land in Task 6; `ssh` in Task 8.)

- [ ] **Step 1: Write failing per-command tests**

Append to `tests/shell.test.js`:

```javascript
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/`
Expected: FAIL — `run is not a function`.

- [ ] **Step 3: Implement `run`, `exec1`, and each command**

In `js/shell.js`:
- `run(line)`: `parse` → for each sequence, run its pipeline (feed stdin='' to first cmd, each cmd's stdout → next cmd's stdin), apply the last-writer redirect by writing stdout into the vfs (create/replace file node via `parentAndName`; `>>` appends). Accumulate stdout/stderr. If a sequence's final code ≠ 0, stop (`&&` semantics). Return combined result.
- `exec1(cmd, stdin)`: look up `this.cmds[cmd.argv[0]]`; if absent → `{stdout:'',stderr:'bash: '+name+': command not found\n',code:127}`. Suppress stderr if `cmd.stderrToNull`.
- Command implementations (each `(args, stdin) => ({stdout,stderr,code})`):
  - `ls`: `-a` includes dotfiles, `-l` long format (mode string, owner, group, size, name), `-h` human sizes. Default: names of a dir (cwd or arg), sorted, dotfiles hidden.
  - `cd`: change `fs.cwd`; error `bash: cd: <p>: No such file or directory` if not a dir.
  - `pwd`: print `fs.cwd`.
  - `cat`: for each path arg, resolve; missing → `cat: <p>: No such file or directory` (code 1); a dir → `cat: <p>: Is a directory`; unreadable by current user → `cat: <p>: Permission denied`; else append content. No args → echo stdin.
  - `file`: classify a node's content — printable-only → `<p>: ASCII text`; matches gzip/bzip2/tar magic or `encoding` field → the matching `... compressed data` / `POSIX tar archive` string; else `<p>: data`.
  - `find`: recursive walk from the path arg (default `.`), supporting `-type f`, `-name <glob>`, `-size <n>c`, `-user`, `-group`, `-readable`, `! -executable`. Unreadable dirs emit `find: '<p>': Permission denied` to stderr (hidden by `2>/dev/null`). Print matching absolute paths.
  - `grep`: `-i` case-insensitive; pattern is first non-flag arg; remaining args are files (else stdin). Print matching lines; treat pattern as a fixed string first, falling back to a safe regex for character classes like `====`.
  - `sort`: split stdin/file into lines, `-n` numeric, `-r` reverse; default lexicographic.
  - `uniq`: adjacent dedupe; `-u` only-unique, `-d` only-dupes, `-c` prefix counts.
  - `strings`: extract runs of ≥4 printable chars from content, one per line.
  - `base64`: `-d` decode (use the vfs `b64decode` helper), else encode.
  - `tr SET1 SET2`: expand ranges like `A-Z`, map char-by-char over stdin.
  - `xxd`: `-r` handled in Task 6 (leave a stub that errors clearly until then, or implement forward hexdump now). Implement `-r` fully in Task 6.
  - `head`/`tail`: `-n N` (default 10) lines from start/end.
  - `wc`: `-l` lines, `-c` bytes, default both.
  - `mkdir`: create dir node (`-p` optional); error if exists.
  - `cp`/`mv`: copy/move a file node between paths.
  - `echo`: join args with spaces + newline.
  - `whoami`: `fs.user`; `hostname`: `bandit`.
  - `clear`/`reset`: return a sentinel `{stdout:'\x1b[CLEAR]',...}` the terminal interprets (Task 7); in Node just empty.
  - `exit`: sentinel `{stdout:'\x1b[EXIT]',...}`.

  **Permission model:** current user is `fs.user`. A file is readable if `owner===user` (owner read bit) or the world-read bit (`mode & 0o004`) is set. Level 6 decoys owned by other users clear the world-read bit so `cat` yields `Permission denied` and `find` on their parent dirs yields the denied message.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/`
Expected: PASS — all command tests green.

- [ ] **Step 5: Commit**

```bash
git add js/shell.js tests/shell.test.js
git commit -m "feat: shell command execution for levels 0-11"
```

---

### Task 6: Compression chain — `xxd -r`, gzip, bzip2, tar (level 12)

Model the decompression onion so `file` → rename → decompress loops work on real layered data.

**Files:**
- Modify: `js/shell.js`
- Modify: `js/vfs.js` (finalize level 12 `layers` shape if needed)
- Modify: `tests/shell.test.js`

**Interfaces:**
- Consumes: level 12 vfs node `{encoding:'hex', layers:[{type,...}]}` from Task 3.
- Produces: `xxd -r`, `gzip`/`gunzip`, `bzip2`/`bunzip2`, `tar xf`/`tar tf` commands operating on **layer-tagged file nodes**. A compressed file node carries `{layers:[...], topEncoding:'gzip'|...}`; decompressing pops the top layer and rewrites the node's `encoding`/`layers`; when no layers remain the node is plain text.

**Model:** rather than real compression, each transform pops one layer. `file` reads `node.topEncoding` (or hex) to report the type; the decompressors require the matching type and error otherwise (e.g. `gzip: data: not in gzip format`).

- [ ] **Step 1: Write the failing level-12 walk test**

Append to `tests/shell.test.js`:

```javascript
test('L12: full decompression chain yields the password', () => {
  const s = sh(12);
  s.run('mkdir /tmp/work');
  s.run('cp data.txt /tmp/work/data.txt');
  s.run('cd /tmp/work');
  s.run('xxd -r data.txt > data');
  // loop: file -> rename to ext -> decompress, until ASCII
  for (let i = 0; i < 12; i++) {
    const t = s.run('file data').stdout;
    if (/ASCII text/.test(t)) break;
    if (/gzip/.test(t))      { s.run('mv data data.gz && gunzip data.gz'); }
    else if (/bzip2/.test(t)){ s.run('mv data data.bz2 && bunzip2 data.bz2'); }
    else if (/tar/.test(t))  { s.run('tar xf data && mv data* data 2>/dev/null'); }
  }
  assert.match(s.run('cat data').stdout, /password is \S{32}/);
});
```

(Adjust the exact rename/tar commands to match the layer chain you build in vfs — the assertion that must hold is that a documented-style loop reaches the password.)

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/`
Expected: FAIL — `xxd -r` / decompressors not implemented.

- [ ] **Step 3: Implement the layer transforms**

- Build level 12 in vfs as a stack: innermost layer content = `The password is FAKE_PW[13]\n`, wrapped conceptually as gzip→bzip2→tar→gzip→... (mirror the real level's ~9 layers; the exact order just needs `file` to name each next tool). Store as `{encoding:'hex', topEncoding:'<first-after-hex>', layers:[{type:'gzip'},{type:'bzip2'},...], payload:'The password is ...'}`.
- `xxd -r <file>`: if node `encoding==='hex'`, produce a node with `encoding` removed and `topEncoding`/`layers` promoted (the "raw binary" now carries the compression stack). Writing via `> data` stores that node at `data`.
- `file data`: report based on `topEncoding` (`gzip compressed data`, `bzip2 compressed data`, `POSIX tar archive`) or `ASCII text` when `layers` is empty.
- `gunzip`/`gzip -d`: require `topEncoding==='gzip'` else `gzip: <f>: not in gzip format` (code 1); on success pop the top layer, set `topEncoding` to the next layer's type (or clear it → content becomes `payload` when the stack empties). Output filename drops `.gz` (mirror real behavior for the `mv`+decompress dance).
- `bunzip2`/`bzip2 -d`: same, for `bzip2`.
- `tar xf`: same, for `tar`; `tar tf` lists the archived member name without extracting.
- When the last layer is popped, the node becomes `{type:'file', content:payload}`.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/`
Expected: PASS — level 12 chain reaches the password.

- [ ] **Step 5: Commit**

```bash
git add js/shell.js js/vfs.js tests/shell.test.js
git commit -m "feat: level-12 decompression chain (xxd/gzip/bzip2/tar)"
```

---

### Task 7: Golden-path acceptance suite

Lock the acceptance bar: every documented solution from `LEVELS` (0–12), run verbatim, yields the next password. This test reads the actual solve commands from `js/data.js`, so it guards against future content/emulator drift.

**Files:**
- Create: `tests/golden.test.js`
- Modify: `js/data.js` (add the dual-target export guard so Node can require it)

**Interfaces:**
- Consumes: `LEVELS` from data.js, `Shell` from shell.js, `vfsForLevel` + `FAKE_PW` from vfs.js.
- Produces: nothing (terminal acceptance test).

- [ ] **Step 1: Add Node export to `js/data.js`**

At the very bottom of `js/data.js` add:

```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LEVELS, TOOLS, entryFor, HOST, PORT };
}
```

- [ ] **Step 2: Write the golden-path test**

`tests/golden.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { LEVELS } = require('../js/data.js');
const { Shell } = require('../js/shell.js');
const { vfsForLevel, FAKE_PW } = require('../js/vfs.js');

// Concatenate every solve command for a level into one script, run it,
// assert the next password appears somewhere in the output.
for (const lvl of LEVELS.filter(l => l.from <= 12)) {
  test(`golden: level ${lvl.from} -> ${lvl.to} reveals the password`, () => {
    const shell = new Shell(vfsForLevel(lvl.from));
    const script = lvl.solve.map(s => s.c).filter(Boolean).join('\n');
    let out = '';
    for (const line of script.split('\n')) {
      // strip placeholder <path> lines that need a value from a prior step
      if (/<path>|<f>/.test(line)) continue;
      out += shell.run(line).stdout;
    }
    assert.ok(out.includes(FAKE_PW[lvl.to]),
      `expected ${FAKE_PW[lvl.to]} in output, got:\n${out}`);
  });
}
```

- [ ] **Step 3: Run and reconcile**

Run: `node --test tests/`
Expected: initially some levels may FAIL where the documented `solve` uses a `<path>` placeholder (levels 5, 6, 12) that the test skips. For those, either: (a) the emulator's `find`/`file` output already contains the password via a follow-on `cat` that the script can't fill, OR (b) add a `solveExec` array to those level objects in `js/data.js` — a fully-runnable command sequence (e.g. level 6: `cat $(find / -user bandit7 -group bandit6 -size 33c 2>/dev/null)` is out of scope for the parser, so instead use the two-step form the emulator supports and hardcode the discovered path). Simplest reconciliation: give levels 5/6/12 a `solveExec` list of concrete runnable lines and have the golden test prefer `lvl.solveExec || lvl.solve.map(s=>s.c)`. Implement that fallback in the test and add `solveExec` where needed.

- [ ] **Step 4: Verify pass**

Run: `node --test tests/`
Expected: PASS — all 13 golden-path tests green.

- [ ] **Step 5: Commit**

```bash
git add js/data.js tests/golden.test.js
git commit -m "test: golden-path acceptance for levels 0-12 solutions"
```

---

### Task 8: Terminal UI + SSH advance flow (`js/term.js`)

The browser-facing terminal: DOM rendering, input handling, typed output, history, tab-complete, and the `ssh bandit{n+1}@localhost` password-gated advance.

**Files:**
- Create: `js/term.js`
- Modify: `bandit-walkthrough.html` (add `<script src="js/vfs.js">`, `js/shell.js`, `js/term.js`, `js/fx.js` before `js/app.js`; add terminal DOM container + CSS)

**Interfaces:**
- Consumes: `Shell`, `vfsForLevel`, `FAKE_PW`, `entryFor`.
- Produces:
  - `class Terminal { constructor(mountEl, level, opts) }` — `level` is a LEVELS entry; `opts.onCapture(toLevel)` fires when the user successfully `ssh`es to the next level; `opts.typed` (bool) toggles typed output.
  - `Terminal.prototype.mount()` renders prompt + scrollback into `mountEl`.
  - `Terminal.prototype.focus()`, `Terminal.prototype.destroy()`.
  - Recognizes the shell sentinels (`\x1b[CLEAR]`, `\x1b[EXIT]`) and the ssh flow.

- [ ] **Step 1: Add terminal DOM + CSS to the HTML**

In `bandit-walkthrough.html`, add a terminal container the level view can show (styling: monospace, dark inner background `#0c0a08`, block cursor, scrollback with `overflow-y:auto`). Add the four new `<script src>` tags in dependency order **before** `js/app.js`:

```html
<script src="js/data.js"></script>
<script src="js/vfs.js"></script>
<script src="js/shell.js"></script>
<script src="js/term.js"></script>
<script src="js/fx.js"></script>
<script src="js/app.js"></script>
```

- [ ] **Step 2: Implement the Terminal class**

- Render: a scrollback `<div>` and a current input line `bandit{from}@bandit:~$ ` + a hidden `<input>` capturing keystrokes; a blinking cursor span mirrors input.
- Enter: echo the prompt+line to scrollback, run through `Shell`, type the output (chunked with `setTimeout` when `opts.typed && !reducedMotion`, else instant). Handle `\x1b[CLEAR]` → wipe scrollback; `\x1b[EXIT]` → print a "logout" line.
- History: ↑/↓ walk a per-instance array seeded from `store.get('bandit_termhist_v1')` keyed by level; persist on each command.
- Tab: complete command names (first word) or path segments (later words) against the cwd dir entries; on multiple matches, print the candidates.
- Ctrl+C: abandon the current line (print `^C`, new prompt); Ctrl+L: clear.
- **SSH advance:** intercept `ssh bandit{to}@localhost` (and the `-p 2220 ...@localhost` form). Print `bandit{to}@localhost's password:`, switch the input to masked mode, read one line; if it equals `FAKE_PW[to]` → print `Welcome`/motd, call `opts.onCapture(to)`; else print `Permission denied, please try again.` and re-prompt (max 3 tries then `Too many authentication failures`).
- Opening banner: on `mount()`, if `opts.showBanner`, print a short SSH handshake + OTW motd, then the prompt (skippable on any keypress).

- [ ] **Step 3: Verify in the browser**

Run: reload preview; via `preview_eval` construct a Terminal on a scratch element (or wire it through Task 9 first). Manually assert: `ls`/`cat readme` produce output, ↑ recalls history, Tab completes `read`→`readme`. Use `preview_console_logs` to confirm no errors.
Expected: interactive terminal behaves; no console errors.

- [ ] **Step 4: Commit**

```bash
git add js/term.js bandit-walkthrough.html
git commit -m "feat: in-page terminal UI with history, tab-complete, ssh advance"
```

---

### Task 9: Wire the "terminal" tab into level view (`js/app.js`)

Add the second tab on emulated levels, instantiate the Terminal, and connect capture → progress.

**Files:**
- Modify: `js/app.js`
- Modify: `bandit-walkthrough.html` (CSS for the guide/terminal tab switch, if not covered)

**Interfaces:**
- Consumes: `Terminal` (Task 8), existing `done`/`saveProgress`/`renderSide`/`selLevel`.
- Produces: capture path calling `markSolved(to)` which adds to `done`, saves, triggers the sidebar cascade (Task 10), and advances the terminal to the next level.

- [ ] **Step 1: Add guide/terminal sub-tabs in `levelDetailHTML`**

For levels where `l.from <= 12`, render two sub-tab buttons (`guide` | `terminal`) above the level body; default `guide`. `terminal` shows a mount div. For levels 13+, no terminal tab (guide only, unchanged).

- [ ] **Step 2: Instantiate Terminal on tab switch (in `wireLevel`)**

When the terminal sub-tab is activated, `new Terminal(mountEl, l, {typed:true, showBanner:true, onCapture})`. Keep a single active instance; `destroy()` it on level change or tab switch back. `onCapture = (to) => markSolved(to)`.

- [ ] **Step 3: Implement `markSolved(to)`**

```javascript
function markSolved(to){
  if(!done.has(to)){ done.add(to); saveProgress(); }
  renderSide();
  if (window.FX) FX.captureCascade(to);   // no-op if fx off (Task 10)
  const next = LEVELS.find(l => l.from === to);
  if (next){ selLevel = next.to; /* transition terminal to next level session */ }
}
```

Wire the checkbox and terminal capture to the same `markSolved` so both stay in sync.

- [ ] **Step 4: Verify end-to-end in the browser**

Run: reload; open level 0 → terminal tab; run `ls`, `cat readme`, then `ssh bandit1@localhost`, paste the printed password. Confirm: capture animation, level 0 marks cleared in sidebar, terminal advances to level 1. Repeat spot-check on level 8 (`sort data.txt | uniq -u`). Check `preview_console_logs`.
Expected: full solve→advance loop works; sidebar updates; no errors.

- [ ] **Step 5: Commit**

```bash
git add js/app.js bandit-walkthrough.html
git commit -m "feat: terminal tab on levels 0-12 wired to progress"
```

---

### Task 10: FX layer — CRT mode, generative background, capture cascade (`js/fx.js`)

The reactive/generative visual layer. Everything degrades silently and respects reduced-motion and the kill switch.

**Files:**
- Create: `js/fx.js`
- Modify: `bandit-walkthrough.html` (CRT overlay element + canvas element + CSS; a new `fx` toggle button in `.side-ctrls`)
- Modify: `js/app.js` (persist/restore fx state; toggle handler)

**Interfaces:**
- Consumes: `done` (level completion state), `LEVELS.length`.
- Produces global `FX`:
  - `FX.init()` — set up canvas + CRT class from persisted `bandit_fx_v1` (default: on in dark, off in light); no-op if `prefers-reduced-motion`.
  - `FX.setEnabled(bool)` — master toggle; persists; starts/stops the RAF loop and CRT class.
  - `FX.captureCascade(toLevel)` — green ripple through the sidebar rows + node pulse in the background mesh.
  - `FX.keystroke(x,y)` — brief glow at the terminal cursor (called by term.js; guarded).

- [ ] **Step 1: Add CRT overlay, canvas, and fx toggle to the HTML/CSS**

- A `<canvas id="bgfx">` fixed behind `.app` (z-index below content, `pointer-events:none`, low opacity).
- A `<div class="crt">` overlay (fixed, `pointer-events:none`) with scanline `repeating-linear-gradient`, vignette `radial-gradient`, and a subtle flicker `@keyframes`. Toggled by a `crt-on` class on `<html>`.
- A third `.ctrl` button `⚡ fx` in `.side-ctrls`.

- [ ] **Step 2: Implement `js/fx.js`**

- `init()`: read `store.get('bandit_fx_v1')`; if `prefers-reduced-motion` matches, force off and disable the toggle. Else apply state.
- Generative canvas: one node per level positioned on a loose grid/orbit; nodes drift with tiny velocity; edges drawn between near neighbors; completed levels (`done.has`) render green and slightly larger. RAF loop throttled to ~30fps (skip frames via timestamp delta); `document.addEventListener('visibilitychange', ...)` pauses when hidden.
- `captureCascade(to)`: add a transient `.cascade` class to sidebar `.lrow` elements in sequence (staggered `setTimeout`) for a green sweep; flag the corresponding background node for a pulse animation.
- `keystroke(x,y)`: push a short-lived glow particle at (x,y) rendered in the RAF loop.
- Wrap `init` body in try/catch; on any failure, set `FX` to no-op stubs so callers (`term.js`, `app.js`) never break.

- [ ] **Step 3: Wire the toggle + init in `js/app.js`**

- Call `FX.init()` at the end of `loadState()`.
- `fxBtn.onclick` → `FX.setEnabled(!current)`, toggle `.on` class.
- Ensure `themeBtn` handler asks `FX` to re-evaluate default (dark→on, light→off) only if the user hasn't explicitly set it (store a `bandit_fx_v1` value of `'auto'|'on'|'off'`).

- [ ] **Step 4: Verify in the browser (all four states)**

Run: reload. Then:
- `preview_screenshot` dark theme with CRT on — confirm scanlines/vignette visible, background mesh drifting.
- Toggle fx off → `preview_inspect` `.crt` shows overlay hidden; screenshot confirms clean UI.
- Solve a level (or `preview_eval FX.captureCascade(1)`) → screenshot/snapshot shows the green cascade.
- `preview_resize` mobile → confirm layout intact, canvas not overflowing.
- `preview_resize colorScheme:dark` + emulate reduced motion via `preview_eval` matchMedia override check → confirm animation loop is disabled.
Expected: all states behave; no console errors; body never scrolls horizontally.

- [ ] **Step 5: Commit**

```bash
git add js/fx.js bandit-walkthrough.html js/app.js
git commit -m "feat: FX layer — CRT mode, generative background, capture cascade"
```

---

### Task 11: Final integration pass, regression check, docs

Confirm nothing regressed, the whole thing works from `file://`, and update the README.

**Files:**
- Modify: `README.md`
- Possibly modify: any file needing a fix surfaced here.

- [ ] **Step 1: Run the full test suite**

Run: `bash tests/run.sh`
Expected: PASS — all unit, command, decompression, and 13 golden-path tests green.

- [ ] **Step 2: Regression-check existing features in the browser**

Reload and verify each still works: level guide reveal/hint, copy buttons, notes persist across reload, search filter, commands tab, drill mode (reveal/hit/miss/streak), theme toggle, reset button, mobile menu, print stylesheet (`preview_eval window.print` not needed — just confirm `@media print` rules still present).
Expected: every pre-existing feature works; progress persists across reload.

- [ ] **Step 3: Verify `file://` load**

Run: `open bandit-walkthrough.html` (or note the manual step) and confirm scripts load with no CORS/module errors — this is why we used `<script src>` and no ES modules. If any module-load issue appears, it must be fixed here.
Expected: works identically to the served version.

- [ ] **Step 4: Update README**

Document the new terminal (levels 0–12 are playable in-browser), the fake-password note, CRT/fx toggles, and how to run tests (`bash tests/run.sh`).

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document in-browser terminal, FX toggles, and test suite"
```

---

## Self-Review notes

- **Spec coverage:** vfs (Task 3) ✓; shell tokenizer/pipes/redir (Task 4) ✓; commands 0–11 (Task 5) ✓; decompression chain (Task 6) ✓; golden-path acceptance (Task 7) ✓; terminal UI + ssh advance (Task 8) ✓; level tab integration + capture (Task 9) ✓; CRT/generative/reactive FX + kill switch + reduced-motion (Task 10) ✓; multi-file split & dual-target (Tasks 1–2) ✓; testing harness (Task 2) ✓; file:// + regression + docs (Task 11) ✓. Fake passwords, no-build, no-modules constraints carried in Global Constraints.
- **Placeholders:** the level 5/6/12 `<path>` reconciliation is called out explicitly in Task 7 Step 3 with a concrete `solveExec` fallback rather than left vague.
- **Type consistency:** node shape `{type,content,mode,owner,group,size,encoding?,layers?,topEncoding?,payload?}`, `Shell.run→{stdout,stderr,code}`, `vfsForLevel(n)→{cwd,home,user,tree}`, `FAKE_PW[n]`, `markSolved(to)`, `FX.captureCascade(to)` used consistently across tasks.
