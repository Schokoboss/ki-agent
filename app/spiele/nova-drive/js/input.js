// Steuerung: Touch-Tasten (Handy), Wischen, Neigen, Tastatur, Gamepad.
import { clamp } from './util.js';

export class Input {
  constructor() {
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
    this.keys = new Set();
    this.btn = { left: false, right: false, gas: false, brake: false, hand: false, nitro: false };
    this.mode = 'buttons'; // buttons | slider | tilt
    this.autoGas = false;
    this.tilt = 0; this.tiltOk = false;
    this.slider = null; this.sliderVal = 0;
    this.pressed = new Set();
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) && e.target === document.body) e.preventDefault();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); for (const k in this.btn) this.btn[k] = false; });
  }

  bindTouch(root) {
    const map = { 'c-left': 'left', 'c-right': 'right', 'c-gas': 'gas', 'c-brake': 'brake', 'c-hand': 'hand', 'c-nitro': 'nitro' };
    for (const [id, key] of Object.entries(map)) {
      const el = root.querySelector('#' + id);
      if (!el) continue;
      const ids = new Set();
      const upd = () => { this.btn[key] = ids.size > 0; el.classList.toggle('on', ids.size > 0); };
      el.addEventListener('pointerdown', e => { e.preventDefault(); ids.add(e.pointerId); try { el.setPointerCapture(e.pointerId); } catch {} upd(); if (navigator.vibrate && key !== 'gas') navigator.vibrate(8); });
      const up = e => { ids.delete(e.pointerId); upd(); };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    }
    // Wisch-Lenkung: linke Hälfte, horizontal ziehen
    const zone = root.querySelector('#c-slider');
    if (zone) {
      let id = null, x0 = 0;
      zone.addEventListener('pointerdown', e => { id = e.pointerId; x0 = e.clientX; zone.setPointerCapture(id); this.sliderVal = 0; this.moveKnob(zone, 0); });
      zone.addEventListener('pointermove', e => { if (e.pointerId !== id) return; this.sliderVal = clamp((e.clientX - x0) / 70, -1, 1); this.moveKnob(zone, this.sliderVal); });
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
        const ang = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 90;
        const sgn = ang === 90 ? 1 : ang === 270 || ang === -90 ? -1 : 0;
        let v = (sgn ? a.y * sgn : a.x) / 9.81;
        this.tilt = clamp(Math.abs(v) < 0.04 ? 0 : v * 2.4, -1, 1);
        this.tiltOk = true;
      });
    }
    return true;
  }

  poll() {
    const k = this.keys, b = this.btn, s = this.state;
    let steer = 0;
    if (k.has('ArrowLeft') || k.has('KeyA')) steer -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) steer += 1;
    if (b.left) steer -= 1;
    if (b.right) steer += 1;
    if (this.mode === 'slider') steer += this.sliderVal;
    if (this.mode === 'tilt' && this.tiltOk) steer += this.tilt;
    let gas = (k.has('ArrowUp') || k.has('KeyW') || b.gas) ? 1 : 0;
    let brake = (k.has('ArrowDown') || k.has('KeyS') || b.brake) ? 1 : 0;
    let hand = k.has('Space') || b.hand;
    let nitro = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyN') || b.nitro;
    // Gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.12) steer += ax;
      const bv = i => (p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
      gas = Math.max(gas, bv(7)); brake = Math.max(brake, bv(6));
      if (bv(0) > 0.5) hand = true;
      if (bv(1) > 0.5 || bv(2) > 0.5) nitro = true;
      if (bv(3) > 0.5) this.pressed.add('KeyC');
      if (bv(9) > 0.5) this.pressed.add('Escape');
    }
    if (this.autoGas && !brake) gas = Math.max(gas, 1);
    s.steer = clamp(steer, -1, 1);
    s.throttle = gas; s.brake = brake; s.handbrake = hand; s.nitro = nitro;
    return s;
  }
  took(code) { const h = this.pressed.has(code); this.pressed.delete(code); return h; }
  clearPressed() { this.pressed.clear(); }
}
