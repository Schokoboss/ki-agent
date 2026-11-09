# Änderungen

Neueste Änderungen oben. Jede Zeile mit Hash ist ein Commit im Repo.

## 09.11.2026
- **Dino-Sprint 3D** (`app/dino/`): Endlos-Rennen in 3D mit three.js – 3 Spuren, springen/ducken/ausweichen, 8 Dinos mit
  Spezialfähigkeit, 6 Power-ups, Münzen und Kristalle, Shop mit Upgrades, Weiterlaufen, Tag/Nacht, Musik und Töne per
  WebAudio. Knopf „Dino-Sprint 3D spielen“ in der Chatliste; three.js wird vom Service Worker für offline gemerkt.
- **Mehrspieler** (`server/dino_mp.py`): Räume mit 4-stelligem Code und Einladungs-Link, gleiche Strecke für alle (Seed),
  Gegner als Geister, Meteor-Angriffe, Ergebnis mit Bonus-Münzen. Im Nova-Server unter `/mp/dino` (ohne Schlüssel, nur
  Spielräume) oder allein fürs WLAN. `/dino` leitet jetzt auf `/dino/` um (Ordner unter `app/` mit `index.html`).
- Tests: `werkzeuge/tests/test_dino.py` (Räume) und `werkzeuge/dinotest.mjs` (Chrome: Solo-Bot, Shop, Rennen PC gegen Handy).
- Spielen unter https://schokoboss.github.io/ki-agent/dino/ – GitHub Action `dino-pages.yml` veröffentlicht `app/dino/`
  nach `gh-pages/dino/`. Von dort findet das Spiel den gekoppelten Nova-Laptop für den Mehrspieler über den Gist.

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
