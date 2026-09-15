package jp.tcta.noteloop.shared

import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/**
 * 録音ファイル名の規則。NoteLoop（Web 版）の書き出しと同じ `noteloop_yyyyMMdd_HHmmss` を使い、
 * どこで録ったかを末尾で区別する（`_watch` / `_phone`）。拡張子は m4a（AAC）。
 */
object RecordingFileNames {
    const val EXTENSION = "m4a"
    const val MIME_TYPE = "audio/mp4"
    private const val PREFIX = "noteloop_"
    private val formatter: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss")

    fun build(
        now: LocalDateTime,
        source: String,
    ): String = "$PREFIX${now.format(formatter)}_$source.$EXTENSION"

    /** `noteloop_20260915_101500_watch.m4a` → `2026/09/15 10:15`。規則外なら null。 */
    fun displayTime(fileName: String): String? {
        val core = fileName.removePrefix(PREFIX).substringBeforeLast('.')
        val parts = core.split('_')
        if (parts.size < 2) return null
        return runCatching {
            val t = LocalDateTime.parse("${parts[0]}_${parts[1]}", formatter)
            t.format(DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm"))
        }.getOrNull()
    }
}
