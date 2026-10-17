"""Werkzeuge des Agenten.

Jedes Werkzeug ist eine Funktion (args: dict, ctx: ToolContext) -> str.
TOOL_SPECS beschreibt sie im OpenAI-Format für llama-server.
approval_reason() entscheidet, ob der Nutzer am Handy zustimmen muss.
"""

import ast
import ctypes
import html
import ipaddress
import json
import math
import operator
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from html.parser import HTMLParser
from pathlib import Path

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")
CREATE_NO_WINDOW = 0x08000000
CREATE_BREAKAWAY_FROM_JOB = 0x01000000
MAX_RESULT = 4500
WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]


class ToolError(Exception):
    pass


class ToolContext:
    def __init__(self, workspace: Path, memory_path: Path, python_exe: str):
        self.workspace = workspace
        self.memory_path = memory_path
        self.python_exe = python_exe


# ---------------------------------------------------------------- Hilfsfunktionen

def _clip(text: str, limit: int = MAX_RESULT) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n\n[... gekürzt, {len(text) - limit} Zeichen ausgelassen]"


def _check_public_host(url: str) -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ToolError("Nur http- und https-Adressen sind erlaubt.")
    host = parsed.hostname
    if not host:
        raise ToolError("Ungültige Adresse.")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise ToolError(f"Adresse {host} nicht gefunden.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ToolError("Lokale oder private Netzwerkadressen sind gesperrt.")


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _check_public_host(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = urllib.request.build_opener(_SafeRedirect)


def _fetch(url: str, data: bytes | None = None, headers: dict | None = None,
           timeout: int = 20, max_bytes: int = 3_000_000):
    _check_public_host(url)
    hdrs = {"User-Agent": UA, "Accept-Language": "de-DE,de;q=0.9,en;q=0.7"}
    hdrs.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=hdrs)
    try:
        with _opener.open(req, timeout=timeout) as resp:
            raw = resp.read(max_bytes)
            charset = resp.headers.get_content_charset() or "utf-8"
            return raw, resp.headers.get("Content-Type", ""), charset, resp.geturl()
    except urllib.error.HTTPError as e:
        raise ToolError(f"HTTP-Fehler {e.code} bei {url}")
    except urllib.error.URLError as e:
        raise ToolError(f"Verbindung fehlgeschlagen: {e.reason}")
    except TimeoutError:
        raise ToolError("Zeitüberschreitung beim Laden.")


def _fetch_json(url: str, **kw):
    raw, _, charset, _ = _fetch(url, headers={"Accept": "application/json"}, **kw)
    return json.loads(raw.decode(charset, "replace"))


class _TextExtractor(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "nav", "footer", "form", "iframe",
            "template", "aside", "button", "select"}
    BLOCK = {"p", "div", "br", "li", "tr", "section", "article", "header", "blockquote",
             "pre", "table", "ul", "ol", "dd", "dt", "figcaption", "main"}
    HEADINGS = {"h1", "h2", "h3", "h4", "h5", "h6"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.main_parts: list[str] = []  # nur Text innerhalb von <main>/<article>
        self.skip = 0
        self.main = 0
        self.title = ""
        self._in_title = False

    def _add(self, s):
        self.parts.append(s)
        if self.main:
            self.main_parts.append(s)

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = not self.title  # nur der erste <title> (nicht die in SVG-Icons)
        elif tag in self.SKIP:
            self.skip += 1
        elif tag in ("main", "article"):
            self.main += 1
        elif tag in self.HEADINGS:
            self._add("\n\n## ")
        elif tag in self.BLOCK:
            self._add("\n")
            if tag == "li":
                self._add("• ")

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag in self.SKIP:
            self.skip = max(0, self.skip - 1)
        elif tag in ("main", "article"):
            self.main = max(0, self.main - 1)
        elif tag in self.HEADINGS or tag in self.BLOCK:
            self._add("\n")

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self.skip:
            self._add(data)

    def text(self) -> str:
        main = "".join(self.main_parts)
        raw = main if len(main.strip()) > 400 else "".join(self.parts)
        lines = [re.sub(r"[ \t\r\f\v ]+", " ", ln).strip() for ln in raw.split("\n")]
        out, blank = [], 0
        for ln in lines:
            if ln and ln not in ("##", "•"):
                out.append(ln)
                blank = 0
            elif blank == 0:
                out.append("")
                blank = 1
        return "\n".join(out).strip()


def _strip_tags(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def _resolve(path: str, ctx: ToolContext) -> Path:
    p = Path(os.path.expandvars(os.path.expanduser(path or ".")))
    if not p.is_absolute():
        p = ctx.workspace / p
    return p.resolve()


def _inside_workspace(p: Path, ctx: ToolContext) -> bool:
    ws = ctx.workspace.resolve()
    return p == ws or ws in p.parents


def _decode(b: bytes) -> str:
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        return b.decode("cp1252", "replace")


# ---------------------------------------------------------------- Werkzeuge: Web

def web_search(args, ctx):
    query = (args.get("query") or "").strip()
    if not query:
        raise ToolError("Leere Suchanfrage.")
    results = _search_duckduckgo(query)
    if not results:
        results = _search_bing(query)
    if not results:
        return "Keine Suchergebnisse gefunden."
    lines = [f"Suchergebnisse für: {query}\n"]
    for i, (title, url, snippet) in enumerate(results[:7], 1):
        lines.append(f"{i}. {title}\n   {url}\n   {snippet}")
    lines.append("\nTipp: Mit open_webpage kannst du ein Ergebnis im Detail lesen.")
    return "\n".join(lines)


def _search_duckduckgo(query):
    data = urllib.parse.urlencode({"q": query, "kl": "de-de"}).encode()
    try:
        raw, _, charset, _ = _fetch("https://html.duckduckgo.com/html/", data=data, headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": "https://html.duckduckgo.com/"})
    except ToolError:
        return []
    page = raw.decode(charset, "replace")
    results = []
    for block in re.split(r'class="[^"]*\bresult__body\b', page)[1:]:
        m = re.search(r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)
        if not m:
            continue
        href = html.unescape(m.group(1))
        if "duckduckgo.com/y.js" in href:  # Anzeige
            continue
        if "uddg=" in href:
            href = urllib.parse.parse_qs(urllib.parse.urlparse(href).query).get("uddg", [href])[0]
        if href.startswith("//"):
            href = "https:" + href
        sn = re.search(r'class="result__snippet"[^>]*>(.*?)</(?:a|div)>', block, re.S)
        results.append((_strip_tags(m.group(2)), href, _strip_tags(sn.group(1)) if sn else ""))
    return results


def _search_bing(query):
    url = "https://www.bing.com/search?" + urllib.parse.urlencode({"q": query, "setlang": "de", "cc": "DE"})
    try:
        raw, _, charset, _ = _fetch(url)
    except ToolError:
        return []
    page = raw.decode(charset, "replace")
    results = []
    for block in page.split('<li class="b_algo"')[1:]:
        m = re.search(r'<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)
        if not m:
            continue
        sn = re.search(r"<p[^>]*>(.*?)</p>", block, re.S)
        results.append((_strip_tags(m.group(2)), _bing_target(html.unescape(m.group(1))),
                        _strip_tags(sn.group(1)) if sn else ""))
    return results


def _bing_target(href):
    """Bing verpackt Ziele als /ck/a?...&u=a1<base64url>; das echte Ziel auspacken."""
    if "bing.com/ck/a" not in href:
        return href
    u = urllib.parse.parse_qs(urllib.parse.urlparse(href).query).get("u", [""])[0]
    if u.startswith("a1"):
        try:
            import base64
            b = u[2:]
            return base64.urlsafe_b64decode(b + "=" * (-len(b) % 4)).decode("utf-8")
        except ValueError:
            pass
    return href


BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    os.path.join(os.environ.get("LOCALAPPDATA", ""), r"Google\Chrome\Application\chrome.exe"),
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def _render_with_browser(url: str, timeout: int = 40) -> str | None:
    """Lädt eine Seite unsichtbar im installierten Chrome/Edge (für Seiten, die erst per JavaScript Inhalt zeigen).
    Eigenes Wegwerf-Profil – das normale Browser-Profil des Nutzers bleibt unberührt."""
    exe = next((b for b in BROWSERS if b and os.path.isfile(b)), None)
    if not exe:
        return None
    import tempfile
    profile = tempfile.mkdtemp(prefix="nova-browser-")
    try:
        p = subprocess.run([exe, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                            "--disable-extensions", "--mute-audio", f"--user-data-dir={profile}",
                            "--virtual-time-budget=9000", "--dump-dom", url],
                           capture_output=True, timeout=timeout, creationflags=CREATE_NO_WINDOW, stdin=subprocess.DEVNULL)
        return p.stdout.decode("utf-8", "replace") if p.stdout else None
    except (subprocess.TimeoutExpired, OSError):
        return None
    finally:
        shutil.rmtree(profile, ignore_errors=True)


def _html_to_text(html_text: str) -> tuple[str, str]:
    ex = _TextExtractor()
    try:
        ex.feed(html_text)
    except Exception:
        pass
    return ex.title.strip(), ex.text()


def _page_text(url: str, allow_browser: bool = True) -> tuple[str, str, str, str]:
    """(Titel, Text, End-Adresse, Weg). Erst schnell per HTTP, bei Sperre oder leerer JS-Seite per Browser."""
    title, text, final, how, err = "", "", url, "http", None
    try:
        raw, ctype, charset, final = _fetch(url)
        if not any(t in ctype for t in ("html", "text", "json", "xml")):
            return "", f"Die Adresse liefert keinen Text ({ctype or 'unbekannter Typ'}, {len(raw)} Bytes).", final, how
        decoded = raw.decode(charset, "replace")
        if "html" in ctype or "<html" in decoded[:2000].lower():
            title, text = _html_to_text(decoded)
        else:
            text = decoded
    except ToolError as e:
        err = e
    if allow_browser and len(text.strip()) < 600:
        rendered = _render_with_browser(final or url)
        if rendered:
            t2, x2 = _html_to_text(rendered)
            if len(x2.strip()) > len(text.strip()):
                title, text, how = t2 or title, x2, "browser"
    if err and not text.strip():
        raise err
    return title, text, final, how


def open_webpage(args, ctx):
    url = (args.get("url") or "").strip()
    if not re.match(r"^https?://", url):
        url = "https://" + url
    _check_public_host(url)
    title, text, final_url, how = _page_text(url)
    head = f"Seite: {title}\n" if title else ""
    note = " (per Browser geladen)" if how == "browser" else ""
    return head + f"Adresse: {final_url}{note}\n\n" + _clip(text, 5000)


_STOP = set("der die das und oder ein eine einer eines ist sind war wer was wie wo wann warum the a an of to in on for is are was who what how when why with von zu im in am an auf für mit bei aus".split())


def _best_passages(text: str, query: str, n: int = 3, size: int = 700) -> list[str]:
    terms = {w for w in re.findall(r"\w{3,}", query.lower()) if w not in _STOP}
    paras = [p.strip() for p in re.split(r"\n\s*\n|\n(?=## )", text) if len(p.strip()) > 60]
    scored = []
    for i, p in enumerate(paras):
        words = re.findall(r"\w+", p.lower())
        hits = sum(1 for w in words if w in terms)
        scored.append((hits / (1 + len(words) ** 0.5) + (0.2 if i < 3 else 0), i, p))
    best = sorted(scored, reverse=True)[:n]
    return [p[:size] for _, _, p in sorted(best, key=lambda s: s[1])]


def _md_inline(t: str) -> str:
    t = html.escape(t)
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"(?<!\*)\*(?!\s)(.+?)\*", r"<i>\1</i>", t)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    return re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r'<a href="\2">\1</a>', t)


def markdown_to_html(md: str, title: str) -> str:
    out, in_list, para = [], None, []

    def flush():
        nonlocal para
        if para:
            out.append("<p>" + "<br>".join(_md_inline(x) for x in para) + "</p>")
            para = []

    for line in md.splitlines():
        s = line.rstrip()
        m_h = re.match(r"^(#{1,4})\s+(.*)", s)
        m_l = re.match(r"^\s*([-*•]|\d+[.)])\s+(.*)", s)
        if m_h or m_l or not s.strip():
            flush()
        if in_list and not m_l:
            out.append(f"</{in_list}>")
            in_list = None
        if m_h:
            n = len(m_h.group(1))
            out.append(f"<h{n}>{_md_inline(m_h.group(2))}</h{n}>")
        elif m_l:
            kind = "ol" if m_l.group(1)[0].isdigit() else "ul"
            if in_list != kind:
                if in_list:
                    out.append(f"</{in_list}>")
                out.append(f"<{kind}>")
                in_list = kind
            out.append(f"<li>{_md_inline(m_l.group(2))}</li>")
        elif s.strip():
            para.append(s.strip())
    flush()
    if in_list:
        out.append(f"</{in_list}>")
    css = ("body{font-family:'Segoe UI',Arial,sans-serif;max-width:720px;margin:40px auto;padding:0 24px;color:#1b1d23;"
           "line-height:1.55;font-size:12pt}h1{font-size:22pt;margin:0 0 6px}h2{font-size:15pt;margin:22px 0 6px;"
           "color:#3b3f9e}h3{font-size:12.5pt}p{margin:0 0 10px}li{margin:3px 0}code{background:#f0f1f6;padding:1px 4px;"
           "border-radius:4px}.meta{color:#666;font-size:9.5pt;margin-bottom:22px}")
    return (f"<!doctype html><html lang='de'><head><meta charset='utf-8'><title>{html.escape(title)}</title>"
            f"<style>{css}</style></head><body><h1>{html.escape(title)}</h1>"
            f"<div class='meta'>{time.strftime('%d.%m.%Y')}</div>{''.join(out)}</body></html>")


def make_document(args, ctx):
    title = str(args.get("title") or "Dokument").strip()
    content = str(args.get("content") or "")
    fmt = str(args.get("format") or "pdf").lower()
    folder = ctx.workspace / "Dokumente"
    folder.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r'[\\/:*?"<>|]+', "_", title)[:60] or "Dokument"
    html_path = folder / f"{safe}.html"
    html_path.write_text(markdown_to_html(content, title), encoding="utf-8")
    if fmt != "pdf":
        return f"Dokument gespeichert: {html_path}"
    exe = next((b for b in BROWSERS if b and os.path.isfile(b)), None)
    if not exe:
        return f"Kein Chrome/Edge für PDF gefunden – als HTML gespeichert: {html_path}"
    pdf = folder / f"{safe}.pdf"
    import tempfile
    profile = tempfile.mkdtemp(prefix="nova-pdf-")
    try:
        subprocess.run([exe, "--headless=new", "--disable-gpu", "--no-first-run", f"--user-data-dir={profile}",
                        "--no-pdf-header-footer", f"--print-to-pdf={pdf}", html_path.resolve().as_uri()],
                       capture_output=True, timeout=90, creationflags=CREATE_NO_WINDOW, stdin=subprocess.DEVNULL)
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    if not pdf.is_file():
        raise ToolError("PDF konnte nicht erstellt werden.")
    return f"PDF erstellt: {pdf.name} ({_human(pdf.stat().st_size)}).\nPfad: {pdf}"


def research(args, ctx):
    """Sucht, liest mehrere Quellen parallel und liefert die passendsten Absätze mit Quellennummern."""
    query = (args.get("query") or "").strip()
    if not query:
        raise ToolError("Frage fehlt.")
    hits = _search_duckduckgo(query) or _search_bing(query)
    seen, picks = set(), []
    for title, url, snippet in hits:
        host = urllib.parse.urlparse(url).hostname or ""
        if host in seen or not url.startswith("http") or any(b in host for b in ("youtube.com", "facebook.com", "instagram.com", "tiktok.com")):
            continue
        seen.add(host)
        picks.append((title, url, snippet))
        if len(picks) >= 4:
            break
    if not picks:
        return "Keine Quellen gefunden."
    from concurrent.futures import ThreadPoolExecutor

    def read(item):
        title, url, snippet = item
        try:
            t, text, final, _ = _page_text(url, allow_browser=False)
            return title or t, final, _best_passages(text, query) or [snippet]
        except ToolError:
            return title, url, [snippet] if snippet else []

    with ThreadPoolExecutor(max_workers=4) as pool:
        sources = list(pool.map(read, picks))
    out = [f"Recherche: {query}\n"]
    for i, (title, url, passages) in enumerate(sources, 1):
        if passages:
            out.append(f"[{i}] {title}\n{url}\n" + "\n…\n".join(passages))
    out.append("\nAntworte nur mit dem, was in diesen Quellen steht, und nenne die Quellen als [1], [2] … "
               "Widersprechen sich Quellen, sag das.")
    return _clip("\n\n".join(out), 5500)


def wikipedia(args, ctx):
    query = (args.get("query") or "").strip()
    lang = (args.get("lang") or "de").strip().lower()
    if not re.fullmatch(r"[a-z]{2,3}", lang):
        lang = "de"
    api = f"https://{lang}.wikipedia.org/w/api.php?"
    found = _fetch_json(api + urllib.parse.urlencode({
        "action": "query", "list": "search", "srsearch": query, "srlimit": 4, "format": "json"}))
    hits = found.get("query", {}).get("search", [])
    if not hits:
        return f"Kein Wikipedia-Artikel zu '{query}' gefunden."
    title = hits[0]["title"]
    data = _fetch_json(api + urllib.parse.urlencode({
        "action": "query", "prop": "extracts", "explaintext": 1, "redirects": 1,
        "titles": title, "format": "json"}))
    page = next(iter(data.get("query", {}).get("pages", {}).values()), {})
    extract = page.get("extract", "")
    link = f"https://{lang}.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
    others = ", ".join(h["title"] for h in hits[1:])
    out = f"# {title}\n{link}\n\n{_clip(extract, 7000)}"
    if others:
        out += f"\n\nWeitere Treffer: {others}"
    return out


WEATHER_CODES = {
    0: "klar", 1: "überwiegend klar", 2: "teils bewölkt", 3: "bedeckt", 45: "Nebel", 48: "Reifnebel",
    51: "leichter Nieselregen", 53: "Nieselregen", 55: "starker Nieselregen", 56: "gefrierender Niesel",
    57: "starker gefrierender Niesel", 61: "leichter Regen", 63: "Regen", 65: "starker Regen",
    66: "gefrierender Regen", 67: "starker gefrierender Regen", 71: "leichter Schneefall", 73: "Schneefall",
    75: "starker Schneefall", 77: "Schneegriesel", 80: "leichte Regenschauer", 81: "Regenschauer",
    82: "heftige Regenschauer", 85: "Schneeschauer", 86: "starke Schneeschauer", 95: "Gewitter",
    96: "Gewitter mit Hagel", 99: "schweres Gewitter mit Hagel",
}


def weather(args, ctx):
    place = (args.get("location") or "").strip()
    if not place:
        raise ToolError("Ort fehlt.")
    geo = _fetch_json("https://geocoding-api.open-meteo.com/v1/search?" + urllib.parse.urlencode(
        {"name": place, "count": 1, "language": "de", "format": "json"}))
    if not geo.get("results"):
        return f"Ort '{place}' nicht gefunden."
    g = geo["results"][0]
    fc = _fetch_json("https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode({
        "latitude": g["latitude"], "longitude": g["longitude"], "timezone": "auto", "forecast_days": 4,
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    }))
    c = fc["current"]
    name = ", ".join(x for x in (g.get("name"), g.get("admin1"), g.get("country")) if x)
    lines = [f"Wetter in {name} (Stand {c['time'].replace('T', ' ')}):",
             f"Jetzt: {c['temperature_2m']} °C (gefühlt {c['apparent_temperature']} °C), "
             f"{WEATHER_CODES.get(c['weather_code'], 'unbekannt')}, Wind {c['wind_speed_10m']} km/h, "
             f"Luftfeuchte {c['relative_humidity_2m']} %, Niederschlag {c['precipitation']} mm", "", "Vorhersage:"]
    d = fc["daily"]
    for i, day in enumerate(d["time"]):
        lines.append(f"- {day}: {WEATHER_CODES.get(d['weather_code'][i], '?')}, "
                     f"{d['temperature_2m_min'][i]} bis {d['temperature_2m_max'][i]} °C, "
                     f"Regenrisiko {d['precipitation_probability_max'][i]} %, "
                     f"Sonne {d['sunrise'][i][-5:]}–{d['sunset'][i][-5:]}")
    lines.append("Quelle: open-meteo.com")
    return "\n".join(lines)


