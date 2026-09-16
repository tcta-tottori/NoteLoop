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
 * タイル（ウィジェット）。Google レコーダーのタイルと同じ並び:
 * 上に小さなアプリアイコンと名前、中央に横長の大きな「● 録音」ピル、下に小さな「録音一覧」ピル。
 *
 * - 待機中: 大きなピルをタップで MainActivity を起動し、権限確認の上で録音を開始する。小さなピルは録音一覧を開く
 * - 録音中: 大きなピルに「録音中」と経過時間（ProtoLayout の動的式で毎秒更新）。タップでアプリを開く
 *   （一時停止・停止はアプリ内で行う。タップ / 長押し）
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
                    ICON_LOGO,
                    ResourceBuilders.ImageResource
                        .Builder()
                        .setAndroidResourceByResId(
                            ResourceBuilders.AndroidImageResourceByResId
                                .Builder()
                                .setResourceId(R.drawable.app_logo)
                                .build(),
                        ).build(),
                ).build()
        }

    private fun idleLayout(): LayoutElementBuilders.LayoutElement {
        val big =
            LayoutElementBuilders.Row
                .Builder()
                .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
                .addContent(dot())
                .addContent(hSpacer(DOT_GAP_DP))
                .addContent(text(getString(R.string.tile_record), LARGE_SP, WHITE, bold = true))
                .build()
        return wrap(
            column()
                .addContent(header(getString(R.string.app_name)))
                .addContent(vSpacer(SPACER_DP))
                .addContent(pill(big, BIG_W_DP, BIG_H_DP, BRAND, launchClickable("start", MainActivity.ACTION_START)))
                .addContent(vSpacer(SPACER_DP))
                .addContent(
                    pill(
                        text(getString(R.string.tile_recordings), SMALL_SP, TEXT, bold = true),
                        SMALL_W_DP,
                        SMALL_H_DP,
                        SURFACE,
                        launchClickable("recordings", MainActivity.ACTION_RECORDINGS),
                    ),
                ).build(),
        )
    }

    private fun recordingLayout(
        paused: Boolean,
        elapsedMs: Long,
        runningSince: Long,
    ): LayoutElementBuilders.LayoutElement {
        val big =
            LayoutElementBuilders.Row
                .Builder()
                .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
                .addContent(dot())
                .addContent(hSpacer(DOT_GAP_DP))
                .addContent(elapsedText(elapsedMs, if (paused) 0L else runningSince))
                .build()
        return wrap(
            column()
                .addContent(header(getString(if (paused) R.string.tile_paused else R.string.tile_recording)))
                .addContent(vSpacer(SPACER_DP))
                .addContent(pill(big, BIG_W_DP, BIG_H_DP, BRAND, launchClickable("open", null)))
                .addContent(vSpacer(SPACER_DP))
                .addContent(
                    pill(
                        text(getString(R.string.tile_open), SMALL_SP, TEXT, bold = true),
                        SMALL_W_DP,
                        SMALL_H_DP,
                        SURFACE,
                        launchClickable("open2", null),
                    ),
                ).build(),
        )
    }

    /** 上のアプリアイコン（丸の中に紫のマイク）と名前 */
    private fun header(label: String): LayoutElementBuilders.LayoutElement =
        LayoutElementBuilders.Column
            .Builder()
            .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
            .addContent(
                LayoutElementBuilders.Box
                    .Builder()
                    .setWidth(dp(ICON_CIRCLE_DP))
                    .setHeight(dp(ICON_CIRCLE_DP))
                    .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
                    .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
                    .setModifiers(background(SURFACE, ICON_CIRCLE_DP / 2).build())
                    .addContent(
                        LayoutElementBuilders.Image
                            .Builder()
                            .setResourceId(ICON_LOGO)
                            .setWidth(dp(ICON_DP))
                            .setHeight(dp(ICON_DP))
                            .build(),
                    ).build(),
            ).addContent(vSpacer(HEADER_GAP_DP))
            .addContent(text(label, SMALL_SP, TEXT, bold = true))
            .build()

    /** 「● 録音」の点 */
    private fun dot(): LayoutElementBuilders.LayoutElement =
        LayoutElementBuilders.Box
            .Builder()
            .setWidth(dp(DOT_DP))
            .setHeight(dp(DOT_DP))
            .setModifiers(background(BG, DOT_DP / 2).build())
            .build()

    /** 横長の丸いボタン */
    private fun pill(
        content: LayoutElementBuilders.LayoutElement,
        widthDp: Float,
        heightDp: Float,
        color: Int,
        clickable: ModifiersBuilders.Clickable,
    ): LayoutElementBuilders.LayoutElement =
        LayoutElementBuilders.Box
            .Builder()
            .setWidth(dp(widthDp))
            .setHeight(dp(heightDp))
            .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
            .setModifiers(
                background(color, heightDp / 2)
                    .setClickable(clickable)
                    .setSemantics(
                        ModifiersBuilders.Semantics
                            .Builder()
                            .setContentDescription(clickable.id)
                            .build(),
                    ).build(),
            ).addContent(content)
            .build()

    private fun background(
        color: Int,
        radiusDp: Float,
    ): ModifiersBuilders.Modifiers.Builder =
        ModifiersBuilders.Modifiers
            .Builder()
            .setBackground(
                ModifiersBuilders.Background
                    .Builder()
                    .setColor(argb(color))
                    .setCorner(
                        ModifiersBuilders.Corner
                            .Builder()
                            .setRadius(dp(radiusDp))
                            .build(),
                    ).build(),
            )

    /**
     * 経過時間。録音が進んでいれば動的式（毎秒更新）、一時停止中や非対応レンダラーには静的文字列。
     * 動的式の起点は「今 − 経過時間」。
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

    private fun hSpacer(widthDp: Float): LayoutElementBuilders.Spacer =
        LayoutElementBuilders.Spacer
            .Builder()
            .setWidth(dp(widthDp))
            .build()

    private companion object {
        const val RESOURCES_VERSION = "3"
        const val FRESHNESS_RECORDING_MILLIS = 60_000L
        const val ICON_LOGO = "app_logo"
        const val DYNAMIC_TEXT_PATTERN = "000:00"
        const val SECONDS_PER_MINUTE = 60
        const val SPACER_DP = 8f
        const val HEADER_GAP_DP = 3f
        const val ICON_CIRCLE_DP = 26f
        const val ICON_DP = 14f
        const val BIG_W_DP = 160f
        const val BIG_H_DP = 66f
        const val SMALL_W_DP = 104f
        const val SMALL_H_DP = 38f
        const val DOT_DP = 11f
        const val DOT_GAP_DP = 8f
        const val LARGE_SP = 24f
        const val SMALL_SP = 13f
        const val WHITE = 0xFFFFFFFF.toInt()
        const val TEXT = 0xFFE7E9EE.toInt()
        const val BG = 0xFF17181B.toInt()
        const val SURFACE = 0xFF2A2D33.toInt()

        /** 大きなピルの色。ProtoLayout はグラデーションを塗れないので、本体の紫 2 色の中間 */
        const val BRAND = 0xFF9090FF.toInt()
    }
}
