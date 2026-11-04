import json
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "server"))
import agent_server as s
import permissions
import tools

# Isoliert: eigene Temp-Ordner, nie die echten Chats, den Arbeitsordner oder die echte config.json
_tmp = Path(tempfile.mkdtemp(prefix="nova-test-"))
for _d in ("conversations", "logs", "workspace", "uploads"):
    (_tmp / _d).mkdir()
s.DATA, s.CONV_DIR, s.LOGS, s.WORKSPACE, s.UPLOADS = _tmp, _tmp / "conversations", _tmp / "logs", _tmp / "workspace", _tmp / "uploads"
s.CONFIG_PATH = _tmp / "config.json"
s.save_config = lambda c: None
import mcp_client


SCR = Path(__file__).resolve().parents[1]  # werkzeuge/ mit mcp_test_server.py
PY = sys.executable
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
fails = 0


def check(name, cond, extra=""):
    global fails
    print(("OK    " if cond else "FEHLER") + f" {name}" + (f" – {extra}" if extra else ""))
    fails += 0 if cond else 1


tmp = Path(tempfile.mkdtemp())
cfg = dict(s.DEFAULT_CONFIG)
cfg.update({"token": "test", "tunnel": False})
cfg.pop("permissions", None)
s.CFG = cfg
s.CTX = tools.ToolContext(s.WORKSPACE, _tmp / "memory.json", sys.executable)
gespeichert = []
s.RECHTE = permissions.Rechte(cfg, lambda c: gespeichert.append(dict(c.get("permissions") or {})))
s.AUDIT = permissions.Protokoll(tmp / "audit.jsonl")

# --- MCP: stdio + http
http = subprocess.Popen([PY, str(SCR / "mcp_test_server.py"), "--http", "5297"])
time.sleep(1.0)
(tmp / "mcp.json").write_text(json.dumps({"mcpServers": {
    "test": {"command": PY, "args": [str(SCR / "mcp_test_server.py")]},
    "fern": {"url": "http://127.0.0.1:5297/mcp"},
    "aus": {"command": "gibtsnicht", "enabled": False},
    "kaputt": {"command": "gibts-wirklich-nicht-123"},
}}), encoding="utf-8")
s.MCP = mcp_client.McpManager(tmp / "mcp.json", tmp, lambda m: print("   log:", m), "1.2")
s.MCP.starten()
for _ in range(60):
    if all(x["status"] != "startet" for x in s.MCP.uebersicht()) and s.MCP.namen:
        break
    time.sleep(0.25)
time.sleep(0.5)
ueb = {x["name"]: x for x in s.MCP.uebersicht()}
check("stdio-Server bereit, 3 Werkzeuge über 2 Seiten", ueb["test"]["status"] == "bereit" and len(ueb["test"]["werkzeuge"]) == 3, str(ueb["test"]))
check("HTTP-Server bereit", ueb["fern"]["status"] == "bereit" and len(ueb["fern"]["werkzeuge"]) == 3, str(ueb["fern"]))
check("abgeschalteter Server bleibt aus", ueb["aus"]["status"] == "aus")
check("kaputter Server: Fehler statt Absturz", ueb["kaputt"]["status"] == "fehler", ueb["kaputt"]["fehler"][:80])
namen = [sp["function"]["name"] for sp in s.MCP.specs()]
check("Werkzeug-Namen mcp_<server>_<tool>", "mcp_test_addiere" in namen and "mcp_fern_uhrzeit" in namen, ", ".join(namen))
check("stdio-Aufruf", s.MCP.aufrufen("mcp_test_addiere", {"a": 2, "b": 3}) == (True, "2 + 3 = 5"))
check("HTTP-Aufruf (SSE-Antwort)", s.MCP.aufrufen("mcp_fern_addiere", {"a": 40, "b": 2}) == (True, "40 + 2 = 42"))
ok, txt = s.MCP.aufrufen("mcp_test_kaputt", {})
check("isError → nicht ok", not ok and "Absichtlicher Fehler" in txt)


