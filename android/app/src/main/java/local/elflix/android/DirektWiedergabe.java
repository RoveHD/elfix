package local.elflix.android;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Consumer;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Reads provider pages as data and gives resolved media to the native player. */
final class DirektWiedergabe {
    interface Umgebung {
        void geschlossen();
        void browser(Provider anbieter, String adresse);
        void stand(Provider anbieter, String adresse, JSONObject messung, JSONObject meta);
        void live(JSONObject wert, String aktion);
        void bereit(String adresse);
        boolean darfAutoplay();
        void marke(Consumer<JSONObject> fertig);
        void sprung(double von, double nach);
    }

    private final Activity activity;
    private final Kern kern;
    private final Umgebung umgebung;
    private final Provider anbieter;
    private final String adresse;
    private final String titel;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Adblocker filter = new Adblocker();
    private final DirektSpieler spieler;
    private final FrameLayout wurzel;
    private final String kennung;
    private WebView seite;
    private AlertDialog dialog;
    private boolean geschlossen;
    private int auftrag;
    private JSONArray hoster = new JSONArray();
    private JSONObject folgen = new JSONObject();
    private JSONObject naechste;
    private JSONObject meta = new JSONObject();
    private final double start;
    private boolean spielt;
    private boolean versucht;
    private String letzteSprache = "";
    private Consumer<String> nachSeite;

    static boolean passt(String adresse) {
        if (adresse == null) return false;
        try {
            Uri url = Uri.parse(adresse);
            if (!"https".equals(url.getScheme()) && !"http".equals(url.getScheme())) return false;
            String host = url.getHost();
            if (host == null || host.equals("youtu.be") || host.endsWith("youtube.com")) return false;
            String pfad = url.getPath();
            return pfad != null && (pfad.matches(".*/(?:staffel|season)-[0-9]+/(?:episode|folge)-[0-9]+/?")
                || pfad.matches("/(?:movies|movie|filme|film)/[^/]+/?"));
        } catch (Exception ignoriert) { return false; }
    }

    DirektWiedergabe(Activity activity, Kern kern, Provider anbieter, String adresse,
                     String titel, double start, Umgebung umgebung) {
        this.activity = activity;
        this.kern = kern;
        this.anbieter = anbieter;
        this.adresse = adresse;
        this.titel = titel;
        this.start = start;
        this.umgebung = umgebung;
        kennung = WebSettings.getDefaultUserAgent(activity);
        spieler = new DirektSpieler(activity, kern, new DirektSpieler.Umgebung() {
            public void schliessen() { umgebung.geschlossen(); }
            public void quellen() { quellenZeigen(); }
            public void folgen() { folgenZeigen(folgen); }
            public void naechste() { if (naechste != null) wechseln(naechste.optString("url")); }
            public void stand(JSONObject wert) { umgebung.stand(anbieter, adresse, wert, meta); }
            public void live(JSONObject wert, String aktion) { umgebung.live(wert, aktion); }
            public void bereit() { umgebung.bereit(adresse); }
            public boolean darfAutoplay() { return umgebung.darfAutoplay(); }
            public void marke(Consumer<JSONObject> fertig) { umgebung.marke(fertig); }
            public void sprung(double von, double nach) { umgebung.sprung(von, nach); }
        });
        wurzel = spieler.ansicht;
        spieler.titel(titel);
        ((ViewGroup) activity.getWindow().getDecorView()).addView(wurzel, new ViewGroup.LayoutParams(-1, -1));
        laden();
    }

