package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * Die Zusammenfuehrung der Wiedergabesitzungen ueber mehrere eigene Geraete.
 *
 * <p>Der gemeldete Fehler: PC drei Stunden, Handy zwei, Fernseher vier - und
 * jedes Geraet zeigte im Rueckblick nur seine eigene Zahl. Der Abgleich war
 * dafuer laengst gebaut; was fehlte, war die Leitung dorthin. Diese Pruefung
 * haelt die Regel fest, an der die Bilanz haengt.
 *
 * <p>Zwei Fehler waeren dabei gleich schlimm und sehen von aussen verschieden
 * aus: neun Stunden werden zu drei (nichts kommt an) oder zu achtzehn (alles
 * kommt dreimal an). Deshalb wird beides ausdruecklich geprueft, und mit
 * genauen Zahlen statt mit "ungefaehr".
 *
 * <p>Die Faelle tragen unten ihre Nummern aus der Aufgabe (S1 bis S8).
 */
public class SitzungenTest {

    /** Eine abgeschlossene Sitzung, wie sie in sitzungen.json steht. */
    private static JSONObject satz(String id, String tag, double sekunden) throws Exception {
        JSONObject sitzung = new JSONObject();
        sitzung.put("id", id);
        sitzung.put("begonnenAm", tag + "T20:00:00.000Z");
        sitzung.put("beendetAm", tag + "T21:00:00.000Z");
        sitzung.put("sekunden", sekunden);
        sitzung.put("titel", "Attack on Titan");
        sitzung.put("season", 2);
        sitzung.put("episode", 4);
        return sitzung;
    }

    private static JSONArray liste(JSONObject... saetze) {
        JSONArray alle = new JSONArray();
        for (JSONObject satz : saetze) alle.put(satz);
        return alle;
    }

    private static java.util.List<String> ids(JSONArray liste) {
        java.util.List<String> gefunden = new java.util.ArrayList<>();
        for (int i = 0; i < liste.length(); i += 1) {
            gefunden.add(liste.optJSONObject(i).optString("id"));
        }
        return gefunden;
    }

    /* ------------------------------------------------------------- S1 bis S3 */

    @Test
    public void s1_einLeeresGeraetUebernimmtDieSitzungDesAnderen() throws Exception {
        JSONArray android = new JSONArray();
        Sitzungen.Ergebnis ergebnis = Sitzungen.vereinen(android, liste(satz("A", "2026-01-05", 10800)));
        assertEquals(1, ergebnis.dazu);
        assertEquals(1, ergebnis.sitzungen.length());
        assertEquals(10800.0, Sitzungen.sekunden(ergebnis.sitzungen), 0.0001);
    }

    @Test
    public void s2_beideBehaltenIhreEigeneUndBekommenDieAndere() throws Exception {
        JSONArray android = liste(satz("B", "2026-01-06", 7200));
        Sitzungen.Ergebnis ergebnis = Sitzungen.vereinen(android, liste(satz("A", "2026-01-05", 10800)));
        assertEquals(1, ergebnis.dazu);
        assertEquals(java.util.Arrays.asList("B", "A"), ids(ergebnis.sitzungen));
        assertEquals(18000.0, Sitzungen.sekunden(ergebnis.sitzungen), 0.0001);
    }

    @Test
    public void s3_derFernseherLegtSeineDazuUndAlleHabenDreie() throws Exception {
        JSONArray bestand = liste(satz("A", "2026-01-05", 10800), satz("B", "2026-01-06", 7200));
        Sitzungen.Ergebnis ergebnis = Sitzungen.vereinen(bestand, liste(satz("C", "2026-01-07", 14400)));
        assertEquals(1, ergebnis.dazu);
        assertEquals(3, ergebnis.sitzungen.length());
        // Die Zahl aus der Aufgabe: 3 h + 2 h + 4 h = 9 h.
        assertEquals(32400.0, Sitzungen.sekunden(ergebnis.sitzungen), 0.0001);
    }

    /* ------------------------------------------------------------- S4 und S6 */

    @Test
    public void s4_mehrfacherAbgleichAendertNichtsMehr() throws Exception {
        JSONArray bestand = liste(satz("A", "2026-01-05", 10800), satz("B", "2026-01-06", 7200),
            satz("C", "2026-01-07", 14400));
        for (int runde = 0; runde < 5; runde += 1) {
            Sitzungen.Ergebnis ergebnis = Sitzungen.vereinen(bestand,
                liste(satz("A", "2026-01-05", 10800), satz("B", "2026-01-06", 7200),
                    satz("C", "2026-01-07", 14400)));
            assertEquals("Runde " + runde, 0, ergebnis.dazu);
            bestand = ergebnis.sitzungen;
        }
        assertEquals(3, bestand.length());
        assertEquals(32400.0, Sitzungen.sekunden(bestand), 0.0001);
    }

