// Admin: frei fliegen mit dem Kunstflugzeug (Arcade-Flug, man kann nicht abstürzen).
// Steuerung wie beim Fahren: ◀ ▶ / A D = Kurve (Schräglage), ▲ / W = hochziehen, ▼ / S = sinken,
// N₂O / Shift = Schub, HB / Leertaste = Luftbremse. Über dem Boden fängt sich das Flugzeug von selbst ab.
// Das (unsichtbare) Auto fliegt mit, damit Welt, Minikarte, Verkehr und Mitspieler die Position kennen.
import * as THREE from '../lib/three.module.min.js';
import { clone } from './models.js';
import { clamp, damp } from './util.js';

const _d = new THREE.Vector3(), _l = new THREE.Vector3();
const LIM = 1180; // Inselrand: hier dreht das Flugzeug sanft um

export class Flight {
  constructor(g) {
    this.g = g; this.on = false;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0; this.speed = 50;
    this.model = null; this.prop = null; this.camPos = null;
    // Stand-in für Tacho, Minikarte und Motorgeräusch (die erwarten ein Auto)
    this.fake = { pos: this.pos, yaw: 0, speedKmh: 0, rpm: 0.4, nitro: 1, nitroOn: false, gear: '✈', vf: 0, grounded: false, slipAmt: 0, surface: 1, stats: { top: 330, nitroCap: 1 } };
  }
  start() {
    const g = this.g, c = g.car;
    if (!this.model) {
      this.model = clone('plane');
      if (!this.model) return false;
      this.model.traverse(o => { if (o.name === 'prop') this.prop = o; });
    }
    g.scene.add(this.model);
    this.pos.set(c.pos.x, Math.max(c.pos.y, g.world.heightAt(c.pos.x, c.pos.z)) + 28, c.pos.z);
    this.yaw = c.yaw; this.pitch = 0.15; this.roll = 0; this.speed = Math.max(45, Math.abs(c.vf));
    g.carModel.visible = false;
    this.on = true; this.camPos = null;
    return true;
  }
  stop() {
    const g = this.g;
    if (!this.on) return;
    this.on = false;
    if (this.model) g.scene.remove(this.model);
    g.carModel.visible = true;
    // landen = auf die nächste Straße unter dir (wie „Zurücksetzen“)
    g.car.pos.set(this.pos.x, g.world.heightAt(this.pos.x, this.pos.z), this.pos.z); g.car.yaw = this.yaw;
    g.camY = undefined;
    g.respawn();
  }
  update(dt, inp) {
    const W = this.g.world;
    const turn = clamp(inp.steer || 0, -1, 1), up = (inp.throttle || 0) - (inp.brake || 0);
    const boost = inp.nitro ? 1 : 0, airbrake = inp.handbrake ? 1 : 0;
    // Schräglage aus der Lenkung, Kurve aus der Schräglage (koordiniert); steer > 0 = rechts
    this.roll = damp(this.roll, turn * 1.05, 3, dt);
    this.pitch = damp(this.pitch, clamp(up * 0.6, -0.6, 0.65), 2.2, dt);
    this.yaw -= Math.sin(this.roll) * 1.15 * dt;
    // Inselrand: zurück zur Mitte drehen
    if (Math.abs(this.pos.x) > LIM || Math.abs(this.pos.z) > LIM) {
      let d = Math.atan2(-this.pos.x, -this.pos.z) - this.yaw;
      while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      this.yaw += clamp(d, -1, 1) * 1.2 * dt;
    }
    // Tempo: Reise 55 m/s (~200 km/h), Schub ~320 km/h, Luftbremse ~110 km/h; Steigen kostet, Sinken bringt Tempo
    const target = boost ? 88 : airbrake ? 30 : 55;
    this.speed = clamp(damp(this.speed, target - this.pitch * 22, 0.8, dt), 24, 95);
    const cp = Math.cos(this.pitch);
    this.vel.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.vel, dt);
    // Boden (und Wasser) mit Abstand halten: im Tiefflug abfangen statt abstürzen
    const minY = Math.max(W.heightAt(this.pos.x, this.pos.z), 0) + 2.6;
    if (this.pos.y < minY) { this.pos.y = minY; if (this.pitch < 0.05) this.pitch = damp(this.pitch, 0.08, 6, dt); }
    this.pos.y = Math.min(this.pos.y, 420);
    this.pos.x = clamp(this.pos.x, -1240, 1240); this.pos.z = clamp(this.pos.z, -1240, 1240);
    // Modell: Nase = +z; positive x-Drehung senkt die Nase, positive z-Drehung = Schräglage rechts
    this.model.position.copy(this.pos);
    this.model.rotation.order = 'YXZ';
    this.model.rotation.set(-this.pitch, this.yaw, this.roll);
    if (this.prop) this.prop.rotation.z += dt * (40 + this.speed);
    // unsichtbares Auto fliegt mit (Welt-Streaming, Minikarte, Verkehr, Mitspieler)
    const c = this.g.car;
    c.pos.copy(this.pos); c.vel.copy(this.vel); c.yaw = this.yaw; c.vf = this.speed; c.speedKmh = this.speed * 3.6;
    const F = this.fake;
    F.yaw = this.yaw; F.speedKmh = this.speed * 3.6; F.vf = this.speed; F.nitroOn = !!boost;
    F.rpm = clamp(0.38 + Math.max(0, up) * 0.25 + boost * 0.35 - airbrake * 0.15, 0.2, 1);
  }
  // Verfolgerkamera hinter und über dem Flugzeug, weich nachgeführt
  camera(dt, cam) {
    const W = this.g.world, sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    _d.set(this.pos.x - sy * 15, this.pos.y + 4.2 - Math.sin(this.pitch) * 6, this.pos.z - cy * 15);
    if (!this.camPos) this.camPos = _d.clone(); else this.camPos.lerp(_d, 1 - Math.exp(-dt * 4.5));
    this.camPos.y = Math.max(this.camPos.y, Math.max(W.heightAt(this.camPos.x, this.camPos.z), 0) + 1.6);
    cam.position.copy(this.camPos);
    _l.copy(this.pos).addScaledVector(this.vel, 0.22);
    cam.lookAt(_l);
    cam.fov = clamp(60 + (this.speed - 55) * 0.3, 54, 74);
    cam.updateProjectionMatrix();
  }
}