    private void laden() {
        final int id = ++auftrag;
        kern.rufe("direkt-android.abbrechen", (w, f) -> { });
        spieler.status("Folgenseite wird gelesen …");
        seiteLaden(adresse, id, () -> lesen(id));
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void seiteLaden(String url, int id, Runnable fertig) {
        seiteLaden(url, id, fertig, null);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void seiteLaden(String url, int id, Runnable fertig, Consumer<String> beobachter) {
        seiteFreigeben();
        if (!aktuell(id)) return;
        WebView view = new WebView(activity);
        seite = view;
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUserAgentString(kennung);
        settings.setMediaPlaybackRequiresUserGesture(beobachter == null);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, true);
        view.setWebChromeClient(new WebChromeClient());
        view.setDownloadListener((u, agent, disposition, mime, size) -> { });
        if (beobachter != null && androidx.webkit.WebViewFeature.isFeatureSupported(
            androidx.webkit.WebViewFeature.DOCUMENT_START_SCRIPT)) {
            androidx.webkit.WebViewCompat.addDocumentStartJavaScript(view,
                "(()=>{const p=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){this.muted=true;this.volume=0;return p.apply(this,arguments)}})()",
                java.util.Collections.singleton("*"));
        }
        view.setWebViewClient(new WebViewClient() {
            private boolean gelesen;
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                String scheme = r.getUrl().getScheme();
                return !"https".equals(scheme) && !"http".equals(scheme);
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                String requestUrl = r.getUrl().toString();
                if (beobachter != null && requestUrl.toLowerCase(java.util.Locale.ROOT).matches(".*\\.m3u8(?:[?#].*)?")) {
                    handler.post(() -> { if (seite == view && aktuell(id)) beobachter.accept(requestUrl); });
                }
                if (!r.isForMainFrame() && filter.shouldBlock(r.getUrl().toString(), anbieter)) {
                    return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
                }
                return null;
            }
            @Override public void onPageFinished(WebView v, String u) {
                if (gelesen || seite != view || !aktuell(id) || "about:blank".equals(u)) return;
                gelesen = true;
                fertig.run();
            }
        });
        // Attached for JavaScript rendering, behind the opaque playback surface.
        wurzel.addView(view, 0, new FrameLayout.LayoutParams(1, 1));
        view.loadUrl(url);
        handler.postDelayed(() -> {
            if (seite == view && aktuell(id) && hoster.length() == 0 && !spielt) {
                spieler.status("Die Seite liefert noch keine Quellen. Unter Quellen erneut versuchen oder die Anbieterseite öffnen.");
            }
        }, 25000);
    }

    private boolean aktuell(int id) { return !geschlossen && auftrag == id; }

    private void skript(String funktion, int id, Consumer<String> fertig) {
        kern.rufe(funktion, (wert, fehler) -> {
            if (!aktuell(id)) return;
            try { fertig.accept(new JSONTokener(wert == null ? "null" : wert).nextValue().toString()); }
            catch (Exception e) { spieler.status("Die Quellen-Erkennung konnte nicht geladen werden."); }
        });
    }

    private void lesen(int id) { lesen(id, SystemClock.uptimeMillis() + 20000); }

    private void lesen(int id, long frist) {
        WebView view = seite;
        skript("seitendaten.uebersichtSkript", id, script -> {
            if (seite != view) return;
            view.evaluateJavascript(script, wert -> {
                if (!aktuell(id) || seite != view) return;
                try {
                    folgen = new JSONObject(wert);
                    String name = folgen.optString("titel", "");
                    if (!name.isEmpty()) spieler.titel(name + " · " + Folgen.folgenText(adresse));
                } catch (Exception ignoriert) { }
            });
        });
        skript("seitendaten.seitenSkript", id, script -> {
            if (seite != view) return;
            view.evaluateJavascript(script, wert -> {
                if (!aktuell(id) || seite != view) return;
                try { meta = new JSONObject(wert); } catch (Exception ignoriert) { }
                // Video metrics belong to the native player; only page metadata is used.
                for (String feld : new String[] { "currentTime", "duration", "playedSeconds", "ended", "position", "progress" }) meta.remove(feld);
            });
        });
        skript("direktlinks.hosterlinkScript", id, script -> {
            if (seite != view) return;
            String schluessel = "__elfixDirekt" + id;
            view.evaluateJavascript("window." + schluessel + "=null;Promise.resolve(" + script
                + ").then(function(v){window." + schluessel + "=v},function(){window." + schluessel + "='[]'})", null);
            linksAbholen(view, schluessel, id, frist);
        });
    }

