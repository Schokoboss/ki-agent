# Änderungen

Neueste Änderungen oben. Jede Zeile mit Hash ist ein Commit im Repo.

## 05.11.2026
- **Nova Drive** (`app/spiele/nova-drive/`): Open-World-Festival-Rennspiel fürs Handy (three.js, läuft im Browser, installierbar).
  Eigene Insel mit Küstenring, Altstadt, See, Pass, Wald und Festival; 9 Rennen gegen KI, Blitzer, Driftzonen, Schanzen,
  20 Plakate, Skill-Ketten, Tag/Nacht, generatives Radio, Freund-Herausforderung per Link (Geist).
- 8 eigene Automodelle aus Blender (`werkstatt/autos.py`, Meshopt-komprimiert, zusammen < 1 MB).
- Komplette Welt aus Blender-Modellen (`werkstatt/welt.py`, 31 Modelle): Bäume mit Detailstufen nach Entfernung,
  Felsen, 8 Gebäudetypen (Fenster leuchten nachts), Laternen, Zäune, Pylonen, Heuballen, Plakatwände, Schanzen,
  Bühne mit LED-Wand, Zirkuszelte, Riesenrad, Torbogen, Lichttürme, jubelnde Zuschauer, Segelboote, Windräder.
  Gegner und Verkehr fahren die vollen Automodelle; Grafik-Standard „Hoch“.
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
