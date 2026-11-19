/* Gut Check: a tiny tracker for bowel movements, vomiting, Imodium and Gas-X.
 * Data lives in a CSV file in a GitHub repo (Excel opens it directly).
 * Writes go through the GitHub Contents API with a token kept on the device.
 * Every change is queued locally first, so taps never get lost offline. */
(() => {
'use strict';

/* ---------- constants ---------- */
const EV = {
  poop:    { label: 'Poop',    csv: 'Poop',    color: 'var(--poop)', hex: '#d95926' },
  vomit:   { label: 'Vomit',   csv: 'Vomit',   color: 'var(--vomit)', hex: '#e3cf5a' },
  imodium: { label: 'Imodium', csv: 'Imodium', color: 'var(--imod)', hex: '#3987e5' },
  gasx:    { label: 'Gas-X',   csv: 'Gas-X',   color: 'var(--gasx)', hex: '#199e70' },
};
const MEDS = ['imodium', 'gasx'];
const STRIP = [['vomit', 'V'], ['imodium', 'Im'], ['gasx', 'Gx']]; // event rows under the charts
const EMOJI = { poop: '💩', vomit: '🤢', imodium: '💊', gasx: '🫧' };
// vomit shares the chart with 3 other hues, so it is always drawn as a diamond (never color alone)
const mark = (ev, cx, cy, r, attrs = '') => ev === 'vomit'
  ? `<path d="M${cx} ${cy-r*1.25} l${r*1.25} ${r*1.25} l-${r*1.25} ${r*1.25} l-${r*1.25} -${r*1.25} z" fill="${EV[ev].color}" ${attrs}/>`
  : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${EV[ev].color}" ${attrs}/>`;
const BRISTOL = [null,
  { name: 'Hard lumps',   group: 'Hard',  desc: 'Separate hard lumps, like nuts (hard to pass)' },
  { name: 'Lumpy log',    group: 'Hard',  desc: 'Sausage-shaped but lumpy' },
  { name: 'Cracked log',  group: 'Ideal', desc: 'Like a sausage but with cracks on its surface' },
  { name: 'Smooth snake', group: 'Ideal', desc: 'Like a sausage or snake, smooth and soft' },
  { name: 'Soft blobs',   group: 'Soft',  desc: 'Soft blobs with clear-cut edges (passed easily)' },
  { name: 'Mushy',        group: 'Loose', desc: 'Fluffy pieces with ragged edges, a mushy stool' },
  { name: 'Watery',       group: 'Loose', desc: 'Watery, no solid pieces, entirely liquid' },
];
const BCOL = [null, '#e66767', '#b8605b', '#8a7570', '#6f6e69', '#6f86a8', '#4f86d0', '#5598e7'];
const MIN = 60e3, HOUR = 36e5, DAY = 864e5;
const K = { snap: 'gl.snapshot', pend: 'gl.pending', out: 'gl.outbox', tstat: 'gl.tstat', copy: 'gl.lastcopy', cfg: 'gl.cfg', ui: 'gl.ui' };

/* ---------- icons ---------- */
const BR = '#8b5a2b', BR2 = '#a8723f', BR3 = '#5e3b1b';
const ICON = {
  poop: `<svg viewBox="0 0 64 64" aria-hidden="true">
    <ellipse cx="32" cy="47" rx="25" ry="10" fill="${BR}"/>
    <ellipse cx="26" cy="43" rx="10" ry="3" fill="${BR2}" opacity=".7"/>
    <ellipse cx="32" cy="34" rx="18" ry="8.5" fill="${BR}"/>
    <ellipse cx="27" cy="30.5" rx="7" ry="2.4" fill="${BR2}" opacity=".7"/>
    <ellipse cx="32" cy="22" rx="11.5" ry="7" fill="${BR}"/>
    <path d="M27 18 C29 10 35 9 40 4 C40 10 41 14 37 18 Z" fill="${BR}"/>
    <circle cx="25.5" cy="34" r="4.2" fill="#fff"/><circle cx="38.5" cy="34" r="4.2" fill="#fff"/>
    <circle cx="26.3" cy="34.8" r="2.1" fill="#1a1a19"/><circle cx="39.3" cy="34.8" r="2.1" fill="#1a1a19"/>
    <path d="M25 46 Q32 52.5 39 46" stroke="#1a1a19" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <circle cx="19" cy="44" r="2.6" fill="#e87ba4" opacity=".55"/><circle cx="45" cy="44" r="2.6" fill="#e87ba4" opacity=".55"/>
  </svg>`,
  imodium: `<svg viewBox="0 0 64 64" aria-hidden="true">
    <g transform="rotate(-12 32 33)">
      <rect x="11" y="7" width="42" height="52" rx="7" fill="#dfe3e8"/>
      <rect x="11" y="7" width="42" height="52" rx="7" fill="none" stroke="#aeb6c0" stroke-width="1.5"/>
      <rect x="15" y="10" width="4" height="46" rx="2" fill="#fff" opacity=".55"/>
      <rect x="17.5" y="14.5" width="13" height="9" rx="4.5" fill="#f4f6f8" stroke="#bcc3cc" stroke-width="1.2"/><rect x="19.5" y="16.4" width="9" height="5.2" rx="2.6" fill="#3987e5"/><rect x="24" y="16.4" width="4.5" height="5.2" rx="0" fill="#7fb2f0"/><path d="M25.9 16.4 a2.6 2.6 0 0 1 0 5.2" fill="#7fb2f0"/><rect x="33.5" y="14.5" width="13" height="9" rx="4.5" fill="#f4f6f8" stroke="#bcc3cc" stroke-width="1.2"/><rect x="35.5" y="16.4" width="9" height="5.2" rx="2.6" fill="#3987e5"/><rect x="40" y="16.4" width="4.5" height="5.2" rx="0" fill="#7fb2f0"/><path d="M41.9 16.4 a2.6 2.6 0 0 1 0 5.2" fill="#7fb2f0"/><rect x="17.5" y="27.5" width="13" height="9" rx="4.5" fill="#f4f6f8" stroke="#bcc3cc" stroke-width="1.2"/><rect x="19.5" y="29.4" width="9" height="5.2" rx="2.6" fill="#3987e5"/><rect x="24" y="29.4" width="4.5" height="5.2" rx="0" fill="#7fb2f0"/><path d="M25.9 29.4 a2.6 2.6 0 0 1 0 5.2" fill="#7fb2f0"/><rect x="33.5" y="27.5" width="13" height="9" rx="4.5" fill="#f4f6f8" stroke="#bcc3cc" stroke-width="1.2"/><rect x="35.5" y="29.4" width="9" height="5.2" rx="2.6" fill="#3987e5"/><rect x="40" y="29.4" width="4.5" height="5.2" rx="0" fill="#7fb2f0"/><path d="M41.9 29.4 a2.6 2.6 0 0 1 0 5.2" fill="#7fb2f0"/><rect x="17.5" y="40.5" width="13" height="9" rx="4.5" fill="#f4f6f8" stroke="#bcc3cc" stroke-width="1.2"/><rect x="19.5" y="42.4" width="9" height="5.2" rx="2.6" fill="#3987e5"/><rect x="24" y="42.4" width="4.5" height="5.2" rx="0" fill="#7fb2f0"/><path d="M25.9 42.4 a2.6 2.6 0 0 1 0 5.2" fill="#7fb2f0"/>
      <rect x="33.5" y="40.5" width="13" height="9" rx="4.5" fill="#c9cfd7" stroke="#aeb6c0" stroke-width="1.2"/>
      <path d="M35 42 l3 2.5 l2.5 -2 l3 3 l2 -1.5" stroke="#8d96a1" stroke-width="1.2" fill="none" stroke-linejoin="round"/>
    </g>
  </svg>`,
  vomit: `<svg viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="26" r="20" fill="#b5d98a"/>
    <ellipse cx="25" cy="15" rx="7" ry="3" fill="#d4ecb5" opacity=".8"/>
    <path d="M18 20 l7 3.5 l-7 3.5 M46 20 l-7 3.5 l7 3.5" stroke="#1a1a19" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <ellipse cx="32" cy="35" rx="6.5" ry="5.5" fill="#1a1a19"/>
    <path d="M26.5 37 Q23 49 15 60 H49 Q41 49 37.5 37 Q32 41 26.5 37 Z" fill="#e3cf5a"/>
    <path d="M30 44 q-1 6 -4 11" stroke="#f3e79a" stroke-width="2" fill="none" stroke-linecap="round"/>
    <circle cx="10" cy="55" r="2.6" fill="#e3cf5a"/><circle cx="54" cy="53" r="2.2" fill="#e3cf5a"/><circle cx="51" cy="45" r="1.6" fill="#e3cf5a"/>
    <path d="M49 6 c-3 4.5 -3.5 7 0 7.5 c3.5 -.5 3 -3 0 -7.5 z" fill="#8fc8f0"/>
  </svg>`,
  gasx: `<svg viewBox="0 0 64 64" aria-hidden="true">
    <g transform="rotate(-35 31 38)">
      <rect x="9" y="28" width="44" height="20" rx="10" fill="#8fe0c1"/>
      <path d="M19 28 h12 v20 h-12 a10 10 0 0 1 0 -20 z" fill="#199e70"/>
      <rect x="14" y="31.5" width="30" height="3" rx="1.5" fill="#fff" opacity=".55"/>
    </g>
    <circle cx="48" cy="14" r="5" fill="none" stroke="#8fe0c1" stroke-width="2.2"/>
    <circle cx="56" cy="25" r="3" fill="none" stroke="#8fe0c1" stroke-width="2"/>
    <circle cx="40" cy="6" r="2.4" fill="none" stroke="#8fe0c1" stroke-width="1.8"/>
  </svg>`,
};
const hl = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${BR2}" opacity=".75"/>`;
const BICON = [null,
  `<svg viewBox="0 0 80 48" aria-hidden="true">${[[13,31,7],[29,19,7.5],[44,33,6.5],[57,17,7],[68,34,6]].map(([x,y,r], k) =>
    `<g class="lump" style="--k:${k}"><circle cx="${x}" cy="${y}" r="${r}" fill="${BR}"/>${hl(x-2.2, y-2.4, r/3)}</g>`).join('')}</svg>`,
  `<svg viewBox="0 0 80 48" aria-hidden="true">${[[14,25,9.5],[24,21,10.5],[35,26,10],[46,21,10.5],[57,26,10],[67,23,9]].map(([x,y,r]) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${BR}"/>`).join('')}${[[13,21],[24,16],[35,22],[46,16],[57,22],[66,19]].map(([x,y]) => hl(x,y,2.4)).join('')}</svg>`,
  `<svg viewBox="0 0 80 48" aria-hidden="true"><rect x="6" y="13" width="68" height="22" rx="11" fill="${BR}"/>
    <rect x="14" y="16" width="44" height="3" rx="1.5" fill="${BR2}" opacity=".7"/>
    <g stroke="${BR3}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 13 l3 6 l-2 4"/><path d="M33 13 l-2 6 l3 4"/><path d="M48 13 l2 7"/><path d="M61 14 l-3 6 l2 3"/>
      <path d="M25 35 l2 -6"/><path d="M42 35 l-1 -5 l2 -2"/><path d="M56 35 l-2 -6"/></g></svg>`,
  `<svg viewBox="0 0 80 48" aria-hidden="true"><path d="M9 31 C21 9 33 41 47 23 S67 13 72 25" stroke="${BR}" stroke-width="14" fill="none" stroke-linecap="round"/>
    <path d="M12 26 C22 12 31 34 44 20" stroke="${BR2}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/></svg>`,
  `<svg viewBox="0 0 80 48" aria-hidden="true">${[[16,29,10,8],[39,21,11,8.5],[62,30,11,8]].map(([x,y,rx,ry], k) =>
    `<g class="blob" style="--k:${k}"><ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${BR}"/><ellipse cx="${x-3}" cy="${y-3.5}" rx="${rx/2.6}" ry="2" fill="${BR2}" opacity=".75"/></g>`).join('')}</svg>`,
  `<svg viewBox="0 0 80 48" aria-hidden="true"><path d="M10 31 l4 -8 l5 3 l3 -9 l6 4 l5 -6 l4 5 l7 -4 l3 6 l6 -2 l2 7 l6 1 l-3 6 l4 5 l-8 2 l-4 -3 l-6 4 l-5 -3 l-7 3 l-4 -4 l-8 2 l-2 -5 z"
    fill="#9c6a3a" stroke="#9c6a3a" stroke-width="3" stroke-linejoin="round"/>
    <path d="M18 27 l4 -3 l5 2 l5 -4 l5 3" stroke="${BR2}" stroke-width="2" fill="none" stroke-linecap="round" opacity=".9"/>
    <path d="M71 18 l3 -3 l3 3 l-2 3 z M8 18 l3 -2 l2 3 l-3 2 z" fill="#9c6a3a" stroke="#9c6a3a" stroke-width="2" stroke-linejoin="round"/></svg>`,
  `<svg viewBox="0 0 80 48" aria-hidden="true"><ellipse class="puddle" cx="40" cy="36" rx="33" ry="8.5" fill="#a0743f" opacity=".9"/>
    <path class="wave" d="M18 36 q5 -3 10 0 t10 0 M44 37 q5 -3 10 0 t10 0" stroke="#c8995f" stroke-width="2" fill="none" stroke-linecap="round"/>
    ${[[22,10],[40,4],[58,12]].map(([x,y], k) => `<path class="drop" style="--k:${k}" d="M${x} ${y} c-4 6 -5 10 0 11 c5 -1 4 -5 0 -11 z" fill="#a0743f"/>`).join('')}</svg>`,
];
const iconFor = e => e.ev === 'poop' && e.b ? BICON[e.b] : ICON[e.ev];

