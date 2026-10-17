"""Spiele-Werkstatt: fertige Spiel-Vorlage (Steuerung für Handy + PC, Ton, Highscore, Level, Effekte) und ein
echter Test im unsichtbaren Chrome – Fehler, läuft die Schleife, bewegt sich etwas, reagiert die Steuerung.

Die KI schreibt nur noch das eigentliche Spiel (`const game = {init, update, draw}`); alles Fehleranfällige
drumherum steckt in game_template.html. Kleine Modelle bauen so deutlich bessere Spiele.
"""

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from tools import BROWSERS

TEMPLATE = Path(__file__).with_name("game_template.html")
START, END = "// ==== SPIEL START", "// ==== SPIEL ENDE ===="
CREATE_NO_WINDOW = 0x08000000

API = """So schreibst du das Spiel (nur JavaScript, kein HTML):
const game = {
  init() { … },        // (Neu-)Start: alle Spielobjekte anlegen
  update(dt) { … },    // dt = Sekunden seit letztem Bild – Bewegung immer * dt
  draw(ctx) { … },     // alles zeichnen (Hintergrund + Sterne macht die Vorlage)
};
Fertig vorhanden (nicht selbst bauen!):
- W, H = Spielfeld in Pixeln, U = 1 % der kürzeren Seite → Größen/Tempo in U (z. B. r: 4*U, Tempo 60*U pro s)
- input.ax / input.ay (-1…1, Pfeile/WASD/Joystick), input.left/right/up/down, input.fire (gehalten),
  input.firePressed (nur im ersten Bild), input.x / input.y / input.pointer / input.tap (Finger/Maus bei controls=tap)
- addScore(n), loseLife() (Game Over automatisch bei 0), state.level (steigt alle 25 s), state.time, state.score
- hit(a, b) für Kreise {x, y, r}, hitRect(a, b) für {x, y, w, h}, rand(a, b), randi(a, b), clamp, dist, pick(array)
- Zeichnen: emoji('🚀', x, y, größe, winkel) – Figuren am besten als Emoji (👾 🐸 🍎 💎 🪨 🔥 👻 🐟 🚗 ⚽ …),
  circle(x, y, r, farbe), rect(x, y, w, h, farbe), text(s, x, y, größe, farbe), bar(x, y, w, h, anteil), glow(farbe)/glow(null)
- sound('shoot'|'hit'|'coin'|'jump'|'hurt'|'power'|'level'), particles(x, y, farbe, anzahl), shake(stärke),
  floatText(x, y, text, farbe), CONFIG.colors[0/1] (Spielfarben)
- Hintergrund: in init() z. B. CONFIG.background = '#0a3d62' (Wasser) und CONFIG.stars = false (keine Sterne)
Regeln: Objekte in Arrays halten und tote rausfiltern; Schwierigkeit mit state.level steigern; Kollisionen prüfen;
für jede Aktion einen sound(); niemals eigenes requestAnimationFrame, Canvas, Menü, Punkte-Anzeige oder Tastatur-Code."""


class GameError(Exception):
    pass


def project_file(workspace: Path, name: str) -> Path:
    slug = re.sub(r"[^A-Za-z0-9ÄÖÜäöüß_-]+", "-", str(name or "").strip()).strip("-")[:40]
    if not slug:
        raise GameError("Name fehlt (z. B. „Weltraum-Abwehr“).")
    return workspace / "Projekte" / slug / "index.html"


def create(workspace: Path, name: str, title: str, how_to: str, controls: str = "stick", lives: int = 3,
           colors: list | None = None) -> Path:
    path = project_file(workspace, name)
    if path.exists() and START not in path.read_text(encoding="utf-8", errors="replace"):
        raise GameError(f"{path} gibt es schon und ist kein Vorlagen-Spiel – nimm einen anderen Namen.")
    html = TEMPLATE.read_text(encoding="utf-8")
    cols = [c for c in (colors or []) if re.fullmatch(r"#[0-9a-fA-F]{3,8}", str(c))][:2] or ["#00e5ff", "#a259ff"]
    config = ("const CONFIG = {\n"
              f"  title: {json.dumps(str(title or name)[:60], ensure_ascii=False)},\n"
              f"  howTo: {json.dumps(str(how_to or '')[:300], ensure_ascii=False)},\n"
              f"  lives: {max(1, min(int(lives or 3), 9))},\n"
              f"  stick: {'false' if str(controls).lower() == 'tap' else 'true'},"
              "            // Handy: Joystick links + Feuerknopf rechts. false = Tippen/Wischen aufs Spielfeld\n"
              f"  colors: {json.dumps(cols)},\n"
              '  background: "#0b0b1a",\n'
              "};")
    html = re.sub(r"const CONFIG = \{.*?\n\};", lambda m: config, html, count=1, flags=re.S)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html, encoding="utf-8")
    return path


