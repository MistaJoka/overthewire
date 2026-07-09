/* Virtual filesystem for Bandit levels 0-12. Dual-target: browser global + Node export. */

/* ---------------------------------------------------------------------
 * FAKE_PW: distinct 32-char alphanumeric FAKE passwords for keys 0-13.
 * These are NOT real OverTheWire passwords. Level N's solution reveals
 * FAKE_PW[N+1].
 * ------------------------------------------------------------------- */
const FAKE_PW = {
  0: 'NrCV5se5GJfYUQDGD5BHOx56YMfZH9mp',
  1: 'aXDp0Z7zMSAvogFMF0BNbjz1wY9yN7OT',
  2: 'nDF9uGatRbfI8wHRHvBToVuwKjeNU5z7',
  3: '0tGTpx4nXkAfRBJXJqBZ1Iorhv8la3bm',
  4: 'CZIokeXidtf2lRLdLlCfE4jm57dAg1CQ',
  5: 'PFJ8eM0ci2AQ5hOiNfClSqdhTI7Znzo4',
  6: 'cwLSZ3TWoBfnOwQoQaCrfdYcrUbxtxPj',
  7: 'pcMmUkxQuK9AiCStSVCxsPSXEf6M0w1N',
  8: '1IO6ORQKzTeX2SUzUQD45BNScral6ud1',
  9: 'EyPRJ8tF5c9uMiW5WLDAIxHN0359CsEf',
  10: 'ReRlDpN9BleHfxZAYGDGWkCINEZYJqqK',
  11: 'eKS58Xq3Gt9fzDbGaADMjW6ElQ4xPoRy',
  12: 'q0UP3EJxM2e2JTdMd5ESwI199cYLWm3c',
  13: '3hVkxvmsRB9PcifRf0EY95v4Xn2kckeH',
};

/* ---------------------------------------------------------------------
 * Pure-JS encoding helpers (no Buffer/btoa/atob - must run in browser
 * and Node identically).
 * ------------------------------------------------------------------- */
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function b64encode(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xff);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const haveB1 = b1 !== undefined;
    const haveB2 = b2 !== undefined;
    const triplet = (b0 << 16) | ((haveB1 ? b1 : 0) << 8) | (haveB2 ? b2 : 0);
    out += B64_CHARS[(triplet >> 18) & 0x3f];
    out += B64_CHARS[(triplet >> 12) & 0x3f];
    out += haveB1 ? B64_CHARS[(triplet >> 6) & 0x3f] : '=';
    out += haveB2 ? B64_CHARS[triplet & 0x3f] : '=';
  }
  return out;
}

function b64decode(str) {
  const clean = str.replace(/[^A-Za-z0-9+/]/g, '');
  const lookup = {};
  for (let i = 0; i < B64_CHARS.length; i++) lookup[B64_CHARS[i]] = i;
  let out = '';
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = lookup[clean[i]];
    const c1 = lookup[clean[i + 1]];
    const c2 = clean[i + 2] !== undefined ? lookup[clean[i + 2]] : undefined;
    const c3 = clean[i + 3] !== undefined ? lookup[clean[i + 3]] : undefined;
    if (c0 === undefined || c1 === undefined) continue;
    const triplet = (c0 << 18) | (c1 << 12) | ((c2 || 0) << 6) | (c3 || 0);
    out += String.fromCharCode((triplet >> 16) & 0xff);
    if (c2 !== undefined) out += String.fromCharCode((triplet >> 8) & 0xff);
    if (c3 !== undefined) out += String.fromCharCode(triplet & 0xff);
  }
  return out;
}