# ---------------------------------------------------------------- Werkzeuge: Rechnen & Code

_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod, ast.Pow: operator.pow,
        ast.USub: operator.neg, ast.UAdd: operator.pos}
_FUNCS = {n: getattr(math, n) for n in ("sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "log",
                                         "log10", "log2", "exp", "floor", "ceil", "factorial", "radians",
                                         "degrees", "hypot", "gcd")}
_FUNCS.update({"abs": abs, "round": round, "min": min, "max": max})
_NAMES = {"pi": math.pi, "e": math.e, "tau": math.tau}


def _eval_node(node):
    if isinstance(node, ast.Expression):
        return _eval_node(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        left, right = _eval_node(node.left), _eval_node(node.right)
        if isinstance(node.op, ast.Pow) and (abs(right) > 2000 or abs(left) > 1e12):
            raise ToolError("Zahl zu groß.")
        return _OPS[type(node.op)](left, right)
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_eval_node(node.operand))
    if isinstance(node, ast.Name) and node.id in _NAMES:
        return _NAMES[node.id]
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCS:
        vals = [_eval_node(a) for a in node.args]
        if node.func.id == "factorial" and vals and vals[0] > 1000:
            raise ToolError("Zahl zu groß.")
        return _FUNCS[node.func.id](*vals)
    raise ToolError("Nicht erlaubter Ausdruck. Erlaubt: Zahlen, + - * / // % **, Klammern, math-Funktionen.")


