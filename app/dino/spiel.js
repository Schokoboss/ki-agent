// Dino-Sprint 3D – Endlos-Rennen in drei Spuren mit Dinos, Power-ups, Münzen, Shop und Mehrspieler.
// Die Strecke hängt nur vom Seed und der gelaufenen Strecke ab (nicht von der Zeit) – darum sehen im
// Mehrspieler alle dieselben Hindernisse an denselben Stellen.
import * as THREE from 'three';
import * as M from './modelle.js';
import { Ton } from './ton.js';
import { Netz } from './netz.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = n => '#' + n.toString(16).padStart(6, '0');

const LANE_W = M.LANE_W;
const VIEW = 150;                       // so weit voraus wird gebaut (m)
const GRAV = 44, JUMP_V = 13.6, SUPER_V = 17.5;
const STAND_H = 1.7, DUCK_H = 0.85;
const speedAt = d => 14 + 20 * (1 - Math.exp(-d / 2600));   // 14 m/s → max. 34 m/s

// ================================================================ Spielstand (bleibt im Browser)
const SAVE_KEY = 'dino3d.v1';
const save = Object.assign({ coins: 0, best: 0, owned: ['rex'], dino: 'rex', up: {}, name: '', sfx: true, musik: true, runs: 0, help: false },
  (() => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; } })());
save.up = Object.assign({ magnet: 0, turbo: 0, double: 0, jump: 0 }, save.up);
if (!Array.isArray(save.owned)) save.owned = ['rex'];
if (!save.owned.includes('rex')) save.owned.push('rex');
if (!save.owned.includes(save.dino) || !M.DINOS.some(d => d.id === save.dino)) save.dino = 'rex';
function store() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* privater Modus */ } }

const UP_COST = [150, 400, 900, 1800, 3500];
const UPGRADES = ['magnet', 'turbo', 'double', 'jump'];
const REWARD = [150, 75, 30];            // Mehrspieler-Bonus für Platz 1–3

function perkOf(id) {
  return {
    double: id === 'raptor', laneTime: id === 'raptor' ? 0.085 : 0.14,
    coinMul: id === 'gold' ? 2 : id === 'stego' ? 1.3 : 1,
    horn: id === 'trike', startShield: id === 'ankylo', puMul: id === 'ankylo' ? 1.4 : 1,
    wide: id === 'brachio', turboStart: id === 'spino' ? 300 : 0, turboMul: id === 'spino' ? 2 : 1,
  };
}
const HORN_CD = 20;
function puDauer(kind, perk) {
  return M.POWERUPS[kind].dauer * (1 + 0.2 * (save.up[kind] || 0)) * perk.puMul * (kind === 'turbo' ? perk.turboMul : 1);
}

// ================================================================ Grafik
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 600);
scene.fog = new THREE.Fog(0x8fd3ff, 50, 175);
const hemi = new THREE.HemisphereLight(0xffffff, 0xb08a5a, 1.8);
const sun = new THREE.DirectionalLight(0xffffff, 2.1);
sun.position.set(-14, 22, 10);
scene.add(hemi, sun);

// Boden und Strecke
const TRACK_W = LANE_W * 3 + 0.8;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshLambertMaterial({ color: 0xe2bb84 }));
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -0.03, -250);
scene.add(ground);

function trackTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const u = v => ((v + TRACK_W / 2) / TRACK_W) * 256;
  x.fillStyle = '#d29a5e';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1100; i++) {
    x.fillStyle = Math.random() < 0.5 ? 'rgba(110,60,25,.13)' : 'rgba(255,238,205,.2)';
    const s = 1 + Math.random() * 3;
    x.fillRect(Math.random() * 256, Math.random() * 256, s, s);
  }
  for (const l of [-1, 0, 1]) {   // Laufspuren
    x.fillStyle = 'rgba(120,65,25,.12)';
    x.fillRect(u(l * LANE_W) - 20, 0, 9, 256);
    x.fillRect(u(l * LANE_W) + 11, 0, 9, 256);
  }
  x.fillStyle = 'rgba(255,246,225,.8)';
  for (const lx of [-LANE_W / 2, LANE_W / 2]) for (let y = 0; y < 256; y += 64) x.fillRect(u(lx) - 3, y + 10, 6, 32);
  x.fillStyle = 'rgba(90,48,18,.4)';
  x.fillRect(0, 0, 7, 256);
  x.fillRect(249, 0, 7, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  t.repeat.set(1, 30);
  return t;
}
const TILE = 240 / 30;
const trackTex = trackTexture();
const track = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_W, 240), new THREE.MeshLambertMaterial({ map: trackTex }));
track.rotation.x = -Math.PI / 2;
track.position.set(0, 0, -100);
scene.add(track);
for (const s of [-1, 1]) {
  const e = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 240), new THREE.MeshLambertMaterial({ color: 0xa9774a }));
  e.position.set(s * (TRACK_W / 2 + 0.18), 0.08, -100);
  scene.add(e);
}

// Hintergrund: Berge, Vulkan, Wolken, Sonne/Mond, Sterne (ohne Nebel, dafür mit Dunst in Himmelsfarbe)
const bg = new THREE.Group();
scene.add(bg);
const hazeMats = [];
function hazy(obj, haze) {
  obj.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material.clone();
    m.fog = false;
    m.userData.base = m.color.clone();
    m.userData.haze = m.emissiveIntensity > 0 && m.emissive.getHex() ? 0 : haze;
    o.material = m;
    hazeMats.push(m);
  });
  return obj;
}
for (let i = 0; i < 26; i++) {
  const a = -Math.PI / 2 + (i / 25 - 0.5) * Math.PI * 1.35;
  const r = 230 + Math.random() * 70;
  const m = M.buildMountain([0xc27b52, 0xb0694a, 0xd29266][i % 3], 22 + Math.random() * 38, 20 + Math.random() * 22);
  m.position.x = Math.cos(a) * r;
  m.position.z = Math.sin(a) * r;
  bg.add(hazy(m, 0.5));
}
const volcano = hazy(M.buildVolcano(), 0.42);
volcano.position.set(-95, 0, -300);
bg.add(volcano);
const clouds = [];
for (let i = 0; i < 9; i++) {
  const c = hazy(M.buildCloud(), 0.15);
  c.position.set(-220 + Math.random() * 440, 50 + Math.random() * 35, -150 - Math.random() * 180);
  c.scale.setScalar(2 + Math.random() * 2);
  bg.add(c);
  clouds.push(c);
}
const smoke = [];
const smokeMat = new THREE.SpriteMaterial({ map: M.glowTexture(), color: 0x6b6461, transparent: true, depthWrite: false, fog: false });
for (let i = 0; i < 7; i++) {
  const s = new THREE.Sprite(smokeMat.clone());
  s.userData.t = i / 7;
  bg.add(s);
  smoke.push(s);
}
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.glowTexture(), color: 0xfff2b0, transparent: true, depthWrite: false, fog: false }));
sunSprite.scale.set(90, 90, 1);
bg.add(sunSprite);
const starGeo = new THREE.BufferGeometry();
{
  const pos = [];
  for (let i = 0; i < 700; i++) {
    const a = Math.random() * Math.PI * 2, e = 0.08 + Math.random() * 1.4;
    pos.push(Math.cos(a) * Math.cos(e) * 380, Math.sin(e) * 380, Math.sin(a) * Math.cos(e) * 380);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
}
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
bg.add(stars);

// Tag und Nacht – im Takt der gelaufenen Strecke
const SKY = [
  { t: 0.00, sky: 0x8fd3ff, hemi: 1.8, sun: 2.1, col: 0xffffff, star: 0 },
  { t: 0.38, sky: 0x8fd3ff, hemi: 1.8, sun: 2.1, col: 0xffffff, star: 0 },
  { t: 0.47, sky: 0xffa070, hemi: 1.35, sun: 1.7, col: 0xffb27a, star: 0 },
  { t: 0.56, sky: 0x18224a, hemi: 0.95, sun: 1.0, col: 0x9fb5ff, star: 1 },
  { t: 0.86, sky: 0x18224a, hemi: 0.95, sun: 1.0, col: 0x9fb5ff, star: 1 },
  { t: 0.94, sky: 0xffb48a, hemi: 1.4, sun: 1.7, col: 0xffc596, star: 0 },
  { t: 1.00, sky: 0x8fd3ff, hemi: 1.8, sun: 2.1, col: 0xffffff, star: 0 },
];
const skyCol = new THREE.Color(), _c1 = new THREE.Color(), _c2 = new THREE.Color();
function updateSky(cyc) {
  let i = 0;
  while (i < SKY.length - 2 && SKY[i + 1].t <= cyc) i++;
  const a = SKY[i], b = SKY[i + 1], k = clamp((cyc - a.t) / (b.t - a.t || 1), 0, 1);
  skyCol.copy(_c1.setHex(a.sky)).lerp(_c2.setHex(b.sky), k);
  scene.background = skyCol;
  scene.fog.color.copy(skyCol);
  hemi.intensity = lerp(a.hemi, b.hemi, k);
  sun.intensity = lerp(a.sun, b.sun, k);
  sun.color.copy(_c1.setHex(a.col)).lerp(_c2.setHex(b.col), k);
  stars.material.opacity = lerp(a.star, b.star, k);
  for (const m of hazeMats) m.color.copy(m.userData.base).lerp(skyCol, m.userData.haze);
  const night = lerp(a.star, b.star, k);
  const ang = (cyc < 0.52 ? cyc / 0.52 : (cyc - 0.52) / 0.48) * Math.PI;  // Sonne, dann Mond
  sunSprite.position.set(Math.cos(ang) * 260, 30 + Math.sin(ang) * 110, -320);
  sunSprite.material.color.setHex(night > 0.5 ? 0xdfe8ff : 0xfff0a8);
  sunSprite.scale.setScalar(night > 0.5 ? 55 : 95);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', '#' + skyCol.getHexString());
}

// Deko am Rand – wird immer wieder nach vorne gesetzt
const DECOR_KINDS = ['palm', 'palm', 'fern', 'fern', 'rock', 'rock', 'deadtree', 'bones', 'bigcactus', 'bigcactus', 'palm', 'rock'];
const decor = DECOR_KINDS.flatMap(k => [k, k, k, k]).map(k => {
  const m = M.buildDecor(k);
  scene.add(m);
  return { m, d: 0, x: 0 };
});
function placeDecor(o, d) {
  const side = Math.random() < 0.5 ? -1 : 1;
  o.d = d;
  o.x = side * (TRACK_W / 2 + 1.8 + Math.random() * Math.random() * 30);
  o.m.rotation.y = Math.random() * 6.3;
  o.m.scale.setScalar(0.75 + Math.random() * 0.7);
}
function resetDecor(at) { decor.forEach(o => placeDecor(o, at - 10 + Math.random() * (VIEW + 40))); }

// Schatten-Flecken (billiger als echte Schatten, läuft auch auf alten Handys)
const shadowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,.42)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
const shadowGeo = new THREE.PlaneGeometry(1, 1);
function makeShadow(w = 1.3, l = 2.2) {
  const s = new THREE.Mesh(shadowGeo, shadowMat);
  s.rotation.x = -Math.PI / 2;
  s.scale.set(w, l, 1);
  s.position.y = 0.03;
  return s;
}

