import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AutoDaten, KarosserieForm } from './typen';

/** Materialart je Fläche (als Vertex-Attribut `art`). */
export const ART = {
  LACK: 0, GLAS: 1, KUNSTSTOFF: 2, METALL: 3, SCHEINWERFER: 4, RUECKLICHT: 5, UNTERBODEN: 6, AKZENT: 7, WEISS: 8, INNEN: 9, GUMMI: 10,
} as const;

/** Profilstation: t (0 vorn … 1 hinten), g Gürtelhöhe, d Dachhöhe (0 = keine Kabine), b Breite, kb Kabinenbreite, u Bodenanhebung. */
type Station = [t: number, g: number, d: number, b: number, kb?: number, u?: number];

const PROFILE: Record<KarosserieForm, Station[]> = {
  schraegheck: [[0, 0.34, 0, 0.78, 0.82, 0.12], [0.03, 0.46, 0, 0.93], [0.1, 0.52, 0, 1], [0.26, 0.58, 0, 1], [0.4, 0.62, 0.97, 1], [0.55, 0.63, 1, 1], [0.82, 0.64, 0.96, 1], [0.965, 0.62, 0, 0.99], [1, 0.45, 0, 0.86, 0.82, 0.15]],
  coupe: [[0, 0.3, 0, 0.8, 0.8, 0.1], [0.03, 0.42, 0, 0.93], [0.12, 0.49, 0, 1], [0.31, 0.55, 0, 1], [0.45, 0.6, 0.97, 1, 0.8], [0.56, 0.61, 1, 1, 0.8], [0.7, 0.62, 0.93, 1, 0.78], [0.88, 0.63, 0, 1], [0.97, 0.6, 0, 0.95], [1, 0.44, 0, 0.84, 0.8, 0.12]],
  limousine: [[0, 0.34, 0, 0.8, 0.82, 0.1], [0.03, 0.46, 0, 0.93], [0.11, 0.52, 0, 1], [0.27, 0.57, 0, 1], [0.39, 0.61, 0.97, 1], [0.52, 0.62, 1, 1], [0.68, 0.62, 0.98, 1], [0.81, 0.62, 0, 1], [0.96, 0.6, 0, 0.95], [1, 0.45, 0, 0.85, 0.82, 0.12]],
  kombi: [[0, 0.34, 0, 0.8, 0.82, 0.1], [0.03, 0.46, 0, 0.93], [0.11, 0.52, 0, 1], [0.27, 0.57, 0, 1], [0.39, 0.61, 0.97, 1], [0.52, 0.62, 1, 1], [0.9, 0.63, 0.97, 1], [0.985, 0.6, 0, 0.98], [1, 0.45, 0, 0.88, 0.82, 0.12]],
  roadster: [[0, 0.32, 0, 0.8, 0.8, 0.1], [0.03, 0.44, 0, 0.93], [0.12, 0.52, 0, 1], [0.36, 0.6, 0, 1], [0.44, 0.64, 0.9, 1, 0.8], [0.47, 0.64, 0, 1], [0.66, 0.64, 0, 1], [0.7, 0.72, 0, 1], [0.9, 0.66, 0, 1], [0.97, 0.62, 0, 0.95], [1, 0.46, 0, 0.84, 0.8, 0.12]],
  muscle: [[0, 0.36, 0, 0.84, 0.8, 0.1], [0.02, 0.5, 0, 0.95], [0.1, 0.54, 0, 1], [0.36, 0.57, 0, 1], [0.47, 0.61, 0.96, 1, 0.8], [0.58, 0.62, 1, 1, 0.8], [0.7, 0.63, 0.9, 1, 0.78], [0.87, 0.64, 0, 1], [0.97, 0.62, 0, 0.96], [1, 0.48, 0, 0.86, 0.8, 0.14]],
  suv: [[0, 0.42, 0, 0.86, 0.86, 0.25], [0.03, 0.56, 0, 0.96], [0.1, 0.6, 0, 1], [0.24, 0.63, 0, 1], [0.34, 0.66, 0.97, 1, 0.87], [0.5, 0.66, 1, 1, 0.87], [0.88, 0.66, 0.99, 1, 0.87], [0.975, 0.64, 0, 0.98], [1, 0.5, 0, 0.9, 0.86, 0.25]],
  pickup: [[0, 0.42, 0, 0.86, 0.86, 0.25], [0.03, 0.56, 0, 0.96], [0.1, 0.6, 0, 1], [0.25, 0.63, 0, 1], [0.35, 0.66, 0.97, 1, 0.87], [0.47, 0.66, 1, 1, 0.87], [0.58, 0.66, 0.98, 1, 0.87], [0.63, 0.64, 0, 1], [0.97, 0.64, 0, 1], [1, 0.5, 0, 0.92, 0.86, 0.25]],
  buggy: [[0, 0.36, 0, 0.5, 0.8, 0.3], [0.08, 0.5, 0, 0.66], [0.3, 0.58, 0, 0.74], [0.4, 0.62, 0.94, 0.74, 0.86], [0.62, 0.64, 1, 0.74, 0.86], [0.7, 0.64, 0, 0.74], [0.92, 0.6, 0, 0.66], [1, 0.5, 0, 0.5, 0.8, 0.3]],
  supersport: [[0, 0.26, 0, 0.82, 0.78, 0.06], [0.03, 0.36, 0, 0.94], [0.12, 0.44, 0, 1], [0.26, 0.5, 0, 1], [0.4, 0.58, 0.97, 1, 0.76], [0.5, 0.6, 1, 1, 0.76], [0.62, 0.63, 0.92, 1, 0.74], [0.8, 0.66, 0, 1], [0.96, 0.64, 0, 0.97], [1, 0.46, 0, 0.88, 0.78, 0.1]],
  keil: [[0, 0.2, 0, 0.84, 0.8, 0.06], [0.04, 0.3, 0, 0.95], [0.3, 0.46, 0, 1], [0.46, 0.56, 0.98, 1, 0.8], [0.56, 0.58, 1, 1, 0.8], [0.7, 0.62, 0.9, 1, 0.78], [0.82, 0.66, 0, 1], [0.97, 0.66, 0, 0.98], [1, 0.5, 0, 0.9, 0.8, 0.1]],
  bus: [[0, 0.5, 0, 0.9, 0.9, 0.2], [0.02, 0.62, 0, 0.97], [0.05, 0.66, 0, 1], [0.14, 0.68, 0.96, 1, 0.92], [0.25, 0.68, 1, 1, 0.92], [0.96, 0.68, 0.99, 1, 0.92], [0.995, 0.6, 0, 0.97], [1, 0.5, 0, 0.93, 0.9, 0.2]],
  truck: [[0, 0.44, 0, 0.88, 0.86, 0.3], [0.03, 0.58, 0, 0.97], [0.1, 0.62, 0, 1], [0.24, 0.64, 0, 1], [0.33, 0.67, 0.97, 1, 0.86], [0.46, 0.67, 1, 1, 0.86], [0.56, 0.67, 0.98, 1, 0.86], [0.61, 0.6, 0, 1], [0.96, 0.6, 0, 0.98], [1, 0.5, 0, 0.9, 0.86, 0.3]],
};

