package local.elflix.android;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Die gemessene Wiedergabezeit - und die einzige Stelle, die sie ablegt.
 *
 * <p>Bis hierher hat die Android-App <em>keine einzige Sekunde</em>
 * aufgezeichnet. Nicht wenig, nicht ungenau: gar keine. Ein Rueckblick auf dem
 * Telefon haette zwangslaeufig eine leere Bilanz gezeigt, und eine Null sieht
 * aus wie eine Aussage - deshalb gab es hier bisher auch keinen.
 *
 * <p>Die Regeln stehen nicht hier, sondern in {@code statistik.js} und
 * {@code sitzungslauf.js} im Kern, also in denselben Modulen, die der Rechner
 * fragt. Diese Klasse ist die Ablage: welche Sitzung offen ist, wann
 * geschrieben wird und wohin. Dieselbe Aufteilung wie bei {@link Bestand}, und
 * aus demselben Grund - eine Stunde, die auf zwei Geraeten verschieden zaehlt,
 * faellt in einer Jahresbilanz niemandem mehr auf.
 *
 * <p>Die Datei heisst {@code sitzungen.json} und traegt dasselbe Format wie am
 * Rechner ({@code {version, sitzungen}}), damit der Geraeteabgleich sie ohne
 * Umrechnung austauschen kann.
 */
public final class Statistik {
    private static final String TAG = CrashReporter.TAG;
    private static final String DATEI = "sitzungen.json";
    /** Dieselbe Fassungsnummer wie am Rechner - die Dateien sollen austauschbar sein. */
    private static final int SCHEMA = 2;

    /**
     * So oft wird die laufende Sitzung weggeschrieben.
     *
     * <p>Nicht bei jedem Takt - das waeren alle fuenf Sekunden ein
     * Dateizugriff -, aber oft genug, dass ein Prozessabbruch hoechstens eine
     * halbe Minute kostet. Auf dem Telefon zaehlt das mehr als am Rechner: das
     * System raeumt eine App im Hintergrund ohne Vorwarnung ab.
     */
    private static final long SICHERN_MS = 30 * 1000L;

    /** Was fertig ist. Wird gerufen, sobald eine Auswertung vorliegt. */
    public interface Auswertung {
        void fertig(JSONObject daten, String fehler);
    }

    /**
     * Wer erfahren muss, dass sich an den Sitzungen etwas geaendert hat.
     *
     * <p>Genau hier fehlte bisher eine Leitung, und daran hing der Fehler: die
     * Sitzungen gingen beim Start einmal in den Geraeteabgleich und danach nie
     * wieder. Alles, was an einem Abend gemessen wurde, blieb auf dem Geraet
     * liegen, auf dem es entstand - der Rueckblick zeigte auf dem Telefon zwei
     * Stunden, am Rechner drei, und niemandem fiel auf, dass es fuenf sein
     * muessten.
     *
     * <p>Zwei Anlaesse, weil sie zwei verschiedene Dinge nach sich ziehen:
     * eigene Sitzungen muessen <em>hinaus</em>, fremde muessen <em>angezeigt
     * werden</em>.
     */
    public interface Beobachter {
        /**
         * Hier ist eine Sitzung entstanden oder gewachsen.
         *
         * <p>Der Aufrufer reicht die Liste in den Geraeteabgleich und stoesst
         * ihn gebuendelt an - nicht sofort und nicht bei jedem Takt.
         */
        void sitzungenGespeichert();

        /**
         * Von einem anderen eigenen Geraet sind Sitzungen hereingekommen.
         *
         * <p>Ein offener Rueckblick und ein offenes Wrapped rechnen daraufhin
         * neu. Ohne das stimmten die Zahlen erst nach einem Neustart, und das
         * ist bei einer Jahresbilanz die Art Fehler, die niemand bemerkt.
         */
        default void sitzungenUebernommen() {
        }
    }

