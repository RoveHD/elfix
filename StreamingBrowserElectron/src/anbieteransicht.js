"use strict";

// Eine echte, isolierte Browserseite. Sie besitzt weder den Player noch dessen
// Navigation; nur die Cookie-Sitzung wird mit der Anbieter-Werkbank geteilt.
function erstellen({ BrowserWindow, WebContentsView, eltern, sitzung, zustandScript, persistieren, verbinden = () => {} }) {
  let offen = null;
  const istHttp = url => /^https?:$/.test((() => { try { return new URL(url).protocol; } catch { return ""; } })());
  function oeffnen(provider, url, { signal, pruefen, erlaubt = istHttp } = {}) {
    if (signal?.aborted) return Promise.resolve("geschlossen");
    if (offen && !offen.fenster.isDestroyed()) {
      if (offen.providerId === provider.id && offen.url === url) {
        offen.fenster.show();
        offen.fenster.focus();
        return offen.fertig;
      }
      offen.schliessen();
    }
    const parent = eltern();
    if (!parent || parent.isDestroyed() || !sitzung() || !istHttp(url)) return Promise.resolve("fehlgeschlagen");
    let fenster;
    try {
      const [breite, hoehe] = parent.getContentSize();
      fenster = new BrowserWindow({ parent, modal: true, show: false,
        width: Math.max(640, breite), height: Math.max(480, hoehe),
        title: `${provider.name || "Anbieter"} · Cloudflare bestätigen`, autoHideMenuBar: true,
        webPreferences: { sandbox: true, contextIsolation: true,
          nodeIntegration: false, webviewTag: false, webSecurity: true, backgroundThrottling: false }
      });
    } catch { return Promise.resolve("fehlgeschlagen"); }
    // Lokale Fensteroberflaeche und fremde Anbieter-DOMs teilen weder einen
    // Renderer noch einen Preload. Die Rueckkehrleiste ueberlebt Navigationen.
    const view = new WebContentsView({ webPreferences: { session: sitzung(),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      webviewTag: false, webSecurity: true, backgroundThrottling: false } });
    const inhalt = view.webContents;
    fenster.contentView.addChildView(view);
    const anordnen = () => {
      const [width, height] = fenster.getContentSize();
      view.setBounds({ x: 0, y: 52, width, height: Math.max(1, height - 52) });
    };
    anordnen();
    fenster.on("resize", anordnen);
    const lokaleDatei = require("node:path").join(__dirname, "anbieteransicht-leiste.html");
    fenster.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    fenster.webContents.on("will-navigate", event => event.preventDefault());
    fenster.on("page-title-updated", event => event.preventDefault());
    verbinden(inhalt, provider);
    inhalt.setAudioMuted(true);
    inhalt.setWindowOpenHandler(() => ({ action: "deny" }));
    inhalt.on("will-prevent-unload", event => event.preventDefault());
    // Der Hauptprozess entscheidet weiterhin ueber Pause-bei-Fokusverlust,
    // auch wenn der Fokus zuvor im modalen Kindfenster lag.
    fenster.on("blur", () => { if (!parent.isDestroyed()) parent.emit("blur"); });
    let ergebnis = "geschlossen";
    let gesehen = false;
    let generation = 0;
    let bereit = false;
    let probeGeneration = -1;
    let beschaeftigt = false;
    const abbruch = new AbortController();
    let aufloesen;
    const fertig = new Promise(resolve => { aufloesen = resolve; });
    const eintrag = { fenster, providerId: provider.id, url, fertig,
      schliessen() { if (!fenster.isDestroyed()) fenster.close(); } };
    offen = eintrag;
    const schliessen = () => eintrag.schliessen();
    signal?.addEventListener("abort", schliessen, { once: true });
    const gueltig = () => offen === eintrag && !fenster.isDestroyed() && !abbruch.signal.aborted && !signal?.aborted;
    const pruefe = async () => {
      if (!gueltig() || !bereit || beschaeftigt) return;
      beschaeftigt = true;
      const stand = generation;
      try {
        const lage = await inhalt.executeJavaScript(zustandScript());
        if (!gueltig() || stand !== generation || !bereit) return;
        if (lage?.offen) { gesehen = true; probeGeneration = -1; return; }
        // Auch ein verschwundenes Widget oder ein Cookie allein beweist die
        // Freigabe nicht. Nur der geschuetzte Originalabruf ist der Beleg.
        if (!gesehen || !lage || probeGeneration === stand || typeof pruefen !== "function") return;
        probeGeneration = stand;
        if (!await pruefen(url, abbruch.signal) || !gueltig() || generation !== stand) return;
        await persistieren(sitzung());
        if (!gueltig() || generation !== stand) return;
        ergebnis = "bestaetigt";
        schliessen();
      } catch { /* Eine laufende Navigation kann die DOM-Probe ersetzen. */ }
      finally { beschaeftigt = false; }
    };
    inhalt.on("will-navigate", (event, ziel) => { if (!istHttp(ziel) || !erlaubt(ziel)) event.preventDefault(); });
    inhalt.on("will-redirect", (event, ziel) => { if (!istHttp(ziel) || !erlaubt(ziel)) event.preventDefault(); });
    const taste = (event, input) => {
      if (input.type === "keyDown" && input.key === "Escape") { event.preventDefault(); schliessen(); }
    };
    inhalt.on("before-input-event", taste);
    fenster.webContents.on("before-input-event", taste);
    inhalt.on("did-start-navigation", (_event, _url, inPlace, hauptrahmen) => {
      if (hauptrahmen && !inPlace) { generation++; bereit = false; }
    });
    inhalt.on("dom-ready", () => { bereit = true; void pruefe(); });
    inhalt.on("did-fail-load", (_event, code, _text, _url, hauptrahmen) => {
      if (hauptrahmen && code !== -3 && gueltig()) { ergebnis = "fehlgeschlagen"; schliessen(); }
    });
    inhalt.on("render-process-gone", () => { ergebnis = "fehlgeschlagen"; schliessen(); });
    const beobachter = setInterval(pruefe, 400);
    beobachter.unref?.();
    fenster.on("closed", () => {
      clearInterval(beobachter);
      abbruch.abort();
      signal?.removeEventListener("abort", schliessen);
      if (offen === eintrag) offen = null;
      // flushStore sichert auch Cookies einer noch nicht abgeschlossenen
      // Abfrage. Das Schliessen selbst bleibt ausdruecklich kein Erfolgsbeleg.
      Promise.resolve().then(() => persistieren(sitzung())).catch(() => {}).then(() => aufloesen(ergebnis));
      if (!inhalt.isDestroyed()) inhalt.close();
      if (parent && !parent.isDestroyed()) parent.focus();
    });
    if (parent.isMinimized()) parent.restore();
    if (!parent.isVisible()) parent.show();
    fenster.show();
    fenster.focus();
    fenster.webContents.loadFile(lokaleDatei).catch(() => {
      if (gueltig()) { ergebnis = "fehlgeschlagen"; schliessen(); }
    });
    inhalt.loadURL(url).catch(error => {
      if (error?.code !== "ERR_ABORTED" && gueltig() && !bereit) { ergebnis = "fehlgeschlagen"; schliessen(); }
    });
    return fertig;
  }
  return { oeffnen, get offen() { return Boolean(offen && !offen.fenster.isDestroyed()); },
    get fokussiert() { return Boolean(offen && !offen.fenster.isDestroyed() && offen.fenster.isFocused()); },
    schliessen() { offen?.schliessen(); } };
}

