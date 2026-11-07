// Arcade-Fahrphysik: Haftung, Driften, Sprünge, Untergrund, Kollisionen.
import * as THREE from '../lib/three.module.min.js';
import { clamp, lerp, damp } from './util.js';
import { SURF, SURF_PROPS } from './terrain.js';

const GEARS = [0.2, 0.36, 0.52, 0.68, 0.84, 1.03];
const _g = { x: 0, z: 0 };
let stamp = 1;

export class Vehicle {
  constructor(world, stats, dims) {
    this.world = world;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3(); // x/z horizontal, y vertikal
    this.yaw = 0; this.yawRate = 0;
    this.steer = 0;
    this.grounded = true; this.airTime = 0; this.lastAir = 0;
    this.gear = 1; this.rpm = 0.15; this.shift = 0;
    this.drifting = false; this.slip = 0; this.slipAmt = 0; this.driftExit = 0;
    this.nitroOn = false;
    this.up = new THREE.Vector3(0, 1, 0);
    this.pitchV = 0;
    this.wheelRot = 0;
    this.surface = SURF.ASPHALT;
    this.impacts = []; // {force, x, z}
    this.landing = 0;
    this.inWater = 0;
    this.speedKmh = 0; this.vf = 0;
    this.setDims(dims);
    this.setStats(stats);
  }
  setStats(st) { this.stats = st; this.nitro = Math.min(this.nitro ?? st.nitroCap, st.nitroCap); }
  setDims(d) { this.dims = d; this.half = (d.L / 2 - d.W / 2) * 0.85; this.rad = d.W / 2 * 0.95; }

