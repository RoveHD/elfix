/*
 * Die Node-Bausteine, die der Kern braucht - Buffer und crypto.
 *
 * Ein WebView bringt beides nicht mit. `geraete-schluessel.js` verlangt beides
 * und verlangt es *synchron*: es leitet einen Schluessel ab und verschluesselt
 * in derselben Zeile weiter. Die WebCrypto-API des Browsers kann alles davon,
 * aber nur mit Versprechen - ein Ersatz darueber muesste das Modul umschreiben,
 * und dann stuende die Regel wieder zweimal da, einmal fuer den Rechner und
 * einmal fuer das Telefon.
 *
 * Ein Aufruf nach Java ueber die Bruecke kehrt dagegen sofort mit seinem Wert
 * zurueck. Deshalb rechnet hier nichts selbst: die eigentliche Krypto liegt in
 * `Krypto.java` (javax.crypto), und dass dabei dasselbe herauskommt wie bei
 * Node, ist mit Vektoren belegt (android/kryptoprobe, 17/17).
 *
 * Was hier steht, ist nur die Uebersetzung: Bytes hin, Bytes zurueck. Bewusst
 * in Hex - Base64 haette mit Polsterung und URL-Form zwei Schreibweisen, und
 * zwei Schreibweisen sind zwei Gelegenheiten, aneinander vorbeizurechnen.
 *
 * Der Buffer ist absichtlich klein gehalten. Er kann genau das, was die
 * geteilten Module von ihm verlangen - kein Byte mehr. Ein vollstaendiger
 * Nachbau waere mehr Code als alles, was ihn benutzt.
 */
