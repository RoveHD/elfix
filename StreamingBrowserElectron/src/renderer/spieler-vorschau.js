"use strict";

/*
 * Echte Bilder beim Spulen, ohne den laufenden Player anzufassen.
 *
 * Das Modul bekommt absichtlich niemals das Hauptvideo. Es besitzt ein zweites,
 * stummes Video und genau einen laufenden Leseauftrag. Viele Mausbewegungen
 * werden damit nicht zu vielen gleichzeitigen Spruengen: neben dem laufenden
 * Auftrag bleibt nur der neueste Wunsch stehen.
 */
(function veroeffentlichen(fabrik) {
  const api = fabrik();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.ElfixSpielerVorschau = api;
})(function bauen() {
  const STANDARD_BREITE = 240;
  const STANDARD_HOEHE = 135;
  const STANDARD_CACHE = 16;
  const STANDARD_TIMEOUT_MS = 3000;
  const ABSCHNITT_SEKUNDEN = 2;

  function echteZahl(wert) {
    return typeof wert === "number" && Number.isFinite(wert);
  }

  function adresseLesen(wert) {
    try {
      const url = new URL(String(wert || ""));
      return ["http:", "https:", "file:"].includes(url.protocol) ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  function mitFrist(versprechen, dauer, text) {
    let uhr;
    return Promise.race([
      versprechen,
      new Promise((_fertig, ablehnen) => {
        uhr = setTimeout(() => ablehnen(new Error(text || "Zeitüberschreitung")), dauer);
      })
    ]).finally(() => clearTimeout(uhr));
  }

  function einmal(ziel, name, mediumAblage, dauer, fehlerName = "error") {
    return new Promise((fertig, ablehnen) => {
      let uhr;
      const aufraeumen = () => {
        ziel.removeEventListener(name, da);
        ziel.removeEventListener(fehlerName, fehler);
        mediumAblage?.aufraeumen.delete(abbrechen);
        clearTimeout(uhr);
      };
      const da = () => { aufraeumen(); fertig(); };
      const fehler = () => { aufraeumen(); ablehnen(new Error(`Medienereignis ${fehlerName}`)); };
      const abbrechen = () => { aufraeumen(); ablehnen(new Error("abgebrochen")); };
      ziel.addEventListener(name, da, { once: true });
      ziel.addEventListener(fehlerName, fehler, { once: true });
      mediumAblage?.aufraeumen.add(abbrechen);
      if (dauer > 0) uhr = setTimeout(() => {
        aufraeumen();
        ablehnen(new Error(`Medienereignis ${name} blieb aus`));
      }, dauer);
    });
  }

  function erstellen(optionen = {}) {
    const canvas = optionen.canvas;
    if (!canvas || typeof canvas.getContext !== "function") {
      throw new TypeError("Für die Spielervorschau fehlt ein Canvas.");
    }
    const breite = Math.max(1, Number(optionen.breite) || STANDARD_BREITE);
    const hoehe = Math.max(1, Number(optionen.hoehe) || STANDARD_HOEHE);
    const cacheMax = Math.max(1, Number(optionen.cacheMax) || STANDARD_CACHE);
    const timeoutMs = Math.max(250, Number(optionen.timeoutMs) || STANDARD_TIMEOUT_MS);
    const HlsKlasse = optionen.Hls || (typeof window !== "undefined" ? window.Hls : null);
    const holen = optionen.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    const melden = typeof optionen.beiZustand === "function" ? optionen.beiZustand : () => {};
    const vorgegebenesVideo = optionen.video || null;
    const cache = new Map();
    let quelleAktuell = null;
    let generation = 0;
    let medium = null;
    let laufend = null;
    let wartend = null;
    let zerstoert = false;
    let wunsch = 0;

    canvas.width = breite;
    canvas.height = hoehe;

    function ergebnis(auftrag, ok, zusatz = {}) {
      if (auftrag.erledigt) return;
      auftrag.erledigt = true;
      auftrag.fertig({ ok, stelle: auftrag.stelle, ...zusatz });
    }

    function cacheLeeren() {
      for (const eintrag of cache.values()) {
        try { eintrag.bild.close?.(); } catch (_) {}
      }
      cache.clear();
    }

    function mediumAbräumen() {
      const alt = medium;
      medium = null;
      if (!alt) return;
      for (const steuerung of alt.abbrueche) {
        try { steuerung.abort(); } catch (_) {}
      }
      alt.abbrueche.clear();
      for (const aufraeumen of [...alt.aufraeumen]) {
        try { aufraeumen(); } catch (_) {}
      }
      alt.aufraeumen.clear();
      try { alt.hls?.stopLoad(); } catch (_) {}
      try { alt.hls?.destroy(); } catch (_) {}
      try { alt.video.pause(); } catch (_) {}
      try {
        alt.video.removeAttribute("src");
        alt.video.load();
      } catch (_) {}
      if (alt.eigen) {
        try { alt.video.remove(); } catch (_) {}
      }
    }

    function abbrechen(grund, cacheAuch = false) {
      generation += 1;
      if (laufend) {
        laufend.abgebrochen = true;
        ergebnis(laufend, false, { grund });
      }
      if (wartend) {
        ergebnis(wartend, false, { grund });
        wartend = null;
      }
      laufend = null;
      mediumAbräumen();
      if (cacheAuch) cacheLeeren();
    }

    function videoHolen() {
      if (medium?.video) return medium.video;
      const eigen = !vorgegebenesVideo;
      const video = vorgegebenesVideo || document.createElement("video");
      video.muted = true;
      video.volume = 0;
      video.playsInline = true;
      video.preload = "metadata";
      video.crossOrigin = "anonymous";
      if (eigen) {
        video.setAttribute("aria-hidden", "true");
        video.tabIndex = -1;
        Object.assign(video.style, {
          position: "fixed", width: "1px", height: "1px", left: "-4px", top: "-4px",
          opacity: "0", pointerEvents: "none"
        });
        document.body.appendChild(video);
      }
      medium = { video, eigen, hls: null, bereit: null, generation,
        abbrueche: new Set(), aufraeumen: new Set() };
      return video;
    }

    async function bereichsProbe(adresse, meineGeneration) {
      const url = new URL(adresse);
      if (url.protocol === "file:") return true;
      if (!holen) return false;
      const steuerung = new AbortController();
      const meinMedium = medium;
      meinMedium?.abbrueche.add(steuerung);
      const uhr = setTimeout(() => steuerung.abort(), timeoutMs);
      let antwort;
      try {
        antwort = await holen(adresse, {
          method: "GET",
          headers: { Range: "bytes=0-0" },
          signal: steuerung.signal
        });
        const contentRange = String(antwort.headers?.get?.("content-range") || "");
        return meineGeneration === generation && antwort.status === 206
          && /^bytes\s+0-\d+\/\d+$/i.test(contentRange);
      } catch (_) {
        return false;
      } finally {
        clearTimeout(uhr);
        meinMedium?.abbrueche.delete(steuerung);
        try { await antwort?.body?.cancel(); } catch (_) {}
      }
    }

    async function dateiVorbereiten(adresse, meineGeneration) {
      if (!await bereichsProbe(adresse, meineGeneration)) {
        throw new Error("Quelle unterstützt keinen begrenzten Bereichsabruf");
      }
      if (meineGeneration !== generation) throw new Error("veraltet");
      const video = videoHolen();
      const bereit = einmal(video, "loadedmetadata", medium, timeoutMs);
      video.src = adresse;
      video.load();
      await bereit;
      return medium;
    }

    async function hlsVorbereiten(adresse, meineGeneration) {
      if (!HlsKlasse || typeof HlsKlasse.isSupported !== "function" || !HlsKlasse.isSupported()) {
        throw new Error("HLS-Vorschau wird nicht unterstützt");
      }
      const video = videoHolen();
      const hls = new HlsKlasse({
        autoStartLoad: false,
        startPosition: 0,
        testBandwidth: false,
        startLevel: 0,
        capLevelToPlayerSize: true,
        maxBufferLength: 4,
        maxMaxBufferLength: 8,
        maxBufferSize: 4 * 1024 * 1024,
        backBufferLength: 0
      });
      medium.hls = hls;
      const meinMedium = medium;
      const ereignisse = HlsKlasse.Events || {};
      const arretieren = new Promise((fertig, ablehnen) => {
        const aufraeumen = () => {
          try { hls.off?.(ereignisse.MANIFEST_PARSED, manifest); } catch (_) {}
          try { hls.off?.(ereignisse.INIT_PTS_FOUND, anker); } catch (_) {}
          try { hls.off?.(ereignisse.ERROR, fehler); } catch (_) {}
          meinMedium.aufraeumen.delete(abbrechen);
        };
        const manifest = () => {
          if (meineGeneration !== generation) return;
          try {
            hls.currentLevel = 0;
            hls.startLoad(0);
          } catch (grund) { aufraeumen(); ablehnen(grund); }
        };
        const anker = (_name, daten) => {
          if (meineGeneration !== generation || (daten?.id && daten.id !== "main")) return;
          try { hls.stopLoad(); } catch (_) {}
          aufraeumen();
          fertig();
        };
        const fehler = (_name, daten) => {
          if (!daten?.fatal) return;
          aufraeumen();
          ablehnen(new Error(`HLS: ${daten.details || daten.type || "Fehler"}`));
        };
        const abbrechen = () => { aufraeumen(); ablehnen(new Error("abgebrochen")); };
        hls.on(ereignisse.MANIFEST_PARSED, manifest);
        hls.on(ereignisse.INIT_PTS_FOUND, anker);
        hls.on(ereignisse.ERROR, fehler);
        meinMedium.aufraeumen.add(abbrechen);
      });
      hls.loadSource(adresse);
      hls.attachMedia(video);
      await arretieren;
      return medium;
    }

    async function vorbereiten(meineGeneration) {
      if (medium?.bereit && medium.generation === meineGeneration) return medium.bereit;
      const adresse = quelleAktuell?.adresse || "";
      const typ = quelleAktuell?.typ || "datei";
      videoHolen();
      medium.bereit = mitFrist(
        typ === "hls" ? hlsVorbereiten(adresse, meineGeneration)
          : dateiVorbereiten(adresse, meineGeneration),
        timeoutMs,
        "Vorschauquelle blieb aus"
      );
      return medium.bereit;
    }

    async function bildAbwarten(video, stelle, hls, mediumAblage) {
      return new Promise((fertig, ablehnen) => {
        let bildZeit = NaN;
        let bildDa = typeof video.requestVideoFrameCallback !== "function";
        let sprungDa = false;
        let bildId;
        let uhr;
        const aufraeumen = () => {
          video.removeEventListener("seeked", beiSprung);
          video.removeEventListener("error", beiFehler);
          mediumAblage?.aufraeumen.delete(abbrechen);
          if (bildId !== undefined && typeof video.cancelVideoFrameCallback === "function") {
            try { video.cancelVideoFrameCallback(bildId); } catch (_) {}
          }
          clearTimeout(uhr);
        };
        const pruefen = () => {
          if (!sprungDa || !bildDa) return;
          aufraeumen();
          try { hls?.stopLoad(); } catch (_) {}
          fertig(Number.isFinite(bildZeit) ? bildZeit : Number(video.currentTime) || stelle);
        };
        const beiSprung = () => { sprungDa = true; pruefen(); };
        const beiFehler = () => { aufraeumen(); ablehnen(new Error("Medienereignis error")); };
        const abbrechen = () => { aufraeumen(); ablehnen(new Error("abgebrochen")); };
        video.addEventListener("seeked", beiSprung, { once: true });
        video.addEventListener("error", beiFehler, { once: true });
        mediumAblage?.aufraeumen.add(abbrechen);
        if (!bildDa) {
          bildId = video.requestVideoFrameCallback((_jetzt, meta) => {
            bildZeit = Number(meta?.mediaTime);
            bildDa = true;
            pruefen();
          });
        }
        uhr = setTimeout(() => {
          aufraeumen();
          ablehnen(new Error("Vorschaubild blieb aus"));
        }, timeoutMs);
        // `readyState >= HAVE_CURRENT_DATA` bedeutet nach `loadedmetadata`
        // noch nicht, dass Chromium dieses Bild schon dargestellt hat. Das
        // sieht man besonders am Anfang: currentTime steht bereits auf null,
        // ein erneutes Setzen auf null ist ein No-op, und Canvas bekäme nur den
        // dunklen Video-Untergrund. Ein winziger Sprung erzwingt auch dort ein
        // echtes Decoderbild; zurueckgegeben wird weiterhin dessen mediaTime.
        let suchZiel = stelle;
        if (Math.abs((Number(video.currentTime) || 0) - stelle) < 0.02) {
          const dauer = Number(video.duration);
          suchZiel = Number.isFinite(dauer) && stelle + 0.001 >= dauer
            ? Math.max(0, stelle - 0.001) : stelle + 0.001;
        }
        video.currentTime = suchZiel;
        try { hls?.startLoad(stelle); } catch (_) {}
      });
    }

    function ausschnittZeichnen(context, bild, quellBreite, quellHoehe) {
      context.fillStyle = "#05070c";
      context.fillRect(0, 0, breite, hoehe);
      const faktor = Math.min(breite / quellBreite, hoehe / quellHoehe);
      const zielBreite = Math.max(1, Math.round(quellBreite * faktor));
      const zielHoehe = Math.max(1, Math.round(quellHoehe * faktor));
      context.drawImage(bild, Math.round((breite - zielBreite) / 2),
        Math.round((hoehe - zielHoehe) / 2), zielBreite, zielHoehe);
    }

    async function rahmenNehmen(video) {
      const quellBreite = Number(video.videoWidth);
      const quellHoehe = Number(video.videoHeight);
      if (!(quellBreite > 0 && quellHoehe > 0)) throw new Error("Videobild hat keine Größe");
      const zwischen = document.createElement("canvas");
      zwischen.width = breite;
      zwischen.height = hoehe;
      ausschnittZeichnen(zwischen.getContext("2d"), video, quellBreite, quellHoehe);
      if (typeof createImageBitmap === "function") return createImageBitmap(zwischen);
      return zwischen;
    }

    function cacheSetzen(key, bild, stelle) {
      if (cache.has(key)) {
        try { cache.get(key).bild.close?.(); } catch (_) {}
        cache.delete(key);
      }
      cache.set(key, { bild, stelle });
      while (cache.size > cacheMax) {
        const erster = cache.keys().next().value;
        const alt = cache.get(erster);
        cache.delete(erster);
        try { alt.bild.close?.(); } catch (_) {}
      }
    }

    function cacheZeigen(key) {
      const eintrag = cache.get(key);
      if (!eintrag) return null;
      cache.delete(key);
      cache.set(key, eintrag);
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, breite, hoehe);
      context.drawImage(eintrag.bild, 0, 0, breite, hoehe);
      return eintrag;
    }

    async function ausfuehren(auftrag) {
      const meineGeneration = auftrag.generation;
      let meinMedium = null;
      try {
        melden({ art: "laden", stelle: auftrag.stelle });
        const vorbereitung = vorbereiten(meineGeneration);
        meinMedium = medium;
        const vorbereitet = await vorbereitung;
        if (auftrag.abgebrochen || meineGeneration !== generation) throw new Error("veraltet");
        const bildZeit = await mitFrist(
          bildAbwarten(vorbereitet.video, auftrag.stelle, vorbereitet.hls, vorbereitet),
          timeoutMs,
          "Vorschaubild blieb aus"
        );
        if (auftrag.abgebrochen || meineGeneration !== generation) throw new Error("veraltet");
        const bild = await rahmenNehmen(vorbereitet.video);
        if (auftrag.abgebrochen || meineGeneration !== generation) {
          try { bild.close?.(); } catch (_) {}
          throw new Error("veraltet");
        }
        cacheSetzen(auftrag.key, bild, bildZeit);
        if (auftrag.wunsch === wunsch) {
          cacheZeigen(auftrag.key);
          melden({ art: "bild", stelle: bildZeit, ziel: auftrag.ziel, ausCache: false });
          ergebnis(auftrag, true, { stelle: bildZeit, ziel: auftrag.ziel, ausCache: false });
        } else {
          ergebnis(auftrag, false, { grund: "ersetzt", ziel: auftrag.ziel });
        }
      } catch (fehler) {
        if (medium === meinMedium && meinMedium?.generation === meineGeneration) mediumAbräumen();
        const grund = auftrag.abgebrochen || meineGeneration !== generation
          ? "abgebrochen" : String(fehler?.message || fehler || "Vorschau fehlgeschlagen");
        if (grund !== "abgebrochen" && auftrag.wunsch === wunsch && meineGeneration === generation) {
          melden({ art: "fehler", stelle: auftrag.stelle, ziel: auftrag.ziel, grund });
        }
        ergebnis(auftrag, false, { grund });
      } finally {
        if (laufend === auftrag) laufend = null;
        if (wartend && !zerstoert) pumpe();
      }
    }

    function pumpe() {
      if (laufend || !wartend || zerstoert) return;
      laufend = wartend;
      wartend = null;
      ausfuehren(laufend);
    }

    function quelle(wert = {}) {
      const adresse = adresseLesen(wert.adresse);
      const typ = String(wert.typ || "datei").toLowerCase();
      const dauer = Number(wert.dauer);
      const id = String(wert.id ?? adresse);
      const neu = adresse && ["datei", "hls", "dash"].includes(typ) && echteZahl(dauer) && dauer > 0
        ? { adresse, typ, dauer, id } : null;
      const gleich = neu && quelleAktuell && neu.id === quelleAktuell.id
        && neu.adresse === quelleAktuell.adresse && neu.typ === quelleAktuell.typ
        && neu.dauer === quelleAktuell.dauer;
      if (gleich) return true;
      abbrechen("quellenwechsel", true);
      quelleAktuell = neu;
      return Boolean(neu);
    }

    function zeigen(wert) {
      if (zerstoert) return Promise.resolve({ ok: false, stelle: 0, grund: "zerstört" });
      if (!quelleAktuell) return Promise.resolve({ ok: false, stelle: 0, grund: "keine Quelle" });
      const roh = Number(wert);
      if (!Number.isFinite(roh)) return Promise.resolve({ ok: false, stelle: 0, grund: "ungültige Stelle" });
      const ziel = Math.min(quelleAktuell.dauer, Math.max(0, roh));
      const stelle = Math.min(quelleAktuell.dauer,
        Math.round(ziel / ABSCHNITT_SEKUNDEN) * ABSCHNITT_SEKUNDEN);
      const key = `${quelleAktuell.id}:${stelle}`;
      const meinWunsch = ++wunsch;
      const bekannt = cacheZeigen(key);
      if (bekannt) {
        if (wartend) ergebnis(wartend, false, { grund: "ersetzt" });
        wartend = null;
        melden({ art: "bild", stelle: bekannt.stelle, ziel, ausCache: true });
        return Promise.resolve({ ok: true, stelle: bekannt.stelle, ziel, ausCache: true });
      }
      return new Promise((fertig) => {
        const auftrag = { stelle, ziel, key, generation, wunsch: meinWunsch,
          fertig, erledigt: false, abgebrochen: false };
        if (wartend) ergebnis(wartend, false, { grund: "ersetzt" });
        wartend = auftrag;
        pumpe();
      });
    }

    function verbergen() {
      abbrechen("verborgen", false);
      melden({ art: "verborgen", stelle: 0 });
    }

    function zerstoeren() {
      if (zerstoert) return;
      zerstoert = true;
      abbrechen("zerstört", true);
      quelleAktuell = null;
    }

    return { quelle, zeigen, verbergen, zerstoeren };
  }

  return {
    erstellen,
    STANDARD_BREITE,
    STANDARD_HOEHE,
    STANDARD_CACHE,
    STANDARD_TIMEOUT_MS,
    ABSCHNITT_SEKUNDEN
  };
});
