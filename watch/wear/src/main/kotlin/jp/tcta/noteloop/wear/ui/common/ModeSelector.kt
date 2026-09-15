package jp.tcta.noteloop.wear.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Icon
import jp.tcta.noteloop.shared.RecordMode
import jp.tcta.noteloop.wear.R
import jp.tcta.noteloop.wear.ui.NoteLoopColors

/** モードのアイコンと名前。ホーム・設定・タイルで共通。 */
val RecordMode.iconRes: Int
    get() =
        when (this) {
            RecordMode.WATCH -> R.drawable.ic_watch
            RecordMode.DOUBLE -> R.drawable.ic_double
            RecordMode.PHONE -> R.drawable.ic_phone
        }

val RecordMode.labelRes: Int
    get() =
        when (this) {
            RecordMode.WATCH -> R.string.mode_watch
            RecordMode.DOUBLE -> R.string.mode_double
            RecordMode.PHONE -> R.string.mode_phone
        }

val RecordMode.longLabelRes: Int
    get() =
        when (this) {
            RecordMode.WATCH -> R.string.mode_watch_long
            RecordMode.DOUBLE -> R.string.mode_double_long
            RecordMode.PHONE -> R.string.mode_phone_long
        }

/** 3 つの丸ボタン（ウォッチ / ダブル / スマホ）。選択中はロゴ色、他は暗い円。 */
@Composable
fun ModeSelector(
    selected: RecordMode,
    onSelect: (RecordMode) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Row(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        RecordMode.entries.forEach { mode ->
            val isSelected = mode == selected
            val label = stringResource(mode.longLabelRes)
            Box(
                modifier =
                    Modifier
                        .size(BUTTON_SIZE)
                        .clip(CircleShape)
                        .then(
                            if (isSelected) {
                                Modifier.background(NoteLoopColors.brandGradient)
                            } else {
                                Modifier.background(NoteLoopColors.Surface).border(1.dp, NoteLoopColors.Border, CircleShape)
                            },
                        ).clickable(enabled = enabled, role = Role.RadioButton, onClick = { onSelect(mode) }),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painter = painterResource(mode.iconRes),
                    contentDescription = label,
                    tint = if (isSelected) Color.White else NoteLoopColors.Muted,
                    modifier = Modifier.size(ICON_SIZE),
                )
            }
        }
    }
}

private val BUTTON_SIZE = 40.dp
private val ICON_SIZE = 20.dp
