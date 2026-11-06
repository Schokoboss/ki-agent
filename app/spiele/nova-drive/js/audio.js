// Ton komplett synthetisch (WebAudio): Motor, Reifen, Wind, Effekte und ein generatives Radio.
import { clamp, mulberry32 } from './util.js';

export class Audio {
  constructor() {
    this.ctx = null; this.ok = false;
    this.sfxVol = 0.8; this.musicVol = 0.5;
    this.station = 0; this.beat = 0;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = 0.9;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = this.sfxVol; this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.gain.value = this.musicVol; this.music.connect(this.master);
    // Rauschen
    const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    // Motor: zwei Sägezähne + Rechteck, Verzerrung, Tiefpass
    this.eng = c.createGain(); this.eng.gain.value = 0;
    this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 800; this.engF.Q.value = 3;
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.6); }
    shaper.curve = curve;
    this.o1 = c.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = c.createOscillator(); this.o2.type = 'sawtooth';
    this.o3 = c.createOscillator(); this.o3.type = 'square';
    const g1 = c.createGain(), g2 = c.createGain(), g3 = c.createGain();
    g1.gain.value = 0.5; g2.gain.value = 0.35; g3.gain.value = 0.22;
    this.o1.connect(g1); this.o2.connect(g2); this.o3.connect(g3);
    [g1, g2, g3].forEach(g => g.connect(shaper));
    shaper.connect(this.engF); this.engF.connect(this.eng); this.eng.connect(this.sfx);
    // Brummen (LFO auf Lautstärke) für Leerlauf-Charakter
    this.lfo = c.createOscillator(); this.lfo.frequency.value = 18;
    this.lfoG = c.createGain(); this.lfoG.gain.value = 0.0;
    this.lfo.connect(this.lfoG); this.lfoG.connect(this.eng.gain);
    [this.o1, this.o2, this.o3, this.lfo].forEach(o => o.start());
    // Reifen
    this.tire = this.loopNoise('bandpass', 1100, 1.4);
    this.wind = this.loopNoise('lowpass', 500, 0.5);
    this.nitroS = this.loopNoise('bandpass', 2400, 0.6);
    this.gravel = this.loopNoise('lowpass', 260, 0.8);
    this.rainS = this.loopNoise('highpass', 2600, 0.4);
    this.ok = true;
    this.startRadio();
  }
  loopNoise(type, f, q) {
    const c = this.ctx, src = c.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(fl); fl.connect(g); g.connect(this.sfx);
    src.start();
    return { g, fl };
  }
  setVolumes(sfx, music) {
    this.sfxVol = sfx; this.musicVol = music;
    if (!this.ctx) return;
    this.sfx.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
    this.music.gain.setTargetAtTime(this.station === 3 ? 0 : music, this.ctx.currentTime, 0.1);
  }
  // pro Bild: Motorzustand
  updateCar(car, inp, active, style) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, K = 0.04;
    const rpm = active ? car.rpm : 0;
    const base = style === 'ev' ? 0 : (style === 'muscle' ? 34 : style === 'hyper' ? 48 : style === 'truck' ? 30 : 40);
    if (style === 'ev') {
      const f = 120 + Math.abs(car.vf) * 18;
      this.o1.frequency.setTargetAtTime(f, t, K); this.o2.frequency.setTargetAtTime(f * 1.5, t, K); this.o3.frequency.setTargetAtTime(f * 0.5, t, K);
      this.engF.frequency.setTargetAtTime(1800, t, K);
      this.eng.gain.setTargetAtTime(active ? 0.04 + Math.min(0.1, Math.abs(car.vf) * 0.002) : 0, t, 0.08);
      this.lfoG.gain.setTargetAtTime(0, t, 0.1);
    } else {
      const f = base + rpm * base * 4.2;
      this.o1.frequency.setTargetAtTime(f, t, K);
      this.o2.frequency.setTargetAtTime(f * 1.007 * 2, t, K);
      this.o3.frequency.setTargetAtTime(f * 0.5, t, K);
      const load = inp.throttle || 0;
      this.engF.frequency.setTargetAtTime(350 + rpm * 2200 * (0.45 + load * 0.55) + (car.nitroOn ? 900 : 0), t, K);
      this.eng.gain.setTargetAtTime(active ? 0.12 + load * 0.1 + rpm * 0.05 : 0, t, 0.06);
      this.lfo.frequency.setTargetAtTime(8 + rpm * 30, t, K);
      this.lfoG.gain.setTargetAtTime(active && rpm < 0.3 ? 0.05 : 0, t, 0.1);
    }
    const spd = Math.abs(car.vf);
    this.tire.g.gain.setTargetAtTime(active && car.grounded ? car.slipAmt * (car.surface === 1 ? 0.22 : 0.06) : 0, t, 0.05);
    this.tire.fl.frequency.setTargetAtTime(900 + car.slipAmt * 600, t, 0.1);
    this.gravel.g.gain.setTargetAtTime(active && car.grounded && car.surface !== 1 ? Math.min(0.25, spd * 0.006) : 0, t, 0.08);
    this.wind.g.gain.setTargetAtTime(active ? Math.min(0.22, spd * spd * 0.00004) : 0, t, 0.1);
    this.wind.fl.frequency.setTargetAtTime(300 + spd * 12, t, 0.1);
    this.nitroS.g.gain.setTargetAtTime(active && car.nitroOn ? 0.14 : 0, t, 0.05);
  }
  // kurze Geräusche
  play(name, amt = 1) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const env = (g, a, d, v) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
    const tone = (type, f0, f1, dur, vol, delay = 0) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t + delay); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + delay + dur);
      g.gain.setValueAtTime(0.0001, t + delay); g.gain.exponentialRampToValueAtTime(vol, t + delay + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      o.connect(g); g.connect(this.sfx); o.start(t + delay); o.stop(t + delay + dur + 0.05);
    };
    const noise = (f, q, dur, vol, type = 'bandpass') => {
      const s = c.createBufferSource(); s.buffer = this.noiseBuf;
      const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = c.createGain(); env(g, 0.005, dur, vol);
      s.connect(fl); fl.connect(g); g.connect(this.sfx); s.start(t, Math.random()); s.stop(t + dur + 0.1);
    };
    switch (name) {
      case 'crash': noise(500, 0.7, 0.35 + amt * 0.3, Math.min(1, 0.3 + amt * 0.5), 'lowpass'); tone('sine', 120, 40, 0.3, 0.5 * amt); noise(3000, 1, 0.15, 0.2 * amt); break;
      case 'bump': noise(300, 0.8, 0.15, 0.25 * amt, 'lowpass'); break;
      case 'smash': noise(1800, 0.8, 0.18, 0.35); tone('square', 300, 90, 0.12, 0.08); break;
      case 'wood': noise(900, 2, 0.12, 0.4); noise(400, 1, 0.2, 0.3, 'lowpass'); break;
      case 'land': noise(200, 0.7, 0.25, Math.min(0.8, 0.2 + amt * 0.05), 'lowpass'); break;
      case 'shift': noise(4000, 1, 0.05, 0.08); break;
      case 'skill': tone('triangle', 880, 880, 0.08, 0.15); tone('triangle', 1320, 1320, 0.12, 0.13, 0.07); break;
      case 'bank': [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.18, 0.16, i * 0.07)); break;
      case 'lost': tone('sawtooth', 300, 90, 0.4, 0.15); break;
      case 'cp': tone('sine', 1200, 1200, 0.1, 0.2); tone('sine', 1800, 1800, 0.15, 0.15, 0.08); break;
      case 'count': tone('square', 660, 660, 0.18, 0.12); break;
      case 'go': tone('square', 1320, 1320, 0.45, 0.14); break;
      case 'win': [523, 659, 784, 1047, 1319].forEach((f, i) => tone('triangle', f, f, 0.3, 0.17, i * 0.09)); break;
      case 'ui': tone('sine', 700, 900, 0.06, 0.1); break;
      case 'buy': tone('triangle', 600, 1200, 0.15, 0.15); tone('triangle', 1200, 1600, 0.2, 0.12, 0.12); break;
      case 'trap': tone('sine', 1500, 1500, 0.06, 0.2); noise(5000, 1, 0.06, 0.15); break;
      case 'nitro': noise(1500, 0.5, 0.4, 0.3); break;
      case 'splash': noise(800, 0.5, 0.8, 0.6, 'lowpass'); break;
      case 'shutter': noise(5000, 1, 0.05, 0.35); noise(1800, 1, 0.08, 0.25); break;
      case 'thunder': noise(90, 0.6, 2.8 * amt + 1, 0.9 * amt, 'lowpass'); noise(400, 0.5, 0.6, 0.3 * amt, 'lowpass'); tone('sine', 55, 30, 2.2, 0.35 * amt); break;
      case 'firework': noise(300, 0.5, 0.8, 0.3 * amt, 'lowpass'); noise(4000, 0.7, 0.5, 0.06 * amt); break;
    }
  }

  // ---------------------------------------------------------------- Radio (eigene, generative Musik)
  setStation(i) {
    this.station = i;
    if (!this.ctx) return;
    this.music.gain.setTargetAtTime(i === 3 ? 0 : this.musicVol, this.ctx.currentTime, 0.2);
    this.seqStep = 0; this.bar = 0;
    this.rng = mulberry32(100 + i * 17 + Math.floor(Math.random() * 1000));
    this.pickSong();
  }
  pickSong() {
    const r = this.rng;
    const progs = [[0, 5, 3, 4], [0, 3, 4, 3], [5, 3, 0, 4], [0, 4, 5, 3], [0, 6, 5, 4], [3, 0, 4, 5]];
    this.prog = progs[Math.floor(r() * progs.length)];
    this.root = [45, 47, 48, 50, 52, 43][Math.floor(r() * 6)];
    this.arp = Array.from({ length: 16 }, () => Math.floor(r() * 5));
    this.melody = Array.from({ length: 32 }, () => (r() < 0.45 ? -1 : Math.floor(r() * 7)));
    this.songBars = 0;
  }
  startRadio() {
    const c = this.ctx;
    const rev = c.createConvolver();
    const len = c.sampleRate * 1.6, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    rev.buffer = ir;
    this.rev = c.createGain(); this.rev.gain.value = 0.25;
    this.rev.connect(rev); rev.connect(this.music);
    this.setStation(this.station);
    this.nextTime = c.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 50);
  }
  schedule() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx;
    const st = this.station;
    if (st === 3) { this.nextTime = c.currentTime + 0.1; return; }
    const bpm = [124, 98, 172][st];
    const spb = 60 / bpm / 4; // 16tel
    while (this.nextTime < c.currentTime + 0.15) {
      this.step(this.seqStep, this.nextTime, st, spb);
      this.nextTime += spb;
      this.seqStep = (this.seqStep + 1) % 16;
      if (this.seqStep === 0) { this.bar++; this.songBars++; if (this.songBars >= 32) this.pickSong(); }
    }
  }
  note(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  scale(deg, oct = 0) { const S = [0, 2, 3, 5, 7, 8, 10]; return this.root + S[((deg % 7) + 7) % 7] + 12 * (Math.floor(deg / 7) + oct); }
  step(i, t, st, spb) {
    const chord = this.prog[Math.floor(this.bar / 2) % 4];
    const section = Math.floor(this.songBars / 8) % 4; // 0 Intro, 1 Groove, 2 Break, 3 Drop
    const full = section === 1 || section === 3;
    if (i === 0 || i === 8) this.beat = 1;
    if (st === 0) { // House / Electro
      if (i % 4 === 0 && section !== 2) this.kick(t, 1);
      if (i % 4 === 2 && full) this.hat(t, 0.25, true);
      if (i % 2 === 1) this.hat(t, 0.08);
      if ((i === 4 || i === 12) && section !== 0) this.clap(t);
      if (i % 2 === 0 && section !== 0) this.bass(t, this.note(this.scale(chord, -1) - 0) * (i % 4 === 2 ? 2 : 1), spb * 1.6, 0.16);
      if (full || section === 2) this.pluck(t, this.note(this.scale(chord + this.arp[i], 1)), spb * 1.4, 0.05);
      if (i === 0 && this.bar % 2 === 0) this.pad(t, chord, spb * 32, 0.035);
    } else if (st === 1) { // Synthwave
      if ((i === 0 || i === 8) && section !== 0) this.kick(t, 0.9);
      if ((i === 4 || i === 12) && section !== 0) this.snare(t, 0.35);
      if (i % 2 === 0 && full) this.hat(t, 0.07);
      this.bass(t, this.note(this.scale(chord, -1)) * (i % 2 ? 2 : 1), spb * 0.9, 0.12, 'sawtooth');
      if (i === 0 && this.bar % 2 === 0) this.pad(t, chord, spb * 32, 0.05);
      if (section >= 1 && i % 2 === 0) { const m = this.melody[(this.bar % 2) * 16 + i]; if (m >= 0) this.lead(t, this.note(this.scale(chord + m, 1)), spb * 2.5, 0.045); }
    } else { // Drum & Bass
      if (i === 0 || i === 10) this.kick(t, 1);
      if (i === 4 || i === 12) this.snare(t, 0.5);
      if (i % 2 === 1) this.hat(t, 0.06);
      if (i % 8 === 0) this.bass(t, this.note(this.scale(chord, -2)), spb * 7, 0.2, 'sine', true);
      if (full && i % 4 === 0) this.pluck(t, this.note(this.scale(chord + this.arp[i], 1)), spb * 3, 0.04);
      if (i === 0 && this.bar % 4 === 0) this.pad(t, chord, spb * 64, 0.04);
    }
  }
  kick(t, v) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.7 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g); g.connect(this.music); o.start(t); o.stop(t + 0.4);
  }
  hat(t, v, open) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = c.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.2 : 0.05));
    s.connect(f); f.connect(g); g.connect(this.music); s.start(t, Math.random()); s.stop(t + 0.25);
  }
  clap(t) { this.snare(t, 0.3, 1500); }
  snare(t, v, f0 = 1000) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = f0; f.Q.value = 0.8;
    const g = c.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    s.connect(f); f.connect(g); g.connect(this.music); g.connect(this.rev); s.start(t, Math.random()); s.stop(t + 0.2);
    const o = c.createOscillator(), og = c.createGain(); o.frequency.value = 190;
    og.gain.setValueAtTime(v * 0.4, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(og); og.connect(this.music); o.start(t); o.stop(t + 0.1);
  }
  bass(t, f, dur, v, type = 'square', glide) {
    const c = this.ctx, o = c.createOscillator(), fl = c.createBiquadFilter(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(f * 0.98, t + dur);
    fl.type = 'lowpass'; fl.frequency.setValueAtTime(900, t); fl.frequency.exponentialRampToValueAtTime(200, t + dur);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(fl); fl.connect(g); g.connect(this.music); o.start(t); o.stop(t + dur + 0.05);
  }
  pluck(t, f, dur, v) {
    const c = this.ctx, o = c.createOscillator(), fl = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = f;
    fl.type = 'lowpass'; fl.frequency.setValueAtTime(3500, t); fl.frequency.exponentialRampToValueAtTime(400, t + dur);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(fl); fl.connect(g); g.connect(this.music); g.connect(this.rev); o.start(t); o.stop(t + dur + 0.05);
  }
  lead(t, f, dur, v) {
    const c = this.ctx, o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o2.type = 'sawtooth'; o.frequency.value = f; o2.frequency.value = f * 1.005;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); o2.connect(g); g.connect(this.music); g.connect(this.rev);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  pad(t, chord, dur, v) {
    const c = this.ctx, g = c.createGain(), fl = c.createBiquadFilter();
    fl.type = 'lowpass'; fl.frequency.value = 1400;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    fl.connect(g); g.connect(this.music); g.connect(this.rev);
    for (const d of [0, 2, 4]) for (const det of [0.997, 1.003]) {
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = this.note(this.scale(chord + d, 0)) * det;
      o.connect(fl); o.start(t); o.stop(t + dur + 0.1);
    }
  }
  tick(dt) { this.beat = Math.max(0, this.beat - dt * 3); }
  setRain(a) { if (this.ok) this.rainS.g.gain.setTargetAtTime(a * 0.13, this.ctx.currentTime, 0.3); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
}
