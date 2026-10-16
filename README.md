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
