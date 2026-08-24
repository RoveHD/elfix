package local.elflix.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Meine Geraete - der Abgleich zwischen den eigenen Geraeten.
 *
 * <p>Wer denselben Schluessel traegt, ist dieselbe Person, und ihre Geraete
 * sollen denselben Stand haben. Kein Konto, kein Raum, keine Verabredung.
 *
 * <p>Die Sache selbst laeuft in den geteilten Modulen: {@code geraete.js} fuehrt
 * die Verbindung samt Wiederanschluss, Uhrabgleich, Spiegel und Grabsteinen,
 * {@code geraete-schluessel.js} verschliesst und oeffnet, {@code geraete-stand.js}
 * entscheidet, was beim Uebernehmen mit einem Stand geschieht. Keine Zeile davon
 * ist hier nachgebaut - ein zweiter Abgleich waere ein zweiter Abgleich, und
 * zwei Geraete kaemen an derselben Stelle zu verschiedenen Ergebnissen.
 *
 * <p>Diese Klasse haelt die Einstellungen, reicht die Favoriten hinein und
 * schreibt zurueck, was hereinkam. Sie entscheidet nichts.
 *
 * <p><b>Was nie hinausgeht:</b> der Schluessel selbst. Er steht in den
 * Voreinstellungen dieses Geraets und geht von dort ausschliesslich in den Kern,
 * der daraus Raum, Chiffre und Kennungen ableitet. Das Relay sieht verschlossene
 * Klumpen, ihre Anzahl und wann sie sich aendern - mehr nicht. Deshalb steht in
 * keiner Protokollzeile dieser Klasse ein Schluessel und kein entschluesselter
 * Inhalt.
 */
public final class Geraete {
    private static final String TAG = CrashReporter.TAG;
    private static final String SPIEGEL_DATEI = "geraete.json";
    private static final String SITZUNG_DATEI = "sitzungen.json";
    private static final String PREFS = "elflix_settings";

    /**
     * So lange wird gesammelt, bevor ein Abgleich losgeht.
     *
     * <p>Waehrend einer Folge meldet die Messung alle fuenf Sekunden einen
     * neuen Stand. Jeden davon einzeln hinauszuschicken waere Funk fuer nichts -
     * gebuendelt ist es einer alle drei Sekunden, und mehr braucht niemand:
     * abgeglichen wird ein Stand, kein Tastendruck. Dieselbe Zahl wie am
     * Rechner.
     */
    private static final long BUENDELN_MS = 3000;
    /** Nach dem Einrichten einmal kurz nachsehen, ob etwas hinaus muss. */
    private static final long ERSTER_BLICK_MS = 1000;

    /** Was die Oberflaeche vom Abgleich erfaehrt. */
    public interface Horcher {
        void zustand(JSONObject status);
    }

    private final Context context;
    private final Kern kern;
    private final Bestand bestand;
    private final Watchparty watchparty;
    private final Horcher horcher;
    private final Handler haupt = new Handler(Looper.getMainLooper());
    private final Runnable abgleichAufgabe = this::jetztAbgleichen;

    private JSONObject letzterZustand;
    private boolean geplant = false;

    public Geraete(Context context, Kern kern, Bestand bestand, Watchparty watchparty,
                   Horcher horcher) {
        this.context = context;
        this.kern = kern;
        this.bestand = bestand;
        this.watchparty = watchparty;
        this.horcher = horcher;
    }

    // --- Einrichten ---------------------------------------------------------

    /** Spiegel, Sitzungen und Einstellungen in den Kern reichen. Einmal beim Start. */
    public void vorbereiten() {
        if (kern == null) return;
        kern.wennBereit(() -> {
            kern.rufe("geraete-bruecke.spiegelSetzen", Kern.args(spiegelLesen()), null);
            kern.rufe("geraete-bruecke.sitzungenSetzen", Kern.args(sitzungenLesen()), null);
            anwenden();
        });
    }

