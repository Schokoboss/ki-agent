"""Wissensspeicher: Nova lernt Ordner/Dateien des Nutzers und findet darin passende Stellen (BM25, nur Standardbibliothek).

„Lernen“ heißt hier: Textdateien in Abschnitte schneiden und durchsuchbar ablegen (data/knowledge/index.json).
Bei einer Frage sucht Nova die passendsten Abschnitte und antwortet daraus – mit Datei und Zeile als Quelle.
"""

import json
import math
import os
import re
import time
from collections import Counter
from pathlib import Path

TEXT_EXT = {".txt", ".md", ".py", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".html", ".htm", ".css", ".json", ".glsl",
            ".vsh", ".fsh", ".gsh", ".csh", ".properties", ".lang", ".csv", ".java", ".cs", ".lua", ".luau", ".ps1",
            ".bat", ".cmd", ".yml", ".yaml", ".ini", ".cfg", ".toml", ".xml", ".sql", ".c", ".cpp", ".h", ".rs", ".go",
            ".kt", ".gd", ".mcfunction", ".mcmeta", ".rtf", ".log"}
SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build", ".next", ".cache", ".runs"}
CHUNK = 900
STOP = set("der die das und oder ein eine einer eines ist sind war wer was wie wo wann warum the a an of to in on for "
           "is are was who what how when why with von zu im am auf für mit bei aus den dem des nicht auch es ich du er "
           "sie wir ihr man mein dein sein this that it be as at by".split())
WORD = re.compile(r"[a-zäöüß0-9_]{2,}")


class KnowledgeError(Exception):
    pass


def _stem(w: str) -> str:
    """Grober deutscher Wortstamm: „Helligkeits“/„Helligkeit“, „Schatten“/„Schattens“ sollen zusammenfinden."""
    for suf in ("ungen", "heiten", "keiten", "ern", "en", "er", "es", "e", "s", "n"):
        if len(w) > len(suf) + 4 and w.endswith(suf):
            return w[:-len(suf)]
    return w


def _tokens(text: str) -> list[str]:
    out = []
    for w in WORD.findall(text.lower()):
        if w in STOP:
            continue
        out.append(_stem(w))
        if "_" in w:  # MIN_BRIGHTNESS → auch „min“, „brightness“
            out += [_stem(p) for p in w.split("_") if len(p) > 2]
    return out


