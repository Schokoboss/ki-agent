// Dino-Sprint 3D – alle Figuren und Dinge aus einfachen Formen (Low-Poly, keine Dateien zum Nachladen).
// Vorne ist -z, oben +y. Ein Dino ist ca. 1,8 m hoch, eine Spur 2,4 m breit.
import * as THREE from 'three';

export const LANE_W = 2.4;

export const DINOS = [
  { id: 'rex', name: 'Rexi', art: 'T-Rex', preis: 0, farbe: 0x55b84a, bauch: 0xd4e8a8, perk: 'Allrounder – kann alles ein bisschen.' },
  { id: 'raptor', name: 'Flitz', art: 'Velociraptor', preis: 400, farbe: 0xf08a35, bauch: 0xffe2bd, akzent: 0x2f7dd1, perk: 'Doppelsprung immer an und blitzschneller Spurwechsel.' },
  { id: 'stego', name: 'Zacke', art: 'Stegosaurus', preis: 900, farbe: 0x86a64a, bauch: 0xeadcaa, akzent: 0xe0582c, perk: '+30 % Münzen auf jede Münze.' },
  { id: 'trike', name: 'Horni', art: 'Triceratops', preis: 1600, farbe: 0x5b7cf0, bauch: 0xd3dcff, akzent: 0xffc94a, perk: 'Hornstoß: zerlegt alle 20 s ein Hindernis.' },
  { id: 'ankylo', name: 'Panzer', art: 'Ankylosaurus', preis: 2500, farbe: 0x9a7058, bauch: 0xdccdc4, akzent: 0xf2efe8, perk: 'Startet mit Schild, Power-ups halten 40 % länger.' },
  { id: 'brachio', name: 'Langhals', art: 'Brachiosaurus', preis: 4000, farbe: 0x2fa89b, bauch: 0xb8e2db, akzent: 0x1d6f66, perk: 'Holt Münzen auch aus den Nachbarspuren.' },
  { id: 'spino', name: 'Segel', art: 'Spinosaurus', preis: 6000, farbe: 0x8c4ab0, bauch: 0xe6c6f2, akzent: 0xff5a5a, perk: 'Turbo-Start (300 m) und Turbo hält doppelt so lange.' },
  { id: 'gold', name: 'Goldi', art: 'Gold-Rex', preis: 12000, farbe: 0xffcf2e, bauch: 0xfff3c4, gold: true, perk: 'Doppelte Münzen – für immer.' },
];
export const dinoById = id => DINOS.find(d => d.id === id) || DINOS[0];

export const POWERUPS = {
  magnet: { name: 'Magnet', emoji: '🧲', farbe: 0xff4d6d, dauer: 8, info: 'Zieht alle Münzen in der Nähe an.' },
  shield: { name: 'Schild', emoji: '🛡️', farbe: 0x4dabf7, dauer: 0, info: 'Hält einen Zusammenstoß aus.' },
  turbo: { name: 'Turbo', emoji: '🚀', farbe: 0xff922b, dauer: 4, info: 'Superschnell und unverwundbar – Hindernisse zerplatzen.' },
  double: { name: 'Doppel-Geld', emoji: '💰', farbe: 0xfcc419, dauer: 10, info: 'Jede Münze zählt doppelt.' },
  jump: { name: 'Supersprung', emoji: '🦘', farbe: 0x51cf66, dauer: 9, info: 'Viel höher springen, Doppelsprung inklusive.' },
  meteor: { name: 'Meteor', emoji: '☄️', farbe: 0xe8590c, dauer: 0, info: 'Solo: räumt die Strecke frei. Mehrspieler: trifft die Gegner vor dir!' },
};

// ------------------------------------------------------------------ gemeinsame Formen und Materialien
const G = {
  ball: new THREE.IcosahedronGeometry(1, 1),
  ballFine: new THREE.IcosahedronGeometry(1, 2),
  rock: new THREE.IcosahedronGeometry(1, 0),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  cyl12: new THREE.CylinderGeometry(1, 1, 1, 12),
  cone: new THREE.ConeGeometry(1, 1, 6),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  octa: new THREE.OctahedronGeometry(1, 0),
  coin: new THREE.CylinderGeometry(0.36, 0.36, 0.09, 16),
  ring: new THREE.TorusGeometry(0.62, 0.06, 6, 24),
  wing: (() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(1.5, 0.15); s.lineTo(0.9, -0.1); s.lineTo(0.15, -0.45); s.lineTo(0, 0);
    return new THREE.ShapeGeometry(s);
  })(),
  sail: (() => {
    const s = new THREE.Shape();
    s.moveTo(-0.75, 0); s.quadraticCurveTo(-0.55, 0.85, 0.05, 0.92); s.quadraticCurveTo(0.6, 0.8, 0.8, 0); s.lineTo(-0.75, 0);
    return new THREE.ShapeGeometry(s, 8);
  })(),
  frill: new THREE.CircleGeometry(1, 10, 0, Math.PI),
};

