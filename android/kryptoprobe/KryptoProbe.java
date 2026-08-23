import local.elflix.android.Krypto;

/**
 * Rechnet Krypto.java gegen das, was Node ausrechnet.
 *
 * <p>Der Geraeteabgleich steht und faellt damit: das Telefon verschluesselt mit
 * javax.crypto, der Rechner mit Node, und das Relay reicht die Klumpen
 * unveraendert weiter. Weicht auch nur ein Byte ab, kann kein Geraet lesen, was
 * das andere geschrieben hat - und der Fehler faellt erst auf, wenn zwei echte
 * Geraete danebenstehen und beide "verbunden" melden, ohne dass etwas ankommt.
 *
 * <p>Die Erwartungswerte unten stammen aus {@code vektoren.js} im selben
 * Ordner, ausgerechnet mit Node. Wer sie erneuern will, laesst das Skript
 * laufen und traegt ein, was dabei herauskommt.
 *
 * <p>Aufruf (aus dem Repo-Verzeichnis):
 * <pre>
 * javac -cp C:/tmp/android-sdk/platforms/android-35/android.jar \
 *   -d build/kryptoprobe \
 *   android/app/src/main/java/local/elflix/android/Krypto.java \
 *   android/kryptoprobe/KryptoProbe.java
 * java -cp build/kryptoprobe KryptoProbe
 * </pre>
 */
public final class KryptoProbe {
    private static int gesamt = 0;
    private static int fehler = 0;

    private static void pruefe(String name, String erwartet, String bekommen) {
        gesamt += 1;
        boolean ok = erwartet.equals(bekommen);
        if (!ok) fehler += 1;
        System.out.println((ok ? "OK   " : "FAIL ") + name
            + (ok ? "" : "\n       erwartet: " + erwartet + "\n       bekommen: " + bekommen));
    }

    public static void main(String[] args) {
        Krypto krypto = new Krypto();

        // 20 Byte Ausgangsmaterial und das feste Salz aus geraete-schluessel.js.
        final String ikm = "3031323334353637383961626364656630313233";
        final String salz = "656c6669782d676572616574652d7631";
        final String iv = "000102030405060708090a0b";

        // --- HKDF: die drei Ableitungen, die ein Geraet wirklich zieht --------
        pruefe("HKDF raum (16)",
            "c10b1928350c4b8479c4c87af19d1f48",
            krypto.hkdf(ikm, salz, "7261756d" /* "raum" */, 16));
        pruefe("HKDF chiffre (32)",
            "db48eee092ca2531b7c5b273df46b2af0d66ed8a14a44f3a1ef8df3a618f97a1",
            krypto.hkdf(ikm, salz, "63686966667265" /* "chiffre" */, 32));
        pruefe("HKDF kennung (32)",
            "ed482adfbc1de33ad5fd148dc1e7e4e414fdbdc23dd946e2ac66961dbda1c47c",
            krypto.hkdf(ikm, salz, "6b656e6e756e67" /* "kennung" */, 32));

        final String kennung = "ed482adfbc1de33ad5fd148dc1e7e4e414fdbdc23dd946e2ac66961dbda1c47c";
        final String chiffre = "db48eee092ca2531b7c5b273df46b2af0d66ed8a14a44f3a1ef8df3a618f97a1";

        // --- HMAC: aus dem Titelschluessel wird die Eintragskennung -----------
        pruefe("HMAC serie:one-piece",
            "bf3955556a33b1719765be417663c87b19a2e020a915cd86644390426e92b2b1",
            krypto.hmac(kennung, "serie:one-piece"));
        pruefe("HMAC film:dune",
            "2be6149efa3606052f018b620e78446deb3ad442046c99bd870fb390f49a400d",
            krypto.hmac(kennung, "film:dune"));
        pruefe("HMAC leerer Text",
            "6097c2645796b2d95a5278aa1fb0302ce4f208aa11cf618ebccd475fa6aa3642",
            krypto.hmac(kennung, ""));

        // --- SHA-256: der Hash, an dem ein unveraenderter Stand erkannt wird --
        pruefe("SHA-256 {\"a\":1}",
            "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862",
            krypto.hash("{\"a\":1}"));
        pruefe("SHA-256 mit Umlauten",
            "c88c6b29df5d9247c84bcd81f3aedcd86636f5c7eb562017ab3a0c0f18275433",
            krypto.hash("\u00fcml\u00e4ut"));

        // --- AES-256-GCM ------------------------------------------------------
        pruefe("GCM zu: {\"progress\":42}",
            "06d6368887d29d35931c8970ba6225:047d564899c26cc8a1f075cdc78981da",
            krypto.gcmZu(chiffre, iv, "{\"progress\":42}"));
        pruefe("GCM zu: kurz",
            "16813480:9d640e92aac4f885c66bec32741b08c3",
            krypto.gcmZu(chiffre, iv, "kurz"));
        pruefe("GCM zu: Umlaute und ein Haken",
            "be482b962b119a24c0498b39e13e3c6ebec63906312dca780567c742"
                + ":66167997596fd18f849a3c4462896be6",
            krypto.gcmZu(chiffre, iv, "\u00fcml\u00e4ut & sonderzeichen \u2713"));

        // Und zurueck - das ist der Weg, den ein Eintrag vom Rechner nimmt.
        pruefe("GCM auf: was Node verschluesselt hat",
            "{\"progress\":42}",
            krypto.gcmAuf(chiffre, iv,
                "06d6368887d29d35931c8970ba6225", "047d564899c26cc8a1f075cdc78981da"));
        pruefe("GCM auf: Umlaute ueberleben",
            "\u00fcml\u00e4ut & sonderzeichen \u2713",
            krypto.gcmAuf(chiffre, iv,
                "be482b962b119a24c0498b39e13e3c6ebec63906312dca780567c742",
                "66167997596fd18f849a3c4462896be6"));

        // Eine verfaelschte Marke darf nichts liefern und nichts werfen.
        pruefe("GCM auf: falsche Marke gibt nichts zurueck",
            "",
            krypto.gcmAuf(chiffre, iv,
                "06d6368887d29d35931c8970ba6225", "00000000000000000000000000000000"));
        pruefe("GCM auf: falscher Schluessel gibt nichts zurueck",
            "",
            krypto.gcmAuf(kennung, iv,
                "06d6368887d29d35931c8970ba6225", "047d564899c26cc8a1f075cdc78981da"));

        // --- Zufall ------------------------------------------------------------
        String a = krypto.zufall(12);
        String b = krypto.zufall(12);
        pruefe("Zufall hat die verlangte Laenge", "24", String.valueOf(a.length()));
        pruefe("Zufall wiederholt sich nicht", "true", String.valueOf(!a.equals(b)));

        System.out.println();
        System.out.println((gesamt - fehler) + "/" + gesamt + " bestanden");
        System.exit(fehler == 0 ? 0 : 1);
    }
}
