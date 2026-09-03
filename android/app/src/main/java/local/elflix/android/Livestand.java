package local.elflix.android;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Was im Live-Streifen ueber dem Bild steht.
 *
 * <p>Am Rechner sind das zwei Dinge in der Kopfzeile: die Zeile
 * ({@code watchpartyHostText}) - Live, Raum, wer fuehrt, wer angehalten hat -
 * und die Marken daneben ({@code renderWatchpartyStand}) - je Geraet ein
 * Zeichen, ein Name und eine Uhr. Auf Android gab es beides nirgends: waehrend
 * man schaute, sah man der Oberflaeche nicht an, dass ueberhaupt jemand
 * mitschaut. Der einzige Hinweis stand auf der Watchparty-Seite, also genau
 * dort, wo man beim Schauen nicht ist.
 *
 * <p>Gerechnet wird hier dasselbe wie dort, und aus demselben Grund noch einmal
 * in Java wie bei {@link Mitschaustand}: ein Streifen, der im Sekundentakt
 * nachzieht, kann nicht auf eine Antwort aus dem Kern warten - und auf einem
 * Fernseher faenge der Fokus bei jedem Aufbau von vorn an. Der Test daneben
 * haelt beide Fassungen zusammen.
 *
 * <p>Die Frischegrenze ist ausdruecklich die von {@link Mitschaustand}: es gibt
 * genau eine Antwort darauf, ab wann jemand nicht mehr "schaut gerade". Ein
 * Geraet, das seit einer halben Minute nichts mehr gemeldet hat, verschwindet
 * aus dem Streifen, statt dort fuer immer als laufend zu stehen.
 */
final class Livestand {
    private Livestand() {
    }

    /**
     * Ab wann ein Unterschied auffaellt.
     *
     * <p>Ausdruecklich nur die <em>Anzeige</em>. Es ist keine Korrektur - die
     * faellt erst ueber fuenf Sekunden und erst nach drei Messungen - sondern
     * nur die Marke, an der man sieht, dass jemand hinterherhaengt.
     *
     * <p>Drei Sekunden und nicht zwei: bei zwei wurde die Leiste staendig
     * orange, obwohl nichts zu tun war. Zwischen zwei Playern liegt beim
     * Puffern regelmaessig eine Sekunde, und eine Warnung, die fast immer
     * steht, sagt nichts mehr. Die Messung und die Korrektur darunter bleiben
     * unveraendert - sie brauchen die feineren Werte.
     */
    static final double DRIFT_S = 3;

    /** Ein Teilnehmer, wie ihn der Streifen zeigt. */
    static final class Marke {
        final String id;
        final String name;
        /** Der Name, wie er dasteht - das eigene Geraet heisst "Du". */
        final String anzeige;
        final boolean ich;
        final boolean host;
        final boolean pausiert;
        /** Ob dieses Geraet bei einer ganz anderen Folge steht. */
        final boolean andereFolge;
        /** Die hochgerechnete Stelle in Sekunden. */
        final double sekunde;
        /** Der Abstand zum Fuehrenden - bei einer anderen Folge bedeutungslos. */
        final double abstand;
        final boolean hinterher;
        /** "12:04" - oder "S2E5", wenn jemand woanders steht. */
        final String zeit;

        Marke(String id, String name, boolean ich, boolean host, boolean pausiert,
              boolean andereFolge, double sekunde, double abstand, int staffel, int folge) {
            this.id = id;
            this.name = name;
            this.anzeige = ich ? "Du" : name;
            this.ich = ich;
            this.host = host;
            this.pausiert = pausiert;
            this.andereFolge = andereFolge;
            this.sekunde = sekunde;
            this.abstand = abstand;
            // Ab drei Sekunden, nicht erst darueber: 2,9 bleibt normal, 3,0
            // faellt auf.
            this.hinterher = !andereFolge && !pausiert && abstand >= DRIFT_S;
            this.zeit = andereFolge ? folgeKurz(staffel, folge) : Mitschaustand.uhrzeit(sekunde);
        }

        /** Das Zeichen davor: laeuft oder haelt an. Dieselben wie am Rechner. */
        String zeichen() {
            return pausiert ? "❚❚" : "▶";
        }
    }

