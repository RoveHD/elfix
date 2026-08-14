package local.elflix.android;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Phone-only view building blocks.
 *
 * These exist so the mobile screens stop borrowing the TV layout: everything here is sized for a
 * thumb and a narrow viewport, uses one shared spacing scale, and derives its widths from the
 * current configuration rather than from fixed numbers that only suit one device.
 */
final class MobileViews {
    /** One spacing scale for every mobile screen, so gaps stay consistent. */
    static final int SCREEN_PADDING = 16;
    static final int SECTION_GAP = 26;
    static final int ITEM_GAP = 12;
    static final int CARD_RADIUS = 14;
    static final int TOUCH_TARGET = 46;

    private MobileViews() {
    }

    static int dp(Context context, float value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    static GradientDrawable shape(Context context, int fill, int radiusDp, int strokeColor, int strokeDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(context, radiusDp));
        if (strokeDp > 0) drawable.setStroke(dp(context, strokeDp), strokeColor);
        return drawable;
    }

    /** Press feedback for touch: the card darkens/lightens while held, then returns. */
    static void addPressFeedback(View view, GradientDrawable idle, GradientDrawable pressed) {
        view.setBackground(idle);
        view.setOnTouchListener((v, event) -> {
            int action = event.getActionMasked();
            if (action == MotionEvent.ACTION_DOWN) {
                v.setBackground(pressed);
                v.animate().scaleX(0.985f).scaleY(0.985f).setDuration(90).start();
            } else if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
                v.setBackground(idle);
                v.animate().scaleX(1f).scaleY(1f).setDuration(140).start();
            }
            return false;
        });
    }

    static TextView eyebrow(Context context, String text) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextColor(Theme.PRIMARY);
        view.setTextSize(12);
        view.setLetterSpacing(0.14f);
        view.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        view.setAllCaps(true);
        return view;
    }

    static TextView heroTitle(Context context, String text) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextColor(Theme.TEXT_PRIMARY);
        view.setTextSize(28);
        view.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD));
        view.setLineSpacing(0, 1.05f);
        view.setPadding(0, dp(context, 4), 0, 0);
        return view;
    }

    static TextView subtitle(Context context, String text) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextColor(Theme.TEXT_SECONDARY);
        view.setTextSize(14);
        view.setMaxLines(1);
        view.setEllipsize(TextUtils.TruncateAt.END);
        view.setPadding(0, dp(context, 6), 0, 0);
        return view;
    }

    /**
     * Compact section header with an optional trailing action, replacing the oversized standalone
     * headlines the phone layout used before.
     */
    static LinearLayout sectionHeader(Context context, String title, String actionLabel, Runnable onAction) {
        LinearLayout row = new LinearLayout(context);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        TextView label = new TextView(context);
        label.setText(title);
        label.setTextColor(Theme.TEXT_PRIMARY);
        label.setTextSize(19);
        label.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        label.setMaxLines(1);
        label.setEllipsize(TextUtils.TruncateAt.END);
        row.addView(label, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        if (actionLabel != null && onAction != null) {
            LinearLayout action = new LinearLayout(context);
            action.setOrientation(LinearLayout.HORIZONTAL);
            action.setGravity(Gravity.CENTER_VERTICAL);
            action.setPadding(dp(context, 8), dp(context, 6), dp(context, 4), dp(context, 6));
            TextView actionText = new TextView(context);
            actionText.setText(actionLabel);
            actionText.setTextColor(Theme.PRIMARY);
            actionText.setTextSize(13);
            actionText.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            action.addView(actionText);
            ImageView chevron = new ImageView(context);
            chevron.setImageResource(R.drawable.ic_chevron_right);
            chevron.setColorFilter(Theme.PRIMARY);
            action.addView(chevron, new LinearLayout.LayoutParams(dp(context, 16), dp(context, 16)));
            action.setOnClickListener(v -> onAction.run());
            row.addView(action);
        }
        return row;
    }

    /** Tappable search affordance that opens the search screen -- not a live input. */
    static View searchEntry(Context context, String hint, Runnable onClick) {
        LinearLayout box = new LinearLayout(context);
        box.setOrientation(LinearLayout.HORIZONTAL);
        box.setGravity(Gravity.CENTER_VERTICAL);
        box.setPadding(dp(context, 14), 0, dp(context, 14), 0);
        addPressFeedback(box,
            shape(context, Theme.SURFACE_ELEVATED, CARD_RADIUS, Theme.BORDER, 1),
            shape(context, Theme.SURFACE_PRESSED, CARD_RADIUS, Theme.PRIMARY, 1));

        ImageView icon = new ImageView(context);
        icon.setImageResource(R.drawable.ic_nav_search);
        icon.setColorFilter(Theme.TEXT_SECONDARY);
        LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(dp(context, 20), dp(context, 20));
        iconParams.rightMargin = dp(context, 10);
        box.addView(icon, iconParams);

        TextView label = new TextView(context);
        label.setText(hint);
        label.setTextColor(Theme.TEXT_SECONDARY);
        label.setTextSize(15);
        label.setMaxLines(1);
        label.setEllipsize(TextUtils.TruncateAt.END);
        box.addView(label, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        box.setOnClickListener(v -> onClick.run());
        return box;
    }

    /** Rounded badge carrying the provider's short code, tinted per provider. */
    static View providerBadge(Context context, Provider provider, int sizeDp, float textSp) {
        TextView badge = new TextView(context);
        String code = provider.logo == null || provider.logo.trim().isEmpty()
            ? initials(provider.name)
            : provider.logo.trim();
        badge.setText(code.length() > 2 ? code.substring(0, 2) : code);
        badge.setTextColor(Color.WHITE);
        badge.setTextSize(textSp);
        badge.setGravity(Gravity.CENTER);
        badge.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        int tint = Theme.providerTint(provider.id);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.RECTANGLE);
        bg.setCornerRadius(dp(context, sizeDp * 0.3f));
        bg.setColors(new int[]{tint, blend(tint, Color.BLACK, 0.35f)});
        bg.setOrientation(GradientDrawable.Orientation.TL_BR);
        badge.setBackground(bg);
        return badge;
    }

    static String initials(String name) {
        String value = name == null ? "" : name.trim();
        if (value.isEmpty()) return "?";
        return value.length() >= 2 ? value.substring(0, 2).toUpperCase() : value.toUpperCase();
    }

    static int blend(int color, int with, float ratio) {
        return Color.rgb(
            Math.round(Color.red(color) * (1 - ratio) + Color.red(with) * ratio),
            Math.round(Color.green(color) * (1 - ratio) + Color.green(with) * ratio),
            Math.round(Color.blue(color) * (1 - ratio) + Color.blue(with) * ratio));
    }

    /** Provider card: badge, name, one-line description. Sized by the grid, never fixed width. */
    static View providerCard(Context context, Provider provider, String tagline, Runnable onOpen, Runnable onOpenStart) {
        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.HORIZONTAL);
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setPadding(dp(context, 12), dp(context, 12), dp(context, 12), dp(context, 12));
        addPressFeedback(card,
            shape(context, Theme.SURFACE_ELEVATED, CARD_RADIUS, Theme.BORDER, 1),
            shape(context, Theme.SURFACE_PRESSED, CARD_RADIUS, Theme.PRIMARY, 1));

        View badge = providerBadge(context, provider, 40, 15);
        LinearLayout.LayoutParams badgeParams = new LinearLayout.LayoutParams(dp(context, 40), dp(context, 40));
        badgeParams.rightMargin = dp(context, 10);
        card.addView(badge, badgeParams);

        LinearLayout text = new LinearLayout(context);
        text.setOrientation(LinearLayout.VERTICAL);
        TextView name = new TextView(context);
        name.setText(provider.name);
        name.setTextColor(Theme.TEXT_PRIMARY);
        name.setTextSize(15);
        name.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        name.setMaxLines(1);
        name.setEllipsize(TextUtils.TruncateAt.END);
        text.addView(name);
        TextView desc = new TextView(context);
        desc.setText(tagline);
        desc.setTextColor(Theme.TEXT_SECONDARY);
        desc.setTextSize(12);
        desc.setMaxLines(1);
        desc.setEllipsize(TextUtils.TruncateAt.END);
        text.addView(desc);
        card.addView(text, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        card.setOnClickListener(v -> onOpen.run());
        if (onOpenStart != null) {
            card.setOnLongClickListener(v -> {
                onOpenStart.run();
                return true;
            });
        }
        return card;
    }

    /**
     * Continue-watching card: poster placeholder, title, episode line, provider, and a play cue.
     * There is no artwork in the favourites store, so the placeholder is designed rather than left
     * as an empty rectangle.
     */
    static View favoriteCard(Context context, Provider provider, String title, String episodeLine,
                             String providerName, Runnable onOpen, Runnable onRemove) {
        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.HORIZONTAL);
        card.setPadding(dp(context, 10), dp(context, 10), dp(context, 12), dp(context, 10));
        addPressFeedback(card,
            shape(context, Theme.SURFACE_ELEVATED, CARD_RADIUS, Theme.BORDER, 1),
            shape(context, Theme.SURFACE_PRESSED, CARD_RADIUS, Theme.PRIMARY, 1));

        FrameLayout poster = new FrameLayout(context);
        int tint = provider == null ? Theme.PRIMARY_DEEP : Theme.providerTint(provider.id);
        GradientDrawable posterBg = new GradientDrawable();
        posterBg.setCornerRadius(dp(context, 10));
        posterBg.setColors(new int[]{blend(tint, Color.WHITE, 0.10f), blend(tint, Color.BLACK, 0.55f)});
        posterBg.setOrientation(GradientDrawable.Orientation.TL_BR);
        poster.setBackground(posterBg);
        TextView posterText = new TextView(context);
        posterText.setText(initials(title));
        posterText.setTextColor(Color.argb(230, 255, 255, 255));
        posterText.setTextSize(22);
        posterText.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        posterText.setGravity(Gravity.CENTER);
        poster.addView(posterText, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        LinearLayout.LayoutParams posterParams = new LinearLayout.LayoutParams(dp(context, 66), dp(context, 88));
        posterParams.rightMargin = dp(context, 12);
        card.addView(poster, posterParams);

        LinearLayout text = new LinearLayout(context);
        text.setOrientation(LinearLayout.VERTICAL);
        text.setGravity(Gravity.CENTER_VERTICAL);

        TextView titleView = new TextView(context);
        titleView.setText(title);
        titleView.setTextColor(Theme.TEXT_PRIMARY);
        titleView.setTextSize(16);
        titleView.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        titleView.setMaxLines(2);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        text.addView(titleView);

        if (episodeLine != null && !episodeLine.isEmpty()) {
            TextView episode = new TextView(context);
            episode.setText(episodeLine);
            episode.setTextColor(Theme.TEXT_SECONDARY);
            episode.setTextSize(13);
            episode.setMaxLines(1);
            episode.setEllipsize(TextUtils.TruncateAt.END);
            episode.setPadding(0, dp(context, 3), 0, 0);
            text.addView(episode);
        }

        LinearLayout footer = new LinearLayout(context);
        footer.setOrientation(LinearLayout.HORIZONTAL);
        footer.setGravity(Gravity.CENTER_VERTICAL);
        footer.setPadding(0, dp(context, 6), 0, 0);
        ImageView play = new ImageView(context);
        play.setImageResource(R.drawable.ic_play);
        play.setColorFilter(Theme.PRIMARY);
        LinearLayout.LayoutParams playParams = new LinearLayout.LayoutParams(dp(context, 15), dp(context, 15));
        playParams.rightMargin = dp(context, 4);
        footer.addView(play, playParams);
        TextView cue = new TextView(context);
        cue.setText("Weiter ansehen");
        cue.setTextColor(Theme.PRIMARY);
        cue.setTextSize(12);
        cue.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        footer.addView(cue);
        if (providerName != null && !providerName.isEmpty()) {
            TextView dot = new TextView(context);
            dot.setText("  ·  " + providerName);
            dot.setTextColor(Theme.TEXT_DISABLED);
            dot.setTextSize(12);
            dot.setMaxLines(1);
            dot.setEllipsize(TextUtils.TruncateAt.END);
            footer.addView(dot);
        }
        text.addView(footer);

        card.addView(text, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        card.setOnClickListener(v -> onOpen.run());
        if (onRemove != null) {
            card.setOnLongClickListener(v -> {
                onRemove.run();
                return true;
            });
        }
        return card;
    }

    /** Square icon button for bars: 46dp hit area, 20dp glyph. */
    static ImageView iconButton(Context context, int iconRes, Runnable onClick) {
        ImageView button = new ImageView(context);
        button.setImageResource(iconRes);
        button.setColorFilter(Theme.TEXT_PRIMARY);
        int pad = dp(context, 13);
        button.setPadding(pad, pad, pad, pad);
        button.setBackground(shape(context, Color.TRANSPARENT, 12, Color.TRANSPARENT, 0));
        button.setOnTouchListener((v, event) -> {
            int action = event.getActionMasked();
            if (action == MotionEvent.ACTION_DOWN) {
                v.setBackground(shape(context, Theme.SURFACE_PRESSED, 12, Color.TRANSPARENT, 0));
            } else if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
                v.setBackground(shape(context, Color.TRANSPARENT, 12, Color.TRANSPARENT, 0));
            }
            return false;
        });
        if (onClick != null) button.setOnClickListener(v -> onClick.run());
        return button;
    }

    /** Primary action button: ELFIX blue, white label. */
    static TextView primaryButton(Context context, String label, Runnable onClick) {
        TextView button = styledButton(context, label, Color.WHITE);
        addPressFeedback(button,
            shape(context, Theme.PRIMARY_DEEP, 12, Color.TRANSPARENT, 0),
            shape(context, Theme.PRIMARY, 12, Color.TRANSPARENT, 0));
        button.setOnClickListener(v -> onClick.run());
        return button;
    }

    /** Secondary action button: dark surface, hairline border. */
    static TextView secondaryButton(Context context, String label, Runnable onClick) {
        TextView button = styledButton(context, label, Theme.TEXT_PRIMARY);
        addPressFeedback(button,
            shape(context, Theme.SURFACE_ELEVATED, 12, Theme.BORDER, 1),
            shape(context, Theme.SURFACE_PRESSED, 12, Theme.PRIMARY, 1));
        button.setOnClickListener(v -> onClick.run());
        return button;
    }

    private static TextView styledButton(Context context, String label, int textColor) {
        TextView button = new TextView(context);
        button.setText(label);
        button.setTextColor(textColor);
        button.setTextSize(15);
        button.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        button.setGravity(Gravity.CENTER);
        button.setMaxLines(1);
        button.setEllipsize(TextUtils.TruncateAt.END);
        button.setPadding(dp(context, 18), 0, dp(context, 18), 0);
        button.setMinHeight(dp(context, TOUCH_TARGET));
        return button;
    }

    /** Empty-state block used instead of a bare screen when a list has nothing in it. */
    static View emptyState(Context context, int iconRes, String headline, String body) {
        LinearLayout box = new LinearLayout(context);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(dp(context, 20), dp(context, 44), dp(context, 20), dp(context, 20));

        FrameLayout circle = new FrameLayout(context);
        circle.setBackground(shape(context, Theme.SURFACE_ELEVATED, 34, Theme.BORDER, 1));
        ImageView icon = new ImageView(context);
        icon.setImageResource(iconRes);
        icon.setColorFilter(Theme.TEXT_DISABLED);
        int iconPad = dp(context, 18);
        icon.setPadding(iconPad, iconPad, iconPad, iconPad);
        circle.addView(icon, new FrameLayout.LayoutParams(dp(context, 68), dp(context, 68)));
        box.addView(circle, new LinearLayout.LayoutParams(dp(context, 68), dp(context, 68)));

        TextView head = new TextView(context);
        head.setText(headline);
        head.setTextColor(Theme.TEXT_PRIMARY);
        head.setTextSize(17);
        head.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        head.setGravity(Gravity.CENTER);
        head.setPadding(0, dp(context, 16), 0, 0);
        box.addView(head);

        TextView text = new TextView(context);
        text.setText(body);
        text.setTextColor(Theme.TEXT_SECONDARY);
        text.setTextSize(14);
        text.setGravity(Gravity.CENTER);
        text.setPadding(0, dp(context, 6), 0, 0);
        box.addView(text);
        return box;
    }
}
