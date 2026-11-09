"""Tumult-Arena – Spiel-Logik: Helden, Karten, Simulation, Bots. Nur Standardbibliothek, ohne Netzwerk.

Koordinaten in Kacheln (1.0 = eine Kachel), Zeit in Sekunden. Die Simulation läuft in festen Schritten
(TICK pro Sekunde) und ist allein maßgeblich – die Browser sagen nur ihre eigene Bewegung voraus.
`move()` gibt es identisch in web/spiel.js, sonst ruckelt die Vorhersage.
"""
import json
import math
import random
from collections import deque

TICK = 30
DT = 1 / TICK
R = 0.42          # halbe Kantenlänge der Kollisionsbox eines Spielers (Bewegung)
HIT_R = 0.45      # Trefferkreis eines Spielers
EPS = 1e-6
SOLID = "#~x"     # blockiert Bewegung: Wand, Wasser, Kiste
BLOCK = "#x"      # blockiert Schüsse: Wand, Kiste
CRATE_HP = 2400
REGEN_WAIT = 3.0
REGEN_RATE = 0.12  # Anteil der max. LP pro Sekunde
SHIELD_TIME = 1.5
MAX_CRYSTALS = 29
MAX_CELLS = 12      # Energiezellen wirken bis hierhin (+300 Leben, +8 % Schaden je Zelle)

HEROES = {
    "funke": dict(
        name="Funke", role="Blitz-Schütze", color="#ffc93c", hp=3400, speed=3.1, reload=1.5, cd=0.45,
        range=7.0, charge=0.075, attack="burst", dmg=400, count=3, bspeed=16.0,
        sup="orb", sdmg=1500, srange=9.0, sspeed=8.5,
        atext="Salve aus drei Blitzen", sname="Kugelblitz",
        stext="Langsame Energiekugel – durchschlägt Gegner und Kisten"),
    "bolzen": dict(
        name="Bolzen", role="Scharfschütze", color="#7bd389", hp=2600, speed=2.9, reload=2.1, cd=0.6,
        range=10.5, charge=0.34, attack="bolt", dmg=1400, bspeed=22.0,
        sup="pierce", sdmg=1900, srange=12.0, sspeed=26.0,
        atext="Weiter, harter Armbrust-Bolzen", sname="Durchschuss",
        stext="Trifft alle Gegner in einer Linie und stößt sie zurück"),
    "brocken": dict(
        name="Brocken", role="Felsen-Panzer", color="#a3a8bf", hp=5800, speed=2.75, reload=1.6, cd=0.5,
        range=4.2, charge=0.05, attack="spread", dmg=320, count=5, bspeed=14.0,
        sup="charge", sdmg=1300, srange=5.5,
        atext="Fächer aus fünf Steinsplittern – aus der Nähe verheerend", sname="Sturmangriff",
        stext="Rammt Gegner weg und zertrümmert Kisten"),
    "zunder": dict(
        name="Zunder", role="Bombenwerfer", color="#ff7a45", hp=2800, speed=2.9, reload=1.9, cd=0.55,
        range=7.0, charge=0.25, attack="bomb", dmg=1100, radius=1.3,
        sup="bigbomb", sdmg=2100, srange=8.0, sradius=2.4,
        atext="Wirft eine Bombe über Wände hinweg", sname="Großer Knall",
        stext="Riesige Explosion, die auch Kisten sprengt"),
    "mira": dict(
        name="Mira", role="Heilerin", color="#46d1c4", hp=3200, speed=3.0, reload=1.4, cd=0.45,
        range=6.5, charge=0.2, attack="seed", dmg=950, bspeed=14.0,
        sup="heal", heal=700, srange=7.0, sradius=2.2, sdur=4.0,
        atext="Schleudert einen Dornensamen", sname="Heilgarten",
        stext="Heilt dein Team im Kreis, 4 Sekunden lang"),
    "klinge": dict(
        name="Klinge", role="Schattenklinge", color="#b07cff", hp=3800, speed=3.45, reload=1.0, cd=0.4,
        range=2.3, charge=0.25, attack="slash", dmg=1350,
        sup="leap", sdmg=1200, srange=6.5, sradius=1.6,
        atext="Schneller Klingenhieb im Halbkreis", sname="Schattensprung",
        stext="Springt über Wände und schlägt bei der Landung zu"),
}
MELEE = ("slash", "spread")

MODES = {
    "teamkampf": dict(name="Teamkampf", teams=True, max=6, map="schlucht", time=180, goal=15, respawn=3.0,
                      text="3 gegen 3 – das Team mit zuerst 15 K.o.s gewinnt."),
    "kristall": dict(name="Kristallrausch", teams=True, max=6, map="grube", time=180, goal=10, hold=15.0,
                     respawn=4.0, text="3 gegen 3 – holt 10 Kristalle aus der Mitte und haltet sie 15 Sekunden."),
    "letzter": dict(name="Letzter Stand", teams=False, max=8, map="insel", time=240,
                    text="Jeder gegen jeden – der Giftnebel zieht sich zu, wer zuletzt steht, gewinnt."),
}

BOT_NAMES = ["Klonk", "Rostfrei", "Zahnrad", "Blechbert", "Robo-Rita", "Tüftel", "Mecha-Moni", "Schraube",
             "Funkenflug", "Kurbel", "Nieten-Nils", "Surr", "Bitboy", "Lötlotte", "Ventil", "Gizmo"]

# ---------------------------------------------------------------- Karten
# . Boden  # Wand  ~ Wasser  " Busch  x Kiste  B/R Start Blau/Rot  S Start (jeder gegen jeden)  C Kristallmine
# Teamkarten: linke Hälfte inkl. Mittelspalte, der Rest entsteht durch 180°-Drehung (fair für beide Teams).
# Inselkarte: oberer linker Viertel inkl. Mitte, an beiden Achsen gespiegelt.

MAPS = {
    "schlucht": dict(name="Schluchtenhof", w=33, h=19, sym="rot", rows=[
        '"""".......###...',
        '""""...........""',
        '.......##......""',
        '..##...##...~~...',
        '..##........~~...',
        '......"""........',
        '"".....""...##...',
        '""..........##..#',
        '.....x...........',
        '.B...x.....""""..',
        '.....x...........',
        '""..........##..#',
        '"".....""...##...',
        '......"""........',
        '..##........~~...',
        '..##...##...~~...',
        '.......##......""',
        '""""...........""',
        '"""".......###...',
    ]),
    "grube": dict(name="Kristallgrube", w=33, h=19, sym="rot", rows=[
        '..""""......##...',
        '..""""...........',
        '.........~~~.....',
        '..###....~~~.."""',
        '.........~~~.."""',
        '"""..............',
        '"""....##........',
        '.......##....#...',
        '.............#...',
        '.B....""........C',
        '.............#...',
        '.......##....#...',
        '"""....##........',
        '"""..............',
        '.........~~~.."""',
        '..###....~~~.."""',
        '.........~~~.....',
        '..""""...........',
        '..""""......##...',
    ]),
    "insel": dict(name="Nebelinsel", w=41, h=41, sym="mirror", rows=[
        '~~~~~~~..............',
        '~~~~~....""""........',
        '~~~~.....""""....x...',
        '~~~..S..........##x..',
        '~~..............##...',
        '~~...##..x...........',
        '~....##..x......""".S',
        '...............""""..',
        '...xx....##..........',
        '..""".....##.....x...',
        '..""".........x..x...',
        '..........~~.........',
        '....##....~~...""....',
        '....##.........""....',
        '.x.......x...........',
        '..........##...#x#...',
        '...""".....##..#.....',
        '...""".x.............',
        '.................."""',
        '..x.......xx......"""',
        '.....S........##.....',
    ]),
}


