// app.js — NoteLoop メインロジック
// 録音（MediaRecorder + Web Audio）→ ブラウザ内 Whisper 文字起こし（worker.js）
//   ・録音中: 軽量モデルで暫定表示（ライブ）
//   ・停止後: 音声全体を高精度モデルで再処理して確定版に置き換え（精度重視）
// → 議事録整形（簡易ロジック / 差し替え可）→ txt / md / docx / メール / 音声 出力
'use strict';

const $ = (id) => document.getElementById(id);

/* ===== インラインSVGアイコン（絵文字を使わず、アプリUIに統一） ===== */
const SVG_ATTR = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICO_DOWNLOAD   = `<svg class="btn-ico" ${SVG_ATTR}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
const ICO_MUSIC      = `<svg class="btn-ico" ${SVG_ATTR}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
const ICO_TRASH      = `<svg class="btn-ico" ${SVG_ATTR}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
const ICO_COPY       = `<svg class="btn-ico" ${SVG_ATTR}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>`;
const ICO_TERM       = `<svg class="btn-ico" ${SVG_ATTR}><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>`;
const ICO_EDIT       = `<svg class="btn-ico" ${SVG_ATTR}><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`;
const ICO_REDO       = `<svg class="btn-ico" ${SVG_ATTR}><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>`;
const ICO_ARROW_UP   = `<svg class="btn-ico" ${SVG_ATTR}><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
const ICO_DOC        = `<svg class="btn-ico" ${SVG_ATTR}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>`;
const ICO_MD         = `<svg class="btn-ico" ${SVG_ATTR}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 17v-4l2 2 2-2v4"/></svg>`;
const ICO_WORD       = `<svg class="btn-ico" ${SVG_ATTR}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13l1.5 4L11 13l1.5 4L14 13"/></svg>`;
const ICO_CHEVRON    = `<svg ${SVG_ATTR}><polyline points="15 18 9 12 15 6"/></svg>`;
const ICO_CLOCK      = `<svg class="btn-ico" ${SVG_ATTR}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
const ICO_DISC       = `<svg class="btn-ico" ${SVG_ATTR}><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>`;

/* ===== 要素 ===== */
const recordBtn      = $('recordBtn');
const pauseBtn       = $('pauseBtn');
const recHint        = $('recHint');
const capturedHint   = $('capturedHint');
const timerEl        = $('timer');
const wave           = $('wave');
const waveWrap       = $('waveWrap');
const statusBar      = $('statusBar');
const transcriptPanel= $('transcriptPanel');
const idlePrompt     = $('idlePrompt');
const modelStatus    = $('modelStatus');
const progressWrap   = $('progressWrap');
const progressBar    = $('progressBar');
const cancelProcBtn  = $('cancelProcBtn');
const errorBox       = $('errorBox');
const notifyWarn     = $('notifyWarn');
const notifyWarnText = $('notifyWarnText');
const notifyWarnBtn  = $('notifyWarnBtn');
const audioWrap      = $('audioWrap');
const player         = $('player');
const audioSize      = $('audioSize');
const audioWarn      = $('audioWarn');
const downloadAudio  = $('downloadAudio');
const liveTranscript = $('liveTranscript');
const clearTranscript= $('clearTranscript');
// 録音中のリアルタイム表示
const liveNowPanel   = $('liveNowPanel');
const liveNowText    = $('liveNowText');
// 録音停止後のAI議事録作成（画面上部の進捗バー＋完了までの目安時間）
const aiFlowProgress = $('aiFlowProgress');
const aiFlowBar      = $('aiFlowBar');
const aiFlowPct      = $('aiFlowPct');
const aiFlowLabel    = $('aiFlowLabel');
const aiFlowEta      = $('aiFlowEta');
// 引き下げてリセット
const ptrEl          = $('ptr');
const ptrCircle      = $('ptrCircle');

const LANGUAGE       = 'japanese';   // 日本語固定
const engineSelect   = $('engineSelect');
const engineHint     = $('engineHint');
const whisperSettings= $('whisperSettings');
const backendSelect  = $('backendSelect');
const backendHint    = $('backendHint');
const accuracyModel  = $('accuracyModel');
const modelWarn      = $('modelWarn');
const liveEnabled    = $('liveEnabled');
const liveHint       = $('liveHint');
const keepAwake      = $('keepAwake');

// マイク選択 / 入力レベル
const homeActions         = $('homeActions');
const openMicSelect       = $('openMicSelect');
const micRecNote          = $('micRecNote');
const micSelectHome       = $('micSelectHome');
const micSelectSettings   = $('micSelectSettings');
const micMeterHomeMask    = $('micMeterHomeMask');
const micMeterSettingsMask= $('micMeterSettingsMask');
const micPermNoteHome     = $('micPermNoteHome');
const micPermNoteSettings = $('micPermNoteSettings');

const meetingName    = $('meetingName');
const meetingDate    = $('meetingDate');
const speakerLabels  = $('speakerLabels');
const toastEl        = $('toast');

// 旧「議事録を貼り付け／編集」欄の内容。画面からは外したが、履歴に残っている
// 要点／決定事項／ToDo を書き出し・メールに使えるよう、状態としては保持する。
let legacyMinutes = { summary: [], decisions: [], todos: [] };

const historyList    = $('historyList');
const screenTitle    = $('screenTitle');

// メール
const mailTo = $('mailTo'), mailSubject = $('mailSubject'), mailBody = $('mailBody');
const mailThunderbird = $('mailThunderbird'), mailEml = $('mailEml'), mailCopy = $('mailCopy');
// 用語辞書
const termModal = $('termModal'), termModalClose = $('termModalClose'), termModalDone = $('termModalDone');
const termWrong = $('termWrong'), termRight = $('termRight'), termApply = $('termApply'), termRegister = $('termRegister'), termApplyAll = $('termApplyAll');
const termDictList = $('termDictList'), termFoundNote = $('termFoundNote');
// 設定: 変換辞書（読み → 漢字）
const dictAuto = $('dictAuto'), dictFrom = $('dictFrom'), dictTo = $('dictTo'), dictAdd = $('dictAdd');
const dictList = $('dictList'), dictNote = $('dictNote'), dictApplyNow = $('dictApplyNow');

const aiAudioSend          = $('aiAudioSend');
const aiAudioCopy          = $('aiAudioCopy');
const aiAudioStatus        = $('aiAudioStatus');
const aiAudioOpen          = $('aiAudioOpen');
const aiAudioPreview       = $('aiAudioPreview');
const geminiInstruction    = $('geminiInstruction');
const geminiInstructionReset = $('geminiInstructionReset');
const geminiApiKey         = $('geminiApiKey');
const geminiModel          = $('geminiModel');
const geminiKeyStatus      = $('geminiKeyStatus');
const aiAutoAfterStop      = $('aiAutoAfterStop');
const geminiKeyReveal      = $('geminiKeyReveal');
const geminiKeyTest        = $('geminiKeyTest');
const geminiKeyTestStatus  = $('geminiKeyTestStatus');
const geminiUsageBox       = $('geminiUsageBox');
const geminiUsageCount     = $('geminiUsageCount');
const geminiUsageFill      = $('geminiUsageFill');
const geminiUsageDetail    = $('geminiUsageDetail');
const aiAutoStatus         = $('aiAutoStatus');
const aiResultWrap         = $('aiResultWrap');
const aiResult             = $('aiResult');

const drawerVerMain  = $('drawerVerMain');
const drawerVerSub   = $('drawerVerSub');
const partDept       = $('partDept');
const partDeptOther  = $('partDeptOther');
const partName       = $('partName');
const partAdd        = $('partAdd');
const partList       = $('partList');
const meetingModal   = $('meetingModal');
const meetingModalClose = $('meetingModalClose');
const meetingModalDone  = $('meetingModalDone');
const meetingSummary = $('meetingSummary');

// バージョン / 更新日（メニュー上部に表示）
const APP_VERSION = 'Ver.8.5';
// 更新時間は手動指定せず、配信ファイルの最終更新（document.lastModified）から自動算出する。
// （手動だと実時刻より先の時間になり得るため）
function computeUpdatedString() {
  try {
    const d = new Date(document.lastModified);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${hh}:${mm}`;
    }
  } catch (_) { /* フォールバックへ */ }
  return '2026.7.30';
}
const APP_UPDATED = computeUpdatedString();

let participants = [];   // { dept, name }
let sttActivity = 0;     // Web Speech 用の波の活性度

/* ===== 状態 ===== */
const SAMPLE_RATE = 16000;
const CHUNK_MIN_SEC = 5;          // ライブは 5 秒ためてから送る（文脈が増え誤認識が減る）
const LIVE_INTERVAL_MS = 3000;
const MAX_LIVE_BACKLOG_SEC = 8;   // ライブの未処理音声の上限（超過分は捨てる＝確定パスで再処理）
const LIVE_SILENCE_RMS = 0.006;   // これ未満のチャンクは無音とみなし送らない（hasSpeech で使用）

// 録音の分割保存・見張り（画面オフ中に録音が止まる問題への対策）
const REC_TIMESLICE_MS = 3000;    // この間隔でエンコード済みデータを取り出す（＝取りこぼしを最小化）
const REC_WATCH_MS = 4000;        // 録音が生きているかを確認する間隔
const REC_STALL_MS = 12000;       // この時間データが来なければ「止まった」と判断して録り直す

let recording = false;
let paused = false;               // 録音の一時停止中
let pausedAt = 0;                 // 一時停止を始めた時刻（epoch ms）
let pausedTotalMs = 0;            // 一時停止していた合計時間（経過時間から差し引く）
let mediaStream = null;
let mediaRecorder = null;
let recordedBlobs = [];           // 現在のセグメントのチャンク
let recordedSegments = [];        // 復帰・マイク切替で分割された確定セグメント（Blob）
let recordChunkAt = 0;            // 最後にチャンクを受け取った時刻（停止検知用）
let recordWatchTimer = null;
let recordStalled = false;        // 録音が止まっていると判断中か（通知に警告を出す）
let recordRecoverCount = 0;       // 録音を自動で復帰させた回数
// セグメント結合の結果（停止後の警告で「何本中何本を繋げたか」を知らせるため）
let segmentReport = { total: 0, merged: 0, failed: 0 };
// 録音時間に対して音声が短かったときの記録（AI議事録にも「一部しか含まれない」と添えるため）
let audioShortfall = null;
// 実際にデータが届いていた時間の合計（ミリ秒）。経過時間との差が「録れていない時間」。
let capturedMs = 0;
let recordRestarting = false;     // 復帰処理中（見張りの多重実行を防ぐ）
let recordedDurationSec = 0;      // 保存された音声の実長（秒）
let recStartedAt = 0;             // 録音を始めた時刻（epoch ms）。議事録に実時間を出すのに使う。
let recordedBlob = null;
let aiFlowRunning = false;        // 録音停止後のAI処理（文字起こし＋議事録）が動いているか
let aiAutoRunning = false;        // AI議事録の作成中（手動実行を含む）
let aiTextRunning = false;        // AI文字起こしの実行中（手動実行を含む）
let audioCtx = null;
let sourceNode = null;
let processorNode = null;
let analyser = null;
let rafId = null;
let liveTimer = null;
let startTime = 0;
let timerInterval = null;
let procTimer = null;   // 高精度処理の経過時間表示

// ライブ文字起こし用の PCM バッファ
let pendingChunks = [];
let liveResampleAcc = 0;  // ライブPCMを16kHzへリサンプルする際の端数キャリー
let workerBusy = false;
let reqId = 0;

// エンジン / Web Speech API
let activeEngine = 'whisper';   // 録音開始時に確定（互換用: Web Speech ライブ時は 'webspeech'）
let liveMode = 'off';           // 録音中のライブ表示: 'webspeech' | 'off'
let confirmMode = 'none';       // 停止後の確定文字起こし: 'none'(→Gemini) | 'whisper'
let activeDevice = 'wasm';      // Whisper の実行バックエンド（webgpu / wasm）— 録音開始時に確定

// タッチ端末（スマホ／タブレット）判定。モバイルのWebGPUはWhisper推論で
// createBuffer 失敗などの不具合が出やすいため、自動選択では使わない。
const IS_TOUCH_DEVICE = (navigator.maxTouchPoints || 0) > 0 &&
  !(window.matchMedia && window.matchMedia('(pointer:fine)').matches);

/**
 * WebGPU が実際に使えるか判定する。
 * pref: 'auto'（PCのみ webgpu / モバイルは wasm）/ 'webgpu'（強制・不可なら wasm）/ 'wasm'（強制）
 * 戻り値は 'webgpu' か 'wasm'。実際の初期化・推論失敗時は worker 側でも wasm へ自動フォールバックする。
 */
async function resolveDevice(pref) {
  if (pref === 'wasm') return 'wasm';
  if (!('gpu' in navigator) || !navigator.gpu) return 'wasm';
  // 自動選択のときは、モバイルGPUのWebGPUは不安定なため WASM を使う。
  // （WebGPUを試したい場合は設定で「WebGPU固定」を明示的に選ぶ）
  if (pref === 'auto' && IS_TOUCH_DEVICE) return 'wasm';
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter ? 'webgpu' : 'wasm';
  } catch (_) {
    return 'wasm';
  }
}
let recognition = null;
let sttBase = '';       // 録音開始時点の既存テキスト
let sttSegs = [];       // 確定済みセグメント（過去の認識インスタンス分）
let sttCurFinal = '';   // 現インスタンスの確定分
let lastSttTs = 0;      // 直近に認識結果を受け取った時刻（見張り用）
let lastSttKick = 0;    // 直近に認識を作り直した時刻

/* =========================================================
 * 画面切り替え（ハンバーガー → 左ドロワー）
 * =======================================================*/
const menuToggle = $('menuToggle');
const drawer = $('drawer');
const drawerBackdrop = $('drawerBackdrop');
const drawerItems = Array.from(document.querySelectorAll('.drawer-item'));

function openDrawer() {
  drawer.classList.add('open');
  drawerBackdrop.hidden = false;
  requestAnimationFrame(() => drawerBackdrop.classList.add('show'));
  menuToggle.setAttribute('aria-expanded', 'true');
}
function closeDrawer() {
  drawer.classList.remove('open');
  drawerBackdrop.classList.remove('show');
  menuToggle.setAttribute('aria-expanded', 'false');
  setTimeout(() => { if (!drawer.classList.contains('open')) drawerBackdrop.hidden = true; }, 640);
}
menuToggle.addEventListener('click', () => {
  drawer.classList.contains('open') ? closeDrawer() : openDrawer();
});
drawerBackdrop.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
drawerItems.forEach((it) => it.addEventListener('click', () => {
  showScreen(it.dataset.target, it.dataset.title);
  if (it.dataset.scroll) {
    // 「議事録」などフローカードへ移動する導線: 内容があればカードを出してからスクロール
    if (liveTranscript.value.trim() || recordedBlob) revealFlowCards();
    if (it.dataset.scroll === 'mailPanel') prepareMailFromMinutes();
    scrollToEl(it.dataset.scroll);
  }
  closeDrawer();
}));

/** 指定IDの要素まで滑らかにスクロール */
function scrollToEl(id) {
  const el = document.getElementById(id);
  if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}

/* =========================================================
 * 録音後のカード群（#homeFlow）の置き場所
 *   録音画面と履歴の詳細で同じUIを使い回すため、DOMごと移動させる。
 *   複製しないので、既存のイベント・状態はそのまま引き継がれる。
 * =======================================================*/
/** カード群を履歴の詳細内へ移す */
function moveFlowToHistory() {
  const flow = $('homeFlow'), slot = $('historyDetailSlot');
  if (flow && slot && flow.parentElement !== slot) slot.appendChild(flow);
}
/** カード群を録音画面へ戻す（履歴を離れるとき・新しい録音を始めるとき） */
function moveFlowToHome() {
  const flow = $('homeFlow'), home = $('screen-home'), anchor = $('idlePrompt');
  if (!flow || !home || flow.parentElement === home) return;
  if (anchor && anchor.parentElement === home) home.insertBefore(flow, anchor);
  else home.appendChild(flow);
}
/** 履歴：一覧に戻る（詳細を閉じ、カード群を録音画面へ返す） */
function closeHistoryDetail() {
  const listView = $('historyListView'), detail = $('historyDetail');
  moveFlowToHome();
  if (detail) detail.hidden = true;
  if (listView) listView.hidden = false;
}

function showScreen(id, title) {
  // 履歴の詳細を開いたまま他の画面へ移ると、カード群が履歴側に取り残される
  if (id !== 'screen-history') closeHistoryDetail();
  document.querySelectorAll('.screen').forEach((s) => {
    const active = s.id === id;
    s.classList.toggle('active', active);
    s.hidden = !active;
  });
  drawerItems.forEach((b) => b.classList.toggle('active', b.dataset.target === id));
  if (title) screenTitle.textContent = title;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (id === 'screen-home') { updateHomeUI(); refreshAudioPanel(); }
  // 設定画面の「マイク」カードを開いている間だけ入力レベルを表示する
  if (id === 'screen-settings' && isSettingsSectionOpen('マイク')) activateSettingsMic();
  else if (typeof settingsMicMeter !== 'undefined') settingsMicMeter.stop();
}

/** 録音音声の再生カードを表示／非表示（音声ができてから表示する） */
function setAudioAvailable(has) {
  if (audioWrap) audioWrap.hidden = !has;
}
function refreshAudioPanel() { setAudioAvailable(!!recordedBlob); }

/* =========================================================
 * 録音後の段階フロー（カードをフェードインで順に出現）
 *   ・状態はメモリのみ。ページ再読込では復元されず、録音待機画面に戻る。
 * =======================================================*/
const audioFlowCard  = $('audioPanel');
const aiTextCard     = $('aiTextCard');
const minutesFlowCard= $('minutesFlowCard');
const mailFlowCard   = $('mailPanel');

/** 議事録・メールなど「AIの出力が入る欄」に中身があるか */
function hasVal(id) { const el = document.getElementById(id); return !!(el && el.value && el.value.trim()); }

/**
 * カードと「そのカードを出してよいか（出力ができたか）」の対応。
 * 中身ができるまでは出さず、できた順に1枚ずつフェードインさせる。
 */
function flowSteps() {
  return [
    { el: audioFlowCard,   ready: () => !!recordedBlob },
    { el: transcriptPanel, ready: () => !recording && hasVal('liveTranscript') },
    { el: aiTextCard,      ready: () => hasVal('aiText') },
    { el: minutesFlowCard, ready: () => hasVal('aiResult') },
    { el: mailFlowCard,    ready: () => hasVal('mailBody') || hasVal('mailSubject') },
  ].filter((st) => st.el);
}
function flowCardList() { return flowSteps().map((st) => st.el); }

/** すべてのフローカードを隠して初期状態へ戻す（新規録音・クリア・再読込時） */
function resetFlowCards() {
  flowCardList().forEach((c) => { c.hidden = true; c.classList.remove('revealed'); revealedCards.delete(c); });
}

/**
 * 出力ができたカードだけを表示する。
 * 新しく出るカードは1枚ずつ時間差でフェードインする。
 * 何度呼んでも、すでに出したカードには触らない（表示中に再生成が走っても点滅しない）。
 */
const revealedCards = new WeakSet();
function syncFlowCards() {
  refreshAudioPanel();
  let n = 0;
  for (const st of flowSteps()) {
    if (!st.ready()) {
      st.el.hidden = true;
      st.el.classList.remove('revealed');
      revealedCards.delete(st.el);
      continue;
    }
    if (revealedCards.has(st.el)) continue;
    revealedCards.add(st.el);
    st.el.hidden = false;
    st.el.classList.remove('revealed');
    // 表示（display 復帰）を確定させてからトランジションを始める
    setTimeout(((el) => () => el.classList.add('revealed'))(st.el), 60 + n * 150);
    n++;
  }
}

/** 履歴からの表示など、演出なしで一括表示したいとき */
function revealFlowCards() { syncFlowCards(); }

/* =========================================================
 * ホーム画面の表示状態（最小構成: 待機はマイクと点滅案内のみ）
 * =======================================================*/
let homeProcessing = false;
function updateHomeUI() {
  const hasText = liveTranscript.value.trim().length > 0;
  const hasAudio = !!recordedBlob;
  // 文字起こし中はゲージを1本（進捗バー）だけにするため、波形は録音中のみ表示。
  const showWave = recording;

  waveWrap.hidden = !showWave;
  timerEl.hidden = !recording;
  idlePrompt.hidden = recording || homeProcessing || hasText || hasAudio;
  // マイク選択・編集バー: 録音中、または待機（結果なし）のときに表示
  if (homeActions) homeActions.hidden = !(recording || (!homeProcessing && !hasText && !hasAudio));
  // 録音中のリアルタイム表示は、これまでどおり録音中はそのまま出す（カードにしない）
  if (liveNowPanel) liveNowPanel.hidden = !recording;
  // カードは中身（出力）ができてから、できた順に出す
  syncFlowCards();
  transcriptPanel.classList.toggle('fade-old', homeProcessing); // 文字起こし中は上側を薄く
  if (recording) renderLiveNow();
  updateRecFrame();
  updateFabState();

  if (showWave) startWave(); else stopWave();
}

/** 録音中の見た目（経過時間の色など）を切り替える */
function updateRecFrame() {
  document.body.classList.toggle('is-recording', recording);
}

/**
 * 録音中のリアルタイム文字起こし表示を更新する。
 * 直近の1行を濃く、それ以前を薄く表示し、常に最新行までスクロールする。
 * 録音モード（ライブ字幕OFF）のときは、文字が出ない理由をそのまま案内する。
 */
function renderLiveNow() {
  if (!liveNowText) return;
  const raw = liveTranscript.value.trim();
  if (!raw) {
    // 準備中は「点滅する文字＋3点アニメーション」で、動いていることが見て分かるようにする
    const prep = (msg) =>
      `<span class="live-prep"><span class="prep-text">${msg}</span>`
      + '<span class="prep-dots" aria-hidden="true"><i></i><i></i><i></i></span></span>';
    liveNowText.innerHTML =
      liveMode === 'webspeech' ? prep('リアルタイム文字起こしを準備中')
    : liveMode === 'native'    ? (liveWhisperFailed
        ? '<span class="live-wait">録音中の文字起こしを準備できませんでした。<strong>録音は続いています</strong>。停止後に全体をAIが文字起こし・議事録化します。</span>'
        : prep(`リアルタイム文字起こしを準備中（${LIVE_UPDATE_SEC}秒ごとに更新）`))
    :                            '<span class="live-wait">録音モードのため、録音中の文字起こしは行いません。停止後にAIが文字起こし＋議事録を作成します（設定でライブ字幕モードに変更できます）。</span>';
    return;
  }
  const lines = raw.split('\n').filter((l) => l.trim());
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  liveNowText.innerHTML = lines
    .map((l, i) => `<div class="live-line${i === lines.length - 1 ? ' now' : ''}">${esc(l)}</div>`)
    .join('');
  liveNowText.scrollTop = liveNowText.scrollHeight;
}

/**
 * 録音ボタンの段階変化: 録音 → 待機。
 *   ・「議事録を作成」「メールを作成」ボタンは廃止（AIが自動で作るため押す必要がない）。
 *   ・文字起こし・AI議事録の作成中は読込ボタンを出さず、ボタン自体を隠す
 *     （進み具合は画面上部の総合ゲージ1本だけで伝える）。
 *   ・作成が終わったらボタンは消し、画面最下部までスクロールしたときだけ出す。
 */
function updateFabState() {
  const busy = homeProcessing || aiFlowRunning || aiAutoRunning || aiTextRunning;
  if (busy && !recording) {
    recordBtn.hidden = true;
    if (pauseBtn) pauseBtn.hidden = true;
    recHint.hidden = true;
    updateOutToolsBusy();
    return;
  }
  recordBtn.hidden = false;

  const state = recording ? 'recording' : 'idle';
  recordBtn.dataset.state = state;
  recordBtn.disabled = false;
  updateOutToolsBusy();   // AI処理中は枠内の「作り直す」を押せないようにする
  const arias = { idle: '録音開始', recording: '録音停止' };
  recordBtn.setAttribute('aria-label', arias[state]);

  // 録音後（結果が出ている待機中）は、最下部までスクロールしたときだけ録音ボタンを出す
  const done = (state === 'idle') && hasSessionResult();
  const away = done && !atPageBottom();
  recordBtn.classList.toggle('fab-away', away);

  // ボタンの下の案内文。録音ボタンが見えているときだけ、その真下に出す。
  // （ボタンが隠れているときの案内バッジは、内容に重なって読みにくいので出さない）
  let hint = '';
  if (state === 'recording') hint = paused ? '一時停止中… タップで録音完了' : '録音中… タップで停止';
  else if (done && !away) hint = 'タップで新しい録音（今の内容は履歴に残ります）';
  const hintText = document.getElementById('recHintText') || recHint;
  if (hintText.textContent !== hint) hintText.textContent = hint;
  recHint.hidden = !hint;
  recHint.classList.toggle('steady', done);
  recHint.classList.remove('low');
  updatePauseUI();
}

/** 一時停止ボタン（録音中だけ右下に出す）と、一時停止中の見た目を更新 */
function updatePauseUI() {
  if (!pauseBtn) return;
  pauseBtn.hidden = !recording;
  pauseBtn.dataset.paused = paused ? '1' : '0';
  pauseBtn.setAttribute('aria-label', paused ? '録音を再開' : '録音を一時停止');
  recordBtn.dataset.paused = (recording && paused) ? '1' : '0';
  if (waveWrap) waveWrap.dataset.paused = (recording && paused) ? '1' : '0';
  document.body.classList.toggle('is-paused', recording && paused);
}

/** 録音・文字起こし・議事録のいずれかの結果が画面にあるか */
function hasSessionResult() {
  return !!recordedBlob
    || liveTranscript.value.trim().length > 0
    || !!(aiResultEl() && aiResultEl().value.trim());
}
/** #aiResult は後方で宣言されるため、参照は関数越しに行う */
function aiResultEl() { return document.getElementById('aiResult'); }

/** 画面の最下部まで来ているか（数pxの余裕を持たせる） */
function atPageBottom() {
  const doc = document.documentElement;
  const max = Math.max(doc.scrollHeight, document.body.scrollHeight);
  return (window.innerHeight + window.scrollY) >= (max - 28);
}
// 最下部までスクロールで録音ボタンが出現、上へ戻すと消える。
// スクロール中に毎回レイアウトを測ると重いので、1フレームに1回へまとめる。
let fabScrollRaf = 0;
function scheduleFabUpdate() {
  if (fabScrollRaf) return;
  fabScrollRaf = requestAnimationFrame(() => { fabScrollRaf = 0; updateFabState(); });
}
window.addEventListener('scroll', scheduleFabUpdate, { passive: true });
window.addEventListener('resize', scheduleFabUpdate);

/* =========================================================
 * Web Worker（Whisper）
 * =======================================================*/
let worker;
let finalResolve = null;   // 高精度パス完了を待つ Promise
let finalCanceled = false; // 高精度パスがユーザーによって中止されたか
let finalErrored = false;  // 高精度パスがエラー（モデルDL失敗など）で終わったか

function handleWorkerMessage(e) {
  const msg = e.data || {};
  switch (msg.type) {
    case 'progress':
      // 録音中のライブ用モデルの読み込みは画面に出さない（準備できたら勝手に始まる）
      if (liveWhisperOn && !finalResolve) break;
      if (msg.data && typeof msg.data.progress === 'number') { lastDlProgress = performance.now(); setModelLoading(msg.data.progress); }
      break;
    case 'ready':
      if (msg.device) activeDevice = msg.device;
      if (liveWhisperOn && !finalResolve) break;   // 同上（読み込み完了も出さない）
      setStatus('ready', 'モデル準備完了' + (msg.device === 'webgpu' ? '（WebGPU）' : ''));
      break;
    case 'fallback':
      // WebGPU 初期化に失敗 → WASM(CPU) へ自動フォールバック
      activeDevice = 'wasm';
      showError('WebGPU を初期化できなかったため、CPU（WASM）処理に切り替えました。設定でバックエンドを「WASM固定」にすると次回から高速に開始できます。');
      break;
    case 'result':
      if (msg.device) activeDevice = msg.device;
      if (msg.mode === 'final') {
        // 高精度パスの結果で置き換え（反復除去＋句点で改行）
        if (msg.text) liveTranscript.value = formatTranscript(cleanupTranscript(msg.text));
        if (finalResolve) { finalResolve(); finalResolve = null; }
      } else {
        // ライブ（暫定）結果を追記
        workerBusy = false;
        if (msg.text) appendTranscript(cleanupTranscript(msg.text));
        maybeSendChunk(false);
      }
      break;
    case 'error':
      if (msg.mode === 'final') {
        // 高精度パスの失敗（多くはモデルDLのネットワークエラー）。
        // メッセージは runFinalPass 側で分かりやすく案内する。
        finalErrored = true;
        if (finalResolve) { finalResolve(); finalResolve = null; }
      } else {
        workerBusy = false;
        // 録音中のライブ表示は、失敗しても録音・停止後の文字起こしには影響しない。
        // エラー表示で画面を埋めず、その場に一度だけ案内する。
        if (liveWhisperOn) {
          liveWhisperFailed = true;
          renderLiveNow();
        } else {
          showError('文字起こしエラー: ' + msg.message);
        }
      }
      break;
  }
}

function createWorker() {
  worker = new Worker('./worker.js', { type: 'module' });
  worker.onmessage = handleWorkerMessage;
}
createWorker();

