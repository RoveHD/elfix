# Sprachsuche

## Desktop

Das Mikrofon neben dem Suchfeld sucht nach dem nächsten gesprochenen Satz.
„Such nach“, „zeig mir“, „ich will … sehen“ und Ähnliches werden entfernt
(`shared/sprachsuche-text.js`).

**„Hey Elfix“** (Einstellungen → Sprachsuche, standardmäßig aus) hält das
Mikrofon offen und reagiert nur auf Sätze mit dem Weckwort. „Hey Elfix,
Breaking Bad“ sucht sofort; nur „Hey Elfix“ wartet acht Sekunden auf den Titel.
Das Fenster kommt dabei nach vorn.

Erkannt wird offline mit Vosk (`vosk-browser`, WebAssembly). Beim ersten
Gebrauch lädt ELFIX das deutsche Modell `vosk-model-small-de-0.15` (rund
45 MB) von alphacephei.com, packt es zu tar.gz um (`src/sprachmodell.js`) und
legt es unter `<App-Daten>/sprachsuche/` ab. Lässt es sich nicht laden, wird
es verworfen und beim nächsten Versuch neu geholt.

Die Erkennung läuft in einem unsichtbaren Fenster mit eigener Sitzung
(`src/sprachsuche-fenster.js`, `shared/sprachsuche.html`). Nur dieses
Fenster bekommt das Mikrofon, und nur solange eine Suche läuft oder „Hey
Elfix“ an ist. Es hat kein Node und kein Netz außer der festen Modelladresse.
Das Hauptfenster bleibt ohne Mikrofon und ohne WebAssembly.

Da das Weckwort kein deutsches Wort ist, wird es an den Schreibweisen erkannt,
die die Erkennung daraus macht („elf fix“, „elf ix“, „helfix“ …), und nur mit
einer Anrede davor („hey“, „hallo“, „okay“) oder am Satzanfang.

## Android (Handy und TV)

Das Mikrofon neben dem Suchfeld öffnet die Spracheingabe des Systems
(`RecognizerIntent`). Der erkannte Text wird mit denselben Regeln bereinigt
(`SprachSuche.java`) und gesucht. Ohne Spracheingabe auf dem Gerät erscheint
ein Hinweis. Ein Weckwort gibt es auf Android nicht.

## Prüfungen

`tests/sprachsuchetexttest.js`, `tests/sprachsucheseitetest.js`,
`tests/sprachsuche-electrontest.js` (echtes vosk-browser mit Ersatzmodell),
`SprachSucheTest.java`. Mit einem echten Modell und Mikrofon ist die
Erkennung nur von Hand prüfbar.
