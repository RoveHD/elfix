"use strict";

/*
 * Anime4K v4.0 (bloc97/Anime4K, MIT) im WebGL2-Pfad des Players. Die Hook-
 * Koerper stammen unveraendert aus spieler-anime4k-shaders.js; hier stehen nur
 * die mpv-Bindungen (NAME_tex, NAME_texOff, NAME_pos, NAME_size, NAME_pt).
 * Ablauf wie Anime4K "Mode A": Restore CNN M auf der Quelle, dann Upscale CNN
 * x2 M und bei Bedarf ein zweites x2 mit S. Das Ergebnis wird bilinear auf die
 * Zielgroesse gebracht. Alle Zwischenbilder liegen wie bei mpv mit y nach
 * unten; erst die Ausgabe dreht fuer die Canvas.
 */
(() => {
  const VERTEX = `#version 300 es
    precision highp float;
    void main() {
      vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
      gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`;
  const AUSGABE = `#version 300 es
    precision highp float;
    precision highp sampler2D;
    uniform sampler2D uBild;
    uniform vec2 uGroesse;
    out vec4 color;
    void main() {
      vec2 p = vec2(gl_FragCoord.x, uGroesse.y - gl_FragCoord.y) / uGroesse;
      color = vec4(clamp(texture(uBild, p).rgb, 0.0, 1.0), 1.0);
    }`;
  // Wie mpvs //!WHEN OUTPUT.w MAIN.w / 1.200 > ...: nur vergroessern, solange
  // noch deutlich Abstand zum Ziel bleibt. Hoechstens zwei x2-Stufen.
  const SCHWELLE = 1.2;

  function hookQuelle(pass) {
    const kopf = ["#version 300 es", "precision highp float;", "precision highp sampler2D;",
      "out vec4 elfixFarbe;", "uniform vec2 elfixAusgabe;"];
    for (const name of pass.binds) {
      kopf.push(`uniform sampler2D ${name}_raw;`, `uniform vec2 ${name}_size;`,
        `#define ${name}_pos (gl_FragCoord.xy / elfixAusgabe)`,
        `#define ${name}_pt (vec2(1.0) / ${name}_size)`,
        `#define ${name}_tex(pos) texture(${name}_raw, pos)`,
        `#define ${name}_texOff(off) ${name}_tex(${name}_pos + ${name}_pt * (off))`);
    }
    return `${kopf.join("\n")}\n${pass.code}\nvoid main() { elfixFarbe = hook(); }\n`;
  }

  function stufen(zielBreite, zielHoehe, breite, hoehe) {
    const liste = ["restoreM"];
    for (const name of ["upscaleM", "upscaleS"]) {
      if (zielBreite / breite <= SCHWELLE || zielHoehe / hoehe <= SCHWELLE) break;
      liste.push(name);
      breite *= 2;
      hoehe *= 2;
    }
    return liste;
  }

  function gpu(gl) {
    const shader = window.ElfixAnime4kShader;
    if (!shader) throw new Error("Anime4K Shader fehlen");
    // Faltungszwischenwerte sind vorzeichenbehaftet und unbeschraenkt.
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("WebGL Float-Framebuffer fehlt");
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const programme = [];
    function programm(fragment) {
      const teile = [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragment]].map(([typ, text]) => {
        const objekt = gl.createShader(typ);
        gl.shaderSource(objekt, text);
        gl.compileShader(objekt);
        if (!gl.getShaderParameter(objekt, gl.COMPILE_STATUS)) {
          const fehler = gl.getShaderInfoLog(objekt);
          gl.deleteShader(objekt);
          throw new Error(`Anime4K Shader: ${fehler}`);
        }
        return objekt;
      });
      const p = gl.createProgram();
      for (const teil of teile) gl.attachShader(p, teil);
      gl.linkProgram(p);
      for (const teil of teile) gl.deleteShader(teil);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const fehler = gl.getProgramInfoLog(p);
        gl.deleteProgram(p);
        throw new Error(`Anime4K Shader: ${fehler}`);
      }
      programme.push(p);
      return p;
    }
    function textur(format) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return { tex: t, format, w: 0, h: 0, fbo: null };
    }
    const netze = {};
    for (const [name, passes] of Object.entries(shader)) {
      netze[name] = passes.map(pass => {
        const p = programm(hookQuelle(pass));
        return { ...pass, programm: p, ausgabe: gl.getUniformLocation(p, "elfixAusgabe"),
          orte: pass.binds.map(bind => [gl.getUniformLocation(p, `${bind}_raw`), gl.getUniformLocation(p, `${bind}_size`)]) };
      });
    }
    const ausgabe = programm(AUSGABE);
    const ausgabeBild = gl.getUniformLocation(ausgabe, "uBild");
    const ausgabeGroesse = gl.getUniformLocation(ausgabe, "uGroesse");
    const vao = gl.createVertexArray();
    const quelle = textur(gl.RGBA8);
    const ziele = new Map();

    function ziel(schluessel, w, h) {
      if (w > max || h > max) throw new Error("WebGL Texturgroesse ueberschritten");
      let t = ziele.get(schluessel);
      if (!t) { t = textur(gl.RGBA16F); t.fbo = gl.createFramebuffer(); ziele.set(schluessel, t); }
      if (t.w !== w || t.h !== h) {
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Anime4K Framebuffer unvollstaendig");
        t.w = w;
        t.h = h;
      }
      return t;
    }
    function netz(name, main) {
      const texturen = { MAIN: main };
      for (const pass of netze[name]) {
        const basis = texturen[pass.groesse[0]];
        const t = ziel(`${name}:${pass.save}`, basis.w * pass.groesse[1], basis.h * pass.groesse[1]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
        gl.viewport(0, 0, t.w, t.h);
        gl.useProgram(pass.programm);
        pass.binds.forEach((bind, i) => {
          const eingabe = texturen[bind];
          gl.activeTexture(gl.TEXTURE0 + i);
          gl.bindTexture(gl.TEXTURE_2D, eingabe.tex);
          gl.uniform1i(pass.orte[i][0], i);
          gl.uniform2f(pass.orte[i][1], eingabe.w, eingabe.h);
        });
        gl.uniform2f(pass.ausgabe, t.w, t.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        texturen[pass.save] = t;
      }
      return texturen.MAIN;
    }
    return {
      max,
      zeichnen(g, video) {
        if ([g.w, g.h, g.inW, g.inH, g.outW, g.outH].some(n => n > max)) throw new Error("WebGL Texturgroesse ueberschritten");
        gl.bindVertexArray(vao);
        gl.disable(gl.BLEND);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, quelle.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        quelle.w = g.inW;
        quelle.h = g.inH;
        let main = quelle;
        for (const name of stufen(g.outW, g.outH, g.inW, g.inH)) main = netz(name, main);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, g.w, g.h);
        gl.useProgram(ausgabe);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, main.tex);
        gl.uniform1i(ausgabeBild, 0);
        gl.uniform2f(ausgabeGroesse, g.w, g.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (gl.getError() !== gl.NO_ERROR) throw new Error("WebGL Renderfehler");
      },
      freigeben() {
        for (const p of programme) gl.deleteProgram(p);
        gl.deleteTexture(quelle.tex);
        for (const t of ziele.values()) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
        gl.deleteVertexArray(vao);
      }
    };
  }
  window.ElfixSpielerAnime4k = Object.freeze({ gpu, stufen });
})();
