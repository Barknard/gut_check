// Runs every test. `npm test`. Exits non-zero if anything fails.
const { summary } = require('./helpers');

(async () => {
  const only = process.argv[2];
  for (const name of ['unit', 'apps-script', 'e2e']) {
    if (only && only !== name) continue;
    try { await require(`./${name}.test.js`)(); }
    catch (e) { console.log(`  ✗ ${name} crashed: ${e.stack || e}`); require('./helpers').check(`${name} ran`, false); }
  }
  const { passed, failed } = summary();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
