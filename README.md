# Nova – dein lokaler KI-Agent

Nova ist ein KI-Agent, der **komplett auf deinem Laptop** läuft (kein ChatGPT, keine Cloud-KI) und den du
**vom Handy aus** als App benutzt. Er kann im Internet suchen, Webseiten lesen, Python-Code schreiben und
ausführen, Dateien anlegen, Sachen am Laptop öffnen, Fotos verstehen und sich Dinge merken – und er kann
**stundenlang selbstständig an einem Auftrag arbeiten**.

## Starten

1. Doppelklick auf **„KI-Agent Nova“** auf dem Desktop (oder `KI-Agent starten.cmd` in diesem Ordner).
2. Ein schwarzes Fenster geht auf – das ist der Agent. **Offen lassen**, solange du ihn nutzt.
   Fenster zu = Agent aus.
3. Nach ca. 20 Sekunden ist das Modell geladen, nach ca. 1 Minute ist es „vorgewärmt“.

## Handy koppeln (nur einmal nötig)

1. Im Browser am Laptop öffnet sich **http://localhost:8765/connect** mit einem QR-Code.
2. QR-Code mit der **Handy-Kamera** scannen → Link antippen → die App öffnet sich in Chrome.
3. In Chrome **⋮ → „Zum Startbildschirm hinzufügen“ → Installieren**. Fertig, jetzt ist Nova eine App.

Danach findet die App den Laptop **automatisch** – auch nach einem Neustart, auch im mobilen Netz.
Kein USB-Kabel nötig.

## Arbeitszeit (Aufträge)

Unten links über dem Eingabefeld ist der Knopf **„Normal“**. Tipp drauf und wähle z. B. **5 h**:

- Der Agent arbeitet dann selbstständig an deinem Auftrag – plant, schreibt Code, testet, macht Notizen.
- Er hört auf, wenn er fertig ist **oder** wenn die Zeit um ist, und schreibt eine Zusammenfassung.
- **„Ohne Nachfragen arbeiten“** = er darf Code/Befehle ohne deine Freigabe ausführen.
  Sonst wartet er bei solchen Aktionen bis zu 10 Minuten auf dein OK in der App.
- Du kannst die App schließen. Der Agent arbeitet am Laptop weiter, du siehst den Fortschritt beim
  nächsten Öffnen. Der Laptop schläft währenddessen **nicht** ein – trotzdem: **Ladekabel dran und Deckel offen**.
- Mit dem ■-Knopf brichst du ab.

## Handy-Modus (ohne Laptop)

Nova kann auch **direkt auf dem Handy** laufen – ganz ohne Laptop, sogar ohne Internet (nur Wetter/Wikipedia brauchen Netz).

- In der App auf den Namen oben tippen → **Einstellungen → KI-Modus**:
  - **Automatisch**: Laptop, wenn er an ist – sonst die Handy-KI.
  - **Laptop**: immer der Laptop (stärker, alle Werkzeuge, Arbeitszeit-Aufträge).
  - **Nur Handy**: immer die Handy-KI.
- **Handy-Modell** einmal im WLAN laden: *Qwen3.5 2B* (Standard, ca. 1,3 GB), *0.8B* (Mini, schnell)
  oder *4B* (groß, kann fürs Handy zu viel sein).
- Werkzeuge im Handy-Modus: Wetter, Wikipedia, Rechnen, Merken. Fotos, Python, Dateien und
  Arbeitszeit-Aufträge gehen nur mit dem Laptop.
- Ohne Kopplung nutzbar: Auf dem Koppel-Bildschirm „Ohne Laptop nutzen“ tippen.
- Chats der Handy-KI bleiben auf dem Handy (in der Chatliste mit „Handy“ markiert).

## Was Nova noch kann

- **Laptop fernsteuern:** Chatliste → „Laptop fernsteuern“ – Bildschirm live, Tippen = Klick, lange drücken =
  Rechtsklick, Tasten-Leiste, Text tippen, Zoom. Und Nova kann den Laptop selbst bedienen (fragt vorher).
