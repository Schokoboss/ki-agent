// Weltmodelle aus Blender (models/welt/*.glb) laden und für Instanzierung aufbereiten.
import * as THREE from '../lib/three.module.min.js';
import { GLTFLoader } from '../lib/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../lib/libs/meshopt_decoder.module.js';
import { mergeGeometries } from '../lib/utils/BufferGeometryUtils.js';

export const WORLD_MODELS = ['pine_a', 'pine_b', 'leaf_a', 'leaf_b', 'palm', 'rock_a', 'rock_b', 'rock_c',
  'house_a', 'house_b', 'house_c', 'house_d', 'house_e', 'house_f', 'farmhouse', 'barn',
  'lamp', 'fence', 'cone', 'hay', 'poster', 'ramp', 'stage', 'tent', 'ferris', 'arch', 'tower',
  'person_a', 'person_b', 'boat', 'turbine'];

const LIB = {};

export async function loadWorldModels(onProgress = () => {}) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  await MeshoptDecoder.ready;
  let done = 0;
  await Promise.all(WORLD_MODELS.map(n => loader.loadAsync(`models/welt/${n}.glb`)
    .then(g => { LIB[n] = g.scene; g.scene.updateMatrixWorld(true); })
    .catch(e => console.warn('Weltmodell fehlt', n, e))
    .finally(() => onProgress(++done / WORLD_MODELS.length))));
}

export const has = n => !!LIB[n];
export const scene = n => LIB[n];

function toFloat(g) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = g.attributes[name]; if (!a) continue;
    const k = a.itemSize, arr = new Float32Array(a.count * k);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < k; c++) arr[i * k + c] = a.getComponent(i, c);
    out.setAttribute(name, new THREE.BufferAttribute(arr, k));
  }
  if (g.index) out.setIndex(Array.from(g.index.array));
  return out;
}
function colored(g, mat, glow = 0.8) {
  const c = mat.color ? mat.color.clone() : new THREE.Color(1, 1, 1);
  if (mat.emissive && mat.emissive.getHex()) c.add(mat.emissive.clone().multiplyScalar(glow));
  const n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}
function nodeName(o, root) { while (o && o.parent && o.parent !== root) o = o.parent; return o ? o.name : ''; }

// Alle Teile eines Modells (oder nur bestimmte Materialien/Knoten) zu EINER Geometrie mit Vertexfarben
export function merged(name, { mat = null, notMat = null, node = null, notNode = null, matrix = null } = {}) {
  const root = LIB[name];
  if (!root) return null;
  const list = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    const mn = o.material.name, nn = nodeName(o, root);
    if (mat && !mat.includes(mn)) return;
    if (notMat && notMat.includes(mn)) return;
    if (node && !node.includes(nn)) return;
    if (notNode && notNode.includes(nn)) return;
    const g = toFloat(o.geometry).applyMatrix4(o.matrixWorld);
    if (matrix) g.applyMatrix4(matrix);
    list.push(colored(g, o.material));
  });
  if (!list.length) return null;
  const out = mergeGeometries(list);
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

// Kopie eines Modells mit eigenen Materialien (für Einzelstücke wie Bühne/Riesenrad)
export function clone(name) {
  const s = LIB[name];
  if (!s) return null;
  const c = s.clone(true);
  c.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return c;
}

// Einzelnes Teil (Knoten) eines Modells als Geometrie, inkl. UV (z. B. Plakat-Fläche)
export function nodeGeometry(name, nodeName_) {
  const root = LIB[name];
  if (!root) return null;
  let g = null;
  root.traverse(o => { if (!g && o.isMesh && nodeName(o, root) === nodeName_) g = toFloat(o.geometry).applyMatrix4(o.matrixWorld); });
  return g;
}
