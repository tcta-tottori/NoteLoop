package jp.tcta.noteloop.wear.record

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import androidx.wear.tiles.TileService
import jp.tcta.noteloop.wear.MainActivity
import jp.tcta.noteloop.wear.R
import jp.tcta.noteloop.wear.appContainer
import jp.tcta.noteloop.wear.data.AudioQuality
import jp.tcta.noteloop.wear.tile.RecordTileService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File

/**
 * 時計のマイクで録音するフォアグラウンドサービス。
 * MediaRecorder（AAC / m4a）で `filesDir/recordings` に書き、状態は [RecorderStateStore] に流す。
 * 録音中は Ongoing Activity で文字盤に常駐表示し、タップでアプリに戻れる。
 */
class RecorderService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var recorder: MediaRecorder? = null
    private var outputFile: File? = null
    private var levelJob: Job? = null
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        when (intent?.action) {
            ACTION_START -> start(AudioQuality.fromId(intent.getStringExtra(EXTRA_QUALITY)))
            ACTION_STOP -> stopAndFinish()
            else -> if (recorder == null) stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun start(quality: AudioQuality) {
        if (recorder != null) return
        val store = appContainer.recorderState
        val file = appContainer.recordings.newFile()
        val startedAt = System.currentTimeMillis()
        // 先に前面化しないと Android 12+ で 5 秒以内に startForeground が無いとして落ちる
        startForeground(startedAt)
        val r = createRecorder()
        try {
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioChannels(1)
            r.setAudioSamplingRate(SAMPLE_RATE)
            r.setAudioEncodingBitRate(quality.bitRate)
            r.setOutputFile(file.absolutePath)
            r.prepare()
            r.start()
        } catch (e: Exception) {
            Log.e(TAG, "録音を開始できません", e)
            r.release()
            file.delete()
            store.update { it.copy(recording = false, startedAt = 0L, levels = emptyList(), error = e.message ?: e.javaClass.simpleName) }
            stopForegroundAndSelf()
            return
        }
        recorder = r
        outputFile = file
        acquireWakeLock()
        store.update { it.copy(recording = true, startedAt = startedAt, levels = emptyList(), lastSavedName = null, error = null) }
        levelJob =
            scope.launch {
                while (isActive) {
                    val amp = runCatching { recorder?.maxAmplitude ?: 0 }.getOrDefault(0)
                    store.pushLevel(amp / MAX_AMPLITUDE)
                    delay(LEVEL_INTERVAL_MS)
                }
            }
        TileService.getUpdater(this).requestUpdate(RecordTileService::class.java)
    }

    private fun stopAndFinish() {
        val r = recorder
        val file = outputFile
        levelJob?.cancel()
        levelJob = null
        recorder = null
        outputFile = null
        var saved: String? = null
        if (r != null) {
            try {
                r.stop()
                saved = file?.name
            } catch (e: RuntimeException) {
                // 開始直後の停止など、有効なデータが無いと stop() が投げる。その場合はファイルを捨てる
                Log.w(TAG, "録音データがありません: ${e.message}")
                file?.delete()
            } finally {
                r.release()
            }
        }
        releaseWakeLock()
        appContainer.recorderState.update { it.copy(recording = false, startedAt = 0L, levels = emptyList(), lastSavedName = saved) }
        scope.launch { appContainer.recordings.refresh() }
        TileService.getUpdater(this).requestUpdate(RecordTileService::class.java)
        stopForegroundAndSelf()
    }

    private fun stopForegroundAndSelf() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        // 想定外に落とされた場合も録音を閉じてファイルを残す
        if (recorder != null) stopAndFinish()
        scope.cancel()
        super.onDestroy()
    }

    @Suppress("DEPRECATION")
    private fun createRecorder(): MediaRecorder =
        if (Build.VERSION.SDK_INT >=
            Build.VERSION_CODES.S
        ) {
            MediaRecorder(this)
        } else {
            MediaRecorder()
        }

    private fun startForeground(startedAt: Long) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW),
        )
        val openApp =
            PendingIntent.getActivity(
                this,
                REQUEST_OPEN,
                Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val stop =
            PendingIntent.getActivity(
                this,
                REQUEST_STOP,
                Intent(this, MainActivity::class.java).setAction(MainActivity.ACTION_STOP).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val builder =
            NotificationCompat
                .Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_mic)
                .setContentTitle(getString(R.string.notif_title))
                .setContentIntent(openApp)
                .setOngoing(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .addAction(R.drawable.ic_stop, getString(R.string.notif_stop), stop)
        // 文字盤にマイクアイコンと経過時間を出し、タップでアプリへ戻る
        OngoingActivity
            .Builder(applicationContext, NOTIFICATION_ID, builder)
            .setStaticIcon(R.drawable.ic_mic)
            .setTouchIntent(openApp)
            .setStatus(Status.forPart(Status.StopwatchPart(startedAt)))
            .build()
            .apply(applicationContext)
        ServiceCompat.startForeground(this, NOTIFICATION_ID, builder.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    }

    private fun acquireWakeLock() {
        val pm = getSystemService(PowerManager::class.java)
        wakeLock =
            pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).also {
                it.setReferenceCounted(false)
                it.acquire(WAKE_LOCK_MAX_MS)
            }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }

    companion object {
        private const val TAG = "RecorderService"
        private const val ACTION_START = "jp.tcta.noteloop.wear.record.START"
        private const val ACTION_STOP = "jp.tcta.noteloop.wear.record.STOP"
        private const val EXTRA_QUALITY = "quality"
        private const val CHANNEL_ID = "recording"
        private const val NOTIFICATION_ID = 1
        private const val REQUEST_OPEN = 10
        private const val REQUEST_STOP = 11
        private const val SAMPLE_RATE = 44_100
        private const val MAX_AMPLITUDE = 32_767f
        private const val LEVEL_INTERVAL_MS = 120L
        private const val WAKE_LOCK_TAG = "noteloop:recording"

        /** 録音の上限（安全弁）。3 時間。 */
        private const val WAKE_LOCK_MAX_MS = 3L * 60 * 60 * 1000

        fun start(
            context: Context,
            quality: AudioQuality,
        ) {
            val intent = Intent(context, RecorderService::class.java).setAction(ACTION_START).putExtra(EXTRA_QUALITY, quality.id)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.startService(Intent(context, RecorderService::class.java).setAction(ACTION_STOP))
        }
    }
}