/** 実行中の高精度文字起こしを中止する（Worker を作り直して推論を止める） */
function cancelFinalPass() {
  finalCanceled = true;
  workerBusy = false;
  try { worker.terminate(); } catch (_) {}
  createWorker();               // 次回のためにまっさらな Worker を用意
  if (finalResolve) { finalResolve(); finalResolve = null; }
}
if (cancelProcBtn) cancelProcBtn.addEventListener('click', cancelFinalPass);

function setModelLoading(progress) {
  setStatus('loading', 'モデル読み込み中…');
  progressWrap.hidden = false;
  progressBar.style.width = Math.max(2, Math.min(100, progress)).toFixed(0) + '%';
}
function setStatus(kind, text) {
  modelStatus.textContent = text;
  modelStatus.className = 'status-chip' + (kind ? ' ' + kind : '');
  if (kind === 'ready') progressWrap.hidden = true;
  statusBar.hidden = !kind; // 待機（kind='')のときは非表示
}

/* =========================================================
 * 録音中の通知（画面オフでも継続・通知から停止できる）
 *   Service Worker の showNotification で常駐通知を表示し、
 *   通知の「停止」アクション → SW → ページへ postMessage で停止操作を伝える。
 * =======================================================*/
const NOTIF_TAG = 'noteloop-recording';
let notifLastSec = -1;

async function ensureNotifyPermission() {
  // アプリ版は録音サービス側の通知（経過時間＋音量ゲージ）を使うので、
  // Web 側の通知は出さない（同じ「録音中」が二重に並んでしまうため）。
  if (NATIVE) return false;
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try { return (await Notification.requestPermission()) === 'granted'; } catch (_) { return false; }
}

/** 通知のゲージに使う、いまのマイク入力レベル（0〜1） */
function notifInputLevel() {
  if (analyser) {
    try {
      analyser.getByteTimeDomainData(waveBuf);
      let s = 0;
      for (let i = 0; i < waveBuf.length; i++) { const x = (waveBuf[i] - 128) / 128; s += x * x; }
      return Math.min(1, Math.max(0, Math.sqrt(s / waveBuf.length) - 0.012) * 7);
    } catch (_) {}
  }
  if (activeEngine === 'webspeech') return Math.min(1, sttActivity);
  return 0.25;
}

/**
 * 通知の左に置くゲージ（バー5本）。
 * アプリ内のゲージと同じく、声が大きいほど高く伸び、1本ずつばらばらに揺れる。
 */
let notifPhase = 0;
function notifGauge() {
  const GLYPH = '▁▂▃▄▅▆▇█';
  if (paused) return '▁▁▁▁▁';
  const amp = 0.30 + notifInputLevel() * 0.70;
  let out = '';
  for (let i = 0; i < 5; i++) {
    const wob = 0.5 + 0.5 * Math.sin(notifPhase * 1.1 + i * 1.25);
    out += GLYPH[Math.floor(Math.min(0.999, 0.06 + amp * wob) * GLYPH.length)];
  }
  return out;
}

/**
 * 録音中の常駐通知を表示／更新（elapsed は "00:12" 形式）。
 * 「左にゲージ・続けて録音時間・操作は一時停止と録音完了」の並びにそろえてある
 * （アプリ版はネイティブ側の通知が同じ体裁で出る）。
 */
async function showRecordingNotification(elapsed, stalled) {
  if (!('serviceWorker' in navigator)) return;
  if (!(await ensureNotifyPermission())) return;
  const time = elapsed || '00:00';
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(
      stalled ? `⚠ 録音を再開中　${time}` : `${notifGauge()}　${time}`, {
      body: stalled
        ? '音声が取り込めていません。画面を点けてアプリを前面に戻してください。'
        : paused ? 'NOTELOOP — 一時停止中。再開すると続きから録音します。'
                 : 'NOTELOOP — 録音中。画面を消しても録音は続きます。',
      tag: NOTIF_TAG, renotify: false, silent: true, requireInteraction: true,
      icon: './icons/icon-192.png', badge: './icons/badge-mic.png',
      actions: paused
        ? [{ action: 'resume', title: '▶ 再開' }, { action: 'stop', title: '■ 録音完了' }]
        : [{ action: 'pause', title: '❚❚ 一時停止' }, { action: 'stop', title: '■ 録音完了' }],
      data: { type: 'recording', paused },
    });
  } catch (_) { /* 通知非対応でも録音は継続 */ }
}

/** 録音通知を消す */
async function clearRecordingNotification() {
  notifLastSec = -1;
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const ns = await reg.getNotifications({ tag: NOTIF_TAG });
    ns.forEach((n) => n.close());
  } catch (_) {}
}

// 通知のアクションから送られてくるメッセージで録音を操作する
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    const t = e.data && e.data.type;
    if (!recording) return;
    if (t === 'stop-recording') stopRecording();
    else if (t === 'pause-recording') setPaused(true);
    else if (t === 'resume-recording') setPaused(false);
  });
}

/* ===== 画面の常時オン（Wake Lock） ===== */
let wakeLock = null;
const WAKE_KEY = 'noteloop_keep_awake';
/** 設定がONなら録音中に画面が消えないようロックを取得（対応ブラウザのみ） */
async function acquireWakeLock() {
  if (!keepAwake || !keepAwake.checked) return;
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; }); // 画面非表示等で自動解放される
  } catch (_) { wakeLock = null; }
}
async function releaseWakeLock() {
  try { if (wakeLock) await wakeLock.release(); } catch (_) {}
  wakeLock = null;
}

/* ===== バックグラウンド録音の維持（無音再生 + MediaSession） =====
 * スマホでは画面を消すとページが凍結され、録音（MediaRecorder / 音声認識）が
 * 止まってしまう。これを防ぐため、録音中は「ほぼ無音」の音声をループ再生して
 * メディアセッションを「再生中」に保つ。ブラウザはメディアを再生している
 * タブを凍結しないため、画面を消しても録音が継続する。
 * （Wake Lock は画面を点けたままにするだけで、電源ボタンで消すと解放される） */
let silentAudioEl = null;
let silentAudioUrl = null;
/** ほぼ無音（-90dBFS 相当・実質的に聞こえない）の WAV を生成して再生用URLを返す。
 *  完全な無音（全サンプル0）は一部ブラウザで「再生していない」と判定されるため、
 *  極小振幅の信号を入れて確実に再生中と認識させる。 */
function makeSilentWavUrl(seconds, sampleRate) {
  seconds = seconds || 2;
  sampleRate = sampleRate || 8000;
  const frames = seconds * sampleRate;
  const dataSize = frames * 2; // 16bit mono
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const ws = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE');
  ws(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); ws(36, 'data'); view.setUint32(40, dataSize, true);
  for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, (i % 2 === 0) ? 1 : -1, true); // ±1/32768 ≒ 無音
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/** MediaSession をセットして、ロック画面等に録音中の表示と停止操作を出す */
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    if (typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: '● 録音中 — NOTELOOP',
        artist: '画面を消しても録音は続きます',
        album: 'NOTELOOP',
      });
    }
    navigator.mediaSession.playbackState = 'playing';
    const stop = () => { if (recording) stopRecording(); };
    navigator.mediaSession.setActionHandler('stop', stop);
    navigator.mediaSession.setActionHandler('pause', stop);
    navigator.mediaSession.setActionHandler('play', () => { resumeBackgroundKeepAlive(); });
  } catch (_) { /* 非対応でも録音は継続 */ }
}

/** 録音開始時に呼ぶ（ユーザー操作直後に再生を開始する必要がある） */
function startBackgroundKeepAlive() {
  try {
    if (!silentAudioEl) {
      silentAudioUrl = makeSilentWavUrl();
      silentAudioEl = new Audio(silentAudioUrl);
      silentAudioEl.loop = true;
      silentAudioEl.setAttribute('playsinline', '');
      // バックグラウンドで一時停止されたら（録音中なら）すぐ再生し直す
      silentAudioEl.addEventListener('pause', () => { if (recording) resumeBackgroundKeepAlive(); });
    }
    const p = silentAudioEl.play();
    if (p && p.catch) p.catch(() => {}); // 自動再生拒否でも録音自体は継続
  } catch (_) {}
  setupMediaSession();
}

/** 画面復帰時などに、無音再生が止まっていたら再開する */
function resumeBackgroundKeepAlive() {
  if (!recording || !silentAudioEl) return;
  try { if (silentAudioEl.paused) { const p = silentAudioEl.play(); if (p && p.catch) p.catch(() => {}); } } catch (_) {}
  try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; } catch (_) {}
}

/** 録音停止時に呼ぶ */
function stopBackgroundKeepAlive() {
  try { if (silentAudioEl) silentAudioEl.pause(); } catch (_) {}
  try {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'none';
      ['stop', 'pause', 'play'].forEach((a) => { try { navigator.mediaSession.setActionHandler(a, null); } catch (_) {} });
    }
  } catch (_) {}
}

/* =========================================================
 * 録音の実体（MediaRecorder）の管理
 *   画面を消すとブラウザがタブを絞る／音声処理を止めることがあり、
 *   「タイマーは進んでいるのに音声が数分しか残っていない」事故が起きる。
 *   対策として
 *     ・一定間隔（REC_TIMESLICE_MS）でデータを取り出し、常に手元に確定させる
 *     ・録音が止まっていないか見張り、止まったら録り直して継ぎ足す
 *     ・停止時に「経過時間」と「音声の実長」を比べ、足りなければ警告する
 *   の3段構えにしている。
 * =======================================================*/

/**
 * ストリームから録音を開始する（1セグメント分）。
 * timeslice 付きで start するため ondataavailable が定期的に呼ばれ、
 * 途中でタブが落ちても直前までの音声が手元に残る。
 * チャンクの入れ物はレコーダーごとに持たせ、録り直しの前後で混ざらないようにする。
 */
function startSegmentRecorder(stream) {
  if (!stream) return null;
  const mime = pickAudioMime();
  let rec = null;
  try {
    rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  } catch (_) {
    try { rec = new MediaRecorder(stream); } catch (_2) { return null; }
  }
  const chunks = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      const now = Date.now();
      // 実際に録れている時間を積む。チャンクが届いた区間だけを数えるので、
      // 端末に録音を止められていた時間は加算されない（＝経過時間との差が欠落）。
      if (recordChunkAt) capturedMs += Math.min(now - recordChunkAt, REC_TIMESLICE_MS * 2);
      chunks.push(e.data);
      recordChunkAt = now;
    }
  };
  rec.onerror = () => { recordChunkAt = 0; }; // 見張り側で録り直す
  try { rec.start(REC_TIMESLICE_MS); }
  catch (_) { try { rec.start(); } catch (_2) { return null; } }
  rec._chunks = chunks;
  recordedBlobs = chunks;   // 現在のセグメントのチャンク列
  recordChunkAt = Date.now();
  return rec;
}

/** 現在のセグメントを閉じて recordedSegments に積む（データは失わない） */
async function sealCurrentSegment() {
  const rec = mediaRecorder;
  mediaRecorder = null;
  if (rec && rec.state !== 'inactive') {
    await new Promise((resolve) => {
      let done = false;
      const fin = () => { if (!done) { done = true; resolve(); } };
      rec.onstop = fin;
      setTimeout(fin, 2500); // 応答が無くても先に進む（停止処理を止めない）
      try { rec.stop(); } catch (_) { fin(); }
    });
  }
  // 停止待ちの間に届いたチャンクも含めて、ここで確定させる
  const chunks = (rec && rec._chunks) || recordedBlobs;
  if (chunks && chunks.length) {
    recordedSegments.push(new Blob(chunks, { type: chunks[0].type || 'audio/webm' }));
  }
  recordedBlobs = [];
}

/**
 * 録音が止まっていないか見張る。
 * データが来ない／マイクが切れた／MediaRecorder が死んだ場合は、
 * マイクを取り直して録音を再開し、音声を継ぎ足す（画面オフからの復帰も想定）。
 */
function startRecordWatchdog() {
  stopRecordWatchdog();
  recordWatchTimer = setInterval(() => { recordWatchdogTick(); }, REC_WATCH_MS);
}
function stopRecordWatchdog() {
  if (recordWatchTimer) { clearInterval(recordWatchTimer); recordWatchTimer = null; }
}

async function recordWatchdogTick() {
  if (!recording || paused || recordRestarting) return;   // 一時停止中は「止まっている」のが正常
  // 画面オフ中に止められがちなものを、まず起こし直す
  try { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); } catch (_) {}
  resumeBackgroundKeepAlive();

  const track = mediaStream ? (mediaStream.getAudioTracks()[0] || null) : null;
  const micDead = !track || track.readyState === 'ended';
  const recDead = !mediaRecorder || mediaRecorder.state === 'inactive';
  const stalled = !recordChunkAt || (Date.now() - recordChunkAt > REC_STALL_MS);

  if (!micDead && !recDead && !stalled) {
    if (recordStalled) { recordStalled = false; notifLastSec = -1; } // 復帰したので通知を戻す
    return;
  }
  recordStalled = true;
  notifLastSec = -1; // 次の tick で「⚠」付き通知に差し替える
  await restartRecordSegment(micDead);
}

/**
 * 録音を録り直す。mic を取り直す必要があれば取り直し、
 * 新しいセグメントとして録音を続ける（停止時に1本へ結合する）。
 */
async function restartRecordSegment(reacquireMic) {
  if (recordRestarting) return false;
  recordRestarting = true;
  try {
    await sealCurrentSegment();
    if (!recording) return false;

    if (reacquireMic) {
      const old = mediaStream;
      let fresh = null;
      try { fresh = await getMicStream(); } catch (_) { fresh = null; }
      if (!fresh) return false;      // 取り直せない（権限喪失等）→ 次の tick で再挑戦
      mediaStream = fresh;
      if (old) { try { old.getTracks().forEach((t) => t.stop()); } catch (_) {} }
      connectMicSource(mediaStream); // 波形・レベル表示を新しいマイクへ繋ぎ直す
    }

    mediaRecorder = startSegmentRecorder(mediaStream);
    if (mediaRecorder) {
      recordRecoverCount++;
      recordStalled = false;
      return true;
    }
    return false;
  } catch (_) {
    return false;
  } finally {
    recordRestarting = false;
  }
}

/**
 * 停止時に、全セグメントから再生・保存用の1本の音声を作る。
 * 分割が無ければそのまま（m4a/webm のまま）。分割があった場合は
 * 各セグメントをデコードして 16kHz モノラル WAV に繋ぎ直す
 * （コンテナが別々のため単純連結では再生できないため）。
 */
async function finalizeRecordedAudio() {
  // 見張りによる録り直しが進行中なら、終わるまで少し待つ（取りこぼし防止）
  for (let i = 0; i < 30 && recordRestarting; i++) await new Promise((r) => setTimeout(r, 100));
  await sealCurrentSegment();
  const segs = recordedSegments.filter((b) => b && b.size > 0);
  recordedSegments = [];
  segmentReport = { total: segs.length, merged: segs.length, failed: 0 };
  if (!segs.length) return null;
  if (segs.length === 1) return segs[0];
  try {
    return await mergeSegmentsToWav(segs);
  } catch (err) {
    console.warn('[NoteLoop] セグメントを結合できませんでした', err);
    // 結合に失敗したら、いちばん長い（大きい）セグメントを残す。
    // 残りは捨てることになるので、警告で必ず知らせる。
    segmentReport = { total: segs.length, merged: 1, failed: segs.length - 1 };
    return segs.reduce((a, b) => (b.size > a.size ? b : a), segs[0]);
  }
}

/**
 * 複数セグメントを 16kHz モノラル WAV 1本へ結合。
 * 長時間の録音でも重くならないよう、デコードした区間はすぐ 16bit に落とし、
 * 連結は Blob に任せる（巨大な連続バッファを作らない）。
 */
async function mergeSegmentsToWav(segs) {
  const parts = [];
  let frames = 0;
  segmentReport = { total: segs.length, merged: 0, failed: 0 };
  for (const s of segs) {
    try {
      const f32 = await decodeTo16kMono(s);
      if (!f32 || !f32.length) { segmentReport.failed++; continue; }
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) {
        const v = Math.max(-1, Math.min(1, f32[i]));
        i16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      parts.push(i16);
      frames += i16.length;
      segmentReport.merged++;
    } catch (err) {
      // 黙って捨てると「なぜか短い音声」だけが残り、原因が分からなくなる。
      // 数を控えて、停止後の警告で必ず知らせる。
      segmentReport.failed++;
      console.warn('[NoteLoop] セグメントをデコードできませんでした', err);
    }
  }
  if (!parts.length) throw new Error('結合できる音声がありませんでした');
  return new Blob([wavHeader(frames, SAMPLE_RATE), ...parts], { type: 'audio/wav' });
}

/** 16bit モノラル WAV の44バイトヘッダを作る */
function wavHeader(frames, sampleRate) {
  const dataSize = frames * 2;
  const view = new DataView(new ArrayBuffer(44));
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE');
  ws(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ws(36, 'data'); view.setUint32(40, dataSize, true);
  return view;
}

/**
 * 音声ファイルの実際の長さ（秒）を調べる。
 * MediaRecorder の webm は duration が入っていないことがあるため、
 * その場合は末尾へシークして確定させる（取得できなければ 0）。
 */
function probeDurationSec(blob) {
  return new Promise((resolve) => {
    if (!blob) return resolve(0);
    const url = URL.createObjectURL(blob);
    const el = document.createElement('audio');
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { el.removeAttribute('src'); el.load(); } catch (_) {}
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(v) && v > 0 ? v : 0);
    };
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) return finish(el.duration);
      el.ontimeupdate = () => { if (Number.isFinite(el.duration) && el.duration > 0) finish(el.duration); };
      try { el.currentTime = 1e7; } catch (_) { finish(0); } // 末尾シークで duration を確定させる
    };
    el.onerror = () => finish(0);
    setTimeout(() => finish(el.duration), 8000); // 取れないまま待ち続けない
    el.src = url;
  });
}

/** 秒を「20分34秒」形式に（1分未満は「45秒」） */
function formatDurationJp(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  return m ? `${m}分${String(s % 60).padStart(2, '0')}秒` : `${s}秒`;
}

function clearAudioWarning() {
  if (!audioWarn) return;
  audioWarn.hidden = true;
  audioWarn.textContent = '';
}

/**
 * 「経過時間」と「保存された音声の長さ」を比べ、明らかに足りなければ警告する。
 * 録音が途中で止まっていたことに気づけないまま会議が終わる、という事故を防ぐのが目的。
 */
function showAudioShortfallWarning(wallSec, audioSec) {
  clearAudioWarning();
  if (!audioWarn) return;
  const recovered = recordRecoverCount > 0
    ? `録音が途切れたため ${recordRecoverCount} 回自動で録り直しました。` : '';
  // 結合できなかったセグメントがある＝その分の音声は失われている。
  // 原因が「端末が録音を止めた」のか「結合に失敗した」のかで対処が違うので、必ず区別して伝える。
  const dropped = segmentReport.failed > 0
    ? `録音は ${segmentReport.total} 本に分かれ、うち ${segmentReport.failed} 本を音声として読み込めませんでした（その分は失われています）。` : '';
  // 20秒以上・かつ1割以上足りないときを「欠落」とみなす。
  // 以前は「1分以上の録音」に限っていたため、短い録音での欠落を見逃していた。
  const missing = audioSec ? wallSec - audioSec : 0;
  if (!audioSec || missing < 20 || audioSec >= wallSec * 0.9) {
    if (recovered || dropped) { audioWarn.textContent = `⚠ ${dropped}${recovered}`; audioWarn.hidden = false; }
    return;
  }
  audioShortfall = { wallSec, audioSec }; // AI議事録側でも注意を出す
  audioWarn.textContent =
    `⚠ 録音時間は ${formatDurationJp(wallSec)} ですが、保存された音声は ${formatDurationJp(audioSec)} でした。` +
    `${dropped}${recovered}` +
    `画面を消している間に、ブラウザ（または端末の省電力機能）が録音を止めた可能性があります。` +
    `設定の「録音中は画面を常時オン」をON、端末のバッテリー最適化からブラウザを除外し、` +
    `録音中は他のアプリに切り替えないようにすると安定します。` +
    `長い会議では、端末を充電しながら画面を点けたままにすると確実です。`;
  audioWarn.hidden = false;
}

/* =========================================================
 * 録音
 * =======================================================*/
recordBtn.addEventListener('click', async () => {
  const st = recordBtn.dataset.state;
  if (st === 'recording') return stopRecording();
  if (st === 'processing' || st === 'loading') return;
  // 前回の結果が残っているときは、そのまま新しい録音を始める（結果は履歴に残る）
  if (hasSessionResult()) resetSession({ silent: true });
  return startRecording();
});

/* =========================================================
 * 一時停止 / 再開
 *   録音・ライブ文字起こし・経過時間をまとめて止め、再開時は続きから録る。
 *   アプリ版はサービス側（RecordingService）が音声の一時停止を担当する。
 * =======================================================*/
if (pauseBtn) pauseBtn.addEventListener('click', () => setPaused(!paused));

/** 録音開始からの経過ミリ秒（一時停止していた分は差し引く） */
function elapsedMs() {
  if (!startTime) return 0;
  const base = paused ? pausedAt : Date.now();
  return Math.max(0, base - startTime - pausedTotalMs);
}

async function setPaused(next) {
  next = !!next;
  if (!recording || paused === next) return;
  paused = next;

  if (paused) {
    pausedAt = Date.now();
    if (NATIVE) await nativePauseResume(true);
    else {
      try { if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.pause(); } catch (_) {}
    }
    if (liveMode === 'webspeech') stopWebSpeech();   // 確定分をコミットして認識を終える
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  } else {
    pausedTotalMs += Date.now() - pausedAt;
    pausedAt = 0;
    if (NATIVE) await nativePauseResume(false);
    else {
      try { if (mediaRecorder && mediaRecorder.state === 'paused') mediaRecorder.resume(); } catch (_) {}
      recordChunkAt = Date.now();   // 見張りに「止まっていた」と誤解させない
    }
    if (liveMode === 'webspeech') beginRecognition();
  }

  updateFabState();     // 案内文と一時停止ボタンの見た目
  updateTimer();
  // 一時停止中は経過秒が進まないので、切り替えた瞬間に通知を出し直しておく
  const el = Math.floor(elapsedMs() / 1000);
  notifLastSec = el;
  showRecordingNotification(`${String(Math.floor(el / 60)).padStart(2, '0')}:${String(el % 60).padStart(2, '0')}`, false);
}

/** アプリ版: 録音サービスへ一時停止／再開を伝える */
async function nativePauseResume(wantPause) {
  const rec = nativeRecorder();
  const fn = rec && (wantPause ? rec.pause : rec.resume);
  if (typeof fn !== 'function') {
    // 一時停止に対応していない版のアプリ（更新前）でも、操作だけは元へ戻す
    showError('この版のアプリは録音の一時停止に対応していません。アプリを更新してください。');
    paused = !wantPause;
    return;
  }
  try { await fn.call(rec); } catch (err) {
    showError('録音の一時停止に失敗しました: ' + ((err && err.message) || err));
    paused = !wantPause;
  }
}

/* =========================================================
 * ネイティブ録音（Androidアプリ版）
 *   フォアグラウンドサービスで録るため、画面を消しても
 *   他のアプリに切り替えても OS に録音を止められない。
 *   ブラウザで開いた場合は NATIVE=false となり、従来どおり MediaRecorder を使う。
 * =======================================================*/
const NATIVE = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function'
  && window.Capacitor.isNativePlatform());
function nativeRecorder() {
  return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Recorder) || null;
}
let nativeRecordingPath = null;

/** ネイティブ録音を開始。成功したら true */
async function startNativeRecording() {
  const rec = nativeRecorder();
  if (!rec) { showError('録音機能を利用できません（アプリの更新が必要かもしれません）。'); return false; }
  try {
    const r = await rec.start();
    nativeRecordingPath = (r && r.path) || null;
    warnIfNotificationsBlocked(); // 通知が切られていると録音中の表示が出ない
    return true;
  } catch (err) {
    const msg = (err && (err.message || err.errorMessage)) || String(err);
    showError('録音を開始できませんでした: ' + msg);
    return false;
  }
}

/**
 * 通知が許可されていないと、録音中の通知（ロック画面の表示・停止ボタン）が
 * どこにも出ない。録音は続くが気づけないので、その場で案内する。
 */
async function warnIfNotificationsBlocked() {
  const rec = nativeRecorder();
  if (!rec || typeof rec.getNotificationState !== 'function') return;
  try {
    const s = await rec.getNotificationState();
    if (s && s.enabled && s.channelEnabled) { hideNotifyWarn(); return; }
    showNotifyWarn(s && !s.enabled
      ? 'このアプリの通知が許可されていないため、録音中の通知（ロック画面の表示・停止ボタン）が出ません。録音は続いています。'
      : '通知チャンネル「録音」がオフになっているため、録音中の通知が出ません。録音は続いています。');
  } catch (_) { /* 取得できない版では何も出さない */ }
}

function showNotifyWarn(msg) {
  if (!notifyWarn) return;
  notifyWarnText.textContent = msg;
  notifyWarn.hidden = false;
}
function hideNotifyWarn() { if (notifyWarn) notifyWarn.hidden = true; }

if (notifyWarnBtn) {
  notifyWarnBtn.addEventListener('click', async () => {
    const rec = nativeRecorder();
    if (!rec || typeof rec.openNotificationSettings !== 'function') return;
    try { await rec.openNotificationSettings(); } catch (_) {}
  });
}

/** ネイティブ録音を停止し、録れた音声を Blob で返す */
async function stopNativeRecording() {
  const rec = nativeRecorder();
  if (!rec) return null;
  try {
    const r = await rec.stop();
    nativeRecordingPath = (r && r.path) || nativeRecordingPath;
    if (!r || !r.url) return null;
    // base64 でブリッジを渡すと長時間録音で破綻するので、
    // WebView から読める URL 経由で Blob として取り込む
    const res = await fetch(r.url);
    const blob = await res.blob();
    return blob && blob.size > 0 ? new Blob([blob], { type: r.mimeType || 'audio/mp4' }) : null;
  } catch (err) {
    showError('録音の取り込みに失敗しました: ' + ((err && err.message) || err));
    return null;
  }
}

async function startRecording() {
  hideError();
  closeHistoryDetail(); // 履歴を見ていた場合はカード群を録音画面へ戻す
  resetFlowCards(); // 新しい録音: 前回の段階カードを一旦すべて隠す
  paused = false; pausedAt = 0; pausedTotalMs = 0; notifLastSec = -1;
  resetAiFlowProgress(); // 前回のAI議事録の進捗表示が残っていたら消す
  // 入力レベルメーターがマイクを掴んでいたら解放してから録音を開始
  if (typeof homeMicMeter !== 'undefined') homeMicMeter.stop();
  if (typeof settingsMicMeter !== 'undefined') settingsMicMeter.stop();
  acquireWakeLock(); // 設定がONなら画面を常時オンに（ユーザー操作の直後に要求）
  startBackgroundKeepAlive(); // 画面を消してもページが凍結されないよう無音を再生（ユーザー操作直後に開始）
  ensureNotifyPermission(); // 画面オフ中の常駐通知に備えて通知許可を先に取得

  confirmMode = (engineSelect.value === 'whisper') ? 'whisper' : 'none';
  resetSpeakers();   // 話者の判別は録音ごとにやり直す
  const speechAvailable = !!getSR();
  liveMode = (liveEnabled.checked && speechAvailable) ? 'webspeech' : 'off';
  activeEngine = (liveMode === 'webspeech') ? 'webspeech' : 'whisper'; // 互換（onSpeechEnd 等）

  recordedBlobs = [];
  recordedSegments = [];
  recordedBlob = null;
  recordedDurationSec = 0;
  clearAudioWarning();
  recordChunkAt = 0;
  recordStalled = false;
  recordRecoverCount = 0;
  recordRestarting = false;
  segmentReport = { total: 0, merged: 0, failed: 0 };
  audioShortfall = null;
  capturedMs = 0;

  // === ネイティブ録音（アプリ版）===
  // マイクはサービス側が握るので、WebView 側では getUserMedia を開かない
  // （同時に掴むと機種によっては録音が失敗するため）。波形表示も行わない。
  if (NATIVE) {
    if (!(await startNativeRecording())) return;
    liveMode = 'off';
    activeEngine = 'whisper';
    recording = true;
    pendingChunks = [];
    setAudioAvailable(false);
    sttActivity = 0.2;
    // ライブ文字起こしがONなら、録音サービスの音声をそのまま文字にする
    // （マイクは1つしか開かないので録音は止まらない）
    if (liveEnabled && liveEnabled.checked && await startNativeLiveTranscribe()) liveMode = 'native';
    setStatus('', '');   // 録音中はバッジを出さない
    updateHomeUI();
    startTime = Date.now();
    recStartedAt = startTime;
    updateTimer();
    timerInterval = setInterval(updateTimer, 250);
    return;
  }

  // === ライブ字幕モード（Web Speech）＋ 音声録音を並行 ===
  // 先に録音用マイクを確保（getUserMedia → MediaRecorder）してから認識を開始する。
  // AudioContext は認識を阻害しうるため使わず、MediaRecorder で直接録音する
  // （軽量にして Web Speech と共存させる）。録音に失敗しても字幕は継続する。
  if (liveMode === 'webspeech') {
    try {
      mediaStream = await getMicStream();
      recordedBlobs = [];
      mediaRecorder = startSegmentRecorder(mediaStream);
    } catch (_) { mediaStream = null; mediaRecorder = null; } // 録音不可でも字幕は続行

    const ok = startWebSpeech();
    if (!ok) { liveMode = 'off'; activeEngine = 'whisper'; } // 認識を開始できない → 録音のみ

    recording = true;
    pendingChunks = [];
    setAudioAvailable(false);
    sttActivity = 0.4;
    setStatus('', '');   // 録音中はバッジを出さない
    updateHomeUI();
    startTime = Date.now();
    recStartedAt = startTime;
    updateTimer();
    timerInterval = setInterval(updateTimer, 250);
    if (mediaRecorder) startRecordWatchdog(); // 画面オフ中に録音が止まったら録り直す
    return;
  }

  // === 録音モード（音声保存 → 停止後に 音声→Gemini / Whisper）===
  try {
    mediaStream = await getMicStream();
  } catch (err) {
    if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
      showError('マイクの使用が許可されませんでした。ブラウザのマイク権限を許可してください（HTTPS または localhost が必要です）。');
    } else if (err && err.name === 'NotFoundError') {
      showError('マイクが見つかりませんでした。マイクが接続されているか確認してください。');
    } else {
      showError('マイクを利用できません: ' + (err && err.message ? err.message : err));
    }
    return;
  }

  // 確定に Whisper を使う場合のバックエンドを確定
  activeDevice = await resolveDevice(backendSelect ? backendSelect.value : 'auto');

  // MediaRecorder はマイクのストリームから直接録音する。
  // （以前は AudioContext の合流点を経由していたが、画面を消すと AudioContext が
  //   止められて無音・途切れの原因になっていたため、経路から外した）
  mediaRecorder = startSegmentRecorder(mediaStream);

  // Web Audio は波形表示のためだけに使う。止まっても録音そのものには影響しない。
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    connectMicSource(mediaStream);
  } catch (_) { audioCtx = null; analyser = null; }

  recording = true;
  pendingChunks = [];
  setAudioAvailable(false);
  sttActivity = 0.2;
  setStatus('', '');   // 録音中はバッジを出さない
  updateHomeUI();
  startTime = Date.now();
  recStartedAt = startTime;
  updateTimer();
  timerInterval = setInterval(updateTimer, 250);
  if (mediaRecorder) startRecordWatchdog(); // 画面オフ中に録音が止まったら録り直す
}

