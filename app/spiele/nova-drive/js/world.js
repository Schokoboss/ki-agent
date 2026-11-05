// 3D-Welt: Gelände, Straßen, Wasser, Himmel, Bäume, Stadt, Festival, Deko, Tag/Nacht.
import * as THREE from '../lib/three.module.min.js';
import { HALF, N, CELL, FESTIVAL } from './terrain.js';
import { part, merge, Builder } from './geo.js';
import { clamp, lerp, smoothstep, fbm, perlin, mulberry32 } from './util.js';
import { drawLed } from './textures.js';
import { has, merged, clone, nodeGeometry, scene as modelScene } from './models.js';

const lin = v => Math.pow(v, 2.2);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _c = new THREE.Color();

export const EVENT_COLORS = { race: '#7a6bff', trap: '#ff9a1f', drift: '#ff3d9a', jump: '#ffd400' };

export class Scenery {
  constructor(scene, world, T, quality) {
    this.scene = scene; this.world = world; this.T = T; this.q = quality;
    this.time = 17.2; // Startzeit: später Nachmittag
    this.night = 0;
    this.instances = {};
    this.beacons = [];
    this.glowPts = [];
  }

  build() {
    this.buildSkyAndLights();
    this.buildTerrain();
    this.buildRoads();
    this.buildWater();
    this.buildTreesM();
    this.buildRocksM();
    this.buildBuildingsM();
    this.buildLampsM();
    this.buildFestivalM();
    this.buildRampsM();
    this.buildSmashablesM();
    this.buildCrowd();
    this.buildBoats();
    this.buildTurbines();
    this.buildClouds();
    this.buildGlows();
    this.buildGates();
  }

  // ---------------------------------------------------------------- Himmel & Licht
  buildSkyAndLights() {
    const s = this.scene;
    this.sunDir = new THREE.Vector3(0.4, 0.5, 0.3).normalize();
    this.skyU = {
      zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunCol: { value: new THREE.Color() },
      sunDir: { value: this.sunDir }, night: { value: 0 },
    };
    const sky = new THREE.Mesh(new THREE.SphereGeometry(2600, 32, 16), new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w*0.99999; }`,
      fragmentShader: `uniform vec3 zenith, horizon, sunCol, sunDir; uniform float night; varying vec3 vDir;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        void main(){
          vec3 d = normalize(vDir);
          float y = max(d.y, 0.0);
          vec3 col = mix(horizon, zenith, pow(y, 0.55));
          if (d.y < 0.0) col = horizon * (1.0 + d.y * 0.6);
          float sd = max(dot(d, sunDir), 0.0);
          col += sunCol * (pow(sd, 6.0) * 0.35 + pow(sd, 64.0) * 0.6);
          col += sunCol * smoothstep(0.9993, 0.9997, sd) * 4.0;
          // Sterne
          if (night > 0.01 && d.y > 0.0) {
            vec2 g = floor(d.xz / (d.y + 0.35) * 220.0);
            float st = step(0.996, h21(g)) * night * smoothstep(0.0, 0.3, d.y);
            col += vec3(st);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.sky = sky; s.add(sky);

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a5a30, 1.2);
    s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    if (this.q >= 1) {
      this.sun.castShadow = true;
      const ms = this.q >= 2 ? 2048 : 1024;
      this.sun.shadow.mapSize.set(ms, ms);
      const c = this.sun.shadow.camera;
      c.left = -55; c.right = 55; c.top = 55; c.bottom = -55; c.near = 5; c.far = 600;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.04;
    }
    s.add(this.sun); s.add(this.sun.target);
    s.fog = new THREE.Fog(0xb8dcf5, 250, this.q >= 2 ? 1700 : this.q >= 1 ? 1300 : 850);
  }

  setTime(h) {
    this.time = ((h % 24) + 24) % 24;
    const K = TOD;
    let a = K[0], b = K[1];
    for (let i = 0; i < K.length - 1; i++) if (this.time >= K[i].h && this.time <= K[i + 1].h) { a = K[i]; b = K[i + 1]; break; }
    const t = (this.time - a.h) / Math.max(1e-3, b.h - a.h);
    const mix = (k) => _c.set(a[k]).lerp(new THREE.Color(b[k]), t).clone();
    const u = this.skyU;
    u.zenith.value.copy(mix('zen')); u.horizon.value.copy(mix('hor')); u.sunCol.value.copy(mix('sun'));
    const el = Math.sin((this.time - 6.3) / 13.6 * Math.PI); // -1…1
    const az = (this.time / 24) * Math.PI * 2 + 0.6;
    const elA = el * 1.05;
    this.sunDir.set(Math.cos(az) * Math.cos(elA), Math.sin(elA), Math.sin(az) * Math.cos(elA)).normalize();
    this.night = 1 - smoothstep(-0.08, 0.14, el);
    u.night.value = this.night;
    const sunI = lerp(a.sunI, b.sunI, t), hemiI = lerp(a.amb, b.amb, t);
    this.sun.intensity = sunI > 0.02 ? sunI : 0.35;
    this.sun.color.copy(sunI > 0.02 ? u.sunCol.value : new THREE.Color(0x8fa8ff));
    this.lightDir = el > 0 ? this.sunDir.clone() : new THREE.Vector3(-this.sunDir.x, Math.max(0.3, -this.sunDir.y), -this.sunDir.z).normalize();
    this.hemi.intensity = hemiI;
    this.hemi.color.copy(u.zenith.value).lerp(new THREE.Color(0xffffff), 0.45);
    this.hemi.groundColor.set(0x4a5530).multiplyScalar(0.3 + 0.7 * (1 - this.night));
    this.scene.fog.color.copy(u.horizon.value);
    if (this.waterU) {
      this.waterU.fogColor.value.copy(u.horizon.value);
      this.waterU.sunCol.value.copy(u.sunCol.value).multiplyScalar(sunI > 0.05 ? 1 : 0.3);
      this.waterU.skyCol.value.copy(u.zenith.value).lerp(u.horizon.value, 0.5);
      this.waterU.night.value = this.night;
    }
    if (this.facadeMat) this.facadeMat.emissiveIntensity = this.night * 1.4;
    if (this.winLitMat) this.winLitMat.emissiveIntensity = this.night * 1.3;
    if (this.lampHeadMat) this.lampHeadMat.color.set(this.night > 0.3 ? 0xfff0c0 : 0x9a9a9a);
    if (this.glowMat) this.glowMat.opacity = this.night * 0.9;
    if (this.cloudMat) {
      this.cloudMat.color.copy(u.horizon.value).lerp(new THREE.Color(0xffffff), 0.6 * (1 - this.night));
      this.cloudMat.opacity = 0.85 - this.night * 0.6;
    }
  }

  // ---------------------------------------------------------------- Gelände
  buildTerrain() {
    const w = this.world;
    const step = this.q >= 2 ? 6.5 : this.q >= 1 ? 8 : 11;
    const M = Math.round((2 * HALF) / step);
    const st = (2 * HALF) / M;
    const C = 4, per = Math.ceil(M / C);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: this.T.ground });
    this.terrainMat = mat;
    const col = [0, 0, 0];
    for (let cj = 0; cj < C; cj++) for (let ci = 0; ci < C; ci++) {
      const i0 = ci * per, i1 = Math.min(M, (ci + 1) * per), j0 = cj * per, j1 = Math.min(M, (cj + 1) * per);
      const nx = i1 - i0 + 1, nz = j1 - j0 + 1;
      const pos = new Float32Array(nx * nz * 3), nor = new Float32Array(nx * nz * 3), cl = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
      let k = 0;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++, k++) {
        const x = -HALF + i * st, z = -HALF + j * st;
        let h = w.baseAt(x, z);
        const e = w.edgeAt(x, z);
        const gx = (w.baseAt(x + 2, z) - w.baseAt(x - 2, z)) / 4, gz = (w.baseAt(x, z + 2) - w.baseAt(x, z - 2)) / 4;
        const slope = Math.hypot(gx, gz);
        if (e < 1.8) h -= 0.45;
        groundColor(w, x, z, h, e, slope, col);
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
        const l = Math.hypot(gx, 1, gz);
        nor[k * 3] = -gx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -gz / l;
        cl[k * 3] = col[0]; cl[k * 3 + 1] = col[1]; cl[k * 3 + 2] = col[2];
        uv[k * 2] = x / 9; uv[k * 2 + 1] = z / 9;
      }
      const idx = [];
      for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(cl, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  // ---------------------------------------------------------------- Straßen
  buildRoads() {
    const T = this.T;
    const mats = {
      asphalt: new THREE.MeshLambertMaterial({ map: T.asphalt }),
      dirt: new THREE.MeshLambertMaterial({ map: T.dirt }),
    };
    let order = 0;
    for (const r of this.world.roads) {
      const p = r.path, hw = r.def.hw, b = new Builder();
      const cnt = p.closed ? p.n + 1 : p.n;
      const vScale = r.def.type === 'dirt' ? 14 : 24;
      for (let k = 0; k < cnt; k++) {
        const i = k % p.n;
        const x = p.x[i], z = p.z[i], y = p.y[i] + 0.06, rx = -p.tz[i], rz = p.tx[i];
        const v = (k * p.ds) / vScale;
        b.v(x - rx * (hw + 0.6), y - 1.6, z - rz * (hw + 0.6), -rx, 0.3, -rz, 0.6, 0.6, 0.6, 0, v);
        b.v(x - rx * hw, y, z - rz * hw, 0, 1, 0, 1, 1, 1, 0, v);
        b.v(x + rx * hw, y, z + rz * hw, 0, 1, 0, 1, 1, 1, 1, v);
        b.v(x + rx * (hw + 0.6), y - 1.6, z + rz * (hw + 0.6), rx, 0.3, rz, 0.6, 0.6, 0.6, 1, v);
        if (k > 0) {
          const a = (k - 1) * 4, c = k * 4;
          b.quad(a, a + 1, c + 1, c); b.quad(a + 1, a + 2, c + 2, c + 1); b.quad(a + 2, a + 3, c + 3, c + 2);
        }
      }
      const mat = mats[r.def.type].clone();
      mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -2 - order * 2;
      const m = new THREE.Mesh(b.build(), mat);
      m.receiveShadow = true;
      m.renderOrder = 1 + order;
      order++;
      this.scene.add(m);
    }
    // Festival-Platz
    const F = FESTIVAL;
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(F.r, 64), new THREE.MeshLambertMaterial({
      map: T.plaza, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -30,
    }));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(F.x, this.world.heightAt(F.x, F.z) + 0.08, F.z);
    plaza.receiveShadow = true;
    plaza.renderOrder = 20;
    this.scene.add(plaza);
  }

