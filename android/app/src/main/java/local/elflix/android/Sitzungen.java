package local.elflix.android;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Zwei Sitzungslisten zu einer machen - die eine Regel, an der eine
 * Jahresbilanz haengt.
 *
 * <p>Eine abgeschlossene Sitzung ist ein <em>Ereignis</em> und kein Zustand.
 * Sie aendert sich nie wieder, und zwei Geraete koennen denselben Satz nicht
 * verschieden wissen. Also gibt es dieselbe Kennung genau einmal, und
 * ueberschrieben wird nichts. Wer das anders macht, bekommt entweder neun
 * Stunden aus drei plus zwei plus vier - oder achtzehn.
 *
 * <p>Dieselbe Regel wie {@code statistik.vereinen} im Kern, und aus demselben
 * Grund noch einmal in Java wie bei {@link Mitschaustand}: der Weg ueber die
 * Bruecke ist asynchron, und eine Sitzung, die von einem anderen Geraet
 * hereinkommt, muss <em>sofort</em> in {@link Statistik#auswerten} auftauchen -
 * ein Rueckblick, der gerade offen steht, darf nicht auf eine Antwort aus dem
 * Kern warten muessen. Der Test daneben haelt beide Fassungen zusammen.
 *
 * <p>Reine Rechnung, kein Android: deshalb laesst sie sich als gewoehnlicher
 * Unit-Test pruefen, ohne Geraet und ohne Emulator.
 */
final class Sitzungen {
    private Sitzungen() {
    }

    /** Das Ergebnis einer Vereinigung: die Liste und was daran neu war. */
    static final class Ergebnis {
        final JSONArray sitzungen;
        final int dazu;

        Ergebnis(JSONArray sitzungen, int dazu) {
            this.sitzungen = sitzungen;
            this.dazu = dazu;
        }
    }

    /**
     * Ob ein Satz ueberhaupt eine Sitzung ist.
     *
     * <p>Dieselben zwei Bedingungen wie in {@code geraete-bruecke.js}: ohne
     * Kennung liesse sich nichts entdoppeln, ohne Beginn nichts einordnen. Ein
     * Satz ohne beides zaehlt nicht, statt eine Bilanz um einen erfundenen
     * Eintrag zu verlaengern.
     */
    static boolean brauchbar(JSONObject sitzung) {
        if (sitzung == null) return false;
        return !sitzung.optString("id", "").isEmpty()
            && !sitzung.optString("begonnenAm", "").isEmpty();
    }

    /**
     * Die Kennungen, die in einer Liste schon stehen.
     *
     * <p>Eigene Funktion, weil {@link Statistik} sie auch fuer sich braucht -
     * und weil eine zweite Schleife an anderer Stelle die naechste Gelegenheit
     * waere, "schon da" verschieden zu beantworten.
     */
    static java.util.HashSet<String> kennungen(JSONArray liste) {
        java.util.HashSet<String> bekannt = new java.util.HashSet<>();
        if (liste == null) return bekannt;
        for (int i = 0; i < liste.length(); i += 1) {
            JSONObject sitzung = liste.optJSONObject(i);
            if (sitzung == null) continue;
            String id = sitzung.optString("id", "");
            if (!id.isEmpty()) bekannt.add(id);
        }
        return bekannt;
    }

    /**
     * Neue Sitzungen an eine bestehende Liste anfuegen.
     *
     * <p>Der Bestand wird an Ort und Stelle erweitert, wenn er uebergeben
     * wurde: {@link Statistik} haelt genau diese Liste im Speicher, und eine
     * Abschrift waere ein zweiter Stand.
     *
     * @return dieselbe Liste und die Zahl der wirklich dazugekommenen Saetze
     */
    static Ergebnis vereinen(JSONArray bestand, JSONArray neue) {
        JSONArray liste = bestand == null ? new JSONArray() : bestand;
        if (neue == null || neue.length() == 0) return new Ergebnis(liste, 0);
        java.util.HashSet<String> bekannt = kennungen(liste);
        int dazu = 0;
        for (int i = 0; i < neue.length(); i += 1) {
            JSONObject sitzung = neue.optJSONObject(i);
            if (!brauchbar(sitzung)) continue;
            // add() sagt selbst, ob die Kennung neu war - damit faellt auch ein
            // Doppel innerhalb derselben Lieferung heraus.
            if (!bekannt.add(sitzung.optString("id", ""))) continue;
            liste.put(sitzung);
            dazu += 1;
        }
        return new Ergebnis(liste, dazu);
    }

    /**
     * Die Summe der gemessenen Sekunden.
     *
     * <p>Nur fuer Pruefungen und Protokollzeilen: die Bilanz selbst rechnet
     * {@code statistik.auswerten} im Kern, damit auf Rechner und Telefon
     * dieselbe Zahl steht.
     */
    static double sekunden(JSONArray liste) {
        double summe = 0;
        if (liste == null) return 0;
        for (int i = 0; i < liste.length(); i += 1) {
            JSONObject sitzung = liste.optJSONObject(i);
            if (sitzung != null) summe += sitzung.optDouble("sekunden", 0);
        }
        return summe;
    }
}
