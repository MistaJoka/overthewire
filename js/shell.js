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
 * Shell
 * ------------------------------------------------------------------- */
class Shell {
  constructor(fs) {
    this.fs = fs;
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
    const dirNode = V.nodeAt(this.fs, this.fs.cwd);
    const names = (dirNode && dirNode.type === 'dir') ? Object.keys(dirNode.entries) : [];

    return tokens.map((tok, idx) => {
      if (quoted[idx]) return tok;
      if (!_isGlobToken(tok)) return tok;

      const re = _globToRegExp(tok);
      const leadingDotGlob = tok[0] === '*'; // bash: leading * shouldn't match a leading dot
      const matches = names.filter((name) => {
        if (leadingDotGlob && name[0] === '.') return false;
        return re.test(name);
      }).sort();

      if (matches.length === 0) return tok;
      return matches; // caller flattens
    }).reduce((acc, item) => {
      if (Array.isArray(item)) acc.push(...item);
      else acc.push(item);
      return acc;
    }, []);
  }

  parse(line) {
    const { tokens, quoted } = this._tokenizeWithQuotes(line);
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
