// Weltdaten ohne Grafik: Höhenkarte, Straßen, Untergrund, Hindernisse und Deko-Positionen.
import { clamp, lerp, smoothstep, perlin, fbm, ridged, mulberry32, Path } from './util.js';
import { ROADS, CROSS, HOUSES } from './data.js';

export const HALF = 1300, CELL = 4, N = (HALF * 2) / CELL + 1;
export const SURF = { GRASS: 0, ASPHALT: 1, DIRT: 2, SAND: 3, ROCK: 4, SNOW: 5, WATER: 6, GRAVEL: 7 };
// grip: Haftung, drag: Rollwiderstand (m/s²), rough: Holpern
export const SURF_PROPS = [
  { grip: 0.8, drag: 2.2, rough: 0.6 },
  { grip: 1.0, drag: 0.12, rough: 0 },
  { grip: 0.84, drag: 0.7, rough: 0.35 },
  { grip: 0.66, drag: 3.6, rough: 0.4 },
  { grip: 0.8, drag: 1.4, rough: 0.7 },
  { grip: 0.62, drag: 2.6, rough: 0.3 },
  { grip: 0.4, drag: 8, rough: 0.2 },
  { grip: 0.88, drag: 0.9, rough: 0.3 },
];
export const FESTIVAL = { x: 0, z: 565, r: 72 };
export const TOWN = { x: -620, z: 40, r: 300 };
export const LAKE = { x: -250, z: 330 };

function flatten(h, x, z, cx, cz, r, target) {
  const d = Math.hypot(x - cx, z - cz);
  if (d > r) return h;
  return lerp(h, target, smoothstep(r, r * 0.5, d));
}

export function coastFactor(x, z) {
  const r = Math.hypot(x, z);
  const a = Math.atan2(z, x);
  const coast = 1030 + 110 * perlin(Math.cos(a) * 1.6 + 3.1, Math.sin(a) * 1.6 + 8.2) + 40 * perlin(x / 170 + 20, z / 170 + 40);
  return smoothstep(coast + 150, coast - 170, r);
}

export function baseHeight(x, z) {
  const land = coastFactor(x, z);
  let h = 13 + 17 * fbm(x / 430 + 11.3, z / 430 + 7.7, 4) + 4 * fbm(x / 80 + 3, z / 80 + 9, 2);
  // Gebirge im Norden mit Sattel für den Pass
  const mx = x / 450, mz = (z + 480) / 270;
  const mount = Math.exp(-(mx * mx + mz * mz) * 1.15);
  if (mount > 0.005) {
    const saddle = 1 - 0.55 * Math.exp(-(((x - 150) / 110) ** 2));
    h += mount * saddle * (60 + 150 * ridged(x / 260 + 5.5, z / 260 + 1.3, 5));
  }
  // Waldhügel im Osten
  const fx = (x - 600) / 260, fz = (z + 80) / 300;
  h += 20 * Math.exp(-(fx * fx + fz * fz)) * (0.6 + 0.5 * fbm(x / 140, z / 140, 3));
  // Steppe im Nordosten: Tafelberge
  const sx = (x - 620) / 200, sz = (z + 470) / 170;
  const st = Math.exp(-(sx * sx + sz * sz));
  if (st > 0.01) h += st * 30 * smoothstep(0.1, 0.35, fbm(x / 120 + 7, z / 120 + 2, 3) + 0.15);
  // See
  const lx = (x - LAKE.x) / 150, lz = (z - LAKE.z) / 115;
  h -= 36 * Math.exp(-(lx * lx + lz * lz) * 1.4);
  h = flatten(h, x, z, FESTIVAL.x, FESTIVAL.z, 260, 9);
  h = flatten(h, x, z, TOWN.x, TOWN.z, 300, 7);
  return lerp(-28, h, land);
}

