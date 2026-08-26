---
name: Android - Ruckler beheben, Serienbilder zuverlässig laden/cachen und Einstellungen an Desktop angleichen
about: Umfassende Performance- und Qualitätsverbesserung für Android-App
title: "Android: Ruckler, Bildcache und Einstellungen"
labels: ["android", "performance", "bug"]
---

## Problem

Die Android-App ist aktuell noch nicht auf dem Qualitätsniveau der Desktop-App. Es gibt drei zusammenhängende Bereiche, die vollständig analysiert und verbessert werden sollen.

### 1. UI ruckelt teilweise

Auf Android kommt es immer wieder zu kurzen Rucklern bzw. Hängern, z. B. beim:

- Scrollen auf der Startseite
- Laden von Reihen/Kacheln
- Wechseln zwischen Seiten
- Öffnen von Titeln
- Nachladen von Bildern
- Aktualisieren von Fortschritt/Watchparty-Daten

**Nicht einfach Animationen deaktivieren oder Symptome kaschieren.**

### 2. Serien-/Filmbilder fehlen

Bilder von Serien und Filmen werden teilweise von Anfang an nicht angezeigt.

Mögliche Ursachen:
- fehlender oder fehlerhafter Cache
- Bilder werden bei App-Start nicht korrekt geladen
- Race Conditions beim Laden der Daten
- ungültige/veraltete Bild-URLs
- WebView-/HTTP-/HTTPS-Probleme
- Cache wird unnötig geleert
- Bilder werden bei temporärem Netzwerkfehler dauerhaft als fehlend behandelt
- fehlendes Retry/Fallback

**Bilder sollen nicht bei jedem Öffnen erneut komplett aus dem Netz geladen werden müssen.**

### 3. Einstellungen sind schlechter aufgeteilt als am Desktop

Die Android-Einstellungen sollen strukturell an die Desktop-App angeglichen werden.

**Nicht einfach das Desktop-Layout 1:1 kopieren, sondern für Handy und Android TV sinnvoll darstellen.**

Desktop ist Referenz für:
- vorhandene Einstellungen
- Kategorien
- Bezeichnungen
- Gruppierung
- Reihenfolge
- Abhängigkeiten zwischen Optionen

---

## Vorgehen (vor Code-Änderungen)

Bevor Code geändert wird:

1. Android-Startseite und Rendering vollständig analysieren.
2. Prüfen, welche Arbeit aktuell auf dem UI/Main Thread passiert.
3. Bildlade- und Cache-Logik vollständig nachvollziehen.
4. Prüfen, wann und warum Bilder nicht angezeigt werden.
5. Bestehende Android-Einstellungen mit Desktop vergleichen.
6. Eine Liste erstellen:
   - fehlt auf Android
   - existiert, ist aber anders gruppiert
   - ist Android-spezifisch und soll deshalb separat bleiben

**Keine Vermutungen als bestätigte Ursache behandeln.**

---

## Anforderungen

### Performance

- keine unnötigen vollständigen Re-Renders
- keine unnötigen Netzwerkrequests beim Scrollen
- keine blockierenden Datei-/Datenbank-/Netzwerkoperationen auf dem Main Thread
- Listen/Kacheln effizient aktualisieren
- Bilder nicht unnötig neu dekodieren
- keine aggressiven Timer/Polling-Loops, die die UI ständig aktualisieren
- bestehende Funktionen wie Weiterschauen, Gemeinsam weiterschauen und Watchparty dürfen nicht kaputtgehen

**Wenn möglich messen/profilen, wodurch die Ruckler tatsächlich entstehen.**

### Bilder & Cache

Es muss eine zuverlässige Cache-Strategie geben: **Memory Cache → Disk Cache → Netzwerk**

Dabei:
- vorhandene Bilder sofort aus Cache anzeigen
- fehlende Bilder aus dem Netzwerk laden
- erfolgreich geladene Bilder lokal cachen
- temporäre Fehler später erneut versuchen
- keine kaputten Cache-Einträge dauerhaft behalten
- sinnvoller Platzhalter während des Ladens
- sinnvoller Fallback, wenn wirklich kein Bild vorhanden ist
- Cache muss App-Neustarts überleben
- Cache darf nicht bei jedem Start komplett gelöscht werden
- URL-Änderungen müssen korrekt berücksichtigt werden

**Vorhandene Standardbibliotheken/Android-Komponenten bevorzugen.** Keine unnötige eigene komplexe Cache-Implementierung bauen, wenn bereits eine geeignete Lösung im Projekt vorhanden ist.

### Einstellungen

Android soll dieselben relevanten Einstellungsbereiche wie Desktop besitzen.

Beispielsweise sinnvoll gruppieren in:
- Allgemein
- Wiedergabe
- Anbieter
- Werbung / Filter
- Watchparty
- Darstellung
- Daten / Backup
- Erweitert

**Nur Kategorien übernehmen, die anhand des aktuellen Desktop-Codes tatsächlich existieren.**

**Auf Handy:**
- normale touchfreundliche Einstellungsseite
- klare Überschriften
- zusammengehörige Optionen zusammenhalten

**Auf Android TV:**
- vollständig per D-Pad bedienbar
- eindeutiger Fokus
- keine Optionen außerhalb des sichtbaren Bereichs ohne erreichbare Navigation
- Switches, Eingabefelder und Buttons müssen zuverlässig fokussierbar sein

---

## Wichtig

**Desktop-Code ist die Funktionsreferenz, aber Android darf nicht unnötig Desktop-Implementierungen kopieren**, wenn es dafür native und einfachere Android-Lösungen gibt.

- Keine große Architekturumschreibung ohne belegbaren Grund.
- Nur die notwendigen Stellen ändern.

---

## Tests

Mindestens prüfen:

- [ ] frische Installation ohne bestehenden Cache
- [ ] App-Start mit Internet
- [ ] App-Start mit langsamem Internet
- [ ] App-Start ohne Internet und vorhandenem Bildcache
- [ ] Bilder nach App-Neustart weiterhin vorhanden
- [ ] Scrollen durch viele Titel ohne starke Ruckler
- [ ] schnelles Scrollen und direktes Öffnen eines Titels
- [ ] Wechsel Startseite → Titel → Einstellungen → zurück
- [ ] Weiterschauen funktioniert weiterhin
- [ ] Gemeinsam weiterschauen funktioniert weiterhin
- [ ] Android-Einstellungen mit Desktop-Einstellungen verglichen
- [ ] Android-TV-D-Pad-Navigation durch alle Einstellungen
- [ ] keine neuen Crashes oder ANRs

**Wenn ein echtes Android-Gerät verfügbar ist, dort testen. Android-TV-relevante Änderungen zusätzlich auf einem TV-Gerät oder Emulator testen.**

---

## Definition of Done

Das Issue ist erst abgeschlossen, wenn:

1. ✅ die konkrete Ursache der beobachteten Ruckler dokumentiert wurde
2. ✅ die festgestellten Performanceprobleme behoben wurden
3. ✅ Serien-/Filmbilder nach dem ersten erfolgreichen Laden zuverlässig gecacht werden
4. ✅ Bilder auch nach einem Neustart sofort aus dem Cache erscheinen können
5. ✅ Fehler beim Laden nicht dauerhaft zu leeren Kacheln führen
6. ✅ die Android-Einstellungen funktional und strukturell mit Desktop abgeglichen wurden
7. ✅ Handy und Android TV weiterhin korrekt bedienbar sind
8. ✅ die durchgeführten Tests mit tatsächlichem Ergebnis dokumentiert wurden

**Keine Tests als „bestanden" melden, die nicht wirklich ausgeführt wurden.**
