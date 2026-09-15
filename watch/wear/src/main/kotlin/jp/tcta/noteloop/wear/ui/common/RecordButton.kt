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
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Icon
import jp.tcta.noteloop.wear.R
import jp.tcta.noteloop.wear.ui.NoteLoopColors
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * 中央の大きな録音ボタン。NOTELOOP 本体のマイクボタンと同じ紫グラデーションで、録音中も色は変えない。
 *
 * - 待機中: タップで録音開始（マイクのアイコン）
 * - 録音中: 中に音量で動くゲージバー。タップで一時停止 ⇔ 再開、[HOLD_TO_STOP_MS] 長押しで停止。
 *   長押し中はボタンの外周にリングが伸びていき、いっぱいになると停止する
 */
@Composable
fun RecordButton(
    recording: Boolean,
    paused: Boolean,
    level: Float,
    onStart: () -> Unit,
    onTogglePause: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 128.dp,
) {
    val haptics = LocalHapticFeedback.current
    val hold = remember { Animatable(0f) }
    val gesture =
        if (recording) {
            Modifier.pointerInput(Unit) {
                detectTapGestures(
                    onPress = {
                        // 押している間だけリングを伸ばす。2 秒持ったら停止、途中で離したらタップ扱い
                        coroutineScope {
                            var fired = false
                            val ring = launch { hold.animateTo(1f, tween(HOLD_TO_STOP_MS, easing = LinearEasing)) }
                            val timer =
                                launch {
                                    delay(HOLD_TO_STOP_MS.toLong())
                                    fired = true
                                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                    onStop()
                                }
                            val released = tryAwaitRelease()
                            ring.cancel()
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
    Box(modifier = modifier.size(size + RING_PAD * 2), contentAlignment = Alignment.Center) {
        // 長押しの進み具合（外周のリング）
        if (recording && hold.value > 0f) {
            Canvas(modifier = Modifier.size(size + RING_PAD * 2)) {
                val stroke = RING_WIDTH.toPx()
                drawArc(
                    color = NoteLoopColors.Brand1,
                    startAngle = -90f,
                    sweepAngle = 360f * hold.value,
                    useCenter = false,
                    topLeft = Offset(stroke / 2, stroke / 2),
                    size = Size(this.size.width - stroke, this.size.height - stroke),
                    style = Stroke(width = stroke, cap = StrokeCap.Round),
                )
            }
        }
        Box(
            modifier =
                Modifier
                    .size(size)
                    .clip(CircleShape)
                    .background(NoteLoopColors.brandGradient)
                    .then(gesture),
            contentAlignment = Alignment.Center,
        ) {
            if (recording) {
                GaugeBars(level = level, paused = paused, modifier = Modifier.size(size * GAUGE_RATIO))
            } else {
                Icon(
                    painter = painterResource(R.drawable.ic_mic),
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(size * ICON_RATIO),
                )
            }
        }
    }
}

/**
 * ボタンの中の音量ゲージ（5 本）。NOTELOOP 本体の通知ゲージと同じく、位置は固定で高さだけが
 * 音量に応じて伸び縮みする。中央ほどよく伸び、本ごとに少しだけ揺れを変えて機械的に見えないようにする。
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
private val RING_PAD = 10.dp
private val RING_WIDTH = 5.dp
private const val ICON_RATIO = 0.42f
private const val GAUGE_RATIO = 0.5f
private val BAR_GAIN = listOf(0.55f, 0.85f, 1.15f, 0.85f, 0.55f)
private const val BAR_RATIO = 0.5f
private const val MIN_BAR = 0.14f
private const val RISE_MS = 90
private const val FALL_MS = 220
