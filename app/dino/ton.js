// Dino-Sprint 3D – Töne komplett per WebAudio erzeugt (keine Sounddateien) + kleine Hintergrundmusik.
export class Ton {
  constructor() {
    this.ctx = null;
    this.sfx = true;
    this.musik = true;
    this.musicOn = false;
    this.tempo = 1;
    this.step = 0;
    this.nextT = 0;
  }

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.ctx.destination);
        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = 0.28;
        this.musicBus.connect(this.master);
        setInterval(() => this._schedule(), 60);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { /* kein Ton möglich */ }
  }

  _tone(f, dur, { type = 'square', vol = 0.12, slide = 0, at = 0, bus = null } = {}) {
    const c = this.ctx;
    const t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus || this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _noise(dur, { vol = 0.25, freq = 1200, at = 0, bus = null, q = 0.7 } = {}) {
    const c = this.ctx;
    const t = c.currentTime + at;
    if (!this._nb) {
      this._nb = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = this._nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this._nb;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(bus || this.master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  play(name) {
    if (!this.sfx || !this.ctx || this.ctx.state !== 'running') return;
    switch (name) {
      case 'jump': this._tone(330, 0.16, { slide: 420, vol: 0.09 }); break;
      case 'jump2': this._tone(520, 0.16, { slide: 500, vol: 0.08, type: 'triangle' }); break;
      case 'lane': this._noise(0.08, { vol: 0.05, freq: 2600 }); break;
      case 'duck': this._tone(300, 0.1, { slide: -160, vol: 0.06, type: 'triangle' }); break;
      case 'coin': this._tone(988, 0.07, { vol: 0.06 }); this._tone(1319, 0.14, { vol: 0.06, at: 0.06 }); break;
      case 'gem': [1047, 1319, 1568, 2093].forEach((f, i) => this._tone(f, 0.12, { vol: 0.06, at: i * 0.05, type: 'triangle' })); break;
      case 'power': [523, 659, 784, 1047, 1319].forEach((f, i) => this._tone(f, 0.14, { vol: 0.07, at: i * 0.055, type: 'square' })); break;
      case 'shield': this._tone(880, 0.3, { slide: -500, vol: 0.09, type: 'sawtooth' }); this._noise(0.25, { vol: 0.15, freq: 3000 }); break;
      case 'smash': this._noise(0.35, { vol: 0.35, freq: 900 }); this._tone(140, 0.25, { slide: -80, vol: 0.12 }); break;
      case 'crash': this._noise(0.6, { vol: 0.45, freq: 700 }); this._tone(220, 0.55, { slide: -170, vol: 0.14, type: 'sawtooth' }); break;
      case 'meteor': this._tone(1400, 1.1, { slide: -1200, vol: 0.05, type: 'sine' }); break;
      case 'boom': this._noise(0.9, { vol: 0.55, freq: 420 }); this._tone(90, 0.7, { slide: -50, vol: 0.2, type: 'sine' }); break;
      case 'beep': this._tone(660, 0.16, { vol: 0.1 }); break;
      case 'go': this._tone(990, 0.35, { vol: 0.11 }); break;
      case 'buy': [392, 523, 659, 784].forEach((f, i) => this._tone(f, 0.16, { vol: 0.08, at: i * 0.07, type: 'triangle' })); break;
      case 'click': this._tone(700, 0.05, { vol: 0.05, type: 'triangle' }); break;
      case 'nope': this._tone(200, 0.2, { vol: 0.08, slide: -60 }); break;
      case 'win': [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this._tone(f, 0.18, { vol: 0.08, at: i * 0.09, type: 'square' })); break;
    }
  }

  // ---------------------------------------------------------------- Musik: kleiner Steppen-Groove
  music(on) {
    this.musicOn = on;
    if (on && this.ctx) this.nextT = Math.max(this.nextT, this.ctx.currentTime + 0.05);
  }

  _schedule() {
    const c = this.ctx;
    if (!c || !this.musicOn || !this.musik || c.state !== 'running') return;
    const beat = 0.15 / this.tempo;
    if (this.nextT < c.currentTime) this.nextT = c.currentTime + 0.02;
    const bass = [55, 0, 55, 65.4, 0, 73.4, 65.4, 0, 49, 0, 49, 58.3, 0, 65.4, 58.3, 0];
    const mel = [0, 440, 0, 523, 0, 0, 659, 0, 0, 587, 0, 523, 0, 440, 0, 392];
    while (this.nextT < c.currentTime + 0.25) {
      const s = this.step % 16, bar = Math.floor(this.step / 16) % 4;
      const at = this.nextT - c.currentTime;
      const tr = bar === 2 ? 1.122 : bar === 3 ? 0.891 : 1;
      if (bass[s]) this._tone(bass[s] * 2 * tr, beat * 1.6, { type: 'triangle', vol: 0.32, at, bus: this.musicBus });
      if (mel[s] && bar % 2 === 1) this._tone(mel[s] * tr, beat * 0.9, { type: 'square', vol: 0.05, at, bus: this.musicBus });
      if (s % 4 === 0) this._tone(110, 0.09, { type: 'sine', vol: 0.5, slide: -70, at, bus: this.musicBus });
      if (s % 2 === 1) this._noise(0.04, { vol: 0.08, freq: 7000, at, bus: this.musicBus });
      if (s % 8 === 4) this._noise(0.12, { vol: 0.16, freq: 2400, at, bus: this.musicBus });
      this.nextT += beat;
      this.step++;
    }
  }
}
