package local.elflix.android;

import android.util.Log;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Kosmetische Filterung: was den Player zudeckt, verschwindet.
 *
 * <p>Der Werbeblocker verhindert Anfragen. Was er nicht verhindert, ist das,
 * was die Seite selbst aufbaut - die Schicht ueber dem Video, die erst nach
 * einem Klick verschwindet, und den Kasten, der beim Scrollen mitwandert. Am
 * Rechner nimmt sich ELFIX das seit dem Adblock-Umbau vor; auf Android gab es
 * bisher nichts davon.
 *
 * <p>Die Beurteilung liegt in {@code adblock-kosmetik.js} und ist damit
 * dieselbe wie am Rechner: dieselben geschuetzten Namen (nichts anfassen, was
 * ein Video, ein Captcha oder ein Eingabefeld enthaelt), dieselbe
 * Punktevergabe, dieselbe Schwelle von vier Punkten. Diese Klasse spielt nur
 * das Skript ein, faengt seine Meldungen auf und fuehrt aus, was
 * zurueckkommt.
 *
 * <p>Ein Unterschied bleibt und ist unvermeidbar: die Frage "ist dieser Host
 * ein Werbe-Host" beantwortet am Rechner die tsurlfilter-Engine, hier die
 * mitgelieferte Domainliste. Die Engine braucht dauerhaft rund 480 MB - das
 * ueberlebt kein Fernseher-Stick.
 */
public final class Kosmetik {
    private static final String TAG = CrashReporter.TAG;

    private final Kern kern;
    private final Adblocker adblocker;

    private String seitenScript;
    private String meldePraefix = "__elfix:ad:";

    public Kosmetik(Kern kern, Adblocker adblocker) {
        this.kern = kern;
        this.adblocker = adblocker;
    }

    /** Holt Skript und Meldepraefix einmalig aus dem Kern. */
    public void vorbereiten() {
        skriptHolen(null);
        if (kern == null || !kern.istBereit()) return;
        kern.rufe("kosmetik-bruecke.MELDE_PRAEFIX", (wert, fehler) -> {
            if (fehler == null && wert != null) {
                String praefix = textAus(wert);
                if (!praefix.isEmpty()) meldePraefix = praefix;
            }
        });
    }

    private void skriptHolen(Runnable danach) {
        if (seitenScript != null) {
            if (danach != null) danach.run();
            return;
        }
        if (kern == null || !kern.istBereit()) return;
        kern.rufe("kosmetik-bruecke.seitenScript", (wert, fehler) -> {
            if (fehler != null || wert == null) {
                Log.e(TAG, "Kosmetik-Skript nicht erhalten: " + fehler);
                return;
            }
            seitenScript = textAus(wert);
            if (danach != null) danach.run();
        });
    }

    /**
     * Spielt das Suchskript in eine geladene Seite.
     *
     * <p>Wartet notfalls auf den Kern. Der braucht beim Kaltstart ein paar
     * Sekunden, und in genau der Zeit ist die erste Anbieterseite oft schon
     * fertig - dann waere das Skript nie hineingekommen und die Seite die
     * einzige ohne kosmetische Filterung. Gemessen: Seite fertig nach vier
     * Sekunden, Kern bereit nach fuenf.
     *
     * <p>Eingespielt wird nur, wenn der Werbeblocker fuer diesen Anbieter an
     * ist - wer ihn abschaltet, will auch nichts ausgeblendet haben.
     */
    public void einspielen(WebView ansicht, Provider anbieter) {
        if (ansicht == null) return;
        if (anbieter != null && !anbieter.adblockEnabled) return;
        skriptHolen(() -> {
            // Die Seite kann inzwischen weitergeblaettert sein; das Skript
            // meldet sich dann eben fuer die neue. Es ist gegen mehrfaches
            // Einspielen abgesichert (siehe KENNUNG in adblock-kosmetik.js).
            if (seitenScript == null) return;
            ansicht.evaluateJavascript(seitenScript, null);
        });
    }

    /** Ob eine Konsolenzeile ueberhaupt uns gilt. */
    public boolean istMeldung(String zeile) {
        return zeile != null && zeile.startsWith(meldePraefix);
    }

    /**
     * Verarbeitet eine Meldung der Seite.
     *
     * <p>Zwei Schritte ueber die Bruecke: erst die Hosts erfragen, die in den
     * Kandidaten vorkommen, dann - nachdem Java sie gegen seine Domainliste
     * gehalten hat - das Urteil holen. Zwei Aufrufe statt einem, weil die
     * Domainliste in Java liegt und nicht im Kern; Meldungen sind selten
     * genug, dass das nicht ins Gewicht faellt.
     */
    public void meldung(WebView ansicht, Provider anbieter, String zeile) {
        if (kern == null || !kern.istBereit() || ansicht == null || !istMeldung(zeile)) return;
        if (anbieter != null && !anbieter.adblockEnabled) return;

        kern.rufe("kosmetik-bruecke.kandidatenLesen", Kern.args(zeile), (wert, fehler) -> {
            if (fehler != null || wert == null || "null".equals(wert)) return;
            JSONArray werbeHosts = new JSONArray();
            try {
                JSONObject gelesen = new JSONObject(wert);
                JSONArray hosts = gelesen.optJSONArray("hosts");
                for (int i = 0; hosts != null && i < hosts.length(); i += 1) {
                    String host = hosts.optString(i, "");
                    if (!host.isEmpty() && adblocker.istWerbeHost(host)) werbeHosts.put(host);
                }
            } catch (Exception ausnahme) {
                Log.e(TAG, "Kandidaten unlesbar", ausnahme);
                return;
            }
            urteilHolen(ansicht, zeile, werbeHosts);
        });
    }

    private void urteilHolen(WebView ansicht, String zeile, JSONArray werbeHosts) {
        kern.rufe("kosmetik-bruecke.urteile", Kern.args(zeile, werbeHosts), (wert, fehler) -> {
            if (fehler != null || wert == null) return;
            try {
                JSONObject urteil = new JSONObject(wert);
                String skript = urteil.optString("skript", "");
                if (skript.isEmpty()) return;
                JSONArray gruende = urteil.optJSONArray("gruende");
                if (gruende != null && gruende.length() > 0) {
                    Log.i(TAG, "Overlay entfernt: " + gruende.join(" | "));
                }
                ansicht.evaluateJavascript(skript, null);
            } catch (Exception ausnahme) {
                Log.e(TAG, "Urteil unlesbar", ausnahme);
            }
        });
    }

    private static String textAus(String jsonWert) {
        String text = jsonWert == null ? "" : jsonWert.trim();
        if ("null".equals(text)) return "";
        if (text.length() >= 2 && text.startsWith("\"") && text.endsWith("\"")) {
            try {
                return new JSONArray("[" + text + "]").getString(0);
            } catch (Exception ignoriert) {
                return text.substring(1, text.length() - 1);
            }
        }
        return text;
    }
}
