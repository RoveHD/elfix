'use strict';

// Manual Windows/RTX regression: ELFIX_RTX_HARDWARE=1 electron tests/rtx-first-frame-electrontest.js
// The first VSR output must match the next output for exactly the same input.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, sharedTexture } = require('electron');
const { erstellen } = require('../src/rtx-video');

if (process.env.ELFIX_RTX_HARDWARE !== '1') {
  console.log('SKIP RTX first-frame hardware test (set ELFIX_RTX_HARDWARE=1)');
  process.exit(0);
}
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'elfix-rtx-first-profile-')));
app.on('window-all-closed', () => {});

function pattern() {
  const width = 640, height = 360;
  const bytes = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; ++y) {
    for (let x = 0; x < width; ++x) {
      const block = ((Math.floor(x / 16) * 13 + Math.floor(y / 16) * 7) % 3) - 1;
      let value = 42 + block;
      if (y >= 75 && y < 87 && x >= 20 && x < 620) {
        value = 45 + Math.round(155 * (1 - Math.abs(x - 320) / 300));
      }
      if (x >= 25 && x < 260 && y >= 100 && y < 325) {
        const diagonal = (x - Math.floor((y - 100) * 0.5) + 1300) % 7;
        if (diagonal === 0) value = 210;
      }
      const radius = Math.hypot(x - 450, y - 215);
      if (radius >= 10 && radius <= 110 &&
          Math.abs(radius - Math.round(radius / 5) * 5) < 0.55) value = 185;
      // Preserve a large low-detail bottom region where the original first-
      // evaluation defect created coherent rectangular artifacts.
      const offset = (y * width + x) * 4;
      bytes[offset] = bytes[offset + 1] = bytes[offset + 2] = value;
      bytes[offset + 3] = 255;
    }
  }
  return bytes;
}

async function waitFor(test, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await test()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('RTX first-frame test timed out');
}

let window;
let engine;
const timeout = setTimeout(() => {
  console.error('RTX first-frame test timed out globally');
  app.exit(1);
}, 90000);

async function runCase(runtime, pixel, outputWidth, outputHeight) {
  window = new BrowserWindow({ show: false, width: 1280, height: 720,
    webPreferences: { preload: path.join(__dirname, '../src/spieler-preload.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false } });
  await window.loadURL('about:blank');
  window.setOpacity(0);
  window.showInactive();
  await window.webContents.executeJavaScript(`
    window.rtxFirstFrame = {count: 0, differences: [], varyingPixels: 0, error: null};
    window.rtxExpectedSize = {width: ${outputWidth}, height: ${outputHeight}};
    window.addEventListener('message', async (event) => {
      if (event.source !== window || event.data?.type !== 'elfix-rtx-frame') return;
      const frame = event.data.frame;
      try {
        if (frame.codedWidth !== window.rtxExpectedSize.width ||
            frame.codedHeight !== window.rtxExpectedSize.height) {
          throw Error('Unexpected coded frame size: ' + frame.codedWidth + 'x' + frame.codedHeight);
        }
        const pixels = new Uint8Array(frame.codedWidth * frame.codedHeight * 4);
        const layout = await frame.copyTo(pixels, {format: 'RGBA'});
        if (layout.length !== 1 || layout[0].offset !== 0 ||
            layout[0].stride !== frame.codedWidth * 4) {
          throw Error('Unexpected RGBA copy layout: ' + JSON.stringify(layout));
        }
        const state = window.rtxFirstFrame;
        if (!state.previous) {
          let low = 255, high = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            low = Math.min(low, pixels[i]); high = Math.max(high, pixels[i]);
          }
          state.varyingPixels = high - low;
        } else {
          let changed = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] !== state.previous[i] || pixels[i+1] !== state.previous[i+1] ||
                pixels[i+2] !== state.previous[i+2] || pixels[i+3] !== state.previous[i+3]) changed++;
          }
          state.differences.push(changed);
        }
        state.previous = pixels;
        state.count++;
      } catch (error) {
        window.rtxFirstFrame.error = String(error);
      } finally { frame.close(); }
    });
    void 0;
  `);
  engine = erstellen({ verzeichnis: runtime,
    datenVerzeichnis: fs.mkdtempSync(path.join(os.tmpdir(), 'elfix-rtx-first-frame-')),
    sharedTexture });
  const basic = { pixel, width: 640, height: 360,
    outputWidth, outputHeight, generation: 1,
    webContents: window.webContents };
  const first = await engine.bild({ ...basic, frameId: 1 });
  assert.deepEqual(first, { ok: true });
  await waitFor(() => window.webContents.executeJavaScript('window.rtxFirstFrame.count >= 1 || !!window.rtxFirstFrame.error'));
  for (let frameId = 2; frameId <= 4; frameId++) {
    const next = await engine.bild({ ...basic, frameId });
    assert.deepEqual(next, { ok: true });
    await waitFor(() => window.webContents.executeJavaScript(`window.rtxFirstFrame.count >= ${frameId} || !!window.rtxFirstFrame.error`));
  }
  const result = await window.webContents.executeJavaScript(`({
    count: window.rtxFirstFrame.count,
    differences: window.rtxFirstFrame.differences,
    varyingPixels: window.rtxFirstFrame.varyingPixels,
    error: window.rtxFirstFrame.error
  })`);
  assert.equal(result.error, null);
  assert.equal(result.count, 4);
  assert.ok(result.varyingPixels > 100, 'VSR output must contain the complex pattern');
  assert.deepEqual(result.differences, [0, 0, 0],
    'Successive full VSR outputs differ despite byte-identical input');
  console.log(`OK RTX first frame: four full ${outputWidth}x${outputHeight} RGBA outputs match`);
  engine.stop();
  engine = null;
  window.destroy();
  window = null;
}

app.whenReady().then(async () => {
  const runtime = process.env.ELFIX_RTX_RUNTIME_DIR || path.join(__dirname, '../build/rtx-video');
  assert.ok(fs.existsSync(path.join(runtime, 'rtx-video-helper.exe')), 'RTX helper is missing');
  assert.ok(fs.existsSync(path.join(runtime, 'nvngx_vsr.dll')), 'RTX VSR DLL is missing');
  const pixel = pattern();
  await runCase(runtime, pixel, 2560, 1440);
  await runCase(runtime, pixel, 3840, 2160);
  clearTimeout(timeout);
  app.exit(0);
}).catch((error) => {
  clearTimeout(timeout);
  console.error(error);
  engine?.stop();
  window?.destroy();
  app.exit(1);
});
