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
const java = (name) => process.env.JAVA_HOME
  ? path.join(process.env.JAVA_HOME, "bin", name + (process.platform === "win32" ? ".exe" : "")) : name;
const exportDatei = path.join(ablage, "VerifizierungExport.java");
fs.writeFileSync(exportDatei, `package local.elflix.android;
public class VerifizierungExport {
  public static void main(String[] args) {
    String[] werte = { Verifizierung.zustandScript(), Verifizierung.maskierenScript(), Verifizierung.maskeEntfernenScript() };
    for (String wert : werte) System.out.println(java.util.Base64.getEncoder().encodeToString(wert.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  }
}`);
execFileSync(java("javac"), ["-encoding", "UTF-8", "-d", ablage,
  path.join(__dirname, "../../android/app/src/main/java/local/elflix/android/Verifizierung.java"), exportDatei]);
const [zustand, maskieren, entfernen] = execFileSync(java("java"),
  ["-cp", ablage, "local.elflix.android.VerifizierungExport"], { encoding: "utf8" })
  .trim().split(/\r?\n/).map((zeile) => Buffer.from(zeile, "base64").toString("utf8"));
const html = `<!doctype html><meta charset="utf-8"><title>Just a moment...</title>
<style>#dialog{position:fixed;inset:0;background:white}.newsletter{width:260px;height:90px}</style>
<div id="werbung">Werbung</div><main id="dialog"><div class="cf-turnstile">
<input id="token" name="cf-turnstile-response"><button id="bestaetigen">Ich bin ein Mensch</button>
</div></main><script>window.klicks=0;bestaetigen.onclick=()=>{klicks++;token.value="vom-nutzer"}</script>`;
const fixtureDatei = path.join(ablage, "fixture.html");
let fenster;
const frist = setTimeout(() => { console.error("FAIL Android-Skript-Test Zeitlimit"); app.exit(1); }, 15000);

app.whenReady().then(async () => {
  fenster = new BrowserWindow({ show: false, width: 600, height: 500, webPreferences: { sandbox: true } });
  const js = (script) => fenster.webContents.executeJavaScript(script);
  const seiteLaden = (inhalt) => { fs.writeFileSync(fixtureDatei, inhalt); return fenster.loadFile(fixtureDatei); };
  const laden = () => seiteLaden(html);
  const lage = async () => JSON.parse(await js(zustand));

  await laden();
  assert.equal((await lage()).offen, true);
  await js(maskieren);
  assert.equal(await js("getComputedStyle(werbung).visibility"), "hidden");
  assert.equal(await js("getComputedStyle(bestaetigen).visibility"), "visible");
  assert.equal(await js("klicks"), 0, "ELFIX darf die Bestaetigung nicht selbst anklicken");
  assert.doesNotMatch(zustand + maskieren, /\.click\(|requestSubmit|window\.open\s*=|turnstile\.render|grecaptcha\.execute/);

  await js("bestaetigen.click()"); // Benutzerhandlung der Test-Fixture
  assert.equal((await lage()).offen, true, "ein Token allein ist noch kein serverseitiger Erfolg");
  await js("document.title='Folge';dialog.remove();document.body.insertAdjacentHTML('beforeend','<video></video>')");
  const frei = await lage();
  assert.equal(frei.offen, false);
  assert.equal(frei.erwartet, true, "erst geschuetzter Inhalt gilt als geladen");
  await js(entfernen);
  assert.equal(await js("document.getElementById('__elfixVerifizierungStil') === null"), true);

  await seiteLaden("<title>Provider</title><style>.newsletter{width:260px;height:90px}</style><video></video><div class='cf-turnstile newsletter'></div><script src='challenge-platform.js'></script>");
  assert.equal((await lage()).offen, false, "kleines eingebettetes Turnstile ist keine Vollseiten-Sperre");

  await seiteLaden("<title>Provider</title><main id='cf-chl-running' style='position:fixed;inset:0'>Bitte warten</main>");
  assert.equal((await lage()).offen, true, "cf-chl Vollseiten-Markup wird erkannt");
  console.log("OK Android-Skripte: passive Challenge-Erkennung, Maske, Inhaltserfolg und kein Fake-Klick");
}).then(() => ende(0), (error) => { console.error(error); ende(1); });

function ende(code) {
  clearTimeout(frist);
  fenster?.destroy();
  app.exit(code);
}
