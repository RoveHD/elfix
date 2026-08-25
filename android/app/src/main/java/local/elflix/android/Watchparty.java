package local.elflix.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Die Watchparty auf Android.
 *
 * <p>Die Sache selbst - Verbindung, Wiederanschluss, Uhrenabgleich, Raeume,
 * Mitglieder, Host-Wechsel - laeuft in den geteilten Modulen im {@link Kern}
 * und ist nicht hier nachgebaut. Diese Klasse haelt die Einstellungen, reicht
 * Befehle hinein und nimmt die Meldungen entgegen.
 *
 * <p>Der Zweck der Uebung ist der Abgleich: derselbe Raumcode auf Telefon und
 * Rechner, und der Weiterschauen-Stand laeuft zusammen. Weil beide Geraete
 * denselben Fortschritt nach denselben Regeln errechnen und ihn in derselben
 * Form melden ({@code fortschritt.watchpartyStand}), passt, was ankommt.
 */
public final class Watchparty {
    private static final String TAG = CrashReporter.TAG;
    private static final String PREFS = "elflix_watchparty";

    /** Wenn sich Zustand oder eingestellte Titel geaendert haben. */
    public interface Beobachter {
        void watchpartyGeaendert();

        /**
         * Nur der Stand der Runde hat sich geaendert - wer wo steht.
         *
         * <p>Getrennt gemeldet, weil er im Sekundentakt kommt: die ganze Seite
         * dafuer neu zu bauen hiesse auf dem Fernseher, dass der Fokus jede
         * Sekunde von vorn anfaengt. Wer das nicht unterscheiden will,
         * bekommt die Vorgabe und zeichnet alles neu.
         */
        default void watchpartyStandGeaendert() {
            watchpartyGeaendert();
        }
    }

    private final Context context;
    private final Kern kern;
    private final Beobachter beobachter;
    /** Wohin ein eingehender Stand geht. Wird nach dem Anlegen gesetzt. */
    private Bestand bestand;
    /**
     * Das Mitschauen am Player. Wird nach dem Anlegen gesetzt.
     *
     * <p>Getrennt gehalten, weil es eine andere Lebensdauer hat: die Runde
     * ueberdauert jede Folge, der Player nicht einmal einen Hosterwechsel.
     * Diese Klasse weiss nichts davon, wie ein Video angehalten wird - sie
     * reicht nur weiter, was das Relay dazu meldet.
     */
    private Mitschauen mitschauen;

    private boolean eingeschaltet;
    private String serverUrl = "";
    private String geraetName = "";
    private String geraetId = "";
    private final List<String> raumcodes = new ArrayList<>();

    /** Der zuletzt gemeldete Zustand - fuer die Anzeige, ohne den Kern zu fragen. */
    private JSONObject letzterStatus = new JSONObject();
    private JSONArray letzteEintraege = new JSONArray();
    /** Die letzte Standmeldung der Runde - wer steht wo, wer fuehrt, wer hat gedrueckt. */
    private String letzterMitschauStand = "";
    /** Die eingerichteten Anbieter, wie der Kern sie kennt. Siehe {@link #setzeAnbieter}. */
    private JSONArray anbieter = new JSONArray();

    public Watchparty(Context context, Kern kern, Beobachter beobachter) {
        this.context = context.getApplicationContext();
        this.kern = kern;
        this.beobachter = beobachter;
        laden();
    }

    /* -------------------------------------------------------- Einstellungen */

    private void laden() {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        eingeschaltet = prefs.getBoolean("enabled", false);
        serverUrl = prefs.getString("serverUrl", "");
        geraetName = prefs.getString("deviceName", "");
        geraetId = prefs.getString("deviceId", "");
        if (geraetId.isEmpty()) {
            // Eine eigene Kennung, die bleibt. Ohne sie holt sich jede
            // Verbindung eine eigene vom Relay, und dann gilt dasselbe Geraet
            // in zwei Raeumen als zwei - der Beitritt im einen wirft einen aus
            // dem anderen.
            geraetId = UUID.randomUUID().toString();
            prefs.edit().putString("deviceId", geraetId).apply();
        }
        raumcodes.clear();
        try {
            JSONArray gespeichert = new JSONArray(prefs.getString("rooms", "[]"));
            for (int i = 0; i < gespeichert.length(); i += 1) {
                String code = gespeichert.optString(i, "").trim();
                if (!code.isEmpty() && !raumcodes.contains(code)) raumcodes.add(code);
            }
        } catch (Exception fehler) {
            Log.e(TAG, "Raumcodes unlesbar", fehler);
        }
    }

