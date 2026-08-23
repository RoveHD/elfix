package local.elflix.android;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * Alles, was ELFIX sich gemerkt hat - und die einzige Stelle, die es aendert.
 *
 * <p>Watchlist, Weiterschauen, Mediathek und Verlauf sind vier Blicke auf
 * dieselbe Liste. Welcher Eintrag wohin gehoert, entscheidet nicht diese
 * Klasse, sondern die geteilte Regel im {@link Kern} - dieselbe, die am Desktop
 * laeuft. Hier steht nur, wie die Antwort in die Ablage kommt und wer davon
 * erfaehrt.
 *
 * <p>Die Trennung ist der Grund, warum sich der Stand ueberhaupt abgleichen
 * laesst: beide Geraete kommen bei derselben Wiedergabe zum selben Eintrag,
 * weil beide dieselbe Funktion fragen.
 */
public final class Bestand {
    private static final String TAG = CrashReporter.TAG;

    /** Wird gerufen, wenn sich etwas geaendert hat - die Oberflaeche zeichnet dann neu. */
    public interface Beobachter {
        void bestandGeaendert();
    }

    /** Etwas, das dem Benutzer zu sagen waere. */
    public interface Melder {
        void melde(String text);
    }

    /** Wohin ein frisch verbuchter Stand zusaetzlich gehoert - die Watchparty. */
    public interface StandMelder {
        void melde(JSONObject eintrag);
    }

    private final Context context;
    private final Kern kern;
    private final Beobachter beobachter;
    private final Melder melder;

    private JSONArray eintraege = new JSONArray();
    /** Welcher Eintrag gerade geoeffnet ist - entscheidet bei mehrfach vorhandenen Titeln. */
    private String aktiverEintragId = "";
    private StandMelder standMelder;

    public Bestand(Context context, Kern kern, Beobachter beobachter, Melder melder) {
        this.context = context.getApplicationContext();
        this.kern = kern;
        this.beobachter = beobachter;
        this.melder = melder;
    }

    /**
     * Wohin ein verbuchter Stand ausserdem geht.
     *
     * <p>Genau eine Stelle: die Watchparty. Am Rechner steht dafuer ein Aufruf
     * am Ende von recordMediaActivity; hier haengt er an derselben Stelle,
     * damit gemeldet wird, was wirklich abgelegt wurde - und nicht das, was
     * gemessen wurde.
     */
    public void setzeStandMelder(StandMelder melder) {
        this.standMelder = melder;
    }

    public void laden() {
        eintraege = FavoriteStore.ladeRoh(context);
        Log.i(TAG, "Bestand geladen: " + eintraege.length() + " Eintraege");
    }

    public void speichern() {
        FavoriteStore.speichereRoh(context, eintraege);
    }

    public String aktiverEintragId() {
        return aktiverEintragId;
    }

    public void setzeAktivenEintrag(String id) {
        aktiverEintragId = id == null ? "" : id;
    }

    /* ------------------------------------------------------------- Ansichten */

    public List<Favorite> alle() {
        ArrayList<Favorite> liste = new ArrayList<>(eintraege.length());
        for (int i = 0; i < eintraege.length(); i += 1) {
            JSONObject roh = eintraege.optJSONObject(i);
            if (roh != null) liste.add(new Favorite(roh));
        }
        return liste;
    }

    /**
     * Weiterschauen: was angefangen und nicht abgeschlossen ist.
     *
     * <p>Sortiert nach dem letzten Mal, dass wirklich etwas lief - nicht nach
     * dem letzten Oeffnen. Sonst schoebe ein versehentlicher Klick einen Titel
     * nach vorn, den man gar nicht geschaut hat.
     */
    public List<Favorite> weiterschauen() {
        ArrayList<Favorite> liste = new ArrayList<>();
        for (Favorite eintrag : alle()) {
            if (eintrag.stehtInWeiterschauen()) liste.add(eintrag);
        }
        Collections.sort(liste, Comparator.comparing(
            (Favorite eintrag) -> eintrag.lastWatchedAt()).reversed());
        return liste;
    }

    /** Die Merkliste: gemerkt, aber noch nicht durch. */
    public List<Favorite> watchlist() {
        ArrayList<Favorite> liste = new ArrayList<>();
        for (Favorite eintrag : alle()) {
            if (eintrag.istWatchlist() && !eintrag.istAbgeschlossen()) liste.add(eintrag);
        }
        return liste;
    }

