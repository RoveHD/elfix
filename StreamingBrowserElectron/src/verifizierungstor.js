"use strict";

const WEITER_MUSTER = /^(weiter(?!e)|continue|fortfahren|proceed|zum stream|jetzt ansehen|jetzt starten|watch now|play now)\b/i;
const SCHLIESSEN_MUSTER = /(schliess|schließ|close|abbrech|cancel|zurueck|zurück|nein danke|ablehnen|x)$/i;
const TOR_MELDUNG = "__elfix:tor:";

function istFreigegebenesTor(kandidat) {
  const k = kandidat || {};
  if (!k.sichtbar) return { klicken: false, grund: "Fenster nicht sichtbar" };
  if (!k.hatVerifizierung) return { klicken: false, grund: "keine Verifizierung im Fenster" };
  if (!k.knopfText || SCHLIESSEN_MUSTER.test(k.knopfText) || !WEITER_MUSTER.test(k.knopfText)) {
    return { klicken: false, grund: "kein Weiter-Knopf" };
  }
  if (k.geloest !== true) return { klicken: false, grund: "Bestätigung erforderlich" };
  if (k.knopfDeaktiviert) return { klicken: false, grund: "Knopf ist noch gesperrt" };
  return { klicken: true, grund: "Verifizierung bestanden" };
}

// Laeuft unveraendert im Dokument. Keine Abfrage des fremden Challenge-Iframes:
// nur das von der Seite bereitgestellte Ergebnisfeld wird gelesen.
function toreLesen() {
  const sichtbar = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (r.width <= 0 || r.height <= 0 || s.visibility === "hidden" || s.visibility === "collapse") return false;
    for (let p = el; p; p = p.parentElement) {
      const stil = getComputedStyle(p);
      if (stil.display === "none" || Number(stil.opacity) === 0) return false;
    }
    return true;
  };
  const wort = (el) => String(el.innerText || el.textContent || el.value || "").trim();
  const weiter = /^(weiter(?!e)|continue|fortfahren|proceed|zum stream|jetzt ansehen|jetzt starten|watch now|play now)\b/i;
  const kandidaten = Array.from(document.querySelectorAll(
    '.cf-turnstile, .h-captcha, .g-recaptcha, iframe[src*="challenges.cloudflare.com"],'
    + ' iframe[src*="hcaptcha.com"], iframe[src*="recaptcha"], #challenge-form, #challenge-running, #cf-please-wait'));
  const gesehen = new Set();
  const tore = [];
  // Statusmeldungen duerfen ein spaeter im DOM stehendes Checkbox-Widget
  // nicht verdecken. Der eigentliche Verifizierungskasten hat Vorrang.
  kandidaten.sort((a, b) => Number(a.matches('#challenge-form,#challenge-running,#cf-please-wait'))
    - Number(b.matches('#challenge-form,#challenge-running,#cf-please-wait')));
  for (const abfrage of kandidaten) {
    let kasten = abfrage;
    let knopf = null;
    for (let el = abfrage.parentElement, tiefe = 0; el && el !== document.body && tiefe < 6; el = el.parentElement, tiefe++) {
      const kandidat = Array.from(el.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"],a[href="#"],a:not([href])'))
        .find((b) => sichtbar(b) && weiter.test(wort(b)));
      if (sichtbar(el) && kandidat && (/video wird vorbereitet|stream wird vorbereitet|preparing (?:your )?video/i.test(wort(el))
        || el.matches('dialog,[role="dialog"],.modal-content'))) {
        kasten = el;
        knopf = kandidat;
        break;
      }
    }
    if (!sichtbar(kasten)) continue;
    if (gesehen.has(kasten)) continue;
    gesehen.add(kasten);
    const feldBereich = kasten === abfrage ? abfrage.parentElement : kasten;
    const feld = feldBereich?.querySelector('input[name="cf-turnstile-response"],input[name="g-recaptcha-response"],textarea[name="g-recaptcha-response"],textarea[name="h-captcha-response"],input[name="h-captcha-response"]');
    const geloest = Boolean(feld && String(feld.value || "").trim());
    // Ein geloestes Widget kann im DOM bleiben. Ein Weiter-Fenster bleibt
    // offen, bis die Seite den bestaetigten Klick verarbeitet.
    tore.push({ kasten, knopf, geloest });
  }
  return tore;
}

function zustandScript() {
  return "(() => { const tore = (" + toreLesen.toString() + ")();"
    + "const geloest = tore.length > 0 && tore.every(t => t.geloest);"
    + "const wartet = /just a moment|attention required|checking your browser|verify you are human|einen augenblick|sicherheitsabfrage/i.test(document.title || '');"
    + "return { offen: tore.some(t => !t.geloest || t.knopf) || (!geloest && wartet), geloest }; })()";
}