def get_code(path: Path) -> str:
    html = path.read_text(encoding="utf-8")
    a, b = html.find(START), html.find(END)
    if a < 0 or b < 0:
        raise GameError("Das ist kein Vorlagen-Spiel (Markierungen fehlen).")
    return html[html.index("\n", a) + 1:b].rstrip()


def set_code(path: Path, code: str) -> None:
    code = str(code or "").strip()
    code = re.sub(r"^```[a-zA-Z]*\s*\n|\n```\s*$", "", code).strip()
    if re.search(r"<\s*(html|script|body|canvas)\b", code, re.I):
        raise GameError("Bitte NUR den JavaScript-Teil schicken (const game = {init, update, draw}), kein HTML.")
    if not re.search(r"\b(const|let|var)\s+game\s*=", code):
        raise GameError("Der Code muss `const game = { init() {…}, update(dt) {…}, draw(ctx) {…} };` enthalten.")
    for fn in ("init", "update", "draw"):
        if not re.search(rf"\b{fn}\s*(\(|:\s*function|=)", code):
            raise GameError(f"In `game` fehlt die Funktion {fn}().")
    if re.search(r"requestAnimationFrame|getContext\(|addEventListener\(\s*['\"]key", code):
        raise GameError("Keine eigene Spielschleife/Canvas/Tastatur – das macht die Vorlage. Nutze input.* und draw(ctx).")
    html = path.read_text(encoding="utf-8")
    a, b = html.find(START), html.find(END)
    if a < 0 or b < 0:
        raise GameError("Das ist kein Vorlagen-Spiel (Markierungen fehlen).")
    head = html[:html.index("\n", a) + 1]
    path.write_text(head + code + "\n" + html[b:], encoding="utf-8")


# ------------------------------------------------------------------ Test im unsichtbaren Chrome

