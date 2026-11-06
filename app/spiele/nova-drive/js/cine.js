// Kino & Zeit: Zurückspulen (Zeitmaschine), Kamerafahrt vor dem Rennen, Wiederholung mit TV-Kameras.
import * as THREE from '../lib/three.module.min.js';
import { clamp, lerp } from './util.js';

const HZ = 30;            // Schnappschüsse pro Sekunde
const KEEP = 12 * HZ;     // 12 Sekunden Gedächtnis
const P = {}, Q = {};
const smooth = t => t * t * (3 - 2 * t);

// ---------------------------------------------------------------- Zeitmaschine
export class TimeMachine {
  constructor() { this.buf = []; this.acc = 0; }
  clear() { this.buf.length = 0; this.acc = 0; }
  get seconds() { return this.buf.length / HZ; }

  snap(g) {
    const c = g.car, r = g.events.race;
    return {
      c: [c.pos.x, c.pos.y, c.pos.z, c.vel.x, c.vel.y, c.vel.z, c.yaw, c.yawRate, c.steer, c.gear, c.rpm, c.nitro,
        c.up.x, c.up.y, c.up.z, c.vf, c.grounded ? 1 : 0, c.wheelRot],
      r: r ? [r.t, r.prog, r.pS, r.next, r.missed ? 1 : 0, r.started ? 1 : 0, r.lastCount || 0, r.lastRank || 0] : null,
      a: r ? r.ais.map(a => [a.s, a.prog, a.lat, a.latT, a.speed, a.done ? 1 : 0, a.finish, a.slide, a.wheelRot, a.bump]) : null,
    };
  }
  record(g, dt) {
    this.acc += dt;
    if (this.acc < 1 / HZ) return;
    this.acc %= 1 / HZ;
    this.buf.push(this.snap(g));
    if (this.buf.length > KEEP) this.buf.shift();
  }
  // Zustand vollständig wiederherstellen (Auto, Rennen, Gegner)
  apply(g, s) {
    const c = g.car, v = s.c;
    c.pos.set(v[0], v[1], v[2]); c.vel.set(v[3], v[4], v[5]);
    c.yaw = v[6]; c.yawRate = v[7]; c.steer = v[8]; c.gear = v[9]; c.rpm = v[10]; c.nitro = v[11];
    c.up.set(v[12], v[13], v[14]); c.vf = v[15]; c.grounded = !!v[16]; c.wheelRot = v[17];
    c.speedKmh = Math.abs(c.vf) * 3.6; c.drifting = false; c.airTime = 0; c.nitroOn = false; c.impacts.length = 0; c.landing = 0;
    const r = g.events.race;
    if (r && s.r) {
      [r.t, r.prog, r.pS, r.next] = s.r;
      r.missed = !!s.r[4]; r.started = !!s.r[5]; r.lastCount = s.r[6]; r.lastRank = s.r[7];
      if (r.ghostRec) { r.ghostRec.length = Math.max(0, Math.min(r.ghostRec.length, Math.floor(Math.max(0, r.t) * 10))); r.recT = 0; }
    }
    if (r && s.a) s.a.forEach((a, i) => {
      const ai = r.ais[i];
      if (!ai) return;
      [ai.s, ai.prog, ai.lat, ai.latT, ai.speed] = a;
      ai.done = !!a[5]; ai.finish = a[6]; ai.slide = a[7]; ai.wheelRot = a[8]; ai.bump = a[9];
      ai.place(r.path, r);
    });
  }
  // dt Sekunden zurück (mit doppeltem Tempo aufgerufen); liefert false, wenn das Gedächtnis leer ist
  back(g, dt) {
    let n = Math.max(1, Math.round(dt * HZ));
    let s = null;
    while (n-- > 0 && this.buf.length > 1) s = this.buf.pop();
    if (!s) return false;
    this.apply(g, s);
    return this.buf.length > 1;
  }
}

// ---------------------------------------------------------------- Kamerafahrt vor dem Rennen
export const INTRO = 4.2; // Sekunden vor dem Countdown

