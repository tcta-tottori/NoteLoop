# NOTELOOP UI デザイン仕様書（PC / ダークテーマ / 左固定メニュー）

このファイルは **Claude Code にそのまま渡すためのデザインデータ** です。
NOTELOOP 本体（`styles.css` / `index.html`）の**現行デザイン**を抽出し、
**PC のブラウザで開く単体 HTML ファイル**向けにまとめ直したものです。

配色は **マットな黒ベースのダークテーマ**、メニューは **左に固定表示のサイドバー** です。
本体アプリも 1024px 以上では同じ左固定サイドバーになるため、**本書は本体の実装をそのまま写したもの**であり、
PC向けに独自解釈した部分はほとんどありません。

> 使い方（Claude Code への渡し方）
> ```
> このファイル（docs/pc-ui-design-spec.md）のデザイン仕様に従って、
> ◯◯（作りたい画面）の単体HTMLファイルを作ってください。
> 外部ファイルに依存せず、1ファイルで完結させてください。
> ```
> 動くひな形が欲しい場合は `docs/pc-ui-starter.html` をコピーして中身を差し替えてください。

---

## 0. 前提・制約

| 項目 | 値 |
|---|---|
| 対象 | PC（デスクトップ）ブラウザ。Chrome / Edge 系を想定 |
| 形式 | **単体 HTML ファイル**（CSS・SVG はインライン。外部CDN・外部画像は使わない） |
| 言語 | 日本語 UI |
| カラースキーム | **ダーク固定**（`color-scheme: dark`。ライトモードは実装しない） |
| 基準幅 | 1024px 以上。それ未満はサイドバーをアイコンのみに縮小 |
| フォント | `system-ui, -apple-system, "Segoe UI", "Hiragino Kaku Gothic ProN", "Noto Sans JP", Meiryo, sans-serif` |
| 行間 | `line-height: 1.6`（本文）／ `1.75〜1.95`（長文テキストエリア） |

### このデザインの性格（守るべきトーン）

- **マットな黒**。純黒（#000）ではなく、わずかにグレーがかった `#17181b` を地にする。
- **面ごとの明度差は控えめ**。パネルと背景の差は小さく、**層は落ち影で作る**（ライトテーマのように明度で分けない）。
- **光沢を出さない**。彩度は低め、ブランド色のにじみもごく薄く。
- **彩度の高い色は面積を小さく**。ブランド色は主ボタン・アイコン・アクセント線に限る。

---

## 1. デザイントークン（そのまま `:root` に貼る）

```css
:root {
  /* マットなグレーがかった黒をベースにしたダークテーマ */
  --bg: #17181b;
  --surface: #212328;
  --surface-2: #191b1f;   /* 入力欄・へこんで見せたい面 */
  --surface-3: #2a2d33;   /* 浮かせたい小要素・トラック */
  --text: #e7e9ee;
  --muted: #a3a9b5;
  --faint: #7b818d;
  --border: #2e3138;
  --border-strong: #3c4048;

  /* ブランド（ダーク地で沈まないよう、明るめの青紫） */
  --brand1: #7b93ff;
  --brand2: #a68cff;
  --brand-ink: #ffffff;

  /* 意味色（ダーク地で読める明度に調整済み） */
  --accent: #f472b6;
  --ok: #4ade80;       /* 決定事項・成功 */
  --danger: #f87171;   /* 削除・エラー・録音中 */
  --amber: #fbbf24;    /* ToDo・警告 */

  /* 影は黒を濃く。ダークでは明度差より落ち影で層を作る */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, .35);
  --shadow-md: 0 2px 10px rgba(0, 0, 0, .38), 0 1px 3px rgba(0, 0, 0, .3);
  --shadow-lg: 0 14px 36px rgba(0, 0, 0, .5);

  /* 角丸 */
  --radius: 18px;      /* パネル・カード */
  --radius-sm: 12px;   /* 入力欄・ボタン・小カード */

  /* PC レイアウト */
  --sidebar-w: 288px;  /* 左固定メニューの幅（本体アプリと同値） */
  --header-h: 60px;
  --content-max: 960px;

  --mono: ui-monospace, Menlo, Consolas, monospace;

  color-scheme: dark;  /* 入力欄・音声プレイヤーなど標準UIもダークにする */
}
```

> **`color-scheme: dark` は必須です。** これを書かないと `<input>` `<select>` `<audio>` などブラウザ標準UIだけ白いままになり、画面が破綻します。

### 面の使い分け（ダークでは特に重要）

| トークン | 使う場所 |
|---|---|
| `--bg` | ページの地 |
| `--surface` | パネル・カード・モーダル・ポップオーバー |
| `--surface-2` | **入力欄**、パネル内で一段沈めたい面（ライトテーマと逆で「暗い＝奥」） |
| `--surface-3` | プログレスのトラック、丸ボタン、バッジなど**浮かせたい小要素** |

---

## 2. 背景（全画面共通・固定）

`body::before` で固定の暗いグラデーションを敷き、その上に**半透明パネル**を重ねます。
ブランド色のにじみはライトテーマより**さらに薄く**（.10 / .08）してマット感を保ちます。