  // ---------------------------------------------------------------- Wasser
  buildWater() {
    const w = this.world, S = 512;
    const data = new Uint8Array(S * S * 4);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = -HALF + (i + 0.5) / S * 2 * HALF, z = -HALF + (j + 0.5) / S * 2 * HALF;
      const h = w.baseAt(x, z);
      const k = (j * S + i) * 4;
      data[k] = clamp(-h / 14, 0, 1) * 255;
      data[k + 1] = clamp((h + 3) / 6, 0, 1) * 255; // Uferzone
      data[k + 3] = 255;
    }
    const dt = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    dt.magFilter = THREE.LinearFilter; dt.minFilter = THREE.LinearFilter; dt.needsUpdate = true;
    this.waterU = {
      depth: { value: dt }, time: { value: 0 }, sunDir: { value: this.sunDir }, sunCol: { value: new THREE.Color(1, 1, 1) },
      skyCol: { value: new THREE.Color(0.6, 0.8, 1) }, fogColor: { value: new THREE.Color() },
      fogNear: { value: 250 }, fogFar: { value: 1500 }, night: { value: 0 }, uHalf: { value: HALF },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.waterU, transparent: true, depthWrite: false,
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform sampler2D depth; uniform float time, fogNear, fogFar, night, uHalf; uniform vec3 sunDir, sunCol, skyCol, fogColor; varying vec3 vW;
        void main(){
          vec2 uv = (vW.xz + uHalf) / (2.0*uHalf);
          float inside = step(0.0, uv.x)*step(uv.x, 1.0)*step(0.0, uv.y)*step(uv.y, 1.0);
          vec4 dd = texture2D(depth, clamp(uv, 0.0, 1.0));
          float d = mix(1.0, dd.r, inside);
          float shore = mix(0.0, dd.g, inside);
          vec2 p = vW.xz;
          float t = time;
          vec3 n = normalize(vec3(
            sin(p.x*0.11 + t*1.3)*0.18 + sin(p.x*0.37 - p.y*0.21 + t*2.1)*0.08 + sin(p.y*0.9+t*3.)*0.03,
            1.0,
            cos(p.y*0.13 + t*1.1)*0.18 + cos(p.y*0.41 + p.x*0.27 + t*1.7)*0.08 + cos(p.x*0.8-t*2.6)*0.03));
          vec3 V = normalize(cameraPosition - vW);
          vec3 deep = vec3(0.01, 0.10, 0.22), shallow = vec3(0.05, 0.55, 0.55);
          vec3 col = mix(shallow, deep, smoothstep(0.0, 0.55, d));
          float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
          col = mix(col, skyCol, clamp(fres*0.85 + 0.12, 0.0, 1.0));
          vec3 R = reflect(-sunDir, n);
          col += sunCol * pow(max(dot(R, V), 0.0), 180.0) * 2.2 * step(0.0, sunDir.y);
          float foam = smoothstep(0.07, 0.0, d) * (0.55 + 0.45*sin(d*90.0 - t*2.5 + p.x*0.05));
          col = mix(col, vec3(0.92), clamp(foam, 0.0, 1.0)*0.75);
          col *= 1.0 - night*0.75;
          float alpha = mix(0.55, 0.97, smoothstep(0.0, 0.12, d));
          float fd = length(cameraPosition - vW);
          col = mix(col, fogColor, smoothstep(fogNear, fogFar, fd));
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), mat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0;
    water.renderOrder = 5;
    water.frustumCulled = false;
    this.water = water;
    this.scene.add(water);
  }