/** Sammelt Dreiecke mit Materialart. */
class Netz {
  readonly pos: number[] = [];
  readonly art: number[] = [];
  dreieck(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, art: number): void {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.art.push(art, art, art);
  }
  viereck(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, art: number): void {
    this.dreieck(a, b, c, art);
    this.dreieck(a, c, d, art);
  }
  /** Achsparalleler Quader (optional um Y gedreht). */
  quader(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, art: number, artOben = art): void {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const p = (x: number, y: number, z: number) => new THREE.Vector3(cx + x * hx, cy + y * hy, cz + z * hz);
    const e = [p(-1, -1, -1), p(1, -1, -1), p(1, 1, -1), p(-1, 1, -1), p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1)];
    this.viereck(e[4], e[5], e[6], e[7], art); // +z
    this.viereck(e[1], e[0], e[3], e[2], art); // -z
    this.viereck(e[5], e[1], e[2], e[6], art); // +x
    this.viereck(e[0], e[4], e[7], e[3], art); // -x
    this.viereck(e[7], e[6], e[2], e[3], artOben); // +y
    this.viereck(e[0], e[1], e[5], e[4], art); // -y
  }
  /** Stab zwischen zwei Punkten mit quadratischem Querschnitt. */
  stab(a: THREE.Vector3, b: THREE.Vector3, dicke: number, art: number): void {
    const r = new THREE.Vector3().subVectors(b, a);
    const hilf = Math.abs(r.y) > 0.9 * r.length() ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(r, hilf).normalize().multiplyScalar(dicke / 2);
    const v = new THREE.Vector3().crossVectors(r, u).normalize().multiplyScalar(dicke / 2);
    const ecke = (basis: THREE.Vector3, su: number, sv: number) => basis.clone().addScaledVector(u, su).addScaledVector(v, sv);
    const a0 = ecke(a, -1, -1), a1 = ecke(a, 1, -1), a2 = ecke(a, 1, 1), a3 = ecke(a, -1, 1);
    const b0 = ecke(b, -1, -1), b1 = ecke(b, 1, -1), b2 = ecke(b, 1, 1), b3 = ecke(b, -1, 1);
    this.viereck(a0, a1, b1, b0, art); this.viereck(a1, a2, b2, b1, art);
    this.viereck(a2, a3, b3, b2, art); this.viereck(a3, a0, b0, b3, art);
  }
  /** Scheibe/Zylinder entlang der X-Achse. */
  zylinderX(cx: number, cy: number, cz: number, radius: number, x0: number, x1: number, segmente: number, artMantel: number, artDeckel: number, deckelInnen = 0): void {
    for (let i = 0; i < segmente; i++) {
      const w0 = (i / segmente) * Math.PI * 2, w1 = ((i + 1) / segmente) * Math.PI * 2;
      const y0 = cy + Math.cos(w0) * radius, z0 = cz + Math.sin(w0) * radius;
      const y1 = cy + Math.cos(w1) * radius, z1 = cz + Math.sin(w1) * radius;
      const a = new THREE.Vector3(cx + x0, y0, z0), b = new THREE.Vector3(cx + x1, y0, z0);
      const c = new THREE.Vector3(cx + x1, y1, z1), d = new THREE.Vector3(cx + x0, y1, z1);
      if (x1 > x0) this.viereck(a, d, c, b, artMantel); else this.viereck(a, b, c, d, artMantel);
      // Deckel außen (bei x1)
      const ri = deckelInnen;
      const bi = new THREE.Vector3(cx + x1, cy + Math.cos(w0) * ri, cz + Math.sin(w0) * ri);
      const ci = new THREE.Vector3(cx + x1, cy + Math.cos(w1) * ri, cz + Math.sin(w1) * ri);
      if (x1 > x0) this.viereck(b, c, ci, bi, artDeckel); else this.viereck(b, bi, ci, c, artDeckel);
    }
  }
}