export class World {
  constructor(quality = 1) {
    this.quality = quality;
    this.H = new Float32Array(N * N);
    this.E = new Float32Array(N * N).fill(999);
    this.RT = new Int8Array(N * N).fill(-1);
    this.S = new Uint8Array(N * N);
    this.roads = [];
    this.roadById = {};
    this.trees = []; this.rocks = []; this.buildings = []; this.lamps = [];
    this.smash = []; // {kind, x, z, y, yaw, s, alive}
    this.posters = [];
    this.ramps = [];
    this.grid = new Map(); // statische Hindernisse
    this.sgrid = new Map(); // zerstörbare Dinge
  }

  async generate(progress = () => {}) {
    const tick = async (p, msg) => { progress(p, msg); await new Promise(r => setTimeout(r, 0)); };
    await tick(0.02, 'Insel formen');
    const H0 = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      const z = -HALF + j * CELL;
      for (let i = 0; i < N; i++) H0[j * N + i] = baseHeight(-HALF + i * CELL, z);
      if (j % 130 === 0) await tick(0.02 + 0.25 * j / N, 'Insel formen');
    }
    await tick(0.3, 'Straßen bauen');
    for (const def of ROADS) {
      const path = new Path(def.pts, def.closed, 2.5);
      const r = { def, path, id: def.id };
      this.roads.push(r); this.roadById[def.id] = r;
    }
    this.cross = new Path(CROSS.pts, false, 2.5);
    // Straßenhöhe: geglättetes Gelände, dann entlang der Straße mit Steigungsgrenze; Kreuzungen werden festgepinnt
    const R = boxBlur(boxBlur(H0, 10), 8);
    this.RF = new Float32Array(N * N);
    const order = ['festival', 'kueste', 'stadt', 'markt', 'see', 'schnell', 'pass', 'wald', 'berg'];
    this.rasterDisk(FESTIVAL.x, FESTIVAL.z, FESTIVAL.r, sampleGrid(R, FESTIVAL.x, FESTIVAL.z));
    for (const id of order) {
      const r = this.roadById[id], p = r.path;
      const y = new Float32Array(p.n), pin = new Uint8Array(p.n);
      for (let i = 0; i < p.n; i++) {
        const k = cellIdx(p.x[i], p.z[i]);
        if (this.E[k] < -1) { y[i] = this.RF[k]; pin[i] = 1; }
        else y[i] = Math.max(1.4, sampleGrid(R, p.x[i], p.z[i]));
      }
      const G = (r.def.type === 'dirt' ? 0.16 : 0.11) * p.ds;
      for (let it = 0; it < 4; it++) { limitGrade(y, pin, G, p.closed); smooth1D(y, pin, 8, p.closed); }
      limitGrade(y, pin, G, p.closed);
      for (let i = 0; i < p.n; i++) if (!pin[i]) y[i] = Math.max(1.4, y[i]);
      p.y.set(y);
      this.rasterRoad(p, r.def.hw, r.def.type === 'dirt' ? 1 : 0);
    }
    await tick(0.42, 'Gelände anpassen');
    for (let k = 0; k < N * N; k++) {
      const e = this.E[k];
      if (e < 18) {
        const sh = this.RT[k] === 1 ? 10 : 16;
        const t = smoothstep(0.8, sh, e);
        this.H[k] = lerp(this.RF[k], H0[k], t);
      } else this.H[k] = H0[k];
    }
    this.H0 = H0;
    for (const r of this.roads) for (let i = 0; i < r.path.n; i++) r.path.y[i] = this.heightAt(r.path.x[i], r.path.z[i]);
    for (let i = 0; i < this.cross.n; i++) this.cross.y[i] = this.heightAt(this.cross.x[i], this.cross.z[i]);
    // Untergrund
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const h = this.H[k], e = this.E[k];
        let s = SURF.GRASS;
        if (e < 0) s = this.RT[k] === 1 ? SURF.DIRT : SURF.ASPHALT;
        else if (h < -0.4) s = SURF.WATER;
        else if (e < 2.2) s = SURF.GRAVEL;
        else {
          const gx = (this.H[j * N + Math.min(i + 1, N - 1)] - this.H[j * N + Math.max(i - 1, 0)]) / (2 * CELL);
          const gz = (this.H[Math.min(j + 1, N - 1) * N + i] - this.H[Math.max(j - 1, 0) * N + i]) / (2 * CELL);
          const sl = Math.hypot(gx, gz);
          if (h < 2.4) s = SURF.SAND;
          else if (h > 128 + 10 * perlin(i * 0.05, j * 0.05)) s = SURF.SNOW;
          else if (sl > 0.75) s = SURF.ROCK;
        }
        this.S[k] = s;
      }
    }
    await tick(0.5, 'Wald pflanzen');
    this.placeScenery();
    await tick(0.6, 'Fertig');
  }

  rasterRoad(path, hw, type) {
    const R = hw + 20;
    const segs = path.closed ? path.n : path.n - 1;
    for (let s = 0; s < segs; s++) {
      const a = s, b = path.idx(s + 1);
      const ax = path.x[a], az = path.z[a], bx = path.x[b], bz = path.z[b];
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R + HALF) / CELL));
      const i1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + R + HALF) / CELL));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R + HALF) / CELL));
      const j1 = Math.min(N - 1, Math.ceil((Math.max(az, bz) + R + HALF) / CELL));
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      for (let j = j0; j <= j1; j++) {
        const z = -HALF + j * CELL;
        for (let i = i0; i <= i1; i++) {
          const x = -HALF + i * CELL;
          const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
          const d = Math.hypot(ax + dx * t - x, az + dz * t - z) - hw;
          const k = j * N + i;
          if (d < this.E[k]) { this.E[k] = d; this.RT[k] = type; this.RF[k] = path.y[a] + (path.y[b] - path.y[a]) * t; }
        }
      }
    }
  }

  rasterDisk(cx, cz, r, hy) {
    const R = r + 20;
    for (let j = Math.floor((cz - R + HALF) / CELL); j <= Math.ceil((cz + R + HALF) / CELL); j++) {
      for (let i = Math.floor((cx - R + HALF) / CELL); i <= Math.ceil((cx + R + HALF) / CELL); i++) {
        const d = Math.hypot(-HALF + i * CELL - cx, -HALF + j * CELL - cz) - r;
        const k = j * N + i;
        if (d < this.E[k]) { this.E[k] = d; this.RT[k] = 0; this.RF[k] = hy; }
      }
    }
  }

  // ---------- Abfragen
  heightAt(x, z) {
    let fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    fx = clamp(fx, 0, N - 1.001); fz = clamp(fz, 0, N - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const k = j * N + i, H = this.H;
    let h = (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + N] * (1 - u) + H[k + N + 1] * u) * v;
    if (this.ramps.length) h = Math.max(h, this.rampHeight(x, z));
    return h;
  }
  baseAt(x, z) { // Gelände ohne Schanzen
    let fx = clamp((x + HALF) / CELL, 0, N - 1.001), fz = clamp((z + HALF) / CELL, 0, N - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * N + i, H = this.H;
    return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + N] * (1 - u) + H[k + N + 1] * u) * v;
  }
  edgeAt(x, z) {
    const i = clamp(Math.round((x + HALF) / CELL), 0, N - 1), j = clamp(Math.round((z + HALF) / CELL), 0, N - 1);
    return this.E[j * N + i];
  }
  surfaceAt(x, z) {
    const i = clamp(Math.round((x + HALF) / CELL), 0, N - 1), j = clamp(Math.round((z + HALF) / CELL), 0, N - 1);
    return this.S[j * N + i];
  }
  gradAt(x, z, out) {
    const e = 1.5;
    out.x = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    out.z = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return out;
  }
  rampHeight(x, z) {
    let best = -99;
    for (const r of this.ramps) {
      const dx = x - r.x, dz = z - r.z;
      if (dx * dx + dz * dz > 400) continue;
      const lz = dx * r.s + dz * r.c, lx = dx * r.c - dz * r.s; // lz entlang der Rampe
      if (Math.abs(lx) > r.w / 2 || lz < -r.len / 2 || lz > r.len / 2) continue;
      const t = (lz + r.len / 2) / r.len;
      best = Math.max(best, r.y + r.h * t * t * 0.35 + r.h * t * 0.65);
    }
    return best;
  }

  // ---------- Hindernisse (Raster 24 m)
  key(x, z) { return (Math.floor(x / 24) + 200) * 1000 + (Math.floor(z / 24) + 200); }
  addCollider(c, grid = this.grid) {
    const r = c.t === 0 ? c.r : Math.hypot(c.hx, c.hz);
    for (let gx = Math.floor((c.x - r) / 24); gx <= Math.floor((c.x + r) / 24); gx++)
      for (let gz = Math.floor((c.z - r) / 24); gz <= Math.floor((c.z + r) / 24); gz++) {
        const k = (gx + 200) * 1000 + (gz + 200);
        let a = grid.get(k); if (!a) grid.set(k, a = []);
        a.push(c);
      }
  }
  near(x, z, grid = this.grid) { return grid.get(this.key(x, z)) || EMPTY; }

  placeScenery() {
    const rnd = mulberry32(42);
    const q = this.quality;
    const free = (x, z, rad) => { // nichts Statisches in der Nähe
      for (const c of this.near(x, z)) {
        const r = c.t === 0 ? c.r : Math.max(c.hx, c.hz);
        if (Math.hypot(c.x - x, c.z - z) < r + rad) return false;
      }
      return true;
    };
    // --- Querfeldein-Strecke frei halten
    const crossCells = new Set();
    for (let i = 0; i < this.cross.n; i += 2) {
      for (let dx = -20; dx <= 20; dx += 6) for (let dz = -20; dz <= 20; dz += 6) {
        if (dx * dx + dz * dz > 400) continue;
        crossCells.add(Math.floor((this.cross.x[i] + dx) / 6) * 10000 + Math.floor((this.cross.z[i] + dz) / 6));
      }
    }
    const onCross = (x, z) => crossCells.has(Math.floor(x / 6) * 10000 + Math.floor(z / 6));
    // --- Festival-Bauten (Kollision; Grafik in world.js)
    const F = FESTIVAL;
    this.festival = {
      stage: { x: F.x, z: F.z + 108, w: 44, d: 16, h: 15 },
      arch: { x: F.x, z: F.z - 70 },
      wheel: { x: F.x - 150, z: F.z + 20 },
      tents: [], towers: [],
    };
    const st = this.festival.stage;
    this.addCollider({ t: 1, x: st.x, z: st.z, hx: st.w / 2, hz: st.d / 2, c: 1, s: 0 });
    for (const sx of [-13, 13]) this.addCollider({ t: 0, x: F.x + sx, z: F.z - 70, r: 1.6 });
    this.addCollider({ t: 1, x: this.festival.wheel.x, z: this.festival.wheel.z, hx: 4, hz: 9, c: 1, s: 0 });
    for (let k = 0; k < 8; k++) {
      const a = -0.35 + k * (Math.PI * 2 - 0.7) / 7 + Math.PI / 2;
      const x = F.x + Math.cos(a) * 100, z = F.z + Math.sin(a) * 92;
      if (Math.abs(x - st.x) < 30 && z > F.z + 60) continue;
      if (this.edgeAt(x, z) < 8) continue;
      this.festival.tents.push({ x, z, r: 7, color: k });
      this.addCollider({ t: 0, x, z, r: 6.5 });
    }
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2 + 0.5;
      const x = F.x + Math.cos(a) * (F.r + 4), z = F.z + Math.sin(a) * (F.r + 4);
      this.festival.towers.push({ x, z });
      this.addCollider({ t: 0, x, z, r: 0.9 });
    }
    // Zuschauerbereich vor der Bühne (abgesperrt)
    this.festival.crowd = { x: F.x, z: F.z + 91, hx: 23, hz: 8.5 };
    this.addCollider({ t: 1, x: F.x, z: F.z + 91, hx: 23, hz: 8.5, c: 1, s: 0 });
    // --- Häuser (Blender-Modelle) entlang der Stadtstraßen, Vorderseite zur Straße
    const placeHouse = (V, pt, side, hw, gap, farm) => {
      const nx = -pt.tz * side, nz = pt.tx * side; // von der Straße weg
      const off = hw + gap + V.d / 2;
      const x = pt.x + nx * off, z = pt.z + nz * off;
      const yaw = Math.atan2(-nx, -nz); // Modell-Vorderseite (+z) schaut zur Straße
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      for (const [a, b] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const px = x + (a * V.w / 2) * c + (b * V.d / 2) * sn, pz = z - (a * V.w / 2) * sn + (b * V.d / 2) * c;
        if (this.edgeAt(px, pz) < 2.5) return false;
      }
      if (!free(x, z, Math.max(V.w, V.d) * 0.5)) return false;
      if (farm && (this.baseAt(x, z) < 3 || onCross(x, z) || this.nearRamp(x, z, 160))) return false;
      this.buildings.push({ x, z, w: V.w, d: V.d, yaw, y: this.baseAt(x, z), hue: rnd(), variant: V.id, farm, lit: rnd() < 0.6 });
      this.addCollider({ t: 1, x, z, hx: V.w / 2, hz: V.d / 2, c, s: sn });
      return true;
    };
    const town = ['stadt', 'markt', 'see'].map(id => this.roadById[id]);
    for (const r of town) {
      const p = r.path, hw = r.def.hw;
      for (let s = 6; s < p.length; s += 15 + rnd() * 5) {
        const pt = p.at(s, {});
        const dc = Math.hypot(pt.x - TOWN.x, pt.z - TOWN.z);
        if (dc > TOWN.r - 30) continue;
        for (const side of [-1, 1]) {
          if (rnd() < 0.1) continue;
          const list = dc < 140 ? HOUSES.center : HOUSES.town;
          placeHouse(list[Math.floor(rnd() * list.length)], pt, side, hw, 4.5, false);
        }
      }
    }
    // --- Bauernhöfe an der Küstenstraße (Haus + Scheune)
    const ring = this.roadById.kueste.path;
    for (let n = 0; n < 30; n++) {
      const s = rnd() * ring.length, pt = ring.at(s, {});
      const side = rnd() < 0.5 ? -1 : 1;
      if (Math.hypot(pt.x - TOWN.x, pt.z - TOWN.z) < TOWN.r + 60) continue;
      if (placeHouse(HOUSES.farm[0], pt, side, 7, 16 + rnd() * 10, true)) {
        const pt2 = ring.at(s + 24, {});
        placeHouse(HOUSES.farm[1], pt2, side, 7, 22 + rnd() * 8, true);
      }
    }
    // --- Windräder auf Hügeln
    this.turbines = [];
    for (let t = 0; t < 500 && this.turbines.length < 7; t++) {
      const a = rnd() * Math.PI * 2, rr = 380 + rnd() * 560;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const h = this.baseAt(x, z);
      if (h < 16 || h > 90 || this.edgeAt(x, z) < 45 || onCross(x, z) || this.nearRamp(x, z, 200)) continue;
      if (Math.hypot(x - FESTIVAL.x, z - FESTIVAL.z) < 300 || Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.r + 60) continue;
      if (this.turbines.some(o => Math.hypot(o.x - x, o.z - z) < 170) || !free(x, z, 20)) continue;
      this.turbines.push({ x, z, y: h, yaw: 2.3 + rnd() * 0.3, phase: rnd() * 6 });
      this.addCollider({ t: 0, x, z, r: 2.6 });
    }
    // --- Boote auf dem Meer und dem See
    this.boats = [];
    for (let k = 0; k < 9; k++) {
      const a = k / 9 * Math.PI * 2 + rnd() * 0.4;
      let rr = 950;
      while (rr < 1250 && this.baseAt(Math.cos(a) * rr, Math.sin(a) * rr) > -7) rr += 10;
      rr += 30 + rnd() * 80;
      this.boats.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, yaw: a + Math.PI / 2 + (rnd() - 0.5), phase: rnd() * 6, speed: 1 + rnd() * 2 });
    }
    for (const [dx, dz] of [[-45, 10], [40, -25]]) {
      const x = LAKE.x + dx, z = LAKE.z + dz;
      if (this.baseAt(x, z) < -3) this.boats.push({ x, z, yaw: rnd() * 6, phase: rnd() * 6, speed: 0.6, lake: true });
    }
    // --- Schanzen
    for (const ev of this.events || []) {
      if (ev.type !== 'jump') continue;
      const r = { x: ev.x, z: ev.z, c: Math.cos(ev.yaw), s: Math.sin(ev.yaw), len: 16, w: 9, h: 4.2, yaw: ev.yaw };
      // Rampe läuft entlang (sin yaw, cos yaw)
      // Anlauf und Schanze eben machen (sonst entsteht vorne eine Kante)
      const hR = this.baseAt(ev.x, ev.z);
      const R = 100;
      for (let j = Math.floor((ev.z - R + HALF) / CELL); j <= Math.ceil((ev.z + R + HALF) / CELL); j++) {
        for (let i = Math.floor((ev.x - R + HALF) / CELL); i <= Math.ceil((ev.x + R + HALF) / CELL); i++) {
          if (i < 0 || j < 0 || i >= N || j >= N) continue;
          const k = j * N + i;
          if (this.E[k] < 4) continue;
          const dx = -HALF + i * CELL - ev.x, dz = -HALF + j * CELL - ev.z;
          const lz = dx * r.s + dz * r.c, lx = dx * r.c - dz * r.s;
          const w = smoothstep(18, 10, Math.abs(lx)) * smoothstep(-95, -75, lz) * smoothstep(16, 9, lz);
          if (w > 0) this.H[k] = lerp(this.H[k], hR, w);
        }
      }
      r.y = hR - 0.3;
      this.ramps.push(r);
    }
    // --- Straßenlaternen
    for (const r of this.roads) {
      if (!r.def.lamps) continue;
      const p = r.path, hw = r.def.hw;
      let side = 1;
      for (let s = 5; s < p.length - 5; s += 34) {
        const pt = p.at(s, {});
        side = -side;
        const x = pt.x - pt.tz * side * (hw + 1.6), z = pt.z + pt.tx * side * (hw + 1.6);
        if (this.edgeAt(x, z) < 0.6 || !free(x, z, 3)) continue;
        this.lamps.push({ x, z, y: this.baseAt(x, z), yaw: Math.atan2(pt.tx, pt.tz) + (side > 0 ? -Math.PI / 2 : Math.PI / 2) });
        this.addCollider({ t: 0, x, z, r: 0.35 });
      }
    }
    // --- Bäume
    const treeStep = q >= 2 ? 6.5 : q >= 1 ? 7.5 : 9.5;
    for (let gz = -HALF + 10; gz < HALF - 10; gz += treeStep) {
      for (let gx = -HALF + 10; gx < HALF - 10; gx += treeStep) {
        const x = gx + (rnd() - 0.5) * treeStep, z = gz + (rnd() - 0.5) * treeStep;
        const h = this.baseAt(x, z);
        if (h < 1.2 || h > 115) continue;
        const e = this.edgeAt(x, z);
        if (e < 5) continue;
        const dF = Math.hypot(x - FESTIVAL.x, z - FESTIVAL.z), dT = Math.hypot(x - TOWN.x, z - TOWN.z);
        if (dF < 250 || dT < 250) continue;
        let dens = fbm(x / 260 + 4, z / 260 + 9, 3) * 1.3 - 0.05;
        const fx = (x - 610) / 220, fz = (z + 90) / 260; dens += 1.1 * Math.exp(-(fx * fx + fz * fz));
        const mx = x / 500, mz = (z + 430) / 300; dens += 0.5 * Math.exp(-(mx * mx + mz * mz)) * smoothstep(110, 50, h);
        const sx = (x - 620) / 230, sz = (z + 470) / 200; dens -= 1.2 * Math.exp(-(sx * sx + sz * sz));
        if (e < 14) dens -= 0.35;
        if (h < 5) dens = 0.25; // Strand: einzelne Palmen
        if (rnd() > dens * 0.9) continue;
        if (this.surfaceAt(x, z) === SURF.ROCK && rnd() < 0.7) continue;
        if (this.nearRamp(x, z, 140) || onCross(x, z) || !free(x, z, 1.2)) continue;
        const type = h < 5 ? 2 : (h > 45 || z < -250 || rnd() < 0.3) ? 0 : 1; // 0 Tanne, 1 Laubbaum, 2 Palme
        const sc = 0.75 + rnd() * 0.6;
        this.trees.push({ x, z, y: h, s: sc, type, rot: rnd() * 6.28 });
        this.addCollider({ t: 0, x, z, r: 0.55 * sc + 0.2 });
      }
    }
    // --- Felsen
    for (let n = 0; n < 900 * Math.max(0.5, q / 2); n++) {
      const x = (rnd() * 2 - 1) * 1050, z = (rnd() * 2 - 1) * 1050;
      const h = this.baseAt(x, z);
      if (h < 2 || this.edgeAt(x, z) < 7) continue;
      const mx = x / 450, mz = (z + 480) / 270, sx = (x - 620) / 230, sz = (z + 470) / 200;
      const p = Math.exp(-(mx * mx + mz * mz)) + Math.exp(-(sx * sx + sz * sz)) * 0.8 + (h < 4 ? 0.25 : 0.04);
      if (rnd() > p) continue;
      if (Math.hypot(x - FESTIVAL.x, z - FESTIVAL.z) < 250 || this.nearRamp(x, z, 140) || onCross(x, z)) continue;
      const s = 0.8 + rnd() * rnd() * 4;
      this.rocks.push({ x, z, y: h, s, rot: rnd() * 6.28, tilt: rnd() * 0.5 });
      this.addCollider({ t: 0, x, z, r: s * 0.85 });
    }
    // --- Zerstörbares: Zäune, Pylonen, Heuballen
    for (const r of this.roads) {
      const p = r.path, hw = r.def.hw;
      if (r.def.fences) {
        for (let s = 0; s < p.length; s += 4) {
          if (fbm(s / 300 + r.path.length, 3.3, 2) < 0.06) continue;
          const pt = p.at(s, {});
          for (const side of [-1, 1]) {
            const off = hw + 4.2;
            const x = pt.x - pt.tz * side * off, z = pt.z + pt.tx * side * off;
            const h = this.baseAt(x, z);
            if (h < 2.5 || this.edgeAt(x, z) < 3.5 || Math.abs(h - pt.y) > 3) continue;
            if (Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.r) continue;
            this.addSmash('fence', x, z, h, Math.atan2(pt.tx, pt.tz) + Math.PI / 2, 1.6);
          }
        }
      }
      if (r.def.cones) {
        for (let s = 0; s < p.length; s += 3.2) {
          const pt = p.at(s, {});
          if (Math.abs(pt.curv) < 0.012) continue;
          const side = pt.curv > 0 ? 1 : -1; // Innenseite
          const x = pt.x - pt.tz * side * (hw + 0.6), z = pt.z + pt.tx * side * (hw + 0.6);
          this.addSmash('cone', x, z, this.baseAt(x, z), 0, 0.5);
        }
      }
    }
    for (let n = 0; n < 90; n++) {
      const s = rnd() * ring.length, pt = ring.at(s, {});
      const side = rnd() < 0.5 ? -1 : 1, off = 14 + rnd() * 25;
      const x = pt.x - pt.tz * side * off, z = pt.z + pt.tx * side * off;
      const h = this.baseAt(x, z);
      if (h < 3 || this.edgeAt(x, z) < 6 || !free(x, z, 3) || onCross(x, z) || this.nearRamp(x, z, 140)) continue;
      for (let k = 0; k < 3; k++) this.addSmash('hay', x + k * 2.6 * pt.tx, z + k * 2.6 * pt.tz, this.baseAt(x + k * 2.6 * pt.tx, z + k * 2.6 * pt.tz), Math.atan2(pt.tx, pt.tz), 1.1);
    }
    // --- Festival-Plakate (Sammelobjekte), gut verteilt
    const all = this.roads.filter(r => r.id !== 'festival');
    let tries = 0;
    while (this.posters.length < 20 && tries++ < 4000) {
      const r = all[Math.floor(rnd() * all.length)], p = r.path;
      const pt = p.at(rnd() * p.length, {});
      const side = rnd() < 0.5 ? -1 : 1, off = r.def.hw + 6 + rnd() * 22;
      const x = pt.x - pt.tz * side * off, z = pt.z + pt.tx * side * off;
      const h = this.baseAt(x, z);
      if (h < 2 || this.edgeAt(x, z) < 4 || !free(x, z, 4)) continue;
      if (this.posters.some(o => Math.hypot(o.x - x, o.z - z) < 230)) continue;
      const yaw = Math.atan2(pt.x - x, pt.z - z); // Vorderseite zur Straße
      const o = this.addSmash('poster', x, z, h, yaw, 2.4);
      o.poster = this.posters.length;
      this.posters.push(o);
    }
  }

  nearRamp(x, z, d) {
    for (const r of this.ramps) {
      const dx = x - r.x, dz = z - r.z;
      const along = dx * r.s + dz * r.c, lat = dx * r.c - dz * r.s;
      if (along > -140 && along < d && Math.abs(lat) < 24) return true;
    }
    return false;
  }

  addSmash(kind, x, z, y, yaw, r) {
    const o = { t: 0, kind, x, z, y, yaw, r, alive: true, id: this.smash.length };
    this.smash.push(o);
    this.addCollider(o, this.sgrid);
    return o;
  }
}
const EMPTY = [];