    /**
     * Die Einstellungen anwenden - und danach einmal nachsehen.
     *
     * <p>Die Adresse kommt aus der Watchparty: es ist dasselbe Relay. Zwei
     * Felder dafuer waeren zwei Gelegenheiten, sich zu vertippen. Die
     * Geraetekennung ebenso - es gibt keinen Grund, hier eine zweite zu fuehren.
     */
    public void anwenden() {
        if (kern == null || !kern.istBereit()) return;
        JSONObject einstellungen = new JSONObject();
        try {
            einstellungen.put("enabled", eingeschaltet() && !schluessel().isEmpty());
            einstellungen.put("serverUrl", watchpartyServer());
            einstellungen.put("schluessel", schluessel());
            einstellungen.put("geraetId", geraetId());
        } catch (Exception fehler) {
            Log.e(TAG, "Geraete-Einstellungen liessen sich nicht bauen", fehler);
            return;
        }
        bestandReichen();
        kern.rufe("geraete-bruecke.konfigurieren", Kern.args(einstellungen), (wert, fehler) -> {
            if (fehler != null) {
                Log.e(TAG, "Geraeteabgleich nicht eingerichtet: " + fehler);
                return;
            }
            zustandUebernehmen(wert);
            abgleichenSpaeter(ERSTER_BLICK_MS);
        });
    }

    /**
     * Favoriten und Anbieter hineinreichen - sie aendern sich zur Laufzeit.
     *
     * <p>Ausdruecklich aus {@link Bestand} und nicht aus der Datei. Der Bestand
     * haelt die Liste im Speicher und schreibt sie, wenn sich etwas aendert;
     * wer daneben die Datei liest, liest im ungluecklichen Augenblick den
     * Stand von vorhin. Und was hier hineingereicht wird, ist die Grundlage
     * dafuer, was der Abgleich fuer "hier geloescht" haelt - eine Liste von
     * vorhin waere dort keine Ungenauigkeit, sondern ein Loeschbefehl.
     */
    private void bestandReichen() {
        if (kern == null || !kern.istBereit()) return;
        kern.rufe("geraete-bruecke.favoritenSetzen",
            Kern.args(bestand == null ? FavoriteStore.ladeRoh(context) : bestand.roh()), null);
        JSONArray anbieter = new JSONArray();
        for (Provider eintrag : ProviderStore.load(context)) {
            if (eintrag != null && eintrag.enabled) anbieter.put(eintrag.alsJson());
        }
        kern.rufe("geraete-bruecke.anbieterSetzen", Kern.args(anbieter), null);
    }

    // --- Abgleichen ---------------------------------------------------------

    /**
     * Gebuendelt abgleichen.
     *
     * <p>Aufgerufen an der einen Stelle, an der sich am Bestand wirklich etwas
     * geaendert hat - nicht an den zwei Dutzend, die Staende anfassen. Das ist
     * der Grund, warum der Abgleich nichts verpassen kann und trotzdem nicht
     * dauernd funkt.
     */
    public void abgleichenSpaeter() {
        abgleichenSpaeter(BUENDELN_MS);
    }

    public void abgleichenSpaeter(long verzoegerung) {
        if (!eingeschaltet() || schluessel().isEmpty() || geplant) return;
        geplant = true;
        haupt.postDelayed(abgleichAufgabe, verzoegerung);
    }

    /** Von Hand angestossen - der Knopf in den Einstellungen. */
    public void jetztAbgleichen() {
        geplant = false;
        haupt.removeCallbacks(abgleichAufgabe);
        if (kern == null || !kern.istBereit() || !eingeschaltet()) return;
        bestandReichen();
        kern.rufe("geraete-bruecke.abgleichen", (wert, fehler) -> {
            if (fehler != null) Log.e(TAG, "Abgleich fehlgeschlagen: " + fehler);
            standAbfragen();
        });
    }

    /**
     * Alles noch einmal holen.
     *
     * <p>Der Weg zurueck fuer den Fall, dass ein Eintrag hier nicht ankam - etwa,
     * weil der Anbieter dazu damals fehlte und inzwischen angelegt wurde. Teuer
     * ist das nicht: was hier schon steht, traegt denselben Zeitstempel wie
     * drueben und faellt beim Vergleich heraus.
     */
    public void vollAbgleichen() {
        if (kern == null || !kern.istBereit()) return;
        bestandReichen();
        kern.rufe("geraete-bruecke.vollAbgleichen", (wert, fehler) -> {
            if (fehler != null) Log.e(TAG, "Vollabgleich fehlgeschlagen: " + fehler);
            standAbfragen();
        });
    }

