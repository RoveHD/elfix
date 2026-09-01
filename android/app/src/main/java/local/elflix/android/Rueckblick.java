package local.elflix.android;

import android.content.Context;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Outline;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Der Rückblick und der Jahresrückblick.
 *
 * <p>Beides steht am Rechner: eine Statistikseite mit Kennzahlen und
 * Ranglisten, und darüber der Jahresrückblick als Geschichte in Karten. Beide
 * lesen dieselbe Auswertung - {@code statistik.auswerten} -, und genau diese
 * Auswertung kommt auf Android jetzt aus demselben Modul im Kern. Was hier
 * steht, ist deshalb nur die Darstellung; gerechnet wird kein Wert.
 *
 * <p>Der Grundsatz der Auswertung gilt auch für die Anzeige: <em>es wird nichts
 * hochgerechnet.</em> Eine Kachel, deren Zahl nicht gemessen wurde, fällt weg
 * statt eine Null zu zeigen - eine Null ist eine Behauptung. Der Hinweis, für
 * wie viele Sätze überhaupt Zeit gemessen ist, steht an derselben Stelle wie am
 * Rechner.
 */
final class Rueckblick {
    private static final String[] MONATE = {
        "Januar", "Februar", "März", "April", "Mai", "Juni",
        "Juli", "August", "September", "Oktober", "November", "Dezember"
    };
    /** Wochentage in der Zählweise von {@code Date.getDay()} - Sonntag ist 0. */
    private static final String[] WOCHENTAGE = {
        "Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"
    };

    /**
     * Wie hoch eine Karte des Jahresrückblicks mindestens ist.
     *
     * <p>Hoch genug, dass eine Zahl darauf steht und nicht darin klemmt - und
     * fest, damit die Karte beim Weiterblättern nicht die Höhe wechselt.
     */
    private static final int KARTE_HOEHE_DP = 380;

    /**
     * Wie stark das Titelbild hinter der Karte durchkommt.
     *
     * <p>Dieselben 38 Prozent wie am Rechner ({@code .wrapped-backdrop}). Mehr,
     * und die Schrift steht auf einem Foto; weniger, und man fragt sich, wozu
     * das Bild da ist.
     *
     * <p>Es waren 22 Prozent, auf beiden Geraeten. Aufgefallen ist der
     * Unterschied erst, als hier ueberhaupt Bilder ankamen: zusammen mit dem
     * Schleier darueber blieb vom Poster ein Grau, und eine graue Flaeche ist
     * kein Bild - sie ist nur eine dunklere Karte.
     */
    private static final float HINTERGRUND_DECKKRAFT = 0.38f;

    /** Breite und Höhe des Posters auf den beiden Karten "des Jahres". */
    private static final int POSTER_BREITE_DP = 116;
    private static final int POSTER_HOEHE_DP = 174;

    private Rueckblick() {
    }

    /* ------------------------------------------------------------ Im Dezember */

    /**
     * Der Dezember-Anstrich fuer die Karte, die in den Jahresrückblick führt.
     *
     * <p>Bis hierher tat die Saison nur eines: sie liess die Karte erscheinen.
     * Damit stand sie in einer Startseite voller Karten als eine weitere -
     * derselbe Rand, dieselbe Farbe, dieselbe Schrift. Gemeldet als "im
     * Dezember muss das richtig aufleuchten": eine Karte, die aussieht wie
     * jede andere, ist keine Einladung, sie ist eine Zeile.
     *
     * <p>Also der Akzent statt der Kartenfarbe, ein deutlicher Rand und eine
     * Kopfzeile, die sagt, warum die Karte überhaupt da ist. Fünf Wochen im
     * Jahr, danach von selbst wieder wie vorher - und ausdrücklich nur in der
     * Saison: wer den Rückblick in den Einstellungen selbst eingeschaltet hat,
     * will ihn dahaben und nicht angesprochen werden. Dieselbe Trennung wie am
     * Rechner, wo der Eintrag in der Seitenleiste genau dann leuchtet.
     *
     * <p>Angefasst wird nur der Hintergrund und eine zusätzliche Zeile ganz
     * oben. Was in der Karte steckt - beim Fernseher der fokussierbare Knopf -,
     * bleibt, wie es ist; ein zweiter Kartenbau wäre eine zweite Gelegenheit,
     * den Fokus zu verlieren.
     *
     * @param karte    eine Karte aus {@code settingsCard} oder {@code TvViews.infoCard}
     * @param anlass    die Kopfzeile ganz oben; leer lässt sie weg
     * @param radiusDp  der Eckenradius der Karte - am Fernseher ein anderer als
     *                  auf dem Telefon, und ein Hintergrund mit fremdem Radius
     *                  steht sichtbar über der Kante
     * @return dieselbe Karte, damit sich der Aufruf einsetzen lässt
     */
    static View saisonAnstrich(Context context, View karte, String anlass, int radiusDp) {
        int radius = MobileViews.dp(context, radiusDp);
        GradientDrawable grund = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
            new int[]{
                MobileViews.blend(Theme.SURFACE_ELEVATED, Theme.PRIMARY_DEEP, 0.55f),
                MobileViews.blend(Theme.SURFACE_ELEVATED, Theme.PRIMARY_DEEP, 0.22f),
                Theme.SURFACE_ELEVATED});
        grund.setCornerRadius(radius);
        grund.setStroke(MobileViews.dp(context, 1), Theme.PRIMARY);
        karte.setBackground(grund);

