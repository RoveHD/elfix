package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

/**
 * Was Android aus einem gefundenen Nachschub macht.
 *
 * <h2>Was hier geprüft wird - und was nicht</h2>
 *
 * <p>Die Entscheidung „ist nach dem abgeschlossenen Stand eine neue Folge
 * da?" fällt nicht in Java. Sie steht in {@code nachschub.js} im gemeinsamen
 * Kern, wird von Rechner und Telefon aus derselben Datei gefragt, und geprüft
 * wird sie dort, wo sie läuft: in {@code tests/nachschubtest.js}, samt einem
 * Durchgang durch {@code nachschub-bruecke.js} über denselben Lader, den der
 * WebView benutzt.
 *
 * <p>Hier steht der Rest - das, was Java selbst entscheidet, sobald der Kern
 * geantwortet hat: ob ein reaktivierter Titel auf dem Telefon wirklich wieder
 * in „Weiterschauen" auftaucht, ob er in der Reihe „Neue Folgen" landet und
 * ob ein archivierter Watchparty-Titel dabei richtig behandelt wird. Diese
 * Fragen beantwortet {@link Favorite}, und die Antwort steht dort in Java,
 * weil eine Bildlaufliste beim Zeichnen nicht auf den Kern warten kann.
 *
 * <p><b>Warum es das braucht.</b> Vorher konnte Android neue Folgen gar nicht
 * selbst finden: der ganze Vorgang stand in {@code main.js}. „Black Torch"
 * war am Samstag mit Folge 9 da, und am Fernseher blieb der Titel archiviert,
 * bis irgendwann jemand den PC einschaltete. Wer den Fernseher als einziges
 * Gerät benutzt, bekam den Nachschub nie zu sehen.
 */
public class NachschubTest {

    private static final String SERIE = "https://aniworld.to/anime/stream/black-torch";

    private static String folge(int staffel, int nummer) {
        return SERIE + "/staffel-" + staffel + "/episode-" + nummer;
    }

    /** Eine abgeschlossene Serie, wie sie in der Mediathek liegt. */
    private static JSONObject abgeschlossen() throws Exception {
        JSONObject roh = new JSONObject();
        roh.put("id", "bt");
        roh.put("title", "Black Torch");
        roh.put("type", "serie");
        roh.put("url", folge(1, 8));
        roh.put("season", 1);
        roh.put("episode", 8);
        roh.put("finalSeason", 1);
        roh.put("finalEpisode", 8);
        roh.put("completed", true);
        roh.put("completedAt", "2026-08-30T10:00:00.000Z");
        roh.put("progress", 100);
        roh.put("duration", 1400);
        roh.put("currentTime", 1399);
        roh.put("lastWatchedAt", "2026-08-30T10:00:00.000Z");
        return roh;
    }

    /**
     * Was der Kern auf den Eintrag legt, wenn er Nachschub gefunden hat.
     *
     * <p>Wortgleich die Felder aus {@code nachschub.nachschubUrteil} - hier
     * von Hand gesetzt, weil dieser Test kein JavaScript ausführt. Ändert sich
     * die Regel dort, fällt es in {@code nachschubtest.js} auf; hier fällt
     * auf, wenn Java aus demselben Ergebnis etwas anderes macht.
     */
    private static JSONObject reaktiviert(JSONObject roh, int staffel, int nummer) throws Exception {
        roh.put("url", folge(staffel, nummer));
        roh.put("season", staffel);
        roh.put("episode", nummer);
        roh.put("finalSeason", staffel);
        roh.put("finalEpisode", nummer);
        roh.put("completed", false);
        roh.put("completedAt", "");
        roh.put("completedManually", false);
        roh.put("rewatching", false);
        roh.put("episodeCompleted", false);
        roh.put("continuePending", true);
        roh.put("hideFromContinueWatching", false);
        roh.put("progress", 0);
        roh.put("position", 0);
        roh.put("currentTime", 0);
        roh.put("duration", 0);
        roh.put("newEpisodeAt", "2026-09-05T08:00:00.000Z");
        roh.put("newEpisodeLabel", "Folge " + nummer + " ist da");
        return roh;
    }

    /* ---------------------------------------------------------- Privat */

    @Test
    public void eineAbgeschlosseneSerieStehtNichtInWeiterschauen() throws Exception {
        Favorite eintrag = new Favorite(abgeschlossen());
        assertTrue(eintrag.istAbgeschlossen());
        assertFalse(eintrag.stehtInWeiterschauen());
    }

