"""Dino-Sprint 3D: Mehrspieler-Räume (server/dino_mp.py) – ohne Browser, mit künstlicher Uhr.

    python werkzeuge/tests/test_dino.py
"""
import json
import sys
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "server"))
import dino_mp

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
fails = 0


def check(name, cond, extra=""):
    global fails
    print(("OK    " if cond else "FEHLER") + f" {name}" + (f" – {extra}" if extra else ""))
    fails += 0 if cond else 1


class Uhr:
    t = 1000.0

    def __call__(self):
        return self.t


uhr = Uhr()
R = dino_mp.Rooms(clock=uhr)


def req(**body):
    return R.handle(body)


def auth(j):
    return {"room": j["room"], "pid": j["you"], "key": j["key"]}


# ---------------------------------------------------------------- Raum, Beitritt, Namen
code, a = req(a="create", name="  Anna\x00<script>  ", dino="trike")
check("Raum erstellen", code == 200 and len(a["room"]) == 4 and a["players"][0]["host"], str(a)[:120])
check("Name bereinigt", a["players"][0]["name"] == "Annascript", a["players"][0]["name"])
check("Code ohne 0/O/1/I", all(c in dino_mp.CODE_CHARS for c in a["room"]))
A = auth(a)
code, b = req(a="join", room=a["room"].lower(), name="Annascript", dino="gibtsnicht")
check("Beitreten (Code klein geschrieben)", code == 200 and len(b["players"]) == 2)
check("doppelter Name wird nummeriert", b["players"][1]["name"] == "Annascript 2", b["players"][1]["name"])
check("unbekannter Dino → Rex", b["players"][1]["dino"] == "rex")
B = auth(b)
check("falscher Code", req(a="join", room="ZZZZ", name="X")[0] == 404)
check("falscher Schlüssel", req(a="sync", room=A["room"], pid=A["pid"], key="falsch")[0] == 403)
check("unbekannte Aktion", req(a="kaputt", **A)[0] == 400)
check("kein Objekt", R.handle(["a"])[0] == 400)
check("Nicht-Host darf nicht starten", req(a="start", **B)[0] == 403)
code, j = req(a="sync", **B, me={"name": "Ben", "dino": "raptor"})
check("Name/Dino in der Lobby änderbar", [p["name"] for p in j["players"]] == ["Annascript", "Ben"] and j["players"][1]["dino"] == "raptor")

# ---------------------------------------------------------------- Rennen
code, j = req(a="start", **A)
check("Start", code == 200 and j["phase"] == "race" and j["seed"] > 0 and j["startAt"] == uhr.t + dino_mp.COUNTDOWN, str(j)[:120])
seed = j["seed"]
check("doppelt starten geht nicht", req(a="start", **A)[0] == 409)
code, j = req(a="sync", **B, me={"name": "Hacker", "dino": "gold"})
check("im Rennen kein Namens-/Dinowechsel", j["players"][1]["name"] == "Ben" and j["players"][1]["dino"] == "raptor")
uhr.t += dino_mp.COUNTDOWN + 2
code, j = req(a="sync", **A, me={"d": 50, "lane": 1, "y": 1.2, "duck": False, "alive": True, "coins": 4})
check("Position übernommen", j["players"][0]["d"] == 50 and j["players"][0]["lane"] == 1)
code, j = req(a="sync", **B, me={"d": 1e9, "lane": 9, "y": "x", "alive": True})
p = j["players"][1]
check("Schummel-Strecke begrenzt", p["d"] <= 2 * dino_mp.TOP_SPEED + 30, p["d"])
check("Spur/Höhe begrenzt", p["lane"] == 1 and p["y"] == 0)
req(a="sync", **B, me={"d": 30, "alive": True})
check("Strecke läuft nie rückwärts", req(a="sync", **B, me={"d": 10, "alive": True})[1]["players"][1]["d"] >= 30)
check("Seed bleibt im Rennen gleich", j["seed"] == seed)

# Meteor: B (hinten) → A (vorne); A (vorne) → B (hinten)
req(a="sync", **A, me={"d": 200, "alive": True})
req(a="sync", **B, me={"d": 100, "alive": True}, ev=[{"t": "meteor"}])
code, j = req(a="sync", **A, me={"d": 205, "alive": True})
check("Meteor trifft den Vordermann", [i["t"] for i in j["inbox"]] == ["meteor"] and j["inbox"][0]["from"] == "Ben", j["inbox"])
check("Posteingang wird geleert", req(a="sync", **A, me={"d": 206, "alive": True})[1]["inbox"] == [])
req(a="sync", **B, me={"d": 101, "alive": True}, ev=[{"t": "meteor"}])
check("Meteor-Sperre (2 s)", req(a="sync", **A, me={"d": 207, "alive": True})[1]["inbox"] == [])
uhr.t += 2.1
req(a="sync", **A, me={"d": 230, "alive": True}, ev=[{"t": "meteor"}])
check("Erster trifft die Hinteren", len(req(a="sync", **B, me={"d": 130, "alive": True})[1]["inbox"]) == 1)

