// Folevi for Android, native: the root build.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    // Pins the Kotlin that AGP's built-in Kotlin compiles with, and the Compose and serialization compiler plugins.
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}

extra.apply {
    set("minSdk", 33)
    set("compileSdk", 37)
    set("targetSdk", 36)
}
