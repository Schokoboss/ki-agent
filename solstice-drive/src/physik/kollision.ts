import type { Fahrzeug } from './fahrzeug';

/** Statisches, orientiertes Rechteck-Hindernis (Gebäude, Container, Bühnen). */
export interface Hindernis {
  x: number; z: number;
  /** Halbe Ausdehnung entlang der lokalen Achsen. */
  hx: number; hz: number;
  /** Drehung um Y. */
  gier: number;
  /** Unter- und Oberkante. */
  y0: number; y1: number;
}

const ZELLE = 64;

/** Räumliches Raster statischer Hindernisse. */
export class Hindernisraster {
  private readonly zellen = new Map<number, Hindernis[]>();
  readonly alle: Hindernis[] = [];

  fuege(h: Hindernis): void {
    this.alle.push(h);
    const r = Math.hypot(h.hx, h.hz);
    const x0 = Math.floor((h.x - r) / ZELLE), x1 = Math.floor((h.x + r) / ZELLE), z0 = Math.floor((h.z - r) / ZELLE), z1 = Math.floor((h.z + r) / ZELLE);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const k = cz * 4096 + cx;
      let l = this.zellen.get(k);
      if (!l) { l = []; this.zellen.set(k, l); }
      l.push(h);
    }
  }

  bei(x: number, z: number): Hindernis[] | undefined {
    return this.zellen.get(Math.floor(z / ZELLE) * 4096 + Math.floor(x / ZELLE));
  }
}

/** Ergebnis einer Rechteck-Überlappung in der Ebene. */
export interface Ueberlappung {
  /** Normale (zeigt von B nach A). */
  nx: number; nz: number;
  tiefe: number;
  /** Kontaktpunkt. */
  px: number; pz: number;
}

const _u: Ueberlappung = { nx: 0, nz: 0, tiefe: 0, px: 0, pz: 0 };
const eckenA = new Float64Array(8), eckenB = new Float64Array(8);

function ecken(x: number, z: number, fx: number, fz: number, hl: number, hb: number, aus: Float64Array): void {
  // vorn = (fx, fz), links = (fz, -fx)
  const lx = fz, lz = -fx;
  aus[0] = x + fx * hl + lx * hb; aus[1] = z + fz * hl + lz * hb;
  aus[2] = x + fx * hl - lx * hb; aus[3] = z + fz * hl - lz * hb;
  aus[4] = x - fx * hl - lx * hb; aus[5] = z - fz * hl - lz * hb;
  aus[6] = x - fx * hl + lx * hb; aus[7] = z - fz * hl + lz * hb;
}

/**
 * Trennachsentest zweier orientierter Rechtecke (Mittelpunkt, Vorwärtsrichtung, halbe Länge/Breite).
 * Liefert null, wenn sie sich nicht überlappen.
 */
export function rechteckUeberlappung(
  ax: number, az: number, afx: number, afz: number, ahl: number, ahb: number,
  bx: number, bz: number, bfx: number, bfz: number, bhl: number, bhb: number,
): Ueberlappung | null {
  const dx = ax - bx, dz = az - bz;
  let best = 1e9, bnx = 0, bnz = 0;
  for (let achse = 0; achse < 4; achse++) {
    let nx: number, nz: number;
    if (achse === 0) { nx = afx; nz = afz; } else if (achse === 1) { nx = afz; nz = -afx; } else if (achse === 2) { nx = bfx; nz = bfz; } else { nx = bfz; nz = -bfx; }
    const ra = Math.abs(afx * nx + afz * nz) * ahl + Math.abs(afz * nx - afx * nz) * ahb;
    const rb = Math.abs(bfx * nx + bfz * nz) * bhl + Math.abs(bfz * nx - bfx * nz) * bhb;
    const d = dx * nx + dz * nz;
    const t = ra + rb - Math.abs(d);
    if (t <= 0) return null;
    if (t < best) { best = t; const s = d >= 0 ? 1 : -1; bnx = nx * s; bnz = nz * s; }
  }
  // Kontaktpunkt: Mittel der Ecken, die im jeweils anderen Rechteck liegen
  ecken(ax, az, afx, afz, ahl, ahb, eckenA);
  ecken(bx, bz, bfx, bfz, bhl, bhb, eckenB);
  let px = 0, pz = 0, n = 0;
  for (let i = 0; i < 4; i++) {
    const ex = eckenA[i * 2] - bx, ez = eckenA[i * 2 + 1] - bz;
    if (Math.abs(ex * bfx + ez * bfz) <= bhl + 0.02 && Math.abs(ex * bfz - ez * bfx) <= bhb + 0.02) { px += eckenA[i * 2]; pz += eckenA[i * 2 + 1]; n++; }
    const gx = eckenB[i * 2] - ax, gz = eckenB[i * 2 + 1] - az;
    if (Math.abs(gx * afx + gz * afz) <= ahl + 0.02 && Math.abs(gx * afz - gz * afx) <= ahb + 0.02) { px += eckenB[i * 2]; pz += eckenB[i * 2 + 1]; n++; }
  }
  if (n === 0) { px = (ax + bx) / 2; pz = (az + bz) / 2; n = 1; }
  _u.nx = bnx; _u.nz = bnz; _u.tiefe = best; _u.px = px / n; _u.pz = pz / n;
  return _u;
}