const MATS = new Map();
export function mat(color, o = {}) {
  const key = `${color}|${o.metal || 0}|${o.rough ?? 0.85}|${o.emissive || 0}|${o.ei || 1}|${o.side || 0}`;
  if (!MATS.has(key)) {
    MATS.set(key, new THREE.MeshStandardMaterial({
      color, flatShading: true, roughness: o.rough ?? 0.85, metalness: o.metal || 0,
      emissive: o.emissive || 0, emissiveIntensity: o.ei || 1, side: o.side ? THREE.DoubleSide : THREE.FrontSide,
    }));
  }
  return MATS.get(key);
}

// ------------------------------------------------------------------ Verschmelzen: viele starre Teile → ein Mesh pro Material
// (weniger Zeichenaufrufe = flüssiger auf schwachen Handys)
function merged(list) {   // list: [{ geo, matrix }] → eine BufferGeometry
  const geos = list.map(({ geo, matrix }) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    return g;
  });
  const n = geos.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let k = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, k * 3);
    nor.set(g.attributes.normal.array, k * 3);
    k += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}

// Ganzes starres Objekt in den Raum der Wurzel backen
export function bake(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  root.traverse(o => {
    if (!o.isMesh) return;
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push({ geo: o.geometry, matrix: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) });
  });
  const out = new THREE.Group();
  for (const [m, list] of byMat) out.add(new THREE.Mesh(merged(list), m));
  return out;
}

// Bewegliche Figur: nur Geschwister-Teile innerhalb jeder Gruppe verschmelzen, Gruppen (Gelenke) bleiben
function bakeTree(node) {
  const byMat = new Map();
  for (const c of node.children) {
    if (!c.isMesh) continue;
    if (!byMat.has(c.material)) byMat.set(c.material, []);
    byMat.get(c.material).push(c);
  }
  for (const [m, list] of byMat) {
    if (list.length < 2) continue;
    list.forEach(c => { c.updateMatrix(); node.remove(c); });
    node.add(new THREE.Mesh(merged(list.map(c => ({ geo: c.geometry, matrix: c.matrix }))), m));
  }
  node.children.filter(c => !c.isMesh).forEach(bakeTree);
}

