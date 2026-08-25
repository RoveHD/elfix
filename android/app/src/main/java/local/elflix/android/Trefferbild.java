package local.elflix.android;

import java.net.URI;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Das Bild eines Suchtreffers.
 *
 * <p>Die Suche geht ueber alle Anbieter gleichzeitig und zeigte ihre Treffer
 * als Textzeilen mit einem Platzhalter aus zwei Buchstaben. Auf der
 * Anbieterseite steht das Bild aber unmittelbar daneben - im selben Verweis,
 * den die Suche ohnehin schon ausliest. Es wurde nur nicht mitgenommen.
 *
 * <p>Gesucht wird deshalb nichts nach: kein zweiter Abruf je Treffer, keine
 * geratene Adresse aus dem Namen. Was hier herauskommt, stand in dem Stueck
 * Markup, das der Treffer ohnehin ist. Findet sich dort nichts, bleibt der
 * gestaltete Platzhalter - er ist besser als ein falsches Bild.
 *
 * <p>Ganze Klasse ohne Zustand und ohne Android: sie laesst sich damit fuer
 * sich pruefen, und die Prueffaelle sind echte Ausschnitte aus den Seiten der
 * Anbieter.
 */
public final class Trefferbild {
    private Trefferbild() {
    }

    /**
     * Was nach einem Bild aussieht, es aber nicht ist.
     *
     * <p>Ein Verweis traegt neben dem Titelbild oft noch das Abzeichen der
     * Sprache, ein Herz, das Logo der Seite oder ein durchsichtiges Pixel als
     * Platzhalter fuer das, was erst spaeter nachgeladen wird. Steht so etwas
     * auf der Karte, sieht sie kaputter aus als ohne Bild.
     */
    private static final Pattern BEIWERK = Pattern.compile(
        "(?i)(logo|sprite|icon|favicon|avatar|placeholder|platzhalter|blank|spacer|pixel"
            + "|loading|lazy[-_]?load|flagge|flags?/|1x1|transparent)");

    /** Bilder in diesem Format sind auf diesen Seiten Symbole, keine Titelbilder. */
    private static final Pattern SYMBOLFORMAT = Pattern.compile("(?i)\\.svg(\\?|$)");

    private static final Pattern BILD = Pattern.compile("(?is)<img\\b([^>]*)>");
    private static final Pattern HINTERGRUND = Pattern.compile(
        "(?i)background(?:-image)?\\s*:\\s*url\\(\\s*[\"']?([^\"')]+)[\"']?\\s*\\)");
    private static final Pattern DATENBILD = Pattern.compile(
        "(?i)(?:data-bg|data-background|data-poster|data-thumb|data-thumbnail)"
            + "\\s*=\\s*[\"']([^\"']+)[\"']");

    /**
     * Eine Adresse aufloesen - dieselbe Regel wie im Rest der Suche.
     *
     * <p>Nur http und https: eine eingebettete {@code data:}-Grafik laedt der
     * Bildspeicher nicht, und ein {@code javascript:} gehoert ohnehin
     * nirgendwohin.
     */
    public static String absolut(String baseUrl, String href) {
        try {
            URI adresse = new URI(baseUrl).resolve(href.trim());
            String schema = adresse.getScheme();
            if (!"http".equals(schema) && !"https".equals(schema)) return "";
            return adresse.toString().split("#")[0];
        } catch (Exception ungueltig) {
            return "";
        }
    }