        if (anlass != null && !anlass.isEmpty() && karte instanceof LinearLayout) {
            TextView kopf = new TextView(context);
            kopf.setText(anlass.toUpperCase(Locale.GERMANY));
            kopf.setTextColor(Theme.TEXT_PRIMARY);
            kopf.setTextSize(11);
            kopf.setLetterSpacing(0.18f);
            kopf.setTypeface(Typeface.DEFAULT_BOLD);
            kopf.setPadding(0, 0, 0, MobileViews.dp(context, 6));
            ((LinearLayout) karte).addView(kopf, 0);
        }
        return karte;
    }

    /* ------------------------------------------------------------- In Worte */

    /**
     * Stunden und Minuten, wie man sie sagt.
     *
     * <p>Sekunden sind hier belanglos, und "3,7 Stunden" liest niemand gern -
     * dieselbe Formatierung wie {@code reviewDauer} am Rechner.
     */
    static String dauer(double sekunden) {
        long gesamt = Math.max(0, Math.round(sekunden));
        long stunden = gesamt / 3600;
        long minuten = Math.round((gesamt % 3600) / 60.0);
        if (stunden == 0) return minuten + " min";
        return minuten > 0 ? stunden + " h " + minuten + " min" : stunden + " h";
    }

    /** "4. Januar 2026" - aus einem Tagesschlüssel oder einem Zeitstempel. */
    static String datum(String tag, boolean mitJahr) {
        String text = tag == null ? "" : tag.trim();
        if (text.length() < 10) return "";
        String[] teile = text.substring(0, 10).split("-");
        if (teile.length != 3) return "";
        try {
            int monat = Integer.parseInt(teile[1]);
            return Integer.parseInt(teile[2]) + ". " + MONATE[Math.max(0, Math.min(11, monat - 1))]
                + (mitJahr ? " " + teile[0] : "");
        } catch (NumberFormatException fehler) {
            return "";
        }
    }

    /** Eine Kommazahl deutsch - 1.5 wird zu "1,5", 2.0 zu "2". */
    static String zahl(double wert) {
        if (Math.abs(wert - Math.rint(wert)) < 0.001) return String.valueOf(Math.round(wert));
        return String.format(Locale.GERMANY, "%.1f", wert);
    }

    private static boolean zeitBekannt(JSONObject daten) {
        return daten.optInt("sekundenBekannt", 0) > 0 && daten.optDouble("sekunden", 0) > 0;
    }

    /* ------------------------------------------------------- Die Statistik */

    /**
     * Die Abschnitte der Statistikseite - dieselbe Reihenfolge wie am Rechner.
     *
     * <p>Erst die grossen Zahlen, dann der ehrliche Hinweis, dann die Kacheln,
     * dann die Ranglisten. Der Hinweis steht bewusst <em>vor</em> den Kacheln:
     * er schränkt alles darunter ein.
     */
    static List<View> statistik(Context context, JSONObject daten) {
        ArrayList<View> stuecke = new ArrayList<>();
        boolean zeit = zeitBekannt(daten);

        LinearLayout kopf = new LinearLayout(context);
        kopf.setOrientation(LinearLayout.HORIZONTAL);
        int folgen = daten.optInt("folgen", 0);
        kopfZahl(context, kopf, String.valueOf(folgen), folgen == 1 ? "Folge" : "Folgen");
        kopfZahl(context, kopf, String.valueOf(daten.optInt("folgenAbgeschlossen", 0)), "abgeschlossen");
        if (zeit) kopfZahl(context, kopf, dauer(daten.optDouble("sekunden", 0)), "geschaut");
        stuecke.add(kopf);

        int bekannt = daten.optInt("sekundenBekannt", 0);
        int gesamt = daten.optInt("sekundenGesamt", 0);
        if (bekannt < gesamt) {
            stuecke.add(satz(context, zeit
                ? "Wiedergabezeit ist für " + bekannt + " von " + gesamt + " Einträgen gemessen — "
                    + "ältere stammen aus dem Verlauf und tragen keine Zeit."
                : "Wiedergabezeit wird erst seit dieser Version gemessen. Was hier steht, stammt "
                    + "aus dem bisherigen Verlauf: Folgen und Tage sind belegt, Stunden nicht.",
                Theme.TEXT_SECONDARY, 12));
        }

        ArrayList<View> kacheln = new ArrayList<>();
        int tage = daten.optInt("tage", 0);
        kacheln.add(MobileViews.kennzahl(context, String.valueOf(tage),
            tage == 1 ? "Tag geschaut" : "Tage geschaut", ""));
        JSONObject strecke = daten.optJSONObject("strecke");
        if (strecke != null) {
            String spanne = strecke.optString("von", "").isEmpty() ? ""
                : datum(strecke.optString("von"), false) + " bis " + datum(strecke.optString("bis"), false);
            kacheln.add(MobileViews.kennzahl(context, String.valueOf(strecke.optInt("tage", 0)),
                "Tage am Stück", spanne));
        }
        if (daten.optInt("laufendeStrecke", 0) > 0) {
            kacheln.add(MobileViews.kennzahl(context,
                String.valueOf(daten.optInt("laufendeStrecke")), "Tage aktuell am Stück", ""));
        }
        if (daten.optDouble("folgenJeTag", 0) > 0) {
            kacheln.add(MobileViews.kennzahl(context, zahl(daten.optDouble("folgenJeTag")),
                "Folgen je Schautag", ""));
        }
        if (daten.optInt("wiederholungen", 0) > 0) {
            kacheln.add(MobileViews.kennzahl(context, String.valueOf(daten.optInt("wiederholungen")),
                "Wiederholungen", ""));
        }
        if (zeit && daten.optDouble("laengsteSitzung", 0) > 0) {
            kacheln.add(MobileViews.kennzahl(context, dauer(daten.optDouble("laengsteSitzung")),
                "längste Sitzung", ""));
            kacheln.add(MobileViews.kennzahl(context, dauer(daten.optDouble("sitzungsschnitt")),
                "Sitzung im Schnitt", ""));
        }
        JSONObject besterTag = daten.optJSONObject("aktivsterTag");
        if (besterTag != null) {
            boolean mitZeit = besterTag.optDouble("sekunden", 0) > 0;
            kacheln.add(MobileViews.kennzahl(context,
                mitZeit ? dauer(besterTag.optDouble("sekunden")) : String.valueOf(besterTag.optInt("folgen")),
                mitZeit ? "stärkster Tag" : "Folgen am stärksten Tag",
                datum(besterTag.optString("tag"), true)));
        }
        JSONObject besterWochentag = daten.optJSONObject("aktivsterWochentag");
        if (besterWochentag != null) {
            boolean mitZeit = besterWochentag.optDouble("sekunden", 0) > 0;
            kacheln.add(MobileViews.kennzahl(context, wochentag(besterWochentag.optInt("tag", -1)),
                "liebster Wochentag",
                mitZeit ? dauer(besterWochentag.optDouble("sekunden"))
                    : besterWochentag.optInt("folgen") + " Folgen"));
        }
        stuecke.add(raster(context, kacheln, 2));

        stuecke.addAll(genreBalken(context, daten, zeit));
        stuecke.addAll(titelliste(context, "Deine meistgesehenen Serien",
            daten.optJSONArray("serien"), zeit, "sekunden"));
        stuecke.addAll(titelliste(context, "Deine Filme",
            daten.optJSONArray("filme"), zeit, "sekunden"));
        // YouTube steht fuer sich - und mit einem Satz dazu, warum.
        //
        // Ein Reaktionsvideo ist keine Serienfolge. Solange beides in einem Topf
        // lief, verschob es jede Zahl daneben: Gesamtzeit, Genres, Folgen,
        // staerkster Tag, Serie des Jahres. Ohne den Satz faende jemand seine
        // Stunde YouTube in der Gesamtzeit nicht wieder und hielte die
        // Statistik fuer kaputt.
        JSONObject videos = daten.optJSONObject("videos");
        if (videos != null && videos.optInt("videos", 0) > 0) {
            stuecke.addAll(titelliste(context, "Deine YouTube-Videos",
                videos.optJSONArray("liste"), zeit, "sekunden"));
            stuecke.add(satz(context, videoFussnote(videos), Theme.TEXT_DISABLED, 11));
        }

        JSONArray wiederholt = daten.optJSONArray("wiederholteste");
        if (wiederholt != null && wiederholt.length() > 0) {
            stuecke.addAll(titelliste(context, "Am häufigsten wiederholt",
                wiederholt, zeit, "wiederholungen"));
        }
        return stuecke;
    }

    /** Der Satz unter den Videos - dieselben Worte wie am Rechner. */
    private static String videoFussnote(JSONObject videos) {
        int anzahl = videos.optInt("videos", 0);
        int tage = videos.optInt("tage", 0);
        double sekunden = videos.optDouble("sekunden", 0);
        StringBuilder satz = new StringBuilder();
        satz.append(anzahl).append(anzahl == 1 ? " Video" : " Videos");
        if (tage > 0) satz.append(" an ").append(tage).append(tage == 1 ? " Tag" : " Tagen");
        if (sekunden > 0) satz.append(", zusammen ").append(dauer(sekunden));
        satz.append(". Zählt eigens und ist in keiner Zahl oben enthalten.");
        return satz.toString();
    }

    private static String wochentag(int nummer) {
        return nummer >= 0 && nummer < WOCHENTAGE.length ? WOCHENTAGE[nummer] : "—";
    }

    private static List<View> genreBalken(Context context, JSONObject daten, boolean zeit) {
        ArrayList<View> stuecke = new ArrayList<>();
        JSONArray genres = daten.optJSONArray("genres");
        if (genres == null || genres.length() == 0) return stuecke;

        stuecke.add(ueberschrift(context, "Deine Genres"));
        LinearLayout kasten = kartenKasten(context);
        double groesster = 0;
        for (int i = 0; i < genres.length(); i += 1) {
            JSONObject genre = genres.optJSONObject(i);
            if (genre == null) continue;
            groesster = Math.max(groesster, genreWert(genre, zeit));
        }
        for (int i = 0; i < genres.length(); i += 1) {
            JSONObject genre = genres.optJSONObject(i);
            if (genre == null) continue;
            double wert = genreWert(genre, zeit);
            kasten.addView(MobileViews.balken(context, genre.optString("label", "—"),
                zeit && genre.optDouble("sekunden", 0) > 0
                    ? dauer(genre.optDouble("sekunden"))
                    : String.valueOf(genre.optInt("titel", 0)),
                groesster > 0 ? (float) (wert / groesster) : 0f));
        }
        stuecke.add(kasten);
        stuecke.add(satz(context, zeit
            ? "Läuft ein Titel unter mehreren Genres, wird seine Zeit anteilig verteilt — sonst "
                + "zählte eine Stunde dreifach."
            : "Gezählt werden Titel, solange keine Wiedergabezeit gemessen ist.",
            Theme.TEXT_DISABLED, 11));
        return stuecke;
    }

    private static double genreWert(JSONObject genre, boolean zeit) {
        return zeit && genre.optDouble("sekunden", 0) > 0
            ? genre.optDouble("sekunden") : genre.optInt("titel", 0);
    }

    private static List<View> titelliste(Context context, String titel, JSONArray eintraege,
                                         boolean zeit, String schluessel) {
        ArrayList<View> stuecke = new ArrayList<>();
        if (eintraege == null || eintraege.length() == 0) return stuecke;
        stuecke.add(ueberschrift(context, titel));
        LinearLayout kasten = kartenKasten(context);
        double groesster = 0;
        for (int i = 0; i < eintraege.length(); i += 1) {
            JSONObject eintrag = eintraege.optJSONObject(i);
            if (eintrag != null) groesster = Math.max(groesster, eintrag.optDouble(schluessel, 0));
        }
        for (int i = 0; i < eintraege.length(); i += 1) {
            JSONObject eintrag = eintraege.optJSONObject(i);
            if (eintrag == null) continue;
            double wert = eintrag.optDouble(schluessel, 0);
            String anzeige;
            if ("wiederholungen".equals(schluessel)) {
                anzeige = eintrag.optInt("wiederholungen") + "×";
            } else if (zeit && eintrag.optDouble("sekunden", 0) > 0) {
                anzeige = dauer(eintrag.optDouble("sekunden"));
            } else {
                int folgen = eintrag.optInt("folgen", 0);
                anzeige = folgen + (folgen == 1 ? " Folge" : " Folgen");
            }
            kasten.addView(MobileViews.balken(context, eintrag.optString("titel", "—"), anzeige,
                groesster > 0 ? (float) (wert / groesster) : 0f));
        }
        stuecke.add(kasten);
        return stuecke;
    }

    /* --------------------------------------------------- Der Jahresrückblick */

    /**
     * Die Karten des Jahresrückblicks - dieselbe Abfolge wie am Rechner.
     *
     * <p>Jede Karte fällt weg, wenn ihre Zahl nicht belegt ist. Deshalb hat ein
     * Jahr mit drei Abenden zwei Karten und keine achtzehn leeren.
     */
    static List<View> wrapped(Context context, JSONObject daten, int jahr) {
        ArrayList<View> seiten = new ArrayList<>();
        boolean zeit = zeitBekannt(daten);
        JSONObject topSerie = erstes(daten.optJSONArray("serien"));
        JSONObject topFilm = erstes(daten.optJSONArray("filme"));
        JSONObject ersterTitel = daten.optJSONObject("erster");
        // Das Bild, das die Karten ohne eigenes tragen: die Serie des Jahres,
        // sonst der Film, sonst der Titel, mit dem das Jahr angefangen hat.
        // Dieselbe Reihenfolge wie am Rechner.
        String stimmung = bild(topSerie);
        if (stimmung.isEmpty()) stimmung = bild(topFilm);
        if (stimmung.isEmpty()) stimmung = bild(ersterTitel);

        // 1 - Auftakt. Der Zeitraum steht hier und nirgends sonst: er ist die
        // Einschränkung, unter der alles Folgende gilt.
        seiten.add(bildkarte(context, stimmung,
            augenbraue(context, "ELFIX Wrapped"),
            zeile(context, String.valueOf(jahr), 56, Theme.TEXT_PRIMARY, true),
            zeile(context, auftakt(daten, jahr), 17, Theme.TEXT_SECONDARY, false),
            zeile(context, zeitraumHinweis(daten, jahr), 12, Theme.TEXT_DISABLED, false)));

        // 2 - Watchtime. Fällt aus, solange nichts gemessen wurde.
        if (zeit) {
            long stunden = Math.round(daten.optDouble("sekunden") / 3600);
            double tage = Math.round(daten.optDouble("sekunden") / 86400 * 10) / 10.0;
            seiten.add(karte(context,
                grosseZahl(context, String.valueOf(stunden), "Stunden"),
                zeile(context, "hast du dieses Jahr mit ELFIX geschaut.", 17, Theme.TEXT_SECONDARY, false),
                tage >= 1
                    ? zeile(context, "Das sind " + zahl(tage) + " Tage am Stück.", 13, Theme.TEXT_DISABLED, false)
                    : null));
        }

        // 3 - Folgen
        int folgen = daten.optInt("folgen", 0);
        if (folgen > 0) {
            seiten.add(karte(context,
                grosseZahl(context, String.valueOf(folgen), folgen == 1 ? "Folge" : "Folgen"),
                zeile(context, "hast du " + jahr + " angesehen.", 17, Theme.TEXT_SECONDARY, false),
                daten.optDouble("folgenJeTag", 0) > 0
                    ? zeile(context, "Im Schnitt " + zahl(daten.optDouble("folgenJeTag"))
                        + " an jedem Schautag.", 13, Theme.TEXT_DISABLED, false)
                    : null));
        }

        // 4/5/6 - Abgeschlossenes, je Gattung und nur wenn es etwas gibt.
        JSONObject abschluesse = daten.optJSONObject("abschluesse");
        if (abschluesse != null) {
            abschlussKarte(context, seiten, abschluesse.optInt("serie", 0), "Serie", "Serien",
                bild(topSerie));
            abschlussKarte(context, seiten, abschluesse.optInt("film", 0), "Film", "Filme",
                bild(topFilm));
            abschlussKarte(context, seiten, abschluesse.optInt("anime", 0), "Anime", "Anime", "");
        }

        // 7 - Serie und Film des Jahres. Ausgewählt nach geschauter Zeit, und
        // wo die fehlt, nach Folgen - nicht nach einer erfundenen Punktzahl.
        if (topSerie != null) {
            seiten.add(bildkarte(context, bild(topSerie),
                augenbraue(context, "Deine Serie des Jahres"),
                poster(context, topSerie.optString("titel", ""), bild(topSerie)),
                zeile(context, topSerie.optString("titel", "—"), 26, Theme.TEXT_PRIMARY, true),
                zeile(context, titelZahlen(topSerie, zeit), 14, Theme.TEXT_SECONDARY, false)));
        }
        if (topFilm != null) {
            seiten.add(bildkarte(context, bild(topFilm),
                augenbraue(context, "Dein Film des Jahres"),
                poster(context, topFilm.optString("titel", ""), bild(topFilm)),
                zeile(context, topFilm.optString("titel", "—"), 26, Theme.TEXT_PRIMARY, true),
                zeile(context, titelZahlen(topFilm, zeit), 14, Theme.TEXT_SECONDARY, false)));
        }

        // 8 - Genre des Jahres samt Verfolgerfeld.
        JSONArray genres = daten.optJSONArray("genres");
        if (genres != null && genres.length() > 0) {
            JSONObject erste = genres.optJSONObject(0);
            LinearLayout liste = new LinearLayout(context);
            liste.setOrientation(LinearLayout.VERTICAL);
            for (int i = 0; i < Math.min(3, genres.length()); i += 1) {
                JSONObject genre = genres.optJSONObject(i);
                if (genre == null) continue;
                liste.addView(zeile(context, (i + 1) + ". " + genre.optString("label", "—"),
                    16, i == 0 ? Theme.TEXT_PRIMARY : Theme.TEXT_SECONDARY, i == 0));
            }
            seiten.add(karte(context,
                zeile(context, "Du warst dieses Jahr eindeutig auf "
                    + (erste == null ? "—" : erste.optString("label", "—")) + ".",
                    19, Theme.TEXT_PRIMARY, false),
                liste, null));
        }

        // 9 - Der Mix in Prozent. Nur wo Zeit gemessen wurde: eine
        // Prozentangabe auf Titelzahlen wäre eine andere Aussage, die genauso
        // aussieht.
        List<int[]> mixWerte = new ArrayList<>();
        List<String> mixNamen = new ArrayList<>();
        mix(daten, zeit, mixNamen, mixWerte);
        if (mixNamen.size() >= 2) {
            LinearLayout kasten = new LinearLayout(context);
            kasten.setOrientation(LinearLayout.VERTICAL);
            for (int i = 0; i < mixNamen.size(); i += 1) {
                int prozent = mixWerte.get(i)[0];
                kasten.addView(MobileViews.balken(context, mixNamen.get(i), prozent + " %",
                    prozent / 100f));
            }
            seiten.add(karte(context,
                augenbraue(context, "Dein " + jahr + " Mix"), kasten, null));
        }

        // 10 - Strecke
        JSONObject strecke = daten.optJSONObject("strecke");
        if (strecke != null && strecke.optInt("tage", 0) >= 2) {
            seiten.add(karte(context,
                zeile(context, "Du konntest " + strecke.optInt("tage")
                    + " Tage nicht aufhören.", 19, Theme.TEXT_PRIMARY, false),
                grosseZahl(context, String.valueOf(strecke.optInt("tage")), "Tage am Stück"),
                zeile(context, "Deine längste Strecke ohne Pause.", 13, Theme.TEXT_DISABLED, false)));
        }

        // 11 und 12 - Wochentag und Rekordtag sind zwei verschiedene Dinge und
        // stehen deshalb auf zwei Karten.
        JSONObject besterWochentag = daten.optJSONObject("aktivsterWochentag");
        if (besterWochentag != null) {
            String tag = wochentag(besterWochentag.optInt("tag", -1));
            seiten.add(karte(context,
                zeile(context, tag + " war dein Tag.", 22, Theme.TEXT_PRIMARY, true),
                zeile(context, besterWochentag.optDouble("sekunden", 0) > 0
                    ? "Insgesamt " + dauer(besterWochentag.optDouble("sekunden")) + " an " + tag + "en."
                    : besterWochentag.optInt("folgen") + " Folgen an " + tag + "en.",
                    14, Theme.TEXT_SECONDARY, false), null));
        }
        JSONObject besterTag = daten.optJSONObject("aktivsterTag");
        if (besterTag != null) {
            seiten.add(karte(context,
                augenbraue(context, "Dein intensivster Tag"),
                zeile(context, datum(besterTag.optString("tag"), true), 26, Theme.TEXT_PRIMARY, true),
                zeile(context, besterTag.optDouble("sekunden", 0) > 0
                    ? dauer(besterTag.optDouble("sekunden"))
                    : besterTag.optInt("folgen") + " Folgen", 14, Theme.TEXT_SECONDARY, false)));
        }

        // 13 - Längste Sitzung
        if (zeit && daten.optDouble("laengsteSitzung", 0) >= 1800) {
            seiten.add(karte(context,
                zeile(context, "Nur noch eine Folge?", 19, Theme.TEXT_PRIMARY, false),
                grosseZahl(context, dauer(daten.optDouble("laengsteSitzung")), ""),
                zeile(context, "Deine längste Sitzung am Stück.", 13, Theme.TEXT_DISABLED, false)));
        }

        // 14 - Tageszeit. Nur bei gemessener Zeit und genug Sitzungen: aus fünf
        // Abenden folgt kein Typ.
        String[] tageszeit = tageszeit(daten, zeit);
        if (tageszeit != null) {
            seiten.add(karte(context,
                zeile(context, "Du bist " + tageszeit[0] + " " + tageszeit[1] + ".",
                    22, Theme.TEXT_PRIMARY, true),
                grosseZahl(context, tageszeit[2], "%"),
                zeile(context, "deiner Zeit lagen " + tageszeit[3] + ".", 13, Theme.TEXT_DISABLED, false)));
        }

        // 15 - Wiederholungen, nur wenn es welche gab.
        JSONObject oft = erstes(daten.optJSONArray("wiederholteste"));
        if (oft != null) {
            seiten.add(bildkarte(context, bild(oft),
                zeile(context, "Das kam dir bekannt vor …", 19, Theme.TEXT_SECONDARY, false),
                poster(context, oft.optString("titel", ""), bild(oft)),
                zeile(context, oft.optString("titel", "—"), 26, Theme.TEXT_PRIMARY, true),
                zeile(context, oft.optInt("wiederholungen") + "× noch einmal gesehen.",
                    14, Theme.TEXT_SECONDARY, false)));
        }

        // 16 - Monat des Jahres.
        JSONObject besterMonat = daten.optJSONObject("aktivsterMonat");
        JSONArray monate = daten.optJSONArray("monate");
        if (besterMonat != null && monate != null && monate.length() >= 2) {
            seiten.add(karte(context,
                zeile(context, monatName(besterMonat.optString("monat"))
                    + " war dein stärkster Monat.", 20, Theme.TEXT_PRIMARY, true),
                zeile(context, besterMonat.optDouble("sekunden", 0) > 0
                    ? dauer(besterMonat.optDouble("sekunden"))
                    : besterMonat.optInt("folgen") + " Folgen", 14, Theme.TEXT_SECONDARY, false),
                monatsreihe(context, monate)));
        }

        // 17 - Anfang und Ende. Solange das Jahr läuft, ist der letzte Titel
        // nur der bisher letzte - alles andere wäre eine Behauptung über die
        // Zukunft.
        JSONObject erster = ersterTitel;
        JSONObject letzter = daten.optJSONObject("letzter");
        if (erster != null) {
            seiten.add(bildkarte(context, bild(erster),
                augenbraue(context, "So hat dein Jahr begonnen"),
                poster(context, erster.optString("titel", ""), bild(erster)),
                zeile(context, erster.optString("titel", "—"), 24, Theme.TEXT_PRIMARY, true),
                zeile(context, datum(erster.optString("wann"), true), 14, Theme.TEXT_SECONDARY, false)));
        }
        if (letzter != null && (erster == null
            || !letzter.optString("titel").equals(erster.optString("titel")))) {
            boolean laeuftNoch = java.util.Calendar.getInstance().get(java.util.Calendar.YEAR) == jahr;
            seiten.add(bildkarte(context, bild(letzter),
                augenbraue(context, laeuftNoch ? "Dein bisher letzter Titel"
                    : "Und damit hast du das Jahr beendet"),
                poster(context, letzter.optString("titel", ""), bild(letzter)),
                zeile(context, letzter.optString("titel", "—"), 24, Theme.TEXT_PRIMARY, true),
                zeile(context, datum(letzter.optString("wann"), true), 14, Theme.TEXT_SECONDARY, false)));
        }

        // 18 - Was sonst noch auffiel. Nur Sätze, deren Zahl eindeutig ist.
        List<String> fakten = fakten(daten, zeit);
        if (!fakten.isEmpty()) {
            LinearLayout liste = new LinearLayout(context);
            liste.setOrientation(LinearLayout.VERTICAL);
            for (String satz : fakten) {
                liste.addView(zeile(context, "• " + satz, 15, Theme.TEXT_SECONDARY, false));
            }
            seiten.add(karte(context,
                augenbraue(context, "Nebenbei"), liste, null));
        }

        // 19 - Das Finale.
        LinearLayout schluss = new LinearLayout(context);
        schluss.setOrientation(LinearLayout.VERTICAL);
        schluss.addView(zeile(context, folgen + (folgen == 1 ? " Folge" : " Folgen"),
            18, Theme.TEXT_PRIMARY, true));
        if (zeit) {
            schluss.addView(zeile(context, dauer(daten.optDouble("sekunden")) + " geschaut",
                18, Theme.TEXT_PRIMARY, true));
        }
        schluss.addView(zeile(context, daten.optInt("tage", 0) + " Schautage",
            18, Theme.TEXT_PRIMARY, true));
        seiten.add(bildkarte(context, stimmung,
            augenbraue(context, "Dein ELFIX " + jahr), schluss,
            zeile(context, "Gemessen, nicht geschätzt.", 12, Theme.TEXT_DISABLED, false)));
        return seiten;
    }

    private static void abschlussKarte(Context context, List<View> seiten, int anzahl,
                                       String einzahl, String mehrzahl, String bildUrl) {
        if (anzahl <= 0) return;
        seiten.add(bildkarte(context, bildUrl,
            grosseZahl(context, String.valueOf(anzahl), anzahl == 1 ? einzahl : mehrzahl),
            zeile(context, "hast du abgeschlossen.", 17, Theme.TEXT_SECONDARY, false), null));
    }

    /** Das Titelbild eines Eintrags der Auswertung - leer, wenn keines dabei ist. */
    private static String bild(JSONObject eintrag) {
        return eintrag == null ? "" : eintrag.optString("bild", "");
    }

    static String auftakt(JSONObject daten, int jahr) {
        if (daten.optInt("tage", 0) >= 200) return jahr + " hast du kaum einen Abend ausgelassen.";
        if (daten.optInt("folgen", 0) >= 300) return jahr + " war ein gutes Jahr zum Schauen.";
        if (daten.optInt("folgen", 0) >= 50) return "Schauen wir uns dein " + jahr + " an.";
        return "Dein " + jahr + ", kurz zusammengefasst.";
    }

    /**
     * Woraus die Zahlen stammen.
     *
     * <p>Der wichtigste Satz der ganzen Ansicht: die Messung läuft erst seit
     * einer bestimmten Fassung, und ein Jahresrückblick, der das verschweigt,
     * behauptet über die Monate davor etwas, das er nicht weiss.
     */
    static String zeitraumHinweis(JSONObject daten, int jahr) {
        String von = daten.optString("von", "");
        String bis = daten.optString("bis", "");
        if (von.length() < 10) return "Noch keine Sätze für " + jahr + ".";
        String spanne = datum(von, false) + " bis " + datum(bis, false);
        int bekannt = daten.optInt("sekundenBekannt", 0);
        int gesamt = daten.optInt("sekundenGesamt", 0);
        if (bekannt >= gesamt) return "Erfasst: " + spanne + ".";
        return "Erfasst: " + spanne + ". Wiedergabezeit für " + bekannt + " von " + gesamt
            + " Sätzen gemessen.";
    }

    static String titelZahlen(JSONObject eintrag, boolean zeit) {
        int folgen = eintrag.optInt("folgen", 0);
        String folgenText = folgen + (folgen == 1 ? " Folge" : " Folgen");
        if (zeit && eintrag.optDouble("sekunden", 0) > 0) {
            return folgenText + "  ·  " + dauer(eintrag.optDouble("sekunden"));
        }
        return folgenText;
    }

    /**
     * Der Mix in Prozent.
     *
     * <p>Jeden Anteil einzeln zu runden ergibt Summen wie 101 Prozent - auf
     * einer Karte, die "dein Mix" heisst, sieht das schlicht falsch aus.
     * Deshalb erst abrunden und die übrigen Punkte an die grössten Reste
     * vergeben: so stimmt die Summe genau, und keine Zahl weicht um mehr als
     * einen Punkt ab. Dieselbe Rechnung wie {@code wrappedMix} am Rechner.
     */
    static void mix(JSONObject daten, boolean zeit, List<String> namen, List<int[]> anteile) {
        JSONArray genres = daten.optJSONArray("genres");
        if (genres == null) return;
        ArrayList<String> rohNamen = new ArrayList<>();
        ArrayList<Double> rohWerte = new ArrayList<>();
        double summe = 0;
        for (int i = 0; i < genres.length(); i += 1) {
            JSONObject genre = genres.optJSONObject(i);
            if (genre == null) continue;
            double wert = genreWert(genre, zeit);
            if (wert <= 0) continue;
            rohNamen.add(genre.optString("label", "—"));
            rohWerte.add(wert);
            summe += wert;
        }
        if (summe <= 0) return;

        int[] prozente = new int[rohWerte.size()];
        double[] reste = new double[rohWerte.size()];
        int vergeben = 0;
        for (int i = 0; i < rohWerte.size(); i += 1) {
            double genau = rohWerte.get(i) / summe * 100;
            prozente[i] = (int) Math.floor(genau);
            reste[i] = genau - prozente[i];
            vergeben += prozente[i];
        }
        int offen = 100 - vergeben;
        while (offen > 0) {
            int beste = -1;
            for (int i = 0; i < reste.length; i += 1) {
                if (reste[i] > 0 && (beste < 0 || reste[i] > reste[beste])) beste = i;
            }
            if (beste < 0) break;
            prozente[beste] += 1;
            reste[beste] = -1;
            offen -= 1;
        }

        int obenSumme = 0;
        for (int i = 0; i < Math.min(4, prozente.length); i += 1) {
            namen.add(rohNamen.get(i));
            anteile.add(new int[]{prozente[i]});
            obenSumme += prozente[i];
        }
        int rest = 100 - obenSumme;
        if (rest >= 3) {
            namen.add("andere");
            anteile.add(new int[]{rest});
        }
    }

    /**
     * Der Tageszeit-Typ.
     *
     * <p>Zwei Bedingungen, damit daraus keine Behauptung wird: es muss
     * gemessene Zeit geben, und der Anteil muss deutlich genug sein.
     *
     * @return {artikel, name, prozent, satz} oder {@code null}
     */
    static String[] tageszeit(JSONObject daten, boolean zeit) {
        if (!zeit || daten.optInt("sitzungen", 0) < 15) return null;
        JSONArray faecher = daten.optJSONArray("tageszeiten");
        if (faecher == null || faecher.length() == 0) return null;
        double gesamt = 0;
        JSONObject beste = null;
        for (int i = 0; i < faecher.length(); i += 1) {
            JSONObject fach = faecher.optJSONObject(i);
            if (fach == null) continue;
            gesamt += fach.optDouble("sekunden", 0);
            if (beste == null || fach.optDouble("sekunden", 0) > beste.optDouble("sekunden", 0)) {
                beste = fach;
            }
        }
        if (gesamt <= 0 || beste == null) return null;
        int prozent = (int) Math.round(beste.optDouble("sekunden") / gesamt * 100);
        if (prozent < 35) return null;
        switch (beste.optString("fach")) {
            case "nacht":
                return new String[]{"eine", "Nachteule", String.valueOf(prozent), "zwischen 22 und 4 Uhr"};
            case "morgen":
                return new String[]{"ein", "Frühaufsteher", String.valueOf(prozent), "vor 12 Uhr"};
            case "nachmittag":
                return new String[]{"ein", "Nachmittagsschauer", String.valueOf(prozent), "zwischen 12 und 18 Uhr"};
            case "abend":
                return new String[]{"ein", "Abendschauer", String.valueOf(prozent), "nach 18 Uhr"};
            default:
                return null;
        }
    }

    static List<String> fakten(JSONObject daten, boolean zeit) {
        ArrayList<String> fakten = new ArrayList<>();
        if (daten.optInt("welten", 0) >= 3) {
            fakten.add("Du warst in " + daten.optInt("welten") + " verschiedenen Titeln unterwegs.");
        }
        if (daten.optInt("marathon", 0) >= 3) {
            fakten.add("Dein längster Marathon: " + daten.optInt("marathon")
                + " Folgen ohne Unterbrechung.");
        }
        if (zeit && daten.optDouble("sitzungsschnitt", 0) >= 600) {
            fakten.add("Deine Sitzungen dauerten im Schnitt "
                + dauer(daten.optDouble("sitzungsschnitt")) + ".");
        }
        if (daten.optDouble("folgenJeTag", 0) >= 2) {
            fakten.add("An einem Schautag liefen im Schnitt "
                + zahl(daten.optDouble("folgenJeTag")) + " Folgen.");
        }
        return fakten.subList(0, Math.min(4, fakten.size()));
    }

    static String monatName(String schluessel) {
        String text = schluessel == null ? "" : schluessel;
        if (text.length() < 7) return "";
        try {
            return MONATE[Math.max(0, Math.min(11, Integer.parseInt(text.substring(5, 7)) - 1))];
        } catch (NumberFormatException fehler) {
            return "";
        }
    }

    private static View monatsreihe(Context context, JSONArray monate) {
        LinearLayout reihe = new LinearLayout(context);
        reihe.setOrientation(LinearLayout.HORIZONTAL);
        reihe.setGravity(Gravity.BOTTOM);
        double groesster = 1;
        for (int i = 0; i < monate.length(); i += 1) {
            JSONObject monat = monate.optJSONObject(i);
            if (monat == null) continue;
            groesster = Math.max(groesster, monatWert(monat));
        }
        for (int i = 0; i < monate.length(); i += 1) {
            JSONObject monat = monate.optJSONObject(i);
            if (monat == null) continue;
            LinearLayout saeule = new LinearLayout(context);
            saeule.setOrientation(LinearLayout.VERTICAL);
            saeule.setGravity(Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);

            View balken = new View(context);
            balken.setBackground(MobileViews.shape(context, Theme.PRIMARY, 3, Color.TRANSPARENT, 0));
            int hoehe = Math.max(4, (int) Math.round(monatWert(monat) / groesster * 60));
            saeule.addView(balken, new LinearLayout.LayoutParams(
                MobileViews.dp(context, 10), MobileViews.dp(context, hoehe)));

            TextName kurz = new TextName(context);
            kurz.setText(kuerze(monatName(monat.optString("monat"))));
            saeule.addView(kurz);

            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
            reihe.addView(saeule, params);
        }
        return reihe;
    }

    private static double monatWert(JSONObject monat) {
        double sekunden = monat.optDouble("sekunden", 0);
        return sekunden > 0 ? sekunden : monat.optInt("folgen", 0);
    }

    private static String kuerze(String wort) {
        return wort.length() > 3 ? wort.substring(0, 3) : wort;
    }

    /** Die kleine Beschriftung unter einer Monatssäule. */
    private static final class TextName extends TextView {
        TextName(Context context) {
            super(context);
            setTextColor(Theme.TEXT_DISABLED);
            setTextSize(10);
            setGravity(Gravity.CENTER);
            setPadding(0, MobileViews.dp(context, 4), 0, 0);
        }
    }

    /* ------------------------------------------------------------ Bausteine */

    private static JSONObject erstes(JSONArray liste) {
        return liste == null || liste.length() == 0 ? null : liste.optJSONObject(0);
    }

    static TextView zeile(Context context, String text, float groesse, int farbe, boolean fett) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextColor(farbe);
        view.setTextSize(groesse);
        if (fett) view.setTypeface(Typeface.DEFAULT_BOLD);
        view.setPadding(0, MobileViews.dp(context, 6), 0, 0);
        return view;
    }

    /**
     * Die grosse Zahl einer Wrapped-Karte.
     *
     * <p>Zwei Änderungen gegenüber der Statistikseite, und beide stehen so auch
     * am Rechner: die Einheit steht <em>unter</em> der Zahl statt daneben (in
     * einer Zeile bricht "Stunden" neben einer vierstelligen Zahl um), und die
     * Zahl trägt einen Verlauf von der Textfarbe in die Akzentfarbe
     * ({@code .wrapped-huge}).
     *
     * <p>Der Verlauf wird erst gesetzt, wenn die Zahl ihre Breite kennt: ein
     * Farbverlauf ohne Ausdehnung ist eine Farbe. Deshalb hängt er an der
     * Lage und nicht am Bau. {@code invalidate()} zeichnet nur neu und misst
     * nicht - der Horcher ruft sich damit nicht selbst.
     */
    private static View grosseZahl(Context context, String wert, String einheit) {
        LinearLayout kasten = new LinearLayout(context);
        kasten.setOrientation(LinearLayout.VERTICAL);
        kasten.setGravity(Gravity.CENTER_HORIZONTAL);
        final TextView zahl = new TextView(context);
        zahl.setText(wert);
        zahl.setTextColor(Theme.TEXT_PRIMARY);
        zahl.setTextSize(64);
        zahl.setGravity(Gravity.CENTER_HORIZONTAL);
        zahl.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        zahl.addOnLayoutChangeListener((ansicht, links, oben, rechts, unten,
                                        altLinks, altOben, altRechts, altUnten) -> {
            int breite = rechts - links;
            int hoehe = unten - oben;
            if (breite <= 0 || hoehe <= 0) return;
            zahl.getPaint().setShader(new LinearGradient(0, 0, breite, hoehe,
                new int[]{Theme.TEXT_PRIMARY, Theme.PRIMARY}, null, Shader.TileMode.CLAMP));
            zahl.invalidate();
        });
        kasten.addView(zahl);
        if (einheit != null && !einheit.isEmpty()) {
            TextView name = new TextView(context);
            name.setText(einheit);
            name.setTextColor(Theme.TEXT_SECONDARY);
            name.setTextSize(18);
            name.setGravity(Gravity.CENTER_HORIZONTAL);
            name.setTypeface(Typeface.DEFAULT_BOLD);
            kasten.addView(name);
        }
        return kasten;
    }

    /**
     * Die kleine Zeile über einer Karte - "Deine Serie des Jahres".
     *
     * <p>Versal und gesperrt wie am Rechner ({@code .wrapped-eyebrow}). Sie
     * benennt, was folgt, und soll dabei nicht mit dem Titel darunter um die
     * Aufmerksamkeit streiten.
     */
    private static TextView augenbraue(Context context, String text) {
        TextView view = zeile(context, text == null ? "" : text.toUpperCase(Locale.GERMANY),
            11, Theme.PRIMARY, true);
        view.setLetterSpacing(0.18f);
        return view;
    }

    /**
     * Das Titelbild als Poster - auf den beiden Karten "des Jahres".
     *
     * <p>Derselbe Bildkasten wie auf jeder Kachel ({@link MobileViews#poster}),
     * und damit auch derselbe Rückfall: ohne Bild stehen die Anfangsbuchstaben
     * des Titels da statt einer leeren Fläche.
     */
    private static View poster(Context context, String titel, String bildUrl) {
        FrameLayout bild = MobileViews.poster(context, null, titel, bildUrl, 0,
            POSTER_BREITE_DP, POSTER_HOEHE_DP, 34f, 0);
        LinearLayout kasten = new LinearLayout(context);
        kasten.setOrientation(LinearLayout.VERTICAL);
        kasten.setGravity(Gravity.CENTER_HORIZONTAL);
        kasten.setPadding(0, MobileViews.dp(context, 4), 0, MobileViews.dp(context, 10));
        kasten.addView(bild, new LinearLayout.LayoutParams(
            MobileViews.dp(context, POSTER_BREITE_DP), MobileViews.dp(context, POSTER_HOEHE_DP)));
        return kasten;
    }

    /**
     * Eine Karte des Jahresrückblicks - ohne Bild.
     *
     * <p>Beliebig viele Zeilen, und {@code null} fällt weg. Genau das braucht
     * jede Karte hier: sie hat einen Platz für eine Zahl, die es vielleicht
     * nicht gibt, und dann soll dort nichts stehen - kein leerer Abstand und
     * erst recht keine Null.
     */
    private static View karte(Context context, View... zeilen) {
        return bildkarte(context, "", zeilen);
    }

    /**
     * Dieselbe Karte, mit dem Titelbild als Hintergrund.
     *
     * <p><b>Warum das Bild dazugehört.</b> Am Rechner trägt jede Wrapped-Karte
     * ein Titelbild - weit heruntergedimmt und weich, damit es die Stimmung
     * trägt und nicht die Aussage ({@code .wrapped-backdrop} im Stylesheet).
     * Auf dem Telefon stand stattdessen ein grauer Kasten mit linksbündigem
     * Text: dieselben Zahlen, aber nichts, was nach dem Jahr aussieht, das man
     * hinter sich hat. Gemeldet als "sieht echt schlecht aus, ohne Bilder".
     *
     * <p>Das Bild steckt längst in der Auswertung: {@code statistik.auswerten}
     * gibt zu jeder Serie, jedem Film und zum ersten wie letzten Titel das
     * {@code bild} mit - dieselbe Adresse, die auch die Kacheln der Startseite
     * benutzen. Geholt wird es über {@link Bilder}, also aus demselben Speicher
     * wie dort; eine Karte kostet damit keinen zweiten Ladevorgang.
     *
     * <p>Drei Schichten, in dieser Reihenfolge: das Bild, ein Schleier darüber,
     * der Text zuoberst. Ohne den Schleier stünde die Schrift auf einem
     * beliebigen Bildausschnitt und wäre stellenweise unlesbar; ohne Bild
     * entfallen beide, und die Karte behält ihren eigenen Verlauf.
     *
     * <p>Die Höhe steht fest. Karten mit einer Zeile und Karten mit einer
     * Rangliste sprangen sonst zwischen zwei Fingertipps um die halbe
     * Bildschirmhöhe, und die Punkte darunter sprangen mit.
     */
    private static View bildkarte(Context context, String bildUrl, View... zeilen) {
        FrameLayout rahmen = new FrameLayout(context);
        final int radius = MobileViews.dp(context, MobileViews.CARD_RADIUS);
        rahmen.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View ansicht, Outline umriss) {
                umriss.setRoundRect(0, 0, ansicht.getWidth(), ansicht.getHeight(), radius);
            }
        });
        // Ohne den Zuschnitt stehen die Ecken des Bildes über den runden Ecken
        // der Karte - derselbe Rand wie bei den Kacheln der Startseite.
        rahmen.setClipToOutline(true);

        GradientDrawable grund = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{
                MobileViews.blend(Theme.SURFACE_ELEVATED, Theme.PRIMARY_DEEP, 0.16f),
                Theme.SURFACE,
                MobileViews.blend(Theme.SURFACE, Theme.BACKGROUND, 0.55f)});
        grund.setCornerRadius(radius);
        grund.setStroke(MobileViews.dp(context, 1), Theme.BORDER);
        rahmen.setBackground(grund);
        rahmen.setMinimumHeight(MobileViews.dp(context, KARTE_HOEHE_DP));

        if (bildUrl != null && !bildUrl.trim().isEmpty()) {
            ImageView hintergrund = new ImageView(context);
            hintergrund.setScaleType(ImageView.ScaleType.CENTER_CROP);
            hintergrund.setAlpha(HINTERGRUND_DECKKRAFT);
            rahmen.addView(hintergrund, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            Bilder.laden(hintergrund, bildUrl, 360, KARTE_HOEHE_DP, null);

            View schleier = new View(context);
            schleier.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{
                    Color.argb(170, 7, 10, 18),
                    Color.argb(70, 7, 10, 18),
                    Color.argb(200, 7, 10, 18)}));
            rahmen.addView(schleier, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }

        LinearLayout inhalt = new LinearLayout(context);
        inhalt.setOrientation(LinearLayout.VERTICAL);
        inhalt.setGravity(Gravity.CENTER);
        inhalt.setPadding(MobileViews.dp(context, 24), MobileViews.dp(context, 30),
            MobileViews.dp(context, 24), MobileViews.dp(context, 30));
        for (View zeile : zeilen) {
            if (zeile == null) continue;
            mittig(zeile);
            inhalt.addView(zeile, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }
        rahmen.addView(inhalt, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER));
        return rahmen;
    }

    /**
     * Eine Zeile der Karte mittig stellen.
     *
     * <p>Die Bausteine sind dieselben wie auf der Statistikseite, und dort
     * stehen sie linksbündig - eine Tabelle liest man an ihrer linken Kante.
     * Eine Wrapped-Karte ist keine Tabelle, sondern ein Satz mit einer Zahl;
     * mittig ist dort die Form, die der Rechner auch benutzt.
     *
     * <p>Eine Ebene tief, nicht rekursiv: was hier hereinkommt, ist entweder
     * ein Text oder ein Kasten mit Texten. Balken und Monatsreihen füllen die
     * Breite und sollen von der Mitte nichts wissen.
     */
    private static void mittig(View ansicht) {
        if (ansicht instanceof TextView) {
            ((TextView) ansicht).setGravity(Gravity.CENTER_HORIZONTAL);
            return;
        }
        if (!(ansicht instanceof LinearLayout)) return;
        LinearLayout kasten = (LinearLayout) ansicht;
        if (kasten.getOrientation() == LinearLayout.HORIZONTAL) {
            kasten.setGravity(kasten.getGravity() | Gravity.CENTER_HORIZONTAL);
            return;
        }
        kasten.setGravity(Gravity.CENTER_HORIZONTAL);
        for (int i = 0; i < kasten.getChildCount(); i += 1) {
            View kind = kasten.getChildAt(i);
            if (kind instanceof TextView) ((TextView) kind).setGravity(Gravity.CENTER_HORIZONTAL);
        }
    }

    private static void kopfZahl(Context context, LinearLayout reihe, String wert, String label) {
        LinearLayout block = new LinearLayout(context);
        block.setOrientation(LinearLayout.VERTICAL);
        TextView zahl = new TextView(context);
        zahl.setText(wert);
        zahl.setTextColor(Theme.TEXT_PRIMARY);
        zahl.setTextSize(24);
        zahl.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        block.addView(zahl);
        TextView name = new TextView(context);
        name.setText(label);
        name.setTextColor(Theme.TEXT_SECONDARY);
        name.setTextSize(12);
        // Zwei Zeilen statt einer: Der Titel eines Balkens.
        name.setMaxLines(2);
        name.setEllipsize(TextUtils.TruncateAt.END);
        block.addView(name);
        reihe.addView(block, new LinearLayout.LayoutParams(0,
            ViewGroup.LayoutParams.WRAP_CONTENT, 1));
    }

    private static TextView satz(Context context, String text, int farbe, float groesse) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextColor(farbe);
        view.setTextSize(groesse);
        view.setPadding(0, MobileViews.dp(context, 10), 0, 0);
        return view;
    }

    private static TextView ueberschrift(Context context, String text) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextColor(Theme.TEXT_PRIMARY);
        view.setTextSize(17);
        view.setTypeface(Typeface.DEFAULT_BOLD);
        view.setPadding(0, MobileViews.dp(context, 20), 0, MobileViews.dp(context, 4));
        return view;
    }

    private static LinearLayout kartenKasten(Context context) {
        LinearLayout kasten = new LinearLayout(context);
        kasten.setOrientation(LinearLayout.VERTICAL);
        kasten.setBackground(MobileViews.shape(context, Theme.SURFACE_ELEVATED,
            MobileViews.CARD_RADIUS, Theme.BORDER, 1));
        kasten.setPadding(MobileViews.dp(context, 14), MobileViews.dp(context, 10),
            MobileViews.dp(context, 14), MobileViews.dp(context, 10));
        return kasten;
    }

    /**
     * Ein Raster aus Kacheln.
     *
     * <p>Die Spaltenzahl kommt von aussen: im Hochformat sind zwei richtig, im
     * Querformat passen mehr. Eine feste Zahl wäre auf dem einen Gerät zu eng
     * und auf dem anderen verschenkter Platz.
     */
    static View raster(Context context, List<View> kacheln, int spalten) {
        LinearLayout gitter = new LinearLayout(context);
        gitter.setOrientation(LinearLayout.VERTICAL);
        int stelle = 0;
        while (stelle < kacheln.size()) {
            LinearLayout zeile = new LinearLayout(context);
            zeile.setOrientation(LinearLayout.HORIZONTAL);
            for (int spalte = 0; spalte < spalten; spalte += 1) {
                LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0,
                    ViewGroup.LayoutParams.WRAP_CONTENT, 1);
                if (spalte > 0) params.leftMargin = MobileViews.dp(context, MobileViews.ITEM_GAP);
                if (stelle < kacheln.size()) {
                    zeile.addView(kacheln.get(stelle), params);
                } else {
                    // Ein leerer Platz statt einer breiteren letzten Kachel:
                    // sonst springt die Breite in der letzten Zeile.
                    zeile.addView(new View(context), params);
                }
                stelle += 1;
            }
            LinearLayout.LayoutParams zeilenParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            zeilenParams.topMargin = MobileViews.dp(context, MobileViews.ITEM_GAP);
            gitter.addView(zeile, zeilenParams);
        }
        return gitter;
    }

    /** Die Punkte unter einer Karte des Jahresrückblicks. */
    static View punkte(Context context, int anzahl, int aktiv) {
        LinearLayout reihe = new LinearLayout(context);
        reihe.setOrientation(LinearLayout.HORIZONTAL);
        reihe.setGravity(Gravity.CENTER);
        for (int i = 0; i < anzahl; i += 1) {
            View punkt = new View(context);
            punkt.setBackground(MobileViews.shape(context,
                i == aktiv ? Theme.PRIMARY : Theme.BORDER, 3, Color.TRANSPARENT, 0));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                MobileViews.dp(context, i == aktiv ? 18 : 6), MobileViews.dp(context, 6));
            params.leftMargin = MobileViews.dp(context, 3);
            params.rightMargin = MobileViews.dp(context, 3);
            reihe.addView(punkt, params);
        }
        FrameLayout rahmen = new FrameLayout(context);
        rahmen.addView(reihe, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER));
        return rahmen;
    }
}
