package jp.tcta.noteloop.wear.ui.recordings

import android.widget.Toast
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.tooling.preview.devices.WearDevices
import jp.tcta.noteloop.wear.R
import jp.tcta.noteloop.wear.data.RecordingItem
import jp.tcta.noteloop.wear.ui.NoteLoopTheme
import jp.tcta.noteloop.wear.ui.common.containerViewModel
import jp.tcta.noteloop.wear.ui.common.formatElapsed
import jp.tcta.noteloop.wear.ui.common.formatSize
import java.io.File

/** 録音 1 件の詳細。再生、スマホへ転送、削除。 */
@Composable
fun RecordingDetailScreen(
    name: String,
    onDeleted: () -> Unit,
) {
    val viewModel = containerViewModel { _, c -> RecordingsViewModel(c.recordings, c.phoneLink) }
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val item = state.items.firstOrNull { it.name == name } ?: viewModel.find(name)

    LaunchedEffect(message) {
        val m = message ?: return@LaunchedEffect
        val res =
            when (m) {
                RecordingsMessage.Sent -> R.string.msg_sent_to_phone
                RecordingsMessage.SendFailed -> R.string.msg_send_failed
                RecordingsMessage.Deleted -> R.string.msg_deleted
            }
        Toast.makeText(context, res, Toast.LENGTH_SHORT).show()
        viewModel.consumeMessage()
    }
    // 画面を離れたら再生を止める
    DisposableEffect(Unit) { onDispose { viewModel.stopPlayback() } }

    if (item == null) {
        ScreenScaffold { Hint(stringResource(R.string.recordings_empty)) }
        return
    }
    RecordingDetailContent(
        item = item,
        playing = state.playing,
        sending = state.sending,
        onTogglePlay = { viewModel.togglePlay(item) },
        onSend = { viewModel.sendToPhone(item) },
        onDelete = { viewModel.delete(item, onDeleted) },
    )
}

@Composable
private fun RecordingDetailContent(
    item: RecordingItem,
    playing: Boolean,
    sending: Boolean,
    onTogglePlay: () -> Unit,
    onSend: () -> Unit,
    onDelete: () -> Unit,
) {
    val listState = rememberScalingLazyListState()
    ScreenScaffold(scrollState = listState) {
        ScalingLazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
            item { ListHeader { Text(item.title, maxLines = 2, overflow = TextOverflow.Ellipsis) } }
            item { Hint(stringResource(R.string.recording_size, formatElapsed(item.durationMs), formatSize(item.sizeBytes))) }
            item {
                Button(
                    onClick = onTogglePlay,
                    icon = {
                        Icon(
                            painter = painterResource(if (playing) R.drawable.ic_pause else R.drawable.ic_play),
                            contentDescription = null,
                        )
                    },
                    label = { Text(stringResource(if (playing) R.string.recording_pause else R.string.recording_play)) },
                    colors = ButtonDefaults.buttonColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                Button(
                    onClick = onSend,
                    enabled = !sending,
                    icon = { Icon(painter = painterResource(R.drawable.ic_send), contentDescription = null) },
                    label = { Text(stringResource(if (sending) R.string.recording_sending else R.string.recording_send)) },
                    colors = ButtonDefaults.filledTonalButtonColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                Button(
                    onClick = onDelete,
                    icon = { Icon(painter = painterResource(R.drawable.ic_delete), contentDescription = null) },
                    label = { Text(stringResource(R.string.recording_delete)) },
                    colors = ButtonDefaults.outlinedButtonColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Preview(device = WearDevices.SMALL_ROUND, showSystemUi = true)
@Composable
private fun RecordingDetailPreview() {
    NoteLoopTheme {
        RecordingDetailContent(
            item = RecordingItem(File("noteloop_20260915_101500_watch.m4a"), PREVIEW_SIZE, PREVIEW_DURATION),
            playing = false,
            sending = false,
            onTogglePlay = {},
            onSend = {},
            onDelete = {},
        )
    }
}

private const val PREVIEW_SIZE = 740_000L
private const val PREVIEW_DURATION = 61_000L
