// Gegner im Rennen (folgen der Ideallinie mit Tempo-Profil) und Verkehr auf der Insel.
import * as THREE from '../lib/three.module.min.js';
import { clamp, lerp, damp, mulberry32 } from './util.js';
import { buildCar, styleDims } from './carmodel.js';
import { SURF } from './terrain.js';

const P = {};

// Tempo-Profil entlang eines Pfades (m/s pro Punkt) aus Kurvenradius + Bremsweg
export function speedProfile(path, top, latAcc, brake, world, offroad) {
  const n = path.n, v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.abs(path.curv[i]);
    let s = Math.min(top, k > 1e-5 ? Math.sqrt(latAcc / k) : top);
    if (world) {
      const sf = world.surfaceAt(path.x[i], path.z[i]);
      if (sf !== SURF.ASPHALT) s *= lerp(0.72, 0.97, offroad);
      // Kuppen & Steigungen
      const a = path.idx(i - 4), b = path.idx(i + 4);
      const grade = (path.y[b] - path.y[a]) / (8 * path.ds);
      if (grade > 0.06) s *= 1 - Math.min(0.15, (grade - 0.06) * 1.2);
    }
    v[i] = s;
  }
  const reps = path.closed ? 2 : 1;
  for (let r = 0; r < reps; r++) {
    for (let i = n - 1; i >= 0; i--) {
      const j = path.closed ? (i + 1) % n : Math.min(i + 1, n - 1);
      v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * brake * path.ds));
    }
  }
  return v;
}