def _normalize_expr(expr: str) -> str:
    expr = expr.replace("^", "**").replace("×", "*").replace("÷", "/").replace("·", "*")
    if "(" not in expr:
        expr = re.sub(r"(\d),(\d)", r"\1.\2", expr)          # 17,5 -> 17.5
    expr = re.sub(r"\b(von|of)\b", "*", expr, flags=re.I)    # 17.5 % von 240
    expr = re.sub(r"(\d+(?:\.\d+)?)\s*%", r"(\1/100)", expr)  # 17.5% -> (17.5/100)
    return re.sub(r"\bmod\b", "%", expr)                       # Modulo als "mod"


def calculate(args, ctx):
    original = (args.get("expression") or "").strip()
    expr = _normalize_expr(original)
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError:
        raise ToolError("Ausdruck ist ungültig.")
    value = _eval_node(tree)
    if isinstance(value, float):
        value = round(value, 10)
        if value.is_integer() and abs(value) < 1e15:
            value = int(value)
    return f"{original} = {value}"


def _run_process(cmd, ctx, timeout, cwd=None):
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    workdir = _resolve(cwd, ctx) if cwd else ctx.workspace
    if not workdir.is_dir():
        raise ToolError(f"Arbeitsordner nicht gefunden: {workdir}")
    try:
        p = subprocess.run(cmd, cwd=workdir, capture_output=True, timeout=timeout,
                           creationflags=CREATE_NO_WINDOW, env=env, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired as e:
        out = _decode(e.stdout or b"") + _decode(e.stderr or b"")
        return f"Abgebrochen nach {timeout} s (Zeitlimit).\n{_clip(out, 3000)}"
    out = _decode(p.stdout)
    err = _decode(p.stderr)
    parts = [f"Exit-Code: {p.returncode}"]
    if out.strip():
        parts.append("Ausgabe:\n" + _clip(out, 6000))
    if err.strip():
        parts.append("Fehler/Stderr:\n" + _clip(err, 3000))
    if not out.strip() and not err.strip():
        parts.append("(keine Ausgabe)")
    return "\n".join(parts)


def run_python(args, ctx):
    code = args.get("code") or ""
    runs = ctx.workspace / ".runs"
    runs.mkdir(parents=True, exist_ok=True)
    script = runs / f"run_{time.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:4]}.py"
    script.write_text(code, encoding="utf-8")
    return _run_process([ctx.python_exe, "-X", "utf8", str(script)], ctx, timeout=180, cwd=args.get("cwd"))


def run_powershell(args, ctx):
    command = args.get("command") or ""
    prefix = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; "
    return _run_process(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                         "-Command", prefix + command], ctx, timeout=180, cwd=args.get("cwd"))


