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
    /** Beitritte, die von einem anderen Geraet kamen und noch nachzutragen sind. */
    private final List<String[]> offeneBeitritte = new ArrayList<>();
    /** Wird gerufen, wenn sich Raeume oder Beitritte geaendert haben. */
    private Runnable kontoMelder;

    /** Der zuletzt gemeldete Zustand - fuer die Anzeige, ohne den Kern zu fragen. */
    private JSONObject letzterStatus = new JSONObject();
    private JSONArray letzteEintraege = new JSONArray();
    /**
     * Der Raumzustand, fuer den die Eintraege zuletzt sichergestellt wurden.
     *
     * <p>Titel, Raum und der Zeitpunkt jedes Stands. Siehe
     * {@link #raumzustandKennzeichen} und {@link #raumEintraegeSichern}.
     */
    private String letztesRaumkennzeichen = "";
    /** Ob gerade ein Lauf im Kern unterwegs ist - siehe {@link #raumEintraegeSichern}. */
    private boolean raumEintraegeLaeuft;
    /** Ob waehrenddessen ein neuer Raumzustand kam, der noch einen Lauf braucht. */
    private boolean raumEintraegeNachholen;
    /** Die letzte Standmeldung der Runde - wer steht wo, wer fuehrt, wer hat gedrueckt. */
    private String letzterMitschauStand = "";
    /**
     * Dieselben Meldungen, aber nach Titel und Raum abgelegt.
     *
     * <p>Der zuletzt gemeldete Stand allein genuegt fuer die Watchparty-Seite,
     * auf der ohnehin nur eine Karte "wer schaut mit" steht. Die Startseite
     * braucht mehr: dort steht je Titel eine Kachel, und in einem Raum duerfen
     * mehrere Titel laufen. Faende jede Kachel nur die letzte Meldung, zeigten
     * alle denselben Stand - den des Titels, der zufaellig zuletzt gemeldet
     * hat.
     *
     * <p>Dieselbe Ablage wie {@code watchpartyStandKarten} am Rechner, mit
     * demselben Schluessel aus Titel und Raum. Geloescht wird nichts: ob
     * jemand noch dabei ist, entscheidet allein das Alter der Meldung.
     */
    private final java.util.Map<String, JSONArray> standKarten = new java.util.HashMap<>();
    private final java.util.Map<String, Long> standEmpfangen = new java.util.HashMap<>();
    /**
     * Wer den jeweiligen Titel zuletzt angehalten hat - ebenfalls je Titel und
     * Raum.
     *
     * <p>Getrennt von {@link #letzterMitschauStand} und aus demselben Grund wie
     * {@link #standKarten}: laufen Bleach, Korra und BLACK TORCH im selben
     * Raum, gilt "Angehalten von Elias" fuer genau einen davon. Der letzte
     * Zwischenruf gehoerte sonst allen dreien, und der Live-Streifen zeigte bei
     * jeder Folge, was bei der zuletzt gemeldeten geschah.
     */
    private final java.util.Map<String, String> standPausiertVon = new java.util.HashMap<>();
    private final java.util.Map<String, JSONObject> standLetzteAktion = new java.util.HashMap<>();
    /**
     * Wann eine Tat hier zum ersten Mal ankam.
     *
     * <p>Nach eigener Uhr und nicht nach dem Zeitstempel des Relays: der
     * Zwischenruf "Elias hat pausiert" soll nach ein paar Sekunden wieder
     * verschwinden, und wie viele Sekunden das sind, darf nicht davon abhaengen,
     * wie genau die Uhr dieses Geraets gegen die des Relays steht.
     */
    private final java.util.Map<String, Long> standAktionSeit = new java.util.HashMap<>();
    /** Die eingerichteten Anbieter, wie der Kern sie kennt. Siehe {@link #setzeAnbieter}. */
    private JSONArray anbieter = new JSONArray();

    /**
     * Der Schluessel des Geraeteabgleichs, falls einer eingerichtet ist.
     *
     * <p>Er steht hier nur, um ihn an den Kern weiterzureichen, der daraus das
     * Konto ableitet. Gesetzt wird er von {@link Geraete} - die Watchparty
     * fragt den Abgleich nicht, der Abgleich sagt Bescheid.
     */
    private String kontoSchluessel = "";

    /**
     * Sagt der Watchparty, zu welchem Abgleichskonto dieses Geraet gehoert.
     *
     * <p>Ein leerer Schluessel heisst "kein Abgleich": dann entscheidet in der
     * Runde allein das Geraet, genau wie vorher.
     */
    public void setzeKontoSchluessel(String schluessel) {
        String neu = schluessel == null ? "" : schluessel;
        if (neu.equals(kontoSchluessel)) return;
        kontoSchluessel = neu;
        anwenden();
    }

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

    /**
     * Die Serveradresse eintragen - geprüft und in einer Schreibweise.
     *
     * <p>Sie stand an drei Stellen und wurde an jeder ein bisschen anders
     * behandelt: am Rechner nur getrimmt, hier nur getrimmt, und am Fernseher
     * gab es sie gar nicht. Was aus einer Fernbedienungstastatur kommt, trägt
     * Leerzeichen mit, gern einen Schrägstrich am Ende und manchmal
     * unsichtbare Zeichen - jedes davon ergibt eine andere Zeichenkette und
     * damit eine andere Verbindung, obwohl dasselbe Relay gemeint ist.
     *
     * <p>Deshalb entscheidet das auch hier nicht Java, sondern
     * {@code watchparty.js}: dieselbe Normalisierung und derselbe Wortlaut der
     * Beanstandung wie am Rechner. Eine leere Eingabe ist ausdrücklich keine
     * Beanstandung - sie heißt "keine Adresse", und dann bleibt die
     * Watchparty eben aus.
     *
     * @param antwort bekommt die gespeicherte Adresse, oder die Beanstandung
     */
    public void setzeServer(String url, Kern.Antwort antwort) {
        String roh = url == null ? "" : url;
        if (kern == null || !kern.istBereit()) {
            antwort.fertig(null, "Der Kern läuft noch nicht");
            return;
        }
        kern.rufe("watchparty-bruecke.serverBeanstandung", Kern.args(roh), (wert, fehler) -> {
            if (fehler != null) {
                antwort.fertig(null, fehler);
                return;
            }
            String beanstandung = textAus(wert);
            if (beanstandung != null && !beanstandung.isEmpty()) {
                antwort.fertig(null, beanstandung);
                return;
            }
            kern.rufe("watchparty-bruecke.serverNormalisieren", Kern.args(roh),
                (sauber, fehler2) -> {
                    if (fehler2 != null) {
                        antwort.fertig(null, fehler2);
                        return;
                    }
                    serverUrl = textAus(sauber);
                    speichern();
                    anwenden();
                    antwort.fertig(serverUrl, null);
                });
        });
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
            if (kontoMelder != null) kontoMelder.run();
            antwort.fertig(sauber, null);
        });
    }

    public void raumEntfernen(String code) {
        raumcodes.remove(code);
        speichern();
        anwenden();
        if (kontoMelder != null) kontoMelder.run();
    }

    /* ------------------------------------------- Dasselbe Konto, zwei Geraete */

    /**
     * Was ueber den gemeinsamen Schluessel hinausgeht: Raeume und Beitritte.
     *
     * <p>Wer denselben Schluessel hat, ist dasselbe Konto - dann sollen auch
     * die Raeume gelten und dieselben Runden mitlaufen. Ueber die Watchparty
     * selbst ginge das nicht: ein Raumcode ist genau das, was man braucht, um
     * ueberhaupt in einen Raum zu kommen.
     *
     * <p>Ausdruecklich nicht dabei: die Serveradresse (sie kann je Geraet eine
     * andere sein - im Heimnetz eine andere als von draussen) und die
     * Geraetekennung (sie gehoert dem Geraet; zwei Geraete mit derselben
     * gelten im Raum als eines).
     */
    /** Wer erfahren will, dass sich Raeume oder Beitritte geaendert haben. */
    public void setzeKontoMelder(Runnable melder) {
        this.kontoMelder = melder;
    }

    public JSONObject kontoSatz() {
        JSONObject satz = new JSONObject();
        try {
            JSONArray codes = new JSONArray();
            for (String code : raumcodes) codes.put(code);
            satz.put("rooms", codes);
            JSONArray beitritte = new JSONArray();
            JSONArray eintraege = eintraege();
            for (int i = 0; i < eintraege.length(); i += 1) {
                JSONObject eintrag = eintraege.optJSONObject(i);
                if (eintrag == null || !eintrag.optBoolean("joined", false)) continue;
                JSONObject dabei = new JSONObject();
                dabei.put("key", eintrag.optString("key", ""));
                dabei.put("room", eintrag.optString("room", ""));
                if (!dabei.optString("key", "").isEmpty()) beitritte.put(dabei);
            }
            satz.put("joined", beitritte);
        } catch (Exception fehler) {
            Log.e(TAG, "Kontosatz liess sich nicht bauen", fehler);
        }
        return satz;
    }

    /**
     * Und was von einem anderen Geraet desselben Kontos hereinkommt.
     *
     * <p>Ersetzt und nicht vereinigt: wer einen Raum entfernt oder eine Runde
     * verlaesst, schickt eine kuerzere Liste, und die soll gelten. Eine
     * Vereinigung holte beides ewig zurueck. Dass dieser Satz der neuere ist,
     * hat der Abgleich schon entschieden.
     */
    public void kontoSatzUebernehmen(JSONObject satz) {
        if (satz == null) return;

        JSONArray codes = satz.optJSONArray("rooms");
        if (codes != null) {
            List<String> neu = new ArrayList<>();
            for (int i = 0; i < codes.length(); i += 1) {
                String code = codes.optString(i, "").trim();
                if (!code.isEmpty() && !neu.contains(code)) neu.add(code);
            }
            if (!neu.equals(raumcodes)) {
                raumcodes.clear();
                raumcodes.addAll(neu);
                speichern();
                anwenden();
                Log.i(TAG, "Raeume vom anderen Geraet uebernommen: "
                    + (neu.isEmpty() ? "(keine)" : String.join(", ", neu)));
            }
        }

        JSONArray beitritte = satz.optJSONArray("joined");
        if (beitritte == null) return;
        // Beitreten kann nur, wer den Raum schon kennt und verbunden ist. Der
        // Aufruf ist deshalb bewusst nachsichtig: was jetzt nicht geht, geht
        // beim naechsten Raumzustand - dann steht der Titel da und dieselbe
        // Liste wird noch einmal durchgegangen.
        offeneBeitritte.clear();
        for (int i = 0; i < beitritte.length(); i += 1) {
            JSONObject dabei = beitritte.optJSONObject(i);
            if (dabei == null) continue;
            String key = dabei.optString("key", "");
            if (key.isEmpty()) continue;
            offeneBeitritte.add(new String[]{key, dabei.optString("room", "")});
        }
        beitritteNachholen();
    }

    /**
     * Die uebernommenen Beitritte nachtragen, soweit es geht.
     *
     * <p>Wird nach jedem Raumzustand versucht: ein Titel, den das Relay noch
     * nicht gemeldet hat, laesst sich nicht betreten. Was gelingt, faellt aus
     * der Liste - der Rest wartet auf den naechsten Zustand.
     */
    void beitritteNachholen() {
        if (offeneBeitritte.isEmpty() || kern == null || !kern.istBereit()) return;
        JSONArray eintraege = eintraege();
        java.util.Iterator<String[]> lauf = offeneBeitritte.iterator();
        while (lauf.hasNext()) {
            String[] offen = lauf.next();
            for (int i = 0; i < eintraege.length(); i += 1) {
                JSONObject eintrag = eintraege.optJSONObject(i);
                if (eintrag == null) continue;
                if (!offen[0].equals(eintrag.optString("key", ""))) continue;
                if (!offen[1].equals(eintrag.optString("room", ""))) continue;
                lauf.remove();
                if (eintrag.optBoolean("joined", false)) break;
                Log.i(TAG, "Beitritt vom anderen Geraet uebernommen: " + offen[0]
                    + " (Raum " + offen[1] + ")");
                beitreten(offen[0], offen[1], null);
                break;
            }
        }
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
            // Der Schluessel des Geraeteabgleichs. Aus ihm leitet der Kern das
            // Konto ab, unter dem alle Geraete einer Person in einer Runde
            // zusammen zaehlen - gerechnet wird das dort und nicht hier, damit
            // Telefon und Rechner dieselbe Ableitung benutzen. Er verlaesst
            // das Geraet nicht: hinaus geht nur der abgeleitete HMAC.
            einstellungen.put("geraeteSchluessel", kontoSchluessel);
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
                // Unter derselben Adresse kann ploetzlich eine Runde gelten -
                // jemand hat den Titel eingestellt, jemand ist beigetreten.
                // Ohne das bliebe die gepufferte Lage auf "keine Runde"
                // stehen, bis die Seite wechselt.
                if (mitschauen != null) mitschauen.lageVerwerfen();
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
                letzterMitschauStand = standMerken(nutzlastJson);
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
        JSONObject nachricht;
        final JSONObject stand;
        final String key;
        final String raum;
        try {
            nachricht = new JSONObject(json);
            stand = nachricht.optJSONObject("progress");
            key = nachricht.optString("key", "");
            raum = nachricht.optString("room", "");
        } catch (Exception fehler) {
            Log.e(TAG, "Eingehender Stand unlesbar", fehler);
            return;
        }
        if (stand == null || key.isEmpty()) return;
        // Erst den Eintrag dieser Runde sicherstellen, dann den Stand darauf.
        //
        // Hier wurde bis hierher nur die Adresse zum Schluessel gesucht und der
        // Stand an den erstbesten Eintrag der Serie gegeben. Zwei Fehler in
        // einem: gab es keinen, geschah gar nichts - und gab es den *privaten*,
        // lief der Stand der Runde in den eigenen Verlauf. Der Rechner legt an
        // dieser Stelle einen eigenen Eintrag je Raum an; jetzt tut Android es
        // ueber dieselbe Regel.
        //
        // Das ist der Grund, warum "Gemeinsam weiterschauen" auf Android leer
        // blieb: die Reihe zeigt Eintraege mit Raum, und einer entstand nie.
        bestand.raumEintragSichern(key, raum, anbieter, stand, eintragId -> {
            if (eintragId.isEmpty()) {
                Log.d(TAG, "Stand ohne bekannten Titel verworfen: " + key);
                return;
            }
            bestand.watchpartyStandUebernehmen(eintragId, stand);
        });
    }

    /**
     * Die Serienadresse zu einem Titelschluessel des Relays.
     *
     * <p>Der Rueckweg vom Raum in die eigene Ablage. Gefragt wird der Kern - er
     * fuehrt die Eintraege des Raums und kennt zu jedem Titel die Adresse.
     */
    public void adresseZuSchluessel(String key, String raum, java.util.function.Consumer<String> nimm) {
        if (kern == null || !kern.istBereit() || key == null || key.isEmpty()) {
            nimm.accept("");
            return;
        }
        kern.rufe("watchparty-bruecke.adresseZuSchluessel", Kern.args(key, raum == null ? "" : raum),
            (wert, fehler) -> nimm.accept(fehler != null ? "" : textAus(wert)));
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
            // Ein Titel, der vorhin noch nicht dastand, laesst sich jetzt
            // vielleicht betreten - und ob dieses Geraet irgendwo dabei ist,
            // steht erst mit diesem Zustand fest.
            beitritteNachholen();
            raumEintraegeSichern();
            if (kontoMelder != null) kontoMelder.run();
            if (beobachter != null) beobachter.watchpartyGeaendert();
        });
    }

    /**
     * Zu jedem betretenen Titel einer Runde einen eigenen Eintrag sicherstellen.
     *
     * <p><b>Der gemeldete Fehler.</b> Auf dem Fernseher gab es die Reihe
     * "Gemeinsam weiterschauen" ueberhaupt nicht, auf dem Telefon schon, und
     * auf keinem Geraet standen alle Runden darin. Am 2026-08-29 am Fire TV
     * Stick nachgesehen: der Watchparty-Bildschirm zeigte den Raum samt Titel
     * und "3 dabei", die Startseite darunter nichts. Die Reihe zeigt naemlich
     * Eintraege der eigenen Ablage mit Raum - und einen solchen legte bis
     * hierher <em>nur</em> {@link #standUebernehmen} an, also erst, wenn ein
     * Mitglied waehrend dieses Laufs wirklich Fortschritt meldete.
     *
     * <p>Damit hing eine Reihe der Startseite an einem Zufall: wer beitritt und
     * dann die App neu startet, hat den Beitritt, aber keinen Eintrag; ein
     * Titel, den in der Runde noch niemand angefangen hat, meldet nie etwas;
     * und ein Geraet, das gerade nicht lief, verpasst die Meldung schlicht.
     *
     * <p>Der Beitritt selbst ist die verlaessliche Auskunft, und die steht in
     * jedem Raumzustand. Angelegt wird ueber dieselbe geteilte Regel wie beim
     * eingehenden Stand ({@code fortschritt.watchpartyEintragAnlegen}) - es
     * gibt also keine zweite Art von Raum-Eintrag, nur einen zweiten Anlass.
     *
     * <p>Je Raumzustand hoechstens einmal: jeder Aufruf schiebt die ganze
     * Ablage durch den Kern, und Raumzustaende kommen oft. Was sich seit dem
     * letzten Mal geaendert hat, sagt {@link #raumzustandKennzeichen}.
     *
     * <p><b>Und warum es ein einziger Aufruf ist.</b> Hier stand eine Schleife
     * mit einem Aufruf je Titel. Jeder davon reicht die ganze Ablage in den
     * Kern und bekommt eine neue Liste zurueck - aber erst spaeter, denn der
     * Kern antwortet asynchron. Die Schleife war also durch, bevor die erste
     * Antwort eintraf: alle Aufrufe trugen denselben Schnappschuss, und die
     * letzte Antwort ueberschrieb die Ablage mit einer Liste, in der die
     * anderen Neuzugaenge nie standen. Am 2026-08-29 am Fire TV Stick
     * gemessen: vier Eintraege angelegt, Bestand 80 -> 81, drei davon beim
     * naechsten Start wieder neu. Auf der Startseite kam damit je Start genau
     * eine Runde dazu.
     */
    private void raumEintraegeSichern() {
        if (bestand == null) return;
        String jetzt = raumzustandKennzeichen();
        // Derselbe Raumzustand wie beim letzten Mal: dann bleibt die Ablage,
        // wo sie ist. Ohne diese Frage ginge sie bei jedem Zustand durch den
        // Kern, und Raumzustaende kommen oft. Im Kennzeichen steht auch der
        // Zeitpunkt jedes Stands - ein Stand, der sich geaendert hat, fuehrt
        // also wieder hierher, und der Eintrag wird nachgezogen.
        if (jetzt.equals(letztesRaumkennzeichen)) return;
        // Und nie zwei Laeufe nebeneinander. Jeder reicht die ganze Ablage in
        // den Kern und bekommt sie zurueck; zwei ueberlappende trugen denselben
        // Schnappschuss, und der zweite ueberschriebe, was der erste angelegt
        // hat - genau der Fehler, der die Schleife hier gekostet hat. Vier
        // eingerichtete Raeume melden ihren Zustand kurz hintereinander, also
        // ist das der Normalfall und nicht der Ausnahmefall.
        if (raumEintraegeLaeuft) {
            raumEintraegeNachholen = true;
            return;
        }
        letztesRaumkennzeichen = jetzt;
        raumEintraegeLaeuft = true;
        bestand.raumEintraegeSichern(anbieter, () -> {
            raumEintraegeLaeuft = false;
            if (!raumEintraegeNachholen) return;
            raumEintraegeNachholen = false;
            raumEintraegeSichern();
        });
    }

    /**
     * Woran ein Raumzustand zu erkennen ist, der Arbeit macht.
     *
     * <p>Titel, Raum und der Zeitpunkt des zuletzt gemeldeten Stands - mehr
     * braucht es nicht: ein neuer Titel, ein Beitritt oder ein juengerer Stand
     * aendern das Kennzeichen, alles andere nicht.
     */
    private String raumzustandKennzeichen() {
        StringBuilder bau = new StringBuilder();
        for (int i = 0; i < letzteEintraege.length(); i += 1) {
            JSONObject eintrag = letzteEintraege.optJSONObject(i);
            if (eintrag == null || !eintrag.optBoolean("joined", false)) continue;
            String key = eintrag.optString("key", "");
            String raum = eintrag.optString("room", "");
            if (key.isEmpty() || raum.isEmpty()) continue;
            JSONObject stand = eintrag.optJSONObject("progress");
            bau.append(raum).append('|').append(key).append('|')
                .append(stand == null ? "" : stand.optString("updatedAt", "")).append('\n');
        }
        return bau.toString();
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
            // Der Schluessel wird hier nicht mehr gebildet. Er entsteht im Kern
            // aus Art und Titel - derselben Regel, die der Rechner benutzt
            // ({@code geraete-stand.titelSchluessel}). Vorher stand hier die
            // Serienadresse, und damit trug derselbe Anime in derselben Runde
            // auf Telefon und Rechner zwei verschiedene Schluessel.
            item.put("type", eintrag.type());
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

    /**
     * Eine Standmeldung ablegen - einmal fuer die Seite, einmal je Titel.
     *
     * <p>Dabei wird jedes Mitglied als eigenes markiert oder nicht. Das Relay
     * schickt nur Kennungen; wer davon dieses Geraet ist, weiss allein diese
     * Klasse. Ohne die Marke stuende auf der eigenen Startseite "Wohnzimmer
     * schaut gerade", waehrend man selbst das Wohnzimmer ist - genau die
     * Zeile, die am Rechner deshalb {@code me} traegt.
     *
     * @return die Meldung, wie sie fuer die Anzeige gilt
     */
    private String standMerken(String json) {
        if (json == null || json.isEmpty()) return "";
        try {
            JSONObject nachricht = new JSONObject(json);
            JSONArray mitglieder = nachricht.optJSONArray("members");
            if (mitglieder != null) {
                for (int i = 0; i < mitglieder.length(); i += 1) {
                    JSONObject person = mitglieder.optJSONObject(i);
                    if (person == null) continue;
                    person.put("me", !geraetId.isEmpty() && geraetId.equals(person.optString("id", "")));
                }
            }
            String schluessel = Mitschaustand.schluessel(
                nachricht.optString("key", ""), nachricht.optString("room", ""));
            standKarten.put(schluessel, mitglieder == null ? new JSONArray() : mitglieder);
            standEmpfangen.put(schluessel, System.currentTimeMillis());
            standPausiertVon.put(schluessel, nachricht.optString("pausedBy", ""));
            JSONObject letzte = nachricht.optJSONObject("lastAction");
            if (letzte == null) {
                standLetzteAktion.remove(schluessel);
                standAktionSeit.remove(schluessel);
            } else {
                JSONObject vorher = standLetzteAktion.get(schluessel);
                // Nur eine wirklich neue Tat setzt die Uhr zurueck. Dieselbe
                // Meldung kommt im Sekundentakt wieder; wuerde sie den
                // Zwischenruf jedes Mal erneuern, stuende er fuer immer da.
                boolean neuerAnlass = vorher == null
                    || vorher.optLong("timestamp", 0) != letzte.optLong("timestamp", 0);
                standLetzteAktion.put(schluessel, letzte);
                if (neuerAnlass) standAktionSeit.put(schluessel, System.currentTimeMillis());
            }
            return nachricht.toString();
        } catch (Exception fehler) {
            Log.e(TAG, "Standmeldung unlesbar", fehler);
            return json;
        }
    }

    /**
     * Wer bei diesem Titel gerade meldet - und noch nicht zu lange her.
     *
     * <p>Dieselbe Auskunft wie {@code frischeMitglieder} am Rechner. Die
     * Alterung rechnet {@link Mitschaustand}; hier kommt nur dazu, wie lange
     * die Meldung schon hier liegt.
     *
     * @param schluessel aus {@link Mitschaustand#schluessel(String, String)}
     */
    public JSONArray frischeMitglieder(String schluessel) {
        JSONArray mitglieder = standKarten.get(schluessel);
        if (mitglieder == null) return new JSONArray();
        return Mitschaustand.frische(mitglieder, sekundenSeitMeldung(schluessel));
    }

    /**
     * Die Mitglieder zu einem Titel, so wie sie gemeldet wurden.
     *
     * <p>Ungefiltert - anders als {@link #frischeMitglieder}. Wer die Alterung
     * selbst rechnet, soll die Rohliste bekommen und nicht eine, die schon
     * einmal durch eine Frischepruefung gelaufen ist; sonst stuende die Grenze
     * an zwei Stellen und irgendwann verschieden.
     */
    public JSONArray mitgliederZu(String schluessel) {
        JSONArray mitglieder = standKarten.get(schluessel);
        return mitglieder == null ? new JSONArray() : mitglieder;
    }

    /**
     * Wer diesen Titel zuletzt angehalten hat.
     *
     * <p>Etwas anderes als "wer ist gerade angehalten": zieht ein zweites
     * Geraet die Pause nur mit, bleibt der Ausloeser derselbe. Genau die
     * Unterscheidung, die die Anzeige braucht, damit dort nicht ein veralteter
     * Name steht.
     */
    public String pausiertVon(String schluessel) {
        String wer = standPausiertVon.get(schluessel);
        return wer == null ? "" : wer;
    }

    /** Was zuletzt gedrueckt wurde - {@code {type, name, timestamp}} oder {@code null}. */
    public JSONObject letzteAktion(String schluessel) {
        return standLetzteAktion.get(schluessel);
    }

    /** Wie lange diese Tat schon hier bekannt ist, in Millisekunden. */
    public long seitLetzterAktion(String schluessel) {
        Long seit = standAktionSeit.get(schluessel);
        return seit == null ? Long.MAX_VALUE : Math.max(0, System.currentTimeMillis() - seit);
    }

    /** Wie lange die letzte Meldung zu diesem Titel schon hier liegt, in Sekunden. */
    public double sekundenSeitMeldung(String schluessel) {
        Long empfangen = standEmpfangen.get(schluessel);
        if (empfangen == null) return 0;
        return Math.max(0, (System.currentTimeMillis() - empfangen) / 1000.0);
    }

    /**
     * Der Schluessel, unter dem ein Titel in seiner Runde gefuehrt wird.
     *
     * <p>Eine Kachel kennt ihren Raum und ihren Titel, nicht aber den
     * Schluessel - der ist die Serienadresse, wie der Einsteller sie hatte.
     * Beides trifft sich ueber den Titel, genau wie in
     * {@code watchpartySerieSchluessel} am Rechner.
     *
     * @return der zusammengesetzte Schluessel, oder leer, wenn nichts passt
     */
    public String kartenSchluessel(String raum, String titel) {
        String gesucht = Mitschaustand.normalisierterTitel(titel);
        if (raum == null || raum.isEmpty() || gesucht.isEmpty()) return "";
        for (int i = 0; i < letzteEintraege.length(); i += 1) {
            JSONObject eintrag = letzteEintraege.optJSONObject(i);
            if (eintrag == null || !raum.equals(eintrag.optString("room", ""))) continue;
            if (!gesucht.equals(Mitschaustand.normalisierterTitel(eintrag.optString("title", "")))) continue;
            return Mitschaustand.schluessel(eintrag.optString("key", ""), raum);
        }
        return "";
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
        // Ein Titel ohne passenden Anbieter bekommt keinen Eintrag. Wird einer
        // eingerichtet, kann derselbe Raumzustand ploetzlich mehr hergeben -
        // also gilt er wieder als ungesehen.
        letztesRaumkennzeichen = "";
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
            if (fehler == null && bestand != null) raumAmEintrag(key, raum, raum);
            melde(antwort, wert, fehler);
        });
    }

    /** Die Runde verlassen - der Eintrag wird wieder privat. */
    public void verlassen(String key, String raum, Kern.Antwort antwort) {
        kern.rufe("watchparty-bruecke.verlassen", Kern.args(key, raum), (wert, fehler) -> {
            if (fehler == null && bestand != null) raumAmEintrag(key, raum, "");
            melde(antwort, wert, fehler);
        });
    }

    /**
     * Eine Antwort weitergeben, sofern jemand darauf wartet.
     *
     * <p><b>Das war ein Absturz.</b> {@link #beitritteNachholen} traegt
     * Beitritte nach, die von einem anderen Geraet uebernommen wurden - und
     * sie interessiert das Ergebnis nicht, also uebergab sie {@code null}.
     * Beide Wege oben riefen die Antwort trotzdem an, und der Fernseher fiel
     * mit einer NullPointerException um, sobald ein Beitritt vom Telefon
     * herueberkam. Belegt im Absturzspeicher des Fire TV
     * (Watchparty.java:808, ELFIX 1.65.0, 28. August).
     *
     * <p>Eine Antwort ist eine Benachrichtigung und keine Pflicht: wer sie
     * nicht braucht, darf sie weglassen.
     */
    private static void melde(Kern.Antwort antwort, String wert, String fehler) {
        if (antwort != null) antwort.fertig(wert, fehler);
    }

    /**
     * Den Raum am eigenen Eintrag setzen - ueber die Adresse, nicht ueber den
     * Schluessel.
     *
     * <p>Die Ablage kennt Adressen, der Raum kennt Titel. Das war dasselbe,
     * solange Android den Titelschluessel aus der Adresse bildete; seit er wie
     * am Rechner aus Art und Titel entsteht, muss uebersetzt werden.
     */
    private void raumAmEintrag(String key, String raum, String neuerRaum) {
        adresseZuSchluessel(key, raum, adresse -> {
            if (adresse.isEmpty() || bestand == null) return;
            Favorite lokal = bestand.zuSerie(adresse);
            if (lokal != null) bestand.raumSetzen(lokal.id(), neuerRaum);
        });
    }

    /**
     * Der Eintrag zaehlt wieder nur fuer dieses Geraet.
     *
     * <p>Ausdruecklich ohne Austritt: die Mitgliedschaft im Raum bleibt, der
     * Titel bleibt eingestellt, der gemessene Fortschritt bleibt stehen. Was
     * wegfaellt, ist allein die Bindung des <em>oertlichen</em> Eintrags an den
     * Raum - und damit die Meldung des eigenen Stands dorthin. Dasselbe wie
     * {@code setzePrivatenKontext} am Rechner.
     */
    /*
     * Beides nimmt den Titelschluessel des Relays und muss ihn erst uebersetzen:
     * die Ablage kennt Adressen, der Raum kennt Titel. Vorher war das dasselbe,
     * weil Android den Schluessel aus der Adresse bildete - und genau daran ging
     * die Vertraeglichkeit mit dem Rechner kaputt.
     */
    public void privatSetzen(String key) {
        if (bestand == null || key == null || key.isEmpty()) return;
        adresseZuSchluessel(key, "", adresse -> {
            if (adresse.isEmpty()) return;
            Favorite lokal = bestand.zuSerie(adresse);
            if (lokal != null && !lokal.watchpartyRaum().isEmpty()) bestand.raumSetzen(lokal.id(), "");
        });
    }

    /** Und der Weg zurueck: der Eintrag zaehlt wieder fuer diese Runde. */
    public void raumBinden(String key, String raum) {
        if (bestand == null || key == null || key.isEmpty() || raum == null || raum.isEmpty()) return;
        adresseZuSchluessel(key, raum, adresse -> {
            if (adresse.isEmpty()) return;
            Favorite lokal = bestand.zuSerie(adresse);
            if (lokal != null && !raum.equals(lokal.watchpartyRaum())) bestand.raumSetzen(lokal.id(), raum);
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

    /**
     * Alle auf dieselbe Stelle bringen.
     *
     * <p>Dasselbe wie der Sync-Knopf am Rechner: das Relay laesst alle
     * anhalten, auf die Stelle des Hosts springen, und erst wenn alle so weit
     * sind, gibt es das Startsignal. Massgeblich ist der Host - die eigene
     * Stelle zaehlt nur, wenn von ihm noch gar nichts bekannt ist. Sonst zoege
     * ein Nachzuegler alle anderen zu sich zurueck.
     */
    public void gleichziehen(String key, double stelle, String raum, Kern.Antwort antwort) {
        if (kern == null || !kern.istBereit()) {
            antwort.fertig(null, "Der Kern läuft noch nicht");
            return;
        }
        kern.rufe("watchparty-bruecke.gleichziehen",
            Kern.args(key, Math.max(0, stelle), raum), antwort);
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
            Kern.args(eintrag, geraetName), (wert, fehler) -> {
                if (fehler != null) Log.e(TAG, "Stand nicht gemeldet: " + fehler);
            });
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
