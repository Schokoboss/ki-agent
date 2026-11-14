import * as THREE from 'three';
import { GLSL_UMGEBUNG, weltMaterial } from '../engine/shader';
import { rauschTextur } from '../engine/texturen';
import { RASTER_N, SEE, WELT_GROESSE, WELT_HALB } from './daten/regionen';
import { WASSER_UNIFORM } from './gelaende';
import type { Weltkarte } from './weltkarte';

/** Höhentextur (1024², 8 Bit): Geländehöhe von -12 m bis +12 m für Ufer- und Tiefenwirkung. */
export function hoehenTextur(karte: Weltkarte): THREE.DataTexture {
  const B = 1024;
  const daten = new Uint8Array(B * B);
  const N = RASTER_N;
  for (let j = 0; j < B; j++) {
    for (let i = 0; i < B; i++) {
      const h = karte.hoehen[Math.min(N - 1, j) * N + Math.min(N - 1, i)];
      daten[j * B + i] = Math.max(0, Math.min(255, Math.round(((h + 12) / 24) * 255)));
    }
  }
  const t = new THREE.DataTexture(daten, B, B, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Meer und Spiegelsee: eine große Fläche, die der Kamera folgt. Im Winter trägt der See Eis. */
export class Wasser {
  readonly netz: THREE.Mesh;
  constructor(karte: Weltkarte) {
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1).rotateX(-Math.PI / 2);
    const mat = weltMaterial({
      vertex: /* glsl */ `
        uniform float uWasserHoehe;
        varying vec3 vWelt;
        void main() {
          vec3 p = vec3(position.x * 24000.0 + cameraPosition.x, uWasserHoehe, position.z * 24000.0 + cameraPosition.z);
          vWelt = p;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragment: /* glsl */ `
        ${GLSL_UMGEBUNG}
        uniform sampler2D uRausch;
        uniform sampler2D uHoehe;
        uniform float uWasserHoehe;
        uniform vec3 uSee;
        varying vec3 vWelt;
        void main() {
          vec2 kuv = (vWelt.xz + ${WELT_HALB.toFixed(1)}) / ${WELT_GROESSE.toFixed(1)};
          float grund = -12.0;
          if (kuv.x > 0.0 && kuv.x < 1.0 && kuv.y > 0.0 && kuv.y < 1.0) grund = texture2D(uHoehe, kuv).r * 24.0 - 12.0;
          float tiefe = uWasserHoehe - grund;
          vec3 bl = cameraPosition - vWelt;
          float entf = length(bl);
          bl /= entf;
          // Eis auf dem See im Winter
          float see = step(length(vWelt.xz - uSee.xy), uSee.z) * step(0.5, uSchnee);
          if (see > 0.5) {
            float riss = texture2D(uRausch, vWelt.xz * 0.02).g;
            vec3 eis = mix(vec3(0.62, 0.76, 0.86), vec3(0.86, 0.92, 0.97), smoothstep(0.35, 0.6, riss));
            eis *= 1.0 - 0.35 * smoothstep(0.04, 0.0, abs(texture2D(uRausch, vWelt.xz * 0.006).r - 0.5));
            vec3 ce = eis * lichtDiffus(vec3(0.0, 1.0, 0.0), 1.0);
            float fr = pow(1.0 - max(bl.y, 0.0), 5.0);
            ce = mix(ce, himmelFarbe(reflect(-bl, vec3(0.0, 1.0, 0.0))), 0.1 + 0.5 * fr);
            ce += vec3(1.0, 0.94, 0.8) * lampe(vWelt, vec3(0.0, 1.0, 0.0)) * 0.6;
            gl_FragColor = vec4(ausgabe(nebel(ce, vWelt)), 1.0);
            return;
          }
          // Wellen aus zwei wandernden Rauschlagen
          vec2 w1 = vWelt.xz * 0.021 + vec2(uZeit * 0.011, uZeit * 0.007);
          vec2 w2 = vWelt.xz * 0.063 - vec2(uZeit * 0.016, -uZeit * 0.012);
          float e = 0.012;
          float h0 = texture2D(uRausch, w1).r * 0.65 + texture2D(uRausch, w2).g * 0.35;
          float hx = texture2D(uRausch, w1 + vec2(e, 0.0)).r * 0.65 + texture2D(uRausch, w2 + vec2(e * 3.0, 0.0)).g * 0.35;
          float hz = texture2D(uRausch, w1 + vec2(0.0, e)).r * 0.65 + texture2D(uRausch, w2 + vec2(0.0, e * 3.0)).g * 0.35;
          float stark = 1.4 / (1.0 + entf * 0.004);
          vec3 n = normalize(vec3((h0 - hx) * stark * 3.0, 1.0, (h0 - hz) * stark * 3.0));
          float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, bl), 0.0), 5.0);
          vec3 flach = vec3(0.07, 0.36, 0.34), tief = vec3(0.008, 0.06, 0.12);
          float d = 1.0 - exp(-max(tiefe, 0.0) * 0.32);
          vec3 koerper = mix(flach, tief, d) * (uHimmelLicht * 1.3 + uSonnenFarbe * max(uSonne.y, 0.0) * 0.7);
          vec3 sp = himmelFarbe(reflect(-bl, n));
          vec3 c = mix(koerper, sp, fres);
          // Sonnenglitzern
          c += uSonnenFarbe * pow(max(dot(reflect(-bl, n), uSonne), 0.0), 220.0) * 2.5;
          // Brandung am Ufer
          float schaum = smoothstep(0.75, 0.05, tiefe) * smoothstep(0.38, 0.62, h0 + 0.25 * sin(uZeit * 0.9 + tiefe * 9.0));
          c = mix(c, vec3(0.92, 0.95, 0.97) * (uHimmelLicht + uSonnenFarbe * 0.6), schaum * 0.8);
          float alpha = clamp(mix(0.25, 0.96, 1.0 - exp(-max(tiefe, 0.0) * 1.1)) + fres * 0.6 + schaum, 0.0, 1.0);
          alpha *= smoothstep(-0.03, 0.04, tiefe);
          c = nebel(c, vWelt);
          gl_FragColor = vec4(ausgabe(c), alpha);
        }`,
      uniforms: {
        uRausch: { value: rauschTextur() },
        uHoehe: { value: hoehenTextur(karte) },
        uWasserHoehe: WASSER_UNIFORM,
        uSee: { value: new THREE.Vector3(SEE.x, SEE.z, SEE.radius * 1.55) },
      },
      transparent: true,
      depthWrite: false,
    });
    this.netz = new THREE.Mesh(geo, mat);
    this.netz.frustumCulled = false;
    this.netz.renderOrder = 3;
  }
}