    /**
     * Woher die Auswertung erfaehrt, wie ein Titel aussieht.
     *
     * <p>Genau das fehlte, und daran hing ein sichtbarer Fehler: der
     * Jahresrueckblick stand auf dem Telefon und am Fernseher <em>ohne ein
     * einziges Bild</em> da. Die Karten koennen laengst eines tragen
     * ({@link Rueckblick} laedt es ueber {@link Bilder}), nur kam in der
     * Auswertung nie eines an.
     *
     * <p>Der Grund lag eine Ebene tiefer. Am Rechner bekommt
     * {@code statistik.auswerten} eine Nachschlagefunktion mitgereicht; hier
     * geht der Aufruf ueber den Kern, und durch diese Bruecke passt JSON,
     * aber keine Funktion. Es wanderte also nur der Zeitraum hinueber - und
     * jeder Titel kam ohne {@code bild} zurueck.
     *
     * <p>Deshalb eine Tabelle statt einer Funktion: eine Liste aus
     * {@code {id, titel, bild}}, die der Kern schluesselt. Geliefert wird sie
     * vom Bestand, also aus denselben Favoriten, aus denen auch die Kacheln
     * der Startseite ihr Bild nehmen - kein einziger zusaetzlicher Abruf.
     */
    public interface Titelquelle {
        JSONArray titel();
    }

    private final Context context;
    private final Kern kern;

    /** Der Titel-Nachschlag; ohne ihn rechnet die Auswertung wie bisher. */
    private Titelquelle titelquelle;

    /** Je Anbieter genau eine offene Sitzung - mehr kann es nicht geben. */
    private final Map<String, JSONObject> offene = new HashMap<>();

    private JSONArray sitzungen;
    private boolean schmutzig;
    private long zuletztGespeichert;
    private Beobachter beobachter;

    public Statistik(Context context, Kern kern) {
        this.context = context.getApplicationContext();
        this.kern = kern;
    }

    /** Wer von Aenderungen erfaehrt - der Geraeteabgleich und die Oberflaeche. */
    public void setzeBeobachter(Beobachter beobachter) {
        this.beobachter = beobachter;
    }

    /** Woher die Auswertung die Titelbilder nimmt - siehe {@link Titelquelle}. */
    public void setzeTitelquelle(Titelquelle titelquelle) {
        this.titelquelle = titelquelle;
    }

    /**
     * Die Titeltabelle fuer die Auswertung - {@code null}, wenn es keine gibt.
     *
     * <p>Ein Fehler beim Zusammenstellen kostet hoechstens die Bilder und nie
     * die Zahlen: die Auswertung laeuft dann wie vorher, nur ohne Poster.
     */
    private JSONArray titeltabelle() {
        Titelquelle quelle = titelquelle;
        if (quelle == null) return null;
        try {
            JSONArray tabelle = quelle.titel();
            return tabelle != null && tabelle.length() > 0 ? tabelle : null;
        } catch (Exception fehler) {
            Log.e(TAG, "Titeltabelle nicht lesbar", fehler);
            return null;
        }
    }

    /* ------------------------------------------------------------- Ablage */

    public JSONArray alle() {
        if (sitzungen != null) return sitzungen;
        sitzungen = new JSONArray();
        File datei = new File(context.getFilesDir(), DATEI);
        if (!datei.isFile()) return sitzungen;
        try (InputStream strom = new java.io.FileInputStream(datei)) {
            byte[] roh = new byte[(int) datei.length()];
            int gelesen = 0;
            while (gelesen < roh.length) {
                int schritt = strom.read(roh, gelesen, roh.length - gelesen);
                if (schritt < 0) break;
                gelesen += schritt;
            }
            JSONObject inhalt = new JSONObject(new String(roh, 0, gelesen, StandardCharsets.UTF_8));
            JSONArray liste = inhalt.optJSONArray("sitzungen");
            if (liste != null) sitzungen = liste;
        } catch (Exception fehler) {
            // Unlesbar loescht nichts: die naechste Aenderung schreibt neu.
            Log.e(TAG, DATEI + " unlesbar", fehler);
        }
        Log.i(TAG, "Sitzungen geladen: " + sitzungen.length());
        return sitzungen;
    }

    /**
     * Schreiben - erst daneben, dann umbenennen.
     *
     * <p>Dieselbe Vorsicht wie in {@link Ablage}: ein Absturz mitten im
     * Schreiben laesst sonst eine halbe Datei zurueck, und die ist beim
     * naechsten Start unlesbar. Bei einer Jahresbilanz waere das der Verlust
     * eines Jahres.
     */
    public void speichern() {
        if (!schmutzig) return;
        File ziel = new File(context.getFilesDir(), DATEI);
        File zwischen = new File(context.getFilesDir(), DATEI + ".neu");
        try {
            JSONObject inhalt = new JSONObject();
            inhalt.put("version", SCHEMA);
            inhalt.put("sitzungen", alle());
            try (FileOutputStream strom = new FileOutputStream(zwischen)) {
                strom.write(inhalt.toString().getBytes(StandardCharsets.UTF_8));
                strom.getFD().sync();
            }
            if (!zwischen.renameTo(ziel) && !(ziel.delete() && zwischen.renameTo(ziel))) {
                Log.e(TAG, DATEI + " nicht ersetzt");
                return;
            }
            schmutzig = false;
            zuletztGespeichert = System.currentTimeMillis();
            // Der eine Punkt, an dem sich an den Sitzungen wirklich etwas
            // geaendert hat - genau wie am Rechner, wo saveSitzungen() den
            // Abgleich anstoesst. Nicht bei jedem Takt: die laufende Sitzung
            // faellt beim Sammeln ohnehin durch den Filter, weil sie noch
            // waechst.
            if (beobachter != null) beobachter.sitzungenGespeichert();
        } catch (Exception fehler) {
            Log.e(TAG, DATEI + " nicht gespeichert", fehler);
        } finally {
            if (zwischen.exists()) zwischen.delete();
        }
    }

