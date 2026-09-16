package jp.tcta.noteloop.wear

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import jp.tcta.noteloop.wear.record.PendingAction
import jp.tcta.noteloop.wear.ui.NoteLoopTheme
import jp.tcta.noteloop.wear.ui.navigation.NoteLoopNavHost

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        consumeIntent(intent)
        setContent {
            NoteLoopTheme {
                NoteLoopNavHost()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        consumeIntent(intent)
    }

    /**
     * タイルのボタン（extra）や通知（action）から起動されたときは、開始 / 停止をホーム画面に引き渡す。
     * タイルの LaunchAction は intent の action を指定できないので、extra [EXTRA_ACTION] で受ける。
     */
    private fun consumeIntent(intent: Intent?) {
        if (intent == null) return
        val name = intent.action?.takeIf { it == ACTION_START || it == ACTION_STOP } ?: intent.getStringExtra(EXTRA_ACTION)
        val action =
            when (name) {
                ACTION_START -> PendingAction.Start
                ACTION_STOP -> PendingAction.Stop
                ACTION_RECORDINGS -> PendingAction.OpenRecordings
                else -> null
            } ?: return
        appContainer.pendingAction.post(action)
    }

    companion object {
        const val ACTION_START = "jp.tcta.noteloop.wear.action.START"
        const val ACTION_STOP = "jp.tcta.noteloop.wear.action.STOP"
        const val ACTION_RECORDINGS = "jp.tcta.noteloop.wear.action.RECORDINGS"
        const val EXTRA_ACTION = "action"
    }
}
