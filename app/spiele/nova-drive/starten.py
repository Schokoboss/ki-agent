"""Nova Drive lokal starten: kleiner Webserver im Spielordner + Browser.

Windows: Doppelklick auf „Nova Drive starten.cmd“.  Mac/Linux: python3 starten.py
Am Laptop: http://localhost:8000/   Am Handy (gleiches WLAN): die angezeigte Adresse oder den QR-Code nutzen.
"""
import http.server
import os
import socket
import sys
import webbrowser
from functools import partial

HERE = os.path.dirname(os.path.abspath(__file__))
TYPES = {'.glb': 'model/gltf-binary', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
         '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm'}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **TYPES}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, *args):
        pass


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def main():
    srv = None
    for port in range(8000, 8020):
        try:
            srv = http.server.ThreadingHTTPServer(('0.0.0.0', port), partial(Handler, directory=HERE))
            break
        except OSError:
            continue
    if not srv:
        print('Kein freier Port zwischen 8000 und 8019 gefunden.')
        return 1
    ip = lan_ip()
    local = f'http://localhost:{port}/'
    phone = f'http://{ip}:{port}/' if ip else ''
    print()
    print('  NOVA DRIVE läuft!')
    print(f'  Am Laptop:  {local}')
    if phone:
        print(f'  Am Handy:   {phone}   (gleiches WLAN)')
    print()
    print('  Fenster offen lassen, solange du spielst. Strg+C oder Fenster schließen = beenden.')
    print('  Fragt Windows nach Netzwerkzugriff: „Zulassen“ (privates Netzwerk), sonst klappt es am Handy nicht.')
    webbrowser.open(local + 'handy.html' + ('#' + phone if phone else ''))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