    private void speichern() {
        JSONArray codes = new JSONArray();
        for (String code : raumcodes) codes.put(code);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("enabled", eingeschaltet)
            .putString("serverUrl", serverUrl)
            .putString("deviceName", geraetName)
            .putString("deviceId", geraetId)
            .putString("rooms", codes.toString())
            .apply();
    }

    public boolean istEingeschaltet() {
        return eingeschaltet;
    }

    public String serverUrl() {
        return serverUrl;
    }

    /**
     * Die Kennung dieses Geraets.
     *
     * <p>Dieselbe wie beim Geraeteabgleich - es gibt keinen Grund, dort eine
     * zweite zu fuehren, und zwei Kennungen fuer dasselbe Geraet waeren fuer das
     * Relay zwei Geraete.
     */
    public String geraetId() {
        return geraetId;
    }

    public String geraetName() {
        return geraetName;
    }

    public List<String> raumcodes() {
        return new ArrayList<>(raumcodes);
    }

    public void setzeEingeschaltet(boolean wert) {
        eingeschaltet = wert;
        speichern();
        anwenden();
    }

    public void setzeServer(String url) {
        serverUrl = url == null ? "" : url.trim();
        speichern();
        anwenden();
    }

    public void setzeGeraetName(String name) {
        geraetName = name == null ? "" : name.trim();
        speichern();
        anwenden();
    }

    /**
     * Traegt einen Raumcode ein.
     *
     * @return {@code null}, wenn er angenommen wurde, sonst die Beanstandung
     *         im Wortlaut des geteilten Moduls
     */
    public void raumHinzufuegen(String code, Kern.Antwort antwort) {
        String sauber = code == null ? "" : code.trim();
        if (kern == null || !kern.istBereit()) {
            antwort.fertig(null, "Der Kern läuft noch nicht");
            return;
        }
        kern.rufe("watchparty-bruecke.codeBeanstandung", Kern.args(sauber), (wert, fehler) -> {
            String beanstandung = textAus(wert);
            if (fehler != null) {
                antwort.fertig(null, fehler);
                return;
            }
            if (beanstandung != null && !beanstandung.isEmpty()) {
                antwort.fertig(null, beanstandung);
                return;
            }
            if (!raumcodes.contains(sauber)) raumcodes.add(sauber);
            speichern();
            anwenden();
            antwort.fertig(sauber, null);
        });
    }

    public void raumEntfernen(String code) {
        raumcodes.remove(code);
        speichern();
        anwenden();
    }

    /* --------------------------------------------------------------- Betrieb */

    /** Schiebt die Einstellungen in den Kern. Ohne Server bleibt alles aus. */
    public void anwenden() {
        if (kern == null || !kern.istBereit()) return;
        JSONObject einstellungen = new JSONObject();
        try {
            JSONArray codes = new JSONArray();
            for (String code : raumcodes) codes.put(code);
            einstellungen.put("enabled", eingeschaltet);
            einstellungen.put("serverUrl", serverUrl);
            einstellungen.put("rooms", codes);
            einstellungen.put("deviceName", geraetName);
            einstellungen.put("deviceId", geraetId);
        } catch (Exception fehler) {
            Log.e(TAG, "Watchparty-Einstellungen liessen sich nicht bauen", fehler);
            return;
        }
        kern.rufe("watchparty-bruecke.konfigurieren", Kern.args(einstellungen), (wert, fehler) -> {
            if (fehler != null) {
                Log.e(TAG, "Watchparty nicht eingerichtet: " + fehler);
                return;
            }
            statusUebernehmen(wert);
        });
    }

