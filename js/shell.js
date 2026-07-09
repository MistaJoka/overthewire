/* Shell tokenizer + pipeline/redirect parser for the in-browser Bandit terminal.
 * Dual-target: browser global + Node export.
 *
 * Task 4 scope: parsing ONLY. No command execution — that is Task 5.
 */
const V = (typeof require !== 'undefined') ? require('./vfs.js') : window;

/* ---------------------------------------------------------------------
 * Multi-char operators recognized as standalone tokens when unquoted.
 * Longest-match-first order matters: scan '2>/dev/null', '>>', '&&'
 * before the single-char '>' and '|'.
 * ------------------------------------------------------------------- */
const OPERATORS = ['2>/dev/null', '>>', '&&', '>', '|'];

/* ---------------------------------------------------------------------
 * _tokenizeRaw(line): character-scan state machine.
 * Returns { tokens, quoted } where `quoted[i]` is true iff token i came
 * from a quoted (single or double) region (used later to protect it
 * from glob expansion). A token built partially from quoted material
 * (e.g. mixed quoted/unquoted concatenation) is still marked quoted so
 * expandGlobs leaves it alone -- this matches the tests' needs and errs
 * on the side of NOT expanding when any quoting was involved.
 * ------------------------------------------------------------------- */
function _tokenizeRaw(line) {
  const tokens = [];
  const quoted = [];

  let cur = '';
  let curQuoted = false;
  let hasCur = false; // true once we've started building a token (even empty, e.g. "")
  let state = 'unquoted'; // 'unquoted' | 'single' | 'double'

  function flush() {
    if (hasCur) {
      tokens.push(cur);
      quoted.push(curQuoted);
    }
    cur = '';
    curQuoted = false;
    hasCur = false;
  }

  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i];

    if (state === 'single') {
      if (c === "'") {
        state = 'unquoted';
        i++;
      } else {
        cur += c;
        hasCur = true;
        curQuoted = true;
        i++;
      }
      continue;
    }

    if (state === 'double') {
      if (c === '"') {
        state = 'unquoted';
        i++;
      } else if (c === '\\' && i + 1 < n && (line[i + 1] === '"' || line[i + 1] === '\\' || line[i + 1] === '$')) {
        cur += line[i + 1];
        hasCur = true;
        curQuoted = true;
        i += 2;
      } else {
        cur += c;
        hasCur = true;
        curQuoted = true;
        i++;
      }
      continue;
    }

    // state === 'unquoted'
    if (c === ' ' || c === '\t') {
      flush();
      i++;
      continue;
    }

    if (c === "'") {
      state = 'single';
      hasCur = true;
      i++;
      continue;
    }

    if (c === '"') {
      state = 'double';
      hasCur = true;
      i++;
      continue;
    }

    if (c === '\\' && i + 1 < n) {
      // A backslash-escaped char is literal -- mark the token "quoted" so
      // e.g. a hand-escaped '\*' isn't later treated as a glob metachar.
      cur += line[i + 1];
      hasCur = true;
      curQuoted = true;
      i += 2;
      continue;
    }

    // Try multi-char operators first (scanning longest-first: '2>/dev/null',
    // '>>', '&&' before the single-char '>'/'|'). Matches even mid-word (real
    // bash splits "ls>out" into "ls", ">", "out" with no whitespace needed);
    // flush whatever token was being built first so the operator stands alone.
    {
      let matchedOp = null;
      for (const op of OPERATORS) {
        if (line.startsWith(op, i)) { matchedOp = op; break; }
      }
      if (matchedOp) {
        flush();
        tokens.push(matchedOp);
        quoted.push(false);
        i += matchedOp.length;
        continue;
      }
    }

    cur += c;
    hasCur = true;
    i++;
  }

  flush();
  return { tokens, quoted };
}

/* ---------------------------------------------------------------------
 * Glob helpers.
 * ------------------------------------------------------------------- */
