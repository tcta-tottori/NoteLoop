package jp.tcta.noteloop;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import android.widget.RemoteViews;

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
    // ロック画面に内容を出す設定（VISIBILITY_PUBLIC）を効かせるため、
    // チャンネルを作り直している。既存チャンネルの設定は後から変更できない。
    public static final String CHANNEL_ID = "noteloop_recording_v2";
    private static final String CHANNEL_ID_OLD = "noteloop_recording";
    private static final int NOTIF_ID = 4711;

    /** 音量を読む間隔。1本のバーがこの時間ぶんの音量になる。 */
    private static final long LEVEL_TICK_MS = 100L;
    /** 通知のゲージを描き替える間隔（音量の読み取り何回ぶんか）。 */
    private static final int NOTIF_EVERY_AWAKE = 4;  // 画面が点いている: 0.4秒ごと
    private static final int NOTIF_EVERY_ASLEEP = 10; // 画面が消えている: 1秒ごと（誰も見ていないので粗く）

    /** 通知に描くゲージ画像の大きさ（px）。表示側で横幅いっぱいに引き伸ばす。
     *  通知の更新ごとに画像を送るため、大きくしすぎない。 */
    private static final int GAUGE_W = 420;
    private static final int GAUGE_H = 48;
    /** ゲージのバーの本数（位置は固定で、音量に応じて上下に伸びる） */
    private static final int BARS = 16;
    /** これ以下の音は「無音」として扱う（振幅の全体に対する割合＝約 650/32767） */
    private static final float LEVEL_GATE = 0.02f;
    /** バーの色（左が濃い青 → 右へ明るい水色。アプリ画面のゲージと同じ配色） */
    private static final int[] GAUGE_COLORS = { 0xFF2F4FC8, 0xFF3B6FE0, 0xFF4F9BF2, 0xFF7FD2FB };
    private static final float[] GAUGE_STOPS = { 0f, 0.35f, 0.62f, 1f };

    /** 録音状態。プラグインから参照するのでプロセス内で共有する。 */
    private static volatile boolean recording = false;
    private static volatile String currentPath = null;
    private static volatile long startedAtElapsed = 0L;
    private static volatile String lastError = null;

    private MediaRecorder recorder;

    /** 通知のゲージ更新用。通知を作り直さず、同じ Builder を使い回す。 */
    private NotificationCompat.Builder notifBuilder;
    /* 音量の読み取りと通知の描き替えは専用スレッドで回す。
     * 画像の生成と通知の送信はそれなりに重く、UI スレッドでやると
     * WebView とのやり取り（＝画面のゲージ）まで巻き込んで遅くなる。 */
    private HandlerThread gaugeThread;
    private Handler gaugeHandler;
    private int notifCountdown = 0;
    /**
     * いまの音の大きさ（0.0〜1.0）。
     * getMaxAmplitude() は「前回呼んでからの最大振幅」を返すため、複数の場所から
     * 呼ぶと互いに値を食い合う。読むのはこのサービスの1か所だけにして、
     * 通知のゲージも画面のゲージ（getLevel）も、この値を共有する。
     */
    private static volatile float level = 0f;
    /** 直近に音量を読んだ時刻。読み取りが止まっていないかの判定に使う。 */
    private static volatile long lastSampleAt = 0L;
    /** 直近に読めた生の振幅（0..32767）。診断表示用。 */
    private static volatile int lastAmp = -1;
    /** 音量読み取りに使っている MediaRecorder（切り替え時の保険。静的に持つ） */
    private static volatile MediaRecorder activeRecorder = null;
    /** 自前の録音エンジン（こちらが使えるときは常にこちら） */
    private static volatile AudioRecorderEngine engine = null;

    /** 各バーの現在の高さ（0..1）。位置は固定なので、ここだけが動く。 */
    private final float[] barV = new float[BARS];
    private Paint gaugePaint;

    private final Runnable gaugeTick = new Runnable() {
        @Override
        public void run() {
            if (!recording) return;
            sampleLevel();
            if (--notifCountdown <= 0) {
                notifCountdown = isScreenOn() ? NOTIF_EVERY_AWAKE : NOTIF_EVERY_ASLEEP;
                updateGauge();
            }
            if (gaugeHandler != null) gaugeHandler.postDelayed(this, LEVEL_TICK_MS);
        }
    };

    /** 音量の読み取り＋通知のゲージ更新を、専用スレッドで回し始める */
    private void startGaugeLoop() {
        if (gaugeThread == null) {
            gaugeThread = new HandlerThread("noteloop-gauge");
            gaugeThread.start();
            gaugeHandler = new Handler(gaugeThread.getLooper());
        }
        gaugeHandler.removeCallbacks(gaugeTick);
        gaugeHandler.postDelayed(gaugeTick, LEVEL_TICK_MS);
    }

    private void stopGaugeLoop() {
        if (gaugeHandler != null) gaugeHandler.removeCallbacks(gaugeTick);
    }

    public static boolean isRecording() { return recording; }

    /**
     * 録音中の音量（0.0〜1.0）。画面上のゲージ表示に使う。
     *
     * 通常はサービス側の定期読み取り（sampleLevel）の結果を返すが、
     * 何らかの理由でその読み取りが止まっている端末でもゲージが動くよう、
     * 値が古いときはこの場で読み直す（保険）。
     */
    public static float getLevel() {
        if (!recording) return 0f;
        if (SystemClock.elapsedRealtime() - lastSampleAt > 500L) sampleLevelNow();
        return level;
    }

    /** 診断用: 直近に読めた生の振幅（0..32767）。-1 は一度も読めていない。 */
    public static int getLastAmp() { return lastAmp; }

    /** 診断用: いま使っている録音エンジン */
    public static String getEngineName() {
        if (engine != null) return "AudioRecord";
        if (activeRecorder != null) return "MediaRecorder";
        return "-";
    }

    /**
     * 診断用: 最後に音量を読んでからの経過ミリ秒。
     * 定期読み取りが動いていれば常に 0.1 秒程度。大きければ読み取りが止まっている。
     * （getLevel より先に呼ぶこと。getLevel は必要なら読み直してこの値を戻すため）
     */
    public static long getSampleAgeMs() {
        return lastSampleAt > 0 ? SystemClock.elapsedRealtime() - lastSampleAt : -1L;
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

        // たたんだ状態（ロック画面で見えるもの）は OS 標準の体裁のままにする。
        // カスタムビューは端末のUIによっては描画されないことがあり、
        // 「通知そのものが見えない」事故につながるため、まず確実に出す方を優先する。
        //   ・経過時間 … setUsesChronometer（OS が数えるのでズレない）
        //   ・音量    … setProgress のバー（0.4秒ごとに更新）
        // 広げた状態では、アプリ画面と同じ縦バーのゲージ（自前で描いた画像）を出す。
        notifBuilder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("● 録音中")
                .setContentText("画面を消しても録音は続いています")
                .setSmallIcon(android.R.drawable.presence_audio_online)
                .setContentIntent(contentPi)
                .addAction(0, "停止", stopPi)
                .setOngoing(true)
                .setSilent(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(true)
                .setWhen(System.currentTimeMillis())
                .setUsesChronometer(true)
                // ロック画面でも内容（経過時間・ゲージ）が見えるようにする
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setProgress(100, 2, false)
                .setStyle(new NotificationCompat.DecoratedCustomViewStyle());
        applyGaugeViews();

        Notification n = notifBuilder.build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    /**
     * マイクの音量を読んで level に入れる。
     * getMaxAmplitude() は「前回呼んでからの最大振幅（0..32767）」を返すので、
     * 一定間隔で呼べばそのままレベルメーターになる。
     */
    private void sampleLevel() { sampleLevelNow(); }

    /** マイクの音量を1回読んで level を更新する（サービス側・プラグイン側の両方から呼ぶ） */
    private static void sampleLevelNow() {
        int amp = -1;
        AudioRecorderEngine eng = engine;
        if (eng != null) {
            // 自前エンジン: PCM から拾った最大振幅（前回読んでからのぶん）
            amp = eng.takePeak();
        } else {
            MediaRecorder r = activeRecorder;
            if (r == null) return;
            try {
                amp = r.getMaxAmplitude();
            } catch (Exception ignored) { /* 停止直後などは取得できない */ }
        }
        lastSampleAt = SystemClock.elapsedRealtime();
        if (amp < 0) return;
        lastAmp = amp;
        float target = toLevel(amp);
        // アタックは速く、リリースはゆっくり（跳ねて滑らかに戻る動き）
        level = target > level ? target : level * 0.82f + target * 0.18f;
    }

    /**
     * 振幅（0..32767）を、ゲージの高さに使う 0..1 へ変換する。
     *
     * 単純な割り算だと、静かな部屋の物音でもバーが持ち上がり、少し大きい声で
     * すぐ頭打ちになって「音の大きさで変わらない」見え方になる。人の耳に近い
     * 対数目盛りにし、下限（ノイズゲート）より小さい音は 0（＝点のまま）にする。
     */
    private static float toLevel(int amp) {
        float norm = amp / 32767f;
        if (norm <= LEVEL_GATE) return 0f;
        double v = (Math.log10(norm) - Math.log10(LEVEL_GATE)) / -Math.log10(LEVEL_GATE);
        if (v < 0.05) return 0f;    // ごくわずかな音は動かさない
        return (float) Math.min(1.0, v);
    }

    /** 決まった見た目を再現するための擬似乱数（アプリ画面のゲージと同じ作り） */
    private static float gaugeNoise(double seed) {
        double x = Math.sin(seed * 12.9898) * 43758.5453;
        return (float) (x - Math.floor(x)); // 0..1
    }

    /** 画面が点いているか（消えている間は通知の描き替えを粗くして電池を節約する） */
    private boolean isScreenOn() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            return pm == null || pm.isInteractive();
        } catch (Exception e) { return true; }
    }

    /**
     * 通知に載せるゲージを描く。
     * バーの位置は固定で、いまの音量に応じてその場で上下に伸びる。
     * 静かなときは丸い点になる。アプリ画面のゲージと同じ見た目・動きにそろえている。
     */
    private Bitmap renderGauge() {
        Bitmap bmp = Bitmap.createBitmap(GAUGE_W, GAUGE_H, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        if (gaugePaint == null) {
            gaugePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            gaugePaint.setShader(new LinearGradient(
                    0, 0, GAUGE_W, 0, GAUGE_COLORS, GAUGE_STOPS, Shader.TileMode.CLAMP));
        }
        final float pitch = (float) GAUGE_W / BARS;
        final float barW = pitch * 0.3f;                  // 細めのバー＋広めの間隔
        final float maxH = GAUGE_H * 0.92f;               // いちばん大きい声のときの高さ
        final float minH = barW;                          // 無音は「点」になる
        final float mid = GAUGE_H / 2f;
        final double now = SystemClock.elapsedRealtime() / 1000.0;
        final float lv = level;

        for (int i = 0; i < BARS; i++) {
            float t = BARS > 1 ? (float) i / (BARS - 1) : 0.5f;
            // 中央ほど大きく振れる（両端は控えめ）
            float env = (float) (0.35 + 0.65 * Math.pow(Math.sin(Math.PI * t), 0.7));
            // 1本ごとに感度と揺れの速さを変え、横一直線にならないようにする
            float gain = 0.8f + gaugeNoise(i * 3.9) * 0.35f;
            float speed = 1.0f + gaugeNoise(i * 1.3) * 1.6f;
            float phase = gaugeNoise(i * 2.7) * (float) Math.PI * 2f;
            float wobble = (float) (0.7 + 0.3 * Math.sin(now * speed + phase));
            float target = Math.min(1f, lv * gain * env * wobble);
            // 伸びるのは速く、戻るのはゆっくり
            barV[i] += (target - barV[i]) * (target > barV[i] ? 0.5f : 0.2f);

            float bh = minH + (maxH - minH) * barV[i];
            float x = i * pitch + (pitch - barW) / 2f;
            RectF r = new RectF(x, mid - bh / 2f, x + barW, mid + bh / 2f);
            c.drawRoundRect(r, barW / 2f, barW / 2f, gaugePaint);
        }
        return bmp;
    }

    /** 通知のゲージを現在の音量に合わせて描き替える（ロック画面でも動いて見える）。 */
    private void updateGauge() {
        if (notifBuilder == null || !recording) return;
        try {
            // たたんだ状態は標準の体裁のまま、バーの伸び具合だけ更新する。
            // 小さな音でもバーが動くよう、平方根で持ち上げる。
            int shown = (int) Math.round(Math.sqrt(level) * 100);
            notifBuilder.setProgress(100, Math.max(2, shown), false);
            applyGaugeViews();
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, notifBuilder.build());
        } catch (Exception e) {
            // 通知が出せない（権限を切られた等）だけなら録音は続ける
            Log.w(TAG, "通知を更新できませんでした", e);
        }
    }

    /**
     * 広げた状態の通知に、アプリ画面と同じ縦バーのゲージを載せる。
     * RemoteViews は setXxx のたびに命令が積まれるため、毎回作り直す。
     * 端末によってはカスタムビューが描かれないことがあるが、その場合でも
     * たたんだ状態（標準の体裁）は出るので、通知が消えることはない。
     */
    private void applyGaugeViews() {
        if (notifBuilder == null) return;
        try {
            RemoteViews rv = new RemoteViews(getPackageName(), R.layout.notif_recording_big);
            rv.setTextViewText(R.id.notif_title, "● 録音中");
            rv.setTextViewText(R.id.notif_text, "画面を消しても録音は続いています");
            rv.setImageViewBitmap(R.id.notif_gauge, renderGauge());
            notifBuilder.setCustomBigContentView(rv);
        } catch (Exception e) {
            Log.w(TAG, "ゲージ付きの通知ビューを作れませんでした", e);
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        // 旧チャンネル（ロック画面の表示設定が入っていない）は片付ける
        try { nm.deleteNotificationChannel(CHANNEL_ID_OLD); } catch (Exception ignored) {}
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "録音", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("録音中に表示され、経過時間と音量のゲージ、停止ボタンが出ます");
        ch.setShowBadge(false);
        ch.setSound(null, null);
        ch.enableVibration(false);
        // ロック画面に内容をそのまま出す（「録音中」と分かるようにするため）
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    private boolean startRecording(String path) {
        if (recording) return true;
        if (path == null || path.isEmpty()) {
            lastError = "保存先が指定されていません";
            return false;
        }

        // まずは自前のエンジン（AudioRecord）で録る。PCM を直接読むので
        // 音量が必ず分かる（MediaRecorder.getMaxAmplitude() が常に 0 を返す
        // 端末があり、それだとゲージが作れない）。
        AudioRecorderEngine eng = new AudioRecorderEngine();
        if (eng.start(path)) {
            engine = eng;
            beginRecordingState(path);
            return true;
        }
        Log.w(TAG, "AudioRecord を使えないため MediaRecorder に切り替えます: " + eng.getError());

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
            beginRecordingState(path);
            return true;
        } catch (Exception e) {
            lastError = String.valueOf(e.getMessage());
            Log.e(TAG, "録音を開始できませんでした", e);
            releaseRecorder();
            return false;
        }
    }

    /** 録音を開始できたときの共通処理（どちらのエンジンでも同じ） */
    private void beginRecordingState(String path) {
        currentPath = path;
        startedAtElapsed = SystemClock.elapsedRealtime();
        recording = true;
        lastError = null;
        // 音量の読み取りと通知のゲージを動かし始める
        // （フォアグラウンドサービスなので画面オフでも止まらない）
        level = 0f;
        lastAmp = -1;
        lastSampleAt = SystemClock.elapsedRealtime();
        java.util.Arrays.fill(barV, 0f);
        notifCountdown = NOTIF_EVERY_AWAKE;
        startGaugeLoop();
    }

    private void stopRecording() {
        if (!recording) return;
        recording = false;
        stopGaugeLoop();
        level = 0f;
        activeRecorder = null; // 解放後の getMaxAmplitude を防ぐ

        AudioRecorderEngine eng = engine;
        engine = null;
        if (eng != null) {
            eng.stop(); // 書き切るまで待つ
            if (eng.getError() != null) lastError = eng.getError();
        } else {
            try {
                recorder.stop();
            } catch (Exception e) {
                // 極端に短い録音などで stop が例外になる。ファイルは残るのでそのまま進める。
                Log.w(TAG, "stop に失敗しました", e);
                lastError = "録音の終了処理に失敗しました: " + e.getMessage();
            }
            releaseRecorder();
        }
        startedAtElapsed = 0L;
    }

    private void releaseRecorder() {
        if (recorder != null) {
            try { recorder.release(); } catch (Exception ignored) {}
            recorder = null;
        }
    }

    @Override
    public void onDestroy() {
        stopRecording();
        if (gaugeThread != null) {
            try { gaugeThread.quitSafely(); } catch (Exception ignored) {}
            gaugeThread = null;
            gaugeHandler = null;
        }
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
