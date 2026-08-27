package local.elflix.android;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.content.res.Configuration;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.TextUtils;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.CookieManager;
import android.webkit.WebStorage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.ByteArrayInputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final String TAG = CrashReporter.TAG;
    private static final long CACHE_CLEANUP_INTERVAL_MS = 15L * 60L * 1000L;
    private static final int ACCENT = Color.rgb(229, 9, 20);
    private static final int SUBTLE_BORDER = Color.rgb(46, 56, 76);
    private final Map<String, WebView> webViews = new HashMap<>();
    private final Adblocker adblocker = new Adblocker();
    /** Die gemeinsame Geschaeftslogik, dieselbe wie am Desktop. Siehe Kern.java. */
    private Kern kern;
    private List<Provider> providers;
    /** Watchlist, Weiterschauen, Mediathek und Verlauf - eine Liste, vier Blicke. */
    private Bestand bestand;
    /** Welche der vier Listen zuletzt offen war. */
    private Bibliothek offeneListe = Bibliothek.WEITERSCHAUEN;
    /** Der Takt, der misst, was gerade laeuft. Siehe Messung.java. */
    private Messung messung;
    /** Woher die Karten ihr Titelbild bekommen. Siehe Titelbild.java. */
    private Titelbild titelbild;
    private String aniworldBildNachreichungSkript;
    private boolean aniworldBildNachreichungLaedt;
    /** Die Runden, in denen der Stand mit anderen Geräten zusammenläuft. */
    private Watchparty watchparty;
    /**
     * Das Mitschauen: Play, Pause und Sprung zwischen den Geraeten. Siehe
     * Mitschauen.java.
     *
     * <p>Getrennt von {@link Watchparty}: die haelt Raeume, Mitglieder und den
     * Fortschritt, dieses hier haengt am Video. Zwei verschiedene Lebensdauern -
     * eine Runde ueberdauert jede Folge, ein Player nicht einmal einen
     * Hosterwechsel.
     */
    private Mitschauen mitschauen;
    /** Blendet aus, was den Player zudeckt. Siehe Kosmetik.java. */
    private Kosmetik kosmetik;
    /**
     * Die kosmetische Werbeentfernung des Fernsehers. Siehe Fernsehwerbung.java.
     *
     * <p>Nur dort: auf dem Telefon filtert weiter, was vorher filterte. Der
     * Fernseher ist der Fall, in dem die uebrigen drei Instanzen eine Luecke
     * lassen - der {@link Werbefilter} laeuft auf einem Stick gar nicht, und
     * die {@link Kosmetik} greift zu spaet und sieht nur, was den Player
     * zudeckt.
     */
    private Fernsehwerbung fernsehwerbung;
    /** Die vollen AdGuard-Regeln, wo das Geraet sie traegt. Siehe Werbefilter.java. */
    private Werbefilter werbefilter;
    private Fassungen fassungen;
    private Rahmen rahmen;
    private Marken marken;
    private Qualitaet qualitaet;
    private Geraete geraete;
    private Aktualisierung aktualisierung;
    /**
     * Die ScrollView der Seite, die gerade steht.
     *
     * <p>Jeder Bildschirm baut sich neu auf und legt dabei eine neue an - die
     * alte samt ihrer Position ist danach weg. Fuer einen Wechsel ist das
     * richtig: eine frisch geoeffnete Liste faengt oben an. Fuer ein
     * Neuzeichnen derselben Liste ist es falsch.
     */
    private ScrollView seitenScroll;
    /** Wie die Liste beim letzten Neuzeichnen aussah - siehe {@link #seitenbild}. */
    private String letztesSeitenbild = "";
    private Provider activeProvider;
    private String currentScreen = "home";
    private String activeFavoriteId;
    private String favoriteProgressMode;
    private LinearLayout appChrome;
    private LinearLayout collapsedChrome;
    private LinearLayout chromeHolder;
    /**
     * Der Live-Streifen der Watchparty und sein Platz.
     *
     * <p>Er haengt bewusst <em>neben</em> der Chrome-Leiste und nicht in ihr:
     * auf dem Fernseher verschwindet die Leiste, sobald die Fernbedienung an
     * die Seite geht, und mit ihr verschwaende sonst genau die Anzeige, an der
     * man sieht, dass gerade drei Leute mitschauen.
     */
    private LinearLayout liveHolder;
    private Livestreifen liveStreifen;
    /**
     * Die Wiedergabeleiste und ihr Platz - "Naechste Folge" und Autoplay.
     *
     * <p>Derselbe Aufbau wie beim Live-Streifen und aus demselben Grund: sie
     * gehoert zum Bild und nicht in die Chrome-Leiste, die auf dem Fernseher
     * verschwindet, sobald die Fernbedienung an die Seite geht. Siehe
     * {@link Spielerleiste}.
     */
    private LinearLayout spielerHolder;
    private Spielerleiste spielerleiste;
    private LinearLayout providerRail;
    private View providerRailScroll;
    private View providerRailDivider;
    private LinearLayout bottomNavHolder;
    private final Map<String, LinearLayout> bottomNavTabs = new java.util.LinkedHashMap<>();
    private TextView browserTitle;
    private ImageView browserFavoriteIcon;
    private FrameLayout content;
    /** Which width bucket the currently built chrome was laid out for. */
    private boolean chromeBuiltCompact;
    private Boolean television;
    private int orientationBeforeFullscreen = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private EditText searchInput;
    private Button favoriteButton;
    private final Map<String, Button> providerButtons = new HashMap<>();
    private boolean chromeCollapsed = false;
    private boolean mouseMode = false;
    private View mouseCursor;
    private float mouseX = -1;
    private float mouseY = -1;
    private final Map<String, Boolean> providerResumeState = new HashMap<>();
    private final Handler cacheCleanupHandler = new Handler(Looper.getMainLooper());
    private int lastConfigOrientation = -1;
    private int lastConfigWidthDp = -1;
    private int lastConfigHeightDp = -1;
    /**
     * Wer den Hauptrahmen bekommt.
     *
     * <p>Stand hier vorher als zwei nackte Felder - eine selbst gewaehlte
     * Adresse und ein Sprungbudget -, und das Budget war der Fehler: es wurde
     * verbraucht, bevor irgendjemand nach dem Ziel gefragt hatte. Die Regel
     * steht jetzt in {@link Navigationswache}, wo sie sich ohne Geraet pruefen
     * laesst; die Begruendung dazu ebenfalls.
     */
    private final Navigationswache wache = new Navigationswache();
    private View loadingOverlay;
    private FrameLayout fullscreenContainer;
    private View fullscreenView;
    private WebView fullscreenHostWebView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    /** Page scroll offset in device pixels, taken the moment fullscreen starts. */
    private int fullscreenScrollX;
    private int fullscreenScrollY;
    /** Set when a page should open its player and go fullscreen on its own once it has loaded. */
    private boolean autoStartRequested;
    private String autoStartUrl;
    private long autoStartArmedAt;
    /**
     * Der gespeicherte Wiedergabestand, an dem der Autostart weitermachen soll.
     *
     * <p>Er reist mit der Anfrage, weil er dort entsteht, wo jemand
     * "Weiterschauen" drueckt - und nicht dort, wo Sekunden spaeter ein Player
     * auftaucht. Null heisst: von vorn.
     */
    private double autoStartStelle;
    /** Die Stelle des gerade laufenden Versuchs - die Anfrage selbst ist dann schon abgeraeumt. */
    private double laufenderStart;
    /**
     * Die Ladephasen des Starts - die Tabelle des geteilten Moduls.
     *
     * <p>Sie sagt, welche Schritte es gibt, wie sie heissen, wie voll der
     * Balken dabei ist und wie lange jeder dauern darf. Siehe Startphasen.java.
     */
    private Startphasen startphasen;
    /**
     * Der Vorhang, hinter dem eine Folge startet.
     *
     * <p>Er liegt vom Tipp auf "Weiterschauen" beziehungsweise "Naechste
     * Folge" bis zu dem Augenblick, in dem das Video im Vollbild wirklich
     * laeuft. Siehe Startvorhang.java.
     */
    private Startvorhang startvorhang;
    /** Woraus der begleitete Start besteht - fuer "Erneut versuchen". */
    private Provider startAnbieter;
    private String startUrl = "";
    private String startTitel = "";
    private double startStelle;
    /** Welcher Eintrag zuletzt gestartet wurde und wann - gegen mehrfaches schnelles Tippen. */
    private String letzterStartEintrag = "";
    private long letzterStartAt;
    /** So lange gilt ein zweiter Tipp auf denselben Eintrag als derselbe Tipp. */
    private static final long START_SPERRE_MS = 2_500L;
    /** How long an unfired autostart request stays valid, and how patient each step of it is. */
    private static final long AUTOSTART_ARM_TTL_MS = 600_000L;
    private static final long AUTOSTART_POLL_MS = 500L;
    private static final long AUTOSTART_HOSTER_TIMEOUT_MS = 60_000L;
    /**
     * Wie oft nachgesehen wird, ob die Fassung inzwischen umgeschaltet hat.
     *
     * <p>Kurz genug, dass niemand es merkt, lang genug, dass die Seite
     * dazwischen wirklich neu aufbauen kann. Die Sperre selbst laeuft nach
     * vier Sekunden von allein ab - haengen kann das hier also nicht.
     */
    private static final long FASSUNG_NACHFASSEN_MS = 250L;
    private static final long AUTOSTART_PLAYER_TIMEOUT_MS = 30_000L;
    /** Breathing room between "the player element exists" and touching it. */
    private static final long AUTOSTART_SETTLE_MS = 4_000L;
    /**
     * Wie lange der Vorhang nach dem Vollbild noch liegen bleibt.
     *
     * <p>Lang genug, dass der Vollbildrahmen ein Bild gezeichnet hat, kurz
     * genug, dass es niemand als Warten empfindet. Ohne ihn geht der Vorhang
     * auf einen noch schwarzen Rahmen auf.
     */
    private static final long VOLLBILD_NACHLAUF_MS = 450L;
    private static final long AUTOSTART_EMBEDDED_TIMEOUT_MS = 12_000L;
    /**
     * Finds the player: the largest iframe on the page, or -- when the hoster's own page became the
     * page -- its video element. Returns an empty string while there is nothing yet, which is what
     * awaitPage() polls on.
     */
    private static final String PLAYER_PROBE_JS =
        "(function(){"
            + "function big(el){var r=el.getBoundingClientRect();return r.width>200&&r.height>150;}"
            + "function largest(sel){var out=Array.prototype.slice.call(document.querySelectorAll(sel))"
                + ".filter(big).sort(function(a,b){var ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();"
                + "return rb.width*rb.height-ra.width*ra.height;});return out[0]||null;}"
            + "var target=largest('iframe')||largest('video');"
            + "if(!target)return '';"
            + "target.scrollIntoView({block:'center'});"
            + "return 'ready';"
        + "})();";
    /** Last provider page that was an episode, kept because playing takes the frame off it. */
    private String lastEpisodeUrl;
    /**
     * Der Weg zur naechsten Folge - ueber die geteilte Regel. Siehe {@link Folgen}.
     */
    private Folgen folgen;
    /**
     * Was die Anbieterseite ueber die laufende Staffel gesagt hat.
     *
     * <p>Gemerkt, weil "Video oeffnen" auf dem Telefon den Hauptrahmen nimmt:
     * danach steht dort der Hoster, und {@link Titelbild} liest dessen Seite.
     * Die Auskunft der Folgenseite - wo die Staffel aufhoert und welche Folgen
     * gar nicht spielbar sind - waere damit weg, und genau an ihr haengt der
     * Staffeluebergang.
     */
    private JSONObject folgenAngaben = new JSONObject();
    private String folgenAngabenUrl = "";
    /**
     * Seit wann ein Folgenwechsel laeuft - gegen zweifaches Tippen und doppelte Takte.
     *
     * <p>Ein Zeitpunkt und kein Schalter: die Sperre faellt normalerweise mit
     * dem Seitenanfang der neuen Folge, aber eine Navigation, die nie
     * ankommt - eine gesperrte Werbeweiterleitung, ein Anbieter ohne Antwort -,
     * liesse einen Schalter fuer immer stehen, und danach taete der Knopf
     * nichts mehr. Dieselbe Ueberlegung wie bei {@code START_SPERRE_MS}.
     */
    private long folgenwechselSeit;
    /** So lange gilt ein angefangener Folgenwechsel als noch im Gange. */
    private static final long FOLGENWECHSEL_SPERRE_MS = 30_000L;
    /** Fuer welche Adresse zuletzt gefragt wurde, ob dort ueberhaupt etwas laeuft. */
    private String abspielseiteFuer = "";
    private boolean abspielseite;
    /**
     * Wann zuletzt nach der naechsten Folge gefragt wurde - und fuer welche Seite.
     *
     * <p>Der Messtakt meldet sich je Rahmen mit Video, also mehrfach je Takt.
     * Ohne diese Bremse gingen daraus mehrere Anfragen an den Kern hinaus, die
     * alle dieselbe Antwort haetten.
     */
    private String zielSucheFuer = "";
    private long zielSucheAt;
    private static final long ZIELSUCHE_RUHE_MS = 2_000L;
    /** Der Folgenlink der Seite, wie ihn der Messtakt gelesen hat - und wozu er gehoert. */
    private String seitenLink = "";
    private String seitenLinkZu = "";
    /** Das zuletzt protokollierte Ziel - damit im Protokoll nur Aenderungen stehen. */
    private String letztesZiel = "";
    /**
     * Die Empfehlungen der Startseite.
     *
     * <p>Gerechnet werden sie im Kern, von demselben Modul wie am Rechner.
     * Siehe {@link Empfehlungen}.
     */
    private Empfehlungen empfehlungen;
    /**
     * Die gemessene Wiedergabezeit.
     *
     * <p>Bis hierher hat die App keine einzige Sekunde aufgezeichnet - siehe
     * {@link Statistik}. Ohne sie kann ein Rueckblick nichts sagen ausser Null,
     * und Null sieht aus wie eine Aussage.
     */
    private Statistik statistik;
    /** Was diese Woche bei den Anbietern erscheint. Siehe {@link Kalender}. */
    private Kalender kalender;
    /** Welche Reihen die Startseite zeigt. Siehe {@link Startseite}. */
    private Startseite startseite;
    /** Woran ein YouTube-Eintrag zu erkennen ist. Siehe {@link Youtube}. */
    private Youtube youtube;
    /**
     * Was der Pruefstand aus dieser App sieht.
     *
     * <p>Als Feld und nicht als anonymes Objekt im Aufruf: beim Abbauen muss
     * feststellbar sein, ob der Pruefstand ueberhaupt an <em>dieser</em> App
     * haengt. Beim Neuaufbau leben zwei Activities kurz nebeneinander.
     */
    private Pruefumgebung pruefumgebung;
    /** Welcher Wochentag im Kalender offen ist. */
    private String kalenderTag = "";
    private String kalenderDatumText = "";
    /** Welcher Zeitraum im Rueckblick gewaehlt ist. */
    private String rueckblickZeitraum = "alles";
    /** Der Jahresrueckblick: die gebauten Karten, die offene und ihr Platz. */
    private List<View> wrappedSeiten = new ArrayList<>();
    private int wrappedStelle;
    private int wrappedJahr;
    private LinearLayout wrappedPlatz;
    /** So viele Titel wechseln sich im Titelhintergrund ab - wie am Rechner. */
    private static final int HERO_ANZAHL = 5;
    /** Und so lange steht jeder. */
    private static final long HERO_TAKT_MS = 15_000L;
    /** So viele Karten holt eine Entdeckungsseite je Stapel. */
    private static final int ENTDECKUNG_STAPEL = 30;
    private List<Favorite> heroEintraege = new ArrayList<>();
    private int heroStelle;
    /**
     * Ob gerade ein Bedienelement des Titelhintergrunds den Fokus hat.
     *
     * <p>Solange das so ist, steht der Wechsel still. Ein Titelbild, das unter
     * der Fernbedienung weiterspringt, ist nicht zu bedienen: man drueckt OK
     * auf dem, was man gesehen hat, und bekommt das, was inzwischen dasteht.
     */
    private boolean heroFokus;
    /**
     * Der Fokus, an dem der Fernseher zuletzt stand - je Seite einer.
     *
     * <p>Je Seite und nicht einer fuer alles: wer aus der Entdeckungsseite auf
     * die Startseite zurueckkommt, will dort stehen, wo er die Startseite
     * verlassen hat, und nicht dort, wo er in der Entdeckungsseite war. Ein
     * einziger Merker koennte das nicht unterscheiden und faende auf der
     * anderen Seite ohnehin nichts.
     */
    private final Map<String, String> tvFokusJeSeite = new HashMap<>();
    /**
     * Die waagerechten Reihen der TV-Startseite und ihr Stand.
     *
     * <p>Sie halten mehr Eintraege, als sie zeigen. Der Rest kommt, wenn der
     * Fokus sich dem Ende naehert - siehe {@link #tvNachlegen}. Beim Neuaufbau
     * der Seite ist der Inhalt hinfaellig, deshalb wird die Karte dort geleert.
     */
    private final Map<String, TvReihe> tvReihen = new java.util.LinkedHashMap<>();
    /** Wieviele Kacheln eine TV-Reihe zuerst zeigt. */
    private static final int TV_REIHE_ERST = 8;
    /** Und wieviele bei jedem Nachlegen dazukommen. */
    private static final int TV_REIHE_SCHRITT = 6;
    /** Wie nah der Fokus ans Ende kommen darf, bevor nachgelegt wird. */
    private static final int TV_REIHE_VORLAUF = 3;

    /** Was eine Kachel an ihrer Stelle baut. */
    private interface TvKartenBauer {
        View baue(int stelle);
    }

    /** Eine waagerechte Reihe auf dem Fernseher: was sie zeigt und was sie noch haette. */
    private static final class TvReihe {
        android.widget.HorizontalScrollView ansicht;
        int vorrat;
        int gezeigt;
        TvKartenBauer bauer;
    }
    /**
     * Der Taktgeber der gebauten Seiten.
     *
     * <p>Zwei Dinge haengen daran: der Titelhintergrund, der alle fuenfzehn
     * Sekunden weiterwechselt, und der Nachschlag der Entdeckungsseite, wenn
     * der Katalog gerade waechst. Beides sind verzoegerte Laeufe an einer
     * Seite, die auch verschwinden kann - deshalb derselbe Taktgeber, der beim
     * Verlassen der App in einem Zug geleert wird.
     */
    private final Handler takt = new Handler(Looper.getMainLooper());
    /** Wo der Titelhintergrund steckt - er wird fuer sich neu gezeichnet, nicht die Seite. */
    private FrameLayout heroPlatz;
    /** Und wo die Karte "wer schaut mit" steckt - aus demselben Grund. */
    private FrameLayout mitschauPlatz;
    /**
     * Der Sekundentakt der Kacheln in "Gemeinsam weiterschauen".
     *
     * <p>Ein eigener Taktgeber und nicht {@link #takt}: der wird an mehreren
     * Stellen in einem Zug geleert, und die Kacheln haben mit dem
     * Titelhintergrund nichts zu tun.
     */
    private final Handler liveTakt = new Handler(Looper.getMainLooper());
    /**
     * Die Kacheln, deren Stand aus einer Runde kommt.
     *
     * <p>Sie werden im Sekundentakt in Ort nachgezogen - Zeile, Zeit und
     * Balken -, statt die Startseite neu zu bauen. Am Rechner steht dafuer
     * {@code aktualisiereLiveKarten}, und der Grund ist derselbe: eine Seite,
     * die jede Sekunde neu entsteht, springt beim Blaettern und nimmt dem
     * Fernseher den Fokus.
     */
    private final List<LiveKachel> liveKacheln = new ArrayList<>();
    /** Welche Titel zuletzt in den Raeumen standen - siehe {@link #watchpartyGeaendert()}. */
    private String watchpartyEintragsStand = "";
    /**
     * Woher die offene Anbieterseite geoeffnet wurde.
     *
     * <p>Nur fuer den Weg zurueck: wer eine Folge aus der Watchparty oeffnet,
     * will beim Zurueckgehen wieder dort landen und nicht auf der Startseite.
     */
    private String providerHerkunft = "";
    /**
     * Ein Titel, der an einen Raum gebunden werden soll, sobald es ihn lokal gibt.
     *
     * <p>{@code [schluessel, raum]}. Beim Oeffnen aus der Watchparty liegt
     * oft noch kein eigener Eintrag vor - er entsteht erst, wenn wirklich
     * etwas laeuft.
     */
    private String[] offeneRaumbindung;
    private LinearLayout heroPunkte;

    /**
     * Was eine Entdeckungsseite ueber ihren Stand weiss.
     *
     * <p>Sie ueberdauert das Verlassen der Ansicht: wer einen Titel oeffnet und
     * zurueckkommt, steht wieder dort, wo er war.
     */
    private static final class Entdeckung {
        final List<JSONObject> eintraege = new ArrayList<>();
        final java.util.Set<String> gesehen = new java.util.HashSet<>();
        int versatz;
        boolean laeuft;
        boolean fertig;
        boolean waechst;
        String fehler = "";
        int scroll;
        int versuche;
    }

    private final Map<String, Entdeckung> entdeckungen = new HashMap<>();
    private String entdeckungArt = "";
    private Bilder.Sichtfenster entdeckungBilder;
    private LinearLayout entdeckungRaster;
    private LinearLayout entdeckungFuss;

    private final Runnable cacheCleanupTask = new Runnable() {
        @Override
        public void run() {
            clearBrowserCachesPreservingLogin();
            cacheCleanupHandler.postDelayed(this, CACHE_CLEANUP_INTERVAL_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        CrashReporter.install(this);
        Log.i(TAG, "Elflix start\n" + CrashReporter.environment(this));
        String previousCrash = CrashReporter.readLastCrash(this);
        if (previousCrash != null) {
            Log.e(TAG, "Previous run crashed. Report:\n" + previousCrash);
        }
        WebView.setWebContentsDebuggingEnabled(false);
        Adblocker.loadAdGuardList(this);
        // Sind die Listen aelter als eine Woche, im Hintergrund nachladen. Das
        // stoert nichts: bis der Abruf durch ist, filtert der bisherige Stand
        // weiter.
        if (Filterlisten.faellig(this)) {
            Filterlisten.aktualisieren(this, (anzahl, fehler) -> {
                if (fehler != null) {
                    Log.w(TAG, "Filterlisten nicht erneuert: " + fehler);
                    return;
                }
                Log.i(TAG, "Filterlisten erneuert: " + anzahl + " Domains");
                // Die vollen Regeln haengen am Rohtext derselben Listen. Nach
                // dem ersten Abruf ist ueberhaupt erst einer da - ohne diese
                // Zeile stuende die Engine bis zum naechsten Start still.
                if (werbefilter != null) werbefilter.neuBauen();
            });
        }
        providers = ProviderStore.load(this);
        startseite = new Startseite(this);
        favoriteProgressMode = getSharedPreferences("elflix_settings", MODE_PRIVATE)
            .getString("favorite_progress_mode", "sequential");
        activeProvider = null;
        kern = new Kern(this, this::kernEreignis);
        kern.starten();
        kern.wennBereit(this::kernSelbsttest);
        bestand = new Bestand(this, kern, this::bestandGeaendert, this::showToast);
        bestand.laden();
        // Der Weg in die Rahmen muss stehen, *bevor* ihn jemand bekommt.
        //
        // Er wurde bis hierher erst weiter unten angelegt, neben Marken und
        // Mitschauen - die beiden bekamen ihn damit richtig. Die Messung nicht:
        // ihr `setzeRahmen` steht ein paar Zeilen nach dieser Stelle und reichte
        // das noch leere Feld weiter. Ein Feld, das spaeter belegt wird, ist
        // beim Weitergeben trotzdem null, und der Fehler ist lautlos: die
        // Messung fragt dann nur noch das Hauptdokument. Bei diesen Anbietern
        // liegt das Video aber immer in einem Rahmen, also sah sie nie eines,
        // buchte nie einen Fortschritt, und Weiterschauen konnte nichts finden.
        rahmen = new Rahmen(this::rahmenMeldung);
        messung = new Messung(kern, bestand, new Messung.Seite() {
            @Override
            public Provider anbieter() {
                return activeProvider;
            }

            @Override
            public WebView ansicht() {
                return activeProvider == null ? null : webViews.get(activeProvider.id);
            }

            /**
             * Welche Seite gerade laeuft - aus Sicht des Fortschritts.
             *
             * <p>Nicht immer die, die im Rahmen steht. Am Rechner liegt der
             * Hoster in einem eingebetteten Rahmen, und die Adresse der
             * Anbieterseite bleibt stehen. Auf dem Telefon nimmt "Video
             * oeffnen" den Hauptrahmen: danach steht dort vidmoly.biz, und die
             * Fortschrittsregel erkennt das zu Recht nicht als Folge - sie
             * verwarf jeden gemessenen Stand, und "Weiterschauen" blieb auf
             * einem Telefon fuer immer leer.
             *
             * <p>Deshalb zaehlt hier die letzte Folgenseite, sobald die
             * laufende Adresse dem Anbieter gar nicht mehr gehoert. Nur dann:
             * wer beim Anbieter selbst weiterblaettert, soll seinen wirklichen
             * Ort melden und nicht eine Folge, die er verlassen hat.
             */
            @Override
            public String adresse() {
                return laufendeFolgenAdresse(ansicht());
            }

            @Override
            public boolean watchpartyFuehrt() {
                // Laeuft diese Folge in einer Runde mit, gibt die Runde sie
                // vor: ein Ruecksprung ist dann gewollt, und der eigene
                // Eintrag zieht sofort mit. Dieselbe Frage, die der Rechner
                // mit watchpartyGibtFolgeVor beantwortet - sie stand hier auf
                // "nein", solange es auf Android kein Live-Mitschauen gab.
                return mitschauen != null && mitschauen.laeuftMit();
            }
        });
        messung.setzeRahmen(rahmen);
        titelbild = new Titelbild(kern, bestand);
        messung.setzeTitelbild(titelbild);
        // Der Weg zur naechsten Folge - dieselbe Regel wie am Rechner.
        folgen = new Folgen(kern);
        // Und die Ladephasen, mit denen ein Start begleitet wird. Die Tabelle
        // kommt aus dem geteilten Modul; ohne sie gibt es keinen Vorhang und
        // der Start laeuft wie vorher.
        startphasen = new Startphasen(kern);
        startphasen.vorbereiten();
        startvorhang = new Startvorhang(this, startphasen, new Startvorhang.Umgebung() {
            @Override
            public void erneutVersuchen() {
                startErneutVersuchen();
            }

            @Override
            public void aufgeben(String grund) {
                startAufgeben(grund);
            }

            @Override
            public boolean fernseher() {
                return isTelevision();
            }
        });
        // Und der Draht dorthin: derselbe Messtakt, der den Fortschritt bucht,
        // sagt auch, ob die Folge zu Ende ist. Ein zweiter Takt daneben waere
        // eine zweite Uhr - siehe Messung.Spielstand.
        messung.setzeSpielstand(this::spielstandGemessen);
        watchparty = new Watchparty(this, kern, new Watchparty.Beobachter() {
            @Override
            public void watchpartyGeaendert() {
                MainActivity.this.watchpartyGeaendert();
            }

            @Override
            public void watchpartyStandGeaendert() {
                MainActivity.this.mitschauStandGeaendert();
            }
        });
        geraete = new Geraete(this, kern, bestand, watchparty, zustand -> {
            // Steht die Seite gerade offen, zeigt sie den neuen Stand sofort.
            if ("settings".equals(currentScreen)) showSettings();
        });
        bestand.setzeStandMelder(watchparty::standMelden);
        watchparty.setzeBestand(bestand);
        // Die Empfehlungen brauchen die Relay-Adresse: dieselbe Maschine wie
        // die Watchparty, nur das andere Protokoll - deshalb erst hier, nach
        // dem Anlegen der Watchparty.
        empfehlungen = new Empfehlungen(this, kern, this::empfehlungenGeaendert);
        // Erst was von der Platte kommt, dann der Lauf. Andersherum stuenden
        // bei einem Start ohne Netz alle Vorschlagsreihen als Fehlermeldung da,
        // obwohl sie beim letzten Start vorlagen.
        empfehlungen.vorladen();
        empfehlungen.vorbereiten(watchparty.serverUrl());
        statistik = new Statistik(this, kern);
        bestand.setzeSitzungsmelder((provider, url, eintrag, fortschritt) ->
            statistik.melden(provider, url, eintrag, fortschritt));
        // Die Leitung, die gefehlt hat. Ohne sie kannte der Geraeteabgleich nur
        // die Sitzungsliste vom Start der App: was an diesem Abend gemessen
        // wurde, ging nie hinaus, und was von einem anderen Geraet hereinkam,
        // landete in der Datei, waehrend das laufende Statistik-Objekt seine
        // alte Liste behielt. Der Rueckblick zeigte deshalb je Geraet eine
        // eigene Bilanz statt der gemeinsamen.
        geraete.setzeStatistik(statistik);
        statistik.setzeBeobachter(new Statistik.Beobachter() {
            @Override
            public void sitzungenGespeichert() {
                geraete.sitzungenGemeldet();
            }

            @Override
            public void sitzungenUebernommen() {
                // Steht eine Bilanz gerade offen, rechnet sie sofort neu -
                // ohne App-Neustart. Die Auswertung selbst liest ohnehin bei
                // jedem Aufruf frisch aus der Statistik.
                statistikGeaendert();
            }
        });
        kalender = new Kalender(this, kern, this::kalenderGeaendert);
        kalender.vorladen();
        youtube = new Youtube(kern);
        kosmetik = new Kosmetik(kern, adblocker);
        // Braucht weder Kern noch Netz: die Regeln stehen in der Klasse, und
        // das Skript muss beim ersten Dokument schon dasein - auf den Kern zu
        // warten hiesse, die erste Anbieterseite ungefiltert zu zeigen.
        fernsehwerbung = new Fernsehwerbung(adblocker, istDebugBau());
        werbefilter = new Werbefilter(this, kern, () -> {
            // Der Aufbau dauert; steht die Seite gerade offen, soll sie es zeigen.
            if ("settings".equals(currentScreen)) showSettings();
        });
        fassungen = new Fassungen(this, kern);
        marken = new Marken(this, kern, rahmen);
        mitschauen = new Mitschauen(kern, rahmen, watchparty, new Mitschauen.Umgebung() {
            @Override
            public WebView spieler() {
                return activeProvider == null ? null : webViews.get(activeProvider.id);
            }

            /**
             * Welche Folge hier offen steht - aus Sicht der Runde.
             *
             * <p>Ausdruecklich dieselbe Antwort wie bei der Messung und nicht
             * einfach {@code getUrl()}. Auf dem Telefon nimmt "Video oeffnen"
             * den Hauptrahmen: danach steht dort vidmoly.biz, und aus Sicht
             * der Watchparty gehoerte diese Seite dann zu gar keiner Runde
             * mehr - kein Raum, kein Schluessel, keine Steuerung. Genau so
             * ging der Watchparty-Kontext beim Player-Wechsel verloren.
             */
            @Override
            public String adresse() {
                String url = laufendeFolgenAdresse(spieler());
                return url == null ? "" : url;
            }

            @Override
            public Provider anbieter() {
                return activeProvider;
            }

            @Override
            public void folgeOeffnen(Provider anbieter, String url) {
                if (anbieter == null || url == null || url.isEmpty()) return;
                Log.i(TAG, "Watchparty oeffnet die neue Folge der Runde: " + safePath(url));
                // Scharfmachen, bevor geoeffnet wird. Ohne das laedt zwar die
                // Folgenseite, aber niemand klickt den Hoster an - und der
                // Gast sitzt vor einer Uebersicht, waehrend die anderen
                // weiterschauen. Derselbe Weg wie beim Oeffnen aus
                // Weiterschauen und aus der Watchparty-Seite; am Rechner
                // uebernimmt das scheduleProviderAutoplay.
                armAutoStart(url);
                // Mit preserveFavoriteProgress: der Eintrag bleibt derselbe,
                // es ist nur eine andere Folge davon.
                openProvider(anbieter, url, true);
            }

            @Override
            public void anzeigeAuffrischen() {
                liveStreifenAuffrischen();
                if ("watchparty".equals(currentScreen)) zeigeWatchparty();
            }

            @Override
            public void hinweisZeigen(String text) {
                showToast(text);
            }

            @Override
            public void steuerungSichtbar(boolean sichtbar) {
                // Weiter an die Teilnehmerleiste. Sie liegt im Vollbild ueber
                // dem Video und soll genau dann dastehen, wenn auch die
                // Bedienelemente des Players dastehen.
                if (liveStreifen != null) liveStreifen.steuerungSichtbar(sichtbar);
                // Und an die Wiedergabeleiste, aus demselben Grund: sie liegt
                // ueber der Bedienleiste des Hosters und gehoert weg, sobald
                // die weg ist.
                if (spielerleiste != null) spielerleiste.steuerungSichtbar(sichtbar);
            }

            @Override
            public void oertlicherStartFertig(boolean laeuft) {
                if (!laeuft) {
                    // Kein Vollbild auf ein stehendes Bild. Der Player ist da,
                    // er startet nur nicht von selbst - dann gehoert das gesagt.
                    // Liegt der Vorhang, gehoert es dorthin: er hat zwei Wege
                    // anzubieten, ein Hinweis nur eine Feststellung.
                    if (startFehler("spieler")) return;
                    showToast("Startet nicht von selbst – bitte einmal Play drücken");
                    return;
                }
                // Jetzt erst. Es laeuft wirklich etwas: der Player hat gemeldet,
                // dass die Stelle weiterwandert.
                if (fullscreenView != null) {
                    // Das Vollbild steht schon - dann fehlt nichts mehr.
                    startPhaseMelden("laeuft");
                    return;
                }
                WebView ansicht = currentWebView();
                if (ansicht == null) return;
                Log.i(TAG, "Oertlicher Start gelungen - Vollbild");
                startPhaseMelden("vollbild");
                handleRemoteShortcut(KeyEvent.KEYCODE_5);
            }

            /**
             * Eine Zwischenmeldung des Startskripts.
             *
             * <p>Aus der Sprache des Players in die des Ladebalkens: dass die
             * Quelle da ist, heisst nur dann "zur gespeicherten Stelle", wenn
             * es ueberhaupt eine gibt. Sonst bleibt es beim Vorbereiten - die
             * Phase gibt es in diesem Lauf gar nicht.
             */
            @Override
            public void startPhase(String name) {
                if ("quelle".equals(name)) {
                    startPhaseMelden(startStelle > 0 ? "stelle" : "spieler");
                    return;
                }
                startPhaseMelden(name);
            }
        });
        watchparty.setzeMitschauen(mitschauen);
        // Damit die Bruecke einem Eintrag der Runde einen Anbieter zuordnen
        // kann - dieselbe Frage, die der Rechner mit providerForWatchpartyUrl
        // beantwortet.
        watchparty.setzeAnbieter(providers);
        qualitaet = new Qualitaet(kern, rahmen);
        if (!Rahmen.verfuegbar()) {
            // Aeltere WebViews kennen den Weg in die Rahmen nicht. Die App
            // laeuft dann wie zuvor - nur ohne Intromarke und ohne
            // Qualitaetswahl, und die Messung sieht nur das Hauptdokument.
            Log.w(TAG, "WebView ohne Rahmenzugriff - Player-Skripte bleiben aus");
        }
        kern.wennBereit(() -> {
            youtube.vorbereiten();
            messung.starten();
            watchparty.anwenden();
            kosmetik.vorbereiten();
            werbefilter.vorbereiten();
            fassungen.vorbereiten();
            marken.vorbereiten();
            mitschauen.vorbereiten();
            qualitaet.vorbereiten();
            geraete.vorbereiten();
            geraete.netzBeobachten();
            // Die erste Anbieterseite ist oft schon fertig, bevor der Kern
            // steht - sie bekommt das Suchskript deshalb hier nachgereicht.
            if (activeProvider != null) {
                kosmetik.einspielen(webViews.get(activeProvider.id), activeProvider);
            }
        });
        // Sich selbst auf den neuesten Stand bringen. Haengt an keinem Kern und
        // an keinem Anbieter - nur an der Leitung.
        aktualisierung = new Aktualisierung(this, () -> {
            if ("settings".equals(currentScreen)) showSettings();
        });
        aktualisierung.setzeFrager(this::neueFassungAnbieten);
        aktualisierung.nachsehen(false);
        buildRoot();
        clearBrowserCachesPreservingLogin();
        cacheCleanupHandler.postDelayed(cacheCleanupTask, CACHE_CLEANUP_INTERVAL_MS);
        Configuration config = getResources().getConfiguration();
        lastConfigOrientation = config.orientation;
        lastConfigWidthDp = config.screenWidthDp;
        lastConfigHeightDp = config.screenHeightDp;
        showHome();
        deepLinkOeffnen(getIntent());
        // Der Pruefstand. Im Release ist das ein leerer Aufruf: dort uebersetzt
        // Gradle die Fassung aus src/release/java, und die tut nichts.
        pruefumgebung = new Pruefumgebung() {
            @Override
            public Provider anbieter(String id) {
                return providerMitId(id);
            }

            @Override
            public Messung messung() {
                return messung;
            }

            @Override
            public Bestand bestand() {
                return bestand;
            }

            @Override
            public Statistik statistik() {
                return statistik;
            }

            @Override
            public void neuZeichnen() {
                if ("home".equals(currentScreen)) seiteNeuZeichnen();
            }
        };
        Pruefstand.einrichten(this, pruefumgebung);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Never touch the view tree while a video overlay is up: removing it would destroy the
        // surface the video renders into. Entering fullscreen deliberately triggers a rotation, so
        // this callback runs in the middle of that.
        if (fullscreenView != null) {
            return;
        }
        lastConfigOrientation = newConfig.orientation;
        lastConfigWidthDp = newConfig.screenWidthDp;
        lastConfigHeightDp = newConfig.screenHeightDp;
        // Only the chrome depends on the width bucket, and only it gets rebuilt. `content` and the
        // provider WebViews inside it are never detached, so rotating cannot reload a page, drop a
        // session or interrupt playback.
        if (isCompactWidth() != chromeBuiltCompact) {
            buildChrome();
            updateFavoriteButton();
        }
        // Die gebauten Seiten rechnen ihre Masse aus der Breite: wie viele
        // Anbieter in eine Zeile passen, wie breit eine Kachel ist, wie hoch
        // der Titelhintergrund sein darf, wie viele Spalten das Raster hat.
        // Nach dem Drehen stimmt davon nichts mehr, und die Reihen liefen quer
        // ueber den Bildschirmrand hinaus.
        //
        // Neu geholt wird dabei nichts: die Empfehlungsreihen liegen in
        // {@link Empfehlungen}, die Entdeckungsseite fuehrt ihre Liste selbst,
        // und die Ablage steht ohnehin im Speicher. Der Anbieterbildschirm ist
        // ausgenommen - dort haengt ein WebView im Inhalt, und den abzureissen
        // hiesse die Seite neu zu laden und die Wiedergabe abzubrechen. Die
        // Suche ebenfalls: sie ist eine senkrechte Liste ueber die ganze
        // Breite und braucht keinen Neuaufbau - er wuerde die Abfrage bei allen
        // Anbietern ein zweites Mal losschicken.
        if (!"provider".equals(currentScreen)) seiteNeuZeichnen();
    }

    /**
     * Den gerade offenen Bildschirm noch einmal bauen - an derselben Stelle.
     *
     * <p>Gebraucht beim Drehen. Die Scrollposition wird gerettet, weil ein
     * Neuaufbau eine neue ScrollView anlegt und die alte samt Position weg ist.
     */
    private void seiteNeuZeichnen() {
        int stand = seitenScroll == null ? 0 : seitenScroll.getScrollY();
        switch (currentScreen == null ? "" : currentScreen) {
            case "home":
                showHome();
                break;
            case "favorites":
                showFavorites();
                break;
            case "entdeckung":
                zeigeEntdeckung(entdeckungArt);
                // Die Entdeckungsseite stellt ihre Position selbst wieder her,
                // sobald sie vermessen ist - der gerettete Wert gilt fuer die
                // alte Spaltenzahl und waere hier falsch.
                return;
            case "settings":
                showSettings();
                break;
            case "watchparty":
                zeigeWatchparty();
                break;
            default:
                return;
        }
        scrollStandHerstellen(stand);
    }

    /**
     * Builds the parts that must survive for the lifetime of the Activity: the root, the window
     * inset handling and the content frame that hosts the provider WebViews. Only the chrome above
     * it is rebuilt on configuration changes, so rotating never detaches a WebView and therefore
     * never reloads a page or interrupts playback.
     */
    private void buildRoot() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Theme.BACKGROUND);
        setContentView(root);

        chromeHolder = new LinearLayout(this);
        chromeHolder.setOrientation(LinearLayout.VERTICAL);
        root.addView(chromeHolder, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        liveHolder = new LinearLayout(this);
        liveHolder.setOrientation(LinearLayout.VERTICAL);
        root.addView(liveHolder, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // Die Wiedergabeleiste sitzt zwischen Streifen und Bild: ausserhalb des
        // Vollbilds verdeckt sie damit nichts, im Vollbild zieht sie um.
        spielerHolder = new LinearLayout(this);
        spielerHolder.setOrientation(LinearLayout.VERTICAL);
        root.addView(spielerHolder, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        // Phone-only bottom navigation. Kept outside `content` so it never overlaps page content and
        // so the navigation-bar inset can be absorbed by the bar itself rather than by the WebView.
        bottomNavHolder = new LinearLayout(this);
        bottomNavHolder.setOrientation(LinearLayout.VERTICAL);
        root.addView(bottomNavHolder, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // targetSdk 35 draws edge-to-edge, so the chrome would sit underneath the status bar and
        // the content underneath the navigation bar unless the real inset sizes are applied here.
        // Never hardcode bar heights -- cutouts and gesture navigation differ per device.
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int top;
            int bottom;
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                top = bars.top;
                bottom = bars.bottom;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
            }
            // Entering fullscreen hides the system bars, which collapses these insets to 0, and
            // leaving it brings them back. Applying that would re-pad `content` twice per fullscreen
            // cycle and resize the WebView with it -- and a scrolled WebView that gets resized comes
            // back at a slightly different offset, which is the page creeping upwards with every
            // open/close. The video does not need it: it renders in its own container on the window
            // decor. So the page layout is frozen at the values it had before fullscreen started.
            if (fullscreenView != null) {
                Log.i(TAG, "FS/insets ignored while fullscreen top=" + top + " bottom=" + bottom);
                return insets;
            }
            chromeHolder.setPadding(0, top, 0, 0);
            if (isTelevision()) {
                content.setPadding(0, 0, 0, bottom);
            } else {
                // The gesture bar sits under the bottom navigation, so the bar grows to cover it and
                // its touch targets stay clear of the system gesture area.
                content.setPadding(0, 0, 0, 0);
                bottomNavHolder.setPadding(0, 0, 0, bottom);
            }
            return insets;
        });

        buildChrome();
        buildLiveStreifen();
        buildSpielerleiste();
        buildBottomNav();
        // Einmal je Sitzung: der Merker, der den Fokus ueber einen Neuaufbau
        // hinwegtraegt. Er haengt am content, nicht an einer gebauten Seite.
        tvFokusBeobachten();
    }

    /**
     * Den Live-Streifen der Watchparty anlegen.
     *
     * <p>Einmal je Sitzung und nicht je Seite: er haelt seinen eigenen Takt,
     * und ein Neuaufbau naehme dem Fernseher jede Sekunde den Fokus.
     */
    private void buildLiveStreifen() {
        if (liveStreifen != null || liveHolder == null) return;
        liveStreifen = new Livestreifen(this, new Livestreifen.Umgebung() {
            @Override
            public Watchparty watchparty() {
                return watchparty;
            }

            @Override
            public Mitschauen mitschauen() {
                return mitschauen;
            }

            @Override
            public boolean amSchauen() {
                return activeProvider != null && "provider".equals(currentScreen);
            }

            @Override
            public boolean fernseher() {
                return isTelevision();
            }

            @Override
            public void hinweis(String text) {
                showToast(text);
            }
        });
        liveStreifen.setzeZuhause(liveHolder);
        liveHolder.addView(liveStreifen.ansicht(), new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    /**
     * Die Wiedergabeleiste anlegen.
     *
     * <p>Einmal je Sitzung, wie der Live-Streifen: sie haelt ihren eigenen
     * Zustand (Ziel, Sichtbarkeit, Fokus), und ein Neuaufbau beim Drehen naehme
     * dem Fernseher den Platz, an dem die Fernbedienung gerade steht.
     */
    private void buildSpielerleiste() {
        if (spielerleiste != null || spielerHolder == null) return;
        spielerleiste = new Spielerleiste(this, new Spielerleiste.Umgebung() {
            @Override
            public boolean fernseher() {
                return isTelevision();
            }

            @Override
            public void naechsteFolge(boolean vonHand) {
                naechsteFolgeStarten(vonHand ? "Knopf" : "Zähler", vonHand);
            }

            @Override
            public void autoplaySetzen(boolean an) {
                MainActivity.this.autoplaySetzen(an);
            }

            @Override
            public boolean autoplayAn() {
                return Folgen.autoplayAn(MainActivity.this);
            }

            @Override
            public boolean zaehlerErlaubt() {
                // Folgt dieses Geraet gerade der Runde, entscheidet die Runde.
                // Ein eigener Wechsel daneben waere ein zweiter, und die Folgen
                // liefen auseinander. Der Knopf bleibt trotzdem stehen.
                if (mitschauen != null && mitschauen.folgtDerRunde()) return false;
                // Und nicht, waehrend ohnehin schon eine Folge geladen wird.
                return !folgenwechselLaeuft();
            }
        });
        spielerleiste.setzeZuhause(spielerHolder);
        // Zwei Ansichten, weil es zwei Bedienelemente mit zwei Regeln sind:
        // der Schalter oben, die Leiste darunter. Siehe Spielerleiste.
        spielerHolder.addView(spielerleiste.autoplayAnsicht(), new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        spielerHolder.addView(spielerleiste.ansicht(), new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    /** Den Schalter umlegen - von der Fernbedienung und aus den Einstellungen. */
    private void autoplayUmschalten() {
        autoplaySetzen(!Folgen.autoplayAn(this));
    }

    /**
     * Den Autoplay-Schalter setzen.
     *
     * <p>Die eine Stelle dafuer: Leiste, Fernbedienung und Einstellungen legen
     * denselben Schalter um, und alle drei sollen danach dasselbe zeigen.
     */
    private void autoplaySetzen(boolean an) {
        Folgen.setzeAutoplayAn(this, an);
        Log.i(TAG, "Autoplay " + (an ? "an" : "aus"));
        showToast(an
            ? "Nächste Folge startet von selbst"
            : "Nächste Folge startet nicht mehr von selbst");
        // Ein neu gesetzter Schalter gilt sofort - auch fuer die Folge, die
        // gerade laeuft: aus haelt einen laufenden Zaehler an, an laesst ihn am
        // Ende wieder anfangen. Dasselbe tut der Rechner, wenn der Schalter in
        // der Seite umgelegt wird.
        if (spielerleiste != null) spielerleiste.autoplayAuffrischen();
        if ("settings".equals(currentScreen)) showSettings();
    }

    /**
     * Den Streifen nachziehen lassen - sofort, ohne auf den Sekundentakt zu warten.
     *
     * <p>Gerufen bei jedem Anlass, der etwas geaendert haben kann: eine
     * Standmeldung, ein Steuerbefehl, ein Seitenwechsel, ein Raumwechsel.
     * Dieselbe Ueberlegung wie bei {@code pushWatchpartyLiveState} am Rechner -
     * eine Anzeige, die erst beim naechsten Takt nachzieht, hinkt sichtbar
     * hinterher.
     */
    private void liveStreifenAuffrischen() {
        if (liveStreifen == null) return;
        // Der Takt laeuft, solange ueberhaupt ein Anbieter offen ist. Ob der
        // Streifen dabei sichtbar ist, entscheidet er selbst - ueber
        // {@code amSchauen()} und darueber, ob diese Folge in einer Runde
        // mitlaeuft. Ein Takt, der auf der Startseite weiterliefe, kostete
        // Strom fuer nichts; einer, der bei jedem Seitenwechsel neu anlaufen
        // muesste, liesse den Streifen eine Sekunde zu spaet erscheinen.
        liveStreifen.starten(activeProvider != null);
        liveStreifen.auffrischen();
    }

    private void buildChrome() {
        chromeHolder.removeAllViews();
        chromeBuiltCompact = isCompactWidth();
        if (isTelevision()) {
            buildTvChrome();
        } else {
            buildMobileChrome();
        }
        setChromeCollapsed(chromeCollapsed, false);
    }

    /**
     * Phone chrome: a fixed-height app bar for the tab screens and a compact browser bar for the
     * provider view. Both are single rows that always fit -- nothing here scrolls horizontally.
     * `appChrome`/`collapsedChrome` keep their existing roles so setChromeCollapsed() still drives
     * which one is showing.
     */
    private void buildMobileChrome() {
        int barHeight = 58;

        appChrome = new LinearLayout(this);
        appChrome.setOrientation(LinearLayout.HORIZONTAL);
        appChrome.setGravity(Gravity.CENTER_VERTICAL);
        appChrome.setBackgroundColor(Theme.BACKGROUND);
        appChrome.setPadding(dp(MobileViews.SCREEN_PADDING), 0, dp(MobileViews.SCREEN_PADDING - 8), 0);
        chromeHolder.addView(appChrome, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(barHeight)));

        WebView logo = brandLogoView();
        appChrome.addView(logo, new LinearLayout.LayoutParams(dp(96), dp(30)));
        appChrome.addView(new View(this), new LinearLayout.LayoutParams(0, 1, 1));
        appChrome.addView(MobileViews.iconButton(this, R.drawable.ic_nav_search,
            () -> showGlobalSearch("")), new LinearLayout.LayoutParams(dp(MobileViews.TOUCH_TARGET), dp(MobileViews.TOUCH_TARGET)));

        collapsedChrome = new LinearLayout(this);
        collapsedChrome.setOrientation(LinearLayout.HORIZONTAL);
        collapsedChrome.setGravity(Gravity.CENTER_VERTICAL);
        collapsedChrome.setBackgroundColor(Theme.SURFACE);
        collapsedChrome.setPadding(dp(4), 0, dp(4), 0);
        collapsedChrome.setVisibility(View.GONE);
        chromeHolder.addView(collapsedChrome, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(barHeight)));

        collapsedChrome.addView(MobileViews.iconButton(this, R.drawable.ic_arrow_back, this::goBackInProvider),
            new LinearLayout.LayoutParams(dp(MobileViews.TOUCH_TARGET), dp(MobileViews.TOUCH_TARGET)));

        browserTitle = new TextView(this);
        browserTitle.setTextColor(Theme.TEXT_PRIMARY);
        browserTitle.setTextSize(16);
        browserTitle.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        browserTitle.setMaxLines(1);
        browserTitle.setEllipsize(TextUtils.TruncateAt.END);
        browserTitle.setPadding(dp(4), 0, dp(8), 0);
        collapsedChrome.addView(browserTitle, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        browserFavoriteIcon = MobileViews.iconButton(this, R.drawable.ic_nav_favorite, this::toggleFavorite);
        collapsedChrome.addView(browserFavoriteIcon,
            new LinearLayout.LayoutParams(dp(MobileViews.TOUCH_TARGET), dp(MobileViews.TOUCH_TARGET)));
        collapsedChrome.addView(MobileViews.iconButton(this, R.drawable.ic_more_vert, this::showProviderMenu),
            new LinearLayout.LayoutParams(dp(MobileViews.TOUCH_TARGET), dp(MobileViews.TOUCH_TARGET)));

        // Not used on phones, but the rest of the code expects these to exist.
        providerRail = new LinearLayout(this);
        providerRailScroll = null;
        providerRailDivider = null;
        updateBrowserBar();
    }

    /** Overflow menu for the provider view -- keeps the browser bar down to four controls. */
    private void showProviderMenu() {
        android.widget.PopupMenu menu = new android.widget.PopupMenu(this, browserTitle);
        menu.getMenu().add("Neu laden");
        menu.getMenu().add("Startseite des Anbieters");
        menu.getMenu().add("Anbieter wechseln");
        menu.getMenu().add("Alles neu laden");
        menu.setOnMenuItemClickListener(item -> {
            String label = String.valueOf(item.getTitle());
            WebView webView = currentWebView();
            if ("Neu laden".equals(label)) {
                if (webView != null) webView.reload();
            } else if ("Startseite des Anbieters".equals(label)) {
                if (activeProvider != null) openProvider(activeProvider, activeProvider.startUrl);
            } else if ("Anbieter wechseln".equals(label)) {
                showHome();
            } else if ("Alles neu laden".equals(label)) {
                reloadAllWebViews();
            }
            return true;
        });
        menu.show();
    }

    private void updateBrowserBar() {
        if (browserTitle == null) return;
        browserTitle.setText(activeProvider == null ? "ELFIX" : activeProvider.name);
    }

    private WebView brandLogoView() {
        WebView logo = new WebView(this);
        logo.setFocusable(false);
        logo.setFocusableInTouchMode(false);
        logo.setBackgroundColor(Color.TRANSPARENT);
        logo.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        logo.getSettings().setJavaScriptEnabled(false);
        logo.loadDataWithBaseURL(
            "file:///android_asset/",
            "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>" +
                "<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}" +
                "body{display:flex;align-items:center}img{width:100%;height:100%;object-fit:contain;object-position:left center}</style>" +
                "</head><body><img src='elfix_schriftzug.png' alt='ELFIX'></body></html>",
            "text/html",
            "UTF-8",
            null
        );
        return logo;
    }

    /**
     * TV chrome: a slim header for the tab screens, and a compact browser bar for the provider view.
     * The old ten-button toolbar plus inline search field is gone -- on a remote that was a long
     * focus path and it pushed the content down. Everything is inside the overscan-safe margin.
     */
    private void buildTvChrome() {
        int pad = dp(TvViews.SCREEN_PADDING);

        appChrome = new LinearLayout(this);
        appChrome.setOrientation(LinearLayout.HORIZONTAL);
        appChrome.setGravity(Gravity.CENTER_VERTICAL);
        appChrome.setBackgroundColor(Theme.BACKGROUND);
        appChrome.setPadding(pad, dp(22), pad, dp(8));
        chromeHolder.addView(appChrome, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        appChrome.addView(brandLogoView(), new LinearLayout.LayoutParams(dp(150), dp(42)));
        appChrome.addView(new android.widget.Space(this), new LinearLayout.LayoutParams(0, 1, 1));
        appChrome.addView(TvViews.headerButton(this, R.drawable.ic_nav_search, "Suche",
            () -> showGlobalSearch("")), headerSlot());
        appChrome.addView(TvViews.headerButton(this, R.drawable.ic_nav_favorite, "Favoriten",
            this::showFavorites), headerSlot());
        // Die Watchparty gehoert in die Kopfzeile, weil sie sonst am Fernseher
        // gar nicht erreichbar ist: die untere Leiste, in der sie auf dem
        // Telefon steht, wird hier ausgeblendet (siehe buildBottomNav). Es gab
        // die Seite also, aber keinen Weg zu ihr - und damit auf dem groessten
        // Bildschirm im Haus kein gemeinsames Schauen.
        appChrome.addView(TvViews.headerButton(this, R.drawable.ic_play, "Watchparty",
            this::zeigeWatchparty), headerSlot());
        appChrome.addView(TvViews.headerButton(this, R.drawable.ic_nav_settings, "Einstellungen",
            this::showSettings), headerSlot());

        collapsedChrome = new LinearLayout(this);
        collapsedChrome.setOrientation(LinearLayout.HORIZONTAL);
        collapsedChrome.setGravity(Gravity.CENTER_VERTICAL);
        collapsedChrome.setBackgroundColor(Theme.SURFACE);
        collapsedChrome.setPadding(dp(TvViews.SCREEN_PADDING - 12), dp(6), dp(TvViews.SCREEN_PADDING - 12), dp(6));
        collapsedChrome.setVisibility(View.GONE);
        chromeHolder.addView(collapsedChrome, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        collapsedChrome.addView(TvViews.iconButton(this, R.drawable.ic_arrow_back, this::goBackInProvider),
            new LinearLayout.LayoutParams(dp(52), dp(52)));

        browserTitle = new TextView(this);
        browserTitle.setTextColor(Theme.TEXT_PRIMARY);
        browserTitle.setTextSize(19);
        browserTitle.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        browserTitle.setMaxLines(1);
        browserTitle.setEllipsize(TextUtils.TruncateAt.END);
        browserTitle.setPadding(dp(14), 0, dp(14), 0);
        collapsedChrome.addView(browserTitle, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        browserFavoriteIcon = TvViews.iconButton(this, R.drawable.ic_nav_favorite, this::toggleFavorite);
        collapsedChrome.addView(browserFavoriteIcon, new LinearLayout.LayoutParams(dp(52), dp(52)));
        collapsedChrome.addView(TvViews.iconButton(this, R.drawable.ic_reload, () -> {
            WebView webView = currentWebView();
            if (webView != null) webView.reload();
        }), new LinearLayout.LayoutParams(dp(52), dp(52)));

        // Kept for the shared code paths (provider cycling, focus helpers) but no longer rendered:
        // on TV the provider cards on the home screen are the switching surface.
        providerRail = new LinearLayout(this);
        providerRailScroll = null;
        providerRailDivider = null;
        updateBrowserBar();
    }

    private LinearLayout.LayoutParams headerSlot() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.leftMargin = dp(14);
        return params;
    }

    /** Phone bottom navigation: the primary way around the app. Absent on TV. */
    private void buildBottomNav() {
        bottomNavHolder.removeAllViews();
        bottomNavTabs.clear();
        if (isTelevision()) {
            bottomNavHolder.setVisibility(View.GONE);
            return;
        }
        bottomNavHolder.setVisibility(View.VISIBLE);
        bottomNavHolder.setBackgroundColor(Theme.SURFACE);

        View hairline = new View(this);
        hairline.setBackgroundColor(Theme.BORDER);
        bottomNavHolder.addView(hairline, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bottomNavHolder.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58)));

        bar.addView(bottomNavTab("home", R.drawable.ic_nav_home, "Home", this::showHome));
        bar.addView(bottomNavTab("search", R.drawable.ic_nav_search, "Suche", () -> showGlobalSearch("")));
        bar.addView(bottomNavTab("favorites", R.drawable.ic_nav_favorite, "Meine Liste", this::showFavorites));
        bar.addView(bottomNavTab("watchparty", R.drawable.ic_play, "Watchparty", this::zeigeWatchparty));
        bar.addView(bottomNavTab("settings", R.drawable.ic_nav_settings, "Einstellungen", this::showSettings));
        updateBottomNav();
    }

    private LinearLayout bottomNavTab(String screen, int iconRes, String label, Runnable onClick) {
        LinearLayout tab = new LinearLayout(this);
        tab.setOrientation(LinearLayout.VERTICAL);
        tab.setGravity(Gravity.CENTER);
        tab.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1));

        ImageView icon = new ImageView(this);
        icon.setImageResource(iconRes);
        LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(dp(24), dp(24));
        iconParams.gravity = Gravity.CENTER_HORIZONTAL;
        tab.addView(icon, iconParams);

        TextView text = new TextView(this);
        text.setText(label);
        text.setTextSize(11);
        text.setMaxLines(1);
        text.setEllipsize(TextUtils.TruncateAt.END);
        text.setIncludeFontPadding(false);
        // A vertical LinearLayout hands its children MATCH_PARENT width by default, so the label
        // fills the tab and must centre its own text -- otherwise it sits left of the icon.
        text.setGravity(Gravity.CENTER_HORIZONTAL);
        text.setPadding(dp(2), dp(4), dp(2), 0);
        tab.addView(text, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        tab.setOnClickListener(view -> onClick.run());
        bottomNavTabs.put(screen, tab);
        return tab;
    }

    /**
     * Highlights the tab matching the current screen.
     *
     * <p>Zwei Bildschirme haben keinen eigenen Reiter und behalten deshalb den
     * der Startseite: die Anbieteransicht und die Entdeckungsseite. Beide
     * fuehren von dort weg und wieder dorthin zurueck - waehrenddessen gar
     * keinen Reiter leuchten zu lassen, saehe aus wie ein Fehler.
     */
    private void updateBottomNav() {
        if (bottomNavTabs.isEmpty()) return;
        String active = "provider".equals(currentScreen) || "entdeckung".equals(currentScreen)
            ? "home" : currentScreen;
        for (Map.Entry<String, LinearLayout> entry : bottomNavTabs.entrySet()) {
            boolean selected = entry.getKey().equals(active);
            LinearLayout tab = entry.getValue();
            int tint = selected ? Theme.PRIMARY : Theme.TEXT_DISABLED;
            ((ImageView) tab.getChildAt(0)).setColorFilter(tint);
            TextView label = (TextView) tab.getChildAt(1);
            label.setTextColor(tint);
            label.setTypeface(selected ? android.graphics.Typeface.DEFAULT_BOLD : android.graphics.Typeface.DEFAULT);
        }
    }

    private void renderProviderRail() {
        updateProviderRailVisibility();
        providerRail.removeAllViews();
        providerButtons.clear();
        for (Provider provider : providers) {
            Button card = providerButton(provider);
            bindProviderTabClick(card, provider);
            providerButtons.put(provider.id, card);
            providerRail.addView(card);
        }
    }

    private void bindProviderTabClick(Button card, Provider provider) {
        card.setOnClickListener(new View.OnClickListener() {
            private Runnable pendingOpen;

            @Override
            public void onClick(View view) {
                if (pendingOpen != null) {
                    cacheCleanupHandler.removeCallbacks(pendingOpen);
                    pendingOpen = null;
                    openProvider(provider, provider.startUrl);
                    showToast(provider.name + " Startseite");
                    return;
                }

                pendingOpen = () -> {
                    pendingOpen = null;
                    openProvider(provider, provider.lastUrl.isEmpty() ? provider.startUrl : provider.lastUrl);
                };
                cacheCleanupHandler.postDelayed(pendingOpen, 260);
            }
        });
    }

    private Button providerButton(Provider provider) {
        boolean compact = isCompactWidth();
        Button button = new Button(this);
        button.setText(provider.logo + "\n" + provider.name);
        button.setAllCaps(false);
        button.setTextSize(compact ? 14 : 16);
        button.setTextColor(Color.WHITE);
        button.setFocusable(true);
        button.setSingleLine(false);
        button.setLines(2);
        button.setPadding(dp(8), dp(4), dp(8), dp(4));
        button.setEllipsize(TextUtils.TruncateAt.END);
        applyProviderFocus(button, provider == activeProvider);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            dp(providerCardWidthDp()), dp(providerCardHeightDp()));
        params.setMargins(0, dp(4), dp(compact ? 8 : 10), dp(4));
        button.setLayoutParams(params);
        return button;
    }

    private Button chromeButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(isCompactWidth() ? 20 : 22);
        button.setTextColor(Color.WHITE);
        button.setPadding(0, 0, 0, 0);
        button.setFocusable(true);
        applyTvFocus(button, Color.rgb(28, 36, 50), Color.rgb(58, 72, 96), 14);
        int size = dp(touchTargetDp());
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(size, size);
        params.setMargins(0, 0, dp(8), 0);
        button.setLayoutParams(params);
        return button;
    }

    private Button textButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        boolean compact = isCompactWidth();
        button.setTextSize(compact ? 14 : 16);
        button.setTextColor(Color.WHITE);
        button.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        button.setSingleLine(true);
        button.setEllipsize(TextUtils.TruncateAt.END);
        // Width follows the label instead of a magic formula, so labels never get clipped and
        // buttons of the same kind line up.
        button.setPadding(dp(compact ? 12 : 16), 0, dp(compact ? 12 : 16), 0);
        button.setFocusable(true);
        applyTvFocus(button, Color.rgb(28, 36, 50), Color.rgb(58, 72, 96), 14);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, dp(touchTargetDp()));
        params.setMargins(dp(8), 0, 0, 0);
        button.setLayoutParams(params);
        return button;
    }

    private GradientDrawable rounded(int color, int radiusDp) {
        return rounded(color, radiusDp, SUBTLE_BORDER, 1);
    }

    private GradientDrawable rounded(int fillColor, int radiusDp, int strokeColor, int strokeWidthDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fillColor);
        drawable.setCornerRadius(dp(radiusDp));
        if (strokeWidthDp > 0) drawable.setStroke(dp(strokeWidthDp), strokeColor);
        return drawable;
    }

    /**
     * Die Startseite.
     *
     * <p>Paketweit sichtbar statt privat, damit die Pruefungen auf dem Geraet
     * sie aufrufen koennen (siehe {@code StartseiteGeraeteTest}). Ein
     * Neuaufbau von aussen ist genau das, was dort gebraucht wird: eine
     * geaenderte Einstellung soll sich zeigen, ohne dass die Pruefung durch
     * Menues tippen muss.
     */
    void showHome() {
        currentScreen = "home";
        if (activeProvider != null) {
            // Hier schaut niemand mehr zu: sofort aus der Runde abmelden, statt
            // still zu werden. Sonst steht dieses Geraet bei den anderen noch
            // als aktiv - und bliebe Host einer Folge, die es nicht mehr
            // schaut, bis der Herzschlag ablaeuft.
            if (mitschauen != null) {
                mitschauen.abmelden();
                // Wer die Seite verlaesst, will auch nicht mehr, dass sie sich
                // gleich von selbst startet und ins Vollbild zieht.
                mitschauen.oertlichenStartAbbrechen("Player verlassen");
                mitschauen.vollbildwunschVerwerfen();
            }
            disarmAutoStart("Player verlassen");
            rememberAndPauseMedia(activeProvider.id, webViews.get(activeProvider.id));
            // Die Anbieterseite tritt zurueck: was dort lief, ist zu Ende
            // gezaehlt. Dieselbe Stelle wie am Rechner beim Schliessen einer
            // Ansicht - ohne sie bliebe die letzte Folge eines Abends offen.
            if (statistik != null) statistik.schliessen(activeProvider.id);
        }
        activeProvider = null;
        activeFavoriteId = null;
        renderProviderRail();
        updateFavoriteButton();
        // Keine Anbieterseite mehr, also auch kein Live-Streifen und kein Takt.
        liveStreifenAuffrischen();
        // Und keine Wiedergabeleiste: es laeuft nichts, wozu es eine naechste
        // Folge gaebe.
        if (spielerleiste != null) {
            spielerleiste.setzeAmSchauen(false);
            spielerleiste.setzeZiel("");
        }
        mouseMode = false;
        setMouseCursorVisible(false);
        setChromeCollapsed(false, false);
        content.removeAllViews();
        updateBottomNav();
        if (isTelevision()) renderTvHome();
        else renderMobileHome();
    }

    // ---------------------------------------------------------------------------------------------
    // Mobile screens. These replace the TV page layouts on phones; all app logic (providers,
    // favourites, search, WebView) is shared and untouched -- only the presentation differs.
    // ---------------------------------------------------------------------------------------------

    // ---------------------------------------------------------------------------------------------
    // Android TV screens. Own layouts (not the phone ones scaled up): larger type, D-pad focus,
    // overscan-safe margins. All provider/favourite/search/WebView logic is shared.
    // ---------------------------------------------------------------------------------------------

    private LinearLayout tvPage() {
        ScrollView scroll = new ScrollView(this);
        seitenScroll = scroll;
        scroll.setBackgroundColor(Theme.BACKGROUND);
        // Focused cards scale up by 5%; without this the growth is clipped at the row/page bounds
        // and the focus outline looks cut off.
        scroll.setClipChildren(false);
        scroll.setClipToPadding(false);
        LinearLayout page = new LinearLayout(this);
        page.setClipChildren(false);
        page.setClipToPadding(false);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(TvViews.SCREEN_PADDING), dp(8), dp(TvViews.SCREEN_PADDING), dp(TvViews.SCREEN_PADDING));
        scroll.addView(page, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        content.addView(scroll, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        return page;
    }

    /**
     * How many cards fit a TV row. Derived from the available dp width so 720p, 1080p and 4K panels
     * all get a sensible count instead of a hardcoded number.
     */
    private int tvCardWidthDp(int desired, int minimum) {
        int available = getResources().getConfiguration().screenWidthDp - 2 * TvViews.SCREEN_PADDING;
        int perRow = Math.max(1, (available + TvViews.ITEM_GAP) / (desired + TvViews.ITEM_GAP));
        int width = (available - (perRow - 1) * TvViews.ITEM_GAP) / perRow;
        return Math.max(minimum, width);
    }

    private LinearLayout tvRow() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setClipChildren(false);
        row.setClipToPadding(false);
        return row;
    }

    private void addTvRowItem(LinearLayout row, View item, boolean first) {
        LinearLayout.LayoutParams params = (LinearLayout.LayoutParams) item.getLayoutParams();
        if (params == null) {
            params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        }
        if (!first) params.leftMargin = dp(TvViews.ITEM_GAP);
        row.addView(item, params);
    }

    /**
     * Die Startseite des Fernsehers.
     *
     * <p>Sie zeigt dasselbe wie die des Rechners und in derselben Reihenfolge -
     * Titelhintergrund, was laeuft, was gemerkt ist, was vorgeschlagen wird.
     * Und sie rechnet nichts davon selbst aus: der Verlauf kommt aus
     * {@link Bestand}, die Vorschlaege aus {@link Empfehlungen}, und beide
     * fragen denselben Kern wie Rechner und Telefon. Eine dritte Fachlogik
     * "fuer den Fernseher" gibt es nicht und soll es nicht geben - sie waere
     * die Stelle, an der die drei Geraete anfangen, verschiedene Dinge zu
     * behaupten.
     *
     * <p>Was hier steht, ist ausschliesslich die Darstellung, und die ist
     * wirklich anders: keine vergroesserte Telefonseite, sondern Reihen, durch
     * die ein Fokus wandert. Jede Reihe zeigt zunaechst
     * {@link #TV_REIHE_ERST} Kacheln und legt nach, bevor der Fokus ans Ende
     * kommt ({@link #tvNachlegen}) - beim ersten Zeichnen fuenf Reihen mit je
     * zwanzig Postern zu holen waere auf einem Fernseh-Stick eine halbe
     * Minute schwarzer Bildschirm.
     */
    private void renderTvHome() {
        LinearLayout page = tvPage();
        empfehlungenNachfuehren();
        liveKachelnZuruecksetzen();
        // Auch hier, obwohl der Fernseher (noch) keine Kalenderreihe zeigt:
        // die Woche wird aus den Anbietern gerechnet, und ein Kalender ohne
        // sie liefert eine leere Woche statt gar keiner.
        if (kalender != null) kalender.anbieterSetzen(providers);
        tvReihen.clear();

        List<Favorite> laufend = bestand.weiterschauen();
        heroEintraege = new ArrayList<>(laufend.subList(0, Math.min(HERO_ANZAHL, laufend.size())));
        if (heroStelle >= heroEintraege.size()) heroStelle = 0;

        // Die Plaetze werden auch dann angelegt, wenn der Titelhintergrund
        // abgeschaltet ist: der Wechseltakt zeichnet sie fuer sich neu und
        // traefe sonst auf null.
        heroPlatz = new FrameLayout(this);
        heroPlatz.setClipChildren(false);
        heroPlatz.setClipToPadding(false);
        heroPunkte = new LinearLayout(this);
        heroPunkte.setOrientation(LinearLayout.HORIZONTAL);
        heroPunkte.setClipChildren(false);
        heroPunkte.setClipToPadding(false);
        if (zeigt(Startseite.HERO)) {
            addSpacing(page, heroPlatz, 0);
            addSpacing(page, heroPunkte, 6);
            heroZeichnen();
            heroWechselPlanen();
        }

        // Dieselbe Reihenfolge wie am Rechner: Neue Folgen, Weiterschauen,
        // Gemeinsam weiterschauen, YouTube - und erst danach der Anbieterrost.
        // Er stand hier bisher davor, weil es am Fernseher keine Seitenleiste
        // gibt und die Anbieter der Weg zu allem sind. Das bleibt richtig, nur
        // nicht *vor* dem, was gerade laeuft: mit der Fernbedienung ist jede
        // Reihe darueber ein Druck mehr, bevor man weiterschauen kann.
        boolean etwasGezeigt = tvNeueFolgenReihe(page);

        List<Favorite> privat = new ArrayList<>();
        List<Favorite> gemeinsam = new ArrayList<>();
        List<Favorite> videos = new ArrayList<>();
        for (Favorite eintrag : laufend) {
            if (youtube != null && youtube.istYoutube(eintrag)) videos.add(eintrag);
            else if (eintrag.watchpartyRaum().isEmpty()) privat.add(eintrag);
            else gemeinsam.add(eintrag);
        }
        if (zeigt(Startseite.WEITERSCHAUEN)) {
            etwasGezeigt |= tvKachelReihe(page, "weiterschauen", "Weiterschauen", privat,
                Bibliothek.WEITERSCHAUEN);
            etwasGezeigt |= tvKachelReihe(page, "gemeinsam", "Gemeinsam weiterschauen", gemeinsam,
                Bibliothek.WEITERSCHAUEN);
        }
        if (zeigt(Startseite.YOUTUBE)) {
            etwasGezeigt |= tvKachelReihe(page, "youtube", "YouTube weiterschauen", videos,
                Bibliothek.WEITERSCHAUEN);
        }

        addSpacing(page, TvViews.sectionHeader(this, "Deine Anbieter", null, null),
            TvViews.SECTION_GAP);
        int anbieterBreite = tvCardWidthDp(230, 180);
        ArrayList<View> anbieterKarten = new ArrayList<>();
        for (int i = 0; i < providers.size(); i += 1) {
            Provider provider = providers.get(i);
            View karte = TvViews.providerCard(this, provider, providerTagline(provider), anbieterBreite,
                () -> openProvider(provider, provider.lastUrl.isEmpty() ? provider.startUrl : provider.lastUrl),
                () -> openProvider(provider, provider.startUrl));
            karte.setTag("tv:anbieter:" + i);
            anbieterKarten.add(karte);
            providerButtons.remove(provider.id);
        }
        if (!anbieterKarten.isEmpty()) {
            reiheAnhaengenTv(page, TvViews.reihe(this, anbieterKarten), TvViews.ITEM_GAP);
        }
        if (zeigt(Startseite.WEITERSCHAUEN)) {
            etwasGezeigt |= tvKachelReihe(page, "watchlist", Bibliothek.WATCHLIST.titel,
                bestand.watchlist(), Bibliothek.WATCHLIST);
            etwasGezeigt |= tvKachelReihe(page, "mediathek", Bibliothek.MEDIATHEK.titel,
                bestand.mediathek(), Bibliothek.MEDIATHEK);
        }
        if (!etwasGezeigt && zeigt(Startseite.WEITERSCHAUEN)) {
            addSpacing(page, TvViews.sectionHeader(this, "Weiterschauen", null, null),
                TvViews.SECTION_GAP);
            addSpacing(page, TvViews.emptyState(this, R.drawable.ic_play, "Noch nichts angefangen",
                "Öffne einen Anbieter und sieh dir etwas an. ELFIX merkt sich die Folge und die "
                    + "Stelle und schlägt sie dir hier wieder vor."), TvViews.ITEM_GAP);
        }

        if (zeigt(Startseite.PERSOENLICH)) {
            tvVorschlagsReihe(page, Empfehlungen.NEUES, "Neu bei deinen Anbietern", null, null);
            tvVorschlagsReihe(page, Empfehlungen.FUER_DICH, "Empfohlen für dich",
                "Neu berechnen", () -> {
                    empfehlungen.neuBerechnen();
                    showToast("Empfehlungen werden neu berechnet");
                });
        }
        if (zeigt(Startseite.KATEGORIEN)) {
            tvVorschlagsReihe(page, Empfehlungen.ANIME, "Anime für dich", "Mehr anzeigen",
                () -> zeigeEntdeckung(Empfehlungen.ANIME));
            tvVorschlagsReihe(page, Empfehlungen.SERIE, "Serien für dich", "Mehr anzeigen",
                () -> zeigeEntdeckung(Empfehlungen.SERIE));
            tvVorschlagsReihe(page, Empfehlungen.FILM, "Filme für dich", "Mehr anzeigen",
                () -> zeigeEntdeckung(Empfehlungen.FILM));
        }
        // Ist alles abgeschaltet, steht sonst nur der Anbieterrost da und die
        // Seite sieht kaputt aus. Der Weg zurueck gehoert dorthin, wo der
        // Mangel auffaellt - nicht in eine Einstellung, die man erst sucht.
        if (startseite != null && startseite.anzahlAn() == 0) {
            addSpacing(page, TvViews.hinweis(this,
                "Alle Reihen der Startseite sind ausgeblendet.", "Reihen einblenden",
                () -> {
                    startseite.zuruecksetzen();
                    showHome();
                }), TvViews.SECTION_GAP);
        }

        tvFokusHerstellen(page);
        liveTaktPlanen();
    }

    /**
     * Eine Reihe in die Seite haengen - mit negativem Rand nach rechts.
     *
     * <p>Die Seite hat links und rechts ihren ueberscan-sicheren Rand, die
     * Reihe soll aber bis an die Kante laufen. Sonst endete die letzte
     * sichtbare Kachel mitten im Bild, und nichts deutete darauf hin, dass
     * dahinter noch etwas kommt. Links bleibt der Rand stehen: dort faengt der
     * Blick an, und dort gehoert er hin.
     */
    private void reiheAnhaengenTv(LinearLayout page, View reihe, int obenDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(obenDp);
        params.rightMargin = -dp(TvViews.SCREEN_PADDING);
        page.addView(reihe, params);
    }

    /* ------------------------------------------------- Die Reihen des Fernsehers */

    /**
     * Eine Reihe aus Eintraegen der Ablage.
     *
     * @param schluessel woran die Reihe beim Nachlegen wiederzuerkennen ist
     * @return ob sie ueberhaupt etwas zu zeigen hatte
     */
    private boolean tvKachelReihe(LinearLayout page, String schluessel, String titel,
                                  List<Favorite> eintraege, Bibliothek liste) {
        if (eintraege.isEmpty()) return false;
        addSpacing(page, TvViews.sectionHeader(this, titel, "Alle anzeigen",
            () -> zeigeBibliothek(liste)), TvViews.SECTION_GAP);

        int breite = TvViews.kachelBreiteDp(this);
        List<Favorite> vorrat = new ArrayList<>(eintraege);
        TvKartenBauer bauer = stelle -> {
            Favorite eintrag = vorrat.get(stelle);
            String name = cleanFavoriteTitle(eintrag.title(), eintrag.url());
            if (name.isEmpty()) name = "Titel";
            String rundenSchluessel = liveSchluessel(eintrag);
            int prozent = liste.zeigtFortschritt() && !eintrag.wartetAufNaechsteFolge()
                ? eintrag.fortschrittProzent() : 0;
            if (!rundenSchluessel.isEmpty()) prozent = Math.max(1, prozent);
            View karte = TvViews.kachel(this, providerForFavorite(eintrag), name,
                kachelUnterzeile(eintrag), eintrag.bild(), prozent, "", breite,
                kachelStandtext(eintrag, liste),
                rundenSchluessel.isEmpty() ? null : liveZeile(rundenSchluessel, eintrag), null,
                () -> openFavorite(eintrag),
                anker -> eintragsMenue(anker, eintrag, liste));
            karte.setTag("tv:" + schluessel + ":" + stelle);
            if (!rundenSchluessel.isEmpty()) {
                liveKacheln.add(new LiveKachel(karte, rundenSchluessel, eintrag.duration(),
                    eintrag.watchpartyVon(), watchpartyZeit(eintrag)));
                // Die Reihen des Fernsehers legen ihre Karten erst nach, wenn
                // der Fokus in die Naehe kommt. Eine Karte, die dabei
                // dazukommt, braucht ihren ersten Stand sofort - sonst bliebe
                // sie bis zur naechsten vollen Sekunde stumm.
                liveTaktPlanen();
            }
            return karte;
        };
        reiheAnlegen(page, schluessel, vorrat.size(), bauer);
        return true;
    }

    /**
     * Die Reihe "Neue Folgen".
     *
     * <p>Sie steht ganz oben, weil sie das Einzige ist, was von selbst
     * dazukommt: eine Serie, die man durch hatte, hat Nachschub bekommen.
     * Dieselbe Reihe an derselben Stelle wie am Rechner.
     */
    private boolean tvNeueFolgenReihe(LinearLayout page) {
        ArrayList<Favorite> neue = new ArrayList<>();
        for (Favorite eintrag : bestand.alle()) {
            if (!eintrag.neueFolgeAm().isEmpty()) neue.add(eintrag);
        }
        if (neue.isEmpty()) return false;
        java.util.Collections.sort(neue,
            java.util.Comparator.comparing(Favorite::neueFolgeAm).reversed());

        addSpacing(page, TvViews.sectionHeader(this, "Neue Folgen", "Alle anzeigen",
            () -> zeigeBibliothek(Bibliothek.WATCHLIST)), TvViews.SECTION_GAP);
        int breite = TvViews.kachelBreiteDp(this);
        TvKartenBauer bauer = stelle -> {
            Favorite eintrag = neue.get(stelle);
            String name = cleanFavoriteTitle(eintrag.title(), eintrag.url());
            if (name.isEmpty()) name = "Titel";
            View karte = TvViews.kachel(this, providerForFavorite(eintrag), name,
                eintrag.providerName(), eintrag.bild(), 0, eintrag.neueFolgeText(), breite, null,
                () -> openFavorite(eintrag),
                anker -> eintragsMenue(anker, eintrag, Bibliothek.WATCHLIST));
            karte.setTag("tv:neuefolgen:" + stelle);
            return karte;
        };
        reiheAnlegen(page, "neuefolgen", neue.size(), bauer);
        return true;
    }

    /**
     * Eine Vorschlagsreihe.
     *
     * <p>Vier Zustaende, und jeder sagt etwas anderes: gefuellt, wird geholt,
     * geht nicht, und "dazu gibt es nichts". Nur der letzte laesst die Reihe
     * ganz verschwinden - eine Ueberschrift ueber nichts ist schlimmer als
     * eine fehlende Reihe, und auf einem Fernseher kostet sie eine
     * Bildschirmhoehe.
     *
     * <p>Die Unterscheidung ist Wort fuer Wort dieselbe wie auf dem Telefon,
     * denn sie kommt aus derselben Quelle: {@link Empfehlungen} weiss, ob eine
     * Reihe laeuft, geladen ist, alt ist oder gescheitert ist. Was hier steht,
     * ist nur, wie das aussieht.
     */
    private void tvVorschlagsReihe(LinearLayout page, String schluessel, String titel,
                                   String aktion, Runnable beiAktion) {
        if (empfehlungen == null) return;
        int breite = TvViews.kachelBreiteDp(this);

        // Der Lauf ist gar nicht erst hochgekommen. Das einmal sagen, nicht
        // fuenfmal - deshalb nur bei der ersten Reihe.
        if (!empfehlungen.istBereit() && !empfehlungen.startFehler().isEmpty()) {
            if (!Empfehlungen.NEUES.equals(schluessel)) return;
            addSpacing(page, TvViews.sectionHeader(this, "Vorschläge", null, null),
                TvViews.SECTION_GAP);
            addSpacing(page, TvViews.hinweis(this,
                "Die Vorschläge konnten nicht vorbereitet werden. Ohne sie funktioniert alles "
                    + "Übrige weiter.", "Erneut versuchen",
                () -> {
                    empfehlungen.erneutStarten(watchparty == null ? "" : watchparty.serverUrl());
                    showToast("Vorschläge werden erneut vorbereitet");
                }), TvViews.ITEM_GAP);
            return;
        }

        int anzahl = Empfehlungen.NEUES.equals(schluessel) ? 8 : 20;
        empfehlungen.anfordern(schluessel, anzahl);

        List<JSONObject> eintraege = empfehlungen.eintraege(schluessel);
        String fehler = empfehlungen.fehler(schluessel);
        boolean fertigUndLeer = eintraege.isEmpty() && fehler.isEmpty()
            && empfehlungen.geladen(schluessel) && !empfehlungen.laedt(schluessel);
        // Fertig geholt, kein Fehler und trotzdem leer heisst normalerweise:
        // dazu gibt es gerade nichts. Ohne Leitung heisst es etwas anderes -
        // der Lauf faengt einen gescheiterten Abruf ab und gibt eine leere
        // Liste zurueck. Also wird gefragt, bevor entschieden wird.
        if (fertigUndLeer && !Netz.vorhanden(this)) {
            if (!Empfehlungen.NEUES.equals(schluessel)) return;
            addSpacing(page, TvViews.sectionHeader(this, "Vorschläge", null, null),
                TvViews.SECTION_GAP);
            addSpacing(page, TvViews.hinweis(this,
                "Keine Verbindung. Vorschläge brauchen die Seiten deiner Anbieter - sobald du "
                    + "wieder online bist, stehen sie hier. Deine Mediathek und alles Angefangene "
                    + "bleiben verfügbar.", "Erneut versuchen",
                () -> {
                    for (String art : new String[]{Empfehlungen.NEUES, Empfehlungen.FUER_DICH,
                        Empfehlungen.ANIME, Empfehlungen.SERIE, Empfehlungen.FILM}) {
                        empfehlungen.erneutVersuchen(art);
                    }
                    if ("home".equals(currentScreen)) empfehlungenGeaendert();
                }), TvViews.ITEM_GAP);
            return;
        }
        if (fertigUndLeer) return;

        addSpacing(page, TvViews.sectionHeader(this, titel,
            eintraege.isEmpty() ? null : aktion, beiAktion), TvViews.SECTION_GAP);

        if (!fehler.isEmpty() && eintraege.isEmpty()) {
            addSpacing(page, TvViews.hinweis(this,
                "Diese Vorschläge konnten nicht geladen werden. Ohne Netz zeigt ELFIX hier den "
                    + "letzten bekannten Stand - beim ersten Start gibt es noch keinen.",
                "Erneut versuchen",
                () -> {
                    empfehlungen.erneutVersuchen(schluessel);
                    if ("home".equals(currentScreen)) empfehlungenGeaendert();
                }), TvViews.ITEM_GAP);
            return;
        }
        if (eintraege.isEmpty()) {
            reiheAnhaengenTv(page, TvViews.reihenSkelett(this, breite, 6), TvViews.ITEM_GAP);
            return;
        }
        // Ein Stand von der Platte steht mit seinem Alter da. Ihn wortlos zu
        // zeigen waere schlimmer als ihn wegzulassen: er saehe aus wie frisch
        // geholt, und wer sich fragt, warum nichts Neues kommt, faende keine
        // Antwort.
        if (empfehlungen.istAlt(schluessel)) {
            addSpacing(page, TvViews.hinweis(this, altHinweis(empfehlungen.alter(schluessel)),
                "Erneut versuchen",
                () -> {
                    empfehlungen.erneutVersuchen(schluessel);
                    if ("home".equals(currentScreen)) empfehlungenGeaendert();
                }), 0);
        }

        String reihenName = schluessel.isEmpty() ? "fuerdich" : schluessel;
        List<JSONObject> vorrat = new ArrayList<>(eintraege);
        boolean mitEntdeckung = Empfehlungen.ANIME.equals(schluessel)
            || Empfehlungen.SERIE.equals(schluessel) || Empfehlungen.FILM.equals(schluessel);
        TvKartenBauer bauer = stelle -> {
            // Die letzte Karte einer Kategoriereihe ist der Weg zur ganzen
            // Liste. Sie liegt am Ende, weil der Fokus dort ankommt.
            if (mitEntdeckung && stelle >= vorrat.size()) {
                View mehr = TvViews.mehrKarte(this, "Mehr anzeigen", breite,
                    () -> zeigeEntdeckung(schluessel));
                mehr.setTag("tv:" + reihenName + ":" + stelle);
                return mehr;
            }
            View karte = tvVorschlagsKarte(vorrat.get(stelle), breite);
            karte.setTag("tv:" + reihenName + ":" + stelle);
            return karte;
        };
        reiheAnlegen(page, reihenName, vorrat.size() + (mitEntdeckung ? 1 : 0), bauer);
    }

    /** Eine einzelne Vorschlagskarte - in der Reihe wie im Raster dieselbe. */
    private View tvVorschlagsKarte(JSONObject item, int breiteDp) {
        return tvVorschlagsKarte(item, breiteDp, null);
    }

    private View tvVorschlagsKarte(JSONObject item, int breiteDp, Bilder.Sichtfenster fenster) {
        String titel = item.optString("title", "");
        if (titel.isEmpty()) titel = "Titel";
        // Der Grund ist der Unterschied zwischen einem Vorschlag und einer
        // Behauptung. Ausformuliert hat ihn der Empfehlungslauf im Kern -
        // derselbe Satz wie am Rechner.
        String grund = item.optString("grundText", "");
        String datum = erscheinungsdatum(item.optString("releasedAt", ""));
        String zusatz = datum.isEmpty() ? item.optString("providerName", "") : datum;
        return TvViews.vorschlag(this, providerMitId(item.optString("providerId", "")),
            titel, grund, zusatz, item.optString("image", ""), breiteDp, fenster,
            () -> vorschlagOeffnen(item),
            anker -> vorschlagsMenue(anker, item));
    }

    /**
     * Eine Reihe anlegen und ihre ersten Kacheln bauen.
     *
     * <p>Der Rest bleibt liegen. Das ist der Unterschied zum Telefon, und er
     * ist gemessen und nicht geraten: fuenf Vorschlagsreihen mit je zwanzig
     * Kacheln sind hundert Poster, die alle gleichzeitig geholt und skaliert
     * werden wollen - auf einem Fernseh-Stick ist das der Grund, warum die
     * Startseite eine halbe Minute schwarz bleibt. Sichtbar sind ohnehin
     * hoechstens sechs davon.
     */
    private void reiheAnlegen(LinearLayout page, String schluessel, int vorrat, TvKartenBauer bauer) {
        TvReihe reihe = new TvReihe();
        reihe.vorrat = vorrat;
        reihe.bauer = bauer;
        reihe.gezeigt = Math.min(TV_REIHE_ERST, vorrat);
        ArrayList<View> karten = new ArrayList<>();
        for (int i = 0; i < reihe.gezeigt; i += 1) karten.add(bauer.baue(i));
        reihe.ansicht = TvViews.reihe(this, karten);
        tvReihen.put(schluessel, reihe);
        reiheAnhaengenTv(page, reihe.ansicht, TvViews.ITEM_GAP);
    }

    /**
     * Nachlegen, bevor der Fokus das Ende erreicht.
     *
     * <p>"Bevor" ist der ganze Punkt. Wer erst nachlegt, wenn die letzte
     * Kachel den Fokus hat, laesst die Fernbedienung einmal ins Leere laufen -
     * und ein Steuerkreuz, das einmal nicht reagiert, wird ein zweites Mal
     * gedrueckt. {@link #TV_REIHE_VORLAUF} Kacheln Vorlauf reichen dafuer aus.
     */
    private void tvNachlegen(String schluessel, int stelle) {
        TvReihe reihe = tvReihen.get(schluessel);
        if (reihe == null || reihe.ansicht == null || reihe.gezeigt >= reihe.vorrat) return;
        if (stelle < reihe.gezeigt - TV_REIHE_VORLAUF) return;
        int bis = Math.min(reihe.vorrat, reihe.gezeigt + TV_REIHE_SCHRITT);
        for (int i = reihe.gezeigt; i < bis; i += 1) {
            TvViews.kachelAnhaengen(reihe.ansicht, reihe.bauer.baue(i));
        }
        reihe.gezeigt = bis;
    }

    /* --------------------------------------------------- Der Fokus des Fernsehers */

    /**
     * Wer den Fokus hat, wird gemerkt - und beim naechsten Aufbau gesucht.
     *
     * <p>Die Startseite wird oefter neu gebaut, als es aussieht: eine fertige
     * Vorschlagsreihe, ein Fortschritt vom Telefon, ein Handgriff im
     * Kachelmenue - jedes Mal steht eine neue Seite da. Auf dem Telefon
     * genuegt es, die Scrollstelle zu halten. Auf dem Fernseher nicht: dort
     * ist der Fokus die Stelle, und ohne diesen Merker faengt die
     * Fernbedienung nach jedem Neuaufbau wieder ganz oben an.
     *
     * <p>Angemeldet wird einmal fuer die ganze Sitzung, am {@code content}, der
     * die Activity ueberdauert - ein Horcher je gebauter Seite waere ein
     * Horcher je gebauter Seite.
     */
    private void tvFokusBeobachten() {
        if (content == null || !isTelevision()) return;
        content.getViewTreeObserver().addOnGlobalFocusChangeListener((alt, neu) -> {
            if (neu == null) return;
            Object marke = neu.getTag();
            if (!(marke instanceof String)) return;
            String schluessel = (String) marke;
            if (!schluessel.startsWith("tv:")) return;
            tvFokusJeSeite.put(currentScreen, schluessel);
            // "tv:<reihe>:<stelle>" - daraus kommt das Nachlegen.
            int letzter = schluessel.lastIndexOf(':');
            if (letzter <= 3) return;
            try {
                tvNachlegen(schluessel.substring(3, letzter),
                    Integer.parseInt(schluessel.substring(letzter + 1)));
            } catch (NumberFormatException keineStelle) {
                // Eine Marke ohne Stelle - dann gibt es dort nichts nachzulegen.
            }
        });
    }

    /**
     * Den Fokus setzen, nachdem eine TV-Seite gebaut wurde.
     *
     * <p>Erst der gemerkte Platz, dann der Titelhintergrund, dann die erste
     * Kachel ueberhaupt. Die Reihenfolge ist die Antwort auf zwei Wuensche
     * zugleich: wer zurueckkommt, soll dort stehen, wo er war - und wer neu
     * hereinkommt, soll nicht im Titelhintergrund festhaengen, sondern einen
     * Platz haben, von dem aus jede Richtung etwas ergibt.
     *
     * <p>Ueber {@code post}, weil eine frisch gebaute Seite noch nicht
     * vermessen ist: ein {@code requestFocus} auf einer Ansicht ohne Hoehe
     * geht ins Leere.
     */
    private void tvFokusHerstellen(View seite) {
        if (seite == null) return;
        String gemerkt = tvFokusJeSeite.get(currentScreen);
        seite.post(() -> {
            if (gemerkt != null && !gemerkt.isEmpty()) {
                View ziel = seite.findViewWithTag(gemerkt);
                if (ziel != null && ziel.isFocusable()) {
                    ziel.requestFocus();
                    return;
                }
            }
            for (String erst : new String[]{"tv:hero:0", "tv:anbieter:0", "tv:reiter:0",
                "tv:entdeckung:0", "tv:liste:0", "tv:wp:0:oeffnen", "tv:wp:einstellungen"}) {
                View ziel = seite.findViewWithTag(erst);
                if (ziel != null) {
                    ziel.requestFocus();
                    return;
                }
            }
        });
    }

    /**
     * Der Titelhintergrund des Fernsehers.
     *
     * <p>Dasselbe wie auf dem Telefon - Bild, Titel, Folge, Fortschritt, zwei
     * Aktionen -, nur breit statt hoch und mit Fokuszielen statt Tippflaechen.
     * Und mit einem Unterschied, der keiner der Form ist: der Wechsel haelt
     * an, sobald jemand hier navigiert (siehe {@link #heroFokusGeaendert}).
     */
    private void tvHeroZeichnen() {
        if (heroPlatz == null) return;
        heroPlatz.removeAllViews();
        Favorite eintrag = heroEintraege.isEmpty() ? null
            : heroEintraege.get(Math.min(heroStelle, heroEintraege.size() - 1));

        View[] knoepfe = new View[2];
        View kasten;
        if (eintrag != null) {
            String titel = cleanFavoriteTitle(eintrag.title(), eintrag.url());
            if (titel.isEmpty()) titel = "Titel";
            String unterzeile = zusammen(eintrag.wartetAufNaechsteFolge()
                    ? "Nächste Folge: " + eintrag.folgenText() : eintrag.folgenText(),
                eintrag.providerName(), eintrag.standText());
            kasten = TvViews.hero(this, "Fortsetzen", titel, unterzeile, eintrag.bild(),
                eintrag.wartetAufNaechsteFolge() ? 0 : eintrag.fortschrittProzent(),
                "Weiter schauen", () -> openFavorite(eintrag),
                "Meine Liste", () -> zeigeBibliothek(Bibliothek.WEITERSCHAUEN),
                knoepfe, this::heroFokusGeaendert);
        } else if (!providers.isEmpty()) {
            Provider erster = activeProvider != null ? activeProvider : providers.get(0);
            kasten = TvViews.hero(this, "ELFIX", "Was möchtest du ansehen?",
                "Wähle einen Anbieter oder durchsuche alle auf einmal.", "", 0,
                erster.name + " öffnen",
                () -> openProvider(erster, erster.lastUrl.isEmpty() ? erster.startUrl : erster.lastUrl),
                "Suchen", () -> showGlobalSearch(""),
                knoepfe, this::heroFokusGeaendert);
        } else {
            kasten = TvViews.hero(this, "ELFIX", "Noch keine Anbieter",
                "Ohne Anbieter gibt es nichts zu zeigen.", "", 0,
                "Einstellungen öffnen", this::showSettings, null, null,
                knoepfe, this::heroFokusGeaendert);
        }
        if (knoepfe[0] != null) knoepfe[0].setTag("tv:hero:0");
        if (knoepfe[1] != null) knoepfe[1].setTag("tv:hero:1");
        kasten.setMinimumHeight(dp(TvViews.heroHoeheDp(this)));
        heroPlatz.addView(kasten, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        if (heroPunkte == null) return;
        heroPunkte.removeAllViews();
        heroPunkte.setVisibility(heroEintraege.size() > 1 ? View.VISIBLE : View.GONE);
        if (heroEintraege.size() > 1) {
            heroPunkte.addView(TvViews.heroPunkte(this, heroEintraege.size(), heroStelle,
                stelle -> {
                    if (stelle == heroStelle) return;
                    heroStelle = stelle;
                    // Nur den Kasten neu zeichnen und nicht die Seite: sonst
                    // verloere der Punkt, auf dem der Fokus gerade steht,
                    // seinen Platz - und mit ihm den Fokus.
                    tvHeroNurBildNeu();
                },
                this::heroFokusGeaendert));
        }
    }

    /**
     * Nur den Kasten des Titelhintergrunds erneuern, die Punkte stehenlassen.
     *
     * <p>Der Fokus steht beim Blaettern auf einem der Punkte. Wuerde die Reihe
     * mit neu gebaut, verschwaende die Ansicht, die ihn haelt, und der Fokus
     * fiele auf den Anfang der Seite zurueck - bei jedem Schritt nach rechts.
     */
    private void tvHeroNurBildNeu() {
        if (heroPlatz == null || heroEintraege.isEmpty()) return;
        boolean warHier = heroPunkte != null && heroPunkte.findFocus() != null;
        tvHeroZeichnen();
        if (!warHier || heroPunkte == null || heroPunkte.getChildCount() == 0) return;
        View reihe = heroPunkte.getChildAt(0);
        if (!(reihe instanceof ViewGroup)) return;
        View punkt = ((ViewGroup) reihe).getChildAt(heroStelle);
        if (punkt != null) punkt.requestFocus();
    }

    /**
     * Die vier Listen auf dem Fernseher.
     *
     * <p>Dieselben Listen, andere Bedienung: die Reiter sind fokussierbare
     * Knoepfe in einer Reihe, damit das Steuerkreuz sie erreicht, und die
     * Eintraege liegen im Raster statt untereinander - auf zwei Metern
     * Entfernung liest sich eine lange Liste nicht.
     */
    private void renderTvBibliothek(Bibliothek liste) {
        LinearLayout page = tvPage();
        page.addView(TvViews.eyebrow(this, "Meine Liste"));
        page.addView(TvViews.heroTitle(this, liste.titel));
        page.addView(TvViews.body(this, liste.untertitel));

        // Die Bilder eines langen Rasters werden erst geholt, wenn ihre Karte
        // in die Naehe des Bildschirms kommt. Eine Mediathek mit
        // zweihundert Titeln waere sonst zweihundert Poster auf einmal.
        Bilder.Sichtfenster fenster = new Bilder.Sichtfenster();

        LinearLayout reiter = tvRow();
        addSpacing(page, reiter, TvViews.ITEM_GAP);
        int reiterStelle = 0;
        for (Bibliothek eintrag : Bibliothek.values()) {
            int anzahl = eintrag.eintraege(bestand).size();
            Button knopf = textButton(anzahl > 0 ? eintrag.titel + "  " + anzahl : eintrag.titel);
            boolean gewaehlt = eintrag == liste;
            knopf.setTextColor(gewaehlt ? Color.WHITE : Theme.TEXT_SECONDARY);
            applyTvFocus(knopf, gewaehlt ? Theme.PRIMARY_DEEP : Theme.SURFACE_ELEVATED, Theme.PRIMARY, 20);
            knopf.setOnClickListener(view -> zeigeBibliothek(eintrag));
            knopf.setTag("tv:reiter:" + reiterStelle);
            addTvRowItem(reiter, knopf, reiterStelle == 0);
            reiterStelle += 1;
        }

        List<Favorite> eintraege = liste.eintraege(bestand);
        if (eintraege.isEmpty()) {
            addSpacing(page, TvViews.emptyState(this, R.drawable.ic_nav_favorite,
                liste.leerTitel, liste.leerText), TvViews.SECTION_GAP);
            tvFokusHerstellen(page);
            return;
        }

        int breite = TvViews.kachelBreiteDp(this);
        int proZeile = Math.max(1, (getResources().getConfiguration().screenWidthDp
            - 2 * TvViews.SCREEN_PADDING + TvViews.ITEM_GAP) / (breite + 16 + TvViews.ITEM_GAP));
        LinearLayout zeile = null;
        for (int i = 0; i < eintraege.size(); i += 1) {
            if (i % proZeile == 0) {
                zeile = tvRow();
                addSpacing(page, zeile, i == 0 ? TvViews.SECTION_GAP : TvViews.ITEM_GAP);
            }
            View karte = tvEintragsKarte(eintraege.get(i), liste, breite, fenster);
            karte.setTag("tv:liste:" + i);
            addTvRowItem(zeile, karte, i % proZeile == 0);
        }

        ScrollView scroll = seitenScroll;
        scroll.setOnScrollChangeListener((ansicht, x, y, altX, altY) -> {
            if (seitenScroll != scroll) return;
            fenster.pruefen(scroll);
        });
        scroll.post(() -> fenster.pruefen(scroll, true));
        tvFokusHerstellen(page);
    }

    /**
     * Eine Kachel der vier Listen - dieselbe Form wie auf der Startseite.
     *
     * <p>Absichtlich dieselbe: derselbe Titel soll auf beiden Seiten gleich
     * aussehen, sonst muss man ihn zweimal lernen.
     */
    private View tvEintragsKarte(Favorite eintrag, Bibliothek liste, int widthDp,
                                 Bilder.Sichtfenster fenster) {
        String titel = cleanFavoriteTitle(eintrag.title(), eintrag.url());
        if (titel.isEmpty()) titel = "Titel";
        String hinweis = eintrag.istAbgeschlossen() ? "Abgeschlossen" : eintrag.folgenText();
        if (liste == Bibliothek.WEITERSCHAUEN && eintrag.wartetAufNaechsteFolge()) {
            hinweis = "Nächste Folge: " + eintrag.folgenText();
        }
        return TvViews.kachel(this, providerForFavorite(eintrag), titel, hinweis,
            eintrag.bild(),
            liste.zeigtFortschritt() && !eintrag.wartetAufNaechsteFolge()
                ? eintrag.fortschrittProzent() : 0,
            eintrag.providerName(), widthDp, fenster,
            () -> openFavorite(eintrag),
            anker -> eintragsMenue(anker, eintrag, liste));
    }

    // --- Meine Geraete -------------------------------------------------------

    /**
     * Der Abschnitt "Meine Geraete" - fuer Telefon und Fernseher aus denselben
     * Bausteinen, aber nicht im selben Zuschnitt.
     *
     * <p>Am Rechner steht das Feld fuer den Schluessel neben vier Knoepfen in
     * einer Zeile. Auf sechs Zoll waeren das vier Ziele von je zwei Zentimetern -
     * also stehen sie hier untereinander und sind jedes so hoch, wie ein Daumen
     * es braucht. Auf dem Fernseher passen sie nebeneinander, weil dort Platz
     * ist und die Fernbedienung ohnehin von Feld zu Feld springt.
     *
     * <p>Die Reihenfolge ist auf beiden dieselbe wie am Rechner: erst der
     * Schluessel, dann was er bewirkt, dann was hinausgeht und was der Server
     * davon sieht. Wer das einmal gelesen hat, findet es auf dem zweiten Geraet
     * an derselben Stelle wieder.
     */
    private void geraeteEinstellungen(LinearLayout page, boolean fernseher) {
        int abstand = fernseher ? TvViews.SECTION_GAP : MobileViews.SECTION_GAP;
        int luecke = fernseher ? TvViews.ITEM_GAP : MobileViews.ITEM_GAP;

        addSpacing(page, fernseher
            ? TvViews.sectionTitle(this, "Meine Geräte")
            : sectionTitle("Meine Geräte"), abstand);

        addSpacing(page, karte(fernseher, "Wozu das gut ist",
            "Hält deine eigenen Geräte auf demselben Stand. Was du am Rechner schaust, steht "
                + "auf dem Handy oder Fernseher in „Weiterschauen“ an derselben Stelle. "
                + "Kein Konto und kein Raum — ein Schlüssel, den nur deine Geräte kennen.",
            null, null), luecke);

        addSpacing(page, schluesselKarte(fernseher), luecke);
        addSpacing(page, geraeteStatusKarte(fernseher), luecke);

        addSpacing(page, karte(fernseher, "Server",
            watchparty.serverUrl().isEmpty()
                ? "Noch keine Adresse eingetragen. Es ist dasselbe Relay wie bei der Watchparty — "
                    + "die Adresse steht dort. Die Watchparty selbst muss dafür nicht eingeschaltet sein."
                : watchparty.serverUrl() + "\n\nDasselbe Relay wie bei der Watchparty. Die Watchparty "
                    + "selbst muss dafür nicht eingeschaltet sein.",
            null, null), luecke);

        addSpacing(page, karte(fernseher, "Was abgeglichen wird",
            "Folge, Stelle, abgeschlossene Titel, die Reihenfolge in der Mediathek — und die "
                + "gemessene Wiedergabezeit, damit der Rückblick auf jedem Gerät alles zusammenzählt "
                + "statt nur die Hälfte.\n\n"
                + "Nicht dabei: selbst gewählte Bilder und der Verlauf je Eintrag — die bleiben auf "
                + "dem Gerät. Einträge einer Watchparty bleiben bei ihrem Raum.",
            null, null), luecke);

        addSpacing(page, karte(fernseher, "Was der Server sieht",
            "Nichts davon. Die Einträge sind mit deinem Schlüssel verschlossen, bevor sie das Gerät "
                + "verlassen; der Schlüssel selbst geht nie hinaus. Sichtbar bleibt, wie viele "
                + "Einträge es gibt und wann sie sich ändern.",
            null, null), luecke);
    }

    /** Eine Karte, die auf beiden Geraeten dasselbe sagt und verschieden aussieht. */
    private View karte(boolean fernseher, String titel, String text, String knopf, Runnable beiKlick) {
        return fernseher
            ? TvViews.infoCard(this, titel, text, knopf, beiKlick)
            : settingsCard(titel, text, knopf, beiKlick);
    }

    /**
     * Der Schluessel: ein Feld und was man damit tun kann.
     *
     * <p>Das Feld steht wirklich da und ist kein Dialog. Einen Schluessel tippt
     * man genau einmal ab, und dabei will man sehen, was man schon hat - auf dem
     * Fernseher erst recht, wo jedes Zeichen einzeln erfahren wird.
     */
    private View schluesselKarte(boolean fernseher) {
        LinearLayout karte = new LinearLayout(this);
        karte.setOrientation(LinearLayout.VERTICAL);
        int rand = dp(fernseher ? 22 : 14);
        karte.setPadding(rand, rand, rand, rand);
        karte.setBackground(MobileViews.shape(this, Theme.SURFACE_ELEVATED,
            MobileViews.CARD_RADIUS, Theme.BORDER, 1));

        TextView kopf = new TextView(this);
        kopf.setText("Schlüssel");
        kopf.setTextColor(Theme.TEXT_PRIMARY);
        kopf.setTextSize(fernseher ? 20 : 16);
        kopf.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        karte.addView(kopf);

        EditText feld = new EditText(this);
        feld.setText(geraeteSchluesselAnzeige());
        feld.setHint("PDWNBCRH-J6KZNF0A-…");
        feld.setSingleLine(true);
        feld.setTextColor(Theme.TEXT_PRIMARY);
        feld.setHintTextColor(Theme.TEXT_DISABLED);
        feld.setTextSize(fernseher ? 18 : 15);
        feld.setTypeface(android.graphics.Typeface.MONOSPACE);
        // Grossschreibung und keine Vorschlaege: ein Schluessel ist kein Wort,
        // und die Autokorrektur macht aus ihm zuverlaessig einen falschen.
        feld.setInputType(android.text.InputType.TYPE_CLASS_TEXT
            | android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
            | android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        feld.setBackground(MobileViews.shape(this, Theme.SURFACE, 12, Theme.BORDER, 1));
        int feldRand = dp(12);
        feld.setPadding(feldRand, feldRand, feldRand, feldRand);
        feld.setFocusable(true);
        feld.setFocusableInTouchMode(true);
        LinearLayout.LayoutParams feldMasse = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        feldMasse.topMargin = dp(10);
        karte.addView(feld, feldMasse);

        TextView hinweis = new TextView(this);
        hinweis.setText("Auf dem ersten Gerät einen Schlüssel erzeugen, auf jedem weiteren denselben "
            + "eintragen. Groß- und Kleinschreibung und die Striche sind egal.");
        hinweis.setTextColor(Theme.TEXT_SECONDARY);
        hinweis.setTextSize(fernseher ? 15 : 13);
        hinweis.setLineSpacing(0, 1.15f);
        LinearLayout.LayoutParams hinweisMasse = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hinweisMasse.topMargin = dp(8);
        karte.addView(hinweis, hinweisMasse);

        // Die Knoepfe. Auf dem Telefon untereinander und jeder ueber die volle
        // Breite - vier nebeneinander waeren vier Ziele von zwei Zentimetern.
        LinearLayout knoepfe = new LinearLayout(this);
        knoepfe.setOrientation(fernseher ? LinearLayout.HORIZONTAL : LinearLayout.VERTICAL);
        LinearLayout.LayoutParams knopfBereich = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        knopfBereich.topMargin = dp(14);
        karte.addView(knoepfe, knopfBereich);

        geraeteKnopf(knoepfe, fernseher, "Übernehmen", true,
            () -> schluesselUebernehmen(feld.getText().toString()));
        geraeteKnopf(knoepfe, fernseher, "Neuen Schlüssel erzeugen", false, this::schluesselNeuFragen);
        geraeteKnopf(knoepfe, fernseher, "Kopieren", false, this::schluesselKopieren);
        if (geraete != null && geraete.eingeschaltet()) {
            geraeteKnopf(knoepfe, fernseher, "Dieses Gerät trennen", false, this::geraetTrennenFragen);
        }
        return karte;
    }

    private void geraeteKnopf(LinearLayout reihe, boolean fernseher, String text,
                              boolean betont, Runnable beiKlick) {
        TextView knopf = new TextView(this);
        knopf.setText(text);
        knopf.setTextColor(Theme.TEXT_PRIMARY);
        knopf.setTextSize(fernseher ? 16 : 14);
        knopf.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        knopf.setGravity(Gravity.CENTER);
        int quer = dp(fernseher ? 20 : 16);
        int hoch = dp(fernseher ? 12 : 10);
        knopf.setPadding(quer, hoch, quer, hoch);
        knopf.setFocusable(true);
        knopf.setFocusableInTouchMode(false);
        GradientDrawable ruhe = MobileViews.shape(this,
            betont ? Theme.PRIMARY_DEEP : Theme.SURFACE_PRESSED, 12, Theme.BORDER, 1);
        GradientDrawable wach = MobileViews.shape(this,
            betont ? Theme.PRIMARY : Theme.PRIMARY_DEEP, 12, Theme.PRIMARY, 2);
        if (fernseher) TvViews.applyFocus(knopf, ruhe, wach);
        else MobileViews.addPressFeedback(knopf, ruhe, wach);
        knopf.setOnClickListener(v -> beiKlick.run());

        LinearLayout.LayoutParams masse = new LinearLayout.LayoutParams(
            fernseher ? ViewGroup.LayoutParams.WRAP_CONTENT : ViewGroup.LayoutParams.MATCH_PARENT,
            dp(fernseher ? 52 : MobileViews.TOUCH_TARGET));
        if (reihe.getChildCount() > 0) {
            if (fernseher) masse.leftMargin = dp(12);
            else masse.topMargin = dp(8);
        }
        reihe.addView(knopf, masse);
    }

    /**
     * Der Status - und zwar in Worten, die etwas heissen.
     *
     * <p>"Nicht verbunden" allein waere keine Auskunft: es kann bedeuten, dass
     * nichts eingerichtet ist, dass die Adresse fehlt, dass das Relay nicht
     * antwortet oder dass der Schluessel nicht passt. Jeder dieser Faelle
     * braucht einen anderen Handgriff, also steht auch jeder einzeln da.
     */
    private View geraeteStatusKarte(boolean fernseher) {
        JSONObject zustand = geraete == null ? null : geraete.zustand();
        boolean an = geraete != null && geraete.eingeschaltet();
        boolean verbunden = zustand != null && zustand.optBoolean("connected", false);
        String fehler = zustand == null ? "" : zustand.optString("error", "");
        // "titel" und nicht "entries": letzteres ist die Groesse des Spiegels
        // und zaehlt Wiedergabesitzungen und Grabsteine mit. Eine Zahl, die
        // "231 Titel" sagt, waehrend die Mediathek leer ist, schickt beim
        // Suchen in die falsche Richtung.
        int titel = zustand == null ? 0 : zustand.optInt("titel", zustand.optInt("entries", 0));
        long zuletzt = zustand == null ? 0 : zustand.optLong("lastSync", 0);

        String text;
        if (!an) {
            text = "Nicht verbunden. Trag oben einen Schlüssel ein oder erzeug einen neuen.";
        } else if (watchparty.serverUrl().isEmpty()) {
            text = "Keine Server-Adresse. Sie steht bei der Watchparty — ohne sie gibt es nichts abzugleichen.";
        } else if (!fehler.isEmpty()) {
            text = "Abgleich fehlgeschlagen: " + fehler
                + "\n\nEs wird von selbst weiter versucht. Dein Stand bleibt so lange hier.";
        } else if (!verbunden) {
            text = "Wird verbunden … Ist das Gerät offline oder das Relay nicht erreichbar, "
                + "wartet ELFIX und versucht es erneut.";
        } else {
            StringBuilder bauen = new StringBuilder("Verbunden");
            bauen.append(titel == 1 ? ", 1 Titel" : ", " + titel + " Titel");
            if (zuletzt > 0) {
                bauen.append(", zuletzt abgeglichen ").append(
                    android.text.format.DateFormat.format("HH:mm", zuletzt));
            }
            bauen.append(".");
            text = bauen.toString();
        }
        return karte(fernseher, "Status", text,
            an ? "Jetzt abgleichen" : null,
            an ? () -> {
                showToast("Wird abgeglichen …");
                // Derselbe Knopf tut dasselbe wie am Rechner: er holt den
                // ganzen Raum noch einmal. Nur nachzusehen, ob etwas hinaus
                // muss, hilft genau dem nicht, der ihn drueckt - wer ihn
                // drueckt, vermisst etwas.
                geraete.vollAbgleichen();
            } : null);
    }

    private String geraeteSchluesselAnzeige() {
        JSONObject zustand = geraete == null ? null : geraete.zustand();
        String ausZustand = zustand == null ? "" : zustand.optString("key", "");
        return ausZustand;
    }

    private void schluesselUebernehmen(String eingabe) {
        if (geraete == null) return;
        if (eingabe == null || eingabe.trim().isEmpty()) {
            showToast("Kein Schlüssel eingetragen");
            return;
        }
        geraete.schluesselSetzen(eingabe, anzeige -> {
            if (anzeige.isEmpty()) {
                showToast("Das ist kein ELFIX-Schlüssel");
                return;
            }
            showToast("Schlüssel übernommen — wird abgeglichen");
            showSettings();
        });
    }

    /**
     * Ein neuer Schluessel trennt dieses Geraet vom bisherigen Verbund.
     *
     * <p>Deshalb die Rueckfrage, und deshalb steht in ihr, was wirklich
     * geschieht: die anderen Geraete behalten ihren Stand, dieses hier findet
     * ihn nur nicht mehr.
     */
    private void schluesselNeuFragen() {
        frage("Neuen Schlüssel erzeugen?",
            geraete != null && geraete.eingeschaltet()
                ? "Dieses Gerät verlässt damit den bisherigen Verbund. Deine anderen Geräte behalten "
                    + "ihren Schlüssel und ihren Stand — dieses hier gleicht sich nicht mehr mit ihnen "
                    + "ab, bis du den neuen Schlüssel auch dort einträgst. Hier gelöscht wird nichts."
                : "Damit fängt der Verbund an. Den neuen Schlüssel trägst du auf jedem weiteren Gerät "
                    + "ein, das mitlaufen soll.",
            () -> geraete.neuerSchluessel(neu -> {
                if (neu.isEmpty()) {
                    showToast("Schlüssel ließ sich nicht erzeugen");
                    return;
                }
                showToast("Neuer Schlüssel erzeugt");
                showSettings();
            }));
    }

    /**
     * Den Schluessel kopieren.
     *
     * <p>Auf dem Telefon ist die Zwischenablage der Weg zum naechsten Geraet.
     * Auf dem Fernseher nuetzt sie wenig - dort steht der Schluessel im Feld
     * darueber und wird abgelesen. Der Knopf bleibt trotzdem: manche
     * Fernbedienungs-Tastaturen fuegen ein, und ein Knopf, der auf einem Geraet
     * weniger kann, ist besser als zwei verschiedene Oberflaechen.
     */
    private void schluesselKopieren() {
        String schluessel = geraeteSchluesselAnzeige();
        if (schluessel.isEmpty()) {
            showToast("Noch kein Schlüssel da");
            return;
        }
        android.content.ClipboardManager ablage =
            (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        if (ablage == null) {
            showToast("Zwischenablage nicht verfügbar");
            return;
        }
        ablage.setPrimaryClip(android.content.ClipData.newPlainText("ELFIX", schluessel));
        showToast("Schlüssel kopiert");
    }

    private void geraetTrennenFragen() {
        frage("Dieses Gerät trennen?",
            "Nur dieses. Deine anderen Geräte behalten ihren Schlüssel und ihren Stand. "
                + "Hier bleibt alles stehen, was du geschaut hast — es läuft nur nicht mehr mit.",
            () -> {
                geraete.trennen();
                showToast("Getrennt");
                showSettings();
            });
    }

    /**
     * Intro ueberspringen - eine Karte fuer beide Geraete.
     *
     * <p>Der Text sagt, warum nichts dasteht, solange nichts gelernt wurde: eine
     * Funktion, die auf zwei uebereinstimmende Spruenge wartet, sieht sonst
     * kaputt aus. Ohne Rahmenzugriff sagt sie das ebenfalls, statt einen
     * Schalter anzubieten, der nichts bewirkt.
     */
    private View introKarte(boolean fernseher) {
        boolean moeglich = Rahmen.verfuegbar();
        boolean an = moeglich && marken != null && marken.eingeschaltet();
        String text;
        if (!moeglich) {
            text = "Auf diesem Gerät nicht möglich: die System-WebView ist zu alt, um in den "
                + "Rahmen des Hosters zu sehen. Ein Update der Android System WebView genügt.";
        } else if (an) {
            text = "Spulst du das Intro zweimal an derselben Stelle weg, steht ab der nächsten "
                + "Folge ein Knopf dafür da.";
        } else {
            text = "Aus. Es wird weder gelernt noch ein Knopf angeboten.";
        }
        Runnable umschalten = () -> {
            if (marken == null) return;
            marken.einschalten(!marken.eingeschaltet());
            showSettings();
        };
        String knopf = moeglich ? (an ? "Ausschalten" : "Einschalten") : null;
        View karte = fernseher
            ? TvViews.infoCard(this, "Intro überspringen", text, knopf, moeglich ? umschalten : null)
            : settingsCard("Intro überspringen", text, knopf, moeglich ? umschalten : null);
        if (an) introStandNachtragen(karte);
        return karte;
    }

    /** Traegt nach, wie viel gelernt wurde, sobald der Kern geantwortet hat. */
    private void introStandNachtragen(View karte) {
        marken.stand(bericht -> {
            if (bericht == null || karte == null) return;
            int gelernt = bericht.optInt("marken", 0);
            if (gelernt <= 0) return;
            TextView koerper = karte.findViewWithTag("karten-text");
            if (koerper == null) return;
            koerper.setText(gelernt == 1
                ? "Für eine Staffel gelernt. Der Knopf steht dort ab der nächsten Folge."
                : "Für " + gelernt + " Staffeln gelernt. Der Knopf steht dort ab der nächsten Folge.");
        });
    }

    /**
     * Sprachfassung merken - eine Karte fuer beide Geraete.
     *
     * <p>Der Text nennt, was wirklich gemerkt wurde, statt nur "an" oder
     * "aus": eine Funktion, die aus dem eigenen Verhalten lernt, muss zeigen
     * koennen, was sie gelernt hat - sonst ist sie nicht nachvollziehbar. Die
     * Auskunft kommt aus dem Kern und damit aus demselben Bestand, der auch
     * vorwaehlt; deshalb wird die Karte nachtraeglich beschriftet.
     */
    private View fassungsKarte(boolean fernseher) {
        boolean an = fassungen != null && fassungen.eingeschaltet();
        String text = an
            ? "Womit du eine Serie angefangen hast, steht ab der zweiten Folge vorgewählt da."
            : "Aus. Jede Folge startet in der Fassung, die der Anbieter vorgibt.";
        Runnable umschalten = () -> {
            if (fassungen == null) return;
            fassungen.einschalten(!fassungen.eingeschaltet());
            showSettings();
        };
        View karte = fernseher
            ? TvViews.infoCard(this, "Sprachfassung merken", text, an ? "Ausschalten" : "Einschalten", umschalten)
            : settingsCard("Sprachfassung merken", text, an ? "Ausschalten" : "Einschalten", umschalten);
        if (an && fassungen != null) fassungsStandNachtragen(karte);
        return karte;
    }

    /** Traegt nach, was gemerkt wurde, sobald der Kern geantwortet hat. */
    private void fassungsStandNachtragen(View karte) {
        fassungen.stand(bericht -> {
            if (bericht == null || karte == null) return;
            int titel = bericht.optInt("titel", 0);
            if (titel <= 0) return;
            org.json.JSONArray fassungsListe = bericht.optJSONArray("fassungen");
            StringBuilder text = new StringBuilder();
            text.append(titel == 1 ? "Für einen Titel gemerkt" : "Für " + titel + " Titel gemerkt");
            if (fassungsListe != null && fassungsListe.length() > 0) {
                text.append(": ");
                for (int i = 0; i < fassungsListe.length() && i < 3; i += 1) {
                    org.json.JSONObject eintrag = fassungsListe.optJSONObject(i);
                    if (eintrag == null) continue;
                    if (i > 0) text.append(", ");
                    text.append(eintrag.optString("name"))
                        .append(" (").append(eintrag.optInt("anzahl")).append(")");
                }
            }
            text.append(".");
            TextView koerper = karte.findViewWithTag("karten-text");
            if (koerper != null) koerper.setText(text.toString());
        });
    }

    private void renderTvSettings() {
        LinearLayout page = tvPage();
        page.addView(TvViews.eyebrow(this, "ELFIX"));
        page.addView(TvViews.heroTitle(this, "Einstellungen"));

        addSpacing(page, TvViews.infoCard(this, "Werbeblocker",
            "AdGuard-Filterlisten (Basis, Mobile Ads, Tracking-Schutz) sind aktiv. Innerhalb des "
                + "Video-Hosters wird bewusst zurückhaltender gefiltert, damit die Wiedergabe startet.",
            null, null), TvViews.SECTION_GAP);

        addSpacing(page, TvViews.infoCard(this, "Volle Regeln",
            werbefilter == null ? "" : werbefilter.standText(),
            regelKnopf(), this::regelModusUmschalten), TvViews.ITEM_GAP);

        addSpacing(page, TvViews.infoCard(this, "Filterlisten",
            Filterlisten.standText(this),
            "Jetzt aktualisieren", this::filterlistenLaden), TvViews.ITEM_GAP);

        addSpacing(page, TvViews.infoCard(this, "Favoriten-Fortschritt",
            folgeStatisch()
                ? "Der Eintrag bleibt auf der gespeicherten Folge stehen."
                : "Der Eintrag rückt mit, wenn du zur nächsten Folge blätterst.",
            folgeStatisch() ? "Mitrücken lassen" : "Stehen lassen",
            () -> {
                favoriteProgressMode = folgeStatisch() ? "sequential" : "static";
                getSharedPreferences("elflix_settings", MODE_PRIVATE)
                    .edit().putString("favorite_progress_mode", favoriteProgressMode).apply();
                showToast("Gespeichert");
                showSettings();
            }), TvViews.ITEM_GAP);

        addSpacing(page, autoplayKarte(true), TvViews.ITEM_GAP);

        addSpacing(page, introKarte(true), TvViews.ITEM_GAP);

        addSpacing(page, fassungsKarte(true), TvViews.ITEM_GAP);

        addSpacing(page, TvViews.infoCard(this, "Zwischenspeicher",
            "Lädt alle Anbieter neu und leert den Cache. Cookies und Anmeldungen bleiben erhalten.",
            "Alles neu laden", this::reloadAllWebViews), TvViews.ITEM_GAP);

        watchpartyEinstellungen(page, true);

        geraeteEinstellungen(page, true);

        addSpacing(page, aktualisierungsKarte(true), TvViews.ITEM_GAP);
    }

    private void renderTvSearch(String query) {
        LinearLayout page = tvPage();
        page.addView(TvViews.eyebrow(this, "Alle Anbieter"));
        page.addView(TvViews.heroTitle(this, "Suche"));

        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint("Serien, Anime und Filme suchen");
        input.setText(query);
        input.setTextColor(Theme.TEXT_PRIMARY);
        input.setHintTextColor(Theme.TEXT_SECONDARY);
        input.setTextSize(18);
        input.setPadding(dp(18), 0, dp(18), 0);
        input.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH);
        input.setBackground(TvViews.shape(this, Theme.SURFACE_ELEVATED, TvViews.CARD_RADIUS, Theme.BORDER, 1));
        input.setOnFocusChangeListener((view, focused) -> input.setBackground(TvViews.shape(this,
            Theme.SURFACE_ELEVATED, TvViews.CARD_RADIUS, focused ? Theme.PRIMARY : Theme.BORDER, focused ? 3 : 1)));
        input.setOnEditorActionListener((view, actionId, event) -> {
            showGlobalSearch(input.getText().toString().trim());
            return true;
        });
        searchInput = input;
        LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(60));
        inputParams.topMargin = dp(TvViews.SECTION_GAP);
        page.addView(input, inputParams);
        input.post(input::requestFocus);

        if (query.isEmpty()) {
            addSpacing(page, TvViews.infoCard(this, "Was suchst du?",
                "Gib einen Titel ein - ELFIX durchsucht alle Anbieter gleichzeitig.", null, null),
                TvViews.SECTION_GAP);
            return;
        }

        LinearLayout holder = new LinearLayout(this);
        holder.setOrientation(LinearLayout.VERTICAL);
        addSpacing(page, holder, TvViews.SECTION_GAP);
        holder.addView(TvViews.sectionTitle(this, "Ergebnisse"));
        TextView loading = TvViews.body(this, "Suche bei allen Anbietern ...");
        holder.addView(loading);
        searchAllProvidersTv(query, holder, loading);
    }

    private void searchAllProvidersTv(String query, LinearLayout holder, View loading) {
        new Thread(() -> {
            ArrayList<SearchResult> found = new ArrayList<>();
            for (Provider provider : providers) {
                for (String variant : searchQueryVariants(query)) {
                    ArrayList<SearchResult> results =
                        fetchSearchResults(provider, provider.buildSearchUrl(variant), variant);
                    if (!results.isEmpty()) {
                        found.addAll(results);
                        break;
                    }
                }
            }
            runOnUiThread(() -> {
                holder.removeView(loading);
                if (found.isEmpty()) {
                    holder.addView(TvViews.body(this, "Keine direkten Treffer gefunden."));
                    return;
                }
                int width = tvCardWidthDp(200, 160);
                int perRow = Math.max(1, (getResources().getConfiguration().screenWidthDp
                    - 2 * TvViews.SCREEN_PADDING + TvViews.ITEM_GAP) / (width + TvViews.ITEM_GAP));
                LinearLayout row = null;
                int shown = 0;
                for (SearchResult result : found) {
                    if (shown >= 24) break;
                    if (shown % perRow == 0) {
                        row = tvRow();
                        LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                        rowParams.topMargin = dp(TvViews.ITEM_GAP);
                        holder.addView(row, rowParams);
                    }
                    String meta = result.genre == null || result.genre.isEmpty()
                        ? result.provider.name : result.genre;
                    // Ein Suchtreffer hat noch keinen Fortschritt und kein Menue -
                    // aber ein Titelbild, wenn die Trefferseite eines hergab.
                    addTvRowItem(row, TvViews.favoriteCard(this, result.provider, result.title, meta,
                        result.provider.name, result.bild, width, 0,
                        () -> openProvider(result.provider, result.url), null),
                        shown % perRow == 0);
                    shown += 1;
                }
            });
        }).start();
    }

    /** Scrollable page shell with the shared mobile spacing already applied. */
    private LinearLayout mobilePage() {
        ScrollView scroll = new ScrollView(this);
        seitenScroll = scroll;
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Theme.BACKGROUND);
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(MobileViews.SCREEN_PADDING), dp(4), dp(MobileViews.SCREEN_PADDING), dp(24));
        scroll.addView(page, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        content.addView(scroll, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        return page;
    }

    private void addSpacing(LinearLayout page, View view, int topMarginDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(topMarginDp);
        page.addView(view, params);
    }

    /**
     * Die Startseite des Telefons.
     *
     * <p>Sie zeigt dasselbe wie die des Rechners und in derselben Reihenfolge -
     * Titelhintergrund, was laeuft, was gemerkt ist, was vorgeschlagen wird -,
     * aber nicht in derselben Form. Am Rechner stehen Kachelreihen nebeneinander
     * in einem breiten Fenster; hier laeuft jede Reihe unter dem Daumen nach
     * rechts weiter, und der Titelhintergrund steht hochkant statt quer.
     *
     * <p>Der Anbieterrost bleibt, obwohl der Rechner ihn in der Seitenleiste
     * fuehrt: auf einem Telefon gibt es keine Seitenleiste, und die Anbieter
     * sind der Weg zu allem, was ELFIX nicht selbst weiss.
     */
    private void renderMobileHome() {
        LinearLayout page = mobilePage();
        empfehlungenNachfuehren();
        liveKachelnZuruecksetzen();
        if (kalender != null) kalender.anbieterSetzen(providers);

        List<Favorite> laufend = bestand.weiterschauen();
        heroEintraege = new ArrayList<>(laufend.subList(0, Math.min(HERO_ANZAHL, laufend.size())));
        if (heroStelle >= heroEintraege.size()) heroStelle = 0;

        // Das Titelbild laesst sich abschalten - wie am Rechner. Die Plaetze
        // werden trotzdem angelegt: der Wechseltakt zeichnet sie fuer sich neu
        // und traefe sonst auf null.
        heroPlatz = new FrameLayout(this);
        heroPunkte = new LinearLayout(this);
        heroPunkte.setOrientation(LinearLayout.HORIZONTAL);
        heroPunkte.setGravity(Gravity.CENTER);
        if (zeigt(Startseite.HERO)) {
            addSpacing(page, heroPlatz, 4);
            addSpacing(page, heroPunkte, 8);
            heroZeichnen();
            heroWechselPlanen();
        }

        View search = MobileViews.searchEntry(this, "Serien, Anime und Filme suchen",
            () -> showGlobalSearch(""));
        LinearLayout.LayoutParams searchParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        searchParams.topMargin = dp(zeigt(Startseite.HERO) ? 16 : 4);
        page.addView(search, searchParams);

        // Was schon laeuft, steht oben - dieselbe Reihenfolge wie am Rechner:
        // Neue Folgen, Weiterschauen, Gemeinsam weiterschauen, YouTube. Der
        // Anbieterrost stand hier bisher davor, weil es auf dem Telefon keine
        // Seitenleiste gibt und die Anbieter der Weg zu allem sind. Das stimmt
        // weiterhin - nur gehoert er nicht *vor* das, was man gerade schaut:
        // wer weiterschauen will, sollte dafuer nicht an drei Reihen
        // vorbeiblaettern muessen. Leere Reihen fallen ohnehin weg statt als
        // leerer Kasten dazustehen.
        boolean etwasGezeigt = neueFolgenReihe(page);
        List<Favorite> privat = new ArrayList<>();
        List<Favorite> gemeinsam = new ArrayList<>();
        List<Favorite> videos = new ArrayList<>();
        for (Favorite eintrag : laufend) {
            // YouTube zuerst aussortieren, nicht zuletzt: sonst stuende ein
            // angefangenes Video sowohl hier als auch in seiner eigenen Reihe.
            if (youtube != null && youtube.istYoutube(eintrag)) videos.add(eintrag);
            else if (eintrag.watchpartyRaum().isEmpty()) privat.add(eintrag);
            else gemeinsam.add(eintrag);
        }
        if (zeigt(Startseite.WEITERSCHAUEN)) {
            etwasGezeigt |= kachelReihe(page, "Weiterschauen", privat, Bibliothek.WEITERSCHAUEN, 8);
            etwasGezeigt |= kachelReihe(page, "Gemeinsam weiterschauen", gemeinsam,
                Bibliothek.WEITERSCHAUEN, 8);
        }
        if (zeigt(Startseite.YOUTUBE)) {
            etwasGezeigt |= kachelReihe(page, "YouTube weiterschauen", videos,
                Bibliothek.WEITERSCHAUEN, 8);
        }

        addSpacing(page, MobileViews.sectionHeader(this, "Deine Anbieter", null, null), MobileViews.SECTION_GAP);
        addSpacing(page, providerGrid(), MobileViews.ITEM_GAP);
        kalenderReihe(page);

        if (zeigt(Startseite.WEITERSCHAUEN)) {
            etwasGezeigt |= kachelReihe(page, Bibliothek.WATCHLIST.titel,
                bestand.watchlist(), Bibliothek.WATCHLIST, 12);
            etwasGezeigt |= kachelReihe(page, Bibliothek.MEDIATHEK.titel,
                bestand.mediathek(), Bibliothek.MEDIATHEK, 12);
        }
        if (!etwasGezeigt && zeigt(Startseite.WEITERSCHAUEN)) {
            addSpacing(page, MobileViews.sectionHeader(this, "Weiterschauen", null, null),
                MobileViews.SECTION_GAP);
            addSpacing(page, settingsCard("Noch nichts angefangen",
                "Öffne einen Anbieter und sieh dir etwas an. ELFIX merkt sich die Folge und "
                    + "die Stelle und schlägt sie dir hier wieder vor.", null, null), MobileViews.ITEM_GAP);
        }

        rueckblicksReihe(page);

        if (zeigt(Startseite.PERSOENLICH)) {
            vorschlagsReihe(page, Empfehlungen.NEUES, "Neu bei deinen Anbietern", null, null);
            vorschlagsReihe(page, Empfehlungen.FUER_DICH, "Empfohlen für dich",
                "Neu berechnen", () -> {
                    empfehlungen.neuBerechnen();
                    showToast("Empfehlungen werden neu berechnet");
                });
        }
        if (zeigt(Startseite.KATEGORIEN)) {
            vorschlagsReihe(page, Empfehlungen.ANIME, "Anime für dich", "Mehr anzeigen",
                () -> zeigeEntdeckung(Empfehlungen.ANIME));
            vorschlagsReihe(page, Empfehlungen.SERIE, "Serien für dich", "Mehr anzeigen",
                () -> zeigeEntdeckung(Empfehlungen.SERIE));
            vorschlagsReihe(page, Empfehlungen.FILM, "Filme für dich", "Mehr anzeigen",
                () -> zeigeEntdeckung(Empfehlungen.FILM));
        }
        // Ist alles abgeschaltet, steht sonst nur die Suche da und die Seite
        // sieht kaputt aus. Der Weg zurueck gehoert dorthin, wo der Mangel
        // auffaellt - nicht in eine Einstellung, die man erst suchen muss.
        if (startseite != null && startseite.anzahlAn() == 0) {
            addSpacing(page, MobileViews.hinweis(this,
                "Alle Reihen der Startseite sind ausgeblendet.", "Reihen einblenden",
                () -> {
                    startseite.zuruecksetzen();
                    showHome();
                }), MobileViews.SECTION_GAP);
        }
        liveTaktPlanen();
    }

    /**
     * Die alten Kacheln vergessen, bevor die Startseite neu entsteht.
     *
     * <p>Sonst zoege der Takt Ansichten nach, die niemand mehr sieht - und
     * die Liste wuechse mit jedem Zeichnen.
     */
    private void liveKachelnZuruecksetzen() {
        liveTakt.removeCallbacksAndMessages(null);
        liveKacheln.clear();
    }

    /** Ob diese Reihe der Startseite eingeschaltet ist. Ohne Einstellung: ja. */
    private boolean zeigt(String schluessel) {
        return startseite == null || startseite.zeigt(schluessel);
    }

    /**
     * Der Satz ueber einer Reihe, deren Inhalt von der Platte kommt.
     *
     * <p>"Ohne Netz" steht nur da, wenn gerade wirklich keine Leitung da ist.
     * Sonst hiesse es das auch noch, wenn das Netz laengst zurueck ist und nur
     * der letzte Abruf danebenging - eine Behauptung ueber einen Zustand, den
     * die Zeile nicht kennt.
     */
    private String altHinweis(String alter) {
        String stand = alter == null || alter.isEmpty() ? "vom letzten Mal" : alter;
        return Netz.vorhanden(this)
            ? "Gerade nicht erreichbar - Stand " + stand + "."
            : "Ohne Netz - Stand " + stand + ".";
    }

    /**
     * Die Reihe "Diese Woche".
     *
     * <p>Der Kalender ist am Rechner eine eigene Seite in der Seitenleiste. Auf
     * dem Telefon gibt es keine Seitenleiste, und eine Seite, die man erst
     * finden muss, wird nicht gefunden - also steht er als Reihe da, mit
     * "Alle anzeigen" auf die volle Woche.
     *
     * <p>Vier Zustaende, wie bei den Vorschlagsreihen: gefuellt, wird geholt,
     * geht nicht, und "diese Woche kommt nichts". Nur der letzte laesst die
     * Reihe ganz verschwinden.
     */
    private void kalenderReihe(LinearLayout page) {
        if (kalender == null || !zeigt(Startseite.KALENDER)) return;
        kalender.anfordern(false);

        List<Kalender.Eintrag> eintraege = kalender.eintraege();
        String fehler = kalender.fehler();
        boolean fertigUndLeer = eintraege.isEmpty() && fehler.isEmpty()
            && kalender.geladen() && !kalender.laedt();
        // Dieselbe Unterscheidung wie bei den Vorschlagsreihen: ohne Leitung
        // heisst leer nicht leer, sondern unbekannt.
        boolean ohneNetz = fertigUndLeer && !Netz.vorhanden(this);
        if (fertigUndLeer && !ohneNetz) return;

        addSpacing(page, MobileViews.sectionHeader(this, "Diese Woche",
            eintraege.isEmpty() ? null : "Alle anzeigen", this::zeigeKalender),
            MobileViews.SECTION_GAP);

        if (!fehler.isEmpty() || ohneNetz) {
            addSpacing(page, MobileViews.hinweis(this,
                ohneNetz
                    ? "Keine Verbindung - der Kalender kommt von deinen Anbietern."
                    : "Der Kalender konnte nicht geladen werden.",
                "Erneut versuchen",
                () -> kalender.erneutVersuchen()), MobileViews.ITEM_GAP);
            return;
        }
        int breite = kachelBreiteDp();
        if (eintraege.isEmpty()) {
            addSpacing(page, MobileViews.reihenSkelett(this, breite, 5), MobileViews.ITEM_GAP);
            return;
        }
        if (kalender.istAlt()) {
            addSpacing(page, MobileViews.hinweis(this, altHinweis(kalender.alter()),
                "Erneut versuchen", () -> kalender.erneutVersuchen()), 0);
        }

        // Ab heute, nicht ab Montag: was gestern lief, hilft niemandem mehr.
        List<Kalender.Eintrag> ab = new ArrayList<>();
        List<String> tage = kalender.tage();
        int start = Math.max(0, tage.indexOf(Kalender.heutigerTag()));
        for (int i = 0; i < tage.size() && ab.size() < 12; i += 1) {
            ab.addAll(kalender.anTag(tage.get((start + i) % tage.size())));
        }

        ArrayList<View> karten = new ArrayList<>();
        for (Kalender.Eintrag eintrag : ab.subList(0, Math.min(12, ab.size()))) {
            karten.add(kalenderKarte(eintrag, breite));
        }
        reiheAnhaengen(page, MobileViews.reihe(this, karten, breite), MobileViews.ITEM_GAP);
    }

    private View kalenderKarte(Kalender.Eintrag eintrag, int breite) {
        String fahne = eintrag.tag.isEmpty() ? "" : eintrag.tag.substring(0, 2);
        if (!eintrag.uhrzeit.isEmpty()) fahne = fahne + " " + eintrag.uhrzeit;
        String unterzeile = zusammen(eintrag.folgenText(), eintrag.sprache);
        if (unterzeile.isEmpty()) unterzeile = eintrag.anbieterName;
        return MobileViews.kachel(this, providerMitId(eintrag.anbieterId),
            eintrag.titel.isEmpty() ? "Titel" : eintrag.titel, unterzeile, eintrag.bild, 0,
            fahne, breite,
            () -> kalenderEintragOeffnen(eintrag), null);
    }

    private void kalenderEintragOeffnen(Kalender.Eintrag eintrag) {
        Provider provider = providerMitId(eintrag.anbieterId);
        if (provider == null || eintrag.url.isEmpty()) {
            showToast("Zu diesem Eintrag ist keine Seite bekannt");
            return;
        }
        openProvider(provider, eintrag.url);
    }

    /**
     * Die ganze Woche.
     *
     * <p>Ein Reiter je Wochentag, darunter die Eintraege dieses Tages als
     * senkrechte Liste. Am Rechner steht dieselbe Ansicht in der Seitenleiste;
     * die Filter nach Art und Fassung fehlen hier bewusst - auf einem Telefon
     * traegt eine Woche selten mehr als ein paar Dutzend Eintraege, und zwei
     * Filterleisten uebereinander kosten mehr Platz, als sie sparen.
     */
    void zeigeKalender() {
        currentScreen = "kalender";
        activeProvider = null;
        content.removeAllViews();
        updateBottomNav();
        if (kalender != null) {
            kalender.anbieterSetzen(providers);
            kalender.anfordern(false);
        }

        LinearLayout page = mobilePage();
        page.addView(MobileViews.eyebrow(this, "ELFIX"));
        page.addView(MobileViews.heroTitle(this, "Kalender"));
        addSpacing(page, MobileViews.subtitle(this, "Was diese Woche bei deinen Anbietern erscheint."), 0);

        if (kalender == null) return;
        String fehler = kalender.fehler();
        if (!fehler.isEmpty()) {
            addSpacing(page, MobileViews.hinweis(this,
                "Der Kalender konnte nicht geladen werden. Ohne ihn funktioniert alles Übrige weiter.",
                "Erneut versuchen", () -> kalender.erneutVersuchen()), MobileViews.SECTION_GAP);
            return;
        }
        List<Kalender.Eintrag> alle = kalender.eintraege();
        if (alle.isEmpty()) {
            String text;
            if (kalender.laedt()) text = "Der Kalender wird geladen …";
            else if (!Netz.vorhanden(this)) {
                text = "Keine Verbindung. Der Kalender kommt von den Seiten deiner Anbieter - "
                    + "ohne Netz gibt es nichts zu zeigen und nichts Gespeichertes.";
            } else text = "Für diese Woche ist bei deinen Anbietern nichts eingetragen.";
            addSpacing(page, MobileViews.hinweis(this, text,
                kalender.laedt() ? null : "Erneut versuchen",
                kalender.laedt() ? null : () -> kalender.erneutVersuchen()), MobileViews.SECTION_GAP);
            return;
        }
        if (kalender.istAlt()) {
            addSpacing(page, MobileViews.hinweis(this,
                "Ohne Netz - Stand " + kalender.alter() + ".", "Erneut versuchen",
                () -> kalender.erneutVersuchen()), MobileViews.ITEM_GAP);
        }

        if (kalenderTag.isEmpty() || kalender.anTag(kalenderTag).isEmpty()) {
            kalenderTag = kalender.ersterTagMitInhalt();
        }
        ArrayList<View> reiter = new ArrayList<>();
        for (String tag : kalender.tage()) {
            int anzahl = kalender.anTag(tag).size();
            String datum = kalender.datumVon(tag);
            reiter.add(MobileViews.reiter(this, tag.substring(0, 2),
                anzahl > 0 ? String.valueOf(anzahl) : "–", tag.equals(kalenderTag),
                () -> {
                    kalenderTag = tag;
                    zeigeKalender();
                }));
            if (!datum.isEmpty() && tag.equals(kalenderTag)) {
                // Das Datum steht unter der Leiste und nicht im Reiter: dort
                // waere es auf einem schmalen Telefon nicht mehr zu lesen.
                kalenderDatumText = Rueckblick.datum(datum, false);
            }
        }
        reiheAnhaengen(page, MobileViews.reiterLeiste(this, reiter), MobileViews.SECTION_GAP);

        List<Kalender.Eintrag> desTages = kalender.anTag(kalenderTag);
        addSpacing(page, MobileViews.sectionHeader(this,
            kalenderTag + (kalenderDatumText.isEmpty() ? "" : ", " + kalenderDatumText),
            null, null), MobileViews.SECTION_GAP);
        if (desTages.isEmpty()) {
            addSpacing(page, settingsCard("Nichts eingetragen",
                "An diesem Tag kündigt keiner deiner Anbieter etwas an.", null, null),
                MobileViews.ITEM_GAP);
            return;
        }
        for (Kalender.Eintrag eintrag : desTages) {
            addSpacing(page, kalenderZeile(eintrag), MobileViews.ITEM_GAP);
        }
    }

    /** Eine Zeile der Kalenderansicht - Uhrzeit, Titel, Folge und Fassung. */
    private View kalenderZeile(Kalender.Eintrag eintrag) {
        String unten = zusammen(eintrag.folgenText(), eintrag.sprache, eintrag.anbieterName);
        return settingsCard(
            (eintrag.uhrzeit.isEmpty() ? "" : eintrag.uhrzeit + "  ")
                + (eintrag.titel.isEmpty() ? "Titel" : eintrag.titel),
            unten, "Öffnen", () -> kalenderEintragOeffnen(eintrag));
    }

    /* --------------------------------------------------------- Der Rueckblick */

    /**
     * Die Reihe "Dein Rückblick" auf der Startseite.
     *
     * <p>Am Rechner ist der Rückblick ein Eintrag in der Seitenleiste und der
     * Jahresrückblick ein dezenter Hinweis im Dezember. Auf dem Telefon gibt es
     * keine Seitenleiste, also steht hier eine Karte - und zwar nur, wenn
     * überhaupt etwas gemessen wurde. Eine Karte, die "0 Stunden" sagt, ist
     * keine Einladung, sondern ein Vorwurf.
     */
    private void rueckblicksReihe(LinearLayout page) {
        if (statistik == null || !zeigt(Startseite.RUECKBLICK) || !statistik.hatDaten()) return;
        addSpacing(page, MobileViews.sectionHeader(this, "Dein Rückblick", "Alle Zahlen",
            () -> zeigeRueckblick("alles")), MobileViews.SECTION_GAP);
        addSpacing(page, settingsCard("Was du geschaut hast",
            "Gemessene Wiedergabezeit, Folgen, Schautage und deine meistgesehenen Titel.",
            "Öffnen", () -> zeigeRueckblick("alles")), MobileViews.ITEM_GAP);
    }

    /**
     * Der Rückblick.
     *
     * <p>Er holt seine Zahlen bei jedem Aufruf frisch: die Auswertung läuft über
     * alle Sitzungen und ist damit die eine Rechnung, die nicht gehalten werden
     * sollte - eine Folge, die gerade lief, gehört sofort dazu.
     */
    private void zeigeRueckblick(String zeitraum) {
        currentScreen = "rueckblick";
        activeProvider = null;
        rueckblickZeitraum = zeitraum == null ? "alles" : zeitraum;
        content.removeAllViews();
        updateBottomNav();

        LinearLayout page = mobilePage();
        page.addView(MobileViews.eyebrow(this, "ELFIX"));
        page.addView(MobileViews.heroTitle(this, "Rückblick"));

        if (statistik == null || !statistik.hatDaten()) {
            addSpacing(page, settingsCard("Noch nichts gemessen",
                "ELFIX zählt die wirklich abgespielten Sekunden, sobald du etwas ansiehst. "
                    + "Was hier steht, ist gemessen und nicht geschätzt - deshalb steht am Anfang "
                    + "nichts.", null, null), MobileViews.SECTION_GAP);
            return;
        }

        ArrayList<View> reiter = new ArrayList<>();
        String[][] zeitraeume = {
            {"7tage", "7 Tage"}, {"30tage", "30 Tage"}, {"jahr", "Dieses Jahr"}, {"alles", "Alles"}
        };
        for (String[] eintrag : zeitraeume) {
            reiter.add(MobileViews.reiter(this, eintrag[1], null,
                eintrag[0].equals(rueckblickZeitraum), () -> zeigeRueckblick(eintrag[0])));
        }
        reiheAnhaengen(page, MobileViews.reiterLeiste(this, reiter), MobileViews.ITEM_GAP);

        LinearLayout platz = new LinearLayout(this);
        platz.setOrientation(LinearLayout.VERTICAL);
        addSpacing(page, platz, MobileViews.ITEM_GAP);
        addSpacing(platz, MobileViews.hinweis(this, "Zahlen werden zusammengestellt …", null, null), 0);

        String angefragt = rueckblickZeitraum;
        statistik.auswerten(angefragt, (daten, fehler) -> {
            // Zwischenzeitlich woandershin? Dann gehoert die Antwort nirgends
            // mehr hin - und der Platz, in den sie soll, ist abgehaengt.
            if (!"rueckblick".equals(currentScreen) || !angefragt.equals(rueckblickZeitraum)) return;
            platz.removeAllViews();
            if (fehler != null || daten == null) {
                platz.addView(MobileViews.hinweis(this,
                    "Die Zahlen konnten nicht berechnet werden.", "Erneut versuchen",
                    () -> zeigeRueckblick(angefragt)));
                return;
            }
            int jahr = java.util.Calendar.getInstance().get(java.util.Calendar.YEAR);
            addSpacing(platz, settingsCard("Jahresrückblick " + jahr,
                "Dein Jahr als Geschichte - dieselben Zahlen, in Karten erzählt.",
                "Ansehen", () -> zeigeWrapped(jahr)), MobileViews.ITEM_GAP);
            for (View stueck : Rueckblick.statistik(this, daten)) {
                addSpacing(platz, stueck, 0);
            }
        });
    }

    /**
     * Der Jahresrückblick.
     *
     * <p>Karte für Karte, wie am Rechner. Weitergeblättert wird durch Tippen -
     * das ist auf einem Telefon die Geste, die alle kennen; die Pfeiltasten des
     * Rechners gibt es hier nicht.
     */
    private void zeigeWrapped(int jahr) {
        currentScreen = "wrapped";
        activeProvider = null;
        wrappedJahr = jahr;
        content.removeAllViews();
        updateBottomNav();

        LinearLayout page = mobilePage();
        page.addView(MobileViews.eyebrow(this, "ELFIX Wrapped"));
        page.addView(MobileViews.heroTitle(this, String.valueOf(jahr)));

        if (statistik == null) return;
        LinearLayout platz = new LinearLayout(this);
        platz.setOrientation(LinearLayout.VERTICAL);
        addSpacing(page, platz, MobileViews.ITEM_GAP);
        addSpacing(platz, MobileViews.hinweis(this, "Dein Jahr wird zusammengestellt …", null, null), 0);

        statistik.auswerten(String.valueOf(jahr), (daten, fehler) -> {
            if (!"wrapped".equals(currentScreen) || wrappedJahr != jahr) return;
            platz.removeAllViews();
            if (fehler != null || daten == null) {
                platz.addView(MobileViews.hinweis(this,
                    "Der Jahresrückblick konnte nicht gebaut werden.", "Erneut versuchen",
                    () -> zeigeWrapped(jahr)));
                return;
            }
            wrappedSeiten = Rueckblick.wrapped(this, daten, jahr);
            if (wrappedStelle >= wrappedSeiten.size()) wrappedStelle = 0;
            wrappedPlatz = platz;
            wrappedZeichnen();
        });
    }

    /**
     * Es sind Sitzungen von einem anderen eigenen Geraet hereingekommen.
     *
     * <p>Steht eine Bilanz gerade offen, rechnet sie neu. Ohne das stimmten die
     * Zahlen erst nach einem Neustart - und ein Rückblick, den man aufhat,
     * während der Abgleich läuft, zeigte weiter die Werte dieses einen Geräts.
     *
     * <p>Beim Wrapped bleibt die aufgeschlagene Karte stehen: die Seite wird
     * neu gerechnet, nicht zurückgeblättert.
     */
    private void statistikGeaendert() {
        if ("rueckblick".equals(currentScreen)) {
            zeigeRueckblick(rueckblickZeitraum);
            return;
        }
        if ("wrapped".equals(currentScreen)) zeigeWrapped(wrappedJahr);
    }

    /**
     * Eine Karte des Jahresrückblicks zeichnen - und nur sie.
     *
     * <p>Wie beim Titelhintergrund der Startseite: die Seite bleibt stehen, nur
     * die Karte wechselt. Sonst würde jedes Weiterblättern die Auswertung neu
     * anfordern.
     */
    private void wrappedZeichnen() {
        if (wrappedPlatz == null || wrappedSeiten.isEmpty()) return;
        wrappedPlatz.removeAllViews();
        int stelle = Math.max(0, Math.min(wrappedStelle, wrappedSeiten.size() - 1));
        View karte = wrappedSeiten.get(stelle);
        if (karte.getParent() instanceof ViewGroup) {
            ((ViewGroup) karte.getParent()).removeView(karte);
        }
        karte.setOnClickListener(v -> {
            wrappedStelle = (wrappedStelle + 1) % wrappedSeiten.size();
            wrappedZeichnen();
        });
        addSpacing(wrappedPlatz, karte, 0);
        addSpacing(wrappedPlatz, Rueckblick.punkte(this, wrappedSeiten.size(), stelle),
            MobileViews.ITEM_GAP);

        LinearLayout knoepfe = new LinearLayout(this);
        knoepfe.setOrientation(LinearLayout.HORIZONTAL);
        if (stelle > 0) {
            knoepfe.addView(MobileViews.secondaryButton(this, "Zurück", () -> {
                wrappedStelle = stelle - 1;
                wrappedZeichnen();
            }), new LinearLayout.LayoutParams(0, dp(MobileViews.TOUCH_TARGET), 1));
        }
        boolean letzte = stelle >= wrappedSeiten.size() - 1;
        LinearLayout.LayoutParams weiterParams =
            new LinearLayout.LayoutParams(0, dp(MobileViews.TOUCH_TARGET), 1);
        if (stelle > 0) weiterParams.leftMargin = dp(MobileViews.ITEM_GAP);
        knoepfe.addView(MobileViews.primaryButton(this, letzte ? "Fertig" : "Weiter", () -> {
            if (letzte) {
                wrappedStelle = 0;
                zeigeRueckblick(rueckblickZeitraum);
                return;
            }
            wrappedStelle = stelle + 1;
            wrappedZeichnen();
        }), weiterParams);
        addSpacing(wrappedPlatz, knoepfe, MobileViews.ITEM_GAP);
    }

    /* ------------------------------------------------- Der Titelhintergrund */

    /**
     * Den Titelhintergrund zeichnen - und nur ihn.
     *
     * <p>Der Punkt dieser Methode ist, was sie <em>nicht</em> tut: die Seite
     * neu bauen. Er wechselt alle fuenfzehn Sekunden durch die zuletzt
     * geschauten Titel, und jedes Mal die ganze Startseite neu aufzubauen hiesse
     * jedes Mal die Scrollposition zu verlieren, jedes Bild neu anzufordern und
     * die Empfehlungsreihen erneut zu befragen.
     */
    /**
     * Der Titelhintergrund - je nach Geraet ein anderer Kasten, dieselbe Frage.
     *
     * <p>Was er zeigt, entscheidet keine der beiden Fassungen: es ist immer
     * {@link Bestand#weiterschauen()}, dieselbe Liste wie am Rechner. Nur wie
     * er es zeigt und wie man ihn bedient, ist verschieden.
     */
    private void heroZeichnen() {
        if (isTelevision()) tvHeroZeichnen();
        else mobileHeroZeichnen();
    }

    private void mobileHeroZeichnen() {
        if (heroPlatz == null) return;
        heroPlatz.removeAllViews();
        Favorite eintrag = heroEintraege.isEmpty() ? null
            : heroEintraege.get(Math.min(heroStelle, heroEintraege.size() - 1));

        View kasten;
        if (eintrag != null) {
            String titel = cleanFavoriteTitle(eintrag.title(), eintrag.url());
            if (titel.isEmpty()) titel = "Titel";
            String unterzeile = zusammen(eintrag.wartetAufNaechsteFolge()
                    ? "Nächste Folge: " + eintrag.folgenText() : eintrag.folgenText(),
                eintrag.providerName(), eintrag.standText());
            kasten = MobileViews.hero(this, "Fortsetzen", titel, unterzeile, eintrag.bild(),
                eintrag.wartetAufNaechsteFolge() ? 0 : eintrag.fortschrittProzent(),
                "Weiter schauen", () -> openFavorite(eintrag),
                // Am Rechner steht hier "Details", und der Knopf tut dasselbe
                // wie der daneben. Zwei gleiche Knoepfe nebeneinander sind auf
                // einem Telefon verschenkte Daumenbreite - dieser fuehrt
                // deshalb dorthin, wo alles Angefangene steht.
                "Meine Liste", () -> zeigeBibliothek(Bibliothek.WEITERSCHAUEN));
        } else if (!providers.isEmpty()) {
            Provider erster = activeProvider != null ? activeProvider : providers.get(0);
            kasten = MobileViews.hero(this, "ELFIX", "Was möchtest du ansehen?",
                "Wähle einen Anbieter oder durchsuche alle auf einmal.", "", 0,
                erster.name + " öffnen",
                () -> openProvider(erster, erster.lastUrl.isEmpty() ? erster.startUrl : erster.lastUrl),
                "Suchen", () -> showGlobalSearch(""));
        } else {
            kasten = MobileViews.hero(this, "ELFIX", "Noch keine Anbieter",
                "Ohne Anbieter gibt es nichts zu zeigen.", "", 0,
                "Einstellungen öffnen", this::showSettings, null, null);
        }
        // Mindesthoehe statt fester Hoehe, und nur wo es ein Bild zu zeigen
        // gibt. Der Textblock sitzt unten im Kasten; braucht er einmal mehr
        // Platz - ein zweizeiliger Titel, eine lange Zeile mit Folge, Anbieter
        // und Stand -, waechst der Kasten mit, statt oben abzuschneiden.
        //
        // Ohne Eintrag gibt es kein Bild, und dann waere die Mindesthoehe
        // nichts als eine leere Flaeche ueber der Schrift: beim ersten Start
        // stand ein Drittel des Bildschirms leer, bevor ueberhaupt etwas kam.
        if (eintrag != null) kasten.setMinimumHeight(dp(heroHoeheDp()));
        heroPlatz.addView(kasten, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        if (heroPunkte == null) return;
        heroPunkte.removeAllViews();
        heroPunkte.setVisibility(heroEintraege.size() > 1 ? View.VISIBLE : View.GONE);
        if (heroEintraege.size() > 1) {
            heroPunkte.addView(MobileViews.heroPunkte(this, heroEintraege.size(), heroStelle,
                stelle -> {
                    heroStelle = stelle;
                    heroZeichnen();
                    // Von Hand gewaehlt heisst: hier ist gerade Aufmerksamkeit.
                    // Die Uhr faengt von vorn an, damit nicht eine Sekunde
                    // spaeter weitergedreht wird.
                    heroWechselPlanen();
                }));
        }
    }

    /**
     * Wie hoch der Titelhintergrund sein darf.
     *
     * <p>Im Hochformat ein gutes Drittel des Bildschirms - genug fuer ein Bild,
     * das als Bild wirkt, und wenig genug, dass die erste Reihe darunter noch
     * anfaengt. Im Querformat waere dasselbe Mass die ganze Hoehe, deshalb dort
     * deutlich flacher.
     */
    private int heroHoeheDp() {
        Configuration config = getResources().getConfiguration();
        int hoehe = config.screenHeightDp;
        if (config.orientation == Configuration.ORIENTATION_LANDSCAPE) {
            return Math.max(170, Math.min(230, Math.round(hoehe * 0.55f)));
        }
        return Math.max(230, Math.min(360, Math.round(hoehe * 0.38f)));
    }

    /**
     * Der Takt, in dem der Titelhintergrund weiterwechselt.
     *
     * <p>Dieselben fuenfzehn Sekunden wie am Rechner. Er laeuft nur, solange die
     * Startseite wirklich zu sehen ist: ein Wechsel hinter einer offenen
     * Anbieterseite kostet Strom und aendert nichts.
     */
    private void heroWechselPlanen() {
        takt.removeCallbacksAndMessages(null);
        if (heroEintraege.size() < 2) return;
        // Solange die Fernbedienung im Titelhintergrund steht, wechselt er
        // nicht. Der Takt wird deshalb gar nicht erst gestellt - und wieder
        // gestellt, sobald der Fokus weiterzieht (siehe heroFokusGeaendert).
        if (heroFokus) return;
        takt.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (!"home".equals(currentScreen) || fullscreenView != null || heroPlatz == null) return;
                if (heroEintraege.size() < 2 || heroFokus) return;
                heroStelle = (heroStelle + 1) % heroEintraege.size();
                heroZeichnen();
                takt.postDelayed(this, HERO_TAKT_MS);
            }
        }, HERO_TAKT_MS);
    }

    /**
     * Der Fokus hat den Titelhintergrund betreten oder verlassen.
     *
     * <p>Betreten haelt an, verlassen faengt von vorn an - nicht dort, wo die
     * Uhr stehengeblieben ist. Wer gerade auf einem Titel stand, soll ihn noch
     * die vollen fuenfzehn Sekunden sehen und nicht die eine, die uebrig war.
     */
    private void heroFokusGeaendert(boolean hat) {
        if (heroFokus == hat) return;
        heroFokus = hat;
        if (hat) takt.removeCallbacksAndMessages(null);
        else heroWechselPlanen();
    }

    /** Aus mehreren Angaben eine Zeile machen - leere fallen weg. */
    private static String zusammen(String... teile) {
        StringBuilder text = new StringBuilder();
        for (String teil : teile) {
            if (teil == null || teil.isEmpty()) continue;
            if (text.length() > 0) text.append("  ·  ");
            text.append(teil);
        }
        return text.toString();
    }

    /* -------------------------------------------------------- Die Reihen */

    /**
     * Eine waagerechte Reihe in die Seite haengen.
     *
     * <p>Mit negativem Rand, und der ist Absicht: die Seite hat links und
     * rechts sechzehn Pixel Rand, die Reihe soll aber bis an den Bildschirmrand
     * laufen. Sonst endete die letzte sichtbare Kachel an einer Kante, und
     * nichts deutete darauf hin, dass dahinter noch etwas kommt.
     */
    private void reiheAnhaengen(LinearLayout page, View reihe, int obenDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(obenDp);
        params.leftMargin = -dp(MobileViews.SCREEN_PADDING);
        params.rightMargin = -dp(MobileViews.SCREEN_PADDING);
        page.addView(reihe, params);
    }

    /**
     * Wie breit eine Kachel ist.
     *
     * <p>Gerechnet statt festgelegt: auf einem schmalen Telefon sollen zweieinhalb
     * Kacheln zu sehen sein, auf einem breiten mehr - die halbe Kachel am Rand
     * ist das, was sagt, dass die Reihe weitergeht. Eine feste Breite waere auf
     * dem einen Geraet zu gross und auf dem anderen verschenkter Platz.
     */
    private int kachelBreiteDp() {
        int breite = getResources().getConfiguration().screenWidthDp;
        return Math.max(104, Math.min(170, Math.round((breite - 2f * MobileViews.SCREEN_PADDING) / 2.6f)));
    }

    /**
     * Eine Reihe aus Eintraegen der Ablage.
     *
     * @return ob sie ueberhaupt etwas zu zeigen hatte
     */
    private boolean kachelReihe(LinearLayout page, String titel, List<Favorite> eintraege,
                                Bibliothek liste, int hoechstens) {
        if (eintraege.isEmpty()) return false;
        addSpacing(page, MobileViews.sectionHeader(this, titel, "Alle anzeigen",
            () -> zeigeBibliothek(liste)), MobileViews.SECTION_GAP);

        int breite = kachelBreiteDp();
        ArrayList<View> karten = new ArrayList<>();
        for (int i = 0; i < Math.min(hoechstens, eintraege.size()); i += 1) {
            Favorite eintrag = eintraege.get(i);
            String name = cleanFavoriteTitle(eintrag.title(), eintrag.url());
            if (name.isEmpty()) name = "Titel";
            String schluessel = liveSchluessel(eintrag);
            int prozent = liste.zeigtFortschritt() && !eintrag.wartetAufNaechsteFolge()
                ? eintrag.fortschrittProzent() : 0;
            // Bei einer Kachel aus einer Runde wird der Balken auch dann
            // angelegt, wenn der eigene Stand noch bei null steht: gleich
            // meldet jemand, und der Takt kann keine Ansicht nachlegen.
            if (!schluessel.isEmpty()) prozent = Math.max(1, prozent);
            View karte = MobileViews.kachel(this, providerForFavorite(eintrag), name,
                kachelUnterzeile(eintrag), eintrag.bild(), prozent, "", breite,
                kachelStandtext(eintrag, liste),
                schluessel.isEmpty() ? null : liveZeile(schluessel, eintrag),
                () -> openFavorite(eintrag),
                anker -> eintragsMenue(anker, eintrag, liste));
            if (!schluessel.isEmpty()) {
                liveKacheln.add(new LiveKachel(karte, schluessel, eintrag.duration(),
                    eintrag.watchpartyVon(), watchpartyZeit(eintrag)));
            }
            karten.add(karte);
        }
        reiheAnhaengen(page, MobileViews.reihe(this, karten, breite), MobileViews.ITEM_GAP);
        return true;
    }

    /**
     * Was unter dem Titel einer Kachel steht.
     *
     * <p>Die Folge, wie bisher - und bei einer Kachel aus einer Runde
     * zusaetzlich der Raum. Ohne ihn saehen derselbe Titel in zwei Raeumen und
     * der eigene Stand desselben Titels gleich aus, und genau das trennt der
     * Rechner in {@code favoriteHerkunft} mit demselben Zeichen.
     */
    private static String kachelUnterzeile(Favorite eintrag) {
        String folge = eintrag.istAbgeschlossen() ? "Abgeschlossen"
            : eintrag.wartetAufNaechsteFolge() ? "Nächste Folge: " + eintrag.folgenText()
            : eintrag.folgenText();
        String raum = eintrag.watchpartyRaum();
        if (raum.isEmpty()) return folge;
        return folge.isEmpty() ? "⇄ " + raum : folge + " · ⇄ " + raum;
    }

    /**
     * Die Stelle im Klartext - "12:04 / 24:10".
     *
     * <p>Am Rechner steht sie unter jedem Balken. Auf dem Telefon stand dort
     * nur der Balken selbst, und wie viel eine halbe Kachelbreite in Minuten
     * ist, sieht man ihm nicht an.
     */
    private static String kachelStandtext(Favorite eintrag, Bibliothek liste) {
        if (!liste.zeigtFortschritt() || eintrag.wartetAufNaechsteFolge()) return "";
        return eintrag.standText();
    }

    /**
     * Die Reihe "Neue Folgen".
     *
     * <p>Sie steht ganz oben, weil sie das einzige ist, was von selbst dazukommt:
     * eine Serie, die man durch hatte, hat Nachschub bekommen. Am Rechner
     * dieselbe Reihe an derselben Stelle.
     */
    private boolean neueFolgenReihe(LinearLayout page) {
        ArrayList<Favorite> neue = new ArrayList<>();
        for (Favorite eintrag : bestand.alle()) {
            if (!eintrag.neueFolgeAm().isEmpty()) neue.add(eintrag);
        }
        if (neue.isEmpty()) return false;
        java.util.Collections.sort(neue,
            java.util.Comparator.comparing(Favorite::neueFolgeAm).reversed());

        addSpacing(page, MobileViews.sectionHeader(this, "Neue Folgen", "Alle anzeigen",
            () -> zeigeBibliothek(Bibliothek.WATCHLIST)), MobileViews.SECTION_GAP);
        int breite = kachelBreiteDp();
        ArrayList<View> karten = new ArrayList<>();
        for (int i = 0; i < Math.min(8, neue.size()); i += 1) {
            Favorite eintrag = neue.get(i);
            String name = cleanFavoriteTitle(eintrag.title(), eintrag.url());
            if (name.isEmpty()) name = "Titel";
            karten.add(MobileViews.kachel(this, providerForFavorite(eintrag), name,
                eintrag.providerName(), eintrag.bild(), 0, eintrag.neueFolgeText(), breite,
                () -> openFavorite(eintrag),
                anker -> eintragsMenue(anker, eintrag, Bibliothek.WATCHLIST)));
        }
        reiheAnhaengen(page, MobileViews.reihe(this, karten, breite), MobileViews.ITEM_GAP);
        return true;
    }

    /* --------------------------------------------------------- Vorschlaege */

    /**
     * Anbieter und Ablage an den Empfehlungslauf melden.
     *
     * <p>Bei jedem Zeichnen, und das ist billig: gerechnet wird davon nichts.
     * Der Lauf entscheidet selbst, ob sich genug geaendert hat, um neu zu
     * rechnen - genau wie am Rechner.
     */
    private void empfehlungenNachfuehren() {
        if (empfehlungen == null) return;
        empfehlungen.standSetzen(providers, bestand.roh());
    }

    /**
     * Eine Vorschlagsreihe.
     *
     * <p>Sie steht auch da, wenn noch nichts geholt ist - dann als Skelett. Der
     * Grund ist derselbe wie am Rechner: die Reihe braucht beim ersten Mal ein
     * paar Sekunden, und eine Seite, die waehrenddessen ohne sie auskommt und
     * sie danach dazwischenschiebt, springt unter dem Finger.
     *
     * <p>Vier Zustaende, und jeder sagt etwas anderes:
     * gefuellt, wird geholt, geht nicht, und "dazu gibt es nichts". Der letzte
     * ist der einzige, in dem die Reihe ganz verschwindet - eine Ueberschrift
     * ueber nichts ist schlimmer als eine fehlende Reihe.
     *
     * @param aktion Beschriftung des Knopfs rechts, {@code null} laesst ihn weg
     */
    private void vorschlagsReihe(LinearLayout page, String schluessel, String titel,
                                 String aktion, Runnable beiAktion) {
        if (empfehlungen == null) return;
        int breite = kachelBreiteDp();

        // Der Lauf ist gar nicht erst hochgekommen. Das einmal sagen, nicht
        // fuenfmal - deshalb nur bei der ersten Reihe.
        if (!empfehlungen.istBereit() && !empfehlungen.startFehler().isEmpty()) {
            if (!Empfehlungen.NEUES.equals(schluessel)) return;
            addSpacing(page, MobileViews.sectionHeader(this, "Vorschläge", null, null),
                MobileViews.SECTION_GAP);
            addSpacing(page, MobileViews.hinweis(this,
                "Die Vorschläge konnten nicht vorbereitet werden. Ohne sie funktioniert alles "
                    + "Übrige weiter.", "Erneut versuchen",
                () -> {
                    empfehlungen.erneutStarten(watchparty == null ? "" : watchparty.serverUrl());
                    showToast("Vorschläge werden erneut vorbereitet");
                }), MobileViews.ITEM_GAP);
            return;
        }

        int anzahl = Empfehlungen.NEUES.equals(schluessel) ? 6 : 20;
        empfehlungen.anfordern(schluessel, anzahl);

        List<JSONObject> eintraege = empfehlungen.eintraege(schluessel);
        String fehler = empfehlungen.fehler(schluessel);
        boolean fertigUndLeer = eintraege.isEmpty() && fehler.isEmpty()
            && empfehlungen.geladen(schluessel) && !empfehlungen.laedt(schluessel);
        // Fertig geholt, kein Fehler und trotzdem leer heisst normalerweise:
        // dazu gibt es gerade nichts. Dann steht die Reihe gar nicht erst da.
        //
        // Ohne Leitung heisst es etwas anderes. Der Lauf faengt einen
        // gescheiterten Abruf ab und gibt eine leere Liste zurueck - richtig,
        // denn ein Ausfall bei einem Anbieter soll nicht die ganze Reihe zum
        // Fehler machen. Hier sah das aus wie "nichts gefunden", und auf einem
        // Telefon ohne Empfang verschwand die halbe Startseite wortlos. Also
        // wird gefragt, bevor entschieden wird.
        if (fertigUndLeer && !Netz.vorhanden(this)) {
            // Einmal sagen, nicht fuenfmal: der Hinweis gehoert an die erste
            // Reihe, die ihn braucht, und die uebrigen fallen still weg.
            if (!Empfehlungen.NEUES.equals(schluessel)) return;
            addSpacing(page, MobileViews.sectionHeader(this, "Vorschläge", null, null),
                MobileViews.SECTION_GAP);
            addSpacing(page, MobileViews.hinweis(this,
                "Keine Verbindung. Vorschläge brauchen die Seiten deiner Anbieter - sobald du "
                    + "wieder online bist, stehen sie hier. Deine Mediathek und alles Angefangene "
                    + "bleiben verfügbar.", "Erneut versuchen",
                () -> {
                    for (String art : new String[]{Empfehlungen.NEUES, Empfehlungen.FUER_DICH,
                        Empfehlungen.ANIME, Empfehlungen.SERIE, Empfehlungen.FILM}) {
                        empfehlungen.erneutVersuchen(art);
                    }
                    if ("home".equals(currentScreen)) empfehlungenGeaendert();
                }), MobileViews.ITEM_GAP);
            return;
        }
        if (fertigUndLeer) return;

        addSpacing(page, MobileViews.sectionHeader(this, titel,
            eintraege.isEmpty() ? null : aktion, beiAktion), MobileViews.SECTION_GAP);

        if (!fehler.isEmpty() && eintraege.isEmpty()) {
            addSpacing(page, MobileViews.hinweis(this,
                "Diese Vorschläge konnten nicht geladen werden. Ohne Netz zeigt ELFIX hier den "
                    + "letzten bekannten Stand - beim ersten Start gibt es noch keinen.",
                "Erneut versuchen",
                () -> {
                    empfehlungen.erneutVersuchen(schluessel);
                    if ("home".equals(currentScreen)) empfehlungenGeaendert();
                }), MobileViews.ITEM_GAP);
            return;
        }
        if (eintraege.isEmpty()) {
            reiheAnhaengen(page, MobileViews.reihenSkelett(this, breite, 5), MobileViews.ITEM_GAP);
            return;
        }
        // Ein Stand von der Platte steht mit seinem Alter da. Ihn wortlos zu
        // zeigen waere schlimmer als ihn wegzulassen: er sieht aus wie frisch
        // geholt, und wer sich fragt, warum nichts Neues kommt, findet keine
        // Antwort.
        if (empfehlungen.istAlt(schluessel)) {
            addSpacing(page, MobileViews.hinweis(this, altHinweis(empfehlungen.alter(schluessel)),
                "Erneut versuchen",
                () -> {
                    empfehlungen.erneutVersuchen(schluessel);
                    if ("home".equals(currentScreen)) empfehlungenGeaendert();
                }), 0);
        }

        ArrayList<View> karten = new ArrayList<>();
        for (JSONObject item : eintraege) karten.add(vorschlagsKarte(item, breite, null));
        reiheAnhaengen(page, MobileViews.reihe(this, karten, breite), MobileViews.ITEM_GAP);
    }

    /** Eine einzelne Vorschlagskarte - in der Reihe wie im Raster dieselbe. */
    private View vorschlagsKarte(JSONObject item, int breiteDp, Bilder.Sichtfenster fenster) {
        String titel = item.optString("title", "");
        if (titel.isEmpty()) titel = "Titel";
        String grund = item.optString("grundText", "");
        // Das Erscheinungsdatum sagt mehr als der Anbietername - aber nur, wenn
        // es eines gibt. Sonst bleibt der Anbieter, damit die Zeile nicht leer
        // ist und die Karten unterschiedlich hoch werden.
        String datum = erscheinungsdatum(item.optString("releasedAt", ""));
        String zusatz = datum.isEmpty() ? item.optString("providerName", "") : datum;
        return MobileViews.vorschlag(this, providerMitId(item.optString("providerId", "")),
            titel, grund, zusatz, item.optString("image", ""), breiteDp, fenster,
            () -> vorschlagOeffnen(item),
            anker -> vorschlagsMenue(anker, item));
    }

    /**
     * Ein Erscheinungsdatum in Worten.
     *
     * <p>Dieselbe Form wie am Rechner ({@code erscheinungsdatum} in
     * renderer.js): ein Datum in der Zukunft bekommt ein "Ab" davor, denn
     * "3. Mai 2027" allein liest sich, als waere es schon da.
     */
    private static final String[] MONATE = {"Januar", "Februar", "März", "April", "Mai", "Juni",
        "Juli", "August", "September", "Oktober", "November", "Dezember"};

    static String erscheinungsdatum(String wert) {
        String[] teile = (wert == null ? "" : wert).split("-");
        if (teile.length != 3) return "";
        try {
            int jahr = Integer.parseInt(teile[0]);
            int monat = Integer.parseInt(teile[1]);
            int tag = Integer.parseInt(teile[2].substring(0, Math.min(2, teile[2].length())));
            if (monat < 1 || monat > 12) return "";
            String lesbar = tag + ". " + MONATE[monat - 1] + " " + jahr;
            java.time.LocalDate datum = java.time.LocalDate.of(jahr, monat, tag);
            return datum.isAfter(java.time.LocalDate.now()) ? "Ab " + lesbar : lesbar;
        } catch (Exception fehler) {
            return "";
        }
    }

    private Provider providerMitId(String id) {
        for (Provider provider : providers) {
            if (provider.id.equals(id)) return provider;
        }
        return null;
    }

    /**
     * Einen Vorschlag oeffnen.
     *
     * <p>Und dabei melden, dass er geoeffnet wurde: wer einen Vorschlag
     * annimmt, hat ihn nicht ignoriert, und seine Muedigkeitszaehlung faengt von
     * vorn an. Am Rechner haengt dieselbe Meldung an {@code did-navigate}.
     */
    private void vorschlagOeffnen(JSONObject item) {
        String url = item.optString("url", "");
        if (url.isEmpty()) return;
        Provider provider = providerMitId(item.optString("providerId", ""));
        if (provider == null && !providers.isEmpty()) provider = providers.get(0);
        if (provider == null) return;
        if (empfehlungen != null) {
            empfehlungen.geoeffnet(url, item.optString("title", ""), "");
        }
        openProvider(provider, url);
    }

    /**
     * Was sich mit einem Vorschlag anstellen laesst, ohne ihn zu oeffnen.
     *
     * <p>Dieselben zwei Moeglichkeiten wie am Rechner: vormerken und abhaken.
     * Ohne sie fuehrte jeder Weg zu einem Titel ueber die Anbieterseite - auch
     * der, an dessen Ende "kenne ich schon" steht.
     *
     * <p>Ein Vorschlag ohne eigene Adresse (er fuehrt nur zur Suche des
     * Anbieters) bekommt kein Menue: angelegt wuerde sonst die Suchadresse.
     */
    private void vorschlagsMenue(View anker, JSONObject item) {
        String url = item.optString("url", "");
        String titel = item.optString("title", "");
        Provider provider = providerMitId(item.optString("providerId", ""));
        if (url.isEmpty() || provider == null || item.optBoolean("viaSearch", false)) return;

        android.widget.PopupMenu menue = new android.widget.PopupMenu(this, anker, Gravity.END);
        java.util.ArrayList<Runnable> aktionen = new java.util.ArrayList<>();
        Favorite vorhanden = bestand.zuAdresse(url);

        menue.getMenu().add("Öffnen");
        aktionen.add(() -> vorschlagOeffnen(item));

        if (vorhanden == null || !vorhanden.istWatchlist()) {
            menue.getMenu().add("Auf die Watchlist");
            aktionen.add(() -> vorschlagVormerken(provider, item, false));
        }
        menue.getMenu().add("Als gesehen abhaken");
        aktionen.add(() -> frage("Als gesehen abhaken?",
            "„" + (titel.isEmpty() ? "Dieser Titel" : titel) + "“ wandert in die Mediathek, ohne "
                + "dass du ihn vorher öffnen musst. Er taucht danach nicht mehr in Vorschlägen auf.",
            () -> vorschlagVormerken(provider, item, true)));

        menue.setOnMenuItemClickListener(punkt -> {
            for (int i = 0; i < menue.getMenu().size(); i += 1) {
                if (menue.getMenu().getItem(i) == punkt) {
                    aktionen.get(i).run();
                    return true;
                }
            }
            return false;
        });
        menue.show();
    }

    /**
     * Einen Vorschlag anlegen - vorgemerkt oder gleich abgehakt.
     *
     * <p>Angelegt wird ueber dieselbe geteilte Regel wie jeder erschaute
     * Eintrag. Ein hier zusammengesetztes Objekt haette spaetestens beim
     * Geraeteabgleich gefehlt, weil ihm die halben Felder fehlten.
     */
    private void vorschlagVormerken(Provider provider, JSONObject item, boolean abhaken) {
        String url = item.optString("url", "");
        String titel = item.optString("title", "");
        JSONObject meta = new JSONObject();
        try {
            if (!titel.isEmpty()) meta.put("title", titel);
            String bild = item.optString("image", "");
            if (!bild.isEmpty()) meta.put("thumbnail", bild);
            meta.put("vonHand", true);
        } catch (Exception fehler) {
            Log.e(TAG, "Vorschlag nicht uebernommen", fehler);
            return;
        }
        bestand.anlegenUndMerken(provider, url, meta, () -> {
            if (!abhaken) {
                showToast("Zur Watchlist hinzugefügt");
                return;
            }
            // Die Regel meldet zurueck, welcher Eintrag es geworden ist -
            // verlaesslicher als ein zweiter Abgleich ueber die Adresse, denn
            // sie normalisiert sie unterwegs.
            Favorite angelegt = bestand.mitId(bestand.aktiverEintragId());
            if (angelegt == null) angelegt = bestand.zuAdresse(url);
            if (angelegt == null) {
                showToast("Konnte nicht abgehakt werden");
                return;
            }
            bestand.alsAbgeschlossenMarkieren(angelegt.id());
            showToast("In die Mediathek verschoben");
        });
    }

    /* ------------------------------------------------- Die Entdeckungsseite */

    /**
     * "Mehr anzeigen" - je Art eine eigene Seite, die beim Scrollen nachlaedt.
     *
     * <p>Der Zustand je Art ueberdauert das Verlassen der Seite. Wer einen
     * Titel oeffnet und zurueckkommt, steht wieder dort, wo er war, statt
     * hundertfuenfzig Karten noch einmal zu laden - dieselbe Ueberlegung wie am
     * Rechner.
     */
    private void zeigeEntdeckung(String art) {
        // Dasselbe wie beim Wechsel der Liste: eine andere Art ist eine andere
        // Seite, auch wenn sie denselben Namen im Bildschirmwechsel traegt.
        if (!art.equals(entdeckungArt)) tvFokusJeSeite.remove("entdeckung");
        entdeckungArt = art;
        currentScreen = "entdeckung";
        mouseMode = false;
        setMouseCursorVisible(false);
        setChromeCollapsed(false, false);
        takt.removeCallbacksAndMessages(null);
        content.removeAllViews();
        updateBottomNav();
        renderEntdeckung();
    }

    /** Ueberschrift und Erklaerung je Art - dieselben Saetze wie am Rechner. */
    private static String entdeckungsTitel(String art) {
        if (Empfehlungen.ANIME.equals(art)) return "Anime für dich";
        if (Empfehlungen.FILM.equals(art)) return "Filme für dich";
        return "Serien für dich";
    }

    private static String entdeckungsText(String art) {
        if (Empfehlungen.ANIME.equals(art)) {
            return "Aus deinem Verlauf, deiner Watchlist und dem, was AniList über deine Anime weiß.";
        }
        if (Empfehlungen.FILM.equals(art)) {
            return "Aus deinem Verlauf, deiner Watchlist und dem, was TMDB über deine Filme weiß.";
        }
        return "Aus deinem Verlauf, deiner Watchlist und dem, was TMDB über deine Serien weiß.";
    }

    private Entdeckung entdeckungsZustand() {
        Entdeckung zustand = entdeckungen.get(entdeckungArt);
        if (zustand == null) {
            zustand = new Entdeckung();
            entdeckungen.put(entdeckungArt, zustand);
        }
        return zustand;
    }

    /**
     * Die Entdeckungsseite - dieselbe Liste, zwei Zuschnitte.
     *
     * <p>Geholt, nachgefasst und gezaehlt wird in beiden Faellen von
     * {@link #entdeckungLaden} und {@link #entdeckungNachfassen}: dieselbe
     * Seitenzaehlung, dieselbe Doppelfilterung, dieselbe Wartestaffel. Was
     * sich unterscheidet, ist die Zahl der Spalten, die Groesse der Karten und
     * dass hier ein Fokus wandert statt eines Fingers.
     */
    private void renderEntdeckung() {
        if (isTelevision()) renderTvEntdeckung();
        else renderMobileEntdeckung();
    }

    /**
     * Die Entdeckungsseite auf dem Fernseher.
     *
     * <p>Ein Raster statt einer Reihe, weil hier alles zu einer Art gehoert
     * und eine einzige Reihe von hundertfuenfzig Kacheln mit dem Steuerkreuz
     * nicht zu durchqueren waere. Nachgeladen wird wie auf dem Telefon: am
     * Scrollende, und zusaetzlich nach jedem Stapel von selbst - dreissig
     * Karten fuellen einen Fernsehbildschirm samt Vorlauf nicht, es wird also
     * gar nicht gescrollt, und ohne Scrollen faellt kein Ereignis.
     */
    private void renderTvEntdeckung() {
        LinearLayout page = tvPage();
        Entdeckung zustand = entdeckungsZustand();
        entdeckungBilder = new Bilder.Sichtfenster();

        page.addView(TvViews.eyebrow(this, "Für dich"));
        page.addView(TvViews.heroTitle(this, entdeckungsTitel(entdeckungArt)));
        TextView erklaerung = TvViews.body(this, entdeckungsText(entdeckungArt));
        erklaerung.setMaxLines(2);
        page.addView(erklaerung);

        View zurueck = TvViews.pillButton(this, "Zurück zur Startseite", this::showHome);
        zurueck.setTag("tv:zurueck");
        LinearLayout.LayoutParams zurueckParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        zurueckParams.topMargin = dp(TvViews.ITEM_GAP);
        page.addView(zurueck, zurueckParams);

        entdeckungRaster = new LinearLayout(this);
        entdeckungRaster.setOrientation(LinearLayout.VERTICAL);
        entdeckungRaster.setClipChildren(false);
        entdeckungRaster.setClipToPadding(false);
        addSpacing(page, entdeckungRaster, TvViews.SECTION_GAP);

        entdeckungFuss = new LinearLayout(this);
        entdeckungFuss.setOrientation(LinearLayout.VERTICAL);
        addSpacing(page, entdeckungFuss, TvViews.ITEM_GAP);

        entdeckungKartenAnhaengen(0);
        entdeckungFussZeichnen();

        ScrollView scroll = seitenScroll;
        scroll.setOnScrollChangeListener((ansicht, x, y, altX, altY) -> {
            if (!"entdeckung".equals(currentScreen) || seitenScroll != scroll) return;
            zustand.scroll = y;
            if (entdeckungBilder != null) entdeckungBilder.pruefen(scroll);
            entdeckungNachfassen();
        });
        scroll.post(() -> {
            if (entdeckungBilder != null) entdeckungBilder.pruefen(scroll, true);
            if (zustand.eintraege.isEmpty()) entdeckungLaden();
            else entdeckungNachfassen();
        });
        // Der Fokus stellt die Scrollstelle selbst wieder her: eine ScrollView
        // schiebt zu ihrem fokussierten Kind. Deshalb steht hier kein
        // scrollTo - es waere der zweite Befehl an dieselbe Stelle, und die
        // beiden kaemen sich in die Quere.
        tvFokusHerstellen(page);
    }

    private void renderMobileEntdeckung() {
        LinearLayout page = mobilePage();
        Entdeckung zustand = entdeckungsZustand();
        // Die Bilder der vorigen Ansicht sind weg - ihre Ansichten auch.
        entdeckungBilder = new Bilder.Sichtfenster();

        LinearLayout kopf = new LinearLayout(this);
        kopf.setOrientation(LinearLayout.HORIZONTAL);
        kopf.setGravity(Gravity.CENTER_VERTICAL);
        ImageView zurueck = MobileViews.iconButton(this, R.drawable.ic_arrow_back, this::showHome);
        zurueck.setContentDescription("Zurück zur Startseite");
        kopf.addView(zurueck, new LinearLayout.LayoutParams(
            dp(MobileViews.TOUCH_TARGET), dp(MobileViews.TOUCH_TARGET)));
        TextView marke = MobileViews.eyebrow(this, "Für dich");
        marke.setPadding(dp(6), 0, 0, 0);
        kopf.addView(marke);
        page.addView(kopf);

        page.addView(MobileViews.heroTitle(this, entdeckungsTitel(entdeckungArt)));
        TextView erklaerung = MobileViews.subtitle(this, entdeckungsText(entdeckungArt));
        erklaerung.setMaxLines(3);
        page.addView(erklaerung);

        entdeckungRaster = new LinearLayout(this);
        entdeckungRaster.setOrientation(LinearLayout.VERTICAL);
        addSpacing(page, entdeckungRaster, MobileViews.SECTION_GAP);

        entdeckungFuss = new LinearLayout(this);
        entdeckungFuss.setOrientation(LinearLayout.VERTICAL);
        addSpacing(page, entdeckungFuss, 4);

        entdeckungKartenAnhaengen(0);
        entdeckungFussZeichnen();

        // Der Horcher haengt an der ScrollView selbst und nicht am
        // ViewTreeObserver: der gehoert dem Fenster, und ein dort angemeldeter
        // Horcher bliebe nach dem Verlassen der Seite haengen. Nach drei
        // Besuchen liefen drei davon bei jedem Scrollschritt mit.
        ScrollView scroll = seitenScroll;
        scroll.setOnScrollChangeListener((ansicht, x, y, altX, altY) -> {
            if (!"entdeckung".equals(currentScreen) || seitenScroll != scroll) return;
            zustand.scroll = y;
            if (entdeckungBilder != null) entdeckungBilder.pruefen(scroll);
            entdeckungNachfassen();
        });
        // Erst zeichnen lassen, dann die Position wiederherstellen: vorher hat
        // die Seite noch keine Hoehe, und jedes Zuruecksetzen liefe ins Leere.
        scroll.post(() -> {
            if (zustand.scroll > 0) scroll.scrollTo(0, zustand.scroll);
            if (entdeckungBilder != null) entdeckungBilder.pruefen(scroll, true);
            // Wer zurueckkommt und dabei am Ende stand, soll nicht warten, bis
            // er einmal gescrollt hat.
            if (zustand.eintraege.isEmpty()) entdeckungLaden();
            else entdeckungNachfassen();
        });
    }

    /** Wie viele Karten nebeneinander stehen - zwei auf dem Telefon, mehr auf breiten Geraeten. */
    private int entdeckungsSpalten() {
        int breite = getResources().getConfiguration().screenWidthDp;
        if (isTelevision()) {
            // Gerechnet aus der Kachelbreite, damit ein 720p-, ein 1080p- und
            // ein 4K-Panel dieselbe Kachelgroesse und nicht dieselbe Spaltenzahl
            // bekommen: auf 4K waeren vier Spalten vier riesige Poster.
            int kachel = TvViews.kachelBreiteDp(this) + TvViews.ITEM_GAP;
            return Math.max(3, Math.min(8,
                (breite - 2 * TvViews.SCREEN_PADDING + TvViews.ITEM_GAP) / kachel));
        }
        if (breite >= 840) return 4;
        return breite >= 600 ? 3 : 2;
    }

    /**
     * Die neuen Karten anhaengen.
     *
     * <p>Nur die neuen: die Liste waechst ausschliesslich am Ende, und ein
     * vollstaendiger Neuaufbau wuerde bei mehreren hundert Karten ruckeln und
     * nebenbei die Scrollposition verlieren. Dieselbe Ueberlegung wie in
     * {@code renderDiscovery} am Rechner.
     */
    private void entdeckungKartenAnhaengen(int abStelle) {
        if (entdeckungRaster == null) return;
        Entdeckung zustand = entdeckungsZustand();
        boolean fernseher = isTelevision();
        int spalten = entdeckungsSpalten();
        int rand = fernseher ? TvViews.SCREEN_PADDING : MobileViews.SCREEN_PADDING;
        int luecke = fernseher ? TvViews.ITEM_GAP : MobileViews.ITEM_GAP;
        int abstand = dp(luecke);
        int breite = Math.round((getResources().getConfiguration().screenWidthDp
            - 2f * rand - (spalten - 1f) * luecke) / spalten);

        // Die letzte Zeile kann halb gefuellt sein. Sie wird dann noch einmal
        // gebaut, damit die naechsten Karten in ihre Luecken kommen statt in
        // eine neue Zeile.
        int vollstaendig = (abStelle / spalten) * spalten;
        while (entdeckungRaster.getChildCount() > vollstaendig / spalten) {
            entdeckungRaster.removeViewAt(entdeckungRaster.getChildCount() - 1);
        }

        for (int start = vollstaendig; start < zustand.eintraege.size(); start += spalten) {
            LinearLayout zeile = new LinearLayout(this);
            zeile.setOrientation(LinearLayout.HORIZONTAL);
            for (int spalte = 0; spalte < spalten; spalte += 1) {
                int stelle = start + spalte;
                LinearLayout.LayoutParams zelle = new LinearLayout.LayoutParams(
                    0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
                if (spalte > 0) zelle.leftMargin = abstand;
                if (stelle < zustand.eintraege.size()) {
                    View karte = fernseher
                        ? tvVorschlagsKarte(zustand.eintraege.get(stelle), breite, entdeckungBilder)
                        : vorschlagsKarte(zustand.eintraege.get(stelle), breite, entdeckungBilder);
                    // Die TV-Karte bringt ihre eigene Breite mit; im Raster
                    // gilt die der Zelle, die addView unten setzt.
                    if (fernseher) karte.setTag("tv:entdeckung:" + stelle);
                    zeile.addView(karte, zelle);
                } else {
                    // Ein Platzhalter mit Hoehe 0: eine nackte View liefert bei
                    // WRAP_CONTENT die volle erlaubte Hoehe und schoebe alles
                    // Weitere aus der Seite.
                    LinearLayout.LayoutParams leer = new LinearLayout.LayoutParams(0, 0, 1);
                    leer.leftMargin = zelle.leftMargin;
                    zeile.addView(new android.widget.Space(this), leer);
                }
            }
            zeile.setClipChildren(false);
            zeile.setClipToPadding(false);
            LinearLayout.LayoutParams zeilenParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            if (entdeckungRaster.getChildCount() > 0) zeilenParams.topMargin = dp(fernseher ? 22 : 18);
            entdeckungRaster.addView(zeile, zeilenParams);
        }
    }

    /**
     * Der Fuss der Entdeckungsseite.
     *
     * <p>Er sagt in jeder Lage, woran man ist: wird geladen, wird noch gesucht,
     * ist Schluss, oder ist etwas schiefgegangen. Die Unterscheidung zwischen
     * "Schluss" und "wird noch gesucht" ist der Punkt - solange der Katalog
     * nachgeholt wird, waere "das war alles" schlicht unwahr.
     */
    private void entdeckungFussZeichnen() {
        if (entdeckungFuss == null) return;
        Entdeckung zustand = entdeckungsZustand();
        entdeckungFuss.removeAllViews();
        if (zustand.laeuft) {
            entdeckungFuss.addView(fussHinweis(zustand.eintraege.isEmpty()
                ? "Vorschläge werden zusammengestellt …"
                : "Weitere Vorschläge werden geladen …", null, null));
            return;
        }
        if (!zustand.fehler.isEmpty()) {
            entdeckungFuss.addView(fussHinweis(
                "Weitere Empfehlungen konnten nicht geladen werden.",
                "Erneut versuchen", () -> {
                    entdeckungsZustand().fehler = "";
                    entdeckungLaden();
                }));
            return;
        }
        if (zustand.waechst && !zustand.fertig) {
            entdeckungFuss.addView(fussHinweis("Weitere Vorschläge werden gesucht …", null, null));
            return;
        }
        if (zustand.fertig && !zustand.eintraege.isEmpty()) {
            entdeckungFuss.addView(fussHinweis("Das war alles, was gerade dazu passt.", null, null));
            return;
        }
        if (zustand.fertig && zustand.eintraege.isEmpty()) {
            entdeckungFuss.addView(isTelevision()
                ? TvViews.emptyState(this, R.drawable.ic_nav_favorite, "Noch keine Vorschläge",
                    "ELFIX braucht ein paar angesehene Titel, bevor es etwas empfehlen kann.")
                : MobileViews.emptyState(this, R.drawable.ic_nav_favorite, "Noch keine Vorschläge",
                    "ELFIX braucht ein paar angesehene Titel, bevor es etwas empfehlen kann."));
        }
    }

    /** Derselbe Satz, der jeweils passende Kasten. */
    private View fussHinweis(String text, String knopf, Runnable beiKnopf) {
        return isTelevision()
            ? TvViews.hinweis(this, text, knopf, beiKnopf)
            : MobileViews.hinweis(this, text, knopf, beiKnopf);
    }

    /**
     * Nachsehen, ob noch Platz ist.
     *
     * <p>Ein Scrollhorcher allein reicht nicht: dreissig Karten fuellen einen
     * Bildschirm samt Vorlauf nicht, es wird also gar nicht gescrollt, und ohne
     * Scrollen faellt kein Ereignis. Deshalb wird nach jedem Stapel selbst
     * nachgesehen. Die Schleife endet von allein - {@link #entdeckungLaden}
     * steigt bei laufendem Abruf und am Ende sofort wieder aus.
     */
    private void entdeckungNachfassen() {
        if (!"entdeckung".equals(currentScreen) || seitenScroll == null) return;
        Entdeckung zustand = entdeckungsZustand();
        if (zustand.laeuft || zustand.fertig || !zustand.fehler.isEmpty()) return;
        View inhalt = seitenScroll.getChildAt(0);
        if (inhalt == null) return;
        int unten = inhalt.getHeight() - seitenScroll.getHeight() - seitenScroll.getScrollY();
        // Auf dem Fernseher mit mehr Vorlauf: dort springt der Fokus in
        // Zeilenschritten nach unten und ist schneller am Ende, als ein Finger
        // es waere.
        if (unten <= dp(isTelevision() ? 1400 : 800)) entdeckungLaden();
    }

    /** Den naechsten Abschnitt holen. */
    private void entdeckungLaden() {
        if (empfehlungen == null) return;
        String art = entdeckungArt;
        Entdeckung zustand = entdeckungsZustand();
        if (zustand.laeuft || zustand.fertig) return;
        zustand.laeuft = true;
        zustand.fehler = "";
        entdeckungFussZeichnen();

        empfehlungen.seite(art, zustand.versatz, ENTDECKUNG_STAPEL, (seite, fehler) -> {
            zustand.laeuft = false;
            if (fehler != null) {
                zustand.fehler = fehler;
            } else {
                int vorher = zustand.eintraege.size();
                for (int i = 0; i < seite.eintraege.length(); i += 1) {
                    JSONObject item = seite.eintraege.optJSONObject(i);
                    if (item == null) continue;
                    // Derselbe Titel darf in einer Sitzung nur einmal
                    // erscheinen. Die Liste bleibt zwischen zwei Abrufen
                    // dieselbe, aber derselbe Film liegt bei mehreren
                    // Anbietern - sicher ist sicher.
                    String schluessel = item.optString("werkKey", item.optString("url", ""));
                    if (schluessel.isEmpty() || !zustand.gesehen.add(schluessel)) continue;
                    zustand.eintraege.add(item);
                }
                zustand.versatz += seite.eintraege.length();
                zustand.waechst = seite.waechst;
                zustand.fertig = seite.fertig;
                boolean gewachsen = zustand.eintraege.size() > vorher;
                if (gewachsen) zustand.versuche = 0;
                if (!gewachsen && zustand.waechst && !zustand.fertig) {
                    // Zwei Wartezeiten stecken dahinter: eine Neuberechnung ist
                    // in gut zwei Sekunden da, ein Katalog-Nachschlag braucht
                    // laenger. Also schnell zuerst fragen und dann nachlassen.
                    zustand.versuche += 1;
                    long warten = Math.min(8000, 1500 + zustand.versuche * 1500L);
                    takt.postDelayed(() -> {
                        if ("entdeckung".equals(currentScreen) && art.equals(entdeckungArt)) {
                            entdeckungLaden();
                        }
                    }, warten);
                }
                if (art.equals(entdeckungArt) && "entdeckung".equals(currentScreen)) {
                    entdeckungKartenAnhaengen(vorher);
                }
            }
            if (!art.equals(entdeckungArt) || !"entdeckung".equals(currentScreen)) return;
            entdeckungFussZeichnen();
            // Erst zeichnen lassen, dann pruefen: vorher stehen die neuen
            // Karten noch nicht im Layout.
            if (seitenScroll != null) {
                seitenScroll.post(() -> {
                    if (entdeckungBilder != null) entdeckungBilder.pruefen(seitenScroll, true);
                    entdeckungNachfassen();
                });
            }
        });
    }

    /**
     * Responsive provider grid. Every cell carries weight 1, so cards share the row evenly and can
     * never end up half off-screen regardless of how many providers or how wide the display is.
     */
    private int providerGridColumns() {
        int width = getResources().getConfiguration().screenWidthDp;
        if (width >= 600) return 3;
        return width >= 360 ? 2 : 1;
    }

    private View providerGrid() {
        int columns = providerGridColumns();
        LinearLayout grid = new LinearLayout(this);
        grid.setOrientation(LinearLayout.VERTICAL);
        for (int start = 0; start < providers.size(); start += columns) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            for (int column = 0; column < columns; column += 1) {
                int index = start + column;
                LinearLayout.LayoutParams cell = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
                if (column > 0) cell.leftMargin = dp(MobileViews.ITEM_GAP);
                if (index < providers.size()) {
                    Provider provider = providers.get(index);
                    row.addView(MobileViews.providerCard(this, provider, providerTagline(provider),
                        () -> openProvider(provider, provider.lastUrl.isEmpty() ? provider.startUrl : provider.lastUrl),
                        () -> openProvider(provider, provider.startUrl)), cell);
                } else {
                    // Filler keeps the last row's cards the same width as every other row.
                    // Height must be 0, not WRAP_CONTENT: a bare View does not implement
                    // wrap-content -- View.getDefaultSize() returns the full AT_MOST size, so the
                    // filler would swallow the remaining page height and push later sections out.
                    LinearLayout.LayoutParams fillerParams = new LinearLayout.LayoutParams(0, 0, 1);
                    fillerParams.leftMargin = cell.leftMargin;
                    row.addView(new android.widget.Space(this), fillerParams);
                }
            }
            LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            if (start > 0) rowParams.topMargin = dp(MobileViews.ITEM_GAP);
            grid.addView(row, rowParams);
        }
        return grid;
    }

    private String providerTagline(Provider provider) {
        String key = ((provider.id == null ? "" : provider.id) + " " + (provider.name == null ? "" : provider.name)).toLowerCase();
        if (key.contains("aniworld")) return "Anime & Serien";
        if (key.contains("sto") || key.contains("s.to")) return "Serien";
        if (key.contains("filmo")) return "Filme";
        return "Streaming";
    }

    private void renderMobileSearch(String query) {
        LinearLayout page = mobilePage();
        page.addView(MobileViews.eyebrow(this, "Alle Anbieter"));
        page.addView(MobileViews.heroTitle(this, "Suche"));

        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint("Serien, Anime und Filme suchen");
        input.setText(query);
        input.setTextColor(Theme.TEXT_PRIMARY);
        input.setHintTextColor(Theme.TEXT_SECONDARY);
        input.setTextSize(15);
        input.setPadding(dp(14), 0, dp(14), 0);
        input.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH);
        input.setBackground(MobileViews.shape(this, Theme.SURFACE_ELEVATED, MobileViews.CARD_RADIUS, Theme.BORDER, 1));
        input.setOnFocusChangeListener((view, focused) -> input.setBackground(MobileViews.shape(this,
            Theme.SURFACE_ELEVATED, MobileViews.CARD_RADIUS, focused ? Theme.PRIMARY : Theme.BORDER, focused ? 2 : 1)));
        input.setOnEditorActionListener((view, actionId, event) -> {
            showGlobalSearch(input.getText().toString().trim());
            return true;
        });
        searchInput = input;
        LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        inputParams.topMargin = dp(18);
        page.addView(input, inputParams);

        if (query.isEmpty()) {
            addSpacing(page, MobileViews.emptyState(this, R.drawable.ic_nav_search,
                "Was suchst du?",
                "Gib einen Titel ein - ELFIX durchsucht alle Anbieter gleichzeitig."), 8);
            return;
        }

        LinearLayout resultsHolder = new LinearLayout(this);
        resultsHolder.setOrientation(LinearLayout.VERTICAL);
        addSpacing(page, resultsHolder, MobileViews.SECTION_GAP);

        resultsHolder.addView(MobileViews.sectionHeader(this, "Ergebnisse", null, null));
        TextView loading = MobileViews.subtitle(this, "Suche bei allen Anbietern ...");
        resultsHolder.addView(loading);
        searchAllProvidersMobile(query, resultsHolder, loading);

        addSpacing(page, MobileViews.sectionHeader(this, "Direkt beim Anbieter", null, null), MobileViews.SECTION_GAP);
        for (Provider provider : providers) {
            addSpacing(page, MobileViews.providerCard(this, provider, "\"" + query + "\" dort suchen",
                () -> openProvider(provider, provider.buildSearchUrl(query)), null), MobileViews.ITEM_GAP);
        }
    }

    /** Same crawl as the TV search, rendered as mobile result cards. */
    private void searchAllProvidersMobile(String query, LinearLayout holder, View loading) {
        new Thread(() -> {
            ArrayList<SearchResult> found = new ArrayList<>();
            for (Provider provider : providers) {
                for (String variant : searchQueryVariants(query)) {
                    ArrayList<SearchResult> providerResults =
                        fetchSearchResults(provider, provider.buildSearchUrl(variant), variant);
                    if (!providerResults.isEmpty()) {
                        found.addAll(providerResults);
                        break;
                    }
                }
            }
            runOnUiThread(() -> {
                holder.removeView(loading);
                if (found.isEmpty()) {
                    holder.addView(MobileViews.subtitle(this, "Keine direkten Treffer gefunden."));
                    return;
                }
                int shown = 0;
                for (SearchResult result : found) {
                    if (shown >= 30) break;
                    String meta = result.genre == null || result.genre.isEmpty()
                        ? result.provider.name
                        : result.genre + " · " + result.provider.name;
                    // Ein Suchtreffer hat noch keinen Fortschritt und kein
                    // Menue - er ist noch gar kein Eintrag. Ein Titelbild hat
                    // er sehr wohl, sofern die Trefferseite eines hergab.
                    View card = MobileViews.favoriteCard(this, result.provider, result.title, meta, null,
                        result.bild, 0, "Ansehen",
                        () -> openProvider(result.provider, result.url), null);
                    LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                    params.topMargin = dp(MobileViews.ITEM_GAP);
                    holder.addView(card, params);
                    shown += 1;
                }
            });
        }).start();
    }

    /**
     * Die Filterlisten holen - und die vollen Regeln danach neu aufbauen.
     *
     * <p>Beides gehoert zusammen: die Engine haelt den Rohtext, den sie beim
     * Aufbau gelesen hat. Ohne den zweiten Schritt filterte sie nach dem
     * Herunterladen weiter nach dem alten Stand.
     */
    private void filterlistenLaden() {
        showToast("Filterlisten werden geladen …");
        Filterlisten.aktualisieren(this, (anzahl, fehler) -> {
            if (fehler != null) {
                showToast("Ging nicht: " + fehler);
            } else {
                showToast(anzahl + " Domains geladen");
                if (werbefilter != null) werbefilter.neuBauen();
            }
            showSettings();
        });
    }

    /** Was auf dem Knopf der Regelkarte steht - drei Zustaende im Kreis. */
    private String regelKnopf() {
        if (werbefilter == null) return null;
        switch (werbefilter.modus()) {
            case "an": return "Abschalten";
            case "aus": return "Dem Gerät überlassen";
            default: return Werbefilter.geraetTraegt(this) ? "Abschalten" : "Trotzdem einschalten";
        }
    }

    /**
     * Der Reihe nach durch die drei Zustaende.
     *
     * <p>"Automatisch" heisst: das Geraet entscheidet an seinem Speicher. Wer
     * das ueberstimmt, soll es koennen - es ist sein Geraet, und wer ein
     * ruckelndes Bild in Kauf nimmt, um mehr Werbung loszuwerden, hat dafuer
     * seine Gruende.
     */
    private void regelModusUmschalten() {
        if (werbefilter == null) return;
        String jetzt = werbefilter.modus();
        String neu;
        if ("an".equals(jetzt)) neu = "aus";
        else if ("aus".equals(jetzt)) neu = "auto";
        else neu = Werbefilter.geraetTraegt(this) ? "aus" : "an";
        werbefilter.setzeModus(neu);
        showToast("aus".equals(neu) ? "Volle Regeln aus"
            : ("an".equals(neu) ? "Volle Regeln an" : "Das Gerät entscheidet"));
        showSettings();
    }

    /** Settings rows as grouped cards instead of stacked headline/paragraph pairs. */
    /**
     * Der Autoplay-Schalter in den Einstellungen.
     *
     * <p>Derselbe Zustand wie der Knopf in der Wiedergabeleiste und wie die
     * Zeile "Naechste Folge von selbst starten" am Rechner - ein Schalter,
     * zwei Wege dorthin. Ein zweiter Zustand daneben waere die Stelle, an der
     * Leiste und Einstellungen Verschiedenes behaupten.
     */
    private View autoplayKarte(boolean fernseher) {
        boolean an = Folgen.autoplayAn(this);
        return karte(fernseher, "Nächste Folge von selbst starten",
            an
                ? "Ein: Am Ende einer Folge geht es von selbst weiter. Der Knopf „Nächste Folge“ "
                    + "steht trotzdem da."
                : "Aus: Es geht nur weiter, wenn du „Nächste Folge“ drückst.",
            an ? "Ausschalten" : "Einschalten",
            this::autoplayUmschalten);
    }

    private View settingsCard(String title, String body, String actionLabel, Runnable onAction) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(14), dp(14), dp(14));
        card.setBackground(MobileViews.shape(this, Theme.SURFACE_ELEVATED, MobileViews.CARD_RADIUS, Theme.BORDER, 1));

        TextView head = new TextView(this);
        head.setText(title);
        head.setTextColor(Theme.TEXT_PRIMARY);
        head.setTextSize(16);
        head.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        card.addView(head);

        TextView text = new TextView(this);
        text.setText(body);
        text.setTextColor(Theme.TEXT_SECONDARY);
        text.setTextSize(13.5f);
        text.setLineSpacing(0, 1.15f);
        text.setPadding(0, dp(6), 0, 0);
        // Damit ein Nachtrag den Text spaeter wiederfindet, ohne dass die
        // ganze Seite neu gebaut werden muss.
        text.setTag("karten-text");
        card.addView(text);

        if (actionLabel != null && onAction != null) {
            TextView action = MobileViews.secondaryButton(this, actionLabel, onAction);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, dp(MobileViews.TOUCH_TARGET));
            params.topMargin = dp(12);
            card.addView(action, params);
        }
        return card;
    }

    private void renderMobileSettings() {
        LinearLayout page = mobilePage();
        page.addView(MobileViews.eyebrow(this, "ELFIX"));
        page.addView(MobileViews.heroTitle(this, "Einstellungen"));

        addSpacing(page, settingsCard("Werbeblocker",
            "AdGuard-Filterlisten sind aktiv. Innerhalb des Video-Hosters wird bewusst zurückhaltender "
                + "gefiltert, damit die Wiedergabe nicht blockiert wird. Schichten, die den Player "
                + "zudecken, werden zusätzlich erkannt und ausgeblendet.",
            null, null), 18);

        addSpacing(page, settingsCard("Volle Regeln",
            werbefilter == null ? "" : werbefilter.standText(),
            regelKnopf(), this::regelModusUmschalten), MobileViews.ITEM_GAP);

        addSpacing(page, settingsCard("Filterlisten",
            Filterlisten.standText(this),
            "Jetzt aktualisieren",
            this::filterlistenLaden), MobileViews.ITEM_GAP);

        addSpacing(page, settingsCard("Favoriten-Fortschritt",
            folgeStatisch()
                ? "Der Eintrag bleibt auf der gespeicherten Folge stehen."
                : "Der Eintrag rückt mit, wenn du zur nächsten Folge blätterst.",
            folgeStatisch() ? "Mitrücken lassen" : "Stehen lassen",
            () -> {
                favoriteProgressMode = folgeStatisch() ? "sequential" : "static";
                getSharedPreferences("elflix_settings", MODE_PRIVATE)
                    .edit()
                    .putString("favorite_progress_mode", favoriteProgressMode)
                    .apply();
                showToast("Gespeichert");
                showSettings();
            }), MobileViews.ITEM_GAP);

        addSpacing(page, autoplayKarte(false), MobileViews.ITEM_GAP);

        startseitenEinstellungen(page);

        addSpacing(page, introKarte(false), MobileViews.ITEM_GAP);

        addSpacing(page, fassungsKarte(false), MobileViews.ITEM_GAP);

        watchpartyEinstellungen(page, false);

        geraeteEinstellungen(page, false);

        addSpacing(page, settingsCard("Zwischenspeicher",
            "Lädt alle Anbieter neu und leert den Cache. Cookies und Anmeldungen bleiben erhalten.",
            "Alles neu laden", this::reloadAllWebViews), MobileViews.ITEM_GAP);

        addSpacing(page, aktualisierungsKarte(false), MobileViews.ITEM_GAP);
    }

    /**
     * Welche Reihen die Startseite zeigt.
     *
     * <p>Am Rechner steht dasselbe unter {@code settings.home}: sechs Schalter,
     * die je eine Reihe ein- und ausblenden. Auf dem Telefon gab es sie nicht -
     * die Reihen standen fest, und wer die Vorschlaege nicht wollte, hatte
     * keine Wahl. Die Schluessel sind absichtlich dieselben (siehe
     * {@link Startseite}).
     *
     * <p>Der Kalender kommt dazu: er ist am Rechner eine eigene Seite in der
     * Seitenleiste, hier eine Reihe - und dann gehoert er in dieselbe Liste.
     */
    private void startseitenEinstellungen(LinearLayout page) {
        addSpacing(page, MobileViews.sectionHeader(this, "Startseite", null, null),
            MobileViews.SECTION_GAP);
        addSpacing(page, MobileViews.subtitle(this,
            startseite.anzahlAn() + " von " + Startseite.REIHEN.size() + " Reihen sichtbar"), 0);
        for (Startseite.Reihe reihe : Startseite.REIHEN) {
            addSpacing(page, MobileViews.schalterZeile(this, reihe.titel, reihe.erklaerung,
                startseite.zeigt(reihe.schluessel),
                () -> {
                    startseite.umschalten(reihe.schluessel);
                    showSettings();
                }), MobileViews.ITEM_GAP);
        }
    }

    /**
     * Die Watchparty einrichten - dieselben vier Angaben wie am Rechner.
     *
     * <p>Server, Raumcodes, Gerätename und der Schalter. Mehr braucht es nicht:
     * der Raumcode ist der ganze Zugang, Konten gibt es keine.
     *
     * <p><b>Und warum das jetzt auch am Fernseher steht.</b> Es stand dort
     * nämlich nicht. {@code renderTvSettings} kannte diesen Abschnitt gar
     * nicht - der Fernseher zeigte unter "Meine Geräte" nur die Auskunft
     * "die Adresse steht bei der Watchparty" und verwies damit auf eine Seite,
     * die es auf ihm nicht gab. Die Adresse liess sich also weder eintragen
     * noch ändern, und ohne sie bleibt nicht nur die Watchparty aus, sondern
     * auch der Geräteabgleich: beide fahren zu demselben Relay.
     *
     * <p>Es ist ausdrücklich <em>derselbe</em> Abschnitt und keine zweite
     * Fassung für den Fernseher. Was er zeigt, woher es kommt und wohin es
     * gespeichert wird, ist auf beiden Geräten dieselbe Zeile Code; nur der
     * Zuschnitt der Karten unterscheidet sich, so wie bei "Meine Geräte".
     */
    private void watchpartyEinstellungen(LinearLayout page, boolean fernseher) {
        int abstand = fernseher ? TvViews.SECTION_GAP : MobileViews.SECTION_GAP;
        int luecke = fernseher ? TvViews.ITEM_GAP : MobileViews.ITEM_GAP;

        if (fernseher) {
            addSpacing(page, TvViews.sectionTitle(this, "Watchparty"), abstand);
        }

        addSpacing(page, karte(fernseher, "Watchparty", watchpartyStandText(),
            watchparty.istEingeschaltet() ? "Ausschalten" : "Einschalten",
            () -> {
                watchparty.setzeEingeschaltet(!watchparty.istEingeschaltet());
                showSettings();
            }), fernseher ? luecke : abstand);

        addSpacing(page, serverKarte(fernseher), luecke);

        List<String> codes = watchparty.raumcodes();
        addSpacing(page, karte(fernseher, "Raumcodes",
            codes.isEmpty()
                ? "Noch keiner. Derselbe Code auf allen Geräten, die zusammenlaufen sollen."
                : android.text.TextUtils.join(", ", codes),
            "Raum hinzufügen",
            () -> textFrage("Raumcode", "mindestens vier Zeichen", "", wert ->
                watchparty.raumHinzufuegen(wert, (angenommen, fehler) -> {
                    if (fehler != null) showToast(fehler);
                    else showToast("Raum hinzugefügt");
                    showSettings();
                }))), luecke);

        for (String code : codes) {
            addSpacing(page, karte(fernseher, "Raum " + code, "Dieses Gerät gehört zu diesem Raum.",
                "Entfernen", () -> frage("Raum entfernen?",
                    "Der Stand aus diesem Raum verschwindet von diesem Gerät. Auf den anderen bleibt er.",
                    () -> {
                        watchparty.raumEntfernen(code);
                        showSettings();
                    })), luecke);
        }

        addSpacing(page, karte(fernseher, "Name dieses Geräts",
            watchparty.geraetName().isEmpty() ? "Nicht gesetzt - nur zur Anzeige bei den anderen."
                : watchparty.geraetName(),
            "Ändern",
            () -> textFrage("Name dieses Geräts", fernseher ? "z. B. Fernseher" : "z. B. Handy",
                watchparty.geraetName(), wert -> {
                    watchparty.setzeGeraetName(wert);
                    showSettings();
                })), luecke);
    }

    /**
     * Der Verbindungszustand in Worten, die etwas heißen.
     *
     * <p>"Eingeschaltet" allein wäre keine Auskunft. Eine falsche Adresse darf
     * nicht wie eine funktionierende Verbindung aussehen - sie sieht nämlich
     * genau so aus, wenn nur "eingeschaltet" dasteht. Also steht jeder Fall
     * einzeln da, samt dem Handgriff, der ihn behebt.
     */
    private String watchpartyStandText() {
        if (!watchparty.istEingeschaltet()) {
            return "Aus. Eingeschaltet gleicht ELFIX den Weiterschauen-Stand mit deinen anderen "
                + "Geräten ab und lässt dich gemeinsam schauen.";
        }
        if (watchparty.serverUrl().isEmpty()) {
            return "Eingeschaltet, aber ohne Server-Adresse. Trag sie unten ein — ohne sie kann "
                + "sich nichts verbinden.";
        }
        String fehler = watchparty.fehlertext();
        if (!fehler.isEmpty()) {
            return "Nicht verbunden: " + fehler + "\n\nEs wird von selbst weiter versucht. "
                + "Stimmt die Adresse? " + watchparty.serverUrl();
        }
        if (!watchparty.istVerbunden()) {
            return "Eingeschaltet, noch nicht verbunden. Wird das nicht von selbst besser, prüf "
                + "die Adresse: " + watchparty.serverUrl();
        }
        List<String> codes = watchparty.raumcodes();
        if (codes.isEmpty()) {
            return "Verbunden mit " + watchparty.serverUrl()
                + ".\n\nNoch ohne Raum — trag unten denselben Raumcode ein wie auf den anderen Geräten.";
        }
        return "Verbunden mit " + watchparty.serverUrl() + ".";
    }

    /**
     * Die Server-Adresse: ein Feld, das wirklich dasteht.
     *
     * <p>Kein Dialog, und zwar aus demselben Grund wie beim Geräteschlüssel:
     * eine Adresse tippt man genau einmal ab, und dabei will man sehen, was
     * schon dasteht. Am Fernseher erst recht, wo jedes Zeichen einzeln erfahren
     * wird - und wo ein Dialog, der den Fokus nicht sicher an sein Feld gibt,
     * eine Einstellung unerreichbar macht.
     *
     * <p>Geprüft und in Form gebracht wird nicht hier, sondern im geteilten
     * Modul: {@code watchparty.js} entscheidet, was eine gültige Adresse ist,
     * mit demselben Wortlaut auf jedem Gerät. Siehe
     * {@link Watchparty#setzeServer(String, Kern.Antwort)}.
     */
    private View serverKarte(boolean fernseher) {
        LinearLayout karte = new LinearLayout(this);
        karte.setOrientation(LinearLayout.VERTICAL);
        int rand = dp(fernseher ? 22 : 14);
        karte.setPadding(rand, rand, rand, rand);
        karte.setBackground(MobileViews.shape(this, Theme.SURFACE_ELEVATED,
            MobileViews.CARD_RADIUS, Theme.BORDER, 1));

        TextView kopf = new TextView(this);
        kopf.setText("Server-Adresse");
        kopf.setTextColor(Theme.TEXT_PRIMARY);
        kopf.setTextSize(fernseher ? 20 : 16);
        kopf.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        karte.addView(kopf);

        EditText feld = new EditText(this);
        feld.setText(watchparty.serverUrl());
        feld.setHint("https://watchparty.deine-domain.tld");
        feld.setSingleLine(true);
        feld.setTextColor(Theme.TEXT_PRIMARY);
        feld.setHintTextColor(Theme.TEXT_DISABLED);
        feld.setTextSize(fernseher ? 18 : 15);
        // Eine Adresse ist kein Satz: keine Grossschreibung am Anfang und keine
        // Vorschlaege. Die Autokorrektur macht aus "wss" zuverlaessig "was".
        feld.setInputType(android.text.InputType.TYPE_CLASS_TEXT
            | android.text.InputType.TYPE_TEXT_VARIATION_URI
            | android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        feld.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_DONE);
        feld.setBackground(MobileViews.shape(this, Theme.SURFACE, 12, Theme.BORDER, 1));
        int feldRand = dp(12);
        feld.setPadding(feldRand, feldRand, feldRand, feldRand);
        feld.setFocusable(true);
        feld.setFocusableInTouchMode(true);
        // Am Fernseher muss man sehen, wo der Fokus steht - sonst tippt man ins
        // Leere und weiss nicht, warum sich nichts tut.
        if (fernseher) {
            feld.setOnFocusChangeListener((ansicht, hat) -> feld.setBackground(
                MobileViews.shape(this, Theme.SURFACE, 12,
                    hat ? Theme.PRIMARY : Theme.BORDER, hat ? 3 : 1)));
        }
        LinearLayout.LayoutParams feldMasse = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        feldMasse.topMargin = dp(10);
        karte.addView(feld, feldMasse);

        TextView hinweis = new TextView(this);
        hinweis.setText(watchparty.serverUrl().isEmpty()
            ? "Die volle Adresse deines Relays, mit http:// oder https:// davor. Ein Port darf "
                + "dahinter stehen: http://192.168.1.10:8787. Ohne sie bleiben Watchparty und "
                + "Geräteabgleich aus."
            : "Die volle Adresse deines Relays, mit http:// oder https:// davor. Ein Port darf "
                + "dahinter stehen. Dasselbe Relay benutzt auch „Meine Geräte“.");
        hinweis.setTextColor(Theme.TEXT_SECONDARY);
        hinweis.setTextSize(fernseher ? 15 : 13);
        hinweis.setLineSpacing(0, 1.15f);
        LinearLayout.LayoutParams hinweisMasse = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hinweisMasse.topMargin = dp(8);
        karte.addView(hinweis, hinweisMasse);

        LinearLayout knoepfe = new LinearLayout(this);
        knoepfe.setOrientation(fernseher ? LinearLayout.HORIZONTAL : LinearLayout.VERTICAL);
        LinearLayout.LayoutParams knopfBereich = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        knopfBereich.topMargin = dp(14);
        karte.addView(knoepfe, knopfBereich);

        Runnable uebernehmen = () -> serverUebernehmen(feld.getText().toString());
        // Fertig auf der Bildschirmtastatur speichert auch. Am Fernseher ist das
        // der kuerzeste Weg: tippen, fertig, und die Tastatur geht wieder zu.
        feld.setOnEditorActionListener((ansicht, aktion, ereignis) -> {
            uebernehmen.run();
            return true;
        });
        geraeteKnopf(knoepfe, fernseher, "Übernehmen", true, uebernehmen);
        if (!watchparty.serverUrl().isEmpty()) {
            geraeteKnopf(knoepfe, fernseher, "Löschen", false, () -> frage("Adresse löschen?",
                "Ohne Server-Adresse bleiben Watchparty und Geräteabgleich aus. Deine Räume, "
                    + "dein Schlüssel und dein Stand bleiben erhalten.",
                () -> serverUebernehmen("")));
        }
        return karte;
    }

    /**
     * Eine eingetippte Adresse übernehmen.
     *
     * <p>Die Beanstandung kommt aus dem geteilten Modul und wird gezeigt, statt
     * die Eingabe stillschweigend zu schlucken. Eine leere Eingabe ist erlaubt -
     * sie heißt "keine Adresse".
     */
    private void serverUebernehmen(String eingabe) {
        watchparty.setzeServer(eingabe, (gespeichert, fehler) -> {
            if (fehler != null) {
                showToast(fehler);
                return;
            }
            String wert = gespeichert == null ? "" : gespeichert;
            showToast(wert.isEmpty() ? "Adresse gelöscht" : "Gespeichert: " + wert);
            // Der Geraeteabgleich und das Metadaten-Gateway fahren zum selben
            // Relay und sollen die neue Adresse sofort benutzen - nicht erst
            // beim naechsten Start. Ohne das blieb eine korrigierte Adresse
            // wirkungslos, bis jemand die App neu startete.
            if (geraete != null) geraete.anwenden();
            if (empfehlungen != null) empfehlungen.erneutStarten(wert);
            showSettings();
        });
    }

    /** Eine Eingabe in einem Fenster. Die Tastatur verdeckt sie nicht - der Dialog rückt hoch. */
    private void textFrage(String titel, String hinweis, String vorbelegung,
                           java.util.function.Consumer<String> beiOk) {
        EditText feld = new EditText(this);
        feld.setHint(hinweis);
        feld.setText(vorbelegung == null ? "" : vorbelegung);
        feld.setSingleLine(true);
        feld.setTextColor(Theme.TEXT_PRIMARY);
        feld.setHintTextColor(Theme.TEXT_DISABLED);
        int rand = dp(20);
        FrameLayout rahmen = new FrameLayout(this);
        rahmen.setPadding(rand, dp(8), rand, 0);
        rahmen.addView(feld);

        // Am Fernseher muss man den Fokus sehen - ein Feld, das aussieht wie
        // ein Strich, ist kein Ziel fuer eine Fernbedienung.
        if (isTelevision()) {
            feld.setTextSize(18);
            feld.setPadding(dp(12), dp(12), dp(12), dp(12));
            feld.setBackground(MobileViews.shape(this, Theme.SURFACE, 12, Theme.PRIMARY, 3));
        }

        android.app.AlertDialog dialog = new android.app.AlertDialog.Builder(this)
            .setTitle(titel)
            .setView(rahmen)
            .setNegativeButton("Abbrechen", null)
            .setPositiveButton("Speichern", (welcher, was) -> beiOk.accept(feld.getText().toString().trim()))
            .create();
        // Die Bildschirmtastatur ausdruecklich anfordern. Auf dem Telefon kommt
        // sie ohnehin, sobald das Feld beruehrt wird; am Fernseher gibt es
        // nichts zu beruehren, und ohne diese Zeile stand der Dialog da, ohne
        // dass sich etwas eintippen liess.
        dialog.getWindow().setSoftInputMode(
            android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        dialog.show();
        feld.requestFocus();
    }

    private Provider providerForFavorite(Favorite favorite) {
        for (Provider provider : providers) {
            if (provider.id.equals(favorite.providerId())) return provider;
        }
        return null;
    }

    /** Eine Zeile in einer der vier Listen, mit Fortschritt und Aktionsmenü. */
    private View eintragsKarte(Favorite eintrag, Bibliothek liste) {
        String titel = cleanFavoriteTitle(eintrag.title(), eintrag.url());
        if (titel.isEmpty()) titel = "Titel";
        String hinweis = eintrag.istAbgeschlossen() ? "Abgeschlossen" : eintrag.folgenText();
        if (liste == Bibliothek.WEITERSCHAUEN && eintrag.wartetAufNaechsteFolge()) {
            hinweis = "Nächste Folge: " + eintrag.folgenText();
        }
        return MobileViews.favoriteCard(this, providerForFavorite(eintrag), titel, hinweis,
            eintrag.providerName(), eintrag.bild(),
            liste.zeigtFortschritt() ? eintrag.progress() : 0,
            liste.aufruf,
            () -> openFavorite(eintrag),
            anker -> eintragsMenue(anker, eintrag, liste));
    }

    /**
     * Was sich mit einem Eintrag anstellen laesst.
     *
     * <p>Die Auswahl haengt daran, wo er steht: aus Weiterschauen nimmt man ihn
     * heraus, ohne ihn zu verlieren; aus der Mediathek loescht man ihn wirklich.
     * Alles, was nicht rueckgaengig zu machen ist, fragt vorher nach.
     */
    private void eintragsMenue(View anker, Favorite eintrag, Bibliothek liste) {
        String titel = cleanFavoriteTitle(eintrag.title(), eintrag.url());
        android.widget.PopupMenu menue = new android.widget.PopupMenu(this, anker, Gravity.END);
        java.util.ArrayList<Runnable> aktionen = new java.util.ArrayList<>();

        menue.getMenu().add(liste.aufruf);
        aktionen.add(() -> openFavorite(eintrag));

        if (liste == Bibliothek.WEITERSCHAUEN) {
            menue.getMenu().add("Aus Weiterschauen nehmen");
            aktionen.add(() -> {
                bestand.ausWeiterschauenNehmen(eintrag.id());
                showToast("Aus Weiterschauen genommen");
            });
        }
        if (eintrag.istWatchlist()) {
            menue.getMenu().add("Von der Watchlist nehmen");
            aktionen.add(() -> {
                bestand.watchlistSetzen(eintrag.id(), false);
                showToast("Von der Watchlist genommen");
            });
        } else if (!eintrag.istAbgeschlossen()) {
            menue.getMenu().add("Auf die Watchlist setzen");
            aktionen.add(() -> {
                bestand.watchlistSetzen(eintrag.id(), true);
                showToast("Zur Watchlist hinzugefügt");
            });
        }
        if (!eintrag.istAbgeschlossen()) {
            menue.getMenu().add("Als abgeschlossen markieren");
            aktionen.add(() -> frage("Als abgeschlossen markieren?",
                titel + " wandert damit in die Mediathek und verlässt die Watchlist.",
                () -> {
                    bestand.alsAbgeschlossenMarkieren(eintrag.id());
                    showToast("In die Mediathek verschoben");
                }));
        } else {
            menue.getMenu().add("Zurück auf die Watchlist");
            aktionen.add(() -> {
                bestand.watchlistSetzen(eintrag.id(), true);
                showToast("Zurück auf der Watchlist");
            });
        }

        menue.getMenu().add("Löschen");
        aktionen.add(() -> frage("Eintrag löschen?",
            titel + " wird vollständig entfernt - auch der Fortschritt.",
            () -> {
                bestand.entfernen(eintrag.id());
                showToast("Gelöscht");
            }));

        menue.setOnMenuItemClickListener(punkt -> {
            for (int i = 0; i < menue.getMenu().size(); i += 1) {
                if (menue.getMenu().getItem(i) == punkt) {
                    aktionen.get(i).run();
                    return true;
                }
            }
            return false;
        });
        menue.show();
    }

    /**
     * Rueckfrage vor allem, was sich nicht zuruecknehmen laesst.
     *
     * <p>Derselbe Gedanke wie am Desktop: geloescht wird erst nach einem
     * zweiten Ja, und die Frage sagt, was genau verschwindet.
     */
    private void frage(String titel, String text, Runnable beiJa) {
        new android.app.AlertDialog.Builder(this)
            .setTitle(titel)
            .setMessage(text)
            .setNegativeButton("Abbrechen", null)
            .setPositiveButton("Ja", (dialog, welcher) -> beiJa.run())
            .show();
    }

    // --- Neue Fassungen ------------------------------------------------------

    /**
     * Die Karte in den Einstellungen - fuer Telefon und Fernseher dieselbe.
     *
     * <p>Sie sagt in jeder Lage, woran man ist: welche Fassung laeuft, ob
     * nachgesehen wird, was geladen wird, was bereitliegt. Ein Knopf, der nur
     * "Update" heisst und sonst nichts verraet, waere auf einem Geraet ohne
     * Laden zu wenig.
     */
    private View aktualisierungsKarte(boolean fernseher) {
        String eigene = aktualisierung == null ? "" : aktualisierung.eigeneFassung();
        String laeuft = eigene.isEmpty() ? "" : "ELFIX " + eigene + " läuft hier. ";
        Aktualisierung.Lage lage = aktualisierung == null
            ? Aktualisierung.Lage.RUHT : aktualisierung.lage();

        String text;
        String knopf = "Nach neuer Fassung sehen";
        Runnable beiKlick = () -> {
            if (aktualisierung != null) aktualisierung.nachsehen(true);
        };

        switch (lage) {
            case SUCHT:
                text = laeuft + "Es wird nachgesehen …";
                knopf = null;
                beiKlick = null;
                break;
            case LAEDT:
                text = laeuft + "ELFIX " + aktualisierung.neueFassung() + " wird geladen — "
                    + aktualisierung.fortschritt() + " %.";
                knopf = null;
                beiKlick = null;
                break;
            case BEREIT:
                text = laeuft + "ELFIX " + aktualisierung.neueFassung()
                    + " liegt bereit. Dein Bestand bleibt dabei stehen — es wird "
                    + "darüber installiert, nicht neu.";
                knopf = "Jetzt installieren";
                beiKlick = this::neueFassungInstallieren;
                break;
            case AKTUELL:
                text = laeuft + "Das ist die neueste Fassung.";
                break;
            case FEHLER:
                text = laeuft + "Nachsehen ging nicht: " + aktualisierung.fehler()
                    + "\n\nOhne Leitung geht es nicht — es schadet aber auch nichts, "
                    + "es später noch einmal zu versuchen.";
                break;
            default:
                text = laeuft + "ELFIX kommt aus keinem Laden und sieht selbst nach neuen "
                    + "Fassungen — beim Start, höchstens ein paar Mal am Tag.";
                break;
        }
        return karte(fernseher, "ELFIX aktualisieren", text, knopf, beiKlick);
    }

    /**
     * Die Frage, wenn eine Fassung geladen bereitliegt.
     *
     * <p>Genau einmal je Fassung. Wer "Später" sagt, findet sie in den
     * Einstellungen wieder - noch einmal von selbst gefragt wird nicht.
     */
    private void neueFassungAnbieten(String fassung) {
        if (isFinishing() || isDestroyed()) return;
        new android.app.AlertDialog.Builder(this)
            .setTitle("ELFIX " + fassung + " ist da")
            .setMessage("Geladen ist sie schon. Beim Installieren bleibt alles stehen, was hier "
                + "steht — Mediathek, Verlauf und Einstellungen inbegriffen.")
            .setNegativeButton("Später", (dialog, welcher) -> {
                if (aktualisierung != null) aktualisierung.ueberspringen();
            })
            .setPositiveButton("Installieren", (dialog, welcher) -> neueFassungInstallieren())
            .show();
    }

    /**
     * Von hier an entscheidet das Betriebssystem.
     *
     * <p>Fehlt ELFIX die Erlaubnis, ueberhaupt zu fragen, schickt
     * {@link Aktualisierung#installieren()} auf die Systemseite, auf der sie
     * sich geben laesst. Deshalb steht hier ein Hinweis und keine Fehlermeldung:
     * es ist nichts kaputt, es fehlt nur ein Haken.
     */
    private void neueFassungInstallieren() {
        if (aktualisierung == null) return;
        boolean darf = aktualisierung.darfInstallieren();
        if (!aktualisierung.installieren()) {
            showToast("Die geladene Fassung ist nicht mehr da — bitte noch einmal nachsehen");
            return;
        }
        if (!darf) {
            showToast("Erlaub ELFIX einmal, Apps zu installieren — danach hier noch einmal tippen");
        }
    }

    private View mobileFavoriteCard(Favorite favorite) {
        String title = cleanFavoriteTitle(favorite.title(), favorite.url());
        if (title.isEmpty()) title = "Favorit";
        return MobileViews.favoriteCard(this, providerForFavorite(favorite), title,
            favorite.folgenText(), favorite.providerName(), favorite.bild(),
            favorite.progress(), "Weiter ansehen",
            () -> openFavorite(favorite),
            anker -> eintragsMenue(anker, favorite, Bibliothek.WEITERSCHAUEN));
    }

    private TextView smallLabel(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(Color.rgb(255, 180, 185));
        view.setTextSize(14);
        view.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        return view;
    }

    private TextView titleText(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(Color.WHITE);
        view.setTextSize(heroTextSp());
        view.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        view.setMaxLines(2);
        view.setEllipsize(TextUtils.TruncateAt.END);
        return view;
    }

    private TextView copyText(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(Color.rgb(215, 222, 234));
        view.setTextSize(16);
        view.setPadding(0, dp(10), 0, dp(12));
        return view;
    }

    private TextView sectionTitle(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(Color.WHITE);
        view.setTextSize(20);
        view.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        view.setPadding(0, dp(18), 0, dp(10));
        return view;
    }

    private Button favoriteListButton(Favorite favorite) {
        Button button = new Button(this);
        button.setText(displayFavoriteTitle(favorite));
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER_VERTICAL);
        button.setTextColor(Color.WHITE);
        button.setTextSize(17);
        button.setFocusable(true);
        applyTvFocus(button, Color.rgb(28, 36, 50), Color.rgb(58, 72, 96), 18);
        button.setOnClickListener(view -> openFavorite(favorite));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(76));
        params.setMargins(0, 0, 0, dp(10));
        button.setLayoutParams(params);
        return button;
    }

    private void openActiveProvider() {
        Provider provider = activeProvider != null ? activeProvider : providers.isEmpty() ? null : providers.get(0);
        if (provider != null) openProvider(provider, provider.lastUrl.isEmpty() ? provider.startUrl : provider.lastUrl);
    }

    private void applyTvFocus(Button button, int normalColor, int focusedColor, int radiusDp) {
        applySurface(button, radiusDp,
            rounded(normalColor, radiusDp, SUBTLE_BORDER, 1),
            rounded(focusedColor, radiusDp, ACCENT, 3));
    }

    private void applyProviderFocus(Button button, boolean active) {
        int normalFill = active ? Color.rgb(86, 32, 44) : Color.rgb(28, 36, 50);
        applySurface(button, 16,
            rounded(normalFill, 16, active ? ACCENT : SUBTLE_BORDER, active ? 2 : 1),
            rounded(Color.rgb(112, 48, 62), 16, ACCENT, 3));
    }

    /**
     * Applies the idle/highlight backgrounds for a button.
     *
     * On TV the highlight is driven by D-pad focus and is deliberately loud (accent border, scale,
     * lift) because the selection has to be readable from the couch. On a touch device nothing is
     * ever "focused" while you tap, so the same treatment would either never show or leave a
     * stuck-looking highlight -- phones get a press state instead.
     */
    private void applySurface(Button button, int radiusDp, GradientDrawable idle, GradientDrawable highlight) {
        button.setBackground(idle);
        if (isTelevision()) {
            button.setOnFocusChangeListener((view, focused) -> {
                view.animate().scaleX(focused ? 1.06f : 1f).scaleY(focused ? 1.06f : 1f).setDuration(120).start();
                view.setBackground(focused ? highlight : idle);
                if (android.os.Build.VERSION.SDK_INT >= 21) view.setElevation(focused ? dp(6) : 0);
            });
            return;
        }
        button.setOnTouchListener((view, event) -> {
            int action = event.getActionMasked();
            if (action == MotionEvent.ACTION_DOWN) {
                view.setBackground(highlight);
            } else if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
                view.setBackground(idle);
            }
            return false;
        });
    }

    private void setChromeCollapsed(boolean collapsed, boolean moveFocus) {
        chromeCollapsed = collapsed;
        // On TV "collapsed" means gone, not a slimmer strip. Everything the small bar offered has a
        // key on the remote -- 1 favourite, BACK back, MENU brings the chrome back -- so the strip
        // only ever cost picture. Phones keep it: there is no remote to fall back on there.
        boolean hideOnTv = collapsed && isTelevision();
        if (appChrome != null) appChrome.setVisibility(collapsed ? View.GONE : View.VISIBLE);
        if (collapsedChrome != null) {
            collapsedChrome.setVisibility(collapsed && !hideOnTv ? View.VISIBLE : View.GONE);
        }
        if (chromeHolder != null) chromeHolder.setVisibility(hideOnTv ? View.GONE : View.VISIBLE);
        if (!moveFocus) return;
        if (collapsed) {
            focusActiveWebView();
        } else if (!focusActiveProviderButton()) {
            focusSearch();
        }
    }

    private void searchAllProviders(String query, LinearLayout results, TextView loading) {
        new Thread(() -> {
            ArrayList<SearchResult> found = new ArrayList<>();
            for (Provider provider : providers) {
                for (String variant : searchQueryVariants(query)) {
                    String searchUrl = provider.buildSearchUrl(variant);
                    ArrayList<SearchResult> providerResults = fetchSearchResults(provider, searchUrl, variant);
                    if (!providerResults.isEmpty()) {
                        found.addAll(providerResults);
                        break;
                    }
                }
            }

            runOnUiThread(() -> {
                results.removeView(loading);
                if (found.isEmpty()) {
                    results.addView(copyText("Keine direkten Treffer erkannt."));
                    return;
                }
                int insertIndex = Math.min(2, results.getChildCount());
                results.addView(sectionTitle("Gefundene Treffer"), insertIndex);
                int count = 0;
                for (SearchResult result : found) {
                    if (count >= 40) break;
                    Button button = new Button(this);
                    String meta = (result.genre == null || result.genre.isEmpty())
                        ? result.provider.name
                        : result.genre + " · " + result.provider.name;
                    button.setText(result.title + "\n" + meta);
                    button.setAllCaps(false);
                    button.setGravity(Gravity.CENTER_VERTICAL);
                    button.setTextColor(Color.WHITE);
                    button.setTextSize(16);
                    button.setFocusable(true);
                    applyTvFocus(button, Color.rgb(28, 36, 50), Color.rgb(58, 72, 96), 18);
                    button.setOnClickListener(view -> openProvider(result.provider, result.url));
                    LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(78));
                    params.setMargins(0, 0, 0, dp(10));
                    results.addView(button, Math.min(results.getChildCount(), insertIndex + 1 + count), params);
                    count += 1;
                }
            });
        }).start();
    }

    private List<String> searchQueryVariants(String query) {
        LinkedHashSet<String> variants = new LinkedHashSet<>();
        String original = (query == null ? "" : query).trim().replaceAll("\\s+", " ");
        if (original.isEmpty()) return new ArrayList<>();

        addSearchVariant(variants, original);
        String ascii = stripSearchAccents(original).toLowerCase().trim();
        addSearchVariant(variants, ascii);
        addSearchVariant(variants, ascii.replaceAll("[._:]+", " "));
        addSearchVariant(variants, ascii.replaceAll("[-_]+", " "));
        addSearchVariant(variants, ascii.replaceAll("\\s+", "-"));
        addSearchVariant(variants, ascii.replaceAll("\\s+", ""));
        addSearchVariant(variants, ascii.replace("-", ""));
        addSearchVariant(variants, ascii.replace("-", " "));
        addSearchVariant(variants, ascii.replaceAll("\\band\\b", "und"));
        addSearchVariant(variants, ascii.replaceAll("\\bund\\b", "and"));
        addSimilarTitleVariants(ascii, variants);
        addKnownTitleVariants(ascii, variants);

        ArrayList<String> result = new ArrayList<>();
        for (String variant : variants) {
            result.add(variant);
            if (result.size() >= 24) break;
        }
        return result;
    }

    private void addSearchVariant(Set<String> variants, String value) {
        String normalized = (value == null ? "" : value).trim().replaceAll("\\s+", " ");
        if (!normalized.isEmpty()) variants.add(normalized);
    }

    private String stripSearchAccents(String value) {
        String prepared = (value == null ? "" : value)
            .replace("Ä", "Ae")
            .replace("Ö", "Oe")
            .replace("Ü", "Ue")
            .replace("ä", "ae")
            .replace("ö", "oe")
            .replace("ü", "ue")
            .replace("ß", "ss");
        return Normalizer.normalize(prepared, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
    }

    private void addKnownTitleVariants(String query, Set<String> variants) {
        String compact = query.replaceAll("[^a-z0-9]+", "");
        String[][] phrases = new String[][] {
            {"spider", "man"},
            {"bat", "man"},
            {"super", "man"},
            {"iron", "man"},
            {"ant", "man"},
            {"aqua", "man"},
            {"wonder", "woman"},
            {"dragon", "ball"},
            {"one", "piece"},
            {"one", "punch", "man"},
            {"black", "clover"},
            {"black", "torch"},
            {"chainsaw", "man"},
            {"demon", "slayer"},
            {"jujutsu", "kaisen"},
            {"attack", "on", "titan"},
            {"my", "hero", "academia"},
            {"sword", "art", "online"},
            {"solo", "leveling"},
            {"fairy", "tail"},
            {"death", "note"},
            {"blue", "lock"},
            {"game", "of", "thrones"},
            {"prison", "break"},
            {"star", "wars"},
            {"star", "trek"}
        };

        for (String[] parts : phrases) {
            String joined = TextUtils.join("", parts);
            if (compact.equals(joined) || compact.contains(joined)) {
                addSearchVariant(variants, TextUtils.join(" ", parts));
                addSearchVariant(variants, TextUtils.join("-", parts));
                addSearchVariant(variants, joined);
            }
        }
    }

    private void addSimilarTitleVariants(String query, Set<String> variants) {
        String normalized = normalizeSearchText(query);
        if (normalized.isEmpty()) return;
        String[] rawTokens = normalized.split(" ");
        ArrayList<String> tokens = new ArrayList<>();
        for (String token : rawTokens) {
            if (!token.isEmpty()) tokens.add(token);
        }
        if (tokens.size() < 2) return;

        Set<String> articleWords = new HashSet<>();
        for (String word : new String[] {"the", "a", "an", "der", "die", "das", "den", "dem", "ein", "eine"}) {
            articleWords.add(word);
        }

        ArrayList<String> singular = new ArrayList<>();
        for (String token : tokens) singular.add(singularSearchToken(token));

        addTokenVariant(variants, singular);
        addTokenVariant(variants, withoutArticles(tokens, articleWords));
        addTokenVariant(variants, withoutArticles(singular, articleWords));
        addOfTheVariant(variants, tokens);
        addOfTheVariant(variants, singular);
    }

    private void addOfTheVariant(Set<String> variants, List<String> tokens) {
        for (int i = 0; i < tokens.size(); i += 1) {
            if (!"of".equals(tokens.get(i))) continue;
            if (i + 1 < tokens.size() && "the".equals(tokens.get(i + 1))) return;
            ArrayList<String> next = new ArrayList<>();
            next.addAll(tokens.subList(0, i + 1));
            next.add("the");
            next.addAll(tokens.subList(i + 1, tokens.size()));
            addTokenVariant(variants, next);
            return;
        }
    }

    private ArrayList<String> withoutArticles(List<String> tokens, Set<String> articleWords) {
        ArrayList<String> result = new ArrayList<>();
        for (String token : tokens) {
            if (!articleWords.contains(token)) result.add(token);
        }
        return result;
    }

    private void addTokenVariant(Set<String> variants, List<String> tokens) {
        if (tokens == null || tokens.size() < 2) return;
        String value = TextUtils.join(" ", tokens).trim();
        if (value.isEmpty()) return;
        addSearchVariant(variants, value);
        addSearchVariant(variants, value.replaceAll("\\s+", "-"));
        addSearchVariant(variants, value.replaceAll("\\s+", ""));
    }

    private String singularSearchToken(String token) {
        if (token == null) return "";
        if (token.matches("(?i).+ies") && token.length() > 4) return token.substring(0, token.length() - 3) + "y";
        if (token.matches("(?i).+ves") && token.length() > 4) return token.substring(0, token.length() - 3) + "f";
        if (token.matches("(?i).+s") && token.length() > 3 && !token.matches("(?i).*(ss|us|is)$")) return token.substring(0, token.length() - 1);
        return token;
    }

    private ArrayList<SearchResult> fetchSearchResults(Provider provider, String searchUrl, String query) {
        ArrayList<SearchResult> ajaxResults = fetchAjaxSearchResults(provider, searchUrl, query);
        if (!ajaxResults.isEmpty()) {
            bilderNachtragen(ajaxResults, searchUrl);
            return ajaxResults;
        }
        String html = holeTrefferseite(searchUrl);
        if (html.isEmpty()) return new ArrayList<>();
        return extractLinks(provider, searchUrl, html, query);
    }

    /** Die Trefferseite eines Anbieters holen - oder leer, wenn sie nicht kommt. */
    private String holeTrefferseite(String searchUrl) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(searchUrl).openConnection();
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "text/html,application/xhtml+xml");
            connection.setRequestProperty("User-Agent", "Mozilla/5.0 ElflixAndroid/0.2");
            int status = connection.getResponseCode();
            if (status < 200 || status >= 400) return "";

            StringBuilder html = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null && html.length() < 2_000_000) {
                    html.append(line).append('\n');
                }
            }
            return html.toString();
        } catch (Exception ignored) {
            return "";
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /**
     * Bilder zu Treffern nachtragen, die aus einer Ajax-Antwort kommen.
     *
     * <p>Die Schnellsuche mancher Anbieter antwortet mit reinem JSON: Titel,
     * Beschreibung, Adresse - kein Bild. Dieselben Titel stehen aber auch auf
     * der gewoehnlichen Trefferseite, und dort mit Bild. Sie wird deshalb
     * einmal geholt und ueber die Adresse zugeordnet; geraten wird nichts.
     *
     * <p>Einmal je Suche und Anbieter, nicht je Treffer - und gar nicht, wenn
     * schon alle Treffer ein Bild haben.
     */
    private void bilderNachtragen(ArrayList<SearchResult> treffer, String searchUrl) {
        boolean fehltEines = false;
        for (SearchResult ergebnis : treffer) {
            if (ergebnis.bild == null || ergebnis.bild.isEmpty()) fehltEines = true;
        }
        if (!fehltEines) return;

        String html = holeTrefferseite(searchUrl);
        if (html.isEmpty()) return;
        Map<String, String> bilder = bilderZuAdressen(html, searchUrl);
        if (bilder.isEmpty()) return;
        for (SearchResult ergebnis : treffer) {
            if (ergebnis.bild != null && !ergebnis.bild.isEmpty()) continue;
            String bild = bilder.get(ergebnis.url);
            if (bild != null) ergebnis.bild = bild;
        }
    }

    /** Welche Adresse auf einer Trefferseite welches Bild traegt. */
    private Map<String, String> bilderZuAdressen(String html, String baseUrl) {
        Map<String, String> bilder = new HashMap<>();
        Pattern pattern = Pattern.compile(
            "<a\\b[^>]*href\\s*=\\s*[\"']([^\"']+)[\"'][^>]*>([\\s\\S]*?)</a>",
            Pattern.CASE_INSENSITIVE);
        Matcher matcher = pattern.matcher(html);
        while (matcher.find()) {
            String href = absoluteUrl(baseUrl, matcher.group(1));
            if (href.isEmpty() || bilder.containsKey(href)) continue;
            String bild = Trefferbild.ausMarkup(matcher.group(2), baseUrl);
            if (!bild.isEmpty()) bilder.put(href, bild);
        }
        return bilder;
    }

    private ArrayList<SearchResult> fetchAjaxSearchResults(Provider provider, String searchUrl, String query) {
        ArrayList<SearchResult> results = new ArrayList<>();
        if (!usesAniWorldAjaxSearch(provider)) return results;

        HttpURLConnection connection = null;
        try {
            String endpoint = new URI(provider.startUrl).resolve("/ajax/search").toString();
            String body = "keyword=" + android.net.Uri.encode(query == null ? "" : query.trim());
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "application/json,text/javascript,*/*");
            connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
            connection.setRequestProperty("User-Agent", "Mozilla/5.0 ElflixAndroid/0.2");
            connection.setRequestProperty("X-Requested-With", "XMLHttpRequest");
            connection.setRequestProperty("Referer", searchUrl);
            connection.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));

            int status = connection.getResponseCode();
            if (status < 200 || status >= 400) return results;

            StringBuilder json = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null && json.length() < 1_000_000) {
                    json.append(line).append('\n');
                }
            }

            JSONArray payload = new JSONArray(json.toString());
            Set<String> seen = new HashSet<>();
            List<String> tokens = queryTokens(query);
            for (int i = 0; i < payload.length() && results.size() < 16; i += 1) {
                JSONObject item = payload.optJSONObject(i);
                if (item == null) continue;
                String href = absoluteUrl(endpoint, item.optString("link", ""));
                if (href.isEmpty() || seen.contains(href) || isNoiseUrl(href) || !isProviderResultUrl(provider, href, endpoint)) continue;
                SearchTitleParts titleParts = normalizeSearchResultTitle(cleanHtmlText(item.optString("title", "")), provider, query);
                String title = usableResultTitle(titleParts.title);
                if (title.isEmpty()) title = titleFromPath(href);
                if (title.length() < 2 || isNoiseTitle(title) || !matchesQuery(title, href, tokens)) continue;

                seen.add(href);
                SearchResult result = new SearchResult();
                result.provider = provider;
                result.title = title;
                result.genre = titleParts.genre;
                result.url = href;
                results.add(result);
            }
            return results;
        } catch (Exception ignored) {
            return results;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private boolean usesAniWorldAjaxSearch(Provider provider) {
        String name = provider == null || provider.name == null ? "" : provider.name.toLowerCase();
        try {
            String host = new URI(provider == null ? "" : provider.startUrl).getHost();
            return name.contains("aniworld") || (host != null && host.toLowerCase().contains("aniworld"));
        } catch (Exception ignored) {
            return name.contains("aniworld");
        }
    }

    private ArrayList<SearchResult> extractLinks(Provider provider, String baseUrl, String html, String query) {
        ArrayList<SearchResult> results = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        Pattern pattern = Pattern.compile("<a\\b([^>]*)href\\s*=\\s*[\"']([^\"']+)[\"']([^>]*)>([\\s\\S]*?)</a>", Pattern.CASE_INSENSITIVE);
        Matcher matcher = pattern.matcher(html);
        List<String> tokens = queryTokens(query);
        while (matcher.find() && results.size() < 16) {
            String href = absoluteUrl(baseUrl, matcher.group(2));
            if (href.isEmpty() || seen.contains(href) || isNoiseUrl(href) || !isProviderResultUrl(provider, href, baseUrl)) continue;
            String rawTitle = cleanHtmlText(matcher.group(4));
            if (rawTitle.isEmpty()) {
                rawTitle = cleanHtmlText(readHtmlAttribute(matcher.group(1), "title") + " " + readHtmlAttribute(matcher.group(3), "title")
                    + " " + readHtmlAttribute(matcher.group(1), "aria-label") + " " + readHtmlAttribute(matcher.group(3), "aria-label"));
            }
            SearchTitleParts titleParts = normalizeSearchResultTitle(rawTitle, provider, query);
            String title = usableResultTitle(titleParts.title);
            if (title.isEmpty()) title = titleFromPath(href);
            if (title.length() < 2 || isNoiseTitle(title)) continue;
            if (!matchesQuery(title, href, tokens)) continue;
            seen.add(href);
            SearchResult result = new SearchResult();
            result.provider = provider;
            result.title = title;
            result.genre = titleParts.genre;
            result.url = href;
            // Das Bild steckt im selben Verweis - Marke, Auswahlliste oder
            // Hintergrund. Gesucht wird nichts nach; siehe Trefferbild.
            result.bild = Trefferbild.ausMarkup(matcher.group(0), baseUrl);
            results.add(result);
        }
        appendRawContentLinks(results, seen, provider, baseUrl, html, tokens);
        return results;
    }

    private void appendRawContentLinks(ArrayList<SearchResult> results, Set<String> seen, Provider provider, String baseUrl, String html, List<String> tokens) {
        Pattern pattern = Pattern.compile("(?:href|data-href|data-url)\\s*=\\s*[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE);
        Matcher matcher = pattern.matcher(html);
        while (matcher.find() && results.size() < 16) {
            String href = absoluteUrl(baseUrl, matcher.group(1));
            if (href.isEmpty() || seen.contains(href) || isNoiseUrl(href) || !isProviderResultUrl(provider, href, baseUrl)) continue;
            String title = titleFromPath(href);
            if (title.isEmpty() || isNoiseTitle(title) || !matchesQuery(title, href, tokens)) continue;
            seen.add(href);
            SearchResult result = new SearchResult();
            result.provider = provider;
            result.title = title;
            result.url = href;
            results.add(result);
        }
    }

    private SearchTitleParts normalizeSearchResultTitle(String title, Provider provider, String query) {
        SearchTitleParts parts = new SearchTitleParts();
        String raw = cleanHtmlText(title == null ? "" : title);
        parts.title = raw;
        parts.genre = "";
        if (raw.isEmpty() || !isFilmoProvider(provider)) return parts;

        String genres = "action|abenteuer|animation|anime|biografie|comedy|crime|dokumentation|drama|familie|fantasy|geschichte|horror|komödie|komoedie|krimi|musik|mystery|romantik|science fiction|sci-fi|thriller|western";
        Matcher matcher = Pattern.compile("^(" + genres + ")\\s+(.{2,})$", Pattern.CASE_INSENSITIVE).matcher(raw);
        if (!matcher.find()) return parts;

        String candidateTitle = matcher.group(2).replaceAll("^[\\s:|–-]+", "").trim();
        if (candidateTitle.isEmpty() || isNoiseTitle(candidateTitle)) return parts;
        parts.title = candidateTitle;
        parts.genre = titleCaseGenre(matcher.group(1));
        return parts;
    }

    private String titleCaseGenre(String value) {
        String normalized = (value == null ? "" : value).replaceAll("(?i)komoedie", "Komödie");
        String[] tokens = normalized.split("\\s+");
        ArrayList<String> out = new ArrayList<>();
        for (String token : tokens) {
            if (token.isEmpty()) continue;
            out.add(token.substring(0, 1).toUpperCase() + token.substring(1).toLowerCase());
        }
        return TextUtils.join(" ", out);
    }

    private boolean isFilmoProvider(Provider provider) {
        String name = provider == null || provider.name == null ? "" : provider.name.toLowerCase();
        try {
            String host = new URI(provider == null ? "" : provider.startUrl).getHost();
            return name.contains("filmo") || (host != null && host.toLowerCase().contains("filmo"));
        } catch (Exception ignored) {
            return name.contains("filmo");
        }
    }

    private static final class SearchTitleParts {
        String title;
        String genre;
    }

    private List<String> queryTokens(String query) {
        ArrayList<String> tokens = new ArrayList<>();
        Matcher matcher = Pattern.compile("[a-z0-9]+", Pattern.CASE_INSENSITIVE).matcher(stripSearchAccents(query).toLowerCase());
        while (matcher.find()) {
            String token = matcher.group();
            if (token.length() > 1) tokens.add(token);
        }
        return tokens;
    }

    private boolean matchesQuery(String title, String href, List<String> tokens) {
        if (tokens.isEmpty()) return true;
        String pathText = searchablePathText(href);
        boolean pathMatches = true;
        for (String token : tokens) {
            if (!pathText.contains(token)) {
                pathMatches = false;
                break;
            }
        }
        if (pathMatches) return true;
        String compactPath = pathText.replaceAll("\\s+", "");
        String compactQuery = TextUtils.join("", tokens);
        if (!compactQuery.isEmpty() && compactPath.contains(compactQuery)) return true;

        String titleText = normalizeSearchText(title);
        String queryPhrase = TextUtils.join(" ", tokens);
        return (titleText.equals(queryPhrase) || titleText.replaceAll("\\s+", "").contains(compactQuery)) && contentPathLooksPlayable(href);
    }

    private String decodeUriSafe(String value) {
        try {
            return java.net.URLDecoder.decode(value, "UTF-8");
        } catch (Exception ignored) {
            return value == null ? "" : value;
        }
    }

    private String searchablePathText(String href) {
        try {
            URI uri = new URI(href);
            return normalizeSearchText(decodeUriSafe(uri.getPath() == null ? "" : uri.getPath()));
        } catch (Exception ignored) {
            return "";
        }
    }

    private String normalizeSearchText(String value) {
        return stripSearchAccents(value)
            .toLowerCase()
            .replaceAll("[^a-z0-9]+", " ")
            .replaceAll("\\s+", " ")
            .trim();
    }

    private boolean contentPathLooksPlayable(String href) {
        try {
            String path = new URI(href).getPath();
            if (path == null) return false;
            return path.matches("(?i).*(/stream/|/serie/|/series/|/anime/|/film/|/filme/|/movie/|/movies/|/watch/|/title/).*");
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean isProviderResultUrl(Provider provider, String href, String baseUrl) {
        try {
            URI target = new URI(href);
            URI base = new URI(baseUrl);
            if (target.getHost() == null || base.getHost() == null || !isAllowedResultHost(provider, target.getHost(), base.getHost())) return false;
            String targetPath = target.getPath() == null || target.getPath().isEmpty() ? "/" : target.getPath().replaceAll("/+$", "");
            String basePath = base.getPath() == null || base.getPath().isEmpty() ? "/" : base.getPath().replaceAll("/+$", "");
            if (href.equals(baseUrl) || targetPath.equals(basePath)) return false;
            if (targetPath.matches("(?i).*(^|/)(search|suche|login|register|logout|settings|profile|account|language|languages?)(/|$).*")) return false;
            return isKnownContentPath(provider, targetPath, target.getHost());
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean isAllowedResultHost(Provider provider, String targetHost, String baseHost) {
        String target = stripWww(targetHost);
        String base = stripWww(baseHost);
        String providerHost = "";
        try {
            providerHost = stripWww(new URI(provider == null ? "" : provider.startUrl).getHost());
        } catch (Exception ignored) {
            providerHost = "";
        }
        String name = provider == null || provider.name == null ? "" : provider.name.toLowerCase();
        if (target.equals(base) || (!providerHost.isEmpty() && target.equals(providerHost))) return true;
        if (target.endsWith("." + base) || base.endsWith("." + target)) return true;
        if (!providerHost.isEmpty() && (target.endsWith("." + providerHost) || providerHost.endsWith("." + target))) return true;
        if (name.contains("aniworld")) return target.contains("aniworld");
        if (name.equals("s.to") || name.contains("s.to")) return target.equals("s.to") || target.endsWith(".s.to") || target.matches("\\d{1,3}(\\.\\d{1,3}){3}");
        if (name.contains("filmo")) return target.contains("filmo");
        return false;
    }

    private boolean isStoProvider(Provider provider) {
        String name = provider == null || provider.name == null ? "" : provider.name.toLowerCase();
        try {
            String host = new URI(provider == null ? "" : provider.startUrl).getHost();
            host = host == null ? "" : host.toLowerCase();
            return name.equals("s.to") || name.contains("s.to") || host.equals("s.to") || host.endsWith(".s.to") || host.matches("\\d{1,3}(\\.\\d{1,3}){3}");
        } catch (Exception ignored) {
            return name.equals("s.to") || name.contains("s.to");
        }
    }

    private boolean isAniWorldProvider(Provider provider) {
        String name = provider == null || provider.name == null ? "" : provider.name.toLowerCase();
        try {
            String host = new URI(provider == null ? "" : provider.startUrl).getHost();
            host = host == null ? "" : host.toLowerCase();
            return name.contains("aniworld") || host.contains("aniworld");
        } catch (Exception ignored) {
            return name.contains("aniworld");
        }
    }

    private String stripWww(String hostname) {
        return (hostname == null ? "" : hostname).toLowerCase().replaceFirst("^www\\.", "");
    }

    private boolean isKnownContentPath(Provider provider, String pathName, String hostname) {
        String host = hostname == null ? "" : hostname.toLowerCase();
        String name = provider == null || provider.name == null ? "" : provider.name.toLowerCase();
        if (host.contains("aniworld") || name.contains("aniworld")) {
            return pathName.matches("(?i)^/anime/stream/[^/]+/?$");
        }
        if (host.equals("s.to") || host.endsWith(".s.to") || name.equals("s.to") || host.matches("\\d{1,3}(\\.\\d{1,3}){3}")) {
            return pathName.matches("(?i)^/serie/(stream/)?[^/]+/?$");
        }
        if (host.contains("filmo") || name.contains("filmo")) {
            return pathName.matches("(?i)^/(film|filme|movie|movies|stream)/[^/]+/?$")
                || pathName.matches("(?i)^/[^/]*[a-z][^/]*-[^/]+/?$");
        }
        return contentPathLooksPlayable(pathName);
    }

    private String readHtmlAttribute(String attrs, String name) {
        Matcher matcher = Pattern.compile(name + "\\s*=\\s*[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE).matcher(attrs == null ? "" : attrs);
        return matcher.find() ? matcher.group(1) : "";
    }

    private String usableResultTitle(String title) {
        String value = title == null ? "" : title.trim();
        if (value.isEmpty() || value.length() > 90 || isNoiseTitle(value)) return "";
        return value;
    }

    private String titleFromPath(String href) {
        try {
            String path = new URI(href).getPath();
            if (path == null || path.isEmpty()) return "";
            String[] parts = path.split("/");
            String slug = "";
            for (String part : parts) {
                if (!part.isEmpty()) slug = part;
            }
            StringBuilder title = new StringBuilder();
            for (String part : slug.split("[-_]+")) {
                if (part.isEmpty()) continue;
                if (title.length() > 0) title.append(" ");
                title.append(part.substring(0, 1).toUpperCase()).append(part.length() > 1 ? part.substring(1) : "");
            }
            return title.toString();
        } catch (Exception ignored) {
            return "";
        }
    }

    private String displayFavoriteTitle(Favorite favorite) {
        if (favorite == null) return "Favorit";
        String value = cleanFavoriteTitle(favorite.title(), favorite.url());
        if (value.isEmpty()) value = "Favorit";
        String progress = favorite.folgenText();
        return progress.isEmpty() ? value : value + " · " + progress;
    }

    private String cleanFavoriteTitle(String title, String url) {
        String raw = title == null ? "" : title.replaceAll("\\s+", " ").trim();
        String slugTitle = titleFromFavoriteUrl(url);
        if (raw.isEmpty()) return slugTitle;

        Matcher episode = Pattern.compile("\\b(?:episode|folge)\\s+\\d+\\s*(?:staffel\\s+\\d+\\s*)?(?:von|of)\\s+(.+?)(?:\\s*[|–-]\\s*|$)", Pattern.CASE_INSENSITIVE).matcher(raw);
        Matcher season = Pattern.compile("\\bstaffel\\s+\\d+\\s*(?:von|of)\\s+(.+?)(?:\\s*[|–-]\\s*|$)", Pattern.CASE_INSENSITIVE).matcher(raw);
        String value = episode.find() ? episode.group(1) : season.find() ? season.group(1) : raw;

        value = value
            .replaceAll("\\s*[|]\\s*.*$", "")
            .replaceAll("(?i)\\s+[–-]\\s*(Filmo|S\\.?to|AniWorld.*|Elflix).*$", "")
            .replaceAll("(?i)\\b(jetzt\\s+)?kostenlos\\s+streamen\\b", "")
            .replaceAll("(?i)\\bgratis\\s+legal\\s+online\\s+ansehen\\b", "")
            .replaceAll("(?i)\\bonline\\s+ansehen\\b", "")
            .replaceAll("(?i)\\bstream\\s+starten\\b", "")
            .replaceAll("(?i)\\banschauen\\b", "")
            .replaceAll("(?i)\\b(AniWorld\\.to\\s*/\\s*Animes?|AniWorld|Filmo|S\\.to|Elflix)\\b", "")
            .replaceAll("\\s+", " ")
            .replaceAll("^[\\s|–-]+|[\\s|–-]+$", "")
            .trim();

        if (value.isEmpty() || isFavoriteTitleNoise(value) || value.length() > 58) {
            return slugTitle.isEmpty() ? niceFavoriteTitle(value) : slugTitle;
        }
        return niceFavoriteTitle(value);
    }

    private boolean isFavoriteTitleNoise(String value) {
        return value.matches("(?i).*\\b(kostenlos|gratis|online ansehen|episode|folge|staffel|aniworld|filmo|s\\.to)\\b.*")
            && value.length() > 28;
    }

    private String titleFromFavoriteUrl(String url) {
        try {
            String path = new URI(url).getPath();
            if (path == null || path.isEmpty()) return "";
            String[] rawParts = path.split("/");
            ArrayList<String> parts = new ArrayList<>();
            for (String part : rawParts) {
                if (!part.isEmpty()) parts.add(part);
            }
            if (parts.isEmpty()) return "";

            String preferred = "";
            for (int i = 0; i < parts.size() - 1; i += 1) {
                if (parts.get(i).matches("(?i)^(stream|serie|film|filme|movie|movies|title)$")) {
                    preferred = parts.get(i + 1);
                    break;
                }
            }

            String fallback = "";
            for (int i = parts.size() - 1; i >= 0; i -= 1) {
                String part = parts.get(i);
                if (!part.matches("(?i)^(anime|stream|serie|series|film|filme|movie|movies|watch|title|staffel-\\d+|season-\\d+|episode-\\d+|folge-\\d+)$")) {
                    fallback = part;
                    break;
                }
            }
            return niceFavoriteTitle(slugToTitle(preferred.isEmpty() ? fallback : preferred));
        } catch (Exception ignored) {
            return "";
        }
    }

    private String slugToTitle(String slug) {
        try {
            return java.net.URLDecoder.decode(slug == null ? "" : slug, "UTF-8")
                .replaceAll("[-_]+", " ")
                .replaceAll("\\s+", " ")
                .trim();
        } catch (Exception ignored) {
            return slug == null ? "" : slug.replaceAll("[-_]+", " ").replaceAll("\\s+", " ").trim();
        }
    }

    private String niceFavoriteTitle(String value) {
        String trimmed = value == null ? "" : value.replaceAll("\\s+", " ").trim();
        if (trimmed.isEmpty()) return "";
        String source = trimmed.equals(trimmed.toUpperCase()) && trimmed.matches(".*[A-Z].*") ? trimmed.toLowerCase() : trimmed;
        StringBuilder title = new StringBuilder();
        boolean capitalize = true;
        for (int i = 0; i < source.length(); i += 1) {
            char c = source.charAt(i);
            if (Character.isLetterOrDigit(c)) {
                title.append(capitalize ? Character.toUpperCase(c) : c);
                capitalize = false;
            } else {
                title.append(c);
                capitalize = c == ' ' || c == '-' || c == '_';
            }
        }
        return title.toString();
    }

    private String absoluteUrl(String baseUrl, String href) {
        return Trefferbild.absolut(baseUrl, href);
    }

    private boolean isNoiseUrl(String url) {
        return url.matches("(?i).*/(login|register|logout|impressum|privacy|datenschutz|agb|terms)(/|$).*")
            || url.matches("(?i).*/(forum|forums|thread|threads|community|support|blog|news|empfehlungen|recommendations?|kommentar|comments?)(/|$).*")
            || url.matches("(?i).*[?&](replytocom|share|utm_).*");
    }

    private String cleanHtmlText(String value) {
        return value
            .replaceAll("(?is)<script[\\s\\S]*?</script>", " ")
            .replaceAll("(?is)<style[\\s\\S]*?</style>", " ")
            .replaceAll("<[^>]+>", " ")
            .replace("&amp;", "&")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&nbsp;", " ")
            .replaceAll("\\s+", " ")
            .trim();
    }

    private boolean isNoiseTitle(String title) {
        return title.matches("(?i)^(home|start|login|registrieren|register|impressum|datenschutz|mehr|weiter|zurueck|zurück)$")
            || title.matches("(?i).*(\\bjan\\b|\\bfeb\\b|\\bmar\\b|\\bapr\\b|\\bmai\\b|\\bjun\\b|\\bjul\\b|\\baug\\b|\\bsep\\b|\\bokt\\b|\\bnov\\b|\\bdez\\b).*")
            || title.matches("(?i).*(\\b20\\d{2}\\b|\\b19\\d{2}\\b).*\\b(\\d{1,2}:\\d{2}|folge|staffel|update|uncut|deutsch|german|verfuegbar|verfügbar|freundliche|gruesse|grüße|wann kommt)\\b.*")
            || title.matches("(?i).*\\b(folge|staffel)\\b.*\\b(vertauscht|falsch|nicht verfuegbar|nicht verfügbar|update|uncut|deutsch|wann kommt)\\b.*");
    }

    private static final class SearchResult {
        Provider provider;
        String title;
        String genre;
        String url;
        /** Das Titelbild, wenn die Trefferseite eines hergab - siehe {@link Trefferbild}. */
        String bild = "";
    }

    private void showGlobalSearch(String query) {
        currentScreen = "search";
        mouseMode = false;
        setMouseCursorVisible(false);
        setChromeCollapsed(false, false);
        content.removeAllViews();
        updateBottomNav();
        if (isTelevision()) renderTvSearch(query);
        else renderMobileSearch(query);
    }

    /**
     * Die Watchparty: Räume, eingestellte Titel und der Abgleich.
     *
     * <p>Was hier steht, ist bewusst knapp: der Raumcode ist der ganze
     * Zugang, und ein Gerät gehört entweder dazu oder nicht. Alles Weitere -
     * Verbindung, Mitglieder, Host - führt der geteilte Kern.
     */
    /**
     * Die Watchparty-Seite.
     *
     * <p>Sie zeigte bis hierher, dass eine Verbindung steht, welche Raeume es
     * gibt und welche Titel darin eingestellt sind. Unter jedem Titel stand
     * genau ein Knopf: "Verlassen". Die Folge liess sich nicht oeffnen, die
     * Staffel stand nirgends, und wer mitschaut, sah man nicht. Am Rechner
     * gibt es das alles seit langem.
     *
     * <p>Jetzt hier auch - aus denselben Daten. Der Eintrag, den das Relay
     * schickt, traegt ohnehin Titel, Adresse, Anbieter, Staffel, Folge, Stand,
     * Mitglieder und Host; er wurde nur nicht ausgelesen. Gerechnet wird
     * nichts davon auf diesem Geraet.
     *
     * <p>Ein Raum darf ausdruecklich mehrere Titel enthalten. Deshalb wird
     * nach Raum gegliedert, sobald es mehr als einen gibt, und jede Karte
     * traegt ihren Raum mit sich - ein Klick auf "Bleach" darf nie "BLACK
     * TORCH" oeffnen.
     */
    private void zeigeWatchparty() {
        currentScreen = "watchparty";
        mitschauPlatz = null;
        mouseMode = false;
        setMouseCursorVisible(false);
        setChromeCollapsed(false, false);
        content.removeAllViews();
        updateBottomNav();

        boolean fernseher = isTelevision();
        LinearLayout page = fernseher ? tvPage() : mobilePage();
        if (fernseher) {
            page.addView(TvViews.eyebrow(this, "Gemeinsam schauen"));
            page.addView(TvViews.heroTitle(this, "Watchparty"));
        } else {
            page.addView(MobileViews.eyebrow(this, "Gemeinsam schauen"));
            page.addView(MobileViews.heroTitle(this, "Watchparty"));
            page.addView(MobileViews.subtitle(this,
                "Derselbe Raumcode auf mehreren Geräten - der Stand läuft zusammen."));
        }

        if (!watchparty.istEingeschaltet() || watchparty.serverUrl().isEmpty()) {
            addSpacing(page, hinweisKarte(fernseher, "Noch nicht eingerichtet",
                "Trage in den Einstellungen die Adresse deines Relays und einen Raumcode ein. "
                    + "Denselben Code auf dem Rechner - dann laufen beide Stände zusammen.",
                "Zu den Einstellungen", this::showSettings, "tv:wp:einstellungen"),
                MobileViews.SECTION_GAP);
            tvFokusHerstellen(page);
            return;
        }

        addSpacing(page, hinweisKarte(fernseher, watchpartyKopfzeile(), watchpartyStatustext(),
            null, null, null), MobileViews.SECTION_GAP);

        // Ein Platz statt der Karte selbst: er bleibt stehen, waehrend sein
        // Inhalt im Sekundentakt wechselt (siehe mitschauStandGeaendert).
        mitschauPlatz = new FrameLayout(this);
        addSpacing(page, mitschauPlatz, MobileViews.ITEM_GAP);
        mitschauStandGeaendert();

        JSONArray eingestellt = watchparty.eintraege();
        if (eingestellt.length() == 0) {
            addSpacing(page, hinweisKarte(fernseher, "Noch nichts eingestellt",
                "Öffne einen Titel und stelle ihn über das Menü in einen Raum. Erst wer beitritt, "
                    + "teilt seinen Fortschritt - von allein wird nichts geteilt.",
                null, null, null), MobileViews.SECTION_GAP);
            tvFokusHerstellen(page);
            return;
        }

        // Gegliedert wird nach den eingerichteten Raeumen und nicht nach denen,
        // in denen schon etwas steht - sonst saehe man bei zwei Raeumen eine
        // Reihe Karten und wuesste nicht, zu welchem Raum sie gehoert.
        // Dieselbe Ueberlegung wie in watchpartyKarten() am Rechner.
        List<String> raeume = new ArrayList<>();
        JSONArray gemeldet = watchparty.raeume();
        for (int i = 0; i < gemeldet.length(); i += 1) {
            JSONObject raum = gemeldet.optJSONObject(i);
            String code = raum == null ? "" : raum.optString("room", "");
            if (!code.isEmpty() && !raeume.contains(code)) raeume.add(code);
        }
        for (int i = 0; i < eingestellt.length(); i += 1) {
            JSONObject eintrag = eingestellt.optJSONObject(i);
            String code = eintrag == null ? "" : eintrag.optString("room", "");
            if (!raeume.contains(code)) raeume.add(code);
        }

        int stelle = 0;
        boolean mehrereRaeume = raeume.size() > 1;
        if (!mehrereRaeume) {
            addSpacing(page, fernseher
                ? TvViews.sectionTitle(this, "Im Raum eingestellt")
                : MobileViews.sectionHeader(this, "Im Raum eingestellt", null, null),
                MobileViews.SECTION_GAP);
        }
        for (String raum : raeume) {
            List<JSONObject> karten = new ArrayList<>();
            for (int i = 0; i < eingestellt.length(); i += 1) {
                JSONObject eintrag = eingestellt.optJSONObject(i);
                if (eintrag == null) continue;
                if (raum.equals(eintrag.optString("room", ""))) karten.add(eintrag);
            }
            if (mehrereRaeume) {
                String kopf = raum.isEmpty() ? "Ohne Raum" : "Raum " + raum;
                addSpacing(page, fernseher
                    ? TvViews.sectionTitle(this, kopf + "  ·  " + raumStatus(raum))
                    : MobileViews.sectionHeader(this, kopf + "  ·  " + raumStatus(raum), null, null),
                    MobileViews.SECTION_GAP);
            }
            if (karten.isEmpty()) {
                addSpacing(page, hinweisKarte(fernseher, "Noch nichts eingestellt",
                    "In diesem Raum steht gerade kein Titel.", null, null, null),
                    MobileViews.ITEM_GAP);
                continue;
            }
            for (JSONObject eintrag : karten) {
                addSpacing(page, watchpartyKarte(eintrag, stelle), MobileViews.ITEM_GAP);
                stelle += 1;
            }
        }
        tvFokusHerstellen(page);
    }

    /**
     * Ein Kasten mit Ueberschrift, Text und hoechstens einer Aktion.
     *
     * <p>Es gab dafuer zwei Bauteile - {@code settingsCard} fuers Telefon und
     * {@code TvViews.infoCard} fuer den Fernseher - und an jeder Stelle stand
     * dieselbe Verzweigung. Hier steht sie einmal, mitsamt der Fokusmarke, die
     * der Fernseher braucht.
     */
    private View hinweisKarte(boolean fernseher, String titel, String text,
                              String knopf, Runnable beiKlick, String marke) {
        View karte = fernseher
            ? TvViews.infoCard(this, titel, text, knopf, beiKlick)
            : settingsCard(titel, text, knopf, beiKlick);
        // Die Aktion der TV-Karte ist ihr letztes Kind; sie ist das Fokusziel,
        // nicht die Karte. Ohne Aktion gibt es dort nichts zu fokussieren.
        if (fernseher && marke != null && karte instanceof ViewGroup) {
            ViewGroup gruppe = (ViewGroup) karte;
            if (gruppe.getChildCount() > 0) {
                View letztes = gruppe.getChildAt(gruppe.getChildCount() - 1);
                if (letztes.isFocusable()) letztes.setTag(marke);
            }
        }
        return karte;
    }

    /** Die Kopfzeile der Statuskarte: verbunden, nicht verbunden, ausgeschaltet. */
    private String watchpartyKopfzeile() {
        if (!watchparty.istEingeschaltet()) return "Ausgeschaltet";
        return watchparty.istVerbunden() ? "Verbunden" : "Nicht verbunden";
    }

    /**
     * Derselbe Satz wie am Rechner ({@code renderWatchpartyViewStatus}): wo man
     * ist, wer sonst noch da ist, und wofuer das gut ist.
     */
    private String watchpartyStatustext() {
        String grund = "Wenn du beitrittst, läuft euer Fortschritt zusammen.";
        String fehler = watchparty.fehlertext();
        if (!watchparty.istVerbunden()) {
            return fehler.isEmpty() ? "Verbinde mit dem Raum …" : "Nicht verbunden: " + fehler;
        }
        JSONArray raeume = watchparty.raeume();
        List<String> stehen = new ArrayList<>();
        int andere = 0;
        for (int i = 0; i < raeume.length(); i += 1) {
            JSONObject raum = raeume.optJSONObject(i);
            if (raum == null || !raum.optBoolean("connected", false)) continue;
            stehen.add(raum.optString("room", ""));
            JSONArray leute = raum.optJSONArray("peers");
            andere = Math.max(andere, Math.max(0, (leute == null ? 1 : leute.length()) - 1));
        }
        String geraete = andere == 0 ? "noch niemand sonst"
            : andere + " weiteres Gerät" + (andere == 1 ? "" : "e");
        String wo = stehen.size() > 1
            ? stehen.size() + " Räume (" + String.join(", ", stehen) + ")"
            : "Raum „" + (stehen.isEmpty() ? "?" : stehen.get(0)) + "“";
        // Der eigene Name gehoerte schon auf die alte Karte und bleibt: bei
        // drei Geraeten in einem Raum ist "welches bin ich" eine echte Frage.
        String eigen = watchparty.geraetName();
        return wo + " — " + geraete + ". " + grund
            + (eigen.isEmpty() ? "" : "\n\nDieses Gerät: " + eigen);
    }

    /** Wie es um einen einzelnen Raum steht - fuer die Ueberschrift bei mehreren. */
    private String raumStatus(String code) {
        JSONArray raeume = watchparty.raeume();
        for (int i = 0; i < raeume.length(); i += 1) {
            JSONObject raum = raeume.optJSONObject(i);
            if (raum == null || !code.equals(raum.optString("room", ""))) continue;
            if (!raum.optBoolean("connected", false)) {
                String fehler = raum.optString("error", "");
                return fehler.isEmpty() ? "nicht verbunden" : fehler;
            }
            JSONArray leute = raum.optJSONArray("peers");
            int andere = Math.max(0, (leute == null ? 1 : leute.length()) - 1);
            return andere == 0 ? "nur du"
                : andere + " weiteres Gerät" + (andere == 1 ? "" : "e");
        }
        return "nicht verbunden";
    }

    /**
     * Was gerade wirklich laeuft: wer mitschaut, wo jeder steht, wer fuehrt.
     *
     * <p>Bis hierher zeigte der Fernseher nur, ob eine Verbindung steht und
     * welche Titel eingestellt sind - also die Verwaltung. Was beim Schauen
     * zaehlt, stand nirgends: ob die anderen laufen oder stehen, wie weit sie
     * sind, und wer zuletzt gedrueckt hat.
     *
     * <p>Die Angaben kommen fertig vom Relay ({@code watchstate}) und werden
     * hier nicht nachgerechnet - insbesondere nicht die Altersangabe: sonst
     * mischten sich zwei Uhren, und jede Abweichung zwischen Geraet und Relay
     * stuende in der Anzeige.
     *
     * @return {@code null}, wenn gerade nichts mitlaeuft
     */
    private View mitschauKarte() {
        if (watchparty == null) return null;
        JSONObject stand = watchparty.mitschauStand();
        String schluessel = Mitschaustand.schluessel(
            stand.optString("key", ""), stand.optString("room", ""));

        // Ueber die Frischepruefung und mit der Alterung - nicht roh.
        //
        // Vorher stand hier die gemeldete Stelle unveraendert und jedes
        // Mitglied, das je gemeldet hatte. Ein Geraet, dessen WLAN weg ist,
        // blieb damit fuer immer als "schaut gerade bei 12:04" stehen, und eine
        // Sekunde nach der Meldung stimmte die Uhr schon nicht mehr. Beides
        // rechnet {@link Livestand} - dieselbe Rechnung, die auch der Streifen
        // ueber dem Bild anstellt, und dieselbe Grenze wie bei den Kacheln der
        // Startseite.
        java.util.List<Livestand.Marke> marken = Livestand.marken(
            watchparty.mitgliederZu(schluessel),
            watchparty.sekundenSeitMeldung(schluessel),
            stand.optInt("season", 0), stand.optInt("episode", 0));
        if (marken.isEmpty()) return null;

        StringBuilder zeilen = new StringBuilder();
        for (Livestand.Marke person : marken) {
            if (zeilen.length() > 0) zeilen.append("\n");
            zeilen.append(Livestand.zeile(person));
        }

        // Wer gedrueckt hat - nicht, wer gerade angehalten ist. Zieht ein
        // zweites Geraet die Pause nur mit, bleibt der Ausloeser derselbe.
        // Genau deshalb kommt der Name aus "lastAction" und nicht daraus, wer
        // pausiert dasteht: sonst stuende dort irgendwann ein falscher.
        JSONObject letzte = stand.optJSONObject("lastAction");
        if (letzte != null) {
            String wer = letzte.optString("name", "");
            String was = letzte.optString("type", "");
            if (!wer.isEmpty() && !was.isEmpty()) {
                zeilen.append("\n\n")
                    .append("pause".equals(was) ? "Angehalten von "
                        : "play".equals(was) ? "Gestartet von "
                        : "navigate".equals(was) ? "Folge gewechselt von " : "Gesprungen von ")
                    .append(wer);
            }
        }

        // Welcher Titel gemeint ist, gehoert dazu. Ein Raum darf mehrere
        // fuehren, und "Wer schaut mit" ohne Titel waere bei drei Serien im
        // selben Raum eine Auskunft ueber irgendeine davon.
        String titel = "";
        JSONArray eintraege = watchparty.eintraege();
        for (int i = 0; i < eintraege.length(); i += 1) {
            JSONObject eintrag = eintraege.optJSONObject(i);
            if (eintrag == null) continue;
            if (!stand.optString("key", "").equals(eintrag.optString("key", ""))) continue;
            if (!stand.optString("room", "").equals(eintrag.optString("room", ""))) continue;
            titel = eintrag.optString("title", "");
            break;
        }

        Livestand.Marke host = Livestand.host(marken);
        String kopf = titel.isEmpty() ? "Wer schaut mit" : "Wer schaut mit  ·  " + titel;
        if (host != null) kopf = kopf + "  ·  " + host.anzeige + " führt";
        return isTelevision()
            ? TvViews.infoCard(this, kopf, zeilen.toString(), null, null)
            : settingsCard(kopf, zeilen.toString(), null, null);
    }

    /** Sekunden als Uhrzeit - dieselbe Schreibweise wie am Rechner. */
    private static String uhrzeit(double sekunden) {
        int gesamt = (int) Math.max(0, Math.round(sekunden));
        int stunden = gesamt / 3600;
        int minuten = (gesamt % 3600) / 60;
        int rest = gesamt % 60;
        return stunden > 0
            ? String.format(java.util.Locale.GERMANY, "%d:%02d:%02d", stunden, minuten, rest)
            : String.format(java.util.Locale.GERMANY, "%d:%02d", minuten, rest);
    }

    /**
     * Eine Karte je Titel im Raum.
     *
     * <p>Ein Bauplan fuer beide Geraete, zwei Saetze Bauteile. Was sie zeigt
     * und was ihre Knoepfe tun, ist auf Telefon und Fernseher dasselbe; wie
     * ein Knopf aussieht und ob er einen Fokusrahmen traegt, nicht.
     *
     * <p>Die Reihenfolge der Aktionen ist die des Rechners, mit einem
     * Unterschied: dort ist "Beitreten/Verlassen" der erste Knopf, hier ist es
     * "Folge öffnen". Auf einem Fernseher ist Oeffnen das, was man will; das
     * Beitreten geschieht einmal und dann nie wieder.
     *
     * @param stelle laufende Nummer fuer die Fokusmarke des Fernsehers
     */
    private View watchpartyKarte(JSONObject eintrag, int stelle) {
        boolean fernseher = isTelevision();
        String schluessel = eintrag.optString("key", "");
        String raum = eintrag.optString("room", "");
        boolean dabei = eintrag.optBoolean("joined", false);
        boolean meins = eintrag.optBoolean("mine", false);
        boolean oeffenbar = eintrag.optBoolean("openable", false);
        String rohTitel = eintrag.optString("title", "");
        final String titel = rohTitel.isEmpty() ? "Titel" : rohTitel;

        LinearLayout karte = new LinearLayout(this);
        karte.setOrientation(LinearLayout.VERTICAL);
        karte.setClipChildren(false);
        karte.setClipToPadding(false);
        int rand = dp(fernseher ? 20 : 16);
        karte.setPadding(rand, rand, rand, rand);
        karte.setBackground(fernseher
            ? TvViews.shape(this, Theme.SURFACE_ELEVATED, TvViews.CARD_RADIUS, Theme.BORDER, 1)
            : MobileViews.shape(this, Theme.SURFACE_ELEVATED, 14, Theme.BORDER, 1));

        // --- Kopf: Bild und Text nebeneinander --------------------------------
        LinearLayout kopf = new LinearLayout(this);
        kopf.setOrientation(LinearLayout.HORIZONTAL);

        int bildBreite = fernseher ? 78 : 58;
        int bildHoehe = Math.round(bildBreite * 1.42f);
        Provider anbieter = providerMitId(eintrag.optString("providerId", ""));
        FrameLayout bild = MobileViews.poster(this, anbieter, titel,
            eintrag.optString("thumbnail", ""), 0, bildBreite, bildHoehe, 20, 0);
        LinearLayout.LayoutParams bildParams =
            new LinearLayout.LayoutParams(dp(bildBreite), dp(bildHoehe));
        bildParams.rightMargin = dp(14);
        kopf.addView(bild, bildParams);

        LinearLayout texte = new LinearLayout(this);
        texte.setOrientation(LinearLayout.VERTICAL);

        TextView name = new TextView(this);
        name.setText(titel);
        name.setTextColor(Theme.TEXT_PRIMARY);
        name.setTextSize(fernseher ? 20 : 17);
        name.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        // Umbrechen statt abschneiden: ein langer Serienname ist der Normalfall.
        name.setMaxLines(2);
        name.setEllipsize(TextUtils.TruncateAt.END);
        texte.addView(name);

        // Staffel und Folge stehen nur da, wenn sie bekannt sind. Erfunden wird
        // nichts: ein Film hat keine, und eine Serie, bei der noch niemand
        // weitergeschaut hat, auch nicht.
        String folgenzeile = watchpartyFolgentext(eintrag);
        String anbietername = eintrag.optString("providerName", "");
        String zeile = zusammen(folgenzeile, anbietername);
        if (!zeile.isEmpty()) {
            TextView unter = new TextView(this);
            unter.setText(zeile);
            unter.setTextColor(Theme.TEXT_SECONDARY);
            unter.setTextSize(fernseher ? 16 : 14);
            unter.setMaxLines(2);
            unter.setPadding(0, dp(4), 0, 0);
            texte.addView(unter);
        }

        // Wo die Runde gerade steht - dieselbe Zeile wie auf der Karte am
        // Rechner, sobald jemand Beigetretenes weiterschaut.
        String laufend = watchpartyStandtext(eintrag);
        if (!laufend.isEmpty()) {
            TextView stand = new TextView(this);
            stand.setText(laufend);
            stand.setTextColor(Theme.PRIMARY);
            stand.setTextSize(fernseher ? 15 : 13);
            stand.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            stand.setMaxLines(1);
            stand.setEllipsize(TextUtils.TruncateAt.END);
            stand.setPadding(0, dp(4), 0, 0);
            texte.addView(stand);
        }

        TextView leute = new TextView(this);
        leute.setText(watchpartyMitgliedertext(eintrag));
        leute.setTextColor(Theme.TEXT_DISABLED);
        leute.setTextSize(fernseher ? 15 : 13);
        leute.setMaxLines(3);
        leute.setEllipsize(TextUtils.TruncateAt.END);
        leute.setPadding(0, dp(6), 0, 0);
        texte.addView(leute);

        kopf.addView(texte, new LinearLayout.LayoutParams(
            0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        karte.addView(kopf, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // --- Aktionen ---------------------------------------------------------
        LinearLayout aktionen = new LinearLayout(this);
        aktionen.setOrientation(LinearLayout.HORIZONTAL);
        aktionen.setClipChildren(false);
        aktionen.setClipToPadding(false);
        LinearLayout.LayoutParams aktionenParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        aktionenParams.topMargin = dp(14);

        // Die Hauptaktion. Ohne passenden eingerichteten Anbieter fuehrt sie
        // nirgendwohin - dann sagt sie das, statt ins Leere zu greifen.
        String oeffnenText = folgenzeile.isEmpty() ? "Öffnen" : "Folge öffnen";
        View oeffnen = fernseher
            ? (oeffenbar
                ? TvViews.hauptPillButton(this, oeffnenText,
                    () -> watchpartyEintragOeffnen(schluessel, raum))
                : TvViews.pillButton(this, "Kein Anbieter", () ->
                    showToast("Für diesen Titel ist kein Anbieter eingerichtet")))
            : (oeffenbar
                ? MobileViews.primaryButton(this, oeffnenText,
                    () -> watchpartyEintragOeffnen(schluessel, raum))
                : MobileViews.secondaryButton(this, "Kein Anbieter", () ->
                    showToast("Für diesen Titel ist kein Anbieter eingerichtet")));
        oeffnen.setTag("tv:wp:" + stelle + ":oeffnen");
        aktionen.addView(oeffnen, knopfPlatz(fernseher));

        View beitreten = fernseher
            ? TvViews.pillButton(this, dabei ? "Verlassen" : "Beitreten",
                () -> watchpartyBeitrittUmschalten(schluessel, raum, titel, dabei))
            : MobileViews.secondaryButton(this, dabei ? "Verlassen" : "Beitreten",
                () -> watchpartyBeitrittUmschalten(schluessel, raum, titel, dabei));
        beitreten.setTag("tv:wp:" + stelle + ":beitritt");
        LinearLayout.LayoutParams zweitParams = knopfPlatz(fernseher);
        zweitParams.leftMargin = dp(10);
        aktionen.addView(beitreten, zweitParams);

        // Alles Seltenere in ein Menue: Host weitergeben, jemanden entfernen,
        // den Titel aus dem Raum nehmen. Auf einer schmalen Karte waeren das
        // drei weitere Knoepfe, und mit der Fernbedienung drei weitere Stationen
        // auf dem Weg zum Oeffnen.
        boolean binHost = !eintrag.optString("hostId", "").isEmpty()
            && eintrag.optString("hostId", "").equals(eintrag.optString("myId", ""));
        // Auch fuer blosse Teilnehmer: dort steht "Mit Host abgleichen", und das
        // ist die Aktion, die man am haeufigsten braucht. Am Rechner sitzt sie
        // in der Leiste ueber dem Bild; hier gehoert sie zusaetzlich an den
        // Eintrag, weil man von der Watchparty-Seite aus abgleichen koennen muss,
        // ohne die Folge erst zu oeffnen.
        if (meins || binHost || dabei) {
            View mehr = fernseher
                ? TvViews.pillButton(this, "…", null)
                : MobileViews.secondaryButton(this, "…", null);
            mehr.setOnClickListener(anker -> watchpartyMenue(anker, eintrag));
            mehr.setTag("tv:wp:" + stelle + ":mehr");
            LinearLayout.LayoutParams mehrParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                fernseher ? ViewGroup.LayoutParams.WRAP_CONTENT : dp(MobileViews.TOUCH_TARGET));
            mehrParams.leftMargin = dp(10);
            aktionen.addView(mehr, mehrParams);
        }
        karte.addView(aktionen, aktionenParams);

        // Die ganze Karte oeffnet ebenfalls - auf dem Telefon der bequemere
        // Weg. Auf dem Fernseher bleibt es bei den Knoepfen: eine fokussierbare
        // Karte *und* fokussierbare Knoepfe darin waeren eine Station zu viel.
        if (!fernseher && oeffenbar) {
            karte.setOnClickListener(v -> watchpartyEintragOeffnen(schluessel, raum));
        }
        return karte;
    }

    private LinearLayout.LayoutParams knopfPlatz(boolean fernseher) {
        return new LinearLayout.LayoutParams(0,
            fernseher ? ViewGroup.LayoutParams.WRAP_CONTENT : dp(MobileViews.TOUCH_TARGET), 1);
    }

    /**
     * "Staffel 3 · Folge 8" - oder nichts.
     *
     * <p>Der Stand der Runde geht vor der Angabe am Titel: er ist juenger.
     * Dieselbe Vorrangregel wie auf der Karte am Rechner. Fehlt beides, steht
     * hier nichts - eine erfundene Folge waere schlimmer als keine.
     */
    static String watchpartyFolgentext(JSONObject eintrag) {
        int staffel = eintrag.optInt("staffel", 0);
        int folge = eintrag.optInt("folge", 0);
        if (staffel <= 0 && folge <= 0) {
            JSONObject stand = eintrag.optJSONObject("progress");
            staffel = stand == null ? eintrag.optInt("season", 0) : stand.optInt("season", 0);
            folge = stand == null ? eintrag.optInt("episode", 0) : stand.optInt("episode", 0);
            if (staffel <= 0) staffel = eintrag.optInt("season", 0);
            if (folge <= 0) folge = eintrag.optInt("episode", 0);
        }
        if (folge <= 0) return "";
        return staffel > 0 ? "Staffel " + staffel + " · Folge " + folge : "Folge " + folge;
    }

    /** "12:37 / 24:10 · Elias" - nur, wenn wirklich jemand weiterschaut. */
    private String watchpartyStandtext(JSONObject eintrag) {
        double dauer = eintrag.optDouble("dauer", 0);
        double stelle = eintrag.optDouble("stelle", 0);
        String von = eintrag.optString("von", "");
        if (dauer <= 0) {
            JSONObject stand = eintrag.optJSONObject("progress");
            if (stand == null) return "";
            dauer = stand.optDouble("duration", 0);
            stelle = stand.optDouble("position", 0);
            von = stand.optString("from", "");
        }
        if (dauer <= 0) return "";
        String text = uhrzeit(stelle) + " / " + uhrzeit(dauer);
        return von.isEmpty() ? text : text + "  ·  " + von;
    }

    /**
     * "Host: Elias · 2 dabei: Elias, Fernseher" - dieselbe Zeile wie am Rechner.
     *
     * <p>Der Host steht dabei, weil er beim Abgleich den Takt vorgibt. Ob ich
     * es selbst bin, entscheidet die Kennung und nicht der Name: zwei Geraete
     * koennen gleich heissen, und ein Namenstreffer verdeckte, dass man gar
     * nicht dabei ist.
     */
    static String watchpartyMitgliedertext(JSONObject eintrag) {
        JSONArray namen = eintrag.optJSONArray("members");
        if (namen == null || namen.length() == 0) return "noch niemand dabei";
        String hostId = eintrag.optString("hostId", "");
        String meineId = eintrag.optString("myId", "");
        String hostName = eintrag.optString("hostName", "");
        boolean binHost = hostId.isEmpty()
            ? !hostName.isEmpty() && hostName.equals(eintrag.optString("myName", ""))
            : hostId.equals(meineId);
        StringBuilder text = new StringBuilder();
        if (!hostName.isEmpty()) {
            text.append(binHost ? "du bist Host" : "Host: " + hostName).append("  ·  ");
        }
        text.append(namen.length()).append(" dabei: ");
        for (int i = 0; i < namen.length(); i += 1) {
            if (i > 0) text.append(", ");
            text.append(namen.optString(i, "Gerät"));
        }
        return text.toString();
    }

    /** Host weitergeben, jemanden entfernen, den Titel aus dem Raum nehmen. */
    private void watchpartyMenue(View anker, JSONObject eintrag) {
        String schluessel = eintrag.optString("key", "");
        String raum = eintrag.optString("room", "");
        String titel = eintrag.optString("title", "Titel");
        String meineId = eintrag.optString("myId", "");
        boolean meins = eintrag.optBoolean("mine", false);
        boolean binHost = !eintrag.optString("hostId", "").isEmpty()
            && eintrag.optString("hostId", "").equals(meineId);
        JSONArray namen = eintrag.optJSONArray("members");
        JSONArray kennungen = eintrag.optJSONArray("memberIds");

        android.widget.PopupMenu menue = new android.widget.PopupMenu(this, anker);
        java.util.LinkedHashMap<String, Runnable> taten = new java.util.LinkedHashMap<>();

        // Zuerst das, was man am haeufigsten will: alle auf dieselbe Stelle
        // bringen. Dasselbe wie der Sync-Knopf am Rechner - das Relay laesst
        // alle anhalten, auf die Stelle des Hosts springen und gibt dann
        // gemeinsam das Startsignal. Wer bei der falschen Folge steht, wechselt
        // dabei zuerst dorthin.
        if (eintrag.optBoolean("joined", false)) {
            taten.put("Mit Host abgleichen", () -> {
                if (watchparty == null) return;
                watchparty.gleichziehen(schluessel, eintrag.optDouble("stelle", 0), raum,
                    (wert, fehler) -> {
                        if (fehler != null) showToast("Ging nicht: " + fehler);
                        else showToast("Alle werden abgeglichen …");
                    });
            });
        }

        for (int i = 0; namen != null && i < namen.length(); i += 1) {
            String wer = namen.optString(i, "Gerät");
            String id = kennungen == null ? "" : kennungen.optString(i, "");
            if (id.isEmpty() || id.equals(meineId)) continue;
            if (binHost) {
                taten.put("Host an " + wer + " weitergeben", () ->
                    watchparty.hostUebergeben(schluessel, id, raum, (wert, fehler) -> {
                        if (fehler != null) showToast("Ging nicht: " + fehler);
                        else showToast("Host an " + wer + " weitergegeben");
                    }));
            }
            if (meins) {
                taten.put(wer + " entfernen", () ->
                    watchparty.rauswerfen(schluessel, id, raum, (wert, fehler) -> {
                        if (fehler != null) showToast("Ging nicht: " + fehler);
                        else showToast(wer + " entfernt");
                    }));
            }
        }
        if (meins) {
            taten.put("Aus dem Raum nehmen", () ->
                watchparty.herausnehmen(schluessel, raum, (wert, fehler) -> {
                    if (fehler != null) showToast("Ging nicht: " + fehler);
                    else showToast("„" + titel + "“ aus der Watchparty genommen");
                }));
        }
        if (taten.isEmpty()) {
            showToast("Hier gibt es gerade nichts weiter zu tun");
            return;
        }
        for (String beschriftung : taten.keySet()) menue.getMenu().add(beschriftung);
        menue.setOnMenuItemClickListener(punkt -> {
            Runnable tat = taten.get(String.valueOf(punkt.getTitle()));
            if (tat != null) tat.run();
            return true;
        });
        menue.show();
    }

    /**
     * Einen Eintrag der Runde oeffnen.
     *
     * <p>Das Gegenstueck zu {@code openWatchpartyItem} am Rechner, und die
     * Antwort auf "warum liess sich eine Folge aus der Watchparty nicht
     * oeffnen": es gab dafuer schlicht keinen Weg.
     *
     * <p>Wohin es geht, entscheidet diese Klasse nicht. Die Bruecke antwortet
     * mit Anbieter und Adresse - und zwar mit der Adresse der <em>Folge</em>,
     * sobald die Runde eine kennt ({@code progress.url}), sonst mit der der
     * Serie. Dieselbe Vorrangregel wie am Rechner; ohne sie landet man auf der
     * Uebersicht, waehrend die anderen bei Staffel 3 Folge 8 sitzen.
     *
     * <p>Der Watchparty-Zusammenhang geht dabei nicht verloren:
     *
     * <ul>
     *   <li>Der lokale Eintrag wird an den Raum gebunden ({@code raumSetzen}),
     *       sobald es einen gibt - erst dadurch meldet er seinen Stand in die
     *       Runde.
     *   <li>{@link Mitschauen} findet den Raum ueber den Titelschluessel im
     *       Raumzustand und nicht ueber die Ablage, arbeitet also auch dann,
     *       wenn hier noch kein Eintrag liegt.
     *   <li>Die Herkunft wird gemerkt, damit Zurueck wieder hierher fuehrt.
     * </ul>
     *
     * <p>Der Schluessel und der Raum reisen zusammen. Ein Raum darf mehrere
     * Titel fuehren, und derselbe Titel darf in zwei Raeumen stehen - beides
     * ist gewollt, und beides geht schief, sobald nur einer der beiden Werte
     * weitergereicht wird.
     */
    private void watchpartyEintragOeffnen(String schluessel, String raum) {
        if (watchparty == null || schluessel.isEmpty()) return;
        watchparty.oeffnungsZiel(schluessel, raum, (wert, fehler) -> {
            if (fehler != null || wert == null || "null".equals(wert)) {
                showToast("Dieser Titel liess sich nicht öffnen");
                return;
            }
            JSONObject ziel;
            try {
                ziel = new JSONObject(wert);
            } catch (Exception ausnahme) {
                Log.e(TAG, "Öffnungsziel unlesbar", ausnahme);
                showToast("Dieser Titel liess sich nicht öffnen");
                return;
            }
            Provider anbieter = providerMitId(ziel.optString("providerId", ""));
            String url = ziel.optString("url", "");
            if (anbieter == null || url.isEmpty()) {
                showToast("Für diesen Titel ist kein Anbieter eingerichtet");
                return;
            }
            // Erst binden, dann oeffnen: der Stand, den die Seite gleich
            // meldet, soll schon in die Runde gehen und nicht erst der
            // uebernaechste. Gebunden wird ueber die Serienadresse - der
            // Titelschluessel des Relays ist kein Ort in der eigenen Ablage.
            watchpartyRaumBinden(ziel.optString("serie", ""), raum);
            // Aus der Watchparty geoeffnet heisst: Zurueck fuehrt hierher.
            providerHerkunft = "watchparty";
            Log.i(TAG, "Watchparty öffnet " + safeHost(url)
                + " (Raum " + raum + ", Staffel " + ziel.optInt("season", 0)
                + " Folge " + ziel.optInt("episode", 0) + ")");
            // Wie beim Oeffnen aus Weiterschauen: die Seite soll ihren Player
            // selbst starten, statt drei weitere Tastendruecke zu verlangen.
            armAutoStart(url);
            // Und weil das allein nicht reicht. Die Kette endet im Vollbild,
            // vor der Ueberlagerung des Hosters ("Spielen") - gemessen am
            // 25.08.2026 auf dem Telefon: Folge offen, Vollbild da, Bild steht.
            // Wer aus der Watchparty heraus oeffnet, will aber mitschauen und
            // nicht noch einmal tippen. Der Auftrag macht daraus einen echten
            // Start, mit dem Stand des Hosts als Ziel.
            if (mitschauen != null) mitschauen.autostartAnfordern(schluessel, raum, url);
            openProvider(anbieter, url, true);
        });
    }

    /**
     * Den lokalen Eintrag an die Runde binden.
     *
     * <p>Ohne Raum am Eintrag bleibt sein Stand privat - dann liefe der
     * Abgleich nur in eine Richtung. Gibt es noch keinen Eintrag, geschieht
     * hier nichts: er entsteht, sobald wirklich etwas laeuft, und
     * {@link #bestandGeaendert} bindet ihn dann nach.
     */
    /**
     * @param serienUrl die Adresse der Serie, wie der Raum sie fuehrt. Nicht der
     *                  Titelschluessel: der wird seit der Vereinheitlichung mit
     *                  dem Rechner aus Art und Titel gebildet ("serie:bleach")
     *                  und passt damit auf keine Adresse in der Ablage mehr.
     */
    private void watchpartyRaumBinden(String serienUrl, String raum) {
        if (bestand == null || serienUrl.isEmpty() || raum.isEmpty()) {
            offeneRaumbindung = null;
            return;
        }
        Favorite lokal = bestand.zuSerie(serienUrl);
        if (lokal != null) {
            if (!raum.equals(lokal.watchpartyRaum())) bestand.raumSetzen(lokal.id(), raum);
            offeneRaumbindung = null;
            return;
        }
        // Noch keiner da. Gemerkt, bis einer entsteht.
        offeneRaumbindung = new String[]{serienUrl, raum};
    }

    /**
     * Eine gemerkte Raumbindung nachholen.
     *
     * <p>Wird bei jeder Aenderung des Bestands versucht - das ist die Stelle,
     * an der ein frisch angelegter Eintrag zum ersten Mal auftaucht.
     */
    private void raumbindungNachholen() {
        if (offeneRaumbindung == null || bestand == null) return;
        Favorite lokal = bestand.zuSerie(offeneRaumbindung[0]);
        if (lokal == null) return;
        String raum = offeneRaumbindung[1];
        offeneRaumbindung = null;
        if (!raum.equals(lokal.watchpartyRaum())) bestand.raumSetzen(lokal.id(), raum);
    }

    /** Beitreten oder verlassen - genau dieser Titel in genau diesem Raum. */
    private void watchpartyBeitrittUmschalten(String schluessel, String raum, String titel,
                                              boolean dabei) {
        Kern.Antwort danach = (wert, fehler) -> {
            if (fehler != null) showToast("Ging nicht: " + fehler);
            else if (dabei) showToast("„" + titel + "“ verlassen");
            else showToast("„" + titel + "“ beigetreten — ab jetzt läuft der Stand zusammen");
        };
        if (dabei) watchparty.verlassen(schluessel, raum, danach);
        else watchparty.beitreten(schluessel, raum, danach);
    }

    /** Der Weg aus der unteren Leiste: die zuletzt benutzte Liste. */
    private void showFavorites() {
        zeigeBibliothek(offeneListe);
    }

    /**
     * Meine Liste - Weiterschauen, Watchlist, Mediathek und Verlauf.
     *
     * <p>Auf dem Telefon liegen die vier hinter Reitern statt hinter vier
     * Punkten in einer Seitenleiste: die untere Leiste hat nur Platz fuer eine
     * Handvoll Ziele, und vier davon fuer Listen zu vergeben liesse fuer alles
     * andere keinen Raum. Welche Liste zuletzt offen war, bleibt gemerkt.
     */
    private void zeigeBibliothek(Bibliothek liste) {
        // Ein Wechsel der Liste ist kein Zurueckkommen: der gemerkte Platz
        // gehoert zur vorigen Liste und stuende hier an einer Kachel, die es
        // nicht mehr gibt. Also faengt der Fokus auf dem Reiter an, den man
        // gerade gewaehlt hat - dort, wo die Hand zuletzt war.
        if (liste != offeneListe) {
            tvFokusJeSeite.put("favorites", "tv:reiter:" + liste.ordinal());
        }
        offeneListe = liste;
        currentScreen = "favorites";
        mouseMode = false;
        setMouseCursorVisible(false);
        setChromeCollapsed(false, false);
        content.removeAllViews();
        updateBottomNav();
        if (isTelevision()) {
            renderTvBibliothek(liste);
            return;
        }
        renderMobileBibliothek(liste);
    }

    private void renderMobileBibliothek(Bibliothek liste) {
        LinearLayout page = mobilePage();
        page.addView(MobileViews.eyebrow(this, "Meine Liste"));
        page.addView(MobileViews.heroTitle(this, liste.titel));
        page.addView(MobileViews.subtitle(this, liste.untertitel));
        addSpacing(page, listenReiter(liste), 16);

        List<Favorite> eintraege = liste.eintraege(bestand);
        if (eintraege.isEmpty()) {
            addSpacing(page, MobileViews.emptyState(this, R.drawable.ic_nav_favorite,
                liste.leerTitel, liste.leerText), 20);
            return;
        }
        for (Favorite eintrag : eintraege) {
            addSpacing(page, eintragsKarte(eintrag, liste), MobileViews.ITEM_GAP);
        }
        if (liste == Bibliothek.VERLAUF) {
            addSpacing(page, MobileViews.secondaryButton(this, "Verlauf leeren", () -> frage(
                "Verlauf leeren?",
                "Gemerkte und abgeschlossene Titel bleiben. Alles andere wird entfernt.",
                () -> {
                    bestand.verlaufLeeren();
                    showToast("Verlauf geleert");
                })), MobileViews.SECTION_GAP);
        }
    }

    /** Die Reiter ueber der Liste. Waagerecht scrollbar, damit sie auf schmalen Geraeten passen. */
    private View listenReiter(Bibliothek aktiv) {
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout leiste = new LinearLayout(this);
        leiste.setOrientation(LinearLayout.HORIZONTAL);
        scroll.addView(leiste, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        for (Bibliothek liste : Bibliothek.values()) {
            boolean gewaehlt = liste == aktiv;
            int anzahl = liste.eintraege(bestand).size();
            TextView reiter = new TextView(this);
            reiter.setText(anzahl > 0 ? liste.titel + "  " + anzahl : liste.titel);
            reiter.setTextColor(gewaehlt ? Color.WHITE : Theme.TEXT_SECONDARY);
            reiter.setTextSize(14);
            reiter.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            reiter.setGravity(Gravity.CENTER);
            // Volle Zeilenhoehe als Tippflaeche: ein Reiter, der nur so gross
            // ist wie seine Schrift, ist mit dem Daumen nicht zu treffen.
            reiter.setPadding(dp(16), dp(11), dp(16), dp(11));
            reiter.setMinHeight(dp(MobileViews.TOUCH_TARGET));
            reiter.setBackground(MobileViews.shape(this,
                gewaehlt ? Theme.PRIMARY_DEEP : Theme.SURFACE_ELEVATED, 22,
                gewaehlt ? Theme.PRIMARY : Theme.BORDER, 1));
            reiter.setOnClickListener(view -> zeigeBibliothek(liste));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            params.rightMargin = dp(8);
            leiste.addView(reiter, params);
        }
        return scroll;
    }

    private void showSettings() {
        currentScreen = "settings";
        mouseMode = false;
        setMouseCursorVisible(false);
        setChromeCollapsed(false, false);
        content.removeAllViews();
        updateBottomNav();
        if (isTelevision()) renderTvSettings();
        else renderMobileSettings();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView webViewFor(Provider provider) {
        if (webViews.containsKey(provider.id)) {
            return webViews.get(provider.id);
        }
        WebView webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(true);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(true);
        if (android.os.Build.VERSION.SDK_INT >= 21) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        }
        CookieManager.getInstance().setAcceptCookie(true);
        settings.setUserAgentString(settings.getUserAgentString() + " ElflixAndroid/0.1");
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        // Vor dem ersten Laden: das Startskript gilt erst ab dem naechsten
        // Dokument, spaeter angeschlossen bliebe die erste Seite ohne Rahmen.
        if (rahmen != null) rahmen.anschliessen(webView);
        // Dasselbe Zeitfenster, anderer Grund: das Stilblatt gegen die Werbung
        // muss vor den Skripten der Seite dastehen, sonst blitzt sie auf.
        // Nur auf dem Fernseher - siehe das Feld.
        if (isTelevision() && fernsehwerbung != null) {
            fernsehwerbung.anschliessen(webView, provider);
        }
        webView.setWebViewClient(new GuardedWebViewClient(provider));
        webView.setWebChromeClient(new GuardedChromeClient());
        // Ad frames on these sites try to push APKs and other files. ELFIX never downloads anything,
        // so the hook exists purely to swallow the attempt instead of handing it to the system
        // DownloadManager (which is what the absence of a listener effectively allowed).
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
            Log.i(TAG, "Download blocked host=" + safeHost(url) + " mime=" + mimeType));
        webViews.put(provider.id, webView);
        return webView;
    }

    private void openProvider(Provider provider, String url) {
        // Der Weg ohne Vorgeschichte: ein Anbieter, von Hand geoeffnet. Wer aus
        // der Watchparty kommt, geht ueber die dreistellige Fassung und setzt
        // die Herkunft selbst.
        providerHerkunft = "";
        openProvider(provider, url, false);
    }

    private void openProvider(Provider provider, String url, boolean preserveFavoriteProgress) {
        currentScreen = "provider";
        // A deliberate navigation ends any hoster chain that was still allowed to hop.
        wache.zuruecksetzen();
        // Switching provider while a video is fullscreen would otherwise strand the overlay: the
        // content frame gets cleared below while fullscreenView still pointed at the removed view.
        hideFullscreen();
        if (!preserveFavoriteProgress) {
            activeFavoriteId = null;
        }
        if (activeProvider != null && activeProvider != provider) {
            rememberAndPauseMedia(activeProvider.id, webViews.get(activeProvider.id));
        }
        activeProvider = provider;
        renderProviderRail();
        WebView webView = webViewFor(provider);
        webView.onResume();
        content.removeAllViews();
        content.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (shouldBlockProviderNavigation(provider, url)) {
            url = provider.startUrl;
        }
        Log.i(TAG, "Provider opened id=" + provider.id + " host=" + safeHost(url)
            + " reusedWebView=" + (webView.getUrl() != null));
        // The website gets the whole panel on TV. The bar is one MENU press away when it is wanted.
        if (isTelevision()) setChromeCollapsed(true, false);
        boolean sameUrl = webView.getUrl() != null && webView.getUrl().equals(url);
        if (!sameUrl) {
            showProviderLoading(provider);
            webView.loadUrl(url);
        } else {
            resumeMediaIfNeeded(provider.id, webView);
        }
        setChromeCollapsed(true, false);
        if (mouseMode) setMouseCursorVisible(true);
        webView.requestFocus();
        updateBrowserBar();
        updateBottomNav();
        updateFavoriteButton();
        // Der Live-Streifen gehoert zur Anbieterseite: hier faengt er an zu
        // ticken, und auf jeder anderen Seite hoert er wieder auf.
        liveStreifenAuffrischen();
        // Dasselbe fuer die Wiedergabeleiste. Das Ziel der vorigen Folge gilt
        // hier nicht mehr - es wird neu bestimmt, sobald die Seite steht.
        if (spielerleiste != null) {
            spielerleiste.setzeZiel("");
            spielerleiste.autoplayAuffrischen();
        }
        // Hier noch nicht fragen: die neue Seite laedt gerade erst, und die
        // Ansicht traegt bis zum Seitenanfang die vorige Adresse. Gefragt wird
        // beim Seitenende - siehe zielNachfassen.
        zielSucheFuer = "";
    }

    private void showProviderLoading(Provider provider) {
        hideProviderLoading();
        if (content == null) return;
        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(Color.rgb(7, 10, 16));
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        android.widget.ProgressBar spinner = new android.widget.ProgressBar(this);
        spinner.getIndeterminateDrawable().setColorFilter(ACCENT, android.graphics.PorterDuff.Mode.SRC_IN);
        box.addView(spinner, new LinearLayout.LayoutParams(dp(44), dp(44)));
        TextView label = copyText(provider.name + " wird geladen …");
        label.setGravity(Gravity.CENTER);
        label.setPadding(0, dp(14), 0, 0);
        box.addView(label);
        overlay.addView(box, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        content.addView(overlay, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        loadingOverlay = overlay;
    }

    private void hideProviderLoading() {
        if (loadingOverlay != null && content != null) {
            content.removeView(loadingOverlay);
        }
        loadingOverlay = null;
    }

    private void showProviderError(Provider provider, String message) {
        if (provider == null || provider != activeProvider || content == null) return;
        hideProviderLoading();
        // Liegt ein Startvorhang davor, gehoert die Ansage dorthin: die
        // Fehlerseite dahinter saehe sonst niemand, und der Ladebalken liefe
        // gegen eine Seite weiter, die es gar nicht gibt.
        if (startFehler("seite")) return;
        content.removeAllViews();
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setGravity(Gravity.CENTER);
        page.setPadding(dp(pagePaddingHorizontalDp()), dp(pagePaddingVerticalDp()), dp(pagePaddingHorizontalDp()), dp(pagePaddingVerticalDp()));
        page.setBackgroundColor(Color.rgb(7, 10, 16));

        TextView icon = new TextView(this);
        icon.setText("⚠");
        icon.setTextSize(48);
        icon.setTextColor(ACCENT);
        icon.setGravity(Gravity.CENTER);
        page.addView(icon);

        TextView title = titleText(provider.name + " nicht erreichbar");
        title.setTextSize(26);
        title.setGravity(Gravity.CENTER);
        page.addView(title);

        TextView copy = copyText(message);
        copy.setGravity(Gravity.CENTER);
        page.addView(copy);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER);
        Button retry = textButton("Erneut versuchen");
        retry.setOnClickListener(view -> openProvider(provider, provider.startUrl));
        actions.addView(retry);
        Button home = textButton("Zur Startseite");
        home.setOnClickListener(view -> showHome());
        actions.addView(home);
        page.addView(actions, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(62)));

        content.addView(page, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        retry.requestFocus();
    }

    /**
     * Einen Eintrag aus Weiterschauen oeffnen - und ihn wirklich starten.
     *
     * <p>Mehrfaches schnelles Tippen faengt hier auf: derselbe Eintrag,
     * waehrend sein Start noch laeuft, ist keine zweite Absicht. Ohne diese
     * Sperre laedt die Seite ein zweites Mal, der erste Versuch verliert seinen
     * Player mitten im Anlauf, und in einer Runde gingen zwei Folgenwechsel
     * hinaus statt einem.
     */
    private void openFavorite(Favorite favorite) {
        Provider provider = null;
        for (Provider item : providers) {
            if (item.id.equals(favorite.providerId())) {
                provider = item;
                break;
            }
        }
        if (provider == null && !providers.isEmpty()) provider = providers.get(0);
        if (provider == null) return;

        long jetzt = SystemClock.uptimeMillis();
        if (favorite.id().equals(letzterStartEintrag) && jetzt - letzterStartAt < START_SPERRE_MS) {
            Log.i(TAG, "Weiterschauen: zweiter Tipp auf denselben Eintrag ignoriert");
            return;
        }
        letzterStartEintrag = favorite.id();
        letzterStartAt = jetzt;

        providerHerkunft = "";
        activeFavoriteId = favorite.id();
        // Ein neuer Titel bedeutet: der Anlauf von vorhin ist gegenstandslos.
        if (mitschauen != null) mitschauen.oertlichenStartAbbrechen("anderer Titel gewaehlt");
        // Picking a favourite means "watch this": die Seite oeffnet ihren
        // Player, springt auf den gespeicherten Stand, startet - und erst
        // danach kommt das Vollbild.
        startBegleiten(provider, favorite.url(),
            startTitelFuer(favorite.title(), favorite.url()), favorite.currentTime());
        armAutoStart(favorite.url(), favorite.currentTime());
        openProvider(provider, favorite.url(), true);
    }

    /**
     * Einen Start hinter dem Vorhang fuehren.
     *
     * <p>Der eine Einstieg fuer beide Wege - "Weiterschauen" und "Naechste
     * Folge". Er merkt sich, woraus der Start besteht (das braucht "Erneut
     * versuchen"), und zieht den Vorhang zu. Kommt keiner zustande, weil die
     * Phasentabelle fehlt, laeuft alles wie vorher weiter: der Vorhang ist eine
     * Verkleidung des Ablaufs und keine Bedingung fuer ihn.
     */
    private void startBegleiten(Provider provider, String url, String titel, double stelle) {
        startAnbieter = provider;
        startUrl = url == null ? "" : url;
        startTitel = titel == null ? "" : titel;
        startStelle = Math.max(0, stelle);
        if (startvorhang == null) return;
        startvorhang.starten(startTitel, startStelle);
    }

    /**
     * Was im Ladebildschirm gross dasteht.
     *
     * <p>Titel und Folge, so wie sie der Rechner in seinen Vorhang schreibt
     * ({@code naechsteFolgeLabel}): "Attack on Titan · Staffel 2 Folge 5".
     * Ohne erkennbare Folge bleibt es beim Titel, ohne Titel bei der Folge -
     * und wenn nichts davon da ist, sagt der Vorhang nur "Wiedergabe".
     */
    private String startTitelFuer(String titel, String url) {
        String name = titel == null ? "" : titel.trim();
        String folge = Folgen.folgenText(url);
        if (name.isEmpty()) return folge;
        if (folge.isEmpty()) return name;
        return name + " · " + folge;
    }

    /**
     * Einen Schritt an den Vorhang melden.
     *
     * <p>Still, wenn keiner liegt: die Kette meldet ihre Schritte immer, auch
     * wenn niemand sie begleitet - ein Start ueber die Fernbedienung etwa
     * laeuft ohne Vorhang.
     */
    private void startPhaseMelden(String name) {
        if (startvorhang == null || !startvorhang.laeuft()) return;
        startvorhang.melden(name);
    }

    /**
     * Der Start ist an dieser Stelle gescheitert.
     *
     * @return ob der Vorhang die Ansage uebernommen hat. Wenn nicht, gehoert
     *         sie dem Aufrufer - sonst scheiterte ein Start voellig lautlos.
     */
    private boolean startFehler(String grund) {
        if (startvorhang == null || !startvorhang.laeuft()) return false;
        startvorhang.fehler(grund);
        return true;
    }

    /**
     * "Erneut versuchen" - denselben Start noch einmal von vorn.
     *
     * <p>Wirklich von vorn: die Seite wird neu geladen, der Autostart neu
     * scharf gemacht, der Vorhang faengt bei der ersten Phase an. Ein
     * Weitermachen an der Stelle, an der es haengengeblieben ist, gibt es
     * nicht - haengengeblieben ist ja gerade der Zustand, aus dem heraus
     * nichts mehr kam.
     */
    private void startErneutVersuchen() {
        Provider provider = startAnbieter;
        String url = startUrl;
        double stelle = startStelle;
        String titel = startTitel;
        if (provider == null || url.isEmpty()) {
            startAufgeben("nichts zu wiederholen");
            return;
        }
        Log.i(TAG, "Start wird wiederholt: " + safePath(url));
        if (mitschauen != null) mitschauen.oertlichenStartAbbrechen("Start wird wiederholt");
        disarmAutoStart("Start wird wiederholt");
        startBegleiten(provider, url, titel, stelle);
        armAutoStart(url, stelle);
        openProvider(provider, url, true);
    }

    /**
     * "Zurueck" - der Start wird aufgegeben.
     *
     * <p>Alles, was fuer ihn scharf steht, wird entschaerft: der Auftrag im
     * Kern, die Anfrage in dieser Klasse, der Vollbildwunsch. Sonst startet
     * eine halbe Minute spaeter eine Folge, die niemand mehr sehen will -
     * dieselbe Regel wie beim Verlassen des Players.
     */
    private void startAufgeben(String grund) {
        Log.i(TAG, "Start aufgegeben: " + grund);
        if (mitschauen != null) {
            mitschauen.oertlichenStartAbbrechen(grund);
            mitschauen.vollbildwunschVerwerfen();
        }
        disarmAutoStart(grund);
        startAnbieter = null;
        startUrl = "";
        startTitel = "";
        startStelle = 0;
        if (startvorhang != null) startvorhang.auf(grund);
        onBackPressed();
    }

    /**
     * Der Herz-Knopf: die laufende Seite auf die Watchlist oder herunter.
     *
     * <p>Angelegt wird der Eintrag ueber die geteilte Regel, nicht von Hand.
     * Sie kennt die Adresse, erkennt Staffel und Folge, bestimmt die Art und
     * legt den Eintrag genau so an, wie ihn der Rechner anlegen wuerde - ein
     * hier zusammengesetztes Objekt haette spaetestens beim Abgleich gefehlt,
     * weil ihm die halben Felder fehlten.
     */
    private void toggleFavorite() {
        WebView webView = activeProvider == null ? null : webViews.get(activeProvider.id);
        if (webView == null || webView.getUrl() == null || bestand == null) return;
        String url = webView.getUrl();

        Favorite vorhanden = bestand.mitId(bestand.aktiverEintragId());
        if (vorhanden != null && vorhanden.istWatchlist()) {
            bestand.watchlistSetzen(vorhanden.id(), false);
            showToast("Von der Watchlist genommen");
            updateFavoriteButton();
            return;
        }
        if (vorhanden != null) {
            bestand.watchlistSetzen(vorhanden.id(), true);
            showToast("Zur Watchlist hinzugefügt");
            updateFavoriteButton();
            return;
        }

        // Noch kein Eintrag: die Regel legt ihn an. "Geoeffnet" reicht als
        // Anlass - Fortschritt kommt, sobald wirklich etwas laeuft.
        String titel = webView.getTitle() == null || webView.getTitle().isEmpty()
            ? activeProvider.name : webView.getTitle();
        JSONObject meta = new JSONObject();
        try {
            meta.put("title", titel);
            meta.put("vonHand", true);
        } catch (Exception ignoriert) {
            // Zwei Felder in einem frischen Objekt koennen nicht scheitern.
        }
        // Das Titelbild dieser Seite, falls es schon gefunden wurde: die
        // geteilte Regel setzt es beim Anlegen und danach nicht mehr.
        if (titelbild != null) meta = titelbild.ergaenzen(meta, url);
        bestand.anlegenUndMerken(activeProvider, url, meta, () -> {
            updateFavoriteButton();
            showToast("Zur Watchlist hinzugefügt");
        });
    }

    private void updateFavoriteButton() {
        WebView webView = activeProvider == null ? null : webViews.get(activeProvider.id);
        Favorite offen = bestand == null ? null : bestand.mitId(bestand.aktiverEintragId());
        boolean saved = webView != null && webView.getUrl() != null
            && offen != null && offen.istWatchlist();
        if (browserFavoriteIcon != null) {
            browserFavoriteIcon.setImageResource(saved
                ? R.drawable.ic_nav_favorite_filled : R.drawable.ic_nav_favorite);
            browserFavoriteIcon.setColorFilter(saved ? Theme.PRIMARY : Theme.TEXT_PRIMARY);
        }
        if (favoriteButton != null) favoriteButton.setText(saved ? "♥" : "♡");
    }

    private String mediaSlugFromUrl(String value) {
        try {
            URI uri = new URI(value);
            String path = uri.getPath();
            if (path == null || path.isEmpty()) return "";
            String[] rawParts = path.split("/");
            ArrayList<String> parts = new ArrayList<>();
            for (String part : rawParts) {
                if (!part.isEmpty()) parts.add(part);
            }
            for (int i = 0; i < parts.size(); i += 1) {
                String part = parts.get(i).toLowerCase();
                if (part.equals("anime") && i + 2 < parts.size() && parts.get(i + 1).equalsIgnoreCase("stream")) {
                    return parts.get(i + 2).toLowerCase();
                }
                if ((part.equals("serie") || part.equals("series")) && i + 2 < parts.size() && parts.get(i + 1).equalsIgnoreCase("stream")) {
                    return parts.get(i + 2).toLowerCase();
                }
                if (part.matches("^(stream|serie|series|film|filme|movie|movies|title|watch)$") && i + 1 < parts.size()) {
                    return parts.get(i + 1).toLowerCase();
                }
            }
        } catch (Exception ignored) {
        }
        return "";
    }

    private boolean shouldBlockProviderNavigation(Provider provider, String url) {
        if (provider == null || url == null || url.trim().isEmpty()) return false;
        try {
            URI target = new URI(url);
            String scheme = target.getScheme();
            if (!"http".equals(scheme) && !"https".equals(scheme)) return false;
            String targetHost = target.getHost();
            return targetHost != null && isOtherConfiguredProviderHost(provider, targetHost);
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean isOtherConfiguredProviderHost(Provider active, String targetHost) {
        for (Provider provider : providers) {
            if (active != null && provider.id.equals(active.id)) continue;
            try {
                String providerHost = new URI(provider.startUrl).getHost();
                if (providerHost != null && isAllowedResultHost(provider, targetHost, providerHost)) return true;
            } catch (Exception ignored) {
            }
        }
        return false;
    }

    private boolean isAllowedPopupTarget(Provider provider, String url) {
        if (provider == null || url == null || url.trim().isEmpty()) return false;
        if (shouldBlockProviderNavigation(provider, url)) return false;
        if (Adblocker.isChallengeOrVerificationUrl(url, provider)) return true;
        try {
            URI target = new URI(url);
            URI base = new URI(provider.startUrl);
            if (target.getHost() != null && base.getHost() != null && isProviderFirstPartyHost(provider, target.getHost(), base.getHost())) {
                return true;
            }
        } catch (Exception ignored) {
        }
        return Adblocker.isLikelyPlayerNavigation(url) && !adblocker.shouldBlock(url, provider);
    }

    /**
     * A main-frame navigation with no user gesture, going to a host that is neither the page
     * currently loaded, first-party for the provider, nor a known video-hoster/player URL, is
     * almost always a forced ad redirect (popunder-style "you've won"/YouTube/etc. pages) rather
     * than something the user asked for.
     */
    private boolean isSuspiciousAutoRedirect(WebView view, Provider provider, String url) {
        try {
            URI target = new URI(url);
            String targetHost = target.getHost();
            if (targetHost == null) return false;
            String currentPageUrl = view.getUrl();
            String currentHost = currentPageUrl == null ? null : new URI(currentPageUrl).getHost();
            if (currentHost != null) {
                String t = targetHost.toLowerCase();
                String c = currentHost.toLowerCase();
                if (t.equals(c) || t.endsWith("." + c) || c.endsWith("." + t)) return false;
            }
            String baseHost = provider == null ? null : new URI(provider.startUrl).getHost();
            if (baseHost != null && isProviderFirstPartyHost(provider, targetHost, baseHost)) return false;
            if (Adblocker.isLikelyPlayerNavigation(url)) return false;
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean isPopupFirstParty(Provider provider, String url) {
        try {
            URI target = new URI(url);
            URI base = new URI(provider.startUrl);
            return target.getHost() != null && base.getHost() != null
                && isProviderFirstPartyHost(provider, target.getHost(), base.getHost());
        } catch (Exception malformed) {
            return false;
        }
    }

    /** Path only, for diagnosing which heuristic matched -- no query string, which can carry ids. */
    private static String safePath(String url) {
        try {
            String path = android.net.Uri.parse(url).getPath();
            return path == null || path.isEmpty() ? "/" : path;
        } catch (Exception malformed) {
            return "-";
        }
    }

    private boolean isProviderFirstPartyHost(Provider provider, String targetHost, String baseHost) {
        String target = stripWww(targetHost);
        String base = stripWww(baseHost);
        String name = provider == null || provider.name == null ? "" : provider.name.toLowerCase();
        if (!base.isEmpty() && (target.equals(base) || target.endsWith("." + base))) return true;
        if (name.contains("aniworld")) return target.contains("aniworld");
        if (isStoProvider(provider)) return target.equals("s.to") || target.endsWith(".s.to") || target.equals(base);
        if (name.contains("filmo")) return target.contains("filmo");
        return false;
    }

    private void showToast(String message) {
        android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_SHORT).show();
    }

    private void pauseMedia(WebView webView) {
        if (webView == null) return;
        webView.evaluateJavascript("document.querySelectorAll('video,audio').forEach(m=>{try{m.pause()}catch(e){}});", null);
    }

    private void rememberAndPauseMedia(String providerId, WebView webView) {
        if (providerId == null || webView == null) return;
        webView.evaluateJavascript(
            "(function(){var playing=false;document.querySelectorAll('video,audio').forEach(function(m){try{if(!m.paused&&!m.ended&&m.readyState>1)playing=true;m.pause();}catch(e){}});return playing;})()",
            value -> providerResumeState.put(providerId, "true".equals(String.valueOf(value)))
        );
        webView.onPause();
    }

    private void resumeMediaIfNeeded(String providerId, WebView webView) {
        if (providerId == null || webView == null) return;
        Boolean shouldResume = providerResumeState.remove(providerId);
        webView.onResume();
        if (!Boolean.TRUE.equals(shouldResume)) return;
        webView.evaluateJavascript(
            "(function(){var list=Array.prototype.slice.call(document.querySelectorAll('video,audio'));var m=list.find(function(x){try{return x.paused&&!x.ended&&x.readyState>1;}catch(e){return false;}});if(m){try{m.muted=false;var p=m.play();if(p&&p.catch)p.catch(function(){});}catch(e){}}})()",
            null
        );
    }

    private void reloadAllWebViews() {
        Provider provider = activeProvider;
        WebView current = provider == null ? null : webViews.get(provider.id);
        String currentUrl = current == null ? "" : current.getUrl();
        String target = provider == null ? "" : shouldBlockProviderNavigation(provider, currentUrl)
            ? provider.lastUrl.isEmpty() ? provider.startUrl : provider.lastUrl
            : currentUrl;

        content.removeAllViews();
        for (Map.Entry<String, WebView> entry : webViews.entrySet()) {
            WebView webView = entry.getValue();
            if (webView == null) continue;
            // Detach before destroy: a destroyed WebView must never stay attached to a parent,
            // and must never be touched again afterwards.
            if (webView.getParent() instanceof ViewGroup) {
                ((ViewGroup) webView.getParent()).removeView(webView);
            }
            webView.stopLoading();
            webView.destroy();
            Log.i(TAG, "WebView destroyed provider=" + entry.getKey());
        }
        webViews.clear();
        providerResumeState.clear();
        clearBrowserCachesPreservingLogin();

        if (provider != null) {
            openProvider(provider, target == null || target.isEmpty() ? provider.startUrl : target, activeFavoriteId != null);
        } else {
            showHome();
        }
        showToast("Alles neu geladen");
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Der Titelhintergrund wechselt nicht weiter, solange niemand hinsieht.
        // Beim Zurueckkommen zeichnet die Startseite ohnehin neu und setzt den
        // Takt wieder auf. Dasselbe gilt fuer die Kacheln einer Runde: was
        // dort laeuft, laeuft weiter, aber niemand muss es mitzaehlen.
        takt.removeCallbacksAndMessages(null);
        liveTakt.removeCallbacksAndMessages(null);
        // Was gemessen wurde, gehoert jetzt auf die Platte. Auf einem Telefon
        // ist das kein Feinschliff: eine App im Hintergrund wird ohne Vorwarnung
        // abgeraeumt, und ein onDestroy kommt dann nicht mehr. Nur schliessen -
        // nicht die offene Sitzung beenden: wer kurz auf eine Nachricht schaut
        // und zurueckkommt, hat nicht zweimal geschaut.
        if (statistik != null) statistik.speichern();
        // Aus der Runde abmelden, aber nichts an sie senden: Android haelt
        // gleich den WebView an, und die Pause, die der Player daraufhin
        // meldet, ist keine Entscheidung des Zuschauers.
        if (mitschauen != null) mitschauen.vordergrund(false);
        WebView webView = activeProvider == null ? null : webViews.get(activeProvider.id);
        if (webView != null) webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Zurueck in der App: waehrend sie weg war, kann am Rechner etwas
        // gelaufen sein. Einmal nachsehen, nicht dauernd fragen.
        if (geraete != null) geraete.abgleichenSpaeter(500);
        // Und der Runde sagen, dass hier wieder jemand sitzt. Ab jetzt zaehlen
        // Pause und Weiter wieder als Entscheidung.
        if (mitschauen != null) mitschauen.vordergrund(true);
        WebView webView = activeProvider == null ? null : webViews.get(activeProvider.id);
        if (webView != null) webView.onResume();
        // Der Takt des Titelhintergrunds haengt an onPause. Steht die
        // Startseite, laeuft er wieder los - und mit ihm der der Kacheln.
        if ("home".equals(currentScreen)) {
            heroWechselPlanen();
            liveKachelnAuffrischen();
            liveTaktPlanen();
        }
        if (fullscreenView != null) {
            applyFullscreenSystemUi();
        }
    }

    @Override
    protected void onDestroy() {
        cacheCleanupHandler.removeCallbacks(cacheCleanupTask);
        takt.removeCallbacksAndMessages(null);
        liveTakt.removeCallbacksAndMessages(null);
        if (messung != null) messung.anhalten();
        // Die letzte Folge eines Abends zaehlt sonst nicht: sie steht als
        // offene Sitzung im Speicher und stirbt mit dem Prozess.
        if (statistik != null) {
            statistik.schliessen(null);
            statistik.speichern();
        }
        Pruefstand.abbauen(this, pruefumgebung);
        if (kern != null) kern.beenden();
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        deepLinkOeffnen(intent);
    }

    /**
     * Oeffnet eine von aussen hereingereichte Adresse.
     *
     * <p>Zwei Formen: {@code elfix://open?url=...} und die Adresse eines
     * eingebauten Anbieters direkt. Beide landen beim selben Anbieter-WebView
     * wie ein Tippen in der App - nicht in einem fremden Browser, denn sonst
     * waeren Anmeldung, Werbeblocker und Fortschritt weg.
     *
     * <p>Kennt ELFIX den Anbieter nicht, passiert bewusst nichts ausser einem
     * Hinweis: eine beliebige Adresse in einem Anbieter-Fenster zu oeffnen
     * waere kein Dienst, sondern eine Ueberraschung.
     */
    private void deepLinkOeffnen(android.content.Intent intent) {
        if (intent == null) return;
        android.net.Uri daten = intent.getData();
        if (daten == null) return;
        String ziel;
        if ("elfix".equals(daten.getScheme())) {
            ziel = daten.getQueryParameter("url");
        } else {
            ziel = daten.toString();
        }
        if (ziel == null || !ziel.startsWith("http")) return;

        String host;
        try {
            host = stripWww(new URI(ziel).getHost());
        } catch (Exception fehler) {
            return;
        }
        if (host == null || host.isEmpty()) return;

        for (Provider provider : providers) {
            String anbieterHost;
            try {
                anbieterHost = stripWww(new URI(provider.startUrl).getHost());
            } catch (Exception fehler) {
                continue;
            }
            if (anbieterHost == null) continue;
            if (host.equals(anbieterHost) || host.endsWith("." + anbieterHost) || anbieterHost.endsWith("." + host)) {
                openProvider(provider, ziel);
                return;
            }
        }
        showToast("Diese Adresse gehört zu keinem eingerichteten Anbieter");
    }

    /**
     * Ob der Eintrag beim Blaettern stehenbleiben soll.
     *
     * <p>Dieselbe Einstellung wie am Desktop ({@code playback.favoriteProgressMode}).
     * Sie betrifft nur das Mitruecken beim Blaettern - der gemessene Fortschritt
     * laeuft davon unabhaengig weiter.
     */
    private boolean folgeStatisch() {
        return "static".equals(favoriteProgressMode);
    }

    /**
     * Der Bestand hat sich geaendert - die sichtbare Liste neu zeichnen.
     *
     * <p>Und dabei stehenbleiben, wo man war. Ein Neuzeichnen baut die Seite
     * von Grund auf neu auf, mitsamt einer neuen ScrollView; ohne Zutun faengt
     * sie oben an. Solange das nur nach einem eigenen Handgriff geschah, fiel
     * es kaum auf - der kam ja von einer sichtbaren Stelle. Seit der
     * Geraeteabgleich hier hereinreicht, kommt es auch von aussen: ein Schub
     * vom anderen Geraet, und die Liste springt unter dem Finger nach oben.
     *
     * <p>Gemerkt wird nur fuer diesen einen Fall. Wer eine Liste *oeffnet*,
     * soll weiter oben anfangen - deshalb steht das hier und nicht in
     * {@code mobilePage()}.
     */
    /**
     * Woran zu erkennen ist, ob die Seite <em>anders aussaehe</em>.
     *
     * <p>Bewusst ohne Stelle und ohne Prozent. Genau das ist der Punkt: waehrend
     * einer Folge meldet die Messung alle fuenf Sekunden einen neuen Stand, und
     * beide Zahlen sind dann jedes Mal andere. Was sich dabei <em>nicht</em>
     * aendert, ist die Seite selbst - dieselben Eintraege in derselben
     * Reihenfolge mit denselben Beschriftungen.
     *
     * <p>Drin steht deshalb alles, was auf einer Kachel zu <em>sehen</em> ist
     * und sich nicht im Sekundentakt bewegt: welche Eintraege es gibt und in
     * welcher Ordnung, ihr Titel, Staffel und Folge (die ruecken beim
     * Weiterblaettern), das Titelbild (es wird oft erst nachgereicht - ohne
     * diesen Teil bliebe die Kachel bis zum naechsten Anlass ohne Bild), ob
     * einer auf die naechste Folge wartet (das aendert seinen Text) und zu
     * welcher Runde er gehoert (das entscheidet, in welcher der beiden Reihen
     * er steht).
     */
    private String seitenbild() {
        StringBuilder bild = new StringBuilder();
        for (Favorite eintrag : bestand.weiterschauen()) {
            bild.append(eintrag.id())
                .append('#').append(eintrag.season()).append('/').append(eintrag.episode())
                .append('#').append(eintrag.title())
                .append('#').append(eintrag.bild())
                .append(eintrag.wartetAufNaechsteFolge() ? '!' : '.')
                .append(eintrag.watchpartyRaum())
                .append('|');
        }
        return bild.toString();
    }

    private void bestandGeaendert() {
        // Ein Eintrag, der aus der Watchparty geoeffnet wurde, entsteht erst,
        // wenn wirklich etwas laeuft. Hier taucht er zum ersten Mal auf - und
        // bekommt seinen Raum.
        raumbindungNachholen();
        boolean zeichnetNeu = "favorites".equals(currentScreen) || "home".equals(currentScreen);

        // Neu zeichnen nur, wenn die Seite danach anders aussaehe.
        //
        // Bis hierher wurde bei *jeder* Meldung die ganze Seite neu gebaut. Das
        // fiel nicht auf, solange Android ueberhaupt keinen Fortschritt buchte;
        // seit es das wieder tut, kommt alle fuenf Sekunden eine Meldung, und
        // wer dabei auf der Startseite steht, sieht sie jedes Mal zusammen- und
        // wieder aufklappen. Gemeldet als "die App zuckt alle 5 Sekunden".
        //
        // Was die Meldung wirklich bringt, ist eine andere Stelle im laufenden
        // Titel - kein anderer Titel, keine andere Reihenfolge, keine andere
        // Reihe. Dafuer muss keine Seite entstehen. Der Balken und die Zeit auf
        // der Kachel stehen dann bis zum naechsten echten Anlass still; das ist
        // der Preis, und er ist kleiner als eine Seite, die im Fuenfsekundentakt
        // springt.
        String bild = seitenbild();
        boolean gleichesBild = bild.equals(letztesSeitenbild);
        letztesSeitenbild = bild;
        zeichnetNeu = zeichnetNeu && !gleichesBild;

        if (zeichnetNeu) spur(currentScreen, "", "seite", "neu gezeichnet", "bestand anders");

        int stand = zeichnetNeu && seitenScroll != null ? seitenScroll.getScrollY() : 0;
        if (zeichnetNeu && "favorites".equals(currentScreen)) showFavorites();
        else if (zeichnetNeu && "home".equals(currentScreen)) showHome();
        // Nur wenn wirklich neu gezeichnet wurde. Waehrend einer Folge meldet
        // die Messung alle paar Sekunden einen Stand; dann steht hier keine
        // Liste, und `seitenScroll` zeigt auf eine laengst abgehaengte Seite.
        if (zeichnetNeu) scrollStandHerstellen(stand);
        updateFavoriteButton();
        // Der eine Punkt, an dem sich am Bestand wirklich etwas geaendert hat.
        // Ihn zu nehmen statt der zwei Dutzend Stellen, die Staende anfassen,
        // ist der Grund, warum der Abgleich nichts verpassen kann - auch nicht
        // das Abhaken von Hand oder das Umsortieren der Mediathek.
        if (geraete != null) geraete.abgleichenSpaeter();
    }

    /**
     * Eine Empfehlungsreihe ist fertig geworden.
     *
     * <p>Nur die Startseite geht das etwas an - und auch die nur, wenn sie
     * gerade zu sehen ist. Der Titelhintergrund behaelt dabei seine Stelle,
     * und die Seite ihre Scrollposition: eine Reihe, die nach zehn Sekunden
     * fertig wird, darf niemanden nach oben werfen.
     */
    private void empfehlungenGeaendert() {
        if (!"home".equals(currentScreen)) return;
        int stand = seitenScroll == null ? 0 : seitenScroll.getScrollY();
        showHome();
        scrollStandHerstellen(stand);
    }

    /**
     * Die Kalenderwoche ist da.
     *
     * <p>Dieselbe Vorsicht wie bei den Empfehlungen: die Startseite behaelt
     * ihre Stelle. Steht die Kalenderansicht selbst offen, wird die neu
     * gebaut - dort ist die Woche der ganze Inhalt.
     */
    private void kalenderGeaendert() {
        if ("kalender".equals(currentScreen)) {
            int stand = seitenScroll == null ? 0 : seitenScroll.getScrollY();
            zeigeKalender();
            scrollStandHerstellen(stand);
            return;
        }
        if (!"home".equals(currentScreen)) return;
        int stand = seitenScroll == null ? 0 : seitenScroll.getScrollY();
        showHome();
        scrollStandHerstellen(stand);
    }

    /**
     * Die Seite wieder dorthin schieben, wo sie stand.
     *
     * <p>Ueber {@code scrollTo} und nicht {@code setScrollY}: die ScrollView
     * kappt dabei auf das, was wirklich da ist. Wurde die Liste durch den
     * Abgleich kuerzer, landet man am neuen Ende statt im Leeren.
     *
     * <p>Der Umweg ueber {@code post} ist noetig, weil die frisch gebaute
     * Seite noch nicht vermessen ist - vorher waere jede Position ausserhalb
     * und wuerde auf null gekappt.
     */
    private void scrollStandHerstellen(int stand) {
        // Auf dem Fernseher nicht: dort stellt der Fokus die Stelle wieder her
        // (siehe tvFokusHerstellen), und eine ScrollView schiebt von sich aus
        // zu ihrem fokussierten Kind. Beides zugleich waeren zwei Befehle an
        // dieselbe Stelle - und sichtbar waere davon ein Sprung.
        if (isTelevision()) return;
        if (stand <= 0 || seitenScroll == null) return;
        ScrollView scroll = seitenScroll;
        scroll.post(() -> scroll.scrollTo(0, stand));
    }

    /** Was der Kern von sich aus meldet - bisher ausschliesslich die Watchparty. */
    /**
     * Ein Rahmen der Anbieterseite hat sich gemeldet.
     *
     * <p>Das ist der Augenblick, in dem die Spielerskripte hineingehoeren -
     * nicht das Seitenende. Der Hoster baut sein Video oft erst danach ein, und
     * ein Skript, das vorher laeuft, findet nichts.
     *
     * <p>Am Rechner faellt dieser Schritt weg: dort spielt Electron in jeden
     * Rahmen ein, sobald die Seite steht.
     */
    private void rahmenMeldung(WebView ansicht, String adresse, boolean hatVideo, String nachricht) {
        if (nachricht != null && nachricht.startsWith(Messung.MELDE_MESSUNG)) {
            if (messung != null) messung.ausRahmen(nachricht);
            return;
        }
        if (!hatVideo || activeProvider == null || ansicht != webViews.get(activeProvider.id)) return;
        String seite = ansicht.getUrl();
        if (seite == null || !seite.startsWith("http")) return;
        Log.i(TAG, "Rahmen mit Video: " + safeHost(adresse));
        // Hier und nicht erst beim Seitenende: ein neuer Player entsteht auch
        // mitten in einem Dokument - beim Hosterwechsel, beim Sprachwechsel,
        // beim Nachladen des Rahmens. Genau daran ist die Watchparty frueher
        // gestorben. Das Skript traegt seinen eigenen Merker, ein zweites
        // Einspielen kostet also nichts.
        if (mitschauen != null) mitschauen.anPlayer(ansicht);
        org.json.JSONArray eintraege = FavoriteStore.ladeRoh(this);
        // Waehrend einer laufenden Watchparty wird nicht gelernt. Der Player
        // wird dann von aussen gefahren, und ein Sprung, den die Runde
        // ausgeloest hat, ist keine Entscheidung dessen, der hier sitzt -
        // daraus eine Intromarke zu lernen hiesse, fremde Sekunden als eigene
        // Gewohnheit zu merken. Dieselbe Bedingung wie am Rechner
        // ({@code lernen = !watchpartyLiveKeyForUrl(url)}); sie stand hier auf
        // "immer lernen", solange es auf Android kein Live-Mitschauen gab.
        boolean lernen = mitschauen == null || !mitschauen.laeuftMit();
        if (marken != null) marken.einspielen(ansicht, activeProvider, seite, eintraege, lernen);
        if (qualitaet != null) qualitaet.einspielen(ansicht);
    }

    private void kernEreignis(String name, String nutzlastJson) {
        if (name != null && name.startsWith("watchparty:") && watchparty != null) {
            watchparty.ereignis(name, nutzlastJson);
            return;
        }
        if (geraete != null && geraete.ereignis(name, nutzlastJson)) return;
        // Der Empfehlungslauf hat bessere Daten bekommen und neu gerechnet.
        // Was steht, bleibt stehen; beim naechsten Zeichnen wird gefragt.
        if ("empfehlung.neu".equals(name) && empfehlungen != null) {
            empfehlungen.kernMeldung();
            return;
        }
        Log.i(TAG, "Kern-Ereignis " + name + ": " + nutzlastJson);
    }

    /** Die Runde hat sich gemeldet - der Watchparty-Bildschirm zeichnet neu. */
    private void watchpartyGeaendert() {
        if ("watchparty".equals(currentScreen)) {
            zeigeWatchparty();
            return;
        }
        // Die Startseite geht das auch etwas an: erst mit den eingestellten
        // Titeln laesst sich einer Kachel ihr Schluessel in der Runde
        // zuordnen. Beim Start ist die Seite meist schon gebaut, wenn die
        // Liste vom Relay eintrifft - ohne dies bliebe "Gemeinsam
        // weiterschauen" bis zur naechsten Aenderung im Bestand stumm.
        //
        // Neu gezeichnet wird nur, wenn sich an den Titeln wirklich etwas
        // geaendert hat. Der Stand allein kommt im Sekundentakt und wird in
        // Ort nachgezogen, nicht mit einer neuen Seite.
        if (!"home".equals(currentScreen)) return;
        String jetzt = watchpartyEintragsListe();
        if (jetzt.equals(watchpartyEintragsStand)) return;
        watchpartyEintragsStand = jetzt;
        int stand = seitenScroll == null ? 0 : seitenScroll.getScrollY();
        showHome();
        scrollStandHerstellen(stand);
    }

    /** Welche Titel gerade in welchen Raeumen stehen - als eine Zeile zum Vergleichen. */
    private String watchpartyEintragsListe() {
        if (watchparty == null) return "";
        JSONArray eintraege = watchparty.eintraege();
        StringBuilder zeile = new StringBuilder();
        for (int i = 0; i < eintraege.length(); i += 1) {
            JSONObject eintrag = eintraege.optJSONObject(i);
            if (eintrag == null) continue;
            zeile.append(eintrag.optString("key", "")).append('|')
                .append(eintrag.optString("room", "")).append('\n');
        }
        return zeile.toString();
    }

    /**
     * Nur der Stand hat sich geaendert - dann auch nur die eine Karte.
     *
     * <p>Er kommt im Sekundentakt, solange jemand schaut. Die ganze Seite
     * dafuer neu zu bauen war auf dem Telefon schon verschwenderisch; auf dem
     * Fernseher waere es ein Fehler: mit jeder neuen Seite verschwindet die
     * Ansicht, die den Fokus haelt, und die Fernbedienung faengt jede Sekunde
     * oben an.
     */
    private void mitschauStandGeaendert() {
        liveKachelnAuffrischen();
        // Der Streifen ueber dem Bild zieht sofort nach und nicht erst beim
        // naechsten Sekundentakt: eine Pause soll dort stehen, sobald sie
        // gemeldet ist.
        liveStreifenAuffrischen();
        if (!"watchparty".equals(currentScreen) || mitschauPlatz == null) return;
        mitschauPlatz.removeAllViews();
        View karte = mitschauKarte();
        if (karte != null) {
            mitschauPlatz.addView(karte, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }
    }

    /* ------------------------------------ Kacheln aus einer Watchparty */

    /**
     * Eine Kachel, deren Stand nicht der eigene ist.
     *
     * <p>Sie merkt sich nicht ihren Inhalt, sondern nur, wo er herkommt: unter
     * welchem Schluessel die Runde meldet und wie lang die Folge ist. Alles
     * Weitere steht in der Ansicht und wird dort nachgezogen.
     */
    private static final class LiveKachel {
        final View karte;
        final String schluessel;
        final double dauer;
        /** Wer zuletzt einen Fortschritt schickte - der Rueckfall ohne Standmeldung. */
        final String von;
        /** Und wann; danach gilt der Hinweis nicht mehr. */
        final long gemeldetUm;

        LiveKachel(View karte, String schluessel, double dauer, String von, long gemeldetUm) {
            this.karte = karte;
            this.schluessel = schluessel;
            this.dauer = dauer;
            this.von = von;
            this.gemeldetUm = gemeldetUm;
        }
    }

    /** Wann der letzte geteilte Stand kam - 0, wenn keiner oder unlesbar. */
    private static long watchpartyZeit(Favorite eintrag) {
        String wann = eintrag == null ? "" : eintrag.watchpartyAm();
        if (wann.isEmpty()) return 0;
        try {
            return java.time.Instant.parse(wann).toEpochMilli();
        } catch (Exception unlesbar) {
            return 0;
        }
    }

    /**
     * Unter welchem Schluessel eine Kachel ihren Stand in der Runde findet.
     *
     * @return leer, wenn der Eintrag zu keiner Runde gehoert oder dort nichts
     *         Passendes eingestellt ist
     */
    private String liveSchluessel(Favorite eintrag) {
        if (watchparty == null || eintrag == null) return "";
        String raum = eintrag.watchpartyRaum();
        if (raum.isEmpty()) return "";
        return watchparty.kartenSchluessel(raum, eintrag.title());
    }

    /**
     * Die Zeile "wer schaut gerade".
     *
     * <p>Zuerst der Stand aus der Runde - dieselbe Quelle, aus der auch der
     * Sekundentakt schoepft. Erst wenn dort niemand meldet, zaehlt der letzte
     * geteilte Fortschritt, und auch der nur eine knappe halbe Minute lang.
     * Dieselbe Vorrangregel wie {@code watchpartyHint} am Rechner: andersherum
     * flackerte die Zeile, weil der Aufbau sie anders faende als der Takt.
     *
     * @return leer, wenn ausser einem selbst niemand meldet
     */
    private String liveZeile(String schluessel, Favorite eintrag) {
        if (watchparty == null || schluessel == null || schluessel.isEmpty()) return "";
        String live = Mitschaustand.liveText(watchparty.frischeMitglieder(schluessel));
        if (!live.isEmpty()) return live;
        long gemeldet = watchpartyZeit(eintrag);
        if (gemeldet <= 0) return "";
        return Mitschaustand.hinweisText(eintrag.watchpartyVon(),
            System.currentTimeMillis() - gemeldet);
    }

    /**
     * Die Kacheln einer Runde nachziehen - Zeile, Zeit und Balken.
     *
     * <p>Kacheln, die nicht mehr an der Seite haengen, fallen dabei heraus:
     * die Startseite wird bei jeder Aenderung im Bestand neu gebaut, und die
     * alten Ansichten sollen den Takt nicht ueberdauern.
     */
    private void liveKachelnAuffrischen() {
        if (watchparty == null || liveKacheln.isEmpty()) return;
        java.util.Iterator<LiveKachel> lauf = liveKacheln.iterator();
        while (lauf.hasNext()) {
            LiveKachel kachel = lauf.next();
            if (kachel.karte.getParent() == null) {
                lauf.remove();
                continue;
            }
            JSONArray frisch = watchparty.frischeMitglieder(kachel.schluessel);
            double seit = watchparty.sekundenSeitMeldung(kachel.schluessel);

            View zeile = kachel.karte.findViewWithTag(Mitschaustand.MARKE_LIVE);
            if (zeile instanceof TextView) {
                String text = Mitschaustand.liveText(frisch);
                if (text.isEmpty() && kachel.gemeldetUm > 0) {
                    text = Mitschaustand.hinweisText(kachel.von,
                        System.currentTimeMillis() - kachel.gemeldetUm);
                }
                ((TextView) zeile).setText(text);
                zeile.setVisibility(text.isEmpty() ? View.GONE : View.VISIBLE);
            }

            // Ohne Meldung bleibt der eigene Stand stehen. Ihn auf null zu
            // setzen, weil gerade niemand schaut, waere schlechter als der
            // Stand von vorhin - er stimmt ja.
            JSONObject fuehrend = Mitschaustand.fuehrend(frisch);
            if (fuehrend == null) continue;
            double stelle = Mitschaustand.stelle(fuehrend, seit);

            View stand = kachel.karte.findViewWithTag(Mitschaustand.MARKE_STAND);
            if (stand instanceof TextView) {
                ((TextView) stand).setText(Mitschaustand.standText(stelle, kachel.dauer));
            }

            View balken = kachel.karte.findViewWithTag(Mitschaustand.MARKE_BALKEN);
            if (kachel.dauer > 0 && balken != null && balken.getParent() instanceof View
                && balken.getLayoutParams() instanceof FrameLayout.LayoutParams) {
                int breite = ((View) balken.getParent()).getWidth();
                if (breite > 0) {
                    FrameLayout.LayoutParams masse = (FrameLayout.LayoutParams) balken.getLayoutParams();
                    masse.width = Math.max(dp(3),
                        breite * Mitschaustand.prozent(stelle, kachel.dauer) / 100);
                    balken.setLayoutParams(masse);
                }
            }
        }
        if (liveKacheln.isEmpty()) liveTakt.removeCallbacksAndMessages(null);
    }

    /**
     * Den Sekundentakt stellen - aber nur, solange es etwas nachzuziehen gibt.
     *
     * <p>Er laeuft nicht, wenn keine Kachel aus einer Runde dasteht, nicht
     * hinter einer offenen Anbieterseite und nicht im Vollbild: eine Uhr, die
     * niemand sieht, kostet nur Strom.
     */
    private void liveTaktPlanen() {
        liveTakt.removeCallbacksAndMessages(null);
        if (liveKacheln.isEmpty()) return;
        liveTakt.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (!"home".equals(currentScreen) || fullscreenView != null) return;
                if (liveKacheln.isEmpty()) return;
                liveKachelnAuffrischen();
                if (liveKacheln.isEmpty()) return;
                liveTakt.postDelayed(this, 1000);
            }
        }, 1000);
    }

    /**
     * Ein kurzer Beweis, dass wirklich die Desktop-Module laufen.
     *
     * <p>Geprueft wird an Werten, die vom Desktop bekannt sind: derselbe
     * Werkschluessel fuer denselben Titel, dieselbe Suchvorlage fuer denselben
     * Anbieter. Schlaegt das fehl, ist der Kern zwar hochgekommen, rechnet aber
     * anders als der Rechner - und das faellt besser hier auf als spaeter an
     * einem Fortschritt, der nicht zusammenpasst.
     */
    private void kernSelbsttest() {
        kern.probenFahren((zeile, fehler) -> {
            if (fehler != null) Log.e(TAG, "Fortschritts-Proben nicht gefahren: " + fehler);
            else Log.i(TAG, "Fortschritts-Proben: " + zeile);
        });
    }

    private void clearBrowserCachesPreservingLogin() {
        CookieManager.getInstance().flush();
        try {
            WebStorage.getInstance().deleteAllData();
        } catch (Exception ignored) {
        }
        for (WebView webView : webViews.values()) {
            if (webView == null) continue;
            try {
                webView.clearCache(true);
                webView.clearFormData();
                webView.clearHistory();
            } catch (Exception ignored) {
            }
        }
        deleteDirectory(new File(getCacheDir(), "webviewCacheChromium"));
        deleteDirectory(new File(getCacheDir(), "org.chromium.android_webview"));
    }

    private void deleteDirectory(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) {
                deleteDirectory(child);
            }
        }
        try {
            file.delete();
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onBackPressed() {
        // Ganz zuoberst der Startvorhang. Solange er liegt, ist "Zurueck" die
        // Absage an den Start und nicht der Schritt in der Seite dahinter -
        // die sieht ja gerade niemand.
        if (startvorhang != null && startvorhang.zurueckTaste()) return;
        // Zurueck schliesst zuerst die ausgeklappten Watchparty-Details - und
        // nicht gleich das Vollbild oder die ganze Folge. Wer aufgeklappt hat,
        // um zu sehen, wer mitschaut, will genau das wieder schliessen.
        if (liveStreifen != null && liveStreifen.zurueck()) return;
        if (fullscreenView != null) {
            hideFullscreen();
            return;
        }
        WebView webView = activeProvider == null ? null : webViews.get(activeProvider.id);
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        // Aus dem Jahresrueckblick zurueck in den Rueckblick und nicht ganz
        // nach vorn: er ist von dort aus geoeffnet worden.
        if ("wrapped".equals(currentScreen)) {
            zeigeRueckblick(rueckblickZeitraum);
            return;
        }
        // Aus der Watchparty geoeffnet: dorthin zurueck und nicht auf die
        // Startseite. Wer eine Folge aus einem Raum heraus aufmacht, will
        // danach wieder den Raum sehen - dort stehen die anderen Titel.
        if ("provider".equals(currentScreen) && "watchparty".equals(providerHerkunft)) {
            providerHerkunft = "";
            zeigeWatchparty();
            return;
        }
        if (!"home".equals(currentScreen)) {
            showHome();
            return;
        }
        super.onBackPressed();
    }

    @Override
    public boolean dispatchTouchEvent(android.view.MotionEvent event) {
        if (event.getActionMasked() == android.view.MotionEvent.ACTION_DOWN
            && fullscreenView != null) {
            if (liveStreifen != null) liveStreifen.regung();
            if (spielerleiste != null) spielerleiste.regung();
        }
        return super.dispatchTouchEvent(event);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        logRemoteKey(event);
        // Solange der Startvorhang liegt, gehoert ihm die Fernbedienung.
        //
        // Ein Fokusfang in der Vorhangansicht reicht dafuer nicht: die
        // Anbieterseite dahinter holt sich den Fokus beim Laden von selbst
        // zurueck (openProvider ruft webView.requestFocus()), und danach
        // wandert das Kreuz durch Ziele, die niemand sieht - auf dem Fernseher
        // der sichere Weg, sich in einem Ladebildschirm zu verirren.
        //
        // Durchgelassen wird genau zweierlei: "Zurueck", weil das die Absage
        // an den Start ist, und im Fehlerfall die Navigation zwischen den
        // beiden Knoepfen, die dann wirklich dastehen.
        if (startvorhang != null && startvorhang.laeuft()) {
            if (event.getKeyCode() == KeyEvent.KEYCODE_BACK) return super.dispatchKeyEvent(event);
            if (startvorhang.tastenErlaubt()) return super.dispatchKeyEvent(event);
            return true;
        }
        // Jede Taste holt die Teilnehmerleiste zurueck - dieselbe Regung, die
        // auch die Bedienelemente des Players wieder einblendet. Sie bleibt
        // dabei der Rueckfall: sagt der Player selbst, was seine Leiste tut,
        // hat sein Wort das letzte.
        if (event.getAction() == KeyEvent.ACTION_DOWN && fullscreenView != null) {
            if (liveStreifen != null) liveStreifen.regung();
            if (spielerleiste != null) spielerleiste.regung();
        }
        if (event.getAction() == KeyEvent.ACTION_DOWN && handleRemoteShortcut(event.getKeyCode())) {
            return true;
        }
        if (fullscreenView != null && handleFullscreenKey(event)) {
            return true;
        }
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            int keyCode = event.getKeyCode();
            if (mouseMode && handleMouseModeKey(keyCode)) {
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_SPACE) {
                togglePlayback();
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_SEARCH) {
                setChromeCollapsed(false, false);
                focusSearch();
                return true;
            }
            if ((keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER)
                && isTelevision() && "provider".equals(currentScreen) && fullscreenView == null) {
                tvActivateFocusedFrame();
            }
            if ((keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER) && searchInput != null && searchInput.hasFocus()) {
                showGlobalSearch(searchInput.getText().toString().trim());
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_DPAD_DOWN && isChromeFocused()) {
                setChromeCollapsed(true, false);
                // Auf dem Weg nach unten liegt die Wiedergabeleiste. Sie zu
                // ueberspringen hiesse, "Naechste Folge" und Autoplay
                // ausserhalb des Vollbilds nur ueber die Zifferntasten
                // erreichbar zu lassen - ein Knopf, den man sieht und nicht
                // anwaehlen kann.
                if (spielerleiste != null && spielerleiste.fokussieren()) return true;
                return focusActiveWebView();
            }
        }
        return super.dispatchKeyEvent(event);
    }

    /**
     * Every key the app sees, named. Remotes disagree about what their buttons send -- the long
     * up/down rocker beside GUIDE is usually CHANNEL_UP/DOWN but some send PAGE_UP/DOWN or
     * DPAD_UP/DOWN, and colour buttons are frequently swallowed by the launcher before an app ever
     * sees them. Rather than assume from the printed symbol, this prints what actually arrives, so
     * the table in handleRemoteShortcut() can be corrected against a real device:
     *   adb logcat -s ELFIX | grep "KEY "
     */
    private void logRemoteKey(KeyEvent event) {
        Log.i(TAG, "KEY " + KeyEvent.keyCodeToString(event.getKeyCode())
            + " code=" + event.getKeyCode()
            + " action=" + event.getAction()
            + " repeat=" + event.getRepeatCount()
            + " scan=" + event.getScanCode()
            + " source=0x" + Integer.toHexString(event.getSource())
            + " device=" + event.getDeviceId()
            + " fullscreen=" + (fullscreenView != null)
            + " screen=" + currentScreen);
    }

    /**
     * The one place remote buttons are mapped to actions. Everything global lives here so a button
     * never has to be looked for in three different handlers.
     *
     * The big D-pad and its OK button are deliberately absent: they stay with normal focus movement
     * and clicking. Fullscreen-only behaviour (OK tapping the video, re-asserting the system UI)
     * remains in handleFullscreenKey(), which runs after this.
     */
    private boolean handleRemoteShortcut(int keyCode) {
        boolean fullscreen = fullscreenView != null;
        boolean onWebsite = "provider".equals(currentScreen) && currentWebView() != null;
        switch (keyCode) {
            // The separate up/down rocker scrolls the page. Not the D-pad.
            case KeyEvent.KEYCODE_CHANNEL_UP:
            case KeyEvent.KEYCODE_PAGE_UP:
                if (!onWebsite || fullscreen) return false;
                scrollActiveWebView(-dp(360));
                return true;
            case KeyEvent.KEYCODE_CHANNEL_DOWN:
            case KeyEvent.KEYCODE_PAGE_DOWN:
                if (!onWebsite || fullscreen) return false;
                scrollActiveWebView(dp(360));
                return true;

            // Media transport: the two skip keys change ELFIX tab, the middle one drives the video.
            case KeyEvent.KEYCODE_MEDIA_REWIND:
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                cycleProvider(-1);
                return true;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
            case KeyEvent.KEYCODE_MEDIA_NEXT:
                cycleProvider(1);
                return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                if (fullscreen) tapFullscreenCentre();
                else togglePlayback();
                return true;
            // Getrennt, weil die Fernbedienung sie getrennt meint. Beide gehen
            // in den Rahmen des Hosters und loesen dort ein echtes Medien-
            // ereignis aus - die Watchparty meldet es von selbst weiter.
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                if (!onWebsite && !fullscreen) return false;
                spielerAbspielen();
                return true;
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_STOP:
                if (!onWebsite && !fullscreen) return false;
                spielerAnhalten();
                return true;

            // Numbers, and the colour buttons alongside them for the same actions.
            case KeyEvent.KEYCODE_1:
            case KeyEvent.KEYCODE_PROG_RED:
                if (!onWebsite) return false;
                toggleFavorite();
                return true;
            case KeyEvent.KEYCODE_3:
            case KeyEvent.KEYCODE_PROG_GREEN:
                if (fullscreen) hideFullscreen();
                showHome();
                return true;
            case KeyEvent.KEYCODE_5:
                if (!onWebsite) return false;
                if (fullscreen) hideFullscreen();
                else enterPlayerFullscreen();
                return true;
            case KeyEvent.KEYCODE_7:
            case KeyEvent.KEYCODE_PROG_BLUE:
                if (!onWebsite || fullscreen) return false;
                toggleChromeFocus();
                return true;
            case KeyEvent.KEYCODE_9:
            case KeyEvent.KEYCODE_PROG_YELLOW:
                if (!onWebsite) return false;
                naechsteFolgeStarten("Fernbedienung");
                return true;
            // Der Autoplay-Schalter auf der Fernbedienung. Er tut, was der
            // Knopf in der Leiste tut - und die Leiste zieht mit, weil sie
            // ihren Text aus derselben Einstellung liest.
            case KeyEvent.KEYCODE_8:
                if (!onWebsite) return false;
                autoplayUmschalten();
                return true;
            case KeyEvent.KEYCODE_0:
            case KeyEvent.KEYCODE_INFO:
                toggleMouseMode();
                return true;

            case KeyEvent.KEYCODE_BOOKMARK:
                if (!onWebsite) return false;
                toggleFavorite();
                return true;

            // The bar is a toggle now, in both directions, instead of only ever coming back.
            case KeyEvent.KEYCODE_MENU:
            case KeyEvent.KEYCODE_SETTINGS:
                if (fullscreen) return false;
                if (!onWebsite) return false;
                setChromeCollapsed(!chromeCollapsed, true);
                return true;

            // Leaving fullscreen must not also walk the browser history back a page.
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_ESCAPE:
                if (!fullscreen) return false;
                hideFullscreen();
                return true;

            default:
                return false;
        }
    }

    /**
     * Open the hoster, start playback and go fullscreen without further button presses.
     *
     * Three separate things have to happen in order and none of them is instant, so this is a chain
     * of steps rather than one call: the hoster link has to be clicked to build the inline player,
     * the player then needs a real tap to start (its play overlay does not answer synthetic DOM
     * events), and only once something is playing does asking for fullscreen make sense.
     *
     * It is deliberately best-effort. These pages answer a click with a popunder attempt, and when
     * the ad blocker eats that the click is spent on the blocked popup rather than on the player --
     * hence "press it again" rather than retry loops that would keep hammering the page.
     */
    /**
     * Ask the next load of this exact URL to start itself.
     *
     * Cleared when navigation goes somewhere else rather than after a timeout. A timeout was the
     * first attempt and it was wrong: measured on a throttled connection, AniWorld had still not
     * finished loading after 150 seconds, so any deadline short enough to be useful as a safety net
     * also cancelled perfectly good slow loads. What actually makes a request stale is the user
     * going somewhere else, and that is observable exactly. The long stop is only there so a request
     * cannot survive indefinitely if no navigation ever happens again.
     */
    private void armAutoStart(String url) {
        armAutoStart(url, 0);
    }

    /**
     * @param stelle der gespeicherte Wiedergabestand in Sekunden. Er wird
     *               gesetzt, sobald der Player wirklich eine Quelle hat - vorher
     *               gibt es nichts zu springen.
     */
    private void armAutoStart(String url, double stelle) {
        autoStartRequested = true;
        autoStartUrl = url;
        autoStartStelle = Math.max(0, stelle);
        autoStartArmedAt = SystemClock.uptimeMillis();
    }

    private void disarmAutoStart(String reason) {
        // Und der Vorhang haengt am Anlauf: wer ihn entschaerft, meint auch die
        // Folge nicht mehr, die dahinter starten sollte. Ohne diese Zeile bliebe
        // ein Ladebildschirm ueber einer Seite liegen, auf die niemand mehr wartet.
        if (startvorhang != null) startvorhang.auf(reason);
        // Der Anlauf haengt nicht an der Anfrage: er laeuft im Kern weiter,
        // auch wenn die Anfrage laengst verbraucht ist. Wer woandershin geht,
        // meint ihn nicht mehr - sonst startet eine halbe Minute spaeter eine
        // Folge, die niemand mehr sehen will.
        if (mitschauen != null) mitschauen.oertlichenStartAbbrechen(reason);
        if (!autoStartRequested) return;
        Log.i(TAG, "Autostart disarmed: " + reason);
        autoStartRequested = false;
        autoStartUrl = null;
        autoStartStelle = 0;
    }

    private boolean autoStartArmedFor(String url) {
        if (!autoStartRequested || !isSameUrl(url, autoStartUrl)) return false;
        return SystemClock.uptimeMillis() - autoStartArmedAt <= AUTOSTART_ARM_TTL_MS;
    }

    /**
     * Poll the page until a probe answers, instead of guessing how long a step takes.
     *
     * Every step of the chain waits on something the page produces at its own pace -- the hoster
     * list, then the player frame that only exists once the hoster has been contacted. A fixed delay
     * is right on exactly one connection speed: too short and the step is skipped on a slow line,
     * too long and it feels broken on a fast one. The probe returns an empty string while it is not
     * ready yet, and the answer itself once it is.
     */
    private void awaitPage(WebView webView, String url, String probeJs, long deadlineAt,
            java.util.function.Consumer<String> onReady, Runnable onTimeout) {
        // A null url means "wherever we end up is fine". Opening a hoster does not always build an
        // inline player: AniWorld also answers the click by sending the main frame to /redirect/...,
        // and then the player *is* the page. Insisting on the episode URL aborted exactly that case.
        if (url != null && !isSameUrl(webView.getUrl(), url)) {
            Log.i(TAG, "Autostart aborted, page changed to " + safePath(webView.getUrl()));
            return;
        }
        webView.evaluateJavascript(probeJs, value -> {
            String result = value == null ? "" : value.replace("\"", "").trim();
            if (!result.isEmpty() && !"null".equals(result)) {
                onReady.accept(result);
                return;
            }
            if (SystemClock.uptimeMillis() >= deadlineAt) {
                onTimeout.run();
                return;
            }
            webView.postDelayed(
                () -> awaitPage(webView, url, probeJs, deadlineAt, onReady, onTimeout),
                AUTOSTART_POLL_MS);
        });
    }

    /**
     * The page usually brings its own player, so the first move is to wait rather than to click.
     *
     * Measured on a freshly loaded AniWorld episode page with nothing clicked at all: the
     * /redirect/<id> iframe is already embedded at 710x480. Clicking a hoster on top of that is not
     * just redundant -- it is the click these pages spend on a popunder, and it is what sends the
     * main frame off to the hoster's own domain, which is how the page stops being an episode page
     * and key 9 loses the episode list. So the click is the fallback for pages that really do not
     * embed anything, not the opening move.
     */
    private void runAutoStart(WebView webView, String url) {
        Log.i(TAG, "Autostart begin url=" + safePath(url) + " stelle=" + Math.round(autoStartStelle));
        // Die Seite ist da, gesucht wird jetzt der Player. Liegt der Vorhang,
        // sagt er das - ein Toast daneben waere dieselbe Auskunft ein zweites
        // Mal, und zwar quer ueber den Ladebildschirm.
        if (startvorhang != null && startvorhang.laeuft()) startPhaseMelden("hoster");
        else showToast("Startet …");
        laufenderStart = autoStartStelle;
        awaitPage(webView, url, PLAYER_PROBE_JS,
            SystemClock.uptimeMillis() + AUTOSTART_EMBEDDED_TIMEOUT_MS,
            ready -> {
                Log.i(TAG, "Autostart using the player the page already embeds");
                autoStartSpielen(webView, url);
            },
            () -> {
                Log.i(TAG, "Autostart: nothing embedded, falling back to the hoster list");
                clickHoster(webView, url);
            });
    }

    /**
     * Fallback for pages that do not embed a player themselves.
     *
     * <p>Erst die Fassung, dann der Hoster. Die Anbieterseite zeigt nur die
     * Hoster der gewaehlten Fassung; ein Klick davor traefe die, die gerade
     * noch dastanden - und damit die falsche Sprache, obwohl alles richtig
     * gemerkt war. Dieselbe Reihenfolge wie am Rechner.
     */
    private void clickHoster(WebView webView, String url) {
        if (fassungen != null && fassungen.wartet()) {
            webView.postDelayed(() -> {
                if (currentWebView() == webView) clickHoster(webView, url);
            }, FASSUNG_NACHFASSEN_MS);
            return;
        }
        awaitPage(webView, url,
            "(function(){"
                + "function visible(el){var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}"
                + "var links=Array.prototype.slice.call(document.querySelectorAll('a.watchEpisode'))"
                    + ".filter(visible);"
                + "if(!links.length)return '';"
                // Prefer the hoster ELFIX is known to drive: VOE's player exposes the controls the
                // rest of this chain relies on. Otherwise just take the first one offered.
                + "var pick=links.filter(function(a){"
                    + "return /voe/i.test(a.querySelector('h4')?a.querySelector('h4').textContent:'');"
                + "})[0]||links[0];"
                + "pick.scrollIntoView({block:'center'});"
                + "pick.click();"
                + "return 'clicked';"
            + "})();",
            SystemClock.uptimeMillis() + AUTOSTART_HOSTER_TIMEOUT_MS,
            result -> {
                Log.i(TAG, "Autostart hoster " + result);
                autoStartFullscreen(webView, url);
            },
            () -> {
                Log.w(TAG, "Autostart: no hoster link within timeout");
                if (startFehler("hoster")) return;
                showToast("Kein Hoster gefunden");
            });
    }

    /**
     * Second step: once a player exists, go fullscreen -- and only then start it.
     *
     * The chain stops here, with the player up in fullscreen and paused. Starting it is left to the
     * viewer: these pages spend the first click on a popunder often enough that an automatic tap was
     * a coin toss, and a coin toss that sometimes pauses a video that had already started is worse
     * than no tap at all -- whether playback is running cannot be read back from a cross-origin
     * hoster frame. OK on the remote taps the middle of the full-screen video.
     */
    private void autoStartFullscreen(WebView webView, String url) {
        awaitPage(webView, null, PLAYER_PROBE_JS,
            SystemClock.uptimeMillis() + AUTOSTART_PLAYER_TIMEOUT_MS,
            ready -> autoStartSpielen(webView, url),
            () -> {
                Log.w(TAG, "Autostart: player frame did not appear within timeout");
                if (startFehler("spieler")) return;
                showToast("Player nicht bereit -- nochmal drücken");
            });
    }

    /**
     * Der Player ist da - jetzt soll er wirklich laufen.
     *
     * <p>Hier endete die Kette bisher, und zwar im Vollbild: "The chain stops
     * here, with the player up in fullscreen and paused." Das war fuer eine
     * Fernbedienung eine bewusste Zurueckhaltung und fuer einen Tipp auf
     * "Weiterschauen" schlicht der gemeldete Fehler - Vollbild da, Folge steht.
     *
     * <p>Dass ein Player-Rahmen existiert, heisst naemlich nicht, dass es
     * etwas abzuspielen gibt. Gemessen am 25.08.2026 (AniWorld -> VOE): der
     * Rahmen traegt ein {@code <video>} ohne Quelle, und erst der Klick auf
     * seine eigene Ueberlagerung laedt sie. Genau diesen Ablauf fuehrt
     * {@link Mitschauen} - Ueberlagerung klicken, auf die Quelle warten, den
     * gespeicherten Stand setzen, starten, nachsehen, ob die Stelle
     * weiterlaeuft. Erst sein Bericht loest das Vollbild aus.
     *
     * <p>Der Rueckfall bleibt der alte Weg: ohne Kern gibt es niemanden, der
     * den Ablauf fuehren koennte, und dann ist ein Vollbild mit Player immer
     * noch besser als gar nichts.
     */
    private void autoStartSpielen(WebView webView, String url) {
        if (currentWebView() != webView) return;
        // Der Player-Rahmen steht. Was jetzt kommt - Ueberlagerung klicken,
        // Quelle abwarten, springen, starten - fuehrt Mitschauen, und von dort
        // kommen auch die naechsten Schritte des Balkens.
        startPhaseMelden("spieler");
        double stelle = laufenderStart;
        laufenderStart = 0;
        if (mitschauen != null && mitschauen.oertlichenStartAnfordern(url, stelle)) return;
        Log.i(TAG, "Autostart ohne Kern - nur Vollbild");
        autoStartPressFive(webView);
    }

    private void autoStartPressFive(WebView webView) {
        if (currentWebView() != webView) return;
        // Let the player settle before touching it. Finding the frame only means the element exists;
        // the hoster is still wiring up its own script behind it, and going fullscreen into that
        // window behaved differently from a fullscreen the viewer triggers by hand seconds later.
        webView.postDelayed(() -> {
            if (currentWebView() != webView || fullscreenView != null) return;
            Log.i(TAG, "Autostart pressing 5");
            // Literally the key: same entry point, same guards, same everything the remote goes
            // through. Calling enterPlayerFullscreen() directly would be one code path for the
            // automatic case and another for the manual one, and those two drift.
            handleRemoteShortcut(KeyEvent.KEYCODE_5);
        }, AUTOSTART_SETTLE_MS);
    }

    /** AniWorld and s.to both address episodes as .../staffel-<n>/episode-<m>. */
    private boolean isEpisodeUrl(String url) {
        if (url == null) return false;
        return url.matches("^https?://[^?#]*/staffel-\\d+/episode-\\d+/?(\\?.*)?$");
    }

    private boolean isSameUrl(String a, String b) {
        return a != null && b != null && FavoriteStore.normalizeUrl(a).equals(FavoriteStore.normalizeUrl(b));
    }

    /**
     * Welche Folge in einer Ansicht gerade laeuft.
     *
     * <p>Nicht immer die, die im Rahmen steht. Am Rechner liegt der Hoster in
     * einem eingebetteten Rahmen, und die Adresse der Anbieterseite bleibt
     * stehen. Auf dem Telefon nimmt "Video oeffnen" den Hauptrahmen: danach
     * steht dort vidmoly.biz.
     *
     * <p>Deshalb zaehlt hier die letzte Folgenseite, sobald die laufende
     * Adresse dem Anbieter gar nicht mehr gehoert. Nur dann: wer beim Anbieter
     * selbst weiterblaettert, soll seinen wirklichen Ort melden und nicht eine
     * Folge, die er verlassen hat.
     *
     * <p>Eine Antwort fuer beide Fragesteller. Die Messung hatte sie laengst;
     * dem Mitschauen fehlte sie, und deshalb verlor die Watchparty beim
     * Hosterwechsel ihren Raum, ihren Schluessel und damit jede Steuerung.
     */
    private String laufendeFolgenAdresse(WebView ansicht) {
        String jetzt = ansicht == null ? null : ansicht.getUrl();
        if (jetzt == null || activeProvider == null || lastEpisodeUrl == null) return jetzt;
        if (isProviderFirstPartyHost(activeProvider, safeHost(jetzt),
            safeHost(activeProvider.startUrl))) {
            return jetzt;
        }
        return lastEpisodeUrl;
    }

    /** Hand the remote back and forth between the ELFIX bar and the page. */
    private void toggleChromeFocus() {
        if (chromeCollapsed || isChromeFocused()) {
            // Bar hidden, or the bar has focus: give the page the remote and take the bar away.
            boolean wantChrome = chromeCollapsed;
            setChromeCollapsed(!wantChrome, true);
            return;
        }
        setChromeCollapsed(true, false);
        focusActiveWebView();
    }

    /* ---------------------------------------------- Die naechste Folge */

    /*
     * Woher die naechste Folge kommt - und warum nicht mehr von hier.
     *
     * Bis hierher rechnete diese Klasse selbst: Folgennummer plus eins, und
     * wenn die Seite dazu keinen Link hatte, Staffel plus eins. Das ist eine
     * zweite Regel neben der des Rechners, und sie war die schlechtere - sie
     * kannte weder das Ende einer Serie noch zusammengefasste Folgen, und die
     * Staffelgrenze fand sie nur, wenn zufaellig ein passender Link dastand.
     *
     * Gefragt wird jetzt {@link Folgen} und damit derselbe Kern, den der
     * Rechner fragt. Was hier bleibt, ist die Verkabelung: einsammeln, was die
     * Regel braucht, und ausfuehren, was sie sagt.
     */

    /**
     * Was die Regel ueber die Serie wissen muss.
     *
     * <p>Der Eintrag traegt die Grenzen der Serie ({@code finalSeason},
     * {@code finalEpisode}); solange es ihn noch nicht gibt - die ersten
     * zweieinhalb Minuten einer neuen Serie -, kommen sie aus den Angaben der
     * Seite. Beides zusammen, weil beides einzeln Luecken hat: der Eintrag
     * kennt die Staffelgrenze nicht, die Seite kennt den Fortschritt nicht.
     */
    private JSONObject eintragFuerFolgen(String url) {
        Favorite eintrag = bestand == null ? null : bestand.mitId(bestand.aktiverEintragId());
        if (eintrag == null && bestand != null) eintrag = bestand.zuAdresse(url);
        JSONObject roh = eintrag == null ? null : eintrag.roh;
        JSONObject angaben = seitenAngabenFuer(url);
        if (angaben == null) return roh;
        try {
            JSONObject zusammen = roh == null
                ? new JSONObject()
                : new JSONObject(roh.toString());
            if (zusammen.optInt("finalSeason", 0) <= 0 && angaben.optInt("finalSeason", 0) > 0) {
                zusammen.put("finalSeason", angaben.optInt("finalSeason"));
            }
            if (zusammen.optInt("finalEpisode", 0) <= 0 && angaben.optInt("finalEpisode", 0) > 0) {
                zusammen.put("finalEpisode", angaben.optInt("finalEpisode"));
            }
            return zusammen;
        } catch (Exception fehler) {
            Log.d(TAG, "Eintrag fuer die Folgenregel nicht gebaut: " + fehler);
            return roh;
        }
    }

    /**
     * Die Angaben der Folgenseite - auch dann noch, wenn der Hoster den
     * Hauptrahmen genommen hat.
     */
    private JSONObject seitenAngabenFuer(String url) {
        if (url == null || url.isEmpty()) return null;
        if (titelbild != null) {
            JSONObject frisch = titelbild.angaben(url);
            if (frisch != null && frisch.length() > 0) {
                folgenAngaben = frisch;
                folgenAngabenUrl = url;
                return frisch;
            }
        }
        return url.equals(folgenAngabenUrl) ? folgenAngaben : null;
    }

    /**
     * Nachsehen, ob es eine naechste Folge gibt - und die Leiste nachziehen.
     *
     * <p>Gerufen beim Seitenende und in jedem Messtakt. Der Takt ist kein
     * Luxus: die Grenzen der Serie stehen erst da, wenn die Seitenangaben
     * gelesen und der Eintrag gefunden ist, und beides kommt Sekunden nach dem
     * Seitenende. Ein einmaliger Blick beim Laden fiele genau in die Luecke.
     *
     */
    private void naechsteFolgeBestimmen() {
        if (spielerleiste == null) return;
        final String laufend = laufendeFolgenAdresse(currentWebView());
        if (folgen == null || !"provider".equals(currentScreen)
            || laufend == null || !laufend.startsWith("http")) {
            spielerleiste.setzeAmSchauen(false);
            spielerleiste.setzeZiel("");
            return;
        }
        long jetzt = SystemClock.uptimeMillis();
        if (laufend.equals(zielSucheFuer) && jetzt - zielSucheAt < ZIELSUCHE_RUHE_MS) return;
        zielSucheFuer = laufend;
        zielSucheAt = jetzt;
        // Ob hier ueberhaupt etwas laeuft, wird je Adresse einmal gefragt und
        // dann behalten - es aendert sich nicht im Sekundentakt.
        if (!laufend.equals(abspielseiteFuer)) {
            folgen.abspielseite(laufend, ja -> {
                abspielseiteFuer = laufend;
                abspielseite = ja;
                Log.i(TAG, "FOLGE abspielseite " + Folgen.kurz(laufend) + " = " + ja);
                if (laufend.equals(laufendeFolgenAdresse(currentWebView()))) {
                    spielerleiste.setzeAmSchauen(ja);
                    if (!ja) spielerleiste.setzeZiel("");
                }
            });
        } else {
            spielerleiste.setzeAmSchauen(abspielseite);
            if (!abspielseite) {
                spielerleiste.setzeZiel("");
                return;
            }
        }
        JSONObject eintrag = eintragFuerFolgen(laufend);
        JSONObject angaben = seitenAngabenFuer(laufend);
        // Woraus die Regel ihre Antwort baut. Bleibt das Ziel leer, steht hier,
        // woran es lag - fast immer an einer Serienlaenge, die nie ankam.
        Log.i(TAG, "FOLGE lage " + Folgen.kurz(laufend)
            + " eintrag=" + (eintrag == null ? "-" : "ja")
            + " finalSeason=" + (eintrag == null ? 0 : eintrag.optInt("finalSeason", 0))
            + " finalEpisode=" + (eintrag == null ? 0 : eintrag.optInt("finalEpisode", 0))
            + " seasonLastEpisode=" + (angaben == null ? 0 : angaben.optInt("seasonLastEpisode", 0))
            + " gesperrt=" + (angaben == null ? "-" : angaben.opt("unplayableEpisodes"))
            + " seitenLink=" + (seitenLinkFuer(laufend).isEmpty() ? "-" : "ja"));
        folgen.naechste(laufend, eintrag, angaben,
            seitenLinkFuer(laufend), url -> {
                // Die Antwort kommt aus dem Kern und damit einen Augenblick
                // spaeter. Steht inzwischen eine andere Folge da, gehoert sie
                // zur Vergangenheit - der naechste Takt fragt neu.
                if (!laufend.equals(laufendeFolgenAdresse(currentWebView()))) return;
                if (!url.equals(letztesZiel)) {
                    letztesZiel = url;
                    Log.i(TAG, "FOLGE ziel " + (url.isEmpty()
                        ? "keine naechste Folge" : Folgen.kurz(url)));
                }
                spielerleiste.setzeZiel(url);
            });
    }

    /**
     * Zur naechsten Folge wechseln.
     *
     * <p>Derselbe Ablauf wie {@code playNextEpisode} am Rechner, in derselben
     * Reihenfolge:
     *
     * <ol>
     *   <li>Den Stand der laufenden Folge buchen. Er entsteht im Messtakt
     *       ohnehin, aber der naechste Takt kaeme womoeglich erst, wenn die
     *       Seite schon eine andere ist.
     *   <li>Die Adresse von der geteilten Regel holen.
     *   <li>Sie vom Torwaechter pruefen lassen - dieselbe Serie, weiter vorn.
     *   <li>Oeffnen, mit scharfem Autostart: dieselbe Kette wie aus
     *       "Weiterschauen", damit die Folge nicht als Uebersicht ohne Player
     *       dasteht.
     * </ol>
     *
     * <p>Die Watchparty wird hier <em>nicht</em> gesondert bedient. Sie haengt
     * an {@code Mitschauen.seiteFertig} und damit an jeder Navigation, die
     * ELFIX macht - eine eigene Meldung von hier waere die zweite und ginge als
     * doppelter Folgenwechsel in die Runde.
     */
    private void naechsteFolgeStarten(String anlass) {
        naechsteFolgeStarten(anlass, true);
    }

    /**
     * @param melden ob ein Fehlschlag gesagt werden soll. Beim Knopf ja - wer
     *               drueckt, hat eine Antwort verdient. Beim Autoplay nein: das
     *               Ende einer Serie ist kein Fehler, und "Hier gibt es keine
     *               naechste Folge" waere dort eine Meldung auf etwas, das
     *               niemand angefordert hat.
     */
    private void naechsteFolgeStarten(String anlass, boolean melden) {
        if (folgen == null || activeProvider == null) return;
        if (folgenwechselLaeuft()) {
            Log.i(TAG, "Folgenwechsel laeuft bereits - " + anlass + " ignoriert");
            return;
        }
        final Provider provider = activeProvider;
        final String laufend = laufendeFolgenAdresse(currentWebView());
        // Nicht ueber isEpisodeUrl: was als Folge gilt, entscheidet die
        // geteilte Regel, und sie kennt mehr Schreibweisen als das Muster hier.
        if (laufend == null || !laufend.startsWith("http")) {
            if (melden) showToast("Keine Folgenseite");
            return;
        }
        // Der Stand der laufenden Folge, bevor die Seite eine andere ist.
        if (messung != null) messung.jetztMessen();

        final JSONObject eintrag = eintragFuerFolgen(laufend);
        folgenwechselSeit = SystemClock.uptimeMillis();
        folgen.naechste(laufend, eintrag, seitenAngabenFuer(laufend), seitenLinkFuer(laufend),
            ziel -> {
                if (ziel.isEmpty()) {
                    folgenwechselSeit = 0;
                    Log.i(TAG, "FOLGE wechsel (" + anlass + ") abgebrochen - keine naechste Folge");
                    if (melden) showToast("Hier gibt es keine nächste Folge");
                    return;
                }
                folgen.pruefen(ziel, laufend, eintrag, erlaubt -> {
                    if (erlaubt.isEmpty()) {
                        folgenwechselSeit = 0;
                        Log.i(TAG, "FOLGE wechsel (" + anlass + ") abgelehnt - "
                            + Folgen.kurz(ziel) + " ist keine naechste Folge von "
                            + Folgen.kurz(laufend));
                        if (melden) showToast("Das war nicht die nächste Folge");
                        return;
                    }
                    folgeWirklichOeffnen(provider, erlaubt, anlass);
                });
            });
    }

    /**
     * Nach der naechsten Folge fragen - und zweimal nachfassen.
     *
     * <p>Beim Seitenende ist die Antwort meist noch leer: die Grenzen der Serie
     * stehen erst, wenn {@link Titelbild} die Seite gelesen hat, und der
     * Eintrag dazu wird ebenfalls erst gesucht. Beides kommt Sekunden spaeter,
     * und Titelbild fasst aus demselben Grund selbst zweimal nach.
     *
     * <p>Der Messtakt hilft hier nicht: er meldet sich nur, wenn wirklich ein
     * Video laeuft. Der Knopf soll aber schon dastehen, bevor jemand Play
     * gedrueckt hat.
     */
    private void zielNachfassen(WebView ansicht) {
        naechsteFolgeBestimmen();
        if (ansicht == null) return;
        for (long verzoegerung : new long[] {3000L, 8000L}) {
            ansicht.postDelayed(() -> {
                if (currentWebView() != ansicht) return;
                naechsteFolgeBestimmen();
            }, verzoegerung);
        }
    }

    /**
     * Der Folgenlink, den die Seite selbst anbietet.
     *
     * <p>Er kommt aus dem Messtakt ({@code messung.js} liest ihn beim Zaehlen
     * mit) und wird zu seiner Adresse gemerkt. Gemerkt, weil er nur waehrend
     * der Wiedergabe hereinkommt: der Knopf soll ihn auch dann noch benutzen
     * koennen, wenn gerade kein Takt gelaufen ist.
     *
     * <p>Geglaubt wird er nicht - die geteilte Regel prueft ihn gegen die
     * laufende Folge, bevor sie ihn nimmt.
     */
    private String seitenLinkFuer(String url) {
        return url != null && url.equals(seitenLinkZu) ? seitenLink : "";
    }

    private boolean folgenwechselLaeuft() {
        return folgenwechselSeit > 0
            && SystemClock.uptimeMillis() - folgenwechselSeit < FOLGENWECHSEL_SPERRE_MS;
    }

    private void folgeWirklichOeffnen(Provider provider, String url, String anlass) {
        Log.i(TAG, "FOLGE wechsel (" + anlass + ") -> "
            + Folgen.folgenText(url) + " " + Folgen.kurz(url));
        if (spielerleiste != null) spielerleiste.setzeZiel("");
        // Derselbe Vorhang wie bei "Weiterschauen" - der Rechner zieht ihn an
        // dieser Stelle ebenfalls (playNextEpisode -> beginAutostart). Ohne
        // gespeicherten Stand: die naechste Folge faengt vorn an.
        Favorite eintragDazu = bestand == null ? null : bestand.mitId(bestand.aktiverEintragId());
        startBegleiten(provider, url,
            startTitelFuer(eintragDazu == null ? "" : eintragDazu.title(), url), 0);
        // preserveFavoriteProgress: der Eintrag bleibt derselbe, es ist nur
        // eine andere Folge davon. Ohne das faellt activeFavoriteId weg, und
        // der Fortschritt liefe auf einen anderen Eintrag.
        armAutoStart(url);
        openProvider(provider, url, true);
        // Die Sperre faellt erst mit dem naechsten Seitenende (onPageStarted),
        // damit ein zweiter Tipp waehrend des Ladens nichts anrichtet.
    }

    /**
     * Ein Messwert ist da - die Leiste nachziehen.
     *
     * <p>Hier wird nicht mehr entschieden, ob gewechselt wird: die Leiste
     * bekommt, wie weit die Folge ist, und macht daraus dreierlei - unter
     * neunzig Prozent nichts, ab neunzig Prozent den Knopf, am Ende den
     * Zaehler. Genau diese Staffelung hat der Rechner auch.
     *
     * <p>Die neunzig Prozent hier sind ausdruecklich <em>nicht</em> die
     * Schwelle, ab der eine Folge als gesehen zaehlt. Die entscheidet die
     * geteilte Regel, und sie schaltet nichts weiter: wer bei 91 Prozent
     * weiterschaut, sieht nur einen Knopf und wird nicht aus seiner Folge
     * geworfen.
     */
    private void spielstandGemessen(Provider anbieter, String adresse, double position,
                                    double laufzeit, boolean beendet, String seitenLink) {
        if (anbieter != activeProvider) return;
        // Erst merken, dann fragen: die Bremse in naechsteFolgeBestimmen darf
        // einen frisch gelesenen Folgenlink nicht verschlucken.
        if (seitenLink != null && !seitenLink.isEmpty() && adresse != null) {
            this.seitenLink = seitenLink;
            this.seitenLinkZu = adresse;
        }
        boolean nah = Folgen.nahAmEnde(position, laufzeit, beendet);
        boolean ende = Folgen.amEnde(position, laufzeit, beendet);
        // Der Messwert, wie er hereinkommt. Ohne ihn laesst sich von aussen
        // nicht unterscheiden, ob die Folge nicht weit genug ist, ob gar nicht
        // gemessen wird oder ob die Leiste nur nicht zu sehen ist.
        // Nachzusehen mit: adb logcat -s ELFIX | grep FOLGE
        Log.i(TAG, "FOLGE mess " + Folgen.kurz(adresse)
            + " " + Math.round(position) + "/" + Math.round(laufzeit) + "s"
            + " = " + Folgen.prozent(position, laufzeit) + "%"
            + " ended=" + beendet + " nah=" + nah + " ende=" + ende
            + " seitenLink=" + (seitenLink == null || seitenLink.isEmpty()
                ? "-" : Folgen.kurz(seitenLink)));
        naechsteFolgeBestimmen();
        if (spielerleiste == null) return;
        spielerleiste.setzeFortschritt(nah, ende);
    }

    /**
     * TV only: activate the focused player iframe.
     *
     * The hoster's player runs in a cross-origin iframe, so ELFIX cannot click inside it from
     * JavaScript, and VOE's play overlay does not react to Enter. What we can do is ask the top
     * document for the geometry of the element that currently has focus and deliver a real tap to
     * that spot -- the same thing a TV browser does. The coordinates come from the focused
     * element's own rect, never from a guess, and nothing happens unless an iframe is focused.
     */
    private void tvActivateFocusedFrame() {
        WebView webView = currentWebView();
        if (webView == null || !isTelevision()) return;
        webView.evaluateJavascript(
            "(function(){var a=document.activeElement;"
                + "if(!a||a.tagName!=='IFRAME')return '';"
                + "var r=a.getBoundingClientRect();"
                + "if(r.width<40||r.height<40)return '';"
                + "return Math.round(r.left+r.width/2)+','+Math.round(r.top+r.height/2);})()",
            value -> {
                String point = value == null ? "" : value.replace("\"", "").trim();
                if (point.isEmpty() || point.equals("null") || !point.contains(",")) return;
                String[] parts = point.split(",");
                try {
                    float density = getResources().getDisplayMetrics().density;
                    float x = Float.parseFloat(parts[0]) * density;
                    float y = Float.parseFloat(parts[1]) * density;
                    Log.i(TAG, "TV activate frame at css=" + point + " px=" + Math.round(x) + "," + Math.round(y));
                    dispatchTapOn(webView, x, y);
                    // Measure the player geometry a moment after playback should have begun.
                    webView.postDelayed(() -> logDomGeometry(webView, "tvActivate"), 6000);
                } catch (NumberFormatException malformed) {
                    Log.w(TAG, "TV activate frame: unusable rect " + point);
                }
            });
    }

    private void dispatchTapOn(WebView webView, float x, float y) {
        long now = SystemClock.uptimeMillis();
        MotionEvent down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0);
        MotionEvent up = MotionEvent.obtain(now, now + 60, MotionEvent.ACTION_UP, x, y, 0);
        webView.dispatchTouchEvent(down);
        webView.dispatchTouchEvent(up);
        down.recycle();
        up.recycle();
    }

    /** Tap the middle of the fullscreen video -- the player's own play/pause and controls target. */
    private void tapFullscreenCentre() {
        View view = fullscreenView;
        if (view == null) return;
        if (view.getWidth() <= 0 || view.getHeight() <= 0) {
            // Never tap an unmeasured view: the centre of a 0x0 view is the corner of the screen.
            Log.w(TAG, "Fullscreen tap skipped, view not laid out yet");
            return;
        }
        dispatchTapOnView(view, view.getWidth() / 2f, view.getHeight() / 2f);
    }

    private void dispatchTapOnView(View view, float x, float y) {
        long now = SystemClock.uptimeMillis();
        MotionEvent down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0);
        MotionEvent up = MotionEvent.obtain(now, now + 80, MotionEvent.ACTION_UP, x, y, 0);
        view.dispatchTouchEvent(down);
        view.dispatchTouchEvent(up);
        down.recycle();
        up.recycle();
    }

    private boolean handleFullscreenKey(KeyEvent event) {
        if (event.getAction() != KeyEvent.ACTION_DOWN) return false;
        int keyCode = event.getKeyCode();
        // Nach oben zum Live-Streifen der Watchparty. Das ist der einzige Weg
        // dorthin, solange das Video den Fokus hat - und er kostet nichts, wo
        // keine Runde laeuft: dann ist der Streifen unsichtbar und nimmt den
        // Fokus gar nicht erst an.
        if (keyCode == KeyEvent.KEYCODE_DPAD_UP && !mouseMode
            && spielerleiste != null && spielerleiste.hatFokus()) {
            // Aus der Leiste heraus wieder ins Bild. Ohne diesen Rueckweg
            // bliebe der Fokus unten haengen: die Knoepfe liegen auf der
            // Fensterdekoration, das Video darunter, und die Fokussuche findet
            // von einem zum anderen nicht von selbst.
            focusFullscreenPlayer();
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_DPAD_UP && !mouseMode
            && liveStreifen != null && !liveStreifen.istOffen() && liveStreifen.fokussieren()) {
            return true;
        }
        // Nach unten zur Wiedergabeleiste - "Naechste Folge" und Autoplay. Der
        // Gegenweg zu oben, und ebenso ohne Kosten: eine unsichtbare Leiste
        // nimmt den Fokus gar nicht erst an.
        if (keyCode == KeyEvent.KEYCODE_DPAD_DOWN && !mouseMode
            && spielerleiste != null && !spielerleiste.hatFokus() && spielerleiste.fokussieren()) {
            return true;
        }
        // Zurueck schliesst zuerst die ausgeklappten Details und nicht das
        // Vollbild - sonst faellt man beim Nachsehen, wer mitschaut, aus dem
        // Bild heraus.
        if (keyCode == KeyEvent.KEYCODE_BACK && liveStreifen != null && liveStreifen.zurueck()) {
            return true;
        }
        // OK reaches the player as a real tap on the middle of the video. Sending the key onwards
        // does not: the hoster runs in a cross-origin iframe. In mouse mode OK belongs to the cursor
        // instead, so it is left to handleMouseModeKey().
        if ((keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER
            || keyCode == KeyEvent.KEYCODE_SPACE) && !mouseMode) {
            // Steht der Fokus auf dem Streifen, gehoert OK ihm - sonst liesse
            // sich dort nichts oeffnen und nichts druecken. Dasselbe gilt fuer
            // die Wiedergabeleiste: ohne das waere "Naechste Folge" auf dem
            // Fernseher ein Knopf, den man zwar erreicht, aber nicht druecken
            // kann.
            if (liveStreifen != null && liveStreifen.hatFokus()) return false;
            if (spielerleiste != null && spielerleiste.hatFokus()) return false;
            tapFullscreenCentre();
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_SEARCH) {
            applyFullscreenSystemUi();
            return true;
        }
        return false;
    }

    /**
     * Den Fokus zurueck auf das Video im Vollbild.
     *
     * <p>Der Gegenweg zu {@link Spielerleiste#fokussieren()}. Ohne ihn bliebe
     * der Fokus in der Leiste stehen, und die Fernbedienung erreichte das Bild
     * nicht mehr - ein Fokusfang genau dort, wo er am meisten stoert.
     */
    private void focusFullscreenPlayer() {
        if (fullscreenView == null) return;
        fullscreenView.requestFocus();
    }

    /**
     * Put the hoster player into fullscreen from the remote.
     *
     * requestFullscreen() demands a transient user activation, and evaluateJavascript() on its own
     * does not carry one -- measured, the call comes back "Permissions check failed". The activation
     * cannot come from the key the user actually pressed either: claiming KEYCODE_5 here means
     * Chromium never sees it, and letting it through instead would have the player act on it (JW
     * Player, which VOE uses, seeks to 50% on "5").
     *
     * What does work is that *any* real key event delivered to the WebView grants an activation
     * inside the focused iframe, and that activation propagates up to the top document -- measured,
     * navigator.userActivation.isActive flips to true there. So an F12 is dispatched first, purely
     * to open that window: no player binds it (verified against VOE's JW Player, which ignored it
     * without pausing or seeking), while Chromium still counts it as user input. The request then
     * runs inside that window, retrying briefly because Chromium registers the key asynchronously.
     */
    private void enterPlayerFullscreen() {
        WebView webView = currentWebView();
        if (webView == null) return;
        // Go to the top of the page first. Fullscreen is entered from a known scroll position rather
        // than from wherever the page happened to be, so the state it comes back to is the same
        // every time. The player does not need to stay in view for this -- requestFullscreen() works
        // on an off-screen element, and the tap that starts playback lands on the full-screen video.
        webView.scrollTo(0, 0);
        long now = SystemClock.uptimeMillis();
        webView.dispatchKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_F12, 0));
        webView.dispatchKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_F12, 0));
        webView.evaluateJavascript(
            "(function(){"
                + "function area(el){var r=el.getBoundingClientRect();return r.width*r.height;}"
                + "function big(el){var r=el.getBoundingClientRect();return r.width>200&&r.height>150;}"
                + "function pick(sel){var out=Array.prototype.slice.call(document.querySelectorAll(sel))"
                    + ".filter(big).sort(function(a,b){return area(b)-area(a);});return out[0]||null;}"
                // A hoster that embeds its <video> in the page directly is fullscreened on the video
                // itself; the usual case is the player living in an iframe, which is what VOE does.
                + "var target=pick('video')||pick('iframe');"
                + "if(!target)return 'no-player';"
                + "var tries=0;"
                + "(function go(){"
                    + "target.requestFullscreen().catch(function(){"
                        + "if(++tries<10)setTimeout(go,100);"
                    + "});"
                + "})();"
                + "return 'requested '+target.tagName;"
            + "})();",
            value -> Log.i(TAG, "FS/playerRequest " + value)
        );
    }

    private boolean handleMouseModeKey(int keyCode) {
        if (keyCode == KeyEvent.KEYCODE_0 || keyCode == KeyEvent.KEYCODE_INFO || keyCode == KeyEvent.KEYCODE_PROG_RED) {
            toggleMouseMode();
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT) {
            moveMouseCursor(-mouseStep(), 0);
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
            moveMouseCursor(mouseStep(), 0);
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_DPAD_UP) {
            moveMouseCursor(0, -mouseStep());
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_DPAD_DOWN) {
            moveMouseCursor(0, mouseStep());
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_CHANNEL_UP || keyCode == KeyEvent.KEYCODE_PAGE_UP) {
            scrollActiveWebView(-dp(360));
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_CHANNEL_DOWN || keyCode == KeyEvent.KEYCODE_PAGE_DOWN) {
            scrollActiveWebView(dp(360));
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER) {
            tapMouseCursor();
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            toggleMouseMode();
            return true;
        }
        return false;
    }

    private void toggleMouseMode() {
        mouseMode = !mouseMode;
        boolean inFullscreen = fullscreenView != null;
        WebView webView = currentWebView();
        if (webView != null) {
            // Neither of these applies while a video is fullscreen: the page-side helpers address the
            // host document, the chrome is already gone, and pulling focus off the custom view would
            // take the remote away from the player.
            if (!inFullscreen) {
                installTvWebNavigation(webView);
                webView.requestFocus();
            }
            setMouseCursorVisible(mouseMode);
        }
        if (mouseMode && !inFullscreen) setChromeCollapsed(true, false);
        showToast(mouseMode ? "Mausmodus: D-Pad bewegen, OK klicken, 0/Info aus" : "Mausmodus aus");
    }

    private int mouseStep() {
        return dp(12);
    }

    /**
     * Where the cursor lives. In fullscreen that has to be the fullscreen container: it sits on the
     * window decor above everything else, so a cursor left in `content` would be hidden behind the
     * video. Coordinates are relative to whichever of the two is current.
     */
    private FrameLayout mouseCursorHost() {
        return fullscreenContainer != null ? fullscreenContainer : content;
    }

    private void ensureMouseCursor() {
        FrameLayout host = mouseCursorHost();
        if (host == null) return;
        if (mouseCursor == null) {
            mouseCursor = new View(this);
            GradientDrawable cursor = new GradientDrawable();
            cursor.setShape(GradientDrawable.OVAL);
            cursor.setColor(Color.rgb(229, 9, 20));
            cursor.setStroke(dp(3), Color.WHITE);
            mouseCursor.setBackground(cursor);
            mouseCursor.setFocusable(false);
            mouseCursor.setClickable(false);
            if (android.os.Build.VERSION.SDK_INT >= 21) mouseCursor.setElevation(dp(18));
        }
        if (mouseCursor.getParent() != host) {
            if (mouseCursor.getParent() instanceof ViewGroup) {
                ((ViewGroup) mouseCursor.getParent()).removeView(mouseCursor);
            }
            host.addView(mouseCursor, new FrameLayout.LayoutParams(dp(26), dp(26)));
            // Entering or leaving fullscreen changes the frame the cursor is measured in, so start
            // it from the middle instead of keeping a position that referred to the old one.
            mouseX = -1;
            mouseY = -1;
        }
        if (mouseX < 0 || mouseY < 0) {
            mouseX = Math.max(dp(24), host.getWidth() / 2f);
            mouseY = Math.max(dp(24), host.getHeight() / 2f);
        }
        mouseCursor.bringToFront();
        updateMouseCursor();
    }

    private void setMouseCursorVisible(boolean visible) {
        if (visible) {
            FrameLayout host = mouseCursorHost();
            if (host == null) return;
            if (host.getWidth() <= 0 || host.getHeight() <= 0) {
                host.post(() -> setMouseCursorVisible(true));
                return;
            }
            ensureMouseCursor();
            if (mouseCursor != null) mouseCursor.setVisibility(View.VISIBLE);
        } else if (mouseCursor != null) {
            mouseCursor.setVisibility(View.GONE);
        }
    }

    private void updateMouseCursor() {
        if (mouseCursor == null || mouseCursorHost() == null) return;
        FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) mouseCursor.getLayoutParams();
        params.leftMargin = Math.round(mouseX - dp(13));
        params.topMargin = Math.round(mouseY - dp(13));
        mouseCursor.setLayoutParams(params);
    }

    private void moveMouseCursor(int dx, int dy) {
        FrameLayout host = mouseCursorHost();
        WebView webView = currentWebView();
        if (host == null || webView == null) return;
        ensureMouseCursor();
        int width = Math.max(dp(32), host.getWidth());
        int height = Math.max(dp(32), host.getHeight());
        mouseX = Math.max(dp(10), Math.min(width - dp(10), mouseX + dx));
        mouseY = Math.max(dp(10), Math.min(height - dp(10), mouseY + dy));
        updateMouseCursor();
        // Nudging the page at the edges only makes sense while the page is what is on screen; in
        // fullscreen the video fills the panel and there is nothing to scroll to.
        if (fullscreenView != null) return;
        if (dy < 0 && mouseY <= dp(26)) scrollActiveWebView(-dp(80));
        if (dy > 0 && mouseY >= height - dp(26)) scrollActiveWebView(dp(80));
        if (dx < 0 && mouseX <= dp(20)) webView.scrollBy(-dp(70), 0);
        if (dx > 0 && mouseX >= width - dp(20)) webView.scrollBy(dp(70), 0);
    }

    /**
     * Page scrolling (mouse mode, and the 8/2 keys) goes through the WebView's own view scroll and
     * nowhere else.
     *
     * It used to additionally ask the page to scroll itself, which was wrong twice over. The JS side
     * takes CSS pixels while `dy` is device pixels, so on a 2x panel one page-down moved
     * 360 + 720 = 1080 CSS px instead of the intended 360 -- measured on AniWorld, y=771 -> y=1851.
     * Worse, app and page then drove the same scroll at the same time, one instantly and one
     * animated: while the two offsets disagreed the compositor kept drawing the video and image
     * layers at a position that no longer matched their boxes, which is what displaced the picture
     * inside the player. The horizontal edge scroll in moveMouseCursor() already worked this way.
     */
    private void scrollActiveWebView(int dy) {
        if (fullscreenView != null) return;
        WebView webView = currentWebView();
        if (webView == null) return;
        webView.scrollBy(0, dy);
    }

    private void tapMouseCursor() {
        WebView webView = currentWebView();
        if (webView == null) return;
        ensureMouseCursor();
        if (fullscreenView != null) {
            // In fullscreen the video is rendered by the custom view on the window decor, not by the
            // WebView underneath, so that is where the tap has to go -- Chromium routes it on into
            // the hoster frame and the player's own controls answer it. The synthetic DOM click
            // below is skipped: it runs in the host document, which cannot reach into that frame.
            dispatchTapOnView(fullscreenView, mouseX, mouseY);
            return;
        }
        dispatchTapOnView(webView, mouseX, mouseY);
        runTvMouseCommand("click", Math.round(mouseX), Math.round(mouseY));
    }

    private void runTvMouseCommand(String command, int dx, int dy) {
        WebView webView = currentWebView();
        if (webView == null) return;
        installTvWebNavigation(webView);
        webView.evaluateJavascript(
            "window.__elflixTvMouse&&window.__elflixTvMouse('" + command + "'," + dx + "," + dy + ");",
            null
        );
    }

    private void togglePlayback() {
        spielerBefehl("m.paused?m.play():m.pause()");
    }

    /**
     * Play und Pause der Fernbedienung - getrennt, nicht als Umschalter.
     *
     * <p>Eine Fernbedienung mit eigenen Tasten fuer Play und Pause meint sie
     * auch getrennt: wer auf ein laufendes Video PLAY drueckt, will es laufen
     * lassen und nicht anhalten. Nur PLAY_PAUSE schaltet um.
     */
    private void spielerAbspielen() {
        spielerBefehl("m.play()");
    }

    private void spielerAnhalten() {
        spielerBefehl("m.pause()");
    }

    /**
     * Einen Befehl an das Video schicken - und zwar dorthin, wo es liegt.
     *
     * <p>Vorher ging das ueber {@code evaluateJavascript}, und das erreicht nur
     * das Hauptdokument. Bei AniWorld und s.to liegt das Video im Rahmen des
     * Hosters: die Taste tat schlicht nichts, solange der Player eingebettet
     * war. Ueber {@link Rahmen} geht der Befehl in jeden Rahmen mit Video.
     *
     * <p>Und weil er dort ein echtes {@code play}- oder {@code pause}-Ereignis
     * ausloest, meldet der Horcher der Watchparty ihn von selbst weiter. Die
     * Fernbedienung braucht dafuer keine eigene Leitung - sie tut dasselbe wie
     * ein Klick auf den Player.
     */
    private void spielerBefehl(String ausdruck) {
        String skript = "(function(){var t=Array.prototype.slice.call("
            + "document.querySelectorAll('video,audio')).filter(function(m){return Number(m.duration)>0;});"
            + "if(!t.length)t=Array.prototype.slice.call(document.querySelectorAll('video,audio'));"
            + "t.forEach(function(m){try{" + ausdruck + ";}catch(e){}});return t.length;})();";
        WebView webView = currentWebView();
        if (webView == null) return;
        int erreicht = rahmen == null ? 0 : rahmen.anSpieler(webView, skript);
        // Der Rueckfall fuer Seiten, deren Player im Hauptdokument liegt - und
        // fuer WebViews ohne Rahmenzugriff.
        if (erreicht == 0) webView.evaluateJavascript(skript, null);
    }

    private void focusSearch() {
        if (searchInput == null) return;
        searchInput.requestFocus();
        searchInput.setSelection(searchInput.getText().length());
        showToast("Suche fokussiert");
    }

    private boolean focusActiveProviderButton() {
        if (activeProvider == null) return false;
        Button button = providerButtons.get(activeProvider.id);
        if (button == null) return false;
        button.requestFocus();
        return true;
    }

    private boolean focusActiveWebView() {
        WebView webView = currentWebView();
        if (webView == null || webView.getParent() == null) return false;
        webView.requestFocus();
        showToast("Website-Steuerung");
        return true;
    }

    private boolean isActiveWebViewFocused() {
        WebView webView = currentWebView();
        return webView != null && webView.hasFocus();
    }

    private boolean isChromeFocused() {
        View focused = getCurrentFocus();
        return focused != null && appChrome != null && isDescendant(appChrome, focused);
    }

    private boolean isDescendant(View parent, View child) {
        View current = child;
        while (current != null) {
            if (current == parent) return true;
            Object next = current.getParent();
            current = next instanceof View ? (View) next : null;
        }
        return false;
    }

    private WebView currentWebView() {
        return activeProvider == null ? null : webViews.get(activeProvider.id);
    }

    private void cycleProvider(int direction) {
        if (providers == null || providers.isEmpty()) return;
        int index = activeProvider == null ? 0 : providers.indexOf(activeProvider);
        if (index < 0) index = 0;
        int nextIndex = (index + direction + providers.size()) % providers.size();
        Provider provider = providers.get(nextIndex);
        openProvider(provider, provider.lastUrl.isEmpty() ? provider.startUrl : provider.lastUrl);
    }

    private void showFullscreen(View view, WebChromeClient.CustomViewCallback callback) {
        // Idempotent: a second onShowCustomView() while already fullscreen must not stack views.
        if (fullscreenView != null) {
            Log.w(TAG, "Fullscreen requested while already fullscreen, rejecting duplicate");
            if (callback != null) callback.onCustomViewHidden();
            return;
        }
        // Chromium hands us a fresh container, but if it ever arrives already attached, detaching
        // it first is what prevents "The specified child already has a parent" from killing the app.
        if (view.getParent() instanceof ViewGroup) {
            ((ViewGroup) view.getParent()).removeView(view);
        }
        Log.i(TAG, "Fullscreen entered provider=" + (activeProvider == null ? "-" : activeProvider.id));
        // Take the reading position here, synchronously, off the view itself. Asking the page for
        // window.scrollY instead loses races: evaluateJavascript() only reaches the document a few
        // milliseconds later, and Chromium resets the document scroll while it enters fullscreen --
        // measured on AniWorld, Java read 1542 device px at this very point while the JS that ran
        // moments later already saw 0, and the exit then "restored" the page to the top.
        WebView scrollHost = currentWebView();
        fullscreenScrollX = scrollHost == null ? 0 : scrollHost.getScrollX();
        fullscreenScrollY = scrollHost == null ? 0 : scrollHost.getScrollY();
        logLayoutState("beforeEnter");
        // Remember what the app was allowed to do before, so exiting restores exactly that instead
        // of leaving the phone stuck in a forced orientation.
        orientationBeforeFullscreen = getRequestedOrientation();
        if (!isTelevision()) {
            // SENSOR_LANDSCAPE: rotate into landscape immediately and stay there, while still
            // letting the user flip between the two landscape directions. Plain LANDSCAPE would
            // ignore how the phone is actually being held.
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        }
        fullscreenView = view;
        fullscreenHostWebView = currentWebView();
        fullscreenCallback = callback;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Read and pin the reading position first. Hiding the chrome below grows the WebView by the
        // toolbar height, and both of these run as evaluateJavascript(), i.e. a moment later on the
        // page -- so capturing afterwards would read whatever that resize left behind, and near the
        // end of a document the larger viewport clamps the offset down before it is ever recorded.
        logDomGeometry(fullscreenHostWebView, "onShowCustomView");
        lockFullscreenScrolling(fullscreenHostWebView);
        // The chrome and the bottom navigation deliberately stay where they are. They are completely
        // covered by the opaque fullscreen container on the window decor, so hiding them buys no
        // pixels -- but it resizes the WebView underneath, and resizing a scrolled WebView is what
        // moves the page. Same reason the inset listener is frozen for the duration.
        view.setBackgroundColor(Color.BLACK);
        view.setFocusable(true);
        view.setFocusableInTouchMode(true);
        view.setClickable(true);

        // The video must NOT go into `content`: that container sits inside the app's LinearLayout
        // below the chrome and carries the window-inset padding, so the player inherited a reduced
        // viewport and ended up rendering into only part of the screen. Attaching an own container
        // directly to the window decor gives the player the raw display area, independent of any
        // ELFIX toolbar, navigation or inset padding.
        fullscreenContainer = new FrameLayout(this);
        fullscreenContainer.setBackgroundColor(Color.BLACK);
        fullscreenContainer.setFitsSystemWindows(false);
        // Drop the system bars before the container is measured. Otherwise the decor still reports
        // the inset content frame for the first layout pass and the player briefly lands below y=0.
        applyFullscreenSystemUi();
        ((ViewGroup) getWindow().getDecorView()).addView(fullscreenContainer,
            new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        fullscreenContainer.addView(view, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // Der Live-Streifen zieht mit. Im Vollbild liegt das Video in einem
        // eigenen Rahmen auf der Fensterdekoration; ein Streifen, der unten in
        // der Oberflaeche haengen bleibt, waere schlicht nicht zu sehen - und
        // dann wuesste man ausgerechnet beim Schauen nicht mehr, wer mitschaut.
        if (liveStreifen != null) liveStreifen.inVollbild(fullscreenContainer);
        // Und die Wiedergabeleiste. Sie liegt unten rechts ueber der
        // Bedienleiste des Hosters und kommt und geht mit ihr.
        if (spielerleiste != null) spielerleiste.inVollbild(fullscreenContainer);
        fullscreenContainer.bringToFront();
        // Und gleich danach der Vorhang wieder darueber. Beide haengen an der
        // Fensterdekoration; wer zuletzt nach vorn geholt wird, liegt oben.
        // Ohne diese Zeile waere ausgerechnet der Wechsel ins Vollbild das
        // Einzige, was der Zuschauer vom ganzen Start zu sehen bekaeme.
        if (startvorhang != null) startvorhang.hebe();
        view.requestFocus();
        // The cursor has to move up into the new container, otherwise it stays buried under the video.
        if (mouseMode) setMouseCursorVisible(true);
        view.post(() -> logLayoutState("afterEnter"));
        logFullscreenDimensions(view);
        // Der letzte Schritt: das Vollbild steht, das Video laeuft schon (das
        // war die Bedingung dafuer, ueberhaupt hierher zu kommen). Der kurze
        // Nachlauf ist kein Zieren - der Rahmen ist erst nach dem naechsten
        // Zeichnen wirklich gefuellt, und ohne ihn wuerde der Vorhang auf ein
        // schwarzes Bild aufgehen.
        view.postDelayed(() -> startPhaseMelden("laeuft"), VOLLBILD_NACHLAUF_MS);
    }

    /**
     * Full fullscreen geometry dump, measured after layout. Written so the cause of a wrong video
     * viewport can be read off the numbers instead of guessed: if decor/container/customView are all
     * the panel size, the problem is inside the page, and the DOM section says which element it is.
     */
    private void logFullscreenDimensions(View customView) {
        customView.post(() -> {
            android.util.DisplayMetrics metrics = getResources().getDisplayMetrics();
            Configuration config = getResources().getConfiguration();
            Log.i(TAG, "FS/display density=" + metrics.density + " densityDpi=" + metrics.densityDpi
                + " px=" + metrics.widthPixels + "x" + metrics.heightPixels
                + " dp=" + config.screenWidthDp + "x" + config.screenHeightDp
                + " bounds=" + currentWindowBounds());

            logViewGeometry("decor", getWindow().getDecorView());
            logViewGeometry("container", fullscreenContainer);
            logViewGeometry("customView", customView);
            logViewGeometry("webview", fullscreenHostWebView);

            int level = 0;
            for (View v = customView; v != null; level += 1) {
                logViewGeometry("parent[" + level + "]", v);
                Object parent = v.getParent();
                v = parent instanceof View ? (View) parent : null;
            }
            logVideoSurfaces(customView, 0);
            checkFullscreenInvariant(customView);
            logDomGeometry(fullscreenHostWebView, "fullscreen");
        });
    }

    /**
     * The one property fullscreen has to satisfy no matter how far the page was scrolled: the video
     * covers the whole panel starting at the window origin. Checked against the real window bounds
     * rather than a hard-coded resolution, so it also holds on a 720p panel or in a resized window.
     */
    private void checkFullscreenInvariant(View customView) {
        View decor = getWindow().getDecorView();
        for (View v = customView; v != null && v != decor; ) {
            if (v.getX() != 0f || v.getY() != 0f
                || v.getWidth() != decor.getWidth() || v.getHeight() != decor.getHeight()) {
                Log.w(TAG, "FS/invariant VIOLATED at " + v.getClass().getSimpleName()
                    + " xy=" + v.getX() + "," + v.getY()
                    + " size=" + v.getWidth() + "x" + v.getHeight()
                    + " decor=" + decor.getWidth() + "x" + decor.getHeight());
                return;
            }
            Object parent = v.getParent();
            v = parent instanceof View ? (View) parent : null;
        }
        Log.i(TAG, "FS/invariant ok: customView..decor all at 0,0 and "
            + decor.getWidth() + "x" + decor.getHeight());
    }

    /**
     * One line per fullscreen transition point, so the question "does fullscreen move the page?" can
     * be answered from a logcat off any device instead of from the emulator alone. The emulator is
     * not enough: an Android TV AVD reports app=1920x1080 against a 1920x1080 display, i.e. zero
     * system-bar insets, so every inset-driven relayout below is dead code there.
     */
    private void logLayoutState(String phase) {
        WebView webView = fullscreenHostWebView != null ? fullscreenHostWebView : currentWebView();
        StringBuilder sb = new StringBuilder("FS/state ").append(phase);
        if (webView == null) {
            Log.i(TAG, sb.append(" webview=null").toString());
            return;
        }
        sb.append(" scrollY=").append(webView.getScrollY())
          .append(" scrollX=").append(webView.getScrollX())
          .append(" webview=").append(webView.getWidth()).append("x").append(webView.getHeight())
          .append(" contentPad=").append(content.getPaddingTop()).append("/").append(content.getPaddingBottom())
          .append(" content=").append(content.getWidth()).append("x").append(content.getHeight())
          .append(" chromeVis=").append(appChrome == null ? "-" : appChrome.getVisibility())
          .append(" chromePad=").append(chromeHolder == null ? -1 : chromeHolder.getPaddingTop())
          .append(" chrome=").append(chromeHolder == null ? "-" : chromeHolder.getHeight())
          .append(" fitsSystemWindows=").append(content.getFitsSystemWindows())
          .append(" container=").append(fullscreenContainer == null ? "-"
              : fullscreenContainer.getWidth() + "x" + fullscreenContainer.getHeight()
                + "@" + fullscreenContainer.getX() + "," + fullscreenContainer.getY());
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            WindowInsets insets = getWindow().getDecorView().getRootWindowInsets();
            if (insets != null) {
                android.graphics.Insets bars = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                sb.append(" insets=").append(bars.left).append(",").append(bars.top)
                  .append(",").append(bars.right).append(",").append(bars.bottom)
                  .append(" statusBarVisible=").append(insets.isVisible(WindowInsets.Type.statusBars()))
                  .append(" navBarVisible=").append(insets.isVisible(WindowInsets.Type.navigationBars()));
            }
            sb.append(" decorFits=").append(getWindow().getDecorView().getFitsSystemWindows());
        }
        sb.append(" orientation=").append(getResources().getConfiguration().orientation);
        Log.i(TAG, sb.toString());
        webView.evaluateJavascript(
            "JSON.stringify({y:window.scrollY,inner:[innerWidth,innerHeight],"
                + "doc:document.scrollingElement.scrollHeight,dpr:window.devicePixelRatio})",
            value -> Log.i(TAG, "FS/state " + phase + " page=" + value));
    }

    private String currentWindowBounds() {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            return String.valueOf(getWindowManager().getCurrentWindowMetrics().getBounds());
        }
        return "n/a";
    }

    private void logViewGeometry(String label, View view) {
        if (view == null) {
            Log.i(TAG, "FS/" + label + " = null");
            return;
        }
        android.graphics.Rect visible = new android.graphics.Rect();
        boolean hasVisible = view.getGlobalVisibleRect(visible);
        ViewGroup.LayoutParams lp = view.getLayoutParams();
        StringBuilder sb = new StringBuilder("FS/").append(label)
            .append(" cls=").append(view.getClass().getSimpleName())
            .append(" size=").append(view.getWidth()).append("x").append(view.getHeight())
            .append(" measured=").append(view.getMeasuredWidth()).append("x").append(view.getMeasuredHeight())
            .append(" lp=").append(lp == null ? "-" : lp.width + "x" + lp.height)
            .append(" xy=").append(view.getX()).append(",").append(view.getY())
            .append(" scale=").append(view.getScaleX()).append(",").append(view.getScaleY())
            .append(" trans=").append(view.getTranslationX()).append(",").append(view.getTranslationY())
            .append(" scroll=").append(view.getScrollX()).append(",").append(view.getScrollY())
            .append(" pad=").append(view.getPaddingLeft()).append(",").append(view.getPaddingTop())
            .append(",").append(view.getPaddingRight()).append(",").append(view.getPaddingBottom())
            .append(" visRect=").append(hasVisible ? visible.toShortString() : "none");
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            sb.append(" clipChildren=").append(group.getClipChildren())
              .append(" clipToPadding=").append(group.getClipToPadding());
        }
        Log.i(TAG, sb.toString());
    }

    /** The actual video surface can be mis-sized even when every container is correct. */
    private void logVideoSurfaces(View view, int depth) {
        if (view instanceof android.view.SurfaceView || view instanceof android.view.TextureView) {
            logViewGeometry("surface@depth" + depth, view);
        }
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i += 1) {
                logVideoSurfaces(group.getChildAt(i), depth + 1);
            }
        }
    }

    /**
     * Page-side geometry. Runs in the top document of the host WebView; a hoster inside a
     * cross-origin iframe cannot be inspected from here, and the output says so explicitly rather
     * than silently reporting nothing.
     */
    private void logDomGeometry(WebView host, String phase) {
        if (host == null) return;
        Log.i(TAG, "FS/scroll phase=" + phase
            + " webViewScroll=" + host.getScrollX() + "," + host.getScrollY());
        host.evaluateJavascript(
            "(function(){"
                + "function box(el){if(!el)return null;var r=el.getBoundingClientRect();"
                + "return{tag:el.tagName,id:el.id||'',cls:(''+(el.className||'')).slice(0,60),"
                + "rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)],"
                + "client:[el.clientWidth,el.clientHeight],offset:[el.offsetWidth,el.offsetHeight]};}"
                + "var fs=document.fullscreenElement||document.webkitFullscreenElement||null;"
                + "var out={phase:'" + phase + "',url:location.href,inner:[innerWidth,innerHeight],"
                + "scroll:[window.scrollX,window.scrollY],"
                + "scrollingElement:[document.scrollingElement.scrollLeft,document.scrollingElement.scrollTop,"
                + "document.scrollingElement.scrollHeight],"
                + "client:[document.documentElement.clientWidth,document.documentElement.clientHeight],"
                + "dpr:window.devicePixelRatio,fullscreenElement:box(fs),videos:[],iframes:[]};"
                + "Array.prototype.slice.call(document.querySelectorAll('video')).forEach(function(v){"
                + "var b=box(v);b.videoWH=[v.videoWidth,v.videoHeight];b.paused=v.paused;"
                + "var cs=getComputedStyle(v);b.css=[cs.height,cs.maxHeight,cs.objectFit,cs.position,cs.transform];"
                + "out.videos.push(b);});"
                + "Array.prototype.slice.call(document.querySelectorAll('iframe')).forEach(function(f){"
                + "var b=box(f);b.src=(f.src||'').slice(0,80);"
                + "var cs=getComputedStyle(f);b.css=[cs.height,cs.maxHeight,cs.position,cs.transform];"
                + "out.iframes.push(b);});"
                + "return JSON.stringify(out);"
            + "})();",
            value -> Log.i(TAG, "FS/dom " + value));
    }

    private void applyFullscreenSystemUi() {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            getWindow().getInsetsController().hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            getWindow().getInsetsController().setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }
    }

    private void hideFullscreen() {
        if (fullscreenView == null) return;
        Log.i(TAG, "Fullscreen exited");
        logLayoutState("beforeExit");
        // Zuerst den Live-Streifen zurueckholen: gleich wird der Vollbild-Rahmen
        // samt allen Kindern abgeraeumt, und danach waere er weg.
        if (liveStreifen != null) liveStreifen.inVollbild(null);
        if (spielerleiste != null) spielerleiste.inVollbild(null);
        if (fullscreenContainer != null) {
            fullscreenContainer.removeAllViews();
            if (fullscreenContainer.getParent() instanceof ViewGroup) {
                ((ViewGroup) fullscreenContainer.getParent()).removeView(fullscreenContainer);
            }
            fullscreenContainer = null;
        } else {
            content.removeView(fullscreenView);
        }
        fullscreenView = null;
        final WebView host = fullscreenHostWebView;
        fullscreenHostWebView = null;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Nothing to un-hide: the chrome was never taken away, so there is no relayout here either.
        // removeAllViews() above took the cursor down with the container; put it back over the page.
        if (mouseMode) setMouseCursorVisible(true);
        // onCustomViewHidden() is what actually takes the page out of fullscreen, and only after
        // that does the fullscreen element leave its position:fixed layout. Unlocking before this
        // call restored the scroll offset against the *fullscreen* layout -- measured on AniWorld:
        // entering at y=734 came back as y=0 once and y=1210 (734 + one viewport) the next time.
        if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
        fullscreenCallback = null;
        unlockFullscreenScrolling(host);
        if (host != null) {
            // After the restore window has closed: report where the page ended up, and what the
            // restore had to correct along the way.
            host.post(() -> logLayoutState("afterExit"));
            // The drift watchdog: fullscreen must leave the view scroll exactly where it found it.
            // Reported, never corrected -- if this ever fires, the layout cause is back and wants
            // fixing at the source rather than papering over.
            final int expected = fullscreenScrollY;
            host.postDelayed(() -> {
                int drift = host.getScrollY() - expected;
                if (drift != 0) {
                    Log.w(TAG, "FS/drift scrollY moved by " + drift + "px across fullscreen"
                        + " (before=" + expected + " after=" + host.getScrollY() + ")");
                } else {
                    Log.i(TAG, "FS/drift none, scrollY held at " + expected);
                }
                logLayoutState("afterExitSettled");
                logDomGeometry(host, "afterExit");
            }, 900);
        }
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(true);
            getWindow().getInsetsController().show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
        } else {
            getWindow().getDecorView().setSystemUiVisibility(0);
        }
        // Release the landscape lock last: the resulting configuration change must not find a
        // half-torn-down fullscreen state. The WebView stays attached to `content` throughout, so
        // the page is neither reloaded nor re-created by the rotation.
        if (!isTelevision()) {
            setRequestedOrientation(orientationBeforeFullscreen);
            orientationBeforeFullscreen = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        }
    }

    private void lockFullscreenScrolling(WebView webView) {
        if (webView == null) return;
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.evaluateJavascript(
            "(function(){"
                + "if(window.__elflixFullscreenLock)return;"
                // Style state only -- the scroll offset is captured in showFullscreen(), because by
                // the time this script runs the page may already have been scrolled to the top.
                + "window.__elflixFullscreenLock={html:document.documentElement.style.overflow||'',body:document.body.style.overflow||'',bodyTouch:document.body.style.touchAction||''};"
                + "document.documentElement.style.overflow='hidden';"
                + "document.body.style.overflow='hidden';"
                + "document.body.style.touchAction='none';"
                + "function block(e){if(!document.fullscreenElement&&!document.webkitFullscreenElement)return;var k=e.key||'';if(e.type==='touchmove'||e.type==='wheel'||/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End| )$/.test(k)){e.preventDefault();e.stopPropagation();}}"
                + "window.__elflixFullscreenBlock=block;"
                + "addEventListener('wheel',block,{passive:false,capture:true});"
                + "addEventListener('touchmove',block,{passive:false,capture:true});"
                + "addEventListener('keydown',block,true);"
            + "})();",
            null
        );
    }

    /**
     * Undo the lock. It deliberately does *not* scroll the page back.
     *
     * Forcing the offset back with a scrollTo() was the earlier fix, and it was the wrong one: it hid
     * a drift instead of removing it, and on a page that reflows while the video is up it would fight
     * the page's own layout. The offset is now simply never disturbed -- fullscreen no longer resizes
     * the WebView -- so there is nothing to put back. What stays is a watchdog that reports drift
     * without touching it, so a regression shows up as a number in the log on any device.
     */
    private void unlockFullscreenScrolling(WebView webView) {
        if (webView == null) return;
        webView.setVerticalScrollBarEnabled(true);
        webView.setHorizontalScrollBarEnabled(true);
        webView.setOverScrollMode(View.OVER_SCROLL_IF_CONTENT_SCROLLS);
        webView.evaluateJavascript(
            "(function(){"
                + "var s=window.__elflixFullscreenLock;if(!s)return;"
                + "document.documentElement.style.overflow=s.html;"
                + "document.body.style.overflow=s.body;"
                + "document.body.style.touchAction=s.bodyTouch;"
                + "if(window.__elflixFullscreenBlock){"
                    + "removeEventListener('wheel',window.__elflixFullscreenBlock,true);"
                    + "removeEventListener('touchmove',window.__elflixFullscreenBlock,true);"
                    + "removeEventListener('keydown',window.__elflixFullscreenBlock,true);"
                + "}"
                + "delete window.__elflixFullscreenBlock;"
                + "delete window.__elflixFullscreenLock;"
                + "return 'unlocked at '+Math.round(window.scrollY);"
            + "})();",
            value -> Log.i(TAG, "FS/unlock " + value)
        );
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private boolean isCompactWidth() {
        return getResources().getConfiguration().screenWidthDp < 600;
    }

    /**
     * Android TV / Leanback device. Used to keep remote-control affordances (focus scaling, mouse
     * mode, large hit areas) on TV while phones get touch-sized, denser layouts -- without forking
     * the screens themselves.
     */
    private boolean isTelevision() {
        if (television == null) {
            boolean tv = false;
            UiModeManager uiMode = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
            if (uiMode != null && uiMode.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) {
                tv = true;
            }
            if (!tv && getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK)) {
                tv = true;
            }
            television = tv;
        }
        return television;
    }

    /** Minimum comfortable hit area: 48dp is the Material touch target, TV sits a bit larger. */
    private int touchTargetDp() {
        return isTelevision() ? 48 : 46;
    }

    private int pagePaddingHorizontalDp() {
        return isCompactWidth() ? 18 : 42;
    }

    private int pagePaddingVerticalDp() {
        return isCompactWidth() ? 20 : 34;
    }

    /** Landscape phones have plenty of width but very little height to spend on a headline. */
    private boolean isShortHeight() {
        return getResources().getConfiguration().screenHeightDp < 480;
    }

    private int heroTextSp() {
        if (isShortHeight()) return 24;
        return isCompactWidth() ? 27 : 42;
    }

    private int providerCardWidthDp() {
        return isCompactWidth() ? 128 : 154;
    }

    private int providerCardHeightDp() {
        return isCompactWidth() ? 54 : 56;
    }

    /**
     * On a phone the home screen already lists the providers as cards, so also showing the tab rail
     * there would present the same three items twice on one screen. The rail is what you switch with
     * once a provider is open, so it appears from then on. TV keeps it always: the rail is the
     * primary D-pad target there.
     */
    private void updateProviderRailVisibility() {
        if (providerRailScroll == null) return;
        boolean show = isTelevision() || activeProvider != null;
        providerRailScroll.setVisibility(show ? View.VISIBLE : View.GONE);
        if (providerRailDivider != null) providerRailDivider.setVisibility(show ? View.VISIBLE : View.GONE);
    }

    private void goBackInProvider() {
        WebView webView = currentWebView();
        if (webView != null && webView.canGoBack()) webView.goBack();
        else showHome();
    }

    private static String refererOf(WebResourceRequest request) {
        Map<String, String> headers = request.getRequestHeaders();
        if (headers == null) return null;
        String referer = headers.get("Referer");
        return referer != null ? referer : headers.get("referer");
    }

    /** Host only -- full URLs can carry session tokens that must not reach the log. */
    private static String safeHost(String url) {
        if (url == null || url.isEmpty()) return "-";
        try {
            String host = android.net.Uri.parse(url).getHost();
            return host == null ? "-" : host;
        } catch (Exception malformed) {
            return "-";
        }
    }

    /**
     * Die zuletzt vollstaendig geladene, gueltige Seite je Anbieter.
     *
     * <p>Der Rueckweg, wenn im Verlauf nichts Brauchbares mehr steht. Bewusst
     * je Anbieter und nicht global: die Anbieter haben eigene WebViews und
     * eigene Verlaeufe, und ein Rueckwurf auf die Seite eines anderen waere
     * schlimmer als die weisse Seite.
     */
    private final Map<String, String> letzteGueltigeSeite = new HashMap<>();

    private volatile Boolean debugBau;

    /**
     * Ob dies ein Debug-Bau ist.
     *
     * <p>Ueber das Flag der Anwendung und nicht ueber {@code BuildConfig}:
     * dessen Erzeugung ist beim Android-Plugin abschaltbar und hier gar nicht
     * eingeschaltet. Das Flag setzt Gradle bei jedem Debug-Bau selbst.
     */
    private boolean istDebugBau() {
        if (debugBau == null) {
            debugBau = (getApplicationInfo().flags
                & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        }
        return debugBau;
    }

    /**
     * Eine Zeile ueber eine Entscheidung des Blockers - nur im Debug-Bau.
     *
     * <p>Es steht ausschliesslich der Wirt darin. Pfad, Abfrage und Fragment
     * bleiben draussen: dort tragen diese Seiten Sitzungskennungen, und ein
     * Protokoll, das die mitschreibt, ist ein Leck und keine Diagnose.
     *
     * @param rahmen "main" oder "sub" - Hauptnavigation oder Unterressource
     * @param art    "navigation", "weiterleitung", "popup", "anfrage", "rettung"
     * @param aktion "erlaubt" oder "blockiert"
     * @param grund  warum genau
     */
    private void spur(String rahmen, String url, String art, String aktion, String grund) {
        if (!istDebugBau()) return;
        Log.d(TAG, "ELFIX-Nav rahmen=" + rahmen + " art=" + art
            + " wirt=" + safeHost(url) + " aktion=" + aktion + " grund=" + grund);
    }

    /**
     * Eine gesperrte Hauptnavigation vermerken - ohne ein Wort auf dem Schirm.
     *
     * <p>Hier stand bis hierher ein Toast ("Weiterleitung blockiert", "Popup
     * blockiert", "Externer Link blockiert"). Er war als Erklaerung gedacht
     * und ist als Stoerung angekommen: eine Werbekette versucht es in
     * Schueben, und auf einem Fernseher steht die Meldung dann quer ueber dem
     * Bild, waehrend eine Folge laeuft. Erklaert hat sie nichts - wer sie
     * liest, kann nichts damit anfangen, denn die Sperre ist genau das, was
     * ELFIX tun soll.
     *
     * <p>Gesperrt wird deshalb unveraendert weiter; nur die Bekanntgabe ist
     * weg. Was passiert ist, steht im Debug-Bau in {@link #spur} - mit Wirt,
     * Art und Grund, und damit fuer eine Fehlersuche mehr wert als der Toast
     * es je war. Die Bremse in der Wache
     * ({@link Navigationswache#meldungFaellig}) bleibt fuer die Faelle, in
     * denen eine <em>Zaehlung</em> gebraucht wird - sie bremst jetzt das
     * Protokoll statt der Meldung, und das ist der Grund, warum eine gesperrte
     * Werbekette das Logcat nicht mehr flutet.
     */
    private void sperreMelden(WebView view, String url, Provider provider, String grund) {
        if (wache.meldungFaellig(safeHost(url), SystemClock.uptimeMillis())) {
            spur("main", url, "sperre", "blockiert", grund);
        }
        nachSperrePruefen(view, provider);
    }

    /**
     * Was nach einer gesperrten Hauptnavigation zu tun bleibt.
     *
     * <p>Zwei Dinge, und beide waren vorher nicht da.
     *
     * <p><b>Die Ladeschicht.</b> Sie wird von {@code onPageFinished} abgeraeumt.
     * Eine abgebrochene Navigation liefert diesen Rueckruf nie - also blieb
     * "&lt;Anbieter&gt; wird geladen ..." stehen, bis jemand den Anbieter
     * wechselte. Das war die eine Haelfte des gemeldeten Fehlers.
     *
     * <p><b>Der Blick danach.</b> Erst im naechsten Durchlauf: hier ist
     * Chromium noch mitten im Abbruch, und {@code getUrl()} traegt bis dahin
     * noch die Adresse, die gerade verworfen wird.
     */
    private void nachSperrePruefen(WebView view, Provider provider) {
        if (view == null || provider == null) return;
        if (provider == activeProvider) hideProviderLoading();
        view.post(() -> rettungWennGestrandet(view, provider));
    }

    /**
     * Zurueck auf die letzte gueltige Seite, wenn gar keine mehr dasteht.
     *
     * <p>Das Sicherheitsnetz, nicht die Reparatur: die Reparatur ist, dass eine
     * Werbeweiterleitung jetzt gesperrt wird, <em>waehrend</em> die Folgenseite
     * noch steht (siehe {@link Navigationswache}). Hier geht es nur noch um
     * das, was uebrigbleibt - ein {@code about:blank}, das ein
     * {@code window.open()} ohne Adresse hinterlassen hat, oder ein
     * Hauptrahmen, in dem ueberhaupt kein Dokument steht.
     *
     * <p>Zurueckgeholt wird ueber den Verlauf, nicht ueber ein Neuladen: der
     * Verlauf weiss noch, welcher Eintrag dem Anbieter gehoerte, und die Seite
     * kommt dann mitsamt ihrer Stelle zurueck. Gesucht wird der neueste
     * erstparteiliche Eintrag und nicht einfach der vorige - eine Werbekette
     * hinterlaesst mehrere, und der vorige waere wieder einer davon.
     */
    private void rettungWennGestrandet(WebView view, Provider provider) {
        if (view == null || provider == null) return;
        String aktuell = view.getUrl();
        if (!Navigationswache.istGestrandet(aktuell)) {
            spur("main", aktuell, "rettung", "erlaubt", "seite steht noch, nichts zu tun");
            return;
        }
        long jetzt = SystemClock.uptimeMillis();
        if (!wache.rettungFaellig(jetzt)) {
            spur("main", aktuell, "rettung", "blockiert", "zu dicht hinter der letzten");
            return;
        }
        android.webkit.WebBackForwardList verlauf = view.copyBackForwardList();
        if (verlauf != null) {
            for (int i = verlauf.getCurrentIndex() - 1; i >= 0; i -= 1) {
                android.webkit.WebHistoryItem eintrag = verlauf.getItemAtIndex(i);
                String adresse = eintrag == null ? null : eintrag.getUrl();
                if (adresse == null || Navigationswache.istGestrandet(adresse)) continue;
                if (!isPopupFirstParty(provider, adresse)) continue;
                spur("main", adresse, "rettung", "erlaubt",
                    "zurueck " + (verlauf.getCurrentIndex() - i) + " im verlauf");
                // Der Sprung geht auf eine Adresse, die die Wache ohnehin
                // durchliesse - angemeldet wird er trotzdem, damit er nicht von
                // der eigenen Regel aufgehalten wird, falls WebView ihn meldet.
                wache.selbstGewaehlt(adresse, jetzt);
                view.goBackOrForward(i - verlauf.getCurrentIndex());
                return;
            }
        }
        String zurueck = letzteGueltigeSeite.get(provider.id);
        if (zurueck == null || zurueck.isEmpty()) zurueck = provider.startUrl;
        if (zurueck == null || zurueck.isEmpty() || isSameUrl(zurueck, aktuell)) {
            spur("main", aktuell, "rettung", "blockiert", "kein rueckweg bekannt");
            return;
        }
        spur("main", zurueck, "rettung", "erlaubt", "letzte gueltige seite neu geladen");
        wache.selbstGewaehlt(zurueck, jetzt);
        view.loadUrl(zurueck);
    }

    private final class GuardedWebViewClient extends WebViewClient {
        private final Provider provider;
        /**
         * Current main-frame URL, mirrored from the page callbacks (which do run on the UI thread).
         *
         * shouldInterceptRequest() is documented to run on a WebView *IO* thread, not the UI
         * thread. Calling any WebView method there -- including getUrl() -- trips WebView's
         * checkThread() guard, which throws a RuntimeException for every app with
         * targetSdkVersion >= 18. That exception is raised on the IO thread, is uncaught, and
         * therefore kills the whole process. The interceptor must read this field instead.
         */
        private volatile String mainFrameUrl = "";

        GuardedWebViewClient(Provider provider) {
            this.provider = provider;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            mainFrameUrl = url == null ? "" : url;
            // Die Rahmen der vorigen Seite sind tot; ihre Kanaele wuerden
            // sonst mitgezaehlt und die Skripte gingen ins Leere.
            if (rahmen != null) rahmen.vergessen(view);
            // Und mit ihnen der Zustand der Watchparty an diesem Player: die
            // bestaetigten Driftmessungen und die zuletzt angewendete laufende
            // Nummer gehoeren zur Folge davor. Bliebe die Nummer stehen, wiese
            // der neue Player die ersten Befehle der neuen Folge als
            // Nachzuegler ab - und dann waere Play/Pause nach einem
            // Folgenwechsel wieder tot.
            if (mitschauen != null && provider == activeProvider) mitschauen.zuruecksetzen(view);
            // Und was der Player der vorigen Seite ueber seine Bedienelemente
            // gesagt hat, gilt ab hier nicht mehr.
            if (liveStreifen != null && provider == activeProvider) liveStreifen.playerNeu();
            if (spielerleiste != null && provider == activeProvider) spielerleiste.playerNeu();
            // Die neue Seite ist da: ein Folgenwechsel ist damit vollzogen, und
            // die Leiste zeigt nichts, solange das Ziel nicht neu bestimmt ist.
            if (provider == activeProvider) {
                folgenwechselSeit = 0;
                zielSucheFuer = "";
                if (spielerleiste != null) spielerleiste.setzeZiel("");
            }
            // Eine neue Seite, neue Versuche: derselbe Hoster kann bei der
            // naechsten Folge durchaus antworten.
            rahmenVersuche.clear();
            // Navigating anywhere other than the armed page means the request no longer refers to
            // what is about to appear, so it must not fire on whatever loads instead.
            if (isEpisodeUrl(url)) lastEpisodeUrl = url;
            // Die Seitenangaben schon jetzt lesen und nicht erst beim
            // Seitenende. Bei diesen Anbietern kommt onPageFinished erst mit
            // der letzten Werbung - der Autostart klickt den Hoster aber nach
            // zwoelf Sekunden an, und danach steht die Folgenseite nicht mehr
            // im Hauptrahmen. Wer erst beim Seitenende liest, liest die
            // Grenzen der Serie nie; ohne sie gibt es keine naechste Folge.
            // Das Skript faengt mit einem leeren Dokument nichts an - es fasst
            // von selbst nach (siehe Titelbild.NACHFASSEN_MS).
            if (titelbild != null && provider == activeProvider) {
                titelbild.suchen(view, provider, url);
            }
            if (autoStartRequested && !isSameUrl(url, autoStartUrl)) {
                disarmAutoStart("navigated to " + safePath(url));
            } else if (provider == activeProvider && autoStartArmedFor(url)) {
                // Start here, not in onPageFinished. That callback waits for every last subresource,
                // and these pages keep pulling adverts long after the part we need exists -- measured
                // on a throttled connection, onPageFinished had still not fired after 150 seconds
                // while the hoster list was long since in the DOM. The chain's own readiness probe is
                // the better signal, so it is allowed to start looking straight away.
                autoStartRequested = false;
                autoStartUrl = null;
                runAutoStart(view, url);
            }
            if (isAniWorldProvider(provider)) {
                for (long delay : new long[] {700L, 1800L}) {
                    view.postDelayed(() -> installAniWorldImageFix(view, provider), delay);
                }
            }
            // Der Rueckfall fuer WebViews ohne addDocumentStartJavaScript und
            // fuer Seiten, die ihr Dokument per Skript austauschen. Frueher
            // als hier geht es ueber diesen Weg nicht.
            if (isTelevision() && fernsehwerbung != null) {
                fernsehwerbung.einspielen(view, provider);
            }
            super.onPageStarted(view, url, favicon);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) {
                return false;
            }
            String url = request.getUrl().toString();
            // Only http(s) is ever handed to the WebView. These sites push intent://, market://
            // and similar app-store/deeplink schemes through ad frames; forwarding those to
            // startActivity() is what produces ActivityNotFoundException, and letting the WebView
            // attempt them just yields a dead error page. Refuse them explicitly instead.
            String scheme = request.getUrl().getScheme();
            if (scheme != null && !"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
                spur("main", url, "navigation", "blockiert", "fremdes schema " + scheme);
                // Ein fremdes Schema hat nie ein Dokument bestaetigt; die Seite
                // steht noch. Trotzdem nachsehen - es kostet nichts und deckt
                // den Fall ab, dass die Werbung vorher schon umgezogen ist.
                nachSperrePruefen(view, provider);
                return true;
            }
            if (Adblocker.isChallengeOrVerificationUrl(url, provider)) {
                spur("main", url, "navigation", "erlaubt", "pruefung/captcha");
                return false;
            }
            if (shouldBlockProviderNavigation(provider, url)) {
                spur("main", url, "navigation", "blockiert", "anderer eingerichteter anbieter");
                nachSperrePruefen(view, provider);
                return true;
            }
            // Wer den Hauptrahmen bekommt, entscheidet die Wache - und zwar
            // anhand des Ziels *und* der Herkunft. Der Unterschied, an dem die
            // weisse Seite haengt: ein Sprung, den kein Server angesagt hat und
            // der von einer Seite des Anbieters ausgeht, ist die Werbung. Er
            // wird gesperrt, solange die Folgenseite noch dasteht - statt erst
            // vier Spruenge spaeter, wenn sie weg ist.
            Navigationswache.Urteil urteil = wache.hauptnavigation(url,
                isPopupFirstParty(provider, url),
                isPopupFirstParty(provider, mainFrameUrl),
                request.isRedirect(),
                SystemClock.uptimeMillis());
            if (!urteil.erlaubt) {
                spur("main", url, request.isRedirect() ? "weiterleitung" : "navigation",
                    "blockiert", urteil.grund + ", von " + safeHost(mainFrameUrl));
                sperreMelden(view, url, provider, urteil.grund);
                return true;
            }
            // Und zuletzt die Filterlisten: auch eine formal zulaessige
            // Hauptnavigation kann auf einem Werbenetz landen. Auch das ist
            // eine Sperre und geht denselben Weg - vorher endete sie hier
            // stumm, ohne Meldung und ohne Blick darauf, was stehenbleibt.
            if (adblocker.shouldBlock(url, provider, Adblocker.isLikelyVideoPlayerUrl(view.getUrl()))) {
                spur("main", url, "navigation", "blockiert", "filterliste");
                sperreMelden(view, url, provider, "filterliste");
                return true;
            }
            spur("main", url, request.isRedirect() ? "weiterleitung" : "navigation",
                "erlaubt", urteil.grund);
            return false;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (request.isForMainFrame()) {
                return null;
            }
            if (Adblocker.isChallengeOrVerificationUrl(request.getUrl().toString(), provider)) {
                return null;
            }
            // Sub-frame documents are how in-page ad creatives (fake captchas, "clean your
            // phone" panels) get in. Log them with their referer so the ad frame can be told apart
            // from the legitimate player embed instead of guessed at.
            if (isSubFrameDocument(request)) {
                spur("sub", request.getUrl().toString(), "unterdokument", "gepruft",
                    "von " + safeHost(refererOf(request)) + ", fremder rahmen="
                        + Adblocker.isEmbeddedThirdPartyFrame(refererOf(request), provider));
            }
            // Intrusive overlay creatives are blocked before the page-critical bypass, because
            // parts of them arrive as CSS and images and would otherwise be waved through.
            if (Adblocker.isIntrusiveOverlayRequest(request.getUrl().toString())) {
                spur("sub", request.getUrl().toString(), "anfrage", "blockiert",
                    "aufdringliche werbeschicht " + safePath(request.getUrl().toString()));
                return blockedResourceResponse(request);
            }
            // Und dieselbe Frage an die kuratierten Kernlisten - ebenfalls
            // *vor* der Ausnahme fuer Seitenbestandteile. Genau dort kamen die
            // beiden Werbekarten oben rechts herein: ihr Bild und ihr
            // Stilblatt sind formal Bild und Stilblatt, und die Ausnahme laesst
            // beides ungeprueft durch, damit eine Seite nicht am Filter
            // zerbricht. Nur auf dem Fernseher, und nur die kuratierten Listen
            // - die grosse Liste hier vorzuziehen waere breit genug, um ein
            // Titelbild des Anbieters mitzunehmen.
            //
            // Aber nicht im Rahmen des Hosters. Dort gilt weiterhin, was
            // blockReason() begruendet: VOE zaehlt die Anfragen seiner eigenen
            // Werbepartner mit und verweigert die Wiedergabe, wenn zu viele
            // fehlen. Die vier ausdruecklich benannten Aufdringlichen oben
            // sind die Ausnahme davon und bleiben es; diese breitere Regel
            // wird es nicht - ein blockiertes Werbebild ist kein Grund, das
            // Video zu verlieren.
            if (isTelevision() && !isHosterFrameRequest(request)
                && adblocker.istKernWerbeAnfrage(request.getUrl().toString(), provider)) {
                spur("sub", request.getUrl().toString(), "anfrage", "blockiert",
                    "werbenetz vor der seitenausnahme");
                return blockedResourceResponse(request);
            }
            if (isPageCriticalRequest(request)) {
                return null;
            }
            // Deliberately NOT view.getUrl() -- see mainFrameUrl above. This runs off the UI thread.
            String requestUrl = request.getUrl().toString();
            boolean hosterFrame = isHosterFrameRequest(request);
            // Was die vollen Regeln zu dieser Anfrage sagen - sofern sie sie
            // schon einmal gesehen haben. Beim ersten Mal entscheidet die
            // Domainliste; die Engine sieht sich die Adresse danach an und
            // urteilt ab dem naechsten Mal. Warten kann diese Stelle nicht:
            // sie laeuft im Netzfaden, und die Engine antwortet ueber den
            // Hauptfaden.
            Boolean engineUrteil = werbefilter == null ? null : werbefilter.urteil(requestUrl,
                Werbefilter.artAus(request.getRequestHeaders(), false, requestUrl),
                refererOf(request));
            String reason = adblocker.blockReason(requestUrl, provider, hosterFrame, engineUrteil);
            if (reason == null && hosterFrame
                && Adblocker.isEmbeddedThirdPartyFrame(refererOf(request), provider)) {
                // Everything the hoster frame is still allowed to pull in. This is where the
                // in-page ad overlays come from, so their source has to be nameable.
                spur("sub", requestUrl, "anfrage", "erlaubt",
                    "im hoster-rahmen, von " + safeHost(refererOf(request)));
            }
            if (reason != null) {
                spur("sub", requestUrl, "anfrage", "blockiert",
                    reason + ", von " + safeHost(refererOf(request)));
                return blockedResourceResponse(request);
            }
            return null;
        }

        /**
         * True when this sub-resource was issued by the hoster's player document rather than by
         * the provider's own page.
         *
         * Looking only at the top-level URL was the defect: s.to and aniworld.to navigate to the
         * hoster, so the main frame became the player and blocking relaxed correctly -- but
         * filmo.to embeds the hoster in an iframe, so the main frame stayed on filmo.to and the
         * player's own scripts were filtered as ordinary third-party traffic. The Referer names
         * the document that actually issued the request, which is the frame that matters.
         */
        private boolean isHosterFrameRequest(WebResourceRequest request) {
            return Adblocker.isLikelyVideoPlayerUrl(mainFrameUrl)
                || Adblocker.isEmbeddedThirdPartyFrame(refererOf(request), provider);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            mainFrameUrl = url == null ? "" : url;
            // Ein about:blank darf nicht als sichtbare Ersatzseite stehenbleiben.
            // Es entsteht dort, wo ein window.open() erst die leere Seite
            // aufmacht und die Adresse nachreicht - und die Nachreichung ist
            // die Werbung, die gerade gesperrt wurde.
            if (Navigationswache.istGestrandet(url)) {
                spur("main", url, "seite fertig", "blockiert", "leeres dokument - wird zurueckgeholt");
                if (provider == activeProvider) hideProviderLoading();
                rettungWennGestrandet(view, provider);
                return;
            }
            letzteGueltigeSeite.put(provider.id, url);
            // Das Sprungbudget der Wache wird hier absichtlich NICHT geleert:
            // der Rotationssprung von VOE kommt erst, nachdem seine
            // Weichenseite fertig geladen hat - ein Leeren an dieser Stelle
            // naehme die Erlaubnis einen Augenblick vor dem Sprung weg, der sie
            // braucht. Es laeuft stattdessen ab und wird verbraucht, und
            // openProvider() setzt es zurueck, sobald ELFIX selbst navigiert.
            if (provider == activeProvider) hideProviderLoading();
            if (shouldBlockProviderNavigation(provider, url)) return;
            // Vor der TV-Navigation: was Werbung ist, soll schon weg sein,
            // wenn die Navigation ihre Ziele einsammelt. Sonst bekaeme eine
            // Werbekarte den ersten Fokus.
            if (isTelevision() && fernsehwerbung != null) {
                fernsehwerbung.einspielen(view, provider);
            }
            installTvWebNavigation(view);
            // Die Watchparty: Horcher einsetzen, einen Folgenwechsel melden und
            // den Stand der Runde anfordern. Der eine Einstieg fuer alle sechs
            // Wege, auf denen ELFIX eine Folge oeffnet - siehe Mitschauen.
            if (mitschauen != null && provider == activeProvider) mitschauen.seiteFertig(view, url);
            installStoPlayerFix(view, provider);
            installAniWorldImageFix(view, provider);
            if (kosmetik != null) kosmetik.einspielen(view, provider);
            // Und die kosmetischen Regeln der Filterlisten - das, was ein
            // Domainfilter grundsaetzlich nicht kann.
            if (werbefilter != null) werbefilter.seitenregelnEinspielen(view, provider, url);
            // Die gemerkte Fassung anklicken, bevor der Autostart einen
            // Hoster sucht - die Seite zeigt nur die Hoster der gewaehlten.
            if (fassungen != null) {
                fassungen.einspielen(view, provider, url, FavoriteStore.ladeRoh(MainActivity.this));
            }
            provider.lastUrl = url;
            if (bestand != null) {
                bestand.nachziehen(provider, url, favoriteProgressMode);
                bestand.aktuellenEintragBestimmen(provider, url, MainActivity.this::updateFavoriteButton);
            }
            // Und nachsehen, welches Titelbild die Seite hergibt. Damit traegt
            // eine Karte auf dem Telefon dasselbe Bild wie am Rechner, statt
            // der beiden Anfangsbuchstaben.
            if (titelbild != null) titelbild.suchen(view, provider, url);
            // Und nachsehen, ob es eine naechste Folge gibt.
            if (provider == activeProvider) zielNachfassen(view);
            super.onPageFinished(view, url);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (!request.isForMainFrame() || provider != activeProvider) return;
            showProviderError(provider, "Die Seite konnte nicht geladen werden. Prüfe deine Internetverbindung.");
        }

        /**
         * Ein Serverfehler in einem Unterrahmen - der Playerkasten.
         *
         * <p>Das ist der Fall aus dem Foto: die Folgenseite steht, Sprache und
         * Hosterliste stehen, und im Playerkasten steht "502 - Bad Gateway.
         * Looks like we have got an invalid response from the upstream server."
         * Der Fehler kommt nicht von ELFIX - es ist die Antwort des Anbieters
         * beziehungsweise seines vorgelagerten Servers auf die Anfrage, die den
         * Hoster aufloesen soll. ELFIX hat ihn bisher nur nicht bemerkt:
         * {@code onReceivedError} sieht ausschliesslich den Hauptrahmen, und
         * {@code onReceivedHttpError} war gar nicht ueberschrieben. Also blieb
         * die fremde Fehlerseite als weisser Kasten stehen, und nichts deutete
         * darauf hin, dass man einfach einen anderen Hoster nehmen kann.
         *
         * <p>Zwei Schritte, und mehr nicht:
         *
         * <ol>
         *   <li>Einmal nachladen. Ein 502 ist meistens voruebergehend - eine
         *       einzelne Anfrage, die der vorgelagerte Server nicht
         *       durchbekommen hat. Nachgeladen wird nur der Rahmen, nicht die
         *       Seite: ein Neuladen der Seite kostet die Sprachwahl und die
         *       Stelle in der Folgenliste.
         *   <li>Beim zweiten Mal ein eigener Satz an der Stelle des Rahmens.
         *       Er ersetzt den Rahmen und nicht die Seite - Folgenliste,
         *       Sprachwahl und Hosterliste bleiben genau, wie sie sind, und
         *       der naechste Hoster ist einen Klick entfernt.
         * </ol>
         */
        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                        WebResourceResponse antwort) {
            super.onReceivedHttpError(view, request, antwort);
            if (antwort == null || request == null || request.isForMainFrame()) return;
            if (provider != activeProvider) return;
            // Nur Dokumente. Ein Bild oder ein Skript mit 404 ist Alltag auf
            // diesen Seiten und geht niemanden etwas an.
            if (!isSubFrameDocument(request)) return;
            int status = antwort.getStatusCode();
            if (status < 500 && status != 403 && status != 404) return;
            String adresse = request.getUrl().toString();
            spur("sub", adresse, "unterdokument", "fehler", "status " + status);
            view.post(() -> rahmenFehler(view, adresse, status));
        }

        /**
         * Ad-heavy streaming pages can crash the WebView's *renderer* process (malformed video
         * codecs, hostile ad iframes, OOM). Without this override Android tears down the whole
         * app process when that happens. Returning true keeps ELFIX alive and discards only the
         * affected WebView -- it must never be reused after its renderer died.
         */
        @Override
        public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
            Log.w(TAG, "Renderer gone provider=" + provider.id
                + " crashed=" + (detail != null && detail.didCrash())
                + " url=" + safeHost(mainFrameUrl));
            // If the dead WebView was the one presenting fullscreen, tear that down first so the
            // overlay and the landscape lock cannot outlive it.
            if (fullscreenHostWebView == view) hideFullscreen();
            webViews.remove(provider.id);
            if (content != null) content.removeView(view);
            view.destroy();
            if (provider == activeProvider) {
                hideProviderLoading();
                showProviderError(provider, "Die Seite ist abgestürzt.");
            }
            return true;
        }
    }

    /**
     * Wie oft ein gescheiterter Playerrahmen nachgeladen wurde.
     *
     * <p>Je Adresse einmal. Der Zaehler wird beim Seitenwechsel geleert - eine
     * neue Folge faengt von vorn an, und derselbe Hoster kann dort
     * funktionieren.
     */
    private final Map<String, Integer> rahmenVersuche = new HashMap<>();

    /**
     * Ein Unterrahmen hat einen Serverfehler geliefert.
     *
     * <p>Beim ersten Mal wird er nachgeladen, beim zweiten durch einen eigenen
     * Satz ersetzt. Gesucht wird der Rahmen ueber seine Adresse und nicht ueber
     * eine Stelle im Dokument: welcher Kasten der Playerkasten ist, weiss die
     * Seite, nicht ELFIX.
     */
    private void rahmenFehler(WebView ansicht, String adresse, int status) {
        if (ansicht == null || adresse == null || adresse.isEmpty()) return;
        int versuche = rahmenVersuche.getOrDefault(adresse, 0);
        rahmenVersuche.put(adresse, versuche + 1);
        boolean nochmal = versuche == 0;
        String text = nochmal
            ? ""
            : status >= 500
                ? "Dieser Hoster antwortet gerade nicht (Fehler " + status
                    + "). Wähle unten einen anderen."
                : "Dieser Hoster ist nicht erreichbar (Fehler " + status
                    + "). Wähle unten einen anderen.";
        String skript = "(function(){"
            + "var ziel=" + jsZeichenkette(adresse) + ";"
            + "var nochmal=" + (nochmal ? "true" : "false") + ";"
            + "var text=" + jsZeichenkette(text) + ";"
            + "var rahmen=Array.prototype.slice.call(document.querySelectorAll('iframe'));"
            + "var treffer=null;"
            + "for(var i=0;i<rahmen.length;i++){"
                + "var quelle=rahmen[i].src||rahmen[i].getAttribute('src')||'';"
                + "if(quelle===ziel){treffer=rahmen[i];break;}"
            + "}"
            // Ohne Treffer ist der Rahmen nicht der des Players - dann gehoert
            // dieser Fehler nicht hierher und die Seite bleibt unberuehrt.
            + "if(!treffer)return 'kein-rahmen';"
            + "if(nochmal){try{treffer.src=ziel;}catch(e){}return 'neu-geladen';}"
            + "var kasten=document.createElement('div');"
            + "kasten.setAttribute('data-elfix-hosterfehler','');"
            // Die Masse des Rahmens uebernehmen, damit die Seite nicht
            // zusammenspringt - und sonst nichts anfassen.
            + "kasten.style.cssText='display:flex;align-items:center;justify-content:center;"
            + "text-align:center;padding:24px;box-sizing:border-box;font:600 17px/1.45 sans-serif;"
            + "color:#e8ecf5;background:#141a27;border-radius:10px;'"
            + "+'width:'+(treffer.offsetWidth||treffer.clientWidth||0)+'px;'"
            + "+'height:'+(treffer.offsetHeight||treffer.clientHeight||0)+'px;';"
            + "kasten.textContent=text;"
            + "try{treffer.replaceWith(kasten);}catch(e){"
                + "try{treffer.parentNode.replaceChild(kasten,treffer);}catch(e2){return 'ging-nicht';}"
            + "}"
            + "return 'ersetzt';"
        + "})();";
        ansicht.evaluateJavascript(skript, wert ->
            Log.i(TAG, "Hosterrahmen " + status + " (" + safeHost(adresse) + "): " + wert));
    }

    /** Eine Zeichenkette so, wie JavaScript sie lesen kann. */
    private static String jsZeichenkette(String wert) {
        String sauber = wert == null ? "" : wert;
        return "\"" + sauber.replace("\\", "\\\\").replace("\"", "\\\"")
            .replace("\n", " ").replace("\r", " ").replace("<", "\\u003c") + "\"";
    }

    private void installStoPlayerFix(WebView webView, Provider provider) {
        if (webView == null || provider == null || !isStoProvider(provider)) return;
        webView.evaluateJavascript(
            "(function(){"
                + "var old=document.getElementById('__elflixStoPlay');"
                + "if(old)old.remove();"
            + "})();",
            null
        );
    }

    private void installAniWorldImageFix(WebView webView, Provider provider) {
        if (webView == null || provider == null || !isAniWorldProvider(provider)) return;
        if (aniworldBildNachreichungSkript != null) {
            webView.evaluateJavascript(aniworldBildNachreichungSkript, null);
            return;
        }
        if (kern == null) return;
        if (!kern.istBereit()) {
            kern.wennBereit(() -> installAniWorldImageFix(webView, provider));
            return;
        }
        if (aniworldBildNachreichungLaedt) return;
        aniworldBildNachreichungLaedt = true;
        kern.rufe("bildnachreichung.nachreichSkript", (wert, fehler) -> {
            aniworldBildNachreichungLaedt = false;
            if (fehler != null || wert == null) {
                Log.d(TAG, "AniWorld-Bildnachreichung nicht erhalten: " + fehler);
                return;
            }
            try {
                aniworldBildNachreichungSkript = new JSONArray("[" + wert + "]").getString(0);
            } catch (Exception ausnahme) {
                Log.d(TAG, "AniWorld-Bildnachreichung unlesbar: " + ausnahme);
                return;
            }
            webView.evaluateJavascript(aniworldBildNachreichungSkript, null);
        });
    }

    private void installTvWebNavigation(WebView webView) {
        if (webView == null) return;
        String script =
            "(function(){"
                + "if(window.__elfixTvNavV9)return;window.__elfixTvNavV9=true;"
                + "var style=document.createElement('style');"
                + "style.textContent='*{-webkit-user-select:none!important;user-select:none!important}a:focus,button:focus,input:focus,select:focus,textarea:focus,video:focus,iframe:focus,[tabindex]:focus,[role=\"button\"]:focus{outline:4px solid #3D92FF!important;outline-offset:3px!important;border-radius:10px!important;box-shadow:0 0 0 6px rgba(61,146,255,.30),0 0 30px rgba(61,146,255,.55)!important}#__elfixCursor{display:none}';"
                // AniWorld renders seasons and episodes as 33x33 number links -- unreadable and hard
                // to aim at from a sofa. Enlarged only on AniWorld, only the season/episode strip.
                + "if(location.hostname.indexOf('aniworld')>=0){var tvStyle=document.createElement('style');"
                + "tvStyle.textContent='#stream ul li a{min-width:46px!important;min-height:46px!important;line-height:46px!important;font-size:20px!important;padding:0 8px!important}"
                + "a.watchEpisode{min-height:56px!important}';"
                + "document.documentElement.appendChild(tvStyle);}"
                + "document.documentElement.appendChild(style);"
                // Was auf einer Anbieterseite wirklich zu bedienen ist:
                // Folgen, Staffeln, Sprache, Hoster, Player. Die Sprachwahl
                // und die Hosterleiste standen hier vorher nicht - auf
                // AniWorld sind das <img>- und <li>-Elemente mit einem
                // Klickhorcher, und die faellt die allgemeine Auswahl unten
                // nicht auf, weil sie weder Link noch Knopf sind. Mit einer
                // Fernbedienung waren sie damit unerreichbar.
                + "var priority='#stream a, a.watchEpisode, a.alphabet-link, button.link-box,"
                + " a.video-card, .provider-chip, button.provider-frame__play,"
                + " .changeLanguageBox img, .changeLanguageBox li, .changeLanguageBox [data-lang-key],"
                + " .hosterSiteDirectNav a, .hosterSiteDirectNav li,"
                + " .episodeList a, .seasonEpisodesList a, iframe';"
                + "var important='a[href],button,input,select,textarea,video,[role=\"button\"],[tabindex],.vjs-big-play-button,.jw-icon-playback,.plyr__control,[class*=\"play\"],[class*=\"Play\"],[class*=\"watch\"],[class*=\"Watch\"],[class*=\"stream\"],[class*=\"Stream\"]';"
                // Was die Werbeentfernung ausgeblendet hat, ist kein Ziel -
                // auch dann nicht, wenn die Seite es gleich wieder einblendet.
                // Ohne diese Zeile bekaeme eine Werbekarte den Fokus, obwohl
                // sie nicht zu sehen ist, und die Fernbedienung liefe ins
                // Leere (siehe Fernsehwerbung.java).
                + "function werbung(el){try{return !!(el.closest&&el.closest('[data-elfix-werbung],[aria-hidden=\"true\"]'));}catch(e){return false;}}"
                + "function visible(el){if(werbung(el))return false;var r=el.getBoundingClientRect();var s=getComputedStyle(el);"
                // Deliberately scroll-independent: an element counts as a target if it is rendered
                // at all, not only if it happens to be on screen right now. Filtering by the current
                // viewport made the candidate list change between key presses, which is what made
                // the focus jump around and the page scroll unpredictably.
                + "return r.width>8&&r.height>8&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0';}"
                + "function noise(el){var t=((el.innerText||el.textContent||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.className||'')+' '+(el.id||'')).toLowerCase();return /cookie|datenschutz|privacy|login|register|registrieren|sprache|language|newsletter|werbung|advert|discord|telegram/.test(t)&&!/play|watch|stream|start|episode|folge|staffel|film|movie|video/.test(t);}"
                + "function overlay(el){var r=el.getBoundingClientRect();"
                // A link the size of the viewport is a click-catcher, not a navigation target.
                // AniWorld ships one (a#lkfhd, 960x476 at 0,0) that otherwise swallows the focus.
                + "return r.width*r.height>innerWidth*innerHeight*0.7;}"
                + "function contentful(el){"
                // Skip anchors with neither text nor artwork: invisible click targets.
                + "if(el.tagName!=='A')return true;"
                + "if((el.innerText||el.textContent||'').trim().length>0)return true;"
                + "return !!el.querySelector('img,svg,picture,video');}"
                + "function meaningful(el){if(!visible(el)||noise(el)||overlay(el)||!contentful(el))return false;var tag=el.tagName;var r=el.getBoundingClientRect();var cls=((el.className||'')+' '+(el.id||'')).toLowerCase();if(tag==='VIDEO'||tag==='IFRAME')return true;if(tag==='A'||tag==='BUTTON'||tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA')return true;if(el.getAttribute('role')==='button'||el.hasAttribute('tabindex'))return true;if(/play|watch|stream|start|episode|folge|staffel|film|movie|video|player/.test(cls))return true;return r.width*r.height>5000&&el.onclick;}"
                // Der tabIndex gehoert dazu: focus() auf einem <img> oder
                // <li> ohne ihn tut nichts, und dann steht der Fokusrahmen
                // nirgends, obwohl das Ziel gefunden wurde.
                + "function priorityItems(){return Array.prototype.slice.call(document.querySelectorAll(priority)).filter(function(el){if(el.tabIndex<0)el.tabIndex=0;return visible(el)&&!overlay(el)&&contentful(el);});}"
                + "function fallbackItems(){return Array.prototype.slice.call(document.querySelectorAll(important+', [onclick]')).filter(function(el){if(el.tabIndex<0)el.tabIndex=0;return meaningful(el);});}"
                + "function items(){var p=priorityItems();return p.length?p:fallbackItems();}"
                + "function docRect(el){var r=el.getBoundingClientRect();var sx=window.scrollX||window.pageXOffset||0;var sy=window.scrollY||window.pageYOffset||0;"
                + "return{left:r.left+sx,top:r.top+sy,right:r.right+sx,bottom:r.bottom+sy,width:r.width,height:r.height};}"
                + "function center(r){return{x:r.left+r.width/2,y:r.top+r.height/2};}"
                + "function first(){var list=items();if(!list.length)return null;"
                + "var sx=window.scrollX||0,sy=window.scrollY||0;var cx=sx+innerWidth/2,cy=sy+innerHeight/2,b=null,bs=1/0;"
                + "list.forEach(function(el){var c=center(docRect(el));var s=Math.abs(c.x-cx)+Math.abs(c.y-cy);if(s<bs){bs=s;b=el;}});return b;}"
                + "function move(dir){var list=items();if(!list.length)return false;var active=document.activeElement;if(!active||list.indexOf(active)<0){active=first();if(active){active.focus();active.scrollIntoView({block:'center',inline:'center'});return true;}return false;}var ar=docRect(active);var ac=center(ar);var horizontal=dir==='right'||dir==='left';var best=null;var bestScore=1/0;list.forEach(function(el){if(el===active)return;var r=docRect(el);var c=center(r);var dx=c.x-ac.x;var dy=c.y-ac.y;var primary=dir==='right'?dx:dir==='left'?-dx:dir==='down'?dy:-dy;var orth=horizontal?Math.abs(dy):Math.abs(dx);var overlaps=horizontal?!(r.bottom<ar.top||r.top>ar.bottom):!(r.right<ar.left||r.left>ar.right);if(primary<=8)return;if(!overlaps&&orth>primary*1.15)return;var score=primary+(overlaps?orth*.25:orth*2.8);if(score<bestScore){bestScore=score;best=el;}});if(best){best.focus();best.scrollIntoView({block:'center',inline:'center'});return true;}return false;}"
                + "function fire(el,x,y){if(!el)return;var tag=el.tagName;if(tag==='VIDEO'){try{el.paused?el.play():el.pause();return;}catch(e){}}['pointerdown','mousedown','mouseup','click'].forEach(function(type){try{el.dispatchEvent(new MouseEvent(type,{view:window,bubbles:true,cancelable:true,clientX:x||center(el.getBoundingClientRect()).x,clientY:y||center(el.getBoundingClientRect()).y}));}catch(e){}});}"
                + "function activate(el){if(!el||el===document.body)return false;"
                + "if(el.tagName==='IFRAME'){try{el.focus();}catch(e){}return true;}"
                // Re-validate before firing. AniWorld ships several hoster link sets (one per
                // language) and swaps which of them is rendered, so the focused link can collapse
                // to 0x0 between the focus move and the key press -- firing it then followed a
                // completely different link. Re-pick a real target instead.
                + "if(!visible(el)||overlay(el)||!contentful(el)){var again=first();"
                + "if(again){again.focus();again.scrollIntoView({block:'center',inline:'center'});"
                + "window.__elfixReport('revalidated');}return true;}"
                + "var target=el.closest&&el.closest(priority+','+important)||el;fire(target);return true;}"
                + "var cur={x:innerWidth/2,y:innerHeight/2};function cursor(){var el=document.getElementById('__elflixCursor');if(!el){el=document.createElement('div');el.id='__elflixCursor';document.documentElement.appendChild(el);}return el;}function paint(){var el=cursor();el.style.left=cur.x+'px';el.style.top=cur.y+'px';}"
                + "window.__elflixTvMouse=function(action,dx,dy){var c=cursor();if(action==='show'){c.style.display='block';paint();return true;}if(action==='hide'){c.style.display='none';return true;}if(action==='move'){c.style.display='block';cur.x=Math.max(8,Math.min(innerWidth-8,cur.x+(dx||0)));cur.y=Math.max(8,Math.min(innerHeight-8,cur.y+(dy||0)));if(cur.y<34&&dy<0)window.scrollBy({top:-120,behavior:'smooth'});if(cur.y>innerHeight-34&&dy>0)window.scrollBy({top:120,behavior:'smooth'});if(cur.x<28&&dx<0)window.scrollBy({left:-120,behavior:'smooth'});if(cur.x>innerWidth-28&&dx>0)window.scrollBy({left:120,behavior:'smooth'});paint();return true;}if(action==='click'){if(dx>0)cur.x=Math.max(8,Math.min(innerWidth-8,dx));if(dy>0)cur.y=Math.max(8,Math.min(innerHeight-8,dy));c.style.display='block';paint();var old=c.style.display;c.style.display='none';var el=document.elementFromPoint(cur.x,cur.y);c.style.display=old;var target=el&&el.closest&&el.closest(important+', [onclick]')||el;if(target){try{target.focus();}catch(e){}fire(target,cur.x,cur.y);}return true;}return false;};"
                + "function describe(el){if(!el)return 'null';var r=el.getBoundingClientRect();return el.tagName+'#'+(el.id||'')+'.'+((''+(el.className||'')).split(' ')[0])+' '+Math.round(r.width)+'x'+Math.round(r.height)+'@'+Math.round(r.left)+','+Math.round(r.top);}"
                + "window.__elfixReport=function(tag){try{console.log('ELFIX:'+tag+' active='+describe(document.activeElement)+' items='+items().length);}catch(e){}};"
                // Der Rueckweg fuer die Werbeentfernung: verschwindet ein
                // Element, in dem gerade der Fokus stand, bekommt die Seite
                // hier einen neuen. Ohne das faellt der Fokus auf den Body,
                // und das Steuerkreuz faengt bei jedem Werbeschub von vorn an.
                + "window.__elfixTvNavErneut=function(){var el=first();if(!el)return false;"
                + "try{el.focus();el.scrollIntoView({block:'center',inline:'center'});}catch(e){}"
                + "window.__elfixReport('fokus-erneut');return true;};"
                + "document.addEventListener('keydown',function(e){"
                + "var ae=document.activeElement;"
                // The hoster runs in a cross-origin iframe. Once it has focus we must NOT consume the
                // key: Chromium routes it into the embedded document, which is the only way the
                // player's own controls become reachable with a remote. Same-origin policy means we
                // can never drive them from here ourselves.
                + "if(ae&&ae.tagName==='IFRAME'){window.__elfixReport('handoff-iframe');return;}"
                + "var map={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'};"
                + "if(map[e.key]){var ok=move(map[e.key]);window.__elfixReport('move-'+map[e.key]+'-'+(ok?'ok':'fail'));if(ok){e.preventDefault();e.stopPropagation();return;}}"
                + "if((e.key==='Enter'||e.key===' ')){var done=activate(document.activeElement);window.__elfixReport('enter-'+(done?'ok':'fail'));if(done){e.preventDefault();e.stopPropagation();}}},true);"
            + "})();";
        webView.evaluateJavascript(script, null);
    }

    private WebResourceResponse blockedResourceResponse(WebResourceRequest request) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse(
            mimeForBlockedRequest(request),
            "utf-8",
            204,
            "No Content",
            headers,
            new ByteArrayInputStream(new byte[0])
        );
    }

    private String mimeForBlockedRequest(WebResourceRequest request) {
        String url = request.getUrl().toString().toLowerCase();
        String accept = request.getRequestHeaders().get("Accept");
        if (accept == null) accept = request.getRequestHeaders().get("accept");
        if (accept == null) accept = "";
        accept = accept.toLowerCase();

        if (url.endsWith(".css") || accept.contains("text/css")) return "text/css";
        if (url.endsWith(".js") || url.endsWith(".mjs") || accept.contains("javascript")) return "application/javascript";
        if (url.endsWith(".png")) return "image/png";
        if (url.endsWith(".jpg") || url.endsWith(".jpeg")) return "image/jpeg";
        if (url.endsWith(".gif")) return "image/gif";
        if (url.endsWith(".webp")) return "image/webp";
        if (url.endsWith(".svg")) return "image/svg+xml";
        if (url.endsWith(".woff")) return "font/woff";
        if (url.endsWith(".woff2")) return "font/woff2";
        if (accept.contains("image/")) return "image/gif";
        if (accept.contains("font/")) return "font/woff2";
        if (accept.contains("application/json")) return "application/json";
        return "text/plain";
    }

    /** True for a navigable HTML document loaded into a frame other than the main one. */
    private boolean isSubFrameDocument(WebResourceRequest request) {
        if (request.isForMainFrame()) return false;
        Map<String, String> headers = request.getRequestHeaders();
        String accept = headers == null ? null : headers.get("Accept");
        if (accept == null && headers != null) accept = headers.get("accept");
        return accept != null && accept.toLowerCase().contains("text/html");
    }

    private boolean isPageCriticalRequest(WebResourceRequest request) {
        String url = request.getUrl().toString().toLowerCase();
        String accept = request.getRequestHeaders().get("Accept");
        if (accept == null) accept = request.getRequestHeaders().get("accept");
        if (accept == null) accept = "";
        accept = accept.toLowerCase();

        return accept.contains("image/")
            || accept.contains("text/css")
            || accept.contains("font/")
            || accept.contains("video/")
            || accept.contains("audio/")
            || url.endsWith(".css")
            || url.endsWith(".png")
            || url.endsWith(".jpg")
            || url.endsWith(".jpeg")
            || url.endsWith(".gif")
            || url.endsWith(".webp")
            || url.endsWith(".svg")
            || url.endsWith(".ico")
            || url.endsWith(".woff")
            || url.endsWith(".woff2")
            || url.endsWith(".mp4")
            || url.endsWith(".m3u8")
            || url.endsWith(".ts")
            || url.endsWith(".webm");
    }

    private final class GuardedChromeClient extends WebChromeClient {
        @Override
        public boolean onConsoleMessage(android.webkit.ConsoleMessage message) {
            // Only our own diagnostics, so provider pages cannot flood logcat.
            String text = message.message() == null ? "" : message.message();
            if (text.startsWith("ELFIX:")) Log.i(TAG, "page " + text);
            // Die kosmetische Filterung meldet ihre Kandidaten über die
            // Konsole - das ist der Weg, den auch der Rechner benutzt, und
            // damit derselbe Meldetext.
            if (kosmetik != null && kosmetik.istMeldung(text)) {
                WebView ansicht = activeProvider == null ? null : webViews.get(activeProvider.id);
                kosmetik.meldung(ansicht, activeProvider, text);
            }
            // Play, Pause, Sprung und Stand aus dem Player. Sie kommen aus dem
            // Rahmen des Hosters; onConsoleMessage hoert dort mit, anders als
            // evaluateJavascript.
            if (mitschauen != null && mitschauen.istMeldung(text)) {
                mitschauen.meldung(text);
                return true;
            }
            // Ein Sprung im Player - daraus wird vielleicht eine Intromarke.
            // Die Meldung kommt aus dem Rahmen des Hosters; onConsoleMessage
            // hoert dort mit, anders als evaluateJavascript.
            if (marken != null && marken.istMeldung(text)) {
                WebView ansicht = activeProvider == null ? null : webViews.get(activeProvider.id);
                String adresse = ansicht == null ? null : ansicht.getUrl();
                marken.meldung(activeProvider, adresse,
                    FavoriteStore.ladeRoh(MainActivity.this), text, MainActivity.this::showToast);
            }
            // Welche Fassung dasteht - und welche jemand angeklickt hat.
            if (fassungen != null && fassungen.istMeldung(text)) {
                WebView ansicht = activeProvider == null ? null : webViews.get(activeProvider.id);
                String adresse = ansicht == null ? null : ansicht.getUrl();
                fassungen.meldung(activeProvider, adresse,
                    FavoriteStore.ladeRoh(MainActivity.this), text, MainActivity.this::showToast);
            }
            return true;
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
            // resultMsg.obj is only guaranteed to be a WebViewTransport when the framework itself
            // triggered this callback for a genuine window.open()/target=_blank. Guard against any
            // other shape instead of crashing on a bad cast.
            Object transportObj = resultMsg == null ? null : resultMsg.obj;
            if (!(transportObj instanceof WebView.WebViewTransport)) {
                Log.w(TAG, "Popup requested with unexpected transport, ignoring");
                return false;
            }
            spur("popup", "-", "anfrage", "gepruft", "gesture=" + isUserGesture);
            WebView popup = new WebView(MainActivity.this);
            popup.getSettings().setJavaScriptEnabled(true);
            popup.setWebViewClient(new WebViewClient() {
                private boolean handled = false;

                private boolean handlePopupUrl(String url) {
                    if (url == null || url.trim().isEmpty() || url.startsWith("about:blank")) return false;
                    if (handled) return true;
                    handled = true;
                    Provider provider = activeProvider;
                    boolean allowed = isAllowedPopupTarget(provider, url);
                    spur("popup", url, "popup", allowed ? "erlaubt" : "blockiert",
                        allowed
                            ? (isPopupFirstParty(provider, url) ? "erstpartei" : "hoster")
                            : "kein hoster, keine erstpartei");
                    if (allowed) {
                        long jetzt = SystemClock.uptimeMillis();
                        wache.selbstGewaehlt(url, jetzt);
                        wache.ketteEroeffnen(jetzt);
                        view.post(() -> view.loadUrl(url));
                    } else {
                        // Die Hauptseite bleibt, wie sie ist: das Popup hat ein
                        // eigenes, nie eingehaengtes WebView bekommen und
                        // verschwindet gleich mit ihm.
                        //
                        // Und niemand erfaehrt davon. Hier stand ein Toast
                        // ("Popup blockiert"); er ist weg, die Sperre nicht.
                        // Ein geblocktes Popup ist kein Ereignis, das jemanden
                        // etwas angeht - es ist der Normalfall auf diesen
                        // Seiten, und auf einem Fernseher legte sich die
                        // Meldung ueber das laufende Bild. Was geschehen ist,
                        // steht im Debug-Bau in der Spur darueber.
                        Provider betroffen = provider;
                        view.post(() -> {
                            // Ein Popup, das window.open() ohne Adresse aufmacht
                            // und erst danach umleitet, kann die Hauptseite auf
                            // about:blank stehenlassen. Nachsehen, nicht hoffen.
                            rettungWennGestrandet(view, betroffen);
                        });
                    }
                    // Never destroy a WebView synchronously from within its own WebViewClient
                    // callback -- the Chromium engine is still unwinding this exact call frame,
                    // and doing so can crash the whole app natively. Defer it to the next loop tick.
                    popup.post(() -> {
                        try {
                            popup.stopLoading();
                            popup.destroy();
                        } catch (Exception ignored) {
                        }
                    });
                    return true;
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView popupView, WebResourceRequest request) {
                    return handlePopupUrl(request.getUrl().toString());
                }

                @Override
                public void onPageStarted(WebView popupView, String url, android.graphics.Bitmap favicon) {
                    handlePopupUrl(url);
                }
            });
            view.postDelayed(() -> {
                try {
                    popup.destroy();
                } catch (Exception ignored) {
                }
            }, 5000);
            WebView.WebViewTransport transport = (WebView.WebViewTransport) transportObj;
            transport.setWebView(popup);
            resultMsg.sendToTarget();
            return true;
        }

        @Override
        public boolean onJsAlert(WebView view, String url, String message, android.webkit.JsResult result) {
            result.cancel();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, android.webkit.JsResult result) {
            result.cancel();
            return true;
        }

        @Override
        public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, android.webkit.JsPromptResult result) {
            result.cancel();
            return true;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            request.deny();
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            showFullscreen(view, callback);
        }

        @Override
        public void onHideCustomView() {
            hideFullscreen();
        }
    }
}