    @Test
    public void nachDemNachschubStehtSieWiederDa() throws Exception {
        JSONObject roh = reaktiviert(abgeschlossen(), 1, 9);
        roh.put("favorite", true);
        Favorite eintrag = new Favorite(roh);
        assertFalse("wieder offen", eintrag.istAbgeschlossen());
        assertTrue("in Weiterschauen", eintrag.stehtInWeiterschauen());
        assertTrue("und wieder vorgemerkt", eintrag.istWatchlist());
        assertEquals(9, eintrag.episode());
    }

    /**
     * Der Hinweis, den die Reihe „Neue Folgen" auf der Startseite zeigt.
     *
     * <p>Die Reihe gibt es auf dem Telefon längst - sie war nur immer leer,
     * weil niemand die beiden Felder je gesetzt hat.
     */
    @Test
    public void derHinweisKommtAnDerOberflaecheAn() throws Exception {
        Favorite eintrag = new Favorite(reaktiviert(abgeschlossen(), 1, 9));
        assertFalse(eintrag.neueFolgeAm().isEmpty());
        assertEquals("Folge 9 ist da", eintrag.neueFolgeText());
    }

    @Test
    public void auchEinStaffelwechselKommtAn() throws Exception {
        JSONObject roh = abgeschlossen();
        roh.put("url", folge(1, 12));
        roh.put("episode", 12);
        roh.put("finalEpisode", 12);
        Favorite eintrag = new Favorite(reaktiviert(roh, 2, 1));
        assertTrue(eintrag.stehtInWeiterschauen());
        assertEquals(2, eintrag.season());
        assertEquals(1, eintrag.episode());
    }

    /* ----------------------------------------------------- Watchparty */

    /**
     * Der Fall aus der Meldung: Raum „Bangus", Black Torch bis Folge 8 durch.
     */
    @Test
    public void einArchivierterRaumtitelStehtNichtInWeiterschauen() throws Exception {
        JSONObject roh = abgeschlossen();
        roh.put("watchpartyRoom", "bangus");
        roh.put("watchpartyArchived", true);
        Favorite eintrag = new Favorite(roh);
        assertTrue(eintrag.istArchiviert());
        assertFalse(eintrag.stehtInWeiterschauen());
    }

    @Test
    public void nachDemNachschubIstDerRaumtitelWiederAktiv() throws Exception {
        JSONObject roh = abgeschlossen();
        roh.put("watchpartyRoom", "bangus");
        roh.put("watchpartyArchived", true);
        reaktiviert(roh, 1, 9);
        // Genau das legt der Kern bei einem Raum-Eintrag zusätzlich auf: das
        // Archiv geht weg, die Merkliste bleibt unberührt.
        roh.put("watchpartyArchived", false);
        Favorite eintrag = new Favorite(roh);
        assertFalse("nicht mehr archiviert", eintrag.istArchiviert());
        assertTrue("wieder in „Gemeinsam weiterschauen“", eintrag.stehtInWeiterschauen());
        assertEquals("und es ist derselbe Raum", "bangus", eintrag.watchpartyRaum());
        assertEquals("und derselbe Eintrag", "bt", eintrag.id());
    }

    /**
     * Die private Watchlist entsteht nie aus einer Runde - auch nicht über
     * den Nachschub.
     */
    @Test
    public void derRaumtitelKommtNichtAufDieMerkliste() throws Exception {
        JSONObject roh = abgeschlossen();
        roh.put("watchpartyRoom", "bangus");
        reaktiviert(roh, 1, 9);
        roh.put("watchpartyArchived", false);
        assertFalse(new Favorite(roh).istWatchlist());
    }

    /**
     * Zwei Räume, derselbe Titel, zwei Stände.
     *
     * <p>Bangus ist durch und wird auf Folge 9 reaktiviert; Familie steht bei
     * Folge 4 und bleibt dort. Sie sind zwei Einträge und keine zwei Sichten
     * auf einen - genau deshalb kann das eine passieren, ohne das andere
     * anzufassen.
     */
    @Test
    public void zweiRaeumeBleibenUnabhaengig() throws Exception {
        JSONObject bangus = abgeschlossen();
        bangus.put("id", "bt-bangus");
        bangus.put("watchpartyRoom", "bangus");
        bangus.put("watchpartyArchived", true);

        JSONObject familie = abgeschlossen();
        familie.put("id", "bt-familie");
        familie.put("watchpartyRoom", "familie");
        familie.put("url", folge(1, 4));
        familie.put("episode", 4);
        familie.put("completed", false);
        familie.put("continuePending", true);
        familie.put("currentTime", 420);
        familie.put("progress", 30);

        reaktiviert(bangus, 1, 9);
        bangus.put("watchpartyArchived", false);

        assertEquals(9, new Favorite(bangus).episode());
        assertEquals("Familie ruehrt sich nicht", 4, new Favorite(familie).episode());
        assertTrue(new Favorite(familie).stehtInWeiterschauen());
        assertEquals(420, (int) new Favorite(familie).currentTime());
    }