// Partikel (eine einzige InstancedMesh für alle Funken, Staub und Splitter)
const PMAX = 360;
const pMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ fog: false }), PMAX);
pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
pMesh.frustumCulled = false;
scene.add(pMesh);
let parts = [];
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _col = new THREE.Color();
for (let i = 0; i < PMAX; i++) { pMesh.setColorAt(i, _col.setHex(0xffffff)); pMesh.setMatrixAt(i, _m4.makeScale(0, 0, 0)); }
function burst(x, y, d, color, n = 12, spd = 5, size = 0.16, up = 4, grav = 16, life = 0.7) {
  for (let i = 0; i < n && parts.length < PMAX; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * spd;
    parts.push({ x, y, d, vx: Math.cos(a) * r, vy: up * (0.4 + Math.random()), vd: Math.sin(a) * r, life: life * (0.6 + Math.random() * 0.6),
      max: life, size: size * (0.6 + Math.random() * 0.8), grav, color, rot: Math.random() * 6 });
  }
}
function updateParticles(dt) {
  for (const p of parts) {
    p.life -= dt;
    p.vy -= p.grav * dt;
    p.x += p.vx * dt;
    p.y = Math.max(0.05, p.y + p.vy * dt);
    p.d += p.vd * dt;
    p.rot += dt * 6;
  }
  parts = parts.filter(p => p.life > 0);
  for (let i = 0; i < PMAX; i++) {
    const p = parts[i];
    if (!p) { pMesh.setMatrixAt(i, _m4.makeScale(0, 0, 0)); continue; }
    const k = clamp(p.life / p.max, 0, 1);
    _q.setFromEuler(_e.set(p.rot, p.rot * 0.7, 0));
    _m4.compose(_v.set(p.x, p.y, -(p.d - G.viewD)), _q, _s.setScalar(p.size * (0.3 + 0.7 * k)));
    pMesh.setMatrixAt(i, _m4);
    pMesh.setColorAt(i, _col.setHex(p.color));
  }
  pMesh.instanceMatrix.needsUpdate = true;
  pMesh.instanceColor.needsUpdate = true;
}

// ================================================================ Zustand
const ton = new Ton();
ton.sfx = save.sfx;
ton.musik = save.musik;
const netz = new Netz();

const G = {
  phase: 'idle',      // idle (Menü) · countdown · run · dying · over · spect
  mp: false, seed: 1, round: 0, viewD: 0, viewX: 0, t: 0, shake: 0, paused: false,
  countEnd: 0, mpStartAt: 0, lastCount: null, dieT: 0, pendingResults: null, resultsShown: 0,
  camOff: { x: 0, y: 0 }, camOffT: { x: 0, y: 0 }, previewId: null, screen: null, shopBack: 'scrMenu',
  frames: 0, hintT: 0,
};
const P = {};
let dino = null;
const shieldMesh = M.buildShieldBubble();
const playerShadow = makeShadow();
scene.add(playerShadow);

function setPlayerDino(id) {
  if (dino && dino.userData.id === id) return;
  if (dino) scene.remove(dino);
  dino = M.buildDino(id);
  dino.add(shieldMesh);
  scene.add(dino);
}

function resetPlayer() {
  Object.assign(P, {
    lane: 0, x: 0, y: 0, vy: 0, air: false, jumps: 0, duckT: 0, d: 0, speed: speedAt(0), alive: true, inv: 0,
    shield: false, pu: { magnet: 0, turbo: 0, double: 0, jump: 0 }, puMax: { magnet: 1, turbo: 1, double: 1, jump: 1 },
    horn: 0, coins: 0, frac: 0, committed: 0, revives: 0, perk: perkOf(save.dino), flip: 0, smashes: 0,
  });
  P.shield = P.perk.startShield;
  setPlayerDino(save.dino);
  dino.rotation.set(0, 0, 0);
  dino.visible = true;
}

// ================================================================ Strecke (Seed → immer gleich)
function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
let rng = Math.random;
let objs = [];
let fx = [];
const gen = { d: 0, nextPu: 0 };

const HB = {
  cactusS: { w: 0.38, len: 0.38, y0: 0, y1: 1.0, col: 0x3d9a4f },
  cactusL: { w: 0.42, len: 0.42, y0: 0, y1: 1.55, col: 0x3d9a4f },
  cactusG: { w: 0.95, len: 0.7, y0: 0, y1: 1.2, col: 0x3d9a4f },
  boulder: { w: 0.75, len: 0.68, y0: 0, y1: 1.25, col: 0x8d8478 },
  flyer: { w: 0.85, len: 0.55, y0: 1.2, y1: 2.2, col: 0x9b74c9 },
  log: { w: LANE_W * 1.5 + 0.3, len: 0.38, y0: 0, y1: 0.72, full: true, col: 0x7a4b2a },
  branch: { w: LANE_W * 1.5 + 0.3, len: 0.32, y0: 1.32, y1: 2.0, full: true, col: 0x4caf50 },
  meteorRock: { w: 0.85, len: 0.8, y0: 0, y1: 1.15, col: 0xff6a1f },
};
const PU_WEIGHTS = [['magnet', 22], ['shield', 17], ['turbo', 14], ['double', 18], ['jump', 14], ['meteor', 15]];

function clearWorld() {
  for (const o of objs) scene.remove(o.mesh);
  for (const f of fx) { scene.remove(f.mesh); if (f.ring) scene.remove(f.ring); }
  objs = [];
  fx = [];
  parts = [];
}

function resetTrack(seed) {
  clearWorld();
  rng = mulberry32(seed);
  gen.d = 50;
  gen.nextPu = 170 + rng() * 120;
}

