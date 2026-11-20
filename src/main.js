// Electron-Hauptprozess: Fenster, Einstellungen, Gedächtnis und die Wahl der KI (lokal gratis oder Claude).
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Agent } = require('./agent');
const { LocalAgent } = require('./localAgent');
const { ToolContext } = require('./tools');
const { Memory } = require('./memory');
const unreal = require('./unreal');

let win;
let agent = null;
let projectRoot = null;
let memory = null;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { /* erste Nutzung */ }
  let apiKey = '';
  if (s.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try { apiKey = safeStorage.decryptString(Buffer.from(s.apiKeyEnc, 'base64')); } catch { /* ungültig */ }
  }
  return {
    provider: s.provider || 'local',
    ollamaUrl: s.ollamaUrl || 'http://127.0.0.1:11434',
    localModel: s.localModel || 'qwen3:8b',
    numCtx: s.numCtx || 12288,
    claudeModel: s.claudeModel || 'claude-fable-5-2',
    apiKey: apiKey || process.env.ANTHROPIC_API_KEY || '',
    enginePath: s.enginePath || '',
    projectsDir: s.projectsDir || path.join(os.homedir(), 'UnrealForge Projects'),
    effort: s.effort || 'high',
    lastProject: s.lastProject === undefined ? null : s.lastProject,
  };
}

function saveSettings(next) {
  const merged = { ...loadSettings(), ...next };
  const { apiKey, ...out } = merged;
  if (apiKey && safeStorage.isEncryptionAvailable()) out.apiKeyEnc = safeStorage.encryptString(apiKey).toString('base64');
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(out, null, 2));
}

const emit = (event, payload) => win && !win.isDestroyed() && win.webContents.send('agent', { event, payload });

function setProject(root) {
  projectRoot = root;
  saveSettings({ lastProject: root });
  if (agent) agent.loadHistory();
}

function getAgent() {
  if (agent) return agent;
  const s = loadSettings();
  const toolCtx = new ToolContext({
    getSettings: loadSettings,
    getProjectRoot: () => projectRoot,
    setProjectRoot: (r) => { projectRoot = r; saveSettings({ lastProject: r }); },
    onLog: (t) => emit('log', t),
    memory,
    askApproval: async (msg) => {
      const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Erlauben', 'Ablehnen'], defaultId: 0, cancelId: 1, message: msg });
      return r.response === 0;
    },
  });
  if (s.provider === 'claude') {
    if (!s.apiKey) throw new Error('Für Claude wird ein API-Schlüssel benötigt (Einstellungen). Oder stell auf die kostenlose lokale KI um.');
    agent = new Agent({ apiKey: s.apiKey, model: s.claudeModel, effort: s.effort, toolCtx, memory, emit });
  } else {
    agent = new LocalAgent({ baseUrl: s.ollamaUrl, model: s.localModel, numCtx: s.numCtx, toolCtx, memory, emit });
  }
  agent.loadHistory();
  return agent;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#0b0d12',
    title: 'Unreal Forge',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('settings:get', () => {
  const s = loadSettings();
  return { ...s, apiKey: s.apiKey ? '••••' + s.apiKey.slice(-4) : '', hasKey: !!s.apiKey };
});
ipcMain.handle('settings:set', (_e, next) => {
  if (next.apiKey === '' || (next.apiKey && next.apiKey.startsWith('••••'))) delete next.apiKey;
  saveSettings(next);
  if (agent) agent.abort();
  agent = null; // mit neuen Einstellungen neu erzeugen
  return true;
});
ipcMain.handle('engines', () => unreal.findEngines(loadSettings().enginePath));
ipcMain.handle('ollama:status', () => {
  const s = loadSettings();
  return LocalAgent.status(s.ollamaUrl, s.localModel).then((r) => ({ ...r, model: s.localModel, provider: s.provider }));
});
ipcMain.handle('ollama:pull', async () => {
  const s = loadSettings();
  try {
    await LocalAgent.pull(s.ollamaUrl, s.localModel, (p) => emit('pull', p));
    emit('pull', { status: 'fertig' });
    return true;
  } catch (e) {
    emit('pull', { status: 'Fehler: ' + e.message });
    return false;
  }
});
ipcMain.handle('open:url', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('memory:info', () => ({ count: memory.items.length, file: memory.file }));
ipcMain.handle('memory:open', () => { memory.save(); shell.showItemInFolder(memory.file); });
ipcMain.handle('pick:dir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('project:open', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Unreal-Projektordner wählen' });
  if (r.canceled) return null;
  setProject(r.filePaths[0]);
  return projectRoot;
});
ipcMain.handle('project:new', () => { projectRoot = null; saveSettings({ lastProject: null }); if (agent) agent.messages = []; return true; });
ipcMain.handle('project:current', () => projectRoot);
ipcMain.handle('project:reveal', () => projectRoot && shell.openPath(projectRoot));
ipcMain.handle('history', () => {
  try { return getAgent().displayHistory(); } catch { return []; }
});
ipcMain.handle('agent:send', async (_e, text) => {
  try {
    await getAgent().send(text);
  } catch (e) {
    const status = e && e.status ? ` (HTTP ${e.status})` : '';
    emit('error', (e && e.message ? e.message : String(e)) + status);
    emit('done', null);
  }
});
ipcMain.handle('agent:stop', () => agent && agent.abort());
// Direkt kompilieren – ohne KI, damit das echte Ergebnis sichtbar ist.
ipcMain.handle('project:build', async () => {
  try {
    const a = getAgent();
    emit('tool', { name: 'build_project', input: {} });
    const out = String(await a.toolCtx.run('build_project', {}));
    const ok = /BUILD ERFOLGREICH/.test(out);
    emit('tool_result', { name: 'build_project', ok, text: out.split('\n').slice(-25).join('\n') });
    const sdk = /LÖSUNG \(an den Nutzer/.test(out);
    emit('status', ok ? '✅ Build erfolgreich!'
      : sdk ? '❌ Visual Studio / Windows SDK fehlt: Visual Studio Installer öffnen → „Spieleentwicklung mit C++“ + „Desktopentwicklung mit C++“ + Windows 11 SDK anhaken → installieren → PC neu starten → nochmal 🔨 Kompilieren.'
      : '❌ Build fehlgeschlagen – Details im Kasten oben und im Build-Log. Schick ein Foto davon, falls du nicht weiterkommst.');
  } catch (e) {
    emit('error', e.message);
  }
  emit('memory', null);
  emit('done', null);
});
// Gesprächsverlauf des aktiven Projekts leeren (Dateien bleiben).
ipcMain.handle('chat:clear', () => {
  try {
    const a = getAgent();
    a.messages = [];
    a.saveHistory();
  } catch { /* kein Agent */ }
  return true;
});

app.whenReady().then(() => {
  memory = new Memory(path.join(app.getPath('userData'), 'memory.json'));
  const s = loadSettings();
  if (s.lastProject && fs.existsSync(s.lastProject)) projectRoot = s.lastProject;
  createWindow();
});
app.on('window-all-closed', () => app.quit());
