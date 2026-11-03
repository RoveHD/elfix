package local.elflix.android;

/**
 * Wohin das Steuerkreuz als naechstes zeigt - als reine Rechnung.
 *
 * <p><b>Der gemeldete Fehler.</b> Rechts am Ende einer Reihe sprang der Fokus
 * in die Reihe darunter, und zwar mitten hinein: auf die siebte Kachel, auf die
 * zwoelfte, auf irgendeine. Das sah nach Zufall aus, war aber folgerichtig. Die
 * Fokussuche von Android schaut sich alle Ziele der ganzen Seite an und nimmt
 * das, was am besten "rechts" liegt. Jede Reihe ist aber ein Schieber: ihre
 * Kacheln liegen vollstaendig nebeneinander, auch die, die gerade nicht zu
 * sehen sind. Die unsichtbare zwoelfte Kachel der naechsten Reihe liegt damit
 * tatsaechlich weit rechts - weiter rechts als alles in der eigenen Reihe. Also
 * gewann sie.
 *
 * <p>Zwei Regeln beheben das, und keine davon ist Geschmackssache:
 *
 * <ol>
 *   <li><b>Links und rechts bleiben in der Reihe.</b> Am Ende ist Ende. Wer die
 *       Reihe wechseln will, drueckt nach unten - dafuer ist die Taste da.
 *   <li><b>Oben und unten halten die Spalte.</b> Wer bei der vierten sichtbaren
 *       Kachel nach unten drueckt, landet unter ihr und nicht am Anfang der
 *       naechsten Reihe. Gemessen wird dafuer die Mitte auf dem Bildschirm und
 *       nicht die Nummer der Kachel: Reihen sind unterschiedlich weit
 *       geschoben, und was zaehlt, ist, was man sieht.
 * </ol>
 *
 * <p>Hier steht nur die Rechnung, damit sie ohne Fernseher pruefbar ist; die
 * Ansichten dazu stehen in {@link Fokusreihe}.
 */
final class Reihenfokus {
    private Reihenfokus() {
    }

    /** Es gibt kein Ziel. */
    static final int KEINES = -1;

    /**
     * Welche Kachel einer Nachbarreihe unter der Mitte des Fokus liegt.
     *
     * @param mitten die Bildschirmmitte jeder Kachel der Nachbarreihe
     * @param mitte  die Bildschirmmitte der Kachel, auf der der Fokus steht
     * @return die Stelle in {@code mitten} oder {@link #KEINES}
     */
    static int spalteBei(int[] mitten, int mitte) {
        int beste = KEINES;
        long abstand = Long.MAX_VALUE;
        for (int i = 0; i < mitten.length; i += 1) {
            long eigen = Math.abs((long) mitten[i] - mitte);
            // Streng kleiner: bei gleichem Abstand gewinnt die linke. Sonst
            // haengt das Ergebnis an der Reihenfolge der Kinder, und dieselbe
            // Taste traefe auf zwei Geraeten verschiedene Kacheln.
            if (eigen < abstand) {
                abstand = eigen;
                beste = i;
            }
        }
        return beste;
    }

    /**
     * Ob im Raster links oder rechts von dieser Zelle noch eine liegt.
     *
     * <p>Das Raster der Entdeckungsseite ist keine Reihe mit Schieber, sondern
     * echte Zeilen und Spalten - dort kommt die Fokussuche von selbst auf das
     * Richtige. Nur an den beiden Kanten nicht: dort wechselte sie die Zeile,
     * und damit sprang der Fokus vom Ende einer Zeile an den Anfang der
     * naechsten. Gewollt ist dasselbe wie in den Reihen - am Rand ist Rand.
     *
     * @param stelle  die Nummer des Eintrags, von 0 an
     * @param spalten wie viele Zellen eine Zeile hat
     * @param anzahl  wie viele Eintraege es insgesamt gibt
     * @param rechts  nach rechts gefragt, sonst nach links
     */
    static boolean amRand(int stelle, int spalten, int anzahl, boolean rechts) {
        if (spalten < 1) return true;
        if (!rechts) return stelle % spalten == 0;
        return stelle % spalten == spalten - 1 || stelle >= anzahl - 1;
    }
}