export interface KarosserieErgebnis {
  koerper: THREE.BufferGeometry;
  rad: THREE.BufferGeometry;
  /** Sichtbare Radpositionen relativ zum Schwerpunkt (x links). */
  radX: number;
  reifenBreite: number;
  /** Lokale Positionen der Scheinwerfer und Rücklichter (für Lichtkegel/Partikel). */
  lichtVorn: THREE.Vector3;
  auspuff: THREE.Vector3;
}

const _cache = new Map<string, KarosserieErgebnis>();

/** Baut die prozedurale Karosserie eines Autos. Ursprung = Schwerpunkt, x links, y oben, z vorn. */
export function baueKarosserie(auto: AutoDaten, fluegelStufe = 0, schwerpunktHoehe = auto.schwerpunkt, bodenfreiheit = auto.bodenfreiheit): KarosserieErgebnis {
  const schluessel = `${auto.id}|${fluegelStufe}|${schwerpunktHoehe.toFixed(3)}|${bodenfreiheit.toFixed(3)}`;
  const vorhanden = _cache.get(schluessel);
  if (vorhanden) return vorhanden;

  const k = auto.karosserie;
  const profil = PROFILE[k.form];
  const n = new Netz();
  const L = auto.laenge, hw = auto.breite / 2;
  const y0 = -schwerpunktHoehe + bodenfreiheit;
  const y1 = -schwerpunktHoehe + auto.hoehe;
  const H = y1 - y0;
  const achsVorn = auto.radstand * (1 - auto.gewichtVorn);
  const ueberhangVorn = (L - auto.radstand) * (k.form === 'supersport' || k.form === 'keil' ? 0.5 : 0.46);
  const zVorn = achsVorn + ueberhangVorn;
  const zVon = (t: number) => zVorn - t * L;
  const akzent = k.akzent !== undefined;

  // Ringe erzeugen
  const RING = 9;
  const ringe: THREE.Vector3[][] = [];
  for (const st of profil) {
    const [t, g, d, b, kb = 0.82, u = 0] = st;
    const z = zVon(t);
    const w = hw * b;
    const yb = y0 + u * H;
    const yg = y0 + g * H;
    const kabine = d > 0;
    const yd = y0 + d * H;
    const wk = w * kb;
    const ring: THREE.Vector3[] = [];
    ring.push(new THREE.Vector3(0, yb, z));
    ring.push(new THREE.Vector3(w * 0.8, yb, z));
    ring.push(new THREE.Vector3(w, yb + 0.12 * H, z));
    ring.push(new THREE.Vector3(w * 1.0, yg - 0.07 * H, z));
    ring.push(new THREE.Vector3(w * 0.955, yg, z));
    if (kabine) {
      ring.push(new THREE.Vector3(wk, yg + 0.015 * H, z));
      ring.push(new THREE.Vector3(wk * 0.86, yd - 0.035 * H, z));
      ring.push(new THREE.Vector3(wk * 0.66, yd, z));
      ring.push(new THREE.Vector3(0, yd + 0.012 * H, z));
    } else {
      const wolb = 0.035 * H;
      ring.push(new THREE.Vector3(w * 0.8, yg + wolb * 0.45, z));
      ring.push(new THREE.Vector3(w * 0.52, yg + wolb * 0.8, z));
      ring.push(new THREE.Vector3(w * 0.26, yg + wolb * 0.95, z));
      ring.push(new THREE.Vector3(0, yg + wolb, z));
    }
    ringe.push(ring);
  }
  const spiegel = (v: THREE.Vector3) => new THREE.Vector3(-v.x, v.y, v.z);
  const offenOben = k.form === 'roadster' || k.form === 'pickup' || k.form === 'truck';
  for (let s = 0; s < ringe.length - 1; s++) {
    const A = ringe[s], B = ringe[s + 1];
    const kA = profil[s][2] > 0, kB = profil[s + 1][2] > 0;
    const tMitte = (profil[s][0] + profil[s + 1][0]) / 2;
    for (let j = 0; j < RING - 1; j++) {
      let art: number = ART.LACK;
      if (j === 0) art = ART.UNTERBODEN;
      else if (j === 1) art = ART.KUNSTSTOFF;
      else if (j === 5) art = kA || kB ? ART.GLAS : ART.LACK;
      else if (j >= 6) art = kA !== kB ? ART.GLAS : kA && akzent ? ART.AKZENT : ART.LACK;
      if (offenOben && !kA && !kB && j >= 5) {
        if (k.form === 'roadster' && tMitte > 0.46 && tMitte < 0.68) art = ART.INNEN;
        if ((k.form === 'pickup' || k.form === 'truck') && tMitte > 0.62 && tMitte < 0.97) art = ART.INNEN;
      }
      // linke Seite (x > 0): Außenseite zeigt nach +x
      n.viereck(A[j], B[j], B[j + 1], A[j + 1], art);
      n.viereck(spiegel(A[j + 1]), spiegel(B[j + 1]), spiegel(B[j]), spiegel(A[j]), art);
    }
  }
  // Stirnflächen
  const kappe = (ring: THREE.Vector3[], vorn: boolean) => {
    const mitte = new THREE.Vector3(0, (ring[0].y + ring[RING - 1].y) / 2, ring[0].z);
    for (let j = 0; j < RING - 1; j++) {
      const art = j <= 1 ? ART.KUNSTSTOFF : ART.LACK;
      if (vorn) {
        n.dreieck(mitte, ring[j], ring[j + 1], art);
        n.dreieck(mitte, spiegel(ring[j + 1]), spiegel(ring[j]), art);
      } else {
        n.dreieck(mitte, ring[j + 1], ring[j], art);
        n.dreieck(mitte, spiegel(ring[j]), spiegel(ring[j + 1]), art);
      }
    }
  };
  kappe(ringe[0], true);
  kappe(ringe[ringe.length - 1], false);

  // Hilfswerte an beliebigem t
  const bei = (t: number) => {
    let i = 0;
    while (i < profil.length - 2 && profil[i + 1][0] < t) i++;
    const a = profil[i], b = profil[i + 1];
    const f = THREE.MathUtils.clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
    const g = a[1] + (b[1] - a[1]) * f;
    const w = hw * (a[3] + (b[3] - a[3]) * f);
    const dA = a[2] > 0 ? a[2] : a[1], dB = b[2] > 0 ? b[2] : b[1];
    return { z: zVon(t), yg: y0 + g * H, w, yd: y0 + (dA + (dB - dA) * f) * H };
  };

  // Scheinwerfer, Grill, Kennzeichen vorn (sitzen auf der Stirnfläche)
  const p0 = profil[0], pN = profil[profil.length - 1];
  const nase = { z: zVon(0), w: hw * p0[3], yg: y0 + p0[1] * H, yu: y0 + (p0[5] ?? 0) * H };
  const stirnH = nase.yg - nase.yu;
  const lichtY = nase.yg - stirnH * 0.24;
  for (const s of [-1, 1]) {
    n.quader(s * nase.w * 0.66, lichtY, nase.z + 0.012, nase.w * 0.5, stirnH * 0.3, 0.05, ART.SCHEINWERFER);
  }
  n.quader(0, lichtY, nase.z + 0.008, nase.w * 0.7, stirnH * 0.26, 0.04, ART.KUNSTSTOFF);
  n.quader(0, nase.yu + stirnH * 0.32, nase.z + 0.02, 0.36, 0.085, 0.02, ART.WEISS);
  if (k.zusatzlicht) {
    for (const x of [-0.42, -0.14, 0.14, 0.42]) n.quader(x * hw * 1.3, nase.yg + 0.07, nase.z - 0.02, 0.17, 0.17, 0.08, ART.SCHEINWERFER, ART.KUNSTSTOFF);
  }
  // Rücklichter, Kennzeichen hinten, Auspuff
  const heck = { z: zVon(1), w: hw * pN[3], yg: y0 + pN[1] * H, yu: y0 + (pN[5] ?? 0) * H };
  const heckH = heck.yg - heck.yu;
  const ruY = heck.yg - heckH * 0.22;
  for (const s of [-1, 1]) n.quader(s * heck.w * 0.66, ruY, heck.z - 0.012, heck.w * 0.52, heckH * 0.26, 0.05, ART.RUECKLICHT);
  n.quader(0, ruY, heck.z - 0.006, heck.w * 0.8, heckH * 0.1, 0.03, ART.RUECKLICHT);
  n.quader(0, heck.yu + heckH * 0.36, heck.z - 0.02, 0.36, 0.085, 0.02, ART.WEISS);
  const auspuffX = auto.motor === 'elektro' ? 0 : heck.w * 0.6;
  const auspuffY = heck.yu + 0.05;
  if (auto.motor !== 'elektro') {
    for (const s of auto.klang.zylinder >= 8 ? [-1, 1] : [1]) n.quader(s * auspuffX, auspuffY, heck.z - 0.02, 0.09, 0.07, 0.12, ART.METALL);
  }
  // Spiegel
  let tKabine = 0.4;
  for (const st of profil) if (st[2] > 0) { tKabine = st[0]; break; }
  const sp = bei(tKabine - 0.02);
  for (const s of [-1, 1]) n.quader(s * (sp.w + 0.06), sp.yg + 0.05, sp.z, 0.14, 0.09, 0.07, ART.LACK);

  // Radhäuser (dunkle Bögen) – Räder selbst sind ein eigenes Netz
  const r = auto.radRadius;
  const reifenBreite = Math.min(0.34, Math.max(0.19, r * 0.72)) * (auto.klasse === 'super' || auto.klasse === 'gelaende' ? 1.15 : 1);
  const radX = k.form === 'buggy' ? hw - reifenBreite / 2 + 0.02 : Math.max(auto.spur / 2, hw - reifenBreite / 2 + 0.015);
  const achsHinten = auto.radstand * auto.gewichtVorn;
  const radY = -schwerpunktHoehe + r;
  if (k.form !== 'buggy') {
    for (const zR of [achsVorn, -achsHinten]) {
      for (const s of [-1, 1]) {
        n.zylinderX(s * (hw - 0.3), radY + 0.02, zR, r * 1.17, 0, s * 0.304, 14, ART.KUNSTSTOFF, ART.KUNSTSTOFF);
      }
    }
  }

  // Zusätze
  const fluegel = Math.max(k.fluegel ?? 0, fluegelStufe);
  if (fluegel >= 1) {
    const f = bei(0.955);
    if (fluegel === 1) n.quader(0, f.yg + 0.035, f.z, f.w * 1.8, 0.035, 0.2, ART.LACK);
    else {
      const hoehe = fluegel >= 3 ? 0.36 : 0.25;
      n.quader(0, f.yg + hoehe, f.z - 0.05, hw * 1.9, 0.035, 0.3, akzent ? ART.AKZENT : ART.LACK);
      for (const s of [-1, 1]) {
        n.quader(s * hw * 0.55, f.yg + hoehe / 2, f.z - 0.03, 0.04, hoehe, 0.16, ART.KUNSTSTOFF);
        n.quader(s * hw * 0.95, f.yg + hoehe + 0.02, f.z - 0.05, 0.03, 0.14, 0.32, ART.LACK);
      }
    }
  }
  if (k.hutze) {
    const h = bei(0.2);
    n.quader(0, h.yg + 0.07, h.z, 0.5, 0.1, 0.6, ART.LACK);
    n.quader(0, h.yg + 0.07, h.z + 0.305, 0.44, 0.07, 0.02, ART.KUNSTSTOFF);
  }
  if (k.dachtraeger) {
    const d0 = bei(0.45), d1 = bei(0.8);
    const y = Math.max(d0.yd, d1.yd) + 0.05;
    for (const s of [-1, 1]) n.quader(s * hw * 0.62, y, (d0.z + d1.z) / 2, 0.04, 0.04, d0.z - d1.z, ART.KUNSTSTOFF);
    for (const f of [0.15, 0.5, 0.85]) n.quader(0, y + 0.03, d1.z + (d0.z - d1.z) * f, hw * 1.36, 0.035, 0.05, ART.METALL);
    n.quader(0, y + 0.12, d1.z + (d0.z - d1.z) * 0.45, hw * 0.9, 0.14, (d0.z - d1.z) * 0.55, ART.KUNSTSTOFF);
  }
  if (k.schutzbuegel) {
    const v = bei(0);
    const zb = v.z + 0.12;
    for (const s of [-1, 1]) {
      n.stab(new THREE.Vector3(s * hw * 0.5, y0 + 0.08, zb - 0.1), new THREE.Vector3(s * hw * 0.5, v.yg + 0.12, zb), 0.06, ART.KUNSTSTOFF);
    }
    n.stab(new THREE.Vector3(-hw * 0.5, v.yg + 0.12, zb), new THREE.Vector3(hw * 0.5, v.yg + 0.12, zb), 0.06, ART.KUNSTSTOFF);
    n.stab(new THREE.Vector3(-hw * 0.62, y0 + 0.2, zb), new THREE.Vector3(hw * 0.62, y0 + 0.2, zb), 0.07, ART.KUNSTSTOFF);
  }
  if (k.kaefig || k.form === 'buggy') {
    const a = bei(0.4), b = bei(0.66);
    const yk = y1 + 0.02;
    for (const s of [-1, 1]) {
      const x = s * a.w * 0.8;
      n.stab(new THREE.Vector3(x, a.yg, a.z + 0.25), new THREE.Vector3(x, yk, a.z - 0.1), 0.05, ART.METALL);
      n.stab(new THREE.Vector3(x, yk, a.z - 0.1), new THREE.Vector3(x, yk, b.z), 0.05, ART.METALL);
      n.stab(new THREE.Vector3(x, yk, b.z), new THREE.Vector3(x, b.yg, b.z - 0.5), 0.05, ART.METALL);
    }
    n.stab(new THREE.Vector3(-a.w * 0.8, yk, a.z - 0.1), new THREE.Vector3(a.w * 0.8, yk, a.z - 0.1), 0.05, ART.METALL);
    n.stab(new THREE.Vector3(-a.w * 0.8, yk, b.z), new THREE.Vector3(a.w * 0.8, yk, b.z), 0.05, ART.METALL);
    if (k.form === 'buggy') {
      // Reserverad am Heck
      n.zylinderX(-0.12, y0 + 0.62 * H, zVon(0.9), r * 0.85, 0, 0.24, 12, ART.GUMMI, ART.GUMMI, r * 0.4);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(n.pos, 3));
  geo.setAttribute('art', new THREE.Float32BufferAttribute(n.art, 1));
  const glatt = toCreasedNormals(geo, (38 * Math.PI) / 180);
  // Folien-UV: Atlas aus linker Seite, rechter Seite, Draufsicht (je ein Drittel)
  const pos = glatt.getAttribute('position'), nor = glatt.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  const zHinten = zVon(1);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = nor.getX(i), ny = nor.getY(i);
    const zf = THREE.MathUtils.clamp((z - zHinten) / L, 0, 1);
    let bereich: number, u: number, v: number;
    if (ny > 0.75) { bereich = 2; u = zf; v = 0.5 + x / (2 * hw) * 0.98; }
    else if (nx >= 0) { bereich = 0; u = 1 - zf; v = (y - y0) / H; }
    else { bereich = 1; u = zf; v = (y - y0) / H; }
    uv[i * 2] = (bereich + THREE.MathUtils.clamp(u, 0.002, 0.998)) / 3;
    uv[i * 2 + 1] = THREE.MathUtils.clamp(v, 0, 1);
  }
  glatt.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // Schadensattribut (0 heil … 1 zerkratzt), wird zur Laufzeit beschrieben
  glatt.setAttribute('kratzer', new THREE.BufferAttribute(new Float32Array(pos.count), 1));
  glatt.computeBoundingSphere();

  const ergebnis: KarosserieErgebnis = {
    koerper: glatt,
    rad: baueRad(r, reifenBreite, auto.klasse === 'gelaende' || auto.klasse === 'rallye'),
    radX,
    reifenBreite,
    lichtVorn: new THREE.Vector3(0, lichtY, nase.z),
    auspuff: new THREE.Vector3(-auspuffX, auspuffY, zVon(1) - 0.1),
  };
  _cache.set(schluessel, ergebnis);
  return ergebnis;
}

