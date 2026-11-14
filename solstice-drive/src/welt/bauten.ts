import * as THREE from 'three';
import { Netzbauer, objektMaterial, type Farbe } from '../engine/netzbau';
import { hash2 } from '../engine/zufall';
import type { Hindernisraster } from '../physik/kollision';
import { OBJ, type Objektverwaltung } from './objekte';
import type { Weltkarte } from './weltkarte';

const WAND: Farbe[] = [[0.78, 0.74, 0.66], [0.72, 0.42, 0.3], [0.8, 0.66, 0.36], [0.5, 0.62, 0.72], [0.74, 0.74, 0.76], [0.62, 0.36, 0.34], [0.86, 0.82, 0.74]];
const DACH: Farbe = [0.3, 0.14, 0.1], DACH_FLACH: Farbe = [0.22, 0.22, 0.23], GLAS: Farbe = [0.05, 0.08, 0.12], LICHT: Farbe = [1.0, 0.8, 0.45];
const STAHL: Farbe = [0.3, 0.32, 0.35], HOLZ: Farbe = [0.34, 0.22, 0.12], BETON: Farbe = [0.5, 0.5, 0.49];
const BUNT: Farbe[] = [[0.75, 0.12, 0.1], [0.1, 0.3, 0.62], [0.85, 0.55, 0.06], [0.12, 0.45, 0.25], [0.5, 0.5, 0.52], [0.8, 0.8, 0.78]];
const FEST: Farbe[] = [[0.95, 0.42, 0.06], [0.82, 0.12, 0.42], [0.36, 0.18, 0.86], [0.98, 0.72, 0.1]];

/** Sammelt Geometrie eines Bezirks und meldet Kollisionsrechtecke an. */
class Baustelle {
  readonly b = new Netzbauer();
  constructor(readonly karte: Weltkarte, readonly hindernisse: Hindernisraster) {}

  boden(x: number, z: number): number { return this.karte.hoeheGelaende(x, z); }

  hindernis(x: number, z: number, breite: number, tiefe: number, gier: number, y0: number, y1: number): void {
    this.hindernisse.fuege({ x, z, hx: breite / 2, hz: tiefe / 2, gier, y0, y1 });
  }