    /**
     * Die laufende Sitzung steht bereits in der Liste und wird an Ort und
     * Stelle fortgeschrieben.
     *
     * <p>Dadurch ueberlebt sie einen Prozessabbruch mit dem Stand des letzten
     * Sicherns - eine leere Liste waere das schlechtere Ergebnis.
     */
    private void ablegen(JSONObject sitzung) {
        String id = sitzung.optString("id", "");
        if (id.isEmpty()) return;
        JSONArray liste = alle();
        for (int i = 0; i < liste.length(); i += 1) {
            JSONObject vorhanden = liste.optJSONObject(i);
            if (vorhanden != null && id.equals(vorhanden.optString("id"))) {
                try {
                    liste.put(i, sitzung);
                } catch (Exception fehler) {
                    Log.e(TAG, "Sitzung nicht ersetzt", fehler);
                }
                schmutzig = true;
                return;
            }
        }
        liste.put(sitzung);
        schmutzig = true;
    }

    private void verwerfen(String id) {
        if (id == null || id.isEmpty()) return;
        JSONArray liste = alle();
        JSONArray behalten = new JSONArray();
        boolean weg = false;
        for (int i = 0; i < liste.length(); i += 1) {
            JSONObject sitzung = liste.optJSONObject(i);
            if (sitzung == null) continue;
            if (id.equals(sitzung.optString("id"))) {
                weg = true;
                continue;
            }
            behalten.put(sitzung);
        }
        if (!weg) return;
        sitzungen = behalten;
        schmutzig = true;
    }

    /* --------------------------------------------- Von den anderen Geraeten */

    /**
     * Sitzungen, die auf einem anderen eigenen Geraet entstanden sind.
     *
     * <p>Sie kommen dazu oder sie sind schon da - ueberschrieben wird nie.
     * Eine abgeschlossene Sitzung ist ein Ereignis und kein Zustand: zwei
     * Geraete koennen denselben Satz nicht verschieden wissen, und dieselbe
     * Kennung darf es nur einmal geben. Genau daran haengt, dass aus drei
     * Stunden am Rechner, zwei am Telefon und vier am Fernseher neun werden -
     * und nicht achtzehn.
     *
     * <p>Der Weg fuehrt ausdruecklich durch dieses Objekt und nicht an ihm
     * vorbei in die Datei. Sonst haelt das laufende {@code Statistik} weiter
     * seine alte Liste im Speicher, und ein Rueckblick, der jetzt geoeffnet
     * wird, rechnet mit Zahlen von vorhin.
     *
     * @return wie viele wirklich dazugekommen sind
     */
    public int uebernehmen(JSONArray neue) {
        // Die Regel selbst steht in Sitzungen.vereinen - dieselbe wie
        // statistik.vereinen im Kern, und einmal geschrieben statt an jeder
        // Stelle, die Sitzungen zusammenlegt.
        Sitzungen.Ergebnis ergebnis = Sitzungen.vereinen(alle(), neue);
        if (ergebnis.dazu == 0) return 0;
        sitzungen = ergebnis.sitzungen;
        schmutzig = true;
        speichern();
        Log.i(TAG, "Sitzungen von einem anderen Geraet uebernommen: " + ergebnis.dazu);
        if (beobachter != null) beobachter.sitzungenUebernommen();
        return ergebnis.dazu;
    }

