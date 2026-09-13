package local.elflix.android;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.graphics.Color;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
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
        /** Relay queue takes priority at the real media end. */
        default boolean queueWeiter() { return false; }
        void marke(Consumer<JSONObject> fertig);
        /** Cache-first Kennung fuer externe Vorspann- und Abspannsegmente. */
        default void skipKontext(Consumer<JSONObject> fertig) { fertig.accept(null); }
        void sprung(double von, double nach);
        /** Die Bedienung des Players ist gekommen oder gegangen. */
        default void bedienung(boolean sichtbar) { }
        /** Das Tempo dieses Geraets an die Runde - nur der Host kommt damit durch. */
        default void tempo(double wert) { }
        /** Darf hier am Tempo gedreht werden? In einer Runde nur als Host. */
        default boolean darfTempo() { return true; }
        /** Muss bis zum Player durchgereicht werden: Play wartet dann auf die Runde. */
        boolean inRunde();
        /** Die Rolle bleibt dynamisch, damit eine Hostuebergabe sofort im Player ankommt. */
        default boolean istRundenHost() { return false; }
        /** Privat und als Host darf dieses Geraet Fassung und Hoster selbst waehlen. */
        default boolean darfFassungUndHosterWaehlen() {
            return !inRunde() || istRundenHost();
        }
        /** Die Fassung dieser Runde an die anderen - ebenfalls nur als Host. */
        default void fassungGewaehlt(String fassung, String hoster) { }
        /** Was in der Runde als Fassung gilt - leer, wenn keine Runde laeuft. */
        default JSONObject rundenFassung() { return new JSONObject(); }
        /**
         * Ein lokaler Folgenwechsel soll alle Mitglieder der Runde mitnehmen.
         *
         * @return {@code true}, wenn das Relay den Wechsel uebernommen hat und
         *         dieses Geraet auf dessen {@code syncprepare} warten muss
         */
        default boolean folgenwechsel(String url, Runnable fehlgeschlagen) { return false; }
        default void chatSenden(String key, String text, String raum, Kern.Antwort antwort) {
            if (antwort != null) antwort.fertig(null, "Chat ist nicht verfügbar");
        }
        default void pip() { }
        /** Tatsächliches Native-Playback; steuert Android-12-Auto-PiP. */
        default void wiedergabe(boolean laeuft) { }
        /** Text bound next to a native player's episode number. */
        default String folgenAnzeige(int staffel, int folge, String titel) { return titel; }
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
    /** Welche Zeile der Quellenliste gerade spielt - die Blende hebt sie hervor. */
    private int laufenderHoster = -1;
    private boolean geschlossen;
    private int auftrag;
    private JSONArray hoster = new JSONArray();
    private JSONObject folgen = new JSONObject();
    /** Welche Staffel in der Blende gerade aufgeschlagen ist. -1: noch keine. */
    private int offeneStaffel = -1;
    private JSONObject naechste;
    private JSONObject meta = new JSONObject();
    private final double start;
    /**
     * Diese Adresse ist eine Serienseite - es wird gewaehlt, nicht gespielt.
     *
     * <p>Dann laeuft die halbe Kette gar nicht erst an: keine Hosterliste, kein
     * Aufloesen, keine Frist, nach der "keine Quellen" dasteht. Gelesen wird
     * nur die Folgenliste, und die steht danach offen da.
     */
    private final boolean auswahl;
    /** Gespeicherte Folge beim Einstieg ueber Weiterschauen; 0: frei waehlen. */
    private final int fortsetzStaffel;
    private final int fortsetzFolge;
    /** Verhindert, dass zwei spaet eintreffende Listen dieselbe Folge zweimal oeffnen. */
    private boolean fortsetzFolgeGeoeffnet;
    private boolean spielt;
    private boolean versucht;
    private String letzteSprache = "";
    private Consumer<String> nachSeite;
    /** Der einzige sichtbare Teil der sonst unsichtbaren Werkbank. */
    private VerifizierungsLauf verifizierung;

    private final class VerifizierungsLauf {
        final WebView view;
        final int id;
        final Runnable danach;
        final Runnable gescheitert;
        final long ende = SystemClock.uptimeMillis() + Verifizierung.MENSCH_FRIST_MS;
        boolean token;
        boolean navigation;
        boolean weiter;
        boolean sichtbar;
        boolean maskePrueft;
        boolean dokumentBereit = true;
        int dokument;
        int frei;

        VerifizierungsLauf(WebView view, int id, Runnable danach, Runnable gescheitert) {
            this.view = view;
            this.id = id;
            this.danach = danach;
            this.gescheitert = gescheitert;
        }
    }

    /**
     * Was der Player annimmt.
     *
     * <p>Drei Formen: eine bestimmte Folge, ein Film - und seit 2.0.5 auch die
     * <b>Serienseite ohne Folge</b>. Die letzte spielt nichts ab; sie laesst
     * waehlen. Vorher gab es dafuer einen eigenen Bildschirm davor: die
     * Anbieterseite wurde hinter einem Ladevorhang gelesen, daraus eine eigene
     * Uebersicht gebaut, und erst ein Tipp darin fuehrte zum Player. Am Fire TV
     * waren das elf Sekunden Balken, um danach einmal OK zu druecken. Der
     * Player fuehrt seine Folgen- und Staffelliste inzwischen selbst - also
     * geht es direkt hierher, und gelesen wird hinter der eigenen Anzeige.
     */
    static boolean passt(String adresse) {
        return istFolge(adresse) || istSerienseite(adresse);
    }

    /** Eine Adresse, hinter der wirklich ein Bild liegt: eine Folge oder ein Film. */
    static boolean istFolge(String adresse) {
        String pfad = pfadVon(adresse);
        return pfad != null && (pfad.matches(".*/(?:staffel|season)-[0-9]+/(?:episode|folge)-[0-9]+/?")
            || pfad.matches("/(?:movies|movie|filme|film)/[^/]+/?")
            || pfad.matches("(?i)/(?:anime|serie|serien|series)/stream/[^/]+/filme/film-[0-9]+/?"));
    }

    /**
     * Die Serienseite - mit oder ohne Staffel, aber ohne Folge.
     *
     * <p>{@code /anime/stream/bleach} und {@code /serie/stream/dark/staffel-2}.
     * Absichtlich eng: was hier faelschlich zutraefe, oeffnete den Player auf
     * einer Seite, die kein Bild hergibt.
     */
    static boolean istSerienseite(String adresse) {
        String pfad = pfadVon(adresse);
        if (pfad == null) return false;
        // AniWorld fuehrt Filme unter der Serienadresse, ohne Staffelnummer.
        if (pfad.matches("(?i)/anime/stream/[^/]+/filme/?")) return true;
        return pfad.matches("(?i)/(?:anime|serie|serien|series)/stream/[^/]+(?:/(?:staffel|season)-[0-9]+)?/?");
    }

    private static String pfadVon(String adresse) {
        if (adresse == null) return null;
        try {
            java.net.URI url = new java.net.URI(adresse);
            String schema = url.getScheme();
            if (!"https".equalsIgnoreCase(schema) && !"http".equalsIgnoreCase(schema)) return null;
            String host = url.getHost();
            if (host == null || host.equals("youtu.be") || host.endsWith("youtube.com")) return null;
            return url.getPath();
        } catch (Exception ignoriert) { return null; }
    }

    DirektWiedergabe(Activity activity, Kern kern, Provider anbieter, String adresse,
                     String titel, double start, int fortsetzStaffel, int fortsetzFolge,
                     String folgenBarriereSyncId, String abgelaufeneFolgenQuelleSyncId,
                     Umgebung umgebung) {
        this(activity, kern, anbieter, adresse, titel, start, fortsetzStaffel, fortsetzFolge,
            folgenBarriereSyncId, abgelaufeneFolgenQuelleSyncId, false, umgebung);
    }

    DirektWiedergabe(Activity activity, Kern kern, Provider anbieter, String adresse,
                     String titel, double start, int fortsetzStaffel, int fortsetzFolge,
                     String folgenBarriereSyncId, String abgelaufeneFolgenQuelleSyncId,
                     boolean pausiertStarten, Umgebung umgebung) {
        this.activity = activity;
        this.kern = kern;
        this.anbieter = anbieter;
        this.adresse = adresse;
        this.titel = titel;
        this.start = start;
        this.auswahl = istSerienseite(adresse);
        this.fortsetzStaffel = Math.max(0, fortsetzStaffel);
        this.fortsetzFolge = Math.max(0, fortsetzFolge);
        this.umgebung = umgebung;
        kennung = WebSettings.getDefaultUserAgent(activity);
        spieler = new DirektSpieler(activity, kern, new DirektSpieler.Umgebung() {
            public void schliessen() { umgebung.geschlossen(); }
            public void fassungen() { fassungenZeigen(); }
            public void hoster() { hosterZeigen(); }
            public void folgen() { folgenZeigen(folgen); }
            public void naechste() { if (naechste != null) wechseln(naechste.optString("url")); }
            public void stand(JSONObject wert) { umgebung.stand(anbieter, adresse, wert, meta); }
            public void live(JSONObject wert, String aktion) { umgebung.live(wert, aktion); }
            public void bereit() { umgebung.bereit(adresse); }
            public boolean darfAutoplay() { return umgebung.darfAutoplay(); }
            public boolean queueWeiter() { return umgebung.queueWeiter(); }
            public void marke(Consumer<JSONObject> fertig) { umgebung.marke(fertig); }
            public void skipKontext(Consumer<JSONObject> fertig) { umgebung.skipKontext(fertig); }
            public void sprung(double von, double nach) { umgebung.sprung(von, nach); }
            public void bedienung(boolean sichtbar) { umgebung.bedienung(sichtbar); }
            public void fassungWaehlen(String fassung, String hoster) { fassungAusRunde(fassung, hoster); }
            public void tempo(double wert) { umgebung.tempo(wert); }
            public boolean darfTempo() { return umgebung.darfTempo(); }
            public boolean inRunde() { return umgebung.inRunde(); }
            public boolean istRundenHost() { return umgebung.istRundenHost(); }
            public boolean darfFassungUndHosterWaehlen() {
                return umgebung.darfFassungUndHosterWaehlen();
            }
            public void chatSenden(String key, String text, String raum, Kern.Antwort antwort) {
                umgebung.chatSenden(key, text, raum, antwort);
            }
            public void pip() { umgebung.pip(); }
            public void wiedergabe(boolean laeuft) { umgebung.wiedergabe(laeuft); }
        });
        if (pausiertStarten) spieler.naechsteQuellePausiert();
        // Die Schranke gehoert zur Relay-Generation und ueberlebt deshalb den
        // Austausch des DirektWiedergabe-Objekts. Vor laden() muss sie bereits
        // im Player stehen, damit auch eine sehr schnell aufgeloeste Quelle nie
        // mit aktiv=true anlaufen kann.
        spieler.folgenBarriereVorbereiten(folgenBarriereSyncId);
        spieler.abgelaufeneFolgenQuelleVormerken(abgelaufeneFolgenQuelleSyncId);
        wurzel = spieler.ansicht;
        spieler.titel(titel);
        ((ViewGroup) activity.getWindow().getDecorView()).addView(wurzel, new ViewGroup.LayoutParams(-1, -1));
        laden();
    }

    private void laden() {
        final int id = ++auftrag;
        kern.rufe("direkt-android.abbrechen", (w, f) -> { });
        spieler.status(auswahl ? "Folgen werden gelesen …" : "Folgenseite wird gelesen …");
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
            @Override public void onPageStarted(WebView v, String u, android.graphics.Bitmap icon) {
                VerifizierungsLauf lauf = verifizierung;
                if (lauf != null && lauf.view == v && lauf.id == id) {
                    lauf.navigation = true;
                    lauf.dokumentBereit = false;
                    lauf.dokument++;
                    lauf.maskePrueft = false;
                    lauf.token = false;
                    lauf.weiter = false;
                    lauf.frei = 0;
                    verifizierungVerbergen(lauf);
                }
            }
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
                VerifizierungsLauf lauf = verifizierung;
                if (lauf != null && lauf.view == v && lauf.id == id) {
                    lauf.dokumentBereit = true;
                    lauf.frei = 0;
                }
                if (gelesen || seite != view || !aktuell(id) || "about:blank".equals(u)) return;
                gelesen = true;
                fertig.run();
            }
        });
        // A real viewport lets responsive challenge widgets render. It stays
        // invisible and behind the native player until its gate is masked.
        view.setVisibility(View.INVISIBLE);
        wurzel.addView(view, 0, new FrameLayout.LayoutParams(-1, -1));
        view.loadUrl(url);
        handler.postDelayed(() -> {
            // Auf einer Serienseite gibt es keine Quellen, und das ist kein
            // Fehler - dort wird gewaehlt.
            if (auswahl) return;
            if (seite == view && aktuell(id) && hoster.length() == 0 && !spielt && verifizierung == null) {
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
        long rest = Math.max(0L, frist - SystemClock.uptimeMillis());
        verifizierungPruefen(view, id, rest, pausiert -> {
            long weiterBis = pausiert ? SystemClock.uptimeMillis() + 20000L : frist;
            lesenOhneTor(id, weiterBis);
        }, () -> spieler.status("Die Bestätigung wurde nicht abgeschlossen. Unter Quellen erneut versuchen."));
    }

    private void lesenOhneTor(int id, long frist) {
        WebView view = seite;
        if (!aktuell(id) || view == null) return;
        skript("seitendaten.uebersichtSkript", id, script -> {
            if (seite != view) return;
            view.evaluateJavascript(script, wert -> {
                if (!aktuell(id) || seite != view) return;
                try {
                    folgen = new JSONObject(wert);
                    String name = folgen.optString("titel", "");
                    if (!name.isEmpty()) {
                        String folge = Folgen.folgenText(adresse);
                        spieler.titel(folge.isEmpty() ? name : name + " · " + folge);
                    }
                    // Ohne gespeicherten Stand ist die Liste das Ziel. Beim
                    // Weiterschauen ist sie nur der Weg zur bereits gewaehlten
                    // Folge; folgenZeigen loest diese Kennung auf.
                    if (auswahl) {
                        folgenZeigen(folgen);
                    }
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
        // Die Hosterkette bleibt auf einer Serienseite aus: dort gibt es keine.
        if (auswahl) return;
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
                long rest = Math.max(0L, frist - SystemClock.uptimeMillis());
                verifizierungPruefen(view, id, rest, pausiert -> {
                    long weiterBis = pausiert ? SystemClock.uptimeMillis() + 20000L : frist;
                    if (pausiert) {
                        // Navigation through the verified gate replaces the
                        // document, therefore rebuild its source promise.
                        lesenOhneTor(id, weiterBis);
                    } else if (SystemClock.uptimeMillis() < weiterBis) {
                        handler.postDelayed(() -> linksAbholen(view, key, id, weiterBis), 250);
                    } else {
                        spieler.status("Quellen konnten nicht gelesen werden. Unter Quellen erneut versuchen.");
                    }
                }, () -> spieler.status("Die Bestätigung wurde nicht abgeschlossen. Unter Quellen erneut versuchen."));
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
                        // In einer Runde gilt deren Fassung von der ersten
                        // Sekunde an - nicht erst nach einem Wechsel. Sonst
                        // startete jeder mit seiner gelernten Fassung, und der
                        // Abgleich richtete danach zwei verschiedene Dateien
                        // aufeinander aus.
                        int rundenZeile = rundenFassungZeile();
                        aufloesen(Math.max(0, rundenZeile), start, id, true);
                    } else quellenDialog();
                });
            } catch (Exception e) { spieler.status("Die Quellenliste ist nicht lesbar. Unter Quellen erneut versuchen."); }
        });
    }

    /**
     * Gives a gate its human-only time without consuming the source/hoster
     * budget. The already loaded WebView is reused, so cookies, redirect token,
     * episode and selected language/hoster stay unchanged.
     */
    private void verifizierungPruefen(WebView view, int id, long rest,
                                      Consumer<Boolean> fertig, Runnable gescheitert) {
        if (view == null || !aktuell(id) || seite != view) return;
        view.evaluateJavascript(Verifizierung.zustandScript(), wert -> {
            if (!aktuell(id) || seite != view || verifizierung != null) return;
            JSONObject stand = javascriptObjekt(wert);
            if (stand == null || !stand.optBoolean("offen")) {
                fertig.accept(false);
                return;
            }
            VerifizierungsLauf lauf = new VerifizierungsLauf(view, id,
                () -> fertig.accept(true), gescheitert);
            verifizierung = lauf;
            spieler.status("Bestätigung erforderlich · bitte das Häkchen setzen");
            verifizierungTakt(lauf);
        });
    }

    private void verifizierungTakt(VerifizierungsLauf lauf) {
        if (verifizierung != lauf || !aktuell(lauf.id) || seite != lauf.view) return;
        if (SystemClock.uptimeMillis() >= lauf.ende) {
            verifizierungBeenden(lauf, false, true);
            return;
        }
        lauf.view.evaluateJavascript(Verifizierung.zustandScript(), wert -> {
            if (verifizierung != lauf || !aktuell(lauf.id) || seite != lauf.view) return;
            JSONObject stand = javascriptObjekt(wert);
            if (stand == null) {
                lauf.frei = 0;
                handler.postDelayed(() -> verifizierungTakt(lauf), Verifizierung.PRUEF_TAKT_MS);
                return;
            }
            boolean offen = stand.optBoolean("offen");
            if (offen && !stand.optBoolean("token")) {
                lauf.token = false;
                lauf.weiter = false;
                lauf.navigation = false;
            }
            if (stand.optBoolean("token")) lauf.token = true;
            if (stand.optBoolean("tor")) verifizierungZeigen(lauf);

            if (lauf.token && !lauf.weiter && offen) {
                int dokument = lauf.dokument;
                lauf.view.evaluateJavascript(Verifizierung.weiterScript(), klick -> {
                    if (verifizierung != lauf || lauf.dokument != dokument) return;
                    String ergebnis = javascriptText(klick);
                    if (ergebnis.startsWith("geklickt") || "token".equals(ergebnis)) lauf.weiter = true;
                    if (ergebnis.startsWith("geklickt|") && ergebnis.length() > 9) {
                        try {
                            JSONArray ziele = new JSONArray(Uri.decode(ergebnis.substring(9)));
                            for (int i = 0; i < ziele.length(); i++) {
                                String ziel = ziele.optString(i);
                                if (verifizierungsZielErlaubt(lauf.view, ziel)) {
                                    lauf.view.loadUrl(ziel);
                                    break;
                                }
                            }
                        } catch (Exception ignoriert) { }
                    }
                });
            }
            lauf.frei = offen || !lauf.dokumentBereit ? 0 : lauf.frei + 1;
            if (Verifizierung.darfFortsetzen(lauf.token, lauf.navigation, offen, lauf.frei)) {
                verifizierungBeenden(lauf, true, false);
                return;
            }
            handler.postDelayed(() -> verifizierungTakt(lauf), Verifizierung.PRUEF_TAKT_MS);
        });
    }

    private void verifizierungZeigen(VerifizierungsLauf lauf) {
        if (verifizierung != lauf || lauf.view.getParent() != wurzel || lauf.maskePrueft) return;
        if (!lauf.sichtbar) {
            int rand = dp(18);
            int breite = Math.max(dp(240), Math.min(dp(560), Math.max(dp(240), wurzel.getWidth() - 2 * rand)));
            int hoehe = Math.max(dp(140), Math.min(dp(430), Math.max(dp(140), wurzel.getHeight() - 2 * rand)));
            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(breite, hoehe, Gravity.CENTER);
            lauf.view.setLayoutParams(params);
            lauf.view.setBackgroundColor(Color.TRANSPARENT);
            lauf.view.setFocusable(true);
            lauf.view.setFocusableInTouchMode(true);
        }
        lauf.maskePrueft = true;
        int dokument = lauf.dokument;
        lauf.view.evaluateJavascript(Verifizierung.maskierenScript(), wert -> {
            if (verifizierung != lauf || lauf.view.getParent() != wurzel) return;
            lauf.maskePrueft = false;
            if (lauf.dokument != dokument || !lauf.dokumentBereit) return;
            JSONObject masse = javascriptObjekt(wert);
            if (masse == null || !masse.optBoolean("ok")) {
                verifizierungVerbergen(lauf);
                return;
            }
            int inhalt = masse.optInt("height");
            FrameLayout.LayoutParams aktuell = (FrameLayout.LayoutParams) lauf.view.getLayoutParams();
            if (inhalt > 0) aktuell.height = Math.max(dp(100), Math.min(dp(430), dp(inhalt)));
            aktuell.gravity = Gravity.CENTER;
            lauf.view.setLayoutParams(aktuell);
            if (!lauf.sichtbar) {
                lauf.view.bringToFront();
                lauf.view.setVisibility(View.VISIBLE);
                lauf.view.requestFocus();
                lauf.sichtbar = true;
            }
        });
    }

    private boolean verifizierungsZielErlaubt(WebView view, String ziel) {
        try {
            java.net.URI target = new java.net.URI(ziel);
            String schema = target.getScheme();
            String host = target.getHost();
            if (!("http".equalsIgnoreCase(schema) || "https".equalsIgnoreCase(schema)) || host == null) return false;
            if (filter.shouldBlock(ziel, anbieter)) return false;
            if (Adblocker.isChallengeOrVerificationUrl(ziel, anbieter)
                || Adblocker.isLikelyPlayerNavigation(ziel)) return true;
            String aktuell = view == null ? null : view.getUrl();
            String basis = anbieter == null ? null : anbieter.startUrl;
            return gleicheWebHerkunft(host, aktuell) || gleicheWebHerkunft(host, basis);
        } catch (Exception ungueltig) {
            return false;
        }
    }

    private static boolean gleicheWebHerkunft(String host, String url) {
        try {
            String basis = new java.net.URI(url).getHost();
            return basis != null && (host.equalsIgnoreCase(basis)
                || host.toLowerCase(java.util.Locale.ROOT).endsWith("." + basis.toLowerCase(java.util.Locale.ROOT))
                || basis.toLowerCase(java.util.Locale.ROOT).endsWith("." + host.toLowerCase(java.util.Locale.ROOT)));
        } catch (Exception ungueltig) {
            return false;
        }
    }

    private void verifizierungVerbergen(VerifizierungsLauf lauf) {
        if (lauf == null || lauf.view.getParent() != wurzel) return;
        lauf.sichtbar = false;
        lauf.maskePrueft = false;
        lauf.view.clearFocus();
        lauf.view.setVisibility(View.INVISIBLE);
        lauf.view.setLayoutParams(new FrameLayout.LayoutParams(-1, -1));
    }

    private void verifizierungBeenden(VerifizierungsLauf lauf, boolean erfolg, boolean melden) {
        if (verifizierung != lauf) return;
        verifizierung = null;
        if (lauf.view.getParent() == wurzel) {
            lauf.view.evaluateJavascript(Verifizierung.maskeEntfernenScript(), null);
            verifizierungVerbergen(lauf);
            // Die unsichtbare Werkbank wieder unter die native Playerflaeche.
            wurzel.removeView(lauf.view);
            wurzel.addView(lauf.view, 0, new FrameLayout.LayoutParams(-1, -1));
        }
        if (erfolg) {
            spieler.status("Bestätigung angenommen · Quelle wird fortgesetzt …");
            lauf.danach.run();
        } else if (melden) {
            spieler.status("Die Bestätigung wurde abgebrochen oder lief ab.");
            lauf.gescheitert.run();
        }
    }

    private void verifizierungAbbrechen(boolean melden) {
        VerifizierungsLauf lauf = verifizierung;
        if (lauf != null) verifizierungBeenden(lauf, false, melden);
    }

    private int dp(int wert) {
        return Math.round(wert * activity.getResources().getDisplayMetrics().density);
    }

    private static JSONObject javascriptObjekt(String wert) {
        try {
            Object erste = new JSONTokener(wert == null ? "null" : wert).nextValue();
            if (erste instanceof JSONObject) return (JSONObject) erste;
            if (erste instanceof String) return new JSONObject((String) erste);
        } catch (Exception ignoriert) { }
        return null;
    }

    private static String javascriptText(String wert) {
        try {
            Object text = new JSONTokener(wert == null ? "null" : wert).nextValue();
            return text == null ? "" : String.valueOf(text);
        } catch (Exception ignoriert) { return ""; }
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
        laufenderHoster = hosterZeile(link);
        // Als Host gilt die eigene Wahl fuer die ganze Runde.
        umgebung.fassungGewaehlt(fassungVon(link), link.optString("hoster", ""));
        seiteFreigeben();
        // Woher das Bild kommt, steht im Kopf des Players - wie am Rechner.
        spieler.quelleBenannt(link.optString("hoster", ""),
            link.optString("spracheRoh", link.optString("sprache", "")));
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
        boolean[] torPrueft = { false };
        long[] frist = { SystemClock.uptimeMillis() + 20000L };
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
        Runnable spielenLassen = () -> {
            if (seite != null && aktuell(id)) seite.evaluateJavascript(
                "(()=>{for(const v of document.querySelectorAll('video')){v.muted=true;v.volume=0;v.play().catch(()=>{})}"
                + "const b=document.querySelector('.vjs-big-play-button,.jw-icon-display,[aria-label=Play]');if(b)b.click()})()", null);
        };
        seiteLaden(url, id, spielenLassen, kandidat -> {
            if (fertig[0] || gesehen.size() >= 8 || !gesehen.add(kandidat)) return;
            wartend.add(kandidat);
            pruefen[0].run();
        });
        Runnable[] torWache = new Runnable[1];
        torWache[0] = () -> {
            if (fertig[0] || !aktuell(id) || seite == null) return;
            if (!torPrueft[0] && verifizierung == null) {
                torPrueft[0] = true;
                WebView view = seite;
                long rest = Math.max(0L, frist[0] - SystemClock.uptimeMillis());
                verifizierungPruefen(view, id, rest, pausiert -> {
                    torPrueft[0] = false;
                    if (pausiert) frist[0] = SystemClock.uptimeMillis() + 20000L;
                    spielenLassen.run();
                }, () -> {
                    torPrueft[0] = false;
                    if (!fertig[0] && aktuell(id)) {
                        fertig[0] = true;
                        kern.rufe("direkt-android.abbrechen", (w, f) -> { });
                        seiteFreigeben();
                        spieler.status("Die Bestätigung wurde nicht abgeschlossen. Unter Quellen erneut versuchen.");
                    }
                });
            }
            handler.postDelayed(torWache[0], 400L);
        };
        handler.post(torWache[0]);
        Runnable[] zeitwaechter = new Runnable[1];
        zeitwaechter[0] = () -> {
            if (fertig[0] || !aktuell(id)) return;
            if (torPrueft[0] || (verifizierung != null && verifizierung.view == seite && verifizierung.id == id)) {
                handler.postDelayed(zeitwaechter[0], 500L);
                return;
            }
            long rest = frist[0] - SystemClock.uptimeMillis();
            if (rest > 0L) {
                handler.postDelayed(zeitwaechter[0], Math.min(rest, 500L));
                return;
            }
            fertig[0] = true;
            kern.rufe("direkt-android.abbrechen", (w, f) -> { });
            seiteFreigeben();
            weiter.run();
        };
        handler.postDelayed(zeitwaechter[0], 500L);
    }

    private void quellenZeigen() {
        if (geschlossen) return;
        hosterZeigen();
    }

    /**
     * Die Fassungen dieser Folge.
     *
     * <p>Getrennt vom Hoster, genau wie am Rechner (fassungSetzen in
     * spieler.js): eine Fassung ist eine Sprache, ein Hoster ist ein Anbieter,
     * und beides in einer Liste zu mischen ergab Zeilen wie
     * "VOE - German Sub, Vidmoly - German Sub, VOE - Deutsch ...", in denen man
     * beides suchen musste.
     *
     * <p>Beim Wechsel wird derselbe Hoster in der neuen Fassung genommen, wenn
     * es ihn dort gibt - sonst der beste, den sie hat.
     */
    private void fassungenZeigen() {
        if (geschlossen) return;
        if (!darfFassungUndHosterWaehlen()) {
            spieler.kurzeAnsage("Fassung und Hoster stellt der Host.");
            return;
        }
        ArrayList<String> namen = new ArrayList<>();
        ArrayList<Runnable> aktionen = new ArrayList<>();
        int laufend = -1;
        for (String fassung : fassungsnamen()) {
            final String gewaehlt = fassung;
            if (fassung.equalsIgnoreCase(letzteSprache)) laufend = namen.size();
            namen.add(fassung);
            aktionen.add(() -> fassungWechseln(gewaehlt));
        }
        if (namen.isEmpty()) {
            spieler.kurzeAnsage("Für diese Folge steht keine Fassung zur Wahl.");
            return;
        }
        spieler.blende("Fassung", namen, aktionen, laufend);
    }

    /** Die Fassungen in der Reihenfolge, in der sie auf der Seite stehen. */
    private ArrayList<String> fassungsnamen() {
        ArrayList<String> namen = new ArrayList<>();
        for (int i = 0; i < hoster.length(); i++) {
            String name = fassungVon(hoster.optJSONObject(i));
            if (!name.isEmpty() && !namen.contains(name)) namen.add(name);
        }
        return namen;
    }

    private static String fassungVon(JSONObject link) {
        if (link == null) return "";
        String roh = link.optString("spracheRoh", "").trim();
        return roh.isEmpty() ? link.optString("sprache", "").trim() : roh;
    }

    /**
     * Zur Fassung wechseln - mit demselben Hoster, wenn es ihn dort gibt.
     *
     * <p>Wie {@code fassungWechseln} am Rechner: der Hoster ist die Gewohnheit,
     * die Fassung die Wahl. Wer VOE gewohnt ist, soll nach dem Wechsel nicht
     * plotzlich bei einem anderen landen, nur weil der in der Liste weiter oben
     * steht.
     */
    private void fassungWechseln(String fassung) {
        if (geschlossen || fassung == null) return;
        // Die Rolle kann sich zwischen geoeffneter Liste und Tippen aendern.
        if (!darfFassungUndHosterWaehlen()) {
            spieler.kurzeAnsage("Fassung und Hoster stellt der Host.");
            return;
        }
        JSONObject laufender = hoster.optJSONObject(Math.max(0, laufenderHoster));
        String gewohnt = laufender == null ? "" : laufender.optString("hoster", "");
        int ziel = -1;
        int ersatz = -1;
        for (int i = 0; i < hoster.length(); i++) {
            JSONObject link = hoster.optJSONObject(i);
            if (!fassung.equalsIgnoreCase(fassungVon(link))) continue;
            if (ersatz < 0) ersatz = i;
            if (!gewohnt.isEmpty() && gewohnt.equalsIgnoreCase(link.optString("hoster", ""))) {
                ziel = i;
                break;
            }
        }
        int nehmen = ziel >= 0 ? ziel : ersatz;
        if (nehmen < 0) return;
        double stelle = spielt ? spieler.position() : start;
        aufloesen(nehmen, stelle, ++auftrag, false);
    }

    /**
     * Die Fassung der Runde uebernehmen.
     *
     * <p>Der Host hat sie gestellt, und sie gilt fuer alle - sonst schaut einer
     * die deutsche Fassung und der andere die japanische. Gemessen an einer
     * Folge bei Vidmoly sind zwei Fassungen 1371 und 1376 Sekunden lang:
     * dieselbe Stelle ist dort nicht dasselbe Bild, und kein Abgleich bringt
     * das zusammen.
     *
     * <p>Der Hoster zaehlt nur innerhalb der passenden Fassung. Gibt es ihn dort
     * nicht, gilt die Fassung trotzdem - sie ist die Entscheidung, der Hoster
     * ist die Gewohnheit.
     */
    /**
     * Die Zeile, die zur Fassung der Runde gehoert - oder -1.
     *
     * <p>Gefragt wird die Umgebung, nicht das Relay: dort steht der Eintrag der
     * Runde samt Fassung und Hoster, so wie ihn der Host gestellt hat.
     */
    private int rundenFassungZeile() {
        JSONObject runde = umgebung.rundenFassung();
        String fassung = runde == null ? "" : runde.optString("fassung", "");
        if (fassung.isEmpty()) return -1;
        String hosterName = runde.optString("hoster", "");
        int ersatz = -1;
        for (int i = 0; i < hoster.length(); i++) {
            JSONObject link = hoster.optJSONObject(i);
            if (!fassung.equalsIgnoreCase(fassungVon(link))) continue;
            if (ersatz < 0) ersatz = i;
            if (!hosterName.isEmpty() && hosterName.equalsIgnoreCase(link.optString("hoster", ""))) return i;
        }
        return ersatz;
    }

    private void fassungAusRunde(String fassung, String hosterName) {
        if (geschlossen || fassung == null || fassung.trim().isEmpty()) return;
        int ziel = -1;
        int ersatz = -1;
        for (int i = 0; i < hoster.length(); i++) {
            JSONObject link = hoster.optJSONObject(i);
            if (!fassung.equalsIgnoreCase(fassungVon(link))) continue;
            if (ersatz < 0) ersatz = i;
            if (hosterName != null && !hosterName.isEmpty()
                && hosterName.equalsIgnoreCase(link.optString("hoster", ""))) {
                ziel = i;
                break;
            }
        }
        int nehmen = ziel >= 0 ? ziel : ersatz;
        // Schon dort? Dann nichts tun - ein Wechsel waere ein Neuladen ohne
        // Anlass, und jede Meldung der Runde loeste eines aus.
        if (nehmen < 0 || nehmen == laufenderHoster) return;
        double stelle = spielt ? spieler.position() : start;
        aufloesen(nehmen, stelle, ++auftrag, false);
    }

    /** Die Hoster - nur die zur laufenden Fassung, wie drueben. */
    private void hosterZeigen() {
        if (geschlossen) return;
        if (!darfFassungUndHosterWaehlen()) {
            spieler.kurzeAnsage("Fassung und Hoster stellt der Host.");
            return;
        }
        quellenDialog();
    }

    private void quellenDialog() {
        // Die Liste geht in die Blende des Players und nicht mehr in einen
        // Systemdialog: derselbe Grund, dieselbe Schrift, dasselbe Steuerkreuz
        // wie der Rest der Wiedergabe.
        //
        // Gezeigt werden die Hoster der laufenden Fassung. Steht keine fest -
        // beim ersten Oeffnen, oder wenn die Seite keine Sprache nennt -, sind
        // es alle: eine leere Liste waere die schlechtere Antwort.
        String fassung = laufendeFassung();
        ArrayList<String> namen = new ArrayList<>();
        ArrayList<Runnable> aktionen = new ArrayList<>();
        int laufend = -1;
        for (int i = 0; i < hoster.length(); i++) {
            JSONObject link = hoster.optJSONObject(i);
            if (!fassung.isEmpty() && !fassung.equalsIgnoreCase(fassungVon(link))) continue;
            if (i == laufenderHoster) laufend = namen.size();
            namen.add(link.optString("hoster", "Hoster"));
            final int index = i;
            aktionen.add(() -> {
                if (geschlossen) return;
                // Auch ein bereits gebauter Callback darf nach einer
                // Hostuebergabe keine andere Quelle mehr laden.
                if (!darfFassungUndHosterWaehlen()) {
                    spieler.kurzeAnsage("Fassung und Hoster stellt der Host.");
                    return;
                }
                double stelle = spielt ? spieler.position() : start;
                // Tokens in this list are retained, not minted again before a click.
                aufloesen(index, stelle, ++auftrag, false);
            });
        }
        namen.add("Quellen neu laden");
        aktionen.add(() -> { if (!geschlossen) laden(); });
        namen.add("Anbieterseite öffnen");
        aktionen.add(() -> { if (!geschlossen) umgebung.browser(anbieter, adresse); });
        spieler.blende(fassung.isEmpty() ? "Hoster" : "Hoster · " + fassung,
            namen, aktionen, laufend);
    }

    /** Die Fassung, die gerade spielt - oder nichts, solange keine feststeht. */
    private String laufendeFassung() {
        JSONObject laufender = laufenderHoster >= 0 ? hoster.optJSONObject(laufenderHoster) : null;
        String name = fassungVon(laufender);
        return name.isEmpty() ? letzteSprache.trim() : name;
    }

    static boolean darfFassungUndHosterWaehlen(boolean inRunde, boolean istHost) {
        return DirektSpieler.darfNutzerQuelleWaehlen(inRunde, istHost);
    }

    private boolean darfFassungUndHosterWaehlen() {
        return umgebung.darfFassungUndHosterWaehlen();
    }

    private void naechsteSuchen(int id) {
        kern.rufe("direkt-android.naechste", Kern.args(folgen, adresse), (wert, fehler) -> {
            if (!aktuell(id)) return;
            try { naechste = new JSONObject(wert); } catch (Exception ignoriert) { naechste = null; }
            spieler.naechsteVorhanden(naechste != null);
            spieler.naechsterTitel(folgenName(naechste));
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
                        spieler.naechsterTitel(folgenName(f));
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

    /*
     * ------------------------------------------------------- Staffeln und Folgen
     *
     * Dieselbe Liste wie am Rechner (folgenZeichnen in spieler.js), und zwar
     * absichtlich Zeile fuer Zeile dieselbe: Reiter oben fuer die Staffeln,
     * darunter die Folgen der aufgeschlagenen - Nummer links, Titel rechts,
     * die laufende hervorgehoben.
     *
     * <p>Vorher war es eine einzige flache Liste: erst fuenf Zeilen "Staffel 2
     * oeffnen", danach die Folgen. Wer eine Serie mit acht Staffeln aufmachte,
     * sah zuerst eine Bildschirmseite Staffeln und musste scrollen, um zur
     * ersten Folge zu kommen - und ob man in Staffel 1 oder 3 war, stand
     * nirgends. Am Rechner war das nie so, und "am Handy sieht das anders aus"
     * war genau dieser Unterschied.
     *
     * <p>Gelesene Staffeln bleiben liegen. Jede kostet einen Seitenaufruf; wer
     * zwischen zweien hin und her blaettert, soll nicht zweimal warten.
     */
    private void folgenZeigen(JSONObject stand) {
        folgenMerken(stand);
        if (gespeicherteFolgeOeffnen()) return;
        if (auswahl) {
            spieler.warten(false);
            // Ohne Folge steht in der Kopfzeile nicht, woher das Bild kommt -
            // es gibt noch keines. Dort steht, was zu tun ist.
            spieler.quelleBenannt("Folge wählen", "");
        }
        JSONArray liste = folgen.optJSONArray("folgen");
        // Aufgeschlagen wird die laufende Staffel - und nur beim ersten Mal.
        // Danach gilt, was der Zuschauer gewaehlt hat.
        if (offeneStaffel < 0) {
            offeneStaffel = fortsetzFolge > 0 ? fortsetzStaffel : laufendeStaffel(liste);
        }
        // Gibt die Seite Staffeln her, aber keine Folgen dazu, wird die erste
        // gleich nachgelesen. Eine Reiterzeile ueber einer leeren Liste ist
        // sonst das Erste, was man sieht.
        if (!staffelDa(offeneStaffel)) {
            JSONArray staffeln = folgen.optJSONArray("staffeln");
            JSONObject ziel = fortsetzFolge > 0 ? staffelEintrag(fortsetzStaffel) : null;
            JSONObject erste = ziel != null ? ziel : staffeln == null ? null : staffeln.optJSONObject(0);
            if (erste != null) { staffelOeffnen(erste.optInt("staffel")); return; }
        }
        folgenZeichnen("");
    }

    /** Die Staffel der laufenden Folge, sonst die erste, die dasteht. */
    private int laufendeStaffel(JSONArray liste) {
        if (liste == null) return 0;
        for (int i = 0; i < liste.length(); i++) {
            JSONObject folge = liste.optJSONObject(i);
            if (folge != null && gleicheSeite(folge.optString("url"), adresse)) return folge.optInt("staffel");
        }
        JSONObject erste = liste.optJSONObject(0);
        return erste == null ? 0 : erste.optInt("staffel");
    }

    /**
     * Die gelesenen Folgen dazulegen, die alten behalten.
     *
     * <p>Jede Staffelseite bringt ihre eigenen Folgen mit und dazu die Liste
     * aller Staffeln. Zusammengelegt steht am Ende die ganze Serie da, ohne
     * dass eine Seite zweimal gelesen wird.
     */
    private void folgenMerken(JSONObject stand) {
        if (stand == null) return;
        if (folgen == null || folgen.optJSONArray("folgen") == null) { folgen = stand; return; }
        JSONArray hatte = folgen.optJSONArray("folgen");
        JSONArray neue = stand.optJSONArray("folgen");
        JSONArray zusammen = new JSONArray();
        java.util.HashSet<String> gesehen = new java.util.HashSet<>();
        for (JSONArray quelle : new JSONArray[] { hatte, neue }) {
            if (quelle == null) continue;
            for (int i = 0; i < quelle.length(); i++) {
                JSONObject folge = quelle.optJSONObject(i);
                if (folge == null) continue;
                String schluessel = kurz(folge.optString("url"));
                if (schluessel.isEmpty() || !gesehen.add(schluessel)) continue;
                zusammen.put(folge);
            }
        }
        try {
            JSONObject gemischt = new JSONObject(stand.toString());
            gemischt.put("folgen", zusammen);
            // Die Staffelliste kommt von jeder Staffelseite mit; bringt eine
            // Seite keine, bleibt die bekannte stehen.
            JSONArray staffeln = stand.optJSONArray("staffeln");
            if (staffeln == null || staffeln.length() == 0) {
                JSONArray alte = folgen.optJSONArray("staffeln");
                if (alte != null) gemischt.put("staffeln", alte);
            }
            String name = stand.optString("titel", "");
            if (name.isEmpty()) gemischt.put("titel", folgen.optString("titel", ""));
            folgen = gemischt;
        } catch (Exception ignoriert) { }
    }

    /**
     * Eine Staffel aufschlagen.
     *
     * <p>Sind ihre Folgen schon da, wird nur umgeschaltet. Sonst wird ihre
     * Seite gelesen - das dauert einen Augenblick, und solange steht in der
     * Blende, was gerade geschieht. Sie bleibt dabei offen: ein Menue, das sich
     * beim Blaettern schliesst, muss man jedes Mal neu aufmachen.
     */
    private void staffelOeffnen(int staffel) {
        offeneStaffel = staffel;
        if (staffelDa(staffel)) { folgenZeichnen(""); return; }
        JSONObject ziel = staffelEintrag(staffel);
        if (ziel == null) { folgenZeichnen(""); return; }
        folgenZeichnen(staffelLadeText(staffel, false));
        final int id = auftrag;
        staffelLesen(ziel.optString("url"), id, gelesen -> {
            if (!aktuell(id) || geschlossen) return;
            JSONArray liste = gelesen == null ? null : gelesen.optJSONArray("folgen");
            if (liste == null || liste.length() == 0) {
                folgenZeichnen(staffelLadeText(staffel, true));
                return;
            }
            folgenMerken(gelesen);
            if (gespeicherteFolgeOeffnen()) return;
            folgenZeichnen("");
        });
    }

    private static String staffelLadeText(int staffel, boolean fehlgeschlagen) {
        if (staffel <= 0) return fehlgeschlagen
            ? "Filme ließen sich nicht lesen." : "Filme werden gelesen …";
        String name = Serienuebersicht.staffelName(staffel);
        return fehlgeschlagen ? name + " ließ sich nicht lesen." : name + " wird gelesen …";
    }

    /**
     * Oeffnet die gespeicherte Folge, sobald die gelesene Staffel sie kennt.
     *
     * <p>Die URL wird nicht aus einem Anbieter-Muster geraten. Die Seite selbst
     * liefert die Folgenliste; daraus wird nur der Eintrag genommen, dessen
     * Staffel und Nummer exakt zum gespeicherten Stand passen. Fehlt er oder
     * ist er gesperrt, bleibt die normale Auswahl als Rueckfall stehen.
     */
    private boolean gespeicherteFolgeOeffnen() {
        if (!auswahl || fortsetzFolgeGeoeffnet || fortsetzFolge <= 0 || folgen == null) return false;
        String ziel = gespeicherteFolgenUrl(folgen.optJSONArray("folgen"),
            fortsetzStaffel, fortsetzFolge);
        if (ziel.isEmpty()) return false;
        fortsetzFolgeGeoeffnet = true;
        spieler.status("Gespeicherte Folge wird geöffnet …");
        // Der Wechsel wird von MainActivity verdrahtet, unmittelbar nachdem
        // der Player gebaut ist. Das Lesen ist asynchron; post haelt auch den
        // kuenstlichen Sofortfall frei von einer Reihenfolgeabhaengigkeit.
        handler.post(() -> wechseln(ziel));
        return true;
    }

    /** Die exakt gespeicherte, abspielbare Folge aus einer gelesenen Liste. */
    static String gespeicherteFolgenUrl(JSONArray liste, int staffel, int nummer) {
        if (liste == null || nummer <= 0) return "";
        for (int i = 0; i < liste.length(); i++) {
            JSONObject folge = liste.optJSONObject(i);
            if (folge == null
                || folge.optInt("staffel") != staffel
                || folge.optInt("folge") != nummer
                || folge.optBoolean("gesperrt")) continue;
            String url = folge.optString("url", "").trim();
            if (!url.isEmpty()) return url;
        }
        return "";
    }

    private boolean staffelDa(int staffel) {
        JSONArray liste = folgen.optJSONArray("folgen");
        if (liste == null) return false;
        for (int i = 0; i < liste.length(); i++) {
            JSONObject folge = liste.optJSONObject(i);
            if (folge != null && folge.optInt("staffel") == staffel) return true;
        }
        return false;
    }

    private JSONObject staffelEintrag(int staffel) {
        JSONArray liste = folgen.optJSONArray("staffeln");
        if (liste == null) return null;
        for (int i = 0; i < liste.length(); i++) {
            JSONObject eintrag = liste.optJSONObject(i);
            if (eintrag != null && eintrag.optInt("staffel") == staffel) return eintrag;
        }
        return null;
    }

    /**
     * Die Reiterzeile und die Folgen der aufgeschlagenen Staffel.
     *
     * @param hinweis steht statt der Liste, solange eine Staffel gelesen wird
     */
    private void folgenZeichnen(String hinweis) {
        JSONArray alle = folgen.optJSONArray("folgen");
        JSONArray bekannte = folgen.optJSONArray("staffeln");
        if ((alle == null || alle.length() == 0) && (bekannte == null || bekannte.length() == 0)) {
            spieler.kurzeAnsage("Für diesen Titel ist keine Folgenliste vorhanden.");
            return;
        }

        // Die Reiter kommen aus der Staffelliste *und* aus den gelesenen
        // Folgen: die Serie kennt ihre Staffeln, auch wenn deren Folgen noch
        // nicht gelesen sind - und umgekehrt gibt es Seiten ohne Staffelliste.
        java.util.TreeSet<Integer> nummern = new java.util.TreeSet<>();
        if (bekannte != null) for (int i = 0; i < bekannte.length(); i++) {
            JSONObject eintrag = bekannte.optJSONObject(i);
            if (eintrag != null) nummern.add(eintrag.optInt("staffel"));
        }
        if (alle != null) for (int i = 0; i < alle.length(); i++) {
            JSONObject folge = alle.optJSONObject(i);
            if (folge != null) nummern.add(folge.optInt("staffel"));
        }
        ArrayList<Integer> staffeln = new ArrayList<>(nummern);
        ArrayList<String> reiter = new ArrayList<>();
        int aktiv = -1;
        for (int i = 0; i < staffeln.size(); i++) {
            int nummer = staffeln.get(i);
            reiter.add(nummer > 0 ? "Staffel " + nummer : "Filme");
            if (nummer == offeneStaffel) aktiv = i;
        }

        ArrayList<DirektSpieler.Zeile> zeilen = new ArrayList<>();
        int laufend = -1;
        if (alle != null) for (int i = 0; i < alle.length(); i++) {
            JSONObject folge = alle.optJSONObject(i);
            if (folge == null || folge.optInt("staffel") != offeneStaffel) continue;
            final String url = folge.optString("url");
            boolean gesperrt = folge.optBoolean("gesperrt") || url.isEmpty();
            String name = folge.optString("titel", "").trim();
            if (name.isEmpty()) name = gesperrt ? "in einer anderen Folge enthalten" : "";
            if (!gesperrt) name = umgebung.folgenAnzeige(folge.optInt("staffel"),
                folge.optInt("folge"), name);
            if (!gesperrt && gleicheSeite(url, adresse)) laufend = zeilen.size();
            zeilen.add(new DirektSpieler.Zeile("Folge " + folge.optInt("folge"), name,
                gesperrt ? null : () -> wechseln(url), gesperrt));
        }

        String titelZeile = folgen.optString("titel", "");
        spieler.blende(titelZeile.isEmpty() ? "Folgen" : titelZeile,
            reiter, aktiv, index -> staffelOeffnen(staffeln.get(index)),
            zeilen, laufend, zeilen.isEmpty() && hinweis.isEmpty()
                ? "Für diese Staffel steht keine Folge zur Wahl." : hinweis);
    }

    private static boolean gleicheSeite(String links, String rechts) {
        return kurz(links).equalsIgnoreCase(kurz(rechts));
    }

    private static String kurz(String url) {
        return url == null ? "" : url.replaceFirst("(?i)^https?://", "").replaceAll("/+$", "");
    }

    /** Die Zeile dieses Hosters in der Quellenliste - fuer die Hervorhebung in der Blende. */
    private int hosterZeile(JSONObject link) {
        for (int i = 0; i < hoster.length(); i++) {
            if (hoster.optJSONObject(i) == link) return i;
        }
        return -1;
    }

    /** "Folge 7 - Der Name", so weit bekannt. Steht auf der Karte und im Zaehler. */
    private static String folgenName(JSONObject folge) {
        if (folge == null) return "";
        String titel = folge.optString("titel", "").trim();
        int nummer = folge.optInt("folge");
        if (nummer <= 0) return titel;
        return titel.isEmpty() ? "Folge " + nummer : "Folge " + nummer + " · " + titel;
    }

    // The Activity keeps the native player on every episode navigation.
    private void wechseln(String url) {
        if (url == null || url.isEmpty() || geschlossen) return;
        // In einer Runde ist auch der Ausloeser Empfaenger des autoritativen
        // syncprepare. Ein lokaler Vorab-Wechsel wuerde die neue Media3-Quelle
        // schon starten und koennte ausserdem als navigate-Echo zurueckgehen.
        if (umgebung.folgenwechsel(url, () -> {
            if (!geschlossen) {
                spieler.status("Keine Verbindung zur Watchparty. Bitte erneut versuchen.");
            }
        })) return;
        spieler.speichern();
        if (nachSeite != null) nachSeite.accept(url);
    }

    /** Der Platz fuer den Live-Streifen im Player - siehe DirektSpieler. */
    android.widget.FrameLayout streifenPlatz() { return spieler.streifenPlatz(); }

    void beimWechsel(Consumer<String> wechseln) { nachSeite = wechseln; }
    String adresse() { return adresse; }
    void steuern(JSONObject urteil, Runnable bereit) { spieler.steuern(urteil, bereit); }
    void folgenBarriereVorbereiten(String syncId) { spieler.folgenBarriereVorbereiten(syncId); }
    void folgenBarriereAbbrechen(String syncId) { spieler.folgenBarriereAbbrechen(syncId); }
    boolean wartetAufFolgenBarriere() { return spieler.wartetAufFolgenBarriere(); }
    boolean wartetAufBefehl() { return spieler.wartetAufBefehl(); }
    JSONObject liveStand() {
        try { return spieler.liveStand(); } catch (org.json.JSONException e) { return new JSONObject(); }
    }
    void pause() { spieler.pause(); }
    void vordergrund() { spieler.vordergrund(); }
    boolean laeuftFuerPip() { return spieler.laeuftFuerPip(); }
    void pipModus(boolean aktiv) { spieler.pipModus(aktiv); }
    boolean taste(KeyEvent event) {
        if (verifizierung != null) {
            if (event.getKeyCode() == KeyEvent.KEYCODE_BACK && event.getAction() == KeyEvent.ACTION_UP) {
                verifizierungAbbrechen(true);
                return true;
            }
            // DPAD und OK erreichen das fokussierte Checkbox-Iframe als echte Tasten.
            return false;
        }
        return spieler.taste(event);
    }
    boolean zurueck() {
        if (verifizierung != null) { verifizierungAbbrechen(true); return true; }
        return spieler.zurueck();
    }
    void chatKontext(String key, String raum, boolean verbunden) { spieler.chatKontext(key, raum, verbunden); }
    void chatEmpfangen(JSONObject zeile) { spieler.chatEmpfangen(zeile); }

    private void seiteFreigeben() {
        if (seite == null) return;
        verifizierungAbbrechen(false);
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
        verifizierungAbbrechen(false);
        kern.rufe("direkt-android.abbrechen", (w, f) -> { });
        handler.removeCallbacksAndMessages(null);
        spieler.schliessen();
        seiteFreigeben();
        if (wurzel.getParent() instanceof ViewGroup) ((ViewGroup) wurzel.getParent()).removeView(wurzel);
    }
}
