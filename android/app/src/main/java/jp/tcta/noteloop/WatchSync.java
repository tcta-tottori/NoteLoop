package jp.tcta.noteloop;

import android.content.Context;

import java.io.File;

/**
 * Pixel Watch（watch/ の Wear OS アプリ）との連携。
 *
 * 録音は時計の中で完結し、スマホへは「時計で録った音声の転送」だけが届く（Wearable Data Layer の ChannelClient）。
 * 受け取った音声は filesDir/watch-recordings に置き、Web 側（app.js）が起動時と受信時に履歴へ取り込む。
 *
 * パスとケイパビリティ名は watch/shared の SyncPaths と一致させること。
 */
public final class WatchSync {
    public static final String PATH_TRANSFER_PREFIX = "/noteloop/transfer/";

    /** 時計から届いた音声の置き場。通常の録音（recordings/）と分け、復元処理の掃除に巻き込まれないようにする */
    public static final String DIR_NAME = "watch-recordings";

    private WatchSync() {}

    public static File dir(Context ctx) {
        File d = new File(ctx.getFilesDir(), DIR_NAME);
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /** ファイル名の安全化（転送パスから取り出した名前をそのまま使わない） */
    public static String safeName(String name) {
        if (name == null) return "";
        String n = name.substring(name.lastIndexOf('/') + 1).replaceAll("[^A-Za-z0-9._-]", "_");
        return n.endsWith(".m4a") ? n : n + ".m4a";
    }
}
