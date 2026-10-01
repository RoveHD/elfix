"use strict";

const path = require("path");
const { istLokaleSeite, lokaleNavigation, absichern } = require("./ipc-schutz");

// Eigene lokale Session: kein Anbieter und keine Playerseite erhaelt Zugriff
// aufs Mikrofon. Das Fenster bleibt beim Folgenwechsel/PiP derselbe Peer.
function erstellen({ BrowserWindow, session, ipcMain, watchparty, parent, duck = () => {}, preferences = () => ({ inputDeviceId: "" }), savePreferences = () => false }) {
  const datei = path.join(__dirname, "..", "shared", "sprachchat.html");
  let fenster = null;
  let raum = "";
  let mikrofonErlaubt = false;
  let mikrofonProbe = false;
  let joined = false;
  let settingsMode = false;
  const ipc = absichern(ipcMain, () => ({ inhalt: fenster?.webContents, datei }));
  const context = () => ({
    room: raum, name: watchparty.name || "Dieses Gerät", settings: settingsMode,
    connected: Boolean(raum && watchparty.status().rooms?.some((entry) => entry.room === raum && entry.connected))
  });
  function beenden() {
    mikrofonErlaubt = false;
    mikrofonProbe = false;
    if (raum) watchparty.voiceSenden(raum, { type: "voiceleave" });
    joined = false;
    duck(false);
  }
  function senden(channel, value) {
    if (fenster && !fenster.isDestroyed() && !fenster.webContents.isDestroyed()) fenster.webContents.send(channel, value);
  }
  function erlaubt(inhalt, permission, details, request) {
    if (!mikrofonErlaubt || (!(joined && context().connected) && !settingsMode && !mikrofonProbe) || !fenster || fenster.isDestroyed()
      || inhalt !== fenster.webContents || !istLokaleSeite(inhalt.getURL(), datei)) return false;
    if (permission !== "media" || details?.isMainFrame === false) return false;
    const adresse = details?.requestingUrl || details?.securityOrigin;
    // Chromium kann beim Check nur file:// als securityOrigin liefern. Der
    // Request braucht die konkrete vertrauenswuerdige Hauptseite.
    if (request) return istLokaleSeite(details?.requestingUrl, datei)
      && Array.isArray(details.mediaTypes) && details.mediaTypes.length === 1 && details.mediaTypes[0] === "audio";
    return (!adresse || adresse === "file://" || istLokaleSeite(adresse, datei)) && details?.mediaType === "audio";
  }
  ipc.handle("voice:context", () => context());
  ipc.handle("voice:preferences", () => preferences());
  ipc.handle("voice:preferences-save", (_event, value) => {
    if (!value || typeof value.inputDeviceId !== "string" || value.inputDeviceId.length > 512) return false;
    return savePreferences({ inputDeviceId: value.inputDeviceId });
  });
  ipc.handle("voice:send", (_event, message) => {
    if (!message || typeof message !== "object" || !["voicejoin", "voiceleave", "voicestate", "voicesignal"].includes(message.type)) return false;
    if (message.type === "voiceleave") { beenden(); return true; }
    if (!context().connected) return false;
    return watchparty.voiceSenden(raum, message);
  });
  ipc.handle("voice:microphone", (_event, probe) => {
    mikrofonProbe = probe === true;
    mikrofonErlaubt = (joined && context().connected) || settingsMode || mikrofonProbe;
    return mikrofonErlaubt;
  });
  ipc.on("voice:capture", (_event, active) => { if (!active) { mikrofonErlaubt = false; mikrofonProbe = false; } });
  ipc.on("voice:duck", (_event, active) => duck(joined && active === true));
  ipc.on("voice:hide", () => fenster?.minimize());
  ipc.on("voice:close", () => fenster?.close());
  return {
    oeffnen(room, settingsOnly = false) {
      const ziel = watchparty.status().rooms?.find((entry) => entry.room === room);
      if (!ziel && !settingsOnly) return { ok: false, error: "Richte zuerst einen Watchparty-Raum ein." };
      settingsMode = settingsOnly;
      if (fenster && !fenster.isDestroyed()) {
        if (!settingsOnly && raum !== room) { beenden(); raum = room; }
        senden("voice:context", context());
        fenster.restore(); fenster.show(); fenster.focus();
        return { ok: true };
      }
      raum = ziel ? room : "";
      // Persistenz behaelt auch die Salt fuer ausgewaehlte MediaDevice-IDs.
      const sitzung = session.fromPartition("persist:elfix-sprachchat");
      sitzung.setPermissionCheckHandler((inhalt, permission, _origin, details) => erlaubt(inhalt, permission, details, false));
      sitzung.setPermissionRequestHandler((inhalt, permission, callback, details) => callback(erlaubt(inhalt, permission, details, true)));
      fenster = new BrowserWindow({
        width: 440, height: 650, minWidth: 360, minHeight: 470,
        title: "ELFIX · Sprachchat", backgroundColor: "#0b0e16", autoHideMenuBar: true,
        parent: parent(), show: false,
        webPreferences: { preload: path.join(__dirname, "sprachchat-preload.js"), session: sitzung,
          nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
      });
      lokaleNavigation(fenster.webContents, datei);
      fenster.webContents.on("will-attach-webview", (event) => event.preventDefault());
      fenster.webContents.on("render-process-gone", beenden);
      fenster.once("ready-to-show", () => { fenster?.show(); });
      fenster.on("closed", () => { beenden(); fenster = null; raum = ""; });
      fenster.loadFile(datei).catch(() => fenster?.close());
      return { ok: true };
    },
    nachricht(message) {
      if (!message || message.room !== raum || !fenster) return;
      if (message.type === "voicewelcome") joined = true;
      if (message.type === "voiceleft" || (message.type === "voiceerror" && message.code !== "peer-missing")) { joined = false; mikrofonErlaubt = false; duck(false); }
      senden("voice:message", message);
    },
    aktualisieren() {
      if (!fenster) return;
      if (raum && !context().connected && joined) beenden();
      senden("voice:context", context());
    },
    schliessen() { beenden(); fenster?.destroy(); },
    // Fuer Integrationstests: keine Sessiondaten, nur der lokale UI-Absender.
    get fenster() { return fenster; }
  };
}

module.exports = { erstellen };
