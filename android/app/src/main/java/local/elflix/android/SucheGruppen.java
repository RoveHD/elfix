package local.elflix.android;

import java.net.URI;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Das gemeinsame Anzeigemodell der nativen Suche.
 *
 * <p>Die Regeln entsprechen {@code shared/search-grouping.js}: nur Quellen
 * desselben Werkes werden zusammengefasst. Die Klasse kennt keine Netzwerk-
 * oder Android-APIs und bleibt dadurch auch als JVM-Test pruefbar.
 */
final class SucheGruppen {
    interface Adapter<T> {
        String titel(T wert);
        String url(T wert);
        String anbieter(T wert);
        String jahr(T wert);
        String art(T wert);
        String staffel(T wert);
        String folge(T wert);
        String konfidenz(T wert);
        Map<String, String> externeIds(T wert);
    }

    static final class Gruppe<T> {
        final List<T> treffer = new ArrayList<>();
        final String schluessel;

        Gruppe(String schluessel) {
            this.schluessel = schluessel;
        }
    }

    private SucheGruppen() { }

    static <T> List<Gruppe<T>> gruppieren(List<T> werte, Adapter<T> adapter) {
        List<Gruppe<T>> gruppen = new ArrayList<>();
        Map<String, Gruppe<T>> nachSchluessel = new LinkedHashMap<>();
        for (T wert : werte == null ? new ArrayList<T>() : werte) {
            String schluessel = schluessel(wert, adapter);
            Gruppe<T> gruppe = schluessel.isEmpty() ? null : nachSchluessel.get(schluessel);
            if (gruppe == null) {
                gruppe = new Gruppe<>(schluessel.isEmpty() ? "einzeln:" + gruppen.size() : schluessel);
                gruppen.add(gruppe);
                if (!schluessel.isEmpty()) nachSchluessel.put(schluessel, gruppe);
            }
            gruppe.treffer.add(wert);
        }
        return gruppen;
    }

    private static <T> String schluessel(T wert, Adapter<T> adapter) {
        String titel = normalerTitel(adapter.titel(wert));
        if (titel.isEmpty() || istYoutube(adapter.anbieter(wert), adapter.url(wert))) return "";
        String identitaet = identitaet(wert, adapter);
        String basis = identitaet.isEmpty() ? "titel:" + titel : "id:" + identitaet;
        // Auch eine bestaetigte ID darf weder Medienart noch Staffel/Folge
        // verschlucken: diese Werte beschreiben unterschiedliche Abspielziele.
        return basis + "|year:" + text(adapter.jahr(wert))
            + "|type:" + text(adapter.art(wert))
            + "|season:" + text(adapter.staffel(wert))
            + "|episode:" + text(adapter.folge(wert));
    }

    private static <T> String identitaet(T wert, Adapter<T> adapter) {
        String confidence = text(adapter.konfidenz(wert)).toUpperCase(Locale.ROOT);
        if (!("EXACT".equals(confidence) || "HIGH".equals(confidence) || "CONFIRMED".equals(confidence))) return "";
        Map<String, String> ids = adapter.externeIds(wert);
        if (ids == null) return "";
        for (String namespace : new String[] { "tmdb", "anilist", "imdb" }) {
            String id = text(ids.get(namespace));
            if (!id.isEmpty()) return namespace + ":" + id;
        }
        return "";
    }

    private static boolean istYoutube(String anbieter, String adresse) {
        if (text(anbieter).toLowerCase(Locale.ROOT).contains("youtube")) return true;
        try {
            String host = new URI(text(adresse)).getHost();
            if (host == null) return false;
            host = host.toLowerCase(Locale.ROOT);
            return host.equals("youtu.be") || host.endsWith(".youtu.be")
                || host.equals("youtube.com") || host.endsWith(".youtube.com")
                || host.equals("youtube-nocookie.com") || host.endsWith(".youtube-nocookie.com");
        } catch (Exception ignored) {
            return false;
        }
    }

    private static String normalerTitel(String wert) {
        String ohneAkzente = Normalizer.normalize(text(wert), Normalizer.Form.NFD)
            .replaceAll("\\p{M}+", "");
        return ohneAkzente.toLowerCase(Locale.GERMAN)
            .replaceAll("[’'`]", "")
            .replaceAll("[^a-z0-9]+", " ").trim();
    }

    private static String text(String wert) {
        return wert == null ? "" : wert.trim();
    }
}
