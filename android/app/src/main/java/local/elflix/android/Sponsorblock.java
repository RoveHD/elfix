package local.elflix.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import android.webkit.WebView;

import org.json.JSONObject;
import java.util.WeakHashMap;

/**
 * SponsorBlock - bezahlte Einschuebe in YouTube-Videos ueberspringen.
 *
 * <p>Erkannt wird hier nichts: was ein Sponsorenblock ist, sagt der offene
 * Katalog von sponsor.ajay.app. Und entschieden wird hier ebenfalls nichts -
 * die Regeln stehen in {@code sponsorblock.js} und sind dieselben wie am
 * Rechner. Diese Klasse haelt die Schalter und bringt das Skript dorthin, wo
 * das Video liegt; das ist der Unterschied zum Rechner, wo Electron in jeden
 * Rahmen einspielt und hier {@link Rahmen} es tut.
 *
 * <p><b>Nur YouTube.</b> Ob eine Adresse dazu gehoert, beantwortet der Kern
 * ({@code youtube.js}) und nicht diese Datei. Bei jedem anderen Anbieter
 * kommt gar kein Skript in die Seite - ein Sprung auf einer Hosterseite waere
 * ein Eingriff an einer Stelle, die ein fremder Dienst fuer ein ganz anderes
 * Video gemeldet hat.
 *
 * <p>Die Schalter liegen wie alle anderen in den {@code SharedPreferences} und
 * ueberstehen damit den Neustart. Ihre Standardwerte stehen in
 * {@code sponsorblock.js}; hier stehen sie ein zweites Mal, weil ein Schalter
 * ablesbar sein muss, bevor der Kern oben ist - und weil das Kaestchen in den
 * Einstellungen sonst beim ersten Aufbau leer waere.
 */
public final class Sponsorblock {
    private static final String TAG = CrashReporter.TAG;
    private static final String PREFS = "elflix_settings";

    /** Die Kategorien in der Reihenfolge der Einstellungen. */
    static final String[] KATEGORIEN = {
        "sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "music_offtopic", "filler"
    };

    static final String UEBERSPRINGEN = "skip";
    static final String NACHFRAGEN = "manual";
    static final String ANZEIGEN = "show";
    static final String AUS = "off";

    private final Context context;
    private final Kern kern;
    private final Rahmen rahmen;
    private final WeakHashMap<WebView, Long> auftraege = new WeakHashMap<>();

    private String melde = "__elfix:sponsorblock:";

    public Sponsorblock(Context context, Kern kern, Rahmen rahmen) {
        this.context = context;
        this.kern = kern;
        this.rahmen = rahmen;
    }

    /** Den Meldetext aus dem Kern holen - eine Wahrheit, nicht zwei. */
    public void vorbereiten() {
        if (kern == null) return;
        kern.wennBereit(() -> kern.rufe("sponsorblock-bruecke.MELDE", (wert, fehler) -> {
            String text = Kern.text(wert);
            if (fehler == null && !text.isEmpty()) melde = text;
        }));
    }

    /**
     * Das Skript in die Rahmen bringen, in denen ein Video liegt.
     *
     * <p>Aufgerufen, sobald sich ein solcher Rahmen meldet, und noch einmal bei
     * jedem Videowechsel innerhalb der Seite: YouTube wechselt das Video ohne
     * Neuladen, und die Segmente des vorigen gehoeren dann nicht mehr dazu.
     */
    public void einspielen(WebView ansicht, String url) {
        if (ansicht == null || url == null || !url.startsWith("http")) return;
        if (kern == null || !kern.istBereit() || rahmen == null) return;
        final long auftrag = auftraege.getOrDefault(ansicht, 0L) + 1L;
        auftraege.put(ansicht, auftrag);

        if (!eingeschaltet()) {
            // Aus heisst aus, und zwar sofort: wer den Schalter mitten im Video
            // umlegt, soll nicht bis zum naechsten warten muessen.
            kern.rufe("sponsorblock-bruecke.abschalten", (wert, fehler) -> {
                if (fehler == null && !eingeschaltet() && Long.valueOf(auftrag).equals(auftraege.get(ansicht))) rahmen.anSpieler(ansicht, Kern.text(wert));
            });
            return;
        }

        final JSONObject auswahl = einstellungen();
        kern.rufe("sponsorblock-bruecke.skript", Kern.args(url, auswahl),
            (wert, fehler) -> {
                if (fehler != null || !Long.valueOf(auftrag).equals(auftraege.get(ansicht))
                    || !auswahl.toString().equals(einstellungen().toString())) return;
                String skript = Kern.text(wert);
                // Leer heisst: hier laeuft kein YouTube. Dann geht nichts in die
                // Seite - andere Anbieter bleiben unberuehrt.
                if (skript.isEmpty()) return;
                rahmen.anSpieler(ansicht, skript);
            });
    }

