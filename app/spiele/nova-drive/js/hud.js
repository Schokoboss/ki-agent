// Anzeige: Tacho, Minikarte, Skill-Kette, Hinweise, Rennen, Ergebnisse, Inselkarte.
import { HALF, N, SURF, FESTIVAL } from './terrain.js';
import { clamp, fmtTime, fmtNum, smoothstep, breathe } from './util.js';
import { EVENT_COLORS } from './world.js';
import { TYPE_NAMES } from './events.js';
import { star } from './textures.js';

const $ = id => document.getElementById(id);

export async function makeMapImage(world, size = 1024, prog = () => {}) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const k = (2 * HALF) / size;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    if (i === 0 && j % 32 === 0) { prog(j / size); await breathe(); }
    const x = -HALF + (i + 0.5) * k, z = -HALF + (j + 0.5) * k;
    const h = world.baseAt(x, z);
    const s = world.surfaceAt(x, z);
    let r, gg, b;
    if (h < -0.3) { const d = clamp(-h / 25, 0, 1); r = 30 - d * 18; gg = 120 - d * 70; b = 170 - d * 60; }
    else {
      const sx = (x - 620) / 260, sz = (z + 470) / 220, dry = Math.exp(-(sx * sx + sz * sz));
      r = 92 + dry * 80; gg = 140 + dry * 20; b = 70 + dry * 10;
      if (s === SURF.SAND) { r = 226; gg = 206; b = 150; }
      if (s === SURF.ROCK) { r = 140; gg = 136; b = 128; }
      if (s === SURF.SNOW) { r = 240; gg = 244; b = 250; }
      if (h > 60 && s === SURF.GRASS) { const t = clamp((h - 60) / 60, 0, 1); r += t * 30; gg += t * 10; b += t * 30; }
      // Relief-Schattierung
      const gx = world.baseAt(x + 4, z) - world.baseAt(x - 4, z), gz = world.baseAt(x, z + 4) - world.baseAt(x, z - 4);
      const sh = clamp(1 - (gx * 0.8 + gz * 0.6) * 0.09, 0.6, 1.3);
      r *= sh; gg *= sh; b *= sh;
    }
    const o = (j * size + i) * 4;
    img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const P = v => (v + HALF) / k;
  // Wald dunkler
  g.fillStyle = 'rgba(20,70,30,0.35)';
  for (const t of world.trees) { g.fillRect(P(t.x) - 1, P(t.z) - 1, 2, 2); }
  for (const pass of [0, 1]) {
    for (const r of world.roads) {
      const p = r.path;
      g.beginPath();
      for (let i = 0; i < p.n; i += 2) { const x = P(p.x[i]), z = P(p.z[i]); i ? g.lineTo(x, z) : g.moveTo(x, z); }
      if (p.closed) g.closePath();
      const w = (r.def.hw * 2) / k;
      if (pass === 0) { g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = w + 3; }
      else { g.strokeStyle = r.def.type === 'dirt' ? '#d9a35b' : '#f6f2ea'; g.lineWidth = w; }
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.stroke();
    }
  }
  g.fillStyle = 'rgba(120,90,110,0.95)';
  for (const b of world.buildings) {
    g.save(); g.translate(P(b.x), P(b.z)); g.rotate(-b.yaw); g.fillRect(-b.w / k / 2, -b.d / k / 2, b.w / k, b.d / k); g.restore();
  }
  g.fillStyle = '#34353b'; g.beginPath(); g.arc(P(FESTIVAL.x), P(FESTIVAL.z), FESTIVAL.r / k, 0, 7); g.fill();
  g.fillStyle = '#ff3d7f'; star(g, P(FESTIVAL.x), P(FESTIVAL.z), 22, 9, 5); g.fill();
  return c;
}

export class HUD {
  constructor(game) {
    this.g = game;
    this.mm = $('minimap'); this.mmg = this.mm.getContext('2d');
    this.sp = $('speedo'); this.spg = this.sp.getContext('2d');
    this.skillEl = $('skill'); this.toastEl = $('toasts');
    this.mmT = 0;
    this.liveName = null;
  }
  setMap(img) { this.mapImg = img; }

