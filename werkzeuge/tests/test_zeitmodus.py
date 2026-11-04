import json
import shutil
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


sys.stdout.reconfigure(encoding="utf-8", errors="replace")
fails = 0


def check(name, cond, extra=""):
    global fails
    print(("OK    " if cond else "FEHLER") + f" {name}" + (f" – {extra}" if extra else ""))
    fails += 0 if cond else 1


cfg = dict(s.DEFAULT_CONFIG)
cfg.update({"token": "test", "tunnel": False})
cfg.pop("permissions", None)
s.CFG = cfg
s.CTX = tools.ToolContext(s.WORKSPACE, _tmp / "memory.json", sys.executable)
tmp = Path(tempfile.mkdtemp())
s.RECHTE = permissions.Rechte(cfg, lambda c: None)
s.AUDIT = permissions.Protokoll(tmp / "audit.jsonl")
s.LLAMA.state = "bereit"
s.notify_done = lambda *a, **k: None
s.notify_error = lambda *a, **k: None
s.keep_awake = lambda on: None


def call(name, args):
    return {"id": f"c{time.time_ns()}", "name": name, "arguments": json.dumps(args)}


def fake_llm(script, gate=None):
    it = iter(script)

    def stream(build, run):
        build()
        if gate:
            gate(run)
        step = next(it, ("text", "FERTIG Nichts mehr zu tun."))
        if step[0] == "text":
            return step[1], "", [], {}, "stop"
        return "", "", [call(step[1], step[2])], {}, "tool_calls"
    return stream


# ---------- Lauf 1: Plan, Datei, Pause/Weiter/+15, FERTIG, Bericht
ordner = "Projekte/ZeitTest"
s.llm_stream_safe = fake_llm([
    ("tool", "update_notes", {"notes": "Plan:\n- [ ] Datei schreiben\n- [ ] Prüfen"}),
    ("tool", "write_file", {"path": f"{ordner}/ergebnis.txt", "content": "hallo"}),
    ("tool", "update_notes", {"notes": "Plan:\n- [x] Datei schreiben\n- [ ] Prüfen"}),
    ("text", "FERTIG Datei geschrieben und geprüft."),
], gate=lambda r: time.sleep(0.5))
conv = {"id": "zeittest1", "title": "Zeit-Test", "created": time.time(), "messages": []}
run = s.start_run(conv, "Schreib eine Testdatei", [], {"work_minutes": 30})
t_deadline = run.deadline
time.sleep(0.3)
run.pause()
links_1 = run.remaining()
time.sleep(1.2)
links_2 = run.remaining()
schritt_in_pause = run.step
check("Pause: Restzeit steht still", abs(links_1 - links_2) < 0.05, f"{links_1:.2f} → {links_2:.2f}")
check("info meldet pausiert", run.info()["paused"] is True)
check("Pause hält die Arbeit an (kein neuer Schritt)", schritt_in_pause <= 2 and not run.done, f"Schritt {schritt_in_pause}")
check("Pause-Hinweis an die App", any(e.get("t") == "status" and "Pausiert" in e.get("d", "") for e in run.events))
run.resume()
check("Weiter: Deadline um Pausendauer verschoben", 1.1 < run.deadline - t_deadline < 1.6, f"+{run.deadline - t_deadline:.2f} s")
run.extend(15)
check("+15 min", run.minutes == 45 and 15 * 60 + 1.1 < run.deadline - t_deadline < 15 * 60 + 1.6)
for _ in range(150):
    if run.done:
        break
    time.sleep(0.1)
check("Lauf fertig", run.done)
plan = run.info()["plan"]
check("Plan als Checkliste (1/2 erledigt)", [p["done"] for p in plan] == [True, False], json.dumps(plan, ensure_ascii=False))
rep = next((e for e in run.events if e.get("t") == "report"), None)
check("Bericht-Event", rep is not None, json.dumps(rep, ensure_ascii=False)[:200] if rep else "")
if rep:
    text = Path(rep["path"]).read_text(encoding="utf-8")
    check("Bericht: Datei, Plan, Werkzeuge, Ergebnis, Pause",
          "ergebnis.txt" in text and "- [x] Datei schreiben" in text and "write_file ×1" in text
          and "Datei geschrieben und geprüft." in text and rep["pausiert"] >= 1 and "geplant 45 min" in text,
          text[:400].replace("\n", " | "))
    check("Bericht am letzten Beitrag gespeichert", conv["messages"][-1].get("_report", {}).get("name") == rep["name"])
work_events = [e for e in run.events if e.get("t") == "work"]
check("Plan-Updates live an die App", any(e.get("plan") for e in work_events))

# ---------- Lauf 2: Jetzt beenden
s.llm_stream_safe = fake_llm([("tool", "calculate", {"expression": "1+1"})] * 50,
                             gate=lambda r: time.sleep(0.05))
conv2 = {"id": "zeittest2", "title": "Zeit-Test 2", "created": time.time(), "messages": []}
run2 = s.start_run(conv2, "Rechne lange herum", [], {"work_minutes": 60})
time.sleep(0.4)
run2.finish_now()
for _ in range(100):
    if run2.done:
        break
    time.sleep(0.1)
notiz = next((m["content"] for m in conv2["messages"] if m.get("_system")), "")
check("Jetzt beenden → KI soll zusammenfassen", "Der Nutzer hat den Auftrag beendet" in notiz, notiz[:80])
rep2 = next((e for e in run2.events if e.get("t") == "report"), None)
check("Bericht vermerkt: vom Nutzer beendet", rep2 and rep2["vom_nutzer"] and "vom Nutzer" in Path(rep2["path"]).read_text(encoding="utf-8"))

# aufräumen
for c in (conv, conv2):
    try:
        (s.CONV_DIR / f"{c['id']}.json").unlink()
    except OSError:
        pass
for r in (rep, rep2):
    if r:
        Path(r["path"]).unlink(missing_ok=True)
shutil.rmtree(s.WORKSPACE / ordner, ignore_errors=True)
print("\n" + ("Alles OK" if not fails else f"{fails} FEHLER"))
sys.exit(1 if fails else 0)
