"use strict";

// Eine echte, isolierte Browserseite. Sie besitzt weder den Player noch dessen
// Navigation; nur die Cookie-Sitzung wird mit der Anbieter-Werkbank geteilt.
function erstellen({ WebContentsView, eltern, sitzung, grenzen, zustandScript, maskeScript, persistieren, verbinden = () => {} }) {
  let offen = null;
  const istHttp = url => /^https?:$/.test((() => { try { return new URL(url).protocol; } catch { return ""; } })());
  function oeffnen(provider, url, { signal, pruefen, erlaubt = istHttp, quelleVorbereiten, quelleUebernehmen } = {}) {
    if (signal?.aborted) return Promise.resolve("geschlossen");
    if (offen) {
      if (offen.providerId === provider.id && offen.url === url) {
        offen.anordnen();
        offen.fokussieren();
        return offen.fertig;
      }
      offen.schliessen();
    }
    const parent = eltern();
    if (!parent || parent.isDestroyed() || !sitzung() || !istHttp(url)) return Promise.resolve("fehlgeschlagen");
    // Beide Renderer liegen im bestehenden Hauptfenster. Die lokale, von
    // Anfang an deckende Flaeche trennt Rueckkehr/Laden vom fremden Dokument.
    const decke = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true,
      nodeIntegration: false, webviewTag: false, webSecurity: true, backgroundThrottling: false } });
    decke.setBackgroundColor("#0b111a");
    const lokal = decke.webContents;
    const vorherFokus = parent.contentView.children.find(v => v.webContents?.isFocused())?.webContents;
    const view = new WebContentsView({ webPreferences: { session: sitzung(),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      webviewTag: false, webSecurity: true, backgroundThrottling: false } });
    const inhalt = view.webContents;
    view.setBackgroundColor("#0b111a");
    const [ersteBreite, ersteHoehe] = parent.getContentSize();
    view.setBounds({ x: 0, y: 52, width: ersteBreite, height: Math.max(1, ersteHoehe - 52) });
    parent.contentView.addChildView(view);
    parent.contentView.addChildView(decke);
    let ausschnitt = null;
    let maskeBereit = false;
    let dialogAngehaengt = false;
    let phase = "warten";
    let lokaleSeiteBereit = false;
    let letzterLokalerStand = "";
    let weiterStand = null;
    const lokalerStand = () => {
      if (lokaleSeiteBereit && !lokal.isDestroyed()) {
        const stand = phase + "|" + Boolean(ausschnitt) + "|" + bereit;
        if (stand === letzterLokalerStand) return;
        letzterLokalerStand = stand;
        lokal.executeJavaScript(`globalThis.anbieterStatusSetzen?.(${JSON.stringify(phase)},${Boolean(ausschnitt)},${bereit})`).catch(() => {});
      }
    };
    const anzeigen = neuePhase => {
      phase = neuePhase;
      const seiteSichtbar = lokaleSeiteBereit && (maskeBereit || (!maskeScript && phase === "seite"));
      if (seiteSichtbar && !dialogAngehaengt) {
        dialogAngehaengt = true;
        anordnen();
        inhalt.setBackgroundThrottling(false);
        inhalt.focus();
      }
      else if (!seiteSichtbar && dialogAngehaengt) {
        dialogAngehaengt = false;
        anordnen(); lokal.focus();
      }
      lokalerStand();
    };
    const boundsSetzen = (ansicht, ziel) => {
      const vorher = ansicht.getBounds();
      if (["x", "y", "width", "height"].some(key => vorher[key] !== ziel[key])) ansicht.setBounds(ziel);
    };
    const anordnen = () => {
      if (parent.isDestroyed()) return;
      const [breite, hoehe] = parent.getContentSize();
      const bereich = grenzen?.() || { x: 0, y: 0, width: breite, height: hoehe };
      const x = Math.max(0, Math.min(breite - 1, Math.round(bereich.x || 0)));
      const y = Math.max(0, Math.min(hoehe - 1, Math.round(bereich.y || 0)));
      const width = Math.max(1, Math.min(breite - x, Math.round(bereich.width || breite)));
      const height = Math.max(1, Math.min(hoehe - y, Math.round(bereich.height || hoehe)));
      boundsSetzen(decke, { x, y, width, height: dialogAngehaengt ? Math.min(52, height) : height });
      boundsSetzen(view, { x, y: y + 52, width, height: Math.max(1, height - 52) });
      const kinder = parent.contentView.children;
      if (kinder.at(-2) !== view || kinder.at(-1) !== decke) {
        parent.contentView.addChildView(view);
        parent.contentView.addChildView(decke);
        inhalt.setBackgroundThrottling(false);
        lokal.setBackgroundThrottling(false);
      }
    };
    anordnen();
    // Native Vollueberdeckung haelt auch bei setVisible(true) rAF an. Die
    // lokale Decke wird deshalb nach Installation der DOM-Vollmaske zum
    // Header; der Provider kann seinen Originaldialog selbst fertig aufbauen.
    view.setVisible(true);
    inhalt.setBackgroundThrottling(false);
    parent.on("resize", anordnen);
    const lokaleDatei = require("node:path").join(__dirname, "anbieteransicht-leiste.html");
    lokal.setWindowOpenHandler(() => ({ action: "deny" }));
    lokal.on("will-navigate", event => event.preventDefault());
    verbinden(inhalt, provider);
    const quellen = quelleVorbereiten?.(view);
    let vorbereitungOffen = Boolean(quellen?.vorbereiten);
    inhalt.setAudioMuted(true);
    inhalt.setWindowOpenHandler(() => ({ action: "deny" }));
    inhalt.on("will-prevent-unload", event => event.preventDefault());
    let ergebnis = "geschlossen";
    let gesehen = false;
    let generation = 0;
    let bereit = false;
    let probeGeneration = -1;
    let beschaeftigt = false;
    let letzterQuellenFehler = "";
    const abbruch = new AbortController();
    const klickKennung = "__elfixAnbieterWeiter:" + require("node:crypto").randomUUID();
    let weiterAm = 0;
    let dokumentAm = Date.now();
    let aufloesen;
    const fertig = new Promise(resolve => { aufloesen = resolve; });
    const eintrag = { parent, lokal, inhalt, providerId: provider.id, url, fertig, anordnen,
      fokussieren() { parent.focus(); (dialogAngehaengt ? inhalt : lokal).focus(); }, schliessen };
    offen = eintrag;
    let geschlossen = false;
    function schliessen() {
      if (geschlossen) return;
      geschlossen = true;
      clearInterval(beobachter);
      abbruch.abort();
      quellen?.schliessen();
      signal?.removeEventListener("abort", schliessen);
      parent.removeListener("resize", anordnen);
      parent.removeListener("resize", neuMaskieren);
      parent.removeListener("closed", schliessen);
      if (offen === eintrag) offen = null;
      if (!parent.isDestroyed()) {
        parent.contentView.removeChildView(view);
        parent.contentView.removeChildView(decke);
      }
      if (!inhalt.isDestroyed()) inhalt.close();
      if (!lokal.isDestroyed()) lokal.close();
      Promise.resolve().then(() => persistieren(sitzung())).catch(() => {}).then(() => aufloesen(ergebnis));
      if (!parent.isDestroyed()) {
        if (vorherFokus && !vorherFokus.isDestroyed()) vorherFokus.focus();
        else parent.webContents.focus();
      }
    }
    signal?.addEventListener("abort", schliessen, { once: true });
    const gueltig = () => offen === eintrag && !parent.isDestroyed() && !geschlossen && !abbruch.signal.aborted && !signal?.aborted;
    const maskieren = async (vorbereiten = vorbereitungOffen) => {
      if (!maskeScript || !gueltig() || !bereit) return;
      const stand = generation;
      const masse = await inhalt.executeJavaScriptInIsolatedWorld(987, [{ code: maskeScript(klickKennung, vorbereiten ? "vorbereiten" : weiterAm ? "laden" : "warten") }]).catch(() => null);
      if (!gueltig() || stand !== generation || !bereit) return;
      maskeBereit = masse?.bereit === true;
      if (masse && [masse.left, masse.top, masse.width, masse.height].every(Number.isFinite) && masse.width > 0 && masse.height > 0) {
        ausschnitt = masse;
        const erneutePruefung = weiterStand && masse.pruefung && masse.pruefung !== weiterStand.pruefung;
        if (weiterAm && (masse.fehler || erneutePruefung)) { weiterAm = 0; weiterStand = null; }
        if (vorbereiten) anzeigen("warten");
        else if (!weiterAm || masse.fehler || erneutePruefung) {
          anzeigen("dialog");
        } else anzeigen("laden");
        anordnen();
      } else {
        ausschnitt = null;
        anzeigen(weiterAm ? "laden" : "warten");
      }
    };
    const neuMaskieren = () => { void maskieren(); };
    parent.on("resize", neuMaskieren);
    inhalt.on("console-message", (_event, ...args) => {
      const details = [_event, ...args].find(wert => typeof wert?.message === "string");
      const meldung = details?.message ?? args[1];
      if (typeof meldung === "string" && meldung.startsWith(klickKennung + ":")) {
        const zeit = Number(meldung.slice(klickKennung.length + 1));
        if (Number.isFinite(zeit) && zeit > 0 && zeit <= Date.now() + 1000) {
          weiterAm = zeit;
          weiterStand = ausschnitt;
          if (maskeScript) anzeigen("laden");
        }
      }
    });
    lokal.on("console-message", (_event, ...args) => {
      const details = [_event, ...args].find(wert => typeof wert?.message === "string");
      const meldung = details?.message ?? args[1];
      if (meldung === "__elfix:anbieter:schliessen") { schliessen(); return; }
    });
    const pruefe = async () => {
      if (!gueltig() || !bereit || beschaeftigt) return;
      beschaeftigt = true;
      const stand = generation;
      try {
        if (quellen?.vorbereiten) {
          // Auswahl-Handler koennen selbst auf einen Animationsframe warten.
          // Dafuer muss der Provider schon aktiv, aber noch voll maskiert sein.
          if (!maskeBereit) await maskieren(true);
          if (!gueltig() || stand !== generation || !bereit) return;
          const vorbereitet = await quellen.vorbereiten({ signal: abbruch.signal });
          if (!gueltig() || stand !== generation || !bereit) return;
          vorbereitungOffen = !vorbereitet;
          if (!vorbereitet) { await maskieren(); return; }
        }
        if (!gueltig() || stand !== generation || !bereit) return;
        await maskieren();
        if (!gueltig() || stand !== generation || !bereit) return;
        if (!maskeScript) anzeigen("seite");
        const lage = await inhalt.executeJavaScript(zustandScript());
        if (!gueltig() || stand !== generation || !bereit) return;
        if (quellen) {
          // Eine echte Bestätigung bleibt manuell. Eine bereits freigegebene
          // Session darf ohne erfundenen Weiter-Klick dieselbe Quellenprobe
          // nutzen, wenn Auswahl, Redirect und Player-Frame belegt sind.
          const ohneBestaetigung = !weiterAm;
          if (ohneBestaetigung && (ausschnitt || lage?.offen !== false
            || !await quellen.freigegeben?.({ signal: abbruch.signal }))) return;
          if (!gueltig() || stand !== generation || !bereit) return;
          const quelle = await quellen.pruefen({ signal: abbruch.signal, seit: weiterAm || dokumentAm, ohneBestaetigung });
          if (!quelle?.ok || !gueltig() || generation !== stand) return;
          if (ohneBestaetigung) {
            await maskieren();
            const lageDanach = await inhalt.executeJavaScript(zustandScript());
            if (!gueltig() || stand !== generation || !bereit || ausschnitt || lageDanach?.offen !== false
              || !await quellen.freigegeben?.({ signal: abbruch.signal, quelle })) return;
            if (!gueltig() || stand !== generation || !bereit) return;
          }
          const wechseln = herstellen => {
            if (!gueltig()) return null;
            signal?.removeEventListener("abort", schliessen);
            signal = herstellen();
            signal?.addEventListener("abort", schliessen, { once: true });
            if (signal?.aborted) schliessen();
            return signal;
          };
          if (!await quelleUebernehmen?.(quelle, { signal: abbruch.signal, wechseln }) || !gueltig()) return;
          await persistieren(sitzung());
          if (!gueltig()) return;
          ergebnis = "uebernommen";
          schliessen();
          return;
        }
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
      } catch (error) {
        // Dokumentwechsel verwerfen ihre Probe. Echte Integrationsfehler im
        // Quellenpfad bleiben erkennbar, ohne alle 400ms dasselbe zu loggen.
        const meldung = String(error?.message || error);
        if (quellen && gueltig() && stand === generation && bereit && meldung !== letzterQuellenFehler) {
          letzterQuellenFehler = meldung;
          console.warn("[ELFIX ANBIETER] Quellenuebernahme: " + meldung);
        }
      }
      finally { beschaeftigt = false; }
    };
    inhalt.on("will-navigate", (event, ziel) => { if (!istHttp(ziel) || !erlaubt(ziel)) event.preventDefault(); });
    inhalt.on("will-redirect", (event, ziel) => { if (!istHttp(ziel) || !erlaubt(ziel)) event.preventDefault(); });
    const taste = (event, input) => {
      if (input.type === "keyDown" && input.key === "Escape") { event.preventDefault(); schliessen(); }
    };
    inhalt.on("before-input-event", taste);
    lokal.on("before-input-event", taste);
    inhalt.on("did-start-navigation", (_event, _url, inPlace, hauptrahmen) => {
      if (hauptrahmen && !inPlace) {
        generation++; bereit = false; vorbereitungOffen = Boolean(quellen?.vorbereiten);
        dokumentAm = Date.now();
        ausschnitt = null; maskeBereit = false; anzeigen(weiterAm ? "laden" : "warten");
      }
    });
    inhalt.on("dom-ready", () => { bereit = true; void pruefe(); });
    inhalt.on("did-fail-load", (_event, code, _text, _url, hauptrahmen) => {
      if (hauptrahmen && code !== -3 && gueltig()) { ergebnis = "fehlgeschlagen"; schliessen(); }
    });
    inhalt.on("render-process-gone", () => { ergebnis = "fehlgeschlagen"; schliessen(); });
    lokal.on("render-process-gone", () => { ergebnis = "fehlgeschlagen"; schliessen(); });
    const beobachter = setInterval(pruefe, 400);
    beobachter.unref?.();
    parent.on("closed", schliessen);
    if (parent.isMinimized()) parent.restore();
    if (!parent.isVisible()) parent.show();
    parent.focus();
    lokal.loadFile(lokaleDatei).then(() => {
      if (!gueltig()) return;
      lokaleSeiteBereit = true;
      lokal.setBackgroundThrottling(false);
      anzeigen(phase); if (!dialogAngehaengt) lokal.focus();
    }).catch(() => {
      if (gueltig()) { ergebnis = "fehlgeschlagen"; schliessen(); }
    });
    inhalt.loadURL(url).catch(error => {
      if (error?.code !== "ERR_ABORTED" && gueltig() && !bereit) { ergebnis = "fehlgeschlagen"; schliessen(); }
    });
    return fertig;
  }
  return { oeffnen, get offen() { return Boolean(offen); },
    get fokussiert() { return Boolean(offen && offen.parent.isFocused() && (offen.lokal.isFocused() || offen.inhalt.isFocused())); },
    anordnen() { offen?.anordnen(); },
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
  function starten({ provider, url, signal, gueltig = () => true, fortsetzen, unterdrueckt = false, optionen = {} }) {
    if (aktuell?.provider.id === provider.id && aktuell.url === url && aktuell.signal === signal) return aktuell;
    beenden(aktuell);
    if (signal.aborted) return null;
    const versuch = { provider, url, signal, gueltig, fortsetzen, optionen, gezeigt: unterdrueckt,
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
