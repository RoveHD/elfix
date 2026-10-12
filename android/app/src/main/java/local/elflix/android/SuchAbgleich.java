package local.elflix.android;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Ob ein Treffer zur Suche passt - dieselben Regeln wie am Rechner
 * ({@code matchesQuery}, {@code kernwoerter} in main.js).
 *
 * <p>Gemeldet vom Handy: "Sieben hafen avatar" fand "Avatar - Die sieben
 * Häfen" nicht. Zwei Gruende, beide am Rechner schon behoben: Die Anfrage
 * wird zu "haefen", die Adresse des Anbieters heisst aber "hafen" - beide
 * Seiten werden deshalb gleich gefaltet. Und S.to findet den langen Titel
 * selbst nicht, nur ein einzelnes Wort; gefragt wird dann mit Kernwoertern
 * und selbst nach der ganzen Anfrage gefiltert.
 */
final class SuchAbgleich {
    private SuchAbgleich() {}

    private static final Set<String> FUELL = new HashSet<>(Arrays.asList(
        "the", "a", "an", "der", "die", "das", "den", "dem", "ein", "eine", "and", "und", "of", "von"));

    /** "ae" und "a" gelten gleich (häfen -> haefen -> hafen, wie die Adresse). */
    static String falten(String text) {
        return (text == null ? "" : text).replace("ae", "a").replace("oe", "o").replace("ue", "u").replace("ss", "s");
    }

    /** Gefaltete Suchwoerter; ein Jahr zaehlt nur, wenn sonst nichts bleibt. */
    static List<String> woerter(List<String> tokens) {
        ArrayList<String> gefaltet = new ArrayList<>();
        for (String token : tokens) gefaltet.add(falten(token));
        ArrayList<String> ohneJahr = new ArrayList<>();
        for (String token : gefaltet) if (!token.matches("(?:19|20)\\d\\d")) ohneJahr.add(token);
        return ohneJahr.isEmpty() ? gefaltet : ohneJahr;
    }

    /**
     * @param pfadText   normalisierter Text aus der Adresse des Treffers
     * @param titelText  normalisierter Titel des Treffers
     * @param abspielbar ob die Adresse nach Inhalt aussieht
     */
    static boolean passt(String pfadText, String titelText, List<String> tokens, boolean abspielbar) {
        if (tokens.isEmpty()) return true;
        List<String> woerter = woerter(tokens);
        String pfad = falten(pfadText);
        boolean alle = true;
        for (String wort : woerter) if (!pfad.contains(wort)) { alle = false; break; }
        if (alle) return true;
        String kompakt = String.join("", woerter);
        if (!kompakt.isEmpty() && pfad.replaceAll("\\s+", "").contains(kompakt)) return true;
        String titel = falten(titelText);
        return (titel.equals(String.join(" ", woerter)) || titel.replaceAll("\\s+", "").contains(kompakt)) && abspielbar;
    }

    /** Erstes Wort und laengstes uebriges - leer bei weniger als zwei Woertern. */
    static List<String> kernwoerter(String anfrage) {
        ArrayList<String> woerter = new ArrayList<>();
        for (String wort : (anfrage == null ? "" : anfrage).split("[^\\p{L}\\p{N}]+")) {
            if (wort.length() >= 3 && !FUELL.contains(wort.toLowerCase(Locale.ROOT)) && !wort.matches("\\d+")) woerter.add(wort);
        }
        if (woerter.size() < 2) return new ArrayList<>();
        String laengstes = woerter.get(1);
        for (String wort : woerter.subList(1, woerter.size())) if (wort.length() > laengstes.length()) laengstes = wort;
        ArrayList<String> ergebnis = new ArrayList<>();
        ergebnis.add(woerter.get(0));
        ergebnis.add(laengstes);
        return ergebnis;
    }

    /** "Titel (2026)" -> "Titel"; sonst unveraendert. */
    static String ohneJahr(String anfrage) {
        return (anfrage == null ? "" : anfrage).replaceAll("\\s*[(\\[]\\s*(?:19|20)\\d\\d\\s*[)\\]]\\s*$", "").trim();
    }

    /** "häfen" -> "hafen": so schreiben S.to und AniWorld ihre Adressen. */
    static String ohneUmlautE(String anfrage) {
        return (anfrage == null ? "" : anfrage).toLowerCase(Locale.GERMAN)
            .replace("ä", "a").replace("ö", "o").replace("ü", "u").replace("ß", "ss");
    }
}
