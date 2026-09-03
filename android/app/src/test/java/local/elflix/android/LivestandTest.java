package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.List;

/**
 * Was im Live-Streifen ueber dem Bild steht.
 *
 * <p>Geprueft wird an Antworten, wie das Relay sie wirklich schickt, und gegen
 * die Saetze, die der Rechner in {@code renderWatchpartyStand} und
 * {@code watchpartyHostText} bildet. Wichtiger als die Formulierung ist, was
 * <em>nicht</em> dasteht: ein Geraet, das seit einer halben Minute nichts mehr
 * gemeldet hat, eine Uhr, die bei einem Pausierten weiterlaeuft, oder ein Host,
 * der keiner mehr ist.
 *
 * <p>Die Faelle tragen unten ihre Nummern aus der Aufgabe (W9, W10, W12, W13,
 * W14).
 */
public class LivestandTest {

    private static JSONArray leute(String json) throws Exception {
        return new JSONArray(json);
    }

    /* ----------------------------------------------------------- Die Frische */

    @Test
    public void w14_wemDasNetzWegbrichtVerschwindetNachDerFrischegrenze() throws Exception {
        // Anna meldet seit drei Sekunden nichts, Ben seit vierzig. Ben ist weg.
        JSONArray alle = leute("[{\"id\":\"a\",\"name\":\"Anna\",\"age\":3,\"position\":100},"
            + "{\"id\":\"b\",\"name\":\"Ben\",\"age\":40,\"position\":80}]");
        List<Livestand.Marke> marken = Livestand.marken(alle, 0, 0, 0);
        assertEquals(1, marken.size());
        assertEquals("Anna", marken.get(0).name);
    }

    @Test
    public void dieZeitSeitDemEmpfangZaehltMit() throws Exception {
        // Achtzehn Sekunden alt: solange die Meldung frisch hier liegt, zaehlt
        // sie. Fuenf Sekunden spaeter nicht mehr.
        JSONArray alle = leute("[{\"id\":\"a\",\"name\":\"Anna\",\"age\":18}]");
        assertEquals(1, Livestand.marken(alle, 1, 0, 0).size());
        assertEquals(0, Livestand.marken(alle, 5, 0, 0).size());
    }

    /* ------------------------------------------------------------ Die Uhren */

    @Test
    public void beiWemEtwasLaeuftLaeuftAuchDieUhr() throws Exception {
        JSONArray alle = leute("[{\"id\":\"a\",\"name\":\"Anna\",\"age\":2,\"position\":100}]");
        // 100 gemeldet, 2 Sekunden alt, 3 Sekunden hier: 105.
        assertEquals(105.0, Livestand.marken(alle, 3, 0, 0).get(0).sekunde, 0.0001);
    }

    @Test
    public void werAngehaltenHatStehtStill() throws Exception {
        JSONArray alle = leute(
            "[{\"id\":\"a\",\"name\":\"Anna\",\"age\":2,\"position\":100,\"paused\":true}]");
        // Ein Balken, der bei einem Pausierten weiterlaeuft, ist eine Erfindung.
        assertEquals(100.0, Livestand.marken(alle, 8, 0, 0).get(0).sekunde, 0.0001);
        assertEquals("1:40", Livestand.marken(alle, 8, 0, 0).get(0).zeit);
    }

    /* ------------------------------------------------------------- W9 / W10 */

    @Test
    public void w9_zweiSekundenDanebenSindKeinHinweis() throws Exception {
        JSONArray alle = leute("[{\"id\":\"h\",\"name\":\"Host\",\"host\":true,\"position\":100},"
            + "{\"id\":\"g\",\"name\":\"Gast\",\"position\":98}]");
        List<Livestand.Marke> marken = Livestand.marken(alle, 0, 0, 0);
        assertEquals(2, marken.size());
        // Zwei Sekunden sind kein Hinweis mehr: die Marke liegt bei drei.
        assertFalse(marken.get(1).hinterher);
        assertEquals(2.0, marken.get(1).abstand, 0.0001);
    }

