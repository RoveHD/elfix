"use strict";

// Die Fernbedienung, wie sie im Handy aussieht.
//
// Als Zeichenkette in einer .js-Datei und nicht als .html daneben: das README
// sagt beim Aktualisieren des Relays "alle .js-Dateien kopieren", und eine
// einzelne HTML-Datei waere genau die, die dabei jedes Mal liegenbliebe. Dann
// liefe der Dienst mit neuem Code und alter Seite.
//
// Alles in einem Stueck - kein Stylesheet, kein Skript von aussen. Die Seite
// laedt oft ueber Mobilfunk, und sie soll auch dann sofort dastehen.

const SEITE = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#070a10">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.png" sizes="512x512" type="image/png">
<!-- Die Angabe, nach der Chrome ausdruecklich fragt. Die Apple-Fassung darunter
     ist veraltet, aber iOS kennt bis heute nichts anderes. -->
<meta name="mobile-web-app-capable" content="yes">
<link rel="apple-touch-icon" href="icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="ELFIX">
<title>ELFIX Fernbedienung</title>
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    margin: 0; min-height: 100dvh; padding: 20px 18px calc(20px + env(safe-area-inset-bottom));
    background: #070a10; color: #eef2f8;
    font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
    display: flex; flex-direction: column; gap: 18px;
  }
  h1 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #7c8798; }
  .karte { background: #101725; border: 1px solid #1e2838; border-radius: 16px; padding: 18px; }
  .titel { font-size: 19px; font-weight: 700; line-height: 1.25; }
  .folge { margin-top: 4px; color: #8b97a9; font-size: 14px; }
  .balken { margin-top: 14px; height: 5px; border-radius: 3px; background: #1e2838; overflow: hidden; }
  .balken div { height: 100%; width: 0; background: #3ea6ff; transition: width .4s linear; }
  .zeit { margin-top: 8px; display: flex; justify-content: space-between; color: #6f7b8c; font-size: 13px; font-variant-numeric: tabular-nums; }
  .raster { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  button {
    appearance: none; border: 1px solid #24304a; border-radius: 14px;
    background: #151d2c; color: #eef2f8;
    font: 600 15px/1.2 system-ui, sans-serif; padding: 20px 8px; cursor: pointer;
    display: flex; flex-direction: column; align-items: center; gap: 7px;
  }
  button:active { background: #1d2740; transform: scale(.97); }
  button .zeichen { font-size: 23px; line-height: 1; }
  button.gross { grid-column: span 3; background: #3ea6ff; border-color: #3ea6ff; color: #06101d; font-size: 17px; }
  button.gross:active { background: #62b6ff; }
  button[disabled] { opacity: .4; }
  .kopf { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  button.klein {
    padding: 8px 12px; border-radius: 10px; font-size: 13px; font-weight: 600;
    flex-direction: row; gap: 6px; background: #151d2c;
  }
  .liste { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
  .liste button {
    display: block; text-align: left; padding: 13px 14px; width: 100%;
    font-weight: 600; font-size: 15px;
  }
  .liste .unten { margin-top: 5px; color: #8b97a9; font-size: 13px; font-weight: 500; }
  .liste .streifen { margin-top: 8px; height: 3px; border-radius: 2px; background: #24304a; overflow: hidden; }
  .liste .streifen div { height: 100%; background: #3ea6ff; }
  .leer { color: #6f7b8c; font-size: 14px; text-align: center; padding: 10px 0; }
  details { border: 1px solid #1e2838; border-radius: 12px; background: #101725; padding: 12px 14px; }
  summary { cursor: pointer; color: #8b97a9; font-size: 14px; }
  details ul { margin: 12px 0 0; padding-left: 20px; color: #8b97a9; font-size: 13px; line-height: 1.5; }
  details li.ja::marker { content: "✓ "; color: #62d19a; }
  details li.nein::marker { content: "✗ "; color: #ff8a8a; }
  details li.nein { color: #ffb3b3; }
  .zustand { text-align: center; color: #8b97a9; font-size: 14px; min-height: 20px; }
  .zustand.fehler { color: #ff8a8a; }
  form { display: flex; flex-direction: column; gap: 12px; }
  input {
    width: 100%; padding: 16px; border-radius: 14px; border: 1px solid #24304a;
    background: #0c1320; color: #eef2f8; font: 700 22px/1 ui-monospace, monospace;
    text-align: center; letter-spacing: .18em; text-transform: uppercase;
  }
  .hinweis { color: #6f7b8c; font-size: 13px; text-align: center; }
  .weg { display: none; }
</style>
</head>
<body>
<h1>ELFIX</h1>
<button id="installieren" class="weg" style="width:100%">
  <span class="zeichen">⤓</span>Als App installieren
</button>
<div class="zustand" id="installZustand"></div>
<details id="installWarum" class="weg">
  <summary>Warum geht „Installieren“ nicht?</summary>
  <ul id="installPruefung"></ul>
</details>

<form id="koppeln">
  <div class="karte">
    <div class="titel">Verbinden</div>
    <div class="folge">Der Code steht am Rechner unter Einstellungen &rsaquo; Fernbedienung.</div>
    <input id="code" inputmode="latin" autocapitalize="characters" autocomplete="off"
           spellcheck="false" maxlength="9" placeholder="ABCD1234" aria-label="Kopplungscode">
  </div>
  <button class="gross" type="submit">Verbinden</button>
  <div class="zustand" id="kopplungsZustand"></div>
</form>

<div id="steuerung" class="weg">
  <div class="karte">
    <div class="titel" id="titel">Nichts geöffnet</div>
    <div class="folge" id="folge"></div>
    <div class="balken"><div id="fortschritt"></div></div>
    <div class="zeit"><span id="jetzt">–</span><span id="rest"></span></div>
  </div>

  <div class="raster" style="margin-top:18px">
    <button data-befehl="zurueck"><span class="zeichen">⏪</span>10 s</button>
    <button data-befehl="umschalten" id="spielen"><span class="zeichen">⏯</span>Pause</button>
    <button data-befehl="vor"><span class="zeichen">⏩</span>30 s</button>
    <button data-befehl="vorherige"><span class="zeichen">⏮</span>Vorherige</button>
    <button data-befehl="vollbild"><span class="zeichen">⛶</span>Vollbild</button>
    <button data-befehl="naechste"><span class="zeichen">⏭</span>Nächste</button>
    <button data-befehl="leiser"><span class="zeichen">🔉</span>Leiser</button>
    <button data-befehl="stumm"><span class="zeichen">🔇</span>Ton aus</button>
    <button data-befehl="lauter"><span class="zeichen">🔊</span>Lauter</button>
  </div>
  <div class="zustand" id="zustand" style="margin-top:16px"></div>

  <div class="karte" style="margin-top:18px">
    <div class="kopf">
      <div class="titel" style="font-size:16px">Weiterschauen</div>
      <button class="klein" id="listeHolen" type="button">Aktualisieren</button>
    </div>
    <div id="liste" class="liste"></div>
  </div>
</div>

<script>
(() => {
  const adresse = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
  const $ = (id) => document.getElementById(id);
  let socket = null;
  // Aus dem QR-Code: wer ihn scannt, hat den Code schon in der Adresse und
  // soll nichts mehr abtippen.
  const ausAdresse = (new URLSearchParams(location.search).get("code") || "")
    .toUpperCase().replace(/[^0-9A-Z]/g, "");
  let code = ausAdresse.length === 8 ? ausAdresse : (localStorage.getItem("elfix-fern-code") || "");
  let gekoppelt = false;

  // Und gleich wieder aus der Adresse heraus. Der Code ist ein Geheimnis; im
  // Verlauf des Browsers und in der Adresszeile hat er nichts verloren, und
  // beim Teilen des Links ginge er sonst mit.
  if (ausAdresse && history.replaceState) {
    history.replaceState(null, "", location.pathname);
  }

  const zeit = (sekunden) => {
    const s = Math.max(0, Math.round(sekunden || 0));
    const std = Math.floor(s / 3600);
    const min = Math.floor((s % 3600) / 60);
    const sek = s % 60;
    const zwei = (n) => String(n).padStart(2, "0");
    return std ? std + ":" + zwei(min) + ":" + zwei(sek) : min + ":" + zwei(sek);
  };

  const melden = (text, fehler) => {
    const feld = gekoppelt ? $("zustand") : $("kopplungsZustand");
    feld.textContent = text || "";
    feld.className = "zustand" + (fehler ? " fehler" : "");
  };

  const zeigen = (stand) => {
    $("titel").textContent = stand.titel || "Nichts geöffnet";
    $("folge").textContent = stand.folge || "";
    const anteil = stand.dauer > 0 ? Math.min(100, (stand.position / stand.dauer) * 100) : 0;
    $("fortschritt").style.width = anteil + "%";
    $("jetzt").textContent = stand.dauer > 0 ? zeit(stand.position) : "–";
    $("rest").textContent = stand.dauer > 0 ? "noch " + zeit(stand.dauer - stand.position) : "";
    $("spielen").lastChild.textContent = stand.laeuft ? "Pause" : "Weiter";
    melden("");
  };

  const verbinden = () => {
    if (!code) return;
    socket = new WebSocket(adresse);
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "fnhier", code }));
    };
    socket.onmessage = (ereignis) => {
      let nachricht;
      try { nachricht = JSON.parse(ereignis.data); } catch (_) { return; }
      if (nachricht.type === "fnda") {
        gekoppelt = true;
        localStorage.setItem("elfix-fern-code", code);
        $("koppeln").classList.add("weg");
        $("steuerung").classList.remove("weg");
        melden("Verbunden");
        listeHolen();
        return;
      }
      if (nachricht.type === "fnfehler") {
        // Passt der Code nicht, ist das gemerkte Geheimnis wertlos - sonst
        // versucht die Seite es bei jedem Laden weiter.
        localStorage.removeItem("elfix-fern-code");
        code = "";
        gekoppelt = false;
        $("koppeln").classList.remove("weg");
        $("steuerung").classList.add("weg");
        melden(nachricht.message || "Das hat nicht geklappt", true);
        return;
      }
      if (nachricht.type === "fnstand") zeigen(nachricht);
      if (nachricht.type === "fnliste") listeZeigen(nachricht.eintraege || []);
      if (nachricht.type === "fnweg") melden("ELFIX ist gerade zu", true);
    };
    socket.onclose = () => {
      socket = null;
      if (gekoppelt) melden("Verbindung weg — versuche es weiter", true);
      // Immer wieder versuchen: ein Handy schlaeft ein, sobald man es weglegt,
      // und soll beim Aufwachen einfach wieder da sein.
      setTimeout(verbinden, 2000);
    };
  };

  const listeZeigen = (eintraege) => {
    const feld = $("liste");
    feld.replaceChildren();
    if (!eintraege.length) {
      const leer = document.createElement("div");
      leer.className = "leer";
      leer.textContent = "Nichts angefangen.";
      feld.appendChild(leer);
      return;
    }
    for (const eintrag of eintraege) {
      const knopf = document.createElement("button");
      knopf.type = "button";
      knopf.textContent = eintrag.titel;
      if (eintrag.folge) {
        const unten = document.createElement("div");
        unten.className = "unten";
        unten.textContent = eintrag.folge;
        knopf.appendChild(unten);
      }
      if (eintrag.anteil > 0) {
        const streifen = document.createElement("div");
        streifen.className = "streifen";
        const fuellung = document.createElement("div");
        fuellung.style.width = Math.min(100, eintrag.anteil) + "%";
        streifen.appendChild(fuellung);
        knopf.appendChild(streifen);
      }
      knopf.addEventListener("click", () => {
        if (!socket || socket.readyState !== 1) return;
        socket.send(JSON.stringify({ type: "fnoeffnen", key: eintrag.key }));
        melden("Wird geöffnet …");
        if (navigator.vibrate) navigator.vibrate(12);
      });
      feld.appendChild(knopf);
    }
  };

  const listeHolen = () => {
    if (!socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify({ type: "fnliste" }));
  };
  $("listeHolen").addEventListener("click", listeHolen);

  $("koppeln").addEventListener("submit", (ereignis) => {
    ereignis.preventDefault();
    code = $("code").value.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (code.length !== 8) {
      melden("Acht Zeichen, so wie am Rechner", true);
      return;
    }
    melden("Verbinde …");
    if (socket) socket.close();
    else verbinden();
  });

  for (const knopf of document.querySelectorAll("[data-befehl]")) {
    knopf.addEventListener("click", () => {
      if (!socket || socket.readyState !== 1) {
        melden("Gerade keine Verbindung", true);
        return;
      }
      socket.send(JSON.stringify({ type: "fnbefehl", befehl: knopf.dataset.befehl }));
      // Ein kurzes Zucken als Quittung: die Antwort kommt erst mit dem
      // naechsten Stand, und bis dahin soll man wissen, dass es angekommen ist.
      if (navigator.vibrate) navigator.vibrate(12);
    });
  }

  // Wacht das Handy wieder auf, ist die Verbindung meist tot, ohne dass
  // jemand es gemerkt hat.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!socket || socket.readyState > 1) verbinden();
  });

  if (code) {
    $("code").value = code;
    verbinden();
  }

  // Als App auf dem Startbildschirm. Chrome bietet das von sich aus an, aber
  // gut versteckt im Menue - hier steht ein Knopf, sobald es moeglich ist.
  //
  // Und wenn es nicht moeglich ist, steht hier, warum. Das ist der eigentliche
  // Punkt: ohne diese Zeile passiert schlicht nichts, und wer die Seite dann
  // ueber "Zum Startbildschirm hinzufuegen" ablegt, bekommt eine Verknuepfung
  // mit Browserleiste und keine App - ohne je zu erfahren, woran es lag.
  let angebot = null;

  const alsApp = () => window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;

  const installLage = () => {
    const feld = $("installZustand");
    if (alsApp()) {
      $("installieren").classList.add("weg");
      $("installWarum").classList.add("weg");
      feld.textContent = "";
      return;
    }
    // Solange es nicht geht, steht die Auskunft bereit.
    $("installWarum").classList.toggle("weg", Boolean(angebot));
    if (angebot) {
      feld.textContent = "";
      return;
    }
    if (!window.isSecureContext) {
      // Der haeufigste Fall, und der unauffaelligste: ueber eine nackte IP im
      // WLAN gibt es keinen Service Worker und damit kein Installieren. Chrome
      // bietet dann nur "Zum Startbildschirm hinzufuegen" an - das ist eine
      // Verknuepfung, die im Browser mit Leiste aufgeht.
      feld.textContent = "Ohne https gibt es nur eine Verknüpfung. Öffne die Seite über deine Tunnel-Adresse, dann geht auch „Installieren“.";
      feld.className = "zustand fehler";
      return;
    }
    if (!("serviceWorker" in navigator)) {
      feld.textContent = "Dieser Browser kann keine Apps installieren. In Chrome oder Safari klappt es.";
      feld.className = "zustand fehler";
      return;
    }
    // Fehlt der Verweis aufs Manifest im Dokument, ist es nicht "noch nicht
    // geprueft", sondern entschieden: ohne ihn holt kein Browser ein Manifest
    // und bietet nichts an. Das kommt nicht von dieser Seite - sie liefert den
    // Verweis mit -, sondern von etwas, das ihn unterwegs entfernt.
    if (!document.querySelector('link[rel~="manifest" i]')) {
      feld.textContent = "Im Dokument fehlt der Verweis aufs Manifest — meist entfernt ihn ein Werbe- oder Inhaltsfilter. Schalte ihn für diese Seite ab und lade neu.";
      feld.className = "zustand fehler";
      return;
    }
    // Chrome prueft die Bedingungen erst, wenn der Service Worker steht - beim
    // allerersten Oeffnen ist das oft noch nicht so.
    feld.textContent = "Chrome prüft noch, ob es installieren kann. Meist erscheint der Knopf beim nächsten Öffnen.";
    feld.className = "zustand";
  };

  window.addEventListener("beforeinstallprompt", (ereignis) => {
    ereignis.preventDefault();
    angebot = ereignis;
    $("installieren").classList.remove("weg");
    installLage();
  });

  // Die Selbstauskunft. Chrome nennt seine Gruende nirgends, wo man sie am
  // Handy zu sehen bekaeme - also fragt die Seite jede Bedingung selbst ab und
  // schreibt hin, woran es haengt. Ohne das bleibt "es installiert nicht" eine
  // Sackgasse.
  let swFehler = "";
  const pruefen = async () => {
    // Gesammelt wird in einer eigenen Liste und erst am Ende eingesetzt. Die
    // Pruefung wartet zwischendurch auf das Netz; laeuft sie zweimal
    // nebeneinander - ein Tippen auf- und wieder zu genuegt -, schrieben sonst
    // beide Laeufe in dieselbe Liste, und die Zeilen stuenden doppelt da.
    const zeilen = [];
    const zeile = (ok, text) => {
      const li = document.createElement("li");
      li.className = ok ? "ja" : "nein";
      li.textContent = text;
      zeilen.push(li);
    };

    zeile(window.isSecureContext,
      window.isSecureContext
        ? "Sichere Verbindung (https)"
        : "Keine sichere Verbindung — über https öffnen, sonst geht nur eine Verknüpfung");

    const kann = "serviceWorker" in navigator;
    zeile(kann, kann ? "Browser kann Apps installieren" : "Dieser Browser kann keine Apps installieren");

    if (kann) {
      let reg = null;
      try {
        reg = await navigator.serviceWorker.getRegistration();
      } catch (fehler) {
        swFehler = String(fehler && fehler.message || fehler);
      }
      zeile(Boolean(reg && reg.active),
        reg && reg.active
          ? "Service Worker läuft"
          : "Service Worker läuft nicht" + (swFehler ? " (" + swFehler + ")" : ""));
    }

    // Steht im Dokument ueberhaupt ein Verweis aufs Manifest?
    //
    // Diese Zeile sieht ueberfluessig aus, weil die naechste das Manifest holt.
    // Sie ist es nicht: die naechste beweist nur, dass die Datei erreichbar
    // ist, und das ist etwas anderes als "der Browser kennt ein Manifest".
    // Ohne den Verweis im Dokument holt er es nie, prueft nichts und bietet
    // nichts an - waehrend ein Abruf von Hand tadellos gelingt.
    //
    // Gemessen an einem Geraet, an dem genau das passierte: jede andere Zeile
    // hier stand auf gruen, das Manifest kam per fetch mit 200 an, und
    // trotzdem war die Seite nicht installierbar. Im ausgelieferten HTML
    // fehlte das Link-Tag - ein systemweiter Inhaltsfilter hatte es unterwegs
    // entfernt und sein eigenes Skript eingesetzt. Auf anderen Geraeten
    // derselben Adresse war es da.
    //
    // Deshalb steht die Frage jetzt vor der anderen: sie unterscheidet
    // "Manifest erreichbar" von "Browser sieht ein Manifest", und nur die
    // zweite entscheidet ueber das Installieren.
    const verweis = document.querySelector('link[rel~="manifest" i]');
    zeile(Boolean(verweis),
      verweis
        ? "Die Seite verweist auf ihr Manifest"
        : "Im Dokument fehlt der Verweis aufs Manifest — meist entfernt ihn ein Werbe- oder Inhaltsfilter (etwa AdGuard, Blokada, ein Browser-Zusatz oder ein VPN mit Filterung). Ohne ihn bietet kein Browser das Installieren an. Filter für diese Seite abschalten und neu laden");

    try {
      const antwort = await fetch("manifest.webmanifest", { cache: "no-store" });
      const manifest = await antwort.json();
      zeile(antwort.ok && manifest.display === "standalone",
        antwort.ok ? "Manifest gelesen (" + manifest.display + ")" : "Manifest fehlt (" + antwort.status + ")");
      let symbole = 0;
      for (const symbol of manifest.icons || []) {
        const bild = await fetch(symbol.src, { method: "GET", cache: "no-store" }).catch(() => null);
        if (bild && bild.ok) symbole += 1;
      }
      zeile(symbole === (manifest.icons || []).length && symbole > 0,
        symbole + " von " + (manifest.icons || []).length + " Symbolen erreichbar");
    } catch (fehler) {
      zeile(false, "Manifest nicht lesbar: " + String(fehler && fehler.message || fehler));
    }

    // Bleibt das Angebot aus, sagt der Browser nirgends, warum. Zwei Faelle
    // lassen sich hier trotzdem auseinanderhalten: fehlt der Verweis oben,
    // ist der Grund bekannt und steht schon da. Sonst bleibt es bei der
    // allgemeinen Auskunft - was Chrome sonst noch abwaegt (wie oft die Seite
    // benutzt wurde, ob es die App schon gibt), ist aus der Seite heraus nicht
    // feststellbar, und dazu wird hier nichts behauptet.
    zeile(Boolean(angebot),
      angebot
        ? "Chrome bietet das Installieren an"
        : verweis
          ? "Chrome bietet es (noch) nicht an — bei erfülltem Rest hilft: Seite neu laden"
          : "Chrome bietet es nicht an — es fehlt der Verweis aufs Manifest, siehe oben");

    $("installPruefung").replaceChildren(...zeilen);
  };
  $("installWarum").addEventListener("toggle", () => {
    if ($("installWarum").open) pruefen();
  });
  $("installieren").addEventListener("click", async () => {
    if (!angebot) return;
    $("installieren").classList.add("weg");
    angebot.prompt();
    await angebot.userChoice.catch(() => {});
    angebot = null;
  });
  // Ist sie schon installiert, hat der Knopf nichts mehr zu tun.
  window.addEventListener("appinstalled", () => {
    angebot = null;
    $("installieren").classList.add("weg");
    installLage();
  });

  // Ohne Service Worker bietet Chrome das Installieren gar nicht erst an. Er
  // haelt ausserdem die Seite vor: eine Fernbedienung, die im Funkloch eine
  // Fehlerseite zeigt, waere schlimmer als eine, die sagt "keine Verbindung".
  if ("serviceWorker" in navigator) {
    // Der Fehler wird festgehalten und nicht verschluckt: scheitert die
    // Anmeldung, ist das der Grund fuers fehlende Installieren, und ohne die
    // Meldung sucht man ihn nie.
    navigator.serviceWorker.register("sw.js").catch((fehler) => {
      swFehler = String(fehler && fehler.message || fehler);
      installLage();
    });
  }
  installLage();
})();
</script>
</body>
</html>
`;

// Das Manifest. Ohne es gibt es kein "Zum Startbildschirm hinzufuegen", das
// wie eine App aussieht - nur ein Lesezeichen mit Browserleiste.
//
// start_url und scope tragen beide den Schraegstrich am Ende: der Service
// Worker liegt unter /fern/sw.js und hat damit den Geltungsbereich /fern/. Eine
// Startadresse ohne Schraegstrich laege ausserhalb davon, und Chrome
// verweigerte die Installation - deshalb leitet das Relay /fern dorthin um.
const MANIFEST = {
  name: "ELFIX Fernbedienung",
  short_name: "ELFIX",
  description: "Pause, Spulen und naechste Folge fuer ELFIX auf dem Rechner.",
  // Alles relativ, nichts ab der Wurzel. Aufgeloest wird es gegen die Adresse
  // des Manifests, und damit stimmt es auch dann, wenn das Relay nicht unter
  // dem Wurzelverzeichnis einer Domain haengt, sondern hinter einem Vorspann
  // wie /elfix/. Stuende hier "/fern/", zeigte start_url dort ins Leere -
  // Chrome verweigert die Installation und legt eine Verknuepfung an.
  //
  // Eine eigene "id" gibt es deshalb nicht: Chrome leitet sie aus start_url ab,
  // und die ist jetzt an jeder Stelle die richtige.
  start_url: "./",
  scope: "./",
  display: "standalone",
  // Ausdruecklich, auch wenn es der Vorgabewert ist: das Feld ist die einzige
  // Angabe im Manifest, mit der man die Installation der Web-App zugunsten
  // einer Store-App abschalten kann. Wer hier sucht, soll die Antwort sehen.
  prefer_related_applications: false,
  background_color: "#070a10",
  theme_color: "#070a10",
  lang: "de",
  // Beide Groessen, die Chrome nennt. Eine allein reicht fuer das Angebot zum
  // Installieren, aber die fertige App sieht damit auf manchen Geraeten
  // nachgeschaerft aus.
  //
  // "any maskable" heisst: dasselbe Bild dient als gewoehnliches Symbol und als
  // eines, das rund oder eckig ausgeschnitten wird. Das Zeichen sitzt weit
  // genug innen dafuer.
  icons: [
    { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
    { src: "icon.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
  ]
};

// Der Service Worker.
//
// Er tut absichtlich wenig. Fuer die Seite selbst gilt "erst das Netz, dann der
// Vorrat": nach einem Aktualisieren des Relays soll sofort die neue Fassung
// dastehen und nicht wochenlang die alte. Nur wenn gar nichts geht, kommt sie
// aus dem Vorrat - dann laesst sich die Fernbedienung wenigstens oeffnen und
// sagt selbst, dass keine Verbindung besteht.
//
// Das Icon und das Manifest aendern sich praktisch nie und kommen deshalb
// zuerst aus dem Vorrat.
const SERVICE_WORKER = `const VORRAT = "elfix-fern-2";
const SCHALE = ["./", "./icon.png", "./icon-192.png", "./manifest.webmanifest"];

self.addEventListener("install", (ereignis) => {
  ereignis.waitUntil(caches.open(VORRAT).then((vorrat) => vorrat.addAll(SCHALE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (ereignis) => {
  ereignis.waitUntil(caches.keys().then((namen) => Promise.all(
    namen.filter((name) => name !== VORRAT).map((name) => caches.delete(name))
  )).then(() => self.clients.claim()).catch(() => {}));
});

self.addEventListener("fetch", (ereignis) => {
  const anfrage = ereignis.request;
  if (anfrage.method !== "GET") return;
  const adresse = new URL(anfrage.url);
  if (adresse.origin !== location.origin || !adresse.pathname.startsWith("/fern")) return;

  // Symbol und Manifest: erst aus dem Vorrat.
  if (adresse.pathname.endsWith(".png") || adresse.pathname.endsWith("manifest.webmanifest")) {
    ereignis.respondWith(caches.match(anfrage).then((treffer) => treffer || fetch(anfrage)));
    return;
  }

  // Die Seite: erst das Netz, und was ankommt, wandert in den Vorrat.
  ereignis.respondWith(
    fetch(anfrage).then((antwort) => {
      const kopie = antwort.clone();
      caches.open(VORRAT).then((vorrat) => vorrat.put(anfrage, kopie)).catch(() => {});
      return antwort;
    }).catch(() => caches.match(anfrage).then((treffer) => treffer || caches.match("./")))
  );
});
`;

module.exports = { SEITE, MANIFEST, SERVICE_WORKER };
