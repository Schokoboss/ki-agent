'use strict';
// Geräusche – alles live mit WebAudio erzeugt (keine Dateien).
const Ton = (() => {
  let ac = null, master = null, noiseBuf = null;
  let on = true;
  try { on = localStorage.getItem('tumult.ton') !== 'aus'; } catch (e) { /* privat */ }

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.45;
    master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.6, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function tone(type, f0, f1, dur, vol, delay = 0) {
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, 0.005, vol, dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, freq, q = 1, type = 'lowpass', delay = 0, f1 = 0) {
    const t = ac.currentTime + delay, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf;
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, 0.004, vol, dur);
    s.connect(f).connect(g).connect(master);
    s.start(t); s.stop(t + dur + 0.02);
  }

  const SOUNDS = {
    burst: v => { tone('square', 1400, 500, 0.07, 0.12 * v); noise(0.05, 0.08 * v, 4000, 1, 'highpass'); },
    bolt: v => { noise(0.12, 0.22 * v, 1800, 2, 'bandpass', 0, 600); tone('triangle', 300, 120, 0.1, 0.1 * v); },
    seed: v => { tone('sine', 700, 300, 0.1, 0.16 * v); noise(0.06, 0.06 * v, 2500, 2, 'bandpass'); },
    spread: v => { noise(0.18, 0.3 * v, 900, 0.7, 'lowpass', 0, 200); tone('square', 120, 60, 0.12, 0.08 * v); },
    bomb: v => { noise(0.25, 0.12 * v, 600, 3, 'bandpass', 0, 1800); },
    slash: v => { noise(0.14, 0.22 * v, 5000, 3, 'bandpass', 0, 1500); },
    orb: v => { tone('sawtooth', 200, 900, 0.35, 0.1 * v); tone('square', 1200, 300, 0.3, 0.05 * v); },
    pierce: v => { noise(0.25, 0.25 * v, 3000, 4, 'bandpass', 0, 500); tone('sawtooth', 900, 200, 0.2, 0.08 * v); },
    charge: v => { noise(0.4, 0.3 * v, 300, 1, 'lowpass', 0, 900); tone('sawtooth', 90, 60, 0.4, 0.1 * v); },
    bigbomb: v => { noise(0.35, 0.15 * v, 400, 3, 'bandpass', 0, 1500); },
    heal: v => { tone('sine', 500, 1000, 0.3, 0.12 * v); tone('sine', 750, 1500, 0.3, 0.08 * v, 0.06); },
    leap: v => { noise(0.3, 0.15 * v, 800, 2, 'bandpass', 0, 3000); },
    boom: v => { noise(0.6, 0.55 * v, 800, 0.8, 'lowpass', 0, 60); tone('sine', 110, 35, 0.5, 0.35 * v); },
    land: v => { noise(0.35, 0.4 * v, 500, 0.8, 'lowpass', 0, 80); tone('sine', 160, 50, 0.3, 0.25 * v); },
    hit: v => { tone('square', 260, 140, 0.06, 0.12 * v); },
    hurt: v => { tone('sawtooth', 200, 90, 0.15, 0.18 * v); noise(0.08, 0.12 * v, 1200); },
    ko: v => { tone('square', 600, 80, 0.4, 0.16 * v); noise(0.35, 0.2 * v, 1500, 1, 'lowpass', 0, 200); },
    pick: v => { tone('sine', 880, 0, 0.08, 0.14 * v); tone('sine', 1320, 0, 0.12, 0.12 * v, 0.06); },
    crystal: v => { tone('triangle', 1200, 0, 0.1, 0.13 * v); tone('triangle', 1800, 0, 0.18, 0.1 * v, 0.07); },
    ready: v => { [660, 880, 1100].forEach((f, i) => tone('triangle', f, 0, 0.14, 0.12 * v, i * 0.07)); },
    crate: v => { noise(0.25, 0.3 * v, 700, 1, 'bandpass', 0, 200); },
    puff: v => { noise(0.05, 0.05 * v, 1500, 1, 'bandpass'); },
    empty: v => { tone('square', 140, 0, 0.05, 0.08 * v); },
    click: v => { tone('triangle', 900, 600, 0.05, 0.1 * v); },
    spawn: v => { tone('sine', 300, 900, 0.25, 0.1 * v); },
    win: v => { [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, 0, 0.3, 0.16 * v, i * 0.13)); },
    lose: v => { [392, 330, 262, 196].forEach((f, i) => tone('triangle', f, 0, 0.35, 0.14 * v, i * 0.16)); },
    tick: v => { tone('square', 1000, 0, 0.04, 0.08 * v); },
    emote: v => { tone('sine', 700, 1100, 0.12, 0.1 * v); },
  };

  return {
    init,
    get on() { return on; },
    toggle() {
      on = !on;
      try { localStorage.setItem('tumult.ton', on ? 'an' : 'aus'); } catch (e) { /* egal */ }
      return on;
    },
    play(name, vol = 1) {
      if (!on || !ac || !SOUNDS[name] || vol <= 0.02) return;
      if (ac.state === 'suspended') ac.resume();
      try { SOUNDS[name](Math.min(1, vol)); } catch (e) { /* Audio-Fehler nie das Spiel stören lassen */ }
    },
  };
})();
