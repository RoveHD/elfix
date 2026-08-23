package local.elflix.android;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Android TV view building blocks.
 *
 * Separate from {@link MobileViews} on purpose: a TV is read from several metres away with a D-pad,
 * so everything here is larger, carries an explicit focus state, and keeps a generous overscan-safe
 * margin. Sizes are expressed in dp and derived from the current configuration, so a 720p, 1080p or
 * 4K panel all scale correctly instead of relying on 1920x1080 pixel values.
 */
final class TvViews {
    /** Overscan-safe screen margin: roughly 5% of the panel, the standard TV safe area. */
    static final int SCREEN_PADDING = 48;
    static final int SECTION_GAP = 30;
    static final int ITEM_GAP = 18;
    static final int CARD_RADIUS = 16;
    static final int FOCUS_MS = 170;

    private TvViews() {
    }

    static int dp(Context context, float value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    /**
     * The single focus treatment used across every TV surface: a small lift, an accent outline and
     * elevation. Deliberately restrained -- readable from the couch without being jumpy.
     */
    static void applyFocus(View view, GradientDrawable idle, GradientDrawable focused) {
        view.setBackground(idle);
        view.setFocusable(true);
        view.setFocusableInTouchMode(true);
        view.setOnFocusChangeListener((v, hasFocus) -> {
            v.animate()
                .scaleX(hasFocus ? 1.05f : 1f)
                .scaleY(hasFocus ? 1.05f : 1f)
                .setDuration(FOCUS_MS)
                .start();
            v.setBackground(hasFocus ? focused : idle);
            v.setElevation(hasFocus ? dp(v.getContext(), 8) : 0);
        });
    }

    static TextView eyebrow(Context context, String text) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextColor(Theme.PRIMARY);
        view.setTextSize(15);
        view.setLetterSpacing(0.16f);
        view.setAllCaps(true);
        view.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        return view;
    }

