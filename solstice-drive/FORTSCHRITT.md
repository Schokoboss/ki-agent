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
- **Phase 2 (Welt)**: Geländeform (`src/welt/gelaendeform.ts`) und Regionsdaten stehen.
  Als Nächstes: Weltkarte (Höhenraster, Bodenabfrage mit Schichten), Straßennetz (A*-Trassierung,
  Höhenprofil, Brücken/Tunnel), Kachel-Streaming, Straßen-/Wasser-/Vegetationsdarstellung.

## Offen
- Phasen 3–7 laut docs/PLAN.md (Rennen/KI/HUD, Fuhrpark/Tuning/Karriere, Jahreszeiten/Verkehr/
  Sammelbares/Editor/Fotomodus/Radio, Mehrspieler, Feinschliff).
- Bisher nur 6 von 24+ Autos angelegt (je eines pro Klasse).
- Audio fehlt noch vollständig.

## Bekannte Fehler
- Lenkhilfe „stark“: Driftwinkel pendelt bei Dauer-Vollgas um ±5° (haltbar, aber unruhig).

## Nächster Schritt
- `src/welt/weltkarte.ts` + `src/welt/strassennetz.ts`, Kartenbild mit `werkzeuge/karte-rendern.ts` prüfen.
