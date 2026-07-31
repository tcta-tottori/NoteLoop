package jp.tcta.noteloop;

import android.Manifest;
import android.content.Context;
import android.os.Build;

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
        if (getPermissionState("microphone") != com.getcapacitor.PermissionState.GRANTED) {
            // 通知権限（Android 13+）も一緒に求める。通知が出せないと
            // フォアグラウンドサービスがユーザーから見えず、体験が悪くなる。
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
        doStart(call);
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

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("recording", RecordingService.isRecording());
        r.put("elapsedMs", RecordingService.getElapsedMs());
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