  /** Haus mit Fensterbändern. dach: 0 flach, 1 Satteldach. */
  haus(x: number, z: number, breite: number, tiefe: number, hoehe: number, gier: number, wand: Farbe, dach = 0, saat = 0): void {
    const b = this.b;
    const y0 = this.boden(x, z);
    b.quader(x, y0 + hoehe / 2 - 1, z, breite, hoehe + 2, tiefe, wand, gier, 0, true, false, dach ? DACH : DACH_FLACH);
    this.hindernis(x, z, breite, tiefe, gier, y0 - 2, y0 + hoehe);
    const c = Math.cos(gier), s = Math.sin(gier);
    const etagen = Math.max(1, Math.floor((hoehe - 1.2) / 3.3));
    // Fensterbänder auf allen vier Seiten
    for (let seite = 0; seite < 4; seite++) {
      const lang = seite % 2 === 0 ? breite : tiefe, abstand = (seite % 2 === 0 ? tiefe : breite) / 2 + 0.04;
      const wg = gier + (seite * Math.PI) / 2;
      const nx = Math.sin(wg), nz = Math.cos(wg); // Außenrichtung der Seite
      const tx = Math.cos(wg), tz = -Math.sin(wg); // entlang der Seite
      const teile = Math.max(1, Math.round(lang / 9));
      for (let e = 0; e < etagen; e++) {
        const y = y0 + 1.7 + e * 3.3;
        for (let t = 0; t < teile; t++) {
          const u0 = -lang / 2 + (t + 0.12) * (lang / teile), u1 = -lang / 2 + (t + 0.88) * (lang / teile);
          const an = hash2(Math.round(x) + seite * 7 + t, Math.round(z) + e * 13, saat + 5) < 0.45;
          const p = (u: number, h: number) => ({ x: x + nx * abstand + tx * u, y: y + h, z: z + nz * abstand + tz * u });
          b.viereck(p(u0, 0), p(u1, 0), p(u1, 1.5), p(u0, 1.5), an ? LICHT : GLAS, an ? 2 : 0);
        }
      }
    }
    if (dach) {
      // Satteldach: First entlang der längeren Seite
      const first = y0 + hoehe + Math.min(breite, tiefe) * 0.32;
      const hb = breite / 2 + 0.4, ht = tiefe / 2 + 0.4;
      const p = (lx: number, lz: number, y: number) => ({ x: x + lx * c + lz * s, y, z: z - lx * s + lz * c });
      const yT = y0 + hoehe;
      if (breite >= tiefe) {
        b.viereck(p(-hb, ht, yT), p(hb, ht, yT), p(hb, 0, first), p(-hb, 0, first), DACH);
        b.viereck(p(hb, -ht, yT), p(-hb, -ht, yT), p(-hb, 0, first), p(hb, 0, first), DACH);
        b.dreieck(p(hb, ht, yT).x, yT, p(hb, ht, yT).z, p(hb, -ht, yT).x, yT, p(hb, -ht, yT).z, p(hb, 0, first).x, first, p(hb, 0, first).z, wand);
        b.dreieck(p(-hb, -ht, yT).x, yT, p(-hb, -ht, yT).z, p(-hb, ht, yT).x, yT, p(-hb, ht, yT).z, p(-hb, 0, first).x, first, p(-hb, 0, first).z, wand);
      } else {
        b.viereck(p(hb, ht, yT), p(hb, -ht, yT), p(0, -ht, first), p(0, ht, first), DACH);
        b.viereck(p(-hb, -ht, yT), p(-hb, ht, yT), p(0, ht, first), p(0, -ht, first), DACH);
        b.dreieck(p(-hb, ht, yT).x, yT, p(-hb, ht, yT).z, p(hb, ht, yT).x, yT, p(hb, ht, yT).z, p(0, ht, first).x, first, p(0, ht, first).z, wand);
        b.dreieck(p(hb, -ht, yT).x, yT, p(hb, -ht, yT).z, p(-hb, -ht, yT).x, yT, p(-hb, -ht, yT).z, p(0, -ht, first).x, first, p(0, -ht, first).z, wand);
      }
    }
  }

  kiste(x: number, z: number, sx: number, sy: number, sz: number, gier: number, f: Farbe, yVersatz = 0): void {
    const y0 = this.boden(x, z) + yVersatz;
    this.b.quader(x, y0 + sy / 2, z, sx, sy, sz, f, gier);
    this.hindernis(x, z, sx, sz, gier, y0 - 1, y0 + sy);
  }

  /** Fachwerkturm aus vier Stäben. */
  turm(x: number, z: number, breite: number, hoehe: number, f: Farbe, kollision = true): void {
    const y0 = this.boden(x, z);
    const h = breite / 2;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) this.b.stab(x + sx * h, y0, z + sz * h, x + sx * h, y0 + hoehe, z + sz * h, 0.35, f);
    for (let y = 3; y < hoehe; y += 5) {
      this.b.stab(x - h, y0 + y, z - h, x + h, y0 + y, z - h, 0.2, f); this.b.stab(x - h, y0 + y, z + h, x + h, y0 + y, z + h, 0.2, f);
      this.b.stab(x - h, y0 + y, z - h, x - h, y0 + y, z + h, 0.2, f); this.b.stab(x + h, y0 + y, z - h, x + h, y0 + y, z + h, 0.2, f);
    }
    if (kollision) this.hindernis(x, z, breite, breite, 0, y0 - 1, y0 + hoehe);
  }

  netz(): THREE.Mesh {
    const m = new THREE.Mesh(this.b.geometrie(), objektMaterial(true));
    m.matrixAutoUpdate = false;
    return m;
  }
}

/** Drehbares Riesenrad (wird von der Inselwelt animiert). */
export interface Bauten {
  gruppe: THREE.Group;
  riesenrad: THREE.Object3D | null;
}

