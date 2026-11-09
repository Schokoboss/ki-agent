"""Dino-Sprint 3D – Mehrspieler-Räume (nur Standardbibliothek).

Zwei Wege:
- im Nova-Server: POST /mp/dino (ohne Nova-Schlüssel – hier gibt es nur Spielräume, nichts vom Laptop).
  Freunde spielen über den Tunnel-Link mit, den das Spiel in der Lobby zum Teilen anbietet.
- allein fürs WLAN (ohne Nova):  python server/dino_mp.py   →  http://<Laptop-IP>:8790/dino/

Alle im Raum laufen dieselbe Strecke (gleicher Zufalls-Seed, die Strecke hängt nur von der Strecke ab, nicht
von der Zeit). Der Server reicht nur Positionen, Meteor-Angriffe und das Ergebnis weiter.
Grenzen: 40 Räume, 8 Spieler pro Raum, 8 KB pro Anfrage, Räume verfallen nach 2 min ohne Lebenszeichen.
"""

import argparse
import hmac
import json
import re
import secrets
import socket
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DINOS = ("rex", "raptor", "stego", "trike", "ankylo", "brachio", "spino", "gold")
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # ohne 0/O und 1/I
MAX_ROOMS = 40
MAX_PLAYERS = 8
MAX_BODY = 8192
COUNTDOWN = 4.0      # Sekunden zwischen „Start“ und Loslaufen
ROOM_IDLE = 120      # Raum ohne Lebenszeichen → weg
PLAYER_GONE = 25     # Spieler ohne Lebenszeichen → raus aus dem Raum
RACE_STALE = 6       # im Rennen so lange still → gilt als ausgeschieden
METEOR_GAP = 2.0     # höchstens ein Meteor alle 2 s pro Spieler
INBOX_MAX = 8
TOP_SPEED = 60       # m/s – mehr kann im Spiel niemand laufen (Turbo eingerechnet)


class MpError(Exception):
    def __init__(self, msg: str, code: int = 400):
        super().__init__(msg)
        self.code = code


def clean_name(v) -> str:
    s = re.sub(r"[\x00-\x1f\x7f<>&\"'`\\]", "", str(v or ""))
    s = re.sub(r"\s+", " ", s).strip()[:14].strip()
    return s or "Dino"


def num(v, lo: float, hi: float, default: float = 0.0) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    if f != f or f in (float("inf"), float("-inf")):
        return default
    return max(lo, min(hi, f))


class Player:
    def __init__(self, name: str, dino: str, now: float):
        self.pid = secrets.token_hex(4)
        self.key = secrets.token_hex(12)
        self.name = name
        self.dino = dino
        self.seen = now
        self.in_race = False
        self.alive = False
        self.d = 0.0
        self.lane = 0
        self.y = 0.0
        self.duck = False
        self.coins = 0
        self.died = None
        self.inbox: list[dict] = []
        self.last_meteor = 0.0

    def public(self, host: str) -> dict:
        return {"pid": self.pid, "name": self.name, "dino": self.dino, "host": self.pid == host,
                "inRace": self.in_race, "alive": self.alive, "d": round(self.d, 1), "lane": self.lane,
                "y": round(self.y, 2), "duck": self.duck, "coins": self.coins}


class Room:
    def __init__(self, code: str, now: float):
        self.code = code
        self.players: dict[str, Player] = {}  # Einfügereihenfolge = Beitrittsreihenfolge
        self.host = ""
        self.phase = "lobby"                  # lobby → race → results → race …
        self.seed = 0
        self.start_at = 0.0
        self.round = 0
        self.results: list[dict] = []
        self.seen = now


