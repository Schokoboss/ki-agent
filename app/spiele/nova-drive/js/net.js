// Mehrspieler über verschiedene Geräte: MQTT über WebSocket (öffentlicher Vermittlungsdienst, kein eigener Server).
// Räume mit 5-stelligem Code. Übertragen werden nur Name, Auto, Farbe, Position und Rennstand – 10× pro Sekunde.
// Themen: novadrive/v1/<CODE>/meta (Raum, gespeichert), /p/<id> (Spielerstand, „bye“ beim Verlassen), /ev (Rennstart).
// Zum Testen: ?broker=ws://localhost:PORT in der Adresse nutzt einen anderen Vermittlungsdienst.
import * as THREE from '../lib/three.module.min.js';
import mqtt from '../lib/mqtt.esm.js';
import { CARS } from './data.js';
import { buildCar, styleDims } from './carmodel.js';
import { clamp } from './util.js';

const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
const PREFIX = 'novadrive/v1/';
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rid = n => Array.from({ length: n }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join('');
const DELAY = 0.2; // Sekunden Puffer für weiches Gleiten (Netz schwankt)

export class Net {
  constructor(game) {
    this.g = game;
    this.id = rid(8);
    this.client = null; this.room = null; this.host = false; this.broker = null;
    this.status = 'aus'; // aus | verbinde | verbunden | fehler
    this.peers = new Map();
    this.sentAt = 0; this.listeners = [];
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
    const drive = g.state === 'free' || g.state === 'race' || g.state === 'paused' || g.state === 'photo';
    return {
      n: (g.settings.name || 'Spieler').slice(0, 16), c: g.save.current, k: (g.save.owned[g.save.current] || {}).color || null,
      d: drive ? 1 : 0, x: +c.pos.x.toFixed(2), y: +c.pos.y.toFixed(2), z: +c.pos.z.toFixed(2), r: +c.yaw.toFixed(3), s: +c.vf.toFixed(1),
      re: r ? r.ev.id : null, rp: r ? Math.round(r.prog) : 0, rf: r && r.finished ? +r.finishT.toFixed(2) : 0, rs: r && r.started ? 1 : 0, t: Date.now(),
    };
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
    const mp = { type: 'race', ev: ev.id, ai, ids, seed: Math.floor(Math.random() * 1e9), from: this.id, t: Date.now() };
    this.client.publish(this.topic('ev'), JSON.stringify(mp), { qos: 1 });
    return mp;
  }

  // ---------------------------------------------------------------- Nachrichten
  onMessage(topic, msg) {
    const rest = topic.slice((PREFIX + this.room + '/').length);
    if (rest === 'meta') { this.meta = msg ? safe(msg) : null; this.emit('status'); return; }
    if (rest === 'ev') { const e = safe(msg); if (e && e.from !== this.id) this.emit('event', e); return; }
    if (!rest.startsWith('p/')) return;
    const id = rest.slice(2);
    if (id === this.id) return;
    if (msg === 'bye') { const p = this.peers.get(id); if (p) { this.dropPeer(p); this.peers.delete(id); this.emit('status'); this.emit('left', p); } return; }
    const s = safe(msg);
    if (!s) return;
    let p = this.peers.get(id);
    if (!p) { p = { id, buf: [], model: null, label: null, car: null, color: null, name: '', race: {} }; this.peers.set(id, p); this.emit('status'); this.emit('joined', p); }
    const now = performance.now() / 1000;
    const nm = String(s.n || 'Spieler').slice(0, 16);
    if (p.label && nm !== p.name) updateSprite(p.label, nm);
    p.last = now; p.name = nm; p.drive = !!s.d;
    p.race = { ev: s.re, prog: s.rp || 0, fin: s.rf || 0, started: !!s.rs };
    if (p.car !== s.c || p.color !== s.k) { p.car = s.c; p.color = s.k; this.buildPeer(p); }
    p.buf.push({ t: now, x: s.x, y: s.y, z: s.z, r: s.r, s: s.s });
    if (p.buf.length > 20) p.buf.shift();
  }

  // ---------------------------------------------------------------- Darstellung der anderen
  buildPeer(p) {
    const g = this.g;
    if (p.model) g.scene.remove(p.model);
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
    if (p.model) this.g.scene.remove(p.model);
    if (p.label) this.g.scene.remove(p.label);
    p.model = null; p.label = null;
  }
  update(dt) {
    if (!this.room) return;
    // 10× pro Sekunde nach echter Uhr senden – auch wenn das Gerät gerade ruckelt
    const ms = performance.now();
    if (ms - (this.sentAt || 0) >= 100) { this.sentAt = ms; this.sendState(); }
    const now = performance.now() / 1000, rt = now - DELAY;
    const myEv = this.g.events.race ? this.g.events.race.ev.id : null;
    for (const [id, p] of this.peers) {
      if (now - (p.last || now) > 8) { this.dropPeer(p); this.peers.delete(id); this.emit('status'); this.emit('left', p); continue; }
      if (!p.model || p.buf.length === 0) continue;
      // zwischen zwei Ständen gleiten
      let a = p.buf[0], b = p.buf[p.buf.length - 1];
      for (let i = 0; i < p.buf.length - 1; i++) if (p.buf[i].t <= rt && p.buf[i + 1].t >= rt) { a = p.buf[i]; b = p.buf[i + 1]; break; }
      let k = b.t > a.t ? clamp((rt - a.t) / (b.t - a.t), 0, 1.25) : 1;
      if (Math.hypot(b.x - a.x, b.z - a.z) > 40) k = 1; // Zurücksetzen / Schnellreise: springen statt gleiten
      let dy = b.r - a.r; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      const x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k, y = a.y + (b.y - a.y) * k, yaw = a.r + dy * k, sp = a.s + (b.s - a.s) * k;
      p.pos.set(x, y, z); p.yaw = yaw; p.vx = Math.sin(yaw) * sp; p.vz = Math.cos(yaw) * sp;
      // nur sehen und berühren, wer im selben Rennen ist (oder wie du frei fährt)
      const vis = p.drive && (p.race.ev || null) === myEv;
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
  // Mitspieler im selben Rennen
  racers(evId) { return [...this.peers.values()].filter(p => p.race && p.race.ev === evId); }
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
