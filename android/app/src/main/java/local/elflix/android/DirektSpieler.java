package local.elflix.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;
import java.util.ArrayList;
import java.util.Map;
import java.util.function.Consumer;
import org.json.JSONObject;

/** Native playback surface shared by touch and D-pad, without a hoster document. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class DirektSpieler {
    interface Umgebung {
        void schliessen();
        void quellen();
        void folgen();
        void naechste();
        void stand(JSONObject wert);
        void live(JSONObject wert, String aktion);
        void bereit();
        boolean darfAutoplay();
        void marke(Consumer<JSONObject> fertig);
        void sprung(double von, double nach);
    }

    private final Activity activity;
    private final Kern kern;
    private final Umgebung umgebung;
    final FrameLayout ansicht;
    private final PlayerView bild;
    private final LinearLayout kopf;
    private final TextView titel;
    private final LinearLayout meldung;
    private final TextView hinweis;
    private final Button abbrechen;
    private final Button weiter;
    private final Button automatisch;
    private final Button intro;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    private boolean geschlossen;
    private boolean aktiv = true;
    private boolean hatNaechste;
    private boolean endeAbgesagt;
    private long zaehlerEnde;
    private long zuletzt;
    private double gespielt;
    private double letztePosition;
    private long letztesSpeichern;
    private AlertDialog dialog;
    private boolean bereitGemeldet;
    private Boolean erwartetPlay;
    private double erwartetSeek = -1;
    private long erwartetBis;
    private boolean quelleLaedt = true;
    private JSONObject introMarke;
    private double introZiel;
    private double sprungVon = -1;
    private double sprungNach;
    private long letzteMarkenFrage;
    private Befehl wartenderBefehl;

    private static final class Befehl {
        JSONObject urteil;
        final Runnable bereit;
        boolean rechnet;
        boolean angewendet;
        double ziel;
        Befehl(JSONObject urteil, Runnable bereit) { this.urteil = urteil; this.bereit = bereit; }
    }

    DirektSpieler(Activity activity, Kern kern, Umgebung umgebung) {
        this.activity = activity;
        this.kern = kern;
        this.umgebung = umgebung;
        ansicht = new FrameLayout(activity);
        ansicht.setBackgroundColor(Color.BLACK);
        ansicht.setFocusable(true);
        bild = new PlayerView(activity);
        bild.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING);
        bild.setShowSubtitleButton(true);
        bild.setControllerShowTimeoutMs(5000);
        ansicht.addView(bild, new FrameLayout.LayoutParams(-1, -1));
        kopf = new LinearLayout(activity);
        kopf.setOrientation(LinearLayout.VERTICAL);
        kopf.setPadding(dp(12), dp(12), dp(12), dp(8));
        kopf.setBackgroundColor(0xcc101014);
        titel = new TextView(activity);
        titel.setTextColor(Color.WHITE);
        titel.setTextSize(18);
        kopf.addView(titel);
        HorizontalScrollView scroll = new HorizontalScrollView(activity);
        LinearLayout tasten = new LinearLayout(activity);
        scroll.addView(tasten);
        kopf.addView(scroll);
        tasten.addView(knopf("Zurück", umgebung::schliessen));
        tasten.addView(knopf("Quellen / Sprache", umgebung::quellen));
        tasten.addView(knopf("Folgen", umgebung::folgen));
        weiter = knopf("Nächste Folge", umgebung::naechste);
        weiter.setEnabled(false);
        tasten.addView(weiter);
        tasten.addView(knopf("Qualität", () -> spuren(C.TRACK_TYPE_VIDEO, "Qualität")));
        tasten.addView(knopf("Ton", () -> spuren(C.TRACK_TYPE_AUDIO, "Tonspur")));
        tasten.addView(knopf("Untertitel", () -> spuren(C.TRACK_TYPE_TEXT, "Untertitel")));
        automatisch = knopf("", this::autoplayUmschalten);
        autoplayText();
        tasten.addView(automatisch);
        intro = knopf("Intro überspringen", () -> {
            if (player == null || introZiel <= position()) return;
            erwartetSeek = introZiel;
            erwartetBis = SystemClock.uptimeMillis() + 2000;
            player.seekTo(Math.round(introZiel * 1000));
            liveMelden("seek");
        });
        intro.setVisibility(View.GONE);
        tasten.addView(intro);
        ansicht.addView(kopf, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));
        meldung = new LinearLayout(activity);
        meldung.setOrientation(LinearLayout.VERTICAL);
        meldung.setGravity(Gravity.CENTER);
        meldung.setPadding(dp(24), dp(18), dp(24), dp(18));
        meldung.setBackgroundColor(0xee15151b);
        hinweis = new TextView(activity);
        hinweis.setTextColor(Color.WHITE);
        hinweis.setTextSize(18);
        hinweis.setGravity(Gravity.CENTER);
        meldung.addView(hinweis);
        abbrechen = knopf("Hier bleiben", () -> {
            endeAbgesagt = true;
            zaehlerEnde = 0;
            meldung.setVisibility(View.GONE);
            bild.showController();
        });
        meldung.addView(abbrechen);
        ansicht.addView(meldung, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        bild.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) sichtbar -> {
            kopf.setVisibility(sichtbar);
        });
        status("Direktquellen werden geladen …");
        tasten.getChildAt(0).requestFocus();
        handler.post(takt);
    }

    private int dp(int wert) { return Math.round(wert * activity.getResources().getDisplayMetrics().density); }

    private Button knopf(String text, Runnable aktion) {
        Button knopf = new Button(activity);
        knopf.setText(text);
        knopf.setTextColor(Color.WHITE);
        knopf.setAllCaps(false);
        knopf.setMinHeight(dp(48));
        knopf.setPadding(dp(12), 0, dp(12), 0);
        knopf.setBackgroundTintList(new android.content.res.ColorStateList(
            new int[][] { new int[] { android.R.attr.state_focused }, new int[] {} },
            new int[] { Color.rgb(185, 18, 32), Color.rgb(40, 40, 48) }));
        knopf.setOnClickListener(v -> aktion.run());
        return knopf;
    }

    void titel(String text) { titel.setText(text); }

    void status(String text) {
        hinweis.setText(text);
        abbrechen.setVisibility(View.GONE);
        meldung.setVisibility(View.VISIBLE);
        kopf.setVisibility(View.VISIBLE);
    }

    void naechsteVorhanden(boolean ja) { hatNaechste = ja; weiter.setEnabled(ja); }

    void quelle(String url, String typ, Map<String, String> kopfzeilen, double start) {
        freigeben();
        if (geschlossen) return;
        quelleLaedt = true;
        OkHttpDataSource.Factory netz = new OkHttpDataSource.Factory(CookieNetz.erstellen())
            .setDefaultRequestProperties(kopfzeilen);
        player = new ExoPlayer.Builder(activity)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(netz))
            .setSeekBackIncrementMs(10000).setSeekForwardIncrementMs(30000).build();
        player.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
        player.setHandleAudioBecomingNoisy(true);
        bild.setPlayer(player);
        ExoPlayer lauf = player;
        lauf.addListener(new Player.Listener() {
            private boolean startGeprueft;
            @Override public void onPlaybackStateChanged(int state) {
                if (geschlossen || player != lauf) return;
                if (state == Player.STATE_READY) {
                    quelleLaedt = false;
                    meldung.setVisibility(View.GONE);
                    if (!startGeprueft && lauf.getDuration() > 0 && start > 5 && lauf.getCurrentPosition() >= lauf.getDuration() - 20000) {
                        lauf.seekTo(0);
                    }
                    startGeprueft = true;
                    if (!bereitGemeldet) { bereitGemeldet = true; umgebung.bereit(); }
                    befehlPruefen();
                }
                if (state == Player.STATE_ENDED) speichern();
            }
            @Override public void onPlayerError(PlaybackException fehler) {
                if (player != lauf) return;
                status("Diese Quelle kann nicht abgespielt werden. Unter Quellen einen anderen Hoster wählen.\n"
                    + fehler.getErrorCodeName());
                bild.showController();
            }
            @Override public void onIsPlayingChanged(boolean playing) {
                ansicht.setKeepScreenOn(playing);
                zuletzt = SystemClock.elapsedRealtime();
                letztePosition = lauf.getCurrentPosition() / 1000.0;
            }
            @Override public void onPlayWhenReadyChanged(boolean playing, int reason) {
                if (SystemClock.uptimeMillis() < erwartetBis && erwartetPlay != null && erwartetPlay == playing) {
                    erwartetPlay = null;
                    return;
                }
                if (aktiv && bereitGemeldet && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST) {
                    liveMelden(playing ? "play" : "pause");
                }
            }
            @Override public void onPositionDiscontinuity(Player.PositionInfo alt, Player.PositionInfo neu, int reason) {
                if (SystemClock.uptimeMillis() < erwartetBis && Math.abs(neu.positionMs / 1000.0 - erwartetSeek) < 2) {
                    erwartetSeek = -1;
                    return;
                }
                if (aktiv && bereitGemeldet && reason == Player.DISCONTINUITY_REASON_SEEK) {
                    liveMelden("seek");
                    if (sprungVon < 0) sprungVon = alt.positionMs / 1000.0;
                    sprungNach = neu.positionMs / 1000.0;
                    handler.removeCallbacks(sprungMelden);
                    handler.postDelayed(sprungMelden, 800);
                }
            }
        });
        MediaItem.Builder item = new MediaItem.Builder().setUri(Uri.parse(url));
        if ("hls".equals(typ)) item.setMimeType(MimeTypes.APPLICATION_M3U8);
        lauf.setMediaItem(item.build(), Math.max(0, Math.round(start * 1000)));
        lauf.prepare();
        lauf.setPlayWhenReady(aktiv);
        endeAbgesagt = false;
        zaehlerEnde = 0;
        zuletzt = SystemClock.elapsedRealtime();
        bild.requestFocus();
    }

    double position() { return player == null ? letztePosition : player.getCurrentPosition() / 1000.0; }

    void wechselPause() {
        quelleLaedt = true;
        if (player != null) { erwartetPlay = false; erwartetBis = SystemClock.uptimeMillis() + 2000; player.pause(); }
    }

    void pause() {
        aktiv = false;
        zaehlerEnde = 0;
        endeAbgesagt = true;
        if (player != null) player.pause();
        speichern();
    }

    void vordergrund() { aktiv = true; befehlPruefen(); }

    private void autoplayText() { automatisch.setText(Folgen.autoplayAn(activity) ? "Autoplay: an" : "Autoplay: aus"); }

    private void autoplayUmschalten() {
        Folgen.setzeAutoplayAn(activity, !Folgen.autoplayAn(activity));
        endeAbgesagt = !Folgen.autoplayAn(activity);
        zaehlerEnde = 0;
        autoplayText();
        meldung.setVisibility(View.GONE);
    }

    private final Runnable takt = new Runnable() {
        @Override public void run() {
            if (geschlossen) return;
            long jetzt = SystemClock.elapsedRealtime();
            if (player != null) {
                double position = position();
                double delta = position - letztePosition;
                if (player.isPlaying() && delta > 0 && delta < 2.5) {
                    gespielt += Math.min(delta, Math.max(0, (jetzt - zuletzt) / 1000.0));
                }
                letztePosition = position;
                zuletzt = jetzt;
                if (jetzt - letztesSpeichern >= 5000) speichern();
                if (aktiv) liveMelden("");
                introPruefen();
                befehlPruefen();
                if (aktiv && player.getPlaybackState() == Player.STATE_ENDED && hatNaechste
                    && Folgen.autoplayAn(activity) && !endeAbgesagt && umgebung.darfAutoplay()) {
                    if (zaehlerEnde == 0) {
                        zaehlerEnde = jetzt + Folgen.ZAEHLER_SEKUNDEN * 1000;
                        abbrechen.setVisibility(View.VISIBLE);
                        meldung.setVisibility(View.VISIBLE);
                        abbrechen.requestFocus();
                    }
                    hinweis.setText("Nächste Folge in " + Math.max(0, (zaehlerEnde - jetzt + 999) / 1000) + " Sekunden");
                    if (jetzt >= zaehlerEnde) {
                        endeAbgesagt = true;
                        umgebung.naechste();
                    }
                }
            }
            handler.postDelayed(this, 1000);
        }
    };

    void speichern() {
        if (player == null || player.getDuration() <= 0) return;
        letztesSpeichern = SystemClock.elapsedRealtime();
        try {
            umgebung.stand(new JSONObject().put("currentTime", position())
                .put("duration", player.getDuration() / 1000.0).put("playedSeconds", gespielt)
                .put("ended", player.getPlaybackState() == Player.STATE_ENDED));
        } catch (org.json.JSONException ignoriert) { }
    }

    private void liveMelden(String aktion) {
        if (player == null || geschlossen || !bereitGemeldet) return;
        try {
            umgebung.live(liveStand(), aktion);
        } catch (org.json.JSONException ignoriert) { }
    }

    JSONObject liveStand() throws org.json.JSONException {
        return new JSONObject().put("position", position())
            .put("duration", player == null ? 0 : Math.max(0, player.getDuration()) / 1000.0)
            .put("paused", player == null || !player.getPlayWhenReady())
            .put("puffert", player == null || player.getPlaybackState() != Player.STATE_READY);
    }

    void steuern(JSONObject urteil, Runnable bereit) {
        if (geschlossen) return;
        String tun = urteil.optString("tun");
        if ("drift".equals(tun) || "nichts".equals(tun)) return;
        wartenderBefehl = new Befehl(urteil, bereit);
        befehlPruefen();
    }

    boolean wartetAufBefehl() { return wartenderBefehl != null; }

    private void befehlPruefen() {
        Befehl befehl = wartenderBefehl;
        if (geschlossen || !aktiv || quelleLaedt || player == null || befehl == null
            || player.getPlaybackState() != Player.STATE_READY) return;
        if (!befehl.angewendet) {
            if (befehl.rechnet) return;
            befehl.rechnet = true;
            ExoPlayer lauf = player;
            kern.rufe("direkt-android.befehlJetzt", Kern.args(befehl.urteil), (wert, fehler) -> {
                if (wartenderBefehl != befehl || player != lauf || geschlossen) return;
                befehl.rechnet = false;
                if (!aktiv || quelleLaedt || player.getPlaybackState() != Player.STATE_READY) return;
                try { befehl.urteil = new JSONObject(wert); } catch (Exception e) { return; }
                befehl.ziel = Math.max(0, befehl.urteil.optDouble("position", position()));
                if (player.getDuration() > 0) befehl.ziel = Math.min(befehl.ziel, Math.max(0, player.getDuration() / 1000.0 - 0.1));
                befehl.angewendet = true;
                erwartetBis = SystemClock.uptimeMillis() + 2000;
                erwartetPlay = false;
                player.pause();
                if (!befehl.urteil.optBoolean("nichtSpringen")) {
                    erwartetSeek = befehl.ziel;
                    player.seekTo(Math.round(befehl.ziel * 1000));
                }
                handler.postDelayed(this::befehlPruefen, 100);
            });
            return;
        }
        if (!befehl.urteil.optBoolean("nichtSpringen") && Math.abs(position() - befehl.ziel) > 1.5) return;
        JSONObject ereignis = befehl.urteil.optJSONObject("ereignis");
        boolean play = !befehl.urteil.optBoolean("warten") && ereignis != null && ereignis.optBoolean("playing");
        erwartetBis = SystemClock.uptimeMillis() + 2000;
        erwartetPlay = play;
        wartenderBefehl = null;
        player.setPlayWhenReady(play);
        if (befehl.bereit != null) befehl.bereit.run();
    }

    private final Runnable sprungMelden = this::sprungAbschliessen;
    private void sprungAbschliessen() {
        if (!geschlossen && sprungVon >= 0) umgebung.sprung(sprungVon, sprungNach);
        sprungVon = -1;
    }

    private void introPruefen() {
        if (player == null || geschlossen) return;
        if (SystemClock.uptimeMillis() - letzteMarkenFrage >= 5000) {
            letzteMarkenFrage = SystemClock.uptimeMillis();
            umgebung.marke(marke -> { if (!geschlossen) introMarke = marke; });
        }
        if (introMarke == null) { intro.setVisibility(View.GONE); return; }
        ExoPlayer lauf = player;
        kern.rufe("direkt-android.intro", Kern.args(introMarke, position()), (wert, fehler) -> {
            if (geschlossen || player != lauf) return;
            try {
                JSONObject stand = new JSONObject(wert);
                introZiel = stand.optDouble("ziel");
                intro.setVisibility(stand.optBoolean("sichtbar") ? View.VISIBLE : View.GONE);
            } catch (Exception ignoriert) { }
        });
    }

    private void spuren(int typ, String name) {
        if (player == null) return;
        ArrayList<String> namen = new ArrayList<>();
        ArrayList<TrackSelectionOverride> auswahl = new ArrayList<>();
        namen.add(typ == C.TRACK_TYPE_TEXT ? "Aus" : "Automatisch");
        auswahl.add(null);
        for (Tracks.Group gruppe : player.getCurrentTracks().getGroups()) {
            if (gruppe.getType() != typ) continue;
            for (int i = 0; i < gruppe.length; i++) {
                if (!gruppe.isTrackSupported(i)) continue;
                Format format = gruppe.getTrackFormat(i);
                String text = typ == C.TRACK_TYPE_VIDEO ? format.height + "p"
                    : (format.label != null ? format.label : format.language != null ? format.language : "Spur " + (i + 1));
                namen.add(text);
                auswahl.add(new TrackSelectionOverride(gruppe.getMediaTrackGroup(), i));
            }
        }
        ExoPlayer lauf = player;
        dialog = new AlertDialog.Builder(activity).setTitle(name)
            .setItems(namen.toArray(new String[0]), (d, index) -> {
                if (player != lauf) return;
                androidx.media3.common.TrackSelectionParameters.Builder params = lauf.getTrackSelectionParameters()
                    .buildUpon().clearOverridesOfType(typ).setTrackTypeDisabled(typ, typ == C.TRACK_TYPE_TEXT && index == 0);
                if (auswahl.get(index) != null) params.setOverrideForType(auswahl.get(index));
                lauf.setTrackSelectionParameters(params.build());
            }).setNegativeButton("Zurück", null).show();
    }

    boolean taste(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK) return false;
        if (event.getKeyCode() == KeyEvent.KEYCODE_MENU) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                bild.showController();
                kopf.setVisibility(View.VISIBLE);
                kopf.requestFocus(View.FOCUS_DOWN);
            }
            return true;
        }
        if (player == null) return false;
        return bild.dispatchMediaKeyEvent(event);
    }

    boolean zurueck() {
        if (zaehlerEnde > 0 && !endeAbgesagt) {
            endeAbgesagt = true;
            zaehlerEnde = 0;
            meldung.setVisibility(View.GONE);
            return true;
        }
        return false;
    }

    private void freigeben() {
        if (player == null) return;
        handler.removeCallbacks(sprungMelden);
        sprungMelden.run();
        if (wartenderBefehl != null) {
            wartenderBefehl.angewendet = false;
            wartenderBefehl.rechnet = false;
        }
        speichern();
        bild.setPlayer(null);
        ExoPlayer alt = player;
        player = null;
        alt.release();
        bereitGemeldet = false;
        ansicht.setKeepScreenOn(false);
    }

    void schliessen() {
        sprungMelden.run();
        wartenderBefehl = null;
        geschlossen = true;
        handler.removeCallbacksAndMessages(null);
        if (dialog != null) dialog.dismiss();
        freigeben();
    }
}
