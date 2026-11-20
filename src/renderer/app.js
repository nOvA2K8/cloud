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

function renderHistory(messages) {
  chat.innerHTML = '';
  for (const m of messages) {
    if (m.role === 'user' && typeof m.content === 'string') el('msg user', m.content);
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b.type === 'text' && b.text.trim()) el('msg assistant', b.text);
        if (b.type === 'tool_use') { const t = el('tool'); t.innerHTML = `<span class="name"></span>`; t.firstChild.textContent = '⚒ ' + b.name; }
      }
    }
  }
}

async function send(text) {
  if (busy || !text.trim()) return;
  const s = await window.forge.getSettings();
  if (!s.hasKey) { openSettings(); return; }
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
    case 'done': setBusy(false); refreshProject(); break;
  }
});

async function openSettings() {
  const s = await window.forge.getSettings();
  $('sKey').value = s.apiKey;
  $('sEngine').value = s.enginePath;
  $('sProjects').value = s.projectsDir;
  $('sEffort').value = s.effort;
  $('settings').showModal();
}

$('settingsForm').addEventListener('submit', async (e) => {
  if (e.submitter && e.submitter.value === 'save') {
    await window.forge.setSettings({
      apiKey: $('sKey').value.trim(), enginePath: $('sEngine').value.trim(),
      projectsDir: $('sProjects').value.trim(), effort: $('sEffort').value,
    });
    refreshEngine();
  }
});
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
  const h = await window.forge.history();
  if (h.length) renderHistory(h);
  const s = await window.forge.getSettings();
  if (!s.hasKey) openSettings();
})();
