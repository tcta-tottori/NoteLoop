package jp.tcta.noteloop.wear.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import jp.tcta.noteloop.shared.RecordMode
import jp.tcta.noteloop.wear.data.AudioQuality
import jp.tcta.noteloop.wear.data.RecordingRepository
import jp.tcta.noteloop.wear.data.SettingsRepository
import jp.tcta.noteloop.wear.sync.PhoneLink
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class SettingsUiState(
    val defaultMode: RecordMode = RecordMode.WATCH,
    val quality: AudioQuality = AudioQuality.STANDARD,
    val phoneReachable: Boolean = false,
    val recordingCount: Int = 0,
)

class SettingsViewModel(
    private val settings: SettingsRepository,
    phoneLink: PhoneLink,
    recordings: RecordingRepository,
) : ViewModel() {
    val uiState: StateFlow<SettingsUiState> =
        combine(settings.defaultMode, settings.quality, phoneLink.phoneReachable, recordings.items) { mode, q, reachable, items ->
            SettingsUiState(defaultMode = mode, quality = q, phoneReachable = reachable, recordingCount = items.size)
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), SettingsUiState())

    init {
        phoneLink.refreshReachability()
        viewModelScope.launch { recordings.refresh() }
    }

    fun setDefaultMode(mode: RecordMode) {
        viewModelScope.launch { settings.setDefaultMode(mode) }
    }

    fun toggleQuality() {
        viewModelScope.launch {
            val next = if (uiState.value.quality == AudioQuality.STANDARD) AudioQuality.HIGH else AudioQuality.STANDARD
            settings.setQuality(next)
        }
    }

    private companion object {
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