class Knowledge:
    def __init__(self, folder: Path):
        self.folder = folder
        self.path = folder / "index.json"
        self._cache = None  # (mtime, chunks, df, avgdl)

    def _load(self) -> dict:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"sources": {}, "chunks": []}

    def _save(self, data: dict) -> None:
        self.folder.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.path)
        self._cache = None

    @staticmethod
    def _chunks(file: Path, root: Path) -> list[dict]:
        try:
            raw = file.read_bytes()
        except OSError:
            return []
        if b"\x00" in raw[:2000]:
            return []
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("cp1252", "replace")
        rel = str(file.relative_to(root)) if root in file.parents else file.name
        out, buf, start = [], [], 1
        for n, line in enumerate(text.splitlines(), 1):
            if not buf:
                start = n
            buf.append(line)
            if sum(len(x) + 1 for x in buf) >= CHUNK:
                out.append({"src": str(file), "rel": rel, "line": start, "text": "\n".join(buf).strip()})
                buf = buf[-2:]  # etwas Überlappung, damit Zusammenhänge nicht zerreißen
                start = n - len(buf) + 1
        if buf and "\n".join(buf).strip():
            out.append({"src": str(file), "rel": rel, "line": start, "text": "\n".join(buf).strip()})
        return [c for c in out if len(c["text"]) > 20]

    def add(self, target: Path) -> str:
        if not target.exists():
            raise KnowledgeError(f"Nicht gefunden: {target}")
        files = [target] if target.is_file() else [
            f for f in target.rglob("*") if f.is_file() and f.suffix.lower() in TEXT_EXT
            and not any(p in SKIP_DIRS for p in f.parts) and f.stat().st_size <= 1_500_000]
        if not files:
            raise KnowledgeError("Keine lesbaren Textdateien gefunden (unterstützt: Text, Code, Markdown, Shader …).")
        files = files[:3000]
        root = target if target.is_dir() else target.parent
        new = []
        for f in files:
            new.extend(self._chunks(f, root))
        data = self._load()
        key = str(target.resolve())
        data["chunks"] = [c for c in data["chunks"] if not c["src"].startswith(key)] + new
        if len(data["chunks"]) > 40000:
            raise KnowledgeError("Wissensspeicher wäre zu groß (max. 40.000 Abschnitte) – lieber einen kleineren Ordner nehmen.")
        data["sources"][key] = {"files": len(files), "chunks": len(new), "added": time.strftime("%Y-%m-%d %H:%M")}
        self._save(data)
        return f"Gelernt: {target} – {len(files)} Dateien, {len(new)} Abschnitte. Fragen dazu beantworte ich ab jetzt mit knowledge(search)."

    def remove(self, target: str) -> str:
        data = self._load()
        key = next((k for k in data["sources"] if k.lower() == target.lower() or k.lower().endswith(target.lower())), None)
        if not key:
            return "Diese Quelle ist nicht im Wissensspeicher."
        data["chunks"] = [c for c in data["chunks"] if not c["src"].startswith(key)]
        del data["sources"][key]
        self._save(data)
        return f"Vergessen: {key}"

    def list(self) -> str:
        data = self._load()
        if not data["sources"]:
            return "Der Wissensspeicher ist leer. Mit knowledge(action=add, path=…) einen Ordner lernen."
        return "Gelernte Quellen:\n" + "\n".join(
            f"- {k} ({v['files']} Dateien, {v['chunks']} Abschnitte, {v['added']})" for k, v in data["sources"].items())

    def _index(self):
        mtime = self.path.stat().st_mtime if self.path.exists() else 0
        if self._cache and self._cache[0] == mtime:
            return self._cache[1:]
        chunks = self._load()["chunks"]
        tfs = [Counter(_tokens(c["text"] + " " + c["rel"])) for c in chunks]
        df = Counter()
        for tf in tfs:
            df.update(tf.keys())
        avgdl = sum(sum(tf.values()) for tf in tfs) / max(1, len(tfs))
        self._cache = (mtime, chunks, tfs, df, avgdl)
        return chunks, tfs, df, avgdl

    def search(self, query: str, n: int = 6) -> str:
        chunks, tfs, df, avgdl = self._index()
        if not chunks:
            return "Der Wissensspeicher ist leer."
        q = _tokens(query)
        if not q:
            raise KnowledgeError("Suchbegriffe fehlen.")
        N, k1, b = len(chunks), 1.4, 0.75
        scores = []
        for i, tf in enumerate(tfs):
            dl = sum(tf.values()) or 1
            s = 0.0
            for w in q:
                if w in tf:
                    idf = math.log(1 + (N - df[w] + 0.5) / (df[w] + 0.5))
                    s += idf * tf[w] * (k1 + 1) / (tf[w] + k1 * (1 - b + b * dl / avgdl))
            if s > 0:
                scores.append((s, i))
        if not scores:
            return f"Im Wissensspeicher steht nichts zu „{query}“."
        best = sorted(scores, reverse=True)[:max(1, min(int(n or 6), 10))]
        out = [f"Treffer im Wissensspeicher zu „{query}“:"]
        for k, (s, i) in enumerate(best, 1):
            c = chunks[i]
            out.append(f"[{k}] {c['rel']}, Zeile {c['line']} ({c['src']})\n{c['text'][:1100]}")
        out.append("Antworte aus diesen Stellen und nenne Datei und Zeile als Quelle.")
        return "\n\n".join(out)
