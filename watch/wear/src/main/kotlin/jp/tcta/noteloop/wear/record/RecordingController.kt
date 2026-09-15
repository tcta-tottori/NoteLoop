package jp.tcta.noteloop.wear.record

import android.content.Context

/** 録音操作の入口。ホーム画面・タイル・通知からはここを通す（ウォッチ単体録音のみ）。 */
class RecordingController(
    private val context: Context,
    private val recorderState: RecorderStateStore,
) {
    val isRecording: Boolean get() = recorderState.state.value.recording

    fun start() {
        if (isRecording) return
        RecorderService.start(context)
    }

    /** 録音中のタップ: 一時停止 ⇔ 再開。 */
    fun togglePause() {
        val s = recorderState.state.value
        if (!s.recording) return
        if (s.paused) RecorderService.resume(context) else RecorderService.pause(context)
    }

    /** 長押し: 停止して保存。 */
    fun stop() {
        if (!isRecording) return
        RecorderService.stop(context)
    }
}
