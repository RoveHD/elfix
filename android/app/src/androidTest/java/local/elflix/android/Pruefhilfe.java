package local.elflix.android;

import android.content.Context;
import android.content.Intent;

import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Handgriffe, die jede Prüfung auf dem Gerät braucht.
 *
 * <p>Zwei Dinge sind hier bemerkenswert, und beide folgen daraus, dass die App
 * ihre Arbeit nicht auf dem Thread erledigt, der die Prüfung ausführt.
 *
 * <p><b>Erstens wird gewartet, nicht geschlafen.</b> Ein Messwert läuft über
 * die Brücke in den Kern, wird dort von der geteilten Regel beurteilt und
 * kommt zurück, bevor die Ablage sich ändert. Wie lange das dauert, hängt vom
 * Gerät ab. Ein festes {@code sleep} wäre auf dem Emulator zu kurz und auf
 * einem schnellen Telefon verschwendet; {@link #warteAuf} fragt stattdessen im
 * kurzen Takt nach, bis die Bedingung stimmt oder die Geduld endet.
 *
 * <p><b>Zweitens wird die Ablage von der Platte gelesen</b> und nicht aus dem
 * laufenden {@code Bestand}. Das ist der strengere Weg: was hier steht, hat den
 * ganzen Weg genommen - Regel, Übernahme <em>und</em> Speichern. Ein Stand, der
 * nur im Arbeitsspeicher steht, überlebt keinen Prozessabbruch, und genau das
 * soll eine Prüfung merken.
 */
final class Pruefhilfe {
    /** So lange darf ein Schritt dauern, bevor die Prüfung ihn für misslungen hält. */
    static final long GEDULD_MS = 20_000;
    private static final long TAKT_MS = 250;

    private Pruefhilfe() {
    }

    static Context context() {
        return InstrumentationRegistry.getInstrumentation().getTargetContext();
    }

    /**
     * Die App starten - über einen Intent und nicht über {@code ActivityScenario}.
     *
     * <p>Das ist keine Vorliebe. {@code MainActivity} steht im Manifest als
     * {@code launchMode="singleTask"}, weil die App genau ein Fenster haben
     * soll; {@code ActivityScenario} verlangt aber, eine eigene Instanz starten
     * und verfolgen zu können. Beides zusammen geht nicht: das System schiebt
     * die vorhandene Aufgabe nach vorn, die Instanz von {@code ActivityScenario}
     * wird abgeräumt, und was danach geprüft wird, ist eine tote Activity. Ein
     * ganzer Durchlauf war so grün an den Stellen, wo nichts passierte, und rot
     * überall sonst.
     *
     * <p>Der Weg über den Intent ist derselbe, den der Startbildschirm nimmt.
     */
    static void appStarten() {
        Context context = context();
        android.content.Intent absicht =
            context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        absicht.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(absicht);
        warteAuf(() -> app() != null, 60_000);
    }

    /**
     * Die Activity, die gerade vorn steht.
     *
     * <p>Über den Lebenslauf-Wächter der Testbibliothek statt über eine eigene
     * Referenz: die App darf zwischendurch neu aufbauen - beim Drehen etwa -,
     * und eine gemerkte Instanz zeigte danach ins Leere.
     */
    static MainActivity app() {
        final MainActivity[] gefunden = new MainActivity[1];
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            for (android.app.Activity activity : androidx.test.runner.lifecycle
                .ActivityLifecycleMonitorRegistry.getInstance()
                .getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED)) {
                if (activity instanceof MainActivity) gefunden[0] = (MainActivity) activity;
            }
        });
        return gefunden[0];
    }

    /** Etwas auf der laufenden App tun - auf ihrem Thread. */
    static void aufApp(Handgriff handgriff) {
        MainActivity app = app();
        if (app == null) return;
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> handgriff.tue(app));
    }

    interface Handgriff {
        void tue(MainActivity app);
    }

    /** Ein Messwert, so wie ihn das Messskript geliefert hätte. */
    static void messen(String anbieter, String url, double position, double laufzeit,
                       double gespielt, boolean beendet) {
        messen(anbieter, url, position, laufzeit, gespielt, beendet, 0, 0);
    }

    /** Wie oben, dazu die Grenzen der Serie - was im Betrieb von der Anbieterseite kommt. */
    static void messen(String anbieter, String url, double position, double laufzeit,
                       double gespielt, boolean beendet, int letzteStaffel, int letzteFolge) {
        Intent absicht = new Intent(Pruefstand.AKTION);
        absicht.putExtra("befehl", "messen");
        absicht.putExtra("anbieter", anbieter);
        absicht.putExtra("url", url);
        absicht.putExtra("position", (float) position);
        absicht.putExtra("laufzeit", (float) laufzeit);
        absicht.putExtra("gespielt", (float) gespielt);
        absicht.putExtra("beendet", beendet ? 1 : 0);
        absicht.putExtra("titel", titelAus(url));
        absicht.putExtra("art", url.contains("/film") ? "film" : "serie");
        if (letzteStaffel > 0) absicht.putExtra("letzteStaffel", (float) letzteStaffel);
        if (letzteFolge > 0) absicht.putExtra("letzteFolge", (float) letzteFolge);
        // Geradeaus statt über einen Broadcast: die Prüfung läuft im selben
        // Prozess wie die App. Wann - und ob - das System einen Broadcast
        // zustellt, entscheidet nicht die App, und eine Prüfung, die daran
        // hängt, misst etwas anderes als sie soll. Dahinter ist es dieselbe
        // Zeile; auf den Hauptthread muss es, weil dort der Kern liegt.
        InstrumentationRegistry.getInstrumentation()
            .runOnMainSync(() -> Pruefstand.ausfuehrenSicher(absicht));
    }

    /** Der Eintrag zu diesem Titel, von der Platte gelesen - oder {@code null}. */
    static JSONObject eintragMitTitel(String titel) {
        JSONArray alle = FavoriteStore.ladeRoh(context());
        for (int i = 0; i < alle.length(); i += 1) {
            JSONObject eintrag = alle.optJSONObject(i);
            if (eintrag != null && titel.equals(eintrag.optString("title"))) return eintrag;
        }
        return null;
    }

    /** Wie viele Einträge es zu diesem Titel gibt - für die Frage nach Doppelten. */
    static int anzahlMitTitel(String titel) {
        JSONArray alle = FavoriteStore.ladeRoh(context());
        int zahl = 0;
        for (int i = 0; i < alle.length(); i += 1) {
            JSONObject eintrag = alle.optJSONObject(i);
            if (eintrag != null && titel.equals(eintrag.optString("title"))) zahl += 1;
        }
        return zahl;
    }

    /**
     * Warten, bis etwas stimmt.
     *
     * @return ob die Bedingung eingetreten ist - {@code false} heisst
     *         abgelaufen, und der Aufrufer sagt in seiner Meldung, worauf
     *         gewartet wurde
     */
    static boolean warteAuf(Bedingung bedingung) {
        return warteAuf(bedingung, GEDULD_MS);
    }

    static boolean warteAuf(Bedingung bedingung, long geduldMs) {
        long ende = System.currentTimeMillis() + geduldMs;
        while (System.currentTimeMillis() < ende) {
            try {
                if (bedingung.stimmt()) return true;
            } catch (Exception fehler) {
                // Noch nicht so weit - der naechste Takt fragt wieder.
            }
            try {
                Thread.sleep(TAKT_MS);
            } catch (InterruptedException unterbrochen) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        try {
            return bedingung.stimmt();
        } catch (Exception fehler) {
            return false;
        }
    }

    /**
     * Warten, bis der Kern antwortet.
     *
     * <p>Erkennbar daran, dass ein Messwert ankommt: vorher verwirft
     * {@code Bestand.verbuchen} jeden Stand, weil es niemanden gibt, der die
     * Regel anwenden könnte. Ohne dieses Warten schlägt der erste Fall jeder
     * Prüfung fehl, und zwar nicht aus einem Grund, den die Prüfung meint.
     */
    /** Jede Kernprobe traegt eine andere Stelle - siehe {@link #warteAufKern}. */
    private static double probenStelle = 900;

    static void warteAufKern(String anbieter, String url, String titel) {
        // Erst muss der Pruefstand ueberhaupt an einer lebenden App haengen -
        // sonst laeuft jeder Befehl ins Leere, und das saehe aus wie eine
        // abgelehnte Regel.
        warteAuf(Pruefstand::bereit, 60_000);

        // Gewartet wird auf eine Stelle, die es vorher nicht gab, und nicht auf
        // die blosse Anwesenheit des Eintrags. Der Unterschied zaehlt, weil der
        // Laeufer zwischen zwei Pruefungen jede offene Activity schliesst: die
        // App startet neu, ihr Kern braucht ein paar Sekunden, und der Eintrag
        // der vorigen Pruefung steht laengst da. "Ist er da?" waere sofort
        // wahr - und der erste Messwert danach fiele in einen Kern, den es noch
        // nicht gibt.
        probenStelle += 100;
        final double ziel = probenStelle;
        warteAuf(() -> {
            messen(anbieter, url, ziel, 10_000, ziel, false);
            JSONObject eintrag = eintragMitTitel(titel);
            return eintrag != null && Math.abs(eintrag.optDouble("currentTime") - ziel) < 0.5;
        }, 60_000);
    }

    private static String titelAus(String url) {
        String[] teile = url.split("/");
        for (int i = 0; i < teile.length; i += 1) {
            if ("stream".equals(teile[i]) && i + 1 < teile.length) return teile[i + 1];
        }
        return teile[teile.length - 1];
    }

    interface Bedingung {
        boolean stimmt() throws Exception;
    }
}
