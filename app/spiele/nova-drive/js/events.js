// Events auf der Insel: Rennen, Blitzer, Driftzonen, Schanzen, Plakate – und die Skill-Kette.
import * as THREE from '../lib/three.module.min.js';
import { EVENTS, CARS } from './data.js';
import { clamp, fmtTime, fmtNum, mulberry32 } from './util.js';
import { RaceAI, speedProfile } from './ai.js';
import { EVENT_COLORS } from './world.js';
import { buildCar } from './carmodel.js';

const ICONS = { race: '🏁', trap: '📷', drift: '〰', jump: '⚠' };
const P = {};
export const TYPE_NAMES = { race: 'Rennen', trap: 'Blitzer', drift: 'Driftzone', jump: 'Sprungschanze' };
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
    this.race = null; this.drift = null; this.jump = null;
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
    this.updateJump(dt);
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
  startRace(ev, ghost = null) {
    const g = this.g, W = g.world;
    this.cancelSide();
    const path = ev.path, st = g.car.stats;
    const sprint = !!ev.sprint;
    const total = sprint ? (ev.to - ev.at) * path.length - 12 : ev.laps * path.length;
    const latAcc = 9.81 * st.grip * 1.16;
    const top = st.top / 3.6;
    const prof = speedProfile(path, top * 0.99, latAcc, 12.5, W, st.offroad);
    const race = {
      ev, path, prof, total, hw: ev.hw, world: W, dirt: !!ev.dirt, top, accel: st.accel * 0.95,
      startS: ev.s, t: -3.6, started: false, ais: [], cps: [], next: 0, prog: 0, pS: ev.s, lastPos: 0,
      ghostRec: [], ghost: null, ghostData: ghost, finished: false, finishT: 0, crashes: 0, laps: sprint ? 1 : ev.laps, missed: false,
    };
    for (let s = 160; s < total - 20; s += 170) race.cps.push(s);
    race.cps.push(total);
    // Gegner
    const diff = [0.88, 0.95, 1.0][g.settings.difficulty ?? 1];
    const n = g.quality === 0 ? Math.min(ev.ai, 5) : ev.ai;
    const rnd = mulberry32(Date.now() & 0xffff);
    const names = [...AI_NAMES].sort(() => rnd() - 0.5);
    const pool = CARS.filter(c => !ev.dirt || c.offroad > 0.2);
    for (let i = 0; i < n; i++) {
      const spec = pool[Math.floor(rnd() * pool.length)];
      const col = spec.colors[Math.floor(rnd() * spec.colors.length)];
      const skill = diff * (0.92 + (i / Math.max(1, n - 1)) * 0.1) * (0.985 + rnd() * 0.03);
      const ai = new RaceAI(g.scene, spec, col, names[i], skill);
      const row = Math.floor(i / 2), side = i % 2 ? 1 : -1;
      ai.s = ev.s - 10 - row * 10; ai.prog = -10 - row * 10;
      ai.lat = ai.latT = side * Math.min(2.8, ev.hw - 1.6); ai.lane = side * 0.6;
      ai.place(path, race);
      race.ais.push(ai);
    }
    // Spieler hinten
    const prow = Math.floor(n / 2), pside = n % 2 ? 1 : -1;
    const ps = ev.s - 10 - prow * 10;
    const pp = path.at(ps, P);
    const plat = pside * Math.min(2.8, ev.hw - 1.6);
    g.car.reset(pp.x - pp.tz * plat, pp.z + pp.tx * plat, Math.atan2(pp.tx, pp.tz));
    race.prog = -10 - prow * 10; race.pS = ps;
    // Geist
    const gd = ghost || g.loadGhost(ev.id);
    if (gd) {
      race.ghost = { data: gd, model: makeGhostModel(gd.car, gd.color) };
      g.scene.add(race.ghost.model);
    }
    for (const e of this.list) if (e.beacon) e.beacon.hidden = true;
    g.traffic.active = false;
    this.race = race;
    g.hud.prompt(null);
    g.hud.raceStart(race);
    g.setState('race');
    this.updateGates();
  }

  cancelSide() { if (this.drift) { this.drift.ev.beacon.hidden = false; this.g.hud.zone(null); } this.drift = null; this.jump = null; }

  endRace(aborted) {
    const g = this.g, r = this.race;
    if (!r) return;
    for (const ai of r.ais) ai.dispose(g.scene);
    if (r.ghost) g.scene.remove(r.ghost.model);
    for (const e of this.list) if (e.beacon) e.beacon.hidden = false;
    g.scenery.setGate(0, null); g.scenery.setGate(1, null);
    g.traffic.active = true;
    this.race = null;
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
    r.t += dt;
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
    // Geist
    if (r.started && !r.finished) {
      r.recT = (r.recT || 0) + dt;
      if (r.recT >= 0.1) { r.recT -= 0.1; r.ghostRec.push([car.pos.x, car.pos.z, car.yaw]); }
    }
    if (r.ghost) placeGhost(r.ghost, Math.max(0, r.t), g.world);
    // Platzierung
    const rank = 1 + r.ais.filter(a => (a.done && (!r.finished || a.finish < r.finishT)) || (!a.done && !r.finished && a.prog > r.prog)).length;
    if (r.lastRank && rank < r.lastRank && r.started && !r.finished) g.skills.add('Überholt', 220 * (r.lastRank - rank));
    r.lastRank = rank; r.rank = rank;
    const lap = r.ev.sprint ? 1 : clamp(Math.floor(Math.max(0, r.prog) / r.path.length) + 1, 1, r.laps);
    g.hud.raceInfo(r, rank, lap);
    if (r.finished) {
      r.after += dt;
      if (r.after > 3.5 && !r.shown) { r.shown = true; this.results(); }
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
    rows.sort((a, b) => a.time - b.time);
    const pos = rows.findIndex(x => x.me) + 1;
    const pay = g.eco.racePayout(ev, pos, r.crashes, g.settings.difficulty);
    const cr = pay.total, fans = pay.fans;
    const best = g.save.best[ev.id];
    const isBest = !best || r.finishT < best;
    if (isBest) { g.save.best[ev.id] = r.finishT; g.saveGhost(ev.id, r.ghostRec, r.finishT); }
    const stars = pos === 1 ? 3 : pos <= 3 ? 2 : 1;
    g.save.stats.races++;
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
    g.hud.showResults({ ev, rows, pos, cr, fans, time: r.finishT, isBest, best, challenge, ghost: r.ghostRec, lines: pay.lines });
  }
}

// ---------------------------------------------------------------- Geist
function makeGhostModel(carId, color) {
  const spec = CARS.find(c => c.id === carId) || CARS[0];
  const m = buildCar(spec, color || '#8af', { lod: true });
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
