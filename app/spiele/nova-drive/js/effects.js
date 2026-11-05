// Partikel (Rauch, Staub, Funken, Nitro, Konfetti, Feuerwerk) und Bremsspuren.
import * as THREE from '../lib/three.module.min.js';
import { makePointMaterial } from './world.js';

export class Particles {
  constructor(scene, map, max, additive) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.c = new Float32Array(max * 3); this.size = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max); this.grow = new Float32Array(max);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max); this.s0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.posA = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.colA = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeA = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posA); g.setAttribute('color', this.colA); g.setAttribute('size', this.sizeA);
    this.mat = makePointMaterial(map, additive);
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 30;
    scene.add(this.points);
    this.cursor = 0;
  }
  emit(x, y, z, vx, vy, vz, r, g, b, size, life, opts = {}) {
    let i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.c[i * 3] = r; this.c[i * 3 + 1] = g; this.c[i * 3 + 2] = b;
    this.s0[i] = size; this.life[i] = life; this.maxLife[i] = life;
    this.grow[i] = opts.grow ?? 1.5; this.drag[i] = opts.drag ?? 1.5; this.grav[i] = opts.grav ?? 0;
  }
  update(dt, scale) {
    this.mat.uniforms.scale.value = scale;
    const P = this.posA.array, C = this.colA.array, S = this.sizeA.array;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { S[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= k; this.v[i * 3 + 1] = this.v[i * 3 + 1] * k - this.grav[i] * dt; this.v[i * 3 + 2] *= k;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      P[i * 3] = this.p[i * 3]; P[i * 3 + 1] = this.p[i * 3 + 1]; P[i * 3 + 2] = this.p[i * 3 + 2];
      C[i * 3] = this.c[i * 3] * fade; C[i * 3 + 1] = this.c[i * 3 + 1] * fade; C[i * 3 + 2] = this.c[i * 3 + 2] * fade;
      S[i] = this.s0[i] * (1 + t * this.grow[i]) * (this.mat.blending === THREE.AdditiveBlending ? 1 : Math.max(0.05, fade));
    }
    this.posA.needsUpdate = this.colA.needsUpdate = this.sizeA.needsUpdate = true;
  }
}

// Rauch braucht Alpha statt Helligkeit → eigenes Material mit Alpha aus der Farbe
export class Smoke extends Particles {
  constructor(scene, map, max) {
    super(scene, map, max, false);
    this.mat.fragmentShader = `uniform sampler2D map; uniform float opacity; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); float a = t.a * opacity * vC.r; gl_FragColor = vec4(vec3(vC.g, vC.g, vC.b), a); if (a < 0.01) discard; }`;
    this.mat.needsUpdate = true;
    this.base = new Float32Array(max * 3);
  }
  // r = Deckkraft, g = Helligkeit, b = Blau-Anteil (Staub bräunlich über b < g)
  update(dt, scale) {
    this.mat.uniforms.scale.value = scale;
    const P = this.posA.array, C = this.colA.array, S = this.sizeA.array;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { S[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= k; this.v[i * 3 + 1] = this.v[i * 3 + 1] * k - this.grav[i] * dt; this.v[i * 3 + 2] *= k;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      P[i * 3] = this.p[i * 3]; P[i * 3 + 1] = this.p[i * 3 + 1]; P[i * 3 + 2] = this.p[i * 3 + 2];
      C[i * 3] = this.c[i * 3] * (1 - t) * Math.min(1, t * 8); C[i * 3 + 1] = this.c[i * 3 + 1]; C[i * 3 + 2] = this.c[i * 3 + 2];
      S[i] = this.s0[i] * (1 + t * this.grow[i]);
    }
    this.posA.needsUpdate = this.colA.needsUpdate = this.sizeA.needsUpdate = true;
  }
}

export class Skids {
  constructor(scene, max = 1600) {
    this.max = max; this.i = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 4 * 3);
    this.alpha = new Float32Array(max * 4);
    const idx = new Uint32Array(max * 6);
    for (let q = 0; q < max; q++) { const a = q * 4; idx.set([a, a + 1, a + 2, a, a + 2, a + 3], q * 6); }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = g;
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -40,
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.05,0.05,0.05, vA*0.5); }`,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 25;
    scene.add(this.mesh);
    this.last = [null, null, null, null];
  }
  // k = Rad-Index, a/b = Punkte (Vector3), w = Breite, strength 0…1
  add(k, p, dirx, dirz, strength) {
    const prev = this.last[k];
    if (!prev || strength <= 0) { this.last[k] = strength > 0 ? p.clone() : null; return; }
    if (prev.distanceToSquared(p) < 0.35) return;
    const w = 0.14, nx = -dirz * w, nz = dirx * w;
    const q = this.i; this.i = (this.i + 1) % this.max;
    const P = this.pos, o = q * 12;
    P[o] = prev.x - nx; P[o + 1] = prev.y + 0.03; P[o + 2] = prev.z - nz;
    P[o + 3] = prev.x + nx; P[o + 4] = prev.y + 0.03; P[o + 5] = prev.z + nz;
    P[o + 6] = p.x + nx; P[o + 7] = p.y + 0.03; P[o + 8] = p.z + nz;
    P[o + 9] = p.x - nx; P[o + 10] = p.y + 0.03; P[o + 11] = p.z - nz;
    this.alpha.fill(Math.min(1, strength), q * 4, q * 4 + 4);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    prev.copy(p);
  }
  cut() { this.last = [null, null, null, null]; }
}
