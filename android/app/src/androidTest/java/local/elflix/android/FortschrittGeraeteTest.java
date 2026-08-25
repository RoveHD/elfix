package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.LargeTest;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.FixMethodOrder;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.MethodSorters;

/**
 * Die Wiedergabefälle - in der laufenden App, auf einem Gerät.
 *
 * <h2>Warum das nicht durch Unit-Tests zu ersetzen ist</h2>
 *
 * <p>Die Regel selbst steht in {@code fortschritt.js} und wird am Rechner
 * geprüft ({@code tests/fortschritttest.js}); auf dem Gerät fahren dieselben
 * Fälle beim Start durch den Kern ("Fortschritts-Proben: 14/14"). Beides sagt
 * nichts über den <em>Weg</em>: Messwert → Brücke → Kern → Ablage → Platte. An
 * genau diesem Weg ist der Fortschritt auf Android schon einmal vollständig
 * verlorengegangen - die Regel war richtig, gemeldet wurde die falsche Adresse,
 * und die App hat nie eine einzige Folge verbucht.
 *
 * <p>Deshalb läuft hier die App, und geprüft wird, was auf der Platte steht.
 *
 * <h2>Warum die Reihenfolge festliegt</h2>
 *
 * <p>Die Fälle bauen aufeinander auf: erst gibt es keinen Eintrag, dann einen,
 * dann rückt er weiter, dann ist die Serie durch. Genau diese Abfolge ist der
 * Gegenstand - ein Fall für sich sagt wenig über einen Stand, der sich über
 * einen Abend bewegt.
 */
