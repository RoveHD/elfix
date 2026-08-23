package local.elflix.android;

import android.content.Context;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Sub bleibt Sub - ab der zweiten Folge.
 *
 * <p>AniWorld und S.to legen jede Folge mehrfach ab, einmal je Synchronfassung,
 * und stellen bei jeder neuen Folge wieder auf das, was der Anbieter fuer
 * richtig haelt. Wer eine Serie auf Japanisch mit Untertiteln schaut, klickt
 * das sonst zwanzig Mal - am Telefon mit dem Daumen auf einer Reihe kleiner
 * Flaggen.
 *
 * <p>Die Regel dazu steht in {@code fassung.js} und ist dieselbe wie am
 * Rechner: gelernt wird aus dem, was jemand selbst anklickt, die Vorgabe des
 * Anbieters ueberschreibt eine gelernte Fassung niemals. Diese Klasse haelt nur
 * die Datei und spielt das Skript ein.
 *
 * <p>Das ist das einzige der drei Player-Skripte des Rechners, das auf Android
 * unveraendert laufen kann: die Flaggenreihe steht auf der Anbieterseite und
 * damit im Hauptdokument. Intromarken und Qualitaetswahl brauchen den Rahmen
 * des Hosters, und dorthin reicht {@code evaluateJavascript} nicht.
 */
public final class Fassungen {
    private static final String TAG = CrashReporter.TAG;
    private static final String DATEI = "fassungen.json";
    /** Dieselbe Fassungsnummer wie die Datei am Rechner traegt. */
    private static final int SCHEMA = 1;
    /**
     * So lange wartet der Autostart, bevor er einen Hoster anklickt.
     *
     * <p>Die Anbieterseite zeigt nur die Hoster der gewaehlten Fassung. Ein
     * Klick, bevor sie umgeschaltet hat, traefe die der alten - und damit die
     * falsche Sprache, obwohl alles richtig gemerkt war.
     */
    private static final long WARTE_MS = 4000;

    private final Context context;
    private final Kern kern;
    /** Dasselbe Format wie fassungen.json am Rechner - siehe {@link Ablage}. */
    private final Ablage ablage;

    /** Bis wann der Autostart auf die Fassung wartet (uptimeMillis). */
    private long wartetBis = 0;
    /** Fuer welche Adresse zuletzt eine Vorwahl gemeldet wurde - gegen Doppelmeldungen. */
    private String gemeldet = "";
    private String meldeStand = "__elfix:fassung:stand:";
    private String meldeWahl = "__elfix:fassung:wahl:";

    public Fassungen(Context context, Kern kern) {
        this.context = context;
        this.kern = kern;
        this.ablage = new Ablage(context, DATEI, SCHEMA);
    }

    /** Bestand und Meldepraefixe einmalig in den Kern reichen. */
    public void vorbereiten() {
        if (kern == null) return;
        kern.wennBereit(() -> {
            kern.rufe("fassung-bruecke.laden", Kern.args(ablage.lesen()), (wert, fehler) -> {
                if (fehler != null) Log.e(TAG, "Fassungen nicht geladen: " + fehler);
                else Log.i(TAG, "Fassungen geladen: " + wert + " Titel");
            });
            praefixHolen("fassung-bruecke.MELDE_STAND", wert -> meldeStand = wert);
            praefixHolen("fassung-bruecke.MELDE_WAHL", wert -> meldeWahl = wert);
        });
    }

    private void praefixHolen(String pfad, java.util.function.Consumer<String> beiWert) {
        kern.rufe(pfad, (wert, fehler) -> {
            String text = Kern.text(wert);
            if (fehler == null && !text.isEmpty()) beiWert.accept(text);
        });
    }