function part(geo, material, pos, scale, rot) {
  const m = new THREE.Mesh(geo, material);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (scale) m.scale.set(scale[0], scale[1], scale[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  return m;
}
function group(pos, ...kids) {
  const g = new THREE.Group();
  if (pos) g.position.set(pos[0], pos[1], pos[2]);
  kids.forEach(k => g.add(k));
  return g;
}

function skinOf(d) {
  const o = d.gold ? { metal: 0.35, rough: 0.25, emissive: 0x9a6c00, ei: 0.75 } : {};
  return { C: mat(d.farbe, o), B: mat(d.bauch, d.gold ? o : {}), A: mat(d.akzent ?? d.bauch, d.gold ? o : {}),
    dark: mat(0x2a2320), white: mat(0xffffff, { rough: 0.4 }), eye: mat(0x16110f, { rough: 0.3 }) };
}

function eyes(head, S, x, y, z, size = 0.1) {
  for (const s of [-1, 1]) {
    head.add(part(G.ball, S.white, [s * x, y, z], [size, size, size]));
    head.add(part(G.ball, S.eye, [s * (x + size * 0.45), y + size * 0.1, z - size * 0.35], [size * 0.55, size * 0.6, size * 0.55]));
  }
}

function tail(parent, S, start, n, size, len) {
  const segs = [];
  let p = parent;
  for (let i = 0; i < n; i++) {
    const f = 1 - i / (n + 0.6);
    const g = group(i === 0 ? start : [0, -0.02, len * (1.05 - i * 0.08)]);
    g.add(part(G.ball, S.C, [0, 0, len * 0.5], [size * f, size * 0.85 * f, len * 0.62]));
    p.add(g);
    segs.push(g);
    p = g;
  }
  return segs;
}

// ------------------------------------------------------------------ Zweibeiner: Rex, Raptor, Spino, Gold
function biped(d) {
  const S = skinOf(d);
  const raptor = d.id === 'raptor', spino = d.id === 'spino';
  const w = raptor ? 0.8 : 1;
  const root = new THREE.Group();
  const body = group([0, raptor ? 1.05 : 1.12, 0]);
  root.add(body);
  body.add(part(G.ball, S.C, [0, 0, 0], [0.5 * w, 0.56 * w, 0.92], [-0.18, 0, 0]));
  body.add(part(G.ball, S.B, [0, -0.16, -0.18], [0.4 * w, 0.4 * w, 0.7], [-0.25, 0, 0]));

  const head = group([0, 0.55 * w, -0.78]);
  body.add(head);
  const hs = raptor ? 0.78 : 1, snout = spino ? 1.45 : raptor ? 1.15 : 1;
  head.add(part(G.ball, S.C, [0, 0.02, 0.05], [0.3 * hs, 0.3 * hs, 0.3 * hs]));             // Nacken
  head.add(part(G.box, S.C, [0, 0.06, -0.3 * snout], [0.5 * hs, 0.38 * hs, 0.72 * hs * snout]));
  const jaw = group([0, -0.12 * hs, 0.02]);
  jaw.add(part(G.box, S.B, [0, -0.04, -0.3 * snout], [0.44 * hs, 0.13, 0.66 * hs * snout]));
  jaw.add(part(G.box, S.white, [0, 0.04, -0.32 * snout], [0.4 * hs, 0.06, 0.6 * hs * snout]));  // Zähne
  head.add(jaw);
  eyes(head, S, 0.22 * hs, 0.17 * hs, -0.12, 0.095 * hs);
  if (raptor) {  // Federkamm
    for (let i = 0; i < 4; i++) head.add(part(G.cone, S.A, [0, 0.3 - i * 0.02, 0.1 + i * 0.14], [0.06, 0.32 - i * 0.05, 0.06], [0.9, 0, 0]));
  }
  if (spino) {
    const sail = new THREE.Mesh(G.sail, mat(d.akzent, { side: 1 }));
    sail.position.set(0, 0.35, 0.1);
    sail.rotation.y = Math.PI / 2;
    sail.scale.set(0.9, 1.05, 1);
    body.add(sail);
    for (let i = 0; i < 5; i++) body.add(part(G.cyl, mat(0xffffff, { rough: 0.6 }), [0, 0.7, -0.5 + i * 0.25], [0.025, 0.7 - Math.abs(i - 2) * 0.12, 0.025]));
  }
  if (d.gold) head.add(part(G.cone4, mat(0xff4d6d, { metal: 0.6, rough: 0.3, emissive: 0x550011 }), [0, 0.38, 0.0], [0.16, 0.2, 0.16]));  // kleines Krönchen

  // Ärmchen
  for (const s of [-1, 1]) {
    const arm = group([s * 0.33 * w, -0.05, -0.55]);
    arm.add(part(G.box, S.C, [0, -0.12, -0.05], [0.1, raptor ? 0.4 : 0.28, 0.12], [0.7, 0, 0]));
    arm.add(part(G.cone, S.white, [0, -0.3, -0.18], [0.03, 0.1, 0.03], [2.2, 0, 0]));
    body.add(arm);
  }
  // Beine (Drehpunkt an der Hüfte)
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = group([s * 0.3 * w, raptor ? 0.92 : 1.0, 0.12]);
    leg.add(part(G.ball, S.C, [0, -0.12, 0.02], [0.2 * w, 0.36, 0.28]));
    leg.add(part(G.box, S.C, [0, -0.55, 0.12], [0.14, 0.42, 0.15], [-0.25, 0, 0]));
    leg.add(part(G.box, S.dark, [0, raptor ? -0.86 : -0.93, -0.05], [0.2, 0.08, 0.4]));
    if (raptor) leg.add(part(G.cone, S.white, [0, -0.78, -0.2], [0.04, 0.14, 0.04], [-1.2, 0, 0]));  // Sichelkralle
    root.add(leg);
    legs.push(leg);
  }
  const segs = tail(body, S, [0, 0.05, 0.75], raptor ? 5 : 4, raptor ? 0.28 : 0.34, raptor ? 0.55 : 0.48);
  root.userData = { kind: 'biped', body, bodyY: body.position.y, head, jaw, legs, tail: segs };
  return root;
}

// ------------------------------------------------------------------ Vierbeiner: Stego, Trike, Ankylo, Brachio
function quad(d) {
  const S = skinOf(d);
  const id = d.id;
  const root = new THREE.Group();
  const legH = id === 'brachio' ? 0.95 : id === 'ankylo' ? 0.5 : 0.62;
  const body = group([0, legH + 0.42, 0]);
  root.add(body);
  const bs = id === 'ankylo' ? [0.78, 0.42, 1.05] : id === 'brachio' ? [0.6, 0.55, 1.0] : [0.64, 0.56, 1.05];
  body.add(part(G.ball, S.C, [0, 0, 0], bs, [id === 'brachio' ? -0.15 : 0, 0, 0]));
  body.add(part(G.ball, S.B, [0, -0.17, 0], [bs[0] * 0.8, bs[1] * 0.7, bs[2] * 0.85]));

  const legs = [];
  const fz = -0.58, bz = 0.55;
  for (const [x, z, front] of [[-1, fz, 1], [1, fz, 1], [-1, bz, 0], [1, bz, 0]]) {
    const h = legH + (id === 'brachio' && front ? 0.25 : 0) + 0.1;
    const leg = group([x * bs[0] * 0.62, legH + 0.05 + (id === 'brachio' && front ? 0.25 : 0), z]);
    leg.add(part(G.cyl, S.C, [0, -h / 2, 0], [0.17, h, 0.17]));
    leg.add(part(G.ball, S.dark, [0, -h + 0.02, -0.04], [0.2, 0.09, 0.24]));
    root.add(leg);
    legs.push(leg);
  }

  let head, jaw, neck = null;
  if (id === 'brachio') {  // langer Hals, schräg nach vorne
    neck = group([0, 0.3, -0.75]);
    body.add(neck);
    let p = neck;
    for (let i = 0; i < 4; i++) {
      const g = group(i === 0 ? [0, 0, 0] : [0, 0.42, 0]);
      g.add(part(G.cyl, S.C, [0, 0.22, 0], [0.19 - i * 0.02, 0.5, 0.19 - i * 0.02]));
      g.rotation.x = -0.12;
      p.add(g);
      p = g;
    }
    neck.rotation.x = -0.55;
    head = group([0, 0.5, -0.05]);
    p.add(head);
    head.add(part(G.ball, S.C, [0, 0, -0.1], [0.22, 0.2, 0.3]));
    head.add(part(G.box, S.C, [0, -0.04, -0.34], [0.26, 0.16, 0.26]));
    jaw = group([0, -0.1, -0.1]);
    jaw.add(part(G.box, S.B, [0, -0.02, -0.22], [0.24, 0.06, 0.3]));
    head.add(jaw);
    head.add(part(G.ball, S.A, [0, 0.16, -0.05], [0.12, 0.08, 0.14]));
    eyes(head, S, 0.16, 0.06, -0.12, 0.065);
    head.rotation.x = 0.55;
  } else {
    head = group([0, id === 'stego' ? -0.12 : 0.02, -1.05]);
    body.add(head);
    const hs = id === 'stego' ? 0.75 : 1;
    head.add(part(G.ball, S.C, [0, 0, -0.05], [0.32 * hs, 0.3 * hs, 0.42 * hs]));
    head.add(part(G.box, S.C, [0, -0.04, -0.38 * hs], [0.34 * hs, 0.26 * hs, 0.36 * hs]));
    jaw = group([0, -0.14 * hs, -0.1]);
    jaw.add(part(G.box, S.B, [0, -0.02, -0.28 * hs], [0.3 * hs, 0.08, 0.38 * hs]));
    head.add(jaw);
    eyes(head, S, 0.2 * hs, 0.1 * hs, -0.18, 0.075);
    if (id === 'trike') {
      const frill = new THREE.Mesh(G.frill, mat(d.akzent, { side: 1 }));
      frill.position.set(0, 0.12, 0.18);
      frill.scale.set(0.62, 0.55, 1);
      frill.rotation.x = -0.35;
      head.add(frill);
      for (let i = 0; i < 7; i++) {  // Zacken am Kragen
        const a = (i / 6) * Math.PI;
        head.add(part(G.cone, S.B, [Math.cos(a) * 0.62, 0.12 + Math.sin(a) * 0.5, 0.26], [0.05, 0.14, 0.05], [0, 0, a - Math.PI / 2]));
      }
      head.add(part(G.cone, S.white, [-0.16, 0.3, -0.22], [0.06, 0.48, 0.06], [-1.15, 0, 0]));
      head.add(part(G.cone, S.white, [0.16, 0.3, -0.22], [0.06, 0.48, 0.06], [-1.15, 0, 0]));
      head.add(part(G.cone, S.white, [0, 0.05, -0.58], [0.05, 0.22, 0.05], [-0.7, 0, 0]));
      head.add(part(G.cone4, S.dark, [0, -0.1, -0.62], [0.12, 0.16, 0.1], [-1.9, 0, 0]));  // Schnabel
    }
  }
  if (id === 'stego') {  // Rückenplatten in zwei Reihen
    for (let i = 0; i < 7; i++) {
      const z = -0.7 + i * 0.25, h = 0.28 + Math.sin((i / 6) * Math.PI) * 0.22;
      body.add(part(G.octa, S.A, [(i % 2 ? 1 : -1) * 0.07, 0.48 + h * 0.6, z], [0.04, h, 0.16 + h * 0.2]));
    }
  }
  if (id === 'ankylo') {  // Panzer mit Stacheln
    for (let i = 0; i < 5; i++) {
      for (const s of [-1, 1]) body.add(part(G.cone, S.A, [s * 0.74, 0.02, -0.6 + i * 0.3], [0.07, 0.24, 0.07], [0, 0, -s * 1.3]));
    }
    for (let i = 0; i < 9; i++) body.add(part(G.ball, S.A, [((i % 3) - 1) * 0.35, 0.36, -0.55 + Math.floor(i / 3) * 0.48], [0.11, 0.07, 0.11]));
  }
  const segs = tail(body, S, [0, 0.0, 0.85], 4, id === 'ankylo' ? 0.24 : 0.3, id === 'brachio' ? 0.62 : 0.5);
  const tip = segs[segs.length - 1];
  if (id === 'stego') {
    for (const s of [-1, 1]) for (const z of [0.2, 0.42]) tip.add(part(G.cone, S.white, [s * 0.15, 0.12, z], [0.05, 0.4, 0.05], [0, 0, -s * 0.9]));
  }
  if (id === 'ankylo') tip.add(part(G.ball, S.A, [0, 0, 0.55], [0.26, 0.2, 0.26]));  // Schwanzkeule
  root.userData = { kind: 'quad', body, bodyY: body.position.y, head, jaw, legs, tail: segs, neck };
  return root;
}

export function buildDino(id) {
  const d = dinoById(id);
  const inner = ['rex', 'raptor', 'spino', 'gold'].includes(d.id) ? biped(d) : quad(d);
  const outer = new THREE.Group();  // äußere Gruppe: Lage im Spiel; innere: Ducken/Umfallen
  bakeTree(inner);
  outer.add(inner);
  outer.userData = { ...inner.userData, inner, id: d.id, phase: Math.random() * 6, duckK: 0, jawK: 0 };
  if (d.id === 'brachio') inner.scale.setScalar(0.92);
  return outer;
}

// s: { speed, air, duck, dead }
export function animateDino(g, dt, s) {
  const u = g.userData;
  const inner = u.inner;
  if (!s.air && !s.dead) u.phase += dt * (5 + (s.speed || 0) * 0.42);
  const p = u.phase;
  const k = 1 - Math.exp(-dt * 16);
  u.duckK += ((s.duck ? 1 : 0) - u.duckK) * k;
  if (u.kind === 'biped') {
    const a = s.air ? -0.75 : Math.sin(p) * 0.95, b = s.air ? -0.35 : -Math.sin(p) * 0.95;
    u.legs[0].rotation.x += (a - u.legs[0].rotation.x) * (s.air ? k : 1);
    u.legs[1].rotation.x += (b - u.legs[1].rotation.x) * (s.air ? k : 1);
  } else {
    const a = s.air ? -0.5 : Math.sin(p) * 0.7;
    u.legs[0].rotation.x = u.legs[3].rotation.x = a;
    u.legs[1].rotation.x = u.legs[2].rotation.x = s.air ? 0.5 : -a;
  }
  u.body.position.y = u.bodyY + (s.air || s.dead ? 0 : Math.abs(Math.cos(p)) * 0.07);
  u.tail.forEach((t, i) => {
    t.rotation.y = Math.sin(p * 0.5 - i * 0.8) * 0.2;
    t.rotation.x = (s.air ? 0.12 : 0.04) - u.duckK * 0.05;
  });
  u.head.rotation.z = Math.sin(p * 0.5) * 0.05;
  u.jawK += (((s.air || s.dead || s.roar) ? 1 : 0) - u.jawK) * k;
  u.jaw.rotation.x = -0.05 - u.jawK * 0.45;
  if (u.neck) u.neck.rotation.x = -0.55 - u.duckK * 0.75;
  inner.scale.y = (u.id === 'brachio' ? 0.92 : 1) * (1 - 0.42 * u.duckK);
  inner.rotation.x = -0.12 * u.duckK;
}

export function makeGhost(id, opacity = 0.5) {
  const g = buildDino(id);
  g.traverse(o => {
    if (o.isMesh) {
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.opacity = opacity;
      o.material.depthWrite = false;
    }
  });
  return g;
}

export function disposeClones(obj) {
  obj.traverse(o => {
    if (o.isMesh && o.material && !isShared(o.material)) o.material.dispose();
    if ((o.isSprite || o.isMesh) && o.material?.map && o.userData.ownTexture) o.material.map.dispose();
  });
}
const isShared = m => [...MATS.values()].includes(m);

// ------------------------------------------------------------------ Hindernisse
// Jeder Bauer liefert ein Mesh/Group; die Trefferbox (Spielwerte) legt spiel.js fest.
const CACT = () => mat(0x3d9a4f);
const CACT2 = () => mat(0x2f7d40);

function cactus(h, arms = 2, flower = true) {
  const g = new THREE.Group();
  g.add(part(G.cyl, CACT(), [0, h / 2, 0], [0.22, h, 0.22]));
  g.add(part(G.ball, CACT(), [0, h, 0], [0.22, 0.16, 0.22]));
  for (let i = 0; i < 6; i++) g.add(part(G.box, CACT2(), [Math.cos(i) * 0.2, h * 0.5, Math.sin(i) * 0.2], [0.03, h * 0.9, 0.03]));
  const sides = arms === 1 ? [1] : [-1, 1];
  sides.slice(0, arms).forEach((s, i) => {
    const y = h * (0.42 + i * 0.12), ah = h * 0.34;
    g.add(part(G.cyl, CACT(), [s * 0.3, y, 0], [0.12, 0.2, 0.12], [0, 0, Math.PI / 2]));
    g.add(part(G.cyl, CACT(), [s * 0.42, y + ah / 2, 0], [0.12, ah, 0.12]));
    g.add(part(G.ball, CACT(), [s * 0.42, y + ah, 0], [0.12, 0.09, 0.12]));
  });
  if (flower) g.add(part(G.ball, mat(0xff6fae), [0.05, h + 0.13, 0], [0.11, 0.08, 0.11]));
  return g;
}

const BAKED = {};
const STATIC = ['cactusS', 'cactusL', 'cactusG', 'boulder', 'log', 'branch'];
export function buildObstacle(type) {
  if (STATIC.includes(type)) return (BAKED[type] ||= bake(rawObstacle(type))).clone();
  return rawObstacle(type);
}

function rawObstacle(type) {
  switch (type) {
    case 'cactusS': return cactus(1.0, 1);
    case 'cactusL': return cactus(1.55, 2);
    case 'cactusG': {
      const g = new THREE.Group();
      [[-0.55, 0.95, 0.2], [0.05, 1.25, -0.25], [0.6, 0.8, 0.3]].forEach(([x, h, z], i) => {
        const c = cactus(h, i === 1 ? 2 : 1, i === 1);
        c.position.set(x, 0, z);
        c.rotation.y = i * 1.3;
        g.add(c);
      });
      return g;
    }
    case 'boulder': {
      const g = new THREE.Group();
      g.add(part(G.rock, mat(0x8d8478), [0, 0.62, 0], [0.82, 0.68, 0.75], [0.3, 0.6, 0]));
      g.add(part(G.rock, mat(0x766e64), [0.42, 0.3, 0.2], [0.38, 0.32, 0.35], [0.8, 0.2, 0]));
      g.add(part(G.ball, mat(0x6f9e4a), [-0.1, 1.15, 0.05], [0.35, 0.1, 0.3]));
      return g;
    }
    case 'log': {
      const g = new THREE.Group();
      const len = LANE_W * 3 + 0.6;
      g.add(part(G.cyl12, mat(0x7a4b2a), [0, 0.38, 0], [0.38, len, 0.38], [0, 0, Math.PI / 2]));
      for (const s of [-1, 1]) g.add(part(G.cyl12, mat(0xd9a86c), [s * len / 2, 0.38, 0], [0.34, 0.03, 0.34], [0, 0, Math.PI / 2]));
      for (let i = 0; i < 5; i++) g.add(part(G.box, mat(0x5e3a20), [-len / 2 + 0.8 + i * 1.6, 0.4, 0.37], [0.5, 0.06, 0.04]));
      g.add(part(G.ball, mat(0x6f9e4a), [1.2, 0.72, 0], [0.4, 0.1, 0.3]));
      return g;
    }
    case 'branch': {  // hängender Ast über alle Spuren – ducken!
      const g = new THREE.Group();
      const len = LANE_W * 3 + 1.6;
      const wood = mat(0x6b4226);
      for (const s of [-1, 1]) {
        g.add(part(G.cyl, wood, [s * (len / 2), 1.3, 0], [0.32, 2.6, 0.32]));
        g.add(part(G.ball, mat(0x3f8f3f), [s * (len / 2), 2.9, 0], [1.1, 0.8, 1.0]));
      }
      g.add(part(G.cyl, wood, [0, 1.62, 0], [0.27, len, 0.27], [0, 0, Math.PI / 2]));
      for (let i = 0; i < 9; i++) {
        const x = -len / 2 + 0.9 + i * ((len - 1.8) / 8);
        g.add(part(G.ball, mat(i % 2 ? 0x4caf50 : 0x388e3c), [x, 1.78, (i % 3 - 1) * 0.12], [0.42, 0.24, 0.36]));
        if (i % 2) g.add(part(G.cyl, mat(0x2e7d32), [x + 0.2, 1.5, 0.1], [0.03, 0.42, 0.03]));
      }
      return g;
    }
    case 'flyer': {  // Flugsaurier auf Kopfhöhe – ducken oder ausweichen
      const g = new THREE.Group();
      const body = mat(0x7d5ba6), belly = mat(0xd7c4ef), wingM = mat(0x9b74c9, { side: 1 });
      const inner = group([0, 1.62, 0]);
      inner.add(part(G.ball, body, [0, 0, 0], [0.26, 0.22, 0.55]));
      inner.add(part(G.ball, belly, [0, -0.08, -0.05], [0.2, 0.14, 0.4]));
      inner.add(part(G.ball, body, [0, 0.1, -0.55], [0.18, 0.18, 0.22]));
      inner.add(part(G.cone, mat(0xf2c14e), [0, 0.06, -0.95], [0.08, 0.5, 0.08], [-Math.PI / 2, 0, 0]));
      inner.add(part(G.cone, body, [0, 0.2, -0.3], [0.06, 0.45, 0.06], [1.2, 0, 0]));
      const ey = mat(0xffffff);
      for (const s of [-1, 1]) inner.add(part(G.ball, ey, [s * 0.13, 0.17, -0.65], [0.05, 0.05, 0.05]));
      const wings = [];
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(G.wing, wingM);
        w.rotation.x = -Math.PI / 2;
        w.scale.set(s * 1.0, 1, 1);
        const pivot = group([s * 0.15, 0.05, -0.05], w);
        inner.add(pivot);
        wings.push(pivot);
      }
      g.add(inner);
      g.userData.wings = wings;
      g.userData.bob = inner;
      return g;
    }
    case 'meteorRock': {
      const g = new THREE.Group();
      g.add(part(G.rock, mat(0x3b2a26, { emissive: 0x5a1400, ei: 0.8 }), [0, 0.6, 0], [0.85, 0.65, 0.8], [0.4, 0.3, 0]));
      const fire = [];
      for (let i = 0; i < 5; i++) {
        const f = part(G.cone, mat(i % 2 ? 0xffb02e : 0xff5a1f, { emissive: i % 2 ? 0xff8a00 : 0xff3300, ei: 1.4 }),
          [Math.cos(i * 1.3) * 0.45, 1.05, Math.sin(i * 1.3) * 0.4], [0.16, 0.6, 0.16]);
        g.add(f);
        fire.push(f);
      }
      g.add(part(G.cyl, mat(0x2a1d18), [0, 0.02, 0], [1.25, 0.04, 1.25]));
      g.userData.fire = fire;
      return g;
    }
  }
  throw new Error('Unbekanntes Hindernis ' + type);
}