- **Minecraft-Shader bauen:** „Bau mir einen warmen Shader mit hohen Wellen“ – Nova stellt deine geprüften
  Packs AuroraCraft/BedRush ein (Stile: warm, kalt, bunt, düster, hell, realistisch, traumhaft; Profile;
  einzelne Optionen), packt sie und installiert sie als `Nova-….zip` in `.minecraft\shaderpacks`.
- **Videos:** „Mach ein Short über Füchse“ – Szenen mit gemalten Bildern, Stimme (Hedda), Untertiteln
  und Zoom; außerdem Bildschirm aufnehmen, schneiden, zusammenfügen, GIF, verkleinern, Musik drunter.
  Videos landen in `workspace\Videos` und lassen sich in der App abspielen.
- **Spiele:** „Bau mir ein Spiel, wo ein Fisch Haien ausweicht“ – Nova nutzt die Spiele-Werkstatt
  (`make_game`): Die Vorlage `server/game_template.html` bringt Joystick + Feuerknopf am Handy, Tastatur,
  Ton, Highscore, Level, Pause, Effekte und Emoji-Figuren schon mit, Nova schreibt nur das eigentliche Spiel.
  Jede Version wird im unsichtbaren Chrome ~4 s echt durchgespielt (Fehler mit Zeile, läuft die Schleife,
  bewegt sich was, reagiert die Steuerung) und erst bei „OK“ veröffentlicht – mit Vorschaubild im Chat.
- **Apps & Webseiten:** Nova programmiert sie und gibt dir einen **festen Link** (über GitHub Pages
  `go.html`, findet den Laptop nach jedem Neustart wieder; dieselbe Datei behält ihren Link auch nach
  Verbesserungen). Teilbar – funktioniert, solange der Laptop läuft. Wer den Link hat, sieht auch, wann
  dein Laptop online ist.
- **Wissensspeicher:** „Lern meinen Ordner Desktop\MINECRAFT\AuroraCraft“ – danach beantwortet Nova Fragen
  zu deinen Projekten aus deinen eigenen Dateien, mit Datei und Zeile als Quelle.
- **Programmieren:** Projekte unter `workspace\Projekte`, Nova liest/durchsucht Code, ändert gezielt
  (`edit_file`), führt Python, JavaScript (Node) und PowerShell im Projektordner aus und testet.
- **Dokumente:** „Schreib mir eine Bewerbung als PDF“ – fertige PDF in `workspace\Dokumente`.
- **Bilder malen:** „Mal mir einen Drachen über einer Burg“ – lokal mit SD-Turbo auf der iGPU,
  das Bild landet im Chat und unter `workspace\Bilder`.
- **Recherche mit Quellen:** Fakten-Fragen beantwortet Nova aus mehreren Webseiten und nennt sie als [1], [2] …
  Seiten, die nur per JavaScript laden, liest er unsichtbar über dein installiertes Chrome.
- **Handy-Aktionen:** „Ruf … an“, „Navi zum Bahnhof“, „WhatsApp an …“, „Termin morgen 15 Uhr“ →
  Ein-Tipp-Karte im Chat.
- **Routinen:** „Jeden Morgen um 7 das Wetter“ – läuft am Laptop, Ergebnis als Benachrichtigung.
- **Erinnerungen, Dateien Handy ↔ Laptop, Bildschirmfoto, Musik/Lautstärke, Laptop sperren.**
- **Gesprächsmodus** (Kopfhörer oben rechts): sprechen, Nova antwortet laut, hört wieder zu.
- **Neu erzeugen / Bearbeiten** unter der letzten Antwort, **Chat-Suche** in der Chatliste.

## Laptop-Modelle

Einstellungen → **Laptop-Modell** – umschalten dauert ein paar Sekunden:

