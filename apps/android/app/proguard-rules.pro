# Folevi for Android release rules (R8). Libraries bring their own consumer rules (kotlinx.serialization, Tink,
# ML Kit, Firebase, Glance, WorkManager); these keep what Folevi reaches by reflection or by name.

# The host bridge finds plugins and their methods by annotation and calls them by name (bridge/Plugin.kt).
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault,Signature,InnerClasses,EnclosingMethod
-keep @com.folevi.android.bridge.annotation.BridgePlugin class * { *; }
-keep @interface com.folevi.android.bridge.annotation.**
-keep @interface com.folevi.android.bridge.PluginMethod
-keepclassmembers class * {
    @com.folevi.android.bridge.PluginMethod <methods>;
    @com.folevi.android.bridge.annotation.PermissionCallback <methods>;
}

# The bridge contract (generated from protocol.ts) is decoded with kotlinx.serialization: keep the generated
# serializers and the companions that hand them out.
-keep,includedescriptorclasses class com.folevi.engine.generated.**$$serializer { *; }
-keepclassmembers class com.folevi.engine.generated.** {
    *** Companion;
}
-keepclasseswithmembers class com.folevi.engine.generated.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Navigation 3 saves the back stack's keys with kotlinx.serialization.
-keep,includedescriptorclasses class com.folevi.android.ui.**$$serializer { *; }
-keepclassmembers class com.folevi.android.ui.** {
    *** Companion;
}
-keepclasseswithmembers class com.folevi.android.ui.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# org.json is the platform's; okhttp's optional platforms aren't on Android.
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
