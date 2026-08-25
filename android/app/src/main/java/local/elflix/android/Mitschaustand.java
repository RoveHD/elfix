package local.elflix.android;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;

/**
 * Was auf einer Kachel von "Gemeinsam weiterschauen" steht.
 *
 * <p>Am Rechner traegt jede Kachel einer Runde eine Zeile darueber, wer gerade
 * schaut - und ihr Balken zeigt nicht den eigenen Stand von vorhin, sondern
 * den des Fuehrenden, jetzt. Auf dem Telefon stand dort dieselbe Kachel wie
 * bei einem Titel, den man allein schaut: ein Balken von der letzten eigenen
 * Messung und sonst nichts. Man sah der Startseite nicht an, dass ueberhaupt
 * jemand mitschaut.
 *
 * <p>Gerechnet wird hier dasselbe wie in {@code renderer.js}
 * ({@code frischeMitglieder}, {@code liveKartenText},
 * {@code aktualisiereLiveKarten}) - und aus demselben Grund noch einmal in
 * Java wie bei {@link Favorite#stehtInWeiterschauen()}: eine Bildlaufliste
 * kann beim Zeichnen nicht auf eine Antwort aus dem Kern warten. Der Test
 * daneben haelt beide Fassungen zusammen.
 *
 * <p>Nachgerechnet wird nur die Zeit seit dem Empfang. Das Alter einer
 * Meldung kommt vom Relay und bleibt, wie es kam: sonst mischten sich zwei
 * Uhren, und jede Abweichung zwischen Geraet und Relay stuende in der
 * Anzeige.
 */
public final class Mitschaustand {
    private Mitschaustand() {
    }

    /**
     * Wie alt eine Meldung hoechstens sein darf, damit sie noch zaehlt.
     *
     * <p>Dieselben zwanzig Sekunden wie am Rechner. Wer schaut, meldet alle
     * paar Sekunden; bleibt das aus, ist er weg, und die Zeile muss
     * verschwinden statt stehenzubleiben.
     */
    public static final double FRISCH_S = 20;

    /**
     * Wie lange der Hinweis "X schaut gerade" nach einer Meldung noch gilt.
     *
     * <p>Dieselben fuenfundzwanzig Sekunden wie am Rechner. Er ist der
     * Rueckfall, wenn keine Standmeldung vorliegt - etwa weil das Geraet
     * gerade erst gestartet ist und nur den letzten geteilten Fortschritt
     * kennt.
     */
    public static final long HINWEIS_MS = 25000;

    /** Die Marken, unter denen der Sekundentakt die Teile einer Kachel wiederfindet. */
    public static final String MARKE_LIVE = "kachel:live";
    public static final String MARKE_STAND = "kachel:stand";
    public static final String MARKE_BALKEN = "kachel:balken";

    /**
     * Titel und Runde als eine Kennung - dieselbe Bildung wie am Rechner.
     *
     * <p>Der Raum gehoert dazu: denselben Titel kann es in zwei Raeumen geben,
     * und dann sind es zwei Kacheln mit zwei Staenden.
     */
    public static String schluessel(String key, String raum) {
        return (key == null ? "" : key) + "|" + (raum == null ? "" : raum);
    }

    /**
     * Ein Titel auf seine Buchstaben und Ziffern heruntergebrochen.
     *
     * <p>Die Kachel kennt ihren Schluessel in der Runde nicht - sie kennt nur
     * ihren eigenen Titel. Der Stand kommt aber unter dem Schluessel der
     * Runde. Beides trifft sich ueber den Titel, und der steht auf beiden
     * Seiten verschieden geschrieben.
     */
    public static String normalisierterTitel(String wert) {
        String roh = wert == null ? "" : wert.toLowerCase(Locale.ROOT);
        StringBuilder sauber = new StringBuilder();
        for (int i = 0; i < roh.length(); i += 1) {
            char zeichen = roh.charAt(i);
            if ((zeichen >= 'a' && zeichen <= 'z') || (zeichen >= '0' && zeichen <= '9')) {
                sauber.append(zeichen);
            }
        }
        return sauber.toString();
    }

    /**
     * Wer bei diesem Titel noch meldet.
     *
     * @param sekundenSeitEmpfang wie lange die Meldung schon hier liegt
     */
    public static JSONArray frische(JSONArray mitglieder, double sekundenSeitEmpfang) {
        JSONArray uebrig = new JSONArray();
        if (mitglieder == null) return uebrig;
        for (int i = 0; i < mitglieder.length(); i += 1) {
            JSONObject person = mitglieder.optJSONObject(i);
            if (person == null) continue;
            if (person.optDouble("age", 0) + sekundenSeitEmpfang <= FRISCH_S) uebrig.put(person);
        }
        return uebrig;
    }

