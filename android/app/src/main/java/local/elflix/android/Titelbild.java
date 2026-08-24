package local.elflix.android;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Woher ein Eintrag sein Titelbild bekommt.
 *
 * <p>Das Bild steht auf der Anbieterseite - als {@code og:image}, als Poster
 * neben der Beschreibung oder im Hintergrund einer Kachel. Welches davon zum
 * Titel gehoert und welches aus der Empfehlungsspalte daneben stammt, ist keine
 * Kleinigkeit: ein falsches Bild ist schlimmer als keins.
 *
 * <p>Deshalb steht die Auswahl nicht hier. Sie steht in {@code seitendaten.js},
 * kommt aus der Desktop-App und wird von ihr genauso benutzt - der Kern reicht
 * den Quelltext heraus, diese Klasse spielt ihn in die Seite ein. Was hier
 * bleibt, ist die Verkabelung: fragen, sich merken und nachtragen.
 *
 * <p>Gefragt wird beim Seitenwechsel, nicht im Messtakt. Ein Titelbild aendert
 * sich nicht alle fuenf Sekunden, und das Skript geht durch jedes Bild der
 * Seite - das ist Arbeit, die einmal je Seite genuegt. Weil manche Anbieter
 * ihre Bilder nachladen, wird zweimal nachgefasst, falls beim ersten Blick
 * noch keines dastand.
 */
public final class Titelbild {
    private static final String TAG = CrashReporter.TAG;
    /** Wann noch einmal nachgesehen wird, wenn die Seite noch kein Bild hergab. */
    private static final long[] NACHFASSEN_MS = {2500, 7000};

    private final Kern kern;
    private final Bestand bestand;
    private final Handler haupt = new Handler(Looper.getMainLooper());

    private String skript;
    /** Zu welcher Adresse das zuletzt Gefundene gehoert. */
    private String adresse = "";
    private String bild = "";
    private String favicon = "";

    public Titelbild(Kern kern, Bestand bestand) {
        this.kern = kern;
        this.bestand = bestand;
    }

    /**
     * Auf dieser Seite nach dem Titelbild sehen.
     *
     * <p>Der Aufruf kehrt sofort zurueck. Findet sich etwas, wird es dem
     * Eintrag nachgetragen, der zu dieser Adresse gehoert - und steht ausserdem
     * bereit, wenn gleich darauf einer angelegt wird.
     */
    public void suchen(WebView ansicht, Provider anbieter, String seitenAdresse) {
        if (ansicht == null || anbieter == null || seitenAdresse == null
            || !seitenAdresse.startsWith("http")) {
            return;
        }
        if (!seitenAdresse.equals(adresse)) {
            // Eine neue Seite - was von der vorigen bekannt war, gilt hier nicht.
            adresse = seitenAdresse;
            bild = "";
            favicon = "";
        }
        skriptHolen(() -> lesen(ansicht, anbieter, seitenAdresse, 0));
    }

    /**
     * Was zu dieser Adresse bekannt ist, in der Form, die die geteilte Regel
     * erwartet - zum Anhaengen an die Angaben eines Standes.
     *
     * <p>Nur zur passenden Adresse: das Bild der vorigen Folge gehoert nicht an
     * den Eintrag der naechsten Serie.
     */
    public JSONObject angaben(String seitenAdresse) {
        JSONObject angaben = new JSONObject();
        if (seitenAdresse == null || !seitenAdresse.equals(adresse)) return angaben;
        try {
            if (!bild.isEmpty()) angaben.put("thumbnail", bild);
            if (!favicon.isEmpty()) angaben.put("favicon", favicon);
        } catch (Exception fehler) {
            Log.d(TAG, "Bildangaben nicht gebaut: " + fehler);
        }
        return angaben;
    }

    /** Fuegt die bekannten Bildangaben in bestehende Angaben ein, ohne sie zu ueberschreiben. */
    public JSONObject ergaenzen(JSONObject angaben, String seitenAdresse) {
        JSONObject dazu = angaben(seitenAdresse);
        JSONObject ziel = angaben == null ? new JSONObject() : angaben;
        for (java.util.Iterator<String> namen = dazu.keys(); namen.hasNext(); ) {
            String name = namen.next();
            if (ziel.has(name)) continue;
            try {
                ziel.put(name, dazu.get(name));
            } catch (Exception fehler) {
                Log.d(TAG, "Bildangabe nicht uebernommen: " + fehler);
            }
        }
        return ziel;
    }

    private void skriptHolen(Runnable danach) {
        if (skript != null) {
            danach.run();
            return;
        }
        if (kern == null || !kern.istBereit()) return;
        kern.rufe("seitendaten.seitenSkript", (wert, fehler) -> {
            if (fehler != null || wert == null) {
                Log.e(TAG, "Seitenskript nicht erhalten: " + fehler);
                return;
            }
            try {
                // Der Wert kommt als JSON-Text: ein Textliteral in Anfuehrungszeichen.
                skript = new JSONArray("[" + wert + "]").getString(0);
            } catch (Exception ausnahme) {
                Log.e(TAG, "Seitenskript unlesbar", ausnahme);
                return;
            }
            danach.run();
        });
    }

    private void lesen(WebView ansicht, Provider anbieter, String seitenAdresse, int versuch) {
        if (skript == null || !seitenAdresse.equals(adresse)) return;
        ansicht.evaluateJavascript(skript, wert -> {
            if (!seitenAdresse.equals(adresse)) return;
            String gefunden = "";
            String gefundenesFavicon = "";
            if (wert != null && !"null".equals(wert)) {
                try {
                    JSONObject daten = new JSONObject(wert);
                    gefunden = daten.optString("thumbnail", "");
                    gefundenesFavicon = daten.optString("favicon", "");
                } catch (Exception fehler) {
                    // Ein aelterer WebView kann am Skript scheitern. Dann gibt
                    // es hier eben kein Bild - die Karte bleibt bei ihren
                    // Buchstaben, und sonst aendert sich nichts.
                    Log.d(TAG, "Seitendaten unlesbar: " + fehler);
                }
            }
            if (!gefundenesFavicon.isEmpty()) favicon = gefundenesFavicon;
            if (!gefunden.isEmpty()) {
                bild = gefunden;
                if (bestand != null) bestand.bildNachtragen(anbieter, seitenAdresse, gefunden);
                return;
            }
            // Nichts gefunden: manche Anbieter haengen ihre Bilder erst nach
            // dem Laden ein.
            if (versuch < NACHFASSEN_MS.length) {
                haupt.postDelayed(() -> lesen(ansicht, anbieter, seitenAdresse, versuch + 1),
                    NACHFASSEN_MS[versuch]);
            }
        });
    }
}