function addObstacle(type, lane, d) {
  const hb = HB[type];
  const mesh = M.buildObstacle(type);
  const x = hb.full ? 0 : lane * LANE_W;
  mesh.position.set(x, 0, -999);
  if (!hb.full && type !== 'flyer') mesh.rotation.y = (Math.random() - 0.5) * 0.9;  // nur Optik → Math.random
  mesh.add(hb.full ? makeShadow(TRACK_W, 1.4) : makeShadow(hb.w * 2.6, hb.len * 2.8 + 0.5));
  scene.add(mesh);
  const o = { kind: 'obs', type, d, x, mesh, ...hb };
  objs.push(o);
  return o;
}
function addCoin(lane, d, y = 0.75, gem = false) {
  const mesh = gem ? M.buildGem() : M.buildCoin();
  const x = lane * LANE_W;
  mesh.position.set(x, y, -999);
  scene.add(mesh);
  objs.push({ kind: 'coin', gem, val: gem ? 10 : 1, d, x, y, mesh, spin: Math.random() * 6 });
}
function addPowerup(kind, lane, d) {
  const mesh = M.buildPowerup(kind);
  mesh.position.set(lane * LANE_W, 1.1, -999);
  scene.add(mesh);
  objs.push({ kind: 'pu', pu: kind, d, x: lane * LANE_W, y: 1.1, mesh, spin: 0 });
}

function genRow() {
  const d = gen.d, lvl = clamp(d / 3000, 0, 1), sp = speedAt(d);
  const gap = sp * (1.02 - 0.36 * lvl + rng() * 0.55) + 6;
  const L = [-1, 0, 1];
  const pick = arr => arr[Math.floor(rng() * arr.length)];
  const ground = () => {
    const x = rng();
    if (d < 160) return x < 0.6 ? 'cactusS' : 'boulder';
    return x < 0.3 ? 'cactusS' : x < 0.55 ? 'cactusL' : x < 0.76 ? 'cactusG' : 'boulder';
  };
  const any = () => (d > 260 && rng() < 0.27 ? 'flyer' : ground());
  const maxCoins = Math.max(3, Math.min(9, Math.floor((gap - 7) / 2)));
  const r = rng();
  let free = [];
  if (d > 420 && r < 0.09) {                            // Baumstamm über alles → springen
    addObstacle('log', 0, d);
    const l = pick(L);
    for (let i = -3; i <= 3; i++) addCoin(l, d + i * 1.6, 0.75 + 1.45 * (1 - (i / 3.6) ** 2));
  } else if (d > 750 && r < 0.17) {                     // hängender Ast → ducken
    addObstacle('branch', 0, d);
    const l = pick(L);
    for (let i = -2; i <= 2; i++) addCoin(l, d + i * 1.8, 0.5);
  } else if (d > 900 && r < 0.17 + 0.22 * lvl) {        // alle drei Spuren belegt → springen oder ducken
    L.forEach(l => addObstacle(any(), l, d));
  } else if (r < 0.6) {                                 // zwei Spuren belegt
    const f = pick(L);
    L.filter(l => l !== f).forEach(l => addObstacle(any(), l, d));
    free = [f];
  } else if (r < 0.93) {                                // ein Hindernis
    const l = pick(L);
    const t = any();
    addObstacle(t, l, d);
    free = L.filter(x => x !== l);
    if (t !== 'flyer' && rng() < 0.35) {                // Münzbogen über das Hindernis
      for (let i = -3; i <= 3; i++) addCoin(l, d + i * 1.6, 0.75 + 1.45 * (1 - (i / 3.6) ** 2));
    }
  } else {                                              // Verschnaufpause: nur Münzen
    free = L.slice();
    if (rng() < 0.5) addCoin(pick(L), d + 2, 1.9, true);
  }
  if (free.length && rng() < 0.72) {
    const l = pick(free), n = Math.min(maxCoins, 5 + Math.floor(rng() * 5));
    for (let i = 0; i < n; i++) addCoin(l, d - 4 + i * 2, 0.75);
  }
  if (d >= gen.nextPu) {
    let w = rng() * PU_WEIGHTS.reduce((s, x) => s + x[1], 0), kind = 'magnet';
    for (const [k, v] of PU_WEIGHTS) { if ((w -= v) < 0) { kind = k; break; } }
    const lanes = free.length ? free : L;
    addPowerup(kind, pick(lanes), d + (free.length ? 6 : gap * 0.5));
    gen.nextPu = d + 380 + rng() * 280;
  }
  gen.d += gap;
}

// ================================================================ Meteore
function spawnMeteor(d, x, onImpact, delay = 1.25) {
  const mesh = M.buildMeteor();
  const ring = M.buildWarnRing();
  ring.position.x = x;
  scene.add(mesh, ring);
  fx.push({ mesh, ring, d, x, t: 0, dur: delay, onImpact, sx: x + (Math.random() < 0.5 ? -22 : 22), sy: 42 });
}
function updateFx(dt) {
  for (const f of fx) {
    f.t += dt;
    const k = clamp(f.t / f.dur, 0, 1);
    const z = -(f.d - G.viewD);
    f.mesh.position.set(lerp(f.sx, f.x, k), lerp(f.sy, 0.6, k * k), z - (1 - k) * 55);
    f.mesh.rotation.x += dt * 5;
    f.ring.position.z = z;
    f.ring.scale.setScalar(1 + Math.sin(f.t * 18) * 0.12 + (1 - k) * 0.6);
    if (Math.random() < 0.8) burst(f.mesh.position.x, f.mesh.position.y, G.viewD - f.mesh.position.z, Math.random() < 0.5 ? 0xff8a1f : 0xffd23f, 2, 1.5, 0.3, 1, 2, 0.5);
    if (k >= 1) {
      f.done = true;
      scene.remove(f.mesh, f.ring);
      burst(f.x, 0.6, f.d, 0xff6a1f, 26, 9, 0.28, 8, 18, 0.9);
      burst(f.x, 0.6, f.d, 0x4a2c22, 14, 6, 0.3, 6, 18, 0.9);
      if (Math.abs(f.d - G.viewD) < 60) G.shake = Math.max(G.shake, 0.5);
      ton.play('boom');
      f.onImpact?.();
    }
  }
  fx = fx.filter(f => !f.done);
}

function meteorShower() {   // Solo: räumt die Strecke vor dir frei
  let n = 0;
  for (const o of objs) {
    if (o.kind === 'obs' && !o.dead && !o.doomed && o.d > P.d + 6 && o.d < P.d + 95) {
      o.doomed = true;
      spawnMeteor(o.d, o.x, () => smash(o, true), 0.45 + n * 0.12);
      n++;
    }
  }
  if (n) ton.play('meteor');
  toast(n ? `☄️ Meteorschauer – ${n} Hindernisse weg!` : '☄️ Meteor – nichts zu treffen', 'good');
}

function incomingMeteor(from) {
  if (G.phase !== 'run' || !P.alive) return;
  const d = P.d + Math.max(34, P.speed * 2.4), lane = P.lane;
  toast(`☄️ ${from} schickt dir einen Meteor!`, 'warn');
  ton.play('meteor');
  spawnMeteor(d, lane * LANE_W, () => { if (G.phase === 'run' || G.phase === 'spect') addObstacle('meteorRock', lane, d); }, 1.3);
}

// ================================================================ Laufen
function act(a) {
  if (G.phase !== 'run' || !P.alive || G.paused) return;
  if (a === 'left' && P.lane > -1) { P.lane--; ton.play('lane'); }
  else if (a === 'right' && P.lane < 1) { P.lane++; ton.play('lane'); }
  else if (a === 'jump') {
    const sup = P.pu.jump > 0;
    if (!P.air) {
      P.vy = sup ? SUPER_V : JUMP_V;
      P.air = true;
      P.jumps = 1;
      P.duckT = 0;
      ton.play('jump');
    } else if ((P.perk.double || sup) && P.jumps < 2) {
      P.vy = (sup ? SUPER_V : JUMP_V) * 0.88;
      P.jumps = 2;
      P.flip = 1;
      ton.play('jump2');
      burst(P.x, P.y + 0.3, P.d, 0xffffff, 8, 3, 0.12, 1, 4, 0.4);
    }
  } else if (a === 'duck') {
    if (P.air) P.vy = Math.min(P.vy, -24);
    P.duckT = 0.75;
    ton.play('duck');
  }
}

function addCoins(n) {
  P.frac += n * (P.pu.double > 0 ? 2 : 1) * P.perk.coinMul;
  const w = Math.floor(P.frac + 1e-9);
  P.frac -= w;
  P.coins += w;
}

