package jp.tcta.noteloop;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.CapabilityInfo;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;

import org.json.JSONObject;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * Pixel Watch（watch/ の Wear OS アプリ）との連携。
 *
 * 時計からの「録音開始 / 停止」を受けて RecordingService を動かし、
 * 録音の状態が変わるたびに時計へ JSON で知らせる（Wearable Data Layer の MessageClient）。
 * 時計が指示した録音や、時計から転送された音声は filesDir/watch-recordings に置き、
 * Web 側（app.js）が起動時と通知時に履歴へ取り込む。
 *
 * パスとケイパビリティ名は watch/shared の SyncPaths と一致させること。
 */
public final class WatchSync {
    private static final String TAG = "NoteLoopWatch";

    public static final String PATH_START = "/noteloop/record/start";
    public static final String PATH_STOP = "/noteloop/record/stop";
    public static final String PATH_QUERY = "/noteloop/record/query";
    public static final String PATH_STATUS = "/noteloop/record/status";
    public static final String PATH_TRANSFER_PREFIX = "/noteloop/transfer/";
    public static final String CAPABILITY_WATCH = "noteloop_watch";

    /** 時計が関わる録音の置き場。通常の録音（recordings/）と分け、復元処理の掃除に巻き込まれないようにする */
    public static final String DIR_NAME = "watch-recordings";

    private static final String CHANNEL_ID = "noteloop_watch_request";
    private static final int NOTIF_ID = 4720;
    public static final String ACTION_START_FROM_WATCH = "jp.tcta.noteloop.START_FROM_WATCH";
    public static final String EXTRA_MODE = "mode";

    /** いまの録音が時計の指示で始まったものか（通知や画面の文言に使う） */
    private static volatile boolean startedByWatch = false;
    private static volatile String watchMode = "";
    private static volatile String watchPath = null;
    private static volatile String lastError = null;

    private WatchSync() {}

    public static boolean isStartedByWatch() { return startedByWatch && RecordingService.isRecording(); }
    public static String getWatchMode() { return watchMode; }

