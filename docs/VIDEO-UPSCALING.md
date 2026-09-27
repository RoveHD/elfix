# Video-Upscaling im Desktop-Player

Unter **Einstellungen → Wiedergabe → Videoqualität** lassen sich **Automatisch**,
**AMD FSR 1**, **Anime4K** oder **NVIDIA RTX Video Super Resolution** auswählen
und einschalten. **Automatisch** (Standard) verwendet Anime4K für Anime und RTX
Video für Serien und Filme. Als Anime gilt wie bei der Filler-Liste eine Folgenadresse
unter `/anime/stream/`. Ohne akzeptierte NVIDIA-Lizenz laufen Serien und Filme
dabei mit FSR 1. Eine ausdrücklich gewählte Methode gilt für alle Videos.
Die Einstellung ist standardmäßig aus und wird lokal gespeichert.
Ein laufendes Video wird beim Umschalten weder neu geladen noch angehalten.
Der Schalter **Upscaling an/aus** steht auch direkt oben rechts im Player und
speichert dieselbe Einstellung. Daneben lässt sich das Ziel **Auto (Monitor)**,
**1440p** oder **4K (2160p)** wählen, ebenso im Einstellungsmenü. Standard ist
**Auto**: 4K nur, wenn der Bildschirm mit dem Player mindestens rund 2160 Zeilen
für ein 16:9-Bild bietet (physische Pixel, Windows-Skalierung eingerechnet), sonst
1440p. Ein Ultrawide mit 5120 × 1440 bleibt also bei 1440p. Wird das Fenster auf
einen anderen Monitor gezogen, passt sich das Ziel ohne Pause an. Auf einem
1440p-Monitor würde ein 4K-Ziel nur zusätzliche Grafiklast erzeugen, weil der
Browser das Bild danach wieder verkleinert.
Die Verarbeitung erzeugt bis zu **2560 × 1440** bzw. **3840 × 2160** Bildpunkte,
unabhängig von Fenstergröße und Bildschirm-Skalierung. Das Bild wird anschließend
passend im Player dargestellt; ein kleineres Display zeigt dadurch keine zusätzlichen
physischen Pixel. Das Quellseitenverhältnis bleibt erhalten.
Darunter erscheint bei aktiver Verarbeitung zum Beispiel
**FSR 1 · 1280 × 720 → 3840 × 2160**. Die Zahlen stammen aus dem tatsächlich
gerenderten Bild und schließen schwarze Balken aus. Ohne aktives Upscaling steht
dort die Originalauflösung. Eine Quelle ab der Zielauflösung wird nicht verkleinert.

Die Umsetzung verwendet AMDs räumlichen EASU-Upscaler mit anschließender
RCAS-Schärfung. Sie benötigt WebGL2 und geeignete Grafikbeschleunigung, ist
nicht auf AMD beschränkt und unterstützt auch Intel- und NVIDIA-Grafik.
Es handelt sich um FSR 1, ohne KI oder Zwischenbildberechnung.

