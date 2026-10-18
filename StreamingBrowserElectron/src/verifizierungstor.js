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

// Die interaktive Anbieteransicht behaelt den ganzen mittleren Dialog,
// einschliesslich eines Weiter-Knopfs ausserhalb des eigentlichen Widgets.
// Separat vom schmalen Resolver-Tor: dessen Geometrie bleibt unveraendert.
function dialogMaskeScript(klickKennung = "", phase = "warten") {
  return `(() => {
    globalThis.__elfixAnbieterLaden = ${phase === "laden"};
    globalThis.__elfixAnbieterVorbereiten = ${phase === "vorbereiten"};
    if (globalThis.__elfixAnbieterMaskierung) return globalThis.__elfixAnbieterMaskierung();
    const maskieren = () => {
    const kenn = 'data-elfix-anbieterdialog';
    document.querySelectorAll('[' + kenn + ']').forEach(el => el.removeAttribute(kenn));
    let stil = document.getElementById('__elfixAnbieterMaske');
    if (!stil) {
      stil = document.createElement('style'); stil.id = '__elfixAnbieterMaske';
      stil.textContent = 'html,body{overflow:hidden!important;scrollbar-width:none!important}.modal,dialog,[role="dialog"]{scrollbar-width:none!important}'
        + 'html::-webkit-scrollbar,body::-webkit-scrollbar,.modal::-webkit-scrollbar,dialog::-webkit-scrollbar,[role="dialog"]::-webkit-scrollbar{display:none!important}'
        + '#__elfixAnbieterAbdeckung{position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important}'
        + '#__elfixAnbieterAbdeckung>div{position:absolute!important;background:#0b111a!important;opacity:1!important;pointer-events:auto!important;margin:0!important;padding:0!important;border:0!important}';
      (document.head || document.documentElement).appendChild(stil);
    }
    const abdeckung = document.getElementById('__elfixAnbieterAbdeckung') || document.createElement('div');
    abdeckung.id = '__elfixAnbieterAbdeckung';
    abdeckung.setAttribute('aria-hidden', 'true');
    const voll = document.createElement('div'); voll.style.cssText = 'inset:0!important';
    const ladeanzeige = () => {
      const phase = globalThis.__elfixAnbieterLaden ? 'laden' : 'warten';
      // Observer und Poll pruefen laufend weiter. Solange der Zustand gleich
      // bleibt, behalten DOM und Animation ihre laufende Instanz/Zeitachse.
      if (abdeckung.getAttribute('data-elfix-ladephase') === phase && abdeckung.querySelector('#__elfixAnbieterLaden')) return;
      abdeckung.setAttribute('data-elfix-ladephase', phase);
      abdeckung.replaceChildren(voll);
      const lade = document.createElement('span');
      lade.id = '__elfixAnbieterLaden';
      lade.style.cssText = 'position:absolute!important;inset:0!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:20px!important;color:#eef4fc!important;font:600 20px "Segoe UI",sans-serif!important;';
      const titel = document.createElement('span');
      titel.textContent = globalThis.__elfixAnbieterLaden ? 'Video wird geladen …' : 'Bestätigung wird vorbereitet …';
      const balken = document.createElement('span');
      balken.style.cssText = 'display:block!important;width:300px!important;max-width:80vw!important;height:4px!important;background:#223245!important;border-radius:4px!important;overflow:hidden!important;';
      const fortschritt = document.createElement('span');
      fortschritt.style.cssText = 'display:block!important;width:38%!important;height:100%!important;background:#a4c7ef!important;border-radius:4px!important;';
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) fortschritt.animate([{transform:'translateX(-100%)'},{transform:'translateX(365%)'}], {duration:1350,iterations:Infinity,easing:'ease-in-out'});
      balken.appendChild(fortschritt); lade.append(titel,balken); abdeckung.appendChild(lade);
    };
    if (!abdeckung.isConnected) {
      abdeckung.appendChild(voll);
      document.documentElement.appendChild(abdeckung);
    }
    const sichtbar = el => {
      if (!el?.isConnected) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      for (let p = el; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      }
      return true;
    };
    const vorbereitet = el => /(?:video|stream) wird vorbereitet|preparing (?:your )?(?:video|stream)/i.test(String(el.innerText || el.textContent || ''));
    const weiter = el => Array.from(el.querySelectorAll('button,a,input[type="submit"],input[type="button"]'))
      .some(knopf => sichtbar(knopf) && /^(weiter|continue)(?:\\b|$)/i.test(String(knopf.innerText || knopf.value || '').trim()));
    const begrenzt = el => {
      const r = el.getBoundingClientRect();
      return el !== document.body && el !== document.documentElement && r.width > 0 && r.height > 0
        && r.width <= 900 && r.height <= Math.max(900, innerHeight)
        && (r.width < innerWidth * .96 || r.height < innerHeight * .8);
    };
    const dialogKontext = el => {
      if (el.matches('main,article,nav,aside,header,footer')) return false;
      if (el.closest('dialog,[role="dialog"],.modal,.modal-content,#playerPrepareModal')) return true;
      for (let p = el; p && p !== document.body; p = p.parentElement) {
        if (['fixed','absolute'].includes(getComputedStyle(p).position)) return true;
      }
      return false;
    };
    // S.to setzt Turnstile/Altcha in einen neutralen Container (ggf. ShadowDOM).
    // Der echte Titel und Weiter liegen trotzdem im originalen modal-content.
    let kasten = Array.from(document.querySelectorAll('.modal-content,dialog,[role="dialog"]'))
      .filter(el => sichtbar(el) && begrenzt(el) && vorbereitet(el) && weiter(el))
      .sort((a,b) => a.getBoundingClientRect().width*a.getBoundingClientRect().height-b.getBoundingClientRect().width*b.getBoundingClientRect().height)[0];
    if (!kasten) {
      for (const titel of document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],.modal-title')) {
        if (!sichtbar(titel) || !vorbereitet(titel)) continue;
        for (let el = titel.parentElement; el && el !== document.body; el = el.parentElement) {
          if (sichtbar(el) && begrenzt(el) && dialogKontext(el) && weiter(el)) { kasten = el; break; }
        }
        if (kasten) break;
      }
    }
    if (!kasten) {
      const tore = (${toreLesen.toString()})();
      const tor = tore.find(t => t.blockierend && begrenzt(t.kasten));
      kasten = tor?.kasten;
    }
    if (!kasten) {
      globalThis.__elfixAnbieterDialog = null;
      ladeanzeige();
      return { bereit: true };
    }
    for (let el = kasten; el && el !== document.body; el = el.parentElement) {
      if (begrenzt(el) && weiter(el) && el.matches('dialog,[role="dialog"],.modal-content')) { kasten = el; break; }
    }
    const r = kasten.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    globalThis.__elfixAnbieterDialog = kasten;
    if (!globalThis.__elfixAnbieterWeiterBeobachter) {
      globalThis.__elfixAnbieterWeiterBeobachter = true;
      document.addEventListener('click', event => {
        const knopf = event.target?.closest?.('button,a,input[type="submit"],input[type="button"]');
        if (event.isTrusted && knopf && globalThis.__elfixAnbieterDialog?.contains(knopf)
          && /^(weiter|continue)(?:\\b|$)/i.test(String(knopf.innerText || knopf.value || '').trim())) {
          console.log(${JSON.stringify(klickKennung)} + ':' + Date.now());
          globalThis.__elfixAnbieterWeiterPruefung = globalThis.__elfixAnbieterPruefung;
          globalThis.__elfixAnbieterLaden = true;
          globalThis.__elfixAnbieterMaskierung();
        }
      }, true);
    }
    kasten.setAttribute(kenn, '');
    // Vier undurchsichtige Flaechen liegen auf der echten Seite. Das Loch
    // folgt dem Originaldialog; dessen DOM, Position und Stil bleiben erhalten.
    const neu = kasten.getBoundingClientRect();
    const links = Math.max(0, Math.min(innerWidth, neu.left));
    const rechts = Math.max(links, Math.min(innerWidth, neu.right));
    const oben = Math.max(0, Math.min(innerHeight, neu.top));
    const unten = Math.max(oben, Math.min(innerHeight, neu.bottom));
    const fehler = kasten.querySelector('#player-prepare-error,[role="alert"],.alert-danger');
    const pruefung = Array.from(kasten.querySelectorAll('#player-prepare-turnstile,#player-prepare-altcha,.cf-turnstile,.h-captcha,.g-recaptcha'))
      .filter(el => { const s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'; }).map(el => el.id || el.className).join('|');
    const fehlerText = fehler && getComputedStyle(fehler).display !== 'none' ? String(fehler.innerText || fehler.textContent || '').trim() : '';
    globalThis.__elfixAnbieterPruefung = pruefung;
    if (fehlerText || (globalThis.__elfixAnbieterLaden && globalThis.__elfixAnbieterWeiterPruefung
      && pruefung && pruefung !== globalThis.__elfixAnbieterWeiterPruefung)) globalThis.__elfixAnbieterLaden = false;
    const stand = { bereit: true, left: neu.left, top: neu.top, width: neu.width, height: neu.height, weiter: weiter(kasten),
      viewportWidth: innerWidth, viewportHeight: innerHeight, fehler: fehlerText, pruefung };
    if (globalThis.__elfixAnbieterLaden || globalThis.__elfixAnbieterVorbereiten) { ladeanzeige(); return stand; }
    abdeckung.removeAttribute('data-elfix-ladephase');
    abdeckung.replaceChildren();
    for (const [x,y,w,h] of [[0,0,innerWidth,oben],[0,unten,innerWidth,innerHeight-unten],
      [0,oben,links,unten-oben],[rechts,oben,innerWidth-rechts,unten-oben]]) {
      const flaeche = document.createElement('div');
      flaeche.style.cssText = 'left:'+x+'px!important;top:'+y+'px!important;width:'+w+'px!important;height:'+h+'px!important';
      abdeckung.appendChild(flaeche);
    }
    // Auch die Ecken ausserhalb der originalen Rundung abdecken, ohne
    // den Dialog oder seine interaktiven Inhalte zu veraendern.
    const rundung = document.createElement('span');
    rundung.style.cssText = 'position:absolute!important;pointer-events:none!important;background:transparent!important;'
      + 'left:'+neu.left+'px!important;top:'+neu.top+'px!important;width:'+neu.width+'px!important;height:'+neu.height+'px!important;'
      + 'border-radius:'+getComputedStyle(kasten).borderRadius+'!important;'
      + 'box-shadow:0 0 0 '+Math.max(innerWidth,innerHeight)+'px #0b111a!important;';
    abdeckung.appendChild(rundung);
    return stand;
    };
    globalThis.__elfixAnbieterMaskierung = maskieren;
    // DOM-Umbauten, Dialogschluss und Groessenaenderungen werden vor dem
    // naechsten Paint maskiert, nicht erst beim 400-ms-Hauptprozess-Poll.
    const beobachter = new MutationObserver(maskieren);
    if (document.body) beobachter.observe(document.body, { childList: true, subtree: true,
      attributes: true, attributeFilter: ['class','style','hidden','open'] });
    addEventListener('resize', maskieren);
    addEventListener('scroll', maskieren, true);
    return maskieren();
  })()`;
}

module.exports = { TOR_MELDUNG, toreLesen, zustandScript, fensterScript, torScript, dialogMaskeScript };
