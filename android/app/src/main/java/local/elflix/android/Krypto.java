package local.elflix.android;

import android.webkit.JavascriptInterface;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Die Krypto-Grundrechenarten fuer den Kern - aus Java, weil sie synchron sein
 * muessen.
 *
 * <p>{@code geraete-schluessel.js} ruft {@code crypto.hkdfSync},
 * {@code createHmac} und {@code createCipheriv} und arbeitet mit dem Ergebnis
 * in derselben Zeile weiter. Die WebCrypto-API des WebViews kann alles davon,
 * aber ausschliesslich mit Versprechen - ein Ersatz darueber muesste das Modul
 * umschreiben, und dann stuende die Regel wieder zweimal da.
 *
 * <p>Ein Aufruf ueber {@link JavascriptInterface} kehrt dagegen sofort mit
 * seinem Wert zurueck. Deshalb liegt hier, was Node sonst mitbringt - und nur
 * das: Zufall, HKDF, HMAC, SHA-256 und AES-256-GCM. Keine Entscheidung, keine
 * Ablage, kein Schluessel im Speicher, der nicht gerade gebraucht wird.
 *
 * <p>Alles geht als Hex hinein und heraus. Das ist ein paar Zeichen teurer als
 * Base64, aber es gibt keine zwei Schreibweisen davon - bei Base64 waeren
 * Polsterung und URL-Form zwei Gelegenheiten, aneinander vorbeizurechnen.
 *
 * <p>Dass hier dasselbe herauskommt wie bei Node, ist nicht behauptet, sondern
 * geprueft: {@code tools/kryptoprobe} faehrt die Vektoren, die Node erzeugt
 * hat, gegen genau diese Methoden.
 */
public final class Krypto {
    private static final SecureRandom ZUFALL = new SecureRandom();
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    /** Zufall, wie {@code crypto.randomBytes}. */
    @JavascriptInterface
    public String zufall(int anzahl) {
        if (anzahl <= 0 || anzahl > 1024) return "";
        byte[] bytes = new byte[anzahl];
        ZUFALL.nextBytes(bytes);
        return hex(bytes);
    }

    /**
     * HKDF nach RFC 5869 mit SHA-256 - dasselbe, was {@code crypto.hkdfSync}
     * rechnet.
     *
     * <p>Steht nicht in der Standardbibliothek, ist aber ueber HMAC in wenigen
     * Zeilen zu haben: erst aus Salz und Ausgangsmaterial einen
     * Zwischenschluessel gewinnen (extract), dann daraus so viele Bloecke
     * ziehen, wie gebraucht werden (expand).
     */
    @JavascriptInterface
    public String hkdf(String ikmHex, String salzHex, String infoHex, int laenge) {
        try {
            if (laenge <= 0 || laenge > 255 * 32) return "";
            byte[] zwischen = hmacRoh(bytes(salzHex), bytes(ikmHex));
            byte[] info = bytes(infoHex);
            byte[] aus = new byte[laenge];
            byte[] block = new byte[0];
            int geschrieben = 0;
            for (int zaehler = 1; geschrieben < laenge; zaehler += 1) {
                byte[] eingabe = new byte[block.length + info.length + 1];
                System.arraycopy(block, 0, eingabe, 0, block.length);
                System.arraycopy(info, 0, eingabe, block.length, info.length);
                eingabe[eingabe.length - 1] = (byte) zaehler;
                block = hmacRoh(zwischen, eingabe);
                int nehmen = Math.min(block.length, laenge - geschrieben);
                System.arraycopy(block, 0, aus, geschrieben, nehmen);
                geschrieben += nehmen;
            }
            return hex(aus);
        } catch (Exception fehler) {
            return "";
        }
    }

