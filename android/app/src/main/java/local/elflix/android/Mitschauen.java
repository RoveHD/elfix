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

        /**
         * Ob die Bedienelemente des Players gerade zu sehen sind.
         *
         * <p>Der Player meldet es selbst - JW Player, den VOE fuehrt, setzt am
         * Wurzelknoten eine Klasse, sobald er ausblendet. Daran haengt die
         * Teilnehmerleiste im Vollbild: sie kommt mit den Bedienelementen und
         * geht mit ihnen. Ein eigener Zeitgeber daneben waere eine zweite Uhr,
         * die nach zwei Sekunden anders steht.
         */
        void steuerungSichtbar(boolean sichtbar);

        /**
         * Der oertliche Start ist durch - jetzt darf das Vollbild kommen.
         *
         * <p>Und keinen Augenblick frueher. Genau das war der gemeldete Fehler:
         * ein Tipp auf "Weiterschauen" oeffnete das Vollbild, und darin stand
         * ein Player, der nie eine Quelle bekommen hatte.
         *
         * @param laeuft ob wirklich etwas laeuft. Bei {@code false} ist der
         *               Player da, startet aber nicht von selbst - dann bleibt
         *               das Vollbild aus und der Zuschauer bekommt einen
         *               Hinweis statt einer schwarzen Flaeche.
         */
        void oertlicherStartFertig(boolean laeuft);

        /**
         * Eine Zwischenmeldung des Startskripts.
         *
         * <p>Der Bericht kommt erst am Ende; dazwischen liegen Sekunden, in
         * denen der Ladebildschirm sonst nur raten koennte. Gemeldet wird, was
         * der Player wirklich hergibt - der Rahmen mit dem Video ist gefunden
         * ({@code spieler}), die Quelle ist hinter der Ueberlagerung geladen
         * ({@code quelle}). Die Namen kommen aus dem geteilten Modul.
         */
        void startPhase(String name);
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
    private String meldeUi = "__elfix:wp:ui:";

    /* ------------------------------------------------ Titel und Raum hier */

    /*
     * Unter welchem Schluessel die offene Seite in der Runde gefuehrt wird.
     *
     * <h3>Warum das nicht mehr hier ausgerechnet wird</h3>
     *
     * <p>Es wurde hier ausgerechnet, und zwar falsch. Diese Klasse bildete den
     * Schluessel aus der Adresse ("https://aniworld.to/anime/stream/bleach"),
     * der Rechner bildet ihn aus Art und Titel ("serie:bleach") - dieselbe
     * Runde, derselbe Anime, zwei Schluessel. Was daran haengt, haengt an
     * <em>allem</em>: die Mitgliedschaft im Titel, die Standmeldung, jeder
     * Steuerbefehl, die Hostwahl. Ein Telefon fand den vom Rechner
     * eingestellten Titel deshalb nie, meldete nie einen Stand, tauchte drueben
     * weder als Mitschauer noch als Host auf, und seine Pause ging nirgendwo
     * hin. Vier gemeldete Fehler, ein Missverstaendnis.
     *
     * <p>Jetzt fragt diese Klasse den Kern - {@code watchparty-bruecke.lageFuer}
     * benutzt dieselbe Regel wie {@code watchpartySerieForUrl} am Rechner. Die
     * Antwort kommt asynchron und wird hier gehalten, weil die Meldungen aus
     * dem Player sofort beantwortet werden muessen. Sie ist damit hoechstens
     * einen Augenblick alt - genauso alt wie der Raumzustand, aus dem sie
     * stammt.
     */
    /** Die Adresse, fuer die die gepufferte Lage gilt. */
    private String lageAdresse = "";
    /** Der Titelschluessel dazu, wie das Relay ihn fuehrt - leer heisst: in keiner Runde. */
    private String lageKey = "";
    /** Der Raum dazu, ohne Ruecksicht auf "Live aus". */
    private String lageRaum = "";
    /** Ob gerade eine Auskunft laeuft. Verhindert, dass jeder Herzschlag eine neue stellt. */
    private boolean lageLaeuft;

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
    /**
     * Woran eine Zwischenmeldung des Startskripts zu erkennen ist.
     *
     * <p>Aus derselben Quelle wie {@link #meldeStart}. Sie traegt den
     * Ladebalken des Vorhangs - siehe {@code Startvorhang}.
     */
    private String meldePhase = "__elfix:wp:phase:";
    /** Ob gerade ein Auftrag laeuft. Nur dann klopft der Takt an. */
    private boolean autostartLaeuft;
    /**
     * Ob der laufende Auftrag ein oertlicher ist - "Weiterschauen" statt Runde.
     *
     * <p>Derselbe Ablauf, dieselben Fristen, dasselbe Startskript; der
     * Unterschied ist, dass es niemanden zu fragen gibt und der Stand nicht vom
     * Host kommt, sondern aus der eigenen Ablage. Und dass am Ende das Vollbild
     * kommt - erst dann, und nur wenn wirklich etwas laeuft.
     */
    private boolean oertlicherStart;
    /**
     * Ob nach einem gelungenen Start das Vollbild kommen soll.
     *
     * <p>Der Merker gilt fuer beide Faelle - den oertlichen Start aus
     * "Weiterschauen" und den Start aus einer Runde. Beide enden im selben
     * Wunsch ("jetzt Vollbild") und duerfen ihn beide erst erfuellen, wenn der
     * Player gemeldet hat, dass wirklich etwas laeuft. Genau das fehlte: das
     * Vollbild kam, sobald ein Player-Rahmen <em>existierte</em>, und darin
     * stand dann eine Ueberlagerung ohne Quelle.
     */
    private boolean vollbildDanach;
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
            praefix("watchparty-bruecke.MELDE_PHASE", wert -> meldePhase = wert);
            praefix("watchparty-bruecke.MELDE_UI", wert -> meldeUi = wert);
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
        anwesendMelden();
        abgleichen();
    }

    /**
     * "Ich sitze an dieser Folge" - ohne auf den Player zu warten.
     *
     * <p>Das war die zweite Haelfte des Fehlers, und sie faellt erst am Geraet
     * auf. Alles, was das Relay ueber die Anwesenheit weiss, kam bisher vom
     * Horcher im Player - und der haengt an Medien-Ereignissen eines
     * {@code <video>} mit Laufzeit. Bei VOE gibt es die erst nach dem Klick auf
     * die Ueberlagerung des Hosters. Also:
     *
     * <ol>
     *   <li>kein Video, kein Ereignis, keine Standmeldung;
     *   <li>keine Standmeldung, keine Sitzung - das Geraet gilt dem Relay als
     *       nicht aktiv und wird nie Host;
     *   <li>kein Host, keine Antwort auf den Abgleich;
     *   <li>keine Antwort, kein Start - und damit nie ein Video.
     * </ol>
     *
     * <p>Gemessen am 25.08.2026 auf dem Telefon: vier Versuche "Stand der Runde
     * wird geholt", jedes Mal ohne Antwort, danach "kein start nach 4
     * Versuchen" und ein stehendes Bild. Dieselbe Schleife liess das Geraet am
     * Rechner weder als Mitschauer noch als Host auftauchen, solange die Folge
     * nur geladen und nicht gestartet war.
     *
     * <p>Die Meldung durchschneidet sie. Sie behauptet nichts, was nicht
     * stimmt: die Stelle ist die der Runde, angehalten ist wahr, und die
     * Sitzung ist die dieses Players. Sobald wirklich etwas laeuft, ueberholt
     * der Horcher sie im Sekundentakt.
     */
    private void anwesendMelden() {
        if (kern == null || !kern.istBereit()) return;
        String key = schluessel();
        String raum = raum();
        if (key.isEmpty() || raum.isEmpty()) return;
        JSONObject stand = standRumpf();
        try {
            // Ohne Stelle. Eine Anwesenheitsmeldung sagt "ich bin hier" und
            // nicht "ich stehe dort".
            //
            // Bis hierher trug sie die Stelle der Runde. Die ist bei einem
            // Geraet, das nicht fuehrt, oft gar nicht bekannt - dann stand da
            // eine 0, und weil eine Anwesenheitsmeldung keine Laufzeit hat,
            // ging sie am Relay als echter Stand durch. In der
            // Teilnehmerleiste sprang dadurch alle paar Sekunden bei
            // irgendwem 0:00 auf, bis eine Sekunde spaeter der Horcher des
            // Players seine wirkliche Stelle nachschob.
            //
            // Fehlt die Angabe, laesst das Relay den bisherigen Wert stehen
            // (siehe standSetzen). Genau das ist hier richtig: wo dieses
            // Geraet steht, weiss sein Player und sagt es im Sekundentakt
            // selbst.
            stand.put("paused", true);
        } catch (Exception fehler) {
            Log.e(TAG, "Anwesenheit nicht gebaut", fehler);
            return;
        }
        kern.rufe("watchparty-bruecke.meldeStand", Kern.args(key, stand, raum), (wert, fehler) -> {
            if (fehler != null) Log.d(TAG, "Anwesenheit nicht gemeldet: " + fehler);
        });
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

        // Ob die Bedienelemente des Players zu sehen sind. Das gilt unabhaengig
        // von der Watchparty und auch im Hintergrund: es ist eine Auskunft ueber
        // die Anzeige und keine Tat, die irgendwohin gemeldet wuerde.
        if (zeile.startsWith(meldeUi)) {
            steuerungSichtbarkeit(zeile);
            return;
        }

        // Der Bericht eines Autostart-Versuchs. Er geht nicht an die Runde
        // hinaus - er sagt diesem Geraet, ob sein eigener Start gelungen ist.
        // Er kommt vor allem anderen, weil er sonst als Tat gelesen wuerde, und
        // vor dem Watchparty-Schalter, weil "Weiterschauen" auch ohne Runde
        // starten muss.
        if (zeile.startsWith(meldeStart)) {
            autostartBericht(zeile);
            return;
        }

        // Eine Zwischenmeldung desselben Skripts. Sie geht nirgends hinaus und
        // wird auch nicht beurteilt - sie sagt nur dem Ladebildschirm, wie weit
        // der Player ist. Steht vor allem Uebrigen, weil sie sonst als Tat
        // gelesen wuerde.
        if (zeile.startsWith(meldePhase)) {
            String name = zeile.substring(meldePhase.length()).trim();
            if (!name.isEmpty()) umgebung.startPhase(name);
            return;
        }

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
        // ungebremst durch - aber warten muss darauf niemand.
        letzteStandMeldung = 0;
        // Und der Einstieg gilt neu: waehrend die App weg war, ist die Runde
        // weitergelaufen.
        angeklinkt.clear();
        anwesendMelden();
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
        // Wer selbst weiterblaettert, meint den Auftrag von vorhin nicht mehr -
        // es sei denn, er zeigt genau auf diese Folge. Aus der Watchparty-Seite
        // geoeffnet ist beides dasselbe Ereignis.
        autostartAbbrechen("eigener Folgenwechsel", url);
        // Zu welchem Titel und welcher Runde die neue Seite gehoert, weiss der
        // Kern - hier gilt sie noch gar nicht als offen.
        lageFuer(url, (key, raum) -> {
            if (key.isEmpty() || raum.isEmpty()) return;
            if (liveAus.contains(liveMarke(key, raum))) return;
            kern.rufe("watchparty-bruecke.folgenwechselMelden", Kern.args(key, url, raum),
                (wert, fehler) -> {
                    if (fehler != null) Log.d(TAG, "Folgenwechsel nicht gemeldet: " + fehler);
                });
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
            anwesendMelden();
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
        //
        // Der Merker faellt hier trotzdem, und das ist der Punkt: er sagt „ich
        // folge gerade einem Wechsel der Runde" und schaltet damit die Meldung
        // eigener Wechsel ab. Blieb er an einer Seite ohne Folgennummer stehen
        // - der Uebersicht, von der aus man die naechste Folge waehlt -, dann
        // war er von da an dauerhaft an: jeder eigene Folgenwechsel danach
        // wurde verschluckt, und die Runde erfuhr nie davon. Genau der
        // gemeldete Fall „ich geh am Handy eine Folge weiter, PC und Fernseher
        // machen nichts".
        //
        // Eine zu frueh geloeschte Marke kostet dagegen nichts: welche Folge
        // als naechstes aufgeht, hat {@link #folgen} vorher in
        // {@code gemeldeteFolge} eingetragen - sie gilt dort als bekannt und
        // geht nicht noch einmal als eigener Wechsel hinaus.
        if (folge[1] <= 0) {
            folgtDerRunde = false;
            return;
        }
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
        String raumJetzt = raum();
        lageFuer(ziel, (neuerKey, neuerRaum) -> autostartAnfordern(
            neuerKey.isEmpty() ? lageKey : neuerKey,
            neuerRaum.isEmpty() ? raumJetzt : neuerRaum, ziel));
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
            oertlicherStart = false;
            haupt.removeCallbacks(autostartTakt);
            haupt.postDelayed(autostartTakt, AUTOSTART_TAKT_MS);
        });
    }

    /**
     * Ob die Bedienelemente des Players zu sehen sind.
     *
     * <p>Zerlegt wird die Zeile im Kern - derselben Stelle, an der das Skript
     * sie zusammensetzt. Eine unlesbare Zeile aendert nichts: sie darf die
     * Leiste nicht wegnehmen.
     */
    private void steuerungSichtbarkeit(String zeile) {
        kern.rufe("watchparty-bruecke.uiLesen", Kern.args(zeile), (wert, fehler) -> {
            if (fehler != null || wert == null || "null".equals(wert)) return;
            try {
                boolean an = new JSONObject(wert).optBoolean("sichtbar", true);
                Log.d(TAG, "Player-Steuerung " + (an ? "sichtbar" : "ausgeblendet"));
                umgebung.steuerungSichtbar(an);
            } catch (Exception ausnahme) {
                Log.d(TAG, "Sichtbarkeit unlesbar: " + ausnahme);
            }
        });
    }

    /**
     * Der oertliche Start: "Weiterschauen" soll wirklich weiterschauen.
     *
     * <p>Bis hierher endete diese Kette im Vollbild - so stand es sogar im
     * Kommentar von {@code autoStartFullscreen}: "The chain stops here, with
     * the player up in fullscreen and paused." Fuer eine Fernbedienung war das
     * eine bewusste Zurueckhaltung; fuer einen Tipp auf "Weiterschauen" ist es
     * schlicht der gemeldete Fehler - Vollbild da, Folge steht.
     *
     * <p>Was fehlte, war nie das Wissen: der Ablauf, der einen VOE-Player
     * wirklich zum Laufen bringt, steht seit dem Folgen-Autostart in
     * {@code watchparty-autostart.js} - Ueberlagerung klicken, auf die Quelle
     * warten, Stelle setzen, starten, nachsehen, ob die Stelle weiterlaeuft.
     * Er hing nur an einer Runde. Jetzt gilt er auch ohne: derselbe Auftrag,
     * dieselben Fristen, dasselbe Skript, nur mit dem gespeicherten Stand
     * statt dem des Hosts.
     *
     * @param url    die Folgenseite, die gerade offen ist
     * @param stelle der gespeicherte Wiedergabestand in Sekunden, 0 wenn keiner
     */
    public boolean oertlichenStartAnfordern(String url, double stelle) {
        if (kern == null || !kern.istBereit() || url == null || url.isEmpty()) return false;
        // Was auch immer gleich startet: danach das Vollbild.
        vollbildDanach = true;
        // Steht in einer Runde schon ein Auftrag, gehoert ihm der Player. Er
        // holt den Stand des Hosts und ist damit die genauere Antwort - das
        // Vollbild kommt dann von ihm.
        if (autostartLaeuft && !oertlicherStart) {
            Log.i(TAG, "Oertlicher Start entfaellt - die Runde startet diesen Player");
            return true;
        }
        int[] folge = folgeAus(url);
        JSONObject angaben = new JSONObject();
        try {
            angaben.put("oertlich", true);
            angaben.put("url", url);
            angaben.put("stelle", Math.max(0, stelle));
            angaben.put("season", folge[0]);
            angaben.put("episode", folge[1]);
        } catch (Exception fehler) {
            Log.e(TAG, "Oertlicher Startauftrag nicht gebaut", fehler);
            return false;
        }
        kern.rufe("watchparty-bruecke.autostartAnfordern", Kern.args(angaben), (wert, fehler) -> {
            if (fehler != null) {
                Log.w(TAG, "Oertlicher Start nicht angefordert: " + fehler);
                return;
            }
            Log.i(TAG, "Oertlicher Start angefordert " + wert
                + " bei " + Math.round(stelle) + "s");
            autostartLaeuft = true;
            oertlicherStart = true;
            haupt.removeCallbacks(autostartTakt);
            haupt.post(autostartTakt);
        });
        return true;
    }

    /** Ob gerade ein oertlicher Start laeuft - fuer den Aufrufer, der auf ihn wartet. */
    public boolean oertlicherStartLaeuft() {
        return autostartLaeuft && oertlicherStart;
    }

    /**
     * Einen oertlichen Start abbrechen.
     *
     * <p>Wer waehrend des Anlaufs etwas anderes anfasst - zurueck, ein anderer
     * Titel, die Ansicht verlassen -, meint ihn nicht mehr. Ohne das startet
     * eine halbe Minute spaeter eine Folge, die niemand mehr sehen will.
     */
    public void oertlichenStartAbbrechen(String grund) {
        if (!autostartLaeuft || !oertlicherStart) return;
        autostartAbbrechen(grund);
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
        String adresse = umgebung.adresse();
        int[] folge = folgeAus(adresse);
        String key = schluessel();
        JSONObject eintrag = eintragZu(key);
        JSONObject lage = new JSONObject();
        try {
            lage.put("key", key);
            lage.put("room", raum());
            // Fuehrt dieses Geraet die Runde, gibt es niemanden zu fragen: der
            // Stand der Runde steht im Raumzustand, und der Start geht sofort.
            lage.put("binHost", binHost(key));
            lage.put("stelle", eintrag == null ? 0 : rundenStelle(eintrag));
            // Die Adresse: ein oertlicher Auftrag haengt an ihr statt an Raum
            // und Titelschluessel, und der Kern rechnet sie selbst um.
            lage.put("url", adresse == null ? "" : adresse);
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
                oertlicherStart = false;
                haupt.removeCallbacks(autostartTakt);
                boolean gelungen = "laeuft".equals(grund) || "pausiert".equals(grund);
                boolean gegenstandslos = grund.isEmpty() || "veraltet".equals(grund)
                    || "kein auftrag".equals(grund) || "fertig".equals(grund);
                if (gelungen || gegenstandslos) {
                    Log.i(TAG, "Autostart beendet: " + grund);
                    if (gelungen) vollbildEinloesen(true);
                    else vollbildDanach = false;
                    return;
                }
                // Ein Fehlschlag bleibt sichtbar. Still zu scheitern war der
                // alte Zustand - dann sass man vor einem stehenden Bild und
                // wusste nicht, woran es lag.
                Log.w(TAG, "Autostart aufgegeben: " + grund);
                // Kein Vollbild auf einen Player, der nicht laeuft: der
                // Zuschauer bekommt den Player, wie er ist, und eine klare
                // Ansage - statt einer schwarzen Flaeche, in der nichts
                // geschieht.
                if (vollbildDanach) vollbildEinloesen(false);
                else umgebung.hinweisZeigen("Startet nicht von selbst - bitte einmal Play druecken");
                return;
            }
            // Ohne Runde gibt es niemanden zu fragen: der Kern hat das Skript
            // schon fertig, weil der Stand im Auftrag steht.
            if ("starten".equals(tun)) {
                String skript = schritt.optString("skript", "");
                WebView ansicht = umgebung.spieler();
                if (!skript.isEmpty() && ansicht != null && rahmen != null) {
                    // In *alle* Rahmen, nicht nur in die mit Video: solange die
                    // Quelle hinter der Ueberlagerung des Hosters liegt, traegt
                    // der Rahmen zwar ein <video>, aber ohne Laufzeit - und hat
                    // sich als "mit Video" nie gemeldet.
                    int erreicht = rahmen.anAlle(ansicht, skript);
                    Log.i(TAG, "Oertlicher Start (" + grund + ") in " + erreicht + " Rahmen");
                }
            }
            if ("anfordern".equals(tun)) {
                Log.i(TAG, "Autostart " + grund + " - Stand der Runde wird geholt");
                // Der eigene Stand zuerst: ohne ihn gilt dieses Geraet dem
                // Relay als nicht aktiv, und die Antwort bliebe aus.
                letzteStandMeldung = 0;
                WebView ansicht = umgebung.spieler();
                if (ansicht != null) anPlayer(ansicht);
                anwesendMelden();
                abgleichen();
            }
            long warten = Math.max(AUTOSTART_TAKT_MS, schritt.optLong("wartenMs", 0));
            haupt.removeCallbacks(autostartTakt);
            haupt.postDelayed(autostartTakt, warten);
        });
    }

    /**
     * Den Vollbildwunsch einloesen - genau einmal.
     *
     * <p>Ohne Wunsch geschieht nichts: ein Folgenwechsel mitten in einer Runde
     * soll niemanden ungefragt ins Vollbild ziehen. Der Wunsch entsteht nur
     * dort, wo jemand wirklich "jetzt schauen" gedrueckt hat.
     */
    private void vollbildEinloesen(boolean laeuft) {
        if (!vollbildDanach) return;
        vollbildDanach = false;
        umgebung.oertlicherStartFertig(laeuft);
    }

    /** Der Vollbildwunsch gilt nicht mehr - der Zuschauer ist woanders. */
    public void vollbildwunschVerwerfen() {
        vollbildDanach = false;
    }

    /**
     * Wo die Runde bei diesem Titel steht.
     *
     * <p>Dieselbe Vorrangregel wie ueberall: der gemeldete Stand der Runde geht
     * vor der Angabe am Titel, weil er juenger ist. Gebraucht wird sie genau
     * einmal - wenn dieses Geraet als Host startet und selbst wissen muss, wo.
     */
    private static double rundenStelle(JSONObject eintrag) {
        JSONObject stand = eintrag.optJSONObject("progress");
        if (stand != null) return Math.max(0, stand.optDouble("position", 0));
        return Math.max(0, eintrag.optDouble("stelle", 0));
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
                oertlicherStart = false;
                haupt.removeCallbacks(autostartTakt);
                // Jetzt, und keinen Augenblick frueher: das Vollbild kommt erst,
                // wenn der Player gemeldet hat, dass die Stelle weiterlaeuft.
                vollbildEinloesen(true);
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
        if (ziel == null || ziel.isEmpty()) {
            autostartVerwerfen(new JSONObject(), grund);
            return;
        }
        // Welche Runde und welcher Titel hinter dem Ziel stehen, weiss der
        // Kern. Die Adresse geht mit: ein oertlicher Auftrag haengt an ihr und
        // nicht an einem Titelschluessel.
        final String zielAdresse = ziel;
        lageFuer(zielAdresse, (key, raumDort) -> {
            JSONObject lage = new JSONObject();
            int[] folge = folgeAus(zielAdresse);
            try {
                lage.put("key", key);
                lage.put("room", raumDort.isEmpty() ? raum() : raumDort);
                lage.put("url", zielAdresse);
                lage.put("season", folge[0]);
                lage.put("episode", folge[1]);
            } catch (Exception fehler) {
                Log.e(TAG, "Lage fuer das Verwerfen nicht gebaut", fehler);
            }
            autostartVerwerfen(lage, grund);
        });
    }

    private void autostartVerwerfen(JSONObject lage, String grund) {
        kern.rufe("watchparty-bruecke.autostartVerwerfen", Kern.args(lage), (wert, fehler) -> {
            if (wert != null && wert.contains("true")) {
                Log.i(TAG, "Autostart verworfen: " + grund);
                autostartLaeuft = false;
                oertlicherStart = false;
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

    /**
     * Gibt dieses Geraet bei dem Titel, der hier offen steht, den Takt vor?
     *
     * <p>Gebraucht von den Intromarken: waehrend einer Runde wird nicht
     * gelernt, weil der Player von aussen gefahren wird - beim Host aber
     * schon, denn er ist derjenige, der ihn faehrt.
     */
    public boolean binHostHier() {
        return binHost(schluessel());
    }

    /* ------------------------------------------------------------- Hilfen */

    /** Der Titel, unter dem die offene Seite in der Runde bekannt ist. */
    private String schluessel() {
        lageAuffrischen();
        return lageKey;
    }

    /**
     * Die Lage nachziehen, wenn die offene Adresse eine andere ist.
     *
     * <p>Gefragt wird der Kern, nicht diese Klasse: dort liegt dieselbe Regel,
     * mit der der Rechner eine Adresse ihrer Runde zuordnet
     * ({@code watchpartySerieForUrl}). Die Antwort kommt asynchron und wird
     * gehalten - die Meldungen aus dem Player brauchen sie sofort und koennen
     * nicht auf eine Rueckfrage warten.
     *
     * <p>Beim allerersten Mal ist sie damit einen Wimpernschlag zu alt. Das
     * kostet nichts: die erste Meldung eines frischen Players kommt Sekunden
     * spaeter, und der Horcher meldet ohnehin weiter.
     */
    private void lageAuffrischen() {
        if (kern == null || !kern.istBereit()) return;
        String adresse = umgebung.adresse();
        if (adresse == null) adresse = "";
        if (adresse.equals(lageAdresse) || lageLaeuft) return;
        lageLaeuft = true;
        final String gefragt = adresse;
        kern.rufe("watchparty-bruecke.lageFuer", Kern.args(adresse), (wert, fehler) -> {
            lageLaeuft = false;
            if (fehler != null || wert == null) return;
            String key = "";
            String raum = "";
            try {
                JSONObject lage = new JSONObject(wert);
                key = lage.optString("key", "");
                raum = lage.optString("room", "");
            } catch (Exception ausnahme) {
                Log.d(TAG, "Lage unlesbar: " + ausnahme);
                return;
            }
            boolean neu = !key.equals(lageKey) || !raum.equals(lageRaum);
            lageAdresse = gefragt;
            lageKey = key;
            lageRaum = raum;
            if (neu) {
                Log.i(TAG, "Watchparty-Lage: Titel " + (key.isEmpty() ? "(keiner)" : key)
                    + ", Raum " + (raum.isEmpty() ? "(keiner)" : raum));
                umgebung.anzeigeAuffrischen();
            }
        });
    }

    /**
     * Die Lage von Grund auf neu holen.
     *
     * <p>Nicht nur bei einer anderen Adresse: der Raumzustand aendert sich auch
     * unter derselben Adresse - jemand tritt bei, jemand stellt den Titel ein,
     * eine Verbindung kommt zurueck. Dann gilt fuer dieselbe Seite ploetzlich
     * eine Runde, von der sie eben noch nichts wusste.
     */
    public void lageVerwerfen() {
        lageAdresse = "";
        lageAuffrischen();
    }

    /**
     * Schluessel und Raum zu irgendeiner Adresse - nicht nur zur offenen.
     *
     * <p>Fuer den Folgenwechsel und den Autostart: dort geht es um die Seite,
     * die gleich aufgeht, und die steht noch nicht offen.
     */
    private void lageFuer(String url, java.util.function.BiConsumer<String, String> nimm) {
        if (kern == null || !kern.istBereit() || url == null || url.isEmpty()) {
            nimm.accept("", "");
            return;
        }
        kern.rufe("watchparty-bruecke.lageFuer", Kern.args(url), (wert, fehler) -> {
            if (fehler != null || wert == null) {
                nimm.accept("", "");
                return;
            }
            try {
                JSONObject lage = new JSONObject(wert);
                nimm.accept(lage.optString("key", ""), lage.optString("room", ""));
            } catch (Exception ausnahme) {
                nimm.accept("", "");
            }
        });
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
        return liveAus.contains(liveMarke(lageKey, roh)) ? "" : roh;
    }

    /** In welchem Raum diese Seite steht - auch wenn das Live-Schauen aus ist. */
    private String raumRoh() {
        lageAuffrischen();
        return lageKey.isEmpty() ? "" : lageRaum;
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
     * Ob dieses Geraet gerade einem Folgenwechsel der Runde folgt.
     *
     * <p>Gefragt vom Autoplay: solange die Runde den Wechsel vorgibt, hat
     * dieses Geraet keinen eigenen zu machen. Zwei Wechsel hintereinander
     * waeren eine Folge zu weit - genau der Zustand, in dem Android weiter
     * waere als der Rechner.
     */
    public boolean folgtDerRunde() {
        return folgtDerRunde;
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
