// Folevi for Android, native (docs/ANDROID_NATIVE_PLAN.md): Compose screens with the web note editor and the
// web engine in one WebView, like the iPhone and Mac apps. The Capacitor app (android/) is its own build.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "FoleviNative"

include(":engine")
// include(":app")
