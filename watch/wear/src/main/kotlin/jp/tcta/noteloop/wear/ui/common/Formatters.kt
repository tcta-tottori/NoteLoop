package jp.tcta.noteloop.wear.ui.common

import java.util.Locale

/** ミリ秒を `mm:ss`（1 時間以上は `h:mm:ss`）にする。 */
fun formatElapsed(millis: Long): String {
    val total = (millis / 1000).coerceAtLeast(0)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) {
        String.format(Locale.JAPAN, "%d:%02d:%02d", h, m, s)
    } else {
        String.format(Locale.JAPAN, "%02d:%02d", m, s)
    }
}

/** バイト数を `1.2 MB` / `340 KB` にする。 */
fun formatSize(bytes: Long): String =
    when {
        bytes >= MB -> String.format(Locale.JAPAN, "%.1f MB", bytes / MB.toDouble())
        bytes >= KB -> String.format(Locale.JAPAN, "%d KB", bytes / KB)
        else -> "$bytes B"
    }

private const val KB = 1024L
private const val MB = KB * 1024
