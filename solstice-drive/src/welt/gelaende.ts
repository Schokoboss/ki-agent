import * as THREE from 'three';
import { GLSL_UMGEBUNG, weltMaterial } from '../engine/shader';
import { rauschTextur } from '../engine/texturen';
import { rauschen2 } from '../engine/rauschen';
import { glatt, klemme } from '../engine/mathe';
import { KACHEL, RASTER, RASTER_N, REGION, WELT_HALB } from './daten/regionen';
import type { Weltkarte } from './weltkarte';

/** Zellen je Kachelkante bei voller Auflösung. */
const ZELLEN = KACHEL / RASTER;
export const LOD_STUFEN = 4;
const N = RASTER_N;

export const WASSER_UNIFORM = { value: 0 };
export const NAH_RADIUS_UNIFORM = { value: 600 };

const VERTEX = /* glsl */ `
attribute vec2 misch;
varying vec3 vWelt;
varying vec3 vNormal;
varying vec3 vFarbe;
varying vec2 vMisch;
void main() {
  vWelt = position;
  vNormal = normal;
  vFarbe = color;
  vMisch = misch;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */ `
${GLSL_UMGEBUNG}
uniform sampler2D uRausch;
uniform float uWasserHoehe;
uniform float uNahRadius;
varying vec3 vWelt;
varying vec3 vNormal;
varying vec3 vFarbe;
varying vec2 vMisch;
void main() {
  #ifdef FERN
    // Das Fernnetz wird dort verworfen, wo feine Kacheln liegen
    if (distance(vWelt.xz, cameraPosition.xz) < uNahRadius) discard;
  #endif
  vec3 n = normalize(vNormal);
  vec3 basis = vFarbe;
  float fein = texture2D(uRausch, vWelt.xz * 0.043).g;
  float grob = texture2D(uRausch, vWelt.xz * 0.0052).r;
  // Jahreszeiten färben den Bewuchs
  vec3 fruehling = basis * vec3(0.9, 1.14, 0.74);
  vec3 herbst = mix(basis, vec3(0.36, 0.2, 0.05), 0.42 + 0.25 * grob);
  vec3 winter = mix(basis, vec3(0.26, 0.23, 0.17), 0.6);
  vec3 jahr = fruehling * uJahreszeit.x + basis * uJahreszeit.y + herbst * uJahreszeit.z + winter * uJahreszeit.w;
  basis = mix(basis, jahr, vMisch.x);
  basis *= 0.7 + 0.42 * fein + 0.3 * (grob - 0.5);
  // Schnee: ewig oberhalb der Schneegrenze, im Winter überall
  float grenze = smoothstep(412.0, 452.0, vWelt.y + (grob - 0.5) * 70.0);
  float schnee = max(grenze, uSchnee * smoothstep(2.5, 7.0, vWelt.y + fein * 2.0)) * vMisch.y;
  basis = mix(basis, vec3(0.84, 0.88, 0.95) * (0.9 + 0.2 * fein), schnee);
  basis *= 1.0 - 0.22 * uNaesse * (1.0 - schnee);
  vec3 c = basis * lichtDiffus(n, 1.0);
  c += basis * lampe(vWelt, n) * vec3(1.0, 0.94, 0.8) * 2.0;
  // unter Wasser: Tiefe färbt den Grund
  float tiefe = uWasserHoehe - vWelt.y;
  if (tiefe > 0.0) c = mix(c * vec3(0.55, 0.85, 0.9), uZenit * 0.25 + vec3(0.0, 0.02, 0.04), 1.0 - exp(-tiefe * 0.3));
  c = nebel(c, vWelt);
  gl_FragColor = vec4(ausgabe(c), 1.0);
}`;

let _material: THREE.ShaderMaterial | null = null;
export function gelaendeMaterial(): THREE.ShaderMaterial {
  if (!_material) {
    _material = weltMaterial({
      vertex: VERTEX, fragment: FRAGMENT, vertexColors: true,
      uniforms: { uRausch: { value: rauschTextur() }, uWasserHoehe: WASSER_UNIFORM, uNahRadius: NAH_RADIUS_UNIFORM },
    });
  }
  return _material;
}

const F = {
  gras: [0.115, 0.215, 0.055], gras2: [0.17, 0.25, 0.07], wald: [0.075, 0.115, 0.04], sand: [0.6, 0.5, 0.31],
  duene: [0.7, 0.54, 0.31], fels: [0.25, 0.235, 0.22], beton: [0.27, 0.27, 0.27], rasen: [0.13, 0.27, 0.07], grund: [0.4, 0.38, 0.27],
} as const;

/** Farbe und Mischwerte eines Rasterpunkts (Sommerzustand). Schreibt 5 Werte nach aus[o..]. */
function punktFarbe(karte: Weltkarte, i: number, j: number, ny: number, aus: Float32Array, o: number): void {
  const idx = j * N + i;
  const h = karte.hoehen[idx];
  const region = karte.region[idx];
  const x = i * RASTER - WELT_HALB, z = j * RASTER - WELT_HALB;
  const r1 = rauschen2(x / 130, z / 130) * 0.5 + 0.5;
  let c: readonly number[]; let veg = 1;
  switch (region) {
    case REGION.MEER: c = F.grund; veg = 0; break;
    case REGION.WALD: c = F.wald; veg = 0.7; break;
    case REGION.DUENEN: c = F.duene; veg = 0; break;
    case REGION.STADT: c = F.beton; veg = 0; break;
    case REGION.FESTIVAL: c = F.rasen; break;
    case REGION.GEBIRGE: c = h > 300 ? F.fels : F.gras; veg = h > 300 ? 0 : 1; break;
    default: c = F.gras;
  }
  let r = c[0], g = c[1], b = c[2];
  if (veg > 0.9) { r += (F.gras2[0] - r) * r1; g += (F.gras2[1] - g) * r1; b += (F.gras2[2] - b) * r1; }
  // Strand
  const strand = region === REGION.DUENEN ? 0 : glatt(5.2, 3.2, h);
  if (strand > 0) { r += (F.sand[0] - r) * strand; g += (F.sand[1] - g) * strand; b += (F.sand[2] - b) * strand; veg *= 1 - strand; }
  // Fels an Steilhängen
  const fels = glatt(0.86, 0.72, ny) * (region === REGION.DUENEN ? 0.3 : 1);
  if (fels > 0) { r += (F.fels[0] - r) * fels; g += (F.fels[1] - g) * fels; b += (F.fels[2] - b) * fels; veg *= 1 - fels; }
  aus[o] = r; aus[o + 1] = g; aus[o + 2] = b;
  aus[o + 3] = veg;
  aus[o + 4] = glatt(0.55, 0.85, ny);
}

const _farbe = new Float32Array(5);

/** Normale am Rasterpunkt aus zentralen Differenzen. */
function punktNormale(h: Float32Array, i: number, j: number, aus: Float32Array, o: number): number {
  const i0 = i > 0 ? i - 1 : i, i1 = i < N - 1 ? i + 1 : i, j0 = j > 0 ? j - 1 : j, j1 = j < N - 1 ? j + 1 : j;
  const dx = (h[j * N + i1] - h[j * N + i0]) / ((i1 - i0) * RASTER);
  const dz = (h[j1 * N + i] - h[j0 * N + i]) / ((j1 - j0) * RASTER);
  const l = Math.sqrt(dx * dx + 1 + dz * dz);
  aus[o] = -dx / l; aus[o + 1] = 1 / l; aus[o + 2] = -dz / l;
  return 1 / l;
}

const indexCache = new Map<number, THREE.BufferAttribute>();

/** Indexpuffer eines n×n-Zellen-Gitters mit Schürzen an allen vier Rändern. */
function gitterIndex(n: number, loch?: (ci: number, cj: number) => boolean): THREE.BufferAttribute {
  if (!loch) { const c = indexCache.get(n); if (c) return c; }
  const v = n + 1;
  const idx: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (loch && loch(i, j)) continue;
      const a = j * v + i, b = a + 1, c = a + v, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Schürzen: zusätzliche Punkte hinter den Gitterpunkten, Reihenfolge: oben, unten, links, rechts
  const basis = v * v;
  for (let i = 0; i < n; i++) {
    const o0 = i, o1 = i + 1, s0 = basis + i, s1 = basis + i + 1; // oben (j = 0)
    idx.push(o0, o1, s0, o1, s1, s0);
    const u0 = n * v + i, u1 = u0 + 1, t0 = basis + v + i, t1 = t0 + 1; // unten
    idx.push(u0, t0, u1, u1, t0, t1);
    const l0 = i * v, l1 = (i + 1) * v, q0 = basis + 2 * v + i, q1 = q0 + 1; // links (i = 0)
    idx.push(l0, q0, l1, l1, q0, q1);
    const r0 = i * v + n, r1 = (i + 1) * v + n, p0 = basis + 3 * v + i, p1 = p0 + 1; // rechts
    idx.push(r0, r1, p0, r1, p1, p0);
  }
  const attr = new THREE.BufferAttribute(v * v + 4 * v > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1);
  if (!loch) indexCache.set(n, attr);
  return attr;
}

/** Baut die Geometrie einer Geländekachel (kx, kz) in der Detailstufe lod (0 = fein). */
export function baueKachelGeometrie(karte: Weltkarte, kx: number, kz: number, lod: number): THREE.BufferGeometry {
  const schritt = 1 << lod;
  const n = ZELLEN / schritt, v = n + 1;
  const anzahl = v * v + 4 * v;
  const pos = new Float32Array(anzahl * 3), nor = new Float32Array(anzahl * 3), col = new Float32Array(anzahl * 3), mis = new Float32Array(anzahl * 2);
  const h = karte.hoehen;
  const i0 = kx * ZELLEN, j0 = kz * ZELLEN;
  let minY = 1e9, maxY = -1e9;
  for (let j = 0; j < v; j++) {
    for (let i = 0; i < v; i++) {
      const gi = i0 + i * schritt, gj = j0 + j * schritt;
      const o = j * v + i;
      const y = h[gj * N + gi];
      pos[o * 3] = gi * RASTER - WELT_HALB; pos[o * 3 + 1] = y; pos[o * 3 + 2] = gj * RASTER - WELT_HALB;
      const ny = punktNormale(h, gi, gj, nor, o * 3);
      punktFarbe(karte, gi, gj, ny, _farbe, 0);
      col[o * 3] = _farbe[0]; col[o * 3 + 1] = _farbe[1]; col[o * 3 + 2] = _farbe[2];
      mis[o * 2] = _farbe[3]; mis[o * 2 + 1] = _farbe[4];
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  // Schürzen
  const tiefe = 5 * schritt + 2;
  const kopiere = (quelle: number, ziel: number) => {
    pos[ziel * 3] = pos[quelle * 3]; pos[ziel * 3 + 1] = pos[quelle * 3 + 1] - tiefe; pos[ziel * 3 + 2] = pos[quelle * 3 + 2];
    nor[ziel * 3] = nor[quelle * 3]; nor[ziel * 3 + 1] = nor[quelle * 3 + 1]; nor[ziel * 3 + 2] = nor[quelle * 3 + 2];
    col[ziel * 3] = col[quelle * 3]; col[ziel * 3 + 1] = col[quelle * 3 + 1]; col[ziel * 3 + 2] = col[quelle * 3 + 2];
    mis[ziel * 2] = mis[quelle * 2]; mis[ziel * 2 + 1] = mis[quelle * 2 + 1];
  };
  const basis = v * v;
  for (let i = 0; i < v; i++) {
    kopiere(i, basis + i);
    kopiere(n * v + i, basis + v + i);
    kopiere(i * v, basis + 2 * v + i);
    kopiere(i * v + n, basis + 3 * v + i);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('misch', new THREE.BufferAttribute(mis, 2));
  // Tunnelportale ausstanzen (nur in den beiden feinsten Stufen)
  let hatLoch = false;
  if (lod <= 1) {
    for (let j = 0; j < ZELLEN && !hatLoch; j++) for (let i = 0; i < ZELLEN; i++) if (karte.loch[(j0 + j) * (N - 1) + i0 + i]) { hatLoch = true; break; }
  }
  if (hatLoch) {
    geo.setIndex(gitterIndex(n, (ci, cj) => {
      for (let b = 0; b < schritt; b++) for (let a = 0; a < schritt; a++) if (karte.loch[(j0 + cj * schritt + b) * (N - 1) + i0 + ci * schritt + a]) return true;
      return false;
    }));
  } else geo.setIndex(gitterIndex(n));
  const cx = (kx + 0.5) * KACHEL - WELT_HALB, cz = (kz + 0.5) * KACHEL - WELT_HALB;
  const halbHoehe = (maxY - minY) / 2 + tiefe;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, (maxY + minY) / 2 - tiefe / 2, cz), Math.sqrt(2 * (KACHEL / 2) * (KACHEL / 2) + halbHoehe * halbHoehe));
  return geo;
}

/** Grobes Netz der ganzen Welt (64 m Raster), liegt als Horizont unter den Kacheln. */
export function baueFernnetz(karte: Weltkarte): THREE.Mesh {
  const schritt = 8;
  const n = (N - 1) / schritt, v = n + 1;
  const pos = new Float32Array(v * v * 3), nor = new Float32Array(v * v * 3), col = new Float32Array(v * v * 3), mis = new Float32Array(v * v * 2);
  const h = karte.hoehen;
  for (let j = 0; j < v; j++) {
    for (let i = 0; i < v; i++) {
      const gi = i * schritt, gj = j * schritt, o = j * v + i;
      // Minimum der Umgebung, damit das Fernnetz nie über den feinen Kacheln liegt
      let y = 1e9;
      for (let b = -4; b <= 4; b += 2) for (let a = -4; a <= 4; a += 2) {
        const q = klemme(gi + a, 0, N - 1), w = klemme(gj + b, 0, N - 1);
        const hh = h[w * N + q];
        if (hh < y) y = hh;
      }
      pos[o * 3] = gi * RASTER - WELT_HALB; pos[o * 3 + 1] = y - 0.6; pos[o * 3 + 2] = gj * RASTER - WELT_HALB;
      const ny = punktNormale(h, gi, gj, nor, o * 3);
      punktFarbe(karte, gi, gj, ny, _farbe, 0);
      col[o * 3] = _farbe[0]; col[o * 3 + 1] = _farbe[1]; col[o * 3 + 2] = _farbe[2];
      mis[o * 2] = _farbe[3]; mis[o * 2 + 1] = _farbe[4];
    }
  }
  const idx = new Uint32Array(n * n * 6);
  let q = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * v + i, b = a + 1, c = a + v, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('misch', new THREE.BufferAttribute(mis, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const mat = gelaendeMaterial().clone();
  mat.uniforms = gelaendeMaterial().uniforms; // gemeinsame Uniformen behalten
  mat.defines = { FERN: 1 };
  mat.polygonOffset = true; mat.polygonOffsetFactor = 2; mat.polygonOffsetUnits = 4;
  const netz = new THREE.Mesh(geo, mat);
  netz.frustumCulled = false;
  netz.renderOrder = 1;
  return netz;
}
