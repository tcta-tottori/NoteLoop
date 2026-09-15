package jp.tcta.noteloop.wear.ui.navigation

import androidx.compose.runtime.Composable
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.TimeText
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import jp.tcta.noteloop.wear.ui.home.HomeScreen
import jp.tcta.noteloop.wear.ui.recordings.RecordingDetailScreen
import jp.tcta.noteloop.wear.ui.recordings.RecordingsScreen

/** 画面遷移。ホーム → 録音一覧 → 詳細。右スワイプで戻る（Wear OS 標準）。 */
object Routes {
    const val HOME = "home"
    const val RECORDINGS = "recordings"
    const val DETAIL = "detail/{name}"
    const val ARG_NAME = "name"

    fun detail(name: String): String = "detail/$name"
}

@Composable
fun NoteLoopNavHost() {
    val navController = rememberSwipeDismissableNavController()
    // 時刻表示は全画面で残す
    AppScaffold(timeText = { TimeText() }) {
        SwipeDismissableNavHost(navController = navController, startDestination = Routes.HOME) {
            composable(Routes.HOME) {
                HomeScreen(onRecordings = { navController.navigate(Routes.RECORDINGS) })
            }
            composable(Routes.RECORDINGS) {
                RecordingsScreen(onOpen = { name -> navController.navigate(Routes.detail(name)) })
            }
            composable(Routes.DETAIL) { entry ->
                val name = entry.arguments?.getString(Routes.ARG_NAME).orEmpty()
                RecordingDetailScreen(name = name, onDeleted = { navController.popBackStack() })
            }
        }
    }
}
