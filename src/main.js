// Electron-Hauptprozess: Fenster, Einstellungen (API-Schlüssel verschlüsselt), Agent.
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Agent } = require('./agent');
const { ToolContext } = require('./tools');
const unreal = require('./unreal');

let win;
let agent = null;
let projectRoot = null;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { /* erste Nutzung */ }
  let apiKey = '';
  if (s.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try { apiKey = safeStorage.decryptString(Buffer.from(s.apiKeyEnc, 'base64')); } catch { /* ungültig */ }
  }
  return {
    apiKey: apiKey || process.env.ANTHROPIC_API_KEY || '',
    enginePath: s.enginePath || '',
    projectsDir: s.projectsDir || path.join(os.homedir(), 'UnrealForge Projects'),
    effort: s.effort || 'high',
    lastProject: s.lastProject || null,
  };
}

function saveSettings(next) {
  const cur = loadSettings();
  const merged = { ...cur, ...next };
  const out = { enginePath: merged.enginePath, projectsDir: merged.projectsDir, effort: merged.effort, lastProject: merged.lastProject };
  if (merged.apiKey && safeStorage.isEncryptionAvailable()) {
    out.apiKeyEnc = safeStorage.encryptString(merged.apiKey).toString('base64');
  }
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(out, null, 2));
  agent = null; // mit neuen Einstellungen neu erzeugen
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
  if (!s.apiKey) throw new Error('Bitte zuerst den Anthropic-API-Schlüssel in den Einstellungen eintragen.');
  const toolCtx = new ToolContext({
    getSettings: loadSettings,
    getProjectRoot: () => projectRoot,
    setProjectRoot: (r) => { projectRoot = r; saveSettings({ lastProject: r }); },
    onLog: (s) => emit('log', s),
    askApproval: async (msg) => {
      const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Erlauben', 'Ablehnen'], defaultId: 0, cancelId: 1, message: msg });
      return r.response === 0;
    },
  });
  agent = new Agent({ apiKey: s.apiKey, effort: s.effort, toolCtx, emit });
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
  if (next.apiKey && next.apiKey.startsWith('••••')) delete next.apiKey;
  saveSettings(next);
  return true;
});
ipcMain.handle('engines', () => unreal.findEngines(loadSettings().enginePath));
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
  try { return getAgent().messages; } catch { return []; }
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

app.whenReady().then(() => {
  const s = loadSettings();
  if (s.lastProject && fs.existsSync(s.lastProject)) projectRoot = s.lastProject;
  createWindow();
});
app.on('window-all-closed', () => app.quit());