    /**
     * Was gerade in einer Runde passiert, in Worte gefasst.
     *
     * <p>Das eigene Geraet bleibt aussen vor - man weiss selbst, was man tut.
     * Laeuft jemand, zaehlt das; erst wenn niemand laeuft, steht da, wer
     * pausiert.
     *
     * @return leer, wenn ausser einem selbst niemand meldet
     */
    public static String liveText(JSONArray frische) {
        StringBuilder laufend = new StringBuilder();
        int laufendZahl = 0;
        StringBuilder stehend = new StringBuilder();
        int stehendZahl = 0;
        if (frische != null) {
            for (int i = 0; i < frische.length(); i += 1) {
                JSONObject person = frische.optJSONObject(i);
                if (person == null || person.optBoolean("me", false)) continue;
                String name = person.optString("name", "Gerät");
                if (person.optBoolean("paused", false)) {
                    if (stehendZahl > 0) stehend.append(", ");
                    stehend.append(name);
                    stehendZahl += 1;
                } else {
                    if (laufendZahl > 0) laufend.append(", ");
                    laufend.append(name);
                    laufendZahl += 1;
                }
            }
        }
        if (laufendZahl > 0) {
            return "▶ " + laufend + " " + (laufendZahl > 1 ? "schauen" : "schaut") + " gerade";
        }
        if (stehendZahl > 0) {
            return "❚❚ " + stehend + " " + (stehendZahl > 1 ? "pausieren" : "pausiert");
        }
        return "";
    }

    /**
     * Der Rueckfall ohne Standmeldung: wer zuletzt einen Fortschritt schickte.
     *
     * @param von     der Name aus dem Eintrag, leer erlaubt
     * @param seit_ms wie lange das her ist
     * @return leer, wenn niemand genannt ist oder es zu lange her ist
     */
    public static String hinweisText(String von, long seit_ms) {
        if (von == null || von.isEmpty()) return "";
        if (seit_ms < 0 || seit_ms >= HINWEIS_MS) return "";
        return "▶ " + von + " schaut gerade";
    }

    /** Die Stelle des Hosts fuehrt die Kachel - sonst die erste Meldung. */
    public static JSONObject fuehrend(JSONArray frische) {
        if (frische == null || frische.length() == 0) return null;
        for (int i = 0; i < frische.length(); i += 1) {
            JSONObject person = frische.optJSONObject(i);
            if (person != null && person.optBoolean("host", false)) return person;
        }
        return frische.optJSONObject(0);
    }

    /**
     * Wo der Fuehrende jetzt steht.
     *
     * <p>Seine gemeldete Stelle plus die Zeit, die seither vergangen ist -
     * aber nur, wenn bei ihm etwas laeuft. Wer angehalten hat, steht still,
     * und ein Balken, der bei einem Pausierten weiterlaeuft, ist eine
     * Erfindung.
     */
    public static double stelle(JSONObject fuehrend, double sekundenSeitEmpfang) {
        if (fuehrend == null) return 0;
        double gemeldet = fuehrend.optDouble("position", 0);
        if (fuehrend.optBoolean("paused", false)) return Math.max(0, gemeldet);
        return Math.max(0, gemeldet + fuehrend.optDouble("age", 0) + sekundenSeitEmpfang);
    }

    /** Sekunden als Uhrzeit - dieselbe Schreibweise wie am Rechner. */
    public static String uhrzeit(double sekunden) {
        long gesamt = Math.max(0, Math.round(sekunden));
        long stunden = gesamt / 3600;
        long minuten = (gesamt % 3600) / 60;
        long rest = gesamt % 60;
        if (stunden > 0) {
            return String.format(Locale.GERMANY, "%d:%02d:%02d", stunden, minuten, rest);
        }
        return String.format(Locale.GERMANY, "%d:%02d", minuten, rest);
    }

    /** "12:04 / 24:10" - oder nur die Stelle, solange die Laufzeit unbekannt ist. */
    public static String standText(double stelle, double dauer) {
        if (dauer > 0) return uhrzeit(stelle) + " / " + uhrzeit(dauer);
        return uhrzeit(stelle);
    }

    /** Der Balkenanteil in Prozent - mindestens einer, damit er ueberhaupt zu sehen ist. */
    public static int prozent(double stelle, double dauer) {
        if (dauer <= 0) return 0;
        long anteil = Math.round(stelle / dauer * 100);
        return (int) Math.max(1, Math.min(100, anteil));
    }
}
