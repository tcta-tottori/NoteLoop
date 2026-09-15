package jp.tcta.noteloop;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // 自作プラグインは super.onCreate（ブリッジ生成）より前に登録する
        registerPlugin(RecorderPlugin.class);
        registerPlugin(UpdaterPlugin.class);
        super.onCreate(savedInstanceState);
        // ウォッチからの録音開始をバックグラウンドで受けられなかったときの通知をタップした場合
        WatchSync.handleActivityIntent(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        WatchSync.handleActivityIntent(this, intent);
    }
}
