package jp.tcta.noteloop.wear.ui.common

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import jp.tcta.noteloop.wear.ui.NoteLoopColors
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * 中央の横長の大きな録音ボタン（Google レコーダーのタイルと同じ「ピル」形）。
 * NOTELOOP 本体のマイクボタンと同じ紫グラデーションで、録音中も色は変えない。
 *
 * - 待機中: 「● 録音」。タップで録音開始
 * - 録音中: 中に音量で動くゲージバーと経過時間。タップで一時停止 ⇔ 再開、[HOLD_TO_STOP_MS] 長押しで停止。
 *   長押し中は白い帯が左から右へ満ちていき、いっぱいになると停止する
 */
@Composable
fun RecordPill(
    recording: Boolean,
    paused: Boolean,
    level: Float,
    elapsedText: String,
    idleLabel: String,
    onStart: () -> Unit,
    onTogglePause: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptics = LocalHapticFeedback.current
    val hold = remember { Animatable(0f) }
    val gesture =
        if (recording) {
            Modifier.pointerInput(Unit) {
                detectTapGestures(
                    onPress = {
                        // 押している間だけ帯を伸ばす。2 秒持ったら停止、途中で離したらタップ扱い
                        coroutineScope {
                            var fired = false
                            val fill = launch { hold.animateTo(1f, tween(HOLD_TO_STOP_MS, easing = LinearEasing)) }
                            val timer =
                                launch {
                                    delay(HOLD_TO_STOP_MS.toLong())
                                    fired = true
                                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                    onStop()
                                }
                            val released = tryAwaitRelease()
                            fill.cancel()
                            timer.cancel()
                            hold.snapTo(0f)
                            if (released && !fired) {
                                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                onTogglePause()
                            }
                        }
                    },
                )
            }
        } else {
            Modifier.clickable(role = Role.Button, onClick = onStart)
        }
    Box(
        modifier =
            modifier
                .fillMaxWidth(PILL_WIDTH_FRACTION)
                .height(PILL_HEIGHT)
                .clip(CircleShape)
                .background(NoteLoopColors.brandGradient)
                .then(gesture),
        contentAlignment = Alignment.Center,
    ) {
        // 長押しの進み具合（左から満ちる白い帯）
        if (recording && hold.value > 0f) {
            Canvas(modifier = Modifier.fillMaxSize()) {
                drawRect(color = Color.White.copy(alpha = HOLD_FILL_ALPHA), size = Size(size.width * hold.value, size.height))
            }
        }
        if (recording) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                GaugeBars(level = level, paused = paused, modifier = Modifier.size(GAUGE_WIDTH, GAUGE_HEIGHT))
                Spacer(modifier = Modifier.width(12.dp))
                Text(
                    text = elapsedText,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                )
            }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.size(DOT_SIZE).clip(CircleShape).background(NoteLoopColors.Bg))
                Spacer(modifier = Modifier.width(10.dp))
                Text(
                    text = idleLabel,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                )
            }
        }
    }
}

/** 下の小さなピル（録音一覧 / 案内）。Google レコーダーの「Files」に相当。 */
@Composable
fun SmallPill(
    text: String,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier =
            modifier
                .fillMaxWidth(SMALL_PILL_WIDTH_FRACTION)
                .height(SMALL_PILL_HEIGHT)
                .clip(CircleShape)
                .background(NoteLoopColors.SurfaceHigh)
                .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            color = if (onClick != null) NoteLoopColors.Text else NoteLoopColors.Muted,
            maxLines = 1,
        )
    }
}

/**
 * ピルの中の音量ゲージ（5 本）。NOTELOOP 本体の通知ゲージと同じく、位置は固定で高さだけが
 * 音量に応じて伸び縮みする。中央ほどよく伸び、本ごとに伸びやすさを変えて機械的に見えないようにする。
 */
@Composable
private fun GaugeBars(
    level: Float,
    paused: Boolean,
    modifier: Modifier = Modifier,
) {
    val target = if (paused) 0f else level.coerceIn(0f, 1f)
    val animated =
        BAR_GAIN.mapIndexed { i, gain ->
            val h by
                animateFloatAsState(
                    targetValue = (MIN_BAR + (1f - MIN_BAR) * (target * gain).coerceAtMost(1f)),
                    animationSpec = tween(if (target > 0f) RISE_MS else FALL_MS),
                    label = "bar$i",
                )
            h
        }
    Canvas(modifier = modifier) {
        val gap = size.width / BAR_GAIN.size
        val stroke = gap * BAR_RATIO
        val midY = size.height / 2
        animated.forEachIndexed { i, h ->
            val half = (size.height / 2) * h
            val x = gap * i + gap / 2
            drawLine(
                color = Color.White,
                start = Offset(x, midY - half),
                end = Offset(x, midY + half),
                strokeWidth = stroke,
                cap = StrokeCap.Round,
            )
        }
    }
}

/** 停止までの長押し時間。 */
const val HOLD_TO_STOP_MS = 2_000
private const val PILL_WIDTH_FRACTION = 0.86f
private val PILL_HEIGHT = 72.dp
private const val SMALL_PILL_WIDTH_FRACTION = 0.56f
private val SMALL_PILL_HEIGHT = 40.dp
private val DOT_SIZE = 12.dp
private val GAUGE_WIDTH = 40.dp
private val GAUGE_HEIGHT = 32.dp
private const val HOLD_FILL_ALPHA = 0.28f
private val BAR_GAIN = listOf(0.55f, 0.85f, 1.15f, 0.85f, 0.55f)
private const val BAR_RATIO = 0.5f
private const val MIN_BAR = 0.14f
private const val RISE_MS = 90
private const val FALL_MS = 220
