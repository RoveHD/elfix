package local.elflix.android;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Woher ein Eintrag sein Titelbild bekommt.
 *
 * <p>Das Bild steht auf der Anbieterseite - als {@code og:image}, als Poster
 * neben der Beschreibung oder im Hintergrund einer Kachel. Welches davon zum
 * Titel gehoert und welches aus der Empfehlungsspalte daneben stammt, ist keine
 * Kleinigkeit: ein falsches Bild ist schlimmer als keins.
 *
 * <p>Deshalb steht die Auswahl nicht hier. Sie steht in {@code seitendaten.js},
 * kommt aus der Desktop-App und wird von ihr genauso benutzt - der Kern reicht
 * den Quelltext heraus, diese Klasse spielt ihn in die Seite ein. Was hier
 * bleibt, ist die Verkabelung: fragen, sich merken und nachtragen.
 *
 * <p>Gefragt wird beim Seitenwechsel, nicht im Messtakt. Ein Titelbild aendert
 * sich nicht alle fuenf Sekunden, und das Skript geht durch jedes Bild der
 * Seite - das ist Arbeit, die einmal je Seite genuegt. Weil manche Anbieter
 * ihre Bilder nachladen, wird zweimal nachgefasst, falls beim ersten Blick
 * noch keines dastand.
 */
public final class Titelbild {
    private static final String TAG = CrashReporter.TAG;
    /**
     * Wann noch einmal nachgesehen wird, wenn die Seite noch nichts hergab.
     *
     * <p>Frueher und oefter als bisher, und der Grund steht in
     * {@code onPageStarted} der MainActivity: bei diesen Anbietern kommt
     * {@code onPageFinished} erst, wenn auch die letzte Werbung geladen ist -
     * gemessen auf einer gedrosselten Leitung nach 150 Sekunden noch nicht.
     * Der Autostart klickt den Hoster aber schon nach zwoelf Sekunden an, und
     * danach steht die Folgenseite nicht mehr im Hauptrahmen. Wer erst beim
     * Seitenende liest, liest bei diesen Ladezeiten gar nicht.
     */
    private static final long[] NACHFASSEN_MS = {700, 1600, 3200, 6000, 9500};

    private final Kern kern;
    private final Bestand bestand;
    private final Handler haupt = new Handler(Looper.getMainLooper());

    /**
     * Was von der Seite ausser dem Bild noch zaehlt.
     *
     * <p>Das Skript liest laengst mehr als ein Bild: den Titel, die Art und vor
     * allem die Grenzen der Serie - welche Staffel die letzte ist, welche Folge
     * darin die letzte, und welche Folgen gar nicht spielbar sind. Genau daran
     * entscheidet die geteilte Regel, ob eine Serie mit dieser Folge
     * <em>durch</em> ist.
     *
     * <p>Hier wurde bisher nur {@code thumbnail} und {@code favicon}
     * herausgegriffen und der Rest weggeworfen. Die Folge war kein Schoenheits-
     * fehler: auf dem Telefon konnte eine Serie nie abgeschlossen werden. Die
     * letzte Folge wurde abgehakt wie jede andere, der Eintrag blieb in
     * "Weiterschauen" stehen und wartete auf eine Folge, die es nicht gibt.
     */
    private static final String[] UEBERNOMMEN = {
        "thumbnail", "favicon", "title", "type",
        "finalSeason", "finalEpisode", "finalEpisodeTrimmed",
        // Wo die *laufende* Staffel aufhoert. Ohne sie endet jede Staffel im
        // Nichts: die Regel zaehlt dann nur hoch und findet den Uebergang zur
        // naechsten Staffel nie. Am Rechner kommt die Zahl aus der
        // nachgeladenen Staffeluebersicht, hier von der Folgenseite selbst -
        // dieselbe Regel, siehe seitendaten.js.
        "seasonLastEpisode",
        "unplayableSeason", "unplayableEpisodes"
    };

