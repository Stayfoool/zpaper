const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zpaper", {
  getSettings: () => ipcRenderer.invoke("zpaper:settings:get"),
  setSettings: (settings) => ipcRenderer.invoke("zpaper:settings:set", settings),
  openFile: () => ipcRenderer.invoke("zpaper:file:open"),
  saveFile: (payload) => ipcRenderer.invoke("zpaper:file:save", payload),
  platform: process.platform,
});
