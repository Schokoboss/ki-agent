# SOLSTICE DRIVE – Plan

Open-World-Arcade-Rennspiel rund um das fiktive Auto- und Musikfestival „Solstice“ auf der
erfundenen Inselgruppe **Kap Aurora**. Zielgerät: **Google Pixel 10a** (Chrome, Querformat,
Touch), zusätzlich Laptop mit Tastatur/Maus/Gamepad.

## Leitlinie
Das Fahrgefühl entscheidet. Bei Konflikten zwischen Inhalt und Fahrgefühl gewinnt das Fahrgefühl.

## Architektur (Kurzfassung, Details in docs/ARCHITEKTUR.md)

```
src/
  engine/       Spielschleife (fester Physiktakt), Eingabe, Mathe, Zufall/Rauschen, Renderer, Kamera
  physik/       Fahrzeugphysik (Starrkörper, Reifenmodell je Rad, Antrieb, Kollisionen), Untergründe
  fahrzeuge/    Daten (Autos, Teile), prozedurale Karosserien, Lack, Tuning-Berechnung
  welt/         Generator (Höhenkarte, Regionen, Straßennetz), Kacheln/Streaming, Vegetation, Himmel, Wetter
  ki/           Rennfahrer-KI, Ideallinie, Verkehr, Rivalen
  events/       Renntypen, Rennlogik, Geister, Wiederholung, Rückspulen, Eventdaten
  fortschritt/  Spielstand, Karriere, Skill-System, Sammelbares, Wochenaufgaben
  ui/           HUD, Menüs, Karte, Garage, Autohaus, Einstellungen, Touch-Steuerung, i18n
  audio/        Motorsynthese, Reifen/Wind/Umgebung, Radiosender
  netz/         Mehrspieler-Client, Protokoll
server/         Node-WebSocket-Server (Räume, Rennen, Bestenlisten, Geister, Strecken)
werkzeuge/      Build- und Prüfwerkzeuge (Karte rendern, Icons, Balance, Fahrtest, Bildraten-Messung)
tests/          Vitest-Tests (Physik, Welt, KI, Fortschritt, Speichern, Netz, Rauchtest Rennen)
```

Grundsatz: **Simulation (physik, welt-Daten, ki, events, fortschritt) ist frei von DOM und Three.js**
und läuft unverändert in Node. Darstellung, UI und Audio hängen nur lesend an der Simulation.
Inhalte (Autos, Teile, Events, Orte, Straßen, Sammelbares) liegen als Daten in `daten/`-Ordnern.

## Phasen

1. **Fundament** – Projekt, Spielschleife, Eingabe (Tastatur, Gamepad, Touch), ein Auto auf
   Testfläche, Fahrmodell und Kamera verfeinern, Physiktests.
2. **Welt** – Höhenkarte 8×8 km, sechs Regionen, Straßennetz (Splines, Kreuzungen, Brücken,
   Tunnel), Kachel-Streaming, Vegetation, Tag-Nacht, Wetter.
3. **Rennen** – Event-System, KI, HUD, erste zwölf Events über alle acht Renntypen.
4. **Tiefe** – 24+ Autos in sechs Klassen, Tuning, Lack/Folien, Karriere (~60 Events), Skill-System, Speichern.
5. **Fülle** – Jahreszeiten, Verkehr, Rivalen, Sammelbares, Streckeneditor, Fotomodus, Wiederholung, Radio.
6. **Mehrspieler** – Node-Server, freie Fahrt und Rennen bis 8 Spieler, Bestenlisten, Geister-/Streckentausch.
7. **Feinschliff** – Leistung (Pixel 10a), Balance, Barrierefreiheit, Dokumentation, Abschlussbericht.

Jede Phase endet lauffähig und wird im Headless-Browser gefahren und per Bildschirmfoto geprüft.

## Abnahmekriterien
- `npm install`, `npm run dev`, `npm test`, `npm run build` laufen fehlerfrei.
- Karriere von Stufe 1 bis zum Abschlussrennen durchspielbar.
- Fahrzeugklassen und Untergründe fühlen sich klar unterschiedlich an (durch Tests belegt).
- Bildraten-Budget in allen Regionen und bei jedem Wetter eingehalten (`npm run messung`).
- README erklärt Start, Steuerung, Aufbau, Hinzufügen von Autos und Events.
