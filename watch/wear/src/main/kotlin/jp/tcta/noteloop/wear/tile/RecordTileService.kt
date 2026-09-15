package jp.tcta.noteloop.wear.tile

import androidx.concurrent.futures.SuspendToFutureAdapter
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.DimensionBuilders.sp
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.LayoutElementBuilders.FONT_WEIGHT_BOLD
import androidx.wear.protolayout.LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER
import androidx.wear.protolayout.LayoutElementBuilders.VERTICAL_ALIGN_CENTER
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.protolayout.TypeBuilders
import androidx.wear.protolayout.expression.DynamicBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import jp.tcta.noteloop.wear.MainActivity
import jp.tcta.noteloop.wear.R
import jp.tcta.noteloop.wear.appContainer
import jp.tcta.noteloop.wear.ui.common.formatElapsed
import java.time.Instant

/**
 * タイル（ウィジェット）。文字盤から横スワイプで出し、大きな紫のボタン 1 つで録音を始める。
 *
 * - 待機中: 大きな丸ボタン（マイク）。タップで MainActivity を起動し、権限確認の上で録音を開始する
 * - 録音中: 同じボタンの中に「● 録音中」と経過時間（ProtoLayout の動的式で毎秒更新）。タップでアプリを開く
 *   （一時停止・停止はアプリ内のボタンで行う。タップ / 長押し）
 */
