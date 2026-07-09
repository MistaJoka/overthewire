/* Virtual filesystem for Bandit levels 0-12. Dual-target: browser global + Node export. */
const FAKE_PW = {}; // filled in Task 3

function vfsForLevel(n) { return { n }; } // stub, replaced in Task 3

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FAKE_PW, vfsForLevel };
}
