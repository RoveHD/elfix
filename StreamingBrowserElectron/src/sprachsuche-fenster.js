"use strict";

// Die Sprachsuche am Desktop: ein unsichtbares Fenster mit eigener Sitzung.
//
// Das Hauptfenster bleibt, wie es ist - ohne Mikrofon, ohne WebAssembly, ohne
// Netz. Zuhoeren darf nur diese eine lokale Seite, und nur solange eine Suche
// per Knopf oder "Hey Elfix" laeuft. Ihr einziger Weg nach draussen ist das
// Sprachmodell, das hier unter einer festen Adresse aus den App-Daten kommt;
// jede andere Anfrage der Sitzung endet mit 404.
const fs = require("fs");
const path = require("path");
const { istLokaleSeite, lokaleNavigation, absichern } = require("./ipc-schutz");

const MODELL_URL = "https://sprachmodell.elfix.invalid/de.tar.gz";

function erstellen({ BrowserWindow, session, ipcMain, modell, melden = () => {} }) {
  const datei = path.join(__dirname, "..", "shared", "sprachsuche.html");
  let fenster = null;
  let bereit = null;
  let gewuenscht = "aus";
  const ipc = absichern(ipcMain, () => ({ inhalt: fenster?.webContents, datei }));

  function erlaubt(inhalt, permission, details, anfrage) {
    if (gewuenscht === "aus" || !fenster || fenster.isDestroyed() || inhalt !== fenster.webContents
      || !istLokaleSeite(inhalt.getURL(), datei) || permission !== "media" || details?.isMainFrame === false) return false;
    if (anfrage) {
      return istLokaleSeite(details?.requestingUrl, datei) && Array.isArray(details.mediaTypes)
        && details.mediaTypes.length === 1 && details.mediaTypes[0] === "audio";
    }
    const adresse = details?.requestingUrl || details?.securityOrigin;
    return (!adresse || adresse === "file://" || istLokaleSeite(adresse, datei)) && details?.mediaType === "audio";
  }

  ipc.handle("sprachsuche:modell-url", () => MODELL_URL);
  ipc.handle("sprachsuche:mikrofon", () => gewuenscht !== "aus");
  ipc.on("sprachsuche:melden", (_event, ereignis) => {
    if (!ereignis || typeof ereignis.typ !== "string") return;
    if (ereignis.typ === "bereit") { bereit?.fertig(); return; }
    const sauber = { typ: ereignis.typ };
    if (typeof ereignis.text === "string") sauber.text = ereignis.text.slice(0, 200);
    if (typeof ereignis.zustand === "string") sauber.zustand = ereignis.zustand;
    if (typeof ereignis.quelle === "string") sauber.quelle = ereignis.quelle;
    // Ein Modell, das sich nicht laden laesst, wird verworfen - samt der
    // entpackten Kopie in der Sitzung. Der naechste Versuch laedt es neu,
    // statt fuer immer an derselben kaputten Datei zu scheitern.
    if (ereignis.typ === "fehler" && ereignis.modell === true) {
      modellVerwerfen();
      melden(sauber);
      melden({ typ: "zustand", zustand: "aus" });
      return;
    }
    melden(sauber);
  });

  function modellVerwerfen() {
    try { fs.unlinkSync(modell.ziel); } catch { /* schon fort */ }
    const alt = fenster;
    fenster = null;
    gewuenscht = "aus";
    if (alt && !alt.isDestroyed()) {
      const sitzung = alt.webContents.session;
      alt.destroy();
      sitzung.clearStorageData({ storages: ["indexdb"] }).catch(() => {});
    }
  }

  function fensterBauen() {
    if (fenster && !fenster.isDestroyed()) return bereit.versprechen;
    const sitzung = session.fromPartition("persist:elfix-sprachsuche");
    sitzung.setPermissionCheckHandler((inhalt, permission, _origin, details) => erlaubt(inhalt, permission, details, false));
    sitzung.setPermissionRequestHandler((inhalt, permission, callback, details) => callback(erlaubt(inhalt, permission, details, true)));
    if (!sitzung.protocol.isProtocolHandled("https")) {
      sitzung.protocol.handle("https", (anfrage) => {
        if (anfrage.url !== MODELL_URL || !modell.vorhanden()) return new Response("", { status: 404 });
        return new Response(fs.readFileSync(modell.ziel), { headers: {
          "content-type": "application/gzip", "access-control-allow-origin": "*", "cache-control": "no-store"
        } });
      });
      sitzung.protocol.handle("http", () => new Response("", { status: 404 }));
    }
    let fertig;
    bereit = { versprechen: new Promise((ok) => { fertig = ok; }), fertig: () => fertig() };
    fenster = new BrowserWindow({
      show: false, width: 320, height: 200, skipTaskbar: true, focusable: false,
      title: "ELFIX · Sprachsuche",
      webPreferences: { preload: path.join(__dirname, "sprachsuche-preload.js"), session: sitzung,
        nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
    });
    lokaleNavigation(fenster.webContents, datei);
    fenster.webContents.on("will-attach-webview", (event) => event.preventDefault());
    fenster.webContents.on("render-process-gone", () => {
      const war = gewuenscht;
      fenster?.destroy();
      fenster = null;
      gewuenscht = "aus";
      melden({ typ: "zustand", zustand: "aus" });
      if (war === "weckwort") melden({ typ: "fehler", text: "Die Spracherkennung wurde beendet" });
    });
    fenster.on("closed", () => { fenster = null; gewuenscht = "aus"; });
    fenster.loadFile(datei).catch(() => fenster?.destroy());
    return bereit.versprechen;
  }

  function senden(befehl) {
    if (fenster && !fenster.isDestroyed() && !fenster.webContents.isDestroyed()) {
      fenster.webContents.send("sprachsuche:befehl", befehl);
    }
  }

  return {
    MODELL_URL,
    /** modus: "einmal" (Knopf) oder "weckwort" (Hey Elfix). */
    async starten(modus) {
      if (modus !== "einmal" && modus !== "weckwort") return false;
      if (!modell.vorhanden()) {
        melden({ typ: "zustand", zustand: "download" });
        let zuletzt = -1;
        try {
          await modell.bereitstellen((anteil) => {
            const prozent = Math.floor(anteil * 100);
            if (prozent !== zuletzt) { zuletzt = prozent; melden({ typ: "download", anteil: prozent }); }
          });
        } catch (fehler) {
          melden({ typ: "fehler", text: String(fehler?.message || fehler) });
          melden({ typ: "zustand", zustand: "aus" });
          return false;
        }
      }
      // Der Knopf unterbricht ein laufendes Weckwort nur fuer einen Satz.
      gewuenscht = modus === "einmal" && gewuenscht === "weckwort" ? "weckwort" : modus;
      await fensterBauen();
      senden({ typ: "start", modus });
      return true;
    },
    stoppen() {
      gewuenscht = "aus";
      senden({ typ: "stopp" });
    },
    schliessen() {
      gewuenscht = "aus";
      fenster?.destroy();
      fenster = null;
    },
    get fenster() { return fenster; }
  };
}

module.exports = { erstellen, MODELL_URL };
