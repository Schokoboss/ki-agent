"""Minecraft-Shader-Baukasten für Nova.

Nova schreibt keinen neuen Shader-Code (dafür ist ein kleines Modell zu unzuverlässig), sondern stellt
die beiden geprüften Iris-Shaderpacks AuroraCraft und BedRush nach Wunsch ein: Profil, Stil und einzelne
Optionen werden in die #define-Zeilen von lib/settings.glsl geschrieben – nur mit Werten aus den
Wertelisten des Packs. Danach wird gepackt (Zip mit „/“ als Trenner, sonst lehnt Java es ab) und
nach .minecraft/shaderpacks installiert.
"""

import os
import re
import shutil
import subprocess
import time
import zipfile
from pathlib import Path

MC = Path(os.environ.get("APPDATA", "")) / ".minecraft"
SHADERPACKS = MC / "shaderpacks"
IRIS_CFG = MC / "config" / "iris.properties"
DESKTOP_MC = Path(os.environ.get("USERPROFILE", "")) / "Desktop" / "MINECRAFT"

PACKS = {
    "aurora": {"label": "AuroraCraft – schön (Wasser, Wind, Leuchten, Nebel)",
               "src": DESKTOP_MC / "AuroraCraft" / "shaderpack"},
    "bedrush": {"label": "BedRush – PvP/Bedwars (Sicht vor Schönheit, Umrisse, Marker)",
                "src": DESKTOP_MC / "BedRush-Shader" / "shaderpack"},
}

# Stile setzen nur Optionen, die der gewählte Pack auch hat; Werte werden auf die Werteliste eingerastet
STYLES = {
    "warm": {"SATURATION": 1.25, "EXPOSURE": 1.2, "TORCH_INTENSITY": 1.25, "FOG_DENSITY": 0.75},
    "kalt": {"SATURATION": 0.8, "EXPOSURE": 1.0, "FOG_DENSITY": 1.5, "TORCH_INTENSITY": 0.75},
    "bunt": {"SATURATION": 1.5, "BLOOM": True, "BLOOM_STRENGTH": 0.45, "EMISSIVE_STRENGTH": 1.8},
    "duester": {"EXPOSURE": 0.8, "SATURATION": 0.8, "VIGNETTE": True, "VIGNETTE_STRENGTH": 0.5,
                "FOG_DENSITY": 1.5, "NIGHT_BRIGHTNESS": 0.5, "TORCH_INTENSITY": 1.5},
    "hell": {"EXPOSURE": 1.2, "NIGHT_BRIGHTNESS": 1.5, "AMBIENT_STRENGTH": 1.5, "FOG_DENSITY": 0.5},
    "realistisch": {"SATURATION": 1.0, "SHADOWS": True, "WATER_REFLECTION": 0.75, "WATER_WAVE_HEIGHT": 0.5,
                    "FOG_DENSITY": 1.0, "VIGNETTE": True, "VIGNETTE_STRENGTH": 0.25},
    "traumhaft": {"BLOOM": True, "BLOOM_STRENGTH": 0.6, "SATURATION": 1.25, "FOG_DENSITY": 1.5,
                  "WIND_STRENGTH": 1.5, "GODRAYS": True},
}

VALUE_RE = re.compile(r"^(\s*)#define\s+([A-Z][A-Z0-9_]*)\s+(-?[0-9.]+)(\s*//\s*\[([^\]]*)\].*)$")
TOGGLE_RE = re.compile(r"^(\s*)(//)?\s*#define\s+([A-Z][A-Z0-9_]*)\s*(//.*)?$")


class ShaderError(Exception):
    pass


def _pack(base: str) -> tuple[str, Path]:
    key = {"schön": "aurora", "schoen": "aurora", "auroracraft": "aurora", "pvp": "bedrush", "bedwars": "bedrush"}.get(
        (base or "aurora").strip().lower(), (base or "aurora").strip().lower())
    if key not in PACKS:
        raise ShaderError("Basis unbekannt – nimm 'aurora' (schön) oder 'bedrush' (PvP).")
    src = PACKS[key]["src"]
    if not (src / "shaders" / "lib" / "settings.glsl").is_file():
        raise ShaderError(f"Basis-Pack nicht gefunden: {src}")
    return key, src


