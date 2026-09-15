package jp.tcta.noteloop.wear.record

import jp.tcta.noteloop.shared.RecordMode
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** 時計側の録音サービスの状態。 */
data class RecorderState(
    val recording: Boolean = false,
    /** 録音開始時刻（epoch ms）。停止中は 0。 */
    val startedAt: Long = 0L,
    /** 直近の入力レベル（0..1）。波形アニメーション用に最新 [WAVE_SAMPLES] 個を保持。 */
    val levels: List<Float> = emptyList(),
    /** 直近に保存したファイル名。停止直後の「保存しました」表示に使う。 */
    val lastSavedName: String? = null,
    /** 録音の開始に失敗したときの理由。 */
    val error: String? = null,
) {
    companion object {
        const val WAVE_SAMPLES = 28
    }
}

/** [RecorderService] が書き、UI とタイルが読む。プロセス内で 1 つ。 */
class RecorderStateStore {
    private val mutableState = MutableStateFlow(RecorderState())
    val state: StateFlow<RecorderState> = mutableState

    fun update(transform: (RecorderState) -> RecorderState) {
        mutableState.value = transform(mutableState.value)
    }

    fun pushLevel(level: Float) {
        update { s -> s.copy(levels = (s.levels + level.coerceIn(0f, 1f)).takeLast(RecorderState.WAVE_SAMPLES)) }
    }
}

/** 録音セッション（ユーザーが「開始」してから「停止」するまで）。 */
data class RecordingSession(
    val mode: RecordMode,
    val startedAt: Long,
)

/** タイル / 通知からの操作。MainActivity が受け取り、ホーム画面が権限確認の上で実行する。 */
sealed interface PendingAction {
    data class Start(
        val mode: RecordMode,
    ) : PendingAction

    data object Stop : PendingAction
}

class PendingActionStore {
    private val mutableAction = MutableStateFlow<PendingAction?>(null)
    val action: StateFlow<PendingAction?> = mutableAction

    fun post(action: PendingAction) {
        mutableAction.value = action
    }

    fun consume() {
        mutableAction.value = null
    }
}
