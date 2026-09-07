"use strict";

// Generate an original video with a visible frame counter for physical-device QA.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "elfix-video-fixture-")));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await win.loadURL("data:text/html,<canvas width='640' height='360'></canvas>");
  const data = await win.webContents.executeJavaScript(`new Promise(resolve => {
    const canvas = document.querySelector('canvas'), context = canvas.getContext('2d');
    const recorder = new MediaRecorder(canvas.captureStream(25), { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 600000 });
    const chunks = []; let frame = 0;
    const draw = () => {
      context.fillStyle = '#182c49'; context.fillRect(0,0,640,360);
      context.fillStyle = '#50ddca'; context.fillRect(frame % 600, 270, 40, 40);
      context.fillStyle = '#ffffff'; context.font = '32px sans-serif';
      context.fillText('ELFIX Watchparty', 40, 60);
      context.font = 'bold 64px monospace'; context.fillText('Frame ' + frame++, 40, 170);
      context.font = '24px monospace'; context.fillText('25 Bilder pro Sekunde', 40, 220);
    };
    draw(); const timer = setInterval(draw, 40);
    recorder.ondataavailable = event => chunks.push(event.data);
    recorder.onstop = async () => { clearInterval(timer); resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()))); };
    recorder.start(); setTimeout(() => recorder.stop(), 65000);
  })`);
  const file = path.resolve(__dirname, "../../build/watchparty-fixture.webm");
  fs.writeFileSync(file, Buffer.from(data)); console.log(file); win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
