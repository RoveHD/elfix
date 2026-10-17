# Cloudflare, Provider und Player

## Ausgangslage

Der direkte Aufloeser folgt Provider-/Hoster-Links und uebergibt die gefundene Quelle samt User-Agent, Referer und Origin an den bestehenden Player. Dynamische Hoster werden bei Bedarf in einer zunaechst unsichtbaren Browseransicht beobachtet.

Die bisherige Session hatte mehrere Bruchstellen:

- Electron: Provider, Aufloeser und Verifizierungsansicht verwendeten `persist:streaming-browser`. Der Medien-HTTP-Transport verwendete dagegen `persist:elfix-spieler`. Im Browser gesetzte Cookies standen dem Stream deshalb nicht automatisch zur Verfuegung.
- Der gemeinsame Aufloeser beendete HTTP-Fehler vor dem Lesen der Antwort. Eine Challenge mit HTTP 403 verlor dabei die Zieladresse fuer die manuelle Verifizierung.
- Android: WebView, Aufloeser und Media3 waren bereits ueber `CookieNetz` an den WebView-`CookieManager` angebunden. Provider-WebView, temporaere WebView und HTTP-Aufloeser verwendeten aber unterschiedliche User-Agents. Die Verifizierung hatte keinen ausdruecklichen Persistenzabschluss vor dem Fortsetzen.
- Ein Turnstile-Token bzw. ein Navigationsereignis galt zu frueh als Erfolg. Zudem klickte das bisherige Script den Weiter-Knopf synthetisch. Ein Token allein beweist weder die serverseitige Pruefung noch eine fuer den Player brauchbare Session.

## Verbindlicher Ablauf

1. Normale Provider-Antworten gehen unveraendert durch den bisherigen Aufloeser.
2. `cf-mitigated: challenge` oder kombinierte HTML-Merkmale erkennen eine Challenge auch bei HTTP 200. HTTP 403, `cf-ray`, HTML oder ein eingebundenes Cloudflare-Script allein genuegen nicht.
3. Nur die erforderliche Browseransicht wird sichtbar. Der Mensch bedient die Challenge; ELFIX erzeugt keine Antwort und klickt oder submitet sie nicht.
4. Erst echte Freigabe der geschuetzten Seite erlaubt die Fortsetzung. Cookies bleiben im bestehenden Store und werden vor dem erneuten Abruf gespeichert.
5. Der urspruengliche Abruf wird begrenzt wiederholt. Der bestehende Aufloeser und Player uebernehmen anschliessend wieder.

Die Electron-Playeroberflaeche behaelt ihre isolierte Partition. Der Medienabruf verwendet die Provider-Session. Android waehlt die Cookies weiterhin fuer jede konkrete Zieladresse neu aus dem `CookieManager`, auch nach Redirects, fuer Playlists, Segmente und Schluessel. Cookies werden nicht pauschal auf fremde Domains kopiert. Ablaufzeit, Domain, Pfad und Secure-Attribute bleiben beim jeweiligen Browser-Cookie-Store.

Bei Android wartet der HTTP-Worker begrenzt auf den `setCookie`-Callback, bevor eine Weiterleitung weiterlaeuft. Die Third-Party-Cookie-Einstellung bleibt eine WebView-Einstellung. `CookieManager.getCookie(url)` bietet dem nativen Media3-Stack keinen Browser-Top-Level-Kontext: SameSite/partitionierte Third-Party-Cookies lassen sich damit nicht vollstaendig wie in einer Browsernavigation nachbilden. ELFIX setzt diese Attribute nicht um und schaltet sie nicht ab.

## Diagnose

`[CF]`-Meldungen unterscheiden Erkennung, Oeffnen, erfolgreiche Verifizierung, Persistenz, Retry und dessen Ausgang. Protokolliert werden nur Cookie-Namen. URL-Query und Fragmente sowie lange moegliche Token-Pfadteile werden entfernt; Cookie-Werte und Challenge-Antworten gehoeren nie ins Log.

