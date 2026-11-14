#!/usr/bin/env bash
set -euo pipefail

# 1) Web de la app
rm -rf www android ios
mkdir www
cp index.html www/
# logo.png solo se usa para generar los iconos; no se copia a www (pesa 1.4 MB y la web no lo usa)
# hls.js en local para no depender del CDN en la TV (si falla, la app usa el CDN como respaldo)
curl -fsSL --max-time 40 https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.8/hls.min.js -o www/hls.min.js || { rm -f www/hls.min.js; echo "AVISO: no se pudo descargar hls.js; se usará el CDN"; }

# Poppins local: se descarga en la compilación (GitHub tiene internet). Si falla, se mantiene Google Fonts.
mkdir -p www/fonts
POP_OK=1
for w in Regular Medium SemiBold Bold ExtraBold; do
  curl -fsSL --max-time 40 "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-$w.ttf" -o "www/fonts/Poppins-$w.ttf" || POP_OK=0
done
if [ "$POP_OK" -eq 1 ]; then
python3 - <<'POPPY'
import re
p = 'www/index.html'
s = open(p, encoding='utf-8').read()
faces = ''.join("@font-face{font-family:'Poppins';font-weight:%d;font-style:normal;font-display:swap;src:url('fonts/Poppins-%s.ttf') format('truetype')}" % (w, n) for w, n in [(400,'Regular'),(500,'Medium'),(600,'SemiBold'),(700,'Bold'),(800,'ExtraBold')])
s = re.sub(r'<link rel="preconnect" href="https://fonts\.(googleapis|gstatic)\.com"[^>]*>', '', s)
s = re.sub(r'<link href="https://fonts\.googleapis\.com/css2[^>]*>', '', s)
s = s.replace('<style>', '<style>' + faces, 1)
open(p, 'w', encoding='utf-8').write(s)
print('Poppins local OK')
POPPY
else
  rm -rf www/fonts
  echo "AVISO: no se pudo descargar Poppins; se usa Google Fonts"
fi

# 2) Proyecto Android
npx cap add android

# 2.1) Proyecto iOS
# El proyecto iOS se prepara aquí; la compilación y firma final requieren macOS/Xcode.
IOS_READY=0
if npx cap add ios; then
  IOS_READY=1
  echo "Proyecto iOS creado correctamente."

  # Permitir fuentes HTTP si la aplicación IPTV las utiliza.
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
unzip -oq glystv-res.zip -d android/app/src/main/res
PKG=android/app/src/main/java/com/glystv/app
MAN=android/app/src/main/AndroidManifest.xml

cat > $PKG/MainActivity.java <<'JAVA'
package com.glystv.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    /* Diagnóstico: guarda el motivo de un cierre inesperado y lo muestra al volver a abrir */
    final android.content.SharedPreferences crashSp = getSharedPreferences("glystv_crash", MODE_PRIVATE);
    final Thread.UncaughtExceptionHandler oldHandler = Thread.getDefaultUncaughtExceptionHandler();
    Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
      try {
        java.io.StringWriter sw = new java.io.StringWriter();
        e.printStackTrace(new java.io.PrintWriter(sw));
        String st = sw.toString();
        if (st.length() > 2500) st = st.substring(0, 2500);
        crashSp.edit().putString("last", st).commit();
      } catch (Throwable x) { /* nada */ }
      if (oldHandler != null) oldHandler.uncaughtException(t, e);
    });
    registerPlugin(NativePlayerPlugin.class);
    registerPlugin(RemoteSetupPlugin.class);
    super.onCreate(savedInstanceState);
    try {
      String last = crashSp.getString("last", "");
      if (!last.isEmpty()) {
        crashSp.edit().remove("last").apply();
        new android.app.AlertDialog.Builder(this)
            .setTitle("Motivo del cierre anterior")
            .setMessage(last)
            .setPositiveButton("Cerrar", null)
            .show();
      }
    } catch (Throwable x) { /* nada */ }
  }

  @Override
  public void onBackPressed() {
    NativePlayerPlugin p = NativePlayerPlugin.instance;
    if (p != null && p.handleBack()) return;
    try {
      android.webkit.WebView wv = getBridge().getWebView();
      if (wv != null && wv.canGoBack()) {
        wv.goBack();
        return;
      }
    } catch (Exception e) { /* si falla, pregunta si quiere salir */ }
    new android.app.AlertDialog.Builder(this)
        .setTitle("Salir de GLYSTV")
        .setMessage("¿Quieres salir de la aplicación?")
        .setPositiveButton("Sí", (d, w) -> finishAffinity())
        .setNegativeButton("No", null)
        .show();
  }
}
JAVA

cat > $PKG/NativePlayerPlugin.java <<'JAVA'
package com.glystv.app;

import android.content.Intent;
import android.graphics.Color;
import android.view.Gravity;
import android.view.KeyEvent;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.ui.AspectRatioFrameLayout;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {
  static NativePlayerPlugin instance;
  static String[] chUrls = new String[0];
  static String[] chTitles = new String[0];
  static String[] chSids = new String[0];

  private ExoPlayer player;
  private PlayerView pview;
  private FrameLayout holder;
  private boolean full = false;
  private int rx = 0, ry = 0, rw = 400, rh = 225;
  private String curUrl = "";
  private boolean triedTs = false;

  /* Controles en pantalla completa (TV en vivo) */
  private LinearLayout ctl;
  private TextView tTitle, tAspect, tAudio, bFav, bFull;
  private String title = "";
  private boolean fav = false, muted = false;
  private int aspectMode = 0, audioIdx = -1;
  private String audioName = "";
  private static final String[] ASP = {"Normal", "Zoom", "Estirar"};
  private final Runnable hideCtl = new Runnable() {
    @Override public void run() {
      if (ctl != null) ctl.setVisibility(View.GONE);
      if (tTitle != null) tTitle.setVisibility(View.GONE);
      if (holder != null && full) holder.requestFocus();
    }
  };

  @Override
  public void load() {
    instance = this;
  }

  /* Avisa a la web que el reproductor nativo se cerró (para volver a la lista de episodios) */
  static void emitClosed() {
    try {
      if (instance != null) instance.notifyListeners("closed", new JSObject());
    } catch (Exception e) { /* opcional */ }
  }

  @PluginMethod
  public void play(PluginCall call) {
    String url = call.getString("url");
    if (url == null) { call.reject("Falta la url"); return; }
    Intent i = new Intent(getContext(), PlayerActivity.class);
    i.putExtra("url", url);
    i.putExtra("title", call.getString("title", ""));
    i.putExtra("urls", call.getString("urls", ""));
    i.putExtra("titles", call.getString("titles", ""));
    i.putExtra("idx", call.getInt("idx", 0));
    String cu = call.getString("chUrls", "");
    String ct = call.getString("chTitles", "");
    chUrls = (cu == null || cu.isEmpty()) ? new String[0] : cu.split("\\n");
    chTitles = (ct == null || ct.isEmpty()) ? new String[0] : ct.split("\\n", -1);
    String cs = call.getString("chSids", "");
    chSids = (cs == null || cs.isEmpty()) ? new String[0] : cs.split("\\n", -1);
    i.putExtra("chIdx", call.getInt("chIdx", -1));
    i.putExtra("epgSrv", call.getString("epgSrv", ""));
    i.putExtra("epgU", call.getString("epgU", ""));
    i.putExtra("epgP", call.getString("epgP", ""));
    i.putExtra("tf", call.getInt("tf", 24));
    getActivity().startActivity(i);
    call.resolve();
  }

  @PluginMethod
  public void preview(final PluginCall call) {
    final String url = call.getString("url");
    if (url == null) { call.reject("Falta la url"); return; }
    final int x = call.getInt("x", 0);
    final int y = call.getInt("y", 0);
    final int w = call.getInt("w", 400);
    final int h = call.getInt("h", 225);
    getActivity().runOnUiThread(() -> {
      try {
        ensurePlayer();
        String pt = call.getString("title");
        if (pt != null) title = pt;
        rx = x; ry = y; rw = w; rh = h;
        attach();
        if (!url.equals(curUrl)) {
          curUrl = url;
          triedTs = false;
          start(url);
        } else {
          player.play();
        }
        call.resolve();
      } catch (Exception e) {
        call.reject(String.valueOf(e.getMessage()));
      }
    });
  }

  @PluginMethod
  public void place(final PluginCall call) {
    final int x = call.getInt("x", 0);
    final int y = call.getInt("y", 0);
    final int w = call.getInt("w", 400);
    final int h = call.getInt("h", 225);
    getActivity().runOnUiThread(() -> {
      rx = x; ry = y; rw = w; rh = h;
      if (holder != null && holder.getParent() != null && !full) applyLayout();
      call.resolve();
    });
  }

  @PluginMethod
  public void fullscreen(final PluginCall call) {
    final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
    final String t = call.getString("title");
    final boolean hasFav = call.hasOption("fav");
    final boolean f = Boolean.TRUE.equals(call.getBoolean("fav", false));
    getActivity().runOnUiThread(() -> {
      if (t != null) title = t;
      if (hasFav) fav = f;
      setFull(on);
      call.resolve();
    });
  }

  @PluginMethod
  public void setFav(final PluginCall call) {
    final boolean f = Boolean.TRUE.equals(call.getBoolean("on", false));
    getActivity().runOnUiThread(() -> {
      fav = f;
      updateLabels();
      call.resolve();
    });
  }

  @PluginMethod
  public void hidePreview(final PluginCall call) {
    getActivity().runOnUiThread(() -> {
      hide();
      call.resolve();
    });
  }

  boolean handleBack() {
    if (full) {
      closeFull();
      return true;
    }
    return false;
  }

  @Override
  protected void handleOnPause() {
    if (player != null) player.pause();
  }

  @Override
  protected void handleOnDestroy() {
    if (player != null) {
      player.release();
      player = null;
    }
    instance = null;
  }

  private void ensurePlayer() {
    if (player != null) return;
    DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
        .setUserAgent("VLC/3.0.18 LibVLC/3.0.18")
        .setAllowCrossProtocolRedirects(true)
        .setConnectTimeoutMs(15000)
        .setReadTimeoutMs(15000);
    DefaultRenderersFactory rf = new DefaultRenderersFactory(getActivity())
        .setEnableDecoderFallback(true)
        .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER);
    player = new ExoPlayer.Builder(getActivity(), rf)
        .setMediaSourceFactory(new DefaultMediaSourceFactory(getActivity()).setDataSourceFactory(http))
        .build();
    player.addListener(new Player.Listener() {
      @Override
      public void onPlayerError(PlaybackException e) {
        JSObject o = new JSObject();
        o.put("message", describe(e));
        o.put("url", curUrl);
        notifyListeners("error", o);
      }
    });
    pview = new PlayerView(getActivity());
    pview.setUseController(false);
    pview.setPlayer(player);
    holder = new FrameLayout(getActivity());
    holder.setBackgroundColor(Color.BLACK);
    holder.addView(pview, new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    holder.setOnClickListener(v -> {
      if (full) {
        if (ctl != null && ctl.getVisibility() == View.VISIBLE) hideCtl.run();
        else showCtl();
      } else {
        notifyListeners("tap", new JSObject());
      }
    });
    holder.setOnKeyListener((v, code, ev) -> {
      if (full && ev.getAction() == KeyEvent.ACTION_DOWN && ctl != null
          && ctl.getVisibility() != View.VISIBLE && code != KeyEvent.KEYCODE_BACK) {
        showCtl();
        if (bFull != null) bFull.requestFocus();
        return true;
      }
      return false;
    });
    buildOverlay();
  }

  private void attach() {
    if (holder.getParent() == null) {
      ViewGroup root = getActivity().findViewById(android.R.id.content);
      root.addView(holder);
    }
    applyLayout();
  }

  private void applyLayout() {
    if (holder == null) return;
    FrameLayout.LayoutParams lp;
    if (full) {
      lp = new FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    } else {
      lp = new FrameLayout.LayoutParams(rw, rh);
      lp.gravity = Gravity.TOP | Gravity.START;
      lp.leftMargin = rx;
      lp.topMargin = ry;
    }
    holder.setLayoutParams(lp);
  }

  private void setFull(boolean on) {
    full = on;
    applyLayout();
    if (holder != null) holder.setFocusable(on);
    if (tTitle != null) {
      tTitle.setText(title);
      if (!on) tTitle.setVisibility(View.GONE);
    }
    if (ctl != null) {
      holder.removeCallbacks(hideCtl);
      if (on) {
        updateLabels();
        showCtl();
        if (bFull != null) bFull.requestFocus();
      } else {
        ctl.setVisibility(View.GONE);
      }
    }
    View d = getActivity().getWindow().getDecorView();
    if (on) {
      d.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
          | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    } else {
      d.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
    }
  }

  private void hide() {
    if (full) setFull(false);
    if (holder != null && holder.getParent() != null) {
      ((ViewGroup) holder.getParent()).removeView(holder);
    }
    if (player != null) {
      player.stop();
      player.clearMediaItems();
    }
    curUrl = "";
  }

  private void start(String url) {
    audioIdx = -1;
    audioName = "";
    try {
      player.setTrackSelectionParameters(player.getTrackSelectionParameters()
          .buildUpon().clearOverridesOfType(C.TRACK_TYPE_AUDIO).build());
    } catch (Exception e) { /* opcional */ }
    updateLabels();
    player.setMediaItem(MediaItem.fromUri(url));
    player.prepare();
    player.play();
  }

  /* ===== Controles de pantalla completa: Volver, Opciones, Pantalla, Favorito, Audio, Aspecto ===== */
  private android.graphics.drawable.Drawable btnBg(boolean focus, boolean hl) {
    android.graphics.drawable.GradientDrawable g = new android.graphics.drawable.GradientDrawable();
    g.setCornerRadius(26);
    if (focus) {
      g.setColor(Color.rgb(112, 40, 245));
      g.setStroke(4, Color.WHITE);
    } else if (hl) {
      g.setColor(Color.rgb(63, 24, 135));
      g.setStroke(2, Color.rgb(163, 76, 255));
    } else {
      g.setColor(Color.argb(215, 14, 22, 34));
      g.setStroke(2, Color.argb(150, 112, 76, 170));
    }
    return g;
  }

  private TextView mkBtn(String text, boolean hl) {
    TextView b = new TextView(getActivity());
    b.setText(text);
    b.setTextColor(Color.WHITE);
    b.setTextSize(16);
    b.setGravity(Gravity.CENTER);
    b.setSingleLine(true);
    b.setPadding(24, 22, 24, 22);
    b.setFocusable(true);
    b.setClickable(true);
    b.setTag(Boolean.valueOf(hl));
    b.setBackground(btnBg(false, hl));
    b.setOnFocusChangeListener((view, f) -> {
      view.setBackground(btnBg(f, Boolean.TRUE.equals(view.getTag())));
      if (f) showCtl();
    });
    return b;
  }

  private LinearLayout.LayoutParams lp(int w, float wt, int m) {
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(w, ViewGroup.LayoutParams.WRAP_CONTENT, wt);
    p.setMargins(m, m, m, m);
    return p;
  }

  private void buildOverlay() {
    android.app.Activity a = getActivity();

    tTitle = new TextView(a);
    tTitle.setTextColor(Color.WHITE);
    tTitle.setTextSize(22);
    tTitle.setSingleLine(true);
    tTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
    tTitle.setShadowLayer(6, 2, 2, Color.BLACK);
    tTitle.setPadding(48, 32, 48, 64);
    tTitle.setBackground(new android.graphics.drawable.GradientDrawable(
        android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM,
        new int[]{Color.argb(225, 0, 0, 0), Color.TRANSPARENT}));
    tTitle.setVisibility(View.GONE);
    holder.addView(tTitle, new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));

    ctl = new LinearLayout(a);
    ctl.setOrientation(LinearLayout.VERTICAL);
    ctl.setPadding(40, 90, 40, 28);
    ctl.setBackground(new android.graphics.drawable.GradientDrawable(
        android.graphics.drawable.GradientDrawable.Orientation.BOTTOM_TOP,
        new int[]{Color.argb(235, 0, 0, 0), Color.TRANSPARENT}));
    ctl.setVisibility(View.GONE);

    LinearLayout pills = new LinearLayout(a);
    pills.setOrientation(LinearLayout.HORIZONTAL);
    pills.setGravity(Gravity.END);
    tAspect = mkBtn("", false);
    tAudio = mkBtn("", false);
    pills.addView(tAspect, lp(ViewGroup.LayoutParams.WRAP_CONTENT, 0f, 8));
    pills.addView(tAudio, lp(ViewGroup.LayoutParams.WRAP_CONTENT, 0f, 8));
    ctl.addView(pills, new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    TextView tTime = new TextView(a);
    tTime.setText("● EN VIVO");
    tTime.setTextColor(Color.rgb(255, 80, 90));
    tTime.setTextSize(16);
    tTime.setShadowLayer(4, 1, 1, Color.BLACK);
    tTime.setPadding(12, 12, 12, 12);
    ctl.addView(tTime, new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    LinearLayout row = new LinearLayout(a);
    row.setOrientation(LinearLayout.HORIZONTAL);
    TextView bBack = mkBtn("‹ Volver", false);
    TextView bOpt = mkBtn("⚙ Opciones", false);
    bFull = mkBtn("⛶ Pantalla", true);
    bFav = mkBtn("☆ Favorito", false);
    row.addView(bBack, lp(0, 1f, 8));
    row.addView(bOpt, lp(0, 1f, 8));
    row.addView(bFull, lp(0, 1f, 8));
    row.addView(bFav, lp(0, 1f, 8));
    ctl.addView(row, new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    bBack.setOnClickListener(view -> closeFull());
    bFull.setOnClickListener(view -> closeFull());
    bOpt.setOnClickListener(view -> showOptions());
    bFav.setOnClickListener(view -> {
      notifyListeners("fav", new JSObject());
      showCtl();
    });
    tAspect.setOnClickListener(view -> cycleAspect());
    tAudio.setOnClickListener(view -> cycleAudio());

    holder.addView(ctl, new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));
    updateLabels();
  }

  private void showCtl() {
    if (ctl == null || holder == null) return;
    ctl.setVisibility(View.VISIBLE);
    if (tTitle != null && full) tTitle.setVisibility(View.VISIBLE);
    holder.removeCallbacks(hideCtl);
    holder.postDelayed(hideCtl, 5000);
  }

  private void closeFull() {
    setFull(false);
    JSObject o = new JSObject();
    o.put("on", false);
    notifyListeners("fullscreen", o);
  }

  private void updateLabels() {
    if (tAspect != null) tAspect.setText("▣ " + ASP[aspectMode]);
    if (tAudio != null) {
      tAudio.setText(muted ? "🔇 Silenciado"
          : "🔊 " + (audioName.isEmpty() ? "Audio Automática" : audioName));
    }
    if (bFav != null) bFav.setText(fav ? "★ Favorito" : "☆ Favorito");
  }

  private void cycleAspect() {
    aspectMode = (aspectMode + 1) % ASP.length;
    if (pview != null) {
      int m = aspectMode == 1 ? AspectRatioFrameLayout.RESIZE_MODE_ZOOM
          : aspectMode == 2 ? AspectRatioFrameLayout.RESIZE_MODE_FILL
          : AspectRatioFrameLayout.RESIZE_MODE_FIT;
      pview.setResizeMode(m);
    }
    updateLabels();
    showCtl();
  }

  private void toggleMute() {
    muted = !muted;
    if (player != null) player.setVolume(muted ? 0f : 1f);
    updateLabels();
    showCtl();
  }

  private void cycleAudio() {
    if (player == null) return;
    java.util.ArrayList<Tracks.Group> au = new java.util.ArrayList<>();
    for (Tracks.Group g : player.getCurrentTracks().getGroups()) {
      if (g.getType() == C.TRACK_TYPE_AUDIO && g.length > 0 && g.isTrackSupported(0)) au.add(g);
    }
    if (au.size() < 2) {
      toggleMute();
      return;
    }
    audioIdx = (audioIdx + 1) % au.size();
    Tracks.Group g = au.get(audioIdx);
    player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
        .setOverrideForType(new TrackSelectionOverride(g.getMediaTrackGroup(), 0)).build());
    Format f = g.getTrackFormat(0);
    audioName = f.label != null ? f.label : (f.language != null ? f.language : "Pista " + (audioIdx + 1));
    if (muted) { muted = false; player.setVolume(1f); }
    updateLabels();
    showCtl();
  }

  private void showOptions() {
    showCtl();
    final String[] items = {
        "Relación de aspecto: " + ASP[aspectMode],
        "Audio: " + (audioName.isEmpty() ? "Automática" : audioName),
        muted ? "Activar sonido" : "Silenciar"
    };
    new android.app.AlertDialog.Builder(getActivity())
        .setTitle("Opciones")
        .setItems(items, (d, which) -> {
          if (which == 0) cycleAspect();
          else if (which == 1) cycleAudio();
          else toggleMute();
        })
        .show();
  }

  private static String describe(PlaybackException e) {
    Throwable c = e.getCause();
    if (c instanceof HttpDataSource.InvalidResponseCodeException) {
      return "HTTP " + ((HttpDataSource.InvalidResponseCodeException) c).responseCode;
    }
    return e.getErrorCodeName();
  }
}
JAVA

