// Statistics used by "Did you know?", and release bookkeeping. Runs in plain Node.
const fs = require('fs'), path = require('path');
const { check, ROOT } = require('./helpers');

module.exports = async function unit() {
  console.log('Statistics');
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const block = src.slice(src.indexOf('const ST = (() => {'), src.indexOf('function didYouKnow'));
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN; // used inside the block
  const ST = eval(block.replace('const ST = ', '(').replace(/;\s*$/, ')'));
  const near = (got, want, tol) => Math.abs(got - want) <= tol;
  // reference values: standard tables, and hand-worked examples
  check('t-test p, t=2.228 df=10 → 0.05', near(ST.tP(2.228, 10), .05, .001));
  check('t-test p, t=2.0 df=30 → 0.0546', near(ST.tP(2.0, 30), .0546, .001));
  check('normal p, z=1.96 → 0.05', near(ST.zP(1.96), .05, .001));
  check('chi-square p, 3.841 df=1 → 0.05', near(ST.gammq(.5, 3.841 / 2), .05, .001));
  check('chi-square p, 11.07 df=5 → 0.05', near(ST.gammq(2.5, 11.07 / 2), .05, .001));
  check('Fisher exact, tea-tasting table → 0.00276', near(ST.fisher(1, 9, 11, 3), .002759, .0002));
  check('Fisher exact, [[3,1],[1,3]] → 0.486', near(ST.fisher(3, 1, 1, 3), .4857, .001));
  check('Welch t-test, worked example → 0.040', near(ST.welch([1, 2, 3, 4, 5], [3, 4, 5, 6, 7, 8]), .0398, .002));
  check('Mann-Whitney with ties, worked example → 0.0051', near(ST.mannWhitney([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]), .0051, .0005));
  const r = ST.slope([1, 2, 3, 4, 5, 6, 7, 8], [2.1, 3.9, 6.2, 7.8, 10.1, 12.2, 13.8, 16.1]);
  check('regression slope ≈ 2 and clearly significant', near(r.b, 2, .05) && r.p < 1e-6);
  check('identical groups → p = 1', near(ST.welch([1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]), 1, 1e-9));
  check('no spread, different means → extremely significant', ST.welch([1, 1, 1, 1], [3, 3, 3, 3]) < 1e-9);
  check('no spread, same means → p = 1', ST.welch([2, 2, 2], [2, 2, 2]) === 1);

  console.log('Release');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const v = sw.match(/const VERSION = '(\w+)'/)[1];
  check(`index.html loads app.js and styles.css at version ${v} (same as sw.js)`, html.includes(`app.js?v=${v}"`) && html.includes(`styles.css?v=${v}"`));
  check('every file the offline cache needs exists', [...sw.matchAll(/'([^']+\.(?:png|svg|webmanifest|gs|html))(?:\?v=\w+)?'/g)].every(m => fs.existsSync(path.join(ROOT, m[1]))));
  check('no inline event handlers (blocked by the security policy)', !/\son[a-z]+="/i.test(html));
  check('security policy present', html.includes('Content-Security-Policy'));
};
