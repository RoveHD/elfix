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
// Werbe-Overlay bringt keine mit. Und ob die Abfrage bestanden ist, verraet
// Cloudflare selbst - das versteckte Feld "cf-turnstile-response" traegt dann
// einen Wert. Das ist unabhaengig von der Sprache der Seite und davon, wie der
// Erfolg gerade aussieht.

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
  if (k.knopfDeaktiviert) return nein("Knopf ist noch gesperrt");
  // false heisst: das Feld ist da und leer - die Abfrage laeuft noch. null
  // heisst: kein Feld gefunden, dann entscheidet der Knopf allein, denn nicht
  // jede Einbindung legt es an.
  if (k.geloest === false) return nein("Verifizierung noch nicht bestanden");

  return { klicken: true, grund: k.geloest === true ? "Verifizierung bestanden" : "Knopf frei" };
}

// Das Skript, das in der Anbieterseite nachsieht.
//
// Es sucht nicht die ganze Seite ab, sondern geht von der Cloudflare-Abfrage
// aus nach oben: sie ist der seltene, eindeutige Anker. Was darueber liegt,
// ist der Dialog, und darin steht der Knopf.
function torScript(maxKlicks = 3) {
  return `(() => {
  const MARKE = "__elfixTorKlicks";
  const istFreigegebenesTor = ${istFreigegebenesTor.toString()};
  const nein = ${nein.toString()};
  const WEITER_MUSTER = ${WEITER_MUSTER.toString()};
  const SCHLIESSEN_MUSTER = ${SCHLIESSEN_MUSTER.toString()};

  const bisher = Number(document.documentElement.dataset[MARKE] || 0);
  if (bisher >= ${Number(maxKlicks) || 3}) return "";
  // Nicht zweimal im selben Atemzug: nach dem Klick braucht die Seite einen
  // Moment, und der Autostart fragt im Sekundentakt nach.
  const zuletzt = Number(document.documentElement.dataset.elfixTorZeit || 0);
  if (Date.now() - zuletzt < 3000) return "";

  const sichtbar = (el) => {
    if (!el) return false;
    try {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity || 1) > 0.05 && r.width > 40 && r.height > 40;
    } catch (_) { return false; }
  };
  const text = (el) => String((el && (el.innerText || el.textContent || el.value || el.getAttribute("aria-label") || el.title)) || "").replace(/\\s+/g, " ").trim();

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

  // Hat Cloudflare die Abfrage abgesegnet? Das Feld traegt dann ein Token.
  const feld = kasten.querySelector('input[name="cf-turnstile-response"], input[name="g-recaptcha-response"]');
  const geloest = feld ? Boolean(String(feld.value || "").trim()) : null;

  const urteil = istFreigegebenesTor({
    sichtbar: sichtbar(kasten),
    hatVerifizierung: true,
    knopfText: text(knopf),
    knopfDeaktiviert: Boolean(knopf.disabled) || knopf.getAttribute("aria-disabled") === "true" || knopf.classList.contains("disabled"),
    geloest
  });
  if (!urteil.klicken) return "tor-gewartet:" + urteil.grund;

  document.documentElement.dataset[MARKE] = String(bisher + 1);
  document.documentElement.dataset.elfixTorZeit = String(Date.now());
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
    return "tor-fehler:" + String(fehler && fehler.message);
  }
  return "tor-geklickt:" + text(knopf).slice(0, 24) + ":" + urteil.grund;
})()`;
}

module.exports = {
  WEITER_MUSTER,
  SCHLIESSEN_MUSTER,
  istFreigegebenesTor,
  torScript
};
