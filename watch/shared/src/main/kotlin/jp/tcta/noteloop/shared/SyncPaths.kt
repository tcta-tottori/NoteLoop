package jp.tcta.noteloop.shared

/**
 * Wearable Data Layer のパスとケイパビリティ名。時計とスマホで同じ定数を使う。
 * Manifest の pathPrefix（`/noteloop/`）と一致させること。
 */
object SyncPaths {
    const val PREFIX = "/noteloop/"

    /** 時計 → スマホ: 録音開始。payload は [RecordMode.id] の UTF-8。 */
    const val RECORD_START = "/noteloop/record/start"

    /** 時計 → スマホ: 録音停止。payload なし。 */
    const val RECORD_STOP = "/noteloop/record/stop"

    /** 時計 → スマホ: 現在の状態を返してほしい。payload なし。 */
    const val RECORD_QUERY = "/noteloop/record/query"

    /** スマホ → 時計: 録音状態。payload は [PhoneStatus] の JSON。 */
    const val RECORD_STATUS = "/noteloop/record/status"

    /** 時計 → スマホ: 時計で録った音声ファイルの転送（ChannelClient）。末尾にファイル名を付ける。 */
    const val TRANSFER_PREFIX = "/noteloop/transfer/"

    /** スマホ側アプリが名乗るケイパビリティ（`res/values/wear.xml`）。 */
    const val CAPABILITY_PHONE = "noteloop_phone"

    /** 時計側アプリが名乗るケイパビリティ。 */
    const val CAPABILITY_WATCH = "noteloop_watch"

    fun transferPath(fileName: String): String = TRANSFER_PREFIX + fileName

    fun isTransferPath(path: String?): Boolean = path != null && path.startsWith(TRANSFER_PREFIX)

    fun transferFileName(path: String): String = path.removePrefix(TRANSFER_PREFIX).substringAfterLast('/')
}
