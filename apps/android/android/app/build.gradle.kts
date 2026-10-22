// Folevi for Android: the app module (Kotlin, AGP's built-in Kotlin). docs/ANDROID_PLAN.md, apps/android/README.md.
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

/** A Gradle property, then an environment variable, then the default (never a secret: these ship in the app). */
fun setting(name: String, env: String, default: String): String =
    (project.findProperty(name) as String?)?.takeIf { it.isNotBlank() } ?: System.getenv(env)?.takeIf { it.isNotBlank() } ?: default

fun quoted(value: String) = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "com.folevi.android"
    compileSdk = rootProject.extra["compileSdkVersion"] as Int

    defaultConfig {
        applicationId = "com.folevi.android"
        minSdk = rootProject.extra["minSdkVersion"] as Int
        targetSdk = rootProject.extra["targetSdkVersion"] as Int
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // OAuth client ids are public (they ship in every copy of the app) but come from the build, never the
        // repository (docs/LOCAL_MODE.md "Owner setup checklist"; apps/android/README.md). Empty hides the option.
        buildConfigField("String", "DROPBOX_APP_KEY", quoted(setting("folevi.dropboxAppKey", "FOLEVI_DROPBOX_APP_KEY", "")))
        buildConfigField("String", "GOOGLE_ANDROID_CLIENT_ID", quoted(setting("folevi.googleAndroidClientId", "FOLEVI_GOOGLE_ANDROID_CLIENT_ID", "")))
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
            // Signing for Play (an upload key kept outside the repository) is set up by the owner: README "Release".
        }
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    androidResources {
        // The built-in interface's files (web/ copied to assets/public): keep files whose names start with "_"
        // (Next's /_next folder) and dots; omit only version-control and OS clutter.
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~"
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
    }
}

dependencies {
    implementation(project(":capacitor-android"))
    implementation(project(":capacitor-cordova-android-plugins"))
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.coordinatorlayout)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.splashscreen)
    implementation(libs.androidx.biometric)
    implementation(libs.androidx.window)
    implementation(libs.okhttp)
    // Google Drive: Google's authorization for the drive.file scope on Android (no client secret, no redirect).
    implementation(libs.play.services.auth)
    // Foli AI on the device: Gemini Nano through ML Kit's GenAI Prompt API, where the phone's AICore has it.
    implementation(libs.mlkit.genai.prompt)
    // Home screen widgets (Glance, which draws with Compose).
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.runtime)
    implementation(libs.glance.appwidget)

    testImplementation(libs.junit)
    testImplementation(libs.orgjson)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.uiautomator)
}

apply(from = "capacitor.build.gradle")

// The bridge's TypeScript half (apps/android/bridge with packages/cloud-folders) into assets/folevi-cloud.js.
val bundleBridge by tasks.registering(Exec::class) {
    description = "Builds assets/folevi-cloud.js from apps/android/bridge (esbuild)."
    workingDir = rootProject.projectDir.parentFile
    commandLine("node", "scripts/bundle-bridge.mjs")
    inputs.dir(rootProject.projectDir.parentFile.resolve("bridge"))
    inputs.dir(rootProject.projectDir.parentFile.resolve("../../packages/cloud-folders/src"))
    outputs.file(layout.projectDirectory.file("src/main/assets/folevi-cloud.js"))
}
tasks.named("preBuild") { dependsOn(bundleBridge) }
