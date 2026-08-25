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

    /** Den gerade offenen Bildschirm neu bauen. */
    void neuZeichnen();
}