    /** "S1E4" statt einer Sekunde, wenn jemand ganz woanders ist. */
    static String folgeKurz(int staffel, int folge) {
        return staffel > 0 ? "S" + staffel + "E" + folge : "F" + folge;
    }

    /**
     * Die Sekunde, bei der ein Geraet jetzt stehen duerfte.
     *
     * <p>Die gemeldete Stelle plus die Zeit, die seither vergangen ist - aber
     * nur, wenn dort nicht angehalten ist. Ein Balken, der bei einem
     * Pausierten weiterlaeuft, ist eine Erfindung. Dieselbe Rechnung wie
     * {@code standSekunde} am Rechner und wie {@link Mitschaustand#stelle}.
     */
    static double sekunde(JSONObject person, double seit) {
        if (person == null) return 0;
        double gelaufen = person.optBoolean("paused", false)
            ? 0 : seit + person.optDouble("age", 0);
        return Math.max(0, person.optDouble("position", 0) + gelaufen);
    }

    /**
     * Wer noch meldet - und wo er steht.
     *
     * @param mitglieder die Liste aus der Standmeldung des Relays
     * @param seit       wie lange die Meldung schon hier liegt, in Sekunden
     * @param staffel    die Staffel, die hier offen steht (0 = unbekannt)
     * @param folge      die Folge, die hier offen steht (0 = unbekannt)
     */
    static List<Marke> marken(JSONArray mitglieder, double seit, int staffel, int folge) {
        List<Marke> liste = new ArrayList<>();
        // Erst durch dieselbe Frischepruefung wie die Kacheln der Startseite.
        // Ohne sie stuende ein Geraet, dessen WLAN weg ist, weiter als
        // "schaut gerade" da - und zwar unbegrenzt lange.
        JSONArray frisch = Mitschaustand.frische(mitglieder, seit);
        if (frisch.length() == 0) return liste;

        JSONObject fuehrend = Mitschaustand.fuehrend(frisch);
        double bezug = sekunde(fuehrend, seit);

        for (int i = 0; i < frisch.length(); i += 1) {
            JSONObject person = frisch.optJSONObject(i);
            if (person == null) continue;
            int seineStaffel = person.optInt("season", 0);
            int seineFolge = person.optInt("episode", 0);
            // Steht jemand bei einer anderen Folge, sagt der Sekundenvergleich
            // nichts. Verglichen wird nur, wenn beide Seiten eine Folge nennen -
            // sonst gaelte jeder Film als "woanders".
            boolean andereFolge = folge > 0 && seineFolge > 0
                && (seineFolge != folge || seineStaffel != staffel);
            double stelle = sekunde(person, seit);
            liste.add(new Marke(
                person.optString("id", ""),
                person.optString("name", "Gerät"),
                person.optBoolean("me", false),
                person.optBoolean("host", false),
                person.optBoolean("paused", false),
                andereFolge,
                stelle,
                Math.abs(stelle - bezug),
                seineStaffel,
                seineFolge));
        }
        return liste;
    }

    /** Steht die Runde? Massgeblich sind die bestaetigten Teilnehmer, nicht ein eigenes Ereignis. */
    static boolean stehtStill(List<Marke> marken) {
        if (marken == null || marken.isEmpty()) return false;
        for (Marke marke : marken) {
            if (!marke.pausiert) return false;
        }
        return true;
    }

    /** Wer den Takt vorgibt - oder leer, wenn hier gerade niemand sonst am Player sitzt. */
    static Marke host(List<Marke> marken) {
        if (marken == null) return null;
        for (Marke marke : marken) {
            if (marke.host) return marke;
        }
        return null;
    }

