package local.elflix.android;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.TextUtils;
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
    private static final long CACHE_CLEANUP_INTERVAL_MS = 15L * 60L * 1000L;
    private final Map<String, WebView> webViews = new HashMap<>();
    private final Adblocker adblocker = new Adblocker();
    private List<Provider> providers;
    private List<Favorite> favorites;
    private Provider activeProvider;
    private String activeFavoriteId;
    private String favoriteProgressMode;
    private LinearLayout appChrome;
    private LinearLayout collapsedChrome;
    private LinearLayout providerRail;
    private FrameLayout content;
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
    private View fullscreenView;
    private WebView fullscreenHostWebView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
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
        WebView.setWebContentsDebuggingEnabled(false);
        providers = ProviderStore.load(this);
        favorites = FavoriteStore.load(this);
        favoriteProgressMode = getSharedPreferences("elflix_settings", MODE_PRIVATE)
            .getString("favorite_progress_mode", "sequential");
        activeProvider = null;
        buildUi();
        clearBrowserCachesPreservingLogin();
        cacheCleanupHandler.postDelayed(cacheCleanupTask, CACHE_CLEANUP_INTERVAL_MS);
        showHome();
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(7, 10, 16));
        setContentView(root);

        collapsedChrome = new LinearLayout(this);
        collapsedChrome.setGravity(Gravity.CENTER_VERTICAL);
        collapsedChrome.setPadding(dp(10), dp(6), dp(10), dp(6));
        collapsedChrome.setBackgroundColor(Color.rgb(12, 17, 26));
        collapsedChrome.setVisibility(View.GONE);
        Button expandButton = textButton("ELFLIX öffnen");
        expandButton.setOnClickListener(view -> setChromeCollapsed(false, true));
        collapsedChrome.addView(expandButton);
        Button collapsedMouseButton = textButton("Maus");
        collapsedMouseButton.setOnClickListener(view -> toggleMouseMode());
        collapsedChrome.addView(collapsedMouseButton);
        root.addView(collapsedChrome, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)));

        appChrome = new LinearLayout(this);
        appChrome.setOrientation(LinearLayout.VERTICAL);
        appChrome.setPadding(dp(14), dp(8), dp(14), dp(6));
        root.addView(appChrome, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setOrientation(LinearLayout.HORIZONTAL);
        HorizontalScrollView topScroll = new HorizontalScrollView(this);
        topScroll.setHorizontalScrollBarEnabled(false);
        topScroll.addView(top);
        appChrome.addView(topScroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        LinearLayout brand = new LinearLayout(this);
        brand.setGravity(Gravity.CENTER_VERTICAL);
        brand.setOrientation(LinearLayout.HORIZONTAL);
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
                "</head><body><img src='elfix_schriftzug.png' alt='Elflix'></body></html>",
            "text/html",
            "UTF-8",
            null
        );
        brand.addView(logo, new LinearLayout.LayoutParams(dp(220), dp(46)));
        top.addView(brand, new LinearLayout.LayoutParams(dp(228), ViewGroup.LayoutParams.MATCH_PARENT));

        Button startButton = textButton("Start");
        startButton.setOnClickListener(view -> showHome());
        top.addView(startButton);

        Button searchButton = textButton("Suche");
        searchButton.setOnClickListener(view -> showGlobalSearch(searchInput.getText().toString().trim()));
        top.addView(searchButton);

        Button favoritesButton = textButton("Favoriten");
        favoritesButton.setOnClickListener(view -> showFavorites());
        top.addView(favoritesButton);

        Button settingsButton = textButton("Settings");
        settingsButton.setOnClickListener(view -> showSettings());
        top.addView(settingsButton);

        Button collapseButton = textButton("Einklappen");
        collapseButton.setOnClickListener(view -> setChromeCollapsed(true, true));
        top.addView(collapseButton);

        LinearLayout searchRow = new LinearLayout(this);
        searchRow.setGravity(Gravity.CENTER_VERTICAL);
        searchRow.setOrientation(LinearLayout.HORIZONTAL);
        appChrome.addView(searchRow, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));
        Button backButton = chromeButton("‹");
        backButton.setOnClickListener(view -> {
            WebView webView = activeProvider == null ? null : webViews.get(activeProvider.id);
            if (webView != null && webView.canGoBack()) webView.goBack();
        });
        searchRow.addView(backButton);
        Button forwardButton = chromeButton("›");
        forwardButton.setOnClickListener(view -> {
            WebView webView = activeProvider == null ? null : webViews.get(activeProvider.id);
            if (webView != null && webView.canGoForward()) webView.goForward();
        });
        searchRow.addView(forwardButton);
        Button reloadButton = chromeButton("↻");
        reloadButton.setOnClickListener(view -> {
            WebView webView = activeProvider == null ? null : webViews.get(activeProvider.id);
            if (webView != null) webView.reload();
        });
        searchRow.addView(reloadButton);
        Button reloadAllButton = chromeButton("⟳");
        reloadAllButton.setOnClickListener(view -> reloadAllWebViews());
        searchRow.addView(reloadAllButton);
        Button homeButton = chromeButton("⌂");
        homeButton.setOnClickListener(view -> {
            if (activeProvider != null) openProvider(activeProvider, activeProvider.startUrl);
        });
        searchRow.addView(homeButton);
        searchInput = new EditText(this);
        searchInput.setSingleLine(true);
        searchInput.setHint("Film, Serie oder Anime suchen...");
        searchInput.setTextColor(Color.WHITE);
        searchInput.setHintTextColor(Color.rgb(160, 170, 185));
        searchInput.setTextSize(20);
        searchInput.setFocusable(true);
        searchInput.setFocusableInTouchMode(true);
        searchInput.setBackground(rounded(Color.rgb(5, 9, 15), 14));
        searchInput.setOnEditorActionListener((view, actionId, event) -> {
            showGlobalSearch(searchInput.getText().toString().trim());
            return true;
        });
        searchRow.addView(searchInput, new LinearLayout.LayoutParams(0, dp(48), 1));
        favoriteButton = chromeButton("♡");
        favoriteButton.setOnClickListener(view -> toggleFavorite());
        searchRow.addView(favoriteButton);
        Button mouseButton = chromeButton("◎");
        mouseButton.setOnClickListener(view -> toggleMouseMode());
        searchRow.addView(mouseButton);
        Button stopButton = chromeButton("×");
        stopButton.setOnClickListener(view -> {
            WebView webView = activeProvider == null ? null : webViews.get(activeProvider.id);
            if (webView != null) webView.stopLoading();
        });
        searchRow.addView(stopButton);
        Button fullscreenButton = chromeButton("⛶");
        fullscreenButton.setOnClickListener(view -> {
            if (fullscreenView == null) getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
            else hideFullscreen();
        });
        searchRow.addView(fullscreenButton);

        HorizontalScrollView railScroll = new HorizontalScrollView(this);
        railScroll.setHorizontalScrollBarEnabled(false);
        providerRail = new LinearLayout(this);
        providerRail.setOrientation(LinearLayout.HORIZONTAL);
        railScroll.addView(providerRail);
        appChrome.addView(railScroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(82)));
        renderProviderRail();

        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
    }

    private void renderProviderRail() {
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
        Button button = new Button(this);
        button.setText(provider.logo + "\n" + provider.name);
        button.setAllCaps(false);
        button.setTextSize(16);
        button.setTextColor(Color.WHITE);
        button.setFocusable(true);
        button.setSingleLine(false);
        button.setEllipsize(TextUtils.TruncateAt.END);
        applyTvFocus(button, provider == activeProvider ? Color.rgb(86, 32, 44) : Color.rgb(28, 36, 50), Color.rgb(112, 48, 62), 17);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(154), dp(56));
        params.setMargins(0, dp(4), dp(10), dp(4));
        button.setLayoutParams(params);
        return button;
    }

    private Button chromeButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(22);
        button.setTextColor(Color.WHITE);
        button.setFocusable(true);
        button.setBackground(rounded(Color.rgb(28, 36, 50), 14));
        applyTvFocus(button, Color.rgb(28, 36, 50), Color.rgb(58, 72, 96), 14);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(48), dp(48));
        params.setMargins(0, 0, dp(8), 0);
        button.setLayoutParams(params);
        return button;
    }

    private Button textButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextSize(16);
        button.setTextColor(Color.WHITE);
        button.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        button.setFocusable(true);
        button.setBackground(rounded(Color.rgb(28, 36, 50), 14));
        applyTvFocus(button, Color.rgb(28, 36, 50), Color.rgb(58, 72, 96), 14);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(Math.max(112, 38 + text.length() * 9)), dp(48));
        params.setMargins(dp(8), 0, 0, 0);
        button.setLayoutParams(params);
        return button;
    }

    private GradientDrawable rounded(int color, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        return drawable;
    }

    private void showHome() {
        if (activeProvider != null) {
            rememberAndPauseMedia(activeProvider.id, webViews.get(activeProvider.id));
        }
        activeProvider = null;
        activeFavoriteId = null;
        renderProviderRail();
        updateFavoriteButton();
        mouseMode = false;
        setMouseCursorVisible(false);
        setChromeCollapsed(false, false);
        content.removeAllViews();
        ScrollView scroll = new ScrollView(this);
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(42), dp(34), dp(42), dp(34));
        page.setBackgroundColor(Color.rgb(7, 10, 16));
        scroll.addView(page, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        content.addView(scroll, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        TextView eyebrow = smallLabel("Elflix");
        page.addView(eyebrow);
        TextView title = titleText("Alles an einem Ort");
        page.addView(title);
        TextView copy = copyText("Deine Streaming-Websites in einer Oberflaeche. Suche global, speichere Favoriten und wechsle Anbieter wie Tabs.");
        page.addView(copy);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER_VERTICAL);
        Button open = textButton("Anbieter oeffnen");
        open.setOnClickListener(view -> openActiveProvider());
        actions.addView(open);
        Button favs = textButton("Favoriten");
        favs.setOnClickListener(view -> showFavorites());
        actions.addView(favs);
        page.addView(actions, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(62)));

        TextView providersTitle = sectionTitle("Deine Anbieter");
        page.addView(providersTitle);
        HorizontalScrollView providerScroll = new HorizontalScrollView(this);
        providerScroll.setHorizontalScrollBarEnabled(false);
        LinearLayout providerRow = new LinearLayout(this);
        providerRow.setOrientation(LinearLayout.HORIZONTAL);
        for (Provider provider : providers) {
            Button card = providerButton(provider);
            bindProviderTabClick(card, provider);
            providerRow.addView(card);
        }
        providerScroll.addView(providerRow);
        page.addView(providerScroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(86)));

        if (!favorites.isEmpty()) {
            page.addView(sectionTitle("Meine Favoriten"));
            for (int i = 0; i < Math.min(4, favorites.size()); i += 1) {
                Favorite favorite = favorites.get(i);
                Button button = favoriteListButton(favorite);
                page.addView(button);
            }
        }
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
        view.setTextSize(42);
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
        button.setBackground(rounded(Color.rgb(28, 36, 50), 18));
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
        button.setOnFocusChangeListener((view, focused) -> {
            view.animate().scaleX(focused ? 1.045f : 1f).scaleY(focused ? 1.045f : 1f).setDuration(120).start();
            view.setBackground(rounded(focused ? focusedColor : normalColor, radiusDp));
        });
    }

    private void setChromeCollapsed(boolean collapsed, boolean moveFocus) {
        chromeCollapsed = collapsed;
        if (appChrome != null) appChrome.setVisibility(collapsed ? View.GONE : View.VISIBLE);
        if (collapsedChrome != null) collapsedChrome.setVisibility(collapsed ? View.VISIBLE : View.GONE);
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
                    button.setBackground(rounded(Color.rgb(28, 36, 50), 18));
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
        ArrayList<SearchResult> results = new ArrayList<>();
        ArrayList<SearchResult> ajaxResults = fetchAjaxSearchResults(provider, searchUrl, query);
        if (!ajaxResults.isEmpty()) return ajaxResults;

        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(searchUrl).openConnection();
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "text/html,application/xhtml+xml");
            connection.setRequestProperty("User-Agent", "Mozilla/5.0 ElflixAndroid/0.2");
            int status = connection.getResponseCode();
            if (status < 200 || status >= 400) return results;

            StringBuilder html = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null && html.length() < 2_000_000) {
                    html.append(line).append('\n');
                }
            }
            return extractLinks(provider, searchUrl, html.toString(), query);
        } catch (Exception ignored) {
            return results;
        } finally {
            if (connection != null) connection.disconnect();
        }
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
        String value = cleanFavoriteTitle(favorite.title, favorite.url);
        if (value.isEmpty()) value = "Favorit";
        String progress = favoriteEpisodeLabel(favorite.url);
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

    private String favoriteEpisodeLabel(String url) {
        EpisodeIdentity identity = episodeIdentity(url);
        if (identity == null) return "";
        if (identity.season > 0) return "Staffel " + identity.season + " Folge " + identity.episode;
        return "Folge " + identity.episode;
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
        try {
            URI uri = new URI(baseUrl).resolve(href);
            String scheme = uri.getScheme();
            if (!"http".equals(scheme) && !"https".equals(scheme)) return "";
            return uri.toString().split("#")[0];
        } catch (Exception ignored) {
            return "";
        }
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
    }

    private void showGlobalSearch(String query) {
        mouseMode = false;
        setMouseCursorVisible(false);
        setChromeCollapsed(false, false);
        content.removeAllViews();
        ScrollView scroll = new ScrollView(this);
        LinearLayout results = new LinearLayout(this);
        results.setOrientation(LinearLayout.VERTICAL);
        results.setPadding(dp(42), dp(32), dp(42), dp(32));
        results.setBackgroundColor(Color.rgb(7, 10, 16));
        scroll.addView(results, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        content.addView(scroll, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        results.addView(smallLabel("Globale Suche"));
        TextView title = new TextView(this);
        title.setText(query.isEmpty() ? "Suchen" : "\"" + query + "\" suchen");
        title.setTextColor(Color.WHITE);
        title.setTextSize(28);
        title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        results.addView(title);
        if (query.isEmpty()) {
            results.addView(copyText("Suchbegriff oben eingeben und Enter druecken."));
        } else {
            TextView loading = copyText("Suche alle Anbieter...");
            results.addView(loading);
            searchAllProviders(query, results, loading);
        }

        results.addView(sectionTitle("Direktsuche"));
        for (Provider provider : providers) {
            Button button = providerButton(provider);
            button.setText(query.isEmpty() ? provider.name : provider.name + " Direktsuche");
            button.setOnClickListener(view -> {
                if (query.isEmpty()) openProvider(provider, provider.lastUrl.isEmpty() ? provider.startUrl : provider.lastUrl);
                else openProvider(provider, provider.buildSearchUrl(query));
            });
            results.addView(button);
        }
    }

    private void showFavorites() {
        mouseMode = false;
        setMouseCursorVisible(false);
        setChromeCollapsed(false, false);
        content.removeAllViews();
        ScrollView scroll = new ScrollView(this);
        LinearLayout results = new LinearLayout(this);
        results.setOrientation(LinearLayout.VERTICAL);
        results.setPadding(dp(42), dp(32), dp(42), dp(32));
        results.setBackgroundColor(Color.rgb(7, 10, 16));
        scroll.addView(results, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        content.addView(scroll, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        results.addView(smallLabel("Elflix"));
        results.addView(titleText("Favoriten"));

        if (favorites.isEmpty()) {
            TextView empty = new TextView(this);
            empty.setText("♡\n\nNoch keine Favoriten\nSpeichere Seiten ueber das Herz im Browser.");
            empty.setGravity(Gravity.CENTER);
            empty.setTextColor(Color.WHITE);
            empty.setTextSize(24);
            results.addView(empty, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
            return;
        }

        for (Favorite favorite : favorites) {
            Button button = favoriteListButton(favorite);
            button.setOnLongClickListener(view -> {
                favorites.remove(favorite);
                FavoriteStore.save(this, favorites);
                showToast("Aus Favoriten entfernt");
                showFavorites();
                return true;
            });
            results.addView(button);
        }
    }

    private void showSettings() {
        mouseMode = false;
        setMouseCursorVisible(false);
        setChromeCollapsed(false, false);
        content.removeAllViews();
        ScrollView scroll = new ScrollView(this);
        LinearLayout results = new LinearLayout(this);
        results.setOrientation(LinearLayout.VERTICAL);
        results.setPadding(dp(42), dp(32), dp(42), dp(32));
        results.setBackgroundColor(Color.rgb(7, 10, 16));
        scroll.addView(results, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        content.addView(scroll, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        results.addView(smallLabel("Elflix"));
        results.addView(titleText("Settings"));
        results.addView(sectionTitle("Wiedergabe"));
        results.addView(copyText("Favoriten koennen automatisch nur zur direkt naechsten Folge springen oder komplett statisch bleiben."));

        Button progressButton = textButton(favoriteProgressLabel());
        progressButton.setOnClickListener(view -> {
            favoriteProgressMode = isStaticFavoriteProgress() ? "sequential" : "static";
            getSharedPreferences("elflix_settings", MODE_PRIVATE)
                .edit()
                .putString("favorite_progress_mode", favoriteProgressMode)
                .apply();
            progressButton.setText(favoriteProgressLabel());
            showToast("Gespeichert");
        });
        results.addView(progressButton);
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
        webView.setWebViewClient(new GuardedWebViewClient(provider));
        webView.setWebChromeClient(new GuardedChromeClient());
        webViews.put(provider.id, webView);
        return webView;
    }

    private void openProvider(Provider provider, String url) {
        openProvider(provider, url, false);
    }

    private void openProvider(Provider provider, String url, boolean preserveFavoriteProgress) {
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
        boolean sameUrl = webView.getUrl() != null && webView.getUrl().equals(url);
        if (!sameUrl) {
            webView.loadUrl(url);
        } else {
            resumeMediaIfNeeded(provider.id, webView);
        }
        setChromeCollapsed(true, false);
        if (mouseMode) setMouseCursorVisible(true);
        webView.requestFocus();
        updateFavoriteButton();
    }

    private void openFavorite(Favorite favorite) {
        Provider provider = null;
        for (Provider item : providers) {
            if (item.id.equals(favorite.providerId)) {
                provider = item;
                break;
            }
        }
        if (provider == null && !providers.isEmpty()) provider = providers.get(0);
        if (provider != null) {
            activeFavoriteId = favorite.id;
            openProvider(provider, favorite.url, true);
        }
    }

    private void toggleFavorite() {
        WebView webView = activeProvider == null ? null : webViews.get(activeProvider.id);
        if (webView == null || webView.getUrl() == null) return;

        Favorite favorite = new Favorite();
        favorite.id = UUID.randomUUID().toString();
        favorite.providerId = activeProvider.id;
        favorite.providerName = activeProvider.name;
        favorite.title = webView.getTitle() == null || webView.getTitle().isEmpty() ? activeProvider.name : webView.getTitle();
        favorite.url = webView.getUrl();
        favorite.favicon = "";
        favorite.thumbnail = "";
        favorite.createdAt = Instant.now().toString();

        int existingIndex = matchingFavoriteIndex(activeProvider, favorite.url);
        if (existingIndex >= 0) {
            Favorite existing = favorites.remove(existingIndex);
            favorite.id = existing.id;
            favorite.createdAt = existing.createdAt == null || existing.createdAt.isEmpty() ? favorite.createdAt : existing.createdAt;
            if (favorite.thumbnail == null || favorite.thumbnail.isEmpty()) favorite.thumbnail = existing.thumbnail;
            favorites.add(0, favorite);
            activeFavoriteId = favorite.id;
            FavoriteStore.save(this, favorites);
            updateFavoriteButton();
            showToast("Favorit aktualisiert");
            return;
        }

        favorites.add(0, favorite);
        activeFavoriteId = favorite.id;
        FavoriteStore.save(this, favorites);
        updateFavoriteButton();
        showToast("Zu Favoriten hinzugefügt");
    }

    private void updateFavoriteButton() {
        if (favoriteButton == null) return;
        if (activeProvider == null || !webViews.containsKey(activeProvider.id)) {
            favoriteButton.setText("♡");
            return;
        }
        WebView webView = webViews.get(activeProvider.id);
        if (webView == null || webView.getUrl() == null) {
            favoriteButton.setText("♡");
            return;
        }
        favoriteButton.setText(matchingFavoriteIndex(activeProvider, webView.getUrl()) >= 0 ? "♥" : "♡");
    }

    private int matchingFavoriteIndex(Provider provider, String url) {
        String normalized = FavoriteStore.normalizeUrl(url == null ? "" : url);
        for (int i = 0; i < favorites.size(); i += 1) {
            if (favoriteMatchesCurrentProviderTitle(favorites.get(i), provider, url, normalized)) return i;
        }
        return -1;
    }

    private boolean favoriteMatchesCurrentProviderTitle(Favorite favorite, Provider provider, String url, String normalized) {
        if (favorite == null || provider == null) return false;
        boolean sameProvider = provider.id.equals(favorite.providerId) || provider.name.equals(favorite.providerName);
        if (!sameProvider) return false;
        if (FavoriteStore.normalizeUrl(favorite.url).equals(normalized)) return true;
        return favoriteReplacementKey(provider, favorite.url).equals(favoriteReplacementKey(provider, url));
    }

    private String favoriteReplacementKey(Provider provider, String url) {
        String providerKey = provider == null ? "" : (provider.id == null || provider.id.isEmpty() ? provider.name : provider.id);
        String slug = mediaSlugFromUrl(url);
        return providerKey.toLowerCase() + ":" + (slug.isEmpty() ? FavoriteStore.normalizeUrl(url == null ? "" : url) : slug);
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

    private void updateActiveFavoriteProgress(Provider provider, String url, String pageTitle) {
        if (activeFavoriteId == null || provider == null || url == null || !isFavoriteProgressUrl(provider, url)) return;
        for (Favorite favorite : favorites) {
            if (!favorite.id.equals(activeFavoriteId) || !favorite.providerId.equals(provider.id)) continue;
            String normalized = FavoriteStore.normalizeUrl(url);
            if (FavoriteStore.normalizeUrl(favorite.url).equals(normalized)) return;
            EpisodeIdentity previousEpisode = episodeIdentity(favorite.url);
            EpisodeIdentity nextEpisode = episodeIdentity(url);
            if (previousEpisode == null || nextEpisode == null) return;

            if (isStaticFavoriteProgress() || !isSequentialFavoriteProgress(previousEpisode, nextEpisode)) {
                activeFavoriteId = null;
                updateFavoriteButton();
                return;
            }

            favorite.url = url;
            String title = pageTitle == null || pageTitle.trim().isEmpty() ? titleFromPath(url) : pageTitle.trim();
            if (!title.isEmpty()) favorite.title = title;
            favorite.providerName = provider.name;
            FavoriteStore.save(this, favorites);
            updateFavoriteButton();
            showToast("Favorit auf " + favoriteProgressTargetLabel(url) + " geändert");
            return;
        }
    }

    private boolean isStaticFavoriteProgress() {
        return "static".equals(favoriteProgressMode);
    }

    private String favoriteProgressLabel() {
        return isStaticFavoriteProgress()
            ? "Favoriten-Fortschritt: Statisch"
            : "Favoriten-Fortschritt: Nur naechste Folge";
    }

    private boolean isSequentialFavoriteProgress(EpisodeIdentity previous, EpisodeIdentity next) {
        if (previous == null || next == null || !previous.key.equals(next.key)) return false;
        if (previous.season == next.season && next.episode == previous.episode + 1) return true;
        return previous.season > 0
            && next.season == previous.season + 1
            && previous.episode > 1
            && next.episode == 1;
    }

    private String favoriteProgressTargetLabel(String url) {
        EpisodeIdentity identity = episodeIdentity(url);
        if (identity == null) return "neue Folge";
        if (identity.season > 0) return "Staffel " + identity.season + " Folge " + identity.episode;
        return "Folge " + identity.episode;
    }

    private EpisodeIdentity episodeIdentity(String value) {
        try {
            URI uri = new URI(value);
            String host = stripWww(uri.getHost());
            String path = uri.getPath();
            if (host.isEmpty() || path == null || path.isEmpty()) return null;
            String[] rawParts = path.split("/");
            ArrayList<String> parts = new ArrayList<>();
            for (String part : rawParts) {
                if (!part.isEmpty()) parts.add(part);
            }

            String mediaSlug = "";
            for (int i = 0; i < parts.size() - 1; i += 1) {
                String part = parts.get(i).toLowerCase();
                if (part.matches("^(stream|serie|film|filme|movie|movies|title)$")) {
                    mediaSlug = parts.get(i + 1).toLowerCase();
                    break;
                }
            }
            if (mediaSlug.isEmpty()) return null;

            int season = 0;
            int episode = 0;
            for (String part : parts) {
                Matcher seasonMatcher = Pattern.compile("^(staffel|season)-(\\d+)$", Pattern.CASE_INSENSITIVE).matcher(part);
                if (seasonMatcher.find()) season = Integer.parseInt(seasonMatcher.group(2));
                Matcher episodeMatcher = Pattern.compile("^(episode|folge)-(\\d+)$", Pattern.CASE_INSENSITIVE).matcher(part);
                if (episodeMatcher.find()) episode = Integer.parseInt(episodeMatcher.group(2));
            }
            if (episode <= 0) return null;
            EpisodeIdentity identity = new EpisodeIdentity();
            identity.key = host + ":" + mediaSlug;
            identity.season = season;
            identity.episode = episode;
            return identity;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static final class EpisodeIdentity {
        String key;
        int season;
        int episode;
    }

    private boolean isFavoriteProgressUrl(Provider provider, String url) {
        try {
            URI uri = new URI(url);
            if (uri.getHost() == null) return false;
            String providerHost = new URI(provider.startUrl).getHost();
            if (!isAllowedResultHost(provider, uri.getHost(), providerHost)) return false;
            String path = uri.getPath() == null || uri.getPath().isEmpty() ? "/" : uri.getPath().replaceAll("/+$", "");
            return !path.equals("/") && !path.matches("(?i).*(^|/)(search|suche|login|register|logout|settings|profile|account)(/|$).*");
        } catch (Exception ignored) {
            return false;
        }
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
        return Adblocker.isLikelyVideoPlayerUrl(url) && !adblocker.shouldBlock(url, provider);
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
        for (WebView webView : webViews.values()) {
            try {
                webView.stopLoading();
                webView.loadUrl("about:blank");
                webView.destroy();
            } catch (Exception ignored) {
            }
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
    }

    @Override
    protected void onResume() {
        super.onResume();
        WebView webView = activeProvider == null ? null : webViews.get(activeProvider.id);
        if (webView != null) webView.onResume();
        if (fullscreenView != null) {
            applyFullscreenSystemUi();
        }
    }

    @Override
    protected void onDestroy() {
        cacheCleanupHandler.removeCallbacks(cacheCleanupTask);
        super.onDestroy();
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
        if (fullscreenView != null) {
            hideFullscreen();
            return;
        }
        WebView webView = activeProvider == null ? null : webViews.get(activeProvider.id);
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (fullscreenView != null && handleFullscreenKey(event)) {
            return true;
        }
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            int keyCode = event.getKeyCode();
            if (mouseMode && handleMouseModeKey(keyCode)) {
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || keyCode == KeyEvent.KEYCODE_SPACE) {
                togglePlayback();
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_SEARCH) {
                setChromeCollapsed(false, false);
                focusSearch();
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_SETTINGS) {
                if (chromeCollapsed) {
                    setChromeCollapsed(false, true);
                    return true;
                }
                showSettings();
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_0 || keyCode == KeyEvent.KEYCODE_INFO || keyCode == KeyEvent.KEYCODE_PROG_RED) {
                toggleMouseMode();
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_BOOKMARK) {
                toggleFavorite();
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_CHANNEL_UP || keyCode == KeyEvent.KEYCODE_PAGE_UP) {
                cycleProvider(-1);
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_CHANNEL_DOWN || keyCode == KeyEvent.KEYCODE_PAGE_DOWN) {
                cycleProvider(1);
                return true;
            }
            if ((keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER) && searchInput != null && searchInput.hasFocus()) {
                showGlobalSearch(searchInput.getText().toString().trim());
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_DPAD_DOWN && isChromeFocused()) {
                setChromeCollapsed(true, false);
                return focusActiveWebView();
            }
        }
        return super.dispatchKeyEvent(event);
    }

    private boolean handleFullscreenKey(KeyEvent event) {
        if (event.getAction() != KeyEvent.ACTION_DOWN) return false;
        int keyCode = event.getKeyCode();
        if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE) {
            hideFullscreen();
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || keyCode == KeyEvent.KEYCODE_SPACE) {
            togglePlayback();
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_CHANNEL_UP
            || keyCode == KeyEvent.KEYCODE_CHANNEL_DOWN
            || keyCode == KeyEvent.KEYCODE_PAGE_UP
            || keyCode == KeyEvent.KEYCODE_PAGE_DOWN
            || keyCode == KeyEvent.KEYCODE_SEARCH
            || keyCode == KeyEvent.KEYCODE_MENU
            || keyCode == KeyEvent.KEYCODE_SETTINGS
            || keyCode == KeyEvent.KEYCODE_INFO
            || keyCode == KeyEvent.KEYCODE_PROG_RED
            || keyCode == KeyEvent.KEYCODE_0) {
            applyFullscreenSystemUi();
            return true;
        }
        return false;
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
            scrollMouseMode(-dp(360));
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_CHANNEL_DOWN || keyCode == KeyEvent.KEYCODE_PAGE_DOWN) {
            scrollMouseMode(dp(360));
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
        WebView webView = currentWebView();
        if (webView != null) {
            installTvWebNavigation(webView);
            setMouseCursorVisible(mouseMode);
            webView.requestFocus();
        }
        if (mouseMode) setChromeCollapsed(true, false);
        showToast(mouseMode ? "Mausmodus: D-Pad bewegen, OK klicken, 0/Info aus" : "Mausmodus aus");
    }

    private int mouseStep() {
        return dp(12);
    }

    private void ensureMouseCursor() {
        if (content == null) return;
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
        if (mouseCursor.getParent() != content) {
            content.addView(mouseCursor, new FrameLayout.LayoutParams(dp(26), dp(26)));
        }
        if (mouseX < 0 || mouseY < 0 || content.getWidth() <= 0 || content.getHeight() <= 0) {
            mouseX = Math.max(dp(24), content.getWidth() / 2f);
            mouseY = Math.max(dp(24), content.getHeight() / 2f);
        }
        updateMouseCursor();
    }

    private void setMouseCursorVisible(boolean visible) {
        if (visible) {
            if (content.getWidth() <= 0 || content.getHeight() <= 0) {
                content.post(() -> setMouseCursorVisible(true));
                return;
            }
            ensureMouseCursor();
            if (mouseCursor != null) mouseCursor.setVisibility(View.VISIBLE);
        } else if (mouseCursor != null) {
            mouseCursor.setVisibility(View.GONE);
        }
    }

    private void updateMouseCursor() {
        if (mouseCursor == null || content == null) return;
        FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) mouseCursor.getLayoutParams();
        params.leftMargin = Math.round(mouseX - dp(13));
        params.topMargin = Math.round(mouseY - dp(13));
        mouseCursor.setLayoutParams(params);
    }

    private void moveMouseCursor(int dx, int dy) {
        if (fullscreenView != null) return;
        WebView webView = currentWebView();
        if (webView == null || content == null) return;
        ensureMouseCursor();
        int width = Math.max(dp(32), content.getWidth());
        int height = Math.max(dp(32), content.getHeight());
        mouseX = Math.max(dp(10), Math.min(width - dp(10), mouseX + dx));
        mouseY = Math.max(dp(10), Math.min(height - dp(10), mouseY + dy));
        updateMouseCursor();
        if (dy < 0 && mouseY <= dp(26)) scrollMouseMode(-dp(80));
        if (dy > 0 && mouseY >= height - dp(26)) scrollMouseMode(dp(80));
        if (dx < 0 && mouseX <= dp(20)) webView.scrollBy(-dp(70), 0);
        if (dx > 0 && mouseX >= width - dp(20)) webView.scrollBy(dp(70), 0);
    }

    private void scrollMouseMode(int dy) {
        if (fullscreenView != null) return;
        WebView webView = currentWebView();
        if (webView == null) return;
        webView.scrollBy(0, dy);
        runTvMouseCommand("scroll", 0, dy);
    }

    private void tapMouseCursor() {
        WebView webView = currentWebView();
        if (webView == null) return;
        ensureMouseCursor();
        long now = SystemClock.uptimeMillis();
        MotionEvent down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, mouseX, mouseY, 0);
        MotionEvent up = MotionEvent.obtain(now, now + 80, MotionEvent.ACTION_UP, mouseX, mouseY, 0);
        webView.dispatchTouchEvent(down);
        webView.dispatchTouchEvent(up);
        down.recycle();
        up.recycle();
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
        WebView webView = currentWebView();
        if (webView != null) webView.evaluateJavascript("document.querySelectorAll('video,audio').forEach(m=>m.paused?m.play():m.pause());", null);
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
        if (fullscreenView != null) {
            if (callback != null) callback.onCustomViewHidden();
            return;
        }
        fullscreenView = view;
        fullscreenHostWebView = currentWebView();
        fullscreenCallback = callback;
        if (mouseMode) {
            mouseMode = false;
            setMouseCursorVisible(false);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        appChrome.setVisibility(View.GONE);
        if (collapsedChrome != null) collapsedChrome.setVisibility(View.GONE);
        lockFullscreenScrolling(fullscreenHostWebView);
        view.setBackgroundColor(Color.BLACK);
        view.setFocusable(true);
        view.setFocusableInTouchMode(true);
        view.setClickable(true);
        content.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER));
        view.bringToFront();
        view.requestFocus();
        applyFullscreenSystemUi();
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
        content.removeView(fullscreenView);
        fullscreenView = null;
        unlockFullscreenScrolling(fullscreenHostWebView);
        fullscreenHostWebView = null;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setChromeCollapsed(chromeCollapsed, false);
        if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
        fullscreenCallback = null;
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(true);
            getWindow().getInsetsController().show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
        } else {
            getWindow().getDecorView().setSystemUiVisibility(0);
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
                + "window.__elflixFullscreenLock={x:scrollX,y:scrollY,html:document.documentElement.style.overflow||'',body:document.body.style.overflow||'',bodyTouch:document.body.style.touchAction||''};"
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
                + "scrollTo(s.x||0,s.y||0);"
                + "delete window.__elflixFullscreenBlock;"
                + "delete window.__elflixFullscreenLock;"
            + "})();",
            null
        );
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private final class GuardedWebViewClient extends WebViewClient {
        private final Provider provider;

        GuardedWebViewClient(Provider provider) {
            this.provider = provider;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) {
                return false;
            }
            String url = request.getUrl().toString();
            if (Adblocker.isChallengeOrVerificationUrl(url, provider)) {
                return false;
            }
            if (shouldBlockProviderNavigation(provider, url)) {
                showToast("Provider-Wechsel blockiert");
                return true;
            }
            return adblocker.shouldBlock(url, provider);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (request.isForMainFrame()) {
                return null;
            }
            if (Adblocker.isChallengeOrVerificationUrl(request.getUrl().toString(), provider)) {
                return null;
            }
            if (isPageCriticalRequest(request)) {
                return null;
            }
            if (adblocker.shouldBlock(request.getUrl().toString(), provider)) {
                return blockedResourceResponse(request);
            }
            return null;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (shouldBlockProviderNavigation(provider, url)) return;
            installTvWebNavigation(view);
            installStoPlayerFix(view, provider);
            provider.lastUrl = url;
            updateActiveFavoriteProgress(provider, url, view.getTitle());
            updateFavoriteButton();
            super.onPageFinished(view, url);
        }
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

    private void installTvWebNavigation(WebView webView) {
        if (webView == null) return;
        String script =
            "(function(){"
                + "if(window.__elflixTvNavV3)return;window.__elflixTvNavV3=true;"
                + "var style=document.createElement('style');"
                + "style.textContent='a:focus,button:focus,input:focus,select:focus,textarea:focus,video:focus,[tabindex]:focus,[role=\"button\"]:focus{outline:3px solid #e50914!important;outline-offset:3px!important;border-radius:10px!important}#__elflixCursor{position:fixed;left:50vw;top:50vh;width:24px;height:24px;margin:-12px 0 0 -12px;border:3px solid #fff;border-radius:999px;background:#e50914;box-shadow:0 0 0 4px rgba(229,9,20,.35),0 8px 26px rgba(0,0,0,.55);z-index:2147483647;pointer-events:none;display:none}#__elflixCursor:after{content:\"\";position:absolute;left:7px;top:7px;width:4px;height:4px;border-radius:99px;background:#fff}';"
                + "document.documentElement.appendChild(style);"
                + "var important='a[href],button,input,select,textarea,video,[role=\"button\"],[tabindex],.vjs-big-play-button,.jw-icon-playback,.plyr__control,[class*=\"play\"],[class*=\"Play\"],[class*=\"watch\"],[class*=\"Watch\"],[class*=\"stream\"],[class*=\"Stream\"]';"
                + "function visible(el){var r=el.getBoundingClientRect();var s=getComputedStyle(el);return r.width>8&&r.height>8&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0';}"
                + "function noise(el){var t=((el.innerText||el.textContent||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.className||'')+' '+(el.id||'')).toLowerCase();return /cookie|datenschutz|privacy|login|register|registrieren|sprache|language|newsletter|werbung|advert|discord|telegram/.test(t)&&!/play|watch|stream|start|episode|folge|staffel|film|movie|video/.test(t);}"
                + "function meaningful(el){if(!visible(el)||noise(el))return false;var tag=el.tagName;var r=el.getBoundingClientRect();var cls=((el.className||'')+' '+(el.id||'')).toLowerCase();if(tag==='VIDEO')return true;if(tag==='A'||tag==='BUTTON'||tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA')return true;if(el.getAttribute('role')==='button'||el.hasAttribute('tabindex'))return true;if(/play|watch|stream|start|episode|folge|staffel|film|movie|video|player/.test(cls))return true;return r.width*r.height>5000&&el.onclick;}"
                + "function items(){return Array.prototype.slice.call(document.querySelectorAll(important+', [onclick]')).filter(function(el){if(el.tabIndex<0)el.tabIndex=0;return meaningful(el);});}"
                + "function center(r){return{x:r.left+r.width/2,y:r.top+r.height/2};}"
                + "function first(){var list=items();if(!list.length)return null;var cx=innerWidth/2,cy=innerHeight/2,b=null,bs=1/0;list.forEach(function(el){var c=center(el.getBoundingClientRect());var s=Math.abs(c.x-cx)+Math.abs(c.y-cy);if(s<bs){bs=s;b=el;}});return b;}"
                + "function move(dir){var list=items();if(!list.length)return false;var active=document.activeElement;if(!active||list.indexOf(active)<0){active=first();if(active){active.focus();active.scrollIntoView({block:'center',inline:'center'});return true;}return false;}var ar=active.getBoundingClientRect();var ac=center(ar);var horizontal=dir==='right'||dir==='left';var best=null;var bestScore=1/0;list.forEach(function(el){if(el===active)return;var r=el.getBoundingClientRect();var c=center(r);var dx=c.x-ac.x;var dy=c.y-ac.y;var primary=dir==='right'?dx:dir==='left'?-dx:dir==='down'?dy:-dy;var orth=horizontal?Math.abs(dy):Math.abs(dx);var overlaps=horizontal?!(r.bottom<ar.top||r.top>ar.bottom):!(r.right<ar.left||r.left>ar.right);if(primary<=8)return;if(!overlaps&&orth>primary*1.15)return;var score=primary+(overlaps?orth*.25:orth*2.8);if(score<bestScore){bestScore=score;best=el;}});if(best){best.focus();best.scrollIntoView({block:'center',inline:'center'});return true;}return false;}"
                + "function fire(el,x,y){if(!el)return;var tag=el.tagName;if(tag==='VIDEO'){try{el.paused?el.play():el.pause();return;}catch(e){}}['pointerdown','mousedown','mouseup','click'].forEach(function(type){try{el.dispatchEvent(new MouseEvent(type,{view:window,bubbles:true,cancelable:true,clientX:x||center(el.getBoundingClientRect()).x,clientY:y||center(el.getBoundingClientRect()).y}));}catch(e){}});}"
                + "function activate(el){if(!el||el===document.body)return false;var target=el.closest&&el.closest(important)||el;fire(target);return true;}"
                + "var cur={x:innerWidth/2,y:innerHeight/2};function cursor(){var el=document.getElementById('__elflixCursor');if(!el){el=document.createElement('div');el.id='__elflixCursor';document.documentElement.appendChild(el);}return el;}function paint(){var el=cursor();el.style.left=cur.x+'px';el.style.top=cur.y+'px';}"
                + "window.__elflixTvMouse=function(action,dx,dy){var c=cursor();if(action==='show'){c.style.display='block';paint();return true;}if(action==='hide'){c.style.display='none';return true;}if(action==='scroll'){window.scrollBy({top:dy||0,left:dx||0,behavior:'smooth'});return true;}if(action==='move'){c.style.display='block';cur.x=Math.max(8,Math.min(innerWidth-8,cur.x+(dx||0)));cur.y=Math.max(8,Math.min(innerHeight-8,cur.y+(dy||0)));if(cur.y<34&&dy<0)window.scrollBy({top:-120,behavior:'smooth'});if(cur.y>innerHeight-34&&dy>0)window.scrollBy({top:120,behavior:'smooth'});if(cur.x<28&&dx<0)window.scrollBy({left:-120,behavior:'smooth'});if(cur.x>innerWidth-28&&dx>0)window.scrollBy({left:120,behavior:'smooth'});paint();return true;}if(action==='click'){if(dx>0)cur.x=Math.max(8,Math.min(innerWidth-8,dx));if(dy>0)cur.y=Math.max(8,Math.min(innerHeight-8,dy));c.style.display='block';paint();var old=c.style.display;c.style.display='none';var el=document.elementFromPoint(cur.x,cur.y);c.style.display=old;var target=el&&el.closest&&el.closest(important+', [onclick]')||el;if(target){try{target.focus();}catch(e){}fire(target,cur.x,cur.y);}return true;}return false;};"
                + "document.addEventListener('keydown',function(e){var map={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'};if(map[e.key]&&move(map[e.key])){e.preventDefault();e.stopPropagation();return;}if((e.key==='Enter'||e.key===' ')&&activate(document.activeElement)){e.preventDefault();e.stopPropagation();}},true);"
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
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
            WebView popup = new WebView(MainActivity.this);
            popup.getSettings().setJavaScriptEnabled(true);
            popup.setWebViewClient(new WebViewClient() {
                private boolean handled = false;

                private boolean handlePopupUrl(String url) {
                    if (url == null || url.trim().isEmpty() || url.startsWith("about:blank")) return false;
                    if (handled) return true;
                    handled = true;
                    try {
                        popup.stopLoading();
                        popup.destroy();
                    } catch (Exception ignored) {
                    }
                    Provider provider = activeProvider;
                    if (isAllowedPopupTarget(provider, url)) {
                        view.post(() -> view.loadUrl(url));
                    } else {
                        view.post(() -> showToast("Popup blockiert"));
                    }
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
            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
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