    static TextView heroTitle(Context context, String text) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextColor(Theme.TEXT_PRIMARY);
        view.setTextSize(34);
        view.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD));
        view.setPadding(0, dp(context, 6), 0, 0);
        return view;
    }

    static TextView sectionTitle(Context context, String text) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextColor(Theme.TEXT_PRIMARY);
        view.setTextSize(22);
        view.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        return view;
    }

    static TextView body(Context context, String text) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextColor(Theme.TEXT_SECONDARY);
        view.setTextSize(17);
        view.setMaxLines(1);
        view.setEllipsize(TextUtils.TruncateAt.END);
        view.setPadding(0, dp(context, 8), 0, 0);
        return view;
    }

    /** Header action: icon plus label in a focusable pill. */
    static View headerButton(Context context, int iconRes, String label, Runnable onClick) {
        LinearLayout pill = new LinearLayout(context);
        pill.setOrientation(LinearLayout.HORIZONTAL);
        pill.setGravity(Gravity.CENTER_VERTICAL);
        pill.setPadding(dp(context, 18), dp(context, 10), dp(context, 20), dp(context, 10));
        applyFocus(pill,
            shape(context, Theme.SURFACE_ELEVATED, 26, Theme.BORDER, 1),
            shape(context, Theme.PRIMARY_MUTED, 26, Theme.PRIMARY, 2));

        ImageView icon = new ImageView(context);
        icon.setImageResource(iconRes);
        icon.setColorFilter(Theme.TEXT_PRIMARY);
        LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(dp(context, 22), dp(context, 22));
        iconParams.rightMargin = dp(context, 10);
        pill.addView(icon, iconParams);

        TextView text = new TextView(context);
        text.setText(label);
        text.setTextColor(Theme.TEXT_PRIMARY);
        text.setTextSize(16);
        text.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        text.setMaxLines(1);
        pill.addView(text);

        pill.setOnClickListener(v -> onClick.run());
        return pill;
    }

    /** Icon-only control for the TV browser bar. */
    static ImageView iconButton(Context context, int iconRes, Runnable onClick) {
        ImageView button = new ImageView(context);
        button.setImageResource(iconRes);
        button.setColorFilter(Theme.TEXT_PRIMARY);
        int pad = dp(context, 12);
        button.setPadding(pad, pad, pad, pad);
        applyFocus(button,
            shape(context, Color.TRANSPARENT, 14, Color.TRANSPARENT, 0),
            shape(context, Theme.PRIMARY_MUTED, 14, Theme.PRIMARY, 2));
        if (onClick != null) button.setOnClickListener(v -> onClick.run());
        return button;
    }

    static GradientDrawable shape(Context context, int fill, int radiusDp, int strokeColor, int strokeDp) {
        return MobileViews.shape(context, fill, radiusDp, strokeColor, strokeDp);
    }

    /**
     * Large provider card, legible from a distance: a tinted identity block with the provider's
     * short code, the name, and what it offers.
     */
    static View providerCard(Context context, Provider provider, String tagline, int widthDp,
                             Runnable onOpen, Runnable onOpenStart) {
        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(context, 18), dp(context, 18), dp(context, 18), dp(context, 18));
        applyFocus(card,
            shape(context, Theme.SURFACE_ELEVATED, CARD_RADIUS, Theme.BORDER, 1),
            shape(context, Theme.SURFACE_PRESSED, CARD_RADIUS, Theme.PRIMARY, 3));

        int tint = Theme.providerTint(provider.id);
        TextView badge = new TextView(context);
        String code = provider.logo == null || provider.logo.trim().isEmpty()
            ? MobileViews.initials(provider.name) : provider.logo.trim();
        badge.setText(code.length() > 2 ? code.substring(0, 2) : code);
        badge.setTextColor(Color.WHITE);
        badge.setTextSize(22);
        badge.setGravity(Gravity.CENTER);
        badge.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        GradientDrawable badgeBg = new GradientDrawable();
        badgeBg.setCornerRadius(dp(context, 14));
        badgeBg.setColors(new int[]{tint, MobileViews.blend(tint, Color.BLACK, 0.4f)});
        badgeBg.setOrientation(GradientDrawable.Orientation.TL_BR);
        badge.setBackground(badgeBg);
        card.addView(badge, new LinearLayout.LayoutParams(dp(context, 56), dp(context, 56)));

        TextView name = new TextView(context);
        name.setText(provider.name);
        name.setTextColor(Theme.TEXT_PRIMARY);
        name.setTextSize(20);
        name.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        name.setMaxLines(1);
        name.setEllipsize(TextUtils.TruncateAt.END);
        name.setPadding(0, dp(context, 14), 0, 0);
        card.addView(name);

        TextView desc = new TextView(context);
        desc.setText(tagline);
        desc.setTextColor(Theme.TEXT_SECONDARY);
        desc.setTextSize(15);
        desc.setMaxLines(1);
        desc.setEllipsize(TextUtils.TruncateAt.END);
        desc.setPadding(0, dp(context, 4), 0, 0);
        card.addView(desc);

        card.setOnClickListener(v -> onOpen.run());
        if (onOpenStart != null) {
            card.setOnLongClickListener(v -> {
                onOpenStart.run();
                return true;
            });
        }
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            dp(context, widthDp), ViewGroup.LayoutParams.WRAP_CONTENT);
        card.setLayoutParams(params);
        return card;
    }

    /** Continue-watching card with a designed poster block, since the store holds no artwork. */
    /**
     * Eine Kachel in einer der vier Listen.
     *
     * @param prozent Fortschritt der laufenden Folge; 0 blendet den Balken aus
     * @param onMenu  laengeres Druecken auf der Fernbedienung - dieselbe Auswahl
     *                wie das Dreipunktmenue auf dem Telefon
     */
    static View favoriteCard(Context context, Provider provider, String title, String episodeLine,
                             String providerName, int widthDp, int prozent,
                             Runnable onOpen, View.OnClickListener onMenu) {
        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(context, 12), dp(context, 12), dp(context, 12), dp(context, 14));
        applyFocus(card,
            shape(context, Theme.SURFACE_ELEVATED, CARD_RADIUS, Theme.BORDER, 1),
            shape(context, Theme.SURFACE_PRESSED, CARD_RADIUS, Theme.PRIMARY, 3));

        int tint = provider == null ? Theme.PRIMARY_DEEP : Theme.providerTint(provider.id);
        FrameLayout poster = new FrameLayout(context);
        GradientDrawable posterBg = new GradientDrawable();
        posterBg.setCornerRadius(dp(context, 10));
        posterBg.setColors(new int[]{MobileViews.blend(tint, Color.WHITE, 0.12f),
            MobileViews.blend(tint, Color.BLACK, 0.55f)});
        posterBg.setOrientation(GradientDrawable.Orientation.TL_BR);
        poster.setBackground(posterBg);
        TextView posterText = new TextView(context);
        posterText.setText(MobileViews.initials(title));
        posterText.setTextColor(Color.argb(235, 255, 255, 255));
        posterText.setTextSize(30);
        posterText.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        posterText.setGravity(Gravity.CENTER);
        poster.addView(posterText, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // Der Fortschritt liegt im Bild, wie auf dem Telefon - aus zwei Metern
        // Entfernung ist ein Balken unter dem Text kaum noch zu sehen.
        if (prozent > 0) {
            View spur = new View(context);
            GradientDrawable spurBg = new GradientDrawable();
            spurBg.setColor(Color.argb(150, 0, 0, 0));
            spur.setBackground(spurBg);
            FrameLayout.LayoutParams spurParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(context, 6));
            spurParams.gravity = Gravity.BOTTOM;
            poster.addView(spur, spurParams);

            View balken = new View(context);
            GradientDrawable balkenBg = new GradientDrawable();
            balkenBg.setColor(Theme.PRIMARY);
            balken.setBackground(balkenBg);
            FrameLayout.LayoutParams balkenParams = new FrameLayout.LayoutParams(0, dp(context, 6));
            balkenParams.gravity = Gravity.BOTTOM;
            poster.addView(balken, balkenParams);
            poster.post(() -> {
                FrameLayout.LayoutParams neu = (FrameLayout.LayoutParams) balken.getLayoutParams();
                neu.width = Math.max(dp(context, 4), poster.getWidth() * Math.min(100, prozent) / 100);
                balken.setLayoutParams(neu);
            });
        }

        card.addView(poster, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(context, 96)));

        TextView titleView = new TextView(context);
        titleView.setText(title);
        titleView.setTextColor(Theme.TEXT_PRIMARY);
        titleView.setTextSize(17);
        titleView.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        titleView.setMaxLines(2);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        titleView.setPadding(0, dp(context, 10), 0, 0);
        card.addView(titleView);

        if (episodeLine != null && !episodeLine.isEmpty()) {
            TextView episode = new TextView(context);
            episode.setText(episodeLine);
            episode.setTextColor(Theme.TEXT_SECONDARY);
            episode.setTextSize(14);
            episode.setMaxLines(1);
            episode.setEllipsize(TextUtils.TruncateAt.END);
            episode.setPadding(0, dp(context, 3), 0, 0);
            card.addView(episode);
        }
        if (providerName != null && !providerName.isEmpty()) {
            TextView who = new TextView(context);
            who.setText(providerName);
            who.setTextColor(Theme.PRIMARY);
            who.setTextSize(13);
            who.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            who.setMaxLines(1);
            who.setPadding(0, dp(context, 4), 0, 0);
            card.addView(who);
        }

        card.setOnClickListener(v -> onOpen.run());
        if (onMenu != null) {
            card.setOnLongClickListener(v -> {
                onMenu.onClick(v);
                return true;
            });
        }
        card.setLayoutParams(new LinearLayout.LayoutParams(
            dp(context, widthDp), ViewGroup.LayoutParams.WRAP_CONTENT));
        return card;
    }

    /** Settings/info block for TV, sized for reading at a distance. */
    static View infoCard(Context context, String title, String body, String actionLabel, Runnable onAction) {
        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(context, 22), dp(context, 20), dp(context, 22), dp(context, 20));
        card.setBackground(shape(context, Theme.SURFACE_ELEVATED, CARD_RADIUS, Theme.BORDER, 1));

        TextView head = new TextView(context);
        head.setText(title);
        head.setTextColor(Theme.TEXT_PRIMARY);
        head.setTextSize(20);
        head.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        card.addView(head);

        TextView text = new TextView(context);
        text.setText(body);
        text.setTextColor(Theme.TEXT_SECONDARY);
        text.setTextSize(16);
        text.setLineSpacing(0, 1.2f);
        text.setPadding(0, dp(context, 8), 0, 0);
        // Damit ein Nachtrag den Text spaeter wiederfindet, ohne dass die
        // ganze Seite neu gebaut werden muss.
        text.setTag("karten-text");
        card.addView(text);

        if (actionLabel != null && onAction != null) {
            TextView action = new TextView(context);
            action.setText(actionLabel);
            action.setTextColor(Theme.TEXT_PRIMARY);
            action.setTextSize(16);
            action.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            action.setGravity(Gravity.CENTER);
            action.setPadding(dp(context, 22), dp(context, 12), dp(context, 22), dp(context, 12));
            applyFocus(action,
                shape(context, Theme.SURFACE_PRESSED, 12, Theme.BORDER, 1),
                shape(context, Theme.PRIMARY_DEEP, 12, Theme.PRIMARY, 2));
            action.setOnClickListener(v -> onAction.run());
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            params.topMargin = dp(context, 16);
            card.addView(action, params);
        }
        return card;
    }
}