| Modell | Wofür |
|---|---|
| Qwen3.5 9B | Am klügsten (Programmieren, Fakten), versteht Bilder – langsamer, ~8 GB freier RAM nötig |
| Qwen3.5 4B Turbo | Experimentell (MTP): nur mit viel freiem RAM schneller – ohne Bilderkennung |
| Qwen3.5 4B | Standard – schlau, versteht Bilder |
| Qwen3.5 2B | Schnell – für einfache Sachen |
| Gemma 4 E4B | Google – gut in Sprache, versteht Bilder, etwas langsamer (braucht ~7 GB RAM) |

**Spielmodus** (Schalter oben in der Liste, standardmäßig an): Läuft Minecraft, Roblox, Fortnite & Co., nimmt Nova
statt eines großen Modells (9B, Gemma, Turbo) solange das 4B – das Spiel bekommt ~4 GB RAM zurück und der
Grafikspeicher läuft nicht über. Ist das Spiel eine Minute zu, geht's automatisch zurück. Gewechselt wird nur, wenn
gerade kein Auftrag läuft. Eigene Spiele: in `data/config.json` unter `game_processes`, z. B. `{"spiel.exe": "Name"}`.

Läuft der Grafikspeicher trotzdem über, lädt Nova das Modell sparsamer neu (mehr auf die CPU) und wiederholt die
Anfrage – die Stufe merkt er sich in `gpu_level`.

## Was er kann (Werkzeuge)

| Werkzeug | Fragt vorher? |
|---|---|
| Websuche, Webseite lesen, Wikipedia, Wetter, Rechnen | nein |
| Laptop-Status (Akku, RAM, CPU, Uhrzeit) | nein |
| Dateien im Arbeitsordner `workspace\` lesen/schreiben | nein |
| Dateien **außerhalb** des Arbeitsordners | **ja** |
| Python-Code / PowerShell ausführen | **ja** |
| Programme/Dateien am Laptop öffnen (Webseiten: nein) | **ja** |
| Gedächtnis (merken/vergessen), Arbeitsnotizen | nein |

„Freie Hand“ in den Einstellungen schaltet alle Nachfragen ab – nur wenn du weißt, was du tust.

## Gut zu wissen

- **Tempo:** ca. 6–9 Wörter-Stückchen pro Sekunde. Die erste Antwort nach dem Start dauert etwas länger.
  Roblox, Chrome usw. schließen macht den Agenten schneller (der Laptop hat nur 16 GB RAM).
- **Modell:** Qwen3.5-4B (Apache-2.0-Lizenz) mit Bildverständnis, läuft über llama.cpp auf der Radeon-iGPU.
- **Denkmodus** (Einstellungen): gründlicher, aber deutlich langsamer.
- **Sicherheit:** Die Verbindung läuft über einen verschlüsselten Cloudflare-Tunnel. Ohne den geheimen
  Schlüssel aus dem QR-Code kommt niemand rein. QR-Code also niemandem zeigen. Neuer Schlüssel:
  `data\config.json` löschen (dann neu koppeln).
- **Spracheingabe** nutzt die Google-Spracherkennung des Handys, alles andere bleibt lokal.

## Ordner

```
engine\      llama.cpp (KI-Engine) + cloudflared (Tunnel)
models\      das KI-Modell (2,6 GB) + Bildverständnis (0,6 GB)
server\      der Agent (Python, nur Standardbibliothek)
app\         die Handy-App (liegt auch auf GitHub Pages)
workspace\   Arbeitsordner des Agenten – hier landen seine Dateien
data\        Chats, Gedächtnis, Schlüssel, Logs (privat, nicht auf GitHub)
```

## Wenn was nicht geht

- **App sagt „Laptop offline“:** Läuft das schwarze Fenster? Ist der Laptop wach und im Internet?
  In der App auf den Namen tippen → „Neu verbinden“.
- **„Nicht gekoppelt“:** QR-Code am Laptop neu scannen (http://localhost:8765/connect).
- **Fehler ansehen:** `data\logs\agent.log`, `llama.log`, `tunnel.log`.
