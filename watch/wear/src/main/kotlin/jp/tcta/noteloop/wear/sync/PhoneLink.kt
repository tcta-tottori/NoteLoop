package jp.tcta.noteloop.wear.sync

import android.content.Context
import android.net.Uri
import android.util.Log
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.CapabilityInfo
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.Wearable
import jp.tcta.noteloop.shared.PhoneStatus
import jp.tcta.noteloop.shared.RecordMode
import jp.tcta.noteloop.shared.SyncPaths
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout
import java.io.File

/** スマホへの送信結果。 */
enum class SendResult { SENT, NO_PHONE, FAILED }

/**
 * Wearable Data Layer でスマホ側アプリとやり取りする。
 * - 録音の開始 / 停止 / 状態問い合わせを MessageClient で送る
 * - スマホからの状態は [WearListenerService] が受け取り [phoneStatus] に入れる
 * - 時計で録った音声は ChannelClient でスマホへ送る
 * スマホが無い・Play 開発者サービスが無い場合は失敗を返すだけで、ウォッチ単体録音は影響を受けない。
 */
class PhoneLink(
    private val context: Context,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val messageClient get() = Wearable.getMessageClient(context)
    private val capabilityClient get() = Wearable.getCapabilityClient(context)
    private val channelClient get() = Wearable.getChannelClient(context)

    private val mutablePhoneStatus = MutableStateFlow<PhoneStatus?>(null)
    val phoneStatus: StateFlow<PhoneStatus?> = mutablePhoneStatus

    private val mutableReachable = MutableStateFlow(false)
    val phoneReachable: StateFlow<Boolean> = mutableReachable

    private val capabilityListener = CapabilityClient.OnCapabilityChangedListener { info -> updateReachable(info) }

    init {
        runCatching { capabilityClient.addListener(capabilityListener, SyncPaths.CAPABILITY_PHONE) }
            .onFailure { Log.w(TAG, "ケイパビリティの監視を開始できません（Play 開発者サービス無し?）: ${it.message}") }
        refreshReachability()
    }

    fun onPhoneStatus(status: PhoneStatus) {
        val current = mutablePhoneStatus.value
        if (current == null || status.sentAt >= current.sentAt) mutablePhoneStatus.value = status
    }

    fun updateReachable(info: CapabilityInfo) {
        mutableReachable.value = info.nodes.isNotEmpty()
    }

    fun refreshReachability() {
        scope.launch {
            mutableReachable.value = runCatching { findPhone() != null }.getOrDefault(false)
        }
    }

    suspend fun sendStart(mode: RecordMode): SendResult = send(SyncPaths.RECORD_START, mode.id.toByteArray(Charsets.UTF_8))

    suspend fun sendStop(): SendResult = send(SyncPaths.RECORD_STOP, ByteArray(0))

    suspend fun queryStatus(): SendResult = send(SyncPaths.RECORD_QUERY, ByteArray(0))

    /** 時計内のファイルをスマホの「Recordings/NoteLoop」へ送る。 */
    suspend fun sendFile(file: File): SendResult {
        val node = runCatching { findPhone() }.getOrNull() ?: return SendResult.NO_PHONE
        return runCatching {
            withTimeout(TRANSFER_TIMEOUT_MS) {
                val channel = channelClient.openChannel(node.id, SyncPaths.transferPath(file.name)).await()
                try {
                    channelClient.sendFile(channel, Uri.fromFile(file)).await()
                } finally {
                    // sendFile は送信完了で戻る。閉じてスマホ側の onInputClosed を発火させる
                    channelClient.close(channel).await()
                }
            }
            SendResult.SENT
        }.getOrElse {
            Log.w(TAG, "ファイル転送に失敗: ${it.message}")
            SendResult.FAILED
        }
    }

    private suspend fun send(
        path: String,
        payload: ByteArray,
    ): SendResult {
        val node = runCatching { findPhone() }.getOrNull() ?: return SendResult.NO_PHONE
        return runCatching {
            withTimeout(MESSAGE_TIMEOUT_MS) { messageClient.sendMessage(node.id, path, payload).await() }
            SendResult.SENT
        }.getOrElse {
            Log.w(TAG, "送信に失敗（$path）: ${it.message}")
            SendResult.FAILED
        }
    }

    /** スマホ側アプリを持つノード。近くにある（BT 直結）ものを優先する。 */
    private suspend fun findPhone(): Node? {
        val info =
            withTimeout(MESSAGE_TIMEOUT_MS) {
                capabilityClient.getCapability(SyncPaths.CAPABILITY_PHONE, CapabilityClient.FILTER_REACHABLE).await()
            }
        val nodes = info.nodes
        mutableReachable.value = nodes.isNotEmpty()
        return nodes.firstOrNull { it.isNearby } ?: nodes.firstOrNull()
    }

    private companion object {
        const val TAG = "PhoneLink"
        const val MESSAGE_TIMEOUT_MS = 6_000L
        const val TRANSFER_TIMEOUT_MS = 180_000L
    }
}
