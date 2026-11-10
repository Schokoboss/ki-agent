# Entscheidungen

Kurz begründete Entscheidungen, in der Reihenfolge, in der sie gefallen sind.

## E1 – Eigener Unterordner statt eigenes Repository
Der Auftrag verlangt ein eigenes Repository. In der Arbeitssitzung stand nur das Repository
`ki-agent` zur Verfügung, neue Repositories konnten nicht angelegt werden. Das Spiel liegt deshalb
vollständig eigenständig in `solstice-drive/` (eigene `package.json`, keine Abhängigkeit zum Rest).
Der Ordner lässt sich jederzeit mit `git subtree split --prefix=solstice-drive` in ein eigenes
Repository auslagern.

## E2 – Eigene Fahrphysik statt Rapier
Die Aufgabe erlaubt eine Physik-Engine nach Wahl. Gewählt: eigene, spezialisierte Fahrzeugphysik
(Starrkörper mit sechs Freiheitsgraden, Radaufhängung per Strahl, Reifenmodell je Rad).
Gründe:
- **Fahrgefühl**: Das Verhalten entsteht im Reifen- und Antriebsmodell, nicht im allgemeinen
  Kollisionslöser. Eine eigene Integration erlaubt implizite Rad-Drehzahl-Integration und exakte
  Kontrolle über Gewichtsverlagerung.
- **Determinismus**: fester Takt, kein WASM, bitgleiche Ergebnisse in Node und Browser – Grundlage
  für Tests, Geister, Rückspulen und den Rauchtest ohne Browser.
- **Welt**: 8×8 km Höhenfeld mit Brücken/Tunneln als geschichtete Bodenabfrage ist analytisch
  billiger als gestreamte Kollisionsgeometrie.
- **Zielgerät**: kein zusätzlicher WASM-Download (~1,5 MB), geringere Ladezeit und Rechenlast am Handy.
Kollisionen (Auto–Auto, Auto–Objekt, Auto–Leitplanke) sind als Impulslöser auf einfachen
Formen (Kugeln, Kapseln, orientierte Quader) umgesetzt.

## E3 – Zielgerät Google Pixel 10a
„Mache alles für das Google Pixel 10a“ wird so umgesetzt: Touch-Steuerung ist erstklassig
(nicht nachgerüstet), Querformat, Vollbild/PWA, sichere Ränder, Vibration, Wake-Lock,
dynamische Auflösung und Qualitätsstufen mit Handy-Voreinstellung. Tastatur, Maus und Gamepad
bleiben vollwertig. Alle Bildschirmfotos und Messungen laufen mit Pixel-Querformat-Viewport.

## E4 – Eigene Shader statt Standardmaterialien
Alle Weltmaterialien sind schlanke eigene Shader mit gemeinsamen Uniformen (Sonne, Himmel, Nebel,
Nässe, Jahreszeit). Das spart am Handy Rechenzeit gegenüber PBR-Materialien und hält Tag-Nacht,
Wetter und Jahreszeiten an einer Stelle. Schatten: weiche Kontaktschatten statt Schattenkarten.

## E5 – Welt wird zur Laufzeit deterministisch erzeugt
Höhenkarte (1025², 8 m Raster), Regionen und Straßennetz entstehen beim Laden aus einem festen
Startwert. Keine Binärdateien im Repository, Tests erzeugen dieselbe Welt in Node.
