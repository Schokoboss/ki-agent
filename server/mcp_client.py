"""MCP-Client (Model Context Protocol) – nur Python-Standardbibliothek.

Nova bindet MCP-Server an wie Claude Desktop. Konfiguration in data/mcp.json, gleiches Format:
    {"mcpServers": {
        "dateien": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/Daten"]},
        "firma":   {"url": "https://mcp.example.com/mcp", "headers": {"Authorization": "Bearer …"}},
        "aus":     {"command": "python", "args": ["x.py"], "enabled": false}
    }}
Lokale Server laufen als Kindprozess (stdio, eine JSON-Nachricht pro Zeile), entfernte über „Streamable HTTP“
(POST, Antwort als JSON oder Server-Sent Events). Jedes Werkzeug erscheint für die KI als mcp_<server>_<werkzeug>.
"""

import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

PROTOKOLL = "2025-06-18"
CREATE_NO_WINDOW = 0x08000000


class McpFehler(Exception):
    pass


class _Stdio:
    def __init__(self, name: str, conf: dict, logs: Path):
        cmd = str(conf.get("command") or "").strip()
        if not cmd:
            raise McpFehler("„command“ fehlt")
        pfad = shutil.which(cmd) or cmd
        argv = [pfad, *[str(a) for a in conf.get("args") or []]]
        if os.name == "nt" and pfad.lower().endswith((".cmd", ".bat")):
            argv = ["cmd", "/c", *argv]  # npx.cmd & Co. brauchen die Eingabeaufforderung
        env = {**os.environ, **{str(k): str(v) for k, v in (conf.get("env") or {}).items()}}
        logs.mkdir(parents=True, exist_ok=True)
        self.err = open(logs / f"mcp-{re.sub(r'[^A-Za-z0-9_-]', '_', name)}.log", "ab")
        try:
            self.proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.err, env=env,
                                         cwd=conf.get("cwd") or None, creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0)
        except OSError as e:
            raise McpFehler(f"Start fehlgeschlagen: {e}")
        self.lock = threading.Lock()
        self.wartend: dict[int, dict] = {}
        self.naechste = 0
        threading.Thread(target=self._lesen, daemon=True, name=f"mcp-{name}").start()

    def _senden(self, msg: dict) -> None:
        data = (json.dumps(msg, ensure_ascii=False) + "\n").encode("utf-8")
        with self.lock:
            if self.proc.poll() is not None:
                raise McpFehler("Server-Prozess ist beendet")
            self.proc.stdin.write(data)
            self.proc.stdin.flush()

    def _lesen(self) -> None:
        for zeile in self.proc.stdout:
            try:
                msg = json.loads(zeile.decode("utf-8", "replace"))
            except ValueError:
                continue  # Server schreibt Text auf stdout – ignorieren
            if "id" in msg and ("result" in msg or "error" in msg):
                slot = self.wartend.get(msg["id"])
                if slot:
                    slot["antwort"] = msg
                    slot["event"].set()
            elif "id" in msg and "method" in msg:  # Anfrage vom Server an uns (z. B. ping)
                antwort = {"jsonrpc": "2.0", "id": msg["id"]}
                if msg["method"] == "ping":
                    antwort["result"] = {}
                else:
                    antwort["error"] = {"code": -32601, "message": "Nicht unterstützt"}
                try:
                    self._senden(antwort)
                except (McpFehler, OSError):
                    pass
        for slot in list(self.wartend.values()):  # Prozess weg → alle Wartenden freigeben
            slot["event"].set()

    def anfrage(self, methode: str, params: dict | None, timeout: float) -> dict:
        with self.lock:
            self.naechste += 1
            mid = self.naechste
        slot = {"event": threading.Event(), "antwort": None}
        self.wartend[mid] = slot
        try:
            self._senden({"jsonrpc": "2.0", "id": mid, "method": methode, **({"params": params} if params is not None else {})})
            if not slot["event"].wait(timeout):
                raise McpFehler(f"Keine Antwort auf {methode} nach {timeout:.0f} s")
            if slot["antwort"] is None:
                raise McpFehler("Server-Prozess ist beendet")
            return slot["antwort"]
        except OSError as e:
            raise McpFehler(f"Verbindung abgerissen: {e}")
        finally:
            self.wartend.pop(mid, None)

    def mitteilung(self, methode: str, params: dict | None = None) -> None:
        self._senden({"jsonrpc": "2.0", "method": methode, **({"params": params} if params is not None else {})})

    def schliessen(self) -> None:
        try:
            if self.proc.poll() is None:
                self.proc.terminate()
        except OSError:
            pass
        try:
            self.err.close()
        except OSError:
            pass


