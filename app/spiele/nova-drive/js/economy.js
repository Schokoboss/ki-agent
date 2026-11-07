// Geld & Co.: Tagesbonus, Tagesaufgaben, Glücksrad, Statistik, Verkaufswert.
// Alles reine Spielwährung – es gibt keine Käufe mit echtem Geld.
import { CARS, UPGRADES } from './data.js';
import { mulberry32, fmtNum, clamp } from './util.js';

const TASKS = [
  { type: 'km', text: n => `Fahre ${n} km`, vals: [4, 8, 12], cr: 6000 },
  { type: 'drift', text: n => `Sammle ${fmtNum(n)} Drift-Punkte`, vals: [6000, 12000, 20000], cr: 8000 },
  { type: 'near', text: n => `${n}× knapp vorbei`, vals: [3, 6, 9], cr: 7000 },
  { type: 'smash', text: n => `Zerstöre ${n} Objekte`, vals: [12, 25, 40], cr: 6000 },
  { type: 'race', text: n => `Beende ${n} Rennen`, vals: [1, 2, 3], cr: 9000 },
  { type: 'win', text: n => `Gewinne ${n} Rennen`, vals: [1, 1, 2], cr: 12000 },
  { type: 'air', text: n => `${n} Sprünge über 1 Sekunde`, vals: [2, 4, 6], cr: 7000 },
  { type: 'trap', text: n => `Löse ${n} Blitzer aus`, vals: [2, 3, 4], cr: 6000 },
  { type: 'speed', text: n => `Erreiche ${n} km/h`, vals: [170, 200, 240], cr: 8000, max: true },
  { type: 'poster', text: n => `Finde ${n} Festival-Plakat${n > 1 ? 'e' : ''}`, vals: [1, 1, 2], cr: 10000 },
  { type: 'skill', text: n => `Sichere eine Skill-Kette über ${fmtNum(n)}`, vals: [3000, 6000, 10000], cr: 9000, max: true },
];