    private void linksAbholen(WebView view, String key, int id, long frist) {
        if (!aktuell(id) || seite != view) return;
        view.evaluateJavascript("window." + key, wert -> {
            if (!aktuell(id) || seite != view) return;
            if (wert == null || "null".equals(wert)) {
                if (SystemClock.uptimeMillis() < frist) handler.postDelayed(() -> linksAbholen(view, key, id, frist), 250);
                else spieler.status("Quellen konnten nicht gelesen werden. Unter Quellen erneut versuchen.");
                return;
            }
            try {
                JSONArray roh = new JSONArray(new JSONTokener(wert).nextValue().toString());
                if (roh.length() == 0 && SystemClock.uptimeMillis() < frist) {
                    handler.postDelayed(() -> {
                        if (aktuell(id) && seite == view) lesen(id, frist);
                    }, 1000);
                    return;
                }
                kern.rufe("direkt-android.ordnen", Kern.args(roh, letzteSprache), (geordnet, fehler) -> {
                    if (!aktuell(id)) return;
                    try { hoster = new JSONArray(geordnet); } catch (Exception ignoriert) { hoster = roh; }
                    if (hoster.length() == 0) {
                        spieler.status("Keine Direktquelle gefunden. Unter Quellen erneut versuchen oder die Anbieterseite öffnen.");
                    } else if (!versucht) {
                        versucht = true;
                        aufloesen(0, start, id, true);
                    } else quellenDialog();
                });
            } catch (Exception e) { spieler.status("Die Quellenliste ist nicht lesbar. Unter Quellen erneut versuchen."); }
        });
    }

    private void aufloesen(int index, double stelle, int id, boolean automatisch) {
        if (!aktuell(id)) return;
        JSONObject link = hoster.optJSONObject(index);
        if (link == null) {
            spieler.status("Keiner der Hoster lieferte eine Direktquelle. Unter Quellen einen Hoster wählen oder die Anbieterseite öffnen.");
            return;
        }
        spieler.wechselPause();
        spieler.status("Direktquelle wird aufgelöst: " + link.optString("hoster", "Hoster") + " …");
        kern.rufe("direkt-android.aufloesen", Kern.args(link.optString("adresse"), adresse, kennung), (wert, fehler) -> {
            if (!aktuell(id)) return;
            try {
                JSONObject ergebnis = new JSONObject(wert);
                if (uebernehmen(ergebnis, link, stelle, id)) return;
                String ziel = ergebnis.optString("seite", "");
                if (!ziel.isEmpty()) {
                    beobachten(ziel, link, stelle, id, () -> weitererHoster(index, stelle, id, automatisch));
                    return;
                }
            } catch (Exception ignoriert) { }
            weitererHoster(index, stelle, id, automatisch);
        });
    }

    private void weitererHoster(int index, double stelle, int id, boolean automatisch) {
        if (!aktuell(id)) return;
        if (automatisch && index + 1 < Math.min(hoster.length(), 6)) aufloesen(index + 1, stelle, id, true);
        else spieler.status("Dieser Hoster liefert keine Direktquelle. Unter Quellen einen anderen wählen oder die Anbieterseite öffnen.");
    }

    private boolean uebernehmen(JSONObject ergebnis, JSONObject link, double stelle, int id) {
        JSONObject quelle = ergebnis.optJSONObject("quelle");
        if (!aktuell(id) || !ergebnis.optBoolean("ok") || quelle == null) return false;
        String url = quelle.optString("adresse");
        if (!url.startsWith("https://") && !url.startsWith("http://")) return false;
        Map<String, String> kopf = new HashMap<>();
        JSONObject headers = ergebnis.optJSONObject("kopfzeilen");
        if (headers != null) for (java.util.Iterator<String> keys = headers.keys(); keys.hasNext();) {
            String key = keys.next();
            kopf.put(key, headers.optString(key));
        }
        letzteSprache = link.optString("sprache");
        seiteFreigeben();
        spieler.quelle(url, quelle.optString("typ"), kopf, stelle);
        spielt = true;
        naechsteSuchen(id);
        return true;
    }

