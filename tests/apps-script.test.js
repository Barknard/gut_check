// google-sheet/Code.gs, run against an in-memory stand-in for Google's services.
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const { check, ROOT } = require('./helpers');

function fakeGoogle() {
  const files = {}; let created = 0; const props = {}; let logged = '';
  const mkSheet = name => { const cells = []; return { name, cells, setName(n) { this.name = n; },
    getLastRow: () => { let n = cells.length; while (n && cells[n - 1].every(c => c === '')) n--; return n; },
    getRange(r, c, nr = 1, nc = 1) { if (typeof r === 'string') { r = +r.slice(1); c = 1; } return {
      setNumberFormat() { return this; }, setFontWeight() { return this; },
      setValues(v) { for (let i = 0; i < nr; i++) { cells[r - 1 + i] = cells[r - 1 + i] || Array(8).fill(''); for (let j = 0; j < nc; j++) cells[r - 1 + i][c - 1 + j] = v[i][j]; } return this; },
      setValue(v) { cells[r - 1] = cells[r - 1] || Array(8).fill(''); cells[r - 1][0] = v; return this; },
      getDisplayValues() { return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => String((cells[r - 1 + i] || [])[c - 1 + j] ?? ''))); },
      clearContent() { for (let i = 0; i < nr; i++) if (cells[r - 1 + i]) for (let j = 0; j < nc; j++) cells[r - 1 + i][c - 1 + j] = ''; return this; } }; },
    setFrozenRows() {}, clear() { cells.length = 0; }, setColumnWidth() {} }; };
  const mkSS = name => { const id = 'ss' + (++created), tabs = [mkSheet('Sheet1')];
    const ss = { id, tabs, getId: () => id, getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id, getSheets: () => tabs,
      getSheetByName: n => tabs.find(t => t.name === n) || null, insertSheet(n, i) { const t = mkSheet(n); i === 0 ? tabs.unshift(t) : tabs.push(t); return t; } };
    files[id] = ss; return ss; };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => null, create: mkSS, openById: id => { if (!files[id]) throw new Error('gone'); return files[id]; }, getUi: () => { throw new Error('no UI'); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, Utilities: { getUuid: () => crypto.randomUUID() },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType() { return JSON.parse(t); } }) },
    HtmlService: { createHtmlOutput: h => ({ html: h }) }, ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/ABC/exec' }) },
    Logger: { log: m => { logged = m; } },
  };
  return { ctx, files, props, count: () => created, logged: () => logged };
}

module.exports = async function appsScript() {
  console.log('Google Sheet script');
  const g = fakeGoogle();
  vm.createContext(g.ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'google-sheet/Code.gs'), 'utf8'), g.ctx);
  const G = g.ctx, get = p => G.doGet({ parameter: p }), post = b => G.doPost({ postData: { contents: JSON.stringify(b) } });
  check('a made-up key is refused and does not block the real setup', !get({ key: 'x' }).ok && !g.props.key);
  const c = get({ claim: '1' });
  check('first connection creates one Sheet and a 64-character key', c.ok && c.key.length === 64 && g.count() === 1);
  check('the Sheet has a Log tab and a Connect tab', g.files.ss1.tabs.map(t => t.name).join() === 'Log,Connect');
  check('a second claim is refused', !get({ claim: '1' }).ok);
  const link = g.files.ss1.getSheetByName('Connect').cells[1][0];
  check('the Connect tab holds a working connection link', link.includes('#gsheet=') && link.endsWith('&key=' + c.key));
  const key = c.key, head = ['id', 'timestamp', 'date', 'time', 'weekday', 'event', 'bristol_type', 'bristol_description'];
  check('reads an empty log (header only)', JSON.stringify(get({ key }).rows) === JSON.stringify([head]));
  const w = post({ key, ver: 0, rows: [head, ['a1', '2026-11-18T08:12:00-05:00', '2026-11-18', '08:12', 'Wed', 'Poop', '4', 'x, "quoted"']] });
  check('writes rows and bumps the version', w.ok && w.ver === 1);
  check('reads back exactly what was written', get({ key }).rows[1][7] === 'x, "quoted"');
  check('a stale write (another phone saved first) is refused as a conflict', post({ key, ver: 0, rows: [head] }).conflict === true);
  check('shrinking the log removes the extra rows', post({ key, ver: 1, rows: [head] }).ok && get({ key }).rows.length === 1);
  check('an empty write is refused', !post({ key, ver: 2, rows: [] }).ok);
  G.newConnectionLink();
  check('a new connection link cancels the old one', !get({ key }).ok && g.count() === 1 && g.logged().includes('connection link'));
};
