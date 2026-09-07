package local.elflix.android;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.text.InputType;
import android.text.InputFilter;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.content.Context;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/** Der flache, kurzlebige Livechat neben dem nativen Player. */
final class SpielerChat {
    interface Sender { void senden(String key, String text, String raum, Kern.Antwort antwort); }

    private static final int MAX_ZEILEN = 100;
    private static final int KARTE = Color.parseColor("#EE111723");
    private final Activity activity;
    private final Sender sender;
    private final FrameLayout wurzel;
    private final LinearLayout zeilen;
    private final ScrollView scroll;
    private final EditText eingabe;
    private final TextView status;
    private final TextView zaehler;
    private final TextView schliessen;
    private final List<JSONObject> verlauf = new ArrayList<>();
    private String key = "";
    private String raum = "";
    private boolean offen;
    private int ungelesen;

    SpielerChat(Activity activity, Sender sender) {
        this.activity = activity;
        this.sender = sender;
        wurzel = new FrameLayout(activity);
        wurzel.setVisibility(View.GONE);
        // Das Overlay darf das Video nie abdunkeln; nur die linke Chatspalte ist deckend.
        wurzel.setBackgroundColor(Color.TRANSPARENT);
        wurzel.setFocusable(true);

        LinearLayout panel = new LinearLayout(activity);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(12), dp(10), dp(12), dp(10));
        panel.setBackground(flaeche(KARTE, 0, 0));
        FrameLayout.LayoutParams panelLage = new FrameLayout.LayoutParams(breite(), -1, Gravity.START);
        wurzel.addView(panel, panelLage);

        LinearLayout kopf = new LinearLayout(activity);
        kopf.setGravity(Gravity.CENTER_VERTICAL);
        TextView titel = text("Livechat", 16, Color.WHITE);
        titel.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        kopf.addView(titel, new LinearLayout.LayoutParams(0, -2, 1));
        status = text("Offline", 12, 0xB3FFFFFF);
        kopf.addView(status);
        schliessen = knopf("×", "Chat schließen", this::schliessen);
        kopf.addView(schliessen, new LinearLayout.LayoutParams(dp(44), dp(44)));
        panel.addView(kopf, new LinearLayout.LayoutParams(-1, -2));