    @Test
    public void s6_dieselbeSitzungZweimalEmpfangenZaehltEinmal() throws Exception {
        JSONArray bestand = new JSONArray();
        // Auch innerhalb einer einzigen Lieferung: das Doppel faellt heraus.
        Sitzungen.Ergebnis ergebnis = Sitzungen.vereinen(bestand,
            liste(satz("A", "2026-01-05", 10800), satz("A", "2026-01-05", 10800)));
        assertEquals(1, ergebnis.dazu);
        assertEquals(10800.0, Sitzungen.sekunden(ergebnis.sitzungen), 0.0001);

        // Und ein zweiter Empfang derselben Sitzung ebenso.
        Sitzungen.Ergebnis nochmal = Sitzungen.vereinen(ergebnis.sitzungen,
            liste(satz("A", "2026-01-05", 10800)));
        assertEquals(0, nochmal.dazu);
        assertEquals(10800.0, Sitzungen.sekunden(nochmal.sitzungen), 0.0001);
    }

    /* -------------------------------------------------------------------- S5 */

    @Test
    public void s5_zweiEchteWiedergabenDerselbenFolgeZaehlenBeide() throws Exception {
        // Gleiche Serie, gleiche Staffel, gleiche Folge - aber zwei
        // verschiedene Wiedergabesitzungen auf zwei Geraeten. Sie tragen
        // verschiedene Kennungen, also sind es zwei, und beide Zeiten zaehlen.
        JSONObject amHandy = satz("handy-1", "2026-02-01", 1200);
        JSONObject amFernseher = satz("tv-1", "2026-02-01", 1500);
        Sitzungen.Ergebnis ergebnis = Sitzungen.vereinen(liste(amHandy), liste(amFernseher));
        assertEquals(1, ergebnis.dazu);
        assertEquals(2700.0, Sitzungen.sekunden(ergebnis.sitzungen), 0.0001);
    }

    /* ------------------------------------------------------- Was nicht zaehlt */

    @Test
    public void ohneKennungOderBeginnZaehltNichts() throws Exception {
        JSONObject ohneId = satz("", "2026-01-05", 900);
        JSONObject ohneBeginn = new JSONObject();
        ohneBeginn.put("id", "X");
        ohneBeginn.put("sekunden", 900);
        assertFalse(Sitzungen.brauchbar(ohneId));
        assertFalse(Sitzungen.brauchbar(ohneBeginn));
        assertFalse(Sitzungen.brauchbar(null));
        assertTrue(Sitzungen.brauchbar(satz("A", "2026-01-05", 900)));

        Sitzungen.Ergebnis ergebnis = Sitzungen.vereinen(new JSONArray(), liste(ohneId, ohneBeginn));
        assertEquals(0, ergebnis.dazu);
        assertEquals(0, ergebnis.sitzungen.length());
    }

    @Test
    public void einVorhandenerSatzWirdNichtUeberschrieben() throws Exception {
        // Eine abgeschlossene Sitzung ist ein Ereignis: kaeme sie mit einer
        // anderen Dauer zurueck, waere die zweite Angabe eine Behauptung ueber
        // etwas, das laengst vorbei ist. Es bleibt bei der ersten.
        JSONArray bestand = liste(satz("A", "2026-01-05", 10800));
        Sitzungen.Ergebnis ergebnis = Sitzungen.vereinen(bestand, liste(satz("A", "2026-01-05", 60)));
        assertEquals(0, ergebnis.dazu);
        assertEquals(10800.0, Sitzungen.sekunden(ergebnis.sitzungen), 0.0001);
    }

    @Test
    public void dieBestehendeListeWirdAnOrtUndStelleErweitert() throws Exception {
        // Statistik.java haelt genau diese Liste im Speicher. Eine Abschrift
        // waere ein zweiter Stand, und der Rueckblick rechnete mit dem alten.
        JSONArray bestand = liste(satz("A", "2026-01-05", 10800));
        Sitzungen.Ergebnis ergebnis = Sitzungen.vereinen(bestand, liste(satz("B", "2026-01-06", 7200)));
        assertTrue(bestand == ergebnis.sitzungen);
        assertEquals(2, bestand.length());
    }
}
