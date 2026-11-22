// Gegner im Rennen (echte Fahrphysik mit Fahrer-Programm) und Verkehr auf der Insel.
import * as THREE from '../lib/three.module.min.js';
import { clamp, lerp, damp, mulberry32 } from './util.js';
import { buildCar, styleDims, disposeCar } from './carmodel.js';
import { SURF } from './terrain.js';
import { Vehicle } from './physics.js';
import { carStats } from './data.js';

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

// Gegner im Rennen: echtes Fahrzeug mit derselben Physik wie der Spieler (eigene Autowerte), gesteuert von einem
// Fahrer-Programm: Gas/Bremse nach Kurvenprofil des eigenen Autos, Lenken auf eine Ziellinie vor dem Auto,
// Überholen/Ausweichen, kleine Fehler je nach Können, Zurücksetzen nach Abflug. Lässt sich schieben und drehen.
const AI_H = 1 / 60; // Physik-Schritt der Gegner (60 Hz reicht und spart Rechenzeit)
export class RaceAI {
  constructor(scene, spec, color, name, skill, world, opts = {}) {
    this.spec = spec; this.name = name; this.skill = skill;
    this.model = buildCar(spec, color, { lod: 'ai' });
    this.dims = styleDims(spec.style);
    this.stats = carStats(spec, opts.up || {});
    this.veh = new Vehicle(world, this.stats, this.dims);
    this.half = this.veh.half; this.rad = this.veh.rad;
    scene.add(this.model);
    this.pos = this.veh.pos;
    this.s = 0; this.prog = 0; this.lat = 0; this.latT = 0; this.lane = 0;
    this.done = false; this.finish = Infinity; this.acc = 0;
    // Persönlichkeit: wie spät gebremst wird, wie unruhig gelenkt wird, wie oft Fehler passieren
    const r = opts.rnd || Math.random;
    this.brakeK = 0.9 + 0.08 * r();           // Anteil der echten Bremsleistung, mit der geplant wird
    this.noiseA = (1.15 - skill) * 0.9 * (0.6 + r() * 0.8);
    this.noiseP = r() * 10; this.mistake = 0; this.mistakeCool = 4 + r() * 8;
    this.stuckT = 0; this.offT = 0; this.prof = null;
  }
  get yaw() { return this.veh.yaw; }
  get vx() { return this.veh.vel.x; }
  get vz() { return this.veh.vel.z; }
  get speed() { return Math.max(0, this.veh.vf); }
  dispose(scene) { scene.remove(this.model); disposeCar(this.model); }
  circles() { return this.veh.circles(); }
  // eigenes Tempo-Profil (aus den Werten des eigenen Autos) einmal pro Rennen
  setup(race) {
    const st = this.stats, W = race.world, wet = W.rain > 0.4 ? (W.rain - 0.4) / 0.6 : 0;
    const latAcc = 9.81 * st.grip * 1.12 * (1 - 0.15 * wet), brake = 9.81 * (1.0 + 0.55 * st.grip) * this.brakeK * 0.88;
    this.prof = speedProfile(race.path, st.top / 3.6 * 0.99, latAcc, brake, W, st.offroad);
  }
  // auf die Strecke setzen (Startaufstellung, Zurücksetzen): bei s mit Seitenversatz lat, Blick in Fahrtrichtung
  place(path, race, speed = 0) {
    if (!this.prof) this.setup(race);
    const p = path.at(this.s, P), x = p.x - p.tz * this.lat, z = p.z + p.tx * this.lat;
    this.veh.reset(x, z, Math.atan2(p.tx, p.tz));
    this.veh.vel.set(p.tx * speed, 0, p.tz * speed);
    this.sync(0);
  }
  // Steuer-Eingaben aus Strecke, Profil und Gegnern
  drive(dt, race, others, playerProg) {
    const path = race.path, v = this.veh, sp = Math.max(0, v.vf);
    const at = d => this.prof[path.idx(Math.round(path.wrapS(this.s + d) / path.ds))];
    // Zieltempo: Profil kurz voraus (Reaktion), × Können; weit vorne etwas Gas weg (nie schneller als das Auto kann)
    let vT = Math.min(at(2 + sp * 0.2), at(6 + sp * 0.35)) * this.skill;
    const gap = this.prog - playerProg;
    if (gap > 60) vT *= clamp(1 - (gap - 60) * 0.0003, 0.94, 1);
    if (this.mistake > 0) vT *= 1.12; // Verbremser: zu schnell in die Kurve
    // Ziellinie: Ideallinie (Kurveninnenseite) + eigene Spur; vor langsameren Autos zur Seite (überholen)
    let blocked = null;
    for (const o of others) {
      if (o === this) continue;
      const d = o.prog - this.prog;
      if (d > 0 && d < 18 && Math.abs(o.lat - this.lat) < 2.4) { if (!blocked || d < blocked.d) blocked = { o, d }; }
    }
    const lim = race.hw - 1.4;
    if (blocked && (blocked.o.speed || 0) < sp + 0.5) {
      const left = blocked.o.lat - 3, right = blocked.o.lat + 3;
      this.latT = (Math.abs(left) < lim && (Math.abs(right) >= lim || Math.abs(left - this.lat) < Math.abs(right - this.lat))) ? left : right;
      if (blocked.d < 9 && Math.abs(this.lat - blocked.o.lat) < 2) vT = Math.min(vT, (blocked.o.speed || 0) + 0.5);
    } else {
      const ahead = path.at(this.s + 25, P);
      this.latT = damp(this.latT, clamp(ahead.curv * 260, -1, 1) * (race.hw - 1.8) + this.lane, 0.8, dt);
    }
    // Nachbarn daneben: nicht hineinlenken
    for (const o of others) {
      if (o === this || o.done) continue;
      const d = o.prog - this.prog, dl = this.lat - o.lat;
      if (Math.abs(d) < 6 && Math.abs(dl) < 2.6) this.latT += (Math.sign(dl) || 1) * (2.6 - Math.abs(dl)) * 0.6;
    }
    this.latT = clamp(this.latT, -lim, lim);
    // Lenken: Punkt voraus auf der Ziellinie anpeilen, Gierrate dämpft; dazu etwas Unruhe je nach Können
    const L = 7 + sp * 0.42, q = path.at(this.s + L, P);
    const tx = q.x - q.tz * this.latT - v.pos.x, tz = q.z + q.tx * this.latT - v.pos.z;
    let err = Math.atan2(tx, tz) - v.yaw; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
    const noise = Math.sin(race.t * 1.7 + this.noiseP) * this.noiseA * 0.05;
    const steer = clamp(-(err + noise) * 2.4 + v.yawRate * 0.12, -1, 1);
    // Gas/Bremse
    let throttle = 0, brake = 0;
    const e = vT - sp;
    if (e > 0.6) throttle = clamp(e / 3, 0.4, 1);
    else if (e < -0.8) brake = clamp(-e / 4.5, 0.25, 1);
    else throttle = 0.3;
    if (Math.abs(err) > 0.6 && sp > 12) { throttle *= 0.4; } // quer zur Strecke → Gas weg
    return { throttle, brake, steer, handbrake: false, nitro: false, direct: true };
  }
  update(dt, race, others, playerProg, started) {
    const path = race.path, v = this.veh;
    if (!this.prof) this.setup(race);
    if (!started) { v.vel.set(0, 0, 0); this.sync(dt); return; }
    // Fehler: ab und zu (je schwächer, desto öfter) ein Verbremser für ~1,5 s
    this.mistakeCool -= dt; this.mistake = Math.max(0, this.mistake - dt);
    if (this.mistakeCool <= 0) { this.mistakeCool = 8 + Math.random() * 14; if (Math.random() < (1.05 - this.skill) * 3) this.mistake = 1.5; }
    let inp;
    if (this.done) {
      // nach dem Ziel ausrollen und zur Seite
      this.latT = (this.name.length % 2 ? 1 : -1) * (race.hw - 1.3);
      inp = this.drive(dt, race, [], playerProg); inp.throttle = 0; inp.brake = 0.25;
      if (!path.closed && this.s >= path.length - 6) { this.model.visible = false; return; }
    } else inp = this.drive(dt, race, others, playerProg);
    this.acc += dt;
    let n = 0;
    while (this.acc >= AI_H && n < 4) { v.step(AI_H, inp); this.acc -= AI_H; n++; }
    if (n >= 4) this.acc = 0;
    v.impacts.length = 0;
    // Position auf der Strecke nachführen (Fortschritt wie beim Spieler)
    const c = path.closest(v.pos.x, v.pos.z, this.s, 60);
    let ds = c.s - this.s;
    if (path.closed) { if (ds > path.length / 2) ds -= path.length; if (ds < -path.length / 2) ds += path.length; }
    if (Math.abs(ds) < 60) { this.s = c.s; this.prog += ds; }
    this.lat = c.lat;
    // festgefahren oder weit abseits → zurück auf die Strecke (wie „Zurücksetzen“ beim Spieler)
    if (!this.done) {
      this.stuckT = v.vf < 1.5 ? this.stuckT + dt : 0;
      this.offT = c.dist > race.hw + 14 || v.inWater > 0 ? this.offT + dt : 0;
      if (this.stuckT > 2.5 || this.offT > 1.5) {
        this.lat = clamp(this.lat, -(race.hw - 2), race.hw - 2); this.latT = this.lat;
        this.place(path, race, 8); this.stuckT = 0; this.offT = 0;
      }
    }
    this.sync(dt, inp);
  }
  // Modell an das Fahrzeug anpassen (Neigung am Boden, Wankbewegung, Räder)
  sync(dt, inp) {
    const v = this.veh, m = this.model, ud = m.userData;
    m.position.copy(v.pos);
    _f.set(Math.sin(v.yaw), 0, Math.cos(v.yaw));
    _f.addScaledVector(v.up, -_f.dot(v.up)).normalize();
    _x.crossVectors(v.up, _f).normalize();
    _mm.makeBasis(_x, v.up, _f);
    m.quaternion.setFromRotationMatrix(_mm);
    this.roll = damp(this.roll || 0, clamp(v.yawRate * Math.abs(v.vf) * 0.006, -0.08, 0.08), 6, dt || 0.016);
    ud.bodyG.rotation.set(0, 0, -this.roll);
    for (const w of ud.wheels) { w.spin.rotation.x = v.wheelRot; if (w.front) w.pivot.rotation.y = -v.steer * 0.45; }
  }
}
const _f = new THREE.Vector3(), _x = new THREE.Vector3(), _mm = new THREE.Matrix4();

