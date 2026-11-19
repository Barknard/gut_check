// End-to-end: the real app in a phone-sized Chromium, with Google and the phone's file picker simulated.
const { chromium, devices } = require('playwright');
const { serve, check } = require('./helpers');

const HEAD = ['id', 'timestamp', 'date', 'time', 'weekday', 'event', 'bristol_type', 'bristol_description'];
const WEB = 'https://script.google.com/macros/s/AKfycbx_TEST/exec';

// A stand-in for the Apps Script web app (same protocol as google-sheet/Code.gs).
function fakeSheet() {
  const s = { rows: [], ver: 0, key: null, down: false };
  s.route = async page => page.route('https://script.google.com/**', async route => {
    if (s.down) return route.abort();
    const r = route.request(), u = new URL(r.url());
    const json = o => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
    if (r.method() === 'GET' && u.searchParams.get('claim')) {
      if (s.key) return json({ ok: false, claimed: true, error: 'This Sheet is already connected.' });
      s.key = 'ab12'.repeat(16); // real keys are 64 hex characters
      s.rows = [HEAD]; return json({ ok: true, key: s.key, sheetUrl: 'https://docs.google.com/spreadsheets/d/TEST' });
    }
    if (r.method() === 'GET') return json(u.searchParams.get('key') === s.key ? { ok: true, ver: s.ver, rows: s.rows } : { ok: false, error: 'bad key' });
    const b = JSON.parse(r.postData());
    if (r.headers()['content-type'] !== 'text/plain;charset=utf-8') return json({ ok: false, error: 'must be text/plain (no CORS preflight)' });
    if (b.key !== s.key) return json({ ok: false, error: 'bad key' });
    if (b.ver !== s.ver) return json({ ok: false, conflict: true, ver: s.ver });
    s.rows = b.rows; s.ver++; return json({ ok: true, ver: s.ver });
  });
  s.count = () => Math.max(0, s.rows.length - 1);
  return s;
}
// A stand-in for a file the person picked on the phone (File System Access API).
const FAKE_FILE = `(() => { const bytes = { d: new Uint8Array(0) }; window.__file = bytes; window.__perm = 'granted';
  const h = { name: 'gut-check.csv', async getFile() { return new File([bytes.d], 'gut-check.csv'); },
    async queryPermission() { return window.__perm; }, async requestPermission() { window.__perm = 'granted'; return 'granted'; },
    async createWritable() { const parts = []; return { async write(x) { parts.push(x); }, async close() { bytes.d = new Uint8Array(await new Blob(parts).arrayBuffer()); } }; } };
  window.showSaveFilePicker = async () => h; window.showOpenFilePicker = async () => [h]; })()`;
const NO_FILE_API = '(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; })()';

const entries = p => p.evaluate(() => JSON.parse(localStorage.getItem('gl.snapshot') || '[]'));
const screen = p => p.$eval('.wz-screen:not([hidden])', e => e.dataset.s).catch(() => null);
const wait = ms => new Promise(r => setTimeout(r, ms));

