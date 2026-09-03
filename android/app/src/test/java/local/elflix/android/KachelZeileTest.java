package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

/**
 * Was unter dem Titel einer Kachel steht - ohne Ansicht.
 *
 * <p>Anlass ist die Zeile auf dem Telefon. Dort stand
 *
 * <pre>
 *   One Piece
 *   Nächste Folge: Staffel 23
 *   Folge 16 · ⇄ Bangus
 * </pre>
 *
 * <p>Die vierzehn Zeichen "Nächste Folge:" kosteten die halbe Zeile: sie
 * schoben Staffel, Folge und Raum in den Umbruch, und bei einem langen Titel
 * blieb vom Raum nichts uebrig. Welche Folge gemeint ist, sagt die Kachel
 * ohnehin - eine andere steht dort nicht.
 *
 * <p>Was sich hier nicht pruefen laesst, ist der Umbruch auf dem Schirm.
 * Dafuer braucht es ein Geraet; die Kachel hat keine feste Hoehe, drei Zeilen
 * fuer den Titel und zwei fuer diese Zeile.
 */
public class KachelZeileTest {

    private static Favorite eintrag(String json) throws Exception {
        return new Favorite(new JSONObject(json));
    }

    @Test
    public void dieZeileNenntStaffelUndFolgeOhneVorspann() throws Exception {
        Favorite serie = eintrag("{\"type\":\"serie\",\"season\":23,\"episode\":16,"
            + "\"url\":\"https://aniworld.to/anime/stream/one-piece/staffel-23/episode-16\"}");
        assertEquals("Staffel 23 Folge 16", MainActivity.kachelUnterzeile(serie));
    }

    @Test
    public void mitRundeKommtDerRaumDazu() throws Exception {
        Favorite serie = eintrag("{\"type\":\"serie\",\"season\":23,\"episode\":16,"
            + "\"watchpartyRoom\":\"Bangus\","
            + "\"url\":\"https://aniworld.to/anime/stream/one-piece/staffel-23/episode-16\"}");
        String zeile = MainActivity.kachelUnterzeile(serie);
        assertEquals("Staffel 23 Folge 16 · ⇄ Bangus", zeile);
        assertFalse("kein Vorspann mehr", zeile.contains("Nächste Folge"));
    }

    @Test
    public void auchEinLangerRaumnameBleibtInDerZeile() throws Exception {
        Favorite serie = eintrag("{\"type\":\"serie\",\"season\":4,\"episode\":13,"
            + "\"watchpartyRoom\":\"Wohnzimmer Freitagabend\","
            + "\"url\":\"https://aniworld.to/anime/stream/korra/staffel-4/episode-13\"}");
        String zeile = MainActivity.kachelUnterzeile(serie);
        assertTrue(zeile, zeile.contains("Wohnzimmer Freitagabend"));
        assertTrue(zeile, zeile.startsWith("Staffel 4 Folge 13"));
    }

    @Test
    public void einFilmNenntSichFilm() throws Exception {
        Favorite film = eintrag("{\"type\":\"film\",\"url\":\"https://filmo.to/movies/argo\"}");
        assertEquals("Film", MainActivity.kachelUnterzeile(film));
    }

    @Test
    public void einAbgeschlossenerTitelSagtDasWeiterhin() throws Exception {
        // Abgeschlossen heisst: durch. Das ist keine Folgenangabe und bleibt.
        Favorite fertig = eintrag("{\"type\":\"serie\",\"season\":1,\"episode\":8,"
            + "\"completed\":true,\"watched\":true,"
            + "\"url\":\"https://aniworld.to/anime/stream/x/staffel-1/episode-8\"}");
        String zeile = MainActivity.kachelUnterzeile(fertig);
        assertFalse("kein Vorspann", zeile.contains("Nächste Folge"));
    }

    /**
     * Eine Kachel gehoert genau einem Takt.
     *
     * <p>Gemeldet als "bei der APK resettet sich der Fortschrittsbalken auch
     * immer kurz auf 0". Ursache waren zwei Takte auf derselben Ansicht: der
     * Rundentakt schrieb die Stelle der Runde hinein, der Fortschrittstakt
     * gleich darauf wieder eine Null - der Eintrag wartet ja auf die naechste
     * Folge und hat selbst keinen Stand.
     */
    @Test
    public void eineKachelGehoertGenauEinemTakt() {
        // Weiterschauen ohne Runde: der eigene Fortschritt zieht nach.
        assertTrue(MainActivity.eigenerTaktFuerKachel(true, false));
        // Dieselbe Reihe, aber die Kachel gehoert einer Runde: dann nicht.
        assertFalse(MainActivity.eigenerTaktFuerKachel(true, true));
        // Watchlist und Mediathek zeigen keinen Fortschritt - dort ohnehin nie.
        assertFalse(MainActivity.eigenerTaktFuerKachel(false, false));
        assertFalse(MainActivity.eigenerTaktFuerKachel(false, true));
    }

    @Test
    public void einLangerTitelAendertDieZeileNicht() throws Exception {
        // Der gemeldete Fall: "I Parry Everything: What Do You Mean I'm the
        // Strongest?". Der Titel steht darueber - die Zeile bleibt kurz, und
        // genau darum geht es.
        Favorite lang = eintrag("{\"type\":\"serie\",\"season\":1,\"episode\":2,"
            + "\"title\":\"I Parry Everything: What Do You Mean I'm the Strongest?\","
            + "\"watchpartyRoom\":\"Bangus\","
            + "\"url\":\"https://aniworld.to/anime/stream/i-parry-everything/staffel-1/episode-2\"}");
        assertEquals("Staffel 1 Folge 2 · ⇄ Bangus", MainActivity.kachelUnterzeile(lang));
    }
}
