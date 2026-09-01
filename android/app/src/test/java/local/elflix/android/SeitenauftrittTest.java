package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * Der Seitenübergang darf kein leeres Bild erzeugen.
 *
 * <h2>Warum das eine Prüfung ist und keine Notiz</h2>
 *
 * <p>Derselbe Fehler ist dreimal gemeldet worden: „die App zuckt beim
 * Starten", „die App zuckt beim Navigieren", „es zuckt immer noch". Die
 * Ursache war jedes Mal dieselbe Zeile - {@code setAlpha(0f)} auf einer
 * fertigen Seite, gefolgt von einer Bewegung, die erst im nächsten Durchlauf
 * des Hauptfadens anfängt. Zwischen beidem liegt mindestens ein gezeichnetes
 * Bild, und in dem ist die Seite unsichtbar: Kopf- und Fußleiste stehen, die
 * Mitte ist leer.
 *
 * <p>Zweimal wurde nur der jeweilige Auslöser behoben - einmal der Start,
 * einmal ein Vergleich. Die Zeile blieb stehen, und beim nächsten Weg dorthin
 * war der Fehler wieder da. Deshalb steht die Regel jetzt hier: <em>kein
 * Auftritt einer ganzen Seite fängt bei Deckkraft null an.</em>
 *
 * <p>Ein Test am Quelltext ist ungewöhnlich, und er ist hier trotzdem das
 * richtige Mittel: was geprüft werden muss, ist der Zustand im
 * <em>ersten</em> gezeichneten Bild, und den bekommt eine Prüfung ohne
 * laufendes Android nicht zu sehen. Die Zeile dagegen ist eindeutig, sie steht
 * an genau zwei Stellen, und wer sie wieder hinschreibt, soll es hier merken
 * und nicht auf dem Gerät.
 */
public class SeitenauftrittTest {

    /**
     * Der Quelltext von {@code Bewegung}.
     *
     * <p>Der Weg hängt davon ab, von wo aus geprüft wird - Gradle steht im
     * Modul, ein Aufruf von Hand in der Wurzel. Beide Wege werden versucht;
     * wird die Datei gar nicht gefunden, ist das ein Fehlschlag und kein
     * stilles Übergehen: eine Prüfung, die sich selbst abschaltet, prüft
     * nichts.
     */
    private static String quelltext(String klasse) throws Exception {
        String[] wege = {
            "src/main/java/local/elflix/android/" + klasse + ".java",
            "android/app/src/main/java/local/elflix/android/" + klasse + ".java",
            "app/src/main/java/local/elflix/android/" + klasse + ".java",
            "../app/src/main/java/local/elflix/android/" + klasse + ".java",
        };
        for (String weg : wege) {
            File datei = new File(weg);
            if (datei.isFile()) return new String(Files.readAllBytes(datei.toPath()), StandardCharsets.UTF_8);
        }
        throw new AssertionError(klasse + ".java nicht gefunden, gesucht ab "
            + new File(".").getAbsolutePath());
    }

    /**
     * Den Quelltext ohne seine Erklaerungen.
     *
     * <p>Ohne diesen Schritt schlaegt die Pruefung an ihrer eigenen
     * Begruendung an: in {@code seitenAuftritt} steht ausdruecklich, was dort
     * <em>frueher</em> stand - {@code setAlpha(0f)} und ein {@code post(...)} -,
     * und ein Vergleich am rohen Text findet beides wieder. Geprueft gehoert,
     * was ausgefuehrt wird, nicht was dazu geschrieben steht.
     */
    private static String ohneErklaerungen(String quelle) {
        StringBuilder klar = new StringBuilder(quelle.length());
        int i = 0;
        while (i < quelle.length()) {
            if (quelle.startsWith("//", i)) {
                int ende = quelle.indexOf('\n', i);
                i = ende < 0 ? quelle.length() : ende;
                continue;
            }
            if (quelle.startsWith("/*", i)) {
                int ende = quelle.indexOf("*/", i + 2);
                i = ende < 0 ? quelle.length() : ende + 2;
                continue;
            }
            // Zeichenketten bleiben stehen, aber ihr Inhalt zaehlt nicht als
            // Klammer - sonst verrutscht die Zaehlung in rumpf().
            if (quelle.charAt(i) == '"') {
                int j = i + 1;
                while (j < quelle.length() && quelle.charAt(j) != '"') {
                    if (quelle.charAt(j) == '\\') j += 1;
                    j += 1;
                }
                klar.append("\"\"");
                i = j + 1;
                continue;
            }
            klar.append(quelle.charAt(i));
            i += 1;
        }
        return klar.toString();
    }

    /** Der Rumpf einer Methode - von ihrer Signatur bis zur schliessenden Klammer. */
    private static String rumpf(String quelle, String signatur) {
        int anfang = quelle.indexOf(signatur);
        assertTrue("Methode nicht gefunden: " + signatur, anfang >= 0);
        int klammer = quelle.indexOf('{', anfang);
        int tiefe = 0;
        for (int i = klammer; i < quelle.length(); i += 1) {
            char zeichen = quelle.charAt(i);
            if (zeichen == '{') tiefe += 1;
            else if (zeichen == '}') {
                tiefe -= 1;
                if (tiefe == 0) return quelle.substring(klammer, i + 1);
            }
        }
        throw new AssertionError("Methode nicht abgeschlossen: " + signatur);
    }

