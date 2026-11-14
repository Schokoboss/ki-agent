import * as THREE from 'three';
import { Partikel, type PartikelStart } from '../engine/partikel';
import { weltMaterial, GLSL_UMGEBUNG } from '../engine/shader';
import type { Fahrzeug } from '../physik/fahrzeug';
import { U, UNTERGRUENDE } from '../physik/untergrund';
import type { PhysikEreignis } from '../physik/physikwelt';
import { OBJ } from '../welt/objekte';

const _p: PartikelStart = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, leben: 1, groesse0: 1, groesse1: 1, r: 1, g: 1, b: 1, alpha: 1, schwere: 0, bremse: 0, art: 0 };
let _saat = 1;
function zf(): number {
  _saat = (Math.imul(_saat, 1664525) + 1013904223) | 0;
  return (_saat >>> 0) / 4294967296;
}

/** Reifenspuren: Ringpuffer aus Vierecken auf der Fahrbahn. */
class Reifenspuren {
  readonly netz: THREE.Mesh;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly alpha: Float32Array;
  private readonly aPos: THREE.BufferAttribute;
  private readonly aAlpha: THREE.BufferAttribute;
  private zeiger = 0;

  constructor(max: number) {
    this.max = max;
    this.pos = new Float32Array(max * 4 * 3);
    this.alpha = new Float32Array(max * 4);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3); this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1); this.aAlpha.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('staerke', this.aAlpha);
    const idx = new Uint16Array(max * 6);
    for (let i = 0; i < max; i++) { const b = i * 4; idx.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], i * 6); }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = weltMaterial({
      vertex: /* glsl */ `attribute float staerke; varying float vS; varying vec3 vWelt;
        void main() { vS = staerke; vWelt = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragment: /* glsl */ `${GLSL_UMGEBUNG} varying float vS; varying vec3 vWelt;
        void main() { gl_FragColor = vec4(ausgabe(nebel(vec3(0.012), vWelt)), vS * 0.62); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    mat.polygonOffset = true; mat.polygonOffsetFactor = -3; mat.polygonOffsetUnits = -6;
    this.netz = new THREE.Mesh(geo, mat);
    this.netz.frustumCulled = false;
    this.netz.renderOrder = 2;
  }

  /** Fügt ein Spurstück zwischen (a) und (b) mit Breite und Querrichtung (qx, qz) hinzu. */
  stueck(ax: number, ay: number, az: number, bx: number, by: number, bz: number, qx: number, qz: number, sa: number, sb: number): void {
    const o = this.zeiger * 12, p = this.pos;
    p[o] = ax + qx; p[o + 1] = ay + 0.03; p[o + 2] = az + qz;
    p[o + 3] = ax - qx; p[o + 4] = ay + 0.03; p[o + 5] = az - qz;
    p[o + 6] = bx + qx; p[o + 7] = by + 0.03; p[o + 8] = bz + qz;
    p[o + 9] = bx - qx; p[o + 10] = by + 0.03; p[o + 11] = bz - qz;
    const a = this.zeiger * 4;
    this.alpha[a] = sa; this.alpha[a + 1] = sa; this.alpha[a + 2] = sb; this.alpha[a + 3] = sb;
    this.zeiger = (this.zeiger + 1) % this.max;
    this.aPos.needsUpdate = true; this.aAlpha.needsUpdate = true;
  }
}

interface SpurZustand { aktiv: boolean; x: number; y: number; z: number; s: number }

/** Sichtbare Effekte rund ums Fahren: Reifenrauch, Staub, Gischt, Splitter, Funken, Reifenspuren. */
export class FahrEffekte {
  readonly partikel: Partikel;
  private readonly spuren: Reifenspuren;
  private readonly spurZustand = new Map<Fahrzeug, SpurZustand[]>();
  private rest = 0;

  constructor(szene: THREE.Object3D, kapazitaet: number) {
    this.partikel = new Partikel(kapazitaet);
    this.spuren = new Reifenspuren(700);
    szene.add(this.partikel.netz, this.spuren.netz);
  }

  vergiss(f: Fahrzeug): void { this.spurZustand.delete(f); }

  /** Einmal je Bild und Auto: erzeugt Partikel und Spuren aus dem Radzustand. `nah` = im Detailbereich. */
  fahrzeug(f: Fahrzeug, dt: number, naesse: number, nah: boolean): void {
    let sp = this.spurZustand.get(f);
    if (!sp) { sp = [0, 1, 2, 3].map(() => ({ aktiv: false, x: 0, y: 0, z: 0, s: 0 })); this.spurZustand.set(f, sp); }
    const tempo = f.tempo;
    for (let i = 0; i < 4; i++) {
      const R = f.raeder[i];
      const z = sp[i];
      if (!R.kontakt) { z.aktiv = false; continue; }
      const ug = UNTERGRUENDE[R.untergrund];
      const hart = ug.klang === 'asphalt';
      const rutsch = R.rutsch;
      // Reifenspuren auf festem Belag
      const staerke = hart ? Math.min(1, Math.max(0, (rutsch - 1.15) * 1.2)) : 0;
      if (staerke > 0.02 && nah) {
        if (z.aktiv) {
          const dx = R.kx - z.x, dz = R.kz - z.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.35) {
            const b = 0.11;
            this.spuren.stueck(z.x, z.y, z.z, R.kx, R.ky, R.kz, (-dz / d) * b, (dx / d) * b, z.s, staerke);
            z.x = R.kx; z.y = R.ky; z.z = R.kz; z.s = staerke;
          }
        } else { z.aktiv = true; z.x = R.kx; z.y = R.ky; z.z = R.kz; z.s = 0; }
      } else z.aktiv = false;
      if (!nah) continue;
      // Partikelrate: Rauch bei Schlupf auf Asphalt, Staub auf losem Grund, Gischt bei Nässe
      const p = _p;
      p.x = R.kx + (zf() - 0.5) * 0.2; p.y = R.ky + 0.12; p.z = R.kz + (zf() - 0.5) * 0.2;
      const schlupfV = Math.abs(R.schlupfL) * Math.max(tempo, 3) + Math.abs(Math.sin(R.schlupfW)) * tempo;
      if (hart) {
        if (rutsch > 1.5 && schlupfV > 3 && zf() < Math.min(1, (rutsch - 1.5) * 0.6) * dt * 70) {
          p.vx = f.v.x * 0.25 + (zf() - 0.5) * 1.5; p.vy = 0.7 + zf() * 0.9; p.vz = f.v.z * 0.25 + (zf() - 0.5) * 1.5;
          p.leben = 0.9 + zf() * 0.9; p.groesse0 = 0.35; p.groesse1 = 2.2 + zf();
          const h = 0.78 + zf() * 0.15; p.r = h; p.g = h; p.b = h; p.alpha = 0.34;
          p.schwere = -0.03; p.bremse = 1.6; p.art = 0;
          this.partikel.erzeuge(p);
        }
        if (naesse > 0.25 && tempo > 12 && zf() < dt * 24 * naesse) {
          p.vx = f.v.x * 0.5 + (zf() - 0.5) * 2; p.vy = 1.2 + zf() * 1.6; p.vz = f.v.z * 0.5 + (zf() - 0.5) * 2;
          p.leben = 0.5 + zf() * 0.4; p.groesse0 = 0.3; p.groesse1 = 1.6;
          p.r = 0.8; p.g = 0.86; p.b = 0.92; p.alpha = 0.22 * naesse; p.schwere = 0.4; p.bremse = 1.2; p.art = 0;
          this.partikel.erzeuge(p);
        }
      } else if (ug.staubMenge > 0) {
        const menge = ug.staubMenge * Math.min(1.6, (tempo / 22) * (0.35 + Math.min(2, rutsch) * 0.6) + schlupfV * 0.05) * (R.untergrund === U.FLACHWASSER ? 1 : 1 - naesse * 0.75);
        if (tempo > 2.5 && zf() < menge * dt * 42) {
          const wasser = R.untergrund === U.FLACHWASSER;
          p.vx = f.v.x * 0.3 + (zf() - 0.5) * 2.2; p.vy = (wasser ? 2.5 : 0.8) + zf() * 1.4; p.vz = f.v.z * 0.3 + (zf() - 0.5) * 2.2;
          p.leben = wasser ? 0.6 : 1.1 + zf() * 1.3; p.groesse0 = 0.4; p.groesse1 = wasser ? 1.6 : 2.6 + zf() * 1.6;
          p.r = ug.staub[0]; p.g = ug.staub[1]; p.b = ug.staub[2]; p.alpha = wasser ? 0.5 : 0.3;
          p.schwere = wasser ? 0.8 : -0.01; p.bremse = 1.3; p.art = 0;
          this.partikel.erzeuge(p);
          // aufgewirbelte Steinchen
          if (R.untergrund === U.SCHOTTER && zf() < 0.25) {
            p.vx = f.v.x * 0.4 + (zf() - 0.5) * 4; p.vy = 1.5 + zf() * 2.5; p.vz = f.v.z * 0.4 + (zf() - 0.5) * 4;
            p.leben = 0.7; p.groesse0 = 0.05; p.groesse1 = 0.04; p.r = 0.4; p.g = 0.36; p.b = 0.3; p.alpha = 1; p.schwere = 1; p.bremse = 0.2; p.art = 1;
            this.partikel.erzeuge(p);
          }
        }
      }
    }
  }

  /** Verarbeitet Physikereignisse (Aufprall, Zerstörung, Landung). */
  ereignis(e: PhysikEreignis): void {
    const p = _p;
    if (e.art === 'zerstoert') {
      const holz = e.objekt === OBJ.ZAUN || e.objekt === OBJ.KISTE, stroh = e.objekt === OBJ.HEUBALLEN;
      const farbe: [number, number, number] = stroh ? [0.7, 0.57, 0.24] : holz ? [0.38, 0.26, 0.14] : e.objekt === OBJ.PYLON ? [0.9, 0.32, 0.04] : e.objekt === OBJ.LEITPFOSTEN ? [0.85, 0.85, 0.85] : [0.5, 0.52, 0.55];
      const n = stroh ? 22 : 12;
      for (let i = 0; i < n; i++) {
        p.x = e.x + (zf() - 0.5) * 0.8; p.y = e.y + 0.3 + zf() * 1.0; p.z = e.z + (zf() - 0.5) * 0.8;
        const v = e.staerke * (0.35 + zf() * 0.5);
        p.vx = -e.nx * v + (zf() - 0.5) * 5; p.vy = 2 + zf() * 5; p.vz = -e.nz * v + (zf() - 0.5) * 5;
        p.leben = 1.1 + zf() * 0.9; p.groesse0 = stroh ? 0.12 : 0.1 + zf() * 0.16; p.groesse1 = p.groesse0 * 0.8;
        const h = 0.75 + zf() * 0.5; p.r = farbe[0] * h; p.g = farbe[1] * h; p.b = farbe[2] * h; p.alpha = 1;
        p.schwere = 1; p.bremse = 0.4; p.art = 1;
        this.partikel.erzeuge(p);
      }
    } else if (e.art === 'aufprall' || e.art === 'autokontakt') {
      const n = Math.min(14, Math.round(e.staerke * 1.2));
      for (let i = 0; i < n; i++) {
        p.x = e.x; p.y = e.y + 0.2; p.z = e.z;
        p.vx = e.nx * (2 + zf() * 6) + (zf() - 0.5) * 8; p.vy = 1 + zf() * 4; p.vz = e.nz * (2 + zf() * 6) + (zf() - 0.5) * 8;
        p.leben = 0.25 + zf() * 0.35; p.groesse0 = 0.06; p.groesse1 = 0.02;
        p.r = 1; p.g = 0.7; p.b = 0.25; p.alpha = 1; p.schwere = 0.9; p.bremse = 0.5; p.art = 2;
        this.partikel.erzeuge(p);
      }
    } else if (e.art === 'landung') {
      for (let i = 0; i < 8; i++) {
        p.x = e.x + (zf() - 0.5) * 2; p.y = e.y - 0.3; p.z = e.z + (zf() - 0.5) * 2;
        p.vx = (zf() - 0.5) * 6; p.vy = 0.5 + zf(); p.vz = (zf() - 0.5) * 6;
        p.leben = 0.8 + zf() * 0.6; p.groesse0 = 0.5; p.groesse1 = 2.4;
        p.r = 0.7; p.g = 0.66; p.b = 0.6; p.alpha = 0.25; p.schwere = 0; p.bremse = 2; p.art = 0;
        this.partikel.erzeuge(p);
      }
    }
  }

  /** Regen oder Schnee im Bereich vor der Kamera. */
  niederschlag(kamera: THREE.Vector3, vx: number, vz: number, staerke: number, schnee: boolean, dt: number): void {
    if (staerke <= 0.02) return;
    this.rest += staerke * dt * (schnee ? 110 : 260);
    const p = _p;
    while (this.rest >= 1) {
      this.rest -= 1;
      p.x = kamera.x + vx * 0.6 + (zf() - 0.5) * 34; p.y = kamera.y + 2 + zf() * 9; p.z = kamera.z + vz * 0.6 + (zf() - 0.5) * 34;
      if (schnee) {
        p.vx = (zf() - 0.5) * 2; p.vy = -1.6; p.vz = (zf() - 0.5) * 2;
        p.leben = 2.2; p.groesse0 = 0.045; p.groesse1 = 0.045; p.r = 0.95; p.g = 0.96; p.b = 1; p.alpha = 0.9; p.schwere = 0; p.bremse = 0; p.art = 0;
      } else {
        p.vx = 0; p.vy = -17; p.vz = 0;
        p.leben = 0.55; p.groesse0 = 0.16; p.groesse1 = 0.16; p.r = 0.72; p.g = 0.78; p.b = 0.86; p.alpha = 0.34; p.schwere = 0; p.bremse = 0; p.art = 3;
      }
      this.partikel.erzeuge(p);
    }
  }

  aktualisiere(dt: number): void { this.partikel.aktualisiere(dt); }
}
