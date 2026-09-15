plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
    alias(libs.plugins.ktlint)
}

android {
    namespace = "jp.tcta.noteloop.wear"
    compileSdk = 37

    defaultConfig {
        // Wearable Data Layer はスマホ側と同じ applicationId・同じ署名のアプリ同士でしか通信しない。
        // スマホ側は NoteLoop 本体（../android、Capacitor）なので、それに揃える
        applicationId = "jp.tcta.noteloop"
        minSdk = 30
        targetSdk = 35
        // CI では GITHUB_RUN_NUMBER をビルド番号にする（設定画面で見分ける）
        val ciRun = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1
        versionCode = ciRun
        versionName = "0.1.$ciRun"
    }

    // NoteLoop 本体（android/app/build.gradle）と同じ鍵で署名する。
    // 鍵が違うと Data Layer で通信できず、CI のたびに鍵が変わると上書きインストールもできない
    signingConfigs {
        getByName("debug") {
            storeFile = rootProject.file("../android/app/noteloop.keystore")
            storePassword = "noteloop"
            keyAlias = "noteloop"
            keyPassword = "noteloop"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("debug")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(project(":shared"))

    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.datastore.preferences)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.wear.compose.material3)
    implementation(libs.wear.compose.foundation)
    implementation(libs.wear.compose.navigation)
    implementation(libs.wear.tooling.preview)

    // タイル（ウィジェット）
    implementation(libs.wear.tiles)
    implementation(libs.wear.protolayout)
    implementation(libs.wear.protolayout.expression)
    implementation(libs.concurrent.futures.ktx)
    // 録音中の常駐表示（Ongoing Activity）
    implementation(libs.wear.ongoing)
    // Data Layer（スマホへの録音指示・状態受信・ファイル転送）
    implementation(libs.play.services.wearable)
    implementation(libs.kotlinx.coroutines.play.services)
}