    /**
     * Die Schwelle der Warnfarbe - und nur sie.
     *
     * <p>Bei zwei Sekunden stand die Leiste staendig orange, obwohl nichts zu
     * tun war: zwischen zwei Playern liegt beim Puffern regelmaessig eine
     * Sekunde. Jetzt faellt es ab drei auf. Die Messung und die Korrektur
     * darunter bleiben davon unberuehrt - die entscheidet das Relay.
     */
    @Test
    public void w9b_dieWarnfarbeFaelltAbDreiSekunden() throws Exception {
        // 2,9 s - noch normal.
        JSONArray knapp = leute("[{\"id\":\"h\",\"name\":\"Host\",\"host\":true,\"position\":100},"
            + "{\"id\":\"g\",\"name\":\"Gast\",\"position\":97.1}]");
        assertFalse(Livestand.marken(knapp, 0, 0, 0).get(1).hinterher);

        // Genau 3,0 s - die Grenze zaehlt mit.
        JSONArray genau = leute("[{\"id\":\"h\",\"name\":\"Host\",\"host\":true,\"position\":100},"
            + "{\"id\":\"g\",\"name\":\"Gast\",\"position\":97}]");
        assertTrue(Livestand.marken(genau, 0, 0, 0).get(1).hinterher);

        // 3,1 s - erst recht.
        JSONArray darueber = leute("[{\"id\":\"h\",\"name\":\"Host\",\"host\":true,\"position\":100},"
            + "{\"id\":\"g\",\"name\":\"Gast\",\"position\":96.9}]");
        assertTrue(Livestand.marken(darueber, 0, 0, 0).get(1).hinterher);
    }

    @Test
    public void w10_deutlichDanebenWirdAngezeigt() throws Exception {
        JSONArray alle = leute("[{\"id\":\"h\",\"name\":\"Host\",\"host\":true,\"position\":100},"
            + "{\"id\":\"g\",\"name\":\"Gast\",\"position\":92}]");
        List<Livestand.Marke> marken = Livestand.marken(alle, 0, 0, 0);
        assertTrue(marken.get(1).hinterher);
        assertEquals(8.0, marken.get(1).abstand, 0.0001);
        assertTrue(Livestand.zeile(marken.get(1)).contains("8 s Unterschied"));
    }

    @Test
    public void werStehtHaengtNichtHinterher() throws Exception {
        // Eine Pause ist kein Drift. Wer angehalten hat, soll nicht als
        // "hinterher" markiert werden - er ist genau da, wo er sein will.
        JSONArray alle = leute("[{\"id\":\"h\",\"name\":\"Host\",\"host\":true,\"position\":100},"
            + "{\"id\":\"g\",\"name\":\"Gast\",\"position\":80,\"paused\":true}]");
        assertFalse(Livestand.marken(alle, 0, 0, 0).get(1).hinterher);
    }

    /* ------------------------------------------------------ Eine andere Folge */

    @Test
    public void werWoandersStehtZeigtSeineFolgeStattEinerSekunde() throws Exception {
        JSONArray alle = leute(
            "[{\"id\":\"h\",\"name\":\"Host\",\"host\":true,\"position\":100,\"season\":2,\"episode\":5},"
            + "{\"id\":\"g\",\"name\":\"Gast\",\"position\":10,\"season\":2,\"episode\":4}]");
        // Hier offen: Staffel 2, Folge 5.
        List<Livestand.Marke> marken = Livestand.marken(alle, 0, 2, 5);
        assertFalse(marken.get(0).andereFolge);
        assertTrue(marken.get(1).andereFolge);
        assertEquals("S2E4", marken.get(1).zeit);
        // Und der Sekundenvergleich sagt bei einer anderen Folge nichts.
        assertFalse(marken.get(1).hinterher);
        assertTrue(Livestand.zeile(marken.get(1)).contains("andere Folge"));
    }

    @Test
    public void ohneFolgenangabeGiltNiemandAlsWoanders() throws Exception {
        // Ein Film hat keine Folge. Ohne diese Bedingung stuende dort bei allen
        // "andere Folge" - und die Uhren waeren weg.
        JSONArray alle = leute("[{\"id\":\"h\",\"name\":\"Host\",\"host\":true,\"position\":100},"
            + "{\"id\":\"g\",\"name\":\"Gast\",\"position\":99}]");
        for (Livestand.Marke marke : Livestand.marken(alle, 0, 0, 0)) {
            assertFalse(marke.andereFolge);
        }
    }

