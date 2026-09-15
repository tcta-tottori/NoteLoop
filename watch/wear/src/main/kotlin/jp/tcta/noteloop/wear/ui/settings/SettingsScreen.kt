package jp.tcta.noteloop.wear.ui.settings

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.tooling.preview.devices.WearDevices
import jp.tcta.noteloop.shared.RecordMode
import jp.tcta.noteloop.wear.BuildConfig
import jp.tcta.noteloop.wear.R
import jp.tcta.noteloop.wear.data.AudioQuality
import jp.tcta.noteloop.wear.ui.NoteLoopColors
import jp.tcta.noteloop.wear.ui.NoteLoopTheme
import jp.tcta.noteloop.wear.ui.common.ModeSelector
import jp.tcta.noteloop.wear.ui.common.containerViewModel
import jp.tcta.noteloop.wear.ui.common.longLabelRes

/** 設定: 既定の録音モード、音質、スマホ接続、バージョン。 */
@Composable
fun SettingsScreen() {
    val viewModel = containerViewModel { _, c -> SettingsViewModel(c.settings, c.phoneLink, c.recordings) }
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    SettingsContent(state = state, onSelectMode = viewModel::setDefaultMode, onToggleQuality = viewModel::toggleQuality)
}

@Composable
private fun SettingsContent(
    state: SettingsUiState,
    onSelectMode: (RecordMode) -> Unit,
    onToggleQuality: () -> Unit,
) {
    val listState = rememberScalingLazyListState()
    ScreenScaffold(scrollState = listState) {
        ScalingLazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
            item { ListHeader { Text(stringResource(R.string.settings_title)) } }
            item { Note(stringResource(R.string.settings_default_mode)) }
            item { ModeSelector(selected = state.defaultMode, onSelect = onSelectMode) }
            item { Note(stringResource(state.defaultMode.longLabelRes)) }
            item {
                Button(
                    onClick = onToggleQuality,
                    icon = { Icon(painter = painterResource(R.drawable.ic_mic), contentDescription = null) },
                    label = { Text(stringResource(R.string.settings_quality)) },
                    secondaryLabel = {
                        Text(
                            stringResource(
                                if (state.quality ==
                                    AudioQuality.HIGH
                                ) {
                                    R.string.settings_quality_high
                                } else {
                                    R.string.settings_quality_standard
                                },
                            ),
                        )
                    },
                    colors = ButtonDefaults.filledTonalButtonColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                Note(
                    text = stringResource(if (state.phoneReachable) R.string.home_phone_connected else R.string.home_phone_disconnected),
                    color = if (state.phoneReachable) NoteLoopColors.Ok else NoteLoopColors.Muted,
                )
            }
            item { Note(stringResource(R.string.settings_phone_note)) }
            item { Note(stringResource(R.string.settings_storage, state.recordingCount)) }
            item { Note(stringResource(R.string.settings_version, BuildConfig.VERSION_NAME)) }
        }
    }
}

@Composable
private fun Note(
    text: String,
    color: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurfaceVariant,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        color = color,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
    )
}

@Preview(device = WearDevices.SMALL_ROUND, showSystemUi = true)
@Composable
private fun SettingsPreview() {
    NoteLoopTheme {
        SettingsContent(
            state =
                SettingsUiState(
                    defaultMode = RecordMode.DOUBLE,
                    quality = AudioQuality.HIGH,
                    phoneReachable = true,
                    recordingCount = 3,
                ),
            onSelectMode = {},
            onToggleQuality = {},
        )
    }
}
