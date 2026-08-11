package local.elflix.android;

import android.net.Uri;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

public final class Adblocker {
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

    public boolean shouldBlock(String url, Provider provider) {
        if (provider == null || !provider.adblockEnabled) {
            return false;
        }

        if (isChallengeOrVerificationUrl(url, provider)) {
            return false;
        }

        String host = host(url);
        if (host.isEmpty() || isFirstParty(host, provider)) {
            return false;
        }

        if (isLikelyVideoPlayerUrl(url, host)) {
            return false;
        }

        return matches(host, adDomains) || matches(host, trackers) || looksLikeAdOrTrackerUrl(url);
    }

    public static boolean isLikelyVideoPlayerUrl(String url) {
        return isLikelyVideoPlayerUrl(url, host(url));
    }

    private static boolean isLikelyVideoPlayerUrl(String url, String host) {
        String value = url == null ? "" : url.toLowerCase();
        String targetHost = host == null ? "" : host.toLowerCase();
        return targetHost.matches(".*(voe|v[-.]?o[-.]?e|vid|video|player|stream|filemoon|filelions|dood|mixdrop|streamtape|vidmoly|vidoza|upstream|supervideo|streamsb|streamwish|lulustream|savefiles|mp4upload|vidsrc|embed).*")
            || value.matches(".*(/embed|/player|/watch|/stream|/hoster|/video).*")
            || value.matches(".*\\.(m3u8|mp4|webm)(\\?.*)?$");
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

    private static boolean matches(String host, Set<String> rules) {
        for (String rule : rules) {
            if (host.equals(rule) || host.endsWith("." + rule)) {
                return true;
            }
        }
        return false;
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