/* ---------- storage ----------
 * `local` is the whole log as this phone knows it. It is always kept in browser storage, with a
 * daily copy kept for 30 days. Extra places ("targets": a file on this phone, a private GitHub
 * repo) each hold a full copy. Each target has an outbox of changes made here that it hasn't
 * received yet. A sync makes the target hold everything this phone has, and pulls in anything
 * new it holds (another phone, edits made in Excel). Only a delete made in this app ever
 * removes an entry, so nothing is lost by a missing or out-of-date copy. */
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
let wiping = false; // set while resetting the app, so nothing is written back afterwards
const save = (k, v) => { if (wiping) return; try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const fixEv = e => e && e.ev === 'miralax' ? { ...e, ev: 'imodium' } : e; // the Imodium button used to say MiraLAX
const fixOp = o => o.op === 'add' ? { ...o, e: fixEv(o.e) } : o;

// a brand-new browser (or one whose storage was cleared) has no saved log yet
const FRESH = (() => { try { return localStorage.getItem(K.snap) === null; } catch { return true; } })();
let local = load(K.snap, []).map(fixEv);
let outbox = load(K.out, null);
let tstat = load(K.tstat, {});   // per target: { ok: last successful save, err: last problem, errAt: when it started }
let cfg = Object.assign(defaultCfg(), load(K.cfg, {}));
let ui = Object.assign({ tab: 'home', range: 14, hf: 'all' }, load(K.ui, {}));
if (!outbox) { // first run of this version: fold in changes the old version hadn't saved yet
  const old = load(K.pend, []).map(fixOp);
  local = applyOps(local, old);
  outbox = { file: old.slice(), github: old.slice() };
  save(K.snap, local); save(K.out, outbox);
  try { localStorage.removeItem(K.pend); } catch {}
}
for (const t in outbox) outbox[t] = outbox[t].map(fixOp);

function defaultCfg() {
  const h = location.hostname, gh = h.endsWith('.github.io');
  return { owner: gh ? h.split('.')[0] : '', repo: 'gut-check-data', branch: '', path: 'gut-check.csv', token: '', fileName: '', gsUrl: '', gsKey: '', gsSheetUrl: '' };
}
// Remembered twice on the device (localStorage + IndexedDB). Cookies aren't used: they'd send the
// Sheet's secret key to the web server on every page load.
function remember(k, v) { if (wiping) return; save('gl.' + k, v); try { idb.set('mem:' + k, v).catch(() => {}); } catch {} }
function saveCfg() { remember('cfg', cfg); }
const connected = () => !!(cfg.owner && cfg.repo && cfg.token && cfg.path);
const gsConnected = () => !!(cfg.gsUrl && cfg.gsKey);
const targets = () => [cfg.fileName && 'file', gsConnected() && 'gsheet', connected() && 'github'].filter(Boolean);

function applyOps(list, ops) {
  const m = new Map(list.map(e => [e.id, { ...e }]));
  for (const o of ops) {
    if (o.op === 'add') m.set(o.e.id, { ...o.e });
    else if (o.op === 'del') m.delete(o.id);
    else if (o.op === 'edit') { const e = m.get(o.id); if (e) Object.assign(e, o.patch); }
  }
  return [...m.values()].sort((a, b) => a.ts - b.ts);
}
const entries = () => local;

function queue(...ops) {
  local = applyOps(local, ops); save(K.snap, local);
  for (const t of targets()) (outbox[t] = outbox[t] || []).push(...ops);
  save(K.out, outbox);
  render(); scheduleSync(); scheduleBackup();
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- CSV ---------- */
const pad = n => String(n).padStart(2, '0');
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const hm = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function isoLocal(ts) {
  const d = new Date(ts), o = -d.getTimezoneOffset(), s = o >= 0 ? '+' : '-';
  return `${dayKey(ts)}T${hm(ts)}:${pad(d.getSeconds())}${s}${pad(Math.floor(Math.abs(o)/60))}:${pad(Math.abs(o)%60)}`;
}
const CSV_HEAD = ['id', 'timestamp', 'date', 'time', 'weekday', 'event', 'bristol_type', 'bristol_description'];
const toRows = list => list.map(e => [e.id, isoLocal(e.ts), dayKey(e.ts), hm(e.ts),
  new Date(e.ts).toLocaleDateString('en-US', { weekday: 'short' }), EV[e.ev].csv, e.b || '', e.b ? BRISTOL[e.b].desc : '']);
const csvCell = v => { v = String(v ?? ''); return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
const toCSV = list => [CSV_HEAD, ...toRows(list)].map(r => r.map(csvCell).join(',')).join('\n') + '\n';

function parseDelimited(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [',', '\t', ';', '|'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i+1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}
function evFrom(s) {
  s = String(s || '').toLowerCase();
  if (/vomit|throw|puk|emesis|🤮|🤢/.test(s)) return 'vomit';
  if (/imod|loper|mira|lax|peg|polyeth/.test(s)) return 'imodium'; // older logs said MiraLAX for this button
  if (/gas|simeth/.test(s)) return 'gasx';
  if (/poo|stool|bm|bowel|movement|💩/.test(s)) return 'poop';
  return null;
}
function rowsToEntries(rows) {
  if (!rows.length) return [];
  const head = rows[0].map(h => String(h).trim().toLowerCase());
  const col = (...names) => head.findIndex(h => names.some(n => h === n || h.includes(n)));
  const iId = head.indexOf('id'), iTs = col('timestamp', 'datetime', 'date/time', 'when');
  const iDate = col('date', 'day'), iTime = col('time', 'hour');
  const iEv = col('event', 'type of', 'what', 'item', 'kind', 'entry');
  const iB = col('bristol', 'stool type', 'scale');
  const out = [];
  for (const r of rows.slice(1)) {
    let ts = NaN;
    if (iTs >= 0 && r[iTs]) ts = Date.parse(r[iTs]);
    if (isNaN(ts) && iDate >= 0 && r[iDate]) {
      const t = iTime >= 0 && r[iTime] ? String(r[iTime]).trim() : '00:00';
      ts = Date.parse(`${String(r[iDate]).trim()} ${t}`);
      if (isNaN(ts)) ts = Date.parse(`${String(r[iDate]).trim()}T${t.length === 4 ? '0' + t : t}`);
    }
    const ev = evFrom(iEv >= 0 ? r[iEv] : r.join(' '));
    if (isNaN(ts) || !ev) continue;
    const b = ev === 'poop' && iB >= 0 ? parseInt(String(r[iB]).replace(/\D/g, ''), 10) : NaN;
    out.push({ id: iId >= 0 && r[iId] ? String(r[iId]).trim() : newId() + out.length, ts, ev, b: b >= 1 && b <= 7 ? b : null });
  }
  return out;
}

/* ---------- GitHub sync ---------- */
const api = (p, opt = {}) => fetch(`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}${p}`, {
  cache: 'no-store', ...opt,
  headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${cfg.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(opt.headers || {}) },
});
const b64enc = s => { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(bin); };
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
const filePath = () => cfg.path.split('/').map(encodeURIComponent).join('/');

class HttpError extends Error { constructor(r, msg) { super(msg || `GitHub said ${r.status}`); this.status = r.status; } }

let activeBranch = '';
const refQ = () => activeBranch ? `?ref=${encodeURIComponent(activeBranch)}` : '';
// Checks the data repo is reachable and PRIVATE (health data must never land in a public repo),
// then makes sure the chosen branch exists (blank branch = the repo's default branch).
async function checkRepo() {
  const repo = await api('');
  if (!repo.ok) throw new HttpError(repo, repo.status === 404 ? 'Repo not found. Check the owner/name, and that the token can access it.' : repo.status === 401 ? 'Token rejected' : null);
  const info = await repo.json();
  if (!info.private) throw new HttpError({ status: 0 }, `${cfg.owner}/${cfg.repo} is public. Use a private repo for the log.`);
  activeBranch = cfg.branch && cfg.branch !== info.default_branch ? cfg.branch : '';
  if (!activeBranch) return;
  const r = await api(`/branches/${encodeURIComponent(activeBranch)}`);
  if (r.ok) return;
  if (r.status !== 404) throw new HttpError(r);
  const ref = await api(`/git/ref/heads/${encodeURIComponent(info.default_branch)}`);
  if (!ref.ok) { activeBranch = ''; return; } // empty repo: write the first file to the default branch
  const sha = (await ref.json()).object.sha;
  const mk = await api('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${activeBranch}`, sha }) });
  if (!mk.ok && mk.status !== 422) throw new HttpError(mk, 'Could not create the branch');
}
async function fetchRemote() {
  const r = await api(`/contents/${filePath()}${refQ()}`);
  if (r.status === 404) return { sha: null, list: [] };
  if (!r.ok) throw new HttpError(r, r.status === 401 ? 'Token rejected' : null);
  const j = await r.json();
  let text = j.content ? b64dec(j.content) : '';
  if (!j.content && j.size > 0) {
    const raw = await api(`/contents/${filePath()}${refQ()}`, { headers: { Accept: 'application/vnd.github.raw' } });
    text = await raw.text();
  }
  return { sha: j.sha, list: rowsToEntries(parseDelimited(text)) };
}
function commitMsg(ops) {
  if (!ops.length) return 'Gut Check: copy entries from this phone';
  if (ops.length > 1) return `Gut Check: ${ops.length} changes`;
  const o = ops[0];
  if (o.op === 'add') return `Log ${EV[o.e.ev].label}${o.e.b ? ` (type ${o.e.b})` : ''} ${dayKey(o.e.ts)} ${hm(o.e.ts)}`;
  return o.op === 'del' ? 'Remove an entry' : 'Edit an entry';
}

/* ---------- device file (File System Access: Chrome on Android, Chrome/Edge on computers) ----------
 * The person picks a file anywhere on the device once. The handle is kept in IndexedDB, and that
 * same file is re-read and rewritten on every change. iPhone Safari has no equivalent API. */
const FS_OK = 'showSaveFilePicker' in window || 'showOpenFilePicker' in window;
let fileHandle = null, filePerm = 'granted';
const idb = (() => {
  let p;
  const db = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('gutcheck', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => {
    const t = d.transaction('kv', mode), q = fn(t.objectStore('kv'));
    t.oncomplete = () => res(q.result); t.onerror = () => rej(t.error);
  }); };
  return { get: k => tx('readonly', st => st.get(k)), set: (k, v) => tx('readwrite', st => st.put(v, k)),
    del: k => tx('readwrite', st => st.delete(k)), keys: () => tx('readonly', st => st.getAllKeys()),
    async wipe() { try { if (p) (await p).close(); } catch {} p = null;
      await new Promise(res => { const r = indexedDB.deleteDatabase('gutcheck'); r.onsuccess = r.onerror = r.onblocked = () => res(); }); } };
})();
const isXlsx = h => /\.xlsx$/i.test(h.name);
async function permOf(h, ask) {
  const m = ask ? h.requestPermission : h.queryPermission;
  return m ? m.call(h, { mode: 'readwrite' }) : 'granted';
}
async function readDeviceFile() {
  const f = await fileHandle.getFile();
  if (!f.size) return null; // brand-new (or truncated) file
  if (isXlsx(fileHandle)) {
    const X = await loadXLSX(), wb = X.read(await f.arrayBuffer(), { cellDates: true });
    return rowsToEntries(X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, dateNF: 'yyyy-mm-dd hh:mm' }));
  }
  return rowsToEntries(parseDelimited(await f.text()));
}

/* ---------- saving to every place ---------- */
class PermError extends Error {}
const PLACE = { file: () => cfg.fileName, gsheet: () => 'Google Sheet', github: () => 'GitHub' };
const IO = {
  file: {
    async read() {
      filePerm = await permOf(fileHandle, false);
      if (filePerm !== 'granted') throw new PermError('perm');
      const list = await readDeviceFile();
      return { list: list || [], ver: null, empty: list === null };
    },
    async write(list) {
      const data = isXlsx(fileHandle) ? await xlsxBlob(list) : new Blob([toCSV(list)], { type: 'text/csv' });
      const w = await fileHandle.createWritable(); await w.write(data); await w.close();
      return true;
    },
  },
  // A Google Sheet with the Gut Check Apps Script (google-sheet/Code.gs) deployed as a web app.
  // text/plain POSTs avoid a CORS preflight, which Apps Script can't answer.
  gsheet: {
    async read() {
      const j = await gsCall(fetch(`${cfg.gsUrl}?key=${encodeURIComponent(cfg.gsKey)}&t=${Date.now()}`, { cache: 'no-store' }));
      const rows = j.rows || [];
      return { list: rowsToEntries(rows), ver: j.ver, empty: rows.length === 0 };
    },
    async write(list, ver) {
      const j = await gsCall(fetch(cfg.gsUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ key: cfg.gsKey, ver, rows: [CSV_HEAD, ...toRows(list)] }) }));
      return !j.conflict; // conflict: another phone saved first, so re-read and merge
    },
  },
  github: {
    async read() {
      if (!branchOk) { await checkRepo(); branchOk = true; }
      const { sha, list } = await fetchRemote();
      return { list, ver: sha, empty: !sha };
    },
    async write(list, sha, ops) {
      const body = { message: commitMsg(ops), content: b64enc(toCSV(list)) };
      if (activeBranch) body.branch = activeBranch;
      if (sha) body.sha = sha;
      const r = await api(`/contents/${filePath()}`, { method: 'PUT', body: JSON.stringify(body) });
      if (r.ok) return true;
      if (r.status === 409 || r.status === 422) return false; // another phone saved first: re-read and retry
      throw new HttpError(r, r.status === 403 || r.status === 404 ? 'The access key needs “Contents: Read and write” on this repository.' : null);
    },
  },
};
async function gsCall(req) {
  let r;
  try { r = await req; } catch { throw new Error(navigator.onLine === false ? 'No internet right now. It will save when the phone is back online.' : 'Could not reach the Google Sheet.'); }
  if (!r.ok) throw new Error(`The Google Sheet didn't answer (${r.status}). Check the script is deployed as a Web app with access “Anyone”.`);
  let j; try { j = await r.json(); } catch { throw new Error('The Google Sheet answered with a sign-in page. Re-deploy the script with “Who has access: Anyone”.'); }
  if (!j.ok && !j.conflict) throw new Error(j.error || 'The Google Sheet refused the change.');
  return j;
}
// "…#gsheet=<web app url>&key=<secret>": the link the Sheet's Gut Check menu gives out
function parseConnLink(text) {
  const u = String(text || '').match(/gsheet=([^&\s#]+)/), k = String(text || '').match(/[?&#]key=([0-9a-f]{32,})/i);
  if (!u || !k) return null;
  let url; try { url = decodeURIComponent(u[1]); } catch { return null; }
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) return null; // only ever send the log to Google Apps Script
  return { url, key: k[1] };
}
const same = (a, b) => Math.floor(a.ts / 1000) === Math.floor(b.ts / 1000) && a.ev === b.ev && (a.b || null) === (b.b || null);
const byTs = m => [...m.values()].sort((a, b) => a.ts - b.ts);

async function syncTarget(t) {
  for (let attempt = 0; ; attempt++) {
    const { list: remote, ver, empty } = await IO[t].read();
    const ops = (outbox[t] || []).slice();
    const tMap = new Map(applyOps(remote, ops).map(e => [e.id, e])); // deliver this phone's changes
    const lMap = new Map(local.map(e => [e.id, e]));
    const pendIds = new Set(), pendDel = new Set();
    for (const k in outbox) for (const o of outbox[k]) { const id = o.op === 'add' ? o.e.id : o.id; pendIds.add(id); if (o.op === 'del') pendDel.add(id); }
    let writeT = ops.length > 0 || empty, gotNew = false;
    for (const [id, e] of lMap) if (!tMap.has(id)) { tMap.set(id, e); writeT = true; } // that place is missing something: copy it there
    for (const [id, e] of tMap) {
      const l = lMap.get(id);
      if (!l) { if (pendDel.has(id)) { tMap.delete(id); writeT = true; } else { lMap.set(id, e); gotNew = true; } } // new from elsewhere
      else if (!same(l, e)) { if (pendIds.has(id)) { tMap.set(id, l); writeT = true; } else { lMap.set(id, e); gotNew = true; } } // edited elsewhere
    }
    if (writeT && !(await IO[t].write(byTs(tMap), ver, ops))) {
      if (attempt < 4) continue;
      throw new Error('Another phone was saving at the same moment. It will try again.');
    }
    outbox[t] = (outbox[t] || []).slice(ops.length);
    if (gotNew) local = byTs(lMap);
    return gotNew;
  }
}

let syncing = false, again = false, syncTimer = 0, branchOk = false;
function scheduleSync(ms = 1200) { clearTimeout(syncTimer); syncTimer = setTimeout(sync, ms); }
async function sync() {
  const ts = targets();
  if (!ts.length) { setStatus(); renderBanner(); return; }
  if (syncing) { again = true; return; }
  syncing = true; setStatus('busy');
  let gotNew = false;
  for (const t of ts) {
    if (t === 'file' && !fileHandle) continue; // link still loading, or lost (reported at startup)
    try {
      if (await syncTarget(t)) gotNew = true;
      tstat[t] = { ok: Date.now(), err: '' };
    } catch (e) {
      const prev = tstat[t] || {};
      const err = e instanceof PermError ? 'perm' : t === 'github' && navigator.onLine === false ? 'No internet right now. It will save when the phone is back online.' : (e.message || 'Could not save');
      tstat[t] = { ...prev, err, errAt: prev.err ? prev.errAt : Date.now() };
      if (t === 'github') branchOk = false;
    }
  }
  save(K.snap, local); save(K.out, outbox); save(K.tstat, tstat);
  syncing = false;
  if (gotNew) { render(); if (ts.length > 1) again = true; } // copy what came in to the other places too
  setStatus(); renderBanner(); refreshPlaces();
  if (again) { again = false; scheduleSync(300); }
}
const waiting = t => (outbox[t] || []).length;
function setStatus(s) {
  const btn = $('#syncBtn'), txt = $('#syncText'), ts = targets(), errs = ts.filter(t => tstat[t]?.err);
  const n = Math.max(0, ...ts.map(waiting));
  if (!s) s = !ts.length ? 'local' : errs.some(t => tstat[t].err === 'perm') ? 'perm' : errs.length ? 'err' : n ? 'pending' : 'ok';
  btn.dataset.s = s;
  txt.textContent = { local: 'Only on phone', busy: 'Saving…', pending: `${n} to save`, perm: 'Tap to allow',
    err: errs.length === ts.length ? 'Not backed up' : 'Partly saved', ok: `Saved in ${1 + ts.length} places` }[s];
  btn.title = errs.map(t => `${PLACE[t]()}: ${tstat[t].err === 'perm' ? 'needs permission again' : tstat[t].err}`).join('\n');
}

/* ---------- automatic backups inside the app (IndexedDB): one per day for 30 days ---------- */
let bkTimer = 0;
function scheduleBackup() { clearTimeout(bkTimer); bkTimer = setTimeout(() => backupNow(), 3000); }
async function backupNow(label) {
  if (wiping || (!local.length && !label)) return; // never let an empty log replace a day's backup
  try {
    await idb.set('bk:' + (label || dayKey(Date.now())), { at: Date.now(), list: local });
    const keys = (await idb.keys()).map(String).filter(k => k.startsWith('bk:')).sort();
    const daily = keys.filter(k => /^bk:\d{4}-/.test(k)), other = keys.filter(k => !/^bk:\d{4}-/.test(k));
    for (const k of [...daily.slice(0, -30), ...other.slice(0, -10)]) await idb.del(k);
  } catch {}
}
async function listBackups() {
  try {
    const keys = (await idb.keys()).map(String).filter(k => k.startsWith('bk:')), out = [];
    for (const k of keys) { const v = await idb.get(k); if (v && v.list) out.push({ k, at: v.at, list: v.list }); }
    return out.sort((a, b) => b.at - a.at);
  } catch { return []; }
}

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = ts => {
  const k = dayKey(ts), today = dayKey(Date.now()), yest = dayKey(Date.now() - DAY);
  return k === today ? 'Today' : k === yest ? 'Yesterday' : new Date(ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};
function fmtDur(ms) {
  if (!isFinite(ms)) return '–';
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 48) return r && h < 10 ? `${h}h ${r}m` : `${Math.round(m / 60)}h`;
  return `${(ms / DAY).toFixed(1)}d`;
}
const ago = ts => { const d = Date.now() - ts; return d < MIN ? 'just now' : `${fmtDur(d)} ago`; };
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const median = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2; };
const startOfDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (ts, n) => { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); };
const typeLabel = v => !isFinite(v) ? '' : v < 2.5 ? 'Hard' : v <= 4.5 ? 'Ideal range' : v <= 5.5 ? 'Soft' : 'Loose';
const buzz = () => { try { navigator.vibrate && navigator.vibrate(12); } catch {} };

