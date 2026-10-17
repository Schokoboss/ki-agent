"""Video-Werkzeuge für Nova (ffmpeg + Windows-Sprachausgabe).

make_video: Szenen → je ein gemaltes Bild + gesprochener Text (Stimme „Hedda“) + Untertitel + Zoom → MP4.
record_screen: Laptop-Bildschirm aufnehmen. edit_video: schneiden, zusammenfügen, GIF, verkleinern, Musik.
"""

import os
import re
import shutil
import subprocess
import textwrap
import time
import uuid
from pathlib import Path

CREATE_NO_WINDOW = 0x08000000
FORMATS = {"short": (1080, 1920, "portrait"), "wide": (1920, 1080, "landscape")}

# PowerShell-Skript für die Sprachausgabe – bewusst nur ASCII (PowerShell 5.1 liest Skripte als ANSI)
TTS_PS1 = r"""
param([string]$TextFile, [string]$WavFile)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'de-DE' } | Select-Object -First 1
if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }
$s.Rate = 1
$s.SetOutputToWaveFile($WavFile)
$s.Speak([IO.File]::ReadAllText($TextFile, [Text.Encoding]::UTF8))
$s.Dispose()
"""


class VideoError(Exception):
    pass


class Video:
    def __init__(self, engine: Path, workspace: Path, logs: Path):
        self.ffmpeg = engine / "ffmpeg" / "ffmpeg.exe"
        self.ffprobe = engine / "ffmpeg" / "ffprobe.exe"
        self.workspace = workspace
        self.logs = logs

    _encoder: str | None = None

    def encoder(self) -> str:
        if self._encoder is None:
            for enc in ("h264_amf", "h264_mf", "libopenh264"):
                p = subprocess.run([str(self.ffmpeg), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                                    "testsrc2=s=320x240:d=0.3:r=30", "-c:v", enc, "-pix_fmt", "yuv420p", "-f", "null", "-"],
                                   capture_output=True, timeout=60, creationflags=CREATE_NO_WINDOW)
                if p.returncode == 0:
                    self._encoder = enc
                    break
            else:
                self._encoder = "mpeg4"
        return self._encoder

    def venc(self, bitrate: str = "8M") -> list:
        return ["-c:v", self.encoder(), "-b:v", bitrate, "-pix_fmt", "yuv420p"]

    def ok(self) -> bool:
        return self.ffmpeg.is_file() and self.ffprobe.is_file()

    def _run(self, args: list, cwd: Path | None = None, timeout: int = 900) -> None:
        if not self.ok():
            raise VideoError("ffmpeg ist nicht installiert.")
        with open(self.logs / "ffmpeg.log", "ab") as logf:
            logf.write(f"\n=== {time.strftime('%H:%M:%S')} {' '.join(map(str, args))[:600]}\n".encode("utf-8", "replace"))
            p = subprocess.run([str(self.ffmpeg), "-hide_banner", "-loglevel", "error", "-y", *map(str, args)],
                               cwd=cwd, stdout=logf, stderr=subprocess.STDOUT, timeout=timeout,
                               creationflags=CREATE_NO_WINDOW, stdin=subprocess.DEVNULL)
        if p.returncode != 0:
            raise VideoError(f"ffmpeg ist fehlgeschlagen (Code {p.returncode}) – siehe data/logs/ffmpeg.log.")

    def duration(self, path: Path) -> float:
        p = subprocess.run([str(self.ffprobe), "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                           capture_output=True, text=True, timeout=60, creationflags=CREATE_NO_WINDOW)
        try:
            return float(p.stdout.strip())
        except ValueError:
            raise VideoError(f"Länge von {path.name} nicht lesbar.")

    def _out(self, name: str, ext: str = ".mp4") -> Path:
        folder = self.workspace / "Videos"
        folder.mkdir(parents=True, exist_ok=True)
        safe = re.sub(r"[^\w\- ]+", "", name or "video", flags=re.UNICODE).strip()[:50] or "video"
        target = folder / f"{safe}{ext}"
        k = 2
        while target.exists():
            target = folder / f"{safe} ({k}){ext}"
            k += 1
        return target

    def tts(self, text: str, wav: Path) -> None:
        script = wav.parent / "tts.ps1"
        if not script.exists():
            script.write_text(TTS_PS1, encoding="ascii")
        txt = wav.with_suffix(".tts.txt")
        txt.write_text(text, encoding="utf-8")
        p = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
                            str(script), str(txt), str(wav)], capture_output=True, timeout=180,
                           creationflags=CREATE_NO_WINDOW)
        if p.returncode != 0 or not wav.is_file():
            raise VideoError("Sprachausgabe fehlgeschlagen: " + p.stderr.decode("cp1252", "replace")[:200])

    def make_video(self, title: str, scenes: list, fmt: str, paint, emit, voice: bool = True) -> Path:
        """paint(prompt, orientation, out_png) malt ein Bild; emit(text) meldet Fortschritt."""
        if not scenes:
            raise VideoError("Keine Szenen angegeben.")
        W, H, orient = FORMATS.get((fmt or "short").lower(), FORMATS["short"])
        tmp = self.workspace / "Videos" / f".bau_{uuid.uuid4().hex[:8]}"
        tmp.mkdir(parents=True, exist_ok=True)
        font = next((f for f in (r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\segoeuib.ttf",
                                 r"C:\Windows\Fonts\arial.ttf") if os.path.isfile(f)), None)
        if font:
            shutil.copy(font, tmp / "font.ttf")
        crop = "crop=ih*9/16:ih" if orient == "portrait" else "crop=iw:iw*9/16"
        size = 30 if orient == "landscape" else 15  # Untertitel-Zeilenlänge
        fs = 54 if orient == "portrait" else 50
        clips = []
        try:
            for i, sc in enumerate(scenes[:10]):
                text = str(sc.get("text") or "").strip()
                prompt = str(sc.get("image_prompt") or sc.get("prompt") or text)
                emit(f"Szene {i + 1}/{min(len(scenes), 10)}: male das Bild …")
                img = tmp / f"s{i}.png"
                paint(prompt, orient, img)
                dur = 4.0
                audio = []
                if voice and text:
                    emit(f"Szene {i + 1}: spreche den Text …")
                    wav = tmp / f"s{i}.wav"
                    self.tts(text, wav)
                    dur = self.duration(wav) + 0.6
                    audio = ["-i", wav.name]
                else:
                    audio = ["-f", "lavfi", "-t", f"{dur:.2f}", "-i", "anullsrc=r=44100:cl=stereo"]
                (tmp / f"s{i}.txt").write_text("\n".join(textwrap.wrap(text, size * 2 if orient == "landscape" else 26))
                                               or " ", encoding="utf-8")
                frames = int(dur * 30)
                vf = (f"[0]{crop},scale={W * 3 // 2}:{H * 3 // 2},"
                      f"zoompan=z='min(zoom+0.0009,1.25)':d={frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={W}x{H}:fps=30")
                if font and text:
                    vf += (f",drawtext=fontfile=font.ttf:textfile=s{i}.txt:fontcolor=white:fontsize={fs}:line_spacing=12:"
                           f"box=1:boxcolor=black@0.5:boxborderw=26:x=(w-text_w)/2:y=h*0.70")
                vf += "[v]"
                emit(f"Szene {i + 1}: schneide den Clip …")
                self._run(["-loop", "1", "-i", img.name, *audio, "-filter_complex", vf, "-map", "[v]", "-map", "1:a",
                           "-t", f"{dur:.2f}", *self.venc("8M"),
                           "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2", f"c{i}.mp4"], cwd=tmp)
                clips.append(f"c{i}.mp4")
            (tmp / "liste.txt").write_text("".join(f"file '{c}'\n" for c in clips), encoding="utf-8")
            out = self._out(title)
            emit("Füge alles zusammen …")
            self._run(["-f", "concat", "-safe", "0", "-i", "liste.txt", "-c", "copy", "-movflags", "+faststart", str(out)], cwd=tmp)
            return out
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def record_screen(self, seconds: int, name: str) -> Path:
        seconds = max(3, min(int(seconds or 20), 300))
        out = self._out(name or f"Bildschirm {time.strftime('%Y-%m-%d %H-%M')}")
        self._run(["-f", "gdigrab", "-framerate", "30", "-t", str(seconds), "-i", "desktop",
                   "-vf", "scale=-2:'min(1080,ih)'", *self.venc("8M"), "-movflags", "+faststart", str(out)], timeout=seconds + 120)
        return out

    def edit(self, action: str, inputs: list[Path], start=None, end=None, music: Path | None = None, name: str = "") -> Path:
        action = (action or "").lower()
        if not inputs:
            raise VideoError("Kein Eingangsvideo angegeben.")
        src = inputs[0]
        base = name or f"{src.stem} {action}"
        enc = [*self.venc("8M"), "-c:a", "aac", "-movflags", "+faststart"]
        if action == "cut":
            out = self._out(base)
            span = (["-ss", str(start)] if start not in (None, "") else []) + (["-to", str(end)] if end not in (None, "") else [])
            self._run([*span, "-i", src, *enc, out])
        elif action == "merge":
            if len(inputs) < 2:
                raise VideoError("Zum Zusammenfügen mindestens zwei Videos angeben.")
            out = self._out(base)
            n = len(inputs)
            ins = sum((["-i", str(p)] for p in inputs), [])
            graph = "".join(f"[{k}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v{k}];"
                            f"[{k}:a]aresample=44100[a{k}];" for k in range(n))
            graph += "".join(f"[v{k}][a{k}]" for k in range(n)) + f"concat=n={n}:v=1:a=1[v][a]"
            self._run([*ins, "-filter_complex", graph, "-map", "[v]", "-map", "[a]", *enc, out])
        elif action == "gif":
            out = self._out(base, ".gif")
            span = (["-ss", str(start)] if start not in (None, "") else []) + (["-to", str(end)] if end not in (None, "") else ["-t", "8"])
            self._run([*span, "-i", src, "-vf", "fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse", out])
        elif action == "compress":
            out = self._out(base)
            self._run(["-i", src, "-vf", "scale=-2:'min(720,ih)'", *self.venc("2500k"),
                       "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out])
        elif action == "music":
            if not music:
                raise VideoError("Musikdatei fehlt.")
            out = self._out(base)
            self._run(["-i", src, "-i", music, "-filter_complex", "[1:a]volume=0.35[m];[0:a][m]amix=inputs=2:duration=first[a]",
                       "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", out])
        else:
            raise VideoError("Unbekannte Aktion – erlaubt: cut, merge, gif, compress, music.")
        return out
