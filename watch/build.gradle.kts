// ルートでは各プラグインのバージョンだけを解決し、適用は各モジュールで行う。
// AGP 9 は Kotlin を内蔵するため org.jetbrains.kotlin.android は使わない。
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.compose.compiler) apply false
    alias(libs.plugins.ktlint) apply false
}
