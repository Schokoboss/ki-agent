"""Tumult Arena: Spiellogik (Bot-Partien in allen Modi) und echter Netzwerk-Test mit zwei WebSocket-Spielern.
    python werkzeuge/tests/test_tumult.py
Nur Standardbibliothek. Startet einen eigenen Server auf einem freien Port und räumt ihn wieder ab.
"""
import base64
import json
import math
import os
import socket
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
SPIEL = Path(__file__).resolve().parents[2] / "spiele" / "tumult-arena"
sys.path.insert(0, str(SPIEL))
import spiel  # noqa: E402

fehler = []


def check(ok, text):
    print(("OK     " if ok else "FEHLER ") + text, flush=True)
    if not ok:
        fehler.append(text)


# ---------------------------------------------------------------- Logik

for key in spiel.MAPS:
    m = spiel.Map(key)
    rows = m.rows()
    if spiel.MAPS[key]["sym"] == "rot":
        sym = all(rows[y][x] == rows[m.h - 1 - y][m.w - 1 - x] for y in range(m.h) for x in range(m.w))
        check(sym and len(m.spawns[0]) >= 3 and len(m.spawns[1]) >= 3, f"Karte {m.name}: drehsymmetrisch, je Team ≥3 Startplätze")
    else:
        check(len(m.spawns["ffa"]) >= spiel.MODES["letzter"]["max"], f"Karte {m.name}: genug Startplätze ({len(m.spawns['ffa'])})")

m = spiel.Map("schlucht")
x, y = 1.5, 9.5
for _ in range(200):
    x, y = spiel.move(m, x, y, -0.1, 0)
check(abs(x - (spiel.R + spiel.EPS)) < 1e-6, f"Bewegung stoppt am Kartenrand (x={x:.6f})")
wx, wy = next((x, y) for y in range(m.h) for x in range(m.w) if m.tiles[y][x] == "#" and not m.solid(x - 1, y))
x, y = wx - 1 + 0.5, wy + 0.5
for _ in range(50):
    x, y = spiel.move(m, x, y, 0.1, 0)
check(x + spiel.R <= wx, f"Bewegung stoppt vor der Wand bei x={wx}")