/* ---------- rendering: home ---------- */
function windowStats(list, from, to) {
  const poops = list.filter(e => e.ev === 'poop' && e.ts >= from && e.ts < to);
  const first = list.length ? list[0].ts : to;
  const days = Math.max(1, (to - Math.max(from, startOfDay(first))) / DAY);
  const gaps = []; for (let i = 1; i < poops.length; i++) gaps.push(poops[i].ts - poops[i-1].ts);
  return { n: poops.length, perDay: poops.length / days, type: mean(poops.filter(p => p.b).map(p => p.b)), gap: mean(gaps), days };
}
let kpiPrev = null;
function countUp(el, from, to, dec) {
  if (!motionOK() || !isFinite(from) || !isFinite(to) || from === to) return;
  const t0 = performance.now(), dur = 650, node = el.firstChild;
  if (!node || node.nodeType !== 3) return;
  const tick = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    node.nodeValue = (from + (to - from) * e).toFixed(dec); if (k < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
function renderKpis(list) {
  const now = Date.now(), cur = windowStats(list, now - 7 * DAY, now), prev = windowStats(list, now - 14 * DAY, now - 7 * DAY);
  const lastPoop = [...list].reverse().find(e => e.ev === 'poop');
  const hasPrev = list.length && list[0].ts < now - 8 * DAY;
  const delta = hasPrev && prev.n ? cur.perDay - prev.perDay : NaN;
  const trend = isFinite(delta) && Math.abs(delta) >= .05 ? `<span class="${delta > 0 ? 'up' : 'down'}">${Math.abs(delta).toFixed(1)}</span> vs last wk` : 'last 7 days';
  $('#kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Per day</div><div class="kpi-val">${list.length ? cur.perDay.toFixed(1) : '–'}</div><div class="kpi-sub">${trend}</div></div>
    <div class="kpi"><div class="kpi-label">Avg type</div><div class="kpi-val">${isFinite(cur.type) ? cur.type.toFixed(1) : '–'}<small>/7</small></div><div class="kpi-sub">${isFinite(cur.type) ? typeLabel(cur.type) : 'Bristol scale'}</div></div>
    <div class="kpi"><div class="kpi-label">Between</div><div class="kpi-val">${fmtDur(cur.gap)}</div><div class="kpi-sub">${lastPoop ? `last ${ago(lastPoop.ts)}` : 'avg gap'}</div></div>`;
  const vals = $$('#kpis .kpi-val'), shown = vals.map(v => v.textContent);
  if (kpiPrev) vals.forEach((v, k) => {
    if (shown[k] === kpiPrev[k]) return;
    v.classList.add('bump');
    if (k < 2) countUp(v, parseFloat(kpiPrev[k]), parseFloat(shown[k]), 1);
  });
  kpiPrev = shown;
}
function renderRecent(list) {
  const last = ev => [...list].reverse().find(e => e.ev === ev);
  $('#recent').innerHTML = `<h3>Last time</h3><div class="lasts">${Object.keys(EV).map(ev => {
    const e = last(ev);
    return `<div class="last"><b>${e ? ago(e.ts) : '–'}</b>${EV[ev].label}${e && e.b ? ` · type ${e.b}` : ''}</div>`;
  }).join('')}</div>`;
}

/* ---------- rendering: history ---------- */
let armedDelete = null;
function renderHistory(list) {
  const items = list.filter(e => ui.hf === 'all' || e.ev === ui.hf).reverse();
  if (!items.length) { $('#historyList').innerHTML = `<div class="empty">Nothing logged yet.<br>Tap a button on the Log tab to start.</div>`; return; }
  const groups = new Map();
  for (const e of items) { const k = dayKey(e.ts); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  $('#historyList').innerHTML = [...groups.values()].slice(0, 120).map(g => {
    const p = g.filter(e => e.ev === 'poop').length;
    return `<div class="day"><div class="day-head"><span>${fmtDay(g[0].ts)}</span><span>${p} poop${p === 1 ? '' : 's'}</span></div><div class="rows">${g.map(e => `
      <div class="row" data-id="${esc(e.id)}">
        <span class="row-ico">${iconFor(e)}</span>
        <span class="row-main"><div class="row-title">${EV[e.ev].label}${e.b ? ` · Type ${e.b}` : ''}</div>
          ${e.b ? `<div class="row-sub">${BRISTOL[e.b].name} · ${BRISTOL[e.b].group}</div>` : ''}</span>
        <button class="row-time" data-edit type="button" aria-label="Edit">${fmtTime(e.ts)}</button>
        <button class="row-del" data-del type="button" aria-label="Delete entry"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Z"/></svg></button>
      </div>`).join('')}</div></div>`;
  }).join('');
}

/* ---------- rendering: trends ---------- */
const svgOpen = (w, h, label) => `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">`;
function niceMax(v) { if (v <= 4) return Math.max(1, Math.ceil(v)); const s = v <= 10 ? 2 : 5; return Math.ceil(v / s) * s; }

function chartDaily(days) {
  const W = 340, L = 22, R = 6, T = 8, H = 150, BOT = H + T, MED = 13 * STRIP.length + 8;
  const max = niceMax(Math.max(...days.map(d => d.poops), 1)), n = days.length, bw = (W - L - R) / n;
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, max / 2, max];
  const y = v => T + H - (v / max) * H;
  const every = n <= 10 ? 1 : n <= 21 ? 3 : n <= 45 ? 7 : 14;
  let s = svgOpen(W, BOT + 22 + MED, 'Poops per day with vomiting and medicine doses');
  for (const t of ticks) s += `<line x1="${L}" x2="${W-R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)"/><text x="${L-6}" y="${y(t)+3}" text-anchor="end">${t}</text>`;
  days.forEach((d, i) => {
    const x = L + i * bw, w = Math.max(1.5, bw - 2), cx = x + bw / 2;
    if (d.poops) {
      const top = y(d.poops), r = Math.min(4, w / 2);
      s += `<path d="M${x+1} ${y(0)} V${top+r} q0 -${r} ${r} -${r} H${x+1+w-r} q${r} 0 ${r} ${r} V${y(0)} Z" fill="var(--poop)"/>`;
    }
    if ((i % every === 0 && n - 1 - i >= every / 2) || i === n - 1) s += `<text x="${cx}" y="${BOT+13}" text-anchor="middle">${new Date(d.ts).toLocaleDateString([], n > 10 ? { month: 'numeric', day: 'numeric' } : { weekday: 'narrow' })}</text>`;
    STRIP.forEach(([m], j) => {
      const c = d[m], my = BOT + 26 + j * 13;
      if (c) s += mark(m, cx, my, Math.min(4.5, bw / 2.2)) + (c > 1 && bw >= 10 ? `<text x="${cx}" y="${my+3}" text-anchor="middle" style="fill:${m === 'vomit' ? '#1a1a19' : '#fff'};font-size:7px;font-weight:700">${c}</text>` : '');
    });
    const tip = `${new Date(d.ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}\n${d.poops} poop${d.poops === 1 ? '' : 's'}${isFinite(d.type) ? ` · avg type ${d.type.toFixed(1)}` : ''}${d.vomit ? `\nVomit ${d.vomit}` : ''}\nImodium ${d.imodium} · Gas-X ${d.gasx}`;
    s += `<rect x="${x}" y="${T}" width="${bw}" height="${BOT + 22 + MED - T}" fill="transparent" data-tip="${esc(tip)}"/>`;
  });
  s += `<line x1="${L}" x2="${W-R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--border)"/>`;
  STRIP.forEach(([, lab], j) => s += `<text x="${L-6}" y="${BOT+29+j*13}" text-anchor="end" style="font-size:8px">${lab}</text>`);
  return s + '</svg>';
}

function chartTypeOverTime(list, from, to) {
  const W = 340, L = 22, R = 8, T = 8, H = 150, span = Math.max(to - from, DAY);
  const x = ts => L + ((ts - from) / span) * (W - L - R), y = b => T + ((7 - b) / 6) * H;
  let s = svgOpen(W, T + H + 44, 'Bristol type of each poop over time');
  s += `<rect x="${L}" y="${y(4)}" width="${W-L-R}" height="${y(3)-y(4)}" fill="#0ca30c" opacity=".12"/>`;
  s += `<text x="${L+4}" y="${y(3)+12}" style="fill:#5fd35f;font-size:9px">ideal 3–4</text>`;
  for (let b = 1; b <= 7; b++) s += `<line x1="${L}" x2="${W-R}" y1="${y(b)}" y2="${y(b)}" stroke="var(--grid)" stroke-dasharray="${b === 4 ? '' : '2 3'}"/><text x="${L-6}" y="${y(b)+3}" text-anchor="end">${b}</text>`;
  const poops = list.filter(e => e.ev === 'poop' && e.b && e.ts >= from && e.ts <= to);
  // rolling average line (last 5)
  if (poops.length >= 3) {
    const pts = poops.map((p, i) => { const w = poops.slice(Math.max(0, i - 4), i + 1); return [x(p.ts), y(mean(w.map(q => q.b)))]; });
    s += `<path d="M${pts.map(p => p.map(v => v.toFixed(1)).join(' ')).join(' L')}" fill="none" stroke="var(--text-2)" stroke-width="2" stroke-linejoin="round" opacity=".8"/>`;
  }
  for (const p of poops) s += `<circle cx="${x(p.ts)}" cy="${y(p.b)}" r="4.5" fill="${BCOL[p.b]}" stroke="var(--surface)" stroke-width="2" data-tip="${esc(`${fmtDay(p.ts)} ${fmtTime(p.ts)}\nType ${p.b}: ${BRISTOL[p.b].name}`)}"/>`;
  const base = T + H + 14;
  STRIP.forEach(([m], j) => {
    for (const d of list.filter(e => e.ev === m && e.ts >= from && e.ts <= to)) {
      const cx = x(d.ts), cy = base + j * 10, tip = `data-tip="${esc(`${EV[m].label}\n${fmtDay(d.ts)} ${fmtTime(d.ts)}`)}"`;
      s += m === 'vomit' ? mark(m, cx, cy, 3.6, tip) : `<path d="M${cx} ${cy-4} l4 7 h-8 z" fill="${EV[m].color}" ${tip}/>`;
    }
  });
  return s + '</svg>';
}

function chartMix(poops) {
  const counts = [0, 0, 0, 0, 0, 0, 0, 0]; poops.forEach(p => p.b && counts[p.b]++);
  const total = counts.reduce((a, b) => a + b, 0) || 1, max = Math.max(...counts, 1);
  const W = 340, rowH = 26, LBL = 146;
  let s = svgOpen(W, rowH * 7, 'Bristol type distribution');
  for (let b = 1; b <= 7; b++) {
    const yy = (b - 1) * rowH, w = (counts[b] / max) * (W - LBL - 44);
    s += `<g data-tip="${esc(`Type ${b}: ${BRISTOL[b].desc}\n${counts[b]} (${Math.round(counts[b] / total * 100)}%)`)}">
      <rect x="0" y="${yy}" width="${W}" height="${rowH}" fill="transparent"/>
      <svg x="0" y="${yy+2}" width="36" height="22" viewBox="0 0 80 48">${BICON[b].replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>
      <text x="42" y="${yy+16}" class="tl" style="font-size:11px">${b} · ${BRISTOL[b].name}</text>
      ${counts[b] ? `<rect x="${LBL}" y="${yy+7}" width="${Math.max(3, w)}" height="12" rx="3" fill="${BCOL[b]}"/>` : ''}
      <text x="${LBL + Math.max(3, w) + 6}" y="${yy+17}" class="tl" style="font-size:11px">${counts[b] ? counts[b] : ''}</text></g>`;
  }
  return s + '</svg>';
}

function chartHours(poops) {
  const b = Array(12).fill(0); poops.forEach(p => b[Math.floor(new Date(p.ts).getHours() / 2)]++);
  const W = 340, L = 22, R = 6, T = 6, H = 90, max = niceMax(Math.max(...b, 1)), bw = (W - L - R) / 12;
  const y = v => T + H - (v / max) * H;
  let s = svgOpen(W, T + H + 18, 'Poops by time of day');
  for (const t of [0, max]) s += `<line x1="${L}" x2="${W-R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)"/><text x="${L-6}" y="${y(t)+3}" text-anchor="end">${t}</text>`;
  const lab = h => h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h-12}p`;
  b.forEach((c, i) => {
    const x = L + i * bw, w = bw - 3;
    if (c) { const top = y(c), r = Math.min(4, w / 2); s += `<path d="M${x+1.5} ${y(0)} V${top+r} q0 -${r} ${r} -${r} H${x+1.5+w-r} q${r} 0 ${r} ${r} V${y(0)} Z" fill="var(--poop)"/>`; }
    if (i % 2 === 0) s += `<text x="${x + bw/2}" y="${T+H+13}" text-anchor="middle">${lab(i*2)}</text>`;
    s += `<rect x="${x}" y="${T}" width="${bw}" height="${H}" fill="transparent" data-tip="${lab(i*2)}–${lab((i*2+2)%24)}\n${c} poop${c === 1 ? '' : 's'}"/>`;
  });
  return s + '</svg>';
}

function doseTiming(list, med, from, to) {
  const poops = list.filter(e => e.ev === 'poop'), doses = list.filter(e => e.ev === med && e.ts >= from && e.ts <= to);
  const cat = { before: 0, during: 0, after: 0, apart: 0 }, toNext = [], afterTypes = [];
  for (const d of doses) {
    let prev = null, next = null;
    for (const p of poops) { if (p.ts <= d.ts) prev = p; else { next = p; break; } }
    const a = prev ? d.ts - prev.ts : Infinity, b = next ? next.ts - d.ts : Infinity;
    if (Math.min(a, b) <= 15 * MIN) cat.during++;
    else if (Math.min(a, b) > 3 * HOUR) cat.apart++;
    else if (a < b) cat.after++; else cat.before++;
    if (next && b <= 24 * HOUR) toNext.push(b);
    poops.forEach(p => { if (p.b && p.ts > d.ts && p.ts - d.ts <= 24 * HOUR) afterTypes.push(p.b); });
  }
  return { n: doses.length, cat, toNext, afterTypes };
}

function weeks(list) {
  if (!list.length) return [];
  const out = [], now = Date.now();
  let start = startOfDay(now); start = addDays(start, -((new Date(start).getDay() + 6) % 7)); // Monday
  for (let i = 0; i < 8; i++) {
    const s = addDays(start, -7 * i), e = addDays(s, 7);
    if (e <= list[0].ts) break;
    const inW = list.filter(x => x.ts >= s && x.ts < e), poops = inW.filter(x => x.ev === 'poop');
    const days = Math.max(1, (Math.min(e, now) - Math.max(s, startOfDay(list[0].ts))) / DAY);
    out.push({ s, perDay: poops.length / days, type: mean(poops.filter(p => p.b).map(p => p.b)),
      imod: inW.filter(x => x.ev === 'imodium').length / days, gasx: inW.filter(x => x.ev === 'gasx').length / days, vomit: inW.filter(x => x.ev === 'vomit').length });
  }
  return out;
}

// For each vomit: was a medicine taken in the 6h before it, and was there a poop within 2h?
function vomitStats(list, from, to, effDays) {
  const v = list.filter(e => e.ev === 'vomit' && e.ts >= from && e.ts <= to);
  const near = (ev, d, before, after) => list.some(e => e.ev === ev && e.ts >= d.ts - before && e.ts <= d.ts + after && e !== d);
  const r = { n: v.length, perWeek: v.length / effDays * 7, last: v.length ? v[v.length - 1].ts : NaN,
    afterImod: v.filter(d => near('imodium', d, 6 * HOUR, 0)).length,
    afterGasx: v.filter(d => near('gasx', d, 6 * HOUR, 0)).length,
    nearPoop: v.filter(d => near('poop', d, 2 * HOUR, 2 * HOUR)).length,
    days: new Set(v.map(d => dayKey(d.ts))).size };
  return r;
}
function vomitInsights(vs) {
  const out = []; if (!vs.n) return out;
  out.push(['🤢', `Vomited ${vs.n} time${vs.n === 1 ? '' : 's'} on ${vs.days} day${vs.days === 1 ? '' : 's'} in this period (${vs.perWeek.toFixed(1)} a week).`]);
  for (const [k, lab] of [['afterImod', 'Imodium'], ['afterGasx', 'Gas-X']])
    if (vs.n >= 2 && vs[k] / vs.n >= .5) out.push(['🔍', `${vs[k]} of ${vs.n} vomiting episodes came within 6h after taking ${lab}.`]);
  return out;
}
function insights(list, from, to, cur, timing) {
  const out = [], poops = list.filter(e => e.ev === 'poop' && e.ts >= from && e.ts <= to);
  if (!poops.length) return out;
  out.push(['📊', `${cur.perDay.toFixed(1)} poops a day on average, typically ${fmtDur(median(cur.gaps))} apart.`]);
  if (isFinite(cur.type)) {
    const hard = poops.filter(p => p.b && p.b <= 2).length, loose = poops.filter(p => p.b >= 6).length, typed = poops.filter(p => p.b).length;
    out.push(['🎯', `Average type ${cur.type.toFixed(1)} (${typeLabel(cur.type).toLowerCase()}). ${Math.round(hard / typed * 100)}% hard (1–2), ${Math.round(loose / typed * 100)}% loose (6–7).`]);
  }
  const hrs = Array(8).fill(0); poops.forEach(p => hrs[Math.floor(new Date(p.ts).getHours() / 3)]++);
  const pk = hrs.indexOf(Math.max(...hrs)), lab = h => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
  if (poops.length >= 4 && hrs[pk] / poops.length >= .35) out.push(['🕘', `Most poops happen between ${lab(pk * 3)} and ${lab(pk * 3 + 3)} (${Math.round(hrs[pk] / poops.length * 100)}%).`]);
  for (const m of MEDS) {
    const t = timing[m]; if (t.n < 2) continue;
    const top = Object.entries(t.cat).sort((a, b) => b[1] - a[1])[0];
    const words = { before: 'within 3h before a poop', during: 'around the same time as a poop', after: 'within 3h after a poop', apart: 'more than 3h away from any poop' };
    out.push([EMOJI[m], `${EV[m].label} is most often taken ${words[top[0]]} (${Math.round(top[1] / t.n * 100)}% of ${t.n} doses).`]);
    if (t.toNext.length >= 3) out.push(['⏱️', `After ${EV[m].label}, the next poop typically comes ${fmtDur(median(t.toNext))} later.`]);
  }
  const mx = timing.imodium, typed = poops.filter(p => p.b);
  if (mx.afterTypes.length >= 3) {
    const doses = list.filter(e => e.ev === 'imodium');
    const other = typed.filter(p => !doses.some(d => p.ts > d.ts && p.ts - d.ts <= 24 * HOUR)).map(p => p.b);
    if (other.length >= 3) {
      const a = mean(mx.afterTypes), b = mean(other), diff = a - b;
      out.push(['🔍', Math.abs(diff) < .4 ? `Stool type looks about the same in the 24h after Imodium (${a.toFixed(1)}) as at other times (${b.toFixed(1)}).`
        : `Stools are ${diff > 0 ? 'softer' : 'firmer'} in the 24h after Imodium: avg type ${a.toFixed(1)} vs ${b.toFixed(1)} otherwise.`]);
    }
  }
  if (cur.gaps.length) {
    const g = Math.max(...cur.gaps); if (g > 36 * HOUR) out.push(['⚠️', `Longest stretch without a poop: ${fmtDur(g)}.`]);
  }
  return out;
}

function renderTrends(list) {
  const el = $('#trends');
  if (!list.length) { el.innerHTML = `<div class="empty">Trends appear once a few entries are logged.</div>`; return; }
  const now = Date.now(), r = ui.range;
  const from = r ? startOfDay(addDays(now, -(r - 1))) : startOfDay(list[0].ts), to = now;
  const inR = list.filter(e => e.ts >= from && e.ts <= to), poops = inR.filter(e => e.ev === 'poop');
  const nDays = Math.round((startOfDay(now) - from) / DAY) + 1;
  const days = Array.from({ length: nDays }, (_, i) => {
    const s = addDays(from, i), e = addDays(s, 1), d = inR.filter(x => x.ts >= s && x.ts < e);
    const p = d.filter(x => x.ev === 'poop');
    return { ts: s, poops: p.length, type: mean(p.filter(x => x.b).map(x => x.b)), vomit: d.filter(x => x.ev === 'vomit').length, imodium: d.filter(x => x.ev === 'imodium').length, gasx: d.filter(x => x.ev === 'gasx').length };
  });
  const effDays = Math.max(1, (to - Math.max(from, startOfDay(list[0].ts))) / DAY);
  const gaps = []; for (let i = 1; i < poops.length; i++) gaps.push(poops[i].ts - poops[i-1].ts);
  const cur = { perDay: poops.length / effDays, type: mean(poops.filter(p => p.b).map(p => p.b)), gaps };
  const timing = Object.fromEntries(MEDS.map(m => [m, doseTiming(list, m, from, to)]));
  const vs = vomitStats(list, from, to, effDays);
  const ins = [...insights(list, from, to, cur, timing), ...vomitInsights(vs)];
  const wk = weeks(list);
  const pct = (c, n) => n ? Math.round(c / n * 100) : 0;

  el.innerHTML = `
  ${ins.length ? `<div class="card"><h3>Patterns</h3><ul class="insights">${ins.map(([i, t]) => `<li><span>${i}</span><span>${esc(t)}</span></li>`).join('')}</ul></div>` : ''}

  <div class="card"><h3>Poops per day</h3><p class="sub">Bars are poops. Marks underneath are vomiting (◆) and medicine doses (●) that day.</p>
    ${chartDaily(days)}
    <div class="legend"><span><i style="background:var(--poop)"></i>Poops</span><span><i class="dia" style="background:var(--vomit)"></i>Vomit (V)</span><span><i class="dot" style="background:var(--imod)"></i>Imodium (Im)</span><span><i class="dot" style="background:var(--gasx)"></i>Gas-X (Gx)</span></div>
  </div>

  <div class="card"><h3>Stool type over time</h3><p class="sub">Each dot is one poop. The line is the average of the last 5.</p>
    ${chartTypeOverTime(list, from, to)}
    <div class="legend"><span><i class="dot" style="background:${BCOL[1]}"></i>Hard</span><span><i class="dot" style="background:${BCOL[4]}"></i>Ideal</span><span><i class="dot" style="background:${BCOL[7]}"></i>Loose</span><span><i class="dia" style="background:var(--vomit)"></i>Vomit</span><span><i class="tri" style="--c:var(--imod)"></i>Imodium</span><span><i class="tri" style="--c:var(--gasx)"></i>Gas-X</span></div>
  </div>

  <div class="card"><h3>Type mix</h3><p class="sub">${poops.filter(p => p.b).length} poops with a recorded type</p>${chartMix(poops)}</div>

  <div class="card"><h3>Vomiting</h3>
    ${vs.n ? `<div class="statgrid">
      <div class="stat"><b>${vs.n}</b><span>times in this period</span></div>
      <div class="stat"><b>${vs.perWeek.toFixed(1)}</b><span>per week</span></div>
      <div class="stat"><b>${vs.days}</b><span>day${vs.days === 1 ? '' : 's'} with vomiting</span></div>
      <div class="stat"><b>${ago(vs.last).replace(' ago', '')}</b><span>since the last time</span></div></div>
    <div class="timing">
      ${[['afterImod', 'After Imodium'], ['afterGasx', 'After Gas-X'], ['nearPoop', 'Near a poop']].map(([k, l]) =>
        `<div class="tbar"><span>${l}</span><span class="track"><span class="fill" style="display:block;width:${pct(vs[k], vs.n)}%"></span></span><span class="pct">${pct(vs[k], vs.n)}%</span></div>`).join('')}
      <p class="sub" style="margin:6px 0 0">“After” means the medicine was taken in the 6 hours before vomiting. “Near a poop” means within 2 hours either side.</p></div>`
    : `<p class="sub" style="margin:0">None logged in this period.</p>`}
  </div>

  <div class="card"><h3>Medicine</h3>
    <div class="statgrid">${MEDS.map(m => `<div class="stat"><b>${(timing[m].n / effDays).toFixed(1)}</b><span>${EV[m].label} / day</span></div>`).join('')}
      ${MEDS.map(m => `<div class="stat"><b>${(timing[m].n / effDays * 7).toFixed(1)}</b><span>${EV[m].label} / week</span></div>`).join('')}</div>
    ${MEDS.map(m => { const t = timing[m]; return `<div class="timing"><h4><i style="--c:${EV[m].color}"></i>${EV[m].label} timing <span class="sub" style="margin:0;font-weight:400">(${t.n} dose${t.n === 1 ? '' : 's'})</span></h4>
      ${[['before', 'Before a poop'], ['during', 'During (±15m)'], ['after', 'After a poop'], ['apart', 'Not near one']].map(([k, l]) =>
        `<div class="tbar"><span>${l}</span><span class="track"><span class="fill" style="display:block;width:${pct(t.cat[k], t.n)}%"></span></span><span class="pct">${pct(t.cat[k], t.n)}%</span></div>`).join('')}
      ${t.toNext.length ? `<div class="sub" style="margin:6px 0 0">Next poop comes a median of <b style="color:var(--text)">${fmtDur(median(t.toNext))}</b> after a dose.</div>` : ''}</div>`; }).join('')}
    <p class="sub" style="margin:10px 0 0">“Before” and “after” mean within 3 hours of a poop.</p>
  </div>

  <div class="card"><h3>Time of day</h3>${chartHours(poops)}</div>

  ${wk.length ? `<div class="card"><h3>Weekly averages</h3><table class="weeks"><thead><tr><th>Week of</th><th>Poops/d</th><th>Type</th><th>Imod/d</th><th>Gas-X/d</th><th>Vomit</th></tr></thead><tbody>
    ${wk.map(w => `<tr><td>${new Date(w.s).toLocaleDateString([], { month: 'short', day: 'numeric' })}</td><td>${w.perDay.toFixed(1)}</td><td>${isFinite(w.type) ? w.type.toFixed(1) : '–'}</td><td>${w.imod.toFixed(1)}</td><td>${w.gasx.toFixed(1)}</td><td>${w.vomit || '–'}</td></tr>`).join('')}
  </tbody></table></div>` : ''}`;
}

/* ---------- render all ---------- */
function render() {
  const list = entries();
  renderKpis(list); renderRecent(list); renderBanner(); renderDyk(list);
  if (ui.tab === 'history') renderHistory(list);
  if (ui.tab === 'trends') renderTrends(list);
  setStatus();
}
const motionOK = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
// Plays the "rise in" cascade on a view once; background saves re-render without it.
function enter(el) { if (!el || !motionOK()) return; el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); clearTimeout(el._enterT); el._enterT = setTimeout(() => el.classList.remove('enter'), 1100); }
function setTab(t) {
  ui.tab = t; save(K.ui, ui);
  $('.tabs').style.setProperty('--i', ['home', 'history', 'trends'].indexOf(t)); // slides the lit pill
  $$('.tab').forEach(b => { b.classList.toggle('is-on', b.dataset.tab === t); b.setAttribute('aria-selected', b.dataset.tab === t); });
  $$('.view').forEach(v => v.classList.toggle('is-on', v.id === `view-${t}`));
  if (t !== 'home') closePicker();
  render();
  enter($(`#view-${t}`));
}

/* ---------- logging ---------- */
let toastTimer = 0, undoFn = null;
function toast(msg, undo = null, ms = 5000) {
  undoFn = undo;
  $('#toastText').textContent = msg; $('#toastUndo').hidden = !undoFn;
  const t = $('#toast'); t.hidden = true; void t.offsetWidth; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; undoFn = null; }, ms);
}
const delOne = e => { queue({ op: 'del', id: e.id }); toast('Entry deleted', () => queue({ op: 'add', e })); };
function log(ev, b = null, ts = Date.now()) {
  const e = { id: newId(), ts: Math.floor(ts / 1000) * 1000, ev, b };
  queue({ op: 'add', e }); buzz();
  const btn = $(`.act[data-act="${ev}"]`); btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
  if (motionOK()) { const f = document.createElement('span'); f.className = 'float-ok'; f.textContent = '✓'; btn.appendChild(f); setTimeout(() => f.remove(), 950); }
  toast(ev === 'poop' ? `💩 Type ${b} logged${ts < Date.now() - MIN ? ` at ${fmtTime(ts)}` : ''}` : `${EMOJI[ev]} ${EV[ev].label} logged at ${fmtTime(ts)}`, () => queue({ op: 'del', id: e.id }));
}
let pickAgo = 0;
function openPicker() {
  pickAgo = 0; $$('#when .chip').forEach(c => c.classList.toggle('is-on', c.dataset.ago === '0'));
  if (motionOK()) $$('.b-opt').forEach((o, i) => { o.style.setProperty('--d', `${120 + i * 70}ms`); o.style.removeProperty('--h'); plop(o); });
  $('#actions').hidden = true; $('#recent').hidden = true; $('#kpis').hidden = true; $('#dyk').classList.add('picking'); $('#banner').classList.add('picking'); $('#picker').hidden = false; scrollTo(0, 0); buzz();
}
// restart the consistency-based "plop" on one Bristol choice
function plop(el) { el.classList.remove('plop'); void el.offsetWidth; el.classList.add('plop'); }
let pickBusy = false;
function closePicker() { $('#actions').hidden = false; $('#recent').hidden = false; $('#kpis').hidden = false; $('#dyk').classList.remove('picking'); $('#banner').classList.remove('picking'); $('#picker').hidden = true; }

