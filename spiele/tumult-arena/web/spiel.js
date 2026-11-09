'use strict';
// Tumult Arena – Browser-Client: Menü, Lobby, Netzwerk, Vorhersage, Steuerung, Darstellung.
const $ = s => document.querySelector(s);
const cv = $('#cv'), ctx = cv.getContext('2d');
const TAU = Math.PI * 2;
const INTERP = 0.1;                    // Sekunden Puffer für flüssige Bewegung der anderen
const EMOTES = ['👍', '😂', '😮', '😡', 'GG', '💀'];
const MODE_ICONS = { teamkampf: '⚔️', kristall: '💎', letzter: '☠️' };
const NAMES = ['Flitzer', 'Wirbelwind', 'Donnerbacke', 'Krawallo', 'Blitzbirne', 'Kugelfisch', 'Rumpel', 'Zack', 'Pfeffer', 'Knallfrosch'];
const ALLY = '#3ea0ff', ENEMY = '#ff4d5e', ME = '#4fd67a', GOLD = '#ffc93c';

const store = {
  get(k, d, s = localStorage) { try { const v = s.getItem('tumult.' + k); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v, s = localStorage) { try { s.setItem('tumult.' + k, v); } catch (e) { /* privat */ } },
};

const S = {
  ws: null, id: null, heroes: null, modes: null, info: null, room: null, screen: 'menu',
  name: store.get('name', ''), hero: store.get('hero', 'funke'), mode: store.get('mode', 'teamkampf'),
  token: store.get('token', '', sessionStorage), ping: 0, wantCode: null, autoAt: null, touch: false,
};
if (!S.name) S.name = NAMES[Math.random() * NAMES.length | 0] + (10 + Math.random() * 90 | 0);
if (!S.token) { S.token = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('token', S.token, sessionStorage); }
try { S.touch = matchMedia('(pointer: coarse)').matches; } catch (e) { /* alt */ }
{
  const q = new URLSearchParams(location.search).get('raum');
  if (q && /^[A-Za-z]{4}$/.test(q)) S.wantCode = q.toUpperCase();
}

let G = null;                         // laufende Partie
let W = 0, H = 0, DPR = 1;
const V = { s: 40, cx: 0, cy: 0, flip: false };

// ================================================================ Hilfen

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), ms);
}
function setStatus(text, cls = '') { const el = $('#netStatus'); el.textContent = text; el.className = 'status ' + cls; }
function show(name) {
  S.screen = name;
  for (const id of ['menu', 'lobby', 'result']) $('#' + id).hidden = id !== name;
  $('#hud').hidden = !(name === 'game');
  if (name !== 'game') $('#rotateHint').hidden = true;
}
const r3 = v => Math.round(v * 1000) / 1000;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, f) => a + (b - a) * f;
function lerpAng(a, b, f) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return a + d * f; }
function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function portrait(canvas, key, size, ang = 0.5) {
  const d = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.height = size * d;
  const c = canvas.getContext('2d');
  c.setTransform(d, 0, 0, d, 0, 0);
  Grafik.hero(c, key, size / 2, size * 0.56, size * 0.27, ang, { t: 0 });
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Link kopiert ✔'); return; } catch (e) { /* unsicherer Kontext */ }
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('Link kopiert ✔'); } catch (e) { toast(text, 5000); }
  ta.remove();
}

function goFullscreen() {
  if (!S.touch) return;
  const el = document.documentElement;
  try {
    const p = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el, { navigationUI: 'hide' });
    Promise.resolve(p).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  } catch (e) { /* nicht unterstützt */ }
}

// ================================================================ Netzwerk

function send(o) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)); }

function connect() {
  setStatus('Verbinde …');
  let ws;
  try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); } catch (e) { setTimeout(connect, 2000); return; }
  S.ws = ws;
  ws.onopen = () => { setStatus('Verbunden ✔', 'ok'); send({ t: 'hello', name: S.name, hero: S.hero, token: S.token }); };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } onMsg(m); };
  ws.onclose = () => {
    if (S.ws !== ws) return;
    S.ws = null;
    setStatus('Verbindung weg – verbinde neu …', 'bad');
    if (G) G.lost = true;
    setTimeout(connect, 1200);
  };
}
setInterval(() => send({ t: 'ping', c: performance.now() }), 2000);

function onMsg(m) {
  switch (m.t) {
    case 's': if (G) onSnap(m); break;
    case 'pong': S.ping = Math.round(performance.now() - m.c); break;
    case 'welcome': onWelcome(m); break;
    case 'room':
      S.room = m.room;
      S.autoAt = m.room.auto != null ? performance.now() / 1000 + m.room.auto : null;
      if (S.screen === 'menu' || S.screen === 'lobby') show('lobby');
      renderLobby();
      break;
    case 'start': startGame(m); break;
    case 'roster': if (G) setRoster(m.players); break;
    case 'end': if (G) endGame(m.result); break;
    case 'err': toast(m.msg, 3500); break;
    case 'left': S.room = null; if (!G) show('menu'); break;
  }
}

function onWelcome(m) {
  S.id = m.id; S.heroes = m.heroes; S.modes = m.modes; S.info = m.info;
  if (!S.heroes[S.hero]) S.hero = 'funke';
  if (!S.modes[S.mode]) S.mode = 'teamkampf';
  buildMenu();
  const rejoin = S.wantCode || (S.room && !G ? S.room.code : null);
  S.room = null;
  if (rejoin) {
    send({ t: 'join', code: rejoin, hero: S.hero });
    S.wantCode = null;
    if (location.search) history.replaceState(null, '', location.pathname);
  }
  if (G && G.lost) setTimeout(() => { if (G && G.lost) { G = null; toast('Verbindung zur Partie verloren'); show(S.room ? 'lobby' : 'menu'); } }, 2500);
}

async function refreshInfo() {
  try {
    const r = await fetch('/info', { cache: 'no-store' });
    S.info = await r.json();
    if (S.screen === 'menu') renderInvite($('#invite'), null);
    if (S.screen === 'lobby' && S.room) renderInvite($('#lobbyInvite'), S.room.code);
  } catch (e) { /* Server weg */ }
}
setInterval(() => { if (S.screen === 'menu' || S.screen === 'lobby') refreshInfo(); }, 8000);

// ================================================================ Menü

function heroStats(h) {
  const per = h.dmg * (h.count || 1);
  return [['Leben', h.hp, h.hp / 6000], ['Schaden', per, per / 2200], ['Reichweite', h.range, h.range / 11], ['Tempo', h.speed, (h.speed - 2.3) / 1.3]];
}

function buildHeroGrid(el, small, onPick) {
  el.innerHTML = '';
  for (const [key, h] of Object.entries(S.heroes)) {
    const b = document.createElement('button');
    b.className = 'hero-card' + (key === S.hero ? ' sel' : '');
    b.dataset.hero = key;
    b.title = `${h.name} – ${h.role}`;
    const c = document.createElement('canvas');
    b.appendChild(c);
    b.insertAdjacentHTML('beforeend', `<b>${esc(h.name)}</b><small>${esc(h.role)}</small>`);
    portrait(c, key, small ? 56 : 84);
    b.onclick = () => { Ton.init(); Ton.play('click'); onPick(key); };
    el.appendChild(b);
  }
}

function pickHero(key) {
  S.hero = key; store.set('hero', key);
  for (const b of document.querySelectorAll('.hero-card')) b.classList.toggle('sel', b.dataset.hero === key);
  renderHeroInfo();
  send({ t: 'set', hero: key });
}

function renderHeroInfo() {
  const h = S.heroes[S.hero];
  const bars = heroStats(h).map(([n, v, f]) =>
    `<div class="stat">${n}<i style="--w:${Math.round(clamp(f, 0.08, 1) * 100)}%"></i><span>${n === 'Schaden' && h.count ? h.count + '×' + h.dmg : v}</span></div>`).join('');
  $('#heroInfo').innerHTML = `<h3 style="color:${h.color}">${esc(h.name)}</h3><div class="role">${esc(h.role)}</div>${bars}
    <p class="ability"><b>Angriff:</b> ${esc(h.atext)}</p><p class="ability"><b>Super · ${esc(h.sname)}:</b> ${esc(h.stext)}</p>`;
}

function buildMenu() {
  const inName = $('#inName');
  inName.value = S.name;
  inName.onchange = () => { S.name = inName.value.trim().slice(0, 16) || S.name; inName.value = S.name; store.set('name', S.name); send({ t: 'name', name: S.name }); };
  buildHeroGrid($('#heroGrid'), false, pickHero);
  renderHeroInfo();
  const ml = $('#modeList');
  ml.innerHTML = '';
  for (const [key, m] of Object.entries(S.modes)) {
    const b = document.createElement('button');
    b.className = 'mode-btn' + (key === S.mode ? ' sel' : '');
    b.dataset.mode = key;
    b.innerHTML = `<span class="ico">${MODE_ICONS[key] || '🎮'}</span><span><b>${esc(m.name)}</b><small>${esc(m.text)}</small></span>`;
    b.onclick = () => { Ton.init(); Ton.play('click'); S.mode = key; store.set('mode', key); for (const x of ml.children) x.classList.toggle('sel', x.dataset.mode === key); };
    ml.appendChild(b);
  }
  renderInvite($('#invite'), null);
  if (S.screen === 'menu') show('menu');
}

function inviteLinks(code) {
  const q = code ? '/?raum=' + code : '/';
  const out = [];
  if (S.info) {
    if (S.info.internet) out.push(['Übers Internet', S.info.internet + q]);
    for (const u of S.info.lan || []) out.push(['Im gleichen WLAN', u + q]);
  }
  const here = location.origin + q;
  if (!/^(localhost|127\.)/.test(location.hostname) && !out.some(o => o[1] === here)) out.unshift(['Dieser Link', here]);
  return out;
}

