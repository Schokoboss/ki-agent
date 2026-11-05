// Prozedurale Automodelle (eigene Designs). Vorne = +z.
import * as THREE from '../lib/three.module.min.js';
import { part, merge } from './geo.js';

// Grundform je Stil: L Länge, W Breite, clr Bodenfreiheit, belt Gürtellinie, nose/tail Höhe vorne/hinten,
// hood/ws/roof/rear horizontale Längen (Motorhaube, Frontscheibe, Dach, Heckscheibe), H Dachhöhe, wR Radius, wb Radstand
const STYLES = {
  hatch: { L: 4.1, W: 1.8, clr: 0.3, belt: 0.98, nose: 0.78, tail: 0.96, hood: 1.25, ws: 0.72, roof: 1.45, rear: 0.38, H: 1.5, wR: 0.33, wb: 2.55 },
  rally: { L: 4.25, W: 1.88, clr: 0.4, belt: 1.05, nose: 0.86, tail: 1.0, hood: 1.3, ws: 0.72, roof: 1.45, rear: 0.42, H: 1.62, wR: 0.37, wb: 2.6 },
  roadster: { L: 4.05, W: 1.82, clr: 0.27, belt: 0.86, nose: 0.66, tail: 0.86, hood: 1.65, ws: 0.38, roof: 0, rear: 0, H: 1.18, wR: 0.33, wb: 2.5 },
  muscle: { L: 4.85, W: 1.96, clr: 0.3, belt: 1.0, nose: 0.92, tail: 0.96, hood: 1.95, ws: 0.72, roof: 0.95, rear: 1.05, H: 1.38, wR: 0.37, wb: 2.85 },
  truck: { L: 4.9, W: 2.02, clr: 0.55, belt: 1.38, nose: 1.28, tail: 1.32, hood: 1.15, ws: 0.5, roof: 1.25, rear: 0.12, H: 2.08, wR: 0.47, wb: 3.0 },
  gt: { L: 4.6, W: 1.96, clr: 0.26, belt: 0.9, nose: 0.66, tail: 0.92, hood: 1.65, ws: 0.85, roof: 0.7, rear: 1.15, H: 1.25, wR: 0.36, wb: 2.7 },
  ev: { L: 4.7, W: 2.0, clr: 0.27, belt: 0.92, nose: 0.68, tail: 0.94, hood: 1.35, ws: 1.1, roof: 0.95, rear: 1.0, H: 1.3, wR: 0.36, wb: 2.8 },
  hyper: { L: 4.72, W: 2.06, clr: 0.22, belt: 0.82, nose: 0.52, tail: 0.98, hood: 1.15, ws: 1.0, roof: 0.62, rear: 1.45, H: 1.12, wR: 0.36, wb: 2.75 },
};

function extrude(pts, width, bevel = 0.06) {
  const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, width - bevel * 2), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 3 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

let envCache = null;
const sharedMats = {};
function mats() {
  if (sharedMats.glass) return sharedMats;
  sharedMats.glass = new THREE.MeshStandardMaterial({ color: 0x0d1620, metalness: 0.6, roughness: 0.08 });
  sharedMats.detail = new THREE.MeshLambertMaterial({ vertexColors: true });
  sharedMats.wheel = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.45 });
  sharedMats.head = new THREE.MeshBasicMaterial({ color: 0xfff4d6 });
  sharedMats.lod = new THREE.MeshLambertMaterial({ vertexColors: true });
  return sharedMats;
}

export function styleDims(style) { return STYLES[style] || STYLES.hatch; }

