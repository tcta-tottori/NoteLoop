plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.ktlint)
}

// Android SDK に依存しない純 Kotlin/JVM モジュール。
// Data Layer のパスとファイル名の規則をここに集約し、スマホ側（Java）と同じ定義を保つ。
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}
kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}
