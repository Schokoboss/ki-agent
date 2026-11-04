"""Nova: Auftrag ohne Zeitlimit, Fortsetzen nach Neustart/Absturz, Zwischenstand, schlanke Chat-Dateien, Autostart."""
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "server"))
import agent_server as s
import permissions
import tools

fails = 0


def check(name, cond, extra=""):
    global fails
    print(("OK    " if cond else "FEHLER") + f" {name}" + (f" – {extra}" if extra else ""))
    fails += 0 if cond else 1


tmp = Path(tempfile.mkdtemp())
for d in ("conversations", "logs", "workspace"):
    (tmp / d).mkdir()
s.CONV_DIR, s.LOGS, s.WORKSPACE = tmp / "conversations", tmp / "logs", tmp / "workspace"
cfg = dict(s.DEFAULT_CONFIG)
cfg.update({"token": "x", "tunnel": False})
s.CFG = cfg
s.CTX = tools.ToolContext(s.WORKSPACE, tmp / "memory.json", sys.executable)
s.RECHTE = permissions.Rechte(cfg, lambda c: None)
s.AUDIT = permissions.Protokoll(tmp / "audit.jsonl")
s.LLAMA.state = "bereit"
pushes = []
s.PUSH.notify = lambda kind, title, body, run, **k: pushes.append((kind, title, body))
s.notify_approval = lambda *a, **k: None
s.keep_awake = lambda on: None
s.save_config = lambda c: None


def call(name, args):
    return {"id": f"c{time.time_ns()}", "name": name, "arguments": json.dumps(args)}


def fake(script, delay=0.05):
    it = iter(script)

    def stream(build, run):
        build()
        time.sleep(delay)
        step = next(it, ("text", "FERTIG Erledigt."))
        if step[0] == "text":
            return step[1], "", [], {}, "stop"
        return "", "", [call(step[1], step[2])], {}, "tool_calls"
    return stream


def warten(run, sek=15):
    for _ in range(int(sek * 10)):
        if run.done:
            return True
        time.sleep(0.1)
    return False


# ---------- 1) Bis fertig
s.llm_stream_safe = fake([("tool", "update_notes", {"notes": "- [ ] A\n- [ ] B"}), ("tool", "calculate", {"expression": "1+1"}),
                          ("text", "Zwischendurch fertig?"), ("tool", "update_notes", {"notes": "- [x] A\n- [x] B"}),
                          ("text", "FERTIG Beides erledigt.")])
conv = {"id": "endlos1", "title": "Endlos", "created": time.time(), "messages": []}
run = s.start_run(conv, "Mach A und B", [], {"work_endless": True})
gespeichert = json.loads((s.CONV_DIR / "endlos1.json").read_text(encoding="utf-8"))
check("Zustand gleich beim Start gespeichert", gespeichert.get("_work_state", {}).get("endless") is True)
check("Auftrag: ohne Zeitlimit, Badge -1", "ohne Zeitlimit" in conv["messages"][0]["content"] and conv["messages"][0]["_work"] == -1)
check("Info: endless, Grenze 7 Tage", run.info()["endless"] and run.minutes == s.ENDLOS_MIN)
check("Fertig", warten(run))
tool_txt = next(m["content"] for m in conv["messages"] if m["role"] == "tool" and m["name"] == "calculate")
check("Werkzeug-Ergebnis: kein Zeitlimit statt Restzeit", "kein Zeitlimit" in tool_txt, tool_txt[-70:])
nudge = next((m["content"] for m in conv["messages"] if m.get("_system")), "")
check("Nachfrage ohne 7-Tage-Restzeit", "kein Zeitlimit" in nudge and "Tag" not in nudge, nudge[:60])
rep = next(e for e in run.events if e.get("t") == "report")
check("Bericht: ohne Zeitlimit", "ohne Zeitlimit" in Path(rep["path"]).read_text(encoding="utf-8"))
check("Zustand nach dem Ende gelöscht", "_work_state" not in json.loads((s.CONV_DIR / "endlos1.json").read_text(encoding="utf-8")))
run.extend(15)
check("+15 bei bis fertig ohne Wirkung", run.minutes == s.ENDLOS_MIN)

# ---------- 2) Absturz mitten im Werkzeug → nach Neustart weiter
jetzt = time.time()
conv2 = {"id": "absturz1", "title": "Absturz", "created": jetzt, "_notes": "- [x] Teil 1\n- [ ] Teil 2", "messages": [
    {"role": "user", "content": "[Auftrag …]\n\nBau Teil 1 und 2", "_display": "Bau Teil 1 und 2", "_work": 30},
    {"role": "assistant", "content": "", "tool_calls": [{"id": "t1", "type": "function", "function": {"name": "calculate", "arguments": "{\"expression\": \"2+2\"}"}}]},
], "_work_state": {"started": jetzt - 600, "deadline": jetzt + 1200, "minutes": 30, "endless": False, "free_hand": False,
                   "thinking": False, "base": 0, "step": 4, "paused": False, "paused_total": 0, "files": ["C:\\x\\teil1.txt"],
                   "tool_counts": {"calculate": 3}, "restarts": 0, "saved": jetzt - 120}}
s.Store.save(conv2)
conv3 = {"id": "kaputt1", "title": "Kaputt", "created": jetzt, "messages": [{"role": "user", "content": "x"}],
         "_work_state": {**conv2["_work_state"], "restarts": 5}}