// spec: Eintrag aus CARS (style), color: Lackfarbe, opts.lod: alles in ein Mesh (Verkehr)
export function buildCar(spec, color, opts = {}) {
  const S = STYLES[spec.style] || STYLES.hatch;
  const st = spec.style;
  const { L, W, clr, belt, nose, tail, hood, ws, roof, rear, H, wR, wb } = S;
  const M = mats();
  const zWs = L / 2 - hood, zRoofF = zWs - ws, zRoofR = zRoofF - roof;
  const zRear = Math.max(-L / 2 + 0.12, zRoofR - rear);
  // Karosserie (Seitenprofil)
  const body = [
    [-L / 2 + 0.06, clr + 0.08], [L / 2 - 0.12, clr], [L / 2, clr + (nose - clr) * 0.45], [L / 2 - 0.1, nose],
    [zWs, belt], [zRear, belt + 0.02], [-L / 2 + 0.04, tail], [-L / 2, clr + (tail - clr) * 0.5],
  ];
  const paint = [part(extrude(body, W), '#ffffff')];
  const detail = [], glass = [], tail_ = [], head = [];
  const dark = '#121216', trim = '#2a2a30', chrome = '#c8ccd2';
  // Kabine
  if (roof > 0) {
    const gh = [[zRear + 0.02, belt - 0.03], [zWs, belt - 0.03], [zRoofF, H], [zRoofR, H]];
    glass.push(part(extrude(gh, W * 0.84, 0.04), '#ffffff'));
    paint.push(part(new THREE.BoxGeometry(W * 0.8, 0.06, Math.max(0.2, roof + 0.12)), '#ffffff', 0, H + 0.01, (zRoofF + zRoofR) / 2));
    // A-/C-Säulen andeuten
    for (const sx of [-1, 1]) {
      const len = Math.hypot(zWs - zRoofF, H - belt), a = Math.atan2(H - belt, zWs - zRoofF);
      paint.push(part(new THREE.BoxGeometry(0.07, 0.07, len), '#ffffff', sx * W * 0.405, (H + belt) / 2, (zWs + zRoofF) / 2, a, 0, 0));
    }
  } else {
    // Cabrio: Frontscheibe, Sitze, Überrollbügel
    glass.push(part(new THREE.BoxGeometry(W * 0.84, 0.36, 0.05), '#ffffff', 0, belt + 0.2, zWs - 0.12, -0.55, 0, 0));
    detail.push(part(new THREE.BoxGeometry(W * 0.78, 0.18, 1.3), '#2b1f1a', 0, belt - 0.02, zWs - 0.85));
    for (const sx of [-0.42, 0.42]) {
      detail.push(part(new THREE.BoxGeometry(0.5, 0.55, 0.14), '#3a2520', sx, belt + 0.2, zWs - 1.35, 0.15, 0, 0));
      detail.push(part(new THREE.TorusGeometry(0.24, 0.035, 5, 10, Math.PI), chrome, sx, belt + 0.08, zWs - 1.55));
    }
  }
  // Grill, Schweller, Diffusor
  detail.push(part(new THREE.BoxGeometry(W * 0.5, 0.16, 0.06), dark, 0, clr + (nose - clr) * 0.45, L / 2 - 0.02));
  detail.push(part(new THREE.BoxGeometry(W * 1.0, 0.12, L * 0.62), trim, 0, clr + 0.07, 0));
  detail.push(part(new THREE.BoxGeometry(W * 0.7, 0.12, 0.08), dark, 0, clr + 0.1, -L / 2 + 0.03));
  // Spiegel
  if (roof > 0) for (const sx of [-1, 1]) paint.push(part(new THREE.BoxGeometry(0.18, 0.1, 0.14), '#ffffff', sx * (W / 2 + 0.06), belt + 0.08, zWs - 0.12));
  // Lichter
  const hy = nose - 0.11, ty = tail - 0.12;
  if (st === 'ev' || st === 'hyper') {
    head.push(part(new THREE.BoxGeometry(W * 0.86, 0.05, 0.05), '#ffffff', 0, hy + 0.02, L / 2 - 0.1));
    tail_.push(part(new THREE.BoxGeometry(W * 0.92, 0.07, 0.05), '#ffffff', 0, ty, -L / 2 + 0.03));
  } else {
    for (const sx of [-1, 1]) {
      head.push(part(new THREE.BoxGeometry(0.38, 0.12, 0.06), '#ffffff', sx * (W / 2 - 0.3), hy, L / 2 - 0.1));
      tail_.push(part(new THREE.BoxGeometry(0.42, 0.13, 0.05), '#ffffff', sx * (W / 2 - 0.3), ty, -L / 2 + 0.03));
    }
  }
  // Auspuff
  const exh = [];
  const exN = st === 'gt' || st === 'muscle' ? 2 : 1;
  for (let i = 0; i < exN; i++) {
    const ex = exN === 2 ? (i ? 0.45 : -0.45) : 0.5;
    detail.push(part(new THREE.CylinderGeometry(0.06, 0.06, 0.25, 8), chrome, ex, clr + 0.08, -L / 2 - 0.02, Math.PI / 2, 0, 0));
    exh.push(new THREE.Vector3(ex, clr + 0.08, -L / 2 - 0.15));
  }
  // Stil-Extras
  if (st === 'rally') {
    paint.push(part(new THREE.BoxGeometry(W * 0.95, 0.06, 0.32), '#ffffff', 0, tail + 0.32, -L / 2 + 0.2));
    for (const sx of [-0.7, 0.7]) detail.push(part(new THREE.BoxGeometry(0.06, 0.3, 0.06), dark, sx, tail + 0.16, -L / 2 + 0.22));
    detail.push(part(new THREE.BoxGeometry(0.45, 0.12, 0.4), dark, 0, H + 0.08, (zRoofF + zRoofR) / 2 + 0.2));
    for (const sx of [-0.45, -0.15, 0.15, 0.45]) head.push(part(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10), '#ffffff', sx, nose + 0.05, L / 2 - 0.25, Math.PI / 2, 0, 0));
    for (const sx of [-1, 1]) detail.push(part(new THREE.BoxGeometry(0.3, 0.32, 0.03), dark, sx * (W / 2 - 0.25), clr + 0.05, -S.wb / 2 - wR - 0.15));
    detail.push(part(new THREE.BoxGeometry(W * 0.84, 0.03, 0.4), '#e8e8e8', 0, belt + 0.005, zWs + 0.35));
  }
  if (st === 'muscle') {
    detail.push(part(new THREE.BoxGeometry(0.55, 0.14, 0.75), dark, 0, belt - 0.05 + 0.07, zWs + 0.7, -0.08, 0, 0));
    for (const sx of [-0.2, 0.2]) {
      detail.push(part(new THREE.BoxGeometry(0.16, 0.012, hood + 0.1), '#f4f4f4', sx, nose + (belt - nose) * 0.5 + 0.035, L / 2 - hood / 2, Math.atan2(belt - nose, hood) * 0.95, 0, 0));
      detail.push(part(new THREE.BoxGeometry(0.16, 0.012, roof + 0.1), '#f4f4f4', sx, H + 0.045, (zRoofF + zRoofR) / 2));
    }
    paint.push(part(new THREE.BoxGeometry(W * 0.9, 0.05, 0.18), '#ffffff', 0, tail + 0.04, -L / 2 + 0.12, -0.25, 0, 0));
  }
  if (st === 'truck') {
    detail.push(part(new THREE.BoxGeometry(W * 0.86, 0.06, L / 2 + zRear - 0.1), '#1d1d22', 0, belt + 0.02, (-L / 2 + zRear) / 2));
    detail.push(part(new THREE.BoxGeometry(W * 0.86, 0.06, 0.06), dark, 0, H + 0.2, (zRoofF + zRoofR) / 2 + 0.2));
    for (const sx of [-0.6, -0.2, 0.2, 0.6]) head.push(part(new THREE.BoxGeometry(0.22, 0.12, 0.08), '#ffffff', sx, H + 0.2, (zRoofF + zRoofR) / 2 + 0.25));
    for (const sx of [-1, 1]) detail.push(part(new THREE.BoxGeometry(0.06, 0.4, 0.06), dark, sx * W * 0.38, H + 0.02, (zRoofF + zRoofR) / 2 + 0.2));
    detail.push(part(new THREE.BoxGeometry(W * 0.8, 0.08, 0.08), '#2e2e34', 0, clr + 0.35, L / 2 + 0.12));
    detail.push(part(new THREE.BoxGeometry(W * 0.8, 0.08, 0.08), '#2e2e34', 0, clr + 0.7, L / 2 + 0.12));
    for (const sx of [-1, 1]) detail.push(part(new THREE.BoxGeometry(0.08, 0.45, 0.08), '#2e2e34', sx * W * 0.38, clr + 0.52, L / 2 + 0.12));
    detail.push(part(new THREE.BoxGeometry(W * 0.9, 0.05, 1.4), dark, 0, belt + 0.04 + 0.3, zRear - 0.1 - 0.9, 0, 0, 0));
    for (const sx of [-1, 1]) detail.push(part(new THREE.BoxGeometry(0.07, 0.36, 0.07), dark, sx * W * 0.42, belt + 0.2, zRear - 0.4));
  }
  if (st === 'gt') {
    paint.push(part(new THREE.BoxGeometry(W * 0.85, 0.04, 0.22), '#ffffff', 0, tail + 0.05, -L / 2 + 0.1, -0.3, 0, 0));
    for (const sx of [-1, 1]) detail.push(part(new THREE.BoxGeometry(0.02, 0.16, 0.6), dark, sx * (W / 2 + 0.005), belt - 0.25, zWs - 0.2));
  }
  if (st === 'hyper') {
    paint.push(part(new THREE.BoxGeometry(W * 0.98, 0.06, 0.42), '#ffffff', 0, tail + 0.42, -L / 2 + 0.25, 0.08, 0, 0));
    for (const sx of [-0.55, 0.55]) detail.push(part(new THREE.BoxGeometry(0.06, 0.42, 0.22), dark, sx, tail + 0.2, -L / 2 + 0.3));
    for (const sx of [-1, 1]) detail.push(part(new THREE.BoxGeometry(0.03, 0.3, 0.9), dark, sx * (W / 2 + 0.01), belt - 0.25, zRoofR + 0.1));
    detail.push(part(new THREE.BoxGeometry(W * 0.8, 0.12, 0.3), dark, 0, clr + 0.08, -L / 2 + 0.1, 0.4, 0, 0));
  }
  if (st === 'ev') detail.push(part(new THREE.BoxGeometry(W * 0.7, 0.02, 0.12), '#1fd1ff', 0, belt + 0.01, zWs + 0.05));
  if (st === 'hatch') paint.push(part(new THREE.BoxGeometry(W * 0.78, 0.05, 0.2), '#ffffff', 0, H - 0.02, zRoofR - 0.04, -0.2, 0, 0));
  if (st === 'roadster') detail.push(part(new THREE.BoxGeometry(W * 0.86, 0.03, 0.9), '#f4f4f4', 0, belt + 0.004, zWs + 0.6));

  // Räder
  const wheelGeo = merge([
    part(new THREE.CylinderGeometry(wR, wR, 0.3, 18), '#151515', 0, 0, 0, 0, 0, Math.PI / 2),
    part(new THREE.CylinderGeometry(wR * 0.64, wR * 0.64, 0.31, 10), '#c3c7cf', 0, 0, 0, 0, 0, Math.PI / 2),
    part(new THREE.BoxGeometry(0.32, wR * 1.1, 0.1), '#8a8f98', 0, 0, 0),
    part(new THREE.BoxGeometry(0.32, 0.1, wR * 1.1), '#8a8f98', 0, 0, 0),
  ]);
  const wheelPos = [];
  const wx = W / 2 - 0.12;
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) wheelPos.push(new THREE.Vector3(sx * wx, wR, sz * wb / 2));

  const root = new THREE.Group();
  const bodyG = new THREE.Group();
  root.add(bodyG);
  let paintMat = null, tailMat;
  const wheels = [];
  if (opts.lod) {
    const all = [...paint.map(g => recolor(g, color)), ...detail, ...glass.map(g => recolor(g, '#1a2430')), ...head, ...tail_.map(g => recolor(g, '#ff2a2a'))];
    for (const p of wheelPos) all.push(part(new THREE.CylinderGeometry(wR, wR, 0.3, 10), '#151515', p.x, p.y, p.z, 0, 0, Math.PI / 2));
    const m = new THREE.Mesh(merge(all), M.lod);
    m.castShadow = true;
    bodyG.add(m);
    tailMat = null;
  } else {
    paintMat = new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.28, envMapIntensity: 1.2 });
    tailMat = new THREE.MeshBasicMaterial({ color: 0x8a0a0a });
    const add = (geos, mat, shadow = true) => { if (!geos.length) return; const m = new THREE.Mesh(merge(geos), mat); m.castShadow = shadow; bodyG.add(m); return m; };
    add(paint, paintMat);
    add(detail, M.detail);
    add(glass, M.glass);
    add(head, M.head, false);
    add(tail_, tailMat, false);
    for (const [i, p] of wheelPos.entries()) {
      const pivot = new THREE.Group();
      pivot.position.copy(p);
      const spin = new THREE.Mesh(wheelGeo, M.wheel);
      spin.castShadow = true;
      if (p.x < 0) spin.rotation.y = Math.PI;
      const sg = new THREE.Group(); sg.add(spin);
      pivot.add(sg);
      root.add(pivot);
      wheels.push({ pivot, spin: sg, front: i < 2, base: p.clone() });
    }
  }
  root.userData = { bodyG, wheels, paintMat, tailMat, dims: S, exhaust: exh, wheelPos, style: st };
  return root;
}

function recolor(g, color) {
  const c = new THREE.Color(color);
  const a = g.attributes.color;
  for (let i = 0; i < a.count; i++) a.setXYZ(i, c.r, c.g, c.b);
  return g;
}

export function setCarColor(car, color) {
  if (car.userData.paintMat) car.userData.paintMat.color.set(color);
}
