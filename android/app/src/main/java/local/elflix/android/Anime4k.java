package local.elflix.android;

import android.content.Context;
import android.opengl.GLES20;
import android.util.Log;
import androidx.media3.common.VideoFrameProcessingException;
import androidx.media3.common.util.GlProgram;
import androidx.media3.common.util.GlUtil;
import androidx.media3.common.util.Size;
import androidx.media3.effect.BaseGlShaderProgram;
import androidx.media3.effect.GlEffect;
import androidx.media3.effect.GlShaderProgram;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Anime4K im eigenen Player: ein Media3-Videoeffekt vor der Anzeige.
 *
 * <p>Die Ausgabegroesse steht fest, sobald die Quellgroesse bekannt ist
 * (Quelle mal 2 hoch Schritte, passend zum Bildschirm). Die Stufe dagegen
 * wird bei jedem Bild gelesen: wird ein Geraet zu langsam, schaltet der Player
 * auf LEICHT oder AUS, ohne die Wiedergabe neu aufzubauen. AUS rechnet nur
 * noch bilinear auf die feste Groesse. Der Rest der Kette (Media3) skaliert
 * das Ergebnis auf die Flaeche des Players.
 */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class Anime4k {
    private static final String TAG = "ElfixAnime4k";
    private static final Pattern ANIME = Pattern.compile("(?i)^/anime/stream/.*");

    private Anime4k() {}

    /** Dieselbe Regel wie am Rechner und bei der Filler-Liste. */
    static boolean istAnime(String adresse) {
        if (adresse == null) return false;
        try {
            String pfad = new java.net.URI(adresse).getPath();
            return pfad != null && ANIME.matcher(pfad).matches();
        } catch (Exception ungueltig) {
            return false;
        }
    }

    static final class Effekt implements GlEffect {
        private final int zielBreite;
        private final int zielHoehe;
        private final Anime4kShader.Stufe start;
        private volatile Anime4kShader.Stufe stufe;
        /** Faellt ein Netz aus (kein ES 3, keine Float-Ziele), bleibt es aus. */
        private volatile boolean unmoeglich;

        Effekt(Anime4kShader.Stufe stufe, int zielBreite, int zielHoehe) {
            this.start = stufe;
            this.stufe = stufe;
            this.zielBreite = zielBreite;
            this.zielHoehe = zielHoehe;
        }

        Anime4kShader.Stufe stufe() { return unmoeglich ? Anime4kShader.Stufe.AUS : stufe; }

        void stufe(Anime4kShader.Stufe neu) { stufe = neu; }

        boolean unmoeglich() { return unmoeglich; }

        @Override
        public GlShaderProgram toGlShaderProgram(Context context, boolean useHdr) {
            return new Programm(this, useHdr);
        }
    }

    private static final class Ziel {
        final int textur;
        final int fbo;
        final int breite;
        final int hoehe;

        Ziel(int textur, int fbo, int breite, int hoehe) {
            this.textur = textur;
            this.fbo = fbo;
            this.breite = breite;
            this.hoehe = hoehe;
        }
    }

    private static final class Programm extends BaseGlShaderProgram {
        private final Effekt effekt;
        private final boolean hdr;
        private final Map<Anime4kNetze.Pass, GlProgram> netzProgramme = new HashMap<>();
        private final Map<String, Ziel> ziele = new HashMap<>();
        private GlProgram ausgabe;
        private boolean vorbereitet;
        private int breite;
        private int hoehe;
        private int schritte;

        Programm(Effekt effekt, boolean hdr) {
            super(/* useHighPrecisionColorComponents= */ hdr, /* texturePoolCapacity= */ 1);
            this.effekt = effekt;
            this.hdr = hdr;
        }

        @Override
        public Size configure(int inputWidth, int inputHeight) {
            breite = inputWidth;
            hoehe = inputHeight;
            // HDR bleibt unangetastet: die Netze sind auf SDR-Werte trainiert.
            int hoechstens = hdr ? 0 : effekt.start == Anime4kShader.Stufe.HOCH ? 2
                : effekt.start == Anime4kShader.Stufe.LEICHT ? 1 : 0;
            schritte = Anime4kShader.schritte(effekt.zielBreite, effekt.zielHoehe,
                inputWidth, inputHeight, hoechstens);
            return new Size(inputWidth << schritte, inputHeight << schritte);
        }

        private void vorbereiten() throws GlUtil.GlException {
            vorbereitet = true;
            ausgabe = new GlProgram(Anime4kShader.AUSGABE_VERTEX, Anime4kShader.AUSGABE);
            String erweiterungen = String.valueOf(GLES20.glGetString(GLES20.GL_EXTENSIONS));
            String fassung = String.valueOf(GLES20.glGetString(GLES20.GL_VERSION));
            boolean floatZiel = erweiterungen.contains("GL_EXT_color_buffer_half_float")
                || erweiterungen.contains("GL_EXT_color_buffer_float")
                || fassung.contains("OpenGL ES 3.2");
            if (hdr || GlUtil.getContextMajorVersion() < 3 || !floatZiel) {
                Log.i(TAG, "Anime4K nicht moeglich: " + fassung + ", hdr=" + hdr);
                effekt.unmoeglich = true;
            }
        }

        private GlProgram programm(Anime4kNetze.Pass pass) throws GlUtil.GlException {
            GlProgram programm = netzProgramme.get(pass);
            if (programm == null) {
                programm = new GlProgram(Anime4kShader.VERTEX, Anime4kShader.fragment(pass));
                netzProgramme.put(pass, programm);
            }
            return programm;
        }

        private Ziel ziel(String schluessel, int zielBreite, int zielHoehe) throws GlUtil.GlException {
            Ziel ziel = ziele.get(schluessel);
            if (ziel != null && ziel.breite == zielBreite && ziel.hoehe == zielHoehe) return ziel;
            if (ziel != null) {
                GlUtil.deleteFbo(ziel.fbo);
                GlUtil.deleteTexture(ziel.textur);
            }
            // RGBA16F: die Faltungszwischenwerte sind vorzeichenbehaftet.
            int textur = GlUtil.createTexture(zielBreite, zielHoehe, /* useHighPrecisionColorComponents= */ true);
            ziel = new Ziel(textur, GlUtil.createFboForTexture(textur), zielBreite, zielHoehe);
            ziele.put(schluessel, ziel);
            return ziel;
        }

        private Ziel netz(int nummer, Anime4kNetze.Pass[] netz, Ziel main) throws GlUtil.GlException {
            Map<String, Ziel> texturen = new HashMap<>();
            texturen.put("MAIN", main);
            for (Anime4kNetze.Pass pass : netz) {
                Ziel bezug = texturen.get(pass.bezug);
                Ziel aus = ziel(nummer + ":" + pass.save, bezug.breite * pass.faktor, bezug.hoehe * pass.faktor);
                GlUtil.focusFramebufferUsingCurrentContext(aus.fbo, aus.breite, aus.hoehe);
                GlProgram programm = programm(pass);
                programm.use();
                for (int i = 0; i < pass.binds.length; i++) {
                    Ziel eingang = texturen.get(pass.binds[i]);
                    programm.setSamplerTexIdUniform(pass.binds[i] + "_raw", eingang.textur, i);
                    programm.setFloatsUniformIfPresent(pass.binds[i] + "_size",
                        new float[] {eingang.breite, eingang.hoehe});
                }
                programm.setFloatsUniform("elfixAusgabe", new float[] {aus.breite, aus.hoehe});
                programm.setBufferAttribute("aPosition", GlUtil.getNormalizedCoordinateBounds(), 4);
                programm.bindAttributesAndUniforms();
                GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
                GlUtil.checkGlError();
                texturen.put(pass.save, aus);
            }
            return texturen.get("MAIN");
        }

        @Override
        public void drawFrame(int inputTexId, long presentationTimeUs) throws VideoFrameProcessingException {
            int[] ausgabeFbo = new int[1];
            GLES20.glGetIntegerv(GLES20.GL_FRAMEBUFFER_BINDING, ausgabeFbo, 0);
            int ausBreite = breite << schritte;
            int ausHoehe = hoehe << schritte;
            try {
                if (!vorbereitet) vorbereiten();
                Ziel main = new Ziel(inputTexId, 0, breite, hoehe);
                Anime4kShader.Stufe stufe = effekt.stufe();
                if (stufe != Anime4kShader.Stufe.AUS) {
                    try {
                        List<Anime4kNetze.Pass[]> netze = Anime4kShader.netze(stufe, schritte);
                        for (int i = 0; i < netze.size(); i++) main = netz(i, netze.get(i), main);
                    } catch (GlUtil.GlException fehler) {
                        // Ein Treiber, der ein Netz nicht uebersetzt oder nicht
                        // in Float-Texturen zeichnet, bekommt das Originalbild.
                        Log.w(TAG, "Anime4K abgeschaltet", fehler);
                        effekt.unmoeglich = true;
                        main = new Ziel(inputTexId, 0, breite, hoehe);
                    }
                }
                GlUtil.focusFramebufferUsingCurrentContext(ausgabeFbo[0], ausBreite, ausHoehe);
                ausgabe.use();
                ausgabe.setSamplerTexIdUniform("uBild", main.textur, 0);
                ausgabe.setFloatsUniform("uGroesse", new float[] {ausBreite, ausHoehe});
                ausgabe.setBufferAttribute("aPosition", GlUtil.getNormalizedCoordinateBounds(), 4);
                ausgabe.bindAttributesAndUniforms();
                GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
                GlUtil.checkGlError();
            } catch (GlUtil.GlException fehler) {
                throw new VideoFrameProcessingException(fehler, presentationTimeUs);
            }
        }

        @Override
        public void release() throws VideoFrameProcessingException {
            super.release();
            try {
                for (GlProgram programm : netzProgramme.values()) programm.delete();
                netzProgramme.clear();
                for (Ziel ziel : ziele.values()) {
                    GlUtil.deleteFbo(ziel.fbo);
                    GlUtil.deleteTexture(ziel.textur);
                }
                ziele.clear();
                if (ausgabe != null) ausgabe.delete();
            } catch (GlUtil.GlException fehler) {
                throw new VideoFrameProcessingException(fehler);
            }
        }
    }
}
