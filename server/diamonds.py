"""Diamant-Finder für Nova: findet Diamanten (und andere Erze) in deinen eigenen Minecraft-Welten.

Liest – nur lesend, nie schreibend – die Speicherdateien einer Java-Einzelspielerwelt: die Spielerdatei
(wo du stehst, wohin du schaust) und die Regionsdateien r.X.Z.mca (Anvil-Format: NBT, zlib/gzip).
Gefunden wird nur, was das Spiel schon erzeugt und gespeichert hat – Gebiete, in denen du nie warst, stehen
noch nirgends. Auf fremden Servern geht das nicht: deren Welt liegt nicht auf dem Laptop.

Weltformate 1.13 bis 26.x, auch die neue Ordnerstruktur ab 26.1 (dimensions/minecraft/<dim>/region,
players/data, singleplayer_uuid in level.dat). Nur Standardbibliothek. Auch direkt nutzbar:

    python server/diamonds.py                        zuletzt gespielte Welt, 128 Blöcke um dich herum
    python server/diamonds.py "Neue Welt" --radius 200 --erz netherit --karte karte.png
    python server/diamonds.py --welten               alle gefundenen Welten
"""

import argparse
import difflib
import gzip
import math
import os
import struct
import sys
import time
import zlib
from array import array
from pathlib import Path


class DiamantFehler(Exception):
    pass


# ---------------------------------------------------------------- NBT (Named Binary Tag) lesen

class LongArray(bytes):
    """TAG_Long_Array roh (big-endian) – wird erst umgewandelt, wenn ein Abschnitt wirklich gebraucht wird."""

    def werte(self) -> array:
        a = array("Q")
        a.frombytes(self)
        if sys.byteorder == "little":
            a.byteswap()
        return a


_ZAHL = {1: ("b", 1), 2: ("h", 2), 3: ("i", 4), 4: ("q", 8), 5: ("f", 4), 6: ("d", 8)}


def _anzahl(b: bytes, p: int) -> int:
    return max(0, int.from_bytes(b[p:p + 4], "big", signed=True))


def _wert(b: bytes, p: int, t: int):
    """Liest den Inhalt eines Tags vom Typ t ab Position p → (Wert, neue Position)."""
    if t == 10:  # Compound
        d = {}
        while True:
            tt = b[p]
            if tt == 0:
                return d, p + 1
            n = (b[p + 1] << 8) | b[p + 2]
            name = b[p + 3:p + 3 + n].decode("utf-8", "replace")
            d[name], p = _wert(b, p + 3 + n, tt)
    if t == 8:  # String
        n = (b[p] << 8) | b[p + 1]
        return b[p + 2:p + 2 + n].decode("utf-8", "replace"), p + 2 + n
    if t == 9:  # Liste
        et, n = b[p], _anzahl(b, p + 1)
        p += 5
        if et in _ZAHL:
            f, size = _ZAHL[et]
            return list(struct.unpack_from(f">{n}{f}", b, p)), p + n * size
        out = []
        for _ in range(n if et else 0):
            v, p = _wert(b, p, et)
            out.append(v)
        return out, p
    if t in _ZAHL:
        f, size = _ZAHL[t]
        return struct.unpack_from(">" + f, b, p)[0], p + size
    if t == 7:  # Byte-Array
        n = _anzahl(b, p)
        return b[p + 4:p + 4 + n], p + 4 + n
    if t == 11:  # Int-Array (z. B. UUIDs)
        n = _anzahl(b, p)
        return struct.unpack_from(f">{n}i", b, p + 4), p + 4 + 4 * n
    if t == 12:  # Long-Array (Blockdaten, Höhenkarten)
        n = _anzahl(b, p)
        return LongArray(b[p + 4:p + 4 + 8 * n]), p + 4 + 8 * n
    raise ValueError(f"NBT: unbekannter Tag-Typ {t}")


def nbt_lesen(data: bytes) -> dict:
    """NBT-Datei (roh oder gzip) → dict der Wurzel."""
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    if len(data) < 3 or data[0] != 10:
        raise ValueError("keine NBT-Daten")
    n = (data[1] << 8) | data[2]
    return _wert(data, 3 + n, 10)[0]


# ---------------------------------------------------------------- Regionsdateien und Chunks

LUFT = {"minecraft:air", "minecraft:cave_air", "minecraft:void_air"}
LAVA = "minecraft:lava"