```css
body::before {
  content: ""; position: fixed; inset: 0; z-index: -1;
  background:
    radial-gradient(130% 90% at 12% -5%, rgba(79, 110, 247, .10), transparent 55%),
    radial-gradient(130% 90% at 100% 12%, rgba(124, 92, 246, .08), transparent 55%),
    linear-gradient(170deg, #17181b 0%, #1a1a1f 55%, #1c1a1f 100%);
}
```

ヘッダー直下にブランド色のグローを落とすと、画面上部に自然な奥行きが出ます（任意）。

```css
.header-glow {
  position: fixed; top: 0; left: var(--sidebar-w); right: 0; z-index: -1; pointer-events: none;
  height: 190px;
  background: linear-gradient(to bottom,
    rgba(90, 100, 244, .20) 0%,
    rgba(140, 96, 232, .13) 34%,
    rgba(199, 79, 191, .07) 64%,
    rgba(199, 79, 191, 0) 100%);
  filter: blur(8px);
}
```

---

## 3. PC レイアウト（左固定メニュー）

```
┌────────────────┬─────────────────────────────────────────┐
│                │  ヘッダー（画面タイトル + 右にアクション）│ ← position: sticky; top: 0
│  サイドバー     ├─────────────────────────────────────────┤
│  288px 固定     │                                         │
│  暗いグラデ      │   コンテンツ（max-width: 960px 中央寄せ）│
│                │   .panel を縦に積む                      │
│  ────          │                                         │
│  ロゴ / 版数     │                                         │
└────────────────┴─────────────────────────────────────────┘
```

### 3-1. 骨格 HTML

```html
<body>
  <aside class="sidebar">
    <div class="sidebar-head">
      <span class="brand-mark"><!-- 21px のインライン SVG --></span>
      <div class="sidebar-ver">
        <span class="ver-main">NOTELOOP</span>
        <span class="ver-sub">Ver.1.0</span>
      </div>
    </div>

    <nav class="sidebar-nav" aria-label="メニュー">
      <button class="nav-item active" type="button" data-target="screen-home" aria-current="page">
        <svg class="nav-ico" …></svg><span>録音</span>
      </button>
      <!-- 履歴 / 設定 / マニュアル -->
    </nav>
  </aside>

  <div class="app-shell">
    <header class="app-header">
      <h1 class="page-title">録音・文字起こし・議事録作成</h1>
      <div class="header-actions"><!-- 任意のボタン --></div>
    </header>

    <main class="app-main">
      <section class="screen active" id="screen-home">
        <div class="panel">…</div>
      </section>
    </main>
  </div>
</body>
```

### 3-2. レイアウト CSS

```css
body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); }

/* 左固定サイドバー */
.sidebar {
  position: fixed; top: 0; left: 0; bottom: 0; z-index: 50;
  width: var(--sidebar-w);
  display: flex; flex-direction: column; gap: 4px;
  padding: 18px 14px 14px;
  background: linear-gradient(160deg, #1c1e26 0%, #21202a 52%, #26202c 120%);
  border-right: 1px solid rgba(255, 255, 255, .18);
  overflow-y: auto;
}

/* 右側のシェル：サイドバー分だけ左を空ける */
.app-shell { margin-left: var(--sidebar-w); min-height: 100vh; }

.app-header {
  position: sticky; top: 0; z-index: 30;
  height: var(--header-h);
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 0 clamp(20px, 3vw, 34px);
  background: linear-gradient(180deg, #17181b 0%, #1b1c22 60%, #1f1c25 100%);
  border-bottom: 1px solid #2a2c34;
}
.page-title { margin: 0; font-size: 15px; font-weight: 800; letter-spacing: .02em; color: var(--text); }

.app-main {
  max-width: var(--content-max); margin: 0 auto;
  padding: clamp(18px, 2.6vw, 30px) clamp(20px, 2.2vw, 40px) 60px;
}
```

> **サイドバーに影は付けません。** PC の常時表示では `box-shadow` を切り、`border-right: 1px solid rgba(255,255,255,.18)` の細い明るい線だけで境界を作ります（本体アプリと同じ挙動）。

### 3-3. サイドバーの中身

```css
.sidebar-head {
  display: flex; align-items: center; gap: 12px;
  padding: 6px 4px 16px; margin-bottom: 6px;
}
.brand-mark {
  display: grid; place-items: center; flex: none;
  width: 38px; height: 38px; border-radius: 12px; color: #fff;
  background: rgba(255, 255, 255, .22);
}
.sidebar-ver { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
.ver-main { font-size: 17px; font-weight: 800; letter-spacing: .06em; color: #fff; }
.ver-sub  { font-size: 11px; font-weight: 600; letter-spacing: .04em; color: rgba(255,255,255,.82); margin-top: 2px; }

.sidebar-nav { display: flex; flex-direction: column; gap: 4px; }
.nav-item {
  display: flex; align-items: center; gap: 12px;
  width: 100%; padding: 13px 14px; border: none; border-radius: 12px;
  background: none; color: rgba(255, 255, 255, .9);
  font: inherit; font-size: 15px; font-weight: 700; text-align: left;
  cursor: pointer; transition: .16s;
}
.nav-ico { width: 20px; height: 20px; flex: none; opacity: .9; }
.nav-item:hover  { background: rgba(255, 255, 255, .15); color: #fff; }
.nav-item.active {
  background: rgba(255, 255, 255, .24); color: #fff;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .28);
}
.nav-item.active .nav-ico { opacity: 1; }
```

