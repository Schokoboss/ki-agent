'use strict';
/* Nova – Handy-App für den lokalen KI-Agenten.
   Spricht über den Cloudflare-Tunnel mit dem Laptop. Die Tunnel-Adresse holt sie
   sich aus einem geheimen Gist, Zugangsschlüssel kommt per QR-Code. */

const $ = (s, el = document) => el.querySelector(s);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privater Modus */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* egal */ } },
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const state = {
  conn: LS.get('nova.conn', null),          // { t: Token, g: Gist-ID, u: Laptop-URL }
  settings: Object.assign({ thinking: false, free_hand: false, speak: false, mode: 'auto', phoneModel: 'Qwen3.5-2B' },
    LS.get('nova.settings', {})),
  localRunning: false,
  online: false,
  status: null,
  conv: null,
  running: false,
  evIndex: 0,
  pendingImages: [],
  resumeView: null,
  wakeLock: null,
  installPrompt: null,
  work: { minutes: 0, free: false },   // Arbeitszeit für den nächsten Auftrag
  skew: 0,                             // Laptop-Uhr minus Handy-Uhr (Sekunden)
};

const els = {
  scroller: $('#scroller'), messages: $('#messages'), empty: $('#empty'), input: $('#input'),
  send: $('#btnSend'), status: $('#status'), file: $('#file'), attachments: $('#attachments'),
  drawer: $('#drawer'), scrim: $('#scrim'), convList: $('#convList'), settings: $('#settings'),
  pair: $('#pair'), toast: $('#toast'), mic: $('#btnMic'),
};

function icon(name) {
  return `<svg><use href="#i-${name}"/></svg>`;
}
function h(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
let toastTimer;
function toast(msg, ms = 2600) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), ms);
}

/* ------------------------------------------------------------ Markdown */

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?'"])/g, (_, p, u) => {
    let label = u.replace(/^https?:\/\/(www\.)?/, '');
    if (label.length > 42) label = label.slice(0, 40) + '…';
    return `${p}<a href="${u}" target="_blank" rel="noopener">${label}</a>`;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
}

const LIST_RE = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/;
function blocks(text) {
  const lines = text.split('\n');
  let out = '';
  let i = 0;
  const isStart = l => /^(#{1,6})\s/.test(l) || LIST_RE.test(l) || /^\s*>/.test(l) || /^\s*\|.*\|\s*$/.test(l);
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if (!l.trim()) { i++; continue; }
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) {
      const lvl = Math.min(m[1].length + 2, 5);
      out += `<h${lvl}>${inline(m[2])}</h${lvl}>`; i++; continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out += '<hr>'; i++; continue; }
    if (/^\s*>/.test(l)) {
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out += `<blockquote>${blocks(q.join('\n'))}</blockquote>`; continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const row = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = row(l);
      i += 2;
      let body = '';
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        body += '<tr>' + row(lines[i++]).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
      }
      out += `<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
      continue;
    }
    if ((m = l.match(LIST_RE))) {
      const ordered = /\d/.test(m[2]);
      let items = '';
      while (i < lines.length && (m = lines[i].match(LIST_RE))) {
        let item = m[3];
        i++;
        while (i < lines.length && lines[i].trim() && !LIST_RE.test(lines[i]) && /^\s{2,}/.test(lines[i])) item += ' ' + lines[i++].trim();
        const pad = m[1].length >= 2 ? ' style="margin-left:1.1em"' : '';
        items += `<li${pad}>${inline(item)}</li>`;
      }
      out += ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !(para.length && isStart(lines[i]))) para.push(lines[i++]);
    out += `<p>${para.map(inline).join('<br>')}</p>`;
  }
  return out;
}

function md(src) {
  const parts = src.split(/^```/m);
  let out = '';
  parts.forEach((p, idx) => {
    if (idx % 2) {
      const nl = p.indexOf('\n');
      const code = nl >= 0 ? p.slice(nl + 1) : '';
      out += `<pre><button class="copy-code" type="button">Kopieren</button><code>${esc(code.replace(/\n$/, ''))}</code></pre>`;
    } else {
      out += blocks(p);
    }
  });
  return out;
}

