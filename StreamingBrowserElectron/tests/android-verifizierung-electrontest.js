"use strict";

// Die echten Java-generierten Seitenskripte in Chromium pruefen. Dies ersetzt
// keinen Android-Geraetetest, findet aber DOM-/Maskierungsfehler ohne Mock-DOM.
const { app, BrowserWindow } = require("electron");
const { execFileSync } = require("child_process");
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ablage = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-android-verifizierung-"));
app.setPath("userData", ablage);
app.disableHardwareAcceleration();
const java = (name) => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", name + (process.platform === "win32" ? ".exe" : "")) : name;
const exportDatei = path.join(ablage, "VerifizierungExport.java");
fs.writeFileSync(exportDatei, `package local.elflix.android;
public class VerifizierungExport {
  public static void main(String[] args) {
    String[] werte = { Verifizierung.zustandScript(), Verifizierung.maskierenScript(), Verifizierung.weiterScript(), Verifizierung.maskeEntfernenScript() };
    for (String wert : werte) System.out.println(java.util.Base64.getEncoder().encodeToString(wert.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  }
}`);
execFileSync(java("javac"), ["-encoding", "UTF-8", "-d", ablage,
  path.join(__dirname, "../../android/app/src/main/java/local/elflix/android/Verifizierung.java"), exportDatei]);
const [zustand, maskieren, weiter, entfernen] = execFileSync(java("java"), ["-cp", ablage, "local.elflix.android.VerifizierungExport"], { encoding: "utf8" })
  .trim().split(/\r?\n/).map((zeile) => Buffer.from(zeile, "base64").toString("utf8"));
const desktopTest = fs.readFileSync(path.join(__dirname, "verifizierung-electrontest.js"), "utf8");
const html = desktopTest.match(/const html = `([\s\S]*?)`;/)[1]
  .replace("document.cookie='freigabe=ja; SameSite=Lax';", "");
let fenster;
const frist = setTimeout(() => { console.error("FAIL Android-Skript-Test Zeitlimit"); app.exit(1); }, 15000);

app.whenReady().then(async () => {
  fenster = new BrowserWindow({ show: false, width: 600, height: 500, webPreferences: { sandbox: true } });
  const js = (script) => fenster.webContents.executeJavaScript(script);
  const laden = () => fenster.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  const lage = async () => JSON.parse(await js(zustand));
  await laden();
  assert.equal((await lage()).offen, true);
  assert.equal((await lage()).token, false);
  await js(maskieren);
  assert.equal((await lage()).offen, true, "eigene Maske darf die Abfrage nicht unsichtbar rechnen");
  assert.equal(await js("getComputedStyle(document.getElementById('werbung')).visibility"), "hidden");
  assert.equal(await js("getComputedStyle(document.getElementById('bestaetigen')).visibility"), "visible");
  await js(weiter);
  assert.equal(await js("window.klicks"), 0);
  await js("document.getElementById('bestaetigen').click()");
  assert.equal((await lage()).token, true);
  await js(weiter);
  assert.equal(await js("window.klicks"), 1);
  assert.equal(await js("window.videoBereit"), true);
  assert.equal((await lage()).offen, false);
  await js(entfernen);
  assert.equal(await js("document.getElementById('__elfixVerifizierungStil') === null"), true);
  console.log("OK Android-Skripte: originale Checkbox sichtbar, keine vorzeitige Freigabe, danach Weiter und Aufraeumen");

  await laden();
  await js("const f=document.createElement('input');f.name='cf-turnstile-response';f.value='veraltetes-token';document.querySelector('.alt').appendChild(f)");
  assert.equal((await lage()).token, false, "veraltetes Token eines versteckten Widgets gilt nicht");
  await js(weiter);
  assert.equal(await js("window.klicks"), 0);
  await js("const s=document.createElement('div');s.id='cf-please-wait';s.textContent='Bitte warten';document.body.prepend(s)");
  await js(maskieren);
  assert.equal(await js("getComputedStyle(document.getElementById('bestaetigen')).visibility"), "visible");
  assert.equal(await js("getComputedStyle(document.getElementById('cf-please-wait')).visibility"), "hidden");
  console.log("OK Android-Skripte: verstecktes altes Token ignoriert, Checkbox vor Statusmeldung");

  await laden();
  await js("document.getElementById('token').value='test';document.querySelector('#dialog .cf-turnstile').style.display='none'");
  assert.equal((await lage()).offen, true, "sichtbares Weiter-Fenster bleibt trotz verstecktem geloestem Widget offen");
  await js(weiter);
  assert.equal(await js("window.klicks"), 1);
  assert.equal((await lage()).offen, false);
  await js("document.title='Just a moment...'");
  assert.equal((await lage()).offen, true, "Challenge-Titel wartet auf spaetes Widget");
  console.log("OK Android-Skripte: Weiter nach verstecktem geloestem Widget und spaete Challenge-Erkennung");

  await laden();
  await js("document.getElementById('dialog').style.display='none';const s=document.createElement('div');s.id='cf-please-wait';s.textContent='Bitte warten';document.body.prepend(s)");
  await js(maskieren);
  await js("document.getElementById('dialog').style.display='block'");
  await js(maskieren);
  assert.equal(await js("getComputedStyle(document.getElementById('bestaetigen')).visibility"), "visible",
    "spaetes Checkbox-Widget darf nicht hinter der bisherigen Statusmaske bleiben");
  console.log("OK Android-Skripte: Statusfenster wechselt zum nachgeladenen Checkbox-Widget");

  await laden();
  await js("document.getElementById('token').value='test';window.originalOpen=window.open;document.getElementById('weiter').onclick=()=>{window.open('javascript:void(0)');window.open('https://werbung.example/');window.open('https://voe.sx/e/test')};void 0");
  const popup = await js(weiter);
  assert.ok(popup.startsWith("geklickt|"));
  assert.deepEqual(JSON.parse(decodeURIComponent(popup.slice(9))), ["https://werbung.example/", "https://voe.sx/e/test"]);
  assert.equal(await js("window.open === window.originalOpen"), true);
  assert.ok((await js("location.href")).startsWith("data:"), "erst Java darf ein geprueftes Ziel in derselben Ansicht laden");
  console.log("OK Android-Skripte: Popup-Ziele werden zur nativen Pruefung erfasst, keine fremden Schemata oder neue Fenster");
}).then(() => ende(0), (error) => { console.error(error); ende(1); });

function ende(code) {
  clearTimeout(frist);
  fenster?.destroy();
  app.exit(code);
}