cat > $PKG/PlayerActivity.java <<'JAVA'
package com.glystv.app;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.Tracks;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

public class PlayerActivity extends Activity {
  private ExoPlayer player;
  private TextView status;
  private String url;
  private boolean retried = false;
  private boolean audioOff = false;
  private boolean triedTs = false;
  private String errLog = "";
  private boolean sniffed = false;
  private boolean altTried = false;
  private boolean altLaunched = false;
  private String firstUrl = null;
  private int playSeq = 0;
  private String lastMime = "";
  private boolean prefDone = false;
  private boolean slowRetried = false;
  private int stepSeq = 0;
  private final java.util.HashSet<String> triedUrls = new java.util.HashSet<>();
  private String firstInfo = "";
  private final Runnable clear = () -> status.setText("");

  private static final int ACCENT = Color.rgb(112, 40, 245);
  private long t0 = 0;
  private String retryInfo = "";
  private int nRetries = 0;
  private static final String PREFS = "glystv_resume";
  private String resumeKey = "";
  private String resumeNote = "";
  private TextView ttlView;
  private PlayerView pvRef;
  private FrameLayout rootRef;
  private View zoomBtn;
  private TextView nextBtn;
  private String[] qUrls = new String[0];
  private String[] qTitles = new String[0];
  private int qIdx = 0;
  private int skipMs = 10000;
  private int chIdx = -1;
  private android.widget.LinearLayout epgBox;
  private TextView epgL1, epgL2, epgL3;
  private android.widget.ProgressBar epgBar;
  private String epgSrv = "", epgU = "", epgP = "";
  private int tfFmt = 24;
  private int epgSeq = 0;
  private final java.util.concurrent.ConcurrentHashMap<String, String> epgJson = new java.util.concurrent.ConcurrentHashMap<>();
  private final java.util.concurrent.ConcurrentHashMap<String, Long> epgAt = new java.util.concurrent.ConcurrentHashMap<>();
  private final Runnable epgHide = () -> { if (epgBox != null) epgBox.setVisibility(View.GONE); };
  private long okDownAt = 0;
  private boolean okArmed = false, okLong = false;
  private final android.os.Handler uiH = new android.os.Handler(android.os.Looper.getMainLooper());
  private Runnable sleepR;

  @Override
  protected void onCreate(Bundle b) {
    super.onCreate(b);

    getWindow().addFlags(
        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

    getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_FULLSCREEN |
        View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
        View.SYSTEM_UI_FLAG_LAYOUT_STABLE);

    url = getIntent().getStringExtra("url");
    resumeKey = "p" + (url == null ? 0 : url.hashCode());
    String title = getIntent().getStringExtra("title");

    FrameLayout root = new FrameLayout(this);
    root.setBackgroundColor(Color.BLACK);

    PlayerView pv = new PlayerView(this);
    pv.setUseController(true);
    pv.setControllerShowTimeoutMs(3500);
    pv.setControllerHideOnTouch(true);
    pv.setControllerAutoShow(true);
    pv.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING);
    /* Solo un botón central (pausa/play). Atrasar/adelantar se hace con el mando del TV */
    pv.setShowPreviousButton(false);
    pv.setShowNextButton(false);
    pv.setShowRewindButton(false);
    pv.setShowFastForwardButton(false);

    rootRef = root;
    root.setFocusable(true);
    root.setFocusableInTouchMode(true);

    root.addView(pv,
        new FrameLayout.LayoutParams(-1, -1));

    status = new TextView(this);
    status.setTextColor(Color.WHITE);
    status.setTextSize(14);
    try {
      status.setTypeface(android.graphics.Typeface.createFromAsset(
          getAssets(), "fonts/open_sans.ttf"));
    } catch (Exception e) { /* si falta la fuente, usa la del sistema */ }
    status.setPadding(32, 24, 32, 24);
    status.setShadowLayer(5, 2, 2, Color.BLACK);
    status.setText("");

