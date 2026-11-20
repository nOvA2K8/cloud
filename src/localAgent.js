// Kostenlose lokale KI über Ollama (läuft auf der eigenen Grafikkarte, keine Kosten, keine Daten nach außen).
const fs = require('fs');
const path = require('path');
const { LOCAL_SYSTEM_PROMPT } = require('./prompt');
const { LOCAL_TOOLS, validateInput } = require('./tools');

const MAX_TURNS = 80;
const TOOL_RESULT_LIMIT = 6000; // kleine Kontextfenster: Werkzeug-Ausgaben kürzen

class LocalAgent {
  constructor({ baseUrl, model, numCtx, toolCtx, memory, emit }) {
    this.baseUrl = (baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
    this.model = model || 'qwen3:8b';
    this.numCtx = numCtx || 12288;
    this.toolCtx = toolCtx;
    this.memory = memory;
    this.emit = emit;
    this.messages = [];
    this.aborted = false;
    this.controller = null;
  }

  historyFile() {
    const root = this.toolCtx.getProjectRoot();
    return root ? path.join(root, '.forge', 'history-local.json') : null;
  }

  loadHistory() {
    const f = this.historyFile();
    this.messages = [];
    try { if (f) this.messages = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* neu */ }
    return this.messages;
  }

  saveHistory() {
    const f = this.historyFile();
    if (!f) return;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(this.messages));
  }

  displayHistory() {
    const out = [];
    for (const m of this.messages) {
      if (m.role === 'user') out.push({ type: 'user', text: m.display || m.content });
      if (m.role === 'assistant') {
        if (m.content && m.content.trim()) out.push({ type: 'assistant', text: m.content });
        for (const c of m.tool_calls || []) out.push({ type: 'tool', text: c.function.name });
      }
    }
    return out;
  }

  abort() {
    this.aborted = true;
    try { this.controller && this.controller.abort(); } catch { /* egal */ }
  }

