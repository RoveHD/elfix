"use strict";

// Kurze, lokal erzeugte UI-Toene. Kein Audio-Download und kein Zugriff auf
// den Player. Erst eine echte Benutzeraktion oeffnet den AudioContext.
(function (root) {
  function erstellen({ getSettings, isQuiet = () => false }) {
    let context = null;
    let lastInput = -Infinity;
    let lastSound = -Infinity;
    let clickTimer = 0;
    let disposed = false;
    const voices = new Set();
    const now = () => performance.now();
    const allowed = () => !disposed && getSettings().uiSounds !== false
      && Number(getSettings().uiSoundVolume ?? 20) > 0
      && !document.hidden && !isQuiet();

    function activate() {
      if (!allowed()) return;
      try {
        const Audio = root.AudioContext || root.webkitAudioContext;
        if (!Audio) return;
        context ||= new Audio();
        if (context.state === "suspended") context.resume().catch(() => {});
      } catch (_) { /* Audio darf niemals eine UI-Aktion verhindern. */ }
    }

    function stop() {
      for (const voice of voices) {
        try { voice.stop(); } catch (_) { /* Bereits beendet. */ }
      }
      voices.clear();
    }

    function play(kind = "click") {
      if (!allowed() || !context || context.state !== "running"
        || now() - lastInput > 1200 || now() - lastSound < 90) return false;
      const volume = Math.min(100, Math.max(0, Number(getSettings().uiSoundVolume ?? 20)));
      if (!Number.isFinite(volume)) return false;
      const tones = kind === "dialog" ? [[520, 780, 0.095, 0]]
        : kind === "notice" ? [[660, 660, 0.09, 0], [880, 880, 0.11, 0.065]]
          : [[430, 310, 0.045, 0]];
      try {
        for (const [from, to, duration, delay] of tones) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const start = context.currentTime + delay;
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(from, start);
          oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(volume / 100 * 0.1, start + 0.006);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
          oscillator.connect(gain);
          gain.connect(context.destination);
          voices.add(oscillator);
          oscillator.onended = () => {
            oscillator.disconnect();
            gain.disconnect();
            voices.delete(oscillator);
          };
          oscillator.start(start);
          oscillator.stop(start + duration + 0.01);
        }
        lastSound = now();
        return true;
      } catch (_) { stop(); return false; }
    }

    function clicked(event) {
      if (!event.isTrusted) return;
      const target = event.target.closest?.("button, [role='button'], input[type='checkbox'], select, .favorite-card, .search-result-card");
      if (!target || target.matches(":disabled, [aria-disabled='true']")
        || target.closest(".app-preview, .crop-preview")) return;
      lastInput = now();
      activate();
      clearTimeout(clickTimer);
      // Ein Dialog oder eine Bestaetigung ersetzt den Klickton, statt ihn
      // zu ueberlagern. Keine Toene beim Hover, Tippen oder Carousel-Timer.
      clickTimer = setTimeout(() => play("click"), 45);
    }

    const observer = new MutationObserver((changes) => {
      if (!changes.some(change => change.target.matches("dialog[open]"))
        || now() - lastInput > 600) return;
      clearTimeout(clickTimer);
      play("dialog");
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    document.addEventListener("click", clicked, true);
    return {
      notice() { clearTimeout(clickTimer); play("notice"); },
      sync() { if (!allowed()) stop(); },
      destroy() {
        disposed = true;
        clearTimeout(clickTimer);
        observer.disconnect();
        document.removeEventListener("click", clicked, true);
        stop();
        context?.close().catch(() => {});
      }
    };
  }
  root.ELFIX_UI_SOUNDS = { erstellen };
})(globalThis);
