"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("ElfixVoiceHost", {
  context: () => ipcRenderer.invoke("voice-test:context"),
  send: (message) => ipcRenderer.invoke("voice-test:send", message),
  microphone: () => ipcRenderer.invoke("voice-test:microphone"),
  close: () => ipcRenderer.send("voice-test:close"),
  duck() {},
  onMessage: (callback) => ipcRenderer.on("voice-test:message", (_event, message) => callback(message)),
  onContext: (callback) => ipcRenderer.on("voice-test:context", (_event, context) => callback(context))
});
