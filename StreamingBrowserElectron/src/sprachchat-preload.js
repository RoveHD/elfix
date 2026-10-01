"use strict";

const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("ElfixVoiceHost", {
  context: () => ipcRenderer.invoke("voice:context"),
  preferences: () => ipcRenderer.invoke("voice:preferences"),
  savePreferences: (value) => ipcRenderer.invoke("voice:preferences-save", value),
  send: (message) => ipcRenderer.invoke("voice:send", message),
  microphone: (probe = false) => ipcRenderer.invoke("voice:microphone", probe === true),
  capture: (active) => ipcRenderer.send("voice:capture", active === true),
  close: () => ipcRenderer.send("voice:close"),
  hide: () => ipcRenderer.send("voice:hide"),
  duck: (active) => ipcRenderer.send("voice:duck", active === true),
  onMessage: (callback) => ipcRenderer.on("voice:message", (_event, message) => callback(message)),
  onContext: (callback) => ipcRenderer.on("voice:context", (_event, context) => callback(context))
});