    /** Verarbeitet, was der Kern von sich aus meldet. */
    public void ereignis(String name, String nutzlastJson) {
        switch (name) {
            case "watchparty:status":
                statusUebernehmen(nutzlastJson);
                break;
            case "watchparty:zustand":
                eintraegeHolen();
                break;
            case "watchparty:fortschritt":
                standUebernehmen(nutzlastJson);
                break;
            case "watchparty:kennung":
                try {
                    String kennung = new JSONObject(nutzlastJson).optString("kennung", "");
                    if (!kennung.isEmpty() && !kennung.equals(geraetId)) {
                        geraetId = kennung;
                        speichern();
                    }
                } catch (Exception fehler) {
                    Log.e(TAG, "Kennung unlesbar", fehler);
                }
                break;
            case "watchparty:steuerung":
                // Play, Pause, Sprung und Folgenwechsel aus der Runde. Was
                // damit geschieht, entscheidet der Kern und fuehrt
                // {@link Mitschauen} aus - hier wird nur zugestellt.
                if (mitschauen != null) mitschauen.steuerung(nutzlastJson);
                break;
            case "watchparty:stand":
                // Wer steht wo. Fuer die Anzeige; der Player braucht davon
                // nichts, er bekommt seine Anweisungen ueber die Steuerung.
                letzterMitschauStand = nutzlastJson == null ? "" : nutzlastJson;
                if (beobachter != null) beobachter.watchpartyStandGeaendert();
                break;
            case "watchparty:verbindung":
                // Die Leitung ist wieder offen. Der Raumzustand kommt vom
                // Relay von selbst; was hier fehlt, ist der Stand der
                // laufenden Folge - den holt der Abgleich.
                if (mitschauen != null) mitschauen.nachWiederanschluss(nutzlastJson);
                if (beobachter != null) beobachter.watchpartyGeaendert();
                break;
            default:
                Log.d(TAG, "Watchparty-Ereignis " + name + ": " + nutzlastJson);
                break;
        }
    }

    /**
     * Ein Stand aus der Runde ist angekommen.
     *
     * <p>Das Relay reicht ihn unter dem Schluessel des Titels durch - der ist
     * die Serienadresse, nicht die der Folge. Was damit geschieht, entscheidet
     * die geteilte Regel im Bestand.
     */
    private void standUebernehmen(String json) {
        if (bestand == null || json == null) return;
        try {
            JSONObject nachricht = new JSONObject(json);
            JSONObject stand = nachricht.optJSONObject("progress");
            String key = nachricht.optString("key", "");
            if (stand == null || key.isEmpty()) return;
            bestand.watchpartyStandUebernehmen(key, stand);
        } catch (Exception fehler) {
            Log.e(TAG, "Eingehender Stand unlesbar", fehler);
        }
    }

    private void statusUebernehmen(String json) {
        try {
            if (json != null) letzterStatus = new JSONObject(json);
        } catch (Exception fehler) {
            Log.e(TAG, "Watchparty-Status unlesbar", fehler);
        }
        if (beobachter != null) beobachter.watchpartyGeaendert();
    }

    private void eintraegeHolen() {
        if (kern == null || !kern.istBereit()) return;
        // Mit den Anbietern: die Antwort traegt dann auch, ob ein Eintrag sich
        // oeffnen laesst und mit welchem Anbieter - beides braucht die Karte.
        kern.rufe("watchparty-bruecke.eintraegeMitAnbieter", Kern.args(anbieter), (wert, fehler) -> {
            if (fehler != null || wert == null) return;
            try {
                letzteEintraege = new JSONArray(wert);
            } catch (Exception ausnahme) {
                Log.e(TAG, "Watchparty-Eintraege unlesbar", ausnahme);
                return;
            }
            if (beobachter != null) beobachter.watchpartyGeaendert();
        });
    }

    public boolean istVerbunden() {
        return letzterStatus.optBoolean("connected", false);
    }

    public String fehlertext() {
        return letzterStatus.optString("error", "");
    }

