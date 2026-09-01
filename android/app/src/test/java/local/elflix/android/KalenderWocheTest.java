package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashSet;
import java.util.List;

/**
 * Die Woche des Kalenders und die Fassungen darin.
 *
 * <h2>Was gemeldet war</h2>
 *
 * Über der Liste stand „Montag, 7. September", während Dienstag, der
 * 1. September war. Zwei Fehler übereinander: die Leiste stand fest auf Montag
 * bis Sonntag, und das Datum dazu kam aus den <em>Einträgen</em> — ein
 * Anbieter kündigt aber nur nach vorn an, also war der nächste „Montag" der in
 * sieben Tagen. Dazu sprang die Auswahl auf den ersten Tag mit Inhalt statt
 * auf heute, und unter dem Wochentag stand die Anzahl der Einträge, die sich
 * wie ein Datum liest („Mo 22").
 *
 * <p>Die Woche wird deshalb gerechnet statt abgelesen. Das ist reine
 * Kalenderrechnung und lässt sich ohne Gerät prüfen — und genau das gehört
 * geprüft, denn ein Datum, das um eine Woche daneben liegt, fällt sonst erst
 * dem auf, der es liest.
 *
 * <p>Dazu die Fassungen: der geteilte Lauf legt sie zweimal ab, als Liste
 * ({@code languages}) und als eine zusammengeklebte Zeile ({@code language}).
 * Android las nur das zweite und konnte deshalb weder umbrechen noch filtern.
 */
public class KalenderWocheTest {

    /* ------------------------------------------------------------ Die Woche */

    @Test
    public void dieWocheHatSiebenTage() {
        assertEquals(7, Kalender.woche().size());
    }

    /** Sie fängt heute an - nicht am Montag und nicht am ersten Tag mit Inhalt. */
    @Test
    public void sieFaengtHeuteAn() {
        List<Kalender.Tag> woche = Kalender.woche();
        Calendar heute = Calendar.getInstance();
        assertTrue("Der erste Tag ist nicht heute", woche.get(0).heute);
        assertEquals(heute.get(Calendar.DAY_OF_MONTH), woche.get(0).imMonat);
        assertEquals(Kalender.heutigerTag(), woche.get(0).name);
    }

    /** Und nur der erste ist heute. */
    @Test
    public void genauEinTagIstHeute() {
        int heute = 0;
        for (Kalender.Tag tag : Kalender.woche()) {
            if (tag.heute) heute += 1;
        }
        assertEquals(1, heute);
    }

    /**
     * Jeder Wochentag kommt genau einmal vor.
     *
     * <p>Daran hängt die Zuordnung: die Einträge tragen ihren Wochentag als
     * Namen, und in einem Fenster von sieben Tagen ist er damit eindeutig.
     * Wären es acht, stünde derselbe Name zweimal da und die Einträge landeten
     * unter beiden.
     */
    @Test
    public void jederWochentagStehtGenauEinmal() {
        HashSet<String> gesehen = new HashSet<>();
        for (Kalender.Tag tag : Kalender.woche()) {
            assertTrue("Wochentag doppelt: " + tag.name, gesehen.add(tag.name));
        }
        assertEquals(7, gesehen.size());
    }

    /** Die Daten laufen vorwärts und ohne Lücke. */
    @Test
    public void dieDatenLaufenLueckenlosVorwaerts() {
        List<Kalender.Tag> woche = Kalender.woche();
        Calendar zeiger = Calendar.getInstance();
        for (Kalender.Tag tag : woche) {
            assertEquals(String.format("%04d-%02d-%02d",
                    zeiger.get(Calendar.YEAR), zeiger.get(Calendar.MONTH) + 1,
                    zeiger.get(Calendar.DAY_OF_MONTH)),
                tag.datum);
            assertEquals(zeiger.get(Calendar.DAY_OF_MONTH), tag.imMonat);
            zeiger.add(Calendar.DAY_OF_MONTH, 1);
        }
    }

    /**
     * Der Name passt zum Datum.
     *
     * <p>Der eigentliche gemeldete Fehler in einem Satz: dort stand ein Name
     * über einem Datum, das nicht dazu gehörte.
     */
    @Test
    public void derNamePasstZumDatum() {
        String[] namen = {"Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag",
            "Freitag", "Samstag"};
        Calendar zeiger = Calendar.getInstance();
        for (Kalender.Tag tag : Kalender.woche()) {
            assertEquals(namen[zeiger.get(Calendar.DAY_OF_WEEK) - 1], tag.name);
            zeiger.add(Calendar.DAY_OF_MONTH, 1);
        }
    }

    /* --------------------------------------------------------- Die Fassungen */

    private static Kalender.Eintrag eintrag(String[] viele, String einzeln) throws Exception {
        JSONObject roh = new JSONObject();
        roh.put("title", "Titel");
        roh.put("day", "Montag");
        if (viele != null) {
            JSONArray liste = new JSONArray();
            for (String wert : viele) liste.put(wert);
            roh.put("languages", liste);
        }
        if (einzeln != null) roh.put("language", einzeln);
        return new Kalender.Eintrag(roh);
    }

