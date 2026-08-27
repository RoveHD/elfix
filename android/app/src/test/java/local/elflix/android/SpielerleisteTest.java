package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Die beiden Sichtbarkeitsregeln der Wiedergabeleiste - ohne Ansicht.
 *
 * <p>Geprueft wird genau das, was der gemeldete Fehler war: "Autoplay" und
 * "Naechste Folge" waren <em>ein</em> Element und hatten deshalb zwangslaeufig
 * eine Regel. Jetzt sind es zwei, und die beiden Regeln sind ausdruecklich
 * verschieden - die Leiste tritt zurueck, der Schalter geht weg.
 *
 * <p>Was sich hier nicht pruefen laesst, ist der Platz auf dem Schirm und ob
 * ein {@code GONE}-Element wirklich keinen Fokus mehr annimmt. Dafuer braucht
 * es ein Geraet; das steht im Commit.
 */
public class SpielerleisteTest {

    @Test
    public void derSchalterGehtMitDerBedienleisteDesPlayers() {
        // Nichts laeuft: dann gibt es auch nichts einzustellen.
        assertFalse(Spielerleiste.autoplaySichtbar(false, true, false));
        assertFalse(Spielerleiste.autoplaySichtbar(false, false, false));

        // Es laeuft und die Bedienelemente stehen: der Schalter steht mit.
        assertTrue(Spielerleiste.autoplaySichtbar(true, true, false));

        // Die Bedienelemente sind weg: der Schalter auch. Das ist der Kern der
        // Aenderung - vorher wurde er nur durchsichtig und nahm weiter Platz,
        // Fokus und Beruehrungen.
        assertFalse(Spielerleiste.autoplaySichtbar(true, false, false));

        // Ausser waehrend des Zaehlers: eine Ansage, die man nicht abschalten
        // kann, ohne erst das Bild anzutippen, waere keine.
        assertTrue(Spielerleiste.autoplaySichtbar(true, false, true));
    }

    /**
     * Die Leiste geht in drei Schritten - voll, leiser, weg.
     *
     * <p>Hier stand einmal das Gegenteil ("verschwindet nie"), und zwar mit
     * gutem Grund: davor war sie nach dreieinhalb Sekunden fort und kam nicht
     * zurueck. Der Rueckweg ist inzwischen ein anderer - jede Beruehrung und
     * jede Taste holt sie zurueck -, und ein Kasten, der eine Stunde lang halb
     * durchsichtig ueber dem Bild klebt, war die naechste Beschwerde.
     */
    @Test
    public void dieLeisteGehtInDreiSchritten() {
        assertEquals(1f, Spielerleiste.deckkraft(true, Spielerleiste.Stufe.VOLL, false), 0.0001f);
        float leiser = Spielerleiste.deckkraft(true, Spielerleiste.Stufe.GEDIMMT, false);
        assertTrue("Der mittlere Schritt ist leiser", leiser < 1f);
        assertTrue("Aber noch auffindbar", leiser > 0f);
        assertEquals(0f, Spielerleiste.deckkraft(true, Spielerleiste.Stufe.WEG, false), 0.0001f);
    }

    /**
     * Ausserhalb des Vollbilds und waehrend des Zaehlers gilt kein Schritt.
     *
     * <p>Neben dem Bild verdeckt sie nichts, und ein Zaehler, der sich
     * wegduckt, waere keine Ansage.
     */
    @Test
    public void nebenDemBildUndImZaehlerStehtSieVollDa() {
        for (Spielerleiste.Stufe stufe : Spielerleiste.Stufe.values()) {
            assertEquals("neben dem Bild", 1f,
                Spielerleiste.deckkraft(false, stufe, false), 0.0001f);
            assertEquals("im Zaehler", 1f,
                Spielerleiste.deckkraft(true, stufe, true), 0.0001f);
            assertTrue("neben dem Bild sichtbar",
                Spielerleiste.leisteSichtbar(true, true, false, stufe, false));
            assertTrue("im Zaehler sichtbar",
                Spielerleiste.leisteSichtbar(true, true, true, stufe, true));
        }
    }

    /**
     * Ein leerer Kasten gehoert nicht auf den Schirm.
     *
     * <p>Der gemeldete Fehler: die Leiste war sichtbar, solange eine Folge
     * lief - auch mit beiden Knoepfen auf {@code GONE}. Uebrig blieb ihr
     * eigener Hintergrund, ein dunkler Punkt unten rechts im Video, und der
     * stand dort die ersten neunzig Prozent jeder Folge.
     */
    @Test
    public void ohneInhaltWirdNichtsGezeichnet() {
        assertFalse("kein Knopf, kein Kasten",
            Spielerleiste.leisteSichtbar(true, false, true, Spielerleiste.Stufe.VOLL, false));
        assertFalse("auch nicht neben dem Bild",
            Spielerleiste.leisteSichtbar(true, false, false, Spielerleiste.Stufe.VOLL, false));
        assertTrue("mit Knopf schon",
            Spielerleiste.leisteSichtbar(true, true, true, Spielerleiste.Stufe.VOLL, false));
    }