function renderInvite(el, code) {
  const links = inviteLinks(code);
  let html = code ? `<b>Freunde einladen – Code <span style="color:${GOLD}">${code}</span>:</b>` : '<b>Freunde holen:</b> Link öffnen, dann „Privater Raum“ oder Code eingeben.';
  for (const [label, url] of links) html += `<div class="link"><small style="min-width:96px">${label}</small><code>${esc(url)}</code><button class="small" data-url="${esc(url)}">Kopieren</button></div>`;
  if (S.info && !S.info.internet && /^(localhost|127\.)/.test(location.hostname))
    html += '<p>Für Freunde außerhalb deines WLANs: Server mit <kbd>--internet</kbd> starten (Doppelklick auf „Tumult Arena starten“ macht das automatisch).</p>';
  el.innerHTML = html;
  for (const b of el.querySelectorAll('button[data-url]')) b.onclick = () => copyText(b.dataset.url);
}

$('#btnQuick').onclick = () => { Ton.init(); Ton.play('click'); goFullscreen(); send({ t: 'quick', mode: S.mode, hero: S.hero }); };
$('#btnCreate').onclick = () => { Ton.init(); Ton.play('click'); send({ t: 'create', mode: S.mode, hero: S.hero }); };
$('#btnJoin').onclick = () => {
  Ton.init();
  const code = $('#inCode').value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) { toast('Der Code hat 4 Buchstaben'); return; }
  send({ t: 'join', code, hero: S.hero });
};
$('#inCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnJoin').click(); });

// ================================================================ Lobby