function cellIdx(x, z) {
  const i = clamp(Math.round((x + HALF) / CELL), 0, N - 1), j = clamp(Math.round((z + HALF) / CELL), 0, N - 1);
  return j * N + i;
}
function sampleGrid(G, x, z) {
  const fx = clamp((x + HALF) / CELL, 0, N - 1.001), fz = clamp((z + HALF) / CELL, 0, N - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * N + i;
  return (G[k] * (1 - u) + G[k + 1] * u) * (1 - v) + (G[k + N] * (1 - u) + G[k + N + 1] * u) * v;
}
function limitGrade(y, pin, G, closed) {
  const n = y.length, reps = closed ? 2 : 1;
  for (let r = 0; r < reps; r++) {
    for (let i = 1; i <= (closed ? n : n - 1); i++) {
      const a = (i - 1) % n, b = i % n;
      if (!pin[b]) y[b] = clamp(y[b], y[a] - G, y[a] + G);
    }
    for (let i = (closed ? n : n - 1) - 1; i >= 0; i--) {
      const a = (i + 1) % n, b = i % n;
      if (!pin[b]) y[b] = clamp(y[b], y[a] - G, y[a] + G);
    }
  }
}
function smooth1D(y, pin, W, closed) {
  const n = y.length, src = Float32Array.from(y);
  for (let i = 0; i < n; i++) {
    if (pin[i]) continue;
    let s = 0, c = 0;
    for (let k = -W; k <= W; k++) {
      let j = i + k;
      if (closed) j = ((j % n) + n) % n; else if (j < 0 || j >= n) continue;
      s += src[j]; c++;
    }
    y[i] = s / c;
  }
}

function boxBlur(src, r) {
  const tmp = new Float32Array(N * N), out = new Float32Array(N * N);
  const w = 2 * r + 1;
  for (let j = 0; j < N; j++) {
    let s = 0;
    const row = j * N;
    for (let i = -r; i <= r; i++) s += src[row + clamp(i, 0, N - 1)];
    for (let i = 0; i < N; i++) {
      tmp[row + i] = s / w;
      s += src[row + clamp(i + r + 1, 0, N - 1)] - src[row + clamp(i - r, 0, N - 1)];
    }
  }
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) s += tmp[clamp(j, 0, N - 1) * N + i];
    for (let j = 0; j < N; j++) {
      out[j * N + i] = s / w;
      s += tmp[clamp(j + r + 1, 0, N - 1) * N + i] - tmp[clamp(j - r, 0, N - 1) * N + i];
    }
  }
  return out;
}