**ルール**
- ナビ項目は**アイコン（20px, stroke 2, `currentColor`）＋ラベル**の 2 要素固定。
- アクティブは「白 24% の面 + 内側 1px の白枠」。**文字色だけで表さない**。
- サイドバー内は**白系の文字のみ**（`--text` ではなく `#fff` / `rgba(255,255,255,.9)`）。地が独自のグラデーションなので、本文用トークンを持ち込まないこと。
- 本体アプリのメニューは **録音 / 履歴 / 設定 / マニュアル** の4項目。

### 3-4. 画面切り替え

```css
.screen { display: none; }
.screen.active { display: block; animation: fade .22s ease; }
@keyframes fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
```

```js
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => {
      const on = b === btn;
      b.classList.toggle('active', on);
      on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current');
    });
    const id = btn.dataset.target;
    document.querySelectorAll('.screen').forEach(s => {
      const on = s.id === id;
      s.classList.toggle('active', on); s.hidden = !on;
    });
    document.querySelector('.page-title').textContent = btn.dataset.title || btn.textContent.trim();
    window.scrollTo({ top: 0 });
  });
});
```

### 3-5. 画面幅への対応

```css
/* 狭い画面ではアイコンのみのレールに縮小（左固定は維持） */
@media (max-width: 900px) {
  :root { --sidebar-w: 72px; }
  .sidebar { padding: 18px 10px 14px; align-items: center; }
  .nav-item { justify-content: center; padding: 13px 0; }
  .nav-item span, .sidebar-ver { display: none; }
  .meta-grid { grid-template-columns: 1fr; }
}
```

---

## 4. コンポーネント

### 4-1. パネル（すべての土台）

半透明＋ブラーで背景を透かします。**入れ子にしない**こと。
枠線はダークでは `#ffffff 8%` 程度の**ごく淡い白**を混ぜ、上面のふちだけを光らせます。

```css
.panel {
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  border: 1px solid color-mix(in srgb, #ffffff 8%, var(--border));
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  padding: clamp(16px, 2.4vw, 22px);
  margin-bottom: 16px;
}
.panel:last-child { margin-bottom: 0; }
```

### 4-2. パネル内見出し

```css
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.section-title { font-size: 13.5px; font-weight: 800; color: var(--text); display: inline-flex; align-items: center; gap: 6px; }
.section-title .btn-ico { width: 17px; height: 17px; color: var(--brand1); }
.mini-label { font-size: 12.5px; color: var(--muted); font-weight: 700; }
.card-note { margin: 0 0 12px; font-size: 12.5px; color: var(--muted); line-height: 1.6; }
```

### 4-3. ボタン

| クラス | 用途 | 形 |
|---|---|---|
| `.primary-btn` | 主アクション（1画面に1〜2個） | ブランドグラデ塗り・白文字 |
| `.secondary-btn` | 副アクション | `--surface-2` の面＋枠線 |
| `.chip-btn` | 補助操作 | 角丸ピル（999px） |
| `.export-btn` | 書き出し系の並列ボタン群 | 角丸 12px・アイコン+ラベル |
| `.link-btn` | 見出し横の軽い操作 | 枠なしテキスト |
| `.wide-btn` | 「追加してください」系の空状態 | 全幅・**破線**の枠 |
| `.icon-btn` | カード内の削除等 | 正方形アイコンのみ |

```css
.primary-btn, .secondary-btn {
  display: inline-flex; align-items: center; gap: 7px;
  border-radius: var(--radius-sm); padding: 12px 20px;
  font: inherit; font-size: 14.5px; font-weight: 700; cursor: pointer; transition: .16s;
}
.primary-btn {
  background: linear-gradient(135deg, var(--brand1), var(--brand2));
  color: var(--brand-ink); border: none;
  box-shadow: 0 8px 18px color-mix(in srgb, var(--brand1) 30%, transparent);
}
.primary-btn:hover { transform: translateY(-1px); box-shadow: 0 12px 24px color-mix(in srgb, var(--brand1) 40%, transparent); }

.secondary-btn { background: var(--surface-2); color: var(--text); border: 1px solid var(--border-strong); }
.secondary-btn:hover { border-color: var(--brand1); color: var(--brand1); transform: translateY(-1px); }

.chip-btn {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--surface-2); border: 1px solid var(--border-strong); color: var(--text);
  border-radius: 999px; padding: 8px 14px;
  font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; transition: .16s;
}
.chip-btn:hover:not(:disabled) { border-color: var(--brand1); color: var(--brand1); transform: translateY(-1px); }
.chip-btn:disabled { opacity: .5; cursor: default; }

.export-row { display: flex; gap: 8px; flex-wrap: wrap; }
.export-heading { display: block; margin-bottom: 12px; font-size: 12.5px; font-weight: 700; color: var(--muted); }
.export-btn {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--surface-2); border: 1px solid var(--border-strong); color: var(--text);
  border-radius: var(--radius-sm); padding: 10px 15px;
  font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; transition: .16s;
}
.export-btn:hover { border-color: var(--brand1); color: var(--brand1); transform: translateY(-1px); box-shadow: var(--shadow-sm); }
.export-btn.save:hover { border-color: var(--ok); color: var(--ok); }

.link-btn {
  display: inline-flex; align-items: center; gap: 5px;
  background: none; border: none; color: var(--brand1); cursor: pointer;
  font: inherit; font-size: 12px; font-weight: 600; padding: 0;
}
.link-btn:hover { text-decoration: underline; }
.link-btn .btn-ico { width: 14px; height: 14px; }

.wide-btn {
  width: 100%; margin-top: 12px;
  background: var(--surface-2); border: 1px dashed var(--border-strong); color: var(--brand1);
  border-radius: var(--radius-sm); padding: 12px;
  font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; transition: .16s;
}
.wide-btn:hover { border-color: var(--brand1); background: color-mix(in srgb, var(--brand1) 6%, var(--surface)); }

.btn-ico { width: 15px; height: 15px; flex: none; }
.gen-row { display: flex; gap: 10px; margin-bottom: 18px; flex-wrap: wrap; }
```

