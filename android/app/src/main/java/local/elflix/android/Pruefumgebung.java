package local.elflix.android;

/**
 * Was der Prüfstand aus der laufenden App braucht.
 *
 * <p>Diese Schnittstelle steht im Hauptquellsatz, obwohl nur der Debug-Bau sie
 * benutzt - und zwar aus einem Grund: {@link Pruefstand} gibt es zweimal, im
 * Debug-Bau mit Empfänger und im Release als leerer Rumpf. Beide müssen
 * dieselbe Signatur tragen, sonst übersetzt {@code MainActivity} nur in einer
 * Variante. Die Schnittstelle zweimal hinzuschreiben wäre genau die Art
 * Doppelung, die hier sonst überall vermieden wird.
 *
 * <p>Sie beschreibt nichts, was es nicht ohnehin gäbe: ein Anbieter, der Weg in
 * die Messung, die Ablage und ein Neuzeichnen. Im Release hängt an ihr nichts.
 */
public interface Pruefumgebung {
    /** Der Anbieter zu dieser Kennung, oder {@code null}. */
    Provider anbieter(String id);

    /** Der Fühler - dort werden die vorgegebenen Werte eingespeist. */
    Messung messung();

    /** Die Ablage - für den Zustandsbericht. */
    Bestand bestand();

    /** Die gemessene Zeit - für den Zustandsbericht. */
    Statistik statistik();

    /** Die Sicherung - um sie am Geraet ausloesen zu koennen. */
    Sicherung sicherung();

    /** Den gerade offenen Bildschirm neu bauen. */
    void neuZeichnen();

    /**
     * Eine Serie oeffnen, so wie es ein Suchtreffer taete.
     *
     * <p>Nur fuer die Pruefung am Geraet. Eine Serie ueber die Oberflaeche zu
     * oeffnen heisst auf einem Fernseher: mit dem Steuerkreuz in die Suche,
     * einen Titel eintippen, den Treffer finden - und die Tastatur des Fire TV
     * verschluckt dabei Leerzeichen. Das ist keine Pruefung mehr, das ist ein
     * Geduldsspiel mit ungewissem Ausgang. Ueber diesen Weg steht in einer
     * Zeile fest, welche Adresse geoeffnet wird.
     */
    void serieOeffnen(Provider anbieter, String url, String titel);
}
