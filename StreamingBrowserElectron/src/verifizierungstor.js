"use strict";

const TOR_MELDUNG = "__elfix:tor:";

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
    let dialogKontext = false;
    for (let el = abfrage.parentElement, tiefe = 0; el && el !== document.body && tiefe < 6; el = el.parentElement, tiefe++) {
      if (sichtbar(el) && (/video wird vorbereitet|stream wird vorbereitet|preparing (?:your )?video/i.test(wort(el))
        || el.matches('dialog,[role="dialog"],.modal-content,#challenge-form'))) {
        kasten = el;
        dialogKontext = true;
        break;
      }
    }
    if (!sichtbar(kasten)) continue;
    if (gesehen.has(kasten)) continue;
    gesehen.add(kasten);
    const feldBereich = kasten === abfrage ? abfrage.parentElement : kasten;
    const feld = feldBereich?.querySelector('input[name="cf-turnstile-response"],input[name="g-recaptcha-response"],textarea[name="g-recaptcha-response"],textarea[name="h-captcha-response"],input[name="h-captcha-response"]');
    const geloest = Boolean(feld && String(feld.value || "").trim());
    const r = kasten.getBoundingClientRect();
    const grosseFlaeche = r.width >= Math.min(520, innerWidth * 0.65) && r.height >= Math.min(220, innerHeight * 0.35);
    const festerMarker = abfrage.matches('#challenge-form,#challenge-running,#cf-please-wait');
    tore.push({ kasten, geloest, blockierend: festerMarker || dialogKontext || grosseFlaeche });
  }
  return tore;
}

function zustandScript() {
  return "(() => { const tore = (" + toreLesen.toString() + ")();"
    + "const wartet = /just a moment|attention required|checking your browser|verify you are human|einen augenblick|sicherheitsabfrage/i.test(document.title || '');"
    + "const aktive = tore.filter(t => t.blockierend || wartet);"
    + "const geloest = aktive.length > 0 && aktive.every(t => t.geloest);"
    + "return { offen: aktive.length > 0 || (!geloest && wartet), geloest }; })()";
}

// Nur der originale Verifizierungskasten wird sichtbar. DOM, Iframe und
// Sitzung bleiben erhalten; kein zweiter Abruf verbraucht einen Redirect-Link.
function fensterScript(anzeigen = true) {
  return "(() => {"
    + "const kenn = 'data-elfix-verifizierung';"
    + "document.getElementById('__elfixVerifizierungStil')?.remove();"
    + "document.querySelectorAll('[' + kenn + ']').forEach(el => el.removeAttribute(kenn));"
    + (anzeigen ? "" : "return false;")
    + "const tore = (" + toreLesen.toString() + ")();"
    + "const wartet = /just a moment|attention required|checking your browser|verify you are human|einen augenblick|sicherheitsabfrage/i.test(document.title || '');"
    + "const tor = tore.find(t => t.blockierend) || (wartet ? tore[0] : null); if (!tor) return false;"
    + "tor.kasten.setAttribute(kenn, '');"
    + "const stil = document.createElement('style'); stil.id = '__elfixVerifizierungStil';"
    + "stil.textContent = " + JSON.stringify(
      "html,body { background: transparent !important; overflow: hidden !important; }"
      + "body * { visibility: hidden !important; }"
      + "[data-elfix-verifizierung],[data-elfix-verifizierung] * { visibility: visible !important; }"
      + "[data-elfix-verifizierung] { position: fixed !important; inset: 0 auto auto 0 !important; transform: none !important; margin: 0 !important; width: 100% !important; max-width: 100% !important; max-height: 100vh !important; box-sizing: border-box !important; overflow: auto !important; z-index: 2147483647 !important; }")
    + "; (document.head || document.documentElement).appendChild(stil); return { height: Math.ceil(tor.kasten.getBoundingClientRect().height) }; })()";
}

function torScript(_maxKlicks = 4, beobachten = true) {
  return "(() => {"
    + "const KENN = '__elfixTorV2';" + (beobachten ? "if (window[KENN]) return window[KENN].pruefen();" : "")
    + "const toreLesen = " + toreLesen.toString() + ";"
    + "const MELDUNG = " + JSON.stringify(TOR_MELDUNG) + ";"
    + "let letzteMeldung = '';"
    + "const melde = (nachricht) => { if (nachricht !== letzteMeldung) { letzteMeldung = nachricht; console.log(MELDUNG + nachricht); } return nachricht; };"
    + "const pruefen = () => { const tore = toreLesen();"
    + "const wartet = /just a moment|attention required|checking your browser|verify you are human|einen augenblick|sicherheitsabfrage/i.test(document.title || '');"
    + "const aktive = tore.filter(t => t.blockierend || wartet);"
    + "if (!aktive.length && !wartet) return melde('tor-frei');"
    + "if (aktive.length && aktive.every(t => t.geloest)) return melde('tor-bestaetigt:Serverfreigabe wird abgewartet');"
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

module.exports = { TOR_MELDUNG, toreLesen, zustandScript, fensterScript, torScript };