NODE = Path(os.environ.get("USERPROFILE", "")) / "nodejs-portable" / "node-v22.14.0-win-x64" / "node.exe"


def run_node(args, ctx):
    node = NODE if NODE.is_file() else shutil.which("node")
    if not node:
        raise ToolError("Node.js ist nicht installiert.")
    code = args.get("code") or ""
    if len(code) > 30000:
        raise ToolError("Code zu lang für run_node – als Datei speichern und mit run_powershell 'node datei.mjs' starten.")
    # --eval: relative Importe beziehen sich dann auf den Arbeitsordner (cwd), nicht auf einen Hilfsordner
    return _run_process([str(node), "--input-type=module", "--eval", code], ctx, timeout=120, cwd=args.get("cwd"))


SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".venv", "venv", ".runs", "dist", "build", ".next", ".cache"}


def project_tree(args, ctx):
    root = _resolve(args.get("path") or ".", ctx)
    if not root.is_dir():
        raise ToolError(f"Ordner nicht gefunden: {root}")
    depth = max(1, min(int(args.get("depth") or 3), 6))
    lines, count = [str(root)], 0

    def walk(d: Path, level: int, prefix: str):
        nonlocal count
        try:
            items = sorted(d.iterdir(), key=lambda c: (not c.is_dir(), c.name.lower()))
        except OSError:
            return
        for c in items:
            if count >= 400:
                return
            if c.name in SKIP_DIRS:
                continue
            count += 1
            if c.is_dir():
                lines.append(f"{prefix}{c.name}/")
                if level < depth:
                    walk(c, level + 1, prefix + "  ")
            else:
                lines.append(f"{prefix}{c.name}  ({_human(c.stat().st_size)})")

    walk(root, 1, "  ")
    if count >= 400:
        lines.append("  … (gekürzt)")
    return "\n".join(lines)