    private void beobachten(String url, JSONObject link, double stelle, int id, Runnable weiter) {
        if (!androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.DOCUMENT_START_SCRIPT)) {
            weiter.run();
            return;
        }
        spieler.status("Stream wird erkannt: " + link.optString("hoster") + " …");
        java.util.Set<String> gesehen = new java.util.HashSet<>();
        java.util.ArrayDeque<String> wartend = new java.util.ArrayDeque<>();
        boolean[] fertig = { false };
        boolean[] prueft = { false };
        Runnable[] pruefen = new Runnable[1];
        pruefen[0] = () -> {
            if (fertig[0] || prueft[0] || wartend.isEmpty() || !aktuell(id)) return;
            prueft[0] = true;
            String kandidat = wartend.removeFirst();
            String herkunft = seite == null || seite.getUrl() == null ? url : seite.getUrl();
            kern.rufe("direkt-android.pruefen", Kern.args(kandidat, herkunft, kennung), (wert, fehler) -> {
                prueft[0] = false;
                if (fertig[0] || !aktuell(id)) return;
                try {
                    JSONObject ergebnis = new JSONObject(wert);
                    if (ergebnis.optBoolean("ok")) {
                        fertig[0] = true;
                        uebernehmen(ergebnis, link, stelle, id);
                        return;
                    }
                } catch (Exception ignoriert) { }
                pruefen[0].run();
            });
        };
        seiteLaden(url, id, () -> {
            if (seite != null) seite.evaluateJavascript(
                "(()=>{for(const v of document.querySelectorAll('video')){v.muted=true;v.volume=0;v.play().catch(()=>{})}"
                + "const b=document.querySelector('.vjs-big-play-button,.jw-icon-display,[aria-label=Play]');if(b)b.click()})()", null);
        }, kandidat -> {
            if (fertig[0] || gesehen.size() >= 8 || !gesehen.add(kandidat)) return;
            wartend.add(kandidat);
            pruefen[0].run();
        });
        handler.postDelayed(() -> {
            if (fertig[0] || !aktuell(id)) return;
            fertig[0] = true;
            kern.rufe("direkt-android.abbrechen", (w, f) -> { });
            seiteFreigeben();
            weiter.run();
        }, 20000);
    }

    private void quellenZeigen() {
        if (geschlossen) return;
        quellenDialog();
    }

    private void quellenDialog() {
        ArrayList<String> namen = new ArrayList<>();
        for (int i = 0; i < hoster.length(); i++) {
            JSONObject link = hoster.optJSONObject(i);
            namen.add(link.optString("hoster", "Hoster") + " · " + link.optString("spracheRoh", link.optString("sprache")));
        }
        namen.add("Quellen neu laden");
        namen.add("Anbieterseite öffnen");
        if (dialog != null) dialog.dismiss();
        dialog = new AlertDialog.Builder(activity).setTitle("Quelle und Sprache")
            .setItems(namen.toArray(new String[0]), (d, index) -> {
                if (geschlossen) return;
                if (index == hoster.length()) { laden(); return; }
                if (index == hoster.length() + 1) { umgebung.browser(anbieter, adresse); return; }
                double stelle = spielt ? spieler.position() : start;
                // Tokens in this list are retained, not minted again before a click.
                aufloesen(index, stelle, ++auftrag, false);
            }).setNegativeButton("Zurück", null).show();
    }

    private void naechsteSuchen(int id) {
        kern.rufe("direkt-android.naechste", Kern.args(folgen, adresse), (wert, fehler) -> {
            if (!aktuell(id)) return;
            try { naechste = new JSONObject(wert); } catch (Exception ignoriert) { naechste = null; }
            spieler.naechsteVorhanden(naechste != null);
            if (naechste != null) return;
            kern.rufe("direkt-android.naechsteStaffel", Kern.args(folgen, adresse), (staffelWert, staffelFehler) -> {
                if (!aktuell(id)) return;
                JSONObject kandidat;
                try { kandidat = new JSONObject(staffelWert); } catch (Exception e) { return; }
                staffelLesen(kandidat.optString("url"), id, daten -> {
                JSONArray neu = daten.optJSONArray("folgen");
                if (neu == null) return;
                for (int i = 0; i < neu.length(); i++) {
                    JSONObject f = neu.optJSONObject(i);
                    if (f != null && !f.optBoolean("gesperrt") && !f.optString("url").isEmpty()) {
                        naechste = f;
                        spieler.naechsteVorhanden(true);
                        return;
                    }
                }
                });
            });
        });
    }

    private void staffelLesen(String url, int id, Consumer<JSONObject> fertig) {
        seiteLaden(url, id, () -> skript("seitendaten.uebersichtSkript", id, script -> {
            WebView view = seite;
            view.evaluateJavascript(script, wert -> {
                if (!aktuell(id) || view != seite) return;
                try { fertig.accept(new JSONObject(wert)); } catch (Exception ignoriert) { }
            });
        }));
    }

    private void folgenZeigen(JSONObject stand) {
        ArrayList<String> namen = new ArrayList<>();
        ArrayList<Runnable> aktionen = new ArrayList<>();
        JSONArray staffeln = stand.optJSONArray("staffeln");
        if (staffeln != null) for (int i = 0; i < staffeln.length(); i++) {
            JSONObject staffel = staffeln.optJSONObject(i);
            if (staffel == null) continue;
            namen.add("Staffel " + staffel.optInt("staffel") + " öffnen");
            aktionen.add(() -> staffelLesen(staffel.optString("url"), auftrag, this::folgenZeigen));
        }
        JSONArray liste = stand.optJSONArray("folgen");
        if (liste != null) for (int i = 0; i < liste.length(); i++) {
            JSONObject folge = liste.optJSONObject(i);
            if (folge == null || folge.optBoolean("gesperrt") || folge.optString("url").isEmpty()) continue;
            namen.add("Folge " + folge.optInt("folge") + " · " + folge.optString("titel"));
            aktionen.add(() -> wechseln(folge.optString("url")));
        }
        if (namen.isEmpty()) { spieler.status("Für diesen Titel ist keine Folgenliste vorhanden."); return; }
        if (dialog != null) dialog.dismiss();
        dialog = new AlertDialog.Builder(activity).setTitle("Staffeln und Folgen")
            .setItems(namen.toArray(new String[0]), (d, index) -> aktionen.get(index).run())
            .setNegativeButton("Zurück", null).show();
    }

    // The Activity keeps the native player on every episode navigation.
    private void wechseln(String url) {
        if (url == null || url.isEmpty() || geschlossen) return;
        spieler.speichern();
        if (nachSeite != null) nachSeite.accept(url);
    }

    void beimWechsel(Consumer<String> wechseln) { nachSeite = wechseln; }
    String adresse() { return adresse; }
    void steuern(JSONObject urteil, Runnable bereit) { spieler.steuern(urteil, bereit); }
    boolean wartetAufBefehl() { return spieler.wartetAufBefehl(); }
    JSONObject liveStand() {
        try { return spieler.liveStand(); } catch (org.json.JSONException e) { return new JSONObject(); }
    }
    void pause() { spieler.pause(); }
    void vordergrund() { spieler.vordergrund(); }
    boolean taste(KeyEvent event) { return spieler.taste(event); }
    boolean zurueck() { return spieler.zurueck(); }

    private void seiteFreigeben() {
        if (seite == null) return;
        WebView alt = seite;
        seite = null;
        alt.stopLoading();
        if (alt.getParent() instanceof ViewGroup) ((ViewGroup) alt.getParent()).removeView(alt);
        alt.destroy();
    }

    void schliessen() {
        if (geschlossen) return;
        geschlossen = true;
        auftrag++;
        kern.rufe("direkt-android.abbrechen", (w, f) -> { });
        handler.removeCallbacksAndMessages(null);
        if (dialog != null) dialog.dismiss();
        spieler.schliessen();
        seiteFreigeben();
        if (wurzel.getParent() instanceof ViewGroup) ((ViewGroup) wurzel.getParent()).removeView(wurzel);
    }
}