  reset(x, z, yaw) {
    this.pos.set(x, this.world.heightAt(x, z), z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.yawRate = 0; this.steer = 0;
    this.grounded = true; this.airTime = 0; this.drifting = false; this.inWater = 0;
    this.up.set(0, 1, 0); this.gear = 1;
  }

  step(dt, inp) {
    const W = this.world, st = this.stats, p = this.pos, v = this.vel;
    // Lenkung glätten (zurück zur Mitte schneller)
    const sens = this.sens || 1;
    const tgt = clamp(inp.steer, -1, 1) * (sens < 1 ? 0.7 + 0.3 * sens : 1);
    const back = Math.abs(tgt) < Math.abs(this.steer) || tgt * this.steer < 0;
    const rate = (back ? 7 : 4.2) * (0.6 + 0.4 * sens);
    this.steer += clamp(tgt - this.steer, -rate * dt, rate * dt);

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let vf = v.x * sy + v.z * cy;
    let vr = -v.x * cy + v.z * sy;
    const spd = Math.hypot(v.x, v.z);
    const sId = W.surfaceAt(p.x, p.z);
    this.surface = sId;
    const sp = SURF_PROPS[sId];
    const paved = sId === SURF.ASPHALT;
    const wet = W.rain > 0.4 ? (W.rain - 0.4) / 0.6 : 0;
    const gripMul = (paved ? (1 - st.offroad * 0.06) : lerp(sp.grip, 0.96, st.offroad)) * (1 - (paved ? 0.16 : 0.1) * wet);
    const dragAdd = paved ? 0 : sp.drag * (1 - st.offroad * 0.8);
    const top = st.top / 3.6 * (this.nitroOn ? 1.12 : 1);

    // Nitro
    this.nitroOn = inp.nitro && this.nitro > 0.02 && vf > 3 && this.grounded !== null;
    if (this.nitroOn) this.nitro = Math.max(0, this.nitro - dt);
    else this.nitro = Math.min(st.nitroCap, this.nitro + st.nitroRegen * dt);

    if (this.grounded) {
      let a = 0;
      if (inp.throttle > 0 && vf > -1) {
        const r = clamp(vf / top, 0, 1.3);
        a += inp.throttle * st.accel * (0.9 - 0.12 * r) * Math.max(0, 1 - Math.pow(r, 2.6));
        if (this.nitroOn) a += 6.5;
        if (this.shift > 0) a *= 0.55;
      } else if (inp.throttle > 0 && vf <= -1) a += 24 * inp.throttle;
      if (inp.brake > 0) {
        if (vf > 1) a -= inp.brake * 25;
        else if (vf > -top * 0.22) a -= inp.brake * st.accel * 0.65;
      }
      vf += a * dt;
      const res = (0.3 + dragAdd + 0.00032 * vf * vf + (inp.handbrake ? 5.5 : 0) + (inp.throttle ? 0 : 0.6)) * dt;
      if (Math.abs(vf) <= res) vf = 0; else vf -= Math.sign(vf) * res;

      // Lenken & Haftung
      const grip = st.grip * gripMul;
      const latMax = 9.81 * grip * 1.18;
      const as = Math.abs(vf);
      const lock = 0.62 / (1 + as / 17);
      const wheelAngle = this.steer * lock * st.handling;
      let wT = vf * Math.tan(wheelAngle) / 2.6;
      const wMax = latMax / Math.max(as, 4);
      wT = clamp(wT, -wMax, wMax);
      this.slip = Math.atan2(vr, Math.max(as, 1));
      // Driften beginnen
      const power = st.drive !== 'FWD' && inp.throttle > 0.85 && Math.abs(this.steer) > 0.8 && as > 13 && as < top * 0.8 && (st.drive === 'RWD' || inp.handbrake);
      if (!this.drifting && as > 9 && (inp.handbrake && Math.abs(this.steer) > 0.2 || power)) {
        this.drifting = true; this.driftExit = 0;
        this.yawRate += this.steer * (inp.handbrake ? 1.2 : 0.7);
      }
      if (this.drifting) {
        if (Math.abs(this.slip) < 0.1 && !inp.handbrake) this.driftExit += dt; else this.driftExit = 0;
        if (this.driftExit > 0.25 || as < 5) this.drifting = false;
      }
      let latDecay;
      if (this.drifting) {
        const assist = Math.abs(this.steer) < 0.2 ? 2.4 : 1.2;
        const wD = this.steer * 2.1 * st.handling + assist * this.slip;
        this.yawRate = damp(this.yawRate, wD, 5, dt);
        latDecay = (inp.handbrake ? 0.9 : 1.7) * (0.7 + 0.3 * grip) + (Math.abs(this.slip) > 1.05 ? 5 : 0);
        if (inp.throttle > 0.5) vf += 2.2 * dt; // Gas hält den Drift am Leben
      } else {
        this.yawRate = damp(this.yawRate, wT, 9 * st.handling, dt);
        latDecay = 9 * grip;
      }
      vr *= Math.exp(-latDecay * dt);
      v.x = sy * vf - cy * vr;
      v.z = cy * vf + sy * vr;
      // Hangabtrieb
      W.gradAt(p.x, p.z, _g);
      v.x -= 9.81 * _g.x * 0.85 * dt;
      v.z -= 9.81 * _g.z * 0.85 * dt;
      this.slipAmt = clamp(Math.abs(vr) / 5 + (inp.handbrake && as > 3 ? 0.5 : 0) + (inp.brake && vf > 12 ? 0.25 : 0)
        + (inp.throttle && as < 7 && st.drive !== 'AWD' && st.accel > 9 ? 0.6 : 0), 0, 1);
    } else {
      this.yawRate = damp(this.yawRate, this.steer * 0.8, 2, dt);
      this.slipAmt = 0;
      const air = 0.00018 * spd * dt;
      v.x *= 1 - air; v.z *= 1 - air;
    }
    this.yaw -= this.yawRate * dt;
    if (this.shift > 0) this.shift -= dt;

    // Bewegen + Höhe
    const ghPrev = W.heightAt(p.x, p.z);
    const ox = p.x, oz = p.z;
    p.x += v.x * dt; p.z += v.z * dt;
    let gh = W.heightAt(p.x, p.z);
    // zu steil zum Hochfahren → wirkt wie eine Wand (statt Katapult)
    const moved = Math.hypot(p.x - ox, p.z - oz);
    if (gh - ghPrev > moved * 1.05 + 0.04 && gh > p.y + 0.25) {
      W.gradAt(p.x, p.z, _g);
      const gl = Math.hypot(_g.x, _g.z) || 1, nx = -_g.x / gl, nz = -_g.z / gl;
      const vn = v.x * nx + v.z * nz;
      if (vn < 0) { v.x -= nx * vn * 1.3; v.z -= nz * vn * 1.3; if (-vn > 3) this.impacts.push({ force: -vn * 0.8, x: p.x, z: p.z }); }
      p.x = ox; p.z = oz; gh = ghPrev;
    }
    const groundVy = Math.min((gh - ghPrev) / dt, 18);
    if (this.grounded) {
      v.y -= 22 * dt;
      if (groundVy < v.y - 1.8 && spd > 8) {
        this.grounded = false; this.airTime = 0;
        p.y += v.y * dt;
      } else { p.y = gh; v.y = groundVy; }
    } else {
      v.y -= 13.5 * dt;
      p.y += v.y * dt;
      this.airTime += dt;
      if (p.y <= gh) {
        const impact = groundVy - v.y;
        this.landing = impact;
        if (impact > 9) { v.x *= 0.95; v.z *= 0.95; }
        p.y = gh; v.y = Math.min(groundVy, 4);
        this.grounded = true;
        this.lastAir = this.airTime;
        if (this.airTime > 0.3) { this.landCount = (this.landCount || 0) + 1; this.landAir = this.airTime; }
        this.airTime = 0;
      }
    }
    // Wasser
    if (gh < -0.7 && p.y < 0.3) {
      this.inWater += dt;
      const k = Math.exp(-2.8 * dt); v.x *= k; v.z *= k;
    } else this.inWater = 0;
    // Weltgrenze
    const lim = 1250;
    if (Math.abs(p.x) > lim) { p.x = Math.sign(p.x) * lim; v.x *= -0.3; }
    if (Math.abs(p.z) > lim) { p.z = Math.sign(p.z) * lim; v.z *= -0.3; }

    this.collideStatic();

    // Anzeige-Werte
    vf = v.x * Math.sin(this.yaw) + v.z * Math.cos(this.yaw);
    this.vf = vf;
    this.speedKmh = Math.hypot(v.x, v.z) * 3.6;
    this.wheelRot += vf / (this.dims.wR || 0.34) * dt;
    // Gang / Drehzahl
    const tp = st.top / 3.6;
    if (vf < -0.5) { this.gear = -1; this.rpm = clamp(-vf / (tp * 0.22), 0.15, 1); }
    else {
      if (this.gear < 1) this.gear = 1;
      if (this.gear < 6 && vf > GEARS[this.gear - 1] * tp * 0.98) { this.gear++; this.shift = 0.16; }
      else if (this.gear > 1 && vf < GEARS[this.gear - 2] * tp * 0.8) this.gear--;
      const lo = this.gear > 1 ? GEARS[this.gear - 2] * tp * 0.62 : 0;
      const t = clamp((vf - lo) / (GEARS[this.gear - 1] * tp - lo), 0, 1.05);
      const target = this.grounded ? lerp(0.22, 1, t) + (inp.throttle && vf < 3 ? 0.25 : 0) : lerp(this.rpm, inp.throttle ? 1 : 0.3, 0.05);
      this.rpm = damp(this.rpm, clamp(target, 0.16, 1.05), 14, dt);
    }
    // Ausrichtung am Boden
    const tUp = this.grounded ? new THREE.Vector3(-_g.x, 1, -_g.z).normalize() : this.up;
    this.up.lerp(tUp, 1 - Math.exp(-10 * dt)).normalize();
  }

  circles() {
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), h = this.half;
    return [[this.pos.x + sy * h, this.pos.z + cy * h], [this.pos.x - sy * h, this.pos.z - cy * h]];
  }

