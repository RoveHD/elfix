"use strict";
(function bereitstellen() {
  function text(stand) {
    if (stand?.zustand === "aus") return "Ausgeschaltet";
    const namen = { rtx: "NVIDIA RTX Video", anime4k: "Anime4K" };
    if (stand?.zustand === "aktiv") return `${namen[stand.verfahren] || "AMD FSR 1"} ist für das laufende Video aktiv.`;
    const gruende = {
      "native-untertitel": "Originalbild – damit eingeblendete Untertitel sichtbar bleiben.",
      "bild-in-bild": "Originalbild im Mini-Player.",
      "fenster-verdeckt": "Upscaling pausiert, solange das Playerfenster verborgen ist.",
      "ausgabe-nicht-groesser": "Originalbild – das Video wird gerade nicht vergrößert.",
      "ausgabe-ueber-4k-grenze": "Originalbild – Upscaling unterstützt Ausgaben bis 4K.",
      "gpu-kontext-verloren": "Originalbild – die Grafikverbindung wurde unterbrochen.",
      "gpu-fehler": "Originalbild – die Grafikbeschleunigung unterstützt dieses Verfahren hier nicht.",
      "video-kann-nicht-auf-gpu-kopiert-werden": "Originalbild – diese Videoquelle lässt sich hier nicht auf der Grafikkarte verarbeiten.",
      "videobild-rueckruf-fehlt": "Originalbild – dieser Player unterstützt die benötigte Bildverarbeitung nicht.",
      "rtx-videoframe-fehlt": "Originalbild – die benötigte Videoschnittstelle ist nicht verfügbar.",
      "rtx-eingang-zu-klein": "Originalbild – RTX Video benötigt mindestens 640 × 360 Bildpunkte.",
      "rtx-bildzugriff": "Originalbild – diese Videoquelle lässt sich nicht mit RTX Video verarbeiten.",
      "rtx-ausgabe": "Originalbild – das RTX-Bild konnte nicht angezeigt werden.",
      "rtx-bild-verspaetet": "Originalbild – das RTX-Bild war noch nicht rechtzeitig bereit.",
      "rtx-fehlt": "Originalbild – die RTX-Video-Komponente ist nicht installiert.",
      "rtx-nicht-verfuegbar": "Originalbild – RTX Video ist auf dieser Grafikkarte oder mit diesem Treiber nicht verfügbar.",
      "rtx-fehler": "Originalbild – RTX Video konnte das Bild nicht verarbeiten."
    };
    return gruende[stand?.grund] || (stand?.zustand === "nicht-verfuegbar"
      ? "Originalbild – Upscaling ist für diese Wiedergabe nicht verfügbar."
      : "Eingeschaltet – wartet auf ein geeignetes Videobild.");
  }
  const api = { text };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.ElfixVideoUpscalingStatus = api;
})();
