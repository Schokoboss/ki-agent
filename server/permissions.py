"""Genaue Berechtigungen: Jedes Werkzeug gehört zu einem Bereich, und jeder Bereich steht auf
„erlauben“, „fragen“ oder „verbieten“. „Freie Hand“ überspringt nur das Fragen – „verbieten“ gilt immer.
Jede ausgeführte (oder abgelehnte) Aktion landet im Protokoll data/audit.jsonl.
"""

import json
import re
import threading
import time
from pathlib import Path

import tools

ERLAUBEN, FRAGEN, VERBIETEN = "erlauben", "fragen", "verbieten"
STUFEN = (ERLAUBEN, FRAGEN, VERBIETEN)

# Bereich → (Name in der App, Erklärung, Standard). Standards entsprechen dem bisherigen Verhalten.
BEREICHE = {
    "code": ("Code ausführen", "Python, PowerShell und JavaScript auf dem Laptop", FRAGEN),
    "dateien": ("Dateien im Arbeitsordner", "lesen, schreiben, ändern im Nova-Arbeitsordner", ERLAUBEN),
    "dateien_aussen": ("Dateien außerhalb", "alles außerhalb des Arbeitsordners (Dokumente, Desktop …)", FRAGEN),
    "laptop_steuern": ("Maus & Tastatur", "Nova bedient den Laptop selbst", FRAGEN),
    "laptop_oeffnen": ("Programme öffnen", "Dateien und Programme am Laptop öffnen", FRAGEN),
    "bildschirm": ("Bildschirm sehen", "Bildschirmfoto und Bildschirmaufnahme", ERLAUBEN),
    "laptop_info": ("Laptop-Infos & Medien", "Akku/Status, Lautstärke, Musik, Laptop sperren", ERLAUBEN),
    "internet": ("Internet", "Websuche, Webseiten lesen, Recherche, Downloads, Wetter, Wikipedia", ERLAUBEN),
    "erstellen": ("Erstellen", "Bilder, Videos, Dokumente, Shader, Spiele", ERLAUBEN),
    "veroeffentlichen": ("Veröffentlichen", "Seiten/Spiele per Link erreichbar machen", ERLAUBEN),
    "mcp": ("MCP-Integrationen", "Werkzeuge angebundener MCP-Server (Standard für alle Server)", FRAGEN),
}

ZUORDNUNG = {
    "run_python": "code", "run_powershell": "code", "run_node": "code",
    "laptop_control": "laptop_steuern",
    "laptop_screenshot": "bildschirm", "record_screen": "bildschirm",
    "laptop_status": "laptop_info", "media_control": "laptop_info", "lock_laptop": "laptop_info",
    "web_search": "internet", "open_webpage": "internet", "research": "internet", "download_file": "internet",
    "wikipedia": "internet", "weather": "internet",
    "create_image": "erstellen", "make_video": "erstellen", "edit_video": "erstellen", "make_document": "erstellen",
    "minecraft_shader": "erstellen", "make_game": "erstellen",
    "publish_web": "veroeffentlichen",
}
DATEI_WERKZEUGE = {"read_file", "list_files", "write_file", "edit_file", "project_tree", "find_in_files", "send_to_phone"}


def einteilen(name: str, args: dict, ctx) -> tuple[str | None, str]:
    """→ (Bereich, Beschreibung der Aktion). Bereich None = immer erlaubt (rechnen, merken, Notizen …)."""
    if name.startswith("mcp_"):
        return "mcp", f"MCP-Werkzeug {name[4:]}"
    if name in DATEI_WERKZEUGE or (name == "knowledge" and str(args.get("action") or "").lower() == "add"):
        p = tools._resolve(str(args.get("path") or "."), ctx)
        innen = tools._inside_workspace(p, ctx)
        grund = tools.approval_reason("read_file" if name == "send_to_phone" else name, args, ctx)
        return ("dateien", f"{name}: {p}") if innen else ("dateien_aussen", grund or f"{name}: {p}")
    if name == "open_on_laptop":
        ziel = str(args.get("target") or "").strip()
        if re.match(r"^https?://", ziel, re.I):
            return "internet", f"Im Browser öffnen: {ziel[:120]}"
        return "laptop_oeffnen", f"Am Laptop öffnen: {ziel[:120]}"
    if name == "laptop_control":
        return "laptop_steuern", (f"Maus/Tastatur steuern: {args.get('action')} "
                                  f"{args.get('text') or args.get('key') or (str(args.get('x')) + ',' + str(args.get('y')))}")
    if name in ZUORDNUNG:
        b = ZUORDNUNG[name]
        return b, tools.approval_reason(name, args, ctx) or f"{BEREICHE[b][0]}: {name}"
    return None, name


class Rechte:
    """Gespeichert in der Konfiguration unter „permissions“: {Bereich: Stufe, "mcp:<server>": Stufe}."""

    def __init__(self, cfg: dict, save):
        self.cfg, self.save = cfg, save

    def stufe(self, bereich: str, server: str | None = None) -> str:
        p = self.cfg.setdefault("permissions", {})
        if server and p.get(f"mcp:{server}") in STUFEN:
            return p[f"mcp:{server}"]
        return p.get(bereich) if p.get(bereich) in STUFEN else BEREICHE[bereich][2]

    def setzen(self, schluessel: str, stufe: str) -> None:
        if stufe not in STUFEN and stufe != "standard":
            raise ValueError("Stufe muss erlauben, fragen oder verbieten sein")
        if schluessel not in BEREICHE and not schluessel.startswith("mcp:"):
            raise ValueError(f"Unbekannter Bereich: {schluessel}")
        p = self.cfg.setdefault("permissions", {})
        if stufe == "standard":
            p.pop(schluessel, None)
        else:
            p[schluessel] = stufe
        self.save(self.cfg)

    def uebersicht(self) -> list[dict]:
        return [{"id": b, "name": n, "info": i, "standard": s, "stufe": self.stufe(b)} for b, (n, i, s) in BEREICHE.items()]


class Protokoll:
    """Nachvollziehbarkeit: jede Aktion mit Zeit, Chat, Werkzeug, Bereich und Entscheidung (JSON-Zeilen)."""

    MAX = 5000

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()

    def schreiben(self, **eintrag) -> None:
        eintrag = {"t": round(time.time(), 1), **eintrag}
        with self.lock:
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                with open(self.path, "a", encoding="utf-8") as f:
                    f.write(json.dumps(eintrag, ensure_ascii=False) + "\n")
                if self.path.stat().st_size > 3_000_000:  # klein halten: nur die letzten MAX Einträge
                    zeilen = self.path.read_text(encoding="utf-8").splitlines()[-self.MAX:]
                    self.path.write_text("\n".join(zeilen) + "\n", encoding="utf-8")
            except OSError:
                pass

    def lesen(self, n: int = 200) -> list[dict]:
        try:
            zeilen = self.path.read_text(encoding="utf-8").splitlines()[-n:]
        except OSError:
            return []
        out = []
        for z in reversed(zeilen):
            try:
                out.append(json.loads(z))
            except ValueError:
                continue
        return out


def kurz(args: dict) -> str:
    """Argumente fürs Protokoll – kurz und ohne riesige Inhalte."""
    teile = []
    for k, v in (args or {}).items():
        s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
        teile.append(f"{k}={s[:80]}{'…' if len(s) > 80 else ''}")
    return ", ".join(teile)[:300]
