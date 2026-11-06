# Änderungen

Neueste Änderungen oben. Jede Zeile mit Hash ist ein Commit im Repo.

## 06.11.2026
- **Nova Drive – 16 Autos**: 8 neue eigene Blender-Modelle – Camper-Bus (Dachträger, Surfbrett), Kleinwagen, Buggy
  (Überrollkäfig), Geländewagen, Oldtimer (Speichenräder, Weißwandreifen), Kombi, Keil-Supersportler (Klappscheinwerfer),
  80er-Rallye (Kastenkotflügel, Zusatzscheinwerfer). Gegner und Verkehr fahren sie auch.
- Alle Autos in Blender neu gebaut: ausgestellte Kotflügel, Türfugen, Projektor-Scheinwerfer, Türgriffe, Embleme,
  Innenraum mit Sitzen und Lenkrad hinter durchsichtigen Scheiben (eigenes Auto), saubere A-/B-/C-Säulen,
  Grill und Kennzeichen exakt auf die Karosserie gesetzt. Drei Detailstufen (voll · mittel für Gegner · LOD).
- Garage nach Preis sortiert. Motorsound je nach Autotyp.
- Echte Foto-Oberflächen von Poly Haven (CC0): Wiese, Fels, Sand, Asphalt und Schotter mit Normal-Maps – Boden und
  Straßen haben jetzt Relief im Licht (Felshänge dreiseitig projiziert). Laden/Aufbereiten: `werkstatt/texturen.py`.
- Fotografierte Felsen von Poly Haven (CC0) statt Low-Poly-Felsen: in Blender auf ~1000 Dreiecke reduziert,
  Fototextur + Normal-Map (`werkstatt/felsen.py`).
- **PC-Modus** (automatisch am PC, Einstellungen → Gerät, oder `?pc`): keine Touch-Tasten, Tastatur-Lenkung baut sich
  weich auf, Maus zum Umsehen (federt zurück) und Mausrad-Zoom, Rückblick (X/LB), Enter startet Events, N Navi,
  G Fotomodus, H Tastenhilfe (wechselt automatisch zu Gamepad-Belegung), Esc = zurück, Gamepad steuert auch Menüs,
  Hover-Effekte. Starter-Seite: „Am PC spielen“.
- **Schönere Autos** (alle 16 neu aus Blender): hohle Reifenwülste mit offenen Felgen, gelochte Bremsscheiben,
  feststehende Bremssättel, dunkle Radhaus-Schalen, runde Spiegel mit Spiegelglas, Endrohre mit Wulst,
  Kiemen-Lamellen, profilierte Heckflügel, Rückleuchten mit Rahmen und Rückfahrlicht, LED-Leiste,
  Diffusor-Finnen, Spaltmaße an Haube und Kofferraum. Lack mit Metallic-Flakes unter Klarlack (Ultra/Hyper).
- **Grafikstufe Hyper ✦** (Einstellungen → Grafik): Umgebungsverdeckung (GTAO), Echtzeit-Spiegelungen der
  Umgebung im eigenen Auto (auch in der Garage), mindestens 1,5-fache Auflösung (Supersampling), dichteres Gras
  in größerem Umkreis, feineres Gelände, Bäume detailliert bis 1 km, weitere Sicht. Für starke GPUs/PCs.
- Navigation: Route zu jedem Ziel über das Straßennetz (Karte → „🧭 Navi starten“, Pause → Navi), Pfeile auf der Straße,
  Abbiegehinweise mit Entfernung, Sprachansagen, Neuberechnung beim Verfahren; Rennstrecke wird vorab angezeigt.
- Grafik Ultra, Ladebildschirm mit Fortschritt, vorberechnetes Licht (siehe frühere Commits).

