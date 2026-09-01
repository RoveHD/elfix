package local.elflix.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Der Weg zur naechsten Folge - und die Frage, wann er von selbst gegangen wird.
 *
 * <h2>Was hier gefehlt hat</h2>
 *
 * <p>Am Rechner gehoert beides zum Schauen: ein Knopf "Naechste Folge" und ein
 * Schalter, ob es am Ende von selbst weitergeht ({@code playback.autoplayNextEpisode}
 * in den Einstellungen, der Zaehler in {@code main.js}). Auf Android gab es
 * weder das eine noch das andere. Es gab genau eine Taste auf der Fernbedienung
 * (die 9), und die rechnete sich ihre Adresse selbst zusammen: Folgennummer
 * plus eins, und wenn die Seite dazu keinen Link hatte, Staffel plus eins. Zwei
 * Regeln fuer dieselbe Frage, und die hier war die schlechtere - sie kannte
 * weder das Ende einer Serie noch zusammengefasste Folgen.
 *
 * <h2>Woher die Adresse jetzt kommt</h2>
 *
 * <p>Aus {@code fortschritt.nextEpisodeContinueUrl} - derselben Funktion, die
 * der Rechner fragt. Sie bekommt dreierlei und entscheidet daraus:
 *
 * <ol>
 *   <li>den Link, den die Seite selbst als naechste Folge anbietet
 *       ({@code messung.js} liest ihn mit; er wird geprueft und nicht geglaubt),
 *   <li>den Eintrag mit den Grenzen der Serie ({@code finalSeason},
 *       {@code finalEpisode}) - daran haengt, ob ueberhaupt noch etwas kommt,
 *   <li>die Angaben der Seite: welche Folgen dieser Staffel nicht abspielbar
 *       sind und wo die Staffel aufhoert ({@code seasonLastEpisode}).
 * </ol>
 *
 * <p>Damit faellt der Staffeluebergang dort, wo er hingehoert: die letzte Folge
 * einer Staffel fuehrt auf Folge 1 der naechsten, die letzte Folge der letzten
 * Staffel auf nichts. Hochgezaehlt wird nur, wo die Seite nichts Besseres
 * hergibt.
 *
 * <p>Und bevor gefahren wird, wird gefragt: {@code darfNaechsteFolgeSein} -
 * derselbe Torwaechter wie am Rechner. Dieselbe Serie, weiter vorn als die
 * laufende Folge. Das Ziel kann aus einer fremden Seite stammen, und was von
 * dort kommt, wird geprueft.
 *
 * <h2>Wann von selbst gewechselt wird</h2>
 *
 * <p>Am <em>Ende</em> der Folge, nicht bei 90 Prozent. Das sind zwei
 * verschiedene Dinge, und sie wurden hier bewusst getrennt gehalten: die
 * Prozentschwelle sagt, ob eine Folge als gesehen zaehlt (das entscheidet die
 * geteilte Regel und niemand sonst), {@link #amEnde} sagt, ob das Video
 * durchgelaufen ist. Wer bei 91 Prozent weiterschaut, schaut weiter - er wird
 * nicht aus seiner Folge geworfen. Dieselbe Trennung steht am Rechner in
 * {@code syncViewMediaProgress}, und die Zahlen sind dieselben.
 */
final class Folgen {
    private static final String TAG = CrashReporter.TAG;

    /** Dieselbe Ablage wie die uebrigen Einstellungen der App. */
    static final String ABLAGE = "elflix_settings";
    /**
     * Der Schluessel des Autoplay-Schalters.
     *
     * <p>Ein eigener Name und nicht der des Rechners: dort steht die
     * Einstellung in {@code settings.json} unter {@code playback.autoplayNextEpisode},
     * hier in den SharedPreferences. Gemeint ist derselbe Zustand mit derselben
     * Vorgabe - an ist die Vorgabe, wie am Rechner ({@code !== false}).
     */
    static final String SCHLUESSEL_AUTOPLAY = "autoplay_next_episode";

    /**
     * Wie nah ans Ende es sein muss, damit es als Ende zaehlt.
     *
     * <p>Dieselbe Toleranz wie am Rechner. Ohne sie bliebe ein Hoster, dessen
     * Video eine Zehntelsekunde vor der gemeldeten Laufzeit stehenbleibt und
     * kein {@code ended} schickt, ewig kurz vor dem Ende stehen.
     */
    private static final double ENDE_TOLERANZ_S = 1.5;

    /**
     * Ab wo der Knopf "Naechste Folge" ueberhaupt dasteht.
     *
     * <p>Dieselbe Schwelle wie {@code NEXT_EPISODE_PROMPT_PERCENT} am Rechner.
     * Frueher waere er ein Knopf fuer etwas, das noch gar nicht ansteht - und
     * im Vollbild ein Kasten, der eine Stunde lang neben dem Bild klebt.
     */
    static final int KNOPF_AB_PROZENT = 90;

    /**
     * Wie lange der Zaehler laeuft, bevor die naechste Folge von selbst startet.
     *
     * <p>Dieselben fuenf Sekunden wie {@code NEXT_EPISODE_COUNTDOWN_SECONDS} am
     * Rechner. Sie sind der Unterschied zwischen "es geht weiter" und "man
     * wurde weitergeschoben": in fuenf Sekunden laesst sich abbrechen.
     */
    static final int ZAEHLER_SEKUNDEN = 5;

    /** Das Ergebnis der Suche: eine Adresse oder leer. */
    interface Antwort {
        void fertig(String url);
    }

    private final Kern kern;

    Folgen(Kern kern) {
        this.kern = kern;
    }

    /* ----------------------------------------------------- Die Einstellung */

    static boolean autoplayAn(Context context) {
        if (context == null) return true;
        SharedPreferences ablage = context.getSharedPreferences(ABLAGE, Context.MODE_PRIVATE);
        return ablage.getBoolean(SCHLUESSEL_AUTOPLAY, true);
    }

    static void setzeAutoplayAn(Context context, boolean an) {
        if (context == null) return;
        context.getSharedPreferences(ABLAGE, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(SCHLUESSEL_AUTOPLAY, an)
            .apply();
    }

    /* ------------------------------------------------------------ Die Regel */

    /**
     * Ist die Folge wirklich durchgelaufen?
     *
     * <p>Rein und ohne Ansicht, damit sie sich pruefen laesst - und ausdruecklich
     * nicht dasselbe wie "gilt als gesehen". Siehe der Klassenkopf.
     *
     * @param position wo der Player steht, in Sekunden
     * @param laufzeit wie lang die Folge ist, in Sekunden
     * @param beendet  was der Player selbst sagt ({@code video.ended})
     */
    static boolean amEnde(double position, double laufzeit, boolean beendet) {
        if (beendet) return true;
        if (!(laufzeit > 0)) return false;
        return position >= laufzeit - ENDE_TOLERANZ_S;
    }

    /**
     * Wie weit die Folge ist, in Prozent.
     *
     * <p>Dieselbe Rechnung wie {@code mediaProgressPercent} im geteilten Modul.
     * Sie steht hier noch einmal, weil die Leiste sie in jedem Takt braucht und
     * ein Weg ueber die Bruecke fuer eine Division zu viel des Guten waere -
     * gerundet wird gleich, und geprueft wird es auch.
     */
    static int prozent(double position, double laufzeit) {
        if (!(laufzeit > 0) || !(position >= 0)) return 0;
        long wert = Math.round(position / laufzeit * 100);
        return (int) Math.max(0, Math.min(100, wert));
    }

    /**
     * Steht das Ende der Folge bevor?
     *
     * <p>Die Frage des <em>Knopfes</em>, nicht die des Zaehlers. Ab neunzig
     * Prozent gehoert der Weg zur naechsten Folge sichtbar dazu - vorher waere
     * er ein Angebot fuer etwas, das noch gar nicht ansteht.
     *
     * <p>Ausdruecklich {@code !amEnde}: am Ende gilt {@link #amEnde}, und dort
     * faengt der Zaehler an. Die beiden schliessen einander aus, damit an jeder
     * Stelle genau eine Regel greift - dieselbe Trennung wie zwischen
     * {@code fastFertig} und {@code amEnde} am Rechner.
     */
    static boolean nahAmEnde(double position, double laufzeit, boolean beendet) {
        if (amEnde(position, laufzeit, beendet)) return false;
        return prozent(position, laufzeit) >= KNOPF_AB_PROZENT;
    }

    /**
     * Staffel und Folge einer Adresse, in Worten.
     *
     * <p>Nur fuer Hinweise und Protokolle. Was wirklich als naechste Folge
     * gilt, entscheidet der Kern - hier wird nichts gerechnet, nur gelesen.
     */
    static String folgenText(String url) {
        if (url == null) return "";
        java.util.regex.Matcher staffel = java.util.regex.Pattern
            .compile("/(?:staffel|season)-(\\d+)(?:/|$)", java.util.regex.Pattern.CASE_INSENSITIVE)
            .matcher(url);
        java.util.regex.Matcher folge = java.util.regex.Pattern
            .compile("/(?:episode|folge)-(\\d+)(?:/|$)", java.util.regex.Pattern.CASE_INSENSITIVE)
            .matcher(url);
        String s = staffel.find() ? staffel.group(1) : "";
        String f = folge.find() ? folge.group(1) : "";
        if (f.isEmpty()) return "";
        if (s.isEmpty()) return "Folge " + f;
        return "Staffel " + s + " Folge " + f;
    }

    /* ------------------------------------------------- Die naechste Adresse */

    /**
     * Welche Folge nach dieser kommt.
     *
     * <p>Antwortet mit einer leeren Zeichenkette, wenn es keine gibt - am Ende
     * der Serie, auf einer Seite, die gar keine Folge ist, oder solange die
     * Grenzen der Serie noch nicht bekannt sind. Der Knopf verschwindet dann;
     * das ist die richtige Auskunft und keine Panne.
     *
     * @param laufend       die Folgenseite, bei der wir stehen
     * @param eintrag       der Eintrag dazu (darf {@code null} sein)
     * @param seitenangaben was die Seite ueber die Staffel weiss (darf {@code null} sein)
     * @param seitenLink    der Folgenlink, den die Seite selbst anbietet (darf leer sein)
     */
    void naechste(String laufend, JSONObject eintrag, JSONObject seitenangaben,
                  String seitenLink, Antwort antwort) {
        if (antwort == null) return;
        if (kern == null || !kern.istBereit() || laufend == null || !laufend.startsWith("http")) {
            antwort.fertig("");
            return;
        }
        JSONArray argumente = new JSONArray();
        argumente.put(laufend);
        argumente.put(seitenLink == null ? "" : seitenLink);
        argumente.put(eintrag == null ? JSONObject.NULL : eintrag);
        argumente.put(seitenangaben == null ? JSONObject.NULL : seitenangaben);
        kern.rufe("fortschritt.nextEpisodeContinueUrl", argumente, (wert, fehler) -> {
            if (fehler != null) {
                Log.d(TAG, "Naechste Folge nicht bestimmt: " + fehler);
                antwort.fertig("");
                return;
            }
            antwort.fertig(text(wert));
        });
    }

    /**
     * Welche Folge vor dieser kommt.
     *
     * <p>Dieselbe Zulieferung wie bei {@link #naechste}, nur eine Auskunft
     * weniger: der Eintrag traegt die Grenzen der Serie, und die zaehlen nur
     * vorwaerts. Rueckwaerts steht die Grenze in der Adresse selbst - vor
     * Folge 1 kommt nichts.
     *
     * <p>Ein Torwaechter fehlt hier absichtlich. Die Adresse rechnet der Kern
     * aus der laufenden Folge aus; sie stammt nicht von der Anbieterseite, und
     * geprueft wird, was von dort kommt.
     *
     * @param laufend       die Folgenseite, bei der wir stehen
     * @param seitenangaben was die Seite ueber die Staffel weiss (darf {@code null} sein)
     */
    void vorige(String laufend, JSONObject seitenangaben, Antwort antwort) {
        if (antwort == null) return;
        if (kern == null || !kern.istBereit() || laufend == null || !laufend.startsWith("http")) {
            antwort.fertig("");
            return;
        }
        JSONArray argumente = new JSONArray();
        argumente.put(laufend);
        argumente.put(seitenangaben == null ? JSONObject.NULL : seitenangaben);
        kern.rufe("fortschritt.vorigeEpisodeUrl", argumente, (wert, fehler) -> {
            if (fehler != null) {
                Log.d(TAG, "Vorige Folge nicht bestimmt: " + fehler);
                antwort.fertig("");
                return;
            }
            antwort.fertig(text(wert));
        });
    }

    /**
     * Gehoert die Wiedergabeleiste auf diese Seite?
     *
     * <p>Dieselbe Frage, die der Rechner mit {@code autoplaySchalterSeite}
     * stellt, und dieselbe Antwort: {@code fortschritt.istAbspielseite}. Auf
     * der Startseite, in der Suche oder in einer Uebersicht laeuft nichts -
     * dort waere die Leiste nur ein Kasten, der ueber der Seite klebt.
     */
    void abspielseite(String url, Freigabe antwort) {
        if (antwort == null) return;
        if (kern == null || !kern.istBereit() || url == null || !url.startsWith("http")) {
            antwort.gilt(false);
            return;
        }
        kern.rufe("fortschritt.istAbspielseite", Kern.args(url), (wert, fehler) ->
            antwort.gilt(fehler == null && "true".equals(text(wert))));
    }

    /** Eine Ja-Nein-Antwort aus dem Kern. */
    interface Freigabe {
        void gilt(boolean ja);
    }

    /**
     * Darf ELFIX dieser Adresse folgen?
     *
     * <p>Derselbe Torwaechter wie am Rechner, und aus demselben Grund: das Ziel
     * kann aus der Anbieterseite stammen. Geprueft wird gegen die Folge, bei
     * der wir stehen - dieselbe Serie, weiter vorn.
     */
    void pruefen(String ziel, String laufend, JSONObject eintrag, Antwort antwort) {
        if (antwort == null) return;
        if (kern == null || !kern.istBereit() || ziel == null || ziel.isEmpty()) {
            antwort.fertig("");
            return;
        }
        JSONArray argumente = new JSONArray();
        argumente.put(ziel);
        argumente.put(laufend == null ? "" : laufend);
        argumente.put(eintrag == null ? JSONObject.NULL : eintrag);
        kern.rufe("fortschritt.darfNaechsteFolgeSein", argumente, (wert, fehler) -> {
            boolean erlaubt = fehler == null && "true".equals(text(wert));
            if (!erlaubt) {
                Log.i(TAG, "Naechste Folge abgelehnt: " + kurz(ziel)
                    + " ist keine naechste Folge von " + kurz(laufend));
            }
            antwort.fertig(erlaubt ? ziel : "");
        });
    }

    /**
     * Eine Adresse, so kurz, dass sie in eine Protokollzeile passt.
     *
     * <p>Ohne {@code android.net.Uri}: dieselbe Zeile soll im Unit-Test
     * dasselbe ergeben wie auf dem Geraet, und dort ist Uri nur ein Rumpf.
     */
    static String kurz(String url) {
        String roh = url == null ? "" : url.trim();
        if (roh.isEmpty()) return "(leer)";
        int schema = roh.indexOf("://");
        String ohneSchema = schema < 0 ? roh : roh.substring(schema + 3);
        int frage = ohneSchema.indexOf('?');
        if (frage >= 0) ohneSchema = ohneSchema.substring(0, frage);
        int raute = ohneSchema.indexOf('#');
        if (raute >= 0) ohneSchema = ohneSchema.substring(0, raute);
        return ohneSchema;
    }

    /**
     * Ein Textwert aus einer Kern-Antwort.
     *
     * <p>Die Bruecke liefert JSON: eine Zeichenkette steht in Anfuehrungszeichen,
     * {@code null} kommt als das Wort "null" an.
     */
    private static String text(String wert) {
        String roh = wert == null ? "" : wert.trim();
        if (roh.isEmpty() || "null".equals(roh)) return "";
        if (roh.length() >= 2 && roh.startsWith("\"") && roh.endsWith("\"")) {
            try {
                return new JSONArray("[" + roh + "]").getString(0);
            } catch (Exception fehler) {
                return "";
            }
        }
        return roh;
    }
}
