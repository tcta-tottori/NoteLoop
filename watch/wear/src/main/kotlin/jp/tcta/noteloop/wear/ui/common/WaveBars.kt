package jp.tcta.noteloop.wear.ui.common

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.unit.dp
import jp.tcta.noteloop.wear.ui.NoteLoopColors

/** Web 版の録音中ウェーブ（#wave）に相当する棒グラフ。右端が最新の入力レベル。 */
@Composable
fun WaveBars(
    levels: List<Float>,
    modifier: Modifier = Modifier,
    bars: Int = 24,
) {
    Canvas(modifier = modifier.height(WAVE_HEIGHT)) {
        val gap = size.width / bars
        val stroke = gap * BAR_RATIO
        val midY = size.height / 2
        val tail = levels.takeLast(bars)
        val offset = bars - tail.size
        for (i in 0 until bars) {
            val level = tail.getOrNull(i - offset) ?: 0f
            val half = (size.height / 2) * (MIN_BAR + (1f - MIN_BAR) * level)
            val x = gap * i + gap / 2
            drawLine(
                brush = NoteLoopColors.brandGradient,
                start = Offset(x, midY - half),
                end = Offset(x, midY + half),
                strokeWidth = stroke,
                cap = StrokeCap.Round,
            )
        }
    }
}

private val WAVE_HEIGHT = 36.dp
private const val BAR_RATIO = 0.55f
private const val MIN_BAR = 0.12f