async function stopRecording() {
  // 経過時間は一時停止を解く前に確定させる（一時停止していた分は含めない）
  const recordedElapsedMs = elapsedMs();
  recording = false;
  paused = false; pausedAt = 0;
  updatePauseUI();
  recHint.hidden = true;
  timerEl.hidden = true;
  updateRecFrame();

  clearInterval(timerInterval);
  clearInterval(liveTimer); liveTimer = null;
  stopRecordWatchdog();
  clearRecordingNotification();
  releaseWakeLock();
  stopBackgroundKeepAlive();

  if (liveMode === 'webspeech') stopWebSpeech();
  if (liveWhisperOn) stopNativeLiveTranscribe();   // アプリ版のライブ文字起こしを終える

  // 経過時間（実際に録っていたはずの長さ）
  const wallSec = Math.round(recordedElapsedMs / 1000);

  // 録音した音声を確定（復帰で分割された場合は1本へ結合）
  // アプリ版はサービスが1本のファイルに録り続けているので、そのまま受け取る。
  recordedBlob = NATIVE ? await stopNativeRecording() : await finalizeRecordedAudio();
  if (recordedBlob) {
    recordedDurationSec = await probeDurationSec(recordedBlob);
    player.src = URL.createObjectURL(recordedBlob);
    audioSize.textContent = recordedDurationSec
      ? `${formatDurationJp(recordedDurationSec)} ・ ${formatBytes(recordedBlob.size)}`
      : formatBytes(recordedBlob.size);
    showAudioShortfallWarning(wallSec, recordedDurationSec);
    setAudioAvailable(true);
    downloadAudio.disabled = false;
    // 保存ボタンに実際の拡張子を表示
    downloadAudio.innerHTML = `${ICO_DOWNLOAD} ${extFromMime(recordedBlob.type)}で保存`;
  }
  teardownAudio();

  // ★ まず「録音音声＋会議情報」を履歴へ保存（文字起こしの成否に関わらずデータを残す）。
  activeRecordingId = null;
  finalCanceled = false;
  if (recordedBlob) await saveRecordingNow();

  const gotLiveText = liveTranscript.value.trim().length > 0;
  // このあと Gemini へ自動で投げるか（Whisper のフォールバックを省く判断に使う）
  const willAutoAi = isAiAutoAfterStop() && !!recordedBlob && !!loadGeminiKey();
  if (confirmMode === 'whisper' && recordedBlob) {
    // 設定で「停止後に Whisper で文字起こし」→ 音声全体を再処理して確定版に置き換え
    hideError();
    setStatus('working', '音声から文字起こし中…');
    await runFinalPass(recordedBlob);
  } else if (!gotLiveText && recordedBlob && !willAutoAi) {
    // ライブ文字が無い（Web Speech 非対応・オフライン・無音）→ 最低限 Whisper で一度だけ出す。
    // ただし直後に音声をそのまま Gemini へ送る場合は省く。同じ音声を二重に処理することになり、
    // 初回は Whisper モデルのダウンロード待ちで自動生成が大幅に遅れるため。
    hideError();
    setStatus('working', '音声から文字起こし中…');
    await runFinalPass(recordedBlob);
  } else {
    // Web Speech のライブ文字をそのまま確定として使う（高精度化は「音声をAIに送る」で）
    // 完了バッジは出さない（このあとの進捗バーだけで状況が分かる）
    setStatus('', '');
    updateHomeUI();
  }
  checkTerms(); // 登録用語（会社名など）が含まれていれば確認ポップアップ
  // 文字起こし結果を履歴エントリへ追記（無ければ新規作成）
  await finalizeRecordingSave();
  // 録音後のフロー: 録音音声・議事録・AI・書き出し・メールのカードを段階的に出現
  if (recordedBlob || liveTranscript.value.trim()) {
    revealFlowCards(true);
    // AIに自動で投げる場合は、画面上部の進捗バー（完了までの目安時間）が見えるように先頭へ。
    // そうでなければ、これまでどおり文字起こしまで送る。
    if (willAutoAi) window.scrollTo({ top: 0, behavior: 'smooth' });
    else scrollToEl('transcriptPanel');
  }
  updateHomeUI();

  // 設定がONなら、そのまま Gemini に投げて議事録＋メール文面まで自動生成する。
  // 失敗しても録音・文字起こし・履歴は上で確定済みなので、ここでは待つだけでよい。
  if (willAutoAi) {
    // 完了バッジは出さず、画面上部の進捗バー（＋完了までの目安時間）と
    // 録音ボタン位置の読込アニメーションだけで進み具合を伝える。
    startAiFlowProgress();
    try {
      // 先に「文字起こしだけ」を作る（録音中の表示と読み比べられるように）。
      setAiFlowStage('AIが文字起こし中…');
      await runAiTranscribe({ auto: true });
      setAiFlowStage('AIが議事録を作成中…');
      const ok = await runAiAutoMinutes({ auto: true });
      endAiFlowProgress(ok);
    } catch (_) {
      endAiFlowProgress(false);
    }
    updateHomeUI();
  }
}

/* =========================================================
 * 録音停止後のAI処理（文字起こし → 議事録）の進捗
 *   ・画面上部に進捗バーと「完了まで約○分」を出す（完了バッジの代わり）。
 *   ・同時に録音ボタンを白い読込アニメーションへ切り替え、完了で消す。
 * =======================================================*/
let aiFlowTimer = null, aiFlowStart = 0, aiFlowEst = 0, aiFlowStage = '';

/** 録音の長さから、文字起こし＋議事録の完了までの目安（秒）を見積もる */
function estimateAiFlowSeconds() {
  const d = recordedDurationSec || 0;
  return Math.min(1200, Math.max(25, 25 + d * 0.22));
}

function startAiFlowProgress() {
  aiFlowRunning = true;
  aiFlowStart = Date.now();
  aiFlowEst = estimateAiFlowSeconds();
  aiFlowStage = 'AIが議事録を作成中…';
  if (aiFlowProgress) aiFlowProgress.hidden = false;
  clearInterval(aiFlowTimer);
  tickAiFlowProgress();
  aiFlowTimer = setInterval(tickAiFlowProgress, 250);
  updateFabState();
}

function setAiFlowStage(text) {
  aiFlowStage = text || aiFlowStage;
  tickAiFlowProgress();
}

function tickAiFlowProgress() {
  if (!aiFlowProgress || aiFlowProgress.hidden) return;
  const el = (Date.now() - aiFlowStart) / 1000;
  // 見積もりを超えても止まって見えないよう、95%へゆっくり漸近させる
  let p = el < aiFlowEst ? (el / aiFlowEst) * 0.95 : 0.95 + 0.04 * (1 - Math.exp(-(el - aiFlowEst) / 60));
  p = Math.min(0.99, p);
  const pct = Math.round(p * 100);
  aiFlowBar.style.width = pct + '%';
  aiFlowPct.textContent = pct + '%';
  aiFlowLabel.textContent = aiFlowStage;
  const remain = Math.ceil(aiFlowEst - el);
  aiFlowEta.textContent = remain > 0 ? `完了まで約 ${formatDurationJp(remain)}` : 'まもなく完了します…';
}

/** AI処理の終了。読込アニメーションを消し、録音ボタンも消す（最下部で再表示） */
function endAiFlowProgress(ok) {
  clearInterval(aiFlowTimer); aiFlowTimer = null;
  aiFlowRunning = false;
  if (aiFlowProgress) {
    if (ok) {
      aiFlowBar.style.width = '100%';
      aiFlowPct.textContent = '100%';
      aiFlowLabel.textContent = '議事録の作成が完了しました';
      aiFlowEta.textContent = '完了';
      setTimeout(() => { aiFlowProgress.hidden = true; }, 1200);
    } else {
      aiFlowProgress.hidden = true;
    }
  }
  updateFabState();
}

/** 進捗表示を初期状態へ戻す（リセット・新規録音時） */
function resetAiFlowProgress() {
  clearInterval(aiFlowTimer); aiFlowTimer = null;
  aiFlowRunning = false;
  if (aiFlowProgress) aiFlowProgress.hidden = true;
  if (aiFlowBar) aiFlowBar.style.width = '0%';
}

/* =========================================================
 * Web Speech API（ブラウザ標準の音声認識）
 *   無料・リアルタイム・高精度だが、音声はブラウザ経由でクラウドへ送られ、
 *   インターネット接続が必要（Chrome は Google、Edge は Azure）。
 * =======================================================*/
function getSR() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }

function joinStt(base, add) {
  base = (base || '').trim();
  add = (add || '').trim();
  if (!base) return add;
  if (!add) return base;
  return base + ' ' + add;
}

function beginRecognition() {
  const SR = getSR();
  if (!SR) return false;
  try {
    recognition = new SR();
    recognition.lang = 'ja-JP';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = onSpeechResult;
    recognition.onerror = onSpeechError;
    recognition.onend = onSpeechEnd;
    recognition.start();
    return true;
  } catch (_) { return false; }
}

function startWebSpeech() {
  if (!getSR()) {
    showError('このブラウザは Web Speech API（音声認識）に対応していません。設定でエンジンを「ブラウザ内Whisper」に切り替えてください。');
    return false;
  }
  sttBase = liveTranscript.value.trim();
  sttSegs = [];
  sttCurFinal = '';
  lastSttTs = Date.now();
  lastSttKick = Date.now();
  return beginRecognition();
}

/**
 * 認識が無反応のまま止まっている（onend も来ない）ときに作り直す。
 * 録音そのものはそのままなので、音声の保存には影響しない。
 */
function kickRecognition() {
  if (!recording || liveMode !== 'webspeech') return;
  lastSttKick = lastSttTs = Date.now();
  if (recognition) {
    try { recognition.onend = null; recognition.onresult = null; recognition.onerror = null; } catch (_) {}
    try { recognition.stop(); } catch (_) {}
    try { recognition.abort(); } catch (_) {}
    recognition = null;
    commitSttSegment();
  }
  beginRecognition();
}

/** 一定時間なにも認識結果が来なければ認識を作り直す（リアルタイム表示が止まるのを防ぐ） */
function watchRecognition() {
  if (!recording || liveMode !== 'webspeech') return;
  const now = Date.now();
  if (now - lastSttTs < 9000 || now - lastSttKick < 9000) return;
  kickRecognition();
}

/** 確定セグメント＋現在の認識結果を結合して表示用テキストを作る */
function composeSpeech(interim) {
  const cleaned = [];
  const pushClean = (p) => {
    const c = collapseLoops((p || '').trim()).trim();
    if (c && c !== cleaned[cleaned.length - 1]) cleaned.push(c); // 直前と同一の確定分は除外
  };
  if (sttBase) pushClean(sttBase);
  for (const s of sttSegs) if (s) pushClean(s);
  // ライブの途中結果（tail）は圧縮・整形せずそのまま表示して、取りこぼし・遅延を防ぐ
  const tail = (sttCurFinal + (interim || '')).trim();
  if (tail) cleaned.push(tail);
  return formatTranscript(cleaned.join('\n'));
}

function onSpeechResult(e) {
  // 差分加算せず、現インスタンスの結果全体から毎回組み立て直す（重複防止）
  let finalText = '', interim = '';
  for (let i = 0; i < e.results.length; i++) {
    const t = e.results[i][0].transcript;
    if (e.results[i].isFinal) finalText += t; else interim += t;
  }
  sttCurFinal = finalText;
  liveTranscript.value = composeSpeech(interim);
  liveTranscript.scrollTop = liveTranscript.scrollHeight;
  if (recording) renderLiveNow();   // 録音中のリアルタイム表示へ反映
  lastSttTs = Date.now();
  sttActivity = 0.9; // 発話に反応して波を動かす
}

function onSpeechError(e) {
  const err = e && e.error;
  if (err === 'not-allowed' || err === 'service-not-allowed') {
    showError('マイク／音声認識が許可されていません。ブラウザの権限を確認してください。');
  } else if (err === 'network') {
    showError('音声認識にはインターネット接続が必要です。接続を確認してください。');
  }
  // 'no-speech' / 'aborted' は無視（onend で再開）
}

/** 確定分をセグメント配列へ追加（ループ圧縮＋直前と同一なら破棄） */
function commitSttSegment() {
  const seg = collapseLoops(sttCurFinal.trim()).trim();
  sttCurFinal = '';
  if (seg && seg !== sttSegs[sttSegs.length - 1]) sttSegs.push(seg);
}

function onSpeechEnd() {
  // 録音継続中に認識が切れたら、確定分をコミットして新インスタンスで再開
  // （一時停止中は再開しない）
  if (recording && !paused && liveMode === 'webspeech') {
    commitSttSegment();
    setTimeout(() => { if (recording && !paused && liveMode === 'webspeech') beginRecognition(); }, 200);
  }
}

function stopWebSpeech() {
  if (recognition) {
    recognition.onend = null;   // 再開を止める
    recognition.onresult = null;
    try { recognition.stop(); } catch (_) {}
    try { recognition.abort(); } catch (_) {}
    recognition = null;
  }
  commitSttSegment();
  liveTranscript.value = composeSpeech('');
}

function teardownAudio() {
  try { if (processorNode) processorNode.disconnect(); } catch (_) {}
  try { if (sourceNode) sourceNode.disconnect(); } catch (_) {}
  try { if (analyser) analyser.disconnect(); } catch (_) {}
  try { if (audioCtx) audioCtx.close(); } catch (_) {}
  processorNode = sourceNode = analyser = audioCtx = null;
  if (mediaStream) { mediaStream.getTracks().forEach((t) => t.stop()); mediaStream = null; }
}

/**
 * 現在の audioCtx 上で、指定ストリームを波形表示のグラフに接続する。
 * 既存の sourceNode があれば切り離してから差し替えるため、録音中のマイク切替に使える。
 * （録音そのものはマイクのストリームから直接行うため、この経路には依存しない）
 */
function connectMicSource(stream) {
  if (!audioCtx) return;
  try { if (sourceNode) sourceNode.disconnect(); } catch (_) {}
  sourceNode = audioCtx.createMediaStreamSource(stream);
  if (analyser) sourceNode.connect(analyser);
  if (processorNode) sourceNode.connect(processorNode);
}

/**
 * 録音中にマイクを切り替える。録音はマイクのストリームから直接行っているため、
 * 新しいマイクで録音を録り直し（セグメント分割）、停止時に1本へ結合する。
 * 戻り値: 切り替えに成功したか。
 */
async function switchRecordingMic(deviceId) {
  if (!recording) return false;
  let newStream;
  try {
    newStream = await navigator.mediaDevices.getUserMedia(
      deviceId ? { audio: { deviceId: { exact: deviceId } } } : { audio: true });
  } catch (_) {
    try { newStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (_2) { return false; }
  }
  recordRestarting = true;
  try {
    await sealCurrentSegment();   // ここまでの音声を確定
    const old = mediaStream;
    mediaStream = newStream;
    connectMicSource(newStream);  // 波形表示を差し替え
    if (old) { try { old.getTracks().forEach((t) => t.stop()); } catch (_) {} }
    mediaRecorder = startSegmentRecorder(mediaStream);
  } finally {
    recordRestarting = false;
  }
  return !!mediaRecorder;
}

/**
 * ライブ文字起こし用の PCM を 16kHz にリサンプルして pendingChunks に積む。
 * 入力はマイクのネイティブレート（多くは 48kHz）。線形補間で間引く。
 * 保存音声はネイティブレートのまま（録音は別経路）なので品質には影響しない。
 */
function pushLiveChunk(input, srcRate) {
  if (!srcRate || srcRate === SAMPLE_RATE) { pendingChunks.push(new Float32Array(input)); return; }
  const ratio = srcRate / SAMPLE_RATE; // 例: 48000/16000 = 3
  const outLen = Math.floor((input.length - liveResampleAcc) / ratio);
  if (outLen <= 0) { liveResampleAcc -= input.length; return; }
  const out = new Float32Array(outLen);
  let pos = liveResampleAcc;
  for (let i = 0; i < outLen; i++) {
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input[idx] || 0;
    const s1 = (idx + 1 < input.length) ? input[idx + 1] : s0;
    out[i] = s0 + (s1 - s0) * frac;
    pos += ratio;
  }
  liveResampleAcc = pos - input.length; // 端数を次ブロックへ持ち越し
  pendingChunks.push(out);
  // バックログが溜まりすぎたら古い音声を捨てる（重いモデルでも録音UIが詰まらないように）。
  // 捨てた分は停止後の高精度パスで必ず再処理される。
  let backlog = totalSamples(pendingChunks);
  const maxSamples = MAX_LIVE_BACKLOG_SEC * SAMPLE_RATE;
  while (backlog > maxSamples && pendingChunks.length > 1) {
    backlog -= pendingChunks.shift().length;
  }
}

/**
 * 録音停止後の高精度文字起こし（音声全体を 30 秒コンテキストで再処理）。
 * ライブの暫定テキストを、精度の高い確定版で置き換える。
 */
async function runFinalPass(blob) {
  recordBtn.disabled = true;
  homeProcessing = true;
  procProgress = 0;
  finalErrored = false;
  updateHomeUI();
  setStatus('working', '音声を準備中…');

  try {
    const audio = await decodeTo16kMono(blob);
    const level = rms(audio); // 音量チェック（無音だと誤認識・反復が起きやすい）

    // 所要時間を推定（音声長 × モデル係数 ÷ バックエンド係数）してETA表示に使う
    const durationSec = audio.length / SAMPLE_RATE;
    const modelFactor = {
      'onnx-community/whisper-tiny': 1,
      'onnx-community/whisper-base': 2,
      'onnx-community/whisper-small': 4,
      'onnx-community/whisper-large-v3-turbo': 9,
    }[accuracyModel.value] || 4;
    // WebGPU はおおむね数倍速い
    const speedup = activeDevice === 'webgpu' ? 5 : 1;
    const factor = modelFactor / speedup;
    const estTotal = Math.max(5, durationSec * factor);
    const procStart = Date.now();
    progressWrap.hidden = false;
    if (cancelProcBtn) cancelProcBtn.hidden = false;

    // 長い録音を CPU(WASM) で処理しようとしている場合は事前に警告
    if (activeDevice !== 'webgpu' && durationSec > 600) {
      showError('この録音は長め（約' + Math.round(durationSec / 60) + '分）で、CPU処理では非常に時間がかかります。録音音声は保存済みです。中止して、音声ファイルを Gemini 等のAIに直接渡すと速く議事録が作れます（「録音」画面→音声を保存）。');
    }

    procTimer = setInterval(() => {
      const el = (Date.now() - procStart) / 1000;
      procProgress = Math.min(0.96, el / estTotal);
      // モデルDL中は本物のDL進捗に譲る
      if (performance.now() - lastDlProgress > 1200) {
        progressBar.style.width = (procProgress * 100).toFixed(0) + '%';
        const remain = Math.max(0, Math.ceil(estTotal - el));
        setStatus('working', `高精度で文字起こし中… 残り約 ${remain}秒`);
      }
    }, 300);

    await new Promise((resolve) => {
      finalResolve = resolve;
      worker.postMessage(
        { type: 'transcribe', id: ++reqId, mode: 'final', longform: true,
          audio, model: accuracyModel.value, language: LANGUAGE, device: activeDevice },
        [audio.buffer]
      );
    });

    if (finalCanceled) {
      setStatus('ready', '文字起こしを中止しました（音声は履歴に保存済み）');
    } else if (finalErrored) {
      // モデル取得や処理のネットワークエラー。録音音声は保存済みなので、
      // 音声から直接議事録を作れる Gemini ルートへ誘導する。
      setStatus('', '');
      showError('文字起こし用モデルを取得できませんでした（ネットワークエラー）。録音音声は保存済みです。通信環境の良い場所でページを再読み込みして再試行するか、録音音声からの議事録作成は、AI議事録の枠の右下「＜」→「作り直す」で行えます。');
    } else {
      procProgress = 1;
      progressBar.style.width = '100%';
      setStatus('ready', '文字起こし完了');
      if (level < 0.008) {
        showError('録音の音量がかなり小さいようです。マイクに近づける／端末の録音音量を上げると精度が上がります。');
      }
    }
  } catch (err) {
    showError('高精度処理に失敗しました: ' + (err && err.message ? err.message : err));
    setStatus('ready', 'モデル準備完了');
  } finally {
    clearInterval(procTimer); procTimer = null;
    progressWrap.hidden = true;
    if (cancelProcBtn) cancelProcBtn.hidden = true;
    recordBtn.disabled = false;
    homeProcessing = false;
    procProgress = 0;
    updateHomeUI();
  }
}

/** 録音に使う MIME を選ぶ（AI で共有しやすい m4a を優先） */
function pickAudioMime() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  const prefs = [
    'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac', 'audio/mpeg',
    'audio/ogg;codecs=opus', 'audio/ogg',
    'audio/webm;codecs=opus', 'audio/webm',
  ];
  for (const t of prefs) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (_) {} }
  return '';
}

/** 音声の実効音量（RMS） */
function rms(arr) {
  if (!arr || !arr.length) return 0;
  let sum = 0;
  const step = Math.max(1, Math.floor(arr.length / 100000)); // 間引いて概算
  let n = 0;
  for (let i = 0; i < arr.length; i += step) { sum += arr[i] * arr[i]; n++; }
  return Math.sqrt(sum / Math.max(1, n));
}

