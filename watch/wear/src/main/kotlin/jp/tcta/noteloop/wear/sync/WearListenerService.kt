package jp.tcta.noteloop.wear.sync

import android.util.Log
import androidx.wear.tiles.TileService
import com.google.android.gms.wearable.CapabilityInfo
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import jp.tcta.noteloop.shared.PhoneStatus
import jp.tcta.noteloop.shared.SyncPaths
import jp.tcta.noteloop.wear.appContainer
import jp.tcta.noteloop.wear.tile.RecordTileService

/** スマホからの録音状態を受け取り、ホーム画面とタイルに反映する。 */
class WearListenerService : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != SyncPaths.RECORD_STATUS) return
        val status = PhoneStatus.parse(event.data)
        if (status == null) {
            Log.w(TAG, "スマホからの状態を解釈できません")
            return
        }
        appContainer.phoneLink.onPhoneStatus(status)
        appContainer.controller.onPhoneStatus(status)
        TileService.getUpdater(this).requestUpdate(RecordTileService::class.java)
    }

    override fun onCapabilityChanged(info: CapabilityInfo) {
        if (info.name == SyncPaths.CAPABILITY_PHONE) appContainer.phoneLink.updateReachable(info)
    }

    private companion object {
        const val TAG = "WearListener"
    }
}
