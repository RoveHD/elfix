package local.elflix.android;

/**
 * Berechnet das kleine, gerade benoetigte Fenster eines langen Entdeckungsrasters.
 *
 * <p>Die Datenliste bleibt vollstaendig, damit Nachladen und die Rueckkehr an dieselbe
 * Stelle unveraendert funktionieren. Im View-Baum stehen aber nur die Zeilen um den
 * sichtbaren Bereich. Die beiden Platzhalter davor und dahinter halten die Scrollhoehe.
 */
final class EntdeckungsFenster {
    private EntdeckungsFenster() { }

    static final class Bereich {
        final int von;
        final int bis;

        Bereich(int von, int bis) {
            this.von = von;
            this.bis = bis;
        }

        int anzahl() {
            return Math.max(0, bis - von);
        }
    }

    static Bereich umSichtbareZeilen(int zeilen, int ersteSichtbar, int letzteSichtbar,
                                     int vorlauf, int hoechstens) {
        if (zeilen <= 0) return new Bereich(0, 0);
        int erste = Math.max(0, Math.min(ersteSichtbar, zeilen - 1));
        int letzte = Math.max(erste, Math.min(letzteSichtbar, zeilen - 1));
        int von = Math.max(0, erste - Math.max(0, vorlauf));
        int bis = Math.min(zeilen, letzte + Math.max(0, vorlauf) + 1);
        int grenze = Math.max(1, hoechstens);
        if (bis - von <= grenze) return new Bereich(von, bis);

        // Der sichtbare Bereich bleibt immer erhalten. Den Rest verteilen wir
        // moeglichst gleichmaessig davor und dahinter, damit Zurueck- und
        // Vorwaertsscrollen gleich reagieren.
        int sichtbar = letzte - erste + 1;
        if (sichtbar >= grenze) return new Bereich(erste, letzte + 1);
        int frei = grenze - sichtbar;
        int davor = Math.min(frei / 2, erste);
        int danach = frei - davor;
        if (letzte + danach >= zeilen) {
            danach = zeilen - letzte - 1;
            davor = Math.min(frei - danach, erste);
        }
        return new Bereich(erste - davor, letzte + danach + 1);
    }
}
