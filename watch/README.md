# NOTELOOP Watch — Pixel Watch から録音する

NOTELOOP（`android/` の Android アプリ版）と組で使う Wear OS の録音アプリ。録音は **時計の中で完結** し、
録った音声を「スマホへ送る」と NOTELOOP の履歴に入る。
構成は [WearTube](https://github.com/tcta-tottori/weartube)（単一モジュール・手動 DI・Compose for Wear OS Material3）と
[TimTra](https://github.com/tcta-tottori/TimTra)（タイル、Wearable Data Layer）に合わせている。

## 画面と操作

スクロールしない 1 画面。中央に **大きな紫グラデーションの録音ボタン**（NOTELOOP 本体のマイクボタンと同じ色。録音中も紫のまま）。

| 状態 | 表示 | 操作 |
|---|---|---|
| 待機中 | ボタンにマイク。上にロゴ、下に「タップで録音」、右下に録音一覧への小さなボタン | タップで録音開始 |
| 録音中 | ボタンの中に **音量で動くゲージバー（5 本）**。上に「録音中」と経過時間 | **タップで一時停止**、もう一度タップで再開、**2 秒長押しで停止**（長押し中はボタンの外周にリングが伸びる） |
| 一時停止中 | ゲージは最小、上に「一時停止中」（経過時間は止まる） | タップで再開、長押しで停止 |

- タイル（ウィジェット）は **大きな紫のボタン 1 つ**。待機中はタップで録音開始（アプリが開いて権限確認のうえ開始）、
  録音中は「● 録音中 mm:ss」を表示しタップでアプリを開く
- 録音中は文字盤にマイクの常駐表示（Ongoing Activity）が出て、タップでアプリに戻れる。通知からも停止できる
- 録音一覧: 再生 / **スマホへ送る** / 削除。送った音声はスマホの NOTELOOP（Ver.9.5 以降）の履歴に「ウォッチ録音 …」として入り、
  「音声をAIに送る」で議事録にできる
- 音声は m4a（AAC、44.1kHz モノラル 96 kbps）。ファイル名は本体と同じ `noteloop_yyyyMMdd_HHmmss_watch.m4a`
- アプリアイコンは本体（`android/app/src/main/res/mipmap-*`）と同じダークなマイクアイコン

## 構成

```
watch/
├── shared/   純 Kotlin。Data Layer のパス、ファイル名規則
└── wear/     Wear OS（applicationId jp.tcta.noteloop、namespace jp.tcta.noteloop.wear）
    └── src/main/kotlin/jp/tcta/noteloop/wear/
        ├── record/   RecorderService（前面サービス + MediaRecorder、一時停止/再開、Ongoing Activity）、RecordingController
        ├── sync/     PhoneLink（スマホへのファイル転送）
        ├── tile/     RecordTileService（ウィジェット）
        ├── data/     RecordingRepository（filesDir/recordings）
        ├── ui/       home（RecordButton: タップ/長押し、ゲージ）/ recordings / navigation / common
        ├── AppContainer.kt   手動 DI
        └── MainActivity.kt   タイル・通知からの開始/停止を受ける

android/app/src/main/java/jp/tcta/noteloop/   （スマホ側。NOTELOOP 本体に追加した部分）
├── WatchSync.java             転送パスと置き場（watch-recordings/）
├── WearListenerService.java   Data Layer のファイル受信
└── RecorderPlugin.java        watch イベント、listWatchRecordings / discardWatchRecording
app.js                          importWatchRecordings / setupWatchLink（履歴への取り込み）
```

## 時計 → スマホ の通信（Wearable Data Layer）

| 方向 | 種類 | パス | 内容 |
|---|---|---|---|
| 時計 → スマホ | Channel | `/noteloop/transfer/<name>` | 時計の録音ファイル → スマホの `watch-recordings/` → 履歴 |

- ケイパビリティ名は `noteloop_phone` / `noteloop_watch`（それぞれの `res/values/wear.xml`）
- Data Layer は **同じ applicationId（`jp.tcta.noteloop`）かつ同じ署名** のアプリ同士でしか通信しないので、
  時計版も `android/app/noteloop.keystore` で署名する（`wear/build.gradle.kts`）
- スマホが無くても録音はできる。転送だけが失敗し、Toast で知らせる

## 既知の制約（実機で確認が必要）

- **この環境では Android SDK / Google Maven に届かないためコンパイル未確認。** ビルドは GitHub Actions（`.github/workflows/watch-apk.yml`）で行う
- 時計側の `wear-ongoing`（文字盤の常駐表示、一時停止の表示更新）、ProtoLayout の動的式、Wear Compose Material3 1.6 の API は実機で要確認
- 長押し 2 秒は `detectTapGestures` の onPress で計っている。押したまま画面外へ指が出ると停止扱いにならない（離した扱い）
- 録音は 3 時間で WakeLock が切れる（安全弁）

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
adb logcat | grep -iE "RecorderService|PhoneLink|RecordTile|NoteLoopWear"
```

ローカルでは:

```sh
cd watch
./gradlew ktlintCheck
./gradlew :wear:assembleDebug
```

Android Studio で開く場合は `watch/` をプロジェクトルートにする（AGP 9.1 / Gradle 9.5 / compileSdk 37）。