class Rooms:
    def __init__(self, clock=time.time):
        self.clock = clock
        self.lock = threading.Lock()
        self.rooms: dict[str, Room] = {}

    # ---------------------------------------------------------------- Eingang
    def handle(self, body) -> tuple[int, dict]:
        if not isinstance(body, dict):
            return 400, {"error": "Ungültige Anfrage"}
        action = body.get("a")
        try:
            with self.lock:
                now = self.clock()
                self._cleanup(now)
                if action == "ping":
                    return 200, {"ok": True, "now": now}
                if action == "create":
                    room, player = self._create(body, now)
                    return 200, {**self._view(room, player, now), "key": player.key}
                if action == "join":
                    room, player = self._join(body, now)
                    return 200, {**self._view(room, player, now), "key": player.key}
                room, player = self._auth(body)
                player.seen = room.seen = now
                if action == "sync":
                    self._sync(room, player, body, now)
                elif action == "start":
                    self._start(room, player, now)
                elif action == "leave":
                    self._remove(room, player)
                    return 200, {"ok": True}
                else:
                    raise MpError("Unbekannte Aktion")
                self._check_end(room, now)
                return 200, self._view(room, player, now)
        except MpError as e:
            return e.code, {"error": str(e)}

    # ---------------------------------------------------------------- Aktionen
    def _create(self, body: dict, now: float) -> tuple[Room, Player]:
        if len(self.rooms) >= MAX_ROOMS:
            raise MpError("Gerade sind zu viele Räume offen – gleich nochmal versuchen.", 503)
        while True:
            code = "".join(secrets.choice(CODE_CHARS) for _ in range(4))
            if code not in self.rooms:
                break
        room = Room(code, now)
        self.rooms[code] = room
        player = self._add(room, body, now)
        room.host = player.pid
        return room, player

    def _join(self, body: dict, now: float) -> tuple[Room, Player]:
        code = re.sub(r"[^A-Z0-9]", "", str(body.get("room") or "").upper())[:6]
        room = self.rooms.get(code)
        if not room:
            raise MpError("Raum nicht gefunden – stimmt der Code?", 404)
        if len(room.players) >= MAX_PLAYERS:
            raise MpError(f"Der Raum ist voll ({MAX_PLAYERS} Spieler).", 409)
        room.seen = now
        return room, self._add(room, body, now)

    def _add(self, room: Room, body: dict, now: float) -> Player:
        name = clean_name(body.get("name"))
        taken = {p.name for p in room.players.values()}
        base, n = name, 2
        while name in taken:
            name = f"{base[:11]} {n}"
            n += 1
        dino = body.get("dino") if body.get("dino") in DINOS else "rex"
        player = Player(name, dino, now)
        room.players[player.pid] = player
        return player

    def _auth(self, body: dict) -> tuple[Room, Player]:
        room = self.rooms.get(str(body.get("room") or ""))
        if not room:
            raise MpError("Raum nicht gefunden", 404)
        player = room.players.get(str(body.get("pid") or ""))
        if not player or not hmac.compare_digest(str(body.get("key") or "").encode(), player.key.encode()):
            raise MpError("Nicht (mehr) im Raum", 403)
        return room, player

    def _sync(self, room: Room, p: Player, body: dict, now: float) -> None:
        me = body.get("me") if isinstance(body.get("me"), dict) else {}
        racing = room.phase == "race" and p.in_race
        if not racing:  # Name und Dino nur zwischen den Rennen änderbar
            if "name" in me and clean_name(me["name"]) != p.name:
                taken = {q.name for q in room.players.values() if q is not p}
                if clean_name(me["name"]) not in taken:
                    p.name = clean_name(me["name"])
            if me.get("dino") in DINOS:
                p.dino = me["dino"]
        elif p.alive and now >= room.start_at - 1:
            limit = max(0.0, now - room.start_at) * TOP_SPEED + 30
            p.d = max(p.d, min(num(me.get("d"), 0, 1e7), limit))
            p.lane = int(num(me.get("lane"), -1, 1))
            p.y = num(me.get("y"), 0, 10)
            p.duck = bool(me.get("duck"))
            p.coins = int(num(me.get("coins"), 0, 1e7))
            if me.get("alive") is False:
                p.alive = False
                p.died = now
        events = body.get("ev") if isinstance(body.get("ev"), list) else []
        for ev in events[:4]:
            if isinstance(ev, dict) and ev.get("t") == "meteor":
                self._meteor(room, p, now)

    def _meteor(self, room: Room, p: Player, now: float) -> None:
        if room.phase != "race" or not (p.in_race and p.alive) or now - p.last_meteor < METEOR_GAP:
            return
        p.last_meteor = now
        others = [q for q in room.players.values() if q is not p and q.in_race and q.alive]
        ahead = [q for q in others if q.d > p.d]
        for q in ahead or others:  # trifft alle vor dir – bist du vorne, alle hinter dir
            q.inbox = (q.inbox + [{"t": "meteor", "from": p.name}])[-INBOX_MAX:]

    def _start(self, room: Room, p: Player, now: float) -> None:
        if p.pid != room.host:
            raise MpError("Nur der Host kann das Rennen starten.", 403)
        if room.phase == "race":
            raise MpError("Das Rennen läuft schon.", 409)
        for q in room.players.values():
            q.in_race, q.alive, q.d, q.lane, q.y, q.duck = True, True, 0.0, 0, 0.0, False
            q.coins, q.died, q.inbox, q.seen = 0, None, [], now
        room.seed = secrets.randbelow(2**31 - 2) + 1
        room.start_at = now + COUNTDOWN
        room.round += 1
        room.results = []
        room.phase = "race"

    def _remove(self, room: Room, p: Player) -> None:
        room.players.pop(p.pid, None)
        if room.host == p.pid:
            room.host = next(iter(room.players), "")  # der am längsten Dabei-Seiende wird Host
        if not room.players:
            self.rooms.pop(room.code, None)

    def _check_end(self, room: Room, now: float) -> None:
        if room.phase != "race" or now < room.start_at:
            return
        racers = [q for q in room.players.values() if q.in_race]
        if not racers:
            room.phase = "lobby"
            return
        if any(q.alive for q in racers):
            return
        racers.sort(key=lambda q: (-q.d, q.died or 0))
        room.results = [{"pid": q.pid, "name": q.name, "dino": q.dino, "d": round(q.d), "coins": q.coins,
                         "place": i + 1} for i, q in enumerate(racers)]
        room.phase = "results"

    def _cleanup(self, now: float) -> None:
        for room in list(self.rooms.values()):
            if now - room.seen > ROOM_IDLE:
                self.rooms.pop(room.code, None)
                continue
            for q in list(room.players.values()):
                if now - q.seen > PLAYER_GONE:
                    self._remove(room, q)
                elif room.phase == "race" and q.in_race and q.alive and now - q.seen > RACE_STALE \
                        and now > room.start_at:
                    q.alive, q.died = False, q.seen  # Verbindung weg → ausgeschieden
            if room.code in self.rooms:
                self._check_end(room, now)

    def _view(self, room: Room, p: Player, now: float) -> dict:
        inbox, p.inbox = p.inbox, []
        return {"ok": True, "now": now, "room": room.code, "you": p.pid, "phase": room.phase, "seed": room.seed,
                "startAt": room.start_at, "round": room.round, "host": room.host,
                "players": [q.public(room.host) for q in room.players.values()],
                "results": room.results, "inbox": inbox}