    /**
     * Die Kennungen der Sitzungen, die gerade noch wachsen.
     *
     * <p>Sie stehen bereits in der Ablage - damit ein Prozessabbruch sie nicht
     * kostet -, sind aber keine fertigen Saetze. Was hier hinausginge, waere
     * ein Zwischenstand, der drueben als abgeschlossene Sitzung dastuende und
     * nie wieder korrigiert wuerde. Dieselbe Auskunft wie
     * {@code laufendeSitzungIds} am Rechner.
     */
    public java.util.List<String> offeneIds() {
        java.util.List<String> ids = new java.util.ArrayList<>();
        for (JSONObject offen : offene.values()) {
            if (offen == null) continue;
            String id = offen.optString("id", "");
            if (!id.isEmpty()) ids.add(id);
        }
        return ids;
    }

    /* ----------------------------------------------------------- Der Takt */

    /**
     * Ein Messwert.
     *
     * <p>Wird bei jedem Takt der {@link Messung} gerufen, also alle fuenf
     * Sekunden, solange etwas laeuft. Entschieden wird nichts hier: der Kern
     * bekommt die vorige offene Sitzung und sagt, was daraus geworden ist.
     *
     * @param eintrag der Favorit, zu dem die Wiedergabe gehoert - ohne ihn ist
     *                nicht zu sagen, welche Serie lief, und die Meldung faellt
     *                aus
     */
    public void melden(Provider provider, String url, JSONObject eintrag, JSONObject fortschritt) {
        if (kern == null || !kern.istBereit() || provider == null || eintrag == null) return;
        if (url == null || !url.startsWith("http")) return;

        JSONObject vorher = offene.get(provider.id);
        JSONObject angaben = new JSONObject();
        try {
            angaben.put("provider", provider.alsJson());
            angaben.put("url", url);
            angaben.put("entry", eintrag);
            angaben.put("fortschritt", fortschritt == null ? new JSONObject() : fortschritt);
        } catch (Exception fehler) {
            Log.e(TAG, "Sitzungsmeldung nicht gebaut", fehler);
            return;
        }

        kern.rufe("sitzungslauf.schritt",
            Kern.args(vorher == null ? JSONObject.NULL : vorher, angaben, System.currentTimeMillis()),
            (wert, fehler) -> {
                if (fehler != null) {
                    Log.e(TAG, "Sitzung nicht fortgeschrieben: " + fehler);
                    return;
                }
                uebernehmen(provider.id, wert);
            });
    }

    private void uebernehmen(String providerId, String ergebnisJson) {
        try {
            JSONObject ergebnis = new JSONObject(ergebnisJson == null ? "{}" : ergebnisJson);
            JSONObject geschlossen = ergebnis.optJSONObject("geschlossen");
            if (geschlossen != null) beenden(geschlossen);

            JSONObject offen = ergebnis.optJSONObject("offen");
            if (offen == null) offene.remove(providerId);
            else offene.put(providerId, offen);

            JSONObject ablegen = ergebnis.optJSONObject("ablegen");
            if (ablegen != null) ablegen(ablegen);
            String weg = ergebnis.optString("verwerfen", "");
            if (!weg.isEmpty()) verwerfen(weg);

            if (System.currentTimeMillis() - zuletztGespeichert >= SICHERN_MS) speichern();
        } catch (Exception fehler) {
            Log.e(TAG, "Sitzungsergebnis unlesbar", fehler);
        }
    }

    /**
     * Alles Offene schliessen - beim Anbieterwechsel, beim Verlassen der
     * Ansicht und wenn die App in den Hintergrund geht.
     *
     * <p>Ohne das bliebe die letzte Folge eines Abends ungezaehlt. Auf dem
     * Telefon ist das der Regelfall und nicht die Ausnahme: eine App wird nicht
     * beendet, sie verschwindet.
     *
     * @param providerId {@code null} schliesst alle
     */
    public void schliessen(String providerId) {
        if (kern == null || !kern.istBereit()) return;
        java.util.List<String> betroffen = new java.util.ArrayList<>();
        if (providerId == null) betroffen.addAll(offene.keySet());
        else betroffen.add(providerId);
        for (String id : betroffen) {
            JSONObject offen = offene.remove(id);
            if (offen != null) beenden(offen);
        }
    }

    private void beenden(JSONObject stand) {
        kern.rufe("sitzungslauf.beenden", Kern.args(stand), (wert, fehler) -> {
            if (fehler != null) {
                Log.e(TAG, "Sitzung nicht beendet: " + fehler);
                return;
            }
            try {
                JSONObject urteil = new JSONObject(wert == null ? "{}" : wert);
                JSONObject ablegen = urteil.optJSONObject("ablegen");
                if (ablegen != null) ablegen(ablegen);
                String weg = urteil.optString("verwerfen", "");
                if (!weg.isEmpty()) verwerfen(weg);
                speichern();
            } catch (Exception ausnahme) {
                Log.e(TAG, "Sitzungsurteil unlesbar", ausnahme);
            }
        });
    }

