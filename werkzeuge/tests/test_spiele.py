"""Spiele-Werkstatt: die Spiel-Vorlage im unsichtbaren Chrome starten und bewerten (braucht Chrome).
    python werkzeuge/tests/test_spiele.py [pfad/zu/index.html …]
"""
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "server"))
import games

out = Path(tempfile.mkdtemp(prefix="spieltest-"))
demo = out / "Demo" / "index.html"
demo.parent.mkdir()
shutil.copy(games.TEMPLATE, demo)
ziele = [(Path(a).parent.name, Path(a)) for a in sys.argv[1:]] or [("Demo", demo)]
fehler = 0
for name, p in ziele:
    t = time.time()
    rep = games.test(p, out / f"{name}.png")
    ok, text = games.judge(rep)
    print(f"=== {name} ({time.time() - t:.1f} s) Foto={bool(rep.get('shot'))} → {'OK' if ok else 'FEHLER'}")
    print(text)
    fehler += 0 if ok else 1
print("\n" + ("Alles OK" if not fehler else f"{fehler} FEHLER"))
sys.exit(1 if fehler else 0)