Ein Clearance-Cookie ist kein dauerhafter Freibrief. Cloudflare kann die Session nach Ablauf, geaenderter IP oder anderen serverseitigen Bedingungen erneut pruefen. ELFIX veraendert keine Browser-Fingerprints und verlaengert keine serverseitige Cookie-Lebensdauer.

Ein nativer HTTP-Stack kann trotz gleicher gueltiger Cookies und gleichem User-Agent weiterhin vom Anbieter abgewiesen werden. Dann endet der begrenzte Retry mit einer Fehlermeldung; ELFIX versucht keinen Fingerprint- oder CAPTCHA-Bypass.

## Referenzen

- [Cloudflare: Challenge-Antworten erkennen](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/)
- [Cloudflare: Clearance](https://developers.cloudflare.com/cloudflare-challenges/concepts/clearance/)
- [Android: CookieManager](https://developer.android.com/reference/android/webkit/CookieManager)
- [Electron: ClientRequest und Session-Cookies](https://www.electronjs.org/docs/latest/api/client-request)
- [Electron: Cookies und flushStore](https://www.electronjs.org/docs/latest/api/cookies)

## Verifikation

- Gemeinsame Node-Fixtures pruefen mehrere Challenge-Merkmale, gewoehnliche Fehlerseiten, sichere Logs, Zieladresse nach Redirect und erneuten Originalabruf.
- Quellenbeobachtung: Challenge sowohl im Hoster-Dokument als auch erst in der HLS-Playlist; wiederholte Challenge endet nach einem Verifizierungsversuch; Abbruch schliesst die Ansicht.
- Die vollstaendige Node-Sammlung wurde ausgefuehrt; betroffene Suiten wurden nach den letzten Aenderungen erneut erfolgreich geprueft. Ein Watchparty-Timingfall scheiterte im Gesamtlauf und bestand isoliert mit 53/53. Die betroffenen Player-/Watchparty-Tests bestanden anschliessend ebenfalls (unter anderem Direktregression 26/26, Direktparty 34/34 und Pausenbild 10/10).
- Desktop: alle 20 Electron-Tests sowie der Android-Verifizierungs-DOM-Test erfolgreich. Die Tests pruefen unter anderem Auto-Close nach Serverfreigabe, Abbruch/Ersatz/Timeout, unveraenderten Response-Body, echte Provider-/Player-Partitionen, Cookie-Scope ueber Redirects, Header, Range und tatsaechliche Medienwiedergabe. Syntaxpruefung und Lint erfolgreich.
- Android: 331/331 Unit-Tests, Lint und Debug-Build erfolgreich. Die nachfolgenden kleinen Korrekturen an Erkennung/Retry-Budget/User-Agent wurden erneut gebaut und geprueft.
- Android-Geraetetest `CookieNetzGeraeteTest`: 2/2 auf Samsung SM-S928B mit Android 16. Echter WebView-CookieManager, echter Media3-`OkHttpDataSource`, unmittelbarer Redirect mit neuem Cookie, User-Agent/Referer/Origin/Range, Host/Pfad/Domain/Secure/Ablauf. Ausschliesslich lokale Testdaten in der getrennten Debug-App.
- Das Geraet wurde vor dem letzten Gesamtdurchlauf getrennt. Der finale Geraete-Rerun war deshalb nicht moeglich; das ist von den erfolgreichen vorherigen beiden Geraetetests zu unterscheiden.

Die automatischen Tests loesen keine echte Cloudflare-Challenge. Eine reale manuelle Freigabe bei s.to/Hostern, das Verhalten nach einem spaeteren App-Neustart sowie alle WebView-/Provider-Versionen sind damit nicht vollstaendig abgedeckt. Provider, deren eigene Challenge nach der Bestaetigung noch eine separate Formaktion verlangt, muessen live geprueft werden: ELFIX betaetigt keine CAPTCHA-/Weiter-Elemente automatisch. Es wartet auf die native Freigabe der Seite; ein Token allein wird nicht als Erfolg ausgegeben.
