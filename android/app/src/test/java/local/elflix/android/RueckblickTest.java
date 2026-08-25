package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

/**
 * Die Zahlen des Rückblicks in Worte.
 *
 * <p>Der Sinn dieser Prüfungen ist derselbe wie beim Rückblick selbst: seine
 * Zahlen stehen ein Jahr später noch da, und dann kann sie niemand mehr
 * nachrechnen. Eine falsche Stunde fällt nicht auf, sie steht einfach.
 *
 * <p>Der Schwerpunkt liegt deshalb dort, wo etwas <em>behauptet</em> werden
 * könnte, was nicht gemessen wurde: der Mix muss auf hundert kommen, und der
 * Tageszeit-Typ darf aus fünf Abenden nicht entstehen.
 */
public class RueckblickTest {

    @Test
    public void dauerInWorten() {
        assertEquals("0 min", Rueckblick.dauer(0));
        assertEquals("2 min", Rueckblick.dauer(100));
        assertEquals("1 h", Rueckblick.dauer(3600));
        assertEquals("2 h 16 min", Rueckblick.dauer(8142));
        assertEquals("0 min", Rueckblick.dauer(-50));
    }

    @Test
    public void datumInWorten() {
        assertEquals("24. August 2026", Rueckblick.datum("2026-08-24", true));
        assertEquals("24. August", Rueckblick.datum("2026-08-24T12:00:00.000Z", false));
        assertEquals("", Rueckblick.datum("", true));
        assertEquals("", Rueckblick.datum("2026-08", true));
    }

    @Test
    public void kommazahlenDeutsch() {
        assertEquals("2", Rueckblick.zahl(2.0));
        assertEquals("1,5", Rueckblick.zahl(1.5));
    }

    /**
     * Der Mix summiert sich auf genau hundert.
     *
     * <p>Jeden Anteil einzeln zu runden ergibt Summen wie 101 - auf einer Karte,
     * die "dein Mix" heisst, sieht das schlicht falsch aus. Drei gleich grosse
     * Genres sind der Fall, an dem das auffällt: 33,3 dreimal abgerundet ergibt
     * 99, und der fehlende Punkt muss vergeben werden.
     */
    @Test
    public void derMixSummiertSichAufHundert() throws Exception {
        JSONObject daten = new JSONObject();
        JSONArray genres = new JSONArray();
        for (String name : new String[]{"Action", "Drama", "Komödie"}) {
            genres.put(new JSONObject().put("label", name).put("sekunden", 1000).put("titel", 3));
        }
        daten.put("genres", genres);

        List<String> namen = new ArrayList<>();
        List<int[]> anteile = new ArrayList<>();
        Rueckblick.mix(daten, true, namen, anteile);

        assertEquals(3, namen.size());
        int summe = 0;
        for (int[] wert : anteile) summe += wert[0];
        assertEquals(100, summe);
    }

    @Test
    public void ohneGenresGibtEsKeinenMix() throws Exception {
        List<String> namen = new ArrayList<>();
        List<int[]> anteile = new ArrayList<>();
        Rueckblick.mix(new JSONObject().put("genres", new JSONArray()), true, namen, anteile);
        assertTrue(namen.isEmpty());
    }

    /** Aus fünf Abenden folgt kein Typ - dieselbe Schwelle wie am Rechner. */
    @Test
    public void derTageszeitTypBrauchtGenugSitzungen() throws Exception {
        JSONObject daten = new JSONObject();
        daten.put("sitzungen", 5);
        daten.put("tageszeiten", new JSONArray()
            .put(new JSONObject().put("fach", "nacht").put("sekunden", 9000)));
        assertNull(Rueckblick.tageszeit(daten, true));
    }

    @Test
    public void undEinenDeutlichenAnteil() throws Exception {
        JSONObject daten = new JSONObject();
        daten.put("sitzungen", 40);
        daten.put("tageszeiten", new JSONArray()
            .put(new JSONObject().put("fach", "nacht").put("sekunden", 300))
            .put(new JSONObject().put("fach", "abend").put("sekunden", 300))
            .put(new JSONObject().put("fach", "morgen").put("sekunden", 300))
            .put(new JSONObject().put("fach", "nachmittag").put("sekunden", 300)));
        // 25 Prozent - unter der Schwelle von 35.
        assertNull(Rueckblick.tageszeit(daten, true));
    }

