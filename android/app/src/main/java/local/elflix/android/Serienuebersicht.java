package local.elflix.android;

import android.util.Log;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Die Seite vor der ersten Folge.
 *
 * <h2>Wozu</h2>
 *
 * <p>Auf dem Telefon und am Fernseher soll man von der Anbieterseite so wenig
 * wie moeglich sehen. Wer eine neue Serie anfaengt, landete bisher unvermittelt
 * dort: fremde Gestaltung, fremde Navigation, Werbung, und irgendwo darin die
 * Folgenliste. Statt dessen kommt jetzt eine eigene Seite - wie viele
 * Staffeln, wie viele Folgen, und welche davon.
 *
 * <p>Die Anbieterseite wird dafuer trotzdem geladen; anders kommt niemand an
 * eine Folgenliste. Sie bleibt aber hinter dem Ladevorhang, und was von ihr
 * bleibt, sind Zahlen und Adressen.
 *
 * <h2>Was hier steht und was nicht</h2>
 *
 * <p>Diese Klasse <em>liest</em> nur. Gelesen wird mit dem geteilten Skript
 * aus {@code seitendaten.js} - demselben Modul, aus dem der Rechner seine
 * Seitenangaben holt. Gezeichnet wird in {@link MainActivity}, weil dort die
 * Bauteile fuer Telefon und Fernseher liegen.
 *
 * <p>Ein Fehlschlag ist ausdruecklich kein Fehler: gibt die Seite nichts her -
 * ein Anbieter mit anderem Aufbau, eine Seite, die noch laedt, ein Film ohne
 * Folgen -, kommt eine leere Uebersicht zurueck, und der Aufrufer macht
 * weiter wie bisher. Eine Sackgasse darf daraus nie werden.
 */
public final class Serienuebersicht {
    private static final String TAG = CrashReporter.TAG;

    /** Eine Staffel, wie die Seite sie fuehrt. */
    public static final class Staffel {
        public final int nummer;
        public final String url;

        Staffel(int nummer, String url) {
            this.nummer = nummer;
            this.url = url;
        }
    }

    /** Eine Folge - mit dem Vermerk, ob sie ueberhaupt laeuft. */
    public static final class Folge {
        public final int staffel;
        public final int nummer;
        public final String url;
        /**
         * Steht auf der Seite, laesst sich aber nicht abspielen.
         *
         * <p>S.to fasst Doppelfolgen zusammen und laesst die uebrigen Zeilen
         * ohne Hoster stehen ("[In E18 enthalten]"). Sie werden gezeigt und
         * nicht verschwiegen - aber sie sind nicht waehlbar, sonst tippt
         * jemand auf eine Folge, die nie startet.
         */
        public final boolean gesperrt;

        Folge(int staffel, int nummer, String url, boolean gesperrt) {
            this.staffel = staffel;
            this.nummer = nummer;
            this.url = url;
            this.gesperrt = gesperrt;
        }
    }

    /** Was von einer Seite zu holen war. */
    public static final class Bestand {
        public final String titel;
        public final int offeneStaffel;
        public final List<Staffel> staffeln;
        public final List<Folge> folgen;

        Bestand(String titel, int offeneStaffel, List<Staffel> staffeln, List<Folge> folgen) {
            this.titel = titel;
            this.offeneStaffel = offeneStaffel;
            this.staffeln = staffeln;
            this.folgen = folgen;
        }

        /** Ob sich damit ueberhaupt eine Seite bauen laesst. */
        public boolean taugt() {
            return !folgen.isEmpty();
        }

        /** Wie viele Folgen wirklich waehlbar sind. */
        public int spielbare() {
            int anzahl = 0;
            for (Folge folge : folgen) {
                if (!folge.gesperrt) anzahl += 1;
            }
            return anzahl;
        }

        /**
         * Der Satz ueber der Liste - "3 Staffeln · 8 Folgen".
         *
         * <p>Die Folgenzahl ist die der <em>gezeigten</em> Staffel und nicht
         * die der ganzen Serie. Das ist keine Nachlaessigkeit, sondern das
         * Einzige, was belegt ist: eine Anbieterseite listet die Folgen einer
         * Staffel, die uebrigen nur als Reiter. Eine Gesamtzahl waere
         * geschaetzt, und geschaetzte Zahlen stehen in ELFIX nicht auf dem
         * Schirm.
         */
        public String kopfzeile() {
            StringBuilder text = new StringBuilder();
            int wieViele = staffeln.size();
            if (wieViele > 0) {
                text.append(wieViele).append(wieViele == 1 ? " Staffel" : " Staffeln");
            }
            int folgenZahl = folgen.size();
            if (folgenZahl > 0) {
                if (text.length() > 0) text.append("  ·  ");
                text.append(folgenZahl).append(folgenZahl == 1 ? " Folge" : " Folgen");
                if (wieViele > 1) text.append(" in dieser Staffel");
            }
            return text.toString();
        }
    }

