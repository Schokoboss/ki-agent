// Geometrie-Helfer: Teile mit Farbe zusammenfügen (ein Draw-Call statt vieler).
import * as THREE from '../lib/three.module.min.js';

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3(), P = new THREE.Vector3();

export function part(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  M.compose(P.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S.set(sx, sy, sz));
  g.applyMatrix4(M);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

export function merge(parts) {
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of parts) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    if (!g.attributes.normal) g.computeVertexNormals();
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    uv.set(g.attributes.uv.array.subarray(0, c * 2), o * 2);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

// Wachsende Puffer für große, selbst gebaute Meshes (Gelände, Straßen, Häuser)
export class Builder {
  constructor() { this.p = []; this.n = []; this.c = []; this.u = []; this.i = []; this.groups = []; }
  get count() { return this.p.length / 3; }
  v(x, y, z, nx, ny, nz, r, g, b, u, w) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(r, g, b); this.u.push(u, w);
    return this.p.length / 3 - 1;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  // Rechteck aus 4 Eckpunkten (gegen den Uhrzeigersinn von außen gesehen)
  face(p0, p1, p2, p3, col, uvs) {
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const u = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
    const a = this.v(...p0, nx, ny, nz, col.r, col.g, col.b, ...u[0]);
    const b = this.v(...p1, nx, ny, nz, col.r, col.g, col.b, ...u[1]);
    const c = this.v(...p2, nx, ny, nz, col.r, col.g, col.b, ...u[2]);
    const d = this.v(...p3, nx, ny, nz, col.r, col.g, col.b, ...u[3]);
    this.quad(a, b, c, d);
  }
  group(materialIndex) {
    const start = this.groups.length ? this.groups[this.groups.length - 1].end : 0;
    if (this.groups.length) this.groups[this.groups.length - 1].end = this.i.length;
    this.groups.push({ start: this.i.length, end: this.i.length, materialIndex });
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    if (this.groups.length) {
      this.groups[this.groups.length - 1].end = this.i.length;
      for (const gr of this.groups) if (gr.end > gr.start) g.addGroup(gr.start, gr.end - gr.start, gr.materialIndex);
    }
    g.computeBoundingSphere();
    return g;
  }
}