  // ---------------------------------------------------------------- Bäume
  buildTrees() {
    const pine = merge([
      part(new THREE.CylinderGeometry(0.16, 0.28, 2.4, 6), '#5b4029', 0, 1.2, 0),
      part(new THREE.ConeGeometry(2.1, 3.4, 7), '#2d5a31', 0, 3.3, 0),
      part(new THREE.ConeGeometry(1.65, 3.0, 7), '#336636', 0, 5.0, 0, 0, 0.4),
      part(new THREE.ConeGeometry(1.1, 2.4, 7), '#3a723c', 0, 6.6, 0, 0, 0.8),
    ]);
    const leaf = merge([
      part(new THREE.CylinderGeometry(0.2, 0.32, 2.8, 6), '#5e4630', 0, 1.4, 0),
      part(new THREE.IcosahedronGeometry(2.3, 0), '#4f8a36', 0, 4.3, 0),
      part(new THREE.IcosahedronGeometry(1.7, 0), '#5c9a3e', 1.0, 5.3, 0.4, 0.5, 0.3),
      part(new THREE.IcosahedronGeometry(1.6, 0), '#47803a', -0.9, 4.9, -0.6, 0.2, 0.9),
    ]);
    const palmParts = [];
    let px = 0, py = 0;
    for (let i = 0; i < 5; i++) {
      palmParts.push(part(new THREE.CylinderGeometry(0.2 - i * 0.015, 0.24 - i * 0.015, 1.6, 6), '#8a6a45', px, py + 0.8, 0, 0, 0, -0.06 - i * 0.04));
      px += Math.sin(0.06 + i * 0.04) * 1.6; py += 1.55;
    }
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * Math.PI * 2;
      palmParts.push(part(new THREE.BoxGeometry(3.2, 0.06, 0.7), '#3f8f3f', px + Math.cos(a) * 1.5, py - 0.3, Math.sin(a) * 1.5, 0, -a, -0.45));
    }
    const palm = merge(palmParts);
    const geos = [pine, leaf, palm];
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const C = 6, size = (2 * HALF) / C;
    const buckets = new Map();
    for (const t of this.world.trees) {
      const k = (Math.floor((t.x + HALF) / size) * C + Math.floor((t.z + HALF) / size)) * 3 + t.type;
      let a = buckets.get(k); if (!a) buckets.set(k, a = []);
      a.push(t);
    }
    const rnd = mulberry32(5);
    this.treeChunks = [];
    for (const [k, list] of buckets) {
      const type = k % 3;
      const im = new THREE.InstancedMesh(geos[type], mat, list.length);
      list.forEach((t, i) => {
        _m.compose(_p.set(t.x, t.y - 0.2, t.z), _q.setFromEuler(_e.set(0, t.rot, 0)), _s.set(t.s, t.s * (0.9 + rnd() * 0.3), t.s));
        im.setMatrixAt(i, _m);
        const v = 0.8 + rnd() * 0.35;
        im.setColorAt(i, _c.setRGB(v * (0.95 + rnd() * 0.1), v, v * (0.9 + rnd() * 0.1)));
      });
      im.computeBoundingSphere();
      im.castShadow = this.q >= 2;
      im.receiveShadow = false;
      this.scene.add(im);
      this.treeChunks.push(im);
    }
  }

  buildRocks() {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const pa = g.attributes.position, rnd = mulberry32(9);
    const seen = new Map();
    for (let i = 0; i < pa.count; i++) {
      const key = `${pa.getX(i).toFixed(3)},${pa.getY(i).toFixed(3)},${pa.getZ(i).toFixed(3)}`;
      let f = seen.get(key); if (f === undefined) { f = 0.75 + rnd() * 0.5; seen.set(key, f); }
      pa.setXYZ(i, pa.getX(i) * f, pa.getY(i) * f * 0.75, pa.getZ(i) * f);
    }
    g.computeVertexNormals();
    const rocks = this.world.rocks;
    const im = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0x8a8580, flatShading: true }), Math.max(1, rocks.length));
    rocks.forEach((r, i) => {
      _m.compose(_p.set(r.x, r.y + r.s * 0.2, r.z), _q.setFromEuler(_e.set(r.tilt, r.rot, 0)), _s.set(r.s, r.s, r.s));
      im.setMatrixAt(i, _m);
      im.setColorAt(i, _c.setRGB(0.8 + rnd() * 0.2, 0.78 + rnd() * 0.2, 0.75 + rnd() * 0.2));
    });
    im.count = rocks.length;
    im.computeBoundingSphere();
    im.castShadow = this.q >= 1;
    this.scene.add(im);
  }

  // ---------------------------------------------------------------- Häuser
  buildBuildings() {
    const b = new Builder();
    const wallCol = new THREE.Color(), roofCol = new THREE.Color();
    const rnd = mulberry32(3);
    // Gruppe 0: Fassaden mit Fenstern
    b.group(0);
    const walls = [], roofs = [];
    for (const B of this.world.buildings) {
      const c = Math.cos(B.yaw), s = Math.sin(B.yaw);
      const P = (lx, lz, y) => [B.x + lx * c + lz * s, y, B.z - lx * s + lz * c];
      const hw = B.w / 2, hd = B.d / 2, y0 = B.y - 3, y1 = B.y + B.h;
      if (B.farm) wallCol.setHSL(0.0 + rnd() * 0.03, 0.55, 0.42);
      else wallCol.setHSL(B.hue, 0.32 + rnd() * 0.2, 0.72 + rnd() * 0.12);
      wallCol.convertSRGBToLinear();
      const sides = [
        [P(-hw, hd, y0), P(hw, hd, y0), P(hw, hd, y1), P(-hw, hd, y1), B.w],
        [P(hw, hd, y0), P(hw, -hd, y0), P(hw, -hd, y1), P(hw, hd, y1), B.d],
        [P(hw, -hd, y0), P(-hw, -hd, y0), P(-hw, -hd, y1), P(hw, -hd, y1), B.w],
        [P(-hw, -hd, y0), P(-hw, hd, y0), P(-hw, hd, y1), P(-hw, -hd, y1), B.d],
      ];
      const list = B.farm ? roofs : walls;
      for (const [a, bb, cc, d, len] of sides) {
        const u1 = Math.max(1, Math.round(len / 3.4)) / 2, v0 = -3 / 7, v1 = B.h / 7;
        list.push([a, bb, cc, d, wallCol.clone(), [[0, v0], [u1, v0], [u1, v1], [0, v1]]]);
      }
      // Dach
      roofCol.setHSL(B.farm ? 0.6 : 0.02 + rnd() * 0.04, B.farm ? 0.05 : 0.5, B.farm ? 0.35 : 0.38).convertSRGBToLinear();
      if (B.roof) {
        const rh = Math.min(B.w, B.d) * 0.38, o = 0.5;
        const alongX = B.w > B.d;
        if (alongX) {
          roofs.push([P(-hw - o, hd + o, y1), P(hw + o, hd + o, y1), P(hw + o, 0, y1 + rh), P(-hw - o, 0, y1 + rh), roofCol.clone()]);
          roofs.push([P(hw + o, -hd - o, y1), P(-hw - o, -hd - o, y1), P(-hw - o, 0, y1 + rh), P(hw + o, 0, y1 + rh), roofCol.clone()]);
          roofs.push([P(hw, hd, y1), P(hw, -hd, y1), P(hw, 0, y1 + rh), P(hw, 0, y1 + rh), wallCol.clone()]);
          roofs.push([P(-hw, -hd, y1), P(-hw, hd, y1), P(-hw, 0, y1 + rh), P(-hw, 0, y1 + rh), wallCol.clone()]);
        } else {
          roofs.push([P(hw + o, hd + o, y1), P(hw + o, -hd - o, y1), P(0, -hd - o, y1 + rh), P(0, hd + o, y1 + rh), roofCol.clone()]);
          roofs.push([P(-hw - o, -hd - o, y1), P(-hw - o, hd + o, y1), P(0, hd + o, y1 + rh), P(0, -hd - o, y1 + rh), roofCol.clone()]);
          roofs.push([P(-hw, hd, y1), P(hw, hd, y1), P(0, hd, y1 + rh), P(0, hd, y1 + rh), wallCol.clone()]);
          roofs.push([P(hw, -hd, y1), P(-hw, -hd, y1), P(0, -hd, y1 + rh), P(0, -hd, y1 + rh), wallCol.clone()]);
        }
      } else {
        const top = new THREE.Color(0.25, 0.25, 0.27);
        roofs.push([P(-hw, hd, y1 + 0.01), P(hw, hd, y1 + 0.01), P(hw, -hd, y1 + 0.01), P(-hw, -hd, y1 + 0.01), top]);
        roofs.push([P(-hw * 0.3, hd * 0.3, y1 + 1.6), P(hw * 0.3, hd * 0.3, y1 + 1.6), P(hw * 0.3, -hd * 0.3, y1 + 1.6), P(-hw * 0.3, -hd * 0.3, y1 + 1.6), new THREE.Color(0.5, 0.5, 0.5)]);
        for (const [x0, z0, x1, z1] of [[-0.3, 0.3, 0.3, 0.3], [0.3, 0.3, 0.3, -0.3], [0.3, -0.3, -0.3, -0.3], [-0.3, -0.3, -0.3, 0.3]])
          roofs.push([P(hw * x0, hd * z0, y1), P(hw * x1, hd * z1, y1), P(hw * x1, hd * z1, y1 + 1.6), P(hw * x0, hd * z0, y1 + 1.6), new THREE.Color(0.45, 0.45, 0.45)]);
      }
    }
    for (const [a, bb, cc, d, col, uv] of walls) b.face(a, bb, cc, d, col, uv);
    b.group(1);
    for (const [a, bb, cc, d, col] of roofs) b.face(a, bb, cc, d, col);
    const facade = new THREE.MeshLambertMaterial({ vertexColors: true, map: this.T.facade, emissiveMap: this.T.facadeGlow, emissive: 0xffffff, emissiveIntensity: 0 });
    this.facadeMat = facade;
    const plain = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(b.build(), [facade, plain]);
    mesh.castShadow = this.q >= 1; mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  // ---------------------------------------------------------------- Laternen
  buildLamps() {
    const L = this.world.lamps;
    if (!L.length) return;
    const pole = merge([
      part(new THREE.CylinderGeometry(0.09, 0.14, 7.5, 6), '#5a5f66', 0, 3.75, 0),
      part(new THREE.BoxGeometry(0.1, 0.1, 1.8), '#5a5f66', 0, 7.4, 0.85),
    ]);
    const head = new THREE.BoxGeometry(0.35, 0.14, 0.8);
    const im = new THREE.InstancedMesh(pole, new THREE.MeshLambertMaterial({ vertexColors: true }), L.length);
    this.lampHeadMat = new THREE.MeshBasicMaterial({ color: 0x9a9a9a });
    const ih = new THREE.InstancedMesh(head, this.lampHeadMat, L.length);
    L.forEach((l, i) => {
      _q.setFromEuler(_e.set(0, l.yaw, 0));
      _m.compose(_p.set(l.x, l.y, l.z), _q, _s.set(1, 1, 1));
      im.setMatrixAt(i, _m);
      const hx = l.x + Math.sin(l.yaw) * 1.7, hz = l.z + Math.cos(l.yaw) * 1.7;
      _m.compose(_p.set(hx, l.y + 7.3, hz), _q, _s.set(1, 1, 1));
      ih.setMatrixAt(i, _m);
      this.glowPts.push([hx, l.y + 7.1, hz, 1.0, 0.85, 0.55, 9]);
    });
    im.computeBoundingSphere(); ih.computeBoundingSphere();
    im.castShadow = this.q >= 2;
    this.scene.add(im, ih);
  }

  // ---------------------------------------------------------------- Festival
  buildFestival() {
    const F = this.world.festival, T = this.T, w = this.world;
    const g = new THREE.Group();
    const dark = new THREE.MeshLambertMaterial({ color: 0x24242c });
    const metal = new THREE.MeshLambertMaterial({ color: 0x9aa0aa });
    // Bühne
    const st = F.stage, y0 = w.baseAt(st.x, st.z);
    const stage = new THREE.Group();
    stage.position.set(st.x, y0, st.z);
    const box = (wd, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(wd, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; stage.add(m); return m; };
    box(st.w, 1.6, st.d, dark, 0, 0.8, 0);
    box(st.w, st.h, 1, dark, 0, st.h / 2, st.d / 2 - 0.5);
    box(st.w + 3, 0.8, st.d + 2, dark, 0, st.h + 0.4, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.8, st.h, 0.8, metal, sx * (st.w / 2 + 1), st.h / 2, sz * (st.d / 2 + 0.5));
    for (const sx of [-1, 1]) { box(4, 6, 3, dark, sx * (st.w / 2 + 4), 3, -st.d / 2 + 2); box(3.4, 4, 2.6, dark, sx * (st.w / 2 + 4), 8, -st.d / 2 + 2); }
    const led = new THREE.Mesh(new THREE.PlaneGeometry(26, 13), new THREE.MeshBasicMaterial({ map: T.led }));
    led.position.set(0, 8.6, st.d / 2 - 1.05); led.rotation.y = Math.PI;
    stage.add(led);
    this.stageLights = [];
    for (let i = 0; i < 8; i++) {
      const beam = new THREE.Mesh(new THREE.ConeGeometry(2.2, 40, 12, 1, true), new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(i / 8, 1, 0.6), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      beam.geometry.translate(0, -20, 0);
      const holder = new THREE.Group();
      holder.position.set(-st.w / 2 + 3 + i * (st.w - 6) / 7, st.h, -2);
      holder.add(beam);
      stage.add(holder);
      this.stageLights.push(holder);
    }
    g.add(stage);
    // Torbogen
    const ay = w.baseAt(F.arch.x, F.arch.z);
    const arch = new THREE.Group();
    arch.position.set(F.arch.x, ay, F.arch.z);
    for (const sx of [-13, 13]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(2.6, 13, 2.6), new THREE.MeshLambertMaterial({ color: 0xffffff }));
      p.position.set(sx, 6.5, 0); p.castShadow = true; arch.add(p);
    }
    const beamM = new THREE.Mesh(new THREE.BoxGeometry(29, 3.6, 2.6), new THREE.MeshLambertMaterial({ color: 0x1a1a22 }));
    beamM.position.set(0, 13.6, 0); beamM.castShadow = true; arch.add(beamM);
    for (const side of [1, -1]) {
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(27, 3.4), new THREE.MeshBasicMaterial({ map: T.banner }));
      ban.position.set(0, 13.6, side * 1.32); if (side < 0) ban.rotation.y = Math.PI;
      arch.add(ban);
    }
    g.add(arch);
    // Zelte
    const tentMat = new THREE.MeshLambertMaterial({ map: T.tent });
    const tentBase = new THREE.MeshLambertMaterial({ color: 0xf4f0e8 });
    for (const t of F.tents) {
      const ty = w.baseAt(t.x, t.z);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(t.r - 0.6, t.r - 0.6, 3, 16), tentBase);
      base.position.set(t.x, ty + 1.5, t.z);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(t.r, 5, 16), tentMat);
      roof.position.set(t.x, ty + 5.5, t.z);
      base.castShadow = roof.castShadow = true;
      g.add(base, roof);
      this.glowPts.push([t.x, ty + 8.4, t.z, 1, 0.4, 0.7, 6]);
    }
    // Lichttürme
    this.towerBeams = [];
    for (const [i, t] of F.towers.entries()) {
      const ty = w.baseAt(t.x, t.z);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 18, 0.7), metal);
      m.position.set(t.x, ty + 9, t.z); m.castShadow = true;
      const head = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 1.0), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      head.position.set(t.x, ty + 18.5, t.z);
      g.add(m, head);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 7, 160, 12, 1, true), new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(i / 6, 0.9, 0.6), transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      beam.geometry.translate(0, 80, 0);
      const holder = new THREE.Group(); holder.position.set(t.x, ty + 19, t.z); holder.add(beam);
      g.add(holder);
      this.towerBeams.push(holder);
      this.glowPts.push([t.x, ty + 18.6, t.z, 1, 1, 1, 10]);
    }
    // Riesenrad
    const wh = F.wheel, wy = w.baseAt(wh.x, wh.z);
    const wheel = new THREE.Group();
    wheel.position.set(wh.x, wy, wh.z);
    wheel.rotation.y = Math.PI / 2;
    const R = 20, axisH = R + 4;
    for (const sz of [-3.4, 3.4]) for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, axisH + 2, 0.8), metal);
      leg.position.set(sx * 6, axisH / 2, sz); leg.rotation.z = -sx * 0.25; leg.castShadow = true;
      wheel.add(leg);
    }
    const rot = new THREE.Group(); rot.position.y = axisH; wheel.add(rot);
    const ringMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xff3d9a, emissiveIntensity: 0 });
    this.wheelMat = ringMat;
    for (const z of [-1.4, 1.4]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.3, 6, 48), ringMat); ring.position.z = z; rot.add(ring); }
    this.gondolas = [];
    const gm = [0xff3d7f, 0xffd23f, 0x1fd1ff, 0x7a3dff];
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.2, R, 0.2), metal);
      sp.position.set(Math.cos(a) * R / 2, Math.sin(a) * R / 2, 0); sp.rotation.z = a - Math.PI / 2;
      rot.add(sp);
      const gnd = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.6), new THREE.MeshLambertMaterial({ color: gm[i % 4] }));
      gnd.position.set(Math.cos(a) * R, Math.sin(a) * R - 1.4, 0);
      gnd.castShadow = true;
      rot.add(gnd); this.gondolas.push(gnd);
    }
    this.wheelRot = rot;
    g.add(wheel);
    // Wimpelketten rund um den Platz
    const flagCols = ['#ff3d7f', '#ffd23f', '#1fd1ff', '#7a3dff', '#36e27a'];
    const flags = [];
    for (let i = 0; i < F.towers.length; i++) {
      const a = F.towers[i], b = F.towers[(i + 1) % F.towers.length];
      const ya = w.baseAt(a.x, a.z) + 12, yb = w.baseAt(b.x, b.z) + 12;
      const L = Math.hypot(b.x - a.x, b.z - a.z), cnt = Math.floor(L / 2.2);
      for (let k = 1; k < cnt; k++) {
        const t = k / cnt, x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t), y = lerp(ya, yb, t) - Math.sin(t * Math.PI) * 3.5;
        flags.push(part(new THREE.ConeGeometry(0.45, 1.1, 3), flagCols[k % 5], x, y - 0.55, z, Math.PI, Math.atan2(b.x - a.x, b.z - a.z), 0));
      }
    }
    if (flags.length) g.add(new THREE.Mesh(merge(flags), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    this.scene.add(g);
  }

  // ---------------------------------------------------------------- Schanzen
  buildRamps() {
    for (const r of this.world.ramps) {
      const b = new Builder();
      const S = 12, hw = r.w / 2, white = new THREE.Color(1, 1, 1), side = new THREE.Color(0.35, 0.33, 0.3);
      const hAt = t => r.h * t * t * 0.35 + r.h * t * 0.65;
      for (let i = 0; i < S; i++) {
        const t0 = i / S, t1 = (i + 1) / S, z0 = -r.len / 2 + t0 * r.len, z1 = -r.len / 2 + t1 * r.len;
        const h0 = hAt(t0), h1 = hAt(t1);
        b.face([-hw, h0, z0], [hw, h0, z0], [hw, h1, z1], [-hw, h1, z1], white, [[0, t0 * 3], [2, t0 * 3], [2, t1 * 3], [0, t1 * 3]]);
        b.face([hw, -1, z0], [hw, -1, z1], [hw, h1, z1], [hw, h0, z0], side, [[0, 0], [0, 0], [0, 0], [0, 0]]);
        b.face([-hw, -1, z1], [-hw, -1, z0], [-hw, h0, z0], [-hw, h1, z1], side, [[0, 0], [0, 0], [0, 0], [0, 0]]);
      }
      b.face([hw, -1, r.len / 2], [-hw, -1, r.len / 2], [-hw, r.h, r.len / 2], [hw, r.h, r.len / 2], side, [[0, 0], [0, 0], [0, 0], [0, 0]]);
      const m = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ map: this.T.stripes, vertexColors: true }));
      m.position.set(r.x, r.y, r.z);
      m.rotation.y = r.yaw;
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  // ---------------------------------------------------------------- Zerstörbares
  buildSmashables() {
    const wood = '#8a6a48';
    this.smashGeo = {
      fence: merge([
        part(new THREE.BoxGeometry(0.14, 1.2, 0.14), wood, -1.9, 0.6, 0), part(new THREE.BoxGeometry(0.14, 1.2, 0.14), wood, 1.9, 0.6, 0),
        part(new THREE.BoxGeometry(4, 0.13, 0.06), '#a07a52', 0, 0.55, 0), part(new THREE.BoxGeometry(4, 0.13, 0.06), '#a07a52', 0, 0.98, 0),
      ]),
      cone: merge([
        part(new THREE.ConeGeometry(0.28, 0.75, 10), '#ff6a00', 0, 0.42, 0),
        part(new THREE.CylinderGeometry(0.17, 0.2, 0.12, 10), '#ffffff', 0, 0.42, 0),
        part(new THREE.BoxGeometry(0.6, 0.05, 0.6), '#222222', 0, 0.03, 0),
      ]),
      hay: merge([part(new THREE.CylinderGeometry(0.85, 0.85, 1.5, 12), '#d9b55a', 0, 0.85, 0, 0, 0, Math.PI / 2)]),
      poster: merge([
        part(new THREE.BoxGeometry(0.2, 3.2, 0.2), wood, -2.1, 1.6, -0.12), part(new THREE.BoxGeometry(0.2, 3.2, 0.2), wood, 2.1, 1.6, -0.12),
      ]),
    };
    const board = new THREE.PlaneGeometry(5, 2.6);
    board.translate(0, 3.0, 0);
    this.posterBoardGeo = board;
    this.buildSmashInstances();
  }

  buildSmashInstances() {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.smashMat = mat;
    this.posterMat = new THREE.MeshBasicMaterial({ map: this.posterMap || this.T.poster, side: THREE.DoubleSide });
    // in Blöcke (8×8) aufteilen, damit Entferntes ausgeblendet wird
    const C = 8, size = (2 * HALF) / C, byKey = new Map();
    for (const o of this.world.smash) {
      const k = o.kind + ':' + (Math.floor((o.x + HALF) / size) * C + Math.floor((o.z + HALF) / size));
      let a = byKey.get(k); if (!a) byKey.set(k, a = []);
      a.push(o);
    }
    this.smashChunks = [];
    for (const [key, list] of byKey) {
      const kind = key.split(':')[0];
      const im = new THREE.InstancedMesh(this.smashGeo[kind], mat, list.length);
      let ib = null;
      if (kind === 'poster') ib = new THREE.InstancedMesh(this.posterBoardGeo, this.posterMat, list.length);
      list.forEach((o, i) => {
        o.inst = i; o.im = im; o.ib = ib;
        _m.compose(_p.set(o.x, o.y, o.z), _q.setFromEuler(_e.set(0, o.yaw, 0)), _s.set(1, 1, 1));
        im.setMatrixAt(i, _m);
        if (ib) ib.setMatrixAt(i, _m);
      });
      im.computeBoundingSphere();
      im.castShadow = this.q >= 2 && kind !== 'fence';
      this.scene.add(im);
      if (ib) { ib.computeBoundingSphere(); this.scene.add(ib); }
      this.smashChunks.push(im);
      if (ib) this.smashChunks.push(ib);
    }
    // Trümmer-Pool
    this.debris = [];
    for (let i = 0; i < 36; i++) {
      const m = new THREE.Mesh(this.smashGeo.cone, mat);
      m.visible = false;
      this.scene.add(m);
      this.debris.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0, board: null });
    }
  }

  smashObject(o, vx, vz, speed) {
    o.alive = false;
    _m.makeScale(0, 0, 0);
    o.im.setMatrixAt(o.inst, _m); o.im.instanceMatrix.needsUpdate = true;
    if (o.ib) { o.ib.setMatrixAt(o.inst, _m); o.ib.instanceMatrix.needsUpdate = true; }
    const d = this.debris.find(x => x.life <= 0) || this.debris[0];
    d.m.geometry = this.smashGeo[o.kind];
    d.m.position.set(o.x, o.y, o.z);
    d.m.rotation.set(0, o.yaw, 0);
    d.m.scale.set(1, 1, 1);
    d.m.visible = true;
    const k = Math.min(1.2, 0.5 + speed / 40);
    d.v.set(vx * k + (Math.random() - 0.5) * 4, 3 + speed * 0.18 + Math.random() * 3, vz * k + (Math.random() - 0.5) * 4);
    d.w.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 9);
    d.life = 5;
    if (o.kind === 'poster') {
      if (!d.board) { d.board = new THREE.Mesh(this.posterBoardGeo, this.posterMat); d.m.add(d.board); }
      d.board.visible = true;
    } else if (d.board) d.board.visible = false;
  }

  updateDebris(dt) {
    for (const d of this.debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.v.y -= 18 * dt;
      d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
      const gy = this.world.heightAt(d.m.position.x, d.m.position.z);
      if (d.m.position.y < gy) {
        d.m.position.y = gy; d.v.y = Math.abs(d.v.y) * 0.3; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.6);
      }
      if (d.life < 1) d.m.scale.setScalar(Math.max(0.01, d.life));
      if (d.life <= 0) d.m.visible = false;
    }
  }

  // ================================================================ Blender-Modelle
  procTreeGeos() {
    const pine = merge([
      part(new THREE.CylinderGeometry(0.16, 0.28, 2.4, 6), '#5b4029', 0, 1.2, 0),
      part(new THREE.ConeGeometry(2.1, 3.4, 7), '#2d5a31', 0, 3.3, 0),
      part(new THREE.ConeGeometry(1.65, 3.0, 7), '#336636', 0, 5.0, 0, 0, 0.4),
      part(new THREE.ConeGeometry(1.1, 2.4, 7), '#3a723c', 0, 6.6, 0, 0, 0.8),
    ]);
    const leaf = merge([
      part(new THREE.CylinderGeometry(0.2, 0.32, 2.8, 6), '#5e4630', 0, 1.4, 0),
      part(new THREE.IcosahedronGeometry(2.3, 0), '#4f8a36', 0, 4.3, 0),
      part(new THREE.IcosahedronGeometry(1.7, 0), '#5c9a3e', 1.0, 5.3, 0.4, 0.5, 0.3),
    ]);
    const palm = merge([
      part(new THREE.CylinderGeometry(0.18, 0.24, 8, 5), '#8a6a45', 0.6, 4, 0, 0, 0, -0.12),
      part(new THREE.ConeGeometry(2.6, 1.4, 6), '#3f8f3f', 1.1, 7.8, 0, Math.PI),
    ]);
    return [pine, leaf, palm];
  }

  buildTreesM() {
    if (!has('pine_a')) { this.treeLod = []; return this.buildTrees(); }
    const hi = ['pine_a', 'pine_b', 'leaf_a', 'leaf_b', 'palm'].map(n => merged(n));
    const lo = this.procTreeGeos();
    const loOf = [0, 0, 1, 1, 2], loScale = [1.25, 1.62, 1.35, 1.3, 1.08];
    const matHi = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const matLo = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const C = 8, size = (2 * HALF) / C;
    const buckets = new Map(), rnd = mulberry32(5);
    for (const t of this.world.trees) {
      const v = t.type === 0 ? (rnd() < 0.55 ? 0 : 1) : t.type === 1 ? (rnd() < 0.7 ? 2 : 3) : 4;
      const k = (Math.floor((t.x + HALF) / size) * C + Math.floor((t.z + HALF) / size)) * 5 + v;
      let a = buckets.get(k); if (!a) buckets.set(k, a = []);
      a.push(t);
    }
    this.treeLod = [];
    this.treeChunks = [];
    for (const [k, list] of buckets) {
      const v = k % 5;
      const imH = new THREE.InstancedMesh(hi[v], matHi, list.length);
      const imL = new THREE.InstancedMesh(lo[loOf[v]], matLo, list.length);
      list.forEach((t, i) => {
        const sy = t.s * (0.9 + rnd() * 0.3);
        _q.setFromEuler(_e.set(0, t.rot, 0));
        _m.compose(_p.set(t.x, t.y - 0.15, t.z), _q, _s.set(t.s, sy, t.s));
        imH.setMatrixAt(i, _m);
        _m.compose(_p.set(t.x, t.y - 0.2, t.z), _q, _s.set(t.s * loScale[v], sy * loScale[v], t.s * loScale[v]));
        imL.setMatrixAt(i, _m);
        const c = 0.82 + rnd() * 0.3;
        _c.setRGB(c * (0.95 + rnd() * 0.1), c, c * (0.9 + rnd() * 0.12));
        imH.setColorAt(i, _c); imL.setColorAt(i, _c);
      });
      imH.computeBoundingSphere(); imL.computeBoundingSphere();
      imH.castShadow = this.q >= 1;
      imL.castShadow = false;
      imL.visible = false;
      this.scene.add(imH, imL);
      this.treeLod.push({ hi: imH, lo: imL, c: imH.boundingSphere.center.clone(), r: imH.boundingSphere.radius });
    }
  }

  buildRocksM() {
    if (!has('rock_a')) return this.buildRocks();
    const geos = ['rock_a', 'rock_b', 'rock_c'].map(n => merged(n));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const rnd = mulberry32(9);
    for (let v = 0; v < 3; v++) {
      const list = this.world.rocks.filter((_, i) => i % 3 === v);
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geos[v], mat, list.length);
      list.forEach((r, i) => {
        _m.compose(_p.set(r.x, r.y - r.s * 0.15, r.z), _q.setFromEuler(_e.set(r.tilt * 0.5, r.rot, 0)), _s.set(r.s * 0.95, r.s * 0.95, r.s * 0.95));
        im.setMatrixAt(i, _m);
        const c = 0.85 + rnd() * 0.3;
        im.setColorAt(i, _c.setRGB(c, c * (0.97 + rnd() * 0.05), c * (0.94 + rnd() * 0.06)));
      });
      im.computeBoundingSphere();
      im.castShadow = this.q >= 1; im.receiveShadow = true;
      this.scene.add(im);
    }
  }

  buildBuildingsM() {
    if (!has('house_a')) return this.buildBuildings();
    const byV = {};
    for (const b of this.world.buildings) (byV[b.variant] ||= []).push(b);
    const wallMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const restMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.winLitMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xffc46a, emissiveIntensity: 0 });
    const winDark = new THREE.MeshLambertMaterial({ vertexColors: true });
    const rnd = mulberry32(3);
    for (const v in byV) {
      const list = byV[v];
      const parts = [
        [merged(v, { mat: ['wall'] }), wallMat, list, true],
        [merged(v, { notMat: ['wall', 'window'] }), restMat, list, false],
        [merged(v, { mat: ['window'] }), this.winLitMat, list.filter(b => b.lit), false],
        [merged(v, { mat: ['window'] }), winDark, list.filter(b => !b.lit), false],
      ];
      for (const [geo, mat, items, tint] of parts) {
        if (!geo || !items.length) continue;
        const im = new THREE.InstancedMesh(geo, mat, items.length);
        items.forEach((b, i) => {
          _m.compose(_p.set(b.x, b.y, b.z), _q.setFromEuler(_e.set(0, b.yaw, 0)), _s.set(1, 1, 1));
          im.setMatrixAt(i, _m);
          if (tint) { _c.setHSL(b.hue, 0.35 + rnd() * 0.25, 0.78 + rnd() * 0.1); im.setColorAt(i, _c); }
        });
        im.computeBoundingSphere();
        im.castShadow = this.q >= 1 && tint; im.receiveShadow = true;
        this.scene.add(im);
      }
    }
  }

  buildLampsM() {
    if (!has('lamp')) return this.buildLamps();
    const L = this.world.lamps;
    if (!L.length) return;
    const pole = merged('lamp', { notMat: ['bulb'] }), bulb = merged('lamp', { mat: ['bulb'] });
    const im = new THREE.InstancedMesh(pole, new THREE.MeshLambertMaterial({ vertexColors: true }), L.length);
    this.lampHeadMat = new THREE.MeshBasicMaterial({ color: 0x9a9a9a });
    const ih = new THREE.InstancedMesh(bulb, this.lampHeadMat, L.length);
    L.forEach((l, i) => {
      _m.compose(_p.set(l.x, l.y, l.z), _q.setFromEuler(_e.set(0, l.yaw + Math.PI, 0)), _s.set(1, 1, 1));
      im.setMatrixAt(i, _m); ih.setMatrixAt(i, _m);
      this.glowPts.push([l.x + Math.sin(l.yaw) * 1.9, l.y + 8.35, l.z + Math.cos(l.yaw) * 1.9, 1.0, 0.85, 0.55, 10]);
    });
    im.computeBoundingSphere(); ih.computeBoundingSphere();
    im.castShadow = this.q >= 1;
    this.scene.add(im, ih);
  }

  buildFestivalM() {
    if (!has('stage') || !has('ferris')) return this.buildFestival();
    const F = this.world.festival, T = this.T, w = this.world;
    const g = new THREE.Group();
    // Bühne
    const st = F.stage, y0 = w.baseAt(st.x, st.z);
    const stage = clone('stage');
    stage.position.set(st.x, y0, st.z);
    stage.updateMatrixWorld(true);
    stage.traverse(o => { if (o.isMesh && o.material.name === 'led') { this.ledMap = fixMirror(o, T.led); o.material = new THREE.MeshBasicMaterial({ map: this.ledMap }); o.castShadow = false; } });
    this.stageLights = [];
    for (let i = 0; i < 8; i++) {
      const beam = new THREE.Mesh(new THREE.ConeGeometry(2.2, 40, 12, 1, true), new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(i / 8, 1, 0.6), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      beam.geometry.translate(0, -20, 0);
      const holder = new THREE.Group();
      holder.position.set(-st.w / 2 + 3 + i * (st.w - 6) / 7, st.h + 0.6, -st.d / 2 + 0.5);
      holder.add(beam);
      stage.add(holder);
      this.stageLights.push(holder);
    }
    g.add(stage);
    // Torbogen
    const arch = clone('arch');
    arch.position.set(F.arch.x, w.baseAt(F.arch.x, F.arch.z), F.arch.z);
    arch.updateMatrixWorld(true);
    arch.traverse(o => { if (o.isMesh && o.material.name === 'banner') { o.material = new THREE.MeshBasicMaterial({ map: fixMirror(o, T.banner) }); o.castShadow = false; } });
    g.add(arch);
    // Zelte (Instanzen)
    const tg = merged('tent');
    const tim = new THREE.InstancedMesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), F.tents.length);
    F.tents.forEach((t, i) => {
      const ty = w.baseAt(t.x, t.z);
      _m.compose(_p.set(t.x, ty, t.z), _q.setFromEuler(_e.set(0, Math.atan2(FESTIVAL.x - t.x, FESTIVAL.z - t.z), 0)), _s.set(1, 1, 1));
      tim.setMatrixAt(i, _m);
      this.glowPts.push([t.x, ty + 9.6, t.z, 1, 0.4, 0.7, 6]);
    });
    tim.computeBoundingSphere(); tim.castShadow = true;
    g.add(tim);
    // Lichttürme
    const twg = merged('tower');
    const twm = new THREE.InstancedMesh(twg, new THREE.MeshLambertMaterial({ vertexColors: true }), F.towers.length);
    this.towerBeams = [];
    F.towers.forEach((t, i) => {
      const ty = w.baseAt(t.x, t.z);
      _m.compose(_p.set(t.x, ty, t.z), _q.setFromEuler(_e.set(0, Math.atan2(FESTIVAL.x - t.x, FESTIVAL.z - t.z), 0)), _s.set(1, 1, 1));
      twm.setMatrixAt(i, _m);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 7, 160, 12, 1, true), new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(i / 6, 0.9, 0.6), transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      beam.geometry.translate(0, 80, 0);
      const holder = new THREE.Group(); holder.position.set(t.x, ty + 19, t.z); holder.add(beam);
      g.add(holder);
      this.towerBeams.push(holder);
      this.glowPts.push([t.x, ty + 18.8, t.z, 1, 1, 1, 10]);
    });
    twm.computeBoundingSphere(); twm.castShadow = true;
    g.add(twm);
    // Riesenrad: Rotor dreht, Gondeln bleiben waagerecht (Drehpunkte fest: Achse y = 24, Gondel-Aufhängung)
    const wh = F.wheel;
    const fw = clone('ferris');
    for (const n of ['rotor', 'gondola']) { const o = fw.getObjectByName(n); if (o) o.parent.remove(o); }
    fw.position.set(wh.x, w.baseAt(wh.x, wh.z), wh.z);
    fw.rotation.y = Math.PI / 2;
    const AX = 24, R = 20;
    const rg = merged('ferris', { node: ['rotor'] }).translate(0, -AX, 0);
    const gg = merged('ferris', { node: ['gondola'] });
    gg.computeBoundingBox();
    const gb = gg.boundingBox;
    gg.translate(-(gb.min.x + gb.max.x) / 2, -gb.max.y, -(gb.min.z + gb.max.z) / 2);
    this.wheelMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xff3d9a, emissiveIntensity: 0 });
    const rotor = new THREE.Mesh(rg, this.wheelMat);
    rotor.position.y = AX; rotor.castShadow = true;
    fw.add(rotor);
    this.gondolas = [];
    const cols = [0xff9ab8, 0xffe79a, 0x9ae8ff, 0xc2a8ff];
    const gmats = cols.map(c => new THREE.MeshLambertMaterial({ vertexColors: true, color: c }));
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2;
      const gc = new THREE.Mesh(gg, gmats[i % 4]);
      gc.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
      gc.castShadow = true;
      rotor.add(gc);
      this.gondolas.push(gc);
    }
    this.wheelRot = rotor;
    g.add(fw);
    // Wimpelketten zwischen den Türmen
    const flagCols = ['#ff3d7f', '#ffd23f', '#1fd1ff', '#7a3dff', '#36e27a'];
    const flags = [];
    for (let i = 0; i < F.towers.length; i++) {
      const a = F.towers[i], b = F.towers[(i + 1) % F.towers.length];
      const ya = w.baseAt(a.x, a.z) + 13, yb = w.baseAt(b.x, b.z) + 13;
      const L = Math.hypot(b.x - a.x, b.z - a.z), cnt = Math.floor(L / 2.2);
      for (let k = 1; k < cnt; k++) {
        const t = k / cnt, x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t), y = lerp(ya, yb, t) - Math.sin(t * Math.PI) * 3.5;
        flags.push(part(new THREE.ConeGeometry(0.45, 1.1, 3), flagCols[k % 5], x, y - 0.55, z, Math.PI, Math.atan2(b.x - a.x, b.z - a.z), 0));
      }
    }
    if (flags.length) g.add(new THREE.Mesh(merge(flags), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    // Absperrung vor den Zuschauern
    const cr = F.crowd;
    if (cr && has('fence')) {
      const fg = merged('fence'), n = Math.ceil(cr.hx * 2 / 4);
      const fm = new THREE.InstancedMesh(fg, new THREE.MeshLambertMaterial({ vertexColors: true }), n);
      for (let i = 0; i < n; i++) {
        const x = cr.x - cr.hx + 2 + i * 4, z = cr.z - cr.hz - 0.2;
        _m.compose(_p.set(x, w.baseAt(x, z), z), _q.identity(), _s.set(1, 1, 1));
        fm.setMatrixAt(i, _m);
      }
      fm.computeBoundingSphere();
      g.add(fm);
    }
    this.scene.add(g);
  }

  buildRampsM() {
    if (!has('ramp')) return this.buildRamps();
    const geo = merged('ramp');
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    for (const r of this.world.ramps) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(r.x, r.y + 0.3, r.z);
      m.rotation.y = r.yaw;
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  buildSmashablesM() {
    if (!has('fence') || !has('poster')) return this.buildSmashables();
    this.smashGeo = { fence: merged('fence'), cone: merged('cone'), hay: merged('hay'), poster: merged('poster', { notNode: ['board'] }) };
    this.posterBoardGeo = nodeGeometry('poster', 'board') || new THREE.PlaneGeometry(5, 2.6).translate(0, 3, 0);
    this.posterMap = fixMirror(new THREE.Mesh(this.posterBoardGeo), this.T.poster);
    this.buildSmashInstances();
  }

  // ---------- Zuschauer, Boote, Windräder
  buildCrowd() {
    const C = this.world.festival.crowd;
    if (!C || !has('person_a')) return;
    const rnd = mulberry32(21), items = [[], []];
    for (let z = C.z - C.hz + 1; z < C.z + C.hz - 0.5; z += 1.25) {
      for (let x = C.x - C.hx + 1; x < C.x + C.hx - 0.5; x += 1.05) {
        if (rnd() > 0.5) continue;
        const v = rnd() < 0.45 ? 1 : 0;
        items[v].push({ x: x + (rnd() - 0.5) * 0.5, z: z + (rnd() - 0.5) * 0.5, yaw: (rnd() - 0.5) * 0.6, ph: rnd() * 6.28, s: 0.9 + rnd() * 0.2, hue: rnd() });
      }
    }
    this.crowd = [];
    const clothMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const restMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    ['person_a', 'person_b'].forEach((n, v) => {
      const list = items[v];
      if (!list.length) return;
      const cloth = new THREE.InstancedMesh(merged(n, { mat: ['cloth'] }), clothMat, list.length);
      const rest = new THREE.InstancedMesh(merged(n, { notMat: ['cloth'] }), restMat, list.length);
      list.forEach((p, i) => {
        p.y = this.world.baseAt(p.x, p.z);
        cloth.setColorAt(i, _c.setHSL(p.hue, 0.75, 0.55));
        const skin = [0.95, 0.8, 0.62, 0.45][Math.floor(p.hue * 97) % 4];
        rest.setColorAt(i, _c.setRGB(skin + 0.05, skin, skin));
      });
      cloth.castShadow = rest.castShadow = this.q >= 2;
      this.scene.add(cloth, rest);
      this.crowd.push({ list, meshes: [cloth, rest] });
    });
    this.animCrowd(0, 0);
    for (const c of this.crowd) for (const m of c.meshes) { m.computeBoundingSphere(); m.boundingSphere.radius += 2; }
  }
  animCrowd(t, beat) {
    for (const c of this.crowd || []) {
      c.list.forEach((p, i) => {
        const j = Math.max(0, Math.sin(t * 6.5 + p.ph)) * (0.12 + beat * 0.25);
        _m.compose(_p.set(p.x, p.y + j, p.z), _q.setFromEuler(_e.set(0, p.yaw + Math.sin(t * 1.3 + p.ph) * 0.15, 0)), _s.set(p.s, p.s, p.s));
        for (const m of c.meshes) m.setMatrixAt(i, _m);
      });
      for (const m of c.meshes) m.instanceMatrix.needsUpdate = true;
    }
  }

  buildBoats() {
    const B = this.world.boats;
    if (!B || !B.length || !has('boat')) return;
    this.boatIM = new THREE.InstancedMesh(merged('boat'), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), B.length);
    this.boatIM.castShadow = true;
    this.boatIM.frustumCulled = false;
    this.scene.add(this.boatIM);
    this.animBoats(0);
  }
  animBoats(t) {
    if (!this.boatIM) return;
    this.world.boats.forEach((b, i) => {
      const a = t * 0.01 * b.speed + b.phase, rr = b.lake ? 18 : 60;
      const x = b.x + Math.cos(a) * rr, z = b.z + Math.sin(a) * rr;
      _m.compose(_p.set(x, Math.sin(t * 0.9 + b.phase) * 0.25 - 0.15, z),
        _q.setFromEuler(_e.set(Math.sin(t * 0.7 + b.phase) * 0.05, a + Math.PI, Math.sin(t * 1.1 + b.phase) * 0.07 + 0.08)), _s.set(1, 1, 1));
      this.boatIM.setMatrixAt(i, _m);
    });
    this.boatIM.instanceMatrix.needsUpdate = true;
  }

  buildTurbines() {
    const T = this.world.turbines;
    if (!T || !T.length || !has('turbine')) return;
    const base = merged('turbine', { notNode: ['rotor'] });
    const pivot = new THREE.Vector3(0, 63.2, 3.4); // wie in werkstatt/welt.py
    const rot = merged('turbine', { node: ['rotor'] }).translate(-pivot.x, -pivot.y, -pivot.z);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const im = new THREE.InstancedMesh(base, mat, T.length);
    this.rotors = [];
    T.forEach((t, i) => {
      _m.compose(_p.set(t.x, t.y - 0.3, t.z), _q.setFromEuler(_e.set(0, t.yaw, 0)), _s.set(1, 1, 1));
      im.setMatrixAt(i, _m);
      const holder = new THREE.Group();
      holder.position.set(t.x, t.y - 0.3, t.z); holder.rotation.y = t.yaw;
      const r = new THREE.Mesh(rot, mat); r.position.copy(pivot); r.rotation.z = t.phase; r.castShadow = true;
      holder.add(r); this.scene.add(holder);
      this.rotors.push(r);
      this.glowPts.push([t.x + Math.sin(t.yaw) * -0.5, t.y + 64.5, t.z + Math.cos(t.yaw) * -0.5, 1, 0.1, 0.1, 6]);
    });
    im.computeBoundingSphere(); im.castShadow = true;
    this.scene.add(im);
  }

  // ---------------------------------------------------------------- Wolken, Leuchtpunkte
  buildClouds() {
    this.cloudMat = new THREE.SpriteMaterial({ map: this.T.cloud, transparent: true, depthWrite: false, fog: false, opacity: 0.85 });
    const rnd = mulberry32(11);
    this.clouds = [];
    const n = this.q >= 1 ? 26 : 12;
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(this.cloudMat);
      const sc = 280 + rnd() * 380;
      s.scale.set(sc, sc * 0.4, 1);
      s.position.set((rnd() * 2 - 1) * 2100, 380 + rnd() * 260, (rnd() * 2 - 1) * 2100);
      s.renderOrder = -5;
      this.scene.add(s); this.clouds.push(s);
    }
  }

  buildGlows() {
    const pts = this.glowPts;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(pts.length * 3), col = new Float32Array(pts.length * 3), size = new Float32Array(pts.length);
    pts.forEach((p, i) => { pos.set(p.slice(0, 3), i * 3); col.set(p.slice(3, 6), i * 3); size[i] = p[6]; });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    this.glowMat = makePointMaterial(this.T.glow, true);
    this.glowMat.opacity = 0;
    const p = new THREE.Points(g, this.glowMat);
    p.frustumCulled = false;
    this.scene.add(p);
  }

  // ---------------------------------------------------------------- Events: Lichtsäulen & Tore
  addBeacon(x, z, color, icon) {
    const y = this.world.heightAt(x, z);
    const mat = new THREE.MeshBasicMaterial({ map: this.T.beam, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, opacity: 0.9 });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 220, 16, 1, true), mat);
    m.position.set(x, y + 110, z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(7, 8.2, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.25, z);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(icon, color), depthWrite: false, fog: false }));
    sp.scale.set(7, 7, 1); sp.position.set(x, y + 9, z);
    this.scene.add(m, ring, sp);
    const b = { m, ring, sp, x, z, y };
    this.beacons.push(b);
    return b;
  }

  buildGates() {
    this.gates = [];
    for (let k = 0; k < 2; k++) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: k ? 0x8a7bff : 0x1fe0ff, transparent: true, opacity: k ? 0.45 : 0.95 });
      const pyl = new THREE.CylinderGeometry(0.45, 0.6, 7, 10);
      const a = new THREE.Mesh(pyl, mat), b = new THREE.Mesh(pyl, mat);
      a.position.y = b.position.y = 3.5;
      const top = new THREE.Mesh(new THREE.BoxGeometry(1, 0.9, 0.5), mat);
      top.position.y = 7.2;
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(1, 7), new THREE.MeshBasicMaterial({
        map: this.T.beam, color: k ? 0x8a7bff : 0x1fe0ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      beam.position.y = 3.5;
      g.add(a, b, top, beam);
      g.userData = { a, b, top, beam };
      g.visible = false;
      this.scene.add(g);
      this.gates.push(g);
    }
  }

  setGate(k, x, z, y, tx, tz, width, finish) {
    const g = this.gates[k];
    if (x === null) { g.visible = false; return; }
    g.visible = true;
    g.position.set(x, y, z);
    g.rotation.y = Math.atan2(tx, tz);
    const u = g.userData;
    u.a.position.x = -width / 2; u.b.position.x = width / 2;
    u.top.scale.x = width; u.beam.scale.x = width;
    const col = finish ? 0xffffff : (k ? 0x8a7bff : 0x1fe0ff);
    u.a.material.color.set(col);
    u.beam.material.color.set(finish ? 0xffd23f : col);
  }

  // ---------------------------------------------------------------- pro Bild
  update(dt, t, camPos, beat, playerPos) {
    this.waterU.time.value = t;
    this.water.position.x = Math.round(camPos.x / 50) * 50;
    this.water.position.z = Math.round(camPos.z / 50) * 50;
    this.sky.position.copy(camPos);
    const ld = this.lightDir || this.sunDir;
    this.sun.position.set(playerPos.x + ld.x * 300, playerPos.y + ld.y * 300, playerPos.z + ld.z * 300);
    this.sun.target.position.copy(playerPos);
    this.waterU.fogNear.value = this.scene.fog.near; this.waterU.fogFar.value = this.scene.fog.far;
    for (const c of this.clouds) { c.position.x += dt * 4; if (c.position.x > 2200) c.position.x = -2200; }
    // Baum-Blöcke: nah = Blender-Modell, fern = einfache Form, hinter dem Nebel aus
    const fogFar = this.scene.fog.far;
    for (const im of this.treeChunks || []) {
      const bs = im.boundingSphere;
      im.visible = Math.hypot(bs.center.x - camPos.x, bs.center.z - camPos.z) < fogFar + bs.radius;
    }
    for (const im of this.smashChunks || []) {
      const bs = im.boundingSphere;
      im.visible = Math.hypot(bs.center.x - camPos.x, bs.center.z - camPos.z) < Math.min(fogFar, 700) + bs.radius;
    }
    const lodD = this.q >= 2 ? 420 : this.q >= 1 ? 300 : 180;
    for (const L of this.treeLod || []) {
      const d = Math.hypot(L.c.x - camPos.x, L.c.z - camPos.z) - L.r;
      L.hi.visible = d < lodD;
      L.lo.visible = !L.hi.visible && d < fogFar;
    }
    if (this.rotors) for (const r of this.rotors) r.rotation.z -= dt * 0.9;
    this.animBoats(t);
    // Festival
    const nearFest = Math.hypot(camPos.x - FESTIVAL.x, camPos.z - FESTIVAL.z) < 700;
    if (this.wheelRot) {
      this.wheelRot.rotation.z += dt * 0.08;
      for (const g of this.gondolas) g.rotation.z = -this.wheelRot.rotation.z;
      this.wheelMat.emissiveIntensity = this.night * 0.9;
    }
    if (nearFest) {
      this._crT = (this._crT || 0) + dt;
      if (this._crT > 1 / 30) { this._crT = 0; this.animCrowd(t, beat); }
      this._ledT = (this._ledT || 0) + dt;
      if (this._ledT > 0.1) { this._ledT = 0; drawLed(this.T, t, beat); if (this.ledMap) this.ledMap.needsUpdate = true; }
      this.stageLights.forEach((h, i) => { h.rotation.z = Math.sin(t * 1.3 + i) * 0.6; h.rotation.x = -0.5 + Math.cos(t * 0.9 + i * 0.7) * 0.35; });
      this.towerBeams.forEach((h, i) => { h.rotation.z = Math.sin(t * 0.4 + i * 1.3) * 0.45; h.rotation.x = Math.cos(t * 0.33 + i) * 0.45; h.children[0].material.opacity = 0.05 + this.night * 0.2; });
    }
    for (const b of this.beacons) {
      const d = Math.hypot(camPos.x - b.x, camPos.z - b.z);
      const vis = b.hidden ? 0 : 1;
      b.m.material.opacity = vis * clamp((d - 30) / 120, 0, 1) * 0.85;
      b.m.visible = b.m.material.opacity > 0.01;
      b.ring.visible = b.sp.visible = vis > 0 && d < 500;
      b.ring.rotation.z += dt;
      b.sp.position.y = b.y + 9 + Math.sin(t * 2 + b.x) * 0.6;
    }
    this.updateDebris(dt);
  }
}

