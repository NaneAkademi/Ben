#!/usr/bin/env bash
# Siper Hattı APK derleyici.
#  - ANDROID_HOME varsa (GitHub Actions) SDK araçlarını kullanır: aapt2, d8, zipalign, apksigner.
#  - Yoksa TOOLS_DIR içindeki yedek araçları kullanır: aapt2 + android-framework.jar (apktool),
#    android-all.jar (Robolectric), dx.jar, apksig.jar.
# Web oyununun önce derlenmiş olması gerekir: (cd web && npm run build) -> web/dist
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AND="$ROOT/android"
WWW="${WWW:-$ROOT/web/dist}"
OUT="${OUT:-$ROOT/build}"
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-2.0.$VERSION_CODE}"
MIN_SDK=24
TARGET_SDK=34
KS="${KEYSTORE:-$AND/siper.keystore}"
KS_PASS="${KEYSTORE_PASS:-siperhatti}"
KS_ALIAS="${KEY_ALIAS:-siper}"
APK_NAME="${APK_NAME:-SiperHatti-$VERSION_NAME.apk}"

[ -f "$WWW/index.html" ] || { echo "Once web oyununu derle: (cd web && npm ci && npm run build)"; exit 1; }

if [ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME/build-tools" ]; then
  MODE=sdk
  BT="$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)"
  PLAT="$(ls -d "$ANDROID_HOME"/platforms/android-*/ | sort -V | tail -1)"
  AAPT2="$BT/aapt2"
  LINK_JAR="$PLAT/android.jar"
  COMPILE_JAR="$PLAT/android.jar"
else
  MODE=fallback
  JOPTS="--add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED --add-exports java.base/sun.security.util=ALL-UNNAMED"
  T="${TOOLS_DIR:?ANDROID_HOME ya da TOOLS_DIR ayarlanmali}"
  AAPT2="$T/aapt2"
  LINK_JAR="$T/android-framework.jar"
  COMPILE_JAR="$T/android-all.jar"
fi
echo "Mod: $MODE  surum: $VERSION_NAME ($VERSION_CODE)"

W="$OUT/work"
rm -rf "$W"
mkdir -p "$W/assets/www" "$W/gen" "$W/classes" "$W/dex" "$OUT"
cp -R "$WWW/." "$W/assets/www/"

# 1) kaynaklar
"$AAPT2" compile --dir "$AND/res" -o "$W/res.zip"
"$AAPT2" link -o "$W/base.apk" -I "$LINK_JAR" \
  --manifest "$AND/AndroidManifest.xml" -R "$W/res.zip" -A "$W/assets" \
  --java "$W/gen" --auto-add-overlay \
  --min-sdk-version $MIN_SDK --target-sdk-version $TARGET_SDK \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -0 woff2 -0 png

# 2) java -> class -> dex
javac -nowarn -proc:none --release 8 -encoding UTF-8 -classpath "$COMPILE_JAR" -d "$W/classes" \
  $(find "$W/gen" "$AND/java" -name '*.java') 2>&1 | grep -v '^warning' || true
[ -f "$W/classes/com/naneakademi/siperhatti/MainActivity.class" ] || { echo "javac basarisiz"; exit 1; }
if [ "$MODE" = sdk ]; then
  "$BT/d8" --release --min-api $MIN_SDK --lib "$COMPILE_JAR" --output "$W/dex" $(find "$W/classes" -name '*.class')
else
  java -cp "$T/dx.jar" com.android.dx.command.Main --dex --min-sdk-version=$MIN_SDK --output="$W/dex/classes.dex" "$W/classes"
fi
(cd "$W/dex" && zip -q -X "$W/base.apk" classes.dex)

# 3) hizala + imzala
FINAL="$OUT/$APK_NAME"
if [ "$MODE" = sdk ]; then
  "$BT/zipalign" -p -f 4 "$W/base.apk" "$W/aligned.apk"
  "$BT/apksigner" sign --ks "$KS" --ks-pass "pass:$KS_PASS" --ks-key-alias "$KS_ALIAS" \
    --min-sdk-version $MIN_SDK --out "$FINAL" "$W/aligned.apk"
  "$BT/apksigner" verify --verbose "$FINAL" | head -5
else
  python3 "$ROOT/tools/zipalign.py" "$W/base.apk" "$W/aligned.apk"
  java $JOPTS -cp "$T/apksig.jar" "$ROOT/tools/ApkSign.java" sign "$KS" "$KS_PASS" "$KS_ALIAS" "$W/aligned.apk" "$FINAL" $MIN_SDK
  python3 "$ROOT/tools/zipalign.py" -c "$FINAL"
  java $JOPTS -cp "$T/apksig.jar" "$ROOT/tools/ApkSign.java" verify "$FINAL"
fi
ls -la "$FINAL"
echo "APK hazir: $FINAL"