/* ---------- edit dialog ---------- */
let editing = null;
const toLocalInput = ts => `${dayKey(ts)}T${hm(ts)}`;
function openEdit(id) {
  const e = entries().find(x => x.id === id); if (!e) return;
  editing = e;
  $('#editTitle').textContent = `Edit ${EV[e.ev].label}`;
  $('#editWhen').value = toLocalInput(e.ts);
  $('#editTypeWrap').hidden = e.ev !== 'poop';
  $('#editType').value = e.b || '';
  $('#editDlg').showModal();
}

/* ---------- files ---------- */
let xlsxP = null;
const loadXLSX = () => xlsxP || (xlsxP = new Promise((res, rej) => {
  if (window.XLSX) return res(window.XLSX);
  const s = document.createElement('script');
  s.src = 'vendor/xlsx.full.min.js'; // SheetJS 0.18.5, bundled so Excel files work offline
  s.onload = () => res(window.XLSX); s.onerror = () => { xlsxP = null; rej(new Error('Could not load the Excel library')); };
  document.head.appendChild(s);
}));
async function xlsxBlob(list) {
  const X = await loadXLSX(), ws = X.utils.aoa_to_sheet([CSV_HEAD, ...toRows(list)]);
  ws['!cols'] = [10, 26, 12, 7, 8, 10, 12, 48].map(w => ({ wch: w }));
  const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Log');
  return new Blob([X.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function importFile(file) {
  let rows;
  if (/\.xlsx?$/i.test(file.name)) {
    const X = await loadXLSX(), wb = X.read(await file.arrayBuffer(), { cellDates: true });
    rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, dateNF: 'yyyy-mm-dd hh:mm' });
  } else rows = parseDelimited(await file.text());
  const found = rowsToEntries(rows), have = entries();
  const ids = new Set(have.map(e => e.id)), keys = new Set(have.map(e => `${e.ev}|${Math.round(e.ts / MIN)}`));
  const fresh = found.filter(e => !ids.has(e.id) && !keys.has(`${e.ev}|${Math.round(e.ts / MIN)}`));
  if (fresh.length) queue(...fresh.map(e => ({ op: 'add', e })));
  return { found: found.length, added: fresh.length };
}

/* ---------- tooltip ---------- */
const tip = $('#tip');
function showTip(el, x, y) {
  tip.textContent = el.getAttribute('data-tip'); tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(innerWidth - r.width - 8, Math.max(8, x - r.width / 2)) + 'px';
  tip.style.top = Math.max(8, y - r.height - 14) + 'px';
}
document.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  const el = e.target.closest && e.target.closest('[data-tip]');
  el ? showTip(el, e.clientX, e.clientY) : (tip.hidden = true);
});
document.addEventListener('click', e => {
  const el = e.target.closest && e.target.closest('[data-tip]');
  el ? showTip(el, e.clientX, e.clientY) : (tip.hidden = true);
});
addEventListener('scroll', () => tip.hidden = true, { passive: true });

