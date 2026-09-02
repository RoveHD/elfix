"use strict";

// Die Statusseite des Relays.
//
// Ein Relay laeuft auf einer Maschine, an die niemand mehr denkt: ein Raspberry
// im Regal, ein kleiner Server beim Anbieter. Ob es noch laeuft, liess sich
// bisher nur auf zwei Wegen feststellen - `systemctl status` auf der Maschine
// selbst oder `curl /health` und JSON lesen. Beides setzt voraus, dass man an
// die Maschine herankommt und weiss, wonach man sucht. Wer die Adresse in den
// Browser tippte, bekam eine Zeile Text.
//
// Diese Seite ist die Antwort darauf: Adresse aufrufen, hinsehen, fertig. Sie
// haelt sich selbst frisch, und wenn das Relay stehenbleibt, sagt sie das -
// eine Seite, die nur beim Laden stimmt, waere fuer genau die Frage nutzlos,
// wegen der man sie aufmacht.
//
// Was hier *nicht* steht, ist Absicht: keine Raumcodes, keine Titel, keine
// Namen, kein Pfad zur Ablage. Die Seite ist so oeffentlich wie das Relay -
// wer die Adresse kennt, sieht sie. Zahlen verraten niemanden; ein Raumcode
// waere der Schluessel zum Raum.
//
// Wie bei der Fernbedienung als Zeichenkette in einer .js-Datei und nicht als
// .html daneben: das README sagt beim Aktualisieren "alle .js-Dateien
// kopieren", und eine einzelne HTML-Datei waere genau die, die dabei jedes Mal
// liegenbliebe.

