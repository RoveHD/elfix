package local.elflix.android;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Das Mitschauen: Play, Pause und Sprung zwischen den Geraeten einer Runde.
 *
 * <h2>Was hier fehlte</h2>
 *
 * <p>Die Watchparty lief auf Android bis hierher nur als Fortschrittsabgleich.
 * Derselbe Raumcode auf Telefon und Rechner, derselbe Weiterschauen-Stand -
 * aber wer auf dem Fernseher Pause drueckte, drueckte allein. In
 * {@link Watchparty} stand das sogar so: "Steuerung, Stand und Chat gehoeren
 * zum Live-Schauen. Sie kommen an, sobald die Wiedergabe-Steuerung sie
 * braucht; bisher wird nur der Fortschritt abgeglichen."
 *
 * <p>Gefehlt hat dabei <em>keine Fachlogik</em>. Die stand von Anfang an in
 * den geteilten Modulen und lief auch auf Android: {@code watchparty.js} fuehrt
 * die Verbindung samt Wiederanschluss und Uhrenabgleich,
 * {@code watchparty-raeume.js} mehrere Raeume, {@code watchparty-sync.js}
 * rechnet Zielzeit und Drift, und wer Host ist, entscheidet ohnehin das Relay.
 * Gefehlt hat die Verkabelung zwischen alldem und dem Video im WebView.
 *
 * <p>Genau die steht hier. Diese Klasse entscheidet nichts: was zu tun ist,
 * fragt sie ueber {@code watchparty-bruecke.steuerungPruefen} im Kern, und was
 * sie in den Player einsetzt, ist das Skript, das der Rechner dort einsetzt.
 *
 * <h2>Der Weg hinein und hinaus</h2>
 *
 * <p><b>Hinaus.</b> In jeden Rahmen mit Video geht der Horcher aus
 * {@code watchparty-sync.beobachterScript()}. Er meldet ueber die Konsole -
 * der einzige Weg, der aus einem fremden Rahmen heraus auf beiden Geraeten
 * funktioniert. {@code onConsoleMessage} hoert dort mit, anders als
 * {@code evaluateJavascript}.
 *
 * <p><b>Hinein.</b> Ein Befehl des Relays kommt als {@code watchparty:steuerung}
 * an, wird im Kern beurteilt und geht als fertiges Skript ueber
 * {@link Rahmen#anSpieler} in dieselben Rahmen.
 *
 * <h2>Warum es einen Folgenwechsel ueberlebt</h2>
 *
 * <p>Das war der gemeldete Fehler: nach einem Folgenwechsel wirkte Play/Pause
 * zwischen den Geraeten nicht mehr. Drei Dinge zusammen halten das jetzt:
 *
 * <ol>
 *   <li>Der Horcher haengt am <em>Dokument</em> in der Abfangphase, nicht an
 *       einem Videoelement. Tauscht der Hoster den Player aus, gilt er weiter.
 *   <li>Er wird bei <em>jeder</em> Meldung eines Rahmens mit Video neu
 *       eingespielt ({@link #anPlayer}). Ein neues Dokument hat den Merker
 *       {@code __elfixWpInstalled} nicht, bekommt den Horcher also wirklich;
 *       ein altes hat ihn und weist die Wiederholung ab. Damit kann es weder
 *       doppelte Horcher geben noch gar keine.
 *   <li>Der Zustand der Folge davor wird verworfen ({@link #zuruecksetzen}) -
 *       sonst wiese die Veraltungspruefung die ersten Befehle der neuen Folge
 *       als Nachzuegler ab, weil deren laufende Nummer kleiner ist.
 * </ol>
 *
 * <h2>Und warum es keine Schleife gibt</h2>
 *
 * <p>Ein empfangenes Pause wird angewendet, der eigene Player meldet daraufhin
 * "pause", und das ginge als eigene Tat zurueck an die Runde. Dagegen setzt
 * {@code applyScript} vor jeder Anwendung {@code window.__elfixWpErwartet},
 * und der Horcher verschluckt genau das eine Echo - nicht mehr. Wer waehrend
 * eines eingehenden Play selbst Pause drueckt, kommt weiterhin durch. Kein
 * Zeitgeber, keine pauschale Stille.
 */
public final class Mitschauen {
    private static final String TAG = CrashReporter.TAG;

    /** Was diese Klasse von der Oberflaeche braucht. */
    public interface Umgebung {
        /** Der WebView, in dem gerade geschaut wird - oder {@code null}. */
        WebView spieler();

        /** Die Adresse, die dort offen steht. */
        String adresse();

        /** Der Anbieter dazu. */
        Provider anbieter();

        /** Auf diese Adresse wechseln, weil die Runde es tut. */
        void folgeOeffnen(Provider anbieter, String url);

        /** Der Zustand hat sich geaendert - die Anzeige darf nachziehen. */
        void anzeigeAuffrischen();
    }

    private final Kern kern;
    private final Rahmen rahmen;
    private final Watchparty watchparty;
    private final Umgebung umgebung;
    private final Handler haupt = new Handler(Looper.getMainLooper());

    private String beobachterSkript = "";
    private String meldeAktion = "__elfix:wp:";
    private String meldeStand = "__elfix:wp:stand:";
    private String meldeSync = "__elfix:wp:sync:";

    /**
     * Die Sitzung des laufenden Players.
     *
     * <p>Das Relay nimmt sie als Beweis, dass hier wirklich jemand am Video
     * sitzt - ohne sie zaehlt dieses Geraet nicht als aktiver Teilnehmer und
     * wird nie Host (siehe {@code istAktiv} im Relay). Sie wechselt mit jedem
     * neuen Player, also bei jedem Folgen-, Hoster- und Sprachwechsel.
     */
    private String sitzung = "";
    /** Die Folge, fuer die die aktuelle Sitzung gilt - daran wird sie erneuert. */
    private String sitzungFuer = "";

    /** Wann zuletzt ein Stand hinausging. Der Horcher meldet oefter, als noetig waere. */
    private long letzteStandMeldung;
    /**
     * Die Folge, die zuletzt als eigener Wechsel gemeldet wurde.
     *
     * <p>Damit ein Neuladen derselben Folge - und davon gibt es viele: der
     * Hoster wechselt, die Sprache wechselt, die Seite laedt neu - nicht als
     * Folgenwechsel durch die Runde geht.
     */
    private String gemeldeteFolge = "";
    /**
     * Ob dieses Geraet gerade einem Wechsel der Runde folgt.
     *
     * <p>Ohne diese Sperre meldete der Nachzuegler den Wechsel zurueck, den er
     * gerade erst befolgt hat - dieselbe Schleife wie bei Play und Pause, nur
     * eine Ebene hoeher. Das Relay faengt den Fall zwar ab ("schonDort"), aber
     * eine Nachricht, die gar nicht erst hinausgeht, ist die bessere Antwort.
     */
    private boolean folgtDerRunde;
    /**
     * Ob dieses Geraet gerade wirklich vor dem Video sitzt.
     *
     * <p>Geht die App in den Hintergrund, haelt Android den WebView an - und
     * ein angehaltener Player meldet eine Pause. Ohne diesen Schalter ginge
     * sie als Tat an die Runde, und alle anderen stuenden still, weil jemand
     * kurz auf eine Nachricht geschaut hat. Gemeldet wird deshalb nur, was im
     * Vordergrund geschieht; abgemeldet wird trotzdem, damit dieses Geraet
     * nicht Host einer Folge bleibt, die es nicht mehr zeigt.
     */
    private boolean imVordergrund = true;
    /** Wie oft ein Stand hoechstens gemeldet wird. Dieselbe Sekunde wie am Rechner. */
    private static final long STAND_ABSTAND_MS = 1000;

    public Mitschauen(Kern kern, Rahmen rahmen, Watchparty watchparty, Umgebung umgebung) {
        this.kern = kern;
        this.rahmen = rahmen;
        this.watchparty = watchparty;
        this.umgebung = umgebung;
    }

    /** Skript und Meldetexte einmalig aus dem Kern holen. */
    public void vorbereiten() {
        if (kern == null) return;
        kern.wennBereit(() -> {
            kern.rufe("watchparty-bruecke.beobachterSkript", (wert, fehler) -> {
                if (fehler != null || wert == null) {
                    Log.e(TAG, "Watchparty-Horcher nicht erhalten: " + fehler);
                    return;
                }
                beobachterSkript = textAus(wert);
            });
            praefix("watchparty-bruecke.MELDE_AKTION", wert -> meldeAktion = wert);
            praefix("watchparty-bruecke.MELDE_STAND", wert -> meldeStand = wert);
            praefix("watchparty-bruecke.MELDE_SYNC", wert -> meldeSync = wert);
        });
    }

    private void praefix(String pfad, java.util.function.Consumer<String> nimm) {
        kern.rufe(pfad, (wert, fehler) -> {
            String text = textAus(wert);
            if (fehler == null && !text.isEmpty()) nimm.accept(text);
        });
    }

    /* ------------------------------------------------------ In den Player */

    /**
     * Den Horcher in alle Rahmen mit Video einsetzen.
     *
     * <p>Wird bei jeder Rahmenmeldung gerufen, nicht nur beim Seitenende. Das
     * ist der Unterschied, an dem der Folgenwechsel haengt: das Seitenende
     * kommt einmal je Dokument, ein neuer Player aber auch mitten in einem
     * Dokument - beim Hosterwechsel, beim Sprachwechsel, beim Nachladen des
     * Rahmens.
     *
     * <p>Mehrfaches Einsetzen kostet nichts: das Skript traegt seinen eigenen
     * Merker und antwortet dann mit "schon-da".
     */
    public void anPlayer(WebView ansicht) {
        if (ansicht == null || rahmen == null || beobachterSkript.isEmpty()) return;
        if (watchparty == null || !watchparty.istEingeschaltet()) return;
        int erreicht = rahmen.anSpieler(ansicht, beobachterSkript);
        if (erreicht > 0) Log.d(TAG, "Watchparty-Horcher in " + erreicht + " Rahmen");
    }

    /**
     * Ein neuer Player, ein neuer Anfang.
     *
     * <p>Beim Folgenwechsel und beim Hosterwechsel: die bestaetigten
     * Driftmessungen, die Ruhezeit und die Buchfuehrung ueber die zuletzt
     * angewendete laufende Nummer gehoeren zur Folge davor. Bliebe die Nummer
     * stehen, wiese der Player die ersten Befehle der neuen Folge als
     * Nachzuegler ab - und dann waere Play/Pause nach einem Folgenwechsel
     * wieder tot.
     */
    public void zuruecksetzen(WebView ansicht) {
        if (kern == null || !kern.istBereit()) return;
        String key = schluessel();
        kern.rufe("watchparty-bruecke.zuruecksetzen", Kern.args(key, raum()), (wert, fehler) -> {
            String skript = textAus(wert);
            if (fehler != null || skript.isEmpty() || ansicht == null || rahmen == null) return;
            rahmen.anSpieler(ansicht, skript);
        });
        // Ein neuer Player ist eine neue Sitzung: das Relay unterscheidet daran,
        // ob hier wirklich jemand am Video sitzt.
        sitzung = "";
        sitzungFuer = "";
    }

    /* ------------------------------------------------- Aus dem Player heraus */

    /** Ob eine Konsolenzeile uns gilt. */
    public boolean istMeldung(String zeile) {
        return zeile != null && zeile.startsWith(meldeAktion);
    }

    /**
     * Eine Meldung des Horchers.
     *
     * <p>Drei Arten, und nur zwei davon gehen hinaus: eine Tat (Play, Pause,
     * Sprung) und ein Stand (wo dieses Geraet steht). Die dritte ist der
     * Bericht der Driftmessung und gehoert ins Protokoll, nicht ins Netz.
     */
    public void meldung(String zeile) {
        if (!istMeldung(zeile) || kern == null || !kern.istBereit()) return;
        if (watchparty == null || !watchparty.istEingeschaltet()) return;
        if (!imVordergrund) return;

        if (zeile.startsWith(meldeSync)) {
            // Nur im Debug-Bau und nur eine Zeile: die Messung laeuft im
            // Zwei-Sekunden-Takt, und das Skript meldet ohnehin nur, wenn
            // etwas geschieht oder zehn Sekunden vergangen sind.
            Log.d(TAG, "Watchparty-Sync " + zeile.substring(meldeSync.length()));
            return;
        }

        String key = schluessel();
        String raum = raum();
        if (key.isEmpty() || raum.isEmpty()) return;

        if (zeile.startsWith(meldeStand)) {
            long jetzt = android.os.SystemClock.uptimeMillis();
            // Der Horcher meldet bei jedem timeupdate - viermal je Sekunde.
            // Sofortmeldungen (Pause, Play, Sprung, Puffern) kommen ueber die
            // Tat und sind davon nicht betroffen.
            if (jetzt - letzteStandMeldung < STAND_ABSTAND_MS) return;
            letzteStandMeldung = jetzt;
            kern.rufe("watchparty-bruecke.meldungStand",
                Kern.args(zeile, key, standRumpf(), raum), (wert, fehler) -> {
                    if (fehler != null) Log.d(TAG, "Stand nicht gemeldet: " + fehler);
                });
            return;
        }

        // Eine Tat. Sie geht sofort hinaus - hier zaehlt jede Zehntelsekunde.
        letzteStandMeldung = 0;
        kern.rufe("watchparty-bruecke.meldungSenden",
            Kern.args(zeile, key, umgebung.adresse(), raum), (wert, fehler) -> {
                if (fehler != null) Log.d(TAG, "Steuerbefehl nicht gesendet: " + fehler);
                else if (wert != null && !"null".equals(wert)) Log.i(TAG, "Watchparty gesendet: " + wert);
            });
    }

    /**
     * Der Rumpf einer Standmeldung.
     *
     * <p>Position und Pausenzustand traegt die Zeile des Horchers bei; was hier
     * dazukommt, ist alles, woran das Relay erkennt, <em>wo</em> dieses Geraet
     * steht - und die Sitzung, ohne die es nicht als aktiv zaehlt und damit nie
     * Host wird.
     */
    private JSONObject standRumpf() {
        JSONObject rumpf = new JSONObject();
        String adresse = umgebung.adresse();
        try {
            rumpf.put("url", adresse == null ? "" : adresse);
            int[] folge = folgeAus(adresse);
            rumpf.put("season", folge[0]);
            rumpf.put("episode", folge[1]);
            rumpf.put("playerSessionId", sitzungFuer(adresse));
        } catch (Exception fehler) {
            Log.e(TAG, "Standrumpf nicht gebaut", fehler);
        }
        return rumpf;
    }

    /**
     * Die Sitzung dieses Players.
     *
     * <p>Neu bei jeder Folge - und damit auch nach einem Hoster- oder
     * Sprachwechsel, denn {@link #zuruecksetzen} loescht sie. Das Relay laesst
     * einen Teilnehmer nur als aktiv gelten, solange er eine Sitzung meldet;
     * daran haengt, wer Host ist und wer aus der Hostfolge herausfaellt.
     */
    private String sitzungFuer(String adresse) {
        String marke = adresse == null ? "" : adresse;
        if (sitzung.isEmpty() || !marke.equals(sitzungFuer)) {
            sitzung = java.util.UUID.randomUUID().toString();
            sitzungFuer = marke;
        }
        return sitzung;
    }

    /**
     * Diese Folge ist hier nicht mehr offen.
     *
     * <p>Sofort abmelden statt still zu werden: sonst steht dieses Geraet bei
     * den anderen noch als aktiv, bis der Herzschlag ablaeuft - und bleibt
     * solange Host einer Folge, die es gar nicht mehr schaut. Genau der
     * Zustand, den niemand sehen will.
     */
    public void abmelden() {
        if (kern == null || !kern.istBereit()) return;
        String key = schluessel();
        String raum = raum();
        if (key.isEmpty() || raum.isEmpty()) return;
        kern.rufe("watchparty-bruecke.verlasseStand", Kern.args(key, raum), (wert, fehler) -> {
            if (fehler != null) Log.d(TAG, "Abmeldung ging nicht: " + fehler);
        });
        sitzung = "";
        sitzungFuer = "";
        letzteStandMeldung = 0;
        gemeldeteFolge = "";
    }

    /**
     * Die App tritt in den Hintergrund oder kommt zurueck.
     *
     * <p>Im Hintergrund geht keine Tat mehr hinaus - ein von Android
     * angehaltener Player ist keine Entscheidung des Zuschauers. Abgemeldet
     * wird trotzdem: sonst bliebe dieses Geraet Host einer Folge, vor der
     * niemand mehr sitzt.
     */
    public void vordergrund(boolean an) {
        if (imVordergrund == an) return;
        imVordergrund = an;
        if (!an) {
            abmelden();
            return;
        }
        // Zurueck: sofort wieder melden, damit die Runde weiss, dass hier
        // wieder jemand ist. Die naechste Meldung des Horchers geht dann
        // ungebremst durch.
        letzteStandMeldung = 0;
    }

    /**
     * Ein Folgenwechsel dieses Geraets.
     *
     * <p>Wird gerufen, wenn ELFIX selbst auf eine andere Folge geht - der
     * Knopf "naechste Folge", ein Eintrag aus Weiterschauen, ein Klick in der
     * Folgenliste. Die anderen ziehen nach.
     */
    public void folgenwechselMelden(String url) {
        if (kern == null || !kern.istBereit() || url == null || url.isEmpty()) return;
        if (watchparty == null || !watchparty.istEingeschaltet()) return;
        if (folgtDerRunde) return;
        String key = schluesselFuer(url);
        String raum = raum();
        if (key.isEmpty() || raum.isEmpty()) return;
        kern.rufe("watchparty-bruecke.folgenwechselMelden", Kern.args(key, url, raum),
            (wert, fehler) -> {
                if (fehler != null) Log.d(TAG, "Folgenwechsel nicht gemeldet: " + fehler);
            });
    }

    /**
     * Die Leitung ist wieder offen.
     *
     * <p>Ein kurzer Verbindungsverlust darf die Runde nicht kosten. Der
     * Raumzustand kommt vom Relay von selbst, sobald der Beitritt wieder
     * steht - er traegt Mitglieder, Host und die laufende Folge. Was er nicht
     * traegt, ist die Stelle, an der die Runde gerade steht; die kommt auf
     * Anfrage.
     *
     * <p>Deshalb hier zweierlei und nicht mehr: einmal den eigenen Stand
     * melden, damit dieses Geraet in der Hostfolge wieder mitzaehlt, und
     * einmal abgleichen. Keine Endlosschleife, kein Nachregeln - das
     * uebernimmt danach wieder die Driftmessung, die fast immer nichts tut.
     *
     * <p>Etwas Vorlauf, weil der Beitritt selbst erst hinausgeht, wenn die
     * Leitung offen ist: ein Abgleich in derselben Zehntelsekunde traefe auf
     * einen Raum, in dem dieses Geraet noch nicht steht.
     */
    public void nachWiederanschluss(String json) {
        boolean offen = json == null || !json.contains("false");
        if (!offen) return;
        haupt.postDelayed(() -> {
            if (!laeuftMit()) return;
            // Der eigene Stand zuerst: ohne ihn gilt dieses Geraet dem Relay
            // als nicht aktiv und faellt aus der Hostfolge heraus.
            letzteStandMeldung = 0;
            WebView ansicht = umgebung.spieler();
            if (ansicht != null) anPlayer(ansicht);
            abgleichen();
        }, 1200);
    }

    /** Den Stand der Runde anfordern - beim Beitreten und nach einem Wiederanschluss. */
    public void abgleichen() {
        if (kern == null || !kern.istBereit()) return;
        String key = schluessel();
        String raum = raum();
        if (key.isEmpty() || raum.isEmpty()) return;
        kern.rufe("watchparty-bruecke.abgleichen", Kern.args(key, raum), (wert, fehler) -> {
            if (fehler != null) Log.d(TAG, "Abgleich nicht angefordert: " + fehler);
        });
    }

    /**
     * Die Seite steht.
     *
     * <p>Der eine Einstieg fuer alles, was nach einem Seitenwechsel zu tun ist -
     * und damit die Antwort auf "was passiert nach einem Folgenwechsel?". Statt
     * an jeder der sechs Stellen, an denen ELFIX eine Folge oeffnen kann, an die
     * Watchparty zu denken, denkt sie hier einmal fuer alle.
     *
     * <ol>
     *   <li>Der Horcher kommt in den Player - er ist das Einzige, was Pause und
     *       Weiter ueberhaupt bemerkt.
     *   <li>Ist es eine andere Folge als zuletzt, erfaehrt die Runde davon -
     *       ausser dieses Geraet folgt gerade selbst einem Wechsel.
     *   <li>Und der Stand der Runde wird angefordert. Das ist die
     *       Beitrittssynchronisation: wer neu dazukommt oder eine Folge weiter
     *       geht, bekommt Stelle und Laufzustand des Hosts, statt bei null
     *       anzufangen.
     * </ol>
     */
    public void seiteFertig(WebView ansicht, String url) {
        if (watchparty == null || !watchparty.istEingeschaltet()) return;
        anPlayer(ansicht);
        if (url == null || url.isEmpty() || !laeuftMit()) return;

        int[] folge = folgeAus(url);
        // Ohne Folgenangabe ist es keine Folgenseite - ein Film oder eine
        // Uebersicht. Dann gibt es nichts zu melden und nichts abzugleichen.
        if (folge[1] <= 0) return;
        String marke = serienTeil(url) + "#s" + folge[0] + "e" + folge[1];

        if (!marke.equals(gemeldeteFolge)) {
            String vorher = gemeldeteFolge;
            gemeldeteFolge = marke;
            // Beim allerersten Mal ist es kein Wechsel, sondern ein Anfang -
            // die Runde erfaehrt ihn ueber den Stand, nicht ueber ein navigate.
            if (!vorher.isEmpty()) folgenwechselMelden(url);
        }
        // Der Wechsel ist vollzogen; ab jetzt zaehlt ein eigener wieder.
        folgtDerRunde = false;
        // Etwas Vorlauf: der Stand geht erst hinaus, wenn der Player steht,
        // und ein Abgleich davor traefe auf ein Geraet ohne Sitzung.
        haupt.postDelayed(this::abgleichen, 1500);
    }

    /* --------------------------------------------------- Herein: die Befehle */

    /**
     * Ein Steuerbefehl aus der Runde.
     *
     * <p>Beurteilt wird er im Kern - dort liegt die Buchfuehrung ueber die
     * zuletzt angewendete Nummer, und dort steht die Regel, die auch der
     * Rechner befragt. Was hier geschieht, ist die Ausfuehrung.
     */
    public void steuerung(String json) {
        if (kern == null || !kern.istBereit() || json == null) return;
        JSONObject nachricht;
        try {
            nachricht = new JSONObject(json);
        } catch (Exception fehler) {
            Log.e(TAG, "Steuerbefehl unlesbar", fehler);
            return;
        }
        WebView ansicht = umgebung.spieler();
        String adresse = umgebung.adresse();
        String key = nachricht.optString("key", "");
        if (key.isEmpty()) return;

        JSONObject lage = new JSONObject();
        int[] folge = folgeAus(adresse);
        try {
            lage.put("binHost", binHost(key));
            lage.put("hostId", hostId(key));
            // Ob ueberhaupt dieselbe Folge offen steht. Die Adresse des
            // Absenders zaehlt; steht keine dabei, die der Runde.
            lage.put("gleicheAdresse", gleicheFolge(
                ersteAdresse(nachricht.optString("url", ""), key), adresse));
            lage.put("season", folge[0]);
            lage.put("episode", folge[1]);
        } catch (Exception fehler) {
            Log.e(TAG, "Lage nicht gebaut", fehler);
            return;
        }

        kern.rufe("watchparty-bruecke.steuerungPruefen", Kern.args(nachricht, lage),
            (wert, fehler) -> {
                if (fehler != null || wert == null) {
                    Log.d(TAG, "Steuerbefehl nicht beurteilt: " + fehler);
                    return;
                }
                JSONObject urteil;
                try {
                    urteil = new JSONObject(wert);
                } catch (Exception ausnahme) {
                    Log.e(TAG, "Urteil unlesbar", ausnahme);
                    return;
                }
                ausfuehren(ansicht, nachricht, urteil);
            });
    }

    private void ausfuehren(WebView ansicht, JSONObject nachricht, JSONObject urteil) {
        String tun = urteil.optString("tun", "nichts");
        if ("nichts".equals(tun)) {
            Log.d(TAG, "Watchparty-Befehl verworfen: " + urteil.optString("grund", ""));
            return;
        }
        if ("navigate".equals(tun)) {
            String ziel = urteil.optString("url", "");
            if (ziel.isEmpty() || umgebung.anbieter() == null) return;
            // Steht die Folge schon, ist nichts zu tun - sonst laedt jeder
            // Nachzuegler die Seite ein zweites Mal neu.
            if (gleicheFolge(ziel, umgebung.adresse())) return;
            Log.i(TAG, "Watchparty folgt der Runde auf eine andere Folge");
            // Der Zustand der alten Folge gehoert weg, bevor die neue steht.
            zuruecksetzen(ansicht);
            // Und der eigene Wechsel wird nicht zurueckgemeldet: er ist keine
            // Entscheidung dieses Geraets, sondern deren Befolgung.
            folgtDerRunde = true;
            gemeldeteFolge = serienTeil(ziel) + "#s" + folgeAus(ziel)[0] + "e" + folgeAus(ziel)[1];
            haupt.post(() -> umgebung.folgeOeffnen(umgebung.anbieter(), ziel));
            return;
        }
        String skript = urteil.optString("skript", "");
        if (skript.isEmpty() || ansicht == null || rahmen == null) return;
        int erreicht = rahmen.anSpieler(ansicht, skript);
        Log.i(TAG, "Watchparty " + tun + " (" + urteil.optString("grund", "")
            + ") in " + erreicht + " Rahmen");
        // Beim gemeinsamen Gleichziehen wartet die Runde auf die Bereitmeldung.
        // Auch wer die Folge gerade nicht offen hat, meldet sich - sonst warten
        // die anderen unnoetig bis zum Zeitlimit.
        if ("syncprepare".equals(tun)) {
            String key = nachricht.optString("key", "");
            String raum = nachricht.optString("room", raum());
            if (!key.isEmpty()) {
                kern.rufe("watchparty-bruecke.bereitZumStart", Kern.args(key, raum),
                    (wert, fehler) -> { });
            }
        }
        umgebung.anzeigeAuffrischen();
    }

    /* ------------------------------------------------------------- Hilfen */

    /** Der Titel, unter dem die offene Seite in der Runde bekannt ist. */
    private String schluessel() {
        return schluesselFuer(umgebung.adresse());
    }

    private String schluesselFuer(String url) {
        if (url == null || url.isEmpty()) return "";
        return url.replaceAll("(?i)/(staffel|season)-\\d+(/(episode|folge)-\\d+)?/?$", "")
            .replaceAll("/+$", "")
            .toLowerCase();
    }

    /** In welchem Raum diese Seite mitlaeuft - "" heisst: in keinem. */
    private String raum() {
        if (watchparty == null) return "";
        String key = schluessel();
        if (key.isEmpty()) return "";
        JSONArray eintraege = watchparty.eintraege();
        for (int i = 0; i < eintraege.length(); i += 1) {
            JSONObject eintrag = eintraege.optJSONObject(i);
            if (eintrag == null) continue;
            if (!key.equals(eintrag.optString("key", ""))) continue;
            if (!eintrag.optBoolean("joined", false)) continue;
            return eintrag.optString("room", "");
        }
        return "";
    }

    private JSONObject eintragZu(String key) {
        if (watchparty == null || key == null || key.isEmpty()) return null;
        JSONArray eintraege = watchparty.eintraege();
        for (int i = 0; i < eintraege.length(); i += 1) {
            JSONObject eintrag = eintraege.optJSONObject(i);
            if (eintrag != null && key.equals(eintrag.optString("key", ""))) return eintrag;
        }
        return null;
    }

    /**
     * Bin ich der Host dieser Folge?
     *
     * <p>Gefragt wird nicht selbst, sondern nachgesehen: der Host steht im
     * Raumzustand, und den bestimmt das Relay. Eine eigene Regel hier waere
     * eine zweite - und zwei Regeln kommen irgendwann zu zwei Antworten.
     */
    public boolean binHost(String key) {
        JSONObject eintrag = eintragZu(key);
        if (eintrag == null) return false;
        String host = eintrag.optString("hostId", "");
        return !host.isEmpty() && host.equals(eintrag.optString("myId", ""));
    }

    public String hostId(String key) {
        JSONObject eintrag = eintragZu(key);
        return eintrag == null ? "" : eintrag.optString("hostId", "");
    }

    /** Wer die Runde gerade fuehrt - fuer die Anzeige. */
    public String hostName() {
        JSONObject eintrag = eintragZu(schluessel());
        return eintrag == null ? "" : eintrag.optString("hostName", "");
    }

    /** Ob die offene Seite ueberhaupt in einer Runde mitlaeuft. */
    public boolean laeuftMit() {
        return !raum().isEmpty();
    }

    /**
     * Die Adresse, an der eine Nachricht gemessen wird.
     *
     * <p>Die des Absenders zuerst - sie folgt der aktuellen Folge. Erst danach
     * die der Runde. Der gebuchte Fortschritt zaehlt hier bewusst nicht: er ist
     * die aelteste Angabe von allen und zeigt nach einem Folgenwechsel noch
     * minutenlang auf die Folge davor.
     */
    private String ersteAdresse(String ausNachricht, String key) {
        if (ausNachricht != null && !ausNachricht.isEmpty()) return ausNachricht;
        JSONObject eintrag = eintragZu(key);
        if (eintrag == null) return "";
        JSONObject live = eintrag.optJSONObject("live");
        String ausLive = live == null ? "" : live.optString("url", "");
        return ausLive.isEmpty() ? eintrag.optString("url", "") : ausLive;
    }

    /**
     * Dieselbe Folge?
     *
     * <p>Ueber Serienschluessel, Staffel und Folge - nicht ueber die Adresse
     * Zeichen fuer Zeichen: dieselbe Folge hat auf zwei Geraeten leicht
     * verschiedene Adressen, sobald ein Hoster oder eine Sprache dranhaengt.
     */
    static boolean gleicheFolge(String links, String rechts) {
        if (links == null || rechts == null || links.isEmpty() || rechts.isEmpty()) return false;
        int[] a = folgeAus(links);
        int[] b = folgeAus(rechts);
        if (a[1] != b[1] || a[0] != b[0]) return false;
        return serienTeil(links).equals(serienTeil(rechts));
    }

    /** Staffel und Folge aus einer Adresse: {@code [staffel, folge]}, 0 wenn keine. */
    static int[] folgeAus(String url) {
        int[] werte = new int[]{0, 0};
        if (url == null) return werte;
        java.util.regex.Matcher staffel = java.util.regex.Pattern
            .compile("(?i)/(?:staffel|season)-(\\d+)").matcher(url);
        if (staffel.find()) werte[0] = zahl(staffel.group(1));
        java.util.regex.Matcher folge = java.util.regex.Pattern
            .compile("(?i)/(?:episode|folge)-(\\d+)").matcher(url);
        if (folge.find()) werte[1] = zahl(folge.group(1));
        return werte;
    }

    /** Wirt und Titelteil ohne Staffel, Folge, Abfrage und Fragment. */
    static String serienTeil(String url) {
        String wert = url == null ? "" : url.toLowerCase();
        int frage = wert.indexOf('?');
        if (frage >= 0) wert = wert.substring(0, frage);
        int raute = wert.indexOf('#');
        if (raute >= 0) wert = wert.substring(0, raute);
        return wert
            .replaceAll("(?i)/(?:staffel|season)-\\d+.*$", "")
            .replaceAll("(?i)/(?:episode|folge)-\\d+.*$", "")
            .replaceAll("^https?://", "")
            .replaceAll("^www\\.", "")
            .replaceAll("/+$", "");
    }

    private static int zahl(String wert) {
        try {
            return Integer.parseInt(wert);
        } catch (Exception keineZahl) {
            return 0;
        }
    }

    private static String textAus(String jsonWert) {
        String text = jsonWert == null ? "" : jsonWert.trim();
        if ("null".equals(text) || text.isEmpty()) return "";
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
