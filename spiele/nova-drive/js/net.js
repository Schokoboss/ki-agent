// Mehrspieler über verschiedene Geräte: MQTT über WebSocket (öffentlicher Vermittlungsdienst, kein eigener Server).
// Räume mit 5-stelligem Code. Übertragen werden nur Name, Auto, Farbe, Position und Rennstand – 10× pro Sekunde.
// Themen: novadrive/v1/<CODE>/meta (Raum, gespeichert), /p/<id> (Spielerstand, „bye“ beim Verlassen), /ev (Rennstart),
//         /q/<id> (Uhrenabgleich: Ping/Pong an einen Mitspieler).
// Gemeinsame Uhr: jedes Gerät misst per Ping/Pong den Gangunterschied seiner Uhr zu jedem Mitspieler (wie NTP,
// bester Wert der letzten Messungen). Damit laufen Rennuhr, Countdown und Zielzeiten auf allen Geräten gleich, und
// Mitspieler werden dort gezeigt, wo sie *jetzt* sind (Vorhersage aus Tempo und Alter der Meldung, weich korrigiert).
// Zum Testen: ?broker=ws://localhost:PORT in der Adresse nutzt einen anderen Vermittlungsdienst.
import * as THREE from '../lib/three.module.min.js';
import mqtt from '../lib/mqtt.esm.js';
import { CARS } from './data.js';
import { buildCar, styleDims, disposeCar, applyLivery } from './carmodel.js';
import { clamp } from './util.js';