    /**
     * Die Zeile ueber dem Streifen - wortgleich zu {@code watchpartyHostText}.
     *
     * <p>Die Reihenfolge ist die des Rechners und nicht beliebig: steht die
     * Runde, ist die wichtigste Auskunft, <em>wer</em> sie angehalten hat.
     * Danach erst, wer fuehrt.
     *
     * @param pausiertVon aus {@code pausedBy} der Standmeldung - wer gedrueckt
     *                    hat, nicht wer gerade angehalten dasteht
     * @param raum        nur mitschreiben, wenn es mehr als eine Runde gibt
     */
    static String kopfzeile(List<Marke> marken, String pausiertVon, String raum,
                            boolean verbunden, boolean gleichtAb, double zielStelle) {
        if (!verbunden) return "Verbindung weg …";
        if (gleichtAb) {
            return zielStelle > 0
                ? "Wird abgeglichen auf " + Mitschaustand.uhrzeit(zielStelle) + " …"
                : "Wird abgeglichen …";
        }
        String anhang = raum == null || raum.isEmpty() ? "" : " · " + raum;
        if (pausiertVon != null && !pausiertVon.isEmpty() && stehtStill(marken)) {
            return "Live · Pausiert von " + pausiertVon + anhang;
        }
        Marke host = host(marken);
        if (host != null && host.ich) return "Live · du bist Host" + anhang;
        // Kein Host heisst: in dieser Folge sitzt gerade niemand sonst am
        // Player. Dann wird auch keiner genannt - vorher stand dort ein Name
        // aus der Vergangenheit.
        if (host != null) return "Live · Host: " + host.name + anhang;
        return "Live" + anhang;
    }

    /**
     * Wie lange ein Zwischenruf stehen bleibt.
     *
     * <p>Dieselben sechs Sekunden wie am Rechner. "Elias hat pausiert" ist eine
     * Nachricht und kein Zustand; steht sie zu lange, liest man sie irgendwann
     * als "Elias ist pausiert" - und das kann laengst nicht mehr stimmen.
     */
    static final long ZWISCHENRUF_MS = 6000;

    /**
     * "Live: Elias hat pausiert" - die Tat, die gerade geschehen ist.
     *
     * <p>Sie geht der gewoehnlichen Zeile vor, solange sie frisch ist. Danach
     * faellt die Anzeige auf den bestaetigten Stand zurueck: wer fuehrt, und ob
     * die Runde steht.
     *
     * @param seitMs wie lange diese Tat hier schon bekannt ist
     * @return leer, wenn es nichts zu melden gibt oder es zu lange her ist
     */
    static String zwischenruf(JSONObject letzteAktion, long seitMs) {
        if (letzteAktion == null || seitMs >= ZWISCHENRUF_MS) return "";
        String wer = letzteAktion.optString("name", "");
        String was = letzteAktion.optString("type", "");
        if (wer.isEmpty() || was.isEmpty()) return "";
        String satz = "pause".equals(was) ? "hat pausiert"
            : "play".equals(was) ? "spielt weiter"
            : "navigate".equals(was) ? "hat die Folge gewechselt"
            : "ist gesprungen";
        return "Live: " + wer + " " + satz;
    }

    /**
     * Die zweite Zeile: wer schaut, wer steht - kurz genug fuer einen Streifen.
     *
     * <p>Auf einem Telefon im Quermodus ist neben dem Video wenig Platz. Deshalb
     * nicht die volle Liste, sondern die Zusammenfassung; die Namen stehen im
     * ausgeklappten Zustand.
     */
    static String zusammenfassung(List<Marke> marken) {
        if (marken == null || marken.isEmpty()) return "";
        int laufend = 0;
        int stehend = 0;
        int woanders = 0;
        for (Marke marke : marken) {
            if (marke.andereFolge) woanders += 1;
            else if (marke.pausiert) stehend += 1;
            else laufend += 1;
        }
        StringBuilder text = new StringBuilder();
        text.append(marken.size()).append(marken.size() == 1 ? " Gerät" : " Geräte");
        if (laufend > 0) text.append("  ·  ▶ ").append(laufend);
        if (stehend > 0) text.append("  ·  ❚❚ ").append(stehend);
        if (woanders > 0) text.append("  ·  ").append(woanders).append(" woanders");
        return text.toString();
    }

    /**
     * Die Zeile eines Teilnehmers im ausgeklappten Zustand.
     *
     * <p>"▶ Du · Host · 12:04" oder "❚❚ Wohnzimmer · 11:58 (6 s zurück)".
     */
    static String zeile(Marke marke) {
        if (marke == null) return "";
        StringBuilder text = new StringBuilder();
        text.append(marke.zeichen()).append("  ").append(marke.anzeige);
        if (marke.host) text.append("  ·  Host");
        text.append("  ·  ").append(marke.zeit);
        if (marke.andereFolge) {
            text.append("  (andere Folge)");
        } else if (marke.hinterher) {
            text.append(String.format(Locale.GERMANY, "  (%d s Unterschied)", Math.round(marke.abstand)));
        }
        return text.toString();
    }
}