// Punkte-Material mit Größe pro Punkt (Leuchten, Partikel)
// Canvas-Textur auf einer Blender-Fläche lesbar ausrichten (glTF: Bildzeilen von oben → flipY aus;
// dann prüfen, ob Bild-oben nach oben zeigt und ob es gespiegelt ist)
export function fixMirror(mesh, map) {
  const g = mesh.geometry, P = g.attributes.position, U = g.attributes.uv;
  const m = map.clone();
  m.flipY = false;
  m.wrapS = m.wrapT = THREE.RepeatWrapping;
  m.needsUpdate = true;
  if (!U) return m;
  mesh.updateMatrixWorld(true);
  const ix = g.index ? [g.index.getX(0), g.index.getX(1), g.index.getX(2)] : [0, 1, 2];
  const p = ix.map(i => new THREE.Vector3().fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld));
  const u = ix.map(i => new THREE.Vector2().fromBufferAttribute(U, i));
  const e1 = p[1].clone().sub(p[0]), e2 = p[2].clone().sub(p[0]);
  const du1 = u[1].x - u[0].x, dv1 = u[1].y - u[0].y, du2 = u[2].x - u[0].x, dv2 = u[2].y - u[0].y;
  const r = 1 / ((du1 * dv2 - du2 * dv1) || 1e-6);
  const T = e1.clone().multiplyScalar(dv2).sub(e2.clone().multiplyScalar(dv1)).multiplyScalar(r); // Richtung +u
  const Bv = e2.clone().multiplyScalar(du1).sub(e1.clone().multiplyScalar(du2)).multiplyScalar(r); // Richtung +v
  const N = e1.clone().cross(e2).normalize();
  let up = Bv.clone().negate(); // flipY aus: Bild-oben = −v
  let flipV = false, flipU = false;
  if (up.y < 0) { flipV = true; up.negate(); }
  if (T.clone().cross(up).dot(N) < 0) flipU = true;
  m.repeat.set(flipU ? -1 : 1, flipV ? -1 : 1);
  m.offset.set(flipU ? 1 : 0, flipV ? 1 : 0);
  return m;
}