/** Baut alle Gebäude der Insel und trägt ihre Kollisionsrechtecke ein. */
export function baueBauten(karte: Weltkarte, hindernisse: Hindernisraster, objekte: Objektverwaltung): Bauten {
  const gruppe = new THREE.Group();
  gruppe.matrixAutoUpdate = false;
  let riesenrad: THREE.Object3D | null = null;

  // ---------------- Hafenstadt Aurora ----------------
  {
    const st = new Baustelle(karte, hindernisse);
    const SX = [-3060, -2840, -2620, -2400], SZ = [1880, 2100, 2320];
    const rand = 13; // Abstand Hauskante – Straßenachse
    // Blöcke im Raster und ein Ring darum
    for (let bi = -1; bi < SX.length; bi++) {
      for (let bj = -1; bj < SZ.length; bj++) {
        const x0 = bi < 0 ? SX[0] - 200 : SX[bi], x1 = bi >= SX.length - 1 ? SX[SX.length - 1] + 200 : SX[bi + 1];
        const z0 = bj < 0 ? SZ[0] - 200 : SZ[bj], z1 = bj >= SZ.length - 1 ? SZ[SZ.length - 1] + 200 : SZ[bj + 1];
        const aussen = bi < 0 || bj < 0 || bi >= SX.length - 1 || bj >= SZ.length - 1;
        const kern = !aussen && bi === 1;
        // Häuser entlang der vier Blockkanten
        const kanten: [number, number, number, number, number][] = [
          [x0 + rand, z0 + rand, x1 - rand, z0 + rand, 0], [x0 + rand, z1 - rand, x1 - rand, z1 - rand, Math.PI],
          [x0 + rand, z0 + rand, x0 + rand, z1 - rand, Math.PI / 2], [x1 - rand, z0 + rand, x1 - rand, z1 - rand, -Math.PI / 2],
        ];
        for (let k = 0; k < 4; k++) {
          const [ax, az, bx, bz, gier] = kanten[k];
          const lang = Math.hypot(bx - ax, bz - az);
          const anzahl = Math.floor(lang / 46);
          for (let h = 0; h < anzahl; h++) {
            const zf = hash2(bi * 31 + h + k * 7, bj * 17 + k, 3);
            if (aussen && zf < 0.45) continue;
            const t = (h + 0.5) / anzahl;
            const breite = 26 + zf * 12, tiefe = 20 + hash2(bi + h, bj + k, 9) * 10;
            // Hausmitte von der Kante nach innen versetzen
            const innenX = k === 2 ? 1 : k === 3 ? -1 : 0, innenZ = k === 0 ? 1 : k === 1 ? -1 : 0;
            const x = ax + (bx - ax) * t + innenX * tiefe / 2, z = az + (bz - az) * t + innenZ * tiefe / 2;
            if (karte.hoeheGelaende(x, z) < 3.5) continue;
            // Ecken freihalten, damit sich Häuser benachbarter Kanten nicht durchdringen
            if (t * lang < tiefe + 6 || (1 - t) * lang < tiefe + 6) { if (k >= 2) continue; }
            const hoehe = kern ? 22 + zf * 30 : aussen ? 7 + zf * 8 : 11 + zf * 16;
            st.haus(x, z, k < 2 ? breite : tiefe, k < 2 ? tiefe : breite, hoehe, 0, WAND[Math.floor(hash2(bi + h * 3, bj + k * 5, 4) * WAND.length)], hoehe < 13 ? 1 : 0, bi * 100 + bj * 10 + k);
            void gier;
          }
        }
      }
    }
    // Hafen: Lagerhallen, Containerstapel, Kräne am Kai
    for (let i = 0; i < 4; i++) {
      const z = 1900 + i * 150;
      if (Math.abs(z - 2100) < 40) continue;
      st.haus(-3300, z, 44, 70, 11, 0, WAND[4], 1, 50 + i);
    }
    for (let i = 0; i < 26; i++) {
      const x = -3395 + (i % 2) * 14 + hash2(i, 1, 60) * 3, z = 1830 + Math.floor(i / 2) * 44 + hash2(i, 2, 61) * 10;
      if (Math.abs(z - 2100) < 26 || karte.hoeheGelaende(x, z) < 2.2) continue;
      const stapel = 1 + Math.floor(hash2(i, 3, 62) * 3);
      for (let s = 0; s < stapel; s++) st.kiste(x, z, 2.6, 2.6, 12.2, hash2(i, 4, 63) < 0.5 ? 0 : Math.PI / 2, BUNT[Math.floor(hash2(i, s, 64) * BUNT.length)], s * 2.6);
    }
    for (const z of [1960, 2240]) {
      const x = -3420;
      st.turm(x, z, 9, 46, [0.85, 0.5, 0.05]);
      const y = st.boden(x, z) + 44;
      st.b.stab(x + 12, y, z, x - 34, y + 6, z, 1.6, [0.85, 0.5, 0.05]);
      st.b.stab(x, y + 12, z, x - 34, y + 6, z, 0.4, STAHL);
      st.b.quader(x, y + 2, z, 6, 4, 6, [0.2, 0.22, 0.25]);
    }
    // Leuchtturm auf der Leuchtfeuer-Insel
    {
      const x = -3395, z = -3160, y0 = st.boden(x, z);
      st.b.zylinder(x, y0 - 1, z, 4.2, 2.6, 30, 10, [0.9, 0.9, 0.88]);
      st.b.zylinder(x, y0 + 9, z, 3.72, 3.4, 4, 10, [0.75, 0.1, 0.08], 0, false);
      st.b.zylinder(x, y0 + 19, z, 3.12, 2.9, 4, 10, [0.75, 0.1, 0.08], 0, false);
      st.b.zylinder(x, y0 + 29, z, 3.4, 3.4, 0.5, 10, STAHL);
      st.b.zylinder(x, y0 + 29.5, z, 1.9, 1.9, 3, 8, LICHT, 1);
      st.b.zylinder(x, y0 + 32.5, z, 2.3, 0.2, 2.2, 8, [0.75, 0.1, 0.08]);
      st.hindernis(x, z, 7, 7, 0, y0 - 2, y0 + 30);
    }
    gruppe.add(st.netz());
  }

  // ---------------- Festivalgelände ----------------
  {
    const st = new Baustelle(karte, hindernisse);
    const b = st.b;
    const buehne = (x: number, z: number, gier: number, breite: number, farbe: Farbe) => {
      const y0 = st.boden(x, z);
      const c = Math.cos(gier), s = Math.sin(gier);
      const p = (lx: number, lz: number) => ({ x: x + lx * c + lz * s, z: z - lx * s + lz * c });
      // Podest, Rückwand mit Leuchtfläche, Dach auf vier Türmen, Lautsprechertürme
      b.quader(x, y0 + 0.9, z, breite, 1.8, 14, [0.08, 0.08, 0.09], gier);
      st.hindernis(x, z, breite, 14, gier, y0 - 1, y0 + 16);
      const rueck = p(0, -6.6);
      b.quader(rueck.x, y0 + 8, rueck.z, breite * 0.86, 12, 0.6, [0.05, 0.05, 0.06], gier);
      const schirm = p(0, -6.2);
      b.quader(schirm.x, y0 + 8.4, schirm.z, breite * 0.6, 7.5, 0.3, farbe, gier, 0.9);
      for (const [lx, lz] of [[-breite / 2, -6.5], [breite / 2, -6.5], [-breite / 2, 6.5], [breite / 2, 6.5]]) {
        const q = p(lx, lz);
        st.turm(q.x, q.z, 1.6, 16, STAHL, false);
      }
      b.quader(x, y0 + 16.4, z, breite + 3, 0.8, 16, [0.07, 0.07, 0.08], gier);
      for (const lx of [-breite / 2 - 5, breite / 2 + 5]) {
        const q = p(lx, 4);
        b.quader(q.x, y0 + 5, q.z, 3, 10, 3, [0.04, 0.04, 0.04], gier);
        st.hindernis(q.x, q.z, 3, 3, gier, y0 - 1, y0 + 10);
      }
      // Scheinwerferleiste
      for (let i = -3; i <= 3; i++) { const q = p((i * breite) / 8, 6.8); b.quader(q.x, y0 + 15.6, q.z, 0.7, 0.7, 0.7, FEST[(i + 3) % 4], gier, 1); }
    };
    buehne(345, 165, -Math.PI * 0.75, 44, FEST[1]);
    buehne(340, 545, -Math.PI * 0.25, 30, FEST[2]);
    // Zelte (Kegel) und Stände
    const zelt = (x: number, z: number, r: number, hoehe: number, f: Farbe, f2: Farbe) => {
      const y0 = st.boden(x, z);
      b.zylinder(x, y0, z, r, r, 2.6, 10, f2, 0, false);
      b.zylinder(x, y0 + 2.6, z, r * 1.12, 0.15, hoehe, 10, f);
      st.hindernis(x, z, r * 1.6, r * 1.6, 0, y0 - 1, y0 + 3);
    };
    for (let i = 0; i < 9; i++) {
      const w = (i / 9) * Math.PI * 0.42 + Math.PI * 1.03;
      zelt(150 + Math.sin(w) * (250 + (i % 2) * 70), 350 - Math.cos(w) * (250 + (i % 2) * 70), 7 + (i % 3) * 2, 6 + (i % 2) * 3, FEST[i % 4], [0.92, 0.9, 0.86]);
    }
    for (let i = 0; i < 12; i++) {
      // Stände entlang der Ost- und Westallee
      const seite = i % 2 ? 1 : -1, t = 60 + Math.floor(i / 2) * 26;
      for (const richtung of [-1, 1]) {
        const x = 150 + richtung * t, z = 350 + seite * 17;
        const y0 = st.boden(x, z);
        b.quader(x, y0 + 1.3, z, 7, 2.6, 5, [0.9, 0.88, 0.84]);
        b.quader(x, y0 + 3.0, z - seite * 0.6, 8, 0.4, 6.4, FEST[(i + (richtung > 0 ? 1 : 0)) % 4]);
        b.quader(x, y0 + 2.0, z - seite * 2.55, 5.6, 0.9, 0.12, LICHT, 0, 2);
        st.hindernis(x, z, 7, 5, 0, y0 - 1, y0 + 3);
      }
    }
    // Solstice-Tor über der Nordallee
    {
      const x = 150, z = 150, y0 = st.boden(x, z);
      for (const s of [-1, 1]) { b.quader(x + s * 11, y0 + 7, z, 2.4, 16, 2.4, FEST[0]); st.hindernis(x + s * 11, z, 2.4, 2.4, 0, y0 - 1, y0 + 14); }
      b.quader(x, y0 + 13.6, z, 26, 2.8, 2.6, FEST[1]);
      b.quader(x, y0 + 13.6, z + 1.36, 20, 1.6, 0.1, LICHT, 0, 1);
      b.quader(x, y0 + 13.6, z - 1.36, 20, 1.6, 0.1, LICHT, 0, 1);
      for (let i = 0; i < 7; i++) b.zylinder(x - 9 + i * 3, y0 + 15, z, 0.7 - Math.abs(i - 3) * 0.08, 0.05, 3.2 - Math.abs(i - 3) * 0.6, 4, FEST[3], 0.7);
    }
    // Tribünen am Ring (Start/Ziel im Osten)
    for (const s of [-1, 1]) {
      const x = 590 + 20, z = 350 + s * 46, y0 = st.boden(x, z);
      for (let stufe = 0; stufe < 5; stufe++) b.quader(x + stufe * 1.6, y0 + 0.5 + stufe * 0.9, z, 1.6, 1 + stufe * 1.8, 36, stufe % 2 ? [0.7, 0.7, 0.72] : FEST[(stufe + (s > 0 ? 1 : 0)) % 4]);
      st.hindernis(x + 3.2, z, 8, 36, 0, y0 - 1, y0 + 6);
    }
    // Fahnenmasten rund um den Ring
    for (let i = 0; i < 24; i++) {
      const w = (i / 24) * Math.PI * 2 + 0.13;
      const x = 150 + Math.sin(w) * 466, z = 350 - Math.cos(w) * 466, y0 = st.boden(x, z);
      b.stab(x, y0, z, x, y0 + 11, z, 0.18, [0.8, 0.8, 0.82]);
      b.quader(x + 1.5, y0 + 9.4, z, 3, 2.4, 0.06, FEST[i % 4]);
    }
    gruppe.add(st.netz());
    // Riesenrad: Gestell fest, Rad dreht sich
    {
      const x = -40, z = 190, y0 = st.boden(x, z);
      const fest = new Baustelle(karte, hindernisse);
      for (const s of [-1, 1]) {
        fest.b.stab(x - 9, y0, z + s * 3, x, y0 + 30, z + s * 2.2, 0.8, [0.85, 0.85, 0.88]);
        fest.b.stab(x + 9, y0, z + s * 3, x, y0 + 30, z + s * 2.2, 0.8, [0.85, 0.85, 0.88]);
      }
      fest.hindernis(x, z, 20, 7, 0, y0 - 1, y0 + 8);
      gruppe.add(fest.netz());
      const rad = new Netzbauer();
      const R = 26;
      for (let i = 0; i < 16; i++) {
        const w0 = (i / 16) * Math.PI * 2, w1 = ((i + 1) / 16) * Math.PI * 2;
        for (const s of [-1.6, 1.6]) {
          rad.stab(Math.cos(w0) * R, Math.sin(w0) * R, s, Math.cos(w1) * R, Math.sin(w1) * R, s, 0.35, FEST[i % 4], 0.5);
          rad.stab(0, 0, s, Math.cos(w0) * R, Math.sin(w0) * R, s, 0.16, [0.85, 0.85, 0.88]);
        }
        rad.quader(Math.cos(w0) * R, Math.sin(w0) * R - 1.6, 0, 2.6, 2.4, 2.6, FEST[(i + 2) % 4]);
      }
      const netz = new THREE.Mesh(rad.geometrie(), objektMaterial(true));
      netz.position.set(x, y0 + 30, z);
      riesenrad = netz;
      gruppe.add(netz);
    }
    // Absperrgitter und Pylonen entlang der Alleen (zerstörbar)
    for (let i = 0; i < 14; i++) {
      const d = 70 + i * 24;
      for (const s of [-1, 1]) {
        objekte.setze(OBJ.ABSPERRUNG, 150 + s * 9.5, 350 - d, Math.PI / 2);
        objekte.setze(OBJ.ABSPERRUNG, 150 + s * 9.5, 350 + d, Math.PI / 2);
        if (i % 3 === 0) { objekte.setze(OBJ.PYLON, 150 + d, 350 + s * 7.5); objekte.setze(OBJ.FASS, 150 - d, 350 + s * 8.5); }
      }
    }
  }

  // ---------------- Dörfer und Einzelbauten ----------------
  {
    const st = new Baustelle(karte, hindernisse);
    const b = st.b;
    const dorf = (cx: number, cz: number, anzahl: number, saat: number, radius = 70) => {
      for (let i = 0; i < anzahl; i++) {
        const w = (i / anzahl) * Math.PI * 2 + hash2(i, saat, 1) * 0.6, r = radius * (0.45 + hash2(i, saat, 2) * 0.55);
        const x = cx + Math.sin(w) * r, z = cz + Math.cos(w) * r;
        const treffer = { strasse: -1, i: 0, t: 0, u: 0, abstand: 0 };
        if (karte.netz.naechste(x, z, 30, treffer) && treffer.abstand < karte.netz.strassen[treffer.strasse].halbbreite + 11) continue;
        const hx = karte.hoeheGelaende(x + 6, z) - karte.hoeheGelaende(x - 6, z), hz = karte.hoeheGelaende(x, z + 6) - karte.hoeheGelaende(x, z - 6);
        if (Math.abs(hx) + Math.abs(hz) > 3.5 || karte.hoeheGelaende(x, z) < 2.5) continue;
        st.haus(x, z, 9 + hash2(i, saat, 3) * 5, 7 + hash2(i, saat, 4) * 3, 4.5 + hash2(i, saat, 5) * 3, hash2(i, saat, 6) * Math.PI, WAND[Math.floor(hash2(i, saat, 7) * WAND.length)], 1, saat + i);
      }
    };
    dorf(760, -820, 12, 100, 95); // Bergdorf
    dorf(1450, -1500, 9, 200, 80); // Talkessel
    dorf(-1950, -1750, 6, 300); // Sägewerk
    dorf(-1390, -1240, 3, 400, 45); // Seehütte
    dorf(-820, 1900, 5, 500); // Hof Süd
    dorf(1950, 1750, 7, 600, 60); // Oase
    dorf(-150, 3380, 7, 700, 80); // Südkap
    dorf(3560, 150, 4, 800, 60); // Wattinsel
    dorf(-330, -2130, 8, 900, 85); // Nordbucht
    dorf(-2250, 380, 7, 1000, 80); // Westbucht
    dorf(1850, -3120, 6, 1100, 70); // Nordkap
    // Sternwarte: Sockel mit Kuppel
    {
      const x = 2262, z = -1322, y0 = st.boden(x, z);
      b.zylinder(x, y0 - 2, z, 9, 9, 8, 12, [0.86, 0.86, 0.84]);
      for (let ring = 0; ring < 4; ring++) {
        const r0 = 9 * Math.cos((ring / 4) * Math.PI / 2), r1 = 9 * Math.cos(((ring + 1) / 4) * Math.PI / 2);
        b.zylinder(x, y0 + 6 + 9 * Math.sin((ring / 4) * Math.PI / 2), z, r0, r1, 9 * (Math.sin(((ring + 1) / 4) * Math.PI / 2) - Math.sin((ring / 4) * Math.PI / 2)), 12, [0.92, 0.93, 0.95], 0, ring === 3);
      }
      st.hindernis(x, z, 16, 16, 0, y0 - 3, y0 + 14);
    }
    // Sägewerk: Halle und Holzstapel
    {
      st.haus(-1990, -1790, 30, 16, 7, 0.4, HOLZ, 1, 31);
      for (let i = 0; i < 5; i++) st.kiste(-1925 + i * 7, -1712 - (i % 2) * 5, 2.2, 1.6 + (i % 3) * 0.8, 9, 0.2 + i * 0.1, [0.5, 0.36, 0.2]);
    }
    // Hof Süd: Scheune und Silo
    {
      st.haus(-860, 1935, 22, 14, 7, 0.3, [0.55, 0.14, 0.1], 1, 41);
      const x = -842, z = 1958, y0 = st.boden(x, z);
      b.zylinder(x, y0 - 1, z, 3, 3, 13, 10, [0.75, 0.76, 0.78]); b.zylinder(x, y0 + 12, z, 3, 0.2, 2.2, 10, STAHL);
      st.hindernis(x, z, 5.4, 5.4, 0, y0 - 1, y0 + 13);
    }
    // Windräder an der Westküste (Türme mit festem Rotor)
    for (const [x, z] of [[-2950, -350], [-3000, -80], [-2900, 150]]) {
      const y0 = st.boden(x, z);
      if (y0 < 3) continue;
      b.zylinder(x, y0 - 1, z, 1.6, 0.9, 62, 8, [0.9, 0.9, 0.9]);
      b.quader(x, y0 + 61.5, z, 2, 2, 5, [0.9, 0.9, 0.9]);
      for (let i = 0; i < 3; i++) { const w = (i / 3) * Math.PI * 2 + x; b.stab(x, y0 + 61.5, z + 2.8, x + Math.cos(w) * 26, y0 + 61.5 + Math.sin(w) * 26, z + 2.8, 1.0, [0.93, 0.93, 0.93]); }
      st.hindernis(x, z, 3, 3, 0, y0 - 1, y0 + 60);
    }
    void BETON;
    gruppe.add(st.netz());
  }
  return { gruppe, riesenrad };
}
