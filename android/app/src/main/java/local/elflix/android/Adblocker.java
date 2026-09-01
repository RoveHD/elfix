package local.elflix.android;

import android.content.Context;
import android.net.Uri;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

public final class Adblocker {
    private static volatile Set<String> adGuardDomains = Collections.emptySet();
    private static final AtomicBoolean adGuardLoading = new AtomicBoolean(false);

    /**
     * Uebernimmt eine frisch geladene Liste.
     *
     * <p>Wird von {@link Filterlisten} gerufen, sobald der Abruf durch ist.
     * Der Austausch ist ein einziger Zeigerwechsel auf ein fertiges Set -
     * waehrenddessen filtert die alte Liste weiter, und es gibt keinen
     * Augenblick, in dem gar nichts blockt.
     */
    public static void uebernimmGeladeneDomains(Set<String> domains) {
        if (domains == null || domains.isEmpty()) return;
        adGuardDomains = domains;
    }

    /**
     * Laedt die Liste: zuerst die abgelegte, sonst die mitgelieferte.
     *
     * <p>Die mitgelieferte ist der Notnagel - sie altert mit der App, und
     * Werbenetze wechseln ihre Adressen schneller als ELFIX erscheint.
     */
    public static void loadAdGuardList(Context context) {
        if (!adGuardDomains.isEmpty() || !adGuardLoading.compareAndSet(false, true)) {
            return;
        }
        Context appContext = context.getApplicationContext();
        new Thread(() -> {
            Set<String> abgelegt = Filterlisten.geladene(appContext);
            if (!abgelegt.isEmpty()) {
                adGuardDomains = abgelegt;
                return;
            }
            Set<String> loaded = new HashSet<>(150_000);
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                    appContext.getAssets().open("adguard_blocklist.txt"), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    String domain = line.trim().toLowerCase();
                    if (domain.isEmpty() || domain.startsWith("#")) continue;
                    loaded.add(domain);
                }
            } catch (Exception ignored) {
                // Keep the curated fallback lists below if the bundled filter list can't be read.
            }
            adGuardDomains = loaded;
        }, "adguard-filter-loader").start();
    }

    public static int loadedAdGuardRuleCount() {
        return adGuardDomains.size();
    }

    private final Set<String> adDomains = new HashSet<>(Arrays.asList(
        "doubleclick.net",
        "googlesyndication.com",
        "googleadservices.com",
        "adservice.google.com",
        "taboola.com",
        "outbrain.com",
        "scorecardresearch.com",
        "adnxs.com",
        "pubmatic.com",
        "rubiconproject.com",
        "criteo.com",
        "zedo.com",
        "popads.net",
        "popcash.net",
        "onclickads.net",
        "propellerads.com",
        "adsterra.com",
        "exoclick.com",
        "trafficjunky.net",
        "juicyads.com",
        "hilltopads.net",
        "clickadu.com",
        "adnium.com",
        "adskeeper.co.uk",
        "adskeeper.com",
        "mgid.com",
        "revcontent.com",
        "yllix.com",
        "popunder.net",
        "popunder.ru",
        "ad-maven.com",
        "adnami.io",
        "adform.net",
        "smartadserver.com",
        "openx.net",
        "bidgear.com",
        "bidswitch.net",
        "creativecdn.com",
        "serving-sys.com",
        "securepubads.g.doubleclick.net"
    ));

    private final Set<String> trackers = new HashSet<>(Arrays.asList(
        "google-analytics.com",
        "googletagmanager.com",
        "facebook.net",
        "hotjar.com",
        "mixpanel.com",
        "segment.io",
        "clarity.ms",
        "amplitude.com",
        "histats.com",
        "statcounter.com",
        "quantserve.com",
        "matomo.cloud",
        "onesignal.com",
        "pushengage.com"
    ));

    /**
     * Ad networks that inject full-screen overlays into a hoster's player frame -- the fake
     * "confirm you are not a robot" captcha, the "clean your phone" panel and the gambling banner.
     *
     * These are separated from the ordinary lists for two reasons. They must be blocked even inside
     * the hoster frame, where filtering is otherwise relaxed so the player keeps working, and they
     * must be blocked even when the request looks like a harmless asset: measured on VOE, the
     * overlay's stylesheet and tracking pixel arrive as CSS/GIF and were therefore waved through by
     * the page-critical bypass. Identified from the request log rather than guessed:
     *   cdn.show-sb.com   /sb/notifications/gambling/default/custom-banner/8-1/index.html
     *   cdn.redgarto.com  /sb/notifications/.../js/script.js, /css/style.css
     *   portalfluently.com/sfp.js, flushpersist.com/pxf.gif
     */
    private static final Set<String> overlayAdDomains = new HashSet<>(Arrays.asList(
        "show-sb.com",
        "redgarto.com",
        "portalfluently.com",
        "flushpersist.com"
    ));

    /**
     * Die kuratierten Kernlisten als ein Satz Namen.
     *
     * <p>Fuer zwei Stellen, die dieselbe Frage anders brauchen als
     * {@link #istWerbeHost}: die Anfrageprüfung vor der Ausnahme fuer
     * Seitenbestandteile ({@link #istKernWerbeAnfrage}) und die kosmetische
     * Filterung im Fernseher ({@link Werbeschichten}), die eine Liste
     * <em>in die Seite</em> reichen muss und deshalb eine kurze braucht.
     *
     * <p>Ausdruecklich nur die kuratierten Listen und nicht die ~140.000
     * Domains der AdGuard-Liste: die geht nicht durch eine
     * {@code evaluateJavascript}-Grenze, und im Rahmen des Hosters ist sie aus
     * gutem Grund ohnehin nicht in Kraft (siehe {@link #blockReason}).
     */
    public Set<String> kernWerbeWirte() {
        Set<String> alle = new HashSet<>(adDomains.size() + trackers.size() + overlayAdDomains.size());
        alle.addAll(adDomains);
        alle.addAll(trackers);
        alle.addAll(overlayAdDomains);
        return Collections.unmodifiableSet(alle);
    }

    /**
     * Ob diese Anfrage schon an den kuratierten Kernlisten scheitert.
     *
     * <p>Der Unterschied zu {@link #blockReason} ist die Stelle, an der
     * gefragt wird: {@code isPageCriticalRequest} laesst Bilder, Stilblaetter
     * und Schriften ungeprueft durch, damit eine Seite nicht daran
     * zerbricht. Genau darin kamen die beiden Werbekarten oben rechts herein -
     * ihr Bild und ihr Stilblatt sind formal Seitenbestandteile.
     *
     * <p>Deshalb hier dieselbe Frage vor jener Ausnahme, aber ausschliesslich
     * gegen die kuratierten Listen: was dort steht, ist ein Werbenetz und
     * kein Bestandteil einer Anbieterseite. Die grosse Liste bleibt draussen -
     * sie ist breit genug, um ein Bild des Anbieters mitzunehmen.
     */
    public boolean istKernWerbeAnfrage(String url, Provider provider) {
        if (provider == null || !provider.adblockEnabled) return false;
        if (isChallengeOrVerificationUrl(url, provider)) return false;
        String host = host(url);
        if (host.isEmpty() || isFirstParty(host, provider)) return false;
        if (isLikelyVideoPlayerUrl(url, host)) return false;
        return matchesAny(host, adDomains)
            || matchesAny(host, trackers)
            || matchesAny(host, overlayAdDomains);
    }

    /**
     * True for the intrusive overlay creatives above. Matched by host and additionally by the ad
     * product's own path, so a rotated CDN domain is still caught.
     */
    public static boolean isIntrusiveOverlayRequest(String url) {
        if (url == null || url.isEmpty()) return false;
        String host = host(url);
        if (!host.isEmpty() && matchesAny(host, overlayAdDomains)) return true;
        String path = url.toLowerCase();
        return path.contains("/sb/notifications/") || path.contains("/custom-banner/");
    }

    public boolean shouldBlock(String url, Provider provider) {
        return shouldBlock(url, provider, false);
    }

    /**
     * When {@code hosterFrame} is true the request comes from the video hoster's own document
     * rather than from the provider's page, and only the curated core lists apply. Hosters such
     * as VOE verify that their own scripts loaded and refuse to play otherwise; the ~140k-domain
     * AdGuard list is broad enough to catch one of those (it blocked FingerprintJS on
     * openfpcdn.io), which the hoster then reports as "ad blockers are not allowed".
     * The provider's own pages keep the full list, so browsing stays ad-filtered.
     */
    public boolean shouldBlock(String url, Provider provider, boolean hosterFrame) {
        return blockReason(url, provider, hosterFrame) != null;
    }

    /**
     * True when {@code referer} names a document that is not the provider's own site -- i.e. the
     * request was issued from an embedded third-party frame, which on these providers is the
     * video hoster's player. Deliberately not matched against hoster names: VOE serves its
     * player from rotating throwaway domains (observed: nicolehappyoutside.com), so any
     * name-based list would be wrong the next day.
     */
    public static boolean isEmbeddedThirdPartyFrame(String referer, Provider provider) {
        if (referer == null || referer.trim().isEmpty() || provider == null) return false;
        String refererHost = host(referer);
        if (refererHost.isEmpty()) return false;
        return !isFirstParty(refererHost, provider);
    }

    /**
     * Same decision as {@link #shouldBlock}, but returns which rule matched (or null to allow).
     * Having the reason available is what makes "why did this page break?" answerable from a log
     * instead of by guesswork.
     */
    public String blockReason(String url, Provider provider, boolean hosterFrame) {
        return blockReason(url, provider, hosterFrame, null);
    }

    /**
     * Wie {@link #blockReason(String, Provider, boolean)}, aber mit dem Urteil
     * der vollen Regeln, wenn es fuer diese Anfrage schon vorliegt.
     *
     * @param engineUrteil {@code TRUE} blocken, {@code FALSE} ausdruecklich
     *                     erlaubt, {@code null} kein Urteil
     */
    public String blockReason(String url, Provider provider, boolean hosterFrame, Boolean engineUrteil) {
        if (provider == null || !provider.adblockEnabled) {
            return null;
        }

        if (isChallengeOrVerificationUrl(url, provider)) {
            return null;
        }

        // Eine Ausnahme der Listen ist eine Entscheidung und kein Versehen:
        // @@-Regeln sind der Weg, auf dem Cloudflare Turnstile, hCaptcha und
        // reCAPTCHA durchkommen, ohne dass ELFIX sie kennen muss.
        if (Boolean.FALSE.equals(engineUrteil)) {
            return null;
        }

        String host = host(url);
        if (host.isEmpty() || isFirstParty(host, provider)) {
            return null;
        }

        if (isLikelyVideoPlayerUrl(url, host)) {
            return null;
        }

        // Was die Engine blockt, blockt sie aus einer Regel, die die
        // Domainliste gar nicht ausdruecken kann - im Rahmen des Hosters
        // bleibt es trotzdem bei den engen Kernlisten (siehe unten).
        if (!hosterFrame && Boolean.TRUE.equals(engineUrteil)) return "engine";

        if (matchesAny(host, adDomains)) return "core-ads";
        if (matchesAny(host, trackers)) return "core-trackers";
        // Measured on VOE (2026-08-12): blocking any of its ad partners inside its own frame --
        // imasdk.googleapis.com, cd.connatix.com, static.ads-twitter.com and its rotating ad
        // domains -- makes it show "Ad blockers are not allowed" and refuse to play. Allowing only
        // the FingerprintJS probe was not enough; the detector counts the ad requests themselves.
        // Getting past that would mean defeating the hoster's detection, so inside the hoster frame
        // only the curated core lists apply and its in-frame ad overlays are accepted as the cost
        // of playback. The provider's own pages keep the full list.
        if (!hosterFrame && matchesAny(host, adGuardDomains)) return "adguard-list";
        if (looksLikeAdOrTrackerUrl(url)) return "url-pattern";
        return null;
    }

    public static boolean isLikelyVideoPlayerUrl(String url) {
        return isLikelyVideoPlayerUrl(url, host(url));
    }

    /**
     * Darf ELFIX diesem Ziel seinen Hauptrahmen ueberlassen?
     *
     * <p>Das ist eine andere Frage als {@link #isLikelyVideoPlayerUrl}, auch
     * wenn beide "ist das ein Player?" heissen. Bei einer Ressource ist ein
     * Irrtum billig: was faelschlich durchgelassen wird, ist ein Bild zu viel.
     * Bei einer Navigation kostet derselbe Irrtum die Seite - der Hauptrahmen
     * verlaesst den Anbieter, und was dann dasteht, ist weiss.
     *
     * <p>Genau das ist passiert. Gemessen am 24.08.2026 auf AniWorld: ein
     * Popunder auf {@code blue-ribbonmacadamizeprovide.com} galt als Player,
     * weil der Wirt die Zeichenfolge "vid" enthaelt - in "pro<b>vid</b>e".
     * Danach wanderte der Hauptrahmen ueber cruzswim.org nach crmared.com, und
     * die Folge war weg. Der Player selbst hatte laengst geladen.
     *
     * <p>Deshalb hier strenger: ein Wort zaehlt nur, wenn es einen Namensteil
     * <em>beginnt</em>. {@code voe.sx}, {@code vidmoly.to}, {@code streamtape.com}
     * und {@code player.example.com} bleiben Player;
     * {@code ...macadamizeprovide.com} ist keiner. Dieselbe Lehre, die weiter
     * unten schon fuer die Pfade gezogen wurde - dort hiess der Fall
     * "watchcolleague.com".
     */
    public static boolean isLikelyPlayerNavigation(String url) {
        return istPlayerName(host(url), pathOf(url));
    }

    /**
     * Die Entscheidung ohne Android drumherum - damit sie sich pruefen laesst.
     *
     * <p>{@code Uri} gibt es auf einer nackten JVM nicht; eine Regel, die man
     * nur auf einem Geraet ausprobieren kann, wird nicht ausprobiert.
     */
    static boolean istPlayerName(String host, String path) {
        String wirt = host == null ? "" : host.toLowerCase();
        // Die Schreibweisen von VOE mit Trennern dazwischen: v-o-e, v.o.e.
        if (wirt.matches("(^|.*\\.)v[-.]?o[-.]?e(\\..*|$)")) return true;
        for (String teil : wirt.split("[.-]")) {
            for (String wort : PLAYER_WOERTER) {
                if (teil.startsWith(wort)) return true;
            }
        }
        String pfad = path == null ? "" : path.toLowerCase();
        return pfad.matches(".*(/embed|/player|/watch|/stream|/hoster|/video).*")
            || pfad.matches(".*\\.(m3u8|mp4|webm)$");
    }

    /**
     * Woran ein Hoster in seinem Namen zu erkennen ist.
     *
     * <p>Bewusst dieselben Woerter wie in der lockeren Fassung - der
     * Unterschied liegt nicht in der Liste, sondern darin, wo sie stehen
     * duerfen. Rotierende Wegwerf-Adressen wie {@code tracylocalschool.com}
     * stehen hier ohnehin nicht drin und sollen es auch nicht: sie wechseln
     * taeglich, und der Rahmen des Hosters braucht diese Pruefung gar nicht.
     */
    private static final String[] PLAYER_WOERTER = {
        "voe", "vid", "video", "player", "stream", "filemoon", "filelions",
        "dood", "mixdrop", "streamtape", "vidmoly", "vidoza", "upstream",
        "supervideo", "streamsb", "streamwish", "lulustream", "savefiles",
        "mp4upload", "vidsrc", "embed"
    };

    private static boolean isLikelyVideoPlayerUrl(String url, String host) {
        String targetHost = host == null ? "" : host.toLowerCase();
        if (targetHost.matches(".*(voe|v[-.]?o[-.]?e|vid|video|player|stream|filemoon|filelions|dood|mixdrop|streamtape|vidmoly|vidoza|upstream|supervideo|streamsb|streamwish|lulustream|savefiles|mp4upload|vidsrc|embed).*")) {
            return true;
        }
        // The path markers must be matched against the path alone, never the whole URL. Matching the
        // full URL meant "https://watchcolleague.com/..." satisfied the "/watch" marker, because
        // "//watchcolleague" contains it -- so an ad domain was classified as a player and got
        // forwarded into the main frame. Ad networks pick names like that on purpose.
        String path = pathOf(url).toLowerCase();
        return path.matches(".*(/embed|/player|/watch|/stream|/hoster|/video).*")
            || path.matches(".*\\.(m3u8|mp4|webm)$");
    }

    private static String pathOf(String url) {
        if (url == null || url.isEmpty()) return "";
        try {
            String path = Uri.parse(url).getPath();
            return path == null ? "" : path;
        } catch (Exception malformed) {
            return "";
        }
    }

    public static boolean isChallengeOrVerificationUrl(String url, Provider provider) {
        if (url == null || url.trim().isEmpty()) return false;
        Uri uri;
        try {
            uri = Uri.parse(url);
        } catch (Exception ignored) {
            return false;
        }
        String host = uri.getHost();
        if (host == null) return false;
        host = stripWww(host.toLowerCase());
        String value = url.toLowerCase();
        String path = uri.getPath() == null ? "" : uri.getPath().toLowerCase();
        String query = uri.getQuery() == null ? "" : uri.getQuery().toLowerCase();

        if (host.equals("challenges.cloudflare.com") || host.endsWith(".challenges.cloudflare.com")) return true;
        if ((host.equals("cloudflare.com") || host.endsWith(".cloudflare.com")) && value.matches(".*(turnstile|challenge|cf_chl|cdn-cgi).*")) return true;
        if (host.equals("static.cloudflareinsights.com") && value.matches(".*(turnstile|challenge|cf_chl|cdn-cgi|beacon).*")) return true;
        if (host.equals("hcaptcha.com") || host.endsWith(".hcaptcha.com")) return true;
        if ((host.equals("recaptcha.net") || host.endsWith(".recaptcha.net") || host.equals("gstatic.com") || host.endsWith(".gstatic.com") || host.equals("google.com") || host.endsWith(".google.com"))
            && value.matches(".*(recaptcha|captcha).*")) return true;

        if (provider == null || !isFirstParty(host, provider)) return false;
        if (isStoProvider(provider)) {
            return path.matches("(?i).*/(cdn-cgi|ajax|api|captcha|check|verify|verification|challenge|turnstile|prepare|preparation|video|stream|hoster)(/|$).*")
                || query.matches("(?i).*(turnstile|cf_chl|captcha|verify|verification|challenge|prepare|preparation|hoster).*");
        }
        return path.matches("(?i).*/(cdn-cgi|captcha|check|verify|verification|challenge|turnstile)(/|$).*");
    }

    private static boolean looksLikeAdOrTrackerUrl(String url) {
        String value = url == null ? "" : url.toLowerCase();
        return value.contains("/ads/")
            || value.contains("/adserver")
            || value.contains("/banner")
            || value.contains("/banners")
            || value.contains("/popunder")
            || value.contains("/popup")
            || value.contains("/prebid")
            || value.contains("/vast")
            || value.contains("/vpaid")
            || value.contains("/preroll")
            || value.contains("/sponsor")
            || value.contains("/affiliate")
            || value.contains("/analytics")
            || value.contains("/tracker")
            || value.contains("/tracking")
            || value.contains("/push-notification")
            || value.contains("utm_source=ad")
            || value.contains("ad_type=")
            || value.contains("adformat=");
    }

    /**
     * Ob ein Host fuer Werbung oder Verfolgung steht.
     *
     * <p>Fuer die kosmetische Filterung: {@code istWerbeOverlay} im geteilten
     * Modul fragt danach, um zu entscheiden, ob eine Schicht ueber der Seite
     * wirklich Werbung ist. Am Rechner antwortet dort die Filter-Engine, hier
     * die mitgelieferten Listen - dieselbe Frage, andere Quelle.
     *
     * <p>Geprueft wird der Host samt seiner uebergeordneten Domains, damit
     * {@code werbung.beispiel.de} an {@code beispiel.de} haengenbleibt.
     */
    public boolean istWerbeHost(String host) {
        if (host == null) return false;
        String sauber = host.toLowerCase().trim();
        if (sauber.isEmpty()) return false;
        return matchesAny(sauber, adDomains)
            || matchesAny(sauber, trackers)
            || matchesAny(sauber, adGuardDomains);
    }

    private static boolean matchesAny(String host, Set<String> rules) {
        if (rules.isEmpty()) return false;
        String candidate = host;
        while (true) {
            if (rules.contains(candidate)) return true;
            int dot = candidate.indexOf('.');
            if (dot < 0) return false;
            candidate = candidate.substring(dot + 1);
        }
    }

    private static boolean isFirstParty(String host, Provider provider) {
        String firstParty = host(provider.startUrl);
        if (!firstParty.isEmpty() && (host.equals(firstParty) || host.endsWith("." + firstParty))) return true;
        String name = provider == null || provider.name == null ? "" : provider.name.toLowerCase();
        if (name.contains("aniworld")) return host.contains("aniworld");
        if (isStoProvider(provider)) return host.equals("s.to") || host.endsWith(".s.to") || host.equals(firstParty);
        if (name.contains("filmo")) return host.contains("filmo");
        return false;
    }

    private static String host(String url) {
        try {
            String host = Uri.parse(url).getHost();
            return host == null ? "" : host.toLowerCase();
        } catch (Exception ignored) {
            return "";
        }
    }

    private static boolean isStoProvider(Provider provider) {
        String name = provider == null || provider.name == null ? "" : provider.name.toLowerCase();
        String host = provider == null ? "" : host(provider.startUrl);
        return name.equals("s.to") || name.contains("s.to") || host.equals("s.to") || host.endsWith(".s.to") || host.matches("\\d{1,3}(\\.\\d{1,3}){3}");
    }

    private static String stripWww(String host) {
        return host == null ? "" : host.replaceFirst("^www\\.", "");
    }
}
