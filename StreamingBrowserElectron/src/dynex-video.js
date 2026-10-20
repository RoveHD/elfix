"use strict";

// ELFIX kennt den Medientyp auch bei HTTPS. An DYNEX gehen ausschliesslich
// die tatsaechliche Server-IP, der Port und unsere Prozess-IDs: keine URLs,
// Titel, Cookies oder Inhalte. Ohne DYNEX bleibt die Wiedergabe unveraendert.
const net = require("node:net");
const { createHash } = require("node:crypto");

function pipeName(localAppData) {
  const normal = String(localAppData || "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  return normal ? "dynex-media-" + createHash("sha256").update(normal, "utf8").digest("hex").slice(0, 24) : "";
}

function header(details, name) {
  const values = Object.entries(details.responseHeaders || {})
    .filter(([key]) => key.toLowerCase() === name).flatMap(([, value]) => Array.isArray(value) ? value : [value]);
  return values.map(value => String(value).trim());
}

function medienAntwort(details) {
  if (!details || details.fromCache || details.statusCode < 200 || details.statusCode >= 300
    || !Number.isInteger(details.statusCode) || !net.isIP(details.ip || "")) return null;
  let url;
  try { url = new URL(details.url); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  if (header(details, "content-disposition").some(value => /^attachment(?:\s*;|\s*$)/i.test(value))) return null;
  const types = header(details, "content-type");
  if (types.length > 1) return null;
  const mime = (types[0] || "").split(";")[0].trim().toLowerCase();
  const explicit = mime.startsWith("video/") || ["application/vnd.apple.mpegurl", "application/x-mpegurl", "application/dash+xml"].includes(mime);
  // Chromium kann Medien auch mit generischem MIME korrekt erkennen. Ein
  // Dateiname oder die Endung allein ist dagegen kein Wiedergabenachweis.
  if (!explicit && !(details.resourceType === "media" && (!mime || mime === "application/octet-stream"))) return null;
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  return port > 0 && port <= 65535 ? { address: details.ip, port } : null;
}

function erstellen(optionen = {}) {
  const name = pipeName(optionen.localAppData ?? process.env.LOCALAPPDATA);
  const aktiv = (optionen.platform || process.platform) === "win32" && Boolean(name);
  const jetzt = optionen.jetzt || Date.now;
  const stellen = optionen.uhrStellen || setTimeout;
  const loeschen = optionen.uhrLoeschen || clearTimeout;
  const verbinden = optionen.verbinden || (adresse => net.createConnection(adresse));
  const prozesse = optionen.prozesse || (() => [process.pid]);
  const anfragen = new Map();
  const sitzungen = new WeakMap();
  let sitzungsId = 0, socket = null, verbunden = false, beendet = false;
  let uhr = null, uhrBei = Infinity, verbindungsUhr = null, letzterVersand = -Infinity, naechsterVersuch = 0;

  function sitzung(ses) {
    if (!sitzungen.has(ses)) sitzungen.set(ses, ++sitzungsId);
    return sitzungen.get(ses);
  }
  function schluessel(ses, details) { return sitzung(ses) + ":" + String(details.id); }
  function aufraeumen() {
    const zeit = jetzt();
    for (const [key, value] of anfragen) if (value.bis <= zeit) anfragen.delete(key);
  }
  function nachricht() {
    aufraeumen();
    const endpoints = new Map();
    for (const value of anfragen.values()) {
      const key = value.address + ":" + value.port;
      if (endpoints.size < 64 || endpoints.has(key)) endpoints.set(key, { address: value.address, port: value.port });
    }
    let ids = [];
    try { ids = [...new Set(prozesse())].filter(pid => Number.isSafeInteger(pid) && pid > 0).slice(0, 32); }
    catch { /* Eine fehlende Prozessliste deaktiviert nur diese Medienmeldung. */ }
    return { version: 1, processIds: ids, connections: ids.length ? [...endpoints.values()] : [] };
  }
  function planen(warten = 250) {
    if (beendet || !aktiv) return;
    const bei = jetzt() + warten;
    if (uhr && uhrBei <= bei) return;
    if (uhr) loeschen(uhr);
    uhrBei = bei;
    uhr = stellen(() => { uhr = null; uhrBei = Infinity; senden(); }, warten);
    uhr.unref?.();
  }
  function trennen(current) {
    if (socket !== current) return;
    socket = null; verbunden = false;
    if (verbindungsUhr) { loeschen(verbindungsUhr); verbindungsUhr = null; }
    naechsterVersuch = jetzt() + 10000;
    if (anfragen.size) planen(5000);
  }
  function senden() {
    if (!aktiv || beendet) return;
    const payload = nachricht();
    if (!socket) {
      if (!payload.connections.length) return;
      if (jetzt() < naechsterVersuch) { planen(Math.min(5000, naechsterVersuch - jetzt())); return; }
      let current;
      try { current = verbinden("\\\\.\\pipe\\" + name); } catch { naechsterVersuch = jetzt() + 10000; planen(5000); return; }
      socket = current;
      current.unref?.();
      current.on("error", () => { current.destroy(); trennen(current); });
      current.on("close", () => trennen(current));
      current.once("connect", () => {
        if (socket !== current || beendet) { current.destroy(); return; }
        verbunden = true;
        if (verbindungsUhr) { loeschen(verbindungsUhr); verbindungsUhr = null; }
        senden();
      });
      verbindungsUhr = stellen(() => { verbindungsUhr = null; current.destroy(); trennen(current); }, 1000);
      verbindungsUhr.unref?.();
      return;
    }
    if (!verbunden) return;
    const abstand = jetzt() - letzterVersand;
    if (abstand < 260) { planen(260 - abstand); return; }
    const line = JSON.stringify(payload) + "\n";
    if (Buffer.byteLength(line) > 16384 || socket.writableLength > 16384) { socket.destroy(); return; }
    try { socket.write(line); letzterVersand = jetzt(); }
    catch { socket.destroy(); return; }
    if (payload.connections.length) planen(5000);
  }
  function antwort(ses, details) {
    if (!aktiv || beendet || !Number.isSafeInteger(details?.id)) return;
    const key = schluessel(ses, details);
    const evidence = medienAntwort(details);
    const vorher = anfragen.delete(key);
    if (evidence && anfragen.size < 256) {
      anfragen.set(key, { ...evidence, url: details.url, sitzung: sitzung(ses), bis: jetzt() + 30 * 60 * 1000 });
      planen(Math.max(0, 260 - (jetzt() - letzterVersand)));
    } else if (vorher) planen();
  }
  function fertig(ses, details, fehler = false) {
    const key = schluessel(ses, details);
    const evidence = anfragen.get(key);
    if (!evidence) return;
    if (fehler) anfragen.delete(key);
    else evidence.bis = jetzt() + 15000;
    planen();
  }
  function download(ses, item) {
    const urls = new Set([item?.getURL?.(), ...(item?.getURLChain?.() || [])]);
    let geloescht = false;
    for (const [key, value] of anfragen) {
      if (value.sitzung === sitzung(ses) && urls.has(value.url)) { anfragen.delete(key); geloescht = true; }
    }
    if (geloescht) planen();
  }
  function beobachten(ses, { antwortSchonBelegt = false } = {}) {
    if (!aktiv || !ses?.webRequest || sitzungen.has(ses)) return;
    sitzung(ses);
    if (!antwortSchonBelegt) ses.webRequest.onResponseStarted(details => antwort(ses, details));
    ses.webRequest.onCompleted(details => fertig(ses, details));
    ses.webRequest.onErrorOccurred(details => fertig(ses, details, true));
    ses.on("will-download", (_event, item) => download(ses, item));
  }
  function schliessen() {
    beendet = true;
    if (uhr) loeschen(uhr);
    if (verbindungsUhr) loeschen(verbindungsUhr);
    anfragen.clear();
    if (socket) {
      try { socket.end(JSON.stringify({ version: 1, processIds: [], connections: [] }) + "\n"); }
      catch { socket.destroy(); }
    }
  }
  return { antwort, beobachten, download, schliessen };
}

module.exports = { erstellen, medienAntwort, pipeName };