  // ---------- Tacho
  speedo(car) {
    const g = this.spg, W = this.sp.width, H = this.sp.height, s = W / 200;
    g.clearRect(0, 0, W, H);
    g.save(); g.scale(s, s);
    const top = car.stats.top;
    const v = car.speedKmh;
    const a0 = Math.PI * 0.78, a1 = Math.PI * 2.22;
    g.lineCap = 'round';
    g.lineWidth = 12; g.strokeStyle = 'rgba(255,255,255,0.15)';
    g.beginPath(); g.arc(100, 100, 82, a0, a1); g.stroke();
    const f = clamp(v / (top * 1.05), 0, 1);
    const grad = g.createLinearGradient(20, 180, 180, 20);
    grad.addColorStop(0, '#1fd1ff'); grad.addColorStop(0.6, '#7a6bff'); grad.addColorStop(1, '#ff3d7f');
    g.strokeStyle = grad;
    g.beginPath(); g.arc(100, 100, 82, a0, a0 + (a1 - a0) * f); g.stroke();
    // Drehzahl innen
    g.lineWidth = 5; g.strokeStyle = car.rpm > 0.92 ? '#ff4d4d' : 'rgba(255,255,255,0.75)';
    g.beginPath(); g.arc(100, 100, 66, a0, a0 + (a1 - a0) * clamp(car.rpm, 0, 1)); g.stroke();
    // Nitro unten
    const n = car.nitro / car.stats.nitroCap;
    g.lineWidth = 7; g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.beginPath(); g.arc(100, 100, 94, Math.PI * 0.32, Math.PI * 0.68); g.stroke();
    g.strokeStyle = car.nitroOn ? '#ffffff' : '#36e2ff';
    g.beginPath(); g.arc(100, 100, 94, Math.PI * 0.68 - Math.PI * 0.36 * n, Math.PI * 0.68); g.stroke();
    g.fillStyle = '#fff'; g.textAlign = 'center';
    g.font = 'italic 800 52px "Chakra Petch", system-ui, sans-serif';
    g.fillText(Math.round(v), 100, 112);
    g.font = '700 15px "Chakra Petch", system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillText('KM/H', 100, 132);
    g.font = 'italic 800 26px "Chakra Petch", system-ui, sans-serif'; g.fillStyle = '#ffd23f';
    g.fillText(car.gear < 0 ? 'R' : (v < 1 && car.rpm < 0.25 ? 'N' : car.gear), 100, 165);
    g.restore();
  }

