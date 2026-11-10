# Mantener clases de Capacitor
-keep class com.getcapacitor.** { *; }
-keep class com.getcapacitor.bridge.** { *; }

# Mantener clases de Media3 / ExoPlayer y FFmpeg
-keep class androidx.media3.** { *; }
-keep class org.jellyfin.media3.** { *; }
-keep class com.glystv.app.** { *; }

# Reglas generales de optimización
-optimizationpasses 5
-dontusemixedcaseclassnames
-dontskipnonpubliclibraryclasses
-verbose