// Genau eine Frist pro angeforderter Folge, auch beim Uebergang vom ersten
// Kachellesen zum Quellenaufloeser. Fertige Quellen und Abbruch loeschen sie.
function fallbackErstellen({ setzen = setTimeout, loeschen = clearTimeout, oeffnen,
  fehler = error => console.error("[ELFIX ANBIETER] Fortsetzung fehlgeschlagen", error) }) {
  let aktuell = null;
  function beenden(versuch) {
    if (!versuch) return;
    loeschen(versuch.timer);
    versuch.fensterAbbruch.abort();
    versuch.signal.removeEventListener("abort", versuch.abbrechen);
    if (aktuell === versuch) aktuell = null;
  }
  function starten({ provider, url, signal, gueltig = () => true, fortsetzen, unterdrueckt = false }) {
    if (aktuell?.provider.id === provider.id && aktuell.url === url && aktuell.signal === signal) return aktuell;
    beenden(aktuell);
    if (signal.aborted) return null;
    const versuch = { provider, url, signal, gueltig, fortsetzen, gezeigt: unterdrueckt,
      fensterAbbruch: new AbortController() };
    versuch.abbrechen = () => beenden(versuch);
    signal.addEventListener("abort", versuch.abbrechen, { once: true });
    aktuell = versuch;
    if (!unterdrueckt) versuch.timer = setzen(async () => {
      if (aktuell !== versuch || signal.aborted || !gueltig() || versuch.gezeigt) return;
      versuch.gezeigt = true;
      const ergebnis = await oeffnen(versuch).catch(() => "fehlgeschlagen");
      if (ergebnis === "bestaetigt" && aktuell === versuch && !signal.aborted && gueltig()) {
        beenden(versuch);
        try { await fortsetzen?.(); } catch (error) { fehler(error); }
      }
    }, 20000);
    versuch.timer?.unref?.();
    return versuch;
  }
  return { starten, erfolg: beenden,
    manuell() { if (aktuell) { loeschen(aktuell.timer); aktuell.gezeigt = true; } },
    get aktuell() { return aktuell; } };
}

module.exports = { erstellen, fallbackErstellen };
