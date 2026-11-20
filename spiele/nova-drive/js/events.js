// Events auf der Insel: Rennen, Blitzer, Driftzonen, Schanzen, Plakate – und die Skill-Kette.
import * as THREE from '../lib/three.module.min.js';
import { EVENTS, CARS, BARN_CARS, CHAMP_POINTS } from './data.js';
import { INTRO } from './cine.js';
import { clamp, fmtTime, fmtNum, mulberry32 } from './util.js';
import { RaceAI, speedProfile } from './ai.js';
import { EVENT_COLORS } from './world.js';
import { buildCar, disposeCar } from './carmodel.js';

const ICONS = { race: '🏁', trap: '📷', drift: '〰', jump: '⚠', speed: '⏱' };
const P = {};
export const TYPE_NAMES = { race: 'Rennen', trap: 'Blitzer', drift: 'Driftzone', jump: 'Sprungschanze', speed: 'Tempozone' };
const AI_NAMES = ['Mila', 'Jonas', 'Aylin', 'Ben', 'Sofia', 'Luca', 'Emre', 'Lea', 'Noah', 'Hanna', 'Finn', 'Yara'];

// ---------------------------------------------------------------- Skill-Kette
export class Skills {
  constructor(game) {
    this.g = game; this.points = 0; this.count = 0; this.timer = 0;
    this.drift = 0; this.driftT = 0; this.fast = 0; this.draftT = 0;
    this.last = '';
  }
  get mult() { return Math.min(10, 1 + Math.floor(this.count / 3)); }
  add(name, pts) {
    pts = Math.round(pts);
    this.points += pts; this.count++; this.timer = 4;
    this.last = name;
    this.g.hud.skill(name, pts, this.points, this.mult);
    this.g.audio.play('skill');
    if (/Drift/.test(name) && this.g.tutEvent) this.g.tutEvent('drift');
    const car = this.g.car;
    car.nitro = Math.min(car.stats.nitroCap, car.nitro + 0.12 + pts / 6000);
    if (this.g.events.drift) this.g.events.drift.score += pts;
  }
  crash() {
    if (this.drift > 300) this.drift = 0;
    if (this.points > 0) { this.g.hud.skillLost(); this.g.audio.play('lost'); }
    this.points = 0; this.count = 0; this.timer = 0; this.drift = 0; this.driftT = 0;
  }
  bank() {
    const total = this.points * this.mult;
    if (total > 0) {
      this.g.hud.skillBank(total);
      this.g.audio.play('bank');
      this.g.reward(Math.round(total / 12), Math.round(total / 6), false);
      this.g.eco.track('skill', total);
    }
    this.points = 0; this.count = 0;
  }
  update(dt, car) {
    // Drift
    const spd = Math.abs(car.vf);
    const ang = Math.abs(car.slip);
    if (car.grounded && ang > 0.24 && spd > 9) {
      this.drift += dt * spd * Math.min(ang, 1.2) * 14;
      this.driftT += dt;
      this.timer = Math.max(this.timer, 1.5);
      this.g.hud.skillLive('Drift', this.drift);
      if (this.g.events.drift) this.g.events.drift.live = this.drift;
    } else if (this.drift > 0) {
      if (this.driftT > 0.5 && this.drift > 120) { this.add(this.drift > 2500 ? 'Riesen-Drift' : this.drift > 1000 ? 'Großer Drift' : 'Drift', this.drift); this.g.eco.track('drift', Math.round(this.drift)); }
      else this.g.hud.skillLive(null);
      this.drift = 0; this.driftT = 0;
      if (this.g.events.drift) this.g.events.drift.live = 0;
    }
    // Sprung
    if (car.lastAir > 0) {
      const a = car.lastAir; car.lastAir = 0;
      if (a > 0.55) this.add(a > 2.2 ? 'Riesensprung' : a > 1.2 ? 'Großer Sprung' : 'Luftsprung', a * 520);
      if (a > 1) this.g.eco.track('air', 1);
      if (car.landing > 16) this.g.hud.toast('Harte Landung!', 'warn');
    }
    // Tempo
    if (car.speedKmh > 220) { this.fast += dt; if (this.fast > 2.5) { this.fast = 0; this.add(car.speedKmh > 300 ? 'Überschall' : 'Highspeed', car.speedKmh * 1.5); } }
    else this.fast = Math.max(0, this.fast - dt);
    if (this.timer > 0) { this.timer -= dt; if (this.timer <= 0) this.bank(); }
  }
}

