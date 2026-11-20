const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('forge', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  engines: () => ipcRenderer.invoke('engines'),
  pickDir: () => ipcRenderer.invoke('pick:dir'),
  openProject: () => ipcRenderer.invoke('project:open'),
  newProject: () => ipcRenderer.invoke('project:new'),
  currentProject: () => ipcRenderer.invoke('project:current'),
  revealProject: () => ipcRenderer.invoke('project:reveal'),
  history: () => ipcRenderer.invoke('history'),
  send: (text) => ipcRenderer.invoke('agent:send', text),
  stop: () => ipcRenderer.invoke('agent:stop'),
  onAgent: (cb) => ipcRenderer.on('agent', (_e, msg) => cb(msg)),
});
