import * as THREE from 'three';
import { GLSL_UMGEBUNG, weltMaterial } from '../engine/shader';
import { rauschTextur } from '../engine/texturen';

/** Himmelskuppel: Verlauf, Sonne, Mond, Sterne, ziehende Wolken. Folgt der Kamera. */
export class Himmel {
  readonly netz: THREE.Mesh;
  constructor(wolkenOktaven: number) {
    const geo = new THREE.SphereGeometry(1, 24, 12);
    const mat = weltMaterial({
      vertex: /* glsl */ `
        varying vec3 vRichtung;
        void main() {
          vRichtung = position;
          vec4 p = projectionMatrix * viewMatrix * vec4(position * 5000.0 + cameraPosition, 1.0);
          gl_Position = p.xyww; // immer ganz hinten
        }`,
      fragment: /* glsl */ `
        ${GLSL_UMGEBUNG}
        uniform sampler2D uRausch;
        uniform float uSterne;
        uniform float uWolken;
        varying vec3 vRichtung;
        void main() {
          vec3 r = normalize(vRichtung);
          float h = max(r.y, 0.0);
          vec3 c = mix(uHorizont, uZenit, pow(h, 0.5));
          float s = max(dot(r, uSonne), 0.0);
          // Sonnen-/Mondscheibe und Hof
          c += uSonnenFarbe * (pow(s, 12.0) * 0.22 + pow(s, 90.0) * 0.5 + smoothstep(0.9993, 0.9997, s) * 9.0) * (1.0 - uWolken * 0.75);
          // Sterne
          if (uSterne > 0.01) {
            vec2 g = r.xz / (abs(r.y) + 0.25) * 60.0;
            vec2 zelle = floor(g);
            float zufall = hash12(zelle);
            vec2 mitte = zelle + 0.5 + (vec2(hash12(zelle + 3.1), hash12(zelle + 7.7)) - 0.5) * 0.7;
            float d = length(g - mitte);
            float stern = step(0.86, zufall) * smoothstep(0.09, 0.0, d);
            c += vec3(0.9, 0.95, 1.0) * stern * uSterne * (0.5 + 0.5 * sin(uZeit * 2.0 + zufall * 40.0)) * smoothstep(0.0, 0.2, r.y);
          }
          // Wolken: zwei Schichten Rauschen auf einer Ebene
          if (r.y > -0.02) {
            vec2 uv = r.xz / (r.y + 0.22);
            vec2 wind = vec2(uZeit * 0.004, uZeit * 0.0017);
            float n = texture2D(uRausch, uv * 0.11 + wind).r;
            #if WOLKEN_OKTAVEN > 2
              n = n * 0.68 + texture2D(uRausch, uv * 0.31 - wind * 1.6).g * 0.32;
            #endif
            #if WOLKEN_OKTAVEN > 3
              n += (texture2D(uRausch, uv * 0.9 + wind * 3.0).g - 0.5) * 0.12;
            #endif
            float schwelle = mix(0.72, 0.18, uWolken);
            float dichte = smoothstep(schwelle, schwelle + 0.32, n);
            float rand = smoothstep(schwelle + 0.05, schwelle + 0.5, n);
            vec3 hell = uSonnenFarbe * 0.75 + uHimmelLicht * 0.9;
            vec3 dunkel = uHimmelLicht * mix(0.55, 0.22, uWolken) + uZenit * 0.2;
            vec3 wolke = mix(hell, dunkel, rand * (0.5 + 0.5 * uWolken));
            wolke += uSonnenFarbe * pow(s, 6.0) * 0.5 * (1.0 - rand);
            wolke += vec3(0.8, 0.85, 1.0) * uBlitz * 1.5;
            float fern = smoothstep(-0.02, 0.16, r.y);
            c = mix(c, wolke, dichte * fern * 0.96);
          }
          // Dunst am Horizont
          c = mix(c, uNebelFarbe, smoothstep(0.12, -0.02, r.y) * clamp(uNebelDichte * 900.0, 0.25, 1.0));
          gl_FragColor = vec4(ausgabe(c), 1.0);
        }`,
      uniforms: { uRausch: { value: rauschTextur() } },
      side: THREE.BackSide,
      depthWrite: false,
      defines: { WOLKEN_OKTAVEN: wolkenOktaven },
    });
    mat.depthTest = true;
    mat.depthFunc = THREE.LessEqualDepth;
    this.netz = new THREE.Mesh(geo, mat);
    this.netz.frustumCulled = false;
    this.netz.renderOrder = -10;
  }
}