/** 句点（。．！？）で改行して読みやすく整形（登録した変換辞書もここで適用） */
function formatTranscript(text) {
  if (!text) return '';
  return autoConvert(text)
    .replace(/[ \t　]+/g, ' ')
    .replace(/\s*([。．！？])\s*/g, '$1\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/^\n+/, '')
    .trimEnd();
}

/** 日付を「7/16（火）」形式に */
function formatDateJp(d) {
  if (!d) return '';
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(d);
  if (!m) return d;
  const dt = new Date(+m[1], +m[2] - 1, +m[3]);
  const w = ['日', '月', '火', '水', '木', '金', '土'][dt.getDay()];
  return `${+m[2]}/${+m[3]}（${w}）`;
}

/**
 * 直後に同じ語句が繰り返される「ループ」を圧縮する。
 * 音声認識（Whisper / Web Speech とも）で起きやすい
 * 「大根ポケモン大根ポケモン大根ポケモン」「とひどいですとひどいです」等を 1 回にまとめる。
 */
function collapseLoops(text) {
  if (!text) return '';
  let t = text;
  let prev;
  // 収束するまで繰り返し圧縮（入れ子のループにも対応）
  do {
    prev = t;
    // 5〜40字のまとまった語句が 2 回以上連続 → 1 回に
    t = t.replace(/(.{5,40}?)\1{1,}/g, '$1');
    // 2〜4字の短い語句が 3 回以上連続 → 2 回まで（言い直し等は残す）
    t = t.replace(/(.{2,4}?)\1{2,}/g, '$1$1');
    // 1 字の 4 回以上連続 → 2 字に
    t = t.replace(/(.)\1{3,}/g, '$1$1');
  } while (t !== prev);
  return t;
}

/** Whisper の反復ハルシネーションを後処理で除去 */
function cleanupTranscript(text) {
  if (!text) return '';
  let t = collapseLoops(text.replace(/\s+/g, ' ').trim());
  // 句読点で区切り、直前と同じ断片が連続したら間引く
  const segs = t.split(/(?<=[。．！？!?、,])/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const s of segs) {
    if (out.length && s === out[out.length - 1]) continue; // 直前と同一の文は捨てる
    out.push(s);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/** 録音 Blob を 16kHz モノラルの Float32 にデコード＆リサンプル */
/**
 * デコード用の AudioContext。呼び出しごとに new すると、
 * ブラウザの同時 AudioContext 数の上限（Chrome は6程度）にすぐ達し、
 * 以降の生成が例外になって「デコードできないセグメント」が量産される。
 * 1つを使い回し、閉じない。
 */
let decodeCtx = null;
function getDecodeCtx() {
  if (!decodeCtx || decodeCtx.state === 'closed') {
    decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return decodeCtx;
}

async function decodeTo16kMono(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = getDecodeCtx();
  // decodeAudioData は ArrayBuffer を detach するため、同じバッファは再利用できない
  const decoded = await ctx.decodeAudioData(arrayBuffer);
  const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
  const off = new OfflineAudioContext(1, Math.max(frames, 1), SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0).slice();
}

/* ===== ライブ用チャンク送信 ===== */
function totalSamples(arr) { return arr.reduce((s, a) => s + a.length, 0); }
function drainPending() {
  const len = totalSamples(pendingChunks);
  const out = new Float32Array(len);
  let off = 0;
  for (const a of pendingChunks) { out.set(a, off); off += a.length; }
  pendingChunks = [];
  return out;
}
/* =========================================================
 * アプリ版のライブ文字起こし（録音中でも動く方式）
 *   Android は同じマイクを「録音」と「音声認識」で二重に開けないため、
 *   録音サービスがマイクから読んでいる PCM をそのまま受け取り、
 *   端末内の Whisper（worker.js）で文字にする。マイクは1つしか開かないので
 *   録音が止まる心配がなく、外部送信も無い。
 * =======================================================*/
const LIVE_MODEL = 'Xenova/whisper-base';   // 端末内で使うモデル（tiny より精度が高い）
// リアルタイム文字起こしの更新間隔。7 秒たまるごとにまとめて文字にする。
const LIVE_UPDATE_SEC = 7;
const LIVE_CHUNK_SEC = LIVE_UPDATE_SEC;    // 端末内Whisperのまとめ単位
const LIVE_GEMINI_SEC = LIVE_UPDATE_SEC;   // Gemini に送るまとめ単位
let nativePcmSub = null;
let liveWhisperOn = false;      // ライブ文字起こし中か
let liveWhisperFailed = false;  // 準備に失敗したか（案内の切り替え用）
let liveEngine = 'whisper';     // 'gemini'（高精度・要ネット）か 'whisper'（端末内）
let liveBusy = false;           // Gemini へ送っている最中か

/**
 * 録音サービスからの PCM 受け取りを開始する。使えなければ false。
 * APIキーがあれば Gemini（速くて高精度）、無ければ端末内 Whisper を使う。
 */
async function startNativeLiveTranscribe() {
  const rec = nativeRecorder();
  if (!rec || typeof rec.startPcmUpdates !== 'function') return false; // 古い版のアプリ
  try {
    const r = await rec.startPcmUpdates();
    if (r && r.available === false) return false;   // PCM を取り出せない録音方式
  } catch (_) { return false; }
  liveWhisperOn = true;
  liveWhisperFailed = false;
  liveBusy = false;
  pendingChunks = [];
  workerBusy = false;
  liveEngine = loadGeminiKey() ? 'gemini' : 'whisper';
  // 端末内で処理するときだけ、先にモデルを読み込んでおく（表示は出さない）
  if (liveEngine === 'whisper') worker.postMessage({ type: 'load', model: LIVE_MODEL, device: 'wasm' });
  try { nativePcmSub = rec.addListener('pcm', onNativePcm); } catch (_) { nativePcmSub = null; }
  return true;
}

/** PCM の受け取りを終える */
function stopNativeLiveTranscribe() {
  if (!liveWhisperOn) return;
  liveWhisperOn = false;
  const rec = nativeRecorder();
  if (rec && typeof rec.stopPcmUpdates === 'function') { try { rec.stopPcmUpdates(); } catch (_) {} }
  if (nativePcmSub) {
    Promise.resolve(nativePcmSub).then((s) => { try { s.remove(); } catch (_) {} }).catch(() => {});
    nativePcmSub = null;
  }
  pendingChunks = [];
}

/** ネイティブから届いた PCM（base64 の 16bit LE）を Float32 に直して溜める */
function onNativePcm(ev) {
  if (!liveWhisperOn || !ev || !ev.data) return;
  let bin;
  try { bin = atob(ev.data); } catch (_) { return; }
  const n = bin.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = bin.charCodeAt(i * 2), hi = bin.charCodeAt(i * 2 + 1);
    let v = (hi << 8) | lo;
    if (v > 32767) v -= 65536;
    out[i] = v / 32768;
  }
  collectPitch(out);   // 話者判別用に声の高さを記録（文字起こしには手を加えない）
  pendingChunks.push(out);
  // 溜め込みすぎない（処理が追いつかないときは古い分から捨てる）
  let backlog = totalSamples(pendingChunks);
  const maxSamples = SAMPLE_RATE * LIVE_CHUNK_SEC * 3;
  while (backlog > maxSamples && pendingChunks.length > 1) backlog -= pendingChunks.shift().length;
  maybeSendChunk();
}

/** 溜まった音声がまとまったら文字起こしへ回す（前の処理が終わるまでは待つ） */
/**
 * ひとかたまりに「人の声」が入っているか。
 * 無音や空調音だけの区間をAIへ送ると、話していないのに文字が出てくる
 * （ハルシネーション）ため、送る前にここで捨てる。
 *   - 全体の音量（RMS）が小さすぎるものは無音とみなす
 *   - 声は強弱があるので、ピークが平均に対して十分大きいことも見る
 */
const LIVE_SILENCE_PEAK = 0.03;   // 山がこれ以下なら発話なし（LIVE_SILENCE_RMS と併用）
function hasSpeech(audio) {
  if (!audio || !audio.length) return false;
  const level = rms(audio);
  if (level < LIVE_SILENCE_RMS) return false;
  let peak = 0;
  const step = Math.max(1, Math.floor(audio.length / 20000));
  for (let i = 0; i < audio.length; i += step) { const v = Math.abs(audio[i]); if (v > peak) peak = v; }
  if (peak < LIVE_SILENCE_PEAK) return false;
  return true;
}

function maybeSendChunk() {
  if (!liveWhisperOn) return;
  if (liveEngine === 'gemini') {
    if (liveBusy) return;
    if (totalSamples(pendingChunks) < SAMPLE_RATE * LIVE_GEMINI_SEC) return;
    markLiveWindow();
    const chunk = drainPending();
    if (!hasSpeech(chunk)) return;   // 無音は送らない（勝手に文字が出るのを防ぐ）
    sendLiveToGemini(chunk);
    return;
  }
  if (workerBusy) return;
  if (totalSamples(pendingChunks) < SAMPLE_RATE * LIVE_CHUNK_SEC) return;
  markLiveWindow();
  const audio = drainPending();
  if (!hasSpeech(audio)) return;     // 無音は文字起こしにかけない
  workerBusy = true;
  worker.postMessage(
    { type: 'transcribe', id: ++reqId, mode: 'live', audio, model: LIVE_MODEL, language: LANGUAGE, device: 'wasm' },
    [audio.buffer]
  );
}

/** これから送るひとかたまりが録られた時間帯を控える（話者判定の窓に使う） */
function markLiveWindow() {
  const now = Date.now();
  liveWin = { t0: now - (totalSamples(pendingChunks) / SAMPLE_RATE) * 1000, t1: now };
}

/** Float32（16kHz モノラル）を WAV の Blob にする */
function wavFromFloat32(f32) {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const v = Math.max(-1, Math.min(1, f32[i]));
    i16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return new Blob([wavHeader(i16.length, SAMPLE_RATE), i16], { type: 'audio/wav' });
}

/**
 * 録音中のひとかたまりを Gemini で文字にする（速くて高精度）。
 * 直前の文字起こしを手がかりとして渡し、切れ目が不自然にならないようにする。
 */
async function sendLiveToGemini(audio) {
  liveBusy = true;
  try {
    // 手がかりに渡す直前のテキストからは、こちらで付けた話者ラベルを外す
    const tail = stripSpeakers(liveTranscript.value).trim().slice(-160);
    const prompt =
      'この音声を日本語で文字起こししてください。会議の途中を切り出した音声です。\n'
      + '・聞こえたことばだけを出力し、前置き・説明・記号・話者名は付けないでください。\n'
      + '・聞き取れない部分は無理に補わず、飛ばしてください。\n'
      + dictPromptLine()   // 登録した用語は指定の表記で書いてもらう
      + (tail ? `・直前までの文字起こし（重複して書かないでください）:「${tail}」\n` : '');
    const text = await geminiAudioRequest(audio ? wavFromFloat32(audio) : null, prompt, { live: true });
    if (text) appendTranscript(cleanupTranscript(text));
  } catch (err) {
    // ライブは失敗しても録音・停止後の文字起こしに影響しない。案内だけ切り替える。
    liveWhisperFailed = true;
    if (recording) renderLiveNow();
  } finally {
    liveBusy = false;
    maybeSendChunk();   // 待っている分があれば続けて送る
  }
}
/* =========================================================
 * 話者の自動判別（A / B / C …）
 *   録音サービスから届く PCM の「声の高さ（基本周波数）」を測り、
 *   まとまりごとの中央値でゆるくクラスタリングして行頭にラベルを付ける。
 *   文字起こしの音声・プロンプト・本文には手を加えないので精度に影響しない。
 * =======================================================*/
const SPK_KEY = 'noteloop_speaker_labels';
const SPK_MAX = 6;            // A〜F まで
const SPK_TOLERANCE = 0.13;   // 同一話者とみなす対数距離（≒ ±14%）
const PITCH_WIN = 1024;       // 16kHz で 64ms。70Hz の 4 周期以上が入る長さ
let pitchSamples = [];        // { t, f0 }
let speakerCentroids = [];    // { hz, n }
let lastSpeaker = '';         // 直前に行頭へ付けたラベル
let liveWin = null;           // 直近チャンクの時間帯（話者判定の窓）

function speakerOn() { return !!(speakerLabels && speakerLabels.checked); }

/** 話者判別の状態をリセット（録音開始時） */
function resetSpeakers() {
  pitchSamples = [];
  speakerCentroids = [];
  lastSpeaker = '';
  liveWin = null;
  lastLiveChunk = '';
}

/** 届いた PCM から声の高さを拾って記録する（64ms ごとに1点） */
function collectPitch(pcm) {
  if (!speakerOn() || !pcm || pcm.length < PITCH_WIN) return;
  const now = Date.now();
  const frames = Math.floor(pcm.length / PITCH_WIN);
  const spanMs = (pcm.length / SAMPLE_RATE) * 1000;
  for (let k = 0; k < frames; k++) {
    const f0 = detectPitch(pcm.subarray(k * PITCH_WIN, (k + 1) * PITCH_WIN), SAMPLE_RATE);
    // このフレームが録られたおおよその時刻（届いた時点から逆算）
    if (f0) pitchSamples.push({ t: now - spanMs + (k + 0.5) * (PITCH_WIN / SAMPLE_RATE) * 1000, f0 });
  }
  if (pitchSamples.length > 20000) pitchSamples.splice(0, pitchSamples.length - 20000);
}

/**
 * 基本周波数（70〜340Hz）を推定する。
 * 単純な自己相関はオクターブ下（220Hz を 110Hz と誤る等）を拾いやすいので、
 * YIN 方式（差分関数を累積平均で正規化し、しきい値を最初に下回る周期を採る）を使う。
 * 無音・雑音・無声区間は null を返して判定に使わない。
 */
function detectPitch(x, sr) {
  const n = x.length;
  if (n < 200) return null;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  let energy = 0;
  for (let i = 0; i < n; i++) { const v = x[i] - mean; energy += v * v; }
  if (Math.sqrt(energy / n) < 0.012) return null;   // 小さすぎる音は判定しない

  const minLag = Math.max(2, Math.floor(sr / 340));
  const maxLag = Math.min(Math.floor(n / 2), Math.floor(sr / 70));
  if (maxLag <= minLag) return null;

  // 差分関数 d(τ) を累積平均で正規化した d'(τ)
  const win = n - maxLag;
  const cmnd = new Float32Array(maxLag + 1);
  cmnd[0] = 1;
  let run = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < win; i++) { const dd = (x[i] - mean) - (x[i + lag] - mean); s += dd * dd; }
    run += s;
    cmnd[lag] = run === 0 ? 1 : s * lag / run;
  }

  // しきい値を最初に下回る谷（＝いちばん短い周期）を採る
  const TH = 0.15;
  let best = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (cmnd[lag] < TH) {
      while (lag + 1 <= maxLag && cmnd[lag + 1] < cmnd[lag]) lag++;   // 谷の底まで進む
      best = lag;
      break;
    }
  }
  if (best < 0) {
    let min = Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) if (cmnd[lag] < min) { min = cmnd[lag]; best = lag; }
    if (min > 0.45) return null;   // 周期性が弱い＝有声音ではない
  }

  // 放物線補間で周期の精度を上げる
  let tau = best;
  if (best > minLag && best < maxLag) {
    const a = cmnd[best - 1], b = cmnd[best], c = cmnd[best + 1];
    const den = 2 * (2 * b - a - c);
    if (den !== 0) tau = best + (c - a) / den;
  }
  return tau > 0 ? sr / tau : null;
}

/** 指定区間の声の高さの中央値（サンプルが少なければ 0） */
function medianPitch(t0, t1) {
  const v = [];
  for (const p of pitchSamples) if (p.t >= t0 && p.t <= t1) v.push(p.f0);
  if (v.length < 4) return 0;
  v.sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
}

/** 声の高さに一番近い話者（許容範囲外なら -1） */
function nearestSpeaker(f0) {
  let bi = -1, bd = Infinity;
  for (let i = 0; i < speakerCentroids.length; i++) {
    const d = Math.abs(Math.log(f0 / speakerCentroids[i].hz));
    if (d < bd) { bd = d; bi = i; }
  }
  return bd <= SPK_TOLERANCE ? bi : -1;
}
function speakerLetter(i) { return String.fromCharCode(65 + i); }

/** 区間 [t0, t1] の話者ラベルを決める（新しい声なら話者を追加） */
function speakerFor(t0, t1) {
  if (!speakerOn()) return '';
  const f0 = medianPitch(t0, t1);
  if (!f0) return lastSpeaker;
  const i = nearestSpeaker(f0);
  if (i >= 0) {
    const c = speakerCentroids[i];
    c.n = Math.min(20, c.n + 1);
    c.hz += (f0 - c.hz) / c.n;   // 移動平均でゆっくり追従
    return speakerLetter(i);
  }
  if (speakerCentroids.length >= SPK_MAX) return lastSpeaker || 'A';
  speakerCentroids.push({ hz: f0, n: 1 });
  return speakerLetter(speakerCentroids.length - 1);
}

/** 行頭の話者ラベル（「A：」）を取り除く */
function stripSpeakers(text) { return (text || '').replace(/^[ \t]*[A-F]\s*[：:][ \t]*/gm, ''); }

/** 記号・句読点だけ（「！！！」等のハルシネーション）かどうか */
function isJunkChunk(text) {
  const t = (text || '').trim();
  if (!t) return true;
  return !/[\p{L}\p{N}]/u.test(t); // 文字・数字を含まなければ捨てる
}

/**
 * 話していないのに出てくる「幻の文字起こし」を捨てる。
 * 無音や物音だけの区間を AI に渡すと、学習データによくある決まり文句
 *（「ご視聴ありがとうございました」等）を返してくることがある。
 * 音を送る前の無音判定（hasSpeech）と合わせた二段構えで防ぐ。
 */
const GHOST_PHRASES = [
  'ご視聴ありがとうございました', 'ご清聴ありがとうございました', 'ありがとうございました',
  'おやすみなさい', 'お疲れ様でした', 'おつかれさまでした',
  'チャンネル登録をお願いします', 'チャンネル登録お願いします', '高評価をお願いします',
  '最後までご視聴いただきありがとうございます', 'また次回お会いしましょう',
  '字幕', '字幕視聴ありがとうございました', '音楽', 'BGM', '拍手',
  'Thank you for watching', 'Thanks for watching', 'Please subscribe', 'you',
];
let lastLiveChunk = '';   // 直前に採用したかたまり（同じ文言の繰り返しを弾く）
function isGhostChunk(text) {
  const t = (text || '').trim();
  if (!t) return true;
  // 記号・空白・かっこを除いた「中身」で判定する
  const core = t.replace(/[\s。、．，!！?？…・「」『』（）()【】\[\]"'`~-]/g, '');
  if (core.length <= 1) return true;
  const norm = core.toLowerCase();
  for (const p of GHOST_PHRASES) {
    const q = p.replace(/\s/g, '').toLowerCase();
    if (norm === q) return true;
  }
  if (t === lastLiveChunk) return true;   // 直前とまったく同じなら重複
  return false;
}
/**
 * ライブの文字起こし結果を末尾に足す。
 * 話者が前のかたまりから変わったときだけ改行して「A：」を付ける。
 */
function appendTranscript(text) {
  if (isJunkChunk(text)) return; // 記号だけの誤認識は表示しない（実語のみ表示）
  if (isGhostChunk(text)) return; // 話していないのに出る決まり文句・直前と同じ文言は捨てる
  lastLiveChunk = (text || '').trim();
  const spk = liveWin ? speakerFor(liveWin.t0, liveWin.t1) : '';
  const cur = liveTranscript.value.trimEnd();
  let next;
  if (spk && spk !== lastSpeaker) {
    next = (cur ? cur + '\n' : '') + `${spk}：${text}`;
    lastSpeaker = spk;
  } else {
    next = cur ? cur + ' ' + text : text;
  }
  liveTranscript.value = formatTranscript(next);
  liveTranscript.scrollTop = liveTranscript.scrollHeight;
  if (recording) renderLiveNow();   // 録音中のリアルタイム表示へ反映
}
clearTranscript.addEventListener('click', () => {
  liveTranscript.value = '';
  legacyMinutes = { summary: [], decisions: [], todos: [] };
  recordedBlob = null; recordedDurationSec = 0; setAudioAvailable(false);
  clearAudioWarning();
  resetFlowCards();
  updateHomeUI();
});

/* =========================================================
 * セッションのリセット（履歴はそのまま残す）
 *   画面だけを録音待機の状態へ戻し、すぐ次の録音を始められるようにする。
 *   保存済みの議事録・録音音声は履歴に残っているので、あとから開き直せる。
 * =======================================================*/
function resetSession(opts) {
  const silent = !!(opts && opts.silent);
  if (recording || aiFlowRunning || aiAutoRunning || aiTextRunning) return false;

  closeHistoryDetail();          // 履歴の詳細を見ていたらカード群を録音画面へ戻す
  resetAiFlowProgress();
  hideError();
  setStatus('', '');

  // 文字起こし・議事録・AIの結果
  liveTranscript.value = '';
  legacyMinutes = { summary: [], decisions: [], todos: [] };
  const aiTextArea = document.getElementById('aiText');
  if (aiTextArea) aiTextArea.value = '';
  const aiTextStatusEl = document.getElementById('aiTextStatus');
  if (aiTextStatusEl) { aiTextStatusEl.hidden = true; aiTextStatusEl.innerHTML = ''; }
  if (aiResult) aiResult.value = '';
  if (aiResultWrap) aiResultWrap.hidden = true;
  if (aiAutoStatus) { aiAutoStatus.hidden = true; aiAutoStatus.innerHTML = ''; }

  // メール（自動で入れた件名・本文も戻す）
  if (mailSubject) mailSubject.value = '';
  if (mailBody) mailBody.value = '';
  mailAuto = { subject: '', body: '' };

  // 録音音声
  recordedBlob = null;
  recordedDurationSec = 0;
  recStartedAt = 0;
  audioShortfall = null;
  activeRecordingId = null;
  if (player) { try { player.pause(); } catch (_) {} player.removeAttribute('src'); player.load(); }
  if (audioSize) audioSize.textContent = '';
  if (downloadAudio) downloadAudio.disabled = true;
  setAudioAvailable(false);
  clearAudioWarning();

  // 自動で付いたタイトルだけ消す（手入力のタイトル・参加者はそのまま次の会議に使える）
  if (autoTitleApplied && meetingName.value.trim() === autoTitleApplied) {
    meetingName.value = '';
    updateMeetingSummary();
  }
  autoTitleApplied = '';

  resetFlowCards();
  updateHomeUI();
  window.scrollTo({ top: 0, behavior: silent ? 'auto' : 'smooth' });
  return true;
}

/* =========================================================
 * 引き下げてリセット（Chrome の「引き下げて更新」と同じ操作）
 *   画面の一番上で下へスワイプ → 指を止めるとリングが固定され、
 *   離すとリセットして録音待機に戻る（内容は履歴に残る）。
 * =======================================================*/
const PTR_TRIGGER = 78;   // これ以上引くとリセット
const PTR_MAX     = 116;  // 引ける上限（これ以上は付いてこない）
let ptrStartY = 0, ptrDy = 0, ptrTracking = false, ptrArmed = false;

function ptrCanStart(target) {
  // 録音中・AI処理中・録音画面以外・結果が無いときは何もしない
  if (recording || aiFlowRunning || aiAutoRunning || aiTextRunning || homeProcessing) return false;
  const home = document.getElementById('screen-home');
  if (!home || home.hidden) return false;
  if (!hasSessionResult()) return false;
  // ポップアップ／メニューが開いている間は無効
  if (document.querySelector('.modal-overlay:not([hidden])')) return false;
  const drawer = document.getElementById('drawer');
  if (drawer && drawer.classList.contains('open')) return false;
  // 自分でスクロールできる部品（途中までスクロール済み）の上から始まったスワイプは横取りしない。
  // 文字起こし欄などは先頭に居るときだけ引き下げを受け付ける（Chromeと同じ感覚）。
  if (target && target.closest && target.closest('select, audio, input[type="range"]')) return false;
  if (scrolledInsideAncestor(target)) return false;
  return window.scrollY <= 0;
}

/** 触れた位置の親をたどり、内部スクロールが先頭より下にある部品があれば true */
function scrolledInsideAncestor(node) {
  let el = node;
  while (el && el.nodeType === 1 && el !== document.body) {
    if (el.scrollHeight > el.clientHeight + 1 && el.scrollTop > 0) return true;
    el = el.parentElement;
  }
  return false;
}

function ptrRender(dy) {
  if (!ptrEl || !ptrCircle) return;
  const y = Math.min(PTR_MAX, dy);
  const ratio = Math.min(1, y / PTR_TRIGGER);
  ptrEl.classList.add('pulling');
  ptrEl.classList.toggle('ready', ratio >= 1);
  ptrEl.style.opacity = String(Math.min(1, ratio * 1.2));
  ptrCircle.style.transform =
    `translateY(${Math.round(y * 0.62)}px) scale(${(0.7 + ratio * 0.3).toFixed(3)}) rotate(${Math.round(ratio * 300)}deg)`;
}

function ptrRelease(fire) {
  if (!ptrEl || !ptrCircle) return;
  ptrEl.classList.remove('pulling');
  ptrEl.classList.add('releasing');
  if (fire) {
    // 固定位置で一度回してからリセットする（押した手応えを残す）
    ptrEl.classList.add('spinning');
    ptrCircle.style.transform = `translateY(${Math.round(PTR_TRIGGER * 0.62)}px) scale(1)`;
    setTimeout(() => {
      resetSession();
      ptrEl.style.opacity = '0';
      ptrCircle.style.transform = 'translateY(0) scale(.7)';
      ptrEl.classList.remove('ready', 'spinning');
      setTimeout(() => ptrEl.classList.remove('releasing'), 300);
    }, 420);
  } else {
    ptrEl.style.opacity = '0';
    ptrCircle.style.transform = 'translateY(0) scale(.7)';
    ptrEl.classList.remove('ready');
    setTimeout(() => ptrEl.classList.remove('releasing'), 300);
  }
}

document.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1 || !ptrCanStart(e.target)) { ptrTracking = false; return; }
  ptrTracking = true; ptrArmed = false;
  ptrStartY = e.touches[0].clientY;
  ptrDy = 0;
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!ptrTracking) return;
  const dy = e.touches[0].clientY - ptrStartY;
  if (dy <= 0 || window.scrollY > 0) {
    if (ptrArmed) { ptrArmed = false; ptrRelease(false); }
    ptrTracking = false;
    return;
  }
  ptrDy = dy;
  if (!ptrArmed && dy > 8) ptrArmed = true;
  if (ptrArmed) {
    if (e.cancelable) e.preventDefault();   // 画面が一緒に動かないようにする
    ptrRender(dy);
  }
}, { passive: false });

function ptrEnd() {
  if (!ptrTracking) return;
  const fire = ptrArmed && ptrDy >= PTR_TRIGGER;
  if (ptrArmed) ptrRelease(fire);
  ptrTracking = false; ptrArmed = false; ptrDy = 0;
}
document.addEventListener('touchend', ptrEnd, { passive: true });
document.addEventListener('touchcancel', ptrEnd, { passive: true });
liveTranscript.addEventListener('input', updateHomeUI);

/* ===== タイマー ===== */
/**
 * 「経過時間」と「実際に録れている時間」が離れてきたら、録音中に知らせる。
 * 端末が録音を止めていることに会議の最中に気づけるようにするためのもので、
 * 停止後に「29分のはずが2分しか残っていない」と分かる事態を防ぐ。
 */
function updateCapturedNotice(elapsedSec) {
  if (!capturedHint) return;
  // アプリ版はサービスが録り続けるので欠落しない（capturedMs も積まない）
  if (!recording || NATIVE) { capturedHint.hidden = true; return; }
  const capturedSec = Math.floor(capturedMs / 1000);
  const lostSec = elapsedSec - capturedSec;
  // 起動直後や数秒のずれでは出さない。20秒以上かつ2割以上ずれたときだけ。
  if (elapsedSec < 30 || lostSec < 20 || capturedSec > elapsedSec * 0.8) { capturedHint.hidden = true; return; }
  capturedHint.textContent = `⚠ 録音できているのは ${formatDurationJp(capturedSec)}（経過 ${formatDurationJp(elapsedSec)}）。`
    + `端末が録音を止めています。画面を点けたままにしてください。`;
  capturedHint.hidden = false;
}

function updateTimer() {
  const elapsed = Math.floor(elapsedMs() / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  timerEl.textContent = `${m}:${s}`;
  updateCapturedNotice(elapsed);
  // 通知は 1 秒ごとに出し直す（経過時間＋ゲージのアニメーション）。
  // 一時停止中は秒が進まないので、そのまま止まった表示が残る。
  if (recording && !paused && elapsed !== notifLastSec) {
    notifLastSec = elapsed;
    notifPhase += 1;
    showRecordingNotification(`${m}:${s}`, recordStalled);
  }
  if (!paused) watchRecognition(); // リアルタイム文字起こしが止まっていないか見張る
}

/* =========================================================
 * 上部の録音ゲージ（音量に連動する縦バー）
 *   等間隔・同じ太さの白いバーを並べる。位置は動かさず、周囲の音の
 *   大きさに応じてその場で上下に伸び縮みする。静かなときは全部が丸い点に戻る。
 *   1本ごとに感度と揺れの速さを変えてあるので、同じ音でも横一列には
 *   ならず、生きた動きに見える。
 * =======================================================*/
let waveRAF = null, wavePhase = 0, waveLevel = 0.14, waveActive = false, waveLastDraw = 0;
let nativeLevel = 0;       // アプリ版でネイティブから受け取った音量（0..1）
let nativeLevelTimer = null;
let nativeLevelSub = null; // ネイティブからの音量通知の購読
let procProgress = 0;      // 高精度処理の推定進捗 0..1
let lastDlProgress = 0;    // 直近のモデルDL進捗の時刻
const waveBuf = new Uint8Array(1024);

// 各バーの現在の高さ（0..1）。位置は固定なので、ここだけが動く。
let gaugeBars = [];

function brandVar(n) { return (getComputedStyle(document.documentElement).getPropertyValue(n) || '').trim(); }

/** 決まった見た目を再現するための擬似乱数（同じ種なら同じ値） */
function gaugeNoise(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x); // 0..1
}

/**
 * i 本目のバーの、いまの乱数値（0..1）。
 * tn の整数が変わるたびに別の乱数へ、その間はなめらかに繋ぐ。
 * 一定の周期で揺れる sin と違い、伸びる長さが毎回変わって見える。
 */
function barRandom(i, tn) {
  const k = Math.floor(tn), f = tn - k;
  const sm = f * f * (3 - 2 * f);
  return gaugeNoise(i * 17.3 + k * 1.7) * (1 - sm) + gaugeNoise(i * 17.3 + (k + 1) * 1.7) * sm;
}

/** i 本目のバーの個性（毎回同じ値になるので、描き直しても暴れない） */
function newGaugeBar(i) {
  return {
    v: 0,                                          // いまの高さ 0..1
    gain: 0.55 + gaugeNoise(i * 3.9) * 1.15,       // 伸びやすさの個体差（大きいほど高く伸びる）
    speed: 1.6 + gaugeNoise(i * 1.3) * 5.2,        // 揺れの速さもばらばら（速め）
    phase: gaugeNoise(i * 2.7) * Math.PI * 2,      // 揺れの位相
    // 揺れ幅の下限。小さいほど大きく伸び縮みする（本ごとに動く量そのものを変える）
    lo: 0.04 + gaugeNoise(i * 8.7) * 0.34,
    // 乱数の切り替わる間隔（秒）。短いほど機敏にパタパタ動く。
    step: 0.085 + gaugeNoise(i * 4.4) * 0.115,
  };
}

function resizeWave() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = wave.getBoundingClientRect();
  if (rect.width > 0) { wave.width = Math.round(rect.width * dpr); wave.height = Math.round(rect.height * dpr); }
  gaugeBars = []; // 幅が変わったら本数を作り直す
}

/** アプリ版: 録音中の音量をネイティブから定期的に受け取る（マイクは開かない） */
function startNativeLevelPolling() {
  if (!NATIVE || nativeLevelTimer) return;
  const rec = nativeRecorder();
  if (!rec || typeof rec.getLevel !== 'function') return;
  // ネイティブ側から音量を送ってもらう（片道）。
  // 毎回こちらから問い合わせる（往復）方式だと、描画で WebView が混んでいるときに
  // 応答が溜まってしまい、ゲージが固まったまま画面操作の瞬間だけ動く、という
  // 挙動になっていた。送りっぱなしにすると詰まりにくい。
  if (typeof rec.addListener === 'function') {
    try {
      nativeLevelSub = rec.addListener('level', (ev) => { setNativeLevel(ev && ev.level); });
      rec.startLevelUpdates().catch(() => {});
      return;
    } catch (_) { nativeLevelSub = null; }
  }
  // 送信に対応していない版のアプリでは、間隔を空けて問い合わせる（保険）
  let busy = false;
  nativeLevelTimer = setInterval(async () => {
    if (busy) return;               // 前の応答が返る前に積み増さない
    busy = true;
    try {
      const r = await rec.getLevel();
      setNativeLevel(r && r.level);
    } catch (_) { /* 取れない版のアプリでは 0 のまま（ゲージは静かなまま） */ }
    busy = false;
  }, 200);
}
/**
 * ネイティブから受け取った音量（0..1）をそのまま使う。
 * 対数目盛りとノイズゲートはサービス側で済ませてあるので、ここで持ち上げると
 * 「静かでもバーが動く・少し大きい声で頭打ち」になってしまう。
 */
function setNativeLevel(v) {
  const n = typeof v === 'number' ? v : 0;
  nativeLevel = Math.max(0, Math.min(1, n));
}
function stopNativeLevelPolling() {
  if (nativeLevelTimer) clearInterval(nativeLevelTimer);
  nativeLevelTimer = null;
  if (nativeLevelSub) {
    const rec = nativeRecorder();
    if (rec && typeof rec.stopLevelUpdates === 'function') { try { rec.stopLevelUpdates(); } catch (_) {} }
    Promise.resolve(nativeLevelSub).then((s) => { try { s.remove(); } catch (_) {} }).catch(() => {});
    nativeLevelSub = null;
  }
  nativeLevel = 0;
}

function startWave() {
  if (waveActive) return;
  waveActive = true;
  gaugeBars = [];
  startNativeLevelPolling();
  resizeWave();
  waveLoop();
}
function stopWave() {
  waveActive = false;
  stopNativeLevelPolling();
  if (waveRAF) cancelAnimationFrame(waveRAF);
  waveRAF = null;
}
function waveLoop() {
  if (!waveActive) return;
  waveRAF = requestAnimationFrame(waveLoop);
  // 描き替えは 50fps 程度まで。上限を設けておかないと、端末によっては
  // 描画で WebView が詰まり、ネイティブから送られる音量の受け取りまで遅れる。
  const now = performance.now();
  if (now - waveLastDraw < 20) return;
  waveLastDraw = now;
  // 大きいほど速く動く（静かなときはゆっくり）
  wavePhase += 0.02 + waveLevel * 0.055;
  // 高精度処理中は「文字が打たれていく」別アニメーションを表示
  if (homeProcessing && !recording) { drawProcessingFrame(); return; }
  sttActivity *= 0.9;
  let target;
  if (recording && paused) {
    target = 0;   // 一時停止中はバーを点に戻して止める
  } else if (recording && NATIVE) {
    // アプリ版はサービス側の MediaRecorder が音を握っているので、
    // マイクを二重に開かず、録音中の振幅をネイティブから受け取って使う。
    target = nativeLevel;
  } else if (recording && analyser) {
    analyser.getByteTimeDomainData(waveBuf);
    let s = 0;
    for (let i = 0; i < waveBuf.length; i++) { const x = (waveBuf[i] - 128) / 128; s += x * x; }
    const r = Math.sqrt(s / waveBuf.length);
    // ノイズゲート＋ゲイン: 静かなら凪(0)、声が大きいほど大きく（0〜1）
    const gated = Math.max(0, r - 0.012);
    target = Math.min(1, gated * 7);
    if (target < 0.05) target = 0; // ごくわずかな音では動かさない
  } else if (recording && activeEngine === 'webspeech') {
    target = sttActivity; // 音声解析なし → 発話イベントで揺らす
  } else {
    target = 0.14 + Math.sin(wavePhase * 1.4) * 0.05; // 処理中はゆるやかに揺れる
  }
  // 上がるのは即座に、下がるのも速めに（声にきびきび追従させる）
  const k = target > waveLevel ? 0.9 : 0.45;
  waveLevel += (target - waveLevel) * k;
  drawWaveFrame();
}
/** 角丸矩形パス（新しいパスとして開始する） */
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  rrectPath(ctx, x, y, w, h, r);
}