function activate(kind) {
  const pu = M.POWERUPS[kind];
  ton.play('power');
  burst(P.x, P.y + 1, P.d, pu.farbe, 22, 6, 0.16, 5, 10, 0.8);
  if (kind === 'shield') {
    P.shield = true;
    toast(`${pu.emoji} Schild!`, 'good');
  } else if (kind === 'meteor') {
    if (G.mp) {
      netz.send({ t: 'meteor' });
      toast('☄️ Meteor abgeschickt – auf die vor dir!', 'good');
    } else meteorShower();
  } else {
    P.pu[kind] = P.puMax[kind] = puDauer(kind, P.perk);
    toast(`${pu.emoji} ${pu.name}!`, 'good');
  }
}

function smash(o, quiet = false) {
  if (o.dead) return;
  o.dead = true;
  scene.remove(o.mesh);
  burst(o.x, (o.y0 + o.y1) / 2, o.d, o.col, 22, 7, 0.24, 7, 20, 0.9);
  burst(o.x, (o.y0 + o.y1) / 2, o.d, 0xffffff, 8, 5, 0.12, 5, 12, 0.6);
  if (!quiet) { ton.play('smash'); G.shake = Math.max(G.shake, 0.3); }
  if (G.phase === 'run' && P.alive) {
    addCoins(2);
    P.smashes++;
  }
}

function hitObstacle(o) {
  if (P.pu.turbo > 0) return smash(o);
  if (P.inv > 0) return;
  if (P.shield) {
    P.shield = false;
    P.inv = 1.1;
    smash(o, true);
    ton.play('shield');
    toast('🛡️ Schild geplatzt!', 'warn');
    return;
  }
  if (P.perk.horn && P.horn <= 0) {
    P.horn = HORN_CD;
    smash(o);
    toast('🦏 Hornstoß!', 'good');
    return;
  }
  crash();
}

function crash() {
  P.alive = false;
  G.phase = 'dying';
  G.dieT = 0;
  ton.play('crash');
  ton.music(false);
  G.shake = 0.9;
  burst(P.x, 1, P.d, M.dinoById(save.dino).farbe, 30, 7, 0.22, 7, 18, 1);
  burst(P.x, 0.3, P.d, 0xd8b07a, 20, 6, 0.2, 3, 12, 0.8);
  try { navigator.vibrate?.(140); } catch { /* egal */ }
  commitCoins();
}

function commitCoins() {
  const neu = P.coins - P.committed;
  if (neu > 0) save.coins += neu;
  P.committed = P.coins;
  if (!G.mp && P.d > save.best) { G.newBest = true; save.best = Math.floor(P.d); }
  store();
}

function stepRun(dt) {
  const turboStart = P.perk.turboStart && P.d < P.perk.turboStart;
  if (turboStart) P.pu.turbo = P.puMax.turbo = Math.max(P.pu.turbo, 0.25);
  const turbo = P.pu.turbo > 0;
  P.speed = damp(P.speed, speedAt(P.d) * (turbo ? 1.65 : 1), 3, dt);
  P.d += P.speed * dt;
  const tx = P.lane * LANE_W;
  const step = (LANE_W / P.perk.laneTime) * dt;
  P.x += clamp(tx - P.x, -step, step);
  if (P.air) {
    P.vy -= GRAV * dt;
    P.y += P.vy * dt;
    if (P.y <= 0) {
      P.y = 0;
      P.vy = 0;
      P.air = false;
      P.jumps = 0;
      burst(P.x, 0.1, P.d, 0xd8b07a, 8, 3, 0.14, 2, 10, 0.45);
    }
  }
  if (keysDown.has('duck')) P.duckT = Math.max(P.duckT, 0.12);
  P.duckT -= dt;
  P.inv = Math.max(0, P.inv - dt);
  P.horn = Math.max(0, P.horn - dt);
  P.flip = Math.max(0, P.flip - dt * 2.4);
  for (const k of UPGRADES) {
    if (P.pu[k] > 0) {
      P.pu[k] = Math.max(0, P.pu[k] - dt);
      if (P.pu[k] === 0) {
        if (k === 'turbo') P.inv = Math.max(P.inv, 1.2);  // nach dem Turbo kurz Luft holen
        if (!turboStart) toast(`${M.POWERUPS[k].emoji} ${M.POWERUPS[k].name} vorbei`);
      }
    }
  }
  if (turbo && Math.random() < 0.7) burst(P.x + (Math.random() - 0.5) * 0.6, 0.8 + Math.random(), P.d - 1, Math.random() < 0.5 ? 0xff922b : 0xffd43b, 2, 1, 0.16, 0.5, 0, 0.35);
  G.viewD = P.d;
  G.viewX = P.x;
  collide(dt);
}

function collide(dt) {
  const h = P.duckT > 0 && !P.air ? DUCK_H : P.duckT > 0 ? 1.1 : STAND_H;
  const magnet = P.pu.magnet > 0 || P.pu.turbo > 0;
  for (const o of objs) {
    if (o.dead) continue;
    const dd = o.d - P.d;
    if (o.kind === 'obs') {
      if (o.doomed || dd < -2 || dd > 3) continue;
      if (Math.abs(dd) < o.len + 0.42 && Math.abs(o.x - P.x) < o.w + 0.42 && P.y < o.y1 && P.y + h > o.y0) hitObstacle(o);
      if (!P.alive) return;
    } else if (o.kind === 'coin') {
      if (!o.pull && dd > -1 && ((magnet && dd < 16) || (P.perk.wide && dd < 4 && Math.abs(o.x - P.x) < LANE_W * 1.4))) o.pull = true;
      if (o.pull) {
        o.d = damp(o.d, P.d + 0.2, 14, dt);
        o.x = damp(o.x, P.x, 14, dt);
        o.y = damp(o.y, P.y + 0.9, 14, dt);
      }
      if (Math.abs(o.d - P.d) < 0.8 && Math.abs(o.x - P.x) < 0.95 && o.y > P.y - 0.4 && o.y < P.y + h + 0.35) {
        o.dead = true;
        scene.remove(o.mesh);
        addCoins(o.val);
        ton.play(o.gem ? 'gem' : 'coin');
        burst(o.x, o.y, o.d, o.gem ? 0x4ff0ff : 0xffd23f, o.gem ? 14 : 5, 2.5, 0.1, 2, 4, 0.4);
      }
    } else if (o.kind === 'pu') {
      if (Math.abs(dd) < 1.0 && Math.abs(o.x - P.x) < 1.15 && P.y < 1.9 && P.y + h > 0.4) {
        o.dead = true;
        scene.remove(o.mesh);
        activate(o.pu);
      }
    }
  }
}

function updateObjects(dt) {
  const vd = G.viewD;
  for (const o of objs) {
    if (o.dead) continue;
    const z = -(o.d - vd);
    if (z > 14) { o.dead = true; scene.remove(o.mesh); continue; }
    o.mesh.position.z = z;
    if (o.kind === 'coin') {
      o.spin += dt * 3.2;
      o.mesh.rotation.y = o.spin;
      o.mesh.position.set(o.x, o.y + Math.sin(o.spin * 1.3) * 0.06, z);
    } else if (o.kind === 'pu') {
      o.spin += dt;
      o.mesh.position.y = o.y + Math.sin(o.spin * 3) * 0.15;
      o.mesh.userData.ring.rotation.set(o.spin * 2, o.spin * 3, 0);
    } else if (o.type === 'flyer') {
      const t = G.t * 9 + o.d;
      o.mesh.userData.wings[0].rotation.z = Math.sin(t) * 0.7;
      o.mesh.userData.wings[1].rotation.z = -Math.sin(t) * 0.7;
      o.mesh.userData.bob.position.y = 1.62 + Math.sin(t * 0.5) * 0.07;
    } else if (o.type === 'meteorRock') {
      o.mesh.userData.fire.forEach((f, i) => { f.scale.y = 0.5 + Math.abs(Math.sin(G.t * 9 + i * 2)) * 0.35; });
    }
  }
  objs = objs.filter(o => !o.dead);
}

function updateDecor() {
  for (const o of decor) {
    let z = -(o.d - G.viewD);
    if (z > 16) { placeDecor(o, G.viewD + VIEW + Math.random() * 50); z = -(o.d - G.viewD); }
    o.m.position.set(o.x, 0, z);
  }
  trackTex.offset.y = (G.viewD / TILE) % 1;
}

