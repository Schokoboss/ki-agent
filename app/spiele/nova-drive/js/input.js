// Steuerung: Touch-Tasten (Handy), Wischen, Neigen, Tastatur, Gamepad.
import { clamp, view, logicalPoint } from './util.js';

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
    this.pressed = new Set();
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
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
    s.throttle = gas; s.brake = brake; s.handbrake = hand; s.nitro = nitro; s.look = look; s.rewind = rewind;
    return s;
  }
  calibrate() { this.tiltZero = this.tiltRaw || 0; }
  took(code) { const h = this.pressed.has(code); this.pressed.delete(code); return h; }
  clearPressed() { this.pressed.clear(); }
}
