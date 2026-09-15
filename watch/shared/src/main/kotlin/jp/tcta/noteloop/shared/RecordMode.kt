package jp.tcta.noteloop.shared

/**
 * 録音モード。時計のホーム画面・タイルで選び、開始時に確定する。
 *
 * - [WATCH]  時計のマイクだけで録音する（スマホ不要）
 * - [DOUBLE] 時計とスマホの両方で同時に録音する（バックアップ / 音質の良い方を後で選ぶ）
 * - [PHONE]  時計は指示だけ出し、スマホのマイクで録音する
 */
enum class RecordMode(
    val id: String,
) {
    WATCH("watch"),
    DOUBLE("double"),
    PHONE("phone"),
    ;

    /** 時計側のマイクで録音するか。 */
    val recordsOnWatch: Boolean get() = this != PHONE

    /** スマホ側のマイクで録音するか。 */
    val recordsOnPhone: Boolean get() = this != WATCH

    companion object {
        fun fromId(id: String?): RecordMode = entries.firstOrNull { it.id == id } ?: WATCH
    }
}