function renderLobby() {
  const r = S.room;
  if (!r || !S.modes) return;
  const mode = S.modes[r.mode], me = r.members.find(m => m.id === S.id);
  const host = r.host === S.id;
  $('#roomCode').textContent = r.code;
  $('#roomKind').textContent = r.public ? 'Öffentlicher Raum' : 'Privater Raum';
  $('#lobbyMode').textContent = `${MODE_ICONS[r.mode] || ''} ${mode.name} · ${mode.map}`;
  $('#lobbyModeText').textContent = mode.text;
  const sel = $('#selMode');
  sel.hidden = !(host && !r.public);
  if (!sel.hidden) {
    sel.innerHTML = Object.entries(S.modes).map(([k, m]) => `<option value="${k}" ${k === r.mode ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
    sel.onchange = () => send({ t: 'set', mode: sel.value });
  }
  const teams = $('#teams');
  teams.innerHTML = '';
  const member = m => {
    const d = document.createElement('div');
    d.className = 'member' + (m.id === S.id ? ' me' : '');
    const c = document.createElement('canvas');
    d.appendChild(c);
    portrait(c, m.hero, 40);
    const h = S.heroes[m.hero];
    d.insertAdjacentHTML('beforeend', `<div style="min-width:0"><b>${esc(m.name)}${m.id === S.id ? ' (du)' : ''}</b><small>${esc(h ? h.name : '')}</small></div>${m.id === r.host && !r.public ? '<span class="crown" title="Host">👑</span>' : ''}`);
    return d;
  };
  const filler = n => {
    const d = document.createElement('div');
    d.className = 'slot-empty';
    d.textContent = n > 0 ? (r.bots ? `+ ${n} Bot${n > 1 ? 's' : ''} (bis echte Spieler kommen)` : `${n} Platz frei`) : '';
    return d;
  };
  if (mode.teams) {
    teams.className = 'teams';
    const myTeam = me ? me.team : 0, per = r.max / 2;
    for (const [t, label, cls] of [[myTeam, 'Dein Team', ''], [1 - myTeam, 'Gegner', 'enemy']]) {
      const box = document.createElement('div');
      box.className = 'team ' + cls;
      box.innerHTML = `<h3>${label}</h3>`;
      const list = r.members.filter(m => m.team === t);
      list.forEach(m => box.appendChild(member(m)));
      box.appendChild(filler(per - list.length));
      teams.appendChild(box);
    }
  } else {
    teams.className = 'teams ffa';
    const box = document.createElement('div');
    box.className = 'team neutral';
    box.innerHTML = '<h3>Jeder gegen jeden</h3>';
    r.members.forEach(m => box.appendChild(member(m)));
    box.appendChild(filler(r.max - r.members.length));
    teams.appendChild(box);
  }
  $('#btnSwap').hidden = !mode.teams;
  $('#botToggle').hidden = r.public;
  $('#chkBots').checked = r.bots;
  $('#chkBots').disabled = !host;
  $('#btnStart').hidden = !(host && !r.public && r.state === 'lobby');
  buildHeroGrid($('#heroGridLobby'), true, pickHero);
  renderInvite($('#lobbyInvite'), r.code);
  updateLobbyWait();
}

function updateLobbyWait() {
  const r = S.room;
  if (!r) return;
  let t = '';
  if (r.state === 'game') t = 'Partie läuft – du steigst gleich ein …';
  else if (r.public && S.autoAt) t = `Startet in ${Math.max(0, Math.ceil(S.autoAt - performance.now() / 1000))} s – weitere Spieler können noch beitreten`;
  else if (r.host !== S.id) t = 'Warte, bis der Host startet …';
  else t = r.members.length < 2 ? 'Teile den Code mit deinen Freunden – oder starte gleich mit Bots.' : '';
  $('#lobbyWait').textContent = t;
}
setInterval(() => { if (S.screen === 'lobby') updateLobbyWait(); }, 250);

$('#btnLeaveLobby').onclick = () => { send({ t: 'leave' }); S.room = null; show('menu'); };
$('#btnSwap').onclick = () => { Ton.play('click'); send({ t: 'set', team: 'swap' }); };
$('#chkBots').onchange = e => send({ t: 'set', bots: e.target.checked });
$('#btnStart').onclick = () => { Ton.init(); Ton.play('click'); goFullscreen(); send({ t: 'start' }); };
$('#btnShare').onclick = () => {
  if (!S.room) return;
  const links = inviteLinks(S.room.code);
  const url = links.length ? links[0][1] : location.origin + '/?raum=' + S.room.code;
  if (navigator.share) navigator.share({ title: 'Tumult Arena', text: `Komm in meinen Raum ${S.room.code}!`, url }).catch(() => {});
  else copyText(url);
};

// ================================================================ Partie starten / beenden

function setRoster(list) {
  G.roster = new Map(list.map(p => [p.id, p]));
  const me = G.roster.get(G.me);
  G.myTeam = me ? me.team : null;
}

function startGame(m) {
  const old = G;
  G = {
    mode: m.mode, teams: S.modes[m.mode].teams,
    map: { key: m.map.key, name: m.map.name, w: m.map.w, h: m.map.h, t: m.map.rows.map(r => r.split('')) },
    me: m.you, dt: m.dt, R: m.R, total: m.time,
    snaps: [], last: null, evq: [], clockOff: null,
    pred: null, off: { x: 0, y: 0 }, pending: [], seq: 0, acc: 0, wasAlive: false,
    fx: [], feed: [], emo: new Map(), flash: new Map(), crateHit: new Map(), shake: 0,
    moveFace: 0, aimFace: 0, aimT: -9, lastAtk: -9, moving: false,
    ended: false, result: null, lost: false, floor: null, spectate: null,
    banner: null, t0: performance.now() / 1000, lastSuper: 0, hold: null,
  };
  setRoster(m.roster);
  G.theme = Grafik.THEMES[G.map.key] || Grafik.THEMES.schlucht;
  V.flip = G.teams && G.myTeam === 1;
  touch.move = touch.atk = touch.sup = null;
  computeScale();
  show('game');
  $('#emoteBar').hidden = true;
  $('#hudSound').textContent = Ton.on ? '🔊' : '🔇';
  const mode = S.modes[G.mode];
  if (!old || old.mode !== G.mode || old.ended) {
    G.banner = { text: mode.name, sub: G.me == null ? 'Du schaust zu und steigst in der nächsten Runde ein.' : mode.text, until: G.t0 + 3.5 };
  }
  if (S.touch && H > W) { $('#rotateHint').hidden = false; setTimeout(() => { $('#rotateHint').hidden = true; }, 4000); }
}

function endGame(res) {
  G.ended = true;
  G.result = res;
  const mine = res.stats.find(s => s.id === G.me);
  let outcome = 'draw';
  if (res.teams) { if (res.winner !== -1 && G.myTeam != null) outcome = res.winner === G.myTeam ? 'win' : 'lose'; }
  else if (mine) outcome = mine.place === 1 ? 'win' : 'lose';
  G.outcome = outcome;
  setTimeout(() => Ton.play(outcome === 'win' ? 'win' : outcome === 'lose' ? 'lose' : 'ready'), 300);
  G.banner = { text: outcome === 'win' ? 'SIEG!' : outcome === 'lose' ? (res.teams ? 'NIEDERLAGE' : `Platz ${mine ? mine.place : '–'}`) : 'UNENTSCHIEDEN', sub: res.reason, until: performance.now() / 1000 + 2, big: true };
  setTimeout(() => { if (G && G.result === res) showResult(res); }, 1800);
}

function showResult(res) {
  const title = $('#resTitle');
  const mine = res.stats.find(s => s.id === G.me);
  title.className = G.outcome;
  title.textContent = G.outcome === 'win' ? (res.teams ? 'SIEG!' : 'PLATZ 1!') : G.outcome === 'lose' ? (res.teams ? 'NIEDERLAGE' : `PLATZ ${mine ? mine.place : '–'}`) : (G.me == null ? 'PARTIE VORBEI' : 'UNENTSCHIEDEN');
  const sc = res.teams && G.myTeam != null ? ` · ${res.score[G.myTeam]} : ${res.score[1 - G.myTeam]}` : '';
  $('#resReason').textContent = res.reason + sc;
  const cols = G.mode === 'kristall' ? [['K.o.', 'kos'], ['Tode', 'deaths'], ['Schad.', 'dmg'], ['💎', 'crystals']]
    : G.mode === 'letzter' ? [['Platz', 'place'], ['K.o.', 'kos'], ['Schad.', 'dmg'], ['Heil.', 'heal']]
      : [['K.o.', 'kos'], ['Tode', 'deaths'], ['Schad.', 'dmg'], ['Heil.', 'heal']];
  const rows = [...res.stats].sort((a, b) => res.teams
    ? ((a.team !== G.myTeam) - (b.team !== G.myTeam)) || b.points - a.points
    : a.place - b.place);
  const tbl = $('#resTable');
  tbl.innerHTML = `<div class="res-row head"><span></span><span class="nm">Spieler</span>${cols.map(c => `<span>${c[0]}</span>`).join('')}</div>`;
  for (const s of rows) {
    const d = document.createElement('div');
    const rel = s.id === G.me ? 'ally me' : res.teams ? (s.team === G.myTeam ? 'ally' : 'enemy') : 'enemy';
    d.className = 'res-row ' + rel;
    const c = document.createElement('canvas');
    d.appendChild(c);
    portrait(c, s.hero, 32);
    const fmt = (k, v) => k === 'dmg' || k === 'heal' ? (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v) : v;
    d.insertAdjacentHTML('beforeend', `<span class="nm">${s.id === res.star ? '⭐ ' : ''}${esc(s.name)}</span>${cols.map(c => `<span>${fmt(c[1], s[c[1]])}</span>`).join('')}`);
    tbl.appendChild(d);
  }
  show('result');
}

$('#btnAgain').onclick = () => { Ton.play('click'); G = null; if (S.room) { show('lobby'); renderLobby(); } else show('menu'); };
$('#btnMenu').onclick = () => { send({ t: 'leave' }); G = null; S.room = null; show('menu'); };

// ================================================================ Zustände vom Server

function onSnap(m) {
  const now = performance.now() / 1000, st = m.k * G.dt, sample = now - st;
  if (G.clockOff == null || sample < G.clockOff) G.clockOff = sample;
  else G.clockOff += (sample - G.clockOff) * 0.01;
  const snap = { k: m.k, time: st, p: new Map(), b: new Map(), o: m.o || [], z: m.z || [], sc: m.sc, tl: m.tl, st: m.st, al: m.al, hd: m.hd, a: m.a };
  for (const e of m.p) snap.p.set(e[0], e);
  for (const b of m.b) snap.b.set(b[0], b);
  G.snaps.push(snap);
  if (G.snaps.length > 40) G.snaps.shift();
  G.last = snap;
  if (m.e) for (const e of m.e) {
    if (e[0] === 'crate') G.map.t[e[2]][e[1]] = '.';      // sofort, damit die Vorhersage stimmt
    G.evq.push({ time: st, e });
  }
  reconcile(snap);
}

function heroOf(id) { const r = G.roster.get(id); return r ? r.hero : 'funke'; }
function nameOf(id) { const r = G.roster.get(id); return r ? r.name : '?'; }
function teamOf(id) { const r = G.roster.get(id); return r ? r.team : -1; }
function myEntry() { return G.last && G.me != null ? G.last.p.get(G.me) : null; }
function isAlly(id) { return id === G.me || (G.teams && G.myTeam != null && teamOf(id) === G.myTeam); }
function relColor(id) {
  if (id === G.me) return ME;
  if (G.teams && G.myTeam == null) return teamOf(id) === 0 ? ALLY : ENEMY;
  return isAlly(id) ? ALLY : ENEMY;
}

function solidAt(tx, ty) {
  const M = G.map;
  if (tx < 0 || ty < 0 || tx >= M.w || ty >= M.h) return true;
  const c = M.t[ty][tx];
  return c === '#' || c === '~' || c === 'x';
}
/** Gleiche Rechnung wie move() in spiel.py – sonst ruckelt die Vorhersage. */
function move(x, y, dx, dy) {
  const R = G.R, EPS = 1e-6;
  if (dx) {
    let nx = x + dx;
    const y0 = Math.floor(y - R), y1 = Math.floor(y + R - EPS);
    if (dx > 0) { const tx = Math.floor(nx + R); for (let ty = y0; ty <= y1; ty++) if (solidAt(tx, ty)) { nx = tx - R - EPS; break; } }
    else { const tx = Math.floor(nx - R); for (let ty = y0; ty <= y1; ty++) if (solidAt(tx, ty)) { nx = tx + 1 + R + EPS; break; } }
    x = nx;
  }
  if (dy) {
    let ny = y + dy;
    const x0 = Math.floor(x - R), x1 = Math.floor(x + R - EPS);
    if (dy > 0) { const ty = Math.floor(ny + R); for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, ty)) { ny = ty - R - EPS; break; } }
    else { const ty = Math.floor(ny - R); for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, ty)) { ny = ty + 1 + R + EPS; break; } }
    y = ny;
  }
  return [x, y];
}

function reconcile(snap) {
  const e = snap.p.get(G.me);
  if (!e) return;
  G.pending = G.pending.filter(p => p.s > snap.a);
  const alive = e[6] & 1, forced = e[6] & 8;
  let x = e[1], y = e[2];
  if (alive && !forced) {
    const spd = S.heroes[heroOf(G.me)].speed;
    for (const p of G.pending) if (p.x || p.y) [x, y] = move(x, y, p.x * spd * G.dt, p.y * spd * G.dt);
  }
  if (!G.pred || !alive || !G.wasAlive) { G.pred = { x, y }; G.off.x = G.off.y = 0; }
  else {
    const dx = x - G.pred.x, dy = y - G.pred.y;
    if (dx * dx + dy * dy > 4) G.off.x = G.off.y = 0;
    else { G.off.x -= dx; G.off.y -= dy; }
    G.pred.x = x; G.pred.y = y;
  }
  G.wasAlive = !!alive;
}

function clientTick() {
  const mv = readMove();
  G.seq++;
  send({ t: 'i', s: G.seq, m: [mv.x, mv.y] });
  G.pending.push({ s: G.seq, x: mv.x, y: mv.y });
  if (G.pending.length > 120) G.pending.shift();
  const e = myEntry();
  G.moving = !!(mv.x || mv.y);
  if (G.pred && e && (e[6] & 1) && !(e[6] & 8) && G.moving) {
    const spd = S.heroes[heroOf(G.me)].speed;
    [G.pred.x, G.pred.y] = move(G.pred.x, G.pred.y, mv.x * spd * G.dt, mv.y * spd * G.dt);
    G.moveFace = Math.atan2(mv.y, mv.x);
  }
}

// ================================================================ Eingabe

const keys = new Set();
const mouse = { x: 0, y: 0, in: false, down: false, sup: false };
const touch = { move: null, atk: null, sup: null };

function stickR() { return clamp(Math.min(W, H) * 0.14, 44, 80); }
function layout() {
  const k = clamp(Math.min(W, H) / 400, 0.85, 1.35);
  const pad = 26 * k;
  const atk = { r: 44 * k }; atk.x = W - pad - atk.r - 10; atk.y = H - pad - atk.r - 4;
  const sup = { r: 33 * k }; sup.x = atk.x - atk.r - sup.r - 26 * k; sup.y = atk.y + atk.r - sup.r + 6 * k;
  return { atk, sup, k };
}

function readMove() {
  let x = 0, y = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
  if (touch.move) {
    const R = stickR(), dx = touch.move.x - touch.move.ox, dy = touch.move.y - touch.move.oy, d = Math.hypot(dx, dy);
    if (d > R * 0.15) { const f = Math.min(1, d / R) / d; x = dx * f; y = dy * f; }
  }
  const d = Math.hypot(x, y);
  if (d > 1) { x /= d; y /= d; }
  if (V.flip) { x = -x; y = -y; }
  return { x: Math.trunc(x * 1000) / 1000, y: Math.trunc(y * 1000) / 1000 };
}

function myPos() {
  if (!G.pred) return null;
  return { x: G.pred.x + G.off.x, y: G.pred.y + G.off.y };
}

function fire(kind, ax, ay, d) {
  const e = myEntry();
  if (!e || !(e[6] & 1) || G.ended) return;
  const h = S.heroes[heroOf(G.me)], now = performance.now() / 1000;
  if (kind === 'atk') {
    if (now - G.lastAtk < h.cd * 0.9) return;
    if (e[7] < 10) { if (now - (G.lastEmpty || 0) > 0.5) { G.lastEmpty = now; Ton.play('empty', 0.6); } return; }
    G.lastAtk = now;
    Ton.play(h.attack, 0.9);
  } else {
    if (e[8] < 100 || now - G.lastSuper < 0.5) return;
    G.lastSuper = now;
    Ton.play(h.sup, 1);
  }
  if (!ax && !ay) { ax = Math.cos(G.moveFace); ay = Math.sin(G.moveFace); }
  G.aimFace = Math.atan2(ay, ax); G.aimT = now;
  send({ t: 'a', k: kind, x: r3(ax), y: r3(ay), d: Math.round(d * 100) / 100 });
}

function autoFire(kind) {
  const p = myPos();
  if (!p) return;
  const h = S.heroes[heroOf(G.me)];
  const range = kind === 'sup' ? h.srange : h.range;
  if (kind === 'sup' && h.sup === 'heal') {
    let best = null, bf = 0.999;
    for (const o of G.view || []) {
      if (!isAlly(o.id) || Math.hypot(o.x - p.x, o.y - p.y) > range) continue;
      const f = o.hp / o.max; if (f < bf) { bf = f; best = o; }
    }
    if (best && best.id !== G.me) fire(kind, best.x - p.x, best.y - p.y, Math.hypot(best.x - p.x, best.y - p.y));
    else fire(kind, Math.cos(G.moveFace), Math.sin(G.moveFace), 1.2);
    return;
  }
  let best = null, bd = range + 1.2;
  for (const o of G.view || []) {
    if (isAlly(o.id) || !o.alive) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < bd) { bd = d; best = o; }
  }
  if (best) fire(kind, best.x - p.x, best.y - p.y, bd);
  else fire(kind, Math.cos(G.moveFace), Math.sin(G.moveFace), range * 0.75);
}

function aimFromScreen(dx, dy, len, R, kind) {
  const h = S.heroes[heroOf(G.me)];
  const range = kind === 'sup' ? h.srange : h.range;
  const [wx, wy] = V.flip ? [-dx, -dy] : [dx, dy];
  fire(kind, wx, wy, Math.min(1, len / R) * range);
}

function release(kind, st) {
  const dx = st.x - st.ox, dy = st.y - st.oy, len = Math.hypot(dx, dy), R = stickR();
  if (!st.moved) { if (performance.now() / 1000 - st.t0 < 0.4) autoFire(kind); return; }
  if (len < R * 0.22) return;            // zurück in die Mitte gezogen = abbrechen
  aimFromScreen(dx, dy, len, R, kind);
}

cv.addEventListener('touchstart', e => {
  e.preventDefault();
  Ton.init();
  S.touch = true;
  if (!G || G.me == null) return;
  const L = layout(), now = performance.now() / 1000;
  for (const t of e.changedTouches) {
    const x = t.clientX, y = t.clientY;
    if (!touch.sup && Math.hypot(x - L.sup.x, y - L.sup.y) < L.sup.r * 1.5) touch.sup = { id: t.identifier, ox: x, oy: y, x, y, t0: now, moved: false };
    else if (x < W * 0.45 && !touch.move) touch.move = { id: t.identifier, ox: x, oy: y, x, y };
    else if (!touch.atk && x >= W * 0.45) touch.atk = { id: t.identifier, ox: x, oy: y, x, y, t0: now, moved: false };
  }
}, { passive: false });
cv.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) for (const st of [touch.move, touch.atk, touch.sup]) {
    if (st && st.id === t.identifier) {
      st.x = t.clientX; st.y = t.clientY;
      if (Math.hypot(st.x - st.ox, st.y - st.oy) > 14) st.moved = true;
    }
  }
}, { passive: false });
function touchEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (touch.move && touch.move.id === t.identifier) touch.move = null;
    if (touch.atk && touch.atk.id === t.identifier) { if (e.type === 'touchend') release('atk', touch.atk); touch.atk = null; }
    if (touch.sup && touch.sup.id === t.identifier) { if (e.type === 'touchend') release('sup', touch.sup); touch.sup = null; }
  }
}
cv.addEventListener('touchend', touchEnd, { passive: false });
cv.addEventListener('touchcancel', touchEnd, { passive: false });

cv.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.in = true; if (e.movementX || e.movementY) S.touch = false; });
cv.addEventListener('mouseleave', () => { mouse.in = false; mouse.down = false; });
cv.addEventListener('mousedown', e => {
  Ton.init();
  if (!G) return;
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (e.button === 0) { mouse.down = true; fireAtMouse('atk'); }
  if (e.button === 2) mouse.sup = true;
});
window.addEventListener('mouseup', e => {
  if (e.button === 0) mouse.down = false;
  if (e.button === 2 && mouse.sup) { mouse.sup = false; if (G) fireAtMouse('sup'); }
});
cv.addEventListener('contextmenu', e => e.preventDefault());

function fireAtMouse(kind) {
  const p = myPos();
  if (!p || G.me == null) return;
  const sx = toScreenX(p.x, p.y), sy = toScreenY(p.x, p.y);
  const dx = mouse.x - sx, dy = mouse.y - sy;
  const [wx, wy] = V.flip ? [-dx, -dy] : [dx, dy];
  fire(kind, wx, wy, Math.hypot(dx, dy) / V.s);
}

window.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (!G || S.screen !== 'game') return;
  Ton.init();
  if (e.code === 'Tab') { e.preventDefault(); G.board = true; return; }
  if (e.repeat) { keys.add(e.code); return; }
  keys.add(e.code);
  if (e.code === 'Space' || e.code === 'KeyE') { e.preventDefault(); if (mouse.in) fireAtMouse('sup'); else autoFire('sup'); }
  if (e.code === 'KeyF') autoFire('atk');
  if (e.code === 'KeyM') toggleSound();
  const n = '123456'.indexOf(e.key);
  if (n >= 0) emote(n);
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'Tab' && G) G.board = false; });
window.addEventListener('blur', () => { keys.clear(); mouse.down = false; mouse.sup = false; touch.move = touch.atk = touch.sup = null; });

function emote(n) { send({ t: 'emo', n }); $('#emoteBar').hidden = true; }
function toggleSound() { const on = Ton.toggle(); $('#hudSound').textContent = on ? '🔊' : '🔇'; toast(on ? 'Ton an' : 'Ton aus', 1200); }
$('#hudSound').onclick = () => { Ton.init(); toggleSound(); };
$('#hudEmote').onclick = () => { $('#emoteBar').hidden = !$('#emoteBar').hidden; };
for (const b of document.querySelectorAll('#emoteBar button')) b.onclick = () => emote(+b.dataset.n);
$('#hudLeave').onclick = () => {
  const now = performance.now();
  if (now - ($('#hudLeave').armed || 0) < 2500) { send({ t: 'leave' }); G = null; S.room = null; show('menu'); return; }
  $('#hudLeave').armed = now;
  toast('Nochmal tippen zum Verlassen', 2400);
};

// ================================================================ Ansicht

function computeScale() {
  V.s = Math.max(20, W > H ? Math.min(H / 10.5, W / 18) : W / 11.5);
  if (G) G.floor = null;
}
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  computeScale();
}
window.addEventListener('resize', resize);
resize();

// Welt → Bildschirm (die rote Seite sieht die Karte um 180° gedreht: eigene Basis immer links)
function vx(x) { return V.flip ? G.map.w - x : x; }
function vy(y) { return V.flip ? G.map.h - y : y; }
function toScreenX(x) { return (vx(x) - V.cx) * V.s + W / 2; }
function toScreenY(x, y) { return (vy(y) - V.cy) * V.s + H / 2; }
function viewAng(a) { return V.flip ? a + Math.PI : a; }
function tileV(tx, ty) {           // Kachel in Ansichts-Koordinaten
  const M = G.map;
  const x = V.flip ? M.w - 1 - tx : tx, y = V.flip ? M.h - 1 - ty : ty;
  if (x < 0 || y < 0 || x >= M.w || y >= M.h) return '#';
  return M.t[y][x];
}

function buildFloor() {
  const M = G.map, th = G.theme;
  const ts = Math.max(8, Math.min(72, Math.round(V.s * DPR), Math.floor(2600 / Math.max(M.w, M.h))));
  const c = document.createElement('canvas');
  c.width = M.w * ts; c.height = M.h * ts;
  const g = c.getContext('2d');
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  for (let y = 0; y < M.h; y++) for (let x = 0; x < M.w; x++) {
    const ch = tileV(x, y);
    const X = x * ts, Y = y * ts;
    if (ch === '~') {
      g.fillStyle = th.water; g.fillRect(X, Y, ts + 1, ts + 1);
      g.fillStyle = th.waterDeep;
      if (tileV(x, y - 1) !== '~') g.fillRect(X, Y, ts, ts * 0.2);
      g.fillStyle = 'rgba(255,255,255,.4)';
      if (tileV(x, y - 1) !== '~') g.fillRect(X, Y, ts, ts * 0.06);
      if (tileV(x - 1, y) !== '~') g.fillRect(X, Y, ts * 0.06, ts);
      if (tileV(x + 1, y) !== '~') g.fillRect(X + ts * 0.94, Y, ts * 0.06, ts);
      if (tileV(x, y + 1) !== '~') g.fillRect(X, Y + ts * 0.94, ts, ts * 0.06);
      continue;
    }
    g.fillStyle = (x + y) % 2 ? th.floorA : th.floorB;
    g.fillRect(X, Y, ts, ts);
    g.fillStyle = th.speck;
    for (let i = 0; i < 3; i++) {
      const a = hash(x * 3 + i, y), b = hash(y * 5 + i, x + 7);
      g.beginPath(); g.arc(X + a * ts, Y + b * ts, ts * (0.03 + 0.04 * hash(x + i, y + i)), 0, TAU); g.fill();
    }
  }
  // Startbereiche der Teams leicht einfärben
  if (G.teams) {
    for (const team of [0, 1]) {
      const ally = G.myTeam == null ? team === 0 : team === G.myTeam;
      const col = ally ? '62,160,255' : '255,77,94';
      const side = (team === 0) !== V.flip ? 0.25 : M.w - 3.25;
      g.fillStyle = `rgba(${col},.18)`; g.strokeStyle = `rgba(${col},.55)`; g.lineWidth = ts * 0.06;
      g.setLineDash([ts * 0.25, ts * 0.15]);
      g.beginPath(); g.roundRect(side * ts, (M.h / 2 - 2.5) * ts, 3 * ts, 5 * ts, ts * 0.5); g.fill(); g.stroke();
      g.setLineDash([]);
    }
  }
  if (G.map.key === 'grube') {      // Kristallmine in der Mitte
    const cx = M.w / 2 * ts, cy = M.h / 2 * ts;
    const gr = g.createRadialGradient(cx, cy, ts * 0.1, cx, cy, ts * 1.4);
    gr.addColorStop(0, '#2a0f45'); gr.addColorStop(0.6, '#4a2a77'); gr.addColorStop(1, 'rgba(74,42,119,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, ts * 1.4, 0, TAU); g.fill();
    g.strokeStyle = '#c86bff'; g.lineWidth = ts * 0.08; g.beginPath(); g.arc(cx, cy, ts * 0.75, 0, TAU); g.stroke();
  }
  G.floor = { c, ts };
}

// ================================================================ Effekte

function addFx(o) { if (G.fx.length < 500) G.fx.push(o); }
function burst(x, y, color, n, speed = 4, size = 0.08, life = 0.5, grav = 0) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, v = speed * (0.3 + Math.random() * 0.7);
    addFx({ k: 'p', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (0.6 + Math.random() * 0.6), max: life, color, size: size * (0.6 + Math.random() * 0.8), grav });
  }
}
function ring(x, y, r0, r1, color, life = 0.4, w = 0.12) { addFx({ k: 'r', x, y, r0, r1, color, life, max: life, w }); }
function floatText(x, y, text, color, size = 0.42) { addFx({ k: 't', x, y, text, color, life: 0.9, max: 0.9, size }); }

function soundAt(name, x, y, base = 1) {
  const p = myPos() || { x: V.cx, y: V.cy };
  const d = Math.hypot(x - p.x, y - p.y);
  Ton.play(name, base * clamp(1.1 - d / 16, 0, 1));
}

function handleEvent(e, fresh) {
  const kind = e[0];
  if (kind === 'crate') { if (fresh) { burst(e[1] + 0.5, e[2] + 0.5, '#b07a45', 14, 4, 0.1, 0.7, 6); soundAt('crate', e[1], e[2]); } return; }
  if (!fresh) return;
  switch (kind) {
    case 'shot': {
      const [, id, art, x, y] = e;
      if (id !== G.me) soundAt(art, x, y, 0.8);
      if (art === 'charge') ring(x, y, 0.3, 1.2, 'rgba(200,200,220,.8)', 0.3);
      if (art === 'leap') ring(x, y, 0.2, 1, 'rgba(176,124,255,.8)', 0.3);
      break;
    }
    case 'hit': {
      const [, id, x, y, amount, src] = e;
      const col = id === G.me ? '#ff5a5a' : src === G.me ? GOLD : '#ffffff';
      floatText(x + (Math.random() - 0.5) * 0.3, y - 0.6, String(amount), col, id === G.me || src === G.me ? 0.46 : 0.36);
      G.flash.set(id, performance.now() / 1000);
      burst(x, y, Grafik.HERO_COLORS[heroOf(id)] || '#fff', 4, 3, 0.07, 0.35);
      if (id === G.me) { Ton.play('hurt', 0.8); G.shake = Math.max(G.shake, 6); }
      else if (src === G.me) Ton.play('hit', 0.7);
      break;
    }
    case 'heal': floatText(e[2], e[3] - 0.7, '+' + e[4], '#7dff9b', 0.34); burst(e[2], e[3], '#7dff9b', 3, 1.5, 0.07, 0.6, -2); break;
    case 'ko': {
      const [, killer, victim, x, y] = e;
      burst(x, y, Grafik.HERO_COLORS[heroOf(victim)] || '#fff', 26, 6, 0.12, 0.8);
      burst(x, y, '#ffffff', 10, 3, 0.15, 0.6);
      ring(x, y, 0.2, 1.6, 'rgba(255,255,255,.9)', 0.45, 0.15);
      soundAt('ko', x, y, killer === G.me || victim === G.me ? 1 : 0.7);
      G.feed.unshift({ killer, victim, t: performance.now() / 1000 });
      G.feed.length = Math.min(G.feed.length, 5);
      if (victim === G.me) {
        G.banner = { text: 'Ausgeschaltet!', sub: killer ? `von ${nameOf(killer)}` : 'vom Giftnebel', until: performance.now() / 1000 + 2.2 };
        if (!G.teams) G.spectate = killer || null;
        G.shake = 10;
      } else if (killer === G.me) {
        G.banner = { text: 'K.o.!', sub: nameOf(victim), until: performance.now() / 1000 + 1.2, small: true };
      }
      break;
    }
    case 'spawn': {
      const r = G.last && G.last.p.get(e[1]);
      if (r) { ring(r[1], r[2], 0.2, 1.1, 'rgba(255,255,255,.8)', 0.5); burst(r[1], r[2], '#ffffff', 8, 2, 0.08, 0.5, -3); }
      if (e[1] === G.me) Ton.play('spawn', 0.8);
      break;
    }
    case 'ready': if (e[1] === G.me) { Ton.play('ready', 0.9); toast('⭐ Super bereit!', 1300); } break;
    case 'puff': burst(e[1], e[2], 'rgba(230,220,200,.9)', 4, 2, 0.06, 0.3); break;
    case 'box': { G.crateHit.set(e[1] + ',' + e[2], performance.now() / 1000); burst(e[1] + 0.5, e[2] + 0.5, '#c8925a', 3, 2.5, 0.07, 0.4, 5); break; }
    case 'boom': {
      const [, x, y, r] = e;
      addFx({ k: 'b', x, y, r, life: 0.45, max: 0.45 });
      burst(x, y, '#ffb347', 18, r * 5, 0.13, 0.6);
      burst(x, y, 'rgba(90,80,80,.8)', 10, r * 2.5, 0.2, 0.9, -1);
      soundAt('boom', x, y);
      const p = myPos(); if (p && Math.hypot(p.x - x, p.y - y) < 7) G.shake = Math.max(G.shake, r > 2 ? 12 : 6);
      break;
    }
    case 'slash': {
      const [, x, y, ang] = e;
      addFx({ k: 's', x, y, ang, life: 0.22, max: 0.22 });
      break;
    }
    case 'land': ring(e[1], e[2], 0.3, e[3] + 0.3, 'rgba(176,124,255,.95)', 0.4, 0.2); burst(e[1], e[2], '#b07cff', 16, 6, 0.1, 0.5); soundAt('land', e[1], e[2]); G.shake = Math.max(G.shake, 5); break;
    case 'zone': soundAt('heal', e[1], e[2]); ring(e[1], e[2], 0.3, 2.2, 'rgba(125,255,155,.9)', 0.5); break;
    case 'pick': {
      if (e[1] === G.me) Ton.play(e[2] === 'k' ? 'crystal' : 'pick', 0.9);
      const r = G.last && G.last.p.get(e[1]);
      if (r) burst(r[1], r[2] - 0.3, e[2] === 'k' ? '#d58bff' : '#39ffb6', 8, 2, 0.07, 0.5, -3);
      break;
    }
    case 'emo': G.emo.set(e[1], { n: e[2], until: performance.now() / 1000 + 2.6 }); soundAt('emote', 0, 0, 0.5); break;
    case 'mine': if (G.map.key === 'grube') burst(G.map.w / 2, G.map.h / 2, '#d58bff', 10, 3, 0.08, 0.6, -2); break;
    case 'hold': {
      const t = e[1];
      if (t === -1) G.banner = { text: 'Countdown gestoppt!', until: performance.now() / 1000 + 1.6, small: true };
      else G.banner = { text: t === G.myTeam ? 'Haltet die Kristalle!' : 'Gegner haben 10 Kristalle!', sub: 'Noch 15 Sekunden', until: performance.now() / 1000 + 2, small: true };
      Ton.play('tick', 1);
      break;
    }
  }
}

// ================================================================ Zeichnen

function txt(s, x, y, size, color = '#fff', align = 'center', stroke = 'rgba(10,6,30,.92)') {
  ctx.font = `800 ${Math.round(size)}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, size * 0.2); ctx.strokeStyle = stroke;
  ctx.strokeText(s, x, y); ctx.fillStyle = color; ctx.fillText(s, x, y);
}
function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function sampleAt(rt) {
  const s = G.snaps;
  if (!s.length) return null;
  if (rt <= s[0].time) return { a: s[0], b: s[0], f: 0 };
  const last = s[s.length - 1];
  if (rt >= last.time) return { a: last, b: last, f: 0 };
  for (let i = s.length - 1; i > 0; i--) if (s[i - 1].time <= rt) return { a: s[i - 1], b: s[i], f: (rt - s[i - 1].time) / (s[i].time - s[i - 1].time) };
  return { a: last, b: last, f: 0 };
}

function snapAfter(snap) { const i = G.snaps.indexOf(snap); return i >= 0 ? G.snaps[i + 1] : null; }

function render(dt) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (!G) { ctx.fillStyle = '#1b1440'; ctx.fillRect(0, 0, W, H); return; }
  const now = performance.now() / 1000, th = G.theme, s = V.s;
  const rt = G.clockOff == null ? 0 : now - G.clockOff - INTERP;
  while (G.evq.length && G.evq[0].time <= rt) { const ev = G.evq.shift(); handleEvent(ev.e, rt - ev.time < 0.6); }
  const smp = sampleAt(rt);
  ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, H);
  if (!smp) { txt('Lade Arena …', W / 2, H / 2, 24); return; }

  // ---- Figuren interpolieren
  const view = [];
  for (const [id, b] of smp.b.p) {
    const a = smp.a.p.get(id) || b;
    let x = lerp(a[1], b[1], smp.f), y = lerp(a[2], b[2], smp.f);
    let face = lerpAng(a[5] * Math.PI / 180, b[5] * Math.PI / 180, smp.f);
    const L = G.last.p.get(id) || b;
    const me = id === G.me;
    let moving = Math.hypot(b[1] - a[1], b[2] - a[2]) > 0.01;
    if (me && G.pred && (L[6] & 1)) {
      ({ x, y } = myPos());
      moving = G.moving && !(L[6] & 8);
      face = now - G.aimT < 0.45 ? G.aimFace : moving ? G.moveFace : face;
    }
    const src = me ? L : b;
    view.push({ id, x, y, face, moving, hp: src[3], max: src[4], flags: src[6], ammo: src[7], sup: src[8], crystals: src[9], cells: src[10], z: b[11], respawn: src[12], alive: !!(src[6] & 1) });
  }
  G.view = view;
  const me = view.find(o => o.id === G.me);

  // ---- Kamera
  let focus = me && me.alive ? me : null;
  if (!focus) {
    if (G.spectate != null) focus = view.find(o => o.id === G.spectate && o.alive);
    if (!focus && !(G.teams && G.me != null)) focus = view.find(o => o.alive);
    if (focus) G.spectate = focus.id;
  }
  const M = G.map;
  if (focus) {
    const tx = vx(focus.x), ty = vy(focus.y);
    const halfW = W / 2 / s, halfH = H / 2 / s;
    const cx = M.w <= halfW * 2 - 1 ? M.w / 2 : clamp(tx, halfW - 0.8, M.w - halfW + 0.8);
    const cy = M.h <= halfH * 2 - 1 ? M.h / 2 : clamp(ty, halfH - 0.8, M.h - halfH + 0.8);
    if (G.camInit) { V.cx = lerp(V.cx, cx, 1 - Math.exp(-dt * 12)); V.cy = lerp(V.cy, cy, 1 - Math.exp(-dt * 12)); }
    else { V.cx = cx; V.cy = cy; G.camInit = true; }
  } else if (!G.camInit) { V.cx = M.w / 2; V.cy = M.h / 2; }
  G.off.x *= Math.exp(-dt * 10); G.off.y *= Math.exp(-dt * 10);

  ctx.save();
  if (G.shake > 0.3) { ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake); G.shake *= Math.exp(-dt * 12); }
  const ox = W / 2 - V.cx * s, oy = H / 2 - V.cy * s;      // Bildschirm = ox + Ansicht * s
  if (!G.floor) buildFloor();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(G.floor.c, ox, oy, M.w * s, M.h * s);

  const vx0 = Math.max(0, Math.floor(-ox / s) - 1), vx1 = Math.min(M.w - 1, Math.ceil((W - ox) / s) + 1);
  const vy0 = Math.max(0, Math.floor(-oy / s) - 1), vy1 = Math.min(M.h - 1, Math.ceil((H - oy) / s) + 2);

  // Wasser glitzert
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.beginPath();
  for (let y = vy0; y <= vy1; y++) for (let x = vx0; x <= vx1; x++) {
    if (tileV(x, y) !== '~') continue;
    const ph = now * 1.6 + x * 0.9 + y * 1.7, X = ox + x * s, Y = oy + y * s + s * (0.45 + Math.sin(ph) * 0.1);
    ctx.moveTo(X + s * 0.2, Y); ctx.quadraticCurveTo(X + s * 0.35, Y - s * 0.08, X + s * 0.5, Y); ctx.quadraticCurveTo(X + s * 0.65, Y + s * 0.08, X + s * 0.8, Y);
  }
  ctx.stroke();

  const SX = x => ox + vx(x) * s, SY = y => oy + vy(y) * s;

  // Heilgärten
  for (const z of smp.b.z) {
    const X = SX(z[0]), Y = SY(z[1]), R = z[2] * s, ally = G.myTeam != null ? z[3] === G.myTeam : true;
    const col = ally ? '125,255,155' : '255,120,120';
    ctx.fillStyle = `rgba(${col},.16)`; ctx.beginPath(); ctx.arc(X, Y, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(${col},.75)`; ctx.lineWidth = Math.max(2, s * 0.06);
    ctx.setLineDash([s * 0.25, s * 0.18]); ctx.lineDashOffset = -now * s; ctx.beginPath(); ctx.arc(X, Y, R, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    for (let i = 0; i < 5; i++) { const a = now * 0.8 + i * 1.26, rr = R * (0.3 + 0.5 * ((i * 0.37 + now * 0.2) % 1)); Grafik.circ(ctx, X + Math.cos(a) * rr, Y + Math.sin(a) * rr, s * 0.05); }
  }

  // Zielhilfe auf dem Boden
  if (me && me.alive && !G.ended) drawAim(me, SX(me.x), SY(me.y));

  // Gegenstände
  for (const it of smp.b.o) {
    const X = SX(it[2]), Y = SY(it[3]);
    if (X < -s || X > W + s || Y < -s || Y > H + s) continue;
    if (it[1] === 'k') Grafik.crystal(ctx, X, Y, s, now); else Grafik.cell(ctx, X, Y, s, now);
  }

  // ---- Wände, Kisten und Figuren nach Tiefe sortiert
  const objs = [];
  for (let y = vy0; y <= vy1; y++) for (let x = vx0; x <= vx1; x++) {
    const ch = tileV(x, y);
    if (ch === '#' || ch === 'x') objs.push({ k: ch, x, y, key: oy + (y + 1) * s });
  }
  const pr = s * 0.38;
  for (const o of view) {
    if (!o.alive) continue;
    o.sx = SX(o.x); o.sy = SY(o.y);
    objs.push({ k: 'p', o, key: o.sy + s * 0.32 });
  }
  objs.sort((a, b) => a.key - b.key);
  const wallH = s * 0.4, crateH = s * 0.32;
  for (const ob of objs) {
    if (ob.k === '#') {
      const X = ox + ob.x * s, Y = oy + ob.y * s;
      const below = tileV(ob.x, ob.y + 1) === '#';
      if (!below) { ctx.fillStyle = th.wallFront; ctx.fillRect(X, Y + s - wallH, s + 0.5, wallH); ctx.fillStyle = 'rgba(0,0,0,.15)'; ctx.fillRect(X, Y + s - wallH * 0.35, s + 0.5, wallH * 0.35); }
      ctx.fillStyle = th.wallTop; ctx.fillRect(X, Y - wallH, s + 0.5, s + 0.5);
      if (tileV(ob.x, ob.y - 1) !== '#' && tileV(ob.x - 1, ob.y) !== '#') { ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(X + s * 0.12, Y - wallH + s * 0.12, s * 0.4, s * 0.1); }
      ctx.strokeStyle = th.wallLine; ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.beginPath();
      if (tileV(ob.x, ob.y - 1) !== '#') { ctx.moveTo(X, Y - wallH); ctx.lineTo(X + s, Y - wallH); }
      if (tileV(ob.x - 1, ob.y) !== '#') { ctx.moveTo(X, Y - wallH); ctx.lineTo(X, Y + s); }
      if (tileV(ob.x + 1, ob.y) !== '#') { ctx.moveTo(X + s, Y - wallH); ctx.lineTo(X + s, Y + s); }
      if (!below) { ctx.moveTo(X, Y + s); ctx.lineTo(X + s, Y + s); }
      ctx.stroke();
    } else if (ob.k === 'x') {
      const wx = V.flip ? M.w - 1 - ob.x : ob.x, wy = V.flip ? M.h - 1 - ob.y : ob.y;
      const hit = G.crateHit.get(wx + ',' + wy), wob = hit && now - hit < 0.2 ? Math.sin((now - hit) * 60) * s * 0.03 : 0;
      const X = ox + ob.x * s + s * 0.06 + wob, Y = oy + ob.y * s + s * 0.04;
      const w = s * 0.88;
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(X + s * 0.04, Y + w - crateH * 0.2, w, crateH * 0.4);
      ctx.fillStyle = '#7a4b25'; ctx.fillRect(X, Y + w - crateH, w, crateH);
      ctx.fillStyle = '#c8925a'; ctx.fillRect(X, Y - crateH, w, w);
      ctx.strokeStyle = '#6b3f1d'; ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.strokeRect(X, Y - crateH, w, w);
      ctx.beginPath(); ctx.moveTo(X, Y - crateH); ctx.lineTo(X + w, Y - crateH + w); ctx.moveTo(X + w, Y - crateH); ctx.lineTo(X, Y - crateH + w); ctx.stroke();
      ctx.strokeRect(X, Y + w - crateH, w, crateH);
    } else {
      const o = ob.o;
      const fl = G.flash.get(o.id), flash = fl ? Math.max(0, 1 - (now - fl) / 0.12) : 0;
      const ringCol = relColor(o.id);
      Grafik.hero(ctx, heroOf(o.id), o.sx, o.sy, pr, viewAng(o.face), {
        t: now + o.id * 0.37, moving: o.moving, flash, ring: ringCol, ringW: o.id === G.me ? Math.max(2.5, s * 0.07) : Math.max(2, s * 0.05),
        alpha: (o.flags & 2) && (o.id === G.me || isAlly(o.id)) ? 0.75 : 1, lift: (o.z || 0) / 100 * s * 1.3,
        glow: o.sup >= 100 && (o.id === G.me || isAlly(o.id)),
      });
      if (o.flags & 4) { ctx.strokeStyle = `rgba(160,220,255,${0.5 + 0.3 * Math.sin(now * 10)})`; ctx.lineWidth = Math.max(2, s * 0.05); ctx.beginPath(); ctx.arc(o.sx, o.sy, pr * 1.35, 0, TAU); ctx.stroke(); }
    }
  }

  // ---- Büsche (über allem; nahe sichtbarer Figuren durchsichtig)
  const clear = view.filter(o => o.alive && (o.flags & 2)).map(o => [vx(o.x), vy(o.y)]);
  for (let y = vy0; y <= vy1; y++) for (let x = vx0; x <= vx1; x++) {
    if (tileV(x, y) !== '"') continue;
    const cx = x + 0.5, cy = y + 0.5;
    const near = clear.some(([px, py]) => (px - cx) ** 2 + (py - cy) ** 2 < 2.4);
    ctx.globalAlpha = near ? 0.42 : 1;
    const X = ox + x * s, Y = oy + y * s, sw = Math.sin(now * 1.5 + x * 0.7 + y * 1.3) * s * 0.025;
    ctx.fillStyle = th.bushLine;
    for (const [bx, by, br] of [[0.25, 0.2, 0.36], [0.75, 0.22, 0.36], [0.5, 0.55, 0.42], [0.22, 0.72, 0.34], [0.78, 0.74, 0.34]]) Grafik.circ(ctx, X + bx * s + sw, Y + by * s - s * 0.15, br * s + s * 0.04);
    ctx.fillStyle = th.bushB;
    for (const [bx, by, br] of [[0.25, 0.2, 0.36], [0.75, 0.22, 0.36], [0.5, 0.55, 0.42], [0.22, 0.72, 0.34], [0.78, 0.74, 0.34]]) Grafik.circ(ctx, X + bx * s + sw, Y + by * s - s * 0.15, br * s);
    ctx.fillStyle = th.bushA;
    for (const [bx, by, br] of [[0.3, 0.12, 0.22], [0.7, 0.15, 0.22], [0.5, 0.45, 0.26], [0.28, 0.62, 0.2]]) Grafik.circ(ctx, X + bx * s + sw * 1.4, Y + by * s - s * 0.18, br * s);
  }
  ctx.globalAlpha = 1;
  for (const o of view) {
    if (!o.alive || !(o.flags & 2)) continue;
    Grafik.hero(ctx, heroOf(o.id), o.sx, o.sy, pr, viewAng(o.face), { t: now + o.id * 0.37, moving: o.moving, alpha: 0.55, ring: relColor(o.id) });
  }

  // ---- Geschosse
  for (const [id, b] of smp.b.b) {
    const a = smp.a.b.get(id);
    const x = a ? lerp(a[2], b[2], smp.f) : b[2], y = a ? lerp(a[3], b[3], smp.f) : b[3];
    const lift = b.length > 4 ? (a && a.length > 4 ? lerp(a[4], b[4], smp.f) : b[4]) : 0;
    let ang = 0;
    if (a) ang = Math.atan2(vy(b[3]) - vy(a[3]), vx(b[2]) - vx(a[2]));
    else { const n = snapAfter(smp.b), c = n && n.b.get(id); if (c) ang = Math.atan2(vy(c[3]) - vy(b[3]), vx(c[2]) - vx(b[2])); }
    const X = SX(x), Y = SY(y);
    if (X < -s * 2 || X > W + s * 2 || Y < -s * 2 || Y > H + s * 2) continue;
    Grafik.shot(ctx, b[1], X, Y, s, ang, now, lift);
  }

  // ---- Effekte
  drawFx(dt, SX, SY, s);

  // ---- Giftnebel
  if (smp.b.st != null && G.mode === 'letzter') {
    const r = lerp(smp.a.st ?? smp.b.st, smp.b.st, smp.f) * s;
    const X = SX(M.w / 2), Y = SY(M.h / 2);
    ctx.fillStyle = 'rgba(80,200,90,.30)';
    ctx.beginPath(); ctx.rect(-50, -50, W + 100, H + 100); ctx.arc(X, Y, Math.max(1, r), 0, TAU, true); ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(160,255,140,.8)'; ctx.lineWidth = Math.max(3, s * 0.1);
    ctx.setLineDash([s * 0.4, s * 0.25]); ctx.lineDashOffset = now * s * 0.8;
    ctx.beginPath(); ctx.arc(X, Y, Math.max(1, r), 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  }

  // ---- Namen, Lebensbalken, Emotes
  for (const o of view) {
    if (!o.alive) continue;
    drawPlayerHud(o, s, pr, now);
  }
  ctx.restore();

  drawHud(smp, me, now);
  if (G.me != null && S.touch && !G.ended) drawTouch(me, now);
  if (G.board) drawBoard();
}

function drawFx(dt, SX, SY, s) {
  const keep = [];
  for (const f of G.fx) {
    f.life -= dt;
    if (f.life <= 0) continue;
    keep.push(f);
    const k = f.life / f.max;
    if (f.k === 'p') {
      f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 1 - dt * 3; f.vy *= 1 - dt * 3; f.vy += (f.grav || 0) * dt * (V.flip ? -1 : 1);
      ctx.globalAlpha = Math.min(1, k * 1.5); ctx.fillStyle = f.color;
      Grafik.circ(ctx, SX(f.x), SY(f.y), f.size * s * (0.4 + 0.6 * k));
    } else if (f.k === 'r') {
      ctx.globalAlpha = k; ctx.strokeStyle = f.color; ctx.lineWidth = Math.max(1.5, f.w * s * k);
      ctx.beginPath(); ctx.arc(SX(f.x), SY(f.y), lerp(f.r1, f.r0, k) * s, 0, TAU); ctx.stroke();
    } else if (f.k === 't') {
      ctx.globalAlpha = Math.min(1, k * 2);
      const rise = (1 - k) * 0.7;
      txt(f.text, SX(f.x), SY(f.y) - rise * s, f.size * s * (k > 0.85 ? 1 + (k - 0.85) * 3 : 1), f.color);
    } else if (f.k === 'b') {
      const X = SX(f.x), Y = SY(f.y), R = f.r * s * (1.1 - k * 0.4);
      const g = ctx.createRadialGradient(X, Y, 0, X, Y, R);
      g.addColorStop(0, `rgba(255,255,220,${k})`); g.addColorStop(0.4, `rgba(255,180,60,${k * 0.9})`); g.addColorStop(1, 'rgba(255,80,30,0)');
      ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, R, 0, TAU); ctx.fill();
    } else if (f.k === 's') {
      const X = SX(f.x), Y = SY(f.y), a = viewAng(f.ang), R = 2.2 * s;
      ctx.globalAlpha = k; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = s * 0.18 * k + 1; ctx.lineCap = 'round';
      const sweep = (1 - k) * 1.5;
      ctx.beginPath(); ctx.arc(X, Y, R * 0.75, a - 0.75, a - 0.75 + sweep); ctx.stroke();
      ctx.strokeStyle = '#d6c2ff'; ctx.lineWidth = s * 0.08 * k + 1;
      ctx.beginPath(); ctx.arc(X, Y, R * 0.55, a - 0.75, a - 0.75 + sweep); ctx.stroke(); ctx.lineCap = 'butt';
    }
  }
  ctx.globalAlpha = 1;
  G.fx = keep;
}

function drawAim(me, X, Y) {
  const h = S.heroes[heroOf(G.me)], s = V.s;
  let kind = null, ang = 0, frac = 0.75;
  const R = stickR();
  const st = touch.sup && touch.sup.moved ? ['sup', touch.sup] : touch.atk && touch.atk.moved ? ['atk', touch.atk] : null;
  if (st) {
    const dx = st[1].x - st[1].ox, dy = st[1].y - st[1].oy, len = Math.hypot(dx, dy);
    if (len < R * 0.22) return;
    kind = st[0]; ang = Math.atan2(dy, dx); frac = Math.min(1, len / R);
  } else if (!S.touch && mouse.in && G.me != null) {
    kind = mouse.sup ? 'sup' : 'atk';
    ang = Math.atan2(mouse.y - Y, mouse.x - X);
    const range = kind === 'sup' ? h.srange : h.range;
    frac = Math.min(1, Math.hypot(mouse.x - X, mouse.y - Y) / s / range);
  }
  if (!kind) return;
  const sup = kind === 'sup';
  if (sup && me.sup < 100) return;
  const type = sup ? h.sup : h.attack, range = (sup ? h.srange : h.range) * s;
  const strong = st || mouse.sup;
  const fill = sup ? `rgba(255,201,60,${strong ? 0.32 : 0.18})` : `rgba(255,255,255,${strong ? 0.28 : 0.13})`;
  const line = sup ? 'rgba(255,201,60,.85)' : `rgba(255,255,255,${strong ? 0.7 : 0.35})`;
  ctx.save(); ctx.translate(X, Y); ctx.rotate(ang);
  ctx.fillStyle = fill; ctx.strokeStyle = line; ctx.lineWidth = 2;
  if (['burst', 'bolt', 'seed', 'orb', 'pierce', 'charge'].includes(type)) {
    const w = { burst: 0.42, bolt: 0.3, seed: 0.38, orb: 1.1, pierce: 0.5, charge: 0.9 }[type] * s;
    rrect(s * 0.35, -w / 2, range - s * 0.35, w, w / 2); ctx.fill(); ctx.stroke();
  } else if (type === 'spread' || type === 'slash') {
    const half = type === 'spread' ? 0.42 : 0.75;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, range, -half, half); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else {
    const d = Math.max(1.2 * s, frac * range), rad = (sup ? (h.sradius || 1.5) : (h.radius || 1.3)) * s;
    ctx.setLineDash([s * 0.15, s * 0.15]); ctx.beginPath(); ctx.moveTo(s * 0.4, 0);
    ctx.quadraticCurveTo(d / 2, -d * 0.35, d, 0); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = type === 'heal' ? 'rgba(125,255,155,.25)' : type === 'leap' ? 'rgba(176,124,255,.28)' : fill;
    ctx.beginPath(); ctx.arc(d, 0, rad, 0, TAU); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function drawPlayerHud(o, s, pr, now) {
  const X = o.sx, Y = o.sy - (o.z || 0) / 100 * s * 1.3;
  const me = o.id === G.me, col = relColor(o.id);
  const bw = s * 1.05, bh = Math.max(6, s * 0.15), by = Y - pr * 2.25;
  ctx.fillStyle = 'rgba(10,6,30,.75)'; rrect(X - bw / 2 - 2, by - 2, bw + 4, bh + 4, bh / 2 + 2); ctx.fill();
  const f = clamp(o.hp / o.max, 0, 1);
  ctx.fillStyle = me ? '#4fd67a' : col === ALLY ? '#57b4ff' : '#ff5a6a';
  rrect(X - bw / 2, by, Math.max(bh, bw * f), bh, bh / 2); ctx.fill();
  if (s >= 30) txt(String(Math.ceil(o.hp)), X, by + bh / 2 + 0.5, Math.max(9, bh * 0.95), '#fff');
  if (me) {                                 // Munition
    const segW = (bw - 4) / 3, ay = by + bh + 4, ah = Math.max(4, s * 0.08);
    for (let i = 0; i < 3; i++) {
      const fill = clamp(o.ammo / 10 - i, 0, 1);
      ctx.fillStyle = 'rgba(10,6,30,.75)'; ctx.fillRect(X - bw / 2 + i * (segW + 2), ay, segW, ah);
      ctx.fillStyle = fill >= 1 ? '#ffb020' : '#a86d10'; ctx.fillRect(X - bw / 2 + i * (segW + 2), ay, segW * fill, ah);
    }
  } else {
    txt(nameOf(o.id), X, by - bh * 0.9, Math.max(10, s * 0.24), col === ENEMY ? '#ffd0d4' : '#e0f0ff');
  }
  const extra = [];
  if (o.crystals) extra.push('💎' + o.crystals);
  if (o.cells) extra.push('⚡' + o.cells);
  if (extra.length) txt(extra.join(' '), X, by - bh * (me ? 1 : 2.4), Math.max(11, s * 0.26), '#fff');
  const em = G.emo.get(o.id);
  if (em && em.until > now) {
    const k = clamp((em.until - now) * 3, 0, 1), ey = by - s * (me ? 0.6 : 0.95);
    ctx.globalAlpha = k;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(X, ey, s * 0.42, s * 0.34, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(X - s * 0.08, ey + s * 0.28); ctx.lineTo(X, ey + s * 0.45); ctx.lineTo(X + s * 0.1, ey + s * 0.28); ctx.fill();
    ctx.font = `800 ${Math.round(s * 0.36)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#1b1440';
    ctx.fillText(EMOTES[em.n] || '?', X, ey + 1);
    ctx.globalAlpha = 1;
  }
}

function drawHud(smp, me, now) {
  const b = smp.b, narrow = W < 640;
  const k = clamp(Math.min(W, H) / 420, 0.75, 1.3);
  const top = narrow ? 62 : 10;           // schmal: unter den Knöpfen oben links
  // Punktestand
  const cx = W / 2, bw = 66 * k, bh = 40 * k;
  if (G.teams) {
    const mine = G.myTeam ?? 0, other = 1 - mine;
    const sc = b.sc || [0, 0];
    const icon = G.mode === 'kristall' ? '💎' : '⚔';
    ctx.fillStyle = 'rgba(10,6,30,.6)'; rrect(cx - bw * 1.75, top, bw * 3.5, bh, 12 * k); ctx.fill();
    ctx.fillStyle = ALLY; rrect(cx - bw * 1.7, top + 4 * k, bw, bh - 8 * k, 9 * k); ctx.fill();
    ctx.fillStyle = ENEMY; rrect(cx + bw * 0.7, top + 4 * k, bw, bh - 8 * k, 9 * k); ctx.fill();
    txt(`${sc[mine]}`, cx - bw * 1.2, top + bh / 2, 22 * k);
    txt(`${sc[other]}`, cx + bw * 1.2, top + bh / 2, 22 * k);
    txt(fmtTime(b.tl), cx, top + bh / 2 - 6 * k, 15 * k, '#fff');
    txt(`${icon} ${S.modes[G.mode].goal}`, cx, top + bh / 2 + 9 * k, 10 * k, '#cfc6f5');
    if (b.hd) {
      const t = b.hd[0], ally = t === mine;
      txt(`${ally ? 'Sieg' : 'Niederlage'} in ${Math.ceil(b.hd[1])}`, cx, top + bh + 22 * k, 26 * k, ally ? '#7fd0ff' : '#ff8a96');
    }
  } else {
    ctx.fillStyle = 'rgba(10,6,30,.6)'; rrect(cx - bw * 1.4, top, bw * 2.8, bh, 12 * k); ctx.fill();
    txt(`☠ ${b.al ?? '?'} übrig`, cx - bw * 0.55, top + bh / 2, 17 * k);
    txt(fmtTime(b.tl), cx + bw * 0.85, top + bh / 2, 16 * k, '#cfc6f5');
  }
  // K.o.-Meldungen
  const fs = 13 * k;
  let fy = narrow ? top + 40 * k + 46 * k : 12;
  for (const f of G.feed) {
    const age = now - f.t;
    if (age > 5) continue;
    ctx.globalAlpha = clamp(5 - age, 0, 1);
    const kn = f.killer ? nameOf(f.killer) : 'Giftnebel', vn = nameOf(f.victim);
    ctx.font = `800 ${Math.round(fs)}px "Segoe UI", system-ui, sans-serif`;
    const w = ctx.measureText(kn + '  ✖  ' + vn).width + 16;
    ctx.fillStyle = 'rgba(10,6,30,.6)'; rrect(W - w - 10, fy, w, fs * 1.8, 8); ctx.fill();
    txt(vn, W - 18, fy + fs * 0.9, fs, f.victim === G.me ? GOLD : relColor(f.victim) === ENEMY ? '#ff8a96' : '#8fcaff', 'right');
    const vw = ctx.measureText(vn).width;
    txt('✖', W - 18 - vw - 12, fy + fs * 0.9, fs, '#fff');
    txt(kn, W - 18 - vw - 24, fy + fs * 0.9, fs, f.killer === G.me ? GOLD : f.killer ? (relColor(f.killer) === ENEMY ? '#ff8a96' : '#8fcaff') : '#9dff9b', 'right');
    fy += fs * 2.1;
    ctx.globalAlpha = 1;
  }
  // Ping
  txt(`${S.ping} ms`, W - 10, H - 12, 11, S.ping > 150 ? '#ff8a96' : 'rgba(255,255,255,.6)', 'right');
  if (G.lost) txt('Verbindung weg – verbinde neu …', W / 2, H * 0.3, 20 * k, '#ff8a96');

  // Tot / Zuschauer
  if (G.me == null) txt('Du schaust zu – nächste Runde bist du dabei', W / 2, H - 30 * k, 15 * k, '#cfc6f5');
  else if (me && !me.alive && !G.ended) {
    if (G.teams) txt(`Zurück in ${Math.max(0, me.respawn).toFixed(1)} s`, W / 2, H * 0.62, 28 * k, '#fff');
    else txt('Ausgeschieden – du schaust zu', W / 2, H - 34 * k, 18 * k, '#cfc6f5');
  }
  // Super-Leiste am PC
  if (me && me.alive && !S.touch) {
    const w = 220 * k, x = W / 2 - w / 2, y = H - 30 * k, f = clamp(me.sup / 100, 0, 1);
    ctx.fillStyle = 'rgba(10,6,30,.7)'; rrect(x - 3, y - 3, w + 6, 16 * k + 6, 10); ctx.fill();
    ctx.fillStyle = f >= 1 ? `rgba(255,201,60,${0.75 + 0.25 * Math.sin(now * 8)})` : '#a8862a'; rrect(x, y, Math.max(8, w * f), 16 * k, 8); ctx.fill();
    txt(f >= 1 ? 'SUPER BEREIT – Rechtsklick / Leertaste' : `Super ${Math.floor(f * 100)} %`, W / 2, y + 8 * k, 11 * k, '#fff');
  }
  // Banner
  if (G.banner && G.banner.until > now) {
    const bn = G.banner, a = clamp((bn.until - now) * 2, 0, 1);
    ctx.globalAlpha = a;
    const size = (bn.big ? 64 : bn.small ? 30 : 44) * k;
    txt(bn.text, W / 2, H * 0.36, size, bn.big ? GOLD : '#fff');
    if (bn.sub) txt(bn.sub, W / 2, H * 0.36 + size * 0.85, 16 * k, '#e7e0ff');
    ctx.globalAlpha = 1;
  }
}

function drawTouch(me, now) {
  const L = layout(), R = stickR(), h = S.heroes[heroOf(G.me)];
  // Laufen
  if (touch.move) {
    const m = touch.move, dx = m.x - m.ox, dy = m.y - m.oy, d = Math.hypot(dx, dy), f = d > R ? R / d : 1;
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(m.ox, m.oy, R, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; Grafik.circ(ctx, m.ox + dx * f, m.oy + dy * f, R * 0.42);
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(W * 0.14, H - R - 30, R, 0, TAU); ctx.stroke();
    txt('laufen', W * 0.14, H - R - 30, 12, 'rgba(255,255,255,.4)');
  }
  // Angriff
  const a = L.atk;
  const at = touch.atk;
  if (at && at.moved) {
    const dx = at.x - at.ox, dy = at.y - at.oy, d = Math.hypot(dx, dy), f = d > R ? R / d : 1;
    ctx.fillStyle = 'rgba(255,120,80,.15)'; ctx.strokeStyle = 'rgba(255,160,120,.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(at.ox, at.oy, R, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,140,90,.8)'; Grafik.circ(ctx, at.ox + dx * f, at.oy + dy * f, R * 0.4);
  }
  ctx.fillStyle = 'rgba(214,60,60,.75)'; ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(a.x, a.y, a.r * 0.35, 0, TAU); ctx.moveTo(a.x - a.r * 0.6, a.y); ctx.lineTo(a.x + a.r * 0.6, a.y); ctx.moveTo(a.x, a.y - a.r * 0.6); ctx.lineTo(a.x, a.y + a.r * 0.6); ctx.stroke();
  if (me) for (let i = 0; i < 3; i++) {
    const f = clamp(me.ammo / 10 - i, 0, 1), a0 = -Math.PI / 2 - 0.95 + i * 0.66;
    ctx.strokeStyle = 'rgba(10,6,30,.7)'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(a.x, a.y, a.r + 8, a0, a0 + 0.58); ctx.stroke();
    ctx.strokeStyle = f >= 1 ? '#ffb020' : '#a86d10'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(a.x, a.y, a.r + 8, a0, a0 + 0.58 * f); ctx.stroke();
  }
  // Super
  const sp = L.sup, ready = me && me.sup >= 100;
  const st = touch.sup;
  if (st && st.moved && ready) {
    const dx = st.x - st.ox, dy = st.y - st.oy, d = Math.hypot(dx, dy), f = d > R ? R / d : 1;
    ctx.fillStyle = 'rgba(255,201,60,.15)'; ctx.strokeStyle = 'rgba(255,201,60,.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(st.ox, st.oy, R, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,201,60,.85)'; Grafik.circ(ctx, st.ox + dx * f, st.oy + dy * f, R * 0.38);
  }
  ctx.fillStyle = ready ? `rgba(255,190,40,${0.85 + 0.15 * Math.sin(now * 8)})` : 'rgba(90,80,120,.7)';
  ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.r, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(10,6,30,.6)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.r + 5, 0, TAU); ctx.stroke();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.r + 5, -Math.PI / 2, -Math.PI / 2 + TAU * clamp((me ? me.sup : 0) / 100, 0, 1)); ctx.stroke();
  txt('★', sp.x, sp.y + 1, sp.r * 1.1, ready ? '#fff' : 'rgba(255,255,255,.5)');
  if (ready && h) txt(h.sname, sp.x, sp.y - sp.r - 16, 11, GOLD);
}

