"use strict";
// Aufruf: node node_modules/electron/cli.js tests/ui-regression.electron.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-ui-regression-"));
app.setPath("userData", profile);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("no-sandbox");
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { backgroundThrottling: false } });
  const css = fs.readFileSync(path.join(__dirname, "../src/renderer/styles.css"), "utf8");
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`<style>${css}</style>
    <div class="app-shell" style="display:block">
      <div class="hero home-dashboard-hero has-thumb" id="hero"><h1>Fortsetzen</h1><p>Metadaten</p><button class="secondary-action">Details</button></div>
      <div class="crop-preview favorite-card" id="crop" style="width:200px;height:300px;--crop-lupe:0.8">Poster</div>
      <button class="chrome-btn is-reloading" id="loading">Laden</button>
    </div>
    <div class="settings-page is-active"><button class="settings-home-card" id="first">A</button><button class="settings-home-card" id="second">B</button></div>`));
  win.webContents.debugger.attach("1.3");
  const { root } = await win.webContents.debugger.sendCommand("DOM.getDocument");
  const { nodeId } = await win.webContents.debugger.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector: "#crop" });
  const before = await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('#crop')).transform");
  await win.webContents.debugger.sendCommand("CSS.enable");
  await win.webContents.debugger.sendCommand("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover", "active"] });
  await new Promise(resolve => setTimeout(resolve, 350));
  const after = await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('#crop')).transform");
  const checks = [{ name: "Zuschneiden behaelt Zentrierung und Zoom beim Ziehen", ok: before === after, detail: { before, after } }];
  const cropTransition = await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('#crop')).transitionDuration");
  checks.push({ name: "Zuschneiden reagiert ohne verzoegerte Geometrie", ok: cropTransition.split(',').every(value => parseFloat(value) === 0), detail: cropTransition });
  const colors = await win.webContents.executeJavaScript(`
    document.documentElement.style.setProperty('--text', '#08111f');
    document.documentElement.style.setProperty('--text-primary', '#08111f');
    document.documentElement.style.setProperty('--text-secondary', '#253349');
    ['h1','p','button'].map(selector => getComputedStyle(document.querySelector('#hero ' + selector)).color);
  `);
  checks.push({ name: "Dunkler Hero behaelt helle Schrift im hellen Theme", ok: colors.every(color => Number(color.match(/\d+/)[0]) > 180), detail: colors });
  const delays = await win.webContents.executeJavaScript("['first','second'].map(id => getComputedStyle(document.getElementById(id)).animationDelay)");
  checks.push({ name: "Einstellungskarten haben verschiedene Startzeiten", ok: delays[0] !== delays[1], detail: delays });
  await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const spinner = await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('#loading'), '::after').animationDuration");
  checks.push({ name: "Ladeindikator bleibt bei reduzierter Bewegung langsam erkennbar", ok: spinner === "2.4s", detail: spinner });
  const renderer = fs.readFileSync(path.join(__dirname, "../src/renderer/renderer.js"), "utf8");
  const helpers = ["beschreibungText", "titelGenres", "titelBewertung", "titelMetadatenChips", "titelDetailsBauen"].map(name => {
    const start = renderer.indexOf(`function ${name}(`);
    return renderer.slice(start, renderer.indexOf("\n}", start) + 2);
  }).join("\n");
  const details = await win.webContents.executeJavaScript(`(() => {
    ${helpers}
    const daten = { beschreibung: 'Eine ganze Beschreibung. '.repeat(150), genres: ['Action','Drama','Fantasy','Abenteuer','Ger',{}], quelle:'tmdb', bewertung:8.2, bewertungStimmen:900 };
    const dialog = document.createElement('dialog');
    dialog.className = 'confirm-modal is-title-details';
    dialog.innerHTML = '<div class="confirm-shell"><div class="confirm-body"></div></div>';
    const body = dialog.querySelector('.confirm-body');
    const detail = titelDetailsBauen(daten);
    body.append(detail);
    document.body.append(dialog);
    dialog.showModal();
    return {
      full: detail.querySelector('p').textContent === daten.beschreibung.trim(),
      scroll: body.scrollHeight > body.clientHeight && getComputedStyle(body).overflowY === 'auto',
      genres: titelGenres(daten).length === 4,
      heroLimit: titelMetadatenChips(daten,3).length === 4,
      empty: titelDetailsBauen(null).hidden,
      rating: titelBewertung(daten).includes('8.2 / 10 (TMDB)'),
      plain: beschreibungText('<b>Text</b><script>bad()</script>') === 'Text'
    };
  })()`);
  checks.push({ name: "Vollstaendige Details, Scrollen, Genrelimit und fehlende Metadaten", ok: Object.values(details).every(Boolean), detail: details });
  for (const check of checks) console.log(`${check.ok ? "OK" : "FAIL"}: ${check.name}: ${JSON.stringify(check.detail)}`);
  win.destroy();
  app.exit(checks.every(check => check.ok) ? 0 : 1);
}).catch(error => { console.error(error); app.exit(1); });
