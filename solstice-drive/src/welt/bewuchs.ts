import * as THREE from 'three';
import { GLSL_UMGEBUNG, weltMaterial } from '../engine/shader';
import { Netzbauer, objektMaterial, type Farbe } from '../engine/netzbau';
import { hash2 } from '../engine/zufall';
import { OBJ, OBJ_ANZAHL, OBJEKT_TYPEN, type KachelObjekte } from './objekte';

// ---------------------------------------------------------------------------------------------
// Pflanzen: Vorlagen und verschmolzene Netze je Kachel
// ---------------------------------------------------------------------------------------------

interface Vorlage { pos: Float32Array; nor: Float32Array; col: Float32Array; art: Float32Array; ecken: number }

function vorlage(b: Netzbauer): Vorlage {
  return { pos: Float32Array.from(b.pos), nor: Float32Array.from(b.nor), col: Float32Array.from(b.col), art: Float32Array.from(b.leu), ecken: b.pos.length / 3 };
}

/** Doppelkegel („Diamant“) als einfache Laubkrone. */
function krone(b: Netzbauer, cx: number, cy: number, cz: number, r: number, h: number, seiten: number, f: Farbe, art: number, dreh = 0): void {
  for (let i = 0; i < seiten; i++) {
    const w0 = (i / seiten) * Math.PI * 2 + dreh, w1 = ((i + 1) / seiten) * Math.PI * 2 + dreh;
    const x0 = cx + Math.cos(w0) * r, z0 = cz + Math.sin(w0) * r, x1 = cx + Math.cos(w1) * r, z1 = cz + Math.sin(w1) * r;
    b.dreieck(x0, cy, z0, cx, cy + h * 0.62, cz, x1, cy, z1, f, art);
    b.dreieck(x0, cy, z0, x1, cy, z1, cx, cy - h * 0.38, cz, f, art);
  }
}

function kegel(b: Netzbauer, cy: number, r: number, h: number, seiten: number, f: Farbe, art: number, dreh = 0): void {
  for (let i = 0; i < seiten; i++) {
    const w0 = (i / seiten) * Math.PI * 2 + dreh, w1 = ((i + 1) / seiten) * Math.PI * 2 + dreh;
    b.dreieck(Math.cos(w0) * r, cy, Math.sin(w0) * r, 0, cy + h, 0, Math.cos(w1) * r, cy, Math.sin(w1) * r, f, art);
  }
}