// Glücksrad: Segmentgröße = Wahrscheinlichkeit (ehrlich)
export const PRIZES = [
  { label: '5.000', cr: 5000, w: 22, color: '#3fb8f0' },
  { label: '10.000', cr: 10000, w: 19, color: '#7a6bff' },
  { label: '+1.500 Fans', fans: 1500, w: 13, color: '#36e27a' },
  { label: '15.000', cr: 15000, w: 15, color: '#ff8a00' },
  { label: '25.000', cr: 25000, w: 11, color: '#ff3d7f' },
  { label: 'AUTO!', car: true, w: 6, color: '#ffd23f' },
  { label: '50.000', cr: 50000, w: 9, color: '#b84dff' },
  { label: '100.000', cr: 100000, w: 5, color: '#ff3b3b' },
];

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class Economy {
  constructor(game) {
    this.g = game;
    const s = game.save;
    s.stats = Object.assign({ km: 0, earned: 0, top: 0, smashed: 0, near: 0, races: 0, wins: 0, spins: 0, bestChain: 0 }, s.stats || {});
    s.spins = s.spins || 0;
    this.ensureDaily();
  }

  // ---------- Tagesaufgaben
  ensureDaily() {
    const s = this.g.save, day = today();
    if (s.daily && s.daily.day === day) return;
    let h = 0; for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) | 0;
    const rnd = mulberry32(h);
    const lvl = Math.min(2, Math.floor((this.g.level ? this.g.level().level : 1) / 4));
    const pool = TASKS.filter(t => !(t.type === 'poster' && (s.posters || []).length >= 19));
    const tasks = [];
    while (tasks.length < 3 && pool.length) {
      const t = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
      let goal = t.vals[lvl];
      if (t.type === 'speed') {
        const own = Object.keys(s.owned || {}).map(id => CARS.find(c => c.id === id)).filter(Boolean);
        const top = Math.max(194, ...own.map(c => c.top));
        goal = Math.min(goal, Math.floor(top * 0.88 / 10) * 10);
      }
      tasks.push({ type: t.type, goal, prog: 0, done: false, cr: Math.round(t.cr * (1 + lvl * 0.4) / 500) * 500 });
    }
    s.daily = { day, tasks, bonus: false };
    this.g.saveGame && this.g.saveGame();
  }
  taskText(t) { const d = TASKS.find(x => x.type === t.type); return d ? d.text(t.goal) : t.type; }

  track(type, amount = 1) {
    this.ensureDaily();
    const s = this.g.save;
    const st = s.stats;
    if (type === 'km') st.km += amount;
    if (type === 'smash') st.smashed += amount;
    if (type === 'near') st.near += amount;
    if (type === 'speed') st.top = Math.max(st.top, amount);
    if (type === 'skill') st.bestChain = Math.max(st.bestChain, amount);
    let changed = false;
    for (const t of s.daily.tasks) {
      if (t.done || t.type !== type) continue;
      const before = t.prog;
      t.prog = TASKS.find(x => x.type === type)?.max ? Math.max(t.prog, amount) : t.prog + amount;
      if (Math.floor(before) !== Math.floor(t.prog)) changed = true;
      if (t.prog >= t.goal) {
        t.done = true; t.prog = t.goal; changed = true;
        this.g.hud.banner('Tagesaufgabe erledigt!', `+${fmtNum(t.cr)} CR`, null, this.taskText(t));
        this.g.audio.play('bank');
        this.g.reward(t.cr, 300, false);
      }
    }
    if (!s.daily.bonus && s.daily.tasks.every(t => t.done)) {
      s.daily.bonus = true;
      this.addSpin('Alle Tagesaufgaben geschafft!');
    }
    if (changed) this.g.saveGame();
  }

  // ---------- Tagesbonus beim ersten Fahren am Tag
  loginBonus() {
    const s = this.g.save, day = today();
    s.login = s.login || { last: null, streak: 0 };
    if (s.login.last === day) return;
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yd = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    s.login.streak = s.login.last === yd ? Math.min(7, s.login.streak + 1) : 1;
    s.login.last = day;
    const cr = 2000 * s.login.streak;
    setTimeout(() => {
      this.g.hud.banner(`Tagesbonus · Tag ${s.login.streak}`, `+${fmtNum(cr)} CR`, null, s.login.streak < 7 ? 'Komm morgen wieder – der Bonus wächst!' : 'Maximaler Bonus! 🔥');
      this.g.audio.play('bank');
      this.g.reward(cr, 0, false);
      if (s.login.streak === 7 && !s.login.spun7) { s.login.spun7 = true; this.addSpin('7 Tage am Stück!'); }
    }, 3800);
  }

  // ---------- Glücksrad
  addSpin(why) {
    this.g.save.spins++;
    this.g.saveGame();
    this.g.hud.toast(`🎡 Glücksrad-Dreh verdient – ${why}`, 'info');
    this.g.hud.money();
  }
  pickPrize() {
    const total = PRIZES.reduce((a, p) => a + p.w, 0);
    let r = Math.random() * total;
    for (let i = 0; i < PRIZES.length; i++) { r -= PRIZES[i].w; if (r <= 0) return i; }
    return 0;
  }
  // Gewinn auszahlen → Text für die Anzeige
  givePrize(i) {
    const p = PRIZES[i], g = this.g, s = g.save;
    s.stats.spins++;
    if (p.car) {
      const free = CARS.filter(c => !s.owned[c.id]);
      if (!free.length) { g.reward(150000, 0, false); return { title: 'Alle Autos schon da!', value: '+150.000 CR' }; }
      // günstigere Autos sind wahrscheinlicher
      const w = free.map(c => 1 / Math.sqrt(c.price));
      let r = Math.random() * w.reduce((a, b) => a + b, 0), car = free[0];
      for (let k = 0; k < free.length; k++) { r -= w[k]; if (r <= 0) { car = free[k]; break; } }
      s.owned[car.id] = { up: {}, color: car.colors[Math.floor(Math.random() * car.colors.length)] };
      g.saveGame();
      return { title: 'NEUES AUTO!', value: `${car.maker} ${car.name}`, car };
    }
    if (p.fans) { g.reward(0, p.fans, false); return { title: 'Fans!', value: `+${fmtNum(p.fans)} Fans` }; }
    g.reward(p.cr, 0, false);
    return { title: p.cr >= 50000 ? 'JACKPOT!' : 'Gewonnen!', value: `+${fmtNum(p.cr)} CR` };
  }

  // ---------- Garage
  sellValue(id) {
    const c = CARS.find(x => x.id === id), own = this.g.save.owned[id];
    if (!c || !own) return 0;
    let up = 0;
    for (const u of UPGRADES) for (let l = 0; l < (own.up[u.key] || 0); l++) up += u.cost[l];
    return Math.round((c.price * 0.6 + up * 0.5) / 100) * 100;
  }

  // ---------- Rennen: Auszahlung aufschlüsseln
  racePayout(ev, pos, crashes, difficulty) {
    const f = [1, 0.7, 0.5, 0.36, 0.27, 0.2, 0.15, 0.1][pos - 1] || 0.1;
    const base = Math.round(ev.reward * f / 100) * 100;
    const lines = [[`${pos}. Platz`, base]];
    const clean = crashes === 0 ? Math.round(base * 0.2 / 100) * 100 : 0;
    if (clean) lines.push(['Sauber gefahren', clean]);
    const mul = [0.8, 1, 1.35][difficulty ?? 1];
    const diff = Math.round(base * (mul - 1) / 100) * 100;
    if (diff) lines.push([diff > 0 ? 'Bonus „Schwer“' : 'Abzug „Leicht“', diff]);
    const total = lines.reduce((a, l) => a + l[1], 0);
    return { lines, total, fans: Math.round(ev.fans * f * mul) };
  }
}
