#!/usr/bin/env bash
set -euo pipefail

# 1) Web de la app
rm -rf www android ios
mkdir www
cp index.html www/
[ -f logo.png ] && cp logo.png www/

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
      g.setColor(Color.rgb(22, 135, 255));
      g.setStroke(4, Color.WHITE);
    } else if (hl) {
      g.setColor(Color.rgb(10, 79, 152));
      g.setStroke(2, Color.rgb(86, 184, 255));
    } else {
      g.setColor(Color.argb(215, 14, 22, 34));
      g.setStroke(2, Color.argb(130, 86, 130, 180));
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
  private String firstInfo = "";
  private final Runnable clear = () -> status.setText("");

  private static final int GOLD = Color.rgb(22, 135, 255);
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
            .setConnectTimeoutMs(8000)
            .setReadTimeoutMs(8000);

    DefaultRenderersFactory rf =
        new DefaultRenderersFactory(this)
            .setExtensionRendererMode(
                DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER);

    /* Arranque más rápido: empieza con 0,5 s de vídeo en buffer (antes 2,5 s) */
    androidx.media3.exoplayer.DefaultLoadControl lc =
        new androidx.media3.exoplayer.DefaultLoadControl.Builder()
            .setBufferDurationsMs(15000, 50000, 500, 2000)
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
        if (qIdx + 1 < qUrls.length) {
          status.setText("El formato del canal no respondió. Probando automáticamente otra salida…");
          status.postDelayed(() -> {
            if (qIdx + 1 < qUrls.length) playNext();
          }, 350);
          return;
        }
        status.setText("Error de reproducción: " + info + where() + hint(info));
      }

      @Override
      public void onPlaybackStateChanged(int st) {
        if (st == Player.STATE_ENDED && qIdx + 1 < qUrls.length) playNext();
      }

      @Override
      public void onRenderedFirstFrame() {
        long sec10 = (android.os.SystemClock.elapsedRealtime() - t0) / 100;
        status.setText("Arrancó en " + (sec10 / 10) + "." + (sec10 % 10) + " s" + resumeNote + retryInfo);
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

        status.setText("Audio: " +
            (sb.length() == 0 ? "sin pista" : sb.toString()));

        status.removeCallbacks(clear);
        status.postDelayed(clear, 10000);
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
        retryInfo += "\n#" + nRetries + " a los " + sec + " s: " + msg;
        status.setText("Reintentando…" + retryInfo);
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
    z.setTextColor(GOLD);
    z.setTextSize(14);
    z.setGravity(Gravity.CENTER);
    z.setPadding(24, 12, 24, 12);
    z.setFocusable(true);
    z.setClickable(true);
    z.setOnFocusChangeListener((view, f) ->
        z.setBackgroundColor(f ? Color.argb(120, 22, 135, 255) : Color.TRANSPARENT));
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
    epgBox.setBackgroundColor(Color.argb(200, 8, 14, 24));
    epgBox.setPadding((int) (20 * dn), (int) (12 * dn), (int) (20 * dn), (int) (12 * dn));
    epgBox.setFocusable(false);
    android.graphics.Typeface tf = null;
    try { tf = android.graphics.Typeface.createFromAsset(getAssets(), "fonts/open_sans.ttf"); } catch (Exception e) { /* opcional */ }
    epgL1 = new TextView(this);
    epgL1.setTextColor(GOLD);
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
    epgBar.setProgressTintList(android.content.res.ColorStateList.valueOf(GOLD));
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
    retried = false; firstInfo = ""; resumeNote = ""; retryInfo = ""; nRetries = 0;
    if (ttlView != null) ttlView.setText((chIdx + 1) + "  " + nm);
    if (nextBtn != null) nextBtn.setVisibility(View.GONE);
    status.removeCallbacks(clear);
    status.setText("");
    start();
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
              GOLD,
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

        bar.setPlayedColor(GOLD);
        bar.setScrubberColor(GOLD);
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
    b.setTextColor(GOLD);
    b.setTextSize(14);
    b.setGravity(Gravity.CENTER);
    b.setPadding(24, 12, 24, 12);
    b.setFocusable(true);
    b.setClickable(true);
    b.setOnFocusChangeListener((view, f) ->
        b.setBackgroundColor(f ? Color.argb(120, 22, 135, 255) : Color.TRANSPARENT));
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
      col.setBackgroundColor(Color.rgb(8, 14, 24));
      TextView h = new TextView(c);
      h.setText(title.toUpperCase());
      h.setTextColor(GOLD);
      h.setTextSize(15);
      h.setPadding((int) (20 * dn), (int) (18 * dn), (int) (20 * dn), (int) (12 * dn));
      col.addView(h);
      View line = new View(c);
      line.setBackgroundColor(Color.rgb(22, 135, 255));
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
            t.setBackgroundColor(f ? Color.rgb(22, 135, 255) : Color.TRANSPARENT));
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
    new SideMenu(this)
        .setTitle("Opciones")
        .setItems(it.toArray(new String[0]), (d, w) -> {
          if (w == 0) pickVideoQuality();
          else if (w == 1) pickTrack(C.TRACK_TYPE_AUDIO);
          else if (w == 2) pickTrack(C.TRACK_TYPE_TEXT);
          else if (w == 3) pickSpeed();
          else if (w == 4) pickSleep();
          else if (w == 5) pickSkip();
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
  }
}
JAVA

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
def icon(size, frac, circle=False):
    im = Image.new('RGB', (size, size), (0, 0, 0))
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
        icon(legacy[d], 0.78).save(base + 'ic_launcher.png')
        icon(legacy[d], 0.70, True).save(base + 'ic_launcher_round.png')
        icon(fore[d], 0.50).save(base + 'ic_launcher_foreground.png')
print('iconos ok')
ICONS
fi

sed -i 's#<application#<application android:usesCleartextTraffic="true"#' $MAN
sed -i 's#</application>#    <activity android:name=".PlayerActivity" android:exported="false" android:configChanges="orientation|screenSize|keyboardHidden|screenLayout|smallestScreenSize" android:theme="@android:style/Theme.Black.NoTitleBar.Fullscreen" />\n    </application>#' $MAN
sed -i '/^dependencies {/a\    implementation "androidx.media3:media3-exoplayer:1.4.1"\n    implementation "androidx.media3:media3-exoplayer-hls:1.4.1"\n    implementation "androidx.media3:media3-ui:1.4.1"\n    implementation "org.jellyfin.media3:media3-ffmpeg-decoder:1.4.1+1"' android/app/build.gradle

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

cd android
chmod +x gradlew
./gradlew assembleDebug --no-daemon || {
  sed -i '/media3-ffmpeg-decoder/d' app/build.gradle
  ./gradlew assembleDebug --no-daemon
}