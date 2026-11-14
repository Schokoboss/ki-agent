# Fortschritt

Stand wird nach jedem Teilschritt aktualisiert. Vor dem Weiterarbeiten nach einer Unterbrechung
zuerst `docs/PLAN.md` und diese Datei lesen.

## Erledigt
- Projektgerüst (Vite, TypeScript strict, Vitest), Plan und Entscheidungen.
- **Phase 1 (Fundament)**: eigene Fahrphysik (`src/physik/fahrzeug.ts`: Starrkörper, Federung je Rad,
  Reifenkennlinie mit kombiniertem Schlupf, implizite Raddrehzahl, Motor/Getriebe/Differenziale,
  ABS/TCS/ESP/Lenkhilfe mit Driftwinkel-Begrenzung), Fahrwerte-Ableitung aus Stammdaten + Tuning,
  9 Physiktests grün. Browser: Spielschleife (120 Hz fest), Eingabe (Tastatur/Gamepad/Touch),
  Renderer mit dynamischer Auflösung, gemeinsame Shader-Umgebung, Himmel, Atmosphäre
  (Tageszeit/Wetter/Jahreszeit), prozedurale Karosserien + Lack-Shader, Verfolgerkamera,
  Touch-Steuerung, Tacho, Teststrecke. Im Headless-Browser gefahren und Bildschirmfotos geprüft.
- Werkzeuge: `werkzeuge/browser.mjs` (Headless-Helfer), `fahrtest.mjs`, `autoschau.mjs`, `png.ts`.

## In Arbeit
- **Phase 2 (Welt)** – erledigt: Geländeform, Weltkarte (1025²-Raster, geschichtete Bodenabfrage für
  Brücken/Tunnel/Eis), Straßennetz-Generator (A*, Höhenprofil, Überhöhung, 93 Abschnitte, 95 km,
  2 Tunnel, Südkap-Brücke, Wattweg als Furt), Kachel-Streaming mit 4 Detailstufen + Fernnetz,
  Gelände-/Straßen-/Wasser-Shader, Brücken- und Tunnelbauwerke, Vegetation (verschmolzen je Kachel),
  zerstörbare Requisiten (Instanzen), Objektverwaltung, Kollisionen (`physik/kollision.ts`,
  `welt/weltkollision.ts`), Schadensmodell, `physik/physikwelt.ts` als Simulationskern.
  Gemessen: 22 µs je Auto und Physikschritt (12 Autos = 3 % Echtzeit in Node).
- Noch offen in Phase 2: Physikwelt in `spiel.ts` einhängen, Partikel/Reifenspuren, Gebäude
  (Hafenstadt, Festival, Dörfer), Regen/Schnee-Partikel, Tunnel-Abdunklung, Audio.

## Offen
- Phasen 3–7 laut docs/PLAN.md (Rennen/KI/HUD, Fuhrpark/Tuning/Karriere, Jahreszeiten/Verkehr/
  Sammelbares/Editor/Fotomodus/Radio, Mehrspieler, Feinschliff).
- Bisher nur 6 von 24+ Autos angelegt (je eines pro Klasse).
- Audio fehlt noch vollständig.

## Bekannte Fehler
- Lenkhilfe „stark“: Driftwinkel pendelt bei Dauer-Vollgas um ±5° (haltbar, aber unruhig).

## Nächster Schritt
- `spiel.ts` auf `Physikwelt` umstellen (Spieler als Teilnehmer, Ereignisse → Kamera/Vibration/Schaden),
  dann Partikel, Gebäude, Wetterpartikel, Audio; danach Phase 3 (Rennen, KI, HUD).