**共通ルール**：hover は `translateY(-1px)` ＋ 枠線を `--brand1` に。transition は `.16s`。

### 4-4. フォーム

```css
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12.5px; color: var(--muted); font-weight: 700; }
.field-hint { margin: 2px 0 0; font-size: 11.5px; color: var(--faint); line-height: 1.5; }
.field-hint.warn { color: var(--amber); font-weight: 600; }
.field-hint.ok   { color: var(--ok); font-weight: 600; }
.settings-field { margin-bottom: 18px; }
.settings-field:last-child { margin-bottom: 0; }

select, input[type="text"], input[type="date"], input[type="email"], textarea {
  width: 100%; font: inherit; color: var(--text);
  background: var(--surface-2); border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm); padding: 11px 13px;
  transition: border-color .15s, box-shadow .15s;
}
select:hover, input:hover, textarea:hover { border-color: var(--brand1); }
select:focus, input:focus, textarea:focus {
  outline: none; border-color: var(--brand1);
  box-shadow: 0 0 0 3.5px color-mix(in srgb, var(--brand1) 18%, transparent);
}
textarea { resize: vertical; line-height: 1.75; }
.static-value {
  font-size: 14px; font-weight: 600; padding: 11px 13px;
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: var(--radius-sm); color: var(--text);
}
.meta-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; margin-bottom: 16px; }

/* ON/OFF トグル */
.switch-row {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 14px;
  cursor: pointer; font-size: 13.5px; font-weight: 700; color: var(--text);
}
.switch-row input { width: 44px; height: 26px; flex: none; margin-top: 2px; accent-color: var(--brand1); }
```

**フォーカスリングは必ず「枠線 brand1 + 3.5px の淡いリング」**。`outline: none` だけで終わらせない。

### 4-5. 状態表示（チップ + 進捗バー）

現行アプリは「大きな進捗カード」ではなく、**状態チップ＋細い進捗バーを1行に並べる**形です。

```css
.status-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.status-chip {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 12px; font-weight: 600; padding: 6px 13px; border-radius: 999px;
  background: var(--surface-2); border: 1px solid var(--border-strong); color: var(--muted);
}
.status-chip::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .55; }
.status-chip.ready   { color: var(--ok);     border-color: color-mix(in srgb, var(--ok) 40%, var(--border)); }
.status-chip.loading { color: var(--brand1); border-color: color-mix(in srgb, var(--brand1) 40%, var(--border)); }
.status-chip.working { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
.status-chip.working::before { animation: blink 1s infinite; }
.status-chip.error   { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); }
@keyframes blink { 50% { opacity: .2; } }

.progress { flex: 1; min-width: 120px; height: 8px; background: var(--surface-3); border-radius: 999px; overflow: hidden; }
.progress-bar { height: 100%; width: 0%; background: linear-gradient(90deg, var(--brand1), var(--brand2)); transition: width .2s ease; }
```

進捗率と残り時間を大きく見せたいときは、囲いのあるブロックにします。

```css
.gen-progress {
  margin: 10px 0 12px; padding: 13px 15px; border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--brand1) 10%, var(--surface-2));
  border: 1px solid color-mix(in srgb, var(--brand1) 32%, var(--border));
  animation: fade .2s ease;
}
.gen-progress .progress { width: 100%; flex: none; }
.gen-progress-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.gen-progress-label { font-size: 12.5px; font-weight: 800; color: var(--brand1); display: inline-flex; align-items: center; gap: 7px; }
.gen-progress-label::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex: none; animation: blink 1s infinite; }
.gen-progress-pct { font-size: 15px; font-weight: 800; color: var(--brand1); font-variant-numeric: tabular-nums; }
.gen-progress-eta { margin: 8px 0 0; font-size: 11.5px; font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; }
```

### 4-6. 通知ボックス（エラー / 警告 / 情報）

**3色とも同じ構造**（`色10% の地` + `色40% の枠` + `色の文字`）で作ります。