// ---------------------------------------------------------------- Verkehr
const TRAFFIC_STYLES = [
  { style: 'hatch', colors: ['#c0392b', '#2980b9', '#ecf0f1', '#7f8c8d', '#27ae60', '#f1c40f'] },
  { style: 'truck', colors: ['#34495e', '#d35400', '#ecf0f1', '#16a085'] },
  { style: 'ev', colors: ['#ecf0f1', '#2c3e50', '#8e44ad'] },
  { style: 'muscle', colors: ['#c0392b', '#2c3e50', '#f39c12'] },
  { style: 'van', colors: ['#e67e22', '#5fa8d3', '#7bc47f', '#f2c14e'] },
  { style: 'suv', colors: ['#22232a', '#8d99ae', '#ecf0f1', '#1d3557'] },
  { style: 'mini', colors: ['#d7263d', '#2a9d8f', '#e9c46a', '#264653'] },
  { style: 'wagon', colors: ['#3d405b', '#ecf0f1', '#81b29a', '#7f8c8d'] },
  { style: 'classic', colors: ['#9b1d20', '#1b3a5c', '#f1e3c8', '#3d6b3a'] },
  { style: 'sedan', colors: ['#22232a', '#8d99ae', '#ecf0f1', '#1d3557'] },
  { style: 'kei', colors: ['#f2c14e', '#7bc47f', '#5fa8d3', '#ecf0f1'] },
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
      // nah: mittleres Modell (ab „Hoch“), weiter weg: einfaches LOD – gleiche Farbe, Wechsel bei 70 m
      const color = T.colors[Math.floor(rnd() * T.colors.length)];
      const model = new THREE.Group(), near = buildCar({ style: T.style }, color, { lod: true }), far = buildCar({ style: T.style }, color, { lod: 'far' });
      model.add(near);
      if (far && far.children.length && far.userData.lodKind !== near.userData.lodKind) model.add(far); else model.userData.single = true;
      model.userData.near = near; model.userData.far = far;
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
      if (!c.model.userData.single) { const near = d < 70; c.model.userData.near.visible = near; c.model.userData.far.visible = !near; }
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
