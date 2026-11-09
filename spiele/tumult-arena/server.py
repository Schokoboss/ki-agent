#!/usr/bin/env python3
"""Tumult-Arena – Server: Webseite, WebSocket, Räume und Spielschleife. Nur Python-Standardbibliothek.

    python spiele/tumult-arena/server.py               → http://localhost:8790, im WLAN über die Laptop-IP
    python spiele/tumult-arena/server.py --internet    → zusätzlich ein Internet-Link (cloudflared-Gratis-Tunnel)
    Weitere Optionen: --port 8790  --no-browser
"""
import argparse
import asyncio
import base64
import hashlib
import json
import os
import random
import re
import shutil
import socket
import struct
import subprocess
import sys
import time
import traceback
import urllib.parse
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEB = HERE / "web"
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import spiel  # noqa: E402

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_MSG = 8192
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"
NAME_RE = re.compile(r"[^\w äöüÄÖÜß.\-!?]")
INFO = {"lan": [], "internet": "", "port": 0}
ROOMS: dict = {}
TOKENS: dict = {}       # Wiederverbinden: token → (Raumcode, Spieler-ID, Zeitpunkt)
_ids = [1000]


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def new_id():
    _ids[0] += 1
    return _ids[0]


# ---------------------------------------------------------------- WebSocket (RFC 6455)


def ws_frame(payload: bytes, opcode=1) -> bytes:
    n = len(payload)
    if n < 126:
        head = struct.pack("!BB", 0x80 | opcode, n)
    elif n < 65536:
        head = struct.pack("!BBH", 0x80 | opcode, 126, n)
    else:
        head = struct.pack("!BBQ", 0x80 | opcode, 127, n)
    return head + payload