    /**
     * Die gemerkte Fassung anklicken, bevor der Autostart nach einem Hoster
     * sucht.
     *
     * <p>Eingespielt wird auch ohne gemerkte Fassung: das Skript meldet dann
     * nur, was dasteht, und genau daraus lernt die erste Folge einer Serie.
     */
    public void einspielen(WebView ansicht, Provider anbieter, String url, JSONArray eintraege) {
        if (ansicht == null || anbieter == null || url == null || !url.startsWith("http")) return;
        if (kern == null || !kern.istBereit() || !eingeschaltet()) return;

        kern.rufe("fassung-bruecke.skript", Kern.args(eintraege, anbieter.alsJson(), url),
            (wert, fehler) -> {
                if (fehler != null || wert == null || "null".equals(wert)) return;
                try {
                    JSONObject antwort = new JSONObject(wert);
                    String skript = antwort.optString("skript", "");
                    if (skript.isEmpty()) return;
                    // Die Sperre steht, bevor das Skript laeuft - ein Hoster,
                    // der in dieser Zeit angeklickt wuerde, waere der falsche.
                    if (antwort.optBoolean("wartet", false)) {
                        wartetBis = SystemClock.uptimeMillis() + WARTE_MS;
                    }
                    ansicht.evaluateJavascript(skript, ergebnis -> {
                        String stand = Kern.text(ergebnis);
                        // "geklickt" heisst: gedrueckt, aber die Seite hat noch
                        // nicht umgeschaltet. Dann bleibt die Sperre stehen,
                        // bis die Zeit ablaeuft.
                        if (!stand.startsWith("geklickt")) wartetBis = 0;
                        if (stand.startsWith("gewechselt") && !url.equals(gemeldet)) {
                            gemeldet = url;
                            String name = antwort.optString("name", "");
                            Log.i(TAG, "Fassung vorgewaehlt: " + name);
                        }
                    });
                } catch (Exception ausnahme) {
                    Log.e(TAG, "Fassungsskript unlesbar", ausnahme);
                }
            });
    }

    /** Ob der Autostart gerade auf die Umschaltung warten muss. */
    public boolean wartet() {
        return wartetBis > SystemClock.uptimeMillis();
    }

    /** Ob eine Konsolenzeile ueberhaupt uns gilt. */
    public boolean istMeldung(String zeile) {
        return zeile != null && (zeile.startsWith(meldeStand) || zeile.startsWith(meldeWahl));
    }

    /**
     * Eine Meldung aus der Seite verarbeiten.
     *
     * <p>Geschrieben wird nur, wenn sich wirklich etwas geaendert hat - das
     * entscheidet die geteilte Regel, nicht diese Klasse.
     */
    public void meldung(Provider anbieter, String url, JSONArray eintraege, String zeile,
                        java.util.function.Consumer<String> ansage) {
        if (kern == null || !kern.istBereit() || anbieter == null || url == null) return;
        if (!eingeschaltet() || !istMeldung(zeile)) return;

        kern.rufe("fassung-bruecke.meldung",
            Kern.args(eintraege, anbieter.alsJson(), url, zeile), (wert, fehler) -> {
                if (fehler != null || wert == null || "null".equals(wert)) return;
                try {
                    JSONObject ergebnis = new JSONObject(wert);
                    JSONObject neu = ergebnis.optJSONObject("eintraege");
                    if (neu == null) return;
                    ablage.schreiben(neu);
                    Log.i(TAG, "Fassung gemerkt: " + ergebnis.optString("schluessel")
                        + " -> " + ergebnis.optString("name")
                        + " (" + ergebnis.optString("art") + ")");
                    String text = ergebnis.optString("ansage", "");
                    if (!text.isEmpty() && ansage != null) ansage.accept(text);
                } catch (Exception ausnahme) {
                    Log.e(TAG, "Fassungsmeldung unlesbar", ausnahme);
                }
            });
    }

    /** Die Auskunft fuer die Einstellungen: wie viele Titel, welche Fassungen. */
    public void stand(java.util.function.Consumer<JSONObject> beiAntwort) {
        if (kern == null || !kern.istBereit()) {
            beiAntwort.accept(null);
            return;
        }
        kern.rufe("fassung-bruecke.stand", (wert, fehler) -> {
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
        kern.rufe("fassung-bruecke.vergessen", (wert, fehler) -> {
            ablage.schreiben(new JSONObject());
            if (danach != null) danach.run();
        });
    }

    /**
     * Ob die Funktion eingeschaltet ist.
     *
     * <p>Derselbe Schalter wie am Rechner ({@code playback.rememberLanguage}),
     * hier in den Voreinstellungen des Telefons. Aus heisst: es wird weder
     * gelernt noch vorgewaehlt - anders als bei den Intromarken am Rechner, wo
     * ein Abschalten mitten in der Folge das Lernen nicht stoppt.
     */
    public boolean eingeschaltet() {
        return context.getSharedPreferences("elflix_settings", Context.MODE_PRIVATE)
            .getBoolean("remember_language", true);
    }

    public void einschalten(boolean an) {
        context.getSharedPreferences("elflix_settings", Context.MODE_PRIVATE)
            .edit().putBoolean("remember_language", an).apply();
    }

}