/** 角丸矩形を「いま組み立て中のパスに追加する」（まとめて一度に塗るため） */
function rrectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 高精度処理中: 文字が左から打ち込まれていくアニメーション */
function drawProcessingFrame() {
  const ctx = wave.getContext('2d');
  const w = wave.width, h = wave.height;
  ctx.clearRect(0, 0, w, h);
  const marginX = w * 0.13, usable = w - marginX * 2;
  const widths = [0.94, 0.72, 0.88, 0.56];
  const lines = widths.length;
  const lineH = Math.max(7, h * 0.052);
  const gap = h * 0.135;
  const startY = h * 0.30;
  for (let i = 0; i < lines; i++) {
    const y = startY + i * gap;
    const bw = usable * widths[i];
    // ベース（薄い下地）
    ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
    rrect(ctx, marginX, y, bw, lineH, lineH / 2); ctx.fill();
    // 進捗に応じて行ごとに順番に埋まる（＝タイピング風）
    const p = Math.max(0, Math.min(1, procProgress * lines - i));
    const fw = bw * p;
    if (fw > 1) {
      const g = ctx.createLinearGradient(marginX, 0, marginX + usable, 0);
      g.addColorStop(0, '#4f6ef7'); g.addColorStop(0.6, '#7c5cf6'); g.addColorStop(1, '#ec4899');
      ctx.fillStyle = g;
      rrect(ctx, marginX, y, fw, lineH, lineH / 2); ctx.fill();
      // 点滅キャレット
      if (p < 1 && Math.floor(wavePhase * 3) % 2 === 0) {
        ctx.fillStyle = 'rgba(124, 92, 246, 0.95)';
        rrect(ctx, marginX + fw + 3, y - lineH * 0.25, 3, lineH * 1.5, 1.5); ctx.fill();
      }
    }
  }
}

/**
 * 録音中のゲージ本体。
 * バーの位置は固定で、周囲の音の大きさに応じてその場で上下に伸びる。
 * 静かになると全部が丸い点に戻る。
 */
function drawWaveFrame() {
  const ctx = wave.getContext('2d');
  // 上部は経過時間の表示に譲るため、バーの中心は少し下に置く
  const w = wave.width, h = wave.height, mid = h * 0.6;
  ctx.clearRect(0, 0, w, h);

  // 等間隔・同じ太さで並べる（見た目は白一色のシンプルなゲージ）。
  // 幅から決めた本数から、左右の端を2本ずつ減らして余白を作る。
  const full = Math.max(13, Math.min(25, Math.round(w / 40)));
  const pitch = w / (full + 1);                    // 間隔は端まで並べたときのまま
  const count = Math.max(5, full - 4);             // 端の2本ずつを描かない
  const left = (w - (count - 1) * pitch) / 2;      // 残りを中央に寄せる
  // バーの太さ（無音時の「点」の大きさでもある）。高さに対して太くなりすぎ
  // ないよう抑える（横長の画面でバーが潰れて高さの差が出なくなるのを防ぐ）。
  const barW = Math.max(4, Math.min(Math.round(pitch * 0.32), Math.round(h * 0.1)));
  const maxH = h * 0.6;                            // いちばん大きい声のときの高さ
  const minH = barW;                               // 無音は「点」になる

  if (gaugeBars.length !== count) {
    gaugeBars = [];
    for (let i = 0; i < count; i++) gaugeBars.push(newGaugeBar(i));
  }

  const now = performance.now() / 1000;

  ctx.fillStyle = '#ffffff';

  // 1本のパスにまとめて一度に塗る。
  // （バーごとに fill + shadowBlur すると描画がとても重く、端末によっては
  //   WebView が詰まってネイティブからの音量を受け取れなくなる）
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const b = gaugeBars[i];
    const t = count > 1 ? i / (count - 1) : 0.5;
    // 中央ほど大きく振れる（両端は控えめ）。山はゆるめにして、隣り合う本の
    // 差が「きれいな弧」に見えないようにする。
    const env = 0.55 + 0.45 * Math.pow(Math.sin(Math.PI * t), 0.5);
    // 本ごとに違う間隔で切り替わる乱数（なめらかに繋ぐ）。これが主役で、
    // sin の揺れを少し混ぜる。同じ音量でも本ごとに伸びる長さが変わる。
    const rnd = barRandom(i, now / b.step);
    const s1 = Math.sin(now * b.speed + b.phase);
    const wobble = b.lo + (1 - b.lo) * (0.72 * rnd + 0.28 * (0.5 + 0.5 * s1));
    const target = Math.min(1, waveLevel * b.gain * env * wobble);
    // 伸びるのは即座に、戻るのも速めに（声にきびきび追従させる）
    b.v += (target - b.v) * (target > b.v ? 1 : 0.5);

    b.w = barW;                                    // 太さも揃える
    b.h = Math.max(b.w, minH + (maxH - minH) * b.v);
    b.x = left + i * pitch - b.w / 2;              // 位置は等間隔（ずらさない）
    rrectPath(ctx, b.x, mid - b.h / 2, b.w, b.h, b.w / 2);
  }
  ctx.fill();
}
window.addEventListener('resize', () => { if (waveActive) resizeWave(); });

/* =========================================================
 * 議事録の下書き欄（要点 / 決定事項 / ToDo）
 *   アプリ内のルールベース整形は廃止。議事録は AI（Gemini）で生成し、
 *   この欄には手入力または AI の出力を貼り付けて使う（メール・書き出しの入力元）。
 * =======================================================*/
function toBullets(arr) { return arr.map((x) => '・' + x).join('\n'); }
function fromBullets(str) { return (str || '').split('\n').map((l) => l.replace(/^[・\-*•]\s*/, '').trim()).filter(Boolean); }
function fillMinutesUI(m) {
  legacyMinutes = {
    summary: (m.summary || []).slice(),
    decisions: (m.decisions || []).slice(),
    todos: (m.todos || []).slice(),
  };
}

/** 文字起こしの内容から短い会議タイトルを作る */
function autoTitleFromTranscript(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  let s = (t.split(/[。．.!！?？\n]/)[0] || t).trim();
  if (!s) s = t;
  if (s.length > 24) s = s.slice(0, 24) + '…';
  return s;
}
/**
 * AI議事録の本文から会議名らしい1行を拾う。
 * 「【議事録】」等の見出しや箇条書き記号は飛ばし、最初の中身のある行を使う。
 */