function updateBackground(dt) {
  for (const c of clouds) {
    c.position.x += dt * 2.5;
    if (c.position.x > 260) c.position.x = -260;
  }
  for (const s of smoke) {
    s.userData.t = (s.userData.t + dt * 0.08) % 1;
    const t = s.userData.t;
    s.position.set(volcano.position.x + Math.sin(t * 5) * 4 + t * 20, 30 + t * 55, volcano.position.z);
    s.scale.setScalar(10 + t * 34);
    s.material.opacity = Math.sin(t * Math.PI) * 0.55;
  }
}

// ================================================================ Mehrspieler-Geister
const ghosts = new Map();
function ghostFor(p) {
  const mesh = M.makeGhost(p.dino, 0.5);
  const tag = M.buildNameTag(p.name, hex(M.dinoById(p.dino).farbe));
  tag.position.y = 2.75;
  mesh.add(tag);
  mesh.add(makeShadow());
  scene.add(mesh);
  return { pid: p.pid, dino: p.dino, name: p.name, mesh, d: p.d, snapD: p.d, snapT: performance.now() / 1000, x: p.lane * LANE_W, y: 0, ty: 0,
    lane: p.lane, duck: false, alive: p.alive, tomb: null, tombD: 0 };
}
function dropGhost(g) {
  scene.remove(g.mesh);
  M.disposeClones(g.mesh);
  if (g.tomb) { scene.remove(g.tomb); M.disposeClones(g.tomb); }
}
function clearGhosts() { ghosts.forEach(dropGhost); ghosts.clear(); }

function syncGhosts(st) {
  const seen = new Set();
  if (G.mp && st.phase !== 'lobby' && st.round === G.round) {
    for (const p of st.players) {
      if (p.pid === netz.pid || !p.inRace) continue;
      seen.add(p.pid);
      let g = ghosts.get(p.pid);
      if (!g || g.dino !== p.dino) {
        if (g) dropGhost(g);
        g = ghostFor(p);
        ghosts.set(p.pid, g);
      }
      if (p.d >= g.snapD) { g.snapD = p.d; g.snapT = performance.now() / 1000; }
      g.lane = p.lane;
      g.ty = p.y;
      g.duck = p.duck;
      if (g.alive && !p.alive) {
        g.alive = false;
        g.tombD = p.d;
        g.tomb = M.buildTomb();
        const tag = M.buildNameTag('💀 ' + p.name, '#ffd0d0');
        tag.position.y = 1.8;
        g.tomb.add(tag);
        g.tomb.position.x = p.lane * LANE_W;
        scene.add(g.tomb);
        burst(p.lane * LANE_W, 1, p.d, M.dinoById(p.dino).farbe, 18, 5, 0.2, 5, 14, 0.8);
      }
    }
  }
  for (const [pid, g] of ghosts) if (!seen.has(pid)) { dropGhost(g); ghosts.delete(pid); }
}

function updateGhosts(dt) {
  const now = performance.now() / 1000;
  for (const g of ghosts.values()) {
    if (g.alive) {
      const pred = g.snapD + speedAt(g.snapD) * Math.min(0.8, now - g.snapT);
      g.d = Math.abs(pred - g.d) > 25 ? pred : damp(g.d, pred, 10, dt);
      g.x = damp(g.x, g.lane * LANE_W, 12, dt);
      g.y = damp(g.y, g.ty, 14, dt);
      const z = -(g.d - G.viewD);
      g.mesh.visible = z > -170 && z < 20;
      g.mesh.position.set(g.x, g.y, z);
      M.animateDino(g.mesh, dt, { speed: speedAt(g.d), air: g.y > 0.08, duck: g.duck });
    } else g.mesh.visible = false;
    if (g.tomb) g.tomb.position.z = -(g.tombD - G.viewD);
  }
}

function leader() {
  let best = null;
  for (const g of ghosts.values()) if (g.alive && (!best || g.d > best.d)) best = g;
  return best;
}

// ================================================================ Kamera
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  aimMenuCam();
}
addEventListener('resize', resize);

// Im Menü steht der Dino im freien Bereich neben dem Fenster (Bildausschnitt verschieben)
function aimMenuCam() {
  const W = innerWidth, H = innerHeight;
  G.camOffT = { x: 0, y: 0 };
  if (!['idle'].includes(G.phase)) return;
  const panel = document.querySelector('.screen:not([hidden]) .panel');
  if (!panel) return;
  const r = panel.getBoundingClientRect();
  const areas = [
    { a: r.left * H, cx: r.left / 2, cy: H / 2, ok: r.left > W * 0.28 },
    { a: (W - r.right) * H, cx: (r.right + W) / 2, cy: H / 2, ok: W - r.right > W * 0.28 },
    { a: W * r.top, cx: W / 2, cy: r.top / 2 + 10, ok: r.top > H * 0.25 },
  ].filter(x => x.ok).sort((a, b) => b.a - a.a);
  if (areas[0]) G.camOffT = { x: areas[0].cx - W / 2, y: areas[0].cy - H / 2 };
}

const _look = new THREE.Vector3();
function updateCamera(dt) {
  const W = innerWidth, H = innerHeight, portrait = W / H < 0.9;
  const menu = G.phase === 'idle';
  G.camOff.x = damp(G.camOff.x, G.camOffT.x, 6, dt);
  G.camOff.y = damp(G.camOff.y, G.camOffT.y, 6, dt);
  if (Math.abs(G.camOff.x) > 0.5 || Math.abs(G.camOff.y) > 0.5) camera.setViewOffset(W, H, -G.camOff.x, -G.camOff.y, W, H);
  else if (camera.view?.enabled) camera.clearViewOffset();
  let fov;
  if (menu) {
    const a = Math.PI * 0.78 + Math.sin(G.t * 0.22) * 0.5;
    const R = portrait ? 7.4 : 5.6;
    camera.position.set(Math.sin(a) * R, portrait ? 2.6 : 2.2, Math.cos(a) * R);
    _look.set(0, 1.05, 0);
    fov = portrait ? 62 : 50;
  } else {
    const turbo = P.pu?.turbo > 0 ? 1 : 0;
    G.turboK = damp(G.turboK || 0, turbo, 4, dt);
    const tx = G.viewX * 0.55;
    camera.position.x = damp(camera.position.x, tx, 8, dt);
    camera.position.y = damp(camera.position.y, (portrait ? 4.5 : 3.7) + (P.y || 0) * 0.3, 6, dt);
    camera.position.z = damp(camera.position.z, portrait ? 8.0 : 6.6, 4, dt);
    _look.set(G.viewX * 0.8, 1.15 + (P.y || 0) * 0.2, -10);
    fov = (portrait ? 72 : 58) + G.turboK * 12;
  }
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = damp(camera.fov, fov, 5, dt); camera.updateProjectionMatrix(); }
  camera.lookAt(_look);
  if (G.shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * G.shake * 0.5;
    camera.position.y += (Math.random() - 0.5) * G.shake * 0.5;
    G.shake *= Math.exp(-dt * 6);
  }
}

// ================================================================ Hauptschleife
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const raw = Math.min(0.05, (now - last) / 1000);
  last = now;
  const dt = G.paused ? 0 : raw;
  G.t += dt;
  G.frames++;
  tick(dt);
  renderer.render(scene, camera);
}