def _lang(src: Path) -> dict[str, str]:
    out = {}
    for name in ("de_de.lang", "en_us.lang"):
        p = src / "shaders" / "lang" / name
        if p.is_file():
            for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
                if line.startswith("option.") and "=" in line:
                    k, v = line[7:].split("=", 1)
                    out.setdefault(k.strip(), v.strip())
    return out


def options(base: str) -> dict:
    """Alle einstellbaren Optionen: {NAME: {kind, default, values, name, comment}}"""
    _, src = _pack(base)
    lang = _lang(src)
    opts = {}
    for line in (src / "shaders" / "lib" / "settings.glsl").read_text(encoding="utf-8").splitlines():
        m = VALUE_RE.match(line)
        if m and m.group(2) in lang:
            opts[m.group(2)] = {"kind": "value", "default": m.group(3), "values": m.group(5).split()}
            continue
        m = TOGGLE_RE.match(line)
        if m and m.group(3) in lang:
            opts[m.group(3)] = {"kind": "toggle", "default": not m.group(2)}
    for k, o in opts.items():
        o["name"] = lang.get(k, k)
        o["comment"] = lang.get(k + ".comment", "")
    return opts


def profiles(base: str) -> dict[str, dict]:
    _, src = _pack(base)
    raw = {}
    for line in (src / "shaders" / "shaders.properties").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*profile\.([A-Za-z0-9_]+)\s*=\s*(.*)$", line)
        if m:
            raw[m.group(1).upper()] = m.group(2).split()

    def resolve(name, depth=0):
        vals = {}
        for tok in raw.get(name, []):
            if tok.startswith("profile.") and depth < 5:
                vals.update(resolve(tok[8:].upper(), depth + 1))
            elif tok.startswith("!"):
                vals[tok[1:]] = False
            elif ":" in tok:
                k, v = tok.split(":", 1)
                vals[k] = v
            else:
                vals[tok] = True
        return vals

    return {name: resolve(name) for name in raw}


# Häufige geratene Namen → echte Optionen (kleine Modelle erfinden gern eigene Namen)
SYNONYMS = {
    "LEAVES": "WAVING_LEAVES", "LEAF": "WAVING_LEAVES", "LEAF_SWAY": "WAVING_LEAVES", "SWAYING_LEAVES": "WAVING_LEAVES",
    "GRASS": "WAVING_PLANTS", "PLANTS": "WAVING_PLANTS", "WAVING_GRASS": "WAVING_PLANTS", "WAVES": "WATER_WAVES",
    "WAVE_HEIGHT": "WATER_WAVE_HEIGHT", "WAVE_SPEED": "WATER_WAVE_SPEED", "REFLECTIONS": "WATER_REFLECTION",
    "REFLECTION": "WATER_REFLECTION", "SHADOW": "SHADOWS", "GODRAY": "GODRAYS", "SUNRAYS": "GODRAYS",
    "LIGHT_RAYS": "GODRAYS", "VOLUMETRIC_LIGHT": "GODRAYS", "BRIGHTNESS": "EXPOSURE", "COLORS": "SATURATION",
    "COLOR": "SATURATION", "VIBRANCE": "SATURATION", "FOG": "FOG_DENSITY", "WIND": "WIND_STRENGTH", "GLOW": "BLOOM",
    "TORCH": "TORCH_INTENSITY", "TORCHES": "TORCH_INTENSITY", "NIGHT": "NIGHT_BRIGHTNESS", "STARS": "STAR_BRIGHTNESS",
}


