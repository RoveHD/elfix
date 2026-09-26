# Video-Upscaling im Desktop-Player

Unter **Einstellungen → Wiedergabe → Videoqualität** lassen sich **AMD FSR 1**
oder **NVIDIA RTX Video Super Resolution** auswählen und einschalten.
Die Einstellung ist standardmäßig aus und wird lokal gespeichert.
Ein laufendes Video wird beim Umschalten weder neu geladen noch angehalten.

Die Umsetzung verwendet AMDs räumlichen EASU-Upscaler mit anschließender
RCAS-Schärfung. Sie benötigt WebGL2 und geeignete Grafikbeschleunigung, ist
nicht auf AMD beschränkt und unterstützt auch Intel- und NVIDIA-Grafik.
Es handelt sich um FSR 1, ohne KI oder Zwischenbildberechnung.

RTX Video verwendet das echte NVIDIA RTX Video SDK 1.1.0 mit VSR-Qualitätsstufe 2.
Ein separater nativer D3D11-Prozess verarbeitet die Bilder auf einer unterstützten
NVIDIA-RTX-GPU. GPU-Texturen gelangen direkt über Electrons `sharedTexture`
zum Player; die sichere Renderer-Sandbox bleibt eingeschaltet. Die Videodekodierung,
Ton und Wiedergabezeit bleiben beim bisherigen HTML-Video. Nach erstmaliger
Initialisierung oder Spulen wird das Originalbild bis zum passenden RTX-Bild
angezeigt. Veraltete Bilder einer früheren Quelle oder Position werden verworfen.
Es wird weder DLSS noch FSR 3 oder Zwischenbildberechnung verwendet.

Vor der ersten RTX-Nutzung werden die NVIDIA-Lizenzbedingungen in den Einstellungen
angezeigt und müssen dort akzeptiert werden. Die vollständige Lizenz ist als PDF
zugänglich und liegt mit der NVIDIA-Laufzeit im installierten Ressourcenordner
`rtx-video`. Die Zustimmung ist für FSR 1 nicht nötig. Die NVIDIA-Laufzeit ist
proprietär; ihre Bedingungen gelten zusätzlich für diese optionale Komponente.

## Verhalten und Grenzen

- Nur Videos im eigenen ELFIX-Desktop-Player; keine Änderung am eingebetteten
  Player einer Anbieterwebseite oder an Android/TV.
- Verarbeitung nur beim Vergrößern. Ausgabe maximal 3840 × 2160 Bildpunkte,
  einschließlich der Bildschirm-Skalierung. Das Seitenverhältnis bleibt erhalten.
- Bei nativen Untertiteln, im Mini-Player oder bei einer nicht verarbeitbaren
  Quelle wird das Originalbild angezeigt. Ein ausgeblendeter Player setzt die
  Bildverarbeitung aus. Der Status nennt den jeweiligen Grund.
- Ohne aktivierten Schalter werden weder ein WebGL-Kontext noch ein nativer
  RTX-Prozess gestartet. Es läuft keine Bildverarbeitung. Fehler lassen die
  normale Wiedergabe weiterlaufen.
- RTX benötigt mindestens 640 × 360 Eingangspixel. Ohne passende RTX-GPU,
  Treiber oder Laufzeit erscheint eine verständliche Statusmeldung und das
  Originalvideo läuft weiter. HDR-Konvertierung ist nicht enthalten.
- Zusätzliche GPU-Leistung wird benötigt. Die Option verändert weder die
  gewählte Streamqualität noch Ton, Fortschritt oder Watchparty-Takt.

## Herkunft

Port der 32-Bit-EASU- und RCAS-Pfade aus
[AMD FidelityFX FSR 1.0.2](https://github.com/GPUOpen-Effects/FidelityFX-FSR/blob/a21ffb8f6c13233ba336352bdff293894c706575/ffx-fsr/ffx_fsr1.h),
Commit `a21ffb8f6c13233ba336352bdff293894c706575`. Die MIT-Lizenz liegt in
`StreamingBrowserElectron/src/renderer/spieler-fsr1-LICENSE.txt` und wird
mit der Anwendung ausgeliefert.

Das [offizielle NVIDIA-SDK-Paket](https://catalog.ngc.nvidia.com/orgs/nvidia/multimedia/models/dlpp/1.5/file-browser)
wird beim Windows-Build aus NGC bezogen und gegen SHA-256
`ABF4F34E2B5A618E355B0D5A0365D8ECC3DB4396E756E4C850A867E1AE2ED69E` geprüft.
SDK-Header und Bibliothek bleiben im temporären Build-Verzeichnis. Ausgeliefert
werden nur der eigene Helper, die unveränderte `nvngx_vsr.dll` und die Lizenz-PDF.
Die DLL wurde lokal als gültig von NVIDIA signiert geprüft.

Für lokale Windows-Pakete braucht `npm run build:rtx` Visual Studio C++ Build Tools
mit Windows SDK. Die Release- und Testbuild-Workflows bauen die Komponente automatisch.
Die drei Dateien unter `build/rtx-video` werden durch `extraResources` gepackt.

## Prüfung

`npm run test:electron` umfasst den echten WebGL-Renderer, die gespeicherte
Einstellung und den vollständigen Player mit Produktions-HTML und Preload.
Die GPU-Tests verwenden in CI explizit SwiftShader; dieser Testschalter wird
nicht in der Anwendung gesetzt. Mit `ELFIX_FSR_HARDWARE=1` laufen die beiden
Renderer-/Playerprüfungen auf der tatsächlichen GPU.

Geprüft wurden fortlaufende Videoframes, schwarze/weiße Bildbereiche,
Seitenverhältnis, Größenänderung bei Pause, Untertitel, Quellenwechsel,
Kontextverlust und Umschalten ohne Quellenwechsel oder Pause. Der Integrationstest
prüft außerdem den Medienzugriff mit CORS und den Cookies der Anbietersitzung.
Die Einstellungsoberfläche wurde in Electron gerendert und visuell kontrolliert.
Der echte RTX-Durchlauf (`ELFIX_RTX_HARDWARE=1`, `tests/rtx-player-electrontest.js`)
prüft NGX, Shared-Texture-Übertragung, fortlaufende Farben, pausierte Größenänderung,
Spulen auf das richtige Bild und Wechsel zu FSR ohne zusätzliche Pause/Neuladen.
Ohne diese Umgebungsvariable testet er den sicheren Rückfall bei fehlender RTX-GPU.
Der Node-Test `rtxvideotest` prüft Größen- und Protokollgrenzen, eine begrenzte
Warteschlange, Freigaben, veraltete Generationen sowie Crash ohne Neustartschleife.
Die Hardwaredurchläufe erfolgten auf einer RTX 4070. Physische AMD-/Intel-Geräte
und sämtliche externen Hoster sind damit nicht geprüft.
