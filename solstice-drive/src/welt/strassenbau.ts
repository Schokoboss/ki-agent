import * as THREE from 'three';
import { GLSL_UMGEBUNG, weltMaterial } from '../engine/shader';
import { Netzbauer, type Farbe } from '../engine/netzbau';
import { rauschTextur } from '../engine/texturen';
import { glatt } from '../engine/mathe';
import { KACHEL, KACHELN, WELT_HALB } from './daten/regionen';
import type { StrassenTyp } from './daten/strassentypen';
import { FLAG_BRUECKE, FLAG_NORMAL, FLAG_TUNNEL, TUNNEL_HOEHE, type Strasse } from './strassennetz';
import type { Weltkarte } from './weltkarte';

const TYP_INDEX: Record<StrassenTyp, number> = { schnellstrasse: 0, landstrasse: 1, bergstrasse: 2, stadtstrasse: 3, schotter: 4, feldweg: 5, sandpiste: 6 };

const VERTEX = /* glsl */ `
attribute vec4 art; // x Typ, y Markierungsstärke, z Bauwerk (0 normal, 1 Brücke, 2 Tunnel), w Halbbreite
varying vec3 vWelt; varying vec3 vNormal; varying vec2 vUv; varying vec4 vArt;
void main() {
  vWelt = position; vNormal = normal; vUv = uv; vArt = art;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */ `
