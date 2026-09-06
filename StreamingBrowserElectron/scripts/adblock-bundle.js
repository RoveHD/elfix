"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");

require("esbuild").build({
  stdin: { contents: 'export * from "@adguard/tsurlfilter"; export { getRedirectFilename } from "@adguard/scriptlets/redirects";', resolveDir: root },
  bundle: true, platform: "node", format: "cjs", target: "node22",
  minify: true, legalComments: "eof",
  outfile: path.join(root, "build/adblock-runtime.cjs"),
  plugins: [{
    name: "kurze-filter-arbeitspakete",
    setup(build) {
      build.onLoad({ filter: /tsurlfilter[\\/]dist[\\/]es[\\/]index\.js$/ }, async ({ path: datei }) => {
        const text = await fs.promises.readFile(datei, "utf8");
        // Ausschliesslich die Paketgroesse aendern, keine Filtersemantik.
        // Bei einem inkompatiblen Paketupdate bewusst abbrechen.
        if (!text.includes("const CHUNK_SIZE = 5000;")) throw Error("tsurlfilter: Arbeitspaket-Konstante pruefen");
        const pause = "await new Promise((resolve) => { setTimeout(resolve, 0); });";
        if (!text.includes(pause)) throw Error("tsurlfilter: Yield-Stellen pruefen");
        return { contents: text.replace("const CHUNK_SIZE = 5000;", "const CHUNK_SIZE = 250;")
          .replaceAll(pause, "await new Promise((resolve) => { setImmediate(resolve); });"), loader: "js" };
      });
    }
  }]
}).then(() => console.log("Desktop-Adblock gebuendelt (250 Regeln je Arbeitspaket)"))
  .catch(error => { console.error(error); process.exitCode = 1; });
