package local.elflix.android;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Ein Eintrag, wie ELFIX ihn kennt - Watchlist, Weiterschauen, Mediathek und
 * Verlauf sind alles Ansichten auf diese eine Sache.
 *
 * <p>Bis hierher hatte Android acht Felder: Titel, Adresse, Bild und ein
 * bisschen Herkunft. Kein Fortschritt, keine abgeschlossenen Folgen, kein
 * Unterschied zwischen "steht auf der Merkliste" und "laeuft gerade". Damit
 * liess sich die Haelfte der Desktop-Oberflaeche gar nicht bauen, und ein
 * Abgleich zwischen den Geraeten schon zweimal nicht: was hier nicht steht,
 * kann auch nicht mitgeteilt werden.
 *
 * <p>Deshalb ist der Traeger jetzt das rohe {@link JSONObject} in genau der
 * Form, die die Desktop-App ablegt. Die Regel dazu laeuft ohnehin im Kern
 * (siehe {@link Kern}), und die arbeitet auf eben diesen Objekten - wuerde Java
 * sie in eigene Felder umfuellen, waere jedes neue Feld am Desktop hier wieder
 * ein vergessenes. Die Methoden unten lesen nur; geschrieben wird ueber den
 * Kern.
 */
public final class Favorite {
    /** Der Eintrag selbst, im Format der Desktop-App. */
    public final JSONObject roh;

    public Favorite(JSONObject roh) {
        this.roh = roh == null ? new JSONObject() : roh;
    }

    /* ------------------------------------------------------------ Herkunft */

    public String id() {
        return roh.optString("id", "");
    }

    public String providerId() {
        return roh.optString("providerId", "");
    }

    public String providerName() {
        return roh.optString("providerName", "");
    }

    public String url() {
        return roh.optString("url", "");
    }

    public String title() {
        return roh.optString("title", "");
    }

    public String thumbnail() {
        return roh.optString("thumbnail", "");
    }

    /**
     * Ein selbst gewaehltes Titelbild, wenn eines zu diesem Titel abgelegt ist.
     *
     * <p>Es entsteht am Rechner und geht nicht ueber den Geraeteabgleich - es
     * kann hier also fehlen, wo dort eines steht. Steht es da, gilt es.
     */
    public String customThumbnail() {
        return roh.optString("customThumbnail", "");
    }

    /**
     * Das Bild der Karte.
     *
     * <p>Dieselbe Reihenfolge wie am Rechner (siehe {@code favoriteBild} in
     * renderer.js): ein eigenes Bild hat Vorrang, sonst bleibt es beim Bild der
     * Anbieterseite. Ist keines von beiden da, bleibt der Platzhalter mit den
     * Anfangsbuchstaben stehen.
     */
    public String bild() {
        String eigenes = customThumbnail();
        return eigenes.isEmpty() ? thumbnail() : eigenes;
    }

    public String favicon() {
        return roh.optString("favicon", "");
    }

    public String logo() {
        return roh.optString("logo", "");
    }

    public String createdAt() {
        return roh.optString("createdAt", "");
    }

    public String lastWatchedAt() {
        return roh.optString("lastWatchedAt", "");
    }

    /** "serie", "film" oder leer, solange es nicht feststeht. */
    public String type() {
        return roh.optString("type", "");
    }

    /* ---------------------------------------------------------- Fortschritt */

    public int season() {
        return roh.optInt("season", 0);
    }

    public int episode() {
        return roh.optInt("episode", 0);
    }

    /** Wie weit die laufende Folge ist, in Prozent. */
    public int progress() {
        return Math.max(0, Math.min(100, (int) Math.round(roh.optDouble("progress", 0))));
    }

    public double currentTime() {
        double wert = roh.optDouble("currentTime", 0);
        if (wert <= 0) wert = roh.optDouble("position", 0);
        return Math.max(0, wert);
    }

    public double duration() {
        return Math.max(0, roh.optDouble("duration", 0));
    }

    /* ------------------------------------------------------------- Zustand */

    /** Steht auf der Merkliste. Am Desktop heisst das Feld schlicht "favorite". */
    public boolean istWatchlist() {
        return roh.optBoolean("favorite", false);
    }

    /** Ganz durch - der Titel gehoert in die Mediathek, nicht mehr in die Watchlist. */
    public boolean istAbgeschlossen() {
        return roh.optBoolean("completed", false);
    }

    public boolean istVonHandAbgehakt() {
        return roh.optBoolean("completedManually", false);
    }

    public boolean folgeAbgeschlossen() {
        return roh.optBoolean("episodeCompleted", false);
    }

    /** Die naechste Folge steht bereit, angefangen ist sie noch nicht. */
    public boolean wartetAufNaechsteFolge() {
        return roh.optBoolean("continuePending", false);
    }

    public boolean ausWeiterschauenEntfernt() {
        return roh.optBoolean("hideFromContinueWatching", false);
    }

    /** Zu welcher Watchparty-Runde der Stand gehoert; leer heisst: der eigene. */
    public String watchpartyRaum() {
        return roh.optString("watchpartyRoom", "");
    }

    public JSONArray abgeschlosseneFolgen() {
        JSONArray liste = roh.optJSONArray("completedEpisodes");
        return liste == null ? new JSONArray() : liste;
    }

    public JSONArray verlauf() {
        JSONArray liste = roh.optJSONArray("activity");
        return liste == null ? new JSONArray() : liste;
    }

    /* ------------------------------------------------------------ Anzeigen */

