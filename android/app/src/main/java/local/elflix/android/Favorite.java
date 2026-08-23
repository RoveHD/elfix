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

    /** "Staffel 3 Folge 8", "Film" oder leer. */
    public String folgenText() {
        if ("film".equals(type())) return "Film";
        int staffel = season();
        int folge = episode();
        if (folge <= 0) return "";
        return staffel > 0 ? "Staffel " + staffel + " Folge " + folge : "Folge " + folge;
    }
}