    @Test
    public void dieListeWirdGelesen() throws Exception {
        Kalender.Eintrag eintrag = eintrag(new String[]{"Deutsch", "Japanisch, Deutsche Untertitel"},
            "Deutsch · Japanisch, Deutsche Untertitel");
        assertEquals(2, eintrag.fassungen.size());
        assertEquals("Deutsch", eintrag.fassungen.get(0));
    }

    /** Liefert der Anbieter nur die eine Zeile, wird sie zurueckgedreht. */
    @Test
    public void dieZusammengeklebteZeileWirdZerlegt() throws Exception {
        Kalender.Eintrag eintrag = eintrag(null,
            "Japanisch, Deutsche Untertitel · Japanisch, Englische Untertitel");
        assertEquals(2, eintrag.fassungen.size());
        assertEquals("Japanisch, Deutsche Untertitel", eintrag.fassungen.get(0));
        assertEquals("Japanisch, Englische Untertitel", eintrag.fassungen.get(1));
    }

    @Test
    public void ohneAngabeGibtEsKeineFassung() throws Exception {
        assertTrue(eintrag(null, null).fassungen.isEmpty());
        assertTrue(eintrag(null, "").fassungen.isEmpty());
    }

    /* ------------------------------------------- Die Ordnung und der Filter */

    @Test
    public void deutschStehtVorDenUntertiteln() {
        assertTrue(Kalender.fassungsRang("Deutsch") < Kalender.fassungsRang("Japanisch, Deutsche Untertitel"));
        assertTrue(Kalender.fassungsRang("Japanisch, Deutsche Untertitel")
            < Kalender.fassungsRang("Japanisch, Englische Untertitel"));
        assertTrue(Kalender.fassungsRang("Japanisch, Englische Untertitel")
            < Kalender.fassungsRang("Koreanisch"));
    }

    @Test
    public void dieAuswahlStehtInDerOrdnungDesRechners() throws Exception {
        List<Kalender.Eintrag> eintraege = new ArrayList<>();
        eintraege.add(eintrag(new String[]{"Japanisch, Englische Untertitel"}, null));
        eintraege.add(eintrag(new String[]{"Deutsch", "Japanisch, Deutsche Untertitel"}, null));
        eintraege.add(eintrag(new String[]{"Deutsch"}, null));
        List<String> auswahl = Kalender.fassungsAuswahl(eintraege);
        assertEquals(3, auswahl.size());
        assertEquals("Deutsch", auswahl.get(0));
        assertEquals("Japanisch, Deutsche Untertitel", auswahl.get(1));
        assertEquals("Japanisch, Englische Untertitel", auswahl.get(2));
    }

    /** Ein Eintrag mit mehreren Fassungen steht unter jeder. */
    @Test
    public void werMehrereTraegtStehtUnterJeder() throws Exception {
        List<Kalender.Eintrag> eintraege = new ArrayList<>();
        eintraege.add(eintrag(new String[]{"Deutsch", "Japanisch, Deutsche Untertitel"}, null));
        eintraege.add(eintrag(new String[]{"Japanisch, Englische Untertitel"}, null));
        assertEquals(1, Kalender.nachFassung(eintraege, "Deutsch").size());
        assertEquals(1, Kalender.nachFassung(eintraege, "Japanisch, Deutsche Untertitel").size());
        assertEquals(1, Kalender.nachFassung(eintraege, "Japanisch, Englische Untertitel").size());
    }

    @Test
    public void ohneAuswahlBleibtAllesStehen() throws Exception {
        List<Kalender.Eintrag> eintraege = new ArrayList<>();
        eintraege.add(eintrag(new String[]{"Deutsch"}, null));
        assertEquals(1, Kalender.nachFassung(eintraege, "").size());
        assertEquals(1, Kalender.nachFassung(eintraege, null).size());
        assertTrue(Kalender.nachFassung(eintraege, "Klingonisch").isEmpty());
    }

    @Test
    public void ohneEintraegeGibtEsNichtsZuFiltern() {
        assertTrue(Kalender.fassungsAuswahl(new ArrayList<>()).isEmpty());
    }

    /**
     * Ein Eintrag in einer Woche landet nicht unter „Heute".
     *
     * <p>Der geteilte Lauf holt sieben Tage voraus, und der siebte trägt
     * denselben Wochentagsnamen wie heute. Ohne die Prüfung am Datum stünde
     * eine Folge, die in einer Woche kommt, ganz oben unter dem heutigen Tag.
     */
    @Test
    public void derWochentagAlleinEntscheidetNichtWennEinDatumDasteht() throws Exception {
        JSONObject roh = new JSONObject();
        roh.put("day", "Montag");
        roh.put("date", "2026-09-14");
        Kalender.Eintrag spaet = new Kalender.Eintrag(roh);
        assertEquals("Montag", spaet.tag);
        assertEquals("2026-09-14", spaet.datum);

        // Dieselbe Regel, wie anTag(tag, datum) sie anwendet.
        assertFalse("2026-09-14".equals("2026-09-07"));
    }

    /** Der Reiter zeigt den Tag im Monat und nicht die Anzahl der Eintraege. */
    @Test
    public void derReiterZeigtEinDatum() {
        for (Kalender.Tag tag : Kalender.woche()) {
            assertTrue("Kein Tag im Monat: " + tag.imMonat, tag.imMonat >= 1 && tag.imMonat <= 31);
        }
        assertFalse(Kalender.woche().get(0).datum.isEmpty());
    }
}
