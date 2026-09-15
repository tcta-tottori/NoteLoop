package jp.tcta.noteloop.wear.ui.recordings

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.MaterialTheme
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

/** 時計内の録音一覧。Web 版の「履歴」に相当。タップで詳細（再生 / スマホへ送る / 削除）。 */
@Composable
fun RecordingsScreen(onOpen: (String) -> Unit) {
    val viewModel = containerViewModel { _, c -> RecordingsViewModel(c.recordings, c.phoneLink) }
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    RecordingsContent(items = state.items, onOpen = onOpen)
}

@Composable
private fun RecordingsContent(
    items: List<RecordingItem>,
    onOpen: (String) -> Unit,
) {
    val listState = rememberScalingLazyListState()
    ScreenScaffold(scrollState = listState) {
        ScalingLazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
            item { ListHeader { Text(stringResource(R.string.recordings_title)) } }
            if (items.isEmpty()) {
                item { Hint(stringResource(R.string.recordings_empty)) }
                item { Hint(stringResource(R.string.recordings_hint)) }
            }
            items(items, key = { it.name }) { item ->
                Button(
                    onClick = { onOpen(item.name) },
                    icon = { Icon(painter = painterResource(R.drawable.ic_mic), contentDescription = null) },
                    label = { Text(item.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    secondaryLabel = {
                        Text(
                            stringResource(R.string.recording_size, formatElapsed(item.durationMs), formatSize(item.sizeBytes)),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    colors = ButtonDefaults.filledTonalButtonColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
internal fun Hint(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp),
    )
}

@Preview(device = WearDevices.SMALL_ROUND, showSystemUi = true)
@Composable
private fun RecordingsPreview() {
    NoteLoopTheme {
        RecordingsContent(
            items =
                listOf(
                    RecordingItem(File("noteloop_20260915_101500_watch.m4a"), PREVIEW_SIZE, PREVIEW_DURATION),
                    RecordingItem(File("noteloop_20260914_180000_watch.m4a"), PREVIEW_SIZE * 3, PREVIEW_DURATION * 3),
                ),
            onOpen = {},
        )
    }
}

private const val PREVIEW_SIZE = 740_000L
private const val PREVIEW_DURATION = 61_000L
