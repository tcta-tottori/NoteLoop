package jp.tcta.noteloop.wear.ui.home

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.tooling.preview.devices.WearDevices
import jp.tcta.noteloop.wear.R
import jp.tcta.noteloop.wear.record.PendingAction
import jp.tcta.noteloop.wear.record.RecorderState
import jp.tcta.noteloop.wear.ui.NoteLoopColors
import jp.tcta.noteloop.wear.ui.NoteLoopTheme
import jp.tcta.noteloop.wear.ui.common.RecordPill
import jp.tcta.noteloop.wear.ui.common.SmallPill
import jp.tcta.noteloop.wear.ui.common.containerViewModel
import jp.tcta.noteloop.wear.ui.common.formatElapsed
import kotlinx.coroutines.delay

/**
 * ホーム。スクロールしない 1 画面で、Google レコーダーのタイルと同じ並び:
 * 上に小さなアプリアイコンと名前、中央に横長の大きな録音ピル、下に小さなピル（録音一覧 / 案内）。
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

    // タイル / 通知からの開始・停止・一覧
    LaunchedEffect(pending) {
        when (pending) {
            PendingAction.Start -> startWithPermission()
            PendingAction.Stop -> viewModel.stop()
            PendingAction.OpenRecordings -> onRecordings()
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
        Column(
            modifier = Modifier.fillMaxSize().padding(top = TOP_PADDING, bottom = BOTTOM_PADDING),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            // 上: 小さなアプリアイコンと名前（録音中は状態）
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    modifier = Modifier.size(ICON_CIRCLE).clip(CircleShape).background(NoteLoopColors.SurfaceHigh),
                    contentAlignment = Alignment.Center,
                ) {
                    Image(painter = painterResource(R.drawable.app_logo), contentDescription = null, modifier = Modifier.size(ICON_SIZE))
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text =
                        stringResource(
                            when {
                                !state.recording -> R.string.app_name
                                state.paused -> R.string.home_paused
                                else -> R.string.home_recording
                            },
                        ),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = if (state.recording && !state.paused) NoteLoopColors.Brand1 else NoteLoopColors.Text,
                )
            }
            // 中央: 横長の大きな録音ピル
            RecordPill(
                recording = state.recording,
                paused = state.paused,
                level = state.latestLevel,
                elapsedText = formatElapsed(state.elapsedMs(now)),
                idleLabel = stringResource(R.string.home_record),
                onStart = onStart,
                onTogglePause = onTogglePause,
                onStop = onStop,
            )
            // 下: 小さなピル（待機中は録音一覧、録音中は操作の案内）
            if (state.recording) {
                SmallPill(
                    text = stringResource(if (state.paused) R.string.home_hint_paused else R.string.home_hint_recording),
                    onClick = null,
                )
            } else {
                SmallPill(text = stringResource(R.string.home_recordings), onClick = onRecordings)
            }
        }
    }
}

private const val TIMER_TICK_MS = 250L
private val TOP_PADDING = 22.dp
private val BOTTOM_PADDING = 18.dp
private val ICON_CIRCLE = 30.dp
private val ICON_SIZE = 16.dp

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