    /** Eine leere Auskunft - der Aufrufer macht dann weiter wie bisher. */
    public static final Bestand LEER =
        new Bestand("", 0, new ArrayList<>(), new ArrayList<>());

    /** Wird gerufen, sobald die Seite gelesen ist. */
    public interface Antwort {
        void fertig(Bestand bestand);
    }

    private final Kern kern;
    private String skript;

    public Serienuebersicht(Kern kern) {
        this.kern = kern;
    }

    /**
     * Die offene Seite auslesen.
     *
     * <p>Der Aufruf kehrt sofort zurueck. Die Antwort kommt im Hauptthread -
     * immer, auch wenn nichts zu holen war.
     */
    public void lesen(WebView ansicht, Antwort antwort) {
        if (ansicht == null || antwort == null) return;
        if (kern == null || !kern.istBereit()) {
            antwort.fertig(LEER);
            return;
        }
        skriptHolen(() -> {
            if (skript == null) {
                antwort.fertig(LEER);
                return;
            }
            ansicht.evaluateJavascript(skript, wert -> antwort.fertig(auswerten(wert)));
        });
    }

    /**
     * Das Skript einmal aus dem Kern holen.
     *
     * <p>Es ist ein paar Kilobyte gross und aendert sich nie - es bei jeder
     * Serie neu zu holen waere Arbeit fuer nichts.
     */
    private void skriptHolen(Runnable danach) {
        if (skript != null) {
            danach.run();
            return;
        }
        kern.rufe("seitendaten.uebersichtSkript", (wert, fehler) -> {
            if (fehler != null || wert == null) {
                Log.e(TAG, "Uebersichtsskript nicht erhalten: " + fehler);
                danach.run();
                return;
            }
            try {
                // Der Wert kommt als JSON-Text: ein Textliteral in
                // Anfuehrungszeichen. Derselbe Weg wie beim Seitenskript.
                skript = new JSONArray("[" + wert + "]").getString(0);
            } catch (Exception ausnahme) {
                Log.e(TAG, "Uebersichtsskript unlesbar", ausnahme);
            }
            danach.run();
        });
    }

    /** Was die Seite zurueckgegeben hat, in Java-Form. */
    private static Bestand auswerten(String wert) {
        if (wert == null || "null".equals(wert)) return LEER;
        JSONObject roh;
        try {
            roh = new JSONObject(wert);
        } catch (Exception fehler) {
            Log.d(TAG, "Uebersicht unlesbar: " + fehler);
            return LEER;
        }
        List<Staffel> staffeln = new ArrayList<>();
        JSONArray ausStaffeln = roh.optJSONArray("staffeln");
        if (ausStaffeln != null) {
            for (int i = 0; i < ausStaffeln.length(); i += 1) {
                JSONObject eintrag = ausStaffeln.optJSONObject(i);
                if (eintrag == null) continue;
                int nummer = eintrag.optInt("staffel", 0);
                String url = eintrag.optString("url", "");
                if (nummer > 0 && !url.isEmpty()) staffeln.add(new Staffel(nummer, url));
            }
        }
        List<Folge> folgen = new ArrayList<>();
        JSONArray ausFolgen = roh.optJSONArray("folgen");
        if (ausFolgen != null) {
            for (int i = 0; i < ausFolgen.length(); i += 1) {
                JSONObject eintrag = ausFolgen.optJSONObject(i);
                if (eintrag == null) continue;
                int nummer = eintrag.optInt("folge", 0);
                String url = eintrag.optString("url", "");
                if (nummer <= 0 || url.isEmpty()) continue;
                folgen.add(new Folge(eintrag.optInt("staffel", 1), nummer, url,
                    eintrag.optBoolean("gesperrt", false)));
            }
        }
        return new Bestand(roh.optString("titel", ""), roh.optInt("offeneStaffel", 0),
            staffeln, folgen);
    }
}
