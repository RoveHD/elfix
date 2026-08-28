package local.elflix.android;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
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
            boolean gedrueckt = action == MotionEvent.ACTION_DOWN;
            if (!gedrueckt && action != MotionEvent.ACTION_UP
                && action != MotionEvent.ACTION_CANCEL) {
                return false;
            }
            v.setBackground(gedrueckt ? pressed : idle);
            // Hinunter kurz und beschleunigend, herauf mit Feder - siehe
            // Bewegung.druck. Der Ueberschwinger ist der ganze Unterschied
            // zwischen "die Flaeche wird kleiner" und "die Flaeche gibt nach".
            //
            // 0.97 statt der frueheren 0.985: gefordert war spuerbares
            // Feedback, und fuenfzehn Tausendstel sind auf einem Telefonarm
            // Abstand nicht zu sehen. Tiefer geht es nicht: eine ganze Karte,
            // die um mehr als drei Prozent einsinkt, zieht ihre Nachbarn
            // optisch mit.
            Bewegung.druck(v, gedrueckt, 0.97f);
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
        // Zwei Zeilen statt einer: Untertitel einer Seite.
        view.setMaxLines(2);
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
        // Zwei Zeilen statt einer: Ueberschrift eines Abschnitts.
        label.setMaxLines(2);
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
        // Zwei Zeilen statt einer: Name des Anbieters.
        name.setMaxLines(2);
        name.setEllipsize(TextUtils.TruncateAt.END);
        text.addView(name);
        TextView desc = new TextView(context);
        desc.setText(tagline);
        desc.setTextColor(Theme.TEXT_SECONDARY);
        desc.setTextSize(12);
        // Zwei Zeilen statt einer: Was der Anbieter anbietet.
        desc.setMaxLines(2);
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
     * Der Bildkasten einer Karte.
     *
     * <p>Am Rechner traegt jede Karte das Titelbild des Eintrags. Auf dem
     * Telefon standen hier zwei Buchstaben - nicht als Gestaltung, sondern
     * weil das Bild nie geholt wurde. Jetzt liegt es darueber, sobald es da
     * ist; bis dahin und ohne Bild bleibt der gestaltete Platzhalter stehen.
     *
     * <p>Die Reihenfolge im Kasten ist Absicht: erst die Buchstaben, dann das
     * Bild, dann der Fortschrittsbalken. So verdeckt das Bild den Platzhalter,
     * und der Balken liegt trotzdem obenauf.
     *
     * @param bildUrl das Titelbild des Eintrags, leer erlaubt
     * @param prozent Fortschritt der laufenden Folge, 0 blendet den Balken aus
     */
    static FrameLayout poster(Context context, Provider provider, String title, String bildUrl,
                              int prozent, int breiteDp, int hoeheDp, float schriftSp, int balkenDp) {
        return poster(context, provider, title, bildUrl, prozent, breiteDp, hoeheDp,
            schriftSp, balkenDp, null);
    }

    /**
     * Derselbe Bildkasten, aber mit Sichtfenster.
     *
     * <p>Fuer lange Raster: das Bild wird erst geholt, wenn seine Karte in die
     * Naehe des Bildschirms kommt, und wieder freigegeben, wenn sie weit weg
     * ist. Kurze Reihen brauchen das nicht und uebergeben {@code null}.
     */
    static FrameLayout poster(Context context, Provider provider, String title, String bildUrl,
                              int prozent, int breiteDp, int hoeheDp, float schriftSp, int balkenDp,
                              Bilder.Sichtfenster fenster) {
        FrameLayout poster = new FrameLayout(context);
        int tint = provider == null ? Theme.PRIMARY_DEEP : Theme.providerTint(provider.id);
        GradientDrawable posterBg = new GradientDrawable();
        posterBg.setCornerRadius(dp(context, 10));
        posterBg.setColors(new int[]{blend(tint, Color.WHITE, 0.10f), blend(tint, Color.BLACK, 0.55f)});
        posterBg.setOrientation(GradientDrawable.Orientation.TL_BR);
        poster.setBackground(posterBg);
        // Ohne den Zuschnitt stuenden die Ecken des Bildes ueber den runden
        // Ecken des Kastens - genau der Rand, an dem eine aufgeklebte Kachel
        // von einer gestalteten zu unterscheiden ist.
        poster.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View ansicht, Outline umriss) {
                umriss.setRoundRect(0, 0, ansicht.getWidth(), ansicht.getHeight(), dp(context, 10));
            }
        });
        poster.setClipToOutline(true);

        TextView posterText = new TextView(context);
        posterText.setText(initials(title));
        posterText.setTextColor(Color.argb(230, 255, 255, 255));
        posterText.setTextSize(schriftSp);
        posterText.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        posterText.setGravity(Gravity.CENTER);
        poster.addView(posterText, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        ImageView bild = new ImageView(context);
        bild.setScaleType(ImageView.ScaleType.CENTER_CROP);
        poster.addView(bild, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (fenster == null) {
            Bilder.laden(bild, bildUrl, breiteDp, hoeheDp, () -> posterText.setVisibility(View.GONE));
        } else {
            fenster.merken(bild, bildUrl, breiteDp, hoeheDp,
                () -> posterText.setVisibility(View.GONE),
                () -> posterText.setVisibility(View.VISIBLE));
        }

        // Der Fortschrittsbalken sitzt im Bild, nicht darunter: unter dem Titel
        // waere er eine weitere Zeile, und die Liste soll auf einem Telefon so
        // viele Eintraege wie moeglich zeigen.
        //
        // <p>Angelegt wird er immer, wo ueberhaupt einer vorgesehen ist
        // ({@code balkenDp > 0}) - auch bei null Prozent. Vorher entstand er
        // nur ab einem Prozent, und das hatte zwei sichtbare Folgen: eine
        // gerade begonnene Folge hatte keinen Balken, und wenn der Fortschritt
        // im Takt nachzog, musste eine Ansicht *nachgelegt* werden. Ein Takt,
        // der Ansichten nachlegt, baut die Karte um - genau das, was hier nicht
        // passieren soll. Jetzt steht die Spur da und nur ihre Breite wandert.
        if (balkenDp > 0) {
            View spur = new View(context);
            GradientDrawable spurBg = new GradientDrawable();
            spurBg.setColor(Color.argb(150, 0, 0, 0));
            spur.setBackground(spurBg);
            FrameLayout.LayoutParams spurParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(context, balkenDp));
            spurParams.gravity = Gravity.BOTTOM;
            poster.addView(spur, spurParams);

            View balken = new View(context);
            GradientDrawable balkenBg = new GradientDrawable();
            balkenBg.setColor(Theme.PRIMARY);
            balken.setBackground(balkenBg);
            // Er liegt in voller Breite da und wird von links her
            // zusammengeschoben. Warum nicht ueber die Breite: eine Breite
            // laesst sich nur ueber die Layoutmasse aendern, und jede
            // Aenderung daran misst die Karte neu - waehrend einer laufenden
            // Folge, alle paar Sekunden, in jeder sichtbaren Kachel. Eine
            // Skalierung ab der linken Kante sieht genauso aus und kostet die
            // Grafikeinheit nichts.
            balken.setPivotX(0f);
            balken.setScaleX(0f);
            // Die Marke braucht der Sekundentakt: bei einer Kachel aus einer
            // Watchparty zeigt der Balken den Stand des Fuehrenden, und der
            // laeuft weiter, ohne dass die Seite neu gebaut wird.
            balken.setTag(Mitschaustand.MARKE_BALKEN);
            FrameLayout.LayoutParams balkenParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(context, balkenDp));
            balkenParams.gravity = Gravity.BOTTOM;
            poster.addView(balken, balkenParams);
            // Die Breite steht erst fest, wenn der Kasten gemessen ist.
            poster.post(() -> balkenBreiteSetzen(poster, balken, prozent));
        }
        return poster;
    }

    /**
     * Die Breite des Fortschrittsbalkens im Bild setzen.
     *
     * <p>Ohne Animation, und mit Absicht: waehrend einer Folge kommt alle paar
     * Sekunden ein neuer Stand. Ein Balken, der jedes Mal hinueberwandert,
     * waere die Unruhe, die hier abgestellt werden soll.
     *
     * <p>Bei null Prozent bleibt er null breit - die Spur dahinter steht
     * trotzdem, und die Karte behaelt ihre Masse.
     */
    static void balkenBreiteSetzen(View poster, View balken, int prozent) {
        if (poster == null || balken == null) return;
        int wert = Math.min(100, Math.max(0, prozent));
        int breite = poster.getWidth();
        if (breite <= 0) {
            poster.post(() -> balkenBreiteSetzen(poster, balken, prozent));
            return;
        }
        balken.setPivotX(0f);
        float ziel = wert <= 0 ? 0f
            : Math.max(wert / 100f, dp(poster.getContext(), 3) / (float) breite);
        // Ein halbes Prozent Unterschied ist ein halber Pixel - dafuer lohnt
        // keine Bewegung, und ohne diese Schwelle liefe waehrend einer Folge
        // dauernd eine.
        if (Math.abs(balken.getScaleX() - ziel) < 0.005f) return;
        long dauer = Bewegung.dauer(poster.getContext(), Bewegung.LANG);
        if (dauer <= 0) {
            balken.animate().cancel();
            balken.setScaleX(ziel);
            return;
        }
        balken.animate().scaleX(ziel).setDuration(dauer)
            .setInterpolator(Bewegung.kurve()).start();
    }

    /**
     * Continue-watching card: artwork, title, episode line, provider, and a play cue.
     * Until the artwork is there -- and for entries that have none -- the designed placeholder
     * with the title's initials stays in its place rather than leaving an empty rectangle.
     */
    /**
     * Eine Zeile in Weiterschauen, Watchlist, Mediathek oder Verlauf.
     *
     * @param bildUrl    das Titelbild des Eintrags - ohne eines bleibt der Platzhalter
     * @param prozent    Fortschritt der laufenden Folge, 0 blendet den Balken aus
     * @param hinweis    was unter dem Titel steht - "Staffel 3 Folge 8", "Abgeschlossen", ...
     * @param aufruf     was der Knopf unten sagt: "Weiter ansehen", "Ansehen", "Nochmal ansehen"
     * @param onMenu     das Dreipunktmenue - bekommt den Knopf als Anker, damit das
     *                   Menue daneben aufgeht und nicht am Bildschirmrand klebt;
     *                   {@code null} laesst es weg
     */
    static View favoriteCard(Context context, Provider provider, String title, String episodeLine,
                             String providerName, String bildUrl, int prozent, String aufruf,
                             Runnable onOpen, View.OnClickListener onMenu) {
        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.HORIZONTAL);
        card.setPadding(dp(context, 10), dp(context, 10), dp(context, 12), dp(context, 10));
        // Damit das Kachelmenue seine eigene Zeile wiederfindet - beim
        // Loeschen wird sie ausgeblendet, bevor der Bestand sich aendert.
        card.setTag(R.id.elfix_karte, Boolean.TRUE);
        addPressFeedback(card,
            shape(context, Theme.SURFACE_ELEVATED, CARD_RADIUS, Theme.BORDER, 1),
            shape(context, Theme.SURFACE_PRESSED, CARD_RADIUS, Theme.PRIMARY, 1));

        FrameLayout poster = poster(context, provider, title, bildUrl, prozent, 66, 88, 22, 4);

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
            // Zwei Zeilen statt einer: Die Folgenzeile einer Listenzeile.
            episode.setMaxLines(2);
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
        cue.setText(aufruf == null || aufruf.isEmpty() ? "Weiter ansehen" : aufruf);
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
        if (onMenu != null) {
            // Ein sichtbarer Knopf statt eines langen Drucks: was man nicht
            // sieht, findet auf einem Telefon niemand. Der lange Druck bleibt
            // zusaetzlich, weil er fuer Geuebte schneller ist.
            ImageView menue = new ImageView(context);
            menue.setImageResource(R.drawable.ic_more_vert);
            menue.setColorFilter(Theme.TEXT_SECONDARY);
            menue.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
            menue.setPadding(dp(context, 10), dp(context, 10), dp(context, 6), dp(context, 10));
            menue.setContentDescription("Weitere Aktionen für " + title);
            menue.setOnClickListener(onMenu);
            LinearLayout.LayoutParams menueParams = new LinearLayout.LayoutParams(
                dp(context, TOUCH_TARGET), dp(context, TOUCH_TARGET));
            menueParams.gravity = Gravity.CENTER_VERTICAL;
            card.addView(menue, menueParams);

            card.setOnLongClickListener(v -> {
                // Der lange Druck liegt auf der Karte, das Menue soll aber am
                // Dreipunktknopf haengen - sonst geht es an einer Stelle auf,
                // an der man gar nicht getippt hat.
                onMenu.onClick(menue);
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
                // Ein Symbol ohne Beschriftung hat nichts ausser sich selbst,
                // woran man den Druck sieht - deshalb hier tiefer als bei
                // einer Karte.
                Bewegung.druck(v, true, 0.86f);
            } else if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
                v.setBackground(shape(context, Color.TRANSPARENT, 12, Color.TRANSPARENT, 0));
                Bewegung.druck(v, false, 0.86f);
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

    /* ------------------------------------------------- Die neue Startseite */

    /**
     * Der Titelhintergrund der Startseite.
     *
     * <p>Am Rechner ist er ein breites Banner; auf dem Telefon steht dasselbe
     * hochkant, weil eine liegende 16:9-Flaeche auf einem schmalen Bildschirm
     * entweder zwei Zentimeter hoch waere oder das Bild bis zur
     * Unkenntlichkeit beschneidet. Der Aufbau ist derselbe: Bild ganz hinten,
     * darueber ein Verlauf, damit die Schrift lesbar bleibt, und erst darauf
     * der Text.
     *
     * <p>Der Verlauf ist keine Verzierung. Ohne ihn steht weisse Schrift auf
     * einem beliebigen Poster, und ob sie lesbar ist, entscheidet der Zufall.
     *
     * @param prozent   Fortschritt der laufenden Folge; 0 laesst den Balken weg
     * @param aufruf    was auf dem grossen Knopf steht
     * @param zweitText Beschriftung des zweiten Knopfs, {@code null} laesst ihn weg
     */
    /**
     * Die Marken der Teile, die sich im Titelhintergrund aendern koennen.
     *
     * <p>Sie sind der Grund, warum der Wechsel alle fuenfzehn Sekunden keine
     * neue Karte mehr baut: {@link #heroAktualisieren} findet die Teile daran
     * wieder und schreibt sie um. Vorher wurde der ganze Kasten
     * weggeworfen - samt dem {@link android.widget.ImageView}, dessen Bild
     * damit jedes Mal von vorn anfing.
     */
    static final String HERO_BILD = "hero:bild";
    /**
     * Der ganze Textblock - Augenbraue, Titel, Unterzeile, Balken, Knoepfe.
     *
     * <p>Er traegt eine eigene Marke, weil er sich beim Titelwechsel als
     * Ganzes bewegt: die Knoepfe stehen darin und gehen deshalb mit, ohne dass
     * sie einzeln angefasst werden muessten.
     */
    static final String HERO_TEXTE = "hero:texte";
    static final String HERO_AUGENBRAUE = "hero:augenbraue";
    static final String HERO_TITEL = "hero:titel";
    static final String HERO_UNTERZEILE = "hero:unterzeile";
    static final String HERO_BALKEN = "hero:balken";
    static final String HERO_HAUPTKNOPF = "hero:haupt";
    static final String HERO_ZWEITKNOPF = "hero:zweit";

    static View hero(Context context, String augenbraue, String titel, String unterzeile,
                     String bildUrl, int prozent, String aufruf, Runnable beiAufruf,
                     String zweitText, Runnable beiZweit) {
        FrameLayout kasten = new FrameLayout(context);
        kasten.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View ansicht, Outline umriss) {
                umriss.setRoundRect(0, 0, ansicht.getWidth(), ansicht.getHeight(), dp(context, 18));
            }
        });
        kasten.setClipToOutline(true);
        kasten.setBackground(shape(context, Theme.SURFACE_ELEVATED, 18, Theme.BORDER, 1));

        // Das erste Kind ist immer das Bild - {@link #heroBild} verlaesst sich
        // darauf. Eine Marke geht hier nicht: {@link Bilder} benutzt den Tag
        // des ImageView selbst, um Antworten ihren Auftraegen zuzuordnen.
        ImageView bild = new ImageView(context);
        bild.setScaleType(ImageView.ScaleType.CENTER_CROP);
        kasten.addView(bild, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        Bilder.laden(bild, bildUrl, 360, 260, null);
        heroBildBeleben(bild);

        View schleier = new View(context);
        GradientDrawable verlauf = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{Color.argb(40, 7, 10, 18), Color.argb(190, 7, 10, 18), Color.argb(245, 7, 10, 18)});
        schleier.setBackground(verlauf);
        kasten.addView(schleier, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout text = new LinearLayout(context);
        text.setTag(HERO_TEXTE);
        text.setOrientation(LinearLayout.VERTICAL);
        text.setPadding(dp(context, 16), dp(context, 18), dp(context, 16), dp(context, 16));
        TextView augenbrauenZeile = eyebrow(context, augenbraue);
        augenbrauenZeile.setTag(HERO_AUGENBRAUE);
        text.addView(augenbrauenZeile);

        TextView ueberschrift = new TextView(context);
        ueberschrift.setTag(HERO_TITEL);
        ueberschrift.setText(titel);
        ueberschrift.setTextColor(Theme.TEXT_PRIMARY);
        ueberschrift.setTextSize(24);
        ueberschrift.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD));
        ueberschrift.setMaxLines(2);
        ueberschrift.setEllipsize(TextUtils.TruncateAt.END);
        ueberschrift.setPadding(0, dp(context, 4), 0, 0);
        text.addView(ueberschrift);

        // Beide Zeilen entstehen immer, auch wenn sie leer bleiben. Das ist der
        // Unterschied zwischen "kann nachgezogen werden" und "muss neu gebaut
        // werden": ein Titel ohne Unterzeile und einer mit haetten sonst
        // verschiedene Kasten, und der Wechsel zwischen ihnen waere wieder ein
        // Neuaufbau.
        TextView zeile = new TextView(context);
        zeile.setTag(HERO_UNTERZEILE);
        zeile.setTextColor(Theme.TEXT_SECONDARY);
        zeile.setTextSize(13);
        // Zwei Zeilen statt einer: Die Unterzeile des Titelhintergrunds.
        zeile.setMaxLines(2);
        zeile.setEllipsize(TextUtils.TruncateAt.END);
        zeile.setPadding(0, dp(context, 5), 0, 0);
        text.addView(zeile);

        LinearLayout.LayoutParams balkenRand = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        balkenRand.topMargin = dp(context, 12);
        View balken = fortschrittsBalken(context, prozent, true);
        balken.setTag(HERO_BALKEN);
        text.addView(balken, balkenRand);

        LinearLayout knoepfe = new LinearLayout(context);
        knoepfe.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams knopfRand = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        knopfRand.topMargin = dp(context, 14);
        TextView haupt = primaryButton(context, aufruf, beiAufruf);
        haupt.setTag(HERO_HAUPTKNOPF);
        LinearLayout.LayoutParams hauptParams =
            new LinearLayout.LayoutParams(0, dp(context, TOUCH_TARGET), 1);
        knoepfe.addView(haupt, hauptParams);
        TextView zweit = secondaryButton(context, zweitText == null ? "" : zweitText, beiZweit);
        zweit.setTag(HERO_ZWEITKNOPF);
        LinearLayout.LayoutParams zweitParams =
            new LinearLayout.LayoutParams(0, dp(context, TOUCH_TARGET), 1);
        zweitParams.leftMargin = dp(context, 10);
        knoepfe.addView(zweit, zweitParams);
        text.addView(knoepfe, knopfRand);

        FrameLayout.LayoutParams textParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        textParams.gravity = Gravity.BOTTOM;
        kasten.addView(text, textParams);
        heroTeileSetzen(kasten, augenbraue, titel, unterzeile, prozent,
            aufruf, beiAufruf, zweitText, beiZweit);
        return kasten;
    }

    /**
     * Denselben Kasten auf einen anderen Titel umschreiben.
     *
     * <p><b>Warum das der Kern der ganzen Sache ist.</b> Der Titelhintergrund
     * wechselt alle fuenfzehn Sekunden durch die zuletzt geschauten Titel. Bis
     * hierher wurde dafuer der ganze Kasten weggeworfen und neu gebaut - und
     * mit ihm der {@link ImageView}. Das Bild fing damit jedes Mal bei nichts
     * an: leerer Kasten, dann Bild. Auf einem Telefon im Mobilfunk sah man
     * genau das, alle fuenfzehn Sekunden, ohne dass sich der Titel je geaendert
     * haette.
     *
     * <p>Jetzt bleiben Kasten, Bild und Schrift stehen; es wird nur
     * ueberschrieben, was anders ist. Das Bild wechselt ueber
     * {@link Bilder#laden}, und das laesst ein Bild, dessen Adresse gleich
     * bleibt, unangetastet.
     *
     * @return ob es geklappt hat. Ein {@code false} heisst: dieser Kasten ist
     *         keiner von hier, und der Aufrufer soll neu bauen.
     */
    static boolean heroAktualisieren(View kasten, String augenbraue, String titel,
                                     String unterzeile, String bildUrl, int prozent,
                                     String aufruf, Runnable beiAufruf,
                                     String zweitText, Runnable beiZweit) {
        ImageView bild = heroBild(kasten);
        if (bild == null || kasten.findViewWithTag(HERO_TITEL) == null) return false;
        heroWechsel(kasten, bild, heroAnderer(kasten, titel),
            () -> Bilder.laden(bild, bildUrl, 360, 260, null),
            () -> heroTeileSetzen(kasten, augenbraue, titel, unterzeile, prozent,
                aufruf, beiAufruf, zweitText, beiZweit));
        return true;
    }

    /**
     * Steht dort schon dieser Titel?
     *
     * <p>Die Frage entscheidet ueber Bewegung oder Ruhe. Der Titelhintergrund
     * wird auch dann neu beschrieben, wenn sich nur der Fortschritt um eine
     * Sekunde bewegt hat - und dabei darf nichts wegzoomen. Nur der Wechsel
     * auf einen <em>anderen</em> Titel ist ein Wechsel.
     */
    static boolean heroAnderer(View kasten, String titel) {
        View zeile = kasten.findViewWithTag(HERO_TITEL);
        if (!(zeile instanceof TextView)) return false;
        String jetzt = ((TextView) zeile).getText().toString();
        return !jetzt.equals(titel == null ? "" : titel);
    }

    /**
     * Der cineastische Wechsel des Titelhintergrunds.
     *
     * <p>Gefordert war ausdruecklich: nicht einfach den Hintergrund
     * austauschen. Also vier Dinge nacheinander und nebeneinander - das alte
     * Bild dunkelt ab und zoomt weg, das neue faengt groesser an und geht auf
     * seine Groesse zurueck, der Textblock geht nach oben hinaus und kommt von
     * unten nach, und der langsame Zoom faengt danach wieder von vorn an.
     *
     * <p>Ohne Wechsel passiert nichts davon: dann wird nur ueberschrieben, und
     * zwar sofort. Das ist der haeufige Fall - der Fortschritt zieht im Takt
     * nach, und ein Titelhintergrund, der dabei jedes Mal wegzoomt, waere die
     * Unruhe, gegen die dieser ganze Kasten gebaut wurde.
     *
     * <p>Paketweit sichtbar, weil {@link TvViews} denselben Wechsel fuehrt.
     */
    static void heroWechsel(View kasten, final ImageView bild, boolean anders,
                            final Runnable bildSetzen, final Runnable schriftSetzen) {
        if (!anders || !Bewegung.weiteWege(kasten.getContext())) {
            bildSetzen.run();
            schriftSetzen.run();
            return;
        }
        heroBildAnhalten(bild);
        Bewegung.inhaltTausch(kasten.findViewWithTag(HERO_TEXTE), schriftSetzen);
        Bewegung.bildTausch(bild, bildSetzen, () -> heroBildBeleben(bild));
    }

    /**
     * Der langsame Zoom auf dem Titelbild - Ken Burns.
     *
     * <p>Ein stehendes Bild hinter einer Schrift sieht aus wie ein Bildschirm-
     * foto; dasselbe Bild, das ueber zwoelf Sekunden um sechs Prozent waechst
     * und wieder zurueckgeht, sieht aus wie eine Kamera. Der Weg ist zu klein,
     * um als Bewegung gelesen zu werden - das ist genau der Punkt.
     *
     * <p>Der Lauf haengt am Bild und wird angehalten, sobald es aus dem Fenster
     * genommen wird. Ohne das liefe er weiter und hielte die alte Seite fest -
     * ein endloser Lauf auf einer weggeworfenen Ansicht ist ein Leck.
     */
    static void heroBildBeleben(final ImageView bild) {
        if (bild == null) return;
        heroBildAnhalten(bild);
        android.animation.ValueAnimator lauf = Bewegung.kenBurns(bild);
        if (lauf == null) return;
        bild.setTag(R.id.elfix_kenburns, lauf);
        bild.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener() {
            @Override
            public void onViewAttachedToWindow(View wer) {
            }

            @Override
            public void onViewDetachedFromWindow(View wer) {
                heroBildAnhalten(bild);
            }
        });
    }

    /** Den langsamen Zoom anhalten - vor einem Wechsel und beim Aufraeumen. */
    static void heroBildAnhalten(ImageView bild) {
        if (bild == null) return;
        Object alt = bild.getTag(R.id.elfix_kenburns);
        if (alt instanceof android.animation.ValueAnimator) {
            ((android.animation.ValueAnimator) alt).cancel();
        }
        bild.setTag(R.id.elfix_kenburns, null);
    }

    /** Das Bild eines Titelhintergrunds - immer sein erstes Kind, siehe {@link #hero}. */
    private static ImageView heroBild(View kasten) {
        if (!(kasten instanceof ViewGroup)) return null;
        ViewGroup gruppe = (ViewGroup) kasten;
        if (gruppe.getChildCount() == 0) return null;
        View erstes = gruppe.getChildAt(0);
        return erstes instanceof ImageView ? (ImageView) erstes : null;
    }

    /**
     * Augenbraue, Titel, Unterzeile und Balken setzen.
     *
     * <p>Paketweit sichtbar, weil {@link TvViews} denselben Aufbau hat und
     * dieselben Marken benutzt - nur die Knoepfe sind dort andere.
     */
    static void heroSchriftSetzen(View kasten, String augenbraue, String titel,
                                  String unterzeile, int prozent) {
        textSetzen(kasten.findViewWithTag(HERO_AUGENBRAUE), augenbraue);
        textSetzen(kasten.findViewWithTag(HERO_TITEL), titel);
        textSetzen(kasten.findViewWithTag(HERO_UNTERZEILE), unterzeile);

        View balken = kasten.findViewWithTag(HERO_BALKEN);
        if (balken != null) {
            balken.setVisibility(prozent > 0 ? View.VISIBLE : View.GONE);
            if (prozent > 0) balkenSetzen(balken, prozent);
        }
    }

    /** Die Schrift und die Knoepfe - aus {@link #hero} und {@link #heroAktualisieren}. */
    private static void heroTeileSetzen(View kasten, String augenbraue, String titel,
                                        String unterzeile, int prozent,
                                        String aufruf, Runnable beiAufruf,
                                        String zweitText, Runnable beiZweit) {
        heroSchriftSetzen(kasten, augenbraue, titel, unterzeile, prozent);

        View haupt = kasten.findViewWithTag(HERO_HAUPTKNOPF);
        if (haupt instanceof TextView) {
            ((TextView) haupt).setText(aufruf == null ? "" : aufruf);
            haupt.setOnClickListener(beiAufruf == null ? null : view -> beiAufruf.run());
            haupt.setVisibility(aufruf == null || aufruf.isEmpty() ? View.GONE : View.VISIBLE);
        }
        View zweit = kasten.findViewWithTag(HERO_ZWEITKNOPF);
        if (zweit instanceof TextView) {
            boolean da = zweitText != null && !zweitText.isEmpty() && beiZweit != null;
            ((TextView) zweit).setText(da ? zweitText : "");
            zweit.setOnClickListener(da ? view -> beiZweit.run() : null);
            zweit.setVisibility(da ? View.VISIBLE : View.GONE);
        }
    }

    /** Text setzen und die Zeile ausblenden, wenn keiner da ist. */
    private static void textSetzen(View ansicht, String text) {
        if (!(ansicht instanceof TextView)) return;
        String wert = text == null ? "" : text;
        // Nur schreiben, wenn es anders ist: {@code setText} mit demselben Text
        // stoesst trotzdem eine neue Messung an.
        if (!wert.contentEquals(((TextView) ansicht).getText())) {
            ((TextView) ansicht).setText(wert);
        }
        ansicht.setVisibility(wert.isEmpty() ? View.GONE : View.VISIBLE);
    }

    /**
     * Die Breite im Fortschrittsbalken nachziehen - samt der Zahl daneben.
     *
     * <p>Ohne Animation, und das mit Absicht: waehrend einer Folge kommt alle
     * paar Sekunden ein neuer Stand, und ein Balken, der jedes Mal
     * hinueberwandert, ist genau die Unruhe, um die es hier geht.
     */
    private static void balkenSetzen(View reihe, int prozent) {
        if (!(reihe instanceof ViewGroup)) return;
        ViewGroup gruppe = (ViewGroup) reihe;
        int wert = Math.min(100, Math.max(0, prozent));
        View erstes = gruppe.getChildCount() > 0 ? gruppe.getChildAt(0) : null;
        if (erstes instanceof FrameLayout) {
            FrameLayout spur = (FrameLayout) erstes;
            View balken = spur.getChildCount() > 0 ? spur.getChildAt(0) : null;
            if (balken != null) {
                Runnable breite = () -> {
                    ViewGroup.LayoutParams masse = balken.getLayoutParams();
                    masse.width = Math.max(dp(spur.getContext(), 4), spur.getWidth() * wert / 100);
                    balken.setLayoutParams(masse);
                };
                if (spur.getWidth() > 0) breite.run();
                else spur.post(breite);
            }
        }
        for (int i = 1; i < gruppe.getChildCount(); i += 1) {
            View kind = gruppe.getChildAt(i);
            if (kind instanceof TextView) ((TextView) kind).setText(wert + " %");
        }
    }

    /**
     * Die Punkte unter dem Titelhintergrund.
     *
     * <p>Sie sind nicht nur Anzeige, sondern auch Bedienung: sie sagen, wie
     * viele Titel dahinterstehen, und man kommt mit einem Tipp zu jedem. Die
     * Tippflaeche ist deutlich groesser als der sichtbare Punkt - ein Punkt von
     * sieben Pixeln ist mit dem Daumen nicht zu treffen.
     */
    static View heroPunkte(Context context, int anzahl, int aktiv, IntVerbraucher beiWahl) {
        LinearLayout reihe = new LinearLayout(context);
        reihe.setOrientation(LinearLayout.HORIZONTAL);
        reihe.setGravity(Gravity.CENTER);
        for (int i = 0; i < anzahl; i += 1) {
            int stelle = i;
            boolean gewaehlt = i == aktiv;
            FrameLayout flaeche = new FrameLayout(context);
            View punkt = new View(context);
            punkt.setBackground(shape(context, gewaehlt ? Theme.PRIMARY : Theme.BORDER, 4, Color.TRANSPARENT, 0));
            FrameLayout.LayoutParams punktParams = new FrameLayout.LayoutParams(
                dp(context, gewaehlt ? 18 : 7), dp(context, 7));
            punktParams.gravity = Gravity.CENTER;
            flaeche.addView(punkt, punktParams);
            flaeche.setOnClickListener(v -> beiWahl.nimm(stelle));
            flaeche.setContentDescription("Titel " + (i + 1) + " von " + anzahl);
            reihe.addView(flaeche, new LinearLayout.LayoutParams(
                dp(context, 30), dp(context, 26)));
        }
        return reihe;
    }

    /** Was ein Punkt meldet, wenn man ihn antippt. */
    interface IntVerbraucher {
        void nimm(int stelle);
    }

    /** Der Fortschrittsbalken samt Prozentzahl, wie ihn der Titelhintergrund traegt. */
    static View fortschrittsBalken(Context context, int prozent, boolean mitZahl) {
        LinearLayout reihe = new LinearLayout(context);
        reihe.setOrientation(LinearLayout.HORIZONTAL);
        reihe.setGravity(Gravity.CENTER_VERTICAL);

        FrameLayout spur = new FrameLayout(context);
        spur.setBackground(shape(context, Color.argb(120, 0, 0, 0), 3, Color.TRANSPARENT, 0));
        View balken = new View(context);
        balken.setBackground(shape(context, Theme.PRIMARY, 3, Color.TRANSPARENT, 0));
        spur.addView(balken, new FrameLayout.LayoutParams(0, dp(context, 6)));
        // Die Breite steht erst fest, wenn die Spur gemessen ist.
        spur.post(() -> {
            FrameLayout.LayoutParams neu = (FrameLayout.LayoutParams) balken.getLayoutParams();
            neu.width = Math.max(dp(context, 4), spur.getWidth() * Math.min(100, Math.max(0, prozent)) / 100);
            balken.setLayoutParams(neu);
        });
        LinearLayout.LayoutParams spurParams = new LinearLayout.LayoutParams(0, dp(context, 6), 1);
        reihe.addView(spur, spurParams);

        if (mitZahl) {
            TextView zahl = new TextView(context);
            zahl.setText(Math.min(100, Math.max(0, prozent)) + " %");
            zahl.setTextColor(Theme.TEXT_SECONDARY);
            zahl.setTextSize(12);
            zahl.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            LinearLayout.LayoutParams zahlParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            zahlParams.leftMargin = dp(context, 8);
            reihe.addView(zahl, zahlParams);
        }
        return reihe;
    }

    /**
     * Eine waagerechte Reihe.
     *
     * <p>Am Rechner steht dort eine Kachelreihe, die man mit dem Rad schiebt.
     * Auf dem Telefon ist es dieselbe Reihe unter dem Daumen - mit einem
     * Zusatz: die Reihe laeuft ueber den Seitenrand hinaus. Ohne das haetten
     * die Karten links und rechts einen Rand, den keine andere Reihe hat, und
     * die letzte Karte klebte am Rand, statt anzudeuten, dass es weitergeht.
     */
    static HorizontalScrollView reihe(Context context, java.util.List<View> karten, int kartenBreiteDp) {
        HorizontalScrollView scroll = new HorizontalScrollView(context);
        scroll.setHorizontalScrollBarEnabled(false);
        scroll.setClipToPadding(false);
        scroll.setPadding(dp(context, SCREEN_PADDING), 0, dp(context, SCREEN_PADDING), 0);
        // Ohne das schneidet die Reihe jede Kachel ab, die beim Druck oder im
        // Auftritt ueber ihre Kante hinauswaechst.
        scroll.setClipChildren(false);
        LinearLayout leiste = new LinearLayout(context);
        leiste.setOrientation(LinearLayout.HORIZONTAL);
        leiste.setClipChildren(false);
        leiste.setClipToPadding(false);
        for (int i = 0; i < karten.size(); i += 1) {
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                kartenBreiteDp > 0 ? dp(context, kartenBreiteDp) : ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
            if (i > 0) params.leftMargin = dp(context, ITEM_GAP);
            leiste.addView(karten.get(i), params);
        }
        scroll.addView(leiste, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        staffelnWennFrei(scroll, leiste, 0L);
        return scroll;
    }

    /**
     * Die Kacheln einer Reihe nacheinander auftreten lassen - wenn sie duerfen.
     *
     * <p>Zwei Bedingungen, und beide werden <em>jetzt</em> geprueft, beim
     * Bauen: ob die Seite ueberhaupt Auftritte bekommt (siehe
     * {@link Bewegung#auftritteFrei}) und, spaeter im Lauf, welche Kacheln im
     * Bild stehen. Die zweite Frage laesst sich erst nach dem Vermessen
     * beantworten, deshalb der Umweg ueber {@code post}. Was rechts ausserhalb
     * steht, bekommt keinen Auftritt: bis der Daumen dort ankommt, waere er
     * laengst vorbei, und siebzehn Kacheln gegen eine Wand zu animieren kostet
     * Bilder, die niemand sieht.
     */
    static void staffelnWennFrei(final HorizontalScrollView scroll, final LinearLayout leiste,
                                 final long ab) {
        if (!Bewegung.auftritteFrei()) return;
        scroll.post(() -> Bewegung.staffelnWaagerecht(
            leiste, scroll.getScrollX() + scroll.getWidth(), ab));
    }

    /**
     * Eine Kachel in einer waagerechten Reihe.
     *
     * <p>Hochformat, weil Titelbilder Poster sind, und mit dem Fortschritt im
     * Bild statt darunter: eine Reihe soll auf einem Telefon so viele Kacheln
     * wie moeglich zeigen, und jede zusaetzliche Textzeile kostet eine.
     *
     * @param fahne   ein kleiner Aufkleber oben links ("Neue Folge"), leer erlaubt
     * @param onMenu  das Dreipunktmenue; {@code null} laesst es weg
     */
    static View kachel(Context context, Provider provider, String titel, String unterzeile,
                       String bildUrl, int prozent, String fahne, int breiteDp,
                       Runnable beiKlick, View.OnClickListener onMenu) {
        return kachel(context, provider, titel, unterzeile, bildUrl, prozent, fahne, breiteDp,
            "", "", beiKlick, onMenu);
    }

    /**
     * Dieselbe Kachel, dazu die beiden Zeilen, die eine Runde ausmachen.
     *
     * <p>Am Rechner traegt jede Weiterschauen-Karte die Stelle im Klartext
     * ("12:04 / 24:10"), und eine Karte aus einer Watchparty zusaetzlich die
     * Zeile, wer gerade schaut. Beide Zeilen tragen eine Marke, damit der
     * Sekundentakt sie in Ort nachziehen kann: die ganze Seite dafuer neu zu
     * bauen liesse sie beim Blaettern springen und naehme dem Fernseher den
     * Fokus.
     *
     * @param standText die Stelle, leer laesst die Zeile weg
     * @param liveText  wer gerade schaut; leer laesst die Zeile weg, legt sie
     *                  aber an - sie kommt und geht im Takt
     */
    static View kachel(Context context, Provider provider, String titel, String unterzeile,
                       String bildUrl, int prozent, String fahne, int breiteDp,
                       String standText, String liveText,
                       Runnable beiKlick, View.OnClickListener onMenu) {
        LinearLayout karte = new LinearLayout(context);
        karte.setOrientation(LinearLayout.VERTICAL);
        // Damit das Kachelmenue seine eigene Karte wiederfindet - beim
        // Loeschen wird sie ausgeblendet, bevor der Bestand sich aendert.
        karte.setTag(R.id.elfix_karte, Boolean.TRUE);

        int hoehe = Math.round(breiteDp * 1.45f);
        FrameLayout bild = poster(context, provider, titel, bildUrl, prozent,
            breiteDp, hoehe, 26, 4);

        if (fahne != null && !fahne.isEmpty()) {
            TextView aufkleber = new TextView(context);
            aufkleber.setText(fahne);
            aufkleber.setTextColor(Color.WHITE);
            aufkleber.setTextSize(10);
            aufkleber.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            aufkleber.setPadding(dp(context, 7), dp(context, 3), dp(context, 7), dp(context, 3));
            aufkleber.setBackground(shape(context, Theme.PRIMARY_DEEP, 6, Color.TRANSPARENT, 0));
            FrameLayout.LayoutParams fahnenParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            fahnenParams.gravity = Gravity.TOP | Gravity.START;
            fahnenParams.setMargins(dp(context, 6), dp(context, 6), 0, 0);
            bild.addView(aufkleber, fahnenParams);
        }
        karte.addView(bild, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(context, hoehe)));

        TextView name = new TextView(context);
        name.setText(titel);
        name.setTextColor(Theme.TEXT_PRIMARY);
        name.setTextSize(13);
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
        name.setPadding(0, dp(context, 7), 0, 0);
        karte.addView(name);

        if (unterzeile != null && !unterzeile.isEmpty()) {
            TextView zeile = new TextView(context);
            zeile.setText(unterzeile);
            zeile.setTextColor(Theme.TEXT_SECONDARY);
            zeile.setTextSize(11);
            // Zwei Zeilen statt einer: Die Unterzeile einer Kachel.
            zeile.setMaxLines(2);
            zeile.setEllipsize(TextUtils.TruncateAt.END);
            zeile.setPadding(0, dp(context, 2), 0, 0);
            karte.addView(zeile);
        }

        // Angelegt wird sie immer, auch ohne Text - genau wie die Zeile
        // darunter und aus demselben Grund: der Fortschritt zieht im Takt
        // nach, und ein Takt, der Ansichten nachlegen muesste, waere ein Takt,
        // der die Seite umbaut. Ohne Text nimmt sie keine Hoehe ein.
        TextView stelle = new TextView(context);
        stelle.setTag(Mitschaustand.MARKE_STAND);
        stelle.setText(standText == null ? "" : standText);
        stelle.setTextColor(Theme.TEXT_DISABLED);
        stelle.setTextSize(10);
        stelle.setMaxLines(1);
        stelle.setEllipsize(TextUtils.TruncateAt.END);
        stelle.setPadding(0, dp(context, 2), 0, 0);
        stelle.setVisibility(standText == null || standText.isEmpty() ? View.GONE : View.VISIBLE);
        karte.addView(stelle);

        // Angelegt wird sie auch leer: sie kommt und geht mit den Meldungen
        // der Runde, und der Takt haengt keine Ansichten nach - er schreibt
        // nur Text. Ohne Text nimmt sie keine Hoehe ein.
        if (liveText != null) {
            TextView live = new TextView(context);
            live.setTag(Mitschaustand.MARKE_LIVE);
            live.setText(liveText);
            live.setTextColor(Theme.PRIMARY);
            live.setTextSize(10);
            live.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            live.setMaxLines(1);
            live.setEllipsize(TextUtils.TruncateAt.END);
            live.setPadding(0, dp(context, 2), 0, 0);
            live.setVisibility(liveText.isEmpty() ? View.GONE : View.VISIBLE);
            karte.addView(live);
        }

        karte.setOnClickListener(v -> beiKlick.run());
        if (onMenu != null) {
            // Auf einer schmalen Kachel ist kein Platz fuer einen sichtbaren
            // Dreipunktknopf, ohne dass er das Bild verdeckt. Hier ist der
            // lange Druck deshalb der Weg - die senkrechten Karten in "Meine
            // Liste" tragen den Knopf weiterhin, und dort liegt die Arbeit mit
            // den Eintraegen ohnehin.
            karte.setOnLongClickListener(v -> {
                onMenu.onClick(karte);
                return true;
            });
        }
        return karte;
    }

    /**
     * Eine Vorschlagskarte.
     *
     * <p>Der Unterschied zur gewoehnlichen Kachel ist die Zeile mit dem Grund.
     * Sie ist der Punkt der ganzen Reihe: warum ausgerechnet dieser Titel? Die
     * Antwort hat die Empfehlungs-Engine bereits ausformuliert - hier wird sie
     * nur angezeigt. Reihen ohne Empfehlungslogik ("Neu bei deinen Anbietern")
     * tragen keinen Grund und bekommen deshalb auch keine Zeile.
     *
     * @param grund    der ausformulierte Satz, leer erlaubt
     * @param zusatz   Anbieter, oder das Erscheinungsdatum, wenn eines bekannt ist
     * @param fenster  Sichtfenster fuer lange Raster, {@code null} fuer kurze Reihen
     */
    static View vorschlag(Context context, Provider provider, String titel, String grund,
                          String zusatz, String bildUrl, int breiteDp,
                          Bilder.Sichtfenster fenster, Runnable beiKlick,
                          View.OnClickListener onMenu) {
        LinearLayout karte = new LinearLayout(context);
        karte.setOrientation(LinearLayout.VERTICAL);

        int hoehe = Math.round(breiteDp * 1.45f);
        FrameLayout bild = poster(context, provider, titel, bildUrl, 0, breiteDp, hoehe, 26, 0, fenster);
        karte.addView(bild, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(context, hoehe)));

        TextView name = new TextView(context);
        name.setText(titel);
        name.setTextColor(Theme.TEXT_PRIMARY);
        name.setTextSize(13);
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
        name.setPadding(0, dp(context, 7), 0, 0);
        karte.addView(name);

        if (grund != null && !grund.isEmpty()) {
            TextView satz = new TextView(context);
            satz.setText(grund);
            satz.setTextColor(Theme.PRIMARY);
            satz.setTextSize(11);
            satz.setMaxLines(2);
            satz.setEllipsize(TextUtils.TruncateAt.END);
            satz.setLineSpacing(0, 1.05f);
            satz.setPadding(0, dp(context, 3), 0, 0);
            karte.addView(satz);
        }

        if (zusatz != null && !zusatz.isEmpty()) {
            TextView zeile = new TextView(context);
            zeile.setText(zusatz);
            zeile.setTextColor(Theme.TEXT_DISABLED);
            zeile.setTextSize(11);
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
        return karte;
    }

    /**
     * Ein Platzhalter, solange eine Reihe noch geholt wird.
     *
     * <p>Graue Kaesten in der Form der spaeteren Kacheln, nicht das Wort
     * "Laedt". Der Unterschied ist nicht Geschmack: die Seite behaelt damit
     * ihre Hoehe, und was danach kommt, springt nicht.
     */
    static View reihenSkelett(Context context, int breiteDp, int anzahl) {
        HorizontalScrollView scroll = new HorizontalScrollView(context);
        scroll.setHorizontalScrollBarEnabled(false);
        scroll.setClipToPadding(false);
        scroll.setPadding(dp(context, SCREEN_PADDING), 0, dp(context, SCREEN_PADDING), 0);
        LinearLayout leiste = new LinearLayout(context);
        leiste.setOrientation(LinearLayout.HORIZONTAL);
        int hoehe = Math.round(breiteDp * 1.45f);
        for (int i = 0; i < anzahl; i += 1) {
            View kasten = new View(context);
            kasten.setBackground(shape(context, Theme.SURFACE_ELEVATED, 10, Theme.BORDER, 1));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                dp(context, breiteDp), dp(context, hoehe));
            if (i > 0) params.leftMargin = dp(context, ITEM_GAP);
            leiste.addView(kasten, params);
        }
        scroll.addView(leiste, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return scroll;
    }

    /**
     * Eine Zeile mit einem Hinweis und wahlweise einem Knopf.
     *
     * <p>Sie steht unter langen Listen und sagt, woran man ist: wird noch
     * geladen, ist Schluss, oder ist etwas schiefgegangen. Im letzten Fall
     * gehoert ein Knopf dazu - ein Fehler ohne Ausweg ist eine Sackgasse.
     */
    static View hinweis(Context context, String text, String knopfText, Runnable beiKnopf) {
        LinearLayout zeile = new LinearLayout(context);
        zeile.setOrientation(LinearLayout.VERTICAL);
        zeile.setGravity(Gravity.CENTER_HORIZONTAL);
        zeile.setPadding(dp(context, 12), dp(context, 16), dp(context, 12), dp(context, 16));

        TextView satz = new TextView(context);
        satz.setText(text);
        satz.setTextColor(Theme.TEXT_SECONDARY);
        satz.setTextSize(13);
        satz.setGravity(Gravity.CENTER);
        zeile.addView(satz);

        if (knopfText != null && beiKnopf != null) {
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, dp(context, TOUCH_TARGET));
            params.topMargin = dp(context, 10);
            zeile.addView(secondaryButton(context, knopfText, beiKnopf), params);
        }
        return zeile;
    }

    /**
     * Eine Zeile mit einem Schalter.
     *
     * <p>Fuer die sichtbaren Startseitenreihen. Bewusst kein {@code Switch} aus
     * dem Framework: die App baut ihre Oberflaeche von Hand und ohne Material,
     * und ein einzelnes Framework-Bedienelement traegt seine eigene Farbwelt
     * herein - auf einem dunklen Hintergrund faellt das sofort auf.
     */
    static View schalterZeile(Context context, String titel, String erklaerung,
                              boolean an, Runnable beiKlick) {
        return schalterZeile(context, titel, erklaerung, an, null, beiKlick);
    }

    /**
     * Derselbe Schalter, aber er weiss, wo er herkommt.
     *
     * <p>Die Einstellungsseite wird bei jedem Handgriff neu gebaut - der
     * Schalter, den man gerade umgelegt hat, ist also nicht derselbe, der eben
     * noch dastand, sondern ein neuer an derselben Stelle. Ohne diese Angabe
     * koennte er nur springen. Mit ihr faengt der Daumen dort an, wo der alte
     * aufgehoert hat, und laeuft mit einer Feder hinueber; die Bahn wechselt
     * dabei ihre Farbe.
     *
     * @param vorher der zuletzt gezeichnete Stand, {@code null} beim ersten Mal
     */
    static View schalterZeile(Context context, String titel, String erklaerung,
                              boolean an, Boolean vorher, Runnable beiKlick) {
        LinearLayout zeile = new LinearLayout(context);
        zeile.setOrientation(LinearLayout.HORIZONTAL);
        zeile.setGravity(Gravity.CENTER_VERTICAL);
        zeile.setPadding(dp(context, 14), dp(context, 12), dp(context, 14), dp(context, 12));
        addPressFeedback(zeile,
            shape(context, Theme.SURFACE_ELEVATED, CARD_RADIUS, Theme.BORDER, 1),
            shape(context, Theme.SURFACE_PRESSED, CARD_RADIUS, Theme.PRIMARY, 1));

        LinearLayout texte = new LinearLayout(context);
        texte.setOrientation(LinearLayout.VERTICAL);
        TextView name = new TextView(context);
        name.setText(titel);
        name.setTextColor(Theme.TEXT_PRIMARY);
        name.setTextSize(15);
        name.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        texte.addView(name);
        if (erklaerung != null && !erklaerung.isEmpty()) {
            TextView satz = new TextView(context);
            satz.setText(erklaerung);
            satz.setTextColor(Theme.TEXT_SECONDARY);
            satz.setTextSize(12);
            satz.setPadding(0, dp(context, 3), 0, 0);
            texte.addView(satz);
        }
        zeile.addView(texte, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        // Der Schalter selbst: eine Bahn und ein Knopf darin. Zwei Rechtecke,
        // die dieselbe Aussage tragen wie ein Haken, aber auf einen Blick zu
        // erkennen sind - auch ohne die Zeile daneben zu lesen.
        FrameLayout bahn = new FrameLayout(context);
        GradientDrawable bahnForm = shape(context, an ? Theme.PRIMARY : Theme.SURFACE_PRESSED, 11,
            an ? Theme.PRIMARY : Theme.BORDER, 1);
        bahn.setBackground(bahnForm);
        final View knopf = new View(context);
        knopf.setBackground(shape(context, an ? Color.WHITE : Theme.TEXT_DISABLED, 9,
            Color.TRANSPARENT, 0));
        FrameLayout.LayoutParams knopfParams = new FrameLayout.LayoutParams(
            dp(context, 18), dp(context, 18));
        knopfParams.gravity = Gravity.CENTER_VERTICAL | (an ? Gravity.END : Gravity.START);
        knopfParams.setMargins(dp(context, 2), 0, dp(context, 2), 0);
        bahn.addView(knopf, knopfParams);
        if (vorher != null && vorher.booleanValue() != an) {
            // Der Daumen steht schon an seinem Ziel - er faengt nur weiter
            // links oder rechts an und laeuft mit einer Feder hinueber. Der
            // Weg ist die Bahnbreite ohne den Daumen und die zwei Raender.
            final float weg = dp(context, 44 - 18 - 4);
            knopf.setTranslationX(an ? -weg : weg);
            long dauer = Bewegung.dauer(context, Bewegung.LANG);
            if (dauer <= 0) {
                knopf.setTranslationX(0f);
            } else {
                knopf.animate().translationX(0f)
                    .setDuration(dauer).setInterpolator(Bewegung.feder(0.6f)).start();
                Bewegung.farbwechsel(bahnForm,
                    an ? Theme.SURFACE_PRESSED : Theme.PRIMARY,
                    an ? Theme.PRIMARY : Theme.SURFACE_PRESSED,
                    Bewegung.MITTEL, context);
            }
        }
        LinearLayout.LayoutParams bahnParams = new LinearLayout.LayoutParams(
            dp(context, 44), dp(context, 22));
        bahnParams.leftMargin = dp(context, 12);
        zeile.addView(bahn, bahnParams);

        zeile.setOnClickListener(v -> beiKlick.run());
        return zeile;
    }

    /**
     * Eine grosse Zahl mit zwei Zeilen Beschriftung.
     *
     * <p>Der Baustein des Rueckblicks. Die Zahl steht gross, weil sie die
     * Aussage ist; die Zeile darunter sagt, wovon - und die dritte, wie sicher
     * sie ist. Genau darauf kommt es bei gemessener Zeit an: was nicht gemessen
     * wurde, darf nicht als Null dastehen.
     */
    static View kennzahl(Context context, String wert, String oben, String unten) {
        LinearLayout kasten = new LinearLayout(context);
        kasten.setOrientation(LinearLayout.VERTICAL);
        kasten.setBackground(shape(context, Theme.SURFACE_ELEVATED, CARD_RADIUS, Theme.BORDER, 1));
        kasten.setPadding(dp(context, 14), dp(context, 14), dp(context, 14), dp(context, 14));

        TextView zahl = new TextView(context);
        zahl.setText(wert);
        zahl.setTextColor(Theme.TEXT_PRIMARY);
        zahl.setTextSize(26);
        zahl.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD));
        kasten.addView(zahl);

        TextView label = new TextView(context);
        label.setText(oben);
        label.setTextColor(Theme.TEXT_SECONDARY);
        label.setTextSize(12);
        label.setPadding(0, dp(context, 4), 0, 0);
        kasten.addView(label);

        if (unten != null && !unten.isEmpty()) {
            TextView fuss = new TextView(context);
            fuss.setText(unten);
            fuss.setTextColor(Theme.TEXT_DISABLED);
            fuss.setTextSize(11);
            fuss.setPadding(0, dp(context, 2), 0, 0);
            kasten.addView(fuss);
        }
        return kasten;
    }

    /**
     * Ein waagerechter Balken mit Beschriftung.
     *
     * <p>Fuer die Ranglisten des Rueckblicks. Der Anteil steht als Breite da,
     * die Zahl daneben - ohne die Zahl waere der Balken eine Behauptung, ohne
     * den Balken die Zahl schwer zu vergleichen.
     */
    static View balken(Context context, String titel, String wert, float anteil) {
        LinearLayout zeile = new LinearLayout(context);
        zeile.setOrientation(LinearLayout.VERTICAL);
        zeile.setPadding(0, dp(context, 6), 0, dp(context, 6));

        LinearLayout kopf = new LinearLayout(context);
        kopf.setOrientation(LinearLayout.HORIZONTAL);
        TextView name = new TextView(context);
        name.setText(titel);
        name.setTextColor(Theme.TEXT_PRIMARY);
        name.setTextSize(13);
        // Zwei Zeilen statt einer: Der Titel eines Balkens in der Statistik.
        name.setMaxLines(2);
        name.setEllipsize(TextUtils.TruncateAt.END);
        kopf.addView(name, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        TextView zahl = new TextView(context);
        zahl.setText(wert);
        zahl.setTextColor(Theme.TEXT_SECONDARY);
        zahl.setTextSize(12);
        kopf.addView(zahl);
        zeile.addView(kopf);

        // Der Anteil kommt als Gewicht in einen waagerechten Kasten: eine feste
        // Breite in dp waere hier falsch, weil die Bahn ueber die ganze
        // Bildschirmbreite geht und die nicht bekannt ist.
        LinearLayout bahn = new LinearLayout(context);
        bahn.setOrientation(LinearLayout.HORIZONTAL);
        bahn.setBackground(shape(context, Theme.SURFACE_PRESSED, 4, Color.TRANSPARENT, 0));
        float sicher = Math.max(0f, Math.min(1f, anteil));
        View fuellung = new View(context);
        fuellung.setBackground(shape(context, Theme.PRIMARY, 4, Color.TRANSPARENT, 0));
        bahn.addView(fuellung, new LinearLayout.LayoutParams(0,
            ViewGroup.LayoutParams.MATCH_PARENT, Math.max(0.0001f, sicher)));
        View rest = new View(context);
        bahn.addView(rest, new LinearLayout.LayoutParams(0,
            ViewGroup.LayoutParams.MATCH_PARENT, Math.max(0.0001f, 1f - sicher)));

        LinearLayout.LayoutParams bahnParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(context, 8));
        bahnParams.topMargin = dp(context, 6);
        zeile.addView(bahn, bahnParams);
        return zeile;
    }

    /**
     * Ein Reiter in einer waagerechten Leiste - fuer die Wochentage des
     * Kalenders und die Zeitraeume des Rueckblicks.
     */
    static View reiter(Context context, String titel, String unterzeile, boolean aktiv,
                       Runnable beiKlick) {
        LinearLayout knopf = new LinearLayout(context);
        knopf.setOrientation(LinearLayout.VERTICAL);
        knopf.setGravity(Gravity.CENTER);
        knopf.setPadding(dp(context, 14), dp(context, 8), dp(context, 14), dp(context, 8));
        knopf.setBackground(shape(context, aktiv ? Theme.PRIMARY_DEEP : Theme.SURFACE_ELEVATED,
            10, aktiv ? Theme.PRIMARY : Theme.BORDER, 1));

        TextView name = new TextView(context);
        name.setText(titel);
        name.setTextColor(aktiv ? Color.WHITE : Theme.TEXT_PRIMARY);
        name.setTextSize(13);
        name.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        name.setGravity(Gravity.CENTER);
        knopf.addView(name);

        if (unterzeile != null && !unterzeile.isEmpty()) {
            TextView zusatz = new TextView(context);
            zusatz.setText(unterzeile);
            zusatz.setTextColor(aktiv ? Color.WHITE : Theme.TEXT_SECONDARY);
            zusatz.setTextSize(11);
            zusatz.setGravity(Gravity.CENTER);
            knopf.addView(zusatz);
        }
        // Ein Reiter ohne Druckreaktion ist ein Wort auf einem Rechteck. Der
        // Rahmen wechselt beim Druck nicht die Farbe - das taete er beim
        // aktiven und beim ruhenden verschieden -, es bleibt beim Nachgeben.
        knopf.setOnTouchListener((v, ereignis) -> {
            int was = ereignis.getActionMasked();
            if (was == MotionEvent.ACTION_DOWN) Bewegung.druck(v, true, 0.94f);
            else if (was == MotionEvent.ACTION_UP || was == MotionEvent.ACTION_CANCEL) {
                Bewegung.druck(v, false, 0.94f);
            }
            return false;
        });
        knopf.setOnClickListener(v -> beiKlick.run());
        return knopf;
    }

    /**
     * Eine waagerechte Leiste aus Reitern.
     *
     * <p>Wie {@link #reihe}, aber ohne feste Breite: ein Wochentag ist so breit
     * wie sein Name.
     */
    static HorizontalScrollView reiterLeiste(Context context, java.util.List<View> reiter) {
        return reihe(context, reiter, 0);
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