/* ---------- "Did you know?": the most statistically significant pattern in the whole log ----------
 * Each candidate pattern gets a proper test (Welch t, Mann-Whitney U, Fisher exact, chi-square,
 * regression slope). Because several patterns are checked, p-values are Bonferroni-adjusted
 * before a pattern is called reliable. Shown once the log is at least a week old. */
const ST = (() => {
  const lnG = x => { const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, t = x + 5.5; t -= (x + .5) * Math.log(t); let ser = 1.000000000190015; for (const v of c) ser += v / ++y; return -t + Math.log(2.5066282746310005 * ser / x); };
  const tiny = v => Math.abs(v) < 1e-30 ? 1e-30 : v;
  function betacf(a, b, x) {
    const qab = a + b, qap = a + 1, qam = a - 1; let c = 1, d = 1 / tiny(1 - qab * x / qap), h = d;
    for (let m = 1; m <= 300; m++) {
      const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 / tiny(1 + aa * d); c = tiny(1 + aa / c); h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 / tiny(1 + aa * d); c = tiny(1 + aa / c); const del = d * c; h *= del;
      if (Math.abs(del - 1) < 3e-12) break;
    }
    return h;
  }
  const ibeta = (x, a, b) => { if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(lnG(a + b) - lnG(a) - lnG(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b; };
  const tP = (t, df) => ibeta(df / (df + t * t), df / 2, .5); // two-sided
  function gammq(a, x) { // upper regularized incomplete gamma
    if (x <= 0) return 1;
    if (x < a + 1) { let ap = a, sum = 1 / a, del = sum; for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 3e-12) break; }
      return 1 - sum * Math.exp(-x + a * Math.log(x) - lnG(a)); }
    let b = x + 1 - a, c = 1 / 1e-30, d = 1 / b, h = d;
    for (let i = 1; i < 500; i++) { const an = -i * (i - a); b += 2; d = 1 / tiny(an * d + b); c = tiny(b + an / c); const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-12) break; }
    return Math.exp(-x + a * Math.log(x) - lnG(a)) * h;
  }
  const zP = z => { const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + .5 * x); // 2-sided normal, via erfc
    return t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (.37409196 + t * (.09678418 + t * (-.18628806 + t * (.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-.82215223 + t * .17087277))))))))); };
  const varOf = a => { const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1); };
  function welch(a, b) {
    if (a.length < 3 || b.length < 3) return null;
    const v1 = varOf(a) / a.length, v2 = varOf(b) / b.length, se = Math.sqrt(v1 + v2);
    if (!se) return null;
    const df = (v1 + v2) ** 2 / (v1 * v1 / (a.length - 1) + v2 * v2 / (b.length - 1));
    return tP((mean(a) - mean(b)) / se, df);
  }
  function mannWhitney(a, b) {
    const n1 = a.length, n2 = b.length, N = n1 + n2; if (n1 < 4 || n2 < 4) return null;
    const all = [...a.map(v => [v, 0]), ...b.map(v => [v, 1])].sort((x, y) => x[0] - y[0]);
    let R1 = 0, ties = 0;
    for (let i = 0; i < N;) { let j = i; while (j + 1 < N && all[j + 1][0] === all[i][0]) j++;
      const r = (i + j) / 2 + 1, t = j - i + 1; ties += t ** 3 - t; for (let k = i; k <= j; k++) if (!all[k][1]) R1 += r; i = j + 1; }
    const U = R1 - n1 * (n1 + 1) / 2, mu = n1 * n2 / 2, sd = Math.sqrt(n1 * n2 / 12 * ((N + 1) - ties / (N * (N - 1))));
    if (!sd) return null;
    return zP((Math.abs(U - mu) - .5) / sd);
  }
  function fisher(a, b, c, d) { // 2x2 table [[a, b], [c, d]], two-sided
    const lf = n => lnG(n + 1), r1 = a + b, r2 = c + d, c1 = a + c, n = r1 + r2;
    const pr = x => Math.exp(lf(r1) + lf(r2) + lf(c1) + lf(n - c1) - lf(n) - lf(x) - lf(r1 - x) - lf(c1 - x) - lf(r2 - c1 + x));
    const p0 = pr(a); let p = 0;
    for (let x = Math.max(0, c1 - r2); x <= Math.min(r1, c1); x++) { const px = pr(x); if (px <= p0 * (1 + 1e-7)) p += px; }
    return Math.min(1, p);
  }
  function slope(xs, ys) {
    const n = xs.length; if (n < 6) return null;
    const mx = mean(xs), my = mean(ys); let sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
    if (!sxx) return null;
    const b = sxy / sxx, a = my - b * mx; let ss = 0; for (let i = 0; i < n; i++) ss += (ys[i] - a - b * xs[i]) ** 2;
    const se = Math.sqrt(ss / (n - 2) / sxx); if (!se) return null;
    return { b, a, p: tP(b / se, n - 2) };
  }
  const chiUniform = obs => { const n = obs.reduce((s, x) => s + x, 0), e = n / obs.length;
    return gammq((obs.length - 1) / 2, obs.reduce((s, o) => s + (o - e) ** 2 / e, 0) / 2); };
  return { tP, zP, gammq, welch, mannWhitney, fisher, slope, chiUniform };
})();

function didYouKnow(list) {
  if (!list.length || Date.now() - list[0].ts < 7 * DAY) return null;
  const first = startOfDay(list[0].ts), today = startOfDay(Date.now());
  const days = []; // complete days only
  for (let d = first; d < today; d = addDays(d, 1)) {
    const inD = list.filter(e => e.ts >= d && e.ts < addDays(d, 1)), has = ev => inD.some(e => e.ev === ev);
    days.push({ d, poops: inD.filter(e => e.ev === 'poop').length, imodium: has('imodium'), gasx: has('gasx'), vomit: has('vomit') });
  }
  const poops = list.filter(e => e.ev === 'poop'), typed = poops.filter(p => p.b);
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1), pct = (a, n) => Math.round(a / n * 100);
  const facts = [];
  for (const m of MEDS) {
    const name = EV[m].label, doses = list.filter(e => e.ev === m);
    if (doses.length >= 3) {
      const after = p => doses.some(d => p.ts > d.ts && p.ts - d.ts <= 24 * HOUR);
      const a = typed.filter(after).map(p => p.b), b = typed.filter(p => !after(p)).map(p => p.b), p = ST.mannWhitney(a, b);
      if (p !== null && Math.abs(mean(a) - mean(b)) >= .3)
        facts.push({ p, text: `Stools are ${mean(a) < mean(b) ? 'firmer' : 'looser'} in the 24 hours after ${name}: average type ${f1(mean(a))}, vs ${f1(mean(b))} at other times.` });
      const on = days.filter(d => d[m]).map(d => d.poops), off = days.filter(d => !d[m]).map(d => d.poops), q = ST.welch(on, off);
      if (q !== null && Math.abs(mean(on) - mean(off)) >= .3)
        facts.push({ p: q, text: `On days she takes ${name}, she poops ${f1(mean(on))} times on average, vs ${f1(mean(off))} on days without it.` });
      const vOn = days.filter(d => d[m] && d.vomit).length, nOn = days.filter(d => d[m]).length, vOff = days.filter(d => !d[m] && d.vomit).length, nOff = days.length - nOn;
      if (vOn + vOff >= 2 && nOn >= 3 && nOff >= 3)
        facts.push({ p: ST.fisher(vOn, nOn - vOn, vOff, nOff - vOff), text: `She vomited on ${pct(vOn, nOn)}% of days with ${name}, vs ${pct(vOff, nOff)}% of days without it.` });
    }
  }
  const wake = poops.filter(p => new Date(p.ts).getHours() >= 6); // 6am–midnight, so sleep doesn't make every pattern look "significant"
  if (wake.length >= 12) {
    const bins = Array(6).fill(0); wake.forEach(p => bins[Math.floor((new Date(p.ts).getHours() - 6) / 3)]++);
    const top = bins.indexOf(Math.max(...bins)), lab = h => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
    facts.push({ p: ST.chiUniform(bins), text: `${pct(bins[top], wake.length)}% of her daytime poops happen between ${lab(6 + top * 3)} and ${lab(9 + top * 3)}, about ${f1(bins[top] / wake.length * 6)}× what you'd expect if they were spread evenly.` });
  }
  if (typed.length >= 8) {
    const r = ST.slope(typed.map(p => (p.ts - first) / DAY), typed.map(p => p.b));
    if (r && Math.abs(r.b * 7) >= .2) {
      const span = (typed[typed.length - 1].ts - first) / DAY;
      facts.push({ p: r.p, text: `Her stools have been getting ${r.b < 0 ? 'firmer' : 'looser'} over time: from about type ${f1(r.a)} at the start to about ${f1(r.a + r.b * span)} now.` });
    }
  }
  if (days.length >= 7) {
    const r = ST.slope(days.map((_, i) => i), days.map(d => d.poops));
    if (r && Math.abs(r.b * 7) >= .2)
      facts.push({ p: r.p, text: `She's been pooping ${r.b > 0 ? 'more' : 'less'} often over time: from about ${f1(Math.max(0, r.a))} a day at the start to about ${f1(Math.max(0, r.a + r.b * (days.length - 1)))} now.` });
  }
  if (!facts.length) return { facts: [], days: days.length, m: 0 };
  const m = facts.length;
  facts.forEach(f => f.adj = Math.min(1, f.p * m));
  facts.sort((a, b) => a.p - b.p);
  const solid = facts.filter(f => f.adj < .05);
  return { facts: solid.length ? solid : [facts[0]], days: days.length, m };
}
let dykIdx = 0;
function renderDyk(list) {
  const el = $('#dyk'); if (!el) return;
  const r = didYouKnow(list);
  if (!r) { el.hidden = true; return; }
  if (!r.facts.length) { el.innerHTML = `<div class="dyk-head">💡 Did you know?</div><p>No clear patterns yet in ${r.days} days of data. Keep logging and check back.</p>`; el.hidden = false; return; }
  const f = r.facts[dykIdx % r.facts.length], adj = f.adj;
  const conf = adj < .001 ? 'Very unlikely to be chance' : adj < .01 ? 'Unlikely to be chance' : adj < .05 ? 'Probably not chance' : 'Early sign, could still be chance';
  const pv = adj < .001 ? '< 0.001' : adj.toFixed(3);
  el.innerHTML = `<div class="dyk-head">💡 Did you know?${r.facts.length > 1 ? `<button type="button" class="dyk-next">Next (${dykIdx % r.facts.length + 1}/${r.facts.length})</button>` : ''}</div>
    <p>${esc(f.text)}</p>
    <p class="dyk-sub"><b class="${adj < .05 ? 'sig' : 'tent'}">${conf}</b> · p ${pv} after checking ${r.m} pattern${r.m === 1 ? '' : 's'} · ${r.days} days of data. A pattern, not proof of cause: worth mentioning to her doctor.</p>`;
  el.hidden = false;
}