function autoTitleFromAiText(text) {
  const lines = String(text || '').split('\n');
  for (let line of lines) {
    line = line.replace(/^[\s#*>・\-–—•]+/, '').trim();
    if (!line) continue;
    if (/^[【\[(（]?(議事録|要点|見出し|決定事項|ToDo|やること|メール文面|件名)/i.test(line)) {
      // 「件名: 〇〇」は中身がタイトルとして使える
      const m = line.match(/^[【\[(（]?件名[】\])）]?\s*[:：]?\s*(.+)$/);
      if (m && m[1].trim()) return autoTitleFromTranscript(m[1]);
      continue;
    }
    return autoTitleFromTranscript(line);
  }
  return '';
}
/** タイトルが未入力なら、文字起こし（無ければAI議事録）から自動生成してフィールドへ反映 */
let autoTitleApplied = '';   // 自動で付けたタイトル（リセット時にこれだけ消す）
function ensureAutoTitle() {
  if (meetingName.value.trim()) return;
  // 音声をそのままAIに送る運用では文字起こしが空になるため、AIの結果からも拾う
  const t = autoTitleFromTranscript(liveTranscript.value)
         || autoTitleFromAiText(aiResult ? aiResult.value : '');
  if (t) { meetingName.value = t; autoTitleApplied = t; updateMeetingSummary(); }
}

/* =========================================================
 * 出力（txt / md / docx / mailto）
 * =======================================================*/
function currentMinutes() {
  return {
    name: meetingName.value.trim() || autoTitleFromTranscript(liveTranscript.value) || '議事録',
    date: meetingDate.value || todayStr(),
    time: recordingTimeText(),      // 録音した実時間（開始〜終了・長さ）
    participants: participants.slice(),
    summary: legacyMinutes.summary.slice(),
    decisions: legacyMinutes.decisions.slice(),
    todos: legacyMinutes.todos.slice(),
    ai: (aiResult && aiResult.value.trim()) || '',
  };
}
/** 「14:23〜15:10（47分00秒）」の形で、録音した実時間を返す（無ければ空） */
function recordingTimeText() {
  const sec = Math.round(recordedDurationSec || 0);
  if (!recStartedAt || !sec) return '';
  const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const st = new Date(recStartedAt);
  const en = new Date(recStartedAt + sec * 1000);
  return `${hm(st)}〜${hm(en)}（${formatDurationJp(sec)}）`;
}

function participantLabel(p) { return p.dept ? (p.name ? `${p.dept} ${p.name}` : p.dept) : (p.name || ''); }
function participantsText(list) { return (list || []).map(participantLabel).filter(Boolean).join('、'); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function safeFileName(m) { return `${m.name}_${m.date}`.replace(/[\\/:*?"<>|\s]+/g, '_'); }

/** 要点／決定事項／ToDo に中身があるか（無ければ AI議事録の本文をそのまま使う） */
function hasStructuredMinutes(m) {
  return !!(m.summary.length || m.decisions.length || m.todos.length);
}
function buildPlainText(m) {
  const lines = [];
  lines.push(m.name);
  lines.push(`日付: ${formatDateJp(m.date)}`);
  if (m.time) lines.push(`時間: ${m.time}`);
  if (m.participants && m.participants.length) lines.push(`参加者: ${participantsText(m.participants)}`);
  if (!hasStructuredMinutes(m) && m.ai) { lines.push('', m.ai); return lines.join('\n'); }
  lines.push('', '■ 要点・見出し', m.summary.length ? toBullets(m.summary) : '（なし）');
  lines.push('', '■ 決定事項', m.decisions.length ? toBullets(m.decisions) : '（なし）');
  lines.push('', '■ ToDo', m.todos.length ? toBullets(m.todos) : '（なし）');
  return lines.join('\n');
}
function buildMarkdown(m) {
  const sec = (t, arr) => `## ${t}\n\n` + (arr.length ? arr.map((x) => `- ${x}`).join('\n') : '（なし）') + '\n';
  const parts = (m.participants && m.participants.length) ? `**参加者:** ${participantsText(m.participants)}\n\n` : '';
  const time = m.time ? `**時間:** ${m.time}\n\n` : '';
  const head = `# ${m.name}\n\n**日付:** ${formatDateJp(m.date)}\n\n${time}${parts}`;
  if (!hasStructuredMinutes(m) && m.ai) return head + m.ai + '\n';
  return head + sec('要点・見出し', m.summary) + '\n' + sec('決定事項', m.decisions) + '\n' + sec('ToDo', m.todos);
}
function download(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* 書き出しは「書き出し」カードを廃止し、議事録の枠内「ダウンロード」からのみ呼ぶ */
function exportTxtNow() { const m = currentMinutes(); download(`${safeFileName(m)}.txt`, buildPlainText(m), 'text/plain;charset=utf-8'); }
function exportMdNow() { const m = currentMinutes(); download(`${safeFileName(m)}.md`, buildMarkdown(m), 'text/markdown;charset=utf-8'); }

async function exportDocxNow() {
  const m = currentMinutes();
  if (!window.docx) { showError('Word 出力ライブラリの読み込みに失敗しました（オンライン環境で再読み込みしてください）。'); return; }
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = window.docx;
  const bulletParas = (arr) => arr.length
    ? arr.map((t) => new Paragraph({ text: t, bullet: { level: 0 } }))
    : [new Paragraph({ children: [new TextRun({ text: '（なし）', italics: true })] })];
  const doc = new Document({ sections: [{ children: [
    new Paragraph({ text: m.name, heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun({ text: `日付: ${formatDateJp(m.date)}`, bold: true })] }),
    ...(m.time ? [new Paragraph({ children: [new TextRun({ text: `時間: ${m.time}` })] })] : []),
    ...(m.participants && m.participants.length ? [new Paragraph({ children: [new TextRun({ text: `参加者: ${participantsText(m.participants)}` })] })] : []),
    ...(!hasStructuredMinutes(m) && m.ai
      ? m.ai.split('\n').map((t) => new Paragraph({ text: t }))
      : [
        new Paragraph({ text: '要点・見出し', heading: HeadingLevel.HEADING_1 }), ...bulletParas(m.summary),
        new Paragraph({ text: '決定事項', heading: HeadingLevel.HEADING_1 }), ...bulletParas(m.decisions),
        new Paragraph({ text: 'ToDo', heading: HeadingLevel.HEADING_1 }), ...bulletParas(m.todos),
      ]),
  ] }] });
  try {
    const blob = await Packer.toBlob(doc);
    download(`${safeFileName(m)}.docx`, blob, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  } catch (err) { showError('Word 出力に失敗しました: ' + (err && err.message ? err.message : err)); }
}


/* =========================================================
 * メール作成（既定メーラー / .eml / 件名＋本文のコピー）
 * =======================================================*/
function buildMailSubject(m) { return `【議事録】${m.name}（${formatDateJp(m.date)}）`; }
/** 件名・本文が空のときだけ、議事録から組み立てて埋める（手で直した内容は残す） */
function prepareMailFromMinutes() {
  const m = currentMinutes();
  if (!mailSubject.value.trim()) mailSubject.value = buildMailSubject(m);
  if (!mailBody.value.trim()) mailBody.value = buildPlainText(m);
}
mailThunderbird.addEventListener('click', () => {
  const to = mailTo.value.trim();
  const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(mailSubject.value)}&body=${encodeURIComponent(mailBody.value)}`;
  window.location.href = href;
});
mailEml.addEventListener('click', () => {
  const to = mailTo.value.trim();
  const eml =
    (to ? `To: ${to}\n` : '') +
    `Subject: ${mailSubject.value}\n` +
    `X-Unsent: 1\n` +
    `Content-Type: text/plain; charset=UTF-8\n\n` +
    mailBody.value;
  const m = currentMinutes();
  download(`${safeFileName(m)}.eml`, eml, 'message/rfc822;charset=utf-8');
});
mailCopy.addEventListener('click', async () => {
  // 件名と本文をまとめてコピーする（メールアプリへそのまま貼り付けられるように）
  const subject = mailSubject.value.trim();
  const text = (subject ? `件名: ${subject}\n\n` : '') + mailBody.value;
  const ok = await copyText(text);
  if (ok) { hideError(); showToast('件名と本文をコピーしました'); }
  else showError('コピーに失敗しました。');
});

/* =========================================================
 * 変換辞書（読み → 漢字）＋ 用語の確認・修正
 *   「しんけんこう」→「新建高」のように、読み（ひらがな）や誤変換と
 *   正しい表記をセットで登録する辞書。文字起こし・AI文字起こし・AI議事録・
 *   メール文面で自動的に参照され、AIへ渡す指示にも用語集として付く。
 *   設定画面と「用語の確認・修正」の両方から追加・変更できる。
 * =======================================================*/
const TERM_KEY = 'noteloop_terms';
const DICT_AUTO_KEY = 'noteloop_dict_auto';
let termDict = [];         // [{ from: '読み・誤変換', to: '正しい表記' }]
let dictAutoApply = true;  // 自動変換のオン / オフ

function loadTermDict() {
  let raw = [];
  try { raw = JSON.parse(localStorage.getItem(TERM_KEY)) || []; } catch (_) { raw = []; }
  // 旧形式 { wrong, right } で保存された辞書もそのまま引き継ぐ
  termDict = (Array.isArray(raw) ? raw : [])
    .map((t) => ({
      from: String((t && (t.from != null ? t.from : t.wrong)) || '').trim(),
      to: String((t && (t.to != null ? t.to : t.right)) || '').trim(),
    }))
    .filter((t) => t.from);
  dictAutoApply = localStorage.getItem(DICT_AUTO_KEY) !== '0';
  if (dictAuto) dictAuto.checked = dictAutoApply;
}
function saveTermDict() { localStorage.setItem(TERM_KEY, JSON.stringify(termDict)); }

/* ---- 変換の実処理 ---- */
const toKatakana = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const toHiragana = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** 登録語の表記ゆれ（ひらがな / カタカナ）をまとめて返す */
function dictVariants(from) {
  const set = new Set([from, toKatakana(from), toHiragana(from)]);
  set.delete('');
  return [...set];
}
function countIn(text, s) { return s ? text.split(s).length - 1 : 0; }
/** 長い語から先に置換する（「新建高校」が「新建高」に食われないように） */
function sortedDict() { return termDict.slice().sort((a, b) => b.from.length - a.from.length); }

/**
 * 辞書1件をテキストへ適用し、{ text, n（置換件数）} を返す。
 * 「田中 → 田中商事」のように変換後が変換前を含む場合、
 *   - safe=true（自動変換）: 何度でも呼ばれるため適用しない（伸び続けるのを防ぐ）
 *   - safe=false（手動適用）: 変換済みの箇所を一時退避してから置換（二重変換なし）
 */
function applyDictEntry(text, t, safe) {
  let out = text, n = 0;
  if (!t.from || !t.to || t.from === t.to) return { text: out, n };
  for (const v of dictVariants(t.from)) {
    if (!v || v === t.to) continue;
    if (t.to.includes(v)) {
      if (safe) continue;
      const MARK = '\u0000';
      const held = out.split(t.to).join(MARK);   // すでに正しい表記の箇所を退避
      n += countIn(held, v);
      out = held.split(v).join(t.to).split(MARK).join(t.to);
    } else {
      n += countIn(out, v);
      out = out.split(v).join(t.to);
    }
  }
  return { text: out, n };
}

/** 辞書を本文に適用する（表記ゆれのカタカナも拾う） */
function convertWithDict(text, safe = true) {
  if (!text || !termDict.length) return text;
  let out = text;
  for (const t of sortedDict()) out = applyDictEntry(out, t, safe).text;
  return out;
}
/** 自動変換が有効なときだけ辞書を適用（文字起こし・AI結果の経路から呼ばれる） */
function autoConvert(text) { return dictAutoApply ? convertWithDict(text) : text; }

/** 文字起こし・AI文字起こし・AI議事録・メール本文へ辞書を適用し、置換件数を返す */
function applyDictToAll(safe = false) {
  let total = 0;
  for (const el of [liveTranscript, aiTextEl, aiResult, mailBody]) {
    if (!el || !el.value) continue;
    let out = el.value, n = 0;
    for (const t of sortedDict()) { const r = applyDictEntry(out, t, safe); out = r.text; n += r.n; }
    if (out !== el.value) el.value = out;
    total += n;
  }
  if (total > 0) updateHomeUI();
  return total;
}

/** AIへ渡す指示に付ける用語集 */
function dictPromptBlock() {
  const lines = termDict.filter((t) => t.from && t.to).map((t) => `- ${t.from} → ${t.to}`);
  if (!lines.length) return '';
  return `\n\n【用語辞書（左の読み・誤変換は右の表記に統一してください）】\n${lines.join('\n')}`;
}
/** 録音中のライブ文字起こし用（短くまとめた1行の用語ヒント） */
function dictPromptLine() {
  const pairs = termDict.filter((t) => t.from && t.to).slice(0, 30).map((t) => `${t.from}→${t.to}`);
  if (!pairs.length) return '';
  return `・次の語はこの表記で書いてください: ${pairs.join('、')}\n`;
}

/** 文字起こし・AI文字起こし・AI議事録・メール本文をまとめて一括置換する */
function replaceAllInTranscript(wrong, right) {
  if (!wrong) return 0;
  let n = 0;
  for (const el of [liveTranscript, aiTextEl, aiResult, mailBody]) {
    if (!el || !el.value) continue;
    const parts = el.value.split(wrong);
    if (parts.length < 2) continue;
    n += parts.length - 1;
    el.value = parts.join(right);
  }
  if (n > 0) updateHomeUI();
  return n;
}
function renderTermDict() {
  termDictList.innerHTML = '';
  if (!termDict.length) {
    const li = document.createElement('li'); li.className = 'term-dict-empty';
    li.textContent = 'まだ登録された用語はありません。上で「辞書に登録」できます。';
    termDictList.appendChild(li); return;
  }
  termDict.forEach((t, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="tp"><span class="wrong"></span><span class="arrow">→</span><span class="right"></span></span>
      <span class="acts"><button class="t-apply" type="button">適用</button><button class="t-del" type="button">削除</button></span>`;
    li.querySelector('.wrong').textContent = t.from;
    li.querySelector('.right').textContent = t.to;
    li.querySelector('.t-apply').addEventListener('click', () => { const n = replaceAllInTranscript(t.from, t.to); showTermNote(`「${t.from}」を ${n} 件置換しました。`); });
    li.querySelector('.t-del').addEventListener('click', () => { termDict.splice(i, 1); saveTermDict(); renderDicts(); });
    termDictList.appendChild(li);
  });
}

/* ---- 設定画面の変換辞書（追加・変更・削除） ---- */
function showDictNote(msg) { if (dictNote) dictNote.textContent = msg; }
function renderDictSettings() {
  if (!dictList) return;
  dictList.innerHTML = '';
  if (!termDict.length) {
    const li = document.createElement('li'); li.className = 'word-dict-empty';
    li.textContent = 'まだ登録された用語はありません。上の欄から追加してください。';
    dictList.appendChild(li); return;
  }
  termDict.forEach((t, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<input class="d-from" type="text" aria-label="読み・誤変換" />
      <span class="d-arrow" aria-hidden="true">→</span>
      <input class="d-to" type="text" aria-label="正しい表記" />
      <button class="d-del" type="button">削除</button>`;
    const fromEl = li.querySelector('.d-from'), toEl = li.querySelector('.d-to');
    fromEl.value = t.from; toEl.value = t.to;
    const commit = () => {
      const nf = fromEl.value.trim(), nt = toEl.value.trim();
      if (!nf) { fromEl.value = termDict[i].from; return; }  // 空にはできない（削除ボタンで消す）
      termDict[i] = { from: nf, to: nt };
      saveTermDict(); renderTermDict();
      showDictNote(`「${nf}」→「${nt}」に更新しました。`);
    };
    fromEl.addEventListener('change', commit);
    toEl.addEventListener('change', commit);
    li.querySelector('.d-del').addEventListener('click', () => {
      const removed = termDict[i];
      termDict.splice(i, 1); saveTermDict(); renderDicts();
      showDictNote(`「${removed.from}」を削除しました。`);
    });
    dictList.appendChild(li);
  });
}
function renderDicts() { renderTermDict(); renderDictSettings(); }

function addDictEntry() {
  const f = (dictFrom.value || '').trim(), t = (dictTo.value || '').trim();
  if (!f || !t) { showDictNote('「読み・誤変換」と「正しい表記」を両方入力してください。'); return; }
  if (f === t) { showDictNote('変換前と変換後が同じです。'); return; }
  const idx = termDict.findIndex((x) => x.from === f);
  if (idx >= 0) termDict[idx].to = t; else termDict.push({ from: f, to: t });
  saveTermDict(); renderDicts();
  dictFrom.value = ''; dictTo.value = '';
  dictFrom.focus();
  showDictNote(`「${f}」→「${t}」を登録しました。以後、文字起こし・AI議事録の作成時に自動で変換します。`);
}
if (dictAdd) dictAdd.addEventListener('click', addDictEntry);
[dictFrom, dictTo].forEach((el) => {
  if (!el) return;
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addDictEntry(); } });
});
if (dictAuto) dictAuto.addEventListener('change', () => {
  dictAutoApply = dictAuto.checked;
  localStorage.setItem(DICT_AUTO_KEY, dictAutoApply ? '1' : '0');
  showDictNote(dictAutoApply
    ? '文字起こし・AI議事録の作成時に、登録した用語を自動で変換します。'
    : '自動変換はオフです。枠の「用語修正」から手動で置換できます。');
});
if (dictApplyNow) dictApplyNow.addEventListener('click', () => {
  if (!termDict.length) { showDictNote('登録された用語がありません。'); return; }
  const n = applyDictToAll(false);
  showDictNote(n > 0
    ? `文字起こし・AI議事録・メール本文に辞書を適用しました（計 ${n} 件置換）。`
    : '置換する語は見つかりませんでした。');
});
function showTermNote(msg) { termFoundNote.textContent = msg; }
function openTermModal(note) {
  showTermNote(note || '会社名や固有名詞など、誤変換された語を正しい語に一括置換できます。');
  renderTermDict();
  termModal.hidden = false;
  requestAnimationFrame(() => termModal.classList.add('show'));
}
function closeTermModal() {
  termModal.classList.remove('show');
  setTimeout(() => { if (!termModal.classList.contains('show')) termModal.hidden = true; }, 260);
}
termModalClose.addEventListener('click', closeTermModal);
termModalDone.addEventListener('click', closeTermModal);
termModal.addEventListener('click', (e) => { if (e.target === termModal) closeTermModal(); });
termApply.addEventListener('click', () => {
  const w = termWrong.value.trim(), r = termRight.value.trim();
  if (!w) { showTermNote('「誤り」の語を入力してください。'); return; }
  const n = replaceAllInTranscript(w, r);
  showTermNote(`「${w}」を ${n} 件置換しました。`);
});
termRegister.addEventListener('click', () => {
  const w = termWrong.value.trim(), r = termRight.value.trim();
  if (!w || !r) { showTermNote('「誤り」と「正しい」を両方入力してください。'); return; }
  const idx = termDict.findIndex((t) => t.from === w);
  if (idx >= 0) termDict[idx].to = r; else termDict.push({ from: w, to: r });
  saveTermDict(); renderDicts();
  showTermNote(`辞書に登録しました。以後、文字起こし・AI議事録の作成時に「${w}」を「${r}」へ自動変換します（設定でも変更できます）。`);
});
termApplyAll.addEventListener('click', () => {
  const total = applyDictToAll(false);
  showTermNote(`登録用語をすべて適用しました（計 ${total} 件置換）。`);
});
/**
 * 録音後の辞書チェック。
 * 自動変換がオンなら確定した文字起こしへ辞書を適用し、
 * オフのときだけ「用語の確認・修正」ポップアップを開く。
 */
function checkTerms() {
  if (!termDict.length) return;
  if (dictAutoApply) { applyDictToAll(true); return; }
  const text = liveTranscript.value;
  const found = termDict.filter((t) => t.from && text.includes(t.from));
  if (found.length) {
    openTermModal(`「${found.map((t) => t.from).join('」「')}」が見つかりました。正しい語に一括修正できます。`);
  }
}

/* =========================================================
 * 音声ファイルの出力
 * =======================================================*/
function formatBytes(bytes) {
  if (!bytes) return '';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0, n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
function extFromMime(mime) {
  if (!mime) return 'webm';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}
downloadAudio.addEventListener('click', () => {
  if (!recordedBlob) { showError('保存できる音声がありません。先に録音してください。'); return; }
  hideError();
  const m = currentMinutes();
  download(`${safeFileName(m)}.${extFromMime(recordedBlob.type)}`, recordedBlob, recordedBlob.type || 'audio/webm');
});
/* =========================================================
 * 参加者（部署・氏名）
 * =======================================================*/
function renderParticipants() {
  partList.innerHTML = '';
  participants.forEach((p, idx) => {
    const li = document.createElement('li');
    li.className = 'participant-chip';
    const span = document.createElement('span');
    if (p.dept) { const d = document.createElement('span'); d.className = 'dept'; d.textContent = p.dept; span.appendChild(d); }
    if (p.name) span.appendChild(document.createTextNode((p.dept ? ' ' : '') + p.name));
    li.appendChild(span);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.textContent = '×'; btn.setAttribute('aria-label', '削除');
    btn.addEventListener('click', () => { participants.splice(idx, 1); renderParticipants(); });
    li.appendChild(btn);
    partList.appendChild(li);
  });
  updateMeetingSummary();
}
partDept.addEventListener('change', () => {
  const other = partDept.value === '__other';
  partDeptOther.hidden = !other;
  if (other) partDeptOther.focus();
});
partAdd.addEventListener('click', () => {
  const dept = partDept.value === '__other' ? partDeptOther.value.trim() : partDept.value;
  const name = partName.value.trim();
  if (!dept && !name) { showError('部署を選ぶか、氏名を入力してください。'); return; }
  hideError();
  participants.push({ dept, name });
  renderParticipants();
  partName.value = ''; partDeptOther.value = ''; partDept.value = ''; partDeptOther.hidden = true;
});
partName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); partAdd.click(); } });

/* ===== 会議情報ポップアップ ===== */
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function updateMeetingSummary() {
  const name = meetingName.value.trim();
  const date = meetingDate.value;
  const pt = participantsText(participants);
  if (!name && !pt && !date) { meetingSummary.innerHTML = ''; return; }
  let html = `<span class="ms-title">${escapeHtml(name || '（タイトル未設定）')}</span>`;
  if (date) html += ` ・ ${escapeHtml(formatDateJp(date))}`;
  const time = recordingTimeText();
  if (time) html += `<br>時間: ${escapeHtml(time)}`;
  if (pt) html += `<br>参加者: ${escapeHtml(pt)}`;
  meetingSummary.innerHTML = html;
}
// 会議情報・マイク設定を1画面（モーダル）で開く。マイクのレベルメーターもここで開始/停止する。
async function openMeetingModal() {
  meetingModal.hidden = false;
  requestAnimationFrame(() => meetingModal.classList.add('show'));
  await populateMicSelects();
  if (recording) {
    // 録音中: 別ストリームは開かず、録音側 analyser でレベルを表示。
    if (micPermNoteHome) micPermNoteHome.hidden = true;
    if (micRecNote) {
      micRecNote.hidden = false;
      micRecNote.textContent = activeEngine === 'webspeech'
        ? '録音中です。マイクを切り替えると録音音声に反映されます（音声認識のマイクはブラウザの既定が使われます）。'
        : '録音中です。マイクを切り替えると、その場で録音に反映されます。';
    }
    startModalRecMeter();
  } else {
    if (micRecNote) micRecNote.hidden = true;
    const ok = await homeMicMeter.start(getSavedMicId());
    if (micPermNoteHome) micPermNoteHome.hidden = ok;
  }
}
function closeMeetingModal() {
  stopModalRecMeter();
  homeMicMeter.stop();
  meetingModal.classList.remove('show');
  setTimeout(() => { if (!meetingModal.classList.contains('show')) meetingModal.hidden = true; }, 260);
  updateMeetingSummary();
}

// ホーム右下のツールボタン → 会議情報・マイク設定の1画面を開く
const homeToolsBtn = $('homeToolsBtn');
if (homeToolsBtn) homeToolsBtn.addEventListener('click', openMeetingModal);
meetingModalClose.addEventListener('click', closeMeetingModal);
meetingModalDone.addEventListener('click', closeMeetingModal);
meetingModal.addEventListener('click', (e) => { if (e.target === meetingModal) closeMeetingModal(); });
meetingName.addEventListener('input', updateMeetingSummary);
meetingDate.addEventListener('input', updateMeetingSummary);

/* =========================================================
 * マイク選択 / 入力レベル（ゲイン）表示
 *   ・録音に使うマイクをユーザーが選べるようにする（端末に保存）
 *   ・選択したマイクの入力レベルをリアルタイムのバーで表示
 *   ・マイクボタンのポップアップと設定ページの両方で共通利用
 * =======================================================*/
const MIC_KEY = 'noteloop_mic_device';
function getSavedMicId() { try { return localStorage.getItem(MIC_KEY) || ''; } catch (_) { return ''; } }
function setSavedMicId(id) {
  try { if (id) localStorage.setItem(MIC_KEY, id); else localStorage.removeItem(MIC_KEY); } catch (_) {}
}

/**
 * 保存済みの選択マイクで録音用ストリームを取得する。
 * 選択デバイスが使えない場合は既定マイクにフォールバックする。
 */
async function getMicStream() {
  const id = getSavedMicId();
  if (id) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: id } } });
    } catch (err) {
      // 選択したマイクが抜かれた等で使えない → 既定に戻して続行
      if (err && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
        setSavedMicId('');
        syncMicSelects();
      } else {
        throw err;
      }
    }
  }
  return await navigator.mediaDevices.getUserMedia({ audio: true });
}

/**
 * 入力レベルメーターの生成。指定した mask 要素の幅で「右からの覆い」を動かし、
 * 左からの塗り（＝入力レベル）を表現する。start(deviceId) でマイクを掴み、stop() で解放。
 */
function createMicMeter(maskEl) {
  let ctx = null, stream = null, analyser = null, raf = null, buf = null, active = false;
  function setLevel(level) {
    if (!maskEl) return;
    const pct = Math.max(0, Math.min(100, Math.round((1 - level) * 100)));
    maskEl.style.width = pct + '%';
  }
  function loop() {
    if (!active || !analyser) return;
    raf = requestAnimationFrame(loop);
    analyser.getByteTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; s += x * x; }
    const rms = Math.sqrt(s / buf.length);
    setLevel(Math.min(1, Math.max(0, rms * 6))); // ゲイン: 通常の発話で見やすい範囲に増幅
  }
  async function start(deviceId) {
    stop();
    try {
      stream = await navigator.mediaDevices.getUserMedia(
        deviceId ? { audio: { deviceId: { exact: deviceId } } } : { audio: true });
    } catch (_) {
      // 選択デバイスが使えなければ既定で再試行
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (_2) { stream = null; setLevel(0); return false; }
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') await ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      buf = new Uint8Array(analyser.fftSize);
      active = true;
      loop();
      return true;
    } catch (_) { stop(); return false; }
  }
  function stop() {
    active = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    try { if (analyser) analyser.disconnect(); } catch (_) {}
    try { if (ctx) ctx.close(); } catch (_) {}
    ctx = analyser = buf = null;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    setLevel(0);
  }
  return { start, stop, isActive: () => active };
}

const homeMicMeter = createMicMeter(micMeterHomeMask);
const settingsMicMeter = createMicMeter(micMeterSettingsMask);

/** 端末のマイク一覧を取得して両方の select を埋める（保存済みの選択を反映） */
async function populateMicSelects() {
  let devices = [];
  try { devices = await navigator.mediaDevices.enumerateDevices(); } catch (_) {}
  const mics = devices.filter((d) => d.kind === 'audioinput');
  const saved = getSavedMicId();
  const want = saved && mics.some((m) => m.deviceId === saved) ? saved : '';
  [micSelectHome, micSelectSettings].forEach((sel) => {
    if (!sel) return;
    sel.innerHTML = '';
    const def = document.createElement('option');
    def.value = ''; def.textContent = '既定のマイク（自動選択）';
    sel.appendChild(def);
    mics.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `マイク ${i + 1}`;
      sel.appendChild(o);
    });
    sel.value = want;
  });
}

/** 両方の select の表示値を保存済みの選択に合わせる */
function syncMicSelects() {
  const saved = getSavedMicId();
  [micSelectHome, micSelectSettings].forEach((sel) => {
    if (!sel) return;
    const has = Array.from(sel.options).some((o) => o.value === saved);
    sel.value = has ? saved : '';
  });
}

/** 設定画面のマイク入力レベルを開始（権限取得→一覧更新） */
async function activateSettingsMic() {
  if (!micMeterSettingsMask) return;
  const ok = await settingsMicMeter.start(getSavedMicId());
  await populateMicSelects();
  if (micPermNoteSettings) micPermNoteSettings.hidden = ok;
}

/* --- 録音中のポップアップ用: 録音側 analyser からレベル表示 --- */
let modalRecMeterRaf = null;
function startModalRecMeter() {
  stopModalRecMeter();
  const buf = new Uint8Array(1024);
  const tick = () => {
    if (!recording || !analyser) { stopModalRecMeter(); return; }
    modalRecMeterRaf = requestAnimationFrame(tick);
    analyser.getByteTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; s += x * x; }
    const level = Math.min(1, Math.max(0, Math.sqrt(s / buf.length) * 6));
    if (micMeterHomeMask) micMeterHomeMask.style.width = Math.round((1 - level) * 100) + '%';
  };
  tick();
}
function stopModalRecMeter() {
  if (modalRecMeterRaf) cancelAnimationFrame(modalRecMeterRaf);
  modalRecMeterRaf = null;
}

/* --- マイク設定は会議情報モーダルに統合（旧マイク単独モーダルは廃止） --- */
// 設定画面等のマイク選択リンクからも同じ1画面を開く。
if (openMicSelect) openMicSelect.addEventListener('click', openMeetingModal);

// ポップアップのマイク選択: 録音中は録音マイクを差し替え、待機中はメーターを付け替え
if (micSelectHome) micSelectHome.addEventListener('change', async () => {
  const v = micSelectHome.value;
  setSavedMicId(v);
  syncMicSelects();
  if (recording) {
    const ok = await switchRecordingMic(v);
    if (micPermNoteHome) micPermNoteHome.hidden = ok;
    startModalRecMeter(); // 新しいマイクの analyser でレベル表示を継続
  } else {
    const ok = await homeMicMeter.start(getSavedMicId());
    if (micPermNoteHome) micPermNoteHome.hidden = ok;
  }
});

// 設定のマイク選択: 録音中なら録音マイクも差し替え、メーターは常に最新デバイスを表示
if (micSelectSettings) micSelectSettings.addEventListener('change', async () => {
  const v = micSelectSettings.value;
  setSavedMicId(v);
  syncMicSelects();
  if (recording) await switchRecordingMic(v);
  const ok = await settingsMicMeter.start(getSavedMicId());
  if (micPermNoteSettings) micPermNoteSettings.hidden = ok;
});

// マイクの抜き差し等でデバイス構成が変わったら一覧を更新
if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
  navigator.mediaDevices.addEventListener('devicechange', () => { populateMicSelects(); });
}

/* =========================================================
 * IndexedDB（録音音声の保存）
 * =======================================================*/
const IDB_NAME = 'noteloop', IDB_STORE = 'audio';
function idbOpen() {
  return new Promise((res, rej) => {
    let r;
    try { r = indexedDB.open(IDB_NAME, 1); } catch (e) { return rej(e); }
    r.onupgradeneeded = () => { try { r.result.createObjectStore(IDB_STORE); } catch (_) {} };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function idbPut(key, val) { return idbOpen().then((db) => new Promise((res, rej) => { const tx = db.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).put(val, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); })); }
function idbGet(key) { return idbOpen().then((db) => new Promise((res, rej) => { const tx = db.transaction(IDB_STORE, 'readonly'); const rq = tx.objectStore(IDB_STORE).get(key); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => rej(rq.error); })); }
function idbDel(key) { return idbOpen().then((db) => new Promise((res) => { const tx = db.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).delete(key); tx.oncomplete = () => res(); tx.onerror = () => res(); })).catch(() => {}); }

/* =========================================================
 * 録音終了時の自動保存（文字起こし＋音声、最大10件）
 * =======================================================*/
let activeRecordingId = null; // 録音停止時に作成した履歴エントリの id（後で文字起こしを追記）

/** 会議名が未入力のときの既定タイトル（録音日時ベース） */
function defaultRecordingTitle() {
  const name = meetingName.value.trim();
  if (name) return name;
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `録音 ${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

/**
 * 録音停止直後に、まず「録音音声＋会議情報」を履歴へ保存する。
 * 文字起こしの成否に関わらずデータを残すのが目的（文字起こしは後から追記）。
 */
async function saveRecordingNow() {
  const id = 'rec-' + Date.now() + '-' + Math.floor(performance.now());
  activeRecordingId = id;
  let audio = null;
  if (recordedBlob) {
    try { await idbPut(id, recordedBlob); audio = { ext: extFromMime(recordedBlob.type), size: recordedBlob.size, sec: Math.round(recordedDurationSec || 0) }; }
    catch (_) { audio = null; }
  }
  const m = currentMinutes();
  const entry = {
    id, name: defaultRecordingTitle(), date: m.date, participants: m.participants,
    transcript: liveTranscript.value.trim(), summary: [], decisions: [], todos: [],
    audio, ts: Date.now(), auto: true,
    startedAt: recStartedAt || null,   // 録音の実時間を後から出せるように残す
  };
  const list = loadStore();
  list.push(entry);
  while (list.length > 10) { const removed = list.shift(); if (removed && removed.audio) idbDel(removed.id); }
  saveStore(list);
  renderHistory();
}

/**
 * 文字起こし完了後に、保存済みエントリへ文字起こし（とタイトル）を追記する。
 * saveRecordingNow で作成したエントリが無ければ（音声なしの Web Speech 等）新規作成する。
 */
async function finalizeRecordingSave() {
  const transcript = liveTranscript.value.trim();
  ensureAutoTitle();  // タイトル未設定なら文字起こしから自動生成
  const list = loadStore();
  const idx = activeRecordingId ? list.findIndex((e) => e.id === activeRecordingId) : -1;

  if (idx >= 0) {
    // 既存エントリを更新（文字起こしと、既定タイトルのままなら会議名を反映）
    const entry = list[idx];
    entry.transcript = transcript;
    const nm = meetingName.value.trim();
    if (nm) entry.name = nm;
    else if (!transcript && !entry.transcript) entry.name = entry.name; // 変更なし
    else if (transcript && /^録音 /.test(entry.name)) entry.name = autoTitleFromTranscript(transcript) || entry.name;
    entry.date = meetingDate.value || entry.date;
    entry.participants = participants.slice();
    saveStore(list);
    renderHistory();
    updateHomeUI();
    return;
  }

  // 新規（音声を保存していない Web Speech 等）。文字起こしが無ければ保存しない。
  if (!transcript) { updateHomeUI(); return; }
  const m = currentMinutes();
  const id = 'rec-' + Date.now() + '-' + Math.floor(performance.now());
  let audio = null;
  if (recordedBlob) {
    try { await idbPut(id, recordedBlob); audio = { ext: extFromMime(recordedBlob.type), size: recordedBlob.size, sec: Math.round(recordedDurationSec || 0) }; }
    catch (_) { audio = null; }
  }
  list.push({ id, name: m.name, date: m.date, participants: m.participants,
    transcript, summary: m.summary, decisions: m.decisions, todos: m.todos,
    audio, ts: Date.now(), auto: true });
  while (list.length > 10) { const removed = list.shift(); if (removed && removed.audio) idbDel(removed.id); }
  saveStore(list);
  renderHistory();
}

/* =========================================================
 * 過去の議事録一覧（localStorage）
 * =======================================================*/
const STORE_KEY = 'noteloop_minutes_v1';
function loadStore() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (_) { return []; } }
function saveStore(list) { localStorage.setItem(STORE_KEY, JSON.stringify(list)); }
const SEEDED_KEY = 'noteloop_seeded_v1';
function seedIfEmpty() {
  let list = loadStore();
  // サンプルは「初回のみ」投入する。以後は空でも再投入しないので、
  // ユーザーが削除した項目が再読込で復活しない（＝消したら消えたまま）。
  if (list.length === 0 && !localStorage.getItem(SEEDED_KEY)) {
    list = [
      { id: 'seed-1', name: '週次定例MTG', date: '2026-07-14',
        summary: ['来月のリリース計画について協議した'],
        decisions: ['リリースを1週間延期することを決定', 'QA体制を再確認する方針で合意'],
        todos: ['テスト計画を更新する（担当: 田中）', 'QA体制の調整を進める（担当: 佐藤）', '関係者へ共有する（担当: 鈴木）'], _sample: true },
      { id: 'seed-2', name: '開発キックオフ', date: '2026-07-11',
        summary: ['新規プロジェクトの体制とスケジュールを確認した'],
        decisions: ['開発は2週間スプリントで進めることを決定'],
        todos: ['環境構築を今週中に実施する', '要件一覧を作成して共有する'], _sample: true },
    ];
    saveStore(list);
  }
  localStorage.setItem(SEEDED_KEY, '1'); // 初回投入済みを記録（以後は再投入しない）
  renderHistory();
}
function renderHistory() {
  const list = loadStore();
  historyList.innerHTML = '';
  if (list.length === 0) {
    const li = document.createElement('li');
    li.className = 'history-empty';
    li.textContent = 'まだ保存された議事録はありません。';
    historyList.appendChild(li);
    return;
  }
  for (const item of list.slice().reverse()) {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.setAttribute('role', 'button');
    li.tabIndex = 0;
    const range = historyTimeRange(item);   // 録音した時間帯（10:05〜10:52）
    const sec = (item.audio && item.audio.sec) || 0;
    const size = (item.audio && item.audio.size) || 0;
    li.innerHTML = `<h3></h3><span class="meta"></span><p class="excerpt"></p>
      <div class="history-foot">
        <span class="history-stats">
          <span class="stat stat-time" hidden>${ICO_CLOCK}<span></span></span>
          <span class="stat stat-size" hidden>${ICO_DISC}<span></span></span>
        </span>
        <button class="del icon-btn" type="button" aria-label="削除">${ICO_TRASH}</button>
      </div>`;
    li.querySelector('h3').textContent = item.name + (item._sample ? '（サンプル）' : '');
    // 日時（＋録音した時間帯）
    li.querySelector('.meta').textContent = formatDateJp(item.date) + (range ? ' ・ ' + range : '');
    // 議事録を2〜3行に要約した内容
    li.querySelector('.excerpt').textContent = historySummaryText(item);
    // 録音のトータル時間とデータ容量
    if (sec) {
      const el = li.querySelector('.stat-time');
      el.hidden = false; el.querySelector('span').textContent = formatDurationCard(sec);
      el.title = '録音の合計時間';
    }
    if (size) {
      const el = li.querySelector('.stat-size');
      el.hidden = false; el.querySelector('span').textContent = formatBytes(size);
      el.title = '録音データの容量';
    }
    // カードをタップ / Enter で開く
    li.addEventListener('click', () => openMinutes(item));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMinutes(item); } });
    li.querySelector('.del').addEventListener('click', (e) => { e.stopPropagation(); deleteMinutes(item.id); });
    historyList.appendChild(li);
  }
}

/** 履歴カード用の長さ表記（1時間05分 / 47分00秒 / 8秒） */
function formatDurationCard(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h) return `${h}時間${String(m).padStart(2, '0')}分`;
  return m ? `${m}分${String(s % 60).padStart(2, '0')}秒` : `${s}秒`;
}

/** 録音した時間帯（10:05〜10:52）。開始時刻か長さが無ければ空 */
function historyTimeRange(item) {
  const sec = (item.audio && item.audio.sec) || 0;
  if (!item.startedAt || !sec) return '';
  const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${hm(new Date(item.startedAt))}〜${hm(new Date(item.startedAt + sec * 1000))}`;
}

/**
 * 履歴カードに出す 2〜3 行の要約。
 * AI議事録があれば見出しを除いた本文を、無ければアプリの要点・決定事項、
 * それも無ければ文字起こしの冒頭を使う（表示は CSS で3行に収める）。
 */
function historySummaryText(item) {
  const clean = (s) => String(s || '')
    .replace(/[*_`>]/g, '')
    .replace(/^[\s・\-–—•]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // 「■要旨・議論の内容」「## 決定事項」「件名：」のような見出し行を拾う
  const headOf = (l) => {
    let m = /^(?:[■●▲◆]+|#{1,4}\s*|【)\s*([^】]+?)\s*[】:：]?$/.exec(l);
    if (m) return m[1];
    m = /^([^:：]{2,12})[:：]$/.exec(l);   // 「決定事項：」のように記号なしの見出し
    return m ? m[1] : null;
  };
  // カードに日時・参加者は別途出るので、要約からは外す
  const SKIP = /^(日時|時間|場所|参加者|出席者|件名|本文|メール)/;
  const PRIORITY = [/要旨|要点|概要|議論|内容/, /決定/, /To-?Do|ToDo|やること|宿題|課題/];

  let lines = [];
  if (item.aiText) {
    const sections = [];
    let cur = { head: '', lines: [] };
    sections.push(cur);
    for (const raw of item.aiText.split('\n')) {
      const l = clean(raw);
      if (!l) continue;
      const h = headOf(l);
      if (h) { cur = { head: h, lines: [] }; sections.push(cur); continue; }
      cur.lines.push(l);
    }
    // 要旨 → 決定事項 → ToDo の順に拾い、どれも無ければ日時・参加者以外の全部
    for (const re of PRIORITY) for (const s of sections) if (re.test(s.head)) lines.push(...s.lines);
    if (!lines.length) for (const s of sections) if (!SKIP.test(s.head)) lines.push(...s.lines);
  }
  if (!lines.length) lines = [...(item.summary || []), ...(item.decisions || [])].map(clean).filter(Boolean);
  if (!lines.length && item.transcript) {
    lines = item.transcript.split(/(?<=[。．！？])/).map(clean).filter(Boolean);
  }
  const picked = lines.filter((l) => l.length >= 4).slice(0, 3);
  if (!picked.length) return '（内容なし）';
  let text = picked.map((l) => l.replace(/[。．]$/, '')).join('。') + '。';
  if (text.length > 160) text = text.slice(0, 160) + '…';
  return text;
}
async function openMinutes(item) {
  meetingName.value = item.name || '';
  meetingDate.value = item.date || '';
  participants = (item.participants || []).map((p) => ({ dept: p.dept || '', name: p.name || '' }));
  renderParticipants();
  updateMeetingSummary();
  fillMinutesUI({ summary: item.summary || [], decisions: item.decisions || [], todos: item.todos || [] });
  liveTranscript.value = item.transcript || '';
  // 録音の実時間（開始時刻・長さ）も戻して、議事録に実時間を出せるようにする
  recStartedAt = item.startedAt || 0;
  recordedDurationSec = (item.audio && item.audio.sec) || 0;
  // AI文字起こし（議事録とは別）も復元する
  if (aiTextEl) aiTextEl.value = item.aiTranscript || '';
  // AIが作った議事録＋メール文面も復元する（自動生成分を含む）
  // 保存してあるのは生成された全文なので、議事録／メール件名／本文に分けて戻す。
  if (aiResult) {
    mailAuto = { subject: '', body: '' };
    if (item.aiText) applyAiOutput(item.aiText);
    else aiResult.value = '';
    if (aiResultWrap) aiResultWrap.hidden = !item.aiText;
  }

  // 履歴の録音音声を読み込み、その場で再生・確認・保存・AI連携できるようにする
  recordedBlob = null;
  recordedDurationSec = 0;
  setAudioAvailable(false);
  clearAudioWarning();
  downloadAudio.disabled = true;
  if (item.audio) {
    try {
      const blob = await idbGet(item.id);
      if (blob) {
        recordedBlob = blob;
        recordedDurationSec = (item.audio && item.audio.sec) || 0;
        player.src = URL.createObjectURL(blob);
        audioSize.textContent = recordedDurationSec
          ? `${formatDurationJp(recordedDurationSec)} ・ ${formatBytes(blob.size)}`
          : formatBytes(blob.size);
        setAudioAvailable(true);
        downloadAudio.disabled = false;
        downloadAudio.innerHTML = `${ICO_DOWNLOAD} ${extFromMime(blob.type)}で保存`;
      }
    } catch (_) { /* 音声が取り出せなくても議事録の閲覧・編集は継続 */ }
  }

  // 履歴ページ内で完結して確認できるよう、カード群を詳細へ移してその場で表示する
  showScreen('screen-history', '過去の議事録');
  const listView = $('historyListView'), detail = $('historyDetail');
  moveFlowToHistory();
  if (listView) listView.hidden = true;
  if (detail) detail.hidden = false;
  const t = $('historyDetailTitle'), mt = $('historyDetailMeta');
  if (t) t.textContent = item.name || '（タイトル未設定）';
  if (mt) {
    mt.textContent = formatDateJp(item.date)
      + (item.participants && item.participants.length ? ' ・ ' + participantsText(item.participants) : '')
      + (item.audio ? ' ・ 音声あり' : '');
  }
  revealFlowCards(false); // 履歴表示は一括で出現
  updateHomeUI();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function deleteMinutes(id) {
  const item = loadStore().find((x) => x.id === id);
  if (item && item.audio) idbDel(id);
  saveStore(loadStore().filter((x) => x.id !== id));
  renderHistory();
}
const historyBack = $('historyBack');
if (historyBack) historyBack.addEventListener('click', () => {
  closeHistoryDetail();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* =========================================================
 * A. 音声をAIに送る（Gemini等）— OS共有シートで音声＋指示を渡す
 * =======================================================*/
const GEMINI_URL = 'https://gemini.google.com/app';
const GEMINI_INSTR_KEY = 'noteloop_gemini_instruction';
const DEFAULT_GEMINI_INSTRUCTION =
`添付した会議の音声を日本語で文字起こしし、正確で読みやすい「議事録」と、そのまま送れる「メール文面」を作成してください。

【1. 議事録】次の見出しで、箇条書き中心にまとめてください。
■日時 ／ ■場所 ／ ■参加者 ／ ■決定事項 ／ ■To-Do（担当・期限がわかれば併記） ／ ■要旨・議論の内容

【2. メール文面】次の形式で作成してください。
件名：【議事録】[会議名]
本文：
関係各位
お疲れ様です。[氏名]です。
[会議名]の議事録を共有致します。
（上記の議事録を ■日時／■場所／■参加者／■決定事項／■To-Do／■要旨 の順で本文に展開）
上記内容になります。よろしくお願い致します。

【作成の指示】
- 聞き取りにくい箇所や誤変換は文脈から自然に補正してください。
- 重要な数値・固有名詞・日付・金額・型番は必ず保持してください。
- 相槌・言い直し・雑談は省き簡潔に。決定事項とTo-Do（未確定の宿題）は明確に区別してください。
- 判断できない箇所は「（要確認）」と明記してください。`;

function loadGeminiInstruction() {
  return localStorage.getItem(GEMINI_INSTR_KEY) || DEFAULT_GEMINI_INSTRUCTION;
}

/** 音声と一緒に渡す指示文（指示 ＋ 会議情報）。文字起こしは音声側が担うので付けない。 */
function buildAudioPrompt() {
  const m = currentMinutes();
  const instr = (geminiInstruction.value || DEFAULT_GEMINI_INSTRUCTION).trim();
  const partLine = (m.participants && m.participants.length) ? `\n参加者: ${participantsText(m.participants)}` : '';
  const timeLine = m.time ? `\n時間: ${m.time}（録音の実時間。■日時にはこの時間を書いてください）` : '';
  return `${instr}

【会議情報】
会議名: ${m.name}
日付: ${formatDateJp(m.date)}${timeLine}${partLine}${dictPromptBlock()}`;
}

function setAiAudioStatus(kind, html) {
  aiAudioStatus.hidden = false;
  aiAudioStatus.className = 'claude-status' + (kind ? ' ' + kind : '');
  aiAudioStatus.innerHTML = html;
}

/** 共有用のファイル名（会議名・日付から生成） */
function audioShareName() {
  const m = currentMinutes();
  const safe = (m.name || '録音').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  const ext = recordedBlob ? extFromMime(recordedBlob.type) : 'm4a';
  return `${safe}_${m.date || todayStr()}.${ext}`;
}

// 音声をAIに送る（共有シート → Gemini等 / 非対応環境はDL＋Geminiを開く）
aiAudioSend.addEventListener('click', async () => {
  hideError();
  if (!recordedBlob) {
    setAiAudioStatus('warn', '⚠ 録音した音声がありません。「録音」画面で録音してから、この操作を行ってください。');
    return;
  }
  const prompt = buildAudioPrompt();
  aiAudioPreview.value = prompt;
  const file = new File([recordedBlob], audioShareName(), { type: recordedBlob.type || 'audio/mp4' });

  // 指示文は先にクリップボードへ（共有先が本文を受け取らない場合の保険）
  const copied = await copyText(prompt);

  // 1) OS共有シート（音声ファイル＋指示文）
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: prompt, title: '会議音声（議事録作成用）' });
      setAiAudioStatus('ok', '✓ 共有しました。Gemini（や対応AIアプリ）を選び、指示文が入っていなければ<strong>貼り付け（コピー済み）→送信</strong>してください。');
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') { setAiAudioStatus('', '共有をキャンセルしました。'); return; }
      // それ以外は下のフォールバックへ
    }
  }

  // 2) フォールバック（PC等）：音声をダウンロード＋Geminiを新しいタブで開く
  try {
    const url = URL.createObjectURL(recordedBlob);
    const a = document.createElement('a');
    a.href = url; a.download = audioShareName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (_) {}
  const win = window.open(GEMINI_URL, '_blank');
  if (win) { try { win.opener = null; } catch (_) {} }
  aiAudioOpen.hidden = false;
  setAiAudioStatus(copied ? 'ok' : 'warn',
    'この端末は音声の直接共有に非対応のため、<strong>音声ファイルをダウンロード</strong>し <strong>Gemini</strong> を開きました。Geminiで音声を添付し、' +
    (copied ? '指示文を<strong>貼り付け（コピー済み）</strong>' : '下の「送る指示を確認」からコピーした指示文を貼り付け') +
    '→送信してください。');
});

// 指示だけコピー
aiAudioCopy.addEventListener('click', async () => {
  hideError();
  const prompt = buildAudioPrompt();
  aiAudioPreview.value = prompt;
  const copied = await copyText(prompt);
  if (copied) setAiAudioStatus('ok', '✓ 指示文をコピーしました。Geminiに音声を添付し、貼り付けて送信してください。');
  else setAiAudioStatus('warn', '⚠ 自動コピーできませんでした。「送る指示を確認」から手動でコピーしてください。');
});

// Gemini 指示テンプレートの保存・リセット
geminiInstruction.addEventListener('input', () => {
  localStorage.setItem(GEMINI_INSTR_KEY, geminiInstruction.value);
});
geminiInstructionReset.addEventListener('click', () => {
  geminiInstruction.value = DEFAULT_GEMINI_INSTRUCTION;
  localStorage.setItem(GEMINI_INSTR_KEY, DEFAULT_GEMINI_INSTRUCTION);
});

/* =========================================================
 * Gemini API 自動議事録生成（BYOK: 自分のAPIキーでブラウザから直接呼ぶ）
 *   録音音声 → Gemini（音声理解）→ 議事録＋メール文面 を一発生成。
 *   キーは端末内（localStorage）にのみ保存する。
 * =======================================================*/
const GEMINI_KEY_KEY = 'noteloop_gemini_apikey';
const GEMINI_MODEL_KEY = 'noteloop_gemini_model';
const GENAI_BASE = 'https://generativelanguage.googleapis.com';
const GEMINI_INLINE_LIMIT = 18 * 1024 * 1024; // これ以下は inline、超えたら Files API

function loadGeminiKey() { return (localStorage.getItem(GEMINI_KEY_KEY) || '').trim(); }
// 既定は「無料枠で実際に通るモデル」を選ぶ。
// gemini-3.6-flash / gemini-flash-latest は無料枠に割り当てが無く、
// 請求先未設定のプロジェクトでは 429（RESOURCE_EXHAUSTED）で必ず失敗する。
const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash';
// 選択モデルが 404（提供終了）や 429（無料枠なし）で使えないときに順に試す代替。
const GEMINI_FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];
// サーバ側の一時的な事情。待てば通ることが多いので、同じモデルで粘ってから代替へ移る。
// 503（混雑）はモデルを変えても混んでいることが多く、待つほうが効く。
const GEMINI_TRANSIENT_STATUS = [500, 502, 503, 504];
const GEMINI_MAX_RETRY = 3;
function loadGeminiModel() { return localStorage.getItem(GEMINI_MODEL_KEY) || GEMINI_DEFAULT_MODEL; }

// APIキーの形式。Google AI Studio は従来の「AIza…」に加え、
// 新形式の「AQ.…」も発行する。どちらも有効なので両方を受け付ける。
function isLikelyGeminiKey(k) { return /^AIza[\w-]{10,}$/.test(k) || /^AQ\.[\w.-]{10,}$/.test(k); }
// AI Studio が発行するキーの実際の長さ（AIza… は39文字、AQ.… は53文字）。
// 画面の省略表示（例: AQ.Ab8RN6IZd_HwfHR1PyxCjlq0NriZnsacN = 36文字）を
// そのまま入力してしまう取り違えが多いので、長さで検知して知らせる。
const GEMINI_KEY_LEN = { AIza: 39, 'AQ.': 53 };
function expectedKeyLen(k) { return k.startsWith('AIza') ? GEMINI_KEY_LEN.AIza : (k.startsWith('AQ.') ? GEMINI_KEY_LEN['AQ.'] : 0); }
/** 保存中のキーの形（長さ・前後の数文字）を、値そのものを晒さずに説明する */
function keyShapeNote() {
  const k = loadGeminiKey();
  if (!k) return 'キー未設定';
  const exp = expectedKeyLen(k);
  const shape = `いま保存されているキーは ${k.length} 文字・${k.slice(0, 6)}…${k.slice(-4)}`;
  if (exp && k.length < exp) return `${shape}。本来は ${exp} 文字なので<strong>途中で切れています</strong>`;
  if (exp && k.length > exp) return `${shape}。本来は ${exp} 文字なので<strong>余分な文字が入っています</strong>`;
  return shape;
}

/* --- 録音停止後に自動でAI議事録を作るか（既定：ON）--- */
const AI_AUTO_AFTER_STOP_KEY = 'noteloop_ai_auto_after_stop';
function isAiAutoAfterStop() { return localStorage.getItem(AI_AUTO_AFTER_STOP_KEY) !== '0'; }

/* --- 無料枠の使用状況（この端末での推定・毎日リセット）--- */
const GEMINI_USAGE_KEY = 'noteloop_gemini_usage';
const GEMINI_FREE_RPD = 1500; // 無料枠の1日あたりリクエスト上限
function todayKey() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function loadUsage() {
  let u;
  try { u = JSON.parse(localStorage.getItem(GEMINI_USAGE_KEY) || '{}'); } catch (_) { u = {}; }
  if (!u || u.date !== todayKey()) u = { date: todayKey(), requests: 0, tokens: 0 };
  return u;
}
function recordUsage(tokens) {
  const u = loadUsage();
  u.requests += 1;
  u.tokens += (tokens || 0);
  localStorage.setItem(GEMINI_USAGE_KEY, JSON.stringify(u));
  renderUsage();
}
function renderUsage() {
  if (!geminiUsageBox) return;
  if (!loadGeminiKey()) { geminiUsageBox.hidden = true; return; }
  geminiUsageBox.hidden = false;
  const u = loadUsage();
  const pct = Math.min(100, Math.round((u.requests / GEMINI_FREE_RPD) * 100));
  if (geminiUsageCount) geminiUsageCount.textContent = `${u.requests.toLocaleString()} / ${GEMINI_FREE_RPD.toLocaleString()} 回（目安）`;
  if (geminiUsageFill) { geminiUsageFill.style.width = pct + '%'; geminiUsageFill.className = 'quota-fill' + (pct >= 80 ? ' warn' : ''); }
  if (geminiUsageDetail) {
    const remain = Math.max(0, GEMINI_FREE_RPD - u.requests);
    const kt = Math.round(u.tokens / 1000);
    geminiUsageDetail.innerHTML = `残り約 <strong>${remain.toLocaleString()}</strong> 回（本日の消費トークン 約 ${kt.toLocaleString()}k）。` +
      `<br>※上限 ${GEMINI_FREE_RPD.toLocaleString()} 回は目安です（モデルと時期で変わります）。実際の枠はこの端末以外の利用も含み、太平洋時間の深夜にリセットされます。`;
  }
}

function setAiAutoStatus(kind, html) {
  if (!aiAutoStatus) return;
  aiAutoStatus.hidden = false;
  aiAutoStatus.className = 'claude-status' + (kind ? ' ' + kind : '');
  aiAutoStatus.innerHTML = html;
}

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

/** 録音 Blob を 16kHz モノラル WAV（Gemini 対応形式）へ変換 */
async function toWav16kMono(blob) {
  const f32 = await decodeTo16kMono(blob); // Float32 @16kHz mono
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const v = Math.max(-1, Math.min(1, f32[i]));
    i16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return new Blob([wavHeader(i16.length, SAMPLE_RATE), i16], { type: 'audio/wav' });
}

/** Files API（大きい音声）へレジューム可能アップロードして fileUri を得る */
async function geminiUploadFile(blob, key) {
  const size = blob.size, mime = blob.type || 'audio/wav';
  const startRes = await fetch(`${GENAI_BASE}/upload/v1beta/files?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(size),
      'X-Goog-Upload-Header-Content-Type': mime,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: 'meeting-audio' } }),
  });
  if (!startRes.ok) throw new Error('音声アップロードの開始に失敗しました（' + startRes.status + '）');
  const uploadUrl = startRes.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) throw new Error('アップロードURLを取得できませんでした（ブラウザ制限の可能性）');
  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' },
    body: blob,
  });
  if (!upRes.ok) throw new Error('音声アップロードに失敗しました（' + upRes.status + '）');
  const info = await upRes.json();
  let file = info.file;
  for (let i = 0; i < 30 && file && file.state === 'PROCESSING'; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const st = await fetch(`${GENAI_BASE}/v1beta/${file.name}?key=${encodeURIComponent(key)}`);
      file = await st.json();
    } catch (_) { break; }
  }
  if (!file || file.state === 'FAILED') throw new Error('アップロードした音声の処理に失敗しました');
  return { uri: file.uri, mime };
}

/** HTTPステータスとAPIメッセージから、原因が分かる日本語エラーを作る */
function geminiHttpError(status, msg, model) {
  // 401（UNAUTHENTICATED）は新形式キー「AQ.…」が不正なときに返る。
  // 旧形式「AIza…」の不正は 400 + API_KEY_INVALID なので、どちらも同じ案内にまとめる。
  if (status === 401 || (status === 400 && /API[ _]key not valid|API_KEY_INVALID/i.test(msg))) {
    return new Error('APIキーが正しくありません（' + keyShapeNote() + '）。'
      + '設定→AI連携 のキーを貼り直してください。AI Studio の<strong>コピーボタン</strong>でキー全体をコピーしてください'
      + '（画面に出ている「AQ.Ab8…」のような省略表示を手で入力すると、途中までしか入らず必ず失敗します）。'
      + 'キー欄の目のアイコンで、いま保存されている内容を確認できます。');
  }
  if (status === 403) {
    return new Error('このAPIキーでは実行できませんでした（キーの制限、またはGenerative Language APIが無効の可能性）。AI Studio でキーの設定を確認してください。詳細: ' + msg);
  }
  if (status === 404) {
    return new Error(`モデル「${model}」は現在このキーでは使えません（提供終了などの可能性）。設定→AI連携 のモデルを変更してください。`);
  }
  if (status === 429) {
    return new Error(`モデル「${model}」の利用枠に達しました。無料枠（請求先未設定）のプロジェクトでは最新モデル（gemini-3.6-flash / gemini-flash-latest）に割り当てが無く、常にこのエラーになります。設定→AI連携 のモデルを gemini-3.5-flash に変更してお試しください。`);
  }
  if (GEMINI_TRANSIENT_STATUS.includes(status)) {
    // Google側の一時的な事情。録音は保存済みなので、あとから作り直せば済む。
    return new Error(`Gemini側が一時的に混み合っています（${status}）。しばらく待ってから、AI議事録の枠の右下「＜」→「作り直す」でやり直してください。録音音声は保存されているので、あとからでも議事録を作れます。`);
  }
  return new Error('Gemini APIエラー（' + status + '）: ' + msg);
}

// 代替モデルで生成できたときに、実際に使ったモデル名を控えて画面に知らせる。
let lastGeminiFallbackModel = '';

/** 録音音声を Gemini に送り、議事録＋メール文面テキストを返す */
/**
 * 音声＋指示を Gemini に送り、返ってきた文章を返す共通処理。
 * 議事録づくり・全体の文字起こし・録音中のライブ文字起こしで共通に使う。
 * @param {Blob} blob 送る音声（WAV 以外は 16kHz モノラル WAV に変換する）
 * @param {string} prompt 指示文
 * @param {{onStage?:Function, stage?:string, live?:boolean}} [opts]
 */
async function geminiAudioRequest(blob, prompt, opts) {
  const o = opts || {};
  const onStage = o.onStage;
  const key = loadGeminiKey();
  if (!key) { const e = new Error('APIキー未設定'); e.noKey = true; throw e; }
  if (!blob) throw new Error('録音音声がありません。');
  const model = loadGeminiModel();

  if (!o.live) onStage && onStage('音声を準備中…');
  // 形式の問題を避けるため WAV 16kHz mono に統一（すでに WAV ならそのまま）
  const wav = blob.type === 'audio/wav' ? blob : await toWav16kMono(blob);

  let audioPart;
  if (wav.size <= GEMINI_INLINE_LIMIT) {
    const b64 = await blobToBase64(wav);
    audioPart = { inlineData: { mimeType: 'audio/wav', data: b64 } };
  } else {
    onStage && onStage('音声をアップロード中…（長い録音は時間がかかります）');
    const up = await geminiUploadFile(wav, key);
    audioPart = { fileData: { mimeType: up.mime, fileUri: up.uri } };
  }

  if (o.stage) onStage && onStage(o.stage);
  const body = { contents: [{ parts: [{ text: prompt }, audioPart] }] };

  // 選択モデルが使えない（提供終了 / 無料枠なし）ときは代替モデルで自動的に再試行する。
  // 録音中のライブは待たせたくないので、粘る回数を減らす。
  const maxRetry = o.live ? 1 : GEMINI_MAX_RETRY;
  const tried = [];
  let data = null, lastErr = null, usedModel = model;
  outer:
  for (const m of [model, ...GEMINI_FALLBACK_MODELS]) {
    if (tried.includes(m)) continue;
    tried.push(m);
    if (tried.length > 1 && !o.live) onStage && onStage(`${m} で作成し直しています…`);

    // 一時的な混雑（503など）は待てば通ることが多いので、同じモデルで数回粘る。
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${GENAI_BASE}/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) { data = await res.json(); usedModel = m; break outer; }

      let msg = String(res.status);
      try { const e = await res.json(); msg = (e.error && e.error.message) || msg; } catch (_) {}
      lastErr = geminiHttpError(res.status, msg, m);

      if (GEMINI_TRANSIENT_STATUS.includes(res.status) && attempt < maxRetry) {
        // 2秒 → 4秒 → 8秒 と間隔を空けて待つ
        const waitMs = 2000 * Math.pow(2, attempt);
        if (!o.live) onStage && onStage(`Geminiが混み合っています。${Math.round(waitMs / 1000)}秒待って再試行します…（${attempt + 1}/${maxRetry}）`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      // 404（モデルが無い）/ 429（枠切れ）/ 粘っても復帰しない一時エラーは代替モデルへ。
      // キー不正・権限・リクエスト不正はモデルを変えても直らないので即座に中断する。
      if (res.status === 404 || res.status === 429 || GEMINI_TRANSIENT_STATUS.includes(res.status)) break;
      throw lastErr;
    }
  }
  if (!data) {
    if (tried.length > 1) {
      throw new Error(`どのモデルでも作成できませんでした（試行: ${tried.join(' / ')}）。最後のエラー: ` + (lastErr ? lastErr.message : '不明'));
    }
    throw lastErr || new Error('Gemini APIエラー');
  }
  if (!o.live) lastGeminiFallbackModel = usedModel !== model ? usedModel : '';
  const cand = (data.candidates || [])[0] || {};
  const parts = (cand.content && cand.content.parts) || [];
  const text = parts.map((p) => p.text || '').join('').trim();
  // 使用状況（推定）を記録：応答の usageMetadata からトークン数を加算
  recordUsage((data.usageMetadata && data.usageMetadata.totalTokenCount) || 0);
  if (!text && !o.live) throw new Error('生成結果が空でした（安全性ブロックや指示文が原因の場合があります）。');
  return text;
}

/** 録音音声から議事録＋メール文面を作る */
async function geminiGenerateMinutes(onStage) {
  if (!recordedBlob) throw new Error('録音音声がありません。設定で「録音中のライブ文字起こし」を切り替えても録音はできます。');
  return geminiAudioRequest(recordedBlob, buildAudioPrompt(), { onStage, stage: 'Geminiが議事録を作成中…' });
}

/** 録音音声の全体を、議事録とは別に「文字起こしだけ」する（読み比べ用） */
async function geminiTranscribeAll(onStage) {
  if (!recordedBlob) throw new Error('録音音声がありません。');
  // 話者ラベルは「行頭に A：」を足すだけで、文字起こし本文そのものには手を入れない
  const speakerRule = speakerOn()
    ? '・話者が変わったら改行し、行頭に「A：」「B：」のように話者の記号を付けてください。同じ人には最後まで同じ記号を使ってください。記号は行頭だけに置き、発言内容は変えないでください。\n'
    : '・話者が変わったら改行してください。\n';
  const prompt =
    '添付した会議の音声を、日本語で正確に文字起こししてください。\n'
    + '・話したことばだけを出力し、要約・見出し・説明・記号は付けないでください。\n'
    + '・聞き取りにくい箇所は文脈から自然に補正し、判断できない部分は（聞き取れず）と書いてください。\n'
    + speakerRule
    + '・相槌だけの行は省いてかまいません。\n'
    + '・数値・固有名詞・日付・金額・型番は必ず保持してください。'
    + dictPromptBlock();   // 登録した用語は指定の表記で書いてもらう
  return geminiAudioRequest(recordedBlob, prompt, { onStage, stage: 'Geminiが文字起こし中…' });
}

// AI議事録の自動作成（録音停止後・枠内の「作り直す」からも実行）
/**
 * 生成したAI議事録を履歴エントリへ保存する。
 * 直近に録音したエントリ（activeRecordingId）、無ければ一覧の最新に紐づける。
 */
function saveAiTextToHistory(text) {
  try {
    const list = loadStore();
    if (!list.length) return;
    let idx = activeRecordingId ? list.findIndex((e) => e.id === activeRecordingId) : -1;
    if (idx < 0) idx = list.length - 1;
    list[idx].aiText = text;
    // 履歴は自動生成より前に保存されるため、既定名（録音 7/31 03:05）のままなら
    // AIの結果から付け直す。画面側のタイトルも同時に合わせる。
    if (/^録音 \d+\/\d+ \d+:\d+$/.test(list[idx].name || '')) {
      const t = autoTitleFromAiText(text);
      if (t) {
        list[idx].name = t;
        if (meetingName && /^録音 \d+\/\d+ \d+:\d+$/.test(meetingName.value.trim())) {
          meetingName.value = t;
          updateMeetingSummary();
        }
      }
    }
    saveStore(list);
    renderHistory();
  } catch (_) { /* 保存に失敗しても画面の生成結果は使えるので無視する */ }
}

/**
 * 録音音声を Gemini に投げ、議事録＋メール文面を画面へ反映する。
 * ボタン押下と、録音停止後の自動実行の両方から呼ぶ。
 * @param {{auto?: boolean}} [opts] auto=true なら録音停止直後の自動実行
 * @returns {Promise<boolean>} 生成できたら true
 */
/* =========================================================
 * AI文字起こし（Gemini・高精度）— 議事録とは別に、録音全体を文字にする
 * =======================================================*/
const aiTextCardEl   = $('aiTextCard');
const aiTextEl       = $('aiText');
const aiTextStatus   = $('aiTextStatus');
let txtStage = '';

function setAiTextStatus(kind, html) {
  if (!aiTextStatus) return;
  aiTextStatus.hidden = false;
  aiTextStatus.className = 'claude-status' + (kind ? ' ' + kind : '');
  aiTextStatus.innerHTML = html;
}

/**
 * 録音全体を Gemini で文字起こしして、専用の欄に出す（議事録とは別）。
 * 録音中のリアルタイム表示と読み比べられるようにするための機能。
 */
async function runAiTranscribe(opts) {
  const auto = !!(opts && opts.auto);
  if (aiTextRunning) return false;
  if (!loadGeminiKey()) {
    if (!auto) setAiTextStatus('warn', '⚠ Gemini APIキーが未設定です。<strong>設定 → AI連携</strong> でキーを入力してください。');
    return false;
  }
  if (!recordedBlob) {
    if (!auto) setAiTextStatus('warn', '⚠ 録音音声がありません。');
    return false;
  }
  aiTextRunning = true;
  updateFabState();
  // 進捗は上部の総合ゲージ1本に集約する。単独で呼ばれたときはここで開始・終了する。
  const ownFlow = !aiFlowRunning;
  if (ownFlow) startAiFlowProgress();
  setAiFlowStage('AIが文字起こし中…');
  try {
    const text = autoConvert(await geminiTranscribeAll((st) => { txtStage = st; setAiFlowStage(st); }));
    if (aiTextEl) aiTextEl.value = text;
    saveAiTranscriptToHistory(text);
    if (ownFlow) endAiFlowProgress(true);
    updateHomeUI();   // 出力ができたので「高精度文字起こし」カードを表示
    return true;
  } catch (err) {
    if (ownFlow) endAiFlowProgress(false);
    const msg = (err && err.noKey) ? 'APIキーが未設定です。設定→AI連携で入力してください。'
              : (err && err.message ? err.message : String(err));
    setAiTextStatus('warn', '⚠ ' + msg);
    return false;
  } finally {
    aiTextRunning = false;
    updateFabState();
  }
}

/** AI文字起こしを履歴にも残す */
function saveAiTranscriptToHistory(text) {
  try {
    const list = loadStore();
    if (!list.length) return;
    let idx = activeRecordingId ? list.findIndex((e) => e.id === activeRecordingId) : -1;
    if (idx < 0) idx = list.length - 1;
    list[idx].aiTranscript = text;
    saveStore(list);
  } catch (_) { /* 保存に失敗しても画面の結果は使える */ }
}

/** AI文字起こしを上の「文字起こし」欄へ反映する（枠内の展開メニューから呼ぶ） */
function useAiTranscript() {
  if (!aiTextEl || !aiTextEl.value.trim()) { setAiTextStatus('warn', '⚠ まだ文字起こしがありません。'); return false; }
  liveTranscript.value = aiTextEl.value;
  updateHomeUI();
  if (aiTextStatus) { aiTextStatus.hidden = true; aiTextStatus.innerHTML = ''; }
  return true;
}

/* ===== 生成の段階表示 =====
 * 進捗ゲージは画面上部の総合ゲージ（#aiFlowProgress）1本だけ。
 * ここでは段階名（音声を準備中／アップロード中／作成中）をそこへ流す。
 */
function setGenStage(text) {
  const t = (text || '').replace(/^録音が終わりました。/, '');
  if (t) setAiFlowStage(t);
}

/* ===== AIの出力を「議事録」「メール件名」「メール本文」に切り分ける ===== */
/** 「【1. 議事録】」などの見出し行を落とす */
function stripMinutesHeader(t) {
  return String(t || '')
    .replace(/^[ \t>*#]*[【\[(（]?[ \t]*(?:[1１][ \t]*[.．、]?[ \t]*)?議事録[ \t]*[】\])）]?[ \t]*[:：]?[ \t]*$/m, '')
    .trim();
}

/**
 * Gemini の出力（議事録＋メール文面）を3つに分ける。
 * 「メール文面」または「件名：」の行から後ろをメールとして扱い、
 * それより前を議事録とする。見つからないときは全文を議事録にする。
 */
function splitAiOutput(text) {
  const src = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!src) return { minutes: '', subject: '', body: '' };
  const lines = src.split('\n');
  let mailStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/^[\s>*#・\-–—]+/, '').trim();
    if (/^[【\[(（]?[ \t]*(?:[2２][ \t]*[.．、]?[ \t]*)?メール(文面|文|案|ドラフト)/.test(l)) { mailStart = i; break; }
    if (/^[【\[(（]?[ \t]*件名[ \t]*[】\])）]?[ \t]*[:：]/.test(l)) { mailStart = i; break; }
  }
  if (mailStart < 0) return { minutes: stripMinutesHeader(src), subject: '', body: '' };

  const minutes = stripMinutesHeader(lines.slice(0, mailStart).join('\n').trim());
  const mailPart = lines.slice(mailStart).join('\n');

  let subject = '';
  const sm = mailPart.match(/^[ \t>*#]*[【\[(（]?[ \t]*件名[ \t]*[】\])）]?[ \t]*[:：][ \t]*(.*)$/m);
  if (sm) subject = (sm[1] || '').trim();

  let body = '';
  const bm = mailPart.match(/^[ \t>*#]*[【\[(（]?[ \t]*本文[ \t]*[】\])）]?[ \t]*[:：]?[ \t]*(.*)$/m);
  if (bm) {
    body = ((bm[1] || '') + '\n' + mailPart.slice(bm.index + bm[0].length)).trim();
  } else if (sm) {
    body = mailPart.slice(sm.index + sm[0].length).trim();
  } else {
    body = mailPart.replace(/^[^\n]*\n?/, '').trim(); // 見出し行だけ落とす
  }
  return { minutes, subject, body };
}

// 自動で入れた件名・本文（利用者が手で直した内容を上書きしないための控え）
let mailAuto = { subject: '', body: '' };

/**
 * AIの生成結果を各枠へ出力する。
 * 議事録枠には議事録のみ、メール枠には件名と貼り付け用の本文をそれぞれ入れる。
 */
function applyAiOutput(text) {
  // AIの出力にも変換辞書を適用し、社名・固有名詞を登録した表記に揃える
  text = autoConvert(text);
  const parts = splitAiOutput(text);
  if (aiResult) aiResult.value = parts.minutes || text;
  if (mailSubject && parts.subject
      && (!mailSubject.value.trim() || mailSubject.value === mailAuto.subject)) {
    mailSubject.value = parts.subject;
    mailAuto.subject = parts.subject;
  }
  if (mailBody && parts.body
      && (!mailBody.value.trim() || mailBody.value === mailAuto.body)) {
    mailBody.value = parts.body;
    mailAuto.body = parts.body;
  }
  return parts;
}

async function runAiAutoMinutes(opts) {
  const auto = !!(opts && opts.auto);
  if (aiAutoRunning) return false; // 二重起動（自動＋手動の同時実行）を防ぐ
  if (!loadGeminiKey()) {
    setAiAutoStatus('warn', '⚠ Gemini APIキーが未設定です。<strong>設定 → AI連携</strong> でキーを入力してください（<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">無料で取得</a>）。または下の「手動でGeminiに渡す」をご利用ください。');
    return false;
  }
  if (!recordedBlob) {
    setAiAutoStatus('warn', '⚠ 録音音声がありません。設定で<strong>ライブ字幕モードをOFF（録音モード）</strong>にして録音してからお試しください。');
    return false;
  }
  aiAutoRunning = true;
  updateFabState();
  // 進捗は上部の総合ゲージ1本だけ（カード内には出さない）
  const ownFlow = !aiFlowRunning;
  if (ownFlow) startAiFlowProgress();
  setAiFlowStage('AIが議事録を作成中…');
  try {
    const text = await geminiGenerateMinutes((s) => setGenStage(s));
    const parts = applyAiOutput(text); // 議事録枠は議事録のみ、メール枠は件名・本文へ
    aiResultWrap.hidden = false;
    ensureAutoTitle();
    saveAiTextToHistory(text); // 再読み込み・履歴からの再表示でも残るように保存
    let note = lastGeminiFallbackModel
      ? `<br>※選択中のモデルが使えなかったため <strong>${lastGeminiFallbackModel}</strong> で作成しました。設定→AI連携 でモデルを変更できます。`
      : '';
    // 音声が途中までしか残っていない場合、議事録もその範囲しか含まない。
    // 完全な議事録だと思い込むと危ないので、結果と一緒に必ず知らせる。
    if (audioShortfall) {
      note += `<br>⚠ <strong>この議事録は、残っている音声（${formatDurationJp(audioShortfall.audioSec)}）だけから作成されています。</strong>`
        + `録音時間は ${formatDurationJp(audioShortfall.wallSec)} なので、会議の一部しか含まれていません。`
        + `上の「録音データ」の注意書きをご確認ください。`;
    }
    if (ownFlow) endAiFlowProgress(true);
    // 完了の緑バーは出さない（できたカードが順に現れることで完了が分かる）。
    // 注意が要るときだけ知らせる。
    if (note) setAiAutoStatus('warn', note.replace(/^<br>/, ''));
    else if (aiAutoStatus) { aiAutoStatus.hidden = true; aiAutoStatus.innerHTML = ''; }
    updateHomeUI();   // 議事録・メールのカードを表示
    // 自動実行では結果まで自動で表示されないと気づけないので、生成結果へスクロールする
    if (auto) scrollToEl('aiResultWrap');
    return true;
  } catch (err) {
    if (ownFlow) endAiFlowProgress(false);
    const msg = (err && err.noKey) ? 'APIキーが未設定です。設定→AI連携で入力してください。'
              : (err && err.message ? err.message : String(err));
    // 自動実行の失敗は「手動でやり直せる」ことまで伝える
    setAiAutoStatus('warn', '⚠ ' + msg + (auto ? '<br>AI議事録の枠の右下「＜」→「作り直す」でやり直せます。' : ''));
    return false;
  } finally {
    aiAutoRunning = false;
    updateFabState();
  }
}

// Gemini APIキー / モデルの保存・状態表示
function updateGeminiKeyStatus() {
  if (!geminiKeyStatus) return;
  const k = loadGeminiKey();
  if (!k) { geminiKeyStatus.hidden = true; return; }
  geminiKeyStatus.hidden = false;
  const exp = expectedKeyLen(k);
  if (!isLikelyGeminiKey(k)) {
    geminiKeyStatus.className = 'field-hint warn';
    geminiKeyStatus.textContent = `⚠ キーの形式が想定と異なります（通常 AIza… または AQ.… で始まります・現在 ${k.length} 文字）。省略表示（末尾が「…」）をそのまま貼っていないか確認してください。`;
  } else if (exp && k.length !== exp) {
    // 長さ違いはほぼ確実に貼り付けミス。テストする前にここで気づけるようにする
    geminiKeyStatus.className = 'field-hint warn';
    geminiKeyStatus.textContent = `⚠ キーの長さが違います（現在 ${k.length} 文字／本来 ${exp} 文字）。`
      + (k.length < exp ? '途中で切れています。' : '余分な文字が入っています。')
      + ' AI Studio の「コピー」ボタンでキー全体をコピーし、貼り直してください。';
  } else {
    geminiKeyStatus.className = 'field-hint';
    geminiKeyStatus.textContent = '✓ キーを保存しました（この端末内のみ・' + k.length + '文字）。録音を止めたときのAI議事録の自動作成が使えます。下の「キーをテスト」で実際に使えるか確認できます。';
  }
  renderUsage();
}

/** 設定画面の「キーをテスト」— 実際にAPIを叩き、キーとモデルの可否を確認する */
async function testGeminiKey() {
  if (!geminiKeyTestStatus) return;
  const key = loadGeminiKey();
  const show = (kind, html) => {
    geminiKeyTestStatus.hidden = false;
    geminiKeyTestStatus.className = 'field-hint' + (kind ? ' ' + kind : '');
    geminiKeyTestStatus.innerHTML = html;
  };
  if (!key) { show('warn', '⚠ キーが未入力です。'); return; }
  geminiKeyTest.disabled = true;
  show('', 'テスト中…');
  try {
    const res = await fetch(`${GENAI_BASE}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
    if (!res.ok) {
      let msg = String(res.status);
      try { const e = await res.json(); msg = (e.error && e.error.message) || msg; } catch (_) {}
      show('warn', '⚠ ' + geminiHttpError(res.status, msg, loadGeminiModel()).message);
      return;
    }
    const data = await res.json();
    const names = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => String(m.name || '').replace('models/', ''));
    const model = loadGeminiModel();
    if (names.includes(model)) {
      show('ok', `✓ キーは有効です。選択中のモデル <strong>${model}</strong> も利用できます。`);
    } else {
      const alt = GEMINI_FALLBACK_MODELS.find((m) => names.includes(m)) || names[0] || '（なし）';
      show('warn', `⚠ キーは有効ですが、選択中の <strong>${model}</strong> はこのキーで利用できません。<strong>${alt}</strong> に変更してください。`);
    }
  } catch (err) {
    show('warn', '⚠ 通信に失敗しました（オフライン、または接続がブロックされている可能性）。' + (err && err.message ? ' 詳細: ' + err.message : ''));
  } finally {
    geminiKeyTest.disabled = false;
  }
}
if (geminiKeyTest) geminiKeyTest.addEventListener('click', testGeminiKey);
// 貼り付けミス（途中で切れている等）を目で確かめられるように表示/非表示を切り替える
if (geminiKeyReveal && geminiApiKey) {
  geminiKeyReveal.addEventListener('click', () => {
    const show = geminiApiKey.type === 'password';
    geminiApiKey.type = show ? 'text' : 'password';
    geminiKeyReveal.setAttribute('aria-pressed', show ? 'true' : 'false');
    geminiKeyReveal.setAttribute('aria-label', show ? 'キーを隠す' : 'キーを表示');
    geminiKeyReveal.classList.toggle('on', show);
  });
}
if (aiAutoAfterStop) {
  aiAutoAfterStop.checked = isAiAutoAfterStop();
  aiAutoAfterStop.addEventListener('change', () => {
    localStorage.setItem(AI_AUTO_AFTER_STOP_KEY, aiAutoAfterStop.checked ? '1' : '0');
  });
}
if (geminiApiKey) {
  geminiApiKey.value = loadGeminiKey();
  geminiApiKey.addEventListener('input', () => { localStorage.setItem(GEMINI_KEY_KEY, geminiApiKey.value.trim()); updateGeminiKeyStatus(); });
}
if (geminiModel) {
  // 保存済みのモデルが選択肢に無い（提供終了・古い版で選んだ等）場合は既定に戻す。
  // そのままだと選択が空欄になり、リクエストのモデル名も空になってしまう。
  const saved = loadGeminiModel();
  const known = Array.from(geminiModel.options).some((o) => o.value === saved);
  geminiModel.value = known ? saved : GEMINI_DEFAULT_MODEL;
  if (!known) localStorage.removeItem(GEMINI_MODEL_KEY);
  geminiModel.addEventListener('change', () => localStorage.setItem(GEMINI_MODEL_KEY, geminiModel.value));
}
updateGeminiKeyStatus();

/* =========================================================
 * 設定・エラー・初期化
 * =======================================================*/
const LIVE_KEY = 'noteloop_live_enabled';
liveEnabled.addEventListener('change', () => {
  localStorage.setItem(LIVE_KEY, liveEnabled.checked ? '1' : '0');
  applyLiveUI();
});
const isMobileDevice = IS_TOUCH_DEVICE;
// ライブ表示（Web Speech）は既定ON。保存済みの設定があればそれを優先。
{
  const savedLive = localStorage.getItem(LIVE_KEY);
  if (savedLive === '0' || savedLive === '1') liveEnabled.checked = savedLive === '1';
}

/** ライブ表示（Web Speech）の対応状況を反映。非対応なら無効化して案内。 */
function applyLiveUI() {
  if (!liveHint) return;
  if (NATIVE) {
    // アプリ版は Android の制約で、同じマイクを録音と音声認識で二重に開けない。
    // そこで録音サービスが読んでいる音声をそのまま受け取り、端末内の Whisper で
    // 文字にする。マイクは1つしか開かないので、録音は止まらない。
    liveEnabled.disabled = false;
    liveHint.innerHTML = liveEnabled.checked
      ? '<strong>ON = 録音しながら文字起こし。</strong>録音サービスの音声をそのまま使うので、<strong>録音は止まりません</strong>。'
        + `APIキーがあれば <strong>Gemini（高精度・速い）</strong>で ${LIVE_GEMINI_SEC}秒ごとに、無ければ<strong>端末内のWhisper</strong>（外部送信なし・初回のみモデル約80MB）で文字にします。`
        + '<br>※Gemini を使うと無料枠の回数を消費します（1時間の会議でおよそ 240 回）。'
        + '<br>※画面を消している間は表示が止まることがありますが、<strong>録音は最後まで続きます</strong>（停止後にAIが全体を文字起こしします）。'
      : '<strong>OFF = 録音のみ。</strong>録音中は文字を出さず、<strong>音声の保存を最優先</strong>します。停止後に<strong>AIが自動で文字起こし＋議事録</strong>を高精度に作ります（推奨）。';
    return;
  }
  if (!getSR()) {
    liveEnabled.checked = false;
    liveEnabled.disabled = true;
    liveHint.innerHTML = 'この端末／ブラウザはリアルタイム字幕（Web Speech）に非対応です。<strong>録音モード</strong>で動作します（停止後に「音声をAIに送る」で議事録化）。';
  } else if (liveEnabled.checked) {
    liveHint.innerHTML = '<strong>ON = ライブ字幕モード。</strong>録音中にリアルタイムで文字が出ます（音声はGoogleへ送信）。' +
      '対応端末では<strong>音声も同時に保存</strong>します。停止後は「AIで議事録を作成」で議事録化。' +
      '<br>※もし字幕が出ない端末では、このモードをOFF（録音のみ）にしてください。';
  } else {
    liveHint.innerHTML = '<strong>OFF = 録音モード。</strong>字幕は出ませんが<strong>音声を確実に保存</strong>します。停止後に<strong>「音声をAIに送る（Gemini）」</strong>で高精度な議事録＋メールを作成（推奨）。';
  }
}

// 話者の自動判別（A / B …）の保存
if (speakerLabels) {
  if (localStorage.getItem(SPK_KEY) === '0') speakerLabels.checked = false;
  speakerLabels.addEventListener('change', () => {
    localStorage.setItem(SPK_KEY, speakerLabels.checked ? '1' : '0');
    if (!speakerLabels.checked) resetSpeakers();
  });
}

// 画面常時オン設定の保存 / 即時反映（録音中に切り替えたら取得・解放）
if (keepAwake) {
  keepAwake.addEventListener('change', () => {
    localStorage.setItem(WAKE_KEY, keepAwake.checked ? '1' : '0');
    if (recording) { keepAwake.checked ? acquireWakeLock() : releaseWakeLock(); }
  });
}

const ENGINE_KEY = 'noteloop_confirm_v2'; // 旧 'noteloop_engine' は意味が変わったため新キーに
function applyEngineUI() {
  // engineSelect = 「停止後の文字起こし（確定）」: 'gemini'(=しない) | 'whisper'
  const useWhisper = engineSelect.value === 'whisper';
  whisperSettings.style.display = useWhisper ? '' : 'none';
  engineHint.textContent = useWhisper
    ? '停止後、録音音声を端末内Whisperで文字起こしします（外部送信なし・オフライン可）。初回はモデルをダウンロードします。長い録音・スマホでは時間がかかります。'
    : '停止後の自動文字起こしは行いません。録音後に「音声をAIに送る（Gemini）」で高精度な議事録＋メールを作成します（推奨）。';
  localStorage.setItem(ENGINE_KEY, engineSelect.value);
}
engineSelect.addEventListener('change', applyEngineUI);

/* --- 実行バックエンド（WebGPU / WASM）と モデルのメモリ警告 --- */
const BACKEND_KEY = 'noteloop_backend';
const webgpuAvailable = ('gpu' in navigator) && !!navigator.gpu;

function applyBackendUI() {
  if (!backendSelect) return;
  const v = backendSelect.value;
  if (backendHint) {
    if (v === 'auto') {
      backendHint.textContent = IS_TOUCH_DEVICE
        ? 'スマホ／タブレットでは CPU（WASM）で処理します（モバイルのWebGPUはWhisperで不安定なため）。'
        : (webgpuAvailable
          ? 'このPCは WebGPU 対応です。自動で GPU を使って高速に文字起こしします。'
          : 'このブラウザは WebGPU 非対応のため、CPU（WASM）で処理します。');
    } else if (v === 'webgpu') {
      backendHint.textContent = IS_TOUCH_DEVICE
        ? '⚠ モバイルのWebGPUはWhisperで不具合（createBufferエラー等）が出やすく非推奨です。エラー時は自動でCPUに切り替わります。通常は「自動」を推奨。'
        : (webgpuAvailable
          ? 'GPU を使って高速処理します（GPU / Apple Silicon 向け）。'
          : '⚠ このブラウザは WebGPU 非対応です。実行時は自動的に CPU（WASM）へ切り替わります。');
    } else {
      backendHint.textContent = 'CPU で処理します。低速ですが最も互換性が高い方式です。';
    }
  }
  localStorage.setItem(BACKEND_KEY, v);
  updateModelWarn();
}
if (backendSelect) backendSelect.addEventListener('change', applyBackendUI);

/** 大きいモデル×低メモリ端末のときに警告を出す */
function updateModelWarn() {
  if (!modelWarn) return;
  const isTurbo = accuracyModel.value === 'onnx-community/whisper-large-v3-turbo';
  const mem = navigator.deviceMemory; // GB（対応ブラウザのみ）
  const backend = backendSelect ? backendSelect.value : 'auto';
  let warn = '';
  if (isTurbo) {
    if (mem && mem < 8) warn = '⚠ この端末はメモリが少なめです（約' + mem + 'GB）。turbo は 16GB 以上の PC を推奨します。動作が重い場合は small / base に下げてください。';
    else if (backend === 'wasm' || (!webgpuAvailable && backend !== 'wasm')) warn = '⚠ turbo を CPU（WASM）で回すと非常に低速です。WebGPU 対応環境での利用を推奨します。';
    else warn = 'turbo は約1.2GB のダウンロードが発生します（初回のみ）。メモリ 16GB 以上の PC を推奨します。';
  }
  modelWarn.textContent = warn;
  modelWarn.hidden = !warn;
}
accuracyModel.addEventListener('change', updateModelWarn);

/* ===== 録音の診断（アプリ版のみ表示） =====
 * 「ロック画面に表示が出ない」「ゲージが動かない」は原因が複数あり得るので、
 * 通知の可否・サービスの状態・マイクから読めている音量をその場で確認できるようにする。 */
const diagPanel = $('diagPanel');
const diagBtn = $('diagBtn');
const diagText = $('diagText');
const diagNotifBtn = $('diagNotifBtn');
if (diagPanel && NATIVE) diagPanel.hidden = false;
if (diagBtn) {
  diagBtn.addEventListener('click', async () => {
    const rec = nativeRecorder();
    if (!rec) { diagText.textContent = '録音機能を利用できません（アプリ版でのみ使えます）。'; return; }
    const lines = [];
    let blocked = false;
    try {
      const n = typeof rec.getNotificationState === 'function' ? await rec.getNotificationState() : null;
      if (n) {
        blocked = !n.enabled || !n.channelEnabled;
        lines.push(`通知: ${n.enabled ? '許可' : '不許可'} / チャンネル「録音」: ${n.channelEnabled ? '有効' : '無効'}`);
      } else {
        lines.push('通知: 判定できません（アプリが古い可能性）');
      }
    } catch (_) { lines.push('通知: 取得に失敗'); }
    try {
      const s = await rec.getStatus();
      lines.push(`録音サービス: ${s && s.recording ? '動作中' : '停止中'}${s && s.engine ? `（${s.engine}）` : ''}`);
      if (s && typeof s.amp === 'number') {
        lines.push(`マイクの振幅: ${s.amp < 0 ? '未取得' : s.amp}（0〜32767）／ゲージ値: ${(s.level || 0).toFixed(2)}`);
        if (typeof s.sampleAgeMs === 'number') {
          const age = s.sampleAgeMs;
          lines.push(`音量の読み取り: ${age < 0 ? '未実行' : (age / 1000).toFixed(1) + '秒前'}${s.recording && age > 1000 ? '（止まっています）' : ''}`);
        }
        if (s.recording && s.amp === 0) lines.push('※ 音を出しながらもう一度押しても 0 のままなら、この端末では音量を読めていません。');
      }
    } catch (_) { lines.push('録音サービス: 状態を取得できません'); }
    diagText.textContent = lines.join(' / ');
    if (diagNotifBtn) diagNotifBtn.hidden = !blocked;
  });
}
if (diagNotifBtn) {
  diagNotifBtn.addEventListener('click', async () => {
    const rec = nativeRecorder();
    if (rec && typeof rec.openNotificationSettings === 'function') {
      try { await rec.openNotificationSettings(); } catch (_) {}
    }
  });
}

function showError(msg) { errorBox.textContent = msg; errorBox.hidden = false; }
function hideError() { errorBox.hidden = true; errorBox.textContent = ''; }

/* =========================================================
 * タップの波
 *   端末が出す四角いハイライトの代わりに、押した位置から丸い波を広げる。
 *   画面のいちばん上に重ねた層へ描くので、ボタンの形や重なりに影響しない。
 * =======================================================*/
const TAP_TARGETS = 'button, [role="button"], a[href], .drawer-item, .history-item, .settings-head, label.switch-row';
let tapWaveLayer = null;
function showTapWave(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const el = e.target && e.target.closest ? e.target.closest(TAP_TARGETS) : null;
  if (!el || el.disabled) return;
  if (!tapWaveLayer) {
    tapWaveLayer = document.createElement('div');
    tapWaveLayer.className = 'tap-wave-layer';
    document.body.appendChild(tapWaveLayer);
  }
  const r = el.getBoundingClientRect();
  const x = e.clientX || (r.left + r.width / 2);
  const y = e.clientY || (r.top + r.height / 2);
  // 押した位置から、その要素を覆うくらいの大きさまで広がる（広がりすぎない上限つき）
  const size = Math.max(44, Math.min(Math.hypot(r.width, r.height) * 1.15, 240));
  const w = document.createElement('span');
  w.className = 'tap-wave';
  w.style.left = (x - size / 2) + 'px';
  w.style.top = (y - size / 2) + 'px';
  w.style.width = w.style.height = size + 'px';
  w.addEventListener('animationend', () => w.remove());
  tapWaveLayer.appendChild(w);
}
document.addEventListener('pointerdown', showTapWave, { passive: true });

/* =========================================================
 * 設定のカード開閉
 *   設定の各カードは見出しをタップで開閉でき、閉じるとタイトルだけになる。
 *   どれを開いていたかは端末に保存し、次に開いたときも同じ状態にする。
 * =======================================================*/
const SETTINGS_OPEN_KEY = 'noteloop_settings_open';
const settingsSections = new Map();   // 見出しテキスト → { panel, body, toggle, isOpen() }

function loadSettingsOpen() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_OPEN_KEY)) || {}; } catch (_) { return {}; }
}
function initSettingsAccordion() {
  const screen = $('screen-settings');
  if (!screen) return;
  const openState = loadSettingsOpen();
  for (const panel of screen.querySelectorAll(':scope > .panel')) {
    const heading = panel.querySelector('.settings-group-title');
    if (!heading) continue;
    const key = heading.textContent.trim();

    // 見出しより後ろの要素をまとめて本文にする（開閉するのはこの部分）
    const body = document.createElement('div');
    body.className = 'settings-body';
    body.id = 'settingsBody-' + key.replace(/[^\w぀-ヿ一-龯]+/g, '-');
    let node = heading.nextSibling;
    while (node) { const next = node.nextSibling; body.appendChild(node); node = next; }
    panel.appendChild(body);

    // 見出しを開閉ボタンに差し替える
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'settings-head';
    toggle.setAttribute('aria-controls', body.id);
    toggle.innerHTML = `<span class="settings-head-text"></span><span class="settings-chev" aria-hidden="true">${ICO_CHEVRON}</span>`;
    toggle.querySelector('.settings-head-text').textContent = key;
    panel.replaceChild(toggle, heading);
    panel.classList.add('settings-card');

    const apply = (open) => {
      panel.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      body.hidden = !open;
      // マイクの入力レベルは、カードを開いている間だけ動かす
      if (key === 'マイク') {
        if (open && $('screen-settings').classList.contains('active')) activateSettingsMic();
        else if (typeof settingsMicMeter !== 'undefined') settingsMicMeter.stop();
      }
    };
    apply(!!openState[key]);   // 既定は閉じた状態（タイトルのみ）
    toggle.addEventListener('click', () => {
      const open = !panel.classList.contains('open');
      apply(open);
      const state = loadSettingsOpen();
      state[key] = open;
      localStorage.setItem(SETTINGS_OPEN_KEY, JSON.stringify(state));
    });
    settingsSections.set(key, { panel, body, toggle, isOpen: () => panel.classList.contains('open') });
  }
}
/** そのカードが開いているか（見出しの一部でも可） */
function isSettingsSectionOpen(name) {
  for (const [key, sec] of settingsSections) if (key.includes(name)) return sec.isOpen();
  return false;
}

