package local.elflix.android;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * Die Regel, nach der aus einer Bewegung ein Wischen wird.
 *
 * <p>Sie sitzt auf dem Titelhintergrund der Startseite, und dort teilt sie
 * sich die Fläche mit zwei Knöpfen und einer Seite, die senkrecht scrollt.
 * Genau deshalb ist sie zweistufig: weit genug zur Seite <em>und</em>
 * deutlicher zur Seite als nach oben. Fiele die zweite Bedingung weg, bliebe
 * ein schräg geführter Daumen, der eigentlich scrollen will, am Bild hängen.
 *
 * <p><b>Der gemeldete Fehler dahinter.</b> Gewischt werden konnte zuerst nur
 * auf der Schrift, nicht auf dem Bild. Das lag nicht an dieser Regel, sondern
 * daran, wo sie ausgewertet wurde: {@code onInterceptTouchEvent} wird für die
 * Bewegungen nur weiter gefragt, wenn ein Kind das erste Niedergehen
 * angenommen hat — auf der Schrift tun das die Knöpfe, auf dem Bild niemand.
 * Seither läuft beides durch dieselbe Regel, und die steht hier.
 */
public class WischenTest {

    /** Dieselbe Größenordnung wie die Schwelle eines echten Geräts. */
    private static final int SCHWELLE = 24;

    @Test
    public void nachLinksHeisstWeiter() {
        assertEquals(1, MobileViews.wischRichtung(-100f, 0f, SCHWELLE));
    }

    @Test
    public void nachRechtsHeisstZurueck() {
        assertEquals(-1, MobileViews.wischRichtung(100f, 0f, SCHWELLE));
    }

    /** Ein Wackeln unterhalb der Schwelle ist ein Tipp und kein Wischen. */
    @Test
    public void unterDerSchwelleGeschiehtNichts() {
        assertEquals(0, MobileViews.wischRichtung(SCHWELLE, 0f, SCHWELLE));
        assertEquals(0, MobileViews.wischRichtung(-SCHWELLE, 0f, SCHWELLE));
        assertEquals(0, MobileViews.wischRichtung(0f, 0f, SCHWELLE));
    }

    /**
     * Wer scrollt, blättert nicht.
     *
     * <p>Der Fall, an dem die Geste sonst unbrauchbar wird: ein Daumen fährt
     * beim Scrollen fast nie senkrecht.
     */
    @Test
    public void senkrechtDominiertHeisstScrollen() {
        assertEquals(0, MobileViews.wischRichtung(60f, 200f, SCHWELLE));
        assertEquals(0, MobileViews.wischRichtung(-60f, 200f, SCHWELLE));
        // Genau an der Grenze - anderthalbmal so weit quer wie hoch - zaehlt
        // es noch nicht.
        assertEquals(0, MobileViews.wischRichtung(150f, 100f, SCHWELLE));
        assertEquals(1, MobileViews.wischRichtung(-151f, 100f, SCHWELLE));
    }

    /**
     * Ein schräges Wischen, das eindeutig quer ist, zählt.
     *
     * <p>Niemand wischt waagerecht. Wäre die Regel strenger, träfe man sie nur
     * mit einem Lineal.
     */
    @Test
    public void schraegAberDeutlichQuerZaehlt() {
        assertEquals(1, MobileViews.wischRichtung(-200f, 40f, SCHWELLE));
        assertEquals(-1, MobileViews.wischRichtung(200f, -40f, SCHWELLE));
    }
}