export class RaceAI {
  constructor(scene, spec, color, name, skill) {
    this.spec = spec; this.name = name; this.skill = skill;
    this.model = buildCar(spec, color, { lod: 'ai' });
    this.dims = styleDims(spec.style);
    this.half = (this.dims.L / 2 - this.dims.W / 2) * 0.85; this.rad = this.dims.W / 2 * 0.95;
    scene.add(this.model);
    this.pos = new THREE.Vector3(); this.yaw = 0; this.vx = 0; this.vz = 0;
    this.speed = 0; this.s = 0; this.prog = 0; this.lat = 0; this.latT = 0; this.lane = 0;
    this.done = false; this.finish = Infinity; this.bump = 0; this.wheelRot = 0; this.slide = 0;
  }
  dispose(scene) { scene.remove(this.model); }
  circles() {
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), h = this.half;
    return [[this.pos.x + sy * h, this.pos.z + cy * h], [this.pos.x - sy * h, this.pos.z - cy * h]];
  }

  // race: {path, prof, total, hw, startS}; others: alle Autos [{prog, lat, speed}]
  update(dt, race, others, playerProg, started) {
    const path = race.path;
    if (!started) { this.place(path, race); return; }
    if (this.done) { this.speed = Math.max(0, this.speed - 8 * dt); }
    const i = path.idx(Math.round(path.wrapS(this.s) / path.ds));
    let vT = race.prof[i] * this.skill;
    // Gummiband: weit vorne etwas langsamer, weit hinten etwas schneller
    const gap = this.prog - playerProg;
    vT *= clamp(1 - gap * 0.00035, 0.9, 1.07);
    // Windschatten / Hindernis vor mir
    let blocked = null;
    for (const o of others) {
      if (o === this) continue;
      const d = o.prog - this.prog;
      if (d > 0 && d < 16 && Math.abs(o.lat - this.lat) < 2.3) { if (!blocked || d < blocked.d) blocked = { o, d }; }
    }
    if (blocked) {
      if (blocked.o.speed < vT - 1) {
        // überholen: Seite mit mehr Platz
        const lim = race.hw - 1.4;
        const left = blocked.o.lat - 2.9, right = blocked.o.lat + 2.9;
        this.latT = (Math.abs(left) < lim && (Math.abs(right) >= lim || Math.abs(left - this.lat) < Math.abs(right - this.lat))) ? left : right;
        this.latT = clamp(this.latT, -lim, lim);
        if (blocked.d < 8) vT = Math.min(vT, blocked.o.speed + 1);
      }
      vT *= 1.02; // Windschatten
    } else {
      const ahead = path.at(this.s + 25, P);
      const ideal = clamp(ahead.curv * 260, -1, 1) * (race.hw - 1.8);
      this.latT = damp(this.latT, ideal + this.lane, 0.6, dt);
    }
    if (!this.done) {
      const top = race.top * this.skill;
      if (this.speed < vT) this.speed += race.accel * this.skill * Math.max(0.15, 1 - (this.speed / top) ** 2) * dt;
      else this.speed = Math.max(vT, this.speed - 16 * dt);
    }
    if (this.bump > 0) { this.bump -= dt; }
    this.speed = Math.max(0, this.speed);
    this.s += this.speed * dt;
    this.prog += this.speed * dt;
    this.lat = damp(this.lat, this.latT, 1.8, dt);
    this.lat = clamp(this.lat, -race.hw + 1, race.hw - 1);
    this.place(path, race);
  }

  place(path, race) {
    const p = path.at(this.s, P);
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x = p.x + -p.tz * this.lat;
    this.pos.z = p.z + p.tx * this.lat;
    this.pos.y = race.world.heightAt(this.pos.x, this.pos.z);
    const yawT = Math.atan2(p.tx, p.tz);
    this.slide = damp(this.slide, -p.curv * this.speed * 0.9 * (race.dirt ? 1.6 : 0.6), 3, 1 / 60);
    this.yaw = yawT + clamp(this.slide, -0.35, 0.35);
    this.vx = p.tx * this.speed; this.vz = p.tz * this.speed;
    this.ground = race.world;
    this.sync();
  }

  sync() {
    const m = this.model;
    m.position.copy(this.pos);
    m.rotation.set(0, this.yaw, 0);
    const W = this.ground;
    if (W) {
      const e = 1.6, gx = (W.heightAt(this.pos.x + e, this.pos.z) - W.heightAt(this.pos.x - e, this.pos.z)) / (2 * e);
      const gz = (W.heightAt(this.pos.x, this.pos.z + e) - W.heightAt(this.pos.x, this.pos.z - e)) / (2 * e);
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      const pitch = Math.atan(gx * sy + gz * cy), roll = Math.atan(-gx * cy + gz * sy);
      m.userData.bodyG.rotation.set(-pitch, 0, roll * 0.8);
    }
    this.wheelRot += this.speed / 0.35 / 60;
    for (const w of m.userData.wheels) { w.spin.rotation.x = this.wheelRot; if (w.front) w.pivot.rotation.y = clamp(this.slide * -1.5, -0.4, 0.4); }
  }
}

// ---------------------------------------------------------------- Verkehr
const TRAFFIC_STYLES = [
  { style: 'hatch', colors: ['#c0392b', '#2980b9', '#ecf0f1', '#7f8c8d', '#27ae60', '#f1c40f'] },
  { style: 'truck', colors: ['#34495e', '#d35400', '#ecf0f1', '#16a085'] },
  { style: 'ev', colors: ['#ecf0f1', '#2c3e50', '#8e44ad'] },
  { style: 'muscle', colors: ['#c0392b', '#2c3e50', '#f39c12'] },
];

