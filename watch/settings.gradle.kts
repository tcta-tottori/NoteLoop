pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
        // Android 系のグループだけ Google Maven を見る（無関係な依存で問い合わせない）
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
    }
}

rootProject.name = "noteloop-watch"

// shared : Android 非依存の純 Kotlin。録音モードと Data Layer のメッセージ定義
// wear   : Wear OS（Pixel Watch）。録音、タイル、スマホ（NoteLoop 本体 android/）への指示
// スマホ側は別モジュールにせず、リポジトリ直下 android/ の NoteLoop 本体（Capacitor）に組み込んである。
include(":shared")
include(":wear")
