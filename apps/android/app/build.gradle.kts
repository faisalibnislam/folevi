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
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // OAuth client ids are public (they ship in every copy of the app) but come from the build, never the
        // repository (docs/LOCAL_MODE.md "Owner setup checklist"; apps/android/README.md). Empty hides the option.
        buildConfigField("String", "DROPBOX_APP_KEY", quoted(setting("folevi.dropboxAppKey", "FOLEVI_DROPBOX_APP_KEY", "")))
        buildConfigField("String", "GOOGLE_ANDROID_CLIENT_ID", quoted(setting("folevi.googleAndroidClientId", "FOLEVI_GOOGLE_ANDROID_CLIENT_ID", "")))
        // The Firebase project's Android app settings, all public; without them the app has no push notifications.
        buildConfigField("String", "FIREBASE_APP_ID", quoted(setting("folevi.firebaseAppId", "FOLEVI_FIREBASE_APP_ID", "")))
        buildConfigField("String", "FIREBASE_API_KEY", quoted(setting("folevi.firebaseApiKey", "FOLEVI_FIREBASE_API_KEY", "")))
        buildConfigField("String", "FIREBASE_PROJECT_ID", quoted(setting("folevi.firebaseProjectId", "FOLEVI_FIREBASE_PROJECT_ID", "")))
        buildConfigField("String", "FIREBASE_SENDER_ID", quoted(setting("folevi.firebaseSenderId", "FOLEVI_FIREBASE_SENDER_ID", "")))
        manifestPlaceholders["appLinkHost"] = "app.folevi.com"
    }

    buildTypes {
        debug {
            // The website the app signs in with: the local dev server (reached through `adb reverse tcp:3002 tcp:3002`,
            // apps/android/README.md), or another with -Pfolevi.serviceUrl=... .
            buildConfigField("String", "SERVICE_URL", quoted(setting("folevi.serviceUrl", "FOLEVI_SERVICE_URL", "http://app.localhost:3002")))
            // Emulators can't verify App Links for a dev server: sign-in comes back on the app's own scheme.
            buildConfigField("String", "AUTH_REDIRECT_URI", quoted("com.folevi.android://auth/callback"))
        }
        release {
            buildConfigField("String", "SERVICE_URL", quoted("https://app.folevi.com"))
            buildConfigField("String", "AUTH_REDIRECT_URI", quoted("https://app.folevi.com/native/callback"))
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

    testOptions {
        unitTests.isReturnDefaultValues = true
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

    // The services moved from the Capacitor app (docs/ANDROID_NATIVE_PLAN.md section 3, "Host bridge").
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.biometric)
    implementation(libs.androidx.work)
    implementation(libs.okhttp)
    // End-to-end encryption's device keys: X25519 and Ed25519 (Tink), sealed with a Keystore key.
    implementation(libs.tink.android)
    // Google Drive: Google's authorization for the drive.file scope on Android (no client secret, no redirect).
    implementation(libs.play.services.auth)
    // Foli AI on the device: Gemini Nano through ML Kit's GenAI Prompt API, where the phone's AICore has it.
    implementation(libs.mlkit.genai.prompt)
    // Home screen widgets (Glance).
    implementation(libs.glance.appwidget)
    // The document scanner and the words in an image (ML Kit, on the phone).
    implementation(libs.mlkit.docscanner)
    implementation(libs.mlkit.text)
    // Notifications from Folevi's server (Firebase Cloud Messaging), switched on by the Firebase settings above.
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)

    testImplementation(libs.junit)
    testImplementation(libs.orgjson)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}

// The bridge's TypeScript half (apps/android/bridge with packages/cloud-folders) into assets/folevi-cloud.js.
val bundleBridge by tasks.registering(Exec::class) {
    description = "Builds assets/folevi-cloud.js from apps/android/bridge (esbuild)."
    workingDir = rootProject.projectDir
    commandLine("node", "scripts/bundle-bridge.mjs")
    inputs.dir(rootProject.file("bridge"))
    inputs.dir(rootProject.file("../../packages/cloud-folders/src"))
    outputs.file(layout.projectDirectory.file("src/main/assets/folevi-cloud.js"))
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

tasks.named("preBuild") { dependsOn(copyInterface, copyDemo, bundleBridge) }
