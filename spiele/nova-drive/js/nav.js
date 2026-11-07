// Navigation: Straßengraph mit automatisch erkannten Kreuzungen, kürzeste Route (Dijkstra),
// Abbiege-Hinweise, Sprachansagen und eine leuchtende Pfeil-Spur auf der Straße.
import * as THREE from '../lib/three.module.min.js';
import { clamp } from './util.js';

const P = {};

export class RoadGraph {
  constructor(world) {
    this.world = world;
    this.roads = world.roads;
    this.build();
  }

  build() {
    const R = this.roads;
    this.nodes = [];
    this.on = R.map(() => []); // je Straße: [{s, node}]
    const addNode = (x, z) => { this.nodes.push({ x, z, id: this.nodes.length }); return this.nodes.length - 1; };
    // grobe Polylinien
    const poly = R.map(r => {
      const p = r.path, step = Math.max(1, Math.round(5 / p.ds)), out = [];
      for (let i = 0; i < p.n; i += step) out.push([p.x[i], p.z[i], i * p.ds]);
      if (p.closed) out.push([p.x[0], p.z[0], p.length]);
      else out.push([p.x[p.n - 1], p.z[p.n - 1], p.length]);
      return out;
    });
    // Kreuzungen zwischen zwei Straßen
    for (let a = 0; a < R.length; a++) for (let b = a + 1; b < R.length; b++) {
      const A = poly[a], Bp = poly[b];
      for (let i = 0; i < A.length - 1; i++) {
        const [ax, az, as] = A[i], [bx, bz, bs] = A[i + 1];
        const minx = Math.min(ax, bx) - 1, maxx = Math.max(ax, bx) + 1, minz = Math.min(az, bz) - 1, maxz = Math.max(az, bz) + 1;
        for (let j = 0; j < Bp.length - 1; j++) {
          const [cx, cz, cs] = Bp[j], [dx, dz, dsb] = Bp[j + 1];
          if (Math.max(cx, dx) < minx || Math.min(cx, dx) > maxx || Math.max(cz, dz) < minz || Math.min(cz, dz) > maxz) continue;
          const r = segX(ax, az, bx, bz, cx, cz, dx, dz);
          if (!r) continue;
          const sa = as + (bs - as) * r[0], sb = cs + (dsb - cs) * r[1];
          const x = ax + (bx - ax) * r[0], z = az + (bz - az) * r[0];
          if (this.on[a].some(e => Math.abs(e.s - sa) < 10) && this.on[b].some(e => Math.abs(e.s - sb) < 10)) continue;
          const n = addNode(x, z);
          this.on[a].push({ s: sa, node: n }); this.on[b].push({ s: sb, node: n });
        }
      }
    }
    // Enden offener Straßen: an nahe Straßen anschließen
    R.forEach((r, i) => {
      if (r.path.closed) return;
      for (const s of [0, r.path.length]) {
        const p = r.path.at(Math.min(s, r.path.length - 0.01), P);
        let best = null;
        R.forEach((o, j) => {
          if (j === i) return;
          const c = o.path.closest(p.x, p.z);
          if (c.dist < 22 && (!best || c.dist < best.c.dist)) best = { j, c };
        });
        const near = this.on[i].find(e => Math.abs(e.s - s) < 12);
        if (near) continue;
        let n;
        if (best) {
          const ex = this.on[best.j].find(e => Math.abs(e.s - best.c.s) < 12);
          n = ex ? ex.node : addNode(p.x, p.z);
          if (!ex) this.on[best.j].push({ s: best.c.s, node: n });
        } else n = addNode(p.x, p.z);
        this.on[i].push({ s, node: n });
      }
    });
    // Straßen ohne Anschluss (z. B. Waldpiste): Feldweg zur nächstgelegenen Straße
    const links = [];
    R.forEach((r, i) => {
      if (this.on[i].length) return;
      let best = null;
      for (const [x, z, s] of poly[i]) R.forEach((o, j) => {
        if (j === i) return;
        const c = o.path.closest(x, z);
        if (!best || c.dist < best.d) best = { d: c.dist, s, j, sj: c.s, x, z };
      });
      if (!best) return;
      const a = addNode(best.x, best.z), pj = R[best.j].path.at(best.sj, P);
      const ex = this.on[best.j].find(e => Math.abs(e.s - best.sj) < 12);
      const b = ex ? ex.node : addNode(pj.x, pj.z);
      this.on[i].push({ s: best.s, node: a });
      if (!ex) this.on[best.j].push({ s: best.sj, node: b });
      links.push({ a, b, len: best.d });
    });
    // Kanten entlang jeder Straße
    this.adj = this.nodes.map(() => []);
    for (const l of links) {
      const e = { road: -1, a: l.a, b: l.b, len: l.len * 1.15 };
      this.adj[l.a].push({ to: l.b, e, fwd: true }); this.adj[l.b].push({ to: l.a, e, fwd: false });
    }
    R.forEach((r, i) => {
      const list = this.on[i].sort((u, v) => u.s - v.s);
      const L = r.path.length;
      for (let k = 0; k < list.length - 1; k++) this.edge(i, list[k], list[k + 1], list[k + 1].s - list[k].s, false);
      if (r.path.closed && list.length > 1) this.edge(i, list[list.length - 1], list[0], L - list[list.length - 1].s + list[0].s, true);
    });
  }
  edge(road, A, B, len, wrap) {
    if (A.node === B.node || len < 0.5) return;
    const e = { road, sa: A.s, sb: B.s, len, wrap, a: A.node, b: B.node };
    this.adj[A.node].push({ to: B.node, e, fwd: true });
    this.adj[B.node].push({ to: A.node, e, fwd: false });
  }