class _Http:
    def __init__(self, name: str, conf: dict, logs: Path):
        self.url = str(conf.get("url") or "")
        if not re.match(r"^https?://", self.url):
            raise McpFehler("„url“ muss mit http:// oder https:// beginnen")
        self.headers = {str(k): str(v) for k, v in (conf.get("headers") or {}).items()}
        self.sitzung = None
        self.naechste = 0

    def _post(self, msg: dict, timeout: float):
        h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
             "MCP-Protocol-Version": PROTOKOLL, **self.headers}
        if self.sitzung:
            h["Mcp-Session-Id"] = self.sitzung
        req = urllib.request.Request(self.url, data=json.dumps(msg).encode("utf-8"), headers=h, method="POST")
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            raise McpFehler(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:200]}")
        except (urllib.error.URLError, OSError) as e:
            raise McpFehler(f"Nicht erreichbar: {getattr(e, 'reason', e)}")

    def anfrage(self, methode: str, params: dict | None, timeout: float) -> dict:
        self.naechste += 1
        mid = self.naechste
        r = self._post({"jsonrpc": "2.0", "id": mid, "method": methode, **({"params": params} if params is not None else {})}, timeout)
        with r:
            if r.headers.get("Mcp-Session-Id"):
                self.sitzung = r.headers["Mcp-Session-Id"]
            if "text/event-stream" in (r.headers.get("Content-Type") or ""):
                daten = []
                for roh in r:
                    zeile = roh.decode("utf-8", "replace").rstrip("\r\n")
                    if zeile.startswith("data:"):
                        daten.append(zeile[5:].strip())
                    elif not zeile and daten:
                        try:
                            msg = json.loads("\n".join(daten))
                        except ValueError:
                            msg = None
                        daten = []
                        if msg and msg.get("id") == mid:
                            return msg
                raise McpFehler("Stream endete ohne Antwort")
            return json.loads(r.read().decode("utf-8"))

    def mitteilung(self, methode: str, params: dict | None = None) -> None:
        try:
            self._post({"jsonrpc": "2.0", "method": methode, **({"params": params} if params is not None else {})}, 30).close()
        except McpFehler:
            pass

    def schliessen(self) -> None:
        pass


def _ergebnis_text(res: dict) -> str:
    teile = []
    for c in res.get("content") or []:
        art = c.get("type")
        if art == "text":
            teile.append(c.get("text", ""))
        elif art == "resource":
            r = c.get("resource") or {}
            teile.append(r.get("text") or f"[Ressource {r.get('uri', '')}]")
        elif art in ("image", "audio"):
            teile.append(f"[{art} {c.get('mimeType', '')}]")
        elif art == "resource_link":
            teile.append(f"[Link {c.get('uri', '')}]")
    if not teile and res.get("structuredContent") is not None:
        teile.append(json.dumps(res["structuredContent"], ensure_ascii=False))
    return "\n".join(teile).strip() or "(leeres Ergebnis)"


def _fn_name(server: str, tool: str) -> str:
    return ("mcp_" + re.sub(r"[^A-Za-z0-9_-]", "_", f"{server}_{tool}"))[:64]


