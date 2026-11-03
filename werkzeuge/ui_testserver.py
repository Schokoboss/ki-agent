"""Isolierter Nova-Testserver für Oberflächen-Tests (Port 8799): Fake-KI, Test-MCP-Server, alle Daten in einem
Temp-Ordner. Rührt weder Novas echte Daten noch Tunnel oder Modell an.

    python werkzeuge/ui_testserver.py            → http://localhost:8799/#t=uitest-token-123
    node werkzeuge/handytest.mjs --app nova      → Handy-Test gegen diesen Server
"""
import json
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
import agent_server as s
import mcp_client
import permissions
import tools

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
SCR = Path(__file__).parent
PY = sys.executable
TMP = Path(tempfile.mkdtemp(prefix="nova-uitest-"))
for d in ("conversations", "uploads", "logs", "workspace"):
    (TMP / d).mkdir(parents=True, exist_ok=True)

s.DATA = TMP
s.CONV_DIR = TMP / "conversations"
s.UPLOADS = TMP / "uploads"
s.LOGS = TMP / "logs"
s.WORKSPACE = TMP / "workspace"
s.CONFIG_PATH = TMP / "config.json"
cfg = dict(s.DEFAULT_CONFIG)
cfg.update({"token": "uitest-token-123", "port": 8799, "tunnel": False, "agent_name": "Nova"})
cfg.pop("permissions", None)
s.CFG = cfg
s.CONFIG_PATH.write_text(json.dumps(cfg), encoding="utf-8")
s.CTX = tools.ToolContext(s.WORKSPACE, TMP / "memory.json", sys.executable)
s.RECHTE = permissions.Rechte(cfg, lambda c: None)
s.AUDIT = permissions.Protokoll(TMP / "audit.jsonl")
(TMP / "mcp.json").write_text(json.dumps({"mcpServers": {
    "test": {"command": PY, "args": [str(SCR / "mcp_test_server.py")]},
    "kalender": {"command": "gibts-wirklich-nicht-123"},
    "github": {"url": "http://127.0.0.1:5999/mcp", "enabled": False},
}}), encoding="utf-8")
s.MCP = mcp_client.McpManager(TMP / "mcp.json", s.LOGS, lambda m: print("MCP:", m, flush=True), s.VERSION)
s.LLAMA.state = "bereit"
s.LLAMA.ctx = 24576
for n in ("notify_done", "notify_error", "notify_approval"):
    setattr(s, n, lambda *a, **k: None)
s.keep_awake = lambda on: None


def call(name, args):
    return {"id": f"c{time.time_ns()}", "name": name, "arguments": json.dumps(args, ensure_ascii=False)}


AUFTRAG = [
    ("tool", "update_notes", {"notes": "Plan:\n- [ ] Uhrzeit über die Integration holen\n- [ ] Angebot schreiben\n- [ ] Summe nachrechnen"}),
    ("tool", "mcp_test_uhrzeit", {}),
    ("tool", "write_file", {"path": "Projekte/UITest/angebot.md", "content": "# Angebot\n\n- Webdesign 1200 €\n- Hosting 120 €\n"}),
    ("tool", "update_notes", {"notes": "Plan:\n- [x] Uhrzeit über die Integration holen\n- [x] Angebot schreiben\n- [ ] Summe nachrechnen"}),
    ("tool", "run_python", {"code": "print(1200 + 120)"}),
    ("tool", "update_notes", {"notes": "Plan:\n- [x] Uhrzeit über die Integration holen\n- [x] Angebot schreiben\n- [x] Summe nachrechnen"}),
    ("text", "FERTIG Das Angebot liegt in `Projekte/UITest/angebot.md`, Summe 1.320 €."),
]
skripte = {}


def fake_stream(build, run):
    build()
    time.sleep(2.5 if run.deadline else 0.6)
    cid = run.conv["id"]
    if cid not in skripte:
        skripte[cid] = iter(AUFTRAG if run.deadline else [("text", "Hallo! Das ist eine **Test-Antwort** der Fake-KI.")])
    step = next(skripte[cid], ("text", "FERTIG Nichts mehr zu tun."))
    if step[0] == "text":
        skripte.pop(cid, None)
        return step[1], "", [], {}, "stop"
    return "", "", [call(step[1], step[2])], {}, "tool_calls"


s.llm_stream_safe = fake_stream
s.MCP.starten()
print("UI-Testserver: http://localhost:8799/#t=uitest-token-123", flush=True)
s.Server(("127.0.0.1", 8799), s.Handler).serve_forever()
