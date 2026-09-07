package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.res.Configuration;
import org.junit.Test;

/** Die Bereitschaft des nativen Players bei verschiedenen Frame-Rastern. */
public class DirektSpielerFrameTest {

    private static final double FRAME_ZIEL = 270.770488;
    private static final double ANDROID_FRAME = 270.798467;
    private static final double POSITION_ZIEL = 270.770;
    private static final double BILDRATE = 24.0;

    @Test
    public void akzeptiertNaechstesBildDerAnderenQualitaetsstufe() {
        assertTrue(DirektSpieler.frameToleranz(BILDRATE) > ANDROID_FRAME - FRAME_ZIEL);
        assertTrue(DirektSpieler.genauerFramePasst(
            POSITION_ZIEL, POSITION_ZIEL, ANDROID_FRAME, FRAME_ZIEL, BILDRATE, 7, 7));
    }

    @Test
    public void noOpSeekDarfDasSchonPassendeBildBehalten() {
        long folge = DirektSpieler.bildFolgeNachSeek(7,
            POSITION_ZIEL, POSITION_ZIEL, ANDROID_FRAME, FRAME_ZIEL, BILDRATE);

        assertEquals(7, folge);
        assertTrue(DirektSpieler.genauerFramePasst(
            POSITION_ZIEL, POSITION_ZIEL, ANDROID_FRAME, FRAME_ZIEL, BILDRATE, 7, folge));
    }

    @Test
    public void echterSeekVerlangtEinenNeuenFrameCallback() {
        long erwartet = DirektSpieler.bildFolgeNachSeek(7,
            265.0, POSITION_ZIEL, 265.020, FRAME_ZIEL, BILDRATE);

        assertEquals(8, erwartet);
        assertFalse(DirektSpieler.genauerFramePasst(
            POSITION_ZIEL, POSITION_ZIEL, ANDROID_FRAME, FRAME_ZIEL, BILDRATE, 7, erwartet));
        assertTrue(DirektSpieler.genauerFramePasst(
            POSITION_ZIEL, POSITION_ZIEL, ANDROID_FRAME, FRAME_ZIEL, BILDRATE, 8, erwartet));
    }

    @Test
    public void verwirftFerneStelleFehlendenPtsUndFernesBild() {
        assertFalse(DirektSpieler.genauerFramePasst(
            265.0, POSITION_ZIEL, ANDROID_FRAME, FRAME_ZIEL, BILDRATE, 8, 8));
        assertFalse(DirektSpieler.genauerFramePasst(
            POSITION_ZIEL, POSITION_ZIEL, Double.NaN, FRAME_ZIEL, BILDRATE, 8, 8));
        assertFalse(DirektSpieler.genauerFramePasst(
            POSITION_ZIEL, POSITION_ZIEL, 271.2, FRAME_ZIEL, BILDRATE, 8, 8));
    }

    @Test
    public void spulenDarfNurDerHostOderEinPrivaterPlayer() {
        assertTrue(DirektSpieler.darfNutzerSpulen(false, false));
        assertTrue(DirektSpieler.darfNutzerSpulen(true, true));
        assertFalse(DirektSpieler.darfNutzerSpulen(true, false));
    }

    @Test
    public void fassungUndHosterDarfNurDerHostOderEinPrivaterPlayerWaehlen() {
        assertTrue(DirektWiedergabe.darfFassungUndHosterWaehlen(false, false));
        assertTrue(DirektWiedergabe.darfFassungUndHosterWaehlen(true, true));
        assertFalse(DirektWiedergabe.darfFassungUndHosterWaehlen(true, false));
    }

    @Test
    public void aniworldFilmeBleibenImNativenDirektplayer() {
        String basis = "https://aniworld.to/anime/stream/demon-slayer";
        assertTrue(DirektWiedergabe.istSerienseite(basis + "/filme"));
        assertTrue(DirektWiedergabe.istFolge(basis + "/filme/film-1"));
        assertTrue(DirektWiedergabe.passt(basis + "/filme"));
        assertTrue(DirektWiedergabe.passt(basis + "/filme/film-1"));
        assertFalse(DirektWiedergabe.istFolge(basis + "/filme"));
    }

    @Test
    public void nurDieFernsehKonfigurationBekommtDieFernbedienungsLeiste() {
        Configuration tv = new Configuration();
        tv.uiMode = Configuration.UI_MODE_TYPE_TELEVISION;
        assertTrue(DirektSpieler.istFernseher(tv));

        Configuration telefon = new Configuration();
        telefon.uiMode = Configuration.UI_MODE_TYPE_NORMAL;
        assertFalse(DirektSpieler.istFernseher(telefon));
    }
}
