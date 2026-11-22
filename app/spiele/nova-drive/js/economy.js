// Geld & Co.: Tagesbonus, Tagesaufgaben, Glücksrad, Statistik, Verkaufswert.
// Alles reine Spielwährung – es gibt keine Käufe mit echtem Geld.
import { CARS, UPGRADES, EVENTS, CLASS_ORDER, upgradeCost } from './data.js';
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

// Glücksrad: Segmentgröße = Wahrscheinlichkeit (ehrlich). Im Schnitt ~7.500 CR je Dreh (vorher ~17.500);
// als Auto gibt es nur Einsteiger- und Mittelklasse-Autos bis 60.000 CR.
export const PRIZES = [
  { label: '2.000', cr: 2000, w: 24, color: '#3fb8f0' },
  { label: '4.000', cr: 4000, w: 22, color: '#7a6bff' },
  { label: '+800 Fans', fans: 800, w: 14, color: '#36e27a' },
  { label: '7.500', cr: 7500, w: 16, color: '#ff8a00' },
  { label: '12.000', cr: 12000, w: 10, color: '#ff3d7f' },
  { label: 'AUTO!', car: true, w: 3, color: '#ffd23f' },
  { label: '25.000', cr: 25000, w: 7, color: '#b84dff' },
  { label: '50.000', cr: 50000, w: 4, color: '#ff3b3b' },
];
const WHEEL_CAR_MAX = 60000;

// Kalenderwoche (ISO) als Schlüssel, z. B. „2026-W47“, und Tage bis Montag
export function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 864e5 + 1) / 7)).padStart(2, '0')}`;
}
export function daysToMonday(d = new Date()) { const w = d.getDay() || 7; return 8 - w; }

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

  // ---------- Wochen-Herausforderungen: 3 Aufgaben je Kalenderwoche (für alle gleich), alle drei = Bonus
  ensureWeekly() {
    const s = this.g.save, key = weekKey();
    if (s.weekly && s.weekly.key === key) return s.weekly;
    let h = 7; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) | 0;
    const rnd = mulberry32(h), pick = a => a[Math.floor(rnd() * a.length)];
    const races = EVENTS.filter(e => e.type === 'race'), others = EVENTS.filter(e => e.type === 'drift' || e.type === 'trap' || e.type === 'speed' || e.type === 'jump');
    const r = pick(races), cls = pick(r.dirt ? ['C', 'B'] : ['D', 'C', 'B', 'A']), e = pick(others);
    const tasks = [
      { type: 'winRace', ev: r.id, cls, done: false, cr: 25000 },
      { type: 'stars3', ev: e.id, done: false, cr: 20000 },
      pick([{ type: 'km', goal: 40, prog: 0, done: false, cr: 20000 }, { type: 'wins', goal: 5, prog: 0, done: false, cr: 25000 }, { type: 'champRace', goal: 3, prog: 0, done: false, cr: 25000 }]),
    ];
    s.weekly = { key, tasks, bonus: false };
    this.g.saveGame && this.g.saveGame();
    return s.weekly;
  }
  weeklyText(t) {
    const ev = id => (EVENTS.find(e => e.id === id) || {}).name || id;
    if (t.type === 'winRace') return `Gewinne „${ev(t.ev)}“ mit einem Auto bis Klasse ${t.cls}`;
    if (t.type === 'stars3') return `Hol 3 Sterne bei „${ev(t.ev)}“`;
    if (t.type === 'km') return `Fahre ${t.goal} km`;
    if (t.type === 'wins') return `Gewinne ${t.goal} Rennen`;
    if (t.type === 'champRace') return `Fahre ${t.goal} Meisterschaftsrennen`;
    return t.type;
  }
  // kind: 'race' {ev, pos, cls, champ} · 'stars' {ev, stars} · 'km' {amount}
  weekly(kind, d) {
    const W = this.ensureWeekly(); let changed = false;
    for (const t of W.tasks) {
      if (t.done) continue;
      if (kind === 'race' && t.type === 'winRace' && d.ev === t.ev && d.pos === 1 && CLASS_ORDER.indexOf(d.cls) <= CLASS_ORDER.indexOf(t.cls)) t.done = true;
      if (kind === 'race' && t.type === 'wins' && d.pos === 1) t.prog++;
      if (kind === 'race' && t.type === 'champRace' && d.champ) t.prog++;
      if (kind === 'stars' && t.type === 'stars3' && d.ev === t.ev && d.stars >= 3) t.done = true;
      if (kind === 'km' && t.type === 'km') t.prog += d.amount;
      if (t.goal && t.prog >= t.goal) { t.prog = t.goal; t.done = true; }
      if (t.done) {
        changed = true;
        this.g.hud.banner('Wochen-Herausforderung!', `+${fmtNum(t.cr)} CR`, null, this.weeklyText(t));
        this.g.audio.play('bank');
        this.g.reward(t.cr, 1000, false);
      }
    }
    if (!W.bonus && W.tasks.every(t => t.done)) {
      W.bonus = true; changed = true;
      this.addSpin('Alle Wochen-Herausforderungen');
      this.g.reward(25000, 2500, true);
      this.g.hud.toast('🗓 Alle 3 Wochen-Herausforderungen geschafft! +25.000 CR + Glücksrad-Dreh', 'info');
    }
    if (changed) this.g.saveGame();
  }

  track(type, amount = 1) {
    this.ensureDaily();
    const s = this.g.save;
    const st = s.stats;
    if (type === 'km') { st.km += amount; this.weekly('km', { amount }); }
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
      const free = CARS.filter(c => !s.owned[c.id] && c.price <= WHEEL_CAR_MAX);
      if (!free.length) { g.reward(25000, 0, false); return { title: 'Alle Rad-Autos schon da!', value: '+25.000 CR' }; }
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
    for (const u of UPGRADES) for (let l = 0; l < (own.up[u.key] || 0); l++) up += upgradeCost(c, u, l);
    return Math.round((c.price * 0.5 + up * 0.4) / 100) * 100;
  }

  // ---------- Rennen: Auszahlung aufschlüsseln
  racePayout(ev, pos, crashes, difficulty) {
    const f = ev.show ? (pos === 1 ? 1 : 0.25) : [1, 0.7, 0.5, 0.36, 0.27, 0.2, 0.15, 0.1][pos - 1] || 0.1; // Showcase: Zweikampf
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
