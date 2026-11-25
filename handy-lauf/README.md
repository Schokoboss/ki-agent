# Nova Lauf – W gedrückt halten in Roblox (Handy)

Kleine Android-App für das Pixel: Sie hält in Roblox den Joystick nach vorne gedrückt – genau wie W
gedrückt halten am PC. Keine KI, kein Laptop nötig.

## Installieren

1. Am Handy in Chrome öffnen:
   **https://github.com/Schokoboss/ki-agent/releases/download/nova-lauf/NovaLauf.apk**
2. Datei antippen → „Installieren“. Fragt Android nach „Unbekannte Apps installieren“, Chrome das erlauben.
   Warnt Play Protect, „Trotzdem installieren“ wählen (die App ist nicht aus dem Play Store).
3. „Nova Lauf“ öffnen → **Bedienungshilfen öffnen** → „Nova Lauf“ → einschalten.
   Ist der Schalter grau („Eingeschränkte Einstellung“): In der App **App-Info öffnen** → oben rechts ⋮ →
   **„Eingeschränkte Einstellungen zulassen“** → nochmal einschalten.

## Benutzen

- Roblox öffnen und ins Spiel gehen. Oben erscheint ein kleiner Knopf: `⋮⋮  ▶ W  ◎`
- Beim ersten Mal **◎** tippen und den Kreis auf den Joystick schieben (links unten). **◎** nochmal = gespeichert.
- **▶ W** tippen → der Charakter läuft geradeaus. Der Knopf zeigt die Zeit. Nochmal tippen = Stopp.
- An **⋮⋮** lässt sich der Knopf verschieben.

Gut zu wissen:

- Tippst du beim Laufen selbst aufs Display, hört er kurz auf und läuft nach 1 Sekunde weiter.
- Wechselst du die App, stoppt er automatisch. Der Bildschirm bleibt beim Laufen an.
- **Gegen den AFK-Kick** lässt er standardmäßig alle 5 Minuten kurz los und drückt neu (einstellbar: nie/2/5/10 min).
- Die App liest keine Bildschirminhalte; sie sieht nur, welche App gerade vorne ist.
- Roblox verbietet Bots in seinen Regeln – lieber einen Zweit-Account nehmen.

## Technik

- `LaufDienst.java`: Bedienungshilfe-Dienst (`canPerformGestures`). Legt einen Finger auf den Joystick, schiebt
  ihn nach vorne und hält ihn mit aneinandergehängten Gesten-Stücken (`continueStroke`, je 0,8 s) unten.
  Schwebender Knopf und Einstell-Kreis sind `TYPE_ACCESSIBILITY_OVERLAY`-Fenster.
- `MainActivity.java`: Startbildschirm (Einschalten, Roblox öffnen, Einstellungen).
- Gebaut wird auf GitHub (`.github/workflows/handy-lauf-apk.yml`) bei jeder Änderung in `handy-lauf/`.
  Selbst bauen: `cd handy-lauf && gradle assembleDebug` (Android-SDK nötig).
