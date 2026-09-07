package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Kleine, nackte JVM-Proben fuer die Android-Vertrauensgrenzen. */
public final class SicherheitsgrenzenTest {
    @Test
    public void anbieterHostBrauchtEineEchteDomainGrenze() {
        assertTrue(MainActivity.hostUnter("aniworld.to", "aniworld.to"));
        assertTrue(MainActivity.hostUnter("img.aniworld.to", "aniworld.to"));
        assertTrue(MainActivity.hostUnter("www.filmo.to", "filmo.to"));
        assertFalse(MainActivity.hostUnter("aniworld.to.evil.example", "aniworld.to"));
        assertFalse(MainActivity.hostUnter("fake-aniworld.to", "aniworld.to"));
        assertFalse(MainActivity.hostUnter("filmo.to.attacker.invalid", "filmo.to"));
    }

    @Test
    public void originIstSchemaHostUndNichtAehnlicherText() {
        assertEquals("https://player.example", Rahmen.origin("https://PLAYER.example:443/watch?a=1"));
        assertEquals("http://127.0.0.1:8080", Rahmen.origin("http://127.0.0.1:8080/player"));
        assertFalse(Rahmen.origin("javascript:alert(1)").length() > 0);
        assertFalse(Rahmen.origin("https://player.example.evil.invalid").equals(
            Rahmen.origin("https://player.example")));
    }

    @Test
    public void messwerteSindEndlichUndPlausibelBegrenzt() {
        assertTrue(Messung.gueltigeZeitwerte(120, 1400, 118));
        assertFalse(Messung.gueltigeZeitwerte(Double.NaN, 1400, 1));
        assertFalse(Messung.gueltigeZeitwerte(1, Double.POSITIVE_INFINITY, 1));
        assertFalse(Messung.gueltigeZeitwerte(90_000, 1400, 1));
        assertFalse(Messung.gueltigeZeitwerte(1, 25 * 60 * 60, 1));
        assertFalse(Messung.gueltigeZeitwerte(1, 1400, -1));
    }

    @Test
    public void debugPaketHatEineExpliziteReleaseBasis() {
        assertEquals("local.elflix.android",
            Aktualisierung.basisPaket("local.elflix.android.debug"));
        assertEquals("local.elflix.android",
            Aktualisierung.basisPaket("local.elflix.android"));
    }

    @Test
    public void kernLaesstNurSeineEineAssetSeiteAlsHauptdokumentZu() {
        assertTrue(Kern.istKernSeite("file:///android_asset/kern/kern.html"));
        assertFalse(Kern.istKernSeite("https://attacker.invalid/kern.html"));
        assertFalse(Kern.istKernSeite("file:///android_asset/kern/kern.html#umgeleitet"));
    }

    @Test
    public void quellenBootstrapBrauchtKeinVorgetaeuschtesRaumeigentum() {
        assertTrue(Mitschauen.darfQuelleWaehlen(true, "", "geraet-a"));
        assertTrue(Mitschauen.darfQuelleWaehlen(true, "geraet-a", "geraet-a"));
        assertFalse(Mitschauen.darfQuelleWaehlen(true, "geraet-b", "geraet-a"));
        assertTrue(Mitschauen.darfQuelleWaehlen(false, "geraet-b", "geraet-a"));
    }
}
