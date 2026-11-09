# Tumult Arena

Ein schneller Arena-Brawler für den Browser – mit **Echtzeit-Multiplayer** für bis zu 8 Spieler, am Handy und am PC.
Eigene Helden, Karten und Grafik; der Server ist reines Python (nur Standardbibliothek), nichts zu installieren.

## Starten

- **Windows:** Doppelklick auf **`Tumult Arena starten.cmd`** (in diesem Ordner). Das schwarze Fenster ist der Server –
  offen lassen. Der Browser öffnet sich mit dem Spiel.
- **Sonst:** `python spiele/tumult-arena/server.py` (Optionen: `--port 8790`, `--internet`, `--no-browser`)

Beim ersten Start fragt die Windows-Firewall, ob Python ins Netz darf → **„Private Netzwerke“ erlauben**, sonst können
Handys im WLAN nicht mitspielen.

## Ohne Server (gegen Bots)

`python spiele/tumult-arena/offline_bauen.py` baut `tumult-arena-offline.html` – eine einzige Datei, in der die ganze
Spiellogik im Browser läuft (du gegen Bots, kein Server, kein Internet). Die Datei kann man z. B. aufs Handy kopieren.
Die Logik steckt dafür zusätzlich in `web/lokal.js` (JavaScript-Fassung von `spiel.py`; Helden, Modi und Karten
übernimmt das Build-Skript direkt aus `spiel.py`). Regeländerungen in `spiel.py` dort nachziehen.

## Mit Freunden spielen

| Wo sind die anderen? | So geht's |
|---|---|
| Gleiches WLAN | Im Fenster steht `Im gleichen WLAN: http://192.168.…:8790` – diese Adresse am Handy/PC öffnen. |
| Woanders (Internet) | Die Startdatei holt automatisch einen **Internet-Link** (`https://….trycloudflare.com`) über `engine\cloudflared.exe` von Nova. Der Link steht im Fenster und im Spiel unter „Freunde einladen“. |

Im Spiel: **„Privater Raum“** erstellt einen Raum mit 4-Buchstaben-Code. Freunde geben den Code ein oder öffnen den
Einladungslink (`…/?raum=ABCD`, Knopf „🔗 Einladen“). Der Host wählt Modus und ob Bots auffüllen, dann **Start**.
**„Spielen“** wirft dich sofort in einen öffentlichen Raum; Bots füllen auf und werden von echten Spielern übernommen,
sobald jemand dazukommt – auch mitten in der Partie. Fliegt jemand raus, spielt ein Bot weiter, bis er sich wieder
verbindet (Seite neu laden reicht).

## Modi

| Modus | Regeln |
|---|---|
| ⚔️ **Teamkampf** (3 gegen 3, Schluchtenhof) | Erstes Team mit 15 K.o.s gewinnt, sonst nach 3 Minuten das Team mit mehr. |
| 💎 **Kristallrausch** (3 gegen 3, Kristallgrube) | In der Mitte entstehen Kristalle. Ein Team mit 10+ (und mehr als der Gegner) muss sie 15 s halten. Wer ausgeschaltet wird, verliert alle Kristalle. |
| ☠️ **Letzter Stand** (jeder gegen jeden, bis 8, Nebelinsel) | Kein Wiederbeleben. Kisten enthalten Energiezellen (+300 Leben, +8 % Schaden, wirken bis 12 Stück). Giftnebel zieht sich zu. |

## Helden

| Held | Rolle | Angriff | Super |
|---|---|---|---|
| ⚡ Funke | Blitz-Schütze | Salve aus drei Blitzen | Kugelblitz – durchschlägt Gegner und Kisten |
| 🏹 Bolzen | Scharfschütze | weiter, harter Bolzen | Durchschuss – trifft alle in einer Linie, stößt zurück |
| 🪨 Brocken | Felsen-Panzer | Fächer aus 5 Splittern | Sturmangriff – rammt Gegner weg, zertrümmert Kisten |
| 💣 Zunder | Bombenwerfer | Bombe über Wände | Großer Knall – riesige Explosion |
| 🌿 Mira | Heilerin | Dornensamen | Heilgarten – heilt das Team im Kreis |
| 🗡️ Klinge | Schattenklinge | Hieb im Halbkreis | Schattensprung – springt über Wände |

## Steuerung

- **Handy** (am besten quer): linker Daumen läuft (Joystick erscheint, wo du tippst), rechter Daumen zielt – loslassen
  schießt, **kurz tippen zielt automatisch** auf den nächsten Gegner. Goldener Knopf = Super (genauso ziehen/tippen).
  Zurück in die Mitte ziehen bricht ab.
- **PC:** `WASD`/Pfeile laufen, Maus zielt, **Linksklick** schießt (gedrückt halten = Dauerfeuer), **Rechtsklick**
  halten zeigt die Super-Vorschau, loslassen feuert (oder `Leertaste`/`E`). `F` Angriff mit Auto-Ziel,
  `1`–`6` Emotes, `Tab` Spielerliste, `M` Ton.

**Gut zu wissen:** 3 Munitionsbalken laden von selbst nach. Wer 3 s nicht schießt und nicht getroffen wird, heilt sich.
Im Busch bist du unsichtbar, bis du schießt, getroffen wirst oder ein Gegner ganz nah ist. Die Super lädt durch Treffer.
Das rote Team sieht die Karte gedreht – die eigene Basis ist immer links.

## Technik

```
server.py      HTTP + WebSocket (RFC 6455) + Räume + Spielschleife (30 Takte/s), optional cloudflared-Tunnel
spiel.py       Spiellogik ohne Netzwerk: Helden, Karten, Treffer, Modi, Bots (Pfadsuche, Zielvorhersage)
web/           Browser-Client: spiel.js (Netz, Vorhersage, Steuerung, Darstellung), grafik.js (Figuren), ton.js (Sound),
               lokal.js (Spiellogik in JavaScript für die Offline-Version)
offline_bauen.py  baut die Offline-Version als eine HTML-Datei
```

- Der Server rechnet alles selbst (Schüsse, Treffer, Sicht im Busch); Browser schicken nur Eingaben. Gegner im Busch
  werden gar nicht erst übertragen.
- Die eigene Bewegung wird im Browser **vorhergesagt** und mit dem Server abgeglichen (`move()` ist in `spiel.py` und
  `web/spiel.js` identisch) – fühlt sich auch über den Internet-Link direkt an. Alle anderen Figuren werden mit
  100 ms Puffer weich interpoliert.
- Test: `python werkzeuge/tests/test_tumult.py` (Bot-Partien in allen Modi + zwei echte WebSocket-Spieler:
  Raum, Start, Bewegung, Schuss, Verbindungsabbruch, Wiederverbinden, Einsteigen in laufende Partie).
