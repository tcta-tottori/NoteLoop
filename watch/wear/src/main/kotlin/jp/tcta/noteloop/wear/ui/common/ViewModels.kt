package jp.tcta.noteloop.wear.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import jp.tcta.noteloop.wear.AppContainer
import jp.tcta.noteloop.wear.NoteLoopWearApp

/** Hilt を使わないので、AppContainer を渡すファクトリをここで組む。 */
@Composable
inline fun <reified VM : ViewModel> containerViewModel(crossinline create: (NoteLoopWearApp, AppContainer) -> VM): VM {
    val app = LocalContext.current.applicationContext as NoteLoopWearApp
    return viewModel(
        factory =
            viewModelFactory {
                initializer { create(app, app.container) }
            },
    )
}
