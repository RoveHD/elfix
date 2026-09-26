"use strict";

const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-upscaling-settings-"));
app.setPath("appData", profile);
app.setPath("userData", path.join(profile, "browser"));
app.setAppPath(path.resolve(__dirname, ".."));
app.disableHardwareAcceleration();
const timeout = setTimeout(() => finish(1, new Error("Upscaling settings timeout")), 60000);
function finish(code, error) {
  clearTimeout(timeout);
  if (error) console.error(error);
  app.exit(code);
}
async function until(check) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error("Settings state did not arrive");
}
let started = false;
app.on("browser-window-created", (_event, window) => {
  window.hide();
  window.webContents.on("did-finish-load", async () => {
    if (started || !window.webContents.getURL().endsWith("index.html")) return;
    started = true;
    const js = code => window.webContents.executeJavaScript(code);
    try {
      await until(() => js("Boolean(settings && window.streamingBrowser)"));
      const initial = await js("window.streamingBrowser.init()");
      assert.equal(initial.settings.playback.videoUpscaling, false, "Fresh and migrated settings default to off");
      assert.equal((await js("window.streamingBrowser.getVideoUpscalingStatus()")).zustand, "aus");
      await js("openSettings()");
      await js("document.querySelector('[data-tab=playback]').click()");
      assert.equal(await js("document.querySelector('#videoUpscaling').checked"), false);
      await js("document.querySelector('#videoUpscaling').click()");
      await until(async () => (await js("window.streamingBrowser.init()")).settings.playback.videoUpscaling === true);
      const stored = () => JSON.parse(fs.readFileSync(path.join(profile, "ELFIX", "settings.json"), "utf8"));
      assert.equal(stored().playback.videoUpscaling, true, "Real UI toggle persists through production IPC");
      await until(() => js("document.querySelector('#videoUpscalingStatus').textContent.includes('bereit')"));
      assert.equal((await js("window.streamingBrowser.getVideoUpscalingStatus()")).zustand, "bereit",
        "Enabling does not falsely report an active renderer");

      const bounds = await js(`(() => {
        const toggle=document.querySelector('#videoUpscaling'), status=document.querySelector('#videoUpscalingStatus');
        return {label:!!toggle.labels.length, visible:toggle.getBoundingClientRect().width>0,
          statusRole:status.getAttribute('role'), pageOverflow:document.documentElement.scrollWidth>innerWidth};
      })()`);
      assert.deepEqual(bounds, { label: true, visible: true, statusRole: "status", pageOverflow: false });
      if (process.env.ELFIX_TEST_SCREENSHOT) {
        // A fresh hidden BrowserWindow may not have a compositor surface yet.
        // Paint without stealing focus or displaying the test window.
        window.setOpacity(0);
        window.showInactive();
        await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        fs.writeFileSync(process.env.ELFIX_TEST_SCREENSHOT,
          (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        window.hide();
      }

      await js("document.querySelector('#videoUpscaling').click()");
      await until(async () => (await js("window.streamingBrowser.init()")).settings.playback.videoUpscaling === false);
      assert.equal(stored().playback.videoUpscaling, false);
      // Only a literal true opts in, including after importing older settings.
      await js(`(async()=>{const s=(await window.streamingBrowser.init()).settings;
        s.playback.videoUpscaling='true'; await window.streamingBrowser.saveSettings(s);})()`);
      assert.equal(stored().playback.videoUpscaling, false);
      console.log("OK Upscaling settings: default off, real toggle, persistence, status and strict normalization");
      finish(0);
    } catch (error) { finish(1, error); }
  });
});
require("../src/main.js");
