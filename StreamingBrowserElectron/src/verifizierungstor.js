"use strict";

// Das Vorbereitungsfenster bei S.to.
//
// Manchmal legt S.to vor den Stream noch einen Schritt: ein Fenster
// "Video wird vorbereitet...", darin eine Cloudflare-Abfrage und ein Knopf
// "Weiter". Von Hand ist das ein Klick. Fuer den Autostart war es das Ende -
// er wartete auf ein <video>, das erst hinter diesem Knopf entsteht, lief in
// sein Zeitfenster und gab auf. Wer die Folge automatisch starten liess, fand
// den Dialog vor und musste selbst ran.
//
// Geklickt wird deshalb hier - aber nur unter engen Bedingungen. Ein Skript,
// das auf fremden Seiten Knoepfe drueckt, ist ein gefaehrliches Werkzeug:
// daneben liegen "Schliessen", Werbe-Knoepfe und alles, was ein Fake-Overlay
// so anbietet. Die Regel unten ist deshalb bewusst streng gefasst.
//
// Der eigentliche Schutz ist die erste Bedingung: geklickt wird ausschliesslich
// innerhalb eines Kastens, in dem eine echte Cloudflare-Abfrage steckt. Ein
// Werbe-Overlay bringt keine mit.
//
// Auf das Ergebnis der Abfrage wird bewusst nicht gewartet. Turnstile loest
// sich auf diesen Seiten von selbst, und bis das versteckte Token gesetzt ist,
// vergeht Zeit, in der das Fenster nur im Weg steht. Geklickt wird deshalb,
// sobald der Knopf ueberhaupt klickbar ist. Kommt der Klick zu frueh, bleibt
// das Fenster einfach stehen - und der Beobachter unten versucht es erneut,
// sobald sich am Fenster etwas ruehrt.
//
// "Sofort" heisst hier wirklich sofort: das Skript haengt sich einmal in die
// Seite und schlaegt in dem Moment zu, in dem das Fenster auftaucht oder der
// Knopf freigegeben wird. Vorher hing das am 700-ms-Takt des Autostarts.

// Was auf dem Knopf stehen darf. "weitere" ist ausdruecklich nicht dabei -
// "Weitere Informationen" ist kein Weiter.
const WEITER_MUSTER = /^(weiter(?!e)|continue|fortfahren|proceed|zum stream|jetzt ansehen|jetzt starten|watch now|play now)\b/i;

// Was nie geklickt wird, egal was sonst passt.
const SCHLIESSEN_MUSTER = /(schliess|schließ|close|abbrech|cancel|zurueck|zurück|nein danke|ablehnen|x)$/i;

function nein(grund) {
  return { klicken: false, grund };
}

// Darf dieser Knopf geklickt werden?
//
// "kandidat" beschreibt einen Kasten und den einen Knopf darin, so wie die
// Seite ihn gemeldet hat. Diese Funktion laeuft in zwei Welten: hier im Test
// und - ueber toString() eingebettet - in der Seite selbst. Deshalb steht in
// ihr nichts, was nur der eine oder der andere Ort kennt.
function istFreigegebenesTor(kandidat) {
  const k = kandidat || {};

  if (!k.sichtbar) return nein("Fenster nicht sichtbar");
  // Der eigentliche Schutz. Ohne Cloudflare-Abfrage im Kasten wird hier nichts
  // angefasst - das trennt das Vorbereitungsfenster von jedem Werbe-Overlay.
  if (!k.hatVerifizierung) return nein("keine Verifizierung im Fenster");
  if (!k.knopfText) return nein("kein Knopf gefunden");

  const text = String(k.knopfText).trim();
  if (SCHLIESSEN_MUSTER.test(text)) return nein("das ist der Schliessen-Knopf");
  if (!WEITER_MUSTER.test(text)) return nein(`Knopftext passt nicht: ${text.slice(0, 40)}`);
  // Das Einzige, worauf gewartet wird: ein gesperrter Knopf laesst sich nicht
  // druecken. Sobald die Sperre faellt, meldet der Beobachter das und es geht
  // weiter - schneller kann es nicht gehen.
  if (k.knopfDeaktiviert) return nein("Knopf ist noch gesperrt");

  // Auf das Token der Abfrage wird ausdruecklich nicht gewartet. Es ist nur
  // noch Auskunft fuers Protokoll.
  return { klicken: true, grund: k.geloest === true ? "Verifizierung bestanden" : "sofort" };
}

// Womit sich die Seite meldet, wenn der Beobachter zugeschlagen hat. Denselben
// Kanal benutzt ELFIX schon fuer den Player und die Watchparty.
const TOR_MELDUNG = "__elfix:tor:";

