'use strict';
// Tumult Arena ohne Server: dieselbe Spiellogik wie spiel.py, in JavaScript – für die Offline-/Cloud-Version gegen Bots.
// Helden, Modi und Karten kommen aus TUMULT_DATA, das offline_bauen.py direkt aus spiel.py erzeugt.
// Änderungen an den Regeln in spiel.py hier nachziehen (Test: werkzeuge/tests/test_tumult.py baut und spielt beide).
const Lokal = (() => {
  const D = TUMULT_DATA;
  const { TICK, R, HIT_R, EPS, CRATE_HP, REGEN_WAIT, REGEN_RATE, SHIELD_TIME, MAX_CRYSTALS, MAX_CELLS } = D.C;
  const DT = 1 / TICK, TAU = Math.PI * 2;
  const HEROES = D.HEROES, MODES = D.MODES, MAPS = D.MAPS, BOT_NAMES = D.BOT_NAMES;
  const MELEE = ['slash', 'spread'];
  const rd = (v, n) => { const f = 10 ** n; return Math.round(v * f) / f; };
  const pmod = (a, m) => ((a % m) + m) % m;
  const angDiff = (a, b) => Math.abs(pmod(a - b + Math.PI, TAU) - Math.PI);
  function norm(x, y) { const d = Math.hypot(x, y); return d > 1e-9 ? [x / d, y / d] : [0, 0]; }

  function makeRng(seed) {
    let a = seed >>> 0;
    const random = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      random,
      gauss(mu, s) { let u = 0; while (!u) u = random(); return mu + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * random()); },
      shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } },
      randrange(n) { return Math.floor(random() * n); },
    };
  }

  // ---------------------------------------------------------------- Karte

  function buildRows(spec) {
    const { w, h, rows } = spec, g = Array.from({ length: h }, () => new Array(w));
    if (spec.sym === 'rot') {
      const half = w >> 1, swap = { B: 'R', R: 'B' };
      for (let y = 0; y < h; y++) for (let x = 0; x <= half; x++) g[y][x] = rows[y][x];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (x > half || (x === half && y > (h >> 1))) { const c = g[h - 1 - y][w - 1 - x]; g[y][x] = swap[c] || c; }
      }
    } else {
      const hw = w >> 1, hh = h >> 1;
      for (let y = 0; y <= hh; y++) for (let x = 0; x <= hw; x++) for (const yy of [y, h - 1 - y]) for (const xx of [x, w - 1 - x]) g[yy][xx] = rows[y][x];
    }
    return g;
  }

  class GameMap {
    constructor(key) {
      const spec = MAPS[key];
      this.key = key; this.name = spec.name; this.w = spec.w; this.h = spec.h;
      this.tiles = buildRows(spec);
      this.spawns = { 0: [], 1: [], ffa: [] };
      this.mine = null;
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        const c = this.tiles[y][x];
        if ('BRSC'.includes(c)) {
          this.tiles[y][x] = '.';
          if (c === 'B') this.spawns[0].push([x, y]);
          else if (c === 'R') this.spawns[1].push([x, y]);
          else if (c === 'S') this.spawns.ffa.push([x + 0.5, y + 0.5]);
          else this.mine = [x + 0.5, y + 0.5];
        }
      }
      this.crates = new Map();
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.tiles[y][x] === 'x') this.crates.set(y * this.w + x, CRATE_HP);
      for (const team of [0, 1]) {
        const pts = [], d = team === 0 ? 1 : -1;
        for (const [sx, sy] of this.spawns[team]) {
          for (const [ox, oy] of [[0, 0], [0, -2], [0, 2], [d, -1], [d, 1], [0, -3], [0, 3], [d, 0]]) {
            if (!this.solid(sx + ox, sy + oy)) pts.push([sx + ox + 0.5, sy + oy + 0.5]);
          }
        }
        this.spawns[team] = pts;
      }
      this.center = [this.w / 2, this.h / 2];
    }
    tile(tx, ty) { return tx < 0 || ty < 0 || tx >= this.w || ty >= this.h ? '#' : this.tiles[ty][tx]; }
    solid(tx, ty) { const c = this.tile(tx, ty); return c === '#' || c === '~' || c === 'x'; }
    blocks(tx, ty) { const c = this.tile(tx, ty); return c === '#' || c === 'x'; }
    bushAt(x, y) { return this.tile(Math.floor(x), Math.floor(y)) === '"'; }
    rows() { return this.tiles.map(r => r.join('')); }
    los(x0, y0, x1, y1, ignore = -1) {
      const d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.trunc(d / 0.25));
      for (let i = 1; i < n; i++) {
        const f = i / n, tx = Math.floor(x0 + (x1 - x0) * f), ty = Math.floor(y0 + (y1 - y0) * f);
        if (ty * this.w + tx !== ignore && this.blocks(tx, ty)) return false;
      }
      return true;
    }
    freeNear(x, y) {
      const tx = Math.floor(x), ty = Math.floor(y);
      if (!this.solid(tx, ty)) return [x, y];
      for (let rad = 1; rad < 6; rad++) {
        let best = null;
        for (let oy = -rad; oy <= rad; oy++) for (let ox = -rad; ox <= rad; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== rad || this.solid(tx + ox, ty + oy)) continue;
          const cx = tx + ox + 0.5, cy = ty + oy + 0.5, d = (cx - x) ** 2 + (cy - y) ** 2;
          if (!best || d < best[0]) best = [d, cx, cy];
        }
        if (best) return [best[1], best[2]];
      }
      return [x, y];
    }
    path(sx, sy, gx, gy, limit = 1500) {
      const W = this.w, start = [Math.floor(sx), Math.floor(sy)], goal = [Math.floor(gx), Math.floor(gy)];
      if (start[0] === goal[0] && start[1] === goal[1]) return [];
      const key = (x, y) => y * W + x;
      const sk = key(start[0], start[1]), gk = key(goal[0], goal[1]);
      const prev = new Map([[sk, -1]]), q = [start];
      let head = 0, best = sk, bestd = (start[0] - goal[0]) ** 2 + (start[1] - goal[1]) ** 2;
      while (head < q.length && prev.size < limit) {
        const [cx, cy] = q[head++];
        if (key(cx, cy) === gk) { best = gk; break; }
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + ox, ny = cy + oy, nk = key(nx, ny);
          if (prev.has(nk) || this.solid(nx, ny)) continue;
          prev.set(nk, key(cx, cy));
          const d = (nx - goal[0]) ** 2 + (ny - goal[1]) ** 2;
          if (d < bestd) { best = nk; bestd = d; }
          q.push([nx, ny]);
        }
      }
      const out = [];
      let cur = best;
      while (cur !== -1 && cur !== sk && cur !== undefined) { out.push([cur % W + 0.5, Math.floor(cur / W) + 0.5]); cur = prev.get(cur); }
      return out.reverse();
    }
  }

  function move(m, x, y, dx, dy) {
    if (dx) {
      let nx = x + dx;
      const y0 = Math.floor(y - R), y1 = Math.floor(y + R - EPS);
      if (dx > 0) { const tx = Math.floor(nx + R); for (let ty = y0; ty <= y1; ty++) if (m.solid(tx, ty)) { nx = tx - R - EPS; break; } }
      else { const tx = Math.floor(nx - R); for (let ty = y0; ty <= y1; ty++) if (m.solid(tx, ty)) { nx = tx + 1 + R + EPS; break; } }
      x = nx;
    }
    if (dy) {
      let ny = y + dy;
      const x0 = Math.floor(x - R), x1 = Math.floor(x + R - EPS);
      if (dy > 0) { const ty = Math.floor(ny + R); for (let tx = x0; tx <= x1; tx++) if (m.solid(tx, ty)) { ny = ty - R - EPS; break; } }
      else { const ty = Math.floor(ny - R); for (let tx = x0; tx <= x1; tx++) if (m.solid(tx, ty)) { ny = ty + 1 + R + EPS; break; } }
      y = ny;
    }
    return [x, y];
  }

  // ---------------------------------------------------------------- Figuren

  class Player {
    constructor(id, name, hero, team, bot) {
      Object.assign(this, { id, name, team, bot, x: 0, y: 0, vx: 0, vy: 0, alive: false, respawn: 0, cells: 0, dmgMult: 1,
        super: 0, crystals: 0, inputs: [], ack: 0, bm: [0, 0], ai: null, place: 0, max_hp: 0, hp: 0 });
      this.stats = { kos: 0, deaths: 0, dmg: 0, heal: 0, crystals: 0 };
      this.setHero(hero);
      this.resetCombat();
    }
    setHero(hero) {
      const ratio = this.max_hp ? this.hp / this.max_hp : 1;
      this.hero = hero; this.h = HEROES[hero];
      this.max_hp = this.h.hp + 300 * Math.min(this.cells, MAX_CELLS);
      this.hp = Math.max(1, Math.round(this.max_hp * ratio));
    }
    resetCombat() {
      Object.assign(this, { hp: this.max_hp, ammo: 3, cd: 0, sinceHit: 99, sinceAtk: 99, shield: 0, face: 0, faceHold: 0,
        burst: [], dash: null, knock: null, airborne: false, stormAcc: 0, healAcc: 0 });
      this.inputs.length = 0;
    }
    get forced() { return this.dash !== null || this.knock !== null; }
  }

  // ---------------------------------------------------------------- Partie

  class Game {
    constructor(mode, entrants, seed) {
      this.modeKey = mode; this.mode = MODES[mode]; this.teams = this.mode.teams;
      this.map = new GameMap(this.mode.map);
      this.rng = makeRng(seed ?? (Math.random() * 2 ** 32));
      this.players = new Map();
      this.shots = []; this.zones = []; this.items = [];
      this.nextId = 1; this.t = 0; this.tick = 0; this.score = [0, 0]; this.events = [];
      this.over = false; this.result = null; this.hold = null; this.mineT = 4;
      this.stormR = Math.hypot(this.map.w, this.map.h) / 2 + 1;
      this.ffaSpawns = this.map.spawns.ffa.slice(); this.rng.shuffle(this.ffaSpawns);
      for (const e of entrants) this.addPlayer(e);
    }
    nid() { return ++this.nextId; }
    addPlayer(e) {
      const team = this.teams ? (e.team || 0) : 100 + this.players.size;
      const p = new Player(e.id, e.name, e.hero, team, !!e.bot);
      if (p.bot) p.ai = new BotBrain(this.rng);
      this.players.set(p.id, p);
      if (this.teams || this.t < 1) this.spawn(p);
      return p;
    }
    ev(...e) { this.events.push(e); }
    spawn(p) {
      let x, y;
      if (this.teams) {
        const pts = this.map.spawns[p.team], all = [...this.players.values()];
        const enemies = all.filter(q => q.alive && q.team !== p.team), mates = all.filter(q => q.alive && q.team === p.team && q !== p);
        const score = pt => {
          const de = enemies.length ? Math.min(...enemies.map(q => Math.hypot(pt[0] - q.x, pt[1] - q.y))) : 50;
          const dm = mates.length ? Math.min(...mates.map(q => Math.hypot(pt[0] - q.x, pt[1] - q.y))) : 5;
          return Math.min(de, 12) + Math.min(dm, 2) * 2 + this.rng.random() * 0.3;
        };
        let best = pts[0], bs = -1e9;
        for (const pt of pts) { const s = score(pt); if (s > bs) { bs = s; best = pt; } }
        [x, y] = best;
      } else {
        if (!this.ffaSpawns.length) { this.ffaSpawns = this.map.spawns.ffa.slice(); this.rng.shuffle(this.ffaSpawns); }
        [x, y] = this.ffaSpawns.pop();
      }
      p.x = x; p.y = y; p.alive = true;
      p.resetCombat();
      p.shield = SHIELD_TIME;
      p.face = p.team === 0 || !this.teams ? 0 : Math.PI;
      this.ev('spawn', p.id);
    }
    visible(team, q) {
      if (team == null || q.team === team || !q.alive) return true;
      if (!this.map.bushAt(q.x, q.y) || q.sinceAtk < 1 || q.sinceHit < 0.6) return true;
      for (const p of this.players.values()) if (p.alive && p.team === team && (p.x - q.x) ** 2 + (p.y - q.y) ** 2 < 2.4 ** 2) return true;
      return false;
    }
    queueInput(pid, seq, mx, my) {
      const p = this.players.get(pid);
      if (!p || p.bot) return;
      mx = +mx || 0; my = +my || 0;
      const d = Math.hypot(mx, my);
      if (d > 1) { mx /= d; my /= d; }
      p.inputs.push([seq | 0, mx, my]);
      while (p.inputs.length > 12) p.ack = p.inputs.shift()[0];
    }
    emote(pid, n) { const p = this.players.get(pid); if (p && p.alive && n >= 0 && n < 6) this.ev('emo', p.id, n | 0); }

    attack(pid, ax, ay, dist, sup = false) {
      const p = this.players.get(pid);
      if (!p || !p.alive || p.dash || p.knock) return false;
      const h = p.h;
      if (sup) { if (p.super < 1) return false; p.super = 0; }
      else { if (p.ammo < 1 || p.cd > 0) return false; p.ammo -= 1; p.cd = h.cd; }
      [ax, ay] = norm(+ax || 0, +ay || 0);
      if (!ax && !ay) { ax = Math.cos(p.face); ay = Math.sin(p.face); }
      dist = +dist || 0;
      const ang = Math.atan2(ay, ax);
      p.face = ang; p.faceHold = 0.45; p.sinceAtk = 0; p.shield = 0;
      const kind = sup ? h.sup : h.attack;
      this.ev('shot', p.id, kind, rd(p.x, 2), rd(p.y, 2), rd(ang, 2));
      if (kind === 'burst') {
        const n = h.count;
        p.burst = Array.from({ length: n }, (_, i) => [i * 0.09, ang + (i - (n - 1) / 2) * 0.035]);
        this.updateBurst(p);
      } else if (kind === 'bolt') this.bullet(p, 'b', ang, h.bspeed, h.range, h.dmg, 0.14);
      else if (kind === 'seed') this.bullet(p, 's', ang, h.bspeed, h.range, h.dmg, 0.17);
      else if (kind === 'spread') {
        const n = h.count;
        for (let i = 0; i < n; i++) this.bullet(p, 'p', ang + (i - (n - 1) / 2) * 0.17, h.bspeed, h.range * (0.92 + 0.08 * (i % 2)), h.dmg, 0.13);
      } else if (kind === 'slash') this.slash(p, ang);
      else if (kind === 'orb') this.bullet(p, 'o', ang, h.sspeed, h.srange, h.sdmg, 0.55, true).pierce = true;
      else if (kind === 'pierce') { const b = this.bullet(p, 'B', ang, h.sspeed, h.srange, h.sdmg, 0.24, true); b.pierce = true; b.knock = 1; }
      else if (kind === 'bomb' || kind === 'bigbomb' || kind === 'heal') {
        const rng = sup ? h.srange : h.range, d = Math.max(1.2, Math.min(dist || rng * 0.75, rng));
        const tx = Math.min(Math.max(p.x + ax * d, 0.3), this.map.w - 0.3), ty = Math.min(Math.max(p.y + ay * d, 0.3), this.map.h - 0.3);
        const b = this.newShot({ bomb: 'k', bigbomb: 'K', heal: 'h' }[kind], p);
        Object.assign(b, { lob: true, sx: p.x, sy: p.y, tx, ty, dur: 0.42 + d * 0.045, isSuper: sup });
        if (kind === 'bomb') { b.dmg = h.dmg; b.radius = h.radius; } else if (kind === 'bigbomb') { b.dmg = h.sdmg; b.radius = h.sradius; }
        this.shots.push(b);
      } else if (kind === 'charge') p.dash = { kind: 'charge', dx: ax, dy: ay, left: h.srange, speed: 15, hit: new Set() };
      else if (kind === 'leap') {
        const d = Math.max(1, Math.min(dist || h.srange, h.srange));
        let tx = Math.min(Math.max(p.x + ax * d, 0.5), this.map.w - 0.5), ty = Math.min(Math.max(p.y + ay * d, 0.5), this.map.h - 0.5);
        [tx, ty] = this.map.freeNear(tx, ty);
        p.dash = { kind: 'leap', sx: p.x, sy: p.y, tx, ty, t: 0, dur: 0.42 };
        p.airborne = true;
      }
      return true;
    }
    newShot(kind, owner) {
      return { id: this.nid(), kind, owner, team: owner.team, x: owner.x, y: owner.y, vx: 0, vy: 0, left: 0, dmg: 0, r: 0.15,
        pierce: false, hit: new Set(), isSuper: false, knock: 0, lob: false, sx: 0, sy: 0, tx: 0, ty: 0, t: 0, dur: 0, radius: 0 };
    }
    bullet(p, kind, ang, speed, rng, dmg, r, sup = false) {
      const b = this.newShot(kind, p);
      Object.assign(b, { vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, left: rng, dmg, r, isSuper: sup });
      this.shots.push(b);
      return b;
    }
    updateBurst(p) {
      const rest = [];
      for (const [delay, a] of p.burst) {
        if (delay <= 1e-9) this.bullet(p, 'z', a, p.h.bspeed, p.h.range, p.h.dmg, 0.15);
        else rest.push([delay - DT, a]);
      }
      p.burst = rest;
    }

    damage(q, amount, src, isSuper = false) {
      if (!q.alive || q.shield > 0 || q.airborne || this.over) return 0;
      if (src) amount *= src.dmgMult;
      amount = Math.round(amount);
      q.hp -= amount; q.sinceHit = 0;
      this.ev('hit', q.id, rd(q.x, 2), rd(q.y, 2), amount, src ? src.id : 0);
      if (src) {
        src.stats.dmg += amount;
        if (!isSuper && src.alive) {
          const was = src.super;
          src.super = Math.min(1, src.super + src.h.charge);
          if (was < 1 && src.super >= 1) this.ev('ready', src.id);
        }
      }
      if (q.hp <= 0) this.kill(q, src);
      return amount;
    }
    kill(q, src) {
      Object.assign(q, { alive: false, hp: 0, burst: [], dash: null, knock: null, airborne: false });
      q.stats.deaths += 1;
      if (src && src !== q) src.stats.kos += 1;
      this.ev('ko', src ? src.id : 0, q.id, rd(q.x, 2), rd(q.y, 2));
      if (this.modeKey === 'teamkampf' && src && src.team !== q.team) this.score[src.team] += 1;
      if (q.crystals) { this.scatter(q.x, q.y, 'k', q.crystals); q.crystals = 0; }
      if (this.teams) q.respawn = this.mode.respawn;
      else {
        q.place = [...this.players.values()].filter(p => p.alive).length + 1;
        if (q.cells) this.scatter(q.x, q.y, 'z', Math.max(1, (q.cells >> 1) + 1));
      }
    }
    scatter(x, y, art, n) {
      for (let i = 0; i < n; i++) {
        const a = this.rng.random() * TAU, r = 0.3 + this.rng.random() * 1.1;
        const [px, py] = this.map.freeNear(x + Math.cos(a) * r, y + Math.sin(a) * r);
        this.items.push([this.nid(), art, rd(px, 2), rd(py, 2)]);
      }
    }
    crateHit(tx, ty, dmg) {
      const k = ty * this.map.w + tx;
      if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h || !this.map.crates.has(k)) return false;
      const hp = this.map.crates.get(k) - dmg;
      if (hp > 0) { this.map.crates.set(k, hp); this.ev('box', tx, ty); return false; }
      this.map.crates.delete(k);
      this.map.tiles[ty][tx] = '.';
      this.ev('crate', tx, ty);
      if (!this.teams) this.items.push([this.nid(), 'z', tx + 0.5, ty + 0.5]);
      return true;
    }
    slash(p, ang) {
      const h = p.h;
      this.ev('slash', rd(p.x, 2), rd(p.y, 2), rd(ang, 2));
      for (const q of [...this.players.values()]) {
        if (q.team === p.team || !q.alive) continue;
        const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
        if (d > h.range + HIT_R) continue;
        if ((d < 0.7 || angDiff(Math.atan2(dy, dx), ang) < 0.75) && this.map.los(p.x, p.y, q.x, q.y)) this.damage(q, h.dmg, p);
      }
      for (const k of [...this.map.crates.keys()]) {
        const tx = k % this.map.w, ty = Math.floor(k / this.map.w), cx = tx + 0.5 - p.x, cy = ty + 0.5 - p.y;
        if (Math.hypot(cx, cy) < h.range + 0.4 && angDiff(Math.atan2(cy, cx), ang) < 0.75) this.crateHit(tx, ty, h.dmg);
      }
    }
    explode(src, x, y, radius, dmg, isSuper) {
      this.ev('boom', rd(x, 2), rd(y, 2), radius);
      for (const q of [...this.players.values()]) if (q.team !== src.team && q.alive && Math.hypot(q.x - x, q.y - y) < radius + 0.3) this.damage(q, dmg, src, isSuper);
      const r = Math.ceil(radius);
      for (let ty = Math.floor(y) - r; ty <= Math.floor(y) + r; ty++) for (let tx = Math.floor(x) - r; tx <= Math.floor(x) + r; tx++) {
        if (tx >= 0 && ty >= 0 && tx < this.map.w && this.map.crates.has(ty * this.map.w + tx) && Math.hypot(tx + 0.5 - x, ty + 0.5 - y) < radius + 0.4) this.crateHit(tx, ty, dmg * (isSuper ? 2 : 1));
      }
    }

    step() {
      if (this.over) return;
      this.tick += 1; this.t += DT;
      for (const p of this.players.values()) if (p.bot) p.ai.think(this, p);
      for (const p of [...this.players.values()]) this.updatePlayer(p);
      this.updateShots(); this.updateZones(); this.updateItems(); this.updateMode();
    }
    updatePlayer(p) {
      const ox = p.x, oy = p.y;
      if (!p.alive) {
        while (p.inputs.length) p.ack = p.inputs.shift()[0];
        if (this.teams && !this.over) { p.respawn -= DT; if (p.respawn <= 0) this.spawn(p); }
        p.vx = p.vy = 0;
        return;
      }
      const h = p.h;
      p.cd = Math.max(0, p.cd - DT); p.sinceHit += DT; p.sinceAtk += DT;
      p.shield = Math.max(0, p.shield - DT); p.faceHold = Math.max(0, p.faceHold - DT);
      if (p.ammo < 3) p.ammo = Math.min(3, p.ammo + DT / h.reload);
      if (p.sinceHit >= REGEN_WAIT && p.sinceAtk >= REGEN_WAIT && p.hp < p.max_hp) p.hp = Math.min(p.max_hp, p.hp + p.max_hp * REGEN_RATE * DT);
      if (p.burst.length) this.updateBurst(p);
      const steps = [];
      if (p.bot) steps.push(p.bm);
      else {
        const n = p.inputs.length <= 3 ? 1 : 2;
        for (let i = 0; i < n && p.inputs.length; i++) { const [seq, mx, my] = p.inputs.shift(); p.ack = seq; steps.push([mx, my]); }
      }
      if (p.dash) this.updateDash(p);
      else if (p.knock) {
        const k = p.knock;
        [p.x, p.y] = move(this.map, p.x, p.y, k[0] * DT, k[1] * DT);
        k[2] -= DT;
        if (k[2] <= 0) p.knock = null;
      } else {
        const spd = h.speed;
        for (const [mx, my] of steps) {
          if (mx || my) {
            [p.x, p.y] = move(this.map, p.x, p.y, mx * spd * DT, my * spd * DT);
            if (p.faceHold <= 0) p.face = Math.atan2(my, mx);
          }
        }
      }
      p.vx = (p.x - ox) / DT; p.vy = (p.y - oy) / DT;
      if (p.alive && !this.teams && Math.hypot(p.x - this.map.center[0], p.y - this.map.center[1]) > this.stormR) {
        p.stormAcc += DT;
        if (p.stormAcc >= 0.5) { p.stormAcc -= 0.5; this.damage(p, 450 + Math.max(0, this.t - 140) * 6, null); }
      } else p.stormAcc = 0;
    }
    updateDash(p) {
      const d = p.dash;
      if (d.kind === 'leap') {
        d.t += DT;
        const f = Math.min(1, d.t / d.dur);
        p.x = d.sx + (d.tx - d.sx) * f; p.y = d.sy + (d.ty - d.sy) * f;
        if (f >= 1) {
          p.dash = null; p.airborne = false;
          const h = p.h;
          this.ev('land', rd(p.x, 2), rd(p.y, 2), h.sradius);
          for (const q of [...this.players.values()]) if (q.team !== p.team && q.alive && Math.hypot(q.x - p.x, q.y - p.y) < h.sradius + 0.3) this.damage(q, h.sdmg, p, true);
        }
        return;
      }
      const step = Math.min(d.speed * DT, d.left);
      this.crateHit(Math.floor(p.x + d.dx * (R + step + 0.05)), Math.floor(p.y + d.dy * (R + step + 0.05)), 99999);
      const [nx, ny] = move(this.map, p.x, p.y, d.dx * step, d.dy * step);
      const moved = Math.hypot(nx - p.x, ny - p.y);
      p.x = nx; p.y = ny; d.left -= step;
      for (const q of [...this.players.values()]) {
        if (q.team !== p.team && q.alive && !d.hit.has(q.id) && Math.hypot(q.x - p.x, q.y - p.y) < 1) {
          d.hit.add(q.id);
          this.damage(q, p.h.sdmg, p, true);
          if (q.alive) { q.knock = [d.dx * 9, d.dy * 9, 0.25]; q.dash = null; q.airborne = false; }
        }
      }
      if (d.left <= 1e-6 || moved < step * 0.4) p.dash = null;
    }
    updateShots() {
      const alive = [];
      for (const b of this.shots) {
        if (b.lob) {
          b.t += DT;
          const f = Math.min(1, b.t / b.dur);
          b.x = b.sx + (b.tx - b.sx) * f; b.y = b.sy + (b.ty - b.sy) * f;
          if (f >= 1) this.land(b); else alive.push(b);
          continue;
        }
        let dead = false;
        const sub = 3, speed = Math.hypot(b.vx, b.vy);
        for (let s = 0; s < sub; s++) {
          b.x += b.vx * DT / sub; b.y += b.vy * DT / sub; b.left -= speed * DT / sub;
          const tx = Math.floor(b.x), ty = Math.floor(b.y);
          if (this.map.blocks(tx, ty)) {
            const broke = this.crateHit(tx, ty, b.dmg * (b.isSuper ? 2 : 1));
            if (!(broke && b.kind === 'o')) { dead = true; this.ev('puff', rd(b.x, 2), rd(b.y, 2), b.kind); break; }
          }
          for (const q of this.players.values()) {
            if (q.team === b.team || !q.alive || q.airborne || b.hit.has(q.id) || (q.x - b.x) ** 2 + (q.y - b.y) ** 2 > (HIT_R + b.r) ** 2) continue;
            b.hit.add(q.id);
            this.damage(q, b.dmg, b.owner, b.isSuper);
            if (b.knock && q.alive && !q.dash) { const [kx, ky] = norm(b.vx, b.vy); q.knock = [kx * 6, ky * 6, 0.18]; }
            if (!b.pierce) { dead = true; break; }
          }
          if (dead || b.left <= 0) { dead = true; break; }
        }
        if (!dead) alive.push(b);
      }
      this.shots = alive;
    }
    land(b) {
      if (b.kind === 'k' || b.kind === 'K') this.explode(b.owner, b.tx, b.ty, b.radius, b.dmg, b.isSuper);
      else if (b.kind === 'h') {
        const h = b.owner.h;
        this.zones.push({ x: b.tx, y: b.ty, r: h.sradius, team: b.team, left: h.sdur, owner: b.owner, heal: h.heal });
        this.ev('zone', rd(b.tx, 2), rd(b.ty, 2));
      }
    }
    updateZones() {
      for (const z of this.zones) {
        z.left -= DT;
        for (const q of this.players.values()) {
          if (!(q.alive && q.team === z.team && Math.hypot(q.x - z.x, q.y - z.y) < z.r + 0.2)) continue;
          const amount = Math.min(z.heal * DT, q.max_hp - q.hp);
          if (amount > 0) { q.hp += amount; q.healAcc += amount; z.owner.stats.heal += amount; }
          if (q.healAcc >= 150 || (q.healAcc > 0 && q.hp >= q.max_hp)) { this.ev('heal', q.id, rd(q.x, 2), rd(q.y, 2), Math.trunc(q.healAcc)); q.healAcc = 0; }
        }
      }
      this.zones = this.zones.filter(z => z.left > 0);
    }
    updateItems() {
      if (!this.items.length) return;
      const keep = [];
      for (const it of this.items) {
        let taker = null;
        for (const p of this.players.values()) if (p.alive && !p.airborne && (p.x - it[2]) ** 2 + (p.y - it[3]) ** 2 < 0.64) { taker = p; break; }
        if (!taker) { keep.push(it); continue; }
        if (it[1] === 'k') { taker.crystals += 1; taker.stats.crystals += 1; }
        else {
          taker.cells += 1;
          if (taker.cells <= MAX_CELLS) { taker.max_hp += 300; taker.hp += 300; }
          taker.dmgMult = 1 + 0.08 * Math.min(taker.cells, MAX_CELLS);
        }
        this.ev('pick', taker.id, it[1]);
      }
      this.items = keep;
    }
    updateMode() {
      const m = this.mode, ps = [...this.players.values()];
      if (this.modeKey === 'kristall') {
        this.mineT -= DT;
        const total = this.items.filter(it => it[1] === 'k').length + ps.reduce((a, p) => a + p.crystals, 0);
        if (this.mineT <= 0 && this.map.mine && total < MAX_CRYSTALS) {
          this.mineT = 7;
          const a = this.rng.random() * TAU, r = 0.7 + this.rng.random();
          const [x, y] = this.map.freeNear(this.map.mine[0] + Math.cos(a) * r, this.map.mine[1] + Math.sin(a) * r);
          this.items.push([this.nid(), 'k', rd(x, 2), rd(y, 2)]);
          this.ev('mine');
        }
        this.score = [0, 1].map(t => ps.filter(p => p.team === t).reduce((a, p) => a + p.crystals, 0));
        const lead = this.score[0] > this.score[1] ? 0 : this.score[1] > this.score[0] ? 1 : null;
        if (lead !== null && this.score[lead] >= m.goal) {
          if (!this.hold || this.hold[0] !== lead) { this.hold = [lead, m.hold]; this.ev('hold', lead); }
          this.hold[1] -= DT;
          if (this.hold[1] <= 0) return this.finish(lead, 'Kristalle gehalten');
        } else if (this.hold) { this.hold = null; this.ev('hold', -1); }
      } else if (this.modeKey === 'teamkampf') {
        for (const t of [0, 1]) if (this.score[t] >= m.goal) return this.finish(t, `${m.goal} K.o.s erreicht`);
      } else {
        const start = 25, end = 170, r0 = Math.hypot(this.map.w, this.map.h) / 2 + 1;
        if (this.t > start) { const f = Math.min(1, (this.t - start) / (end - start)); this.stormR = r0 + (2.5 - r0) * f; }
        const living = ps.filter(p => p.alive);
        if (ps.length > 1 && living.length <= 1) return this.finish(living.length ? living[0].id : -1, 'Letzter Überlebender');
      }
      if (this.t >= m.time) {
        if (this.teams) { const [a, b] = this.score; return this.finish(a > b ? 0 : b > a ? 1 : -1, 'Zeit abgelaufen'); }
        const living = ps.filter(p => p.alive).sort((a, b) => b.hp - a.hp);
        return this.finish(living.length ? living[0].id : -1, 'Zeit abgelaufen');
      }
    }
    finish(winner, reason) {
      this.over = true;
      const ps = [...this.players.values()];
      if (!this.teams) {
        ps.filter(p => p.alive).sort((a, b) => ((a.id !== winner) - (b.id !== winner)) || b.hp - a.hp).forEach((p, i) => { p.place = i + 1; });
      }
      const stats = ps.map(p => {
        const s = p.stats, pts = s.kos * 2 + s.dmg / 1500 + s.heal / 1500 + s.crystals * 1.5 - s.deaths * 0.5;
        return { id: p.id, name: p.name, hero: p.hero, team: p.team, bot: p.bot, kos: s.kos, deaths: s.deaths, dmg: Math.trunc(s.dmg),
          heal: Math.trunc(s.heal), crystals: s.crystals, place: p.place, points: rd(pts, 1) };
      });
      const pool = this.teams ? stats.filter(s => winner === -1 || s.team === winner) : stats;
      const star = pool.length ? pool.reduce((a, b) => (b.points > a.points ? b : a)).id : null;
      this.result = { winner, reason, score: this.score.slice(), stats, star, teams: this.teams };
      this.ev('end');
    }
    roster() { return [...this.players.values()].map(p => ({ id: p.id, name: p.name, hero: p.hero, team: p.team, bot: p.bot })); }
    snapshot(viewerId) {
      const viewer = this.players.get(viewerId), team = viewer ? viewer.team : null, out = [];
      for (const p of this.players.values()) {
        if (!this.visible(team, p)) continue;
        const flags = (p.alive ? 1 : 0) | (p.alive && this.map.bushAt(p.x, p.y) ? 2 : 0) | (p.shield > 0 ? 4 : 0) | (p.forced ? 8 : 0) | (p.airborne ? 16 : 0) | (p.bot ? 32 : 0);
        let z = 0;
        if (p.airborne && p.dash) { const f = p.dash.t / p.dash.dur; z = Math.round(4 * f * (1 - f) * 100); }
        out.push([p.id, rd(p.x, 3), rd(p.y, 3), Math.trunc(p.hp), p.max_hp, Math.round(p.face * 180 / Math.PI), flags, Math.trunc(p.ammo * 10),
          Math.trunc(p.super * 100), p.crystals, p.cells, z, p.alive ? 0 : rd(Math.max(0, p.respawn), 1)]);
      }
      const st = { t: 's', a: viewer ? viewer.ack : 0, p: out, k: this.tick, tl: rd(Math.max(0, this.mode.time - this.t), 1), sc: this.score.slice() };
      st.b = this.shots.map(b => b.lob ? [b.id, b.kind, rd(b.x, 2), rd(b.y, 2), Math.round(4 * (b.t / b.dur) * (1 - b.t / b.dur) * 100)] : [b.id, b.kind, rd(b.x, 2), rd(b.y, 2)]);
      st.o = this.items.map(it => it.slice());
      if (this.zones.length) st.z = this.zones.map(z => [rd(z.x, 2), rd(z.y, 2), z.r, z.team, rd(z.left, 1)]);
      if (!this.teams) { st.st = rd(this.stormR, 2); st.al = [...this.players.values()].filter(p => p.alive).length; }
      if (this.hold) st.hd = [this.hold[0], rd(this.hold[1], 1)];
      if (this.events.length) st.e = this.events;
      return st;
    }
  }

  // ---------------------------------------------------------------- Bots

  class BotBrain {
    constructor(rng) {
      Object.assign(this, { rng, scan: 0, target: null, react: 0.6 + rng.random() * 0.4, path: [], pathT: 0, goal: null,
        strafe: rng.random() < 0.5 ? 1 : -1, strafeT: 0, stuckT: 0, jitter: null, wander: null, wanderT: 0,
        emoteT: 25 + rng.random() * 40, last: [0, 0] });
    }
    think(g, p) {
      const rng = this.rng;
      if (!p.alive) { p.bm = [0, 0]; this.path = []; return; }
      this.scan -= DT; this.react -= DT; this.pathT -= DT; this.strafeT -= DT; this.wanderT -= DT; this.emoteT -= DT;
      const h = p.h;
      if (this.scan <= 0) {
        this.scan = 0.3;
        const reach = g.teams ? 13 : (g.stormR > 11 ? 5.5 : 8.5);
        let best = null, bs = 1e9;
        for (const q of g.players.values()) {
          if (q.team === p.team || !q.alive || q.airborne || !g.visible(p.team, q)) continue;
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d > reach && !(q.sinceAtk < 1 && d < reach + 3 && !g.teams)) continue;
          const s = d - (g.map.los(p.x, p.y, q.x, q.y) ? 3 : 0) + 1.5 * q.hp / q.max_hp;
          if (s < bs) { best = q; bs = s; }
        }
        const nt = best ? best.id : null;
        if (nt !== this.target && nt !== null) this.react = Math.max(this.react, 0.35 + rng.random() * 0.35);
        this.target = nt;
      }
      let tgt = this.target !== null ? g.players.get(this.target) : null;
      if (tgt && (!tgt.alive || !g.visible(p.team, tgt))) tgt = null;
      if (this.emoteT <= 0) { this.emoteT = 30 + rng.random() * 50; g.emote(p.id, rng.randrange(4)); }

      let goal = null, direct = null;
      const melee = MELEE.includes(h.attack), lob = h.attack === 'bomb';
      if (tgt) {
        const dx = tgt.x - p.x, dy = tgt.y - p.y, d = Math.hypot(dx, dy);
        const los = g.map.los(p.x, p.y, tgt.x, tgt.y), reach = h.range;
        const flee = p.hp < p.max_hp * (g.teams ? 0.33 : 0.45) && !(melee && tgt.hp < tgt.max_hp * 0.3 && d < reach + 1);
        const near = g.modeKey === 'kristall' ? this.nearCrystal(g, p) : null;
        if (flee) goal = this.safeSpot(g, p, tgt);
        else if (near) goal = near;
        else {
          const want = reach * (melee ? 0.45 : 0.68);
          if (d > want + 0.6 || (!los && !lob)) goal = [tgt.x, tgt.y];
          else if (d < want - 1.6 && !melee) direct = norm(-dx, -dy);
          else {
            if (this.strafeT <= 0) { this.strafe = -this.strafe; this.strafeT = 0.5 + rng.random() * 0.9; }
            const [ux, uy] = norm(dx, dy);
            direct = norm(-uy * this.strafe + ux * 0.25, ux * this.strafe + uy * 0.25);
          }
        }
        if ((los || lob) && d <= reach * 0.95 + (melee ? 0.3 : 0) && p.ammo >= 1 && p.cd <= 0 && this.react <= 0) {
          const [ax, ay, ad] = this.aim(p, tgt, h.bspeed, lob);
          g.attack(p.id, ax, ay, ad);
          this.react = 0.22 + rng.random() * 0.5;
        }
        if (p.super >= 1 && this.react <= 0) this.useSuper(g, p, tgt, d, los);
      } else goal = this.objective(g, p);
      if (p.super >= 1 && h.sup === 'heal' && this.react <= 0) this.useSuper(g, p, null, 0, true);
      if (!g.teams) {
        const [cx, cy] = g.map.center;
        if (Math.hypot(p.x - cx, p.y - cy) > g.stormR - 1.5) { goal = [cx, cy]; direct = null; }
      }
      if (this.jitter && this.jitter[2] > 0) { this.jitter[2] -= DT; direct = [this.jitter[0], this.jitter[1]]; }
      if (direct === null && goal !== null) {
        if (this.pathT <= 0 || !this.goal || Math.hypot(goal[0] - this.goal[0], goal[1] - this.goal[1]) > 1.5) {
          this.path = g.map.path(p.x, p.y, goal[0], goal[1]); this.pathT = 0.6; this.goal = goal;
        }
        while (this.path.length && Math.hypot(this.path[0][0] - p.x, this.path[0][1] - p.y) < 0.3) this.path.shift();
        const [tx, ty] = this.path.length ? this.path[0] : goal;
        if (Math.hypot(tx - p.x, ty - p.y) > 0.15) direct = norm(tx - p.x, ty - p.y);
      }
      p.bm = direct || [0, 0];
      if (p.bm[0] || p.bm[1]) {
        if (Math.hypot(p.x - this.last[0], p.y - this.last[1]) < 0.02) {
          this.stuckT += DT;
          if (this.stuckT > 0.5) { this.stuckT = 0; const a = rng.random() * TAU; this.jitter = [Math.cos(a), Math.sin(a), 0.3]; this.pathT = 0; }
        } else this.stuckT = 0;
      }
      this.last = [p.x, p.y];
    }
    aim(p, q, speed, lob) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      const t = lob ? 0.42 + d * 0.045 : speed ? d / speed : 0.05;
      const lead = 0.55 + this.rng.random() * 0.4, px = q.x + q.vx * t * lead, py = q.y + q.vy * t * lead;
      const ang = Math.atan2(py - p.y, px - p.x) + this.rng.gauss(0, 0.12);
      return [Math.cos(ang), Math.sin(ang), Math.hypot(px - p.x, py - p.y)];
    }
    useSuper(g, p, tgt, d, los) {
      const h = p.h, kind = h.sup;
      if (kind === 'heal') {
        const hurt = [...g.players.values()].filter(q => q.team === p.team && q.alive && q.hp < q.max_hp * 0.55 && Math.hypot(q.x - p.x, q.y - p.y) < h.srange);
        if (hurt.length) {
          const q = hurt.reduce((a, b) => (b.hp / b.max_hp < a.hp / a.max_hp ? b : a));
          const dx = q.x - p.x, dy = q.y - p.y;
          g.attack(p.id, dx || 0.01, dy, Math.hypot(dx, dy), true);
          this.react = 0.3;
        }
        return;
      }
      if (!tgt) return;
      const ok = { orb: los && d < h.srange * 0.85, pierce: los && d < h.srange * 0.9, charge: los && d < h.srange - 0.5,
        bigbomb: d < h.srange, leap: d < h.srange && (d > 2.5 || tgt.hp < tgt.max_hp * 0.6) }[kind];
      if (ok) {
        const [ax, ay, ad] = this.aim(p, tgt, h.sspeed, kind === 'bigbomb' || kind === 'leap');
        g.attack(p.id, ax, ay, ad, true);
        this.react = 0.3;
      }
    }
    nearCrystal(g, p) {
      let best = null, bd = 3.5 ** 2;
      for (const it of g.items) { const d = (it[2] - p.x) ** 2 + (it[3] - p.y) ** 2; if (it[1] === 'k' && d < bd) { best = [it[2], it[3]]; bd = d; } }
      return best;
    }
    safeSpot(g, p, threat) {
      if (g.teams) { const pts = g.map.spawns[p.team]; return pts.length ? pts[0] : g.map.center; }
      const [cx, cy] = g.map.center, [ux, uy] = norm(p.x - threat.x, p.y - threat.y);
      let x = p.x + ux * 5, y = p.y + uy * 5;
      const r = Math.max(1, g.stormR - 2), dx = x - cx, dy = y - cy, dd = Math.hypot(dx, dy);
      if (dd > r) { x = cx + dx / dd * r; y = cy + dy / dd * r; }
      return [x, y];
    }
    objective(g, p) {
      const dist2 = (x, y) => (x - p.x) ** 2 + (y - p.y) ** 2;
      if (g.modeKey === 'kristall') {
        const crystals = g.items.filter(it => it[1] === 'k');
        if (p.crystals >= 3 && g.hold && g.hold[0] === p.team) {
          const [sx, sy] = g.map.spawns[p.team][0], [cx, cy] = g.map.center;
          return [sx + (cx - sx) * 0.25, sy + (cy - sy) * 0.25];
        }
        if (crystals.length) { const it = crystals.reduce((a, b) => (dist2(b[2], b[3]) < dist2(a[2], a[3]) ? b : a)); return [it[2], it[3]]; }
        return g.map.mine || g.map.center;
      }
      if (!g.teams) {
        const cells = g.items.filter(it => it[1] === 'z');
        if (cells.length) {
          const it = cells.reduce((a, b) => (dist2(b[2], b[3]) < dist2(a[2], a[3]) ? b : a));
          if (Math.hypot(it[2] - p.x, it[3] - p.y) < 9) return [it[2], it[3]];
        }
        if (g.map.crates.size) {
          let bk = -1, bd = Infinity;
          for (const k of g.map.crates.keys()) { const d = dist2(k % g.map.w + 0.5, Math.floor(k / g.map.w) + 0.5); if (d < bd) { bd = d; bk = k; } }
          const tx = bk % g.map.w, ty = Math.floor(bk / g.map.w), cx = tx + 0.5, cy = ty + 0.5, d = Math.hypot(cx - p.x, cy - p.y);
          if (d < 10) {
            if (d < p.h.range * 0.9 && p.ammo >= 2 && p.cd <= 0 && this.react <= 0 && g.map.los(p.x, p.y, cx, cy, bk)) {
              g.attack(p.id, cx - p.x, cy - p.y, d);
              this.react = 0.3 + this.rng.random() * 0.3;
            }
            return g.map.freeNear(cx - (cx - p.x) / Math.max(d, 0.01) * 1.5, cy - (cy - p.y) / Math.max(d, 0.01) * 1.5);
          }
        }
      }
      if (!this.wander || this.wanderT <= 0 || Math.hypot(this.wander[0] - p.x, this.wander[1] - p.y) < 1) {
        const [cx, cy] = g.map.center;
        let x, y;
        if (g.teams) { x = cx + (this.rng.random() * 2 - 1) * 6; y = cy + (this.rng.random() * 2 - 1) * 4.2; }
        else {
          x = p.x + (this.rng.random() * 2 - 1) * 6; y = p.y + (this.rng.random() * 2 - 1) * 6;
          const r = Math.max(1, g.stormR - 2.5), d = Math.hypot(x - cx, y - cy);
          if (d > r) { x = cx + (x - cx) / d * r; y = cy + (y - cy) / d * r; }
        }
        this.wander = g.map.freeNear(x, y);
        this.wanderT = 4 + this.rng.random() * 4;
      }
      return this.wander;
    }
  }

  // ---------------------------------------------------------------- Ersatz für den Server (eine Person + Bots)

  function heroList() {
    const keys = ['name', 'role', 'color', 'hp', 'speed', 'range', 'attack', 'sup', 'srange', 'atext', 'sname', 'stext', 'radius', 'sradius', 'dmg', 'sdmg', 'count', 'reload', 'cd'];
    const out = {};
    for (const [k, v] of Object.entries(HEROES)) { out[k] = {}; for (const kk of keys) if (kk in v) out[k][kk] = v[kk]; }
    return out;
  }
  function modeList() {
    const out = {};
    for (const [k, v] of Object.entries(MODES)) out[k] = { name: v.name, teams: v.teams, max: v.max, text: v.text, map: MAPS[v.map].name, goal: v.goal ?? null };
    return out;
  }

  function socket(onMsg) {
    const me = { id: 1, name: 'Spieler', hero: 'funke', team: 0 };
    let room = null, game = null, timer = null, acc = 0, last = 0, botId = 100;
    const later = m => setTimeout(() => onMsg(m), 0);
    const info = () => ({ code: 'SOLO', mode: room.mode, public: false, host: me.id, state: room.state, bots: room.bots, max: MODES[room.mode].max, auto: null,
      members: [{ id: me.id, name: me.name, hero: me.hero, team: me.team }] });
    const sendRoom = () => { if (room) later({ t: 'room', room: info() }); };
    function stop() { if (timer) clearInterval(timer); timer = null; game = null; }
    function start() {
      if (!room) return;
      const m = MODES[room.mode];
      const entrants = [{ id: me.id, name: me.name, hero: me.hero, team: m.teams ? me.team : 0, bot: false }];
      const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
      const bot = team => {
        const used = entrants.filter(e => e.team === team || !m.teams).map(e => e.hero);
        const free = Object.keys(HEROES).filter(h => !used.includes(h));
        const pool = free.length ? free : Object.keys(HEROES);
        entrants.push({ id: ++botId, name: names.pop(), hero: pool[Math.floor(Math.random() * pool.length)], team, bot: true });
      };
      if (m.teams) {
        for (const t of [0, 1]) {
          const have = entrants.filter(e => e.team === t).length;
          const need = room.bots ? m.max / 2 - have : (have === 0 ? 1 : 0);
          for (let i = 0; i < need; i++) bot(t);
        }
      } else {
        const need = room.bots ? m.max - entrants.length : 1;
        for (let i = 0; i < need; i++) bot(0);
      }
      game = new Game(room.mode, entrants);
      room.state = 'game';
      const g = game;
      later({ t: 'start', mode: room.mode, map: { key: g.map.key, name: g.map.name, w: g.map.w, h: g.map.h, rows: g.map.rows() },
        roster: g.roster(), you: me.id, time: g.mode.time, dt: DT, R, t0: 0, tick: 0 });
      sendRoom();
      last = performance.now(); acc = 0;
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        if (!game) return;
        const now = performance.now();
        acc = Math.min(acc + (now - last) / 1000, 0.25);
        last = now;
        while (acc >= DT && game) {
          acc -= DT;
          game.step();
          onMsg(game.snapshot(me.id));
          game.events = [];
          if (game.over) {
            const res = game.result;
            stop();
            room.state = 'lobby';
            later({ t: 'end', result: res });
            sendRoom();
          }
        }
      }, 1000 / 60);
    }
    function handle(msg) {
      const t = msg.t;
      if (t === 'i') { if (game) game.queueInput(me.id, msg.s, (msg.m || [0, 0])[0], (msg.m || [0, 0])[1]); }
      else if (t === 'a') { if (game) game.attack(me.id, msg.x, msg.y, msg.d, msg.k === 'sup'); }
      else if (t === 'emo') { if (game) game.emote(me.id, msg.n | 0); }
      else if (t === 'ping') later({ t: 'pong', c: msg.c });
      else if (t === 'hello' || t === 'name') {
        me.name = String(msg.name || '').replace(/[^\wäöüÄÖÜß .!?-]/g, '').trim().slice(0, 16) || 'Spieler';
        if (HEROES[msg.hero]) me.hero = msg.hero;
        if (t === 'hello') later({ t: 'welcome', id: me.id, heroes: heroList(), modes: modeList(), info: { lan: [], internet: '', lokal: true } });
        else sendRoom();
      } else if (t === 'quick' || t === 'create') {
        if (HEROES[msg.hero]) me.hero = msg.hero;
        stop();
        room = { mode: MODES[msg.mode] ? msg.mode : 'teamkampf', bots: true, state: 'lobby' };
        me.team = 0;
        sendRoom();
        if (t === 'quick') setTimeout(start, 500);
      } else if (t === 'join') later({ t: 'err', msg: 'Räume mit Freunden gibt es nur mit dem Server auf dem Laptop – hier spielst du gegen Bots.' });
      else if (t === 'set') {
        if (HEROES[msg.hero]) me.hero = msg.hero;
        if (room && room.state === 'lobby') {
          if (msg.team === 'swap' && MODES[room.mode].teams) me.team = 1 - me.team;
          if (MODES[msg.mode]) room.mode = msg.mode;
          if ('bots' in msg) room.bots = !!msg.bots;
        }
        sendRoom();
      } else if (t === 'start') { if (room && room.state === 'lobby') start(); }
      else if (t === 'leave') { stop(); room = null; later({ t: 'left' }); }
    }
    return { readyState: 1, send(text) { try { handle(JSON.parse(text)); } catch (e) { console.error(e); } }, close() { stop(); } };
  }

  return { socket, Game, GameMap, move, DT, MODES, HEROES };
})();
