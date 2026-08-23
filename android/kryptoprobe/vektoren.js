// Prueffaelle fuer die Java-Seite der Krypto.
//
// Was Node hier ausrechnet, muss auf Android Zeichen fuer Zeichen dasselbe
// sein - sonst kann kein Geraet lesen, was das andere geschrieben hat, und der
// Fehler faellt erst auf, wenn zwei echte Geraete danebenstehen.
const crypto = require("crypto");

const SALZ = Buffer.from("elfix-geraete-v1");
const IKM = Buffer.from("0123456789abcdef0123", "utf8"); // 20 Byte wie ein echter Schluessel
const faelle = { hkdf: {}, hmac: {}, hash: {}, gcm: {} };

for (const [zweck, laenge] of [["raum", 16], ["chiffre", 32], ["kennung", 32]]) {
  faelle.hkdf[zweck] = {
    laenge,
    aus: Buffer.from(crypto.hkdfSync("sha256", IKM, SALZ, Buffer.from(zweck), laenge)).toString("hex")
  };
}

const kennung = Buffer.from(crypto.hkdfSync("sha256", IKM, SALZ, Buffer.from("kennung"), 32));
for (const key of ["serie:one-piece", "film:dune", ""]) {
  faelle.hmac[key] = crypto.createHmac("sha256", kennung).update(String(key)).digest("hex");
}

faelle.hash["{\"a\":1}"] = crypto.createHash("sha256").update("{\"a\":1}").digest("hex");
faelle.hash["ümläut"] = crypto.createHash("sha256").update("ümläut").digest("hex");

// AES-256-GCM mit festem IV, damit das Ergebnis vergleichbar ist.
const chiffreKey = Buffer.from(crypto.hkdfSync("sha256", IKM, SALZ, Buffer.from("chiffre"), 32));
const iv = Buffer.from("000102030405060708090a0b", "hex");
for (const klar of ["{\"progress\":42}", "kurz", "ümläut & sonderzeichen ✓"]) {
  const c = crypto.createCipheriv("aes-256-gcm", chiffreKey, iv);
  const daten = Buffer.concat([c.update(klar, "utf8"), c.final()]);
  faelle.gcm[klar] = {
    daten: daten.toString("hex"),
    tag: c.getAuthTag().toString("hex"),
    // So, wie verschluesseln() es ablegt: iv | tag | daten, base64.
    blob: Buffer.concat([iv, c.getAuthTag(), daten]).toString("base64")
  };
}

faelle.ikmHex = IKM.toString("hex");
faelle.salzHex = SALZ.toString("hex");
faelle.ivHex = iv.toString("hex");
faelle.chiffreHex = chiffreKey.toString("hex");
faelle.kennungHex = kennung.toString("hex");

console.log(JSON.stringify(faelle, null, 2));
