# Änderungen

Neueste Änderungen oben. Jede Zeile mit Hash ist ein Commit im Repo.

## 20.11.2026
- **Nova Drive stabiler**: Speicherleck behoben – jede Auto-Vorschau in der Garage, jeder Autowechsel und jedes Rennen
  ließ Grafikspeicher zurück (konnte Handys nach längerem Spielen abstürzen lassen). Zusammengefasste Automodelle werden
  geteilt und mit Referenzzähler freigegeben; Gegner, Geist, Scheunenautos und Mitspieler geben ihre Materialien frei.
  Gemessen: Garage 3× durch alle 21 Autos → Grafikspeicher bleibt konstant (vorher +600 Geometrien, JS-Speicher ×2).
- **Fahrphysik**: Autos erreichen jetzt die in der Garage angezeigte Höchstgeschwindigkeit (vorher nur ~92 % – die
  KI-Gegner fuhren aber den vollen Wert und zogen auf Geraden davon). Bremsweg hängt von den Reifen ab (100→0 in
  21–26 m statt 15 m für alle). Weniger Speicher-Müll pro Physikschritt.
- **Ideallinie** im Rennen (Einstellungen → Ideallinie: Aus / Nur Bremszonen / Voll): Band auf der Fahrbahn,
  blau = Gas, gelb = Gas weg, rot = bremsen – aus deinem Tempo und dem Kurvenprofil der Strecke für dein Auto.
- **Meisterschaften** (Titel/Pause → 🏆): sechs Serien à drei Rennen mit Klassen-Obergrenze (D, Schotter, C, B, S2, X),
  Punkte 25-18-15-12…, immer dieselben Gegner mit Autos ihrer Klasse, Zwischenstand nach jedem Rennen, Gesamtsieg =
  Preisgeld + Auto (Dune, Atlas, Regent, Gruppo, Strato, Phantom), Platz 2/3 = Teil des Preisgelds. Fortsetzbar.
- **Lackiererei** (Garage, eigene Autos): freie Farbe per Farbwähler (🌈-Feld) und Designs – Rennstreifen, Seitenband,
  Zweifarbig, Startnummer (0–99, auf beiden Türen lesbar), Streifen + Nummer – mit Zweitfarbe; sofort in der Vorschau,
  je Auto gespeichert, auch Mitspieler sehen dein Design. Umgesetzt als Shader-Muster im Lack (kein extra Modell).
- **Einführung für neue Spieler**: kleine Karte oben (1/5 Gas · Lenken · Drift · Navi zur Lichtsäule · erstes Rennen),
  Texte passend zu Touch/Tastatur/Gamepad/Lenkrad, wegklickbar, +5.000 CR am Ende; alte Spielstände sehen sie nicht.
  „NEU“-Hinweis an den Meisterschaften im Titelmenü.
- **8 Aussichtspunkte** (👁 auf der Karte): automatisch die höchsten Stellen an den Straßen, am Fahrbahnrand langsam
  anhalten → +1.500 CR, alle 8 → +20.000 CR; Profil zählt mit.
- **Bremshilfe** im Rennen (Einstellungen → Bremshilfe; „Auto“ = am Handy an): zu schnell für die Kurve voraus →
  das Spiel bremst selbst auf das Tempo der Ideallinie. Simuliert an der engsten Pass-Kehre mit Vollgas: ohne Hilfe
  32 m neben der Strecke, mit Hilfe sauber durch (58 statt Ziel 55 km/h am Scheitel).
- Fehler behoben: Laternen-Lichthöfe leuchteten auch tagsüber (weiße Flecken am Festival) – die Helligkeit wurde
  an einer Stelle gesetzt, die der Shader nie las. Nachts blenden Lichthöfe direkt vor der Kamera aus statt
  bildschirmfüllend zu werden; Scheinwerferkegel ohne hellen Fleck über der Motorhaube. Aussichtspunkte auf der Karte
  weiß (vorher fast gleiche Farbe wie Tempozonen).
