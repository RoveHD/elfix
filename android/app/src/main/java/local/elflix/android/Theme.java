package local.elflix.android;

import android.graphics.Color;

/**
 * The ELFIX colour system.
 *
 * Layered surfaces instead of one flat navy: every step up the stack gets slightly lighter, which
 * is what makes cards read as cards on a dark background without needing heavy borders. The accent
 * is taken from the ELFIX logo itself (its vector fill is #147EFF), brightened a little so it
 * still passes as readable text/icon colour on the dark surfaces.
 */
public final class Theme {
    /** App background -- the darkest layer. */
    public static final int BACKGROUND = Color.parseColor("#070A12");
    /** Bars and sheets that sit on the background. */
    public static final int SURFACE = Color.parseColor("#0E1320");
    /** Cards and inputs that sit on a surface. */
    public static final int SURFACE_ELEVATED = Color.parseColor("#161D2C");
    /** Pressed state for anything on SURFACE_ELEVATED. */
    public static final int SURFACE_PRESSED = Color.parseColor("#1F2839");
    /** Hairline separators and card outlines. */
    public static final int BORDER = Color.parseColor("#232C3D");

    /** ELFIX blue, from the logo. */
    public static final int PRIMARY = Color.parseColor("#3D92FF");
    public static final int PRIMARY_DEEP = Color.parseColor("#147EFF");
    /** Translucent blue for selected backgrounds. */
    public static final int PRIMARY_MUTED = Color.parseColor("#1B2E4D");

    public static final int TEXT_PRIMARY = Color.parseColor("#F2F5FA");
    public static final int TEXT_SECONDARY = Color.parseColor("#98A3B8");
    public static final int TEXT_DISABLED = Color.parseColor("#5D6779");

    private Theme() {
    }

    /** Stable per-provider tint so each provider badge is recognisable at a glance. */
    public static int providerTint(String providerId) {
        String id = providerId == null ? "" : providerId.toLowerCase();
        if (id.contains("aniworld")) return Color.parseColor("#5B6BFF");
        if (id.contains("sto") || id.contains("s.to")) return Color.parseColor("#1E9BD7");
        if (id.contains("filmo")) return Color.parseColor("#17B98A");
        // Deterministic fallback so a user-added provider still gets a consistent colour.
        int[] palette = {
            Color.parseColor("#8B5CF6"), Color.parseColor("#EC6A5E"),
            Color.parseColor("#F0A93B"), Color.parseColor("#2DB8A0")
        };
        return palette[Math.abs(id.hashCode()) % palette.length];
    }
}