    /**
     * Das Titelbild aus dem Markup eines Treffers.
     *
     * @param markup  der ganze Verweis samt Inhalt, so wie er auf der Seite steht
     * @param baseUrl die Seite, von der er stammt - fuer relative Adressen
     * @return die Adresse, oder leer
     */
    public static String ausMarkup(String markup, String baseUrl) {
        if (markup == null || markup.isEmpty()) return "";

        Matcher bilder = BILD.matcher(markup);
        while (bilder.find()) {
            String gefunden = ausBildmarke(bilder.group(1), baseUrl);
            if (!gefunden.isEmpty()) return gefunden;
        }

        // Manche Seiten legen das Titelbild als Hintergrund auf den Kasten
        // statt als eigenes Bild. Fuer den Betrachter ist das dasselbe.
        Matcher hintergrund = HINTERGRUND.matcher(markup);
        while (hintergrund.find()) {
            String gefunden = geprueft(absolut(baseUrl, entschluesselt(hintergrund.group(1))));
            if (!gefunden.isEmpty()) return gefunden;
        }

        Matcher daten = DATENBILD.matcher(markup);
        while (daten.find()) {
            String gefunden = geprueft(absolut(baseUrl, entschluesselt(daten.group(1))));
            if (!gefunden.isEmpty()) return gefunden;
        }
        return "";
    }

    /**
     * Die beste Adresse aus einer Bildmarke.
     *
     * <p>Zuerst die Auswahlliste: dort steht die grosse Fassung, und ein
     * Titelbild soll auf einer Kachel nicht ausgefranst aussehen. Danach die
     * verzoegerten Adressen, denn wo eine steht, ist {@code src} meist nur das
     * durchsichtige Pixel. Erst zuletzt {@code src} selbst.
     */
    private static String ausBildmarke(String angaben, String baseUrl) {
        String ausListe = ausAuswahlliste(
            marke(angaben, "data-srcset") + ", " + marke(angaben, "srcset"), baseUrl);
        if (!ausListe.isEmpty()) return ausListe;

        String[] felder = {"data-src", "data-lazy-src", "data-original", "data-image", "src"};
        for (String feld : felder) {
            String wert = marke(angaben, feld);
            if (wert.isEmpty()) continue;
            String adresse = geprueft(absolut(baseUrl, entschluesselt(wert)));
            if (!adresse.isEmpty()) return adresse;
        }
        return "";
    }

    /**
     * Aus einer Auswahlliste die groesste Fassung.
     *
     * <p>Gemessen wird an dem, was danebensteht: {@code 2x} vor {@code 1x},
     * und bei Breitenangaben die groessere. Ohne Angabe zaehlt der erste
     * brauchbare Eintrag.
     */
    private static String ausAuswahlliste(String liste, String baseUrl) {
        String beste = "";
        double bestwert = -1;
        for (String eintrag : liste.split(",")) {
            String[] teile = eintrag.trim().split("\\s+");
            if (teile.length == 0 || teile[0].isEmpty()) continue;
            String adresse = geprueft(absolut(baseUrl, entschluesselt(teile[0])));
            if (adresse.isEmpty()) continue;
            double wert = 0;
            if (teile.length > 1) {
                String mass = teile[1];
                try {
                    if (mass.endsWith("w")) wert = Double.parseDouble(mass.substring(0, mass.length() - 1));
                    else if (mass.endsWith("x")) wert = Double.parseDouble(mass.substring(0, mass.length() - 1));
                } catch (NumberFormatException unlesbar) {
                    wert = 0;
                }
            }
            if (wert > bestwert) {
                bestwert = wert;
                beste = adresse;
            }
        }
        return beste;
    }

    private static String marke(String angaben, String name) {
        Matcher treffer = Pattern
            .compile("(?i)\\b" + name + "\\s*=\\s*[\"']([^\"']*)[\"']")
            .matcher(angaben == null ? "" : angaben);
        return treffer.find() ? treffer.group(1).trim() : "";
    }

    /** Die wenigen Entitaeten, die in einer Adresse im Markup wirklich vorkommen. */
    private static String entschluesselt(String wert) {
        return wert == null ? "" : wert.replace("&amp;", "&").replace("&#38;", "&").trim();
    }

    /** Ist das ein Titelbild - oder nur Beiwerk? */
    private static String geprueft(String adresse) {
        if (adresse == null || adresse.isEmpty()) return "";
        if (SYMBOLFORMAT.matcher(adresse).find()) return "";
        if (BEIWERK.matcher(adresse).find()) return "";
        return adresse;
    }
}
