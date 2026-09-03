# File: app/proguard-rules.pro
# Android ProGuard rules for Salvia Browxer

# Add project specific ProGuard rules here.
# You can control the set of applied configuration files with the
# proguardFiles setting in the build.gradle file.

# If you want to keep the line number information for
# debugging stacktraces, uncomment the following line:
# -keepattributes SourceFile,LineNumberTable

# To keep all activities in the app
-keep public class * extends android.app.Activity

# To keep all fragments in the app
-keep public class * extends android.app.Fragment
-keep public class * extends androidx.fragment.app.Fragment

# To keep all views in the app
-keep public class * extends android.view.View

# To keep all services in the app
-keep public class * extends android.app.Service

# To keep all broadcast receivers in the app
-keep public class * extends android.content.BroadcastReceiver

# To keep all WebViewClient implementations
-keep public class * extends android.webkit.WebViewClient

# To keep all Room database classes
-keep class androidx.room.** { *; }
-keep class * extends androidx.room.Database { *; }
-keep class * extends androidx.room.Entity { *; }
-keep class * extends androidx.room.Dao { *; }

# To keep all DataStore classes
-keep class androidx.datastore.** { *; }

# To keep all OkHttp classes
-keep class com.squareup.okhttp3.** { *; }
-keep interface com.squareup.okhttp3.** { *; }

# To keep all Media3 classes
-keep class androidx.media3.** { *; }

# To keep all FFmpegKit classes
-keep class com.arthenica.** { *; }

# To keep all Jetpack Compose classes
-keep class androidx.compose.** { *; }

# To keep all coroutines classes
-keep class kotlinx.coroutines.** { *; }

# To keep all security crypto classes
-keep class androidx.security.** { *; }

# To keep all biometric classes
-keep class androidx.biometric.** { *; }

# Keep all Parcelable classes
-keep class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator *;
}

# Keep all serializable classes
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private <fields>;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
}

# Keep all enum classes
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# Keep all R (resource) classes
-keep class **.R$* { *; }

# Keep all BuildConfig classes
-keep class **.BuildConfig { *; }

# Keep all Manifest classes
-keep class **.Manifest { *; }

# Keep all MainApplication classes
-keep class com.salvia.browxer.ui.MainApplication { *; }

# Keep all model classes
-keep class com.salvia.browxer.model.** { *; }

# Keep all browser classes
-keep class com.salvia.browxer.browser.** { *; }

# Keep all download classes
-keep class com.salvia.browxer.download.** { *; }

# Keep all parser classes
-keep class com.salvia.browxer.parser.** { *; }

# Keep all service classes
-keep class com.salvia.browxer.service.** { *; }

# Keep all security classes
-keep class com.salvia.browxer.security.** { *; }

# Keep all data classes
-keep class com.salvia.browxer.data.** { *; }

# Keep all util classes
-keep class com.salvia.browxer.util.** { *; }

# Keep all ui classes
-keep class com.salvia.browxer.ui.** { *; }

# Optimize code
-optimizations !code/simplification/arithmetic
-optimizationpasses 5
-allowaccessmodification

# Repack classes
-repackclasses

# Dontwarn for OkHttp
-dontwarn com.squareup.okhttp3.**
-dontwarn okio.**

# Dontwarn for Room
-dontwarn androidx.room.**

# Dontwarn for Media3
-dontwarn androidx.media3.**

# Dontwarn for FFmpegKit
-dontwarn com.arthenica.**

# Dontwarn for Compose
-dontwarn androidx.compose.**

# Dontwarn for Coroutines
-dontwarn kotlinx.coroutines.**

# Dontwarn for Security
-dontwarn androidx.security.**

# Dontwarn for Biometric
-dontwarn androidx.biometric.**