const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
const PREFIX = 'novadrive/v1/';
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rid = n => Array.from({ length: n }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join('');
// eigene Uhr in ms (gleichmäßig, unabhängig von Änderungen der Systemzeit)
export const clock = () => performance.timeOrigin + performance.now();
const MAX_AGE = 0.6; // so weit (s) wird eine Meldung höchstens vorausgerechnet
// Protokoll-Stand: unterschiedliche Stände im selben Raum → Hinweis, beide neu zu laden
export const NET_VERSION = 2;

// Entferntes Auto: Vorhersage aus dem letzten Stand (Position + Geschwindigkeit + Drehrate × Alter), Sprünge bei
// neuen Meldungen werden nicht gezeigt, sondern in ~0,15 s weich ausgeglichen.
export class Remote {
  constructor() { this.s = null; this.x = 0; this.y = 0; this.z = 0; this.yaw = 0; this.ex = 0; this.ez = 0; this.ey = 0; this.eyaw = 0; this.age = 0; }
  // Vorhersage für Zeitpunkt now (meine Uhr) aus Stand s (tl = Sendezeit auf meiner Uhr)
  static predict(s, now, o) {
    const a = clamp((now - s.tl) / 1000, 0, MAX_AGE), h = s.w * a * 0.5, c = Math.cos(h), n = Math.sin(h);
    // Geschwindigkeit um die halbe Drehung mitdrehen (Bogen statt Gerade)
    const vx = s.vx * c + s.vz * n, vz = -s.vx * n + s.vz * c;
    o.x = s.x + vx * a; o.z = s.z + vz * a; o.yaw = s.r + s.w * a; o.age = a;
    return o;
  }
  push(s, now) {
    if (this.s) {
      Remote.predict(s, now, _p);
      const dx = this.x - _p.x, dz = this.z - _p.z;
      if (dx * dx + dz * dz < 144) { this.ex = dx; this.ez = dz; this.eyaw = wrapA(this.yaw - _p.yaw); } else { this.ex = this.ez = this.eyaw = 0; }
    }
    this.s = s;
  }
  update(dt, now, world) {
    const s = this.s;
    if (!s) return false;
    const k = Math.exp(-dt * 7);
    this.ex *= k; this.ez *= k; this.eyaw *= k;
    Remote.predict(s, now, _p);
    this.x = _p.x + this.ex; this.z = _p.z + this.ez; this.yaw = _p.yaw + this.eyaw; this.age = _p.age;
    // Höhe: Abstand zum Boden aus der Meldung behalten (Sprünge), sonst dem Gelände folgen
    if (world) { if (s.above === undefined) s.above = Math.max(0, s.y - world.heightAt(s.x, s.z)); this.y = world.heightAt(this.x, this.z) + s.above; } else this.y = s.y;
    return true;
  }
}
const _p = { x: 0, z: 0, yaw: 0, age: 0 };
function wrapA(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

export class Net {
  constructor(game) {
    this.g = game;
    this.id = rid(8);
    this.client = null; this.room = null; this.host = false; this.broker = null;
    this.status = 'aus'; // aus | verbinde | verbunden | fehler
    this.peers = new Map();
    this.sentAt = 0; this.listeners = [];
    this.aiFeed = null; this.feedSeq = 0; this.lastState = null;
    const q = new URLSearchParams(location.search);
    this.brokers = q.get('broker') ? [q.get('broker')] : BROKERS;
  }
  get active() { return !!this.room && this.status === 'verbunden'; }
  on(fn) { this.listeners.push(fn); }
  emit(kind, data) { for (const f of this.listeners) try { f(kind, data); } catch (e) { console.warn(e); } }
  topic(t) { return PREFIX + this.room + '/' + t; }

  // eine Verbindung zu einem Vermittlungsdienst; Abbruch nach 7 s
  connectTo(url, room) {
    return new Promise((res, rej) => {
      const c = mqtt.connect(url, {
        clientId: 'nd_' + this.id + '_' + rid(3), keepalive: 20, clean: true, reconnectPeriod: 3000, connectTimeout: 7000,
        will: { topic: PREFIX + room + '/p/' + this.id, payload: 'bye', qos: 0, retain: false },
      });
      const t = setTimeout(() => { c.end(true); rej(new Error('Zeitüberschreitung')); }, 7500);
      c.once('connect', () => { clearTimeout(t); res(c); });
      c.once('error', e => { clearTimeout(t); c.end(true); rej(e); });
    });
  }
  async create(name) {
    const code = rid(5);
    this.status = 'verbinde'; this.emit('status');
    for (const url of this.brokers) {
      try {
        const c = await this.connectTo(url, code);
        this.attach(c, code, url, true);
        c.publish(this.topic('meta'), JSON.stringify({ host: this.id, name, t: Date.now() }), { retain: true, qos: 1 });
        return code;
      } catch (e) { console.warn('Vermittlung nicht erreichbar', url, e && e.message); }
    }
    this.status = 'fehler'; this.emit('status');
    throw new Error('Keine Verbindung zum Vermittlungsdienst');
  }
  async join(code) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (code.length !== 5) throw new Error('Der Code hat 5 Zeichen');
    this.status = 'verbinde'; this.emit('status');
    let reached = false;
    for (const url of this.brokers) {
      let c;
      try { c = await this.connectTo(url, code); reached = true; } catch (e) { console.warn('Vermittlung nicht erreichbar', url); continue; }
      // gibt es den Raum hier? (gespeicherte Raum-Info oder schon Spieler)
      const found = await new Promise(res => {
        const t = setTimeout(() => res(false), 2600);
        c.on('message', (topic, msg) => { if (topic.startsWith(PREFIX + code + '/') && msg.length && String(msg) !== 'bye') { clearTimeout(t); res(true); } });
        c.subscribe(PREFIX + code + '/#');
      });
      if (found) { c.removeAllListeners('message'); this.attach(c, code, url, false); return code; }
      c.end(true);
    }
    this.status = this.room ? 'verbunden' : reached ? 'aus' : 'fehler'; this.emit('status');
    throw new Error(reached ? 'Raum nicht gefunden' : 'Keine Verbindung zum Vermittlungsdienst');
  }
  attach(c, code, url, host) {
    this.client = c; this.room = code; this.host = host; this.broker = url; this.status = 'verbunden';
    this.g.save.mpJoined = true;
    c.subscribe(PREFIX + code + '/#');
    c.on('message', (topic, msg) => this.onMessage(topic, String(msg)));
    c.on('reconnect', () => { this.status = 'verbinde'; this.emit('status'); });
    c.on('connect', () => { this.status = 'verbunden'; this.emit('status'); });
    c.on('offline', () => { this.status = 'verbinde'; this.emit('status'); });
    this.sendState(true);
    this.emit('status');
  }
  leave() {
    if (!this.client) return;
    const c = this.client;
    try {
      c.publish(this.topic('p/' + this.id), 'bye');
      if (this.host && this.peers.size === 0) c.publish(this.topic('meta'), '', { retain: true, qos: 1 });
    } catch {}
    setTimeout(() => c.end(true), 300);
    for (const p of this.peers.values()) this.dropPeer(p);
    this.peers.clear();
    this.client = null; this.room = null; this.host = false; this.status = 'aus';
    this.emit('status');
  }

  // ---------------------------------------------------------------- eigener Stand
  myState() {
    const g = this.g, c = g.car, r = g.events && g.events.race;
    // während einer Wiederholung/des Zurückspulens steht das Auto woanders – den letzten echten Stand weitermelden
    if ((g.replay || g.rewinding) && this.lastState) return { ...this.lastState, vx: 0, vz: 0, w: 0, s: 0, t: clock() };
    const drive = g.state === 'free' || g.state === 'race' || g.state === 'paused' || g.state === 'photo';
    const f2 = v => +v.toFixed(2);
    const st = {
      n: (g.settings.name || 'Spieler').slice(0, 16), c: g.save.current, k: (g.save.owned[g.save.current] || {}).color || null, l: (g.save.owned[g.save.current] || {}).livery || null,
      d: drive ? 1 : 0, x: f2(c.pos.x), y: f2(c.pos.y), z: f2(c.pos.z), r: +c.yaw.toFixed(3), s: +c.vf.toFixed(1),
      vx: f2(c.vel.x), vz: f2(c.vel.z), w: +(c.yawRate || 0).toFixed(3),
      re: r ? r.ev.id : null, ri: r && r.mp ? r.mp.seed : 0, rp: r ? +r.prog.toFixed(1) : 0, rf: r && r.finished ? +r.finishT.toFixed(3) : 0, rs: r && r.started ? 1 : 0,
      t: Math.round(clock()), gv: NET_VERSION,
    };
    // Rennleiter: Stand aller KI-Gegner (die anderen Geräte zeigen sie nur an)
    if (r && r.mp && r.aiHost === this.id && r.ais.length) {
      st.ag = r.aiGen || 0;
      st.ai = r.ais.map(a => { const v = a.veh; return [f2(v.pos.x), f2(v.pos.y), f2(v.pos.z), f2(v.vel.x), f2(v.vel.z), +v.yaw.toFixed(3), +(v.yawRate || 0).toFixed(3), +a.prog.toFixed(1), a.done ? +a.finish.toFixed(3) : -1, a.model.visible ? 1 : 0]; });
    }
    this.lastState = st;
    return st;
  }
  // Gangunterschied der Uhr eines Mitspielers zu meiner (ms, seine minus meine); vor dem ersten Ping grob geschätzt
  offOf(id) {
    if (id === this.id) return 0;
    const p = this.peers.get(id);
    if (!p) return null;
    return p.syncN ? p.off : p.rough !== undefined ? p.rough + 40 : 0;
  }
  sendState(force) {
    if (!this.client || !this.room) return;
    this.client.publish(this.topic('p/' + this.id), JSON.stringify(this.myState()), { qos: 0 });
  }
  // Rennstart an alle im Raum: gleiche Startaufstellung (ids sortiert) und gleiche KI (seed) auf allen Geräten
  sendRace(ev, wantAI) {
    if (!this.active) return null;
    const ids = [this.id, ...this.peers.keys()].sort();
    const ai = wantAI ? Math.max(0, Math.min(ev.ai, 8 - ids.length)) : 0;
    // at: Startzeitpunkt auf meiner Uhr – die anderen rechnen ihn mit dem Uhrenabgleich auf ihre eigene um
    // nm: Namen der Menschen – die KI bekommt andere (auf allen Geräten gleich, weil aus der Nachricht)
    const nm = [(this.g.settings.name || 'Spieler').slice(0, 16), ...[...this.peers.values()].map(p => p.name)];
    const mp = { type: 'race', v: 2, ev: ev.id, ai, ids, nm, seed: 1 + Math.floor(Math.random() * 1e9), from: this.id, t: Date.now(), at: Math.round(clock()) };
    this.client.publish(this.topic('ev'), JSON.stringify(mp), { qos: 1 });
    return mp;
  }

  // ---------------------------------------------------------------- Nachrichten
  onMessage(topic, msg) {
    const rest = topic.slice((PREFIX + this.room + '/').length);
    if (rest === 'meta') { this.meta = msg ? safe(msg) : null; this.emit('status'); return; }
    if (rest === 'ev') { const e = safe(msg); if (e && e.from !== this.id) this.emit('event', e); return; }
    if (rest.startsWith('q/')) { this.onClockMsg(rest.slice(2), msg); return; }
    if (!rest.startsWith('p/')) return;
    const id = rest.slice(2);
    if (id === this.id) return;
    if (msg === 'bye') { const p = this.peers.get(id); if (p) { this.dropPeer(p); this.peers.delete(id); this.emit('status'); this.emit('left', p); } return; }
    const s = safe(msg);
    if (!s) return;
    let p = this.peers.get(id);
    if (!p) { p = { id, remote: new Remote(), model: null, label: null, car: null, color: null, name: '', race: {}, roughs: [] }; this.peers.set(id, p); this.emit('status'); this.emit('joined', p); }
    const now = performance.now() / 1000, nowC = clock();
    const nm = String(s.n || 'Spieler').slice(0, 16);
    if (p.label && nm !== p.name) updateSprite(p.label, nm);
    p.last = now; p.name = nm; p.drive = !!s.d;
    if ((s.gv || 1) !== NET_VERSION && !p.warned) { p.warned = true; this.emit('version', p); }
    // grobe Uhr-Schätzung aus den Meldungen selbst (bis der Ping-Abgleich da ist): kleinste Laufzeit gewinnt
    if (typeof s.t === 'number') { p.roughs.push(s.t - nowC); if (p.roughs.length > 30) p.roughs.shift(); p.rough = Math.max(...p.roughs); }
    const tl = (typeof s.t === 'number' ? s.t : nowC) - this.offOf(id); // Sendezeit auf meiner Uhr
    p.race = { id: s.ri || 0, ev: s.re, prog: s.rp || 0, fin: s.rf || 0, started: !!s.rs, speed: s.s || 0, tl };
    const lk = s.l ? JSON.stringify(s.l) : '';
    if (p.car !== s.c || p.color !== s.k) { p.car = s.c; p.color = s.k; this.buildPeer(p); p.lk = null; }
    if (p.lk !== lk && p.model) { p.lk = lk; applyLivery(p.model, s.l && typeof s.l === 'object' ? { p: String(s.l.p), c2: String(s.l.c2 || '#ffffff').slice(0, 7), n: +s.l.n || 0 } : { p: 'none' }); }
    const vx = typeof s.vx === 'number' ? s.vx : Math.sin(s.r) * s.s, vz = typeof s.vz === 'number' ? s.vz : Math.cos(s.r) * s.s;
    p.remote.push({ tl, x: s.x, y: s.y, z: s.z, r: s.r, w: s.w || 0, vx, vz, s: s.s || 0 }, nowC);
    p.vx = vx; p.vz = vz;
    // Gegner-Stand vom Rennleiter
    if (Array.isArray(s.ai) && s.ri) this.aiFeed = { from: id, ri: s.ri, ag: s.ag || 0, tl, rx: nowC, list: s.ai, seq: ++this.feedSeq };
  }
  // Uhrenabgleich: Ping (a = meine Uhr beim Senden) → Pong (b = Uhr des anderen) → Gangunterschied = b − Mitte von a und jetzt
  onClockMsg(to, msg) {
    if (to !== this.id) return;
    const m = safe(msg), now = clock();
    if (!m || typeof m.f !== 'string' || typeof m.a !== 'number') return;
    if (m.k === 'pi') { this.client.publish(this.topic('q/' + m.f), JSON.stringify({ k: 'po', f: this.id, a: m.a, b: Math.round(now) })); return; }
    if (m.k !== 'po' || typeof m.b !== 'number') return;
    const p = this.peers.get(m.f), rtt = now - m.a;
    if (!p || !(rtt >= 0 && rtt < 8000)) return;
    (p.sync ||= []).push({ rtt, off: m.b - (m.a + now) / 2 });
    if (p.sync.length > 12) p.sync.shift();
    const best = p.sync.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    p.off = best.off; p.rtt = best.rtt; p.syncN = (p.syncN || 0) + 1;
  }

  // ---------------------------------------------------------------- Darstellung der anderen
  buildPeer(p) {
    const g = this.g;
    if (p.model) disposeCar(p.model);
    const spec = CARS.find(c => c.id === p.car) || CARS[0];
    p.spec = spec;
    p.model = buildCar(spec, p.color || spec.colors[0], { lod: 'ai' });
    p.model.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.scene.add(p.model);
    if (!p.label) { p.label = nameSprite(p.name); g.scene.add(p.label); }
    else updateSprite(p.label, p.name);
    const D = styleDims(spec.style);
    p.half = (D.L / 2 - D.W / 2) * 0.85; p.rad = D.W / 2 * 0.95;
    p.pos ||= new THREE.Vector3(); p.yaw ||= 0; p.vx = 0; p.vz = 0; p.wheelRot ||= 0;
    p.circles = () => {
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw), h = p.half;
      return [[p.pos.x + sy * h, p.pos.z + cy * h], [p.pos.x - sy * h, p.pos.z - cy * h]];
    };
  }
  dropPeer(p) {
    if (p.model) disposeCar(p.model);
    if (p.label) { this.g.scene.remove(p.label); p.label.material.map.dispose(); p.label.material.dispose(); }
    p.model = null; p.label = null;
  }
  update(dt) {
    if (!this.room) return;
    // 10× pro Sekunde nach echter Uhr senden – auch wenn das Gerät gerade ruckelt
    const ms = performance.now();
    if (ms - (this.sentAt || 0) >= 100) { this.sentAt = ms; this.sendState(); }
    const now = performance.now() / 1000, nowC = clock();
    const race = this.g.events.race, myEv = race ? race.ev.id : null, myRi = race && race.mp ? race.mp.seed : 0;
    for (const [id, p] of this.peers) {
      if (now - (p.last || now) > 8) { this.dropPeer(p); this.peers.delete(id); this.emit('status'); this.emit('left', p); continue; }
      // Uhrenabgleich: anfangs alle 0,4 s, danach alle 3 s
      if (nowC - (p.pingAt || 0) > ((p.syncN || 0) < 6 ? 400 : 3000)) {
        p.pingAt = nowC;
        this.client.publish(this.topic('q/' + id), JSON.stringify({ k: 'pi', f: this.id, a: Math.round(nowC) }), { qos: 0 });
      }
      if (!p.model || !p.remote.update(dt, nowC, this.g.world)) continue;
      const R = p.remote, x = R.x, y = R.y, z = R.z, yaw = R.yaw, sp = R.s.s;
      p.pos.set(x, y, z); p.yaw = yaw;
      // nur sehen und berühren, wer im selben Rennen ist (oder wie du frei fährt)
      const vis = p.drive && (p.race.ev || null) === myEv && (!myRi || !p.race.id || p.race.id === myRi);
      p.model.visible = vis; p.label.visible = vis;
      if (!vis) continue;
      p.model.position.set(x, y, z);
      p.model.rotation.set(0, yaw, 0);
      const W = this.g.world, e = 1.6, sy = Math.sin(yaw), cy = Math.cos(yaw);
      const gx = (W.heightAt(x + e, z) - W.heightAt(x - e, z)) / (2 * e), gz = (W.heightAt(x, z + e) - W.heightAt(x, z - e)) / (2 * e);
      p.model.userData.bodyG.rotation.set(-Math.atan(gx * sy + gz * cy), 0, Math.atan(-gx * cy + gz * sy) * 0.8);
      p.wheelRot += sp / 0.35 * dt;
      for (const w of p.model.userData.wheels) w.spin.rotation.x = p.wheelRot;
      const d = this.g.camera.position.distanceTo(p.model.position), sc = clamp(d / 22, 1, 6);
      p.label.position.set(x, y + 2.2 + sc * 0.45, z);
      p.label.scale.set(4.2 * sc, 1.05 * sc, 1);
      p.label.material.opacity = clamp(1.5 - d / 400, 0.35, 1);
    }
  }
  // für Kollisionen: sichtbare Mitspieler; Minikarte: alle, die gerade fahren
  cars() { return [...this.peers.values()].filter(p => p.model && p.model.visible); }
  mapPeers() { return [...this.peers.values()].filter(p => p.model && p.drive && p.pos); }
  // Mitspieler im selben Rennen (gleiche Renn-Kennung; ältere Spielversionen senden nur das Event)
  racers(ri, evId) { return [...this.peers.values()].filter(p => p.race && (p.race.id ? p.race.id === ri : p.race.ev === evId)); }
}

function safe(s) { try { return JSON.parse(s); } catch { return null; } }
function nameSprite(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true, fog: false });
  const s = new THREE.Sprite(m); s.scale.set(4.2, 1.05, 1); s.renderOrder = 40;
  s.userData.canvas = c; updateSprite(s, name);
  return s;
}
function updateSprite(s, name) {
  const c = s.userData.canvas, g = c.getContext('2d');
  g.clearRect(0, 0, 256, 64);
  g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(240, g.measureText(name).width + 34);
  g.fillStyle = 'rgba(14,10,30,0.72)'; g.beginPath(); g.roundRect(128 - w / 2, 8, w, 48, 24); g.fill();
  g.strokeStyle = '#ff3d7f'; g.lineWidth = 3; g.stroke();
  g.fillStyle = '#fff'; g.fillText(name, 128, 33);
  s.material.map.needsUpdate = true;
}