function _globToRegExp(glob) {
  let src = '^';
  for (const ch of glob) {
    if (ch === '*') src += '.*';
    else if (ch === '?') src += '.';
    else src += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  src += '$';
  return new RegExp(src);
}

function _isGlobToken(tok) {
  return tok.indexOf('*') !== -1 || tok.indexOf('?') !== -1;
}

/* ---------------------------------------------------------------------
 * tr SET1 SET2 helper: expand ranges like "A-Z" into an explicit char list.
 * ------------------------------------------------------------------- */
function _expandTrSet(spec) {
  const out = [];
  for (let i = 0; i < spec.length; i++) {
    if (spec[i + 1] === '-' && spec[i + 2] !== undefined) {
      const start = spec.charCodeAt(i);
      const end = spec.charCodeAt(i + 2);
      for (let c = start; c <= end; c++) out.push(String.fromCharCode(c));
      i += 2;
    } else {
      out.push(spec[i]);
    }
  }
  return out;
}

/* ---------------------------------------------------------------------
 * Flag/positional splitter shared by most commands: any token starting
 * with '-' (and longer than just '-') has its letters added individually
 * to a Set; everything else is a positional arg.
 * ------------------------------------------------------------------- */
function _splitFlags(args) {
  const flags = new Set();
  const rest = [];
  for (const a of args) {
    if (a.length > 1 && a[0] === '-') {
      for (const ch of a.slice(1)) flags.add(ch);
    } else {
      rest.push(a);
    }
  }
  return { flags, rest };
}

/* ---------------------------------------------------------------------
 * Shell
 * ------------------------------------------------------------------- */
class Shell {
  constructor(fs) {
    this.fs = fs;
    this.cmds = {
      ls: (a, s) => this._ls(a, s),
      cd: (a) => this._cd(a),
      pwd: () => this._pwd(),
      cat: (a, s) => this._cat(a, s),
      file: (a) => this._file(a),
      find: (a) => this._find(a),
      grep: (a, s) => this._grep(a, s),
      sort: (a, s) => this._sort(a, s),
      uniq: (a, s) => this._uniq(a, s),
      strings: (a, s) => this._strings(a, s),
      base64: (a, s) => this._base64(a, s),
      tr: (a, s) => this._tr(a, s),
      xxd: (a, s) => this._xxd(a, s),
      head: (a, s) => this._head(a, s),
      tail: (a, s) => this._tail(a, s),
      wc: (a, s) => this._wc(a, s),
      mkdir: (a) => this._mkdir(a),
      cp: (a) => this._cp(a),
      mv: (a) => this._mv(a),
      echo: (a) => this._echo(a),
      whoami: () => this._whoami(),
      hostname: () => this._hostname(),
      clear: () => ({ stdout: '\x1b[CLEAR]', stderr: '', code: 0 }),
      reset: () => ({ stdout: '\x1b[CLEAR]', stderr: '', code: 0 }),
      exit: () => ({ stdout: '\x1b[EXIT]', stderr: '', code: 0 }),
    };
  }

  /* -------------------------------------------------------------------
   * Execution entry points (Task 5).
   * ------------------------------------------------------------------- */

  // run(line): parse -> execute each && sequence -> thread pipes -> apply
  // the final command's redirect -> accumulate. Short-circuits on the
  // first sequence whose final exit code is non-zero.
  run(line) {
    const sequences = this.parse(line);
    let stdout = '';
    let stderr = '';
    let code = 0;

    for (const seq of sequences) {
      const pipeline = seq.pipeline;
      let stdin = '';
      let result = { stdout: '', stderr: '', code: 0 };

      for (const cmd of pipeline) {
        result = this.exec1(cmd, stdin);
        stdin = result.stdout;
      }

      const lastCmd = pipeline[pipeline.length - 1];
      if (lastCmd && lastCmd.redirect && lastCmd.redirect.op && lastCmd.redirect.path) {
        this._writeRedirect(lastCmd.redirect, result.stdout);
        stderr += result.stderr;
      } else {
        stdout += result.stdout;
        stderr += result.stderr;
      }

      code = result.code;
      if (code !== 0) break;
    }

    return { stdout, stderr, code };
  }

  // exec1(cmd, stdin): dispatch a single parsed command through the
  // command table. Unknown commands mirror bash's 127/"command not found".
  exec1(cmd, stdin) {
    const name = cmd.argv[0];
    const fn = name !== undefined ? this.cmds[name] : undefined;
    if (!fn) {
      return { stdout: '', stderr: 'bash: ' + name + ': command not found\n', code: 127 };
    }
    const args = cmd.argv.slice(1);
    let result = fn(args, stdin);
    if (cmd.stderrToNull) result = { stdout: result.stdout, stderr: '', code: result.code };
    return result;
  }

  _writeRedirect(redirect, content) {
    const abs = V.resolvePath(this.fs, redirect.path);
    const { parent, name } = V.parentAndName(this.fs, abs);
    if (!parent || parent.type !== 'dir') return;
    const existing = parent.entries[name];
    if (redirect.op === '>>' && existing && existing.type === 'file') {
      existing.content += content;
      existing.size = existing.content.length;
    } else {
      parent.entries[name] = V.file(content, { owner: this.fs.user, group: this.fs.user });
    }
  }

  /* -------------------------------------------------------------------
   * Permission model helpers (shared by cat/find).
   * ------------------------------------------------------------------- */
  _isReadable(node) {
    const user = this.fs.user;
    return node.owner === user || !!(node.mode & 0o004);
  }

  _isExecutable(node) {
    const user = this.fs.user;
    return node.owner === user ? !!(node.mode & 0o100) : !!(node.mode & 0o001);
  }

  /* -------------------------------------------------------------------
   * Commands.
   * ------------------------------------------------------------------- */

  _ls(args) {
    const { flags, rest } = _splitFlags(args);
    const path = rest.length ? rest[0] : '.';
    const node = V.nodeAt(this.fs, path);
    if (!node) {
      return { stdout: '', stderr: "ls: cannot access '" + path + "': No such file or directory\n", code: 2 };
    }
    if (node.type === 'file') {
      return { stdout: path + '\n', stderr: '', code: 0 };
    }
    let names = Object.keys(node.entries);
    if (!flags.has('a')) names = names.filter((n) => n[0] !== '.');
    else names = names.concat(['.', '..']);
    names.sort();
    if (flags.has('l')) {
      const lines = names.map((name) => this._lsLongLine(node.entries[name] || node, name, flags.has('h')));
      return { stdout: lines.join('\n') + (lines.length ? '\n' : ''), stderr: '', code: 0 };
    }
    return { stdout: names.join('\n') + (names.length ? '\n' : ''), stderr: '', code: 0 };
  }

  _lsLongLine(n, name, human) {
    const modeStr = (n.type === 'dir' ? 'd' : '-') + this._rwxString(n.mode);
    const rawSize = n.type === 'file' ? (n.size !== undefined ? n.size : n.content.length) : 4096;
    const size = human ? this._humanSize(rawSize) : String(rawSize);
    return modeStr + ' 1 ' + n.owner + ' ' + n.group + ' ' + size + ' ' + name;
  }

  _rwxString(mode) {
    const bits = [(mode >> 6) & 7, (mode >> 3) & 7, mode & 7];
    return bits.map((b) => (b & 4 ? 'r' : '-') + (b & 2 ? 'w' : '-') + (b & 1 ? 'x' : '-')).join('');
  }

  _humanSize(n) {
    if (n < 1024) return String(n);
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'K';
    return (n / 1024 / 1024).toFixed(1) + 'M';
  }

  _cd(args) {
    const p = args[0] || this.fs.home;
    const node = V.nodeAt(this.fs, p);
    if (!node || node.type !== 'dir') {
      return { stdout: '', stderr: 'bash: cd: ' + p + ': No such file or directory\n', code: 1 };
    }
    this.fs.cwd = V.resolvePath(this.fs, p);
    return { stdout: '', stderr: '', code: 0 };
  }

  _pwd() {
    return { stdout: this.fs.cwd + '\n', stderr: '', code: 0 };
  }

  _cat(args, stdin) {
    if (args.length === 0) {
      return { stdout: stdin, stderr: '', code: 0 };
    }
    let out = '';
    let err = '';
    let code = 0;
    for (const p of args) {
      const node = V.nodeAt(this.fs, p);
      if (!node) {
        err += 'cat: ' + p + ': No such file or directory\n';
        code = 1;
        continue;
      }
      if (node.type === 'dir') {
        err += 'cat: ' + p + ': Is a directory\n';
        code = 1;
        continue;
      }
      if (!this._isReadable(node)) {
        err += 'cat: ' + p + ': Permission denied\n';
        code = 1;
        continue;
      }
      out += node.content;
    }
    return { stdout: out, stderr: err, code };
  }

  _file(args) {
    if (!args.length) return { stdout: '', stderr: 'file: missing operand\n', code: 1 };
    let out = '';
    let err = '';
    let code = 0;
    for (const p of args) {
      const node = V.nodeAt(this.fs, p);
      if (!node) {
        err += p + ': cannot open (No such file or directory)\n';
        code = 1;
        continue;
      }
      if (node.type === 'dir') {
        out += p + ': directory\n';
        continue;
      }
      out += p + ': ' + this._classify(node) + '\n';
    }
    return { stdout: out, stderr: err, code };
  }

  _classify(node) {
    const content = node.content || '';
    const printable = /^[\x09\x0a\x0d\x20-\x7e]*$/.test(content);
    if (printable) return 'ASCII text';
    if (node.encoding === 'gzip') return 'gzip compressed data';
    if (node.encoding === 'bzip2') return 'bzip2 compressed data';
    if (node.encoding === 'tar') return 'POSIX tar archive';
    if (content.charCodeAt(0) === 0x1f && content.charCodeAt(1) === 0x8b) return 'gzip compressed data';
    if (content.slice(0, 3) === 'BZh') return 'bzip2 compressed data';
    return 'data';
  }

  _find(args) {
    let i = 0;
    let startPath = '.';
    if (args.length && args[0] !== '!' && args[0][0] !== '-') {
      startPath = args[0];
      i = 1;
    }

    const tests = [];
    let negateNext = false;
    for (; i < args.length; i++) {
      const a = args[i];
      if (a === '!') {
        negateNext = true;
        continue;
      }
      let pred = null;
      if (a === '-type') {
        const v = args[++i];
        pred = (node) => (v === 'f' ? node.type === 'file' : node.type === 'dir');
      } else if (a === '-name') {
        const v = args[++i];
        const re = _globToRegExp(v);
        pred = (node, name) => re.test(name);
      } else if (a === '-size') {
        const v = args[++i];
        const n = parseInt(v, 10);
        pred = (node) => node.type === 'file' && node.size === n;
      } else if (a === '-user') {
        const v = args[++i];
        pred = (node) => node.owner === v;
      } else if (a === '-group') {
        const v = args[++i];
        pred = (node) => node.group === v;
      } else if (a === '-readable') {
        pred = (node) => this._isReadable(node);
      } else if (a === '-executable') {
        pred = (node) => this._isExecutable(node);
      } else {
        continue; // unrecognized test: ignore rather than crash
      }
      if (negateNext) {
        const inner = pred;
        pred = (node, name) => !inner(node, name);
        negateNext = false;
      }
      tests.push(pred);
    }

    const startNode = V.nodeAt(this.fs, startPath);
    if (!startNode) {
      return { stdout: '', stderr: "find: '" + startPath + "': No such file or directory\n", code: 1 };
    }
    const startAbs = V.resolvePath(this.fs, startPath);

    const results = [];
    const errors = [];
    const walk = (node, abs) => {
      const name = abs === '/' ? '/' : abs.split('/').filter(Boolean).pop();
      if (tests.every((t) => t(node, name))) results.push(abs);
      if (node.type === 'dir') {
        if (!this._isReadable(node)) {
          errors.push("find: '" + abs + "': Permission denied\n");
          return;
        }
        const names = Object.keys(node.entries).sort();
        for (const n of names) {
          walk(node.entries[n], abs === '/' ? '/' + n : abs + '/' + n);
        }
      }
    };
    walk(startNode, startAbs);

    return { stdout: results.join('\n') + (results.length ? '\n' : ''), stderr: errors.join(''), code: 0 };
  }

  _grep(args, stdin) {
    const { flags, rest } = _splitFlags(args);
    const pattern = rest.shift();
    if (pattern === undefined) return { stdout: '', stderr: 'grep: missing pattern\n', code: 2 };

    let text;
    let err = '';
    let hadError = false;
    if (rest.length) {
      let combined = '';
      for (const p of rest) {
        const node = V.nodeAt(this.fs, p);
        if (!node) {
          err += 'grep: ' + p + ': No such file or directory\n';
          hadError = true;
          continue;
        }
        if (node.type === 'dir') {
          err += 'grep: ' + p + ': Is a directory\n';
          hadError = true;
          continue;
        }
        combined += node.content;
      }
      text = combined;
    } else {
      text = stdin;
    }

    const flagsStr = flags.has('i') ? 'i' : '';
    let re;
    try {
      re = new RegExp(pattern, flagsStr);
    } catch (e) {
      re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flagsStr);
    }

    let lines = text.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    const matched = lines.filter((l) => re.test(l));
    const out = matched.length ? matched.join('\n') + '\n' : '';
    const code = hadError ? 2 : (matched.length ? 0 : 1);
    return { stdout: out, stderr: err, code };
  }

  _sort(args, stdin) {
    const { flags, rest } = _splitFlags(args);
    let text;
    if (rest.length) {
      let combined = '';
      for (const p of rest) {
        const node = V.nodeAt(this.fs, p);
        if (!node) return { stdout: '', stderr: 'sort: cannot read: ' + p + ': No such file or directory\n', code: 2 };
        combined += node.content;
      }
      text = combined;
    } else {
      text = stdin;
    }
    let lines = text.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (flags.has('n')) lines.sort((a, b) => parseFloat(a) - parseFloat(b));
    else lines.sort();
    if (flags.has('r')) lines.reverse();
    return { stdout: lines.length ? lines.join('\n') + '\n' : '', stderr: '', code: 0 };
  }

  _uniq(args, stdin) {
    const { flags, rest } = _splitFlags(args);
    let text;
    if (rest.length) {
      const node = V.nodeAt(this.fs, rest[0]);
      if (!node) return { stdout: '', stderr: 'uniq: ' + rest[0] + ': No such file or directory\n', code: 1 };
      text = node.content;
    } else {
      text = stdin;
    }
    let lines = text.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();

    const groups = [];
    for (const l of lines) {
      if (groups.length && groups[groups.length - 1].line === l) groups[groups.length - 1].count++;
      else groups.push({ line: l, count: 1 });
    }

    let outGroups = groups;
    if (flags.has('u')) outGroups = groups.filter((g) => g.count === 1);
    else if (flags.has('d')) outGroups = groups.filter((g) => g.count > 1);

    const lines2 = outGroups.map((g) => (flags.has('c') ? String(g.count).padStart(7) + ' ' + g.line : g.line));
    return { stdout: lines2.length ? lines2.join('\n') + '\n' : '', stderr: '', code: 0 };
  }

  _strings(args, stdin) {
    let text;
    if (args.length) {
      const node = V.nodeAt(this.fs, args[0]);
      if (!node) return { stdout: '', stderr: 'strings: ' + args[0] + ': No such file or directory\n', code: 1 };
      text = node.content;
    } else {
      text = stdin;
    }
    const lines = [];
    let cur = '';
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0x20 && code <= 0x7e) {
        cur += text[i];
      } else {
        if (cur.length >= 4) lines.push(cur);
        cur = '';
      }
    }
    if (cur.length >= 4) lines.push(cur);
    return { stdout: lines.length ? lines.join('\n') + '\n' : '', stderr: '', code: 0 };
  }

  _base64(args, stdin) {
    const { flags, rest } = _splitFlags(args);
    let text;
    if (rest.length) {
      const node = V.nodeAt(this.fs, rest[0]);
      if (!node) return { stdout: '', stderr: 'base64: ' + rest[0] + ': No such file or directory\n', code: 1 };
      text = node.content;
    } else {
      text = stdin;
    }
    const out = flags.has('d') ? V.b64decode(text) : V.b64encode(text);
    return { stdout: out, stderr: '', code: 0 };
  }

  _tr(args, stdin) {
    if (args.length < 2) return { stdout: '', stderr: 'tr: missing operand\n', code: 1 };
    const set1 = _expandTrSet(args[0]);
    const set2 = _expandTrSet(args[1]);
    const map = {};
    for (let i = 0; i < set1.length; i++) {
      map[set1[i]] = set2[i] !== undefined ? set2[i] : set2[set2.length - 1];
    }
    let out = '';
    for (const ch of stdin) out += map[ch] !== undefined ? map[ch] : ch;
    return { stdout: out, stderr: '', code: 0 };
  }

  _xxd(args, stdin) {
    const { flags, rest } = _splitFlags(args);
    if (flags.has('r')) {
      return { stdout: '', stderr: 'xxd: -r reversal lands in a later task\n', code: 1 };
    }
    let text;
    if (rest.length) {
      const node = V.nodeAt(this.fs, rest[0]);
      if (!node) return { stdout: '', stderr: 'xxd: ' + rest[0] + ': No such file or directory\n', code: 1 };
      text = node.content;
    } else {
      text = stdin;
    }
    const bytes = [];
    for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i) & 0xff);
    const lines = [];
    for (let i = 0; i < bytes.length; i += 16) {
      const chunk = bytes.slice(i, i + 16);
      const offset = i.toString(16).padStart(8, '0');
      const hexGroups = [];
      for (let j = 0; j < chunk.length; j += 2) {
        const a = chunk[j].toString(16).padStart(2, '0');
        const b = chunk[j + 1] !== undefined ? chunk[j + 1].toString(16).padStart(2, '0') : '';
        hexGroups.push(a + b);
      }
      const hexPart = hexGroups.join(' ').padEnd(39, ' ');
      const asciiPart = chunk.map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.')).join('');
      lines.push(offset + ': ' + hexPart + '  ' + asciiPart);
    }
    return { stdout: lines.join('\n') + (lines.length ? '\n' : ''), stderr: '', code: 0 };
  }

  _head(args, stdin) {
    let n = 10;
    const files = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-n') n = parseInt(args[++i], 10);
      else if (/^-\d+$/.test(args[i])) n = -parseInt(args[i], 10);
      else files.push(args[i]);
    }
    let text;
    if (files.length) {
      const node = V.nodeAt(this.fs, files[0]);
      if (!node) return { stdout: '', stderr: "head: cannot open '" + files[0] + "' for reading: No such file or directory\n", code: 1 };
      text = node.content;
    } else {
      text = stdin;
    }
    let lines = text.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    const sel = lines.slice(0, n);
    return { stdout: sel.length ? sel.join('\n') + '\n' : '', stderr: '', code: 0 };
  }

  _tail(args, stdin) {
    let n = 10;
    const files = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-n') n = parseInt(args[++i], 10);
      else files.push(args[i]);
    }
    let text;
    if (files.length) {
      const node = V.nodeAt(this.fs, files[0]);
      if (!node) return { stdout: '', stderr: "tail: cannot open '" + files[0] + "' for reading: No such file or directory\n", code: 1 };
      text = node.content;
    } else {
      text = stdin;
    }
    let lines = text.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    const sel = n > 0 ? lines.slice(-n) : lines.slice(0);
    return { stdout: sel.length ? sel.join('\n') + '\n' : '', stderr: '', code: 0 };
  }

  _wc(args, stdin) {
    const { flags, rest } = _splitFlags(args);
    let text;
    if (rest.length) {
      const node = V.nodeAt(this.fs, rest[0]);
      if (!node) return { stdout: '', stderr: 'wc: ' + rest[0] + ': No such file or directory\n', code: 1 };
      text = node.content;
    } else {
      text = stdin;
    }
    const lineCount = (text.match(/\n/g) || []).length;
    const byteCount = text.length;
    const suffix = rest.length ? ' ' + rest[0] : '';
    if (flags.has('l') && !flags.has('c')) return { stdout: lineCount + suffix + '\n', stderr: '', code: 0 };
    if (flags.has('c') && !flags.has('l')) return { stdout: byteCount + suffix + '\n', stderr: '', code: 0 };
    return { stdout: lineCount + ' ' + byteCount + suffix + '\n', stderr: '', code: 0 };
  }

  _mkdir(args) {
    const { flags, rest } = _splitFlags(args);
    let err = '';
    let code = 0;
    for (const p of rest) {
      const abs = V.resolvePath(this.fs, p);
      const existing = V.nodeAt(this.fs, abs);
      if (existing) {
        err += "mkdir: cannot create directory '" + p + "': File exists\n";
        code = 1;
        continue;
      }
      const { parent, name } = V.parentAndName(this.fs, abs);
      if (!parent) {
        if (flags.has('p')) {
          this._mkdirp(abs);
          continue;
        }
        err += "mkdir: cannot create directory '" + p + "': No such file or directory\n";
        code = 1;
        continue;
      }
      parent.entries[name] = V.dir({}, { owner: this.fs.user, group: this.fs.user });
    }
    return { stdout: '', stderr: err, code };
  }

  _mkdirp(abs) {
    const parts = abs.split('/').filter(Boolean);
    let cur = this.fs.tree;
    for (const part of parts) {
      if (!cur.entries[part]) cur.entries[part] = V.dir({}, { owner: this.fs.user, group: this.fs.user });
      cur = cur.entries[part];
    }
  }

  _cp(args) {
    if (args.length < 2) return { stdout: '', stderr: 'cp: missing file operand\n', code: 1 };
    const src = args[0];
    const dst = args[1];
    const node = V.nodeAt(this.fs, src);
    if (!node) return { stdout: '', stderr: "cp: cannot stat '" + src + "': No such file or directory\n", code: 1 };

    let dstAbs = V.resolvePath(this.fs, dst);
    const dstNode = V.nodeAt(this.fs, dstAbs);
    if (dstNode && dstNode.type === 'dir') {
      const base = src.split('/').filter(Boolean).pop();
      dstAbs = (dstAbs === '/' ? '' : dstAbs) + '/' + base;
    }
    const { parent, name } = V.parentAndName(this.fs, dstAbs);
    if (!parent) return { stdout: '', stderr: "cp: cannot create '" + dst + "': No such file or directory\n", code: 1 };
    parent.entries[name] = JSON.parse(JSON.stringify(node));
    return { stdout: '', stderr: '', code: 0 };
  }

  _mv(args) {
    const r = this._cp(args);
    if (r.code !== 0) return r;
    const src = args[0];
    const { parent, name } = V.parentAndName(this.fs, V.resolvePath(this.fs, src));
    if (parent) delete parent.entries[name];
    return { stdout: '', stderr: '', code: 0 };
  }

  _echo(args) {
    return { stdout: args.join(' ') + '\n', stderr: '', code: 0 };
  }

  _whoami() {
    return { stdout: this.fs.user + '\n', stderr: '', code: 0 };
  }

  _hostname() {
    return { stdout: 'bandit\n', stderr: '', code: 0 };
  }

  // Public: returns just the token array (tests assert on this directly).
  tokenize(line) {
    return _tokenizeRaw(line).tokens;
  }

  // Internal: tokens + parallel quoted-flag array, used by parse().
  _tokenizeWithQuotes(line) {
    return _tokenizeRaw(line);
  }

  expandGlobs(tokens, quoted) {
    quoted = quoted || tokens.map(() => false);

    return tokens.map((tok, idx) => {
      if (quoted[idx]) return tok;
      if (!_isGlobToken(tok)) return tok;

      // Support a path prefix before the glob (e.g. "./inhere/-file*" or
      // "/var/log/*"): match the glob against the NAMED directory's entries,
      // not always the shell's cwd, then re-prepend that same prefix to
      // each match so results still resolve from wherever the caller is.
      const slashIdx = tok.lastIndexOf('/');
      const dirPart = slashIdx >= 0 ? tok.slice(0, slashIdx) : null;
      const basePart = slashIdx >= 0 ? tok.slice(slashIdx + 1) : tok;
      if (!_isGlobToken(basePart)) return tok; // glob chars only in the dir part -- leave literal

      const dirNode = V.nodeAt(this.fs, dirPart !== null ? (dirPart || '/') : this.fs.cwd);
      const names = (dirNode && dirNode.type === 'dir') ? Object.keys(dirNode.entries) : [];

      const re = _globToRegExp(basePart);
      const leadingDotGlob = basePart[0] === '*'; // bash: leading * shouldn't match a leading dot
      const matches = names.filter((name) => {
        if (leadingDotGlob && name[0] === '.') return false;
        return re.test(name);
      }).sort();

      if (matches.length === 0) return tok;
      const prefix = dirPart !== null ? dirPart + '/' : '';
      return matches.map((m) => prefix + m); // caller flattens
    }).reduce((acc, item) => {
      if (Array.isArray(item)) acc.push(...item);
      else acc.push(item);
      return acc;
    }, []);
  }

  parse(line) {
    const { tokens, quoted } = this._tokenizeWithQuotes(line);
    // NOTE: globs are expanded across the WHOLE token stream before splitting
    // on |/&&/redirects. A multi-match glob used as a redirect target (e.g.
    // `ls > out*.txt` matching several files) therefore splices the extra
    // filenames into the command's argv rather than raising bash's "ambiguous
    // redirect". Task 5 (execution) owns resolving that; do not change here.
    const expanded = this.expandGlobs(tokens, quoted);

    const sequences = _splitOn(expanded, '&&').map((seqTokens) => {
      const pipeline = _splitOn(seqTokens, '|').map((cmdTokens) => _parseCommand(cmdTokens));
      return { pipeline };
    });

    return sequences;
  }
}

function _splitOn(tokens, sep) {
  const groups = [[]];
  for (const tok of tokens) {
    if (tok === sep) groups.push([]);
    else groups[groups.length - 1].push(tok);
  }
  return groups;
}

function _parseCommand(tokens) {
  const argv = [];
  const redirect = { op: null, path: null };
  let stderrToNull = false;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === '2>/dev/null') {
      stderrToNull = true;
    } else if (tok === '>' || tok === '>>') {
      redirect.op = tok;
      i++;
      redirect.path = tokens[i] !== undefined ? tokens[i] : null;
    } else {
      argv.push(tok);
    }
  }

  return { argv, redirect, stderrToNull };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Shell };
}
