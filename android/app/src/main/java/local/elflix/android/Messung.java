package local.elflix.android;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;

import org.json.JSONObject;

/**
 * Der Takt, in dem ELFIX nachsieht, was gerade laeuft.
 *
 * <p>Alle fuenf Sekunden geht dasselbe Skript in die Anbieterseite, das auch am
 * Rechner benutzt wird - es kommt aus {@code src/messung.js} und liegt im Kern.
 * Es liest Position und Laufzeit des groessten sichtbaren Videos und zaehlt
 * mit, wie viele Sekunden davon wirklich abgespielt wurden. Genau diese Zahl
 * unterscheidet "geschaut" von "durchgezogen", und sie muss auf beiden
 * Geraeten dieselbe sein - sonst bedeutet die 2:30-Schwelle hier etwas anderes
 * als dort.
 *
 * <p>Was dabei herauskommt, geht unveraendert an {@link Bestand}, der es der
 * geteilten Regel vorlegt. Diese Klasse entscheidet nichts.
 */
public final class Messung {
    private static final String TAG = CrashReporter.TAG;
    /** Derselbe Takt wie am Desktop. */
    private static final long TAKT_MS = 5000;

    /** Woher die laufende Seite kommt - Anbieter und Adresse, im Augenblick des Takts. */
    public interface Seite {
        Provider anbieter();

        WebView ansicht();

        String adresse();

        /** Ob die Watchparty gerade eine Folge vorgibt. */
        boolean watchpartyFuehrt();
    }

    private final Kern kern;
    private final Bestand bestand;
    private final Seite seite;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private String messSkript;
    private boolean laeuft;

    private final Runnable takt = new Runnable() {
        @Override
        public void run() {
            einmalMessen();
            if (laeuft) handler.postDelayed(this, TAKT_MS);
        }
    };

    /**
     * Der Weg in den Rahmen des Hosters - dort, wo das Video wirklich liegt.
     *
     * <p>Ohne ihn sieht die Messung nur das Hauptdokument. Bei den grossen
     * Anbietern steht dort kein Video, sondern ein Rahmen von einem fremden
     * Wirt; die gezaehlten Sekunden blieben dann null, und die 2:30-Schwelle
     * bekaeme nie etwas zu sehen.
     */
    private Rahmen rahmen;

    /**
     * Das Titelbild der laufenden Seite.
     *
     * <p>Es gehoert an den Stand, weil die geteilte Regel es genau einmal
     * setzt: beim Anlegen des Eintrags. Wer es hier nicht mitgibt, hat auf der
     * Karte nie eines - so war es bisher.
     */
    private Titelbild titelbild;

    /** Der Meldekopf, an dem eine Antwort aus einem Rahmen zu erkennen ist. */
    public static final String MELDE_MESSUNG = "mess:";

    public Messung(Kern kern, Bestand bestand, Seite seite) {
        this.kern = kern;
        this.bestand = bestand;
        this.seite = seite;
    }

    public void setzeRahmen(Rahmen rahmen) {
        this.rahmen = rahmen;
    }

    public void setzeTitelbild(Titelbild titelbild) {
        this.titelbild = titelbild;
    }

    public void starten() {
        if (laeuft) return;
        laeuft = true;
        skriptHolen(() -> handler.postDelayed(takt, TAKT_MS));
    }

    public void anhalten() {
        laeuft = false;
        handler.removeCallbacks(takt);
    }

    /**
     * Holt den Quelltext des Messskripts einmalig aus dem Kern.
     *
     * <p>Einmal, weil er sich nicht aendert - und weil ein Aufruf ueber die
     * Bruecke bei jedem Takt Arbeit waere, die nichts bringt.
     */
    private void skriptHolen(Runnable danach) {
        if (messSkript != null) {
            danach.run();
            return;
        }
        if (kern == null || !kern.istBereit()) return;
        kern.rufe("messung.messSkript", (wert, fehler) -> {
            if (fehler != null || wert == null) {
                Log.e(TAG, "Messskript nicht erhalten: " + fehler);
                return;
            }
            // Der Wert kommt als JSON-Text: ein Textliteral in Anfuehrungszeichen.
            try {
                messSkript = new org.json.JSONArray("[" + wert + "]").getString(0);
            } catch (Exception ausnahme) {
                Log.e(TAG, "Messskript unlesbar", ausnahme);
                return;
            }
            danach.run();
        });
    }

    private void einmalMessen() {
        if (messSkript == null || seite == null) return;
        WebView ansicht = seite.ansicht();
        Provider anbieter = seite.anbieter();
        String adresse = seite.adresse();
        if (ansicht == null || anbieter == null || adresse == null || !adresse.startsWith("http")) return;

        // Erst die Rahmen: liegt das Video beim Hoster, kann nur von dort eine
        // Antwort kommen. Das Hauptdokument wird trotzdem gefragt - manche
        // Anbieter binden den Player unmittelbar ein, und ein Rahmen ohne Video
        // liefert ohnehin nichts.
        if (rahmen != null) {
            rahmen.anSpieler(ansicht,
                "try{elfixRahmen.postMessage(\"" + MELDE_MESSUNG
                    + "\"+JSON.stringify(" + messSkript + "))}catch(e){}");
        }
        ansicht.evaluateJavascript(messSkript, wert -> {
            if (wert == null || "null".equals(wert)) return;
            try {
                JSONObject gemessen = new JSONObject(wert);
                verbuchen(anbieter, adresse, gemessen);
            } catch (Exception fehler) {
                // Eine Seite ohne Video liefert null; alles andere ist selten
                // genug, um es nur zu vermerken.
                Log.d(TAG, "Messwert unlesbar: " + fehler);
            }
        });
    }

