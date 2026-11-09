#!/usr/bin/env python3
"""Baut Tumult Arena als eine einzige HTML-Datei, die ohne Server läuft (du gegen Bots, alles im Browser).

    python spiele/tumult-arena/offline_bauen.py [ziel.html]          → komplette Datei (Standard: tumult-arena-offline.html)
    python spiele/tumult-arena/offline_bauen.py ziel.html --fragment → ohne <html>/<head>/<body>-Gerüst

Helden, Modi und Karten kommen direkt aus spiel.py, die Logik aus web/lokal.js. Die fertige Datei lässt sich auch aufs
Handy kopieren und dort im Browser öffnen.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEB = HERE / "web"
sys.path.insert(0, str(HERE))
import spiel  # noqa: E402


def data_js():
    data = {
        "C": dict(TICK=spiel.TICK, R=spiel.R, HIT_R=spiel.HIT_R, EPS=spiel.EPS, CRATE_HP=spiel.CRATE_HP,
                  REGEN_WAIT=spiel.REGEN_WAIT, REGEN_RATE=spiel.REGEN_RATE, SHIELD_TIME=spiel.SHIELD_TIME,
                  MAX_CRYSTALS=spiel.MAX_CRYSTALS, MAX_CELLS=spiel.MAX_CELLS),
        "HEROES": spiel.HEROES, "MODES": spiel.MODES, "MAPS": spiel.MAPS, "BOT_NAMES": spiel.BOT_NAMES,
    }
    return "const TUMULT_DATA = " + json.dumps(data, ensure_ascii=False) + ";"


def build(fragment=False):
    html = (WEB / "index.html").read_text(encoding="utf-8")
    body = html.split("<body>", 1)[1].split("</body>", 1)[0]
    body = re.sub(r"\s*<script src=\"[^\"]+\"></script>", "", body).strip()
    css = (WEB / "style.css").read_text(encoding="utf-8")
    scripts = [(WEB / "ton.js").read_text(encoding="utf-8"), (WEB / "grafik.js").read_text(encoding="utf-8"), data_js(),
               (WEB / "lokal.js").read_text(encoding="utf-8"), (WEB / "spiel.js").read_text(encoding="utf-8")]
    for s in scripts:
        if "</script" in s.lower():
            raise SystemExit("Skript enthält </script> – kann nicht eingebettet werden")
    js = "\n".join(f"<script>\n{s}\n</script>" for s in scripts)
    head = f"<title>Tumult Arena</title>\n<style>\n{css}\n</style>"
    if fragment:
        return f"{head}\n{body}\n{js}\n"
    return ("<!doctype html>\n<html lang=\"de\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, "
            "viewport-fit=cover\">\n<meta name=\"theme-color\" content=\"#1b1440\">\n"
            f"{head}\n</head>\n<body>\n{body}\n{js}\n</body>\n</html>\n")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = Path(args[0]) if args else HERE / "tumult-arena-offline.html"
    out.write_text(build("--fragment" in sys.argv), encoding="utf-8")
    print(f"Gebaut: {out} ({out.stat().st_size // 1024} KB)")
