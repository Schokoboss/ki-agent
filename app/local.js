'use strict';
/* Handy-Modus: Nova läuft direkt im Browser auf dem Handy (WebLLM + WebGPU), ohne Laptop.
   Liefert dieselben Events wie der Laptop-Server, damit app.js alles gleich anzeigen kann.
   Speicher ist am Handy knapp: kleiner Kontext, Worker wird beim Neuladen beendet, und ein
   Absturz-Merker erkennt, wenn Chrome die App wegen Speichermangel beendet hat. */

const WEBLLM_URL = 'https://esm.run/@mlc-ai/web-llm@0.2.86';

const NovaLocal = (() => {
  const MODELS = [
    { id: 'Qwen3.5-0.8B', label: 'Qwen3.5 0.8B', desc: 'Stabil und schnell – empfohlen fürs Handy', size: 'ca. 0,6 GB' },
    { id: 'Qwen3.5-2B', label: 'Qwen3.5 2B', desc: 'Schlauer, braucht viel Speicher – kann abstürzen', size: 'ca. 1,3 GB' },
    { id: 'Qwen3.5-4B', label: 'Qwen3.5 4B', desc: 'Sehr groß – meist zu viel fürs Handy', size: 'ca. 2,5 GB' },
  ];
  const CONTEXT = 2048;          // halber Kontext = deutlich weniger Grafikspeicher
  const HISTORY_CHARS = 3800;    // so viel Verlauf passt neben System-Prompt und Antwort
  const BUSY_KEY = 'nova.localBusy';
  let webllm = null;
  let engine = null;
  let worker = null;
  let loadedId = null;
  let f16 = null;

  async function gpuInfo() {
    if (!('gpu' in navigator)) return { ok: false, why: 'Dieser Browser kann kein WebGPU. Nimm Chrome (aktuell).' };
    const adapter = await navigator.gpu.requestAdapter().catch(() => null);
    if (!adapter) return { ok: false, why: 'Die Grafikeinheit ist gerade nicht verfügbar. App schließen und neu öffnen.' };
    f16 = adapter.features.has('shader-f16');
    return { ok: true };
  }

  async function lib() {
    if (!webllm) webllm = await import(WEBLLM_URL);
    return webllm;
  }

  async function mlcId(id) {
    if (f16 === null) await gpuInfo();
    return `${id}-${f16 ? 'q4f16_1' : 'q4f32_1'}-MLC`;
  }

  // Ohne die 7-MB-Bibliothek zu laden: direkt im Cache nachsehen
  async function isCached(id) {
    try {
      const mid = await mlcId(id);
      const keys = await (await caches.open('webllm/model')).keys();
      return keys.some(k => k.url.includes(`/${mid}/`) && k.url.includes('params_shard_0'));
    } catch { return false; }
  }

  function busy(phase, id) {
    try {
      if (phase) localStorage.setItem(BUSY_KEY, JSON.stringify({ phase, model: id, t: Date.now() }));
      else localStorage.removeItem(BUSY_KEY);
    } catch { /* egal */ }
  }

  // Lief beim letzten Mal noch das Handy-Modell, als die App weg war? Dann ist sie abgestürzt.
  function crashInfo() {
    try {
      const v = JSON.parse(localStorage.getItem(BUSY_KEY) || 'null');
      localStorage.removeItem(BUSY_KEY);
      return v;
    } catch { return null; }
  }

  async function reset() {
    try { await engine?.unload(); } catch { /* Gerät evtl. schon weg */ }
    worker?.terminate();
    engine = null;
    worker = null;
    loadedId = null;
  }

  async function remove(id) {
    if (loadedId === id) await reset();
    await (await lib()).deleteModelAllInfoInCache(await mlcId(id));
  }

  async function load(id, onProgress) {
    if (engine && loadedId === id) return engine;
    const gi = await gpuInfo();
    if (!gi.ok) throw new Error(gi.why);
    const w = await lib();
    await reset();
    navigator.storage?.persist?.().catch(() => {});  // Modell nicht vom Browser wegräumen lassen
    busy('load', id);
    worker = new Worker(new URL('llm-worker.js', location.href), { type: 'module' });
    try {
      engine = await w.CreateWebWorkerMLCEngine(worker, await mlcId(id),
        { initProgressCallback: p => onProgress?.(p.progress || 0, p.text || '') },
        { context_window_size: CONTEXT });
    } catch (e) {
      busy(null);
      await reset();
      throw e;
    }
    busy(null);
    loadedId = id;
    return engine;
  }

  function stop() { engine?.interruptGenerate(); }

  /* ---------- Werkzeuge (laufen im Browser) */

  async function getJSON(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  const WCODES = { 0: 'klar', 1: 'überwiegend klar', 2: 'teils bewölkt', 3: 'bedeckt', 45: 'Nebel', 48: 'Reifnebel',
    51: 'leichter Niesel', 53: 'Niesel', 55: 'starker Niesel', 61: 'leichter Regen', 63: 'Regen', 65: 'starker Regen',
    71: 'leichter Schnee', 73: 'Schnee', 75: 'starker Schnee', 80: 'Regenschauer', 81: 'Regenschauer',
    82: 'heftige Schauer', 85: 'Schneeschauer', 95: 'Gewitter', 96: 'Gewitter mit Hagel', 99: 'schweres Gewitter' };

  const TOOLS = {
    async weather({ location }) {
      const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=de&name=${encodeURIComponent(location || '')}`);
      const p = g.results?.[0];
      if (!p) return `Ort "${location}" nicht gefunden.`;
      const f = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&timezone=auto&forecast_days=3`
        + '&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
      const d = f.daily;
      return [`Wetter in ${p.name}: jetzt ${f.current.temperature_2m} °C, ${WCODES[f.current.weather_code] || '?'}, Wind ${f.current.wind_speed_10m} km/h`]
        .concat(d.time.map((t, i) => `${t}: ${WCODES[d.weather_code[i]] || '?'}, ${d.temperature_2m_min[i]}–${d.temperature_2m_max[i]} °C, Regen ${d.precipitation_probability_max[i]} %`))
        .join('\n') + '\nQuelle: open-meteo.com';
    },
    async wikipedia({ query }) {
      const base = 'https://de.wikipedia.org/w/api.php?format=json&origin=*&';
      const s = await getJSON(base + 'action=query&list=search&srlimit=1&srsearch=' + encodeURIComponent(query || ''));
      const hit = s.query?.search?.[0];
      if (!hit) return `Nichts zu "${query}" gefunden.`;
      const e = await getJSON(base + 'action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=' + encodeURIComponent(hit.title));
      const page = Object.values(e.query?.pages || {})[0] || {};
      return `${hit.title} (Wikipedia):\n${(page.extract || '').slice(0, 1200)}`;
    },
    async calculate({ expression }) {
      let x = String(expression || '').replace(/\^/g, '**').replace(/×/g, '*').replace(/÷/g, '/');
      if (!x.includes('(')) x = x.replace(/(\d),(\d)/g, '$1.$2');
      x = x.replace(/\b(von|of)\b/gi, '*').replace(/(\d+(?:\.\d+)?)\s*%/g, '($1/100)');
      const fns = ['sqrt', 'sin', 'cos', 'tan', 'log', 'log10', 'exp', 'abs', 'round', 'floor', 'ceil', 'PI'];
      const bare = fns.reduce((s, f) => s.split(f).join(''), x);
      if (!/^[\d\s+\-*/().]*$/.test(bare)) return 'Fehler: Nur Zahlen, + - * / ^ %, Klammern und sqrt/sin/cos/log erlaubt.';
      const js = fns.reduce((s, f) => s.replace(new RegExp(`\\b${f}\\b`, 'g'), `Math.${f}`), x);
      const v = Function(`"use strict"; return (${js});`)();
      return `${expression} = ${Number.isFinite(v) ? +v.toPrecision(12) : v}`;
    },
    async remember({ fact }) {
      const mem = memory();
      mem.push(String(fact || '').slice(0, 300));
      localStorage.setItem('nova.localMemory', JSON.stringify(mem.slice(-30)));
      return `Gemerkt: ${fact}`;
    },
    async save_file({ name, content }, ctx) {
      const fname = String(name || 'nova.txt').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'nova.txt';
      const text = String(content || '');
      ctx.file = { name: fname, data: 'data:text/plain;charset=utf-8,' + encodeURIComponent(text), size: text.length };
      return `Datei "${fname}" (${text.length} Zeichen) liegt im Chat zum Speichern bereit.`;
    },
    async notes({ text }, ctx) {
      ctx.conv._notes = String(text || '').slice(0, 1500);
      return 'Notizen gespeichert.';
    },
  };

  function memory() {
    try { return JSON.parse(localStorage.getItem('nova.localMemory') || '[]'); } catch { return []; }
  }

  function systemPrompt(user, work) {
    const now = new Date();
    const date = now.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const mem = memory();
    const until = work ? new Date(work.deadline).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
    return `Du bist Nova, ein KI-Assistent direkt auf dem Handy von ${user || 'deinem Nutzer'} (Handy-Modus, ohne Laptop). Antworte auf Deutsch, kurz und freundlich. Heute ist ${date}, ${time} Uhr.

Werkzeuge – schreibe zum Benutzen NUR diese Zeile:
<tool_call>{"name": "WERKZEUG", "arguments": {...}}</tool_call>
- weather {"location": "Ort"}: Wetter
- wikipedia {"query": "Thema"}: Wissen nachschlagen
- calculate {"expression": "17.5% * 240"}: rechnen
- remember {"fact": "..."}: dauerhaft merken
- save_file {"name": "plan.txt", "content": "..."}: Text als Datei speichern
- notes {"text": "..."}: Plan und Fortschritt notieren
Das Ergebnis kommt in <tool_response>. Für Wetter und Rechnungen IMMER das Werkzeug nutzen. Erfinde nichts.${work ? `

AUFTRAG: Arbeite selbstständig bis ${until} Uhr ohne Rückfragen. Plane kurz, notiere Fortschritt mit notes, speichere Ergebnisse mit save_file. Wenn alles fertig ist, beginne deine Antwort mit FERTIG.` : ''}${mem.length ? '\nGemerkt:\n- ' + mem.join('\n- ') : ''}`;
  }

  /* ---------- Agenten-Schleife */

  function toModel(conv) {
    // Verlauf ins Qwen-Format: Werkzeug-Ergebnisse als <tool_response> im User-Zug
    const out = [];
    conv.messages.forEach((m, i) => {
      let msg = null;
      if (m.role === 'user') msg = { role: 'user', content: m.content };
      else if (m.role === 'assistant') {
        const calls = (m.tool_calls || []).map(c => `<tool_call>{"name": "${c.function.name}", "arguments": ${c.function.arguments}}</tool_call>`);
        const content = [m.content, ...calls].filter(Boolean).join('\n');
        if (content) msg = { role: 'assistant', content };
      } else if (m.role === 'tool') msg = { role: 'user', content: `<tool_response>\n${m.content.slice(0, 1500)}\n</tool_response>` };
      if (msg) out.push({ ...msg, i });
    });
    let chars = 0, start = out.length;   // Kontext ist am Handy klein
    while (start > 0 && chars + out[start - 1].content.length < HISTORY_CHARS) chars += out[--start].content.length;
    while (start < out.length - 1 && out[start].role !== 'user') start++;
    const kept = out.slice(start);
    const pin = conv._taskIndex;
    if (pin != null && kept.length && kept[0].i > pin) {   // Auftrag nie vergessen
      const task = conv.messages[pin];
      kept.unshift({ role: 'user', content: `${task.content.slice(0, 800)}\n[Ältere Schritte ausgeblendet.${conv._notes ? ' Deine Notizen: ' + conv._notes : ''}]` });
    }
    // Zwei Nachrichten derselben Rolle hintereinander zusammenfassen (Vorlage erwartet Wechsel)
    const merged = [];
    for (const m of kept) {
      const last = merged[merged.length - 1];
      if (last && last.role === m.role) last.content += '\n\n' + m.content;
      else merged.push({ role: m.role, content: m.content });
    }
    return merged;
  }

  function parseCall(raw) {
    const m = raw.match(/<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/);
    if (!m) return null;
    const body = m[1].trim();
    try {
      const j = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1));
      if (j.name) return { name: j.name, args: j.arguments || j.parameters || {} };
    } catch { /* evtl. XML-Form */ }
    const fn = body.match(/<function=([\w-]+)>/);
    if (!fn) return null;
    const args = {};
    for (const p of body.matchAll(/<parameter=([\w-]+)>\s*([\s\S]*?)\s*<\/parameter>/g)) args[p[1]] = p[2];
    return { name: fn[1], args };
  }

  function visible(raw) {
    let s = raw.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').split('<tool_call')[0];
    const tail = s.match(/<[a-z_]*$/);
    if (tail && ('<tool_call'.startsWith(tail[0]) || '<think'.startsWith(tail[0]))) s = s.slice(0, tail.index);
    return s.replace(/^\s+/, '');
  }

  const GPU_LOST = /disposed|Instance reference|device (was )?lost|mapAsync|DXGI|GPU.*(lost|destroyed)|Worker/i;
  const waitVisible = () => new Promise(r => {
    if (!document.hidden) return r();
    const on = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', on); r(); } };
    document.addEventListener('visibilitychange', on);
  });

  function fmtLeft(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  async function run(opts) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await runOnce(opts);
      } catch (e) {
        busy(null);
        const msgs = opts.conv.messages;
        while (msgs.length && msgs[msgs.length - 1]._partial) msgs.pop();  // halbe Antwort verwerfen
        opts.onSave();
        if (!GPU_LOST.test(String(e?.message || e)) || attempt >= 2) throw e;
        // Grafikeinheit weg (App war im Hintergrund / Handy aus): warten, neu laden, weitermachen
        await reset();
        if (document.hidden) {
          opts.emit({ t: 'status', d: 'Pausiert – geht weiter, sobald du Nova wieder öffnest.' });
          await waitVisible();
        }
        opts.emit({ t: 'status', d: 'Lade das Handy-Modell neu und mache weiter …' });
      }
    }
  }

  async function runOnce({ modelId, conv, user, work, emit, onSave }) {
    const t0 = performance.now();
    let tokens = 0, genMs = 0, toolsUsed = 0, nudges = 0, final = false;
    const messages = conv.messages;
    const eng = await load(modelId, (p, text) => emit({ t: 'load', p, text }));
    const maxSteps = work ? 80 : 6;
    for (let step = 0; step < maxSteps; step++) {
      if (document.hidden) {
        emit({ t: 'status', d: 'Pausiert – das Handy ist aus. Geht weiter, sobald du Nova wieder öffnest.' });
        await waitVisible();
      }
      if (work && !final && Date.now() > work.deadline) {
        final = true;
        messages.push({ role: 'user', content: '[System: Die Arbeitszeit ist um. Fasse kurz zusammen, was du geschafft hast.]', _system: 'Arbeitszeit vorbei' });
        emit({ t: 'status', d: 'Arbeitszeit vorbei – fasse zusammen …' });
      }
      if (step) emit({ t: 'step' });
      if (work) emit({ t: 'work', started: work.started / 1000, deadline: work.deadline / 1000, step: step + 1 });
      const g0 = performance.now();
      busy('generate', modelId);
      const msg = { role: 'assistant', content: '', _partial: true };
      messages.push(msg);
      const stream = await eng.chat.completions.create({
        messages: [{ role: 'system', content: systemPrompt(user, work) }, ...toModel({ ...conv, messages: messages.slice(0, -1) })],
        stream: true, temperature: 0.7, top_p: 0.8, max_tokens: 700,
        extra_body: { enable_thinking: false }, stream_options: { include_usage: true },
      });
      let raw = '', shown = '', lastSave = Date.now();
      for await (const chunk of stream) {
        raw += chunk.choices?.[0]?.delta?.content || '';
        if (chunk.usage) tokens += chunk.usage.completion_tokens || 0;
        const v = visible(raw);
        if (v.length > shown.length) { emit({ t: 'text', d: v.slice(shown.length) }); shown = v; }
        if (Date.now() - lastSave > 1500) { msg.content = shown; onSave(); lastSave = Date.now(); }  // Zwischenstand sichern
      }
      busy(null);
      genMs += performance.now() - g0;
      const call = final ? null : parseCall(raw);
      msg.content = shown.trim();
      delete msg._partial;
      if (call) msg.tool_calls = [{ id: 'h' + Date.now(), type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }];
      if (!msg.content && !call) messages.pop();
      onSave();
      if (!call) {
        const done = /^\W*FERTIG/i.test(shown);
        if (work && !final && !done && nudges < 2 && work.deadline - Date.now() > 60000) {
          nudges++;
          messages.push({ role: 'user', content: `[System: Noch ${fmtLeft(work.deadline - Date.now())} Zeit. Ist der Auftrag wirklich fertig? Wenn ja, antworte mit FERTIG und Zusammenfassung, sonst arbeite weiter.]`, _system: 'Prüft, ob alles fertig ist …' });
          emit({ t: 'status', d: 'Prüft, ob der Auftrag wirklich fertig ist …' });
          onSave();
          continue;
        }
        break;
      }
      const id = msg.tool_calls[0].id;
      emit({ t: 'tool', id, name: call.name, args: call.args });
      const ctx = { conv };
      let ok = true, result;
      try {
        if (!TOOLS[call.name]) throw new Error(`Unbekanntes Werkzeug ${call.name}. Verfügbar: ${Object.keys(TOOLS).join(', ')}.`);
        result = await TOOLS[call.name](call.args || {}, ctx);
      } catch (e) { ok = false; result = 'Fehler: ' + e.message; }
      toolsUsed++;
      emit({ t: 'result', id, ok, preview: result });
      if (ctx.file) emit({ t: 'file', ...ctx.file, local: true });
      if (work) result += `\n[Noch ${fmtLeft(work.deadline - Date.now())} Arbeitszeit]`;
      messages.push({ role: 'tool', tool_call_id: id, name: call.name, content: result, _ok: ok, ...(ctx.file ? { _file: ctx.file } : {}) });
      onSave();
    }
    const secs = (performance.now() - t0) / 1000;
    emit({ t: 'done', stats: { tps: tokens && genMs ? +(tokens / (genMs / 1000)).toFixed(1) : 0, tools: toolsUsed,
      seconds: +secs.toFixed(1), long: !!work, steps: toolsUsed + 1 } });
  }

  return {
    MODELS, gpuInfo, isCached, remove, load, run, stop, crashInfo, reset,
    get loadedId() { return loadedId; },
    _setEngine(e, id) { engine = e; loadedId = id; },  // nur für Tests
  };
})();