function tick(dt) {
  switch (G.phase) {
    case 'idle':
      G.viewD += 9 * dt;
      G.viewX = 0;
      M.animateDino(dino, dt, { speed: 9 });
      dino.position.set(0, 0, 0);
      break;
    case 'countdown': countdown(); break;
    case 'run': stepRun(dt); break;
    case 'dying':
      G.dieT += dt;
      dino.rotation.z = damp(dino.rotation.z, Math.PI / 2, 8, dt);
      dino.position.y = Math.max(0.25, P.y - G.dieT * 6) * 0 + 0.3 * Math.max(0, 1 - G.dieT * 3);
      if (G.dieT > 1.1) afterDeath();
      break;
    case 'spect': {
      const l = leader();
      if (l) { G.viewD = damp(G.viewD, l.d, 6, dt); G.viewX = damp(G.viewX, l.x, 6, dt); }
      if (G.pendingResults) showResults(G.pendingResults);
      break;
    }
  }
  if (G.phase !== 'idle' && G.phase !== 'over') {
    while (gen.d < G.viewD + VIEW) genRow();
  }
  // Spieler-Figur
  if (G.phase === 'run' || G.phase === 'countdown') {
    dino.position.set(P.x, P.y, 0);
    dino.rotation.x = -P.flip * Math.PI * 2;
    M.animateDino(dino, dt, { speed: G.phase === 'run' ? P.speed : 0, air: P.air, duck: P.duckT > 0 && !P.air });
    dino.visible = P.inv <= 0 || P.pu.turbo > 0 || Math.floor(G.t * 12) % 2 === 0;
  }
  if (G.phase === 'spect') dino.visible = false;
  shieldMesh.visible = !!P.shield && P.alive && G.phase !== 'idle';
  if (shieldMesh.visible) shieldMesh.scale.set(1.25 + Math.sin(G.t * 6) * 0.04, 1.2, 1.5);
  playerShadow.visible = dino.visible || G.phase === 'dying';
  playerShadow.position.set(dino.position.x, 0.03, 0);
  playerShadow.scale.set(1.4 / (1 + (P.y || 0) * 0.35), 2.2 / (1 + (P.y || 0) * 0.35), 1);
  updateObjects(dt);
  updateFx(dt);
  updateGhosts(dt);
  updateParticles(dt);
  updateDecor();
  updateBackground(dt);
  updateSky(((G.viewD + 300) / 2000) % 1);
  updateCamera(dt);
  ton.tempo = 0.9 + clamp(((P.speed || 14) - 14) / 40, 0, 0.5);
  hud();
}

// ================================================================ Ablauf
function startGame(seed, mp) {
  G.mp = mp;
  G.seed = seed;
  G.newBest = false;
  G.pendingResults = null;
  G.paused = false;
  resetPlayer();
  resetTrack(seed);
  G.viewD = 0;
  G.viewX = 0;
  resetDecor(0);
  camera.position.set(0, 6, 12);
  show(null);
  $('#hud').hidden = false;
  $('#hSpect').hidden = true;
  $('#hBoard').hidden = !mp;
  G.phase = 'countdown';
  G.lastCount = null;
  G.countEnd = performance.now() / 1000 + 2.4;
  G.hintT = save.runs < 3 ? 6 : 0;
  ton.unlock();
  ton.music(true);
  aimMenuCam();
}

function countdown() {
  const left = G.mp ? G.mpStartAt - netz.serverNow() : G.countEnd - performance.now() / 1000;
  const n = left <= 0 ? 0 : G.mp ? Math.ceil(left) : Math.ceil(left / 0.8);
  const label = n === 0 ? 'LOS!' : n > 3 ? 'Bereit?' : String(n);
  if (label !== G.lastCount) {
    G.lastCount = label;
    big(label);
    ton.play(n === 0 ? 'go' : n <= 3 ? 'beep' : 'click');
  }
  if (left <= 0) {
    G.phase = 'run';
    setTimeout(() => { if (G.lastCount === 'LOS!') big(''); }, 650);
  }
}

function afterDeath() {
  if (G.mp) {
    G.phase = 'spect';
    $('#hSpect').hidden = false;
    return;
  }
  G.phase = 'over';
  save.runs++;
  store();
  $('#hud').hidden = true;
  $('#oDist').textContent = Math.floor(P.d);
  $('#oCoins').textContent = P.coins;
  $('#oTitle').textContent = ['Autsch!', 'Rums!', 'Uff!', 'Aua!'][Math.floor(Math.random() * 4)];
  const b = $('#oBest');
  b.textContent = G.newBest ? '🏆 Neuer Rekord!' : `Rekord: ${save.best} m`;
  b.classList.toggle('neu', !!G.newBest);
  const cost = reviveCost();
  $('#oRevCost').textContent = cost;
  $('#bRevive').disabled = save.coins < cost;
  $('#bRevive').hidden = P.revives >= 3;
  show('scrOver');
}

const reviveCost = () => 100 * 2 ** P.revives;

function revive() {
  const cost = reviveCost();
  if (save.coins < cost) { ton.play('nope'); return; }
  save.coins -= cost;
  store();
  P.revives++;
  for (const o of objs) if (o.kind === 'obs' && o.d > P.d - 3 && o.d < P.d + 40) smash(o, true);
  P.alive = true;
  P.inv = 2.5;
  P.air = false;
  P.y = 0;
  P.vy = 0;
  P.duckT = 0;
  P.speed = speedAt(P.d) * 0.6;
  dino.rotation.set(0, 0, 0);
  dino.visible = true;
  show(null);
  $('#hud').hidden = false;
  G.phase = 'countdown';
  G.lastCount = null;
  G.countEnd = performance.now() / 1000 + 1.6;
  ton.play('buy');
  ton.music(true);
}

function toMenu() {
  if (G.mp) { netz.leave(); G.mp = false; }
  clearGhosts();
  clearWorld();
  G.phase = 'idle';
  G.paused = false;
  ton.music(false);
  $('#hud').hidden = true;
  big('');
  resetPlayer();
  show('scrMenu');
}

function pause() {
  if (G.phase !== 'run' || G.mp) return;
  G.paused = true;
  ton.music(false);
  show('scrPause');
}
function resume() {
  if (!G.paused) return;
  show(null);
  G.paused = false;
  G.phase = 'countdown';
  G.lastCount = null;
  G.countEnd = performance.now() / 1000 + 1.6;
  ton.music(true);
}

// ================================================================ HUD
let hudCache = {};
function setText(id, v) {
  if (hudCache[id] !== v) { hudCache[id] = v; document.getElementById(id).textContent = v; }
}
function hud() {
  if ($('#hud').hidden) return;
  setText('hDist', String(Math.floor(G.phase === 'spect' ? G.viewD : P.d)));
  setText('hCoins', String(P.coins));
  // Power-ups
  const items = [];
  for (const k of UPGRADES) if (P.pu[k] > 0) items.push([M.POWERUPS[k].emoji, M.POWERUPS[k].name, P.pu[k] / P.puMax[k], M.POWERUPS[k].farbe]);
  if (P.shield) items.push(['🛡️', 'Schild', 1, 0x4dabf7]);
  if (P.perk.horn) items.push(['🦏', P.horn > 0 ? 'Horn lädt' : 'Horn bereit', 1 - P.horn / HORN_CD, 0xffc94a]);
  const key = items.map(i => i[1]).join('|');
  const box = $('#hPowers');
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.innerHTML = items.map(i => `<div class="pu"><span class="e">${i[0]}</span>${esc(i[1])}<i><b style="background:${hex(i[3])}"></b></i></div>`).join('');
  }
  [...box.querySelectorAll('i b')].forEach((b, i) => { b.style.width = `${Math.round(clamp(items[i][2], 0, 1) * 100)}%`; });
  // Mehrspieler-Rangliste
  if (G.mp && netz.state) {
    const rows = netz.state.players.filter(p => p.inRace).map(p => {
      const me = p.pid === netz.pid;
      const g = ghosts.get(p.pid);
      return { name: p.name, dino: p.dino, me, alive: me ? P.alive : p.alive, d: me ? P.d : g ? (g.alive ? g.d : g.tombD) : p.d };
    }).sort((a, b) => b.d - a.d);
    const html = rows.map((r, i) => `<li class="${r.me ? 'me' : ''} ${r.alive ? '' : 'tot'}"><span>${i + 1}.</span><span class="dot" style="background:${hex(M.dinoById(r.dino).farbe)}"></span><span class="n">${r.alive ? '' : '💀 '}${esc(r.name)}</span><span>${Math.floor(r.d)} m</span></li>`).join('');
    if (hudCache.board !== html) { hudCache.board = html; $('#hBoard').innerHTML = html; }
  }
  // Tipp für Neulinge
  if (G.hintT > 0 && G.phase === 'run') {
    G.hintT -= 1 / 60;
    setText('hHint', matchMedia('(pointer: coarse)').matches ? 'Wischen: ← → Spur · ↑ springen · ↓ ducken' : '← → Spur · ↑/Leertaste springen · ↓ ducken');
  }
  $('#hHint').classList.toggle('weg', !(G.hintT > 0));
}

function big(text) {
  const b = $('#big');
  b.textContent = text;
  b.classList.remove('pop');
  void b.offsetWidth;
  if (text) b.classList.add('pop');
}

function toast(text, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = text;
  const box = $('#toasts');
  box.appendChild(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => t.remove(), 2500);
}

