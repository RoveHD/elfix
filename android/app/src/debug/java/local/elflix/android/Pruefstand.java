package local.elflix.android;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Der Prüfstand - Wiedergabe vorgeben, ohne wirklich zu warten.
 *
 * <h2>Warum es ihn gibt</h2>
 *
 * <p>Die Fortschrittsregel hängt an Schwellen, die in echter Zeit gemessen
 * werden: 2:30 Wiedergabe für einen neuen Eintrag, 90 % für "durchgeschaut",
 * 60 Sekunden für den Rückweg auf eine ältere Folge. Sie lassen sich nicht
 * beschleunigen - {@code messung.js} deckelt den Zuwachs bewusst auf die
 * wirklich verstrichene Zeit, damit ein schnell durchgezogenes Video nicht als
 * geschaut zählt. Eine Prüfung, die eine Serie samt letzter Folge und
 * anschließendem Film durchspielt, dauert deshalb Stunden.
 *
 * <p>Also wird nicht die Regel abgekürzt, sondern <em>das Video</em>: der
 * Prüfstand liefert genau das, was das Messskript aus der Seite gelesen hätte -
 * Position, Laufzeit, wirklich gespielte Sekunden, Ende ja/nein - und übergibt
 * es {@link Messung#verbuchen}. Alles ab dort ist unverändert die Strecke einer
 * echten Wiedergabe: dieselbe Meta-Erstellung, dieselbe geteilte Regel im Kern,
 * dieselbe Ablage. Was hier geprüft wird, ist also die Regel und nicht ihr
 * Abbild.
 *
 * <h2>Warum er im Release nicht existiert</h2>
 *
 * <p>Diese Datei liegt in {@code src/debug/java}. Der Release-Bau übersetzt
 * stattdessen {@code src/release/java/.../Pruefstand.java} - einen leeren
 * Rumpf ohne Empfänger, ohne Aktion und ohne einen einzigen Zugriff auf die
 * Ablage. Es fehlt im Release also nicht der Schalter, sondern der Code: die
 * Klasse mit Inhalt wird in die Release-APK nie übersetzt.
 *
 * <p>Der Empfänger wird zur Laufzeit angemeldet und nicht im Manifest
 * eingetragen. Ein Manifest-Empfänger stünde im gemeinsamen Manifest oder
 * verlangte ein zweites, variantenspezifisches - und in beiden Fällen wäre die
 * Frage "steht der Prüfstand im Release?" eine Frage an eine XML-Datei statt
 * an den Quellsatz. So ist sie an genau einer Stelle beantwortet: hier.
 *
 * <h2>Wie er benutzt wird</h2>
 *
 * <pre>
 * adb -s emulator-5554 shell am broadcast \
 *   -a local.elflix.android.PRUEFSTAND -p local.elflix.android.debug \
 *   --es befehl messen --es anbieter aniworld \
 *   --es url "https://aniworld.to/anime/stream/naruto/staffel-1/episode-1" \
 *   --ef position 180 --ef laufzeit 1371 --ef gespielt 155
 * </pre>
 *
 * <p>Befehle:
 * <ul>
 *   <li>{@code messen} - ein Messwert. {@code anbieter}, {@code url},
 *       {@code position}, {@code laufzeit}, {@code gespielt}, optional
 *       {@code beendet} (0/1), {@code naechste} (Adresse der Folge danach),
 *       {@code titel}, {@code art} sowie {@code letzteStaffel} und
 *       {@code letzteFolge} - das, was im Betrieb von der Anbieterseite kommt
 *       und ohne Seite nicht zu haben ist.
 *   <li>{@code zustand} - was in der Ablage steht, als eine Protokollzeile
 *       je Eintrag. Der Nachweis für eine Prüfung.
 *   <li>{@code sitzungen} - was an gemessener Zeit abgelegt ist.
 *   <li>{@code sichern} - offene Sitzungen schließen und schreiben, so wie es
 *       beim Verlassen der App geschieht.
 * </ul>
 */
public final class Pruefstand {
    private static final String TAG = CrashReporter.TAG;
    /** Woran der Prüfstand seine Nachrichten erkennt. */
    public static final String AKTION = "local.elflix.android.PRUEFSTAND";
    /** Unter diesem Kopf steht jede Antwort im Protokoll - so ist sie zu filtern. */
    public static final String MARKE = "PRUEFSTAND";

    private static BroadcastReceiver empfaenger;
    /**
     * Wessen App gerade am Prüfstand hängt.
     *
     * <p>Wird gebraucht, weil zwei Activities kurz nebeneinander leben können:
     * beim Neuaufbau ist die neue schon erzeugt, während die alte noch stirbt.
     * Ohne diesen Merker meldete das {@code onDestroy} der alten den Empfänger
     * der <em>neuen</em> ab - und ab da kam kein Befehl mehr an, ohne dass
     * irgendetwas danach aussah.
     */
    private static Pruefumgebung aktuelle;

    private Pruefstand() {
    }

    /** Ob es den Prüfstand in dieser Variante gibt. Im Release: nein. */
    public static boolean aktiv() {
        return true;
    }

    /**
     * Ob eine lebende App eingetragen ist.
     *
     * <p>Für die Prüfungen auf dem Gerät: sie starten die App über einen Intent
     * und müssen wissen, ab wann ein Befehl irgendwo ankommt. Ohne diese Frage
     * schlägt der erste Fall fehl, und zwar nicht aus dem Grund, den er meint.
     */
    public static boolean bereit() {
        return aktuelle != null;
    }

    public static void einrichten(Context context, Pruefumgebung umgebung) {
        if (context == null || umgebung == null) return;
        // Die jüngste App gewinnt. Ein Empfänger, der auf eine abgeräumte
        // Activity zeigt, nimmt Befehle entgegen und tut nichts damit: ihr Kern
        // ist beendet, und `Bestand.verbuchen` kehrt still zurück.
        abmelden(context);
        aktuelle = umgebung;
        empfaenger = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent absicht) {
                ausfuehrenSicher(absicht);
            }
        };
        // Ausdrücklich exportiert: anders erreicht ihn `adb shell am broadcast`
        // nicht. Das ist der Grund, warum er nur im Debug-Bau steht - ein
        // offener Empfänger in einer ausgelieferten App wäre eine Hintertür in
        // die Ablage.
        context.registerReceiver(empfaenger, new IntentFilter(AKTION), Context.RECEIVER_EXPORTED);
        Log.i(TAG, MARKE + " bereit - Aktion " + AKTION);
    }

    /**
     * Abbauen - aber nur, wenn diese App auch die eingetragene ist.
     *
     * <p>Siehe {@link #aktuelle}: die sterbende Activity darf den Empfänger der
     * gerade entstandenen nicht mitnehmen.
     */
    public static void abbauen(Context context, Pruefumgebung umgebung) {
        if (umgebung != null && aktuelle != umgebung) return;
        abmelden(context);
        aktuelle = null;
    }

    private static void abmelden(Context context) {
        if (context == null || empfaenger == null) return;
        try {
            context.unregisterReceiver(empfaenger);
        } catch (IllegalArgumentException schon) {
            // Bereits abgemeldet - kein Fall für eine Meldung.
        }
        empfaenger = null;
    }

    /**
     * Derselbe Befehl, ohne den Umweg über einen Broadcast.
     *
     * <p>Für die Prüfungen auf dem Gerät. Sie laufen im selben Prozess wie die
     * App und können deshalb geradeaus rufen - das nimmt der Prüfung eine
     * Unsicherheit, die nichts mit ihrem Gegenstand zu tun hat: wann das System
     * einen Broadcast zustellt und ob es ihn überhaupt zustellt, entscheidet
     * nicht die App.
     *
     * <p>Der Weg dahinter ist derselbe wie beim Broadcast - es ist buchstäblich
     * dieselbe Zeile. Gerufen werden muss auf dem Hauptthread: dahinter liegt
     * der Kern, und der ist ein WebView.
     */
    public static void ausfuehrenSicher(Intent absicht) {
        Pruefumgebung umgebung = aktuelle;
        if (umgebung == null) {
            Log.e(TAG, MARKE + " keine App eingetragen");
            return;
        }
        try {
            ausfuehren(umgebung, absicht);
        } catch (Exception fehler) {
            Log.e(TAG, MARKE + " Befehl fehlgeschlagen", fehler);
        }
    }

    private static void ausfuehren(Pruefumgebung umgebung, Intent absicht) {
        String befehl = text(absicht, "befehl", "zustand");
        switch (befehl) {
            case "messen":
                messen(umgebung, absicht);
                return;
            case "zustand":
                zustand(umgebung);
                return;
            case "sitzungen":
                sitzungen(umgebung);
                return;
            case "sichern":
                if (umgebung.statistik() != null) {
                    umgebung.statistik().schliessen(null);
                    umgebung.statistik().speichern();
                }
                Log.i(TAG, MARKE + " gesichert");
                return;
            case "sicherung":
                // Die Sicherung ausloesen, ohne auf ein echtes Update zu warten.
                // Sie ist dieselbe, die vor einer Installation entsteht.
                if (umgebung.sicherung() != null) {
                    umgebung.sicherung().anlegen("pruefung", pfad ->
                        Log.i(TAG, MARKE + " sicherung " + (pfad.isEmpty() ? "FEHLGESCHLAGEN" : pfad)));
                } else {
                    Log.w(TAG, MARKE + " keine Sicherung eingerichtet");
                }
                return;
            default:
                Log.w(TAG, MARKE + " unbekannter Befehl: " + befehl);
        }
    }

    /**
     * Ein Messwert, so wie ihn das Messskript geliefert hätte.
     *
     * <p>Die Felder heißen wie dort, damit sich beim Lesen keine Frage stellt,
     * ob hier etwas anderes gemeint ist.
     */
    private static void messen(Pruefumgebung umgebung, Intent absicht) {
        String anbieterId = text(absicht, "anbieter", "");
        String url = text(absicht, "url", "");
        Provider anbieter = umgebung.anbieter(anbieterId);
        if (anbieter == null) {
            Log.e(TAG, MARKE + " Anbieter unbekannt: " + anbieterId);
            return;
        }
        if (!url.startsWith("http")) {
            Log.e(TAG, MARKE + " Adresse fehlt oder ist keine: " + url);
            return;
        }
        double laufzeit = zahl(absicht, "laufzeit", 0);
        if (!(laufzeit > 0)) {
            Log.e(TAG, MARKE + " Laufzeit fehlt - ohne sie verwirft die Regel jeden Stand");
            return;
        }
        double position = zahl(absicht, "position", 0);
        // Ohne eigene Angabe zählt die Position als gespielt: das ist der Fall
        // "von vorn durchgeschaut" und der häufigste in einer Prüfung.
        double gespielt = zahl(absicht, "gespielt", position);
        boolean beendet = absicht.getIntExtra("beendet", 0) != 0
            || "true".equalsIgnoreCase(text(absicht, "beendet", ""));

        JSONObject gemessen = new JSONObject();
        try {
            gemessen.put("currentTime", position);
            gemessen.put("duration", laufzeit);
            gemessen.put("playedSeconds", gespielt);
            gemessen.put("ended", beendet);
            gemessen.put("nextUrl", text(absicht, "naechste", ""));
        } catch (Exception fehler) {
            Log.e(TAG, MARKE + " Messwert nicht gebaut", fehler);
            return;
        }
        // Was sonst die Seite beisteuert. Ohne diese Angaben ist der Fall
        // "letzte Folge der letzten Staffel" nicht zu prüfen: dass eine Folge
        // die letzte ist, steht im Folgenverzeichnis der Serie und nicht im
        // Video.
        JSONObject zusatz = new JSONObject();
        try {
            String titel = text(absicht, "titel", "");
            if (!titel.isEmpty()) zusatz.put("title", titel);
            String art = text(absicht, "art", "");
            if (!art.isEmpty()) zusatz.put("type", art);
            int letzteStaffel = (int) zahl(absicht, "letzteStaffel", 0);
            int letzteFolge = (int) zahl(absicht, "letzteFolge", 0);
            if (letzteStaffel > 0) zusatz.put("finalSeason", letzteStaffel);
            if (letzteFolge > 0) zusatz.put("finalEpisode", letzteFolge);
        } catch (Exception fehler) {
            Log.e(TAG, MARKE + " Zusatzangaben nicht gebaut", fehler);
            return;
        }

        Log.i(TAG, String.format(java.util.Locale.ROOT,
            "%s messen: %s %.1f/%.1fs gespielt %.1fs%s%s",
            MARKE, url, position, laufzeit, gespielt, beendet ? " ENDE" : "",
            zusatz.length() > 0 ? " zusatz=" + zusatz : ""));
        Messung messung = umgebung.messung();
        if (messung == null) {
            Log.e(TAG, MARKE + " keine Messung vorhanden");
            return;
        }
        messung.verbuchen(anbieter, url, gemessen, zusatz.length() > 0 ? zusatz : null);
        umgebung.neuZeichnen();
    }

    /**
     * Was in der Ablage steht - eine Zeile je Eintrag.
     *
     * <p>Der Nachweis für eine Prüfung. Absichtlich als Protokollzeilen und
     * nicht als Datei: eine Prüfung liest ohnehin das Protokoll mit, und eine
     * Datei müsste erst herübergeholt werden.
     */
    private static void zustand(Pruefumgebung umgebung) {
        Bestand bestand = umgebung.bestand();
        if (bestand == null) {
            Log.e(TAG, MARKE + " keine Ablage vorhanden");
            return;
        }
        JSONArray roh = bestand.roh();
        Log.i(TAG, MARKE + " zustand: " + roh.length() + " Eintraege");
        for (int i = 0; i < roh.length(); i += 1) {
            JSONObject eintrag = roh.optJSONObject(i);
            if (eintrag == null) continue;
            JSONArray abgeschlosseneFolgen = eintrag.optJSONArray("completedEpisodes");
            Log.i(TAG, String.format(java.util.Locale.ROOT,
                "%s eintrag %d: id=%s titel=%s url=%s progress=%d currentTime=%.1f "
                    + "duration=%.1f watched=%s completed=%s favorite=%s hideFromContinue=%s "
                    + "continuePending=%s type=%s folgenAbgeschlossen=%d",
                MARKE, i,
                eintrag.optString("id"), eintrag.optString("title"), eintrag.optString("url"),
                eintrag.optInt("progress", 0), eintrag.optDouble("currentTime", 0),
                eintrag.optDouble("duration", 0),
                eintrag.optBoolean("watched"), eintrag.optBoolean("completed"),
                eintrag.optBoolean("favorite"), eintrag.optBoolean("hideFromContinueWatching"),
                eintrag.optBoolean("continuePending"), eintrag.optString("type"),
                abgeschlosseneFolgen == null ? 0 : abgeschlosseneFolgen.length()));
        }
    }

    private static void sitzungen(Pruefumgebung umgebung) {
        Statistik statistik = umgebung.statistik();
        if (statistik == null) {
            Log.e(TAG, MARKE + " keine Statistik vorhanden");
            return;
        }
        JSONArray liste = statistik.alle();
        Log.i(TAG, MARKE + " sitzungen: " + liste.length());
        for (int i = 0; i < liste.length(); i += 1) {
            JSONObject sitzung = liste.optJSONObject(i);
            if (sitzung == null) continue;
            Log.i(TAG, String.format(java.util.Locale.ROOT,
                "%s sitzung %d: titel=%s s%de%d sekunden=%d abgeschlossen=%s begonnen=%s",
                MARKE, i, sitzung.optString("titel"), sitzung.optInt("season"),
                sitzung.optInt("episode"), sitzung.optInt("sekunden"),
                sitzung.optBoolean("abgeschlossen"), sitzung.optString("begonnenAm")));
        }
    }

    private static String text(Intent absicht, String name, String vorgabe) {
        String wert = absicht.getStringExtra(name);
        return wert == null ? vorgabe : wert;
    }

    /**
     * Eine Zahl aus dem Aufruf.
     *
     * <p>{@code am broadcast} kennt {@code --ef} (float), {@code --ei} (int)
     * und {@code --es} (String). Alle drei werden angenommen, damit ein
     * Tippfehler in der Befehlszeile nicht als "Wert fehlt" durchgeht.
     */
    private static double zahl(Intent absicht, String name, double vorgabe) {
        if (absicht.hasExtra(name)) {
            Object wert = absicht.getExtras() == null ? null : absicht.getExtras().get(name);
            if (wert instanceof Number) return ((Number) wert).doubleValue();
            if (wert instanceof String) {
                try {
                    return Double.parseDouble((String) wert);
                } catch (NumberFormatException fehler) {
                    Log.w(TAG, MARKE + " " + name + " ist keine Zahl: " + wert);
                }
            }
        }
        return vorgabe;
    }
}