```css
.error-box {
  background: color-mix(in srgb, var(--danger) 10%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--danger) 40%, var(--border));
  color: var(--danger); border-radius: var(--radius-sm);
  padding: 11px 14px; font-size: 13.5px; margin-top: 12px;
}
.warn-box {
  background: color-mix(in srgb, var(--amber) 10%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--amber) 40%, var(--border));
  color: var(--amber); border-radius: var(--radius-sm);
  padding: 11px 14px; font-size: 13.5px; margin-top: 12px;
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
}
.info-box {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;
  background: color-mix(in srgb, var(--brand1) 8%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--brand1) 35%, var(--border));
  border-radius: var(--radius-sm); padding: 12px 14px; margin-top: 12px;
}
.info-box .info-text { display: flex; flex-direction: column; gap: 3px; font-size: 13px; color: var(--text); }
.info-box .info-text strong { font-size: 13.5px; font-weight: 800; color: var(--brand1); }
.info-box .info-text span { color: var(--muted); font-size: 12.5px; }
```

### 4-7. タグ・チップ・バッジ

```css
.tag { display: inline-flex; align-items: center; font-size: 12px; font-weight: 700; padding: 4px 11px; border-radius: 999px; letter-spacing: .02em; }
.tag-sum  { color: var(--brand1); background: color-mix(in srgb, var(--brand1) 12%, transparent); } /* 要点 */
.tag-dec  { color: var(--ok);     background: color-mix(in srgb, var(--ok) 13%, transparent); }     /* 決定事項 */
.tag-todo { color: var(--amber);  background: color-mix(in srgb, var(--amber) 15%, transparent); }  /* ToDo */

/* 状態バッジ（未処理・完了など） */
.state-badge {
  font-size: 11px; font-weight: 700; letter-spacing: .02em; padding: 3px 10px; border-radius: 999px;
  color: var(--faint); background: color-mix(in srgb, var(--faint) 14%, transparent);
}
.state-badge.hi   { color: var(--brand1); background: color-mix(in srgb, var(--brand1) 14%, transparent); }
.state-badge.warn {
  color: var(--amber); background: color-mix(in srgb, var(--amber) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--amber) 34%, transparent);
}

/* 削除できるチップ（参加者など） */
.chip {
  display: inline-flex; align-items: center; gap: 8px;
  background: color-mix(in srgb, var(--brand1) 10%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--brand1) 25%, var(--border));
  color: var(--text); border-radius: 999px; padding: 6px 8px 6px 12px;
  font-size: 12.5px; font-weight: 600;
}
.chip .dept { color: var(--brand1); }
.chip button { background: none; border: none; cursor: pointer; color: var(--muted); font-size: 15px; line-height: 1; padding: 0 2px; }
.chip button:hover { color: var(--danger); }
```

### 4-8. 一覧カード

```css
.card-list {
  list-style: none; margin: 0; padding: 0;
  display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}
.card-item {
  position: relative; display: flex; flex-direction: column; gap: 4px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 15px 16px 14px; background: var(--surface);
  box-shadow: var(--shadow-sm); cursor: pointer; transition: .16s;
}
.card-item:hover {
  border-color: color-mix(in srgb, var(--brand1) 40%, var(--border));
  box-shadow: var(--shadow-md); transform: translateY(-2px);
}
.card-item:focus-visible { outline: 2px solid var(--brand1); outline-offset: 2px; }
.card-item h3 { margin: 0; font-size: 14.5px; font-weight: 700; }
.card-item .meta { font-size: 11.5px; color: var(--faint); font-variant-numeric: tabular-nums; }
.card-item .excerpt {
  margin: 3px 0 0; font-size: 12.5px; color: var(--muted); line-height: 1.55;
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
}

/* 下段：左に統計、右に操作アイコン */
.card-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; }
.card-stats { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
.card-stats .stat {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11.5px; color: var(--faint); font-variant-numeric: tabular-nums; white-space: nowrap;
}
.card-stats .stat .btn-ico { width: 13px; height: 13px; }
.icon-btn {
  display: inline-grid; place-items: center; width: 32px; height: 32px; flex: none; padding: 0;
  background: transparent; border: 1px solid transparent; border-radius: 9px; cursor: pointer;
  color: var(--muted); transition: .16s;
}
.icon-btn .btn-ico { width: 17px; height: 17px; }
.icon-btn.accent { color: var(--brand1); }
.icon-btn.accent:hover { background: color-mix(in srgb, var(--brand1) 12%, transparent); }
.icon-btn.del { color: var(--danger); }
.icon-btn.del:hover { background: color-mix(in srgb, var(--danger) 12%, transparent); }

.list-empty { color: var(--muted); font-size: 13px; padding: 4px 2px; }
```

### 4-9. 箇条書き（要約リスト）

`<ul>` の標準マーカーは使わず、**ブランド色の小さな丸**を疑似要素で置きます。

```css
.sum-title { margin: 0 0 10px; font-size: 17px; font-weight: 800; color: var(--text); line-height: 1.4; }
.sum-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.sum-list li { position: relative; padding-left: 15px; font-size: 13.5px; line-height: 1.7; color: var(--text); }
.sum-list li::before {
  content: ""; position: absolute; left: 2px; top: .72em;
  width: 5px; height: 5px; border-radius: 50%; background: var(--brand1);
}
.sum-block { margin-top: 14px; }
.sum-block .tag { margin-bottom: 8px; }
/* 意味ごとに丸の色を変える */
.sum-block.dec  .sum-list li::before { background: var(--ok); }
.sum-block.todo .sum-list li::before { background: var(--amber); }
```

