package local.elflix.android;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Die Ladephasen beim Start einer Folge - so, wie der Rechner sie kennt.
 *
 * <h2>Was hier steht und was nicht</h2>
 *
 * <p>Hier steht <em>keine</em> Tabelle. Namen, Reihenfolge, Beschriftungen,
 * Fristen und Fehlertexte kommen aus {@code src/startphasen.js}, demselben
 * Modul, das der Rechner benutzt; diese Klasse holt sie beim Start einmal ueber
 * den {@link Kern} ab und haelt sie. Wer eine Beschriftung aendern will,
 * aendert sie dort, und beide Geraete sagen danach dasselbe.
 *
 * <p>Gerechnet wird danach hier - und zwar genau zweierlei: ob eine gemeldete
 * Phase weiter ist als die stehende (ein Vergleich zweier Nummern) und ob eine
 * Frist abgelaufen ist (eine Subtraktion). Ein Weg ueber die Bruecke waere
 * dafuer ein Rundlauf pro Balkenschritt, und der Vorhang muss sofort
 * dastehen. Dieselbe Abwaegung wie bei {@code Folgen.prozent}; damit sie nicht
 * auseinanderlaufen kann, ist die Tabelle die geteilte und nur die Mechanik
 * hiesig.
 *
 * <h2>Ohne Kern kein Vorhang</h2>
 *
 * <p>{@link #istBereit()} bleibt {@code false}, solange die Tabelle nicht da
 * ist. Das ist kein Notfall, sondern der ehrliche Zustand: ohne Kern laeuft
 * auch die Startkette selbst nicht (siehe {@code Mitschauen.oertlichenStartAnfordern}),
 * es gibt also nichts zu begleiten. Der Vorhang bleibt dann weg, und der Start
 * verhaelt sich wie vor dieser Aenderung.
 */
final class Startphasen {
    private static final String TAG = CrashReporter.TAG;

    /** Ein Schritt, wie ihn das geteilte Modul beschreibt. */
    static final class Phase {
        final String name;
        final String text;
        /** Wie voll der Balken ist, wenn dieser Schritt beginnt - 0 bis 1. */
        final double anteil;
        /** Die Geduld fuer genau diesen Schritt. 0 heisst: keine Frist. */
        final long fristMs;

        Phase(String name, String text, double anteil, long fristMs) {
            this.name = name;
            this.text = text;
            this.anteil = anteil;
            this.fristMs = fristMs;
        }
    }

    private final Kern kern;
    private final List<Phase> phasen = new ArrayList<>();
    private final Map<String, String> fehlertexte = new HashMap<>();
    private long gesamtFristMs;

    Startphasen(Kern kern) {
        this.kern = kern;
    }

    /**
     * Die Tabelle holen. Einmal, beim Start, sobald der Kern steht.
     *
     * <p>Fehlschlaege sind still bis auf die Protokollzeile: sie bedeuten nur,
     * dass es keinen Vorhang gibt, und ein Hinweis darueber waere eine Meldung
     * ueber etwas, das der Zuschauer nie angefordert hat.
     */
    void vorbereiten() {
        if (kern == null) return;
        kern.wennBereit(() -> kern.rufe("startphasen.modell", (wert, fehler) -> {
            if (fehler != null || wert == null) {
                Log.w(TAG, "Startphasen nicht geladen: " + fehler);
                return;
            }
            try {
                uebernehmen(new JSONObject(wert));
            } catch (Exception ausnahme) {
                Log.w(TAG, "Startphasen unlesbar", ausnahme);
            }
        }));
    }

    /** Sichtbar fuer die Pruefung: dieselbe Uebernahme, ohne Kern. */
    void uebernehmen(JSONObject modell) {
        if (modell == null) return;
        List<Phase> gelesen = new ArrayList<>();
        JSONArray liste = modell.optJSONArray("phasen");
        for (int i = 0; liste != null && i < liste.length(); i += 1) {
            JSONObject eintrag = liste.optJSONObject(i);
            if (eintrag == null) continue;
            String name = eintrag.optString("name", "");
            if (name.isEmpty()) continue;
            gelesen.add(new Phase(
                name,
                eintrag.optString("text", ""),
                eintrag.optDouble("anteil", 0),
                eintrag.optLong("fristMs", 0)));
        }
        if (gelesen.isEmpty()) return;
        phasen.clear();
        phasen.addAll(gelesen);
        gesamtFristMs = modell.optLong("gesamtFristMs", 0);
        fehlertexte.clear();
        JSONObject texte = modell.optJSONObject("fehlertexte");
        if (texte != null) {
            for (java.util.Iterator<String> it = texte.keys(); it.hasNext(); ) {
                String schluessel = it.next();
                fehlertexte.put(schluessel, texte.optString(schluessel, ""));
            }
        }
        Log.i(TAG, "Startphasen geladen: " + phasen.size() + " Schritte, Deckel "
            + gesamtFristMs + " ms");
    }

    boolean istBereit() {
        return !phasen.isEmpty();
    }

    /** Der Name des ersten Schrittes - damit faengt jeder Start an. */
    String erste() {
        return phasen.isEmpty() ? "" : phasen.get(0).name;
    }

    /** Der Name des letzten Schrittes. Ist er erreicht, ist der Start zu Ende. */
    String letzte() {
        return phasen.isEmpty() ? "" : phasen.get(phasen.size() - 1).name;
    }

    long gesamtFristMs() {
        return gesamtFristMs;
    }

    /** Die Nummer eines Schrittes, oder -1. Nur damit sich Schritte vergleichen lassen. */
    int nummer(String name) {
        for (int i = 0; i < phasen.size(); i += 1) {
            if (phasen.get(i).name.equals(name)) return i;
        }
        return -1;
    }

    Phase phase(String name) {
        int nummer = nummer(name);
        return nummer < 0 ? null : phasen.get(nummer);
    }

    /** Was in diesem Schritt dasteht. */
    String beschriftung(String name) {
        Phase phase = phase(name);
        return phase == null ? "" : phase.text;
    }

    /** Wie voll der Balken in diesem Schritt ist, 0 bis 1. */
    double anteil(String name) {
        Phase phase = phase(name);
        return phase == null ? 0 : phase.anteil;
    }

    /** Was dem Zuschauer gesagt wird, wenn es an dieser Stelle nicht weitergeht. */
    String fehlertext(String grund) {
        String text = fehlertexte.get(grund == null ? "" : grund);
        if (text != null && !text.isEmpty()) return text;
        String allgemein = fehlertexte.get("");
        return allgemein == null ? "" : allgemein;
    }
}