    /**
     * Ob der Eintrag in "Weiterschauen" gehoert.
     *
     * <p>Absichtlich dieselbe Bedingung wie {@code hasContinueProgressRecord}
     * im geteilten Modul. Sie steht hier trotzdem noch einmal, weil eine Liste
     * beim Zeichnen nicht auf eine Antwort aus dem Kern warten kann - eine
     * Bildlaufliste, die je Zeile einen Aufruf abwartet, ruckelt. Aendert sich
     * die Regel, ist das hier die eine Stelle, die mitzuziehen ist; der Test
     * dazu haelt beide zusammen.
     */
    public boolean stehtInWeiterschauen() {
        if (istAbgeschlossen() || folgeAbgeschlossen() || ausWeiterschauenEntfernt()) return false;
        if (wartetAufNaechsteFolge()) return true;
        double laufzeit = duration();
        double stand = currentTime();
        if (laufzeit > 0 && stand > 0 && stand <= laufzeit + 3) return true;
        boolean jemalsGeoeffnet = !lastWatchedAt().isEmpty() || !roh.optString("openedAt", "").isEmpty();
        return jemalsGeoeffnet && progress() > 0;
    }

    /**
     * Der Fortschritt, wie ihn der Balken zeigt.
     *
     * <p>Gerechnet aus Stand und Laufzeit, nicht aus dem abgelegten Feld
     * {@code progress} - dieselbe Rechnung wie {@code favoriteProgressPercent}
     * am Rechner. Der Unterschied ist keiner der Genauigkeit, sondern der
     * Aktualitaet: {@code progress} wird an bestimmten Stellen absichtlich
     * gesetzt (auf 0 beim Wechsel zur naechsten Folge, auf 100 beim Abschluss),
     * waehrend Stand und Laufzeit das sind, was zuletzt wirklich gemessen
     * wurde.
     *
     * <p>Fehlt die Laufzeit - ein Eintrag vom Geraeteabgleich, eine Seite ohne
     * lesbaren Player -, bleibt das abgelegte Feld die einzige Auskunft. Dann
     * gilt es.
     */
    public int fortschrittProzent() {
        double laufzeit = duration();
        double stand = currentTime();
        if (laufzeit > 0 && stand >= 0) {
            return Math.max(0, Math.min(100, (int) Math.round(stand / laufzeit * 100)));
        }
        return progress();
    }

    /** "12:34 / 24:10", oder leer, solange die Laufzeit unbekannt ist. */
    public String standText() {
        double laufzeit = duration();
        if (laufzeit <= 0) return "";
        return uhr(currentTime()) + " / " + uhr(laufzeit);
    }

    private static String uhr(double sekunden) {
        long gesamt = Math.max(0, Math.round(sekunden));
        long stunden = gesamt / 3600;
        long minuten = (gesamt % 3600) / 60;
        long rest = gesamt % 60;
        if (stunden > 0) return String.format(java.util.Locale.GERMAN, "%d:%02d:%02d", stunden, minuten, rest);
        return String.format(java.util.Locale.GERMAN, "%d:%02d", minuten, rest);
    }

    /** Wann zu dieser Serie zuletzt eine neue Folge auftauchte; leer heisst: keine. */
    public String neueFolgeAm() {
        return roh.optString("newEpisodeAt", "");
    }

    /** Was auf der Fahne steht - "Folge 12" etwa. Der Rueckfall ist "Neue Folge". */
    public String neueFolgeText() {
        String text = roh.optString("newEpisodeLabel", "");
        return text.isEmpty() ? "Neue Folge" : text;
    }

    /**
     * Wonach "Weiterschauen" sortiert.
     *
     * <p>Dieselbe Staffelung wie {@code favoriteTimestamp} am Rechner, und der
     * Sonderfall dort ist der Grund fuer diese Methode: ein Eintrag einer Runde
     * bekommt bei jeder fremden Meldung eine neue "zuletzt geschaut"-Zeit, im
     * Sekundentakt. Danach zu sortieren liess die Kacheln staendig die Plaetze
     * tauschen, sobald zwei Leute gleichzeitig schauten. Fuer sie zaehlt
     * deshalb, wann dieses Geraet zuletzt selbst dran war.
     *
     * <p>Vorher stand hier nur {@code lastWatchedAt}. Ein Eintrag ohne diesen
     * Zeitstempel - frisch vom Geraeteabgleich, gerade erst geoeffnet - fiel
     * damit ans Ende der Liste, obwohl er der zuletzt angefasste war.
     */
    public long zeitstempel() {
        String[] kandidaten = watchpartyRaum().isEmpty()
            ? new String[]{lastWatchedAt(), roh.optString("openedAt", ""),
                roh.optString("updatedAt", ""), createdAt(), roh.optString("addedAt", "")}
            : new String[]{roh.optString("openedAt", ""), createdAt(),
                roh.optString("addedAt", ""), roh.optString("updatedAt", "")};
        for (String wert : kandidaten) {
            long zeit = alsZeit(wert);
            if (zeit > 0) return zeit;
        }
        return 0;
    }

    /** ISO-Zeit in Millisekunden; 0, wenn dort nichts Lesbares steht. */
    private static long alsZeit(String wert) {
        if (wert == null || wert.isEmpty()) return 0;
        try {
            return java.time.Instant.parse(wert).toEpochMilli();
        } catch (Exception fehler) {
            return 0;
        }
    }

    /** "Staffel 3 Folge 8", "Film" oder leer. */
    public String folgenText() {
        if ("film".equals(type())) return "Film";
        int staffel = season();
        int folge = episode();
        if (folge <= 0) return "";
        return staffel > 0 ? "Staffel " + staffel + " Folge " + folge : "Folge " + folge;
    }
}
