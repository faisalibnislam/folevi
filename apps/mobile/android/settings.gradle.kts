// Folevi for Android (docs/ANDROID_PLAN.md). The app module is Kotlin with a version catalog
// (gradle/libs.versions.toml); Capacitor's own modules (node_modules) keep their Groovy build files, and
// capacitor.settings.gradle / app/capacitor.build.gradle are written by `npx cap sync`.
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

rootProject.name = "Folevi"

include(":app")
include(":capacitor-cordova-android-plugins")
project(":capacitor-cordova-android-plugins").projectDir = file("capacitor-cordova-android-plugins")

apply(from = "capacitor.settings.gradle")