    /* ------------------------------------------------------- Die Auswertung */

    /**
     * Die Bilanz eines Zeitraums.
     *
     * <p>Gerechnet wird im Kern, mit {@code statistik.auswerten} - derselben
     * Funktion, aus der auch die Statistikseite des Rechners kommt.
     *
     * <p>Den Titel-Nachschlag bekommt sie als Tabelle mitgereicht (siehe
     * {@link Titelquelle}) - daher stammen die Titelbilder der Karten. Was
     * weiterhin fehlt, ist die Genre-Aufteilung: die Genres stehen am Rechner
     * im Geschmacks-Cache des Empfehlungslaufs, und der ist hier ein eigener
     * Zustand im Kern. Alles Uebrige - Zeit, Folgen, Titel, Abende, Strecken -
     * steht in den Sitzungen selbst.
     *
     * @param zeitraum "7tage", "30tage", "monat", "jahr", "alles" oder eine
     *                 Jahreszahl
     */
    public void auswerten(String zeitraum, Auswertung antwort) {
        if (kern == null || !kern.istBereit()) {
            antwort.fertig(null, "Der Kern ist noch nicht bereit.");
            return;
        }
        kern.rufe("sitzungslauf.zeitraumGrenzen",
            Kern.args(zeitraum == null ? "alles" : zeitraum, System.currentTimeMillis()),
            (grenzenJson, fehler) -> {
                if (fehler != null) {
                    antwort.fertig(null, fehler);
                    return;
                }
                JSONObject optionen = new JSONObject();
                try {
                    JSONObject grenzen = new JSONObject(grenzenJson == null ? "{}" : grenzenJson);
                    // JSON kennt kein -Infinity; der Kern bekommt die Grenze
                    // deshalb als 0 und meint damit dasselbe: alles.
                    double von = grenzen.optDouble("von", 0);
                    optionen.put("von", Double.isInfinite(von) || Double.isNaN(von) ? 0 : von);
                    optionen.put("bis", grenzen.optDouble("bis", System.currentTimeMillis()));
                    // Damit die Karten des Jahresrueckblicks ein Bild haben.
                    JSONArray tabelle = titeltabelle();
                    if (tabelle != null) optionen.put("titelKarte", tabelle);
                } catch (Exception ausnahme) {
                    antwort.fertig(null, "Zeitraum unlesbar");
                    return;
                }
                kern.rufe("statistik.auswerten", Kern.args(alle(), optionen), (wert, fehler2) -> {
                    if (fehler2 != null) {
                        antwort.fertig(null, fehler2);
                        return;
                    }
                    try {
                        antwort.fertig(new JSONObject(wert == null ? "{}" : wert), null);
                    } catch (Exception ausnahme) {
                        antwort.fertig(null, "Auswertung unlesbar");
                    }
                });
            });
    }

    /** Was in welcher Folge gezeigt wird. Leer heisst: wie gebaut. */
    public interface Reihenfolge {
        void fertig(java.util.List<String> schluessel);
    }

    /**
     * In welcher Reihenfolge der Jahresrueckblick seine Karten zeigt.
     *
     * <p>Entschieden wird das im Kern ({@code statistik.wrappedReihenfolge}) -
     * derselben Regel, die auch der Rechner fragt. Eine zweite hier waere
     * genau die Sorte Unterschied, die man erst bemerkt, wenn zwei Geraete
     * denselben Rueckblick verschieden erzaehlen.
     *
     * <p>Faellt der Aufruf aus, kommt eine leere Liste zurueck und der
     * Rueckblick bleibt in der Reihenfolge, in der er gebaut wurde. Immer
     * dieselbe Folge ist schlechter als eine wechselnde, aber besser als gar
     * kein Rueckblick.
     */
    public void wrappedReihenfolge(java.util.List<String> schluessel, int jahr,
                                   Reihenfolge antwort) {
        if (antwort == null) return;
        if (kern == null || !kern.istBereit() || schluessel == null || schluessel.isEmpty()) {
            antwort.fertig(java.util.Collections.emptyList());
            return;
        }
        JSONArray liste = new JSONArray();
        for (String eintrag : schluessel) liste.put(eintrag);
        kern.rufe("statistik.wrappedReihenfolge", Kern.args(liste, jahr), (wert, fehler) -> {
            java.util.ArrayList<String> ordnung = new java.util.ArrayList<>();
            if (fehler == null && wert != null) {
                try {
                    JSONArray roh = new JSONArray(wert);
                    for (int i = 0; i < roh.length(); i += 1) {
                        String eintrag = roh.optString(i, "");
                        if (!eintrag.isEmpty()) ordnung.add(eintrag);
                    }
                } catch (Exception ausnahme) {
                    Log.e(TAG, "Reihenfolge unlesbar", ausnahme);
                    ordnung.clear();
                }
            }
            antwort.fertig(ordnung);
        });
    }