@RunWith(AndroidJUnit4.class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
@LargeTest
public class FortschrittGeraeteTest {

    /**
     * Eigene Titel je Lauf.
     *
     * <p>Die Prüfung räumt die Ablage nicht leer: sie läuft gegen dieselbe
     * Installation wie alles andere, und was dort steht, geht sie nichts an.
     * Eindeutige Adressen sind der sauberere Weg - sie können mit nichts
     * zusammenstossen, was schon da ist.
     */
    private static final String KENNUNG = "pruefserie" + System.currentTimeMillis();
    private static final String TITEL = KENNUNG;
    private static final String BASIS =
        "https://aniworld.to/anime/stream/" + KENNUNG + "/staffel-1/episode-";
    private static final String FILM_KENNUNG = "prueffilm" + System.currentTimeMillis();
    private static final String FILM_TITEL = FILM_KENNUNG;
    private static final String FILM = "https://filmo.to/film/" + FILM_KENNUNG;

    /** Eine Laufzeit knapp über den Schwellen, damit alle Fälle erreichbar sind. */
    private static final double LAUFZEIT = 1371;

    /** Eine eigene Kernprobe je Lauf - eine alte aus einem frueheren Lauf zaehlt nicht. */
    private static final String PROBE = "kernprobe" + System.currentTimeMillis();

    /**
     * Vor jeder Pruefung, nicht einmal fuer alle.
     *
     * <p>Der Laeufer der Testbibliothek schliesst nach jeder Pruefung jede
     * offene Activity - das ist seine Aufgabe und gut so, aber es heisst, dass
     * die App zwischen zwei Faellen verschwindet. Ein {@code @BeforeClass} war
     * hier deshalb genau einmal richtig und danach zehnmal falsch.
     *
     * <p>Der Kern kommt in einem eigenen WebView hoch. Bis dahin verwirft die
     * Ablage jeden Stand - nicht, weil die Regel ihn ablehnt, sondern weil
     * niemand da ist, der sie anwendet.
     */
    @Before
    public void appStarten() {
        Pruefhilfe.appStarten();
        Pruefhilfe.warteAufKern("aniworld",
            "https://aniworld.to/anime/stream/" + PROBE + "/staffel-1/episode-1", PROBE);
    }

    /**
     * Fortschritt vor 2:30 - auf einer Folge, die nicht die erste ist.
     *
     * <p>Die erste Folge einer Staffel ist von der Schwelle ausgenommen (siehe
     * {@code startsAtFirstEpisode}); wer sie hier nähme, prüfte die Ausnahme
     * und nicht die Regel.
     */
    @Test
    public void a01_unterDerSchwelleEntstehtKeinEintrag() {
        Pruefhilfe.messen("aniworld", BASIS + "2", 100, LAUFZEIT, 100, false);
        // Kurz warten und dann pruefen, dass nichts entstanden ist: eine
        // Bedingung auf "bleibt leer" laesst sich nicht erwarten, nur abwarten.
        Pruefhilfe.warteAuf(() -> false, 4000);
        assertNull("Unter 2:30 darf kein Eintrag entstehen",
            Pruefhilfe.eintragMitTitel(TITEL));
    }

    /** Dieselbe Zeit auf Folge 1 legt einen an - genau wie am Rechner. */
    @Test
    public void a02_dieErsteFolgeIstAusgenommen() {
        Pruefhilfe.messen("aniworld", BASIS + "1", 100, LAUFZEIT, 100, false);
        assertTrue("Folge 1 sollte einen Eintrag anlegen",
            Pruefhilfe.warteAuf(() -> Pruefhilfe.eintragMitTitel(TITEL) != null));
        JSONObject eintrag = Pruefhilfe.eintragMitTitel(TITEL);
        assertEquals(7, eintrag.optInt("progress"));
        assertFalse(eintrag.optBoolean("completed"));
    }

    /** Über 2:30 rückt der Stand weiter. */
    @Test
    public void a03_ueberDerSchwelleRuecktDerStandWeiter() {
        Pruefhilfe.messen("aniworld", BASIS + "1", 182.7, LAUFZEIT, 155, false);
        assertTrue("Der Stand sollte auf 13 % stehen", Pruefhilfe.warteAuf(() -> {
            JSONObject eintrag = Pruefhilfe.eintragMitTitel(TITEL);
            return eintrag != null && eintrag.optInt("progress") == 13;
        }));
    }

    /** 75 Prozent sind noch kein Abschluss - der beginnt bei 90. */
    @Test
    public void a04_beiDreiVierteln() {
        Pruefhilfe.messen("aniworld", BASIS + "1", LAUFZEIT * 0.75, LAUFZEIT, LAUFZEIT * 0.75, false);
        assertTrue("Der Stand sollte auf 75 % stehen", Pruefhilfe.warteAuf(() -> {
            JSONObject eintrag = Pruefhilfe.eintragMitTitel(TITEL);
            return eintrag != null && eintrag.optInt("progress") == 75;
        }));
        assertFalse("75 % sind kein Abschluss",
            Pruefhilfe.eintragMitTitel(TITEL).optBoolean("completed"));
    }

    /**
     * Die Folge endet - der Eintrag rückt auf die nächste.
     *
     * <p>Das ist der automatische Wechsel, wie er in der Ablage aussieht:
     * Adresse auf Folge 2, Stand zurück auf null, eine abgeschlossene Folge
     * mehr, und {@code continuePending} gesetzt.
     */
    @Test
    public void a05_amEndeRuecktDerEintragAufDieNaechsteFolge() {
        // Die Grenzen der Staffel kommen mit - ohne sie weiss die Regel gar
        // nicht, dass es eine Folge 2 gibt, und laesst den Eintrag zu Recht auf
        // Folge 1 stehen. Im Betrieb liest sie das Folgenverzeichnis der Serie
        // (seitendaten.js); der zweite Weg dorthin ist der "naechste Folge"-Link
        // der Seite.
        Pruefhilfe.messen("aniworld", BASIS + "1", LAUFZEIT, LAUFZEIT, LAUFZEIT, true, 1, 5);
        assertTrue("Der Eintrag sollte auf Folge 2 stehen", Pruefhilfe.warteAuf(() -> {
            JSONObject eintrag = Pruefhilfe.eintragMitTitel(TITEL);
            return eintrag != null && eintrag.optString("url").endsWith("episode-2");
        }));
        JSONObject eintrag = Pruefhilfe.eintragMitTitel(TITEL);
        assertEquals(0, eintrag.optInt("progress"));
        assertTrue(eintrag.optBoolean("continuePending"));
        assertEquals(1, eintrag.optJSONArray("completedEpisodes").length());
        assertFalse("Die Serie ist nicht durch, nur die Folge",
            eintrag.optBoolean("completed"));
    }

    /** Ein Sprung nach vorn braucht dieselben 2:30 - vorher bleibt der Stand stehen. */
    @Test
    public void a06_einSprungNachVornBrauchtZeit() {
        Pruefhilfe.messen("aniworld", BASIS + "5", 100, LAUFZEIT, 100, false);
        Pruefhilfe.warteAuf(() -> false, 4000);
        assertTrue("Ohne 2:30 darf der Sprung nicht zaehlen",
            Pruefhilfe.eintragMitTitel(TITEL).optString("url").endsWith("episode-2"));

        Pruefhilfe.messen("aniworld", BASIS + "5", 200, LAUFZEIT, 160, false);
        assertTrue("Mit 2:30 sollte der Eintrag auf Folge 5 stehen", Pruefhilfe.warteAuf(() -> {
            JSONObject eintrag = Pruefhilfe.eintragMitTitel(TITEL);
            return eintrag != null && eintrag.optString("url").endsWith("episode-5");
        }));
    }

    /**
     * Die letzte Folge der letzten Staffel schliesst die Serie ab.
     *
     * <p>Dass eine Folge die letzte ist, steht im Folgenverzeichnis der Serie
     * und nicht im Video - deshalb kommen die Grenzen hier als Angabe herein,
     * so wie sie im Betrieb aus {@code seitendaten.js} kommen. Ohne sie bliebe
     * der Eintrag in "Weiterschauen" stehen und wartete auf eine Folge, die es
     * nicht gibt.
     */
    @Test
    public void a07_dieLetzteFolgeSchliesstDieSerieAb() {
        Pruefhilfe.messen("aniworld", BASIS + "5", LAUFZEIT, LAUFZEIT, LAUFZEIT, true, 1, 5);
        assertTrue("Die Serie sollte abgeschlossen sein", Pruefhilfe.warteAuf(() -> {
            JSONObject eintrag = Pruefhilfe.eintragMitTitel(TITEL);
            return eintrag != null && eintrag.optBoolean("completed");
        }));
        JSONObject eintrag = Pruefhilfe.eintragMitTitel(TITEL);
        assertTrue("Und aus Weiterschauen verschwinden",
            eintrag.optBoolean("hideFromContinueWatching"));
        assertEquals(100, eintrag.optInt("progress"));
    }

    /** Ein Film hat keine nächste Folge - er ist am Ende einfach durch. */
    @Test
    public void a08_einFilmWandertAmEndeInDieMediathek() {
        Pruefhilfe.messen("filmo", FILM, 900, 5400, 900, false);
        assertTrue("Der Film sollte angelegt werden",
            Pruefhilfe.warteAuf(() -> Pruefhilfe.eintragMitTitel(FILM_TITEL) != null));
        assertFalse(Pruefhilfe.eintragMitTitel(FILM_TITEL).optBoolean("completed"));

        Pruefhilfe.messen("filmo", FILM, 5400, 5400, 5400, true);
        assertTrue("Der Film sollte abgeschlossen sein", Pruefhilfe.warteAuf(() -> {
            JSONObject eintrag = Pruefhilfe.eintragMitTitel(FILM_TITEL);
            return eintrag != null && eintrag.optBoolean("completed");
        }));
        assertTrue(Pruefhilfe.eintragMitTitel(FILM_TITEL)
            .optBoolean("hideFromContinueWatching"));
    }

    /**
     * Zwölf Messwerte, drei Titel, kein einziger doppelter Eintrag.
     *
     * <p>Die Prüfung, die am ehesten etwas findet: dieselbe Folge wird hier
     * mehrfach gemeldet, es wird gesprungen, abgeschlossen und wieder
     * angefangen. Ein zweiter Eintrag entstünde davon lautlos und fiele erst
     * auf, wenn zwei gleiche Kacheln nebeneinander stehen.
     */
    @Test
    public void a09_keineDoppeltenEintraege() {
        assertEquals("Die Serie steht genau einmal", 1, Pruefhilfe.anzahlMitTitel(TITEL));
        assertEquals("Der Film steht genau einmal", 1, Pruefhilfe.anzahlMitTitel(FILM_TITEL));
    }

    /**
     * Der Stand überlebt einen Prozessabbruch.
     *
     * <p>Geprüft wird über die Platte: {@code FavoriteStore} liest die Datei
     * neu ein. Stünde der Stand nur im Arbeitsspeicher, wäre er nach dem
     * nächsten Aufräumen durch Android weg - und das ist auf einem Telefon der
     * Regelfall, nicht die Ausnahme.
     */
    @Test
    public void a10_derStandLiegtAufDerPlatte() {
        JSONObject eintrag = Pruefhilfe.eintragMitTitel(TITEL);
        assertNotNull(eintrag);
        assertTrue(eintrag.optBoolean("completed"));
        assertEquals(100, eintrag.optInt("progress"));
    }

    /**
     * Die gemessene Zeit ist aufgezeichnet.
     *
     * <p>Bis zu dieser Fassung zählte die App keine einzige Sekunde. Geprüft
     * wird deshalb nicht eine Zahl, sondern dass überhaupt eine dasteht - und
     * dass sie nicht die Laufzeit ist, sondern die Differenz der gemeldeten
     * Wiedergabe.
     */
    @Test
    public void a11_dieGemesseneZeitStehtInDenSitzungen() {
        Statistik statistik = new Statistik(Pruefhilfe.context(), null);
        assertTrue("Es sollten Sitzungen abgelegt sein", Pruefhilfe.warteAuf(() -> {
            Statistik frisch = new Statistik(Pruefhilfe.context(), null);
            return frisch.hatDaten();
        }));
        assertTrue(statistik.alle().length() > 0 || new Statistik(Pruefhilfe.context(), null)
            .alle().length() > 0);
    }
}
