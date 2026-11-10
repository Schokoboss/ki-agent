import * as THREE from 'three';
import { GLSL_UMGEBUNG, weltMaterial } from '../engine/shader';

export interface Lackierung {
  farbe: number;
  akzent: number;
  /** 0 matt … 1 hochglänzend. */
  glanz: number;
  /** 0 Unilack … 1 Metallic. */
  metallic: number;
}

const VERTEX = /* glsl */ `
attribute float art;
attribute float kratzer;
varying vec3 vWelt;
varying vec3 vNormal;
varying vec3 vLokal;
varying float vArt;
varying float vKratzer;
varying vec2 vUv;
void main() {
  vec4 lokal = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    lokal = instanceMatrix * lokal;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 welt = modelMatrix * lokal;
  vWelt = welt.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  vLokal = lokal.xyz;
  vArt = art;
  vKratzer = kratzer;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * welt;
}`;

const FRAGMENT = /* glsl */ `
${GLSL_UMGEBUNG}
uniform vec3 uLack;
uniform vec3 uAkzent;
uniform float uGlanz;
uniform float uMetall;
uniform float uSchmutz;
uniform vec3 uSchmutzFarbe;
uniform float uBremse;
uniform float uLicht;
uniform float uAlpha;
uniform sampler2D uFolie;
uniform float uFolieAn;
varying vec3 vWelt;
varying vec3 vNormal;
varying vec3 vLokal;
varying float vArt;
varying float vKratzer;
varying vec2 vUv;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWelt);
  if (!gl_FrontFacing) n = -n;
  float art = floor(vArt + 0.5);
  vec3 farbe; float glanz = 0.0; float metall = 0.0; vec3 leuchten = vec3(0.0);
  if (art < 0.5 || abs(art - 7.0) < 0.5) {
    farbe = art < 0.5 ? uLack : uAkzent;
    if (uFolieAn > 0.5) { vec4 f = texture2D(uFolie, vUv); farbe = mix(farbe, f.rgb, f.a); }
    glanz = uGlanz; metall = uMetall;
    float kr = clamp(vKratzer, 0.0, 1.0);
    farbe = mix(farbe, vec3(0.2, 0.2, 0.22), kr * 0.85);
    glanz *= 1.0 - kr * 0.8;
  } else if (art < 1.5) { farbe = vec3(0.015, 0.022, 0.03); glanz = 1.0; }
  else if (art < 2.5) { farbe = vec3(0.035); glanz = 0.12; }
  else if (art < 3.5) { farbe = vec3(0.6, 0.62, 0.66); glanz = 0.9; metall = 1.0; }
  else if (art < 4.5) { farbe = vec3(0.8, 0.82, 0.86); glanz = 0.8; leuchten = vec3(1.0, 0.95, 0.82) * uLicht * 3.0; }
  else if (art < 5.5) { farbe = vec3(0.32, 0.02, 0.02); glanz = 0.6; leuchten = vec3(1.0, 0.07, 0.03) * (uLicht * 0.6 + uBremse * 2.4); }
  else if (art < 6.5) { farbe = vec3(0.02); }
  else if (art < 8.5) { farbe = vec3(0.86); glanz = 0.25; }
  else if (art < 9.5) { farbe = vec3(0.06, 0.055, 0.05); }
  else { farbe = vec3(0.028); glanz = 0.06; }

  float dreck = uSchmutz * smoothstep(0.55, -0.45, vLokal.y) * (0.55 + 0.45 * wertRauschen(vLokal.zy * 9.0 + vLokal.x));
  dreck = clamp(dreck, 0.0, 0.92);
  farbe = mix(farbe, uSchmutzFarbe, dreck);
  glanz *= 1.0 - dreck;

  vec3 c = farbe * lichtDiffus(n, 1.0) * (1.0 - 0.25 * metall);
  c += farbe * lampe(vWelt, n) * vec3(1.0, 0.95, 0.85) * 0.6;
  vec3 r = reflect(-v, n);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  vec3 tonung = mix(vec3(1.0), farbe * 2.0 + 0.12, metall);
  c += himmelFarbe(r) * tonung * glanz * (0.035 + 0.55 * fres + 0.12 * metall);
  float sp = pow(max(dot(r, uSonne), 0.0), mix(10.0, 160.0, glanz));
  c += uSonnenFarbe * sp * glanz;
  c += leuchten;
  c = nebel(c, vWelt);
  gl_FragColor = vec4(ausgabe(c), uAlpha);
}`;

let leereFolie: THREE.Texture | null = null;

/** Lackmaterial eines Autos. Jedes Auto bekommt eine eigene Instanz (eigene Uniformen). */
export function lackMaterial(l: Lackierung): THREE.ShaderMaterial {
  if (!leereFolie) {
    leereFolie = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    leereFolie.needsUpdate = true;
  }
  return weltMaterial({
    vertex: VERTEX,
    fragment: FRAGMENT,
    uniforms: {
      uLack: { value: new THREE.Color(l.farbe) },
      uAkzent: { value: new THREE.Color(l.akzent) },
      uGlanz: { value: l.glanz },
      uMetall: { value: l.metallic },
      uSchmutz: { value: 0 },
      uSchmutzFarbe: { value: new THREE.Color(0.35, 0.28, 0.2) },
      uBremse: { value: 0 },
      uLicht: { value: 0 },
      uAlpha: { value: 1 },
      uFolie: { value: leereFolie },
      uFolieAn: { value: 0 },
    },
  });
}

export function setzeLack(mat: THREE.ShaderMaterial, l: Lackierung): void {
  (mat.uniforms.uLack.value as THREE.Color).setHex(l.farbe);
  (mat.uniforms.uAkzent.value as THREE.Color).setHex(l.akzent);
  mat.uniforms.uGlanz.value = l.glanz;
  mat.uniforms.uMetall.value = l.metallic;
}
