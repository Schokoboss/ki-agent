import * as THREE from 'three';
import type { Fahrzeug } from '../physik/fahrzeug';
import type { Boden, Bodenkontakt } from '../physik/typen';
import { GLSL_UMGEBUNG, weltMaterial } from '../engine/shader';
import type { AutoDaten } from './typen';
import { baueKarosserie, type KarosserieErgebnis } from './karosserie';
import { lackMaterial, setzeLack, type Lackierung } from './lack';

const SCHATTEN_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
let schattenMat: THREE.ShaderMaterial | null = null;
function schattenMaterial(): THREE.ShaderMaterial {
  if (schattenMat) return schattenMat;
  schattenMat = weltMaterial({
    vertex: /* glsl */ `
      varying vec2 vUv; varying vec3 vWelt;
      void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWelt = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragment: /* glsl */ `
      ${GLSL_UMGEBUNG}
      uniform float uStaerke;
      varying vec2 vUv; varying vec3 vWelt;
      void main() {
        vec2 p = abs(vUv - 0.5) * 2.0;
        vec2 q = max(p - vec2(0.62, 0.72), 0.0) / vec2(0.38, 0.28);
        float a = (1.0 - smoothstep(0.0, 1.0, length(q))) * uStaerke;
        float tag = clamp(uSonnenFarbe.r * 0.9 + 0.25, 0.25, 1.0);
        gl_FragColor = vec4(vec3(0.0), a * 0.62 * tag);
      }`,
    uniforms: { uStaerke: { value: 1 } },
    transparent: true,
    depthWrite: false,
  });
  schattenMat.polygonOffset = true;
  schattenMat.polygonOffsetFactor = -2;
  schattenMat.polygonOffsetUnits = -2;
  return schattenMat;
}

const kontakt: Bodenkontakt = { hoehe: 0, nx: 0, ny: 1, nz: 0, untergrund: 0 };
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _oben = new THREE.Vector3();
const X_ACHSE = new THREE.Vector3(1, 0, 0);
const Y_ACHSE = new THREE.Vector3(0, 1, 0);
const Z_ACHSE = new THREE.Vector3(0, 0, 1);

/** Sichtbare Darstellung eines Autos: Karosserie, Räder, Kontaktschatten. */
export class FahrzeugAnsicht {
  readonly gruppe = new THREE.Group();
  readonly koerper: THREE.Mesh;
  readonly raeder: THREE.InstancedMesh;
  readonly schatten: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly bau: KarosserieErgebnis;
  /** Grundpositionen der Karosserie (für Verformung/Reparatur). */
  private readonly grundPos: Float32Array;
  private rollen = 0;
  private nicken = 0;
  schmutz = 0;

  constructor(readonly auto: AutoDaten, lack: Lackierung, fluegelStufe = 0, schwerpunktHoehe = auto.schwerpunkt, bodenfreiheit = auto.bodenfreiheit) {
    this.bau = baueKarosserie(auto, fluegelStufe, schwerpunktHoehe, bodenfreiheit);
    this.material = lackMaterial(lack);
    // eigene Kopie der Geometrie, damit Schäden je Auto gelten
    const geo = this.bau.koerper.clone();
    this.grundPos = new Float32Array(geo.getAttribute('position').array as Float32Array);
    this.koerper = new THREE.Mesh(geo, this.material);
    this.koerper.frustumCulled = false;
    this.raeder = new THREE.InstancedMesh(this.bau.rad, this.material, 4);
    this.raeder.frustumCulled = false;
    this.schatten = new THREE.Mesh(SCHATTEN_GEO, schattenMaterial());
    this.schatten.renderOrder = 2;
    this.schatten.frustumCulled = false;
    this.gruppe.add(this.koerper, this.raeder);
    this.gruppe.frustumCulled = false;
  }

  /** Zur Szene hinzufügen (Schatten liegt außerhalb der Gruppe, weil er am Boden klebt). */
  inSzene(szene: THREE.Object3D): void { szene.add(this.gruppe, this.schatten); }
  ausSzene(szene: THREE.Object3D): void { szene.remove(this.gruppe, this.schatten); }

  setzeLack(l: Lackierung): void { setzeLack(this.material, l); }

  set sichtbar(v: boolean) { this.gruppe.visible = v; this.schatten.visible = v; }
  get sichtbar(): boolean { return this.gruppe.visible; }

  /** Lage aus der Physik übernehmen. alpha interpoliert zwischen letztem und aktuellem Physikschritt. */
  aktualisiere(f: Fahrzeug, alpha: number, boden: Boden, dt: number): void {
    const g = this.gruppe;
    g.position.set(
      f.altPos.x + (f.pos.x - f.altPos.x) * alpha,
      f.altPos.y + (f.pos.y - f.altPos.y) * alpha,
      f.altPos.z + (f.pos.z - f.altPos.z) * alpha,
    );
    _q.set(f.altRot.x, f.altRot.y, f.altRot.z, f.altRot.w);
    _q2.set(f.rot.x, f.rot.y, f.rot.z, f.rot.w);
    g.quaternion.slerpQuaternions(_q, _q2, alpha);

    // Räder
    const w = f.w;
    const r = f.raeder;
    for (let i = 0; i < 4; i++) {
      const R = r[i];
      const links = R.lx > 0;
      const x = links ? this.bau.radX : -this.bau.radX;
      const y = R.ly - (w.federweg - Math.min(R.einfederung, w.federweg));
      _q.setFromAxisAngle(Y_ACHSE, R.lenkwinkel + (links ? 0 : Math.PI));
      _q2.setFromAxisAngle(X_ACHSE, links ? R.drehwinkel : -R.drehwinkel);
      _q.multiply(_q2);
      _m.compose(_v.set(x, y, R.lz), _q, _s);
      this.raeder.setMatrixAt(i, _m);
    }
    this.raeder.instanceMatrix.needsUpdate = true;

    // Sichtbare Karosseriebewegung verstärken (Wanken/Nicken wirkt „schwerer“)
    const rollZiel = ((r[0].einfederung + r[2].einfederung) - (r[1].einfederung + r[3].einfederung)) / (2 * w.spurVorn);
    const nickZiel = ((r[0].einfederung + r[1].einfederung) - (r[2].einfederung + r[3].einfederung)) / (2 * (w.achsVorn + w.achsHinten));
    const k = Math.min(1, dt * 10);
    this.rollen += (rollZiel - this.rollen) * k;
    this.nicken += (nickZiel - this.nicken) * k;
    // links stärker eingefedert → Körper neigt nach links: Drehung um z (vorn) negativ kippt +y nach +x
    this.koerper.rotation.set(this.nicken * 1.2, 0, -this.rollen * 1.6);

    // Kontaktschatten
    const sx = g.position.x, sz = g.position.z;
    boden.abfrage(sx, sz, g.position.y + 0.5, kontakt);
    const hoehe = Math.max(0, g.position.y - w.schwerpunktHoehe - kontakt.hoehe);
    const sch = this.schatten;
    sch.position.set(sx, kontakt.hoehe + 0.035, sz);
    _oben.set(kontakt.nx, kontakt.ny, kontakt.nz);
    const gier = Math.atan2(f.vorn.x, f.vorn.z);
    _q.setFromUnitVectors(Y_ACHSE, _oben);
    _q2.setFromAxisAngle(Y_ACHSE, gier);
    sch.quaternion.copy(_q).multiply(_q2);
    const streu = 1 + hoehe * 0.12;
    sch.scale.set(w.breite * 1.28 * streu, 1, w.laenge * 1.14 * streu);
    const staerke = Math.max(0, 1 - hoehe / 14);
    sch.visible = g.visible && staerke > 0.02;
    (sch.material as THREE.ShaderMaterial).uniforms.uStaerke.value = staerke;
    sch.onBeforeRender = () => { (sch.material as THREE.ShaderMaterial).uniforms.uStaerke.value = staerke; };

    // Licht und Schmutz
    this.material.uniforms.uBremse.value = f.gang >= 0 ? (f.bremse > 0.05 ? 1 : 0) : (f.gas > 0.05 ? 1 : 0);
    this.material.uniforms.uSchmutz.value = this.schmutz;
  }

  /** Verformt die Karosserie um einen lokalen Aufprallpunkt und markiert Kratzer. */
  verforme(lx: number, ly: number, lz: number, rx: number, ry: number, rz: number, staerke: number): void {
    const geo = this.koerper.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const kr = geo.getAttribute('kratzer') as THREE.BufferAttribute;
    const radius = 0.55 + staerke * 0.9;
    const tiefe = Math.min(0.28, staerke * 0.22);
    const a = pos.array as Float32Array, kArr = kr.array as Float32Array;
    for (let i = 0; i < pos.count; i++) {
      const dx = a[i * 3] - lx, dy = a[i * 3 + 1] - ly, dz = a[i * 3 + 2] - lz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > radius * radius) continue;
      const fall = 1 - Math.sqrt(d2) / radius;
      const zufall = 0.6 + 0.4 * Math.sin(i * 12.9898 + a[i * 3 + 2] * 7.1);
      // nicht weiter als 0.35 m von der Grundform entfernen
      const nx = a[i * 3] + rx * tiefe * fall * zufall, ny = a[i * 3 + 1] + ry * tiefe * fall * zufall, nz = a[i * 3 + 2] + rz * tiefe * fall * zufall;
      const gx = nx - this.grundPos[i * 3], gy = ny - this.grundPos[i * 3 + 1], gz = nz - this.grundPos[i * 3 + 2];
      if (gx * gx + gy * gy + gz * gz < 0.35 * 0.35) { a[i * 3] = nx; a[i * 3 + 1] = ny; a[i * 3 + 2] = nz; }
      kArr[i] = Math.min(1, kArr[i] + fall * (0.35 + staerke * 0.6));
    }
    pos.needsUpdate = true;
    kr.needsUpdate = true;
  }

  /** Stellt die unbeschädigte Form wieder her. */
  repariere(): void {
    const geo = this.koerper.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    (pos.array as Float32Array).set(this.grundPos);
    pos.needsUpdate = true;
    const kr = geo.getAttribute('kratzer') as THREE.BufferAttribute;
    (kr.array as Float32Array).fill(0);
    kr.needsUpdate = true;
  }

  entsorge(): void {
    this.koerper.geometry.dispose();
    this.material.dispose();
    this.raeder.dispose();
  }
}

void Z_ACHSE;
