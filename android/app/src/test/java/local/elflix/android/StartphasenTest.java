package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

/**
 * Die Ladephasen, so wie das Geraet sie liest.
 *
 * <h2>Was hier geprueft wird - und was ausdruecklich nicht</h2>
 *
 * <p>Nicht die Tabelle. Namen, Beschriftungen, Anteile und Fristen gehoeren
 * dem geteilten Modul {@code src/startphasen.js}; sie stehen dort einmal und
 * werden dort geprueft ({@code tests/startphasentest.js}). Ein zweiter Satz
 * Zahlen hier waere genau die zweite Wahrheit, die dieser Aufbau vermeiden
 * soll.
 *
 * <p>Geprueft wird der Weg dazwischen: dass {@link Startphasen} das Modell
 * vollstaendig uebernimmt, dass es ohne Modell ehrlich {@code false} meldet -
 * dann gibt es keinen Vorhang, und der Start laeuft wie vorher -, und dass die
 * beiden Rechnungen des Vorhangs stimmen. Es sind genau zwei: ist eine
 * gemeldete Phase weiter als die stehende, und ist eine Frist abgelaufen.
 *
 * <p>Das Modell im Text unten ist eine gekuerzte Nachbildung mit anderen
 * Zahlen als das echte. Das ist Absicht: eine Pruefung, die dieselben Werte
 * nennt wie die Tabelle, prueft nur, dass jemand richtig abgeschrieben hat.
 */
public class StartphasenTest {

    private static final String MODELL = "{"
        + "\"phasen\":["
        + "{\"name\":\"seite\",\"text\":\"Folge wird geöffnet\",\"anteil\":0.1,\"fristMs\":5000},"
        + "{\"name\":\"hoster\",\"text\":\"Player wird geladen\",\"anteil\":0.4,\"fristMs\":3000},"
        + "{\"name\":\"laeuft\",\"text\":\"Wiedergabe läuft\",\"anteil\":1,\"fristMs\":0}"
        + "],"
        + "\"erste\":\"seite\",\"letzte\":\"laeuft\",\"gesamtFristMs\":9000,"
        + "\"fehlertexte\":{\"seite\":\"Die Folgenseite lädt nicht.\","
        + "\"hoster\":\"Der Hoster hat keinen Player geliefert.\","
        + "\"gesamt\":\"Der Start dauert zu lange.\","
        + "\"\":\"Die Folge konnte nicht gestartet werden.\"}"
        + "}";

    private static Startphasen geladen() throws Exception {
        Startphasen phasen = new Startphasen(null);
        phasen.uebernehmen(new JSONObject(MODELL));
        return phasen;
    }

    /* -------------------------------------------------------- Ohne Modell */

    @Test
    public void ohneModellGibtEsKeinenVorhang() {
        Startphasen phasen = new Startphasen(null);
        assertFalse("ohne Tabelle ist nichts bereit", phasen.istBereit());
        assertEquals("", phasen.erste());
        assertEquals("", phasen.letzte());
        assertEquals(-1, phasen.nummer("seite"));
    }

    @Test
    public void einLeeresModellWirdNichtUebernommen() throws Exception {
        Startphasen phasen = geladen();
        phasen.uebernehmen(new JSONObject("{\"phasen\":[]}"));
        assertTrue("die geladene Tabelle bleibt stehen", phasen.istBereit());
        assertEquals("seite", phasen.erste());
    }

    /* ---------------------------------------------------- Die Uebernahme */

    @Test
    public void dasModellWirdVollstaendigUebernommen() throws Exception {
        Startphasen phasen = geladen();
        assertTrue(phasen.istBereit());
        assertEquals("seite", phasen.erste());
        assertEquals("laeuft", phasen.letzte());
        assertEquals(9000L, phasen.gesamtFristMs());
        assertEquals("Player wird geladen", phasen.beschriftung("hoster"));
        assertEquals(0.4, phasen.anteil("hoster"), 0.0001);
        assertEquals(3000L, phasen.phase("hoster").fristMs);
    }

    @Test
    public void unbekannteNamenAntwortenLeerUndNichtMitEinerAusnahme() throws Exception {
        Startphasen phasen = geladen();
        assertEquals(-1, phasen.nummer("gibt-es-nicht"));
        assertEquals("", phasen.beschriftung("gibt-es-nicht"));
        assertEquals(0.0, phasen.anteil("gibt-es-nicht"), 0.0001);
        assertEquals(null, phasen.phase("gibt-es-nicht"));
    }