def find_in_files(args, ctx):
    root = _resolve(args.get("path") or ".", ctx)
    pattern = args.get("pattern") or ""
    try:
        rx = re.compile(pattern, re.I)
    except re.error:
        rx = re.compile(re.escape(pattern), re.I)
    glob = args.get("glob") or "*"
    hits = []
    files = [root] if root.is_file() else root.rglob(glob)
    for f in files:
        if len(hits) >= 120:
            break
        if not f.is_file() or any(part in SKIP_DIRS for part in f.parts) or f.stat().st_size > 2_000_000:
            continue
        try:
            raw = f.read_bytes()
        except OSError:
            continue
        if b"\x00" in raw[:2000]:
            continue
        for n, line in enumerate(_decode(raw).splitlines(), 1):
            if rx.search(line):
                hits.append(f"{f.relative_to(root) if root.is_dir() else f.name}:{n}: {line.strip()[:200]}")
                if len(hits) >= 120:
                    break
    return "\n".join(hits) if hits else f"Nichts gefunden für „{pattern}“."


def edit_file(args, ctx):
    p = _resolve(args.get("path") or "", ctx)
    if not p.is_file():
        raise ToolError(f"Datei nicht gefunden: {p}")
    old, new = args.get("old") or "", args.get("new") or ""
    text = _decode(p.read_bytes())
    if not old:
        raise ToolError("old (der zu ersetzende Text) fehlt.")
    n = text.count(old)
    if n == 0:
        raise ToolError("Der Text in 'old' kommt in der Datei nicht vor – erst read_file und genau kopieren.")
    if n > 1 and not args.get("replace_all"):
        raise ToolError(f"'old' kommt {n}× vor – mehr Kontext angeben oder replace_all=true.")
    p.write_text(text.replace(old, new) if args.get("replace_all") else text.replace(old, new, 1), encoding="utf-8")
    return f"{p.name}: {n if args.get('replace_all') else 1} Stelle(n) geändert."


# ---------------------------------------------------------------- Werkzeuge: Dateien & Laptop

def list_files(args, ctx):
    p = _resolve(args.get("path") or ".", ctx)
    if not p.exists():
        raise ToolError(f"Ordner nicht gefunden: {p}")
    if p.is_file():
        return f"{p} ist eine Datei ({p.stat().st_size} Bytes)."
    entries = []
    for child in sorted(p.iterdir(), key=lambda c: (not c.is_dir(), c.name.lower())):
        if child.name.startswith(".runs"):
            continue
        try:
            if child.is_dir():
                entries.append(f"[Ordner] {child.name}")
            else:
                entries.append(f"{child.name}  ({_human(child.stat().st_size)})")
        except OSError:
            continue
        if len(entries) >= 300:
            entries.append("... (weitere ausgelassen)")
            break
    return f"Inhalt von {p}:\n" + ("\n".join(entries) if entries else "(leer)")


def _human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def read_file(args, ctx):
    p = _resolve(args.get("path") or "", ctx)
    if not p.is_file():
        raise ToolError(f"Datei nicht gefunden: {p}")
    size = p.stat().st_size
    if size > 5_000_000:
        raise ToolError(f"Datei zu groß ({_human(size)}).")
    raw = p.read_bytes()
    if b"\x00" in raw[:4000]:
        return f"{p} ist eine Binärdatei ({_human(size)}), kein Text."
    return f"Datei {p} ({_human(size)}):\n\n" + _clip(_decode(raw), 12000)


def write_file(args, ctx):
    p = _resolve(args.get("path") or "", ctx)
    content = args.get("content") or ""
    p.parent.mkdir(parents=True, exist_ok=True)
    mode = "a" if args.get("append") else "w"
    with open(p, mode, encoding="utf-8", newline="") as f:
        f.write(content)
    verb = "angehängt an" if mode == "a" else "gespeichert in"
    return f"{len(content)} Zeichen {verb} {p}"


def open_on_laptop(args, ctx):
    target = (args.get("target") or "").strip()
    if not target:
        raise ToolError("Ziel fehlt.")
    if not re.match(r"^[a-z]+://", target, re.I):
        candidate = _resolve(target, ctx)
        if candidate.exists():
            target = str(candidate)
    cmd = ["cmd.exe", "/c", "start", "", target]
    try:
        subprocess.Popen(cmd, creationflags=CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB)
    except OSError:
        subprocess.Popen(cmd, creationflags=CREATE_NO_WINDOW)
    return f"Auf dem Laptop geöffnet: {target}"


class _PowerStatus(ctypes.Structure):
    _fields_ = [("ACLineStatus", ctypes.c_ubyte), ("BatteryFlag", ctypes.c_ubyte),
                ("BatteryLifePercent", ctypes.c_ubyte), ("SystemStatusFlag", ctypes.c_ubyte),
                ("BatteryLifeTime", ctypes.c_ulong), ("BatteryFullLifeTime", ctypes.c_ulong)]


class _MemStatus(ctypes.Structure):
    _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]


def _cpu_load(interval=0.4):
    k32 = ctypes.windll.kernel32
    def times():
        idle, kern, user = (ctypes.c_ulonglong() for _ in range(3))
        k32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kern), ctypes.byref(user))
        return idle.value, kern.value + user.value
    i1, t1 = times()
    time.sleep(interval)
    i2, t2 = times()
    total = t2 - t1
    return 0 if total <= 0 else round(100 * (1 - (i2 - i1) / total))


