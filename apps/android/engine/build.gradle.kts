// The engine bridge (docs/ANDROID_NATIVE_PLAN.md section 4): the generated contract (scripts/engine-codegen-kotlin.mjs),
// the client, its stores and the WebView transport. The Android twin of apps/native-kit's FoleviEngine.
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.folevi.engine"
    compileSdk = rootProject.extra["compileSdk"] as Int
    defaultConfig {
        minSdk = rootProject.extra["minSdk"] as Int
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
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
    api(libs.kotlinx.serialization.json)
    api(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.webkit)
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}

// The contract fixtures (apps/web/src/lib/engine/fixtures) are what the engine tests decode.
tasks.withType<Test>().configureEach {
    systemProperty("folevi.fixtures", rootProject.file("../web/src/lib/engine/fixtures").absolutePath)
}
