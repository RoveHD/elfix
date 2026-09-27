"use strict";

// Erzeugt src/renderer/spieler-anime4k-shaders.js aus den mpv-GLSL-Dateien
// eines Anime4K-Checkouts:
//   git clone https://github.com/bloc97/Anime4K.git
//   git -C Anime4K checkout 7684e9586f8dcc738af08a1cdceb024cc184f426
//   node scripts/anime4k-shaders.js ./Anime4K
// Die Gewichte und Hook-Koerper bleiben unveraendert. Nur die mpv-Kopfzeilen
// werden in Daten (gebundene Texturen, Ziel, Groesse) uebersetzt.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const COMMIT = "7684e9586f8dcc738af08a1cdceb024cc184f426";
const STUFEN = {
  restoreM: "glsl/Restore/Anime4K_Restore_CNN_M.glsl",
  upscaleM: "glsl/Upscale/Anime4K_Upscale_CNN_x2_M.glsl",
  upscaleS: "glsl/Upscale/Anime4K_Upscale_CNN_x2_S.glsl"
};

function groesse(ausdruck, achse) {
  const teile = String(ausdruck || "").trim().split(/\s+/);
  const quelle = /^([A-Za-z0-9_]+)\.([wh])$/.exec(teile[0] || "");
  if (!quelle || quelle[2] !== achse) throw new Error(`Unerwartete Groesse: ${ausdruck}`);
  if (teile.length === 1) return [quelle[1], 1];
  if (teile.length === 3 && teile[2] === "*" && /^[0-9]+$/.test(teile[1])) return [quelle[1], Number(teile[1])];
  throw new Error(`Unerwartete Groesse: ${ausdruck}`);
}

function durchgaenge(text, datei) {
  const bloecke = text.split(/^(?=\/\/!DESC )/m).slice(1);
  return bloecke.map((block) => {
    const zeilen = block.split("\n");
    const kopf = {};
    const binds = [];
    let i = 0;
    for (; i < zeilen.length && zeilen[i].startsWith("//!"); i += 1) {
      const [, schluessel, wert] = /^\/\/!([A-Z]+)\s*(.*)$/.exec(zeilen[i]);
      if (schluessel === "BIND") binds.push(wert.trim());
      else kopf[schluessel] = wert.trim();
    }
    if (kopf.HOOK !== "MAIN" || !kopf.SAVE) throw new Error(`${datei}: nur MAIN-Hooks mit SAVE werden unterstuetzt`);
    const breite = groesse(kopf.WIDTH, "w");
    const hoehe = groesse(kopf.HEIGHT, "h");
    if (breite[0] !== hoehe[0] || breite[1] !== hoehe[1]) throw new Error(`${datei}: ungleiche Achsen`);
    const code = zeilen.slice(i).join("\n").trim();
    if (!/vec4 hook\(\)/.test(code)) throw new Error(`${datei}: hook() fehlt`);
    return { name: kopf.DESC, binds, save: kopf.SAVE, groesse: breite, code };
  });
}

const wurzel = path.resolve(process.argv[2] || "");
let stand = "";
try { stand = execFileSync("git", ["-C", wurzel, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* kein Git */ }
if (stand !== COMMIT) {
  console.error(`Anime4K-Checkout muss auf ${COMMIT} stehen (gefunden: ${stand || "keiner"}).`);
  process.exit(1);
}
const daten = {};
for (const [name, datei] of Object.entries(STUFEN)) {
  daten[name] = durchgaenge(fs.readFileSync(path.join(wurzel, datei), "utf8"), datei);
}
const ziel = path.join(__dirname, "../src/renderer/spieler-anime4k-shaders.js");
fs.writeFileSync(ziel, `"use strict";

// Generiert von scripts/anime4k-shaders.js - nicht von Hand aendern.
// Anime4K v4.0 CNN-Shader, bloc97/Anime4K@${COMMIT}.
// MIT-Lizenz: src/renderer/spieler-anime4k-LICENSE.txt
(() => {
  const STUFEN = ${JSON.stringify(daten, null, 2)};
  window.ElfixAnime4kShader = Object.freeze(STUFEN);
})();
`);
// Dieselben Durchgaenge fuer den Android-Player (Media3-Effekt).
const java = s => JSON.stringify(s).replace(/\u2028|\u2029/g, z => `\\u${z.charCodeAt(0).toString(16)}`);
const javaFeld = { restoreM: "RESTORE_M", upscaleM: "UPSCALE_M", upscaleS: "UPSCALE_S" };
const androidZiel = path.join(__dirname, "../../android/app/src/main/java/local/elflix/android/Anime4kNetze.java");
fs.writeFileSync(androidZiel, `package local.elflix.android;

// Generiert von StreamingBrowserElectron/scripts/anime4k-shaders.js - nicht von
// Hand aendern. Anime4K v4.0 CNN-Shader, bloc97/Anime4K@${COMMIT}.
// MIT-Lizenz: app/src/main/assets/anime4k-LICENSE.txt
final class Anime4kNetze {
    private Anime4kNetze() {}

    /** Ein mpv-Hook: gebundene Texturen, Ziel, Groesse (Bezug x Faktor), Koerper. */
    static final class Pass {
        final String name;
        final String[] binds;
        final String save;
        final String bezug;
        final int faktor;
        final String code;

        Pass(String name, String[] binds, String save, String bezug, int faktor, String code) {
            this.name = name;
            this.binds = binds;
            this.save = save;
            this.bezug = bezug;
            this.faktor = faktor;
            this.code = code;
        }
    }
${Object.entries(daten).map(([name, passes]) => `
    static final Pass[] ${javaFeld[name]} = {
${passes.map(p => `        new Pass(${java(p.name)}, new String[] {${p.binds.map(java).join(", ")}}, ${java(p.save)},
            ${java(p.groesse[0])}, ${p.groesse[1]},
            ${java(p.code)})`).join(",\n")}
    };`).join("\n")}
}
`);
console.log(`${path.relative(process.cwd(), ziel)}: ${Object.entries(daten).map(([n, d]) => `${n} ${d.length}`).join(", ")}`);
console.log(path.relative(process.cwd(), androidZiel));