// ================================================================ Eingabe
const KEYS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', ArrowDown: 'duck', KeyS: 'duck' };
const keysDown = new Set();
addEventListener('keydown', e => {
  ton.unlock();
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (G.paused) resume(); else if (G.phase === 'run' && !G.mp) pause();
    return;
  }
  const a = KEYS[e.code];
  if (!a) return;
  if (G.phase === 'run' || G.phase === 'countdown') e.preventDefault();
  if (a === 'duck') keysDown.add('duck');
  if (!e.repeat) act(a);
});
addEventListener('keyup', e => { if (KEYS[e.code] === 'duck') keysDown.delete('duck'); });
addEventListener('blur', () => keysDown.clear());

let swipe = null;
canvas.addEventListener('pointerdown', e => {
  ton.unlock();
  swipe = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, done: false };
});
canvas.addEventListener('pointermove', e => {
  if (!swipe || swipe.done || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (Math.hypot(dx, dy) > Math.max(22, Math.min(innerWidth, innerHeight) * 0.045)) {
    swipe.done = true;
    act(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy < 0 ? 'jump' : 'duck'));
  }
});
canvas.addEventListener('pointerup', e => {
  if (swipe && !swipe.done && e.pointerId === swipe.id && performance.now() - swipe.t < 350) act('jump');
  swipe = null;
});
canvas.addEventListener('pointercancel', () => { swipe = null; });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ================================================================ Bildschirme
function show(id) {
  $$('.screen').forEach(s => { s.hidden = s.id !== id; });
  G.screen = id;
  if (id === 'scrMenu') renderMenu();
  if (id === 'scrShop') renderShop();
  requestAnimationFrame(aimMenuCam);
}

function refreshCoins() { $$('.vCoins').forEach(e => { e.textContent = save.coins; }); }

function renderMenu() {
  refreshCoins();
  const d = M.dinoById(save.dino);
  $('#mBest').textContent = save.best;
  $('#mDinoName').textContent = d.name;
  $('#mDinoArt').textContent = d.art;
  if (G.phase === 'idle') setPlayerDino(save.dino);
  syncToggles();
}

function syncToggles() {
  $$('[data-toggle]').forEach(b => {
    const on = !!save[b.dataset.toggle];
    b.classList.toggle('aus', !on);
    b.setAttribute('aria-pressed', on);
  });
}
$$('[data-toggle]').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.toggle;
  save[k] = !save[k];
  ton.sfx = save.sfx;
  ton.musik = save.musik;
  store();
  syncToggles();
  ton.unlock();
  ton.play('click');
}));

// Shop
let shopTab = 'dinos';
function renderShop() {
  refreshCoins();
  $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === shopTab));
  $('#shopDinos').hidden = shopTab !== 'dinos';
  $('#shopUps').hidden = shopTab !== 'ups';
  const view = G.previewId || save.dino;
  $('#shopDinos').innerHTML = M.DINOS.map(d => {
    const owned = save.owned.includes(d.id), sel = save.dino === d.id;
    const btn = owned ? (sel ? '✓ Gewählt' : 'Wählen') : `🪙 ${d.preis}`;
    return `<div class="card ${sel ? 'sel' : ''} ${view === d.id ? 'view' : ''}" data-id="${d.id}" role="button" tabindex="0">
      <div class="sw" style="background:linear-gradient(90deg,${hex(d.farbe)},${hex(d.akzent ?? d.bauch)})"></div>
      <h3>${esc(d.name)}</h3><small>${esc(d.art)}</small><p>${esc(d.perk)}</p>
      <button class="btn ${owned ? (sel ? '' : 'primary') : 'gold'}" data-act="${owned ? 'sel' : 'buy'}" type="button" ${sel ? 'disabled' : ''}>${btn}</button></div>`;
  }).join('');
  $('#shopUps').innerHTML = UPGRADES.map(k => {
    const pu = M.POWERUPS[k], lvl = save.up[k] || 0, max = lvl >= UP_COST.length;
    const now = (pu.dauer * (1 + 0.2 * lvl)).toFixed(1), next = (pu.dauer * (1 + 0.2 * (lvl + 1))).toFixed(1);
    return `<div class="up"><span class="e">${pu.emoji}</span><div class="t"><b>${pu.name}</b><small>${max ? `${now} s – voll ausgebaut` : `${now} s → ${next} s`}</small>
      <div class="pips">${UP_COST.map((_, i) => `<span class="pip ${i < lvl ? 'on' : ''}"></span>`).join('')}</div></div>
      <button class="btn ${max ? '' : 'gold'}" data-up="${k}" type="button" ${max ? 'disabled' : ''}>${max ? 'MAX' : '🪙 ' + UP_COST[lvl]}</button></div>`;
  }).join('');
}
$('#shopDinos').addEventListener('click', e => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id, d = M.dinoById(id);
  const act = e.target.closest('[data-act]')?.dataset.act;
  ton.unlock();
  if (act === 'buy') {
    if (save.coins < d.preis) { ton.play('nope'); toast(`Dir fehlen noch 🪙 ${d.preis - save.coins}`, 'warn'); }
    else {
      save.coins -= d.preis;
      save.owned.push(id);
      save.dino = id;
      store();
      ton.play('buy');
      toast(`🎉 ${d.name} gehört jetzt dir!`, 'good');
    }
  } else if (act === 'sel') {
    save.dino = id;
    store();
    ton.play('click');
  } else ton.play('click');
  G.previewId = id;
  if (G.phase === 'idle') setPlayerDino(id);
  renderShop();
});
$('#shopUps').addEventListener('click', e => {
  const k = e.target.closest('[data-up]')?.dataset.up;
  if (!k) return;
  ton.unlock();
  const lvl = save.up[k] || 0, cost = UP_COST[lvl];
  if (cost == null) return;
  if (save.coins < cost) { ton.play('nope'); toast(`Dir fehlen noch 🪙 ${cost - save.coins}`, 'warn'); return; }
  save.coins -= cost;
  save.up[k] = lvl + 1;
  store();
  ton.play('buy');
  renderShop();
});
$$('.tab').forEach(t => t.addEventListener('click', () => { shopTab = t.dataset.tab; ton.play('click'); renderShop(); }));

function openShop(back) {
  G.shopBack = back;
  G.previewId = save.dino;
  show('scrShop');
}
$$('[data-back]').forEach(b => b.addEventListener('click', () => {
  ton.play('click');
  if (G.screen === 'scrShop') {
    G.previewId = null;
    if (G.phase === 'idle') setPlayerDino(save.dino);
    if (G.shopBack === 'scrLobby' && netz.room) return showLobby();
    return show(G.shopBack === 'scrOver' ? 'scrMenu' : G.shopBack);
  }
  show('scrMenu');
}));

// Menü-Knöpfe
$('#bSolo').onclick = () => startGame((Math.random() * 2 ** 31) | 0, false);
$('#bShop').onclick = () => { ton.unlock(); ton.play('click'); openShop('scrMenu'); };
$('#bHelp').onclick = () => { ton.unlock(); ton.play('click'); $('#help').showModal(); };
$('#helpPu').innerHTML = Object.values(M.POWERUPS).map(p => `<li>${p.emoji} <b>${p.name}</b> – ${esc(p.info)}</li>`).join('');
$('#btnPause').onclick = pause;
$('#bResume').onclick = resume;
$('#bQuit').onclick = () => { G.paused = false; commitCoins(); save.runs++; store(); toMenu(); };
$('#bAgain').onclick = () => startGame((Math.random() * 2 ** 31) | 0, false);
$('#bRevive').onclick = revive;
$('#bOverMenu').onclick = toMenu;
$('#bOverShop').onclick = () => { toMenu(); openShop('scrMenu'); };

// ================================================================ Mehrspieler-Bildschirme
let serverOk = false;
async function openMp() {
  ton.unlock();
  ton.play('click');
  show('scrMp');
  $('#mpName').value = save.name || '';
  const st = $('#mpStatus');
  if (!serverOk) {
    st.textContent = 'Suche Server …';
    serverOk = !!(await netz.detect());
  }
  $('#bCreate').disabled = $('#bJoin').disabled = !serverOk;
  st.innerHTML = serverOk
    ? `✅ Verbunden mit ${esc(new URL(netz.server).host)}`
    : '❌ Kein Mehrspieler-Server gefunden. Öffne das Spiel über deinen Nova-Laptop (Nova-App → Dino-Sprint) oder starte am PC <code>python server/dino_mp.py</code> und öffne die angezeigte WLAN-Adresse.';
  return serverOk;
}
$('#bMulti').onclick = openMp;