heroes = list(spiel.HEROES)
for mode, mdef in spiel.MODES.items():
    durations, winners = [], set()
    for seed in range(4):
        ents = [dict(id=i + 1, name=f"Bot{i}", hero=heroes[(i // 2 + seed) % 6], team=(i + seed) % 2, bot=True)
                for i in range(mdef["max"])]
        g = spiel.Game(mode, ents, seed=seed)
        n = 0
        while not g.over and n < (mdef["time"] + 5) * spiel.TICK:
            g.step()
            g.prepare()
            json.loads(g.snapshot(1))
            g.events.clear()
            n += 1
        check(g.over and g.result is not None, f"{mdef['name']} (Seed {seed}): Partie endet ({g.t:.0f} s, {g.result and g.result['reason']})")
        durations.append(g.t)
        winners.add(g.result and g.result["winner"])
    check(min(durations) > 20, f"{mdef['name']}: Partien dauern nicht zu kurz (min {min(durations):.0f} s)")

# ---------------------------------------------------------------- Netzwerk


class WS:
    def __init__(self, port):
        self.s = socket.create_connection(("127.0.0.1", port), timeout=5)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET /ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            head += self.s.recv(1)
        assert b" 101 " in head.split(b"\r\n")[0], head
        self.buf = b""
        self.last = {}

    def send(self, **msg):
        data = json.dumps(msg).encode()
        mask = os.urandom(4)
        n = len(data)
        head = struct.pack("!BB", 0x81, 0x80 | n) if n < 126 else struct.pack("!BBH", 0x81, 0x80 | 126, n)
        self.s.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.s.recv(65536)
            if not chunk:
                raise ConnectionError("zu")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv(self):
        b1, b2 = self._read(2)
        n = b2 & 0x7F
        if n == 126:
            n = struct.unpack("!H", self._read(2))[0]
        elif n == 127:
            n = struct.unpack("!Q", self._read(8))[0]
        msg = json.loads(self._read(n))
        self.last[msg["t"]] = msg
        return msg

    def until(self, pred, timeout=6.0):
        end = time.time() + timeout
        while time.time() < end:
            m = self.recv()
            if pred(m):
                return m
        raise TimeoutError("Nachricht kam nicht")

    def close(self):
        self.s.close()


with socket.socket() as tmp:
    tmp.bind(("127.0.0.1", 0))
    port = tmp.getsockname()[1]
srv = subprocess.Popen([sys.executable, str(SPIEL / "server.py"), "--port", str(port), "--host", "127.0.0.1", "--no-browser"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env={**os.environ, "PYTHONIOENCODING": "utf-8"})
try:
    for _ in range(50):
        try:
            html = urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1).read().decode()
            break
        except OSError:
            time.sleep(0.2)
    check("Tumult Arena" in html, "Startseite wird ausgeliefert")
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/%2e%2e/server.py", timeout=2)
        check(False, "Dateien außerhalb von web/ gesperrt")
    except urllib.error.HTTPError as e:
        check(e.code == 404, "Dateien außerhalb von web/ gesperrt")

    a, b = WS(port), WS(port)
    a.send(t="hello", name="Anna", hero="bolzen", token="tok-a")
    wa = a.until(lambda m: m["t"] == "welcome")
    check(len(wa["heroes"]) == 6 and len(wa["modes"]) == 3, "Willkommen mit 6 Helden und 3 Modi")
    b.send(t="hello", name="Ben", hero="klinge", token="tok-b")
    wb = b.until(lambda m: m["t"] == "welcome")
    a.send(t="create", mode="teamkampf", hero="bolzen")
    room = a.until(lambda m: m["t"] == "room")["room"]
    b.send(t="join", code=room["code"], hero="klinge")
    room = b.until(lambda m: m["t"] == "room" and len(m["room"]["members"]) == 2)["room"]
    teams = {m["name"]: m["team"] for m in room["members"]}
    check(teams["Anna"] != teams["Ben"], f"Privater Raum {room['code']}: beide drin, verschiedene Teams")
    a.send(t="start")
    sa = a.until(lambda m: m["t"] == "start")
    sb = b.until(lambda m: m["t"] == "start")
    check(len(sa["roster"]) == 6 and sum(p["bot"] for p in sa["roster"]) == 4, "Start: 2 Menschen + 4 Bots")
    snap = a.until(lambda m: m["t"] == "s")
    me = next(p for p in snap["p"] if p[0] == wa["id"])
    x0 = me[1]
    for seq in range(1, 31):
        a.send(t="i", s=seq, m=[1, 0])
        time.sleep(1 / 30)
    snap = a.until(lambda m: m["t"] == "s" and m["a"] >= 25)
    me = next(p for p in snap["p"] if p[0] == wa["id"])
    check(me[1] > x0 + 1.5, f"Eingaben bewegen die Figur ({x0:.2f} → {me[1]:.2f}), Bestätigung bis Eingabe {snap['a']}")
    a.send(t="a", k="atk", x=1, y=0, d=5)
    snap = a.until(lambda m: m["t"] == "s" and any(e[0] == "shot" and e[1] == wa["id"] for e in m.get("e", [])))
    check(True, "Angriff kommt als Schuss-Ereignis zurück")
    bsnap = b.until(lambda m: m["t"] == "s")
    check(any(p[0] == wb["id"] for p in bsnap["p"]), "Zweiter Spieler bekommt laufende Zustände mit eigener Figur")

    b.close()                                  # Ben fliegt raus → Bot übernimmt
    roster = a.until(lambda m: m["t"] == "roster")["players"]
    ben = next(p for p in roster if p["id"] == wb["id"])
    check(ben["bot"], "Verbindungsabbruch: Bot übernimmt Bens Figur")
    b2 = WS(port)
    b2.send(t="hello", name="Ben", hero="klinge", token="tok-b")
    st = b2.until(lambda m: m["t"] == "start", timeout=4)
    check(st["you"] == wb["id"], "Wiederverbinden: Ben steuert wieder seine alte Figur")

    c = WS(port)
    c.send(t="hello", name="Cleo", hero="mira", token="tok-c")
    c.until(lambda m: m["t"] == "welcome")
    c.send(t="join", code=room["code"], hero="mira")
    st = c.until(lambda m: m["t"] == "start", timeout=4)
    check(st["you"] is not None and any(p["id"] == st["you"] and not p["bot"] and p["hero"] == "mira" for p in st["roster"]),
          "Einsteigen in laufende Partie: übernimmt einen Bot")
    for w in (a, b2, c):
        w.close()
finally:
    srv.terminate()
    srv.wait(5)

print("\n" + ("Alles OK" if not fehler else f"{len(fehler)} FEHLER"))
sys.exit(1 if fehler else 0)
