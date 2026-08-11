package local.elflix.android;

public final class Provider {
    public String id;
    public String name;
    public String startUrl;
    public String searchUrl;
    public String logo;
    public boolean enabled;
    public boolean adblockEnabled;
    public int sortOrder;
    public String lastUrl = "";

    public String buildSearchUrl(String query) {
        String encoded = android.net.Uri.encode(query == null ? "" : query.trim());
        if (searchUrl != null && searchUrl.contains("{query}") && !isGoogleSiteSearch(searchUrl)) {
            return searchUrl.replace("{query}", encoded);
        }
        return providerSearchTemplate(startUrl).replace("{query}", encoded);
    }

    public static String providerSearchTemplate(String startUrl) {
        try {
            android.net.Uri uri = android.net.Uri.parse(startUrl);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null) return startUrl;
            return scheme + "://" + host + (usesTermSearch(host) ? "/suche?term={query}" : "/search?q={query}");
        } catch (Exception ignored) {
            return startUrl;
        }
    }

    public static String normalizeSearchUrl(String searchUrl, String startUrl) {
        if (searchUrl == null || searchUrl.trim().isEmpty() || isGoogleSiteSearch(searchUrl)) {
            return providerSearchTemplate(startUrl);
        }
        String promoted = searchUrl.replaceFirst("([?&][^=&#]+=)(test|dragonball)(?=(&|#|$))", "$1{query}");
        if (promoted.contains("{query}")) return promoted;
        return providerSearchTemplate(startUrl);
    }

    private static boolean isGoogleSiteSearch(String value) {
        try {
            android.net.Uri uri = android.net.Uri.parse(value.replace("{query}", "test"));
            String host = uri.getHost();
            String q = uri.getQueryParameter("q");
            return host != null && host.endsWith("google.com") && q != null && q.startsWith("site:");
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean usesTermSearch(String host) {
        return host.matches("\\d{1,3}(\\.\\d{1,3}){3}") || host.equals("s.to") || host.endsWith(".s.to");
    }
}
