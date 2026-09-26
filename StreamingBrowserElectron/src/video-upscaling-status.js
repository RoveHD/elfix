"use strict";
(function bereitstellen() {
  function text(stand) {
    if (stand?.zustand === "aus") return "Ausgeschaltet";
    if (stand?.zustand === "aktiv") return "AMD FSR 1 ist für das laufende Video aktiv.";
    const gruende = {
      "native-untertitel": "Originalbild – damit eingeblendete Untertitel sichtbar bleiben.",
      "bild-in-bild": "Originalbild im Mini-Player.",
      "fenster-verdeckt": "FSR pausiert, solange das Playerfenster verborgen ist.",
      "ausgabe-nicht-groesser": "Originalbild – das Video wird gerade nicht vergrößert.",
      "ausgabe-ueber-4k-grenze": "Originalbild – Upscaling unterstützt Ausgaben bis 4K.",
      "gpu-kontext-verloren": "Originalbild – die Grafikverbindung wurde unterbrochen.",
      "gpu-fehler": "Originalbild – die Grafikbeschleunigung unterstützt FSR hier nicht.",
      "video-kann-nicht-auf-gpu-kopiert-werden": "Originalbild – diese Videoquelle lässt sich nicht mit FSR verarbeiten.",
      "videobild-rueckruf-fehlt": "Originalbild – dieser Player unterstützt die benötigte Bildverarbeitung nicht."
    };
    return gruende[stand?.grund] || (stand?.zustand === "nicht-verfuegbar"
      ? "Originalbild – Upscaling ist für diese Wiedergabe nicht verfügbar."
      : "Eingeschaltet – wartet auf ein geeignetes Videobild.");
  }
  const api = { text };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.ElfixVideoUpscalingStatus = api;
})();
