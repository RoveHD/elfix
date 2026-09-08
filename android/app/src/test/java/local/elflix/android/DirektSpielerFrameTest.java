package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.graphics.Color;
import android.content.res.Configuration;
import java.util.ArrayList;
import org.json.JSONObject;
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

    @Test
    public void untertitelSpracheBleibtUeberIsoSchreibweisenStabil() {
        assertTrue(DirektSpieler.gleicheUntertitelSprache("de", "deu"));
        assertTrue(DirektSpieler.gleicheUntertitelSprache("ger", "de"));
        assertTrue(DirektSpieler.gleicheUntertitelSprache("en", "eng"));
        assertTrue(DirektSpieler.gleicheUntertitelSprache("ja", "jpn"));
        assertTrue(DirektSpieler.gleicheUntertitelSprache("de-DE", "deu"));
        assertFalse(DirektSpieler.gleicheUntertitelSprache("de", "en"));
        assertFalse(DirektSpieler.gleicheUntertitelSprache("", "de"));
    }

    @Test
    public void externesSegmentGiltNurInnerhalbSeinerHalboffenenGrenzen() throws Exception {
        ArrayList<JSONObject> segmente = new ArrayList<>();
        segmente.add(new JSONObject().put("type", "recap").put("start", 30).put("end", 55));
        segmente.add(new JSONObject().put("type", "intro").put("start", 0).put("end", 0)
            .put("absent", true));

        assertEquals("recap", DirektSpieler.skipSegmentAktiv(segmente, 30, 120).getString("type"));
        assertEquals("recap", DirektSpieler.skipSegmentAktiv(segmente, 54.999, 120).getString("type"));
        assertEquals(null, DirektSpieler.skipSegmentAktiv(segmente, 55, 120));
        assertEquals(null, DirektSpieler.skipSegmentAktiv(segmente, 121, 120));
        assertEquals(null, DirektSpieler.skipSegmentAktiv(segmente, Double.POSITIVE_INFINITY, 120));
    }

    @Test
    public void externeSegmentBeschriftungenBleibenDeutschUndSpezifisch() {
        assertEquals("Intro überspringen", DirektSpieler.skipBeschriftung("intro"));
        assertEquals("Rückblick überspringen", DirektSpieler.skipBeschriftung("recap"));
        assertEquals("Abspann überspringen", DirektSpieler.skipBeschriftung("outro"));
        assertEquals("Vorschau überspringen", DirektSpieler.skipBeschriftung("preview"));
    }

    @Test
    public void unbekannteExterneSegmentartenWerdenNichtAlsIntroAngeboten() throws Exception {
        ArrayList<JSONObject> segmente = new ArrayList<>();
        segmente.add(new JSONObject().put("type", "sponsor").put("start", 10).put("end", 20));
        assertEquals(null, DirektSpieler.skipSegmentAktiv(segmente, 15, 120));
    }

    @Test
    public void skipAbschnitteHabenEindeutigeFarbenAufDerZeitachse() {
        assertEquals(Color.parseColor("#2DD4BF"), DirektSpieler.skipFarbe("intro"));
        assertEquals(Color.parseColor("#FB923C"), DirektSpieler.skipFarbe("recap"));
        assertEquals(Color.parseColor("#A78BFA"), DirektSpieler.skipFarbe("outro"));
        assertEquals(Color.parseColor("#F472B6"), DirektSpieler.skipFarbe("preview"));
        assertEquals(Color.TRANSPARENT, DirektSpieler.skipFarbe("sponsor"));
    }

    @Test
    public void naechsteFolgeKarteBeginntAmVerifiziertenAbspann() throws Exception {
        ArrayList<JSONObject> segmente = new ArrayList<>();
        segmente.add(new JSONObject().put("type", "outro").put("start", 840).put("end", 900));
        assertEquals(840, DirektSpieler.naechsteFolgeAb(segmente, 900, 900, true), 0.001);
    }

    @Test
    public void naechsteFolgeBleibtBeiNeunzigProzentOhnePassendenAbspann() throws Exception {
        ArrayList<JSONObject> segmente = new ArrayList<>();
        segmente.add(new JSONObject().put("type", "outro").put("start", 700).put("end", 0)
            .put("absent", true));
        assertEquals(810, DirektSpieler.naechsteFolgeAb(segmente, 900, 900, true), 0.001);
        assertEquals(810, DirektSpieler.naechsteFolgeAb(segmente, 900, 850, true), 0.001);
        assertEquals(810, DirektSpieler.naechsteFolgeAb(segmente, 900, 900, false), 0.001);
    }

    @Test
    public void folgenSchwelleWecktNurEinmalUndNieWaerendDesCountdowns() {
        assertTrue(DirektSpieler.sollWeiterSchwelleMelden(false, true, 0, true));
        assertFalse(DirektSpieler.sollWeiterSchwelleMelden(true, true, 0, true));
        assertFalse(DirektSpieler.sollWeiterSchwelleMelden(false, false, 0, true));
        assertFalse(DirektSpieler.sollWeiterSchwelleMelden(false, true, 1, true));
        assertFalse(DirektSpieler.sollWeiterSchwelleMelden(false, true, 0, false));
    }
}