def laptop_status(args, ctx):
    k32 = ctypes.windll.kernel32
    ps = _PowerStatus()
    k32.GetSystemPowerStatus(ctypes.byref(ps))
    mem = _MemStatus()
    mem.dwLength = ctypes.sizeof(_MemStatus)
    k32.GlobalMemoryStatusEx(ctypes.byref(mem))
    k32.GetTickCount64.restype = ctypes.c_ulonglong
    up = k32.GetTickCount64() // 1000
    disk = shutil.disk_usage(os.environ.get("SystemDrive", "C:") + "\\")
    if ps.BatteryFlag == 128 or ps.BatteryLifePercent == 255:
        battery = "kein Akku erkannt"
    else:
        battery = f"{ps.BatteryLifePercent} %, " + ("lädt / am Netz" if ps.ACLineStatus == 1 else "im Akkubetrieb")
        if ps.ACLineStatus != 1 and ps.BatteryLifeTime not in (0xFFFFFFFF, -1):
            battery += f", noch ca. {ps.BatteryLifeTime // 3600} h {ps.BatteryLifeTime % 3600 // 60} min"
    return "\n".join([
        f"Akku: {battery}",
        f"CPU-Auslastung: {_cpu_load()} %",
        f"Arbeitsspeicher: {_human(mem.ullTotalPhys - mem.ullAvailPhys)} von {_human(mem.ullTotalPhys)} belegt ({mem.dwMemoryLoad} %)",
        f"Festplatte C: {_human(disk.free)} frei von {_human(disk.total)}",
        f"Läuft seit: {up // 86400} Tagen, {up % 86400 // 3600} h {up % 3600 // 60} min",
        f"Jetzt: {WEEKDAYS[time.localtime().tm_wday]}, {time.strftime('%d.%m.%Y, %H:%M:%S Uhr')}",
    ])


MEDIA_KEYS = {"play_pause": 0xB3, "next": 0xB0, "previous": 0xB1, "volume_up": 0xAF, "volume_down": 0xAE,
              "mute": 0xAD, "stop": 0xB2}


def media_control(args, ctx):
    action = str(args.get("action") or "").strip().lower()
    if action not in MEDIA_KEYS:
        raise ToolError("Unbekannte Aktion. Erlaubt: " + ", ".join(MEDIA_KEYS))
    times = max(1, min(int(args.get("times") or (5 if action.startswith("volume") else 1)), 50))
    user32 = ctypes.windll.user32
    for _ in range(times):
        user32.keybd_event(MEDIA_KEYS[action], 0, 0, 0)
        user32.keybd_event(MEDIA_KEYS[action], 0, 2, 0)  # KEYEVENTF_KEYUP
        time.sleep(0.03)
    note = f" ({times}× – jeder Schritt ≈ 2 %)" if action.startswith("volume") else ""
    return f"Medientaste '{action}' gedrückt{note}."


def lock_laptop(args, ctx):
    if not ctypes.windll.user32.LockWorkStation():
        raise ToolError("Sperren hat nicht geklappt.")
    return "Laptop ist gesperrt."


def download_file(args, ctx):
    url = (args.get("url") or "").strip()
    raw, ctype, _, final = _fetch(url, timeout=60, max_bytes=200_000_000)
    name = (args.get("filename") or "").strip() or urllib.parse.unquote(urllib.parse.urlparse(final).path.rsplit("/", 1)[-1]) or "download"
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name)[:120]
    folder = ctx.workspace / "Downloads"
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / name
    target.write_bytes(raw)
    return f"Heruntergeladen: {target} ({_human(len(raw))}, {ctype or 'unbekannter Typ'})"


# ---------------------------------------------------------------- Werkzeuge: Gedächtnis

def load_memory(ctx) -> list[dict]:
    try:
        return json.loads(ctx.memory_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []


def save_memory(ctx, items):
    ctx.memory_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = ctx.memory_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, ctx.memory_path)


def remember(args, ctx):
    fact = (args.get("fact") or "").strip()
    if not fact:
        raise ToolError("Nichts zum Merken angegeben.")
    items = load_memory(ctx)
    next_id = max((int(m["id"][1:]) for m in items if m["id"][1:].isdigit()), default=0) + 1
    items.append({"id": f"m{next_id}", "text": fact[:500], "created": time.strftime("%Y-%m-%d %H:%M")})
    save_memory(ctx, items)
    return f"Gemerkt als m{next_id}: {fact}"


def forget(args, ctx):
    mid = (args.get("id") or "").strip()
    items = load_memory(ctx)
    keep = [m for m in items if m["id"] != mid]
    if len(keep) == len(items):
        return f"Keine Erinnerung mit ID {mid} gefunden."
    save_memory(ctx, keep)
    return f"Erinnerung {mid} gelöscht."



# ---------------------------------------------------------------- Wissensspeicher

_KB = {}


def _kb(ctx):
    import knowledge
    folder = ctx.memory_path.parent / "knowledge"
    if folder not in _KB:
        _KB[folder] = knowledge.Knowledge(folder)
    return _KB[folder]


def knowledge_tool(args, ctx):
    import knowledge
    action = str(args.get("action") or "search").lower()
    try:
        if action == "add":
            return _kb(ctx).add(_resolve(args.get("path") or "", ctx))
        if action == "remove":
            return _kb(ctx).remove(str(args.get("path") or ""))
        if action == "list":
            return _kb(ctx).list()
        return _kb(ctx).search(str(args.get("query") or ""), int(args.get("n") or 6))
    except knowledge.KnowledgeError as e:
        raise ToolError(str(e))

# ---------------------------------------------------------------- Register

def _spec(name, desc, props=None, required=None):
    return {"type": "function", "function": {
        "name": name, "description": desc,
        "parameters": {"type": "object", "properties": props or {}, "required": required or []}}}


def _s(desc):
    return {"type": "string", "description": desc}


