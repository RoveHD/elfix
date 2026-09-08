"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { erstellen } = require("../src/cache-schreibkoordinator");

const warten = (ms) => new Promise((fertig) => setTimeout(fertig, ms));

function lesen(datei) {
  return JSON.parse(fs.readFileSync(datei, "utf8"));
}

function temporaereReste(ordner) {
  return fs.readdirSync(ordner).filter((name) => name.endsWith(".tmp"));
}

(async () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "elfix-cache-worker-"));
  try {
    const taste = path.join(ordner, "taste.json");
    const metadaten = path.join(ordner, "metadaten.json");
    fs.writeFileSync(taste, JSON.stringify({ stand: "vorher" }));

    // Ohne jemals geplante Arbeit darf Quit nicht einmal versuchen, einen
    // Worker zu bauen. `null` wuerde beim Worker-Konstruktor sofort werfen.
    const leererKanal = erstellen({ arbeiterDatei: null });
    const leererAbschluss = leererKanal.beendenSynchron();
    assert.equal(leererAbschluss.ok, true);
    assert.equal(leererAbschluss.keineArbeit, true);
    assert.equal(leererKanal.schreiben(taste, { stand: "zu-spaet" }), false);

    // Selbst ein synchroner Fehler beim Worker-Bau bleibt fail-open: kein
    // Auftrag klemmt als aktiv fest und der vorige Cache bleibt lesbar.
    const kaputterKanal = erstellen({ arbeiterDatei: null, hoechstensDateien: 1 });
    kaputterKanal.schreiben(taste, { stand: "unerreichbar" });
    const startFehler = await kaputterKanal.leeren({ fehlerWiederholen: false });
    assert.equal(startFehler.aktiv, false);
    assert.equal(startFehler.fehler.length, 1);
    assert.equal(lesen(taste).stand, "vorher");
    assert.equal(kaputterKanal.beendenSynchron().ok, false);

    // Viele rasche Aenderungen belegen nur einen aktiven und je Datei einen
    // wartenden Platz. Auf der Platte landet dennoch jeweils der juengste.
    const kanal = erstellen({ hoechstensDateien: 2 });
    kanal.schreiben(taste, { stand: 0, ballast: "x".repeat(2_000_000) });
    for (let stand = 1; stand <= 80; stand += 1) kanal.schreiben(taste, { stand });
    for (let stand = 1; stand <= 40; stand += 1) kanal.schreiben(metadaten, { stand });
    const gebuendelt = await kanal.leeren();
    assert.equal(lesen(taste).stand, 80);
    assert.equal(lesen(metadaten).stand, 40);
    assert.ok(gebuendelt.zusammengefasst >= 100, "Zwischenstaende werden vor dem Worker zusammengefasst");
    assert.ok(gebuendelt.groessteWarteschlange <= 2, "Warteschlange bleibt auf die Cache-Dateien begrenzt");
    assert.throws(() => kanal.schreiben(path.join(ordner, "dritter-cache.json"), {}), /2 Dateien begrenzt/);
    assert.deepEqual(temporaereReste(ordner), [], "atomarer Ersatz laesst keine Temp-Datei zurueck");

    // Ein Serialisierungsfehler darf die vorige Datei nicht anbrechen. Ein
    // spaeterer gueltiger Stand muss denselben Kanal wieder verwenden koennen.
    kanal.schreiben(taste, { ungueltig: 1n });
    const fehlgeschlagen = await kanal.leeren();
    assert.equal(fehlgeschlagen.fehler.length, 1);
    assert.equal(lesen(taste).stand, 80, "letzter guter Stand bleibt bei einem Fehler erhalten");
    kanal.schreiben(taste, { stand: "wieder-gut" });
    const erholt = await kanal.leeren();
    assert.equal(erholt.fehler.length, 0);
    assert.equal(lesen(taste).stand, "wieder-gut");

    // Auch ein echter Dateisystemfehler ist wiederholbar: zuerst ist der
    // vermeintliche Elternordner eine Datei, danach wird er repariert.
    const blockiert = path.join(ordner, "blockiert");
    const spaeter = path.join(blockiert, "cache.json");
    fs.writeFileSync(blockiert, "kein Ordner");
    const retryKanal = erstellen({ hoechstensDateien: 1 });
    retryKanal.schreiben(spaeter, { stand: "nach-wiederholung" });
    const plattenfehler = await retryKanal.leeren();
    assert.equal(plattenfehler.fehler.length, 1);
    fs.unlinkSync(blockiert);
    fs.mkdirSync(blockiert);
    retryKanal.wiederholen();
    const wiederholt = await retryKanal.leeren({ fehlerWiederholen: false });
    assert.equal(wiederholt.fehler.length, 0);
    assert.equal(lesen(spaeter).stand, "nach-wiederholung");
    assert.equal(retryKanal.beendenSynchron().ok, true);

    // Realistische 6-8 MB: der unvermeidbare strukturierte Klon wird beim
    // Einreihen gemessen. Serialisierung und fsync laufen danach im Worker,
    // waehrend der Hauptthread weiter Timer bedient.
    const gross = {
      eintraege: Array.from({ length: 58_000 }, (_, i) => ({
        id: i,
        titel: `Titel ${i}`,
        beschreibung: "abcdefghijklmnopqrstuvwxyz".repeat(3)
      }))
    };
    const bytes = Buffer.byteLength(JSON.stringify(gross));
    assert.ok(bytes >= 6 * 1024 * 1024 && bytes <= 8 * 1024 * 1024,
      `Messdaten sollen 6-8 MB gross sein, waren ${(bytes / 1024 / 1024).toFixed(2)} MB`);

    let ticks = 0;
    const ticker = setInterval(() => { ticks += 1; }, 2);
    await warten(10);
    const baselineTicksVorher = ticks;
    const baselineBeginn = performance.now();
    fs.writeFileSync(path.join(ordner, "direkt-baseline.json"), JSON.stringify(gross));
    const baselineMs = performance.now() - baselineBeginn;
    const baselineTicks = ticks - baselineTicksVorher;
    assert.equal(baselineTicks, 0, "direktes JSON plus writeFileSync blockiert den Hauptthread vollstaendig");

    const cloneBeginn = performance.now();
    kanal.schreiben(taste, gross);
    const cloneMs = performance.now() - cloneBeginn;
    const ticksVorher = ticks;
    await kanal.leeren();
    clearInterval(ticker);
    const workerTicks = ticks - ticksVorher;
    assert.ok(workerTicks > 0, "Hauptthread bleibt waehrend JSON und Dateizugriff reaktionsfaehig");

    // Der strukturierte Klon bleibt der unvermeidbare synchrone Anteil. Diese
    // grosszuegige Obergrenze faengt eine versehentlich wieder eingebaute
    // Hauptthread-Serialisierung ab, ohne langsame CI-Rechner auszusperren.
    assert.ok(cloneMs < 250, `7-MB-Klon dauerte unerwartete ${cloneMs.toFixed(1)} ms`);

    // Der Quit-Abschluss stellt seinen neuesten Stand hinter einen eventuell
    // laufenden alten Auftrag, wartet auf dieselbe Worker-Kette und beendet sie.
    kanal.schreiben(taste, { stand: "alt", ballast: "y".repeat(2_000_000) });
    kanal.schreiben(taste, { stand: "final" });
    const abschluss = kanal.beendenSynchron();
    assert.equal(abschluss.ok, true, "Quit-Barriere wartet erfolgreich auf den finalen Stand");
    assert.equal(lesen(taste).stand, "final");
    await warten(30);
    assert.equal(lesen(taste).stand, "final", "kein alter Worker schreibt nach dem Abschluss darueber");
    assert.equal(kanal.schreiben(taste, { stand: "zu-spaet" }), false);
    assert.deepEqual(temporaereReste(ordner), []);

    console.log(
      `OK Cache-Worker: Queue <= 2, atomar, Fehler/Retry/Quit; ` +
      `${(bytes / 1024 / 1024).toFixed(2)} MB Klon ${cloneMs.toFixed(1)} ms, ` +
      `direktes JSON+Disk ${baselineMs.toFixed(1)} ms/0 Timer-Ticks, ` +
      `${workerTicks} Timer-Ticks waehrend Worker-Arbeit.`
    );
  } finally {
    fs.rmSync(ordner, { recursive: true, force: true });
  }
})().catch((fehler) => {
  console.error(fehler);
  process.exitCode = 1;
});
