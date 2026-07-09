/* In-browser terminal UI for the Bandit walkthrough. Browser-only (DOM),
 * built on top of the already-tested Shell + vfs engine.
 *
 * Consumes globals defined by earlier <script> tags: Shell (js/shell.js),
 * vfsForLevel / FAKE_PW / nodeAt (js/vfs.js), store (js/app.js — but only
 * referenced at RUNTIME, inside methods, never at parse time, so load
 * order data->vfs->shell->term->app is safe).
 *
 * class Terminal(mountEl, level, opts)
 *   level: a LEVELS entry ({from, to, ...})
 *   opts:  { onCapture(toLevel), typed: bool, showBanner: bool }
 *
 * Public API: mount(), focus(), destroy().
 */

const TERM_HIST_KEY = 'bandit_termhist_v1';
const TERM_CLEAR_SENTINEL = '\x1b[CLEAR]';
const TERM_EXIT_SENTINEL = '\x1b[EXIT]';
const TERM_TYPE_DELAY_MS = 16;

// Fallback command list, only used if a Shell instance somehow doesn't
// expose its command table (Shell.cmds is public in the current impl).
const TERM_STATIC_CMDS = [
  'ls', 'cd', 'pwd', 'cat', 'file', 'find', 'grep', 'sort', 'uniq', 'strings',
  'base64', 'tr', 'xxd', 'gzip', 'gunzip', 'bzip2', 'bunzip2', 'tar', 'head',
  'tail', 'wc', 'mkdir', 'cp', 'mv', 'echo', 'whoami', 'hostname', 'clear',
  'reset', 'exit',
];

class Terminal {
  constructor(mountEl, level, opts) {
    this.mountEl = mountEl;
    this.level = level;
    this.opts = opts || {};

    this.shell = new Shell(vfsForLevel(level.from));

    this.mode = 'shell'; // 'boot' | 'shell' | 'password'
    this.line = '';
    this.sshTarget = null;
    this.sshAttempts = 0;
    this._draft = '';

    this._typingActive = false;
    this._skipTyping = false;
    this._typeTimer = null;
    this._destroyed = false;

    this._histAll = {};
    this.history = [];
    this.histPos = 0;
    this._loadHistory();

    // DOM refs (populated in mount())
    this.root = null;
    this.scrollEl = null;
    this.inputLineEl = null;
    this.promptEl = null;
    this.typedEl = null;
    this.cursorEl = null;
    this.inputEl = null;
  }

  /* ------------------------------------------------------------------
   * Mount / lifecycle
   * ------------------------------------------------------------------ */
  mount() {
    if (!this.mountEl) return;
    this.mountEl.innerHTML = '';

    this.root = document.createElement('div');
    this.root.className = 'term';

    this.scrollEl = document.createElement('div');
    this.scrollEl.className = 'term-scroll';

    this.inputLineEl = document.createElement('div');
    this.inputLineEl.className = 'term-inputline';

    this.promptEl = document.createElement('span');
    this.promptEl.className = 'term-prompt';

    this.typedEl = document.createElement('span');
    this.typedEl.className = 'term-typed';

    this.cursorEl = document.createElement('span');
    this.cursorEl.className = 'term-cursor';

    this.inputEl = document.createElement('input');
    this.inputEl.type = 'text';
    this.inputEl.className = 'term-hidden-input';
    this.inputEl.setAttribute('autocomplete', 'off');
    this.inputEl.setAttribute('autocapitalize', 'off');
    this.inputEl.setAttribute('autocorrect', 'off');
    this.inputEl.setAttribute('spellcheck', 'false');
    this.inputEl.setAttribute('aria-label', 'terminal input');

    this.inputLineEl.appendChild(this.promptEl);
    this.inputLineEl.appendChild(this.typedEl);
    this.inputLineEl.appendChild(this.cursorEl);
    this.inputLineEl.appendChild(this.inputEl);

    this.root.appendChild(this.scrollEl);
    this.root.appendChild(this.inputLineEl);
    this.mountEl.appendChild(this.root);

    this._bindEvents();

    this.mode = 'boot';
    this._renderInputLine();

    if (this.opts.showBanner) {
      this._playBanner(() => {
        this.mode = 'shell';
        this._renderInputLine();
        this.focus();
      });
    } else {
      this.mode = 'shell';
      this._renderInputLine();
      this.focus();
    }
  }

