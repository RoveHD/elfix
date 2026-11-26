"use strict";

// Runs the real NSIS choice/cleanup code against disposable folders, never an
// installed app or real profile. --build also compiles electron-builder's full
// installer with a tiny dummy payload (the resulting setup must NOT be installed).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { getMakeNsisPath, getNsisPluginsPath } = require("app-builder-lib/out/toolsets/windows");
const { NsisScriptGenerator } = require("app-builder-lib/out/targets/nsis/nsisScriptGenerator");

const project = path.resolve(__dirname, "..");
const templates = path.join(project, "node_modules/app-builder-lib/templates/nsis");
const config = require("../package.json");
const source = fs.readFileSync(path.join(project, config.build.nsis.include), "utf8");

function run(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: project, encoding: "utf8", windowsHide: true, timeout: 60000, ...options,
  });
  if (result.error) throw result.error;
  return result;
}

async function main() {
  assert.equal(process.platform, "win32", "Dieser native Deinstallertest benötigt Windows.");
  assert.equal(config.build.nsis.oneClick, true, "Installation bleibt one-click");
  assert.equal(config.build.nsis.deleteAppDataOnUninstall, false);
  const toolsRoot = path.resolve(project, "../tools");
  fs.mkdirSync(toolsRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(toolsRoot, "uninstaller-test-"));
  const fixture = path.join(work, "fixture");
  const compiler = await getMakeNsisPath();
  const plugins = await getNsisPluginsPath();

  // Compile exactly the production hook, with shell-folder tokens substituted
  // before compilation. No test executable may refer to the real shell folders.
  const isolated = source.replaceAll("$APPDATA", "${TEST_ROAMING}")
    .replaceAll("$LOCALAPPDATA", "${TEST_LOCAL}");
  assert.doesNotMatch(isolated, /\$(?:APPDATA|LOCALAPPDATA)/i);
  fs.writeFileSync(path.join(work, "isolated.nsh"), isolated);
  const header = new NsisScriptGenerator();
  header.include(path.join(templates, "include/StdUtils.nsh"));
  header.addPluginDir("x86-unicode", path.join(plugins, "x86-unicode"));
  header.flags(["updated"]);
  const uninstaller = path.join(work, "Uninstall fixture.exe");
  const writer = path.join(work, "write-uninstaller.exe");
  fs.writeFileSync(path.join(work, "fixture.nsi"), `
Unicode true
RequestExecutionLevel user
Name "ELFIX Deinstallationstest (nur Testdaten)"
OutFile "${writer}"
SilentInstall silent
SetCompressor zlib
!include LogicLib.nsh
!include FileFunc.nsh
!include MUI2.nsh
${header.build()}
!define BUILD_UNINSTALLER
!define ONE_CLICK
!define TEST_ROAMING "${fixture}\\Roaming"
!define TEST_LOCAL "${fixture}\\Local"
!include "${path.join(work, "isolated.nsh")}"
!define MUI_COMPONENTSPAGE_NODESC
!insertmacro MUI_UNPAGE_COMPONENTS
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "German"
!insertmacro customHeader
!ifdef ONE_CLICK
  !error "Der Uninstaller darf nicht vor der optionalen Sektion enden."
!endif
Var installMode
Var FixtureLock
Section
  WriteUninstaller "${uninstaller}"
SectionEnd
Section "un.\${UNINSTALL_SECTION_NAME}"
  SectionIn RO
  Delete "${fixture}\\program.bin"
SectionEnd
!insertmacro customUnInstallSection
Function un.onInit
  StrCpy $installMode "current"
  !insertmacro customUnInit
  \${GetParameters} $R0
  ClearErrors
  \${GetOptions} $R0 "/TEST_DELETE" $R1
  \${IfNot} \${Errors}
    ; Simulates a checked box, even when the guard has disabled it.
    SectionSetFlags \${ELFIX_USER_DATA_SECTION} \${SF_SELECTED}
  \${EndIf}
  ClearErrors
  \${GetOptions} $R0 "/TEST_CANCEL" $R1
  \${IfNot} \${Errors}
    SetErrorLevel 2
    Quit
  \${EndIf}
  ClearErrors
  \${GetOptions} $R0 "/TEST_LOCK" $R1
  \${IfNot} \${Errors}
    System::Call 'kernel32::CreateFileW(w "${fixture}\\Roaming\\elfix\\sentinel.txt", i 0x80000000, i 0, p 0, i 3, i 0, p 0) p.r0'
    StrCpy $FixtureLock $0
    \${If} $FixtureLock == -1
      SetErrorLevel 91
      Quit
    \${EndIf}
  \${EndIf}
  ClearErrors
  \${GetOptions} $R0 "/TEST_AUTO" $R1
  \${IfNot} \${Errors}
    ; Only hide test pages AFTER the real init/choice logic ran.
    SetSilent silent
  \${EndIf}
FunctionEnd
Function un.onUninstSuccess
  System::Call 'kernel32::CloseHandle(p $FixtureLock)'
FunctionEnd
`);
  const compiled = run(compiler.path, ["/V2", path.join(work, "fixture.nsi")], {
    env: { ...process.env, ...compiler.env },
  });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const written = run(writer, ["/S"]);
  assert.equal(written.status, 0, written.stdout + written.stderr);
  assert.ok(fs.existsSync(uninstaller));

  function reset() {
    // This is the only recursive test reset: verify the exact resolved target.
    assert.equal(path.resolve(fixture), path.join(work, "fixture"));
    assert.ok(work.startsWith(toolsRoot + path.sep + "uninstaller-test-"));
    fs.rmSync(fixture, { recursive: true, force: true });
    for (const dir of ["Roaming/elfix", "Roaming/GlobalSearchHub", "Local/elfix-updater", "Roaming/OtherApp", "Exports"]) {
      fs.mkdirSync(path.join(fixture, dir), { recursive: true });
      fs.writeFileSync(path.join(fixture, dir, "sentinel.txt"), "test-only");
    }
    fs.writeFileSync(path.join(fixture, "program.bin"), "dummy program");
    fs.mkdirSync(path.join(fixture, "Roaming/elfix/Partitions/player/Cache"), { recursive: true });
    fs.writeFileSync(path.join(fixture, "Roaming/elfix/Partitions/player/Cache/test.bin"), "nested test");
  }
  const cases = [
    ["Voreinstellung behält Daten", [], false, true, 0],
    ["Explizite Auswahl entfernt alle lokalen Daten", ["/TEST_DELETE"], true, true, 0],
    ["Stille Deinstallation behält Daten", ["/S", "/TEST_DELETE"], false, true, 0],
    ["Update behält Daten", ["--updated", "/TEST_DELETE"], false, true, 0],
    ["KEEP_APP_DATA behält Daten", ["/KEEP_APP_DATA", "/TEST_DELETE"], false, true, 0],
    ["Echter Update-Aufruf behält Daten", ["/S", "--updated", "/KEEP_APP_DATA"], false, true, 0],
    ["Abbrechen entfernt nichts", ["/TEST_DELETE", "/TEST_CANCEL"], false, false, 2],
    ["Alter Löschparameter umgeht die Auswahl nicht", ["/S", "--delete-app-data"], false, false, 2],
    ["Widersprüchliche Update-Parameter löschen nichts", ["/S", "--updated", "/KEEP_APP_DATA", "--delete-app-data"], false, false, 2],
  ];
  for (const [name, args, deleted, programDeleted, exitCode] of cases) {
    reset();
    // _?= keeps NSIS in this exact test directory and lets us wait for completion.
    // NSIS requires its final _?= argument unquoted, even with spaces in it.
    const result = run(uninstaller, [...args, "/TEST_AUTO", `_?=${work}`], { windowsVerbatimArguments: true });
    assert.equal(result.status, exitCode, `${name}: ${result.stdout}${result.stderr}`);
    assert.equal(fs.existsSync(path.join(fixture, "program.bin")), !programDeleted, name);
    for (const dir of ["Roaming/elfix", "Roaming/GlobalSearchHub", "Local/elfix-updater"]) {
      assert.equal(fs.existsSync(path.join(fixture, dir)), !deleted, `${name}: ${dir}`);
    }
    for (const dir of ["Roaming/OtherApp", "Exports"]) {
      assert.ok(fs.existsSync(path.join(fixture, dir, "sentinel.txt")), `${name}: fremde Daten`);
    }
    console.log(`OK ${name}`);
  }
  // Missing folders on a fresh profile must also be harmless.
  const again = run(uninstaller, ["/TEST_DELETE", "/TEST_AUTO", `_?=${work}`], { windowsVerbatimArguments: true });
  assert.equal(again.status, 0);
  const missing = run(uninstaller, ["/TEST_DELETE", "/TEST_AUTO", `_?=${work}`], { windowsVerbatimArguments: true });
  assert.equal(missing.status, 0, "Bereits fehlende Profilordner sind kein Fehler");
  console.log("OK Bereits fehlende Datenordner");

  reset();
  fs.symlinkSync(path.join(fixture, "Exports"), path.join(fixture, "Roaming/elfix/verknuepfung"), "junction");
  const linked = run(uninstaller, ["/TEST_DELETE", "/TEST_AUTO", `_?=${work}`], { windowsVerbatimArguments: true });
  assert.equal(linked.status, 0);
  assert.equal(fs.existsSync(path.join(fixture, "Roaming/elfix")), false);
  assert.ok(fs.existsSync(path.join(fixture, "Exports/sentinel.txt")), "Verknüpfungen dürfen keine fremden Daten löschen");
  console.log("OK Verknüpfte fremde Ordner bleiben erhalten");

  reset();
  const locked = run(uninstaller, ["/TEST_DELETE", "/TEST_LOCK", "/TEST_AUTO", `_?=${work}`], { windowsVerbatimArguments: true });
  assert.equal(locked.status, 1, "Gesperrte Daten müssen als unvollständige Bereinigung gemeldet werden");
  assert.ok(fs.existsSync(path.join(fixture, "Roaming/elfix/sentinel.txt")));
  assert.equal(fs.existsSync(path.join(fixture, "Roaming/GlobalSearchHub")), false);
  assert.equal(fs.existsSync(path.join(fixture, "Local/elfix-updater")), false);
  assert.ok(fs.existsSync(path.join(fixture, "Roaming/OtherApp/sentinel.txt")));
  console.log("OK Gesperrte Datei meldet Fehler, andere App-Daten werden weiter bereinigt");

  if (process.argv.includes("--build")) {
    const payload = path.join(work, "dummy-app");
    fs.mkdirSync(payload);
    fs.copyFileSync(writer, path.join(payload, "ELFIX.exe"));
    const built = run(process.execPath, [
      path.join(project, "node_modules/electron-builder/cli.js"),
      "--win", "nsis", "--x64", "--publish", "never", "--prepackaged", payload,
      "-c.directories.output=" + path.join(work, "setup-do-not-install"),
      "-c.win.signAndEditExecutable=false", "-c.nsis.packElevateHelper=false",
    ], { timeout: 120000 });
    fs.writeFileSync(path.join(work, "builder.log"), built.stdout + built.stderr);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    console.log("OK Vollständiger electron-builder/NSIS-Installer kompiliert (Dummy-Payload, nicht installiert)");
  }
  reset();
  console.log(`Testartefakte: ${work}`);
  console.log(`UI-Vorschau: "${uninstaller}"`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
