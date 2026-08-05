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
import android.graphics.Paint;
import android.graphics.RectF;
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
    public static final String ACTION_PAUSE = "jp.tcta.noteloop.PAUSE";
    public static final String ACTION_RESUME = "jp.tcta.noteloop.RESUME";
    public static final String EXTRA_OUTPUT_PATH = "outputPath";

    private static final String TAG = "NoteLoopRec";
    // ロック画面に内容を出す設定（VISIBILITY_PUBLIC）を効かせるため、
    // チャンネルを作り直している。既存チャンネルの設定は後から変更できない。
    public static final String CHANNEL_ID = "noteloop_recording_v2";
    private static final String CHANNEL_ID_OLD = "noteloop_recording";
    private static final int NOTIF_ID = 4711;

    /** 音量を読む間隔。短いほど声への反応が早い。 */
    private static final long LEVEL_TICK_MS = 50L;
    /** 通知のゲージを描き替える間隔（音量の読み取り何回ぶんか）。 */
    private static final int NOTIF_EVERY_AWAKE = 4;   // 画面が点いている: 0.2秒ごと（通知の更新レート上限）
    private static final int NOTIF_EVERY_ASLEEP = 20; // 画面が消えている: 1秒ごと（誰も見ていないので粗く）
    private static final int NOTIF_EVERY_PAUSED = 40; // 一時停止中: 2秒ごと（何も動かないので更に粗く）

    /** 通知に描くゲージ画像の大きさ（px）。通知の左側に置き、表示側で引き伸ばす。
     *  通知の更新ごとに画像を送るため、大きくしすぎない。 */
    private static final int GAUGE_W = 200;
    private static final int GAUGE_H = 80;
    /** ゲージのバーの本数（位置は固定で、音量に応じて上下に伸びる） */
    private static final int BARS = 5;
    /* 50ms ごとに動かす幅。大きいほど機敏に、まっすぐ伸び縮みして見える。 */
    private static final float RISE_PER_TICK = 0.34f;
    private static final float FALL_PER_TICK = 0.20f;
    /** これ以下の音は「無音」として扱う（振幅の全体に対する割合＝約 650/32767） */
    private static final float LEVEL_GATE = 0.02f;
    /** ここで振り切れる（＝約 11500/32767。会議の声で上まで届く高さ） */
    private static final float LEVEL_FULL = 0.26f;
    /** バーの色（アプリのブランド色。明るい通知でも暗い通知でも見える中間の明度） */
    /* 通知カードのゲージは白。通知の文字色と同じ白でそろえ、地の色に負けないようにする。 */
    private static final int GAUGE_COLOR = 0xFFFFFFFF;

    /** 録音状態。プラグインから参照するのでプロセス内で共有する。 */
    private static volatile boolean recording = false;
    private static volatile String currentPath = null;
    private static volatile long startedAtElapsed = 0L;
    private static volatile String lastError = null;
    /** 一時停止中か。止めている間は音声も経過時間も進まない。 */
    private static volatile boolean paused = false;
    private static volatile long pausedAtElapsed = 0L;   // 一時停止を始めた時刻
    private static volatile long pausedTotalMs = 0L;     // 止めていた合計時間

    private MediaRecorder recorder;

    /** 通知を開いたときの遷移先（アプリを前面に出す） */
    private PendingIntent contentPi;
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

    /* ステータスバーのアイコンは動かさず、マイクの形のまま出す（ic_stat_mic）。
     * 以前はイコライザーのコマを送って動かしていたが、何のアプリの表示か
     * ひと目で分からないため、静止したマイクにそろえた。 */

    /** 通知のビュー（作り直しは間引く） */
    private RemoteViews contentView;
    private RemoteViews bigView;
    private long viewsAt = 0L;
    /** 通知のボタン（一時停止 / 再開 / 録音完了）の送り先 */
    private PendingIntent stopPi, pausePi, resumePi;

    /** 各バーの現在の高さ（0..1）。位置は固定なので、ここだけが動く。 */
    private final float[] barV = new float[BARS];
    /* 1本ごとの個性。アプリ画面のゲージ（app.js の newGaugeBar）と同じ式で決める。 */
    private final float[] barGain = new float[BARS];
    private final float[] barSpeed = new float[BARS];
    private final float[] barPhase = new float[BARS];
    private final float[] barStep = new float[BARS];
    private boolean barsReady = false;
    private Paint gaugePaint;

    private final Runnable gaugeTick = new Runnable() {
        @Override
        public void run() {
            if (!recording) return;
            if (!paused) sampleLevel();
            stepBars();   // 高さは 50ms ごとに進める（通知の描き替えより細かく動かす）
            if (--notifCountdown <= 0) {
                notifCountdown = paused ? NOTIF_EVERY_PAUSED
                        : (isScreenOn() ? NOTIF_EVERY_AWAKE : NOTIF_EVERY_ASLEEP);
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
    public static boolean isPaused() { return paused; }

    /**
     * 録音中の音量（0.0〜1.0）。画面上のゲージ表示に使う。
     *
     * 通常はサービス側の定期読み取り（sampleLevel）の結果を返すが、
     * 何らかの理由でその読み取りが止まっている端末でもゲージが動くよう、
     * 値が古いときはこの場で読み直す（保険）。
     */
    public static float getLevel() {
        if (!recording || paused) return 0f;   // 一時停止中はゲージを止める
        if (SystemClock.elapsedRealtime() - lastSampleAt > 500L) sampleLevelNow();
        return level;
    }

    /** 診断用: 直近に読めた生の振幅（0..32767）。-1 は一度も読めていない。 */
    public static int getLastAmp() { return lastAmp; }

    /* ===== ライブ文字起こし用の PCM 取り出し =====
       録音しているのと同じ読み取りを横取りして渡すだけなので、マイクを
       二重に開かずに済む（＝録音中でも文字起こしができる）。 */

    /** PCM を取り出せる録音エンジンか（自前エンジンのときだけ取れる） */
    public static boolean canTapPcm() { return engine != null; }

    /** PCM の取り出しを開始／終了する */
    public static void setPcmTap(boolean on) {
        AudioRecorderEngine eng = engine;
        if (eng != null) eng.setPcmTap(on);
    }

    /** 溜まった PCM（16kHz / 16bit / モノラル）。無ければ null。 */
    public static byte[] takePcm() {
        AudioRecorderEngine eng = engine;
        return eng != null ? eng.takePcm() : null;
    }

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

    /** 録音開始からの経過ミリ秒（端末のスリープ中も進む時計を使う。一時停止した分は含まない） */
    public static long getElapsedMs() {
        if (!recording || startedAtElapsed <= 0) return 0L;
        long base = (paused && pausedAtElapsed > 0) ? pausedAtElapsed : SystemClock.elapsedRealtime();
        return Math.max(0L, base - startedAtElapsed - pausedTotalMs);
    }

    /** 経過時間を "01:23"（1時間を超えたら "1:01:23"）の形にする */
    private static String formatElapsed() {
        long sec = getElapsedMs() / 1000L;
        long h = sec / 3600, m = (sec % 3600) / 60, s = sec % 60;
        return h > 0 ? String.format(java.util.Locale.US, "%d:%02d:%02d", h, m, s)
                     : String.format(java.util.Locale.US, "%02d:%02d", m, s);
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
        // 通知のボタン／アプリ画面からの一時停止・再開。サービスは止めない。
        if (ACTION_PAUSE.equals(action) || ACTION_RESUME.equals(action)) {
            setPaused(ACTION_PAUSE.equals(action));
            return START_STICKY;
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
        contentPi = PendingIntent.getActivity(this, 0, open, piFlags);
        stopPi = PendingIntent.getService(this, 1,
                new Intent(this, RecordingService.class).setAction(ACTION_STOP), piFlags);
        pausePi = PendingIntent.getService(this, 2,
                new Intent(this, RecordingService.class).setAction(ACTION_PAUSE), piFlags);
        resumePi = PendingIntent.getService(this, 3,
                new Intent(this, RecordingService.class).setAction(ACTION_RESUME), piFlags);

        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    /**
     * 録音中の通知を組み立てる。
     *
     * 中身は録音アプリでよくある並びにそろえてある（自前のレイアウト）。
     *   左＝音量のゲージ（バー5本） / 中央＝録音時間 / 右＝一時停止・録音完了
     * DecoratedCustomViewStyle なので、アプリ名と小アイコンの行は OS が描く。
     * 端末によってはカスタムビューが描かれないことがあるため、同じ操作を
     * 標準のアクションボタンとしても付けておく（広げたときに出る）。
     */
    private Notification buildNotification() {
        applyGaugeViews();
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle((paused ? "❚❚ 一時停止中　" : "● 録音中　") + formatElapsed())
                .setContentText(paused
                        ? "再開すると続きから録音します"
                        : "画面を消しても録音は続いています")
                .setSmallIcon(R.drawable.ic_stat_mic)   // 動かないマイクのアイコン
                .setContentIntent(contentPi)
                .addAction(0, getString(paused ? R.string.notif_rec_resume : R.string.notif_rec_pause),
                        paused ? resumePi : pausePi)
                .addAction(0, getString(R.string.notif_rec_stop), stopPi)
                .setOngoing(true)
                .setSilent(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                // ロック画面でも内容（経過時間・ゲージ）が見えるようにする
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setStyle(new NotificationCompat.DecoratedCustomViewStyle());
        if (contentView != null) b.setCustomContentView(contentView);
        if (bigView != null) b.setCustomBigContentView(bigView);
        return b.build();
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
        // 上がるのは即座に、下がるのは少しだけ滑らかに（カクつきを抑える程度）
        level = target > level ? target : level * 0.55f + target * 0.45f;
    }

    /**
     * 振幅（0..32767）を、ゲージの高さに使う 0..1 へ変換する。
     *
     * 声の大きさにそのまま比例させる（リニア）。ただし
     *   ・下限（ノイズゲート）より小さい音は 0 ＝ 点のまま動かさない
     *   ・会議の声で振り切れるよう、全体の 35% 程度を上限として扱う
     * とし、生の振幅をそのまま割るより「素直に効く」ようにしている。
     */
    private static float toLevel(int amp) {
        float norm = amp / 32767f;
        if (norm <= LEVEL_GATE) return 0f;
        float v = (norm - LEVEL_GATE) / (LEVEL_FULL - LEVEL_GATE);
        if (v < 0.02f) return 0f;
        return Math.min(1f, v);
    }

    /** 決まった見た目を再現するための擬似乱数（アプリ画面のゲージと同じ作り） */
    private static float gaugeNoise(double seed) {
        double x = Math.sin(seed * 12.9898) * 43758.5453;
        return (float) (x - Math.floor(x)); // 0..1
    }

    /**
     * i 本目のバーの、いまの乱数値（0..1）。
     * tn の整数が変わるたびに別の乱数へ移り、その間はなめらかに繋ぐ。
     * 一定周期の sin と違って伸びる長さが毎回変わるので、パタパタと動いて見える。
     * （アプリ画面のゲージ = app.js の barRandom と同じ式）
     */
    private static float barRandom(int i, double tn) {
        double k = Math.floor(tn);
        float f = (float) (tn - k);
        float sm = f * f * (3f - 2f * f);
        return gaugeNoise(i * 17.3 + k * 1.7) * (1f - sm)
                + gaugeNoise(i * 17.3 + (k + 1) * 1.7) * sm;
    }

    /** 1本ごとの個性を決める（毎回同じ値なので、描き直しても暴れない） */
    private void ensureBars() {
        if (barsReady) return;
        for (int i = 0; i < BARS; i++) {
            barGain[i] = 0.85f + gaugeNoise(i * 3.9) * 0.55f;   // 伸びやすさ（どの本もよく伸びる）
            barSpeed[i] = 1.6f + gaugeNoise(i * 1.3) * 5.2f;    // 揺れの速さ
            barPhase[i] = gaugeNoise(i * 2.7) * (float) Math.PI * 2f;
            barStep[i] = 0.07f + gaugeNoise(i * 4.4) * 0.07f;   // 乱数の切り替わる間隔（秒）
        }
        barsReady = true;
    }

    /**
     * バーの高さを一段進める。
     * 声の大きさをそのまま高さにし、本ごとの違いは軽い揺らぎだけにする。
     * 高さは毎回おなじ幅ずつ動かす（直線的）ので、伸び縮みがはっきり見える。
     */
    private void stepBars() {
        ensureBars();
        final double now = SystemClock.elapsedRealtime() / 1000.0;
        final float lv = paused ? 0f : level;
        for (int i = 0; i < BARS; i++) {
            float t = BARS > 1 ? (float) i / (BARS - 1) : 0.5f;
            // 中央ほど大きく振れる（両端も十分に動かす）
            float env = (float) (0.72 + 0.28 * Math.sin(Math.PI * t));
            float rnd = barRandom(i, now / barStep[i]);
            float s1 = (float) Math.sin(now * barSpeed[i] + barPhase[i]);
            // 本ごとの揺らぎ。ここを広く取るぶん、1本1本がはっきり伸び縮みする
            float wobble = 0.55f + 0.45f * (0.7f * rnd + 0.3f * (0.5f + 0.5f * s1));
            float target = Math.min(1f, lv * barGain[i] * env * wobble);
            // イージングを使わず、1目盛りずつ一定の速さで目標へ寄せる（＝リニアな動き）
            float d = target - barV[i];
            float step = d > 0 ? RISE_PER_TICK : FALL_PER_TICK;
            barV[i] += Math.max(-step, Math.min(step, d));
        }
    }

    /** 画面が点いているか（消えている間は通知の描き替えを粗くして電池を節約する） */
    private boolean isScreenOn() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            return pm == null || pm.isInteractive();
        } catch (Exception e) { return true; }
    }

    /**
     * 通知に載せるゲージ（5点）を描く。
     * 位置も太さも揃った5つの点が、いまの音量に応じてその場で上下に伸びる。
     * 静かなときは丸い点に戻る。高さの計算は stepBars() で、アプリ画面の
     * ゲージとまったく同じ動きにそろえてある。
     */
    private Bitmap renderGauge() {
        Bitmap bmp = Bitmap.createBitmap(GAUGE_W, GAUGE_H, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        if (gaugePaint == null) {
            gaugePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            gaugePaint.setColor(GAUGE_COLOR);
        }
        ensureBars();
        final float pitch = (float) GAUGE_W / (BARS + 1);  // 左右に余白を残して等間隔に並べる
        final float barW = pitch * 0.34f;                  // 太さは5点とも同じ
        final float maxH = GAUGE_H * 0.97f;                // いちばん大きい声のときの高さ
        final float minH = barW;                           // 無音は「点」になる
        final float mid = GAUGE_H / 2f;
        final float left = (GAUGE_W - (BARS - 1) * pitch) / 2f;

        for (int i = 0; i < BARS; i++) {
            float bh = Math.max(barW, minH + (maxH - minH) * barV[i]);
            float x = left + i * pitch - barW / 2f;
            RectF r = new RectF(x, mid - bh / 2f, x + barW, mid + bh / 2f);
            c.drawRoundRect(r, barW / 2f, barW / 2f, gaugePaint);
        }
        return bmp;
    }

    /** 通知のゲージ・経過時間を現在の状態に合わせて描き替える（ロック画面でも動いて見える）。 */
    private void updateGauge() {
        if (!recording || stopPi == null) return;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, buildNotification());
        } catch (Exception e) {
            // 通知が出せない（権限を切られた等）だけなら録音は続ける
            Log.w(TAG, "通知を更新できませんでした", e);
        }
    }

    /**
     * 通知の中身（ゲージ・経過時間・操作ボタン）を作る。
     * RemoteViews は setXxx のたびに命令が積まれるため、毎回作り直す。
     * 端末によってはカスタムビューが描かれないことがあるが、その場合でも
     * OS が描くタイトル行と標準のアクションボタンは出るので、操作はできる。
     */
    private void applyGaugeViews() {
        try {
            long now = SystemClock.elapsedRealtime();
            // 作り直しは 0.2 秒に1回まで（画像を毎回送ると通信量が無駄に増える）
            if (contentView == null || now - viewsAt >= 200L) {
                Bitmap gauge = renderGauge();
                contentView = buildNotifView(R.layout.notif_recording, gauge, false);
                bigView = buildNotifView(R.layout.notif_recording_big, gauge, true);
                viewsAt = now;
            }
        } catch (Exception e) {
            Log.w(TAG, "ゲージ付きの通知ビューを作れませんでした", e);
        }
    }

    /** 通知1枚ぶんのビューを組み立てる（たたんだ状態・広げた状態で同じ並び） */
    private RemoteViews buildNotifView(int layoutId, Bitmap gauge, boolean big) {
        RemoteViews rv = new RemoteViews(getPackageName(), layoutId);
        rv.setImageViewBitmap(R.id.notif_gauge, gauge);
        rv.setTextViewText(R.id.notif_time, formatElapsed());
        if (big) {
            rv.setTextViewText(R.id.notif_text, paused
                    ? "一時停止中 — 再開すると続きから録音します"
                    : "録音中 — 画面を消しても録音は続いています");
        }
        rv.setImageViewResource(R.id.notif_pause,
                paused ? R.drawable.ic_notif_resume : R.drawable.ic_notif_pause);
        rv.setContentDescription(R.id.notif_pause,
                getString(paused ? R.string.notif_rec_resume : R.string.notif_rec_pause));
        rv.setOnClickPendingIntent(R.id.notif_pause, paused ? resumePi : pausePi);
        rv.setOnClickPendingIntent(R.id.notif_stop, stopPi);
        return rv;
    }

    /**
     * 録音の一時停止／再開。
     * 音声の書き出しと経過時間を同時に止め、通知の表示も切り替える。
     */
    private void setPaused(boolean p) {
        if (!recording || paused == p) return;
        paused = p;
        if (p) {
            pausedAtElapsed = SystemClock.elapsedRealtime();
            AudioRecorderEngine eng = engine;
            if (eng != null) {
                eng.setPaused(true);
            } else if (recorder != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try { recorder.pause(); } catch (Exception e) { Log.w(TAG, "一時停止できませんでした", e); }
            }
            level = 0f;
            java.util.Arrays.fill(barV, 0f);
        } else {
            if (pausedAtElapsed > 0) pausedTotalMs += SystemClock.elapsedRealtime() - pausedAtElapsed;
            pausedAtElapsed = 0L;
            AudioRecorderEngine eng = engine;
            if (eng != null) {
                eng.setPaused(false);
            } else if (recorder != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try { recorder.resume(); } catch (Exception e) { Log.w(TAG, "再開できませんでした", e); }
            }
            lastSampleAt = SystemClock.elapsedRealtime();
        }
        contentView = null;   // ボタンの向きが変わるので作り直す
        bigView = null;
        notifCountdown = 1;
        // ゲージ画像を描くのは専用スレッドの担当。切り替えた瞬間の描き替えもそちらへ回す。
        if (gaugeHandler != null) gaugeHandler.post(this::updateGauge);
        else updateGauge();
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
        paused = false;
        pausedAtElapsed = 0L;
        pausedTotalMs = 0L;
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
        paused = false;
        pausedAtElapsed = 0L;
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

    /** 外部（プラグイン）から一時停止・再開するための入口 */
    public static void setPaused(Context ctx, boolean p) {
        ctx.startService(new Intent(ctx, RecordingService.class)
                .setAction(p ? ACTION_PAUSE : ACTION_RESUME));
    }
}