    /** Die Mediathek: was durch ist. */
    public List<Favorite> mediathek() {
        ArrayList<Favorite> liste = new ArrayList<>();
        for (Favorite eintrag : alle()) {
            if (eintrag.istAbgeschlossen()) liste.add(eintrag);
        }
        return liste;
    }

    /** Der Verlauf: alles, in der Reihenfolge der Ablage - die ist bereits die zeitliche. */
    public List<Favorite> verlauf() {
        return alle();
    }

    public Favorite mitId(String id) {
        if (id == null || id.isEmpty()) return null;
        for (Favorite eintrag : alle()) {
            if (id.equals(eintrag.id())) return eintrag;
        }
        return null;
    }

    /* ------------------------------------------------------------ Verbuchen */

    /**
     * Meldet, was gerade lief, und laesst die geteilte Regel entscheiden.
     *
     * <p>Genau das ist die Stelle, an der Android und Desktop dasselbe tun:
     * dieselbe Funktion, dieselben Schwellen, dieselbe Entscheidung darueber,
     * ob eine Folge durch ist und wohin der Eintrag rueckt. Was hier
     * zurueckkommt, ist bereits die fertige Liste.
     *
     * @param meta was die Seite gemeldet hat: currentTime, duration, watchedSeconds, title, ...
     */
    public void verbuchen(Provider provider, String url, JSONObject meta, boolean watchpartyFuehrt) {
        if (kern == null || !kern.istBereit() || provider == null || url == null) return;
        JSONObject zustand = new JSONObject();
        try {
            zustand.put("favoriten", eintraege);
            zustand.put("aktiverFavoritId", aktiverEintragId);
            zustand.put("watchpartyFuehrt", watchpartyFuehrt);
        } catch (Exception fehler) {
            Log.e(TAG, "Zustand liess sich nicht bauen", fehler);
            return;
        }
        JSONArray argumente = new JSONArray();
        argumente.put(zustand);
        argumente.put(provider.alsJson());
        argumente.put(url);
        argumente.put(meta == null ? new JSONObject() : meta);
        argumente.put(new JSONObject());

        kern.rufe("fortschritt.medienStandVerbuchen", argumente, (wert, fehler) -> {
            if (fehler != null) {
                Log.e(TAG, "Fortschritt nicht verbucht: " + fehler);
                return;
            }
            uebernehmen(wert);
        });
    }

    private void uebernehmen(String ergebnisJson) {
        try {
            JSONObject ergebnis = new JSONObject(ergebnisJson);
            JSONArray neueListe = ergebnis.optJSONArray("favoriten");
            JSONObject eintrag = ergebnis.optJSONObject("eintrag");

            JSONArray meldungen = ergebnis.optJSONArray("meldungen");
            if (meldungen != null && melder != null) {
                for (int i = 0; i < meldungen.length(); i += 1) {
                    String text = meldungen.optString(i, "");
                    if (!text.isEmpty()) melder.melde(text);
                }
            }
            // Ohne Eintrag hat die Regel bewusst nichts uebernommen - etwa weil
            // die 2:30 noch nicht um sind. Dann bleibt auch die Ablage, wie sie
            // war; ein Speichern waere hier nur unnoetiges Schreiben.
            if (eintrag == null) return;

            if (neueListe != null) eintraege = neueListe;
            aktiverEintragId = eintrag.optString("id", aktiverEintragId);
            speichern();
            if (standMelder != null) standMelder.melde(eintrag);
            if (beobachter != null) beobachter.bestandGeaendert();
        } catch (Exception fehler) {
            Log.e(TAG, "Ergebnis des Kerns unlesbar", fehler);
        }
    }