let _vorlagen: (Vorlage | null)[] | null = null;
function pflanzenVorlagen(): (Vorlage | null)[] {
  if (_vorlagen) return _vorlagen;
  const v: (Vorlage | null)[] = new Array(OBJ_ANZAHL).fill(null);
  const RINDE: Farbe = [0.16, 0.11, 0.07], NADEL: Farbe = [0.045, 0.13, 0.055], NADEL2: Farbe = [0.06, 0.16, 0.07];
  const LAUB: Farbe = [0.13, 0.27, 0.06], LAUB2: Farbe = [0.17, 0.32, 0.08], PALM: Farbe = [0.12, 0.3, 0.08], STEIN: Farbe = [0.3, 0.29, 0.27], HALM: Farbe = [0.42, 0.44, 0.2];
  { // Kiefer
    const b = new Netzbauer();
    b.zylinder(0, 0, 0, 0.26, 0.14, 3.4, 5, RINDE, 0, false);
    kegel(b, 2.2, 2.6, 3.6, 6, NADEL, 2);
    kegel(b, 4.6, 2.0, 3.2, 6, NADEL2, 2, 0.5);
    kegel(b, 6.9, 1.35, 3.0, 5, NADEL, 2, 1.0);
    v[OBJ.KIEFER] = vorlage(b);
  }
  { // Laubbaum
    const b = new Netzbauer();
    b.zylinder(0, 0, 0, 0.34, 0.2, 3.6, 5, RINDE, 0, false);
    krone(b, 0, 5.2, 0, 2.7, 4.6, 6, LAUB, 1);
    krone(b, 1.3, 4.4, 0.6, 1.8, 3.0, 5, LAUB2, 1, 0.6);
    krone(b, -1.1, 4.7, -0.8, 1.9, 3.2, 5, LAUB2, 1, 1.4);
    v[OBJ.LAUBBAUM] = vorlage(b);
  }
  { // Palme
    const b = new Netzbauer();
    b.stab(0, 0, 0, 0.35, 2.6, 0.1, 0.42, RINDE, 0);
    b.stab(0.35, 2.6, 0.1, 0.9, 5.0, 0.2, 0.34, RINDE, 0);
    b.stab(0.9, 5.0, 0.2, 1.1, 7.0, 0.2, 0.28, RINDE, 0);
    for (let i = 0; i < 7; i++) {
      const w = (i / 7) * Math.PI * 2;
      const c = Math.cos(w), s = Math.sin(w);
      const ax = 1.1, ay = 7.0, az = 0.2;
      const mx = ax + c * 1.9, my = ay + 0.55, mz = az + s * 1.9;
      const ex = ax + c * 3.5, ey = ay - 0.9, ez = az + s * 3.5;
      const qx = -s * 0.5, qz = c * 0.5;
      b.dreieck(ax, ay, az, mx + qx, my, mz + qz, mx - qx, my, mz - qz, PALM, 1);
      b.dreieck(mx + qx, my, mz + qz, ex, ey, ez, mx - qx, my, mz - qz, PALM, 1);
    }
    v[OBJ.PALME] = vorlage(b);
  }
  { // Busch
    const b = new Netzbauer();
    krone(b, 0, 0.6, 0, 0.95, 1.4, 5, LAUB2, 1);
    krone(b, 0.7, 0.45, 0.3, 0.65, 1.0, 5, LAUB, 1, 0.8);
    v[OBJ.BUSCH] = vorlage(b);
  }
  { // Fels
    const b = new Netzbauer();
    const p: [number, number, number][] = [[0, 1.5, 0.1], [1.2, 0.5, 0.2], [0.3, 0.6, 1.1], [-1.1, 0.4, 0.4], [-0.3, 0.7, -1.0], [0.9, 0.3, -0.8], [0.2, -0.4, 0]];
    const f: [number, number, number][] = [[0, 2, 1], [0, 3, 2], [0, 4, 3], [0, 5, 4], [0, 1, 5], [1, 2, 6], [2, 3, 6], [3, 4, 6], [4, 5, 6], [5, 1, 6]];
    for (const [a, c, d] of f) b.dreieck(p[a][0], p[a][1], p[a][2], p[c][0], p[c][1], p[c][2], p[d][0], p[d][1], p[d][2], STEIN, 0);
    v[OBJ.FELS] = vorlage(b);
  }
  { // Dünengras
    const b = new Netzbauer();
    for (let i = 0; i < 4; i++) {
      const w = (i / 4) * Math.PI + 0.3;
      const c = Math.cos(w) * 0.45, s = Math.sin(w) * 0.45;
      b.dreieck(-c, 0, -s, c, 0, s, c * 0.5, 0.85, s * 0.5 + 0.2, HALM, 1);
      b.dreieck(c, 0, s, -c, 0, -s, -c * 0.5, 0.75, -s * 0.5 - 0.15, HALM, 1);
    }
    v[OBJ.DUENENGRAS] = vorlage(b);
  }
  _vorlagen = v;
  return v;
}