function readName() {
  const n = $('#mpName').value.replace(/[<>&"'`\\]/g, '').trim().slice(0, 14);
  if (!n) { toast('Wie heißt du? Gib oben einen Namen ein.', 'warn'); $('#mpName').focus(); return null; }
  save.name = n;
  store();
  return n;
}
$('#bCreate').onclick = async () => {
  const n = readName();
  if (!n) return;
  try { await netz.create(n, save.dino); showLobby(); }
  catch (e) { toast(e.message, 'warn'); }
};
$('#bJoin').onclick = async () => {
  const n = readName();
  const code = $('#mpCode').value.trim().toUpperCase();
  if (!n) return;
  if (code.length < 4) { toast('Der Raum-Code hat 4 Zeichen.', 'warn'); return; }
  try { await netz.join(code, n, save.dino); showLobby(); }
  catch (e) { toast(e.message, 'warn'); }
};
$('#mpCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

netz.getMe = () => ({ name: save.name, dino: save.dino, d: P.d || 0, lane: P.lane || 0, y: P.y || 0, duck: P.duckT > 0, alive: G.phase === 'dying' ? false : P.alive !== false, coins: P.coins || 0 });
netz.onInbox = items => items.forEach(i => { if (i.t === 'meteor') incomingMeteor(i.from || 'Jemand'); });
netz.onLost = msg => {
  toast('Raum verlassen: ' + msg, 'warn');
  G.mp = false;
  clearGhosts();
  if (G.phase !== 'idle') toMenu(); else show('scrMenu');
};
netz.onState = st => {
  const me = st.players.find(p => p.pid === netz.pid);
  if (st.phase === 'race' && me?.inRace && st.round !== G.round) {   // neues Rennen → los!
    G.round = st.round;
    G.mpStartAt = st.startAt;
    clearGhosts();
    startGame(st.seed, true);
  }
  if (G.mp && st.round === G.round) {
    if (st.phase === 'results' && G.resultsShown !== st.round) {
      if (G.phase === 'run' || G.phase === 'countdown') {   // Server sagt: vorbei (z. B. Verbindung zu lange weg)
        P.alive = false;
        commitCoins();
        G.phase = 'spect';
      }
      if (G.phase === 'spect' || G.phase === 'over') showResults(st); else G.pendingResults = st;
    }
    if (st.phase === 'lobby' && G.phase !== 'idle') backToLobby();
  }
  syncGhosts(st);
  if (G.screen === 'scrLobby') renderLobby(st);
  if (G.screen === 'scrResults') renderResultButtons(st);
};

function showLobby() {
  if (G.phase !== 'idle') {
    clearGhosts();
    clearWorld();
    G.phase = 'idle';
    ton.music(false);
    $('#hud').hidden = true;
    big('');
    resetPlayer();
  }
  G.mp = true;
  show('scrLobby');
  $('#lCode').textContent = netz.room;
  if (netz.state) renderLobby(netz.state);
}
function backToLobby() { showLobby(); }

function renderLobby(st) {
  const me = st.players.find(p => p.pid === netz.pid);
  const isHost = st.host === netz.pid;
  $('#lPlayers').innerHTML = st.players.map(p => {
    const d = M.dinoById(p.dino);
    const tags = [p.host ? '👑 Host' : '', st.phase === 'race' ? (p.inRace ? (p.alive ? `🏃 ${Math.floor(p.d)} m` : `💀 ${Math.floor(p.d)} m`) : '⏳ wartet') : ''].filter(Boolean).join(' · ');
    return `<li class="${p.pid === netz.pid ? 'me' : ''}"><span class="dot" style="background:${hex(d.farbe)}"></span><span>${esc(p.name)}${p.pid === netz.pid ? ' (du)' : ''}<br><small class="muted">${esc(d.name)} · ${esc(d.art)}</small></span><span class="tag">${tags}</span></li>`;
  }).join('');
  const racing = st.phase === 'race';
  $('#lInfo').textContent = racing && !me?.inRace ? 'Das Rennen läuft gerade – beim nächsten bist du dabei.'
    : isHost ? (st.players.length < 2 ? 'Lade Freunde ein – oder starte allein zum Üben.' : `Du bist Host – starte, wenn alle ${st.players.length} bereit sind.`)
      : 'Warte, bis der Host das Rennen startet …';
  $('#bStart').hidden = !isHost;
  $('#bStart').disabled = racing;
}
$('#bStart').onclick = async () => {
  ton.unlock();
  try { await netz.start(); } catch (e) { toast(e.message, 'warn'); }
};
$('#bLeave').onclick = async () => {
  ton.play('click');
  await netz.leave();
  G.mp = false;
  G.round = 0;
  clearGhosts();
  show('scrMp');
};
$('#bLDino').onclick = () => { ton.play('click'); openShop('scrLobby'); };

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* unten */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* egal */ }
  ta.remove();
  return ok;
}
$('#bShare').onclick = async () => {
  const url = netz.inviteLink();
  const text = `Lauf mit mir bei Dino-Sprint 3D um die Wette! Raum-Code: ${netz.room}`;
  if (navigator.share) { try { await navigator.share({ title: 'Dino-Sprint 3D', text, url }); return; } catch { /* abgebrochen */ } }
  toast((await copyText(url)) ? '📋 Einladungs-Link kopiert!' : url);
};
$('#bCopy').onclick = async () => { toast((await copyText(netz.inviteLink())) ? '📋 Link kopiert – schick ihn deinen Freunden!' : netz.inviteLink()); };

function showResults(st) {
  G.pendingResults = null;
  G.resultsShown = st.round;
  const res = st.results || [];
  const mine = res.find(r => r.pid === netz.pid);
  let reward = 0;
  if (mine && res.length >= 2) reward = REWARD[mine.place - 1] || 0;
  if (reward) { save.coins += reward; store(); }
  $('#hud').hidden = true;
  $('#rList').innerHTML = res.map(r => {
    const d = M.dinoById(r.dino);
    return `<li class="${r.pid === netz.pid ? 'me' : ''}"><span class="pl">${['🥇', '🥈', '🥉'][r.place - 1] || r.place + '.'}</span><span class="dot" style="background:${hex(d.farbe)}"></span><span>${esc(r.name)}</span><span class="tag">${r.d} m · 🪙 ${r.coins}</span></li>`;
  }).join('');
  $('#rReward').textContent = mine ? (reward ? `🎁 Platz ${mine.place}: +${reward} Bonus-Münzen!` : res.length < 2 ? 'Allein gelaufen – mit Freunden gibt es Bonus-Münzen.' : `Platz ${mine.place} – nächstes Mal klappt's!`) : '';
  if (mine?.place === 1 && res.length >= 2) ton.play('win');
  show('scrResults');
  renderResultButtons(st);
}
function renderResultButtons(st) {
  const isHost = st.host === netz.pid;
  $('#bRAgain').hidden = !isHost;
  $('#bRAgain').disabled = st.phase === 'race';
}
$('#bRAgain').onclick = async () => { try { await netz.start(); } catch (e) { toast(e.message, 'warn'); } };
$('#bRLobby').onclick = () => { ton.play('click'); showLobby(); };

// ================================================================ Start
function boot() {
  resize();
  resetPlayer();
  resetDecor(0);
  updateSky(0.1);
  requestAnimationFrame(t => { last = t; frame(t); });
  window.__dinoReady = true;
  $('#loading').classList.add('weg');
  setTimeout(() => $('#loading').remove(), 500);
  show('scrMenu');
  if (!save.help) {
    save.help = true;
    store();
    setTimeout(() => $('#help').showModal(), 600);
  }
  const raum = new URLSearchParams(location.search).get('raum');
  if (raum) {   // Einladungs-Link: direkt in den Raum
    $('#help').open && $('#help').close();
    openMp().then(ok => {
      $('#mpCode').value = raum.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      if (ok && save.name) $('#bJoin').click();
      else $('#mpName').focus();
    });
  }
}

// Für Tests (werkzeuge/dinotest.mjs) – verrät nichts, ändert nur dieses Spiel
window.dino = {
  get phase() { return G.phase; }, get screen() { return G.screen; }, get d() { return P.d; }, get coins() { return P.coins; },
  get frames() { return G.frames; }, get objs() { return objs.length; }, get ghosts() { return ghosts.size; }, get lane() { return P.lane; },
  get save() { return save; }, netz,
  debug: {
    kill: () => { if (G.phase === 'run') crash(); },
    give: n => { save.coins += n; store(); refreshCoins(); },
    meteor: from => incomingMeteor(from || 'Test'),
    power: k => activate(k),
    act,
  },
};

boot();