# -------------------------------------------------------------------- eigener kleiner Server (WLAN, ohne Nova)

APP_DIR = Path(__file__).resolve().parents[1] / "app"
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
        ".webmanifest": "application/manifest+json"}


class DinoHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    rooms = Rooms()

    def log_message(self, fmt, *args):
        pass

    def _send(self, code: int, data: bytes, ctype: str, extra: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _json(self, code: int, obj: dict) -> None:
        self._send(code, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def do_OPTIONS(self):
        self._send(204, b"", "text/plain", {"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                                            "Access-Control-Allow-Headers": "Content-Type"})

    def do_GET(self):
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        if path in ("", "/", "/dino"):
            return self._send(302, b"", "text/plain", {"Location": "/dino/"})
        target = (APP_DIR / path.lstrip("/")).resolve()
        if target.is_dir():
            target = target / "index.html"
        if APP_DIR.resolve() not in target.parents or not target.is_file():
            return self._json(404, {"error": "nicht gefunden"})
        self._send(200, target.read_bytes(), MIME.get(target.suffix.lower(), "application/octet-stream"))

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != "/mp/dino":
            return self._json(404, {"error": "nicht gefunden"})
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            return self._json(413, {"error": "zu groß"})
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            return self._json(400, {"error": "Ungültige Anfrage"})
        self._json(*self.rooms.handle(body))


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # schickt nichts, sucht nur die WLAN-Adresse aus
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Dino-Sprint 3D – Mehrspieler-Server fürs WLAN")
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--host", default="0.0.0.0", help="127.0.0.1 = nur dieser Rechner")
    args = ap.parse_args()
    httpd = ThreadingHTTPServer((args.host, args.port), DinoHandler)
    httpd.daemon_threads = True
    print("=" * 58)
    print("  Dino-Sprint 3D – Mehrspieler-Server")
    print(f"  Hier:         http://localhost:{args.port}/dino/")
    if args.host == "0.0.0.0":
        print(f"  Im WLAN:      http://{lan_ip()}:{args.port}/dino/")
    print("  Fenster schließen = Server aus")
    print("=" * 58, flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
