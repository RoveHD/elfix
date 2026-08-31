package local.elflix.android;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

/**
 * Ein Raum-Eintrag, den die Runde hinter sich hat.
 *
 * <p>Gemeldet war zweierlei: Watchparty-Räume verschwanden nach dreißig Tagen
 * von selbst, und die Titel darin verschwanden nie. Ein zu Ende geschauter
 * Film stand dauerhaft unter „Gemeinsam weiterschauen“, und eine Serie, deren
 * letzte verfügbare Folge alle gesehen hatten, ebenso.
 *
 * <p>Die Antwort darauf ist ein Merker am Eintrag: {@code watchpartyArchived}.
 * Er kommt aus dem Raumzustand und wird hier nur gelesen - gesetzt wird er in
 * der geteilten Regel ({@code fortschritt.watchpartyArchivAbgleichen}), damit
 * Telefon und Rechner nicht zwei Meinungen darüber haben.
 *
 * <p>Was hier geprüft wird, ist die eine Stelle, an der Android die Regel
 * trotzdem noch einmal in Java führen muss: {@link Favorite#stehtInWeiterschauen()}.
 * Eine Bildlaufliste kann beim Zeichnen nicht auf eine Antwort aus dem Kern
 * warten - deshalb steht die Bedingung dort ein zweites Mal, und deshalb hält
 * dieser Test sie mit {@code hasContinueProgressRecord} in
 * {@code src/fortschritt.js} und {@code continueEntries} in
 * {@code renderer.js} zusammen. Die Fälle sind wortgleich die aus
 * {@code tests/raumarchivtest.js}.
 */
public class RaumArchivTest {

    /** Ein offener Raum-Eintrag: Folge 4 von acht, halb geschaut. */
    private static JSONObject offen() throws Exception {
        JSONObject roh = new JSONObject();
        roh.put("title", "Black Torch");
        roh.put("url", "https://aniworld.to/anime/stream/black-torch/staffel-1/episode-4");
        roh.put("type", "serie");
        roh.put("season", 1);
        roh.put("episode", 4);
        roh.put("watchpartyRoom", "bangus");
        roh.put("continuePending", true);
        roh.put("duration", 1400);
        roh.put("currentTime", 700);
        roh.put("progress", 50);
        roh.put("lastWatchedAt", "2026-08-30T10:00:00.000Z");
        return roh;
    }

    @Test
    public void einOffenerRaumEintragStehtInWeiterschauen() throws Exception {
        assertTrue(new Favorite(offen()).stehtInWeiterschauen());
    }

    /**
     * Der eigentliche Fall: Schwarz auf weiß derselbe Eintrag, nur archiviert.
     *
     * <p>Nichts sonst hat sich geändert - der Fortschritt steht, der Verlauf
     * steht, in der Mediathek steht er weiter. Er ist nur aus der Reihe
     * heraus, und genau das war verlangt.
     */
    @Test
    public void archiviertFaelltErHeraus() throws Exception {
        JSONObject roh = offen();
        roh.put("watchpartyArchived", true);
        Favorite eintrag = new Favorite(roh);
        assertTrue("Der Merker muss lesbar sein", eintrag.istArchiviert());
        assertFalse(eintrag.stehtInWeiterschauen());
    }

    /**
     * Ein Film, den die Runde zu Ende geschaut hat.
     *
     * <p>Er kommt über den Raumzustand als archiviert herein - auch auf einem
     * Gerät, das beim Abschluss aus war. Genau das ist der Fall aus der
     * Meldung: „Film wird auf PC abgeschlossen, Handy startet später“.
     */
    @Test
    public void einAbgeschlossenerFilmStehtNichtMehrDa() throws Exception {
        JSONObject roh = new JSONObject();
        roh.put("title", "Spider-Man");
        roh.put("url", "https://filmo.to/movies/spider-man");
        roh.put("type", "film");
        roh.put("watchpartyRoom", "bangus");
        roh.put("watchpartyArchived", true);
        // Der Stand dieses Geräts ist veraltet - es war beim Abschluss aus.
        roh.put("continuePending", true);
        roh.put("duration", 8000);
        roh.put("currentTime", 900);
        roh.put("progress", 12);
        assertFalse(new Favorite(roh).stehtInWeiterschauen());
    }

    /**
     * Ein Wiederansehen ist die eine Ausnahme zu „abgeschlossen“ - aber keine
     * zu „archiviert“.
     *
     * <p>Sonst käme ein archivierter Titel über den zweiten Durchlauf zurück
     * in die Reihe, ohne dass die Runde etwas davon wüsste.
     */
    @Test
    public void archiviertSchlaegtWiederansehen() throws Exception {
        JSONObject roh = offen();
        roh.put("completed", true);
        roh.put("rewatching", true);
        roh.put("watchpartyArchived", true);
        assertTrue(new Favorite(roh).istWiederansehen());
        assertFalse(new Favorite(roh).stehtInWeiterschauen());
    }

    /**
     * Wird der Titel wieder aktiv, steht er wieder da.
     *
     * <p>Der Samstag, an dem Folge 9 erscheint: derselbe Eintrag, dasselbe
     * Werk, derselbe Raum - nur nicht mehr archiviert und auf die neue Folge
     * gerückt.
     */
    @Test
    public void eineNeueFolgeHoltIhnZurueck() throws Exception {
        JSONObject roh = offen();
        roh.put("watchpartyArchived", false);
        roh.put("url", "https://aniworld.to/anime/stream/black-torch/staffel-1/episode-9");
        roh.put("episode", 9);
        roh.put("episodeCompleted", false);
        roh.put("continuePending", true);
        roh.put("currentTime", 0);
        roh.put("progress", 0);
        Favorite eintrag = new Favorite(roh);
        assertFalse(eintrag.istArchiviert());
        assertTrue(eintrag.stehtInWeiterschauen());
    }

    /**
     * Ein privater Eintrag trägt den Merker nie - er gehört keinem Raum.
     *
     * <p>Die Trennung ist der Kern der Sache: privater Fortschritt ist nicht
     * Watchparty-Raumfortschritt. Ein archivierter Raum-Eintrag darf den
     * eigenen Stand desselben Werks nicht mitnehmen.
     */
    @Test
    public void derPrivateEintragBleibtUnberuehrt() throws Exception {
        JSONObject roh = offen();
        roh.put("watchpartyRoom", "");
        Favorite privat = new Favorite(roh);
        assertFalse(privat.istArchiviert());
        assertTrue(privat.stehtInWeiterschauen());
    }

    /**
     * Und die Mediathek behält ihn.
     *
     * <p>„Archiviert“ heißt nicht „gelöscht“. Was jemand gesehen hat, gehört
     * ihm und nicht dem Raum - {@link Bestand#mediathek()} fragt allein nach
     * {@code completed} und nicht nach diesem Merker.
     */
    @Test
    public void archiviertHeisstNichtGeloescht() throws Exception {
        JSONObject roh = offen();
        roh.put("completed", true);
        roh.put("watchpartyArchived", true);
        Favorite eintrag = new Favorite(roh);
        assertTrue("gehoert weiter in die Mediathek", eintrag.istAbgeschlossen());
        assertFalse(eintrag.stehtInWeiterschauen());
    }
}