const SEITE = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#070a10">
<title>ELFIX Relay</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100dvh; padding: 24px 18px calc(24px + env(safe-area-inset-bottom));
    background: #070a10; color: #eef2f8;
    font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
    display: flex; flex-direction: column; gap: 16px;
    max-width: 560px; margin-inline: auto;
  }
  h1 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #7c8798; }
  .karte { background: #101725; border: 1px solid #1e2838; border-radius: 16px; padding: 18px; }
  .lage { display: flex; align-items: center; gap: 14px; }
  .punkt {
    width: 14px; height: 14px; border-radius: 50%; flex: none;
    background: #62d19a; box-shadow: 0 0 0 4px rgba(98, 209, 154, .16);
    transition: background .3s, box-shadow .3s;
  }
  .lage.weg .punkt { background: #ff8a8a; box-shadow: 0 0 0 4px rgba(255, 138, 138, .16); }
  .lage.wartet .punkt { background: #8b97a9; box-shadow: 0 0 0 4px rgba(139, 151, 169, .16); }
  .wort { font-size: 21px; font-weight: 700; line-height: 1.2; }
  .lage.weg .wort { color: #ffb3b3; }
  .unter { margin-top: 3px; color: #8b97a9; font-size: 14px; }
  .raster { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .zahl {
    background: #101725; border: 1px solid #1e2838; border-radius: 14px;
    padding: 14px 10px; text-align: center;
  }
  .zahl b { display: block; font-size: 24px; font-variant-numeric: tabular-nums; }
  .zahl span { display: block; margin-top: 4px; color: #7c8798; font-size: 12px; }
  .zeile {
    display: flex; justify-content: space-between; gap: 12px; padding: 9px 0;
    border-top: 1px solid #1a2333; color: #8b97a9; font-size: 14px;
  }
  .zeile:first-child { border-top: 0; padding-top: 0; }
  .zeile b { color: #eef2f8; font-weight: 600; text-align: right; }
  .zeile b.ja { color: #62d19a; }
  .zeile b.nein { color: #ff8a8a; }
  .zeile b.mahnung { color: #ffcf8a; }
  .kopf { color: #7c8798; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 10px; }
  code {
    display: block; background: #0a101b; border: 1px solid #1e2838; border-radius: 10px;
    padding: 12px 14px; font: 600 15px/1.3 ui-monospace, "Cascadia Mono", Consolas, monospace;
    color: #3ea6ff; overflow-wrap: anywhere;
  }
  .knoepfe { margin-top: 12px; display: flex; gap: 10px; flex-wrap: wrap; }
  button, a.knopf {
    appearance: none; border: 1px solid #24304a; border-radius: 12px;
    background: #151d2c; color: #eef2f8; text-decoration: none;
    font: 600 14px/1.2 system-ui, sans-serif; padding: 11px 16px; cursor: pointer;
  }
  button:active, a.knopf:active { background: #1d2740; transform: scale(.98); }
  details { border: 1px solid #1e2838; border-radius: 12px; background: #101725; padding: 12px 14px; }
  summary { cursor: pointer; color: #8b97a9; font-size: 14px; }
  .koennen { margin: 12px 0 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px; }
  .koennen li {
    background: #151d2c; border: 1px solid #24304a; border-radius: 8px;
    padding: 4px 9px; color: #8b97a9; font-size: 12px;
  }
  .fuss { margin: 0; color: #5c6675; font-size: 12px; line-height: 1.5; text-align: center; }
  /* Antwortet das Relay nicht mehr, bleiben die Zahlen stehen - sie sind aber
     von vorhin. Blass heisst: gilt nicht mehr. Sie ganz zu leeren waere die
     schlechtere Wahl; wer hinsieht, will wissen, wobei es aufgehoert hat. */
  body.veraltet .raster, body.veraltet .karte:not(:first-of-type), body.veraltet details { opacity: .45; }
</style>
</head>
<body>

<h1>ELFIX Relay</h1>

<div class="karte">
  <div class="lage wartet" id="lage">
    <div class="punkt"></div>
    <div>
      <div class="wort" id="wort">Wird gefragt …</div>
      <div class="unter" id="unter">&nbsp;</div>
    </div>
  </div>
</div>

<div class="raster">
  <div class="zahl"><b id="zRaeume">–</b><span>Räume</span></div>
  <div class="zahl"><b id="zVerbindungen">–</b><span>Verbindungen</span></div>
  <div class="zahl"><b id="zYoutube">–</b><span>YouTube-Runden</span></div>
  <div class="zahl"><b id="zGeraete">–</b><span>Geräteschlüssel</span></div>
  <div class="zahl"><b id="zFern">–</b><span>Fernbedienungen</span></div>
  <div class="zahl"><b id="zPort">–</b><span>Port</span></div>
</div>

<div class="karte">
  <div class="zeile"><span>Metadaten-Tor</span><b id="zMeta">–</b></div>
  <div class="zeile"><span>TMDB-Schlüssel</span><b id="zTmdb">–</b></div>
  <div class="zeile"><span>AniList</span><b id="zAnilist">–</b></div>
  <div class="zeile"><span>Selbstaktualisierung</span><b id="zUpdate">–</b></div>
</div>

<div class="karte">
  <div class="kopf">In der App eintragen</div>
  <code id="adresse">…</code>
  <div class="knoepfe">
    <button id="kopieren" type="button">Adresse kopieren</button>
    <a class="knopf" href="fern/">Fernbedienung öffnen</a>
  </div>
</div>

<details>
  <summary>Was diese Fassung kann</summary>
  <ul class="koennen" id="koennen"></ul>
</details>

<p class="fuss">
  Diese Seite kommt aus dem Relay selbst — sie zu sehen heißt schon, dass es
  läuft. Sie fragt alle drei Sekunden nach und sagt es, wenn keine Antwort mehr
  kommt.
</p>

<script>
  const $ = (id) => document.getElementById(id);

  // Woher die Zahlen kommen. Relativ zur Seite und nicht ab Wurzel: wer das
  // Relay hinter einem Tunnel unter einem Unterpfad betreibt, soll die Seite
  // trotzdem benutzen koennen.
  const QUELLE = new URL("health", location.href);

  // Was in die App gehoert. Die Seite kennt ihre eigene Adresse - das ist
  // genau die, die drueben eingetragen werden muss, und Abtippen aus dem
  // Gedaechtnis ist die haeufigste Fehlerquelle beim Einrichten.
  const ADRESSE = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
  $("adresse").textContent = ADRESSE;

  $("kopieren").addEventListener("click", async () => {
    const knopf = $("kopieren");
    try {
      await navigator.clipboard.writeText(ADRESSE);
      knopf.textContent = "Kopiert";
    } catch {
      // Ohne https gibt die Zwischenablage nichts her. Dann bleibt die Adresse
      // wenigstens markiert stehen, statt dass nichts passiert.
      const bereich = document.createRange();
      bereich.selectNodeContents($("adresse"));
      const auswahl = getSelection();
      auswahl.removeAllRanges();
      auswahl.addRange(bereich);
      knopf.textContent = "Markiert — mit Strg+C kopieren";
    }
    setTimeout(() => { knopf.textContent = "Adresse kopieren"; }, 2500);
  });

  function dauer(sekunden) {
    const s = Math.max(0, Math.round(sekunden));
    const tage = Math.floor(s / 86400);
    const std = Math.floor((s % 86400) / 3600);
    const min = Math.floor((s % 3600) / 60);
    if (tage) return tage + (tage === 1 ? " Tag " : " Tage ") + std + " Std";
    if (std) return std + " Std " + min + " Min";
    if (min) return min + " Min";
    return s + " Sek";
  }

  let zuletzt = 0;
  let koennenStand = "";

  function zeigen(stand) {
    zuletzt = Date.now();
    document.body.classList.remove("veraltet");
    $("lage").className = "lage";
    $("wort").textContent = "Läuft";
    $("unter").textContent = "Fassung " + (stand.fassung || "unbekannt")
      + " · seit " + dauer(stand.laeuftSeitS || 0);

    $("zRaeume").textContent = stand.raeume ?? "–";
    $("zVerbindungen").textContent = stand.verbindungen ?? "–";
    $("zYoutube").textContent = stand.youtubeRaeume ?? "–";
    $("zGeraete").textContent = stand.geraeteRaeume ?? "–";
    $("zFern").textContent = stand.fernbedienungen ?? "–";
    $("zPort").textContent = stand.port ?? "–";

    setzen("zMeta", stand.metadata ? "bereit" : "fehlt", Boolean(stand.metadata));
    // Kein Rot fuer den fehlenden TMDB-Schluessel: er ist freiwillig, und ein
    // Relay ohne ihn ist nicht kaputt - es liefert nur keine Filmdaten.
    setzen("zTmdb", stand.tmdb === "configured" ? "eingetragen" : "fehlt — keine Filmdaten",
      stand.tmdb === "configured" ? true : "mahnung");
    setzen("zAnilist", stand.anilist === "available" ? "bereit" : "fehlt", stand.anilist === "available");
    // Aus dem Quelltext gestartet aktualisiert sich das Relay nicht selbst -
    // das ist kein Mangel, sondern die Regel aus aktualisierung.js.
    setzen("zUpdate", stand.gepackt ? "an — sieht täglich nach" : "aus — läuft aus dem Quelltext", null);

    const koennen = (stand.features || []).join(",");
    if (koennen !== koennenStand) {
      koennenStand = koennen;
      $("koennen").replaceChildren(...(stand.features || []).map((wort) => {
        const li = document.createElement("li");
        li.textContent = wort;
        return li;
      }));
    }
  }

  function setzen(id, text, gut) {
    const feld = $(id);
    feld.textContent = text;
    feld.className = typeof gut === "string" ? gut : (gut === null ? "" : (gut ? "ja" : "nein"));
  }

  function weg() {
    document.body.classList.add("veraltet");
    $("lage").className = "lage weg";
    $("wort").textContent = "Keine Antwort";
    $("unter").textContent = zuletzt
      ? "zuletzt erreicht vor " + dauer((Date.now() - zuletzt) / 1000)
      : "Das Relay antwortet nicht.";
  }

  async function fragen() {
    try {
      const antwort = await fetch(QUELLE, { cache: "no-store" });
      if (!antwort.ok) throw new Error(String(antwort.status));
      zeigen(await antwort.json());
    } catch {
      weg();
    }
  }

  fragen();
  setInterval(fragen, 3000);
  // Nach dem Aufwachen sofort und nicht erst im naechsten Takt: ein Handy, das
  // eine Stunde in der Tasche lag, zeigt sonst eine Stunde alte Zahlen.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") fragen();
  });
</script>

</body>
</html>
`;

module.exports = { SEITE };
