package jp.tcta.noteloop.shared

/**
 * Wearable Data Layer のパスとケイパビリティ名。時計とスマホ（android/ の WatchSync.java）で同じ値を使う。
 * スマホ側 Manifest の pathPrefix（`/noteloop/`）と一致させること。
 */
object SyncPaths {
    const val PREFIX = "/noteloop/"

    /** 時計 → スマホ: 時計で録った音声ファイルの転送（ChannelClient）。末尾にファイル名を付ける。 */
    const val TRANSFER_PREFIX = "/noteloop/transfer/"

    /** スマホ側アプリ（NOTELOOP 本体）が名乗るケイパビリティ（`res/values/wear.xml`）。 */
    const val CAPABILITY_PHONE = "noteloop_phone"

    /** 時計側アプリが名乗るケイパビリティ。 */
    const val CAPABILITY_WATCH = "noteloop_watch"

    fun transferPath(fileName: String): String = TRANSFER_PREFIX + fileName
}
