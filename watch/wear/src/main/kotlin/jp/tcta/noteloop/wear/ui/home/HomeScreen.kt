package jp.tcta.noteloop.wear.ui.home

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.tooling.preview.devices.WearDevices
import jp.tcta.noteloop.wear.R
import jp.tcta.noteloop.wear.record.PendingAction
import jp.tcta.noteloop.wear.record.RecorderState
import jp.tcta.noteloop.wear.ui.NoteLoopColors
import jp.tcta.noteloop.wear.ui.NoteLoopTheme
import jp.tcta.noteloop.wear.ui.common.RecordButton
import jp.tcta.noteloop.wear.ui.common.containerViewModel
import jp.tcta.noteloop.wear.ui.common.formatElapsed
import kotlinx.coroutines.delay

/**
 * ホーム。スクロールしない 1 画面。
 * 中央に大きな紫の録音ボタン、上に経過時間（録音中）、下に案内。待機中だけ右下に録音一覧への小さなボタン。
 */
@Composable
fun HomeScreen(onRecordings: () -> Unit) {
    val viewModel = containerViewModel { _, c -> HomeViewModel(c.controller, c.recorderState, c.pendingAction) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()
    val pending by viewModel.pendingAction.collectAsStateWithLifecycle()
    val context = LocalContext.current

    // マイク（と Android 13+ の通知）の許可を取ってから開始する
    val permissionLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
            if (granted[Manifest.permission.RECORD_AUDIO] == true) viewModel.start() else viewModel.permissionDenied()
        }
    val startWithPermission = {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            viewModel.start()
        } else {
            permissionLauncher.launch(requiredPermissions())
        }
    }

    // タイル / 通知からの開始・停止
    LaunchedEffect(pending) {
        when (pending) {
            PendingAction.Start -> startWithPermission()
            PendingAction.Stop -> viewModel.stop()
            null -> return@LaunchedEffect
        }
        viewModel.consumePendingAction()
    }

    LaunchedEffect(message) {
        val m = message ?: return@LaunchedEffect
        val text =
            when (m) {
                HomeMessage.PermissionDenied -> context.getString(R.string.msg_permission_denied)
                is HomeMessage.Saved -> context.getString(R.string.msg_saved)
                is HomeMessage.RecordFailed -> context.getString(R.string.msg_record_failed) + "\n" + m.reason
            }
        Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
        viewModel.consumeMessage()
    }

    HomeContent(
        state = state,
        onStart = startWithPermission,
        onTogglePause = viewModel::togglePause,
        onStop = viewModel::stop,
        onRecordings = onRecordings,
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
    state: RecorderState,
    onStart: () -> Unit,
    onTogglePause: () -> Unit,
    onStop: () -> Unit,
    onRecordings: () -> Unit,
) {
    // 経過時間は 250ms ごとに描き直す（本体の updateTimer と同じ間隔）
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(state.recording, state.paused) {
        while (state.recording && !state.paused) {
            now = System.currentTimeMillis()
            delay(TIMER_TICK_MS)
        }
        now = System.currentTimeMillis()
    }
    ScreenScaffold {
        Box(modifier = Modifier.fillMaxSize()) {
            // 上: 待機中はロゴ、録音中は状態と経過時間
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = TOP_PADDING),
            ) {
                if (state.recording) {
                    Text(
                        text = stringResource(if (state.paused) R.string.home_paused else R.string.home_recording),
                        style = MaterialTheme.typography.labelMedium,
                        color = if (state.paused) NoteLoopColors.Muted else NoteLoopColors.Brand1,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        text = formatElapsed(state.elapsedMs(now)),
                        style = MaterialTheme.typography.displaySmall,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                    )
                } else {
                    Image(painter = painterResource(R.drawable.app_logo), contentDescription = null, modifier = Modifier.size(18.dp))
                    Text(
                        text = stringResource(R.string.app_name),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = NoteLoopColors.Muted,
                    )
                }
            }
            // 中央: 大きな録音ボタン
            RecordButton(
                recording = state.recording,
                paused = state.paused,
                level = state.latestLevel,
                onStart = onStart,
                onTogglePause = onTogglePause,
                onStop = onStop,
                modifier = Modifier.align(Alignment.Center),
            )
            // 下: 案内
            Text(
                text =
                    stringResource(
                        when {
                            !state.recording -> R.string.home_tap_to_record
                            state.paused -> R.string.home_hint_paused
                            else -> R.string.home_hint_recording
                        },
                    ),
                style = MaterialTheme.typography.labelSmall,
                color = NoteLoopColors.Muted,
                textAlign = TextAlign.Center,
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = BOTTOM_PADDING, start = 24.dp, end = 24.dp),
            )
            // 右下: 録音一覧（待機中のみ）
            if (!state.recording) {
                Box(
                    modifier =
                        Modifier
                            .align(Alignment.BottomEnd)
                            .padding(end = LIST_BUTTON_PADDING, bottom = LIST_BUTTON_PADDING)
                            .size(LIST_BUTTON_SIZE)
                            .clip(CircleShape)
                            .background(NoteLoopColors.Surface)
                            .clickable(role = Role.Button, onClick = onRecordings),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        painter = painterResource(R.drawable.ic_list),
                        contentDescription = stringResource(R.string.home_recordings),
                        tint = NoteLoopColors.Muted,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
    }
}

private const val TIMER_TICK_MS = 250L
private val TOP_PADDING = 26.dp
private val BOTTOM_PADDING = 14.dp
private val LIST_BUTTON_SIZE = 36.dp
private val LIST_BUTTON_PADDING = 22.dp

@Preview(device = WearDevices.SMALL_ROUND, showSystemUi = true)
@Composable
private fun HomeIdlePreview() {
    NoteLoopTheme {
        HomeContent(state = RecorderState(), onStart = {}, onTogglePause = {}, onStop = {}, onRecordings = {})
    }
}

@Preview(device = WearDevices.SMALL_ROUND, showSystemUi = true)
@Composable
private fun HomeRecordingPreview() {
    NoteLoopTheme {
        HomeContent(
            state =
                RecorderState(
                    recording = true,
                    runningSince = System.currentTimeMillis() - PREVIEW_ELAPSED_MS,
                    levels = listOf(0.2f, 0.6f, 0.9f),
                ),
            onStart = {},
            onTogglePause = {},
            onStop = {},
            onRecordings = {},
        )
    }
}

private const val PREVIEW_ELAPSED_MS = 83_000L
