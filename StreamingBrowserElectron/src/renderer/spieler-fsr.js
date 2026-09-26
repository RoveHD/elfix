"use strict";

/*
 * AMD FidelityFX Super Resolution 1.0.2, WebGL2 port of the 32-bit EASU and
 * RCAS paths in ffx-fsr/ffx_fsr1.h. See src/renderer/spieler-fsr1-LICENSE.txt.
 * Upstream: GPUOpen-Effects/FidelityFX-FSR@a21ffb8f6c13233ba336352bdff293894c706575
 */
(() => {
  const VERTEX = `#version 300 es
    precision highp float;
    void main() {
      vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
      gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`;

  // AMD's FsrEasuF/FsrEasuSetF/FsrEasuTapF, using texelFetch in place of
  // textureGather. Source pixels and filter arithmetic are otherwise the
  // same. gl_FragCoord is used only for the current output pixel position.
  const EASU = `#version 300 es
    precision highp float;
    precision highp sampler2D;
    uniform sampler2D uInput;
    uniform vec2 uInputSize;
    uniform vec2 uOutputSize;
    out vec4 color;

    vec3 loadPixel(ivec2 p) {
      return texelFetch(uInput, clamp(p, ivec2(0), ivec2(uInputSize) - 1), 0).rgb;
    }
    float luma(vec3 c) { return c.g + 0.5 * (c.r + c.b); }
    void easuSet(inout vec2 dir, inout float len, vec2 pp, float w,
                 float a, float b, float c, float d, float e) {
      float dx = d - b;
      dir.x += dx * w;
      float lx = clamp(abs(dx) / max(max(abs(d - c), abs(c - b)), 1e-8), 0.0, 1.0);
      len += lx * lx * w;
      float dy = e - a;
      dir.y += dy * w;
      float ly = clamp(abs(dy) / max(max(abs(e - c), abs(c - a)), 1e-8), 0.0, 1.0);
      len += ly * ly * w;
    }
    void easuTap(inout vec3 sum, inout float weight, vec2 off,
                 vec2 dir, vec2 len, float lob, float clp, vec3 tap) {
      vec2 v = vec2(dot(off, dir), dot(off, vec2(-dir.y, dir.x))) * len;
      float d2 = min(dot(v, v), clp);
      float wb = 0.4 * d2 - 1.0;
      float wa = lob * d2 - 1.0;
      float w = (1.5625 * wb * wb - 0.5625) * wa * wa;
      sum += tap * w;
      weight += w;
    }
    void main() {
      vec2 inputPosition = (gl_FragCoord.xy - vec2(0.5)) * uInputSize / uOutputSize
                           + (0.5 * uInputSize / uOutputSize - 0.5);
      ivec2 f = ivec2(floor(inputPosition));
      vec2 pp = fract(inputPosition);
      vec3 b = loadPixel(f + ivec2( 0,-1));
      vec3 c = loadPixel(f + ivec2( 1,-1));
      vec3 e = loadPixel(f + ivec2(-1, 0));
      vec3 g = loadPixel(f + ivec2( 1, 0));
      vec3 h = loadPixel(f + ivec2( 2, 0));
      vec3 i = loadPixel(f + ivec2(-1, 1));
      vec3 j = loadPixel(f + ivec2( 0, 1));
      vec3 k = loadPixel(f + ivec2( 1, 1));
      vec3 l = loadPixel(f + ivec2( 2, 1));
      vec3 n = loadPixel(f + ivec2( 0, 2));
      vec3 o = loadPixel(f + ivec2( 1, 2));
      vec3 center = loadPixel(f);
      float bl = luma(b), cl = luma(c), el = luma(e), fl = luma(center);
      float gl = luma(g), hl = luma(h), il = luma(i), jl = luma(j);
      float kl = luma(k), ll = luma(l), nl = luma(n), ol = luma(o);
      vec2 dir = vec2(0.0);
      float len = 0.0;
      easuSet(dir,len,pp,(1.0-pp.x)*(1.0-pp.y),bl,el,fl,gl,jl);
      easuSet(dir,len,pp,pp.x*(1.0-pp.y),cl,fl,gl,hl,kl);
      easuSet(dir,len,pp,(1.0-pp.x)*pp.y,fl,il,jl,kl,nl);
      easuSet(dir,len,pp,pp.x*pp.y,gl,jl,kl,ll,ol);
      float dir2 = dot(dir, dir);
      dir = dir2 < (1.0 / 32768.0) ? vec2(1.0, 0.0) : dir * inversesqrt(dir2);
      len = 0.5 * len;
      len *= len;
      float stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
      vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
      float lob = 0.5 + ((0.25 - 0.04) - 0.5) * len;
      float clp = 1.0 / lob;
      vec3 min4 = min(min(center, g), min(j, k));
      vec3 max4 = max(max(center, g), max(j, k));
      vec3 sum = vec3(0.0);
      float weight = 0.0;
      easuTap(sum,weight,vec2( 0,-1)-pp,dir,len2,lob,clp,b);
      easuTap(sum,weight,vec2( 1,-1)-pp,dir,len2,lob,clp,c);
      easuTap(sum,weight,vec2(-1, 1)-pp,dir,len2,lob,clp,i);
      easuTap(sum,weight,vec2( 0, 1)-pp,dir,len2,lob,clp,j);
      easuTap(sum,weight,vec2( 0, 0)-pp,dir,len2,lob,clp,center);
      easuTap(sum,weight,vec2(-1, 0)-pp,dir,len2,lob,clp,e);
      easuTap(sum,weight,vec2( 1, 1)-pp,dir,len2,lob,clp,k);
      easuTap(sum,weight,vec2( 2, 1)-pp,dir,len2,lob,clp,l);
      easuTap(sum,weight,vec2( 2, 0)-pp,dir,len2,lob,clp,h);
      easuTap(sum,weight,vec2( 1, 0)-pp,dir,len2,lob,clp,g);
      easuTap(sum,weight,vec2( 1, 2)-pp,dir,len2,lob,clp,o);
      easuTap(sum,weight,vec2( 0, 2)-pp,dir,len2,lob,clp,n);
      color = vec4(clamp(sum / max(weight, 1e-8), min4, max4), 1.0);
    }`;

  // AMD's FsrRcasF, 32-bit path, applied to the EASU framebuffer.
  const RCAS = `#version 300 es
    precision highp float;
    precision highp sampler2D;
    uniform sampler2D uInput;
    uniform ivec2 uSize;
    uniform ivec2 uOrigin;
    uniform float uSharpness;
    out vec4 color;
    vec3 loadPixel(ivec2 p) {
      return texelFetch(uInput, clamp(p, ivec2(0), uSize - 1), 0).rgb;
    }
    void main() {
      ivec2 p = ivec2(gl_FragCoord.xy) - uOrigin;
      vec3 b = loadPixel(p + ivec2(0,-1));
      vec3 d = loadPixel(p + ivec2(-1,0));
      vec3 e = loadPixel(p);
      vec3 f = loadPixel(p + ivec2(1,0));
      vec3 h = loadPixel(p + ivec2(0,1));
      vec3 mn4 = min(min(b,d),min(f,h));
      vec3 mx4 = max(max(b,d),max(f,h));
      vec3 hitMin = min(mn4,e) / max(4.0 * mx4, vec3(1e-8));
      // AMD's denominator reaches zero on uniform white. Keep its negative
      // sign while avoiding 0/0 and NaN propagation on that legal input.
      vec3 hitMax = (vec3(1.0) - max(mx4,e)) / min(4.0 * mn4 - vec3(4.0), vec3(-1e-8));
      vec3 lobes = max(-hitMin, hitMax);
      float lobe = max(-0.1875, min(max(lobes.r,max(lobes.g,lobes.b)),0.0))
                   * exp2(-uSharpness);
      color = vec4(clamp((lobe*(b+d+f+h)+e)/(4.0*lobe+1.0),0.0,1.0),1.0);
    }`;

  function erstellen({ video, canvas, beiStatus = () => {} }) {
    if (!video || !canvas) throw new TypeError("FSR benoetigt Video und Canvas");
    let aktiv = false;
    let zerstoert = false;
    let gl = null;
    let gpu = null;
    let frameId = null;
    let resizeObserver = null;
    let quellfehler = false;
    let quelle = "";
    let gemeldet = "";
    const ursprungsOpacity = video.style.opacity;

    function status(zustand, grund, eingang, ausgang) {
      const wert = { zustand, grund };
      if (eingang) wert.eingang = eingang;
      if (ausgang) wert.ausgang = ausgang;
      const text = JSON.stringify(wert);
      if (text !== gemeldet) {
        gemeldet = text;
        beiStatus(wert);
      }
    }
    function original() {
      video.style.opacity = ursprungsOpacity;
      canvas.hidden = true;
    }
    function frameAbbrechen() {
      if (frameId !== null && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameId);
      frameId = null;
    }
    function shader(typ, quelltext) {
      const objekt = gl.createShader(typ);
      gl.shaderSource(objekt, quelltext);
      gl.compileShader(objekt);
      if (!gl.getShaderParameter(objekt, gl.COMPILE_STATUS)) {
        const fehler = gl.getShaderInfoLog(objekt);
        gl.deleteShader(objekt);
        throw new Error(`FSR Shader: ${fehler}`);
      }
      return objekt;
    }
    function programm(fragment) {
      const v = shader(gl.VERTEX_SHADER, VERTEX);
      const f = shader(gl.FRAGMENT_SHADER, fragment);
      const p = gl.createProgram();
      gl.attachShader(p, v);
      gl.attachShader(p, f);
      gl.linkProgram(p);
      gl.deleteShader(v);
      gl.deleteShader(f);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const fehler = gl.getProgramInfoLog(p);
        gl.deleteProgram(p);
        throw new Error(`FSR Programm: ${fehler}`);
      }
      return p;
    }
    function textur() {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    function gpuVorbereiten() {
      if (!gl) gl = canvas.getContext("webgl2", {
        alpha: false, antialias: false, depth: false, stencil: false,
        preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: true
      });
      if (!gl) throw new Error("WebGL2 ist nicht verfuegbar");
      if (gpu) return gpu;
      const easu = programm(EASU);
      const rcas = programm(RCAS);
      gpu = {
        easu, rcas,
        quelle: textur(), zwischen: textur(), fbo: gl.createFramebuffer(),
        vao: gl.createVertexArray(),
        max: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        ausgabeBreite: 0, ausgabeHoehe: 0
      };
      return gpu;
    }
    function gpuFreigeben() {
      if (!gpu || !gl || gl.isContextLost()) { gpu = null; return; }
      gl.deleteProgram(gpu.easu);
      gl.deleteProgram(gpu.rcas);
      gl.deleteTexture(gpu.quelle);
      gl.deleteTexture(gpu.zwischen);
      gl.deleteFramebuffer(gpu.fbo);
      gl.deleteVertexArray(gpu.vao);
      gpu = null;
    }
    function untertitelSichtbar() {
      for (let i = 0; i < video.textTracks.length; i += 1) {
        const spur = video.textTracks[i];
        if ((spur.kind === "subtitles" || spur.kind === "captions") && spur.mode === "showing") return true;
      }
      return false;
    }
    function groessen() {
      const rect = video.getBoundingClientRect();
      const cssW = rect.width;
      const cssH = rect.height;
      const inW = video.videoWidth;
      const inH = video.videoHeight;
      if (!(cssW > 0 && cssH > 0 && inW > 0 && inH > 0)) return null;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const w = Math.round(cssW * dpr);
      const h = Math.round(cssH * dpr);
      const faktor = Math.min(w / inW, h / inH);
      const outW = Math.round(inW * faktor);
      const outH = Math.round(inH * faktor);
      const x = Math.floor((w - outW) / 2);
      const y = Math.floor((h - outH) / 2);
      return { w, h, inW, inH, outW, outH, x, y };
    }
    function bereitPruefen() {
      if (!aktiv || zerstoert) return { zustand: "aus", grund: "deaktiviert" };
      if (document.hidden) return { zustand: "bereit", grund: "fenster-verdeckt" };
      if (document.pictureInPictureElement === video) return { zustand: "bereit", grund: "bild-in-bild" };
      if (untertitelSichtbar()) return { zustand: "bereit", grund: "native-untertitel" };
      if (!video.requestVideoFrameCallback) return { zustand: "nicht-verfuegbar", grund: "videobild-rueckruf-fehlt" };
      if (quellfehler) return { zustand: "nicht-verfuegbar", grund: "video-kann-nicht-auf-gpu-kopiert-werden" };
      if (gl && gl.isContextLost()) return { zustand: "nicht-verfuegbar", grund: "gpu-kontext-verloren" };
      if (video.seeking || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return { zustand: "bereit", grund: "warte-auf-videobild" };
      const g = groessen();
      if (!g) return { zustand: "bereit", grund: "warte-auf-videogroesse" };
      const eingang = { breite: g.inW, hoehe: g.inH };
      const ausgang = { breite: g.outW, hoehe: g.outH };
      if (g.outW <= g.inW || g.outH <= g.inH) return { zustand: "nicht-noetig", grund: "ausgabe-nicht-groesser", eingang, ausgang };
      // Keep allocations bounded even on unusually large displays/videos.
      if (g.w > 3840 || g.h > 2160 || g.w * g.h > 8294400)
        return { zustand: "nicht-verfuegbar", grund: "ausgabe-ueber-4k-grenze", eingang, ausgang };
      return { zustand: "rendern", grund: "", eingang, ausgang, groesse: g };
    }
    function frameAnfordern() {
      if (frameId !== null || !aktiv || zerstoert || !video.requestVideoFrameCallback) return;
      frameId = video.requestVideoFrameCallback(() => {
        frameId = null;
        aktualisieren(true);
      });
    }
    function zeichnen(g) {
      const res = gpuVorbereiten();
      if ([g.w,g.h,g.inW,g.inH,g.outW,g.outH].some(n => n > res.max)) throw new Error("WebGL Texturgroesse ueberschritten");
      if (canvas.width !== g.w || canvas.height !== g.h) {
        canvas.width = g.w;
        canvas.height = g.h;
      }
      gl.bindVertexArray(res.vao);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.bindTexture(gl.TEXTURE_2D, res.quelle);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      if (res.ausgabeBreite !== g.outW || res.ausgabeHoehe !== g.outH) {
        gl.bindTexture(gl.TEXTURE_2D, res.zwischen);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, g.outW, g.outH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, res.zwischen, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("FSR Framebuffer unvollstaendig");
        res.ausgabeBreite = g.outW;
        res.ausgabeHoehe = g.outH;
      }
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo);
      gl.viewport(0, 0, g.outW, g.outH);
      gl.useProgram(res.easu);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, res.quelle);
      gl.uniform1i(gl.getUniformLocation(res.easu, "uInput"), 0);
      gl.uniform2f(gl.getUniformLocation(res.easu, "uInputSize"), g.inW, g.inH);
      gl.uniform2f(gl.getUniformLocation(res.easu, "uOutputSize"), g.outW, g.outH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, g.w, g.h);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.viewport(g.x, g.y, g.outW, g.outH);
      gl.useProgram(res.rcas);
      gl.bindTexture(gl.TEXTURE_2D, res.zwischen);
      gl.uniform1i(gl.getUniformLocation(res.rcas, "uInput"), 0);
      gl.uniform2i(gl.getUniformLocation(res.rcas, "uSize"), g.outW, g.outH);
      gl.uniform2i(gl.getUniformLocation(res.rcas, "uOrigin"), g.x, g.y);
      gl.uniform1f(gl.getUniformLocation(res.rcas, "uSharpness"), 0.8);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (gl.getError() !== gl.NO_ERROR) throw new Error("WebGL Renderfehler");
    }
    function aktualisieren(neuesBild = false) {
      if (video.currentSrc !== quelle) {
        quelle = video.currentSrc;
        quellfehler = false;
        original();
      }
      const pruefung = bereitPruefen();
      if (pruefung.zustand !== "rendern") {
        original();
        status(pruefung.zustand, pruefung.grund, pruefung.eingang, pruefung.ausgang);
        if (pruefung.zustand === "nicht-verfuegbar" || pruefung.zustand === "aus") frameAbbrechen();
        else if (aktiv && !document.hidden && !untertitelSichtbar()) frameAnfordern();
        return;
      }
      try {
        // A frame callback supplies each playing frame; explicit redraws cover
        // activation, resizing and a paused frame. No timer runs while off.
        if (neuesBild || canvas.hidden) zeichnen(pruefung.groesse);
        canvas.hidden = false;
        video.style.opacity = "0";
        status("aktiv", "easu-rcas", pruefung.eingang, pruefung.ausgang);
        frameAnfordern();
      } catch (fehler) {
        quellfehler = true;
        original();
        frameAbbrechen();
        status("nicht-verfuegbar", fehler && /WebGL|Shader|Framebuffer|GPU|Textur/.test(String(fehler))
          ? "gpu-fehler" : "video-kann-nicht-auf-gpu-kopiert-werden", pruefung.eingang, pruefung.ausgang);
      }
    }
    function quelleWechselt() {
      quellfehler = false;
      quelle = video.currentSrc;
      original();
      frameAbbrechen();
      aktualisieren();
    }
    function videoEreignis() {
      if (video.currentSrc !== quelle) quelleWechselt();
      else aktualisieren(true);
    }
    function verloren(event) {
      event.preventDefault();
      gpu = null;
      original();
      frameAbbrechen();
      status("nicht-verfuegbar", "gpu-kontext-verloren");
    }
    function wiederhergestellt() {
      gl = null;
      gpu = null;
      quellfehler = false;
      aktualisieren(true);
    }
    function spurGeaendert() { aktualisieren(true); }
    function spurHinzu(event) {
      event.track.addEventListener("cuechange", spurGeaendert);
      aktualisieren(true);
    }
    function spurEntfernt(event) {
      event.track.removeEventListener("cuechange", spurGeaendert);
      aktualisieren(true);
    }
    video.addEventListener("loadstart", quelleWechselt);
    video.addEventListener("emptied", quelleWechselt);
    video.addEventListener("loadeddata", videoEreignis);
    video.addEventListener("resize", videoEreignis);
    video.addEventListener("seeking", videoEreignis);
    video.addEventListener("seeked", videoEreignis);
    video.addEventListener("enterpictureinpicture", spurGeaendert);
    video.addEventListener("leavepictureinpicture", spurGeaendert);
    video.textTracks.addEventListener("change", spurGeaendert);
    video.textTracks.addEventListener("addtrack", spurHinzu);
    video.textTracks.addEventListener("removetrack", spurEntfernt);
    for (const spur of video.textTracks) spur.addEventListener("cuechange", spurGeaendert);
    document.addEventListener("visibilitychange", spurGeaendert);
    canvas.addEventListener("webglcontextlost", verloren);
    canvas.addEventListener("webglcontextrestored", wiederhergestellt);
    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(() => aktualisieren(true));
      resizeObserver.observe(video);
    } else window.addEventListener("resize", spurGeaendert);
    original();
    status("aus", "deaktiviert");
    return {
      setzeAktiv(wert) {
        if (zerstoert) return;
        aktiv = Boolean(wert);
        if (!aktiv) {
          frameAbbrechen();
          original();
          status("aus", "deaktiviert");
        } else aktualisieren(true);
      },
      zerstoeren() {
        if (zerstoert) return;
        zerstoert = true;
        aktiv = false;
        frameAbbrechen();
        original();
        gpuFreigeben();
        video.removeEventListener("loadstart", quelleWechselt);
        video.removeEventListener("emptied", quelleWechselt);
        video.removeEventListener("loadeddata", videoEreignis);
        video.removeEventListener("resize", videoEreignis);
        video.removeEventListener("seeking", videoEreignis);
        video.removeEventListener("seeked", videoEreignis);
        video.removeEventListener("enterpictureinpicture", spurGeaendert);
        video.removeEventListener("leavepictureinpicture", spurGeaendert);
        video.textTracks.removeEventListener("change", spurGeaendert);
        video.textTracks.removeEventListener("addtrack", spurHinzu);
        video.textTracks.removeEventListener("removetrack", spurEntfernt);
        for (const spur of video.textTracks) spur.removeEventListener("cuechange", spurGeaendert);
        document.removeEventListener("visibilitychange", spurGeaendert);
        canvas.removeEventListener("webglcontextlost", verloren);
        canvas.removeEventListener("webglcontextrestored", wiederhergestellt);
        resizeObserver?.disconnect();
        window.removeEventListener("resize", spurGeaendert);
        status("aus", "deaktiviert");
      }
    };
  }
  window.ElfixSpielerFsr = Object.freeze({ erstellen });
})();
