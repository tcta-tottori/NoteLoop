package jp.tcta.noteloop.wear

import android.content.Context
import jp.tcta.noteloop.wear.data.RecordingRepository
import jp.tcta.noteloop.wear.record.PendingActionStore
import jp.tcta.noteloop.wear.record.RecorderStateStore
import jp.tcta.noteloop.wear.record.RecordingController
import jp.tcta.noteloop.wear.sync.PhoneLink

/** 手動 DI の置き場。各 ViewModel / Service はここから必要なものを受け取る。 */
class AppContainer(
    context: Context,
) {
    private val appContext = context.applicationContext

    val recordings = RecordingRepository(appContext)

    /** 時計側の録音状態（RecorderService が更新し、UI とタイルが読む）。 */
    val recorderState = RecorderStateStore()

    /** スマホ（NOTELOOP 本体）へのファイル転送。 */
    val phoneLink = PhoneLink(appContext)

    /** 録音操作の入口（開始 / 一時停止 / 再開 / 停止）。 */
    val controller = RecordingController(appContext, recorderState)

    /** タイルからの「開始 / 停止」を MainActivity 経由で受け取り、ホーム画面が消費する。 */
    val pendingAction = PendingActionStore()
}