class _Abschnitt:
    """16×16×16 Blöcke: Palette (Blocknamen) + gepackte Indizes. Reihenfolge der Blöcke: y, z, x."""

    __slots__ = ("namen", "bits", "daten", "quer")

    def __init__(self, namen: tuple, daten, quer: bool):
        self.namen, self.quer, self.daten, self.bits = namen, quer, None, 0
        if len(namen) <= 1 or not isinstance(daten, LongArray) or not daten:
            return  # ein einziger Block im ganzen Abschnitt (oder keine Daten) → alles namen[0]
        w = daten.werte()
        n = len(w)
        if quer:  # bis 1.15: Werte dürfen über zwei Longs reichen → Länge = bits * 64
            bits = n // 64
        else:  # ab 1.16: kein Wert reicht über die Long-Grenze
            bits = max(4, (len(namen) - 1).bit_length())
            if -(-4096 // (64 // bits)) != n:
                bits = 64 // -(-4096 // n)
        if 1 <= bits <= 32 and (n * 64 >= bits * 4096 if quer else n * (64 // bits) >= 4096):
            self.daten, self.bits = w, bits

    def index(self, i: int) -> int:
        if self.daten is None:
            return 0
        b = self.bits
        if self.quer:
            bit = i * b
            w, o = bit >> 6, bit & 63
            v = self.daten[w] >> o
            if o + b > 64:
                v |= self.daten[w + 1] << (64 - o)
        else:
            per = 64 // b
            v = self.daten[i // per] >> ((i % per) * b)
        return v & ((1 << b) - 1)

    def name(self, i: int) -> str:
        k = self.index(i)
        return self.namen[k] if k < len(self.namen) else "minecraft:air"

    def finde(self, gesucht: set) -> list[int]:
        """Alle Positionen (0–4095) im Abschnitt, deren Block in gesucht steht."""
        ziel = {k for k, n in enumerate(self.namen) if n in gesucht}
        if not ziel:
            return []
        if self.daten is None:
            return list(range(4096)) if 0 in ziel else []
        if self.quer:
            return [i for i in range(4096) if self.index(i) in ziel]
        b, out, i = self.bits, [], 0
        m, per = (1 << b) - 1, 64 // b
        for v in self.daten:
            if v or 0 in ziel:
                for k in range(per):
                    if (v & m) in ziel:
                        out.append(i + k)
                    v >>= b
            i += per
        return [k for k in out if k < 4096]


class _Chunk:
    __slots__ = ("abschnitte", "unten")

    def __init__(self, abschnitte: dict):
        self.abschnitte = abschnitte
        self.unten = min(abschnitte) if abschnitte else 0  # darunter: außerhalb der Welt


def chunk_abschnitte(root: dict) -> dict | None:
    """Chunk-NBT → {Abschnitt-Y: _Abschnitt}. None = Format vor 1.13 (Blöcke als Zahlen-IDs)."""
    quer = (root.get("DataVersion") or 0) < 2529  # 20w17a (1.16): gepackte Werte reichen nicht mehr über Longs
    if isinstance(root.get("sections"), list):  # ab 1.18
        liste, neu = root["sections"], True
    elif isinstance(root.get("Level"), dict):  # 1.13 – 1.17
        liste, neu = root["Level"].get("Sections") or [], False
    else:
        return {}
    out, alt = {}, False
    for s in liste:
        if not isinstance(s, dict) or "Y" not in s:
            continue
        if neu:
            bs = s.get("block_states") if isinstance(s.get("block_states"), dict) else {}
            pal, daten = bs.get("palette"), bs.get("data")
        else:
            pal, daten = s.get("Palette"), s.get("BlockStates")
            alt = alt or "Blocks" in s
        if not pal:
            continue
        namen = tuple((e.get("Name") or "minecraft:air") if isinstance(e, dict) else str(e) for e in pal)
        out[int(s["Y"])] = _Abschnitt(namen, daten, quer)
    return None if alt and not out else out


class Dimension:
    """Lesezugriff auf die Regionsdateien einer Dimension, mit kleinem Chunk-Zwischenspeicher."""

    def __init__(self, ordner: Path, merken: int = 400):
        self.ordner, self.max = Path(ordner), merken
        self._regionen: dict = {}
        self._chunks: dict = {}
        self.lz4 = 0
        self.zu_alt = 0

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.schliessen()

    def schliessen(self) -> None:
        for r in self._regionen.values():
            if r:
                r[0].close()
        self._regionen.clear()

    def _region(self, rx: int, rz: int):
        if (rx, rz) not in self._regionen:
            r = None
            try:
                f = open(self.ordner / f"r.{rx}.{rz}.mca", "rb")  # nur lesen – die Welt wird nie verändert
                kopf = f.read(4096)
                if len(kopf) == 4096:
                    r = (f, kopf)
                else:
                    f.close()
            except OSError:
                pass
            self._regionen[(rx, rz)] = r
        return self._regionen[(rx, rz)]

    def chunk_nbt(self, cx: int, cz: int) -> dict | None:
        """Roh-NBT eines Chunks oder None, wenn er nie erzeugt wurde."""
        r = self._region(cx >> 5, cz >> 5)
        if not r:
            return None
        f, kopf = r
        i = 4 * ((cx & 31) + (cz & 31) * 32)
        sektor = int.from_bytes(kopf[i:i + 3], "big")
        if sektor < 2 or not kopf[i + 3]:
            return None
        f.seek(sektor * 4096)
        kopf5 = f.read(5)
        if len(kopf5) < 5:
            raise ValueError("Chunk abgeschnitten")
        laenge, art = int.from_bytes(kopf5[:4], "big"), kopf5[4]
        if art & 0x80:  # zu groß für die Region → eigene Datei c.X.Z.mcc
            roh = (self.ordner / f"c.{cx}.{cz}.mcc").read_bytes()
            art &= 0x7F
        else:
            roh = f.read(max(0, laenge - 1))
        if art == 2:
            roh = zlib.decompress(roh)
        elif art == 1:
            roh = gzip.decompress(roh)
        elif art == 4:
            self.lz4 += 1
            raise ValueError("LZ4-Kompression wird nicht unterstützt")
        elif art != 3:
            raise ValueError(f"unbekannte Kompression {art}")
        return nbt_lesen(roh)

    def chunk(self, cx: int, cz: int, merken: bool = True) -> "_Chunk | None":
        if (cx, cz) in self._chunks:
            return self._chunks[(cx, cz)]
        root = self.chunk_nbt(cx, cz)
        ab = chunk_abschnitte(root) if root is not None else None
        if root is not None and ab is None:
            self.zu_alt += 1
        c = _Chunk(ab) if ab is not None else None
        if merken:
            self.merke(cx, cz, c)
        return c

    def merke(self, cx: int, cz: int, c) -> None:
        while len(self._chunks) >= self.max:
            self._chunks.pop(next(iter(self._chunks)))
        self._chunks[(cx, cz)] = c

    def block(self, x: int, y: int, z: int) -> str | None:
        """Blockname an einer Weltposition; None = unbekannt (Chunk nie erzeugt, kaputt, außerhalb der Welt)."""
        try:
            c = self.chunk(x >> 4, z >> 4)
        except (OSError, ValueError, KeyError, IndexError, EOFError, zlib.error):
            return None
        if c is None or (y >> 4) < c.unten:
            return None
        s = c.abschnitte.get(y >> 4)
        if s is None:
            return "minecraft:air"  # fehlende Abschnitte sind Luft
        try:
            return s.name(((y & 15) << 8) | ((z & 15) << 4) | (x & 15))
        except IndexError:
            return None


# ---------------------------------------------------------------- Welten, Spieler, Dimensionen

DIM_ORDNER = {  # neu (ab 26.1) zuerst, dann alt
    "overworld": ("dimensions/minecraft/overworld/region", "region"),
    "the_nether": ("dimensions/minecraft/the_nether/region", "DIM-1/region"),
    "the_end": ("dimensions/minecraft/the_end/region", "DIM1/region"),
}
DIM_NAME = {"overworld": "Oberwelt", "the_nether": "Nether", "the_end": "End"}


def save_roots() -> list[Path]:
    """Alle saves-Ordner: Minecraft-Launcher, Modrinth, Prism, CurseForge (Windows, Linux, macOS)."""
    appdata = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    home = Path.home()
    roots = [appdata / ".minecraft" / "saves", home / ".minecraft" / "saves",
             home / "Library" / "Application Support" / "minecraft" / "saves"]
    for muster in ((appdata / "ModrinthApp" / "profiles", "*/saves"),
                   (appdata / "PrismLauncher" / "instances", "*/.minecraft/saves"),
                   (appdata / "PrismLauncher" / "instances", "*/minecraft/saves"),
                   (home / "curseforge" / "minecraft" / "Instances", "*/saves")):
        try:
            roots += sorted(muster[0].glob(muster[1]))
        except OSError:
            pass
    return roots


def _welt_info(ordner: Path) -> dict:
    info = {"pfad": ordner, "ordner": ordner.name, "name": ordner.name, "version": "", "zuletzt": 0.0}
    try:
        info["zuletzt"] = (ordner / "level.dat").stat().st_mtime
        data = nbt_lesen((ordner / "level.dat").read_bytes()).get("Data") or {}
        info["name"] = str(data.get("LevelName") or ordner.name)
        info["version"] = str((data.get("Version") or {}).get("Name") or "")
        if data.get("LastPlayed"):
            info["zuletzt"] = data["LastPlayed"] / 1000
    except (OSError, ValueError, EOFError, zlib.error, IndexError, struct.error, AttributeError):
        pass
    return info


def welten() -> list[dict]:
    """Alle Einzelspieler-Welten, zuletzt gespielte zuerst."""
    out, gesehen = [], set()
    for root in save_roots():
        try:
            ordner = [d for d in root.iterdir() if (d / "level.dat").is_file()]
        except OSError:
            continue
        for d in ordner:
            if d.resolve() not in gesehen:
                gesehen.add(d.resolve())
                out.append(_welt_info(d))
    return sorted(out, key=lambda w: -w["zuletzt"])


def welt_finden(name: str | None = None) -> dict:
    name = (name or "").strip()
    if name and ("/" in name or "\\" in name) and (Path(name) / "level.dat").is_file():  # Pfad statt Name
        return _welt_info(Path(name))
    alle = welten()
    if not alle:
        raise DiamantFehler("Keine Minecraft-Welt gefunden (gesucht in .minecraft/saves und den Ordnern von "
                            "Modrinth, Prism und CurseForge). Hast du schon eine Einzelspieler-Welt? Bedrock-Welten "
                            "(Windows-/Handy-Version) gehen nicht – nur Java.")
    if not name:
        return alle[0]
    klein = name.lower()
    for test in (lambda w: klein in (w["ordner"].lower(), w["name"].lower()),
                 lambda w: klein in w["ordner"].lower() or klein in w["name"].lower()):
        treffer = [w for w in alle if test(w)]
        if treffer:
            return treffer[0]
    namen = {w["name"].lower(): w for w in alle} | {w["ordner"].lower(): w for w in alle}
    nah = difflib.get_close_matches(klein, list(namen), n=1, cutoff=0.6)
    if nah:
        return namen[nah[0]]
    raise DiamantFehler(f"Welt „{name}“ nicht gefunden. Vorhanden: " + ", ".join(w["name"] for w in alle[:15]))


def region_ordner(welt: Path, dim: str) -> Path | None:
    for rel in DIM_ORDNER[dim]:
        p = Path(welt) / rel
        try:
            if p.is_dir() and any(p.glob("r.*.mca")):
                return p
        except OSError:
            continue
    return None


def _dim(v) -> str:
    if isinstance(v, int):
        return {-1: "the_nether", 1: "the_end"}.get(v, "overworld")
    v = str(v or "overworld").split(":")[-1]
    return v if v in DIM_ORDNER else "overworld"


def _uuid_text(v) -> str | None:
    if isinstance(v, (tuple, list)) and len(v) == 4:
        h = "".join(f"{x & 0xFFFFFFFF:08x}" for x in v)
        return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"
    if isinstance(v, str) and len(v.replace("-", "")) == 32:
        return v
    return None


def spieler(welt: Path) -> dict:
    """Wo steht der Spieler? → {pos, dim, blick, quelle}. Reihenfolge: level.dat-Spieler (bis 1.21),
    singleplayer_uuid → players/data (ab 26.1), neueste Spielerdatei, Weltspawn."""
    welt = Path(welt)
    try:
        data = nbt_lesen((welt / "level.dat").read_bytes()).get("Data") or {}
    except (OSError, ValueError, EOFError, zlib.error, IndexError, struct.error):
        data = {}
    kandidaten = []
    if isinstance(data.get("Player"), dict):
        kandidaten.append(("Spieler", lambda: data["Player"]))
    ordner = [welt / "players" / "data", welt / "playerdata"]
    uid = _uuid_text(data.get("singleplayer_uuid"))
    if uid:
        for o in ordner:
            kandidaten.append(("Spieler", lambda o=o: nbt_lesen((o / f"{uid}.dat").read_bytes())))
    dateien = []
    for o in ordner:
        try:
            dateien += [p for p in o.glob("*.dat") if p.is_file()]
        except OSError:
            pass
    def alter(p):
        try:
            return -p.stat().st_mtime
        except OSError:
            return 0
    for p in sorted(dateien, key=alter):
        kandidaten.append(("Spieler", lambda p=p: nbt_lesen(p.read_bytes())))
    for quelle, laden in kandidaten:
        try:
            s = laden()
            pos = s.get("Pos")
            if isinstance(pos, list) and len(pos) == 3:
                rot = s.get("Rotation")
                return {"pos": tuple(float(v) for v in pos), "dim": _dim(s.get("Dimension")), "quelle": quelle,
                        "blick": float(rot[0]) if isinstance(rot, list) and rot else None}
        except (OSError, ValueError, EOFError, zlib.error, IndexError, struct.error, AttributeError, TypeError):
            continue
    spawn = data.get("spawn") if isinstance(data.get("spawn"), dict) else {}
    if isinstance(spawn.get("pos"), (tuple, list)) and len(spawn["pos"]) == 3:
        x, y, z = spawn["pos"]
    else:
        x, y, z = data.get("SpawnX", 0), data.get("SpawnY", 64), data.get("SpawnZ", 0)
    return {"pos": (float(x), float(y), float(z)), "dim": _dim(spawn.get("dimension")), "quelle": "Weltspawn",
            "blick": None}


# ---------------------------------------------------------------- Erze

ERZE = {
    "diamant": {"name": "Diamant", "mehrzahl": "Diamanten", "dim": "overworld",
                "bloecke": {"minecraft:diamond_ore", "minecraft:deepslate_diamond_ore"},
                "tipp": "Die meisten Diamanten liegen ganz unten bei Y -58 bis -54 – dort Gänge graben, "
                        "aber Lava ist da unten häufig."},
    "netherit": {"name": "Antiker Schutt", "mehrzahl": "Antiken Schutt (Netherit)", "dim": "the_nether",
                 "bloecke": {"minecraft:ancient_debris"},
                 "tipp": "Antiker Schutt liegt im Nether meist bei Y 13 bis 17 – Betten oder TNT sprengen gut frei."},
    "smaragd": {"name": "Smaragd", "mehrzahl": "Smaragde", "dim": "overworld",
                "bloecke": {"minecraft:emerald_ore", "minecraft:deepslate_emerald_ore"},
                "tipp": "Smaragde gibt es nur in Bergen – je höher, desto mehr."},
    "gold": {"name": "Golderz", "mehrzahl": "Golderz", "dim": "overworld",
             "bloecke": {"minecraft:gold_ore", "minecraft:deepslate_gold_ore"},
             "tipp": "Gold liegt meist um Y -16, in Tafelberg-Biomen (Badlands) auch weit oben."},
    "eisen": {"name": "Eisenerz", "mehrzahl": "Eisenerz", "dim": "overworld",
              "bloecke": {"minecraft:iron_ore", "minecraft:deepslate_iron_ore"},
              "tipp": "Viel Eisen liegt bei Y 16 und in Bergen ganz oben (um Y 232)."},
    "lapis": {"name": "Lapislazuli", "mehrzahl": "Lapislazuli", "dim": "overworld",
              "bloecke": {"minecraft:lapis_ore", "minecraft:deepslate_lapis_ore"},
              "tipp": "Lapislazuli liegt am meisten bei Y 0."},
    "redstone": {"name": "Redstone-Erz", "mehrzahl": "Redstone-Erz", "dim": "overworld",
                 "bloecke": {"minecraft:redstone_ore", "minecraft:deepslate_redstone_ore"},
                 "tipp": "Redstone liegt am meisten ganz unten (Y -58)."},
}
ERZ_NAMEN = {"diamond": "diamant", "diamonds": "diamant", "diamanten": "diamant", "dia": "diamant",
             "dias": "diamant", "netherite": "netherit", "ancient_debris": "netherit", "ancient debris": "netherit",
             "schutt": "netherit",
             "antiker schutt": "netherit", "debris": "netherit", "emerald": "smaragd", "emeralds": "smaragd",
             "smaragde": "smaragd", "golderz": "gold", "iron": "eisen", "eisenerz": "eisen", "lapislazuli": "lapis",
             "lapis lazuli": "lapis", "redstone-erz": "redstone"}


def erz_finden(erz: str | None) -> tuple[str, dict]:
    k = (erz or "diamant").strip().lower().replace("ü", "ue")
    k = ERZ_NAMEN.get(k, k)
    if k not in ERZE:
        raise DiamantFehler(f"Erz „{erz}“ kenne ich nicht. Möglich: {', '.join(ERZE)}.")
    return k, ERZE[k]


# ---------------------------------------------------------------- Suche

RICHTUNGEN = ("Süden", "Südwesten", "Westen", "Nordwesten", "Norden", "Nordosten", "Osten", "Südosten")


def richtung(dx: float, dz: float) -> str:
    """Himmelsrichtung wie in Minecraft: Norden = −Z, Osten = +X."""
    if abs(dx) < 0.5 and abs(dz) < 0.5:
        return "genau hier"
    winkel = math.degrees(math.atan2(-dx, dz)) % 360  # 0° = Süden, 90° = Westen (wie die Blickrichtung im Spiel)
    return RICHTUNGEN[int((winkel + 22.5) // 45) % 8]


def _adern(punkte: set) -> list[list[tuple]]:
    """Erzblöcke, die sich berühren (auch über Ecken), bilden eine Ader."""
    rest, adern = set(punkte), []
    nachbarn = [(a, b, c) for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1) if a or b or c]
    while rest:
        start = rest.pop()
        ader, stapel = [start], [start]
        while stapel:
            x, y, z = stapel.pop()
            for a, b, c in nachbarn:
                n = (x + a, y + b, z + c)
                if n in rest:
                    rest.remove(n)
                    ader.append(n)
                    stapel.append(n)
        adern.append(sorted(ader))
    return adern


def _umgebung(dim: Dimension, ader: list[tuple]) -> tuple[bool, bool]:
    """→ (Lava höchstens 2 Blöcke entfernt, liegt frei an einer Höhle)."""
    teil = set(ader)
    frei = any(dim.block(x + a, y + b, z + c) in LUFT for x, y, z in ader
               for a, b, c in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)))
    gesehen = set()
    for x, y, z in ader:
        for a in range(-2, 3):
            for b in range(-2, 3):
                for c in range(-2, 3):
                    p = (x + a, y + b, z + c)
                    if p not in gesehen and p not in teil:
                        gesehen.add(p)
                        if dim.block(*p) == LAVA:
                            return True, frei
    return False, frei


def suchen(welt: str | None = None, erz: str | None = "diamant", radius: int = 128, x: float | None = None,
           z: float | None = None, y: float | None = None, melden=None) -> dict:
    """Durchsucht die gespeicherten Chunks im Umkreis und gibt die Erz-Adern sortiert nach Entfernung zurück.
    Ohne x/z wird um die Spielerposition gesucht. melden(text) bekommt ab und zu den Fortschritt."""
    t0 = time.time()
    w = welt_finden(welt)
    key, e = erz_finden(erz)
    radius = int(max(16, min(512, radius or 128)))
    sp = spieler(w["pfad"])
    hinweise = []
    if x is not None and z is not None:
        mx, my, mz, quelle = float(x), (float(y) if y is not None else None), float(z), "angegeben"
    else:
        (px, py, pz), quelle = sp["pos"], sp["quelle"]
        mx, my, mz = px, py, pz
        if sp["dim"] != e["dim"]:
            my = None
            if sp["dim"] == "the_end":
                mx = mz = 0.0
                hinweise.append(f"Du bist im End – gesucht wird in der {DIM_NAME[e['dim']]} um X 0, Z 0.")
            elif e["dim"] == "the_nether":
                mx, mz = px / 8, pz / 8
                hinweise.append("Du bist in der Oberwelt – gesucht wird im Nether an der passenden Stelle "
                                "(deine Koordinaten geteilt durch 8). Die Koordinaten unten sind Nether-Koordinaten.")
            else:
                mx, mz = px * 8, pz * 8
                hinweise.append("Du bist im Nether – gesucht wird in der Oberwelt an der passenden Stelle "
                                "(Nether-Koordinaten mal 8).")
        if quelle == "Weltspawn":
            hinweise.append("Deine Position stand nicht in der Welt – gesucht wird um den Weltspawn.")
    ordner = region_ordner(w["pfad"], e["dim"])
    if not ordner:
        raise DiamantFehler(f"In „{w['name']}“ gibt es noch keine gespeicherten Gebiete in der {DIM_NAME[e['dim']]}"
                            f"{' – warst du schon im Nether?' if e['dim'] == 'the_nether' else ''}.")

    ix, iz = math.floor(mx), math.floor(mz)
    chunks = [(cx, cz) for cx in range((ix - radius) >> 4, ((ix + radius) >> 4) + 1)
              for cz in range((iz - radius) >> 4, ((iz + radius) >> 4) + 1)
              if math.hypot(min(max(ix, cx * 16), cx * 16 + 15) - ix, min(max(iz, cz * 16), cz * 16 + 15) - iz) <= radius]
    chunks.sort(key=lambda c: (c[0] >> 5, c[1] >> 5, c))  # Regionsdatei für Regionsdatei
    bloecke = e["bloecke"]
    punkte, da, fehlend, kaputt = set(), set(), set(), 0
    letzte = time.time()
    with Dimension(ordner) as dim:
        for n, (cx, cz) in enumerate(chunks):
            try:
                c = dim.chunk(cx, cz, merken=False)
            except (OSError, ValueError, KeyError, IndexError, EOFError, zlib.error, struct.error, RecursionError):
                kaputt += 1
                continue
            if c is None:
                fehlend.add((cx, cz))
                continue
            da.add((cx, cz))
            treffer = False
            for sy, s in c.abschnitte.items():
                if bloecke.isdisjoint(s.namen):
                    continue
                for i in s.finde(bloecke):
                    bx, by, bz = cx * 16 + (i & 15), sy * 16 + (i >> 8), cz * 16 + ((i >> 4) & 15)
                    if math.hypot(bx - ix, bz - iz) <= radius:
                        punkte.add((bx, by, bz))
                        treffer = True
            if treffer:
                dim.merke(cx, cz, c)  # für den Lava-/Höhlen-Blick gleich wieder gebraucht
            if melden and time.time() - letzte > 1.5:
                letzte = time.time()
                melden(f"Durchsuche Chunks … {n + 1}/{len(chunks)}")
        adern = []
        for ader in _adern(punkte):
            def abstand(p):
                d = (p[0] + 0.5 - mx, p[2] + 0.5 - mz)
                return math.hypot(*d, (p[1] - my) if my is not None else 0)
            ziel = min(ader, key=abstand)
            lava, frei = _umgebung(dim, ader)
            adern.append({"anzahl": len(ader), "ziel": ziel, "bloecke": ader, "abstand": round(abstand(ziel)),
                          "mitte": (sum(p[0] for p in ader) / len(ader) + 0.5, sum(p[2] for p in ader) / len(ader) + 0.5),
                          "richtung": richtung(ziel[0] + 0.5 - mx, ziel[2] + 0.5 - mz),
                          "hoehe": (ziel[1] - math.floor(my)) if my is not None else None, "lava": lava, "frei": frei})
        lz4, zu_alt = dim.lz4, dim.zu_alt
    adern.sort(key=lambda a: (a["abstand"], -a["anzahl"]))
    if lz4:
        hinweise.append(f"{_chunks(lz4)} mit LZ4 gepackt (Server-Einstellung) – das kann ich nicht lesen.")
    if zu_alt:
        hinweise.append(f"{_chunks(zu_alt)} aus Minecraft vor 1.13 und seitdem nie geladen – übersprungen.")
    if kaputt - lz4 > 0:
        hinweise.append(f"{_chunks(kaputt - lz4)} nicht lesbar (gerade beim Speichern?) – übersprungen.")
    return {"welt": w["name"], "pfad": str(w["pfad"]), "version": w["version"], "erz": key, "erz_info": e,
            "dim": e["dim"], "mitte": (mx, my, mz), "quelle": quelle, "spieler_dim": sp["dim"],
            "blick": sp["blick"] if quelle == "Spieler" and sp["dim"] == e["dim"] else None, "radius": radius,
            "chunks": len(da), "fehlend": len(fehlend), "adern": adern, "erze": len(punkte), "hinweise": hinweise,
            "_da": da, "_fehlend": fehlend, "sekunden": round(time.time() - t0, 1)}


def _chunks(n: int) -> str:
    return f"{n} Chunk ist" if n == 1 else f"{n} Chunks sind"


def _koord(p) -> str:
    return f"X {p[0]} Y {p[1]} Z {p[2]}"


def bericht(erg: dict, max_adern: int = 10) -> str:
    """Kurzer Text für Nova/Konsole: die nächsten Adern mit Koordinaten, Weg und Warnungen."""
    e, (mx, my, mz) = erg["erz_info"], erg["mitte"]
    wo = {"Spieler": "deine Position", "Weltspawn": "Weltspawn", "angegeben": "angegebene Stelle"}[erg["quelle"]]
    zeilen = [f"{e['name']}-Suche in „{erg['welt']}“{' (' + erg['version'] + ')' if erg['version'] else ''}, "
              f"{DIM_NAME[erg['dim']]}",
              f"Mitte: X {math.floor(mx)}{f' Y {math.floor(my)}' if my is not None else ''} Z {math.floor(mz)} ({wo}), "
              f"Umkreis {erg['radius']} Blöcke – {erg['chunks']} Chunks gelesen"
              + (f", {erg['fehlend']} davon noch nie geladen" if erg["fehlend"] else "") + f" ({erg['sekunden']} s)."]
    zeilen += erg["hinweise"]
    if not erg["adern"]:
        zeilen.append(f"Keine {e['mehrzahl']} in den gespeicherten Chunks gefunden. {e['tipp']}")
        return "\n".join(zeilen)
    zeilen.append(f"Gefunden: {len(erg['adern'])} Adern mit {erg['erze']} Erzblöcken. Die nächsten:")
    for i, a in enumerate(erg["adern"][:max_adern], 1):
        weg = f"{a['abstand']} Blöcke"
        weg += f" nach {a['richtung']}" if a["richtung"] != "genau hier" else " (direkt hier)"
        if a["hoehe"] is not None:
            weg += f", {abs(a['hoehe'])} {'tiefer' if a['hoehe'] < 0 else 'höher'}" if a["hoehe"] else ", auf deiner Höhe"
        extra = (" ⚠ Lava daneben!" if a["lava"] else "") + (" – liegt frei an einer Höhle" if a["frei"] else "")
        zeilen.append(f"{i}. {_koord(a['ziel'])} – {a['anzahl']} {'Erz' if a['anzahl'] == 1 else 'Erze'}, {weg}{extra}")
    if len(erg["adern"]) > max_adern:
        zeilen.append(f"… und {len(erg['adern']) - max_adern} weitere.")
    if any(a["lava"] for a in erg["adern"][:max_adern]):
        zeilen.append("Bei ⚠ vorsichtig von der Seite graben und Wassereimer mitnehmen.")
    return "\n".join(zeilen)


# ---------------------------------------------------------------- Karte (PNG ohne Zusatzpakete)

_SCHRIFT = {
    "0": ("111", "101", "101", "101", "111"), "1": ("010", "110", "010", "010", "111"),
    "2": ("111", "001", "111", "100", "111"), "3": ("111", "001", "111", "001", "111"),
    "4": ("101", "101", "111", "001", "001"), "5": ("111", "100", "111", "001", "111"),
    "6": ("111", "100", "111", "101", "111"), "7": ("111", "001", "010", "010", "010"),
    "8": ("111", "101", "111", "101", "111"), "9": ("111", "101", "111", "001", "111"),
    "N": ("10001", "11001", "10101", "10011", "10001"), "S": ("01111", "10000", "01110", "00001", "11110"),
    "O": ("01110", "10001", "10001", "10001", "01110"), "W": ("10001", "10001", "10101", "10101", "01010"),
    " ": ("00",) * 5,
}


class _Bild:
    def __init__(self, w: int, h: int, farbe: tuple):
        self.w, self.h = w, h
        self.px = bytearray(bytes(farbe) * (w * h))

    def rechteck(self, x0, y0, x1, y1, f):
        x0, y0 = max(0, int(x0)), max(0, int(y0))
        x1, y1 = min(self.w, int(x1)), min(self.h, int(y1))
        if x1 > x0:
            zeile = bytes(f) * (x1 - x0)
            for y in range(y0, y1):
                i = (y * self.w + x0) * 3
                self.px[i:i + len(zeile)] = zeile

    def punkt(self, x, y, f):
        x, y = int(x), int(y)
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * 3
            self.px[i:i + 3] = bytes(f)

    def form(self, cx, cy, r, f, raute=False):
        """Gefüllter Kreis oder Raute (Diamant-Form) mit Radius r."""
        for dy in range(-int(r), int(r) + 1):
            for dx in range(-int(r), int(r) + 1):
                if (abs(dx) + abs(dy) <= r) if raute else (dx * dx + dy * dy <= r * r + r * 0.6):
                    self.punkt(cx + dx, cy + dy, f)

    def ring(self, cx, cy, r, f):
        for i in range(int(2 * math.pi * r * 1.5) + 8):
            a = 2 * math.pi * i / (int(2 * math.pi * r * 1.5) + 8)
            self.punkt(cx + r * math.cos(a), cy + r * math.sin(a), f)

    def linie(self, x0, y0, x1, y1, f, dicke=1):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(n + 1):
            x, y = x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n
            self.form(round(x), round(y), dicke / 2, f) if dicke > 1 else self.punkt(round(x), round(y), f)

    def text(self, x, y, s, f, g=2, schatten=(0, 0, 0)):
        for farbe, d in (((schatten, 1),) if schatten else ()) + ((f, 0),):
            cx = x
            for ch in str(s):
                zeichen = _SCHRIFT.get(ch, _SCHRIFT[" "])
                for zy, reihe in enumerate(zeichen):
                    for zx, bit in enumerate(reihe):
                        if bit == "1":
                            self.rechteck(cx + zx * g + d, y + zy * g + d, cx + (zx + 1) * g + d, y + (zy + 1) * g + d, farbe)
                cx += (len(zeichen[0]) + 1) * g

    @staticmethod
    def textbreite(s, g=2) -> int:
        return sum((len(_SCHRIFT.get(ch, _SCHRIFT[" "])[0]) + 1) * g for ch in str(s)) - g

    def png(self) -> bytes:
        zeilen = b"".join(b"\x00" + bytes(self.px[y * self.w * 3:(y + 1) * self.w * 3]) for y in range(self.h))

        def teil(art, daten):
            return (struct.pack(">I", len(daten)) + art + daten
                    + struct.pack(">I", zlib.crc32(art + daten) & 0xFFFFFFFF))
        return (b"\x89PNG\r\n\x1a\n" + teil(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 2, 0, 0, 0))
                + teil(b"IDAT", zlib.compress(zeilen, 9)) + teil(b"IEND", b""))


def karte(erg: dict, groesse: int = 560, max_nummern: int = 10) -> bytes:
    """Draufsicht als PNG: Norden oben, du in der Mitte, Adern als Rauten (orange Rand = Lava daneben)."""
    S, M = groesse, 26
    R = erg["radius"]
    mx, _, mz = erg["mitte"]
    k = (S - 2 * M) / (2 * R)
    bild = _Bild(S, S, (16, 18, 22))

    def px(x, z):
        return M + (x - (mx - R)) * k, M + (z - (mz - R)) * k

    for (cx, cz), farbe in [(c, (34, 39, 48)) for c in erg["_da"]] + [(c, (24, 26, 32)) for c in erg["_fehlend"]]:
        x0, y0 = px(cx * 16, cz * 16)
        x1, y1 = px(cx * 16 + 16, cz * 16 + 16)
        bild.rechteck(max(x0, M), max(y0, M), min(x1, S - M), min(y1, S - M), farbe)
        if k * 16 >= 6 and (cx, cz) in erg["_da"]:  # Chunk-Raster
            bild.rechteck(max(x0, M), max(y0, M), min(x1, S - M), min(y0 + 1, S - M), (42, 48, 59))
            bild.rechteck(max(x0, M), max(y0, M), min(x0 + 1, S - M), min(y1, S - M), (42, 48, 59))
    mitte = px(mx, mz)
    bild.ring(*mitte, R * k, (70, 78, 92))
    for a in erg["adern"]:
        for bx, _, bz in a["bloecke"]:
            x, y = px(bx + 0.5, bz + 0.5)
            bild.rechteck(x - max(1, k / 2), y - max(1, k / 2), x + max(1, k / 2), y + max(1, k / 2), (40, 150, 165))
    gezeigt = erg["adern"][:max_nummern]
    for n, a in reversed(list(enumerate(erg["adern"]))):  # die nächsten zuletzt, also obenauf
        x, y = px(*a["mitte"])
        r = 4 + min(a["anzahl"], 10) // 2
        bild.form(x, y, r + 3, (255, 122, 26) if a["lava"] else (8, 40, 46), raute=True)
        bild.form(x, y, r, (94, 240, 255) if n < max_nummern else (60, 170, 185), raute=True)
    # Du (bzw. die Suchmitte) mit Blickrichtung
    if erg["blick"] is not None:
        rad = math.radians(erg["blick"])
        dx, dz = -math.sin(rad), math.cos(rad)  # Minecraft: 0° = Süden (+Z), 90° = Westen (−X)
        bild.linie(*mitte, mitte[0] + dx * 20, mitte[1] + dz * 20, (0, 0, 0), dicke=5)
        bild.linie(*mitte, mitte[0] + dx * 20, mitte[1] + dz * 20, (255, 255, 255), dicke=3)
    if erg["quelle"] == "angegeben":
        bild.linie(mitte[0] - 9, mitte[1], mitte[0] + 9, mitte[1], (255, 255, 255), dicke=3)
        bild.linie(mitte[0], mitte[1] - 9, mitte[0], mitte[1] + 9, (255, 255, 255), dicke=3)
    else:
        bild.form(*mitte, 7, (0, 0, 0))
        bild.form(*mitte, 5, (255, 255, 255))
        bild.form(*mitte, 2, (230, 60, 60))
    for i, a in enumerate(gezeigt, 1):  # Nummern obenauf, passend zur Liste im Text
        x, y = px(*a["mitte"])
        r = 4 + min(a["anzahl"], 10) // 2
        bild.text(int(x + r + 5), int(y - 5), i, (255, 255, 255))
    # Himmelsrichtungen und Maßstab
    hell = (190, 198, 210)
    bild.text(S // 2 - 5, 6, "N", hell)
    bild.text(S // 2 - 5, S - 18, "S", hell)
    bild.text(6, S // 2 - 5, "W", hell)
    bild.text(S - 16, S // 2 - 5, "O", hell)
    laenge = next((b for b in (10, 20, 25, 50, 100, 200, 250) if b * k >= 70), 250)
    x0, y0 = M + 10, S - M - 14
    bild.rechteck(x0, y0, x0 + laenge * k, y0 + 3, hell)
    bild.rechteck(x0, y0 - 4, x0 + 2, y0 + 7, hell)
    bild.rechteck(x0 + laenge * k - 2, y0 - 4, x0 + laenge * k, y0 + 7, hell)
    bild.text(int(x0 + laenge * k + 8), y0 - 3, laenge, hell)
    erg["massstab"] = laenge
    return bild.png()


# ---------------------------------------------------------------- Kommandozeile

def welten_text() -> str:
    alle = welten()
    if not alle:
        return "Keine Minecraft-Welten gefunden."
    zeilen = ["Minecraft-Welten (zuletzt gespielt zuerst):"]
    for w in alle[:30]:
        wann = time.strftime("%d.%m.%Y %H:%M", time.localtime(w["zuletzt"])) if w["zuletzt"] else "?"
        zeilen.append(f"- {w['name']}" + (f" (Ordner „{w['ordner']}“)" if w["ordner"] != w["name"] else "")
                      + (f", Version {w['version']}" if w["version"] else "") + f", zuletzt {wann}")
    return "\n".join(zeilen)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Diamanten (und andere Erze) in deiner Minecraft-Welt finden – nur lesend.")
    ap.add_argument("welt", nargs="?", help="Weltname, Ordnername oder Pfad (Standard: zuletzt gespielt)")
    ap.add_argument("--erz", default="diamant", help=", ".join(ERZE))
    ap.add_argument("--radius", type=int, default=128, help="Blöcke um die Mitte (16–512, Standard 128)")
    ap.add_argument("--x", type=float)
    ap.add_argument("--z", type=float)
    ap.add_argument("--y", type=float)
    ap.add_argument("--karte", help="Karte als PNG speichern")
    ap.add_argument("--alle", action="store_true", help="alle Adern auflisten")
    ap.add_argument("--welten", action="store_true", help="nur die gefundenen Welten auflisten")
    a = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    try:
        if a.welten:
            print(welten_text())
            return 0
        erg = suchen(a.welt, a.erz, a.radius, a.x, a.z, a.y, melden=lambda t: print(t, file=sys.stderr))
        print(bericht(erg, 10_000 if a.alle else 10))
        if a.karte:
            Path(a.karte).write_bytes(karte(erg))
            print(f"Karte: {a.karte} (Norden oben, Balken = {erg['massstab']} Blöcke)")
    except DiamantFehler as e:
        print(f"Fehler: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
