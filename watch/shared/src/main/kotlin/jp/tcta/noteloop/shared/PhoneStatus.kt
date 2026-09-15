package jp.tcta.noteloop.shared

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * スマホ側の録音状態。スマホが変化のたびに時計へ送り、時計は「スマホで録音中 mm:ss」の表示に使う。
 *
 * @property recording 録音中か
 * @property startedAt 録音開始時刻（epoch ms）。停止中は 0
 * @property mode 録音を始めたときのモード。停止中は空
 * @property fileName 直近に保存したファイル名（表示用）。無ければ空
 * @property error 開始に失敗した理由（マイク権限が無い等）。無ければ空
 * @property sentAt 送信時刻（epoch ms）。古い状態を捨てる判定に使う
 */
@Serializable
data class PhoneStatus(
    val recording: Boolean = false,
    val startedAt: Long = 0L,
    val mode: String = "",
    val fileName: String = "",
    val error: String = "",
    val sentAt: Long = 0L,
) {
    fun toJson(): String = json.encodeToString(serializer(), this)

    fun toPayload(): ByteArray = toJson().toByteArray(Charsets.UTF_8)

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        fun parse(text: String): PhoneStatus = json.decodeFromString(serializer(), text)

        fun parse(payload: ByteArray?): PhoneStatus? = payload?.let { runCatching { parse(String(it, Charsets.UTF_8)) }.getOrNull() }
    }
}
