package jp.tcta.noteloop.wear.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import jp.tcta.noteloop.shared.PhoneStatus
import jp.tcta.noteloop.shared.RecordMode
import jp.tcta.noteloop.wear.data.SettingsRepository
import jp.tcta.noteloop.wear.record.PendingAction
import jp.tcta.noteloop.wear.record.PendingActionStore
import jp.tcta.noteloop.wear.record.RecorderState
import jp.tcta.noteloop.wear.record.RecorderStateStore
import jp.tcta.noteloop.wear.record.RecordingController
import jp.tcta.noteloop.wear.record.RecordingSession
import jp.tcta.noteloop.wear.record.StartResult
import jp.tcta.noteloop.wear.sync.PhoneLink
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** ホーム画面の状態。録音中かどうかで中央の表示が切り替わる。 */
data class HomeUiState(
    val selectedMode: RecordMode = RecordMode.WATCH,
    /** 進行中のセッション。null なら待機中。 */
    val session: RecordingSession? = null,
    val watchRecording: Boolean = false,
    /** 経過時間の起点（epoch ms）。時計録音なら時計の開始時刻、スマホのみならスマホの開始時刻。0 なら未確定。 */
    val elapsedFrom: Long = 0L,
    val levels: List<Float> = emptyList(),
    val phoneReachable: Boolean = false,
    /** スマホのみ録音で、スマホからまだ「録音中」が返ってきていない。 */
    val waitingPhone: Boolean = false,
) {
    val active: Boolean get() = session != null
}

/** 1 回きりの出来事（Toast）。 */
sealed interface HomeMessage {
    data object PermissionDenied : HomeMessage

    data object PhoneUnreachable : HomeMessage

    data object DoubleFallback : HomeMessage

    data class PhoneError(
        val reason: String,
    ) : HomeMessage

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
    phoneLink: PhoneLink,
    private val settings: SettingsRepository,
    private val pendingActions: PendingActionStore,
) : ViewModel() {
    private val selected = MutableStateFlow<RecordMode?>(null)

    val uiState: StateFlow<HomeUiState> =
        combine(
            combine(selected, settings.defaultMode) { picked, default -> picked ?: default },
            controller.session,
            recorderState.state,
            phoneLink.phoneStatus,
            phoneLink.phoneReachable,
        ) { mode, session, recorder, phone, reachable ->
            HomeUiState(
                selectedMode = mode,
                session = session,
                watchRecording = recorder.recording,
                elapsedFrom = elapsedFrom(session, recorder, phone),
                levels = recorder.levels,
                phoneReachable = reachable,
                waitingPhone = session?.mode == RecordMode.PHONE && phone?.recording != true,
            )
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), HomeUiState())

    val pendingAction: StateFlow<PendingAction?> = pendingActions.action

    private val mutableMessage = MutableStateFlow<HomeMessage?>(null)
    val message: StateFlow<HomeMessage?> = mutableMessage

    init {
        // 停止後の「保存しました」と、時計側の開始失敗を拾う
        viewModelScope.launch {
            var last: RecorderState? = null
            recorderState.state.collect { s ->
                val prev = last
                last = s
                if (prev == null) return@collect
                if (prev.recording && !s.recording) {
                    controller.onWatchRecorderStopped()
                    s.lastSavedName?.let { mutableMessage.value = HomeMessage.Saved(it) }
                }
                if (s.error != null && prev.error != s.error) {
                    controller.onWatchRecorderStopped()
                    mutableMessage.value = HomeMessage.RecordFailed(s.error)
                }
            }
        }
        // スマホ側の開始失敗（マイク権限が無い等）
        viewModelScope.launch {
            var lastError = ""
            phoneLink.phoneStatus.collect { p ->
                val err = p?.error.orEmpty()
                if (err.isNotEmpty() && err != lastError) mutableMessage.value = HomeMessage.PhoneError(err)
                lastError = err
            }
        }
        phoneLink.refreshReachability()
    }

    fun selectMode(mode: RecordMode) {
        selected.value = mode
        viewModelScope.launch { settings.setDefaultMode(mode) }
    }

    /** マイク権限が取れたあとに呼ぶ。 */
    fun start(mode: RecordMode = uiState.value.selectedMode) {
        viewModelScope.launch {
            when (controller.start(mode)) {
                StartResult.STARTED, StartResult.ALREADY_RECORDING -> Unit
                StartResult.STARTED_WATCH_ONLY -> mutableMessage.value = HomeMessage.DoubleFallback
                StartResult.NO_PHONE -> mutableMessage.value = HomeMessage.PhoneUnreachable
            }
        }
    }

    fun stop() {
        viewModelScope.launch { controller.stop() }
    }

    fun permissionDenied() {
        mutableMessage.value = HomeMessage.PermissionDenied
    }

    fun consumePendingAction() {
        pendingActions.consume()
    }

    fun consumeMessage() {
        mutableMessage.value = null
    }

    private fun elapsedFrom(
        session: RecordingSession?,
        recorder: RecorderState,
        phone: PhoneStatus?,
    ): Long =
        when {
            session == null -> 0L
            recorder.recording -> recorder.startedAt
            session.mode == RecordMode.PHONE && phone?.recording == true -> phone.startedAt
            else -> session.startedAt
        }

    private companion object {
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