    /** Was auf einer Seite gefunden wurde. */
    private static final class Fund {
        /** Die gepruefte Auskunft der Seite - siehe {@link #UEBERNOMMEN}. */
        JSONObject seitendaten = new JSONObject();
        String bild = "";
        String favicon = "";
    }

    /**
     * Wie viele Seiten im Gedaechtnis bleiben.
     *
     * <p>Zwei wuerden genuegen - die Folgenseite und die des Hosters -, vier
     * sind der Puffer fuer eine Weiterleitungskette dazwischen.
     */
    private static final int GEDAECHTNIS = 4;

    private String skript;
    /**
     * Was auf welcher Seite gefunden wurde.
     *
     * <p><b>Warum ein Gedaechtnis und nicht ein Platz.</b> Hier stand bis
     * hierher genau ein Satz Angaben, und jede neue Seite hat ihn geloescht.
     * Am Rechner faellt das nicht auf: dort liegt der Hoster in einem Rahmen
     * <em>innerhalb</em> der Anbieterseite, und der Hauptrahmen bleibt die
     * ganze Wiedergabe ueber auf der Folge stehen.
     *
     * <p>Auf dem Telefon nimmt der Hoster den Hauptrahmen. Damit lief es so:
     * Folgenseite gelesen, Grenzen der Serie gefunden - dann klickt der
     * Autostart den Hoster an, {@code onPageFinished} kommt fuer voe.sx, und
     * mit ihm war alles weg. Ab da lieferte {@link #angaben} zur Folgenadresse
     * nur noch ein leeres Objekt. Die Folge: {@code finalSeason} erreichte
     * weder den Eintrag noch die Regel, {@code nextEpisodeContinueUrl} gab
     * nichts zurueck - und auf dem Telefon gab es nie eine naechste Folge.
     *
     * <p>Gespeichert wird deshalb je Adresse. Eine Auskunft wird nur zu genau
     * der Adresse zurueckgegeben, von der sie gelesen wurde; die Angaben des
     * Hosters koennen also nie an einer Folge landen.
     */
    private final java.util.LinkedHashMap<String, Fund> funde =
        new java.util.LinkedHashMap<String, Fund>(8, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(java.util.Map.Entry<String, Fund> aeltester) {
                return size() > GEDAECHTNIS;
            }
        };
    /** Die Seite, die gerade gelesen wird. */
    private String adresse = "";
    /** Ob fuer sie schon eine Lesekette laeuft - eine je Seite genuegt. */
    private boolean liest;

    public Titelbild(Kern kern, Bestand bestand) {
        this.kern = kern;
        this.bestand = bestand;
    }

    /**
     * Auf dieser Seite nach dem Titelbild sehen.
     *
     * <p>Der Aufruf kehrt sofort zurueck. Findet sich etwas, wird es dem
     * Eintrag nachgetragen, der zu dieser Adresse gehoert - und steht ausserdem
     * bereit, wenn gleich darauf einer angelegt wird.
     */
    public void suchen(WebView ansicht, Provider anbieter, String seitenAdresse) {
        if (ansicht == null || anbieter == null || seitenAdresse == null
            || !seitenAdresse.startsWith("http")) {
            return;
        }
        // Ohne Kern gibt es kein Skript und damit keine Lesekette. Dann hier
        // aufhoeren, statt die Sperre zu setzen: sonst bliebe sie stehen, und
        // der zweite Versuch beim Seitenende - wenn der Kern laengst steht -
        // wuerde uebersprungen.
        if (skript == null && (kern == null || !kern.istBereit())) return;
        boolean andereSeite = !seitenAdresse.equals(adresse);
        if (andereSeite) {
            // Eine neue Seite. Was von der vorigen bekannt ist, bleibt stehen -
            // es gehoert zu ihrer Adresse und wird nur zu ihr herausgegeben.
            adresse = seitenAdresse;
            liest = false;
        }
        if (!funde.containsKey(seitenAdresse)) funde.put(seitenAdresse, new Fund());
        // Eine Lesekette je Seite. Gerufen wird zweimal - beim Seitenanfang und
        // beim Seitenende -, und ohne diese Sperre liefen danach zwei Ketten
        // nebeneinander durch dieselbe Seite.
        if (!andereSeite && liest) return;
        liest = true;
        skriptHolen(() -> lesen(ansicht, anbieter, seitenAdresse, 0));
    }