export function makePointMaterial(map, additive) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, opacity: { value: 1 }, scale: { value: 600 } },
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, vertexColors: true,
    vertexShader: `attribute float size; varying vec3 vC; uniform float scale; void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = size*scale/max(1.0,-mv.z); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D map; uniform float opacity; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a*opacity); if (gl_FragColor.a < 0.01) discard; }`,
  });
}

function iconTexture(icon, color) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = color; g.beginPath(); g.arc(64, 64, 56, 0, 7); g.fill();
  g.lineWidth = 8; g.strokeStyle = '#fff'; g.stroke();
  g.fillStyle = '#fff'; g.font = 'bold 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(icon, 64, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function groundColor(w, x, z, h, e, slope, out) {
  const n1 = fbm(x / 210, z / 210, 3), n2 = perlin(x / 31, z / 31);
  let r = 0.33 + 0.1 * n1 + 0.03 * n2, g = 0.53 + 0.08 * n1 + 0.035 * n2, b = 0.2 + 0.04 * n1;
  const sx = (x - 620) / 260, sz = (z + 470) / 220;
  const dry = clamp(smoothstep(0.05, 0.5, n1) * 0.45 + Math.exp(-(sx * sx + sz * sz)) * 1.2, 0, 1);
  r = lerp(r, 0.72, dry); g = lerp(g, 0.58, dry); b = lerp(b, 0.34, dry);
  const fx = (x - 610) / 220, fz = (z + 90) / 260, forest = Math.exp(-(fx * fx + fz * fz));
  r = lerp(r, 0.22, forest * 0.6); g = lerp(g, 0.4, forest * 0.6); b = lerp(b, 0.16, forest * 0.6);
  const rock = Math.max(smoothstep(0.5, 0.9, slope), smoothstep(90, 135, h) * 0.7);
  r = lerp(r, 0.5 + 0.05 * n2, rock); g = lerp(g, 0.48 + 0.05 * n2, rock); b = lerp(b, 0.46 + 0.05 * n2, rock);
  const snow = smoothstep(118, 134, h + n2 * 10) * (1 - smoothstep(0.9, 1.4, slope) * 0.7);
  r = lerp(r, 0.95, snow); g = lerp(g, 0.96, snow); b = lerp(b, 1.0, snow);
  const sand = smoothstep(3.6, 1.9, h);
  r = lerp(r, 0.88, sand); g = lerp(g, 0.8, sand); b = lerp(b, 0.6, sand);
  if (h < -0.3) { const d = clamp(-h / 10, 0, 1); r = lerp(0.75, 0.3, d); g = lerp(0.7, 0.4, d); b = lerp(0.52, 0.38, d); }
  if (e < 3.5 && h > -0.3) {
    const k = smoothstep(3.5, 0.6, e);
    const dirt = w.RT[0] !== undefined && w.surfaceAt(x, z) === 2;
    r = lerp(r, dirt ? 0.55 : 0.56, k); g = lerp(g, dirt ? 0.42 : 0.52, k); b = lerp(b, dirt ? 0.28 : 0.45, k);
  }
  out[0] = lin(r); out[1] = lin(g); out[2] = lin(b);
}