// ---------------------------------------------------------------- Events
export class Events {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.race = null; this.drift = null; this.jump = null; this.speedz = null; this.barns = [];
    this.near = null;
    this.trapCool = new Map();
    this.nearMiss = new Map();
  }

  init() {
    const W = this.g.world, S = this.g.scenery;
    for (const def of EVENTS) {
      const ev = { ...def };
      if (def.road) {
        const path = def.road === 'quer' ? W.cross : W.roadById[def.road].path;
        ev.path = path;
        ev.s = def.at * path.length;
        const p = path.at(ev.s, P);
        ev.x = p.x; ev.z = p.z; ev.yaw = Math.atan2(p.tx, p.tz);
        ev.hw = def.road === 'quer' ? 9 : W.roadById[def.road].def.hw;
      }
      if (ev.type === 'jump') {
        // Anfahrt 40 m vor der Rampe
        ev.ax = ev.x - Math.sin(ev.yaw) * 45; ev.az = ev.z - Math.cos(ev.yaw) * 45;
      }
      if (ev.type !== 'trap') ev.beacon = S.addBeacon(ev.type === 'jump' ? ev.ax : ev.x, ev.type === 'jump' ? ev.az : ev.z, EVENT_COLORS[ev.type], ICONS[ev.type]);
      else ev.beacon = S.addBeacon(ev.x, ev.z, EVENT_COLORS.trap, ICONS.trap);
      this.list.push(ev);
    }
    this.initBarns();
    this.initViews();
  }

  // ---------- Aussichtspunkte: die höchsten Stellen an den Straßen (mind. 380 m auseinander, nicht an Events)
  initViews() {
    const W = this.g.world, S = this.g.scenery, cand = [];
    const NAME = { kueste: 'Küstenblick', pass: 'Passhöhe', see: 'Seeblick', wald: 'Waldblick', waldweg: 'Waldblick', berg: 'Gipfelblick', stadt: 'Stadtblick', markt: 'Stadtblick', schnell: 'Weitblick', festival: 'Festivalblick' };
    for (const r of W.roads) {
      const p = r.path, step = 4;
      for (let i = 0; i < p.n; i += step) {
        let top = true;
        for (let k = -48; k <= 48 && top; k += 4) { const j = p.idx(i + k); if (j !== i && p.y[j] > p.y[i]) top = false; }
        if (top && p.y[i] > 12) cand.push({ x: p.x[i], z: p.z[i], y: p.y[i], tx: p.tx[i], tz: p.tz[i], road: r.id });
      }
    }
    cand.sort((a, b) => b.y - a.y);
    const picks = [];
    for (const c of cand) {
      if (picks.length >= 8) break;
      if (picks.some(q => Math.hypot(q.x - c.x, q.z - c.z) < 380)) continue;
      if (this.list.some(e => Math.hypot(e.x - c.x, e.z - c.z) < 90)) continue;
      picks.push(c);
    }
    const found = this.g.save.views || [], used = {};
    this.views = picks.map((c, i) => {
      // neben die Fahrbahn (Seite mit freier Sicht = tiefer liegendes Gelände)
      const nx = -c.tz, nz = c.tx, hw = (W.roadById[c.road] ? W.roadById[c.road].def.hw : 6) + 1.5; // am Fahrbahnrand (nicht im Hang)
      const side = W.heightAt(c.x + nx * 30, c.z + nz * 30) < W.heightAt(c.x - nx * 30, c.z - nz * 30) ? 1 : -1;
      const x = c.x + nx * hw * side, z = c.z + nz * hw * side;
      // mehrfach vorkommende Namen bekommen die Himmelsrichtung (Karte: oben = Nord = −z)
      const dir = Math.abs(x) > Math.abs(z) ? (x > 0 ? 'Ost' : 'West') : (z < 0 ? 'Nord' : 'Süd');
      const base = NAME[c.road] || 'Aussicht', dup = picks.filter(q => (NAME[q.road] || 'Aussicht') === base).length > 1;
      let name = dup ? `${base} ${dir}` : base;
      used[name] = (used[name] || 0) + 1;
      if (used[name] > 1) name += ' ' + ['', '', 'II', 'III', 'IV', 'V'][used[name]];
      const v = { id: 'v_' + i, name, x, z, found: found.includes('v_' + i), marker: null };
      v.marker = S.addMarker(x, z, '#59f0c2', '🔭');
      return v;
    });
  }
  updateViews() {
    const g = this.g, car = g.car;
    for (const v of this.views || []) {
      const d = Math.hypot(car.pos.x - v.x, car.pos.z - v.z), vis = !v.found && d < 500;
      v.marker.ring.visible = v.marker.sp.visible = vis;
      if (vis) v.marker.sp.position.y = v.marker.y + 6 + Math.sin(performance.now() / 500 + v.x) * 0.4;
      if (!v.found && d < 12 && car.speedKmh < 35) {
        v.found = true;
        (g.save.views ||= []).push(v.id);
        const n = g.save.views.length;
        g.reward(1500, 300, true);
        g.hud.banner('Aussichtspunkt', v.name, null, `${n} / ${this.views.length} entdeckt · +1.500 CR · Tipp: Pause → 📸 Fotomodus`);
        g.audio.play('cp');
        if (n === this.views.length) { g.reward(20000, 2000, true); g.hud.toast('Alle Aussichtspunkte entdeckt! +20.000 CR', 'info'); }
        g.saveGame();
      }
    }
  }

  // ---------- Scheunenfunde: vier weit verteilte Scheunen, vor dem Tor steht ein verstaubtes Auto
  initBarns() {
    const W = this.g.world, all = W.buildings.filter(b => b.variant === 'barn');
    if (!all.length) return;
    const picks = [];
    // erst die vom Festival am weitesten entfernte, dann jeweils die, die am weitesten von allen bisherigen liegt
    const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    picks.push(all.reduce((m, b) => (dist(b, { x: -200, z: 420 }) > dist(m, { x: -200, z: 420 }) ? b : m), all[0]));
    while (picks.length < Math.min(BARN_CARS.length, all.length)) {
      let best = null, bd = -1;
      for (const b of all) { if (picks.includes(b)) continue; const d = Math.min(...picks.map(p => dist(p, b))); if (d > bd) { bd = d; best = b; } }
      picks.push(best);
    }
    const found = this.g.save.barns || [];
    picks.forEach((b, i) => {
      const id = 'b_' + i, carId = BARN_CARS[i], spec = CARS.find(c => c.id === carId);
      if (!spec) return;
      const off = b.d / 2 + 4.5, x = b.x + Math.sin(b.yaw) * off, z = b.z + Math.cos(b.yaw) * off;
      const f = { id, car: carId, spec, x, z, yaw: b.yaw, found: found.includes(id), hinted: false, model: null };
      this.barns.push(f);
    });
  }
  updateBarns() {
    const g = this.g, car = g.car;
    for (const f of this.barns) {
      if (f.found) continue;
      const d = Math.hypot(car.pos.x - f.x, car.pos.z - f.z);
      // Modell erst in der Nähe bauen (spart Speicher), weit weg wieder weg
      if (d < 220 && !f.model) {
        f.model = buildCar(f.spec, f.spec.colors[0], { lod: 'ai' });
        const pm = f.model.userData.paintMat;
        if (pm && pm.userData.dirt) pm.userData.dirt.value = 1;
        f.model.position.set(f.x, g.world.heightAt(f.x, f.z), f.z);
        f.model.rotation.y = f.yaw;
        f.model.traverse(o => { if (o.isMesh) o.castShadow = true; });
        g.scene.add(f.model);
      } else if (d > 260 && f.model) { disposeCar(f.model); f.model = null; }
      if (d < 280 && !f.hinted) { f.hinted = true; g.hud.toast('📻 Gerücht: In einer Scheune hier in der Nähe soll ein vergessenes Auto stehen…', 'radio'); }
      if (d < 8 && car.speedKmh < 45) this.findBarn(f);
    }
  }
  findBarn(f) {
    const g = this.g;
    f.found = true;
    (g.save.barns ||= []).push(f.id);
    if (f.model) { disposeCar(f.model); f.model = null; }
    const n = g.save.barns.length, total = this.barns.length;
    if (!g.save.owned[f.car]) {
      g.save.owned[f.car] = { up: {}, color: f.spec.colors[0] };
      g.hud.banner('Scheunenfund!', `${f.spec.maker} ${f.spec.name}`, null, `Steht jetzt in deiner Garage · ${n}/${total}`);
    } else {
      const cr = Math.round(f.spec.price * 0.5);
      g.reward(cr, 0, true);
      g.hud.banner('Scheunenfund!', `${f.spec.maker} ${f.spec.name}`, null, `Schon in der Garage – verkauft für ${fmtNum(cr)} CR · ${n}/${total}`);
    }
    g.reward(0, 1500, true);
    g.audio.play('win'); g.confetti && g.confetti();
    g.saveGame();
  }
  byId(id) { return this.list.find(e => e.id === id); }

  update(dt) {
    const g = this.g, car = g.car;
    if (this.race) { this.updateRace(dt); return; }
    // nächstes Event für den Hinweis
    let best = null, bd = 1e9;
    for (const ev of this.list) {
      if (ev.type !== 'race') continue;
      const d = Math.hypot(car.pos.x - ev.x, car.pos.z - ev.z);
      if (d < bd) { bd = d; best = ev; }
    }
    const near = bd < 22 && car.speedKmh < 70 ? best : null;
    if (near !== this.near) { this.near = near; g.hud.prompt(near); }
    this.updateTraps(dt);
    this.updateDrift(dt);
    this.updateSpeedZone(dt);
    this.updateJump(dt);
    this.updateBarns();
    this.updateViews();
  }

  // ---------- Tempozone: Schnitt von Start bis Ziel
  updateSpeedZone(dt) {
    const car = this.g.car;
    if (!this.speedz) {
      if (this.drift) return;
      for (const ev of this.list) {
        if (ev.type !== 'speed') continue;
        const d = Math.hypot(car.pos.x - ev.x, car.pos.z - ev.z);
        if (d > ev.hw + 6) continue;
        const fwd = Math.sin(car.yaw) * Math.sin(ev.yaw) + Math.cos(car.yaw) * Math.cos(ev.yaw);
        if (fwd < 0.3 || car.speedKmh < 20) continue;
        this.speedz = { ev, s: ev.s, end: ev.to * ev.path.length, t: 0 };
        this.g.hud.zone(ev.name, 'So schnell wie möglich bis zum Ziel!');
        this.g.audio.play('cp');
        ev.beacon.hidden = true;
        break;
      }
      return;
    }
    const z = this.speedz, ev = z.ev;
    z.t += dt;
    const c = ev.path.closest(car.pos.x, car.pos.z, z.s, 60);
    if (c.s > z.s - 30) z.s = Math.max(z.s, c.s);
    const done = z.s - ev.s, avg = z.t > 0.3 ? done / z.t * 3.6 : 0;
    this.g.hud.zoneScore(Math.round(avg), ev.stars, ` km/h · noch ${Math.max(0, Math.round(z.end - z.s))} m`);
    const finished = z.s >= z.end - 3, failed = c.dist > 40 || z.t > 150;
    if (finished || failed) {
      this.g.hud.zone(null);
      ev.beacon.hidden = false;
      this.speedz = null;
      if (failed) { this.g.hud.toast('Tempozone verlassen – nochmal von vorn', 'warn'); return; }
      const kmh = Math.round((z.end - ev.s) / z.t * 3.6);
      const stars = ev.stars.filter(v => kmh >= v).length;
      const rec = this.g.save.best[ev.id] || 0;
      if (kmh > rec) this.g.save.best[ev.id] = kmh;
      this.g.hud.banner(ev.name, `Schnitt ${kmh} km/h`, stars, kmh > rec && rec ? 'Neuer Rekord!' : '');
      this.giveStars(ev, stars);
    }
  }

  // ---------- Blitzer
  updateTraps(dt) {
    const car = this.g.car;
    for (const ev of this.list) {
      if (ev.type !== 'trap') continue;
      const c = this.trapCool.get(ev.id) || 0;
      if (c > 0) { this.trapCool.set(ev.id, c - dt); continue; }
      const p = ev.path.at(ev.s, P);
      const dx = car.pos.x - p.x, dz = car.pos.z - p.z;
      const along = dx * p.tx + dz * p.tz, lat = Math.abs(-dx * p.tz + dz * p.tx);
      const prev = ev._along ?? along;
      ev._along = along;
      if (lat < ev.hw + 8 && Math.abs(along) < 30 && Math.sign(prev) !== Math.sign(along) && prev !== along) {
        this.trapCool.set(ev.id, 3);
        this.g.eco.track('trap', 1);
        const kmh = Math.round(this.g.car.speedKmh);
        const stars = ev.stars.filter(s => kmh >= s).length;
        this.g.audio.play('trap');
        const rec = this.g.save.best[ev.id] || 0;
        const isBest = kmh > rec;
        if (isBest) this.g.save.best[ev.id] = kmh;
        this.g.hud.banner(ev.name, `${kmh} km/h`, stars, isBest && rec ? 'Neuer Rekord!' : '');
        this.giveStars(ev, stars);
      }
    }
  }
  giveStars(ev, stars) {
    const had = this.g.save.stars[ev.id] || 0;
    if (stars > had) {
      this.g.save.stars[ev.id] = stars;
      const n = stars - had;
      this.g.reward(n * 1500, n * 400, true);
    }
    this.g.saveGame();
  }

  // ---------- Driftzone
  updateDrift(dt) {
    const car = this.g.car;
    if (!this.drift) {
      for (const ev of this.list) {
        if (ev.type !== 'drift') continue;
        const d = Math.hypot(car.pos.x - ev.x, car.pos.z - ev.z);
        if (d > ev.hw + 6) continue;
        const fwd = Math.sin(car.yaw) * Math.sin(ev.yaw) + Math.cos(car.yaw) * Math.cos(ev.yaw);
        if (fwd < 0.3 || car.speedKmh < 15) continue;
        this.drift = { ev, s: ev.s, end: ev.to * ev.path.length, score: 0, live: 0, t: 0 };
        this.g.hud.zone(ev.name, 'Drifte so viel du kannst!');
        this.g.audio.play('cp');
        ev.beacon.hidden = true;
        break;
      }
      return;
    }
    const z = this.drift, ev = z.ev;
    z.t += dt;
    const c = ev.path.closest(car.pos.x, car.pos.z, z.s, 50);
    if (c.s > z.s - 30) z.s = Math.max(z.s, c.s);
    const total = z.score + z.live;
    this.g.hud.zoneScore(total, ev.stars);
    if (z.s >= z.end - 3 || c.dist > 45 || z.t > 90) {
      const stars = ev.stars.filter(s => total >= s).length;
      const rec = this.g.save.best[ev.id] || 0;
      if (total > rec) this.g.save.best[ev.id] = Math.round(total);
      this.g.hud.zone(null);
      this.g.hud.banner(ev.name, `${fmtNum(total)} Punkte`, stars, total > rec && rec ? 'Neuer Rekord!' : '');
      this.giveStars(ev, stars);
      ev.beacon.hidden = false;
      this.drift = null;
    }
  }

  // ---------- Schanzen
  updateJump(dt) {
    const car = this.g.car;
    if (!this.jump) {
      if (car.grounded) return;
      for (const ev of this.list) {
        if (ev.type !== 'jump') continue;
        const ex = ev.x + Math.sin(ev.yaw) * 8, ez = ev.z + Math.cos(ev.yaw) * 8;
        if (Math.hypot(car.pos.x - ex, car.pos.z - ez) < 9) { this.jump = { ev, x: car.pos.x, z: car.pos.z, n: car.landCount || 0, t: 0 }; break; }
      }
      return;
    }
    const j = this.jump;
    j.t += dt;
    if ((car.landCount || 0) !== j.n) {
      const ev = j.ev;
      const d = Math.round(Math.hypot(car.pos.x - j.x, car.pos.z - j.z));
      const stars = ev.stars.filter(s => d >= s).length;
      const rec = this.g.save.best[ev.id] || 0;
      if (d > rec) this.g.save.best[ev.id] = d;
      this.g.hud.banner(ev.name, `${d} m`, stars, d > rec && rec ? 'Neuer Rekord!' : '');
      this.giveStars(ev, stars);
      this.jump = null;
    } else if (j.t > 8) this.jump = null;
  }

  // ---------------------------------------------------------------- Rennen
  // opts.mp: Mehrspieler-Start {ai, ids, seed} – vom Mitspieler empfangen oder hier erzeugt und an den Raum gesendet
  startRace(ev, ghost = null, opts = {}) {
    const g = this.g, W = g.world;
    this.cancelSide();
    let mp = opts.mp || null;
    const champ = opts.champ || null; // Meisterschaft: feste Gegner (Name/Auto) über alle Rennen der Serie
    if (!mp && !ghost && !champ && g.net && g.net.active) mp = g.net.sendRace(ev, !!g.settings.mpAI);
    const path = ev.path, st = g.car.stats;
    const sprint = !!ev.sprint;
    // Startaufstellung (2 Autos pro Reihe, 10 m Abstand) muss auf der Straße stehen: beginnt ein Sprint am
    // Straßenanfang, rückt die Startlinie nach vorn (vorher klemmten alle hinteren Reihen auf denselben Punkt)
    const nAI = mp ? mp.ai : g.quality === 0 ? Math.min(ev.ai, 5) : ev.ai;
    const gridLen = 10 + Math.ceil((nAI + (mp ? mp.ids.length : 1)) / 2) * 10 + 4;
    const startS = !path.closed && ev.s < gridLen ? gridLen : ev.s;
    const total = sprint ? (ev.to - ev.at) * path.length - 12 - (startS - ev.s) : ev.laps * path.length;
    const wet = W.rain > 0.4 ? (W.rain - 0.4) / 0.6 : 0;
    const latAcc = 9.81 * st.grip * 1.16 * (1 - 0.15 * wet);
    const top = st.top / 3.6;
    const prof = speedProfile(path, top * 0.99, latAcc, 12.5, W, st.offroad);
    const race = {
      ev, path, prof, total, hw: ev.hw, world: W, dirt: !!ev.dirt, top, accel: st.accel * 0.95,
      startS, t: -3.6 - INTRO, t0: -3.6 - INTRO, started: false, ais: [], cps: [], next: 0, prog: 0, pS: startS, lastPos: 0,
      ghostRec: [], ghost: null, ghostData: ghost, finished: false, finishT: 0, crashes: 0, laps: sprint ? 1 : ev.laps, missed: false,
      mp, humans: new Map(), wall0: performance.now() / 1000, champ,
    };
    for (let s = 160; s < total - 20; s += 170) race.cps.push(s);
    race.cps.push(total);
    // Gegner
    const diff = [0.88, 0.95, 1.0][mp ? 1 : g.settings.difficulty ?? 1]; // Mehrspieler: überall gleich stark
    const n = nAI;
    const rnd = mulberry32(mp ? mp.seed : champ ? champ.seed : Date.now() & 0xffff);
    const names = [...AI_NAMES].sort(() => rnd() - 0.5);
    const pool = champ && champ.pool.length ? champ.pool : CARS.filter(c => !ev.dirt || c.offroad > 0.2);
    for (let i = 0; i < n; i++) {
      const spec = pool[Math.floor(rnd() * pool.length)];
      const col = spec.colors[Math.floor(rnd() * spec.colors.length)];
      const skill = diff * (0.92 + (i / Math.max(1, n - 1)) * 0.1) * (0.985 + rnd() * 0.03);
      const ai = new RaceAI(g.scene, spec, col, names[i], skill);
      const pd = ai.model.userData.paintMat && ai.model.userData.paintMat.userData.dirt;
      if (pd && ev.dirt) pd.value = 0.35 + rnd() * 0.4;
      const row = Math.floor(i / 2), side = i % 2 ? 1 : -1;
      ai.s = startS - 10 - row * 10; ai.prog = -10 - row * 10;
      ai.lat = ai.latT = side * Math.min(2.8, ev.hw - 1.6); ai.lane = side * 0.6;
      ai.place(path, race);
      race.ais.push(ai);
    }
    // Spieler hinten (im Mehrspieler: jeder Mensch auf seinem eigenen Startplatz hinter der KI)
    const me = mp ? mp.ids.indexOf(g.net.id) : 0;
    const slot = n + (me < 0 ? mp.ids.length : me);
    const prow = Math.floor(slot / 2), pside = slot % 2 ? 1 : -1;
    const ps = startS - 10 - prow * 10;
    const pp = path.at(ps, P);
    const plat = pside * Math.min(2.8, ev.hw - 1.6);
    g.car.reset(pp.x - pp.tz * plat, pp.z + pp.tx * plat, Math.atan2(pp.tx, pp.tz));
    race.prog = -10 - prow * 10; race.pS = ps;
    race.field = n + (mp ? Math.max(mp.ids.length, me + 1) : 1);
    // Geist (nicht im Mehrspieler – da fahren echte Gegner)
    const gd = mp ? null : ghost || g.loadGhost(ev.id);
    if (gd) {
      race.ghost = { data: gd, model: makeGhostModel(gd.car, gd.color) };
      g.scene.add(race.ghost.model);
    }
    for (const e of this.list) if (e.beacon) e.beacon.hidden = true;
    g.traffic.active = false;
    this.race = race;
    g.tm.clear();
    g.hud.prompt(null);
    g.hud.raceStart(race);
    g.setState('race');
    if (g.tutEvent) g.tutEvent('race');
    this.updateGates();
  }

  cancelSide() {
    if (this.drift) { this.drift.ev.beacon.hidden = false; this.g.hud.zone(null); }
    if (this.speedz) { this.speedz.ev.beacon.hidden = false; this.g.hud.zone(null); }
    this.drift = null; this.jump = null; this.speedz = null;
  }

  endRace(aborted) {
    const g = this.g, r = this.race;
    if (!r) return;
    for (const ai of r.ais) ai.dispose(g.scene);
    if (g.raceLine) g.raceLine.hide();
    if (r.ghost) { g.scene.remove(r.ghost.model); r.ghost.model.traverse(o => { if (o.isMesh) o.material.dispose(); }); }
    for (const e of this.list) if (e.beacon) e.beacon.hidden = false;
    g.scenery.setGate(0, null); g.scenery.setGate(1, null);
    g.traffic.active = true;
    this.race = null;
    g.tm.clear();
    g.hud.raceEnd();
    if (aborted) g.setState('free');
  }

  updateGates() {
    const r = this.race, S = this.g.scenery;
    for (let k = 0; k < 2; k++) {
      const i = r.next + k;
      if (i >= r.cps.length || r.finished) { S.setGate(k, null); continue; }
      const p = r.path.at(r.startS + r.cps[i], P);
      S.setGate(k, p.x, p.z, this.g.world.heightAt(p.x, p.z), p.tx, p.tz, r.hw * 2 + 3, i === r.cps.length - 1);
    }
  }

  updateRace(dt) {
    const g = this.g, r = this.race, car = g.car;
    // Mehrspieler: Uhr läuft nach Wanduhr weiter (auch in der Pause) – alle Geräte zählen gleich
    if (r.mp) r.t = r.t0 + (performance.now() / 1000 - r.wall0);
    else r.t += dt;
    if (!r.started && r.t >= 0) { r.started = true; g.audio.play('go'); g.hud.countdown('LOS!'); }
    else if (!r.started) {
      const n = Math.ceil(-r.t);
      if (n !== r.lastCount && n <= 3) { r.lastCount = n; g.audio.play('count'); g.hud.countdown(String(n)); }
    }
    // Fortschritt des Spielers
    const c = r.path.closest(car.pos.x, car.pos.z, r.pS, 70);
    let ds = c.s - r.pS;
    if (r.path.closed) { if (ds > r.path.length / 2) ds -= r.path.length; if (ds < -r.path.length / 2) ds += r.path.length; }
    if (Math.abs(ds) < 60) { r.pS = c.s; r.prog += ds; }
    const cp = r.cps[r.next];
    if (!r.finished && r.prog >= cp - 3) {
      if (c.dist < r.hw + 20 || r.ev.road === 'quer' && c.dist < 34) {
        r.next++;
        r.missed = false;
        g.audio.play('cp');
        if (r.next >= r.cps.length) this.finish();
        else {
          const lapLen = r.path.length;
          if (!r.ev.sprint && Math.floor((cp + 1) / lapLen) > Math.floor((r.cps[r.next - 2] || 0) / lapLen)) {
            const lap = Math.floor(cp / lapLen) + 1;
            if (lap < r.laps + 1 && lap >= 1 && Math.abs(cp - lap * lapLen) < 200) g.hud.toast(lap === r.laps - 1 ? 'Letzte Runde!' : `Runde ${lap + 1}/${r.laps}`, 'info');
          }
        }
        this.updateGates();
      } else if (r.prog > cp + 25 && !r.missed) { r.missed = true; g.hud.toast('Checkpoint verpasst – zurück!', 'warn'); }
    }
    // Gegner
    const others = [{ prog: r.prog, lat: c.lat, speed: Math.abs(car.vf), self: true }, ...r.ais];
    for (const ai of r.ais) {
      ai.update(dt, r, others, r.prog, r.started);
      if (!ai.done && ai.prog >= r.total) { ai.done = true; ai.finish = r.t; }
    }
    if (r.started) separateAIs(r);
    // Geist
    if (r.started && !r.finished) {
      r.recT = (r.recT || 0) + dt;
      if (r.recT >= 0.1) { r.recT -= 0.1; r.ghostRec.push([car.pos.x, car.pos.z, car.yaw]); }
    }
    if (r.ghost) placeGhost(r.ghost, Math.max(0, r.t), g.world);
    // Mitspieler im selben Rennen (Fortschritt und Zielzeit melden sie selbst)
    if (r.mp && g.net) for (const p of g.net.racers(r.ev.id)) {
      const h = r.humans.get(p.id) || { id: p.id };
      h.name = p.name; h.spec = p.spec; h.prog = p.race.prog; if (p.race.fin) h.fin = p.race.fin;
      r.humans.set(p.id, h);
    }
    if (r.mp) r.field = Math.max(r.field, r.ais.length + 1 + r.humans.size);
    // Platzierung
    let rank = 1 + r.ais.filter(a => (a.done && (!r.finished || a.finish < r.finishT)) || (!a.done && !r.finished && a.prog > r.prog)).length;
    for (const h of r.humans.values()) if ((h.fin && (!r.finished || h.fin < r.finishT)) || (!h.fin && !r.finished && h.prog > r.prog)) rank++;
    if (r.lastRank && rank < r.lastRank && r.started && !r.finished) g.skills.add('Überholt', 220 * (r.lastRank - rank));
    r.lastRank = rank; r.rank = rank;
    // Abstand zum Fahrer davor/dahinter in Sekunden (bei aktuellem Tempo), 4× pro Sekunde
    r.gapT = (r.gapT || 0) - dt;
    if (r.gapT <= 0 && r.started && !r.finished) {
      r.gapT = 0.25;
      let ah = null, be = null;
      const all = [...r.ais.filter(a => !a.done).map(a => ({ name: a.name, prog: a.prog })), ...[...r.humans.values()].filter(h => !h.fin).map(h => ({ name: h.name, prog: h.prog }))];
      for (const o of all) {
        if (o.prog > r.prog && (!ah || o.prog < ah.prog)) ah = o;
        if (o.prog <= r.prog && (!be || o.prog > be.prog)) be = o;
      }
      const v = Math.max(12, Math.abs(car.vf)), f = d => (d / v).toFixed(1).replace('.', ',') + ' s';
      g.hud.raceGap((ah ? `▲ ${ah.name} ${f(ah.prog - r.prog)}` : '') + (ah && be ? ' · ' : '') + (be ? `▼ ${be.name} ${f(r.prog - be.prog)}` : ''));
    } else if (r.finished && r.gapT > -1) { r.gapT = -9; g.hud.raceGap(''); }
    const lap = r.ev.sprint ? 1 : clamp(Math.floor(Math.max(0, r.prog) / r.path.length) + 1, 1, r.laps);
    g.hud.raceInfo(r, rank, lap);
    if (r.finished) {
      r.after += dt;
      if (r.after > 3.5 && !r.shown && (r.replayDone || r.after > 40)) { r.shown = true; this.results(); }
    }
  }

  finish() {
    const g = this.g, r = this.race;
    r.finished = true; r.finishT = r.t; r.after = 0;
    g.audio.play('win');
    g.hud.countdown(r.rank === 1 ? 'SIEG!' : `${r.rank}. PLATZ`);
    g.confetti();
  }

  results() {
    const g = this.g, r = this.race, ev = r.ev;
    // Zeiten der Gegner schätzen
    const rows = [{ name: g.settings.name || 'Du', time: r.finishT, me: true, car: g.carSpec() }];
    for (const ai of r.ais) {
      let t = ai.finish;
      if (!isFinite(t)) t = r.t + Math.max(0, r.total - ai.prog) / Math.max(8, ai.speed * 0.95);
      rows.push({ name: ai.name, time: t, car: ai.spec });
    }
    for (const h of r.humans.values()) rows.push({ name: h.name, time: h.fin || Infinity, live: !h.fin, human: true, car: h.spec });
    rows.sort((a, b) => (a.time === b.time ? 0 : a.time - b.time));
    const pos = rows.findIndex(x => x.me) + 1;
    // Meisterschaft: Punkte nach Platz eintragen
    let champRes = null;
    if (r.champ && !r.champ.counted) {
      r.champ.counted = true;
      champRes = g.champAfterRace(rows.map((x, i) => ({ name: x.me ? null : x.name, me: !!x.me, pts: CHAMP_POINTS[i] || 0 })));
    }
    const pay = g.eco.racePayout(ev, pos, r.crashes, g.settings.difficulty);
    const cr = pay.total, fans = pay.fans;
    const best = g.save.best[ev.id];
    const isBest = !best || r.finishT < best;
    if (isBest) { g.save.best[ev.id] = r.finishT; g.saveGhost(ev.id, r.ghostRec, r.finishT); }
    const stars = pos === 1 ? 3 : pos <= 3 ? 2 : 1;
    g.save.stats.races++;
    if (g.tutEvent) g.tutEvent('finish');
    if (pos === 1) g.save.stats.wins++;
    const had = g.save.stars[ev.id] || 0;
    if (stars > had) g.save.stars[ev.id] = stars;
    if (stars === 3 && had < 3) g.eco.addSpin('3 Sterne: ' + ev.name);
    g.reward(cr, fans, false);
    g.eco.track('race', 1);
    if (pos === 1) g.eco.track('win', 1);
    g.saveGame();
    let challenge = null;
    if (r.ghostData && r.ghostData.name) challenge = { name: r.ghostData.name, time: r.ghostData.time, won: r.finishT < r.ghostData.time };
    g.hud.showResults({ ev, rows, pos, cr, fans, time: r.finishT, isBest, best, challenge, ghost: r.ghostRec, lines: pay.lines, champ: champRes });
  }
}

