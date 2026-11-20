const $ = (id) => document.getElementById(id);
const chat = $('chat');
let busy = false;
let curText = null;
let curThinking = null;
let lastTool = null;
let totals = { in: 0, out: 0 };

function el(cls, text) {
  const d = document.createElement('div');
  d.className = cls;
  if (text != null) d.textContent = text;
  $('welcome') && $('welcome').remove();
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
  return d;
}

function setBusy(b) {
  busy = b;
  $('btnSend').disabled = b;
  $('btnStop').hidden = !b;
}

async function refreshProject() {
  const p = await window.forge.currentProject();
  $('project').textContent = p || 'keins – wird beim ersten Auftrag angelegt';
}

async function refreshEngine() {
  const e = await window.forge.engines();
  $('engine').textContent = e.length ? `UE ${e[0].version} gefunden` : 'nicht gefunden – Pfad in Einstellungen setzen (Projekte werden trotzdem erstellt)';
}

function renderHistory(items) {
  chat.innerHTML = '';
  for (const it of items) {
    if (it.type === 'user') el('msg user', it.text);
    else if (it.type === 'assistant') el('msg assistant', it.text);
    else if (it.type === 'tool') { const t = el('tool'); const n = document.createElement('span'); n.className = 'name'; n.textContent = '⚒ ' + it.text; t.appendChild(n); }
  }
}

async function refreshAi() {
  const s = await window.forge.getSettings();
  $('btnPull').hidden = true; $('btnOllama').hidden = true;
  if (s.provider === 'claude') {
    $('aiStatus').textContent = `${s.claudeModel.replace('claude-', 'Claude ').replace(/-/g, ' ')} – ${s.hasKey ? 'bereit (kostenpflichtig)' : 'API-Schlüssel fehlt'}`;
    return;
  }
  const st = await window.forge.ollamaStatus();
  if (!st.running) {
    $('aiStatus').textContent = 'Lokale KI: Ollama läuft nicht. Installieren und starten, dann App neu öffnen.';
    $('btnOllama').hidden = false;
  } else if (!st.hasModel) {
    $('aiStatus').textContent = `Lokale KI: Modell ${st.model} noch nicht heruntergeladen (einmalig ~5 GB).`;
    $('btnPull').hidden = false;
  } else {
    $('aiStatus').textContent = `Lokale KI: ${st.model} – bereit (kostenlos)`;
  }
}

async function refreshMemory() {
  const m = await window.forge.memoryInfo();
  $('memInfo').textContent = `${m.count} Erkenntnisse gespeichert`;
}

async function send(text) {
  if (busy || !text.trim()) return;
  const s = await window.forge.getSettings();
  if (s.provider === 'claude' && !s.hasKey) { openSettings(); return; }
  if (s.provider === 'local') {
    const st = await window.forge.ollamaStatus();
    if (!st.running || !st.hasModel) { el('error', '⚠ Die lokale KI ist noch nicht bereit – siehe Hinweis links unter „KI“.'); return; }
  }
  el('msg user', text);
  $('input').value = '';
  curText = null; curThinking = null;
  setBusy(true);
  window.forge.send(text);
}