def resolve_option(name: str, opts: dict) -> str | None:
    """Exakt, über Synonyme, über den deutschen Namen oder per Ähnlichkeit die echte Option finden."""
    import difflib
    key = re.sub(r"[^A-Z0-9]+", "_", str(name).upper()).strip("_")
    if key in opts:
        return key
    if SYNONYMS.get(key) in opts:
        return SYNONYMS[key]
    for k, o in opts.items():
        if o["name"].lower() == str(name).strip().lower():
            return k
    hits = difflib.get_close_matches(key, list(opts), n=1, cutoff=0.72)
    if hits:
        return hits[0]
    parts = [p for p in key.split("_") if len(p) > 2]
    cands = [k for k in opts if parts and all(p in k for p in parts)]
    return cands[0] if len(cands) == 1 else None


def _snap(value, allowed: list[str]) -> str:
    try:
        target = float(value)
    except (TypeError, ValueError):
        raise ShaderError(f"'{value}' ist keine Zahl.")
    return min(allowed, key=lambda a: abs(float(a) - target))


def _apply(text: str, changes: dict, opts: dict) -> tuple[str, list[str]]:
    done, lines = [], text.splitlines()
    for i, line in enumerate(lines):
        m = VALUE_RE.match(line)
        if m and m.group(2) in changes and opts.get(m.group(2), {}).get("kind") == "value":
            new = _snap(changes[m.group(2)], opts[m.group(2)]["values"])
            lines[i] = f"{m.group(1)}#define {m.group(2)} {new}{m.group(4)}"
            if new != m.group(3):
                done.append(f"{opts[m.group(2)]['name']}: {m.group(3)} → {new}")
            continue
        m = TOGGLE_RE.match(line)
        if m and m.group(3) in changes and opts.get(m.group(3), {}).get("kind") == "toggle":
            on = changes[m.group(3)]
            on = on if isinstance(on, bool) else str(on).lower() in ("1", "true", "an", "ja", "on")
            lines[i] = f"{m.group(1)}{'' if on else '//'}#define {m.group(3)}{(' ' + m.group(4)) if m.group(4) else ''}"
            if on == bool(m.group(2)):
                done.append(f"{opts[m.group(3)]['name']}: {'an' if on else 'aus'}")
    return "\n".join(lines) + "\n", done


def _zip(folder: Path, target: Path) -> None:
    tmp = target.with_suffix(".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(folder.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(folder).as_posix())  # „/“ als Trenner – Java besteht darauf
    os.replace(tmp, target)


def minecraft_running() -> bool:
    try:
        out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq javaw.exe", "/FO", "CSV", "/NH"],
                             capture_output=True, text=True, timeout=10, creationflags=0x08000000).stdout
        return "javaw.exe" in out.lower()
    except (OSError, subprocess.TimeoutExpired):
        return False


def _activate(zip_name: str) -> str:
    if minecraft_running():
        return ("Minecraft läuft gerade – im Spiel: Optionen → Grafik/Videoeinstellungen → Shader-Pakete → "
                f"„{zip_name}“ anklicken.")
    if not IRIS_CFG.is_file():
        return "Iris-Einstellungen nicht gefunden – im Spiel unter Shader-Pakete auswählen."
    lines = IRIS_CFG.read_text(encoding="utf-8", errors="replace").splitlines()
    keys = {"shaderPack": zip_name, "enableShaders": "true"}
    out, seen = [], set()
    for line in lines:
        k = line.split("=", 1)[0].strip()
        if k in keys:
            out.append(f"{k}={keys[k]}")
            seen.add(k)
        else:
            out.append(line)
    out += [f"{k}={v}" for k, v in keys.items() if k not in seen]
    IRIS_CFG.write_text("\n".join(out) + "\n", encoding="utf-8")
    return f"Ist beim nächsten Minecraft-Start (Fabric 26.3 mit Iris) automatisch aktiv."