  // nächster Straßenpunkt
  snap(x, z) {
    let best = null;
    this.roads.forEach((r, i) => {
      const c = r.path.closest(x, z);
      if (!best || c.dist < best.dist) best = { road: i, s: c.s, dist: c.dist };
    });
    return best;
  }

  // Route von (x,z) nach (tx,tz) über Straßen
  route(x, z, tx, tz) {
    const S = this.snap(x, z), D = this.snap(tx, tz);
    if (!S || !D) return null;
    const n = this.nodes.length, sN = n, dN = n + 1;
    const extra = [[], []];
    const temp = (snap, id, k) => {
      const list = this.on[snap.road].slice().sort((u, v) => u.s - v.s), r = this.roads[snap.road], L = r.path.length;
      if (!list.length) return;
      let prev = null, next = null;
      for (const e of list) { if (e.s <= snap.s) prev = e; else if (!next) next = e; }
      if (r.path.closed) { if (!prev) prev = list[list.length - 1]; if (!next) next = list[0]; }
      const me = { s: snap.s, node: id };
      if (prev) extra[k].push({ prevSide: true, e: mk(snap.road, prev, me, r.path.closed && prev.s > snap.s ? L - prev.s + snap.s : snap.s - prev.s, r.path.closed && prev.s > snap.s) });
      if (next) extra[k].push({ prevSide: false, e: mk(snap.road, me, next, r.path.closed && next.s < snap.s ? L - snap.s + next.s : next.s - snap.s, r.path.closed && next.s < snap.s) });
    };
    const mk = (road, A, B, len, wrap) => ({ road, sa: A.s, sb: B.s, len, wrap, a: A.node, b: B.node });
    temp(S, sN, 0); temp(D, dN, 1);
    const neigh = id => {
      const out = id < n ? [...this.adj[id]] : [];
      for (const k of [0, 1]) for (const x of extra[k]) {
        if (x.e.a === id) out.push({ to: x.e.b, e: x.e, fwd: true });
        if (x.e.b === id) out.push({ to: x.e.a, e: x.e, fwd: false });
      }
      return out;
    };
    // gleiche Straße: direkte Verbindung
    const direct = [];
    if (S.road === D.road) {
      const r = this.roads[S.road], L = r.path.length;
      if (r.path.closed) {
        const f = ((D.s - S.s) % L + L) % L, b = L - f;
        direct.push({ to: dN, e: mk(S.road, { s: S.s, node: sN }, { s: D.s, node: dN }, f <= b ? f : b, false), fwd: true, forceDir: f <= b ? 1 : -1 });
      } else direct.push({ to: dN, e: mk(S.road, { s: S.s, node: sN }, { s: D.s, node: dN }, Math.abs(D.s - S.s), false), fwd: true, forceDir: Math.sign(D.s - S.s) || 1 });
    }
    // Dijkstra
    const dist = new Float64Array(n + 2).fill(Infinity), via = new Array(n + 2).fill(null), done = new Uint8Array(n + 2);
    dist[sN] = 0;
    for (;;) {
      let u = -1, bd = Infinity;
      for (let i = 0; i < n + 2; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; u = i; }
      if (u < 0 || u === dN) break;
      done[u] = 1;
      const list = u === sN ? [...neigh(u), ...direct] : neigh(u);
      for (const w of list) {
        const nd = dist[u] + w.e.len;
        if (nd < dist[w.to]) { dist[w.to] = nd; via[w.to] = { from: u, w }; }
      }
    }
    if (!isFinite(dist[dN])) return null;
    // Wegstücke zurückverfolgen
    const legs = [];
    for (let v = dN; v !== sN; v = via[v].from) legs.unshift(via[v].w);
    const pts = [];
    const push = (x, z) => { const l = pts[pts.length - 1]; if (!l || Math.hypot(l.x - x, l.z - z) > 1) pts.push({ x, z }); };
    const nodeIdx = [];
    for (const w of legs) {
      const e = w.e;
      if (e.road === -1) { // Feldweg: gerade Linie
        const A = this.nodes[w.fwd ? e.a : e.b], Bn = this.nodes[w.fwd ? e.b : e.a];
        const k = Math.max(2, Math.ceil(e.len / 4));
        for (let q = 0; q <= k; q++) push(A.x + (Bn.x - A.x) * q / k, A.z + (Bn.z - A.z) * q / k);
        nodeIdx.push({ i: pts.length - 1, road: -1 });
        continue;
      }
      const r = this.roads[e.road], L = r.path.length;
      let s0 = w.fwd ? e.sa : e.sb, s1 = w.fwd ? e.sb : e.sa;
      let dir = w.forceDir || (w.fwd ? 1 : -1);
      const len = e.len;
      if (w.forceDir) { s0 = e.sa; s1 = e.sb; }
      const steps = Math.max(2, Math.ceil(len / 4));
      for (let k = 0; k <= steps; k++) {
        const s = r.path.wrapS(s0 + dir * len * k / steps);
        const p = r.path.at(s, P);
        push(p.x, p.z);
      }
      nodeIdx.push({ i: pts.length - 1, road: e.road });
    }
    // Ziel abseits der Straße: gerade Linie dazu
    if (D.dist > 8) push(tx, tz);
    // Abstände + Abbiegehinweise
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const steps = [];
    for (let k = 0; k < nodeIdx.length - 1; k++) {
      const i = nodeIdx[k].i;
      const a = back(pts, i, 14), b = fwdPt(pts, i, 14);
      if (!a || !b) continue;
      const h1 = Math.atan2(pts[i].x - a.x, pts[i].z - a.z), h2 = Math.atan2(b.x - pts[i].x, b.z - pts[i].z);
      let d = h2 - h1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      const change = nodeIdx[k].road !== nodeIdx[k + 1].road;
      if (Math.abs(d) < 0.45 && !change) continue;
      // yaw nimmt nach links zu → negative Änderung = rechts
      const turn = Math.abs(d) < 0.45 ? 'gerade' : d < 0 ? 'rechts' : 'links';
      const nr = nodeIdx[k + 1].road;
      steps.push({ at: cum[i], turn, road: nr === -1 ? 'Feldweg' : this.roads[nr].def.name, sharp: Math.abs(d) > 1.6 });
    }
    steps.push({ at: cum[cum.length - 1], turn: 'ziel', road: '' });
    return { pts, cum, length: cum[cum.length - 1], steps };
  }
}