/* ---------- where it's saved: places list + home-screen warning ---------- */
function placeLine(t) {
  const st = tstat[t] || {};
  if (st.err === 'perm') return 'Needs permission again';
  if (st.err) return esc(st.err);
  if (waiting(t)) return `${waiting(t)} change${waiting(t) === 1 ? '' : 's'} waiting to save`;
  return st.ok ? `Last saved ${ago(st.ok)}` : 'Not saved yet';
}
function placesHTML() {
  const row = (state, title, sub) => `<li class="place is-${state}"><span class="pi" aria-hidden="true">${state === 'ok' ? '✓' : state === 'warn' ? '!' : '+'}</span><span><b>${title}</b><small>${sub}</small></span></li>`;
  const lc = load(K.copy, 0);
  let h = row('ok', 'Inside this app', `${local.length} entries · a backup is kept each day for 30 days`);
  h += cfg.fileName ? row(tstat.file?.err ? 'warn' : 'ok', `File: ${esc(cfg.fileName)}`, placeLine('file'))
                    : row('off', FS_OK ? 'A file on this phone' : 'Copies in Files', FS_OK ? 'Not set up' : (lc ? `Last copy saved ${ago(lc)}` : 'No copy saved yet'));
  h += gsConnected() ? row(tstat.gsheet?.err ? 'warn' : 'ok', 'Google Sheet: Gut Check log', placeLine('gsheet') + (cfg.gsSheetUrl ? ` · <a href="${esc(cfg.gsSheetUrl)}" target="_blank" rel="noopener">Open ↗</a>` : '')) : row('off', 'Online backup (Google Sheet)', 'Not set up');
  if (connected()) h += row(tstat.github?.err ? 'warn' : 'ok', `GitHub: ${esc(cfg.repo)}`, placeLine('github'));
  const n = 1 + targets().length;
  return `<ul class="places">${h}</ul><p class="places-sum ${n > 1 ? 'good' : 'bad'}">${n > 2 ? `✓ Saved in ${n} places. Very safe.` : n > 1 ? '✓ Saved in 2 places.' : '⚠ Only saved inside this app. Add a backup so the log can never be lost.'}</p>`;
}
function refreshPlaces() { $$('.places-box').forEach(el => el.innerHTML = placesHTML()); }
function renderBanner() {
  const el = $('#banner'); if (!el) return;
  const ts = targets(); let html = '';
  if (!ts.length) {
    const lc = load(K.copy, 0);
    html = `<span><b>⚠ Only saved inside this app.</b> If the phone is lost or the browser is cleared, the log is gone.${lc ? ` Last copy saved ${ago(lc)}.` : ''}</span><button type="button" data-b="wizard">Set up a backup</button>`;
  } else if (ts.some(t => tstat[t]?.err === 'perm')) {
    html = `<span><b>The file needs permission again.</b> New entries are waiting to be saved to ${esc(cfg.fileName)}.</span><button type="button" data-b="allow">Allow</button>`;
  } else {
    const bad = ts.filter(t => tstat[t]?.err && Date.now() - (tstat[t].errAt || 0) > HOUR);
    if (bad.length) html = `<span><b>⚠ Couldn't save to ${bad.map(t => esc(PLACE[t]())).join(' or ')} for ${fmtDur(Date.now() - tstat[bad[0]].errAt)}.</b> ${esc(tstat[bad[0]].err)}</span><button type="button" data-b="settings">Fix</button>`;
  }
  el.innerHTML = html; el.hidden = !html;
}

/* ---------- wizard pictures: little mock-ups of each screen, with a pulsing dot on what to tap ---------- */
const TAP = (x, y) => `<circle class="tap-ring" cx="${x}" cy="${y}" r="13"/><circle class="tap-dot" cx="${x}" cy="${y}" r="6"/>`;
const WIN = (x, y, w, h, title = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="#2c2c29" stroke="#46463f"/>
  <circle cx="${x + 10}" cy="${y + 9}" r="2.5" fill="#e66767"/><circle cx="${x + 18}" cy="${y + 9}" r="2.5" fill="#fab219"/><circle cx="${x + 26}" cy="${y + 9}" r="2.5" fill="#5fd35f"/>
  ${title ? `<text x="${x + w / 2}" y="${y + 12}" class="it" text-anchor="middle">${title}</text>` : ''}`;
const GRID = (x, y, w, h) => { let g = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f4f6f8"/><rect x="${x}" y="${y}" width="${w}" height="10" fill="#cfe9d8"/>`;
  for (let i = 1; i < 6; i++) g += `<line x1="${x}" x2="${x + w}" y1="${y + 10 + i * (h - 10) / 6}" y2="${y + 10 + i * (h - 10) / 6}" stroke="#d6dbe1"/>`;
  for (let i = 1; i < 5; i++) g += `<line y1="${y}" y2="${y + h}" x1="${x + i * w / 5}" x2="${x + i * w / 5}" stroke="#d6dbe1"/>`; return g; };
const SHEETICON = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 4 a4 4 0 0 1 4 -4 h18 l10 10 v30 a4 4 0 0 1 -4 4 h-24 a4 4 0 0 1 -4 -4z" fill="#22a55a"/><path d="M22 0 v10 h10" fill="#7fd3a1"/><rect x="6" y="18" width="20" height="16" fill="#fff"/><path d="M6 24 h20 M6 29 h20 M14 18 v16" stroke="#22a55a" stroke-width="1.5"/></g>`;
const svg = (inner, label) => `<svg viewBox="0 0 280 150" role="img" aria-label="${label}">${inner}</svg>`;
const ILL = {
  welcome: svg(`<rect x="38" y="18" width="72" height="118" rx="13" fill="#2c2c29" stroke="#55554e" stroke-width="2"/><rect x="45" y="30" width="58" height="94" rx="5" fill="#1a1a19"/>
    <g transform="translate(56 50) scale(.56)">${ICON.poop.replace(/<svg[^>]*>|<\/svg>/g, '')}</g>
    <path d="M116 78 C140 52 160 52 178 66" stroke="#9ec5f4" stroke-width="3" fill="none" stroke-dasharray="6 6" class="flow"/><path d="M172 58 l9 9 l-12 3" fill="none" stroke="#9ec5f4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M186 104 h66 a19 19 0 0 0 0 -38 a26 26 0 0 0 -50 -7 a21 21 0 0 0 -16 45z" fill="#20354f" stroke="#6da7ec" stroke-width="2.5"/>
    ${SHEETICON(206, 60, .9)}<circle cx="248" cy="96" r="13" fill="#0ca30c" stroke="#1a1a19" stroke-width="3"/><path d="M242 96 l4 4 l8 -8" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`, 'Phone saving to Google Drive'),
  copycode: svg(`<rect x="70" y="22" width="96" height="118" rx="10" fill="#e9edf2"/><rect x="94" y="13" width="48" height="18" rx="6" fill="#8d96a1"/>
    ${[[84, 46, 50, '#3987e5'], [84, 58, 66, '#22a55a'], [92, 70, 54, '#8d96a1'], [92, 82, 44, '#d95926'], [84, 94, 60, '#3987e5'], [92, 106, 40, '#8d96a1'], [84, 118, 30, '#22a55a']].map(([x, y, w, c]) => `<rect x="${x}" y="${y}" width="${w}" height="6" rx="3" fill="${c}"/>`).join('')}
    <rect x="182" y="66" width="80" height="34" rx="17" fill="#3987e5"/><text x="222" y="88" class="ib" text-anchor="middle">Copy</text>${TAP(258, 96)}`, 'Copy the code'),
  editor: svg(`${WIN(14, 10, 252, 132, 'script.new')}<rect x="22" y="26" width="236" height="20" rx="4" fill="#3a3a35"/>
    <text x="34" y="40" class="it2">Untitled project</text>
    <rect x="200" y="29" width="14" height="14" rx="2" fill="#6da7ec"/><rect x="203" y="31" width="8" height="5" fill="#fff"/><rect x="203" y="38" width="8" height="4" fill="#20354f"/>${TAP(207, 36)}
    ${[[30, 56, 70, '#d95926'], [38, 68, 110, '#6da7ec'], [38, 80, 90, '#5fd35f'], [38, 92, 120, '#c3c2b7'], [30, 104, 40, '#d95926'], [30, 116, 80, '#6da7ec']].map(([x, y, w, c]) => `<rect x="${x}" y="${y}" width="${w}" height="6" rx="3" fill="${c}" opacity=".85"/>`).join('')}
    <rect x="172" y="84" width="84" height="34" rx="17" fill="#f0efec"/><text x="214" y="105" class="id" text-anchor="middle">📋 Paste</text>`, 'Paste the code in Apps Script, then Save'),
  deploy: svg(`${WIN(8, 10, 128, 130, 'Apps Script')}<rect x="78" y="24" width="52" height="16" rx="8" fill="#3987e5"/><text x="104" y="35" class="ib2" text-anchor="middle">Deploy ▾</text>
    <rect x="40" y="44" width="92" height="40" rx="5" fill="#3a3a35" stroke="#55554e"/><text x="47" y="59" class="imb">New deployment</text><text x="47" y="76" class="im">Manage…</text>${TAP(128, 58)}
    ${[50, 98, 110, 122].map((y, i) => `<rect x="18" y="${y + 40}" width="${[60, 90, 70, 50][i]}" height="4" rx="2" fill="#4a4a45"/>`).join('')}
    <path d="M140 75 h10" stroke="#9ec5f4" stroke-width="3"/><path d="M146 70 l6 5 l-6 5" stroke="#9ec5f4" stroke-width="3" fill="none"/>
    <rect x="156" y="14" width="116" height="122" rx="9" fill="#e9edf2"/><text x="166" y="32" class="id">⚙ Web app</text>
    <text x="166" y="54" class="id2">Execute as</text><rect x="166" y="58" width="96" height="14" rx="3" fill="#fff" stroke="#c3c9d1"/><text x="171" y="68" class="id">Me</text>
    <text x="166" y="86" class="id2">Who has access</text><rect x="166" y="90" width="96" height="14" rx="3" fill="#fff" stroke="#fab219" stroke-width="2.5"/><text x="171" y="100" class="id">Anyone</text>
    <rect x="216" y="112" width="46" height="16" rx="8" fill="#3987e5"/><text x="239" y="123" class="ib2" text-anchor="middle">Deploy</text>${TAP(262, 126)}`, 'Deploy as a web app, access Anyone'),
  allow: svg(`<rect x="10" y="22" width="80" height="100" rx="9" fill="#e9edf2"/><text x="50" y="44" text-anchor="middle" style="font-size:20px">⚠️</text><text x="50" y="62" class="id" text-anchor="middle">Not verified</text>
    <text x="22" y="98" class="ilink">Advanced</text>${TAP(74, 99)}
    <path d="M96 72 h10" stroke="#9ec5f4" stroke-width="3"/>
    <rect x="112" y="22" width="80" height="100" rx="9" fill="#e9edf2"/><text x="152" y="44" class="id" text-anchor="middle">Advanced</text><text x="120" y="80" class="ilink">Go to</text><text x="120" y="92" class="ilink">… (unsafe)</text>${TAP(186, 94)}
    <path d="M198 72 h10" stroke="#9ec5f4" stroke-width="3"/>
    <rect x="212" y="22" width="60" height="100" rx="9" fill="#e9edf2"/><text x="242" y="48" text-anchor="middle" style="font-size:18px">🔓</text><rect x="222" y="84" width="40" height="18" rx="9" fill="#3987e5"/><text x="242" y="96" class="ib2" text-anchor="middle">Allow</text>${TAP(264, 100)}`, 'Advanced, Go to, Allow'),
  weburl: svg(`<rect x="24" y="10" width="232" height="130" rx="10" fill="#e9edf2"/><text x="40" y="32" class="id" style="font-size:12px">New deployment</text>
    <text x="40" y="50" class="id2">✓ Deployment successfully created</text>
    <text x="40" y="72" class="id2">Web app</text>
    <rect x="40" y="78" width="200" height="22" rx="4" fill="#fff" stroke="#fab219" stroke-width="2.5"/><text x="46" y="93" class="id" style="font-size:8.5px;font-weight:600">https://script.google.com/macros/s/…/exec</text>
    <rect x="40" y="108" width="54" height="20" rx="10" fill="#3987e5"/><text x="67" y="122" class="ib2" text-anchor="middle">Copy</text>${TAP(96, 124)}
    <text x="232" y="122" class="ilink" text-anchor="end">Done</text>`, 'Copy the Web app link'),
  paste: svg(`<rect x="96" y="6" width="88" height="140" rx="14" fill="#2c2c29" stroke="#55554e" stroke-width="2"/><rect x="104" y="20" width="72" height="112" rx="5" fill="#1a1a19"/>
    <rect x="110" y="40" width="60" height="22" rx="11" fill="#f0efec"/><text x="140" y="55" class="id" text-anchor="middle">📥 Paste</text>${TAP(172, 56)}
    <rect x="110" y="70" width="60" height="18" rx="4" fill="#2c2c29" stroke="#55554e"/><text x="114" y="82" class="im" style="font-size:7px">https://script…</text>
    <rect x="110" y="96" width="60" height="20" rx="10" fill="#0ca30c"/><text x="140" y="110" class="ib2" text-anchor="middle">Connect ✓</text>
    <path d="M190 76 h18" stroke="#9ec5f4" stroke-width="3" stroke-dasharray="4 4" class="flow"/><path d="M204 70 l6 6 l-6 6" stroke="#9ec5f4" stroke-width="3" fill="none"/>${SHEETICON(222, 54, 1)}
    <text x="238" y="114" class="it" text-anchor="middle">Gut Check log</text>`, 'Paste the link and connect'),
  again: svg(`<rect x="70" y="6" width="140" height="140" rx="14" fill="#2c2c29" stroke="#55554e" stroke-width="2"/>${GRID(80, 22, 120, 84)}
    <rect x="80" y="44" width="120" height="13" fill="#fff6d6" stroke="#fab219" stroke-width="2"/><text x="84" y="54" class="id" style="font-size:7.5px">https://…#gsheet=…&amp;key=…</text>${TAP(196, 51)}
    <rect x="80" y="112" width="120" height="24" fill="#3a3a35"/><text x="98" y="128" class="im">Log</text>
    <rect x="128" y="115" width="56" height="18" rx="9" fill="#20354f" stroke="#fab219" stroke-width="2"/><text x="156" y="128" class="imb" text-anchor="middle">Connect</text>${TAP(186, 126)}
    <rect x="214" y="34" width="54" height="26" rx="8" fill="#f0efec"/><text x="241" y="51" class="id" text-anchor="middle">Copy</text>`, 'Connect tab, copy cell A2'),
  file: svg(`<rect x="34" y="14" width="78" height="124" rx="13" fill="#2c2c29" stroke="#55554e" stroke-width="2"/><rect x="42" y="28" width="62" height="96" rx="5" fill="#1a1a19"/>
    <path d="M52 62 h16 l5 6 h22 v34 h-43z" fill="#fab219"/><path d="M52 72 h43 v30 h-43z" fill="#ffd166"/>
    <path d="M122 76 h24" stroke="#9ec5f4" stroke-width="3" stroke-dasharray="5 5" class="flow"/><path d="M142 70 l7 6 l-7 6" stroke="#9ec5f4" stroke-width="3" fill="none"/>
    <path d="M168 40 a5 5 0 0 1 5 -5 h40 l18 18 v62 a5 5 0 0 1 -5 5 h-53 a5 5 0 0 1 -5 -5z" fill="#e9edf2"/><path d="M213 35 v18 h18" fill="#c3c9d1"/>
    <rect x="178" y="68" width="42" height="34" rx="3" fill="#22a55a"/><text x="199" y="90" class="ib2" text-anchor="middle">XLSX</text><text x="200" y="134" class="it" text-anchor="middle">gut-check.xlsx</text>`, 'Saving a file on the phone'),
  copy: svg(`<rect x="40" y="30" width="62" height="70" rx="12" fill="#3987e5"/><path d="M71 46 v34 M60 57 l11 -11 l11 11" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><text x="71" y="122" class="it" text-anchor="middle">Share</text>
    <path d="M114 64 h30" stroke="#9ec5f4" stroke-width="3" stroke-dasharray="5 5" class="flow"/><path d="M140 58 l7 6 l-7 6" stroke="#9ec5f4" stroke-width="3" fill="none"/>
    <path d="M164 40 h30 l8 9 h44 a6 6 0 0 1 6 6 v44 a6 6 0 0 1 -6 6 h-82 a6 6 0 0 1 -6 -6v-53 a6 6 0 0 1 6 -6z" fill="#6da7ec"/><path d="M158 60 h94 v39 a6 6 0 0 1 -6 6 h-82 a6 6 0 0 1 -6 -6z" fill="#9ec5f4"/><text x="208" y="122" class="it" text-anchor="middle">Save to Files</text>`, 'Share, then Save to Files'),
  restore: svg(`<circle cx="92" cy="76" r="44" fill="none" stroke="#9ec5f4" stroke-width="6" stroke-dasharray="230 60" transform="rotate(-60 92 76)"/><path d="M50 42 l2 22 l20 -8" fill="none" stroke="#9ec5f4" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M92 52 v26 l16 10" stroke="#f0efec" stroke-width="5" fill="none" stroke-linecap="round"/>
    ${[40, 62, 84, 106].map((y, i) => `<rect x="160" y="${y}" width="96" height="16" rx="5" fill="${i === 1 ? '#22a55a' : '#2c2c29'}" stroke="#46463f"/>`).join('')}`, 'Bring back old data'),
  done: svg(`<rect x="44" y="20" width="68" height="112" rx="12" fill="#2c2c29" stroke="#55554e" stroke-width="2"/>
    <g transform="translate(58 46) scale(.62)">${ICON.poop.replace(/<svg[^>]*>|<\/svg>/g, '')}</g>
    <path d="M118 76 h44" stroke="#5fd35f" stroke-width="4"/>${SHEETICON(176, 52, 1.1)}
    <circle cx="104" cy="122" r="13" fill="#0ca30c" stroke="#1a1a19" stroke-width="3"/><path d="M98 122 l4 4 l8 -8" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="212" cy="104" r="13" fill="#0ca30c" stroke="#1a1a19" stroke-width="3"/><path d="M206 104 l4 4 l8 -8" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>
    ${[[30, 20, '#fab219'], [250, 30, '#e87ba4'], [140, 24, '#6da7ec'], [262, 120, '#5fd35f'], [24, 120, '#d95926'], [150, 130, '#fab219']].map(([x, y, c]) => `<circle class="conf" cx="${x}" cy="${y}" r="4" fill="${c}"/>`).join('')}`, 'All set'),
};