module.exports = async function e2e() {
  const { srv, url } = await serve();
  const browser = await chromium.launch();
  const problems = []; // page errors and security-policy violations, from every page
  const page = async (opts = {}, init = null, sheet = null) => {
    const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block', ...opts });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url.slice(0, -1) }).catch(() => {});
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    p.on('pageerror', e => problems.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text()); });
    if (sheet) await sheet.route(p);
    return p;
  };
  try {
    console.log('First visit');
    let p = await page();
    await p.goto(url); await wait(800);
    check('setup wizard opens by itself on a first visit', await p.isVisible('#wizDlg') && await screen(p) === 'welcome');
    await p.click('[data-s=welcome] [data-close]'); await p.reload(); await wait(700);
    check('after "Not now" it does not open again', !(await p.isVisible('#wizDlg')));
    check('badge warns it is only on this phone', (await p.textContent('#syncText')) === 'Only on phone');

    console.log('Logging');
    await p.click('.act-imod'); await wait(200);
    check('one tap logs Imodium', (await entries(p)).some(e => e.ev === 'imodium'));
    await p.click('.act-poop'); await wait(900);
    check('Poop opens the 7 Bristol types', (await p.$$('.b-opt')).length === 7 && await p.isVisible('#picker'));
    await p.click('.b-opt[data-b="4"]'); await p.click('.b-opt[data-b="2"]', { force: true }); await wait(1300);
    const e1 = await entries(p);
    check('choosing type 4 logs it once (a quick second tap is ignored) and returns home', e1.filter(e => e.ev === 'poop').length === 1 && e1.find(e => e.ev === 'poop').b === 4 && await p.isVisible('#actions'));
    await p.click('.act-gasx'); await p.click('#toastUndo'); await wait(200);
    check('Undo removes the last entry', !(await entries(p)).some(e => e.ev === 'gasx'));
    await p.click('[data-tab=history]'); await wait(300);
    const before = (await entries(p)).length;
    await p.click('.row [data-del]'); await p.click('.row [data-del]'); await wait(200);
    check('History: tapping delete twice removes an entry', (await entries(p)).length === before - 1);
    await p.click('#toastUndo'); await wait(200);
    check('History: Undo brings it back', (await entries(p)).length === before);

    console.log('Google Sheet');
    const sheet = fakeSheet();
    p = await page({}, NO_FILE_API, sheet);
    await p.goto(url); await wait(700);
    await p.click('[data-s=welcome] [data-go=choose]'); await p.click('[data-s=choose] [data-go=g1]');
    for (const id of ['g1', 'g2', 'g3', 'g4', 'g5']) await p.click(`[data-s=${id}] .wz-next`);
    await p.fill('#gsLink', 'not a link'); await p.click('#gsConnect');
    check('a wrong paste gets a friendly hint', /not the link/i.test(await p.textContent('#gsMsg')));
    await p.fill('#gsLink', `Here: ${WEB} `); await p.click('#gsConnect'); await wait(1500);
    check('pasting the Web app link creates and connects the Sheet', sheet.key && await screen(p) === 'done');
    await p.click('[data-s=done] .big-go');
    await p.click('.act-vomit'); await wait(1800);
    check('a tap is saved to the Sheet', sheet.rows.some(r => r[5] === 'Vomit'));
    check('badge says 2 places', (await p.textContent('#syncText')) === 'Saved in 2 places');
    sheet.rows.push(['other1', '2026-11-17T10:00:00-05:00', '2026-11-17', '10:00', 'Tue', 'Gas-X', '', '']); sheet.ver++;
    await p.click('.act-imod'); await wait(1800);
    check('another phone saving at the same time is merged, not overwritten', sheet.rows.some(r => r[0] === 'other1') && (await entries(p)).some(e => e.id === 'other1'));
    sheet.down = true; await p.click('.act-gasx'); await wait(1800);
    check('offline: badge says not backed up, entry kept on the phone', (await p.textContent('#syncText')) === 'Not backed up' && (await entries(p)).some(e => e.ev === 'gasx'));
    sheet.down = false; await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await wait(1500);
    check('back online: the missed entry reaches the Sheet', sheet.rows.some(r => r[5] === 'Gas-X' && r[0] !== 'other1'));
    const q = await page({}, NO_FILE_API, sheet);
    q.on('dialog', dlg => dlg.accept().catch(() => {})); // "Connect Gut Check to your Google Sheet?"
    await q.goto(`${url}#gsheet=${encodeURIComponent(WEB)}&key=${sheet.key}`); await wait(1800);
    check('a second phone connects with the Connect-tab link and gets the whole log', (await entries(q)).length === sheet.count());

    console.log('File on the phone');
    const f = await page({}, FAKE_FILE);
    await f.goto(url); await wait(600); await f.click('[data-s=welcome] [data-close]');
    await f.click('.act-imod'); await f.click('#settingsBtn'); await f.click('#openWizard'); await f.click('[data-s=choose] [data-go=file]');
    await f.click('#devNew'); await wait(600);
    const fileRows = () => f.evaluate(() => new TextDecoder().decode(window.__file.d).trim().split('\n').length - 1);
    check('linking a file writes the log into it', await fileRows() === 1 && await screen(f) === 'done');
    await f.click('[data-s=done] .big-go'); await f.click('.act-vomit'); await wait(1800);
    check('each tap is written to the file', await fileRows() === 2);

    console.log('Did you know?');
    const d = await page();
    await d.goto(url); await d.evaluate(() => { const now = Date.now(), list = [];
      for (let k = 21; k >= 1; k--) { const base = new Date(now - k * 864e5).setHours(0, 0, 0, 0), imod = k % 2 === 0;
        if (imod) list.push({ id: 'i' + k, ts: base + 8 * 36e5, ev: 'imodium', b: null });
        for (let j = 0; j < (imod ? 1 : 3); j++) list.push({ id: `p${k}_${j}`, ts: base + (9 + j * 4) * 36e5, ev: 'poop', b: imod ? 2 + (k % 3 === 0 ? 1 : 0) : 6 + (k % 3 === 0 ? 1 : 0) }); }
      localStorage.setItem('gl.snapshot', JSON.stringify(list)); localStorage.setItem('gl.outbox', '{}'); localStorage.setItem('gl.seen', 'true'); });
    await d.reload(); await wait(700);
    const facts = [];
    for (let k = 0; k < 4; k++) { facts.push(await d.textContent('#dyk')); if (await d.$('.dyk-next')) await d.click('.dyk-next'); }
    check('after a week, the strongest pattern is shown with its p-value', /p < 0\.001/.test(facts[0]) && /after checking \d+ patterns/.test(facts[0]));
    check('Next shows the other reliable patterns, including the Imodium effect', facts.some(t => /firmer in the 24 hours after Imodium/.test(t)) && facts.some(t => /On days she takes Imodium/.test(t)));

    console.log('Files');
    await d.click('#settingsBtn');
    const [dl] = await Promise.all([d.waitForEvent('download'), d.click('#expXlsx')]);
    const buf = require('fs').readFileSync(await dl.path());
    check('Download Excel produces a real .xlsx file', dl.suggestedFilename().endsWith('.xlsx') && buf[0] === 0x50 && buf[1] === 0x4b);
    const fresh = await page();
    await fresh.goto(url); await fresh.click('[data-s=welcome] [data-close]'); await fresh.click('#settingsBtn');
    await fresh.setInputFiles('#impFile', { name: 'log.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: buf });
    await wait(1200);
    check('importing that Excel file brings every entry back', (await entries(fresh)).length === (await entries(d)).length);

    console.log('Reset');
    const sheet2 = fakeSheet(); const rp = await page({}, NO_FILE_API, sheet2);
    rp.on('dialog', x => x.accept().catch(() => {}));
    await rp.goto(url); await wait(500); await rp.click('[data-s=welcome] [data-close]');
    await rp.click('.act-imod'); await rp.click('#settingsBtn'); await rp.click('#openWizard'); await rp.click('[data-s=choose] [data-go=g1]');
    for (const id of ['g1', 'g2', 'g3', 'g4', 'g5']) await rp.click(`[data-s=${id}] .wz-next`);
    await rp.fill('#gsLink', WEB); await rp.click('#gsConnect'); await wait(1500); await rp.click('[data-s=done] .big-go'); await wait(500);
    sheet2.down = true;
    await rp.click('#settingsBtn'); await rp.click('#wipeOpen'); await rp.check('#wipeAlso'); await rp.click('#wipeGo'); await wait(1500);
    check('reset with the Sheet unreachable: nothing is reset and entries are kept', /nothing was reset/.test(await rp.textContent('#wipeMsg')) && (await entries(rp)).length === 1);
    sheet2.down = false; await rp.click('#wipeGo'); await wait(2500);
    check('reset with the box ticked empties the Sheet and starts the app like new', sheet2.count() === 0 && (await entries(rp)).length === 0 && await rp.isVisible('#wizDlg'));

    console.log('Robustness');
    const full = await page({}, `(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'gl.snapshot' && window.__full) throw new DOMException('full', 'QuotaExceededError'); return set.call(this, k, v); }; })()`);
    await full.goto(url); await full.click('[data-s=welcome] [data-close]'); await full.evaluate(() => { window.__full = true; });
    await full.click('.act-imod'); await wait(300);
    check('phone storage full: a clear warning appears', /storage is full/.test(await full.textContent('#banner')));
    const rm = await page({ reducedMotion: 'reduce' });
    await rm.goto(url); await rm.click('[data-s=welcome] [data-close]');
    const box = await rm.locator('.act-gasx').boundingBox(); await rm.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await rm.mouse.down(); await rm.mouse.up(); await wait(200);
    check('"reduce motion": no tilt or ripples, and logging still works', await rm.$$eval('.ripple', e => e.length) === 0 && (await entries(rm)).some(e => e.ev === 'gasx'));

    console.log('Offline');
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const op = await ctx.newPage(); op.on('pageerror', e => problems.push(e.message));
    await op.goto(url); await op.evaluate(() => navigator.serviceWorker.ready); await op.reload(); await wait(500);
    await ctx.setOffline(true); await op.reload(); await wait(800);
    check('opens with no internet (service worker)', await op.isVisible('.act-poop') && (await op.title()) === 'Gut Check');
    await op.click('[data-s=welcome] [data-close]').catch(() => {}); await op.click('.act-imod'); await wait(200);
    check('and logging works offline', (await entries(op)).some(e => e.ev === 'imodium'));
    await ctx.close();

    check('no script errors or security-policy violations on any page', problems.length === 0, problems.slice(0, 3).join(' | '));
  } finally {
    await browser.close(); srv.close();
  }
};