// Nur der originale Verifizierungskasten wird sichtbar. DOM, Iframe und
// Sitzung bleiben erhalten; kein zweiter Abruf verbraucht einen Redirect-Link.
function fensterScript(anzeigen = true) {
  return "(() => {"
    + "const kenn = 'data-elfix-verifizierung';"
    + "document.getElementById('__elfixVerifizierungStil')?.remove();"
    + "document.querySelectorAll('[' + kenn + ']').forEach(el => el.removeAttribute(kenn));"
    + (anzeigen ? "" : "return false;")
    + "const tor = (" + toreLesen.toString() + ")().find(t => !t.geloest || t.knopf); if (!tor) return false;"
    + "tor.kasten.setAttribute(kenn, '');"
    + "const stil = document.createElement('style'); stil.id = '__elfixVerifizierungStil';"
    + "stil.textContent = " + JSON.stringify(
      "html,body { background: transparent !important; overflow: hidden !important; }"
      + "body * { visibility: hidden !important; }"
      + "[data-elfix-verifizierung],[data-elfix-verifizierung] * { visibility: visible !important; }"
      + "[data-elfix-verifizierung] { position: fixed !important; inset: 0 auto auto 0 !important; transform: none !important; margin: 0 !important; width: 100% !important; max-width: 100% !important; max-height: 100vh !important; box-sizing: border-box !important; overflow: auto !important; z-index: 2147483647 !important; }")
    + "; (document.head || document.documentElement).appendChild(stil); return { height: Math.ceil(tor.kasten.getBoundingClientRect().height) }; })()";
}

function torScript(maxKlicks = 4, beobachten = true) {
  return "(() => {"
    + "const KENN = '__elfixTorV2';" + (beobachten ? "if (window[KENN]) return window[KENN].pruefen();" : "")
    + "const toreLesen = " + toreLesen.toString() + ";"
    + "const istFreigegebenesTor = " + istFreigegebenesTor.toString() + ";"
    + "const WEITER_MUSTER = " + WEITER_MUSTER.toString() + ";"
    + "const SCHLIESSEN_MUSTER = " + SCHLIESSEN_MUSTER.toString() + ";"
    + "const MELDUNG = " + JSON.stringify(TOR_MELDUNG) + ";"
    + "const MAX = " + Math.max(1, Math.min(10, Number(maxKlicks) || 4)) + ";"
    + "let klicks = 0; let letzteMeldung = ''; let geklickt = new WeakSet();"
    + "const melde = (nachricht) => { if (nachricht !== letzteMeldung) { letzteMeldung = nachricht; console.log(MELDUNG + nachricht); } return nachricht; };"
    + "const pruefen = () => { const tore = toreLesen().filter(t => !t.geloest || t.knopf);"
    + "if (!tore.length) { geklickt = new WeakSet(); return melde('tor-frei'); }"
    + "for (const tor of tore) { const b = tor.knopf;"
    + "const urteil = istFreigegebenesTor({ sichtbar: true, hatVerifizierung: true, geloest: tor.geloest,"
    + "knopfText: b && (b.innerText || b.textContent || b.value || '').trim(),"
    + "knopfDeaktiviert: !b || b.disabled || b.getAttribute('aria-disabled') === 'true' || b.classList.contains('disabled') });"
    + "if (urteil.klicken && klicks < MAX && !geklickt.has(b)) { geklickt.add(b); klicks++; b.click(); return melde('tor-geklickt:Weiter:Verifizierung bestanden'); } }"
    + "return melde('tor-gewartet:Bestätigung erforderlich'); };"
    + (beobachten ? "" : "return pruefen(); })()")
    + (beobachten ? ""
    + "window[KENN] = { pruefen };"
    + "const beobachter = new MutationObserver(pruefen);"
    + "beobachter.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'disabled', 'aria-disabled', 'value', 'hidden'] });"
    // .value-Aenderungen loesen keinen MutationObserver aus.
    + "const uhr = setInterval(pruefen, 300);"
    + "setTimeout(() => { clearInterval(uhr); beobachter.disconnect(); delete window[KENN]; }, 150000);"
    + "return pruefen(); })()" : "");
}

module.exports = { TOR_MELDUNG, WEITER_MUSTER, SCHLIESSEN_MUSTER, istFreigegebenesTor,
  toreLesen, zustandScript, fensterScript, torScript };
