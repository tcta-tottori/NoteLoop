package jp.tcta.noteloop;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;

/**
 * Web 側（app.js）から呼ぶネイティブ録音の入口。
 *
 * 録音そのものは RecordingService（フォアグラウンドサービス）が行う。
 * ここは開始・停止・状態取得と、録音ファイルの場所を Web へ渡す役目だけ持つ。
 */
@CapacitorPlugin(
        name = "Recorder",
        permissions = {
                @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
                @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" })
        }
)
public class RecorderPlugin extends Plugin {

    private String pendingPath = null;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", true);
        call.resolve(r);
    }

    @PluginMethod
    public void start(PluginCall call) {
        boolean needMic = getPermissionState("microphone") != com.getcapacitor.PermissionState.GRANTED;
        // 通知（Android 13+）も要る。許可が無いと録音中の通知が通知領域にもロック画面にも
        // 出ない（録音自体は続く）。以前はマイクが未許可のときしか要求していなかったため、
        // 「マイクだけ許可・通知は拒否」の状態になると二度と聞かれないままだった。
        boolean needNotif = Build.VERSION.SDK_INT >= 33
                && getPermissionState("notifications") != com.getcapacitor.PermissionState.GRANTED;
        if (needMic || needNotif) {
            requestPermissionForAliases(new String[]{ "microphone", "notifications" }, call, "permsCallback");
            return;
        }
        doStart(call);
    }

    @PermissionCallback
    private void permsCallback(PluginCall call) {
        if (getPermissionState("microphone") != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("マイクの使用が許可されていません");
            return;
        }
        // 通知が拒否されていても録音は続けられる（Web 側が案内を出す）
        doStart(call);
    }

    /** 通知を出せる状態か（録音中の表示が出ないときの案内に使う） */
    @PluginMethod
    public void getNotificationState(PluginCall call) {
        JSObject r = new JSObject();
        Context ctx = getContext();
        boolean enabled = true, channelEnabled = true;
        try {
            enabled = NotificationManagerCompat.from(ctx).areNotificationsEnabled();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                NotificationChannel ch = nm != null ? nm.getNotificationChannel(RecordingService.CHANNEL_ID) : null;
                // チャンネルは初回の録音で作られる。まだ無い場合は「有効」とみなす。
                channelEnabled = ch == null || ch.getImportance() != NotificationManager.IMPORTANCE_NONE;
            }
        } catch (Exception ignored) {}
        r.put("enabled", enabled);
        r.put("channelEnabled", channelEnabled);
        call.resolve(r);
    }

    /** このアプリの通知設定画面を開く */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent i;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
            } else {
                i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                        .setData(Uri.fromParts("package", ctx.getPackageName(), null));
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("設定画面を開けませんでした: " + e.getMessage());
        }
    }

    private void doStart(PluginCall call) {
        if (RecordingService.isRecording()) {
            call.reject("すでに録音中です");
            return;
        }
        Context ctx = getContext();
        File dir = new File(ctx.getFilesDir(), "recordings");
        if (!dir.exists()) dir.mkdirs();
        String path = new File(dir, "rec-" + System.currentTimeMillis() + ".m4a").getAbsolutePath();
        pendingPath = path;

        RecordingService.start(ctx, path);

        // サービスの開始は非同期。開始したかどうかを少しだけ待って確かめる。
        new Thread(() -> {
            for (int i = 0; i < 40 && !RecordingService.isRecording(); i++) {
                try { Thread.sleep(50); } catch (InterruptedException ignored) { break; }
            }
            final boolean started = RecordingService.isRecording();
            final String err = RecordingService.getLastError();
            // ブリッジへの応答は UI スレッドから行う必要がある
            runOnMain(() -> {
                if (started) {
                    JSObject r = new JSObject();
                    r.put("path", path);
                    call.resolve(r);
                } else {
                    call.reject(err != null ? err : "録音を開始できませんでした");
                }
            });
        }).start();
    }

    /** ブリッジへの応答（resolve / reject）を UI スレッドで実行する */
    private void runOnMain(Runnable r) {
        if (getActivity() != null) getActivity().runOnUiThread(r);
        else new android.os.Handler(android.os.Looper.getMainLooper()).post(r);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        final String path = RecordingService.getCurrentPath() != null
                ? RecordingService.getCurrentPath() : pendingPath;
        if (path == null) {
            call.reject("録音していません");
            return;
        }
        RecordingService.stop(getContext());

        new Thread(() -> {
            // 停止処理（ファイルの書き切り）を待つ
            for (int i = 0; i < 60 && RecordingService.isRecording(); i++) {
                try { Thread.sleep(50); } catch (InterruptedException ignored) { break; }
            }
            File f = new File(path);
            // MPEG-4 のヘッダ書き込みが終わってサイズが安定するまで少し待つ
            long prev = -1;
            for (int i = 0; i < 20; i++) {
                long len = f.length();
                if (len > 0 && len == prev) break;
                prev = len;
                try { Thread.sleep(100); } catch (InterruptedException ignored) { break; }
            }
            final boolean ok = f.exists() && f.length() > 0;
            final long size = f.length();
            runOnMain(() -> {
                if (!ok) {
                    call.reject("録音ファイルが作られませんでした");
                    return;
                }
                JSObject r = new JSObject();
                r.put("path", path);
                r.put("size", size);
                // WebView から読める URL に変換して返す（巨大な base64 を橋渡ししない）
                r.put("url", com.getcapacitor.FileUtils.getPortablePath(
                        getContext(), getBridge().getLocalUrl(), android.net.Uri.fromFile(f)));
                r.put("mimeType", "audio/mp4");
                call.resolve(r);
            });
        }).start();
    }

    /** 録音中の音量（0.0〜1.0）。画面上のゲージ表示に使う。 */
    @PluginMethod
    public void getLevel(PluginCall call) {
        JSObject r = new JSObject();
        r.put("level", RecordingService.getLevel());
        call.resolve(r);
    }

    /* ===== 音量の送信（片道） =====
     * Web 側から毎回問い合わせる（往復）方式だと、描画で WebView が混んでいるときに
     * 応答が溜まり、ゲージが固まったまま画面操作の瞬間だけ動く、という状態になる。
     * こちらから一定間隔で送りつける形にすると詰まりにくい。 */
    private static final long LEVEL_PUSH_MS = 70L;
    private Handler levelHandler;
    private final Runnable levelPush = new Runnable() {
        @Override
        public void run() {
            if (!RecordingService.isRecording()) return; // 録音が終われば自然に止まる
            JSObject ev = new JSObject();
            ev.put("level", RecordingService.getLevel());
            notifyListeners("level", ev);
            if (levelHandler != null) levelHandler.postDelayed(this, LEVEL_PUSH_MS);
        }
    };

    @PluginMethod
    public void startLevelUpdates(PluginCall call) {
        if (levelHandler == null) levelHandler = new Handler(Looper.getMainLooper());
        levelHandler.removeCallbacks(levelPush);
        levelHandler.post(levelPush);
        call.resolve();
    }

    @PluginMethod
    public void stopLevelUpdates(PluginCall call) {
        if (levelHandler != null) levelHandler.removeCallbacks(levelPush);
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("recording", RecordingService.isRecording());
        r.put("elapsedMs", RecordingService.getElapsedMs());
        // 診断用: 定期読み取りが生きているか（getLevel より先に読む）と、
        // いまの音量（0..1）、マイクから読めた生の振幅（0..32767 / -1 は未取得）
        r.put("sampleAgeMs", RecordingService.getSampleAgeMs());
        r.put("level", RecordingService.getLevel());
        r.put("amp", RecordingService.getLastAmp());
        r.put("engine", RecordingService.getEngineName());
        String path = RecordingService.getCurrentPath();
        r.put("size", path != null ? new File(path).length() : 0);
        call.resolve(r);
    }

    /** 使い終わった録音ファイルを消す（履歴には Web 側が保存する） */
    @PluginMethod
    public void discard(PluginCall call) {
        String path = call.getString("path");
        if (path != null) {
            File f = new File(path);
            if (f.exists()) f.delete();
        }
        call.resolve();
    }
}