window.forge.onAgent(({ event, payload }) => {
  switch (event) {
    case 'thinking':
      if (!curThinking) curThinking = el('thinking', '');
      curThinking.textContent += payload;
      curThinking.scrollTop = curThinking.scrollHeight;
      break;
    case 'text_start':
      curText = el('msg assistant', ''); curThinking = null;
      break;
    case 'text':
      if (!curText) curText = el('msg assistant', '');
      curText.textContent += payload;
      chat.scrollTop = chat.scrollHeight;
      break;
    case 'tool': {
      curText = null; curThinking = null;
      lastTool = el('tool');
      const n = document.createElement('div'); n.className = 'name';
      const arg = payload.input.path || payload.input.name || payload.input.filename || payload.input.command || '';
      n.textContent = `⚒ ${payload.name} ${arg}`;
      lastTool.appendChild(n);
      break;
    }
    case 'tool_result':
      if (lastTool) {
        lastTool.classList.add(payload.ok ? 'ok' : 'err');
        const r = document.createElement('div'); r.className = 'res';
        r.textContent = payload.text.split('\n').slice(0, 8).join('\n');
        lastTool.appendChild(r);
      }
      refreshProject();
      break;
    case 'log': {
      const log = $('log');
      log.textContent = (log.textContent + payload).slice(-60000);
      log.scrollTop = log.scrollHeight;
      break;
    }
    case 'status': el('status', payload); break;
    case 'error': el('error', '⚠ ' + payload); break;
    case 'project': refreshProject(); break;
    case 'usage':
      totals.in += (payload.input_tokens || 0) + (payload.cache_read_input_tokens || 0) + (payload.cache_creation_input_tokens || 0);
      totals.out += payload.output_tokens || 0;
      $('usage').textContent = `Tokens diese Sitzung: ${Math.round(totals.in / 1000)}k rein · ${Math.round(totals.out / 1000)}k raus`;
      break;
    case 'pull': {
      const p = payload;
      const pct = p.total ? ` ${Math.round((p.completed || 0) / p.total * 100)} %` : '';
      $('aiStatus').textContent = `Download: ${p.status}${pct}`;
      if (p.status === 'fertig' || String(p.status).startsWith('Fehler')) { $('btnPull').disabled = false; if (p.status === 'fertig') refreshAi(); }
      break;
    }
    case 'done': setBusy(false); refreshProject(); refreshMemory(); break;
  }
});

function toggleProviderBoxes() {
  const local = $('sProvider').value === 'local';
  $('localBox').hidden = !local;
  $('claudeBox').hidden = local;
}

async function openSettings() {
  const s = await window.forge.getSettings();
  $('sProvider').value = s.provider;
  $('sLocalModel').value = s.localModel;
  $('sNumCtx').value = String(s.numCtx);
  $('sClaudeModel').value = s.claudeModel;
  $('sKey').value = s.apiKey;
  $('sEngine').value = s.enginePath;
  $('sProjects').value = s.projectsDir;
  $('sEffort').value = s.effort;
  toggleProviderBoxes();
  $('settings').showModal();
}
$('sProvider').onchange = toggleProviderBoxes;

$('settingsForm').addEventListener('submit', async (e) => {
  if (e.submitter && e.submitter.value === 'save') {
    await window.forge.setSettings({
      provider: $('sProvider').value, localModel: $('sLocalModel').value, numCtx: Number($('sNumCtx').value),
      claudeModel: $('sClaudeModel').value, apiKey: $('sKey').value.trim(),
      enginePath: $('sEngine').value.trim(), projectsDir: $('sProjects').value.trim(), effort: $('sEffort').value,
    });
    refreshEngine();
    refreshAi();
    renderHistory(await window.forge.history());
  }
});
$('btnPull').onclick = () => { $('btnPull').disabled = true; window.forge.ollamaPull(); };
$('btnOllama').onclick = () => window.forge.openUrl('https://ollama.com/download');
$('btnMem').onclick = () => window.forge.memoryOpen();
$('pickEngine').onclick = async () => { const d = await window.forge.pickDir(); if (d) $('sEngine').value = d; };
$('pickProjects').onclick = async () => { const d = await window.forge.pickDir(); if (d) $('sProjects').value = d; };
$('btnSettings').onclick = openSettings;
$('btnNew').onclick = async () => { if (busy) return; await window.forge.newProject(); location.reload(); };
$('btnOpen').onclick = async () => { if (busy) return; const p = await window.forge.openProject(); if (p) { await refreshProject(); renderHistory(await window.forge.history()); } };
$('btnReveal').onclick = () => window.forge.revealProject();
$('btnStop').onclick = () => window.forge.stop();
$('btnLog').onclick = () => $('logbar').classList.toggle('open');
$('composer').addEventListener('submit', (e) => { e.preventDefault(); send($('input').value); });
$('input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send($('input').value); } });
document.querySelectorAll('.ex').forEach((b) => (b.onclick = () => send(b.textContent)));

(async () => {
  await refreshProject();
  refreshEngine();
  refreshAi();
  refreshMemory();
  const h = await window.forge.history();
  if (h.length) renderHistory(h);
})();