/* ---------- real 3D: slabs tilt toward the finger, light follows it, Android tilts with the phone ---------- */
const TILT = '.act, .b-opt, .tile, .kpi, .big-go';
const TILT_MAX = el => el.matches('.act') ? 13 : el.matches('.kpi') ? 16 : 7; // degrees
let tiltEl = null, hoverEl = null;
function setTilt(el, e, scale = 1) {
  const r = el.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  const m = TILT_MAX(el) * scale, st = el.style;
  st.setProperty('--rx', `${((.5 - y) * m).toFixed(2)}deg`);   // touch the top edge and it sinks
  st.setProperty('--ry', `${((x - .5) * m).toFixed(2)}deg`);
  st.setProperty('--lx', `${(x * 100).toFixed(1)}%`); st.setProperty('--ly', `${(y * 100).toFixed(1)}%`);
  st.setProperty('--tx', ((x - .5) * 8).toFixed(2)); st.setProperty('--ty', ((y - .5) * 8).toFixed(2));
}
function clearTilt(el) { if (!el) return; ['--rx', '--ry', '--tx', '--ty', '--lx', '--ly'].forEach(k => el.style.removeProperty(k)); el.classList.remove('tilting'); }
function wireTilt() {
  if (!motionOK()) return;
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest(TILT); if (!el) return;
    if (hoverEl && hoverEl !== el) { clearTilt(hoverEl); hoverEl = null; }
    tiltEl = el; el.classList.add('tilting'); setTilt(el, e);
  }, { passive: true });
  document.addEventListener('pointermove', e => {
    if (tiltEl) return setTilt(tiltEl, e);
    if (e.pointerType !== 'mouse') return;
    const el = e.target.closest(TILT);
    if (el !== hoverEl) { clearTilt(hoverEl); hoverEl = el; }
    if (el) setTilt(el, e, .5); // gentler lean while hovering with a mouse
  }, { passive: true });
  const end = () => { if (tiltEl && tiltEl !== hoverEl) clearTilt(tiltEl); tiltEl = null; };
  ['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, end, { passive: true }));
  document.addEventListener('pointerleave', () => { end(); clearTilt(hoverEl); hoverEl = null; });
  // Android sends tilt without asking. iPhone only sends it after a permission prompt, which we never show
  // just for looks, so there the grid simply stays still.
  if ('DeviceOrientationEvent' in window) {
    let base = null, raf = 0, gx = 0, gy = 0;
    addEventListener('deviceorientation', e => {
      if (e.beta == null || e.gamma == null) return;
      if (!base) base = { b: e.beta, g: e.gamma };
      base.b += (e.beta - base.b) * .02; base.g += (e.gamma - base.g) * .02; // slowly re-centers on how she holds it
      gx = Math.max(-1, Math.min(1, (e.gamma - base.g) / 25)); gy = Math.max(-1, Math.min(1, (e.beta - base.b) / 25));
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; const st = document.documentElement.style; st.setProperty('--gx', gx.toFixed(3)); st.setProperty('--gy', gy.toFixed(3)); });
    });
  }
}