let _pflanzenMat: THREE.ShaderMaterial | null = null;
export function pflanzenMaterial(): THREE.ShaderMaterial {
  if (_pflanzenMat) return _pflanzenMat;
  _pflanzenMat = weltMaterial({
    vertex: /* glsl */ `
      ${GLSL_UMGEBUNG}
      attribute vec3 art; // x: 0 Stamm, 1 Laub, 2 Nadeln · y: Windgewicht · z: Zufallston
      varying vec3 vWelt; varying vec3 vNormal; varying vec3 vFarbe; varying vec3 vArt;
      void main() {
        vec3 p = position;
        float w = art.y;
        p.x += sin(uZeit * 1.4 + p.x * 0.31 + p.z * 0.17) * 0.07 * w;
        p.z += cos(uZeit * 1.1 + p.x * 0.13 + p.z * 0.29) * 0.06 * w;
        vWelt = p; vNormal = normal; vFarbe = color; vArt = art;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragment: /* glsl */ `
      ${GLSL_UMGEBUNG}
      varying vec3 vWelt; varying vec3 vNormal; varying vec3 vFarbe; varying vec3 vArt;
      void main() {
        // Pflanzen direkt vor der Kamera lösen sich auf, damit sie das Auto nicht verdecken
        float nah = length(cameraPosition - vWelt);
        if (nah < 9.0) {
          float raster = mod(floor(gl_FragCoord.x) + 2.0 * floor(gl_FragCoord.y), 4.0) * 0.25 + 0.125;
          if (smoothstep(3.0, 9.0, nah) < raster) discard;
        }
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        vec3 f = vFarbe;
        float ton = vArt.z;
        if (vArt.x > 0.5 && vArt.x < 1.5) {
          vec3 fruehling = f * vec3(0.95, 1.2, 0.7);
          vec3 herbst = mix(vec3(0.5, 0.27, 0.03), vec3(0.42, 0.07, 0.02), ton) * (0.7 + 0.6 * fract(ton * 7.3));
          vec3 winter = vec3(0.2, 0.16, 0.13);
          f = fruehling * uJahreszeit.x + f * uJahreszeit.y + herbst * uJahreszeit.z + winter * uJahreszeit.w;
        }
        // weiches Licht: Laub lässt etwas Sonne durch
        float ndl = dot(n, uSonne);
        vec3 licht = mix(uBodenLicht, uHimmelLicht, n.y * 0.5 + 0.5) + uSonnenFarbe * clamp(ndl * 0.65 + 0.35, 0.0, 1.0) * 0.85 + vec3(0.7, 0.75, 0.9) * uBlitz;
        vec3 c = f * licht;
        float schnee = uSchnee * smoothstep(0.1, 0.7, n.y) * step(0.5, vArt.x) * 0.8;
        c = mix(c, vec3(0.84, 0.88, 0.95) * licht, schnee);
        c += f * lampe(vWelt, n) * vec3(1.0, 0.94, 0.8) * 1.5;
        c = nebel(c, vWelt);
        gl_FragColor = vec4(ausgabe(c), 1.0);
      }`,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  return _pflanzenMat;
}

/** Verschmilzt alle Pflanzen einer Kachel zu einem Netz. `anteil` dünnt aus (ferne Kacheln). */
export function bauePflanzen(objekte: KachelObjekte, anteil: number): THREE.BufferGeometry | null {
  const vl = pflanzenVorlagen();
  let ecken = 0;
  const auswahl: number[] = [];
  for (let i = 0; i < objekte.n; i++) {
    const v = vl[objekte.typ[i]];
    if (!v) continue;
    if (anteil < 1) {
      // fern: nur Bäume, zufällig ausgedünnt
      if (!OBJEKT_TYPEN[objekte.typ[i]].fest || hash2(i, objekte.n, 7) > anteil) continue;
    }
    auswahl.push(i);
    ecken += v.ecken;
  }
  if (ecken === 0) return null;
  const pos = new Float32Array(ecken * 3), nor = new Float32Array(ecken * 3), col = new Float32Array(ecken * 3), art = new Float32Array(ecken * 3);
  let o = 0;
  let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const i of auswahl) {
    const v = vl[objekte.typ[i]]!;
    const s = objekte.skala[i], c = Math.cos(objekte.gier[i]), sn = Math.sin(objekte.gier[i]);
    const ox = objekte.x[i], oy = objekte.y[i], oz = objekte.z[i];
    const hell = 0.8 + hash2(i, 3, 9) * 0.45;
    const ton = hash2(i, 5, 13);
    for (let e = 0; e < v.ecken; e++) {
      const lx = v.pos[e * 3], ly = v.pos[e * 3 + 1], lz = v.pos[e * 3 + 2];
      const q = (o + e) * 3;
      pos[q] = ox + (lx * c + lz * sn) * s; pos[q + 1] = oy + ly * s - 0.15; pos[q + 2] = oz + (-lx * sn + lz * c) * s;
      const nx = v.nor[e * 3], nz = v.nor[e * 3 + 2];
      nor[q] = nx * c + nz * sn; nor[q + 1] = v.nor[e * 3 + 1]; nor[q + 2] = -nx * sn + nz * c;
      col[q] = v.col[e * 3] * hell; col[q + 1] = v.col[e * 3 + 1] * hell; col[q + 2] = v.col[e * 3 + 2] * hell;
      art[q] = v.art[e]; art[q + 1] = v.art[e] > 0 ? Math.min(1.5, (ly * s) / 4) : 0; art[q + 2] = ton;
    }
    o += v.ecken;
    if (ox < minX) minX = ox; if (ox > maxX) maxX = ox; if (oz < minZ) minZ = oz; if (oz > maxZ) maxZ = oz;
    if (oy < minY) minY = oy; if (oy + 14 > maxY) maxY = oy + 14;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('art', new THREE.BufferAttribute(art, 3));
  const mx = (minX + maxX) / 2, my = (minY + maxY) / 2, mz = (minZ + maxZ) / 2;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(mx, my, mz), Math.hypot(maxX - mx + 5, maxY - my, maxZ - mz + 5));
  return geo;
}

// ---------------------------------------------------------------------------------------------
// Requisiten: einzelne, zerstörbare Objekte als Instanzen je Kachel
// ---------------------------------------------------------------------------------------------

let _requisitGeo: (THREE.BufferGeometry | null)[] | null = null;
function requisitGeometrien(): (THREE.BufferGeometry | null)[] {
  if (_requisitGeo) return _requisitGeo;
  const g: (THREE.BufferGeometry | null)[] = new Array(OBJ_ANZAHL).fill(null);
  const WEISS: Farbe = [0.85, 0.85, 0.84], SCHWARZ: Farbe = [0.04, 0.04, 0.04], ROT: Farbe = [0.7, 0.05, 0.04], ORANGE: Farbe = [0.9, 0.3, 0.03];
  const HOLZ: Farbe = [0.36, 0.24, 0.13], METALL: Farbe = [0.42, 0.44, 0.46], STROH: Farbe = [0.68, 0.55, 0.22], GELB: Farbe = [0.9, 0.7, 0.08], LAMPE: Farbe = [1.0, 0.86, 0.55];
  let b = new Netzbauer();
  b.quader(0, 0.5, 0, 0.13, 1.0, 0.07, WEISS); b.quader(0, 0.82, 0, 0.14, 0.16, 0.08, SCHWARZ); b.quader(0, 0.82, 0.045, 0.07, 0.11, 0.01, ORANGE, 0, 2);
  g[OBJ.LEITPFOSTEN] = b.geometrie();
  b = new Netzbauer();
  b.quader(0, 1.1, 0, 0.08, 2.2, 0.08, METALL);
  b.dreieck(-0.55, 1.75, 0.05, 0.55, 1.75, 0.05, 0, 2.7, 0.05, ROT); b.dreieck(-0.36, 1.86, 0.06, 0.36, 1.86, 0.06, 0, 2.48, 0.06, WEISS);
  b.dreieck(0.55, 1.75, -0.05, -0.55, 1.75, -0.05, 0, 2.7, -0.05, METALL);
  g[OBJ.SCHILD] = b.geometrie();
  b = new Netzbauer();
  b.zylinder(0, 0, 0, 0.11, 0.07, 6.2, 5, METALL, 0, false); b.quader(0, 6.25, 0.7, 0.12, 0.1, 1.6, METALL); b.quader(0, 6.16, 1.3, 0.3, 0.08, 0.6, LAMPE, 0, 2);
  g[OBJ.LATERNE] = b.geometrie();
  b = new Netzbauer();
  for (const z of [-3.6, -1.2, 1.2, 3.6]) b.quader(0, 0.55, z, 0.12, 1.1, 0.12, HOLZ);
  b.quader(0, 0.85, 0, 0.06, 0.12, 7.4, HOLZ); b.quader(0, 0.45, 0, 0.06, 0.12, 7.4, HOLZ);
  g[OBJ.ZAUN] = b.geometrie();
  b = new Netzbauer();
  b.zylinder(0, 0, 0, 0.82, 0.82, 1.3, 9, STROH); g[OBJ.HEUBALLEN] = b.geometrie();
  b = new Netzbauer();
  b.quader(0, 0.5, 0, 1.0, 1.0, 1.0, HOLZ); b.quader(0, 0.5, 0, 1.04, 0.12, 1.04, [0.26, 0.17, 0.09]); g[OBJ.KISTE] = b.geometrie();
  b = new Netzbauer();
  b.quader(0, 0.03, 0, 0.42, 0.06, 0.42, ORANGE); b.zylinder(0, 0.06, 0, 0.16, 0.03, 0.64, 6, ORANGE); b.zylinder(0, 0.3, 0, 0.115, 0.085, 0.14, 6, WEISS, 0, false);
  g[OBJ.PYLON] = b.geometrie();
  b = new Netzbauer();
  b.quader(0, 1.1, 0, 0.06, 2.2, 0.06, WEISS);
  for (let i = 0; i < 8; i++) {
    const w0 = (i / 8) * Math.PI * 2, w1 = ((i + 1) / 8) * Math.PI * 2;
    b.dreieck(Math.cos(w0) * 1.5, 1.95, Math.sin(w0) * 1.5, 0, 2.5, 0, Math.cos(w1) * 1.5, 1.95, Math.sin(w1) * 1.5, i % 2 ? ROT : WEISS);
    b.dreieck(Math.cos(w1) * 1.5, 1.95, Math.sin(w1) * 1.5, 0, 2.5, 0, Math.cos(w0) * 1.5, 1.95, Math.sin(w0) * 1.5, i % 2 ? ROT : WEISS);
  }
  g[OBJ.STRANDSCHIRM] = b.geometrie();
  b = new Netzbauer();
  for (const x of [-1.05, 1.05]) b.quader(x, 0.55, 0, 0.05, 1.1, 0.05, METALL);
  b.quader(0, 1.08, 0, 2.15, 0.05, 0.05, METALL); b.quader(0, 0.2, 0, 2.15, 0.05, 0.05, METALL);
  for (let i = -4; i <= 4; i++) b.quader(i * 0.23, 0.64, 0, 0.025, 0.86, 0.025, METALL);
  for (const x of [-1.05, 1.05]) b.quader(x, 0.03, 0, 0.06, 0.06, 0.6, METALL);
  g[OBJ.ABSPERRUNG] = b.geometrie();
  b = new Netzbauer();
  b.zylinder(0, 0, 0, 0.36, 0.36, 0.92, 8, [0.1, 0.25, 0.5]); b.zylinder(0, 0.3, 0, 0.375, 0.375, 0.06, 8, GELB, 0, false);
  g[OBJ.FASS] = b.geometrie();
  _requisitGeo = g;
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

/** Instanzierte Requisiten einer Kachel. Merkt sich, welche Instanz zu welchem Objekt gehört. */
export class KachelRequisiten {
  readonly gruppe = new THREE.Group();
  private readonly netze: { netz: THREE.InstancedMesh; objekt: Int32Array }[] = [];
  private version = -1;

  constructor(private readonly objekte: KachelObjekte) {
    const geos = requisitGeometrien();
    const zaehler = new Int32Array(OBJ_ANZAHL);
    for (let i = 0; i < objekte.n; i++) if (geos[objekte.typ[i]]) zaehler[objekte.typ[i]]++;
    for (let t = 0; t < OBJ_ANZAHL; t++) {
      if (!zaehler[t]) continue;
      const netz = new THREE.InstancedMesh(geos[t]!, objektMaterial(true), zaehler[t]);
      const objekt = new Int32Array(zaehler[t]);
      let q = 0;
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < objekte.n; i++) if (objekte.typ[i] === t) { objekt[q++] = i; cx += objekte.x[i]; cy += objekte.y[i]; cz += objekte.z[i]; }
      netz.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx / q, cy / q, cz / q), 230);
      netz.matrixAutoUpdate = false;
      this.netze.push({ netz, objekt });
      this.gruppe.add(netz);
    }
    this.gruppe.matrixAutoUpdate = false;
    this.gleicheAb();
  }

  get leer(): boolean { return this.netze.length === 0; }

  /** Übernimmt Zerstörungen aus den Objektdaten. */
  gleicheAb(): void {
    if (this.version === this.objekte.version) return;
    this.version = this.objekte.version;
    const o = this.objekte;
    for (const { netz, objekt } of this.netze) {
      for (let q = 0; q < objekt.length; q++) {
        const i = objekt[q];
        const s = o.zustand[i] ? 0 : o.skala[i];
        _q.setFromAxisAngle(Y, o.gier[i]);
        _m.compose(_p.set(o.x[i], o.y[i], o.z[i]), _q, _s.set(s, s, s));
        netz.setMatrixAt(q, _m);
      }
      netz.instanceMatrix.needsUpdate = true;
    }
  }

  entsorge(): void {
    for (const { netz } of this.netze) netz.dispose();
  }
}