function segX(ax, az, bx, bz, cx, cz, dx, dz) {
  const r1x = bx - ax, r1z = bz - az, r2x = dx - cx, r2z = dz - cz;
  const den = r1x * r2z - r1z * r2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * r2z - (cz - az) * r2x) / den, u = ((cx - ax) * r1z - (cz - az) * r1x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null;
}
function back(pts, i, d) { let acc = 0; for (let k = i; k > 0; k--) { acc += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z); if (acc >= d) return pts[k - 1]; } return pts[0] !== pts[i] ? pts[0] : null; }
function fwdPt(pts, i, d) { let acc = 0; for (let k = i; k < pts.length - 1; k++) { acc += Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].z - pts[k].z); if (acc >= d) return pts[k + 1]; } return pts[pts.length - 1] !== pts[i] ? pts[pts.length - 1] : null; }

// ---------------------------------------------------------------- leuchtende Pfeil-Spur auf der Straße
export class NavRibbon {
  constructor(scene, world) {
    this.world = world;
    this.max = 180;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.max * 2 * 3);
    this.uv = new Float32Array(this.max * 2 * 2);
    const idx = [];
    for (let i = 0; i < this.max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 }, col: { value: new THREE.Color(0x1fe0ff) }, op: { value: 0.85 }, len: { value: 300 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -60,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float t, op, len; uniform vec3 col; varying vec2 vUv;
        void main(){
          float v = fract(vUv.y * 0.25 - t * 0.9);
          float x = abs(vUv.x - 0.5) * 2.0;
          float chev = smoothstep(0.1, 0.0, abs(v - (0.55 - x * 0.28)) - 0.06);
          float edge = smoothstep(1.0, 0.85, x);
          float fade = smoothstep(2.0, 9.0, vUv.y) * smoothstep(len, len * 0.7, vUv.y);
          gl_FragColor = vec4(col * (chev * 0.9 + 0.12) * edge * fade * op, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 26;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  // pts: [{x,z}] ab dem Auto nach vorn
  set(pts, color) {
    if (!pts || pts.length < 2) { this.mesh.visible = false; return; }
    if (color !== undefined) this.mat.uniforms.col.value.set(color);
    const W = this.world, n = Math.min(this.max, pts.length), w = 1.15;
    let acc = 0;
    for (let i = 0; i < this.max; i++) {
      const k = Math.min(i, n - 1);
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)], p = pts[k];
      let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      if (i > 0 && i < n) acc += Math.hypot(p.x - pts[k - 1].x, p.z - pts[k - 1].z);
      const y = W.heightAt(p.x, p.z) + 0.14;
      const nx = -tz * w, nz = tx * w;
      this.pos.set([p.x - nx, y, p.z - nz, p.x + nx, y, p.z + nz], i * 6);
      this.uv.set([0, acc, 1, acc], i * 4);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    this.mat.uniforms.len.value = Math.max(10, acc);
    this.mesh.visible = true;
  }
  hide() { this.mesh.visible = false; }
  tick(t, op) { this.mat.uniforms.t.value = t; this.mat.uniforms.op.value = op; }
}

// Sprachansagen (deutsch), wenn der Browser das kann
export function say(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE'; u.rate = 1.05;
    const v = speechSynthesis.getVoices().find(v => v.lang && v.lang.startsWith('de'));
    if (v) u.voice = v;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* egal */ }
}
export function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(1).replace('.', ',') + ' km' : (Math.round(m / 10) * 10) + ' m'; }
export const TURN_ICON = { links: '↰', rechts: '↱', gerade: '↑', ziel: '⚑' };
export function turnText(st) {
  if (st.turn === 'ziel') return 'Ziel erreicht';
  if (st.turn === 'gerade') return `Weiter auf ${st.road}`;
  return `${st.sharp ? 'Scharf ' + st.turn : (st.turn === 'links' ? 'Links' : 'Rechts')} abbiegen${st.road ? ' – ' + st.road : ''}`;
}
export function clampN(v, a, b) { return clamp(v, a, b); }
