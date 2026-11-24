# Folevi mobile (Capacitor) release rules (R8). Libraries bring their own consumer rules (Capacitor, Tink, ML Kit,
# Firebase, Glance, WorkManager); these keep what Capacitor reaches by reflection or by name.

# Capacitor finds the plugins and their methods by annotation and calls them by name.
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault,Signature,InnerClasses,EnclosingMethod
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keep public class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public <methods>;
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
}
-keep class com.getcapacitor.** { *; }

# org.json is the platform's; okhttp's optional platforms aren't on Android.
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
