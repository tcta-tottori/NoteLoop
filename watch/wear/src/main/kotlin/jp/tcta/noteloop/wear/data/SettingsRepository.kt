package jp.tcta.noteloop.wear.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import jp.tcta.noteloop.shared.RecordMode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.settingsStore: DataStore<Preferences> by preferencesDataStore(name = "noteloop_wear_settings")

/** 音質。ビットレートだけ変える（サンプリングは 44.1kHz モノラル固定）。 */
enum class AudioQuality(
    val id: String,
    val bitRate: Int,
) {
    STANDARD("standard", 96_000),
    HIGH("high", 128_000),
    ;

    companion object {
        fun fromId(id: String?): AudioQuality = entries.firstOrNull { it.id == id } ?: STANDARD
    }
}

/** 既定の録音モードと音質。ホームで選んだモードは次回の既定になる。 */
class SettingsRepository(
    private val context: Context,
) {
    private val store get() = context.settingsStore

    val defaultMode: Flow<RecordMode> = store.data.map { RecordMode.fromId(it[Keys.DEFAULT_MODE]) }
    val quality: Flow<AudioQuality> = store.data.map { AudioQuality.fromId(it[Keys.QUALITY]) }

    suspend fun currentDefaultMode(): RecordMode = defaultMode.first()

    suspend fun currentQuality(): AudioQuality = quality.first()

    suspend fun setDefaultMode(mode: RecordMode) {
        store.edit { it[Keys.DEFAULT_MODE] = mode.id }
    }

    suspend fun setQuality(quality: AudioQuality) {
        store.edit { it[Keys.QUALITY] = quality.id }
    }

    private object Keys {
        val DEFAULT_MODE = stringPreferencesKey("default_mode")
        val QUALITY = stringPreferencesKey("quality")
    }
}