    /**
     * Was zu dieser Adresse bekannt ist, in der Form, die die geteilte Regel
     * erwartet - zum Anhaengen an die Angaben eines Standes.
     *
     * <p>Nur zur passenden Adresse: das Bild der vorigen Folge gehoert nicht an
     * den Eintrag der naechsten Serie.
     */
    public JSONObject angaben(String seitenAdresse) {
        JSONObject angaben = new JSONObject();
        Fund fund = seitenAdresse == null ? null : funde.get(seitenAdresse);
        if (fund == null) return angaben;
        try {
            for (String name : UEBERNOMMEN) {
                if (fund.seitendaten.has(name)) angaben.put(name, fund.seitendaten.get(name));
            }
            // Bild und Favicon koennen aus einem spaeteren Nachfassen stammen
            // und stehen dann nicht in den Seitendaten des ersten Blicks.
            if (!fund.bild.isEmpty()) angaben.put("thumbnail", fund.bild);
            if (!fund.favicon.isEmpty()) angaben.put("favicon", fund.favicon);
        } catch (Exception fehler) {
            Log.d(TAG, "Seitenangaben nicht gebaut: " + fehler);
        }
        return angaben;
    }

    /** Fuegt die bekannten Bildangaben in bestehende Angaben ein, ohne sie zu ueberschreiben. */
    public JSONObject ergaenzen(JSONObject angaben, String seitenAdresse) {
        JSONObject dazu = angaben(seitenAdresse);
        JSONObject ziel = angaben == null ? new JSONObject() : angaben;
        for (java.util.Iterator<String> namen = dazu.keys(); namen.hasNext(); ) {
            String name = namen.next();
            if (ziel.has(name)) continue;
            try {
                ziel.put(name, dazu.get(name));
            } catch (Exception fehler) {
                Log.d(TAG, "Bildangabe nicht uebernommen: " + fehler);
            }
        }
        return ziel;
    }

    private void skriptHolen(Runnable danach) {
        if (skript != null) {
            danach.run();
            return;
        }
        if (kern == null || !kern.istBereit()) return;
        kern.rufe("seitendaten.seitenSkript", (wert, fehler) -> {
            if (fehler != null || wert == null) {
                Log.e(TAG, "Seitenskript nicht erhalten: " + fehler);
                return;
            }
            try {
                // Der Wert kommt als JSON-Text: ein Textliteral in Anfuehrungszeichen.
                skript = new JSONArray("[" + wert + "]").getString(0);
            } catch (Exception ausnahme) {
                Log.e(TAG, "Seitenskript unlesbar", ausnahme);
                return;
            }
            danach.run();
        });
    }

    private void lesen(WebView ansicht, Provider anbieter, String seitenAdresse, int versuch) {
        // Steht die Seite nicht mehr, endet die Kette. Was sie gefunden hat,
        // bleibt unter ihrer Adresse liegen.
        if (skript == null || !seitenAdresse.equals(adresse)) return;
        ansicht.evaluateJavascript(skript, wert -> {
            if (!seitenAdresse.equals(adresse)) return;
            if (wert == null || "null".equals(wert)) {
                nachfassen(ansicht, anbieter, seitenAdresse, versuch);
                return;
            }
            // Erst durch die Pruefung des Kerns, dann uebernehmen - dieselbe
            // Reihenfolge wie am Rechner (gepruefteSeitendaten). Sie wirft weg,
            // was zu einer anderen Adresse gehoert; ohne sie stuende die
            // Staffelgrenze einer Serienuebersicht am Eintrag einer Folge.
            kern.rufe("fortschritt.gepruefteSeitendaten",
                Kern.args(rohObjekt(wert), seitenAdresse), (geprueft, fehler) -> {
                    if (!seitenAdresse.equals(adresse)) return;
                    if (fehler != null || geprueft == null) {
                        Log.d(TAG, "Seitendaten nicht geprueft: " + fehler);
                        nachfassen(ansicht, anbieter, seitenAdresse, versuch);
                        return;
                    }
                    uebernehmen(ansicht, anbieter, seitenAdresse, versuch, geprueft);
                });
        });
    }