    /** Die Raeume mit ihrem Verbindungszustand, so wie der Kern sie sieht. */
    public JSONArray raeume() {
        JSONArray liste = letzterStatus.optJSONArray("rooms");
        return liste == null ? new JSONArray() : liste;
    }

    /** Was in den Raeumen eingestellt ist. */
    public JSONArray eintraege() {
        return letzteEintraege;
    }

    /**
     * Wer gerade wo steht - so, wie das Relay es zuletzt gemeldet hat.
     *
     * <p>Traegt die Mitglieder mit Position, Pausenzustand und Hostmarke, dazu
     * {@code pausedBy} und {@code lastAction}: wer zuletzt gedrueckt hat. Das
     * ist etwas anderes als "wer ist gerade angehalten" - zieht ein zweites
     * Geraet die Pause nur mit, bleibt der Ausloeser derselbe. Genau die
     * Unterscheidung, die die Anzeige braucht, damit dort nicht ein veralteter
     * Name steht.
     */
    public JSONObject mitschauStand() {
        if (letzterMitschauStand.isEmpty()) return new JSONObject();
        try {
            return new JSONObject(letzterMitschauStand);
        } catch (Exception fehler) {
            return new JSONObject();
        }
    }

    /* ------------------------------------------------------------ Anschluss */

    /** Stellt einen Titel in einen Raum ein, damit die anderen ihn sehen. */
    public void teilen(Favorite eintrag, String raum, Kern.Antwort antwort) {
        if (kern == null || !kern.istBereit()) {
            antwort.fertig(null, "Der Kern läuft noch nicht");
            return;
        }
        JSONObject item = new JSONObject();
        try {
            item.put("key", schluessel(eintrag));
            item.put("title", eintrag.title());
            item.put("url", eintrag.url());
            item.put("providerName", eintrag.providerName());
            item.put("thumbnail", eintrag.thumbnail());
            item.put("season", eintrag.season());
            item.put("episode", eintrag.episode());
        } catch (Exception fehler) {
            antwort.fertig(null, "Titel liess sich nicht einstellen: " + fehler);
            return;
        }
        kern.rufe("watchparty-bruecke.teilen", Kern.args(item, raum), antwort);
    }

    /** Der Bestand, in den eingehende Staende laufen. */
    public void setzeBestand(Bestand bestand) {
        this.bestand = bestand;
    }

    /**
     * Die eingerichteten Anbieter.
     *
     * <p>Die Bruecke braucht sie, um einem Eintrag der Runde einen Anbieter
     * zuzuordnen - dieselbe Frage, die der Rechner mit
     * {@code providerForWatchpartyUrl} beantwortet, und dieselbe Funktion
     * ({@code geraete-stand.anbieterFinden}). Ohne sie liesse sich nicht
     * sagen, ob ein Eintrag ueberhaupt zu oeffnen ist.
     */
    public void setzeAnbieter(java.util.List<Provider> anbieter) {
        JSONArray liste = new JSONArray();
        if (anbieter != null) {
            for (Provider eintrag : anbieter) {
                if (eintrag != null) liste.put(eintrag.alsJson());
            }
        }
        this.anbieter = liste;
    }

    /** Wer die Steuerbefehle der Runde am Player ausfuehrt. */
    public void setzeMitschauen(Mitschauen mitschauen) {
        this.mitschauen = mitschauen;
    }

    /**
     * Der Runde beitreten - und den eigenen Eintrag an sie binden.
     *
     * <p>Erst das Binden macht den Beitritt wirksam: ohne Raum am Eintrag
     * meldet er nichts, und dann liefe der Abgleich nur in eine Richtung.
     */
    public void beitreten(String key, String raum, Kern.Antwort antwort) {
        kern.rufe("watchparty-bruecke.beitreten", Kern.args(key, raum), (wert, fehler) -> {
            if (fehler == null && bestand != null) {
                Favorite lokal = bestand.zuSerie(key);
                if (lokal != null) bestand.raumSetzen(lokal.id(), raum);
            }
            antwort.fertig(wert, fehler);
        });
    }

