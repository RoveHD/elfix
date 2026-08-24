/*
 * Der ELFIX-Kern auf Android.
 *
 * Diese Datei ist das einzige Android-eigene JavaScript. Alles, was sie laedt,
 * kommt unveraendert aus der Desktop-App: titel.js, empfehlung.js,
 * begruendung.js, metadaten.js, statistik.js, discover.js, watchparty.js und
 * die uebrigen. Sie kennen weder Electron noch Node - nur fetch, WebSocket und
 * setTimeout, und die hat ein WebView.
 *
 * Warum ueberhaupt ein WebView fuer Logik: Android hatte diese Module in Java
 * nachgebaut. 37 Funktionen mit denselben Namen, derselben Absicht und
 * auseinandergelaufenen Ergebnissen - nachgezogen wurde nur, woran gerade
 * jemand dachte. Ein Fortschritt, der auf dem Rechner zaehlt und auf dem
 * Telefon nicht, ist kein Darstellungsfehler, sondern ein zweites Programm.
 * Der Kern beendet das: die Regel steht genau einmal.
 *
 * Der Weg hinein und hinaus:
 *   Java  -> ElfixKern.aufruf(id, "empfehlung.empfehlen", [args])
 *   Java  <- AndroidKern.antwort(id, {ok, wert})       (auch fuer Promises)
 *   Java  <- AndroidKern.ereignis(name, nutzlast)      (Watchparty schiebt)
 *   Netz  -> AndroidKern.netzStart(id, url, optionen)  (fetch geht ueber Java)
 *   Netz  <- ElfixKern.netzFertig(id, antwort)
 *
 * fetch laeuft absichtlich nicht im WebView selbst. Diese Seite hat einen
 * eigenen Ursprung; jede Anbieterseite waere fremd, und der Browser laesst die
 * Antwort nicht lesen. Java kennt diese Grenze nicht und hat ausserdem die
 * Anmeldekekse des Anbieters - dieselbe Lage wie im Hauptprozess am Desktop,
 * der ebenfalls mit der Sitzung des Anbieters holt.
 */