  focus() {
    if (this.inputEl) this.inputEl.focus();
  }

  destroy() {
    this._destroyed = true;
    if (this._typeTimer) {
      clearTimeout(this._typeTimer);
      this._typeTimer = null;
    }
    if (this.inputEl) {
      this.inputEl.removeEventListener('input', this._onInputHandler);
      this.inputEl.removeEventListener('keydown', this._onKeydownHandler);
    }
    if (this.root) {
      this.root.removeEventListener('click', this._onClickHandler);
    }
    if (this.mountEl) this.mountEl.innerHTML = '';
    this.root = null;
    this.scrollEl = null;
    this.inputLineEl = null;
    this.promptEl = null;
    this.typedEl = null;
    this.cursorEl = null;
    this.inputEl = null;
  }

  /* ------------------------------------------------------------------
   * Event wiring
   * ------------------------------------------------------------------ */
  _bindEvents() {
    this._onInputHandler = () => this._onInput();
    this._onKeydownHandler = (e) => this._onKeydown(e);
    this._onClickHandler = () => this.focus();

    this.inputEl.addEventListener('input', this._onInputHandler);
    this.inputEl.addEventListener('keydown', this._onKeydownHandler);
    this.root.addEventListener('click', this._onClickHandler);
  }

  _onInput() {
    this.line = this.inputEl.value;
    this._renderInputLine();
  }