    /** HMAC-SHA256 ueber einen UTF-8-Text, wie {@code createHmac(...).update(text)}. */
    @JavascriptInterface
    public String hmac(String schluesselHex, String text) {
        try {
            return hex(hmacRoh(bytes(schluesselHex),
                (text == null ? "" : text).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception fehler) {
            return "";
        }
    }

    /** SHA-256 ueber einen UTF-8-Text. */
    @JavascriptInterface
    public String hash(String text) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return hex(digest.digest((text == null ? "" : text).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception fehler) {
            return "";
        }
    }

    /**
     * AES-256-GCM verschluesseln.
     *
     * <p>Java haengt die Marke hinten an den Geheimtext; Node haelt sie
     * getrennt. Hier wird sie abgeschnitten und getrennt zurueckgegeben, damit
     * das Ergebnis genau die Form hat, die {@code verschluesseln()} erwartet:
     * erst der Zufallsvorspann, dann die Marke, dann die Daten.
     *
     * @return {@code "<datenHex>:<markeHex>"}, oder leer bei einem Fehler
     */
    @JavascriptInterface
    public String gcmZu(String schluesselHex, String ivHex, String klartext) {
        try {
            Cipher chiffre = Cipher.getInstance("AES/GCM/NoPadding");
            chiffre.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(bytes(schluesselHex), "AES"),
                new GCMParameterSpec(128, bytes(ivHex)));
            byte[] alles = chiffre.doFinal(
                (klartext == null ? "" : klartext).getBytes(StandardCharsets.UTF_8));
            int schnitt = alles.length - 16;
            if (schnitt < 0) return "";
            byte[] daten = new byte[schnitt];
            byte[] marke = new byte[16];
            System.arraycopy(alles, 0, daten, 0, schnitt);
            System.arraycopy(alles, schnitt, marke, 0, 16);
            return hex(daten) + ":" + hex(marke);
        } catch (Exception fehler) {
            return "";
        }
    }

    /**
     * AES-256-GCM entschluesseln.
     *
     * <p>Leer heisst "damit ist nichts anzufangen" - falscher Schluessel,
     * beschaedigter Klumpen, fremde Fassung. Geworfen wird nichts: ein
     * einzelner unlesbarer Eintrag darf nicht den ganzen Abgleich anhalten.
     */
    @JavascriptInterface
    public String gcmAuf(String schluesselHex, String ivHex, String datenHex, String markeHex) {
        try {
            byte[] daten = bytes(datenHex);
            byte[] marke = bytes(markeHex);
            byte[] alles = new byte[daten.length + marke.length];
            System.arraycopy(daten, 0, alles, 0, daten.length);
            System.arraycopy(marke, 0, alles, daten.length, marke.length);
            Cipher chiffre = Cipher.getInstance("AES/GCM/NoPadding");
            chiffre.init(Cipher.DECRYPT_MODE, new SecretKeySpec(bytes(schluesselHex), "AES"),
                new GCMParameterSpec(128, bytes(ivHex)));
            return new String(chiffre.doFinal(alles), StandardCharsets.UTF_8);
        } catch (Exception fehler) {
            return "";
        }
    }

    // --- Umrechnen ---------------------------------------------------------

    private static byte[] hmacRoh(byte[] schluessel, byte[] daten) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        // Ein leerer Schluessel ist fuer HKDF gueltig (Salz darf fehlen), aber
        // SecretKeySpec verbietet ihn. Ein Nullblock ist genau das, was RFC 5869
        // an dieser Stelle vorsieht.
        mac.init(new SecretKeySpec(schluessel.length == 0 ? new byte[32] : schluessel, "HmacSHA256"));
        return mac.doFinal(daten);
    }

    static String hex(byte[] bytes) {
        char[] aus = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i += 1) {
            aus[i * 2] = HEX[(bytes[i] >> 4) & 0xf];
            aus[i * 2 + 1] = HEX[bytes[i] & 0xf];
        }
        return new String(aus);
    }

    static byte[] bytes(String hex) {
        String sauber = hex == null ? "" : hex.trim();
        int laenge = sauber.length() / 2;
        byte[] aus = new byte[laenge];
        for (int i = 0; i < laenge; i += 1) {
            aus[i] = (byte) Integer.parseInt(sauber.substring(i * 2, i * 2 + 2), 16);
        }
        return aus;
    }
}