### 4-10. 折りたたみカード（設定画面のスタイル）

現行アプリの設定画面は、**カードごとに開閉**して見出しだけを並べる形です。

```css
.settings-card { padding: 0; overflow: hidden; }   /* .panel と併用 */
.settings-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  width: 100%; margin: 0; padding: clamp(14px, 2vw, 18px) clamp(16px, 2.4vw, 22px);
  background: none; border: 0; border-radius: var(--radius);
  color: var(--text); font: inherit; font-size: 14px; font-weight: 800; text-align: left;
  cursor: pointer; transition: .16s;
}
.settings-head:hover { background: color-mix(in srgb, var(--brand1) 8%, transparent); }
.settings-head:focus-visible { outline: 2px solid var(--brand1); outline-offset: -2px; }
.settings-chev { display: inline-flex; flex: none; color: var(--faint); transform: rotate(-90deg); transition: transform .2s ease, color .16s; }
.settings-chev svg { width: 17px; height: 17px; }
.settings-card.open .settings-chev { transform: rotate(90deg); color: var(--brand1); }
.settings-card.open .settings-head { border-bottom: 1px solid var(--border); border-radius: var(--radius) var(--radius) 0 0; }
.settings-body { padding: clamp(14px, 2vw, 18px) clamp(16px, 2.4vw, 22px) clamp(16px, 2.4vw, 22px); }
```

> シェブロンは**左向き `<`** の SVG（`<polyline points="15 18 9 12 15 6"/>`）を使います。
> `rotate(-90deg)` で下向き＝閉、`rotate(90deg)` で上向き＝開。右向き `>` を入れると開閉が逆に見えます。

### 4-11. テーブル

```css
.table-wrap { overflow-x: auto; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }
table.data { border-collapse: collapse; width: 100%; font-size: 12.5px; }
table.data th, table.data td { text-align: left; padding: 10px 13px; border-bottom: 1px solid var(--border); vertical-align: top; line-height: 1.5; }
table.data thead th { background: var(--brand1); color: #fff; font-weight: 700; white-space: nowrap; border-bottom: none; }
table.data td:first-child { font-weight: 700; color: var(--text); white-space: nowrap; }
table.data tbody tr:nth-child(even) { background: var(--surface-2); }
table.data tbody tr:last-child td { border-bottom: none; }
```

> ヘッダー行だけは**ブランド色ベタ塗り＋白文字**。ダーク地の中で表の範囲がはっきりします。

### 4-12. 注記ボックス・アコーディオン・ステップ

```css
.note {
  margin-top: 14px; padding: 13px 15px; font-size: 12.5px; line-height: 1.72; color: var(--muted);
  background: color-mix(in srgb, var(--brand1) 6%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--brand1) 22%, var(--border));
  border-radius: var(--radius-sm);
}
.note b { color: var(--text); }

.faq { border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: 9px; background: var(--surface-2); overflow: hidden; }
.faq summary {
  cursor: pointer; padding: 13px 15px; font-size: 13.5px; font-weight: 700; color: var(--text);
  list-style: none; display: flex; align-items: center; gap: 9px; transition: .16s;
}
.faq summary::-webkit-details-marker { display: none; }
.faq summary::before { content: "＋"; color: var(--brand1); font-weight: 700; flex: none; }
.faq[open] summary::before { content: "－"; }
.faq summary:hover { color: var(--brand1); }
.faq p { margin: 0; padding: 0 15px 14px 33px; font-size: 12.5px; color: var(--muted); line-height: 1.72; }

.toc { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.toc button {
  background: var(--surface-2); border: 1px solid var(--border-strong); color: var(--brand1);
  border-radius: 999px; padding: 7px 14px;
  font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; transition: .16s;
}
.toc button:hover { border-color: var(--brand1); background: color-mix(in srgb, var(--brand1) 8%, var(--surface)); transform: translateY(-1px); }

.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 16px; }
.steps li { display: flex; gap: 14px; align-items: flex-start; }
.step-n {
  flex: none; width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center;
  background: linear-gradient(135deg, var(--brand1), var(--brand2));
  color: #fff; font-weight: 800; font-size: 14px; font-variant-numeric: tabular-nums;
  box-shadow: 0 4px 10px color-mix(in srgb, var(--brand1) 30%, transparent);
}
.steps b { font-size: 14.5px; font-weight: 800; }
.steps p { margin: 4px 0 0; font-size: 13px; color: var(--muted); line-height: 1.7; }
.steps kbd {
  font-family: var(--mono); font-size: .85em; color: var(--text);
  background: var(--surface-2); border: 1px solid var(--border-strong); border-bottom-width: 2px;
  border-radius: 5px; padding: 1px 6px;
}

/* 定義リスト（用語 → 説明） */
.def-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
.def-list li { display: grid; grid-template-columns: 132px 1fr; gap: 14px; align-items: start; font-size: 13px; }
.def-list li b { color: var(--text); font-weight: 800; }
.def-list li span { color: var(--muted); line-height: 1.7; }
@media (max-width: 520px) { .def-list li { grid-template-columns: 1fr; gap: 3px; } }
```

