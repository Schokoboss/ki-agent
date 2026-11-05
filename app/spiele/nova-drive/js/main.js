// Nova Drive – Spielablauf, Kamera, Menüs, Garage, Karte, Speichern, Herausforderungen.
import * as THREE from '../lib/three.module.min.js';
import { World, FESTIVAL, HALF } from './terrain.js';
import { Scenery } from './world.js';
import { makeTextures } from './textures.js';
import { buildCar, styleDims, loadCarModels, setTailGlow } from './carmodel.js';
import { Vehicle, carContact } from './physics.js';
import { Traffic } from './ai.js';
import { Events, Skills, TYPE_NAMES } from './events.js';
import { HUD, makeMapImage } from './hud.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { Particles, Smoke, Skids } from './effects.js';
import { CARS, UPGRADES, carStats, rating, carClass, CLASS_COLORS, EVENTS, RADIO, TIPS } from './data.js';
import { clamp, lerp, damp, fmtNum, fmtTime, wrapAngle } from './util.js';
import { EVENT_COLORS } from './world.js';

const SAVE_KEY = 'novadrive-save-v1', SET_KEY = 'novadrive-settings-v1';
const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* voll/privat */ } },
};
const P = {};
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

class Game {
  constructor() {
    this.save = Object.assign({ credits: 25000, fans: 0, owned: {}, current: null, best: {}, stars: {}, posters: [], races: 0, wins: 0 }, store.get(SAVE_KEY) || {});
    this.settings = Object.assign({ quality: 'auto', control: 'buttons', autoGas: false, sfx: 0.8, music: 0.45, station: 0, cam: 0, name: '', difficulty: 1, time: 'dyn' }, store.get(SET_KEY) || {});
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 1100);
    this.mobile = mobile;
    this.quality = this.settings.quality === 'auto' ? (mobile ? 1 : 2) : +this.settings.quality;
    this.state = 'loading';
    this.screen = null;
    this.camMode = this.settings.cam || 0;
    this.shake = 0; this.time = 0;
    this.waypoint = null;
    this.challenge = parseChallenge();
    this.nearMap = new Map();
    this.smashChain = 0;
  }

  // ---------------------------------------------------------------- Start
  async boot() {
    const bar = $('load-bar'), msg = $('load-msg');
    const prog = (p, m) => { bar.style.width = (p * 100).toFixed(0) + '%'; if (m) msg.textContent = m + ' …'; };
    $('load-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    await frame();
    const R = this.renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: this.quality >= 2, powerPreference: 'high-performance' });
    this.maxPR = Math.min(window.devicePixelRatio || 1, this.quality >= 2 ? 2 : this.quality >= 1 ? 1.5 : 1);
    this.pr = this.maxPR;
    R.setPixelRatio(this.pr);
    R.setSize(innerWidth, innerHeight);
    R.toneMapping = THREE.ACESFilmicToneMapping;
    R.toneMappingExposure = 1.05;
    R.outputColorSpace = THREE.SRGBColorSpace;
    R.shadowMap.enabled = this.quality >= 1;
    R.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 3000);
    this.T = makeTextures(Math.min(8, R.capabilities.getMaxAnisotropy()));
    // Welt
    this.world = new World(this.quality);
    this.world.events = EVENTS;
    await this.world.generate((p, m) => prog(p * 0.75, m));
    prog(0.78, 'Landschaft bauen');
    await frame();
    this.scenery = new Scenery(this.scene, this.world, this.T, this.quality);
    this.scenery.build();
    this.makeEnv();
    prog(0.88, 'Karte zeichnen');
    await frame();
    this.mapImg = makeMapImage(this.world, this.quality >= 1 ? 1024 : 768);
    this.hud = new HUD(this);
    this.hud.setMap(this.mapImg);
    this.audio = new Audio();
    this.input = new Input();
    this.input.bindTouch(document);
    this.applyControlMode();
    // Effekte
    this.smoke = new Smoke(this.scene, this.T.puff, this.quality >= 1 ? 260 : 140);
    this.sparks = new Particles(this.scene, this.T.glow, 220, true);
    this.skids = new Skids(this.scene, this.quality >= 1 ? 1800 : 900);
    prog(0.9, 'Autos aus der Werkstatt holen');
    await loadCarModels(CARS.map(c => c.id), f => prog(0.9 + f * 0.08, 'Autos aus der Werkstatt holen'));
    // Spieler
    if (!this.save.current || !this.save.owned[this.save.current]) this.save.current = null;
    const spec = this.carSpec() || CARS[0];
    this.car = new Vehicle(this.world, carStats(spec, {}), styleDims(spec.style));
    this.setPlayerCar(spec.id);
    this.traffic = new Traffic(this.scene, this.world, this.quality >= 2 ? 16 : this.quality >= 1 ? 12 : 7);
    this.skills = new Skills(this);
    this.events = new Events(this);
    this.events.init();
    this.spawnAtFestival();
    this.scenery.setTime(this.settings.time === 'dyn' ? 17.2 : TIME_FIXED[this.settings.time] ?? 17.2);
    this.bindUI();
    this.hud.money();
    this.updatePosters();
    prog(1, 'Bereit');
    // Shader vorab übersetzen, damit der Start nicht ruckelt
    R.compile(this.scene, this.camera);
    this.last = performance.now();
    $('loading').classList.add('done');
    setTimeout(() => $('loading').remove(), 700);
    this.showScreen('title');
    requestAnimationFrame(t => this.loop(t));
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.audio.suspend(); if (this.state === 'free' || this.state === 'race') this.pause(); }
      else this.audio.resume();
    });
    this.resize();
  }

  makeEnv() {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const s = new THREE.Scene();
    const geo = new THREE.SphereGeometry(10, 32, 16);
    const col = [];
    const pos = geo.attributes.position;
    const top = new THREE.Color('#5d8fe0'), hor = new THREE.Color('#ffd9b0'), bot = new THREE.Color('#2d3a26');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 10;
      const c = y > 0 ? hor.clone().lerp(top, Math.pow(y, 0.6)) : hor.clone().lerp(bot, Math.min(1, -y * 3));
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const sun = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 7, 6) }));
    sun.position.set(5, 6, 4); s.add(sun);
    this.scene.environment = pm.fromScene(s, 0.02).texture;
    pm.dispose();
  }

  // ---------------------------------------------------------------- Auto
  carSpec(id = this.save.current) { return CARS.find(c => c.id === id); }
  setPlayerCar(id) {
    const spec = this.carSpec(id) || CARS[0];
    const own = this.save.owned[spec.id] || { up: {}, color: spec.colors[0] };
    if (this.carModel) this.scene.remove(this.carModel);
    this.carModel = buildCar(spec, own.color);
    this.carModel.userData.carId = spec.id;
    this.scene.add(this.carModel);
    // Bodenschatten
    const d = styleDims(spec.style);
    if (!this.blob) {
      this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.T.blob, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -20 }));
      this.blob.renderOrder = 24;
      this.scene.add(this.blob);
      this.headL = new THREE.SpotLight(0xfff1d0, 0, 90, 0.5, 0.6, 1.2);
      this.headL.position.set(0, 0.9, 1.2);
      this.headT = new THREE.Object3D(); this.headT.position.set(0, -2, 20);
      this.headL.target = this.headT;
    }
    this.carModel.add(this.headL, this.headT);
    this.blob.scale.set(d.W * 1.6, d.L * 1.35, 1);
    this.car.setDims(d);
    this.car.setStats(carStats(spec, own.up));
    this.carStyle = spec.style;
  }
  rating(id = this.save.current) { const s = this.carSpec(id); return rating(carStats(s, (this.save.owned[id] || {}).up || {})); }

  spawnAtFestival() {
    const F = FESTIVAL;
    this.car.reset(F.x + 18, F.z - 30, Math.PI);
    this.syncCar(0);
  }

  respawn() {
    const c = this.car;
    let best = null;
    if (this.events.race) {
      const r = this.events.race;
      const p = r.path.at(r.pS, P);
      best = { x: p.x, z: p.z, yaw: Math.atan2(p.tx, p.tz) };
    } else {
      let bd = 1e9;
      for (const r of this.world.roads) {
        const h = r.path.closest(c.pos.x, c.pos.z);
        if (h.dist < bd) { bd = h.dist; const p = r.path.at(h.s, P); best = { x: p.x, z: p.z, yaw: Math.atan2(p.tx, p.tz) }; if (Math.cos(best.yaw - c.yaw) < 0) best.yaw += Math.PI; }
      }
    }
    c.reset(best.x, best.z, best.yaw);
    this.skids.cut();
    this.camYaw = best.yaw;
    this.fade();
  }
  fade() { const f = $('fade'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }

  teleport(x, z, yaw) {
    this.car.reset(x, z, yaw);
    this.camYaw = yaw;
    this.skids.cut();
    this.fade();
  }

  // ---------------------------------------------------------------- Belohnung & Level
  level() {
    let f = this.save.fans, L = 1;
    while (f >= 1000 + 260 * L) { f -= 1000 + 260 * L; L++; }
    return { level: L, frac: f / (1000 + 260 * L) };
  }
  reward(cr, fans, toast) {
    const before = this.level().level;
    this.save.credits += cr; this.save.fans += fans;
    const after = this.level().level;
    this.hud.money(cr, fans);
    if (after > before) {
      const bonus = after * 1500;
      this.save.credits += bonus;
      this.hud.banner('Festival-Level ' + after, `+${fmtNum(bonus)} CR`, 3, 'Die Menge jubelt!');
      this.audio.play('win');
      this.hud.money();
    }
    this.saveGame();
  }
  saveGame() { store.set(SAVE_KEY, this.save); }
  saveSettings() { store.set(SET_KEY, this.settings); }

  // Geister (eigene Bestzeit) kompakt speichern
  saveGhost(id, pts, time) {
    const own = this.save.owned[this.save.current] || {};
    store.set('novadrive-ghost-' + id, { car: this.save.current, color: own.color, time, data: encodePts(pts, 1) });
  }
  loadGhost(id) {
    const g = store.get('novadrive-ghost-' + id);
    if (!g) return null;
    try { return { car: g.car, color: g.color, time: g.time, pts: decodePts(g.data, 1), rate: 10 }; } catch { return null; }
  }

  // ---------------------------------------------------------------- Bildschirme
  showScreen(name) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== name;
    this.screen = name;
    const hudOn = !name;
    $('hud').hidden = !hudOn;
    if (name === 'title') { this.state = 'title'; this.titleT = 0; }
    if (name === 'garage') this.openGarage();
    if (name === 'map') this.openMap();
    if (name === 'settings') this.openSettings();
  }
  setState(s) { this.state = s; if (s === 'free' || s === 'race') this.showScreen(null); }

  pause() {
    if (this.state !== 'free' && this.state !== 'race') return;
    this.prevState = this.state;
    this.state = 'paused';
    $('p-abort').hidden = !this.events.race;
    $('p-restart').hidden = !this.events.race;
    this.showScreen('pause');
    this.audio.updateCar(this.car, { throttle: 0 }, false, this.carStyle);
  }
  resume() { this.setState(this.prevState || 'free'); this.last = performance.now(); }

  async goFullscreen() {
    try {
      if (this.mobile && !document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {});
    } catch { /* egal */ }
  }

  bindUI() {
    const click = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', e => { e.preventDefault(); this.audio.init(); this.audio.play('ui'); fn(e); }); };
    // Titel
    click('t-drive', async () => {
      await this.goFullscreen();
      this.audio.init();
      this.audio.setVolumes(this.settings.sfx, this.settings.music);
      this.audio.setStation(this.settings.station);
      if (!this.save.current) { this.showScreen('starter'); this.renderStarter(); return; }
      this.startDriving();
    });
    click('t-garage', () => { if (!this.save.current) { this.showScreen('starter'); this.renderStarter(); return; } this.backTo = 'title'; this.showScreen('garage'); });
    click('t-map', () => { this.backTo = 'title'; this.showScreen('map'); });
    click('t-settings', () => { this.backTo = 'title'; this.showScreen('settings'); });
    // HUD
    click('h-pause', () => this.pause());
    click('h-map', () => { if (this.events.race) return; this.prevState = this.state; this.state = 'paused'; this.backTo = 'game'; this.showScreen('map'); });
    click('h-cam', () => this.cycleCam());
    click('h-radio', () => this.nextStation());
    click('h-reset', () => this.respawn());
    click('prompt-go', () => { const ev = this.events.byId($('prompt').dataset.id); if (ev) this.events.startRace(ev); });
    // Pause
    click('p-resume', () => this.resume());
    click('p-garage', () => { if (this.events.race) this.events.endRace(true); this.backTo = 'game'; this.showScreen('garage'); });
    click('p-map', () => { this.backTo = 'pause'; this.showScreen('map'); });
    click('p-settings', () => { this.backTo = 'pause'; this.showScreen('settings'); });
    click('p-abort', () => { this.events.endRace(true); this.resume(); this.state = 'free'; });
    click('p-restart', () => { const ev = this.events.race.ev, gd = this.events.race.ghostData; this.events.endRace(true); this.events.startRace(ev, gd); });
    click('p-title', () => { if (this.events.race) this.events.endRace(true); this.spawnAtFestival(); this.showScreen('title'); });
    // Ergebnisse
    click('res-continue', () => { this.events.endRace(); this.setState('free'); });
    click('res-again', () => { const r = this.events.race; const ev = r.ev, gd = r.ghostData; this.events.endRace(); this.events.startRace(ev, gd); });
    click('res-share', () => this.shareChallenge());
    // Zurück-Knöpfe
    for (const b of document.querySelectorAll('[data-back]')) b.addEventListener('click', e => { e.preventDefault(); this.audio.play('ui'); this.back(); });
    // Herausforderung
    click('ch-accept', () => this.acceptChallenge());
    click('ch-later', () => { this.challenge = null; this.startDriving(); });
    // Hochformat-Hinweis antippen = Vollbild versuchen
    $('rotate').addEventListener('click', () => this.goFullscreen());
  }

  back() {
    const to = this.backTo;
    if (this.screen === 'settings' || this.screen === 'map' || this.screen === 'garage') {
      if (to === 'title') this.showScreen('title');
      else if (to === 'pause') this.showScreen('pause');
      else { this.setState(this.prevState === 'race' && this.events.race ? 'race' : 'free'); this.last = performance.now(); }
    }
  }

  startDriving() {
    if (this.challenge) { this.showChallenge(); return; }
    this.setState('free');
    this.camYaw = this.car.yaw;
    if (!this.save.welcomed) {
      this.save.welcomed = true; this.saveGame();
      setTimeout(() => this.hud.banner('Willkommen beim Nova Festival!', 'Sonnenküste', 0, 'Fahr zu den Lichtsäulen – dort warten Events.'), 600);
    }
  }

  // ---------------------------------------------------------------- Startauto wählen
  renderStarter() {
    const box = $('starter-cars'); box.innerHTML = '';
    for (const id of ['kestrel', 'tundra', 'velora']) {
      const s = this.carSpec(id), st = carStats(s, {}), r = rating(st), cl = carClass(r);
      const card = document.createElement('button');
      card.className = 'starter-card';
      card.innerHTML = `<div class="cls" style="background:${CLASS_COLORS[cl]}">${cl} ${r}</div><div class="mk"></div><div class="nm"></div><div class="ds"></div>`;
      card.querySelector('.mk').textContent = s.maker;
      card.querySelector('.nm').textContent = s.name;
      card.querySelector('.ds').textContent = { kestrel: 'Wendig & sparsam – der Allrounder', tundra: 'Allrad-Gelände-Monster – überall zu Hause', velora: 'Leichter Hecktriebler – zum Driften geboren' }[id];
      card.addEventListener('click', () => {
        this.audio.play('buy');
        this.save.owned[id] = { up: {}, color: s.colors[0] };
        this.save.current = id;
        this.saveGame();
        this.setPlayerCar(id);
        this.spawnAtFestival();
        this.startDriving();
      });
      box.appendChild(card);
    }
  }

  // ---------------------------------------------------------------- Garage
  openGarage() {
    this.state = 'garage';
    this.garageSel = this.save.current || CARS[0].id;
    this.garageCam = 0;
    this.renderGarage();
  }
  renderGarage() {
    const sel = this.garageSel, spec = this.carSpec(sel), own = this.save.owned[sel];
    // Liste
    const list = $('g-list'); list.innerHTML = '';
    for (const c of CARS) {
      const o = this.save.owned[c.id];
      const r = rating(carStats(c, o ? o.up : {})), cl = carClass(r);
      const b = document.createElement('button');
      b.className = 'g-card' + (c.id === sel ? ' sel' : '') + (o ? ' owned' : '');
      b.innerHTML = `<span class="cls" style="background:${CLASS_COLORS[cl]}">${cl} ${r}</span><span class="mk"></span><span class="nm"></span><span class="pr"></span>`;
      b.querySelector('.mk').textContent = c.maker; b.querySelector('.nm').textContent = c.name;
      b.querySelector('.pr').textContent = o ? (c.id === this.save.current ? '✓ Aktiv' : 'Im Besitz') : fmtNum(c.price) + ' CR';
      b.addEventListener('click', () => { this.audio.play('ui'); this.garageSel = c.id; this.previewCar(c.id); this.renderGarage(); });
      list.appendChild(b);
    }
    // Werte
    const st = carStats(spec, own ? own.up : {}), r = rating(st), cl = carClass(r);
    $('g-name').textContent = `${spec.maker} ${spec.name}`;
    $('g-class').textContent = `${cl} ${r}`; $('g-class').style.background = CLASS_COLORS[cl];
    $('g-drive').textContent = { FWD: 'Frontantrieb', RWD: 'Heckantrieb', AWD: 'Allrad' }[spec.drive];
    const bars = [['Spitze', st.top / 360, Math.round(st.top) + ' km/h'], ['Beschl.', st.accel / 18, ''], ['Haftung', (st.grip - 0.8) / 0.65, ''], ['Lenkung', (st.handling - 0.8) / 0.55, ''], ['Gelände', st.offroad, '']];
    $('g-stats').innerHTML = bars.map(([n, v, t]) => `<div class="stat"><span>${n}</span><div class="bar"><i style="width:${clamp(v, 0.04, 1) * 100}%"></i></div><b>${t}</b></div>`).join('');
    // Upgrades / Kaufen
    const up = $('g-up'); up.innerHTML = '';
    if (own) {
      for (const u of UPGRADES) {
        const lv = own.up[u.key] || 0;
        const b = document.createElement('button');
        b.className = 'g-upg';
        const cost = u.cost[lv];
        b.innerHTML = `<span class="un">${u.name}</span><span class="dots">${[0, 1, 2].map(i => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</span><span class="uc">${lv >= 3 ? 'MAX' : fmtNum(cost) + ' CR'}</span>`;
        b.disabled = lv >= 3 || this.save.credits < cost;
        b.title = u.desc;
        b.addEventListener('click', () => {
          if (lv >= 3 || this.save.credits < cost) return;
          this.save.credits -= cost; own.up[u.key] = lv + 1;
          this.audio.play('buy'); this.saveGame(); this.hud.money();
          if (sel === this.save.current) this.car.setStats(carStats(spec, own.up));
          this.renderGarage();
        });
        up.appendChild(b);
      }
    }
    const cols = $('g-colors'); cols.innerHTML = '';
    for (const col of spec.colors) {
      const b = document.createElement('button');
      b.className = 'swatch' + (own && own.color === col ? ' sel' : ''); b.style.background = col;
      b.addEventListener('click', () => {
        this.audio.play('ui');
        if (own) { own.color = col; this.saveGame(); }
        if (this.previewModel && this.previewModel.userData.paintMat) this.previewModel.userData.paintMat.color.set(col);
        this.renderGarage();
      });
      cols.appendChild(b);
    }
    const act = $('g-action');
    if (!own) {
      act.textContent = `Kaufen · ${fmtNum(spec.price)} CR`;
      act.disabled = this.save.credits < spec.price;
      act.onclick = () => {
        if (this.save.credits < spec.price) return;
        this.save.credits -= spec.price;
        this.save.owned[sel] = { up: {}, color: this.previewColor || spec.colors[0] };
        this.audio.play('buy'); this.saveGame(); this.hud.money();
        this.renderGarage();
      };
    } else if (sel !== this.save.current) {
      act.textContent = 'Dieses Auto fahren'; act.disabled = false;
      act.onclick = () => { this.save.current = sel; this.saveGame(); this.audio.play('ui'); this.renderGarage(); };
    } else { act.textContent = '✓ Dein aktuelles Auto'; act.disabled = true; act.onclick = null; }
    $('g-credits').textContent = fmtNum(this.save.credits) + ' CR';
    if (!this.previewModel || this.previewId !== sel) this.previewCar(sel);
  }
  previewCar(id) {
    const spec = this.carSpec(id), own = this.save.owned[id];
    if (this.previewModel) this.scene.remove(this.previewModel);
    this.previewColor = own ? own.color : spec.colors[0];
    this.previewModel = buildCar(spec, this.previewColor);
    this.previewId = id;
    const p = this.garagePos();
    this.previewModel.position.set(p.x, p.y, p.z);
    this.scene.add(this.previewModel);
    this.carModel.visible = false;
  }
  garagePos() {
    const x = FESTIVAL.x - 30, z = FESTIVAL.z + 10;
    return { x, z, y: this.world.heightAt(x, z) };
  }
  closeGarage() {
    if (this.previewModel) { this.scene.remove(this.previewModel); this.previewModel = null; this.previewId = null; }
    this.carModel.visible = true;
    const x = this.car.pos.x, z = this.car.pos.z, yaw = this.car.yaw, changed = this.carModel.userData.carId !== this.save.current;
    this.setPlayerCar(this.save.current);
    if (changed) this.car.reset(x, z, yaw);
  }

  // ---------------------------------------------------------------- Karte
  openMap() {
    if (this.state !== 'paused') { this.prevState = this.state === 'title' ? 'free' : this.state; }
    const cv = $('map-canvas');
    const draw = () => {
      const W = cv.clientWidth, H = cv.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = W * dpr; cv.height = H * dpr;
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#123a57'; g.fillRect(0, 0, W, H);
      const S = Math.min(W, H) * 1.18;
      const ox = (W - S) / 2, oy = (H - S) / 2;
      g.drawImage(this.mapImg, ox, oy, S, S);
      const P = (x, z) => [ox + (x + HALF) / (2 * HALF) * S, oy + (z + HALF) / (2 * HALF) * S];
      this.mapHits = [];
      for (const ev of this.events.list) {
        const [x, y] = P(ev.type === 'jump' ? ev.ax : ev.x, ev.type === 'jump' ? ev.az : ev.z);
        const r = ev.type === 'race' ? 11 : 8;
        g.fillStyle = EVENT_COLORS[ev.type]; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.stroke();
        g.fillStyle = '#fff'; g.font = `${r}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText({ race: '🏁', trap: '📷', drift: '〰', jump: '⚠' }[ev.type], x, y + 1);
        const st = this.save.stars[ev.id] || 0;
        if (st) { g.fillStyle = '#ffd23f'; g.font = '700 10px sans-serif'; g.fillText('★'.repeat(st), x, y + r + 8); }
        this.mapHits.push({ ev, x, y });
      }
      if (this.waypoint) { const [x, y] = P(this.waypoint.x, this.waypoint.z); g.strokeStyle = '#ffd23f'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 16, 0, 7); g.stroke(); }
      const [px, py] = P(this.car.pos.x, this.car.pos.z);
      g.save(); g.translate(px, py); g.rotate(-this.car.yaw + Math.PI);
      g.fillStyle = '#fff'; g.strokeStyle = '#7a6bff'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, -12); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.fill(); g.stroke();
      g.restore();
      $('map-posters').textContent = `Plakate ${this.save.posters.length}/20 · Sterne ${Object.values(this.save.stars).reduce((a, b) => a + b, 0)}/${this.events.list.length * 3}`;
    };
    this.drawMap = draw;
    requestAnimationFrame(draw);
    $('map-info').hidden = true;
    if (!cv._bound) {
      cv._bound = true;
      cv.addEventListener('click', e => {
        const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        let best = null, bd = 30;
        for (const h of this.mapHits || []) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h.ev; } }
        if (best) this.mapSelect(best); else $('map-info').hidden = true;
      });
    }
  }
  mapSelect(ev) {
    this.audio.play('ui');
    const box = $('map-info'); box.hidden = false;
    $('mi-type').textContent = TYPE_NAMES[ev.type]; $('mi-type').style.background = EVENT_COLORS[ev.type];
    $('mi-name').textContent = ev.name;
    const best = this.save.best[ev.id], st = this.save.stars[ev.id] || 0;
    let info = '';
    if (ev.type === 'race') info = `${ev.sprint ? 'Sprint' : ev.laps + ' Runden'} · ${((ev.sprint ? (ev.to - ev.at) : ev.laps) * ev.path.length / 1000).toFixed(1)} km${best ? ' · Bestzeit ' + fmtTime(best) : ''}`;
    if (ev.type === 'trap') info = `Ziel: ${ev.stars.join(' / ')} km/h${best ? ' · Rekord ' + best + ' km/h' : ''}`;
    if (ev.type === 'drift') info = `Ziel: ${ev.stars.map(fmtNum).join(' / ')} Punkte${best ? ' · Rekord ' + fmtNum(best) : ''}`;
    if (ev.type === 'jump') info = `Ziel: ${ev.stars.join(' / ')} m${best ? ' · Rekord ' + best + ' m' : ''}`;
    $('mi-info').textContent = info;
    $('mi-stars').textContent = '★★★'.slice(0, st) + '☆☆☆'.slice(0, 3 - st);
    $('mi-travel').onclick = () => {
      this.audio.play('ui');
      if (!this.save.current) return;
      let x = ev.x, z = ev.z, yaw = ev.yaw;
      if (ev.type === 'race' || ev.type === 'drift' || ev.type === 'trap') {
        const back = ev.type === 'trap' ? 250 : ev.type === 'drift' ? 60 : 20;
        const p = ev.path.at(ev.s - back, P); x = p.x; z = p.z; yaw = Math.atan2(p.tx, p.tz);
      }
      if (ev.type === 'jump') { x = ev.x - Math.sin(ev.yaw) * 110; z = ev.z - Math.cos(ev.yaw) * 110; }
      this.teleport(x, z, yaw);
      this.waypoint = null;
      if (this.backTo === 'title') { this.backTo = 'game'; this.startDriving(); }
      else this.setState('free');
      this.last = performance.now();
    };
    $('mi-way').onclick = () => {
      this.audio.play('ui');
      this.waypoint = { x: ev.type === 'jump' ? ev.ax : ev.x, z: ev.type === 'jump' ? ev.az : ev.z };
      this.drawMap();
      this.hud.toast('Wegpunkt gesetzt', 'info');
    };
  }

  // ---------------------------------------------------------------- Einstellungen
  openSettings() {
    const s = this.settings;
    const seg = (id, val, fn) => {
      for (const b of $(id).querySelectorAll('button')) {
        b.classList.toggle('sel', b.dataset.v === String(val));
        b.onclick = () => { this.audio.play('ui'); fn(b.dataset.v); this.saveSettings(); this.openSettings(); };
      }
    };
    seg('s-quality', s.quality, v => { s.quality = v; this.hud.toast('Grafik: wird beim nächsten Start aktiv', 'info'); });
    seg('s-control', s.control, async v => {
      s.control = v;
      if (v === 'tilt') { const ok = await this.input.enableTilt(); if (!ok) { s.control = 'buttons'; this.hud.toast('Neigungssensor nicht verfügbar', 'warn'); } }
      this.applyControlMode();
    });
    seg('s-autogas', s.autoGas ? '1' : '0', v => { s.autoGas = v === '1'; this.applyControlMode(); });
    seg('s-diff', s.difficulty, v => { s.difficulty = +v; });
    seg('s-time', s.time, v => { s.time = v; if (v !== 'dyn') this.scenery.setTime(TIME_FIXED[v]); });
    seg('s-station', s.station, v => { s.station = +v; this.audio.setStation(s.station); });
    const sfx = $('s-sfx'), mus = $('s-music'), nm = $('s-name');
    sfx.value = s.sfx; mus.value = s.music; nm.value = s.name;
    sfx.oninput = () => { s.sfx = +sfx.value; this.audio.setVolumes(s.sfx, s.music); this.saveSettings(); };
    mus.oninput = () => { s.music = +mus.value; this.audio.setVolumes(s.sfx, s.music); this.saveSettings(); };
    nm.onchange = () => { s.name = nm.value.trim().slice(0, 16); this.saveSettings(); };
    $('s-reset').onclick = () => {
      if (!confirm('Wirklich alles löschen? Autos, Credits und Rekorde sind dann weg.')) return;
      try { for (const k of Object.keys(localStorage)) if (k.startsWith('novadrive-')) localStorage.removeItem(k); } catch {}
      location.reload();
    };
  }
  applyControlMode() {
    const s = this.settings;
    this.input.mode = s.control; this.input.autoGas = s.autoGas;
    document.body.dataset.control = s.control;
    document.body.dataset.autogas = s.autoGas ? '1' : '0';
    document.body.dataset.touch = this.mobile || matchMedia('(pointer: coarse)').matches ? '1' : '0';
  }
  cycleCam() { this.camMode = (this.camMode + 1) % 3; this.settings.cam = this.camMode; this.saveSettings(); this.hud.toast(['Kamera: Nah', 'Kamera: Weit', 'Kamera: Motorhaube'][this.camMode], 'info'); }
  nextStation() {
    this.settings.station = (this.settings.station + 1) % RADIO.length;
    this.audio.setStation(this.settings.station); this.saveSettings();
    this.hud.toast('📻 ' + RADIO[this.settings.station], 'radio');
  }

  // ---------------------------------------------------------------- Herausforderung per Link
  shareChallenge() {
    const res = this.hud.lastResult, r = this.events.race;
    if (!res || !r) return;
    const evIdx = EVENTS.findIndex(e => e.id === res.ev.id);
    const carIdx = CARS.findIndex(c => c.id === this.save.current);
    const own = this.save.owned[this.save.current] || {};
    const pts = r.ghostRec.filter((_, i) => i % 2 === 0);
    const name = (this.settings.name || 'Ein Freund').slice(0, 16);
    const code = encodeChallenge(evIdx, carIdx, own.color || '#ffffff', res.time, name, pts);
    const url = location.href.split('#')[0] + '#c=' + code;
    const text = `🏁 ${name} fordert dich bei Nova Drive heraus: ${res.ev.name} in ${fmtTime(res.time)}. Schaffst du das?`;
    if (navigator.share) navigator.share({ title: 'Nova Drive – Herausforderung', text, url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text + '\n' + url).then(() => this.hud.toast('Link kopiert – schick ihn deinem Freund!', 'info'), () => prompt('Link kopieren:', url));
    else prompt('Link kopieren:', url);
  }
  showChallenge() {
    const c = this.challenge;
    const ev = EVENTS[c.ev];
    $('ch-text').textContent = `${c.name} fordert dich heraus!`;
    $('ch-info').textContent = `${ev ? ev.name : 'Rennen'} · ${fmtTime(c.time)} · ${CARS[c.car] ? CARS[c.car].maker + ' ' + CARS[c.car].name : ''}`;
    this.showScreen('challenge');
  }
  acceptChallenge() {
    const c = this.challenge; this.challenge = null;
    history.replaceState(null, '', location.href.split('#')[0]);
    const ev = this.events.byId(EVENTS[c.ev] && EVENTS[c.ev].id);
    if (!ev) { this.startDriving(); return; }
    this.setState('free');
    this.events.startRace(ev, { car: CARS[c.car] ? CARS[c.car].id : 'kestrel', color: c.color, time: c.time, pts: c.pts, rate: 5, name: c.name });
  }

  // ---------------------------------------------------------------- Schleife
  loop(now) {
    requestAnimationFrame(t => this.loop(t));
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.perf(dt);
    const inp = this.input.poll();
    if (this.input.took('Escape') || this.input.took('KeyP')) { if (this.state === 'paused' && this.screen === 'pause') this.resume(); else this.pause(); }
    if (this.input.took('KeyC')) this.cycleCam();
    if (this.input.took('KeyM') && this.state === 'free') { this.prevState = 'free'; this.state = 'paused'; this.backTo = 'game'; this.showScreen('map'); }
    if (this.input.took('KeyR') && (this.state === 'free' || this.state === 'race')) this.respawn();
    if (this.input.took('KeyT')) this.nextStation();
    // Tageszeit
    if (this.settings.time === 'dyn' && this.state !== 'paused') this.scenery.setTime(this.scenery.time + dt / 40);
    if (this.state === 'free' || this.state === 'race') this.updateDrive(dt, inp);
    else if (this.state === 'title' || this.state === 'garage') this.updateShowroom(dt);
    if (this.screen === 'garage' && this.state !== 'garage') this.state = 'garage';
    if (this.screen !== 'garage' && this.previewModel) this.closeGarage();
    this.audio.tick(dt);
    const cp = this.camera.position;
    this.scenery.update(dt, this.time, cp, this.audio.beat, this.car.pos);
    this.smoke.update(dt, innerHeight * this.pr * 0.9);
    this.sparks.update(dt, innerHeight * this.pr * 0.9);
    this.fireworks(dt);
    this.renderer.render(this.scene, this.camera);
  }

  updateDrive(dt, raw) {
    const car = this.car, race = this.events.race;
    let inp = raw;
    if (race && !race.started) inp = { throttle: 0, brake: 1, steer: raw.steer, handbrake: true, nitro: false, rev: raw.throttle };
    if (race && race.finished) inp = { throttle: 0.3, brake: 0, steer: 0, handbrake: false, nitro: false };
    // Physik in festen Schritten
    this.acc = (this.acc || 0) + dt;
    const h = 1 / 120;
    let n = 0;
    while (this.acc >= h && n < 8) { car.step(h, inp); this.acc -= h; n++; }
    if (n >= 8) this.acc = 0;
    if (race && !race.started && raw.throttle) car.rpm = damp(car.rpm, 0.85, 6, dt);
    // Windschatten hinter Gegnern
    // Kollisionen mit anderen Autos
    this.carCollisions(dt);
    // Zerstörbares
    const hits = [];
    car.touchSmash(hits);
    for (const o of hits) {
      const spd = Math.hypot(car.vel.x, car.vel.z);
      this.scenery.smashObject(o, car.vel.x, car.vel.z, spd);
      this.audio.play(o.kind === 'cone' ? 'smash' : 'wood');
      if (o.kind === 'poster') this.collectPoster(o);
      else this.skills.add('Zerstörung', o.kind === 'hay' ? 150 : 90);
      for (let i = 0; i < 8; i++) this.smoke.emit(o.x, o.y + 0.8, o.z, (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4, 0.5, 0.85, 0.6, 1.2, 1.2, { drag: 2, grow: 2 });
    }
    // Aufpralle
    for (const im of car.impacts) {
      if (im.force > 2.5) {
        this.audio.play(im.force > 8 ? 'crash' : 'bump', clamp(im.force / 20, 0.2, 1));
        this.shake = Math.max(this.shake, clamp(im.force / 25, 0, 0.8));
        for (let i = 0; i < Math.min(30, im.force * 2); i++) this.sparks.emit(im.x, car.pos.y + 0.5, im.z, (Math.random() - 0.5) * 9, Math.random() * 6, (Math.random() - 0.5) * 9, 1, 0.75, 0.3, 0.35, 0.5, { grav: 12, drag: 1, grow: -0.5 });
        if (im.force > 7) { this.skills.crash(); if (race) race.crashes++; if (navigator.vibrate) navigator.vibrate(40); }
      }
    }
    car.impacts.length = 0;
    if (car.landing > 7) { this.audio.play('land', car.landing); this.shake = Math.max(this.shake, clamp(car.landing / 40, 0, 0.6)); for (let i = 0; i < 12; i++) this.smoke.emit(car.pos.x, car.pos.y + 0.2, car.pos.z, (Math.random() - 0.5) * 8, Math.random() * 2, (Math.random() - 0.5) * 8, 0.6, 0.75, 0.55, 1.5, 1.4, { drag: 2.5, grow: 2.5 }); }
    car.landing = 0;
    // Wasser → zurücksetzen
    if (car.inWater > 0 && !this.splashed) { this.splashed = true; this.audio.play('splash'); for (let i = 0; i < 40; i++) this.sparks.emit(car.pos.x, 0.3, car.pos.z, (Math.random() - 0.5) * 8, 4 + Math.random() * 6, (Math.random() - 0.5) * 8, 0.6, 0.8, 1, 0.6, 1, { grav: 12, drag: 0.5, grow: 0 }); }
    if (car.inWater === 0) this.splashed = false;
    if (car.inWater > 1.3) { this.respawn(); this.skills.crash(); }
    this.skills.update(dt, car);
    this.events.update(dt);
    this.traffic.update(dt, car);
    this.syncCar(dt, inp);
    this.updateCamera(dt, inp);
    this.carEffects(dt, inp);
    this.audio.updateCar(car, raw, true, this.carStyle);
    // HUD
    this.hud.speedo(car);
    const extra = { events: race ? null : this.events.list, ais: race ? race.ais : null, waypoint: race ? null : this.waypoint };
    if (race) {
      extra.route = { path: race.path, from: race.pS, len: Math.min(900, race.startS + race.total - race.pS + (race.path.closed ? 0 : 0)) };
      if (race.path.closed) extra.route.len = Math.min(900, race.total - race.prog);
      const cpS = race.cps[race.next];
      if (cpS !== undefined) { const p = race.path.at(race.startS + cpS, P); extra.cp = { x: p.x, z: p.z }; }
    }
    if (this.waypoint && Math.hypot(this.waypoint.x - car.pos.x, this.waypoint.z - car.pos.z) < 25) { this.waypoint = null; this.hud.toast('Ziel erreicht', 'info'); }
    this.hud.minimap(dt, car, extra);
    if (this.nitroWas !== car.nitroOn) { this.nitroWas = car.nitroOn; if (car.nitroOn) this.audio.play('nitro'); document.body.classList.toggle('nitro', car.nitroOn); }
  }

  carCollisions(dt) {
    const car = this.car, race = this.events.race;
    const pc = car.circles(), r = car.rad;
    const spd = Math.hypot(car.vel.x, car.vel.z);
    const others = [];
    if (race) for (const a of race.ais) others.push({ o: a, ai: true });
    for (const t of this.traffic.cars) if (t.road && t.model.visible) others.push({ o: t, ai: false });
    for (const { o, ai } of others) {
      const dx = o.pos.x - car.pos.x, dz = o.pos.z - car.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 12) { this.nearMap.delete(o); continue; }
      const oc = ai ? o.circles() : this.traffic.circles(o);
      const hit = carContact(pc, oc, r, o.rad);
      let st = this.nearMap.get(o);
      if (!st) { st = { min: 99, contact: false, t: 0 }; this.nearMap.set(o, st); }
      if (hit) {
        st.contact = true;
        const vx = car.vel.x - o.vx, vz = car.vel.z - o.vz;
        const vn = vx * hit.nx + vz * hit.nz;
        const share = ai ? 0.6 : 1;
        car.pos.x += hit.nx * hit.pen * share; car.pos.z += hit.nz * hit.pen * share;
        if (vn < 0) {
          car.vel.x -= hit.nx * vn * 1.2 * share; car.vel.z -= hit.nz * vn * 1.2 * share;
          const f = -vn;
          if (ai) {
            const fwd = Math.sin(o.yaw) * -hit.nx + Math.cos(o.yaw) * -hit.nz;
            o.speed = Math.max(0, o.speed + fwd * f * 0.4 - f * 0.15);
            o.lat += (-hit.nx * -Math.cos(o.yaw) + -hit.nz * Math.sin(o.yaw)) * hit.pen * 0.8;
          } else o.hit = 2;
          if (f > 2) {
            car.impacts.push({ force: f * (ai ? 0.7 : 1), x: car.pos.x + dx * 0.5, z: car.pos.z + dz * 0.5 });
          }
        }
      } else {
        // Knapp vorbei / Windschatten
        const relV = Math.hypot(car.vel.x - o.vx, car.vel.z - o.vz);
        if (d < 5.2 && spd > 16 && relV > 8) st.min = Math.min(st.min, d);
        if (st.min < 5.2 && d > 9) {
          if (!st.contact && performance.now() - st.t > 3000) { st.t = performance.now(); this.skills.add('Knapp vorbei', 350); }
          st.min = 99; st.contact = false;
        }
        if (ai) {
          const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
          const ahead = dx * fx + dz * fz, side = Math.abs(-dx * fz + dz * fx);
          if (ahead > 3 && ahead < 22 && side < 2.2 && spd > 22) {
            const k = 1.6 * dt; car.vel.x += fx * k; car.vel.z += fz * k;
            st.draft = (st.draft || 0) + dt;
            if (st.draft > 1.5) { st.draft = -4; this.skills.add('Windschatten', 250); }
          }
        }
      }
    }
  }

  collectPoster(o) {
    if (!this.save.posters.includes(o.poster)) {
      this.save.posters.push(o.poster);
      const n = this.save.posters.length;
      this.hud.banner('Festival-Plakat', `${n} / 20`, n === 20 ? 3 : 0, n === 20 ? 'Alle gefunden! +50.000 CR' : '+2.500 CR');
      this.reward(2500 + (n === 20 ? 50000 : 0), 400, true);
      this.skills.add('Plakat', 1000);
      this.updatePosters();
    }
  }
  updatePosters() {
    // bereits gesammelte Plakate gar nicht erst anzeigen
    for (const o of this.world.posters) if (this.save.posters.includes(o.poster) && o.alive) {
      o.alive = false;
      const inst = this.scenery.instances.poster;
      _m.makeScale(0, 0, 0); inst.im.setMatrixAt(o.inst, _m); inst.ib.setMatrixAt(o.inst, _m);
      inst.im.instanceMatrix.needsUpdate = inst.ib.instanceMatrix.needsUpdate = true;
    }
    $('posters').textContent = `🎟 ${this.save.posters.length}/20`;
  }

  syncCar(dt, inp = { steer: 0, brake: 0, throttle: 0 }) {
    const car = this.car, m = this.carModel, ud = m.userData;
    m.position.copy(car.pos);
    const up = car.up;
    const f = _v.set(Math.sin(car.yaw), 0, Math.cos(car.yaw));
    f.addScaledVector(up, -f.dot(up)).normalize();
    const x = _v2.crossVectors(up, f).normalize();
    _m.makeBasis(x, up, f);
    m.quaternion.setFromRotationMatrix(_m);
    if (!car.grounded) m.rotateX(clamp(-car.vel.y * 0.02, -0.35, 0.3));
    // Karosserie neigt sich
    const lat = car.yawRate * Math.abs(car.vf);
    this.roll = damp(this.roll || 0, clamp(lat * 0.006, -0.08, 0.08), 6, dt || 0.016);
    const acc = (car.vf - (this.lastVf || 0)) / Math.max(dt, 0.001);
    this.lastVf = car.vf;
    this.pitchV = damp(this.pitchV || 0, clamp(-acc * 0.003, -0.05, 0.05), 5, dt || 0.016);
    ud.bodyG.rotation.set(this.pitchV, 0, -this.roll);
    for (const w of ud.wheels) {
      w.spin.rotation.x = car.wheelRot;
      if (w.front) w.pivot.rotation.y = -car.steer * 0.45;
    }
    setTailGlow(this.carModel, inp.brake > 0 && car.vf > 0.5, this.scenery.night);
    this.headL.intensity = this.scenery.night > 0.3 ? 60 * this.scenery.night : 0;
    // Schatten-Fleck
    const gy = this.world.heightAt(car.pos.x, car.pos.z);
    const hgt = car.pos.y - gy;
    this.blob.position.set(car.pos.x, gy + 0.05, car.pos.z);
    this.blob.rotation.set(-Math.PI / 2, 0, car.yaw, 'YXZ');
    this.blob.rotation.set(-Math.PI / 2, 0, 0);
    this.blob.rotation.z = car.yaw;
    this.blob.material.opacity = clamp(1 - hgt / 6, 0, 1) * 0.9;
  }

  carEffects(dt, inp) {
    const car = this.car, ud = this.carModel.userData, S = this.smoke;
    const spd = Math.abs(car.vf);
    const sy = Math.sin(car.yaw), cy = Math.cos(car.yaw);
    const d = ud.dims;
    // Hinterräder in Weltkoordinaten
    const rear = [];
    for (const sx of [-1, 1]) rear.push(new THREE.Vector3(car.pos.x + sy * -d.wb / 2 + -cy * sx * (d.W / 2 - 0.15), car.pos.y, car.pos.z + cy * -d.wb / 2 + sy * sx * (d.W / 2 - 0.15)));
    const front = [];
    for (const sx of [-1, 1]) front.push(new THREE.Vector3(car.pos.x + sy * d.wb / 2 + -cy * sx * (d.W / 2 - 0.15), car.pos.y, car.pos.z + cy * d.wb / 2 + sy * sx * (d.W / 2 - 0.15)));
    const paved = car.surface === 1;
    const slip = car.grounded ? car.slipAmt : 0;
    // Bremsspuren
    const skidK = paved ? clamp((slip - 0.3) * 1.6, 0, 1) : clamp((slip - 0.2) * 1.2, 0, 0.7);
    rear.forEach((p, i) => this.skids.add(i, p, sy, cy, car.grounded ? skidK : 0));
    front.forEach((p, i) => this.skids.add(i + 2, p, sy, cy, car.grounded && inp.brake && car.vf > 15 ? skidK * 0.7 : 0));
    // Reifenqualm / Staub
    this.smokeT = (this.smokeT || 0) + dt;
    if (this.smokeT > 1 / 40) {
      this.smokeT = 0;
      if (car.grounded && slip > 0.35 && spd > 2 && paved) {
        for (const p of rear) S.emit(p.x, p.y + 0.3, p.z, -car.vel.x * 0.15 + (Math.random() - 0.5), 0.6 + Math.random(), -car.vel.z * 0.15 + (Math.random() - 0.5), 0.55 * slip, 0.92, 0.92, 1.6, 1.6 + slip, { drag: 1.4, grow: 3 });
      }
      if (car.grounded && !paved && spd > 6 && car.surface !== 6) {
        const a = clamp(spd / 40, 0.15, 0.7) * (car.surface === 3 ? 1.3 : 1);
        const br = car.surface === 3 ? [0.85, 0.75] : car.surface === 5 ? [0.95, 0.98] : [0.62, 0.45];
        for (const p of rear) S.emit(p.x, p.y + 0.3, p.z, -car.vel.x * 0.2 + (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.5, -car.vel.z * 0.2 + (Math.random() - 0.5) * 2, a, br[0], br[1], 1.4, 1.5, { drag: 1.6, grow: 2.6 });
      }
    }
    // Nitro-Flammen
    if (car.nitroOn) {
      const ex = ud.exhaust;
      for (const e of ex) {
        _v.copy(e).applyQuaternion(this.carModel.quaternion).add(car.pos);
        for (let i = 0; i < 2; i++) this.sparks.emit(_v.x, _v.y, _v.z, -sy * 14 + car.vel.x * 0.9, Math.random(), -cy * 14 + car.vel.z * 0.9, 0.3, 0.6, 1, 0.55, 0.16, { drag: 4, grow: 1.5 });
      }
    }
  }

  updateCamera(dt, inp) {
    const car = this.car, cam = this.camera;
    const spd = Math.abs(car.vf), topMs = car.stats.top / 3.6;
    if (this.camYaw === undefined) this.camYaw = car.yaw;
    const velYaw = Math.hypot(car.vel.x, car.vel.z) > 4 ? Math.atan2(car.vel.x, car.vel.z) : car.yaw;
    const target = car.vf < -2 ? car.yaw : car.yaw + wrapAngle(velYaw - car.yaw) * 0.35;
    this.camYaw += wrapAngle(target - this.camYaw) * (1 - Math.exp(-(this.camMode === 2 ? 12 : 5) * dt));
    const sy = Math.sin(this.camYaw), cy = Math.cos(this.camYaw);
    let fov = 60 + clamp(spd / topMs, 0, 1.1) * 16 + (car.nitroOn ? 7 : 0);
    if (this.camMode === 2) {
      cam.position.set(car.pos.x + Math.sin(car.yaw) * 0.2, car.pos.y + car.dims.H * 0.92 + 0.12, car.pos.z + Math.cos(car.yaw) * 0.2);
      _v.set(car.pos.x + Math.sin(car.yaw) * 30, car.pos.y + 1.0 + car.up.z * 0, car.pos.z + Math.cos(car.yaw) * 30);
      _v.y = this.world.heightAt(_v.x, _v.z) + 1.2;
      _v.y = lerp(car.pos.y + 0.8, _v.y, 0.5);
      cam.lookAt(_v);
      fov += 6;
    } else {
      const far = this.camMode === 1;
      const dist = (far ? 9.2 : 6.4) + clamp(spd / topMs, 0, 1) * (far ? 1.6 : 1.1) + car.dims.L * 0.2;
      const hgt = far ? 3.3 : 2.35;
      const tx = car.pos.x - sy * dist, tz = car.pos.z - cy * dist;
      let ty = car.pos.y + hgt;
      const gy = this.world.heightAt(tx, tz) + 1.1;
      ty = Math.max(ty, gy);
      this.camY = this.camY === undefined ? ty : damp(this.camY, ty, car.grounded ? 8 : 3, dt);
      this.camY = Math.max(this.camY, gy);
      cam.position.set(tx, this.camY, tz);
      cam.lookAt(car.pos.x + sy * 4, car.pos.y + (far ? 0.9 : 0.75), car.pos.z + cy * 4);
    }
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake; cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 1.8);
    }
    if (car.nitroOn || spd > topMs * 0.85) { cam.position.x += (Math.random() - 0.5) * 0.03; cam.position.y += (Math.random() - 0.5) * 0.03; }
    cam.fov = damp(cam.fov, fov, 4, dt);
    cam.updateProjectionMatrix();
  }

  updateShowroom(dt) {
    const cam = this.camera;
    this.titleT = (this.titleT || 0) + dt;
    let c, R = 7.5;
    if (this.state === 'garage' && this.previewModel) { c = this.previewModel.position; this.previewModel.rotation.y += dt * 0.35; R = 7; }
    else { c = this.car.pos; this.syncCar(dt); }
    const a = this.titleT * 0.18 + 0.6;
    const portrait = innerHeight > innerWidth;
    const off = this.state === 'garage' && !portrait ? 2.0 : 0;
    cam.position.set(c.x + Math.sin(a) * R, c.y + 2.0, c.z + Math.cos(a) * R);
    cam.lookAt(c.x + Math.cos(a) * off, c.y + 0.6, c.z - Math.sin(a) * off);
    cam.fov = portrait ? 75 : 52; cam.updateProjectionMatrix();
    this.audio.updateCar(this.car, { throttle: 0 }, false, this.carStyle);
  }

  confetti() {
    const p = this.car.pos;
    const cols = [[1, 0.24, 0.5], [1, 0.82, 0.25], [0.12, 0.82, 1], [0.48, 0.24, 1], [0.21, 0.89, 0.48]];
    for (let i = 0; i < 160; i++) { const c = cols[i % 5]; this.sparks.emit(p.x + (Math.random() - 0.5) * 6, p.y + 4 + Math.random() * 3, p.z + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 10, 4 + Math.random() * 8, (Math.random() - 0.5) * 10, c[0], c[1], c[2], 0.5, 2.5, { grav: 6, drag: 1.2, grow: 0 }); }
  }

  fireworks(dt) {
    const n = this.scenery.night;
    if (n < 0.5) return;
    const cp = this.camera.position;
    if (Math.hypot(cp.x - FESTIVAL.x, cp.z - FESTIVAL.z) > 1000) return;
    this.fwT = (this.fwT || 0) - dt;
    if (this.fwT > 0) return;
    this.fwT = 1.2 + Math.random() * 2.5;
    const x = FESTIVAL.x + (Math.random() - 0.5) * 200, z = FESTIVAL.z + 60 + Math.random() * 120, y = 90 + Math.random() * 60;
    const c = new THREE.Color().setHSL(Math.random(), 1, 0.6);
    for (let i = 0; i < 90; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1), sp = 22 + Math.random() * 6;
      this.sparks.emit(x, y, z, Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp, Math.sin(ph) * Math.sin(th) * sp, c.r, c.g, c.b, 3.2, 2.2, { grav: 6, drag: 1.4, grow: -0.6 });
    }
    const d = Math.hypot(cp.x - x, cp.z - z);
    if (d < 700) setTimeout(() => this.audio.play('firework', clamp(1 - d / 700, 0.1, 1)), d / 340 * 1000);
  }

  // dynamische Auflösung: hält die Bildrate auf schwachen Handys
  perf(dt) {
    this.fpsAcc = (this.fpsAcc || 0) + dt; this.fpsN = (this.fpsN || 0) + 1;
    if (this.fpsAcc < 2) return;
    const fps = this.fpsN / this.fpsAcc;
    this.fpsAcc = 0; this.fpsN = 0;
    if (this.state !== 'free' && this.state !== 'race') return;
    let pr = this.pr;
    if (fps < 42 && pr > 0.6) pr = Math.max(0.6, pr - 0.15);
    else if (fps > 57 && pr < this.maxPR) pr = Math.min(this.maxPR, pr + 0.1);
    if (pr !== this.pr) { this.pr = pr; this.renderer.setPixelRatio(pr); this.resize(); }
    const el = $('fps'); if (el && !el.hidden) el.textContent = `${fps.toFixed(0)} fps · ${pr.toFixed(2)}x`;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const s = Math.min(1.25, Math.max(0.75, Math.min(w, h) / 400));
    for (const id of ['minimap', 'speedo']) { const c = $(id); const sz = Math.round(c.clientWidth * Math.min(2, devicePixelRatio || 1)); if (sz > 0) { c.width = sz; c.height = sz; } }
    document.documentElement.style.setProperty('--ui', s.toFixed(3));
    if (this.screen === 'map' && this.drawMap) this.drawMap();
  }
}

const TIME_FIXED = { day: 12.5, sunset: 19.3, night: 23 };

function frame() { return new Promise(r => requestAnimationFrame(() => r())); }

// ---------------------------------------------------------------- Geister-/Herausforderungs-Kodierung
function encodePts(pts) {
  const buf = new Uint8Array(pts.length * 5);
  const dv = new DataView(buf.buffer);
  pts.forEach((p, i) => {
    dv.setInt16(i * 5, Math.round(clamp(p[0], -1300, 1300) * 20), true);
    dv.setInt16(i * 5 + 2, Math.round(clamp(p[1], -1300, 1300) * 20), true);
    dv.setUint8(i * 5 + 4, Math.round(((p[2] % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 255) & 255);
  });
  return b64(buf);
}
function decodePts(s) {
  const buf = unb64(s), dv = new DataView(buf.buffer), out = [];
  for (let i = 0; i + 5 <= buf.length; i += 5) out.push([dv.getInt16(i, true) / 20, dv.getInt16(i + 2, true) / 20, dv.getUint8(i + 4) / 255 * Math.PI * 2]);
  return out;
}
function encodeChallenge(ev, car, color, time, name, pts) {
  const nameB = new TextEncoder().encode(name);
  const head = new Uint8Array(10 + nameB.length);
  const dv = new DataView(head.buffer);
  head[0] = 1; head[1] = ev; head[2] = car;
  const c = new THREE.Color(color);
  head[3] = Math.round(c.r * 255); head[4] = Math.round(c.g * 255); head[5] = Math.round(c.b * 255);
  dv.setUint32(6, Math.round(time * 1000), true);
  const all = new Uint8Array(head.length + 1 + pts.length * 5);
  all.set(head, 0);
  all[10] = nameB.length; all.set(nameB, 11);
  all.set(unb64(encodePts(pts)), 11 + nameB.length);
  return b64(all.subarray(0, 11 + nameB.length + pts.length * 5));
}
function parseChallenge() {
  const m = location.hash.match(/#c=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const b = unb64(m[1]), dv = new DataView(b.buffer);
    if (b[0] !== 1) return null;
    const nl = b[10];
    const name = new TextDecoder().decode(b.subarray(11, 11 + nl)).replace(/[<>]/g, '');
    const color = '#' + [b[3], b[4], b[5]].map(v => v.toString(16).padStart(2, '0')).join('');
    return { ev: b[1], car: b[2], color, time: dv.getUint32(6, true) / 1000, name: name || 'Ein Freund', pts: decodePts(b64(b.subarray(11 + nl))) };
  } catch { return null; }
}
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

// ---------------------------------------------------------------- los
const game = new Game();
window.__game = game;
game.boot().catch(e => {
  console.error(e);
  const m = $('load-msg'); if (m) m.textContent = 'Fehler: ' + e.message;
});