    final TextView ttl = new TextView(this);
    ttlView = ttl;
    parseQueue();
    ttl.setTextColor(Color.WHITE);
    ttl.setTextSize(20);
    ttl.setSingleLine(true);
    ttl.setEllipsize(android.text.TextUtils.TruncateAt.END);
    try {
      ttl.setTypeface(android.graphics.Typeface.createFromAsset(
          getAssets(), "fonts/open_sans.ttf"));
    } catch (Exception e) { /* si falta la fuente, usa la del sistema */ }
    ttl.setShadowLayer(6, 2, 2, Color.BLACK);
    ttl.setPadding(32, 24, 32, 12);
    ttl.setText(title == null ? "" : title);
    root.addView(ttl,
        new FrameLayout.LayoutParams(
            -1, -2, Gravity.TOP | Gravity.START));
    pv.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) vis -> {
      ttl.setVisibility(vis == View.VISIBLE ? View.VISIBLE : View.GONE);
      if (vis == View.VISIBLE) showEpg();
      if (vis != View.VISIBLE && rootRef != null) rootRef.requestFocus();
    });

    buildEpgBox(root);

    FrameLayout.LayoutParams stLp =
        new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.START);
    stLp.topMargin = 90;
    root.addView(status, stLp);
    /* Oculta los registros técnicos de reintentos; el usuario solo ve el reproductor. */
    status.setVisibility(View.GONE);

    setContentView(root);

    pv.post(() -> {
      applyCinemaStyle(pv);
      addZoomButton(pv, root);
      pvRef = pv;
      addExtraButtons(pv, root);
      simplifyControls(pv);
    });

    DefaultHttpDataSource.Factory http =
        new DefaultHttpDataSource.Factory()
            .setUserAgent("VLC/3.0.18 LibVLC/3.0.18")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(12000)
            .setReadTimeoutMs(15000);

    DefaultRenderersFactory rf =
        new DefaultRenderersFactory(this)
            .setEnableDecoderFallback(true)
            .setExtensionRendererMode(
                DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER);

    /* Arranque más rápido: empieza con 0,5 s de vídeo en buffer (antes 2,5 s) */
    androidx.media3.exoplayer.DefaultLoadControl lc =
        new androidx.media3.exoplayer.DefaultLoadControl.Builder()
            .setBufferDurationsMs(15000, 50000, 1000, 2500)
            .build();

    player = new ExoPlayer.Builder(this, rf)
        .setSeekBackIncrementMs(skipMs)
        .setSeekForwardIncrementMs(skipMs)
        .setLoadControl(lc)
        .setMediaSourceFactory(
            new DefaultMediaSourceFactory(this)
                .setDataSourceFactory(http))
        .build();

    pv.setPlayer(player);

    /* Recuerda el idioma de audio y subtítulos elegido la última vez */
    try {
      android.content.SharedPreferences sp = getSharedPreferences("glystv_prefs", MODE_PRIVATE);
      String al = sp.getString("aud_lang", "");
      String sl = sp.getString("sub_lang", "");
      androidx.media3.common.TrackSelectionParameters.Builder tb =
          player.getTrackSelectionParameters().buildUpon();
      if (!al.isEmpty()) tb.setPreferredAudioLanguage(al);
      if (sl.equals("off")) tb.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true);
      else if (!sl.isEmpty()) tb.setPreferredTextLanguage(sl);
      player.setTrackSelectionParameters(tb.build());
    } catch (Exception e) { /* opcional */ }

    player.addListener(new Player.Listener() {

      @Override
      public void onPlayerError(PlaybackException e) {
        String info = describe(e);
        status.removeCallbacks(clear);
        errLog += "\n- " + extOf(url) + ": " + (info.length() > 75 ? info.substring(0, 75) : info);
        /* Audio que este TV no puede decodificar (ej. MP3): sigue con vídeo, sin sonido */
        if (!audioOff && isAudioDecodeError(e, info)) {
          audioOff = true;
          player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
              .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true).build());
          player.prepare();
          player.play();
          status.setText("El vídeo se está reproduciendo sin sonido en este televisor.");
          status.postDelayed(clear, 15000);
          return;
        }
        /* Formato distinto al esperado: detecta el real leyendo los primeros bytes del servidor */
        if (!sniffed && isFormatError(e)) {
          sniffed = true;
          status.setText("Detectando el formato real del canal…");
          sniffFormat(url, playSeq, info);
          return;
        }
        failNext(info);
      }

      @Override
      public void onPlaybackStateChanged(int st) {
        if (st == Player.STATE_ENDED && qIdx + 1 < qUrls.length) playNext();
      }

      @Override
      public void onRenderedFirstFrame() {
        rememberFormat();
        long sec10 = (android.os.SystemClock.elapsedRealtime() - t0) / 100;
        status.setText("Reproducción iniciada" + resumeNote);
        status.removeCallbacks(clear);
        status.postDelayed(clear, 25000);
      }

      @Override
      public void onTracksChanged(Tracks tracks) {
        if (tracks.getGroups().isEmpty()) return;

        StringBuilder sb = new StringBuilder();

        for (Tracks.Group g : tracks.getGroups()) {
          if (g.getType() == C.TRACK_TYPE_AUDIO) {
            for (int i = 0; i < g.length; i++) {
              sb.append(g.getTrackFormat(i).sampleMimeType)
                .append(g.isTrackSupported(i)
                    ? " ok " : " SIN-SOPORTE ");
            }
          }
        }

        /* Los datos de códecs no se muestran sobre el vídeo. */
        status.setText("");
        status.removeCallbacks(clear);
      }
    });

    player.addAnalyticsListener(new androidx.media3.exoplayer.analytics.AnalyticsListener() {
      @Override
      public void onLoadError(
          androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime eventTime,
          androidx.media3.exoplayer.source.LoadEventInfo loadEventInfo,
          androidx.media3.exoplayer.source.MediaLoadData mediaLoadData,
          java.io.IOException error,
          boolean wasCanceled) {
        long sec = (android.os.SystemClock.elapsedRealtime() - t0) / 1000;
        Throwable why = error.getCause() != null ? error.getCause() : error;
        String msg = why.getClass().getSimpleName() + ": " + String.valueOf(why.getMessage());
        if (msg.length() > 90) msg = msg.substring(0, 90);
        nRetries++;
        /* Ocultar excepciones y registros técnicos durante la reproducción. */
        status.setText("Conexión inestable. Reconectando…");
      }
    });

    start();
    showEpg();
  }

  private int aspectMode = 0;
  private static final String[] ASP = {"Normal", "Zoom", "Estirar"};

  /* Botón Zoom junto al engranaje de ajustes: Normal / Zoom / Estirar */
  private void addZoomButton(PlayerView pv, FrameLayout root) {
    final TextView z = new TextView(this);
    zoomBtn = z;
    z.setText("▣ Normal");
    z.setTextColor(ACCENT);
    z.setTextSize(14);
    z.setGravity(Gravity.CENTER);
    z.setPadding(24, 12, 24, 12);
    z.setFocusable(true);
    z.setClickable(true);
    z.setOnFocusChangeListener((view, f) ->
        z.setBackgroundColor(f ? Color.argb(120, 112, 40, 245) : Color.TRANSPARENT));
    z.setOnClickListener(view -> {
      aspectMode = (aspectMode + 1) % ASP.length;
      pv.setResizeMode(aspectMode == 1 ? AspectRatioFrameLayout.RESIZE_MODE_ZOOM
          : aspectMode == 2 ? AspectRatioFrameLayout.RESIZE_MODE_FILL
          : AspectRatioFrameLayout.RESIZE_MODE_FIT);
      z.setText("▣ " + ASP[aspectMode]);
    });
    int sid = getResources().getIdentifier("exo_settings", "id", getPackageName());
    View st = sid == 0 ? null : pv.findViewById(sid);
    if (st != null && st.getParent() instanceof android.widget.LinearLayout) {
      android.widget.LinearLayout p = (android.widget.LinearLayout) st.getParent();
      p.addView(z, p.indexOfChild(st));
    } else {
      root.addView(z, new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.END));
    }
  }

  /* Deja solo el botón central pausa/play, sin cuadro amarillo de foco */
  private void simplifyControls(PlayerView pv) {
    String[] hide = {"exo_prev", "exo_next", "exo_rew", "exo_ffwd",
        "exo_rew_with_amount", "exo_ffwd_with_amount"};
    for (String name : hide) {
      int id = getResources().getIdentifier(name, "id", getPackageName());
      View v = id == 0 ? null : pv.findViewById(id);
      if (v != null) v.setVisibility(View.GONE);
    }
    String[] noFocus = {"exo_play_pause", "exo_play", "exo_pause", "exo_progress"};
    for (String name : noFocus) {
      int id = getResources().getIdentifier(name, "id", getPackageName());
      View v = id == 0 ? null : pv.findViewById(id);
      if (v == null) continue;
      v.setFocusable(false);
      v.setFocusableInTouchMode(false);
      if (android.os.Build.VERSION.SDK_INT >= 26) v.setDefaultFocusHighlightEnabled(false);
    }
    if (rootRef != null) rootRef.requestFocus();
  }

  /* Muestra los controles y pone el foco en los botones de abajo (Normal, Más, ajustes) */
  private void openBar() {
    if (pvRef == null || zoomBtn == null) return;
    pvRef.showController();
    zoomBtn.post(() -> zoomBtn.requestFocus());
  }

  /* ---- Franja con el programa actual (solo TV en vivo con servidor Xtream) ---- */
  private void buildEpgBox(FrameLayout root) {
    float dn = getResources().getDisplayMetrics().density;
    epgBox = new android.widget.LinearLayout(this);
    epgBox.setOrientation(android.widget.LinearLayout.VERTICAL);
    epgBox.setBackgroundColor(Color.argb(220, 11, 9, 21));
    epgBox.setPadding((int) (20 * dn), (int) (12 * dn), (int) (20 * dn), (int) (12 * dn));
    epgBox.setFocusable(false);
    android.graphics.Typeface tf = null;
    try { tf = android.graphics.Typeface.createFromAsset(getAssets(), "fonts/open_sans.ttf"); } catch (Exception e) { /* opcional */ }
    epgL1 = new TextView(this);
    epgL1.setTextColor(ACCENT);
    epgL1.setTextSize(14);
    epgL2 = new TextView(this);
    epgL2.setTextColor(Color.WHITE);
    epgL2.setTextSize(20);
    epgL2.setSingleLine(true);
    epgL2.setEllipsize(android.text.TextUtils.TruncateAt.END);
    epgL3 = new TextView(this);
    epgL3.setTextColor(Color.rgb(200, 205, 215));
    epgL3.setTextSize(14);
    epgL3.setMaxLines(2);
    epgL3.setEllipsize(android.text.TextUtils.TruncateAt.END);
    if (tf != null) { epgL1.setTypeface(tf); epgL2.setTypeface(tf); epgL3.setTypeface(tf); }
    epgBar = new android.widget.ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
    epgBar.setMax(100);
    epgBar.setProgressTintList(android.content.res.ColorStateList.valueOf(ACCENT));
    epgBar.setProgressBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.DKGRAY));
    epgBox.addView(epgL1);
    epgBox.addView(epgL2);
    epgBox.addView(epgBar, new android.widget.LinearLayout.LayoutParams(-1, (int) (6 * dn)));
    epgBox.addView(epgL3);
    int w = (int) (getResources().getDisplayMetrics().widthPixels * 0.6f);
    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(w, -2, Gravity.BOTTOM | Gravity.START);
    lp.leftMargin = (int) (24 * dn);
    lp.bottomMargin = (int) (110 * dn);
    epgBox.setVisibility(View.GONE);
    root.addView(epgBox, lp);
  }

  private String epgFetch(String sid) {
    try {
      String q = epgSrv + "/player_api.php?username=" + java.net.URLEncoder.encode(epgU, "UTF-8")
          + "&password=" + java.net.URLEncoder.encode(epgP, "UTF-8")
          + "&action=get_short_epg&stream_id=" + java.net.URLEncoder.encode(sid, "UTF-8") + "&limit=4";
      java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(q).openConnection();
      c.setConnectTimeout(5000);
      c.setReadTimeout(5000);
      c.setRequestProperty("User-Agent", "VLC/3.0.18 LibVLC/3.0.18");
      if (c.getResponseCode() != 200) return null;
      java.io.BufferedReader r = new java.io.BufferedReader(new java.io.InputStreamReader(c.getInputStream(), "UTF-8"));
      StringBuilder sb = new StringBuilder();
      String ln;
      while ((ln = r.readLine()) != null) sb.append(ln);
      r.close();
      return sb.toString();
    } catch (Exception e) {
      return null;
    }
  }

  private void showEpg() {
    if (!chMode() || epgSrv.isEmpty() || epgBox == null) return;
    String[] sd = NativePlayerPlugin.chSids;
    final String sid = chIdx < sd.length ? sd[chIdx] : "";
    if (sid.isEmpty()) return;
    final int my = ++epgSeq;
    new Thread(() -> {
      String js = epgJson.get(sid);
      Long at = epgAt.get(sid);
      if (js == null || at == null || System.currentTimeMillis() - at > 60000) {
        js = epgFetch(sid);
        if (js != null) { epgJson.put(sid, js); epgAt.put(sid, System.currentTimeMillis()); }
      }
      final String fjs = js;
      uiH.post(() -> { if (my == epgSeq) drawEpg(fjs); });
    }).start();
  }

  private String hm(long ts) {
    java.util.Calendar c = java.util.Calendar.getInstance();
    c.setTimeInMillis(ts * 1000L);
    int h = c.get(java.util.Calendar.HOUR_OF_DAY), m = c.get(java.util.Calendar.MINUTE);
    if (tfFmt == 12) return (h % 12 == 0 ? 12 : h % 12) + ":" + String.format(java.util.Locale.US, "%02d", m) + (h < 12 ? " AM" : " PM");
    return String.format(java.util.Locale.US, "%02d:%02d", h, m);
  }

  private String b64(String t) {
    try { return new String(android.util.Base64.decode(t, android.util.Base64.DEFAULT), "UTF-8"); }
    catch (Exception e) { return t; }
  }

  private void drawEpg(String js) {
    if (js == null || epgBox == null) return;
    try {
      org.json.JSONObject o = new org.json.JSONObject(js);
      org.json.JSONArray arr = o.optJSONArray("epg_listings");
      if (arr == null || arr.length() == 0) return;
      java.util.ArrayList<Object[]> L = new java.util.ArrayList<>();
      for (int i = 0; i < arr.length(); i++) {
        org.json.JSONObject x = arr.getJSONObject(i);
        long a = Long.parseLong(x.optString("start_timestamp", "0"));
        long z = Long.parseLong(x.optString("stop_timestamp", "0"));
        if (a > 0 && z > 0) L.add(new Object[]{a, z, b64(x.optString("title", ""))});
      }
      java.util.Collections.sort(L, (p, q) -> Long.compare((Long) p[0], (Long) q[0]));
      long now = System.currentTimeMillis() / 1000L;
      Object[] cur = null, nxt = null;
      for (Object[] x : L) {
        long a = (Long) x[0], z = (Long) x[1];
        if (a <= now && now < z) cur = x;
        else if (a > now && nxt == null) nxt = x;
      }
      if (cur == null && nxt == null) return;
      if (cur != null) {
        long a = (Long) cur[0], z = (Long) cur[1];
        epgL1.setText("EN VIVO   " + hm(a) + " - " + hm(z));
        epgL2.setText((String) cur[2]);
        epgBar.setVisibility(View.VISIBLE);
        epgBar.setProgress((int) Math.max(0, Math.min(100, (now - a) * 100 / (z - a))));
        long q = Math.max(1, (z - now + 59) / 60);
        String t = "Quedan " + q + " min";
        if (nxt != null) t += "     A continuación: " + nxt[2] + " · " + hm((Long) nxt[0]);
        epgL3.setText(t);
      } else {
        epgL1.setText("A CONTINUACIÓN");
        epgL2.setText((String) nxt[2]);
        epgBar.setVisibility(View.GONE);
        epgL3.setText(hm((Long) nxt[0]) + " - " + hm((Long) nxt[1]));
      }
      epgBox.setVisibility(View.VISIBLE);
      uiH.removeCallbacks(epgHide);
      uiH.postDelayed(epgHide, 8000);
    } catch (Exception e) { /* sin guía: no se muestra nada */ }
  }

  private boolean chMode() {
    return chIdx >= 0 && NativePlayerPlugin.chUrls.length > 1;
  }

  /* TV en vivo: cambiar de canal sin salir del reproductor (d = +1 siguiente, -1 anterior) */
  private void chStep(int d) {
    if (!chMode() || player == null) return;
    String[] cu = NativePlayerPlugin.chUrls;
    String[] ct = NativePlayerPlugin.chTitles;
    saveResume();
    chIdx = (chIdx + d + cu.length) % cu.length;
    url = cu[chIdx];
    String nm = chIdx < ct.length ? ct[chIdx] : "";
    qUrls = new String[]{url};
    qTitles = new String[]{nm};
    qIdx = 0;
    resumeKey = "p" + url.hashCode();
    retried = false; firstInfo = ""; resumeNote = ""; retryInfo = ""; nRetries = 0; errLog = ""; prefDone = false;
    if (ttlView != null) ttlView.setText((chIdx + 1) + "  " + nm);
    if (nextBtn != null) nextBtn.setVisibility(View.GONE);
    status.removeCallbacks(clear);
    status.setText("Cambiando de canal…");
    /* Cierra la conexión del canal anterior y espera un momento: muchos servidores
       rechazan el canal nuevo si la conexión anterior sigue abierta */
    player.stop();
    player.clearMediaItems();
    final int mySeq = ++stepSeq;
    uiH.postDelayed(() -> {
      if (mySeq != stepSeq || player == null) return;
      status.setText("");
      start();
    }, 450);
    if (pvRef != null) pvRef.showController();
    showEpg();
  }

  private void seekBy(int dir) {
    if (player == null) return;
    long d = player.getDuration();
    long p = player.getCurrentPosition() + dir * (long) skipMs;
    if (p < 0) p = 0;
    if (d != C.TIME_UNSET && p > d) p = d;
    player.seekTo(p);
  }

  private void togglePlay() {
    if (player == null) return;
    if (player.getPlayWhenReady()) player.pause(); else player.play();
  }

  /* Mando del TV: OK = pausa/play, ◀ ▶ = atrasar/adelantar, ▼ = botones de abajo, ▲ = volver */
  @Override
  public boolean dispatchKeyEvent(android.view.KeyEvent e) {
    int k = e.getKeyCode();
    boolean down = e.getAction() == android.view.KeyEvent.ACTION_DOWN;
    View f = getCurrentFocus();
    boolean inBar = f != null && f != rootRef && f != pvRef;
    boolean handled = true;
    switch (k) {
      case android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
        if (down && e.getRepeatCount() == 0) togglePlay();
        break;
      case android.view.KeyEvent.KEYCODE_MEDIA_PLAY:
        if (down && player != null) player.play();
        break;
      case android.view.KeyEvent.KEYCODE_MEDIA_PAUSE:
        if (down && player != null) player.pause();
        break;
      case android.view.KeyEvent.KEYCODE_MEDIA_REWIND:
        if (down) seekBy(-1);
        break;
      case android.view.KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
        if (down) seekBy(1);
        break;
      case android.view.KeyEvent.KEYCODE_DPAD_LEFT:
        if (inBar) { handled = false; break; }
        if (down) seekBy(-1);
        break;
      case android.view.KeyEvent.KEYCODE_DPAD_RIGHT:
        if (inBar) { handled = false; break; }
        if (down) seekBy(1);
        break;
      case android.view.KeyEvent.KEYCODE_DPAD_CENTER:
      case android.view.KeyEvent.KEYCODE_ENTER:
        if (inBar) { if (!down) okArmed = false; handled = false; break; }
        /* OK corto = pausa/play; OK mantenido (más de 0,6 s) = botones de abajo */
        if (down) {
          if (e.getRepeatCount() == 0) {
            okDownAt = android.os.SystemClock.uptimeMillis();
            okLong = false;
            okArmed = true;
          } else if (okArmed && !okLong
              && android.os.SystemClock.uptimeMillis() - okDownAt >= 600) {
            okLong = true;
            openBar();
          }
        } else {
          if (okArmed && !okLong) togglePlay();
          okArmed = false;
        }
        break;
      case android.view.KeyEvent.KEYCODE_CHANNEL_UP:
      case android.view.KeyEvent.KEYCODE_PAGE_UP:
        if (!chMode()) { handled = false; break; }
        if (down && e.getRepeatCount() == 0) chStep(1);
        break;
      case android.view.KeyEvent.KEYCODE_CHANNEL_DOWN:
      case android.view.KeyEvent.KEYCODE_PAGE_DOWN:
        if (!chMode()) { handled = false; break; }
        if (down && e.getRepeatCount() == 0) chStep(-1);
        break;
      case android.view.KeyEvent.KEYCODE_MENU:
      case android.view.KeyEvent.KEYCODE_INFO:
        if (down && !inBar) openBar();
        break;
      case android.view.KeyEvent.KEYCODE_DPAD_DOWN:
        if (inBar) { handled = false; break; }
        if (chMode()) {
          if (down && e.getRepeatCount() == 0) chStep(-1);
          break;
        }
        if (down && pvRef != null && zoomBtn != null) {
          pvRef.showController();
          zoomBtn.post(() -> zoomBtn.requestFocus());
        }
        break;
      case android.view.KeyEvent.KEYCODE_DPAD_UP:
        if (!inBar) {
          if (!chMode()) { handled = false; break; }
          if (down && e.getRepeatCount() == 0) chStep(1);
          break;
        }
        if (down && rootRef != null) rootRef.requestFocus();
        break;
      default:
        handled = false;
    }
    if (handled) {
      if (down && pvRef != null && !(k == android.view.KeyEvent.KEYCODE_DPAD_UP && inBar)) pvRef.showController();
      return true;
    }
    return super.dispatchKeyEvent(e);
  }

  private void applyCinemaStyle(PlayerView pv) {
    String[] buttons = {
        "exo_play_pause",
        "exo_play",
        "exo_pause",
        "exo_prev",
        "exo_next",
        "exo_rew",
        "exo_ffwd",
        "exo_repeat_toggle",
        "exo_shuffle",
        "exo_settings",
        "exo_subtitle",
        "exo_audio_track"
    };

    for (String name : buttons) {
      int id = getResources().getIdentifier(
          name, "id", getPackageName());

      if (id != 0) {
        View button = pv.findViewById(id);

        if (button instanceof android.widget.ImageView) {
          ((android.widget.ImageView) button).setColorFilter(
              ACCENT,
              android.graphics.PorterDuff.Mode.SRC_IN);
        }
      }
    }

    try {
      android.graphics.Typeface tf = android.graphics.Typeface.createFromAsset(
          getAssets(), "fonts/open_sans.ttf");
      for (String name : new String[]{"exo_position", "exo_duration"}) {
        int tid = getResources().getIdentifier(name, "id", getPackageName());
        View tv = tid == 0 ? null : pv.findViewById(tid);
        if (tv instanceof TextView) ((TextView) tv).setTypeface(tf);
      }
    } catch (Exception e) { /* opcional */ }

    int progressId = getResources().getIdentifier(
        "exo_progress", "id", getPackageName());

    if (progressId != 0) {
      View progress = pv.findViewById(progressId);

      if (progress instanceof androidx.media3.ui.DefaultTimeBar) {
        androidx.media3.ui.DefaultTimeBar bar =
            (androidx.media3.ui.DefaultTimeBar) progress;

        bar.setPlayedColor(ACCENT);
        bar.setScrubberColor(ACCENT);
        bar.setBufferedColor(Color.GRAY);
        bar.setUnplayedColor(Color.DKGRAY);
      }
    }
  }

  private void parseQueue() {
    String u = getIntent().getStringExtra("urls");
    String t = getIntent().getStringExtra("titles");
    if (u != null && !u.isEmpty()) {
      qUrls = u.split("\n|\\\\n");
      qTitles = t == null ? new String[0] : t.split("\n|\\\\n");
      qIdx = getIntent().getIntExtra("idx", 0);
    }
    skipMs = getSharedPreferences("glystv_prefs", MODE_PRIVATE).getInt("skip", 10000);
    chIdx = getIntent().getIntExtra("chIdx", -1);
    String es = getIntent().getStringExtra("epgSrv");
    String eu = getIntent().getStringExtra("epgU");
    String ep = getIntent().getStringExtra("epgP");
    epgSrv = es == null ? "" : es;
    epgU = eu == null ? "" : eu;
    epgP = ep == null ? "" : ep;
    tfFmt = getIntent().getIntExtra("tf", 24);
  }

  private TextView mkBtn(String txt) {
    final TextView b = new TextView(this);
    b.setText(txt);
    b.setTextColor(ACCENT);
    b.setTextSize(14);
    b.setGravity(Gravity.CENTER);
    b.setPadding(24, 12, 24, 12);
    b.setFocusable(true);
    b.setClickable(true);
    b.setOnFocusChangeListener((view, f) ->
        b.setBackgroundColor(f ? Color.argb(120, 112, 40, 245) : Color.TRANSPARENT));
    return b;
  }

  private void addExtraButtons(PlayerView pv, FrameLayout root) {
    TextView more = mkBtn("Más");
    more.setOnClickListener(x -> showMenu());
    nextBtn = mkBtn("Siguiente ›");
    nextBtn.setOnClickListener(x -> playNext());
    nextBtn.setVisibility(qIdx + 1 < qUrls.length ? View.VISIBLE : View.GONE);
    int sid = getResources().getIdentifier("exo_settings", "id", getPackageName());
    View st = sid == 0 ? null : pv.findViewById(sid);
    if (st != null && st.getParent() instanceof android.widget.LinearLayout) {
      android.widget.LinearLayout p = (android.widget.LinearLayout) st.getParent();
      int at = p.indexOfChild(st);
      p.addView(nextBtn, at);
      p.addView(more, at);
    } else {
      root.addView(more, new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.END));
    }
    bindSkip("exo_rew", -1);
    bindSkip("exo_ffwd", 1);
  }

  private void bindSkip(String name, final int dir) {
    int id = getResources().getIdentifier(name, "id", getPackageName());
    View b = id == 0 ? null : pvRef.findViewById(id);
    if (b == null) return;
    b.setOnClickListener(x -> {
      long d = player.getDuration();
      long p = player.getCurrentPosition() + dir * (long) skipMs;
      if (p < 0) p = 0;
      if (d != C.TIME_UNSET && p > d) p = d;
      player.seekTo(p);
    });
  }

  private void playNext() {
    if (qIdx + 1 >= qUrls.length) return;
    saveResume();
    qIdx++;
    url = qUrls[qIdx];
    resumeKey = "p" + url.hashCode();
    retried = false; firstInfo = ""; resumeNote = ""; retryInfo = ""; nRetries = 0;
    if (ttlView != null && qIdx < qTitles.length) ttlView.setText(qTitles[qIdx]);
    if (nextBtn != null) nextBtn.setVisibility(qIdx + 1 < qUrls.length ? View.VISIBLE : View.GONE);
    start();
  }

  /* Menú lateral oscuro/azul (reemplaza el cuadro blanco centrado) */
  private class SideMenu {
    private final android.content.Context c;
    private String title = "";
    private String[] items = new String[0];
    private android.content.DialogInterface.OnClickListener l;
    SideMenu(android.content.Context c) { this.c = c; }
    SideMenu setTitle(String t) { title = t; return this; }
    SideMenu setItems(String[] it, android.content.DialogInterface.OnClickListener l) { items = it; this.l = l; return this; }
    void show() {
      final android.app.Dialog dlg = new android.app.Dialog(c);
      dlg.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);
      float dn = getResources().getDisplayMetrics().density;
      android.widget.LinearLayout col = new android.widget.LinearLayout(c);
      col.setOrientation(android.widget.LinearLayout.VERTICAL);
      col.setBackgroundColor(Color.rgb(11, 9, 21));
      TextView h = new TextView(c);
      h.setText(title.toUpperCase());
      h.setTextColor(ACCENT);
      h.setTextSize(15);
      h.setPadding((int) (20 * dn), (int) (18 * dn), (int) (20 * dn), (int) (12 * dn));
      col.addView(h);
      View line = new View(c);
      line.setBackgroundColor(Color.rgb(112, 40, 245));
      col.addView(line, new android.widget.LinearLayout.LayoutParams(-1, (int) (2 * dn)));
      android.widget.LinearLayout box = new android.widget.LinearLayout(c);
      box.setOrientation(android.widget.LinearLayout.VERTICAL);
      android.widget.ScrollView sv = new android.widget.ScrollView(c);
      sv.addView(box);
      col.addView(sv, new android.widget.LinearLayout.LayoutParams(-1, -1));
      TextView first = null;
      for (int i = 0; i < items.length; i++) {
        final int w = i;
        final TextView t = new TextView(c);
        t.setText(items[i]);
        t.setTextColor(Color.WHITE);
        t.setTextSize(17);
        t.setPadding((int) (20 * dn), (int) (15 * dn), (int) (20 * dn), (int) (15 * dn));
        t.setFocusable(true);
        t.setClickable(true);
        t.setOnFocusChangeListener((view, f) ->
            t.setBackgroundColor(f ? Color.rgb(112, 40, 245) : Color.TRANSPARENT));
        t.setOnClickListener(view -> { dlg.dismiss(); if (l != null) l.onClick(dlg, w); });
        box.addView(t);
        if (first == null) first = t;
      }
      dlg.setContentView(col);
      android.view.Window win = dlg.getWindow();
      if (win != null) {
        win.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
        win.setGravity(Gravity.END | Gravity.TOP);
        win.setLayout((int) (320 * dn), WindowManager.LayoutParams.MATCH_PARENT);
        win.setDimAmount(0.35f);
        win.getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
      }
      dlg.show();
      if (first != null) first.requestFocus();
    }
  }

  private void showMenu() {
    java.util.ArrayList<String> it = new java.util.ArrayList<>();
    it.add("Calidad de video (Automática / Manual)");
    it.add("Audio");
    it.add("Subtítulos");
    it.add("Velocidad");
    it.add("Temporizador para dormir");
    it.add("Salto: " + (skipMs / 1000) + " s");
    it.add("Reproducir con VLC");
    it.add("Reproducir con MPV");
    new SideMenu(this)
        .setTitle("Opciones")
        .setItems(it.toArray(new String[0]), (d, w) -> {
          if (w == 0) pickVideoQuality();
          else if (w == 1) pickTrack(C.TRACK_TYPE_AUDIO);
          else if (w == 2) pickTrack(C.TRACK_TYPE_TEXT);
          else if (w == 3) pickSpeed();
          else if (w == 4) pickSleep();
          else if (w == 5) pickSkip();
          else if (w == 6) launchAlt("vlc");
          else if (w == 7) launchAlt("mpv");
        }).show();
  }

  private void say(String m) { status.setText(m); status.removeCallbacks(clear); status.postDelayed(clear, 4000); }

  /* Calidad de vídeo: automática por defecto; permite elegir solo variantes compatibles. */
  private void pickVideoQuality() {
    final java.util.ArrayList<Tracks.Group> groups = new java.util.ArrayList<>();
    final java.util.ArrayList<Integer> indexes = new java.util.ArrayList<>();
    final java.util.ArrayList<String> labels = new java.util.ArrayList<>();
    labels.add("Automática (recomendada)");
    for (Tracks.Group g : player.getCurrentTracks().getGroups()) {
      if (g.getType() != C.TRACK_TYPE_VIDEO) continue;
      for (int i = 0; i < g.length; i++) {
        if (!g.isTrackSupported(i)) continue;
        androidx.media3.common.Format f = g.getTrackFormat(i);
        if (f.height <= 0) continue;
        String label = f.height + "p";
        if (f.width > 0) label += " · " + f.width + "×" + f.height;
        if (f.bitrate > 0) label += " · " + String.format(java.util.Locale.US, "%.1f Mbps", f.bitrate / 1000000f);
        labels.add(label);
        groups.add(g);
        indexes.add(i);
      }
    }
    if (labels.size() == 1) {
      say("El enlace no ofrece varias calidades de vídeo compatibles");
      return;
    }
    new SideMenu(this).setTitle("Calidad de vídeo")
        .setItems(labels.toArray(new String[0]), (d, w) -> {
          androidx.media3.common.TrackSelectionParameters.Builder b =
              player.getTrackSelectionParameters().buildUpon();
          if (w == 0) {
            b.clearOverridesOfType(C.TRACK_TYPE_VIDEO);
            b.setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, false);
            say("Calidad automática activada");
          } else {
            b.setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, false);
            b.setOverrideForType(new androidx.media3.common.TrackSelectionOverride(
                groups.get(w - 1).getMediaTrackGroup(), indexes.get(w - 1)));
            say("Calidad seleccionada: " + labels.get(w));
          }
          player.setTrackSelectionParameters(b.build());
        }).show();
  }

  private void pickTrack(final int type) {
    final java.util.ArrayList<String> names = new java.util.ArrayList<>();
    final java.util.ArrayList<Tracks.Group> gs = new java.util.ArrayList<>();
    final java.util.ArrayList<Integer> idx = new java.util.ArrayList<>();
    if (type == C.TRACK_TYPE_TEXT) { names.add("Desactivados"); gs.add(null); idx.add(-1); }
    for (Tracks.Group g : player.getCurrentTracks().getGroups()) {
      if (g.getType() != type) continue;
      for (int i = 0; i < g.length; i++) {
        androidx.media3.common.Format f = g.getTrackFormat(i);
        String n = f.label != null ? f.label
            : (f.language != null ? new java.util.Locale(f.language).getDisplayLanguage()
            : "Pista " + (names.size() + 1));
        names.add(n); gs.add(g); idx.add(i);
      }
    }
    if (names.isEmpty() || (type == C.TRACK_TYPE_TEXT && names.size() == 1)) {
      say(type == C.TRACK_TYPE_TEXT ? "Sin subtítulos disponibles" : "Sin pistas de audio alternas");
      return;
    }
    new SideMenu(this)
        .setTitle(type == C.TRACK_TYPE_TEXT ? "Subtítulos" : "Audio")
        .setItems(names.toArray(new String[0]), (d, w) -> {
          androidx.media3.common.TrackSelectionParameters.Builder b =
              player.getTrackSelectionParameters().buildUpon();
          String key = type == C.TRACK_TYPE_TEXT ? "sub_lang" : "aud_lang";
          android.content.SharedPreferences.Editor ed =
              getSharedPreferences("glystv_prefs", MODE_PRIVATE).edit();
          if (gs.get(w) == null) {
            b.setTrackTypeDisabled(type, true);
            ed.putString(key, "off");
          } else {
            b.setTrackTypeDisabled(type, false);
            b.setOverrideForType(new androidx.media3.common.TrackSelectionOverride(
                gs.get(w).getMediaTrackGroup(), idx.get(w)));
            String lg = gs.get(w).getTrackFormat(idx.get(w)).language;
            if (lg != null && !lg.equals("und")) ed.putString(key, lg);
          }
          ed.apply();
          player.setTrackSelectionParameters(b.build());
        }).show();
  }

  private void pickSpeed() {
    final float[] v = {0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f};
    new SideMenu(this).setTitle("Velocidad")
        .setItems(new String[]{"0.5x", "0.75x", "Normal", "1.25x", "1.5x", "2x"}, (d, w) ->
            player.setPlaybackParameters(new androidx.media3.common.PlaybackParameters(v[w])))
        .show();
  }

  private void pickSleep() {
    final int[] mins = {0, 15, 30, 45, 60, 90};
    new SideMenu(this).setTitle("Temporizador para dormir")
        .setItems(new String[]{"Desactivado", "15 minutos", "30 minutos", "45 minutos", "60 minutos", "90 minutos"}, (d, w) -> {
          if (sleepR != null) uiH.removeCallbacks(sleepR);
          sleepR = null;
          if (mins[w] > 0) {
            sleepR = () -> { player.pause(); say("Temporizador: reproducción detenida"); };
            uiH.postDelayed(sleepR, mins[w] * 60000L);
            say("Se detendrá en " + mins[w] + " min");
          }
        }).show();
  }

  private void pickSkip() {
    final int[] secs = {10, 30, 60};
    new SideMenu(this).setTitle("Salto de retroceso/avance")
        .setItems(new String[]{"10 segundos", "30 segundos", "60 segundos"}, (d, w) -> {
          skipMs = secs[w] * 1000;
          getSharedPreferences("glystv_prefs", MODE_PRIVATE).edit().putInt("skip", skipMs).apply();
        }).show();
  }


  @Override
  protected void onStop() {
    if (sleepR != null) uiH.removeCallbacks(sleepR);
    epgSeq++;
    super.onStop();
  }


  private boolean isAudioDecodeError(PlaybackException e, String info) {
    int c = e.errorCode;
    boolean dec = c == PlaybackException.ERROR_CODE_DECODING_FAILED
        || c == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED
        || c == PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES
        || c == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED
        || c == PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED
        || c == PlaybackException.ERROR_CODE_AUDIO_TRACK_WRITE_FAILED;
    if (!dec) return false;
    try {
      if (e instanceof androidx.media3.exoplayer.ExoPlaybackException) {
        androidx.media3.common.Format f = ((androidx.media3.exoplayer.ExoPlaybackException) e).rendererFormat;
        if (f != null && f.sampleMimeType != null) return f.sampleMimeType.startsWith("audio/");
      }
    } catch (Throwable t) { /* usa el texto del error */ }
    String m = info.toLowerCase(java.util.Locale.ROOT);
    return m.contains("mp3") || m.contains("mp2") || m.contains("aac") || m.contains("ac3")
        || m.contains("audio") || m.contains("opus") || m.contains("dts");
  }

  /* Dice si el decodificador FFmpeg (audio extra) está disponible en esta app */
  private String ffInfo() {
    try {
      Class<?> k = Class.forName("androidx.media3.decoder.ffmpeg.FfmpegLibrary");
      Object ok = k.getMethod("isAvailable").invoke(null);
      return "\nFFmpeg: " + (Boolean.TRUE.equals(ok) ? "sí" : "no cargó");
    } catch (Throwable t) { return "\nFFmpeg: no detectado"; }
  }

  /* Guarda qué formato (m3u8 o ts) funcionó en este servidor para usarlo primero */
  private void rememberFormat() {
    try {
      String x = extOf(url).toLowerCase(java.util.Locale.ROOT);
      String h = android.net.Uri.parse(url).getHost();
      if (h != null && (x.equals("m3u8") || x.equals("ts")))
        getSharedPreferences("glystv_prefs", MODE_PRIVATE).edit().putString("fmt_" + h, x).apply();
    } catch (Exception ex) { /* opcional */ }
  }

  private String preferFormat(String u) {
    try {
      String h = android.net.Uri.parse(u).getHost();
      String pref = h == null ? "" : getSharedPreferences("glystv_prefs", MODE_PRIVATE).getString("fmt_" + h, "");
      String x = extOf(u).toLowerCase(java.util.Locale.ROOT);
      if (!pref.isEmpty() && (x.equals("m3u8") || x.equals("ts")) && !x.equals(pref)) {
        String alt = altUrl(u);
        if (alt != null) return alt;
      }
    } catch (Exception ex) { /* opcional */ }
    return u;
  }

  private String extOf(String u) {
    try {
      String p = android.net.Uri.parse(u).getLastPathSegment();
      return (p != null && p.contains(".")) ? p.substring(p.lastIndexOf('.') + 1) : "(sin extensión)";
    } catch (Exception ex) { return "?"; }
  }

  /* Oculta usuario y contraseña (segmentos de la ruta) en el texto mostrado */
  private String redact(String t, String u) {
    try {
      java.util.List<String> segs = android.net.Uri.parse(u).getPathSegments();
      for (int i = 0; i < segs.size() - 1; i++) {
        String g = segs.get(i);
        if (g.length() > 2) t = t.replace(g, "***");
      }
    } catch (Exception ex) { /* opcional */ }
    return t;
  }

  /* Diagnóstico: qué responde realmente el servidor a esa dirección */
  private void probeUrl(final String u) {
    new Thread(() -> {
      String out;
      try {
        java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(u).openConnection();
        c.setRequestProperty("User-Agent", "VLC/3.0.18 LibVLC/3.0.18");
        c.setConnectTimeout(8000);
        c.setReadTimeout(8000);
        c.setInstanceFollowRedirects(true);
        int code = c.getResponseCode();
        String ct = String.valueOf(c.getContentType());
        java.io.InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        byte[] b = new byte[160];
        int n = 0;
        if (in != null) { n = in.read(b); in.close(); }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < Math.max(n, 0); i++) {
          char ch = (char) (b[i] & 0xff);
          sb.append(ch >= 32 && ch < 127 ? ch : '.');
        }
        out = "\nServidor responde: HTTP " + code + ", " + ct + "\nEmpieza con: " + redact(sb.toString(), u);
        c.disconnect();
      } catch (Exception ex) {
        out = "\nNo se pudo consultar el servidor: " + ex.getClass().getSimpleName();
      }
      final String o = out;
      runOnUiThread(() -> status.setText(status.getText() + o));
    }).start();
  }

  private boolean isFormatError(PlaybackException e) {
    int c = e.errorCode;
    return c == PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED
        || c == PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED
        || c == PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED
        || c == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED;
  }

  private String mimeOf(String u) {
    String x = extOf(u).toLowerCase(java.util.Locale.ROOT);
    if (x.equals("m3u8")) return androidx.media3.common.MimeTypes.APPLICATION_M3U8;
    if (x.equals("mpd")) return androidx.media3.common.MimeTypes.APPLICATION_MPD;
    return "";
  }

  /* Variante del mismo enlace: .m3u8 <-> .ts (muchos proveedores aceptan solo una) */
  private String altUrl(String u) {
    try {
      int q = u.indexOf('?');
      String base = q >= 0 ? u.substring(0, q) : u;
      String rest = q >= 0 ? u.substring(q) : "";
      String low = base.toLowerCase(java.util.Locale.ROOT);
      /* Películas y series: si el formato original falla, prueba .m3u8 (o .mp4 si ya era m3u8) */
      if (low.contains("/series/") || low.contains("/movie/")) {
        int dot = base.lastIndexOf('.');
        if (dot > base.lastIndexOf('/')) {
          String ex = low.substring(dot + 1);
          String ne = ex.equals("m3u8") ? "mp4" : "m3u8";
          return base.substring(0, dot + 1) + ne + rest;
        }
      }
      if (low.endsWith(".m3u8")) return base.substring(0, base.length() - 5) + ".ts" + rest;
      if (low.endsWith(".ts")) return base.substring(0, base.length() - 3) + ".m3u8" + rest;
    } catch (Exception ex) { /* opcional */ }
    return null;
  }

  /* Lee los primeros bytes que manda el servidor y reconoce el formato real */
  private void sniffFormat(final String u, final int seq, final String info) {
    new Thread(() -> {
      String mime = "";
      String desc = "";
      try {
        java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(u).openConnection();
        c.setRequestProperty("User-Agent", "VLC/3.0.18 LibVLC/3.0.18");
        c.setConnectTimeout(8000);
        c.setReadTimeout(8000);
        c.setInstanceFollowRedirects(true);
        int code = c.getResponseCode();
        java.io.InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        byte[] b = new byte[400];
        int n = 0;
        if (in != null) {
          int r;
          while (n < b.length && (r = in.read(b, n, b.length - n)) > 0) n += r;
          in.close();
        }
        c.disconnect();
        String head = new String(b, 0, n, java.nio.charset.StandardCharsets.ISO_8859_1);
        String low = head.toLowerCase(java.util.Locale.ROOT);
        if (code >= 400) {
          desc = "HTTP " + code;
        } else if (n == 0) {
          desc = "respuesta vacía";
        } else if (head.startsWith("#EXTM3U")) {
          mime = androidx.media3.common.MimeTypes.APPLICATION_M3U8;
          desc = "HLS (m3u8)";
        } else if (n > 188 && (b[0] & 0xff) == 0x47 && (b[188] & 0xff) == 0x47) {
          mime = androidx.media3.common.MimeTypes.VIDEO_MP2T;
          desc = "TS";
        } else if (n > 8 && head.startsWith("ftyp", 4)) {
          mime = androidx.media3.common.MimeTypes.VIDEO_MP4;
          desc = "MP4";
        } else if (n > 4 && (b[0] & 0xff) == 0x1A && (b[1] & 0xff) == 0x45
            && (b[2] & 0xff) == 0xDF && (b[3] & 0xff) == 0xA3) {
          mime = androidx.media3.common.MimeTypes.VIDEO_MATROSKA;
          desc = "MKV/WebM";
        } else if (head.startsWith("FLV")) {
          mime = androidx.media3.common.MimeTypes.VIDEO_FLV;
          desc = "FLV";
        } else if (low.contains("<mpd")) {
          mime = androidx.media3.common.MimeTypes.APPLICATION_MPD;
          desc = "DASH (mpd)";
        } else {
          StringBuilder sb = new StringBuilder();
          for (int i = 0; i < Math.min(n, 100); i++) {
            char ch = (char) (b[i] & 0xff);
            sb.append(ch >= 32 && ch < 127 ? ch : '.');
          }
          desc = "no es vídeo: " + redact(sb.toString(), u);
        }
      } catch (Exception ex) {
        desc = "sin respuesta (" + ex.getClass().getSimpleName() + ")";
      }
      final String fm = mime;
      final String fd = desc;
      runOnUiThread(() -> afterSniff(seq, u, fm, fd, info));
    }).start();
  }

  private void afterSniff(int seq, String u, String mime, String desc, String info) {
    if (seq != playSeq || player == null) return;
    if (!mime.isEmpty() && !mime.equals(lastMime)) {
      lastMime = mime;
      status.setText("Preparando la reproducción…");
      player.setMediaItem(new MediaItem.Builder().setUri(u).setMimeType(mime).build());
      player.prepare();
      player.play();
      return;
    }
    errLog += "\n  el servidor devolvió: " + desc;
    failNext(info);
  }

  /* Siguiente salida del canal; al final prueba .m3u8/.ts una vez y luego muestra el error */
  /* Abre VLC o MPV cuando ExoPlayer no puede (o cuando el usuario lo elige en Opciones) */
  private boolean launchAlt(String engineName) {
    try {
      java.util.ArrayList<String> l = new java.util.ArrayList<>();
      if (firstUrl != null) l.add(firstUrl);
      if (url != null && !l.contains(url)) l.add(url);
      for (String u : triedUrls) if (u != null && !l.contains(u) && l.size() < 3) l.add(u);
      if (l.isEmpty()) return false;
      long pos = 0;
      try { if (player != null && !player.isCurrentMediaItemLive() && player.getDuration() > 0) pos = player.getCurrentPosition(); } catch (Throwable t) { pos = 0; }
      android.content.Intent i = new android.content.Intent(this, AltPlayerActivity.class);
      i.putExtra("url", l.get(0));
      i.putExtra("urls", l.toArray(new String[0]));
      i.putExtra("title", ttlView != null ? String.valueOf(ttlView.getText()) : "");
      i.putExtra("engine", engineName);
      i.putExtra("pos", pos);
      try { if (player != null) player.stop(); } catch (Throwable t) { /* ignorar */ }
      startActivity(i);
      finish();
      return true;
    } catch (Throwable t) {
      return false;
    }
  }

  private void failNext(String info) {
    if (qIdx + 1 < qUrls.length) {
      status.setText("El formato del canal no respondió. Probando automáticamente otra salida…");
      status.postDelayed(() -> {
        if (qIdx + 1 < qUrls.length) playNext();
      }, 350);
      return;
    }
    if (!slowRetried) {
      slowRetried = true;
      final int sq = playSeq;
      status.setText("El canal no respondió. Reintentando en 2 segundos…");
      status.postDelayed(() -> {
        if (sq != playSeq || player == null) return;
        sniffed = false;
        player.setMediaItem(MediaItem.fromUri(url));
        player.prepare();
        player.play();
      }, 2000);
      return;
    }
    if (!altTried) {
      String alt = altUrl(url);
      if (alt != null && !triedUrls.contains(alt)) {
        altTried = true;
        triedUrls.add(alt);
        sniffed = false;
        url = alt;
        lastMime = mimeOf(alt);
        playSeq++;
        status.setText("Intentando otra opción de reproducción…");
        player.setMediaItem(MediaItem.fromUri(alt));
        player.prepare();
        player.play();
        return;
      }
    }
    /* Último recurso: probar con VLC y luego MPV (salvo que el enlace no exista: HTTP 404) */
    if (!altLaunched && (info == null || !info.startsWith("HTTP 404"))) {
      altLaunched = true;
      status.setText("Probando con VLC…");
      if (launchAlt("vlc")) return;
    }
    /* Mensaje sencillo para el usuario; no mostrar códigos ni registros técnicos. */
    String det = "";
    try { det = redact(info == null ? "" : info, url); if (det.length() > 120) det = det.substring(0, 120); } catch (Exception ex) { det = ""; }
    status.setText("No se pudo reproducir este contenido. Comprueba tu conexión o intenta otro canal.\n(" + extOf(url) + ": " + det + ")");
    status.removeCallbacks(clear);
    status.postDelayed(clear, 6000);
  }

  private String describe(PlaybackException e) {
    Throwable c = e.getCause();

    if (c instanceof HttpDataSource.InvalidResponseCodeException) {
      return "HTTP " +
          ((HttpDataSource.InvalidResponseCodeException) c).responseCode;
    }

    String base = e.getErrorCodeName();
    if (c != null) {
      String m = String.valueOf(c.getMessage());
      if (m.length() > 80) m = m.substring(0, 80);
      base += " (" + c.getClass().getSimpleName() + ": " + m + ")";
    }
    return base;
  }

  /* Dónde falló: formato y servidor (sin mostrar usuario ni contraseña) */
  private String where() {
    try {
      android.net.Uri u = android.net.Uri.parse(url);
      String p = u.getLastPathSegment();
      String ext = (p != null && p.contains(".")) ? p.substring(p.lastIndexOf('.') + 1) : "(sin extensión)";
      return "\nFormato: " + ext + "\nServidor: " + u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : "");
    } catch (Exception ex) { return ""; }
  }

  /* Consejo según el tipo de error */
  private String hint(String info) {
    if (info.startsWith("HTTP 401") || info.startsWith("HTTP 403"))
      return "\nEl servidor rechazó la petición (credenciales, límite de conexiones o bloqueo).";
    if (info.startsWith("HTTP 404"))
      return "\nEl enlace no existe en el servidor (revisa ID y extensión).";
    if (info.startsWith("HTTP "))
      return "\nEl servidor respondió con error.";
    if (info.contains("CONNECTION_FAILED") || info.contains("TIMEOUT") || info.contains("NETWORK"))
      return "\nSin conexión con el servidor (red, puerto o servidor caído).";
    if (info.contains("PARSING_CONTAINER"))
      return "\nFormato de vídeo no reconocido.";
    if (info.contains("DECOD"))
      return "\nCódec de vídeo o audio no soportado.";
    return "";
  }

  private void start() {
    t0 = android.os.SystemClock.elapsedRealtime();
    triedTs = false;
    sniffed = false;
    altTried = false;
    slowRetried = false;
    playSeq++;
    if (!prefDone) {
      prefDone = true;
      triedUrls.clear();
      url = preferFormat(url);
    }
    triedUrls.add(url);
    if (firstUrl == null) firstUrl = url;
    lastMime = mimeOf(url);
    if (audioOff) {
      audioOff = false;
      player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
          .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, false).build());
    }
    long saved = 0;
    if (!retried) saved = getSharedPreferences(PREFS, MODE_PRIVATE).getLong(resumeKey, 0);
    MediaItem item = MediaItem.fromUri(url);
    if (saved > 0) {
      player.setMediaItem(item, saved);
      resumeNote = "\nRetomando desde " + fmt(saved);
    } else {
      player.setMediaItem(item);
    }
    player.prepare();
    player.play();
  }

  private String fmt(long ms) {
    long sec = ms / 1000;
    return String.format(java.util.Locale.US, "%d:%02d:%02d", sec / 3600, (sec % 3600) / 60, sec % 60);
  }

  /* Continuar viendo: solo películas/series (duración > 10 min, no en vivo) */
  private void saveResume() {
    try {
      if (player == null) return;
      long dur = player.getDuration();
      long pos = player.getCurrentPosition();
      if (dur == C.TIME_UNSET || dur < 600000 || player.isCurrentMediaItemLive()) return;
      android.content.SharedPreferences.Editor ed =
          getSharedPreferences(PREFS, MODE_PRIVATE).edit();
      if (pos > 30000 && pos < dur - 60000) ed.putLong(resumeKey, pos);
      else ed.remove(resumeKey);
      ed.apply();
    } catch (Exception e) { /* opcional */ }
  }

  @Override
  protected void onPause() {
    saveResume();
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    saveResume();
    if (player != null) player.release();
    super.onDestroy();
    if (isFinishing()) NativePlayerPlugin.emitClosed();
  }
}
JAVA

