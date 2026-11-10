import * as THREE from 'three';
import type { Boden, Bodenkontakt } from '../physik/typen';
import { U, UNTERGRUENDE } from '../physik/untergrund';
import { GLSL_UMGEBUNG, weltMaterial } from '../engine/shader';
import { rauschTextur } from '../engine/texturen';
import { glatt } from '../engine/mathe';

const HALB = 600;

/** Farben der Untergründe für Testfläche und Karte (linear RGB). */
export const UNTERGRUND_FARBE: Record<number, [number, number, number]> = {
  [U.ASPHALT]: [0.09, 0.095, 0.105], [U.BETON]: [0.3, 0.3, 0.29], [U.SCHOTTER]: [0.36, 0.31, 0.25],
  [U.ERDE]: [0.2, 0.14, 0.09], [U.GRAS]: [0.13, 0.26, 0.07], [U.SAND]: [0.62, 0.52, 0.33],
  [U.SCHNEE]: [0.85, 0.88, 0.93], [U.EIS]: [0.55, 0.72, 0.85], [U.FELS]: [0.26, 0.25, 0.24],
  [U.FLACHWASSER]: [0.3, 0.42, 0.45], [U.PFLASTER]: [0.24, 0.22, 0.2],
};

/**
 * Teststrecke: ebene Asphaltfläche mit Untergrund-Bahnen, Bodenwellen, Sprungschanze und Steilkurve.
 * Dient der Abstimmung des Fahrmodells und als Probefahrt-Gelände der Garage.
 */
export class Testgelaende implements Boden {
  readonly gruppe = new THREE.Group();
  readonly name = 'teststrecke';

  constructor() {
    this.baue();
  }

  untergrund(x: number, z: number): number {
    // Bahnen entlang z bei x > 60: je 40 m breit
    if (z > -250 && z < 450 && x > 60 && x < 60 + 7 * 40) {
      const bahn = Math.floor((x - 60) / 40);
      return [U.SCHOTTER, U.ERDE, U.GRAS, U.SAND, U.SCHNEE, U.EIS, U.PFLASTER][bahn];
    }
    if (x < -320) return U.GRAS;
    return U.ASPHALT;
  }