  /** Prüft, ob Ollama läuft und ob das Modell installiert ist. */
  static async status(baseUrl, model) {
    const url = (baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
    try {
      const r = await fetch(url + '/api/tags', { signal: AbortSignal.timeout(3000) });
      const j = await r.json();
      const names = (j.models || []).map((m) => m.name);
      const has = names.some((n) => n === model || n === model + ':latest' || n.split(':')[0] === model);
      return { running: true, hasModel: has, models: names };
    } catch {
      return { running: false, hasModel: false, models: [] };
    }
  }

  /** Lädt ein Modell herunter (Fortschritt über onProgress). */
  static async pull(baseUrl, model, onProgress) {
    const url = (baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const res = await fetch(url + '/api/pull', { method: 'POST', body: JSON.stringify({ model, stream: true }) });
    if (!res.ok) throw new Error(`Ollama: HTTP ${res.status}`);
    for await (const obj of ndjson(res.body)) {
      if (obj.error) throw new Error(obj.error);
      onProgress(obj);
    }
  }

  async send(userText) {
    this.aborted = false;
    const hints = this.memory ? this.memory.recall(userText, 5) : [];
    const content = hints.length
      ? `${userText}\n\n(Aus deinem Gedächtnis, falls hilfreich:\n${this.memory.format(hints)})`
      : userText;
    const project = this.toolCtx.getProjectRoot();
    const ctxNote = project ? `\n\n(Aktives Projekt: ${project})` : '\n\n(Noch kein aktives Projekt.)';
    this.messages.push({ role: 'user', content: content + ctxNote, display: userText });

    let emptyRetries = 0;
    for (let turn = 0; turn < MAX_TURNS && !this.aborted; turn++) {
      const msg = await this.chatTurn();
      if (!msg) break; // abgebrochen
      let calls = msg.tool_calls || [];
      if (!calls.length) calls = extractTextToolCalls(msg.content);
      this.messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls.length ? calls : undefined });

      if (!calls.length) {
        // Kleine Modelle antworten manchmal leer – einmal anstupsen.
        if (!(msg.content || '').trim() && emptyRetries++ < 1) {
          this.messages.push({ role: 'user', content: 'Mach weiter. Benutze die Werkzeuge oder fasse zusammen, was erledigt ist.' });
          continue;
        }
        break;
      }
      for (const c of calls) {
        if (this.aborted) break;
        const name = c.function.name;
        let args = c.function.arguments;
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = null; } }
        this.emit('tool', { name, input: summarize(args) });
        let result;
        const err = validateInput(name, args);
        if (err) {
          result = `FEHLER bei der Eingabe: ${err}. Rufe ${name} erneut mit korrekten Feldern auf.`;
          this.emit('tool_result', { name, ok: false, text: result });
        } else {
          try {
            result = String(await this.toolCtx.run(name, args));
            this.emit('tool_result', { name, ok: true, text: result.slice(0, 2000) });
          } catch (e) {
            result = `FEHLER: ${e.message}`;
            this.emit('tool_result', { name, ok: false, text: e.message });
          }
        }
        if (result.length > TOOL_RESULT_LIMIT) {
          result = result.slice(0, 1500) + `\n[... ${result.length - TOOL_RESULT_LIMIT} Zeichen gekürzt ...]\n` + result.slice(-(TOOL_RESULT_LIMIT - 1500));
        }
        this.messages.push({ role: 'tool', tool_name: name, content: result });
      }
      if (this.toolCtx.getProjectRoot() !== project) this.emit('project', this.toolCtx.getProjectRoot());
      this.saveHistory();
    }
    this.saveHistory();
    this.emit('done', null);
  }

  /** Nimmt so viel Verlauf mit, wie ins Kontextfenster passt (grob 3 Zeichen pro Token). */
  contextWindow() {
    const budget = this.numCtx * 3 - LOCAL_SYSTEM_PROMPT.length - 6000; // Platz für Werkzeugliste + Antwort
    const out = [];
    let used = 0;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      const size = (m.content || '').length + JSON.stringify(m.tool_calls || '').length;
      if (used + size > budget && out.length) break;
      used += size;
      out.unshift(m);
    }
    while (out.length > 1 && out[0].role !== 'user') out.shift(); // nicht mit Werkzeug-Ergebnis beginnen
    return out.map(({ display, ...m }) => m);
  }

  async chatTurn() {
    this.controller = new AbortController();
    let res;
    try {
      res = await fetch(this.baseUrl + '/api/chat', {
        method: 'POST',
        signal: this.controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: true,
          messages: [{ role: 'system', content: LOCAL_SYSTEM_PROMPT }, ...this.contextWindow()],
          tools: LOCAL_TOOLS,
          options: { num_ctx: this.numCtx, temperature: 0.4 },
        }),
      });
    } catch (e) {
      if (this.aborted) return null;
      throw new Error(`Ollama nicht erreichbar (${this.baseUrl}). Ist Ollama installiert und gestartet? ${e.message}`);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Ollama-Fehler HTTP ${res.status}: ${t.slice(0, 300)}`);
    }
    let content = '';
    const toolCalls = [];
    let started = false;
    try {
      for await (const obj of ndjson(res.body)) {
        if (obj.error) throw new Error(obj.error);
        const m = obj.message || {};
        if (m.thinking) this.emit('thinking', m.thinking);
        if (m.content) {
          if (!started) { this.emit('text_start', null); started = true; }
          content += m.content;
          this.emit('text', m.content);
        }
        if (m.tool_calls) toolCalls.push(...m.tool_calls);
        if (obj.done) this.emit('usage', { input_tokens: obj.prompt_eval_count || 0, output_tokens: obj.eval_count || 0 });
      }
    } catch (e) {
      if (this.aborted) return null;
      throw e;
    } finally {
      this.controller = null;
    }
    return { content, tool_calls: toolCalls };
  }
}

/** Liest zeilenweise JSON aus einem Stream. */
async function* ndjson(body) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield JSON.parse(line);
    }
  }
  if (buf.trim()) yield JSON.parse(buf.trim());
}

/** Manche lokalen Modelle schreiben Werkzeugaufrufe als Text statt als Funktionsaufruf – hier auffangen. */
function extractTextToolCalls(text) {
  if (!text) return [];
  const calls = [];
  const candidates = [];
  const tagRe = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let m;
  while ((m = tagRe.exec(text))) candidates.push(m[1]);
  if (!candidates.length) {
    const fence = text.match(/```(?:json)?\s*(\{[\s\S]*?"name"[\s\S]*?\})\s*```/);
    if (fence) candidates.push(fence[1]);
  }
  for (const c of candidates) {
    try {
      const o = JSON.parse(c);
      const name = o.name || (o.function && o.function.name);
      const args = o.arguments || o.parameters || (o.function && o.function.arguments) || {};
      if (name && LOCAL_TOOLS.some((t) => t.function.name === name)) calls.push({ function: { name, arguments: args } });
    } catch { /* kein gültiges JSON */ }
  }
  return calls;
}

function summarize(input) {
  const o = {};
  for (const [k, v] of Object.entries(input || {})) {
    o[k] = typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}… (${v.length} Zeichen)` : v;
  }
  return o;
}

module.exports = { LocalAgent, extractTextToolCalls };
