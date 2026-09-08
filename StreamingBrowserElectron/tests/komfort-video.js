"use strict";
const fs = require("node:fs");
// Ein winziges selbst gezeichnetes Video, ohne Codec-Tools oder fremde Medien.
module.exports = async function komfortVideo(fenster, datei) {
  const bytes = await fenster.webContents.executeJavaScript(`new Promise(resolve => {
    const c=document.createElement('canvas'); c.width=160; c.height=90;
    const ctx=c.getContext('2d'); const beginn=performance.now();
    const malen=()=>{ctx.fillStyle=performance.now()-beginn<700?'#ff0000':performance.now()-beginn<1400?'#00ff00':'#0000ff';ctx.fillRect(0,0,160,90)};
    malen(); const stream=c.captureStream(20);
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:64000});
    const teile=[];recorder.ondataavailable=e=>teile.push(e.data);
    const timer=setInterval(malen,50);
    recorder.onstop=async()=>{clearInterval(timer);stream.getTracks().forEach(t=>t.stop());resolve(Array.from(new Uint8Array(await new Blob(teile).arrayBuffer())))};
    recorder.start();setTimeout(()=>recorder.stop(),2500);
  })`);
  const video = Buffer.from(bytes);
  fs.writeFileSync(datei,video);
  return video;
};
