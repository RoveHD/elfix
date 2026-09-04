#!/usr/bin/env bash
#
# Die Schicht ueber dem Video pruefen - ohne Fernseher.
#
# Zwei Schritte: das Rahmenskript aus Werbeschichten.java herausschreiben
# (javac gegen einen Android-Rumpf, kein SDK noetig) und es danach gegen ein
# nachgebautes Dokument laufen lassen (node, kein node_modules noetig).
#
# Aufruf: android/schichtprobe/lauf.sh
set -euo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WURZEL="$(cd "$HIER/../.." && pwd)"
QUELLE="$WURZEL/android/app/src/main/java/local/elflix/android"
BAU="${TMPDIR:-/tmp}/elfix-schichtprobe"

rm -rf "$BAU"; mkdir -p "$BAU/rumpf/android/util" "$BAU/rumpf/android/webkit" \
  "$BAU/rumpf/androidx/webkit" "$BAU/quelle/local/elflix/android" "$BAU/klassen"

# Der Android-Rumpf. Werbeschichten braucht genau vier Namen davon; sie hier
# hinzuschreiben ist billiger als ein SDK und macht die Probe netzunabhaengig.
cat > "$BAU/rumpf/android/util/Log.java" <<'JAVA'
package android.util;
public final class Log {
  public static int w(String t, String m) { return 0; }
  public static int w(String t, String m, Throwable e) { return 0; }
}
JAVA
cat > "$BAU/rumpf/android/webkit/WebView.java" <<'JAVA'
package android.webkit;
public class WebView { public void evaluateJavascript(String s, Object cb) { } }
JAVA
cat > "$BAU/rumpf/androidx/webkit/WebViewFeature.java" <<'JAVA'
package androidx.webkit;
public class WebViewFeature {
  public static final String DOCUMENT_START_SCRIPT = "DOCUMENT_START_SCRIPT";
  public static boolean isFeatureSupported(String feature) { return false; }
}
JAVA
cat > "$BAU/rumpf/androidx/webkit/WebViewCompat.java" <<'JAVA'
package androidx.webkit;
import android.webkit.WebView;
import java.util.Set;
public class WebViewCompat {
  public static Object addDocumentStartJavaScript(WebView v, String s, Set<String> r) { return null; }
}
JAVA

# Werbeschichten selbst, und daneben nur das, was es zum Uebersetzen braucht.
cp "$QUELLE/Werbeschichten.java" "$BAU/quelle/local/elflix/android/"
cat > "$BAU/quelle/local/elflix/android/CrashReporter.java" <<'JAVA'
package local.elflix.android;
public final class CrashReporter { public static final String TAG = "ELFIX"; }
JAVA
cat > "$BAU/quelle/local/elflix/android/Provider.java" <<'JAVA'
package local.elflix.android;
public final class Provider { public String id, name, startUrl; public boolean adblockEnabled = true; }
JAVA
cat > "$BAU/quelle/local/elflix/android/Adblocker.java" <<'JAVA'
package local.elflix.android;
import java.util.*;
public final class Adblocker {
  public Set<String> kernWerbeWirte() { return new HashSet<>(Arrays.asList("doubleclick.net")); }
}
JAVA
cat > "$BAU/quelle/local/elflix/android/SchichtSchreiben.java" <<'JAVA'
package local.elflix.android;
public final class SchichtSchreiben {
  public static void main(String[] args) throws Exception {
    java.nio.file.Files.write(java.nio.file.Paths.get(args[0]),
      Werbeschichten.fremdSkript("aniworld.to", false).getBytes("UTF-8"));
    // Das volle Skript wird hier nicht gefahren, aber gelesen: ein
    // Syntaxfehler darin heisst, dass auf der Anbieterseite gar nichts mehr
    // filtert, und das faellt sonst erst auf dem Fernseher auf.
    java.nio.file.Files.write(java.nio.file.Paths.get(args[1]),
      Werbeschichten.skript(Werbeschichten.ANIWORLD,
        java.util.Arrays.asList("doubleclick.net"), false).getBytes("UTF-8"));
  }
}
JAVA

echo "--- Die Skripte herausschreiben ---"
javac -nowarn -proc:none -d "$BAU/klassen" $(find "$BAU/rumpf" "$BAU/quelle" -name '*.java')
java -cp "$BAU/klassen" local.elflix.android.SchichtSchreiben "$BAU/fremd.js" "$BAU/voll.js"
node --check "$BAU/fremd.js"
node --check "$BAU/voll.js"
echo "ok (Rahmen $(wc -c < "$BAU/fremd.js") Zeichen, voll $(wc -c < "$BAU/voll.js") Zeichen)"

echo
echo "--- Gegen ein nachgebautes Dokument laufen lassen ---"
node "$HIER/probe.js" "$BAU/fremd.js"