(function () {
  "use strict";

  function java() {
    return window.AndroidKrypto || null;
  }

  // --- Bytes und ihre Schreibweisen -----------------------------------------

  var HEX = "0123456789abcdef";

  function hexAus(bytes) {
    var aus = "";
    for (var i = 0; i < bytes.length; i += 1) {
      aus += HEX[(bytes[i] >> 4) & 15] + HEX[bytes[i] & 15];
    }
    return aus;
  }

  function hexNach(text) {
    var sauber = String(text || "");
    var bytes = new Uint8Array(Math.floor(sauber.length / 2));
    for (var i = 0; i < bytes.length; i += 1) {
      bytes[i] = parseInt(sauber.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  function utf8Aus(bytes) {
    return new TextDecoder("utf-8").decode(bytes);
  }

  function utf8Nach(text) {
    return new TextEncoder().encode(String(text));
  }

  function base64Aus(bytes) {
    var roh = "";
    for (var i = 0; i < bytes.length; i += 1) roh += String.fromCharCode(bytes[i]);
    return btoa(roh);
  }

  function base64Nach(text) {
    var roh;
    try {
      roh = atob(String(text));
    } catch (fehler) {
      return new Uint8Array(0);
    }
    var bytes = new Uint8Array(roh.length);
    for (var i = 0; i < roh.length; i += 1) bytes[i] = roh.charCodeAt(i) & 255;
    return bytes;
  }

  /**
   * Ein Buffer, so weit die geteilten Module ihn brauchen.
   *
   * Er *ist* ein Uint8Array - nicht einer, der eines enthaelt. Dadurch
   * funktionieren `for (const byte of ...)`, `.length` und der Indexzugriff
   * ohne Zutun, und genau davon lebt die Base32-Kodierung des Schluessels.
   */
  function ElfixBuffer(bytes) {
    var puffer = new Uint8Array(bytes);
    puffer.toString = function (kodierung) {
      if (kodierung === "hex") return hexAus(this);
      if (kodierung === "base64") return base64Aus(this);
      return utf8Aus(this);
    };
    // subarray gibt von Haus aus ein nacktes Uint8Array zurueck - ohne
    // toString und damit ohne Nutzen fuer den Aufrufer.
    var echtesSubarray = puffer.subarray.bind(puffer);
    puffer.subarray = function (von, bis) {
      return ElfixBuffer(echtesSubarray(von, bis));
    };
    return puffer;
  }

  ElfixBuffer.from = function (wert, kodierung) {
    if (typeof wert === "string") {
      if (kodierung === "hex") return ElfixBuffer(hexNach(wert));
      if (kodierung === "base64") return ElfixBuffer(base64Nach(wert));
      return ElfixBuffer(utf8Nach(wert));
    }
    if (wert instanceof ArrayBuffer) return ElfixBuffer(new Uint8Array(wert));
    return ElfixBuffer(wert || []);
  };

  ElfixBuffer.concat = function (teile) {
    var gesamt = 0;
    var i;
    for (i = 0; i < teile.length; i += 1) gesamt += teile[i].length;
    var aus = new Uint8Array(gesamt);
    var stelle = 0;
    for (i = 0; i < teile.length; i += 1) {
      aus.set(teile[i], stelle);
      stelle += teile[i].length;
    }
    return ElfixBuffer(aus);
  };

  ElfixBuffer.isBuffer = function (wert) {
    return wert instanceof Uint8Array;
  };

  // --- crypto ---------------------------------------------------------------

  function randomBytes(anzahl) {
    var brief = java();
    if (brief && typeof brief.zufall === "function") {
      var hex = brief.zufall(anzahl);
      if (hex) return ElfixBuffer(hexNach(hex));
    }
    // Ohne Bruecke bleibt der Zufall des WebViews. Er ist derselbe
    // Betriebssystem-Zufall; der Umweg ueber Java besteht nur, damit alles an
    // einer Stelle liegt.
    var bytes = new Uint8Array(anzahl);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else throw new Error("Kein Zufall verfuegbar");
    return ElfixBuffer(bytes);
  }

  function hkdfSync(algorithmus, ikm, salz, info, laenge) {
    if (String(algorithmus).toLowerCase() !== "sha256") {
      throw new Error("Nur sha256 wird unterstuetzt, nicht " + algorithmus);
    }
    var brief = java();
    if (!brief || typeof brief.hkdf !== "function") throw new Error("Krypto-Bruecke fehlt");
    var hex = brief.hkdf(hexAus(ElfixBuffer.from(ikm)), hexAus(ElfixBuffer.from(salz)),
      hexAus(ElfixBuffer.from(info)), laenge);
    if (!hex) throw new Error("HKDF fehlgeschlagen");
    // Node gibt einen ArrayBuffer zurueck, und der Aufrufer wickelt ihn in
    // Buffer.from - also hier genauso.
    return hexNach(hex).buffer;
  }

  function createHmac(algorithmus, schluessel) {
    if (String(algorithmus).toLowerCase() !== "sha256") {
      throw new Error("Nur sha256 wird unterstuetzt, nicht " + algorithmus);
    }
    var text = "";
    return {
      update: function (wert) {
        text += String(wert);
        return this;
      },
      digest: function (kodierung) {
        var brief = java();
        if (!brief || typeof brief.hmac !== "function") throw new Error("Krypto-Bruecke fehlt");
        var hex = brief.hmac(hexAus(ElfixBuffer.from(schluessel)), text);
        return kodierung === "hex" ? hex : ElfixBuffer(hexNach(hex));
      }
    };
  }

  function createHash(algorithmus) {
    if (String(algorithmus).toLowerCase() !== "sha256") {
      throw new Error("Nur sha256 wird unterstuetzt, nicht " + algorithmus);
    }
    var text = "";
    return {
      update: function (wert) {
        text += String(wert);
        return this;
      },
      digest: function (kodierung) {
        var brief = java();
        if (!brief || typeof brief.hash !== "function") throw new Error("Krypto-Bruecke fehlt");
        var hex = brief.hash(text);
        return kodierung === "hex" ? hex : ElfixBuffer(hexNach(hex));
      }
    };
  }

  /**
   * AES-256-GCM.
   *
   * Node rechnet stueckweise: update() gibt schon Geheimtext zurueck, final()
   * den Rest. Java kann nur alles auf einmal. Das passt trotzdem, weil beide
   * Aufrufstellen dasselbe Muster benutzen - `concat([update(x), final()])`.
   * Hier sammelt update() also nur ein, und final() liefert das ganze
   * Ergebnis. Was herauskommt, ist Byte fuer Byte dasselbe.
   */
  function createCipheriv(algorithmus, schluessel, iv) {
    if (String(algorithmus).toLowerCase() !== "aes-256-gcm") {
      throw new Error("Nur aes-256-gcm wird unterstuetzt, nicht " + algorithmus);
    }
    var text = "";
    var marke = null;
    return {
      update: function (wert) {
        text += String(wert);
        return ElfixBuffer([]);
      },
      final: function () {
        var brief = java();
        if (!brief || typeof brief.gcmZu !== "function") throw new Error("Krypto-Bruecke fehlt");
        var antwort = brief.gcmZu(hexAus(ElfixBuffer.from(schluessel)),
          hexAus(ElfixBuffer.from(iv)), text);
        if (!antwort) throw new Error("Verschluesseln fehlgeschlagen");
        var teile = antwort.split(":");
        marke = ElfixBuffer(hexNach(teile[1] || ""));
        return ElfixBuffer(hexNach(teile[0] || ""));
      },
      getAuthTag: function () {
        if (!marke) throw new Error("getAuthTag vor final()");
        return marke;
      }
    };
  }

  function createDecipheriv(algorithmus, schluessel, iv) {
    if (String(algorithmus).toLowerCase() !== "aes-256-gcm") {
      throw new Error("Nur aes-256-gcm wird unterstuetzt, nicht " + algorithmus);
    }
    var daten = [];
    var marke = null;
    return {
      setAuthTag: function (wert) {
        marke = ElfixBuffer.from(wert);
        return this;
      },
      update: function (wert) {
        daten.push(ElfixBuffer.from(wert));
        return ElfixBuffer([]);
      },
      final: function () {
        var brief = java();
        if (!brief || typeof brief.gcmAuf !== "function") throw new Error("Krypto-Bruecke fehlt");
        var klar = brief.gcmAuf(hexAus(ElfixBuffer.from(schluessel)),
          hexAus(ElfixBuffer.from(iv)),
          hexAus(ElfixBuffer.concat(daten)), hexAus(marke || ElfixBuffer([])));
        // Leer heisst hier wirklich "ging nicht": ein leerer Klartext kommt in
        // diesem Modul nicht vor, es wird immer JSON verschluesselt. Der
        // Aufrufer faengt den Fehler und macht daraus ein sauberes null.
        if (!klar) throw new Error("Entschluesseln fehlgeschlagen");
        return ElfixBuffer.from(klar);
      }
    };
  }

  function randomUUID() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    var zufall = randomBytes(16);
    zufall[6] = (zufall[6] & 0x0f) | 0x40;
    zufall[8] = (zufall[8] & 0x3f) | 0x80;
    var hex = hexAus(zufall);
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16)
      + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }

  window.ElfixKnoten = {
    Buffer: ElfixBuffer,
    crypto: {
      webcrypto: window.crypto,
      randomUUID: randomUUID,
      randomBytes: randomBytes,
      hkdfSync: hkdfSync,
      createHmac: createHmac,
      createHash: createHash,
      createCipheriv: createCipheriv,
      createDecipheriv: createDecipheriv
    }
  };

  // Buffer steht in den geteilten Modulen als Globale da, nicht als require.
  window.Buffer = ElfixBuffer;
})();