# Läuft vor dem Spiel (in derselben Zeile wie <head>, damit Zeilennummern stimmen): sammelt Fehler, zählt Bilder,
# drückt „Start“, simuliert Tasten + Tippen und schreibt am Ende einen Bericht ins DOM.
# Chrome speichert die Seite, sobald „load“ fertig ist – ein absichtlich langsames Bild hält das ~5,6 s in echter
# Zeit auf (virtuelle Zeit würde requestAnimationFrame einfrieren). Darum ruft der Prüfer „onload“-Code selbst früher auf.
HARNESS = r"""(function(){
var R={errors:[],listeners:{},frames:0,clicked:null,changed:null,domChanged:null,events:0,overAt:null,state:null};
window.__novaReport=R;
var add=EventTarget.prototype.addEventListener;
add.call(window,'error',function(e){R.errors.push((e.message||'Fehler')+(e.lineno?' (Zeile '+e.lineno+')':''));});
add.call(window,'unhandledrejection',function(e){R.errors.push('Promise: '+((e.reason&&e.reason.message)||e.reason));});
var loads=[],onl=null;
EventTarget.prototype.addEventListener=function(t,f,o){if(this===window&&t==='load'){loads.push(f);return;}R.listeners[t]=(R.listeners[t]||0)+1;return add.call(this,t,f,o);};
Object.defineProperty(window,'onload',{configurable:true,get:function(){return onl;},set:function(f){onl=f;}});
var ce=console.error;console.error=function(){R.errors.push(Array.prototype.join.call(arguments,' ').slice(0,300));return ce.apply(console,arguments);};
var raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=function(cb){return raf(function(t){R.frames++;cb(t);});};
function hash(s){var h=0;for(var i=0;i<s.length;i+=13)h=(h*31+s.charCodeAt(i))|0;return h+':'+s.length;}
function snap(){var c=document.querySelector('canvas');var out='';try{if(c&&c.width)out=hash(c.toDataURL('image/png'));}catch(e){}return out;}
function dom(){return hash(document.body?document.body.innerText:'');}
function vis(el){var r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!el.closest('[hidden]');}
function key(type,k,code,kc){try{var ev=new KeyboardEvent(type,{key:k,code:code,bubbles:true,cancelable:true});
 Object.defineProperty(ev,'keyCode',{get:function(){return kc;}});Object.defineProperty(ev,'which',{get:function(){return kc;}});
 (document.activeElement||document.body).dispatchEvent(ev);R.events++;}catch(e){}}
function ptr(type,x,y){var t=document.elementFromPoint(x,y)||document.querySelector('canvas')||document.body;
 try{if(type.indexOf('touch')===0){var tt=new Touch({identifier:7,target:t,clientX:x,clientY:y});
  t.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'?[]:[tt],targetTouches:type==='touchend'?[]:[tt],changedTouches:[tt]}));}
 else if(type.indexOf('pointer')===0)t.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:7,pointerType:'touch',isPrimary:true,buttons:type==='pointerup'?0:1}));
 else t.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,buttons:type==='mouseup'?0:1}));R.events++;}catch(e){}}
var KEYS=[['ArrowLeft','ArrowLeft',37],['ArrowRight','ArrowRight',39],['ArrowUp','ArrowUp',38],[' ','Space',32],['ArrowDown','ArrowDown',40],['a','KeyA',65],['d','KeyD',68]];
var a=null,step=0,t0=0;
function start(){var els=[].slice.call(document.querySelectorAll('button,[onclick],a,[role=button],.btn')).filter(vis);
 var b=els.filter(function(e){return /start|spiel|play|los|beginn|go\b/i.test(e.textContent||'');})[0]||els[0];
 if(b){R.clicked=(b.textContent||b.tagName).trim().slice(0,40);b.click();}
 key('keydown','Enter','Enter',13);key('keyup','Enter','Enter',13);}
function tick(){step++;var k=KEYS[Math.floor(step/3)%KEYS.length];
 if(step%3===1)key('keydown',k[0],k[1],k[2]);if(step%3===0)key('keyup',k[0],k[1],k[2]);
 var W=innerWidth,H=innerHeight,x=W*(0.3+0.4*((step*37)%10)/10),y=H*(0.45+0.4*((step*53)%10)/10);
 if(step%4===1){ptr('pointerdown',x,y);ptr('touchstart',x,y);ptr('mousedown',x,y);}
 if(step%4===2){ptr('pointermove',x+20,y-10);ptr('touchmove',x+20,y-10);ptr('mousemove',x+20,y-10);}
 if(step%4===3){ptr('pointerup',x+20,y-10);ptr('touchend',x+20,y-10);ptr('mouseup',x+20,y-10);ptr('click',x+20,y-10);}
 var st=window.novaState;if(st&&st.mode==='over'&&R.overAt===null)R.overAt=Math.round((Date.now()-t0)/100)/10;}
function finish(){var b=snap(),d=dom();R.vw=innerWidth+'x'+innerHeight;R.changed=a.c===''?null:a.c!==b;R.domChanged=a.d!==d;
 var st=window.novaState;if(st)R.state={mode:st.mode,score:st.score,lives:st.lives,level:st.level};
 ['onkeydown','onkeyup','onclick','ontouchstart','onmousedown','onpointerdown'].forEach(function(p){if(window[p]||document[p])R.listeners[p.slice(2)]=(R.listeners[p.slice(2)]||0)+1;});
 R.inline=document.querySelectorAll('[onclick],[ontouchstart],[onpointerdown],[onmousedown]').length;
 var pre=document.createElement('pre');pre.id='__nova_report';pre.style.display='none';pre.textContent=JSON.stringify(R);document.body.appendChild(pre);}
add.call(document,'DOMContentLoaded',function(){var b=document.body,ev=new Event('load');
 if(b&&b.getAttribute('onload')){try{loads.push(new Function('event',b.getAttribute('onload')));}catch(e){R.errors.push('onload: '+e.message);}b.removeAttribute('onload');}
 setTimeout(function(){loads.concat(onl?[onl]:[]).forEach(function(f){setTimeout(function(){f.call(window,ev);},0);});},50);
 setTimeout(function(){start();t0=Date.now();
  setTimeout(function(){a={c:snap(),d:dom()};var iv=setInterval(tick,120);
   setTimeout(function(){clearInterval(iv);finish();},3600);},400);},450);});
})();"""


