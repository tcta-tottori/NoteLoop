# NOTELOOP Watch — Pixel Watch から録音する

NOTELOOP（リポジトリ直下の Web 版 / `android/` の Android アプリ版）の録音を Pixel Watch から始められるようにする Wear OS アプリ。
構成は [WearTube](https://github.com/tcta-tottori/weartube)（単一モジュール・手動 DI・Compose for Wear OS Material3）と
[TimTra](https://github.com/tcta-tottori/TimTra)（タイル、Wearable Data Layer）に合わせている。

## できること

| モード | 時計 | スマホ（NOTELOOP 本体） | 用途 |
|---|---|---|---|
| **ウォッチ** | 録音 | 不要 | スマホを持たずに会議へ。時計内に保存し、あとでスマホの NOTELOOP へ送る |
| **ダブル** | 録音 | 録音 | 両方で同時に録音（バックアップ・音質の良い方を採用） |
| **スマホ** | 指示のみ | 録音 | 鞄の中のスマホで録音を開始 / 停止する |

- 3 つのモードは **時計のホーム画面** と **タイル（ウィジェット）** のどちらからでも選んで開始できる
- スマホ側は別アプリではなく **NOTELOOP 本体（`android/`、Ver.9.5 以降）** が受ける。時計の指示で録った音声や、時計から転送した音声は
  NOTELOOP の **履歴** に「ウォッチ録音 …」として入り、「音声をAIに送る」で議事録にできる
- ファイル名は Web 版と同じ `noteloop_yyyyMMdd_HHmmss_<watch|phone>.m4a`
- 時計の録音は m4a（AAC、44.1kHz モノラル、96 / 128 kbps）

## 画面（NOTELOOP 本体の UI に合わせた点）

- 配色は本体の `styles.css` の :root と同じマットなグレーがかった黒（`#17181B`）＋ブランドの青紫（`#7B93FF` / `#A68CFF`）
- ホーム: 上にモード選択の 3 つの丸ボタン、中央に本体と同じ **紫グラデーションのマイクボタン**（録音中は赤系に変わり、外側にリングが広がる）
- 録音中は **ウェーブ（棒グラフ）＋経過時間**、■ で停止
- アプリアイコンは本体（`android/app/src/main/res/mipmap-*`）と同じダークなマイクアイコンをそのまま使う
- タイル: 待機中は 3 モードのボタン、録音中は「● 録音中 mm:ss」（ProtoLayout の動的式で毎秒更新）と停止ボタン

## 構成

```
watch/
├── shared/   純 Kotlin。RecordMode、Data Layer のパス、PhoneStatus(JSON)、ファイル名規則
└── wear/     Wear OS（applicationId jp.tcta.noteloop、namespace jp.tcta.noteloop.wear）
    └── src/main/kotlin/jp/tcta/noteloop/wear/
        ├── record/   RecorderService（前面サービス + MediaRecorder + Ongoing Activity）、RecordingController（モード別の束ね役）
        ├── sync/     PhoneLink（スマホへ開始/停止/転送）、WearListenerService（スマホの状態受信）
        ├── tile/     RecordTileService（ウィジェット）
        ├── data/     SettingsRepository（DataStore）、RecordingRepository（filesDir/recordings）
        ├── ui/       home / recordings / settings / navigation / common（MicButton, WaveBars, ModeSelector）
        ├── AppContainer.kt   手動 DI
        └── MainActivity.kt   タイル・通知からの開始/停止を受ける

android/app/src/main/java/jp/tcta/noteloop/   （スマホ側。NOTELOOP 本体に追加した部分）
├── WatchSync.java             時計からの開始/停止、状態送信、通知（バックグラウンド起動が拒否されたとき）
├── WearListenerService.java   Data Layer の受信（メッセージ・ファイル転送）
├── RecorderPlugin.java        watch イベント、getWatchState / listWatchRecordings / discardWatchRecording / stopWatchRecording
└── RecordingService.java      開始・停止のフック（WatchSync.onRecordingStateChanged）
app.js                          importWatchRecordings / setupWatchLink（履歴への取り込みと録音中バナー）
```

## 時計 ⇔ スマホ の通信（Wearable Data Layer）

| 方向 | 種類 | パス | 内容 |
|---|---|---|---|
| 時計 → スマホ | Message | `/noteloop/record/start` | payload = モード id（`double` / `phone`） |
| 時計 → スマホ | Message | `/noteloop/record/stop` | — |
| 時計 → スマホ | Message | `/noteloop/record/query` | 状態を返してほしい |
| スマホ → 時計 | Message | `/noteloop/record/status` | `PhoneStatus` JSON（録音中か、開始時刻、エラー） |
| 時計 → スマホ | Channel | `/noteloop/transfer/<name>` | 時計の録音ファイル → スマホの `watch-recordings/` |

- ケイパビリティ名は `noteloop_phone` / `noteloop_watch`（それぞれの `res/values/wear.xml`）
- Data Layer は **同じ applicationId（`jp.tcta.noteloop`）かつ同じ署名** のアプリ同士でしか通信しないので、
  時計版も `android/app/noteloop.keystore` で署名する（`wear/build.gradle.kts`）
- ダブル録音でスマホに届かなければ時計のみで録音を続け、Toast で知らせる。スマホ録音で届かなければ開始しない

## 既知の制約（実機で確認が必要）

- **この環境では Android SDK / Google Maven に届かないためコンパイル未確認。** ビルドは GitHub Actions（`.github/workflows/watch-apk.yml`）で行う
- スマホ側は時計からの指示を **バックグラウンドで** 受けて録音サービスを起動する。Android 12+ はこれを制限することがあり、
  拒否された場合は通知を出してタップで開始できるようにしている。確実にしたい場合は端末の設定で NOTELOOP の電池の最適化を除外する
- 時計側の `wear-ongoing`（文字盤の常駐表示）、ProtoLayout の動的式、Wear Compose Material3 1.6 の API は実機で要確認
- 時計の録音は 3 時間で WakeLock が切れる（安全弁）

## ビルド・インストール

GitHub Actions が `claude/**` ブランチへの push のたびに時計版とスマホ版（ウォッチ連携入り）をビルドし、プレリリース `dev` に置く。

| ファイル | 端末 |
|---|---|
| `noteloop-watch.apk` | Pixel Watch（Wear OS） |
| `NOTELOOP.apk` | スマホ（従来の NOTELOOP と同じ署名。上書きインストール可） |

```sh
# 時計: 設定 > システム > 開発者向けオプション > ADB デバッグ / 無線デバッグ を ON
adb pair <時計のIP>:<ペアリングポート>
adb connect <時計のIP>:5555
adb install -r noteloop-watch.apk
adb logcat | grep -iE "RecorderService|PhoneLink|WearListener|RecordTile|NoteLoopWatch|NoteLoopWear"
```

ローカルでは:

```sh
cd watch
./gradlew ktlintCheck
./gradlew :wear:assembleDebug
```

Android Studio で開く場合は `watch/` をプロジェクトルートにする（AGP 9.1 / Gradle 9.5 / compileSdk 37）。