def create(base: str, name: str, profile: str | None, style: str | None, changes: dict | None,
           workspace: Path, activate: bool = True) -> str:
    key, src = _pack(base)
    opts = options(key)
    wanted: dict = {}
    notes = []
    if profile:
        profs = profiles(key)
        p = profile.strip().upper()
        if p not in profs:
            raise ShaderError(f"Profil unbekannt. Vorhanden: {', '.join(profs)}")
        wanted.update(profs[p])
        notes.append(f"Profil {p}")
    if style:
        s = style.strip().lower().replace("ü", "ue")
        if s not in STYLES:
            raise ShaderError(f"Stil unbekannt. Vorhanden: {', '.join(STYLES)}")
        wanted.update({k: v for k, v in STYLES[s].items() if k in opts})
        notes.append(f"Stil {s}")
    mapped, unknown, renamed = {}, [], []
    for k, v in (changes or {}).items():
        real = resolve_option(k, opts)
        if real:
            mapped[real] = v
            if real != k:
                renamed.append(f"{k}→{real}")
        else:
            unknown.append(k)
    if unknown:
        raise ShaderError(f"Unbekannte Optionen: {', '.join(unknown)}. Gültig sind z. B.: {', '.join(list(opts)[:25])}")
    if renamed:
        notes.append("zugeordnet " + ", ".join(renamed))
    wanted.update(mapped)

    safe = re.sub(r"[^A-Za-z0-9_-]+", "-", name or "Mein-Shader").strip("-")[:40] or "Mein-Shader"
    pack_name = f"Nova-{safe}"
    build = workspace / "Shader" / pack_name
    if build.exists():
        shutil.rmtree(build)
    shutil.copytree(src, build)
    settings = build / "shaders" / "lib" / "settings.glsl"
    text, done = _apply(settings.read_text(encoding="utf-8"), wanted, opts)
    settings.write_text(text, encoding="utf-8")
    if not (build / "shaders").is_dir():
        raise ShaderError("Pack-Struktur kaputt (Ordner shaders fehlt).")

    SHADERPACKS.mkdir(parents=True, exist_ok=True)
    zip_name = f"{pack_name}.zip"
    _zip(build, SHADERPACKS / zip_name)
    old_cfg = SHADERPACKS / f"{zip_name}.txt"  # alte Menü-Einstellungen würden unsere Voreinstellung überschreiben
    if old_cfg.exists():
        old_cfg.unlink()
    act = _activate(zip_name) if activate else "Im Spiel unter Shader-Pakete auswählen."
    return (f"Shaderpack „{zip_name}“ gebaut (Basis {PACKS[key]['label'].split(' –')[0]}"
            f"{', ' + ', '.join(notes) if notes else ''}) und installiert in {SHADERPACKS}.\n"
            f"Geändert: {', '.join(done) if done else 'nichts (Standardwerte)'}\n{act}\n"
            f"Quellcode zum Weiterbauen: {build}")


def describe_options(base: str) -> str:
    key, _ = _pack(base)
    opts = options(key)
    lines = [f"Optionen von {PACKS[key]['label']} (Profile: {', '.join(profiles(key))}; Stile: {', '.join(STYLES)}):"]
    for k, o in opts.items():
        if o["kind"] == "toggle":
            lines.append(f"- {k} ({o['name']}): an/aus, Standard {'an' if o['default'] else 'aus'}")
        else:
            lines.append(f"- {k} ({o['name']}): {'/'.join(o['values'])}, Standard {o['default']}")
    return "\n".join(lines)


def list_packs() -> str:
    if not SHADERPACKS.is_dir():
        return "Kein shaderpacks-Ordner gefunden."
    packs = sorted(p.name for p in SHADERPACKS.iterdir() if p.suffix == ".zip")
    active = ""
    if IRIS_CFG.is_file():
        m = re.search(r"^shaderPack=(.*)$", IRIS_CFG.read_text(encoding="utf-8", errors="replace"), re.M)
        active = m.group(1).strip() if m else ""
    return "Installierte Shaderpacks:\n" + "\n".join(f"- {p}{'  ← aktiv' if p == active else ''}" for p in packs)
