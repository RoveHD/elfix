package local.elflix.android;

import java.net.URI;

/** Diese Origin gehoert ausschliesslich der lokalen, isolierten Sprachansicht. */
final class SprachchatSicherheit {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    static final String SEITE = ORIGIN + "/assets/sprachchat/sprachchat.html";

    static boolean originErlaubt(String wert) {
        try {
            URI uri = new URI(wert == null ? "" : wert);
            return "https".equals(uri.getScheme())
                && "appassets.androidplatform.net".equals(uri.getHost())
                && uri.getPort() == -1 && uri.getRawUserInfo() == null
                && (uri.getRawPath() == null || uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath()))
                && uri.getRawQuery() == null && uri.getRawFragment() == null;
        } catch (Exception falsch) { return false; }
    }

    static boolean audioErlaubt(String origin, String[] resources, boolean erlaubnis) {
        return erlaubnis && originErlaubt(origin) && resources != null && resources.length == 1
            && "android.webkit.resource.AUDIO_CAPTURE".equals(resources[0]);
    }

    static boolean assetErlaubt(String wert) {
        try {
            URI uri = new URI(wert == null ? "" : wert);
            if (!originErlaubt(new URI(uri.getScheme(), uri.getRawAuthority(), null, null, null).toString())) return false;
            String pfad = uri.getPath();
            if (pfad == null || !pfad.startsWith("/assets/sprachchat/")) return false;
            String datei = pfad.substring("/assets/sprachchat/".length());
            return java.util.Arrays.asList("sprachchat.html", "sprachchat.css", "sprachchat-host.js",
                "sprachchat-ui.js", "sprachchat.js").contains(datei)
                && uri.getRawQuery() == null && uri.getRawFragment() == null;
        } catch (Exception falsch) { return false; }
    }

    private SprachchatSicherheit() { }
}
