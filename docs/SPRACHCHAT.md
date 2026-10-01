# Sprachchat in der Watchparty

Der Sprachchat gehört zum Watchparty-Raum. Er startet nur nach dem bewussten
Beitreten und öffnet selbst kein Video. Am Desktop liegt der Einstieg unter
**Watchparty → Sprachchat** und im ausklappbaren Player-Chat. Android/TV bietet
den Einstieg bei den Watchparty-Räumen und im eigenen Player.

## Bedienung

Unter **Einstellungen → Watchparty → Mikrofon einstellen** wird das gewünschte
Eingabegerät gewählt. **Systemstandard** folgt der Auswahl des Betriebssystems.
Die Einstellung bleibt auf diesem Gerät gespeichert. Das Öffnen der
Einstellungen fordert keine Aufnahme an. **Mikrofone anzeigen** fragt bei Bedarf
die Berechtigung ab und öffnet das Mikrofon kurz, um die Gerätenamen lesen zu
können; dabei wird nichts übertragen, anschließend endet dieser Zugriff.
Ein Wechsel des gewählten Mikrofons schaltet eine laufende Aufnahme stumm.
Zum Sprechen muss sie bewusst wieder eingeschaltet werden. Nicht mehr vorhandene
Geräte führen zu einem Hinweis statt zum stillen Wechsel auf ein anderes Mikrofon.

- **Zum Zuhören beitreten** verbindet ohne Mikrofonaufnahme.
- **Mikrofon einschalten** fordert bei Bedarf die Mikrofonberechtigung an.
  Stummschalten beendet die Aufnahme und gibt die Mikrofontracks frei.
- **Nur beim Gedrückthalten sprechen** bietet Push-to-talk per Taste oder Touch.
  Loslassen, Fokusverlust und App-Wechsel beenden einen gehaltenen Sprechvorgang.
- Jeder Teilnehmer hat einen eigenen Lautstärkeregler, einschließlich 0 %.
  Eine grüne Markierung zeigt erkannte Sprache an.
- **Film beim Sprechen leiser machen** senkt optional den Ton des eigenen
  Elfix-Players. Die vom Nutzer gewählte Lautstärke bleibt erhalten.
- Minimieren hält die Verbindung; **Verlassen** oder Schließen beendet sie.
  Folgenwechsel und PiP ändern die Sprachverbindung nicht.
- Nach einem Verbindungsabbruch muss dem Sprachchat erneut beigetreten werden.
  Das Mikrofon wird dabei nicht automatisch eingeschaltet.

## TV und Handy

Auf dem TV das Video starten, auf dem Handy denselben Watchparty-Raum öffnen
und dort nur dem Sprachchat beitreten. Der Sprachchat startet auf dem Handy
weder Video noch Fortschrittszählung. Die Stimmen der anderen Teilnehmer
kommen vom Handy, der Filmton vom TV.

Sind die Geräte über **Meine Geräte** gekoppelt, ersetzt der neue Sprachbeitritt
die bisherige Sprachverbindung derselben Person in diesem Raum. Der Player auf
dem TV bleibt bestehen. Ohne Gerätekopplung die Sprachverbindung auf dem TV
manuell verlassen, um doppelte Sprachausgabe zu vermeiden.

Android verwendet für den Hintergrundbetrieb einen sichtbaren
Foreground-Service mit Stumm-/Beenden-Aktionen; der Mikrofontyp wird nur für
einen bewusst freigegebenen Zugriff aktiviert. Provider-WebViews erhalten
keine Mikrofonberechtigung. Der Sprachchat besitzt eine separate lokale Ansicht.

## Relay und Netzwerk

**Das Relay muss zusammen mit den Apps aktualisiert werden.** Ältere Relays
unterstützen das neue Signalling nicht; der Client beendet den Beitrittsversuch
nach einer begrenzten Frist mit einem Hinweis. Es gibt keine automatische
Mikrofonfreigabe und keine endlosen Wiederverbindungsversuche.

Das vorhandene authentifizierte Raum-WebSocket vermittelt die Verbindung.
Audio läuft verschlüsselt über WebRTC zwischen den Teilnehmern oder über
einen konfigurierten TURN-Server. Das Watchparty-Relay zeichnet kein Audio auf
und speichert weder Sprachmitgliedschaften noch SDP-/ICE-Nachrichten.
Bis zu acht Sprachverbindungen sind gleichzeitig pro Raum möglich.

Der Standard verwendet `stun:stun.l.google.com:19302` zur Ermittlung erreichbarer
Adressen. Für zuverlässige Verbindungen auch hinter restriktivem NAT/Mobilfunk
wird ein erreichbarer TURN-Server benötigt. Ein Cloudflare-HTTP-Tunnel für das
Watchparty-Relay ersetzt keinen TURN-Server.

Optionale Umgebungsvariablen des Relays:

```text
ELFIX_VOICE_ICE_SERVERS=[{"urls":"stun:stun.example.com:3478"},{"urls":["turn:turn.example.com:3478","turns:turn.example.com:5349"]}]
ELFIX_VOICE_TURN_SECRET=<gemeinsames coturn REST Secret>
ELFIX_VOICE_TURN_TTL=3600
```

Das Secret bleibt auf dem Relay. Es erzeugt kurzlebige TURN-Zugangsdaten für
den beitretenden Peer. Laufende Sitzungen erneuern diese Zugangsdaten noch nicht;
bei Ablauf kann ein erneuter Beitritt nötig werden. Die TTL lässt sich für die
geplante Sitzungsdauer zwischen 60 und 86400 Sekunden wählen.
Alternativ können TURN-Einträge `username` und
`credential` enthalten; diese Daten müssen dann an die Clients ausgegeben
werden. `ELFIX_VOICE_ICE_SERVERS=[]` beschränkt Tests auf Verbindungen ohne
externe STUN-/TURN-Dienste. Keine dieser Einstellungen wird automatisch auf
einem produktiven Server eingerichtet.

Der Raumcode bleibt der Zugangsschutz des bestehenden Watchparty-Systems.
Bei direktem WebRTC können Teilnehmer gegenseitig Netzwerkadressen erfahren.
Mikrofonrechte gelten nur für die eigene Sprachansicht; IPC, Ziel-Peer und Raum
werden separat geprüft. Das Relay begrenzt Teilnehmerzahl, Nachrichtengröße
und Signalling-Rate und leitet nie Signale in einen anderen Raum weiter.

## Prüfung

```text
cd StreamingBrowserElectron
npm run test:voice
```

Die Prüfungen verwenden isolierte Relay-Daten und synthetische Medien. Der
Electron-Test verbindet zwei echte Chromium-WebRTC-Endpunkte, prüft empfangene
Audio-RTP-Pakete, Mikrofonfreigabe, Stummschalten, Push-to-talk, Lautstärke,
Minimieren, Verlassen und den Ausschluss fremder IPC-Absender. Diese Prüfung
ersetzt keinen Hörtest mit echten Mikrofonen und keinen Test über zwei fremde
Netzwerke mit TURN.
