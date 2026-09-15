package jp.tcta.noteloop.wear.data

import android.content.Context
import android.media.MediaMetadataRetriever
import jp.tcta.noteloop.shared.RecordingFileNames
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import java.io.File
import java.time.LocalDateTime

/** 時計内に保存した録音 1 件。 */
data class RecordingItem(
    val file: File,
    val sizeBytes: Long,
    val durationMs: Long,
) {
    val name: String get() = file.name

    /** `2026/09/15 10:15` 形式。規則外のファイル名なら名前そのまま。 */
    val title: String get() = RecordingFileNames.displayTime(file.name) ?: file.name
}

/**
 * 録音ファイルの置き場（`filesDir/recordings`）。スマホへ送った後も時計側に残し、削除は手動。
 * 一覧は [refresh] で読み直す（件数が少ないので監視はしない）。
 */
class RecordingRepository(
    context: Context,
) {
    private val dir = File(context.filesDir, "recordings")

    private val mutableItems = MutableStateFlow<List<RecordingItem>>(emptyList())
    val items: StateFlow<List<RecordingItem>> = mutableItems

    /** 新しい録音ファイルのパスを発行する（ディレクトリも作る）。 */
    fun newFile(now: LocalDateTime = LocalDateTime.now()): File {
        dir.mkdirs()
        return File(dir, RecordingFileNames.build(now, SOURCE_WATCH))
    }

    fun find(name: String): RecordingItem? = mutableItems.value.firstOrNull { it.name == name }

    suspend fun refresh() {
        val list =
            withContext(Dispatchers.IO) {
                (dir.listFiles() ?: emptyArray())
                    .filter { it.isFile && it.extension == RecordingFileNames.EXTENSION && it.length() > 0 }
                    .sortedByDescending { it.name }
                    .map { RecordingItem(it, it.length(), durationOf(it)) }
            }
        mutableItems.value = list
    }

    suspend fun delete(item: RecordingItem) {
        withContext(Dispatchers.IO) { item.file.delete() }
        refresh()
    }

    private fun durationOf(file: File): Long =
        runCatching {
            MediaMetadataRetriever().use { r ->
                r.setDataSource(file.absolutePath)
                r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            }
        }.getOrDefault(0L)

    private companion object {
        const val SOURCE_WATCH = "watch"
    }
}