def unmask(data: bytes, mask: bytes) -> bytes:
    n = len(data)
    if not n:
        return data
    m = (mask * (n // 4 + 1))[:n]
    return (int.from_bytes(data, "big") ^ int.from_bytes(m, "big")).to_bytes(n, "big")


async def ws_read(reader):
    """Liest eine vollständige Nachricht → (opcode, bytes). Fragmente werden zusammengesetzt."""
    parts, first_op = [], None
    while True:
        b1, b2 = await reader.readexactly(2)
        fin, op = b1 & 0x80, b1 & 0x0F
        n = b2 & 0x7F
        if n == 126:
            n = struct.unpack("!H", await reader.readexactly(2))[0]
        elif n == 127:
            n = struct.unpack("!Q", await reader.readexactly(8))[0]
        if n > MAX_MSG:
            raise ConnectionError("Nachricht zu groß")
        mask = await reader.readexactly(4) if b2 & 0x80 else b""
        data = await reader.readexactly(n)
        if mask:
            data = unmask(data, mask)
        if op >= 8:                      # Steuerrahmen dürfen zwischen Fragmenten kommen
            return op, data
        if first_op is None:
            first_op = op
        parts.append(data)
        if sum(map(len, parts)) > MAX_MSG:
            raise ConnectionError("Nachricht zu groß")
        if fin:
            return first_op, b"".join(parts)


class Client:
    def __init__(self, writer):
        self.id = new_id()
        self.writer = writer
        self.name = "Spieler"
        self.hero = "funke"
        self.token = None
        self.room = None
        self.team = 0
        self.pid = None          # Spielfigur in der laufenden Partie (kann ein übernommener Bot sein)
        self.closed = False

    def send_raw(self, text: str, droppable=False):
        if self.closed:
            return
        tr = self.writer.transport
        if tr is None or tr.is_closing():
            self.closed = True
            return
        if droppable and tr.get_write_buffer_size() > 400_000:
            return                   # Leitung verstopft: diesen Zustand auslassen, der nächste kommt gleich
        self.writer.write(ws_frame(text.encode("utf-8")))

    def send(self, **msg):
        self.send_raw(json.dumps(msg, separators=(",", ":"), ensure_ascii=False))


# ---------------------------------------------------------------- Räume


def new_code():
    while True:
        code = "".join(random.choice(CODE_CHARS) for _ in range(4))
        if code not in ROOMS:
            return code


BOT_ID = [1]


class Room:
    def __init__(self, mode, public):
        self.code = new_code()
        self.mode = mode
        self.public = public
        self.members: list[Client] = []
        self.host = None
        self.bots = True
        self.state = "lobby"
        self.auto = 6.0 if public else None
        self.game = None
        ROOMS[self.code] = self
        log(f"Raum {self.code} ({spiel.MODES[mode]['name']}, {'öffentlich' if public else 'privat'}) erstellt")

    # ------------------------------------------------ Info

    @property
    def max(self):
        return spiel.MODES[self.mode]["max"]

    def info(self):
        return dict(code=self.code, mode=self.mode, public=self.public, host=self.host.id if self.host else None,
                    state=self.state, bots=self.bots, max=self.max,
                    auto=round(self.auto, 1) if self.auto is not None else None,
                    members=[dict(id=c.id, name=c.name, hero=c.hero, team=c.team) for c in self.members])

    def broadcast(self, **msg):
        text = json.dumps(msg, separators=(",", ":"), ensure_ascii=False)
        for c in self.members:
            c.send_raw(text)

    def update(self):
        self.broadcast(t="room", room=self.info())

    def can_join(self):
        if self.state == "lobby":
            return len(self.members) < self.max
        g = self.game
        return (g is not None and not g.over and g.t < g.mode["time"] - 30
                and any(p.bot for p in g.players.values()) and (g.teams or g.t < 15))

    def team_counts(self):
        n = [0, 0]
        for c in self.members:
            n[c.team] += 1
        return n

    # ------------------------------------------------ Beitreten / Verlassen

    def add(self, c, resume_pid=None):
        if c.room:
            c.room.remove(c)
        c.room = self
        n = self.team_counts()
        c.team = 0 if n[0] <= n[1] else 1
        self.members.append(c)
        if self.host is None:
            self.host = c
        if self.public and self.state == "lobby" and self.auto is not None:
            self.auto = max(self.auto, 4.0)
        log(f"{c.name} → Raum {self.code}")
        if self.state == "game":
            self.join_running(c, resume_pid)
        self.update()

    def join_running(self, c, resume_pid=None):
        g = self.game
        p = g.players.get(resume_pid) if resume_pid else None
        if not (p and p.bot):
            p = None
            bots = [q for q in g.players.values() if q.bot and (q.alive or g.teams)]
            if g.teams and bots:
                humans = [0, 0]
                for q in g.players.values():
                    if not q.bot:
                        humans[q.team] += 1
                want = 0 if humans[0] <= humans[1] else 1
                bots.sort(key=lambda q: (q.team != want, not q.alive))
            if bots:
                p = bots[0]
        if p:
            name = c.name if p.id != resume_pid else p.name.removesuffix(" (Bot)")
            g.to_human(p.id, name, c.hero if p.id != resume_pid else p.hero, c.token)
            c.pid, c.team = p.id, p.team if g.teams else 0
            if p.id == resume_pid:
                c.hero = p.hero
        else:
            c.pid = None             # zuschauen bis zur nächsten Runde
        c.send(t="start", **self.start_msg(c))
        self.broadcast(t="roster", players=g.roster())

    def remove(self, c, disconnected=False):
        if c not in self.members:
            return
        self.members.remove(c)
        c.room = None
        g = self.game
        if self.state == "game" and g and c.pid in g.players:
            p = g.players[c.pid]
            g.to_bot(c.pid)
            if disconnected and c.token:
                TOKENS[c.token] = (self.code, c.pid, time.time())
            if not p.name.endswith(" (Bot)"):
                p.name += " (Bot)"
            self.broadcast(t="roster", players=g.roster())
        c.pid = None
        log(f"{c.name} ← Raum {self.code}")
        if not self.members:
            ROOMS.pop(self.code, None)
            log(f"Raum {self.code} geschlossen")
            return
        if self.host is c:
            self.host = self.members[0]
        self.update()

    # ------------------------------------------------ Einstellungen

    def configure(self, c, msg):
        if "hero" in msg and msg["hero"] in spiel.HEROES:
            c.hero = msg["hero"]
        if self.state != "lobby":
            self.update()
            return
        teams = spiel.MODES[self.mode]["teams"]
        if msg.get("team") == "swap" and teams:
            other = 1 - c.team
            if self.team_counts()[other] < self.max // 2:
                c.team = other
        if c is self.host and not self.public:
            if msg.get("mode") in spiel.MODES and msg["mode"] != self.mode:
                self.mode = msg["mode"]
                for i, m in enumerate(self.members):
                    m.team = i % 2
                while len(self.members) > self.max:
                    extra = self.members[-1]
                    self.remove(extra)
                    extra.send(t="err", msg="Der Raum ist für diesen Modus zu voll.")
                    extra.send(t="left")
            if "bots" in msg:
                self.bots = bool(msg["bots"])
        self.update()

    # ------------------------------------------------ Partie

    def start(self):
        m = spiel.MODES[self.mode]
        players = self.members[: self.max]
        entrants = []
        if m["teams"]:
            per = m["max"] // 2
            for t in (0, 1):
                mine = [c for c in players if c.team == t]
                for c in mine[per:]:
                    c.team = 1 - t
        for c in players:
            entrants.append(dict(id=c.id, name=c.name, hero=c.hero, team=c.team if m["teams"] else 0, bot=False,
                                 token=c.token))
            c.pid = c.id
        for c in self.members[self.max:]:
            c.pid = None
        names = random.sample(spiel.BOT_NAMES, len(spiel.BOT_NAMES))

        def bot(team):
            used = [e["hero"] for e in entrants if e["team"] == team or not m["teams"]]
            free = [h for h in spiel.HEROES if h not in used] or list(spiel.HEROES)
            BOT_ID[0] += 1
            entrants.append(dict(id=BOT_ID[0], name=names.pop(), hero=random.choice(free), team=team, bot=True))
        if m["teams"]:
            per = m["max"] // 2
            for t in (0, 1):
                have = sum(1 for e in entrants if e["team"] == t)
                need = per - have if self.bots else (1 if have == 0 else 0)
                for _ in range(need):
                    bot(t)
        else:
            need = m["max"] - len(entrants) if self.bots else max(0, 2 - len(entrants))
            for _ in range(need):
                bot(0)
        self.game = spiel.Game(self.mode, entrants)
        self.state = "game"
        self.auto = None
        for c in self.members:
            c.send(t="start", **self.start_msg(c))
        self.update()
        log(f"Raum {self.code}: Partie startet ({len(players)} Menschen, {len(entrants) - len(players)} Bots)")

    def start_msg(self, c):
        g = self.game
        return dict(mode=self.mode, map=dict(key=g.map.key, name=g.map.name, w=g.map.w, h=g.map.h, rows=g.map.rows()),
                    roster=g.roster(), you=c.pid, time=g.mode["time"], dt=spiel.DT, R=spiel.R,
                    t0=round(g.t, 2), tick=g.tick)

    def tick(self):
        if self.state == "lobby":
            if self.auto is not None:
                self.auto -= spiel.DT
                if self.auto <= 0:
                    self.start()
            return
        g = self.game
        g.step()
        g.prepare()
        for c in self.members:
            c.send_raw(g.snapshot(c.pid), droppable=True)
        g.events.clear()
        if g.over:
            self.broadcast(t="end", result=g.result)
            self.state = "lobby"
            self.auto = 20.0 if self.public else None
            for c in self.members:
                c.pid = None
            self.update()
            log(f"Raum {self.code}: Partie vorbei ({g.result['reason']})")


# ---------------------------------------------------------------- Nachrichten


def clean_name(s):
    s = NAME_RE.sub("", str(s or "")).strip()[:16]
    return s or "Spieler"


def handle(c: Client, msg: dict):
    t = msg.get("t")
    room = c.room
    g = room.game if room and room.state == "game" else None
    if t == "i":
        if g and c.pid is not None:
            m = msg.get("m") or (0, 0)
            g.queue_input(c.pid, msg.get("s", 0), m[0], m[1])
    elif t == "a":
        if g and c.pid is not None:
            g.attack(c.pid, msg.get("x", 0), msg.get("y", 0), msg.get("d", 0), sup=msg.get("k") == "sup")
    elif t == "ping":
        c.send(t="pong", c=msg.get("c"))
    elif t == "emo":
        if g and c.pid is not None:
            g.emote(c.pid, msg.get("n", 0))
    elif t == "hello":
        c.name = clean_name(msg.get("name"))
        if msg.get("hero") in spiel.HEROES:
            c.hero = msg["hero"]
        tok = str(msg.get("token") or "")[:40]
        c.token = tok or None
        c.send(t="welcome", id=c.id, heroes=spiel.hero_list(), modes=spiel.mode_list(), info=INFO)
        old = TOKENS.pop(tok, None) if tok else None
        if old and time.time() - old[2] < 180 and old[0] in ROOMS:
            r = ROOMS[old[0]]
            if r.state == "game" and r.game.players.get(old[1]) and r.game.players[old[1]].bot:
                r.add(c, resume_pid=old[1])
    elif t == "name":
        c.name = clean_name(msg.get("name"))
        if room:
            room.update()
    elif t == "quick":
        mode = msg.get("mode") if msg.get("mode") in spiel.MODES else "teamkampf"
        if msg.get("hero") in spiel.HEROES:
            c.hero = msg["hero"]
        for r in ROOMS.values():
            if r.public and r.mode == mode and r is not room and r.can_join():
                r.add(c)
                return
        Room(mode, public=True).add(c)
    elif t == "create":
        mode = msg.get("mode") if msg.get("mode") in spiel.MODES else "teamkampf"
        if msg.get("hero") in spiel.HEROES:
            c.hero = msg["hero"]
        Room(mode, public=False).add(c)
    elif t == "join":
        code = str(msg.get("code") or "").strip().upper()
        if msg.get("hero") in spiel.HEROES:
            c.hero = msg["hero"]
        r = ROOMS.get(code)
        if not r:
            c.send(t="err", msg=f"Raum „{code}“ gibt es nicht (mehr).")
        elif r is room:
            r.update()
        elif not r.can_join():
            c.send(t="err", msg="Der Raum ist voll – versuch es nach der Runde nochmal.")
        else:
            r.add(c)
    elif t == "leave":
        if room:
            room.remove(c)
        c.send(t="left")
    elif t == "set":
        if room:
            room.configure(c, msg)
        elif msg.get("hero") in spiel.HEROES:
            c.hero = msg["hero"]
    elif t == "start":
        if room and room.state == "lobby" and c is room.host:
            room.start()


# ---------------------------------------------------------------- HTTP + Verbindungen

TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
         ".json": "application/json", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon"}


def http_response(status, body: bytes, ctype="text/plain; charset=utf-8", extra=""):
    return (f"HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {len(body)}\r\n"
            f"Cache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n{extra}\r\n"
            ).encode() + body


def serve_file(path):
    path = urllib.parse.unquote(path.split("?", 1)[0])
    if path.endswith("/info"):
        return http_response("200 OK", json.dumps(INFO).encode(), "application/json")
    if path == "/":
        path = "/index.html"
    f = (WEB / path.lstrip("/")).resolve()
    if WEB not in f.parents or not f.is_file():
        # hinter einem Proxy mit Unterpfad (z. B. Vorschau): nur den Dateinamen in web/ suchen
        name = path.rstrip("/").rsplit("/", 1)[-1] or "index.html"
        f = (WEB / name).resolve()
        if path.endswith("/"):
            f = WEB / "index.html"
        if WEB not in f.parents or not f.is_file():
            return http_response("404 Not Found", b"Nicht gefunden")
    return http_response("200 OK", f.read_bytes(), TYPES.get(f.suffix, "application/octet-stream"))


async def on_connect(reader, writer):
    try:
        head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 15)
    except (asyncio.TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError, ConnectionError):
        writer.close()
        return
    lines = head.decode("latin-1").split("\r\n")
    parts = lines[0].split(" ")
    if len(parts) < 2:
        writer.close()
        return
    method, path = parts[0], parts[1]
    headers = {}
    for ln in lines[1:]:
        if ":" in ln:
            k, v = ln.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    if path.split("?")[0].endswith("/ws") and "websocket" in headers.get("upgrade", "").lower():
        key = headers.get("sec-websocket-key", "")
        accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                      f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())
        sock = writer.get_extra_info("socket")
        if sock is not None:
            try:
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            except OSError:
                pass
        await ws_session(reader, writer)
        return
    if method not in ("GET", "HEAD"):
        writer.write(http_response("405 Method Not Allowed", b""))
    else:
        resp = serve_file(path)
        writer.write(resp if method == "GET" else resp.split(b"\r\n\r\n", 1)[0] + b"\r\n\r\n")
    try:
        await writer.drain()
    except ConnectionError:
        pass
    writer.close()