meetingDate.value = todayStr();
downloadAudio.disabled = true;
setAudioAvailable(false);
if (keepAwake) { const kw = localStorage.getItem(WAKE_KEY); if (kw === '0') keepAwake.checked = false; }
geminiInstruction.value = loadGeminiInstruction();
// 「停止後の文字起こし」の復元（gemini=しない / whisper）
const savedEngine = localStorage.getItem(ENGINE_KEY);
if (savedEngine === 'gemini' || savedEngine === 'whisper') engineSelect.value = savedEngine;
// バックエンドの復元
if (backendSelect) {
  const savedBackend = localStorage.getItem(BACKEND_KEY);
  if (savedBackend === 'auto' || savedBackend === 'webgpu' || savedBackend === 'wasm') backendSelect.value = savedBackend;
  applyBackendUI();
}
applyEngineUI();
applyLiveUI();  // ライブ表示（Web Speech）の対応状況を反映
updateHomeUI();
renderParticipants();
loadTermDict();
renderDicts();      // 「用語の確認・修正」と設定の変換辞書を描画
initSettingsAccordion();  // 設定は各カードを開閉できる（既定は閉じてタイトルのみ）
drawerVerMain.textContent = APP_VERSION;
drawerVerSub.textContent = APP_UPDATED;

/* =========================================================
 * アプリ内更新（Androidアプリ版のみ）
 *   ストア配布ではないので自動更新が効かない。新しい版が出ていたら
 *   設定画面で知らせ、その場でダウンロード→インストールまで行う。
 * =======================================================*/
