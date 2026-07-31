package jp.tcta.noteloop;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.io.File;

/**
 * 録音をフォアグラウンドサービスで行う。
 *
 * WebView の MediaRecorder はアプリが背面に回ると OS に止められ、
 * 画面を消している間の音声がまるごと失われる。フォアグラウンドサービス
 * （foregroundServiceType=microphone）で録れば、通知が出ている限り
 * OS は録音を止めないため、長い会議でも最後まで残る。
 */
public class RecordingService extends Service {

    public static final String ACTION_START = "jp.tcta.noteloop.START";
    public static final String ACTION_STOP = "jp.tcta.noteloop.STOP";
    public static final String EXTRA_OUTPUT_PATH = "outputPath";

    private static final String TAG = "NoteLoopRec";
    private static final String CHANNEL_ID = "noteloop_recording";
    private static final int NOTIF_ID = 4711;

    /** 録音状態。プラグインから参照するのでプロセス内で共有する。 */
    private static volatile boolean recording = false;
    private static volatile String currentPath = null;
    private static volatile long startedAtElapsed = 0L;
    private static volatile String lastError = null;

    private MediaRecorder recorder;
    /** 音量ゲージ用。録音中の MediaRecorder を静的に持ち、プラグインから音量を読めるようにする。 */
    private static volatile MediaRecorder activeRecorder = null;

    public static boolean isRecording() { return recording; }

    /**
     * いま録音している音の大きさ（0.0〜1.0）。
     * MediaRecorder.getMaxAmplitude() は「前回呼んでからの最大振幅」を返すので、
     * 定期的に呼ぶだけでレベルメーターになる。マイクを二重に掴む必要がない。
     */
    public static float getLevel() {
        MediaRecorder r = activeRecorder;
        if (r == null || !recording) return 0f;
        try {
            int amp = r.getMaxAmplitude();          // 0..32767
            if (amp <= 0) return 0f;
            return Math.min(1f, amp / 24000f);
        } catch (Exception e) {
            return 0f;
        }
    }
    public static String getCurrentPath() { return currentPath; }
    public static String getLastError() { return lastError; }

    /** 録音開始からの経過ミリ秒（端末のスリープ中も進む時計を使う） */
    public static long getElapsedMs() {
        return recording && startedAtElapsed > 0 ? SystemClock.elapsedRealtime() - startedAtElapsed : 0L;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            stopRecording();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_START.equals(action)) {
            String path = intent.getStringExtra(EXTRA_OUTPUT_PATH);
            startForegroundWithNotification();
            if (!startRecording(path)) {
                stopSelf();
                return START_NOT_STICKY;
            }
            // 万一プロセスが落ちても OS に再開させる
            return START_STICKY;
        }
        return START_NOT_STICKY;
    }

    private void startForegroundWithNotification() {
        createChannel();
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent contentPi = PendingIntent.getActivity(this, 0, open, piFlags);

        Intent stop = new Intent(this, RecordingService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, stop, piFlags);

        Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("録音中")
                .setContentText("NOTELOOP が会議を録音しています")
                .setSmallIcon(android.R.drawable.presence_audio_online)
                .setContentIntent(contentPi)
                .addAction(0, "停止", stopPi)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "録音", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("録音中に表示され、ここから停止できます");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private boolean startRecording(String path) {
        if (recording) return true;
        if (path == null || path.isEmpty()) {
            lastError = "保存先が指定されていません";
            return false;
        }
        try {
            File out = new File(path);
            File parent = out.getParentFile();
            if (parent != null && !parent.exists()) parent.mkdirs();

            recorder = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                    ? new MediaRecorder(this) : new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            // 会議の音声を Gemini に送る用途。16kHz モノラルで十分に聞き取れ、
            // 1時間でも 15MB 程度に収まる。
            recorder.setAudioSamplingRate(16000);
            recorder.setAudioChannels(1);
            recorder.setAudioEncodingBitRate(32000);
            recorder.setOutputFile(path);
            recorder.setOnErrorListener((mr, what, extra) -> {
                lastError = "録音エラー (" + what + "/" + extra + ")";
                Log.e(TAG, lastError);
            });
            recorder.prepare();
            recorder.start();

            activeRecorder = recorder;
            currentPath = path;
            startedAtElapsed = SystemClock.elapsedRealtime();
            recording = true;
            lastError = null;
            return true;
        } catch (Exception e) {
            lastError = String.valueOf(e.getMessage());
            Log.e(TAG, "録音を開始できませんでした", e);
            releaseRecorder();
            return false;
        }
    }

    private void stopRecording() {
        if (!recording) return;
        recording = false;
        try {
            recorder.stop();
        } catch (Exception e) {
            // 極端に短い録音などで stop が例外になる。ファイルは残るのでそのまま進める。
            Log.w(TAG, "stop に失敗しました", e);
            lastError = "録音の終了処理に失敗しました: " + e.getMessage();
        }
        releaseRecorder();
        startedAtElapsed = 0L;
    }

    private void releaseRecorder() {
        activeRecorder = null;
        if (recorder != null) {
            try { recorder.release(); } catch (Exception ignored) {}
            recorder = null;
        }
    }

    @Override
    public void onDestroy() {
        stopRecording();
        super.onDestroy();
    }

    /** 外部（プラグイン）から開始・停止するための入口 */
    public static void start(Context ctx, String path) {
        Intent i = new Intent(ctx, RecordingService.class)
                .setAction(ACTION_START)
                .putExtra(EXTRA_OUTPUT_PATH, path);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    public static void stop(Context ctx) {
        ctx.startService(new Intent(ctx, RecordingService.class).setAction(ACTION_STOP));
    }
}
