package jp.tcta.noteloop.wear.record

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** 時計側の録音サービスの状態。 */
data class RecorderState(
    val recording: Boolean = false,
    val paused: Boolean = false,
    /** 一時停止するまでに録った合計ミリ秒（再開のたびに積み上がる）。 */
    val elapsedBase: Long = 0L,
    /** 今の区間を録り始めた時刻（epoch ms）。一時停止中・停止中は 0。 */
    val runningSince: Long = 0L,
    /** 直近の入力レベル（0..1）。ゲージ用に最新 [LEVEL_SAMPLES] 個を保持。 */
    val levels: List<Float> = emptyList(),
    /** 直近に保存したファイル名。停止直後の「保存しました」表示に使う。 */
    val lastSavedName: String? = null,
    /** 録音の開始に失敗したときの理由。 */
    val error: String? = null,
) {
    /** 録音開始からの経過ミリ秒（一時停止した分は含まない）。 */
    fun elapsedMs(now: Long = System.currentTimeMillis()): Long = elapsedBase + if (runningSince > 0L) now - runningSince else 0L

    val latestLevel: Float get() = levels.lastOrNull() ?: 0f

    companion object {
        const val LEVEL_SAMPLES = 16
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
        update { s -> s.copy(levels = (s.levels + level.coerceIn(0f, 1f)).takeLast(RecorderState.LEVEL_SAMPLES)) }
    }
}

/** タイル / 通知からの操作。MainActivity が受け取り、ホーム画面が権限確認の上で実行する。 */
sealed interface PendingAction {
    data object Start : PendingAction

    data object Stop : PendingAction

    /** タイルの「録音一覧」から */
    data object OpenRecordings : PendingAction
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
