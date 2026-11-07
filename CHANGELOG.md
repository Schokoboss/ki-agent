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
- **AAA-Inszenierung**: Kamerafahrt am Startfeld vor jedem Rennen mit Kino-Balken und Titelkarte (überspringbar),
  Wiederholung der letzten 8 s nach dem Ziel mit TV-Kameras (Streckenrand mit Tele-Zoom, tiefe Verfolger-, Hubschrauber-
  Kamera), **Zurückspulen** (Q/Rücktaste, Steuerkreuz ↓ oder ⏪ halten – Auto, Gegner und Rennzeit laufen 12 s zurück).
- Fehlzündungen mit Flammen und Knallen beim Gaswegnehmen, Turbo-Pfeifen und Abblasen, Linsenreflexe gegen die Sonne,
  Regentropfen auf der Kamera, Schmutz auf dem Lack (Schotter/Wiese, Regen wäscht ab; Gegner in Rallyes verdreckt).
- Hyper-Fix: schwarzes Bild durch ungültige Werte in der Spiegelungskarte behoben (8-Bit-Würfelkamera, Schutzfilter).
- **HD-Paket**: 2K-Fototexturen mit Rauheitskarten (`models/tex-hd`, Einstellung „HD-Texturen“, automatisch auf Hyper
  und am PC ab Ultra), Unterholz aus Fotomodellen (Farne, Büsche, Baumstümpfe mit Kollision, liegende Stämme) und zwei
  weitere fotografierte Felsarten (Poly Haven, CC0). Offline spielbar: eigener Service Worker speichert alles Geladene.
- Fehler behoben: Beim Festival-Rundkurs stand die Bühne auf der Straße – der Nordbogen führt jetzt hinter der Bühne vorbei.
- **Fotografierte Bäume**: Tannen, Laubbäume und knorrige Inselbäume von Poly Haven (CC0, Originale bis 487 MB und Millionen
  Dreiecke) als Imposter – 8 vorab gerenderte Ansichten je Baum (Farbe + Normalen), im Spiel eine Fläche je Baum, die zur
  Kamera zeigt, richtig beleuchtet zur Tageszeit und mit Schatten aus Sicht der Sonne. Über 7.700 Bäume für je 2 Dreiecke.
  `werkstatt/baeume.py`. Einzeldatei mit HD jetzt ~31 MB.
- **Online**: https://schokoboss.github.io/ki-agent/spiele/nova-drive/ – GitHub Actions veröffentlicht jede Änderung am
  Spielordner automatisch (nur `spiele/nova-drive/` im Zweig `gh-pages`, die Nova-App bleibt unberührt).
- **Querformat ohne Drehen**: Handy hochkant mit Drehsperre → das Spiel legt sich selbst quer (90° gedreht, Tasten, Wischen,
  Karte, Fotokamera und Neigen rechnen mit). „Als App installieren“ auf dem Startbildschirm (Chrome): eigene App mit Symbol,
  startet immer quer im Vollbild.
- Weitere Fotobäume: junge Tannen zwischen den großen, breite Jacarandas rund ums Festival, zwei Strandbäume (rund und
  windschief) statt der Low-Poly-Palmen – jetzt 7 Baumarten aus Fotomodellen.
- Fehler behoben: Im gedrehten Modus (Handy hochkant) ließen sich Menüs nicht scrollen – das Spiel scrollt jetzt selbst in
  Spielrichtung, mit Nachlauf (Einstellungen, Tagesaufgaben, Garage, Autoliste). Wischgesten nur noch im Fahrbild gesperrt.
- „📲 Als App installieren“ ist am Handy immer sichtbar (außer das Spiel läuft schon als App); bietet der Browser es nicht
  direkt an, zeigt der Knopf eine Anleitung (Chrome / Samsung Internet).
- Grafik „Auto“ = **Hyper** (GPU-lastig); die Auflösung regelt bei Bedarf herunter, bei Dauer-Ruckeln kommt ein Ultra-Tipp.
- **Alle Texturen verbessert**: Waldboden aus Laub, Nadeln und Moos unter den Bäumen (Poly Haven, CC0; Dichtekarte aus
  den Baumstandorten), keine sichtbaren Kachelmuster mehr bei Gras, Sand, Waldboden und Straßen (zwei versetzte Lesungen,
  weich gemischt), gemalte Texturen in 4-facher Auflösung mit mehr Details (abgefahrene Fahrbahnmarkierungen, Reifenspuren,
  Flickstellen; Fassaden mit Rahmen, Sprossen, Spiegelung, Gardinen, Fensterbänken; Festivalplatz mit Pflaster und
  Schriftzug; Plakate, Banner, Warnstreifen, Zeltstoff), fotografierte Felsen/Farne/Holz mit 1K-Texturen,
  Häuser mit rauem Außenputz (Foto, dreiseitig projiziert, mit Relief) und spiegelnden Glasfenstern.
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