    /* --------------------------------------------------------------- W12/W13 */

    @Test
    public void w13_dreiPersonenStehenAlleImStreifen() throws Exception {
        JSONArray alle = leute("[{\"id\":\"a\",\"name\":\"Rechner\",\"host\":true,\"position\":120},"
            + "{\"id\":\"b\",\"name\":\"Handy\",\"position\":119,\"me\":true},"
            + "{\"id\":\"c\",\"name\":\"Fernseher\",\"position\":118,\"paused\":true}]");
        List<Livestand.Marke> marken = Livestand.marken(alle, 0, 0, 0);
        assertEquals(3, marken.size());
        // Das eigene Geraet heisst "Du" - man weiss selbst, wie man heisst.
        assertEquals("Du", marken.get(1).anzeige);
        assertEquals("Rechner", marken.get(0).anzeige);
        assertTrue(marken.get(0).host);
        assertEquals("▶", marken.get(0).zeichen());
        assertEquals("❚❚", marken.get(2).zeichen());
        assertEquals("3 Geräte  ·  ▶ 2  ·  ❚❚ 1", Livestand.zusammenfassung(marken));
    }

    @Test
    public void w12_pausiertVonStehtInDerKopfzeile() throws Exception {
        // Alle stehen: dann ist die wichtigste Auskunft, wer angehalten hat.
        JSONArray alle = leute("[{\"id\":\"a\",\"name\":\"Rechner\",\"host\":true,\"position\":120,\"paused\":true},"
            + "{\"id\":\"b\",\"name\":\"Handy\",\"position\":120,\"me\":true,\"paused\":true}]");
        List<Livestand.Marke> marken = Livestand.marken(alle, 0, 0, 0);
        assertTrue(Livestand.stehtStill(marken));
        assertEquals("Live · Pausiert von Rechner",
            Livestand.kopfzeile(marken, "Rechner", "", true, false, 0));
    }

    @Test
    public void solangeJemandLaeuftStehtDerHostInDerKopfzeile() throws Exception {
        JSONArray alle = leute("[{\"id\":\"a\",\"name\":\"Rechner\",\"host\":true,\"position\":120},"
            + "{\"id\":\"b\",\"name\":\"Handy\",\"position\":120,\"me\":true,\"paused\":true}]");
        List<Livestand.Marke> marken = Livestand.marken(alle, 0, 0, 0);
        assertFalse(Livestand.stehtStill(marken));
        // pausedBy ist gesetzt, aber die Runde steht nicht - dann gilt der Host.
        assertEquals("Live · Host: Rechner",
            Livestand.kopfzeile(marken, "Handy", "", true, false, 0));
    }

    @Test
    public void werSelbstHostIstLiestDasAuchSo() throws Exception {
        JSONArray alle = leute("[{\"id\":\"b\",\"name\":\"Handy\",\"host\":true,\"me\":true,\"position\":10}]");
        List<Livestand.Marke> marken = Livestand.marken(alle, 0, 0, 0);
        assertEquals("Live · du bist Host", Livestand.kopfzeile(marken, "", "", true, false, 0));
    }

    @Test
    public void ohneHostWirdKeinerGenannt() throws Exception {
        // Kein Host heisst: in dieser Folge sitzt gerade niemand sonst am
        // Player. Ein Name aus der Vergangenheit waere eine Behauptung.
        JSONArray alle = leute("[{\"id\":\"b\",\"name\":\"Handy\",\"me\":true,\"position\":10}]");
        List<Livestand.Marke> marken = Livestand.marken(alle, 0, 0, 0);
        assertNull(Livestand.host(marken));
        assertEquals("Live", Livestand.kopfzeile(marken, "", "", true, false, 0));
    }

    @Test
    public void derRaumStehtNurDabeiWennErUebergebenWird() throws Exception {
        JSONArray alle = leute("[{\"id\":\"a\",\"name\":\"Rechner\",\"host\":true,\"position\":10}]");
        List<Livestand.Marke> marken = Livestand.marken(alle, 0, 0, 0);
        assertEquals("Live · Host: Rechner · wohnzimmer",
            Livestand.kopfzeile(marken, "", "wohnzimmer", true, false, 0));
    }

    /* ----------------------------------------------------- Der Zwischenruf */