async def ws_session(reader, writer):
    c = Client(writer)
    try:
        while True:
            op, data = await asyncio.wait_for(ws_read(reader), 30)
            if op == 8:
                writer.write(ws_frame(data[:2], 8))
                break
            if op == 9:
                writer.write(ws_frame(data, 10))
                continue
            if op != 1:
                continue
            try:
                msg = json.loads(data.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                continue
            if isinstance(msg, dict):
                try:
                    handle(c, msg)
                except Exception:
                    log("Fehler bei Nachricht: " + traceback.format_exc(limit=3))
    except (asyncio.IncompleteReadError, asyncio.TimeoutError, ConnectionError, OSError):
        pass
    finally:
        c.closed = True
        if c.room:
            c.room.remove(c, disconnected=True)
        try:
            writer.close()
        except Exception:
            pass


async def game_loop():
    nxt = time.perf_counter()
    while True:
        nxt += spiel.DT
        for r in list(ROOMS.values()):
            try:
                r.tick()
            except Exception:
                log(f"Fehler in Raum {r.code}: " + traceback.format_exc(limit=5))
                r.state, r.game = "lobby", None
                r.update()
        now = time.time()
        for tok, (_, _, ts) in list(TOKENS.items()):
            if now - ts > 180:
                TOKENS.pop(tok, None)
        delay = nxt - time.perf_counter()
        if delay < -0.25:
            nxt = time.perf_counter()
        await asyncio.sleep(max(0.0, delay))


# ---------------------------------------------------------------- Adressen, Tunnel, Start


def lan_addresses():
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except OSError:
        pass
    return [ip for ip in ips if not ip.startswith("127.")]


def kill_children_on_exit():
    """Windows: Prozess an ein Job-Objekt hängen – schließt sich das Fenster, stirbt auch cloudflared."""
    if os.name != "nt":
        return
    import ctypes
    from ctypes import wintypes

    class BASIC(ctypes.Structure):
        _fields_ = [("a", ctypes.c_int64), ("b", ctypes.c_int64), ("LimitFlags", wintypes.DWORD),
                    ("c", ctypes.c_size_t), ("d", ctypes.c_size_t), ("e", wintypes.DWORD),
                    ("f", ctypes.c_size_t), ("g", wintypes.DWORD), ("h", wintypes.DWORD)]

    class EXTENDED(ctypes.Structure):
        _fields_ = [("Basic", BASIC), ("io", ctypes.c_ulonglong * 6)] + [
            (n, ctypes.c_size_t) for n in ("i", "j", "k", "l")]
    try:
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateJobObjectW.restype = wintypes.HANDLE
        k32.GetCurrentProcess.restype = wintypes.HANDLE
        k32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        job = k32.CreateJobObjectW(None, None)
        info = EXTENDED()
        info.Basic.LimitFlags = 0x2000 | 0x800
        k32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info))
        k32.AssignProcessToJobObject(job, k32.GetCurrentProcess())
        kill_children_on_exit.job = job
        ctypes.WinDLL("winmm").timeBeginPeriod(1)     # genauere Timer → gleichmäßigere 30 Takte/s
    except (OSError, AttributeError, ctypes.ArgumentError):
        pass