# Reproductores de respaldo: VLC (LibVLC) y MPV (libmpv), por reflexión
cat > $PKG/AltPlayerActivity.java <<'ALTJAVA'
package com.glystv.app;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.PorterDuff;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;

/*
 * Reproductores de respaldo: VLC (LibVLC) y MPV (libmpv).
 * Se usan SOLO cuando ExoPlayer no puede abrir un contenido (o si el usuario los elige a mano).
 * Las librerías se llaman por reflexión: si alguna no está en la APK, ese reproductor se omite
 * y la app sigue funcionando con normalidad.
 */
public class AltPlayerActivity extends Activity implements SurfaceHolder.Callback {
  private static final int ACCENT = Color.rgb(112, 40, 245);
  private static final String UA = "VLC/3.0.18 LibVLC/3.0.18";
  private static final long TIMEOUT_MS = 22000;
  private static final Object MPV_LOCK = new Object();
  private static final String[] ASP = {"Normal", "16:9", "4:3", "Llenar"};

  private final Handler h = new Handler(Looper.getMainLooper());
  private FrameLayout root;
  private SurfaceView sv;
  private LinearLayout ovl;
  private TextView tTitle, tEngine, tStatus, tTime, tHint;
  private ProgressBar bar;

  private String[] urls = new String[0];
  private String title = "";
  private long startPos = 0;
  private final ArrayList<String[]> attempts = new ArrayList<>(); /* {motor, url} */
  private int attemptIdx = -1;
  private String engine = "";
  private String curUrl = "";