# Ende: B scheidet aus, A später → Ergebnis
code, j = req(a="sync", **B, me={"d": 140, "alive": False})
check("B ausgeschieden, Rennen läuft weiter", j["phase"] == "race" and not j["players"][1]["alive"])
code, j = req(a="sync", **A, me={"d": 260, "alive": False})
check("alle draußen → Ergebnis", j["phase"] == "results" and [r["name"] for r in j["results"]] == ["Annascript", "Ben"], str(j["results"]))
check("Plätze", [r["place"] for r in j["results"]] == [1, 2])

# ---------------------------------------------------------------- Verbindung weg, Host-Wechsel, Aufräumen
code, j = req(a="start", **A)
uhr.t += dino_mp.COUNTDOWN + 1
for i in range(5):                                     # A meldet sich laufend, B nicht mehr
    code, j = req(a="sync", **A, me={"d": 20 + i * 40, "alive": True})
    uhr.t += 2
code, j = req(a="sync", **A, me={"d": 220, "alive": True})
check("stiller Spieler gilt als ausgeschieden", not j["players"][1]["alive"] and j["players"][0]["alive"] and j["phase"] == "race")
uhr.t += dino_mp.RACE_STALE + 1                        # A kurz weg (z. B. Funkloch) …
code, j = req(a="sync", **A, me={"d": 230, "alive": True})
check("…wer sich zurückmeldet, läuft weiter", j["players"][0]["alive"] and j["phase"] == "race")
code, j = req(a="sync", **A, me={"d": 130, "alive": False})
check("Ergebnis trotz stillem Spieler", j["phase"] == "results" and j["results"][0]["name"] == "Annascript")
req(a="leave", **A)
code, j = req(a="sync", **B, me={})
check("Host weg → B wird Host", code == 200 and j["host"] == B["pid"] and len(j["players"]) == 1)
check("Ausgetretene sind draußen", req(a="sync", **A)[0] == 404 or req(a="sync", **A)[0] == 403)
uhr.t += dino_mp.ROOM_IDLE + 1
req(a="ping")                                          # irgendeine andere Anfrage räumt auf
check("stiller Raum verschwindet", not R.rooms and req(a="sync", **B)[0] == 404)

# Grenzen
for i in range(dino_mp.MAX_ROOMS):
    req(a="create", name=f"S{i}")
check("Raum-Grenze", req(a="create", name="zuviel")[0] == 503)
R.rooms.clear()
code, h = req(a="create", name="Host")
for i in range(dino_mp.MAX_PLAYERS - 1):
    req(a="join", room=h["room"], name=f"P{i}")
check("Spieler-Grenze", req(a="join", room=h["room"], name="zuviel")[0] == 409)

# ---------------------------------------------------------------- eigener Server (WLAN-Modus) über HTTP
srv = ThreadingHTTPServer(("127.0.0.1", 0), dino_mp.DinoHandler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}"


def http(path, data=None):
    r = urllib.request.Request(base + path, data=data, method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(r, timeout=5) as resp:
            return resp.status, resp.read(), resp.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


st, body, hd = http("/dino/")
check("WLAN-Server liefert das Spiel", st == 200 and b"Dino-Sprint 3D" in body)
st, body, hd = http("/dino/spiel.js")
check("…mit JavaScript-Typ", st == 200 and hd.get("Content-Type", "").startswith("text/javascript"))
check("kein Ausbruch aus app/", http("/../server/dino_mp.py")[0] == 404 and http("/%2e%2e/server/dino_mp.py")[0] == 404)
st, body, _ = http("/mp/dino", json.dumps({"a": "ping"}).encode())
check("Ping über HTTP", st == 200 and json.loads(body)["ok"])
check("zu große Anfrage", http("/mp/dino", b"x" * (dino_mp.MAX_BODY + 1))[0] == 413)
check("kaputtes JSON", http("/mp/dino", b"{kaputt")[0] == 400)
srv.shutdown()

print(f"\n{'Alles OK' if not fails else f'{fails} FEHLER'} – Dino-Mehrspieler")
sys.exit(1 if fails else 0)
