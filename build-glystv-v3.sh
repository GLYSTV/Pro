#!/usr/bin/env bash
set -euo pipefail

log(){ printf "\n[%s] %s\n" "$(date +%H:%M:%S)" "$*"; }
die(){ printf "\nERROR: %s\n" "$*" >&2; exit 1; }

# ---------- 1) Validacion ----------
log "Validando dependencias..."
command -v npx >/dev/null     || die "Falta npx (instala Node.js 18+)"
command -v python3 >/dev/null || die "Falta python3"
command -v unzip >/dev/null   || die "Falta unzip"
[ -f index.html ]              || die "Falta index.html"
[ -f capacitor.config.json ]   || die "Falta capacitor.config.json"

APP_ID=$(python3 -c "import json;print(json.load(open('capacitor.config.json'))['appId'])" 2>/dev/null || echo "")
[ -n "$APP_ID" ] || die "capacitor.config.json sin appId valido"
log "appId = $APP_ID"

PKG_PATH="android/app/src/main/java/$(echo "$APP_ID" | tr '.' '/')"

# ---------- 2) Fuentes ----------
log "Preparando fuentes..."
mkdir -p fonts
for f in open_sans.ttf open_sans_regular.ttf; do
  [ -f "$f" ] && cp "$f" "fonts/$f" || true
done

# ---------- 3) Web ----------
log "Preparando www/..."
rm -rf www android ios
mkdir -p www
cp index.html www/
[ -f logo.png ]   && cp logo.png www/   || true
[ -f banner.png ] && cp banner.png www/ || true

# ---------- 4) Android ----------
log "Creando proyecto Android..."
npx cap add android

# ---------- 5) iOS ----------
IOS_READY=0
if npx cap add ios; then
  IOS_READY=1
  log "Proyecto iOS creado."
  IOS_PLIST="ios/App/App/Info.plist"
  if [ -f "$IOS_PLIST" ]; then
    python3 - "$IOS_PLIST" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1]); s = p.read_text(encoding="utf-8")
if "NSAppTransportSecurity" not in s:
    block = ("\t<key>NSAppTransportSecurity</key>\n\t<dict>\n"
             "\t\t<key>NSAllowsArbitraryLoads</key>\n\t\t<true/>\n\t</dict>\n")
    s = s.replace("</dict>", block + "</dict>", 1)
    p.write_text(s, encoding="utf-8")
PY
  fi
else
  log "AVISO: iOS no creado en este entorno."
fi

# ---------- 6) Recursos ----------
if [ -f glystv-res.zip ]; then
  log "Descomprimiendo glystv-res.zip..."
  unzip -oq glystv-res.zip -d android/app/src/main/res
fi

MAN=android/app/src/main/AndroidManifest.xml
GRADLE=android/app/build.gradle

# ---------- 7) Java ----------
log "Escribiendo clases Java en $PKG_PATH..."
mkdir -p "$PKG_PATH"

cat > "$PKG_PATH/MainActivity.java" <<'JAVA'
package __APP_ID__;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(NativePlayerPlugin.class);
    registerPlugin(RemoteSetupPlugin.class);
    super.onCreate(savedInstanceState);
  }

  @Override
  public void onBackPressed() {
    NativePlayerPlugin p = NativePlayerPlugin.instance;
    if (p != null && p.handleBack()) return;
    try {
      android.webkit.WebView wv = getBridge().getWebView();
      if (wv != null && wv.canGoBack()) { wv.goBack(); return; }
    } catch (Exception e) { }
    new android.app.AlertDialog.Builder(this)
        .setTitle("Salir de GLYSTV")
        .setMessage("Quieres salir de la aplicacion?")
        .setPositiveButton("Si", (d, w) -> finishAffinity())
        .setNegativeButton("No", null)
        .show();
  }
}
JAVA
sed -i "s/__APP_ID__/$APP_ID/" "$PKG_PATH/MainActivity.java"

