"use strict";

// Prueft die Node-Rueckgabeformen des Android-Krypto-Ersatzes. Die eigentliche
// Java-Rechnung prueft KryptoProbe.java; hier geht es um die letzte Uebersetzung
// in JavaScript, an der der Watchparty-Nachweis vor dem ersten Raumzustand
// abgebrochen war.
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const java = {
  hmac(keyHex, text) {
    return crypto.createHmac("sha256", Buffer.from(keyHex, "hex"))
      .update(String(text), "utf8").digest("hex");
  },
  hash(text) {
    return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
  }
};

const fenster = { AndroidKrypto: java, crypto: crypto.webcrypto };
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "../app/src/main/assets/kern/kern-knoten.js"), "utf8"),
  {
    window: fenster,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    btoa,
    atob
  }
);

const ersatz = fenster.ElfixKnoten.crypto;
const schluessel = "sicherer-watchparty-nachweis";
const nachricht = "elfix-watchparty-device-v2\0wss://watchparty.elfixapp.net/";
assert.strictEqual(
  ersatz.createHmac("sha256", schluessel).update(nachricht).digest("hex"),
  crypto.createHmac("sha256", schluessel).update(nachricht, "utf8").digest("hex"),
  "HMAC hex bleibt Text"
);
assert.strictEqual(
  ersatz.createHmac("sha256", schluessel).update(nachricht).digest("base64"),
  crypto.createHmac("sha256", schluessel).update(nachricht, "utf8").digest("base64"),
  "HMAC base64 muss wie in Node Text sein"
);
const roh = ersatz.createHmac("sha256", schluessel).update(nachricht).digest();
assert.ok(roh instanceof Uint8Array, "HMAC ohne Kodierung bleibt ein Buffer");
assert.strictEqual(
  roh.toString("hex"),
  crypto.createHmac("sha256", schluessel).update(nachricht, "utf8").digest("hex"),
  "HMAC-Buffer enthaelt dieselben Bytes"
);

const hashBase64 = ersatz.createHash("sha256").update(nachricht).digest("base64");
assert.strictEqual(
  hashBase64,
  crypto.createHash("sha256").update(nachricht, "utf8").digest("base64"),
  "SHA-256 base64 folgt derselben Node-Rueckgabeform"
);

console.log("4/4 Android-Knoten-Kryptoproben bestanden");
