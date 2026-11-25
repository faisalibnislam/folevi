// Folevi for Android: the root build. Capacitor's library modules read these values (rootProject.ext).
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    // Pins the Kotlin that AGP's built-in Kotlin compiles with (and the Compose compiler for the widgets).
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.google.services) apply false
}

extra.apply {
    set("minSdkVersion", 33)
    set("compileSdkVersion", 37)
    set("targetSdkVersion", 36)
    set("androidxActivityVersion", libs.versions.androidx.activity.get())
    set("androidxAppCompatVersion", libs.versions.androidx.appcompat.get())
    set("androidxCoordinatorLayoutVersion", libs.versions.androidx.coordinatorlayout.get())
    set("androidxCoreVersion", libs.versions.androidx.core.get())
    set("androidxFragmentVersion", "1.8.9")
    set("androidxWebkitVersion", libs.versions.androidx.webkit.get())
    set("coreSplashScreenVersion", libs.versions.androidx.splashscreen.get())
    set("junitVersion", libs.versions.junit.get())
    set("androidxJunitVersion", libs.versions.androidx.test.junit.get())
    set("androidxEspressoCoreVersion", "3.7.0")
    set("cordovaAndroidVersion", "14.0.1")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
