"use strict";
const path = require("node:path");
require("esbuild").build({
  entryPoints: [path.join(__dirname, "../src/preload.js")],
  outfile: path.join(__dirname, "../build/preload.cjs"),
  bundle: true,
  platform: "browser",
  format: "cjs",
  external: ["electron"],
  plugins: [{ name: "browser-crypto", setup(build) {
    build.onResolve({ filter: /^(?:node:)?crypto$/ }, () => ({ path: "crypto", namespace: "browser-crypto" }));
    build.onLoad({ filter: /.*/, namespace: "browser-crypto" }, () => ({ contents: "module.exports = { webcrypto: globalThis.crypto };" }));
  } }],
  target: "chrome138",
  legalComments: "none"
}).catch(error => { console.error(error); process.exitCode = 1; });