    /**
     * Der Auftritt einer Seite setzt keine Deckkraft auf null.
     *
     * <p>Was übrig bleiben darf, ist der Weg: eine Verschiebung ist im ersten
     * Bild zu sehen, eine Deckkraft von null ist es nicht.
     */
    @Test
    public void seitenauftrittFaengtNichtDurchsichtigAn() throws Exception {
        String rumpf = rumpf(ohneErklaerungen(quelltext("Bewegung")),
            "public static void seitenAuftritt(final View seite, final boolean rueckwaerts)");
        assertFalse("seitenAuftritt setzt wieder alpha 0 - das ist genau der leere Frame",
            rumpf.contains("setAlpha(0f)"));
        assertFalse("seitenAuftritt animiert wieder die Deckkraft herauf",
            rumpf.contains(".alpha(1f)"));
    }

    /**
     * Und er schiebt die Bewegung nicht in den nächsten Durchlauf.
     *
     * <p>Ein {@code post()} war nötig, solange der Weg aus der Breite der
     * Ansicht gerechnet wurde - die steht erst nach dem Vermessen fest. Er
     * ist jetzt ein festes Maß in dp, und dp braucht keine Messung.
     */
    @Test
    public void seitenauftrittWartetNichtAufDenNaechstenDurchlauf() throws Exception {
        String rumpf = rumpf(ohneErklaerungen(quelltext("Bewegung")),
            "public static void seitenAuftritt(final View seite, final boolean rueckwaerts)");
        assertFalse("seitenAuftritt wartet wieder auf den naechsten Durchlauf",
            rumpf.contains("post("));
    }

    /** Dasselbe für die Detailseite, die aus ihrer Karte herauswächst. */
    @Test
    public void zoomauftrittFaengtNichtDurchsichtigAn() throws Exception {
        String rumpf = rumpf(ohneErklaerungen(quelltext("Bewegung")), "public static void zoomAuftritt(final View seite)");
        assertFalse("zoomAuftritt setzt wieder alpha 0", rumpf.contains("setAlpha(0f)"));
        assertFalse("zoomAuftritt animiert wieder die Deckkraft herauf", rumpf.contains(".alpha(1f)"));
        assertFalse("zoomAuftritt wartet wieder auf den naechsten Durchlauf", rumpf.contains("post("));
    }

    /**
     * Die Einstellungsseite wird nicht mehr weggeworfen.
     *
     * <p>Zwei Zeilen genügten für den Fehler: {@code content.removeAllViews()}
     * in {@code showSettings}, und ein Weg dorthin bei jedem Handgriff. Was
     * hier geprüft wird, ist der zweite Teil - dass kein Auffrischen der
     * Einstellungen die Seite noch einmal zeichnen lässt.
     */
    @Test
    public void einstellungenWerdenFortgeschriebenUndNichtNeuGebaut() throws Exception {
        String quelle = ohneErklaerungen(quelltext("MainActivity"));
        assertFalse("settingsNeuZeichnen ist zurueck - das war der Full-Rebuild",
            quelle.contains("settingsNeuZeichnen"));
        String rumpf = rumpf(quelle, "private void einstellungenAuffrischen()");
        assertFalse("Auffrischen wirft die Seite wieder weg", rumpf.contains("removeAllViews"));
        assertFalse("Auffrischen zeichnet die Seite wieder", rumpf.contains("showSettings"));
        assertFalse("Auffrischen stellt wieder eine Scrollposition her",
            rumpf.contains("scrollStandHerstellen"));
    }

    /**
     * Und der Weg auf die Einstellungen baut sie höchstens einmal.
     *
     * <p>{@code showSettings} darf den Inhaltsrahmen weiter leeren - es ist
     * ein Seitenwechsel. Was es nicht mehr darf, ist die Seite dabei jedes Mal
     * neu aufbauen; deshalb geht es über {@code einstellungenEinhaengen}.
     */
    @Test
    public void einstellungenWerdenWiederEingehaengtStattNeuGebaut() throws Exception {
        String quelle = ohneErklaerungen(quelltext("MainActivity"));
        String rumpf = rumpf(quelle, "private void einstellungenEinhaengen()");
        assertTrue("Die gebaute Seite wird nicht wiederverwendet",
            rumpf.contains("einstellungenScroll == null"));
        assertTrue("Die gebaute Seite wird nicht wieder eingehaengt",
            rumpf.contains("content.addView(einstellungenScroll"));
        // Gebaut wird nur im einen Zweig - hoechstens ein Aufruf je Seite.
        assertEquals(1, zaehlen(rumpf, "renderMobileSettings()"));
        assertEquals(1, zaehlen(rumpf, "renderTvSettings()"));
    }

    private static int zaehlen(String text, String was) {
        int anzahl = 0;
        for (int i = text.indexOf(was); i >= 0; i = text.indexOf(was, i + was.length())) anzahl += 1;
        return anzahl;
    }
}