/** Rad: Reifen und Felge, Achse = X, Außenseite bei +x. */
function baueRad(r: number, breite: number, grob: boolean): THREE.BufferGeometry {
  const n = new Netz();
  const hb = breite / 2;
  const felge = r * (grob ? 0.56 : 0.68);
  const seg = 16;
  // Lauffläche und Flanken
  n.zylinderX(0, 0, 0, r, -hb, hb, seg, ART.GUMMI, ART.GUMMI, felge);
  n.zylinderX(0, 0, 0, r, hb, -hb, seg, ART.GUMMI, ART.GUMMI, felge);
  // Felgenbett (innen dunkel) und Speichen
  n.zylinderX(0, 0, 0, felge, hb * 0.2, hb * 0.6, seg, ART.KUNSTSTOFF, ART.KUNSTSTOFF, 0);
  const speichen = grob ? 6 : 5;
  for (let i = 0; i < speichen; i++) {
    const w = (i / speichen) * Math.PI * 2;
    const c = Math.cos(w), s = Math.sin(w);
    const a = new THREE.Vector3(hb * 0.72, c * felge * 0.16, s * felge * 0.16);
    const b = new THREE.Vector3(hb * 0.86, c * felge * 0.98, s * felge * 0.98);
    n.stab(a, b, felge * (grob ? 0.34 : 0.24), ART.METALL);
  }
  n.zylinderX(0, 0, 0, felge * 0.24, hb * 0.6, hb * 0.9, 8, ART.METALL, ART.METALL, 0);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(n.pos, 3));
  geo.setAttribute('art', new THREE.Float32BufferAttribute(n.art, 1));
  const glatt = toCreasedNormals(geo, (40 * Math.PI) / 180);
  glatt.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(glatt.getAttribute('position').count * 2), 2));
  glatt.setAttribute('kratzer', new THREE.BufferAttribute(new Float32Array(glatt.getAttribute('position').count), 1));
  glatt.computeBoundingSphere();
  return glatt;
}