# --- Berechtigungen im echten execute_call
class FakeRun:
    def __init__(self, free=False):
        self.conv = {"id": "t1", "title": "Test", "messages": [], "_groups": ["mcp"]}
        self.events, self.approvals, self.free_hand, self.tool_extra, self.current_call = [], {}, free, {}, None
        self.cancel = threading.Event()

    def emit(self, **kw):
        self.events.append(kw)
        if kw.get("t") == "approve" and getattr(self, "antwort", None):
            def ja():
                time.sleep(0.2)
                slot = self.approvals[kw["id"]]
                slot["allow"], slot["always"] = self.antwort
                slot["event"].set()
            threading.Thread(target=ja, daemon=True).start()


s.notify_approval = lambda *a, **k: None
call = lambda name, args: {"id": "c" + str(time.time()), "name": name, "arguments": json.dumps(args)}

r = FakeRun()
r.antwort = (True, False)
ok, res = s.execute_call(r, call("mcp_test_addiere", {"a": 1, "b": 1}))
ap = next((e for e in r.events if e.get("t") == "approve"), None)
check("MCP standardmäßig: fragen", ap is not None and ap.get("always") == "MCP-Server test" and ok and res == "1 + 1 = 2", str(ap))

r = FakeRun()
r.antwort = (True, True)  # „Immer erlauben“
s.execute_call(r, call("mcp_test_uhrzeit", {}))
check("Immer erlauben setzt mcp:test = erlauben", s.RECHTE.stufe("mcp", "test") == "erlauben" and gespeichert[-1].get("mcp:test") == "erlauben")
r = FakeRun()
s.execute_call(r, call("mcp_test_uhrzeit", {}))
check("danach ohne Nachfrage", not any(e.get("t") == "approve" for e in r.events))
check("anderer Server fragt weiter", s.RECHTE.stufe("mcp", "fern") == "fragen")

s.RECHTE.setzen("code", "verbieten")
r = FakeRun(free=True)
ok, res = s.execute_call(r, call("run_python", {"code": "print(1)"}))
check("verbieten gilt auch bei Freier Hand", not ok and "VERBOTEN" in res and not any(e.get("t") == "approve" for e in r.events))
s.RECHTE.setzen("code", "fragen")
r = FakeRun(free=True)
ok, res = s.execute_call(r, call("run_python", {"code": "print(6*7)"}))
check("fragen + Freie Hand → läuft ohne Nachfrage", ok and "42" in res and not any(e.get("t") == "approve" for e in r.events), res[:60])
r = FakeRun()
r.antwort = (False, False)
ok, res = s.execute_call(r, call("run_python", {"code": "print(1)"}))
check("abgelehnt → nicht ausgeführt", not ok and "NICHT erlaubt" in res)
r = FakeRun()
ok, res = s.execute_call(r, call("calculate", {"expression": "2+2"}))
check("Rechnen: immer erlaubt, ohne Nachfrage", ok and not any(e.get("t") == "approve" for e in r.events))
b, akt = permissions.einteilen("read_file", {"path": r"C:\Windows\win.ini"}, s.CTX)
check("Datei außerhalb → dateien_aussen", b == "dateien_aussen", akt)
b, _ = permissions.einteilen("open_on_laptop", {"target": "https://example.com"}, s.CTX)
check("URL öffnen → internet", b == "internet")

eintraege = s.AUDIT.lesen(50)
arten = [e["entscheidung"] for e in eintraege]
check("Protokoll: verboten/abgelehnt/erlaubt/Freie Hand/Regel", {"verboten", "abgelehnt", "vom Nutzer erlaubt", "Freie Hand", "Regel: erlauben"} <= set(arten), str(arten))
check("Protokoll ohne riesige Inhalte", all(len(e.get("args", "")) <= 300 for e in eintraege))

# Werkzeugkasten
specs = s.tools_for({"messages": [{"role": "user", "content": "nutze die mcp integration"}]})
check("MCP-Werkzeuge im Werkzeugkasten, wenn gewünscht", any(sp["function"]["name"].startswith("mcp_") for sp in specs))
specs = s.tools_for({"messages": [{"role": "user", "content": "wie wird das wetter"}]})
check("… sonst nicht (Prompt bleibt klein)", not any(sp["function"]["name"].startswith("mcp_") for sp in specs))
check("Systemprompt nennt Integrationen", "Integrationen (MCP): test (3 Werkzeuge)" in s.system_prompt())

s.MCP.stoppen()
http.terminate()
print("\n" + ("Alles OK" if not fails else f"{fails} FEHLER"))
sys.exit(1 if fails else 0)