function rot13(str) {
  return str.replace(/[a-zA-Z]/g, function (c) {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

/* ---------------------------------------------------------------------
 * Deterministic filler generators (decoy content only - never used for
 * the real trap values).
 * ------------------------------------------------------------------- */
function randToken(len) {
  len = len || 32;
  let s = '';
  while (s.length < len) s += Math.random().toString(36).slice(2);
  return s.slice(0, len);
}

function binaryBlob(seed, len) {
  let s = '';
  let x = (seed * 2654435761) % 2147483647;
  if (x < 0) x += 2147483647;
  for (let i = 0; i < len; i++) {
    x = (x * 48271) % 2147483647;
    s += String.fromCharCode(x % 256);
  }
  return s;
}

// Deterministic junk with isolated (run-length-1) printable characters,
// so no accidental printable run of length >= 4 appears in the noise.
function junkBytes(len, seed) {
  let out = '';
  let x = seed || 1234567;
  for (let i = 0; i < len; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    if (i % 2 === 0) {
      let c = x % 32;
      if (c === 9 || c === 10) c = 1; // keep it a control char, not tab/newline
      out += String.fromCharCode(c);
    } else {
      out += String.fromCharCode(0x21 + (x % 90));
    }
  }
  return out;
}

function formatHexDump(bytes) {
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
    const asciiPart = chunk
      .map(function (b) { return b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'; })
      .join('');
    lines.push(offset + ': ' + hexPart + '  ' + asciiPart);
  }
  return lines.join('\n') + '\n';
}

/* ---------------------------------------------------------------------
 * Node builders.
 * ------------------------------------------------------------------- */
function dir(entries, opts) {
  opts = opts || {};
  return {
    type: 'dir',
    entries: entries || {},
    mode: opts.mode !== undefined ? opts.mode : 0o755,
    owner: opts.owner || 'root',
    group: opts.group || 'root',
  };
}

function file(content, opts) {
  opts = opts || {};
  const node = {
    type: 'file',
    content: content,
    mode: opts.mode !== undefined ? opts.mode : 0o644,
    owner: opts.owner || 'root',
    group: opts.group || 'root',
    size: opts.size !== undefined ? opts.size : content.length,
  };
  if (opts.encoding !== undefined) node.encoding = opts.encoding;
  if (opts.layers !== undefined) node.layers = opts.layers;
  return node;
}

/* ---------------------------------------------------------------------
 * Path helpers.
 * ------------------------------------------------------------------- */
function resolvePath(fs, p) {
  const isAbs = p.startsWith('/');
  const combined = isAbs ? p : fs.cwd.replace(/\/+$/, '') + '/' + p;
  const parts = combined.split('/').filter(function (s) { return s.length > 0; });
  const stack = [];
  for (const part of parts) {
    if (part === '.') continue;
    else if (part === '..') stack.pop();
    else stack.push(part);
  }
  return '/' + stack.join('/');
}

function nodeAt(fs, abs) {
  const path = resolvePath(fs, abs);
  if (path === '/') return fs.tree;
  const parts = path.split('/').filter(Boolean);
  let node = fs.tree;
  for (const part of parts) {
    if (!node || node.type !== 'dir' || !node.entries || !Object.prototype.hasOwnProperty.call(node.entries, part)) {
      return null;
    }
    node = node.entries[part];
  }
  return node;
}

function parentAndName(fs, abs) {
  const path = resolvePath(fs, abs);
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  const parentPath = '/' + parts.join('/');
  const parent = nodeAt(fs, parentPath);
  return { parent: parent, name: name };
}

/* ---------------------------------------------------------------------
 * Standard root skeleton shared by every level (built fresh every call).
 * ------------------------------------------------------------------- */
function standardRoot() {
  const homes = {};
  for (let i = 0; i <= 13; i++) {
    homes['bandit' + i] = dir({}, { mode: 0o700, owner: 'bandit' + i, group: 'bandit' + i });
  }
  return dir(
    {
      bin: dir({}, { mode: 0o755, owner: 'root', group: 'root' }),
      etc: dir({}, { mode: 0o755, owner: 'root', group: 'root' }),
      lib: dir({}, { mode: 0o755, owner: 'root', group: 'root' }),
      tmp: dir({}, { mode: 0o1777, owner: 'root', group: 'root' }),
      usr: dir({ bin: dir({}, { mode: 0o755, owner: 'root', group: 'root' }) }, { mode: 0o755, owner: 'root', group: 'root' }),
      var: dir({ lib: dir({}, { mode: 0o755, owner: 'root', group: 'root' }) }, { mode: 0o755, owner: 'root', group: 'root' }),
      root: dir({}, { mode: 0o700, owner: 'root', group: 'root' }),
      home: dir(homes, { mode: 0o755, owner: 'root', group: 'root' }),
    },
    { mode: 0o755, owner: 'root', group: 'root' }
  );
}

/* ---------------------------------------------------------------------
 * vfsForLevel(n): builds a brand-new tree every call - no shared
 * mutable state leaks between terminal sessions.
 * ------------------------------------------------------------------- */
function vfsForLevel(n) {
  const user = 'bandit' + n;
  const home = '/home/' + user;
  const tree = standardRoot();

  switch (n) {
    case 0: {
      tree.entries.home.entries.bandit0 = dir(
        { readme: file(FAKE_PW[1] + '\n', { owner: 'bandit0', group: 'bandit0' }) },
        { mode: 0o755, owner: 'bandit0', group: 'bandit0' }
      );
      break;
    }

    case 1: {
      tree.entries.home.entries.bandit1 = dir(
        { '-': file(FAKE_PW[2] + '\n', { owner: 'bandit1', group: 'bandit1' }) },
        { mode: 0o755, owner: 'bandit1', group: 'bandit1' }
      );
      break;
    }

    case 2: {
      tree.entries.home.entries.bandit2 = dir(
        { 'spaces in this filename': file(FAKE_PW[3] + '\n', { owner: 'bandit2', group: 'bandit2' }) },
        { mode: 0o755, owner: 'bandit2', group: 'bandit2' }
      );
      break;
    }

    case 3: {
      tree.entries.home.entries.bandit3 = dir(
        {
          inhere: dir(
            { '...Hiding-From-You': file(FAKE_PW[4] + '\n', { owner: 'bandit3', group: 'bandit3' }) },
            { mode: 0o755, owner: 'bandit3', group: 'bandit3' }
          ),
        },
        { mode: 0o755, owner: 'bandit3', group: 'bandit3' }
      );
      break;
    }

    case 4: {
      const inhereEntries = {};
      for (let i = 0; i <= 9; i++) {
        const name = '-file0' + i;
        if (i === 7) {
          inhereEntries[name] = file(FAKE_PW[5] + '\n', { owner: 'bandit4', group: 'bandit4' });
        } else {
          inhereEntries[name] = file('\x00' + binaryBlob(i + 1, 40), { owner: 'bandit4', group: 'bandit4' });
        }
      }
      tree.entries.home.entries.bandit4 = dir(
        { inhere: dir(inhereEntries, { mode: 0o755, owner: 'bandit4', group: 'bandit4' }) },
        { mode: 0o755, owner: 'bandit4', group: 'bandit4' }
      );
      break;
    }

    case 5: {
      const maybehereEntries = {};
      const correctIdx = 7;
      const decoyExecIdx = 3;
      for (let i = 0; i <= 19; i++) {
        const dname = 'maybehere' + String(i).padStart(2, '0');
        const fEntries = {};
        if (i === correctIdx) {
          const body = FAKE_PW[6] + '\n';
          const filler = 'x'.repeat(1033 - body.length);
          fEntries['-file' + i] = file(body + filler, { mode: 0o644, owner: 'bandit5', group: 'bandit5' });
        } else if (i === decoyExecIdx) {
          // same size as the real target, but executable -> must be excluded
          const filler = 'y'.repeat(1033 - 10);
          fEntries['-file' + i] = file('decoy_exe='.slice(0, 10) + filler, { mode: 0o755, owner: 'bandit5', group: 'bandit5' });
        } else {
          const size = 50 + i * 3;
          fEntries['-file' + i] = file('d'.repeat(size), { mode: 0o644, owner: 'bandit5', group: 'bandit5' });
        }
        maybehereEntries[dname] = dir(fEntries, { mode: 0o755, owner: 'bandit5', group: 'bandit5' });
      }
      tree.entries.home.entries.bandit5 = dir(
        { inhere: dir(maybehereEntries, { mode: 0o755, owner: 'bandit5', group: 'bandit5' }) },
        { mode: 0o755, owner: 'bandit5', group: 'bandit5' }
      );
      break;
    }

    case 6: {
      const target = file(FAKE_PW[7] + '\n', { mode: 0o644, owner: 'bandit7', group: 'bandit6' }); // 33 bytes
      // decoy owned by a different user entirely -> world-read bit clear, "Permission denied" for bandit6
      const decoyOtherOwner = file(FAKE_PW[8] + '\n', { mode: 0o600, owner: 'bandit8', group: 'bandit8' });
      // decoy with the right owner/group but wrong size -> should not match the find criteria
      const decoyWrongSize = file('not-the-secret-data', { mode: 0o644, owner: 'bandit7', group: 'bandit6' });

      tree.entries.var.entries.lib.entries.dpkg = dir(
        {
          info: dir(
            {
              'bandit7.password': target,
              'bandit8.password': decoyOtherOwner,
              'bandit7.info': decoyWrongSize,
            },
            { mode: 0o755, owner: 'root', group: 'root' }
          ),
        },
        { mode: 0o755, owner: 'root', group: 'root' }
      );

      tree.entries.home.entries.bandit6 = dir({}, { mode: 0o755, owner: 'bandit6', group: 'bandit6' });
      break;
    }

    case 7: {
      const numberWords = [
        'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
        'hundredth', 'thousandth', 'ten-thousandth', 'hundred-thousandth',
      ];
      const lines = [];
      numberWords.forEach(function (w) { lines.push(w + '\t' + randToken(32)); });
      for (let i = 0; i < 50; i++) lines.push('line' + i + '\t' + randToken(32));
      lines.push('millionth\t' + FAKE_PW[8]);
      const content = lines.join('\n') + '\n';
      tree.entries.home.entries.bandit7 = dir(
        { 'data.txt': file(content, { owner: 'bandit7', group: 'bandit7' }) },
        { mode: 0o755, owner: 'bandit7', group: 'bandit7' }
      );
      break;
    }

    case 8: {
      const fillers = [];
      for (let i = 0; i < 20; i++) fillers.push(randToken(20));
      const lines = [];
      fillers.forEach(function (f) {
        const reps = 45 + Math.floor(Math.random() * 10);
        for (let k = 0; k < reps; k++) lines.push(f);
      });
      lines.push(FAKE_PW[9]);
      // simple shuffle so the unique line isn't suspiciously at the end
      for (let i = lines.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = lines[i]; lines[i] = lines[j]; lines[j] = tmp;
      }
      const content = lines.join('\n') + '\n';
      tree.entries.home.entries.bandit8 = dir(
        { 'data.txt': file(content, { owner: 'bandit8', group: 'bandit8' }) },
        { mode: 0o755, owner: 'bandit8', group: 'bandit8' }
      );
      break;
    }

    case 9: {
      const marker = '='.repeat(8) + FAKE_PW[10];
      const content = junkBytes(300, 111) + marker + junkBytes(300, 222);
      tree.entries.home.entries.bandit9 = dir(
        { 'data.txt': file(content, { owner: 'bandit9', group: 'bandit9' }) },
        { mode: 0o755, owner: 'bandit9', group: 'bandit9' }
      );
      break;
    }

    case 10: {
      const secret = 'The password is ' + FAKE_PW[11] + '\n';
      const content = b64encode(secret);
      tree.entries.home.entries.bandit10 = dir(
        { 'data.txt': file(content, { owner: 'bandit10', group: 'bandit10' }) },
        { mode: 0o755, owner: 'bandit10', group: 'bandit10' }
      );
      break;
    }

    case 11: {
      const secret = 'The password is ' + FAKE_PW[12] + '\n';
      const content = rot13(secret);
      tree.entries.home.entries.bandit11 = dir(
        { 'data.txt': file(content, { owner: 'bandit11', group: 'bandit11' }) },
        { mode: 0o755, owner: 'bandit11', group: 'bandit11' }
      );
      break;
    }

    case 12: {
      const finalLine = 'The password is ' + FAKE_PW[13] + '\n';
      const magic = [0x1f, 0x8b, 0x08, 0x00]; // gzip magic + flags, for authenticity
      const fillerBytes = [];
      for (let i = 0; i < 60; i++) {
        fillerBytes.push((FAKE_PW[13].charCodeAt(i % FAKE_PW[13].length) + i * 7) % 256);
      }
      const bytes = magic.concat(fillerBytes);
      const hexdump = formatHexDump(bytes);
      // Layers describe the compression-onion chain a later shell task peels
      // (xxd -r / gzip -d / bunzip2 / tar -xf, alternating) until it bottoms
      // out at the plaintext password line.
      const layers = [
        { step: 1, encoding: 'gzip', note: 'xxd -r -p turns the hexdump back into a gzip-compressed blob' },
        { step: 2, encoding: 'bzip2', note: 'gzip -d reveals a bzip2-compressed blob' },
        { step: 3, encoding: 'tar', note: 'bunzip2 reveals a tar archive' },
        { step: 4, encoding: 'gzip', note: 'tar -xf reveals another gzip blob' },
        { step: 5, encoding: 'bzip2', note: 'gzip -d reveals another bzip2 blob' },
        { step: 6, encoding: 'tar', note: 'bunzip2 reveals another tar archive' },
        { step: 7, encoding: 'ascii', content: finalLine, note: 'tar -xf reveals the final plaintext file' },
      ];
      tree.entries.home.entries.bandit12 = dir(
        {
          'data.txt': file(hexdump, {
            owner: 'bandit12',
            group: 'bandit12',
            encoding: 'hex',
            layers: layers,
          }),
        },
        { mode: 0o755, owner: 'bandit12', group: 'bandit12' }
      );
      break;
    }

    default: {
      // Levels beyond this task's scope (13+) get a minimal placeholder
      // home so callers don't crash on a null lookup.
      tree.entries.home.entries[user] = tree.entries.home.entries[user] || dir({}, { mode: 0o755, owner: user, group: user });
      break;
    }
  }

  return { cwd: home, home: home, user: user, tree: tree };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FAKE_PW,
    vfsForLevel,
    resolvePath,
    nodeAt,
    parentAndName,
    dir,
    file,
    b64encode,
    b64decode,
    rot13,
  };
}
