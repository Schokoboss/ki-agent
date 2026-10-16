'use strict';
/* Handy-Modus: Nova läuft direkt im Browser auf dem Handy (WebLLM + WebGPU), ohne Laptop.
   Liefert dieselben Events wie der Laptop-Server, damit app.js alles gleich anzeigen kann. */

const WEBLLM_URL = 'https://esm.run/@mlc-ai/web-llm@0.2.86';

const NovaLocal = (() => {
  const MODELS = [
    { id: 'Qwen3.5-2B', label: 'Qwen3.5 2B', desc: 'Standard – guter Mix aus schlau und schnell', size: 'ca. 1,3 GB' },
    { id: 'Qwen3.5-0.8B', label: 'Qwen3.5 0.8B', desc: 'Mini – sehr schnell, für Einfaches', size: 'ca. 0,6 GB' },
    { id: 'Qwen3.5-4B', label: 'Qwen3.5 4B', desc: 'Groß – klüger, kann am Handy zu viel sein', size: 'ca. 2,5 GB' },
  ];
  let webllm = null;
  let engine = null;
  let loadedId = null;
  let f16 = null;

  async function gpuInfo() {
    if (!('gpu' in navigator)) return { ok: false, why: 'Dieser Browser kann kein WebGPU. Nimm Chrome (aktuell).' };
    const adapter = await navigator.gpu.requestAdapter().catch(() => null);
    if (!adapter) return { ok: false, why: 'Die Grafikeinheit ist für WebGPU nicht freigegeben.' };
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

  async function isCached(id) {
    try { return await (await lib()).hasModelInCache(await mlcId(id)); } catch { return false; }
  }

  async function remove(id) {
    if (loadedId === id && engine) { await engine.unload().catch(() => {}); engine = null; loadedId = null; }
    await (await lib()).deleteModelAllInfoInCache(await mlcId(id));
  }

  async function load(id, onProgress) {
    if (engine && loadedId === id) return engine;
    const gi = await gpuInfo();
    if (!gi.ok) throw new Error(gi.why);
    const w = await lib();
    if (engine) { await engine.unload().catch(() => {}); engine = null; loadedId = null; }
    const worker = new Worker(new URL('llm-worker.js', location.href), { type: 'module' });
    engine = await w.CreateWebWorkerMLCEngine(worker, await mlcId(id), {
      initProgressCallback: p => onProgress?.(p.progress || 0, p.text || ''),
    });
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
      return `${hit.title} (Wikipedia):\n${(page.extract || '').slice(0, 1500)}`;
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
  };

  function memory() {
    try { return JSON.parse(localStorage.getItem('nova.localMemory') || '[]'); } catch { return []; }
  }

  function systemPrompt(user) {
    const now = new Date();
    const date = now.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const mem = memory();
    return `Du bist Nova, ein KI-Assistent, der direkt auf dem Handy von ${user || 'deinem Nutzer'} läuft (Handy-Modus, ohne Laptop). Antworte auf Deutsch, kurz und freundlich. Heute ist ${date}, ${time} Uhr.

Du hast Werkzeuge. Um eins zu benutzen, schreibe NUR diese Zeile und sonst nichts:
<tool_call>{"name": "WERKZEUG", "arguments": {...}}</tool_call>
Werkzeuge:
- weather {"location": "Ort"}: Wetter jetzt und 3 Tage
- wikipedia {"query": "Thema"}: Wissen nachschlagen
- calculate {"expression": "17.5% * 240"}: genau rechnen
- remember {"fact": "..."}: etwas dauerhaft merken
Danach bekommst du das Ergebnis in <tool_response> und antwortest normal.
Für Wetter und Rechnungen IMMER das Werkzeug nutzen. Erfinde keine Werte.
${mem.length ? 'Das hast du dir gemerkt:\n- ' + mem.join('\n- ') : ''}`;
  }

  /* ---------- Agenten-Schleife */

  function toModel(messages) {
    // Verlauf ins Qwen-Format: Werkzeug-Ergebnisse als <tool_response> im User-Zug
    const out = [];
    for (const m of messages) {
      if (m.role === 'user' && !m._system) out.push({ role: 'user', content: m.content });
      else if (m.role === 'assistant') {
        const calls = (m.tool_calls || []).map(c => `<tool_call>{"name": "${c.function.name}", "arguments": ${c.function.arguments}}</tool_call>`);
        out.push({ role: 'assistant', content: [m.content, ...calls].filter(Boolean).join('\n') || '…' });
      } else if (m.role === 'tool') out.push({ role: 'user', content: `<tool_response>\n${m.content}\n</tool_response>` });
    }
    let chars = 0, start = out.length;   // Kontext ist am Handy klein (4096 Tokens)
    while (start > 0 && chars + out[start - 1].content.length < 6500) chars += out[--start].content.length;
    while (start < out.length - 1 && out[start].role !== 'user') start++;
    return out.slice(start);
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

  const GPU_LOST = /disposed|Instance reference|device (was )?lost|mapAsync|DXGI|GPU.*(lost|destroyed)/i;

  async function run(opts) {
    try {
      return await runOnce(opts);
    } catch (e) {
      if (!GPU_LOST.test(String(e?.message || e))) throw e;
      // Grafikeinheit wurde zurückgesetzt (z. B. App im Hintergrund) – Modell neu laden, einmal wiederholen
      engine = null;
      loadedId = null;
      opts.emit({ t: 'status', d: 'Grafik wurde zurückgesetzt – lade das Handy-Modell neu …' });
      return runOnce(opts);
    }
  }

  async function runOnce({ modelId, messages, user, emit, onSave }) {
    const t0 = performance.now();
    let tokens = 0, genMs = 0, toolsUsed = 0;
    const eng = await load(modelId, (p, text) => emit({ t: 'load', p, text }));
    for (let step = 0; step < 5; step++) {
      if (step) emit({ t: 'step' });
      const g0 = performance.now();
      const stream = await eng.chat.completions.create({
        messages: [{ role: 'system', content: systemPrompt(user) }, ...toModel(messages)],
        stream: true, temperature: 0.7, top_p: 0.8, max_tokens: 1024,
        extra_body: { enable_thinking: false }, stream_options: { include_usage: true },
      });
      let raw = '', shown = '';
      for await (const chunk of stream) {
        raw += chunk.choices?.[0]?.delta?.content || '';
        if (chunk.usage) tokens += chunk.usage.completion_tokens || 0;
        const v = visible(raw);
        if (v.length > shown.length) { emit({ t: 'text', d: v.slice(shown.length) }); shown = v; }
      }
      genMs += performance.now() - g0;
      const call = parseCall(raw);
      const msg = { role: 'assistant', content: shown.trim() };
      if (call) msg.tool_calls = [{ id: 'h' + Date.now(), type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }];
      messages.push(msg);
      onSave();
      if (!call) break;
      const id = msg.tool_calls[0].id;
      emit({ t: 'tool', id, name: call.name, args: call.args });
      let ok = true, result;
      try {
        if (!TOOLS[call.name]) throw new Error(`Unbekanntes Werkzeug ${call.name}. Verfügbar: weather, wikipedia, calculate, remember.`);
        result = await TOOLS[call.name](call.args || {});
      } catch (e) { ok = false; result = 'Fehler: ' + e.message; }
      toolsUsed++;
      emit({ t: 'result', id, ok, preview: result });
      messages.push({ role: 'tool', tool_call_id: id, name: call.name, content: result, _ok: ok });
      onSave();
    }
    const secs = (performance.now() - t0) / 1000;
    emit({ t: 'done', stats: { tps: tokens && genMs ? +(tokens / (genMs / 1000)).toFixed(1) : 0, tools: toolsUsed, seconds: +secs.toFixed(1) } });
  }

  return {
    MODELS, gpuInfo, isCached, remove, load, run, stop,
    get loadedId() { return loadedId; },
    _setEngine(e, id) { engine = e; loadedId = id; },  // nur für Tests
  };
})();