- **Tuning-Optik** in der Lackiererei: Felgenfarbe (Silber, Schwarz, Gold, Bronze, Weiß, Neon), Scheibentönung
  (klar/leicht/stark), Heckspoiler (Abrisslippe oder GT-Flügel in Wagenfarbe, nach den Maßen jedes Autos gebaut).
- **Wochen-Herausforderungen** (im Tagesaufgaben-Bildschirm): jede Kalenderwoche drei neue Aufgaben – ein bestimmtes
  Rennen mit Klassen-Obergrenze gewinnen, 3 Sterne bei einem Event, dazu km/Siege/Meisterschaftsrennen; 20.000–25.000 CR
  je Aufgabe, alle drei = +25.000 CR + Glücksrad-Dreh. Für alle Spieler dieselben (aus der Kalenderwoche berechnet).
- **6 Sprungschanzen statt 3**: Hügelkamm (bis ~190 m), Seewiese, Weidenhang – Standorte per Suche (flacher Anlauf,
  freie Landezone) und mit der echten Fahrphysik bei 130/170 km/h geprüft. Fehler behoben: die alte Steppe-Schanze
  schickte das Auto ins Meer – versetzt als „Hochebene“ (Rekorde/Sterne bleiben). Drei Kandidaten mit Wasserlandung
  bzw. Absturz verworfen. Gewinn-Liste links höchstens 4 Einträge.
- **33 Erfolge** (Titel/Pause → 🏅): Fahren (km, Tempo), Rennen (Siege, 3 Sterne überall, Meisterschaften), Können
  (Drift, Sprünge, Blitzer, Tempozonen, Skill-Ketten), Entdecken (Plakate, Scheunen, Aussichtspunkte), Sammeln (Autos,
  Millionär, Lackierer, Tuner, Mehrspieler, Glücksrad) – mit Fortschrittsbalken und Credits (1.000–100.000 CR).
- **KI-Gegner fahren nicht mehr durcheinander hindurch**: vorher überlappten sich zwei Gegner 26–55 % der Rennzeit
  (gemessen in simulierten Rennen). Jetzt halten sie Seitenabstand zu Nachbarn, reihen sich ein, wenn kein Platz ist,
  und rollen nach dem Ziel an den Rand – 0 % Überlappung bei weiterhin 10–25 Überholmanövern pro Rennen.
- Fehler behoben: Bei Sprints am Straßenanfang (Gipfelsturm, Vollgas-Sprint, Seebrücke, Bergpfad, Querfeldein) standen
  alle hinteren Startreihen auf demselben Punkt übereinander – die Startlinie rückt jetzt so weit vor, dass die ganze
  Aufstellung auf der Straße steht. Im Rennen kein doppeltes Band mehr (Streckenband + Ideallinie).
- Rennen: Abstand zum Fahrer davor/dahinter in Sekunden. Einstellungen → **FPS anzeigen** (Bildrate, Auflösung, Stufe –
  hilft beim Einschätzen der Leistung am eigenen Gerät).

## 18.11.2026 (2)
- **Nova Drive läuft flüssiger** (gemessen: 50–66 % weniger Dreiecke pro Bild, eigenes Auto 11 statt 40 Zeichenaufrufe):
  - Grafik „Auto“ wählt die Stufe nach Gerät/Grafikchip (Handy Ultra, starker PC Hyper, Software-Grafik Niedrig) statt
    immer Hyper; Handys rendern nicht mehr in voller Bildschirmdichte (vorher bis 2,6-fach). Läuft es dauerhaft zu langsam,
    startet das Spiel beim nächsten Mal eine Stufe niedriger.
  - Laufzeit-Regelung in 1-s-Schritten: erst Auflösung, dann Spiegelbild einfrieren → Verdeckung aus → kleinere
    Schattenkarte → Leuchten aus; läuft es wieder flüssig, kommt alles zurück.
  - Gelände in Detailstufen (nah fein, fern grob, nahtlos durch Schürzen), Felsen/Häuser/Laternen in Kacheln mit
    Reichweite (zeichnet nur, was im Blickfeld liegt – auch für die Schatten), Zuschauer nur in Festival-Nähe,
    Verkehr wechselt bei 70 m auf das einfache Modell, Spiegel-Würfelkamera eine Seite pro Bild statt sechs,
    Umgebungsverdeckung in halber Auflösung, Gras-Neuverteilung in 2-ms-Häppchen (vorher Ruckler bei Tempo),
    Handy: halbe Schattenkarte, 2× statt 4× Kantenglättung.
