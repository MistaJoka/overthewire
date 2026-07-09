const test = require('node:test');
const assert = require('node:assert');
const { vfsForLevel } = require('../js/vfs.js');

test('vfs module loads and returns an object', () => {
  const fs = vfsForLevel(0);
  assert.strictEqual(typeof fs, 'object');
});