  private boolean engineStarted = false, started = false, destroyed = false, finalFail = false;
  private boolean isLive = false;
  private long t0 = 0;
  private int aspect = 0;
  private final StringBuilder errLog = new StringBuilder();

  /* VLC */
  private Object libVlc, vlcMp, vlcVout;
  /* MPV */
  private boolean mpvUp = false;
  private Class<?> mpvCls;
  private Object mpvObj = null; /* libmpv 1.0.0: create() devuelve una instancia; los demás métodos son de instancia */

  /* ===================== Reflexión ===================== */
  private static Class<?> wrap(Class<?> c) {
    if (!c.isPrimitive()) return c;
    if (c == int.class) return Integer.class;
    if (c == long.class) return Long.class;
    if (c == boolean.class) return Boolean.class;
    if (c == float.class) return Float.class;
    if (c == double.class) return Double.class;
    if (c == short.class) return Short.class;
    if (c == byte.class) return Byte.class;
    if (c == char.class) return Character.class;
    return c;
  }

  private static boolean fits(Class<?>[] pt, Object[] a) {
    if (pt.length != a.length) return false;
    for (int i = 0; i < pt.length; i++) {
      if (a[i] == null) {
        if (pt[i].isPrimitive()) return false;
        continue;
      }
      if (!wrap(pt[i]).isAssignableFrom(a[i].getClass())) return false;
    }
    return true;
  }

