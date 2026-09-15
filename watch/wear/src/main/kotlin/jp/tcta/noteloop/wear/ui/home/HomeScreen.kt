package jp.tcta.noteloop.wear.ui.home

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.tooling.preview.devices.WearDevices
import jp.tcta.noteloop.shared.RecordMode
import jp.tcta.noteloop.wear.R
import jp.tcta.noteloop.wear.record.PendingAction
import jp.tcta.noteloop.wear.record.RecordingSession
import jp.tcta.noteloop.wear.ui.NoteLoopColors
import jp.tcta.noteloop.wear.ui.NoteLoopTheme
import jp.tcta.noteloop.wear.ui.common.MicButton
import jp.tcta.noteloop.wear.ui.common.ModeSelector
import jp.tcta.noteloop.wear.ui.common.WaveBars
import jp.tcta.noteloop.wear.ui.common.containerViewModel
import jp.tcta.noteloop.wear.ui.common.formatElapsed
import jp.tcta.noteloop.wear.ui.common.longLabelRes
import kotlinx.coroutines.delay

/**
 * ホーム。Web 版の「中央のマイクボタン＋案内」を時計向けにしたもの。
 * 上にモード選択（ウォッチ / ダブル / スマホ）、中央にマイクボタン、録音中はウェーブと経過時間に切り替わる。
 * 下へスクロールすると録音一覧と設定。
 */
@Composable
fun HomeScreen(
    onRecordings: () -> Unit,
    onSettings: () -> Unit,
) {
    val viewModel =
        containerViewModel { _, c -> HomeViewModel(c.controller, c.recorderState, c.phoneLink, c.settings, c.pendingAction) }
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()
    val pending by viewModel.pendingAction.collectAsStateWithLifecycle()
    val context = LocalContext.current

    // マイク（と Android 13+ の通知）の許可を取ってから開始する
    var requestedMode by remember { mutableStateOf<RecordMode?>(null) }
    val permissionLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
            val mode = requestedMode
            requestedMode = null
            if (granted[Manifest.permission.RECORD_AUDIO] == true && mode != null) viewModel.start(mode) else viewModel.permissionDenied()
        }
    val startWithPermission: (RecordMode) -> Unit = { mode ->
        // スマホのみ録音は時計のマイクを使わないが、後でモードを変えたときのために同じ流れで許可を取る
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            viewModel.start(mode)
        } else {
            requestedMode = mode
            permissionLauncher.launch(requiredPermissions())
        }
    }

    // タイル / 通知からの開始・停止
    LaunchedEffect(pending) {
        when (val p = pending) {
            is PendingAction.Start -> {
                viewModel.selectMode(p.mode)
                startWithPermission(p.mode)
            }

            PendingAction.Stop -> {
                viewModel.stop()
            }

            null -> {
                return@LaunchedEffect
            }
        }
        viewModel.consumePendingAction()
    }

    LaunchedEffect(message) {
        val m = message ?: return@LaunchedEffect
        val text =
            when (m) {
                HomeMessage.PermissionDenied -> context.getString(R.string.msg_permission_denied)
                HomeMessage.PhoneUnreachable -> context.getString(R.string.msg_phone_unreachable)
                HomeMessage.DoubleFallback -> context.getString(R.string.msg_double_fallback)
                is HomeMessage.PhoneError -> context.getString(R.string.msg_phone_error, m.reason)
                is HomeMessage.Saved -> context.getString(R.string.msg_saved)
                is HomeMessage.RecordFailed -> context.getString(R.string.msg_record_failed) + "\n" + m.reason
            }
        Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
        viewModel.consumeMessage()
    }

    HomeContent(
        state = state,
        onSelectMode = viewModel::selectMode,
        onStart = { startWithPermission(state.selectedMode) },
        onStop = viewModel::stop,
        onRecordings = onRecordings,
        onSettings = onSettings,
    )
}

private fun requiredPermissions(): Array<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS)
    } else {
        arrayOf(Manifest.permission.RECORD_AUDIO)
    }

