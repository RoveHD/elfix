package local.elflix.android;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.List;

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
    static final int SCREEN_PADDING = 56;
    static final int SECTION_GAP = 40;
    static final int ITEM_GAP = 18;
    static final int CARD_RADIUS = 24;

    /**
     * Wie gross eine Karte im Fokus wird.
     *
     * <p>Der Rahmen und die Hoehe sagen bereits klar, wo der Fokus steht. Eine
     * zusaetzliche Vergroesserung von dreieinhalb Prozent gibt Tiefe, ohne dass
     * bei schnellem D-pad-Wechsel mehrere Karten gegeneinander zu schwimmen scheinen.
     */
    static final float FOKUS_GROSS = 1.035f;

    private TvViews() {
    }

    static int dp(Context context, float value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    /**
     * Die Kopfzeile muss auch bei 960 dp fünf Ziele tragen können. Die Karten
     * bleiben groß; nur die wiederholten Navigations-Pills verdichten sich.
     */
    static int kopfTextGroesseSp(int breiteDp) { return breiteDp < 1280 ? 15 : 17; }
    static int kopfRandHorizontalDp(int breiteDp) { return breiteDp < 1280 ? 10 : 16; }
    static int kopfRandVertikalDp(int breiteDp) { return breiteDp < 1280 ? 8 : 12; }
    static int kopfIconDp(int breiteDp) { return breiteDp < 1280 ? 20 : 22; }

    /**
     * The single focus treatment used across every TV surface. It is deliberately a calm outline
     * and lift instead of the bouncy, oversized "tile jumps at me" effect common in TV apps.
     */
    static void applyFocus(View view, Drawable idle, Drawable focused) {
        applyFocus(view, idle, focused, FOKUS_GROSS);
    }

    /**
     * Dieselbe Behandlung, aber mit eigenem Mass.
     *
     * <p>Kopfziele wachsen weniger als Poster. Groesse und Schatten laufen
     * gemeinsam ohne Ueberschwingen; OK bekommt eine kurze Druckreaktion.
     */
    static void applyFocus(View view, final Drawable idle, final Drawable focused,
                           final float gross) {
        view.setBackground(idle);
        view.setFocusable(true);
        view.setFocusableInTouchMode(true);
        view.setClipToOutline(false);
        view.setOnFocusChangeListener((v, hasFocus) -> {
            v.setBackground(hasFocus ? focused : idle);
            Bewegung.fokus(v, hasFocus, gross, 12f);
        });
        view.setOnKeyListener((v, code, ereignis) -> {
            if (ereignis.getAction() == android.view.KeyEvent.ACTION_DOWN
                && ereignis.getRepeatCount() == 0
                && (code == android.view.KeyEvent.KEYCODE_DPAD_CENTER
                    || code == android.view.KeyEvent.KEYCODE_ENTER
                    || code == android.view.KeyEvent.KEYCODE_NUMPAD_ENTER)) {
                Bewegung.tastendruck(v, gross);
            }
            // Immer durchlassen: hier wird nur quittiert, entschieden wird
            // woanders.
            return false;
        });
    }

    static TextView eyebrow(Context context, String text) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextColor(Theme.PRIMARY);
        view.setTextSize(13);
        view.setLetterSpacing(0.18f);
        view.setAllCaps(true);
        view.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        return view;
    }

    static TextView heroTitle(Context context, String text) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextColor(Theme.TEXT_PRIMARY);
        view.setTextSize(42);
        view.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD));
        view.setPadding(0, dp(context, 6), 0, 0);
        return view;
    }

    static TextView sectionTitle(Context context, String text) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextColor(Theme.TEXT_PRIMARY);
        view.setTextSize(26);
        view.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        return view;
    }

    static TextView body(Context context, String text) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextColor(Theme.TEXT_SECONDARY);
        view.setTextSize(18);
        view.setLineSpacing(dp(context, 2), 1.12f);
        // Zwei Zeilen statt einer: Fliesstext.
        view.setMaxLines(2);
        view.setEllipsize(TextUtils.TruncateAt.END);
        view.setPadding(0, dp(context, 8), 0, 0);
        return view;
    }

    /** Header action: icon plus label in a focusable pill. */
    static View headerButton(Context context, int iconRes, String label, Runnable onClick) {
        LinearLayout pill = new LinearLayout(context);
        pill.setOrientation(LinearLayout.HORIZONTAL);
        pill.setGravity(Gravity.CENTER_VERTICAL);
        int breite = context.getResources().getConfiguration().screenWidthDp;
        int quer = kopfRandHorizontalDp(breite);
        pill.setPadding(dp(context, quer), dp(context, kopfRandVertikalDp(breite)),
            dp(context, quer + 2), dp(context, kopfRandVertikalDp(breite)));
        pill.setMinimumHeight(dp(context, 52));
        applyFocus(pill,
            headerIdle(context),
            surfaceGradient(context, Theme.PRIMARY_MUTED, CARD_RADIUS, Theme.PRIMARY, 2),
            1.02f);

        ImageView icon = new ImageView(context);
        icon.setImageResource(iconRes);
        icon.setColorFilter(Theme.TEXT_PRIMARY);
        int iconGroesse = kopfIconDp(breite);
        LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(dp(context, iconGroesse), dp(context, iconGroesse));
        iconParams.rightMargin = dp(context, breite < 1280 ? 5 : 8);
        pill.addView(icon, iconParams);

        TextView text = new TextView(context);
        text.setText(label);
        text.setTextColor(Theme.TEXT_PRIMARY);
        text.setTextSize(kopfTextGroesseSp(breite));
        text.setLetterSpacing(0.01f);
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

    /** A very restrained surface sheen separates dense TV cards without a costly blur or shadow. */
    static GradientDrawable surfaceGradient(Context context, int fill, int radiusDp,
                                            int strokeColor, int strokeDp) {
        GradientDrawable drawable = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
            new int[] { MobileViews.blend(fill, Color.WHITE, 0.035f), fill });
        drawable.setCornerRadius(dp(context, radiusDp));
        if (strokeDp > 0) drawable.setStroke(dp(context, strokeDp), strokeColor);
        return drawable;
    }

    /**
     * Header navigation keeps its active destination visible after D-pad focus moves away.
     * Focus still wins while a button is being operated; on exit this stateful idle background
     * restores the quieter blue selection instead of making the current section disappear.
     */
    private static StateListDrawable headerIdle(Context context) {
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[] { android.R.attr.state_activated },
            surfaceGradient(context, Theme.PRIMARY_MUTED, CARD_RADIUS, Theme.PRIMARY, 1));
        states.addState(new int[] {},
            surfaceGradient(context, Theme.SURFACE_ELEVATED, CARD_RADIUS, Theme.BORDER, 1));
        return states;
    }

    /**
     * Large provider card, legible from a distance: a tinted identity block with the provider's
     * short code, the name, and what it offers.
     */
    static View providerCard(Context context, Provider provider, String tagline, int widthDp,
                             Runnable onOpen, Runnable onOpenStart) {
        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setClipChildren(false);
        card.setClipToPadding(false);
        card.setPadding(dp(context, 22), dp(context, 22), dp(context, 22), dp(context, 20));
        applyFocus(card,
            surfaceGradient(context, Theme.SURFACE_ELEVATED, CARD_RADIUS, Theme.BORDER, 1),
            surfaceGradient(context, Theme.SURFACE_PRESSED, CARD_RADIUS, Theme.PRIMARY, 2));

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
        name.setTextSize(21);
        name.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        // Zwei Zeilen statt einer: Name des Anbieters.
        name.setMaxLines(2);
        name.setEllipsize(TextUtils.TruncateAt.END);
        name.setPadding(0, dp(context, 14), 0, 0);
        card.addView(name);

        TextView desc = new TextView(context);
        desc.setText(tagline);
        desc.setTextColor(Theme.TEXT_SECONDARY);
        desc.setTextSize(16);
        desc.setLineSpacing(dp(context, 1), 1.08f);
        // Zwei Zeilen statt einer: Was der Anbieter anbietet.
        desc.setMaxLines(2);
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

    /** Continue-watching tile: the entry's artwork, with the designed block underneath it. */
    /**
     * Eine Kachel in einer der vier Listen.
     *
     * @param bildUrl das Titelbild des Eintrags - ohne eines bleibt der Platzhalter
     * @param prozent Fortschritt der laufenden Folge; 0 blendet den Balken aus
     * @param onMenu  laengeres Druecken auf der Fernbedienung - dieselbe Auswahl
     *                wie das Dreipunktmenue auf dem Telefon
     */
    static View favoriteCard(Context context, Provider provider, String title, String episodeLine,
                             String providerName, String bildUrl, int widthDp, int prozent,
                             Runnable onOpen, View.OnClickListener onMenu) {
        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setClipChildren(false);
        card.setClipToPadding(false);
        card.setPadding(dp(context, 14), dp(context, 14), dp(context, 14), dp(context, 18));
        // Damit das Kachelmenue seine eigene Zeile wiederfindet - beim
        // Loeschen wird sie ausgeblendet, bevor der Bestand sich aendert.
        card.setTag(R.id.elfix_karte, Boolean.TRUE);
        applyFocus(card,
            surfaceGradient(context, Theme.SURFACE_ELEVATED, CARD_RADIUS, Theme.BORDER, 1),
            surfaceGradient(context, Theme.SURFACE_PRESSED, CARD_RADIUS, Theme.PRIMARY, 2));

        // Derselbe Bildkasten wie auf dem Telefon - nur groesser, mit
        // groesseren Buchstaben und einem Balken, der aus zwei Metern
        // Entfernung noch zu sehen ist.
        FrameLayout poster = MobileViews.poster(context, provider, title, bildUrl, prozent,
            widthDp, 96, 30, 6);

        card.addView(poster, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(context, 96)));

        TextView titleView = new TextView(context);
        titleView.setText(title);
        titleView.setTextColor(Theme.TEXT_PRIMARY);
        titleView.setTextSize(18);
        titleView.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        titleView.setMaxLines(2);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        titleView.setPadding(0, dp(context, 10), 0, 0);
        card.addView(titleView);

        if (episodeLine != null && !episodeLine.isEmpty()) {
            TextView episode = new TextView(context);
            episode.setText(episodeLine);
            episode.setTextColor(Theme.TEXT_SECONDARY);
            episode.setTextSize(15);
            // Zwei Zeilen statt einer: Die Folgenzeile einer Karte.
            episode.setMaxLines(2);
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
        card.setBackground(surfaceGradient(context, Theme.SURFACE_ELEVATED, CARD_RADIUS, Theme.BORDER, 1));

        TextView head = new TextView(context);
        head.setText(title);
        head.setTextColor(Theme.TEXT_PRIMARY);
        head.setTextSize(21);
        head.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        card.addView(head);

        TextView text = new TextView(context);
        text.setText(body);
        text.setTextColor(Theme.TEXT_SECONDARY);
        text.setTextSize(17);
        text.setLineSpacing(dp(context, 2), 1.18f);
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
                surfaceGradient(context, Theme.SURFACE_PRESSED, 14, Theme.BORDER, 1),
                surfaceGradient(context, Theme.PRIMARY_DEEP, 14, Theme.PRIMARY, 2));
            action.setOnClickListener(v -> onAction.run());
            // Damit die Beschriftung spaeter fortgeschrieben werden kann, ohne
            // dass die Karte neu entsteht - siehe MainActivity.kartenKnopf().
            action.setTag("karten-knopf");
            action.setVisibility(actionLabel.isEmpty() ? View.GONE : View.VISIBLE);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            params.topMargin = dp(context, 16);
            card.addView(action, params);
        }
        return card;
    }

    /* ======================================================================
     * Die Bausteine der Startseite.
     *
     * Sie stehen hier und nicht in MobileViews, obwohl beide Seiten dieselben
     * Reihen zeigen: was sie unterscheidet, ist nichts, was sich mit einem
     * Groessenfaktor erledigen liesse. Auf dem Telefon fuehrt ein Daumen ueber
     * eine Flaeche und trifft, was er sieht; auf dem Fernseher springt ein
     * Fokus von Kasten zu Kasten, und jeder Kasten muss von zwei Metern aus
     * sagen, ob er gerade dran ist. Deshalb traegt hier jedes Ziel seinen
     * Fokuszustand, und deshalb ist hier nichts vom Telefon uebernommen ausser
     * dem, was wirklich dasselbe ist - der Bildkasten und der
     * Fortschrittsbalken kommen aus MobileViews.
     * ==================================================================== */

    /** Vier Poster samt Innenraendern und Abstaenden passen auf uebliche TV-Breiten. */
    static int kachelBreiteDp(Context context) {
        int breite = context.getResources().getConfiguration().screenWidthDp;
        return Math.max(168, Math.min(264,
            (int) Math.floor((breite - 2f * SCREEN_PADDING - 3f * ITEM_GAP) / 4f - 20f)));
    }

    /**
     * Wie hoch der Titelhintergrund sein darf.
     *
     * <p>Knapp die Haelfte des Bildes und nicht mehr: darunter muss die erste
     * Reihe noch anfangen, sonst weiss niemand, dass es weitergeht. Gerechnet
     * und nicht festgelegt - ein 720p-Panel meldet eine andere Hoehe in dp als
     * ein 4K-Panel, und eine feste Zahl waere auf einem der beiden falsch.
     */
    static int heroHoeheDp(Context context) {
        int hoehe = context.getResources().getConfiguration().screenHeightDp;
        return Math.max(238, Math.min(372, Math.round(hoehe * 0.46f)));
    }

    /**
     * Die Ueberschrift einer Reihe, rechts davon der Weg zu mehr.
     *
     * <p>Der Knopf ist ein eigenes Fokusziel und liegt <em>vor</em> der Reihe
     * in der Reihenfolge: wer von oben herunterkommt, landet zuerst auf der
     * Ueberschrift und geht mit rechts zu "Mehr anzeigen", mit unten in die
     * Kacheln. Umgekehrt waere der Knopf nur ueber die Kacheln erreichbar.
     */
    static LinearLayout sectionHeader(Context context, String titel, String aktion,
                                      Runnable beiAktion) {
        LinearLayout reihe = new LinearLayout(context);
        reihe.setOrientation(LinearLayout.HORIZONTAL);
        reihe.setGravity(Gravity.CENTER_VERTICAL);
        reihe.setClipChildren(false);
        reihe.setClipToPadding(false);

        TextView ueberschrift = sectionTitle(context, titel);
        reihe.addView(ueberschrift, new LinearLayout.LayoutParams(
            0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        if (aktion != null && !aktion.isEmpty() && beiAktion != null) {
            reihe.addView(pillButton(context, aktion, beiAktion));
        }
        return reihe;
    }

    /**
     * Derselbe Knopf, aber als Hauptaktion.
     *
     * <p>Ein Unterschied, den es auf dem Fernseher wirklich braucht: dort
     * stehen unter einem Watchparty-Eintrag mehrere Knoepfe nebeneinander, und
     * ohne sichtbaren Vorrang sucht man den richtigen. Der Fokusrahmen ist
     * derselbe - er sagt, wo man steht, nicht, was wichtig ist.
     */
    static TextView hauptPillButton(Context context, String label, Runnable beiKlick) {
        TextView knopf = pillButton(context, label, beiKlick);
        knopf.setTextColor(Color.WHITE);
        applyFocus(knopf,
            surfaceGradient(context, Theme.PRIMARY_DEEP, 24, Theme.PRIMARY, 2),
            surfaceGradient(context, Theme.PRIMARY, 24, Color.WHITE, 2));
        return knopf;
    }

    /** Ein flacher Knopf mit Fokusrand - fuer "Mehr anzeigen", "Erneut versuchen" und dergleichen. */
    static TextView pillButton(Context context, String label, Runnable beiKlick) {
        TextView knopf = new TextView(context);
        knopf.setText(label);
        knopf.setTextColor(Theme.TEXT_PRIMARY);
        knopf.setTextSize(16);
        knopf.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        knopf.setGravity(Gravity.CENTER);
        knopf.setMaxLines(1);
        knopf.setPadding(dp(context, 22), dp(context, 11), dp(context, 22), dp(context, 11));
        applyFocus(knopf,
            surfaceGradient(context, Theme.SURFACE_ELEVATED, 24, Theme.BORDER, 1),
            surfaceGradient(context, Theme.PRIMARY_MUTED, 24, Theme.PRIMARY, 2));
        if (beiKlick != null) knopf.setOnClickListener(v -> beiKlick.run());
        else knopf.setEnabled(false);
        return knopf;
    }

    /**
     * Eine waagerechte Reihe.
     *
     * <p>Sie scrollt nicht mit dem Finger, sondern mit dem Fokus: eine
     * ScrollView schiebt von sich aus so weit, dass ihr fokussiertes Kind ganz
     * zu sehen ist. Das ist der Grund, warum hier {@code clipToPadding=false}
     * und ein Rand von einer halben Kachelbreite stehen - ohne beides endete
     * die fokussierte Kachel genau an der Kante, und der um fuenf Prozent
     * vergroesserte Fokusrahmen waere abgeschnitten.
     */
    static HorizontalScrollView reihe(Context context, List<View> karten) {
        HorizontalScrollView scroll = new HorizontalScrollView(context);
        scroll.setHorizontalScrollBarEnabled(false);
        scroll.setClipToPadding(false);
        scroll.setClipChildren(false);
        // Der eigene Rand ist der Ueberstand des Fokusrahmens, nicht der
        // Seitenrand: der steht schon an der Seite.
        int luft = dp(context, 16);
        scroll.setPadding(0, luft, dp(context, SCREEN_PADDING), luft);
        LinearLayout leiste = new LinearLayout(context);
        leiste.setOrientation(LinearLayout.HORIZONTAL);
        leiste.setClipChildren(false);
        leiste.setClipToPadding(false);
        for (int i = 0; i < karten.size(); i += 1) {
            View karte = karten.get(i);
            LinearLayout.LayoutParams params = karte.getLayoutParams() instanceof LinearLayout.LayoutParams
                ? (LinearLayout.LayoutParams) karte.getLayoutParams()
                : new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            if (i > 0) params.leftMargin = dp(context, ITEM_GAP);
            leiste.addView(karte, params);
        }
        scroll.addView(leiste, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        MobileViews.staffelnWennFrei(scroll, leiste, 0L);
        return scroll;
    }

    /** Die Leiste einer Reihe - fuer das Nachlegen weiterer Kacheln ohne Neuaufbau. */
    static LinearLayout leisteVon(HorizontalScrollView reihe) {
        View kind = reihe == null ? null : reihe.getChildAt(0);
        return kind instanceof LinearLayout ? (LinearLayout) kind : null;
    }

    /** Eine Kachel an eine bestehende Reihe anhaengen - ohne die Reihe neu zu bauen. */
    static void kachelAnhaengen(HorizontalScrollView reihe, View karte) {
        LinearLayout leiste = leisteVon(reihe);
        if (leiste == null) return;
        LinearLayout.LayoutParams params = karte.getLayoutParams() instanceof LinearLayout.LayoutParams
            ? (LinearLayout.LayoutParams) karte.getLayoutParams()
            : new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        if (leiste.getChildCount() > 0) params.leftMargin = dp(reihe.getContext(), ITEM_GAP);
        leiste.addView(karte, params);
    }

    /**
     * Eine Kachel: Poster oben, Text darunter.
     *
     * <p>Hochkant, weil Titelbilder Poster sind, und mit dem Fortschritt im
     * Bild - dieselbe Anordnung wie auf dem Telefon und am Rechner, damit
     * dieselbe Serie auf allen drei Geraeten gleich aussieht.
     *
     * @param fahne     ein Aufkleber oben ("Neue Folge"), leer erlaubt
     * @param prozent   Fortschritt, 0 laesst den Balken weg
     * @param onMenu    das lange Druecken auf der Fernbedienung
     */
    static View kachel(Context context, Provider provider, String titel, String unterzeile,
                       String bildUrl, int prozent, String fahne, int breiteDp,
                       Bilder.Sichtfenster fenster, Runnable beiKlick, View.OnClickListener onMenu) {
        return kachel(context, provider, titel, unterzeile, bildUrl, prozent, fahne, breiteDp,
            "", "", fenster, beiKlick, onMenu);
    }

    /**
     * Dieselbe Kachel, dazu die Stelle und die Zeile aus der Runde.
     *
     * <p>Wie am Telefon und aus demselben Grund - siehe
     * {@link MobileViews#kachel}. Auf dem Fernseher wiegt der Grund schwerer:
     * dort haelt eine Ansicht den Fokus, und eine Seite, die jede Sekunde neu
     * gebaut wird, wirft die Fernbedienung jede Sekunde an den Anfang.
     */
    static View kachel(Context context, Provider provider, String titel, String unterzeile,
                       String bildUrl, int prozent, String fahne, int breiteDp,
                       String standText, String liveText,
                       Bilder.Sichtfenster fenster, Runnable beiKlick, View.OnClickListener onMenu) {
        LinearLayout karte = new LinearLayout(context);
        karte.setOrientation(LinearLayout.VERTICAL);
        karte.setClipChildren(false);
        karte.setClipToPadding(false);
        // Damit das Kachelmenue seine eigene Karte wiederfindet - beim
        // Loeschen wird sie ausgeblendet, bevor der Bestand sich aendert.
        karte.setTag(R.id.elfix_karte, Boolean.TRUE);
        karte.setContentDescription(titel + (unterzeile == null || unterzeile.isEmpty() ? "" : ", " + unterzeile));
        int rand = dp(context, 10);
        karte.setPadding(rand, rand, rand, dp(context, 12));
        applyFocus(karte,
            surfaceGradient(context, Theme.SURFACE, CARD_RADIUS, Theme.BORDER, 1),
            surfaceGradient(context, Theme.SURFACE_ELEVATED, CARD_RADIUS, Theme.PRIMARY, 2));

        int posterHoehe = Math.round(breiteDp * 1.42f);
        FrameLayout poster = MobileViews.poster(context, provider, titel, bildUrl, prozent,
            breiteDp, posterHoehe, 30, 6, fenster);
        karte.addView(poster, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(context, posterHoehe)));

        if (fahne != null && !fahne.isEmpty()) {
            TextView aufkleber = new TextView(context);
            aufkleber.setText(fahne);
            aufkleber.setTextColor(Color.WHITE);
            aufkleber.setTextSize(12);
            aufkleber.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            aufkleber.setPadding(dp(context, 8), dp(context, 3), dp(context, 8), dp(context, 3));
            aufkleber.setBackground(shape(context, Theme.PRIMARY, 8, Color.TRANSPARENT, 0));
            FrameLayout.LayoutParams fahnenPlatz = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            fahnenPlatz.gravity = Gravity.TOP | Gravity.START;
            fahnenPlatz.setMargins(dp(context, 6), dp(context, 6), 0, 0);
            poster.addView(aufkleber, fahnenPlatz);
        }

        TextView name = new TextView(context);
        name.setText(titel);
        name.setTextColor(Theme.TEXT_PRIMARY);
        name.setTextSize(19);
        name.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        // Drei Zeilen fuer den Titel.
        //
        // Eine Kachel ist schmal - auf dem Telefon hundertsiebenunddreissig dp -,
        // und Serientitel sind lang. Bei zwei Zeilen stand dort "Attack on Titan -
        // Movie Teil 3: Gebruell..." und "Suppose a Kid from the Last Dungeon B...".
        // Die dritte Zeile kostet nur dort Hoehe, wo der Titel sie braucht; kurze
        // Titel bleiben so hoch wie bisher.
        name.setMaxLines(3);
        name.setEllipsize(TextUtils.TruncateAt.END);
        name.setPadding(0, dp(context, 9), 0, 0);
        karte.addView(name);

        if (unterzeile != null && !unterzeile.isEmpty()) {
            TextView zeile = new TextView(context);
            zeile.setText(unterzeile);
            zeile.setTextColor(Theme.TEXT_SECONDARY);
            zeile.setTextSize(16);
            // Zwei Zeilen statt einer: Die Unterzeile einer Kachel.
            zeile.setMaxLines(2);
            zeile.setEllipsize(TextUtils.TruncateAt.END);
            zeile.setPadding(0, dp(context, 3), 0, 0);
            karte.addView(zeile);
        }

        // Angelegt wird sie immer, auch ohne Text - wie in MobileViews und aus
        // demselben Grund: der Sekundentakt der Runde schreibt hier die Stelle
        // hinein, und ein Takt, der Ansichten nachlegen muesste, waere ein
        // Takt, der die Kachel umbaut. Ohne Text nimmt sie keine Hoehe ein.
        //
        // Genau daran fehlte auf den Karten aus einer Runde die Zeit: dort
        // wartet der Eintrag auf die naechste Folge, `kachelStandtext` liefert
        // deshalb nichts, und die Zeile entstand gar nicht erst. Der Takt
        // schrieb danach in eine Ansicht, die es nicht gab.
        TextView stelle = new TextView(context);
        stelle.setTag(Mitschaustand.MARKE_STAND);
        stelle.setText(standText == null ? "" : standText);
        stelle.setTextColor(Theme.TEXT_DISABLED);
        stelle.setTextSize(13);
        stelle.setMaxLines(1);
        stelle.setEllipsize(TextUtils.TruncateAt.END);
        stelle.setPadding(0, dp(context, 3), 0, 0);
        stelle.setVisibility(standText == null || standText.isEmpty() ? View.GONE : View.VISIBLE);
        karte.addView(stelle);

        if (liveText != null) {
            TextView live = new TextView(context);
            live.setTag(Mitschaustand.MARKE_LIVE);
            live.setText(liveText);
            live.setTextColor(Theme.PRIMARY);
            live.setTextSize(13);
            live.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            live.setMaxLines(1);
            live.setEllipsize(TextUtils.TruncateAt.END);
            live.setPadding(0, dp(context, 3), 0, 0);
            live.setVisibility(liveText.isEmpty() ? View.GONE : View.VISIBLE);
            karte.addView(live);
        }

        karte.setOnClickListener(v -> beiKlick.run());
        if (onMenu != null) {
            karte.setOnLongClickListener(v -> {
                onMenu.onClick(karte);
                return true;
            });
        }
        karte.setLayoutParams(new LinearLayout.LayoutParams(
            dp(context, breiteDp + 20), ViewGroup.LayoutParams.WRAP_CONTENT));
        return karte;
    }

    /**
     * Eine Vorschlagskarte - wie die Kachel, aber mit dem Grund darunter.
     *
     * <p>Der Grund ist der Unterschied zwischen einem Vorschlag und einer
     * Behauptung: "Weil du Attack on Titan gesehen hast" sagt, woher er kommt.
     * Ausformuliert wird er im Empfehlungslauf, also im geteilten Kern - hier
     * steht er nur.
     */
    static View vorschlag(Context context, Provider provider, String titel, String grund,
                          String zusatz, String bildUrl, int breiteDp, Bilder.Sichtfenster fenster,
                          Runnable beiKlick, View.OnClickListener onMenu) {
        LinearLayout karte = new LinearLayout(context);
        karte.setOrientation(LinearLayout.VERTICAL);
        karte.setClipChildren(false);
        karte.setClipToPadding(false);
        int rand = dp(context, 10);
        karte.setContentDescription(titel + (grund == null || grund.isEmpty() ? "" : ", " + grund));
        karte.setPadding(rand, rand, rand, dp(context, 12));
        applyFocus(karte,
            surfaceGradient(context, Theme.SURFACE, CARD_RADIUS, Theme.BORDER, 1),
            surfaceGradient(context, Theme.SURFACE_ELEVATED, CARD_RADIUS, Theme.PRIMARY, 2));

        int posterHoehe = Math.round(breiteDp * 1.42f);
        karte.addView(MobileViews.poster(context, provider, titel, bildUrl, 0,
                breiteDp, posterHoehe, 30, 0, fenster),
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(context, posterHoehe)));

        TextView name = new TextView(context);
        name.setText(titel);
        name.setTextColor(Theme.TEXT_PRIMARY);
        name.setTextSize(19);
        name.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        // Drei Zeilen fuer den Titel.
        //
        // Eine Kachel ist schmal - auf dem Telefon hundertsiebenunddreissig dp -,
        // und Serientitel sind lang. Bei zwei Zeilen stand dort "Attack on Titan -
        // Movie Teil 3: Gebruell..." und "Suppose a Kid from the Last Dungeon B...".
        // Die dritte Zeile kostet nur dort Hoehe, wo der Titel sie braucht; kurze
        // Titel bleiben so hoch wie bisher.
        name.setMaxLines(3);
        name.setEllipsize(TextUtils.TruncateAt.END);
        name.setPadding(0, dp(context, 9), 0, 0);
        karte.addView(name);

        if (grund != null && !grund.isEmpty()) {
            TextView satz = new TextView(context);
            satz.setText(grund);
            satz.setTextColor(Theme.PRIMARY);
            satz.setTextSize(13);
            satz.setMaxLines(2);
            satz.setEllipsize(TextUtils.TruncateAt.END);
            satz.setLineSpacing(0, 1.05f);
            satz.setPadding(0, dp(context, 4), 0, 0);
            karte.addView(satz);
        }

        if (zusatz != null && !zusatz.isEmpty()) {
            TextView zeile = new TextView(context);
            zeile.setText(zusatz);
            zeile.setTextColor(Theme.TEXT_DISABLED);
            zeile.setTextSize(13);
            // Zwei Zeilen statt einer: Der Grund unter einem Vorschlag.
            zeile.setMaxLines(2);
            zeile.setEllipsize(TextUtils.TruncateAt.END);
            zeile.setPadding(0, dp(context, 3), 0, 0);
            karte.addView(zeile);
        }

        karte.setOnClickListener(v -> beiKlick.run());
        if (onMenu != null) {
            karte.setOnLongClickListener(v -> {
                onMenu.onClick(karte);
                return true;
            });
        }
        karte.setLayoutParams(new LinearLayout.LayoutParams(
            dp(context, breiteDp + 20), ViewGroup.LayoutParams.WRAP_CONTENT));
        return karte;
    }

    /**
     * Die letzte Karte einer Reihe: der Weg zur ganzen Liste.
     *
     * <p>Sie steht am Ende und nicht nur als Knopf ueber der Reihe, weil das
     * Steuerkreuz am Ende der Reihe ankommt und dort weiterwollen wird. Ein
     * Knopf, den man nur durch Zurueckfahren erreicht, wird nicht gedrueckt.
     */
    static View mehrKarte(Context context, String label, int breiteDp, Runnable beiKlick) {
        LinearLayout karte = new LinearLayout(context);
        karte.setOrientation(LinearLayout.VERTICAL);
        karte.setGravity(Gravity.CENTER);
        int rand = dp(context, 8);
        karte.setPadding(rand, rand, rand, dp(context, 12));
        applyFocus(karte,
            surfaceGradient(context, Theme.SURFACE, CARD_RADIUS, Theme.BORDER, 1),
            surfaceGradient(context, Theme.PRIMARY_MUTED, CARD_RADIUS, Theme.PRIMARY, 2));

        TextView pfeil = new TextView(context);
        pfeil.setText("›");
        pfeil.setTextColor(Theme.PRIMARY);
        pfeil.setTextSize(44);
        pfeil.setGravity(Gravity.CENTER);
        karte.addView(pfeil);

        TextView text = new TextView(context);
        text.setText(label);
        text.setTextColor(Theme.TEXT_PRIMARY);
        text.setTextSize(15);
        text.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        text.setGravity(Gravity.CENTER);
        text.setMaxLines(2);
        karte.addView(text);

        karte.setOnClickListener(v -> beiKlick.run());
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            dp(context, breiteDp + 16), dp(context, Math.round(breiteDp * 1.42f)));
        karte.setLayoutParams(params);
        return karte;
    }

    /**
     * Ein Satz mit einem Knopf daneben - fuer "ohne Netz", "geht gerade nicht",
     * "Stand von gestern".
     *
     * <p>Vier Zustaende hat jede Vorschlagsreihe, und drei davon sind kein
     * Inhalt. Sie wortlos wegzulassen waere das Schlechteste: dann fehlt die
     * Reihe, und niemand weiss, warum.
     */
    static View hinweis(Context context, String text, String knopfText, Runnable beiKnopf) {
        LinearLayout kasten = new LinearLayout(context);
        kasten.setOrientation(LinearLayout.HORIZONTAL);
        kasten.setGravity(Gravity.CENTER_VERTICAL);
        kasten.setClipChildren(false);
        kasten.setClipToPadding(false);
        kasten.setPadding(dp(context, 20), dp(context, 16), dp(context, 20), dp(context, 16));
        kasten.setBackground(surfaceGradient(context, Theme.SURFACE, 18, Theme.BORDER, 1));

        TextView satz = new TextView(context);
        satz.setText(text);
        satz.setTextColor(Theme.TEXT_SECONDARY);
        satz.setTextSize(17);
        satz.setLineSpacing(dp(context, 2), 1.15f);
        kasten.addView(satz, new LinearLayout.LayoutParams(
            0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        if (knopfText != null && !knopfText.isEmpty() && beiKnopf != null) {
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            params.leftMargin = dp(context, 16);
            kasten.addView(pillButton(context, knopfText, beiKnopf), params);
        }
        return kasten;
    }

    /**
     * Was dasteht, solange eine Reihe geholt wird.
     *
     * <p>Graue Kaesten in der Form der spaeteren Kacheln und nicht das Wort
     * "laedt": die Seite behaelt so ihre Hoehe, und was danach kommt, springt
     * nicht unter dem Fokus weg.
     */
    static View reihenSkelett(Context context, int breiteDp, int anzahl) {
        LinearLayout leiste = new LinearLayout(context);
        leiste.setOrientation(LinearLayout.HORIZONTAL);
        int hoehe = Math.round(breiteDp * 1.42f);
        for (int i = 0; i < anzahl; i += 1) {
            View kasten = new View(context);
            kasten.setBackground(surfaceGradient(context, Theme.SURFACE_ELEVATED, 16, Theme.BORDER, 1));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                dp(context, breiteDp), dp(context, hoehe));
            if (i > 0) params.leftMargin = dp(context, ITEM_GAP);
            leiste.addView(kasten, params);
        }
        return leiste;
    }

    /** Der Kasten fuer "hier ist noch nichts" - mit Zeichen, Ueberschrift und Erklaerung. */
    static View emptyState(Context context, int iconRes, String ueberschrift, String text) {
        LinearLayout kasten = new LinearLayout(context);
        kasten.setOrientation(LinearLayout.VERTICAL);
        kasten.setGravity(Gravity.CENTER_HORIZONTAL);
        kasten.setPadding(dp(context, 32), dp(context, 38), dp(context, 32), dp(context, 38));
        kasten.setBackground(surfaceGradient(context, Theme.SURFACE, 20, Theme.BORDER, 1));

        ImageView zeichen = new ImageView(context);
        zeichen.setImageResource(iconRes);
        zeichen.setColorFilter(Theme.TEXT_DISABLED);
        kasten.addView(zeichen, new LinearLayout.LayoutParams(dp(context, 44), dp(context, 44)));

        TextView kopf = new TextView(context);
        kopf.setText(ueberschrift);
        kopf.setTextColor(Theme.TEXT_PRIMARY);
        kopf.setTextSize(22);
        kopf.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        kopf.setGravity(Gravity.CENTER);
        kopf.setPadding(0, dp(context, 14), 0, 0);
        kasten.addView(kopf);

        TextView satz = new TextView(context);
        satz.setText(text);
        satz.setTextColor(Theme.TEXT_SECONDARY);
        satz.setTextSize(17);
        satz.setGravity(Gravity.CENTER);
        satz.setLineSpacing(dp(context, 2), 1.15f);
        satz.setPadding(0, dp(context, 8), 0, 0);
        kasten.addView(satz);
        return kasten;
    }

    /**
     * Der Titelhintergrund.
     *
     * <p>Bild ganz hinten, darueber ein Verlauf, damit die Schrift lesbar
     * bleibt, und erst darauf der Text - derselbe Aufbau wie am Rechner und
     * auf dem Telefon. Der Unterschied ist die Bedienung: die beiden Knoepfe
     * sind Fokusziele, und wer sie beruehrt, haelt den Wechsel an (siehe
     * {@code beiFokus}).
     *
     * @param beiFokus wird mit {@code true} gerufen, sobald ein Bedienelement
     *                 des Titelhintergrunds den Fokus hat, und mit
     *                 {@code false}, wenn er ihn wieder verliert
     */
    static View hero(Context context, String augenbraue, String titel, String unterzeile,
                     String bildUrl, int prozent, String aufruf, Runnable beiAufruf,
                     String zweitText, Runnable beiZweit, View[] knoepfeAus,
                     Umschalter beiFokus) {
        FrameLayout kasten = new FrameLayout(context);
        kasten.setClipChildren(false);
        kasten.setClipToPadding(false);
        kasten.setOutlineProvider(new android.view.ViewOutlineProvider() {
            @Override
            public void getOutline(View ansicht, android.graphics.Outline umriss) {
                umriss.setRoundRect(0, 0, ansicht.getWidth(), ansicht.getHeight(), dp(context, 28));
            }
        });
        kasten.setClipToOutline(true);
        kasten.setBackground(surfaceGradient(context, Theme.SURFACE_ELEVATED, 28, Theme.BORDER, 1));

        ImageView bild = new ImageView(context);
        bild.setScaleType(ImageView.ScaleType.CENTER_CROP);
        kasten.addView(bild, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // Breiter als hoch angefordert: auf dem Fernseher ist das Titelbild ein
        // Hintergrund und kein Poster.
        Bilder.laden(bild, bildUrl, 640, 360, null);
        MobileViews.heroBildBeleben(bild);

        View schleier = new View(context);
        // Zwei Verlaeufe uebereinander: einer von links, damit der Text auf
        // jedem Bild steht, und einer von unten, damit die Knoepfe es tun.
        GradientDrawable quer = new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
            new int[]{Color.argb(248, 7, 10, 18), Color.argb(205, 7, 10, 18),
                Color.argb(62, 7, 10, 18), Color.argb(8, 7, 10, 18)});
        schleier.setBackground(quer);
        kasten.addView(schleier, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // Die untere Lesefläche trennt Titel und Aktionen vom Motiv. Sie ist
        // statisch und billig: kein Blur, keine Offscreen-Layer, kein Takt.
        View untenSchleier = new View(context);
        untenSchleier.setBackground(new GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP,
            new int[] { Color.argb(238, 7, 10, 18), Color.argb(0, 7, 10, 18) }));
        kasten.addView(untenSchleier, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        boolean kompakt = context.getResources().getConfiguration().screenHeightDp <= 600;
        LinearLayout text = new LinearLayout(context);
        text.setTag(MobileViews.HERO_TEXTE);
        text.setOrientation(LinearLayout.VERTICAL);
        text.setClipChildren(false);
        text.setClipToPadding(false);
        text.setPadding(dp(context, kompakt ? 28 : 40), dp(context, kompakt ? 20 : 34),
            dp(context, kompakt ? 28 : 40), dp(context, kompakt ? 20 : 30));
        TextView augenbrauenZeile = eyebrow(context, augenbraue);
        augenbrauenZeile.setTag(MobileViews.HERO_AUGENBRAUE);
        text.addView(augenbrauenZeile);

        TextView ueberschrift = new TextView(context);
        ueberschrift.setTag(MobileViews.HERO_TITEL);
        ueberschrift.setText(titel);
        ueberschrift.setTextColor(Theme.TEXT_PRIMARY);
        ueberschrift.setTextSize(kompakt ? 34 : 44);
        ueberschrift.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD));
        ueberschrift.setMaxLines(2);
        ueberschrift.setEllipsize(TextUtils.TruncateAt.END);
        ueberschrift.setPadding(0, dp(context, 6), 0, 0);
        text.addView(ueberschrift);

        // Wie auf dem Telefon: beide Zeilen und der Balken entstehen immer,
        // damit ein Wechsel sie nur umschreiben muss. Auf dem Fernseher haengt
        // daran mehr als die Ruhe - jeder Neuaufbau nimmt den beiden Knoepfen
        // ihren Platz und damit dem Steuerkreuz den Fokus.
        TextView zeile = new TextView(context);
        zeile.setTag(MobileViews.HERO_UNTERZEILE);
        zeile.setTextColor(Theme.TEXT_SECONDARY);
        zeile.setTextSize(kompakt ? 16 : 18);
        zeile.setLineSpacing(dp(context, 2), 1.1f);
        // Zwei Zeilen statt einer: Die Unterzeile des Titelhintergrunds.
        zeile.setMaxLines(2);
        zeile.setEllipsize(TextUtils.TruncateAt.END);
        zeile.setPadding(0, dp(context, 8), 0, 0);
        text.addView(zeile);

        LinearLayout.LayoutParams balkenRand = new LinearLayout.LayoutParams(
            dp(context, 380), ViewGroup.LayoutParams.WRAP_CONTENT);
        balkenRand.topMargin = dp(context, kompakt ? 10 : 16);
        View balken = MobileViews.fortschrittsBalken(context, prozent, true);
        balken.setTag(MobileViews.HERO_BALKEN);
        text.addView(balken, balkenRand);

        LinearLayout knoepfe = new LinearLayout(context);
        knoepfe.setOrientation(LinearLayout.HORIZONTAL);
        knoepfe.setClipChildren(false);
        knoepfe.setClipToPadding(false);
        LinearLayout.LayoutParams knopfRand = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        knopfRand.topMargin = dp(context, kompakt ? 14 : 22);

        View haupt = heroKnopf(context, aufruf, true, beiAufruf, beiFokus);
        haupt.setTag("tv:hero:0");
        knoepfe.addView(haupt);
        View zweit = heroKnopf(context, zweitText == null ? "" : zweitText, false, beiZweit,
            beiFokus);
        zweit.setTag("tv:hero:1");
        LinearLayout.LayoutParams zweitParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        zweitParams.leftMargin = dp(context, 14);
        knoepfe.addView(zweit, zweitParams);
        text.addView(knoepfe, knopfRand);

        int textWidth = Math.min(dp(context, kompakt ? 700 : 760),
            Math.round(context.getResources().getDisplayMetrics().widthPixels * (kompakt ? 0.78f : 0.72f)));
        FrameLayout.LayoutParams textParams = new FrameLayout.LayoutParams(
            textWidth, ViewGroup.LayoutParams.WRAP_CONTENT);
        textParams.gravity = Gravity.BOTTOM;
        kasten.addView(text, textParams);
        heroTeileSetzen(kasten, haupt, zweit, augenbraue, titel, unterzeile, prozent,
            aufruf, beiAufruf, zweitText, beiZweit, knoepfeAus);
        return kasten;
    }

    /**
     * Denselben Kasten auf einen anderen Titel umschreiben - die TV-Fassung von
     * {@link MobileViews#heroAktualisieren}.
     *
     * <p>Die beiden Knoepfe werden ueber die Marken gefunden, die die Activity
     * ihnen gibt ({@code tv:hero:0} und {@code tv:hero:1}). Sie bleiben damit
     * dieselben Ansichten - und genau das ist der Punkt: der Fokus des
     * Steuerkreuzes haengt an der Ansicht, nicht an ihrer Stelle.
     */
    static boolean heroAktualisieren(View kasten, String augenbraue, String titel,
                                     String unterzeile, String bildUrl, int prozent,
                                     String aufruf, Runnable beiAufruf,
                                     String zweitText, Runnable beiZweit, View[] knoepfeAus) {
        if (!(kasten instanceof ViewGroup)) return false;
        ViewGroup gruppe = (ViewGroup) kasten;
        View erstes = gruppe.getChildCount() > 0 ? gruppe.getChildAt(0) : null;
        if (!(erstes instanceof ImageView)) return false;
        View haupt = kasten.findViewWithTag("tv:hero:0");
        View zweit = kasten.findViewWithTag("tv:hero:1");
        if (haupt == null || zweit == null) return false;
        final ImageView bild = (ImageView) erstes;
        // Derselbe Wechsel wie auf dem Telefon - er steht dort, weil beide
        // Kasten denselben Aufbau und dieselben Marken haben.
        MobileViews.heroWechsel(kasten, bild, MobileViews.heroAnderer(kasten, titel),
            bildUrl, 640, 360,
            () -> heroTeileSetzen(kasten, haupt, zweit, augenbraue, titel, unterzeile, prozent,
                aufruf, beiAufruf, zweitText, beiZweit, knoepfeAus));
        return true;
    }

    private static void heroTeileSetzen(View kasten, View haupt, View zweit, String augenbraue,
                                        String titel, String unterzeile, int prozent,
                                        String aufruf, Runnable beiAufruf,
                                        String zweitText, Runnable beiZweit, View[] knoepfeAus) {
        MobileViews.heroSchriftSetzen(kasten, augenbraue, titel, unterzeile, prozent);
        if (haupt instanceof TextView) {
            boolean hauptDa = aufruf != null && !aufruf.isEmpty() && beiAufruf != null;
            ((TextView) haupt).setText(aufruf == null ? "" : aufruf);
            haupt.setOnClickListener(hauptDa ? v -> beiAufruf.run() : null);
            haupt.setEnabled(hauptDa);
            haupt.setVisibility(hauptDa ? View.VISIBLE : View.GONE);
        }
        boolean zweiterDa = zweitText != null && !zweitText.isEmpty() && beiZweit != null;
        if (zweit instanceof TextView) {
            ((TextView) zweit).setText(zweiterDa ? zweitText : "");
            zweit.setOnClickListener(zweiterDa ? v -> beiZweit.run() : null);
            zweit.setEnabled(zweiterDa);
            zweit.setVisibility(zweiterDa ? View.VISIBLE : View.GONE);
        }
        if (knoepfeAus != null && knoepfeAus.length > 0) knoepfeAus[0] = haupt;
        // Ein ausgeblendeter zweiter Knopf ist kein Fokusziel und darf deshalb
        // auch keine Marke bekommen - sonst suchte die Fokuswiederherstellung
        // etwas, das man nicht erreichen kann.
        if (knoepfeAus != null && knoepfeAus.length > 1) knoepfeAus[1] = zweiterDa ? zweit : null;
    }

    /** Ein Knopf im Titelhintergrund: gross genug, dass er aus zwei Metern zu lesen ist. */
    private static View heroKnopf(Context context, String label, boolean haupt, Runnable beiKlick,
                                  Umschalter beiFokus) {
        TextView knopf = new TextView(context);
        knopf.setText(label);
        knopf.setTextColor(Color.WHITE);
        knopf.setTextSize(18);
        knopf.setLetterSpacing(0.01f);
        knopf.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        knopf.setGravity(Gravity.CENTER);
        knopf.setMaxLines(1);
        knopf.setMinimumHeight(dp(context, 56));
        knopf.setPadding(dp(context, 30), dp(context, 15), dp(context, 30), dp(context, 15));
        applyFocus(knopf,
            surfaceGradient(context, haupt ? Theme.PRIMARY_DEEP : Theme.SURFACE_ELEVATED, 16,
                haupt ? Theme.PRIMARY : Theme.BORDER, haupt ? 2 : 1),
            surfaceGradient(context, Theme.PRIMARY, 16, Color.WHITE, 2));
        if (beiKlick != null) knopf.setOnClickListener(v -> beiKlick.run());
        else knopf.setEnabled(false);
        if (beiFokus != null) {
            // Nicht ueberschreiben, was applyFocus gesetzt hat - beides wird
            // gebraucht: der Fokusrahmen und die angehaltene Uhr.
            View.OnFocusChangeListener vorher = knopf.getOnFocusChangeListener();
            knopf.setOnFocusChangeListener((v, hat) -> {
                if (vorher != null) vorher.onFocusChange(v, hat);
                beiFokus.setze(hat);
            });
        }
        return knopf;
    }

    /**
     * Die Punkte unter dem Titelhintergrund.
     *
     * <p>Auf dem Telefon sind sie Tippflaechen, hier sind sie Fokusziele: mit
     * links und rechts wandert man durch die zuletzt angefangenen Titel. Das
     * ist der Ersatz fuer das Wischen, und es ist zugleich der Grund, warum
     * der selbsttaetige Wechsel anhaelt, sobald einer von ihnen den Fokus hat -
     * ein Bild, das unter dem Finger weiterspringt, ist nicht zu bedienen.
     */
    static View heroPunkte(Context context, int anzahl, int aktiv, MobileViews.IntVerbraucher beiWahl,
                           Umschalter beiFokus) {
        LinearLayout reihe = new LinearLayout(context);
        reihe.setOrientation(LinearLayout.HORIZONTAL);
        reihe.setGravity(Gravity.CENTER_VERTICAL);
        reihe.setClipChildren(false);
        reihe.setClipToPadding(false);
        for (int i = 0; i < anzahl; i += 1) {
            int stelle = i;
            boolean gewaehlt = i == aktiv;
            FrameLayout flaeche = new FrameLayout(context);
            flaeche.setPadding(dp(context, 6), dp(context, 8), dp(context, 6), dp(context, 8));
            applyFocus(flaeche,
                shape(context, Color.TRANSPARENT, 10, Color.TRANSPARENT, 0),
                shape(context, Theme.PRIMARY_MUTED, 10, Theme.PRIMARY, 2));
            View punkt = new View(context);
            punkt.setBackground(shape(context, gewaehlt ? Theme.PRIMARY : Theme.BORDER, 5,
                Color.TRANSPARENT, 0));
            FrameLayout.LayoutParams punktParams = new FrameLayout.LayoutParams(
                dp(context, gewaehlt ? 26 : 10), dp(context, 10));
            punktParams.gravity = Gravity.CENTER;
            flaeche.addView(punkt, punktParams);
            flaeche.setOnClickListener(v -> beiWahl.nimm(stelle));
            flaeche.setContentDescription("Titel " + (i + 1) + " von " + anzahl);
            if (beiFokus != null) {
                View.OnFocusChangeListener vorher = flaeche.getOnFocusChangeListener();
                flaeche.setOnFocusChangeListener((v, hat) -> {
                    if (vorher != null) vorher.onFocusChange(v, hat);
                    beiFokus.setze(hat);
                    // Der Fokus auf einem Punkt *ist* die Auswahl: sonst
                    // muesste man auf jedem Punkt noch einmal OK druecken, um
                    // zu sehen, was dahintersteckt.
                    if (hat) beiWahl.nimm(stelle);
                });
            }
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            if (i > 0) params.leftMargin = dp(context, 4);
            reihe.addView(flaeche, params);
        }
        return reihe;
    }

    /** Ein Ja/Nein, das jemand entgegennimmt - fuer den Fokus des Titelhintergrunds. */
    interface Umschalter {
        void setze(boolean wert);
    }
}
