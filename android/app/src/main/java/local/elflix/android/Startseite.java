package local.elflix.android;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Welche Reihen die Startseite zeigt.
 *
 * <p>Am Rechner steht das unter {@code settings.home} und schaltet dort sechs
 * Dinge: Titelbild, YouTube-Reihe, Weiterschauen, "Empfohlen fuer dich", die
 * Kategoriereihen und den Rueckblick. Auf dem Telefon gab es die Einstellung
 * gar nicht - die Reihen standen fest, und wer die Vorschlaege nicht wollte,
 * hatte keine Wahl.
 *
 * <p>Dieselben Schluessel wie am Rechner, absichtlich: sie wandern spaeter
 * ueber denselben Geraeteabgleich wie alles andere, und ein zweiter Satz Namen
 * waere dabei nur eine Uebersetzungsstelle, die etwas verliert. Was am Rechner
 * an ist, ist auch hier an - bis auf {@code showReview}, der dort ebenfalls aus
 * beginnt.
 */
public final class Startseite {
    private static final String PREFS = "elflix_startseite";

    /** Ein Schalter: sein Schluessel, sein Name auf dem Bildschirm, seine Vorgabe. */
    public static final class Reihe {
        public final String schluessel;
        public final String titel;
        public final String erklaerung;
        public final boolean vorgabe;

        Reihe(String schluessel, String titel, String erklaerung, boolean vorgabe) {
            this.schluessel = schluessel;
            this.titel = titel;
            this.erklaerung = erklaerung;
            this.vorgabe = vorgabe;
        }
    }

    public static final String HERO = "showHero";
    public static final String WEITERSCHAUEN = "showFavorites";
    public static final String YOUTUBE = "showYoutube";
    public static final String PERSOENLICH = "showPersonal";
    public static final String KATEGORIEN = "showCategories";
    public static final String RUECKBLICK = "showReview";
    /**
     * Der Kalender.
     *
     * <p>Ein eigener Schluessel und keiner vom Rechner: dort ist der Kalender
     * eine eigene Seite in der Seitenleiste und keine Reihe der Startseite. Auf
     * dem Telefon gibt es keine Seitenleiste, also steht er als Reihe da - und
     * dann gehoert er auch in dieselbe Liste wie die uebrigen Reihen.
     */
    public static final String KALENDER = "showCalendar";

    /** Die Liste in der Reihenfolge, in der die Reihen auf dem Bildschirm stehen. */
    public static final List<Reihe> REIHEN = Arrays.asList(
        new Reihe(HERO, "Titelbild",
            "Der grosse Titel ganz oben, der durch das Zuletztgesehene wechselt.", true),
        new Reihe(KALENDER, "Kalender",
            "Was diese Woche bei deinen Anbietern erscheint.", true),
        new Reihe(WEITERSCHAUEN, "Weiterschauen",
            "Angefangene Folgen, Watchlist und Mediathek.", true),
        new Reihe(YOUTUBE, "YouTube",
            "Angefangene YouTube-Videos in einer eigenen Reihe.", true),
        new Reihe(PERSOENLICH, "Empfohlen für dich",
            "Vorschläge aus deinem Verlauf.", true),
        new Reihe(KATEGORIEN, "Anime, Serien und Filme",
            "Die drei Vorschlagsreihen nach Art.", true),
        new Reihe(RUECKBLICK, "Rückblick",
            "Deine gemessene Zeit als Reihe auf der Startseite.", false)
    );

    private final SharedPreferences prefs;

    public Startseite(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public boolean zeigt(String schluessel) {
        return prefs.getBoolean(schluessel, vorgabe(schluessel));
    }

    public void setzen(String schluessel, boolean wert) {
        prefs.edit().putBoolean(schluessel, wert).apply();
    }

    public void umschalten(String schluessel) {
        setzen(schluessel, !zeigt(schluessel));
    }

    /** Alles zurueck auf die Vorgaben - der Ausweg aus einer leergeraeumten Startseite. */
    public void zuruecksetzen() {
        SharedPreferences.Editor stift = prefs.edit();
        for (Reihe reihe : REIHEN) stift.putBoolean(reihe.schluessel, reihe.vorgabe);
        stift.apply();
    }

    /** Wie viele Reihen gerade an sind - fuer die Zusammenfassung in den Einstellungen. */
    public int anzahlAn() {
        int zahl = 0;
        for (Reihe reihe : REIHEN) {
            if (zeigt(reihe.schluessel)) zahl += 1;
        }
        return zahl;
    }

    public List<Reihe> ausgeschaltete() {
        ArrayList<Reihe> liste = new ArrayList<>();
        for (Reihe reihe : REIHEN) {
            if (!zeigt(reihe.schluessel)) liste.add(reihe);
        }
        return liste;
    }

    static boolean vorgabe(String schluessel) {
        for (Reihe reihe : REIHEN) {
            if (reihe.schluessel.equals(schluessel)) return reihe.vorgabe;
        }
        return true;
    }
}
