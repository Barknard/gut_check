/* Gut Log: a tiny tracker for bowel movements, MiraLAX and Gas-X.
 * Data lives in a CSV file in a GitHub repo (Excel opens it directly).
 * Writes go through the GitHub Contents API with a token kept on the device.
 * Every change is queued locally first, so taps never get lost offline. */
(() => {
'use strict';

/* ---------- constants ---------- */
const EV = {
  poop:    { label: 'Poop',    csv: 'Poop',    color: 'var(--poop)', hex: '#d95926' },
  miralax: { label: 'MiraLAX', csv: 'MiraLAX', color: 'var(--mira)', hex: '#3987e5' },
  gasx:    { label: 'Gas-X',   csv: 'Gas-X',   color: 'var(--gasx)', hex: '#199e70' },
};
const MEDS = ['miralax', 'gasx'];
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
const K = { snap: 'gl.snapshot', pend: 'gl.pending', cfg: 'gl.cfg', ui: 'gl.ui' };

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
  miralax: `<svg viewBox="0 0 64 64" aria-hidden="true">
    <rect x="21" y="5" width="22" height="11" rx="3" fill="#3987e5"/>
    <rect x="21" y="8" width="22" height="2" fill="#2a6dc0"/>
    <rect x="23" y="15" width="18" height="5" fill="#c9d1db"/>
    <rect x="14" y="19" width="36" height="40" rx="9" fill="#e9edf2"/>
    <rect x="14" y="31" width="36" height="17" fill="#3987e5"/>
    <rect x="18" y="23" width="4" height="32" rx="2" fill="#fff" opacity=".6"/>
    <path d="M27 36 h10 l-1.5 7 h-7 z" fill="#fff"/>
    <circle cx="30" cy="34" r="1.3" fill="#fff"/><circle cx="33.5" cy="33" r="1.1" fill="#fff"/><circle cx="35" cy="35" r="1" fill="#fff"/>
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
  `<svg viewBox="0 0 80 48" aria-hidden="true">${[[13,31,7],[29,19,7.5],[44,33,6.5],[57,17,7],[68,34,6]].map(([x,y,r]) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${BR}"/>${hl(x-2.2, y-2.4, r/3)}`).join('')}</svg>`,
  `<svg viewBox="0 0 80 48" aria-hidden="true">${[[14,25,9.5],[24,21,10.5],[35,26,10],[46,21,10.5],[57,26,10],[67,23,9]].map(([x,y,r]) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${BR}"/>`).join('')}${[[13,21],[24,16],[35,22],[46,16],[57,22],[66,19]].map(([x,y]) => hl(x,y,2.4)).join('')}</svg>`,
  `<svg viewBox="0 0 80 48" aria-hidden="true"><rect x="6" y="13" width="68" height="22" rx="11" fill="${BR}"/>
    <rect x="14" y="16" width="44" height="3" rx="1.5" fill="${BR2}" opacity=".7"/>
    <g stroke="${BR3}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 13 l3 6 l-2 4"/><path d="M33 13 l-2 6 l3 4"/><path d="M48 13 l2 7"/><path d="M61 14 l-3 6 l2 3"/>
      <path d="M25 35 l2 -6"/><path d="M42 35 l-1 -5 l2 -2"/><path d="M56 35 l-2 -6"/></g></svg>`,
  `<svg viewBox="0 0 80 48" aria-hidden="true"><path d="M9 31 C21 9 33 41 47 23 S67 13 72 25" stroke="${BR}" stroke-width="14" fill="none" stroke-linecap="round"/>
    <path d="M12 26 C22 12 31 34 44 20" stroke="${BR2}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/></svg>`,
  `<svg viewBox="0 0 80 48" aria-hidden="true">${[[16,29,10,8],[39,21,11,8.5],[62,30,11,8]].map(([x,y,rx,ry]) =>
    `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${BR}"/><ellipse cx="${x-3}" cy="${y-3.5}" rx="${rx/2.6}" ry="2" fill="${BR2}" opacity=".75"/>`).join('')}</svg>`,
  `<svg viewBox="0 0 80 48" aria-hidden="true"><path d="M10 31 l4 -8 l5 3 l3 -9 l6 4 l5 -6 l4 5 l7 -4 l3 6 l6 -2 l2 7 l6 1 l-3 6 l4 5 l-8 2 l-4 -3 l-6 4 l-5 -3 l-7 3 l-4 -4 l-8 2 l-2 -5 z"
    fill="#9c6a3a" stroke="#9c6a3a" stroke-width="3" stroke-linejoin="round"/>
    <path d="M18 27 l4 -3 l5 2 l5 -4 l5 3" stroke="${BR2}" stroke-width="2" fill="none" stroke-linecap="round" opacity=".9"/>
    <path d="M71 18 l3 -3 l3 3 l-2 3 z M8 18 l3 -2 l2 3 l-3 2 z" fill="#9c6a3a" stroke="#9c6a3a" stroke-width="2" stroke-linejoin="round"/></svg>`,
  `<svg viewBox="0 0 80 48" aria-hidden="true"><ellipse cx="40" cy="36" rx="33" ry="8.5" fill="#a0743f" opacity=".9"/>
    <path d="M18 36 q5 -3 10 0 t10 0 M44 37 q5 -3 10 0 t10 0" stroke="#c8995f" stroke-width="2" fill="none" stroke-linecap="round"/>
    ${[[22,10],[40,4],[58,12]].map(([x,y]) => `<path d="M${x} ${y} c-4 6 -5 10 0 11 c5 -1 4 -5 0 -11 z" fill="#a0743f"/>`).join('')}</svg>`,
];
const iconFor = e => e.ev === 'poop' && e.b ? BICON[e.b] : ICON[e.ev];

/* ---------- storage ---------- */
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let snapshot = load(K.snap, []);       // last known server state (or local-only state)
let pending = load(K.pend, []);        // ops not yet written to GitHub
let cfg = Object.assign(defaultCfg(), load(K.cfg, {}));
let ui = Object.assign({ tab: 'home', range: 14, hf: 'all' }, load(K.ui, {}));

function defaultCfg() {
  const h = location.hostname, seg = location.pathname.split('/').filter(Boolean)[0] || '';
  const gh = h.endsWith('.github.io');
  return { owner: gh ? h.split('.')[0] : '', repo: gh ? (seg || h) : '', branch: 'data', path: 'data/gut-log.csv', token: '' };
}
const connected = () => !!(cfg.owner && cfg.repo && cfg.token && cfg.path);

function applyOps(list, ops) {
  const m = new Map(list.map(e => [e.id, { ...e }]));
  for (const o of ops) {
    if (o.op === 'add') m.set(o.e.id, { ...o.e });
    else if (o.op === 'del') m.delete(o.id);
    else if (o.op === 'edit') { const e = m.get(o.id); if (e) Object.assign(e, o.patch); }
  }
  return [...m.values()].sort((a, b) => a.ts - b.ts);
}
const entries = () => applyOps(snapshot, pending);

function queue(...ops) {
  pending.push(...ops); save(K.pend, pending);
  if (!connected()) { snapshot = entries(); pending = []; save(K.snap, snapshot); save(K.pend, pending); }
  render(); scheduleSync();
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
  if (/mira|lax|peg|polyeth/.test(s)) return 'miralax';
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

async function ensureBranch() {
  const r = await api(`/branches/${encodeURIComponent(cfg.branch)}`);
  if (r.ok) return;
  if (r.status !== 404) throw new HttpError(r);
  const repo = await api('');
  if (!repo.ok) throw new HttpError(repo, repo.status === 404 ? 'Repo not found (check owner/name and token access)' : null);
  const def = (await repo.json()).default_branch;
  const ref = await api(`/git/ref/heads/${encodeURIComponent(def)}`);
  if (!ref.ok) throw new HttpError(ref);
  const sha = (await ref.json()).object.sha;
  const mk = await api('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${cfg.branch}`, sha }) });
  if (!mk.ok && mk.status !== 422) throw new HttpError(mk, 'Could not create the data branch');
}
async function fetchRemote() {
  const r = await api(`/contents/${filePath()}?ref=${encodeURIComponent(cfg.branch)}`);
  if (r.status === 404) return { sha: null, list: [] };
  if (!r.ok) throw new HttpError(r, r.status === 401 ? 'Token rejected' : null);
  const j = await r.json();
  let text = j.content ? b64dec(j.content) : '';
  if (!j.content && j.size > 0) {
    const raw = await api(`/contents/${filePath()}?ref=${encodeURIComponent(cfg.branch)}`, { headers: { Accept: 'application/vnd.github.raw' } });
    text = await raw.text();
  }
  return { sha: j.sha, list: rowsToEntries(parseDelimited(text)) };
}
function commitMsg(ops) {
  if (ops.length > 1) return `Gut Log: ${ops.length} changes`;
  const o = ops[0];
  if (o.op === 'add') return `Log ${EV[o.e.ev].label}${o.e.b ? ` (type ${o.e.b})` : ''} ${dayKey(o.e.ts)} ${hm(o.e.ts)}`;
  return o.op === 'del' ? 'Remove an entry' : 'Edit an entry';
}

let syncing = false, again = false, syncTimer = 0, branchOk = false, lastErr = '';
function scheduleSync(ms = 1200) { clearTimeout(syncTimer); syncTimer = setTimeout(sync, ms); }
async function sync() {
  if (!connected()) return setStatus();
  if (syncing) { again = true; return; }
  syncing = true; setStatus('busy');
  try {
    if (!branchOk) { await ensureBranch(); branchOk = true; }
    for (let attempt = 0; ; attempt++) {
      const { sha, list } = await fetchRemote();
      const ops = pending.slice();
      if (!ops.length) { snapshot = list; break; }
      const merged = applyOps(list, ops);
      const body = { message: commitMsg(ops), content: b64enc(toCSV(merged)), branch: cfg.branch };
      if (sha) body.sha = sha;
      const r = await api(`/contents/${filePath()}`, { method: 'PUT', body: JSON.stringify(body) });
      if (r.ok) { snapshot = merged; pending = pending.slice(ops.length); break; }
      if ((r.status === 409 || r.status === 422) && attempt < 4) continue; // someone else wrote first: refetch & reapply
      throw new HttpError(r, r.status === 403 || r.status === 404 ? 'Token needs Contents: Read and write on this repo' : null);
    }
    save(K.snap, snapshot); save(K.pend, pending); lastErr = '';
    render();
  } catch (e) {
    lastErr = navigator.onLine === false ? 'Offline: will sync later' : (e.message || 'Sync failed');
    if (e.status === 404) branchOk = false;
  } finally {
    syncing = false; setStatus();
    if (again) { again = false; scheduleSync(300); }
  }
}
function setStatus(s) {
  const btn = $('#syncBtn'), t = $('#syncText');
  if (!s) s = !connected() ? 'local' : lastErr ? 'err' : pending.length ? 'pending' : 'ok';
  btn.dataset.s = s;
  t.textContent = { local: 'This phone only', busy: 'Saving…', pending: `${pending.length} to save`, err: 'Not saved', ok: 'Saved' }[s];
  btn.title = lastErr || '';
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
function renderKpis(list) {
  const now = Date.now(), cur = windowStats(list, now - 7 * DAY, now), prev = windowStats(list, now - 14 * DAY, now - 7 * DAY);
  const lastPoop = [...list].reverse().find(e => e.ev === 'poop');
  const hasPrev = list.length && list[0].ts < now - 8 * DAY;
  const delta = hasPrev && prev.n ? cur.perDay - prev.perDay : NaN;
  const trend = isFinite(delta) && Math.abs(delta) >= .05 ? `<span class="${delta > 0 ? 'up' : 'down'}">${Math.abs(delta).toFixed(1)}</span> vs last wk` : 'last 7 days';
  $('#kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Poops / day</div><div class="kpi-val">${list.length ? cur.perDay.toFixed(1) : '–'}</div><div class="kpi-sub">${trend}</div></div>
    <div class="kpi"><div class="kpi-label">Avg type</div><div class="kpi-val">${isFinite(cur.type) ? cur.type.toFixed(1) : '–'}<small>/7</small></div><div class="kpi-sub">${isFinite(cur.type) ? typeLabel(cur.type) : 'Bristol scale'}</div></div>
    <div class="kpi"><div class="kpi-label">Between</div><div class="kpi-val">${fmtDur(cur.gap)}</div><div class="kpi-sub">${lastPoop ? `last ${ago(lastPoop.ts)}` : 'avg gap'}</div></div>`;
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
  const W = 340, L = 22, R = 6, T = 8, H = 150, BOT = H + T, MED = 34;
  const max = niceMax(Math.max(...days.map(d => d.poops), 1)), n = days.length, bw = (W - L - R) / n;
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, max / 2, max];
  const y = v => T + H - (v / max) * H;
  const every = n <= 10 ? 1 : n <= 21 ? 3 : n <= 45 ? 7 : 14;
  let s = svgOpen(W, BOT + 22 + MED, 'Poops per day with medicine doses');
  for (const t of ticks) s += `<line x1="${L}" x2="${W-R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)"/><text x="${L-6}" y="${y(t)+3}" text-anchor="end">${t}</text>`;
  days.forEach((d, i) => {
    const x = L + i * bw, w = Math.max(1.5, bw - 2), cx = x + bw / 2;
    if (d.poops) {
      const top = y(d.poops), r = Math.min(4, w / 2);
      s += `<path d="M${x+1} ${y(0)} V${top+r} q0 -${r} ${r} -${r} H${x+1+w-r} q${r} 0 ${r} ${r} V${y(0)} Z" fill="var(--poop)"/>`;
    }
    if ((i % every === 0 && n - 1 - i >= every / 2) || i === n - 1) s += `<text x="${cx}" y="${BOT+13}" text-anchor="middle">${new Date(d.ts).toLocaleDateString([], n > 10 ? { month: 'numeric', day: 'numeric' } : { weekday: 'narrow' })}</text>`;
    MEDS.forEach((m, j) => {
      const c = d[m], my = BOT + 26 + j * 13;
      if (c) s += `<circle cx="${cx}" cy="${my}" r="${Math.min(4.5, bw / 2.2)}" fill="${EV[m].color}"/>${c > 1 && bw >= 10 ? `<text x="${cx}" y="${my+3}" text-anchor="middle" style="fill:#fff;font-size:7px;font-weight:700">${c}</text>` : ''}`;
    });
    const tip = `${new Date(d.ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}\n${d.poops} poop${d.poops === 1 ? '' : 's'}${isFinite(d.type) ? ` · avg type ${d.type.toFixed(1)}` : ''}\nMiraLAX ${d.miralax} · Gas-X ${d.gasx}`;
    s += `<rect x="${x}" y="${T}" width="${bw}" height="${BOT + 22 + MED - T}" fill="transparent" data-tip="${esc(tip)}"/>`;
  });
  s += `<line x1="${L}" x2="${W-R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--border)"/>`;
  MEDS.forEach((m, j) => s += `<text x="${L-6}" y="${BOT+29+j*13}" text-anchor="end" style="font-size:8px">${m === 'miralax' ? 'Mx' : 'Gx'}</text>`);
  return s + '</svg>';
}

function chartTypeOverTime(list, from, to) {
  const W = 340, L = 22, R = 8, T = 8, H = 150, span = Math.max(to - from, DAY);
  const x = ts => L + ((ts - from) / span) * (W - L - R), y = b => T + ((7 - b) / 6) * H;
  let s = svgOpen(W, T + H + 34, 'Bristol type of each poop over time');
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
  MEDS.forEach((m, j) => {
    for (const d of list.filter(e => e.ev === m && e.ts >= from && e.ts <= to)) {
      const cx = x(d.ts), cy = base + j * 10;
      s += `<path d="M${cx} ${cy-4} l4 7 h-8 z" fill="${EV[m].color}" data-tip="${esc(`${EV[m].label}\n${fmtDay(d.ts)} ${fmtTime(d.ts)}`)}"/>`;
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
      mira: inW.filter(x => x.ev === 'miralax').length / days, gasx: inW.filter(x => x.ev === 'gasx').length / days });
  }
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
    out.push([m === 'miralax' ? '💧' : '🫧', `${EV[m].label} is most often taken ${words[top[0]]} (${Math.round(top[1] / t.n * 100)}% of ${t.n} doses).`]);
    if (t.toNext.length >= 3) out.push(['⏱️', `After ${EV[m].label}, the next poop typically comes ${fmtDur(median(t.toNext))} later.`]);
  }
  const mx = timing.miralax, typed = poops.filter(p => p.b);
  if (mx.afterTypes.length >= 3) {
    const doses = list.filter(e => e.ev === 'miralax');
    const other = typed.filter(p => !doses.some(d => p.ts > d.ts && p.ts - d.ts <= 24 * HOUR)).map(p => p.b);
    if (other.length >= 3) {
      const a = mean(mx.afterTypes), b = mean(other), diff = a - b;
      out.push(['🔍', Math.abs(diff) < .4 ? `Stool type looks about the same in the 24h after MiraLAX (${a.toFixed(1)}) as at other times (${b.toFixed(1)}).`
        : `Stools are ${diff > 0 ? 'softer' : 'firmer'} in the 24h after MiraLAX: avg type ${a.toFixed(1)} vs ${b.toFixed(1)} otherwise.`]);
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
    return { ts: s, poops: p.length, type: mean(p.filter(x => x.b).map(x => x.b)), miralax: d.filter(x => x.ev === 'miralax').length, gasx: d.filter(x => x.ev === 'gasx').length };
  });
  const effDays = Math.max(1, (to - Math.max(from, startOfDay(list[0].ts))) / DAY);
  const gaps = []; for (let i = 1; i < poops.length; i++) gaps.push(poops[i].ts - poops[i-1].ts);
  const cur = { perDay: poops.length / effDays, type: mean(poops.filter(p => p.b).map(p => p.b)), gaps };
  const timing = Object.fromEntries(MEDS.map(m => [m, doseTiming(list, m, from, to)]));
  const ins = insights(list, from, to, cur, timing);
  const wk = weeks(list);
  const pct = (c, n) => n ? Math.round(c / n * 100) : 0;

  el.innerHTML = `
  ${ins.length ? `<div class="card"><h3>Patterns</h3><ul class="insights">${ins.map(([i, t]) => `<li><span>${i}</span><span>${esc(t)}</span></li>`).join('')}</ul></div>` : ''}

  <div class="card"><h3>Poops per day</h3><p class="sub">Bars are poops. Dots underneath are medicine doses that day.</p>
    ${chartDaily(days)}
    <div class="legend"><span><i style="background:var(--poop)"></i>Poops</span><span><i class="dot" style="background:var(--mira)"></i>MiraLAX (Mx)</span><span><i class="dot" style="background:var(--gasx)"></i>Gas-X (Gx)</span></div>
  </div>

  <div class="card"><h3>Stool type over time</h3><p class="sub">Each dot is one poop. The line is the average of the last 5.</p>
    ${chartTypeOverTime(list, from, to)}
    <div class="legend"><span><i class="dot" style="background:${BCOL[1]}"></i>Hard</span><span><i class="dot" style="background:${BCOL[4]}"></i>Ideal</span><span><i class="dot" style="background:${BCOL[7]}"></i>Loose</span><span><i class="tri" style="--c:var(--mira)"></i>MiraLAX</span><span><i class="tri" style="--c:var(--gasx)"></i>Gas-X</span></div>
  </div>

  <div class="card"><h3>Type mix</h3><p class="sub">${poops.filter(p => p.b).length} poops with a recorded type</p>${chartMix(poops)}</div>

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

  ${wk.length ? `<div class="card"><h3>Weekly averages</h3><table class="weeks"><thead><tr><th>Week of</th><th>Poops/d</th><th>Type</th><th>Mira/d</th><th>Gas-X/d</th></tr></thead><tbody>
    ${wk.map(w => `<tr><td>${new Date(w.s).toLocaleDateString([], { month: 'short', day: 'numeric' })}</td><td>${w.perDay.toFixed(1)}</td><td>${isFinite(w.type) ? w.type.toFixed(1) : '–'}</td><td>${w.mira.toFixed(1)}</td><td>${w.gasx.toFixed(1)}</td></tr>`).join('')}
  </tbody></table></div>` : ''}`;
}

/* ---------- render all ---------- */
function render() {
  const list = entries();
  renderKpis(list); renderRecent(list);
  if (ui.tab === 'history') renderHistory(list);
  if (ui.tab === 'trends') renderTrends(list);
  setStatus();
}
function setTab(t) {
  ui.tab = t; save(K.ui, ui);
  $$('.tab').forEach(b => { b.classList.toggle('is-on', b.dataset.tab === t); b.setAttribute('aria-selected', b.dataset.tab === t); });
  $$('.view').forEach(v => v.classList.toggle('is-on', v.id === `view-${t}`));
  if (t !== 'home') closePicker();
  render();
}

/* ---------- logging ---------- */
let toastTimer = 0, undoIds = [];
function toast(msg, ids) {
  undoIds = ids || [];
  $('#toastText').textContent = msg; $('#toastUndo').hidden = !undoIds.length;
  const t = $('#toast'); t.hidden = true; void t.offsetWidth; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 5000);
}
function log(ev, b = null, ts = Date.now()) {
  const e = { id: newId(), ts, ev, b };
  queue({ op: 'add', e }); buzz();
  const btn = $(`.act[data-act="${ev}"]`); btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
  toast(ev === 'poop' ? `💩 Type ${b} logged${ts < Date.now() - MIN ? ` at ${fmtTime(ts)}` : ''}` : `${ev === 'miralax' ? '💧' : '🫧'} ${EV[ev].label} logged at ${fmtTime(ts)}`, [e.id]);
}
let pickAgo = 0;
function openPicker() {
  pickAgo = 0; $$('#when .chip').forEach(c => c.classList.toggle('is-on', c.dataset.ago === '0'));
  $('#actions').hidden = true; $('#recent').hidden = true; $('#kpis').hidden = true; $('#picker').hidden = false; scrollTo(0, 0); buzz();
}
function closePicker() { $('#actions').hidden = false; $('#recent').hidden = false; $('#kpis').hidden = false; $('#picker').hidden = true; }

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
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  s.onload = () => res(window.XLSX); s.onerror = () => { xlsxP = null; rej(new Error('Could not load the Excel library')); };
  document.head.appendChild(s);
}));
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
  $$('.act').forEach(b => b.onclick = () => b.dataset.act === 'poop' ? openPicker() : log(b.dataset.act));
  $('#bristolGrid').onclick = e => { const b = e.target.closest('.b-opt'); if (!b) return; log('poop', +b.dataset.b, Date.now() - pickAgo * MIN); closePicker(); };
  $('#when').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; pickAgo = +c.dataset.ago; $$('#when .chip').forEach(x => x.classList.toggle('is-on', x === c)); };
  $('#pickCancel').onclick = closePicker;
  $('#toastUndo').onclick = () => { if (undoIds.length) queue(...undoIds.map(id => ({ op: 'del', id }))); undoIds = []; $('#toast').hidden = true; toast('Removed'); };

  $('#histFilter').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; ui.hf = c.dataset.f; save(K.ui, ui); $$('#histFilter .chip').forEach(x => x.classList.toggle('is-on', x === c)); render(); };
  $$('#histFilter .chip').forEach(x => x.classList.toggle('is-on', x.dataset.f === ui.hf));
  $('#historyList').onclick = e => {
    const row = e.target.closest('.row'); if (!row) return;
    const del = e.target.closest('[data-del]');
    if (del) {
      if (armedDelete === row.dataset.id) { queue({ op: 'del', id: row.dataset.id }); armedDelete = null; toast('Entry deleted'); return; }
      $$('.row-del.confirm').forEach(b => { b.classList.remove('confirm'); b.innerHTML = del.innerHTML; });
      armedDelete = row.dataset.id; del.classList.add('confirm'); del.textContent = 'Delete?';
      setTimeout(() => { if (armedDelete === row.dataset.id) { armedDelete = null; render(); } }, 3000);
      return;
    }
    openEdit(row.dataset.id);
  };

  $('#range').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; ui.range = +c.dataset.r; save(K.ui, ui); $$('#range .chip').forEach(x => x.classList.toggle('is-on', x === c)); render(); };
  $$('#range .chip').forEach(x => x.classList.toggle('is-on', +x.dataset.r === ui.range));

  $('#editCancel').onclick = () => $('#editDlg').close();
  $('#editDelete').onclick = () => { if (editing) queue({ op: 'del', id: editing.id }); $('#editDlg').close(); toast('Entry deleted'); };
  $('#editDlg').querySelector('form').onsubmit = ev => {
    const ts = new Date($('#editWhen').value).getTime();
    if (!editing || isNaN(ts)) return;
    const patch = { ts }; if (editing.ev === 'poop') patch.b = +$('#editType').value || null;
    queue({ op: 'edit', id: editing.id, patch }); toast('Saved');
  };

  // settings
  const fill = () => { $('#sOwner').value = cfg.owner; $('#sRepo').value = cfg.repo; $('#sBranch').value = cfg.branch; $('#sPath').value = cfg.path; $('#sToken').value = cfg.token; };
  const msg = (t, c = '') => { const m = $('#setMsg'); m.textContent = t; m.className = 'set-msg ' + c; };
  $('#settingsBtn').onclick = () => { fill(); msg(lastErr, lastErr ? 'err' : ''); $('#setDlg').showModal(); };
  $('#syncBtn').onclick = () => connected() ? sync() : $('#settingsBtn').click();
  $('#setSave').onclick = async () => {
    const wasLocal = !connected();
    cfg = { owner: $('#sOwner').value.trim(), repo: $('#sRepo').value.trim(), branch: $('#sBranch').value.trim() || 'data',
      path: $('#sPath').value.trim().replace(/^\/+/, '') || 'data/gut-log.csv', token: $('#sToken').value.trim() };
    save(K.cfg, cfg); branchOk = false;
    if (!connected()) return msg('Fill in owner, repository and token.', 'err');
    // entries logged before connecting get uploaded too
    if (wasLocal && snapshot.length) { pending = snapshot.map(e => ({ op: 'add', e })).concat(pending); snapshot = []; save(K.pend, pending); save(K.snap, snapshot); }
    msg('Connecting…'); await sync();
    lastErr ? msg(lastErr, 'err') : msg(`Connected · ${entries().length} entries`, 'ok');
  };
  $('#setDisconnect').onclick = () => {
    snapshot = entries(); pending = []; save(K.snap, snapshot); save(K.pend, pending);
    cfg.token = ''; save(K.cfg, cfg); lastErr = ''; fill(); msg('Disconnected. Entries stay on this phone.'); render();
  };
  $('#expCsv').onclick = () => download(`gut-log-${dayKey(Date.now())}.csv`, new Blob(['﻿' + toCSV(entries())], { type: 'text/csv' }));
  $('#expXlsx').onclick = async () => {
    try {
      const X = await loadXLSX(), list = entries();
      const ws = X.utils.aoa_to_sheet([CSV_HEAD, ...toRows(list)]);
      ws['!cols'] = [10, 26, 12, 7, 8, 10, 12, 48].map(w => ({ wch: w }));
      const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Log');
      download(`gut-log-${dayKey(Date.now())}.xlsx`, new Blob([X.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    } catch (e) { msg(e.message, 'err'); }
  };
  $('#impFile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const r = await importFile(f); msg(`Read ${r.found} rows, added ${r.added} new.`, 'ok'); }
    catch (err) { msg(err.message || 'Could not read that file', 'err'); }
  };

  document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); scheduleSync(200); } });
  addEventListener('online', () => scheduleSync(200));
  setInterval(() => { if (!document.hidden) renderKpis(entries()), renderRecent(entries()); }, 60e3);

  setTab(ui.tab);
  scheduleSync(100);
}
init();
})();