    /**
     * Legt einen Eintrag fuer diese Adresse an und setzt ihn auf die Watchlist.
     *
     * <p>Angelegt wird ueber dieselbe Regel wie jeder gemessene Stand - nur
     * ohne Wiedergabedaten. So bekommt ein von Hand gemerkter Titel dieselben
     * Felder wie ein erschauter, und beim Abgleich mit dem Rechner fehlt
     * nichts.
     */
    public void anlegenUndMerken(Provider provider, String url, JSONObject meta, Runnable danach) {
        if (kern == null || !kern.istBereit() || provider == null || url == null) return;
        JSONObject zustand = new JSONObject();
        JSONObject angaben = meta == null ? new JSONObject() : meta;
        try {
            zustand.put("favoriten", eintraege);
            zustand.put("aktiverFavoritId", aktiverEintragId);
            zustand.put("watchpartyFuehrt", false);
            // Ohne Videodaten legt die Regel nichts an - das ist richtig, denn
            // sonst fuellte jeder geoeffnete Reiter die Liste. Beim Herzknopf
            // ist die Absicht aber eindeutig, deshalb zaehlt hier ein
            // Mindeststand als Anlass.
            if (!angaben.has("currentTime")) angaben.put("currentTime", 0.1);
            if (!angaben.has("duration")) angaben.put("duration", 1);
            if (!angaben.has("watchedSeconds")) angaben.put("watchedSeconds", 0);
        } catch (Exception fehler) {
            Log.e(TAG, "Eintrag liess sich nicht anlegen", fehler);
            return;
        }
        JSONArray argumente = new JSONArray();
        argumente.put(zustand);
        argumente.put(provider.alsJson());
        argumente.put(url);
        argumente.put(angaben);
        argumente.put(new JSONObject());

        kern.rufe("fortschritt.medienStandVerbuchen", argumente, (wert, fehler) -> {
            if (fehler != null) {
                Log.e(TAG, "Eintrag nicht angelegt: " + fehler);
                return;
            }
            uebernehmen(wert);
            String neueId = aktiverEintragId;
            if (!neueId.isEmpty()) watchlistSetzen(neueId, true);
            if (danach != null) danach.run();
        });
    }

    /**
     * Merkt sich, welcher Eintrag zu der Seite gehoert, die gerade offen ist.
     *
     * <p>Der Herz-Knopf und die Fortschrittsmeldung muessen das jederzeit
     * wissen, koennen aber nicht jedes Mal auf eine Antwort aus dem Kern
     * warten. Deshalb wird es beim Seitenwechsel einmal bestimmt und behalten -
     * genau wie der Hauptprozess es mit seinem aktiven Favoriten haelt.
     */
    public void aktuellenEintragBestimmen(Provider provider, String url, Runnable danach) {
        if (kern == null || !kern.istBereit() || provider == null || url == null) {
            aktiverEintragId = "";
            if (danach != null) danach.run();
            return;
        }
        JSONArray argumente = new JSONArray();
        argumente.put(eintraege);
        argumente.put(provider.alsJson());
        argumente.put(url);
        kern.rufe("fortschritt.eintragFinden", argumente, (wert, fehler) -> {
            aktiverEintragId = "";
            if (fehler == null && wert != null) {
                // Der Wert kommt als JSON-Text an; eine Kennung ist in
                // Anfuehrungszeichen gefasst.
                String text = wert.trim();
                if (text.length() >= 2 && text.startsWith("\"") && text.endsWith("\"")) {
                    text = text.substring(1, text.length() - 1);
                }
                if (!"null".equals(text)) aktiverEintragId = text;
            }
            if (danach != null) danach.run();
        });
    }

    /**
     * Zieht den geoeffneten Eintrag nach, wenn jemand zur naechsten Folge
     * blaettert, ohne dass etwas gelaufen waere.
     *
     * <p>Der zweite Weg, auf dem sich ein Stand bewegt. Die Entscheidung faellt
     * im geteilten Modul, damit sie hier nicht anders ausfaellt als am Rechner.
     */
    public void nachziehen(Provider provider, String url, String folgemodus) {
        if (kern == null || !kern.istBereit() || provider == null || url == null) return;
        JSONObject eintrag = rohMitId(aktiverEintragId);
        if (eintrag == null) return;

        JSONArray argumente = new JSONArray();
        argumente.put(eintrag);
        argumente.put(url);
        argumente.put(provider.alsJson());
        argumente.put(folgemodus == null ? "sequential" : folgemodus);

        kern.rufe("fortschritt.favoritNachziehen", argumente, (wert, fehler) -> {
            if (fehler != null || wert == null) return;
            try {
                JSONObject urteil = new JSONObject(wert);
                String art = urteil.optString("art", "nichts");
                if ("loesen".equals(art)) {
                    // Der Benutzer ist woandershin gegangen - dieser Eintrag
                    // ist nicht mehr der geoeffnete.
                    aktiverEintragId = "";
                    return;
                }
                if (!"nachziehen".equals(art)) return;
                JSONObject aenderung = urteil.optJSONObject("aenderung");
                if (aenderung == null) return;
                for (java.util.Iterator<String> namen = aenderung.keys(); namen.hasNext(); ) {
                    String name = namen.next();
                    eintrag.put(name, aenderung.get(name));
                }
                nachVorn(eintrag);
                speichern();
                String meldung = urteil.optString("meldung", "");
                if (!meldung.isEmpty() && melder != null) melder.melde(meldung);
                if (beobachter != null) beobachter.bestandGeaendert();
            } catch (Exception ausnahme) {
                Log.e(TAG, "Nachziehen fehlgeschlagen", ausnahme);
            }
        });
    }

