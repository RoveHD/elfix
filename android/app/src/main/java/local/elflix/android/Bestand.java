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

    /**
     * Wer ausserdem erfaehrt, dass gerade etwas lief - die gemessene Zeit.
     *
     * <p>Getrennt vom {@link StandMelder}, weil es etwas anderes meldet: der
     * dort geht der <em>Stand</em> hinaus, hier die <em>Wiedergabe</em>. Am
     * Rechner steht an genau dieser Stelle der Aufruf von {@code sitzungMelden},
     * und zwar erst nach der Regel: gezaehlt wird nur, was auch als Fortschritt
     * durchgegangen ist.
     */
    public interface Sitzungsmelder {
        void melde(Provider provider, String url, JSONObject eintrag, JSONObject fortschritt);
    }

    private final Context context;
    private final Kern kern;
    private final Beobachter beobachter;
    private final Melder melder;

    private JSONArray eintraege = new JSONArray();
    /** Welcher Eintrag gerade geoeffnet ist - entscheidet bei mehrfach vorhandenen Titeln. */
    private String aktiverEintragId = "";
    private StandMelder standMelder;
    private Sitzungsmelder sitzungsmelder;
    /**
     * Die zuletzt gemeldete Art von Diagnose.
     *
     * <p>Die Messung meldet alle fuenf Sekunden. Ohne diesen Merker stuende
     * dieselbe Zeile zwoelfmal in der Minute im Protokoll und man saehe vor
     * lauter Wiederholung die Aenderung nicht.
     */
    private String letzteDiagnose = "";

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

    /** Wer die gemessene Wiedergabezeit mitschreibt. Siehe {@link Sitzungsmelder}. */
    public void setzeSitzungsmelder(Sitzungsmelder melder) {
        this.sitzungsmelder = melder;
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
        Collections.sort(liste, Comparator.comparingLong(Favorite::zeitstempel).reversed());
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

        JSONObject gemeldet = meta == null ? new JSONObject() : meta;
        kern.rufe("fortschritt.medienStandVerbuchen", argumente, (wert, fehler) -> {
            if (fehler != null) {
                Log.e(TAG, "Fortschritt nicht verbucht: " + fehler);
                return;
            }
            uebernehmen(wert, provider, url, gemeldet);
        });
    }

    private void uebernehmen(String ergebnisJson, Provider provider, String url, JSONObject gemeldet) {
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
            //
            // Warum sie nichts uebernommen hat, sagt sie selbst. Am Rechner
            // steht das in der Medien-Diagnose; hier stand es nirgends, und ein
            // Stand, der nicht weiterrueckt, war damit nicht zu erklaeren -
            // man sah die gemessenen Sekunden und danach nichts mehr.
            if (eintrag == null) {
                JSONArray diagnosen = ergebnis.optJSONArray("diagnosen");
                JSONObject erste = diagnosen == null ? null : diagnosen.optJSONObject(0);
                if (erste != null && !erste.optString("art").equals(letzteDiagnose)) {
                    letzteDiagnose = erste.optString("art");
                    Log.i(TAG, "Stand nicht uebernommen (" + letzteDiagnose + "): "
                        + erste.optString("text"));
                }
                return;
            }
            letzteDiagnose = "";

            // Die gemessene Wiedergabezeit festhalten - dieselbe Stelle wie am
            // Rechner, und aus demselben Grund erst hier: gezaehlt wird nur,
            // was die Regel auch als Fortschritt gelten laesst. Die Sekunden
            // entstehen ohnehin, sie wurden bisher nur geprueft und danach
            // weggeworfen.
            if (sitzungsmelder != null) {
                sitzungsmelder.melde(provider, url, eintrag, gemeldet);
            }

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
     * <p>Ueber {@code fortschritt.vonHandAnlegen} und nicht ueber die
     * Fortschrittsregel. Der Unterschied ist keine Feinheit, sondern der
     * Unterschied zwischen "tut etwas" und "tut nichts": die Fortschrittsregel
     * verlangt zu Recht Videodaten, sonst fuellte jeder geoeffnete Reiter die
     * Liste. Hier wurde ihr deshalb ein Mindeststand vorgetaeuscht - mit zwei
     * Folgen, die beide falsch waren.
     *
     * <p>Erstens legte sie bei einer Serienuebersicht und bei jeder Folge
     * ausser der ersten gar nichts an: ohne 2:30 Wiedergabe und ohne Folge 1
     * blockiert sie, und der Herz-Knopf tat schlicht nichts. Zweitens trug ein
     * angelegter Eintrag zehn Prozent Fortschritt und stand damit sofort auch
     * in "Weiterschauen" - vorgemerkt und angefangen sind aber zwei
     * verschiedene Dinge.
     *
     * <p>Die neue Regel steht in demselben geteilten Modul und wird am Rechner
     * an derselben Stelle benutzt (siehe {@code favorites:add-result}).
     *
     * @param meta was ueber den Titel bekannt ist: title, thumbnail, type
     */
    public void anlegenUndMerken(Provider provider, String url, JSONObject meta, Runnable danach) {
        if (kern == null || !kern.istBereit() || provider == null || url == null) return;
        JSONObject zustand = new JSONObject();
        try {
            zustand.put("favoriten", eintraege);
            zustand.put("aktiverFavoritId", aktiverEintragId);
        } catch (Exception fehler) {
            Log.e(TAG, "Eintrag liess sich nicht anlegen", fehler);
            return;
        }
        kern.rufe("fortschritt.vonHandAnlegen",
            Kern.args(zustand, provider.alsJson(), url, meta == null ? new JSONObject() : meta),
            (wert, fehler) -> {
                if (fehler != null) {
                    Log.e(TAG, "Eintrag nicht angelegt: " + fehler);
                    if (melder != null) melder.melde("Konnte nicht gemerkt werden");
                    return;
                }
                try {
                    JSONObject urteil = new JSONObject(wert == null ? "{}" : wert);
                    JSONObject eintrag = urteil.optJSONObject("eintrag");
                    if (eintrag == null) {
                        if (melder != null) melder.melde("Adresse nicht erkannt");
                        return;
                    }
                    JSONArray neueListe = urteil.optJSONArray("favoriten");
                    if (neueListe != null) eintraege = neueListe;
                    aktiverEintragId = eintrag.optString("id", aktiverEintragId);
                    speichern();
                    if (beobachter != null) beobachter.bestandGeaendert();
                    if (danach != null) danach.run();
                } catch (Exception ausnahme) {
                    Log.e(TAG, "Ergebnis des Kerns unlesbar", ausnahme);
                }
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

    /**
     * Der Eintrag zu genau dieser Adresse.
     *
     * <p>Grober Abgleich ueber Protokoll und abschliessenden Schraegstrich
     * hinweg - dieselbe Regel wie {@code adressSchluessel} am Rechner. Fuer die
     * Frage "steht dieser Vorschlag schon auf der Watchlist?" reicht das; was
     * feiner zu entscheiden ist, entscheidet der Kern.
     */
    public Favorite zuAdresse(String url) {
        String gesucht = adressSchluessel(url);
        if (gesucht.isEmpty()) return null;
        for (Favorite eintrag : alle()) {
            if (gesucht.equals(adressSchluessel(eintrag.url()))) return eintrag;
        }
        return null;
    }

    private static String adressSchluessel(String url) {
        String text = url == null ? "" : url.trim();
        // ROOT und nicht die Sprache des Geraets: in der Tuerkei wird aus einem
        // "I" ein punktloses "ı", und zwei Adressen, die gleich sind, waeren
        // es dort nicht mehr.
        return text.replaceFirst("(?i)^https?://", "").replaceAll("/+$", "")
            .toLowerCase(java.util.Locale.ROOT);
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
    /**
     * Sorgt dafuer, dass es zu diesem Titel in dieser Runde einen Eintrag gibt.
     *
     * <p>Gerechnet wird nichts hier: gesucht und angelegt wird in
     * {@code watchparty-bruecke.raumEintragSichern}, und die ruft ihrerseits
     * {@code fortschritt.watchpartyEintragAnlegen} - dieselbe Regel, mit der
     * der Rechner seinen Raum-Eintrag anlegt.
     *
     * @param nimm bekommt die Kennung des Eintrags, oder leer, wenn sich
     *             keiner sicherstellen liess
     */
    public void raumEintragSichern(String key, String raum, JSONArray anbieter, JSONObject stand,
                                   java.util.function.Consumer<String> nimm) {
        if (kern == null || !kern.istBereit() || key == null || key.isEmpty()) {
            nimm.accept("");
            return;
        }
        JSONObject zustand = new JSONObject();
        try {
            zustand.put("favoriten", eintraege);
        } catch (Exception fehler) {
            Log.e(TAG, "Raum-Eintrag liess sich nicht vorbereiten", fehler);
            nimm.accept("");
            return;
        }
        kern.rufe("watchparty-bruecke.raumEintragSichern",
            Kern.args(zustand, key, raum == null ? "" : raum,
                anbieter == null ? new JSONArray() : anbieter,
                stand == null ? new JSONObject() : stand),
            (wert, fehler) -> {
                if (fehler != null || wert == null) {
                    Log.d(TAG, "Raum-Eintrag nicht sichergestellt: " + fehler);
                    nimm.accept("");
                    return;
                }
                try {
                    JSONObject urteil = new JSONObject(wert);
                    String id = urteil.optString("eintragId", "");
                    if (id.isEmpty()) {
                        nimm.accept("");
                        return;
                    }
                    JSONArray neueListe = urteil.optJSONArray("favoriten");
                    if (neueListe != null) eintraege = neueListe;
                    if (urteil.optBoolean("neu", false)) {
                        Log.i(TAG, "Aus der Watchparty uebernommen: " + key + " (Raum " + raum + ")");
                        speichern();
                        if (beobachter != null) beobachter.bestandGeaendert();
                    }
                    nimm.accept(id);
                } catch (Exception ausnahme) {
                    Log.e(TAG, "Antwort zum Raum-Eintrag unlesbar", ausnahme);
                    nimm.accept("");
                }
            });
    }

    /**
     * Dasselbe fuer alle betretenen Titel - in einem einzigen Aufruf.
     *
     * <p><b>Der gemeldete Fehler.</b> {@link Watchparty} rief
     * {@link #raumEintragSichern} je Titel einmal, in einer Schleife. Jeder
     * Aufruf schickt die ganze Ablage in den Kern und bekommt eine neue Liste
     * zurueck - und weil die Antwort erst spaeter kommt, war die Schleife
     * durch, bevor die erste eintraf. Alle Aufrufe trugen damit denselben
     * Schnappschuss, und die letzte Antwort setzte {@code eintraege} auf eine
     * Liste, in der die vorherigen Neuzugaenge nie standen.
     *
     * <p>Am 2026-08-29 am Fire TV Stick gemessen: vier Eintraege angelegt,
     * Bestand danach 80 -> 81. Beim naechsten Start standen drei davon wieder
     * als neu im Protokoll. Auf der Startseite kam so je Start genau eine
     * Runde dazu.
     *
     * @param danach laeuft, wenn dieser Lauf durch ist - erst dann steht die
     *               neue Liste, und erst dann darf der naechste beginnen
     */
    public void raumEintraegeSichern(JSONArray anbieter, Runnable danach) {
        if (kern == null || !kern.istBereit()) {
            danach.run();
            return;
        }
        JSONObject zustand = new JSONObject();
        try {
            zustand.put("favoriten", eintraege);
        } catch (Exception fehler) {
            Log.e(TAG, "Raum-Eintraege liessen sich nicht vorbereiten", fehler);
            danach.run();
            return;
        }
        kern.rufe("watchparty-bruecke.raumEintraegeSichern",
            Kern.args(zustand, anbieter == null ? new JSONArray() : anbieter),
            (wert, fehler) -> {
                // Erst die Antwort einarbeiten, dann melden: wer auf diesen
                // Lauf gewartet hat, faenge sonst mit der alten Liste an.
                try {
                    if (fehler != null || wert == null) {
                        Log.d(TAG, "Raum-Eintraege nicht sichergestellt: " + fehler);
                        return;
                    }
                    JSONObject urteil = new JSONObject(wert);
                    JSONArray neueListe = urteil.optJSONArray("favoriten");
                    if (neueListe != null) eintraege = neueListe;
                    if (!urteil.optBoolean("geaendert", false)) return;
                    JSONArray gesichert = urteil.optJSONArray("gesichert");
                    Log.i(TAG, "Aus der Watchparty uebernommen: "
                        + urteil.optInt("angelegt", 0) + " angelegt, "
                        + (gesichert == null ? 0 : gesichert.length()) + " Runden geprueft");
                    speichern();
                    if (beobachter != null) beobachter.bestandGeaendert();
                } catch (Exception ausnahme) {
                    Log.e(TAG, "Antwort zu den Raum-Eintraegen unlesbar", ausnahme);
                } finally {
                    danach.run();
                }
            });
    }

    /**
     * Den Eintrag zu einer Runde sicherstellen und dann den Stand uebernehmen.
     *
     * <p><b>Der gemeldete Fehler.</b> Hier stand zuerst {@code zuSerie(...)} und
     * darunter {@code if (lokal == null) return;} - kam ein Stand zu einem
     * Titel herein, den diese Ablage nicht kannte, geschah nichts. Angelegt hat
     * ihn auch niemand sonst: die Regel dafuer lag am Rechner in {@code main.js}
     * und damit an einem Ort, den das Telefon nie sieht. Ergebnis: "Gemeinsam
     * weiterschauen" blieb auf Android leer, egal wie lange die Runde lief.
     *
     * <p>Am Geraet nachgestellt (Emulator, echtes Relay, ein zweites Mitglied,
     * das im Sekundentakt meldet): Android trat dem Titel bei, das Relay
     * leitete weiter - und nach zwanzig Sekunden standen zwei Eintraege in der
     * Ablage, <em>keiner</em> mit Raum, der eingestellte Titel gar nicht.
     *
     * <p>{@code zuSerie} war ausserdem in die andere Richtung falsch: es findet
     * <em>irgendeinen</em> Eintrag der Serie, auch den privaten. Der Stand der
     * Runde waere damit in den eigenen Verlauf gelaufen. Gesucht wird jetzt
     * nach Serie <em>und</em> Raum, und das tut die geteilte Regel.
     *
     * @param eintragId die Kennung, die {@code raumEintragSichern} zurueckgibt
     */
    public void watchpartyStandUebernehmen(String eintragId, JSONObject stand) {
        if (kern == null || !kern.istBereit() || stand == null) return;
        Favorite lokal = mitId(eintragId);
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

    /**
     * Ein Titelbild nachtragen, das die Anbieterseite hergegeben hat.
     *
     * <p>Das Gegenstueck zu {@code updateActiveFavoriteTitle} am Rechner: die
     * geteilte Regel setzt das Bild nur beim Anlegen des Eintrags. Wer ihn aus
     * dem Geraeteabgleich oder aus einer aelteren Fassung hat, hat deshalb oft
     * keines - sobald seine Seite offen ist, ist es zu haben.
     *
     * <p>Welcher Eintrag zu dieser Adresse gehoert, entscheidet der Kern und
     * nicht der gemerkte "aktive" Eintrag: der zeigt beim Seitenwechsel einen
     * Augenblick lang noch auf die vorige Seite, und ein Bild am falschen Titel
     * waere schlimmer als gar keins.
     *
     * <p>Nachgetragen wird nur, wo nichts steht. Ein vorhandenes Bild zu
     * ersetzen hiesse, bei jedem Seitenaufruf die Ablage neu zu schreiben und
     * dieselbe Aenderung ueber den Geraeteabgleich hinauszuschicken.
     */
    public void bildNachtragen(Provider provider, String url, String bild) {
        if (kern == null || !kern.istBereit() || provider == null || url == null) return;
        if (bild == null || bild.isEmpty()) return;
        JSONArray argumente = new JSONArray();
        argumente.put(eintraege);
        argumente.put(provider.alsJson());
        argumente.put(url);
        kern.rufe("fortschritt.eintragFinden", argumente, (wert, fehler) -> {
            if (fehler != null || wert == null) return;
            // Der Wert kommt als JSON-Text; eine Kennung ist in
            // Anfuehrungszeichen gefasst.
            String id = wert.trim();
            if (id.length() >= 2 && id.startsWith("\"") && id.endsWith("\"")) {
                id = id.substring(1, id.length() - 1);
            }
            JSONObject eintrag = rohMitId(id);
            if (eintrag == null || !eintrag.optString("thumbnail", "").isEmpty()) return;
            try {
                eintrag.put("thumbnail", bild);
            } catch (Exception ausnahme) {
                Log.e(TAG, "Titelbild nicht nachgetragen", ausnahme);
                return;
            }
            speichern();
            if (beobachter != null) beobachter.bestandGeaendert();
        });
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
