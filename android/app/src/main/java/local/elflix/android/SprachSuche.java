package local.elflix.android;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.speech.RecognizerIntent;
import java.util.ArrayList;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Sprachsuche auf Handy und Fernseher.
 *
 * <p>Zugehoert wird ueber die Spracheingabe des Systems (Google, auf dem
 * Fernseher die Fernbedienung): sie bringt Oberflaeche und Mikrofonfreigabe
 * selbst mit, ELFIX bekommt nur den erkannten Text. Was davor steht ("such
 * nach", "zeig mir"), wird wie am Desktop entfernt - dieselben Regeln wie in
 * shared/sprachsuche-text.js.
 */
final class SprachSuche {
    static final int ANFRAGE = 0x5e4c;

    private SprachSuche() {}

    static Intent intent() {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "de-DE");
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Welche Serie oder welchen Film?");
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        return intent;
    }

    /** Oeffnet die Spracheingabe; false, wenn das Geraet keine hat. */
    static boolean starten(Activity activity) {
        try {
            activity.startActivityForResult(intent(), ANFRAGE);
            return true;
        } catch (ActivityNotFoundException | SecurityException keine) {
            return false;
        }
    }

    /** Die Suche aus der Antwort der Spracheingabe, oder "". */
    static String ergebnis(Intent daten) {
        if (daten == null) return "";
        ArrayList<String> treffer = daten.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (treffer == null || treffer.isEmpty()) return "";
        return bereinigen(treffer.get(0));
    }

    private static final String NAME = "(?:elf\\s*fix(?:e|es)?|elf\\s*ix|elf\\s*vix|elf\\s*ficks|elf\\s*fisch|elfi[sx]?"
        + "|helf\\s*fix|helf\\s*ix|hell\\s*fix|el\\s*fix)";
    private static final String ANREDE = "(?:hey|hei|hej|hay|he|hi|ey|hallo|okay|ok|o\\s*k)";
    private static final Pattern WECKWORT = Pattern.compile("^(?:" + ANREDE + "\\s+)?" + NAME + "(?=\\s|$)\\s*");
    private static final Pattern[] VORNE = {
        Pattern.compile("^(?:bitte\\s+)?(?:such(?:e)?|finde?|zeig(?:e)?|oeffne|öffne|spiel(?:e)?|starte?|schau(?:e)?|guck(?:e)?)"
            + "(?:\\s+(?:mal|bitte|mir|uns))*(?:\\s+(?:nach|die|den|das|der|serie|film|anime))*\\s+"),
        Pattern.compile("^ich\\s+(?:will|möchte|moechte|würde\\s+gern|wuerde\\s+gern)(?:\\s+(?:gern|gerne))?\\s+"),
        Pattern.compile("^(?:die\\s+)?(?:serie|film|anime)\\s+")
    };
    private static final Pattern HINTEN = Pattern.compile(
        "\\s+(?:suchen|anschauen|schauen|sehen|gucken|abspielen|spielen|anzeigen|starten|bitte|finden|ab)$");

    static String bereinigen(String text) {
        String satz = text == null ? "" : text.toLowerCase(Locale.GERMAN)
            .replaceAll("[.,!?;:\"„“”'’]+", " ").replaceAll("\\s+", " ").trim();
        satz = WECKWORT.matcher(satz).replaceFirst("").trim();
        for (int runde = 0; runde < 3; runde++) {
            String vorher = satz;
            for (Pattern muster : VORNE) satz = muster.matcher(satz).replaceFirst("");
            satz = HINTEN.matcher(satz).replaceFirst("").trim();
            if (satz.equals(vorher)) break;
        }
        return satz;
    }
}
