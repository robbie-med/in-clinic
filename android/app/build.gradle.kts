plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.robbiemed.clinic"
    compileSdk = 36
    defaultConfig {
        applicationId = "org.robbiemed.clinic"
        minSdk = 33
        targetSdk = 36
        versionCode = 2
        versionName = "0.2"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlin { jvmToolchain(17) }
    testOptions { unitTests.isReturnDefaultValues = true }
    // The debug APK is the daily driver: debuggable ART runs ~6x slower on taps (measured 117 ms vs 20 ms on a Pixel)
    buildTypes { getByName("debug") { isDebuggable = false } }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