    @Test
    public void undOhneGemesseneZeitGarNicht() throws Exception {
        JSONObject daten = new JSONObject();
        daten.put("sitzungen", 40);
        daten.put("tageszeiten", new JSONArray()
            .put(new JSONObject().put("fach", "nacht").put("sekunden", 9000)));
        assertNull(Rueckblick.tageszeit(daten, false));
    }

    @Test
    public void einDeutlicherTypStehtDa() throws Exception {
        JSONObject daten = new JSONObject();
        daten.put("sitzungen", 40);
        daten.put("tageszeiten", new JSONArray()
            .put(new JSONObject().put("fach", "nacht").put("sekunden", 9000))
            .put(new JSONObject().put("fach", "abend").put("sekunden", 1000)));
        String[] typ = Rueckblick.tageszeit(daten, true);
        assertEquals("eine", typ[0]);
        assertEquals("Nachteule", typ[1]);
        assertEquals("90", typ[2]);
    }

    /** Der Auftakt richtet sich nach dem, was wirklich dasteht. */
    @Test
    public void derAuftaktPasstZurGroesse() throws Exception {
        assertEquals("Dein 2026, kurz zusammengefasst.",
            Rueckblick.auftakt(new JSONObject().put("folgen", 3).put("tage", 1), 2026));
        assertEquals("Schauen wir uns dein 2026 an.",
            Rueckblick.auftakt(new JSONObject().put("folgen", 60).put("tage", 10), 2026));
        assertEquals("2026 hast du kaum einen Abend ausgelassen.",
            Rueckblick.auftakt(new JSONObject().put("folgen", 900).put("tage", 250), 2026));
    }

    /**
     * Der Zeitraumhinweis nennt, was er weiss.
     *
     * <p>Der wichtigste Satz der ganzen Ansicht: die Messung läuft erst seit
     * einer bestimmten Fassung, und ein Jahresrückblick, der das verschweigt,
     * behauptet über die Monate davor etwas, das er nicht weiss.
     */
    @Test
    public void derZeitraumWirdBenanntUndNichtBehauptet() throws Exception {
        JSONObject daten = new JSONObject();
        daten.put("von", "2026-08-01T10:00:00.000Z");
        daten.put("bis", "2026-08-24T22:00:00.000Z");
        daten.put("sekundenBekannt", 4);
        daten.put("sekundenGesamt", 9);
        String satz = Rueckblick.zeitraumHinweis(daten, 2026);
        assertTrue(satz, satz.contains("1. August"));
        assertTrue(satz, satz.contains("24. August"));
        assertTrue(satz, satz.contains("4 von 9"));
    }

    @Test
    public void ohneSaetzeSagtErDas() throws Exception {
        String satz = Rueckblick.zeitraumHinweis(new JSONObject(), 2026);
        assertTrue(satz, satz.contains("2026"));
    }

    @Test
    public void faktenNurWoDieZahlEindeutigIst() throws Exception {
        JSONObject daten = new JSONObject();
        daten.put("welten", 2);
        daten.put("marathon", 2);
        daten.put("sitzungsschnitt", 100);
        daten.put("folgenJeTag", 1);
        assertTrue(Rueckblick.fakten(daten, true).isEmpty());

        daten.put("welten", 9);
        daten.put("marathon", 5);
        List<String> fakten = Rueckblick.fakten(daten, true);
        assertEquals(2, fakten.size());
        assertTrue(fakten.get(0).contains("9"));
    }

    @Test
    public void monatsnameAusDemSchluessel() {
        assertEquals("August", Rueckblick.monatName("2026-08"));
        assertEquals("", Rueckblick.monatName("2026"));
    }

    @Test
    public void titelZahlenNennenNurGemessenes() throws Exception {
        JSONObject eintrag = new JSONObject().put("folgen", 1).put("sekunden", 0);
        assertEquals("1 Folge", Rueckblick.titelZahlen(eintrag, true));
        eintrag.put("folgen", 4).put("sekunden", 3600);
        assertEquals("4 Folgen  ·  1 h", Rueckblick.titelZahlen(eintrag, true));
        // Ohne gemessene Zeit steht keine Dauer da, auch wenn eine Zahl im Satz
        // stuende - sie waere eine Behauptung.
        assertEquals("4 Folgen", Rueckblick.titelZahlen(eintrag, false));
    }
}
