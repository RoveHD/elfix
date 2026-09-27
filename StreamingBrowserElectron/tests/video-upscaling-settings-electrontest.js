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
      assert.equal(initial.settings.playback.videoUpscalingMethod, "auto");
      assert.equal(initial.settings.playback.videoUpscalingResolution, "auto", "Ziel richtet sich standardmaessig nach dem Monitor");
      assert.equal(initial.settings.playback.rtxVideoLicense, "");
      assert.equal(initial.settings.playback.rtxVideoQuality, 2, "Bisherige feste VSR-Stufe bleibt Standard");
      assert.equal((await js("window.streamingBrowser.getVideoUpscalingStatus()")).zustand, "aus");
      await js("openSettings()");
      await js("document.querySelector('[data-tab=playback]').click()");
      assert.equal(await js("document.querySelector('#videoUpscaling').checked"), false);
      assert.equal(await js("document.querySelector('#videoUpscalingMethod').value"), "auto");
      assert.equal(await js("document.querySelector('#rtxVideoQualityRow').hidden"), false, "Automatisch nutzt RTX fuer Serien und Filme");
      await js("document.querySelector('#videoUpscaling').click()");
      await until(async () => (await js("window.streamingBrowser.init()")).settings.playback.videoUpscaling === true);
      const stored = () => JSON.parse(fs.readFileSync(path.join(profile, "ELFIX", "settings.json"), "utf8"));
      assert.equal(stored().playback.videoUpscaling, true, "Real UI toggle persists through production IPC");
      assert.equal(await js("document.querySelector('#videoUpscalingResolution').value"), "auto");
      await js("document.querySelector('#videoUpscalingResolution').value='2160'; document.querySelector('#videoUpscalingResolution').dispatchEvent(new Event('change'))");
      await until(() => stored().playback.videoUpscalingResolution === 2160);
      await until(() => js("document.querySelector('#videoUpscalingStatus').textContent.includes('bereit')"));
      assert.equal((await js("window.streamingBrowser.getVideoUpscalingStatus()")).zustand, "bereit",
        "Enabling does not falsely report an active renderer");
      await js("document.querySelector('#videoUpscalingMethod').value='rtx'; document.querySelector('#videoUpscalingMethod').dispatchEvent(new Event('change'))");
      await until(async () => (await js("window.streamingBrowser.init()")).settings.playback.videoUpscalingMethod === "rtx");
      assert.equal(stored().playback.videoUpscalingMethod, "rtx", "RTX selection is persisted without claiming an active GPU");
      assert.equal(stored().playback.videoUpscalingResolution, 2160, "Other settings preserve the chosen 4K target");
      await until(() => js("document.querySelector('#videoUpscalingStatus').textContent.includes('Lizenzbedingungen')"));
      assert.equal(await js("document.querySelector('#rtxVideoLicenseRow').hidden"), false);
      await js("document.querySelector('#rtxVideoLicense').click()");
      await until(() => stored().playback.rtxVideoLicense === "2024-02-23");
      await until(() => js("document.querySelector('#videoUpscalingStatus').textContent.includes('bereit')"));
      assert.equal(await js("document.querySelector('#rtxVideoQualityRow').hidden"), false);
      assert.equal(await js("document.querySelector('#rtxVideoQuality').value"), "2");
      await js("document.querySelector('#rtxVideoQuality').value='4'; document.querySelector('#rtxVideoQuality').dispatchEvent(new Event('change'))");
      await until(() => stored().playback.rtxVideoQuality === 4);
      await js("document.querySelector('#videoUpscalingMethod').value='anime4k'; document.querySelector('#videoUpscalingMethod').dispatchEvent(new Event('change'))");
      await until(() => stored().playback.videoUpscalingMethod === "anime4k");
      assert.equal(await js("document.querySelector('#rtxVideoQualityRow').hidden"), true);
      assert.equal(await js("document.querySelector('#rtxVideoLicenseRow').hidden"), true);
      assert.equal(stored().playback.rtxVideoQuality, 4, "RTX-Stufe bleibt beim Verfahrenswechsel erhalten");
      await until(() => js("document.querySelector('#videoUpscalingStatus').textContent.includes('bereit')"));

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
      assert.equal(stored().playback.videoUpscalingResolution, 2160);
      await js("document.querySelector('#rtxVideoLicense').click()");
      await until(() => stored().playback.rtxVideoLicense === "");
      // Only a literal true opts in, including after importing older settings.
      await js(`(async()=>{const s=(await window.streamingBrowser.init()).settings;
        s.playback.videoUpscaling='true'; s.playback.videoUpscalingResolution=4320;
        s.playback.rtxVideoQuality=5; s.playback.videoUpscalingMethod='anime4k-x';
        await window.streamingBrowser.saveSettings(s);})()`);
      assert.equal(stored().playback.videoUpscaling, false);
      assert.equal(stored().playback.videoUpscalingResolution, "auto", "Invalid targets normalize to automatic");
      assert.equal(stored().playback.rtxVideoQuality, 2, "Invalid VSR levels normalize to 2");
      assert.equal(stored().playback.videoUpscalingMethod, "auto", "Unknown methods normalize to automatic");
      console.log("OK Upscaling settings: default off, real toggle, persistence, status and strict normalization");
      finish(0);
    } catch (error) { finish(1, error); }
  });
});
require("../src/main.js");
