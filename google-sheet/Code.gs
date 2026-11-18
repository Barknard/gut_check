/**
 * Gut Check ⇄ Google Sheet
 *
 * Lets the Gut Check app save its log into a Google Sheet in your Google Drive.
 * Works from a phone browser or a computer. No Sheet is needed beforehand:
 *   1. Open https://script.new (Apps Script). Delete what's there, paste all of this, press Save.
 *   2. Deploy → New deployment → gear icon → Web app.
 *      Execute as: Me.  Who has access: Anyone.  Press Deploy, then Authorize access.
 *      Google warns "Google hasn't verified this app" because the script is yours, not a store app:
 *      press Advanced → Go to … (unsafe) → Allow.
 *   3. Copy the "Web app" URL it shows and paste it into Gut Check.
 *      The first time Gut Check connects, this script creates a Sheet called "Gut Check log" in your
 *      Drive and a secret key, then locks itself to that key. Nobody else can claim it afterwards.
 *
 * Another phone: open the "Gut Check log" Sheet (the Google Sheets app is fine), go to the
 * Connect tab, copy the link in A2 and paste it into Gut Check on that phone.
 * Link shared by mistake? In this editor, pick newConnectionLink in the function list and press Run.
 * That makes a new link (in the Connect tab) and the old one stops working.
 *
 * Also works if pasted into a Sheet's own Extensions → Apps Script: then it uses that Sheet.
 */
const APP_URL = 'https://barknard.github.io/gut_check/';
const SHEET_NAME = 'Gut Check log';
const LOG_TAB = 'Log';
const HEAD = ['id', 'timestamp', 'date', 'time', 'weekday', 'event', 'bristol_type', 'bristol_description'];

/* ---------- web app used by Gut Check ---------- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.claim) return json_(withLock_(claim_));
  if (!p.key) return HtmlService.createHtmlOutput('<p style="font:16px system-ui">✓ The Gut Check helper is running. Copy this page\'s address and paste it into the Gut Check app.</p>');
  return json_(guard_(p.key, function () { return { ok: true, ver: ver_(), rows: read_() }; }));
}
function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  return json_(guard_(b.key, function () {
    return withLock_(function () {
      // someone else saved since this phone read the Sheet: tell it to re-read and merge
      if (b.ver !== null && b.ver !== undefined && Number(b.ver) !== ver_()) return { ok: false, conflict: true, ver: ver_() };
      write_(b.rows);
      const v = ver_() + 1;
      props_().setProperty('ver', String(v));
      return { ok: true, ver: v };
    });
  }));
}

// First connection only: create the Sheet and the secret key, and hand the key to that one phone.
function claim_() {
  if (props_().getProperty('key')) {
    return { ok: false, claimed: true, error: 'This Sheet is already connected. To connect another phone, open the “' + SHEET_NAME + '” Sheet, go to the Connect tab, and copy the link in A2.' };
  }
  const k = newKey_();
  const ss = spreadsheet_();
  logSheet_();
  writeConnectTab_(k);
  return { ok: true, key: k, sheetUrl: ss.getUrl() };
}

/* ---------- for the editor's Run button (and the menu, if the script lives in a Sheet) ---------- */
function newConnectionLink() {
  const k = newKey_();
  const link = writeConnectTab_(k);
  Logger.log('New Gut Check connection link (also in the Connect tab): ' + link);
  try { SpreadsheetApp.getUi().alert('New connection link saved in the Connect tab. The old link no longer works.'); } catch (e) {}
}
function onOpen() {
  try { SpreadsheetApp.getUi().createMenu('Gut Check').addItem('Make a new connection link', 'newConnectionLink').addToUi(); } catch (e) {}
}

/* ---------- helpers ---------- */
function guard_(key, fn) {
  const k = props_().getProperty('key');
  if (!k) return { ok: false, error: 'Not connected yet. Paste the Web app link into Gut Check first.' };
  if (!key || key !== k) return { ok: false, error: 'This connection link no longer works. Get the current one from the Sheet’s Connect tab.' };
  try { return fn(); } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function props_() { return PropertiesService.getScriptProperties(); }
function newKey_() {
  const k = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  props_().setProperty('key', k);
  return k;
}
function ver_() { return Number(props_().getProperty('ver') || 0); }
// The Sheet this script is attached to, or else the one it created earlier, or else a new one.
function spreadsheet_() {
  try { const a = SpreadsheetApp.getActiveSpreadsheet(); if (a) return a; } catch (e) {}
  const id = props_().getProperty('sheetId');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  const ss = SpreadsheetApp.create(SHEET_NAME);
  props_().setProperty('sheetId', ss.getId());
  const first = ss.getSheets()[0];
  if (first) first.setName(LOG_TAB);
  return ss;
}
function logSheet_() {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(LOG_TAB);
  if (!sh) sh = ss.insertSheet(LOG_TAB, 0);
  if (!sh.getLastRow()) sh.getRange(1, 1, 1, HEAD.length).setNumberFormat('@').setValues([HEAD]);
  return sh;
}
function writeConnectTab_(k) {
  const ss = spreadsheet_();
  const link = APP_URL + '#gsheet=' + encodeURIComponent(ScriptApp.getService().getUrl()) + '&key=' + k;
  const tab = ss.getSheetByName('Connect') || ss.insertSheet('Connect');
  tab.clear();
  tab.getRange('A1').setValue('Gut Check connection link. To connect another phone, copy A2 and paste it into Gut Check. Keep it private: anyone with it can read the log.');
  tab.getRange('A2').setValue(link);
  tab.setColumnWidth(1, 900);
  return link;
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
