package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import android.content.SharedPreferences;
import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.Test;

/** Stufenplanung, Anime-Erkennung und Shader-Bindungen ohne GPU. */
public class Anime4kTest {
    @Test public void schritteFolgenDerMpvSchwelle() {
        // 720p auf ein 1080p-Telefon: einmal x2, danach skaliert Media3 herunter.
        assertEquals(1, Anime4kShader.schritte(1920, 1080, 1280, 720, 2));
        assertEquals(2, Anime4kShader.schritte(2560, 1440, 640, 360, 2));
        assertEquals("Hoechstens so viele Schritte wie die Stufe erlaubt",
            1, Anime4kShader.schritte(2560, 1440, 640, 360, 1));
        assertEquals("1080p auf 1080p lohnt nichts", 0, Anime4kShader.schritte(1920, 1080, 1920, 1080, 2));
        assertEquals("Faktor 1,2 genau reicht nicht", 0, Anime4kShader.schritte(2304, 1296, 1920, 1080, 2));
        assertEquals(0, Anime4kShader.schritte(1920, 1080, 0, 0, 2));
    }

    @Test public void netzeJeStufe() {
        List<Anime4kNetze.Pass[]> hoch = Anime4kShader.netze(Anime4kShader.Stufe.HOCH, 2);
        assertEquals(3, hoch.size());
        assertSame(Anime4kNetze.RESTORE_M, hoch.get(0));
        assertSame(Anime4kNetze.UPSCALE_M, hoch.get(1));
        assertSame(Anime4kNetze.UPSCALE_S, hoch.get(2));
        assertEquals("Ohne Vergroesserung bleibt nur die Bereinigung",
            1, Anime4kShader.netze(Anime4kShader.Stufe.HOCH, 0).size());
        List<Anime4kNetze.Pass[]> leicht = Anime4kShader.netze(Anime4kShader.Stufe.LEICHT, 2);
        assertEquals(1, leicht.size());
        assertSame(Anime4kNetze.UPSCALE_S, leicht.get(0));
        assertTrue(Anime4kShader.netze(Anime4kShader.Stufe.LEICHT, 0).isEmpty());
        assertTrue(Anime4kShader.netze(Anime4kShader.Stufe.AUS, 2).isEmpty());
    }

    @Test public void generierteNetzeSindVollstaendig() {
        assertEquals(8, Anime4kNetze.RESTORE_M.length);
        assertEquals(9, Anime4kNetze.UPSCALE_M.length);
        assertEquals(5, Anime4kNetze.UPSCALE_S.length);
        for (Anime4kNetze.Pass[] netz : new Anime4kNetze.Pass[][] {
            Anime4kNetze.RESTORE_M, Anime4kNetze.UPSCALE_M, Anime4kNetze.UPSCALE_S}) {
            assertEquals("Jedes Netz endet mit einem neuen MAIN", "MAIN", netz[netz.length - 1].save);
            for (Anime4kNetze.Pass pass : netz) assertTrue(pass.code.contains("vec4 hook()"));
        }
        assertEquals("Tiefe-zu-Raum verdoppelt", 2, Anime4kNetze.UPSCALE_S[4].faktor);
    }

    @Test public void bindungenRechnenInMpvKoordinaten() {
        String quelle = Anime4kShader.fragment(Anime4kNetze.UPSCALE_S[4]);
        assertTrue(quelle.startsWith("#version 300 es\n"));
        // Media3 legt Zeile 0 unten ab, mpv zaehlt y nach unten.
        assertTrue(quelle.contains("#define ELFIX_POS (vec2(gl_FragCoord.x, elfixAusgabe.y - gl_FragCoord.y) / elfixAusgabe)"));
        assertTrue(quelle.contains("#define conv2d_last_tf_tex(pos) texture(conv2d_last_tf_raw, vec2((pos).x, 1.0 - (pos).y))"));
        assertTrue(quelle.contains("uniform sampler2D MAIN_raw;"));
        assertTrue(quelle.endsWith("void main() { elfixFarbe = hook(); }\n"));
        assertTrue(Anime4kShader.AUSGABE.startsWith("#version 100\n"));
    }

    @Test public void animeNachSeitenadresse() {
        assertTrue(Anime4k.istAnime("https://aniworld.to/anime/stream/frieren/staffel-1/episode-3"));
        assertTrue(Anime4k.istAnime("https://aniworld.to/ANIME/stream/one-piece"));
        assertFalse(Anime4k.istAnime("https://s.to/serie/stream/dark/staffel-1/episode-1"));
        assertFalse(Anime4k.istAnime("https://example.org/filme/anime/stream"));
        assertFalse(Anime4k.istAnime(null));
        assertFalse(Anime4k.istAnime("kein url ::"));
    }

    @Test public void automatischBeginntJeGeraetUndMerktRueckstufung() {
        Map<String, String> werte = new HashMap<>();
        SharedPreferences einstellungen = einstellungen(werte);
        assertEquals(Anime4kShader.Stufe.HOCH, DirektSpieler.anime4kStufe(einstellungen, false));
        assertEquals(Anime4kShader.Stufe.LEICHT, DirektSpieler.anime4kStufe(einstellungen, true));
        werte.put("anime4k_auto", "leicht");
        assertEquals(Anime4kShader.Stufe.LEICHT, DirektSpieler.anime4kStufe(einstellungen, false));
        werte.put("anime4k_auto", "aus");
        assertEquals(Anime4kShader.Stufe.AUS, DirektSpieler.anime4kStufe(einstellungen, false));
        werte.put("anime4k", "hoch");
        assertEquals("Eine feste Wahl gilt ueber der Messung", Anime4kShader.Stufe.HOCH,
            DirektSpieler.anime4kStufe(einstellungen, true));
        werte.put("anime4k", "aus");
        assertEquals(Anime4kShader.Stufe.AUS, DirektSpieler.anime4kStufe(einstellungen, false));
    }

    @Test public void schalterImPlayerRechnetMitEinerEchtenStufe() {
        Map<String, String> werte = new HashMap<>();
        SharedPreferences einstellungen = einstellungen(werte);
        assertEquals(Anime4kShader.Stufe.HOCH, DirektSpieler.anime4kStufeAn(einstellungen, false));
        assertEquals(Anime4kShader.Stufe.LEICHT, DirektSpieler.anime4kStufeAn(einstellungen, true));
        werte.put("anime4k", "aus");
        assertEquals("Ausgeschaltet bleibt die Stufe fuer das Wiedereinschalten bekannt",
            Anime4kShader.Stufe.HOCH, DirektSpieler.anime4kStufeAn(einstellungen, false));
        werte.put("anime4k_auto", "aus");
        assertEquals("Nach einer Rueckstufung auf aus versucht Einschalten die leichte Stufe",
            Anime4kShader.Stufe.LEICHT, DirektSpieler.anime4kStufeAn(einstellungen, false));
        werte.put("anime4k", "hoch");
        assertEquals(Anime4kShader.Stufe.HOCH, DirektSpieler.anime4kStufeAn(einstellungen, true));
    }

    private static SharedPreferences einstellungen(Map<String, String> werte) {
        return (SharedPreferences) Proxy.newProxyInstance(Anime4kTest.class.getClassLoader(),
            new Class<?>[] {SharedPreferences.class}, (proxy, methode, argumente) -> {
                if (methode.getName().equals("getString")) {
                    String wert = werte.get((String) argumente[0]);
                    return wert == null ? argumente[1] : wert;
                }
                throw new UnsupportedOperationException(methode.getName());
            });
    }
}
