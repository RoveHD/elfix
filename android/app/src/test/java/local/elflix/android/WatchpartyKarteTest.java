package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * Was auf einer Watchparty-Karte steht.
 *
 * <p>Die beiden Zeilen unter dem Titel sind der Teil, an dem sich falsche
 * Angaben zeigen: eine erfundene Staffel ist schlimmer als keine, und ein
 * Host, der keiner mehr ist, ist eine Behauptung. Beides wird hier an
 * Antworten geprueft, wie das Relay sie wirklich schickt.
 *
 * <p>Die Vorrangregel ist dieselbe wie am Rechner: der Stand der Runde geht
 * vor der Angabe am Titel, weil er juenger ist.
 */
public class WatchpartyKarteTest {

    private static JSONObject eintrag(String json) throws Exception {
        return new JSONObject(json);
    }

    /* ------------------------------------------------------ Staffel und Folge */

    @Test
    public void nimmtStaffelUndFolgeAusDerVorberechnetenAngabe() throws Exception {
        // So kommt es aus eintraegeMitAnbieter: die Bruecke hat die
        // Vorrangregel schon angewandt.
        assertEquals("Staffel 3 · Folge 8",
            MainActivity.watchpartyFolgentext(eintrag("{\"staffel\":3,\"folge\":8}")));
    }

    @Test
    public void faelltAufDenStandDerRundeZurueck() throws Exception {
        // Ohne die vorberechneten Felder zaehlt der Stand - und der geht vor
        // der Angabe am Titel, weil er juenger ist.
        assertEquals("Staffel 4 · Folge 2",
            MainActivity.watchpartyFolgentext(eintrag(
                "{\"season\":1,\"episode\":1,\"progress\":{\"season\":4,\"episode\":2}}")));
    }

    @Test
    public void nimmtDieAngabeAmTitelWennDerStandFehlt() throws Exception {
        assertEquals("Staffel 2 · Folge 5",
            MainActivity.watchpartyFolgentext(eintrag("{\"season\":2,\"episode\":5}")));
    }

    /** Ein Film hat keine Folge. Dann steht dort nichts - und nichts Erfundenes. */
    @Test
    public void erfindetNiemalsEineFolge() throws Exception {
        assertEquals("", MainActivity.watchpartyFolgentext(eintrag("{}")));
        assertEquals("", MainActivity.watchpartyFolgentext(eintrag("{\"season\":0,\"episode\":0}")));
        assertEquals("", MainActivity.watchpartyFolgentext(eintrag(
            "{\"title\":\"Ein Film\",\"progress\":{\"position\":42}}")));
        // Eine Staffel ohne Folge sagt fuer sich genommen nichts.
        assertEquals("", MainActivity.watchpartyFolgentext(eintrag("{\"season\":3,\"episode\":0}")));
    }

    /** Manche Anbieter fuehren Folgen ohne Staffel. Dann steht eben nur die Folge da. */
    @Test
    public void zeigtDieFolgeAuchOhneStaffel() throws Exception {
        assertEquals("Folge 12", MainActivity.watchpartyFolgentext(eintrag("{\"folge\":12}")));
    }

    /* ----------------------------------------------------------- Mitglieder */

    @Test
    public void nenntHostUndMitschauende() throws Exception {
        JSONObject item = eintrag("{\"hostId\":\"a\",\"hostName\":\"Elias\",\"myId\":\"b\"}");
        item.put("members", new JSONArray().put("Elias").put("Fernseher"));
        assertEquals("Host: Elias  ·  2 dabei: Elias, Fernseher",
            MainActivity.watchpartyMitgliedertext(item));
    }

    /**
     * Bin ich selbst Host, steht das da - und zwar an der Kennung erkannt.
     *
     * <p>Nicht am Namen: zwei Geraete koennen gleich heissen, und ein
     * Namenstreffer verdeckte, dass man gar nicht dabei ist.
     */
    @Test
    public void erkenntDenEigenenHostStandAnDerKennung() throws Exception {
        JSONObject item = eintrag("{\"hostId\":\"a\",\"hostName\":\"Elias\",\"myId\":\"a\"}");
        item.put("members", new JSONArray().put("Elias"));
        assertTrue(MainActivity.watchpartyMitgliedertext(item).startsWith("du bist Host"));

        // Gleicher Name, andere Kennung: dann bin ich es eben nicht.
        JSONObject fremd = eintrag("{\"hostId\":\"a\",\"hostName\":\"Elias\",\"myId\":\"b\",\"myName\":\"Elias\"}");
        fremd.put("members", new JSONArray().put("Elias"));
        assertTrue(MainActivity.watchpartyMitgliedertext(fremd).startsWith("Host: Elias"));
    }

    /** Ein aelteres Relay schickt keine Kennungen - dann muss der Name herhalten. */
    @Test
    public void faelltOhneKennungAufDenNamenZurueck() throws Exception {
        JSONObject item = eintrag("{\"hostName\":\"Elias\",\"myName\":\"Elias\"}");
        item.put("members", new JSONArray().put("Elias"));
        assertTrue(MainActivity.watchpartyMitgliedertext(item).startsWith("du bist Host"));
    }

    @Test
    public void sagtWennNiemandDabeiIst() throws Exception {
        assertEquals("noch niemand dabei", MainActivity.watchpartyMitgliedertext(eintrag("{}")));
        JSONObject leer = eintrag("{}");
        leer.put("members", new JSONArray());
        assertEquals("noch niemand dabei", MainActivity.watchpartyMitgliedertext(leer));
    }

    /** Ohne Host steht kein Host da - auch das ist eine Angabe, die stimmen muss. */
    @Test
    public void nenntKeinenHostWennEsKeinenGibt() throws Exception {
        JSONObject item = eintrag("{\"myId\":\"b\"}");
        item.put("members", new JSONArray().put("Fernseher"));
        assertEquals("1 dabei: Fernseher", MainActivity.watchpartyMitgliedertext(item));
    }
}