def _build_rows(spec):
    w, h, rows = spec["w"], spec["h"], spec["rows"]
    grid = [[None] * w for _ in range(h)]
    if spec["sym"] == "rot":
        half = w // 2
        swap = {"B": "R", "R": "B"}
        for y in range(h):
            assert len(rows[y]) == half + 1, (spec["name"], y)
            for x in range(half + 1):
                grid[y][x] = rows[y][x]
        for y in range(h):
            for x in range(w):
                if x > half or (x == half and y > h // 2):
                    c = grid[h - 1 - y][w - 1 - x]
                    grid[y][x] = swap.get(c, c)
    else:
        hw, hh = w // 2, h // 2
        for y in range(hh + 1):
            assert len(rows[y]) == hw + 1, (spec["name"], y)
            for x in range(hw + 1):
                for yy in (y, h - 1 - y):
                    for xx in (x, w - 1 - x):
                        grid[yy][xx] = rows[y][x]
    return grid


class Map:
    def __init__(self, key):
        spec = MAPS[key]
        self.key, self.name = key, spec["name"]
        self.w, self.h = spec["w"], spec["h"]
        self.tiles = _build_rows(spec)
        self.spawns = {0: [], 1: [], "ffa": []}
        self.mine = None
        for y in range(self.h):
            for x in range(self.w):
                c = self.tiles[y][x]
                if c in "BRSC":
                    self.tiles[y][x] = "."
                    if c == "B":
                        self.spawns[0].append((x, y))
                    elif c == "R":
                        self.spawns[1].append((x, y))
                    elif c == "S":
                        self.spawns["ffa"].append((x + 0.5, y + 0.5))
                    else:
                        self.mine = (x + 0.5, y + 0.5)
        self.crates = {(x, y): CRATE_HP for y in range(self.h) for x in range(self.w) if self.tiles[y][x] == "x"}
        # Startplätze je Team: um die Startkachel herum
        for team in (0, 1):
            pts = []
            for (sx, sy) in self.spawns[team]:
                d = 1 if team == 0 else -1
                for ox, oy in ((0, 0), (0, -2), (0, 2), (d, -1), (d, 1), (0, -3), (0, 3), (d, 0)):
                    if not self.solid(sx + ox, sy + oy):
                        pts.append((sx + ox + 0.5, sy + oy + 0.5))
            self.spawns[team] = pts
        self.center = (self.w / 2, self.h / 2)

    def tile(self, tx, ty):
        if tx < 0 or ty < 0 or tx >= self.w or ty >= self.h:
            return "#"
        return self.tiles[ty][tx]

    def solid(self, tx, ty):
        return self.tile(tx, ty) in SOLID

    def blocks(self, tx, ty):
        return self.tile(tx, ty) in BLOCK

    def bush_at(self, x, y):
        return self.tile(math.floor(x), math.floor(y)) == '"'

    def rows(self):
        return ["".join(r) for r in self.tiles]

    def los(self, x0, y0, x1, y1, ignore=None):
        """Freie Schusslinie? (Wände und Kisten blockieren, Wasser und Büsche nicht)"""
        d = math.hypot(x1 - x0, y1 - y0)
        n = max(1, int(d / 0.25))
        for i in range(1, n):
            f = i / n
            tx, ty = math.floor(x0 + (x1 - x0) * f), math.floor(y0 + (y1 - y0) * f)
            if (tx, ty) != ignore and self.blocks(tx, ty):
                return False
        return True

    def free_near(self, x, y):
        """Nächster begehbarer Punkt (Kachelmitte) – für Landeplätze und Kristalle."""
        tx, ty = math.floor(x), math.floor(y)
        if not self.solid(tx, ty):
            return x, y
        for rad in range(1, 6):
            best = None
            for oy in range(-rad, rad + 1):
                for ox in range(-rad, rad + 1):
                    if max(abs(ox), abs(oy)) != rad or self.solid(tx + ox, ty + oy):
                        continue
                    cx, cy = tx + ox + 0.5, ty + oy + 0.5
                    d = (cx - x) ** 2 + (cy - y) ** 2
                    if best is None or d < best[0]:
                        best = (d, cx, cy)
            if best:
                return best[1], best[2]
        return x, y

    def path(self, sx, sy, gx, gy, limit=1500):
        """Breitensuche auf dem Kachelgitter → Liste von Kachelmitten bis zum Ziel (oder so nah wie möglich)."""
        start = (math.floor(sx), math.floor(sy))
        goal = (math.floor(gx), math.floor(gy))
        if start == goal:
            return []
        prev = {start: None}
        q = deque([start])
        best, bestd = start, (start[0] - goal[0]) ** 2 + (start[1] - goal[1]) ** 2
        while q and len(prev) < limit:
            cur = q.popleft()
            if cur == goal:
                best = cur
                break
            for ox, oy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nb = (cur[0] + ox, cur[1] + oy)
                if nb in prev or self.solid(*nb):
                    continue
                prev[nb] = cur
                d = (nb[0] - goal[0]) ** 2 + (nb[1] - goal[1]) ** 2
                if d < bestd:
                    best, bestd = nb, d
                q.append(nb)
        out = []
        cur = best
        while cur is not None and cur != start:
            out.append((cur[0] + 0.5, cur[1] + 0.5))
            cur = prev[cur]
        out.reverse()
        return out


def move(m, x, y, dx, dy):
    """Achsenweise bewegen und an festen Kacheln abgleiten. Identisch in web/spiel.js (Vorhersage)!"""
    if dx:
        nx = x + dx
        y0, y1 = math.floor(y - R), math.floor(y + R - EPS)
        if dx > 0:
            tx = math.floor(nx + R)
            for ty in range(y0, y1 + 1):
                if m.solid(tx, ty):
                    nx = tx - R - EPS
                    break
        else:
            tx = math.floor(nx - R)
            for ty in range(y0, y1 + 1):
                if m.solid(tx, ty):
                    nx = tx + 1 + R + EPS
                    break
        x = nx
    if dy:
        ny = y + dy
        x0, x1 = math.floor(x - R), math.floor(x + R - EPS)
        if dy > 0:
            ty = math.floor(ny + R)
            for tx in range(x0, x1 + 1):
                if m.solid(tx, ty):
                    ny = ty - R - EPS
                    break
        else:
            ty = math.floor(ny - R)
            for tx in range(x0, x1 + 1):
                if m.solid(tx, ty):
                    ny = ty + 1 + R + EPS
                    break
        y = ny
    return x, y


def _norm(x, y):
    d = math.hypot(x, y)
    return (x / d, y / d) if d > 1e-9 else (0.0, 0.0)


# ---------------------------------------------------------------- Spielfiguren


class Player:
    def __init__(self, pid, name, hero, team, bot):
        self.id, self.name, self.team, self.bot = pid, name, team, bot
        self.x = self.y = 0.0
        self.vx = self.vy = 0.0
        self.alive = False
        self.respawn = 0.0
        self.cells = 0
        self.dmg_mult = 1.0
        self.super = 0.0
        self.crystals = 0
        self.inputs = deque()
        self.ack = 0
        self.bm = (0.0, 0.0)          # Bot-Bewegung
        self.ai = None
        self.token = None
        self.stats = dict(kos=0, deaths=0, dmg=0, heal=0, crystals=0)
        self.place = 0
        self.set_hero(hero)
        self.reset_combat()

    def set_hero(self, hero):
        ratio = self.hp / self.max_hp if getattr(self, "max_hp", 0) else 1.0
        self.hero = hero
        self.h = HEROES[hero]
        self.max_hp = self.h["hp"] + 300 * min(self.cells, MAX_CELLS)
        self.hp = max(1, round(self.max_hp * ratio))

    def reset_combat(self):
        self.hp = self.max_hp
        self.ammo = 3.0
        self.cd = 0.0
        self.since_hit = 99.0
        self.since_atk = 99.0
        self.shield = 0.0
        self.face = 0.0
        self.face_hold = 0.0
        self.burst = []
        self.dash = None
        self.knock = None
        self.airborne = False
        self.storm_acc = 0.0
        self.heal_acc = 0.0
        self.inputs.clear()

    @property
    def forced(self):
        return self.dash is not None or self.knock is not None


class Shot:
    __slots__ = ("id", "kind", "owner", "team", "x", "y", "vx", "vy", "left", "dmg", "r", "pierce", "hit",
                 "is_super", "knock", "lob", "sx", "sy", "tx", "ty", "t", "dur", "radius")

    def __init__(self, sid, kind, owner, x, y):
        self.id, self.kind, self.owner, self.team = sid, kind, owner, owner.team
        self.x, self.y = x, y
        self.vx = self.vy = 0.0
        self.left = 0.0
        self.dmg = 0
        self.r = 0.15
        self.pierce = False
        self.hit = set()
        self.is_super = False
        self.knock = 0.0
        self.lob = False
        self.sx = self.sy = self.tx = self.ty = 0.0
        self.t = self.dur = self.radius = 0.0


# ---------------------------------------------------------------- Partie


class Game:
    def __init__(self, mode, entrants, seed=None):
        """entrants: Liste von dict(id, name, hero, team, bot)."""
        self.mode_key = mode
        self.mode = MODES[mode]
        self.teams = self.mode["teams"]
        self.map = Map(self.mode["map"])
        self.rng = random.Random(seed)
        self.players = {}
        self.shots = []
        self.zones = []
        self.items = []          # [id, art ('k' Kristall, 'z' Energiezelle), x, y]
        self.next_id = 1
        self.t = 0.0
        self.tick = 0
        self.score = [0, 0]
        self.events = []
        self.over = False
        self.result = None
        self.hold = None         # Kristallrausch: [team, Restzeit]
        self.mine_t = 4.0
        self.storm_r = math.hypot(self.map.w, self.map.h) / 2 + 1
        self.order = []          # Ausgeschiedene (jeder gegen jeden), früheste zuerst
        self._ffa_spawns = list(self.map.spawns["ffa"])
        self.rng.shuffle(self._ffa_spawns)
        self._common = None
        self._cache = {}
        for e in entrants:
            self.add_player(e)

    # ------------------------------------------------ Verwaltung

    def nid(self):
        self.next_id += 1
        return self.next_id

    def add_player(self, e):
        team = e.get("team", 0) if self.teams else 100 + len(self.players)
        p = Player(e["id"], e["name"], e["hero"], team, e.get("bot", False))
        p.token = e.get("token")
        if p.bot:
            p.ai = BotBrain(self.rng)
        self.players[p.id] = p
        if self.teams or self.t < 1:
            self.spawn(p)
        else:
            p.alive = False      # später Beitretende schauen bei „Letzter Stand“ zu
        return p

    def to_bot(self, pid):
        p = self.players.get(pid)
        if p:
            p.bot = True
            p.ai = BotBrain(self.rng)
            p.inputs.clear()

    def to_human(self, pid, name, hero, token=None):
        p = self.players.get(pid)
        if not p:
            return None
        p.bot, p.ai, p.name, p.token = False, None, name, token
        p.bm = (0.0, 0.0)
        if hero != p.hero:
            p.set_hero(hero)
        p.burst = []
        return p

    def ev(self, *e):
        self.events.append(list(e))

    def spawn(self, p):
        if self.teams:
            pts = self.map.spawns[p.team]
            enemies = [q for q in self.players.values() if q.alive and q.team != p.team]
            mates = [q for q in self.players.values() if q.alive and q.team == p.team and q is not p]

            def score(pt):
                de = min((math.hypot(pt[0] - q.x, pt[1] - q.y) for q in enemies), default=50)
                dm = min((math.hypot(pt[0] - q.x, pt[1] - q.y) for q in mates), default=5)
                return min(de, 12) + min(dm, 2) * 2 + self.rng.random() * 0.3
            x, y = max(pts, key=score)
        else:
            if not self._ffa_spawns:
                self._ffa_spawns = list(self.map.spawns["ffa"])
                self.rng.shuffle(self._ffa_spawns)
            x, y = self._ffa_spawns.pop()
        p.x, p.y = x, y
        p.alive = True
        p.reset_combat()
        p.shield = SHIELD_TIME
        p.face = 0.0 if (p.team == 0 or not self.teams) else math.pi
        self.ev("spawn", p.id)

    # ------------------------------------------------ Sichtbarkeit

    def visible(self, team, q):
        """Sieht `team` den Spieler q? (Gegner im Busch sind versteckt, außer jemand ist ganz nah dran.)"""
        if team is None or q.team == team or not q.alive:
            return True
        if not self.map.bush_at(q.x, q.y) or q.since_atk < 1.0 or q.since_hit < 0.6:
            return True
        for p in self.players.values():
            if p.alive and p.team == team and (p.x - q.x) ** 2 + (p.y - q.y) ** 2 < 2.4 ** 2:
                return True
        return False

    # ------------------------------------------------ Eingaben

    def queue_input(self, pid, seq, mx, my):
        p = self.players.get(pid)
        if not p or p.bot:
            return
        mx, my = float(mx), float(my)
        d = math.hypot(mx, my)
        if d > 1:
            mx, my = mx / d, my / d
        p.inputs.append((int(seq), mx, my))
        while len(p.inputs) > 12:
            seq, _, _ = p.inputs.popleft()
            p.ack = seq

    def emote(self, pid, n):
        p = self.players.get(pid)
        if p and p.alive and 0 <= int(n) < 6:
            self.ev("emo", p.id, int(n))

    def attack(self, pid, ax, ay, dist, sup=False):
        p = self.players.get(pid)
        if not p or not p.alive or p.dash or p.knock:
            return False
        h = p.h
        if sup:
            if p.super < 1:
                return False
            p.super = 0.0
        else:
            if p.ammo < 1 or p.cd > 0:
                return False
            p.ammo -= 1
            p.cd = h["cd"]
        ax, ay = _norm(float(ax), float(ay))
        if not ax and not ay:
            ax, ay = math.cos(p.face), math.sin(p.face)
        try:
            dist = float(dist)
        except (TypeError, ValueError):
            dist = 0.0
        ang = math.atan2(ay, ax)
        p.face, p.face_hold = ang, 0.45
        p.since_atk = 0.0
        p.shield = 0.0
        kind = h["sup"] if sup else h["attack"]
        self.ev("shot", p.id, kind, round(p.x, 2), round(p.y, 2), round(ang, 2))
        if kind == "burst":
            n = h["count"]
            p.burst = [(i * 0.09, ang + (i - (n - 1) / 2) * 0.035) for i in range(n)]
            self._update_burst(p)
        elif kind == "bolt":
            self.bullet(p, "b", ang, h["bspeed"], h["range"], h["dmg"], 0.14)
        elif kind == "seed":
            self.bullet(p, "s", ang, h["bspeed"], h["range"], h["dmg"], 0.17)
        elif kind == "spread":
            n = h["count"]
            for i in range(n):
                a = ang + (i - (n - 1) / 2) * 0.17
                self.bullet(p, "p", a, h["bspeed"], h["range"] * (0.92 + 0.08 * (i % 2)), h["dmg"], 0.13)
        elif kind == "slash":
            self.slash(p, ang)
        elif kind == "orb":
            b = self.bullet(p, "o", ang, h["sspeed"], h["srange"], h["sdmg"], 0.55, sup=True)
            b.pierce = True
        elif kind == "pierce":
            b = self.bullet(p, "B", ang, h["sspeed"], h["srange"], h["sdmg"], 0.24, sup=True)
            b.pierce, b.knock = True, 1.0
        elif kind in ("bomb", "bigbomb", "heal"):
            rng = h["srange"] if sup else h["range"]
            d = max(1.2, min(dist or rng * 0.75, rng))
            tx = min(max(p.x + ax * d, 0.3), self.map.w - 0.3)
            ty = min(max(p.y + ay * d, 0.3), self.map.h - 0.3)
            art = {"bomb": "k", "bigbomb": "K", "heal": "h"}[kind]
            b = Shot(self.nid(), art, p, p.x, p.y)
            b.lob, b.sx, b.sy, b.tx, b.ty = True, p.x, p.y, tx, ty
            b.dur = 0.42 + d * 0.045
            b.is_super = sup
            if kind == "bomb":
                b.dmg, b.radius = h["dmg"], h["radius"]
            elif kind == "bigbomb":
                b.dmg, b.radius = h["sdmg"], h["sradius"]
            self.shots.append(b)
        elif kind == "charge":
            p.dash = dict(kind="charge", dx=ax, dy=ay, left=h["srange"], speed=15.0, hit=set())
        elif kind == "leap":
            d = max(1.0, min(dist or h["srange"], h["srange"]))
            tx = min(max(p.x + ax * d, 0.5), self.map.w - 0.5)
            ty = min(max(p.y + ay * d, 0.5), self.map.h - 0.5)
            tx, ty = self.map.free_near(tx, ty)
            p.dash = dict(kind="leap", sx=p.x, sy=p.y, tx=tx, ty=ty, t=0.0, dur=0.42)
            p.airborne = True
        return True

    def bullet(self, p, kind, ang, speed, rng, dmg, r, sup=False):
        b = Shot(self.nid(), kind, p, p.x, p.y)
        b.vx, b.vy = math.cos(ang) * speed, math.sin(ang) * speed
        b.left, b.dmg, b.r, b.is_super = rng, dmg, r, sup
        self.shots.append(b)
        return b

    def _update_burst(self, p):
        rest = []
        for delay, a in p.burst:
            if delay <= 1e-9:
                self.bullet(p, "z", a, p.h["bspeed"], p.h["range"], p.h["dmg"], 0.15)
            else:
                rest.append((delay - DT, a))
        p.burst = rest

    # ------------------------------------------------ Schaden

    def damage(self, q, amount, src, is_super=False, kind="hit"):
        if not q.alive or q.shield > 0 or q.airborne or self.over:
            return 0
        if src is not None:
            amount *= src.dmg_mult
        amount = int(round(amount))
        q.hp -= amount
        q.since_hit = 0.0
        self.ev("hit", q.id, round(q.x, 2), round(q.y, 2), amount, src.id if src else 0)
        if src is not None:
            src.stats["dmg"] += amount
            if not is_super and src.alive:
                was = src.super
                src.super = min(1.0, src.super + src.h["charge"])
                if was < 1 <= src.super:
                    self.ev("ready", src.id)
        if q.hp <= 0:
            self.kill(q, src)
        return amount

    def kill(self, q, src):
        q.alive = False
        q.hp = 0
        q.burst, q.dash, q.knock, q.airborne = [], None, None, False
        q.stats["deaths"] += 1
        if src is not None and src is not q:
            src.stats["kos"] += 1
        self.ev("ko", src.id if src else 0, q.id, round(q.x, 2), round(q.y, 2))
        if self.mode_key == "teamkampf" and src is not None and src.team != q.team:
            self.score[src.team] += 1
        if q.crystals:
            self.scatter(q.x, q.y, "k", q.crystals)
            q.crystals = 0
        if self.teams:
            q.respawn = self.mode["respawn"]
        else:
            q.place = sum(1 for p in self.players.values() if p.alive) + 1
            self.order.append(q.id)
            if q.cells:
                self.scatter(q.x, q.y, "z", max(1, q.cells // 2 + 1))

    def scatter(self, x, y, art, n):
        for i in range(n):
            a = self.rng.random() * math.tau
            r = 0.3 + self.rng.random() * 1.1
            px, py = self.map.free_near(x + math.cos(a) * r, y + math.sin(a) * r)
            self.items.append([self.nid(), art, round(px, 2), round(py, 2)])

    def crate_hit(self, tx, ty, dmg):
        if (tx, ty) not in self.map.crates:
            return False
        self.map.crates[(tx, ty)] -= dmg
        if self.map.crates[(tx, ty)] > 0:
            self.ev("box", tx, ty)
            return False
        del self.map.crates[(tx, ty)]
        self.map.tiles[ty][tx] = "."
        self.ev("crate", tx, ty)
        if not self.teams:
            self.items.append([self.nid(), "z", tx + 0.5, ty + 0.5])
        return True

    def slash(self, p, ang):
        h = p.h
        self.ev("slash", round(p.x, 2), round(p.y, 2), round(ang, 2))
        for q in list(self.players.values()):
            if q.team == p.team or not q.alive:
                continue
            dx, dy = q.x - p.x, q.y - p.y
            d = math.hypot(dx, dy)
            if d > h["range"] + HIT_R:
                continue
            diff = abs((math.atan2(dy, dx) - ang + math.pi) % math.tau - math.pi)
            if (d < 0.7 or diff < 0.75) and self.map.los(p.x, p.y, q.x, q.y):
                self.damage(q, h["dmg"], p)
        for (tx, ty) in list(self.map.crates):
            cx, cy = tx + 0.5 - p.x, ty + 0.5 - p.y
            d = math.hypot(cx, cy)
            if d < h["range"] + 0.4:
                diff = abs((math.atan2(cy, cx) - ang + math.pi) % math.tau - math.pi)
                if diff < 0.75:
                    self.crate_hit(tx, ty, h["dmg"])

    def explode(self, src, x, y, radius, dmg, is_super):
        self.ev("boom", round(x, 2), round(y, 2), radius)
        for q in list(self.players.values()):
            if q.team != src.team and q.alive and math.hypot(q.x - x, q.y - y) < radius + 0.3:
                self.damage(q, dmg, src, is_super)
        r = math.ceil(radius)
        for ty in range(math.floor(y) - r, math.floor(y) + r + 1):
            for tx in range(math.floor(x) - r, math.floor(x) + r + 1):
                if (tx, ty) in self.map.crates and math.hypot(tx + 0.5 - x, ty + 0.5 - y) < radius + 0.4:
                    self.crate_hit(tx, ty, dmg * (2 if is_super else 1))

    # ------------------------------------------------ Simulation

    def step(self):
        if self.over:
            return
        self.tick += 1
        self.t += DT
        for p in self.players.values():
            if p.bot:
                p.ai.think(self, p)
        for p in list(self.players.values()):
            self._update_player(p)
        self._update_shots()
        self._update_zones()
        self._update_items()
        self._update_mode()

    def _update_player(self, p):
        ox, oy = p.x, p.y
        if not p.alive:
            while p.inputs:            # Eingaben trotzdem bestätigen, sonst hängt die Vorhersage
                p.ack = p.inputs.popleft()[0]
            if self.teams and not self.over:
                p.respawn -= DT
                if p.respawn <= 0:
                    self.spawn(p)
            p.vx = p.vy = 0.0
            return
        h = p.h
        p.cd = max(0.0, p.cd - DT)
        p.since_hit += DT
        p.since_atk += DT
        p.shield = max(0.0, p.shield - DT)
        p.face_hold = max(0.0, p.face_hold - DT)
        if p.ammo < 3:
            p.ammo = min(3.0, p.ammo + DT / h["reload"])
        if p.since_hit >= REGEN_WAIT and p.since_atk >= REGEN_WAIT and p.hp < p.max_hp:
            p.hp = min(p.max_hp, p.hp + p.max_hp * REGEN_RATE * DT)
        if p.burst:
            self._update_burst(p)

        steps = []
        if p.bot:
            steps.append(p.bm)
        else:
            n = 1 if len(p.inputs) <= 3 else 2
            for _ in range(min(n, len(p.inputs))):
                seq, mx, my = p.inputs.popleft()
                p.ack = seq
                steps.append((mx, my))
        if p.dash:
            self._update_dash(p)
        elif p.knock:
            k = p.knock
            p.x, p.y = move(self.map, p.x, p.y, k[0] * DT, k[1] * DT)
            k[2] -= DT
            if k[2] <= 0:
                p.knock = None
        else:
            spd = h["speed"]
            for mx, my in steps:
                if mx or my:
                    p.x, p.y = move(self.map, p.x, p.y, mx * spd * DT, my * spd * DT)
                    if p.face_hold <= 0:
                        p.face = math.atan2(my, mx)
        p.vx, p.vy = (p.x - ox) / DT, (p.y - oy) / DT
        if p.alive and not self.teams and math.hypot(p.x - self.map.center[0], p.y - self.map.center[1]) > self.storm_r:
            p.storm_acc += DT
            if p.storm_acc >= 0.5:
                p.storm_acc -= 0.5
                self.damage(p, 450 + max(0.0, self.t - 140) * 6, None, kind="storm")
        else:
            p.storm_acc = 0.0

    def _update_dash(self, p):
        d = p.dash
        if d["kind"] == "leap":
            d["t"] += DT
            f = min(1.0, d["t"] / d["dur"])
            p.x = d["sx"] + (d["tx"] - d["sx"]) * f
            p.y = d["sy"] + (d["ty"] - d["sy"]) * f
            if f >= 1:
                p.dash, p.airborne = None, False
                h = p.h
                self.ev("land", round(p.x, 2), round(p.y, 2), h["sradius"])
                for q in list(self.players.values()):
                    if q.team != p.team and q.alive and math.hypot(q.x - p.x, q.y - p.y) < h["sradius"] + 0.3:
                        self.damage(q, h["sdmg"], p, True)
            return
        step = min(d["speed"] * DT, d["left"])
        ahead_x, ahead_y = p.x + d["dx"] * (R + step + 0.05), p.y + d["dy"] * (R + step + 0.05)
        self.crate_hit(math.floor(ahead_x), math.floor(ahead_y), 99999)
        nx, ny = move(self.map, p.x, p.y, d["dx"] * step, d["dy"] * step)
        moved = math.hypot(nx - p.x, ny - p.y)
        p.x, p.y = nx, ny
        d["left"] -= step
        for q in list(self.players.values()):
            if q.team != p.team and q.alive and q.id not in d["hit"] and math.hypot(q.x - p.x, q.y - p.y) < 1.0:
                d["hit"].add(q.id)
                self.damage(q, p.h["sdmg"], p, True)
                if q.alive:
                    q.knock = [d["dx"] * 9.0, d["dy"] * 9.0, 0.25]
                    q.dash = None
                    q.airborne = False
        if d["left"] <= 1e-6 or moved < step * 0.4:
            p.dash = None

    def _update_shots(self):
        alive = []
        for b in self.shots:
            if b.lob:
                b.t += DT
                f = min(1.0, b.t / b.dur)
                b.x = b.sx + (b.tx - b.sx) * f
                b.y = b.sy + (b.ty - b.sy) * f
                if f >= 1:
                    self._land(b)
                else:
                    alive.append(b)
                continue
            dead = False
            sub = 3
            speed = math.hypot(b.vx, b.vy)
            for _ in range(sub):
                b.x += b.vx * DT / sub
                b.y += b.vy * DT / sub
                b.left -= speed * DT / sub
                tx, ty = math.floor(b.x), math.floor(b.y)
                if self.map.blocks(tx, ty):
                    broke = self.crate_hit(tx, ty, b.dmg * (2 if b.is_super else 1))
                    if not (broke and b.kind == "o"):
                        dead = True
                        self.ev("puff", round(b.x, 2), round(b.y, 2), b.kind)
                        break
                for q in self.players.values():
                    if (q.team == b.team or not q.alive or q.airborne or q.id in b.hit
                            or (q.x - b.x) ** 2 + (q.y - b.y) ** 2 > (HIT_R + b.r) ** 2):
                        continue
                    b.hit.add(q.id)
                    self.damage(q, b.dmg, b.owner, b.is_super)
                    if b.knock and q.alive and not q.dash:
                        kx, ky = _norm(b.vx, b.vy)
                        q.knock = [kx * 6.0, ky * 6.0, 0.18]
                    if not b.pierce:
                        dead = True
                        break
                if dead or b.left <= 0:
                    dead = True
                    break
            if not dead:
                alive.append(b)
        self.shots = alive

    def _land(self, b):
        if b.kind in ("k", "K"):
            self.explode(b.owner, b.tx, b.ty, b.radius, b.dmg, b.is_super)
        elif b.kind == "h":
            h = b.owner.h
            self.zones.append(dict(x=b.tx, y=b.ty, r=h["sradius"], team=b.team, left=h["sdur"], owner=b.owner,
                                   heal=h["heal"]))
            self.ev("zone", round(b.tx, 2), round(b.ty, 2))

    def _update_zones(self):
        for z in self.zones:
            z["left"] -= DT
            for q in self.players.values():
                if q.alive and q.team == z["team"] and math.hypot(q.x - z["x"], q.y - z["y"]) < z["r"] + 0.2:
                    amount = min(z["heal"] * DT, q.max_hp - q.hp)
                    if amount > 0:
                        q.hp += amount
                        q.heal_acc += amount
                        z["owner"].stats["heal"] += amount
                    if q.heal_acc >= 150 or (q.heal_acc > 0 and q.hp >= q.max_hp):
                        self.ev("heal", q.id, round(q.x, 2), round(q.y, 2), int(q.heal_acc))
                        q.heal_acc = 0.0
        self.zones = [z for z in self.zones if z["left"] > 0]

    def _update_items(self):
        if not self.items:
            return
        keep = []
        for it in self.items:
            taker = None
            for p in self.players.values():
                if p.alive and not p.airborne and (p.x - it[2]) ** 2 + (p.y - it[3]) ** 2 < 0.8 ** 2:
                    taker = p
                    break
            if not taker:
                keep.append(it)
                continue
            if it[1] == "k":
                taker.crystals += 1
                taker.stats["crystals"] += 1
            else:
                taker.cells += 1
                if taker.cells <= MAX_CELLS:
                    taker.max_hp += 300
                    taker.hp += 300
                taker.dmg_mult = 1 + 0.08 * min(taker.cells, MAX_CELLS)
            self.ev("pick", taker.id, it[1])
        self.items = keep

    def _update_mode(self):
        m = self.mode
        if self.mode_key == "kristall":
            self.mine_t -= DT
            total = sum(1 for it in self.items if it[1] == "k") + sum(p.crystals for p in self.players.values())
            if self.mine_t <= 0 and self.map.mine and total < MAX_CRYSTALS:
                self.mine_t = 7.0
                a = self.rng.random() * math.tau
                r = 0.7 + self.rng.random() * 1.0
                x, y = self.map.free_near(self.map.mine[0] + math.cos(a) * r, self.map.mine[1] + math.sin(a) * r)
                self.items.append([self.nid(), "k", round(x, 2), round(y, 2)])
                self.ev("mine")
            self.score = [sum(p.crystals for p in self.players.values() if p.team == t) for t in (0, 1)]
            lead = 0 if self.score[0] > self.score[1] else 1 if self.score[1] > self.score[0] else None
            if lead is not None and self.score[lead] >= m["goal"]:
                if not self.hold or self.hold[0] != lead:
                    self.hold = [lead, m["hold"]]
                    self.ev("hold", lead)
                self.hold[1] -= DT
                if self.hold[1] <= 0:
                    return self.finish(lead, "Kristalle gehalten")
            elif self.hold:
                self.hold = None
                self.ev("hold", -1)
        elif self.mode_key == "teamkampf":
            for t in (0, 1):
                if self.score[t] >= m["goal"]:
                    return self.finish(t, f"{m['goal']} K.o.s erreicht")
        else:
            start, end = 25.0, 170.0
            r0 = math.hypot(self.map.w, self.map.h) / 2 + 1
            if self.t > start:
                f = min(1.0, (self.t - start) / (end - start))
                self.storm_r = r0 + (2.5 - r0) * f
            living = [p for p in self.players.values() if p.alive]
            if len(self.players) > 1 and len(living) <= 1:
                return self.finish(living[0].id if living else -1, "Letzter Überlebender")
        if self.t >= m["time"]:
            if self.teams:
                a, b = self.score
                return self.finish(0 if a > b else 1 if b > a else -1, "Zeit abgelaufen")
            living = sorted((p for p in self.players.values() if p.alive), key=lambda p: -p.hp)
            return self.finish(living[0].id if living else -1, "Zeit abgelaufen")

    def finish(self, winner, reason):
        self.over = True
        if not self.teams:
            ranked = [p for p in self.players.values() if p.alive]
            ranked.sort(key=lambda p: (p.id != winner, -p.hp))
            for i, p in enumerate(ranked):
                p.place = i + 1
        stats = []
        for p in self.players.values():
            s = p.stats
            pts = s["kos"] * 2 + s["dmg"] / 1500 + s["heal"] / 1500 + s["crystals"] * 1.5 - s["deaths"] * 0.5
            stats.append(dict(id=p.id, name=p.name, hero=p.hero, team=p.team, bot=p.bot, kos=s["kos"],
                              deaths=s["deaths"], dmg=int(s["dmg"]), heal=int(s["heal"]),
                              crystals=s["crystals"], place=p.place, points=round(pts, 1)))
        if self.teams:
            pool = [s for s in stats if winner == -1 or s["team"] == winner]
        else:
            pool = stats
        star = max(pool, key=lambda s: s["points"])["id"] if pool else None
        self.result = dict(winner=winner, reason=reason, score=self.score, stats=stats, star=star,
                           teams=self.teams)
        self.ev("end")

    # ------------------------------------------------ Netzwerk-Zustand

    def roster(self):
        return [dict(id=p.id, name=p.name, hero=p.hero, team=p.team, bot=p.bot) for p in self.players.values()]

    def prepare(self):
        """Einmal pro gesendetem Zustand: gemeinsamer Teil + Cache leeren. Danach events leeren."""
        st = dict(k=self.tick, tl=round(max(0.0, self.mode["time"] - self.t), 1), sc=self.score)
        st["b"] = [([b.id, b.kind, round(b.x, 2), round(b.y, 2),
                     round(4 * (b.t / b.dur) * (1 - b.t / b.dur) * 100)] if b.lob else
                    [b.id, b.kind, round(b.x, 2), round(b.y, 2)]) for b in self.shots]
        st["o"] = self.items
        if self.zones:
            st["z"] = [[round(z["x"], 2), round(z["y"], 2), z["r"], z["team"], round(z["left"], 1)]
                       for z in self.zones]
        if not self.teams:
            st["st"] = round(self.storm_r, 2)
            st["al"] = sum(1 for p in self.players.values() if p.alive)
        if self.hold:
            st["hd"] = [self.hold[0], round(self.hold[1], 1)]
        if self.events:
            st["e"] = self.events
        self._common = json.dumps(st, separators=(",", ":"))[1:-1]
        self._cache = {}

    def _players_for(self, team):
        out = []
        for p in self.players.values():
            if not self.visible(team, p):
                continue
            flags = (1 if p.alive else 0) | (2 if p.alive and self.map.bush_at(p.x, p.y) else 0) | \
                    (4 if p.shield > 0 else 0) | (8 if p.forced else 0) | (16 if p.airborne else 0) | \
                    (32 if p.bot else 0)
            z = 0
            if p.airborne and p.dash:
                f = p.dash["t"] / p.dash["dur"]
                z = round(4 * f * (1 - f) * 100)
            out.append([p.id, round(p.x, 3), round(p.y, 3), int(p.hp), p.max_hp, round(math.degrees(p.face)),
                        flags, int(p.ammo * 10), int(p.super * 100), p.crystals, p.cells, z,
                        round(max(0.0, p.respawn), 1) if not p.alive else 0])
        return json.dumps(out, separators=(",", ":"))

    def snapshot(self, viewer_id):
        p = self.players.get(viewer_id)
        team = p.team if p else None
        if team not in self._cache:
            self._cache[team] = self._players_for(team)
        return '{"t":"s","a":%d,"p":%s,%s}' % (p.ack if p else 0, self._cache[team], self._common)


# ---------------------------------------------------------------- Bots


class BotBrain:
    def __init__(self, rng):
        self.rng = rng
        self.scan = 0.0
        self.target = None
        self.react = 0.6 + rng.random() * 0.4
        self.path = []
        self.path_t = 0.0
        self.goal = None
        self.strafe = 1 if rng.random() < 0.5 else -1
        self.strafe_t = 0.0
        self.stuck_t = 0.0
        self.jitter = None
        self.wander = None
        self.wander_t = 0.0
        self.emote_t = 25 + rng.random() * 40
        self.last = (0.0, 0.0)

    def think(self, g, p):
        rng = self.rng
        if not p.alive:
            p.bm = (0.0, 0.0)
            self.path = []
            return
        self.scan -= DT
        self.react -= DT
        self.path_t -= DT
        self.strafe_t -= DT
        self.wander_t -= DT
        self.emote_t -= DT
        h = p.h
        if self.scan <= 0:
            self.scan = 0.3
            # Jeder gegen jeden: erst Kisten plündern, nur nahe Gegner angreifen
            reach = 13.0 if g.teams else (5.5 if g.storm_r > 11 else 8.5)
            best, bs = None, 1e9
            for q in g.players.values():
                if q.team == p.team or not q.alive or q.airborne or not g.visible(p.team, q):
                    continue
                d = math.hypot(q.x - p.x, q.y - p.y)
                if d > reach and not (q.since_atk < 1.0 and d < reach + 3 and not g.teams):
                    continue
                s = d - (3 if g.map.los(p.x, p.y, q.x, q.y) else 0) + 1.5 * q.hp / q.max_hp
                if s < bs:
                    best, bs = q, s
            nt = best.id if best else None
            if nt != self.target and nt is not None:
                self.react = max(self.react, 0.35 + rng.random() * 0.35)
            self.target = nt
        tgt = g.players.get(self.target) if self.target is not None else None
        if tgt and (not tgt.alive or not g.visible(p.team, tgt)):
            tgt = None
        if self.emote_t <= 0:
            self.emote_t = 30 + rng.random() * 50
            g.emote(p.id, rng.randrange(4))

        goal, direct = None, None
        melee = h["attack"] in MELEE
        lob = h["attack"] == "bomb"
        if tgt:
            dx, dy = tgt.x - p.x, tgt.y - p.y
            d = math.hypot(dx, dy)
            los = g.map.los(p.x, p.y, tgt.x, tgt.y)
            reach = h["range"]
            flee = p.hp < p.max_hp * (0.33 if g.teams else 0.45) and not (melee and tgt.hp < tgt.max_hp * 0.3 and d < reach + 1)
            near = self.near_crystal(g, p) if g.mode_key == "kristall" else None
            if flee:
                goal = self.safe_spot(g, p, tgt)
            elif near:
                goal = near
            else:
                want = reach * (0.45 if melee else 0.68)
                if d > want + 0.6 or (not los and not lob):
                    goal = (tgt.x, tgt.y)
                elif d < want - 1.6 and not melee:
                    direct = _norm(-dx, -dy)
                else:
                    if self.strafe_t <= 0:
                        self.strafe = -self.strafe
                        self.strafe_t = 0.5 + rng.random() * 0.9
                    ux, uy = _norm(dx, dy)
                    direct = _norm(-uy * self.strafe + ux * 0.25, ux * self.strafe + uy * 0.25)
            if (los or lob) and d <= reach * 0.95 + (0.3 if melee else 0) and p.ammo >= 1 and p.cd <= 0 \
                    and self.react <= 0:
                ax, ay, ad = self.aim(p, tgt, h.get("bspeed"), lob)
                g.attack(p.id, ax, ay, ad)
                self.react = 0.22 + rng.random() * 0.5
            if p.super >= 1 and self.react <= 0:
                self.use_super(g, p, tgt, d, los)
        else:
            goal = self.objective(g, p)
        if p.super >= 1 and h["sup"] == "heal" and self.react <= 0:
            self.use_super(g, p, None, 0, True)

        if not g.teams and goal is None and direct is None:
            pass
        if not g.teams:     # Giftnebel meiden
            cx, cy = g.map.center
            if math.hypot(p.x - cx, p.y - cy) > g.storm_r - 1.5:
                goal, direct = (cx, cy), None

        if self.jitter and self.jitter[2] > 0:
            self.jitter[2] -= DT
            direct = (self.jitter[0], self.jitter[1])
        if direct is None and goal is not None:
            if self.path_t <= 0 or self.goal is None or math.hypot(goal[0] - self.goal[0], goal[1] - self.goal[1]) > 1.5:
                self.path = g.map.path(p.x, p.y, goal[0], goal[1])
                self.path_t = 0.6
                self.goal = goal
            while self.path and math.hypot(self.path[0][0] - p.x, self.path[0][1] - p.y) < 0.3:
                self.path.pop(0)
            tx, ty = self.path[0] if self.path else goal
            if math.hypot(tx - p.x, ty - p.y) > 0.15:
                direct = _norm(tx - p.x, ty - p.y)
        p.bm = direct or (0.0, 0.0)
        if p.bm != (0.0, 0.0):
            if math.hypot(p.x - self.last[0], p.y - self.last[1]) < 0.02:
                self.stuck_t += DT
                if self.stuck_t > 0.5:
                    self.stuck_t = 0
                    a = rng.random() * math.tau
                    self.jitter = [math.cos(a), math.sin(a), 0.3]
                    self.path_t = 0
            else:
                self.stuck_t = 0
        self.last = (p.x, p.y)

    def aim(self, p, q, speed, lob):
        d = math.hypot(q.x - p.x, q.y - p.y)
        t = (0.42 + d * 0.045) if lob else d / speed if speed else 0.05
        lead = 0.55 + self.rng.random() * 0.4
        px, py = q.x + q.vx * t * lead, q.y + q.vy * t * lead
        ang = math.atan2(py - p.y, px - p.x) + self.rng.gauss(0, 0.12)
        return math.cos(ang), math.sin(ang), math.hypot(px - p.x, py - p.y)

    def use_super(self, g, p, tgt, d, los):
        h = p.h
        kind = h["sup"]
        if kind == "heal":
            hurt = [q for q in g.players.values() if q.team == p.team and q.alive and q.hp < q.max_hp * 0.55
                    and math.hypot(q.x - p.x, q.y - p.y) < h["srange"]]
            if hurt:
                q = min(hurt, key=lambda q: q.hp / q.max_hp)
                dx, dy = q.x - p.x, q.y - p.y
                g.attack(p.id, dx or 0.01, dy, math.hypot(dx, dy), sup=True)
                self.react = 0.3
            return
        if not tgt:
            return
        ok = {"orb": los and d < h["srange"] * 0.85, "pierce": los and d < h["srange"] * 0.9,
              "charge": los and d < h["srange"] - 0.5, "bigbomb": d < h["srange"],
              "leap": d < h["srange"] and (d > 2.5 or tgt.hp < tgt.max_hp * 0.6)}.get(kind, False)
        if ok:
            ax, ay, ad = self.aim(p, tgt, h.get("sspeed"), kind in ("bigbomb", "leap"))
            g.attack(p.id, ax, ay, ad, sup=True)
            self.react = 0.3

    @staticmethod
    def near_crystal(g, p):
        best, bd = None, 3.5 ** 2
        for it in g.items:
            d = (it[2] - p.x) ** 2 + (it[3] - p.y) ** 2
            if it[1] == "k" and d < bd:
                best, bd = (it[2], it[3]), d
        return best

    def safe_spot(self, g, p, threat):
        if g.teams:
            pts = g.map.spawns[p.team]
            return pts[0] if pts else g.map.center
        cx, cy = g.map.center
        ux, uy = _norm(p.x - threat.x, p.y - threat.y)
        x, y = p.x + ux * 5, p.y + uy * 5
        r = max(1.0, g.storm_r - 2)
        dx, dy = x - cx, y - cy
        dd = math.hypot(dx, dy)
        if dd > r:
            x, y = cx + dx / dd * r, cy + dy / dd * r
        return x, y

    def objective(self, g, p):
        if g.mode_key == "kristall":
            crystals = [it for it in g.items if it[1] == "k"]
            if p.crystals >= 3 and g.hold and g.hold[0] == p.team:
                sx, sy = g.map.spawns[p.team][0]
                cx, cy = g.map.center
                return sx + (cx - sx) * 0.25, sy + (cy - sy) * 0.25
            if crystals:
                it = min(crystals, key=lambda it: (it[2] - p.x) ** 2 + (it[3] - p.y) ** 2)
                return it[2], it[3]
            return g.map.mine or g.map.center
        if not g.teams:
            cells = [it for it in g.items if it[1] == "z"]
            if cells:
                it = min(cells, key=lambda it: (it[2] - p.x) ** 2 + (it[3] - p.y) ** 2)
                if math.hypot(it[2] - p.x, it[3] - p.y) < 9:
                    return it[2], it[3]
            if g.map.crates:
                tx, ty = min(g.map.crates, key=lambda c: (c[0] + 0.5 - p.x) ** 2 + (c[1] + 0.5 - p.y) ** 2)
                cx, cy = tx + 0.5, ty + 0.5
                d = math.hypot(cx - p.x, cy - p.y)
                if d < 10:
                    if d < p.h["range"] * 0.9 and p.ammo >= 2 and p.cd <= 0 and self.react <= 0 \
                            and g.map.los(p.x, p.y, cx, cy, ignore=(tx, ty)):
                        g.attack(p.id, cx - p.x, cy - p.y, d)
                        self.react = 0.3 + self.rng.random() * 0.3
                    return g.map.free_near(cx - (cx - p.x) / max(d, 0.01) * 1.5, cy - (cy - p.y) / max(d, 0.01) * 1.5)
        if self.wander is None or self.wander_t <= 0 or math.hypot(self.wander[0] - p.x, self.wander[1] - p.y) < 1:
            cx, cy = g.map.center
            if g.teams:
                x = cx + (self.rng.random() * 2 - 1) * 6.0
                y = cy + (self.rng.random() * 2 - 1) * 4.2
            else:                       # in der eigenen Gegend bleiben, aber im sicheren Kreis
                x = p.x + (self.rng.random() * 2 - 1) * 6.0
                y = p.y + (self.rng.random() * 2 - 1) * 6.0
                r = max(1.0, g.storm_r - 2.5)
                d = math.hypot(x - cx, y - cy)
                if d > r:
                    x, y = cx + (x - cx) / d * r, cy + (y - cy) / d * r
            self.wander = g.map.free_near(x, y)
            self.wander_t = 4 + self.rng.random() * 4
        return self.wander


def hero_list():
    keys = ("name", "role", "color", "hp", "speed", "range", "attack", "sup", "srange", "atext", "sname", "stext",
            "radius", "sradius", "dmg", "sdmg", "count", "reload", "cd")
    return {k: {kk: v[kk] for kk in keys if kk in v} for k, v in HEROES.items()}


def mode_list():
    return {k: dict(name=v["name"], teams=v["teams"], max=v["max"], text=v["text"], map=MAPS[v["map"]]["name"],
                    goal=v.get("goal"))
            for k, v in MODES.items()}