// ------------------------------------------------------------------ Sammelsachen
let COIN = null;
export function buildCoin() {
  if (!COIN) {
    const g = new THREE.Group();
    const m = mat(0xffc928, { metal: 0.3, rough: 0.35, emissive: 0x9a6400, ei: 0.7 });
    g.add(part(G.coin, m, [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0]));
    g.add(part(G.box, m, [0, 0, 0], [0.1, 0.32, 0.12]));
    COIN = bake(g);
  }
  return COIN.clone();
}
export function buildGem() {
  const g = new THREE.Group();
  g.add(part(G.octa, mat(0x4ff0ff, { metal: 0.3, rough: 0.15, emissive: 0x0a7f99, ei: 0.9 }), [0, 0, 0], [0.34, 0.48, 0.34]));
  return g;
}

const emojiCache = new Map();
export function emojiTexture(emoji, bg) {
  const key = emoji + (bg || '');
  if (emojiCache.has(key)) return emojiCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  if (bg) {
    x.fillStyle = bg;
    x.beginPath(); x.arc(64, 64, 60, 0, Math.PI * 2); x.fill();
  }
  x.font = '78px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(emoji, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  emojiCache.set(key, t);
  return t;
}

const BUBBLES = {}, SPRITES = {};
let meteorGlow = null, warnMat = null, warnGeo = null;
export function buildPowerup(kind) {
  const pu = POWERUPS[kind];
  const g = new THREE.Group();
  BUBBLES[kind] ||= new THREE.MeshStandardMaterial({
    color: pu.farbe, emissive: pu.farbe, emissiveIntensity: 0.35, transparent: true, opacity: 0.38, roughness: 0.2, depthWrite: false,
  });
  SPRITES[kind] ||= new THREE.SpriteMaterial({ map: emojiTexture(pu.emoji, '#' + pu.farbe.toString(16).padStart(6, '0') + '55'), depthWrite: false });
  const bubble = new THREE.Mesh(G.ballFine, BUBBLES[kind]);
  bubble.scale.setScalar(0.6);
  g.add(bubble);
  const ring = new THREE.Mesh(G.ring, mat(pu.farbe, { emissive: pu.farbe, ei: 0.8 }));
  g.add(ring);
  const sp = new THREE.Sprite(SPRITES[kind]);
  sp.scale.set(0.95, 0.95, 1);
  g.add(sp);
  g.userData.ring = ring;
  return g;
}

