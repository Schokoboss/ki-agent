"""Alle Nova-Tests auf einmal (isoliert: echte Chats, Arbeitsordner und config.json bleiben unberührt).

    python werkzeuge/tests/alle_tests.py             → Rechte + MCP, Zeit-Modus, Dauerbetrieb
    python werkzeuge/tests/alle_tests.py --handy     → zusätzlich Handy-Test (Testserver + unsichtbares Chrome)
    python werkzeuge/tests/alle_tests.py --spiele    → zusätzlich Spiele-Werkstatt (Chrome)
"""
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HIER = Path(__file__).resolve().parent
ROOT = HIER.parents[1]
ENV = {**os.environ, "PYTHONIOENCODING": "utf-8"}
ergebnisse = []


def lauf(name, befehl, timeout=900):
    t0 = time.time()
    r = subprocess.run([str(b) for b in befehl], capture_output=True, text=True, encoding="utf-8", errors="replace",
                       cwd=ROOT, env=ENV, timeout=timeout)
    zeilen = [z for z in (r.stdout + r.stderr).splitlines() if z.strip()]
    ok = r.returncode == 0
    print(f"{'OK    ' if ok else 'FEHLER'} {name:30s} {time.time() - t0:6.1f} s  {zeilen[-1][:90] if zeilen else ''}", flush=True)
    if not ok:
        for z in [z for z in zeilen if z.startswith("FEHLER")][:15] or zeilen[-15:]:
            print("        " + z[:160])
    ergebnisse.append(ok)


print("Nova – alle Tests\n")
lauf("Rechte + MCP", [sys.executable, HIER / "test_rechte_mcp.py"])
lauf("Zeit-Modus", [sys.executable, HIER / "test_zeitmodus.py"])
lauf("Dauerbetrieb (bis fertig)", [sys.executable, HIER / "test_endlos.py"])
if "--spiele" in sys.argv:
    lauf("Spiele-Werkstatt", [sys.executable, HIER / "test_spiele.py"])

if "--handy" in sys.argv:
    node = shutil.which("node")
    if not node:
        print("FEHLER Handy-Test: Node fehlt")
        ergebnisse.append(False)
    else:
        server = subprocess.Popen([sys.executable, str(ROOT / "werkzeuge" / "ui_testserver.py")],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=ENV)
        try:
            for _ in range(60):
                try:
                    urllib.request.urlopen("http://127.0.0.1:8799/", timeout=1)
                    break
                except OSError:
                    time.sleep(0.5)
            lauf("Handy-Test (6 Profile)", [node, ROOT / "werkzeuge" / "handytest.mjs", "--app", "nova"])
        finally:
            server.terminate()

print(f"\n{sum(ergebnisse)} von {len(ergebnisse)} Testreihen bestanden" + ("" if all(ergebnisse) else " – siehe FEHLER oben"))
sys.exit(0 if all(ergebnisse) else 1)
