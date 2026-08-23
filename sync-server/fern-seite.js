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
<!-- iOS kennt kein Manifest: dort machen diese beiden aus der Seite eine App. -->
<link rel="apple-touch-icon" href="icon.png">
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
    <button data-befehl="stumm"><span class="zeichen">🔇</span>Ton</button>
    <button data-befehl="vollbild"><span class="zeichen">⛶</span>Vollbild</button>
    <button data-befehl="naechste"><span class="zeichen">⏭</span>Nächste</button>
  </div>
  <div class="zustand" id="zustand" style="margin-top:16px"></div>
</div>

<script>
(() => {
  const adresse = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
  const $ = (id) => document.getElementById(id);
  let socket = null;
  let code = localStorage.getItem("elfix-fern-code") || "";
  let gekoppelt = false;

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
    };
    socket.onclose = () => {
      socket = null;
      if (gekoppelt) melden("Verbindung weg — versuche es weiter", true);
      // Immer wieder versuchen: ein Handy schlaeft ein, sobald man es weglegt,
      // und soll beim Aufwachen einfach wieder da sein.
      setTimeout(verbinden, 2000);
    };
  };

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
  let angebot = null;
  window.addEventListener("beforeinstallprompt", (ereignis) => {
    ereignis.preventDefault();
    angebot = ereignis;
    $("installieren").classList.remove("weg");
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
    $("installieren").classList.add("weg");
  });

  // Ohne Service Worker bietet Chrome das Installieren gar nicht erst an. Er
  // haelt ausserdem die Seite vor: eine Fernbedienung, die im Funkloch eine
  // Fehlerseite zeigt, waere schlimmer als eine, die sagt "keine Verbindung".
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
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
  start_url: "/fern/",
  scope: "/fern/",
  display: "standalone",
  background_color: "#070a10",
  theme_color: "#070a10",
  lang: "de",
  icons: [
    {
      src: "icon.png",
      sizes: "512x512",
      type: "image/png",
      // Beides in einem: als gewoehnliches Symbol und als eines, das rund oder
      // eckig ausgeschnitten wird. Das Zeichen sitzt weit genug innen dafuer.
      purpose: "any maskable"
    }
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
const SERVICE_WORKER = `const VORRAT = "elfix-fern-1";
const SCHALE = ["./", "./icon.png", "./manifest.webmanifest"];

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
  if (adresse.pathname.endsWith("icon.png") || adresse.pathname.endsWith("manifest.webmanifest")) {
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