    /** Die Runde verlassen - der Eintrag wird wieder privat. */
    public void verlassen(String key, String raum, Kern.Antwort antwort) {
        kern.rufe("watchparty-bruecke.verlassen", Kern.args(key, raum), (wert, fehler) -> {
            if (fehler == null && bestand != null) {
                Favorite lokal = bestand.zuSerie(key);
                if (lokal != null) bestand.raumSetzen(lokal.id(), "");
            }
            antwort.fertig(wert, fehler);
        });
    }

    public void herausnehmen(String key, String raum, Kern.Antwort antwort) {
        kern.rufe("watchparty-bruecke.entfernen", Kern.args(key, raum), antwort);
    }

    /**
     * Wohin ein Eintrag fuehrt, wenn man ihn oeffnet.
     *
     * <p>Beantwortet wird das in der Bruecke, nicht hier: welche Adresse gilt
     * (die der Folge vor der der Serie) und welcher Anbieter dazugehoert, sind
     * Regeln, die der Rechner schon hat. Diese Klasse reicht nur die Frage
     * hinein und die Antwort heraus.
     */
    public void oeffnungsZiel(String key, String raum, Kern.Antwort antwort) {
        if (kern == null || !kern.istBereit()) {
            antwort.fertig(null, "Der Kern läuft noch nicht");
            return;
        }
        kern.rufe("watchparty-bruecke.oeffnungsZiel", Kern.args(key, raum, anbieter), antwort);
    }

    /**
     * Den Host an ein anderes Geraet weitergeben.
     *
     * <p>Das Relay prueft noch einmal nach, ob der Empfaenger bei derselben
     * Folge wirklich mitschaut - hier wird nur gefragt.
     */
    public void hostUebergeben(String key, String memberId, String raum, Kern.Antwort antwort) {
        kern.rufe("watchparty-bruecke.hostUebergeben", Kern.args(key, memberId, raum), antwort);
    }

    /** Ein Mitglied aus diesem Titel werfen - nur fuer den, der ihn eingestellt hat. */
    public void rauswerfen(String key, String memberId, String raum, Kern.Antwort antwort) {
        kern.rufe("watchparty-bruecke.rauswerfen", Kern.args(key, memberId, raum), antwort);
    }

    /**
     * Meldet den Stand eines Eintrags in seine Runde.
     *
     * <p>Wird nach jedem verbuchten Fortschritt gerufen. Traegt der Eintrag
     * keinen Raum, geschieht nichts - der eigene Stand bleibt privat.
     */
    public void standMelden(JSONObject eintrag) {
        if (kern == null || !kern.istBereit() || eintrag == null) return;
        String raum = eintrag.optString("watchpartyRoom", "");
        if (raum.isEmpty()) return;
        kern.rufe("watchparty-bruecke.standMelden",
            Kern.args(eintrag, schluesselAus(eintrag), geraetName), (wert, fehler) -> {
                if (fehler != null) Log.e(TAG, "Stand nicht gemeldet: " + fehler);
            });
    }

    /**
     * Der Schluessel, unter dem ein Titel in der Runde bekannt ist.
     *
     * <p>Bewusst nicht die Folgenadresse, sondern die der Serie: die Runde
     * fuehrt einen Titel, nicht eine Folge - sonst waere jede neue Folge ein
     * neuer Eintrag im Raum.
     */
    private static String schluessel(Favorite eintrag) {
        return schluesselAus(eintrag.roh);
    }

    private static String schluesselAus(JSONObject eintrag) {
        String url = eintrag.optString("url", "");
        return url.replaceAll("(?i)/(staffel|season)-\\d+(/(episode|folge)-\\d+)?/?$", "")
            .replaceAll("/+$", "")
            .toLowerCase();
    }

    private static String textAus(String jsonWert) {
        if (jsonWert == null) return "";
        String text = jsonWert.trim();
        if ("null".equals(text)) return "";
        if (text.length() >= 2 && text.startsWith("\"") && text.endsWith("\"")) {
            try {
                return new JSONArray("[" + text + "]").getString(0);
            } catch (Exception ignoriert) {
                return text.substring(1, text.length() - 1);
            }
        }
        return text;
    }
}
