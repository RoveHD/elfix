package local.elflix.android;

import android.util.Log;
import android.webkit.WebView;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Was ueber dem Video liegt - auf jedem Geraet und in jedem Rahmen.
 *
 * <p><b>Sie hiess einmal Fernsehwerbung, und das war zu eng.</b> Geschrieben
 * wurde sie fuer den Fernsehstick, weil dort der {@link Werbefilter} nicht
 * laeuft; fuer das Telefon galt die Annahme, der Werbefilter decke es ab.
 * Die Annahme stimmt nur fuer das oberste Dokument. {@link Werbefilter} und
 * {@link Kosmetik} spielen ueber {@code evaluateJavascript} ein, und das
 * erreicht keinen Unterrahmen - genau deshalb bringt ELFIX fuer die
 * Spielerskripte ueberhaupt androidx.webkit mit. Die Schicht ueber dem Video
 * sitzt aber im Rahmen des Hosters, und dorthin kam auf dem Telefon nichts.
 * Gemeldet mit einem Foto: ein Gluecksspiel-Overlay mitten im laufenden
 * Video, mit Countdown und "Fordern Sie Ihren Bonus an!".
 *
 * <p>Diese Klasse ist der einzige Weg auf Android, der in <em>jedes</em>
 * Dokument einspielt. Sie laeuft deshalb ueberall. Nur der dritte Aufruf in
 * MainActivity bleibt beim Fernseher, und zwar aus einem anderen Grund: dort
 * geht es um die Fokusreihenfolge des Steuerkreuzes.
 *
 * <p>Warum ueberhaupt noch eine Stelle, wo es {@link Adblocker},
 * {@link Werbefilter} und {@link Kosmetik} schon gibt? Weil die drei je eine
 * Luecke lassen, und die beiden Karten oben rechts auf AniWorld sind genau
 * durch diese Luecken gekommen:
 *
 * <ul>
 *   <li>Der {@link Adblocker} sperrt Anfragen - aber
 *       {@code isPageCriticalRequest} laesst Bilder, Stilblaetter und
 *       Schriften ungeprueft durch, damit eine Seite nicht an ihm zerbricht.
 *       Das Bild einer Werbekarte ist formal ein Seitenbestandteil. Dagegen
 *       steht jetzt {@link Adblocker#istKernWerbeAnfrage}, gerufen <em>vor</em>
 *       jener Ausnahme.</li>
 *   <li>Der {@link Werbefilter} bringt die kosmetischen Regeln der
 *       Filterlisten mit - aber er laeuft nur auf Geraeten mit genug Speicher,
 *       und ein Fernseh-Stick ist keines davon (siehe
 *       {@link Werbefilter#geraetTraegt}). Auf dem Fernseher war er nie in
 *       Kraft. Und wo er laeuft, erreicht er nur das oberste Dokument - im
 *       Rahmen des Hosters, wo der Player sitzt, hilft er nicht.</li>
 *   <li>Die {@link Kosmetik} beurteilt Schichten <em>ueber dem Player</em> und
 *       tut das ueber zwei Runden durch den Kern. Sie greift erst nach
 *       {@code onPageFinished} und ist damit sichtbar zu spaet - die Werbung
 *       blitzt auf, bevor sie verschwindet. Und eine Karte in der Ecke deckt
 *       den Player nicht zu, faellt also gar nicht in ihre Frage.</li>
 * </ul>
 *
 * <p>Diese Klasse setzt an drei Stellen an, die die anderen nicht besetzen:
 *
 * <ol>
 *   <li><b>Am Dokumentstart.</b> Das Stilblatt geht ueber
 *       {@code addDocumentStartJavaScript} in jedes Dokument, bevor dessen
 *       eigene Skripte laufen. Was benannt ist, ist damit nie sichtbar - kein
 *       Aufblitzen.</li>
 *   <li><b>Mit einer Punktevergabe statt einer Wortliste.</b> Ein Element
 *       fliegt erst bei vier Punkten, und keine einzelne Beobachtung gibt
 *       vier. "Banner", "Popup" oder "Overlay" allein reichen deshalb
 *       grundsaetzlich nicht - das ist die Antwort auf die Frage, warum hier
 *       nicht einfach nach Woertern gesucht wird.</li>
 *   <li><b>Mit einem begrenzten Beobachter.</b> Werbung wird nachgereicht,
 *       oft Sekunden nach der Seite. Der Beobachter sieht sich das an - aber
 *       mit Deckel: hoechstens {@link #HOECHSTPRUEFUNGEN} Elemente in einem
 *       Dokument, danach haengt er sich aus. Ein Beobachter ohne Deckel ist
 *       auf einem Fernseh-Stick ein Standbild.</li>
 * </ol>
 *
 * <h2>Was ausdruecklich nicht passiert</h2>
 *
 * <p><b>Keine Rahmen pauschal.</b> Ein {@code iframe} mit fremdem Wirt, den
 * die Werbelisten nicht kennen, ist mit hoher Wahrscheinlichkeit der Player -
 * die Hoster liefern ihn von wechselnden Wegwerf-Adressen aus (siehe
 * {@link Adblocker#isEmbeddedThirdPartyFrame}). Ein Element, das so einen
 * Rahmen enthaelt, ist deshalb geschuetzt und wird nie angefasst.
 *
 * <p><b>Keine Koordinaten.</b> Nirgends steht eine Bildschirmstelle. Was
 * hereinspielt, ist die <em>Art</em> eines Elements - was es enthaelt, wohin
 * es verweist, ob es ueberhaupt etwas anzeigt. Eine unsichtbare Klickflaeche
 * wird daran erkannt, dass sie durchsichtig und inhaltsleer ist und trotzdem
 * Klicks fangen wuerde, nicht daran, wo sie liegt.
 *
 * <p><b>Kein eigenes HTML.</b> Die Anbieterseite bleibt die Anbieterseite.
 *
 * <h2>Anbieter</h2>
 *
 * <p>Die anbieterbezogenen Regeln stehen getrennt und werden getrennt
 * ausgeliefert: eine Seite bekommt ihren eigenen Satz und den allgemeinen,
 * nie den eines anderen Anbieters. Das ist nicht Ordnungsliebe - eine Regel,
 * die auf AniWorld richtig ist, kann auf filmo.to das Episodenmenue treffen.
 */
public final class Werbeschichten {
    private static final String TAG = CrashReporter.TAG;

    /** Ab wieviel Punkten ein Element als Werbung gilt. Dieselbe Schwelle wie in adblock-kosmetik.js. */
    static final int SCHWELLE = 4;
    /** Wieviele Elemente ein Dokument hoechstens kostet, bevor der Beobachter sich aushaengt. */
    static final int HOECHSTPRUEFUNGEN = 4000;
    /** Wieviele frisch eingehaengte Knoten ein Durchgang hoechstens ansieht. */
    static final int STAPEL = 60;
    /** Wie lange nach einer Aenderung gewartet wird, bevor der Durchgang laeuft. */
    static final int PAUSE_MS = 250;

    /* ------------------------------------------------------- Anbieterkennung */

    public static final String ANIWORLD = "aniworld";
    public static final String STO = "sto";
    public static final String FILMO = "filmo";

    /**
     * Zu welcher Anbieterfamilie diese Seite gehoert.
     *
     * <p>Ueber Namen <em>und</em> Startadresse, wie {@code isFirstParty} im
     * {@link Adblocker}: die Anbieter ziehen um, und ein Eintrag, der nur den
     * alten Wirt kennt, verliert seine Regeln beim naechsten Umzug.
     *
     * @return eine der Konstanten oder "" fuer einen unbekannten Anbieter
     */
    static String kennung(String name, String startUrl) {
        String text = ((name == null ? "" : name) + " " + (startUrl == null ? "" : startUrl)).toLowerCase();
        if (text.contains("aniworld")) return ANIWORLD;
        if (text.contains("filmo")) return FILMO;
        if (text.contains("s.to") || text.matches(".*\\bsto\\b.*")) return STO;
        return "";
    }

    static String kennung(Provider anbieter) {
        return anbieter == null ? "" : kennung(anbieter.name, anbieter.startUrl);
    }

    /* ---------------------------------------------------------- Die Regeln */

    /**
     * Was ohne jede weitere Pruefung verschwindet - der benannte Werbeplatz.
     *
     * <p>Jeder Eintrag benennt ein Werbeprodukt und keine Eigenschaft: das
     * Attribut, das der Werbeserver selbst setzt, der Rahmen mit dem Wirt des
     * Werbenetzes, die Kennung, die dessen Skript vergibt. Kein Eintrag
     * besteht aus einem allgemeinen Wort - {@code .banner}, {@code .popup} und
     * {@code .overlay} stehen hier bewusst nicht, weil eine Anbieterseite
     * eigene Elemente so nennen darf und darf und darf.
     */
    static final List<String> VERSTECK_ALLGEMEIN = Arrays.asList(
        "ins.adsbygoogle",
        ".adsbygoogle",
        "[data-ad-client]",
        "[data-ad-slot]",
        "[data-adbreak]",
        "[id^=\"google_ads_\"]",
        "[id^=\"gpt-ad\"]",
        "[id^=\"div-gpt-ad\"]",
        "[id^=\"aswift_\"]",
        "iframe[src*=\"googlesyndication.com\"]",
        "iframe[src*=\"googleadservices.com\"]",
        "iframe[src*=\"doubleclick.net\"]",
        "iframe[src*=\"adsterra\"]",
        "iframe[src*=\"exoclick\"]",
        "iframe[src*=\"popads\"]",
        "iframe[src*=\"propellerads\"]",
        "iframe[src*=\"hilltopads\"]",
        "iframe[src*=\"juicyads\"]",
        "iframe[src*=\"mgid.com\"]",
        "iframe[src*=\"adskeeper\"]",
        "iframe[src*=\"revcontent\"]",
        "iframe[src*=\"/ads/\"]",
        "iframe[src*=\"/adserver\"]",
        "[aria-label=\"Advertisement\"]",
        "[aria-label=\"Werbung\"]",
        // Push- und Benachrichtigungswerbung. Wieder Produktnamen, keine
        // Eigenschaften: OneSignal und PushEngage stehen auch in den
        // kuratierten Listen des Adblockers.
        ".onesignal-slidedown-container",
        "#onesignal-slidedown-container",
        ".onesignal-bell-launcher",
        "[id^=\"pushengage\"]",
        "[class^=\"pushengage\"]",
        // Der Kasten, den ein Werbeskript ueber document.write hinterlaesst.
        "[data-elfix-werbung]"
    );

    /**
     * Was diese Klasse auf keiner Seite anfasst.
     *
     * <p>Der wichtigste Teil der Datei. Ein Fehlurteil hier kostet den Player,
     * die Anmeldung oder das Captcha - und das faellt nicht als Werbung auf,
     * sondern als kaputte Seite.
     */
    static final List<String> SCHUTZ_ALLGEMEIN = Arrays.asList(
        "video",
        "audio",
        "form",
        "input",
        "select",
        "textarea",
        "label",
        "header",
        "nav",
        "main",
        "article",
        // Captchas und Pruefungen. Dieselben Namen, die
        // Adblocker.isChallengeOrVerificationUrl auf der Anfrageseite kennt.
        ".g-recaptcha",
        ".h-captcha",
        "[class*=\"captcha\"]",
        "[id*=\"captcha\"]",
        "[class*=\"turnstile\"]",
        "[id*=\"turnstile\"]",
        "[class*=\"cf-\"]",
        "iframe[src*=\"challenges.cloudflare.com\"]",
        "iframe[src*=\"recaptcha\"]",
        "iframe[src*=\"hcaptcha\"]",
        // Anmeldung und Konto.
        "[class*=\"login\"]",
        "[id*=\"login\"]",
        "[class*=\"signin\"]",
        "[class*=\"anmeld\"]",
        "[id*=\"anmeld\"]",
        // Die eigenen Einbauten von ELFIX.
        "#__elflixCursor",
        "[data-elfix-halten]"
    );

    /** AniWorld: Folgenliste, Staffelwahl, Sprachwahl, Hosterliste, Playerrahmen. */
    static final List<String> SCHUTZ_ANIWORLD = Arrays.asList(
        "#stream",
        ".hosterSiteVideo",
        ".hosterSiteDirectNav",
        ".inSiteWebStream",
        ".changeLanguageBox",
        ".watchEpisode",
        ".episodeList",
        ".seasonEpisodesList",
        ".seasonEpisodeTitle",
        ".hosterSiteTitle",
        ".generalTitle",
        ".seriesContentBox",
        ".alphabet-link"
    );

    /** s.to: dieselbe Werkstatt, eigener Satz - siehe Klassenkommentar. */
    static final List<String> SCHUTZ_STO = Arrays.asList(
        "#stream",
        ".hosterSiteVideo",
        ".hosterSiteDirectNav",
        ".inSiteWebStream",
        ".changeLanguageBox",
        ".watchEpisode",
        ".episodeList",
        ".seasonEpisodesList",
        ".seasonEpisodeTitle",
        ".seriesContentBox",
        ".series-title"
    );

    /** filmo.to: der Hoster steckt hier in einem eingebetteten Rahmen, nicht in der Hauptseite. */
    static final List<String> SCHUTZ_FILMO = Arrays.asList(
        ".player",
        "#player",
        ".player-frame",
        ".provider-frame",
        ".provider-chip",
        ".link-box",
        ".video-card",
        ".entry-content"
    );

    /**
     * Benannte Werbeplaetze je Anbieter.
     *
     * <p>Absichtlich kurz. Was hier steht, muss auf <em>dieser</em> Seite
     * ausdruecklich Werbung heissen; alles Uebrige geht durch die
     * Punktevergabe, die auch dann noch stimmt, wenn das Werbenetz seine
     * Kennungen wechselt - und das tut es.
     */
    static final List<String> VERSTECK_ANIWORLD = Arrays.asList(
        ".werbung",
        "#werbung",
        "[id^=\"ad_\"]",
        "[class^=\"ad_\"]",
        "[id^=\"werbe\"]",
        "[class^=\"werbe\"]"
    );

    static final List<String> VERSTECK_STO = Arrays.asList(
        ".werbung",
        "#werbung",
        "[id^=\"ad_\"]",
        "[class^=\"ad_\"]",
        "[id^=\"werbe\"]",
        "[class^=\"werbe\"]"
    );

    static final List<String> VERSTECK_FILMO = Arrays.asList(
        ".werbung",
        "#werbung",
        "[id^=\"ad_\"]",
        "[class^=\"ad_\"]"
    );

    /** Die Verstecklisten dieser Seite: der allgemeine Satz und der ihres Anbieters. */
    static String versteckRegeln(String kennung) {
        return zusammen(VERSTECK_ALLGEMEIN, anbieterVerstecken(kennung));
    }

    /** Die Schutzlisten dieser Seite - dieselbe Trennung. */
    static String schutzRegeln(String kennung) {
        return zusammen(SCHUTZ_ALLGEMEIN, anbieterSchuetzen(kennung));
    }

    static List<String> anbieterVerstecken(String kennung) {
        if (ANIWORLD.equals(kennung)) return VERSTECK_ANIWORLD;
        if (STO.equals(kennung)) return VERSTECK_STO;
        if (FILMO.equals(kennung)) return VERSTECK_FILMO;
        return java.util.Collections.emptyList();
    }

    static List<String> anbieterSchuetzen(String kennung) {
        if (ANIWORLD.equals(kennung)) return SCHUTZ_ANIWORLD;
        if (STO.equals(kennung)) return SCHUTZ_STO;
        if (FILMO.equals(kennung)) return SCHUTZ_FILMO;
        return java.util.Collections.emptyList();
    }

    private static String zusammen(List<String> a, List<String> b) {
        Set<String> alle = new LinkedHashSet<>(a);
        alle.addAll(b);
        return String.join(",", alle);
    }

    /* ------------------------------------------------------------ Das Skript */

    private final Adblocker adblocker;
    private final boolean melden;
    /** Je Anbieter einmal gebaut - die Zeichenkette ist gut zwoelf Kilobyte gross. */
    private final java.util.Map<String, String> gebaut = new java.util.HashMap<>();

    /**
     * @param melden ob das Skript Zeilen in die Konsole schreibt. Nur im
     *               Debug-Bau: im Release waere das eine Diagnose, die
     *               niemand liest, und auf einer werbelastigen Seite eine, die
     *               das Protokoll zuschuettet.
     */
    public Werbeschichten(Adblocker adblocker, boolean melden) {
        this.adblocker = adblocker;
        this.melden = melden;
    }

    /** Das fertige Skript fuer diesen Anbieter. */
    public String skript(Provider anbieter) {
        String kennung = kennung(anbieter);
        String fertig = gebaut.get(kennung);
        if (fertig != null) return fertig;
        fertig = skript(kennung, adblocker == null ? null : adblocker.kernWerbeWirte(), melden);
        gebaut.put(kennung, fertig);
        return fertig;
    }

    /**
     * Den frisch angelegten WebView anschliessen - der Weg ohne Aufblitzen.
     *
     * <p>{@code addDocumentStartJavaScript} laeuft in <em>jedem</em> Dokument,
     * bevor dessen eigene Skripte laufen, und damit auch in den Rahmen. Das
     * ist der Unterschied zu {@code evaluateJavascript}: dort waere das
     * Stilblatt fruehestens da, wenn die Seite ihre Werbung schon aufgebaut
     * hat, und man saehe sie eine Zehntelsekunde lang.
     *
     * <p>Muss vor dem ersten {@code loadUrl} gerufen werden - fuer das
     * Dokument, das schon steht, gilt es nicht mehr. Deshalb steht der Aufruf
     * in {@code webViewFor} unmittelbar neben dem von {@link Rahmen}.
     *
     * @return ob es geklappt hat; sonst bleibt {@link #einspielen} der Weg
     */
    public boolean anschliessen(WebView ansicht, Provider anbieter) {
        if (ansicht == null) return false;
        if (anbieter != null && !anbieter.adblockEnabled) return false;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return false;
        java.util.Set<String> wirte = wirtRegeln(anbieter);
        if (wirte.isEmpty()) return false;
        try {
            WebViewCompat.addDocumentStartJavaScript(ansicht, skript(anbieter), wirte);
            return true;
        } catch (Exception fehler) {
            // Ein WebView, der das nicht mitmacht, ist kein Grund zum Absturz.
            // Dann filtert eben erst onPageStarted, und die Werbung blitzt
            // einmal auf - immer noch besser als gar keine Filterung.
            Log.w(TAG, "Werbeschichten nicht angeschlossen", fehler);
            return false;
        }
    }

    /**
     * In welche Dokumente das Skript geht - und in welche ausdruecklich nicht.
     *
     * <p>Nur in die des Anbieters. Ein {@code "*"} wuerde es auch in den
     * Rahmen des Hosters einspielen, und das waere die eine Aenderung dieser
     * Arbeit, die den Player kosten kann: VOE zaehlt mit, was auf seiner
     * Seite fehlt, und beantwortet ein zu aufgeraeumtes Dokument mit "Ad
     * blockers are not allowed" statt mit einem Video. Dieselbe Ueberlegung,
     * aus der {@link Adblocker#blockReason} im Hosterrahmen nur die
     * kuratierten Kernlisten anwendet.
     *
     * <p>Die beiden Karten aus dem Foto stehen ohnehin im Hauptdokument der
     * Anbieterseite - dort, wo das Skript laeuft.
     *
     * <p>Zieht der Anbieter auf einen anderen Wirt um, greift die Regel nicht
     * mehr, und es bleibt bei {@link #einspielen} aus den Seitenrueckrufen:
     * dieselbe Filterung, nur einen Bildaufbau spaeter.
     */
    static java.util.Set<String> wirtRegeln(Provider anbieter) {
        return wirtRegeln(anbieter == null ? null : anbieter.startUrl);
    }

    /**
     * Die Regeln aus einer Adresse - ohne {@code android.net.Uri}.
     *
     * <p>Von Hand zerlegt und nicht ueber {@code Uri.parse}, damit sich diese
     * Entscheidung ohne Geraet pruefen laesst: im Unit-Test ist die
     * Android-Fassung von {@code Uri} nur ein Rumpf, der {@code null}
     * zurueckgibt, und eine Regel, deren Pruefung dort auf einem Rumpf
     * beruht, prueft nichts.
     */
    static java.util.Set<String> wirtRegeln(String startUrl) {
        String adresse = startUrl == null ? "" : startUrl.trim();
        int schemaEnde = adresse.indexOf("://");
        if (schemaEnde <= 0) return java.util.Collections.emptySet();
        String schema = adresse.substring(0, schemaEnde).toLowerCase();
        if (!"http".equals(schema) && !"https".equals(schema)) {
            return java.util.Collections.emptySet();
        }
        String rest = adresse.substring(schemaEnde + 3);
        // Erst den Pfad abschneiden, dann eine etwaige Anmeldung, dann den
        // Port. Die Reihenfolge ist nicht beliebig: der Doppelpunkt in
        // "wer:was@wirt" gehoert zur Anmeldung und nicht zum Port, und wer
        // zuerst am Doppelpunkt schneidet, behaelt "wer" als Wirt.
        for (String trenner : new String[]{"/", "?", "#"}) {
            int stelle = rest.indexOf(trenner);
            if (stelle >= 0) rest = rest.substring(0, stelle);
        }
        int klammeraffe = rest.lastIndexOf('@');
        if (klammeraffe >= 0) rest = rest.substring(klammeraffe + 1);
        int port = rest.indexOf(':');
        if (port >= 0) rest = rest.substring(0, port);
        String wirt = rest.toLowerCase();
        if (wirt.isEmpty() || wirt.contains("*")) return java.util.Collections.emptySet();
        java.util.Set<String> regeln = new java.util.LinkedHashSet<>();
        regeln.add(schema + "://" + wirt);
        // Die Anbieter arbeiten mit Unterdomains (cdn., www., wechselnde
        // Zaehlnamen); ohne diese Regel bliebe die halbe Seite ungefiltert.
        regeln.add(schema + "://*." + wirt);
        return regeln;
    }

    /**
     * Einspielen, nachdem die Seite steht.
     *
     * <p>Das ist der zweite Weg und nicht der erste: der erste ist
     * {@code addDocumentStartJavaScript} in {@code webViewFor}, und der ist
     * der einzige, bei dem nichts aufblitzt. Diese Stelle deckt die WebViews
     * ab, denen die Faehigkeit fehlt, und faengt Seiten ab, die ihr Dokument
     * per Skript austauschen.
     *
     * <p>Das Skript ist gegen mehrfaches Einspielen abgesichert (siehe die
     * Wache ganz am Anfang), es kostet also nichts, es zweimal zu schicken.
     */
    public void einspielen(WebView ansicht, Provider anbieter) {
        if (ansicht == null) return;
        if (anbieter != null && !anbieter.adblockEnabled) return;
        try {
            ansicht.evaluateJavascript(skript(anbieter), null);
        } catch (Exception fehler) {
            Log.w(TAG, "Werbeschichten nicht eingespielt", fehler);
        }
    }

    /**
     * Baut das Skript.
     *
     * <p>Getrennt von allem Android, damit es sich ohne Geraet pruefen laesst:
     * die Regellisten sind der Teil, an dem ein Fehler weh tut, und eine
     * Liste, die man nur auf einem Fernseher ausprobieren kann, wird nicht
     * ausprobiert.
     */
    static String skript(String kennung, Collection<String> werbeWirte, boolean melden) {
        StringBuilder wirte = new StringBuilder();
        if (werbeWirte != null) {
            List<String> sortiert = new ArrayList<>(werbeWirte);
            java.util.Collections.sort(sortiert);
            for (String wirt : sortiert) {
                if (wirt == null || wirt.trim().isEmpty()) continue;
                if (wirte.length() > 0) wirte.append(',');
                wirte.append('"').append(wirt.trim().toLowerCase().replace("\"", "")).append('"');
            }
        }
        return "(function(){"
            + "if(window.__elfixTvWerbungV1)return;window.__elfixTvWerbungV1=true;"
            + "var SCHUTZ=" + jsText(schutzRegeln(kennung)) + ";"
            + "var VERSTECK=" + jsText(versteckRegeln(kennung)) + ";"
            + "var WIRTE=[" + wirte + "];"
            + "var MELDEN=" + (melden ? "true" : "false") + ";"
            + "var SCHWELLE=" + SCHWELLE + ";"
            + "var HOECHST=" + HOECHSTPRUEFUNGEN + ";"
            + "var STAPEL=" + STAPEL + ";"
            + "var PAUSE=" + PAUSE_MS + ";"
            + BASIS;
    }

    /** Eine Zeichenkette so, wie JavaScript sie lesen kann. */
    static String jsText(String wert) {
        String sauber = wert == null ? "" : wert;
        return "\"" + sauber.replace("\\", "\\\\").replace("\"", "\\\"")
            .replace("\n", " ").replace("\r", " ") + "\"";
    }

    /**
     * Der unveraenderliche Teil.
     *
     * <p>Absichtlich ohne Vorlagen und ohne Pfeilfunktionen: dieses Skript
     * laeuft auch in dem alten WebView eines guenstigen Fernseh-Sticks, und
     * ein Syntaxfehler dort hiesse, dass gar nichts filtert.
     */
    private static final String BASIS =
        // ------------------------------------------------------ Das Stilblatt
        // Es geht als Erstes hinaus, noch bevor irgendetwas geprueft wird:
        // was benannt ist, soll gar nicht erst einen Bildaufbau lang zu sehen
        // sein. "display:none" und nicht "visibility:hidden" - sonst bliebe
        // die Flaeche als Luecke stehen, und genau das soll nicht passieren.
        "function stil(){"
            + "var vorhanden=document.getElementById('__elfixTvWerbungStil');"
            + "if(vorhanden)return;"
            + "var ziel=document.head||document.documentElement;"
            + "if(!ziel){setTimeout(stil,0);return;}"
            + "var blatt=document.createElement('style');"
            + "blatt.id='__elfixTvWerbungStil';"
            + "blatt.textContent=VERSTECK+'{display:none!important}'"
                + "+'[data-elfix-werbung]{display:none!important}'"
                // Ein Platz, aus dem die Werbung heraus ist, soll keinen
                // Abstand hinterlassen. Die Marke setzt der Durchgang unten,
                // und nur an einem Kasten, in dem danach nichts mehr steht.
                + "+'[data-elfix-leer]{min-height:0!important;height:auto!important;"
                + "padding-top:0!important;padding-bottom:0!important;"
                + "margin-top:0!important;margin-bottom:0!important;border:0!important}';"
            + "ziel.appendChild(blatt);"
        + "}"
        + "stil();"
        + "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',stil);}"

        // ------------------------------------------------------------ Wirte
        + "function wirtVon(wert){"
            + "if(!wert)return '';"
            + "try{return new URL(wert,location.href).hostname.toLowerCase();}catch(e){return '';}"
        + "}"
        + "function werbeWirt(wert){"
            + "var wirt=wirtVon(wert);"
            + "if(!wirt)return false;"
            + "for(var i=0;i<WIRTE.length;i++){"
                + "var eintrag=WIRTE[i];"
                + "if(wirt===eintrag||wirt.slice(-(eintrag.length+1))==='.'+eintrag)return true;"
            + "}"
            + "return false;"
        + "}"
        + "function fremd(wert){"
            + "var wirt=wirtVon(wert);"
            + "return !!wirt&&wirt!==location.hostname;"
        + "}"

        // -------------------------------------------------------- Der Schutz
        // Erst hier, dann alles andere. Ein Element, das eine dieser Fragen mit
        // ja beantwortet, wird nicht angefasst - egal, wie viele Punkte es
        // sonst bekommen haette.
        + "function passt(el,auswahl){try{return el.matches&&el.matches(auswahl);}catch(e){return false;}}"
        + "function drin(el,auswahl){try{return !!(el.querySelector&&el.querySelector(auswahl));}catch(e){return false;}}"
        + "function darueber(el,auswahl){try{return !!(el.closest&&el.closest(auswahl));}catch(e){return false;}}"
        + "function geschuetzt(el){"
            + "if(!el||!el.tagName)return true;"
            + "var tag=el.tagName;"
            + "if(tag==='HTML'||tag==='BODY'||tag==='HEAD'||tag==='SCRIPT'||tag==='STYLE'||tag==='LINK')return true;"
            + "if(el===document.body||el===document.documentElement)return true;"
            + "if(passt(el,SCHUTZ)||drin(el,SCHUTZ)||darueber(el,SCHUTZ))return true;"
            // Ein Rahmen mit fremdem Wirt, den die Werbelisten nicht kennen,
            // ist der Player: die Hoster liefern ihn von wechselnden
            // Wegwerf-Adressen. Deshalb bleibt alles stehen, was so einen
            // Rahmen enthaelt - das ist der Grund, warum hier nicht pauschal
            // iframes entfernt werden.
            + "if(tag==='IFRAME'&&fremd(el.src)&&!werbeWirt(el.src))return true;"
            + "var rahmen=[];"
            + "try{rahmen=el.querySelectorAll('iframe');}catch(e){rahmen=[];}"
            + "for(var i=0;i<rahmen.length;i++){"
                + "var quelle=rahmen[i].getAttribute('src')||rahmen[i].src||'';"
                + "if(fremd(quelle)&&!werbeWirt(quelle))return true;"
            + "}"
            // Was ein Video enthaelt, ist der Player und nicht seine
            // Verpackung - auch dann, wenn das Video gerade nichts anzeigt.
            + "if(drin(el,'video,audio,object,embed'))return true;"
            + "return false;"
        + "}"

        // --------------------------------------------------- Die Punktevergabe
        // Vier Punkte, und keine einzelne Beobachtung gibt vier. Ein Wort in
        // einer Kennung reicht also nie allein, und ein Text reicht nie allein.
        + "var MARKE=/(^|[^a-z])(ads?)[-_]?(box|slot|container|wrapper|zone|unit|banner|frame|space|holder|block|area|label|widget)([^a-z]|$)/;"
        + "var NETZ=/(adsbygoogle|googlesyndication|doubleclick|adsterra|exoclick|popads|popcash|popunder|propeller|hilltopads|juicyads|clickadu|adskeeper|revcontent|taboola|outbrain|mgid|adnium|trafficjunky|onesignal|pushengage|adnxs|pubmatic|criteo|smartadserver)/;"
        + "var TEXTE=["
            + "/\\b(the |your )?(file|download)\\s+is\\s+ready\\b/i,"
            + "/\\bdownload\\s+(is\\s+)?ready\\b/i,"
            + "/\\bready\\s+to\\s+(be\\s+)?download(ed)?\\b/i,"
            + "/\\bdatei\\s+(ist\\s+)?(bereit|fertig)\\b/i,"
            + "/\\bdownload\\s+starten\\b/i,"
            + "/\\bjetzt\\s+(herunterladen|downloaden)\\b/i,"
            + "/wir\\s+sind\\s+f(\\u00fc|ue)r\\s+dich\\s+da/i,"
            + "/\\ballow\\s+notifications\\b/i,"
            + "/benachrichtigungen\\s+(erlauben|zulassen|aktivieren)/i,"
            + "/\\bklicke?\\s+auf\\s+.{0,14}(erlauben|allow)\\b/i,"
            + "/\\bcontinue\\s+to\\s+download\\b/i,"
            + "/\\bdownload\\s+now\\b/i"
        + "];"
        + "function kennungText(el){"
            + "var teile=(el.id||'')+' '+(typeof el.className==='string'?el.className:'');"
            + "var namen=['data-ad','data-ads','data-advert','data-zone','data-banner-id'];"
            + "for(var i=0;i<namen.length;i++){if(el.hasAttribute&&el.hasAttribute(namen[i]))teile+=' '+namen[i];}"
            + "return teile.toLowerCase();"
        + "}"
        + "function textMuster(text){"
            + "for(var i=0;i<TEXTE.length;i++){if(TEXTE[i].test(text))return true;}"
            + "return false;"
        + "}"
        + "function verweistAufWerbung(el){"
            + "var kinder=[];"
            + "try{kinder=el.querySelectorAll('iframe[src],a[href],img[src],script[src],source[src]');}catch(e){kinder=[];}"
            + "if(werbeWirt(el.getAttribute&&(el.getAttribute('src')||el.getAttribute('href'))))return true;"
            + "for(var i=0;i<kinder.length&&i<40;i++){"
                + "var k=kinder[i];"
                + "if(werbeWirt(k.getAttribute('src')||k.getAttribute('href')))return true;"
            + "}"
            + "return false;"
        + "}"
        + "function punkte(el,spaet){"
            + "var summe=0;var gruende=[];"
            + "var kennung=kennungText(el);"
            + "if(NETZ.test(kennung)){summe+=3;gruende.push('netzname');}"
            + "else if(MARKE.test(kennung)){summe+=2;gruende.push('werbekennung');}"
            + "if(verweistAufWerbung(el)){summe+=2;gruende.push('werbewirt');}"
            + "var text='';"
            + "try{text=(el.innerText||el.textContent||'').trim();}catch(e){text='';}"
            + "if(text.length>0&&text.length<400&&textMuster(text)){summe+=2;gruende.push('werbetext');}"
            + "var stilwert=null;"
            + "try{stilwert=getComputedStyle(el);}catch(e){stilwert=null;}"
            + "if(stilwert){"
                + "var lage=stilwert.position;"
                + "var ebene=parseInt(stilwert.zIndex,10)||0;"
                // Freigestellt und weit vorn. Das ist eine Eigenschaft des
                // Elements und keine Bildschirmstelle: wo es liegt, wird
                // nirgends gefragt.
                + "if((lage==='fixed'||lage==='sticky')&&ebene>=100"
                    + "&&!darueber(el,'header,nav,footer,[role=\"banner\"],[role=\"navigation\"]')){"
                    + "summe+=1;gruende.push('freigestellt');"
                + "}"
            + "}"
            + "if(spaet){summe+=1;gruende.push('nachgereicht');}"
            + "if(el.parentElement===document.body){summe+=1;gruende.push('am dokument');}"
            + "return{summe:summe,gruende:gruende};"
        + "}"

        // -------------------------------------------- Der Rahmen ohne Quelle
        // Die Luecke, durch die die Karten oben rechts hereinkamen. Gemessen am
        // 26.08.2026 auf AniWorld, auf dem Fernseher *und* auf dem Telefon:
        //
        //   <iframe style="position:fixed !important;z-index:2147483647 !important;
        //                  inset:0px 0px auto auto !important;max-width:420px;height:170px">
        //
        // an <html> gehaengt - ohne src, ohne id, ohne Klasse, ohne ein
        // einziges Attribut ausser dem Stil. Sein Inhalt ("[1] BROWSER-UPDATE",
        // "Herunterladen und installieren", zwei Bilder von aichouphaugn.com)
        // steht in seinem *eigenen* Dokument.
        //
        // Genau daran ist jede der bisherigen Fragen gescheitert: von aussen
        // gibt es an diesem Element nichts zu lesen. Keine Kennung fuer NETZ
        // oder MARKE, kein Text fuer TEXTE (innerText eines Rahmens ist leer),
        // kein Ziel fuer verweistAufWerbung. Die Punktevergabe kommt auf zwei -
        // 'freigestellt' und 'nachgereicht' - und laesst ihn stehen. Die
        // Werbung versteckt ihre Merkmale hinter einer Dokumentgrenze.
        //
        // Woran er trotzdem zu erkennen ist: er hat keine Quelle. Ein Player
        // wird immer von einer Adresse geholt - gemessen aniworld.to/redirect/
        // <id> und filmo.to/n/<id>, beide mit src, beide im Textfluss ihres
        // Kastens. Ein Rahmen ohne Adresse kann keiner sein. Zusammen mit
        // "liegt fest und vor allem anderen" bleibt nichts uebrig, was diese
        // Form sonst haben koennte.
        //
        // Deshalb steht das hier als eigene Frage und nicht als weiterer Punkt:
        // Punkte sammelt man aus Beobachtungen, und hier gibt es nur eine.
        //
        // Zwei Grenzen bewusst eng: die Ebene muss wirklich hoch sein (die
        // eigenen Schichten einer Anbieterseite liegen bei zweistelligen
        // Werten), und ein Rahmen, der fast den ganzen Schirm einnimmt, faellt
        // heraus - das waere eher eine Vollbildhuelle als eine Werbekarte.
        + "var RAHMEN_EBENE=1000;"
        + "function ohneQuelle(el){"
            + "var quelle='';"
            + "try{quelle=(el.getAttribute('src')||'').trim();}catch(e){quelle='';}"
            + "if(!quelle)return true;"
            + "var klein=quelle.toLowerCase();"
            + "return klein==='about:blank'||klein.indexOf('javascript:')===0;"
        + "}"
        + "function rahmenschicht(el){"
            + "if(!el||el.tagName!=='IFRAME'||!el.getBoundingClientRect)return false;"
            + "if(!ohneQuelle(el))return false;"
            + "var stilwert=null;"
            + "try{stilwert=getComputedStyle(el);}catch(e){return false;}"
            + "if(!stilwert)return false;"
            + "if(stilwert.position!=='fixed'&&stilwert.position!=='sticky')return false;"
            + "if((parseInt(stilwert.zIndex,10)||0)<RAHMEN_EBENE)return false;"
            + "if(stilwert.display==='none'||stilwert.visibility==='hidden')return false;"
            + "var r=el.getBoundingClientRect();"
            + "if(r.width<1||r.height<1)return false;"
            + "var schirm=(window.innerWidth||1)*(window.innerHeight||1);"
            + "if(r.width*r.height>schirm*0.9)return false;"
            + "return true;"
        + "}"

        // ------------------------------------------- Unsichtbare Klickflaechen
        // Eine Flaeche, die nichts anzeigt, aber Klicks faengt. Erkannt daran,
        // dass sie leer und durchsichtig ist und trotzdem den groessten Teil
        // dessen einnimmt, was zu sehen waere - nicht daran, wo sie liegt.
        + "function klickfang(el){"
            + "if(!el||!el.getBoundingClientRect)return false;"
            + "var tag=el.tagName;"
            + "if(tag!=='A'&&tag!=='DIV'&&tag!=='INS'&&tag!=='SPAN')return false;"
            + "var stilwert=null;"
            + "try{stilwert=getComputedStyle(el);}catch(e){return false;}"
            + "if(!stilwert)return false;"
            + "if(stilwert.position!=='fixed'&&stilwert.position!=='absolute')return false;"
            + "if(stilwert.pointerEvents==='none')return false;"
            + "var r=el.getBoundingClientRect();"
            + "var sichtbar=(window.innerWidth||1)*(window.innerHeight||1);"
            + "if(r.width*r.height<sichtbar*0.55)return false;"
            + "var text='';try{text=(el.innerText||el.textContent||'').trim();}catch(e){text='';}"
            + "var inhalt=false;"
            + "try{inhalt=!!el.querySelector('img,svg,picture,video,canvas');}catch(e){inhalt=false;}"
            + "var durchsichtig=parseFloat(stilwert.opacity||'1')<0.05"
                + "||stilwert.backgroundColor==='rgba(0, 0, 0, 0)'&&!inhalt&&text.length===0;"
            + "if(text.length>0||inhalt)return durchsichtig&&parseFloat(stilwert.opacity||'1')<0.05;"
            + "return true;"
        + "}"

        // ------------------------------------------------------- Das Entfernen
        + "var entfernt=0;var geprueft=0;var gesehen=new WeakSet();"
        + "function fokusRetten(el){"
            // Steht der Fokus in dem, was gleich verschwindet, bekommt die
            // Seite einen neuen - sonst faellt er auf den Body, und das
            // Steuerkreuz faengt bei jedem Werbeschub von vorn an.
            + "var aktiv=document.activeElement;"
            + "if(!aktiv||!el.contains||!el.contains(aktiv))return;"
            + "try{aktiv.blur();}catch(e){}"
            + "setTimeout(function(){"
                + "try{if(window.__elfixTvNavErneut)window.__elfixTvNavErneut();}catch(e){}"
            + "},0);"
        + "}"
        + "function fokusNehmen(el){"
            + "try{"
                + "el.setAttribute('tabindex','-1');"
                + "el.setAttribute('aria-hidden','true');"
                + "var ziele=el.querySelectorAll('a,button,input,select,textarea,iframe,[tabindex]');"
                + "for(var i=0;i<ziele.length&&i<60;i++)ziele[i].setAttribute('tabindex','-1');"
            + "}catch(e){}"
        + "}"
        + "function luecken(el){"
            // Der Kasten, in dem die Werbung stand, soll nicht als Abstand
            // stehenbleiben. Hoechstens drei Ebenen hinauf, und nur solange
            // dort wirklich nichts mehr ist.
            + "var oben=el.parentElement;"
            + "for(var tiefe=0;tiefe<3&&oben;tiefe+=1){"
                + "if(oben===document.body||oben===document.documentElement)return;"
                + "if(passt(oben,SCHUTZ))return;"
                // "innerText" und nicht "textContent": nur das Erste kennt den
            // Unterschied zwischen leer und ausgeblendet, und genau darum geht
            // es hier - der Kasten soll gerade dann fallen, wenn das Einzige,
            // was in ihm stand, jetzt ausgeblendet ist.
            + "var text='';try{text=typeof oben.innerText==='string'"
                + "?oben.innerText.trim():(oben.textContent||'').trim();}catch(e){text='';}"
                + "if(text.length>0)return;"
                + "var sichtbar=false;"
                + "var kinder=oben.children||[];"
                + "for(var i=0;i<kinder.length;i++){"
                    + "var k=kinder[i];"
                    + "if(k.hasAttribute&&k.hasAttribute('data-elfix-werbung'))continue;"
                    + "var s=null;try{s=getComputedStyle(k);}catch(e){s=null;}"
                    + "if(!s||s.display!=='none'){sichtbar=true;break;}"
                + "}"
                + "if(sichtbar)return;"
                + "oben.setAttribute('data-elfix-leer','');"
                + "oben=oben.parentElement;"
            + "}"
        + "}"
        + "function wegnehmen(el,grund){"
            + "if(!el||!el.setAttribute)return false;"
            + "if(el.hasAttribute('data-elfix-werbung'))return false;"
            + "fokusRetten(el);"
            + "fokusNehmen(el);"
            + "el.setAttribute('data-elfix-werbung','');"
            // Nicht aus dem Baum nehmen, sondern ausblenden: manche
            // Werbeskripte bauen ihr Element sofort neu auf, wenn es
            // verschwindet, und dann laeuft der Beobachter im Kreis.
            + "try{el.style.setProperty('display','none','important');}catch(e){}"
            + "luecken(el);"
            + "entfernt+=1;"
            + "if(MELDEN)sammeln(grund);"
            + "return true;"
        + "}"

        // ------------------------------------------------------- Die Meldung
        // Hoechstens eine Zeile alle fuenf Sekunden, und die fasst zusammen.
        // Eine Zeile je Element waere auf einer werbelastigen Seite ein
        // Protokoll, in dem sonst nichts mehr zu finden ist.
        + "var offen=[];var meldeUhr=null;"
        + "function sammeln(grund){"
            + "if(offen.length<20)offen.push(grund);"
            + "if(meldeUhr)return;"
            + "meldeUhr=setTimeout(function(){"
                + "meldeUhr=null;"
                + "if(!offen.length)return;"
                + "try{console.log('ELFIX:tvwerbung entfernt='+entfernt+' geprueft='+geprueft"
                    + "+' zuletzt='+offen.join('|'));}catch(e){}"
                + "offen=[];"
            + "},5000);"
        + "}"

        // ------------------------------------------------------ Der Durchgang
        + "function pruefen(el,spaet){"
            + "if(!el||el.nodeType!==1)return;"
            + "if(gesehen.has(el))return;"
            + "gesehen.add(el);"
            + "geprueft+=1;"
            + "if(geschuetzt(el))return;"
            + "if(rahmenschicht(el)){wegnehmen(el,'rahmen ohne quelle');return;}"
            + "if(klickfang(el)){wegnehmen(el,'klickfang');return;}"
            + "var urteil=punkte(el,spaet);"
            + "if(urteil.summe>=SCHWELLE)wegnehmen(el,urteil.gruende.join('+'));"
        + "}"
        + "function durchgang(knoten,spaet){"
            + "for(var i=0;i<knoten.length&&i<STAPEL;i++){"
                + "var el=knoten[i];"
                + "if(!el||el.nodeType!==1)continue;"
                + "pruefen(el,spaet);"
                // Ein Werbeskript haengt seine Karte gern in einen leeren
                // Behaelter ein. Deshalb auch die erste Kindebene ansehen -
                // aber nur die erste: alles darunter waere ein Durchlauf durch
                // die ganze Seite bei jeder Aenderung.
                + "var kinder=el.children||[];"
                + "for(var k=0;k<kinder.length&&k<12;k++)pruefen(kinder[k],spaet);"
            + "}"
        + "}"
        // Der volle Lauf sieht nicht jedes Element der Seite an, sondern die
        // Anwaerter: was unmittelbar am Dokument haengt, was ein
        // Werbeprodukt in seiner Kennung traegt, und die Rahmen. Ein Lauf
        // ueber querySelectorAll('*') waere derselbe Massstab wie ein
        // Beobachter ohne Deckel - auf einem Fernseh-Stick kostet
        // getComputedStyle je Element genug, dass das Bild stehenbleibt.
        + "var ANWAERTER='iframe,ins,aside,[data-ad],[data-ads],[data-advert],[data-zone],"
            + "[id*=\"ad\"],[class*=\"ad\"],[id*=\"werb\"],[class*=\"werb\"],"
            + "[id*=\"promo\"],[class*=\"promo\"],[id*=\"push\"],[class*=\"push\"]';"
        + "function anwaerter(){"
            + "var liste=[];"
            + "function dazu(satz){if(!satz)return;for(var i=0;i<satz.length;i++)liste.push(satz[i]);}"
            // Was unmittelbar am Dokument haengt: dort haengt ein Werbeskript
            // seine Karte am liebsten ein, weil es dann von keinem Kasten der
            // Seite beschnitten wird.
            + "try{dazu(document.body&&document.body.children);}catch(e){}"
            + "try{dazu(document.querySelectorAll(ANWAERTER));}catch(e){}"
            + "return liste;"
        + "}"
        + "function ersterLauf(spaet){"
            + "var liste=anwaerter();"
            + "for(var i=0;i<liste.length&&geprueft<HOECHST;i++)pruefen(liste[i],!!spaet);"
        + "}"

        // ------------------------------------------------------ Der Beobachter
        // Mit Deckel. Ohne einen waere das auf einem Fernseh-Stick der Grund,
        // warum das Bild stehenbleibt.
        + "var wartend=[];var uhr=null;var wache=null;"
        + "function anstossen(){"
            + "if(uhr)return;"
            + "uhr=setTimeout(function(){"
                + "uhr=null;"
                + "var stapel=wartend;wartend=[];"
                + "if(geprueft>=HOECHST){aushaengen('deckel');return;}"
                + "durchgang(stapel,true);"
            + "},PAUSE);"
        + "}"
        + "function aushaengen(grund){"
            + "try{if(wache)wache.disconnect();}catch(e){}"
            + "wache=null;"
            + "if(MELDEN){try{console.log('ELFIX:tvwerbung beobachter aus ('+grund"
                + "+') entfernt='+entfernt+' geprueft='+geprueft);}catch(e){}}"
        + "}"
        + "function beobachten(){"
            + "if(wache||!document.documentElement)return;"
            + "try{"
                + "wache=new MutationObserver(function(eintraege){"
                    + "for(var i=0;i<eintraege.length&&wartend.length<STAPEL*4;i++){"
                        + "var neu=eintraege[i].addedNodes;"
                        + "for(var k=0;k<neu.length;k++){"
                            + "if(neu[k].nodeType===1)wartend.push(neu[k]);"
                        + "}"
                    + "}"
                    + "if(wartend.length)anstossen();"
                + "});"
                + "wache.observe(document.documentElement,{childList:true,subtree:true});"
            + "}catch(e){wache=null;}"
        + "}"

        // -------------------------------------------------------- Der Anlauf
        + "function anlaufen(){"
            + "stil();"
            + "ersterLauf(false);"
            + "beobachten();"
        + "}"
        + "if(document.readyState==='loading'){"
            + "document.addEventListener('DOMContentLoaded',anlaufen);"
        + "}else{anlaufen();}"
        // Zwei Nachschauen fuer das, was weder beim Laden dasteht noch als
        // neuer Knoten hereinkommt - eine Schicht, die ein Skript nur sichtbar
        // schaltet. Zwei, nicht dauernd: mehr braeuchte einen eigenen Takt,
        // und den hat der Beobachter schon.
        // "geprueft" wird dabei ausdruecklich nicht zurueckgesetzt: es ist der
        // Deckel ueber der gesamten Arbeit an diesem Dokument, und ein Deckel,
        // den man selbst wieder anhebt, ist keiner. Nur die Merkliste faellt
        // weg, damit dieselben Elemente noch einmal beurteilt werden duerfen.
        + "setTimeout(function(){if(geprueft<HOECHST){gesehen=new WeakSet();ersterLauf(true);}},2500);"
        + "setTimeout(function(){if(geprueft<HOECHST){gesehen=new WeakSet();ersterLauf(true);}},7000);"
        + "window.__elfixTvWerbungStand=function(){return{entfernt:entfernt,geprueft:geprueft};};"
    + "})();";
}
