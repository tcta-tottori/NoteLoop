package jp.tcta.noteloop;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * アプリ内更新。
 *
 * ストア配布ではないため自動更新の仕組みが無く、更新のたびに
 * ブラウザでAPKを落とし直す必要があった。ここでは
 * 「新しい版の確認 → ダウンロード → インストーラ起動」までを担う。
 */
@CapacitorPlugin(name = "Updater")
public class UpdaterPlugin extends Plugin {

    /** いま動いているアプリのバージョンを返す */
    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject r = new JSObject();
        try {
            PackageManager pm = getContext().getPackageManager();
            PackageInfo pi = pm.getPackageInfo(getContext().getPackageName(), 0);
            r.put("versionName", pi.versionName);
            r.put("versionCode", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? pi.getLongVersionCode() : (long) pi.versionCode);
            r.put("packageName", pi.packageName);
        } catch (Exception e) {
            call.reject("バージョンを取得できませんでした: " + e.getMessage());
            return;
        }
        call.resolve(r);
    }

    /**
     * URL から JSON を取って返す（更新確認の version.json 用）。
     *
     * WebView の fetch は https://localhost オリジンからの通信になるため、
     * CORS ヘッダを返さない GitHub のリリース資産は「Failed to fetch」で
     * 必ず失敗する。ネイティブ側の HttpURLConnection なら CORS の制約が
     * 無いので、APK のダウンロードと同じ経路で確実に取得できる。
     */
    @PluginMethod
    public void fetchJson(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("取得先が指定されていません");
            return;
        }
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setInstanceFollowRedirects(true); // github.com → objects.githubusercontent.com
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(20000);
                conn.setRequestProperty("Accept", "application/json");
                conn.connect();
                int code = conn.getResponseCode();
                if (code / 100 != 2) throw new Exception("HTTP " + code);

                ByteArrayOutputStream body = new ByteArrayOutputStream();
                try (InputStream in = conn.getInputStream()) {
                    byte[] buf = new byte[8 * 1024];
                    int n;
                    // 更新情報は数百バイト。壊れた応答で膨らまないよう上限を設ける。
                    while ((n = in.read(buf)) > 0 && body.size() < 64 * 1024) {
                        body.write(buf, 0, n);
                    }
                }
                final JSObject data = new JSObject(new String(body.toByteArray(), "UTF-8"));
                runOnMain(() -> call.resolve(data));
            } catch (Exception e) {
                final String msg = String.valueOf(e.getMessage());
                runOnMain(() -> call.reject("更新情報を取得できませんでした: " + msg));
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    /**
     * APK をダウンロードしてインストーラを開く。
     * 進捗は "downloadProgress" イベントで Web 側へ流す。
     */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("ダウンロード先が指定されていません");
            return;
        }
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists()) dir.mkdirs();
                // 古い APK を残さない（容量と取り違えを防ぐ）
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete();
                File apk = new File(dir, "NOTELOOP-update.apk");

                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(60000);
                conn.connect();
                int code = conn.getResponseCode();
                if (code / 100 != 2) throw new Exception("HTTP " + code);

                long total = conn.getContentLengthLong();
                try (InputStream in = conn.getInputStream();
                     FileOutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[64 * 1024];
                    long done = 0;
                    int n, lastPct = -1;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        done += n;
                        int pct = total > 0 ? (int) (done * 100 / total) : -1;
                        if (pct != lastPct) {
                            lastPct = pct;
                            JSObject ev = new JSObject();
                            ev.put("percent", pct);
                            ev.put("received", done);
                            ev.put("total", total);
                            notifyListeners("downloadProgress", ev);
                        }
                    }
                }
                if (apk.length() == 0) throw new Exception("ダウンロードしたファイルが空でした");

                // インストーラへ渡す。自分のキャッシュ配下なので FileProvider 経由で共有する。
                Uri uri = FileProvider.getUriForFile(
                        getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);

                final long size = apk.length();
                runOnMain(() -> {
                    JSObject r = new JSObject();
                    r.put("size", size);
                    call.resolve(r);
                });
            } catch (Exception e) {
                final String msg = String.valueOf(e.getMessage());
                runOnMain(() -> call.reject("更新の取得に失敗しました: " + msg));
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private void runOnMain(Runnable r) {
        if (getActivity() != null) getActivity().runOnUiThread(r);
        else new android.os.Handler(android.os.Looper.getMainLooper()).post(r);
    }
}
