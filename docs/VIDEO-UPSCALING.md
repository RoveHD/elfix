# Video-Upscaling im Desktop-Player

Unter **Einstellungen → Wiedergabe → Videoqualität** lässt sich **AMD FSR 1**
einschalten. Die Einstellung ist standardmäßig aus und wird lokal gespeichert.
Ein laufendes Video wird beim Umschalten weder neu geladen noch angehalten.

Die Umsetzung verwendet AMDs räumlichen EASU-Upscaler mit anschließender
RCAS-Schärfung. Sie benötigt WebGL2 und geeignete Grafikbeschleunigung, ist
nicht auf AMD beschränkt und unterstützt auch Intel- und NVIDIA-Grafik.
Es handelt sich um FSR 1, ohne KI oder Zwischenbildberechnung.

## Verhalten und Grenzen

- Nur Videos im eigenen ELFIX-Desktop-Player; keine Änderung am eingebetteten
  Player einer Anbieterwebseite oder an Android/TV.
- Verarbeitung nur beim Vergrößern. Ausgabe maximal 3840 × 2160 Bildpunkte,
  einschließlich der Bildschirm-Skalierung. Das Seitenverhältnis bleibt erhalten.
- Bei nativen Untertiteln, im Mini-Player oder bei einer nicht verarbeitbaren
  Quelle wird das Originalbild angezeigt. Ein ausgeblendeter Player setzt die
  Bildverarbeitung aus. Der Status nennt den jeweiligen Grund.
- Ohne aktivierten Schalter entsteht kein WebGL-Kontext und es läuft keine
  Bildverarbeitung. Fehler beim Kopieren oder Rendern des Bilds lassen die
  normale Wiedergabe weiterlaufen.
- Zusätzliche GPU-Leistung wird benötigt. Die Option verändert weder die
  gewählte Streamqualität noch Ton, Fortschritt oder Watchparty-Takt.

## Herkunft

Port der 32-Bit-EASU- und RCAS-Pfade aus
[AMD FidelityFX FSR 1.0.2](https://github.com/GPUOpen-Effects/FidelityFX-FSR/blob/a21ffb8f6c13233ba336352bdff293894c706575/ffx-fsr/ffx_fsr1.h),
Commit `a21ffb8f6c13233ba336352bdff293894c706575`. Die MIT-Lizenz liegt in
`StreamingBrowserElectron/src/renderer/spieler-fsr1-LICENSE.txt` und wird
mit der Anwendung ausgeliefert.

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
Der Hardwaredurchlauf erfolgte auf einer RTX 4070. Physische AMD-/Intel-Geräte
und sämtliche externen Hoster sind damit nicht geprüft.