export function buildMeteor() {
  const g = new THREE.Group();
  g.add(part(G.rock, mat(0x4a2c22, { emissive: 0xff4500, ei: 0.9 }), [0, 0, 0], [0.7, 0.7, 0.7]));
  meteorGlow ||= new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff7a1a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const glow = new THREE.Sprite(meteorGlow);
  glow.scale.set(3.4, 3.4, 1);
  g.add(glow);
  return g;
}

export function buildWarnRing() {
  warnGeo ||= new THREE.RingGeometry(0.9, 1.25, 28);
  warnMat ||= new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(warnGeo, warnMat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.04;
  return m;
}

let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export function buildShieldBubble() {
  const m = new THREE.Mesh(G.ballFine, new THREE.MeshStandardMaterial({
    color: 0x74c0fc, emissive: 0x4dabf7, emissiveIntensity: 0.6, transparent: true, opacity: 0.22, depthWrite: false, roughness: 0.1,
  }));
  m.scale.set(1.25, 1.2, 1.5);
  m.position.y = 1.0;
  return m;
}

export function buildNameTag(text, color = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 34px system-ui, "Segoe UI", Roboto, sans-serif';
  const w = Math.min(248, x.measureText(text).width + 30);
  x.fillStyle = 'rgba(15,10,30,0.66)';
  x.beginPath();
  x.roundRect((256 - w) / 2, 6, w, 52, 26);
  x.fill();
  x.fillStyle = color;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 128, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  sp.scale.set(2.2, 0.55, 1);
  sp.userData.ownTexture = true;
  return sp;
}

export function buildTomb() {
  const g = new THREE.Group();
  const stone = mat(0x9aa0a6);
  g.add(part(G.box, stone, [0, 0.45, 0], [0.7, 0.9, 0.22]));
  g.add(part(G.cyl12, stone, [0, 0.9, 0], [0.35, 0.22, 0.35], [Math.PI / 2, 0, 0]));
  g.add(part(G.box, mat(0x5f656b), [0, 0.6, -0.12], [0.08, 0.42, 0.02]));
  g.add(part(G.box, mat(0x5f656b), [0, 0.68, -0.12], [0.3, 0.08, 0.02]));
  g.add(part(G.cyl, mat(0x8a6a48), [0, 0.03, 0.3], [0.5, 0.06, 0.4]));
  return g;
}

// ------------------------------------------------------------------ Landschaft
export function buildDecor(kind) { return bake(rawDecor(kind)); }

function rawDecor(kind) {
  const g = new THREE.Group();
  switch (kind) {
    case 'palm': {
      const trunk = mat(0x9c6b3f);
      let y = 0;
      for (let i = 0; i < 6; i++) {
        g.add(part(G.cyl, trunk, [i * 0.07, y + 0.3, 0], [0.2 - i * 0.015, 0.62, 0.2 - i * 0.015], [0, 0, -0.08]));
        y += 0.58;
      }
      const leaf = mat(0x3fa34d, { side: 1 });
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const l = part(G.cone4, leaf, [0.42 + Math.cos(a) * 0.9, y - 0.1, Math.sin(a) * 0.9], [0.32, 2.0, 0.08], [0, -a, Math.PI / 2 + 0.35]);
        g.add(l);
      }
      g.add(part(G.ball, mat(0x6b4a2a), [0.42, y - 0.15, 0], [0.22, 0.2, 0.22]));
      break;
    }
    case 'fern': {
      const m = mat(0x4f9d3a);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.add(part(G.cone4, m, [Math.cos(a) * 0.35, 0.35, Math.sin(a) * 0.35], [0.12, 0.9, 0.05], [Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7]));
      }
      break;
    }
    case 'rock': {
      const c = [0x9b8f80, 0x8a7f72, 0xa89a87][Math.floor(Math.random() * 3)];
      g.add(part(G.rock, mat(c), [0, 0.35, 0], [0.7 + Math.random() * 0.6, 0.5 + Math.random() * 0.4, 0.7], [Math.random(), Math.random(), 0]));
      break;
    }
    case 'deadtree': {
      const w = mat(0x7b5b3e);
      g.add(part(G.cyl, w, [0, 1.2, 0], [0.16, 2.4, 0.16]));
      g.add(part(G.cyl, w, [0.4, 2.0, 0], [0.08, 1.1, 0.08], [0, 0, -0.8]));
      g.add(part(G.cyl, w, [-0.35, 1.6, 0], [0.07, 0.9, 0.07], [0, 0, 0.9]));
      break;
    }
    case 'bones': {  // Dino-Skelett im Sand
      const b = mat(0xf1ead8);
      g.add(part(G.cyl, b, [0, 0.12, 0], [0.06, 2.2, 0.06], [Math.PI / 2, 0, 0]));
      for (let i = 0; i < 5; i++) g.add(part(G.ring, b, [0, 0.35, -0.6 + i * 0.3], [0.55 - i * 0.05, 0.55 - i * 0.05, 0.55], [0, Math.PI / 2, 0]));
      g.add(part(G.ball, b, [0, 0.3, -1.2], [0.3, 0.25, 0.4]));
      break;
    }
    case 'bigcactus':
      g.add(cactus(2.4 + Math.random(), 2, false));
      break;
  }
  return g;
}

