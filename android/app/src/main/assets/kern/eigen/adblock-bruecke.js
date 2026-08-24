"use strict";

/*
 * Der Werbeblocker auf Android - die Verkabelung zur Engine.
 *
 * Die Engine ist `adblock-engine.js`, dieselbe Datei wie am Rechner, und die
 * traegt @adguard/tsurlfilter. Was hier steht, ist nur der Weg dorthin:
 *
 *   Listen holen   Sie liegen als Rohtext auf der Platte, weil Java sie
 *                  ohnehin herunterlaedt. Geholt werden sie mit dem *eigenen*
 *                  Abruf des WebViews (ElfixKern.browserAbruf) von der
 *                  Adresse, unter der Java sie ausliefert - nicht ueber die
 *                  Bruecke: eine Liste ist mehrere Megabyte gross, und die
 *                  Bruecke reicht Antworten als Text in einem einzigen
 *                  evaluateJavascript-Aufruf weiter.
 *   Paket laden    Das Buendel liegt neben dem Kern und wird erst geladen,
 *                  wenn wirklich gebaut wird. Es sind 1,3 MB - jeder Start
 *                  wuerde sie sonst mitschleppen, auch auf Geraeten, die die
 *                  Engine gar nicht tragen koennen.
 *   Urteile        Java fragt in Stapeln. Ein Aufruf je Anfrage waere ein
 *                  Bruecken-Gang je Bild auf der Seite.
 *
 * Entschieden wird hier nichts. Welche Anfrage geblockt gehoert, sagt die
 * Engine; ob dieses Geraet sie ueberhaupt bauen darf, sagt Java.
 */
(function () {
  const { AdblockEngine } = require("adblock-engine");
  const kosmetik = require("adblock-kosmetik");

  /** Wo das Buendel liegt - neben kern.html, im Paket. */
  const PAKET = "tsurlfilter.js";

  const engine = new AdblockEngine();
  let paketLadung = null;
  let bauLaeuft = null;
  let zustand = { bereit: false, regeln: 0, listen: 0, fehler: "" };

  /**
   * Das Buendel nachladen.
   *
   * <p>Als Skript in die Seite, nicht ueber die Bruecke: dort waere es ein
   * Aufruf von reichlich einem Megabyte Quelltext.
   */
  function paketLaden() {
    if (globalThis.ELFIX_TSURLFILTER) return Promise.resolve(true);
    if (paketLadung) return paketLadung;
    paketLadung = new Promise((fertig) => {
      const skript = document.createElement("script");
      skript.src = PAKET;
      skript.onload = () => fertig(Boolean(globalThis.ELFIX_TSURLFILTER));
      skript.onerror = () => fertig(false);
      document.head.appendChild(skript);
    });
    return paketLadung;
  }

  function textHolen(adresse) {
    const abruf = window.ElfixKern && window.ElfixKern.browserAbruf;
    if (!abruf) return Promise.reject(new Error("Kein eigener Abruf vorhanden"));
    return abruf(String(adresse)).then((antwort) => {
      if (!antwort.ok) throw new Error("HTTP " + antwort.status);
      return antwort.text();
    });
  }

  /**
   * Die Engine aus den abgelegten Listen bauen.
   *
   * @param quellen [{ id, url }] - die AdGuard-Listennummer und wo Java sie
   *                ausliefert. Die Nummer steckt spaeter in jedem Treffer.
   */
  async function bauen(quellen) {
    if (bauLaeuft) return bauLaeuft;
    bauLaeuft = bauenIntern(quellen).finally(() => {
      bauLaeuft = null;
    });
    return bauLaeuft;
  }

  async function bauenIntern(quellen) {
    if (!(await paketLaden())) {
      zustand = { bereit: false, regeln: 0, listen: 0, fehler: "tsurlfilter fehlt im Paket" };
      return zustand;
    }
    const listen = [];
    let letzterFehler = "";
    for (const quelle of quellen || []) {
      try {
        const text = await textHolen(quelle.url);
        if (String(text || "").trim()) listen.push({ id: Number(quelle.id) || 0, text });
      } catch (fehler) {
        letzterFehler = String((fehler && fehler.message) || fehler);
      }
    }
    if (!listen.length) {
      zustand = { bereit: false, regeln: 0, listen: 0, fehler: letzterFehler || "Keine Liste lesbar" };
      return zustand;
    }
    const gebaut = await engine.bauen(listen);
    zustand = {
      bereit: Boolean(gebaut) && engine.istBereit(),
      regeln: engine.ruleCount(),
      listen: listen.length,
      fehler: gebaut ? "" : "Engine liess sich nicht bauen"
    };
    return zustand;
  }

  /**
   * Ein Stapel Urteile.
   *
   * <p>Zurueck kommt je Anfrage, was die Engine sagt - auch das ausdrueckliche
   * Erlauben. Das ist kein stilles Durchwinken: eine @@-Regel ist die
   * Entscheidung der Liste, und genau darueber kommen Cloudflare Turnstile,
   * hCaptcha und reCAPTCHA durch.
   *
   * @param anfragen [{ url, typ, quelle }]
   */
  function urteile(anfragen) {
    if (!engine.istBereit()) return [];
    const aus = [];
    for (const anfrage of anfragen || []) {
      const url = String((anfrage && anfrage.url) || "");
      if (!url) continue;
      const urteil = engine.matchRequest({
        url,
        resourceType: String((anfrage && anfrage.typ) || "other"),
        sourceUrl: (anfrage && anfrage.quelle) || ""
      });
      aus.push({
        url,
        typ: String((anfrage && anfrage.typ) || "other"),
        // Die Quelle geht zurueck, damit Java das Urteil wieder der richtigen
        // Frage zuordnen kann. Ueber die Reihenfolge zu gehen waere eine
        // stille Falle: faellt eine Anfrage hier heraus, verschoebe sich alles
        // dahinter um eins, und die Urteile landeten an fremden Adressen.
        quelle: String((anfrage && anfrage.quelle) || ""),
        block: Boolean(urteil.block),
        erlaubt: Boolean(urteil.allowlist),
        regel: String(urteil.rule || ""),
        liste: Number(urteil.listId || 0)
      });
    }
    return aus;
  }

  /**
   * Die kosmetischen Regeln fuer eine Seite - fertig zum Einspielen.
   *
   * <p>Das Zusammenfassen der Selektoren und der Aufruf in die Seite kommen aus
   * `adblock-kosmetik.js`, demselben Modul, das am Rechner dafuer sorgt. Java
   * bekommt fertigen Quelltext und entscheidet nur noch, ob er hineingeht.
   */
  function seitenregeln(url) {
    if (!engine.istBereit()) return { stil: "", skripte: [], selektoren: 0 };
    const daten = engine.kosmetik(url);
    const css = kosmetik.stilAusSelektoren(daten.stile);
    return {
      stil: css ? kosmetik.stilAufrufScript(css) : "",
      skripte: daten.skripte || [],
      selektoren: daten.stile.length
    };
  }

  /** Ob dieser Host Werbung ausliefert - fuer die Overlay-Erkennung. */
  function werbeHost(host) {
    return engine.istWerbeHost(host);
  }

  function stand() {
    return zustand;
  }

  module.exports = { bauen, urteile, seitenregeln, werbeHost, stand };
})();