// Release に添付した version.json を見る。APK と同じビルドの成果物なので、
// 「配信中のAPKの版数」と必ず一致する（リポジトリ側のファイルだとズレうる）。
const VERSION_JSON_URL = 'https://github.com/tcta-tottori/NoteLoop/releases/latest/download/version.json';
// 予備の取得先。リリース資産は CORS ヘッダを返さず WebView の fetch から読めないが、
// raw.githubusercontent.com は CORS を許可している（中身は同じ version.json）。
const VERSION_JSON_RAW_URL = 'https://raw.githubusercontent.com/tcta-tottori/NoteLoop/main/version.json';
const updateBox      = $('updateBox');
const updateText     = $('updateText');
const updateBtn      = $('updateBtn');
const updateCheckBtn = $('updateCheckBtn');
let updateInfo = null;

function setUpdateStatus(kind, html, showBtn) {
  if (!updateBox) return;
  updateBox.hidden = false;
  updateText.className = 'field-hint' + (kind ? ' ' + kind : '');
  updateText.innerHTML = html;
  if (updateBtn) updateBtn.hidden = !showBtn;
}

/**
 * 配信中の version.json を取得する。
 *
 * WebView の fetch は https://localhost オリジンからの通信になり、
 * GitHub のリリース資産は CORS ヘッダを返さないため必ず
 * 「Failed to fetch」になる。ネイティブ側（Updater.fetchJson）は
 * CORS の制約を受けないので、そちらを優先して使う。
 */
async function fetchVersionJson(up) {
  // キャッシュを避けるため毎回クエリを変える
  const url = `${VERSION_JSON_URL}?t=${Date.now()}`;
  if (up && typeof up.fetchJson === 'function') return up.fetchJson({ url });
  // 更新機能が古い版（fetchJson なし）のときの保険。
  // リリース資産は CORS で弾かれるので、CORS を許可している raw を見る。
  const res = await fetch(`${VERSION_JSON_RAW_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/** 配信中の版を調べ、いまのアプリより新しければ知らせる */
async function checkForUpdate(manual) {
  if (!updateBox) return;
  if (!NATIVE) {
    // ブラウザ版は再読み込みで最新になるので、確認の仕組みそのものが要らない
    if (manual) setUpdateStatus('ok', 'ブラウザで開いているため、更新の確認は不要です。ページを再読み込みすれば常に最新版になります。', false);
    return;
  }
  const up = window.Capacitor.Plugins.Updater;
  if (!up) {
    if (manual) setUpdateStatus('warn', '⚠ このアプリには更新機能が入っていません。古い版のようなので、ブラウザから最新のAPKを入れ直してください。', false);
    return;
  }
  try {
    if (manual) setUpdateStatus('', '確認中…', false);
    const cur = await up.getInfo();
    const latest = await fetchVersionJson(up);
    updateInfo = latest;
    if (Number(latest.versionCode) > Number(cur.versionCode)) {
      setUpdateStatus('warn',
        `新しいバージョン <strong>${latest.version}</strong> があります（現在 ${cur.versionName}）。`
        + '<br>下のボタンでダウンロードし、そのままインストールできます。', true);
    } else if (manual) {
      setUpdateStatus('ok', `✓ 最新版です（${cur.versionName}）。`, false);
    } else {
      updateBox.hidden = true;
    }
  } catch (err) {
    if (manual) setUpdateStatus('warn', '⚠ 更新を確認できませんでした（通信を確認してください）。' + ((err && err.message) ? ' 詳細: ' + err.message : ''));
  }
}

if (updateCheckBtn) updateCheckBtn.addEventListener('click', () => checkForUpdate(true));
if (updateBtn) updateBtn.addEventListener('click', async () => {
  const up = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Updater;
  if (!up || !updateInfo) return;
  updateBtn.disabled = true;
  const orig = updateBtn.textContent;
  updateBtn.textContent = 'ダウンロード中…';
  // 進捗はネイティブ側から流れてくる
  const sub = up.addListener('downloadProgress', (ev) => {
    if (ev && ev.percent >= 0) updateBtn.textContent = `ダウンロード中… ${ev.percent}%`;
  });
  try {
    await up.downloadAndInstall({ url: updateInfo.apk });
    setUpdateStatus('ok', '✓ ダウンロードが完了しました。表示されたインストール画面で「インストール」を押してください。', false);
  } catch (err) {
    setUpdateStatus('warn', '⚠ ' + ((err && err.message) || err)
      + '<br>うまくいかない場合は、ブラウザから直接ダウンロードしてください: '
      + `<a href="${updateInfo.apk}" target="_blank" rel="noopener">APKを開く</a>`);
  } finally {
    try { (await sub).remove(); } catch (_) {}
    updateBtn.disabled = false;
    updateBtn.textContent = orig;
  }
});

// 起動時にそっと確認する（新しい版が無ければ何も出さない）
if (NATIVE) setTimeout(() => checkForUpdate(false), 2500);
/* =========================================================
 * 出力テキスト枠の展開ツールバー
 *   枠の右下に「＜」を固定表示。押すと機能ボタンが左へ時間差で展開し、
 *   ボタンは「＞」に変わる（もう一度押すと逆順で閉じる）。
 * =======================================================*/
let toastTimer = null;
function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2000);
}

const OUT_ACTS = {
  copy:     { label: 'コピー',       ico: ICO_COPY },
  term:     { label: '用語修正',     ico: ICO_TERM },
  info:     { label: '情報編集',     ico: ICO_EDIT },
  download: { label: 'ダウンロード', ico: ICO_DOWNLOAD },
  use:      { label: '上に反映',     ico: ICO_ARROW_UP },
  redo:     { label: '作り直す',     ico: ICO_REDO },
};
const DL_FORMATS = [
  { label: '.txt で保存',  ico: ICO_DOC,  run: () => exportTxtNow() },
  { label: 'Word (.docx)', ico: ICO_WORD, run: () => exportDocxNow() },
  { label: '.md で保存',   ico: ICO_MD,   run: () => exportMdNow() },
];

/**
 * テキストをクリップボードへコピーする。
 * （7.5 の Claude連携廃止のときに定義だけが消え、呼び出しだけが残っていたため復元）
 */
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* フォールバックへ */ }
  // 旧方式フォールバック（クリップボードAPIが使えない環境向け）
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) { return false; }
}

/** 枠内のテキストをすべてつなげる（コピー用） */
function outBoxText(box) {
  return Array.from(box.querySelectorAll('textarea'))
    .map((t) => t.value.trim()).filter(Boolean).join('\n\n');
}

function setupOutTools(tools) {
  const box = tools.closest('.out-box');
  if (!box) return;
  const acts = (tools.dataset.acts || '').split(',').map((s) => s.trim()).filter(Boolean);

  // 機能ボタン（DOM順に右→左で並ぶ。CSS の row-reverse ＋ 遅延で「ラグ」を出す）
  const actions = document.createElement('div');
  actions.className = 'out-actions';
  for (const key of acts) {
    const def = OUT_ACTS[key];
    if (!def) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'out-act';
    b.dataset.act = key;
    b.innerHTML = `${def.ico}<span>${def.label}</span>`;
    actions.appendChild(b);
  }
  tools.appendChild(actions);

  // ダウンロード形式のミニメニュー
  let menu = null;
  if (acts.includes('download')) {
    menu = document.createElement('div');
    menu.className = 'out-menu';
    for (const f of DL_FORMATS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `${f.ico}<span>${f.label}</span>`;
      b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); f.run(); });
      menu.appendChild(b);
    }
    tools.appendChild(menu);
  }

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'out-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', '機能を展開');
  toggle.innerHTML = ICO_CHEVRON;
  tools.appendChild(toggle);

  function closeMenu() { if (menu) menu.classList.remove('show'); }
  function setOpen(open) {
    tools.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? '機能を閉じる' : '機能を展開');
    if (!open) closeMenu();
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!tools.classList.contains('open'));
  });

  actions.addEventListener('click', async (e) => {
    const btn = e.target.closest('.out-act');
    if (!btn) return;
    e.stopPropagation();
    switch (btn.dataset.act) {
      case 'copy': {
        const text = outBoxText(box);
        if (!text) { showToast('コピーする内容がありません'); return; }
        showToast((await copyText(text)) ? 'コピーしました' : 'コピーできませんでした');
        break;
      }
      case 'term': openTermModal(); break;
      case 'info': openMeetingModal(); break;
      case 'download': if (menu) menu.classList.toggle('show'); break;
      case 'use': useAiTranscript(); break;
      case 'redo': {
        // 自動生成が失敗したとき等のやり直し（普段は録音停止後に自動で走る）
        if (tools.dataset.out === 'aitext') { hideError(); runAiTranscribe(); }
        else { hideError(); runAiAutoMinutes(); }
        setOpen(false);
        break;
      }
    }
  });

  // 枠の外をタップしたら閉じる（ダウンロード用の合成クリック等は無視）
  document.addEventListener('click', (ev) => {
    if (!ev.isTrusted) return;
    if (!tools.classList.contains('open')) return;
    if (tools.contains(ev.target)) return;
    setOpen(false);
  });
}
document.querySelectorAll('.out-tools').forEach((t) => setupOutTools(t));

/** AI処理中は「作り直す」を押せないようにする */
function updateOutToolsBusy() {
  const busy = !!(aiTextRunning || aiAutoRunning || aiFlowRunning);
  document.querySelectorAll('.out-act[data-act="redo"]').forEach((b) => { b.disabled = busy; });
}

const manVer = $('manVer'); if (manVer) manVer.textContent = `${APP_VERSION} ・ ${APP_UPDATED}`;
// マニュアルの目次: クリックで該当セクションへスクロール
document.querySelectorAll('.man-toc button[data-goto]').forEach((b) => {
  b.addEventListener('click', () => scrollToEl(b.dataset.goto));
});
seedIfEmpty();

// Service Worker 登録（アプリとしてインストール可能に / 起動を高速化）
// 新しい版が出たら自動で反映されるよう、更新検出→再読み込みまで行う。
// アプリ版（Capacitor）はアセットを APK に同梱しており、Service Worker で
// 更新を取りに行く必要がない。登録すると再読み込みループの原因にもなるため行わない。
if ('serviceWorker' in navigator && !NATIVE && !window.NOTELOOP_NATIVE_BUILD) {
  let swRefreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRefreshing || recording) return; // 録音中は中断しない
    swRefreshing = true;
    window.location.reload(); // 新しいSWが有効化されたら最新資産で読み直す
  });
  window.addEventListener('load', () => {
    // updateViaCache:'none' で sw.js 自体をHTTPキャッシュから読まず、更新を取りこぼさない
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        try { reg.update(); } catch (_) {}                 // 起動ごとに更新チェック
        if (!recording) clearRecordingNotification();       // 前回の残留通知を掃除
      })
      .catch(() => { /* 失敗しても通常動作に影響なし */ });
    // 復帰時にも更新チェック（アプリを開きっぱなしでも最新に）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        navigator.serviceWorker.getRegistration().then((r) => { if (r) { try { r.update(); } catch (_) {} } });
      }
    });
  });
}

// 画面復帰時: 録音中なら音声処理を再開し、通知を出し直す（バックグラウンド対策）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !recording) return;
  try { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); } catch (_) {}
  resumeBackgroundKeepAlive(); // 無音再生が止まっていたら再開
  if (NATIVE) warnIfNotificationsBlocked(); // 設定で通知を許可して戻ってきた場合に消す
  // Web Speech が停止していれば再開
  if (liveMode === 'webspeech' && !recognition) { try { beginRecognition(); } catch (_) {} }
  if (!wakeLock) acquireWakeLock(); // 画面復帰時にロックを取り直す（非表示中に自動解放されるため）
  notifLastSec = -1; // 次のtickで通知を更新
  // 非表示中に録音が止まっていたら、待たずにその場で録り直す
  recordWatchdogTick();
});
