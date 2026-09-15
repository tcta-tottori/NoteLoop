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
import jp.tcta.noteloop.shared.RecordMode
import jp.tcta.noteloop.wear.MainActivity
import jp.tcta.noteloop.wear.R
import jp.tcta.noteloop.wear.appContainer
import jp.tcta.noteloop.wear.ui.common.formatElapsed
import kotlinx.coroutines.Dispatchers
import java.time.Instant

/**
 * タイル（ウィジェット）。文字盤から横スワイプで出し、アプリを開かずに録音を始められる。
 *
 * - 待機中: ウォッチ / ダブル / スマホ の 3 ボタン。タップで MainActivity を起動し、権限確認の上で録音を開始する
 * - 録音中: 「● 録音中」と経過時間（ProtoLayout の動的式でレンダラーが毎秒更新）、停止ボタン
 */
class RecordTileService : TileService() {
    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> =
        SuspendToFutureAdapter.launchFuture(Dispatchers.Default) {
            val container = appContainer
            val session = container.controller.session.value
            val recorder = container.recorderState.state.value
            val phone = container.phoneLink.phoneStatus.value
            val startedAt =
                when {
                    session == null -> 0L
                    recorder.recording -> recorder.startedAt
                    session.mode == RecordMode.PHONE && phone?.recording == true -> phone.startedAt
                    else -> session.startedAt
                }
            val layout = if (session == null) idleLayout() else recordingLayout(session.mode, startedAt)
            TileBuilders.Tile
                .Builder()
                .setResourcesVersion(RESOURCES_VERSION)
                .setFreshnessIntervalMillis(if (session == null) 0L else FRESHNESS_RECORDING_MILLIS)
                .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(layout))
                .build()
        }

    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
        SuspendToFutureAdapter.launchFuture(Dispatchers.Default) {
            val builder = ResourceBuilders.Resources.Builder().setVersion(RESOURCES_VERSION)
            ICONS.forEach { (id, res) ->
                builder.addIdToImageMapping(
                    id,
                    ResourceBuilders.ImageResource
                        .Builder()
                        .setAndroidResourceByResId(
                            ResourceBuilders.AndroidImageResourceByResId
                                .Builder()
                                .setResourceId(res)
                                .build(),
                        ).build(),
                )
            }
            builder.build()
        }

    private fun idleLayout(): LayoutElementBuilders.LayoutElement {
        val buttons =
            LayoutElementBuilders.Row
                .Builder()
                .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
        val labels =
            LayoutElementBuilders.Row
                .Builder()
                .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
        RecordMode.entries.forEachIndexed { index, mode ->
            if (index > 0) {
                buttons.addContent(hSpacer(BUTTON_GAP_DP))
                labels.addContent(hSpacer(BUTTON_GAP_DP))
            }
            buttons.addContent(circleButton(iconId(mode), BRAND, startClickable(mode)))
            labels.addContent(
                LayoutElementBuilders.Box
                    .Builder()
                    .setWidth(dp(BUTTON_DP))
                    .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
                    .addContent(text(getString(labelRes(mode)), SMALL_SP, GREY))
                    .build(),
            )
        }
        return column()
            .addContent(text(getString(R.string.tile_title), SMALL_SP, GREY, bold = true))
            .addContent(vSpacer(SPACER_DP * 2))
            .addContent(buttons.build())
            .addContent(vSpacer(SPACER_DP))
            .addContent(labels.build())
            .let { wrap(it.build()) }
    }

    private fun recordingLayout(
        mode: RecordMode,
        startedAt: Long,
    ): LayoutElementBuilders.LayoutElement =
        column()
            .addContent(text(getString(R.string.tile_recording), MEDIUM_SP, RED, bold = true))
            .addContent(elapsedText(startedAt))
            .addContent(text(getString(labelRes(mode)), SMALL_SP, GREY))
            .addContent(vSpacer(SPACER_DP * 2))
            .addContent(circleButton(ICON_STOP, RED, stopClickable()))
            .addContent(vSpacer(SPACER_DP))
            .addContent(text(getString(R.string.tile_stop), SMALL_SP, GREY))
            .let { wrap(it.build()) }

    /** 経過時間。開始時刻が分かっていれば動的式（毎秒更新）、非対応レンダラーには描画時点の静的文字列。 */
    private fun elapsedText(startedAt: Long): LayoutElementBuilders.LayoutElement {
        val static = if (startedAt > 0L) formatElapsed(System.currentTimeMillis() - startedAt) else PLACEHOLDER
        if (startedAt <= 0L) return text(static, LARGE_SP, WHITE, bold = true)
        val elapsed =
            DynamicBuilders.DynamicInstant
                .withSecondsPrecision(Instant.ofEpochMilli(startedAt))
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

    private fun circleButton(
        iconId: String,
        color: Int,
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
                            .setColor(argb(color))
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
                            .setContentDescription(iconId)
                            .build(),
                    ).build(),
            ).addContent(
                LayoutElementBuilders.Image
                    .Builder()
                    .setResourceId(iconId)
                    .setWidth(dp(ICON_DP))
                    .setHeight(dp(ICON_DP))
                    .build(),
            ).build()

    private fun startClickable(mode: RecordMode): ModifiersBuilders.Clickable =
        launchClickable("start_${mode.id}", MainActivity.ACTION_START, mode)

    private fun stopClickable(): ModifiersBuilders.Clickable = launchClickable("stop", MainActivity.ACTION_STOP, null)

    /** MainActivity を起動して開始 / 停止を渡す。LaunchAction は action を持てないので extra で渡す。 */
    private fun launchClickable(
        id: String,
        action: String,
        mode: RecordMode?,
    ): ModifiersBuilders.Clickable {
        val activity =
            ActionBuilders.AndroidActivity
                .Builder()
                .setPackageName(packageName)
                .setClassName(MainActivity::class.java.name)
                .addKeyToExtraMapping(MainActivity.EXTRA_ACTION, ActionBuilders.stringExtra(action))
        if (mode != null) activity.addKeyToExtraMapping(MainActivity.EXTRA_MODE, ActionBuilders.stringExtra(mode.id))
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
            .setModifiers(
                ModifiersBuilders.Modifiers
                    .Builder()
                    .setPadding(
                        ModifiersBuilders.Padding
                            .Builder()
                            .setAll(dp(PADDING_DP))
                            .build(),
                    ).build(),
            ).addContent(content)
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

    private fun hSpacer(widthDp: Float): LayoutElementBuilders.Spacer =
        LayoutElementBuilders.Spacer
            .Builder()
            .setWidth(dp(widthDp))
            .build()

    private fun iconId(mode: RecordMode): String =
        when (mode) {
            RecordMode.WATCH -> ICON_WATCH
            RecordMode.DOUBLE -> ICON_DOUBLE
            RecordMode.PHONE -> ICON_PHONE
        }

    private fun labelRes(mode: RecordMode): Int =
        when (mode) {
            RecordMode.WATCH -> R.string.mode_watch
            RecordMode.DOUBLE -> R.string.mode_double
            RecordMode.PHONE -> R.string.mode_phone
        }

    private companion object {
        const val RESOURCES_VERSION = "1"
        const val FRESHNESS_RECORDING_MILLIS = 60_000L
        const val ICON_WATCH = "ic_watch"
        const val ICON_DOUBLE = "ic_double"
        const val ICON_PHONE = "ic_phone"
        const val ICON_STOP = "ic_stop"
        val ICONS =
            mapOf(
                ICON_WATCH to R.drawable.ic_watch,
                ICON_DOUBLE to R.drawable.ic_double,
                ICON_PHONE to R.drawable.ic_phone,
                ICON_STOP to R.drawable.ic_stop,
            )
        const val PLACEHOLDER = "--:--"
        const val DYNAMIC_TEXT_PATTERN = "000:00"
        const val SECONDS_PER_MINUTE = 60
        const val PADDING_DP = 12f
        const val SPACER_DP = 6f
        const val BUTTON_DP = 48f
        const val BUTTON_GAP_DP = 10f
        const val ICON_DP = 24f
        const val LARGE_SP = 32f
        const val MEDIUM_SP = 16f
        const val SMALL_SP = 12f
        const val WHITE = 0xFFFFFFFF.toInt()
        const val GREY = 0xFFA3A9B5.toInt()
        const val BRAND = 0xFF7B93FF.toInt()
        const val RED = 0xFFF87171.toInt()
    }
}