async def tunnel(port):
    exe = ROOT / "engine" / "cloudflared.exe"
    exe = str(exe) if exe.exists() else shutil.which("cloudflared")
    if not exe:
        log("Internet-Link: cloudflared nicht gefunden (engine\\cloudflared.exe) – nur WLAN.")
        return
    flags = {"creationflags": 0x08000000} if os.name == "nt" else {}
    while True:
        log("Internet-Link wird geholt …")
        proc = await asyncio.create_subprocess_exec(
            exe, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{port}",
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, **flags)
        url_re = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
        try:
            async for raw in proc.stderr:
                m = url_re.search(raw.decode("utf-8", "replace"))
                if m and INFO["internet"] != m.group(0):
                    INFO["internet"] = m.group(0)
                    log(f"Internet-Link: {INFO['internet']}  (für Freunde außerhalb deines WLANs)")
            await proc.wait()
        finally:
            if proc.returncode is None:
                proc.terminate()
        INFO["internet"] = ""
        log("Internet-Link getrennt – neuer Versuch in 10 s")
        await asyncio.sleep(10)


async def main(args):
    kill_children_on_exit()
    server = await asyncio.start_server(on_connect, args.host, args.port, limit=65536)
    port = server.sockets[0].getsockname()[1]
    INFO["port"] = port
    INFO["lan"] = [f"http://{ip}:{port}" for ip in lan_addresses()]
    print()
    print("  ⚔  TUMULT ARENA läuft")
    print(f"     Hier am Laptop:   http://localhost:{port}")
    for u in INFO["lan"]:
        print(f"     Im gleichen WLAN: {u}")
    print("     Fenster offen lassen – Fenster zu = Server aus.")
    print()
    tasks = [asyncio.create_task(game_loop())]
    if args.internet:
        tasks.append(asyncio.create_task(tunnel(port)))
    if not args.no_browser:
        webbrowser.open(f"http://localhost:{port}/")
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="Tumult-Arena-Server")
    ap.add_argument("--port", type=int, default=int(os.environ.get("TUMULT_PORT", 8790)))
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--internet", action="store_true", help="Internet-Link über cloudflared holen")
    ap.add_argument("--no-browser", action="store_true", help="keinen Browser öffnen")
    try:
        asyncio.run(main(ap.parse_args()))
    except KeyboardInterrupt:
        print("Server beendet.")