@Composable
private fun HomeContent(
    state: HomeUiState,
    onSelectMode: (RecordMode) -> Unit,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onRecordings: () -> Unit,
    onSettings: () -> Unit,
) {
    val listState = rememberScalingLazyListState()
    ScreenScaffold(scrollState = listState) {
        ScalingLazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            item { Header(state.phoneReachable) }
            item {
                if (state.active) {
                    RecordingPanel(state, onStop)
                } else {
                    IdlePanel(state, onSelectMode, onStart)
                }
            }
            item {
                Button(
                    onClick = onRecordings,
                    icon = { Icon(painter = painterResource(R.drawable.ic_list), contentDescription = null) },
                    label = { Text(stringResource(R.string.home_recordings)) },
                    colors = ButtonDefaults.filledTonalButtonColors(),
                    modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                )
            }
            item {
                Button(
                    onClick = onSettings,
                    icon = { Icon(painter = painterResource(R.drawable.ic_settings), contentDescription = null) },
                    label = { Text(stringResource(R.string.home_settings)) },
                    colors = ButtonDefaults.filledTonalButtonColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

/** ロゴ（白いマイク）＋アプリ名。右にスマホ接続の点。 */
@Composable
private fun Header(phoneReachable: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 2.dp)) {
        Image(painter = painterResource(R.drawable.app_logo), contentDescription = null, modifier = Modifier.size(16.dp))
        Text(
            text = stringResource(R.string.app_name),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(start = 5.dp, end = 6.dp),
        )
        Text(
            text = "●",
            color = if (phoneReachable) NoteLoopColors.Ok else NoteLoopColors.Border,
            style = MaterialTheme.typography.labelSmall,
        )
    }
}

@Composable
private fun IdlePanel(
    state: HomeUiState,
    onSelectMode: (RecordMode) -> Unit,
    onStart: () -> Unit,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        ModeSelector(selected = state.selectedMode, onSelect = onSelectMode)
        Text(
            text = stringResource(state.selectedMode.longLabelRes),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp),
        )
        MicButton(
            recording = false,
            onClick = onStart,
            contentDescription = stringResource(R.string.home_mic),
            modifier = Modifier.padding(top = 2.dp),
        )
        Text(
            text = stringResource(R.string.home_tap_to_record),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun RecordingPanel(
    state: HomeUiState,
    onStop: () -> Unit,
) {
    // 経過時間は 250ms ごとに描き直す（Web 版の updateTimer と同じ間隔）
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(state.elapsedFrom) {
        while (true) {
            now = System.currentTimeMillis()
            delay(TIMER_TICK_MS)
        }
    }
    val label =
        when {
            state.waitingPhone -> stringResource(R.string.home_waiting_phone)
            state.session?.mode == RecordMode.PHONE -> stringResource(R.string.home_recording_phone)
            else -> stringResource(R.string.home_recording)
        }
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text = label, style = MaterialTheme.typography.labelMedium, color = NoteLoopColors.Danger, fontWeight = FontWeight.Bold)
        if (state.session?.mode == RecordMode.PHONE) {
            Spacer(modifier = Modifier.height(6.dp))
            Icon(
                painter = painterResource(R.drawable.ic_phone),
                contentDescription = null,
                tint = NoteLoopColors.Muted,
                modifier = Modifier.size(28.dp),
            )
        } else {
            WaveBars(levels = state.levels, modifier = Modifier.fillMaxWidth(WAVE_WIDTH_FRACTION))
        }
        Text(
            text = if (state.elapsedFrom > 0L) formatElapsed(now - state.elapsedFrom) else "--:--",
            style = MaterialTheme.typography.displaySmall,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
        Text(
            text = stringResource(state.session?.mode?.longLabelRes ?: RecordMode.WATCH.longLabelRes),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        MicButton(
            recording = true,
            onClick = onStop,
            contentDescription = stringResource(R.string.home_stop),
            modifier = Modifier.padding(top = 2.dp),
            size = 56.dp,
        )
    }
}

private const val TIMER_TICK_MS = 250L
private const val WAVE_WIDTH_FRACTION = 0.8f

@Preview(device = WearDevices.SMALL_ROUND, showSystemUi = true)
@Composable
private fun HomeIdlePreview() {
    NoteLoopTheme {
        HomeContent(
            state = HomeUiState(selectedMode = RecordMode.DOUBLE, phoneReachable = true),
            onSelectMode = {},
            onStart = {},
            onStop = {},
            onRecordings = {},
            onSettings = {},
        )
    }
}

@Preview(device = WearDevices.SMALL_ROUND, showSystemUi = true)
@Composable
private fun HomeRecordingPreview() {
    NoteLoopTheme {
        HomeContent(
            state =
                HomeUiState(
                    selectedMode = RecordMode.WATCH,
                    session = RecordingSession(RecordMode.WATCH, System.currentTimeMillis() - PREVIEW_ELAPSED_MS),
                    watchRecording = true,
                    elapsedFrom = System.currentTimeMillis() - PREVIEW_ELAPSED_MS,
                    levels = List(PREVIEW_LEVELS) { (it % 5) / 5f },
                ),
            onSelectMode = {},
            onStart = {},
            onStop = {},
            onRecordings = {},
            onSettings = {},
        )
    }
}

private const val PREVIEW_ELAPSED_MS = 83_000L
private const val PREVIEW_LEVELS = 24