export function introCam(g, race, cam) {
  const ev = race.ev, path = race.path;
  const u = clamp((race.t - race.t0) / INTRO, 0, 1);
  // Phase 1: seitlich am Startfeld entlang (von der Pole nach hinten), niedrig
  const u1 = smooth(clamp(u / 0.58, 0, 1));
  const s = lerp(ev.s + 10, ev.s - 34, u1);
  const p = path.at(s, P);
  const side = 7.5;
  const x1 = p.x - p.tz * side, z1 = p.z + p.tx * side;
  const y1 = g.world.heightAt(x1, z1) + lerp(0.9, 2.4, u1);
  const t = path.at(s - 3, Q);
  let lx = t.x, lz = t.z, ly = g.world.heightAt(lx, lz) + 0.8;
  let x = x1, y = y1, z = z1;
  // Phase 2: hochziehen und hinter das eigene Auto schwenken
  if (u > 0.58) {
    const k = smooth((u - 0.58) / 0.42), c = g.car;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    const cx = c.pos.x - fx * 7.2, cz = c.pos.z - fz * 7.2, cy = Math.max(c.pos.y + 2.4, g.world.heightAt(cx, cz) + 1.1);
    const arc = Math.sin(k * Math.PI) * 5;
    x = lerp(x1, cx, k); z = lerp(z1, cz, k); y = lerp(y1, cy, k) + arc;
    lx = lerp(lx, c.pos.x + fx * 4, k); lz = lerp(lz, c.pos.z + fz * 4, k); ly = lerp(ly, c.pos.y + 0.75, k);
  }
  cam.position.set(x, y, z);
  cam.lookAt(lx, ly, lz);
  cam.fov = lerp(44, 60, smooth(clamp((u - 0.5) / 0.5, 0, 1)));
  cam.updateProjectionMatrix();
  return u < 1;
}

// ---------------------------------------------------------------- Wiederholung mit TV-Kameras
export class Replay {
  constructor(g, frames) {
    this.g = g; this.frames = frames; this.f = 0; this.cam = null; this.camT = 0; this.kind = 0;
    this.end = g.events.race ? g.tm.snap(g) : null;
    this.speed = 0.85;
  }
  get done() { return this.f >= this.frames.length - 1; }
  // eine TV-Kamera für die nächsten Sekunden wählen
  pick(c) {
    const g = this.g, look = this.frames[Math.min(this.frames.length - 1, Math.floor(this.f) + 40)].c;
    const kind = [0, 1, 0, 2][this.kind++ % 4];
    if (kind === 0) {
      // Streckenrand: seitlich vor dem Auto, auf Augenhöhe eines Zuschauers
      const dx = look[0] - c[0], dz = look[2] - c[2], l = Math.hypot(dx, dz) || 1;
      const side = (this.kind % 2 ? 1 : -1) * (10 + Math.random() * 6);
      const x = look[0] + (-dz / l) * side, z = look[2] + (dx / l) * side;
      this.cam = { kind, x, z, y: g.world.heightAt(x, z) + 1.4 + Math.random() * 2.2 };
    } else this.cam = { kind };
    this.camT = 0;
  }
  tick(dt, cam) {
    const g = this.g;
    this.f = Math.min(this.frames.length - 1, this.f + dt * HZ * this.speed);
    const i = Math.floor(this.f), k = this.f - i;
    const a = this.frames[i], b = this.frames[Math.min(i + 1, this.frames.length - 1)];
    // weich zwischen Schnappschüssen mischen (nur Darstellung)
    const s = { c: a.c.map((v, j) => (j === 6 ? a.c[6] + wrap(b.c[6] - a.c[6]) * k : j === 9 ? v : lerp(v, b.c[j], k))), r: a.r, a: a.a && a.a.map((x, n) => x.map((v, j) => (b.a && b.a[n] ? lerp(v, b.a[n][j], k) : v))) };
    g.tm.apply(g, s);
    const c = s.c;
    this.camT += dt;
    const far = this.cam && this.cam.kind === 0 && Math.hypot(this.cam.x - c[0], this.cam.z - c[2]) > 55;
    if (!this.cam || this.camT > 2.8 || far) this.pick(c);
    const C = this.cam, fx = Math.sin(c[6]), fz = Math.cos(c[6]);
    if (C.kind === 0) {
      cam.position.set(C.x, C.y, C.z);
      const d = Math.hypot(C.x - c[0], C.z - c[2]);
      cam.fov = clamp(Math.atan(5.5 / Math.max(d, 1)) * 2 * 180 / Math.PI, 14, 55);
      cam.lookAt(c[0], c[1] + 0.7, c[2]);
    } else if (C.kind === 1) {
      // tiefe Verfolger-Kamera knapp über der Straße
      const x = c[0] - fx * 4.6 + fz * 1.1, z = c[2] - fz * 4.6 - fx * 1.1;
      cam.position.set(x, Math.max(c[1] + 0.55, g.world.heightAt(x, z) + 0.35), z);
      cam.fov = 58; cam.lookAt(c[0] + fx * 6, c[1] + 0.55, c[2] + fz * 6);
    } else {
      // Hubschrauber: hoch, leicht seitlich, folgt
      const x = c[0] - fx * 14 + fz * 10, z = c[2] - fz * 14 - fx * 10;
      cam.position.set(x, c[1] + 16, z);
      cam.fov = 40; cam.lookAt(c[0] + fx * 6, c[1], c[2] + fz * 6);
    }
    cam.updateProjectionMatrix();
  }
  // echten Zustand von vor der Wiederholung zurückholen
  finish() { if (this.end) this.g.tm.apply(this.g, this.end); }
}
function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
export const REPLAY_FRAMES = 8 * HZ;
