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

        /**
         * Auf diese Adresse wechseln, weil die Runde es tut.
         *
         * <p>Der Aufrufer muss dabei den Autostart scharfmachen. Genau das
         * fehlte: die Seite ging auf, und danach stand der Fernseher auf einer
         * Folgenuebersicht ohne Player, waehrend die anderen weiterschauten.
         * Am Rechner ist der Player nach einem Wechsel selbstverstaendlich da -
         * dort laeuft {@code scheduleProviderAutoplay} mit.
         */
        void folgeOeffnen(Provider anbieter, String url);

        /** Der Zustand hat sich geaendert - die Anzeige darf nachziehen. */
        void anzeigeAuffrischen();

        /**
         * Ein kurzer Hinweis an den Zuschauer.
         *
         * <p>Gebraucht wird er genau einmal: wenn der Autostart endgueltig
         * aufgegeben hat. Ein Fehlschlag, der nur im Protokoll steht, sieht von
         * vorne aus wie ein Bild, das eben nicht laeuft - und dann drueckt
         * niemand die eine Taste, die noch helfen wuerde.
         */
        void hinweisZeigen(String text);
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

    /**
     * Wo schon einmal nach dem Stand der Runde gefragt wurde.
     *
     * <p>Je Raum, Titel und Folge genau einmal - derselbe Merker wie
     * {@code watchpartyAngeklinkt} am Rechner. Er ist der Grund, warum der
     * Einstieg jetzt wirklich sitzt: gefragt wird nicht mehr anderthalb
     * Sekunden nach dem Seitenende, sondern in dem Augenblick, in dem sich
     * zum ersten Mal ein Rahmen <em>mit Video</em> meldet.
     *
     * <p>Der Unterschied ist alles. Beim Seitenende gibt es auf dem Telefon
     * noch keinen Player: der Hoster wird erst danach angeklickt, und das
     * dauert Sekunden. Die Antwort der Runde traf also auf ein Dokument ohne
     * Videoelement, das Skript meldete "kein-video", und der Gast startete bei
     * 0:00, waehrend die anderen bei 0:12 standen.
     */
    private final java.util.Set<String> angeklinkt = new java.util.HashSet<>();

    /**
     * Wo das Live-Schauen abgeschaltet ist - je Raum und Titel.
     *
     * <p>Dasselbe wie {@code watchpartyLiveAus} am Rechner, und der Grund,
     * warum "Live verlassen" dort nichts kaputtmacht: es beendet die Teilnahme
     * an dieser Folge und sonst gar nichts. Der Titel bleibt im Raum, die
     * Mitgliedschaft bleibt bestehen, der eigene Fortschritt bleibt stehen -
     * er zaehlt nur wieder allein fuer dieses Geraet.
     *
     * <p>Der Merker haengt am Raum, damit man in einer Runde live sein kann und
     * in der anderen nicht - auch beim selben Anime.
     */
    private final java.util.Set<String> liveAus = new java.util.HashSet<>();

    /* ------------------------------------------------- Der Folgen-Autostart */

    /**
     * Woran ein Bericht des Startskripts zu erkennen ist.
     *
     * <p>Wie die drei Meldetexte darueber aus dem Kern geholt - der Wortlaut
     * gehoert dem geteilten Modul, nicht dieser Klasse.
     */
    private String meldeStart = "__elfix:wp:start:";
    /** Ob gerade ein Auftrag laeuft. Nur dann klopft der Takt an. */
    private boolean autostartLaeuft;
    /** Der Takt, der den Auftrag vorantreibt. Er haelt an, sobald der Auftrag fertig ist. */
    private final Runnable autostartTakt = this::autostartWeiter;
    /** Wie oft nachgesehen wird, ob der Auftrag weiterkommt. */
    private static final long AUTOSTART_TAKT_MS = 1200;

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
            praefix("watchparty-bruecke.MELDE_START", wert -> meldeStart = wert);
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
        if (erreicht <= 0) return;
        Log.d(TAG, "Watchparty-Horcher in " + erreicht + " Rahmen");
        einklinken();
    }

    /**
     * Beim ersten Player dieser Folge den Stand der Runde anfordern.
     *
     * <p>Dasselbe wie {@code installWatchpartyControls} am Rechner, und der
     * Kern des Einstiegs: wer neu dazukommt oder gerade der Runde auf eine
     * andere Folge gefolgt ist, bekommt vom Relay Stelle <em>und</em>
     * Laufzustand des Hosts. Daraus rechnet das Skript im Player die Zielzeit
     * selbst aus - zum Zeitpunkt der Anwendung, nicht zum Zeitpunkt des
     * Empfangs. Genau das ist der smarte Start: die acht Sekunden Ladezeit
     * stehen in der Rechnung drin.
     *
     * <p>Einmal je Raum, Titel und Folge. Ein Hosterwechsel innerhalb
     * derselben Folge fragt nicht noch einmal - sonst spraenge der Player bei
     * jedem Rahmenwechsel neu.
     */
    private void einklinken() {
        String key = schluessel();
        String raum = raum();
        if (key.isEmpty() || raum.isEmpty()) return;
        int[] folge = folgeAus(umgebung.adresse());
        String marke = raum + "|" + key + "|s" + folge[0] + "e" + folge[1];
        if (!angeklinkt.add(marke)) return;
        Log.i(TAG, "Watchparty klinkt sich bei der Runde ein (Staffel " + folge[0]
            + " Folge " + folge[1] + ")");
        // Der eigene Stand zuerst - ohne ihn gilt dieses Geraet dem Relay als
        // nicht aktiv, und die Antwort auf den Abgleich bliebe aus.
        letzteStandMeldung = 0;
        abgleichen();
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
        // Und eine neue Folge ist ein neuer Einstieg. Bliebe der Merker
        // stehen, fragte niemand mehr nach dem Stand der Runde, und der Gast
        // finge auf der neuen Folge bei null an.
        angeklinkt.clear();
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

        // Der Bericht eines Autostart-Versuchs. Er geht nicht an die Runde
        // hinaus - er sagt diesem Geraet, ob sein eigener Start gelungen ist.
        // Er kommt vor allem anderen, weil er sonst als Tat gelesen wuerde.
        if (zeile.startsWith(meldeStart)) {
            autostartBericht(zeile);
            return;
        }
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

        // Waehrend ein Autostart laeuft, geht keine eigene Tat hinaus.
        //
        // In diesen paar Sekunden wird der Player angefasst: die Ueberlagerung
        // des Hosters wird geklickt, die Quelle laedt, es wird gesprungen und
        // gestartet. Was er dabei von sich aus meldet, ist eine Nebenwirkung
        // und keine Entscheidung eines Zuschauers. Gemessen am 25.08.2026 auf
        // dem Telefon: der Player meldete mitten im Anlauf ein "pause" bei
        // 31,4 s; das ging als eigene Tat an die Runde, und weil dieses Geraet
        // gerade Host war, stand danach die ganze Runde - der Autostart kam
        // ordentlich an und pausiert.
        //
        // Was am Ende gilt, sagt der Bericht des Auftrags. Er kommt in
        // laengstens ein paar Sekunden, und bis dahin ist Stille die richtige
        // Antwort. Der eigene Stand geht weiter hinaus (siehe oben) - ohne ihn
        // zaehlte dieses Geraet dem Relay als nicht aktiv.
        if (autostartLaeuft) {
            Log.d(TAG, "Eigene Tat waehrend des Autostarts nicht gemeldet: " + zeile);
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
        // Wer zurueckkommt, klinkt sich neu ein - sonst stuende er bei der
        // Stelle von damals, waehrend die Runde weitergelaufen ist.
        angeklinkt.clear();
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
        // Wer selbst weiterblaettert, meint den Auftrag von vorhin nicht mehr -
        // es sei denn, er zeigt genau auf diese Folge. Aus der Watchparty-Seite
        // geoeffnet ist beides dasselbe Ereignis.
        autostartAbbrechen("eigener Folgenwechsel", url);
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
        // Der Stand der Runde wird hier nicht mehr angefordert - jedenfalls
        // nicht als Hauptweg.
        //
        // Das tat frueher ein Zeitgeber, anderthalb Sekunden nach dem
        // Seitenende. Auf dem Telefon gibt es zu diesem Zeitpunkt noch keinen
        // Player: der Hoster wird erst danach angeklickt, und das dauert
        // Sekunden. Die Antwort traf also auf ein Dokument ohne Videoelement,
        // lief ins Leere - und der Gast startete bei 0:00, waehrend die
        // anderen laengst weiter waren. Gefragt wird jetzt in
        // {@link #anPlayer}, sobald sich wirklich ein Rahmen mit Video meldet.
        //
        // Der Zeitgeber bleibt als Netz darunter: ein WebView ohne
        // Rahmenzugriff meldet nie einen Rahmen mit Video, und dort waere sonst
        // gar kein Einstieg mehr. Eine Anfrage zu viel kostet nichts - die
        // Antwort trifft dann auf kein Video und tut nichts.
        if (!Rahmen.verfuegbar()) haupt.postDelayed(this::abgleichen, 2500);
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
        // Das gemeinsame Gleichziehen richtet sich ausdruecklich auch an die,
        // bei denen die falsche Folge steht - sie sollen erst wechseln und dann
        // mitkommen. Waere die Folgenpruefung hier scharf, faenden sie sich als
        // "andere Folge" abgewiesen wieder und blieben zurueck, waehrend alle
        // anderen gemeinsam starten.
        //
        // Deshalb bleibt sie fuer diesen einen Fall aussen vor - genau wie am
        // Rechner, wo {@code applyWatchpartyControl} mit
        // {@code gleicheAdresse: true, offen: null} fragt und die Folge erst je
        // Ansicht prueft. Was hier wirklich offen steht, entscheidet danach
        // {@link #folgen}.
        boolean gleichziehen = "syncprepare".equals(nachricht.optString("action", ""));
        try {
            lage.put("binHost", binHost(key));
            lage.put("hostId", hostId(key));
            // Ob ueberhaupt dieselbe Folge offen steht. Die Adresse des
            // Absenders zaehlt; steht keine dabei, die der Runde.
            lage.put("gleicheAdresse", gleichziehen || gleicheFolge(
                ersteAdresse(nachricht.optString("url", ""), key), adresse));
            lage.put("season", gleichziehen ? 0 : folge[0]);
            lage.put("episode", gleichziehen ? 0 : folge[1]);
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
            folgen(ansicht, urteil.optString("url", ""));
            return;
        }
        // Beim gemeinsamen Gleichziehen kann die Runde inzwischen bei einer
        // anderen Folge stehen. Dann wird erst gewechselt - dieselbe
        // Reihenfolge wie in {@code prepareWatchpartySync} am Rechner. Ohne das
        // spraenge dieses Geraet auf eine Stelle der falschen Folge und meldete
        // sich dort als bereit.
        if ("syncprepare".equals(tun)) {
            String ziel = nachricht.optString("url", "");
            if (!ziel.isEmpty() && !gleicheFolge(ziel, umgebung.adresse())
                && folgen(ansicht, ziel)) {
                // Gewechselt: die Bereitmeldung geht trotzdem sofort hinaus,
                // sonst warten die anderen bis zum Zeitlimit auf ein Geraet,
                // das gerade eine Seite laedt.
                bereitMelden(nachricht);
                return;
            }
        }
        String skript = urteil.optString("skript", "");
        if (skript.isEmpty() || ansicht == null || rahmen == null) return;
        // Der Autostart geht in *jeden* gemeldeten Rahmen, nicht nur in die mit
        // Video. Das ist der Punkt: solange die Quelle hinter der Ueberlagerung
        // des Hosters liegt, traegt der Rahmen zwar ein <video>, aber ohne
        // Laufzeit - und ein Rahmen, der sich vor dem Klick noch gar nicht als
        // "mit Video" gemeldet hat, waere sonst nie erreichbar. Ein Werberahmen
        // bleibt trotzdem still: das Skript kehrt ohne jedes <video> sofort um.
        boolean istAutostart = "autostart".equals(tun);
        int erreicht = istAutostart
            ? rahmen.anAlle(ansicht, skript)
            : rahmen.anSpieler(ansicht, skript);
        Log.i(TAG, "Watchparty " + tun + " (" + urteil.optString("grund", "")
            + ") in " + erreicht + " Rahmen");
        if (istAutostart) return;
        // Beim gemeinsamen Gleichziehen wartet die Runde auf die Bereitmeldung.
        // Auch wer die Folge gerade nicht offen hat, meldet sich - sonst warten
        // die anderen unnoetig bis zum Zeitlimit.
        if ("syncprepare".equals(tun)) bereitMelden(nachricht);
        umgebung.anzeigeAuffrischen();
    }

    private void bereitMelden(JSONObject nachricht) {
        String key = nachricht.optString("key", "");
        if (key.isEmpty() || kern == null || !kern.istBereit()) return;
        String raum = nachricht.optString("room", raum());
        kern.rufe("watchparty-bruecke.bereitZumStart", Kern.args(key, raum), (wert, fehler) -> { });
    }

    /**
     * Der Runde auf eine andere Folge folgen.
     *
     * <p>Die drei Dinge, die dabei zusammengehoeren: den Zustand der alten
     * Folge verwerfen, den eigenen Wechsel nicht zurueckmelden (er ist keine
     * Entscheidung, sondern deren Befolgung) und die neue Folge oeffnen - samt
     * Autostart, sonst steht danach eine Folgenuebersicht ohne Player da.
     *
     * @return ob wirklich gewechselt wurde
     */
    private boolean folgen(WebView ansicht, String ziel) {
        if (ziel == null || ziel.isEmpty() || umgebung.anbieter() == null) return false;
        // Steht die Folge schon, ist nichts zu tun - sonst laedt jeder
        // Nachzuegler die Seite ein zweites Mal neu.
        if (gleicheFolge(ziel, umgebung.adresse())) return false;
        Log.i(TAG, "Watchparty folgt der Runde auf eine andere Folge");
        // Der Zustand der alten Folge gehoert weg, bevor die neue steht.
        zuruecksetzen(ansicht);
        folgtDerRunde = true;
        int[] neueFolge = folgeAus(ziel);
        gemeldeteFolge = serienTeil(ziel) + "#s" + neueFolge[0] + "e" + neueFolge[1];
        // Der Auftrag entsteht *vor* der Navigation. Er ueberlebt sie, weil er
        // im Kern liegt und nicht in dieser Ansicht - genau das war der Fehler
        // der alten Kette: `autoStartRequested` und `autoStartUrl` gehoerten
        // dem WebView und waren nach dem Wechsel weg.
        String neuerKey = schluesselFuer(ziel);
        JSONObject neuerEintrag = eintragZu(neuerKey);
        autostartAnfordern(neuerKey,
            neuerEintrag == null ? raum() : neuerEintrag.optString("room", raum()), ziel);
        haupt.post(() -> umgebung.folgeOeffnen(umgebung.anbieter(), ziel));
        return true;
    }

    /* ------------------------------------------------- Der Folgen-Autostart */

    /*
     * Warum es diesen Ablauf gibt und nicht einfach ein play().
     *
     * Gemessen am 25.08.2026 auf dem Telefon (AniWorld -> VOE): der Rahmen des
     * Hosters traegt nach dem Laden ein <video> *ohne Quelle* - duration=null,
     * readyState=0, src="". Erst der Klick auf seine eigene Ueberlagerung laedt
     * die Quelle; danach stand duration=1371, readyState=4, paused=false.
     * Autoplay ist auf diesem Geraet also nicht gesperrt, es fehlte der Klick.
     * Ein play() davor laeuft ins Leere - und weil das Versprechen von play()
     * frueher weggefangen wurde, sah dieser Fehlschlag von aussen aus wie ein
     * Erfolg.
     *
     * Der Auftrag liegt im Kern und nicht hier. Das ist Absicht: eine
     * Navigation raeumt diese Ansicht ab, und ein Auftrag, der die Navigation
     * nicht ueberlebt, kann danach nichts mehr starten. Genau daran ist die
     * alte Kette gescheitert - `autoStartRequested` und `autoStartUrl` gehoeren
     * dem WebView.
     */

    /**
     * Einen Autostart-Auftrag anlegen und den Takt anwerfen.
     *
     * <p>Gerufen genau dort, wo die Runde einen Folgenwechsel erzwingt. Die
     * laufende Nummer steigt dabei im Kern - ein aelterer Auftrag, der noch auf
     * einen langsamen Player wartet, ist damit erledigt und startet nicht mehr
     * die falsche Folge.
     */
    public void autostartAnfordern(String key, String raum, String ziel) {
        if (kern == null || !kern.istBereit()) return;
        if (key == null || key.isEmpty() || raum == null || raum.isEmpty()) return;
        if (ziel == null || ziel.isEmpty()) return;
        int[] folge = folgeAus(ziel);
        int season = folge[0];
        int episode = folge[1];
        JSONObject eintrag = eintragZu(key);
        JSONObject angaben = new JSONObject();
        try {
            angaben.put("key", key);
            angaben.put("room", raum);
            angaben.put("url", ziel);
            angaben.put("season", season);
            angaben.put("episode", episode);
            angaben.put("hostId", hostId(key));
            // Nur als Vorgabe. Unmittelbar vor dem Start wird der Stand des
            // Hosts ohnehin neu geholt - die Antwort des Relays traegt ihn.
            angaben.put("playing", eintrag == null || !eintrag.optBoolean("paused", false));
        } catch (Exception fehler) {
            Log.e(TAG, "Autostart-Auftrag nicht gebaut", fehler);
            return;
        }
        kern.rufe("watchparty-bruecke.autostartAnfordern", Kern.args(angaben), (wert, fehler) -> {
            if (fehler != null) {
                Log.w(TAG, "Autostart nicht angefordert: " + fehler);
                return;
            }
            Log.i(TAG, "Autostart angefordert " + wert);
            autostartLaeuft = true;
            haupt.removeCallbacks(autostartTakt);
            haupt.postDelayed(autostartTakt, AUTOSTART_TAKT_MS);
        });
    }

    /**
     * Ein Schlag des Takts.
     *
     * <p>Entschieden wird im Kern: {@code anfordern} heisst, den Stand der
     * Runde neu zu holen - seine Antwort traegt den frischen Hostzustand und
     * loest ueber {@link #steuerung} den naechsten Versuch aus. Genau das ist
     * "den Hostzustand unmittelbar vor dem Start erneut abrufen", und deshalb
     * steigt der Gast nach einer langen Ladezeit dort ein, wo der Host
     * inzwischen steht, und nicht dort, wo er beim Wechsel stand.
     *
     * <p>Kein fester Zeitgeber und keine Endlosschleife: wie viele Versuche es
     * gibt und wie weit sie auseinanderliegen, steht im geteilten Modul.
     */
    private void autostartWeiter() {
        if (!autostartLaeuft || kern == null || !kern.istBereit()) return;
        int[] folge = folgeAus(umgebung.adresse());
        JSONObject lage = new JSONObject();
        try {
            lage.put("key", schluessel());
            lage.put("room", raum());
            lage.put("season", folge[0]);
            lage.put("episode", folge[1]);
        } catch (Exception fehler) {
            Log.e(TAG, "Autostart-Lage nicht gebaut", fehler);
            return;
        }
        kern.rufe("watchparty-bruecke.autostartSchritt", Kern.args(lage), (wert, fehler) -> {
            if (fehler != null || wert == null) {
                Log.d(TAG, "Autostart-Schritt nicht beurteilt: " + fehler);
                autostartLaeuft = false;
                return;
            }
            JSONObject schritt;
            try {
                schritt = new JSONObject(wert);
            } catch (Exception ausnahme) {
                Log.e(TAG, "Autostart-Schritt unlesbar", ausnahme);
                autostartLaeuft = false;
                return;
            }
            String tun = schritt.optString("tun", "aufgeben");
            String grund = schritt.optString("grund", "");
            if ("aufgeben".equals(tun)) {
                autostartLaeuft = false;
                haupt.removeCallbacks(autostartTakt);
                boolean gelungen = "laeuft".equals(grund) || "pausiert".equals(grund);
                boolean gegenstandslos = grund.isEmpty() || "veraltet".equals(grund)
                    || "kein auftrag".equals(grund) || "fertig".equals(grund);
                if (gelungen || gegenstandslos) {
                    Log.i(TAG, "Autostart beendet: " + grund);
                    return;
                }
                // Ein Fehlschlag bleibt sichtbar. Still zu scheitern war der
                // alte Zustand - dann sass man vor einem stehenden Bild und
                // wusste nicht, woran es lag.
                Log.w(TAG, "Autostart aufgegeben: " + grund);
                umgebung.hinweisZeigen("Startet nicht von selbst - bitte einmal Play druecken");
                return;
            }
            if ("anfordern".equals(tun)) {
                Log.i(TAG, "Autostart " + grund + " - Stand der Runde wird geholt");
                // Der eigene Stand zuerst: ohne ihn gilt dieses Geraet dem
                // Relay als nicht aktiv, und die Antwort bliebe aus.
                letzteStandMeldung = 0;
                WebView ansicht = umgebung.spieler();
                if (ansicht != null) anPlayer(ansicht);
                abgleichen();
            }
            long warten = Math.max(AUTOSTART_TAKT_MS, schritt.optLong("wartenMs", 0));
            haupt.removeCallbacks(autostartTakt);
            haupt.postDelayed(autostartTakt, warten);
        });
    }

    /** Was ein Versuch berichtet hat. Gelingt er, ist der Auftrag zu Ende. */
    private void autostartBericht(String zeile) {
        if (kern == null || !kern.istBereit()) return;
        kern.rufe("watchparty-bruecke.autostartBericht", Kern.args(zeile), (wert, fehler) -> {
            if (fehler != null || wert == null || "null".equals(wert)) return;
            JSONObject bericht;
            try {
                bericht = new JSONObject(wert);
            } catch (Exception ausnahme) {
                return;
            }
            if (!bericht.optBoolean("passt", false)) {
                Log.d(TAG, "Autostart-Bericht eines anderen Auftrags verworfen");
                return;
            }
            String zustand = bericht.optString("zustand", "");
            if (bericht.optBoolean("fertig", false)) {
                Log.i(TAG, "Autostart fertig: " + zustand + " bei "
                    + Math.round(bericht.optDouble("stelle", 0)) + "s");
                autostartLaeuft = false;
                haupt.removeCallbacks(autostartTakt);
                umgebung.anzeigeAuffrischen();
                return;
            }
            Log.w(TAG, "Autostart-Versuch fehlgeschlagen: " + zustand
                + " (" + bericht.optString("grund", "") + ")");
            // Der naechste Versuch braucht keinen eigenen Zeitgeber - der Takt
            // laeuft weiter und sieht im Kern nach, ob der Abstand um ist.
            haupt.removeCallbacks(autostartTakt);
            haupt.postDelayed(autostartTakt, AUTOSTART_TAKT_MS);
        });
    }

    /**
     * Einen offenen Auftrag verwerfen.
     *
     * <p>Immer dann, wenn er nicht mehr gemeint sein kann: die Teilnahme endet,
     * die Watchparty geht aus, oder dieses Geraet wechselt die Folge selbst.
     */
    private void autostartAbbrechen(String grund) {
        autostartAbbrechen(grund, null);
    }

    /**
     * @param ziel wohin dieses Geraet gerade von sich aus geht, oder {@code null}
     *             fuer "gar nicht mehr". Zeigt der offene Auftrag genau dorthin,
     *             bleibt er stehen: er ist ja der Grund, warum die Seite aufgeht.
     */
    private void autostartAbbrechen(String grund, String ziel) {
        if (!autostartLaeuft || kern == null || !kern.istBereit()) return;
        JSONObject lage = new JSONObject();
        if (ziel != null && !ziel.isEmpty()) {
            int[] folge = folgeAus(ziel);
            String key = schluesselFuer(ziel);
            JSONObject eintrag = eintragZu(key);
            try {
                lage.put("key", key);
                lage.put("room", eintrag == null ? raum() : eintrag.optString("room", raum()));
                lage.put("season", folge[0]);
                lage.put("episode", folge[1]);
            } catch (Exception fehler) {
                Log.e(TAG, "Lage fuer das Verwerfen nicht gebaut", fehler);
            }
        }
        kern.rufe("watchparty-bruecke.autostartVerwerfen", Kern.args(lage), (wert, fehler) -> {
            if (wert != null && wert.contains("true")) {
                Log.i(TAG, "Autostart verworfen: " + grund);
                autostartLaeuft = false;
                haupt.removeCallbacks(autostartTakt);
            }
        });
    }

    /* --------------------------------------------------- Die Live-Aktionen */

    /*
     * Was der Rechner in seiner Leiste oben rechts anbietet und Android bisher
     * nirgends: mit dem Host gleichziehen, den Takt weitergeben, die Teilnahme
     * beenden. Entschieden wird nichts davon hier - das Relay prueft nach, ob
     * der Empfaenger einer Hostuebergabe wirklich bei derselben Folge sitzt,
     * und der gemeinsame Start ist ohnehin seine Sache.
     */

    /**
     * "Mit Host synchronisieren".
     *
     * <p>Dasselbe wie {@code resyncWatchparty} am Rechner: alle halten an,
     * springen auf die Stelle des Hosts, und erst wenn alle so weit sind, gibt
     * das Relay das Startsignal. Steht hier die falsche Folge, wird vorher
     * gewechselt - das entscheidet die eingehende Vorbereitung selbst
     * ({@code syncprepare} traegt die Adresse der Runde).
     *
     * @param stelle die eigene Stelle. Sie zaehlt nur, wenn vom Host noch gar
     *               nichts bekannt ist - sonst zoege ein Nachzuegler alle
     *               anderen zu sich zurueck.
     */
    public void gleichziehen(double stelle) {
        if (kern == null || !kern.istBereit()) return;
        String key = schluessel();
        String raum = raum();
        if (key.isEmpty() || raum.isEmpty()) return;
        kern.rufe("watchparty-bruecke.gleichziehen",
            Kern.args(key, Math.max(0, stelle), raum), (wert, fehler) -> {
                if (fehler != null) Log.d(TAG, "Gleichziehen ging nicht: " + fehler);
            });
    }

    /** Den Takt an ein anderes Geraet abgeben. Das Relay prueft nach. */
    public void hostUebergeben(String memberId, Kern.Antwort antwort) {
        String key = schluessel();
        String raum = raum();
        if (kern == null || !kern.istBereit() || key.isEmpty() || raum.isEmpty()
            || memberId == null || memberId.isEmpty()) {
            antwort.fertig(null, "Dazu läuft gerade keine Runde");
            return;
        }
        kern.rufe("watchparty-bruecke.hostUebergeben", Kern.args(key, memberId, raum), antwort);
    }

    /**
     * Die aktive Teilnahme an der offenen Folge beenden.
     *
     * <p>Ausdruecklich nur die Teilnahme. Der Titel bleibt im Raum, der Raum
     * bleibt eingerichtet, der eigene Fortschritt bleibt stehen - danach laeuft
     * dieses Geraet wieder privat weiter. Dieselbe Trennung wie beim
     * "Live verlassen" am Rechner.
     */
    public void liveVerlassen(Kern.Antwort antwort) {
        String key = schluessel();
        String raum = raumRoh();
        if (watchparty == null || key.isEmpty() || raum.isEmpty()) {
            antwort.fertig(null, "Diese Folge läuft in keiner Runde mit");
            return;
        }
        // Erst abmelden, damit die anderen es sofort sehen und dieses Geraet
        // nicht Host einer Folge bleibt, an der es nicht mehr teilnimmt.
        abmelden();
        // Wer die Teilnahme beendet, will auch nicht mehr automatisch starten.
        autostartAbbrechen("Live verlassen");
        liveAus.add(liveMarke(key, raum));
        // Und der eigene Eintrag zaehlt wieder fuer sich. Ausdruecklich nur
        // das: der Titel bleibt im Raum, die Mitgliedschaft bleibt bestehen,
        // der gemessene Fortschritt bleibt stehen. Dieselbe Trennung wie beim
        // "Live verlassen" am Rechner - dort heisst der Gegenknopf "Live
        // beitreten" und nicht "Erneut beitreten".
        watchparty.privatSetzen(key);
        antwort.fertig("", null);
    }

    /**
     * Dieser Folge wieder live folgen.
     *
     * <p>Der Gegenknopf. Die Mitgliedschaft war nie weg - es zaehlt ab jetzt
     * wieder fuer die Runde, und der Stand wird einmal angefordert, damit man
     * nicht dort einsteigt, wo man vor einer halben Stunde aufgehoert hat.
     */
    public void liveBeitreten(Kern.Antwort antwort) {
        String key = schluessel();
        String raum = raumRoh();
        if (watchparty == null || key.isEmpty() || raum.isEmpty()) {
            antwort.fertig(null, "Diese Folge läuft in keiner Runde mit");
            return;
        }
        liveAus.remove(liveMarke(key, raum));
        watchparty.raumBinden(key, raum);
        // Neu einklinken: sonst bliebe der Merker der letzten Teilnahme stehen
        // und niemand fragte nach dem Stand der Runde.
        angeklinkt.clear();
        letzteStandMeldung = 0;
        WebView ansicht = umgebung.spieler();
        if (ansicht != null) anPlayer(ansicht);
        else abgleichen();
        antwort.fertig(raum, null);
    }

    /** Ob die offene Folge ueberhaupt in einer Runde steht - auch mit Live aus. */
    public boolean stehtInRunde() {
        return !raumRoh().isEmpty();
    }

    /** Der Raum, in dem die offene Folge mitlaeuft - leer heisst: privat. */
    public String aktiverRaum() {
        return raum();
    }

    /** Der Raum, in dem sie steht - auch wenn gerade privat geschaut wird. */
    public String eingestellterRaum() {
        return raumRoh();
    }

    /** Der Titelschluessel der offenen Folge in der Runde. */
    public String aktiverSchluessel() {
        return schluessel();
    }

    /** Staffel und Folge, die hier gerade offen stehen. */
    public int[] offeneFolge() {
        return folgeAus(umgebung.adresse());
    }

    /* ------------------------------------------------------------- Hilfen */

    /** Der Titel, unter dem die offene Seite in der Runde bekannt ist. */
    private String schluessel() {
        return schluesselFuer(umgebung.adresse());
    }

    /**
     * Derselbe Schluessel, unter dem der Titel in der Runde gefuehrt wird.
     *
     * <p>Sichtbar fuer die Pruefung, weil daran mehr haengt als der Name
     * vermuten laesst: der Autostart-Auftrag traegt ihn, und traege er einen
     * anders gebildeten, spraenge der Auftrag auf einen anderen Eintrag im
     * selben Raum ueber - oder auf gar keinen.
     */
    static String schluesselFuer(String url) {
        if (url == null || url.isEmpty()) return "";
        return url.replaceAll("(?i)/(staffel|season)-\\d+(/(episode|folge)-\\d+)?/?$", "")
            .replaceAll("/+$", "")
            .toLowerCase();
    }

    /**
     * In welchem Raum diese Seite live mitlaeuft - "" heisst: in keinem.
     *
     * <p>"Live aus" zaehlt hier wie "nicht dabei": es geht nichts hinaus und es
     * kommt nichts an. Die Mitgliedschaft bleibt davon unberuehrt - siehe
     * {@link #liveAus}.
     */
    private String raum() {
        String roh = raumRoh();
        if (roh.isEmpty()) return "";
        return liveAus.contains(liveMarke(schluessel(), roh)) ? "" : roh;
    }

    /** In welchem Raum diese Seite steht - auch wenn das Live-Schauen aus ist. */
    private String raumRoh() {
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

    private static String liveMarke(String key, String raum) {
        return (raum == null ? "" : raum) + "|" + (key == null ? "" : key);
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
