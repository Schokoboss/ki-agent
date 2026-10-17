"""Fernsteuerung des Laptops: Bildschirmbild + Maus/Tastatur über Windows-Funktionen (ctypes, kein Admin nötig).

Koordinaten kommen immer relativ (0..1) an, damit Handy-Ansicht, Bildgröße und echte Auflösung egal sind.
Der Prozess wird beim Start DPI-bewusst gemacht – sonst passen Bildschirmfoto und Mausposition bei 125 %/150 %
Windows-Skalierung nicht zusammen.
"""

import ctypes
import io
import time
from ctypes import wintypes

user32 = ctypes.WinDLL("user32", use_last_error=True)

INPUT_MOUSE, INPUT_KEYBOARD = 0, 1
MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP = 0x0002, 0x0004
MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP = 0x0008, 0x0010
MOUSEEVENTF_WHEEL = 0x0800
KEYEVENTF_KEYUP, KEYEVENTF_UNICODE = 0x0002, 0x0004

KEYS = {
    "enter": 0x0D, "backspace": 0x08, "tab": 0x09, "esc": 0x1B, "escape": 0x1B, "space": 0x20, "delete": 0x2E,
    "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28, "home": 0x24, "end": 0x23, "pageup": 0x21,
    "pagedown": 0x22, "win": 0x5B, "ctrl": 0x11, "strg": 0x11, "alt": 0x12, "shift": 0x10, "f5": 0x74, "f11": 0x7A,
    "f1": 0x70, "f2": 0x71, "f3": 0x72, "f4": 0x73, "f12": 0x7B,
}


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]


class _U(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("pad", ctypes.c_byte * 32)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("u", _U)]


user32.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int]


class RemoteError(Exception):
    pass


def make_dpi_aware() -> None:
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)  # pro Monitor
    except (OSError, AttributeError):
        try:
            user32.SetProcessDPIAware()
        except (OSError, AttributeError):
            pass


def screen_size() -> tuple[int, int]:
    return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)


def _send(*inputs: INPUT) -> None:
    arr = (INPUT * len(inputs))(*inputs)
    if user32.SendInput(len(inputs), arr, ctypes.sizeof(INPUT)) != len(inputs):
        raise RemoteError("Windows hat die Eingabe abgelehnt (gesperrter Bildschirm oder Admin-Fenster im Vordergrund?).")


def _mouse(flags: int, data: int = 0) -> INPUT:
    return INPUT(INPUT_MOUSE, _U(mi=MOUSEINPUT(0, 0, data & 0xFFFFFFFF, flags, 0, 0)))


def _key(vk: int = 0, scan: int = 0, flags: int = 0) -> INPUT:
    return INPUT(INPUT_KEYBOARD, _U(ki=KEYBDINPUT(vk, scan, flags, 0, 0)))


def move(rx: float, ry: float) -> tuple[int, int]:
    w, h = screen_size()
    x = int(max(0.0, min(1.0, float(rx))) * (w - 1))
    y = int(max(0.0, min(1.0, float(ry))) * (h - 1))
    user32.SetCursorPos(x, y)
    return x, y


def click(rx: float, ry: float, button: str = "left", double: bool = False) -> str:
    x, y = move(rx, ry)
    time.sleep(0.03)
    down, up = (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP) if button == "right" else (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP)
    for _ in range(2 if double else 1):
        _send(_mouse(down), _mouse(up))
        time.sleep(0.06)
    return f"{'Doppel' if double else 'Rechts' if button == 'right' else ''}klick bei {x},{y}"


def scroll(amount: int, rx: float | None = None, ry: float | None = None) -> str:
    if rx is not None and ry is not None:
        move(rx, ry)
    _send(_mouse(MOUSEEVENTF_WHEEL, int(amount) * 120))
    return f"gescrollt ({'hoch' if amount > 0 else 'runter'})"


def type_text(text: str) -> str:
    text = str(text)[:2000]
    events = []
    for ch in text:
        if ch == "\n":
            events += [_key(KEYS["enter"]), _key(KEYS["enter"], flags=KEYEVENTF_KEYUP)]
            continue
        code = ord(ch)
        if code > 0xFFFF:  # Emoji usw. als Ersatzpaar
            code -= 0x10000
            for unit in (0xD800 + (code >> 10), 0xDC00 + (code & 0x3FF)):
                events += [_key(scan=unit, flags=KEYEVENTF_UNICODE), _key(scan=unit, flags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)]
        else:
            events += [_key(scan=code, flags=KEYEVENTF_UNICODE), _key(scan=code, flags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)]
    for i in range(0, len(events), 40):
        _send(*events[i:i + 40])
        time.sleep(0.01)
    return f"{len(text)} Zeichen getippt"


def press(combo: str) -> str:
    """z. B. 'enter', 'ctrl+c', 'alt+tab', 'win', 'ctrl+shift+esc'"""
    parts = [p.strip().lower() for p in str(combo).replace(" ", "").split("+") if p.strip()]
    vks = []
    for p in parts:
        if p in KEYS:
            vks.append(KEYS[p])
        elif len(p) == 1 and p.isalnum():
            vks.append(ord(p.upper()))
        else:
            raise RemoteError(f"Unbekannte Taste: {p}")
    if not vks:
        raise RemoteError("Keine Taste angegeben.")
    _send(*[_key(v) for v in vks], *[_key(v, flags=KEYEVENTF_KEYUP) for v in reversed(vks)])
    return f"Taste {combo} gedrückt"


def frame(width: int = 960, quality: int = 55) -> tuple[bytes, int, int]:
    """Bildschirmbild als JPEG (mit Mauszeiger-Markierung) – gibt (Bytes, echte Breite, echte Höhe)."""
    from PIL import ImageDraw, ImageGrab
    img = ImageGrab.grab(all_screens=False)
    w, h = img.size
    pt = wintypes.POINT()
    user32.GetCursorPos(ctypes.byref(pt))
    width = max(320, min(int(width or 960), 1920))
    if w > width:
        img = img.resize((width, int(h * width / w)))
    sx = img.width / w
    cx, cy = pt.x * sx, pt.y * sx
    d = ImageDraw.Draw(img)
    r = max(4, img.width // 160)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 64, 64), width=max(2, r // 2))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=max(25, min(int(quality or 55), 90)))
    return buf.getvalue(), w, h
