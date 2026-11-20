"""Diamant-Finder: baut eine kleine Test-Welt (neues Format ab 26.1 + altes Format, alle Kompressionen,
Lava, Höhle, Chunk-/Regionsgrenzen) und prüft Suche, Spielerposition, Karte und das Nova-Werkzeug.
Fasst keine echten Welten an – alles in einem Temp-Ordner.
"""
import gzip
import os
import struct
import sys
import tempfile
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "server"))
import diamonds  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
fails = 0


def check(name, cond, extra=""):
    global fails
    print(("OK    " if cond else "FEHLER") + f" {name}" + (f" – {extra}" if extra else ""))
    fails += 0 if cond else 1


# ---------------------------------------------------------------- kleiner NBT-Schreiber (nur für den Test)

def B(v): return 1, struct.pack(">b", v)
def I(v): return 3, struct.pack(">i", v)
def L(v): return 4, struct.pack(">q", v)
def F(v): return 5, struct.pack(">f", v)
def D(v): return 6, struct.pack(">d", v)
def S(v):
    e = v.encode("utf-8")
    return 8, struct.pack(">H", len(e)) + e
def BA(v): return 7, struct.pack(">i", len(v)) + bytes(v)
def IA(v): return 11, struct.pack(f">i{len(v)}i", len(v), *v)
def LA(v): return 12, struct.pack(f">i{len(v)}q", len(v), *[x - (1 << 64) if x >= 1 << 63 else x for x in v])
def LI(items, et=0):
    et = items[0][0] if items else et
    return 9, bytes([et]) + struct.pack(">i", len(items)) + b"".join(p for _, p in items)
def C(d):
    out = b""
    for k, (t, p) in d.items():
        n = k.encode("utf-8")
        out += bytes([t]) + struct.pack(">H", len(n)) + n + p
    return 10, out + b"\x00"
def datei(root): return b"\x0a\x00\x00" + root[1]