(function () {
  "use strict";

  var quelltexte = {};
  var geladene = {};
  var bereit = false;
  var wartend = [];

  // Im Paket liegen alle Module nebeneinander, in der Desktop-App nicht:
  // fortschritt.js holt sich "./youtube" und "../shared/provider-model". Weil
  // die Dateinamen ohnehin eindeutig sind, zaehlt hier nur der letzte Teil des
  // Pfades - ohne Ordner und ohne ".js".
  function schluessel(pfad) {
    var text = String(pfad || "");
    var schrag = text.lastIndexOf("/");
    if (schrag >= 0) text = text.slice(schrag + 1);
    return text.replace(/\.js$/, "");
  }

  function require(pfad) {
    var name = schluessel(pfad);
    if (Object.prototype.hasOwnProperty.call(geladene, name)) return geladene[name].exports;

    // crypto ist der einzige Node-Baustein, den ein Modul ueber require
    // anfasst. watchparty-raeume.js will nur randomUUID; der Geraeteabgleich
    // verlangt HKDF, HMAC und AES-256-GCM, und zwar synchron - das liefert
    // kern-knoten.js ueber Java.
    if (name === "crypto") {
      return (window.ElfixKnoten && window.ElfixKnoten.crypto) || kryptoErsatz();
    }

    var quelle = quelltexte[name];
    if (typeof quelle !== "string") {
      throw new Error("Kern-Modul nicht vorhanden: " + pfad);
    }

    var modul = { exports: {} };
    geladene[name] = modul;
    try {
      // Der Name am Ende gibt dem Modul in Fehlermeldungen seinen Dateinamen
      // zurueck; ohne ihn hiesse jeder Stapel nur "anonymous".
      var bauen = new Function(
        "module", "exports", "require", "globalThis",
        quelle + "\n//# sourceURL=elfix-kern/" + name + ".js"
      );
      bauen(modul, modul.exports, require, window);
    } catch (fehler) {
      delete geladene[name];
      throw new Error("Kern-Modul " + name + " liess sich nicht laden: " + fehler);
    }
    return modul.exports;
  }

  function kryptoErsatz() {
    var echt = window.crypto;
    return {
      webcrypto: echt,
      randomUUID: function () {
        if (echt && typeof echt.randomUUID === "function") return echt.randomUUID();
        // Aeltere WebViews kennen randomUUID noch nicht. Die Kennung muss
        // nicht kryptographisch sein, nur eindeutig - sie unterscheidet
        // Watchparty-Raeume voneinander.
        var zufall = new Uint8Array(16);
        if (echt && typeof echt.getRandomValues === "function") echt.getRandomValues(zufall);
        else for (var f = 0; f < zufall.length; f += 1) zufall[f] = Math.floor(Math.random() * 256);
        zufall[6] = (zufall[6] & 0x0f) | 0x40;
        zufall[8] = (zufall[8] & 0x3f) | 0x80;
        var hex = [];
        for (var i = 0; i < zufall.length; i += 1) hex.push((zufall[i] + 0x100).toString(16).slice(1));
        return hex.slice(0, 4).join("") + "-" + hex.slice(4, 6).join("") + "-"
          + hex.slice(6, 8).join("") + "-" + hex.slice(8, 10).join("") + "-" + hex.slice(10).join("");
      }
    };
  }

  /* ---------------------------------------------------------------- Netz */

  var netzZaehler = 0;
  var offeneAnfragen = {};

  function bruecke() {
    return window.AndroidKern || null;
  }

  // Der fetch, den metadaten.js und alles Weitere benutzt. Die Form ist die
  // des echten fetch, soweit der Kern sie braucht: Status, ok, text(), json()
  // und die Kopfzeilen als schlichte Abfrage.
  function kernFetch(url, optionen) {
    var brief = bruecke();
    if (!brief || typeof brief.netzStart !== "function") {
      return Promise.reject(new Error("Kein Netzweg nach Java vorhanden"));
    }
    netzZaehler += 1;
    var id = "n" + netzZaehler;
    var einstellung = optionen || {};
    var nutzlast = {
      methode: String(einstellung.method || "GET").toUpperCase(),
      kopf: kopfzeilenAlsObjekt(einstellung.headers),
      koerper: typeof einstellung.body === "string" ? einstellung.body : null
    };
    return new Promise(function (erfuellen, verwerfen) {
      offeneAnfragen[id] = { erfuellen: erfuellen, verwerfen: verwerfen };
      try {
        brief.netzStart(id, String(url), JSON.stringify(nutzlast));
      } catch (fehler) {
        delete offeneAnfragen[id];
        verwerfen(fehler);
      }
    });
  }

  function kopfzeilenAlsObjekt(kopf) {
    if (!kopf) return {};
    if (typeof kopf.forEach === "function" && typeof kopf.get === "function") {
      var aus = {};
      kopf.forEach(function (wert, name) { aus[name] = wert; });
      return aus;
    }
    return kopf;
  }

  function netzFertig(id, rohAntwort) {
    var offen = offeneAnfragen[id];
    if (!offen) return;
    delete offeneAnfragen[id];
    var antwort;
    try {
      antwort = typeof rohAntwort === "string" ? JSON.parse(rohAntwort) : rohAntwort;
    } catch (fehler) {
      offen.verwerfen(new Error("Antwort war kein JSON"));
      return;
    }
    if (antwort && antwort.fehler) {
      offen.verwerfen(new Error(antwort.fehler));
      return;
    }
    offen.erfuellen(alsAntwort(antwort || {}));
  }

  function alsAntwort(roh) {
    var text = typeof roh.koerper === "string" ? roh.koerper : "";
    var kopf = roh.kopf || {};
    var kleingeschrieben = {};
    Object.keys(kopf).forEach(function (name) { kleingeschrieben[String(name).toLowerCase()] = kopf[name]; });
    return {
      ok: roh.status >= 200 && roh.status < 300,
      status: roh.status || 0,
      statusText: roh.statusText || "",
      url: roh.url || "",
      redirected: Boolean(roh.umgeleitet),
      headers: {
        get: function (name) {
          var wert = kleingeschrieben[String(name).toLowerCase()];
          return wert === undefined ? null : wert;
        },
        has: function (name) {
          return Object.prototype.hasOwnProperty.call(kleingeschrieben, String(name).toLowerCase());
        }
      },
      text: function () { return Promise.resolve(text); },
      json: function () {
        return new Promise(function (erfuellen, verwerfen) {
          try { erfuellen(JSON.parse(text)); } catch (fehler) { verwerfen(fehler); }
        });
      }
    };
  }

  /* -------------------------------------------------------------- Aufruf */

  // Java nennt Modul und Funktion als "modul.funktion". Damit kommt jede
  // Ausfuhr jedes Kern-Moduls heran, ohne dass hier eine Liste gepflegt werden
  // muesste, die beim naechsten Desktop-Feature wieder fehlt.
  function loesen(pfad) {
    var teile = String(pfad || "").split(".");
    if (teile.length < 2) throw new Error("Aufruf braucht die Form modul.funktion: " + pfad);
    var modulName = teile.shift();
    var ziel = require(modulName);
    while (teile.length) {
      if (ziel === null || ziel === undefined) throw new Error("Unbekannter Aufruf: " + pfad);
      ziel = ziel[teile.shift()];
    }
    return ziel;
  }

  function aufruf(rufId, pfad, rohArgumente) {
    try {
      var argumente = rohArgumente ? JSON.parse(rohArgumente) : [];
      if (!Array.isArray(argumente)) argumente = [argumente];
      var ziel = loesen(pfad);
      if (typeof ziel !== "function") {
        // Auch ein Wert darf abgefragt werden - GEWICHTE, GRENZEN, WOCHENTAGE
        // sind Teil der Regel und nicht nur Beiwerk.
        melden(rufId, { ok: true, wert: ziel === undefined ? null : ziel });
        return;
      }
      var wert = ziel.apply(null, argumente);
      if (wert && typeof wert.then === "function") {
        wert.then(
          function (aufgeloest) { melden(rufId, { ok: true, wert: aufgeloest === undefined ? null : aufgeloest }); },
          function (fehler) { melden(rufId, { ok: false, fehler: String((fehler && fehler.message) || fehler) }); }
        );
        return;
      }
      melden(rufId, { ok: true, wert: wert === undefined ? null : wert });
    } catch (fehler) {
      melden(rufId, { ok: false, fehler: String((fehler && fehler.message) || fehler) });
    }
  }

  function melden(rufId, ergebnis) {
    var brief = bruecke();
    if (!brief || typeof brief.antwort !== "function") return;
    var text;
    try {
      text = JSON.stringify(ergebnis);
    } catch (fehler) {
      // Ein Ergebnis, das sich nicht in JSON fassen laesst, ist fuer Java
      // ohnehin wertlos - aber der Aufruf darf deswegen nicht offen bleiben
      // und die Java-Seite ewig warten lassen.
      text = JSON.stringify({ ok: false, fehler: "Ergebnis nicht uebertragbar: " + fehler });
    }
    brief.antwort(String(rufId), text);
  }

  /* ------------------------------------------------------------ Zustaende */

  // Langlebiges - eine Watchparty-Verbindung etwa - kann nicht als
  // Rueckgabewert reisen. Es bekommt hier einen Platz und eine Kennung, ueber
  // die Java es wiederfindet.
  var haltungen = {};

  function halten(name, wert) {
    haltungen[name] = wert;
    return name;
  }

  function gehalten(name) {
    return haltungen[name];
  }

  function ereignis(name, nutzlast) {
    var brief = bruecke();
    if (!brief || typeof brief.ereignis !== "function") return;
    try {
      brief.ereignis(String(name), JSON.stringify(nutzlast === undefined ? null : nutzlast));
    } catch (fehler) {
      brief.ereignis(String(name), JSON.stringify({ fehler: String(fehler) }));
    }
  }

  /* ---------------------------------------------------------------- Start */

  function quelle(name, text) {
    quelltexte[schluessel(name)] = text;
  }

  function start() {
    bereit = true;
    var brief = bruecke();
    if (brief && typeof brief.bereit === "function") {
      brief.bereit(JSON.stringify(Object.keys(quelltexte).sort()));
    }
    var offen = wartend;
    wartend = [];
    offen.forEach(function (eintrag) { aufruf(eintrag[0], eintrag[1], eintrag[2]); });
  }

  // Der eigene Abruf des WebViews, bevor er ueberschrieben wird.
  //
  // Er wird an genau einer Stelle gebraucht: die Filterlisten sind Megabytes
  // gross, und ueber die Bruecke kaeme jede von ihnen als ein einziger,
  // riesiger evaluateJavascript-Aufruf herein. Der Browser holt sie direkt von
  // dort, wo Java sie hinlegt (siehe Kern.LISTEN_WIRT), und streamt sie -
  // ohne dass ein Byte durch die Bruecke muss.
  var eigenerAbruf = typeof window.fetch === "function" ? window.fetch.bind(window) : null;

  window.fetch = kernFetch;

  window.ElfixKern = {
    browserAbruf: eigenerAbruf,
    quelle: quelle,
    start: start,
    netzFertig: netzFertig,
    require: require,
    halten: halten,
    gehalten: gehalten,
    ereignis: ereignis,
    aufruf: function (rufId, pfad, argumente) {
      // Vor start() liegen die Quelltexte noch nicht vollstaendig vor. Ein
      // Aufruf, der jetzt kaeme, wuerde an einem halb gefuellten Kern
      // scheitern - er wartet lieber.
      if (!bereit) {
        wartend.push([rufId, pfad, argumente]);
        return;
      }
      aufruf(rufId, pfad, argumente);
    }
  };

  window.onerror = function (nachricht, datei, zeile) {
    var brief = bruecke();
    if (brief && typeof brief.protokoll === "function") {
      brief.protokoll("fehler", nachricht + " (" + datei + ":" + zeile + ")");
    }
    return false;
  };
})();
