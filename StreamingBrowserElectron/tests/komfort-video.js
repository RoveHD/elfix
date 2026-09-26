"use strict";
const fs = require("node:fs");
// Ein winziges selbst gezeichnetes Video, ohne Codec-Tools oder fremde Medien.
module.exports = async function komfortVideo(fenster, datei, { width = 160, height = 90, durationMs = 2500, colorDurationMs = 700 } = {}) {
  // Hidden Chromium windows may never composite the capture canvas. Give the
  // recorder a surface without focusing or displaying it, and restore it after.
  const sichtbar = fenster.isVisible(), deckkraft = fenster.getOpacity();
  if (!sichtbar) { fenster.setOpacity(0); fenster.showInactive(); }
  let bytes;
  try {
    bytes = await fenster.webContents.executeJavaScript(`new Promise(resolve => {
    const c=document.createElement('canvas'); c.width=${Number(width)}; c.height=${Number(height)};
    const ctx=c.getContext('2d'); let beginn=performance.now();
    const malen=()=>{ctx.fillStyle=performance.now()-beginn<${Number(colorDurationMs)}?'#ff0000':performance.now()-beginn<${Number(colorDurationMs)*2}?'#00ff00':'#0000ff';ctx.fillRect(0,0,c.width,c.height)};
    document.body.appendChild(c);
    const stream=c.captureStream(0), track=stream.getVideoTracks()[0];
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:64000});
    const teile=[];recorder.ondataavailable=e=>teile.push(e.data);
    const bild=()=>{malen();track.requestFrame()};
    recorder.onstart=()=>{
      beginn=performance.now();
      setTimeout(()=>recorder.stop(),${Number(durationMs)});
    };
    recorder.onstop=async()=>{clearInterval(timer);stream.getTracks().forEach(t=>t.stop());c.remove();resolve(Array.from(new Uint8Array(await new Blob(teile).arrayBuffer())))};
    recorder.start();
    bild();const timer=setInterval(bild,50);
    })`);
  } finally {
    if (!sichtbar) { fenster.hide(); fenster.setOpacity(deckkraft); }
  }
  const video = Buffer.from(bytes);
  fs.writeFileSync(datei,video);
  return video;
};
