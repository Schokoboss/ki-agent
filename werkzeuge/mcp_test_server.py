"""Mini-MCP-Server für Tests: stdio (Standard) oder --http PORT (Streamable HTTP, JSON-Antworten bzw. SSE)."""
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOOLS = [
    {"name": "uhrzeit", "description": "Gibt die aktuelle Uhrzeit zurück.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "addiere", "description": "Addiert zwei Zahlen.",
     "inputSchema": {"type": "object", "properties": {"a": {"type": "number"}, "b": {"type": "number"}}, "required": ["a", "b"]}},
    {"name": "kaputt", "description": "Liefert immer einen Fehler.", "inputSchema": {"type": "object", "properties": {}}},
]


def handle(msg):
    m, mid = msg.get("method"), msg.get("id")
    if mid is None:
        return None  # Mitteilung
    if m == "initialize":
        res = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "test", "version": "1"}}
    elif m == "tools/list":
        cur = (msg.get("params") or {}).get("cursor")
        res = {"tools": TOOLS[:2], "nextCursor": "s2"} if not cur else {"tools": TOOLS[2:]}  # Seiten testen
    elif m == "tools/call":
        p = msg.get("params") or {}
        if p.get("name") == "uhrzeit":
            res = {"content": [{"type": "text", "text": time.strftime("Es ist %H:%M Uhr.")}]}
        elif p.get("name") == "addiere":
            a = p.get("arguments") or {}
            res = {"content": [{"type": "text", "text": f"{a.get('a')} + {a.get('b')} = {a.get('a', 0) + a.get('b', 0)}"}]}
        else:
            res = {"content": [{"type": "text", "text": "Absichtlicher Fehler"}], "isError": True}
    else:
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "unbekannt"}}
    return {"jsonrpc": "2.0", "id": mid, "result": res}


if "--http" in sys.argv:
    port = int(sys.argv[sys.argv.index("--http") + 1])

    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            msg = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            antwort = handle(msg)
            if antwort is None:
                self.send_response(202); self.end_headers(); return
            sse = msg.get("method") == "tools/call"  # Werkzeugaufrufe als Event-Stream, Rest als JSON
            self.send_response(200)
            self.send_header("Mcp-Session-Id", "sitzung-123")
            if sse:
                self.send_header("Content-Type", "text/event-stream"); self.end_headers()
                self.wfile.write(b"event: message\ndata: " + json.dumps(antwort).encode() + b"\n\n")
            else:
                body = json.dumps(antwort).encode()
                self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body)))
                self.end_headers(); self.wfile.write(body)

        def log_message(self, *a):
            pass

    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
else:
    print("hallo, ich bin kein JSON", flush=True)  # Robustheit: Text auf stdout
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": "srv1", "method": "ping"}) + "\n"); sys.stdout.flush()
    for zeile in sys.stdin:
        try:
            msg = json.loads(zeile)
        except ValueError:
            continue
        if "result" in msg or "error" in msg:
            continue  # Antwort des Clients auf unseren ping
        a = handle(msg)
        if a is not None:
            sys.stdout.write(json.dumps(a) + "\n"); sys.stdout.flush()