## 05.11.2026
- **Nova Drive** (`app/spiele/nova-drive/`): Open-World-Festival-Rennspiel fürs Handy (three.js, läuft im Browser, installierbar).
  Eigene Insel mit Küstenring, Altstadt, See, Pass, Wald und Festival; 9 Rennen gegen KI, Blitzer, Driftzonen, Schanzen,
  20 Plakate, Skill-Ketten, Tag/Nacht, generatives Radio, Freund-Herausforderung per Link (Geist).
- 8 eigene Automodelle aus Blender (`werkstatt/autos.py`, Meshopt-komprimiert).
- Komplette Welt aus Blender-Modellen (`werkstatt/welt.py`, 31 Modelle): Bäume mit Detailstufen nach Entfernung,
  Felsen, 8 Gebäudetypen (Fenster leuchten nachts), Laternen, Zäune, Pylonen, Heuballen, Plakatwände, Schanzen,
  Bühne mit LED-Wand, Zirkuszelte, Riesenrad, Torbogen, Lichttürme, jubelnde Zuschauer, Segelboote, Windräder.
  Gegner und Verkehr fahren die vollen Automodelle; Grafik-Standard „Hoch“.
- Wetter: wechselnd/Sonne/Regen – nasse, spiegelnde Straßen, Gischt, weniger Grip (auch für die KI), Gewitter mit Blitz & Donner.
- Fotomodus (Pause → 📸): Kamera frei drehen/zoomen, Uhrzeit, 6 Filter, Foto teilen oder speichern (mit Logo).
- Handy: Lenkgefühl, Tastengröße, Neigung kalibrieren/umkehren, Vibration, Spielstand als Code sichern/laden,
  lokaler Start mit QR-Code (`Nova Drive starten.cmd`) und Einzeldatei fürs Handy (`werkstatt/handy-datei.mjs`).
- Geld & Co.: Tagesbonus, 3 Tagesaufgaben, Glücksrad (nur Spielgeld), Auszahlung nach Platz/sauber/Schwierigkeit,
  Autos kaufen, tunen und verkaufen, Profil-Statistik.

## 04.11.2026
- Startseite: Karte „Zum Startbildschirm hinzufügen“ (Installieren-Knopf, wo der Browser ihn anbietet).
- Pausen im Zeit-Modus können nie negativ werden (Schutz gegen Uhr-Sprünge).
- Tests im Repo: `python werkzeuge/tests/alle_tests.py [--handy] [--spiele]` – isoliert, fasst echte Chats,
  Arbeitsordner und `config.json` nie an.

## 03.11.2026
- **Dauerbetrieb** (6d1f291): „∞ Bis fertig“ ohne Zeitlimit, Fortsetzen nach Neustart/Absturz (Uhr steht, offene
  Werkzeug-Aufrufe werden geheilt, max. 5 Neustarts), stündlicher Zwischenstand aufs Handy, Autostart ohne Admin,
  Handy-Test auf 6 Profilen, Tippflächen ≥ 40 px.
- **App** (6862a54): Zeit-Auftrag steuern (Pause, +15 min, Jetzt beenden), Abschlussbericht, „Immer erlauben“,
  Einstellungen in Bereichen (Sicherheit, Integrationen, Protokoll mit CSV-Export).
- **Server** (2c1c6a2): Berechtigungen je Bereich (erlauben/fragen/verbieten), Protokoll aller Aktionen,
  MCP-Integrationen (stdio + HTTP), besserer Zeit-Modus.

## 28.10.2026
- Kontext-Überlauf behoben: Budget aus dem echten Kontext + Rettung (045b1bb).

## 16.–17.10.2026
- Erste Version: Server, Werkzeuge, Handy-App (41c1845), Handy-Modus ohne Laptop, Benachrichtigungen, Teilen,
  Laptop-Steuerung, Routinen, Gesprächsmodus, Bilder, Recherche, Minecraft-Shader, Videos, Fernsteuerung,
  Spielmodus, feste Links, Spiele-Werkstatt, Schutz vor vergifteten Chats.
