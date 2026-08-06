package jp.tcta.noteloop;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * 録音を止めたあとの「AIの文字起こし → 議事録づくり」を、
 * 画面を消しても最後まで走らせるためのフォアグラウンドサービス。
 *
 * 録音そのものは RecordingService が守っているが、停止した時点で
 * そのサービスは終わる。その直後に画面を消すと、アプリは背面の
 * 通常プロセスになり、WebView（＝生成処理）が OS に凍結されて
 * 「文字起こしは速報のまま・議事録は空」で止まってしまう。
 *
 * ここでは
 *   ・フォアグラウンドサービス（dataSync）でプロセスの優先度を保つ
 *   ・PARTIAL_WAKE_LOCK で CPU を止めさせない
 * の2つで、画面オフ中も生成を続けられるようにする。
 * 生成が終わったら（アプリが背面のままでも気づけるように）完了通知を出す。
 */
public class ProcessingService extends Service {

    public static final String ACTION_START = "jp.tcta.noteloop.PROC_START";
    public static final String ACTION_UPDATE = "jp.tcta.noteloop.PROC_UPDATE";
    public static final String ACTION_STOP = "jp.tcta.noteloop.PROC_STOP";
    public static final String EXTRA_TEXT = "text";
    public static final String EXTRA_DONE_TITLE = "doneTitle";
    public static final String EXTRA_DONE_TEXT = "doneText";

    private static final String TAG = "NoteLoopProc";
    /** 作成中の常駐通知（音を出さない） */
    public static final String CHANNEL_ID = "noteloop_processing";
    /** 完了のお知らせ（画面を消していても気づけるよう、通常の重要度） */
    public static final String CHANNEL_DONE_ID = "noteloop_done";
    private static final int NOTIF_ID = 4712;
    private static final int DONE_NOTIF_ID = 4713;

    /** 保険の上限。生成が異常に長引いても、ここで必ず CPU ロックを手放す。 */
    private static final long WAKE_LOCK_TIMEOUT_MS = 60L * 60L * 1000L;

    private static volatile boolean running = false;

    private PowerManager.WakeLock wakeLock;
    private String statusText = "AIが議事録を作成中…";

    public static boolean isRunning() { return running; }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_STOP.equals(action)) {
            String doneTitle = intent.getStringExtra(EXTRA_DONE_TITLE);
            String doneText = intent.getStringExtra(EXTRA_DONE_TEXT);
            releaseWakeLock();
            running = false;
            stopForegroundCompat();
            if (doneTitle != null && !doneTitle.isEmpty()) showDoneNotification(doneTitle, doneText);
            stopSelf();
            return START_NOT_STICKY;
        }

        String text = intent != null ? intent.getStringExtra(EXTRA_TEXT) : null;
        if (text != null && !text.isEmpty()) statusText = text;

        if (ACTION_UPDATE.equals(action)) {
            if (running) notifyStatus();
            return START_STICKY;
        }

        // ACTION_START（未指定もこちら）
        createChannels();
        startForegroundWithNotification();
        acquireWakeLock();
        running = true;
        return START_STICKY;
    }

    private void startForegroundWithNotification() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIF_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIF_ID, buildNotification());
            }
        } catch (Exception e) {
            // フォアグラウンド化できなくても、生成そのものは（画面が点いていれば）続く
            Log.w(TAG, "作成中の通知を出せませんでした", e);
        }
    }

    private void notifyStatus() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, buildNotification());
        } catch (Exception e) {
            Log.w(TAG, "作成中の通知を更新できませんでした", e);
        }
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent contentPi = PendingIntent.getActivity(this, 0, open, piFlags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(statusText)
                .setContentText("画面を消しても作成は続きます")
                .setSmallIcon(R.drawable.ic_stat_doc)
                .setContentIntent(contentPi)
                .setOngoing(true)
                .setSilent(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setProgress(0, 0, true)   // 終わりの見えない処理なので不定形のバー
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .build();
    }

    /** 生成が終わったことを知らせる（画面を消したまま待っていても分かるように） */
    private void showDoneNotification(String title, String text) {
        try {
            Intent open = new Intent(this, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT
                    | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
            Notification n = new NotificationCompat.Builder(this, CHANNEL_DONE_ID)
                    .setContentTitle(title)
                    .setContentText(text != null ? text : "")
                    .setSmallIcon(R.drawable.ic_stat_doc)
                    .setContentIntent(PendingIntent.getActivity(this, 4, open, piFlags))
                    .setAutoCancel(true)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .setCategory(NotificationCompat.CATEGORY_STATUS)
                    .build();
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(DONE_NOTIF_ID, n);
        } catch (Exception e) {
            Log.w(TAG, "完了の通知を出せませんでした", e);
        }
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "議事録の作成", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("録音のあと、AIが文字起こし・議事録を作っている間に表示されます");
            ch.setShowBadge(false);
            ch.setSound(null, null);
            ch.enableVibration(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CHANNEL_DONE_ID) == null) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_DONE_ID, "作成の完了", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("議事録ができたときにお知らせします");
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
    }

    /** 画面オフ中も CPU を止めさせない（生成が途中で凍らないようにするため） */
    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "noteloop:processing");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS);
        } catch (Exception e) {
            Log.w(TAG, "ウェイクロックを取得できませんでした", e);
        }
    }

    private void releaseWakeLock() {
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) {}
        wakeLock = null;
    }

    private void stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(Service.STOP_FOREGROUND_REMOVE);
            else stopForeground(true);
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        running = false;
        releaseWakeLock();
        super.onDestroy();
    }

    /* ===== 外部（プラグイン）から使う入口 ===== */

    public static void start(Context ctx, String text) {
        Intent i = new Intent(ctx, ProcessingService.class)
                .setAction(ACTION_START)
                .putExtra(EXTRA_TEXT, text);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    public static void update(Context ctx, String text) {
        if (!running) return;
        try {
            ctx.startService(new Intent(ctx, ProcessingService.class)
                    .setAction(ACTION_UPDATE)
                    .putExtra(EXTRA_TEXT, text));
        } catch (Exception ignored) { /* 背面からの起動が拒否されても表示が古くなるだけ */ }
    }

    /** 生成の終了。doneTitle を渡すと完了通知を出す。 */
    public static void stop(Context ctx, String doneTitle, String doneText) {
        try {
            ctx.startService(new Intent(ctx, ProcessingService.class)
                    .setAction(ACTION_STOP)
                    .putExtra(EXTRA_DONE_TITLE, doneTitle)
                    .putExtra(EXTRA_DONE_TEXT, doneText));
        } catch (Exception ignored) {}
    }
}
