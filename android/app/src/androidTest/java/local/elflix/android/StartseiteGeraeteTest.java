package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.LargeTest;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.Direction;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Die Startseite auf einem Gerät: Reihen, Drehen, Zurück.
 *
 * <p>Was hier geprüft wird, ist die Sorte Fehler, die kein Unit-Test findet:
 * eine Reihe, die trotz ausgeschaltetem Schalter dasteht; ein Aufbau, der beim
 * Drehen stirbt; ein Bildschirm, von dem die Zurück-Taste nicht wegführt. Alle
 * drei sind schon vorgekommen, und alle drei sehen im Code richtig aus.
 *
 * <p>Gefunden wird über sichtbaren Text und nicht über Kennungen: die
 * Oberfläche wird von Hand gebaut und vergibt keine {@code id}. Das ist keine
 * Schwäche der Prüfung - die Überschrift einer Reihe ist ohnehin das, woran ein
 * Mensch sie erkennt.
 *
 * <p><b>Warum durchgescrollt wird:</b> UiAutomator sieht nur, was auf dem
 * Bildschirm steht. Eine Reihe unterhalb des Randes ist dort nicht "fehlend",
 * sondern schlicht nicht sichtbar - und eine Prüfung, die den Unterschied nicht
 * macht, schlägt fehl, sobald jemand eine Zeile hinzufügt. {@link #suche} geht
 * die Seite deshalb ab.
 */
@RunWith(AndroidJUnit4.class)
@LargeTest
public class StartseiteGeraeteTest {

    private static final long WARTEN_MS = 20_000;
    /** So oft wird beim Suchen weitergeblättert, bevor der Text als fehlend gilt. */
    private static final int SCROLL_SCHRITTE = 12;

    private UiDevice geraet() {
        return UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    }

    private Context context() {
        return InstrumentationRegistry.getInstrumentation().getTargetContext();
    }

    /**
     * Einmal blaettern - und eine abgehaengte Flaeche als "geht nicht mehr" lesen.
     *
     * <p>{@code StaleObjectException} heisst hier nichts Schlimmes: die Seite
     * hat sich waehrend des Blaetterns neu aufgebaut, und der Griff zeigt auf
     * eine Ansicht, die es nicht mehr gibt. Genau das geschieht staendig -
     * eine Vorschlagsreihe wird fertig, das Titelbild wechselt. Der naechste
     * Versuch holt sich die neue Flaeche.
     */
    private boolean blaettern(Direction richtung, float anteil) {
        try {
            UiObject2 flaeche = geraet().findObject(By.scrollable(true));
            return flaeche != null && flaeche.scroll(richtung, anteil);
        } catch (androidx.test.uiautomator.StaleObjectException abgehaengt) {
            return true;
        }
    }

    /** Ganz nach oben - eine frisch gebaute Seite fängt dort an, eine gescrollte nicht. */
    private void zumAnfang() {
        for (int i = 0; i < SCROLL_SCHRITTE; i += 1) {
            if (!blaettern(Direction.UP, 1f)) break;
        }
        geraet().waitForIdle();
    }

    /** Steht dieser Text irgendwo auf der Seite - notfalls weiter unten? */
    private boolean suche(String text) {
        if (geraet().wait(Until.hasObject(By.textContains(text)), 2000)) return true;
        for (int i = 0; i < SCROLL_SCHRITTE; i += 1) {
            if (!blaettern(Direction.DOWN, 0.8f)) break;
            geraet().waitForIdle();
            if (geraet().hasObject(By.textContains(text))) return true;
        }
        return false;
    }

    /** Die Startseite steht - erkennbar an der Leiste, die immer sichtbar ist. */
    private void warteAufStartseite() {
        assertTrue("Die Startseite sollte stehen",
            geraet().wait(Until.hasObject(By.text("Einstellungen")), WARTEN_MS));
    }

    @Before
    public void appStarten() {
        Pruefhilfe.appStarten();
        Pruefhilfe.aufApp(MainActivity::showHome);
        warteAufStartseite();
    }

    @After
    public void aufraeumen() throws Exception {
        // Die Schalter gehören dem Benutzer. Was eine Prüfung umlegt, legt sie
        // zurück - sonst findet er seine Startseite verändert vor.
        new Startseite(context()).zuruecksetzen();
        geraet().setOrientationNatural();
        geraet().executeShellCommand("cmd connectivity airplane-mode disable");
        Pruefhilfe.aufApp(MainActivity::showHome);
    }

    /**
     * Ein ausgeschalteter Schalter blendet seine Reihe aus - und wieder ein.
     *
     * <p>Der Kalender ist dafür der beste Fall: seine Überschrift ist eindeutig
     * und steht nicht zufällig auch woanders.
     */
    @Test
    public void derKalenderschalterBlendetSeineReiheAus() {
        Startseite startseite = new Startseite(context());
        startseite.setzen(Startseite.KALENDER, true);
        Pruefhilfe.aufApp(MainActivity::showHome);
        zumAnfang();
        assertTrue("Die Kalenderreihe sollte dastehen", suche("Diese Woche"));

        startseite.setzen(Startseite.KALENDER, false);
        Pruefhilfe.aufApp(MainActivity::showHome);
        geraet().waitForIdle();
        zumAnfang();
        assertFalse("Die Kalenderreihe sollte verschwinden", suche("Diese Woche"));

        startseite.setzen(Startseite.KALENDER, true);
        Pruefhilfe.aufApp(MainActivity::showHome);
        geraet().waitForIdle();
        zumAnfang();
        assertTrue("Und wieder erscheinen", suche("Diese Woche"));
    }

    /**
     * Sind alle Reihen aus, steht der Weg zurück auf der Seite selbst.
     *
     * <p>Eine leergeräumte Startseite sieht kaputt aus, und wer sie leergeräumt
     * hat, sucht die Einstellung nicht noch einmal - der Ausweg gehört dorthin,
     * wo der Mangel auffällt.
     */
    @Test
    public void eineLeereStartseiteBietetDenWegZurueck() {
        Startseite startseite = new Startseite(context());
        for (Startseite.Reihe reihe : Startseite.REIHEN) {
            startseite.setzen(reihe.schluessel, false);
        }
        assertEquals(0, startseite.anzahlAn());

        Pruefhilfe.aufApp(MainActivity::showHome);
        geraet().waitForIdle();
        zumAnfang();
        assertTrue("Der Hinweis sollte dastehen", suche("Reihen einblenden"));
        geraet().findObject(By.textContains("Reihen einblenden")).click();
        assertTrue("Danach sind die Reihen wieder da",
            Pruefhilfe.warteAuf(() -> new Startseite(context()).anzahlAn() > 0));
    }

    /**
     * Drehen baut die Seite neu auf, ohne sie zu verlieren.
     *
     * <p>Die Masse der Startseite hängen an der Breite: wie viele Anbieter in
     * eine Zeile passen, wie breit eine Kachel ist, wie hoch das Titelbild sein
     * darf. Nach dem Drehen stimmt davon nichts mehr, und die Reihen liefen
     * schon einmal über den Rand hinaus.
     */
    @Test
    public void drehenUeberstehtDieStartseite() throws Exception {
        geraet().setOrientationLeft();
        geraet().waitForIdle();
        warteAufStartseite();
        zumAnfang();
        assertTrue("Im Querformat sollten die Anbieter dastehen", suche("Deine Anbieter"));

        geraet().setOrientationNatural();
        geraet().waitForIdle();
        warteAufStartseite();
        zumAnfang();
        assertTrue("Und im Hochformat wieder", suche("Deine Anbieter"));
    }

    /**
     * Der Kalender lässt sich öffnen, und Zurück führt heraus.
     *
     * <p>Eine eigene Ansicht ohne Weg zurück ist eine Sackgasse - auf einem
     * Telefon die häufigste Art, eine App unbenutzbar zu machen.
     */
    @Test
    public void derKalenderOeffnetSichUndLaesstSichVerlassen() {
        Pruefhilfe.aufApp(MainActivity::zeigeKalender);
        assertTrue("Die Kalenderansicht sollte aufgehen",
            geraet().wait(Until.hasObject(By.text("Kalender")), WARTEN_MS));

        geraet().pressBack();
        geraet().waitForIdle();
        zumAnfang();
        assertTrue("Zurueck fuehrt auf die Startseite", suche("Deine Anbieter"));
    }

    /**
     * Mehrfaches Antippen derselben Aktion baut nichts doppelt.
     *
     * <p>Auf einem Telefon ist der Doppeltipp der Normalfall, nicht die
     * Ausnahme - es reicht, dass die Seite kurz hakt.
     */
    @Test
    public void mehrfachesAntippenAendertNichts() {
        for (int i = 0; i < 8; i += 1) {
            Pruefhilfe.aufApp(MainActivity::showHome);
        }
        geraet().waitForIdle();
        zumAnfang();
        assertTrue("Die Startseite steht danach", suche("Deine Anbieter"));
        assertEquals("Und zwar genau einmal",
            1, geraet().findObjects(By.text("Deine Anbieter")).size());
    }

    /**
     * Ohne Netz verschwinden die Vorschläge nicht wortlos.
     *
     * <p>Der Fall, um den es der ganzen Offline-Behandlung geht: der
     * Empfehlungslauf fängt einen gescheiterten Abruf ab und gibt eine leere
     * Liste zurück - und eine leere Reihe sah aus wie "dazu gibt es nichts".
     * Ob dabei der Zwischenspeicher greift oder der Offline-Hinweis, hängt
     * davon ab, was auf der Platte liegt; beide tragen denselben Knopf, und
     * genau der ist der Unterschied zum wortlosen Verschwinden.
     */
    @Test
    public void ohneNetzStehtEinHinweisStattEinerLuecke() throws Exception {
        geraet().executeShellCommand("cmd connectivity airplane-mode enable");
        Thread.sleep(5000);
        assertFalse("Der Emulator sollte jetzt offline sein", Netz.vorhanden(context()));

        // Der Lauf braucht einen Augenblick, bis er merkt, dass nichts
        // hereinkommt - vorher steht dort noch ein Skelett.
        assertTrue("Es sollte ein Weg aus dem Offline-Zustand dastehen",
            Pruefhilfe.warteAuf(() -> {
                Pruefhilfe.aufApp(MainActivity::showHome);
                geraet().waitForIdle();
                zumAnfang();
                return suche("Erneut versuchen");
            }, 90_000));
        zumAnfang();
        assertTrue("Und die oertlichen Bereiche bleiben stehen", suche("Deine Anbieter"));
    }
}
