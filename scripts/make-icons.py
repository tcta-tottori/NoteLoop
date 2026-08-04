#!/usr/bin/env python3
"""アプリアイコン（ダーク版）を生成する。

元のアイコンは明るい紫のグラデーションだったが、アプリ本体をマットな
グレーがかった黒テーマにしたので、アイコンもそれに揃える。

マイクの形は既存アイコン（白いグリフ）から抜き出して再利用し、
背景と色だけを差し替える。実行には Pillow が必要:

    pip install Pillow && python3 scripts/make-icons.py
"""
from PIL import Image, ImageDraw, ImageFilter
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, 'icons')
SRC = os.path.join(ICONS, 'icon-512.png')  # 元アイコン（白マイク＋明るい背景）

# アプリのテーマ色
BG_TOP = (32, 33, 38)      # #202126
BG_BOTTOM = (23, 24, 27)   # #17181B
GLOW = (79, 110, 247)      # ブランド青（ごく薄く乗せる）
MIC_TOP = (163, 181, 255)  # #A3B5FF
MIC_BOTTOM = (183, 156, 255)  # #B79CFF
RIM = (58, 61, 70)         # 縁。暗い壁紙でも輪郭が見えるように


# 元画像は書き出し先と同じファイルなので、最初に一度だけ読んで保持する。
# （途中で上書きすると、以降のマスク抽出が空になる）
_SRC_IMG = Image.open(SRC).convert('RGB').copy()


def mic_mask(size):
    """元アイコンの白い部分だけを抜き出してマイクのマスクにする"""
    src = _SRC_IMG.resize((size, size), Image.LANCZOS)
    px = src.load()
    mask = Image.new('L', (size, size), 0)
    mp = mask.load()
    for y in range(size):
        for x in range(size):
            r, g, b = px[x, y]
            # 白（マイク）は3チャンネルとも高く、背景の紫は青>赤>緑で差が大きい
            lo, hi = min(r, g, b), max(r, g, b)
            mp[x, y] = 255 if (lo > 200 and hi - lo < 40) else 0
    # 縁のギザつきを取る
    return mask.filter(ImageFilter.GaussianBlur(size / 340))


def vgrad(size, top, bottom):
    g = Image.new('RGB', (1, size))
    d = g.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        d[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return g.resize((size, size), Image.BICUBIC)


def radial_glow(size, color, strength=0.10):
    """左上に置くごく薄いブランド色のにじみ。マット感を壊さない程度に。"""
    layer = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(layer)
    r = int(size * 0.72)
    d.ellipse([-r // 3, -r // 3, r, r], fill=int(255 * strength))
    layer = layer.filter(ImageFilter.GaussianBlur(size * 0.22))
    return Image.new('RGB', (size, size), color), layer


def build(size, maskable=False):
    """maskable=True なら角丸なしの全面塗り＋グリフを小さめに（安全領域対策）"""
    img = vgrad(size, BG_TOP, BG_BOTTOM).convert('RGBA')
    glow_col, glow_a = radial_glow(size, GLOW)
    img = Image.alpha_composite(img, Image.merge('RGBA', (*glow_col.split(), glow_a)))

    # マイク本体（縦グラデーション）
    glyph_ratio = 0.62 if maskable else 0.86
    gsize = max(int(size * glyph_ratio), 8)
    m = mic_mask(gsize)
    mic = vgrad(gsize, MIC_TOP, MIC_BOTTOM).convert('RGBA')
    mic.putalpha(m)

    # うっすら落ち影を敷いて、黒背景でも浮いて見えるようにする
    shadow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    sh = Image.new('L', (gsize, gsize), 0)
    sh.paste(m, (0, 0))
    sh = sh.filter(ImageFilter.GaussianBlur(size * 0.014))
    off = ((size - gsize) // 2, (size - gsize) // 2 + int(size * 0.008))
    shadow.paste(Image.new('RGBA', (gsize, gsize), (0, 0, 0, 150)), off, sh)
    img = Image.alpha_composite(img, shadow)
    img.paste(mic, ((size - gsize) // 2, (size - gsize) // 2), mic)

    if maskable:
        return img

    # 角丸に切り抜き、細い縁を足す
    radius = int(size * 0.22)
    rounded = Image.new('L', (size, size), 0)
    ImageDraw.Draw(rounded).rounded_rectangle([0, 0, size - 1, size - 1], radius, fill=255)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), rounded)
    d = ImageDraw.Draw(out)
    w = max(1, size // 256)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius, outline=(*RIM, 255), width=w)
    return out


def main():
    for size in (192, 512):
        build(size).save(os.path.join(ICONS, f'icon-{size}.png'))
        build(size, maskable=True).save(os.path.join(ICONS, f'icon-{size}-maskable.png'))
    for size in (32, 48):
        build(size).save(os.path.join(ICONS, f'favicon-{size}.png'))

    # Android のランチャーアイコン（密度別）
    res = os.path.join(ROOT, 'android/app/src/main/res')
    for d, s in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
        out = os.path.join(res, f'mipmap-{d}')
        if not os.path.isdir(out):
            continue
        build(s).save(os.path.join(out, 'ic_launcher.png'))
        build(s).save(os.path.join(out, 'ic_launcher_round.png'))
        # アダプティブアイコンの前景。中央66%が安全領域なので大きめに描いて縮める
        build(s * 2, maskable=True).save(os.path.join(out, 'ic_launcher_foreground.png'))
    print('アイコンを生成しました')


if __name__ == '__main__':
    main()