// ---------------------------------------------------------------- KI untereinander: nicht durcheinander fahren
// Überlappen sich zwei Gegner, weicht der hintere sanft zur Seite aus (oder der vordere, wenn dort Platz ist);
// ist die Straße zu schmal, bleibt der hintere dahinter. Längs-/Querabstand in Strecken-Koordinaten (prog/lat).
const SEP_LEN = 4.4, SEP_LAT = 1.9; // Fahrzeuglänge/-breite
function separateAIs(r) {
  const A = r.ais;
  for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) {
    const a = A[i], b = A[j];
    if (a.done || b.done) continue;
    const ds = b.prog - a.prog;
    if (Math.abs(ds) >= SEP_LEN || Math.abs(b.lat - a.lat) >= SEP_LAT) continue;
    // Karosserien berühren sich trotz Ausweichen → der hintere reiht sich dahinter ein
    const back = ds >= 0 ? a : b, front = ds >= 0 ? b : a, gap = SEP_LEN - Math.abs(ds);
    back.prog -= gap; back.s -= gap; back.speed = Math.min(back.speed, front.speed);
    back.place(r.path, r);
  }
}

// ---------------------------------------------------------------- Geist
function makeGhostModel(carId, color) {
  const spec = CARS.find(c => c.id === carId) || CARS[0];
  const m = buildCar(spec, color || '#8af', { lod: true });
  if (m.userData.paintMat) m.userData.paintMat.dispose(); // wird unten durch durchsichtige Kopien ersetzt
  m.traverse(o => {
    if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.38; o.material.depthWrite = false; o.castShadow = false; }
  });
  return m;
}
function placeGhost(gh, t, W) {
  const rate = gh.data.rate || 10, d = gh.data.pts, i = t * rate;
  const a = Math.min(d.length - 1, Math.floor(i)), b = Math.min(d.length - 1, a + 1), f = i - Math.floor(i);
  if (!d.length) return;
  const x = d[a][0] + (d[b][0] - d[a][0]) * f, z = d[a][1] + (d[b][1] - d[a][1]) * f;
  let dy = d[b][2] - d[a][2]; if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
  gh.model.position.set(x, W.heightAt(x, z), z);
  gh.model.rotation.y = d[a][2] + dy * f;
  gh.model.visible = i < d.length + rate * 2;
}
export { separateAIs as __separateAIs }; // für Tests
