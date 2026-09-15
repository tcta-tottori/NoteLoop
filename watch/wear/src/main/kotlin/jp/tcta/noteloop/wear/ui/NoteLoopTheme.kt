package jp.tcta.noteloop.wear.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme

/**
 * NoteLoop 本体（styles.css の :root、マットなグレーがかった黒のダークテーマ）と同じ配色。
 * 録音ボタンは本体と同じく、待機中はブランドの紫グラデーション、録音中だけ赤系に変わる。
 */
object NoteLoopColors {
    val Bg = Color(0xFF17181B)
    val Surface = Color(0xFF212328)
    val SurfaceHigh = Color(0xFF2A2D33)
    val Border = Color(0xFF3C4048)
    val Text = Color(0xFFE7E9EE)
    val Muted = Color(0xFFA3A9B5)
    val Brand1 = Color(0xFF7B93FF)
    val Brand2 = Color(0xFFA68CFF)
    val Danger = Color(0xFFF87171)
    val Ok = Color(0xFF4ADE80)

    /** 録音中のボタン（本体の .mic-fab.recording と同じ 3 色） */
    val RecStart = Color(0xFFE11D48)
    val RecMid = Color(0xFFFF3D6B)
    val RecEnd = Color(0xFFFF8A3D)

    val brandGradient: Brush = Brush.linearGradient(listOf(Brand1, Brand2))
    val recordingGradient: Brush = Brush.linearGradient(listOf(RecStart, RecMid, RecEnd))
}

private val colorScheme =
    ColorScheme(
        primary = NoteLoopColors.Brand1,
        onPrimary = Color.White,
        primaryContainer = NoteLoopColors.Brand2,
        onPrimaryContainer = Color.White,
        secondary = NoteLoopColors.Muted,
        onSecondary = Color.Black,
        background = NoteLoopColors.Bg,
        onBackground = NoteLoopColors.Text,
        surfaceContainer = NoteLoopColors.Surface,
        surfaceContainerHigh = NoteLoopColors.SurfaceHigh,
        onSurface = NoteLoopColors.Text,
        onSurfaceVariant = NoteLoopColors.Muted,
        error = NoteLoopColors.Danger,
        onError = Color.White,
    )

@Composable
fun NoteLoopTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colorScheme, content = content)
}