function plainText(src) {
  return src.replace(/```[\s\S]*?```/g, ' (Code) ').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '').replace(/[*_#>|~]/g, '').replace(/\n{2,}/g, '. ').trim();
}

/* ------------------------------------------------------------ Verbindung */

function isLocalPage() {
  return ['localhost', '127.0.0.1'].includes(location.hostname);
}

function readPairing() {
  if (!/[#&]t=/.test(location.hash)) return;
  const p = new URLSearchParams(location.hash.slice(1));
  const conn = { t: p.get('t'), g: p.get('g') || state.conn?.g || '', u: p.get('u') || state.conn?.u || '' };
  history.replaceState(null, '', location.pathname + location.search);
  if (!conn.t) return;
  state.conn = conn;
  LS.set('nova.conn', conn);
  toast('Gekoppelt ✓');
}

/* ------------------------------------------------------------ Handy-Modus (ohne Laptop) */

const LOCAL_KEY = 'nova.localConvs';
function localConvs() { return LS.get(LOCAL_KEY, {}); }
function saveLocalConvs(all) {
  const keep = Object.values(all).sort((a, b) => b.updated - a.updated).slice(0, 30);
  LS.set(LOCAL_KEY, Object.fromEntries(keep.map(c => [c.id, c])));
}
const isLocalConv = id => !!id && id.startsWith('h_');
const phoneLabel = () => (NovaLocal.MODELS.find(m => m.id === state.settings.phoneModel) || NovaLocal.MODELS[0]).label;

function useLocal() {
  if (isLocalConv(state.conv) || state.settings.mode === 'phone') return true;
  if (state.settings.mode === 'laptop') return false;
  return !state.online;
}

function showPhoneStatus(extra) {
  setStatus('phone', `Handy-KI · ${phoneLabel()}${extra || ''}`);
}

async function sendLocal(text) {
  if (state.pendingImages.length) toast('Fotos gehen nur mit dem Laptop – ich schicke nur den Text.');
  if (!text) return;
  if (state.conv && !isLocalConv(state.conv)) { newChat(); toast('Neuer Chat mit der Handy-KI'); }
  const all = localConvs();
  let conv = state.conv && all[state.conv];
  if (!conv) {
    conv = { id: 'h_' + Date.now().toString(36), title: text.replace(/\s+/g, ' ').slice(0, 48), updated: Date.now() / 1000, messages: [] };
    state.conv = conv.id;
    LS.set('nova.lastConv', conv.id);
  }
  conv.messages.push({ role: 'user', content: text, _display: text });
  const save = () => { conv.updated = Date.now() / 1000; const a = localConvs(); a[conv.id] = conv; saveLocalConvs(a); };
  save();
  els.input.value = '';
  autoGrow();
  state.pendingImages = [];
  renderAttachments();
  addUser(text);
  const ctx = { view: new TurnView(true) };
  state.localRunning = true;
  setRunning(true);
  try {
    await NovaLocal.run({ modelId: state.settings.phoneModel, messages: conv.messages, user: state.status?.user,
      emit: ev => handleEvent(ev, ctx), onSave: save });
  } catch (e) {
    ctx.view.error('Handy-KI: ' + (e.message || e));
  }
  state.localRunning = false;
  setRunning(false);
}

function setStatus(s, text) {
  const labels = { online: 'bereit', loading: 'Modell lädt …', connecting: 'verbinde …', offline: 'Laptop offline', unpaired: 'nicht gekoppelt', phone: 'Handy-KI' };
  els.status.dataset.s = s;
  $('b', els.status).textContent = text || labels[s] || s;
  $('#infoStatus').textContent = text || labels[s] || s;
}

async function ping(url) {
  try {
    const r = await fetch(url + '/api/status', {
      headers: { Authorization: 'Bearer ' + state.conn.t }, cache: 'no-store', signal: AbortSignal.timeout(9000),
    });
    if (r.status === 401) return 'unauth';
    if (!r.ok) return false;
    const j = await r.json();
    state.status = j;
    if (j.now) state.skew = j.now - Date.now() / 1000;
    return j.ok ? 'ok' : false;
  } catch {
    return false;
  }
}

async function gistUrl() {
  if (!state.conn?.g) return null;
  try {
    const r = await fetch(`https://api.github.com/gists/${encodeURIComponent(state.conn.g)}`, { cache: 'no-store', signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const j = await r.json();
    return JSON.parse(j.files['agent-endpoint.json'].content).url || null;
  } catch {
    return null;
  }
}

let connecting = null;
let retryTimer = null;
function connect() {
  if (!connecting) connecting = doConnect().finally(() => { connecting = null; });
  return connecting;
}

async function doConnect() {
  clearTimeout(retryTimer);
  if (!state.conn?.t) {
    if (state.settings.mode === 'phone') { showPair(false); showPhoneStatus(); return false; }
    showPair(true); setStatus('unpaired'); return false;
  }
  showPair(false);
  if (state.settings.mode !== 'phone') setStatus('connecting');
  const tried = new Set();
  const attempt = async url => {
    if (!url || tried.has(url)) return false;
    tried.add(url);
    const res = await ping(url);
    if (res === 'unauth') { unpair('Der Schlüssel passt nicht mehr – bitte neu koppeln.'); return 'stop'; }
    return res === 'ok' ? url : false;
  };
  let url = await attempt(state.conn.u);
  if (url === 'stop') return false;
  if (!url) {
    url = await attempt(await gistUrl());
    if (url === 'stop') return false;
  }
  if (!url && isLocalPage()) url = await attempt(location.origin);
  if (!url) {
    state.online = false;
    if (state.settings.mode === 'laptop') setStatus('offline');
    else showPhoneStatus(state.settings.mode === 'auto' ? ' (Laptop aus)' : '');
    retryTimer = setTimeout(connect, 12000);
    return false;
  }
  state.conn.u = url;
  LS.set('nova.conn', state.conn);
  state.online = true;
  applyStatus();
  return true;
}

function applyStatus() {
  const st = state.status || {};
  $('#agentName').textContent = st.agent || 'Nova';
  document.title = st.agent || 'Nova';
  $('#hello').textContent = `Hey${st.user ? ' ' + st.user : ''}! Was soll ich für dich tun?`;
  $('#infoModel').textContent = st.model || '–';
  $('#infoUrl').textContent = state.conn?.u ? state.conn.u.replace(/^https?:\/\//, '') : '–';
  if (state.settings.mode === 'phone') {
    showPhoneStatus();
  } else if (st.llama && st.llama !== 'bereit') {
    setStatus('loading');
    clearTimeout(retryTimer);
    retryTimer = setTimeout(async () => { if (await ping(state.conn.u) === 'ok') applyStatus(); }, 4000);
  } else {
    setStatus('online');
  }
}

function unpair(msg) {
  state.conn = null;
  state.online = false;
  LS.del('nova.conn');
  setStatus('unpaired');
  showPair(true);
  if (msg) toast(msg, 4000);
}

function showPair(show) {
  els.pair.hidden = !show;
}

async function api(path, opts = {}) {
  if (!state.conn?.u) throw new Error('Keine Verbindung zum Laptop');
  const headers = { Authorization: 'Bearer ' + state.conn.t };
  if (opts.body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(state.conn.u + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  } catch (e) {
    state.online = false;
    connect();
    throw new Error('Laptop nicht erreichbar');
  }
  if (res.status === 401) { unpair('Nicht mehr gekoppelt – bitte QR-Code neu scannen.'); throw new Error('Nicht gekoppelt'); }
  return res;
}

async function apiJSON(path, opts) {
  const r = await api(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Fehler ${r.status}`);
  return j;
}

/* ------------------------------------------------------------ Darstellung */

const TOOL_META = {
  web_search: ['Websuche', 'search', a => a.query],
  open_webpage: ['Webseite', 'globe', a => (a.url || '').replace(/^https?:\/\/(www\.)?/, '')],
  wikipedia: ['Wikipedia', 'book', a => a.query],
  weather: ['Wetter', 'cloud', a => a.location],
  calculate: ['Rechnen', 'calc', a => a.expression],
  run_python: ['Python', 'code', a => (a.code || '').split('\n').find(l => l.trim() && !l.trim().startsWith('#')) || ''],
  run_powershell: ['PowerShell', 'terminal', a => a.command],
  list_files: ['Ordner', 'folder', a => a.path || 'Arbeitsordner'],
  read_file: ['Datei lesen', 'file', a => a.path],
  write_file: ['Datei schreiben', 'edit', a => a.path],
  open_on_laptop: ['Am Laptop öffnen', 'laptop', a => a.target],
  laptop_status: ['Laptop-Status', 'laptop', () => ''],
  remember: ['Merken', 'star', a => a.fact],
  forget: ['Vergessen', 'star', a => a.id],
  update_notes: ['Notizen', 'edit', a => (a.notes || '').split('\n').find(l => l.trim()) || ''],
};

function argsDetail(name, args) {
  if (name === 'update_notes') return args.notes || '';
  if (name === 'run_python') return args.code || '';
  if (name === 'run_powershell') return args.command || '';
  if (name === 'write_file') return `${args.path || ''}\n\n${(args.content || '').slice(0, 3000)}`;
  return JSON.stringify(args, null, 2);
}

let autoScroll = true;
els.scroller.addEventListener('scroll', () => {
  const s = els.scroller;
  autoScroll = s.scrollHeight - s.scrollTop - s.clientHeight < 120;
}, { passive: true });
function scrollDown(force) {
  if (force || autoScroll) els.scroller.scrollTop = els.scroller.scrollHeight;
}

const imageCache = new Map();
async function loadImage(img, id) {
  if (id.startsWith('data:')) { img.src = id; return; }
  if (imageCache.has(id)) { img.src = imageCache.get(id); return; }
  try {
    const r = await api('/api/uploads/' + id);
    if (!r.ok) return;
    const url = URL.createObjectURL(await r.blob());
    imageCache.set(id, url);
    img.src = url;
  } catch { /* Bild bleibt leer */ }
}

function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  const hh = Math.floor(sec / 3600), mm = Math.floor(sec % 3600 / 60), ss = sec % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')} h` : `${mm}:${String(ss).padStart(2, '0')} min`;
}
function fmtMinutes(m) {
  if (!m) return 'Normal';
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}
const serverNow = () => Date.now() / 1000 + state.skew;

function addUser(text, images = [], work = 0) {
  els.empty.hidden = true;
  const wrap = h('div', 'user');
  if (work) wrap.append(h('span', 'work-badge', `${icon('clock')}Auftrag · ${esc(fmtMinutes(work))}`));
  if (images.length) {
    const imgs = h('div', 'imgs');
    images.forEach(id => { const img = h('img'); img.alt = 'Foto'; loadImage(img, id); imgs.append(img); });
    wrap.append(imgs);
  }
  if (text) { const b = h('div', 'bubble'); b.textContent = text; wrap.append(b); }
  els.messages.append(wrap);
  scrollDown(true);
}

class TurnView {
  constructor(live) {
    els.empty.hidden = true;
    this.el = h('div', 'turn');
    els.messages.append(this.el);
    this.tools = {};
    this.textEl = null;
    this.raw = '';
    this.allText = '';
    this.thinkEl = null;
    this.thinkRaw = '';
    this.used = false;
    this.renderTimer = null;
    this.typing = null;
    if (live) this.showTyping();
  }
  showTyping() {
    if (this.typing) return;
    this.typing = h('div', 'typing', '<span></span><span></span><span></span>');
    this.el.append(this.typing);
  }
  hideTyping() {
    if (this.typing) { this.typing.remove(); this.typing = null; }
  }
  append(node) {
    this.hideTyping();
    this.el.append(node);
    scrollDown();
  }
  step() {
    this.flush();
    this.textEl = null;
    this.raw = '';
    this.thinkEl = null;
    this.thinkRaw = '';
  }
  think(d, done) {
    if (!this.thinkEl) {
      this.thinkEl = h('details', 'think', `<summary>${icon('bulb')}<span>Gedanken</span></summary><div class="tbody"></div>`);
      if (!done) this.thinkEl.open = true;
      this.append(this.thinkEl);
    }
    this.thinkRaw += d;
    $('.tbody', this.thinkEl).textContent = this.thinkRaw;
    if (done) this.thinkEl.open = false;
    scrollDown();
  }
  text(d) {
    this.used = true;
    if (this.thinkEl && this.thinkEl.open) this.thinkEl.open = false;
    if (!this.textEl) { this.textEl = h('div', 'md'); this.append(this.textEl); }
    this.raw += d;
    this.allText += d;
    if (!this.renderTimer) this.renderTimer = setTimeout(() => this.flush(), 70);
  }
  flush() {
    clearTimeout(this.renderTimer);
    this.renderTimer = null;
    if (this.textEl) { this.textEl.innerHTML = md(this.raw); scrollDown(); }
  }
  prep() {
    this.showTyping();
  }
  progress(p) {
    if (!this.loadEl) { this.loadEl = h('div', 'status-line'); this.append(this.loadEl); this.showTyping(); }
    this.loadEl.textContent = p >= 1 ? `Handy-Modell ${phoneLabel()} bereit` : `Lade Handy-Modell ${phoneLabel()} … ${Math.round(p * 100)} %`;
  }
  work(info) {
    if (!info || !info.deadline) return;
    this.workInfo = info;
    if (!this.workEl) {
      this.workEl = h('div', 'work-card', `
        <div class="wc-top">${icon('clock')}<b>Auftrag läuft</b><span class="wc-left"></span></div>
        <div class="wc-bar"><i></i></div><div class="wc-meta"></div>
        <details class="wc-notes" hidden><summary>Arbeitsnotizen</summary><pre></pre></details>`);
      this.el.prepend(this.workEl);
      this.workTimer = setInterval(() => this.tickWork(), 1000);
    }
    if (info.notes) this.notes(info.notes);
    this.tickWork();
  }
  tickWork() {
    const w = this.workInfo;
    if (!w || !this.workEl) return;
    const total = w.deadline - w.started;
    const left = w.deadline - serverNow();
    $('.wc-left', this.workEl).textContent = left > 0 ? 'noch ' + fmtDur(left) : 'Zeit um';
    $('.wc-bar i', this.workEl).style.width = Math.min(100, 100 * (1 - Math.max(0, left) / total)) + '%';
    const until = new Date((w.deadline - state.skew) * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    $('.wc-meta', this.workEl).textContent = `Schritt ${w.step || 1} · bis ${until} Uhr${w.free_hand ? ' · ohne Nachfragen' : ''}`;
  }
  notes(text) {
    if (!this.workEl || !text) return;
    const d = $('.wc-notes', this.workEl);
    d.hidden = false;
    $('pre', d).textContent = text;
  }
  endWork(stats) {
    if (!this.workEl) return;
    clearInterval(this.workTimer);
    this.workEl.classList.add('finished');
    const label = stats?.cancelled ? 'Auftrag abgebrochen' : 'Auftrag beendet';
    $('.wc-top b', this.workEl).textContent = label;
    $('.wc-left', this.workEl).textContent = stats?.seconds ? fmtDur(stats.seconds) : '';
    $('.wc-bar i', this.workEl).style.width = '100%';
    if (stats?.steps) $('.wc-meta', this.workEl).textContent = `${stats.steps} Schritte · ${stats.tools || 0} Werkzeuge`;
  }
  tool(ev) {
    this.used = true;
    if (ev.name === 'update_notes') this.notes(ev.args?.notes);
    if (this.thinkEl && this.thinkEl.open) this.thinkEl.open = false;
    this.flush();
    const [label, ic, summary] = TOOL_META[ev.name] || [ev.name, 'sliders', () => ''];
    const args = ev.args || {};
    const el = h('details', 'tool running', `
      <summary><span class="ic">${icon(ic)}</span><span class="tname">${esc(label)}</span>
      <span class="targ">${esc(summary(args) || '')}</span><span class="tstate"><span class="spinner"></span></span></summary>
      <div class="tdetail"><span class="lbl">Eingabe</span><pre class="a"></pre></div>`);
    $('pre.a', el).textContent = argsDetail(ev.name, args);
    this.tools[ev.id] = { el, name: ev.name, args };
    this.append(el);
    this.showTyping();
  }
  approve(ev, convId) {
    const t = this.tools[ev.id];
    if (!t) return;
    t.el.classList.add('wait');
    t.el.open = false;
    const box = h('div', 'approval', `
      <div class="why">${icon('alert')}<span></span></div><pre></pre>
      <div class="btns"><button class="deny" type="button">Ablehnen</button><button class="allow" type="button">Erlauben</button></div>`);
    $('.why span', box).textContent = ev.reason || 'Darf der Agent das?';
    $('pre', box).textContent = argsDetail(ev.name, ev.args || {});
    const answer = async allow => {
      $('.btns', box).innerHTML = `<span class="note">${allow ? 'Erlaubt – wird ausgeführt …' : 'Abgelehnt.'}</span>`;
      try {
        await apiJSON('/api/approve', { method: 'POST', body: JSON.stringify({ conversation_id: convId, id: ev.id, allow }) });
      } catch (e) { toast(e.message); }
    };
    $('.deny', box).onclick = () => answer(false);
    $('.allow', box).onclick = () => answer(true);
    t.box = box;
    t.el.after(box);
    box.style.cssText = 'border:1px solid var(--border);border-radius:14px;margin-top:-4px';
    this.hideTyping();
    scrollDown(true);
    if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
  }
  decided(ev, allow) {
    const t = this.tools[ev.id];
    if (!t) return;
    t.el.classList.remove('wait');
    if (t.box) t.box.remove();
    if (allow) this.showTyping();
  }
  result(ev) {
    const t = this.tools[ev.id];
    if (!t) return;
    t.el.classList.remove('running', 'wait');
    t.el.classList.add(ev.ok ? 'ok' : 'fail');
    $('.tstate', t.el).innerHTML = icon(ev.ok ? 'check' : 'x');
    const det = $('.tdetail', t.el);
    det.insertAdjacentHTML('beforeend', `<span class="lbl">${ev.denied ? 'Abgelehnt' : 'Ergebnis'}</span><pre class="r"></pre>`);
    $('pre.r', det).textContent = ev.preview || '';
    if (t.box) { t.box.remove(); t.box = null; }
    this.showTyping();
  }
  status(d) {
    this.append(h('div', 'status-line', esc(d)));
    this.showTyping();
  }
  error(msg, retry) {
    this.flush();
    const e = h('div', 'err', `${icon('alert')}<span></span>`);
    $('span', e).textContent = msg;
    this.append(e);
    if (retry) {
      const b = h('button', 'btn', 'Nochmal versuchen');
      b.type = 'button';
      b.onclick = () => { b.remove(); retry(); };
      e.append(b);
    }
    this.endWork({ cancelled: true });
    this.finish();
  }
  finish(stats) {
    this.flush();
    this.hideTyping();
    if (stats) this.endWork(stats);
    Object.values(this.tools).forEach(t => {
      if (t.el.classList.contains('running')) { t.el.classList.remove('running'); $('.tstate', t.el).innerHTML = ''; }
    });
    if (!this.allText && !stats) return;
    const foot = h('div', 'turn-foot');
    if (this.allText) {
      const copy = h('button', '', icon('copy'));
      copy.type = 'button';
      copy.setAttribute('aria-label', 'Antwort kopieren');
      copy.onclick = () => navigator.clipboard?.writeText(this.allText).then(() => toast('Kopiert'));
      const say = h('button', '', icon('speaker'));
      say.type = 'button';
      say.setAttribute('aria-label', 'Vorlesen');
      say.onclick = () => speak(this.allText);
      foot.append(copy, say);
    }
    if (stats) {
      const parts = [];
      if (stats.tps) parts.push(`${stats.tps} Tok/s`);
      if (stats.tools) parts.push(`${stats.tools} Werkzeug${stats.tools > 1 ? 'e' : ''}`);
      if (stats.seconds) parts.push(`${stats.seconds} s`);
      if (stats.cancelled) parts.push('abgebrochen');
      foot.append(h('span', 'stats', esc(parts.join(' · '))));
    }
    this.el.append(foot);
    scrollDown();
  }
}

els.messages.addEventListener('click', e => {
  const b = e.target.closest('.copy-code');
  if (!b) return;
  navigator.clipboard?.writeText(b.nextElementSibling.textContent).then(() => toast('Code kopiert'));
});

function renderHistory(messages, live) {
  els.messages.innerHTML = '';
  els.empty.hidden = messages.length > 0;
  let view = null;
  for (const m of messages) {
    if (m.role === 'user' && m._system) {
      (view ||= new TurnView(false)).status(m._system);
      view.hideTyping();
      continue;
    }
    if (m.role === 'user') {
      if (view) view.finish();
      addUser(m._display ?? m.content.replace(/^\[[^\]]*\]\s*/, ''), m._images || [], m._work || 0);
      view = new TurnView(false);
      continue;
    }
    if (!view) view = new TurnView(false);
    if (m.role === 'assistant') {
      if (view.used) view.step();
      if (m._thinking) view.think(m._thinking, true);
      if (m.content) view.text(m.content);
      for (const tc of m.tool_calls || []) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* egal */ }
        view.tool({ id: tc.id, name: tc.function.name, args });
      }
    } else if (m.role === 'tool') {
      view.result({ id: m.tool_call_id, ok: m._ok !== false, preview: (m.content || '').slice(0, 2000) });
      view.hideTyping();
    }
  }
  if (view && !live) view.finish();
  if (view && live) { view.flush(); view.step(); }
  scrollDown(true);
  return view;
}

/* ------------------------------------------------------------ Senden & Streamen */

function setRunning(on) {
  state.running = on;
  els.send.classList.toggle('stop', on);
  els.send.innerHTML = icon(on ? 'stop' : 'up');
  els.send.setAttribute('aria-label', on ? 'Stoppen' : 'Senden');
  updateSend();
  if (on && 'wakeLock' in navigator) {
    navigator.wakeLock.request('screen').then(l => { state.wakeLock = l; }).catch(() => {});
  } else if (!on && state.wakeLock) {
    state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  }
}

function updateSend() {
  els.send.disabled = !state.running && !els.input.value.trim() && !state.pendingImages.length;
}

function handleEvent(ev, ctx) {
  const view = () => (ctx.view ||= new TurnView(true));
  switch (ev.t) {
    case 'conv':
      if (state.conv !== ev.id) { state.conv = ev.id; LS.set('nova.lastConv', ev.id); }
      refreshConvs();
      break;
    case 'user': break;  // steht schon im Verlauf
    case 'load': view().progress(ev.p); break;
    case 'work': view().work(ev); break;
    case 'think': view().think(ev.d); break;
    case 'text': view().text(ev.d); break;
    case 'step': view().step(); break;
    case 'prep': view().prep(ev.name); break;
    case 'tool': view().tool(ev); break;
    case 'approve': view().approve(ev, state.conv); break;
    case 'approved': view().decided(ev, true); break;
    case 'denied': view().decided(ev, false); break;
    case 'result': view().result(ev); break;
    case 'status': view().status(ev.d); break;
    case 'error':
      view().error(ev.d);
      return true;
    case 'done':
      view().finish(ev.stats);
      if (state.settings.speak && view().allText) speak(view().allText);
      return true;
    default: break;
  }
  return false;
}

async function consume(res, ctx) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.i != null) state.evIndex = ev.i + 1;
        if (handleEvent(ev, ctx)) finished = true;
      }
    }
  } catch { /* Verbindung abgerissen – unten wieder einklinken */ }
  if (finished) { setRunning(false); return; }
  await resume(ctx);
}

async function resume(ctx) {
  const conv = state.conv;
  for (let n = 0; n < 25; n++) {
    await sleep(n ? 2500 : 600);
    if (state.conv !== conv) return;
    if (document.hidden) { state.resumeView = ctx; return; }
    try {
      const r = await api(`/api/stream/${conv}?from=${state.evIndex}`);
      if (r.status === 404 || r.status === 410) break;  // 410: zu lange weg – Verlauf neu laden
      if (r.ok) return consume(r, ctx);
    } catch { /* gleich nochmal */ }
  }
  setRunning(false);
  if (conv) openConv(conv);
}

async function send(textOverride) {
  if (state.running) return stop();
  const text = (textOverride ?? els.input.value).trim();
  const images = state.pendingImages.slice();
  if (!text && !images.length) return;
  let local = useLocal();
  if (!local && !state.online && !(await connect())) {
    if (state.settings.mode === 'laptop') { toast('Laptop ist nicht erreichbar.'); return; }
    local = true;
  }
  if (local) {
    if (state.work.minutes) { toast('Arbeitszeit-Aufträge gehen nur mit dem Laptop.'); state.work.minutes = 0; updateWorkChip(); }
    return sendLocal(text);
  }
  const work = state.work.minutes;
  const settings = { ...state.settings, work_minutes: work, free_hand: state.settings.free_hand || (work > 0 && state.work.free) };
  els.input.value = '';
  autoGrow();
  state.pendingImages = [];
  renderAttachments();
  if (work) { state.work.minutes = 0; updateWorkChip(); }
  addUser(text, images, work);
  const ctx = { view: new TurnView(true), replay: false };
  state.evIndex = 0;
  setRunning(true);
  try {
    const res = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ conversation_id: state.conv, text, images, settings }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      ctx.view.error(j.error || `Fehler ${res.status}`);
      setRunning(false);
      return;
    }
    await consume(res, ctx);
  } catch (e) {
    ctx.view.error(e.message, () => { els.messages.lastElementChild?.remove(); els.messages.lastElementChild?.remove(); send(text); });
    setRunning(false);
  }
}

