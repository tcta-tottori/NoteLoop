package jp.tcta.noteloop;

import android.net.Uri;
import android.util.Log;

import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.ChannelClient;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Wearable;
import com.google.android.gms.wearable.WearableListenerService;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

/**
 * Pixel Watch（watch/ の Wear OS アプリ）からの指示を受け取る。
 *
 * - /noteloop/record/start → 録音を開始（payload = モード id: double / phone）
 * - /noteloop/record/stop  → 停止
 * - /noteloop/record/query → いまの状態を返す
 * - /noteloop/transfer/<name>（ChannelClient）→ 時計で録った音声を受け取り watch-recordings に置く
 *
 * Google Play 開発者サービスがこのサービスを起動するので、アプリが閉じていても届く。
 */
public class WearListenerService extends WearableListenerService {
    private static final String TAG = "NoteLoopWear";

    @Override
    public void onMessageReceived(MessageEvent event) {
        String path = event.getPath();
        if (WatchSync.PATH_START.equals(path)) {
            String mode = new String(event.getData(), StandardCharsets.UTF_8);
            WatchSync.startFromWatch(this, mode);
        } else if (WatchSync.PATH_STOP.equals(path)) {
            WatchSync.stopFromWatch(this);
        } else if (WatchSync.PATH_QUERY.equals(path)) {
            WatchSync.sendStatusNow(this, null);
        }
    }

    /* ===== 時計からのファイル転送 ===== */

    @Override
    public void onChannelOpened(ChannelClient.Channel channel) {
        if (!isTransfer(channel)) return;
        File temp = tempFile(channel);
        try {
            Tasks.await(Wearable.getChannelClient(this).receiveFile(channel, Uri.fromFile(temp), false),
                    10, TimeUnit.SECONDS);
        } catch (Exception e) {
            Log.w(TAG, "受信を開始できません: " + e.getMessage());
        }
    }

    @Override
    public void onInputClosed(ChannelClient.Channel channel, int closeReason, int appSpecificErrorCode) {
        if (!isTransfer(channel)) return;
        File temp = tempFile(channel);
        boolean ok = closeReason == ChannelClient.ChannelCallback.CLOSE_REASON_NORMAL
                || closeReason == ChannelClient.ChannelCallback.CLOSE_REASON_REMOTE_CLOSE;
        if (!ok || !temp.exists() || temp.length() == 0L) {
            Log.w(TAG, "転送が中断されました（reason=" + closeReason + "）");
            temp.delete();
            return;
        }
        File dest = new File(WatchSync.dir(this), WatchSync.safeName(channel.getPath()));
        if (dest.exists()) dest.delete();
        if (!temp.renameTo(dest)) {
            Log.w(TAG, "受信ファイルを移動できません: " + dest);
            temp.delete();
            return;
        }
        Log.i(TAG, "時計から受信: " + dest.getName() + " (" + dest.length() + " bytes)");
        RecorderPlugin.emitWatchFile(dest.getName());
    }

    private boolean isTransfer(ChannelClient.Channel channel) {
        String p = channel.getPath();
        return p != null && p.startsWith(WatchSync.PATH_TRANSFER_PREFIX);
    }

    private File tempFile(ChannelClient.Channel channel) {
        return new File(getCacheDir(), "watch_transfer_" + WatchSync.safeName(channel.getPath()));
    }
}
