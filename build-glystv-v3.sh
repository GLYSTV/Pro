#!/usr/bin/env bash
set -euo pipefail

echo "🚀 [PASO 1/3] Compilando frontend profesional con Vite..."
# Esto instala las dependencias y compila tu código de forma optimizada,
# minificada y segura, generando la carpeta 'www' automáticamente.
npm install
npm run build

echo "📱 [PASO 2/3] Preparando proyecto Android/iOS con Capacitor..."
npx cap add android || true

# El proyecto iOS se prepara aquí; la compilación y firma final requieren macOS/Xcode.
IOS_READY=0
if npx cap add ios; then
  IOS_READY=1
  echo "Proyecto iOS creado correctamente."
  IOS_PLIST="ios/App/App/Info.plist"
  if [ -f "$IOS_PLIST" ]; then
    python3 - "$IOS_PLIST" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text(encoding="utf-8")
if "NSAppTransportSecurity" not in s:
    marker = "</dict>"
    block = (
        "\t<key>NSAppTransportSecurity</key>\n"
        "\t<dict>\n"
        "\t\t<key>NSAllowsArbitraryLoads</key>\n"
        "\t\t<true/>\n"
        "\t</dict>\n"
    )
    s = s.replace(marker, block + marker, 1)
    p.write_text(s, encoding="utf-8")
PY
  fi
else
  echo "AVISO: no fue posible crear iOS en este entorno. Android continuará normalmente."
fi

echo "⚙️ [PASO 3/3] Inyectando código nativo profesional (ExoPlayer, TV, PRO)..."
unzip -oq glystv-res.zip -d android/app/src/main/res

PKG=android/app/src/main/java/com/glystv/app
MAN=android/app/src/main/AndroidManifest.xml

# ... (AQUÍ VA TODO EL RESTO DE TU CÓDIGO ORIGINAL DE INYECCIÓN JAVA, MANIFEST, GRADLE, ETC.) ...
# Copia y pega exactamente desde "cat > $PKG/MainActivity.java <<'JAVA'" 
# hasta el final de tu script original "build-glystv-v3.sh".
# ¡NO LO BORRES! Es lo que hace que tu reproductor nativo y las funciones de TV funcionen.

# Al final del script, la compilación de Android:
cd android
chmod +x gradlew
if ./gradlew assembleDebug --no-daemon 2>&1 | tee /tmp/gradle1.log; then
  echo "✅ Compilación Android exitosa con FFmpeg"
else
  echo "AVISO: la compilación con FFmpeg falló; se compila SIN FFmpeg"
  sed -i '/media3-ffmpeg-decoder/d' app/build.gradle
  ./gradlew assembleDebug --no-daemon
fi