/**
 * Stoß eines Autos gegen ein unbewegliches Hindernis am Punkt (px, py, pz) mit Normale (nx, nz) (zum Auto).
 * Liefert die Annäherungsgeschwindigkeit (m/s, positiv) oder 0, wenn sich das Auto bereits entfernt.
 */
export function stossFest(f: Fahrzeug, px: number, py: number, pz: number, nx: number, nz: number, tiefe: number, rueckprall = 0.18, reibung = 0.35): number {
  // Eindringen sofort beseitigen
  f.pos.x += nx * tiefe; f.pos.z += nz * tiefe;
  const rx = px - f.pos.x, ry = py - f.pos.y, rz = pz - f.pos.z;
  const d = f.dreh, v = f.v;
  const cvx = v.x + d.y * rz - d.z * ry, cvz = v.z + d.x * ry - d.y * rx;
  const vn = cvx * nx + cvz * nz;
  if (vn >= 0) return 0;
  const inv = f.inverseMasseAn(px, py, pz, nx, 0, nz);
  const jn = (-(1 + rueckprall) * vn) / inv;
  f.impuls(px, py, pz, nx * jn, 0, nz * jn);
  // Reibung entlang der Wand
  const tx = -nz, tz = nx;
  const vt = cvx * tx + cvz * tz;
  const invT = f.inverseMasseAn(px, py, pz, tx, 0, tz);
  const jt = Math.max(-reibung * jn, Math.min(reibung * jn, -vt / invT));
  f.impuls(px, py, pz, tx * jt, 0, tz * jt);
  return -vn;
}

/**
 * Stoß zweier Autos. Normale (nx, nz) zeigt von B nach A. Liefert die Annäherungsgeschwindigkeit.
 */
export function stossAutos(a: Fahrzeug, b: Fahrzeug, px: number, py: number, pz: number, nx: number, nz: number, tiefe: number): number {
  const ma = a.w.masse, mb = b.w.masse;
  const anteilA = mb / (ma + mb);
  a.pos.x += nx * tiefe * anteilA; a.pos.z += nz * tiefe * anteilA;
  b.pos.x -= nx * tiefe * (1 - anteilA); b.pos.z -= nz * tiefe * (1 - anteilA);
  const rel = (f: Fahrzeug): [number, number] => {
    const rx = px - f.pos.x, ry = py - f.pos.y, rz = pz - f.pos.z;
    return [f.v.x + f.dreh.y * rz - f.dreh.z * ry, f.v.z + f.dreh.x * ry - f.dreh.y * rx];
  };
  const [avx, avz] = rel(a), [bvx, bvz] = rel(b);
  const vn = (avx - bvx) * nx + (avz - bvz) * nz;
  if (vn >= 0) return 0;
  const inv = a.inverseMasseAn(px, py, pz, nx, 0, nz) + b.inverseMasseAn(px, py, pz, nx, 0, nz);
  const jn = (-(1 + 0.25) * vn) / inv;
  a.impuls(px, py, pz, nx * jn, 0, nz * jn);
  b.impuls(px, py, pz, -nx * jn, 0, -nz * jn);
  const tx = -nz, tz = nx;
  const vt = (avx - bvx) * tx + (avz - bvz) * tz;
  const invT = a.inverseMasseAn(px, py, pz, tx, 0, tz) + b.inverseMasseAn(px, py, pz, tx, 0, tz);
  const jt = Math.max(-0.3 * jn, Math.min(0.3 * jn, -vt / invT));
  a.impuls(px, py, pz, tx * jt, 0, tz * jt);
  b.impuls(px, py, pz, -tx * jt, 0, -tz * jt);
  return -vn;
}