  /* Llama a un método por nombre (estático, de instancia o de un objeto Kotlin "INSTANCE") */
  private static Object inv(Object target, Class<?> c, String name, Object... a) throws Exception {
    Object recv = target;
    for (int pass = 0; pass < 2; pass++) {
      for (Method m : c.getMethods()) {
        if (!m.getName().equals(name) || !fits(m.getParameterTypes(), a)) continue;
        boolean st = Modifier.isStatic(m.getModifiers());
        if (recv == null && !st) continue;
        m.setAccessible(true);
        try {
          return m.invoke(st ? null : recv, a);
        } catch (InvocationTargetException ite) {
          Throwable cause = ite.getCause();
          if (cause instanceof Exception) throw (Exception) cause;
          throw ite;
        }
      }
      if (pass == 0 && recv == null) {
        try {
          Field f = c.getField("INSTANCE");
          recv = f.get(null);
        } catch (Throwable t) {
          break;
        }
        if (recv == null) break;
      } else {
        break;
      }
    }
    throw new NoSuchMethodException(c.getSimpleName() + "." + name + "/" + a.length);
  }

  private static Object call(Object target, String name, Object... a) throws Exception {
    return inv(target, target.getClass(), name, a);
  }

  private static Object build(Class<?> c, Object... a) throws Exception {
    for (Constructor<?> k : c.getConstructors()) {
      if (!fits(k.getParameterTypes(), a)) continue;
      try {
        return k.newInstance(a);
      } catch (InvocationTargetException ite) {
        Throwable cause = ite.getCause();
        if (cause instanceof Exception) throw (Exception) cause;
        throw ite;
      }
    }
    throw new NoSuchMethodException(c.getSimpleName() + ".<init>/" + a.length);
  }

  private static int fieldInt(Object o, String n, int def) {
    try {
      return o.getClass().getField(n).getInt(o);
    } catch (Throwable t) {
      return def;
    }
  }

  private static String fieldStr(Object o, String n) {
    try {
      Object v = o.getClass().getField(n).get(o);
      return v == null ? "" : String.valueOf(v);
    } catch (Throwable t) {
      return "";
    }
  }

  private boolean isVlc() { return "vlc".equals(engine); }

  /* ===================== Ciclo de vida ===================== */
  @Override
  protected void onCreate(Bundle b) {
    super.onCreate(b);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);

    String u0 = getIntent().getStringExtra("url");
    String[] us = getIntent().getStringArrayExtra("urls");
    if (us == null || us.length == 0) us = new String[]{u0 == null ? "" : u0};
    urls = us;
    String t = getIntent().getStringExtra("title");
    title = t == null ? "" : t;
    startPos = getIntent().getLongExtra("pos", 0);
    String first = getIntent().getStringExtra("engine");

    /* Orden de intentos: VLC con hasta 2 enlaces y después MPV con el enlace original */
    if (!"mpv".equals(first)) {
      for (int i = 0; i < urls.length && i < 2; i++) attempts.add(new String[]{"vlc", urls[i]});
    }
    attempts.add(new String[]{"mpv", urls[0]});

