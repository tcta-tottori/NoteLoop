package jp.tcta.noteloop.wear

import android.app.Application

/** DI は使わず、アプリ全体で共有するインスタンスを [AppContainer] にまとめて持つ（WearTube と同じ方針）。 */
class NoteLoopWearApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}

/** Service / TileService など Context しか無い場所から [AppContainer] を取る。 */
val android.content.Context.appContainer: AppContainer
    get() = (applicationContext as NoteLoopWearApp).container