    /** Laeuft gar nichts, steht auch nichts da. */
    @Test
    public void ohneFolgeStehtNichtsDa() {
        assertFalse(Spielerleiste.leisteSichtbar(false, true, true, Spielerleiste.Stufe.VOLL, false));
        assertFalse(Spielerleiste.autoplaySichtbar(false, true, false));
    }

    /**
     * Im letzten Schritt ist sie wirklich weg - nicht nur durchsichtig.
     *
     * <p>Das ist der Unterschied, auf den es ankommt: eine Ansicht, die nur
     * durchsichtig ist, belegt weiter Platz, nimmt Fokus an und faengt
     * Beruehrungen ab.
     */
    @Test
    public void derLetzteSchrittIstWirklichWeg() {
        assertFalse(Spielerleiste.leisteSichtbar(true, true, true, Spielerleiste.Stufe.WEG, false));
        assertTrue(Spielerleiste.leisteSichtbar(true, true, true, Spielerleiste.Stufe.GEDIMMT, false));
    }

    /**
     * Die beiden Regeln haengen nicht aneinander.
     *
     * <p>Der Fall aus der Meldung: die Bedienelemente des Players sind weg. Der
     * Schalter ist dann sofort fort, die Leiste tritt erst nur zurueck.
     */
    @Test
    public void schalterUndLeisteEntscheidenGetrennt() {
        boolean schalter = Spielerleiste.autoplaySichtbar(true, false, false);
        assertFalse(schalter);
        assertTrue(Spielerleiste.leisteSichtbar(true, true, true,
            Spielerleiste.Stufe.GEDIMMT, false));
    }

    /**
     * Die Ausblendkette hat keine Sackgasse mehr.
     *
     * <p>Der gemeldete Fall vom Fernseher: "die Leiste blendet sich nicht mehr
     * nach ein paar Sekunden aus". Meldete der Player, dass seine eigene
     * Bedienleiste steht, endete der Takt hier ohne Fortsetzung - von da an
     * lief keiner mehr, und die Leiste kam nur durch eine Beruehrung zurueck in
     * den Ablauf. Wer auf dem Fernseher zuschaut, beruehrt nichts.
     *
     * <p>Richtig ist WARTEN und nicht Ende: aufgeschoben, nicht aufgehoben.
     */
    @Test
    public void diePlayerleisteSchiebtAufUndHebtNichtAuf() {
        assertEquals(Spielerleiste.Schritt.WARTEN,
            Spielerleiste.naechsterSchritt(false, false, true, Spielerleiste.Stufe.VOLL));
        assertEquals(Spielerleiste.Schritt.WARTEN,
            Spielerleiste.naechsterSchritt(false, false, true, Spielerleiste.Stufe.GEDIMMT));
        // Und sobald der Player seine Leiste wegnimmt, ruecken die Schritte
        // weiter - ohne dass jemand etwas tun muesste.
        assertEquals(Spielerleiste.Schritt.DIMMEN,
            Spielerleiste.naechsterSchritt(false, false, false, Spielerleiste.Stufe.VOLL));
        assertEquals(Spielerleiste.Schritt.VERSCHWINDEN,
            Spielerleiste.naechsterSchritt(false, false, false, Spielerleiste.Stufe.GEDIMMT));
    }

    /** Ein laufender Zaehler haelt jeden Schritt auf - eine Ansage duckt sich nicht weg. */
    @Test
    public void derZaehlerHaeltDenTaktAuf() {
        assertEquals(Spielerleiste.Schritt.WARTEN,
            Spielerleiste.naechsterSchritt(false, true, false, Spielerleiste.Stufe.VOLL));
        assertEquals(Spielerleiste.Schritt.WARTEN,
            Spielerleiste.naechsterSchritt(false, true, false, Spielerleiste.Stufe.GEDIMMT));
    }

    /**
     * Der Fokus haelt nur den letzten Schritt auf, nicht jeden.
     *
     * <p>Der zweite Teil der Meldung vom Fernseher, und im Emulator an einer
     * echten Folge nachgestellt: nach einem Druck auf das Steuerkreuz sass der
     * Fokus auf dem Autoplay-Schalter im Vollbild. Der Fokus hielt bis hierher
     * *jeden* Schritt auf - der Kasten stand damit bei voller Deckkraft ueber
     * dem Video, bis wieder jemand eine Taste drueckte. Auf einem Fernseher, wo
     * man beim Schauen nichts drueckt, heisst das: bis zum Ende der Folge.
     *
     * <p>Zuruecktreten darf er also auch mit Fokus. Nur ganz verschwinden nicht -
     * das naehme der Fernbedienung den Platz, an dem sie steht.
     */
    @Test
    public void derFokusHaeltNurDenLetztenSchrittAuf() {
        assertEquals(Spielerleiste.Schritt.DIMMEN,
            Spielerleiste.naechsterSchritt(true, false, false, Spielerleiste.Stufe.VOLL));
        assertEquals(Spielerleiste.Schritt.WARTEN,
            Spielerleiste.naechsterSchritt(true, false, false, Spielerleiste.Stufe.GEDIMMT));
        // Ohne Fokus geht sie den Weg zu Ende.
        assertEquals(Spielerleiste.Schritt.VERSCHWINDEN,
            Spielerleiste.naechsterSchritt(false, false, false, Spielerleiste.Stufe.GEDIMMT));
    }
}
