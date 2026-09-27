"use strict";

// CPU-Referenz fuer die Anime4K-Durchgaenge aus spieler-anime4k-shaders.js.
// Sie liest dieselben Hook-Koerper und rechnet sie mit mpv-Semantik nach:
// texOff mit Randklemmung, tex(pos) bilinear, y zeigt im Bild nach unten.
const path = require("node:path");

function shaderLaden() {
  const vorher = global.window;
  global.window = {};
  const datei = path.join(__dirname, "../src/renderer/spieler-anime4k-shaders.js");
  delete require.cache[require.resolve(datei)];
  require(datei);
  const shader = global.window.ElfixAnime4kShader;
  global.window = vorher;
  return shader;
}

function bild(w, h) { return { w, h, d: new Float64Array(w * h * 4) }; }
function texel(b, x, y) {
  const i = (Math.min(b.h - 1, Math.max(0, y)) * b.w + Math.min(b.w - 1, Math.max(0, x))) * 4;
  return [b.d[i], b.d[i + 1], b.d[i + 2], b.d[i + 3]];
}
function bilinear(b, u, v) {
  const x = u * b.w - 0.5, y = v * b.h - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const a = texel(b, x0, y0), c = texel(b, x0 + 1, y0), e = texel(b, x0, y0 + 1), f = texel(b, x0 + 1, y0 + 1);
  return a.map((_, k) => (a[k] * (1 - fx) + c[k] * fx) * (1 - fy) + (e[k] * (1 - fx) + f[k] * fx) * fy);
}

function uebersetzen(pass) {
  const quellen = {};
  const terme = [];
  let bias = [0, 0, 0, 0];
  let rest = null;
  for (const zeile of pass.code.split("\n").map(z => z.trim())) {
    let m;
    if ((m = /^#define (\w+)(\(x_off, y_off\))? \((?:max\((-?)\((\w+)_tex(?:Off)?\(.*\)\), 0\.0\)|(\w+)_texOff\(.*\))\)$/.exec(zeile))) {
      quellen[m[1]] = { bind: m[4] || m[5], negativ: m[3] === "-", relu: !m[5] };
    } else if ((m = /^(?:vec4 result = |result \+= )mat4\(([^)]*)\) \* (\w+)(?:\((-?[01])\.0, (-?[01])\.0\))?;$/.exec(zeile))) {
      terme.push({ matrix: m[1].split(",").map(Number), quelle: m[2], dx: Number(m[3] || 0), dy: Number(m[4] || 0) });
    } else if ((m = /^result \+= vec4\(([^)]*)\);$/.exec(zeile))) {
      bias = m[1].split(",").map(Number);
    } else if (/^return result( \+ MAIN_tex\(MAIN_pos\))?;$/.test(zeile)) {
      rest = zeile.includes("MAIN_tex") ? "main" : "keiner";
    } else if (zeile.startsWith("return vec4(c0, c1, c2, c3)")) {
      rest = "tiefe";
    }
  }
  if (!rest) throw new Error(`Unbekannter Durchgang: ${pass.name}`);
  return { quellen, terme, bias, rest };
}

function durchgang(pass, texturen) {
  const basis = texturen[pass.groesse[0]];
  const aus = bild(basis.w * pass.groesse[1], basis.h * pass.groesse[1]);
  const p = uebersetzen(pass);
  for (let y = 0; y < aus.h; y += 1) {
    for (let x = 0; x < aus.w; x += 1) {
      const u = (x + 0.5) / aus.w, v = (y + 0.5) / aus.h;
      let wert;
      if (p.rest === "tiefe") {
        const tief = texturen.conv2d_last_tf;
        const tx = Math.floor(u * tief.w), ty = Math.floor(v * tief.h);
        const i0x = Math.floor((u * tief.w - tx) * 2), i0y = Math.floor((v * tief.h - ty) * 2);
        const c = texel(tief, tx, ty)[i0y * 2 + i0x];
        wert = bilinear(texturen.MAIN, u, v).map(k => k + c);
      } else {
        wert = p.bias.slice();
        for (const term of p.terme) {
          const q = p.quellen[term.quelle];
          const b = texturen[q.bind];
          const sx = Math.round(u * b.w - 0.5), sy = Math.round(v * b.h - 0.5);
          const t = texel(b, sx + term.dx, sy + term.dy).map(k => q.relu ? Math.max(q.negativ ? -k : k, 0) : k);
          for (let spalte = 0; spalte < 4; spalte += 1) {
            for (let zeile = 0; zeile < 4; zeile += 1) wert[zeile] += term.matrix[spalte * 4 + zeile] * t[spalte];
          }
        }
        if (p.rest === "main") wert = bilinear(texturen.MAIN, u, v).map((k, i) => k + wert[i]);
      }
      aus.d.set(wert, (y * aus.w + x) * 4);
    }
  }
  return aus;
}

/** rgba: Uint8 RGBA, Zeile 0 oben. Liefert Float-RGBA des letzten MAIN. */
function rechnen(stufen, rgba, w, h) {
  const shader = shaderLaden();
  let main = bild(w, h);
  for (let i = 0; i < rgba.length; i += 1) main.d[i] = rgba[i] / 255;
  for (const name of stufen) {
    const texturen = { MAIN: main };
    for (const pass of shader[name]) texturen[pass.save] = durchgang(pass, texturen);
    main = texturen.MAIN;
  }
  return main;
}

module.exports = { rechnen };