    public static File dir(Context ctx) {
        File d = new File(ctx.getFilesDir(), DIR_NAME);
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /** Web 版と同じ `noteloop_yyyyMMdd_HHmmss_<source>.m4a` */
    public static String newFileName(String source) {
        String ts = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
        return "noteloop_" + ts + "_" + source + ".m4a";
    }

    /** ファイル名の安全化（転送パスから取り出した名前をそのまま使わない） */
    public static String safeName(String name) {
        if (name == null) return "";
        String n = name.substring(name.lastIndexOf('/') + 1).replaceAll("[^A-Za-z0-9._-]", "_");
        return n.endsWith(".m4a") ? n : n + ".m4a";
    }

    /* ===== 時計からの指示 ===== */

    /**
     * 時計の指示で録音を始める。バックグラウンド（WearableListenerService）から呼ばれる。
     * Android 12 以降はバックグラウンドからの前面サービス起動が拒否されることがあるので、
     * その場合は通知を出して本人にタップしてもらい、MainActivity（前面）から始め直す。
     */
    public static void startFromWatch(Context ctx, String mode) {
        Context app = ctx.getApplicationContext();
        if (RecordingService.isRecording()) {
            // 既に録音中（本体で始めていた等）。状態だけ返す
            sendStatus(app, null);
            return;
        }
        String path = new File(dir(app), newFileName("phone")).getAbsolutePath();
        startedByWatch = true;
        watchMode = mode != null ? mode : "";
        watchPath = path;
        lastError = null;
        try {
            RecordingService.start(app, path);
        } catch (Exception e) {
            Log.w(TAG, "時計からの録音開始に失敗（バックグラウンド起動の制限?）: " + e.getMessage());
            startedByWatch = false;
            watchPath = null;
            lastError = "スマホでアプリを開くか、通知をタップしてください";
            postStartRequestNotification(app, mode);
            sendStatus(app, lastError);
            return;
        }
        // サービスの開始は非同期。開始したかどうかを少しだけ待って結果を返す
        new Thread(() -> {
            for (int i = 0; i < 60 && !RecordingService.isRecording(); i++) {
                try { Thread.sleep(50); } catch (InterruptedException ignored) { break; }
            }
            if (!RecordingService.isRecording()) {
                String err = RecordingService.getLastError();
                lastError = err != null ? err : "録音を開始できませんでした";
                startedByWatch = false;
                watchPath = null;
                sendStatus(app, lastError);
                notifyWeb(app);
            }
            // 開始できた場合は RecordingService 側のフック（onRecordingStateChanged）が状態を送る
        }, "noteloop-watch-start").start();
    }

    public static void stopFromWatch(Context ctx) {
        if (!RecordingService.isRecording()) {
            sendStatus(ctx.getApplicationContext(), null);
            return;
        }
        RecordingService.stop(ctx.getApplicationContext());
        // 停止後の状態送信は RecordingService 側のフックが行う
    }

    /**
     * RecordingService から、録音の開始・停止のたびに呼ばれる。
     * 時計へ状態を送り、Web 側（開いていれば）にも知らせる。
     */
    public static void onRecordingStateChanged(Context ctx) {
        Context app = ctx.getApplicationContext();
        boolean rec = RecordingService.isRecording();
        if (!rec) {
            String p = watchPath;
            if (p != null) {
                // 書き切れた m4a があれば、途中終了に備えた保険ファイル（.rec.aac）はもう要らない
                File f = new File(p);
                File rc = new File(p + AudioRecorderEngine.RECOVERY_SUFFIX);
                if (f.exists() && f.length() > 0 && rc.exists()) rc.delete();
            }
            startedByWatch = false;
            watchPath = null;
        }
        sendStatus(app, null);
        notifyWeb(app);
    }

    private static void notifyWeb(Context app) {
        RecorderPlugin.emitWatchState(buildWebState(app));
    }

    /** Web 側へ渡す状態 */
    public static JSONObject buildWebState(Context ctx) {
        JSONObject o = new JSONObject();
        try {
            boolean rec = RecordingService.isRecording();
            o.put("recording", rec);
            o.put("byWatch", rec && startedByWatch);
            o.put("mode", rec ? watchMode : "");
            o.put("startedAt", rec ? System.currentTimeMillis() - RecordingService.getElapsedMs() : 0L);
            o.put("elapsedMs", rec ? RecordingService.getElapsedMs() : 0L);
            o.put("paused", rec && RecordingService.isPaused());
            o.put("error", lastError != null ? lastError : "");
        } catch (Exception ignored) {}
        return o;
    }

    /* ===== 時計への状態送信 ===== */

    /** 時計側の PhoneStatus（JSON）と同じ形 */
    private static byte[] statusPayload(String error) {
        JSONObject o = new JSONObject();
        try {
            boolean rec = RecordingService.isRecording();
            o.put("recording", rec);
            o.put("startedAt", rec ? System.currentTimeMillis() - RecordingService.getElapsedMs() : 0L);
            o.put("mode", rec ? (startedByWatch ? watchMode : "phone") : "");
            String p = watchPath;
            o.put("fileName", p != null ? new File(p).getName() : "");
            o.put("error", error != null ? error : "");
            o.put("sentAt", System.currentTimeMillis());
        } catch (Exception ignored) {}
        return o.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    /** 時計側アプリを持つすべてのノードへ状態を送る（時計が無ければ何もしない）。呼び出しはブロックしない */
    public static void sendStatus(Context ctx, String error) {
        Context app = ctx.getApplicationContext();
        byte[] payload = statusPayload(error);
        new Thread(() -> sendStatusBlocking(app, payload), "noteloop-watch-status").start();
    }

    /** 同上。呼び出し元のスレッドで送り切る（WearableListenerService の中から使う） */
    public static void sendStatusNow(Context ctx, String error) {
        sendStatusBlocking(ctx.getApplicationContext(), statusPayload(error));
    }

    private static void sendStatusBlocking(Context app, byte[] payload) {
        try {
            CapabilityInfo info = Tasks.await(
                    Wearable.getCapabilityClient(app).getCapability(CAPABILITY_WATCH, CapabilityClient.FILTER_REACHABLE),
                    5, TimeUnit.SECONDS);
            for (Node node : info.getNodes()) {
                try {
                    Tasks.await(Wearable.getMessageClient(app).sendMessage(node.getId(), PATH_STATUS, payload),
                            5, TimeUnit.SECONDS);
                } catch (Exception e) {
                    Log.w(TAG, "時計への状態送信に失敗（" + node.getDisplayName() + "）: " + e.getMessage());
                }
            }
        } catch (Exception e) {
            // 時計未接続・Play 開発者サービス無しなど。無視してよい
            Log.d(TAG, "時計を探せません: " + e.getMessage());
        }
    }

    /* ===== バックグラウンド起動が拒否されたときの通知 ===== */

    private static void postStartRequestNotification(Context ctx, String mode) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(new NotificationChannel(
                    CHANNEL_ID, "ウォッチからの録音要求", NotificationManager.IMPORTANCE_HIGH));
        }
        Intent open = new Intent(ctx, MainActivity.class)
                .setAction(ACTION_START_FROM_WATCH)
                .putExtra(EXTRA_MODE, mode)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getActivity(ctx, 40, open, flags);
        String text = "バックグラウンドから録音を始められませんでした。タップして録音を始めてください。";
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_mic)
                .setContentTitle("ウォッチから録音開始の要求")
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_CALL);
        try { nm.notify(NOTIF_ID, b.build()); } catch (Exception ignored) {}
    }

    /** 通知をタップして MainActivity（前面）に来たとき。ここからなら前面サービスを確実に起動できる */
    public static boolean handleActivityIntent(Context ctx, Intent intent) {
        if (intent == null || !ACTION_START_FROM_WATCH.equals(intent.getAction())) return false;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIF_ID);
        startFromWatch(ctx, intent.getStringExtra(EXTRA_MODE));
        return true;
    }
}
