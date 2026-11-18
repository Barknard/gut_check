/**
 * Gut Check ⇄ Google Sheet
 *
 * Lets the Gut Check app save its log into this Google Sheet. Setup (on a computer is easiest):
 *   1. In the Sheet: Extensions → Apps Script. Delete what's there, paste all of this, press Save.
 *   2. Deploy → New deployment → gear icon → Web app.
 *      Execute as: Me.  Who has access: Anyone.  Press Deploy, then Authorize access.
 *      Google warns "Google hasn't verified this app" because the script is yours, not a store app:
 *      press Advanced → Go to Gut Check (unsafe) → Allow.
 *   3. Reload the Sheet. Use the new menu Gut Check → Get connection link, and paste that link into
 *      the app (Settings → Set up saving & backups → Back up online).
 *
 * Only someone holding the connection link (it contains a secret key) can read or change the log.
 * Only people who can edit this Sheet can see that link. Gut Check → Make a new connection link
 * replaces the key if the old link was ever shared by mistake.
 */
const APP_URL = 'https://barknard.github.io/gut_check/';
const LOG_TAB = 'Log';
const HEAD = ['id', 'timestamp', 'date', 'time', 'weekday', 'event', 'bristol_type', 'bristol_description'];

/* ---------- menu in the Sheet ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Gut Check')
    .addItem('Get connection link', 'showConnectionLink')
    .addItem('Make a new connection link', 'newConnectionLink')
    .addToUi();
}
function showConnectionLink() {
  const url = ScriptApp.getService().getUrl();
  if (!url) {
    SpreadsheetApp.getUi().alert('Deploy this script first: Extensions → Apps Script → Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).');
    return;
  }
  logSheet_();
  const link = APP_URL + '#gsheet=' + encodeURIComponent(url) + '&key=' + key_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tab = ss.getSheetByName('Connect') || ss.insertSheet('Connect');
  tab.clear();
  tab.getRange('A1').setValue('Gut Check connection link: paste it into the app. Keep it private; anyone with it can read the log.');
  tab.getRange('A2').setValue(link);
  tab.setColumnWidth(1, 900);
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const html = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.45 system-ui,sans-serif">' +
    '<p>Copy this link and paste it into Gut Check → Settings → <b>Set up saving &amp; backups</b> → Back up online.</p>' +
    '<textarea id="l" readonly style="width:100%;height:84px;font:12px monospace">' + esc(link) + '</textarea>' +
    '<p><button onclick="var t=document.getElementById(\'l\');t.select();document.execCommand(\'copy\');this.textContent=\'Copied ✓\'">Copy link</button> ' +
    '<a target="_blank" href="mailto:?subject=' + encodeURIComponent('Gut Check connection link') + '&body=' + encodeURIComponent(link) + '">Email it to myself</a></p>' +
    '<p style="color:#666">It is also saved in the <b>Connect</b> tab, so the Google Sheets app on a phone can copy it later.</p></div>'
  ).setWidth(560).setHeight(320);
  SpreadsheetApp.getUi().showModalDialog(html, 'Gut Check connection link');
}
function newConnectionLink() {
  props_().deleteProperty('key');
  showConnectionLink();
}

/* ---------- web app used by Gut Check ---------- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!p.key) return HtmlService.createHtmlOutput('Gut Check is connected to this Sheet. Use the <b>Gut Check</b> menu in the Sheet to get the connection link.');
  return json_(guard_(p.key, function () { return { ok: true, ver: ver_(), rows: read_() }; }));
}
function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  return json_(guard_(b.key, function () {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      // someone else saved since this phone read the Sheet: tell it to re-read and merge
      if (b.ver !== null && b.ver !== undefined && Number(b.ver) !== ver_()) return { ok: false, conflict: true, ver: ver_() };
      write_(b.rows);
      const v = ver_() + 1;
      props_().setProperty('ver', String(v));
      return { ok: true, ver: v };
    } finally { lock.releaseLock(); }
  }));
}

/* ---------- helpers ---------- */
function guard_(key, fn) {
  if (!key || key !== key_()) return { ok: false, error: 'This connection link is no longer valid. Get a new one from the Sheet: Gut Check → Get connection link.' };
  try { return fn(); } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
}
function props_() { return PropertiesService.getScriptProperties(); }
function key_() {
  let k = props_().getProperty('key');
  if (!k) { k = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); props_().setProperty('key', k); }
  return k;
}
function ver_() { return Number(props_().getProperty('ver') || 0); }
function logSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(LOG_TAB, 0);
    sh.getRange(1, 1, 1, HEAD.length).setNumberFormat('@').setValues([HEAD]);
  }
  return sh;
}
function read_() {
  const sh = logSheet_(), n = sh.getLastRow();
  return n ? sh.getRange(1, 1, n, HEAD.length).getDisplayValues() : [];
}
function write_(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Nothing to write');
  const sh = logSheet_(), w = HEAD.length;
  rows = rows.map(function (r) { return HEAD.map(function (_, i) { return r[i] === null || r[i] === undefined ? '' : String(r[i]); }); });
  const last = sh.getLastRow();
  if (last > rows.length) sh.getRange(rows.length + 1, 1, last - rows.length, w).clearContent();
  sh.getRange(1, 1, rows.length, w).setNumberFormat('@').setValues(rows); // stored as plain text, exactly as sent
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, w).setFontWeight('bold');
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
