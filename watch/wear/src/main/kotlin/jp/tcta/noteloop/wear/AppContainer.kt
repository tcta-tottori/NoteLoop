package jp.tcta.noteloop.wear

import android.content.Context
import jp.tcta.noteloop.wear.data.RecordingRepository
import jp.tcta.noteloop.wear.data.SettingsRepository
import jp.tcta.noteloop.wear.record.PendingActionStore
import jp.tcta.noteloop.wear.record.RecorderStateStore
import jp.tcta.noteloop.wear.record.RecordingController
import jp.tcta.noteloop.wear.sync.PhoneLink

/** 手動 DI の置き場。各 ViewModel / Service はここから必要なものを受け取る。 */
class AppContainer(
    context: Context,
) {
    private val appContext = context.applicationContext

    val settings = SettingsRepository(appContext)
    val recordings = RecordingRepository(appContext)

    /** 時計側の録音状態（RecorderService が更新し、UI とタイルが読む）。 */
    val recorderState = RecorderStateStore()

    /** スマホとの通信（録音指示・状態受信・ファイル転送）。 */
    val phoneLink = PhoneLink(appContext)

    /** 録音セッションの入口。モードに応じて時計の録音サービスとスマホへの指示を束ねる。 */
    val controller = RecordingController(appContext, recorderState, phoneLink, settings)

    /** タイルからの「開始 / 停止」を MainActivity 経由で受け取り、ホーム画面が消費する。 */
    val pendingAction = PendingActionStore()
}