    /** Der rohe Wert aus der Seite als Objekt - er kommt als JSON-Text herein. */
    private static Object rohObjekt(String wert) {
        try {
            return new JSONObject(wert);
        } catch (Exception fehler) {
            // Ein aelterer WebView kann am Skript scheitern. Dann gibt es hier
            // eben keine Angaben - die Karte bleibt bei ihren Buchstaben, und
            // sonst aendert sich nichts.
            return new JSONObject();
        }
    }

    private void uebernehmen(WebView ansicht, Provider anbieter, String seitenAdresse,
                             int versuch, String gepruefterJson) {
        Fund fund = funde.get(seitenAdresse);
        if (fund == null) {
            fund = new Fund();
            funde.put(seitenAdresse, fund);
        }
        try {
            fund.seitendaten = new JSONObject(gepruefterJson);
        } catch (Exception fehler) {
            Log.d(TAG, "Gepruefte Seitendaten unlesbar: " + fehler);
            fund.seitendaten = new JSONObject();
        }
        // Damit sich am Geraet nachlesen laesst, ob die Folgenseite ihre
        // Grenzen ueberhaupt hergegeben hat - ohne sie gibt es keine naechste
        // Folge, und das ist von aussen nicht zu unterscheiden von "es gibt
        // keine".
        Log.i(TAG, "FOLGE seitendaten " + kurz(seitenAdresse)
            + " finalSeason=" + fund.seitendaten.optInt("finalSeason", 0)
            + " finalEpisode=" + fund.seitendaten.optInt("finalEpisode", 0)
            + " seasonLastEpisode=" + fund.seitendaten.optInt("seasonLastEpisode", 0)
            + " versuch=" + versuch);
        String gefundenesFavicon = fund.seitendaten.optString("favicon", "");
        if (!gefundenesFavicon.isEmpty()) fund.favicon = gefundenesFavicon;
        String gefunden = fund.seitendaten.optString("thumbnail", "");
        if (!gefunden.isEmpty()) {
            fund.bild = gefunden;
            // Die Kette ist fertig - aber nur die dieser Seite. Eine
            // Nachzueglermeldung darf die Sperre der Seite, die inzwischen
            // dasteht, nicht loesen.
            if (seitenAdresse.equals(adresse)) liest = false;
            if (bestand != null) bestand.bildNachtragen(anbieter, seitenAdresse, gefunden);
            return;
        }
        // Kein Bild: manche Anbieter haengen ihre Bilder erst nach dem Laden
        // ein. Die Seriengrenzen von eben bleiben dabei stehen - sie sind schon
        // richtig, und ein zweiter Blick liefert dieselben.
        nachfassen(ansicht, anbieter, seitenAdresse, versuch);
    }

    private void nachfassen(WebView ansicht, Provider anbieter, String seitenAdresse, int versuch) {
        if (versuch >= NACHFASSEN_MS.length) {
            if (seitenAdresse.equals(adresse)) liest = false;
            return;
        }
        haupt.postDelayed(() -> lesen(ansicht, anbieter, seitenAdresse, versuch + 1),
            NACHFASSEN_MS[versuch]);
    }

    /** Eine Adresse, so kurz, dass sie in eine Protokollzeile passt. */
    private static String kurz(String url) {
        return Folgen.kurz(url);
    }
}