class RecordTileService : TileService() {
    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> =
        SuspendToFutureAdapter.launchFuture {
            val state = appContainer.recorderState.state.value
            val layout = if (state.recording) recordingLayout(state.paused, state.elapsedMs(), state.runningSince) else idleLayout()
            TileBuilders.Tile
                .Builder()
                .setResourcesVersion(RESOURCES_VERSION)
                .setFreshnessIntervalMillis(if (state.recording) FRESHNESS_RECORDING_MILLIS else 0L)
                .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(layout))
                .build()
        }

    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
        SuspendToFutureAdapter.launchFuture {
            ResourceBuilders.Resources
                .Builder()
                .setVersion(RESOURCES_VERSION)
                .addIdToImageMapping(
                    ICON_MIC,
                    ResourceBuilders.ImageResource
                        .Builder()
                        .setAndroidResourceByResId(
                            ResourceBuilders.AndroidImageResourceByResId
                                .Builder()
                                .setResourceId(R.drawable.ic_mic)
                                .build(),
                        ).build(),
                ).build()
        }

    private fun idleLayout(): LayoutElementBuilders.LayoutElement {
        val icon =
            LayoutElementBuilders.Image
                .Builder()
                .setResourceId(ICON_MIC)
                .setWidth(dp(ICON_DP))
                .setHeight(dp(ICON_DP))
                .build()
        return wrap(
            column()
                .addContent(bigButton(icon, launchClickable("start", MainActivity.ACTION_START)))
                .addContent(vSpacer(SPACER_DP))
                .addContent(text(getString(R.string.tile_record), SMALL_SP, GREY))
                .build(),
        )
    }

    private fun recordingLayout(
        paused: Boolean,
        elapsedMs: Long,
        runningSince: Long,
    ): LayoutElementBuilders.LayoutElement {
        val inner =
            LayoutElementBuilders.Column
                .Builder()
                .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
                .addContent(text(getString(if (paused) R.string.tile_paused else R.string.tile_recording), SMALL_SP, WHITE, bold = true))
                .addContent(elapsedText(elapsedMs, if (paused) 0L else runningSince))
                .build()
        return wrap(
            column()
                .addContent(bigButton(inner, launchClickable("open", null)))
                .addContent(vSpacer(SPACER_DP))
                .addContent(text(getString(R.string.tile_open), SMALL_SP, GREY))
                .build(),
        )
    }

    /**
     * 経過時間。録音が進んでいれば動的式（毎秒更新）、一時停止中や非対応レンダラーには静的文字列。
     * 動的式の起点は「今の区間の開始 − それまでの累計」。
     */
    private fun elapsedText(
        elapsedMs: Long,
        runningSince: Long,
    ): LayoutElementBuilders.LayoutElement {
        val static = formatElapsed(elapsedMs)
        if (runningSince <= 0L) return text(static, LARGE_SP, WHITE, bold = true)
        val base = System.currentTimeMillis() - elapsedMs
        val elapsed =
            DynamicBuilders.DynamicInstant
                .withSecondsPrecision(Instant.ofEpochMilli(base))
                .durationUntil(DynamicBuilders.DynamicInstant.platformTimeWithSecondsPrecision())
        val twoDigits =
            DynamicBuilders.DynamicInt32.IntFormatter
                .Builder()
                .setMinIntegerDigits(2)
                .setGroupingUsed(false)
                .build()
        val dynamic =
            elapsed
                .toIntMinutes()
                .format(twoDigits)
                .concat(DynamicBuilders.DynamicString.constant(":"))
                .concat(elapsed.toIntSeconds().rem(SECONDS_PER_MINUTE).format(twoDigits))
        return LayoutElementBuilders.Text
            .Builder()
            .setText(
                TypeBuilders.StringProp
                    .Builder(static)
                    .setDynamicValue(dynamic)
                    .build(),
            ).setLayoutConstraintsForDynamicText(TypeBuilders.StringLayoutConstraint.Builder(DYNAMIC_TEXT_PATTERN).build())
            .setFontStyle(fontStyle(LARGE_SP, WHITE, bold = true))
            .build()
    }

    /** 画面幅いっぱいに近い紫の丸ボタン。中身は待機中はマイク、録音中は文字。 */
    private fun bigButton(
        content: LayoutElementBuilders.LayoutElement,
        clickable: ModifiersBuilders.Clickable,
    ): LayoutElementBuilders.LayoutElement =
        LayoutElementBuilders.Box
            .Builder()
            .setWidth(dp(BUTTON_DP))
            .setHeight(dp(BUTTON_DP))
            .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
            .setModifiers(
                ModifiersBuilders.Modifiers
                    .Builder()
                    .setBackground(
                        ModifiersBuilders.Background
                            .Builder()
                            .setColor(argb(BRAND))
                            .setCorner(
                                ModifiersBuilders.Corner
                                    .Builder()
                                    .setRadius(dp(BUTTON_DP / 2))
                                    .build(),
                            ).build(),
                    ).setClickable(clickable)
                    .setSemantics(
                        ModifiersBuilders.Semantics
                            .Builder()
                            .setContentDescription(getString(R.string.tile_record))
                            .build(),
                    ).build(),
            ).addContent(content)
            .build()

    /** MainActivity を起動する。LaunchAction は action を持てないので extra で渡す（null なら開くだけ）。 */
    private fun launchClickable(
        id: String,
        action: String?,
    ): ModifiersBuilders.Clickable {
        val activity =
            ActionBuilders.AndroidActivity
                .Builder()
                .setPackageName(packageName)
                .setClassName(MainActivity::class.java.name)
        if (action != null) activity.addKeyToExtraMapping(MainActivity.EXTRA_ACTION, ActionBuilders.stringExtra(action))
        return ModifiersBuilders.Clickable
            .Builder()
            .setId(id)
            .setOnClick(
                ActionBuilders.LaunchAction
                    .Builder()
                    .setAndroidActivity(activity.build())
                    .build(),
            ).build()
    }

    private fun column(): LayoutElementBuilders.Column.Builder =
        LayoutElementBuilders.Column
            .Builder()
            .setWidth(expand())
            .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)

    private fun wrap(content: LayoutElementBuilders.LayoutElement): LayoutElementBuilders.LayoutElement =
        LayoutElementBuilders.Box
            .Builder()
            .setWidth(expand())
            .setHeight(expand())
            .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
            .addContent(content)
            .build()

    private fun text(
        value: String,
        sizeSp: Float,
        color: Int,
        bold: Boolean = false,
    ): LayoutElementBuilders.Text =
        LayoutElementBuilders.Text
            .Builder()
            .setText(value)
            .setMaxLines(1)
            .setFontStyle(fontStyle(sizeSp, color, bold))
            .build()

    private fun fontStyle(
        sizeSp: Float,
        color: Int,
        bold: Boolean,
    ): LayoutElementBuilders.FontStyle {
        val builder =
            LayoutElementBuilders.FontStyle
                .Builder()
                .setSize(sp(sizeSp))
                .setColor(argb(color))
        if (bold) builder.setWeight(FONT_WEIGHT_BOLD)
        return builder.build()
    }

    private fun vSpacer(heightDp: Float): LayoutElementBuilders.Spacer =
        LayoutElementBuilders.Spacer
            .Builder()
            .setHeight(dp(heightDp))
            .build()

    private companion object {
        const val RESOURCES_VERSION = "2"
        const val FRESHNESS_RECORDING_MILLIS = 60_000L
        const val ICON_MIC = "ic_mic"
        const val DYNAMIC_TEXT_PATTERN = "000:00"
        const val SECONDS_PER_MINUTE = 60
        const val SPACER_DP = 8f
        const val BUTTON_DP = 112f
        const val ICON_DP = 44f
        const val LARGE_SP = 26f
        const val SMALL_SP = 12f
        const val WHITE = 0xFFFFFFFF.toInt()
        const val GREY = 0xFFA3A9B5.toInt()

        /** ボタンの色。ProtoLayout はグラデーションを塗れないので、本体の紫 2 色の中間 */
        const val BRAND = 0xFF9090FF.toInt()
    }
}