  // ---------- Minikarte
  minimap(dt, car, extra) {
    this.mmT += dt;
    if (this.mmT < 1 / 24) return;
    this.mmT = 0;
    const c = this.mm, g = this.mmg, S = c.width, R = S / 2;
    const k = (2 * HALF) / this.mapImg.width;
    const zoom = clamp(1.25 - car.speedKmh / 400, 0.7, 1.25) * (S / 220) * (extra.zoom || 1);
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath(); g.arc(R, R, R - 2, 0, 7); g.clip();
    g.fillStyle = '#1b4a6b'; g.fillRect(0, 0, S, S);
    g.translate(R, R + R * 0.25);
    const phi = Math.atan2(Math.cos(car.yaw), Math.sin(car.yaw));
    const rot = -Math.PI / 2 - phi;
    g.rotate(rot);
    g.scale(zoom, zoom);
    g.drawImage(this.mapImg, -(car.pos.x + HALF) / k, -(car.pos.z + HALF) / k);
    const P = (x, z) => [(x - car.pos.x) / k, (z - car.pos.z) / k];
    // Rennroute
    if (extra.route) {
      const { path, from, len } = extra.route;
      g.strokeStyle = '#1fe0ff'; g.lineWidth = 5 / zoom * 1.4; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath();
      for (let s = 0; s <= len; s += 8) { const p = path.at(from + s, {}); const [x, z] = P(p.x, p.z); s ? g.lineTo(x, z) : g.moveTo(x, z); }
      g.stroke();
    }
    const dot = (x, z, col, r) => { const [px, pz] = P(x, z); g.fillStyle = col; g.beginPath(); g.arc(px, pz, r / zoom, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5 / zoom; g.stroke(); };
    if (extra.events) for (const ev of extra.events) dot(ev.type === 'jump' ? ev.ax : ev.x, ev.type === 'jump' ? ev.az : ev.z, EVENT_COLORS[ev.type], ev.type === 'race' ? 6 : 4.5);
    if (extra.ais) for (const a of extra.ais) dot(a.pos.x, a.pos.z, '#ff9a1f', 4);
    if (extra.cp) dot(extra.cp.x, extra.cp.z, '#1fe0ff', 6);
    g.restore();
    // Wegpunkt-Pfeil am Rand
    if (extra.waypoint) {
      const dx = extra.waypoint.x - car.pos.x, dz = extra.waypoint.z - car.pos.z;
      const ang = Math.atan2(dz, dx) + rot;
      const dist = Math.hypot(dx, dz);
      const r2 = Math.min(R - 12, dist / k * zoom);
      g.save(); g.translate(R + Math.cos(ang) * r2, R + R * 0.25 * (r2 < R - 12 ? 1 : 0) + Math.sin(ang) * r2);
      g.rotate(ang + Math.PI / 2);
      g.fillStyle = '#ffd23f'; g.beginPath(); g.moveTo(0, -9); g.lineTo(7, 7); g.lineTo(0, 3); g.lineTo(-7, 7); g.closePath(); g.fill();
      g.restore();
      g.fillStyle = '#ffd23f'; g.font = '700 13px system-ui'; g.textAlign = 'center';
      g.fillText(dist > 1000 ? (dist / 1000).toFixed(1) + ' km' : Math.round(dist / 10) * 10 + ' m', R, S - 10);
    }
    // Spieler
    g.save(); g.translate(R, R + R * 0.25);
    g.fillStyle = '#fff'; g.strokeStyle = '#7a6bff'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(0, -10); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 3;
    g.beginPath(); g.arc(R, R, R - 2, 0, 7); g.stroke();
  }

  // ---------- Skill-Kette
  skillLive(name, pts) {
    const el = this.skillEl;
    if (!name) { if (!this.g.skills.points) el.classList.remove('show'); return; }
    el.classList.add('show');
    $('skill-name').textContent = `${name} ${fmtNum(pts)}`;
    $('skill-total').textContent = this.g.skills.points ? fmtNum(this.g.skills.points) : '';
    $('skill-mult').textContent = this.g.skills.points ? `×${this.g.skills.mult}` : '';
  }
  skill(name, pts, total, mult) {
    const el = this.skillEl;
    el.classList.add('show'); el.classList.remove('lost', 'bank');
    $('skill-name').textContent = `${name} +${fmtNum(pts)}`;
    $('skill-total').textContent = fmtNum(total);
    $('skill-mult').textContent = `×${mult}`;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  }
  skillLost() {
    const el = this.skillEl;
    el.classList.add('lost'); $('skill-name').textContent = 'Kette verloren!';
    clearTimeout(this._sk); this._sk = setTimeout(() => el.classList.remove('show', 'lost'), 1400);
  }
  skillBank(total) {
    const el = this.skillEl;
    el.classList.add('bank'); $('skill-name').textContent = `Skill-Kette`; $('skill-total').textContent = '+' + fmtNum(total); $('skill-mult').textContent = '✓';
    clearTimeout(this._sk); this._sk = setTimeout(() => el.classList.remove('show', 'bank'), 1600);
  }

  // ---------- Meldungen
  toast(text, kind = 'info') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind; t.textContent = text;
    this.toastEl.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3200);
    while (this.toastEl.children.length > 3) this.toastEl.firstChild.remove();
  }
  money(cr, fans) {
    // Credits hochzählen
    const target = this.g.save.credits, from = this.shownCr ?? target;
    this.shownCr = target;
    const el = $('credits'), t0 = performance.now();
    cancelAnimationFrame(this._crRaf);
    const anim = now => {
      const t = Math.min(1, (now - t0) / 900), v = from + (target - from) * (1 - Math.pow(1 - t, 3));
      el.textContent = fmtNum(v) + ' CR';
      if (t < 1) this._crRaf = requestAnimationFrame(anim);
    };
    if (from !== target) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); this._crRaf = requestAnimationFrame(anim); }
    else el.textContent = fmtNum(target) + ' CR';
    const n = this.g.save.spins || 0, sp = $('h-spin');
    if (sp) { sp.hidden = !n; sp.textContent = `🎡 ${n}`; }
    const lv = this.g.level();
    $('level').textContent = lv.level;
    $('level-bar').style.width = (lv.frac * 100).toFixed(1) + '%';
    if (cr || fans) {
      const t = document.createElement('div'); t.className = 'gain';
      t.textContent = `${cr ? '+' + fmtNum(cr) + ' CR' : ''}${cr && fans ? '  ' : ''}${fans ? '+' + fmtNum(fans) + ' Fans' : ''}`;
      $('gains').appendChild(t); setTimeout(() => t.remove(), 2400);
    }
  }
  banner(title, value, stars, extra) {
    const b = $('banner');
    b.innerHTML = '';
    const h = document.createElement('div'); h.className = 'b-title'; h.textContent = title;
    const v = document.createElement('div'); v.className = 'b-value'; v.textContent = value;
    b.append(h, v);
    if (stars !== null && stars !== undefined) {
      const s = document.createElement('div'); s.className = 'b-stars';
      for (let i = 0; i < 3; i++) { const e = document.createElement('span'); e.textContent = '★'; if (i < stars) e.className = 'on'; e.style.animationDelay = (0.2 + i * 0.15) + 's'; s.appendChild(e); }
      b.append(s);
    }
    if (extra) { const x = document.createElement('div'); x.className = 'b-extra'; x.textContent = extra; b.appendChild(x); }
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(this._bn); this._bn = setTimeout(() => b.classList.remove('show'), 3200);
  }
  zone(name, sub) {
    const z = $('zone');
    if (!name) { z.hidden = true; return; }
    z.hidden = false; $('zone-name').textContent = name; $('zone-score').textContent = '0';
  }
  zoneScore(v, stars) {
    $('zone-score').textContent = fmtNum(v);
    $('zone-stars').textContent = [0, 1, 2].map(i => (v >= stars[i] ? '★' : '☆')).join('');
  }
  prompt(ev) {
    const p = $('prompt');
    if (!ev) { p.hidden = true; return; }
    p.hidden = false;
    $('prompt-type').textContent = TYPE_NAMES[ev.type] + (ev.dirt ? ' · Schotter' : '');
    $('prompt-name').textContent = ev.name;
    const len = ev.sprint ? (ev.to - ev.at) * ev.path.length : ev.laps * ev.path.length;
    $('prompt-info').textContent = `${ev.sprint ? 'Sprint' : ev.laps + ' Runden'} · ${(len / 1000).toFixed(1)} km · ${ev.ai} Gegner`;
    const best = this.g.save.best[ev.id];
    $('prompt-best').textContent = best ? 'Bestzeit ' + fmtTime(best) : 'Noch nicht gefahren';
    p.dataset.id = ev.id;
  }
  countdown(text) {
    const c = $('countdown');
    c.textContent = text; c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
  }
  raceStart(r) { $('race').hidden = false; $('free-info').hidden = true; }
  raceEnd() { $('race').hidden = true; $('free-info').hidden = false; }
  raceInfo(r, rank, lap) {
    $('r-pos').innerHTML = `${rank}<small>/${r.ais.length + 1}</small>`;
    $('r-lap').textContent = r.ev.sprint ? `${Math.max(0, Math.min(100, Math.round(r.prog / r.total * 100)))} %` : `Runde ${lap}/${r.laps}`;
    $('r-time').textContent = fmtTime(Math.max(0, r.finished ? r.finishT : r.t));
    const gd = r.ghost ? r.ghost.data : null;
    $('r-ghost').textContent = gd ? (gd.name ? `vs. ${gd.name} ${fmtTime(gd.time)}` : `Geist ${fmtTime(gd.time)}`) : '';
  }

  showResults(res) {
    const el = $('results');
    $('res-title').textContent = res.pos === 1 ? 'SIEG!' : `${res.pos}. Platz`;
    $('res-event').textContent = res.ev.name;
    const tb = $('res-table'); tb.innerHTML = '';
    res.rows.forEach((r, i) => {
      const tr = document.createElement('div'); tr.className = 'row' + (r.me ? ' me' : '');
      tr.innerHTML = `<span class="p">${i + 1}</span><span class="n"></span><span class="c"></span><span class="t">${fmtTime(r.time)}</span>`;
      tr.querySelector('.n').textContent = r.name;
      tr.querySelector('.c').textContent = r.car ? `${r.car.maker} ${r.car.name}` : '';
      tb.appendChild(tr);
    });
    const bd = $('res-breakdown'); bd.innerHTML = '';
    for (const [k, v] of res.lines || []) {
      const d = document.createElement('div'); d.className = v < 0 ? 'neg' : '';
      d.innerHTML = `<span></span><b>${v < 0 ? '−' : '+'}${fmtNum(Math.abs(v))} CR</b>`;
      d.querySelector('span').textContent = k;
      bd.appendChild(d);
    }
    $('res-reward').textContent = `Gesamt +${fmtNum(res.cr)} CR · +${fmtNum(res.fans)} Fans` + (res.isBest ? ' · Neue Bestzeit!' : '');
    const ch = $('res-challenge');
    if (res.challenge) { ch.hidden = false; ch.textContent = res.challenge.won ? `Du hast ${res.challenge.name} geschlagen! 🎉` : `${res.challenge.name} war schneller (${fmtTime(res.challenge.time)}).`; ch.className = res.challenge.won ? 'win' : 'lose'; }
    else ch.hidden = true;
    this.lastResult = res;
    this.g.showScreen('results');
  }
}
