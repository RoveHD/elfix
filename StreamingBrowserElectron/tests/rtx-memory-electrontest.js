'use strict';

// Opt-in Windows/RTX regression with an isolated profile and real GPU transfers.
// ELFIX_RTX_HARDWARE=1 electron tests/rtx-memory-electrontest.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { app, BrowserWindow, sharedTexture } = require('electron');
const { erstellen } = require('../src/rtx-video');

if (process.env.ELFIX_RTX_HARDWARE !== '1' || process.platform !== 'win32') {
  console.log('SKIP RTX memory hardware test (Windows, ELFIX_RTX_HARDWARE=1 required)');
  process.exit(0);
}
const runFile = promisify(execFile);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'elfix-rtx-memory-'));
app.setPath('userData', path.join(profile, 'electron'));
app.on('window-all-closed', () => {});
let window, engine, child;
const samples = [];
const warmupFrames = 60;
const frameCount = 480;
// A fixed-size stream must plateau after warmup. Allow driver bookkeeping,
// but reject growth far below the old several-GiB increase over a few seconds.
const maxGrowthMiB = 256;
const timeout = setTimeout(() => fail(new Error('RTX memory test timed out')), 150000);

async function memoryMiB() {
  assert.ok(child?.pid && child.exitCode === null, 'RTX helper must remain alive');
  const pid = child.pid;
  const { stdout } = await runFile(path.join(process.env.SystemRoot,
    'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive',
    '-Command', `$p = Get-Process -Id ${pid} -ErrorAction Stop; $p.PrivateMemorySize64`],
  { windowsHide: true, timeout: 10000 });
  const bytes = Number(stdout.trim());
  assert.ok(Number.isFinite(bytes) && bytes > 0, 'Private memory measurement unavailable');
  return bytes / (1024 * 1024);
}

async function waitForFrame(frameId) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const state = await window.webContents.executeJavaScript('window.rtxMemoryState');
    assert.equal(state.error, null);
    if (state.frameId === frameId) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`RTX frame ${frameId} did not reach the renderer`);
}

async function finish() {
  clearTimeout(timeout);
  engine?.stop();
  window?.destroy();
  if (child && child.exitCode === null) {
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 5000))
    ]);
    assert.notEqual(child.exitCode, null, 'RTX helper must exit after stop and GPU release');
    assert.equal(child.exitCode, 0, 'RTX helper must shut down cleanly');
  }
}

function fail(error) {
  clearTimeout(timeout);
  console.error(error);
  engine?.stop();
  window?.destroy();
  // A failed memory test must not leave a runaway helper behind.
  if (child && child.exitCode === null) child.kill();
  app.exit(1);
}

app.whenReady().then(async () => {
  const runtime = process.env.ELFIX_RTX_RUNTIME_DIR || path.join(__dirname, '../build/rtx-video');
  assert.ok(fs.existsSync(path.join(runtime, 'rtx-video-helper.exe')));
  assert.ok(fs.existsSync(path.join(runtime, 'nvngx_vsr.dll')));
  window = new BrowserWindow({ show: false, width: 1280, height: 720,
    webPreferences: { preload: path.join(__dirname, '../src/spieler-preload.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false } });
  await window.loadURL('about:blank');
  window.setOpacity(0);
  window.showInactive();
  await window.webContents.executeJavaScript(`
    window.rtxMemoryState = {frameId: 0, error: null};
    const canvas = document.createElement('canvas');
    canvas.width = 3840; canvas.height = 2160;
    document.body.appendChild(canvas);
    const context = canvas.getContext('2d', {alpha: false});
    window.addEventListener('message', event => {
      if (event.source !== window || event.data?.type !== 'elfix-rtx-frame') return;
      const {frame, metadata} = event.data;
      try {
        if (frame.codedWidth !== 3840 || frame.codedHeight !== 2160)
          throw new Error('Unexpected output size');
        context.drawImage(frame, 0, 0);
        window.rtxMemoryState.frameId = metadata.frameId;
      } catch (error) { window.rtxMemoryState.error = String(error); }
      finally { frame.close(); }
    });
    void 0;
  `);
  engine = erstellen({ verzeichnis: runtime,
    datenVerzeichnis: path.join(profile, 'ngx'), sharedTexture,
    spawnHelper: (...args) => {
      assert.equal(child, undefined, 'The stream must use one helper, without restarts');
      child = spawn(...args);
      return child;
    } });
  const pixel = Buffer.alloc(1280 * 720 * 4);
  for (let i = 0; i < pixel.length; i += 4) {
    pixel[i] = (i / 4) % 256;
    pixel[i + 1] = Math.floor(i / 5120) % 256;
    pixel[i + 2] = 80;
    pixel[i + 3] = 255;
  }
  for (let frameId = 1; frameId <= frameCount; frameId++) {
    // Change an input stripe so repeated evaluation exercises actual updates.
    for (let x = 0; x < 1280; x++) pixel[x * 4 + 2] = frameId % 256;
    assert.deepEqual(await engine.bild({ pixel, width: 1280, height: 720,
      outputWidth: 3840, outputHeight: 2160, generation: 1, frameId,
      webContents: window.webContents }), { ok: true });
    await waitForFrame(frameId);
    if (frameId >= warmupFrames && frameId % 60 === 0) {
      const privateMiB = await memoryMiB();
      samples.push({ frameId, privateMiB: Math.round(privateMiB * 10) / 10 });
      console.log(`RTX memory: ${JSON.stringify(samples[samples.length - 1])}`);
      const growth = privateMiB - samples[0].privateMiB;
      assert.ok(growth < maxGrowthMiB,
        `RTX helper grew ${growth.toFixed(1)} MiB after warmup (limit ${maxGrowthMiB} MiB)`);
    }
  }
  await finish();
  console.log(`OK RTX memory: ${frameCount} frames at 720p -> 4K, one helper, bounded memory, clean exit`);
  app.exit(0);
}).catch(fail);
