package local.elflix.android;

import android.content.Context;
import android.util.Log;
import android.webkit.WebView;

import org.json.JSONObject;

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
    static final String[] KATEGORIEN = { "sponsor", "selfpromo", "interaction", "intro", "outro" };

    private final Context context;
    private final Kern kern;
    private final Rahmen rahmen;

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

        if (!eingeschaltet()) {
            // Aus heisst aus, und zwar sofort: wer den Schalter mitten im Video
            // umlegt, soll nicht bis zum naechsten warten muessen.
            kern.rufe("sponsorblock-bruecke.abschalten", (wert, fehler) -> {
                if (fehler == null) rahmen.anSpieler(ansicht, Kern.text(wert));
            });
            return;
        }

        kern.rufe("sponsorblock-bruecke.skript", Kern.args(url, einstellungen()),
            (wert, fehler) -> {
                if (fehler != null) return;
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

    /** Ob diese Kategorie uebersprungen wird. Intro und Outro sind aus. */
    public boolean kategorie(String name) {
        return flagge(name, !"intro".equals(name) && !"outro".equals(name));
    }

    public void kategorieUmschalten(String name) {
        setzen(name, !kategorie(name));
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
            if (kategorie(name)) anzahl += 1;
        }
        return anzahl;
    }

    private boolean flagge(String name, boolean standard) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean("sponsorblock_" + name, standard);
    }

    private void setzen(String name, boolean wert) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean("sponsorblock_" + name, wert).apply();
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