function drawBoard() {
  const list = [...G.roster.values()];
  const w = Math.min(420, W - 32), rowH = 26, h = 40 + list.length * rowH;
  const x = W / 2 - w / 2, y = H / 2 - h / 2;
  ctx.fillStyle = 'rgba(10,6,30,.85)'; rrect(x, y, w, h, 14); ctx.fill();
  txt('Spieler', x + 16, y + 20, 14, '#cfc6f5', 'left');
  list.sort((a, b) => (a.team - b.team));
  list.forEach((p, i) => {
    const e = G.last && G.last.p.get(p.id);
    const yy = y + 44 + i * rowH;
    txt(`${S.heroes[p.hero].name}`, x + 16, yy, 13, relColor(p.id), 'left');
    txt(p.name + (p.bot ? ' 🤖' : ''), x + 110, yy, 13, '#fff', 'left');
    if (e) txt(`${Math.ceil(e[3])} LP${e[9] ? ' · 💎' + e[9] : ''}${e[10] ? ' · ⚡' + e[10] : ''}`, x + w - 16, yy, 12, '#cfc6f5', 'right');
  });
}

// ================================================================ Hauptschleife

let lastFrame = performance.now();
function frame(ts) {
  const dt = Math.min(0.1, Math.max(0, (ts - lastFrame) / 1000));
  lastFrame = ts;
  if (G && !G.ended && G.me != null) {
    G.acc = Math.min(G.acc + dt, 0.25);
    while (G.acc >= G.dt) { G.acc -= G.dt; clientTick(); }
    if (mouse.down && !S.touch) fireAtMouse('atk');
  }
  try { render(dt); } catch (e) { console.error(e); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
connect();
