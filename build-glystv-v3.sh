#!/usr/bin/env bash
set -euo pipefail

log(){ printf "\n[%s] %s\n" "$(date +%H:%M:%S)" "$*"; }
die(){ printf "\nERROR: %s\n" "$*" >&2; exit 1; }

log "Validando dependencias..."
command -v npx >/dev/null     || die "Falta npx"
command -v python3 >/dev/null || die "Falta python3"
command -v unzip >/dev/null   || die "Falta unzip"
[ -f index.html ]              || die "Falta index.html"
[ -f capacitor.config.json ]   || die "Falta capacitor.config.json"
[ -f build-glystv-v3.sh.bak ]  || die "FALTA build-glystv-v3.sh.bak"

APP_ID=$(python3 -c "import json;print(json.load(open('capacitor.config.json'))['appId'])" 2>/dev/null || echo "")
PKG_PATH="android/app/src/main/java/$(echo "$APP_ID" | tr '.' '/')"

mkdir -p fonts
for f in open_sans.ttf open_sans_regular.ttf; do
  [ -f "$f" ] && cp "$f" "fonts/$f" || true
done

rm -rf www android ios
mkdir -p www
cp index.html www/
[ -f logo.png ]   && cp logo.png www/   || true
[ -f banner.png ] && cp banner.png www/ || true

npx cap add android

IOS_READY=0
if npx cap add ios; then
  IOS_READY=1
  IOS_PLIST="ios/App/App/Info.plist"
  if [ -f "$IOS_PLIST" ]; then
    python3 - "$IOS_PLIST" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1]); s = p.read_text(encoding="utf-8")
if "NSAppTransportSecurity" not in s:
    block = ("\t<key>NSAppTransportSecurity</key>\n\t<dict>\n\t\t<key>NSAllowsArbitraryLoads</key>\n\t\t<true/>\n\t</dict>\n")
    s = s.replace("</dict>", block + "</dict>", 1)
    p.write_text(s, encoding="utf-8")
PY
  fi
fi

if [ -f glystv-res.zip ]; then
  unzip -oq glystv-res.zip -d android/app/src/main/res
fi

MAN=android/app/src/main/AndroidManifest.xml
GRADLE=android/app/build.gradle
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
    new android.app.AlertDialog.Builder(this).setTitle("Salir").setMessage("Quieres salir?").setPositiveButton("Si", (d, w) -> finishAffinity()).setNegativeButton("No", null).show();
  }
}
JAVA
sed -i "s/__APP_ID__/$APP_ID/" "$PKG_PATH/MainActivity.java"

python3 - "$PKG_PATH" "$APP_ID" <<'PY'
import sys, os, re
pkg_path, app_id = sys.argv[1], sys.argv[2]
content = open("build-glystv-v3.sh.bak", encoding="utf-8").read()
files = {
    "PlayerActivity.java": r"cat > \$PKG/PlayerActivity\.java <<'JAVA'(.*?)^JAVA$",
    "NativePlayerPlugin.java": r"cat > \$PKG/NativePlayerPlugin\.java <<'JAVA'(.*?)^JAVA$",
    "RemoteSetupPlugin.java": r"cat > \$PKG/RemoteSetupPlugin\.java <<'RSJAVA'(.*?)^RSJAVA$"
}
for name, pat in files.items():
    m = re.search(pat, content, re.S | re.M)
    if not m:
        print(f"ERROR: no se encontro {name} en .bak"); sys.exit(1)
    code = m.group(1).strip().replace("package com.glystv.app;", f"package {app_id};")
    open(os.path.join(pkg_path, name), "w", encoding="utf-8").write(code)
    print(f"  - {name} extraido")
PY