class McpServer:
    def __init__(self, name: str, conf: dict, logs: Path, version: str):
        self.name, self.conf, self.logs, self.version = name, conf, logs, version
        self.enabled = conf.get("enabled", True) is not False
        self.art = "http" if conf.get("url") else "stdio"
        self.status, self.fehler, self.tools, self.t = ("aus" if not self.enabled else "startet"), "", [], None

    def start(self) -> None:
        if not self.enabled:
            return
        try:
            self.t = _Http(self.name, self.conf, self.logs) if self.art == "http" else _Stdio(self.name, self.conf, self.logs)
            init = self.t.anfrage("initialize", {"protocolVersion": PROTOKOLL, "capabilities": {},
                                                 "clientInfo": {"name": "Nova", "version": self.version}}, 60)
            if "error" in init:
                raise McpFehler(f"initialize: {init['error'].get('message')}")
            self.t.mitteilung("notifications/initialized")
            tools, cursor = [], None
            for _ in range(20):  # Seiten der Werkzeugliste
                r = self.t.anfrage("tools/list", {"cursor": cursor} if cursor else {}, 60)
                if "error" in r:
                    raise McpFehler(f"tools/list: {r['error'].get('message')}")
                tools += r["result"].get("tools") or []
                cursor = r["result"].get("nextCursor")
                if not cursor:
                    break
            self.tools = tools
            self.status, self.fehler = "bereit", ""
        except (McpFehler, KeyError, ValueError, OSError) as e:
            self.status, self.fehler = "fehler", str(e)[:300]
            self.stop()

    def stop(self) -> None:
        if self.t:
            self.t.schliessen()
            self.t = None

    def aufrufen(self, tool: str, args: dict, timeout: float = 180) -> tuple[bool, str]:
        if self.status != "bereit" or not self.t:
            return False, f"MCP-Server {self.name} ist nicht bereit ({self.fehler or self.status})."
        try:
            r = self.t.anfrage("tools/call", {"name": tool, "arguments": args or {}}, timeout)
        except McpFehler as e:
            return False, f"MCP-Fehler: {e}"
        if "error" in r:
            return False, f"MCP-Fehler: {r['error'].get('message')}"
        res = r.get("result") or {}
        return not res.get("isError"), _ergebnis_text(res)


class McpManager:
    def __init__(self, config_path: Path, logs: Path, log, version: str = "1"):
        self.path, self.logs, self.log, self.version = config_path, logs, log, version
        self.server: dict[str, McpServer] = {}
        self.namen: dict[str, tuple[str, str]] = {}  # fn-Name → (Server, Werkzeug)
        self.lock = threading.Lock()

    def konfig(self) -> dict:
        try:
            return json.loads(self.path.read_text(encoding="utf-8")).get("mcpServers") or {}
        except (OSError, ValueError):
            return {}

    def speichern(self, server: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"mcpServers": server}, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self.path)

    def starten(self) -> None:
        """Alle konfigurierten Server (neu) starten – im Hintergrund, Nova wartet nicht darauf."""
        def lauf():
            with self.lock:
                for s in self.server.values():
                    s.stop()
                self.server = {n: McpServer(n, c, self.logs, self.version) for n, c in self.konfig().items() if isinstance(c, dict)}
            fäden = [threading.Thread(target=s.start, daemon=True) for s in self.server.values()]
            for f in fäden:
                f.start()
            for f in fäden:
                f.join(90)
            with self.lock:
                self.namen = {_fn_name(s.name, t["name"]): (s.name, t["name"])
                              for s in self.server.values() if s.status == "bereit" for t in s.tools}
            bereit = [f"{s.name} ({len(s.tools)})" for s in self.server.values() if s.status == "bereit"]
            fehler = [f"{s.name}: {s.fehler}" for s in self.server.values() if s.status == "fehler"]
            if bereit:
                self.log(f"MCP bereit: {', '.join(bereit)}")
            for f in fehler:
                self.log(f"MCP-Fehler – {f}")
        threading.Thread(target=lauf, daemon=True, name="mcp-start").start()

    def stoppen(self) -> None:
        for s in self.server.values():
            s.stop()

    def specs(self) -> list[dict]:
        out = []
        for s in self.server.values():
            if s.status != "bereit":
                continue
            for t in s.tools:
                schema = t.get("inputSchema") if isinstance(t.get("inputSchema"), dict) else {}
                schema = {"type": "object", "properties": {}, **schema}
                out.append({"type": "function", "function": {
                    "name": _fn_name(s.name, t["name"]),
                    "description": f"[MCP {s.name}] {t.get('description') or t['name']}"[:1000],
                    "parameters": schema}})
        return out

    def server_von(self, fn: str) -> str | None:
        return (self.namen.get(fn) or (None, None))[0]

    def aufrufen(self, fn: str, args: dict) -> tuple[bool, str]:
        ziel = self.namen.get(fn)
        if not ziel:
            return False, f"Unbekanntes MCP-Werkzeug {fn}."
        return self.server[ziel[0]].aufrufen(ziel[1], args)

    def uebersicht(self) -> list[dict]:
        return [{"name": s.name, "art": s.art, "status": s.status, "fehler": s.fehler, "enabled": s.enabled,
                 "werkzeuge": [t["name"] for t in s.tools]} for s in self.server.values()]

    def kurzinfo(self) -> str:
        bereit = [f"{s.name} ({len(s.tools)} Werkzeuge)" for s in self.server.values() if s.status == "bereit"]
        return ", ".join(bereit)
