package local.elflix.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/** Die Audio-Runde bleibt beim Appwechsel sichtbar; Capture bekommt seinen eigenen Service-Typ. */
public final class SprachchatDienst extends Service {
    static final String MUTE = "local.elflix.android.VOICE_MUTE";
    static final String LEAVE = "local.elflix.android.VOICE_LEAVE";
    private static final String CHANNEL = "elfix-sprachchat-mikrofon";
    interface Beobachter {
        int generation();
        void bereit(boolean erfolgreich, boolean mikrofon);
        void aktion(String aktion);
        void beendet();
    }
    static Beobachter beobachter;
    private int generation;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? "" : intent.getAction();
        if (beobachter == null) { stopSelf(); return START_NOT_STICKY; }
        if (intent == null || intent.getIntExtra("generation", -1) != beobachter.generation()) return START_NOT_STICKY;
        generation = beobachter.generation();
        if (MUTE.equals(action) || LEAVE.equals(action)) {
            if (beobachter != null) beobachter.aktion(action);
            else stopSelf();
            return START_NOT_STICKY;
        }
        boolean mikrofon = intent.getBooleanExtra("microphone", false);
        boolean playback = intent.getBooleanExtra("playback", false);
        try {
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(new NotificationChannel(CHANNEL,
                "Sprachchat", NotificationManager.IMPORTANCE_LOW));
            Intent open = new Intent(this, MainActivity.class)
                .setAction("local.elflix.android.VOICE_OPEN")
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            Notification.Builder builder = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_play)
                .setContentTitle(mikrofon ? "ELFIX – Mikrofon aktiv" : "ELFIX – Sprachchat, Mikrofon aus")
                .setContentText(mikrofon ? "Du sprichst im Sprachchat. Stummschalten oder verlassen."
                    : "Du hörst im Sprachchat zu. Auf dem Handy läuft kein zusätzliches Video.")
                .setContentIntent(PendingIntent.getActivity(this, 801, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
                .setOngoing(true).setCategory(Notification.CATEGORY_CALL);
            if (mikrofon) builder.addAction(new Notification.Action.Builder(null, "Stummschalten", aktion(MUTE, 802)).build());
            Notification notification = builder
                .addAction(new Notification.Action.Builder(null, "Verlassen", aktion(LEAVE, 803)).build()).build();
            if (Build.VERSION.SDK_INT >= 29) startForeground(804, notification,
                (playback ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0)
                    | (mikrofon && Build.VERSION.SDK_INT >= 30 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0));
            else startForeground(804, notification);
            beobachter.bereit(true, mikrofon);
        } catch (RuntimeException verweigert) {
            if (beobachter != null) beobachter.bereit(false, mikrofon);
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private PendingIntent aktion(String action, int code) {
        return PendingIntent.getService(this, code, new Intent(this, SprachchatDienst.class).setAction(action)
            .putExtra("generation", generation),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @Override public void onDestroy() {
        stopForeground(STOP_FOREGROUND_REMOVE);
        if (beobachter != null && generation == beobachter.generation()) beobachter.beendet();
        super.onDestroy();
    }
}
