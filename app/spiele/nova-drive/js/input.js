// Steuerung: Touch-Tasten (Handy), Wischen, Neigen, Touch-Lenkrad, Tastatur, Gamepad, USB-Lenkrad mit Pedalen.
import { clamp, view, logicalPoint, localPoint } from './util.js';

// bekannte Lenkräder (Browser melden sie als „Gamepad“ ohne Standard-Belegung)
export const WHEEL_RE = /wheel|racing|lenkrad|driving force|g2[5579]\b|g9[02][0-9]|g923|dfgt|thrustmaster|t150|t248|t300|t500|tmx|t-gt|t818|fanatec|csl|clubsport|podium|moza|simucube|cammus|simagic|pxn|hori.*(racing|apex)/i;
export function isWheelId(id, cfg) { return !!id && ((cfg && cfg.id === id) || WHEEL_RE.test(id)); }

export class Input {
  constructor() {
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, look: false, rewind: false };
    this.kbSteer = 0; this._t = 0; this.padPrev = {}; this.padUsed = false;
    this.keys = new Set();
    this.btn = { left: false, right: false, gas: false, brake: false, hand: false, nitro: false, rewind: false };
    this.mode = 'buttons'; // buttons | slider | tilt
    this.autoGas = false;
    this.tilt = 0; this.tiltOk = false; this.tiltRaw = 0; this.tiltZero = 0; this.tiltInvert = false;
    this.sens = 1;
    this.slider = null; this.sliderVal = 0;
    this.wheelRot = 0; this.wheelHeld = false; this.wheelEl = null; // Touch-Lenkrad (Bogenmaß)
    this.wheelCfg = null; this.wheelGain = 2; this.wheelUsed = false; this.axSeen = {}; // USB-Lenkrad
    this.pressed = new Set();
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      // Tippen in Textfeldern (Name, Raum-Code) löst keine Spieltasten aus – nur Esc
      const t = e.target;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !/^(range|checkbox|button)$/.test(t.type))) && e.code !== 'Escape') return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      this.padUsed = false; // Tastenhilfe zeigt wieder die Tastatur
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab', 'F1'].includes(e.code) && (e.target === document.body || e.code === 'F1')) e.preventDefault();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); for (const k in this.btn) this.btn[k] = false; });
  }

  bindTouch(root) {
    const map = { 'c-left': 'left', 'c-right': 'right', 'c-gas': 'gas', 'c-brake': 'brake', 'c-hand': 'hand', 'c-nitro': 'nitro', 'h-rewind': 'rewind' };
    for (const [id, key] of Object.entries(map)) {
      const el = root.querySelector('#' + id);
      if (!el) continue;
      const ids = new Set();
      const upd = () => { this.btn[key] = ids.size > 0; el.classList.toggle('on', ids.size > 0); };
      el.addEventListener('pointerdown', e => { e.preventDefault(); ids.add(e.pointerId); try { el.setPointerCapture(e.pointerId); } catch {} upd(); if (navigator.vibrate && key !== 'gas' && this.haptic !== false) navigator.vibrate(8); });
      const up = e => { ids.delete(e.pointerId); upd(); };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    }
    // Wisch-Lenkung: linke Hälfte, horizontal ziehen
    const zone = root.querySelector('#c-slider');
    if (zone) {
      let id = null, x0 = 0;
      zone.addEventListener('pointerdown', e => { id = e.pointerId; x0 = logicalPoint(e).x; zone.setPointerCapture(id); this.sliderVal = 0; this.moveKnob(zone, 0); });
      zone.addEventListener('pointermove', e => { if (e.pointerId !== id) return; this.sliderVal = clamp((logicalPoint(e).x - x0) / 70, -1, 1); this.moveKnob(zone, this.sliderVal); });
      const end = e => { if (e.pointerId !== id) return; id = null; this.sliderVal = 0; this.moveKnob(zone, 0); };
      zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
    }
    // Touch-Lenkrad: am Kranz greifen und drehen, beim Loslassen federt es zur Mitte zurück
    const wz = root.querySelector('#c-wheel');
    if (wz) {
      this.wheelEl = wz.querySelector('.tw');
      let id = null, last = 0;
      const ang = e => { const q = localPoint(e, wz), cx = wz.offsetWidth / 2, cy = wz.offsetHeight / 2; return { a: Math.atan2(q.x - cx, cy - q.y), d: Math.hypot(q.x - cx, q.y - cy) }; };
      wz.addEventListener('pointerdown', e => { e.preventDefault(); id = e.pointerId; try { wz.setPointerCapture(id); } catch {} last = ang(e).a; this.wheelHeld = true; wz.classList.add('on'); });
      wz.addEventListener('pointermove', e => {
        if (e.pointerId !== id) return;
        const q = ang(e);
        if (q.d > wz.offsetWidth * 0.12) { // nahe der Mitte ist der Winkel unruhig
          let d = q.a - last; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
          this.wheelRot = clamp(this.wheelRot + d, -2.4, 2.4);
        }
        last = q.a;
      });
      const end = e => { if (e.pointerId !== id) return; id = null; this.wheelHeld = false; wz.classList.remove('on'); };
      wz.addEventListener('pointerup', end); wz.addEventListener('pointercancel', end); wz.addEventListener('lostpointercapture', end);
    }
  }
  moveKnob(zone, v) { const k = zone.querySelector('.knob'); if (k) k.style.transform = `translateX(${v * 60}px)`; }

  async enableTilt() {
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) {
        const r = await DeviceMotionEvent.requestPermission();
        if (r !== 'granted') return false;
      }
    } catch { return false; }
    if (!this._tiltBound) {
      this._tiltBound = true;
      window.addEventListener('devicemotion', e => {
        const a = e.accelerationIncludingGravity;
        if (!a || a.y === null) return;
        // gedreht (Handy quer, Bildschirm hochkant) entspricht Querformat mit Oberkante links (90°)
        const ang = view.turned ? 90 : (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 90;
        const sgn = ang === 90 ? 1 : ang === 270 || ang === -90 ? -1 : 0;
        let v = (sgn ? a.y * sgn : a.x) / 9.81;
        this.tiltRaw = v;
        v = (v - this.tiltZero) * (this.tiltInvert ? -1 : 1);
        this.tilt = clamp(Math.abs(v) < 0.035 ? 0 : v * 2.4 * this.sens, -1, 1);
        this.tiltOk = true;
      });
    }
    return true;
  }

  poll() {
    const k = this.keys, b = this.btn, s = this.state;
    const now = performance.now(), dt = Math.min(0.05, this._t ? (now - this._t) / 1000 : 0.016);
    this._t = now;
    // Tastatur: Lenkung baut sich weich auf (wie ein Lenkrad), zurück geht's schneller
    let kb = 0;
    if (k.has('ArrowLeft') || k.has('KeyA')) kb -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) kb += 1;
    const back = kb === 0 || Math.sign(kb) !== Math.sign(this.kbSteer);
    const rate = (back ? 7.5 : 3.4) * (0.75 + 0.25 * this.sens);
    this.kbSteer += clamp(kb - this.kbSteer, -rate * dt, rate * dt);
    let steer = this.kbSteer;
    if (b.left) steer -= 1;
    if (b.right) steer += 1;
    if (this.mode === 'slider') steer += this.sliderVal * this.sens;
    if (this.mode === 'tilt' && this.tiltOk) steer += this.tilt;
    if (this.mode === 'wheel') {
      if (!this.wheelHeld) this.wheelRot *= Math.exp(-dt * 9);
      if (Math.abs(this.wheelRot) < 0.002) this.wheelRot = 0;
      steer += clamp(this.wheelRot / 1.7 * this.sens, -1, 1); // voller Einschlag bei knapp 100°
      if (this.wheelEl && this._wr !== this.wheelRot) { this._wr = this.wheelRot; this.wheelEl.style.transform = `rotate(${this.wheelRot.toFixed(3)}rad)`; }
    }
    let direct = false;
    let gas = (k.has('ArrowUp') || k.has('KeyW') || b.gas) ? 1 : 0;
    let brake = (k.has('ArrowDown') || k.has('KeyS') || b.brake) ? 1 : 0;
    let hand = k.has('Space') || b.hand;
    let nitro = k.has('ShiftLeft') || k.has('ShiftRight') || b.nitro;
    let look = k.has('KeyX');
    let rewind = k.has('Backspace') || k.has('KeyQ') || b.rewind;
    // Gamepad (Standard-Belegung): RT Gas, LT Bremse, A Handbremse, B/X/RB Nitro, LB Rückblick,
    // Y Kamera, Start Pause, Back Karte; im Menü: Steuerkreuz/Stick wählen, A bestätigen, B zurück
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      // USB-Lenkrad mit Pedalen: eigene Belegung (eingerichtet unter Einstellungen → Lenkrad)
      if (isWheelId(p.id, this.wheelCfg)) {
        const w = this.readWheel(p);
        steer += w.steer; gas = Math.max(gas, w.gas); brake = Math.max(brake, w.brake);
        if (w.hand) hand = true; if (w.nitro) nitro = true; if (w.look) look = true; if (w.rewind) rewind = true;
        direct = true;
        continue;
      }
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (Math.abs(ax) > 0.12) steer += Math.sign(ax) * Math.pow((Math.abs(ax) - 0.12) / 0.88, 1.4);
      const bv = i => (p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
      gas = Math.max(gas, bv(7)); brake = Math.max(brake, bv(6));
      if (bv(0) > 0.5) hand = true;
      if (bv(1) > 0.5 || bv(2) > 0.5 || bv(5) > 0.5) nitro = true;
      if (bv(4) > 0.5) look = true;
      if (bv(13) > 0.5) rewind = true; // Steuerkreuz ↓ halten = zurückspulen
      // Flanken (einmal pro Druck)
      const edge = (name, on) => { const was = this.padPrev[p.index + name]; this.padPrev[p.index + name] = on; if (on && !was) { this.pressed.add(name); this.padUsed = true; } };
      edge('KeyC', bv(3) > 0.5); edge('Escape', bv(9) > 0.5); edge('KeyM', bv(8) > 0.5);
      edge('PadA', bv(0) > 0.5); edge('PadB', bv(1) > 0.5); edge('PadX', bv(2) > 0.5);
      edge('PadUp', bv(12) > 0.5 || ay < -0.6); edge('PadDown', bv(13) > 0.5 || ay > 0.6);
      edge('PadLeft', bv(14) > 0.5 || ax < -0.6); edge('PadRight', bv(15) > 0.5 || ax > 0.6);
      if (gas > 0.2 || Math.abs(ax) > 0.3) this.padUsed = true;
    }
    if (this.autoGas && !brake) gas = Math.max(gas, 1);
    s.steer = clamp(steer, -1, 1);
    s.throttle = gas; s.brake = brake; s.handbrake = hand; s.nitro = nitro; s.look = look; s.rewind = rewind; s.direct = direct;
    return s;
  }

  // Achse erst nutzen, wenn sie sich einmal bewegt hat (manche Browser melden vor der ersten Bewegung 0 statt der Ruhelage)
  axis(p, i) {
    const v = p.axes[i] ?? 0, k = p.index + ':' + i, a = this.axSeen[k];
    if (!a) { this.axSeen[k] = { v0: v, live: false }; return null; }
    if (!a.live && Math.abs(v - a.v0) > 0.03) a.live = true;
    return a.live ? v : null;
  }
  // Pedal: Kanal {k:'a', i, rest, full} (Achse) oder {k:'b', i} (analoger Knopf) → 0…1
  pedal(p, c) {
    if (!c) return 0;
    if (c.k === 'b') { const b = p.buttons[c.i]; return b ? b.value || (b.pressed ? 1 : 0) : 0; }
    const v = this.axis(p, c.i);
    if (v === null || c.full === c.rest) return 0;
    const f = clamp((v - c.rest) / (c.full - c.rest), 0, 1);
    return f < 0.03 ? 0 : clamp((f - 0.03) / 0.95, 0, 1);
  }
  readWheel(p) {
    const cfg = this.wheelCfg && this.wheelCfg.id === p.id ? this.wheelCfg : null;
    const sc = cfg ? cfg.steer : { i: 0, c: 0, r: 1 };
    let st = ((p.axes[sc.i] ?? 0) - sc.c) / (sc.r || 1);
    st = Math.abs(st) < 0.004 ? 0 : st;
    const bv = i => (i >= 0 && p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
    const out = {
      steer: clamp(st * this.wheelGain, -1, 1),
      gas: cfg && cfg.gas ? this.pedal(p, cfg.gas) : bv(7), brake: cfg && cfg.brake ? this.pedal(p, cfg.brake) : bv(6),
      nitro: bv(cfg && cfg.nitro !== undefined ? cfg.nitro : 4) > 0.5, // rechte Schaltwippe
      hand: bv(cfg && cfg.hand !== undefined ? cfg.hand : 5) > 0.5,  // linke Schaltwippe
      look: false, rewind: false,
    };
    if (Math.abs(st) > 0.05 || out.gas > 0.2) { this.wheelUsed = true; this.padUsed = true; }
    if (this.calibrating) return out; // im Einrichten lösen Knöpfe nichts aus
    // Menü: Steuerkreuz als Knöpfe 12–15 oder als „Hat“-Achse (meist Achse 9, Ruhe ≈ 1,29)
    let up = bv(12) > 0.5, down = bv(13) > 0.5, left = bv(14) > 0.5, right = bv(15) > 0.5;
    const hat = p.axes.length > 9 ? p.axes[9] : 9;
    if (hat > 1.1) this.axSeen['hat' + p.index] = true; // Ruhelage gesehen → Achse 9 ist wirklich ein Steuerkreuz
    if (this.axSeen['hat' + p.index] && hat >= -1.05 && hat <= 1.05) {
      const dir = Math.round((hat + 1) / (2 / 7)) % 8; // 0 hoch, 1 hoch-rechts, 2 rechts … 7 hoch-links
      up ||= dir === 7 || dir === 0 || dir === 1; right ||= dir >= 1 && dir <= 3; down ||= dir >= 3 && dir <= 5; left ||= dir >= 5 && dir <= 7;
    }
    const edge = (name, on) => { const was = this.padPrev[p.index + name]; this.padPrev[p.index + name] = on; if (on && !was) this.pressed.add(name); };
    edge('PadA', bv(0) > 0.5); edge('PadB', bv(1) > 0.5); edge('PadX', bv(2) > 0.5); edge('KeyC', bv(3) > 0.5);
    edge('Escape', bv(9) > 0.5); edge('KeyM', bv(8) > 0.5);
    edge('PadUp', up); edge('PadDown', down); edge('PadLeft', left); edge('PadRight', right);
    return out;
  }
  calibrate() { this.tiltZero = this.tiltRaw || 0; }
  took(code) { const h = this.pressed.has(code); this.pressed.delete(code); return h; }
  clearPressed() { this.pressed.clear(); }
}