    private void standAbfragen() {
        if (kern == null || !kern.istBereit()) return;
        kern.rufe("geraete-bruecke.status", (wert, fehler) -> {
            if (fehler == null) zustandUebernehmen(wert);
        });
    }

    // --- Was der Kern meldet -------------------------------------------------

    /**
     * Ein Ereignis aus dem Kern.
     *
     * @return ob es diese Klasse betraf
     */
    public boolean ereignis(String name, String nutzlastJson) {
        if (name == null || !name.startsWith("geraete:")) return false;
        try {
            switch (name) {
                case "geraete:zustand":
                    zustandUebernehmen(nutzlastJson);
                    return true;
                case "geraete:favoriten":
                    // Ueber den Bestand, nicht an ihm vorbei. Er haelt die
                    // Liste, aus der Weiterschauen, Merkliste, Mediathek und
                    // Verlauf gezeichnet werden; wer nur die Datei schreibt,
                    // hat abgeglichen, ohne dass es jemand sieht - und beim
                    // naechsten oertlichen Handgriff schreibt der Bestand
                    // seinen alten Stand darueber.
                    if (bestand != null) bestand.setzeRoh(new JSONArray(nutzlastJson));
                    else FavoriteStore.speichereRoh(context, new JSONArray(nutzlastJson));
                    return true;
                case "geraete:sitzungen":
                    sitzungenSchreiben(new JSONArray(nutzlastJson));
                    return true;
                case "geraete:spiegel":
                    spiegelSchreiben(new JSONObject(nutzlastJson));
                    return true;
                case "geraete:uebernommen":
                    // Bewusst nur die Anzahl. Was uebernommen wurde, ist der
                    // entschluesselte Inhalt und gehoert in kein Protokoll.
                    Log.i(TAG, "Geraeteabgleich: "
                        + new JSONObject(nutzlastJson).optInt("anzahl")
                        + " Eintrag/Eintraege von einem anderen Geraet uebernommen");
                    return true;
                default:
                    // Bewusst true, auch fuer Unbekanntes: die Nutzlast eines
                    // geraete-Ereignisses kann den Schluessel tragen, und wer
                    // hier durchfaellt, landet in der allgemeinen Protokollzeile
                    // von MainActivity - mitsamt Nutzlast. Gemeldet wird der
                    // Name, nicht der Inhalt.
                    Log.w(TAG, "Unbekanntes Geraete-Ereignis: " + name);
                    return true;
            }
        } catch (Exception fehler) {
            Log.e(TAG, "Geraete-Ereignis " + name + " unlesbar", fehler);
            return true;
        }
    }

    private void zustandUebernehmen(String json) {
        if (json == null || "null".equals(json)) return;
        try {
            letzterZustand = new JSONObject(json);
            if (horcher != null) horcher.zustand(letzterZustand);
        } catch (Exception fehler) {
            Log.e(TAG, "Geraete-Zustand unlesbar", fehler);
        }
    }

    public JSONObject zustand() {
        return letzterZustand;
    }

    /**
     * Auf die Leitung horchen.
     *
     * <p>{@code geraete.js} verbindet sich von selbst wieder, mit wachsendem
     * Abstand bis zu einer Minute. Das genuegt, kostet aber im schlechtesten
     * Fall eine Minute Wartezeit, nachdem das WLAN wieder da ist - und genau
     * dann sieht jemand auf sein Telefon. Diese Meldung verkuerzt das auf einen
     * Augenblick.
     *
     * <p>Kein eigener Takt: gehorcht wird auf das Ereignis, nicht in einer
     * Schleife gefragt.
     */
    public void netzBeobachten() {
        try {
            android.net.ConnectivityManager netz =
                (android.net.ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (netz == null) return;
            netz.registerDefaultNetworkCallback(new android.net.ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(android.net.Network verfuegbar) {
                    haupt.post(() -> abgleichenSpaeter(500));
                }
            });
        } catch (Exception fehler) {
            // Ohne diese Meldung dauert es laenger, mehr nicht.
            Log.w(TAG, "Netzbeobachtung nicht moeglich: " + fehler);
        }
    }