# Extraer plugins del build.sh viejo si existen
for J in PlayerActivity NativePlayerPlugin RemoteSetupPlugin; do
  if [ -f "java/$J.java" ]; then
    sed "s/package com.glystv.app;/package $APP_ID;/" "java/$J.java" > "$PKG_PATH/$J.java"
    log "  - $J.java copiado de java/"
  elif [ -f "build-glystv-v3.sh.bak" ] && grep -q "$J.java" "build-glystv-v3.sh.bak"; then
    awk -v j="$J" '
      $0 ~ "cat > .*/" j "\\.java" {f=1; next}
      f && /^JAVA$/ {f=0; exit}
      f {print}
    ' "build-glystv-v3.sh.bak" | sed "s/package com.glystv.app;/package $APP_ID;/" > "$PKG_PATH/$J.java"
    log "  - $J.java extraido del script viejo"
  else
    die "Falta $J.java. Guardalo en java/$J.java (o restaura el build.sh viejo como build-glystv-v3.sh.bak)"
  fi
done

# ---------- 8) Assets ----------
mkdir -p android/app/src/main/assets/fonts
[ -d fonts ] && cp fonts/*.ttf android/app/src/main/assets/fonts/ 2>/dev/null || true
[ -f remote.html ] && cp remote.html android/app/src/main/assets/remote.html || true

# ---------- 9) Iconos ----------
if [ -f logo.png ]; then
  python3 -c "import PIL" 2>/dev/null || \
    python3 -m pip install --quiet pillow 2>/dev/null || \
    python3 -m pip install --quiet --break-system-packages pillow 2>/dev/null || true
  python3 - <<'ICONS' || log "AVISO: iconos por defecto"
from PIL import Image, ImageDraw
import glob, os
src = Image.open('logo.png').convert('RGB')
w, h = src.size
g = src.convert('L'); px = g.load()
def bright(y): return max(px[x, y] for x in range(w)) > 60
runs, st = [], None
for y in range(h):
    b = bright(y)
    if b and st is None: st = y
    if not b and st is not None: runs.append([st, y]); st = None
if st is not None: runs.append([st, h])
merged = []
for r in runs:
    if merged and r[0] - merged[-1][1] < h * 0.03: merged[-1][1] = r[1]
    else: merged.append(r)
y0, y1 = (merged[0] if len(merged)>=2 else (0, h))
band = src.crop((0, y0, w, y1))
bb = band.convert('L').point(lambda p: 255 if p > 60 else 0).getbbox()
emb = band.crop(bb) if bb else band
USE_ICONO = os.path.exists('icono.png')
if USE_ICONO: emb = Image.open('icono.png').convert('RGB')
def icon(size, frac, circle=False):
    im = Image.new('RGB', (size, size), (3, 10, 20) if USE_ICONO else (0, 0, 0))
    e = emb.copy(); k = size * frac / max(e.size)
    e = e.resize((max(1, int(e.width * k)), max(1, int(e.height * k))), Image.LANCZOS)
    im.paste(e, ((size - e.width)//2, (size - e.height)//2))
    if circle:
        m = Image.new('L', (size, size), 0)
        ImageDraw.Draw(m).ellipse((0, 0, size-1, size-1), fill=255)
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        out.paste(im, (0, 0), m); return out
    return im
legacy = {'mdpi':48,'hdpi':72,'xhdpi':96,'xxhdpi':144,'xxxhdpi':192}
fore   = {'mdpi':108,'hdpi':162,'xhdpi':216,'xxhdpi':324,'xxxhdpi':432}
res = 'android/app/src/main/res/'
for d in legacy:
    base = res + 'mipmap-' + d + '/'
    if glob.glob(base):
        icon(legacy[d], 1.0 if USE_ICONO else 0.78).save(base + 'ic_launcher.png')
        icon(legacy[d], 0.92 if USE_ICONO else 0.70, True).save(base + 'ic_launcher_round.png')
        icon(fore[d], 0.60 if USE_ICONO else 0.50).save(base + 'ic_launcher_foreground.png')
print('iconos ok')
ICONS
  BGXML=android/app/src/main/res/values/ic_launcher_background.xml
  [ -f "$BGXML" ] && sed -i -E 's#(<color name="ic_launcher_background">)[^<]*(</color>)#\1\#030A14\2#' "$BGXML" || true
fi

# ---------- 10) Manifest ----------
log "Parcheando AndroidManifest..."
sed -i 's#<application#<application android:usesCleartextTraffic="true"#' "$MAN"
sed -i 's#</application>#    <activity android:name=".PlayerActivity" android:exported="false" android:configChanges="orientation|screenSize|keyboardHidden|screenLayout|smallestScreenSize" android:theme="@android:style/Theme.Black.NoTitleBar.Fullscreen" />\n    </application>#' "$MAN"

python3 - "$MAN" <<'TVPY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
if 'android.software.leanback' not in s:
    s = s.replace('<application',
        '<uses-feature android:name="android.hardware.touchscreen" android:required="false"/>\n'
        '    <uses-feature android:name="android.software.leanback" android:required="false"/>\n'
        '    <application', 1)
if 'LEANBACK_LAUNCHER' not in s:
    s = s.replace('<category android:name="android.intent.category.LAUNCHER" />',
        '<category android:name="android.intent.category.LAUNCHER" />\n'
        '                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />', 1)
open(p, 'w', encoding='utf-8').write(s)
print('manifest TV ok')
TVPY

# ---------- 11) Banner TV ----------
if [ -f banner.png ]; then
  RESB=android/app/src/main/res
  mkdir -p "$RESB/drawable-xhdpi" "$RESB/drawable-mdpi"
  cp banner.png "$RESB/drawable-xhdpi/banner.png"
  python3 - "$MAN" <<'BANNERPY' || log "AVISO: banner no preparado"
import sys, re
from PIL import Image
Image.open('banner.png').convert('RGB').resize((320,180), Image.LANCZOS).save('android/app/src/main/res/drawable-mdpi/banner.png')
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
if 'android:banner=' in s:
    s = re.sub(r'android:banner="[^"]*"', 'android:banner="@drawable/banner"', s)
else:
    s = s.replace('<application', '<application android:banner="@drawable/banner"', 1)
open(p, 'w', encoding='utf-8').write(s)
print('banner ok')
BANNERPY
fi

# ---------- 12) Gradle (Corregido sin BOM) ----------
log "Parcheando build.gradle..."
sed -i '/^dependencies {/a\    implementation "androidx.media3:media3-exoplayer:1.4.1"\n    implementation "androidx.media3:media3-exoplayer-hls:1.4.1"\n    implementation "androidx.media3:media3-exoplayer-dash:1.4.1"\n    implementation "androidx.media3:media3-exoplayer-smoothstreaming:1.4.1"\n    implementation "androidx.media3:media3-exoplayer-rtsp:1.4.1"\n    implementation "androidx.media3:media3-ui:1.4.1"\n    implementation "org.jellyfin.media3:media3-ffmpeg-decoder:1.4.1+1"' "$GRADLE"

if [ -f proguard-rules.pro ]; then
  cp proguard-rules.pro android/app/proguard-rules.pro
  grep -q 'proguard-rules.pro' "$GRADLE" || \
    sed -i 's#buildTypes {#buildTypes {\n        release {\n            minifyEnabled true\n            proguardFiles getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"\n        }#' "$GRADLE"
fi

# ---------- 13) patch_tv ----------
[ -f patch_tv.py ] && python3 patch_tv.py . || true

# ---------- 14) Sync ----------
log "Sincronizando Capacitor..."
npx cap sync android
if [ "$IOS_READY" -eq 1 ] && [ -d ios ]; then
  npx cap sync ios || log "AVISO: sync iOS fallo"
fi

# ---------- 15) Compilar ----------
log "Compilando APK..."
cd android
chmod +x gradlew
if ./gradlew assembleDebug --no-daemon 2>&1 | tee /tmp/gradle1.log; then
  log "Compilacion con FFmpeg OK"
else
  log "Fallo con FFmpeg. Reintentando SIN FFmpeg..."
  grep -n -E "error:|What went wrong|Execution failed|Could not (resolve|find|get)|FAILED|Duplicate class" -A4 /tmp/gradle1.log | head -80 || true
  sed -i '/media3-ffmpeg-decoder/d' app/build.gradle
  ./gradlew assembleDebug --no-daemon
fi

APK=$(find . -name "app-debug.apk" | head -1)
[ -n "$APK" ] && log "APK generado: $APK" || die "No se genero APK"

log "Build completado."