GIF = bytes.fromhex("47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b")
_slow = {}


def _slow_port() -> int:
    """Winziger lokaler Server, der ein 1×1-Bild absichtlich spät liefert (hält „load“ offen)."""
    if not _slow.get("port"):
        import time
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

        class Slow(BaseHTTPRequestHandler):
            def do_GET(self):
                m = re.search(r"ms=(\d+)", self.path)
                time.sleep(min(int(m.group(1)) if m else 5000, 15000) / 1000)
                self.send_response(200)
                self.send_header("Content-Type", "image/gif")
                self.send_header("Content-Length", str(len(GIF)))
                self.end_headers()
                self.wfile.write(GIF)

            def log_message(self, *a):
                pass

        srv = ThreadingHTTPServer(("127.0.0.1", 0), Slow)
        srv.daemon_threads = True
        threading.Thread(target=srv.serve_forever, daemon=True, name="spieltest").start()
        _slow["port"] = srv.server_address[1]
    return _slow["port"]


def _chrome() -> str:
    exe = next((b for b in BROWSERS if b and os.path.isfile(b)), None)
    if not exe:
        raise GameError("Kein Chrome/Edge gefunden – Test nicht möglich.")
    return exe


def _run_chrome(exe: str, url: str, extra: list[str], timeout: int = 60) -> bytes:
    profile = tempfile.mkdtemp(prefix="nova-spieltest-")
    try:
        p = subprocess.run([exe, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
                            "--mute-audio", "--autoplay-policy=no-user-gesture-required", f"--user-data-dir={profile}",
                            "--window-size=500,1000", "--disable-gpu", *extra, url],
                           capture_output=True, timeout=timeout, creationflags=CREATE_NO_WINDOW, stdin=subprocess.DEVNULL)
        return p.stdout or b""
    except subprocess.TimeoutExpired:
        raise GameError("Der Test hat zu lange gedauert – hängt das Spiel in einer Endlosschleife?")
    finally:
        shutil.rmtree(profile, ignore_errors=True)


def test(path: Path, shot: Path | None = None) -> dict:
    """Spielt das Spiel ~4 s im unsichtbaren Chrome (Handy-Format) und liefert einen Bericht (+ Bildschirmfoto)."""
    exe = _chrome()
    html = path.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"<head[^>]*>", html, re.I)
    tag = "<script>" + re.sub(r"[\r\n]+", "", HARNESS) + "</script>"
    html = html[:m.end()] + tag + html[m.end():] if m else tag + html
    hold = f'<img src="http://127.0.0.1:{_slow_port()}/slow?ms=5600" alt="" style="display:none">'
    i = html.lower().rfind("</body>")
    html = html[:i] + hold + html[i:] if i >= 0 else html + hold
    tmp = Path(tempfile.mkdtemp(prefix="nova-spiel-"))
    try:
        page = tmp / "test.html"
        for f in path.parent.iterdir():  # Bilder/Sounds neben dem Spiel mitnehmen
            if f.is_file() and f.name != path.name and f.stat().st_size < 20_000_000:
                shutil.copy(f, tmp / f.name)
        page.write_text(html, encoding="utf-8")
        url = page.as_uri()
        out: dict = {}

        def shoot():
            if shot:
                shot.parent.mkdir(parents=True, exist_ok=True)
                try:
                    _run_chrome(exe, url, [f"--screenshot={shot}", "--hide-scrollbars"])
                except GameError:
                    pass

        th = threading.Thread(target=shoot, daemon=True)
        th.start()
        dom = _run_chrome(exe, url, ["--dump-dom"]).decode("utf-8", "replace")
        th.join(70)
        rm = re.search(r'<pre id="__nova_report"[^>]*>(.*?)</pre>', dom, re.S)
        if not rm:
            out = {"errors": ["Kein Testbericht – die Seite ist beim Laden hängen geblieben oder komplett kaputt."],
                   "frames": 0, "broken": True}
        else:
            import html as _h
            out = json.loads(_h.unescape(rm.group(1)))
        out["errors"] = _clean_errors(out.get("errors") or [], path.read_text(encoding="utf-8", errors="replace"))
        out["shot"] = str(shot) if shot and shot.is_file() else ""
        return out
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _clean_errors(errors: list, source: str) -> list:
    """Stacktraces kürzen, doppelte weg, Zeilen auf den Spiel-Code umrechnen (den hat die KI geschrieben)."""
    lines = source.splitlines()
    start = next((i + 1 for i, l in enumerate(lines) if START in l), 0)  # 1-basiert: Zeile der Markierung

    def where(n: int) -> str:
        if start and n > start:
            return f"Zeile {n - start} im Spiel-Code: {lines[n - 1].strip()[:90]}"
        return f"Zeile {n}: {lines[n - 1].strip()[:90]}" if 0 < n <= len(lines) else f"Zeile {n}"

    out = []
    for e in errors:
        e = str(e).replace("Fehler im Spiel: ", "")
        m = re.search(r"test\.html:(\d+):\d+", e) or re.search(r"\(Zeile (\d+)\)", e)
        msg = e.split("\n")[0]
        msg = re.sub(r"\s*\(Zeile \d+\)$", "", msg).strip()
        if m:
            msg += f" ({where(int(m.group(1)))})"
        if msg not in out and "favicon" not in msg.lower():
            out.append(msg[:300])
    return out[:4]