    // --- Der Schluessel ------------------------------------------------------

    /** Ein neuer Schluessel. Der Aufrufer fragt vorher nach - das trennt Geraete. */
    public void neuerSchluessel(java.util.function.Consumer<String> beiFertig) {
        if (kern == null || !kern.istBereit()) {
            beiFertig.accept("");
            return;
        }
        kern.rufe("geraete-bruecke.erzeugen", (wert, fehler) -> {
            String neu = Kern.text(wert);
            if (fehler != null || neu.isEmpty()) {
                beiFertig.accept("");
                return;
            }
            schluesselSetzenRoh(neu);
            anwenden();
            beiFertig.accept(neu);
        });
    }

    /**
     * Einen abgetippten Schluessel uebernehmen.
     *
     * <p>Geprueft und geradegezogen wird im geteilten Modul - dieselbe Regel wie
     * am Rechner: Kleinschreibung, Striche und Leerzeichen sind egal, I und L
     * werden zur Eins, O zur Null. Eine eigene Android-Fassung davon waere die
     * sicherste Art, zwei Geraete in zwei verschiedene Verbuende zu schicken.
     *
     * @param beiFertig bekommt den Schluessel in Anzeigeform, oder leer bei
     *                  einem ungueltigen
     */
    public void schluesselSetzen(String eingabe, java.util.function.Consumer<String> beiFertig) {
        if (kern == null || !kern.istBereit()) {
            beiFertig.accept("");
            return;
        }
        kern.rufe("geraete-bruecke.pruefen", Kern.args(eingabe), (wert, fehler) -> {
            if (fehler != null || wert == null) {
                beiFertig.accept("");
                return;
            }
            try {
                JSONObject antwort = new JSONObject(wert);
                if (!antwort.optBoolean("ok", false)) {
                    beiFertig.accept("");
                    return;
                }
                schluesselSetzenRoh(antwort.optString("key", ""));
                anwenden();
                beiFertig.accept(antwort.optString("anzeige", ""));
            } catch (Exception ausnahme) {
                beiFertig.accept("");
            }
        });
    }

    /**
     * Dieses Geraet trennen.
     *
     * <p>Nur hier. Die anderen Geraete behalten ihren Schluessel und ihren
     * Stand, und das Relay behaelt seine Klumpen - es weiss ohnehin nicht, wer
     * sie abgelegt hat. Der oertliche Bestand bleibt vollstaendig stehen: was
     * hier geschaut wurde, ist hier geschaut worden.
     *
     * <p>Der Spiegel geht dagegen weg. Er ist die Buchfuehrung eines Verbunds,
     * dem dieses Geraet nicht mehr angehoert - bliebe er stehen und jemand
     * traegt spaeter denselben Schluessel wieder ein, hielte das Geraet
     * laengst geaenderte Staende faelschlich fuer bekannt.
     */
    public void trennen() {
        einstellungen().edit().remove("geraete_key").putBoolean("geraete_an", false).apply();
        spiegelSchreiben(new JSONObject());
        if (kern != null && kern.istBereit()) {
            kern.rufe("geraete-bruecke.spiegelSetzen", Kern.args(new JSONObject()), null);
            anwenden();
        }
    }

    private void schluesselSetzenRoh(String schluessel) {
        einstellungen().edit()
            .putString("geraete_key", schluessel)
            .putBoolean("geraete_an", !schluessel.isEmpty())
            .apply();
        // Ein anderer Schluessel ist ein anderer Verbund. Der Spiegel des alten
        // gilt dort nicht - stehen bliebe er nur, um falsche Auskunft zu geben.
        spiegelSchreiben(new JSONObject());
        if (kern != null && kern.istBereit()) {
            kern.rufe("geraete-bruecke.spiegelSetzen", Kern.args(new JSONObject()), null);
        }
    }

    public String schluessel() {
        return einstellungen().getString("geraete_key", "");
    }

    public boolean eingeschaltet() {
        return einstellungen().getBoolean("geraete_an", false) && !schluessel().isEmpty();
    }

