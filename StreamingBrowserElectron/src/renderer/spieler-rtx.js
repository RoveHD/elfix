"use strict";

// The HTML video remains the playback/audio clock. Only its displayed image is
// replaced after the native RTX engine has returned a frame for this generation.
(() => {
  function erstellen({ video, canvas, bruecke, auftragId, beiStatus }) {
    let aktiv = false, zerstoert = false, fehler = "", generation = 1, frameId = 0;
    let zielHoehe = 1440;
    let callback = null, pending = null, letzterStatus = "";
    const opacity = video.style.opacity;
    let context = null;
    function status(zustand, grund, eingang, ausgang) {
      const stand = { zustand, grund, verfahren: "rtx" };
      if (eingang) stand.eingang = eingang;
      if (ausgang) stand.ausgang = ausgang;
      const key = JSON.stringify(stand);
      if (key !== letzterStatus) { letzterStatus = key; beiStatus(stand); }
    }
    function original() { video.style.opacity = opacity; canvas.hidden = true; }
    function abbrechen() {
      if (callback !== null) video.cancelVideoFrameCallback?.(callback);
      callback = null;
    }
    function invalidieren() {
      generation = (generation % 2147483646) + 1;
      pending = null;
      original();
      abbrechen();
      bruecke.rtxStop?.(auftragId());
    }
    function untertitel() {
      return Array.from(video.textTracks).some(t =>
        (t.kind === "subtitles" || t.kind === "captions") && t.mode === "showing");
    }
    function groesse() {
      const width = video.videoWidth, height = video.videoHeight;
      if (!(width > 0 && height > 0))
        return { w: 0, h: 0, width, height, outputWidth: 0, outputHeight: 0, x: 0, y: 0 };
      const zielBreite = zielHoehe * 16 / 9;
      const scale = Math.min(zielBreite / width, zielHoehe / height);
      const outputWidth = Math.min(zielBreite, Math.round(width * scale));
      const outputHeight = Math.min(zielHoehe, Math.round(height * scale));
      // Canvas backing contains exactly the processed frame. CSS fits it into
      // the player window without changing the native RTX output resolution.
      return { w: outputWidth, h: outputHeight, width, height,
        outputWidth, outputHeight, x: 0, y: 0 };
    }
    function hindernis(g) {
      if (!aktiv || zerstoert) return ["aus", "deaktiviert"];
      if (fehler) return ["nicht-verfuegbar", fehler];
      if (document.hidden) return ["bereit", "fenster-verdeckt"];
      if (document.pictureInPictureElement === video) return ["bereit", "bild-in-bild"];
      if (untertitel()) return ["bereit", "native-untertitel"];
      if (!video.requestVideoFrameCallback || typeof VideoFrame !== "function") return ["nicht-verfuegbar", "rtx-videoframe-fehlt"];
      if (video.seeking || video.readyState < 2 || !(g.w > 0 && g.h > 0 && g.width > 0 && g.height > 0)) return ["bereit", "warte-auf-videobild"];
      if (g.outputWidth <= g.width || g.outputHeight <= g.height) return ["nicht-noetig", "ausgabe-nicht-groesser"];
      if (g.width < 640 || g.height < 360) return ["nicht-verfuegbar", "rtx-eingang-zu-klein"];
      if (g.w > 3840 || g.h > 2160 || g.width > 3840 || g.height > 2160) return ["nicht-verfuegbar", "ausgabe-ueber-4k-grenze"];
      return null;
    }
    function anfordern() {
      if (callback !== null || !aktiv || zerstoert || fehler || video.paused || document.hidden || untertitel()) return;
      callback = video.requestVideoFrameCallback?.(() => { callback = null; aktualisieren(); }) ?? null;
    }
    async function aktualisieren() {
      const g = groesse(), h = hindernis(g);
      if (h) {
        original(); status(...h);
        // Readiness is resumed by loadeddata/seeked. No polling for unsupported
        // sources, PiP, subtitles or invisible windows.
        if (h[1] === "ausgabe-nicht-groesser") anfordern();
        return;
      }
      anfordern();
      if (pending) return;
      const mine = generation, id = ++frameId;
      const job = { generation: mine, frameId: id, mediaTime: video.currentTime, g };
      pending = job;
      let frame;
      try {
        frame = new VideoFrame(video, { timestamp: Math.round(video.currentTime * 1000000) });
        const options = { format: "RGBA", rect: { x: 0, y: 0, width: g.width, height: g.height } };
        const pixel = new Uint8Array(g.width * g.height * 4);
        await frame.copyTo(pixel, options);
        frame.close(); frame = null;
        if (!aktiv || generation !== mine || pending !== job) return;
        const result = await bruecke.rtxBild(auftragId(), {
          pixel: pixel.buffer, width: g.width, height: g.height,
          outputWidth: g.outputWidth, outputHeight: g.outputHeight,
          generation: mine, frameId: id
        });
        if (!aktiv || generation !== mine || pending !== job) return;
        if (!result?.ok) {
          pending = null;
          if (result?.grund !== "busy") {
            fehler = result?.grund || "rtx-fehler";
            original(); abbrechen(); status("nicht-verfuegbar", fehler);
          }
        }
      } catch {
        if (generation === mine && aktiv) {
          fehler = "rtx-bildzugriff"; pending = null;
          original(); abbrechen(); status("nicht-verfuegbar", fehler);
        }
      } finally { frame?.close(); }
    }
    function empfangen(event) {
      if (event.source !== window || event.data?.type !== "elfix-rtx-frame") return;
      const { frame, metadata } = event.data;
      if (!(frame instanceof VideoFrame)) return;
      try {
        if (!aktiv || !pending || metadata?.generation !== generation || metadata?.frameId !== pending.frameId) return;
        const job = pending;
        pending = null;
        if (hindernis(groesse())) { original(); return; }
        // A delayed frame after a seek or a long native operation must never
        // cover the current video with an old image.
        if (Math.abs(video.currentTime - job.mediaTime) > 0.15) {
          original(); status("bereit", "rtx-bild-verspaetet"); return;
        }
        const g = job.g;
        if (metadata.width !== g.outputWidth || metadata.height !== g.outputHeight) return;
        context ||= canvas.getContext("2d", { alpha: false });
        if (!context) throw Error("No canvas context");
        if (canvas.width !== g.w || canvas.height !== g.h) { canvas.width = g.w; canvas.height = g.h; }
        context.fillStyle = "#000"; context.fillRect(0, 0, g.w, g.h);
        context.drawImage(frame, g.x, g.y, g.outputWidth, g.outputHeight);
        canvas.hidden = false; video.style.opacity = "0";
        status("aktiv", "rtx-vsr", { breite: g.width, hoehe: g.height },
          { breite: g.outputWidth, hoehe: g.outputHeight });
      } catch {
        fehler = "rtx-ausgabe"; original(); abbrechen(); status("nicht-verfuegbar", fehler);
      } finally { frame.close(); }
    }
    function quelle() { if (!aktiv) return; fehler = ""; invalidieren(); aktualisieren(); }
    function seek() { if (aktiv) { invalidieren(); status("bereit", "warte-auf-videobild"); } }
    function aenderung() {
      if (!aktiv) return;
      invalidieren(); aktualisieren();
    }
    function bildBereit() { if (aktiv) aktualisieren(); }
    const events = [["loadstart", quelle], ["emptied", quelle], ["loadeddata", bildBereit],
      ["seeking", seek], ["seeked", bildBereit], ["play", bildBereit], ["pause", bildBereit],
      ["resize", aenderung], ["enterpictureinpicture", aenderung], ["leavepictureinpicture", aenderung]];
    for (const [event, handler] of events) video.addEventListener(event, handler);
    video.textTracks.addEventListener("change", aenderung);
    document.addEventListener("visibilitychange", aenderung);
    window.addEventListener("message", empfangen);
    // CSS resizes the existing processed canvas; no native frame is required.
    original();
    return {
      setzeAktiv(value, neueZielHoehe = 1440) {
        const next = value === true;
        const naechstesZiel = Number(neueZielHoehe) === 2160 ? 2160 : 1440;
        if (zerstoert || (aktiv === next && zielHoehe === naechstesZiel)) return;
        zielHoehe = naechstesZiel;
        aktiv = next; fehler = ""; invalidieren();
        if (aktiv) aktualisieren(); else status("aus", "deaktiviert");
      },
      zerstoeren() {
        if (zerstoert) return;
        zerstoert = true; aktiv = false; invalidieren();
        for (const [event, handler] of events) video.removeEventListener(event, handler);
        video.textTracks.removeEventListener("change", aenderung);
        document.removeEventListener("visibilitychange", aenderung);
        window.removeEventListener("message", empfangen);
      }
    };
  }
  window.ElfixSpielerRtx = Object.freeze({ erstellen });
})();