def judge(rep: dict) -> tuple[bool, str]:
    """Bericht → (ok, Text für die KI)."""
    L = rep.get("listeners") or {}
    errors = rep.get("errors") or []
    keys = any(L.get(k) for k in ("keydown", "keyup", "keypress"))
    touch = any(L.get(k) for k in ("touchstart", "pointerdown", "mousedown", "click")) or rep.get("inline")
    problems = []
    lines = ["Test im unsichtbaren Chrome (hochkant 500×1000, Start gedrückt, ~4 s Tasten + Tippen simuliert):"]
    if errors:
        lines.append("- FEHLER: " + " | ".join(errors))
        problems.append("JavaScript-Fehler beheben")
    else:
        lines.append("- Fehler: keine ✓")
    frames = rep.get("frames") or 0
    lines.append(f"- Spielschleife: {frames} Bilder" + (" ✓" if frames > 30 else " ✗ (läuft nicht)"))
    if frames <= 30:
        problems.append("Spielschleife läuft nicht")
    if rep.get("changed") is False and not rep.get("domChanged"):
        lines.append("- Bild bewegt sich beim Spielen: NEIN ✗")
        problems.append("nach dem Start bewegt sich nichts")
    elif rep.get("changed") is not None or rep.get("domChanged"):
        lines.append("- Bild bewegt sich beim Spielen: ja ✓")
    lines.append(f"- Steuerung: Tastatur {'✓' if keys else '✗'} · Touch/Maus {'✓' if touch else '✗ (am Handy nicht spielbar!)'}")
    if not touch:
        problems.append("keine Touch-Steuerung")
    if rep.get("clicked") is not None:
        lines.append(f"- Start-Knopf: „{rep['clicked']}“ gedrückt")
    st = rep.get("state")
    if st:
        lines.append(f"- Stand nach dem Test: {st.get('mode')}, {st.get('score')} Punkte, {st.get('lives')} Leben")
        if rep.get("overAt") is not None and rep["overAt"] < 3 and not errors:
            lines.append(f"- Game Over schon nach {rep['overAt']} s – vermutlich zu schwer oder Kollision von Anfang an")
            problems.append("Game Over kommt sofort")
        if st.get("mode") == "play" and not st.get("score") and not rep.get("overAt"):
            lines.append("- Hinweis: in 4 s kein einziger Punkt – prüfen, ob Punkte/Treffer überhaupt möglich sind")
    ok = not problems
    lines.append("ERGEBNIS: OK – spielbar." if ok else "ERGEBNIS: PROBLEME – " + "; ".join(problems) + ". Beheben und erneut testen.")
    return ok, "\n".join(lines)