s.Store.save(conv3)
s.llm_stream_safe = fake([("tool", "update_notes", {"notes": "- [x] Teil 1\n- [x] Teil 2"}), ("text", "FERTIG Teil 2 auch fertig.")], 0.3)
pushes.clear()
s.resume_unfinished()
run2 = s.RUNS.get("absturz1")
check("Unterbrochener Auftrag wird fortgesetzt", run2 is not None and not run2.done)
check("Uhr stand, solange Nova aus war (+120 s)", run2 and 115 < run2.deadline - (jetzt + 1200) < 130, f"+{run2.deadline - (jetzt + 1200):.0f} s")
check("Offener Werkzeug-Aufruf beantwortet", any(m["role"] == "tool" and m.get("tool_call_id") == "t1" for m in conv2["messages"]) or
      any(m["role"] == "tool" and m.get("tool_call_id") == "t1" for m in run2.conv["messages"]))
check("Hinweis an die KI: neu gestartet", any("neu gestartet" in (m.get("content") or "") for m in run2.conv["messages"] if m.get("_system")))
check("Push: läuft weiter", any("läuft weiter" in t for _, t, _ in pushes), str(pushes[:1]))
check("Fortgesetzter Auftrag fertig", warten(run2))
rep2 = next((e for e in run2.events if e.get("t") == "report"), None)
txt2 = Path(rep2["path"]).read_text(encoding="utf-8") if rep2 else ""
check("Bericht: Neustart vermerkt, Werkzeuge von vorher zählen mit", "nach 1 Neustart fortgesetzt" in txt2 and "calculate ×3" in txt2 and "**Werkzeuge:** 4" in txt2, txt2[:300].replace("\n", " | "))
check("Nicht wieder aufgenommen nach 5 Neustarts", "kaputt1" not in s.RUNS and "_work_state" not in s.Store.load("kaputt1"))
check("Abgeschlossener Auftrag wird nicht noch mal gestartet", (s.resume_unfinished() or True) and s.RUNS["absturz1"] is run2)

# ---------- 3) Pausiert beendet → pausiert fortsetzen
conv4 = {"id": "pause1", "title": "Pause", "created": jetzt, "messages": [{"role": "user", "content": "x", "_work": 30}],
         "_work_state": {**conv2["_work_state"], "paused": True, "saved": time.time()}}
s.Store.save(conv4)
s.llm_stream_safe = fake([("text", "FERTIG ok")])
s.resume_unfinished()
run4 = s.RUNS["pause1"]
time.sleep(0.8)
check("Pausierter Auftrag bleibt nach Neustart pausiert", run4.paused_at and not run4.done and run4.step <= 5)
run4.resume()
check("… und läuft nach Weiter zu Ende", warten(run4))

# ---------- 4) Zwischenstand
pushes.clear()
r = s.Run({"id": "zw", "title": "Zwischen", "messages": [], "_notes": "- [x] A\n- [ ] B ganz wichtig"}, {"work_minutes": 120})
r.step = 42
s.zwischenstand(r)
check("Kein Zwischenstand vor Ablauf der Stunde", not pushes)
r.interim_at = time.time() - 3700
s.zwischenstand(r)
check("Zwischenstand mit Schritt, Plan, nächstem Punkt", pushes and "Schritt 42" in pushes[0][2] and "Plan 1/2" in pushes[0][2]
      and "B ganz wichtig" in pushes[0][2], pushes[0][2] if pushes else "")

# ---------- 5) Schlanke Chat-Datei
msgs = [{"role": "user", "content": "AUFTRAG " + "a" * 5000}]
for i in range(300):
    msgs += [{"role": "assistant", "content": "b" * 4000, "_thinking": "c" * 2000}, {"role": "tool", "content": "d" * 5000, "name": "x"}]
cv = {"messages": msgs}
vorher = len(json.dumps(cv))
s._schlank(cv, 0)
nachher = len(json.dumps(cv))
alt = msgs[1:-150]
check("Alte Ausgaben gekürzt", all(len(m["content"]) <= 3020 and "_thinking" not in m for m in alt)
      and sum(len(m["content"]) for m in alt) < 0.45 * 450 * 4500, f"{vorher // 1000} kB → {nachher // 1000} kB")
check("Auftrag und letzte 150 Nachrichten unverändert", len(msgs[0]["content"]) == 5008 and all(len(m["content"]) in (4000, 5000) for m in msgs[-150:]))

# ---------- 6) Autostart
os.environ["APPDATA"] = str(tmp / "appdata")
(tmp / "appdata" / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup").mkdir(parents=True)
check("Autostart anfangs aus", s.autostart() is False)
check("Autostart an", s.autostart(True) is True)
inhalt = s._autostart_datei().read_text(encoding="utf-8")
check("Autostart-Datei startet Nova ohne Browser", "NOVA_AUTOSTART=1" in inhalt and "agent_server.py" in inhalt and "/min" in inhalt)
check("Autostart aus", s.autostart(False) is False and not s._autostart_datei().exists())

shutil.rmtree(tmp, ignore_errors=True)
print("\n" + ("Alles OK" if not fails else f"{fails} FEHLER"))
sys.exit(1 if fails else 0)