/* ---------- wire up ---------- */
function init() {
  $$('[data-icon]').forEach(el => el.innerHTML = ICON[el.dataset.icon]);
  $('#bristolGrid').innerHTML = BRISTOL.slice(1).map((b, i) => `
    <button class="b-opt" type="button" data-b="${i+1}" style="--bc:${BCOL[i+1]}">
      <span class="b-ico">${BICON[i+1]}</span>
      <span><span class="b-title">Type ${i+1}<span class="b-group">${b.group}</span></span><span class="b-desc">${b.desc}</span></span>
    </button>`).join('');
  $('#editType').innerHTML = BRISTOL.slice(1).map((b, i) => `<option value="${i+1}">Type ${i+1}: ${b.name}</option>`).join('');

  $$('.tab').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  $$('.act').forEach(b => {
    b.onclick = () => b.dataset.act === 'poop' ? openPicker() : log(b.dataset.act);
    b.addEventListener('pointerdown', e => {
      if (!motionOK()) return;
      const r = b.getBoundingClientRect(), d = document.createElement('span');
      d.className = 'ripple'; d.style.left = (e.clientX - r.left) + 'px'; d.style.top = (e.clientY - r.top) + 'px';
      let fx = b.querySelector('.fx'); if (!fx) { fx = document.createElement('span'); fx.className = 'fx'; b.prepend(fx); }
      fx.appendChild(d); setTimeout(() => d.remove(), 800);
    });
  });
  $('#bristolGrid').onclick = e => {
    const b = e.target.closest('.b-opt'); if (!b || pickBusy) return;
    const n = +b.dataset.b;
    log('poop', n, Date.now() - pickAgo * MIN); // saved straight away; the plop is just for show
    if (!motionOK()) return closePicker();
    pickBusy = true; buzz();
    $('#bristolGrid').classList.add('chosen'); b.classList.add('is-chosen');
    b.style.setProperty('--d', '0ms'); b.style.setProperty('--h', '-70px'); plop(b);
    setTimeout(() => { pickBusy = false; $('#bristolGrid').classList.remove('chosen'); b.classList.remove('is-chosen'); closePicker(); }, n === 6 ? 1150 : 950);
  };
  $('#when').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; pickAgo = +c.dataset.ago; $$('#when .chip').forEach(x => x.classList.toggle('is-on', x === c)); };
  $('#pickCancel').onclick = closePicker;
  $('#toastUndo').onclick = () => { const f = undoFn; undoFn = null; $('#toast').hidden = true; if (f) { f(); toast('Undone'); } };

  $('#histFilter').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; ui.hf = c.dataset.f; save(K.ui, ui); $$('#histFilter .chip').forEach(x => x.classList.toggle('is-on', x === c)); render(); };
  $$('#histFilter .chip').forEach(x => x.classList.toggle('is-on', x.dataset.f === ui.hf));
  $('#historyList').onclick = e => {
    const row = e.target.closest('.row'); if (!row) return;
    const del = e.target.closest('[data-del]');
    if (del) {
      if (armedDelete === row.dataset.id) { const e = entries().find(x => x.id === row.dataset.id); armedDelete = null; if (e) delOne(e); return; }
      $$('.row-del.confirm').forEach(b => { b.classList.remove('confirm'); b.innerHTML = del.innerHTML; });
      armedDelete = row.dataset.id; del.classList.add('confirm'); del.textContent = 'Delete?';
      setTimeout(() => { if (armedDelete === row.dataset.id) { armedDelete = null; render(); } }, 3000);
      return;
    }
    openEdit(row.dataset.id);
  };

  $('#range').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; ui.range = +c.dataset.r; save(K.ui, ui); $$('#range .chip').forEach(x => x.classList.toggle('is-on', x === c)); render(); enter($('#view-trends')); };
  $$('#range .chip').forEach(x => x.classList.toggle('is-on', +x.dataset.r === ui.range));

  $('#editCancel').onclick = () => $('#editDlg').close();
  $('#editDelete').onclick = () => { if (editing) delOne(editing); $('#editDlg').close(); };
  $('#editDlg').querySelector('form').onsubmit = ev => {
    const ts = new Date($('#editWhen').value).getTime();
    if (!editing || isNaN(ts)) return;
    const patch = { ts }; if (editing.ev === 'poop') patch.b = +$('#editType').value || null;
    queue({ op: 'edit', id: editing.id, patch }); toast('Saved');
  };

  // ---------- settings ----------
  const note = (t, c = '') => { const m = $('#setNote'); m.textContent = t; m.className = 'set-msg ' + c; };
  const msg = (t, c = '') => { const m = $('#setMsg'); m.textContent = t; m.className = 'set-msg ' + c; };
  const dmsg = (t, c = '') => { const m = $('#devMsg'); m.textContent = t; m.className = 'set-msg ' + c; };
  const cmsg = (t, c = '') => { const m = $('#devCopyMsg'); m.textContent = t; m.className = 'set-msg ' + c; };
  $('#settingsBtn').onclick = () => { note(''); refreshPlaces(); $('#setDlg').showModal(); };
  $('#openWizard').onclick = () => openWizard('choose');
  const allowFile = async () => { // must run straight from a tap
    if (!fileHandle) return openWizard('file');
    try { filePerm = await permOf(fileHandle, true); } catch {}
    if (filePerm === 'granted') { tstat.file = { ...(tstat.file || {}), err: '' }; sync(); }
  };
  $('#syncBtn').onclick = () => {
    const s = $('#syncBtn').dataset.s;
    if (s === 'perm') return allowFile();
    if (s === 'local') return openWizard('welcome');
    if (s === 'err') { refreshPlaces(); $('#setDlg').showModal(); }
    sync();
  };
  $('#dyk').onclick = e => { if (e.target.closest('.dyk-next')) { dykIdx++; renderDyk(entries()); } };
  $('#banner').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.b === 'allow') allowFile();
    else if (b.dataset.b === 'wizard') openWizard('welcome');
    else { refreshPlaces(); $('#setDlg').showModal(); }
  };

  // reset: deletes every entry everywhere it is saved, keeps a backup inside the app, and offers 10s of undo
  $('#resetOpen').onclick = () => {
    const all = entries(); if (!all.length) return note('There is nothing to delete.');
    const n = ev => all.filter(e => e.ev === ev).length;
    const places = ['this phone', ...targets().map(t => t === 'file' ? `<b>${esc(cfg.fileName)}</b>` : t === 'gsheet' ? 'the <b>Google Sheet</b>' : `<b>${esc(cfg.repo)}</b> on GitHub`)];
    $('#resetText').innerHTML = `This deletes all <b>${all.length}</b> entries (${n('poop')} poop, ${n('vomit')} vomit, ${n('imodium')} Imodium, ${n('gasx')} Gas-X) from ${places.join(' and ')}. Settings are kept.`;
    $('#resetDlg').showModal();
  };
  $('#resetBackup').onclick = async () => { try { download(`gut-check-backup-${dayKey(Date.now())}.xlsx`, await xlsxBlob(entries())); } catch { download(`gut-check-backup-${dayKey(Date.now())}.csv`, new Blob([toCSV(entries())], { type: 'text/csv' })); } save(K.copy, Date.now()); };
  $('#resetGo').onclick = async () => {
    const all = entries();
    await backupNow(`reset-${Date.now()}`); // can be restored later from the setup wizard
    queue(...all.map(e => ({ op: 'del', id: e.id })));
    $('#resetDlg').close(); $('#setDlg').close(); setTab('home');
    toast(`🧹 Deleted all ${all.length} entries`, () => queue(...all.map(e => ({ op: 'add', e }))), 10000);
  };

  // reset the whole app on this phone, optionally emptying the Sheet / file first
  $('#wipeOpen').onclick = () => {
    const ts = targets();
    $('#wipeAlsoRow').hidden = $('#wipeHint').hidden = !ts.length;
    $('#wipePlaces').textContent = ts.map(t => t === 'gsheet' ? 'the Google Sheet' : t === 'file' ? cfg.fileName : 'GitHub').join(' and ');
    $('#wipeAlso').checked = false; $('#wipeMsg').textContent = '';
    $('#wipeDlg').showModal();
  };
  $('#wipeCancel').onclick = () => $('#wipeDlg').close();
  $('#wipeGo').onclick = async () => {
    const m = (t, c = '') => { const el = $('#wipeMsg'); el.textContent = t; el.className = 'set-msg ' + c; };
    const btn = $('#wipeGo'); btn.disabled = true;
    if ($('#wipeAlso').checked && targets().length) {
      m('Deleting the entries…');
      const kept = local.slice();
      if (kept.length) queue(...kept.map(e => ({ op: 'del', id: e.id })));
      while (syncing) await new Promise(r => setTimeout(r, 100));
      clearTimeout(syncTimer); await sync();
      const bad = targets().filter(t => tstat[t]?.err || waiting(t));
      if (bad.length) { // put everything back exactly as it was
        if (kept.length) queue(...kept.map(e => ({ op: 'add', e })));
        btn.disabled = false; return m(`Couldn't delete from ${bad.map(t => PLACE[t]()).join(' and ')}, so nothing was reset. ${tstat[bad[0]]?.err === 'perm' ? 'The file needs permission again.' : tstat[bad[0]]?.err || ''}`, 'err'); }
    }
    m('Resetting…');
    wiping = true; clearTimeout(syncTimer); clearTimeout(bkTimer);
    try { Object.keys(localStorage).filter(k => k.startsWith('gl.')).forEach(k => localStorage.removeItem(k)); } catch {}
    await idb.wipe();
    location.replace(location.pathname); // reload as a brand-new visitor
  };

  // files
  const copySaved = () => { save(K.copy, Date.now()); renderBanner(); refreshPlaces(); };
  $('#expCsv').onclick = () => { download(`gut-check-${dayKey(Date.now())}.csv`, new Blob(['﻿' + toCSV(entries())], { type: 'text/csv' })); copySaved(); };
  $('#expXlsx').onclick = async () => {
    try { download(`gut-check-${dayKey(Date.now())}.xlsx`, await xlsxBlob(entries())); copySaved(); } catch (e) { note(e.message, 'err'); }
  };
  const onImport = (out) => async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const r = await importFile(f); out(`Read ${r.found} rows from ${f.name}. Added ${r.added} new; the rest were already here.`, 'ok'); }
    catch (err) { out(err.message || 'Could not read that file', 'err'); }
  };
  $('#impFile').onchange = onImport(note);

  // ---------- setup wizard: a journey of small screens ----------
  const JOURNEY = [['g1', '📋', 'Copy'], ['g2', '🧩', 'Paste'], ['g3', '🚀', 'Turn on'], ['g4', '👍', 'Allow'], ['g5', '🔗', 'Link'], ['g6', '✅', 'Connect']];
  $$('.wz-ill').forEach(el => el.innerHTML = ILL[el.dataset.ill] || '');
  $$('[data-only="fs"]').forEach(el => el.hidden = !FS_OK);
  $$('[data-only="nofs"]').forEach(el => el.hidden = FS_OK);
  let wzCur = null, wzHist = [];
  function go(id, push = true) {
    if (push && wzCur && wzCur !== id) wzHist.push(wzCur);
    wzCur = id;
    $$('.wz-screen').forEach(el => el.hidden = el.dataset.s !== id);
    const j = JOURNEY.findIndex(x => x[0] === id), jEl = $('#wzJourney');
    jEl.hidden = j < 0;
    if (j >= 0) jEl.innerHTML = JOURNEY.map(([sid, icon, label], i) => `<li class="${i < j ? 'done' : i === j ? 'now' : ''}"><button type="button" data-go="${sid}" aria-label="${label}">${i < j ? '✓' : icon}</button><span>${label}</span></li>`).join('');
    $('#wzBack').style.visibility = wzHist.length ? 'visible' : 'hidden';
    if (id === 'restore') renderBackups();
    if (id === 'g1') loadGsCode();
    refreshPlaces(); fillDev(); fillGh(); fillGs();
    $('#wizDlg .dlg').scrollTop = 0;
  }
  function openWizard(id = 'welcome') {
    if ($('#setDlg').open) $('#setDlg').close();
    msg(''); dmsg(''); gsmsg(''); $('#wzImpMsg').textContent = ''; $('#devCopyMsg').textContent = ''; $('#gsCopyMsg').textContent = '';
    wzHist = []; wzCur = null; go(id, false);
    if (!$('#wizDlg').open) { $('#wizDlg').showModal(); document.activeElement && document.activeElement.blur(); }
  }
  $('#wizDlg').addEventListener('click', e => {
    const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); return go(g.dataset.go); }
    if (e.target.closest('[data-close]')) $('#wizDlg').close();
  });
  $('#wzBack').onclick = () => { const prev = wzHist.pop(); if (prev) go(prev, false); };
  $('#wizDlg').addEventListener('close', () => remember('seen', true));

  // step 1: a file on this phone
  function fillDev() {
    $('#devUnlink').hidden = !cfg.fileName;
    $('#devNew').textContent = cfg.fileName ? '📁 Pick a different folder' : '📁 Pick a folder';
    $('#devState').innerHTML = cfg.fileName ? `✓ Saving to <b>${esc(cfg.fileName)}</b>${tstat.file?.err === 'perm' ? ' (needs permission again: tap “Allow” on the home screen)' : ''}` : 'No file linked yet.';
    const lc = load(K.copy, 0);
    $('#lastCopy').textContent = lc ? `Last copy saved ${ago(lc)}.` : 'No copy saved yet.';
  }
  const linkFile = async create => {
    const types = [{ description: 'Spreadsheet', accept: { 'text/csv': ['.csv'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }];
    try {
      const h = create ? await window.showSaveFilePicker({ suggestedName: 'gut-check.xlsx', types })
                       : (await window.showOpenFilePicker({ types, multiple: false }))[0];
      if (await permOf(h, true) !== 'granted') return dmsg('The app needs permission to edit that file.', 'err');
      fileHandle = h; filePerm = 'granted'; cfg.fileName = h.name; saveCfg();
      outbox.file = []; tstat.file = {}; save(K.out, outbox);
      try { await idb.set('file', h); } catch {}
      dmsg('Saving…'); await sync(); fillDev();
      tstat.file?.err ? dmsg(tstat.file.err === 'perm' ? 'The app needs permission to edit that file.' : tstat.file.err, 'err')
                      : (dmsg(`✓ All ${local.length} entries are in ${h.name}.`, 'ok'), go('done'));
    } catch (e) { if (e.name !== 'AbortError') dmsg(e.message || 'Could not use that file', 'err'); }
  };
  $('#devNew').onclick = () => linkFile(true);
  $('#devOpen').onclick = () => linkFile(false);
  $('#devUnlink').onclick = async () => {
    fileHandle = null; filePerm = 'granted'; cfg.fileName = ''; saveCfg();
    delete outbox.file; delete tstat.file; save(K.out, outbox); save(K.tstat, tstat);
    try { await idb.del('file'); } catch {}
    fillDev(); refreshPlaces(); setStatus(); renderBanner(); dmsg('Unlinked. The file is untouched, and every entry is still in the app.');
  };
  $('#devShare').onclick = async () => {
    const name = `gut-check-${dayKey(Date.now())}.csv`, file = new File(['﻿' + toCSV(entries())], name, { type: 'text/csv' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); }
      else download(name, file);
      copySaved(); fillDev(); cmsg('✓ Copy saved.', 'ok');
    } catch (e) { if (e.name !== 'AbortError') cmsg(e.message, 'err'); }
  };

  // step 2: GitHub
  function ghLinks() {
    const owner = $('#sOwner').value.trim(), repo = $('#sRepo').value.trim() || 'gut-check-data';
    $('#ghRepoLink').href = `https://github.com/new?name=${encodeURIComponent(repo)}&visibility=private&description=${encodeURIComponent('Gut Check log (private)')}`;
    $('#ghTokenLink').href = `https://github.com/settings/personal-access-tokens/new?name=${encodeURIComponent('Gut Check')}&description=${encodeURIComponent('Lets the Gut Check app save the log to ' + repo)}${owner ? `&target_name=${encodeURIComponent(owner)}` : ''}&contents=write`;
    $$('.repo-name').forEach(el => el.textContent = repo);
  }
  function fillGh() {
    if (document.activeElement && document.activeElement.closest('#wzGh')) return; // don't clobber typing
    $('#sOwner').value = cfg.owner; $('#sRepo').value = cfg.repo; $('#sBranch').value = cfg.branch; $('#sPath').value = cfg.path; $('#sToken').value = cfg.token;
    $('#ghState').innerHTML = connected() ? `✓ Backing up to <b>${esc(cfg.owner)}/${esc(cfg.repo)}</b>` : '';
    $('#setDisconnect').hidden = !connected();
    ghLinks();
  }
  ['#sOwner', '#sRepo'].forEach(id => $(id).addEventListener('input', ghLinks));
  $('#setSave').onclick = async () => {
    const was = connected();
    Object.assign(cfg, { owner: $('#sOwner').value.trim().replace(/^@/, ''), repo: $('#sRepo').value.trim(), branch: $('#sBranch').value.trim(),
      path: $('#sPath').value.trim().replace(/^\/+/, '') || 'gut-check.csv', token: $('#sToken').value.trim() });
    saveCfg(); branchOk = false;
    if (!connected()) return msg('Fill in your GitHub username, the repository name and the access key.', 'err');
    if (!was) outbox.github = [];
    tstat.github = {}; save(K.out, outbox);
    msg('Connecting…'); await sync(); fillGh();
    tstat.github?.err ? msg(tstat.github.err, 'err') : msg(`Connected. All ${local.length} entries are backed up on GitHub, and every new tap is too.`, 'ok');
  };
  $('#setDisconnect').onclick = () => {
    cfg.token = ''; saveCfg(); delete outbox.github; delete tstat.github; save(K.out, outbox); save(K.tstat, tstat);
    fillGh(); refreshPlaces(); setStatus(); renderBanner(); msg('Disconnected. Nothing was deleted on GitHub, and every entry is still in the app.');
  };

  // step 2: Google Sheet
  const gsmsg = (t, c = '') => { const m = $('#gsMsg'); m.textContent = t; m.className = 'set-msg ' + c; };
  let gsCode = '';
  const appUrl = () => location.origin + location.pathname.replace(/[^/]*$/, '');
  const loadGsCode = () => gsCode ? null : fetch('google-sheet/Code.gs', { cache: 'no-store' }).then(r => r.text())
    .then(t => { gsCode = t.replace(/const APP_URL = '[^']*';/, `const APP_URL = '${appUrl()}';`); }).catch(() => {});
  function fillGs() {
    $('#gsState').innerHTML = gsConnected() ? '✓ This phone is saving to the Google Sheet.' : '';
    $('#gsDisconnect').hidden = !gsConnected();
    loadGsCode();
  }
  $('#gsCopy').onclick = async () => { // the code is fetched ahead of time so the copy happens inside this tap (Safari needs that)
    const m = (t, c) => { const el = $('#gsCopyMsg'); el.textContent = t; el.className = 'set-msg ' + c; };
    try { if (!gsCode) await loadGsCode(); await navigator.clipboard.writeText(gsCode); m('✓ Copied! Now paste it in the Sheet.', 'ok'); $('#gsCopy').textContent = '✓ Copied'; }
    catch { m("Couldn't copy by itself. Tap “See it”, select all the text and copy it.", 'err'); }
  };
  const WEBAPP_RE = /https:\/\/script\.google\.com\/macros\/[^\s#?"'<>]+/;
  async function connectAny(text) {
    if (parseConnLink(text)) return connectSheet(text);
    const m = String(text || '').match(WEBAPP_RE);
    if (!m) return gsmsg("That's not the link yet. In Apps Script, under Web app, tap Copy, then come back and tap Paste.", 'err');
    gsmsg('Making your Sheet…');
    try {
      const j = await gsCall(fetch(`${m[0]}?claim=1&t=${Date.now()}`, { cache: 'no-store' }));
      cfg.gsSheetUrl = j.sheetUrl || ''; saveCfg();
      return connectSheet(`#gsheet=${encodeURIComponent(m[0])}&key=${j.key}`);
    } catch (e) { gsmsg(e.message, 'err'); }
  }
  async function connectSheet(link) {
    const c = parseConnLink(link);
    if (!c) return gsmsg('That doesn\'t look like a Gut Check connection link. In the Sheet use Gut Check → Get connection link, and copy the whole link.', 'err');
    cfg.gsUrl = c.url; cfg.gsKey = c.key; saveCfg();
    outbox.gsheet = []; tstat.gsheet = {}; save(K.out, outbox);
    gsmsg('Connecting…'); await sync(); fillGs();
    if (tstat.gsheet?.err) gsmsg(tstat.gsheet.err, 'err');
    else { gsmsg(`✓ Connected. All ${local.length} entries are in the Google Sheet.`, 'ok'); $('#gsLink').value = ''; go('done'); }
  }
  $('#gsPaste').onclick = async () => {
    try {
      const t = await navigator.clipboard.readText();
      $('#gsLink').value = t;
      connectAny(t);
    } catch { gsmsg('Long-press the box below and choose Paste, then tap Connect.', 'err'); $('#gsLink').focus(); }
  };
  $('#gsConnect').onclick = () => connectAny($('#gsLink').value);
  $('#gsDisconnect').onclick = () => {
    cfg.gsUrl = ''; cfg.gsKey = ''; cfg.gsSheetUrl = ''; saveCfg(); delete outbox.gsheet; delete tstat.gsheet; save(K.out, outbox); save(K.tstat, tstat);
    fillGs(); refreshPlaces(); setStatus(); renderBanner(); gsmsg('Disconnected. Nothing in the Sheet was deleted, and every entry is still in the app.');
  };
  // opening the connection link itself (e.g. tapped in an email) connects too, after asking
  function connectFromHash() {
    if (!/gsheet=/.test(location.hash)) return;
    const link = location.hash; history.replaceState(null, '', location.pathname + location.search);
    if (confirm('Connect Gut Check to your Google Sheet? Every entry will be saved there too.')) { openWizard('g6'); connectSheet(link); }
  }

  // step 3: bring in data
  $('#wzImp').onchange = onImport((t, c) => { const m = $('#wzImpMsg'); m.textContent = t; m.className = 'set-msg ' + c; renderBackups(); });
  async function renderBackups() {
    const items = await listBackups();
    $('#bkList').innerHTML = items.length ? items.map(i => `<div class="bk"><span><b>${i.k.startsWith('bk:reset') ? 'Before “Delete all”' : fmtDay(i.at)}</b>
      <small>${new Date(i.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${i.list.length} entries</small></span>
      <button type="button" class="ghost" data-restore="${esc(i.k)}">Restore</button></div>`).join('')
      : '<p class="hint">No automatic backups yet. One is made each day the app is used.</p>';
  }
  $('#bkList').onclick = async e => {
    const b = e.target.closest('[data-restore]'); if (!b) return;
    const v = (await listBackups()).find(i => i.k === b.dataset.restore); if (!v) return;
    const have = new Set(local.map(x => x.id)), add = v.list.map(fixEv).filter(x => !have.has(x.id));
    if (add.length) queue(...add.map(x => ({ op: 'add', e: x })));
    const m = $('#wzImpMsg'); m.className = 'set-msg ok';
    m.textContent = add.length ? `Restored ${add.length} entries that were missing.` : 'Nothing to restore: everything in that backup is already here.';
  };

  document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); scheduleSync(200); } });
  addEventListener('online', () => scheduleSync(200));
  addEventListener('hashchange', () => connectFromHash()); // the connection link opened while the app is already open
  setInterval(() => { if (!document.hidden) { renderKpis(entries()); renderRecent(entries()); renderBanner(); } }, 60e3);
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {} // ask the browser not to clear app data

  wireTilt();
  setTab(ui.tab);
  // reopen the linked phone file (if any) before the first save, so nothing lands in the wrong place
  let firstVisit = false, restoredN = 0;
  const recall = async () => {
    try {
      if (!localStorage.getItem(K.cfg)) { // setup forgotten here, but maybe remembered in IndexedDB
        const c = await idb.get('mem:cfg');
        if (c) { cfg = Object.assign(defaultCfg(), c); save(K.cfg, cfg); for (const t of targets()) outbox[t] = outbox[t] || []; save(K.out, outbox); }
      }
      if (FRESH && !local.length) { // log wiped from localStorage: take back the newest daily backup, if any
        const daily = (await listBackups()).find(b => /^bk:\d/.test(b.k));
        if (daily && daily.list.length) { local = daily.list.map(fixEv); save(K.snap, local); restoredN = local.length; }
      }
      const seen = load('gl.seen', false) || !!(await idb.get('mem:seen'));
      firstVisit = FRESH && !seen && !local.length && !targets().length;
    } catch { firstVisit = FRESH && !local.length && !targets().length; }
  };
  recall().then(() => FS_OK ? idb.get('file').catch(() => null) : null).then(async h => {
    if (h) {
      fileHandle = h;
      if (!cfg.fileName) { cfg.fileName = h.name; saveCfg(); outbox.file = outbox.file || []; save(K.out, outbox); }
      try { filePerm = await permOf(h, false); } catch { filePerm = 'prompt'; }
      if (filePerm !== 'granted') tstat.file = { ...(tstat.file || {}), err: 'perm', errAt: tstat.file?.errAt || Date.now() };
    } else if (cfg.fileName) {
      tstat.file = { ...(tstat.file || {}), err: 'The link to the file was lost. Link it again in Settings → Set up saving & backups.', errAt: tstat.file?.errAt || Date.now() };
    }
    render(); scheduleSync(50); scheduleBackup();
    if (restoredN) toast(`Welcome back: ${restoredN} entries restored from the app's backup`);
    if (/gsheet=/.test(location.hash)) connectFromHash();
    else if (firstVisit) openWizard('welcome');
  });
}
init();
})();