### 4-13. モーダル

**PC では中央配置**（モバイルのボトムシートではなく）。

```css
.modal-overlay {
  position: fixed; inset: 0; z-index: 60;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, .58);
  opacity: 0; transition: opacity .25s ease;
}
.modal-overlay.show { opacity: 1; }
.modal-card {
  width: 100%; max-width: 540px; max-height: 88vh; overflow-y: auto;
  background: var(--surface); border: 1px solid var(--border-strong); border-radius: 20px;
  box-shadow: var(--shadow-lg); padding: 18px clamp(16px, 4vw, 24px) 20px;
  transform: translateY(24px); transition: transform .28s cubic-bezier(.22, 1, .36, 1);
}
.modal-overlay.show .modal-card { transform: translateY(0); }
.modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.modal-head h3 { margin: 0; font-size: 16px; font-weight: 800; }
.modal-close {
  width: 34px; height: 34px; font-size: 20px; line-height: 1; cursor: pointer;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; color: var(--muted);
}
.modal-close:hover { color: var(--danger); border-color: var(--danger); }
.modal-foot { margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px; }
/* セクション区切りは破線 */
.modal-section { margin-top: 18px; padding-top: 16px; border-top: 1px dashed var(--border-strong); }
```

### 4-14. ポップオーバーメニュー

```css
.menu-pop {
  position: absolute; z-index: 2;
  display: flex; flex-direction: column; gap: 2px; padding: 6px; min-width: 190px;
  background: var(--surface); border: 1px solid var(--border-strong); border-radius: 14px;
  box-shadow: var(--shadow-lg);
  opacity: 0; transform: translateY(10px) scale(.95); pointer-events: none;
  transition: opacity .2s ease, transform .28s cubic-bezier(.22, 1, .36, 1);
}
.menu-pop.show { opacity: 1; transform: none; pointer-events: auto; }
.menu-pop button {
  display: flex; align-items: center; gap: 11px; width: 100%;
  padding: 12px; border-radius: 10px; border: none; background: none; cursor: pointer;
  font: inherit; font-size: 14px; font-weight: 600; color: var(--text); text-align: left;
}
.menu-pop button svg { width: 18px; height: 18px; color: var(--muted); flex: none; }
.menu-pop button:hover { background: var(--surface-3); }
```

### 4-15. トースト

```css
.toast {
  position: fixed; left: calc(50% + var(--sidebar-w) / 2); bottom: 40px; z-index: 70;
  transform: translateX(-50%) translateY(12px);
  background: rgba(20, 24, 40, .93); color: #fff;
  padding: 10px 20px; border-radius: 999px; font-size: 13px; font-weight: 700;
  box-shadow: var(--shadow-lg); max-width: 60vw; text-align: center;
  opacity: 0; pointer-events: none;
  transition: opacity .22s ease, transform .28s cubic-bezier(.22, 1, .36, 1);
}
.toast.show { opacity: 1; transform: translateX(-50%); }
```

> 左固定サイドバーがあるので、**中央寄せは `calc(50% + var(--sidebar-w) / 2)`** です。単純な `left: 50%` だとコンテンツ領域から左にずれます。固定配置の要素はすべて同じ補正が要ります。

---

## 5. タイポグラフィ早見表

| 用途 | size | weight | color |
|---|---|---|---|
| ページタイトル（ヘッダー） | 15px | 800 | `--text` |
| 大見出し（詳細画面など） | 19px | 800 | `--text` |
| 要約タイトル `.sum-title` | 17px | 800 | `--text` |
| パネル見出し `.section-title` | 13.5px | 800 | `--text` |
| カード見出し `h3` | 14.5px | 700 | `--text` |
| 本文 | 13〜14px | 400〜600 | `--text` |
| 補足・説明文 | 12.5〜13px | 400 | `--muted` |
| ラベル `.field label` | 12.5px | 700 | `--muted` |
| ヒント `.field-hint` | 11.5px | 400 | `--faint` |
| メタ情報（日時・サイズ） | 11.5px | 400 | `--faint` ＋ `tabular-nums` |
| ナビ項目 | 15px | 700 | `#fff` |
| 長文テキストエリア | 15.5px | 400 | `--text`（`line-height: 1.9`） |

- **見出しは大きくせず、太さ（800）で差をつける**のがこの UI のトーン。
- 数字が並ぶ箇所（時刻・サイズ・％）は必ず `font-variant-numeric: tabular-nums`。
- **ダークでは細字を使わない**。`font-weight: 300` 以下は視認性が落ちるため使用しない。

---

## 6. モーション

| 対象 | 指定 |
|---|---|
| ボタン・チップの hover | `transition: .16s` ＋ `translateY(-1px)` |
| カードの hover | `translateY(-2px)` ＋ 影を `--shadow-md` へ |
| 画面切り替え | `fade .22s ease`（`opacity` + `translateY(6px)`） |
| カードの順次出現 | `opacity .5s ease, transform .55s cubic-bezier(.22,1,.36,1)`、初期 `translateY(18px)` |
| モーダル | overlay `.25s`、カード `.28s cubic-bezier(.22,1,.36,1)` |
| ポップオーバー | `opacity .2s` ＋ `transform .28s cubic-bezier(.22,1,.36,1)` |
| 点滅（処理中インジケーター） | `@keyframes blink { 50% { opacity: .2 } }` 1s |
| 点滅（案内文） | `@keyframes blinkText { 0%,100%{opacity:1} 50%{opacity:.35} }` 1.6s |

