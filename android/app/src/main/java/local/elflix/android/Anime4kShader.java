package local.elflix.android;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Anime4K ohne Android: welche Netze laufen und wie ihre GLSL-ES-3.00-Quellen
 * aussehen. Rein rechnend, damit JVM-Pruefungen es ohne Geraet abdecken.
 *
 * <p>Media3 legt Bilder wie OpenGL ab: Zeile 0 ist unten. Anime4K (mpv) rechnet
 * mit y nach unten, und seine Faltungskerne sind nicht symmetrisch. Die
 * Bindungen hier uebersetzen deshalb jede Koordinate: {@code NAME_pos} und
 * {@code NAME_tex} arbeiten in mpv-Koordinaten, gelesen und geschrieben wird
 * in der Media3-Ablage. Die Hook-Koerper selbst bleiben unveraendert.
 */
final class Anime4kShader {
    private Anime4kShader() {}

    /** HOCH wie Anime4K "Mode A" am Rechner; LEICHT nur ein x2 mit dem kleinen Netz. */
    enum Stufe { HOCH, LEICHT, AUS }

    /** Wie mpvs //!WHEN: nur vergroessern, solange mehr als Faktor 1,2 fehlt. */
    static final double SCHWELLE = 1.2;

    static final String VERTEX = "#version 300 es\n"
        + "in vec4 aPosition;\n"
        + "void main() { gl_Position = aPosition; }\n";

    /**
     * Bilinear auf die feste Ausgabegroesse, ohne Drehung (beide Seiten
     * Media3-Ablage). GLSL ES 1.00, damit das Bild auch in einem ES-2-Kontext
     * oder nach einem Netzfehler weiterlaeuft.
     */
    static final String AUSGABE_VERTEX = "#version 100\n"
        + "attribute vec4 aPosition;\n"
        + "void main() { gl_Position = aPosition; }\n";

    static final String AUSGABE = "#version 100\n"
        + "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n"
        + "uniform sampler2D uBild;\n"
        + "uniform vec2 uGroesse;\n"
        + "void main() { gl_FragColor = vec4(clamp(texture2D(uBild, gl_FragCoord.xy / uGroesse).rgb, 0.0, 1.0), 1.0); }\n";

    /** Wie viele x2-Schritte das Ziel lohnt; 0 heisst: nur weitergeben. */
    static int schritte(int zielBreite, int zielHoehe, int breite, int hoehe, int hoechstens) {
        int anzahl = 0;
        while (anzahl < hoechstens && breite > 0 && hoehe > 0
            && (double) zielBreite / breite > SCHWELLE && (double) zielHoehe / hoehe > SCHWELLE) {
            breite *= 2;
            hoehe *= 2;
            anzahl++;
        }
        return anzahl;
    }

    /** Die Netze in Reihenfolge fuer eine Stufe und hoechstens {@code schritte} Vergroesserungen. */
    static List<Anime4kNetze.Pass[]> netze(Stufe stufe, int schritte) {
        if (stufe == Stufe.AUS) return Collections.emptyList();
        List<Anime4kNetze.Pass[]> liste = new ArrayList<>();
        if (stufe == Stufe.HOCH) {
            liste.add(Anime4kNetze.RESTORE_M);
            if (schritte >= 1) liste.add(Anime4kNetze.UPSCALE_M);
            if (schritte >= 2) liste.add(Anime4kNetze.UPSCALE_S);
        } else if (schritte >= 1) {
            liste.add(Anime4kNetze.UPSCALE_S);
        }
        return liste;
    }

    /** Fragment-Quelle eines mpv-Hooks mit Bindungen in mpv-Koordinaten. */
    static String fragment(Anime4kNetze.Pass pass) {
        StringBuilder text = new StringBuilder("#version 300 es\n"
            + "precision highp float;\n"
            + "precision highp sampler2D;\n"
            + "out vec4 elfixFarbe;\n"
            + "uniform vec2 elfixAusgabe;\n"
            + "#define ELFIX_POS (vec2(gl_FragCoord.x, elfixAusgabe.y - gl_FragCoord.y) / elfixAusgabe)\n");
        for (String name : pass.binds) {
            text.append("uniform sampler2D ").append(name).append("_raw;\n")
                .append("uniform vec2 ").append(name).append("_size;\n")
                .append("#define ").append(name).append("_pos ELFIX_POS\n")
                .append("#define ").append(name).append("_pt (vec2(1.0) / ").append(name).append("_size)\n")
                .append("#define ").append(name).append("_tex(pos) texture(").append(name)
                .append("_raw, vec2((pos).x, 1.0 - (pos).y))\n")
                .append("#define ").append(name).append("_texOff(off) ").append(name).append("_tex(")
                .append(name).append("_pos + ").append(name).append("_pt * (off))\n");
        }
        return text.append(pass.code).append("\nvoid main() { elfixFarbe = hook(); }\n").toString();
    }
}