TOOL_SPECS = [
    _spec("web_search", "Search the internet. Use for current events, news, prices, facts you are unsure about.",
          {"query": _s("Search query")}, ["query"]),
    _spec("create_image", "Paint/draw/generate a picture locally. Write the prompt in ENGLISH as a detailed visual "
          "description (subject, style, colors, light), e.g. 'a cute red dragon flying over a medieval castle, "
          "digital art, vibrant colors, sunset light'.",
          {"prompt": _s("Detailed English image description"), "format": _s("square, portrait or landscape")},
          ["prompt"]),
    _spec("make_document", "Create a nicely formatted document (PDF by default) from Markdown text: letters, applications, "
          "reports, summaries, lists, plans. The user gets a download button.",
          {"title": _s("Document title"), "content": _s("Full text in Markdown (## headings, - lists, **bold**)"),
           "format": _s("pdf or html")}, ["title", "content"]),
    _spec("publish_web", "Make an HTML page/app/game from the workspace playable on the user's phone (gives a link "
          "button). First write the complete single-file HTML with write_file, then call this with its path.",
          {"path": _s("HTML file or folder in the workspace"), "title": _s("Short name")}, ["path"]),
    _spec("minecraft_shader","Build a custom Minecraft shaderpack (Iris, Java 26.3) from the user's tested packs and install "
          "it. action=options lists all settings of a base; action=create builds one; action=list shows installed packs. "
          "base: aurora (beautiful) or bedrush (PvP/Bedwars). style: warm|kalt|bunt|duester|hell|realistisch|traumhaft. "
          "profile: e.g. LAPTOP, MEDIUM, HIGH (aurora) or FPS, STANDARD, SCHOEN (bedrush). options: {OPTION: value or true/false}. "
          "Common aurora options: SHADOWS, BLOOM, GODRAYS, VIGNETTE, WAVING_LEAVES, WAVING_PLANTS, WATER_WAVES (true/false); "
          "WATER_WAVE_HEIGHT, WATER_REFLECTION, WIND_STRENGTH, SATURATION, EXPOSURE, FOG_DENSITY, TORCH_INTENSITY, "
          "NIGHT_BRIGHTNESS (numbers around 0.5–2.0). Usually call create directly.",
          {"action": _s("options, create or list"), "base": _s("aurora or bedrush"), "name": _s("Pack name"),
           "style": _s("Style preset"), "profile": _s("Profile name"),
           "options": {"type": "object", "description": "Option overrides, e.g. {\"SATURATION\": 1.25, \"BLOOM\": true}"},
           "activate": {"type": "boolean", "description": "Make it the active shaderpack (default true)"}}),
    _spec("make_video", "Create a video with narration: each scene gets a painted image, a spoken German text and "
          "subtitles. Use 3–6 scenes with 1–2 short sentences each. format: short (vertical, TikTok/Shorts) or wide (YouTube).",
          {"title": _s("Video title"), "format": _s("short or wide"),
           "scenes": {"type": "array", "description": "Scenes", "items": {"type": "object", "properties": {
               "text": _s("Spoken German text of the scene"),
               "image_prompt": _s("English image description for this scene")}}},
           "voice": {"type": "boolean", "description": "Speak the text (default true)"}}, ["scenes"]),
    _spec("record_screen", "Record the laptop screen as a video (e.g. Minecraft gameplay).",
          {"seconds": {"type": "integer", "description": "Length, 3–300 s"}, "name": _s("File name")}),
    _spec("edit_video", "Edit videos in the workspace: action cut (start,end like '00:00:05'), merge (inputs), gif, "
          "compress (smaller for sending) or music (add music file).",
          {"action": _s("cut, merge, gif, compress or music"), "input": _s("Video file"),
           "inputs": {"type": "array", "items": {"type": "string"}, "description": "Videos for merge"},
           "start": _s("Start time"), "end": _s("End time"), "music": _s("Music file"), "name": _s("Output name")}),
    _spec("research", "Research a factual question on the web: searches, reads several sources at once and returns "
          "the relevant passages with source numbers. Best for facts, results, news, prices.",
          {"query": _s("The question or search words")}, ["query"]),
    _spec("open_webpage", "Load a web page and return its readable text (also works for JavaScript-heavy sites).",
          {"url": _s("Full URL")}, ["url"]),
    _spec("wikipedia", "Look up a Wikipedia article.",
          {"query": _s("Topic"), "lang": _s("Language code, default 'de'")}, ["query"]),
    _spec("weather", "Current weather and 4-day forecast for a place.", {"location": _s("City or place")},
          ["location"]),
    _spec("calculate", "Evaluate a math expression exactly. Use for every calculation. Percent is supported: "
          "'17.5% * 240' means 17.5 percent of 240. Examples: '(12+8)*3', 'sqrt(2)*3', '19% * 49.99'.",
          {"expression": _s("Math expression")}, ["expression"]),
    _spec("run_python", "Run a Python 3 script on the laptop (working dir = workspace). Print results. "
          "Use for calculations, data, files, charts, automation.", {"code": _s("Complete Python code"),
          "cwd": _s("Optional working folder")}, ["code"]),
    _spec("run_powershell", "Run a PowerShell command on the Windows laptop (also git, npm, pip …).",
          {"command": _s("PowerShell command"), "cwd": _s("Optional working folder, e.g. a project folder")}, ["command"]),
    _spec("run_node", "Run JavaScript (Node.js 22, ES modules) on the laptop. Print results with console.log.",
          {"code": _s("Complete JavaScript code"), "cwd": _s("Optional working folder")}, ["code"]),
    _spec("edit_file", "Change part of a text/code file: replaces the exact text 'old' with 'new'. Read the file first. "
          "Better than rewriting whole files.", {"path": _s("File path"), "old": _s("Exact existing text"),
          "new": _s("Replacement text"), "replace_all": {"type": "boolean", "description": "Replace every occurrence"}},
          ["path", "old", "new"]),
    _spec("project_tree", "Show the folder/file tree of a project (skips node_modules, .git …).",
          {"path": _s("Folder"), "depth": {"type": "integer", "description": "Depth 1–6, default 3"}}),
    _spec("find_in_files", "Search text or a regex in all files of a folder (like grep). Shows file:line.",
          {"pattern": _s("Text or regex"), "path": _s("Folder or file"), "glob": _s("File filter, e.g. *.py")}, ["pattern"]),
    _spec("list_files", "List a folder on the laptop. Relative paths are inside the workspace.",
          {"path": _s("Folder path, default workspace")}),
    _spec("read_file", "Read a text file on the laptop.", {"path": _s("File path")}, ["path"]),
    _spec("write_file", "Create or overwrite a text file on the laptop (relative = workspace).",
          {"path": _s("File path"), "content": _s("Full file content"),
           "append": {"type": "boolean", "description": "Append instead of overwrite"}}, ["path", "content"]),
    _spec("open_on_laptop", "Open a URL, file, folder or program on the laptop screen.",
          {"target": _s("URL, path or program name")}, ["target"]),
    _spec("laptop_status", "Live laptop data: battery %, charging, CPU load, RAM, free disk, uptime, exact current "
          "time. You cannot know these values – always call this instead of guessing."),
    _spec("remember", "Save a long-term fact about the user for future chats.", {"fact": _s("The fact")}, ["fact"]),
    _spec("forget", "Delete a saved fact by its id (e.g. 'm3').", {"id": _s("Memory id")}, ["id"]),
    _spec("update_notes", "Overwrite your working notes for the current task: plan, progress, next steps, file names. "
          "Use regularly during long tasks.", {"notes": _s("Complete notes")}, ["notes"]),
    _spec("set_reminder", "Remind the user later with a phone notification (NOT for calendar entries – use phone_action "
          "type calendar for those). Give either minutes from now or a time.",
          {"text": _s("What to remind about"), "minutes": {"type": "number", "description": "Minutes from now"},
           "at": _s("Time like '18:30', 'morgen 08:00' or '2026-10-20 14:00'")}, ["text"]),
    _spec("reminders", "List open reminders, or cancel one by id.", {"cancel_id": _s("Optional id to cancel")}),
    _spec("send_to_phone", "Send a file from the laptop to the user's phone (shows a download button in the chat).",
          {"path": _s("File path, relative = workspace")}, ["path"]),
    _spec("laptop_screenshot", "Take a screenshot of the laptop screen; you will see it and the user gets it on the phone."),
    _spec("laptop_control", "Operate the laptop yourself: click, type or press keys. Take a laptop_screenshot first. "
          "x/y are 0–1000 relative to the screen (0,0 = top left). After each action you get a new screenshot.",
          {"action": _s("click, double_click, right_click, move, scroll, type or key"),
           "x": {"type": "number", "description": "0–1000 from left"}, "y": {"type": "number", "description": "0–1000 from top"},
           "text": _s("Text to type"), "key": _s("Key or combo, e.g. enter, ctrl+s, alt+tab"),
           "amount": {"type": "integer", "description": "Scroll steps, negative = down"}}, ["action"]),
    _spec("knowledge", "The user's own knowledge base: learn folders/files (action=add, path), then answer questions "
          "about the user's projects, notes and code from it (action=search, query). Also list/remove.",
          {"action": _s("search, add, list or remove"), "query": _s("Question/search words"),
           "path": _s("Folder or file to learn/remove")}),
    _spec("more_tools", "Load extra tool groups when you need them: video, minecraft, code, laptop, organize, web.",
          {"group": _s("One of: video, minecraft, code, laptop, organize, web")}, ["group"]),
    _spec("phone_action", "Do something on the user's PHONE via a one-tap button (tell them to tap it). type: call(number) "
          "sms(number,text) whatsapp(text,number?) email(to,subject,text) maps(destination|query,mode) "
          "calendar(title,start 'YYYY-MM-DD HH:MM',end?,place?) youtube(query) spotify(query) search(query) web(url) "
          "share(text) copy(text). Calendar entries/appointments = type calendar.",
          {"type": _s("Action type"), "number": _s("Phone number"), "text": _s("Message or text"), "to": _s("E-mail address"),
           "subject": _s("E-mail subject"), "query": _s("Search words"), "destination": _s("Place or address"),
           "mode": _s("drive, walk, transit or bike"), "title": _s("Event title"), "start": _s("YYYY-MM-DD HH:MM"),
           "end": _s("YYYY-MM-DD HH:MM"), "place": _s("Event location"), "url": _s("Link"),
           "label": _s("Optional button text")}, ["type"]),
    _spec("routine", "Recurring task the laptop runs automatically at a time, result is sent to the phone. "
          "action = add (prompt, time 'HH:MM', days 'täglich'|'werktags'|'wochenende'|'mo,mi,fr', name) | list | delete (id).",
          {"action": _s("add, list or delete"), "prompt": _s("What to do each time, as a full instruction"),
           "time": _s("HH:MM"), "days": _s("Which days"), "name": _s("Short name"), "id": _s("Routine id")}),
    _spec("media_control", "Laptop media keys: play_pause, next, previous, stop, volume_up, volume_down, mute.",
          {"action": _s("One of the actions"), "times": {"type": "integer", "description": "Repeat count (volume: 1 step = 2%)"}},
          ["action"]),
    _spec("lock_laptop", "Lock the laptop screen (Windows lock)."),
    _spec("download_file", "Download a file from the internet into the workspace folder 'Downloads'.",
          {"url": _s("File URL"), "filename": _s("Optional file name")}, ["url"]),
]