  _onKeydown(e) {
    // Any keypress fast-forwards an in-progress typed animation (output
    // or the opening banner) rather than acting on it.
    if (this._typingActive) {
      this._skipTyping = true;
      e.preventDefault();
      return;
    }

    if (this.mode === 'boot') return; // banner not typing yet/already done; nothing to do

    if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      this._handleCtrlC();
      return;
    }
    if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      this.clearScrollback();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.mode === 'password') this._submitPassword();
      else this._submitLine();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (this.mode === 'shell') this._handleTab();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.mode === 'shell') this._historyUp();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.mode === 'shell') this._historyDown();
      return;
    }
  }

  /* ------------------------------------------------------------------
   * Rendering helpers
   * ------------------------------------------------------------------ */
  _currentPromptText() {
    if (this.mode === 'password') return 'bandit' + this.sshTarget + "@localhost's password: ";
    if (this.mode === 'boot') return '';
    return 'bandit' + this.level.from + '@bandit:~$ ';
  }

  _renderInputLine() {
    if (!this.promptEl) return;
    this.promptEl.textContent = this._currentPromptText();
    if (this.mode === 'password' || this.mode === 'boot') {
      this.typedEl.textContent = '';
    } else {
      this.typedEl.textContent = this.line;
    }
    this.cursorEl.style.visibility = this.mode === 'boot' ? 'hidden' : 'visible';
  }

  _appendLine(text, cls) {
    if (!this.scrollEl) return;
    const div = document.createElement('div');
    div.className = 'term-line' + (cls ? ' ' + cls : '');
    div.textContent = text;
    this.scrollEl.appendChild(div);
    this._scrollToBottom();
  }

  _scrollToBottom() {
    if (this.scrollEl) this.scrollEl.scrollTop = this.scrollEl.scrollHeight;
  }

  clearScrollback() {
    if (this.scrollEl) this.scrollEl.innerHTML = '';
  }

  /* ------------------------------------------------------------------
   * Typed / instant output emission.
   * ------------------------------------------------------------------ */
  _prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  _emit(text, cb, cls) {
    if (!text) {
      if (cb) cb();
      return;
    }
    let lines = text.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();

    if (this.opts.typed && !this._prefersReducedMotion()) {
      this._typeLines(lines, cb, cls);
    } else {
      lines.forEach((l) => this._appendLine(l, cls));
      if (cb) cb();
    }
  }

  _typeLines(lines, cb, cls) {
    let idx = 0;
    this._typingActive = true;
    this._skipTyping = false;
    const step = () => {
      if (this._destroyed) return;
      if (this._skipTyping) {
        for (; idx < lines.length; idx++) this._appendLine(lines[idx], cls);
        this._typingActive = false;
        this._typeTimer = null;
        if (cb) cb();
        return;
      }
      if (idx >= lines.length) {
        this._typingActive = false;
        this._typeTimer = null;
        if (cb) cb();
        return;
      }
      this._appendLine(lines[idx], cls);
      idx++;
      this._typeTimer = setTimeout(step, TERM_TYPE_DELAY_MS);
    };
    step();
  }

  /* ------------------------------------------------------------------
   * Opening banner.
   * ------------------------------------------------------------------ */
  _playBanner(done) {
    const text = [
      'Connecting to localhost (127.0.0.1) port 2220.',
      'SSH-2.0-OpenSSH_7.6p1 Ubuntu-4ubuntu0.3',
      'Welcome to Ubuntu 18.04.3 LTS (GNU/Linux 4.15.0-generic x86_64)',
      '',
      ' * OverTheWire Bandit -- https://overthewire.org/wargames/bandit',
      '',
    ].join('\n');
    this._emit(text, done);
  }

  /* ------------------------------------------------------------------
   * Command submission (normal shell mode).
   * ------------------------------------------------------------------ */
  _echoPromptLine(raw) {
    if (!this.scrollEl) return;
    const div = document.createElement('div');
    div.className = 'term-line';
    const p = document.createElement('span');
    p.className = 'term-prompt';
    p.textContent = this._currentPromptText();
    div.appendChild(p);
    div.appendChild(document.createTextNode(raw));
    this.scrollEl.appendChild(div);
    this._scrollToBottom();
  }

  _submitLine() {
    const raw = this.inputEl.value;
    this._echoPromptLine(raw);
    this.inputEl.value = '';
    this.line = '';

    if (raw.trim() !== '') {
      this.history.push(raw);
      this._persistHistory();
    }
    this.histPos = this.history.length;
    this._draft = '';

    const sshN = this._matchSSHTarget(raw);
    if (sshN !== null) {
      this._beginSSH(sshN);
      this._renderInputLine();
      return;
    }

    const result = this.shell.run(raw);
    this._processResult(result);
    this._renderInputLine();
  }

  _processResult(result) {
    let out = result.stdout || '';
    let didClear = false;
    let didExit = false;
    if (out.indexOf(TERM_CLEAR_SENTINEL) !== -1) {
      didClear = true;
      out = out.split(TERM_CLEAR_SENTINEL).join('');
    }
    if (out.indexOf(TERM_EXIT_SENTINEL) !== -1) {
      didExit = true;
      out = out.split(TERM_EXIT_SENTINEL).join('');
    }

    const finish = () => {
      if (didClear) this.clearScrollback();
      if (didExit) this._appendLine('logout');
      if (result.stderr) this._emit(result.stderr, null, 'term-err');
    };

    if (out) this._emit(out, finish);
    else finish();
  }

  /* ------------------------------------------------------------------
   * Ctrl+C / Ctrl+L
   * ------------------------------------------------------------------ */
  _handleCtrlC() {
    const shownText = this.mode === 'password' ? '' : this.line;
    this._echoPromptLine(shownText + '^C');
    this.inputEl.value = '';
    this.line = '';
    this.histPos = this.history.length;
    this._draft = '';
    if (this.mode === 'password') {
      this.mode = 'shell';
      this.sshTarget = null;
      this.sshAttempts = 0;
    }
    this._renderInputLine();
  }

  /* ------------------------------------------------------------------
   * History (persisted under bandit_termhist_v1, keyed by level.to).
   * ------------------------------------------------------------------ */
  _loadHistory() {
    let all = {};
    try {
      const raw = typeof store !== 'undefined' ? store.get(TERM_HIST_KEY) : null;
      all = raw ? JSON.parse(raw) : {};
      if (!all || typeof all !== 'object') all = {};
    } catch (e) {
      all = {};
    }
    this._histAll = all;
    const arr = this._histAll[this.level.to];
    this.history = Array.isArray(arr) ? arr.slice() : [];
    this.histPos = this.history.length;
  }

  _persistHistory() {
    this._histAll[this.level.to] = this.history;
    try {
      if (typeof store !== 'undefined') store.set(TERM_HIST_KEY, JSON.stringify(this._histAll));
    } catch (e) {
      /* soft-fail, mirrors store's own try/catch contract */
    }
  }

  _historyUp() {
    if (!this.history.length) return;
    if (this.histPos === this.history.length) this._draft = this.inputEl.value;
    if (this.histPos > 0) {
      this.histPos--;
      this._setLine(this.history[this.histPos]);
    }
  }

  _historyDown() {
    if (!this.history.length) return;
    if (this.histPos < this.history.length - 1) {
      this.histPos++;
      this._setLine(this.history[this.histPos]);
    } else if (this.histPos === this.history.length - 1) {
      this.histPos++;
      this._setLine(this._draft || '');
    }
  }

  _setLine(v) {
    this.inputEl.value = v;
    this.line = v;
    this._renderInputLine();
  }

  /* ------------------------------------------------------------------
   * Tab completion: first word against command names (falling back to
   * path entries so a bare filename like "read<TAB>" still completes),
   * later words always against path entries in the shell's cwd.
   * ------------------------------------------------------------------ */
  _commandNames() {
    if (this.shell && this.shell.cmds) return Object.keys(this.shell.cmds);
    return TERM_STATIC_CMDS.slice();
  }

  _pathCandidates(partial) {
    const fs = this.shell.fs;
    const slashIdx = partial.lastIndexOf('/');
    const dirPart = slashIdx >= 0 ? (partial.slice(0, slashIdx) || '/') : '.';
    const base = slashIdx >= 0 ? partial.slice(slashIdx + 1) : partial;
    const dirNode = nodeAt(fs, dirPart);
    if (!dirNode || dirNode.type !== 'dir') return [];
    return Object.keys(dirNode.entries).filter((n) => n.startsWith(base));
  }

  _completeToken(partial, name) {
    const slashIdx = partial.lastIndexOf('/');
    const dirPrefix = slashIdx >= 0 ? partial.slice(0, slashIdx + 1) : '';
    const dirPart = slashIdx >= 0 ? (partial.slice(0, slashIdx) || '/') : '.';
    const dirNode = nodeAt(this.shell.fs, dirPart);
    const child = dirNode && dirNode.type === 'dir' ? dirNode.entries[name] : null;
    const suffix = child && child.type === 'dir' ? '/' : '';
    return dirPrefix + name + suffix;
  }

  _commonPrefix(names) {
    if (!names.length) return '';
    let prefix = names[0];
    for (let i = 1; i < names.length && prefix; i++) {
      let j = 0;
      while (j < prefix.length && j < names[i].length && prefix[j] === names[i][j]) j++;
      prefix = prefix.slice(0, j);
    }
    return prefix;
  }

  _handleTab() {
    const line = this.inputEl.value;
    const words = line.split(' ');
    const wordIdx = words.length - 1;
    const partial = words[wordIdx];

    let candidates;
    if (wordIdx === 0) {
      candidates = this._commandNames().filter((c) => c.startsWith(partial));
      if (!candidates.length) candidates = this._pathCandidates(partial);
    } else {
      candidates = this._pathCandidates(partial);
    }
    if (!candidates.length) return;

    if (candidates.length === 1) {
      words[wordIdx] = this._completeToken(partial, candidates[0]);
      const newLine = words.join(' ');
      this.inputEl.value = newLine;
      this.line = newLine;
      this._renderInputLine();
      return;
    }

    // Multiple matches: list them, then complete the common prefix (if any).
    this._appendLine(candidates.slice().sort().join('  '));
    const common = this._commonPrefix(candidates);
    if (common.length > partial.length) {
      const slashIdx = partial.lastIndexOf('/');
      const dirPrefix = slashIdx >= 0 ? partial.slice(0, slashIdx + 1) : '';
      words[wordIdx] = dirPrefix + common;
      const newLine = words.join(' ');
      this.inputEl.value = newLine;
      this.line = newLine;
    }
    this._renderInputLine();
  }

  /* ------------------------------------------------------------------
   * SSH advance flow.
   * ------------------------------------------------------------------ */
  _matchSSHTarget(raw) {
    const tokens = raw.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length || tokens[0] !== 'ssh') return null;
    for (let i = 1; i < tokens.length; i++) {
      const m = /^bandit(\d+)@(localhost|bandit)$/.exec(tokens[i]);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  }

  _beginSSH(n) {
    this.mode = 'password';
    this.sshTarget = n;
    this.sshAttempts = 0;
  }

  _echoMaskedLine() {
    if (!this.scrollEl) return;
    const div = document.createElement('div');
    div.className = 'term-line';
    const p = document.createElement('span');
    p.className = 'term-prompt';
    p.textContent = this._currentPromptText();
    div.appendChild(p);
    this.scrollEl.appendChild(div);
    this._scrollToBottom();
  }

  _submitPassword() {
    const pw = this.inputEl.value;
    this.inputEl.value = '';
    this.line = '';
    this._echoMaskedLine();
    this.sshAttempts++;

    const target = this.sshTarget;
    if (target === this.level.to && pw === FAKE_PW[this.level.to]) {
      this.mode = 'shell';
      this.sshTarget = null;
      this.sshAttempts = 0;
      // Fire onCapture immediately (progress/sidebar can update right away),
      // but only fire onCaptureComplete once the motd has fully finished
      // typing — callers must not tear down/replace this terminal before
      // that, or the success banner gets truncated mid-animation.
      if (typeof this.opts.onCapture === 'function') this.opts.onCapture(target);
      // NOTE: when typed animation is off (reduced-motion / opts.typed false), _emit
      // runs its callback SYNCHRONOUSLY — so onCaptureComplete (and any advanceTo it
      // triggers) fires same-tick, BEFORE the trailing this._renderInputLine() at the
      // bottom of this method. Harmless today (that final render just re-paints the
      // already-advanced prompt), but don't add logic here that assumes the motd/advance
      // has NOT happened yet by the time we reach the end of _submitPassword.
      this._printSSHSuccess(() => {
        if (!this._destroyed && typeof this.opts.onCaptureComplete === 'function') {
          this.opts.onCaptureComplete(target);
        }
      });
    } else if (this.sshAttempts >= 3) {
      this._appendLine('Too many authentication failures.', 'term-err');
      this.mode = 'shell';
      this.sshTarget = null;
      this.sshAttempts = 0;
    } else {
      this._appendLine('Permission denied, please try again.', 'term-err');
    }
    this._renderInputLine();
  }

  _printSSHSuccess(cb) {
    const text = [
      'Welcome to Ubuntu 18.04.3 LTS (GNU/Linux 4.15.0-generic x86_64)',
      '',
      ' * OverTheWire Bandit -- https://overthewire.org/wargames/bandit',
      '',
      'Last login: ' + new Date().toUTCString() + ' from bandit.labs.overthewire.org',
    ].join('\n');
    this._emit(text, cb, 'term-ok');
  }

  /* ------------------------------------------------------------------
   * Advance the SAME session to the next level in place (authentic
   * OverTheWire flow: no reconnect, no DOM teardown). Call only after
   * the SSH-success motd has finished typing (see onCaptureComplete).
   * Keeps existing scrollback; swaps the shell/vfs and prompt so the
   * user lands at the next level's prompt as the new user.
   * ------------------------------------------------------------------ */
  advanceTo(nextLevel) {
    if (this._destroyed || !nextLevel) return;
    this._appendLine('');
    this.level = nextLevel;
    this.shell = new Shell(vfsForLevel(nextLevel.from));
    this.mode = 'shell';
    this.sshTarget = null;
    this.sshAttempts = 0;
    this._loadHistory();
    this._renderInputLine();
    this.focus();
  }
}