- **5 neue Autos** (21 insgesamt, eigene Blender-Modelle): Kubo Würfel 660 (Mini-Kastenwagen, zweifarbiges Dach),
  Regent Limousine V6, Lumen Coupé 2.0T (Haubenschlitze, Abrisskante), Zephyra Cabrio 3.0 (offener Viersitzer),
  Vortex LMP Prototyp (Langstrecken-Renner mit Flosse und großem Flügel, neues Spitzenauto).
- **Mehr Inhalt**: 3 neue Rennen (Küstensprint, Festival-Ausdauer 6 Runden, Waldmarathon 5 Runden), 3 neue Blitzer,
  3 neue Driftzonen, neue Event-Art **Tempozone** (Durchschnittstempo von Start bis Ziel, 4 Stück), **Scheunenfunde**:
  4 vergessene Autos vor Scheunen auf der Insel – Gerücht im Radio in der Nähe, langsam vors Tor fahren → Auto in der
  Garage (Karte zeigt Fundorte, Profil zählt mit). 33 Events insgesamt.
- Fehler behoben: Titelmenü am Handy quer zu hoch („Einstellungen“ abgeschnitten, „Als App installieren“ unerreichbar)
  → zweispaltig; neue Events nicht auf zu kurzen Straßen bzw. auf anderen Startpunkten.

## 18.11.2026
- **Nova Drive – Mehrspieler über verschiedene Geräte** (Titel/Pause → 👥 Mehrspieler): Raum erstellen, 5-stelligen
  Code oder Einladungslink (`#mp=CODE`) teilen, Freunde treten am Handy, Tablet oder PC bei. Alle sehen sich gegenseitig
  auf der Insel (mit Namensschild und Punkt auf der Minikarte), Autos stoßen sich ab. Startet jemand ein Rennen, fahren
  alle im Raum mit: gleiche Startaufstellung auf jedem Gerät, Platzierung und Ergebnisliste mit echten Mitspielern,
  Rennuhr läuft nach Wanduhr (Pause schützt nicht), kein Zurückspulen/Überspringen. KI-Gegner wahlweise dazu.
  Technik: MQTT über WebSocket über einen öffentlichen Vermittlungsdienst (HiveMQ, Ersatz EMQX) – kein eigener Server;
  gesendet werden nur Name, Auto, Farbe, Position und Rennstand (10×/s). `js/net.js`, `lib/mqtt.esm.js` (mqtt.js 5.10.4, MIT).
- **Lenkrad**: USB-Lenkräder mit Pedalen (Logitech, Thrustmaster, Fanatec, Moza … – alles, was der Browser als Controller
  meldet): Einstellungen → USB-Lenkrad → Einrichten (Assistent: Lenkachse, Gas, Bremse, Nitro- und Handbremsen-Knopf),
  Lenkrad-Weg ganz/½/⅓/¼, direkte Lenkung ohne Glättung, Steuerkreuz und Knöpfe auch im Menü. Am Handy neue Lenkart
  **Touch-Lenkrad** (Einstellungen → Lenkung → Lenkrad): am Kranz greifen und drehen, federt zurück.
- Tippen in Textfeldern (Name, Raum-Code) löst keine Spieltasten mehr aus (vorher z. B. F = Vollbild beim Namen eingeben).

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
