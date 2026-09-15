package jp.tcta.noteloop.wear.ui.common

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Icon
import jp.tcta.noteloop.wear.R
import jp.tcta.noteloop.wear.ui.NoteLoopColors

/**
 * NoteLoop 本体の中央マイクボタン（.mic-fab）を時計に移したもの。
 * 待機中はブランドの紫グラデーション、録音中は赤系に変わりアイコンが ■ になって、外側に広がるリング（.rec-ring）が回る。
 */
@Composable
fun MicButton(
    recording: Boolean,
    onClick: () -> Unit,
    contentDescription: String,
    modifier: Modifier = Modifier,
    size: Dp = 64.dp,
    enabled: Boolean = true,
) {
    Box(modifier = modifier.size(size + RING_EXTRA * 2), contentAlignment = Alignment.Center) {
        if (recording) RecordingRing(size)
        Box(
            modifier =
                Modifier
                    .size(size)
                    .clip(CircleShape)
                    .background(if (recording) NoteLoopColors.recordingGradient else NoteLoopColors.brandGradient)
                    .alpha(if (enabled) 1f else DISABLED_ALPHA)
                    .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(if (recording) R.drawable.ic_stop else R.drawable.ic_mic),
                contentDescription = contentDescription,
                tint = Color.White,
                modifier = Modifier.size(size * ICON_RATIO),
            )
        }
    }
}

@Composable
private fun RecordingRing(size: Dp) {
    val transition = rememberInfiniteTransition(label = "ring")
    val progress by
        transition.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(RING_PERIOD_MS, easing = LinearEasing), RepeatMode.Restart),
            label = "ringProgress",
        )
    Box(
        modifier =
            Modifier
                .size(size + RING_EXTRA * 2)
                .scale(RING_SCALE_FROM + (RING_SCALE_TO - RING_SCALE_FROM) * progress)
                .alpha(RING_ALPHA * (1f - progress))
                .border(2.dp, NoteLoopColors.RecMid, CircleShape),
    )
}

private val RING_EXTRA = 12.dp
private const val ICON_RATIO = 0.45f
private const val DISABLED_ALPHA = 0.55f
private const val RING_PERIOD_MS = 1_500
private const val RING_SCALE_FROM = 0.85f
private const val RING_SCALE_TO = 1.3f
private const val RING_ALPHA = 0.7f
