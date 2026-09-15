package jp.tcta.noteloop.wear.ui.recordings

import android.media.MediaPlayer
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import jp.tcta.noteloop.wear.data.RecordingItem
import jp.tcta.noteloop.wear.data.RecordingRepository
import jp.tcta.noteloop.wear.sync.PhoneLink
import jp.tcta.noteloop.wear.sync.SendResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** 一覧と詳細で共有する。詳細は [select] したファイルに対して再生・送信・削除を行う。 */
data class RecordingsUiState(
    val items: List<RecordingItem> = emptyList(),
    val playing: Boolean = false,
    val sending: Boolean = false,
)

sealed interface RecordingsMessage {
    data object Sent : RecordingsMessage

    data object SendFailed : RecordingsMessage

    data object Deleted : RecordingsMessage
}

class RecordingsViewModel(
    private val repository: RecordingRepository,
    private val phoneLink: PhoneLink,
) : ViewModel() {
    private val playing = MutableStateFlow(false)
    private val sending = MutableStateFlow(false)
    private var player: MediaPlayer? = null

    val uiState: StateFlow<RecordingsUiState> =
        combine(repository.items, playing, sending) { items, p, s -> RecordingsUiState(items, p, s) }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), RecordingsUiState())

    private val mutableMessage = MutableStateFlow<RecordingsMessage?>(null)
    val message: StateFlow<RecordingsMessage?> = mutableMessage

    init {
        viewModelScope.launch { repository.refresh() }
    }

    fun find(name: String): RecordingItem? = repository.find(name)

    fun togglePlay(item: RecordingItem) {
        val p = player
        if (p != null) {
            if (p.isPlaying) {
                p.pause()
                playing.value = false
            } else {
                p.start()
                playing.value = true
            }
            return
        }
        val created =
            runCatching {
                MediaPlayer().apply {
                    setDataSource(item.file.absolutePath)
                    setOnCompletionListener {
                        playing.value = false
                        seekTo(0)
                    }
                    prepare()
                    start()
                }
            }.getOrNull() ?: return
        player = created
        playing.value = true
    }

    fun stopPlayback() {
        player?.release()
        player = null
        playing.value = false
    }

    fun sendToPhone(item: RecordingItem) {
        if (sending.value) return
        viewModelScope.launch {
            sending.value = true
            val result = phoneLink.sendFile(item.file)
            sending.value = false
            mutableMessage.value = if (result == SendResult.SENT) RecordingsMessage.Sent else RecordingsMessage.SendFailed
        }
    }

    fun delete(
        item: RecordingItem,
        onDone: () -> Unit,
    ) {
        stopPlayback()
        viewModelScope.launch {
            repository.delete(item)
            mutableMessage.value = RecordingsMessage.Deleted
            onDone()
        }
    }

    fun consumeMessage() {
        mutableMessage.value = null
    }

    override fun onCleared() {
        stopPlayback()
        super.onCleared()
    }

    private companion object {
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