TOOLS = {
    "web_search": web_search, "open_webpage": open_webpage, "research": research, "make_document": make_document, "wikipedia": wikipedia, "weather": weather,
    "calculate": calculate, "run_python": run_python, "run_powershell": run_powershell,
    "list_files": list_files, "read_file": read_file, "write_file": write_file,
    "open_on_laptop": open_on_laptop, "laptop_status": laptop_status, "remember": remember, "forget": forget,
    "media_control": media_control, "lock_laptop": lock_laptop, "download_file": download_file,
    "run_node": run_node, "edit_file": edit_file, "project_tree": project_tree, "find_in_files": find_in_files,
    "knowledge": knowledge_tool,
}


def approval_reason(name: str, args: dict, ctx: ToolContext) -> str | None:
    """Gibt einen Grund zurück, wenn der Nutzer zustimmen muss, sonst None."""
    if name == "run_python":
        return "Python-Code auf dem Laptop ausführen"
    if name == "run_powershell":
        return "PowerShell-Befehl auf dem Laptop ausführen"
    if name == "run_node":
        return "JavaScript-Code auf dem Laptop ausführen"
    if name in ("read_file", "list_files", "write_file", "edit_file", "project_tree", "find_in_files"):
        p = _resolve(args.get("path") or ".", ctx)
        if not _inside_workspace(p, ctx):
            verb = {"read_file": "Datei lesen", "list_files": "Ordner ansehen", "write_file": "Datei schreiben",
                    "edit_file": "Datei ändern", "project_tree": "Ordner ansehen", "find_in_files": "Dateien durchsuchen"}[name]
            return f"{verb} außerhalb des Arbeitsordners: {p}"
    if name == "knowledge" and str(args.get("action") or "").lower() == "add":
        p = _resolve(args.get("path") or ".", ctx)
        if not _inside_workspace(p, ctx):
            return f"Ordner in den Wissensspeicher aufnehmen (wird gelesen): {p}"
    if name == "open_on_laptop" and not re.match(r"^https?://", (args.get("target") or "").strip(), re.I):
        return "Etwas auf dem Laptop öffnen"
    return None


def run_tool(name: str, args: dict, ctx: ToolContext) -> tuple[bool, str]:
    fn = TOOLS.get(name)
    if not fn:
        return False, f"Unbekanntes Werkzeug: {name}"
    try:
        return True, _clip(fn(args, ctx), 8000)
    except ToolError as e:
        return False, f"Fehler: {e}"
    except Exception as e:  # Werkzeugfehler dürfen den Agenten nie abstürzen lassen
        return False, f"Fehler ({type(e).__name__}): {e}"