${GLSL_UMGEBUNG}
uniform sampler2D uRausch;
varying vec3 vWelt; varying vec3 vNormal; varying vec2 vUv; varying vec4 vArt;
float streifen(float u, float mitte, float breite) {
  float d = abs(u - mitte) - breite * 0.5;
  return 1.0 - smoothstep(0.0, fwidth(u) * 1.5, d);
}
void main() {
  vec3 n = normalize(vNormal);
  float typ = floor(vArt.x + 0.5);
  float hw = vArt.w;
  float u = vUv.x, v = vUv.y;
  float au = abs(u);
  float fein = texture2D(uRausch, vWelt.xz * 0.19).g;
  float grob = texture2D(uRausch, vWelt.xz * 0.011).r;
  vec3 farbe;
  float glaette = 0.0;
  bool asphalt = typ < 3.5;
  if (asphalt) {
    farbe = vec3(0.075, 0.08, 0.09) * (0.75 + 0.5 * fein) * (0.85 + 0.3 * grob);
    // helle Fahrspuren
    float spur = hw > 6.0 ? hw * 0.25 : hw * 0.5;
    float fahr = exp(-pow((mod(au, spur * 2.0) - spur) / 0.9, 2.0));
    farbe *= 1.0 + 0.12 * fahr;
    float m = 0.0;
    float strich = step(0.4, fract(v / 10.0));
    if (typ < 0.5) {
      m = max(streifen(au, 0.16, 0.13), streifen(au, hw - 0.35, 0.16));
      m = max(m, streifen(au, hw * 0.5, 0.13) * strich);
    } else if (typ < 1.5 || typ > 2.5) {
      m = max(streifen(u, 0.0, 0.13) * strich, streifen(au, hw - 0.3, 0.13));
    } else {
      m = streifen(u, 0.0, 0.12) * strich;
    }
    m *= vArt.y * (0.75 + 0.25 * fein);
    vec3 mf = typ < 0.5 && au < 0.4 ? vec3(0.85, 0.62, 0.1) : vec3(0.82, 0.82, 0.8);
    farbe = mix(farbe, mf, m);
    glaette = 1.0;
  } else if (typ < 4.5) {
    farbe = vec3(0.4, 0.345, 0.275) * (0.7 + 0.6 * fein);
    farbe *= 1.0 - 0.22 * exp(-pow((au - 0.85) / 0.4, 2.0));
  } else if (typ < 5.5) {
    farbe = vec3(0.25, 0.175, 0.11) * (0.7 + 0.6 * fein);
    farbe = mix(farbe, vec3(0.13, 0.2, 0.06), smoothstep(0.35, 0.0, au) * 0.6);
    farbe *= 1.0 - 0.25 * exp(-pow((au - 0.8) / 0.35, 2.0));
  } else {
    farbe = vec3(0.68, 0.55, 0.35) * (0.8 + 0.4 * fein);
    farbe *= 1.0 - 0.15 * exp(-pow((au - 0.85) / 0.45, 2.0));
  }
  // Bankett
  float bankett = smoothstep(hw - 0.05, hw + 0.25, au);
  vec3 randFarbe = asphalt ? vec3(0.3, 0.27, 0.22) : farbe * 0.8;
  farbe = mix(farbe, randFarbe * (0.7 + 0.6 * fein), bankett * step(vArt.z, 0.5));
  // Schnee im Winter: lose Wege und hohe Pässe
  float schnee = uSchnee * (asphalt ? smoothstep(280.0, 320.0, vWelt.y) : smoothstep(15.0, 35.0, vWelt.y));
  schnee = max(schnee, smoothstep(425.0, 455.0, vWelt.y) * 0.8);
  vec3 schneeFarbe = vec3(0.8, 0.85, 0.93) * (0.82 + 0.18 * fein) * (1.0 - 0.2 * exp(-pow((au - 0.85) / 0.4, 2.0)));
  farbe = mix(farbe, schneeFarbe, schnee);
  vec3 c;
  bool tunnel = vArt.z > 1.5;
  if (tunnel) {
    c = farbe * (vec3(0.5, 0.45, 0.36) + 0.1);
    c += farbe * lampe(vWelt, n) * vec3(1.0, 0.94, 0.8) * 2.0;
  } else {
    c = farbe * lichtDiffus(n, 1.0);
    c += farbe * lampe(vWelt, n) * vec3(1.0, 0.94, 0.8) * 2.4;
    // Nässe: Pfützen spiegeln den Himmel
    float nass = uNaesse * (1.0 - schnee);
    if (nass > 0.01) {
      vec3 bl = normalize(cameraPosition - vWelt);
      float pfuetze = smoothstep(0.52, 0.7, grob + fein * 0.2) * glaette;
      float fres = pow(1.0 - max(dot(n, bl), 0.0), 4.0);
      vec3 sp = himmelFarbe(reflect(-bl, n));
      c = mix(c * (1.0 - 0.35 * nass), sp, nass * (0.06 + 0.5 * fres) * (0.35 + 0.65 * pfuetze));
    }
  }
  c = nebel(c, vWelt);
  gl_FragColor = vec4(ausgabe(c), 1.0);
}`;

let _mat: THREE.ShaderMaterial | null = null;
export function strassenMaterial(): THREE.ShaderMaterial {
  if (!_mat) {
    _mat = weltMaterial({ vertex: VERTEX, fragment: FRAGMENT, uniforms: { uRausch: { value: rauschTextur() } } });
    _mat.polygonOffset = true; _mat.polygonOffsetFactor = -1; _mat.polygonOffsetUnits = -2;
  }
  return _mat;
}

/** Seitenvektoren (links) je Stützpunkt, über benachbarte Segmente gemittelt. */
const linksCache = new WeakMap<Strasse, Float32Array>();
export function linksVektoren(st: Strasse): Float32Array {
  let l = linksCache.get(st);
  if (l) return l;
  l = new Float32Array(st.n * 2);
  for (let i = 0; i < st.n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(st.n - 1, i + 1);
    const dx = st.x[b] - st.x[a], dz = st.z[b] - st.z[a];
    const len = Math.hypot(dx, dz) || 1;
    l[i * 2] = dz / len; l[i * 2 + 1] = -dx / len;
  }
  linksCache.set(st, l);
  return l;
}

/** Zuordnung Segment → Kachel (nach Segmentmitte), einmalig je Welt. */
export class StrassenKacheln {
  readonly segmente: number[][] = [];
  readonly knoten: number[][] = [];
  constructor(readonly karte: Weltkarte) {
    for (let i = 0; i < KACHELN * KACHELN; i++) { this.segmente.push([]); this.knoten.push([]); }
    const kachel = (x: number, z: number) => {
      const kx = Math.min(KACHELN - 1, Math.max(0, Math.floor((x + WELT_HALB) / KACHEL))), kz = Math.min(KACHELN - 1, Math.max(0, Math.floor((z + WELT_HALB) / KACHEL)));
      return kz * KACHELN + kx;
    };
    for (const st of karte.netz.strassen) {
      for (let i = 0; i < st.n - 1; i++) this.segmente[kachel((st.x[i] + st.x[i + 1]) / 2, (st.z[i] + st.z[i + 1]) / 2)].push((st.index << 14) | i);
    }
    for (const k of karte.netz.knoten) this.knoten[kachel(k.x, k.z)].push(k.index);
  }

  /** Fahrbahnnetz einer Kachel oder null, wenn dort keine Straße liegt. */
  baueFahrbahn(kachel: number): THREE.BufferGeometry | null {
    const refs = this.segmente[kachel], knoten = this.knoten[kachel];
    if (refs.length === 0 && knoten.length === 0) return null;
    const netz = this.karte.netz;
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], art: number[] = [], idx: number[] = [];
    let basis = 0;
    for (const ref of refs) {
      const st = netz.strassen[ref >> 14], i = ref & 16383;
      const L = linksVektoren(st);
      const hw = st.halbbreite, typ = TYP_INDEX[st.typ];
      const flag = st.flag[i] | st.flag[i + 1];
      const bauwerk = flag & FLAG_TUNNEL ? 2 : flag & FLAG_BRUECKE ? 1 : 0;
      const rand = bauwerk ? 0.35 : 1.5, tief = bauwerk ? 0 : 0.34;
      const versatz = 0.004 * (st.index % 4);
      for (let e = 0; e < 2; e++) {
        const k = i + e;
        const px = st.x[k], py = st.y[k] + versatz, pz = st.z[k];
        const lx = L[k * 2], lz = L[k * 2 + 1];
        const q = st.quer[k];
        const mark = glatt(10, 26, st.s[k]) * glatt(10, 26, st.laenge - st.s[k]);
        const dy = k < st.n - 1 ? (st.y[k + 1] - st.y[k]) / (st.s[k + 1] - st.s[k]) : 0;
        // Normale aus Längsneigung und Querneigung
        let nx = -q * lx - dy * -lz, ny = 1, nz = -q * lz - dy * lx;
        const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
        const quer = [hw + rand, hw, -hw, -hw - rand];
        for (let c = 0; c < 4; c++) {
          const u = quer[c];
          const aussen = c === 0 || c === 3;
          pos.push(px + lx * u, py + (aussen ? Math.sign(u) * hw * q - tief : u * q), pz + lz * u);
          nor.push(nx, ny, nz);
          uv.push(u, st.s[k]);
          art.push(typ, mark, bauwerk, hw);
        }
      }
      for (let c = 0; c < 3; c++) {
        const a = basis + c, b = basis + c + 1, d = basis + 4 + c, f = basis + 4 + c + 1;
        idx.push(a, b, d, b, f, d);
      }
      basis += 8;
    }
    // Kreuzungsflächen
    for (const ki of knoten) {
      const k = netz.knoten[ki];
      if (k.strassen.length < 2) continue;
      let hw = 0, typ = 6, loses = true;
      for (const si of k.strassen) {
        const st = netz.strassen[si];
        if (st.halbbreite > hw) { hw = st.halbbreite; typ = TYP_INDEX[st.typ]; }
        if (TYP_INDEX[st.typ] < 4) loses = false;
      }
      if (loses && k.strassen.length < 3) continue;
      const r = hw * (k.strassen.length > 2 ? 1.35 : 1.03);
      const mitte = basis;
      pos.push(k.x, k.y + 0.03, k.z); nor.push(0, 1, 0); uv.push(0, 0); art.push(typ, 0, 0, r * 2);
      const seiten = 14;
      for (let s = 0; s < seiten; s++) {
        const w = (s / seiten) * Math.PI * 2;
        pos.push(k.x + Math.cos(w) * r, k.y + 0.03, k.z + Math.sin(w) * r); nor.push(0, 1, 0); uv.push(0, 0); art.push(typ, 0, 0, r * 2);
      }
      for (let s = 0; s < seiten; s++) idx.push(mitte, mitte + 1 + ((s + 1) % seiten), mitte + 1 + s);
      basis += seiten + 1;
    }
    if (idx.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('art', new THREE.Float32BufferAttribute(art, 4));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  }

  /** Brückengeländer, Pfeiler, Tunnelröhren und Portale einer Kachel. */
  baueBauwerke(kachel: number): THREE.BufferGeometry | null {
    const refs = this.segmente[kachel];
    const netz = this.karte.netz, karte = this.karte;
    const b = new Netzbauer();
    const BETON: Farbe = [0.42, 0.42, 0.41], BETON_D: Farbe = [0.3, 0.3, 0.3], STAHL: Farbe = [0.55, 0.2, 0.12];
    const WAND: Farbe = [0.36, 0.35, 0.33], LICHT: Farbe = [1.0, 0.85, 0.55], SEIL: Farbe = [0.75, 0.75, 0.78];
    for (const ref of refs) {
      const st = netz.strassen[ref >> 14], i = ref & 16383;
      const flag = st.flag[i] | st.flag[i + 1];
      if (flag === FLAG_NORMAL) continue;
      const L = linksVektoren(st);
      const hw = st.halbbreite;
      const P = (k: number, u: number, h: number) => ({ x: st.x[k] + L[k * 2] * u, y: st.y[k] + h, z: st.z[k] + L[k * 2 + 1] * u });
      if (flag & FLAG_BRUECKE) {
        const a = hw + 0.35;
        for (const s of [1, -1]) {
          // Geländer (innen, oben, außen) und Stirnseite der Fahrbahnplatte
          const i0 = P(i, s * (a - 0.25), 0), i1 = P(i + 1, s * (a - 0.25), 0), o0 = P(i, s * (a - 0.25), 0.95), o1 = P(i + 1, s * (a - 0.25), 0.95);
          const a0 = P(i, s * a, 0.95), a1 = P(i + 1, s * a, 0.95), u0 = P(i, s * a, -0.9), u1 = P(i + 1, s * a, -0.9);
          if (s > 0) { b.viereck(i0, o0, o1, i1, BETON); b.viereck(o0, a0, a1, o1, BETON); b.viereck(a0, u0, u1, a1, BETON_D); }
          else { b.viereck(i0, i1, o1, o0, BETON); b.viereck(o0, o1, a1, a0, BETON); b.viereck(a0, a1, u1, u0, BETON_D); }
        }
        // Unterseite
        b.viereck(P(i, a, -0.9), P(i, -a, -0.9), P(i + 1, -a, -0.9), P(i + 1, a, -0.9), BETON_D);
        // Pfeiler alle 40 m
        if (i % 5 === 2) {
          const grund = Math.min(karte.hoeheGelaende(st.x[i], st.z[i]), st.y[i] - 2) - 1.5;
          const hoehe = st.y[i] - 0.9 - grund;
          if (hoehe > 1) {
            const gier = Math.atan2(st.x[i + 1] - st.x[i], st.z[i + 1] - st.z[i]);
            b.quader(st.x[i], grund + hoehe / 2, st.z[i], hw * 1.5, hoehe, 1.4, BETON, gier, 0, false);
          }
        }
        // Große Brücke: Pylone mit Seilen
        if (st.bauwerk === 'bruecke') {
          const t = st.s[i] / st.laenge;
          for (const tp of [0.3, 0.7]) {
            const ip = Math.round(tp * (st.n - 1));
            if (i === ip) {
              for (const s of [1, -1]) {
                const fuss = P(i, s * (a + 0.8), 0);
                b.quader(fuss.x, st.y[i] + 6, fuss.z, 1.6, 52, 1.6, STAHL, 0, 0, true);
              }
              const q0 = P(i, a + 0.8, 30), q1 = P(i, -a - 0.8, 30);
              b.stab(q0.x, q0.y, q0.z, q1.x, q1.y, q1.z, 1.2, STAHL);
            }
            const abstand = Math.abs(i - ip);
            if (abstand > 1 && abstand < 14 && abstand % 2 === 0) {
              for (const s of [1, -1]) {
                const oben = P(ip, s * (a + 0.8), 31 - abstand * 0.2), unten = P(i, s * (a + 0.1), 0.95);
                b.stab(oben.x, oben.y, oben.z, unten.x, unten.y, unten.z, 0.16, SEIL);
              }
            }
          }
          void t;
        }
      } else {
        // Tunnelröhre: Wände, Gewölbe, Lichtband
        const q: [number, number][] = [[hw + 0.6, 0], [hw + 0.6, 3.6], [hw * 0.6, 5.5], [0, TUNNEL_HOEHE], [-hw * 0.6, 5.5], [-hw - 0.6, 3.6], [-hw - 0.6, 0]];
        for (let c = 0; c < q.length - 1; c++) {
          const [u0, h0] = q[c], [u1, h1] = q[c + 1];
          b.viereck(P(i, u0, h0), P(i, u1, h1), P(i + 1, u1, h1), P(i + 1, u0, h0), WAND, 3);
        }
        if (i % 2 === 0) b.viereck(P(i, 0.5, TUNNEL_HOEHE - 0.12), P(i, -0.5, TUNNEL_HOEHE - 0.12), P(i + 1, -0.5, TUNNEL_HOEHE - 0.12), P(i + 1, 0.5, TUNNEL_HOEHE - 0.12), LICHT, 1);
        // Portal am Übergang
        for (const [k, vorn] of [[i, st.flag[i] !== FLAG_TUNNEL || (i > 0 && st.flag[i - 1] !== FLAG_TUNNEL)], [i + 1, st.flag[i + 1] !== FLAG_TUNNEL || (i + 2 < st.n && st.flag[i + 2] !== FLAG_TUNNEL)]] as [number, boolean][]) {
          if (!vorn) continue;
          for (let c = 0; c < q.length - 1; c++) {
            const [u0, h0] = q[c], [u1, h1] = q[c + 1];
            const g0 = P(k, u0 * 1.28 + Math.sign(u0) * 0.6, h0 * 1.22 + (h0 > 0 ? 0.9 : 0)), g1 = P(k, u1 * 1.28 + Math.sign(u1) * 0.6, h1 * 1.22 + (h1 > 0 ? 0.9 : 0));
            b.viereck(P(k, u0, h0), g0, g1, P(k, u1, h1), BETON);
            b.viereck(P(k, u0, h0), P(k, u1, h1), g1, g0, BETON);
          }
        }
      }
    }
    return b.leer ? null : b.geometrie();
  }
}