export class Traffic {
  constructor(scene, world, count) {
    this.world = world; this.cars = [];
    const rnd = mulberry32(77);
    this.rnd = rnd;
    const roads = world.roads.filter(r => r.def.type === 'asphalt' && r.id !== 'festival');
    this.roads = roads;
    this.prof = new Map();
    for (const r of roads) this.prof.set(r.id, speedProfile(r.path, 22, 3.2, 3, null, 1));
    for (let i = 0; i < count; i++) {
      const T = TRAFFIC_STYLES[i % TRAFFIC_STYLES.length];
      const model = buildCar({ style: T.style }, T.colors[Math.floor(rnd() * T.colors.length)], { lod: true });
      scene.add(model);
      const d = styleDims(T.style);
      const c = { model, road: null, s: 0, dir: 1, speed: 15, cruise: 14 + rnd() * 8, pos: new THREE.Vector3(), yaw: 0, half: (d.L / 2 - d.W / 2) * 0.85, rad: d.W / 2 * 0.95, vx: 0, vz: 0, hit: 0, lat: 0 };
      this.cars.push(c);
    }
    this.active = true;
  }
  circles(c) {
    const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw), h = c.half;
    return [[c.pos.x + sy * h, c.pos.z + cy * h], [c.pos.x - sy * h, c.pos.z - cy * h]];
  }
  spawn(c, px, pz, far) {
    // auf einer Straße in 150–450 m Entfernung zum Spieler
    for (let t = 0; t < 30; t++) {
      const r = this.roads[Math.floor(this.rnd() * this.roads.length)];
      const s = this.rnd() * r.path.length;
      const p = r.path.at(s, P);
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d < (far ? 160 : 40) || d > 480) continue;
      c.road = r; c.s = s; c.dir = this.rnd() < 0.5 ? 1 : -1; c.speed = c.cruise;
      c.lat = c.dir * r.def.hw * 0.42;
      this.place(c);
      c.model.visible = true;
      return;
    }
    c.model.visible = false; c.road = null;
  }
  place(c) {
    const p = c.road.path.at(c.s, P);
    c.pos.set(p.x - p.tz * c.lat, 0, p.z + p.tx * c.lat);
    c.pos.y = this.world.heightAt(c.pos.x, c.pos.z);
    c.yaw = Math.atan2(p.tx * c.dir, p.tz * c.dir);
    c.vx = p.tx * c.dir * c.speed; c.vz = p.tz * c.dir * c.speed;
    c.model.position.copy(c.pos);
    c.model.rotation.y = c.yaw;
  }
  update(dt, player) {
    if (!this.active) { for (const c of this.cars) c.model.visible = false; return; }
    for (const c of this.cars) {
      if (!c.road) { this.spawn(c, player.pos.x, player.pos.z, false); continue; }
      const d = Math.hypot(c.pos.x - player.pos.x, c.pos.z - player.pos.z);
      if (d > 560) { this.spawn(c, player.pos.x, player.pos.z, true); continue; }
      const path = c.road.path, prof = this.prof.get(c.road.id);
      const i = path.idx(Math.round(path.wrapS(c.s) / path.ds));
      let vT = Math.min(c.cruise, prof[i]);
      // Abstand zum Vordermann (gleiche Spur) und zum Spieler
      for (const o of this.cars) {
        if (o === c || o.road !== c.road || o.dir !== c.dir) continue;
        const ds = (o.s - c.s) * c.dir;
        if (ds > 0 && ds < 22) vT = Math.min(vT, o.speed * (ds < 10 ? 0.6 : 0.95));
      }
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      const dx = player.pos.x - c.pos.x, dz = player.pos.z - c.pos.z;
      const ahead = dx * fx + dz * fz, side = Math.abs(-dx * fz + dz * fx);
      if (ahead > 0 && ahead < 18 && side < 2.6) vT = Math.min(vT, ahead < 8 ? 0 : 6);
      if (c.hit > 0) { c.hit -= dt; vT = 0; }
      c.speed = c.speed < vT ? Math.min(vT, c.speed + 3 * dt) : Math.max(vT, c.speed - 9 * dt);
      c.s += c.speed * c.dir * dt;
      if (!path.closed && (c.s < 2 || c.s > path.length - 2)) { c.dir = -c.dir; c.lat = -c.lat; c.s = clamp(c.s, 2, path.length - 2); }
      c.s = path.wrapS(c.s);
      this.place(c);
    }
  }
}