    /** Welches Jahr gerade Saison hat - 0 heisst: keine. */
    public interface Saison {
        void fertig(int jahr);
    }

    /**
     * Hat der Jahresrueckblick gerade Saison?
     *
     * <p>Die Frage, an der auf der Startseite haengt, ob der Weg dorthin von
     * selbst dasteht. Entschieden wird sie im Kern - {@code statistik.wrappedJahrFuer}
     * fuer das Fenster (1. Dezember bis 6. Januar) und {@code statistik.wrappedLage}
     * dafuer, ob ueberhaupt genug zu erzaehlen ist. Dieselben zwei Funktionen
     * fragt der Rechner; eine eigene Vorstellung davon, wann Dezember genug
     * Dezember ist, gibt es hier nicht.
     *
     * <p>Ausserhalb des Fensters kostet das genau einen Aufruf und keine
     * Auswertung: die Frist entscheidet sich am Datum, nicht an den Sitzungen.
     * Elf Monate im Jahr ist das die ganze Rechnung.
     */
    public void wrappedSaison(Saison antwort) {
        if (antwort == null) return;
        if (kern == null || !kern.istBereit()) {
            antwort.fertig(0);
            return;
        }
        kern.rufe("statistik.wrappedJahrFuer", Kern.args(System.currentTimeMillis()),
            (wert, fehler) -> {
                int jahr = ganzeZahl(wert);
                if (fehler != null || jahr <= 0) {
                    antwort.fertig(0);
                    return;
                }
                auswerten(String.valueOf(jahr), (daten, fehler2) -> {
                    if (fehler2 != null || daten == null) {
                        antwort.fertig(0);
                        return;
                    }
                    JSONObject optionen = new JSONObject();
                    try {
                        optionen.put("jahrWunsch", jahr);
                        optionen.put("jetzt", System.currentTimeMillis());
                    } catch (Exception ausnahme) {
                        antwort.fertig(0);
                        return;
                    }
                    kern.rufe("statistik.wrappedLage", Kern.args(daten, optionen),
                        (lageJson, fehler3) -> {
                            if (fehler3 != null || lageJson == null) {
                                antwort.fertig(0);
                                return;
                            }
                            try {
                                JSONObject lage = new JSONObject(lageJson);
                                antwort.fertig(lage.optBoolean("saison", false) ? jahr : 0);
                            } catch (Exception ausnahme) {
                                antwort.fertig(0);
                            }
                        });
                });
            });
    }

    /** Eine Zahl aus einer Kern-Antwort. JSON liefert sie als blossen Text. */
    private static int ganzeZahl(String wert) {
        try {
            return (int) Math.round(Double.parseDouble(wert == null ? "" : wert.trim()));
        } catch (NumberFormatException fehler) {
            return 0;
        }
    }

    /** Ob ueberhaupt schon etwas gemessen wurde - sonst hat ein Rueckblick nichts zu zeigen. */
    public boolean hatDaten() {
        return alle().length() > 0;
    }

    /** Die Jahre, zu denen es Sitzungen gibt - jüngstes zuerst. */
    public java.util.List<Integer> jahre() {
        java.util.TreeSet<Integer> gefunden = new java.util.TreeSet<>(java.util.Collections.reverseOrder());
        JSONArray liste = alle();
        for (int i = 0; i < liste.length(); i += 1) {
            JSONObject sitzung = liste.optJSONObject(i);
            if (sitzung == null) continue;
            String beginn = sitzung.optString("begonnenAm", "");
            if (beginn.length() < 4) continue;
            try {
                gefunden.add(Integer.parseInt(beginn.substring(0, 4)));
            } catch (NumberFormatException ignoriert) {
                // Ein Satz ohne brauchbares Datum zaehlt nicht als Jahr.
            }
        }
        return new java.util.ArrayList<>(gefunden);
    }
}
