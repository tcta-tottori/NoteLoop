package jp.tcta.noteloop.wear.record

import android.content.Context
import androidx.wear.tiles.TileService
import jp.tcta.noteloop.shared.PhoneStatus
import jp.tcta.noteloop.shared.RecordMode
import jp.tcta.noteloop.wear.data.SettingsRepository
import jp.tcta.noteloop.wear.sync.PhoneLink
import jp.tcta.noteloop.wear.sync.SendResult
import jp.tcta.noteloop.wear.tile.RecordTileService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** 開始の結果。ホーム画面が Toast 文言に変換する。 */
enum class StartResult {
    STARTED,

    /** ダブル録音でスマホに届かず、ウォッチのみで始めた。 */
    STARTED_WATCH_ONLY,

    /** スマホ録音でスマホに届かなかった。 */
    NO_PHONE,

    /** 既に録音中。 */
    ALREADY_RECORDING,
}

/**
 * 録音セッションの入口。モードごとに「時計の RecorderService」と「スマホへの指示」を束ねる。
 *
 * | モード | 時計 | スマホ |
 * |---|---|---|
 * | WATCH  | 録音 | 何もしない |
 * | DOUBLE | 録音 | 開始 / 停止を送る（届かなければ時計のみ） |
 * | PHONE  | 何もしない | 開始 / 停止を送る（届かなければ失敗） |
 */
class RecordingController(
    private val context: Context,
    private val recorderState: RecorderStateStore,
    private val phoneLink: PhoneLink,
    private val settings: SettingsRepository,
) {
    private val mutableSession = MutableStateFlow<RecordingSession?>(null)
    val session: StateFlow<RecordingSession?> = mutableSession

    suspend fun start(mode: RecordMode): StartResult {
        if (mutableSession.value != null) return StartResult.ALREADY_RECORDING
        var effectiveMode = mode
        var result = StartResult.STARTED
        if (mode.recordsOnPhone && phoneLink.sendStart(mode) != SendResult.SENT) {
            // 届かなければ、スマホのみ録音は失敗、ダブル録音はウォッチのみで続ける
            if (mode == RecordMode.PHONE) return StartResult.NO_PHONE
            effectiveMode = RecordMode.WATCH
            result = StartResult.STARTED_WATCH_ONLY
        }
        if (effectiveMode.recordsOnWatch) {
            RecorderService.start(context, settings.currentQuality())
        }
        mutableSession.value = RecordingSession(effectiveMode, System.currentTimeMillis())
        settings.setDefaultMode(mode)
        requestTileUpdate()
        return result
    }

    suspend fun stop() {
        val current = mutableSession.value ?: return
        if (current.mode.recordsOnWatch || recorderState.state.value.recording) RecorderService.stop(context)
        if (current.mode.recordsOnPhone) phoneLink.sendStop()
        mutableSession.value = null
        requestTileUpdate()
    }

    /** スマホ側の状態を受けて、スマホのみ録音がスマホ側で止まったらセッションも閉じる。 */
    fun onPhoneStatus(status: PhoneStatus) {
        val current = mutableSession.value ?: return
        if (current.mode == RecordMode.PHONE && !status.recording && status.sentAt > current.startedAt + PHONE_GRACE_MS) {
            mutableSession.value = null
            requestTileUpdate()
        }
    }

    /** 時計側のサービスが（エラー等で）止まったのにセッションが残っていたら閉じる。 */
    fun onWatchRecorderStopped() {
        val current = mutableSession.value ?: return
        if (current.mode == RecordMode.WATCH) {
            mutableSession.value = null
            requestTileUpdate()
        }
    }

    private fun requestTileUpdate() {
        TileService.getUpdater(context).requestUpdate(RecordTileService::class.java)
    }

    private companion object {
        /** 開始直後にスマホから届く「まだ停止中」の古い状態でセッションを閉じないための猶予。 */
        const val PHONE_GRACE_MS = 3_000L
    }
}
