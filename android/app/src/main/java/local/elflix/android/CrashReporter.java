package local.elflix.android;

import android.content.Context;
import android.os.Build;
import android.util.Log;
import android.webkit.WebView;
import java.io.File;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Persists uncaught exceptions to a file so a crash can be diagnosed after the fact without
 * needing adb attached at the moment it happens.
 *
 * This deliberately does NOT swallow the crash: after writing the report it delegates to the
 * previously installed handler so the process still dies exactly as it otherwise would.
 */
public final class CrashReporter {
    static final String TAG = "ELFIX";
    private static final String FILE_NAME = "last_crash.txt";

    private CrashReporter() {
    }

    public static void install(Context context) {
        Context appContext = context.getApplicationContext();
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                write(appContext, thread, error);
            } catch (Throwable writeFailure) {
                Log.e(TAG, "Could not persist crash report", writeFailure);
            }
            if (previous != null) previous.uncaughtException(thread, error);
        });
    }

    private static void write(Context context, Thread thread, Throwable error) throws Exception {
        StringWriter stack = new StringWriter();
        error.printStackTrace(new PrintWriter(stack));

        String report = "Elflix crash report\n"
            + "time: " + new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.GERMANY).format(new Date()) + "\n"
            + "thread: " + thread.getName() + "\n"
            + environment(context)
            + "\n"
            + stack;

        Files.write(new File(context.getFilesDir(), FILE_NAME).toPath(), report.getBytes(StandardCharsets.UTF_8));
        Log.e(TAG, "FATAL on thread '" + thread.getName() + "'", error);
    }

    /** Device / WebView facts that make gerätespezifische WebView bugs identifiable. */
    public static String environment(Context context) {
        String webViewVersion = "unknown";
        try {
            android.content.pm.PackageInfo info = WebView.getCurrentWebViewPackage();
            if (info != null) webViewVersion = info.packageName + " " + info.versionName;
        } catch (Throwable ignored) {
            // Reading the WebView package must never be the reason a crash report is lost.
        }
        String appVersion = "unknown";
        try {
            appVersion = context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
        } catch (Throwable ignored) {
        }
        return "app: " + appVersion + "\n"
            + "android: " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")\n"
            + "device: " + Build.MANUFACTURER + " " + Build.MODEL + "\n"
            + "webview: " + webViewVersion + "\n";
    }

    public static String readLastCrash(Context context) {
        File file = new File(context.getFilesDir(), FILE_NAME);
        if (!file.exists()) return null;
        try {
            return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
        } catch (Exception readFailure) {
            Log.w(TAG, "Could not read crash report", readFailure);
            return null;
        }
    }

    public static void clear(Context context) {
        File file = new File(context.getFilesDir(), FILE_NAME);
        if (file.exists() && !file.delete()) Log.w(TAG, "Could not delete crash report");
    }
}