イージングは **`cubic-bezier(.22, 1, .36, 1)`** に統一（出現・スライド系）。

必ず末尾に入れる：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important; animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
```

---

## 7. アイコン

- **すべてインライン SVG**（外部読み込み禁止）。24 グリッド・線画。
  ```html
  <svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">…</svg>
  ```
- 色は必ず `currentColor`。サイズはクラスで制御：
  `.nav-ico 20px` / `.section-title .btn-ico 17px` / `.btn-ico 15px` / `.link-btn .btn-ico 14px` / `.card-stats .stat .btn-ico 13px`
- 装飾アイコンには `aria-hidden="true"`。意味を持つボタンには `aria-label` を付ける。
- **絵文字は使わない**（本体アプリも絵文字を SVG に置換済み）。

---

## 8. アクセシビリティ

- ナビは `<nav aria-label="メニュー">` の中に `<button>`。アクティブ項目に `aria-current="page"`。
- クリック可能な要素は必ず `<button type="button">` か `<a>`。`<div onclick>` は使わない。
- `:focus-visible { outline: 2px solid var(--brand1); outline-offset: 2px; }` をグローバルに設定。
- 進捗表示は `aria-live="polite"`。
- ダークでは**淡い色ほどコントラストが落ちる**ため、`--faint`（#7b818d）は 12px 未満の文字や重要な情報に使わない。

---

## 9. 実装チェックリスト（Claude Code 向け）

- [ ] 1 ファイル完結（外部 CSS / JS / 画像 / フォントへの参照ゼロ）
- [ ] `:root` に §1 のトークンをそのまま定義し、**`color-scheme: dark` を書いた**
- [ ] `body::before` の固定グラデ背景（暗い・ブランド色のにじみは .10 / .08）を入れた
- [ ] サイドバーは `position: fixed` の 288px、`.app-shell { margin-left: var(--sidebar-w) }` で本文をずらした
- [ ] サイドバーは影ではなく `border-right: 1px solid rgba(255,255,255,.18)` で区切った
- [ ] ナビのアクティブは「白 24% + 内側白枠」
- [ ] ヘッダーは `sticky top:0`、暗いグラデ＋ `border-bottom: 1px solid #2a2c34`
- [ ] 本文は `max-width: 960px` で中央寄せ、`.panel` を縦積み
- [ ] `.panel` は半透明＋ `backdrop-filter: blur(12px) saturate(140%)`、枠は `#ffffff 8%` 混色
- [ ] 入力欄は `--surface-2`（沈める）、浮かせる小要素は `--surface-3`
- [ ] 主ボタンはブランドグラデ、hover で `translateY(-1px)`
- [ ] 入力欄のフォーカスは brand1 の枠線＋3.5px リング
- [ ] `position: fixed` の中央寄せ要素は `calc(50% + var(--sidebar-w) / 2)` で補正した
- [ ] アイコンはインライン SVG（stroke-width: 2 / currentColor）、絵文字なし
- [ ] `prefers-reduced-motion` に対応した
- [ ] ライトモードは実装していない（ダーク固定）

---

## 10. 付録：本体アプリ固有のパーツ

汎用アプリには不要ですが、NOTELOOP 本体に合わせるときに参照してください。

- **マイクドック** `.mic-dock` — 画面下部中央に固定。中央に 64px の丸ボタン（`.mic-fab`、ブランドグラデ。録音中のみ `linear-gradient(135deg,#e11d48,#ff3d6b 50%,#ff8a3d)` の赤系＋点滅）、右下に 50px のツール／一時停止ボタン。
- **波形** `.wave-wrap` — 高さ 200px、`width: 100vw` で画面幅いっぱいに `<canvas>` を敷き、背景は透明のまま線だけ描く。
- **Claudeカード** `.claude-card` — Claude連携部分だけ配色を茶系に変える（`border-color: #4a3a30` / 地 `linear-gradient(180deg,#26211e,#221e1b)` / バッジとボタン `#d97757→#c15f3c` / 見出しは Georgia 系セリフ体）。
- **出力枠の展開ツールバー** `.out-tools` — テキストエリア右下の丸ボタンを押すと、機能ボタンが左へ時間差（.02s → .30s）で展開する。
- **タップの波** `.tap-wave` — 押した位置からブランド色の円が広がる（`* { -webkit-tap-highlight-color: transparent }` とセット）。

---

## 11. 参照元

| ファイル | 内容 |
|---|---|
| `styles.css` | 全トークン・コンポーネントの原典 |
| `index.html` | 画面構成（録音 / 履歴 / 設定 / マニュアル）とマークアップ規約 |
| `styles.css` の `@media (min-width: 1024px)` ブロック | 本体アプリの PC 左固定サイドバー実装 |
| `docs/pc-ui-starter.html` | 本仕様を実装した **PC 用ひな形**（コピーして中身を差し替える） |
