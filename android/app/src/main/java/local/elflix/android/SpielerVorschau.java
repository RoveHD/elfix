package local.elflix.android;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Matrix;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.TextureView;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.Player;
import androidx.media3.common.VideoSize;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import java.util.Map;

/** A short, muted decoder used only while the viewer drags a seek position. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class SpielerVorschau {
    private static final long DEBOUNCE_MS = 150;
    private static final long FRIST_MS = 3_000;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final FrameLayout rahmen;
    private final TextureView bild;
    private final TextView zeit;
    private ExoPlayer player;
    private String url = "";
    private String typ = "";
    private Map<String, String> kopfzeilen;
    private double ziel;
    private boolean frameGerendert;
    private float videoSeitenverhaeltnis;
    private final Runnable starten;

    SpielerVorschau(Activity activity, FrameLayout eltern) {
        rahmen = new FrameLayout(activity);
        rahmen.setBackgroundColor(Color.BLACK);
        rahmen.setVisibility(View.GONE);
        // A PlayerView defaults to SurfaceView. The primary player is also a
        // SurfaceView, which Android composites above normal overlay views.
        // A TextureView keeps this small preview in the regular view layer.
        bild = new TextureView(activity);
        bild.setTag("vorschau-video");
        bild.addOnLayoutChangeListener((v, links, oben, rechts, unten, alteLinks, alteOben,
                                       alteRechts, alteUnten) -> seitenverhaeltnisAnwenden());
        rahmen.addView(bild, new FrameLayout.LayoutParams(-1, -1));
        zeit = new TextView(activity);
        zeit.setTextColor(Color.WHITE);
        zeit.setTextSize(12);
        zeit.setPadding(dp(activity, 7), dp(activity, 3), dp(activity, 7), dp(activity, 3));
        zeit.setBackgroundColor(0xB8000000);
        rahmen.addView(zeit, new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.END));
        FrameLayout.LayoutParams lage = new FrameLayout.LayoutParams(dp(activity, 192), dp(activity, 108),
            Gravity.BOTTOM | Gravity.END);
        lage.rightMargin = dp(activity, 20);
        lage.bottomMargin = dp(activity, 124);
        eltern.addView(rahmen, lage);
        starten = this::starten;
    }

    void zeigen(String neueUrl, String neuerTyp, Map<String, String> neueKopfzeilen,
                double neueZiel, String text) {
        if (neueUrl == null || neueUrl.isEmpty()) return;
        url = neueUrl;
        typ = neuerTyp == null ? "" : neuerTyp;
        kopfzeilen = neueKopfzeilen;
        ziel = Math.max(0, neueZiel);
        frameGerendert = false;
        bild.setAlpha(0f);
        videoSeitenverhaeltnis = 0;
        zeit.setText(text);
        rahmen.setVisibility(View.VISIBLE);
        rahmen.bringToFront();
        handler.removeCallbacks(starten);
        handler.removeCallbacks(frist);
        // A new target must never show the previous target's retained frame or label.
        freigeben();
        handler.postDelayed(starten, DEBOUNCE_MS);
    }

    private final Runnable frist = this::verbergen;

    private void starten() {
        try {
            OkHttpDataSource.Factory netz = new OkHttpDataSource.Factory(CookieNetz.erstellen())
                .setDefaultRequestProperties(kopfzeilen);
            player = new ExoPlayer.Builder(rahmen.getContext())
                .setMediaSourceFactory(new DefaultMediaSourceFactory(netz))
                .setLoadControl(new DefaultLoadControl.Builder()
                    .setBufferDurationsMs(750, 3_000, 500, 750).setBackBuffer(0, false).build())
                .build();
            player.setVolume(0f);
            player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true)
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                .setMaxVideoSize(480, 270).build());
            player.setVideoTextureView(bild);
            ExoPlayer lauf = player;
            lauf.addListener(new Player.Listener() {
            @Override public void onVideoSizeChanged(VideoSize groesse) {
                if (lauf != player) return;
                if (groesse.width <= 0 || groesse.height <= 0) return;
                videoSeitenverhaeltnis = groesse.width * groesse.pixelWidthHeightRatio / groesse.height;
                seitenverhaeltnisAnwenden();
            }
            @Override public void onRenderedFirstFrame() {
                if (lauf != player) return;
                // One visible frame is enough; pause retains it in the bubble.
                frameGerendert = true;
                bild.setAlpha(1f);
                lauf.pause();
                handler.removeCallbacks(frist);
            }
            @Override public void onPlayerError(androidx.media3.common.PlaybackException fehler) {
                if (lauf == player) verbergen();
            }
            });
            MediaItem.Builder item = new MediaItem.Builder().setUri(Uri.parse(url));
            if ("hls".equals(typ)) item.setMimeType(MimeTypes.APPLICATION_M3U8);
            long position = Math.round(ziel * 1000);
            if ("hls".equals(typ)) {
                KanonischesHls hls = new KanonischesHls(netz, null);
                lauf.setMediaSource(hls.fabrik().createMediaSource(item.build()), position);
            } else lauf.setMediaItem(item.build(), position);
            lauf.prepare();
            lauf.play();
            handler.postDelayed(frist, FRIST_MS);
        } catch (RuntimeException fehler) {
            // Decoder allocation and malformed source setup are preview-only failures.
            verbergen();
        }
    }

    void verbergen() {
        handler.removeCallbacks(starten);
        handler.removeCallbacks(frist);
        rahmen.setVisibility(View.GONE);
        freigeben();
    }

    void schliessen() { verbergen(); }
    boolean sichtbar() { return rahmen.getVisibility() == View.VISIBLE; }
    boolean hatFrame() { return frameGerendert; }

    private void freigeben() {
        if (player == null) return;
        ExoPlayer alt = player;
        player = null;
        alt.clearVideoTextureView(bild);
        alt.release();
    }

    /** Letterbox the regular-view TextureView instead of stretching non-16:9 sources. */
    private void seitenverhaeltnisAnwenden() {
        if (videoSeitenverhaeltnis <= 0 || bild.getWidth() <= 0 || bild.getHeight() <= 0) return;
        float ansicht = bild.getWidth() / (float) bild.getHeight();
        Matrix matrix = new Matrix();
        if (videoSeitenverhaeltnis > ansicht) {
            matrix.setScale(1f, ansicht / videoSeitenverhaeltnis,
                bild.getWidth() / 2f, bild.getHeight() / 2f);
        } else {
            matrix.setScale(videoSeitenverhaeltnis / ansicht, 1f,
                bild.getWidth() / 2f, bild.getHeight() / 2f);
        }
        bild.setTransform(matrix);
    }

    private static int dp(Activity activity, int wert) {
        return Math.round(wert * activity.getResources().getDisplayMetrics().density);
    }
}