    @Test
    public void eineGeradeGescheheneTatStehtVorn() throws Exception {
        JSONObject pause = new JSONObject();
        pause.put("type", "pause");
        pause.put("name", "Elias");
        assertEquals("Live: Elias hat pausiert", Livestand.zwischenruf(pause, 500));

        JSONObject play = new JSONObject();
        play.put("type", "play");
        play.put("name", "Wohnzimmer");
        assertEquals("Live: Wohnzimmer spielt weiter", Livestand.zwischenruf(play, 0));

        JSONObject sprung = new JSONObject();
        sprung.put("type", "seek");
        sprung.put("name", "Handy");
        assertEquals("Live: Handy ist gesprungen", Livestand.zwischenruf(sprung, 5999));

        JSONObject wechsel = new JSONObject();
        wechsel.put("type", "navigate");
        wechsel.put("name", "Fernseher");
        assertEquals("Live: Fernseher hat die Folge gewechselt", Livestand.zwischenruf(wechsel, 100));
    }

    @Test
    public void nachSechsSekundenIstErWiederWeg() throws Exception {
        // Ein Zwischenruf ist eine Nachricht und kein Zustand. Bliebe er
        // stehen, laese man ihn als "Elias ist pausiert" - und das kann laengst
        // nicht mehr stimmen.
        JSONObject pause = new JSONObject();
        pause.put("type", "pause");
        pause.put("name", "Elias");
        assertEquals("", Livestand.zwischenruf(pause, 6000));
        assertEquals("", Livestand.zwischenruf(pause, 60000));
        assertEquals("", Livestand.zwischenruf(pause, Long.MAX_VALUE));
    }

    @Test
    public void ohneNamenOderArtGibtEsNichtsZuMelden() throws Exception {
        JSONObject ohneName = new JSONObject();
        ohneName.put("type", "pause");
        JSONObject ohneArt = new JSONObject();
        ohneArt.put("name", "Elias");
        assertEquals("", Livestand.zwischenruf(ohneName, 0));
        assertEquals("", Livestand.zwischenruf(ohneArt, 0));
        assertEquals("", Livestand.zwischenruf(null, 0));
    }

    /* --------------------------------------------------- Verbindung und Sync */

    @Test
    public void ohneVerbindungStehtNurDas() throws Exception {
        JSONArray alle = leute("[{\"id\":\"a\",\"name\":\"Rechner\",\"host\":true,\"position\":10}]");
        List<Livestand.Marke> marken = Livestand.marken(alle, 0, 0, 0);
        assertEquals("Verbindung weg …", Livestand.kopfzeile(marken, "", "raum", false, false, 0));
    }

    @Test
    public void waehrendDesAbgleichsStehtDasZiel() throws Exception {
        assertEquals("Wird abgeglichen auf 12:00 …",
            Livestand.kopfzeile(null, "", "", true, true, 720));
        assertEquals("Wird abgeglichen …", Livestand.kopfzeile(null, "", "", true, true, 0));
    }

    /* -------------------------------------------------------- Der Sonderfall */

    @Test
    public void ohneMitgliederGibtEsNichtsZuZeigen() throws Exception {
        assertEquals(0, Livestand.marken(null, 0, 0, 0).size());
        assertEquals(0, Livestand.marken(new JSONArray(), 0, 0, 0).size());
        assertEquals("", Livestand.zusammenfassung(Livestand.marken(null, 0, 0, 0)));
        assertFalse(Livestand.stehtStill(Livestand.marken(null, 0, 0, 0)));
        assertEquals("", Livestand.zeile(null));
    }

    @Test
    public void derFuehrendeIstDerBezugspunkt() throws Exception {
        // Ohne Host der erste - sonst haette der Abstand keinen Bezug.
        JSONArray ohneHost = leute("[{\"id\":\"a\",\"name\":\"Eins\",\"position\":100},"
            + "{\"id\":\"b\",\"name\":\"Zwei\",\"position\":90}]");
        List<Livestand.Marke> marken = Livestand.marken(ohneHost, 0, 0, 0);
        assertEquals(0.0, marken.get(0).abstand, 0.0001);
        assertEquals(10.0, marken.get(1).abstand, 0.0001);
        assertNotNull(marken.get(0));
    }
}
