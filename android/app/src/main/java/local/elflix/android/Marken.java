package local.elflix.android;

import android.content.Context;
import android.util.Log;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Intro ueberspringen - gelernt statt erkannt.
 *
 * <p>Ein Intro zu <em>erkennen</em> geht hier nicht: ELFIX sieht das Video nie,
 * es liegt im Rahmen des Hosters. Also andersherum - wer eine Serie schaut,
 * spult das Intro selbst weg, jede Folge an derselben Stelle. Aus zwei
 * uebereinstimmenden Spruengen in zwei verschiedenen Folgen wird eine Marke,
 * und ab der naechsten Folge steht dort ein Knopf. Ein Knopf, kein
 * Automatismus: ein falscher Sprung kostet neunzig Sekunden Handlung.
 *
 * <p>Die Regel steht in {@code marken.js} und ist dieselbe wie am Rechner.
 * Diese Klasse haelt die Datei und bringt das Skript dorthin, wo das Video
 * liegt - und das ist der Unterschied zum Rechner: dort spielt Electron in
 * jeden Rahmen ein, hier tut es {@link Rahmen}.
 *
 * <p>Ein Punkt ist bewusst anders als am Rechner geloest. Wird die Funktion
 * mitten in einer Folge abgeschaltet, hoert Android sofort auf zu lernen -
 * {@link #eingeschaltet()} wird auch beim Verbuchen geprueft, nicht nur beim
 * Einspielen. Am Rechner meldet der Horcher in der Seite bis zum naechsten
 * Seitenwechsel weiter.
 */
public final class Marken {
    private static final String TAG = CrashReporter.TAG;
    private static final String DATEI = "marken.json";
    /** Dieselbe Fassungsnummer wie die Datei am Rechner traegt. */
    private static final int SCHEMA = 1;

    private final Context context;
    private final Kern kern;
    private final Rahmen rahmen;
    private final Ablage ablage;

    private String meldeSprung = "__elfix:sprung:";
    private String meldeGenutzt = "__elfix:marke:genutzt";

    public Marken(Context context, Kern kern, Rahmen rahmen) {
        this.context = context;
        this.kern = kern;
        this.rahmen = rahmen;
        this.ablage = new Ablage(context, DATEI, SCHEMA);
    }

    /** Bestand und Meldetexte einmalig in den Kern reichen. */
    public void vorbereiten() {
        if (kern == null) return;
        kern.wennBereit(() -> {
            kern.rufe("marken-bruecke.laden", Kern.args(ablage.lesen()), (wert, fehler) -> {
                if (fehler != null) Log.e(TAG, "Marken nicht geladen: " + fehler);
                else Log.i(TAG, "Marken geladen: " + wert + " Staffeln");
            });
            praefixHolen("marken-bruecke.MELDE_SPRUNG", wert -> meldeSprung = wert);
            praefixHolen("marken-bruecke.MELDE_GENUTZT", wert -> meldeGenutzt = wert);
        });
    }

    private void praefixHolen(String pfad, java.util.function.Consumer<String> beiWert) {
        kern.rufe(pfad, (wert, fehler) -> {
            String text = Kern.text(wert);
            if (fehler == null && !text.isEmpty()) beiWert.accept(text);
        });
    }

    /**
     * Das Skript in die Rahmen bringen, in denen ein Video liegt.
     *
     * <p>Aufgerufen wird das, sobald sich ein solcher Rahmen meldet - nicht bei
     * jedem Seitenende. Der Hoster baut sein Video oft erst danach ein, und ein
     * Skript, das vorher laeuft, findet nichts.
     *
     * @param lernen aus, solange eine Watchparty laeuft: der Player wird dort
     *               staendig auf den Host gezogen, und diese Spruenge sind
     *               nicht die Entscheidung dessen, der hier sitzt
     */
    public void einspielen(WebView ansicht, Provider anbieter, String url,
                           JSONArray eintraege, boolean lernen) {
        if (ansicht == null || anbieter == null || url == null || !url.startsWith("http")) return;
        if (kern == null || !kern.istBereit() || rahmen == null) return;
        if (!eingeschaltet()) {
            // Ausgeschaltet heisst auch: der Knopf verschwindet sofort, nicht
            // erst bei der naechsten Folge.
            kern.rufe("marken-bruecke.abschalten", (wert, fehler) -> {
                if (fehler == null) rahmen.anSpieler(ansicht, Kern.text(wert));
            });
            return;
        }

        kern.rufe("marken-bruecke.skript",
            Kern.args(eintraege, anbieter.alsJson(), url, lernen), (wert, fehler) -> {
                if (fehler != null || wert == null || "null".equals(wert)) return;
                try {
                    JSONObject antwort = new JSONObject(wert);
                    String skript = antwort.optString("skript", "");
                    if (skript.isEmpty()) return;
                    int erreicht = rahmen.anSpieler(ansicht, skript);
                    if (erreicht > 0 && !antwort.isNull("marke")) {
                        Log.i(TAG, "Intromarke gesetzt in " + erreicht + " Rahmen: "
                            + antwort.optJSONObject("marke"));
                    }
                } catch (Exception ausnahme) {
                    Log.e(TAG, "Markenskript unlesbar", ausnahme);
                }
            });
    }

    /** Ob eine Konsolenzeile ueberhaupt uns gilt. */
    public boolean istMeldung(String zeile) {
        return zeile != null && (zeile.startsWith(meldeSprung) || zeile.equals(meldeGenutzt));
    }

    /**
     * Ein Sprung aus der Seite - oder die Nachricht, dass der Knopf benutzt
     * wurde.
     *
     * <p>Gespeichert wird nur, wenn der Sprung etwas beitraegt; das entscheidet
     * die geteilte Regel.
     */
    public void meldung(Provider anbieter, String url, JSONArray eintraege, String zeile,
                        java.util.function.Consumer<String> ansage) {
        if (kern == null || !kern.istBereit() || anbieter == null || url == null) return;
        if (!eingeschaltet() || !istMeldung(zeile)) return;
        if (zeile.equals(meldeGenutzt)) {
            Log.i(TAG, "Intro uebersprungen");
            return;
        }

        kern.rufe("marken-bruecke.sprungLesen", Kern.args(zeile), (gelesen, fehler) -> {
            if (fehler != null || gelesen == null || "null".equals(gelesen)) return;
            try {
                JSONObject sprung = new JSONObject(gelesen);
                kern.rufe("marken-bruecke.sprung",
                    Kern.args(eintraege, anbieter.alsJson(), url,
                        sprung.optDouble("von", 0), sprung.optDouble("nach", 0)),
                    (wert, sprungFehler) -> {
                        if (sprungFehler != null || wert == null || "null".equals(wert)) return;
                        try {
                            JSONObject ergebnis = new JSONObject(wert);
                            JSONObject neu = ergebnis.optJSONObject("eintraege");
                            if (neu == null) return;
                            ablage.schreiben(neu);
                            Log.i(TAG, "Marken: " + ergebnis.optString("log"));
                            String text = ergebnis.optString("ansage", "");
                            if (!text.isEmpty() && ansage != null) ansage.accept(text);
                        } catch (Exception ausnahme) {
                            Log.e(TAG, "Sprungergebnis unlesbar", ausnahme);
                        }
                    });
            } catch (Exception ausnahme) {
                Log.e(TAG, "Sprungmeldung unlesbar", ausnahme);
            }
        });
    }

    /** Die Auskunft fuer die Einstellungen: wie viele Staffeln, wie viele Marken. */
    public void stand(java.util.function.Consumer<JSONObject> beiAntwort) {
        if (kern == null || !kern.istBereit()) {
            beiAntwort.accept(null);
            return;
        }
        kern.rufe("marken-bruecke.stand", (wert, fehler) -> {
            if (fehler != null || wert == null) {
                beiAntwort.accept(null);
                return;
            }
            try {
                beiAntwort.accept(new JSONObject(wert));
            } catch (Exception ausnahme) {
                beiAntwort.accept(null);
            }
        });
    }

    /** Alles vergessen - derselbe Weg zurueck wie am Rechner. */
    public void vergessen(Runnable danach) {
        if (kern == null || !kern.istBereit()) {
            if (danach != null) danach.run();
            return;
        }
        kern.rufe("marken-bruecke.vergessen", (wert, fehler) -> {
            ablage.schreiben(new JSONObject());
            if (danach != null) danach.run();
        });
    }

    /** Derselbe Schalter wie am Rechner ({@code playback.introSkip}). */
    public boolean eingeschaltet() {
        return context.getSharedPreferences("elflix_settings", Context.MODE_PRIVATE)
            .getBoolean("intro_skip", true);
    }

    public void einschalten(boolean an) {
        context.getSharedPreferences("elflix_settings", Context.MODE_PRIVATE)
            .edit().putBoolean("intro_skip", an).apply();
    }
}