// Das Skript, das sich in die Anbieterseite haengt.
//
// Es sucht nicht die ganze Seite ab, sondern geht von der Cloudflare-Abfrage
// aus nach oben: sie ist der seltene, eindeutige Anker. Was darueber liegt,
// ist der Dialog, und darin steht der Knopf.
//
// Eingehaengt wird einmal je Dokument. Danach laeuft ein MutationObserver mit
// und prueft bei jeder Aenderung erneut - dadurch faellt der Klick in dem
// Moment, in dem das Fenster erscheint oder der Knopf freigegeben wird, und
// nicht erst beim naechsten Durchlauf des Autostarts.
function torScript(maxKlicks = 4) {
  return `(() => {
  const KENN = "__elfixTorV1";
  const MELDUNG = ${JSON.stringify(TOR_MELDUNG)};
  const MAX = ${Number(maxKlicks) || 4};
  if (window[KENN]) return window[KENN].pruefen();

  const istFreigegebenesTor = ${istFreigegebenesTor.toString()};
  const nein = ${nein.toString()};
  const WEITER_MUSTER = ${WEITER_MUSTER.toString()};
  const SCHLIESSEN_MUSTER = ${SCHLIESSEN_MUSTER.toString()};

  let klicks = 0;
  let letzterKlick = 0;
  let letzteMeldung = "";

  const sichtbar = (el) => {
    if (!el) return false;
    try {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity || 1) > 0.05 && r.width > 40 && r.height > 40;
    } catch (_) { return false; }
  };
  const text = (el) => String((el && (el.innerText || el.textContent || el.value || el.getAttribute("aria-label") || el.title)) || "").replace(/\\s+/g, " ").trim();

  const pruefen = () => {
    if (klicks >= MAX) return "";
    // Nach einem Klick kurz Ruhe: die Seite braucht einen Moment, und der
    // Beobachter feuert waehrend des Umbaus sonst mehrfach.
    if (Date.now() - letzterKlick < 1200) return "";

    // Der Anker: die Cloudflare-Abfrage.
    const abfrage = document.querySelector('.cf-turnstile, [data-sitekey], iframe[src*="challenges.cloudflare.com"], iframe[title*="Cloudflare" i], iframe[title*="Widget" i]');
    if (!abfrage) return "";

    // Von dort nach oben, bis ein Kasten kommt, der einen Knopf traegt.
    let kasten = abfrage.parentElement;
    let knopf = null;
    for (let tiefe = 0; kasten && tiefe < 6; tiefe += 1) {
      const knoepfe = Array.from(kasten.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"],a[href="#"],a:not([href])'))
        .filter(sichtbar)
        .filter((el) => !SCHLIESSEN_MUSTER.test(text(el)));
      knopf = knoepfe.find((el) => WEITER_MUSTER.test(text(el))) || null;
      if (knopf) break;
      kasten = kasten.parentElement;
    }
    if (!kasten || !knopf) return "";

    // Nur noch fuers Protokoll: ob Cloudflare schon abgesegnet hat. Gewartet
    // wird darauf nicht.
    const feld = kasten.querySelector('input[name="cf-turnstile-response"], input[name="g-recaptcha-response"]');
    const geloest = feld ? Boolean(String(feld.value || "").trim()) : null;

    const urteil = istFreigegebenesTor({
      sichtbar: sichtbar(kasten),
      hatVerifizierung: true,
      knopfText: text(knopf),
      knopfDeaktiviert: Boolean(knopf.disabled) || knopf.getAttribute("aria-disabled") === "true" || knopf.classList.contains("disabled"),
      geloest
    });
    if (!urteil.klicken) return melde("tor-gewartet:" + urteil.grund);

    klicks += 1;
    letzterKlick = Date.now();
    try {
      knopf.scrollIntoView({ block: "center", behavior: "instant" });
      const r = knopf.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      knopf.dispatchEvent(new PointerEvent("pointerdown", o));
      knopf.dispatchEvent(new MouseEvent("mousedown", o));
      knopf.dispatchEvent(new PointerEvent("pointerup", o));
      knopf.dispatchEvent(new MouseEvent("mouseup", o));
      knopf.dispatchEvent(new MouseEvent("click", o));
      if (typeof knopf.click === "function") knopf.click();
    } catch (fehler) {
      return melde("tor-fehler:" + String(fehler && fehler.message));
    }
    return melde("tor-geklickt:" + text(knopf).slice(0, 24) + ":" + urteil.grund);
  };

  // Jede Meldung nur einmal: der Beobachter feuert bei jeder Kleinigkeit, und
  // dasselbe "warte noch" hundertmal im Protokoll hilft niemandem.
  const melde = (nachricht) => {
    if (nachricht && nachricht !== letzteMeldung) {
      letzteMeldung = nachricht;
      try { console.log(MELDUNG + nachricht); } catch (_) {}
    }
    return nachricht;
  };

  window[KENN] = { pruefen };
  try {
    const beobachter = new MutationObserver(() => { pruefen(); });
    beobachter.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "disabled", "aria-disabled", "value"]
    });
  } catch (_) {}

  return pruefen();
})()`;
}

module.exports = {
  TOR_MELDUNG,
  WEITER_MUSTER,
  SCHLIESSEN_MUSTER,
  istFreigegebenesTor,
  torScript
};
