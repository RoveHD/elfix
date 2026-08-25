package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * Was auf einer Kachel in "Gemeinsam weiterschauen" steht.
 *
 * <p>Geprueft wird an Antworten, wie das Relay sie wirklich schickt, und gegen
 * die Saetze, die der Rechner in {@code liveKartenText} bildet. Wichtiger als
 * die Formulierung ist, was <em>nicht</em> dasteht: das eigene Geraet, eine
 * Meldung von vor einer Minute, oder ein Balken, der bei einem Pausierten
 * weiterlaeuft.
 */
public class MitschaustandTest {

    private static JSONArray leute(String json) throws Exception {
        return new JSONArray(json);
    }

    /* ------------------------------------------------------------- Frische */

    @Test
    public void meldungenAelterAlsZwanzigSekundenZaehlenNichtMehr() throws Exception {
        JSONArray alle = leute("[{\"name\":\"Anna\",\"age\":3},{\"name\":\"Ben\",\"age\":40}]");
        JSONArray frisch = Mitschaustand.frische(alle, 0);
        assertEquals(1, frisch.length());
        assertEquals("Anna", frisch.getJSONObject(0).getString("name"));
    }

    @Test
    public void dieZeitSeitDemEmpfangZaehltMit() throws Exception {
        // Achtzehn Sekunden alt und seit fuenf Sekunden hier: zusammen zu alt.
        JSONArray alle = leute("[{\"name\":\"Anna\",\"age\":18}]");
        assertEquals(1, Mitschaustand.frische(alle, 1).length());
        assertEquals(0, Mitschaustand.frische(alle, 5).length());
    }

    @Test
    public void ohneMitgliederBleibtEsLeer() {
        assertEquals(0, Mitschaustand.frische(null, 0).length());
        assertEquals("", Mitschaustand.liveText(null));
    }

    /* ------------------------------------------------------------ Die Zeile */

    @Test
    public void einerSchaut() throws Exception {
        assertEquals("▶ Anna schaut gerade",
            Mitschaustand.liveText(leute("[{\"name\":\"Anna\",\"paused\":false}]")));
    }

    @Test
    public void mehrereSchauen() throws Exception {
        assertEquals("▶ Anna, Ben schauen gerade",
            Mitschaustand.liveText(leute(
                "[{\"name\":\"Anna\"},{\"name\":\"Ben\"}]")));
    }

    @Test
    public void wennNiemandLaeuftStehtDaWerPausiert() throws Exception {
        assertEquals("❚❚ Anna pausiert",
            Mitschaustand.liveText(leute("[{\"name\":\"Anna\",\"paused\":true}]")));
        assertEquals("❚❚ Anna, Ben pausieren",
            Mitschaustand.liveText(leute(
                "[{\"name\":\"Anna\",\"paused\":true},{\"name\":\"Ben\",\"paused\":true}]")));
    }

    @Test
    public void werLaeuftGehtVorWerPausiert() throws Exception {
        assertEquals("▶ Ben schaut gerade",
            Mitschaustand.liveText(leute(
                "[{\"name\":\"Anna\",\"paused\":true},{\"name\":\"Ben\",\"paused\":false}]")));
    }

    @Test
    public void dasEigeneGeraetStehtNichtInDerZeile() throws Exception {
        // Man weiss selbst, was man tut. Ohne diese Marke stuende auf der
        // eigenen Startseite, dass man selbst gerade schaut.
        assertEquals("",
            Mitschaustand.liveText(leute("[{\"name\":\"Wohnzimmer\",\"me\":true}]")));
        assertEquals("▶ Anna schaut gerade",
            Mitschaustand.liveText(leute(
                "[{\"name\":\"Wohnzimmer\",\"me\":true},{\"name\":\"Anna\"}]")));
    }

    /* ---------------------------------------------------------- Der Balken */

