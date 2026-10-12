"use strict";

const { contextBridge, ipcRenderer } = require("electron");
// Die unsichtbare Erkennungsseite meldet nur Text und Zustand. Sie kann
// weder suchen noch Einstellungen lesen - das entscheidet der Hauptprozess.
contextBridge.exposeInMainWorld("ElfixSprachsucheHost", {
  modellUrl: () => ipcRenderer.invoke("sprachsuche:modell-url"),
  mikrofon: () => ipcRenderer.invoke("sprachsuche:mikrofon"),
  melden: (ereignis) => ipcRenderer.send("sprachsuche:melden", ereignis),
  onBefehl: (callback) => ipcRenderer.on("sprachsuche:befehl", (_event, befehl) => callback(befehl))
});
