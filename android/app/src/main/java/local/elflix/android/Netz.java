package local.elflix.android;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

/**
 * Ist überhaupt eine Leitung da?
 *
 * <p>Eine kleine Frage mit einem grossen Unterschied dahinter: <em>"dazu gibt
 * es nichts"</em> und <em>"ich komme gerade nicht ins Netz"</em> sehen in den
 * Daten gleich aus. Der Empfehlungslauf fängt einen gescheiterten Abruf ab und
 * gibt eine leere Liste zurück - das ist richtig, denn ein Ausfall bei einem
 * Anbieter soll nicht die ganze Reihe zum Fehler machen. Die Oberfläche hat
 * daraufhin aber die Reihe weggelassen, und auf einem Telefon ohne Empfang
 * verschwand die halbe Startseite wortlos.
 *
 * <p>Deshalb wird hier gefragt, bevor eine leere Reihe als "nichts gefunden"
 * gilt. Ohne Leitung heisst leer eben nicht leer, sondern unbekannt - und das
 * gehört hingeschrieben, samt einem Knopf.
 *
 * <p>Gefragt wird das Betriebssystem und nicht ein Server: ein Testabruf wäre
 * ein zusätzlicher Abruf genau in dem Moment, in dem gerade keiner durchgeht.
 */
public final class Netz {
    private Netz() {
    }

    /**
     * Ob eine Verbindung besteht, die auch wirklich ins Internet führt.
     *
     * <p>{@code NET_CAPABILITY_INTERNET} allein genügt nicht: ein WLAN ohne
     * Anschluss dahinter - ein Hotspot mit Anmeldeseite etwa - trägt sie
     * ebenfalls. {@code NET_CAPABILITY_VALIDATED} ist das Urteil des Systems
     * nach seinem eigenen Testabruf.
     *
     * <p>Im Zweifel wird "ja" gesagt: wer hier fälschlich "offline" meldet,
     * zeigt einen Offline-Hinweis auf einem Gerät, das online ist - und das ist
     * schlechter, als es einmal zu spät zu merken.
     */
    public static boolean vorhanden(Context context) {
        if (context == null) return true;
        try {
            ConnectivityManager verwalter =
                (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (verwalter == null) return true;
            Network netz = verwalter.getActiveNetwork();
            if (netz == null) return false;
            NetworkCapabilities koennen = verwalter.getNetworkCapabilities(netz);
            if (koennen == null) return false;
            return koennen.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                && koennen.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        } catch (Exception fehler) {
            return true;
        }
    }
}