export function buildMountain(color, h, r) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * (0.25 + Math.random() * 0.2), r, h, 7, 1), mat(color));
  m.position.y = h / 2 - 0.5;
  m.rotation.y = Math.random() * 3;
  return m;
}

export function buildVolcano() { return bake(rawVolcano()); }

function rawVolcano() {
  const g = new THREE.Group();
  g.add(part(new THREE.CylinderGeometry(7, 26, 30, 9), mat(0x5b4a46), [0, 14.5, 0]));
  g.add(part(new THREE.CylinderGeometry(6.4, 7, 1, 9), mat(0xff5a1f, { emissive: 0xff3d00, ei: 1.2 }), [0, 29.6, 0]));
  for (let i = 0; i < 4; i++) {
    g.add(part(G.box, mat(0xff6d1f, { emissive: 0xff4500, ei: 1 }), [Math.cos(i * 1.6) * 9, 20 - i * 3, Math.sin(i * 1.6) * 9], [0.6, 9, 0.6], [0.25 * Math.sin(i), i, 0.35]));
  }
  return g;
}

export function buildCloud() {
  const g = new THREE.Group();
  const m = mat(0xffffff, { rough: 1 });
  const n = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    g.add(part(G.ball, m, [i * 2.2 - n, Math.random() * 1.2, Math.random() * 1.5], [2 + Math.random() * 1.4, 1.4 + Math.random(), 1.8]));
  }
  return bake(g);
}
