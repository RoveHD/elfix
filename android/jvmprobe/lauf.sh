#!/usr/bin/env bash
#
# Die Java-Pruefungen ohne Android-SDK. Siehe README.md daneben.
#
# Zwei Dinge in einem Lauf: die App einmal vollstaendig uebersetzen (ein
# Tippfehler in neuntausend Zeilen MainActivity faellt sonst erst im
# Release-Bau auf) und danach die Unit-Tests starten.
set -euo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WURZEL="$(cd "$HIER/../.." && pwd)"
APP="$WURZEL/android/app/src"
CACHE="${ELFIX_JVMPROBE_CACHE:-$HOME/.cache/elfix-jvmprobe}"
BAU="$CACHE/bau"
MAVEN="https://repo1.maven.org/maven2"

mkdir -p "$CACHE"

holen() {
  local ziel="$CACHE/$1"
  local pfad="$2"
  [ -s "$ziel" ] && return 0
  echo "hole $1 …"
  curl -sSLf -o "$ziel" "$MAVEN/$pfad" || {
    echo "FEHL: $1 liess sich nicht holen ($MAVEN/$pfad)." >&2
    echo "      Ohne Netz zu Maven Central geht dieser Lauf nicht." >&2
    rm -f "$ziel"
    exit 1
  }
}

# Der Android-Rumpf. Robolectrics android-all ist ein vollstaendiges android.jar
# und liegt - anders als das SDK - auf Maven Central.
holen android-all.jar "org/robolectric/android-all/14-robolectric-10818077/android-all-14-robolectric-10818077.jar"
holen json.jar        "org/json/json/20231013/json-20231013.jar"
holen junit.jar       "junit/junit/4.13.2/junit-4.13.2.jar"
holen hamcrest.jar    "org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.jar"

RUMPF="$CACHE/rumpf"
rm -rf "$RUMPF"
mkdir -p "$RUMPF/androidx/webkit" "$RUMPF/androidx/core/content" "$RUMPF/local/elflix/android"

# androidx.webkit und androidx.core liegen auf Googles Maven, nicht auf Maven
# Central. Gebraucht werden fuenf Namen; sie stehen hier als Rumpf, damit der
# Uebersetzungslauf ohne Googles Maven auskommt. Zur Laufzeit ist das ohne
# Belang - dort liegen die echten Klassen in der APK.
cat > "$RUMPF/androidx/webkit/JavaScriptReplyProxy.java" <<'JAVA'
package androidx.webkit;
public abstract class JavaScriptReplyProxy { public abstract void postMessage(String message); }
JAVA
cat > "$RUMPF/androidx/webkit/WebMessageCompat.java" <<'JAVA'
package androidx.webkit;
public class WebMessageCompat { public String getData() { return null; } }
JAVA
cat > "$RUMPF/androidx/webkit/WebViewFeature.java" <<'JAVA'
package androidx.webkit;
public class WebViewFeature {
  public static final String DOCUMENT_START_SCRIPT = "DOCUMENT_START_SCRIPT";
  public static final String WEB_MESSAGE_LISTENER = "WEB_MESSAGE_LISTENER";
  public static boolean isFeatureSupported(String feature) { return false; }
}
JAVA
cat > "$RUMPF/androidx/webkit/WebViewCompat.java" <<'JAVA'
package androidx.webkit;
import android.net.Uri;
import android.webkit.WebView;
import java.util.Set;
public class WebViewCompat {
  public interface WebMessageListener {
    void onPostMessage(WebView view, WebMessageCompat message, Uri sourceOrigin,
                       boolean isMainFrame, JavaScriptReplyProxy replyProxy);
  }
  public static void addWebMessageListener(WebView view, String jsObjectName,
      Set<String> allowedOriginRules, WebMessageListener listener) { }
  public static Object addDocumentStartJavaScript(WebView view, String script,
      Set<String> allowedOriginRules) { return null; }
}
JAVA
cat > "$RUMPF/androidx/core/content/FileProvider.java" <<'JAVA'
package androidx.core.content;
import android.content.Context;
import android.net.Uri;
import java.io.File;
public class FileProvider {
  public static Uri getUriForFile(Context context, String authority, File file) { return null; }
}
JAVA

# R.java erzeugt sonst Gradle aus den Ressourcen. Hier reichen die Namen: der
# Uebersetzungslauf prueft, dass jede benutzte Kennung ueberhaupt existiert.
{
  echo "package local.elflix.android;"
  echo "/** Nur zum Uebersetzen - Gradle erzeugt diese Klasse aus den Ressourcen. */"
  echo "public final class R {"
  for ordner in drawable mipmap xml; do
    echo "  public static final class $ordner {"
    for datei in "$APP"/main/res/$ordner*/*; do
      [ -e "$datei" ] || continue
      name="$(basename "$datei")"
      echo "    public static final int ${name%%.*} = 0;"
    done | sort -u
    echo "  }"
  done
  echo "  public static final class string { public static final int app_name = 0; }"
  echo "}"
} > "$RUMPF/local/elflix/android/R.java"

CP="$CACHE/android-all.jar:$CACHE/json.jar:$CACHE/junit.jar:$CACHE/hamcrest.jar"

echo
echo "--- Die App uebersetzen (Release-Variante) ---"
rm -rf "$BAU"; mkdir -p "$BAU"
# shellcheck disable=SC2046
javac -nowarn -proc:none -cp "$CP" -d "$BAU" \
  $(find "$APP/main/java" "$APP/release/java" "$RUMPF" -name '*.java')
echo "ok"

echo
echo "--- Die App uebersetzen (Debug-Variante) ---"
DBG="$CACHE/bau-debug"
rm -rf "$DBG"; mkdir -p "$DBG"
# shellcheck disable=SC2046
javac -nowarn -proc:none -cp "$CP" -d "$DBG" \
  $(find "$APP/main/java" "$APP/debug/java" "$RUMPF" -name '*.java')
echo "ok"

echo
echo "--- Die Pruefungen uebersetzen ---"
# shellcheck disable=SC2046
javac -nowarn -proc:none -cp "$CP:$BAU" -d "$BAU" $(find "$APP/test/java" -name '*.java')
echo "ok"

echo
echo "--- Die Pruefungen laufen lassen ---"
KLASSEN=$(cd "$APP/test/java" && find . -name '*Test.java' \
  | sed 's|^\./||; s|\.java$||; s|/|.|g' | sort)
# shellcheck disable=SC2086
java -cp "$CP:$BAU" org.junit.runner.JUnitCore $KLASSEN
