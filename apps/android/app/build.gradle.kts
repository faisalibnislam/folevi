// Folevi for Android, native (docs/ANDROID_NATIVE_PLAN.md): Compose screens, the web engine and note editor in
// one WebView per window (the engine module), Material 3 Expressive with Folevi's colors, fonts and icons.
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

/** A Gradle property, then an environment variable, then the default (never a secret: these ship in the app). */
fun setting(name: String, env: String, default: String): String =
    (project.findProperty(name) as String?)?.takeIf { it.isNotBlank() } ?: System.getenv(env)?.takeIf { it.isNotBlank() } ?: default

fun quoted(value: String) = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

/** The unified version (version.json at the repo root, scripts/version.mjs). */
val folevi = groovy.json.JsonSlurper().parse(rootProject.file("../../version.json")) as Map<*, *>

android {
    namespace = "com.folevi.android"
    // Android 17 QPR2 (API 37.2): Compose 1.13 needs 37.1 or later.
    compileSdk {
        version = release(rootProject.extra["compileSdk"] as Int) { minorApiLevel = 2 }
    }

    defaultConfig {
        applicationId = "com.folevi.android"
        minSdk = rootProject.extra["minSdk"] as Int
        targetSdk = rootProject.extra["targetSdk"] as Int
        versionName = folevi["version"] as String
        versionCode = (folevi["build"] as Number).toInt()
    }

    buildTypes {
        debug {
            // A dev server to load instead of the built-in interface (-Pfolevi.pageUrl=http://app.localhost:3002),
            // reached from an emulator through `adb reverse`. Empty: the built-in interface.
            buildConfigField("String", "PAGE_URL", quoted(setting("folevi.pageUrl", "FOLEVI_PAGE_URL", "")))
        }
        release {
            buildConfigField("String", "PAGE_URL", quoted(""))
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    androidResources {
        // The built-in interface (apps/android/web, copied to assets/public): keep Next's "_next" folder.
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~"
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
    }
}

dependencies {
    implementation(project(":engine"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.window)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.splashscreen)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.material3.adaptive.navigation.suite)
    implementation(libs.compose.adaptive)
    implementation(libs.compose.adaptive.layout)
    implementation(libs.compose.adaptive.navigation3)
    implementation(libs.navigation3.runtime)
    implementation(libs.navigation3.ui)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
}

// The built-in interface: apps/android/web (build-shell.mjs --platform android) into assets/public.
val copyInterface by tasks.registering(Copy::class) {
    from(rootProject.file("web"))
    into(layout.projectDirectory.dir("src/main/assets/public"))
}

// Debug builds carry the contract fixtures for the demo engine (no account needed to see every layout).
val copyDemo by tasks.registering(Copy::class) {
    from(rootProject.file("../web/src/lib/engine/fixtures")) { include("*.json") }
    into(layout.projectDirectory.dir("src/debug/assets/demo"))
}

tasks.named("preBuild") { dependsOn(copyInterface, copyDemo) }