    /* ------------------------------------------------ Keine Fehlgriffe */

    /**
     * Ein laufender zweiter Durchlauf darf vom Nachschub nicht angefasst
     * werden - er steht auf einer frühen Folge und sähe für die Prüfung aus
     * wie eine hängengebliebene Serie. Der Kern lässt ihn deshalb gar nicht
     * erst in den Durchgang; hier steht der Zustand, den Java davon sieht.
     */
    @Test
    public void einWiederansehenBleibtEinWiederansehen() throws Exception {
        JSONObject roh = abgeschlossen();
        roh.put("url", folge(1, 2));
        roh.put("episode", 2);
        roh.put("rewatching", true);
        roh.put("currentTime", 300);
        roh.put("progress", 21);
        Favorite eintrag = new Favorite(roh);
        assertTrue(eintrag.istWiederansehen());
        assertTrue("gehoert weiterhin in Weiterschauen", eintrag.stehtInWeiterschauen());
        assertTrue("und weiterhin in die Mediathek", eintrag.istAbgeschlossen());
    }

    /**
     * Ein von Hand abgehakter Titel bleibt abgehakt, solange nichts nachkommt.
     */
    @Test
    public void vonHandAbgehaktBleibtOhneNachschubAbgehakt() throws Exception {
        JSONObject roh = abgeschlossen();
        roh.put("completedManually", true);
        Favorite eintrag = new Favorite(roh);
        assertTrue(eintrag.istVonHandAbgehakt());
        assertFalse(eintrag.stehtInWeiterschauen());
    }

    /**
     * Und wenn doch etwas nachkommt, geht der Merker mit dem Abschluss.
     *
     * <p>„Abgehakt, aber nicht abgeschlossen" ist der Widerspruch, über den
     * Titel früher unrettbar aus der Mediathek verschwanden. Jede Stelle, die
     * {@code completed} löscht, löscht ihn mit.
     */
    @Test
    public void vonHandAbgehaktWirdVonEchtemNachschubGeoeffnet() throws Exception {
        JSONObject roh = abgeschlossen();
        roh.put("completedManually", true);
        Favorite eintrag = new Favorite(reaktiviert(roh, 1, 9));
        assertFalse(eintrag.istAbgeschlossen());
        assertFalse("kein Widerspruch bleibt stehen", eintrag.istVonHandAbgehakt());
        assertTrue(eintrag.stehtInWeiterschauen());
    }

    /**
     * Bleibt der Anbieter bei seiner Auskunft, bleibt alles, wie es war.
     *
     * <p>Der Korra-Fall: das Finale ist gesehen, und es kommt nie etwas nach.
     * Der Titel liegt in der Mediathek, der Raumtitel bleibt archiviert, und
     * niemand bekommt einen Hinweis zu sehen.
     */
    @Test
    public void ohneNachschubAendertSichNichts() throws Exception {
        JSONObject roh = abgeschlossen();
        roh.put("watchpartyRoom", "bangus");
        roh.put("watchpartyArchived", true);
        Favorite eintrag = new Favorite(roh);
        assertTrue(eintrag.istAbgeschlossen());
        assertTrue(eintrag.istArchiviert());
        assertFalse(eintrag.stehtInWeiterschauen());
        assertTrue("kein Hinweis auf der Startseite", eintrag.neueFolgeAm().isEmpty());
    }

    /* ------------------------------------------------------------ Takt */

    /**
     * Die Schlüssel, unter denen der Takt seinen letzten Durchgang ablegt.
     *
     * <p>Sie stehen im Test, weil ein Tippfehler darin lautlos wirkt: der
     * Stempel läge dann unter einem anderen Namen, würde nie wiedergefunden,
     * und bei jedem App-Start liefe ein Durchgang - genau die Dauerabfrage,
     * die vermieden werden soll.
     */
    @Test
    public void derTaktLegtSeinenStempelInDieAppAblage() {
        assertEquals("elflix_settings", Nachschub.ABLAGE);
        assertEquals("nachschub_zuletzt", Nachschub.SCHLUESSEL_ZULETZT);
        assertEquals("dieselbe Ablage wie der Autoplay-Schalter", Folgen.ABLAGE, Nachschub.ABLAGE);
    }
}