Anime4K verwendet die CNN-Shader von [Anime4K v4.0](https://github.com/bloc97/Anime4K)
im selben WebGL2-Pfad wie FSR 1, entsprechend dem Anime4K-„Mode A“: **Restore CNN M**
auf dem Quellbild, danach **Upscale CNN x2 M** und bei Bedarf ein zweites x2 mit
**Upscale CNN x2 S**. Eine Vergrößerungsstufe läuft wie bei mpv nur, solange noch mehr
als Faktor 1,2 bis zum Ziel fehlt. Das Ergebnis wird bilinear auf die Zielgröße gebracht.
Zwischenbilder liegen als 16-Bit-Gleitkommatexturen vor (`EXT_color_buffer_float`).
Anime4K ist für Zeichentrick trainiert und braucht deutlich mehr Grafikleistung als FSR 1.

RTX Video verwendet das echte NVIDIA RTX Video SDK 1.1.0. Die VSR-Qualitätsstufe
ist unter **RTX-Qualitätsstufe** wählbar: 1 (niedrig) bis 4 (ultra), Standard 2.
Eine geänderte Stufe gilt ab dem nächsten Bild, ohne den nativen Prozess neu zu starten.
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

- Nur Videos im eigenen ELFIX-Player; keine Änderung am eingebetteten Player
  einer Anbieterwebseite. Auf Android/TV gibt es nur Anime4K (siehe unten).
- Verarbeitung nur beim Vergrößern auf das gewählte Ziel. Ausgabe maximal
  3840 × 2160 Bildpunkte. Bei 4:3 entstehen beispielsweise 1920 × 1440 bzw.
  2880 × 2160 Bildpunkte; das Bild wird weder beschnitten noch verzerrt.
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

## Android und Fernseher

Der native Player (Media3) rechnet Anime mit denselben Anime4K-Netzen als
Videoeffekt vor der Anzeige (`Anime4k.java`). Einstellung unter **Einstellungen →
Wiedergabe → Anime4K für Anime**: Automatisch (Standard), Qualität, Schnell, Aus.

- Als Anime gilt wie am Rechner eine Folgenadresse unter `/anime/stream/`. Serien,
  Filme und ausgeschaltetes Anime4K laufen ohne Effekt auf dem bisherigen Weg.
- **Qualität** entspricht dem Rechner (Restore M, Upscale M, bei Bedarf S),
  **Schnell** nur ein x2 mit Upscale S. Automatisch beginnt am Telefon mit Qualität,
  am Fernseher mit Schnell.
- Ziel ist die Fläche des Players in echten Pixeln; vergrößert wird nur, solange
  mehr als Faktor 1,2 fehlt. Den Rest skaliert Media3 auf die Anzeige.
- Verwirft der Player zweimal hintereinander mehr als 5 % der Bilder, geht Anime4K
  eine Stufe zurück (Qualität → Schnell → Aus), ohne die Wiedergabe neu aufzubauen.
  Bei Automatisch bleibt die Rückstufung für das Gerät gemerkt, bis Automatisch neu
  gewählt wird.
- Benötigt OpenGL ES 3 mit Float-Rendertargets. Fehlen sie, oder ist das Video HDR,
  läuft das Originalbild weiter.
- Media3 legt Bilder mit Zeile 0 unten ab, Anime4K rechnet mit y nach unten. Die
  Shader-Bindungen rechnen deshalb jede Koordinate um; die Hook-Körper bleiben
  unverändert. `Anime4kNetze.java` erzeugt dasselbe Skript wie die Desktop-Shader.
- Geprüft: JVM-Tests für Stufen, Anime-Erkennung und Bindungen. Die erzeugten
  Android-Shaderquellen wurden lokal in WebGL2 mit Media3-Ablage gegen die
  CPU-Referenz gerechnet (Abweichung höchstens 1/255). Auf echten Telefonen oder
  Fernsehern ist Anime4K nicht geprüft.

## Herkunft

Die Anime4K-Shader stammen unverändert aus
[bloc97/Anime4K](https://github.com/bloc97/Anime4K/tree/7684e9586f8dcc738af08a1cdceb024cc184f426/glsl),
Commit `7684e9586f8dcc738af08a1cdceb024cc184f426`. `node scripts/anime4k-shaders.js <Checkout>`
erzeugt daraus `src/renderer/spieler-anime4k-shaders.js`. Dabei werden nur die
mpv-Kopfzeilen in Daten übersetzt. Die MIT-Lizenz liegt in
`StreamingBrowserElectron/src/renderer/spieler-anime4k-LICENSE.txt`.

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

Für lokale Windows-Pakete braucht `npm run build:rtx` PowerShell 7 und Visual Studio
C++ Build Tools mit Windows SDK. Die Release- und Testbuild-Workflows bauen die Komponente automatisch.
Die drei Dateien unter `build/rtx-video` werden durch `extraResources` gepackt.

## Prüfung

`npm run test:electron` umfasst den echten WebGL-Renderer, die gespeicherte
Einstellung und den vollständigen Player mit Produktions-HTML und Preload.
Die GPU-Tests verwenden in CI explizit SwiftShader; dieser Testschalter wird
nicht in der Anwendung gesetzt. Mit `ELFIX_FSR_HARDWARE=1` laufen die beiden
Renderer-/Playerprüfungen auf der tatsächlichen GPU.

Geprüft wurden fortlaufende Videoframes, schwarze/weiße Bildbereiche,
tatsächliche 1440p-/4K-Ausgabe, Seitenverhältnis, Zielwechsel bei Pause, Untertitel, Quellenwechsel,
Kontextverlust und Umschalten ohne Quellenwechsel oder Pause. Der Integrationstest
prüft außerdem den Medienzugriff mit CORS und den Cookies der Anbietersitzung.
Die Einstellungsoberfläche wurde in Electron gerendert und visuell kontrolliert.
Der echte RTX-Durchlauf (`ELFIX_RTX_HARDWARE=1`, `tests/rtx-player-electrontest.js`)
prüft NGX, Shared-Texture-Übertragung, fortlaufende Farben, 1440p-/4K-Zielwechsel,
unveränderte Verarbeitung bei Fenstergrößenänderung, Spulen auf das richtige Bild
und Wechsel zu FSR ohne zusätzliche Pause/Neuladen.
Ohne diese Umgebungsvariable testet er den sicheren Rückfall bei fehlender RTX-GPU.
Der separate Hardwaretest `tests/rtx-first-frame-electrontest.js` vergleicht mit
`ELFIX_RTX_HARDWARE=1` das vollständige erste RTX-Bild mit Folgeausgaben desselben
detailreichen Eingangsbilds bei 1440p und 4K. Er sichert die Korrektur der
DX11-Ausgabetextur gegen die beobachteten Erstbild-Artefakte ab.
`tests/anime4k-electrontest.js` rechnet das WebGL2-Ergebnis von Restore/M/S auf einem
40 × 24-Bild gegen eine unabhängige CPU-Referenz derselben Shader nach (Abweichung
höchstens 4/255). Außerdem prüft er Ausrichtung, Kantenschärfe und 1440p/4K.
Der RTX-Playertest wechselt zusätzlich live auf Anime4K. Physische Grafikkarten
wurden mit Anime4K nicht geprüft, nur SwiftShader.
Der Node-Test `rtxvideotest` prüft Größen- und Protokollgrenzen, eine begrenzte
Warteschlange, Freigaben, veraltete Generationen sowie Crash ohne Neustartschleife.
Die Hardwaredurchläufe erfolgten auf einer RTX 4070. Physische AMD-/Intel-Geräte
und sämtliche externen Hoster sind damit nicht geprüft.