mkdir -p android/app/src/main/assets/fonts
cp fonts/*.ttf android/app/src/main/assets/fonts/ 2>/dev/null || true
[ -f remote.html ] && cp remote.html android/app/src/main/assets/remote.html || true

if [ -f logo.png ]; then
  python3 - <<'ICONS' || true
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
for d in legacy:
    base = 'android/app/src/main/res/mipmap-' + d + '/'
    if glob.glob(base):
        icon(legacy[d], 1.0 if USE_ICONO else 0.78).save(base + 'ic_launcher.png')
        icon(legacy[d], 0.92 if USE_ICONO else 0.70, True).save(base + 'ic_launcher_round.png')
        icon(fore[d], 0.60 if USE_ICONO else 0.50).save(base + 'ic_launcher_foreground.png')
ICONS
fi

sed -i 's#<application#<application android:usesCleartextTraffic="true"#' "$MAN"
sed -i 's#</application>#    <activity android:name=".PlayerActivity" android:exported="false" android:configChanges="orientation|screenSize|keyboardHidden|screenLayout|smallestScreenSize" android:theme="@android:style/Theme.Black.NoTitleBar.Fullscreen" />\n    </application>#' "$MAN"

python3 - "$MAN" <<'TVPY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
if 'android.software.leanback' not in s:
    s = s.replace('<application','<uses-feature android:name="android.hardware.touchscreen" android:required="false"/>\n<uses-feature android:name="android.software.leanback" android:required="false"/>\n<application', 1)
if 'LEANBACK_LAUNCHER' not in s:
    s = s.replace('<category android:name="android.intent.category.LAUNCHER" />','<category android:name="android.intent.category.LAUNCHER" />\n<category android:name="android.intent.category.LEANBACK_LAUNCHER" />', 1)
open(p, 'w', encoding='utf-8').write(s)
TVPY

if [ -f banner.png ]; then
  mkdir -p android/app/src/main/res/drawable-xhdpi android/app/src/main/res/drawable-mdpi
  cp banner.png android/app/src/main/res/drawable-xhdpi/banner.png
  python3 - "$MAN" <<'BANNERPY' || true
import sys, re
from PIL import Image
Image.open('banner.png').convert('RGB').resize((320,180), Image.LANCZOS).save('android/app/src/main/res/drawable-mdpi/banner.png')
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
if 'android:banner=' in s:
    s = re.sub(r'android:banner="[^"]*"', 'android:banner="@drawable/banner"', s)
else:
    s = s.replace('<application', '<application android:banner="@drawable/banner"', 1)
open(p, 'w', encoding='utf-8').write(s)
BANNERPY
fi

sed -i '/^dependencies {/a\    implementation "androidx.media3:media3-exoplayer:1.4.1"\n    implementation "androidx.media3:media3-exoplayer-hls:1.4.1"\n    implementation "androidx.media3:media3-exoplayer-dash:1.4.1"\n    implementation "androidx.media3:media3-exoplayer-smoothstreaming:1.4.1"\n    implementation "androidx.media3:media3-exoplayer-rtsp:1.4.1"\n    implementation "androidx.media3:media3-ui:1.4.1"\n    implementation "org.jellyfin.media3:media3-ffmpeg-decoder:1.4.1+1"' "$GRADLE"

if [ -f proguard-rules.pro ]; then
  cp proguard-rules.pro android/app/proguard-rules.pro
  grep -q 'proguard-rules.pro' "$GRADLE" || sed -i 's#buildTypes {#buildTypes {\n        release {\n            minifyEnabled true\n            proguardFiles getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"\n        }#' "$GRADLE"
fi

[ -f patch_tv.py ] && python3 patch_tv.py . || true

npx cap sync android
if [ "$IOS_READY" -eq 1 ] && [ -d ios ]; then npx cap sync ios || true; fi

cd android
chmod +x gradlew
if ./gradlew assembleDebug --no-daemon 2>&1 | tee /tmp/gradle1.log; then
  log "Compilacion OK"
else
  sed -i '/media3-ffmpeg-decoder/d' app/build.gradle
  ./gradlew assembleDebug --no-daemon
fi