  hoehe(x: number, z: number): number {
    let h = 0;
    // Bodenwellen im Westen
    if (x < -60) {
      const f = glatt(-60, -110, x) * glatt(-HALB, -HALB + 60, x);
      h += f * (1.3 * Math.sin(x / 16) * Math.sin(z / 21) + 0.5 * Math.sin(x / 6.3 + 1) * Math.sin(z / 7.7));
    }
    // große Hügel im Nordwesten
    if (x < -320) h += glatt(-320, -420, x) * 14 * (0.5 + 0.5 * Math.sin(z / 70)) * (0.6 + 0.4 * Math.sin(x / 55));
    // Sprungschanze: x ∈ [-6, 6], z ∈ [150, 172]
    if (Math.abs(x) < 6 && z > 150 && z < 172) h = Math.max(h, (z - 150) * 0.16 * glatt(6, 5.2, Math.abs(x)));
    // zweite, größere Schanze
    if (Math.abs(x + 30) < 7 && z > 260 && z < 296) h = Math.max(h, Math.pow((z - 260) / 36, 1.6) * 7.5 * glatt(7, 6, Math.abs(x + 30)));
    // Steilkurve (Schüssel) im Süden: Mittelpunkt (0, -330), Radius 60..110
    const dx = x, dz = z + 330;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 70 && d < 135) h += Math.pow(glatt(70, 130, d), 2) * 16;
    else if (d >= 135 && d < 150) h += 16 * glatt(150, 135, d);
    return h;
  }

  abfrage(x: number, z: number, _y: number, aus: Bodenkontakt): void {
    const e = 0.4;
    const h = this.hoehe(x, z);
    const hx = this.hoehe(x + e, z) - this.hoehe(x - e, z);
    const hz = this.hoehe(x, z + e) - this.hoehe(x, z - e);
    const nx = -hx, ny = 2 * e, nz = -hz;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    aus.hoehe = h; aus.nx = nx / l; aus.ny = ny / l; aus.nz = nz / l;
    aus.untergrund = this.untergrund(x, z);
  }

  startPunkt(): { x: number; z: number; gier: number } {
    return { x: 0, z: 0, gier: 0 };
  }

  aktualisiere(): void { /* statische Fläche */ }

  private baue(): void {
    const N = 300, schritt = (HALB * 2) / N;
    const pos = new Float32Array((N + 1) * (N + 1) * 3);
    const farbe = new Float32Array((N + 1) * (N + 1) * 3);
    const nor = new Float32Array((N + 1) * (N + 1) * 3);
    const k: Bodenkontakt = { hoehe: 0, nx: 0, ny: 1, nz: 0, untergrund: 0 };
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const x = -HALB + i * schritt, z = -HALB + j * schritt;
        this.abfrage(x, z, 0, k);
        const o = (j * (N + 1) + i) * 3;
        pos[o] = x; pos[o + 1] = k.hoehe; pos[o + 2] = z;
        nor[o] = k.nx; nor[o + 1] = k.ny; nor[o + 2] = k.nz;
        const f = UNTERGRUND_FARBE[k.untergrund];
        farbe[o] = f[0]; farbe[o + 1] = f[1]; farbe[o + 2] = f[2];
      }
    }
    const index = new Uint32Array(N * N * 6);
    let q = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
        index[q++] = a; index[q++] = c; index[q++] = b;
        index[q++] = b; index[q++] = c; index[q++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(farbe, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    const mat = weltMaterial({
      vertex: /* glsl */ `
        varying vec3 vWelt; varying vec3 vNormal; varying vec3 vFarbe;
        void main() {
          vWelt = position; vNormal = normal; vFarbe = color;
          gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
        }`,
      fragment: /* glsl */ `
        ${GLSL_UMGEBUNG}
        uniform sampler2D uRausch;
        varying vec3 vWelt; varying vec3 vNormal; varying vec3 vFarbe;
        float linie(float wert, float breite) {
          float f = abs(fract(wert - 0.5) - 0.5) / fwidth(wert);
          return 1.0 - clamp(f - breite, 0.0, 1.0);
        }
        void main() {
          vec3 n = normalize(vNormal);
          float korn = texture2D(uRausch, vWelt.xz * 0.11).g;
          float grob = texture2D(uRausch, vWelt.xz * 0.004).r;
          vec3 farbe = vFarbe * (0.78 + 0.34 * korn) * (0.86 + 0.28 * grob);
          // Raster: 10 m fein, 50 m kräftig
          float d = length(vWelt - cameraPosition);
          float g10 = max(linie(vWelt.x / 10.0, 0.6), linie(vWelt.z / 10.0, 0.6)) * smoothstep(260.0, 60.0, d);
          float g50 = max(linie(vWelt.x / 50.0, 1.2), linie(vWelt.z / 50.0, 1.2));
          farbe = mix(farbe, vec3(0.75, 0.78, 0.8), g10 * 0.22);
          farbe = mix(farbe, vec3(1.0, 0.78, 0.2), g50 * 0.55 * smoothstep(900.0, 200.0, d));
          vec3 c = farbe * lichtDiffus(n, 1.0);
          c += farbe * lampe(vWelt, n) * vec3(1.0, 0.94, 0.8) * 2.2;
          // Nässe: dunkler, spiegelnd
          vec3 v = normalize(cameraPosition - vWelt);
          float fres = pow(1.0 - max(dot(n, v), 0.0), 5.0);
          c = mix(c, c * 0.6 + himmelFarbe(reflect(-v, n)) * (0.08 + 0.6 * fres), uNaesse * 0.8);
          c = nebel(c, vWelt);
          gl_FragColor = vec4(ausgabe(c), 1.0);
        }`,
      uniforms: { uRausch: { value: rauschTextur() } },
      vertexColors: true,
    });
    const netz = new THREE.Mesh(geo, mat);
    netz.frustumCulled = false;
    this.gruppe.add(netz);
    void UNTERGRUENDE;
  }
}