    /**
     * Eine Antwort aus einem Rahmen.
     *
     * <p>Verbucht wird sie auf die Adresse des Hauptdokuments, nicht auf die des
     * Rahmens: der Eintrag gehoert zur Folge beim Anbieter, und der Hoster
     * heisst bei jeder Folge anders.
     */
    public void ausRahmen(String nachricht) {
        if (nachricht == null || !nachricht.startsWith(MELDE_MESSUNG) || seite == null) return;
        String roh = nachricht.substring(MELDE_MESSUNG.length());
        if (roh.isEmpty() || "null".equals(roh)) return;
        Provider anbieter = seite.anbieter();
        String adresse = seite.adresse();
        if (anbieter == null || adresse == null || !adresse.startsWith("http")) return;
        try {
            verbuchen(anbieter, adresse, new JSONObject(roh));
        } catch (Exception fehler) {
            Log.d(TAG, "Messwert aus dem Rahmen unlesbar: " + fehler);
        }
    }

    /**
     * Einen Messwert verbuchen.
     *
     * <p>Nicht privat, sondern paketweit sichtbar - wegen {@link Pruefstand}.
     * Der Debug-Bau speist hier Werte ein, die sonst das Messskript liefert;
     * alles ab dieser Zeile ist danach dieselbe Strecke, die eine echte
     * Wiedergabe geht. Genau darum geht es: eine Pruefung, die den Weg
     * abkuerzt, prueft den Weg nicht.
     *
     * <p>Im Release ruft das niemand: {@code Pruefstand} ist dort ein leerer
     * Rumpf ohne Empfaenger.
     */
    void verbuchen(Provider anbieter, String adresse, JSONObject gemessen) {
        verbuchen(anbieter, adresse, gemessen, null);
    }

    /**
     * Wie oben, mit zusaetzlichen Angaben ueber die Seite.
     *
     * <p>Im Betrieb kommen sie aus {@link Titelbild} - Titel, Art und die
     * Grenzen der Serie. Der {@link Pruefstand} reicht sie stattdessen von
     * Hand herein, weil es dort keine Seite gibt, von der sie zu lesen waeren:
     * "das ist die letzte Folge der letzten Staffel" ist eine Angabe der Seite
     * und keine des Videos.
     *
     * @param zusatz wird nach den Bildangaben eingefuegt und ueberschreibt
     *               nichts, was schon dasteht; {@code null} erlaubt
     */
    void verbuchen(Provider anbieter, String adresse, JSONObject gemessen, JSONObject zusatz) {
        double position = gemessen.optDouble("currentTime", 0);
        double laufzeit = gemessen.optDouble("duration", 0);
        if (!(laufzeit > 0)) return;
        double gespielt = gemessen.optDouble("playedSeconds", 0);
        boolean beendet = gemessen.optBoolean("ended", false);
        int prozent = (int) Math.round(Math.max(0, Math.min(100, position / laufzeit * 100)));

        JSONObject meta = new JSONObject();
        try {
            meta.put("currentTime", position);
            meta.put("position", position);
            meta.put("duration", laufzeit);
            meta.put("watchedSeconds", gespielt);
            meta.put("progress", prozent);
            // Dieselbe Bedingung wie am Desktop: das Ende der Datei oder die
            // Prozentschwelle. Ob das wirklich als gesehen zaehlt, entscheidet
            // die geteilte Regel - sie verlangt zusaetzlich die Wiedergabezeit.
            meta.put("completed", beendet || prozent >= 90);
            meta.put("nextUrl", gemessen.optString("nextUrl", ""));
            // Die beiden Rohwerte wandern unveraendert mit. Die
            // Fortschrittsregel liest sie nicht - sie fragt nach
            // watchedSeconds und completed -, aber die Sitzungsaufzeichnung
            // braucht genau diese Namen: `sitzungslauf.js` bekommt am Rechner
            // den rohen Messwert gereicht, und zwei Saetze Feldnamen fuer
            // dieselbe Zahl waeren die erste Stelle, an der beide Geraete
            // wieder auseinanderlaufen.
            meta.put("playedSeconds", gespielt);
            meta.put("ended", beendet);
        } catch (Exception fehler) {
            Log.e(TAG, "Messwerte liessen sich nicht bauen", fehler);
            return;
        }
        // Dieselbe Auskunft, die der Rechner in seiner Media-Diagnose zeigt.
        // Ohne sie ist ein Stand, der nicht weiterrueckt, nicht zu erklaeren:
        // man sieht die Prozentzahl, aber nicht die Sekunden, an denen es
        // haengt.
        Log.i(TAG, String.format(java.util.Locale.ROOT,
            "Messung: %d%% (%.1f/%.1fs) wirklich gespielt %.1fs%s",
            prozent, position, laufzeit, gespielt, beendet ? " ENDE" : ""));
        JSONObject vollstaendig = titelbild == null ? meta : titelbild.ergaenzen(meta, adresse);
        if (zusatz != null) {
            for (java.util.Iterator<String> namen = zusatz.keys(); namen.hasNext(); ) {
                String name = namen.next();
                if (vollstaendig.has(name)) continue;
                try {
                    vollstaendig.put(name, zusatz.get(name));
                } catch (Exception fehler) {
                    Log.d(TAG, "Zusatzangabe nicht uebernommen: " + fehler);
                }
            }
        }
        bestand.verbuchen(anbieter, adresse, vollstaendig,
            seite == null ? false : seite.watchpartyFuehrt());
    }
}