    private void nachVorn(JSONObject eintrag) {
        JSONArray neu = new JSONArray();
        neu.put(eintrag);
        for (int i = 0; i < eintraege.length(); i += 1) {
            JSONObject anderer = eintraege.optJSONObject(i);
            if (anderer == null || anderer == eintrag) continue;
            neu.put(anderer);
        }
        eintraege = neu;
    }

    /* --------------------------------------------------------- Watchparty */

    /**
     * Bindet einen Eintrag an eine Runde - oder loest ihn wieder.
     *
     * <p>Erst dadurch meldet er ueberhaupt etwas: ein Eintrag ohne Raum ist der
     * eigene und bleibt privat. Gibt es zu dem Titel noch keinen Eintrag, wird
     * beim ersten eingehenden Stand einer angelegt.
     */
    public void raumSetzen(String eintragId, String raum) {
        JSONObject eintrag = rohMitId(eintragId);
        if (eintrag == null) return;
        try {
            eintrag.put("watchpartyRoom", raum == null ? "" : raum);
        } catch (Exception fehler) {
            Log.e(TAG, "Raum liess sich nicht setzen", fehler);
            return;
        }
        speichern();
        if (beobachter != null) beobachter.bestandGeaendert();
    }

    /** Der Eintrag zu einer Serienadresse, egal auf welcher Folge er gerade steht. */
    public Favorite zuSerie(String serienUrl) {
        if (serienUrl == null || serienUrl.isEmpty()) return null;
        String gesucht = serienUrl.toLowerCase();
        for (Favorite eintrag : alle()) {
            String url = eintrag.url().toLowerCase();
            if (url.startsWith(gesucht)) return eintrag;
        }
        return null;
    }

    /**
     * Uebernimmt einen Stand aus der Runde.
     *
     * <p>Die Entscheidung faellt im geteilten Modul - dieselbe, die der Rechner
     * trifft. Hier wird sie nur angewandt und abgelegt.
     */
    public void watchpartyStandUebernehmen(String serienUrl, JSONObject stand) {
        if (kern == null || !kern.istBereit() || stand == null) return;
        Favorite lokal = zuSerie(serienUrl);
        if (lokal == null) return;

        kern.rufe("fortschritt.watchpartyStandUebernehmen",
            Kern.args(lokal.roh, stand), (wert, fehler) -> {
                if (fehler != null || wert == null) return;
                try {
                    JSONObject urteil = new JSONObject(wert);
                    if (!"aendern".equals(urteil.optString("art"))) return;
                    JSONObject aenderung = urteil.optJSONObject("aenderung");
                    if (aenderung == null) return;
                    for (java.util.Iterator<String> namen = aenderung.keys(); namen.hasNext(); ) {
                        String name = namen.next();
                        lokal.roh.put(name, aenderung.get(name));
                    }
                    speichern();
                    if (melder != null) {
                        melder.melde("Stand von " + stand.optString("from", "einem Gerät") + " übernommen");
                    }
                    if (beobachter != null) beobachter.bestandGeaendert();
                } catch (Exception ausnahme) {
                    Log.e(TAG, "Stand nicht uebernommen", ausnahme);
                }
            });
    }

    /* ------------------------------------------------ Aenderungen von Hand */

