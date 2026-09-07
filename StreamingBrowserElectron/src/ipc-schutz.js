"use strict";

const { fileURLToPath, pathToFileURL } = require("node:url");

function istLokaleSeite(adresse, datei) {
  try {
    const url = new URL(adresse);
    if (url.protocol !== "file:") return false;
    url.search = "";
    url.hash = "";
    // Chromium serializes a tilde in a Windows 8.3 path literally, whereas
    // pathToFileURL encodes it as %7E. Compare decoded OS paths so only those
    // two URL spellings converge. Errors, non-file URLs and encoded path
    // separators fail closed in fileURLToPath.
    return fileURLToPath(url) === fileURLToPath(pathToFileURL(datei));
  } catch { return false; }
}

/** Nur die Hauptframes unserer beiden lokalen Oberflaechen erhalten IPC-Rechte. */
function absichern(original, zielFuerKanal) {
  function erlaubt(ereignis, kanal) {
    const ziel = zielFuerKanal(kanal);
    if (!ziel?.inhalt || ziel.inhalt.isDestroyed()) return false;
    return ereignis?.sender === ziel.inhalt
      && ereignis.senderFrame === ziel.inhalt.mainFrame
      && istLokaleSeite(ereignis.senderFrame?.url, ziel.datei);
  }
  return {
    handle(kanal, handler) {
      original.handle(kanal, (ereignis, ...argumente) => {
        if (!erlaubt(ereignis, kanal)) throw new Error("IPC-Absender nicht erlaubt");
        return handler(ereignis, ...argumente);
      });
    },
    on(kanal, handler) {
      original.on(kanal, (ereignis, ...argumente) => {
        if (erlaubt(ereignis, kanal)) handler(ereignis, ...argumente);
      });
    }
  };
}

function lokaleNavigation(inhalt, datei, externOeffnen) {
  const pruefen = (ereignis, adresse) => {
    if (!istLokaleSeite(adresse, datei)) ereignis.preventDefault();
  };
  inhalt.on("will-navigate", pruefen);
  inhalt.on("will-redirect", pruefen);
  inhalt.setWindowOpenHandler(({ url }) => {
    if (externOeffnen) {
      try {
        const ziel = new URL(url);
        if (ziel.protocol === "https:" && ziel.hostname === "github.com"
          && /^\/RoveHD\/elfix(?:\/|$)/i.test(ziel.pathname)) {
          Promise.resolve(externOeffnen(ziel.href)).catch(() => {});
        }
      } catch { /* Unbekannte Protokolle verlassen die App nicht. */ }
    }
    return { action: "deny" };
  });
}

module.exports = { absichern, istLokaleSeite, lokaleNavigation };