    @Test
    public void derHostFuehrtDieKachel() throws Exception {
        JSONArray frisch = leute(
            "[{\"name\":\"Anna\",\"position\":10},{\"name\":\"Ben\",\"host\":true,\"position\":300}]");
        assertEquals("Ben", Mitschaustand.fuehrend(frisch).getString("name"));
    }

    @Test
    public void ohneHostFuehrtDieErsteMeldung() throws Exception {
        JSONArray frisch = leute("[{\"name\":\"Anna\"},{\"name\":\"Ben\"}]");
        assertEquals("Anna", Mitschaustand.fuehrend(frisch).getString("name"));
        assertNull(Mitschaustand.fuehrend(new JSONArray()));
    }

    @Test
    public void dieStelleLaeuftSeitDerMeldungWeiter() throws Exception {
        JSONObject person = new JSONObject("{\"position\":100,\"age\":2}");
        assertEquals(105, Mitschaustand.stelle(person, 3), 0.001);
    }

    @Test
    public void beiEinemPausiertenLaeuftNichtsWeiter() throws Exception {
        JSONObject person = new JSONObject("{\"position\":100,\"age\":2,\"paused\":true}");
        assertEquals(100, Mitschaustand.stelle(person, 30), 0.001);
    }

    @Test
    public void derBalkenBleibtInSeinenGrenzen() {
        assertEquals(0, Mitschaustand.prozent(50, 0));
        assertEquals(1, Mitschaustand.prozent(0, 1400));
        assertEquals(50, Mitschaustand.prozent(700, 1400));
        assertEquals(100, Mitschaustand.prozent(9999, 1400));
    }

    /* ------------------------------------------------------ Schrift und Zeit */

    @Test
    public void dieStelleStehtWieAmRechner() {
        assertEquals("0:00", Mitschaustand.uhrzeit(0));
        assertEquals("12:04", Mitschaustand.uhrzeit(724));
        assertEquals("1:02:03", Mitschaustand.uhrzeit(3723));
        assertEquals("12:04 / 24:10", Mitschaustand.standText(724, 1450));
        // Ohne Laufzeit nur die Stelle - eine erfundene Gesamtzeit waere
        // schlimmer als gar keine.
        assertEquals("12:04", Mitschaustand.standText(724, 0));
    }

    /* ---------------------------------------------------------- Der Schluessel */

    @Test
    public void schluesselTragenIhrenRaumMit() {
        // Denselben Titel kann es in zwei Raeumen geben - dann sind es zwei
        // Kacheln mit zwei Staenden.
        assertEquals("bleach|ABC", Mitschaustand.schluessel("bleach", "ABC"));
        assertTrue(!Mitschaustand.schluessel("bleach", "ABC")
            .equals(Mitschaustand.schluessel("bleach", "XYZ")));
    }

    @Test
    public void titelTreffenSichUeberBuchstabenUndZiffern() {
        assertEquals(Mitschaustand.normalisierterTitel("Die Legende von Korra"),
            Mitschaustand.normalisierterTitel("die-legende-von-korra"));
        assertEquals(Mitschaustand.normalisierterTitel("BLACK TORCH"),
            Mitschaustand.normalisierterTitel("Black Torch!"));
        assertEquals("bleach2", Mitschaustand.normalisierterTitel("Bleach 2"));
    }

    /* -------------------------------------------------------- Der Rueckfall */

    @Test
    public void ohneStandmeldungZaehltDerLetzteGeteilteFortschritt() {
        assertEquals("▶ Anna schaut gerade", Mitschaustand.hinweisText("Anna", 5000));
        // Nach einer knappen halben Minute ist das kein Beleg mehr.
        assertEquals("", Mitschaustand.hinweisText("Anna", 25000));
        assertEquals("", Mitschaustand.hinweisText("Anna", 60000));
        assertEquals("", Mitschaustand.hinweisText("", 100));
        assertEquals("", Mitschaustand.hinweisText(null, 100));
    }
}