    private SharedPreferences einstellungen() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * Die Adresse des Relays - dieselbe wie bei der Watchparty.
     *
     * <p>Es ist dasselbe Relay. Ein zweites Feld dafuer waere eine zweite
     * Gelegenheit, sich zu vertippen, und eine Frage mehr, wenn dann eines von
     * beidem nicht geht. Die Watchparty selbst muss dafuer nicht eingeschaltet
     * sein.
     */
    private String watchpartyServer() {
        return watchparty == null ? "" : watchparty.serverUrl();
    }

    private String geraetId() {
        return watchparty == null ? "" : watchparty.geraetId();
    }

    // --- Die beiden Dateien --------------------------------------------------
    //
    // Roh, ohne Rahmen: was das Modul ablegt, ist schon ein fertiges Objekt.
    // sitzungen.json traegt dasselbe Format wie am Rechner, damit ein spaeterer
    // Rueckblick auf beiden Geraeten dieselben Saetze zaehlt.

    private JSONObject spiegelLesen() {
        String roh = dateiLesen(SPIEGEL_DATEI);
        if (roh.isEmpty()) return new JSONObject();
        try {
            return new JSONObject(roh);
        } catch (Exception fehler) {
            Log.e(TAG, SPIEGEL_DATEI + " unlesbar - der naechste Abgleich holt alles neu", fehler);
            return new JSONObject();
        }
    }

    private void spiegelSchreiben(JSONObject ablage) {
        dateiSchreiben(SPIEGEL_DATEI, ablage == null ? "{}" : ablage.toString());
    }

    private JSONArray sitzungenLesen() {
        String roh = dateiLesen(SITZUNG_DATEI);
        if (roh.isEmpty()) return new JSONArray();
        try {
            JSONObject inhalt = new JSONObject(roh);
            JSONArray liste = inhalt.optJSONArray("sitzungen");
            return liste == null ? new JSONArray() : liste;
        } catch (Exception fehler) {
            Log.e(TAG, SITZUNG_DATEI + " unlesbar - es wird nichts geloescht, nur nichts geladen", fehler);
            return new JSONArray();
        }
    }

    private void sitzungenSchreiben(JSONArray liste) {
        try {
            JSONObject inhalt = new JSONObject();
            // Dieselbe Fassungsnummer wie die Datei am Rechner traegt.
            inhalt.put("version", 2);
            inhalt.put("sitzungen", liste);
            dateiSchreiben(SITZUNG_DATEI, inhalt.toString());
        } catch (Exception fehler) {
            Log.e(TAG, SITZUNG_DATEI + " nicht gespeichert", fehler);
        }
    }

    private String dateiLesen(String name) {
        File datei = new File(context.getFilesDir(), name);
        if (!datei.isFile()) return "";
        try (InputStream strom = new FileInputStream(datei)) {
            byte[] roh = new byte[(int) datei.length()];
            int gelesen = 0;
            while (gelesen < roh.length) {
                int schritt = strom.read(roh, gelesen, roh.length - gelesen);
                if (schritt < 0) break;
                gelesen += schritt;
            }
            return new String(roh, 0, gelesen, StandardCharsets.UTF_8);
        } catch (Exception fehler) {
            Log.e(TAG, name + " unlesbar", fehler);
            return "";
        }
    }

    /** Erst daneben, dann umbenennen - ein Absturz mitten im Schreiben kostet sonst die Datei. */
    private void dateiSchreiben(String name, String inhalt) {
        File ziel = new File(context.getFilesDir(), name);
        File zwischen = new File(context.getFilesDir(), name + ".neu");
        try {
            try (FileOutputStream strom = new FileOutputStream(zwischen)) {
                strom.write(inhalt.getBytes(StandardCharsets.UTF_8));
                strom.getFD().sync();
            }
            if (!zwischen.renameTo(ziel) && !(ziel.delete() && zwischen.renameTo(ziel))) {
                Log.e(TAG, name + " nicht ersetzt");
            }
        } catch (Exception fehler) {
            Log.e(TAG, name + " nicht gespeichert", fehler);
        } finally {
            if (zwischen.exists()) zwischen.delete();
        }
    }
}