async function stop() {
  if (state.localRunning) { NovaLocal.stop(); return; }
  if (!state.conv) return;
  try { await apiJSON('/api/stop', { method: 'POST', body: JSON.stringify({ conversation_id: state.conv }) }); } catch { /* egal */ }
}

/* ------------------------------------------------------------ Chats */

function relTime(ts) {
  const d = (Date.now() / 1000 - ts) / 60;
  if (d < 1) return 'gerade eben';
  if (d < 60) return `vor ${Math.round(d)} min`;
  if (d < 1440) return `vor ${Math.round(d / 60)} h`;
  return new Date(ts * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

async function refreshConvs() {
  try {
    const [{ conversations: server }, status] = state.online
      ? await Promise.all([apiJSON('/api/conversations'), apiJSON('/api/status').catch(() => ({}))])
      : [{ conversations: [] }, {}];
    const live = new Set((status.active || []).map(a => a.id));
    const local = Object.values(localConvs()).map(c => ({ id: c.id, title: c.title, updated: c.updated, local: true }));
    const conversations = [...server, ...local].sort((a, b) => b.updated - a.updated);
    els.convList.innerHTML = conversations.length ? '' : '<p class="muted small" style="padding:10px">Noch keine Chats.</p>';
    for (const c of conversations) {
      const row = h('div', 'conv' + (c.id === state.conv ? ' active' : ''));
      row.innerHTML = `<button class="open" type="button"><span class="t"></span><span class="d">${relTime(c.updated)}</span></button>
        <button class="del" type="button" aria-label="Chat löschen">${icon('trash')}</button>`;
      $('.t', row).textContent = c.title || 'Chat';
      if (live.has(c.id)) $('.d', row).insertAdjacentHTML('beforeend', '<span class="live">arbeitet</span>');
      if (c.local) $('.d', row).insertAdjacentHTML('beforeend', '<span class="phone">Handy</span>');
      $('.open', row).onclick = () => { closeDrawer(); openConv(c.id); };
      $('.del', row).onclick = async () => {
        if (!confirm(`Chat „${c.title}“ löschen?`)) return;
        if (c.local) { const a = localConvs(); delete a[c.id]; LS.set(LOCAL_KEY, a); }
        else await apiJSON('/api/conversations/' + c.id, { method: 'DELETE' }).catch(e => toast(e.message));
        if (c.id === state.conv) newChat();
        refreshConvs();
      };
      els.convList.append(row);
    }
  } catch { /* offline */ }
}

async function openConv(id) {
  if (state.running && id !== state.conv) setRunning(false);
  state.conv = id;
  LS.set('nova.lastConv', id);
  if (isLocalConv(id)) {
    const c = localConvs()[id];
    if (c) renderHistory(c.messages, false); else newChat();
    return;
  }
  try {
    const c = await apiJSON('/api/conversations/' + id);
    if (state.conv !== id) return;
    if (c.now) state.skew = c.now - Date.now() / 1000;
    const last = renderHistory(c.messages, c.running);
    if (c.running) {
      setRunning(true);
      const ctx = { view: last, replay: true };
      if (c.work) (ctx.view ||= new TurnView(true)).work({ ...c.work, notes: c.notes });
      ctx.view?.showTyping();
      state.evIndex = c.resume_from || 0;
      const r = await api(`/api/stream/${id}?from=${state.evIndex}`);
      if (r.ok) consume(r, ctx);
      else setRunning(false);
    }
  } catch (e) {
    if (/nicht gefunden/.test(e.message)) newChat();
    else toast(e.message);
  }
}

function newChat() {
  if (state.running) setRunning(false);
  state.conv = null;
  LS.del('nova.lastConv');
  els.messages.innerHTML = '';
  els.empty.hidden = false;
  closeDrawer();
  els.input.focus();
}

function openDrawer() {
  els.drawer.classList.add('open');
  els.scrim.classList.add('show');
  refreshConvs();
}
function closeDrawer() {
  els.drawer.classList.remove('open');
  els.scrim.classList.remove('show');
}

/* ------------------------------------------------------------ Bilder, Sprache */

async function shrink(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const s = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

function renderAttachments() {
  els.attachments.innerHTML = '';
  state.pendingImages.forEach((src, i) => {
    const a = h('div', 'att', `<img alt="Anhang"><button type="button" aria-label="Entfernen">${icon('x')}</button>`);
    $('img', a).src = src;
    $('button', a).onclick = () => { state.pendingImages.splice(i, 1); renderAttachments(); };
    els.attachments.append(a);
  });
  updateSend();
}

els.file.addEventListener('change', async () => {
  for (const f of [...els.file.files].slice(0, 4 - state.pendingImages.length)) {
    try { state.pendingImages.push(await shrink(f)); } catch { toast('Bild konnte nicht gelesen werden'); }
  }
  els.file.value = '';
  renderAttachments();
  els.input.focus();
});

function speak(text) {
  if (!('speechSynthesis' in window)) return toast('Vorlesen geht auf diesem Gerät nicht');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(plainText(text).slice(0, 4000));
  u.lang = 'de-DE';
  const v = speechSynthesis.getVoices().find(x => x.lang?.startsWith('de'));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
if (SR) {
  els.mic.hidden = false;
  els.mic.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = 'de-DE';
    rec.interimResults = true;
    const base = els.input.value.trim();
    rec.onresult = e => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      els.input.value = (base ? base + ' ' : '') + t;
      autoGrow();
    };
    rec.onend = () => { rec = null; els.mic.classList.remove('rec'); };
    rec.onerror = e => { if (e.error !== 'aborted' && e.error !== 'no-speech') toast('Spracheingabe: ' + e.error); };
    els.mic.classList.add('rec');
    rec.start();
  };
}

/* ------------------------------------------------------------ Einstellungen */

function bindSetting(id, key, onChange) {
  const box = $(id);
  box.checked = !!state.settings[key];
  box.onchange = () => {
    state.settings[key] = box.checked;
    LS.set('nova.settings', state.settings);
    onChange?.(box.checked);
  };
}

async function loadMemory() {
  const list = $('#memoryList');
  if (!state.online) { list.innerHTML = '<p class="muted">Nicht verbunden.</p>'; return; }
  try {
    const { memory } = await apiJSON('/api/memory');
    if (!memory.length) {
      list.innerHTML = '<p class="muted">Noch nichts gemerkt. Sag z. B. „Merk dir, dass ich Minecraft-Shader baue.“</p>';
      return;
    }
    list.innerHTML = '';
    for (const m of memory) {
      const row = h('div', 'mem', `<span></span><button type="button" aria-label="Vergessen">${icon('trash')}</button>`);
      $('span', row).textContent = m.text;
      $('button', row).onclick = async () => {
        await apiJSON('/api/memory/' + m.id, { method: 'DELETE' }).catch(e => toast(e.message));
        loadMemory();
      };
      list.append(row);
    }
  } catch (e) {
    list.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

function renderModeSeg() {
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('sel', b.dataset.mode === state.settings.mode));
}

function setMode(mode) {
  state.settings.mode = mode;
  LS.set('nova.settings', state.settings);
  renderModeSeg();
  if (mode === 'phone') showPhoneStatus();
  else { state.online = false; connect(); }
}

async function loadLaptopModels() {
  const box = $('#laptopModels');
  if (!state.online) { box.innerHTML = '<p class="muted">Laptop nicht verbunden.</p>'; return; }
  try {
    const { models } = await apiJSON('/api/models');
    box.innerHTML = '';
    for (const m of models) {
      const row = h('button', 'model-row' + (m.active ? ' sel' : '') + (m.installed ? '' : ' off'),
        `<span class="pick"></span><span class="mi"><b></b><small></small></span>`);
      row.type = 'button';
      $('b', row).textContent = m.label;
      $('small', row).textContent = m.installed ? m.desc : m.desc + ' – wird noch geladen';
      row.onclick = async () => {
        if (m.active || !m.installed) return;
        try {
          await apiJSON('/api/model', { method: 'POST', body: JSON.stringify({ id: m.id }) });
          toast(`${m.label} wird geladen …`);
          setStatus('loading');
          setTimeout(async () => { if (await ping(state.conn.u) === 'ok') applyStatus(); }, 3000);
          loadLaptopModels();
        } catch (e) { toast(e.message); }
      };
      box.append(row);
    }
  } catch (e) {
    box.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

async function loadPhoneModels() {
  const box = $('#phoneModels');
  const gi = await NovaLocal.gpuInfo();
  if (!gi.ok) { box.innerHTML = `<p class="muted">${esc(gi.why)}</p>`; return; }
  box.innerHTML = '';
  for (const m of NovaLocal.MODELS) {
    const cached = await NovaLocal.isCached(m.id);
    const sel = state.settings.phoneModel === m.id;
    const row = h('div', 'model-row' + (sel ? ' sel' : ''),
      `<span class="pick"></span><span class="mi"><b></b><small></small></span><button type="button" class="btn act"></button>`);
    $('b', row).textContent = m.label;
    $('small', row).textContent = `${m.desc} · ${cached ? 'auf dem Handy ✓' : m.size}`;
    const act = $('.act', row);
    act.textContent = cached ? 'Löschen' : 'Laden';
    row.querySelector('.mi').onclick = row.querySelector('.pick').onclick = () => {
      state.settings.phoneModel = m.id;
      LS.set('nova.settings', state.settings);
      if (state.settings.mode !== 'laptop' && !state.online) showPhoneStatus();
      loadPhoneModels();
    };
    act.onclick = async () => {
      act.disabled = true;
      try {
        if (cached) {
          if (!confirm(`${m.label} vom Handy löschen?`)) { act.disabled = false; return; }
          await NovaLocal.remove(m.id);
        } else {
          await NovaLocal.load(m.id, p => { act.textContent = `${Math.round(p * 100)} %`; });
          toast(`${m.label} ist jetzt auf dem Handy`);
        }
      } catch (e) { toast('Fehler: ' + (e.message || e), 5000); }
      loadPhoneModels();
    };
    box.append(row);
  }
}

function openSettings() {
  closeDrawer();
  $('#btnInstall').hidden = !state.installPrompt;
  renderModeSeg();
  loadMemory();
  loadLaptopModels();
  loadPhoneModels();
  els.settings.showModal();
}

$('#modeSeg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) setMode(b.dataset.mode);
});
$('#btnPhoneOnly').onclick = () => { setMode('phone'); showPair(false); openSettings(); };

/* ------------------------------------------------------------ Arbeitszeit */

function updateWorkChip() {
  const chip = $('#btnWork');
  chip.classList.toggle('on', state.work.minutes > 0);
  $('#workLabel').textContent = state.work.minutes
    ? `Auftrag ${fmtMinutes(state.work.minutes)}${state.work.free ? ' · ohne Nachfragen' : ''}`
    : 'Normal';
  els.input.placeholder = state.work.minutes ? 'Beschreib deinen Auftrag …' : 'Frag mich irgendwas …';
}

function setWork(minutes) {
  state.work.minutes = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  document.querySelectorAll('#workGrid button').forEach(b => b.classList.toggle('sel', +b.dataset.m === state.work.minutes));
  updateWorkChip();
}

$('#btnWork').onclick = () => {
  setWork(state.work.minutes);
  $('#workFree').checked = state.work.free;
  $('#work').showModal();
};
$('#workGrid').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  setWork(+b.dataset.m);
  setTimeout(() => $('#work').close(), 150);
});
$('#workCustom').onclick = () => {
  const m = (+$('#workH').value || 0) * 60 + (+$('#workM').value || 0);
  setWork(m);
  $('#work').close();
};
$('#workFree').onchange = e => { state.work.free = e.target.checked; updateWorkChip(); };

/* ------------------------------------------------------------ Eingabe-Verhalten */

function autoGrow() {
  els.input.style.height = '';
  if (els.input.value && els.input.clientWidth > 0) {
    els.input.style.height = Math.min(els.input.scrollHeight, 160) + 'px';
  }
  updateSend();
}
window.addEventListener('resize', autoGrow);

els.input.addEventListener('input', autoGrow);
els.input.addEventListener('keydown', e => {
  const touch = matchMedia('(pointer: coarse)').matches;
  if (e.key === 'Enter' && !e.shiftKey && !touch) { e.preventDefault(); send(); }
});
els.send.onclick = () => send();
$('#btnAttach').onclick = () => els.file.click();
$('#btnMenu').onclick = openDrawer;
$('#btnDrawerClose').onclick = closeDrawer;
els.scrim.onclick = closeDrawer;
$('#btnNew').onclick = newChat;
$('#btnNew2').onclick = newChat;
$('#btnSettings').onclick = openSettings;
$('#btnTitle').onclick = openSettings;
$('#btnReconnect').onclick = async () => { state.online = false; if (await connect()) toast('Verbunden ✓'); else toast('Laptop nicht erreichbar'); };
$('#btnUnpair').onclick = () => { if (confirm('Wirklich entkoppeln? Danach musst du den QR-Code neu scannen.')) { els.settings.close(); unpair(); } };
$('#btnInstall').onclick = async () => { if (!state.installPrompt) return; state.installPrompt.prompt(); state.installPrompt = null; $('#btnInstall').hidden = true; };
$('#suggestions').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.photo) { els.file.click(); els.input.value = 'Was siehst du auf diesem Foto?'; autoGrow(); return; }
  send(b.dataset.q);
});
bindSetting('#setThinking', 'thinking');
bindSetting('#setSpeak', 'speak', on => { if (!on) speechSynthesis?.cancel(); });
bindSetting('#setFree', 'free_hand', on => { if (on) toast('Freie Hand an – der Agent fragt nicht mehr nach.', 3500); });

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installPrompt = e; });
window.addEventListener('online', () => connect());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (state.resumeView) { const ctx = state.resumeView; state.resumeView = null; resume(ctx); }
  else if (!state.online) connect();
});

/* ------------------------------------------------------------ Start */

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

(async function start() {
  readPairing();
  setRunning(false);
  updateWorkChip();
  autoGrow();
  const online = await connect();
  const last = LS.get('nova.lastConv', null);
  if (last && (online || isLocalConv(last))) openConv(last);
})();
