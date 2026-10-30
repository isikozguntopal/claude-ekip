'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('ekip', {
  init: () => ipcRenderer.invoke('app:init'),
  pickWorkspace: () => ipcRenderer.invoke('ws:pick'),
  selectWorkspace: (ws) => ipcRenderer.invoke('ws:select', ws),
  teamStatus: () => ipcRenderer.invoke('team:status'),
  install: (memberId) => ipcRenderer.invoke('team:install', memberId),
  send: (text) => ipcRenderer.invoke('agent:send', { text }),
  setModel: (model) => ipcRenderer.invoke('agent:model', model),
  usage: () => ipcRenderer.invoke('usage:get'),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  interrupt: () => ipcRenderer.invoke('agent:interrupt'),
  reset: () => ipcRenderer.invoke('agent:reset'),
  setMode: (mode) => ipcRenderer.invoke('agent:mode', mode),
  replyPermission: (reply) => ipcRenderer.send('agent:permission-reply', reply),
  pickClaude: () => ipcRenderer.invoke('app:pick-claude'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  openPath: (p) => ipcRenderer.invoke('app:open-path', p),
  showImage: (p) => ipcRenderer.invoke('img:show', p),
  onPreviewImage: on('preview:image'),
  onPreviewFocus: on('preview:focus'),
  openFolder: () => ipcRenderer.invoke('app:open-folder'),
  setIcon: (dataUrl) => ipcRenderer.send('app:set-icon', dataUrl),
  summarizeTask: (text) => ipcRenderer.invoke('task:summarize', text),
  chatHistory: () => ipcRenderer.invoke('chat:history'),
  onPreviewOpen: on('preview:open'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  importShots: (paths) => ipcRenderer.invoke('shot:import', paths),
  cmdList: () => ipcRenderer.invoke('cmd:list'),
  cmdSave: (list) => ipcRenderer.invoke('cmd:save', list),
  cmdRun: (cmd) => ipcRenderer.invoke('cmd:run', cmd),
  simList: () => ipcRenderer.invoke('sim:list'),
  simBoot: (udid) => ipcRenderer.invoke('sim:boot', udid),
  simShot: (udid) => ipcRenderer.invoke('sim:shot', udid),
  onEvent: on('agent:event'),
  onState: on('agent:state'),
  onError: on('agent:error'),
  onStderr: on('agent:stderr'),
  onPermission: on('agent:permission'),
  onPermissionCancel: on('agent:permission-cancel')
});
