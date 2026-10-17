"""Web Push (RFC 8030, 8291, 8292) nur mit der Python-Standardbibliothek.

Enthält, was sonst eine Krypto-Bibliothek erledigt: die Kurve P-256 (ECDH für die Verschlüsselung,
ECDSA für die VAPID-Unterschrift), AES-128-GCM und HKDF. Für ein paar Benachrichtigungen pro Stunde
ist reines Python schnell genug (~20 ms pro Nachricht). Nicht zeitkonstant – das ist hier egal,
weil niemand von außen die Rechenzeit dieses Laptops messen kann.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import struct
import time
import urllib.error
import urllib.parse
import urllib.request


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s: str) -> bytes:
    s = (s or "").strip()
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


# ---------------------------------------------------------------- Kurve P-256 (secp256r1)

P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
B = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B
N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
GX = 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296
GY = 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5
_INF = (0, 1, 0)


def _dbl(p):
    x, y, z = p
    if not z or not y:
        return _INF
    yy = y * y % P
    s = 4 * x * yy % P
    zz = z * z % P
    m = 3 * (x - zz) * (x + zz) % P  # a = -3
    x3 = (m * m - 2 * s) % P
    return x3, (m * (s - x3) - 8 * yy * yy) % P, 2 * y * z % P


def _add(p, q):
    if not p[2]:
        return q
    if not q[2]:
        return p
    x1, y1, z1 = p
    x2, y2, z2 = q
    z1z1, z2z2 = z1 * z1 % P, z2 * z2 % P
    u1, u2 = x1 * z2z2 % P, x2 * z1z1 % P
    s1, s2 = y1 * z2 * z2z2 % P, y2 * z1 * z1z1 % P
    if u1 == u2:
        return _dbl(p) if s1 == s2 else _INF
    h, r = (u2 - u1) % P, (s2 - s1) % P
    hh = h * h % P
    hhh, v = h * hh % P, u1 * hh % P
    x3 = (r * r - hhh - 2 * v) % P
    return x3, (r * (v - x3) - s1 * hhh) % P, h * z1 * z2 % P


def _mul(k: int, x: int, y: int) -> tuple[int, int]:
    r, q = _INF, (x, y, 1)
    for bit in bin(k)[2:]:
        r = _dbl(r)
        if bit == "1":
            r = _add(r, q)
    if not r[2]:
        raise ValueError("Punkt im Unendlichen")
    zi = pow(r[2], -1, P)
    zi2 = zi * zi % P
    return r[0] * zi2 % P, r[1] * zi2 * zi % P


def _encode(x: int, y: int) -> bytes:
    return b"\x04" + x.to_bytes(32, "big") + y.to_bytes(32, "big")


def _decode(raw: bytes) -> tuple[int, int]:
    if len(raw) != 65 or raw[0] != 4:
        raise ValueError("kein unkomprimierter P-256-Punkt")
    x, y = int.from_bytes(raw[1:33], "big"), int.from_bytes(raw[33:], "big")
    if not (0 <= x < P and 0 <= y < P) or (y * y - (x * x * x - 3 * x + B)) % P:
        raise ValueError("Punkt liegt nicht auf P-256")
    return x, y


def new_private_key() -> str:
    return b64u((secrets.randbelow(N - 1) + 1).to_bytes(32, "big"))


def public_key(private: str) -> str:
    return b64u(_encode(*_mul(int.from_bytes(unb64u(private), "big"), GX, GY)))


def _sign(d: int, msg: bytes) -> bytes:
    """ECDSA mit SHA-256, Ergebnis roh als r||s (so will es JWT/ES256)."""
    e = int.from_bytes(hashlib.sha256(msg).digest(), "big")
    while True:
        k = secrets.randbelow(N - 1) + 1
        r = _mul(k, GX, GY)[0] % N
        s = pow(k, -1, N) * (e + r * d) % N
        if r and s:
            return r.to_bytes(32, "big") + s.to_bytes(32, "big")


# ---------------------------------------------------------------- AES-128-GCM

def _xt(a: int) -> int:
    return ((a << 1) ^ 0x11B) if a & 0x80 else a << 1


def _rotl8(v: int, n: int) -> int:
    return ((v << n) | (v >> (8 - n))) & 0xFF


def _make_sbox() -> list[int]:
    """S-Box berechnen statt abtippen: p läuft über alle Elemente (mal 3), q ist sein Inverses (durch 3)."""
    sbox, p, q = [0] * 256, 1, 1
    while True:
        p ^= _xt(p)
        q ^= q << 1
        q ^= q << 2
        q ^= q << 4
        q &= 0xFF
        if q & 0x80:
            q ^= 0x09
        sbox[p] = q ^ _rotl8(q, 1) ^ _rotl8(q, 2) ^ _rotl8(q, 3) ^ _rotl8(q, 4) ^ 0x63
        if p == 1:
            break
    sbox[0] = 0x63
    return sbox


SBOX = _make_sbox()


class _AES128:
    def __init__(self, key: bytes):
        rk, rcon = list(key), 1
        for i in range(4, 44):
            t = rk[-4:]
            if i % 4 == 0:
                t = [SBOX[t[1]] ^ rcon, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]]
                rcon = _xt(rcon)
            rk += [rk[-16 + j] ^ t[j] for j in range(4)]
        self.rk = [rk[16 * r:16 * r + 16] for r in range(11)]

    def encrypt(self, block: bytes) -> bytes:
        s = [b ^ k for b, k in zip(block, self.rk[0])]
        for rnd in range(1, 11):
            s = [SBOX[b] for b in s]
            s = [s[(i + 4 * (i % 4)) % 16] for i in range(16)]  # ShiftRows (spaltenweise abgelegt)
            if rnd != 10:  # MixColumns
                t = []
                for c in range(0, 16, 4):
                    a0, a1, a2, a3 = s[c:c + 4]
                    x = a0 ^ a1 ^ a2 ^ a3
                    t += [a0 ^ x ^ _xt(a0 ^ a1), a1 ^ x ^ _xt(a1 ^ a2),
                          a2 ^ x ^ _xt(a2 ^ a3), a3 ^ x ^ _xt(a3 ^ a0)]
                s = t
            s = [b ^ k for b, k in zip(s, self.rk[rnd])]
        return bytes(s)


def _gf_mul(x: int, y: int) -> int:
    z, v = 0, y
    for i in range(127, -1, -1):
        if (x >> i) & 1:
            z ^= v
        v = (v >> 1) ^ (0xE1 << 120) if v & 1 else v >> 1
    return z


def aes128gcm(key: bytes, iv: bytes, plaintext: bytes) -> bytes:
    """AES-128-GCM ohne Zusatzdaten. Liefert Geheimtext + 16-Byte-Tag."""
    aes = _AES128(key)
    h = int.from_bytes(aes.encrypt(bytes(16)), "big")
    out = bytearray()
    for n, i in enumerate(range(0, len(plaintext), 16)):
        ks = aes.encrypt(iv + struct.pack(">I", n + 2))
        out += bytes(a ^ b for a, b in zip(plaintext[i:i + 16], ks))
    y = 0
    for i in range(0, len(out), 16):
        y = _gf_mul(y ^ int.from_bytes(bytes(out[i:i + 16]).ljust(16, b"\0"), "big"), h)
    y = _gf_mul(y ^ (len(out) * 8), h)
    tag = int.from_bytes(aes.encrypt(iv + b"\0\0\0\1"), "big") ^ y
    return bytes(out) + tag.to_bytes(16, "big")


# ---------------------------------------------------------------- Web Push

def _hmac(key: bytes, msg: bytes) -> bytes:
    return hmac.new(key, msg, hashlib.sha256).digest()


def encrypt(payload: bytes, p256dh: str, auth: str) -> bytes:
    """Verschlüsselt eine Nachricht für ein Abo (RFC 8291, Content-Encoding aes128gcm)."""
    ua_pub, secret = unb64u(p256dh), unb64u(auth)
    ux, uy = _decode(ua_pub)
    if len(payload) > 3800:
        raise ValueError("Nachricht zu lang")
    d = secrets.randbelow(N - 1) + 1
    as_pub = _encode(*_mul(d, GX, GY))
    shared = _mul(d, ux, uy)[0].to_bytes(32, "big")
    ikm = _hmac(_hmac(secret, shared), b"WebPush: info\0" + ua_pub + as_pub + b"\1")
    salt = secrets.token_bytes(16)
    prk = _hmac(salt, ikm)
    cek = _hmac(prk, b"Content-Encoding: aes128gcm\0\1")[:16]
    nonce = _hmac(prk, b"Content-Encoding: nonce\0\1")[:12]
    return salt + struct.pack(">IB", 4096, 65) + as_pub + aes128gcm(cek, nonce, payload + b"\2")


def check_subscription(sub: dict) -> dict:
    """Prüft ein Abo aus pushManager.subscribe() und gibt die benötigten Felder zurück."""
    endpoint = str(sub.get("endpoint") or "")
    keys = sub.get("keys") or {}
    u = urllib.parse.urlsplit(endpoint)
    local_test = os.environ.get("NOVA_PUSH_TEST") and u.hostname in ("127.0.0.1", "localhost")
    if not (u.scheme == "https" or local_test) or not u.hostname or len(endpoint) > 1000:
        raise ValueError("ungültige Push-Adresse")
    _decode(unb64u(keys.get("p256dh")))
    if len(unb64u(keys.get("auth"))) < 16:
        raise ValueError("ungültiger Push-Schlüssel")
    return {"endpoint": endpoint, "keys": {"p256dh": keys["p256dh"], "auth": keys["auth"]}}


class Vapid:
    """Weist den Server beim Push-Dienst (Google/Mozilla/Apple) aus (RFC 8292)."""

    def __init__(self, private: str, subject: str):
        self.d = int.from_bytes(unb64u(private), "big")
        self.public = public_key(private)
        self.subject = subject
        self._tokens: dict[str, tuple[str, int]] = {}

    def header(self, endpoint: str) -> str:
        u = urllib.parse.urlsplit(endpoint)
        aud = f"{u.scheme}://{u.netloc}"
        token, exp = self._tokens.get(aud, ("", 0))
        if exp - time.time() < 3600:
            exp = int(time.time()) + 12 * 3600
            part = lambda o: b64u(json.dumps(o, separators=(",", ":")).encode())  # noqa: E731
            head = part({"typ": "JWT", "alg": "ES256"}) + "." + part({"aud": aud, "exp": exp, "sub": self.subject})
            token = head + "." + b64u(_sign(self.d, head.encode()))
            self._tokens[aud] = (token, exp)
        return f"vapid t={token}, k={self.public}"


def send(sub: dict, payload: dict, vapid: Vapid, ttl: int = 3600, urgency: str = "normal",
         topic: str | None = None, timeout: int = 20) -> tuple[int, str]:
    """Schickt eine Nachricht an ein Abo. Gibt (HTTP-Status, Fehlertext) zurück; 0 = Netzwerkfehler."""
    body = encrypt(json.dumps(payload, ensure_ascii=False).encode(), sub["keys"]["p256dh"], sub["keys"]["auth"])
    headers = {"TTL": str(ttl), "Urgency": urgency, "Content-Encoding": "aes128gcm",
               "Content-Type": "application/octet-stream", "Authorization": vapid.header(sub["endpoint"])}
    if topic:
        headers["Topic"] = topic
    req = urllib.request.Request(sub["endpoint"], data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, ""
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:300]
    except (urllib.error.URLError, OSError) as e:
        return 0, str(e)


def self_test() -> None:
    """Bekannte Prüfwerte (FIPS-197, GCM-Spezifikation) und Kurven-Grundlagen."""
    k = _AES128(bytes(range(16)))
    assert k.encrypt(bytes.fromhex("00112233445566778899aabbccddeeff")).hex() == "69c4e0d86a7b0430d8cdb78070b4c55a"
    assert aes128gcm(bytes(16), bytes(12), b"").hex() == "58e2fccefa7e3061367f1d57a4e7455a"
    assert aes128gcm(bytes(16), bytes(12), bytes(16)).hex() == (
        "0388dace60b6a392f328c2b971b2fe78" "ab6e47d42cec13bdf53a67b21257bddf")
    _decode(_encode(GX, GY))
    try:
        _mul(N, GX, GY)
        raise AssertionError("n*G muss der Punkt im Unendlichen sein")
    except ValueError:
        pass


if __name__ == "__main__":
    t0 = time.time()
    self_test()
    print(f"Selbsttest ok ({(time.time() - t0) * 1000:.0f} ms)")
