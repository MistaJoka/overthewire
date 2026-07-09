'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { Terminal } = require('../js/term.js');

// _matchSSHTarget is a pure method — exercise it without constructing (no DOM).
const match = (raw) => Terminal.prototype._matchSSHTarget.call({}, raw);

test('ssh matcher: terminal-native form bandit{n}@localhost', () => {
  assert.deepStrictEqual(match('ssh bandit1@localhost'), { n: 1, host: 'localhost' });
});

test('ssh matcher: the EXACT command the guide shows a copy button for', () => {
  // data.js sshPw(n) => `ssh -p 2220 bandit{n}@bandit.labs.overthewire.org`
  assert.deepStrictEqual(
    match('ssh -p 2220 bandit8@bandit.labs.overthewire.org'),
    { n: 8, host: 'bandit.labs.overthewire.org' });
});

test('ssh matcher: @bandit short host and -i key flag are tolerated', () => {
  assert.deepStrictEqual(match('ssh bandit3@bandit'), { n: 3, host: 'bandit' });
  assert.deepStrictEqual(
    match('ssh -i key -p 2220 bandit14@localhost'),
    { n: 14, host: 'localhost' });
});

test('ssh matcher: non-ssh / non-bandit lines do not match', () => {
  assert.strictEqual(match('ls -la'), null);
  assert.strictEqual(match('ssh root@example.com'), null);
  assert.strictEqual(match('cat ssh'), null);
  assert.strictEqual(match(''), null);
});