    @Test
    public void jederSchrittHatSeinenEigenenFehlertext() throws Exception {
        Startphasen phasen = geladen();
        assertEquals("Der Hoster hat keinen Player geliefert.", phasen.fehlertext("hoster"));
        assertEquals("Der Start dauert zu lange.", phasen.fehlertext("gesamt"));
    }

    @Test
    public void wasKeinenEigenenHatBekommtDenAllgemeinen() throws Exception {
        Startphasen phasen = geladen();
        assertEquals("Die Folge konnte nicht gestartet werden.", phasen.fehlertext("laeuft"));
        assertEquals("Die Folge konnte nicht gestartet werden.", phasen.fehlertext("was-auch-immer"));
        assertEquals("Die Folge konnte nicht gestartet werden.", phasen.fehlertext(null));
    }

    /* ------------------------------------------------ Nur nach vorn */

    // Die Kette meldet Schritte mehrfach - jeder Takt des Autostarts sieht
    // denselben Zustand wieder. Ein Balken, der dabei zurueckspringt, sieht aus
    // wie ein Fehler. Der Vorhang vergleicht dafuer die Nummern, und genau das
    // steht hier.
    @Test
    public void schritteLassenSichDerReiheNachVergleichen() throws Exception {
        Startphasen phasen = geladen();
        assertTrue(phasen.nummer("hoster") > phasen.nummer("seite"));
        assertTrue(phasen.nummer("laeuft") > phasen.nummer("hoster"));
        assertFalse("rueckwaerts ist keine Meldung",
            phasen.nummer("seite") > phasen.nummer("hoster"));
        assertFalse("und ein unbekannter Name erst recht nicht",
            phasen.nummer("gibt-es-nicht") > phasen.nummer("seite"));
    }

    /* ------------------------------------------------------- Die Fristen */

    @Test
    public void kurzVorDerFristWirdGewartet() throws Exception {
        Startphasen phasen = geladen();
        assertEquals("", Startvorhang.abgelaufen(phasen, "seite", 0, 0, 4999));
    }

    @Test
    public void mitDerFristDesSchrittesIstSchluss() throws Exception {
        Startphasen phasen = geladen();
        assertEquals("seite", Startvorhang.abgelaufen(phasen, "seite", 0, 0, 5000));
    }

    @Test
    public void jederSchrittHatSeineEigeneGeduld() throws Exception {
        Startphasen phasen = geladen();
        // Bei 4000 ms in der Phase waere "seite" noch geduldig, "hoster" nicht.
        assertEquals("", Startvorhang.abgelaufen(phasen, "seite", 0, 0, 4000));
        assertEquals("hoster", Startvorhang.abgelaufen(phasen, "hoster", 0, 0, 4000));
    }

    @Test
    public void derDeckelGehtVor() throws Exception {
        Startphasen phasen = geladen();
        // Der Schritt selbst laeuft erst seit einer Sekunde und waere geduldig -
        // aber der ganze Start dauert nun schon neun.
        assertEquals("gesamt", Startvorhang.abgelaufen(phasen, "hoster", 0, 8000, 9000));
    }

    @Test
    public void einSchrittOhneFristLaeuftInKeine() throws Exception {
        Startphasen phasen = geladen();
        assertEquals("", Startvorhang.abgelaufen(phasen, "laeuft", 8000, 8000, 8999));
    }

    @Test
    public void ohneTabelleWirdNichtsFuerAbgelaufenErklaert() {
        assertEquals("", Startvorhang.abgelaufen(null, "seite", 0, 0, 999999));
        assertEquals("", Startvorhang.abgelaufen(new Startphasen(null), "seite", 0, 0, 999999));
    }

    /* --------------------------------------------------- Die Zeitangabe */

    // Nur fuer die Anzeige: "Zur gespeicherten Stelle (3:03)". Sie steht hier,
    // weil eine falsch gerundete Minute im Ladebildschirm sofort auffaellt und
    // sich sonst niemand darum kuemmert.
    @Test
    public void derGespeicherteStandStehtLesbarDa() {
        assertEquals("0:00", Startvorhang.zeitText(0));
        assertEquals("0:07", Startvorhang.zeitText(7.4));
        assertEquals("3:03", Startvorhang.zeitText(182.7));
        assertEquals("23:40", Startvorhang.zeitText(1420));
        assertEquals("1:00:00", Startvorhang.zeitText(3600));
        assertEquals("1:02:03", Startvorhang.zeitText(3723));
    }
}