    /** Der Herz-Knopf: auf die Merkliste oder herunter. */
    public void watchlistSetzen(String id, boolean wert) {
        JSONObject eintrag = rohMitId(id);
        if (eintrag == null) return;
        try {
            eintrag.put("favorite", wert);
            if (wert) {
                // Wieder auf die Liste heisst: nicht mehr abgeschlossen. Sonst
                // stuende der Titel gleichzeitig in Watchlist und Mediathek.
                eintrag.put("completed", false);
                eintrag.put("completedManually", false);
                eintrag.put("completedAt", "");
                eintrag.put("hideFromContinueWatching", false);
            }
        } catch (Exception fehler) {
            Log.e(TAG, "Watchlist liess sich nicht setzen", fehler);
            return;
        }
        speichern();
        if (beobachter != null) beobachter.bestandGeaendert();
    }

    /** Von Hand abhaken: der Titel wandert in die Mediathek. */
    public void alsAbgeschlossenMarkieren(String id) {
        JSONObject eintrag = rohMitId(id);
        if (eintrag == null) return;
        try {
            eintrag.put("completed", true);
            eintrag.put("completedManually", true);
            eintrag.put("completedAt", new java.util.Date().toInstant().toString());
            eintrag.put("favorite", false);
            eintrag.put("hideFromContinueWatching", true);
            eintrag.put("continuePending", false);
            eintrag.put("progress", 100);
        } catch (Exception fehler) {
            Log.e(TAG, "Abschluss liess sich nicht setzen", fehler);
            return;
        }
        speichern();
        if (beobachter != null) beobachter.bestandGeaendert();
    }

    /**
     * Aus Weiterschauen nehmen, ohne den Eintrag zu verlieren.
     *
     * <p>Der Titel bleibt im Verlauf und in der Watchlist - nur die Zeile
     * "Weiterschauen" wird ihn los. Loeschen waere hier falsch: wer eine Folge
     * abbricht, will sie nicht vergessen, sondern nur nicht vorgeschlagen
     * bekommen.
     */
    public void ausWeiterschauenNehmen(String id) {
        JSONObject eintrag = rohMitId(id);
        if (eintrag == null) return;
        try {
            eintrag.put("hideFromContinueWatching", true);
            eintrag.put("continuePending", false);
        } catch (Exception fehler) {
            Log.e(TAG, "Eintrag liess sich nicht ausblenden", fehler);
            return;
        }
        speichern();
        if (beobachter != null) beobachter.bestandGeaendert();
    }

    /** Ganz entfernen - aus der Mediathek oder aus dem Verlauf. */
    public void entfernen(String id) {
        if (id == null || id.isEmpty()) return;
        JSONArray behalten = new JSONArray();
        for (int i = 0; i < eintraege.length(); i += 1) {
            JSONObject eintrag = eintraege.optJSONObject(i);
            if (eintrag == null || id.equals(eintrag.optString("id"))) continue;
            behalten.put(eintrag);
        }
        eintraege = behalten;
        if (id.equals(aktiverEintragId)) aktiverEintragId = "";
        speichern();
        if (beobachter != null) beobachter.bestandGeaendert();
    }

    public void verlaufLeeren() {
        // Was auf der Merkliste steht oder in der Mediathek, ist kein Verlauf -
        // es bleibt. Geloescht wird, was nur durchgelaufen ist.
        JSONArray behalten = new JSONArray();
        for (int i = 0; i < eintraege.length(); i += 1) {
            JSONObject eintrag = eintraege.optJSONObject(i);
            if (eintrag == null) continue;
            if (eintrag.optBoolean("favorite") || eintrag.optBoolean("completed")) behalten.put(eintrag);
        }
        eintraege = behalten;
        speichern();
        if (beobachter != null) beobachter.bestandGeaendert();
    }

    /** Die rohe Liste - fuer den Kern und fuer den Abgleich. */
    public JSONArray roh() {
        return eintraege;
    }

    /** Setzt die Liste, wie sie vom Abgleich hereinkommt. */
    public void setzeRoh(JSONArray neu) {
        if (neu == null) return;
        eintraege = neu;
        speichern();
        if (beobachter != null) beobachter.bestandGeaendert();
    }

    private JSONObject rohMitId(String id) {
        if (id == null || id.isEmpty()) return null;
        for (int i = 0; i < eintraege.length(); i += 1) {
            JSONObject eintrag = eintraege.optJSONObject(i);
            if (eintrag != null && id.equals(eintrag.optString("id"))) return eintrag;
        }
        return null;
    }
}