  collideStatic() {
    const W = this.world, r = this.rad, p = this.pos, v = this.vel;
    const s = ++stamp;
    for (const [cx0, cz0] of this.circles()) {
      let cx = cx0, cz = cz0;
      const seen = [];
      for (const ox of [-r, r]) for (const oz of [-r, r]) {
        const list = W.near(cx + ox, cz + oz);
        if (seen.includes(list)) continue;
        seen.push(list);
        for (const c of list) {
          if (c._s === s) continue;
          c._s = s;
          let nx, nz, pen;
          if (c.t === 0) {
            const dx = cx - c.x, dz = cz - c.z, d = Math.hypot(dx, dz);
            pen = r + c.r - d;
            if (pen <= 0) continue;
            nx = d > 1e-4 ? dx / d : 1; nz = d > 1e-4 ? dz / d : 0;
          } else {
            const dx = cx - c.x, dz = cz - c.z;
            const lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
            const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz);
            let ex = lx - qx, ez = lz - qz, d = Math.hypot(ex, ez);
            if (d > r) continue;
            if (d < 1e-4) { // innen: kürzester Weg raus
              const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
              if (px < pz) { ex = Math.sign(lx) || 1; ez = 0; pen = px + r; } else { ex = 0; ez = Math.sign(lz) || 1; pen = pz + r; }
              d = 1;
            } else pen = r - d;
            ex /= d; ez /= d;
            nx = ex * c.c + ez * c.s; nz = -ex * c.s + ez * c.c;
          }
          p.x += nx * pen; p.z += nz * pen; cx += nx * pen; cz += nz * pen;
          const vn = v.x * nx + v.z * nz;
          if (vn < 0) {
            v.x -= nx * vn * 1.3; v.z -= nz * vn * 1.3;
            const f = -vn;
            if (f > 4) { const k = clamp(1 - f / 90, 0.6, 0.97); v.x *= k; v.z *= k; this.yawRate += (Math.random() - 0.5) * f * 0.05; }
            this.impacts.push({ force: f, x: cx - nx * r, z: cz - nz * r });
          }
        }
      }
    }
  }

  // Zerstörbare Dinge berühren → Liste der getroffenen
  touchSmash(out) {
    const W = this.world, r = this.rad + 0.2;
    for (const [cx, cz] of this.circles()) {
      for (const o of W.near(cx, cz, W.sgrid)) {
        if (!o.alive) continue;
        if (Math.hypot(cx - o.x, cz - o.z) < r + o.r && this.pos.y < o.y + 4) {
          o.alive = false;
          out.push(o);
          const k = o.kind === 'hay' ? 0.9 : o.kind === 'poster' ? 0.94 : 0.985;
          this.vel.x *= k; this.vel.z *= k;
        }
      }
    }
  }
}

// Auto-gegen-Auto (a = Spieler-Fahrzeug, b = {x,z,yaw,half,rad,vx,vz})
export function carContact(ac, bc, ra, rb) {
  let best = null;
  for (const [ax, az] of ac) for (const [bx, bz] of bc) {
    const dx = ax - bx, dz = az - bz, d = Math.hypot(dx, dz), pen = ra + rb - d;
    if (pen > 0 && (!best || pen > best.pen)) best = { nx: d > 1e-4 ? dx / d : 1, nz: d > 1e-4 ? dz / d : 0, pen };
  }
  return best;
}