// Tageszeit-Schlüsselbilder
const TOD = [
  { h: 0, zen: '#02040e', hor: '#0b1430', sun: '#000000', sunI: 0, amb: 0.35 },
  { h: 5.2, zen: '#060b24', hor: '#1d2048', sun: '#ff6a3a', sunI: 0, amb: 0.4 },
  { h: 6.4, zen: '#2c4a8c', hor: '#ff9a6a', sun: '#ffa060', sunI: 0.9, amb: 0.7 },
  { h: 8.5, zen: '#3b7dd6', hor: '#a9d2f2', sun: '#fff0d8', sunI: 2.2, amb: 1.15 },
  { h: 13, zen: '#2f72cf', hor: '#bfe0f7', sun: '#ffffff', sunI: 2.6, amb: 1.25 },
  { h: 17, zen: '#3a6cc0', hor: '#f3cf9a', sun: '#ffe2b0', sunI: 2.3, amb: 1.1 },
  { h: 18.8, zen: '#2e4590', hor: '#ff9258', sun: '#ffa060', sunI: 1.6, amb: 0.85 },
  { h: 19.9, zen: '#1a2260', hor: '#d0526a', sun: '#ff6a40', sunI: 0.6, amb: 0.6 },
  { h: 21, zen: '#060a22', hor: '#1c1d48', sun: '#000000', sunI: 0, amb: 0.4 },
  { h: 24, zen: '#02040e', hor: '#0b1430', sun: '#000000', sunI: 0, amb: 0.35 },
];
