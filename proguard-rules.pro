# --- Capacitor ---
-keep class com.getcapacitor.** { *; }
-keep class com.getcapacitor.plugin.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public *;
}

# --- GLYSTV ---
-keep class com.glystv.app.** { *; }

# --- Media3 / ExoPlayer ---
-keep class androidx.media3.** { *; }
-dontwarn androidx.media3.**
-keep class org.jellyfin.media3.** { *; }
-dontwarn org.jellyfin.media3.**

# --- WebView JS interface ---
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# --- JSON ---
-keep class org.json.** { *; }

# --- Plugins ---
-keepnames class * extends com.getcapacitor.Plugin