def packen(idx, bits, quer):
    if quer:  # bis 1.15: Werte reichen über Long-Grenzen
        longs = [0] * (bits * 64)
        for i, v in enumerate(idx):
            bit = i * bits
            w, o = bit >> 6, bit & 63
            longs[w] |= (v << o) & ((1 << 64) - 1)
            if o + bits > 64:
                longs[w + 1] |= v >> (64 - o)
    else:
        per = 64 // bits
        longs = [0] * (-(-4096 // per))
        for i, v in enumerate(idx):
            longs[i // per] |= v << ((i % per) * bits)
    return longs


def abschnitt(bloecke: dict, fuell: str, extra_palette=(), quer=False):
    """bloecke: {(x, y, z) lokal 0–15: Name} → (Palette-Liste, Daten-Longs oder None)."""
    pal = [fuell] + [n for n in extra_palette if n != fuell]
    for n in bloecke.values():
        if n not in pal:
            pal.append(n)
    if len(pal) == 1:
        return pal, None
    idx = [0] * 4096
    for (x, y, z), n in bloecke.items():
        idx[(y << 8) | (z << 4) | x] = pal.index(n)
    bits = max(4, (len(pal) - 1).bit_length())
    return pal, packen(idx, bits, quer)


def chunk_neu(cx, cz, bloecke_welt: dict):
    """Chunk im Format ab 1.18 (Y -64 bis 319): Stein oben, Tiefenschiefer unten, Luft ab Y 64."""
    sections = []
    for sy in range(-4, 20):
        lokal = {(x & 15, y & 15, z & 15): n for (x, y, z), n in bloecke_welt.items()
                 if x >> 4 == cx and z >> 4 == cz and y >> 4 == sy}
        fuell = "minecraft:air" if sy >= 4 else "minecraft:deepslate" if sy < 0 else "minecraft:stone"
        extra = [f"minecraft:test_{i}" for i in range(18)] if (cx, cz, sy) == (0, 0, -3) else ()  # 5 Bits
        pal, daten = abschnitt(lokal, fuell, extra)
        bs = {"palette": LI([C({"Name": S(n)}) for n in pal])}
        if daten is not None:
            bs["data"] = LA(daten)
        sections.append(C({"Y": B(sy), "block_states": C(bs),
                           "biomes": C({"palette": LI([S("minecraft:plains")])}),
                           "BlockLight": BA([0] * 2048)}))
    return C({"DataVersion": I(4700), "xPos": I(cx), "zPos": I(cz), "yPos": I(-4), "Status": S("minecraft:full"),
              "sections": LI(sections), "Heightmaps": C({"WORLD_SURFACE": LA([0] * 37)}),
              "block_entities": LI([], 10)})


def chunk_alt(cx, cz, bloecke_welt: dict, dataversion: int, quer: bool):
    """Chunk im Format 1.13 – 1.17 (Level/Sections, Y 0–255)."""
    sections = []
    for sy in range(0, 4):
        lokal = {(x & 15, y & 15, z & 15): n for (x, y, z), n in bloecke_welt.items()
                 if x >> 4 == cx and z >> 4 == cz and y >> 4 == sy}
        extra = [f"minecraft:alt_{i}" for i in range(20)] if quer else ()  # 5 Bits → Werte über Long-Grenzen
        pal, daten = abschnitt(lokal, "minecraft:stone", extra, quer)
        s = {"Y": B(sy), "Palette": LI([C({"Name": S(n), "Properties": C({"x": S("1")})}) for n in pal])}
        if daten is not None:
            s["BlockStates"] = LA(daten)
        sections.append(C(s))
    return C({"DataVersion": I(dataversion), "Level": C({"xPos": I(cx), "zPos": I(cz), "Sections": LI(sections)})})


def region_schreiben(ordner: Path, chunks: dict, art: dict | None = None):
    """chunks: {(cx, cz): NBT-Compound} → r.X.Z.mca (zlib, oder art[(cx,cz)] = 1 gzip, 3 roh, 4 lz4, 130 extern, 99 kaputt)."""
    ordner.mkdir(parents=True, exist_ok=True)
    art = art or {}
    regionen = {}
    for (cx, cz), c in chunks.items():
        regionen.setdefault((cx >> 5, cz >> 5), {})[(cx, cz)] = c
    for (rx, rz), inhalt in regionen.items():
        kopf, koerper, sektor = bytearray(8192), b"", 2
        for (cx, cz), c in inhalt.items():
            roh, a = datei(c), art.get((cx, cz), 2)
            if a == 1:
                daten = gzip.compress(roh)
            elif a == 3:
                daten = roh
            elif a == 4:
                daten = b"LZ4Block" + bytes(20)
            elif a == 130:
                (ordner / f"c.{cx}.{cz}.mcc").write_bytes(zlib.compress(roh))
                daten = b""
            elif a == 99:
                daten, a = b"kaputt" * 10, 2
            else:
                daten = zlib.compress(roh)
            block = struct.pack(">IB", len(daten) + 1, a) + daten
            block += bytes(-len(block) % 4096)
            n = len(block) // 4096
            i = 4 * ((cx & 31) + (cz & 31) * 32)
            kopf[i:i + 4] = sektor.to_bytes(3, "big") + bytes([n])
            koerper += block
            sektor += n
        (ordner / f"r.{rx}.{rz}.mca").write_bytes(bytes(kopf) + koerper)


# ---------------------------------------------------------------- Test-Welten bauen

tmp = Path(tempfile.mkdtemp(prefix="nova-diamanten-"))
saves = tmp / "saves"
uid = (0x12345678, -0x5432110, 0x0BADBEEF, -1)  # Int-Array wie im Spiel
uid_text = diamonds._uuid_text(uid)

neu = saves / "Testwelt"
neu.mkdir(parents=True)
(neu / "level.dat").write_bytes(gzip.compress(datei(C({"Data": C({
    "LevelName": S("Meine Testwelt"), "Version": C({"Name": S("26.3")}), "LastPlayed": L(1_900_000_000_000),
    "singleplayer_uuid": IA(list(uid))})}))))
(neu / "players" / "data").mkdir(parents=True)
(neu / "players" / "data" / f"{uid_text}.dat").write_bytes(gzip.compress(datei(C({
    "Pos": LI([D(8.5), D(-50.0), D(8.5)]), "Dimension": S("minecraft:overworld"), "Rotation": LI([F(180.0), F(0.0)])}))))
# eine fremde, ältere Spielerdatei darf nicht gewinnen
(neu / "players" / "data" / "00000000-0000-0000-0000-000000000001.dat").write_bytes(gzip.compress(datei(C({
    "Pos": LI([D(999.0), D(70.0), D(999.0)]), "Dimension": S("minecraft:overworld")}))))

bloecke = {
    # Ader A: 3 Erze, Lava 2 Blöcke daneben (nicht direkt dran)
    (20, -58, 5): "minecraft:deepslate_diamond_ore", (21, -58, 5): "minecraft:deepslate_diamond_ore",
    (21, -57, 5): "minecraft:deepslate_diamond_ore", (23, -58, 5): "minecraft:lava",
    # Ader B: über Chunk- UND Regionsgrenze (x = 0 | x = -1), oben drüber Höhlenluft
    (0, -40, 3): "minecraft:deepslate_diamond_ore", (-1, -40, 3): "minecraft:deepslate_diamond_ore",
    (0, -39, 3): "minecraft:cave_air",
    # Ader C: einzelnes Erz in normalem Stein, weiter weg, in gzip-Chunk
    (85, 10, 90): "minecraft:diamond_ore",
    # Ader D: außerhalb von 128 Blöcken
    (320, -58, 5): "minecraft:deepslate_diamond_ore",
    # Ader E: im Abschnitt mit 5-Bit-Palette
    (3, -45, 12): "minecraft:deepslate_diamond_ore",
    # Ader F: im extern gespeicherten Chunk (.mcc)
    (40, -20, -30): "minecraft:deepslate_diamond_ore",
    # Ader G: im unkomprimierten Chunk
    (-20, -55, 40): "minecraft:deepslate_diamond_ore",
    # nur Lava (kein Erz) – darf nicht zählen
    (10, -58, 10): "minecraft:lava",
    # Smaragd
    (6, 30, 6): "minecraft:emerald_ore",
}
chunks = {(cx, cz): chunk_neu(cx, cz, bloecke) for cx in range(-3, 9) for cz in range(-3, 9)
          if (cx, cz) not in ((7, 7), (8, 8), (-3, -3))}  # ein paar Chunks nie erzeugt
chunks[(20, 0)] = chunk_neu(20, 0, bloecke)
chunks[(6, 6)] = chunk_alt(6, 6, {(96, 20, 96): "minecraft:diamond_ore"}, 2586, quer=False)  # 1.16, nie neu geladen
chunks[(6, 5)] = chunk_alt(6, 5, {(101, 21, 85): "minecraft:diamond_ore"}, 1976, quer=True)  # 1.14: Werte quer
chunks[(-2, 6)] = C({"DataVersion": I(1343), "Level": C({"Sections": LI([C({"Y": B(0), "Blocks": BA([56] * 4096)})])})})  # 1.12
arten = {(5, 5): 1, (-2, 2): 3, (2, -2): 130, (4, -2): 4, (-1, 5): 99}
region_schreiben(neu / "dimensions" / "minecraft" / "overworld" / "region", chunks, arten)
region_schreiben(neu / "dimensions" / "minecraft" / "the_nether" / "region",
                 {(0, 0): chunk_neu(0, 0, {(2, 15, 1): "minecraft:ancient_debris", (3, 15, 1): "minecraft:ancient_debris"})})

alt = saves / "Alte Welt"
alt.mkdir(parents=True)
(alt / "level.dat").write_bytes(gzip.compress(datei(C({"Data": C({
    "LevelName": S("Alte Welt"), "Version": C({"Name": S("1.20.4")}), "LastPlayed": L(1_700_000_000_000),
    "Player": C({"Pos": LI([D(-100.5), D(12.0), D(-100.5)]), "Dimension": S("minecraft:the_nether"),
                 "Rotation": LI([F(-90.0), F(0.0)])})})}))))
region_schreiben(alt / "region", {(-6, -6): chunk_neu(-6, -6, {(-90, -58, -90): "minecraft:diamond_ore"})})
region_schreiben(alt / "DIM-1" / "region", {(-6, -6): chunk_neu(-6, -6, {(-90, 14, -95): "minecraft:ancient_debris"})})

diamonds.save_roots = lambda: [saves, tmp / "gibts-nicht"]

# ---------------------------------------------------------------- Tests

alle = diamonds.welten()
check("Welten gefunden, zuletzt gespielte zuerst", [w["name"] for w in alle] == ["Meine Testwelt", "Alte Welt"],
      str([w["name"] for w in alle]))
check("Welt per Teilname", diamonds.welt_finden("alte")["name"] == "Alte Welt")
check("Welt per Tippfehler", diamonds.welt_finden("Meine Tesstwelt")["name"] == "Meine Testwelt")
try:
    diamonds.welt_finden("Gibtsnicht 123")
    check("Unbekannte Welt → Fehler", False)
except diamonds.DiamantFehler as e:
    check("Unbekannte Welt → Fehler mit Liste", "Meine Testwelt" in str(e))

sp = diamonds.spieler(neu)
check("26.x: Spieler über singleplayer_uuid", sp["pos"] == (8.5, -50.0, 8.5) and sp["quelle"] == "Spieler", str(sp))
sp_alt = diamonds.spieler(alt)
check("Alt: Spieler aus level.dat (Nether)", sp_alt["pos"][0] == -100.5 and sp_alt["dim"] == "the_nether", str(sp_alt))

meldungen = []
erg = diamonds.suchen(None, "diamant", 128, melden=meldungen.append)
ziele = [a["ziel"] for a in erg["adern"]]
print("   Adern:", [(a["ziel"], a["anzahl"], a["abstand"], a["lava"], a["frei"]) for a in erg["adern"]])
check("Mitte = Spieler", erg["mitte"] == (8.5, -50.0, 8.5) and erg["quelle"] == "Spieler")
check("Ader über Chunk-/Regionsgrenze ist EINE Ader", any(a["anzahl"] == 2 and set(a["bloecke"]) == {(0, -40, 3), (-1, -40, 3)}
                                                          for a in erg["adern"]))
a_ader = next((a for a in erg["adern"] if (20, -58, 5) in a["bloecke"]), None)
check("Ader A: 3 Erze, Lava-Warnung, nicht frei", a_ader and a_ader["anzahl"] == 3 and a_ader["lava"] and not a_ader["frei"],
      str(a_ader and (a_ader["anzahl"], a_ader["lava"], a_ader["frei"])))
b_ader = next((a for a in erg["adern"] if (0, -40, 3) in a["bloecke"]), None)
check("Ader B: frei an Höhle, keine Lava", b_ader and b_ader["frei"] and not b_ader["lava"])
check("5-Bit-Palette gelesen", (3, -45, 12) in ziele)
check("gzip-Chunk gelesen", (85, 10, 90) in ziele)
check("Externer Chunk (.mcc) gelesen", (40, -20, -30) in ziele)
check("Unkomprimierter Chunk gelesen", (-20, -55, 40) in ziele)
check("1.16-Chunk (Level/Sections) gelesen", (96, 20, 96) in ziele)
check("1.14-Chunk (Werte über Long-Grenzen) gelesen", (101, 21, 85) in ziele)
check("Außerhalb des Radius nicht dabei", (320, -58, 5) not in ziele)
check("Sortiert nach Entfernung", [a["abstand"] for a in erg["adern"]] == sorted(a["abstand"] for a in erg["adern"]))
check("Nächste Ader zuerst (3D-Abstand)", erg["adern"][0]["ziel"] == (3, -45, 12) and erg["adern"][1] is b_ader,
      str(erg["adern"][0]["ziel"]))
check("Genau 8 Adern / 11 Erze", (len(erg["adern"]), erg["erze"]) == (8, 11), f"{len(erg['adern'])} / {erg['erze']}")
check("Fehlende Chunks gezählt", erg["fehlend"] >= 3, str(erg["fehlend"]))
text = diamonds.bericht(erg)
print("   " + text.replace("\n", "\n   "))
check("Bericht: LZ4-Hinweis", "LZ4" in text)
check("Bericht: kaputter Chunk", "nicht lesbar" in text)
check("Bericht: Chunk vor 1.13", "vor 1.13" in text)
check("Bericht: Richtung + Höhe", "Blöcke nach" in text and "tiefer" in text)
check("Bericht: Lava-Warnung", "⚠ Lava" in text)
check("Richtung: Norden = −Z, Osten = +X", (diamonds.richtung(0, -5), diamonds.richtung(5, 0), diamonds.richtung(3, 3))
      == ("Norden", "Osten", "Südosten"))

weit = diamonds.suchen("Testwelt", "diamant", 900)
check("Radius auf 512 begrenzt", weit["radius"] == 512)
check("Großer Radius findet die ferne Ader", (320, -58, 5) in [a["ziel"] for a in weit["adern"]])

stelle = diamonds.suchen("Testwelt", "dia", 20, x=85, z=90)
check("Suche um angegebene Stelle", stelle["adern"] and stelle["adern"][0]["ziel"] == (85, 10, 90)
      and stelle["adern"][0]["hoehe"] is None)

smaragd = diamonds.suchen("Testwelt", "emerald", 64)
check("Anderes Erz (Smaragd)", [a["ziel"] for a in smaragd["adern"]] == [(6, 30, 6)])

nether = diamonds.suchen("Testwelt", "netherite", 64)
check("Netherit aus der Oberwelt: Mitte /8 im Nether", nether["mitte"][0] == 8.5 / 8 and nether["dim"] == "the_nether"
      and [a["anzahl"] for a in nether["adern"]] == [2], str(nether["mitte"]))
check("Netherit: Hinweis Nether-Koordinaten", any("Nether-Koordinaten" in h for h in nether["hinweise"]))

alt_dia = diamonds.suchen("Alte Welt", "diamant", 128)
check("Alte Ordner + Spieler im Nether → Oberwelt ×8", alt_dia["mitte"][0] == -804.0 and alt_dia["adern"] == []
      and any("Nether" in h for h in alt_dia["hinweise"]), str(alt_dia["mitte"]))
alt_dia2 = diamonds.suchen("Alte Welt", "diamant", 64, x=-90, z=-90)
check("Alte Ordnerstruktur (region/)", [a["ziel"] for a in alt_dia2["adern"]] == [(-90, -58, -90)])
alt_net = diamonds.suchen("Alte Welt", "netherit", 64)
check("Alte Ordnerstruktur (DIM-1/) + Blick nur in gleicher Dimension",
      [a["ziel"] for a in alt_net["adern"]] == [(-90, 14, -95)] and alt_net["blick"] == -90.0)
try:
    diamonds.suchen("Testwelt", "gold", 32, x=0, z=0) and diamonds.suchen("Testwelt", "kartoffel")
    check("Unbekanntes Erz → Fehler", False)
except diamonds.DiamantFehler as e:
    check("Unbekanntes Erz → Fehler", "diamant" in str(e))

png = diamonds.karte(erg)
w, h = struct.unpack(">II", png[16:24])
idat = b"".join(png[i + 8:i + 8 + struct.unpack(">I", png[i:i + 4])[0]] for i in
                [k - 4 for k in range(len(png)) if png[k:k + 4] == b"IDAT"])
check("Karte ist gültiges PNG", png[:8] == b"\x89PNG\r\n\x1a\n" and (w, h) == (560, 560)
      and len(zlib.decompress(idat)) == h * (1 + w * 3))
(tmp / "karte.png").write_bytes(png)
print(f"   Karte: {tmp / 'karte.png'}")

# Kommandozeile
rc = diamonds.main(["Testwelt", "--radius", "64", "--karte", str(tmp / "cli.png")])
check("Kommandozeile läuft", rc == 0 and (tmp / "cli.png").is_file())

# Nur gelesen: keine Datei in den Welten verändert
check("Welt-Dateien unverändert (nur gelesen)", all(p.stat().st_mtime <= (tmp / "karte.png").stat().st_mtime
                                                     for p in saves.rglob("*") if p.is_file())
      and not any(p.suffix in (".lock", ".tmp") for p in saves.rglob("*")))

# ---------------------------------------------------------------- Nova-Werkzeug
if sys.platform != "win32":  # Fernsteuerung braucht Windows – für diesen Test reicht ein Platzhalter
    import types
    _remote = types.ModuleType("remote")
    _remote.RemoteError = type("RemoteError", (Exception,), {})
    _remote.__getattr__ = lambda name: (lambda *a, **k: None)
    sys.modules.setdefault("remote", _remote)
import agent_server as s  # noqa: E402
import permissions  # noqa: E402
import tools  # noqa: E402

s.UPLOADS = tmp / "uploads"
s.WORKSPACE = tmp / "workspace"
s.CTX = tools.ToolContext(s.WORKSPACE, tmp / "memory.json", sys.executable)


class FakeRun:
    def __init__(self):
        self.events, self.tool_extra, self.current_call = [], {}, "c1"

    def emit(self, **ev):
        self.events.append(ev)


s.minecraft.minecraft_running = lambda: False  # echte Prüfung nutzt tasklist (Windows)
run = FakeRun()
out = s.tool_minecraft_diamonds(run, {"radius": 64})
bilder = [e for e in run.events if e.get("t") == "image"]
check("Werkzeug: Text mit Koordinaten", "X 0 Y -40 Z 3" in out, out[:200])
check("Werkzeug: Karte als Bild im Chat", bilder and (s.UPLOADS / bilder[0]["id"]).is_file()
      and run.tool_extra.get("c1", {}).get("_image") == bilder[0]["id"])
check("Werkzeug: Karte im Arbeitsordner", any((s.WORKSPACE / "Minecraft").glob("*.png")))
s.minecraft.minecraft_running = lambda: True
check("Werkzeug: Hinweis, wenn Minecraft läuft", "nächsten Speichern" in s.tool_minecraft_diamonds(FakeRun(), {"radius": 16}))
s.minecraft.minecraft_running = lambda: False
check("Werkzeug: Welten-Liste", "Meine Testwelt" in s.tool_minecraft_diamonds(FakeRun(), {"action": "worlds"}))
try:
    s.tool_minecraft_diamonds(FakeRun(), {"world": "gibtsnicht-xyz"})
    check("Werkzeug: Fehler bei unbekannter Welt", False)
except ValueError as e:
    check("Werkzeug: Fehler bei unbekannter Welt", "nicht gefunden" in str(e))
check("Werkzeug ist in der Gruppe minecraft", "minecraft_diamonds" in s.TOOL_GROUPS["minecraft"])
check("Gruppe kommt bei „Diamanten“", "minecraft" in s.pick_groups({"messages": [{"role": "user", "content": "wo sind diamanten?"}]}))
check("Rechte: Weltname → immer erlaubt", permissions.einteilen("minecraft_diamonds", {"world": "Testwelt"}, s.CTX)[0] is None)
check("Rechte: Pfad → Dateien außerhalb", permissions.einteilen("minecraft_diamonds", {"world": str(neu)}, s.CTX)[0] == "dateien_aussen")
check("Spec vorhanden", any(t["function"]["name"] == "minecraft_diamonds" for t in tools.TOOL_SPECS))

print(f"\n{'Alles OK' if not fails else f'{fails} FEHLER'} – Diamant-Finder")
sys.exit(1 if fails else 0)
