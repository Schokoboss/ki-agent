'use strict';
// Zeichnungen: Helden, Geschosse, Gegenstände, Kacheln. Alles Vektorgrafik, Maße in Pixeln.
const Grafik = (() => {
  const TAU = Math.PI * 2;
  const HERO_COLORS = { funke: '#ffc93c', bolzen: '#7bd389', brocken: '#a3a8bf', zunder: '#ff7a45', mira: '#46d1c4', klinge: '#b07cff' };

  function shade(hex, f) {
    let n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; } else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }
  function ell(c, x, y, rx, ry, rot = 0) { c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU); c.fill(); }
  function circ(c, x, y, r) { c.beginPath(); c.arc(x, y, Math.max(0.1, r), 0, TAU); c.fill(); }

  // ---------------------------------------------------------------- Helden

  const ROCK = [1, 0.92, 1.04, 0.95, 1.02, 0.9, 1.05, 0.96, 1.0, 0.93];

  function body(c, key, x, y, r, col) {
    const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.1);
    g.addColorStop(0, shade(col, 0.35)); g.addColorStop(0.7, col); g.addColorStop(1, shade(col, -0.25));
    c.fillStyle = g;
    c.strokeStyle = shade(col, -0.6);
    c.lineWidth = Math.max(1.5, r * 0.1);
    c.beginPath();
    if (key === 'brocken') {
      for (let i = 0; i < ROCK.length; i++) {
        const a = i / ROCK.length * TAU - Math.PI / 2, rr = r * 1.08 * ROCK[i];
        c[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      c.closePath();
    } else {
      c.arc(x, y, r, 0, TAU);
    }
    c.fill(); c.stroke();
    if (key === 'brocken') {
      c.strokeStyle = shade(col, -0.45); c.lineWidth = Math.max(1, r * 0.06);
      c.beginPath();
      c.moveTo(x - r * 0.7, y + r * 0.1); c.lineTo(x - r * 0.4, y + r * 0.25); c.lineTo(x - r * 0.45, y + r * 0.55);
      c.moveTo(x + r * 0.55, y - r * 0.05); c.lineTo(x + r * 0.35, y + r * 0.3);
      c.stroke();
    }
    if (key === 'klinge') {           // Tuch vor dem Mund
      c.save(); c.beginPath(); c.arc(x, y, r * 0.97, 0, TAU); c.clip();
      c.fillStyle = '#2b2140'; c.fillRect(x - r, y + r * 0.12, r * 2, r);
      c.restore();
    }
    if (key === 'zunder') {           // Halstuch
      c.fillStyle = '#d6332f';
      c.beginPath(); c.ellipse(x, y + r * 0.55, r * 0.75, r * 0.25, 0, 0, Math.PI); c.fill();
    }
  }

  function face(c, key, x, y, r, lx, ly) {
    const fx = x + lx * r * 0.22, fy = y - r * 0.12 + ly * r * 0.14;
    const back = ly < -0.75;
    if (back) return;                 // schaut nach oben: Gesicht abgewandt
    if (key === 'bolzen') {           // Visier
      c.fillStyle = '#1f3b2a';
      c.beginPath(); c.roundRect(fx - r * 0.62, fy - r * 0.2, r * 1.24, r * 0.36, r * 0.15); c.fill();
      c.fillStyle = '#fff36b';
      circ(c, fx - r * 0.25 + lx * r * 0.08, fy - r * 0.02, r * 0.09);
      circ(c, fx + r * 0.25 + lx * r * 0.08, fy - r * 0.02, r * 0.09);
      return;
    }
    const ew = key === 'klinge' ? 0.12 : 0.2, eh = key === 'klinge' ? 0.12 : 0.25;
    for (const s of [-1, 1]) {
      const ex = fx + s * r * 0.3;
      c.fillStyle = '#fff';
      ell(c, ex, fy, r * ew, r * eh);
      c.fillStyle = '#1c1530';
      circ(c, ex + lx * r * 0.07, fy + ly * r * 0.07, r * (key === 'klinge' ? 0.07 : 0.1));
    }
    if (key === 'brocken' || key === 'klinge') {   // grimmige Brauen
      c.strokeStyle = key === 'brocken' ? '#3d3f4d' : '#1c1530'; c.lineWidth = Math.max(1.2, r * 0.09);
      c.beginPath();
      c.moveTo(fx - r * 0.5, fy - r * 0.3); c.lineTo(fx - r * 0.14, fy - r * 0.18);
      c.moveTo(fx + r * 0.5, fy - r * 0.3); c.lineTo(fx + r * 0.14, fy - r * 0.18);
      c.stroke();
    }
  }

  function hat(c, key, x, y, r, col, t, lx) {
    if (key === 'funke') {            // Blitz-Stacheln
      c.fillStyle = '#fff6c2'; c.strokeStyle = '#c58a00'; c.lineWidth = Math.max(1, r * 0.06);
      for (const [a, s] of [[-0.55, 0.8], [0, 1], [0.55, 0.8]]) {
        const bx = x + Math.sin(a) * r * 0.75, by = y - Math.cos(a) * r * 0.75;
        c.save(); c.translate(bx, by); c.rotate(a);
        c.beginPath();
        c.moveTo(-r * 0.18, 0); c.lineTo(-r * 0.02, -r * 0.42 * s); c.lineTo(-r * 0.08, -r * 0.22 * s);
        c.lineTo(r * 0.12, -r * 0.62 * s); c.lineTo(r * 0.04, -r * 0.18 * s); c.lineTo(r * 0.18, 0);
        c.closePath(); c.fill(); c.stroke(); c.restore();
      }
    } else if (key === 'bolzen') {    // Kapuze
      c.fillStyle = '#3f8f5a';
      c.beginPath();
      c.moveTo(x - r * 1.0, y - r * 0.05);
      c.quadraticCurveTo(x - r * 0.9, y - r * 1.1, x - lx * r * 0.2, y - r * 1.45);
      c.quadraticCurveTo(x + r * 0.9, y - r * 1.1, x + r * 1.0, y - r * 0.05);
      c.quadraticCurveTo(x, y - r * 0.55, x - r * 1.0, y - r * 0.05);
      c.fill();
      c.strokeStyle = '#24563a'; c.lineWidth = Math.max(1, r * 0.07); c.stroke();
    } else if (key === 'brocken') {   // Moos
      c.fillStyle = '#5d9b4a';
      ell(c, x - r * 0.15, y - r * 0.85, r * 0.45, r * 0.2, -0.2);
      ell(c, x + r * 0.3, y - r * 0.8, r * 0.28, r * 0.15, 0.3);
      c.fillStyle = '#ff8fb1'; circ(c, x + r * 0.35, y - r * 0.92, r * 0.09);
    } else if (key === 'zunder') {    // Lunte mit Funken
      c.strokeStyle = '#4a3426'; c.lineWidth = Math.max(1.5, r * 0.1);
      c.beginPath(); c.moveTo(x, y - r * 0.95);
      c.quadraticCurveTo(x + r * 0.35, y - r * 1.35, x + r * 0.15, y - r * 1.55); c.stroke();
      const f = 0.7 + 0.3 * Math.sin(t * 30);
      c.fillStyle = '#ffd23f'; circ(c, x + r * 0.15, y - r * 1.58, r * 0.16 * f);
      c.fillStyle = '#fff'; circ(c, x + r * 0.15, y - r * 1.58, r * 0.07 * f);
      c.fillStyle = '#2b2b33';
      c.beginPath(); c.roundRect(x - r * 0.95, y - r * 0.38, r * 1.9, r * 0.18, r * 0.08); c.fill();
    } else if (key === 'mira') {      // Blätter + Blüte
      c.fillStyle = '#3fae49';
      ell(c, x - r * 0.28, y - r * 1.1, r * 0.34, r * 0.15, -0.7);
      ell(c, x + r * 0.28, y - r * 1.1, r * 0.34, r * 0.15, 0.7);
      c.strokeStyle = '#2d7d35'; c.lineWidth = Math.max(1, r * 0.07);
      c.beginPath(); c.moveTo(x, y - r * 0.9); c.lineTo(x, y - r * 1.15); c.stroke();
      c.fillStyle = '#ff8fd0';
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + t; circ(c, x + r * 0.62 + Math.cos(a) * r * 0.12, y - r * 0.55 + Math.sin(a) * r * 0.12, r * 0.09); }
      c.fillStyle = '#ffe066'; circ(c, x + r * 0.62, y - r * 0.55, r * 0.07);
    } else if (key === 'klinge') {    // Stirnband mit wehenden Enden
      c.fillStyle = '#e8384f';
      c.beginPath(); c.roundRect(x - r * 0.98, y - r * 0.55, r * 1.96, r * 0.2, r * 0.08); c.fill();
      c.strokeStyle = '#e8384f'; c.lineWidth = Math.max(1.5, r * 0.12); c.lineCap = 'round';
      const side = lx > 0 ? -1 : 1, w = Math.sin(t * 9) * r * 0.15;
      c.beginPath(); c.moveTo(x + side * r * 0.9, y - r * 0.45);
      c.quadraticCurveTo(x + side * r * 1.35, y - r * 0.5 + w, x + side * r * 1.6, y - r * 0.2 - w); c.stroke();
      c.beginPath(); c.moveTo(x + side * r * 0.9, y - r * 0.42);
      c.quadraticCurveTo(x + side * r * 1.25, y - r * 0.25 - w, x + side * r * 1.45, y + r * 0.05 + w); c.stroke();
      c.lineCap = 'butt';
    }
  }

  function weapon(c, key, x, y, r, ang, t) {
    c.save(); c.translate(x, y); c.rotate(ang);
    const lw = Math.max(1, r * 0.08);
    c.lineWidth = lw;
    if (key === 'funke') {
      c.fillStyle = '#5b6170'; c.strokeStyle = '#2a2d36';
      c.beginPath(); c.roundRect(r * 0.55, -r * 0.18, r * 0.95, r * 0.36, r * 0.12); c.fill(); c.stroke();
      c.fillStyle = '#ffd23f';
      for (let i = 0; i < 3; i++) c.fillRect(r * (0.7 + i * 0.22), -r * 0.2, r * 0.08, r * 0.4);
      c.fillStyle = `rgba(255,240,120,${0.6 + 0.4 * Math.sin(t * 20)})`; circ(c, r * 1.55, 0, r * 0.13);
    } else if (key === 'bolzen') {
      c.fillStyle = '#8a5a35'; c.strokeStyle = '#4b2e17';
      c.beginPath(); c.roundRect(r * 0.4, -r * 0.1, r * 1.25, r * 0.2, r * 0.06); c.fill(); c.stroke();
      c.strokeStyle = '#5b3a1f'; c.lineWidth = Math.max(1.5, r * 0.12);
      c.beginPath(); c.arc(r * 1.05, 0, r * 0.55, -1.2, 1.2); c.stroke();
      c.strokeStyle = '#ddd'; c.lineWidth = Math.max(0.8, r * 0.04);
      c.beginPath(); c.moveTo(r * 1.05 + Math.cos(-1.2) * r * 0.55, Math.sin(-1.2) * r * 0.55);
      c.lineTo(r * 0.75, 0); c.lineTo(r * 1.05 + Math.cos(1.2) * r * 0.55, Math.sin(1.2) * r * 0.55); c.stroke();
    } else if (key === 'brocken') {
      c.fillStyle = '#8b90a6'; c.strokeStyle = '#4c5062';
      for (const s of [-1, 1]) { c.beginPath(); c.arc(r * 0.85, s * r * 0.6, r * 0.33, 0, TAU); c.fill(); c.stroke(); }
    } else if (key === 'zunder') {
      c.fillStyle = '#2b2b33'; c.strokeStyle = '#000';
      c.beginPath(); c.arc(r * 1.0, r * 0.35, r * 0.3, 0, TAU); c.fill();
      c.fillStyle = '#ff9f1c'; circ(c, r * 1.12, r * 0.06, r * 0.08 * (0.7 + 0.3 * Math.sin(t * 25)));
    } else if (key === 'mira') {
      c.strokeStyle = '#7a4a26'; c.lineWidth = Math.max(1.5, r * 0.12); c.lineCap = 'round';
      c.beginPath(); c.moveTo(r * 0.6, 0); c.lineTo(r * 1.0, 0);
      c.moveTo(r * 1.0, 0); c.lineTo(r * 1.35, -r * 0.3); c.moveTo(r * 1.0, 0); c.lineTo(r * 1.35, r * 0.3); c.stroke();
      c.strokeStyle = '#e9e1c8'; c.lineWidth = Math.max(0.8, r * 0.04);
      c.beginPath(); c.moveTo(r * 1.35, -r * 0.3); c.lineTo(r * 1.15, 0); c.lineTo(r * 1.35, r * 0.3); c.stroke();
      c.lineCap = 'butt';
    } else if (key === 'klinge') {
      c.fillStyle = '#3a2b4f'; c.fillRect(r * 0.55, -r * 0.08, r * 0.35, r * 0.16);
      c.fillStyle = '#d9dde8'; c.strokeStyle = '#7d8396';
      c.beginPath(); c.moveTo(r * 0.9, -r * 0.13); c.quadraticCurveTo(r * 1.6, -r * 0.3, r * 2.0, -r * 0.05);
      c.lineTo(r * 0.9, r * 0.13); c.closePath(); c.fill(); c.stroke();
    }
    c.restore();
  }

  /** Held zeichnen. o: { ring, ringW, flash (0..1), alpha, t, moving, lift (px), glow } */
  function hero(c, key, x, y, r, ang, o = {}) {
    const col = HERO_COLORS[key] || '#ccc', t = o.t || 0;
    c.save();
    if (o.alpha != null) c.globalAlpha *= o.alpha;
    c.fillStyle = 'rgba(0,0,0,.28)';
    ell(c, x, y + r * 0.8, r * 0.95 * (o.lift ? 0.7 : 1), r * 0.36 * (o.lift ? 0.7 : 1));
    if (o.ring) {
      c.strokeStyle = o.ring; c.lineWidth = o.ringW || Math.max(2, r * 0.13);
      c.beginPath(); c.ellipse(x, y + r * 0.8, r * 1.08, r * 0.46, 0, 0, TAU); c.stroke();
    }
    if (o.glow) {
      c.strokeStyle = `rgba(255,215,64,${0.5 + 0.35 * Math.sin(t * 8)})`; c.lineWidth = Math.max(2, r * 0.12);
      c.beginPath(); c.ellipse(x, y + r * 0.8, r * 1.35, r * 0.6, 0, 0, TAU); c.stroke();
    }
    y -= o.lift || 0;
    const lx = Math.cos(ang), ly = Math.sin(ang);
    const step = o.moving ? Math.sin(t * 15) : 0;
    const by = y + (o.moving ? Math.abs(step) * -r * 0.08 : Math.sin(t * 2.5) * r * 0.025);
    c.fillStyle = shade(col, -0.5);
    ell(c, x - r * 0.42, y + r * 0.8 + step * r * 0.08, r * 0.26, r * 0.15);
    ell(c, x + r * 0.42, y + r * 0.8 - step * r * 0.08, r * 0.26, r * 0.15);
    if (ly < 0) weapon(c, key, x, by, r, ang, t);
    body(c, key, x, by, r, col);
    face(c, key, x, by, r, lx, ly);
    hat(c, key, x, by, r, col, t, lx);
    if (ly >= 0) weapon(c, key, x, by, r, ang, t);
    if (o.flash > 0) {
      c.globalAlpha *= Math.min(1, o.flash);
      c.fillStyle = '#fff';
      circ(c, x, by, r * 1.05);
    }
    c.restore();
  }

  // ---------------------------------------------------------------- Geschosse & Gegenstände

  function shot(c, kind, x, y, s, ang, t, lift) {
    c.save();
    if (kind === 'k' || kind === 'K' || kind === 'h') {
      const big = kind === 'K' ? 1.5 : 1, h = (lift || 0) / 100 * s * 1.6;
      c.fillStyle = 'rgba(0,0,0,.3)'; ell(c, x, y, s * 0.22 * big, s * 0.1 * big);
      y -= h;
      if (kind === 'h') {
        c.fillStyle = '#7dff9b'; c.shadowColor = '#7dff9b'; c.shadowBlur = s * 0.4;
        circ(c, x, y, s * 0.2);
        c.shadowBlur = 0; c.fillStyle = '#e8ffe9'; circ(c, x - s * 0.05, y - s * 0.05, s * 0.07);
      } else {
        c.fillStyle = kind === 'K' ? '#5a1414' : '#25252e';
        circ(c, x, y, s * 0.2 * big);
        c.fillStyle = 'rgba(255,255,255,.35)'; circ(c, x - s * 0.06 * big, y - s * 0.07 * big, s * 0.06 * big);
        c.fillStyle = '#ffb703'; circ(c, x + s * 0.1 * big, y - s * 0.2 * big, s * (0.06 + 0.03 * Math.sin(t * 40)) * big);
      }
    } else {
      c.translate(x, y); c.rotate(ang);
      if (kind === 'z') {
        c.shadowColor = '#ffe14d'; c.shadowBlur = s * 0.35;
        c.fillStyle = '#fff3a0';
        c.beginPath(); c.ellipse(0, 0, s * 0.3, s * 0.09, 0, 0, TAU); c.fill();
        c.fillStyle = '#fff'; c.beginPath(); c.ellipse(s * 0.06, 0, s * 0.14, s * 0.05, 0, 0, TAU); c.fill();
      } else if (kind === 'b' || kind === 'B') {
        const big = kind === 'B';
        if (big) { c.shadowColor = '#8dff7a'; c.shadowBlur = s * 0.5; }
        c.strokeStyle = big ? '#d6ffcc' : '#d9c8a5'; c.lineWidth = s * (big ? 0.09 : 0.05);
        c.beginPath(); c.moveTo(-s * 0.4, 0); c.lineTo(s * 0.25, 0); c.stroke();
        c.fillStyle = big ? '#8dff7a' : '#c9ccd6';
        c.beginPath(); c.moveTo(s * 0.4, 0); c.lineTo(s * 0.2, -s * 0.09); c.lineTo(s * 0.2, s * 0.09); c.fill();
        c.fillStyle = '#4caf50';
        c.beginPath(); c.moveTo(-s * 0.4, 0); c.lineTo(-s * 0.5, -s * 0.1); c.lineTo(-s * 0.28, 0); c.lineTo(-s * 0.5, s * 0.1); c.fill();
      } else if (kind === 'p') {
        c.fillStyle = '#8b90a6'; c.strokeStyle = '#4c5062'; c.lineWidth = Math.max(1, s * 0.03);
        c.beginPath(); c.moveTo(s * 0.13, 0); c.lineTo(0, -s * 0.11); c.lineTo(-s * 0.12, -s * 0.03); c.lineTo(-s * 0.06, s * 0.1); c.closePath();
        c.fill(); c.stroke();
      } else if (kind === 's') {
        c.fillStyle = '#2f9e8f'; c.strokeStyle = '#155e55'; c.lineWidth = Math.max(1, s * 0.03);
        c.beginPath(); c.ellipse(0, 0, s * 0.17, s * 0.11, 0, 0, TAU); c.fill(); c.stroke();
        c.fillStyle = '#c6f6d5';
        for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + t * 10; c.beginPath(); c.moveTo(Math.cos(a) * s * 0.24, Math.sin(a) * s * 0.18); c.lineTo(Math.cos(a + 0.4) * s * 0.12, Math.sin(a + 0.4) * s * 0.08); c.lineTo(Math.cos(a - 0.4) * s * 0.12, Math.sin(a - 0.4) * s * 0.08); c.fill(); }
      } else if (kind === 'o') {
        const g = c.createRadialGradient(0, 0, 0, 0, 0, s * 0.6);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#fff07a'); g.addColorStop(0.7, 'rgba(120,180,255,.7)'); g.addColorStop(1, 'rgba(80,120,255,0)');
        c.fillStyle = g; circ(c, 0, 0, s * 0.62);
        c.strokeStyle = '#fffbd0'; c.lineWidth = Math.max(1, s * 0.04);
        for (let i = 0; i < 4; i++) {
          const a = t * 13 + i * 1.7;
          c.beginPath(); c.moveTo(Math.cos(a) * s * 0.2, Math.sin(a) * s * 0.2);
          c.lineTo(Math.cos(a + 0.4) * s * 0.42, Math.sin(a + 0.4) * s * 0.42);
          c.lineTo(Math.cos(a + 0.2) * s * 0.58, Math.sin(a + 0.2) * s * 0.58); c.stroke();
        }
      }
    }
    c.restore();
  }

  function crystal(c, x, y, s, t) {
    const b = Math.sin(t * 3 + x) * s * 0.06;
    c.fillStyle = 'rgba(0,0,0,.25)'; ell(c, x, y + s * 0.18, s * 0.18, s * 0.07);
    y -= s * 0.12 + b;
    c.fillStyle = '#c86bff'; c.strokeStyle = '#5b1d8f'; c.lineWidth = Math.max(1, s * 0.03);
    c.beginPath(); c.moveTo(x, y - s * 0.24); c.lineTo(x + s * 0.17, y - s * 0.06); c.lineTo(x, y + s * 0.2); c.lineTo(x - s * 0.17, y - s * 0.06); c.closePath();
    c.fill(); c.stroke();
    c.fillStyle = '#f0c8ff';
    c.beginPath(); c.moveTo(x, y - s * 0.22); c.lineTo(x + s * 0.06, y - s * 0.06); c.lineTo(x, y + s * 0.02); c.lineTo(x - s * 0.08, y - s * 0.06); c.closePath(); c.fill();
  }

  function cell(c, x, y, s, t) {
    const b = Math.sin(t * 3 + y) * s * 0.05;
    c.fillStyle = 'rgba(0,0,0,.25)'; ell(c, x, y + s * 0.2, s * 0.2, s * 0.07);
    y -= s * 0.12 + b;
    c.save(); c.shadowColor = '#39ffb6'; c.shadowBlur = s * 0.3;
    c.fillStyle = '#1d8f6a'; c.strokeStyle = '#0b4433'; c.lineWidth = Math.max(1, s * 0.03);
    c.beginPath(); c.roundRect(x - s * 0.17, y - s * 0.22, s * 0.34, s * 0.42, s * 0.06); c.fill(); c.stroke();
    c.restore();
    c.fillStyle = '#b6ffe4';
    c.beginPath(); c.moveTo(x + s * 0.03, y - s * 0.16); c.lineTo(x - s * 0.08, y + s * 0.02); c.lineTo(x, y + s * 0.02);
    c.lineTo(x - s * 0.03, y + s * 0.15); c.lineTo(x + s * 0.09, y - s * 0.03); c.lineTo(x + s * 0.01, y - s * 0.03); c.closePath(); c.fill();
  }

  // ---------------------------------------------------------------- Karten-Themen

  const THEMES = {
    schlucht: { bg: '#3a2318', floorA: '#e0b783', floorB: '#d8ad77', speck: 'rgba(120,70,30,.12)', wallTop: '#c9774f', wallFront: '#8a4630', wallLine: '#6b3220',
      water: '#2bb3c0', waterDeep: '#1d8a9b', bushA: '#3e9d4a', bushB: '#2f7d3a', bushLine: '#1f5527' },
    grube: { bg: '#1b1730', floorA: '#9a92b6', floorB: '#918aad', speck: 'rgba(40,30,80,.12)', wallTop: '#6a628c', wallFront: '#433c63', wallLine: '#2c2645',
      water: '#4f7fd6', waterDeep: '#3a63b0', bushA: '#5aa86a', bushB: '#468a55', bushLine: '#2b5c37' },
    insel: { bg: '#123456', floorA: '#86c96e', floorB: '#7dbf66', speck: 'rgba(30,80,20,.12)', wallTop: '#a8adb8', wallFront: '#6c7180', wallLine: '#4a4e5a',
      water: '#3aa1e0', waterDeep: '#2a80c0', bushA: '#2f8f3c', bushB: '#23722f', bushLine: '#154a1e' },
  };

  return { hero, shot, crystal, cell, shade, THEMES, HERO_COLORS, ell, circ, TAU };
})();
