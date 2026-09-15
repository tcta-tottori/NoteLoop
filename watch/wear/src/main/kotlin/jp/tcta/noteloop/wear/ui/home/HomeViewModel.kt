package jp.tcta.noteloop.wear.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import jp.tcta.noteloop.wear.record.PendingAction
import jp.tcta.noteloop.wear.record.PendingActionStore
import jp.tcta.noteloop.wear.record.RecorderState
import jp.tcta.noteloop.wear.record.RecorderStateStore
import jp.tcta.noteloop.wear.record.RecordingController
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** 1 回きりの出来事（Toast）。 */
sealed interface HomeMessage {
    data object PermissionDenied : HomeMessage

    data class Saved(
        val fileName: String,
    ) : HomeMessage

    data class RecordFailed(
        val reason: String,
    ) : HomeMessage
}

class HomeViewModel(
    private val controller: RecordingController,
    recorderState: RecorderStateStore,
    private val pendingActions: PendingActionStore,
) : ViewModel() {
    val state: StateFlow<RecorderState> = recorderState.state
    val pendingAction: StateFlow<PendingAction?> = pendingActions.action

    private val mutableMessage = MutableStateFlow<HomeMessage?>(null)
    val message: StateFlow<HomeMessage?> = mutableMessage

    init {
        // 停止後の「保存しました」と、開始失敗を拾う
        viewModelScope.launch {
            var last: RecorderState? = null
            recorderState.state.collect { s ->
                val prev = last
                last = s
                if (prev == null) return@collect
                if (prev.recording && !s.recording) s.lastSavedName?.let { mutableMessage.value = HomeMessage.Saved(it) }
                if (s.error != null && prev.error != s.error) mutableMessage.value = HomeMessage.RecordFailed(s.error)
            }
        }
    }

    /** マイク権限が取れたあとに呼ぶ。 */
    fun start() = controller.start()

    fun togglePause() = controller.togglePause()

    fun stop() = controller.stop()

    fun permissionDenied() {
        mutableMessage.value = HomeMessage.PermissionDenied
    }

    fun consumePendingAction() = pendingActions.consume()

    fun consumeMessage() {
        mutableMessage.value = null
    }
}