        scroll = new ScrollView(activity);
        scroll.setFillViewport(true);
        zeilen = new LinearLayout(activity);
        zeilen.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(zeilen, new ScrollView.LayoutParams(-1, -2));
        panel.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));

        LinearLayout unten = new LinearLayout(activity);
        unten.setGravity(Gravity.CENTER_VERTICAL);
        eingabe = new EditText(activity);
        eingabe.setTextColor(Color.WHITE);
        eingabe.setTextSize(15);
        eingabe.setHintTextColor(0x88FFFFFF);
        eingabe.setHint("Nachricht schreiben");
        eingabe.setSingleLine(false);
        eingabe.setMaxLines(3);
        eingabe.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        eingabe.setFilters(new InputFilter[] { new InputFilter.LengthFilter(500) });
        eingabe.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_SEND);
        eingabe.setBackground(flaeche(0x1FFFFFFF, 10, 0x33FFFFFF));
        eingabe.setOnFocusChangeListener((ansicht, fokus) -> ansicht.setBackground(
            flaeche(fokus ? 0x33FFFFFF : 0x1FFFFFFF, 10, fokus ? Color.WHITE : 0x33FFFFFF)));
        eingabe.setPadding(dp(10), dp(6), dp(10), dp(6));
        eingabe.setOnEditorActionListener((v, action, event) -> {
            if (action == android.view.inputmethod.EditorInfo.IME_ACTION_SEND) { senden(); return true; }
            return false;
        });
        unten.addView(eingabe, new LinearLayout.LayoutParams(0, -2, 1));
        unten.addView(knopf("Senden", "Chatnachricht senden", this::senden),
            new LinearLayout.LayoutParams(-2, -2));
        panel.addView(unten, new LinearLayout.LayoutParams(-1, -2));

        zaehler = text("Chat", 13, Color.WHITE);
        zaehler.setGravity(Gravity.CENTER);
        zaehler.setPadding(dp(9), dp(7), dp(9), dp(7));
    }

    View ansicht() { return wurzel; }
    TextView ausloeser() { return zaehler; }
    boolean istOffen() { return offen; }

    void kontext(String neuerKey, String neuerRaum, boolean verbunden) {
        boolean anders = !gleich(key, neuerKey) || !gleich(raum, neuerRaum);
        key = sauber(neuerKey); raum = sauber(neuerRaum);
        status.setText(!raum.isEmpty() && verbunden ? "Verbunden" : "Offline");
        if (anders) {
            verlauf.clear(); ungelesen = 0; eingabe.setText(""); zeichnen(false);
        }
        zaehler.setVisibility(raum.isEmpty() ? View.GONE : View.VISIBLE);
        if (raum.isEmpty()) schliessen();
    }

    void empfangen(JSONObject zeile) {
        if (zeile == null || !raum.equals(zeile.optString("room", ""))) return;
        String text = sichererText(zeile.optString("text", zeile.optString("message", "")));
        if (text.isEmpty()) return;
        JSONObject sicher = new JSONObject();
        try {
            sicher.put("room", raum);
            sicher.put("text", text);
            sicher.put("name", sichererName(zeile.optString("name",
                zeile.optString("from", zeile.optString("deviceName", "Gast")))));
            sicher.put("timestamp", zeile.optLong("timestamp", zeile.optLong("at", System.currentTimeMillis())));
        } catch (Exception ignored) { return; }
        verlauf.add(sicher);
        while (verlauf.size() > MAX_ZEILEN) verlauf.remove(0);
        boolean unten = istNaheUnten();
        if (!offen) ungelesen++;
        zeichnen(offen && unten);
    }

    void oeffnen() {
        if (raum.isEmpty()) return;
        offen = true; ungelesen = 0; wurzel.setVisibility(View.VISIBLE); wurzel.bringToFront();
        zeichnen(true);
        wurzel.post(() -> schliessen.requestFocus());
    }

    void schliessen() {
        if (!offen && wurzel.getVisibility() != View.VISIBLE) return;
        offen = false;
        ((InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE))
            .hideSoftInputFromWindow(eingabe.getWindowToken(), 0);
        eingabe.clearFocus();
        wurzel.setVisibility(View.GONE);
        badgeZeichnen();
    }

    boolean zurueck() { if (!offen) return false; schliessen(); return true; }

    boolean hatEingabeFokus() { return offen && eingabe.hasFocus(); }

    private void senden() {
        String text = sichererText(eingabe.getText().toString());
        if (text.isEmpty() || key.isEmpty() || raum.isEmpty() || sender == null) return;
        // Erst nach positivem Relay-Ergebnis leeren: bei Offline/Fehler bleibt der Text da.
        sender.senden(key, text, raum, (wert, fehler) -> {
            if (fehler != null || !gesendet(wert)) {
                status.setText("Nicht gesendet" + (fehler == null ? " · Offline" : " · " + fehler));
                return;
            }
            eingabe.setText(""); status.setText("Verbunden");
        });
    }

    private void zeichnen(boolean nachUnten) {
        badgeZeichnen();
        // Der Verlauf ändert sich nur bei einer neuen Zeile oder einem Raumwechsel.
        // Statuswechsel bauen die Liste nicht neu und lassen die Leseposition stehen.
        zeilen.removeAllViews();
        for (JSONObject zeile : verlauf) {
            LinearLayout block = new LinearLayout(activity);
            block.setOrientation(LinearLayout.VERTICAL);
            block.setPadding(dp(8), dp(7), dp(8), dp(7));
            TextView meta = text(sichererName(zeile.optString("name", "Gast")) + " · "
                + zeit(zeile.optLong("timestamp", 0)), 12, 0xB3FFFFFF);
            TextView inhalt = text(zeile.optString("text", ""), 15, Color.WHITE);
            inhalt.setLineSpacing(dp(2), 1);
            block.addView(meta); block.addView(inhalt);
            LinearLayout.LayoutParams lage = new LinearLayout.LayoutParams(-1, -2);
            lage.bottomMargin = dp(5); zeilen.addView(block, lage);
        }
        if (nachUnten) scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
    }

    private TextView knopf(String text, String beschreibung, Runnable aktion) {
        TextView v = text(text, 14, Color.WHITE); v.setGravity(Gravity.CENTER); v.setContentDescription(beschreibung);
        v.setFocusable(true); v.setFocusableInTouchMode(false); v.setBackground(flaeche(0x20FFFFFF, 10, 0x55FFFFFF));
        v.setOnFocusChangeListener((ansicht, fokus) -> ansicht.setBackground(
            flaeche(fokus ? 0x55FFFFFF : 0x20FFFFFF, 10, fokus ? Color.WHITE : 0x55FFFFFF)));
        v.setOnClickListener(x -> aktion.run()); return v;
    }
    private TextView text(String inhalt, int groesse, int farbe) {
        TextView v = new TextView(activity); v.setText(inhalt); v.setTextSize(groesse); v.setTextColor(farbe); return v;
    }
    private int breite() { return Math.min(dp(420), Math.max(dp(280), activity.getResources().getDisplayMetrics().widthPixels * 42 / 100)); }
    private int dp(int wert) { return Math.round(wert * activity.getResources().getDisplayMetrics().density); }
    private void badgeZeichnen() { zaehler.setText(ungelesen > 0 ? "Chat " + Math.min(99, ungelesen) : "Chat"); }
    private boolean istNaheUnten() {
        View inhalt = scroll.getChildAt(0);
        return inhalt == null || inhalt.getBottom() - (scroll.getScrollY() + scroll.getHeight()) < dp(32);
    }
    private static boolean gesendet(String wert) {
        if (wert == null) return false;
        String sauber = wert.trim();
        if (sauber.isEmpty() || "false".equalsIgnoreCase(sauber) || "null".equalsIgnoreCase(sauber)) return false;
        if (sauber.startsWith("{")) {
            try { return new JSONObject(sauber).optBoolean("ok", false); }
            catch (Exception ignoriert) { return false; }
        }
        return true; // Die Brücke gibt bei Erfolg Boolean true zurück.
    }
    private static String sauber(String wert) { return wert == null ? "" : wert.trim(); }
    private static String sichererText(String wert) { String text = sauber(wert); return text.length() > 500 ? text.substring(0, 500) : text; }
    private static boolean gleich(String a, String b) { return sauber(a).equals(sauber(b)); }
    private static String sichererName(String name) {
        String sauber = sauber(name); if (sauber.isEmpty()) return "Gast";
        return sauber.length() > 40 ? sauber.substring(0, 40) : sauber;
    }
    private static String zeit(long zeit) { return zeit <= 0 ? "jetzt" : DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(zeit)); }
    private static GradientDrawable flaeche(int farbe, int radius, int rahmen) {
        GradientDrawable d = new GradientDrawable(); d.setColor(farbe); d.setCornerRadius(radius * 2f);
        if (rahmen != 0) d.setStroke(1, rahmen); return d;
    }
}
