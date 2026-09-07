"use strict";

const { Readable } = require("node:stream");

function httpAdresse(wert) {
  try {
    const url = new URL(wert);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

/** CORS nur fuer die lokale Playerseite, ohne die Browser-Sicherheitsgrenzen abzuschalten. */
function medienHandler(laden) {
  return async request => {
    const origin = request.headers.get("origin");
    if (!httpAdresse(request.url) || (origin && origin !== "null")
      || !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      return new Response(null, { status: 403 });
    }
    const cors = {
      "Access-Control-Allow-Origin": "null",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Type",
      "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      const response = await laden(request);
      const headers = new Headers(response.headers);
      const location = headers.get("location");
      if (location && !httpAdresse(new URL(location, request.url).href)) return new Response(null, { status: 403 });
      for (const [name, value] of Object.entries(cors)) headers.set(name, value);
      // Electron liefert bereits dekomprimierte Daten. Chromium darf sie nicht erneut entpacken.
      if (headers.has("content-encoding")) {
        if (response.status === 206 && headers.get("content-encoding") !== "identity") {
          response.body?.cancel().catch(() => {});
          return new Response(null, { status: 502, headers: cors });
        }
        headers.delete("content-encoding");
        headers.delete("content-length");
      }
      const body = request.method === "HEAD" || [204, 205, 304].includes(response.status) ? null : response.body;
      return new Response(body, { status: response.status, statusText: response.statusText, headers });
    } catch {
      return new Response(null, { status: 502, headers: cors });
    }
  };
}

function medienAbruf(request, sitzung) {
  const { net } = require("electron");
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(request.headers);
    if (request.headers.has("range")) headers["accept-encoding"] = "identity";
    const abruf = net.request({ url: request.url, method: request.method, headers,
      session: sitzung, useSessionCookies: true, bypassCustomProtocolHandlers: true, redirect: "manual" });
    const abbrechen = () => {
      reject(new Error("Medienabruf abgebrochen"));
      abruf.abort();
    };
    const aufraeumen = () => request.signal.removeEventListener("abort", abbrechen);
    request.signal.addEventListener("abort", abbrechen, { once: true });
    abruf.on("abort", () => {
      aufraeumen();
      reject(new Error("Medienabruf abgebrochen"));
    });
    abruf.on("error", error => { aufraeumen(); reject(error); });
    // Electron 44 kann den schreibenden Request vor der Antwort schliessen.
    // Erst das Ende der Antwort beendet daher die Signalbindung.
    // net.fetch wirft bei redirect:'manual'. Das Request-Ereignis laesst uns
    // den Hop hingegen als echte 3xx-Antwort an Chromium weitergeben.
    abruf.on("redirect", (status, _methode, ziel) => {
      try { resolve(new Response(null, { status, headers: { Location: ziel } })); }
      catch (error) { reject(error); }
      abruf.abort();
    });
    abruf.on("response", response => {
      response.once("end", aufraeumen);
      response.once("error", aufraeumen);
      response.once("aborted", aufraeumen);
      try {
        const responseHeaders = new Headers();
        for (const [key, values] of Object.entries(response.headers)) {
          for (const value of Array.isArray(values) ? values : [values]) responseHeaders.append(key, String(value));
        }
        const body = request.method === "HEAD" || [204, 205, 304].includes(response.statusCode)
          ? null : Readable.toWeb(response);
        resolve(new Response(body, { status: response.statusCode, headers: responseHeaders }));
      } catch (error) {
        reject(error);
        abruf.abort();
      }
    });
    if (request.signal.aborted) abbrechen();
    else abruf.end();
  });
}

function einrichten(sitzung) {
  const handler = medienHandler(request => medienAbruf(request, sitzung));
  sitzung.protocol.handle("https", handler);
  sitzung.protocol.handle("http", handler);
  sitzung.setPermissionRequestHandler((_inhalt, _recht, antwort) => antwort(false));
  sitzung.setPermissionCheckHandler(() => false);
}

module.exports = { medienHandler, medienAbruf, einrichten };