    /** Ob eine Konsolenzeile ueberhaupt uns gilt. */
    public boolean istMeldung(String zeile) {
        return zeile != null && zeile.startsWith(melde);
    }

    /**
     * Ein uebersprungener Abschnitt.
     *
     * <p>Die Einblendung steht in der Seite - hier wird nur mitgeschrieben,
     * damit ein Fehlgriff nachvollziehbar ist und nicht raetselhaft bleibt.
     */
    public void meldung(String zeile) {
        if (!istMeldung(zeile)) return;
        Log.i(TAG, "SponsorBlock: " + zeile.substring(melde.length()));
    }

    // --- Die Schalter ---------------------------------------------------------

    public boolean eingeschaltet() {
        return flagge("enabled", true);
    }

    public void einschalten(boolean an) {
        setzen("enabled", an);
    }

    /**
     * Die gewuenschte Behandlung einer Kategorie.
     *
     * <p>Fruehere APKs speicherten an derselben Stelle einen Boolean. Der wird
     * beim ersten Lesen punktgenau in den neuen Wert ueberfuehrt; andere
     * Einstellungen derselben Preferences bleiben dabei unangetastet.
     */
    public String kategorie(String name) {
        SharedPreferences ablage = ablage();
        Object roh = ablage.getAll().get("sponsorblock_" + name);
        if (roh instanceof Boolean) {
            String migriert = (Boolean) roh ? UEBERSPRINGEN : AUS;
            ablage.edit().putString("sponsorblock_" + name, migriert).apply();
            return migriert;
        }
        if (roh instanceof String && istModus((String) roh)) return (String) roh;
        return standardModus(name);
    }

    /** Den naechsten eindeutigen Modus fuer Karte, Touch und Fernbedienung waehlen. */
    public void kategorieWeiter(String name) {
        String jetzt = kategorie(name);
        String danach = UEBERSPRINGEN.equals(jetzt) ? NACHFRAGEN
            : NACHFRAGEN.equals(jetzt) ? ANZEIGEN
            : ANZEIGEN.equals(jetzt) ? AUS : UEBERSPRINGEN;
        ablage().edit().putString("sponsorblock_" + name, danach).apply();
    }

    public boolean hinweis() {
        return flagge("hinweis", true);
    }

    public void hinweisUmschalten() {
        setzen("hinweis", !hinweis());
    }

    /** Wie viele Kategorien gerade uebersprungen werden - fuer die Karte. */
    public int gewaehlt() {
        int anzahl = 0;
        for (String name : KATEGORIEN) {
            if (UEBERSPRINGEN.equals(kategorie(name))) anzahl += 1;
        }
        return anzahl;
    }

    private boolean flagge(String name, boolean standard) {
        return ablage().getBoolean("sponsorblock_" + name, standard);
    }

    private void setzen(String name, boolean wert) {
        ablage()
            .edit().putBoolean("sponsorblock_" + name, wert).apply();
    }

    private SharedPreferences ablage() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static boolean istModus(String wert) {
        return UEBERSPRINGEN.equals(wert) || NACHFRAGEN.equals(wert)
            || ANZEIGEN.equals(wert) || AUS.equals(wert);
    }

    private static String standardModus(String name) {
        return ("sponsor".equals(name) || "selfpromo".equals(name)
            || "interaction".equals(name) || "music_offtopic".equals(name))
            ? UEBERSPRINGEN : AUS;
    }

    /** Die Schalter in der Form, die das geteilte Modul liest. */
    private JSONObject einstellungen() {
        JSONObject aus = new JSONObject();
        try {
            aus.put("enabled", eingeschaltet());
            for (String name : KATEGORIEN) {
                aus.put(name, kategorie(name));
            }
            aus.put("hinweis", hinweis());
        } catch (Exception fehler) {
            Log.w(TAG, "SponsorBlock-Einstellungen nicht lesbar", fehler);
        }
        return aus;
    }
}
