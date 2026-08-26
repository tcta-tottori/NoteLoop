package jp.tcta.noteloop;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.HashMap;

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
        stopMonitorInternal();   // 待機中の音量監視がマイクを掴んだままだと録音を開始できない
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
                // 正常に書き切れたので、途中終了に備えた保険ファイルはもう要らない
                deleteQuietly(new File(path + AudioRecorderEngine.RECOVERY_SUFFIX));
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

    /* ===== 中断した録音の拾い直し =====
     * 画面オフの長時間録音では、OS がアプリを終了させることがある。
     * その場合 stop() が呼ばれないため m4a は再生できないが、
     * 録音エンジンが書いていた保険ファイル（ADTS の .aac）はそのまま使える。
     * ここでは録音フォルダに取り残されたファイルを探して Web 側へ渡す。 */

    @PluginMethod
    public void recoverLast(PluginCall call) {
        Context ctx = getContext();
        File dir = new File(ctx.getFilesDir(), "recordings");
        String current = RecordingService.isRecording() ? RecordingService.getCurrentPath() : null;
        File[] files = dir.listFiles();
        JSObject r = new JSObject();
        if (files == null || files.length == 0) { r.put("found", false); call.resolve(r); return; }

        // 正常に停止できた録音では保険ファイルが消えている＝残っていれば「中断された録音」。
        // m4a は過去の録音の分も残っているので、Web 側が中断と分かっている
        // パス（call の "path"）が指すものだけを候補にする。
        final String want = call.getString("path", "");
        File best = null;
        boolean bestIsRecovery = false;
        for (File f : files) {
            if (f == null || !f.isFile() || f.length() <= 0) continue;
            String abs = f.getAbsolutePath();
            // 録音中のファイル（とその保険）は触らない
            if (current != null && (current.equals(abs)
                    || (current + AudioRecorderEngine.RECOVERY_SUFFIX).equals(abs))) continue;

            if (abs.endsWith(AudioRecorderEngine.RECOVERY_SUFFIX)) {
                // 中断が分かっているパスの保険を最優先、それ以外は新しいものを選ぶ
                boolean wanted = want != null && !want.isEmpty()
                        && abs.equals(want + AudioRecorderEngine.RECOVERY_SUFFIX);
                if (best == null || !bestIsRecovery || wanted
                        || f.lastModified() > best.lastModified()) {
                    best = f;
                    bestIsRecovery = true;
                    if (wanted) break;
                }
            } else if (!bestIsRecovery && want != null && !want.isEmpty() && abs.equals(want)) {
                // 保険が無い機種（MediaRecorder で録った場合）は、そのファイル自体を渡す。
                // 途中終了だと再生できないことがあるので、Web 側で確かめてから使う。
                best = f;
            }
        }
        if (best == null) { r.put("found", false); call.resolve(r); return; }

        r.put("found", true);
        r.put("path", best.getAbsolutePath());
        r.put("size", best.length());
        r.put("modifiedAt", best.lastModified());
        r.put("kind", bestIsRecovery ? "recovery" : "file");
        r.put("mimeType", bestIsRecovery ? "audio/aac" : "audio/mp4");
        r.put("url", com.getcapacitor.FileUtils.getPortablePath(
                getContext(), getBridge().getLocalUrl(), android.net.Uri.fromFile(best)));
        call.resolve(r);
    }

    /** 拾い直しが済んだ（または不要と分かった）ファイルを片付ける */
    @PluginMethod
    public void discardRecovered(PluginCall call) {
        Context ctx = getContext();
        File dir = new File(ctx.getFilesDir(), "recordings");
        String current = RecordingService.isRecording() ? RecordingService.getCurrentPath() : null;
        File[] files = dir.listFiles();
        int removed = 0;
        if (files != null) {
            for (File f : files) {
                if (f == null || !f.isFile()) continue;
                if (current != null && (current.equals(f.getAbsolutePath())
                        || (current + AudioRecorderEngine.RECOVERY_SUFFIX).equals(f.getAbsolutePath()))) continue;
                if (deleteQuietly(f)) removed++;
            }
        }
        JSObject r = new JSObject();
        r.put("removed", removed);
        call.resolve(r);
    }

    private static boolean deleteQuietly(File f) {
        try { return f != null && f.exists() && f.delete(); } catch (Exception e) { return false; }
    }

    /* ===== 一時停止 / 再開 =====
     * 音声の書き出しと経過時間を同時に止める。マイクは掴んだままなので、
     * 再開時に他のアプリへ持っていかれる心配がない。 */

    @PluginMethod
    public void pause(PluginCall call) { applyPaused(call, true); }

    @PluginMethod
    public void resume(PluginCall call) { applyPaused(call, false); }

    private void applyPaused(PluginCall call, boolean wantPause) {
        if (!RecordingService.isRecording()) {
            call.reject("録音していません");
            return;
        }
        RecordingService.setPaused(getContext(), wantPause);
        // サービスへの伝達は非同期。反映を少しだけ待って結果を返す。
        new Thread(() -> {
            for (int i = 0; i < 40 && RecordingService.isPaused() != wantPause; i++) {
                try { Thread.sleep(25); } catch (InterruptedException ignored) { break; }
            }
            final boolean now = RecordingService.isPaused();
            runOnMain(() -> {
                JSObject r = new JSObject();
                r.put("paused", now);
                r.put("elapsedMs", RecordingService.getElapsedMs());
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

    /* ===== 待機中のマイク音量の監視 =====
     * 会議情報ポップアップ・設定のレベルバーは、録音中は録音サービスの音量を使う。
     * 録音していないときは音量の出どころが無く、WebView からは getUserMedia で
     * マイクを開けないためバーが動かなかった。ここでマイクを軽く開いて振幅だけを読み、
     * 録音中と同じ "level" イベントで Web 側へ送る（ファイルには何も書かない）。 */
    private static final int MONITOR_RATE = 16000;
    private AudioRecord monitorRecord;
    private Thread monitorThread;
    private volatile boolean monitoring = false;
    private volatile float monitorLevel = 0f;

    @PluginMethod
    public void startLevelMonitor(PluginCall call) {
        JSObject r = new JSObject();
        // 録音中はサービス側の音量が流れてくるので、ここでマイクを開く必要はない
        if (RecordingService.isRecording() || monitoring) {
            r.put("available", true);
            call.resolve(r);
            return;
        }
        try {
            int minBuf = AudioRecord.getMinBufferSize(MONITOR_RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (minBuf <= 0) minBuf = 4096;
            monitorRecord = new AudioRecord(MediaRecorder.AudioSource.MIC, MONITOR_RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, minBuf * 2);
            if (monitorRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                throw new IllegalStateException("AudioRecord を初期化できませんでした");
            }
            monitorRecord.startRecording();
        } catch (Exception e) {
            stopMonitorInternal();
            r.put("available", false);
            call.resolve(r);
            return;
        }
        monitoring = true;
        monitorLevel = 0f;
        monitorThread = new Thread(new Runnable() {
            @Override
            public void run() {
                short[] buf = new short[1024];   // 約64msぶん
                while (monitoring) {
                    AudioRecord ar = monitorRecord;
                    if (ar == null) break;
                    int n;
                    try { n = ar.read(buf, 0, buf.length); } catch (Exception e) { break; }
                    if (n <= 0) continue;
                    int peak = 0;
                    for (int i = 0; i < n; i++) {
                        int v = Math.abs(buf[i]);
                        if (v > peak) peak = v;
                    }
                    float target = RecordingService.levelFromAmp(peak);
                    // 上がるのは即座に、下がるのは少し滑らかに（録音中の表示と同じ動き）
                    monitorLevel = target > monitorLevel ? target : monitorLevel * 0.55f + target * 0.45f;
                    JSObject ev = new JSObject();
                    ev.put("level", monitorLevel);
                    notifyListeners("level", ev);
                }
            }
        }, "noteloop-mic-monitor");
        monitorThread.start();
        r.put("available", true);
        call.resolve(r);
    }

    @PluginMethod
    public void stopLevelMonitor(PluginCall call) {
        stopMonitorInternal();
        call.resolve();
    }

    private void stopMonitorInternal() {
        monitoring = false;
        Thread t = monitorThread;
        monitorThread = null;
        if (t != null) {
            try { t.join(300); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        }
        AudioRecord ar = monitorRecord;
        monitorRecord = null;
        if (ar != null) {
            try { if (ar.getState() == AudioRecord.STATE_INITIALIZED) ar.stop(); } catch (Exception ignored) {}
            try { ar.release(); } catch (Exception ignored) {}
        }
        monitorLevel = 0f;
    }

    /* ===== ライブ文字起こし用の PCM 送信 =====
     * 録音サービスがマイクから読んでいる PCM をそのまま Web 側へ渡す。
     * マイクを二重に開かないので、録音中でも文字起こしができる。 */
    private static final long PCM_PUSH_MS = 1000L;
    private Handler pcmHandler;
    private final Runnable pcmPush = new Runnable() {
        @Override
        public void run() {
            if (!RecordingService.isRecording()) return; // 録音が終われば自然に止まる
            byte[] pcm = RecordingService.takePcm();
            if (pcm != null && pcm.length > 0) {
                JSObject ev = new JSObject();
                ev.put("data", android.util.Base64.encodeToString(pcm, android.util.Base64.NO_WRAP));
                ev.put("sampleRate", 16000);
                notifyListeners("pcm", ev);
            }
            if (pcmHandler != null) pcmHandler.postDelayed(this, PCM_PUSH_MS);
        }
    };

    /** PCM の送信を始める。取り出せない録音エンジンのときは available:false を返す。 */
    @PluginMethod
    public void startPcmUpdates(PluginCall call) {
        JSObject r = new JSObject();
        if (!RecordingService.canTapPcm()) {
            r.put("available", false);
            call.resolve(r);
            return;
        }
        RecordingService.setPcmTap(true);
        if (pcmHandler == null) pcmHandler = new Handler(Looper.getMainLooper());
        pcmHandler.removeCallbacks(pcmPush);
        pcmHandler.postDelayed(pcmPush, PCM_PUSH_MS);
        r.put("available", true);
        call.resolve(r);
    }

    @PluginMethod
    public void stopPcmUpdates(PluginCall call) {
        if (pcmHandler != null) pcmHandler.removeCallbacks(pcmPush);
        RecordingService.setPcmTap(false);
        call.resolve();
    }

    /* ===== 録音後のAI処理を画面オフ中も続ける =====
     * 録音が終わるとフォアグラウンドサービス（録音）は終了し、そこで画面を消すと
     * WebView が凍結されて文字起こし・議事録の作成が途中で止まってしまう。
     * 生成の間だけ別のフォアグラウンドサービスを立てて、プロセスを守る。 */

    @PluginMethod
    public void startProcessing(PluginCall call) {
        String text = call.getString("text");
        ProcessingService.start(getContext(), text != null ? text : "AIが議事録を作成中…");
        // 何かの拍子に WebView のタイマーが止められていても動き続けるようにする
        // （resumeTimers はプロセス全体に効く。UI スレッドから呼ぶ必要がある）
        runOnMain(() -> {
            try { getBridge().getWebView().resumeTimers(); } catch (Exception ignored) {}
        });
        call.resolve();
    }

    /** 進み具合（段階名・進捗率・残り時間）を通知にも反映する */
    @PluginMethod
    public void updateProcessing(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.isEmpty()) { call.resolve(); return; }
        Integer percent = call.getInt("percent", -1);
        ProcessingService.update(getContext(), text,
                percent != null ? percent : -1, call.getString("detail", ""));
        call.resolve();
    }

    /**
     * AI処理の終了。doneTitle を渡すと完了通知を出す
     * （画面を消したまま待っていた人が、できたことに気づけるようにするため）。
     */
    @PluginMethod
    public void stopProcessing(PluginCall call) {
        ProcessingService.stop(getContext(), call.getString("doneTitle"), call.getString("doneText"));
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("recording", RecordingService.isRecording());
        r.put("paused", RecordingService.isPaused());
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

    /* ===== 録音データの保存（端末の「ダウンロード」フォルダへ） =====
     * アプリ版は WebView なので、ブラウザのように <a download> やプレーヤーの
     * 「ダウンロード」ではファイルを保存できない（押しても何も起きない）。
     * そこで Web 側から音声を分割して受け取り、ここでファイルとして書き出す。
     * 長時間録音は数十MBになるため、一度に base64 で渡すとメモリが足りなくなる。
     * saveStart →（数MBずつ）saveChunk → saveFinish の順に呼ぶこと。 */

    private static final class SaveJob {
        OutputStream out;
        Uri uri;          // Android 10 以降: MediaStore の「ダウンロード」
        File file;        // Android 9 以前: アプリのキャッシュ（最後に共有シートで渡す）
        String name;
        String mimeType;
        long bytes;
    }

    private final HashMap<String, SaveJob> saveJobs = new HashMap<>();
    private int saveSeq = 0;

    /** ファイル名から保存に使えない文字を取り除く */
    private static String sanitizeName(String name, String fallback) {
        if (name == null) return fallback;
        String s = name.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_").trim();
        if (s.startsWith(".")) s = "_" + s;
        if (s.length() > 120) s = s.substring(0, 120);
        return s.isEmpty() ? fallback : s;
    }

    @PluginMethod
    public void saveStart(PluginCall call) {
        String name = sanitizeName(call.getString("name"), "recording.m4a");
        String mime = call.getString("mimeType", "audio/mp4");
        if (mime == null || mime.isEmpty()) mime = "audio/mp4";
        SaveJob job = new SaveJob();
        job.name = name;
        job.mimeType = mime;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10 以降は権限なしで「ダウンロード」へ書ける。
                // 書き終わるまで IS_PENDING を立て、途中のファイルを他アプリに見せない。
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(MediaStore.Downloads.MIME_TYPE, mime);
                v.put(MediaStore.Downloads.IS_PENDING, 1);
                job.uri = getContext().getContentResolver()
                        .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (job.uri == null) { call.reject("保存先を作れませんでした"); return; }
                job.out = getContext().getContentResolver().openOutputStream(job.uri);
            } else {
                // Android 9 以前は「ダウンロード」へ直接書くと権限が要るため、
                // 自分のキャッシュに書いてから共有シートで渡す。
                File dir = new File(getContext().getCacheDir(), "exports");
                if (!dir.exists()) dir.mkdirs();
                job.file = new File(dir, name);
                deleteQuietly(job.file);
                job.out = new FileOutputStream(job.file);
            }
            if (job.out == null) { call.reject("保存先を開けませんでした"); return; }
        } catch (Exception e) {
            call.reject("保存を始められませんでした: " + e.getMessage());
            return;
        }
        String token = "save-" + (++saveSeq);
        saveJobs.put(token, job);
        JSObject r = new JSObject();
        r.put("token", token);
        call.resolve(r);
    }

    @PluginMethod
    public void saveChunk(PluginCall call) {
        SaveJob job = saveJobs.get(call.getString("token", ""));
        if (job == null) { call.reject("保存が始まっていません"); return; }
        String data = call.getString("data", "");
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            job.out.write(bytes);
            job.bytes += bytes.length;
        } catch (Exception e) {
            call.reject("書き込みに失敗しました: " + e.getMessage());
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void saveFinish(PluginCall call) {
        final String token = call.getString("token", "");
        final SaveJob job = saveJobs.remove(token);
        if (job == null) { call.reject("保存が始まっていません"); return; }
        try {
            job.out.flush();
            job.out.close();
        } catch (Exception ignored) { }
        if (job.bytes <= 0) {
            abandon(job);
            call.reject("保存できる音声がありませんでした");
            return;
        }
        JSObject r = new JSObject();
        r.put("name", job.name);
        r.put("size", job.bytes);
        if (job.uri != null) {
            try {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.IS_PENDING, 0);
                getContext().getContentResolver().update(job.uri, v, null, null);
            } catch (Exception e) {
                call.reject("保存を仕上げられませんでした: " + e.getMessage());
                return;
            }
            r.put("location", "downloads");
            call.resolve(r);
            return;
        }
        // Android 9 以前: 保存先を選べるよう共有シートを出す
        try {
            Uri shared = FileProvider.getUriForFile(
                    getContext(), getContext().getPackageName() + ".fileprovider", job.file);
            final Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(job.mimeType);
            send.putExtra(Intent.EXTRA_STREAM, shared);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            final Intent chooser = Intent.createChooser(send, "録音データの保存先");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            runOnMain(() -> getContext().startActivity(chooser));
            r.put("location", "share");
        } catch (Exception e) {
            call.reject("保存先アプリへ渡せませんでした: " + e.getMessage());
            return;
        }
        call.resolve(r);
    }

    /** 途中でやめたときの後始末（書きかけを残さない） */
    @PluginMethod
    public void saveCancel(PluginCall call) {
        SaveJob job = saveJobs.remove(call.getString("token", ""));
        if (job != null) abandon(job);
        call.resolve();
    }

    private void abandon(SaveJob job) {
        try { if (job.out != null) job.out.close(); } catch (Exception ignored) { }
        if (job.uri != null) {
            try { getContext().getContentResolver().delete(job.uri, null, null); } catch (Exception ignored) { }
        }
        if (job.file != null) deleteQuietly(job.file);
    }
}
