// Dino-Sprint 3D – Mehrspieler-Verbindung (HTTP, ca. 8× pro Sekunde, geht auch durch den Cloudflare-Tunnel).
// Server: Nova-Laptop (/mp/dino) oder `python server/dino_mp.py` im WLAN.

const SYNC_MS = 125;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function validUrl(u) {
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) ? x.origin : null;
  } catch { return null; }
}

export class Netz {
  constructor() {
    this.server = null;
    this.room = null;
    this.pid = null;
    this.key = null;
    this.state = null;
    this.offset = 0;          // Server-Uhr minus eigene Uhr (s)
    this.bestRtt = 99;
    this.outbox = [];
    this.running = false;
    this.lastOk = 0;
    this.getMe = () => ({});
    this.onState = null;
    this.onInbox = null;
    this.onLost = null;
  }

  // Server suchen: ?s=…, dann dieselbe Adresse, dann der gekoppelte Nova-Laptop (aus der Nova-App –
  // die Tunnel-Adresse wechselt bei jedem Laptop-Neustart, darum frisch aus dem Gist wie in go.html)
  async detect() {
    const cands = [];
    const q = new URLSearchParams(location.search).get('s');
    if (q && validUrl(q)) cands.push(validUrl(q));
    if (/^https?:$/.test(location.protocol)) cands.push(location.origin);
    let conn = null;
    try { conn = JSON.parse(localStorage.getItem('nova.conn') || 'null'); } catch { /* egal */ }
    if (conn?.g && /^[a-f0-9]{20,40}$/.test(conn.g)) {
      const owner = conn.o || (location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : 'schokoboss');
      try {
        const r = await fetch(`https://gist.githubusercontent.com/${encodeURIComponent(owner)}/${conn.g}/raw/agent-endpoint.json?t=${Date.now()}`,
          { cache: 'no-store', signal: AbortSignal.timeout(6000) });
        const u = r.ok ? (await r.json()).url : null;
        if (/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(u || '')) cands.push(u);
      } catch { /* dann die gespeicherte Adresse */ }
    }
    if (conn?.u && validUrl(conn.u)) cands.push(validUrl(conn.u));
    for (const c of [...new Set(cands)]) {
      this.server = c;
      try {
        await this.call({ a: 'ping' }, 4500);
        return c;
      } catch { /* nächster */ }
    }
    this.server = null;
    return null;
  }

  async call(body, timeout = 6000) {
    const t0 = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    let r, j;
    try {
      // text/plain = „einfache“ Anfrage ohne CORS-Vorabfrage → spart eine Runde durch den Tunnel
      r = await fetch(this.server + '/mp/dino', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain' }, cache: 'no-store', signal: ctl.signal });
      j = await r.json();
    } finally { clearTimeout(timer); }
    if (!r.ok || j.error) {
      const e = new Error(j.error || 'Fehler ' + r.status);
      e.status = r.status;
      throw e;
    }
    const t1 = Date.now();
    if (typeof j.now === 'number') {
      const rtt = (t1 - t0) / 1000;
      const off = j.now - (t0 + t1) / 2000;
      if (rtt <= this.bestRtt * 1.3 || !this.lastOk) {   // schnelle Antworten sind die genauesten
        this.offset = this.lastOk ? this.offset * 0.7 + off * 0.3 : off;
        this.bestRtt = Math.min(this.bestRtt, rtt);
      }
    }
    return j;
  }

  serverNow() { return Date.now() / 1000 + this.offset; }

  async create(name, dino) { this._joined(await this.call({ a: 'create', name, dino })); }
  async join(room, name, dino) { this._joined(await this.call({ a: 'join', room: String(room).toUpperCase(), name, dino })); }

  _joined(j) {
    this.room = j.room;
    this.pid = j.you;
    this.key = j.key;
    this.lastOk = Date.now();
    this._apply(j);
    this._loop();
  }

  async start() { this._apply(await this.call({ a: 'start', ...this._auth() })); }

  async leave() {
    const auth = this._auth();
    this.running = false;
    this.room = this.pid = this.key = this.state = null;
    this.outbox = [];
    try { await this.call({ a: 'leave', ...auth }, 2500); } catch { /* egal */ }
  }

  send(ev) { this.outbox.push(ev); }

  inviteLink() {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('raum', this.room);
    if (this.server !== location.origin) u.searchParams.set('s', this.server);
    return u.toString();
  }

  _auth() { return { room: this.room, pid: this.pid, key: this.key }; }

  _apply(j) {
    this.state = j;
    if (j.inbox?.length) this.onInbox?.(j.inbox);
    this.onState?.(j);
  }

  async _loop() {
    if (this.running) return;
    this.running = true;
    while (this.running && this.room) {
      const t0 = performance.now();
      const ev = this.outbox.splice(0);
      try {
        const j = await this.call({ a: 'sync', ...this._auth(), me: this.getMe(), ev });
        if (!this.running) break;
        this.lastOk = Date.now();
        this._apply(j);
      } catch (e) {
        this.outbox.unshift(...ev);
        if (e.status === 404 || e.status === 403 || Date.now() - this.lastOk > 20000) {
          this.running = false;
          this.room = null;
          this.onLost?.(e.status ? e.message : 'Verbindung zum Server verloren.');
          break;
        }
        await sleep(400);
      }
      await sleep(Math.max(15, SYNC_MS - (performance.now() - t0)));
    }
  }
}