    buildUi();
    h.postDelayed(tick, 500);
    nextAttempt();
  }

  private TextView mkText(int sp, int color) {
    TextView v = new TextView(this);
    v.setTextColor(color);
    v.setTextSize(sp);
    v.setShadowLayer(4f, 0f, 0f, Color.BLACK);
    return v;
  }

  private void buildUi() {
    final float dn = getResources().getDisplayMetrics().density;
    root = new FrameLayout(this);
    root.setBackgroundColor(Color.BLACK);

    ovl = new LinearLayout(this);
    ovl.setOrientation(LinearLayout.VERTICAL);
    ovl.setPadding((int) (28 * dn), (int) (18 * dn), (int) (28 * dn), (int) (18 * dn));

    LinearLayout top = new LinearLayout(this);
    top.setOrientation(LinearLayout.HORIZONTAL);
    tTitle = mkText(20, Color.WHITE);
    tTitle.setText(title);
    tTitle.setSingleLine(true);
    top.addView(tTitle, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    tEngine = mkText(13, Color.WHITE);
    tEngine.setBackgroundColor(ACCENT);
    tEngine.setPadding((int) (10 * dn), (int) (4 * dn), (int) (10 * dn), (int) (4 * dn));
    top.addView(tEngine, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    ovl.addView(top, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    View spacer = new View(this);
    ovl.addView(spacer, new LinearLayout.LayoutParams(1, 0, 1f));

    bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
    bar.setMax(1000);
    try { bar.getProgressDrawable().setColorFilter(ACCENT, PorterDuff.Mode.SRC_IN); } catch (Throwable t) { /* opcional */ }
    ovl.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (int) (6 * dn)));
    tTime = mkText(15, Color.WHITE);
    ovl.addView(tTime, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    tHint = mkText(12, Color.LTGRAY);
    tHint.setText("OK pausa · ◀ ▶ ±10 s · ▲ audio · ▼ subtítulos · MENÚ aspecto");
    ovl.addView(tHint, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    root.addView(ovl, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

    tStatus = mkText(18, Color.WHITE);
    tStatus.setGravity(Gravity.CENTER);
    tStatus.setBackgroundColor(Color.argb(190, 11, 9, 21));
    tStatus.setPadding((int) (22 * dn), (int) (14 * dn), (int) (22 * dn), (int) (14 * dn));
    FrameLayout.LayoutParams sp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    sp.gravity = Gravity.CENTER;
    root.addView(tStatus, sp);
    setContentView(root);
  }

  private final Runnable hideOvl = new Runnable() {
    @Override public void run() { if (ovl != null && started) ovl.setVisibility(View.INVISIBLE); }
  };

  private void showOvl() {
    if (ovl == null) return;
    ovl.setVisibility(View.VISIBLE);
    h.removeCallbacks(hideOvl);
    h.postDelayed(hideOvl, 4500);
  }

  private void say(String m) {
    tStatus.setText(m);
    tStatus.setVisibility(View.VISIBLE);
    h.removeCallbacks(clearSay);
    h.postDelayed(clearSay, 1800);
  }

  private final Runnable clearSay = new Runnable() {
    @Override public void run() { if (started && !finalFail) { tStatus.setText(""); tStatus.setVisibility(View.GONE); } }
  };

  /* ===================== Intentos ===================== */
  private void nextAttempt() {
    if (destroyed) return;
    releaseEngines();
    attemptIdx++;
    if (attemptIdx >= attempts.size()) { showFinalError(); return; }
    String[] a = attempts.get(attemptIdx);
    engine = a[0];
    curUrl = a[1];
    started = false;
    engineStarted = false;
    isLive = !(curUrl.contains("/movie/") || curUrl.contains("/series/"));
    t0 = SystemClock.elapsedRealtime();
    tEngine.setText(isVlc() ? "VLC" : "MPV");
    tStatus.setVisibility(View.VISIBLE);
    tStatus.setText("Probando con " + (isVlc() ? "VLC" : "MPV") + "…");
    ovl.setVisibility(View.VISIBLE);
    bar.setProgress(0);
    tTime.setText("");

    if (sv != null) {
      try { sv.getHolder().removeCallback(this); root.removeView(sv); } catch (Throwable t) { /* ignorar */ }
    }
    sv = new SurfaceView(this);
    sv.getHolder().addCallback(this);
    root.addView(sv, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
  }

  private void failAttempt(String why) {
    if (destroyed) return;
    errLog.append(isVlc() ? "VLC: " : "MPV: ").append(why).append("\n");
    nextAttempt();
  }

  private void showFinalError() {
    finalFail = true;
    started = false;
    releaseEngines();
    try { if (sv != null) root.removeView(sv); } catch (Throwable t) { /* ignorar */ }
    sv = null;
    ovl.setVisibility(View.VISIBLE);
    tTime.setText("");
    tEngine.setText("ExoPlayer · VLC · MPV");
    tStatus.setVisibility(View.VISIBLE);
    String d = errLog.toString().trim();
    if (d.length() > 220) d = d.substring(0, 220);
    tStatus.setText("Ningún reproductor pudo abrir este contenido.\nPuede estar caído en el servidor.\n" + d + "\n\nPulsa Atrás para salir.");
  }

  /* ===================== Superficie ===================== */
  @Override
  public void surfaceCreated(SurfaceHolder holder) {
    if (destroyed || finalFail || engineStarted) return;
    engineStarted = true;
    try {
      if (isVlc()) startVlc(); else startMpv();
    } catch (Throwable t) {
      String m = t.getClass().getSimpleName() + (t.getMessage() == null ? "" : ": " + t.getMessage());
      if (m.length() > 90) m = m.substring(0, 90);
      engineStarted = false;
      failAttempt(m);
    }
  }

  @Override
  public void surfaceChanged(SurfaceHolder holder, int format, int w, int hh) {
    try {
      if (isVlc() && vlcVout != null) call(vlcVout, "setWindowSize", Integer.valueOf(w), Integer.valueOf(hh));
      else if (!isVlc() && mpvUp) inv(mpvObj, mpvCls, "setPropertyString", "android-surface-size", w + "x" + hh);
    } catch (Throwable t) { /* opcional */ }
  }

  @Override
  public void surfaceDestroyed(SurfaceHolder holder) { /* la liberación se hace en releaseEngines() */ }

  /* ===================== VLC ===================== */
  private void startVlc() throws Exception {
    Class<?> cLib = Class.forName("org.videolan.libvlc.LibVLC");
    ArrayList<String> o = new ArrayList<>();
    o.add("--network-caching=3000");
    o.add("--live-caching=3000");
    o.add("--file-caching=3000");
    o.add("--http-reconnect");
    o.add("--http-user-agent=" + UA);
    libVlc = build(cLib, getApplicationContext(), o);
    Class<?> cMp = Class.forName("org.videolan.libvlc.MediaPlayer");
    vlcMp = build(cMp, libVlc);
    vlcVout = call(vlcMp, "getVLCVout");
    call(vlcVout, "setVideoView", sv);
    call(vlcVout, "attachViews");
    try { call(vlcVout, "setWindowSize", Integer.valueOf(sv.getWidth()), Integer.valueOf(sv.getHeight())); } catch (Throwable t) { /* opcional */ }

    Class<?> cMedia = Class.forName("org.videolan.libvlc.Media");
    Object media = build(cMedia, libVlc, android.net.Uri.parse(curUrl));
    try { call(media, "addOption", ":network-caching=3000"); } catch (Throwable t) { /* opcional */ }
    try { call(media, "addOption", ":http-reconnect"); } catch (Throwable t) { /* opcional */ }
    try { call(media, "setHWDecoderEnabled", Boolean.TRUE, Boolean.FALSE); } catch (Throwable t) { /* opcional */ }
    call(vlcMp, "setMedia", media);
    try { call(media, "release"); } catch (Throwable t) { /* opcional */ }
    call(vlcMp, "play");
  }

  /* 0 cargando, 1 reproduciendo, 2 pausa, 3 terminó, 4 error */
  private int vlcState() {
    if (vlcMp == null) return 0;
    try {
      int s = ((Number) call(vlcMp, "getPlayerState")).intValue();
      if (s == 3) return 1;
      if (s == 4) return 2;
      if (s == 6) return 3;
      if (s == 7) return 4;
      if (s == 5) return started ? 3 : 0;
      return 0;
    } catch (Throwable t) {
      try {
        return Boolean.TRUE.equals(call(vlcMp, "isPlaying")) ? 1 : 0;
      } catch (Throwable t2) {
        return 0;
      }
    }
  }

  private void releaseVlc() {
    final Object mp = vlcMp, lib = libVlc, vo = vlcVout;
    vlcMp = null;
    libVlc = null;
    vlcVout = null;
    if (mp == null) return;
    try { if (vo != null) call(vo, "detachViews"); } catch (Throwable t) { /* ignorar */ }
    new Thread(new Runnable() {
      @Override public void run() {
        try { call(mp, "stop"); } catch (Throwable t) { /* ignorar */ }
        try { call(mp, "release"); } catch (Throwable t) { /* ignorar */ }
        try { if (lib != null) call(lib, "release"); } catch (Throwable t) { /* ignorar */ }
      }
    }).start();
  }

  private void vlcCycleTrack(boolean audio) {
    try {
      Object[] arr = (Object[]) call(vlcMp, audio ? "getAudioTracks" : "getSpuTracks");
      if (arr == null || arr.length == 0) { say(audio ? "Sin pistas de audio" : "Sin subtítulos"); return; }
      int cur = ((Number) call(vlcMp, audio ? "getAudioTrack" : "getSpuTrack")).intValue();
      int idx = -1;
      for (int i = 0; i < arr.length; i++) if (fieldInt(arr[i], "id", -2) == cur) idx = i;
      idx = (idx + 1) % arr.length;
      call(vlcMp, audio ? "setAudioTrack" : "setSpuTrack", Integer.valueOf(fieldInt(arr[idx], "id", -1)));
      String n = fieldStr(arr[idx], "name");
      say((audio ? "Audio: " : "Subtítulos: ") + (n.isEmpty() ? "pista " + (idx + 1) : n));
    } catch (Throwable t) {
      say(audio ? "No se pudo cambiar el audio" : "No se pudieron cambiar los subtítulos");
    }
  }

  /* ===================== MPV ===================== */
  private void mpvOpt(String n, String v) {
    try { inv(mpvObj, mpvCls, "setOptionString", n, v); } catch (Throwable t) { /* opción no soportada */ }
  }

  private void mpvCmd(String... c) throws Exception {
    inv(mpvObj, mpvCls, "command", (Object) c);
  }

  private void startMpv() throws Exception {
    synchronized (MPV_LOCK) {
      mpvCls = Class.forName("dev.jdtech.mpv.MPVLib");
      mpvObj = null;
      Object created;
      try {
        created = inv(null, mpvCls, "create", getApplicationContext());
      } catch (NoSuchMethodException nsm) {
        created = inv(null, mpvCls, "create", getApplicationContext(), "v");
      }
      /* libmpv 1.0.0: create() devuelve la instancia (MPVLib). En versiones viejas devuelve nada y todo es estático. */
      if (created != null && mpvCls.isInstance(created)) mpvObj = created;
      mpvUp = true;
      mpvOpt("vo", "gpu");
      mpvOpt("gpu-context", "android");
      mpvOpt("opengl-es", "yes");
      mpvOpt("hwdec", "mediacodec,mediacodec-copy");
      mpvOpt("hwdec-codecs", "h264,hevc,mpeg4,mpeg2video,vp8,vp9,av1");
      mpvOpt("ao", "audiotrack,opensles");
      mpvOpt("user-agent", UA);
      mpvOpt("cache", "yes");
      mpvOpt("cache-secs", "20");
      mpvOpt("demuxer-max-bytes", "67108864");
      mpvOpt("network-timeout", "20");
      mpvOpt("tls-verify", "no");
      mpvOpt("keep-open", "no");
      mpvOpt("idle", "yes");
      mpvOpt("save-position-on-quit", "no");
      /* La superficie se conecta ANTES de init() (libmpv 1.0.0 lo exige) */
      inv(mpvObj, mpvCls, "attachSurface", sv.getHolder().getSurface());
      mpvOpt("force-window", "yes");
      inv(mpvObj, mpvCls, "init");
      try { inv(mpvObj, mpvCls, "setPropertyString", "vo", "gpu"); } catch (Throwable t) { /* opcional */ }
      long sec = startPos / 1000;
      if (!isLive && sec > 10) mpvCmd("loadfile", curUrl, "replace", "-1", "start=" + sec);
      else mpvCmd("loadfile", curUrl);
    }
  }

  private Double mpvD(String n) {
    try {
      Object o = inv(mpvObj, mpvCls, "getPropertyDouble", n);
      return o instanceof Number ? Double.valueOf(((Number) o).doubleValue()) : null;
    } catch (Throwable t) {
      return null;
    }
  }

  private Boolean mpvB(String n) {
    try {
      Object o = inv(mpvObj, mpvCls, "getPropertyBoolean", n);
      return o instanceof Boolean ? (Boolean) o : null;
    } catch (Throwable t) {
      return null;
    }
  }

  private int mpvState() {
    if (!mpvUp) return 0;
    Double tp = mpvD("time-pos");
    Boolean idle = mpvB("idle-active");
    long el = SystemClock.elapsedRealtime() - t0;
    if (tp != null) return Boolean.TRUE.equals(mpvB("pause")) ? 2 : 1;
    if (Boolean.TRUE.equals(idle) && el > 4000) return started ? 3 : 4;
    return 0;
  }

  private void releaseMpv() {
    if (!mpvUp) return;
    mpvUp = false;
    final Class<?> c = mpvCls;
    final Object inst = mpvObj;
    try { mpvCmd("stop"); } catch (Throwable t) { /* ignorar */ }
    try { inv(inst, c, "detachSurface"); } catch (Throwable t) { /* ignorar */ }
    new Thread(new Runnable() {
      @Override public void run() {
        synchronized (MPV_LOCK) {
          try { inv(inst, c, "destroy"); } catch (Throwable t) { /* ignorar */ }
        }
      }
    }).start();
  }

  /* ===================== Sondeo de estado ===================== */
  private final Runnable tick = new Runnable() {
    @Override public void run() {
      if (destroyed) return;
      try { poll(); } catch (Throwable t) { /* ignorar */ }
      h.postDelayed(this, 500);
    }
  };

  private void poll() {
    if (finalFail || attemptIdx < 0 || attemptIdx >= attempts.size()) return;
    long now = SystemClock.elapsedRealtime();
    if (!engineStarted) {
      if (now - t0 > TIMEOUT_MS) failAttempt("no se pudo iniciar");
      return;
    }
    int st = isVlc() ? vlcState() : mpvState();
    if (st == 1 || st == 2) {
      if (!started) {
        started = true;
        tStatus.setText("");
        tStatus.setVisibility(View.GONE);
        if (isVlc() && !isLive && startPos > 10000) {
          try { call(vlcMp, "setTime", Long.valueOf(startPos)); } catch (Throwable t) { /* opcional */ }
        }
        showOvl();
      }
      updateBar();
    } else if (st == 4) {
      failAttempt(started ? "error durante la reproducción" : "no pudo abrir el contenido");
    } else if (st == 3) {
      if (started) finish(); else failAttempt("terminó sin reproducir");
    } else if (!started && now - t0 > TIMEOUT_MS) {
      failAttempt("sin respuesta en " + (TIMEOUT_MS / 1000) + " s");
    }
  }

  private static String fmt(long ms) {
    long s = Math.max(0, ms / 1000);
    long hh = s / 3600, mm = (s % 3600) / 60, ss = s % 60;
    return hh > 0 ? String.format(java.util.Locale.US, "%d:%02d:%02d", hh, mm, ss)
                  : String.format(java.util.Locale.US, "%02d:%02d", mm, ss);
  }

  private void updateBar() {
    long pos = 0, len = 0;
    try {
      if (isVlc()) {
        pos = ((Number) call(vlcMp, "getTime")).longValue();
        len = ((Number) call(vlcMp, "getLength")).longValue();
      } else {
        Double p = mpvD("time-pos"), d = mpvD("duration");
        pos = p == null ? 0 : (long) (p * 1000);
        len = d == null ? 0 : (long) (d * 1000);
      }
    } catch (Throwable t) { /* ignorar */ }
    if (len > 0) {
      bar.setVisibility(View.VISIBLE);
      bar.setProgress((int) Math.min(1000, pos * 1000 / len));
      tTime.setText(fmt(pos) + " / " + fmt(len));
    } else {
      bar.setVisibility(View.INVISIBLE);
      tTime.setText("EN VIVO");
    }
  }

  /* ===================== Control remoto ===================== */
  private boolean paused() {
    try {
      if (isVlc()) return !Boolean.TRUE.equals(call(vlcMp, "isPlaying"));
      return Boolean.TRUE.equals(mpvB("pause"));
    } catch (Throwable t) { return false; }
  }

  private void togglePause() {
    try {
      if (isVlc()) {
        if (paused()) call(vlcMp, "play"); else call(vlcMp, "pause");
      } else {
        mpvCmd("cycle", "pause");
      }
    } catch (Throwable t) { /* ignorar */ }
  }

  private void seekBy(int sec) {
    if (isLive) return;
    try {
      if (isVlc()) {
        long cur = ((Number) call(vlcMp, "getTime")).longValue();
        call(vlcMp, "setTime", Long.valueOf(Math.max(0, cur + sec * 1000L)));
      } else {
        mpvCmd("seek", String.valueOf(sec), "relative");
      }
      say((sec > 0 ? "▶▶ +" : "◀◀ ") + sec + " s");
    } catch (Throwable t) { /* ignorar */ }
  }

  private void cycleAspect() {
    aspect = (aspect + 1) % ASP.length;
    try {
      if (isVlc()) {
        String v = null;
        if (aspect == 1) v = "16:9";
        else if (aspect == 2) v = "4:3";
        else if (aspect == 3) v = getResources().getDisplayMetrics().widthPixels + ":" + getResources().getDisplayMetrics().heightPixels;
        call(vlcMp, "setAspectRatio", v);
      } else {
        inv(mpvObj, mpvCls, "setPropertyString", "keepaspect", aspect == 3 ? "no" : "yes");
        inv(mpvObj, mpvCls, "setPropertyString", "video-aspect-override",
            aspect == 1 ? "1.7778" : aspect == 2 ? "1.3333" : "-1");
      }
      say("Aspecto: " + ASP[aspect]);
    } catch (Throwable t) { say("No se pudo cambiar el aspecto"); }
  }

  private void cycleTrack(boolean audio) {
    if (!started) return;
    if (isVlc()) { vlcCycleTrack(audio); return; }
    try {
      mpvCmd("cycle", audio ? "audio" : "sub");
      say(audio ? "Audio: siguiente pista" : "Subtítulos: siguiente opción");
    } catch (Throwable t) { say("No se pudo cambiar"); }
  }

  @Override
  public boolean dispatchKeyEvent(KeyEvent e) {
    if (e.getAction() == KeyEvent.ACTION_DOWN && !finalFail) {
      int k = e.getKeyCode();
      if (k != KeyEvent.KEYCODE_BACK) showOvl();
      if (started) {
        switch (k) {
          case KeyEvent.KEYCODE_DPAD_CENTER:
          case KeyEvent.KEYCODE_ENTER:
          case KeyEvent.KEYCODE_NUMPAD_ENTER:
          case KeyEvent.KEYCODE_SPACE:
          case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            if (e.getRepeatCount() == 0) togglePause();
            return true;
          case KeyEvent.KEYCODE_MEDIA_PLAY:
            if (paused()) togglePause();
            return true;
          case KeyEvent.KEYCODE_MEDIA_PAUSE:
            if (!paused()) togglePause();
            return true;
          case KeyEvent.KEYCODE_DPAD_LEFT:
          case KeyEvent.KEYCODE_MEDIA_REWIND:
            seekBy(-10);
            return true;
          case KeyEvent.KEYCODE_DPAD_RIGHT:
          case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
            seekBy(10);
            return true;
          case KeyEvent.KEYCODE_DPAD_UP:
            if (e.getRepeatCount() == 0) cycleTrack(true);
            return true;
          case KeyEvent.KEYCODE_DPAD_DOWN:
            if (e.getRepeatCount() == 0) cycleTrack(false);
            return true;
          case KeyEvent.KEYCODE_MENU:
          case KeyEvent.KEYCODE_INFO:
            if (e.getRepeatCount() == 0) cycleAspect();
            return true;
          default:
            break;
        }
      }
    }
    return super.dispatchKeyEvent(e);
  }

  /* ===================== Cierre ===================== */
  private void releaseEngines() {
    try { releaseVlc(); } catch (Throwable t) { /* ignorar */ }
    try { releaseMpv(); } catch (Throwable t) { /* ignorar */ }
  }

  @Override
  protected void onPause() {
    try {
      if (started) {
        if (isVlc()) { if (!paused()) call(vlcMp, "pause"); }
        else if (!paused()) mpvCmd("cycle", "pause");
      }
    } catch (Throwable t) { /* ignorar */ }
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    destroyed = true;
    h.removeCallbacksAndMessages(null);
    releaseEngines();
    super.onDestroy();
    if (isFinishing()) NativePlayerPlugin.emitClosed();
  }
}
ALTJAVA

mkdir -p android/app/src/main/assets
mkdir -p android/app/src/main/assets/fonts
cp fonts/*.ttf android/app/src/main/assets/fonts/ 2>/dev/null || true
cat > $PKG/RemoteSetupPlugin.java <<'RSJAVA'
package com.glystv.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

@CapacitorPlugin(name = "RemoteSetup")
public class RemoteSetupPlugin extends Plugin {
  private ServerSocket server;
  private String token = "";
  private String prefill = "";
  private int port = 0;

  @PluginMethod
  public synchronized void start(PluginCall call) {
    String s = call.getString("s", "");
    prefill = s == null ? "" : s;
    try {
      if (server == null || server.isClosed()) {
        token = String.valueOf(100000 + new SecureRandom().nextInt(900000));
        server = null;
        for (int p = 8765; p < 8785 && server == null; p++) {
          try { server = new ServerSocket(p); port = p; } catch (Exception e) { }
        }
        if (server == null) { call.reject("Sin puerto libre"); return; }
        final ServerSocket ss = server;
        Thread t = new Thread(() -> loop(ss));
        t.setDaemon(true);
        t.start();
      }
      String ip = localIp();
      if (ip == null) { call.reject("Sin red local Wi-Fi o Ethernet"); return; }
      JSObject o = new JSObject();
      o.put("url", "http://" + ip + ":" + port + "/?k=" + token);
      call.resolve(o);
    } catch (Exception e) {
      call.reject(String.valueOf(e.getMessage()));
    }
  }

  @PluginMethod
  public void stop(PluginCall call) {
    closeServer();
    call.resolve();
  }

  @Override
  protected void handleOnDestroy() {
    closeServer();
  }

  private synchronized void closeServer() {
    try { if (server != null) server.close(); } catch (Exception e) { }
    server = null;
  }

  private void loop(ServerSocket ss) {
    while (!ss.isClosed()) {
      try {
        Socket c = ss.accept();
        c.setSoTimeout(5000);
        handle(c);
      } catch (Exception e) {
        if (ss.isClosed()) break;
      }
    }
  }

  private void handle(Socket c) {
    try {
      InputStream in = c.getInputStream();
      OutputStream out = c.getOutputStream();
      String req = readLine(in);
      if (req == null) return;
      int len = 0;
      String line;
      while ((line = readLine(in)) != null && line.length() > 0) {
        if (line.toLowerCase(Locale.ROOT).startsWith("content-length:")) {
          len = Integer.parseInt(line.substring(15).trim());
        }
      }
      String[] parts = req.split(" ");
      String method = parts[0];
      String target = parts.length > 1 ? parts[1] : "/";
      String path = target, query = "";
      int q = target.indexOf('?');
      if (q >= 0) { path = target.substring(0, q); query = target.substring(q + 1); }
      Map<String, String> qs = form(query);
      if (!token.equals(qs.get("k"))) {
        reply(out, 403, "text/plain; charset=utf-8", "Codigo invalido. Escanea de nuevo el QR de la TV.");
        return;
      }
      if (method.equals("POST") && path.equals("/send")) {
        if (len > 4096) { reply(out, 413, "text/plain; charset=utf-8", "Muy grande"); return; }
        byte[] body = new byte[len];
        int got = 0;
        while (got < len) {
          int r = in.read(body, got, len - got);
          if (r < 0) break;
          got += r;
        }
        Map<String, String> f = form(new String(body, 0, got, StandardCharsets.UTF_8));
        JSObject o = new JSObject();
        o.put("s", f.containsKey("s") ? f.get("s") : "");
        o.put("u", f.containsKey("u") ? f.get("u") : "");
        o.put("p", f.containsKey("p") ? f.get("p") : "");
        notifyListeners("remote", o);
        reply(out, 200, "text/plain; charset=utf-8", "OK");
      } else {
        reply(out, 200, "text/html; charset=utf-8", page());
      }
    } catch (Exception e) {
    } finally {
      try { c.close(); } catch (Exception e) { }
    }
  }

  private String page() throws Exception {
    InputStream is = getContext().getAssets().open("remote.html");
    ByteArrayOutputStream bo = new ByteArrayOutputStream();
    byte[] buf = new byte[2048];
    int n;
    while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
    is.close();
    String s = prefill.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    return bo.toString("UTF-8").replace("%%S%%", s);
  }

  private static void reply(OutputStream out, int code, String type, String body) throws Exception {
    byte[] b = body.getBytes(StandardCharsets.UTF_8);
    String h = "HTTP/1.1 " + code + " X\r\nContent-Type: " + type + "\r\nContent-Length: " + b.length
        + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
    out.write(h.getBytes(StandardCharsets.UTF_8));
    out.write(b);
    out.flush();
  }

  private static String readLine(InputStream in) throws Exception {
    StringBuilder sb = new StringBuilder();
    int c;
    while ((c = in.read()) >= 0) {
      if (c == '\n') break;
      if (c != '\r') sb.append((char) c);
      if (sb.length() > 4096) break;
    }
    return (c < 0 && sb.length() == 0) ? null : sb.toString();
  }

  private static Map<String, String> form(String s) {
    Map<String, String> m = new HashMap<>();
    for (String kv : s.split("&")) {
      int i = kv.indexOf('=');
      if (i < 0) continue;
      try {
        m.put(URLDecoder.decode(kv.substring(0, i), "UTF-8"), URLDecoder.decode(kv.substring(i + 1), "UTF-8"));
      } catch (Exception e) { }
    }
    return m;
  }

  private static String localIp() {
    try {
      String fallback = null;
      for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
        if (!ni.isUp() || ni.isLoopback()) continue;
        for (InetAddress a : Collections.list(ni.getInetAddresses())) {
          if (a instanceof Inet4Address && a.isSiteLocalAddress()) {
            String nm = ni.getName();
            if (nm.startsWith("wlan") || nm.startsWith("eth") || nm.startsWith("en") || nm.startsWith("rmnet")) return a.getHostAddress();
            if (fallback == null) fallback = a.getHostAddress();
          }
        }
      }
      return fallback;
    } catch (Exception e) {
      return null;
    }
  }
}
RSJAVA

cat > android/app/src/main/assets/remote.html <<'RSHTML'
<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GLYSTV</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#0a1260,#2a0e5a);font-family:system-ui,sans-serif;color:#fff;padding:16px}
form{width:100%;max-width:420px;background:#0f1014;border:1px solid #343238;border-radius:18px;padding:26px 22px}
h1{margin:0 0 4px;text-align:center;font-size:28px}h1 b{color:#e6bd58}p{margin:0 0 18px;text-align:center;color:#bbb;font-size:15px}
input[type=text],input[type=url],input[type=password]{width:100%;height:52px;margin-bottom:14px;border:1px solid #34343b;border-radius:10px;padding:0 14px;font-size:17px;color:#fff;background:#090a0d}
label{display:block;margin:0 0 16px;font-size:15px;color:#ddd}
button{width:100%;height:52px;border:0;border-radius:10px;background:linear-gradient(110deg,#c9000b,#f01824);color:#fff;font-size:17px;font-weight:700}
#m{margin-top:14px;text-align:center;font-size:15px;min-height:20px}
</style></head><body>
<form id="f" autocomplete="off"><h1>GLYS<b>TV</b></h1><p>Escribe tus datos y se enviarán a la TV</p>
<input name="s" type="url" placeholder="URL del servidor (http://...)" value="%%S%%" autocapitalize="off" autocorrect="off" required>
<input name="u" type="text" placeholder="Usuario" autocapitalize="off" autocorrect="off" required>
<input name="p" id="p" type="password" placeholder="Contraseña" autocapitalize="off" required>
<label><input type="checkbox" id="sh"> Mostrar contraseña</label>
<button id="b">ENVIAR A LA TV</button><div id="m"></div></form>
<script>
var f=document.getElementById('f'),m=document.getElementById('m'),b=document.getElementById('b');
document.getElementById('sh').onchange=function(){document.getElementById('p').type=this.checked?'text':'password'};
f.onsubmit=function(e){e.preventDefault();b.disabled=true;m.textContent='Enviando…';
fetch('send'+location.search,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(new FormData(f)).toString()})
.then(function(r){if(!r.ok)throw 0;m.textContent='✔ Enviado. Mira la TV.';m.style.color='#6fe08a'})
.catch(function(){m.textContent='No se pudo enviar. Escanea el QR otra vez.';m.style.color='#ff8a8a';b.disabled=false})};
</script></body></html>
RSHTML

if [ -f logo.png ]; then
  python3 -c "import PIL" 2>/dev/null || python3 -m pip install --quiet pillow 2>/dev/null || python3 -m pip install --quiet --break-system-packages pillow 2>/dev/null || true
  python3 - <<'ICONS' || echo "Iconos por defecto"
from PIL import Image, ImageDraw
import glob
src = Image.open('logo.png').convert('RGB')
w, h = src.size
g = src.convert('L')
px = g.load()
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
import os
USE_ICONO = os.path.exists('icono.png')
if USE_ICONO:
    emb = Image.open('icono.png').convert('RGB')
def icon(size, frac, circle=False):
    im = Image.new('RGB', (size, size), (3, 10, 20) if USE_ICONO else (0, 0, 0))
    e = emb.copy()
    k = size * frac / max(e.size)
    e = e.resize((max(1, int(e.width * k)), max(1, int(e.height * k))), Image.LANCZOS)
    im.paste(e, ((size - e.width) // 2, (size - e.height) // 2))
    if circle:
        m = Image.new('L', (size, size), 0)
        ImageDraw.Draw(m).ellipse((0, 0, size - 1, size - 1), fill=255)
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        out.paste(im, (0, 0), m)
        return out
    return im
legacy = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
fore = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
res = 'android/app/src/main/res/'
for d in legacy:
    base = res + 'mipmap-' + d + '/'
    if glob.glob(base):
        icon(legacy[d], 1.0 if USE_ICONO else 0.78).save(base + 'ic_launcher.png')
        icon(legacy[d], 0.92 if USE_ICONO else 0.70, True).save(base + 'ic_launcher_round.png')
        icon(fore[d], 0.60 if USE_ICONO else 0.50).save(base + 'ic_launcher_foreground.png')
print('iconos ok')
ICONS
fi
BGXML=android/app/src/main/res/values/ic_launcher_background.xml
[ -f "$BGXML" ] && sed -i -E 's#(<color name="ic_launcher_background">)[^<]*(</color>)#\1\#030A14\2#' "$BGXML" || true

sed -i 's#<application#<application android:usesCleartextTraffic="true"#' $MAN
sed -i 's#</application>#    <activity android:name=".PlayerActivity" android:exported="false" android:configChanges="orientation|screenSize|keyboardHidden|screenLayout|smallestScreenSize" android:theme="@android:style/Theme.Black.NoTitleBar.Fullscreen" />\n    </application>#' $MAN
sed -i 's#</application>#    <activity android:name=".AltPlayerActivity" android:exported="false" android:configChanges="orientation|screenSize|keyboardHidden|screenLayout|smallestScreenSize" android:theme="@android:style/Theme.Black.NoTitleBar.Fullscreen" />\n    </application>#' $MAN
sed -i '/^dependencies {/a\    implementation "androidx.media3:media3-exoplayer:1.9.0"\n    implementation "androidx.media3:media3-exoplayer-hls:1.9.0"\n    implementation "androidx.media3:media3-exoplayer-dash:1.9.0"\n    implementation "androidx.media3:media3-exoplayer-smoothstreaming:1.9.0"\n    implementation "androidx.media3:media3-exoplayer-rtsp:1.9.0"\n    implementation "androidx.media3:media3-ui:1.9.0"\n    implementation "org.jellyfin.media3:media3-ffmpeg-decoder:1.9.0+1"\n    implementation "org.videolan.android:libvlc-all:3.7.6"\n    implementation "dev.jdtech.mpv:libmpv:1.0.0"' android/app/build.gradle

# Compatibilidad Google TV / Android TV (sin pantalla táctil, icono en el inicio de TV)
python3 - "$MAN" <<'TVPY'
import sys
p=sys.argv[1]
s=open(p,encoding='utf-8').read()
if 'android.software.leanback' not in s:
    s=s.replace('<application','<uses-feature android:name="android.hardware.touchscreen" android:required="false"/>\n    <uses-feature android:name="android.software.leanback" android:required="false"/>\n    <application',1)
if 'LEANBACK_LAUNCHER' not in s:
    s=s.replace('<category android:name="android.intent.category.LAUNCHER" />','<category android:name="android.intent.category.LAUNCHER" />\n                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />',1)
open(p,'w',encoding='utf-8').write(s)
TVPY

python3 patch_tv.py .

# Banner de Android TV con el logo azul neon (banner.png 640x360)
if [ -f banner.png ]; then
  RESB=android/app/src/main/res
  mkdir -p "$RESB/drawable-xhdpi" "$RESB/drawable-mdpi"
  cp banner.png "$RESB/drawable-xhdpi/banner.png"
  python3 - "$MAN" <<'BANNERPY' || echo "AVISO: no se pudo preparar el banner"
import sys,re
from PIL import Image
Image.open('banner.png').convert('RGB').resize((320,180),Image.LANCZOS).save('android/app/src/main/res/drawable-mdpi/banner.png')
p=sys.argv[1]
s=open(p,encoding='utf-8').read()
if 'android:banner=' in s:
    s=re.sub(r'android:banner="[^"]*"','android:banner="@drawable/banner"',s)
else:
    s=s.replace('<application','<application android:banner="@drawable/banner"',1)
open(p,'w',encoding='utf-8').write(s)
print('banner ok')
BANNERPY
fi

npx cap sync android

# Sincronizar iOS solamente si el proyecto pudo crearse.
if [ "$IOS_READY" -eq 1 ] && [ -d ios ]; then
  npx cap sync ios
  echo "iOS sincronizado correctamente. La compilación/firma final requiere macOS + Xcode."
fi

# ===== Versión PRO: otro ID y otro nombre para convivir con GLYSTV =====
sed -E -i 's/applicationId[ =]+"[^"]*"/applicationId "com.glystv.pro"/' android/app/build.gradle
grep -q 'applicationId "com.glystv.pro"' android/app/build.gradle || { echo "ERROR: no se pudo cambiar el applicationId"; exit 1; }
STR=android/app/src/main/res/values/strings.xml
sed -i -E 's#(<string name="(app_name|title_activity_main)">)[^<]*(</string>)#\1GLYSTV PRO\3#' $STR
grep -n "GLYSTV PRO" $STR || echo "AVISO: no se encontró app_name en strings.xml"

# Core library desugaring (lo exige el decodificador FFmpeg de Jellyfin)
python3 - android/app/build.gradle <<'DESUGAR'
import sys,re
p=sys.argv[1]
s=open(p,encoding='utf-8').read()
if 'coreLibraryDesugaringEnabled' not in s:
    if re.search(r'compileOptions\s*\{',s):
        s=re.sub(r'(compileOptions\s*\{)',r'\1\n        coreLibraryDesugaringEnabled true',s,1)
    else:
        s=re.sub(r'(\nandroid\s*\{)',r'\1\n    compileOptions {\n        coreLibraryDesugaringEnabled true\n    }',s,1)
if 'desugar_jdk_libs' not in s:
    s=re.sub(r'(\ndependencies\s*\{)',r'\1\n    coreLibraryDesugaring "com.android.tools:desugar_jdk_libs:2.0.4"',s,1)
if 'media3-align' not in s:
    s+="""

// media3-align: todas las librerías media3 deben usar EXACTAMENTE la misma versión
configurations.all {
    resolutionStrategy.eachDependency { details ->
        if (details.requested.group == 'androidx.media3') {
            details.useVersion '1.9.0'
        }
    }
}
"""
if 'glystv-abi' not in s:
    s=re.sub(r'(defaultConfig\s*\{)',r'\1\n        // glystv-abi: arm64 (celulares) + armeabi-v7a (muchas TV usan Android de 32 bits); sin x86\n        ndk { abiFilters "arm64-v8a", "armeabi-v7a" }',s,1)
if 'glystv-extra-players' not in s:
    s+="""

// glystv-extra-players: VLC y MPV traen librerías nativas que se repiten
android {
    packaging {
        jniLibs {
            pickFirsts.add('**/libc++_shared.so')
            // glystv-comprimir: librerías nativas comprimidas dentro de la APK (APK más liviana)
            useLegacyPackaging = true
        }
    }
}
"""
open(p,'w',encoding='utf-8').write(s)
print('desugaring OK')
DESUGAR
# Subir Android Gradle Plugin y Gradle (Capacitor 6 trae AGP 8.2.1 / Gradle 8.2.1). SDK 36 exige AGP 8.10+ y Gradle 8.11.1+
sed -i -E "s#(com\.android\.tools\.build:gradle:)[0-9][0-9.]*#\18.10.1#" android/build.gradle
sed -i -E "s#gradle-[0-9][0-9.]*-(all|bin)\.zip#gradle-8.11.1-all.zip#" android/gradle/wrapper/gradle-wrapper.properties
grep -n "com.android.tools.build:gradle" android/build.gradle
grep -n "distributionUrl" android/gradle/wrapper/gradle-wrapper.properties

# VLC, MPV y media3 1.9 necesitan compileSdk 36; libmpv (MPV) necesita minSdk 26 (Android 8.0+, todo Google TV lo cumple) (y un AGP/Gradle más nuevos que los de Capacitor 6)
python3 - <<'SDKPY'
import re,os
p='android/variables.gradle'
if os.path.exists(p):
    s=open(p,encoding='utf-8').read()
    def bump(name,val,s):
        m=re.search(r'(%s\s*=\s*)(\d+)'%name,s)
        if m and int(m.group(2))<val:
            s=s[:m.start(2)]+str(val)+s[m.end(2):]
        return s
    s=bump('minSdkVersion',26,s)
    s=bump('compileSdkVersion',36,s)
    s=bump('targetSdkVersion',35,s)
    open(p,'w',encoding='utf-8').write(s)
    print(open(p,encoding='utf-8').read())
g='android/gradle.properties'
t=open(g,encoding='utf-8').read() if os.path.exists(g) else ''
if 'suppressUnsupportedCompileSdk' not in t:
    open(g,'a',encoding='utf-8').write('\nandroid.suppressUnsupportedCompileSdk=36\n')
SDKPY

grep -n -E "coreLibraryDesugaring|desugar_jdk" android/app/build.gradle || { echo "ERROR: no se pudo activar desugaring"; exit 1; }

cd android
chmod +x gradlew
if ./gradlew assembleDebug --no-daemon 2>&1 | tee /tmp/gradle1.log; then
  echo "Compilación OK (ExoPlayer + VLC + MPV)"
else
  echo "ERROR: la compilación falló. No se genera APK sin VLC/MPV."
  echo "===== MOTIVO DEL FALLO ====="
  grep -n -E "error:|What went wrong|Execution failed|Could not (resolve|find|get)|FAILED|Duplicate class|requires libraries|compileSdk" -A4 /tmp/gradle1.log | head -80 || true
  echo "============================"
  exit 1
fi

# Verificar que los TRES reproductores quedaron dentro de la APK
APK=app/build/outputs/apk/debug/app-debug.apk
[ -f "$APK" ] || { echo "ERROR: no existe $APK"; exit 1; }
unzip -l "$APK" > /tmp/apk_lista.txt
MISSING=0
grep -q -E "libvlc\.so" /tmp/apk_lista.txt || { echo "ERROR: VLC (libvlc.so) NO está en la APK"; MISSING=1; }
grep -q -E "libmpv\.so" /tmp/apk_lista.txt || { echo "ERROR: MPV (libmpv.so) NO está en la APK"; MISSING=1; }
grep -q -E "libffmpegJNI\.so|libffmpeg" /tmp/apk_lista.txt || { echo "ERROR: decodificador FFmpeg de ExoPlayer NO está en la APK"; MISSING=1; }
grep -q -E "classes[0-9]*\.dex" /tmp/apk_lista.txt || { echo "ERROR: la APK no tiene código (classes.dex)"; MISSING=1; }
if [ "$MISSING" -ne 0 ]; then
  echo "===== Librerías nativas que SÍ tiene la APK ====="
  grep -E "lib/.*\.so" /tmp/apk_lista.txt | head -60 || true
  exit 1
fi
echo "===== Tamaño de las librerías nativas dentro de la APK (MB) ====="
grep -E "lib/.*\.so" /tmp/apk_lista.txt | awk '{printf "%6.1f  %s\n", $1/1048576, $4}' | sort -rn | head -15
echo "VERIFICADO: ExoPlayer + VLC + MPV incluidos en la APK ($(du -h "$APK" | cut -f1))"
grep -E "lib/.*/(libvlc|libmpv|libffmpegJNI)\.so" /tmp/apk_lista.txt || true

# Diagnóstico de compatibilidad con TV (qué declara realmente la APK)
AAPT=$(ls -d "${ANDROID_HOME:-/usr/local/lib/android/sdk}"/build-tools/*/aapt 2>/dev/null | sort -V | tail -1)
if [ -n "$AAPT" ]; then
  echo "===== COMPATIBILIDAD DE LA APK (TV / procesador / Android mínimo) ====="
  "$AAPT" dump badging "$APK" > /tmp/badging.txt 2>/dev/null || true
  grep -E "^sdkVersion|^targetSdkVersion|^native-code|^launchable-activity|^leanback-launchable-activity|uses-feature.*(leanback|touchscreen)|^application-banner" /tmp/badging.txt || true
else
  echo "AVISO: no se encontró aapt para el diagnóstico"
fi
