// Der Agent-Loop: Claude Fable 5.2 plant, schreibt Code und benutzt die lokalen Werkzeuge,
// bis die Aufgabe erledigt ist. Läuft lokal (Messages API), weil die Werkzeuge auf dem
// Rechner des Nutzers arbeiten müssen (Dateien, Unreal Engine).
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { SYSTEM_PROMPT } = require('./prompt');
const { TOOLS, validateInput } = require('./tools');

const MODEL = 'claude-fable-5-2';
const MAX_TURNS = 200; // Sicherheitsgrenze pro Auftrag

class Agent {
  constructor({ apiKey, effort, toolCtx, emit }) {
    this.client = new Anthropic({ apiKey, timeout: 30 * 60 * 1000 });
    this.effort = effort || 'high';
    this.toolCtx = toolCtx;
    this.emit = emit; // (event, payload) => void, an die Oberfläche
    this.messages = [];
    this.aborted = false;
    this.currentStream = null;
  }

  historyFile() {
    const root = this.toolCtx.getProjectRoot();
    return root ? path.join(root, '.forge', 'history.json') : null;
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

  abort() {
    this.aborted = true;
    try { this.currentStream && this.currentStream.abort(); } catch { /* egal */ }
  }

  /** Ein Auftrag des Nutzers – läuft, bis Claude fertig ist. */
  async send(userText) {
    this.aborted = false;
    // Verlauf wird nur angehängt, nie umgeschrieben (Thinking-Blöcke bleiben gültig).
    this.messages.push({ role: 'user', content: userText });

    for (let turn = 0; turn < MAX_TURNS && !this.aborted; turn++) {
      const response = await this.streamTurn();
      if (!response) return; // abgebrochen
      const projectBefore = this.toolCtx.getProjectRoot();
      this.messages.push({ role: 'assistant', content: response.content });

      for (const b of response.content) {
        if (b.type === 'fallback') this.emit('status', `Hinweis: ${b.from.model} hat abgelehnt, ${b.to.model} macht weiter.`);
      }

      const stop = response.stop_reason;
      if (stop === 'refusal') {
        this.emit('status', 'Claude hat diese Anfrage abgelehnt. Bitte formuliere sie anders.');
        break;
      }
      if (stop === 'pause_turn') continue; // Server-Tool (Web-Suche) läuft weiter
      if (stop === 'max_tokens') {
        // Abgeschnittene Werkzeugeingaben nicht ausführen – um Fortsetzung bitten.
        const results = this.toolUses(response).map((t) => ({
          type: 'tool_result', tool_use_id: t.id, is_error: true,
          content: 'Ausgabe wurde am Token-Limit abgeschnitten und nicht ausgeführt. Bitte in kleineren Teilen erneut senden.',
        }));
        this.messages.push({ role: 'user', content: results.length ? results : 'Bitte fahre fort.' });
        continue;
      }
      if (stop !== 'tool_use') break; // end_turn oder stop_sequence

      const results = [];
      for (const t of this.toolUses(response)) {
        if (this.aborted) {
          results.push({ type: 'tool_result', tool_use_id: t.id, is_error: true, content: 'Vom Nutzer abgebrochen.' });
          continue;
        }
        results.push(await this.runTool(t));
      }
      // Alle Ergebnisse in EINER Nachricht zurückgeben.
      this.messages.push({ role: 'user', content: results });
      if (this.toolCtx.getProjectRoot() !== projectBefore) this.emit('project', this.toolCtx.getProjectRoot());
      this.saveHistory();
    }
    this.saveHistory();
    this.emit('done', null);
  }

  toolUses(response) {
    return response.content.filter((b) => b.type === 'tool_use');
  }

  async runTool(t) {
    this.emit('tool', { name: t.name, input: summarize(t.input) });
    const err = validateInput(t.name, t.input);
    if (err) {
      return { type: 'tool_result', tool_use_id: t.id, is_error: true, content: JSON.stringify({ INVALID_INPUT: err }) };
    }
    try {
      const out = await this.toolCtx.run(t.name, t.input);
      this.emit('tool_result', { name: t.name, ok: true, text: String(out).slice(0, 2000) });
      return { type: 'tool_result', tool_use_id: t.id, content: String(out) };
    } catch (e) {
      this.emit('tool_result', { name: t.name, ok: false, text: e.message });
      return { type: 'tool_result', tool_use_id: t.id, is_error: true, content: e.message };
    }
  }

  /** Ein Modellaufruf mit Streaming; gibt die fertige Nachricht zurück. */
  async streamTurn() {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const stream = this.client.beta.messages.stream({
          model: MODEL,
          max_tokens: 64000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default', // bei Ablehnung automatisch passendes Ersatzmodell
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { effort: this.effort },
          cache_control: { type: 'ephemeral' },
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages: this.messages,
        });
        this.currentStream = stream;
        for await (const ev of stream) {
          if (ev.type === 'content_block_start' && ev.content_block.type === 'text') this.emit('text_start', null);
          if (ev.type === 'content_block_delta') {
            if (ev.delta.type === 'text_delta') this.emit('text', ev.delta.text);
            else if (ev.delta.type === 'thinking_delta') this.emit('thinking', ev.delta.thinking);
          }
        }
        const msg = await stream.finalMessage();
        this.emit('usage', msg.usage);
        return msg;
      } catch (e) {
        if (this.aborted) return null;
        // Nur unlesbares Tool-JSON wiederholen; echte API-Fehler (Auth, Limit …) weiterreichen.
        if (e instanceof Anthropic.APIError || !/JSON/i.test(String(e && e.message))) throw e;
        this.emit('status', 'Werkzeugeingabe war unlesbar – wiederhole …');
      } finally {
        this.currentStream = null;
      }
    }
    throw new Error('Werkzeugeingabe dreimal unlesbar – Auftrag abgebrochen.');
  }
}

function summarize(input) {
  const o = {};
  for (const [k, v] of Object.entries(input || {})) {
    o[k] = typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}… (${v.length} Zeichen)` : v;
  }
  return o;
}

module.exports = { Agent, MODEL };
