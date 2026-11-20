const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('forge', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  engines: () => ipcRenderer.invoke('engines'),
  ollamaStatus: () => ipcRenderer.invoke('ollama:status'),
  ollamaPull: () => ipcRenderer.invoke('ollama:pull'),
  openUrl: (u) => ipcRenderer.invoke('open:url', u),
  memoryInfo: () => ipcRenderer.invoke('memory:info'),
  memoryOpen: () => ipcRenderer.invoke('memory:open'),
  pickDir: () => ipcRenderer.invoke('pick:dir'),
  openProject: () => ipcRenderer.invoke('project:open'),
  newProject: () => ipcRenderer.invoke('project:new'),
  currentProject: () => ipcRenderer.invoke('project:current'),
  revealProject: () => ipcRenderer.invoke('project:reveal'),
  history: () => ipcRenderer.invoke('history'),
  send: (text) => ipcRenderer.invoke('agent:send', text),
  stop: () => ipcRenderer.invoke('agent:stop'),
  build: () => ipcRenderer.invoke('project:build'),
  clearChat: () => ipcRenderer.invoke('chat:clear'),
  onAgent: (cb) => ipcRenderer.on('agent', (_e, msg) => cb(msg)),
});
