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
const ICO_HEADPHONES = `<svg class="btn-ico" ${SVG_ATTR}><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1H3z"/></svg>`;
const ICO_TRASH      = `<svg class="btn-ico" ${SVG_ATTR}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;

/* ===== 要素 ===== */
const recordBtn      = $('recordBtn');
const recHint        = $('recHint');
const timerEl        = $('timer');
const wave           = $('wave');
const waveWrap       = $('waveWrap');
const statusBar      = $('statusBar');
const transcriptPanel= $('transcriptPanel');
const idlePrompt     = $('idlePrompt');
const modelStatus    = $('modelStatus');
const progressWrap   = $('progressWrap');
const progressBar    = $('progressBar');
const errorBox       = $('errorBox');
const audioWrap      = $('audioWrap');
const audioEmptyNote = $('audioEmptyNote');
const player         = $('player');
const audioSize      = $('audioSize');
const downloadAudio  = $('downloadAudio');
const downloadWav    = $('downloadWav');
const goMinutesFromHome = $('goMinutesFromHome');
const liveTranscript = $('liveTranscript');
const clearTranscript= $('clearTranscript');

const LANGUAGE       = 'japanese';   // 日本語固定
const engineSelect   = $('engineSelect');
const engineHint     = $('engineHint');
const whisperSettings= $('whisperSettings');
const accuracyModel  = $('accuracyModel');
const liveEnabled    = $('liveEnabled');
const liveModel      = $('liveModel');
const liveModelField = $('liveModelField');
const keepAwake      = $('keepAwake');

const meetingName    = $('meetingName');
const meetingDate    = $('meetingDate');
const generateBtn    = $('generateBtn');
const regenerateBtn  = $('regenerateBtn');
const secSummary     = $('secSummary');
const secDecisions   = $('secDecisions');
const secTodos       = $('secTodos');

const exportTxt      = $('exportTxt');
const exportMd       = $('exportMd');
const exportDocx     = $('exportDocx');
const saveMinutes    = $('saveMinutes');
const historyList    = $('historyList');
const screenTitle    = $('screenTitle');

// メール
const mailTo = $('mailTo'), mailSubject = $('mailSubject'), mailBody = $('mailBody');
const mailFromMinutes = $('mailFromMinutes');
const mailThunderbird = $('mailThunderbird'), mailGmail = $('mailGmail'), mailOutlook = $('mailOutlook'), mailEml = $('mailEml'), mailCopy = $('mailCopy');
// 用語辞書
const openTermFix = $('openTermFix');
const termModal = $('termModal'), termModalClose = $('termModalClose'), termModalDone = $('termModalDone');
const termWrong = $('termWrong'), termRight = $('termRight'), termApply = $('termApply'), termRegister = $('termRegister'), termApplyAll = $('termApplyAll');
const termDictList = $('termDictList'), termFoundNote = $('termFoundNote');

const claudeSend           = $('claudeSend');
const claudeCopy           = $('claudeCopy');
const claudeStatus         = $('claudeStatus');
const claudeOpen           = $('claudeOpen');
const claudePromptPreview  = $('claudePromptPreview');
const claudeInstruction    = $('claudeInstruction');
const claudeInstructionReset = $('claudeInstructionReset');

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
const openMeetingInfo     = $('openMeetingInfo');
const openMeetingInfoHome = $('openMeetingInfoHome');
const meetingSummary = $('meetingSummary');

// バージョン / 更新日（メニュー上部に表示）
const APP_VERSION = 'Ver.2.0';
const APP_UPDATED = '2026.7.16 10:15';

let participants = [];   // { dept, name }
let sttActivity = 0;     // Web Speech 用の波の活性度

/* ===== 状態 ===== */
const SAMPLE_RATE = 16000;
const CHUNK_MIN_SEC = 4;
const LIVE_INTERVAL_MS = 3000;

let recording = false;
let mediaStream = null;
let mediaRecorder = null;
let recordedBlobs = [];
let recordedBlob = null;
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
let workerBusy = false;
let reqId = 0;

// エンジン / Web Speech API
let activeEngine = 'whisper';   // 録音開始時に確定
let recognition = null;
let sttBase = '';       // 録音開始時点の既存テキスト
let sttSegs = [];       // 確定済みセグメント（過去の認識インスタンス分）
let sttCurFinal = '';   // 現インスタンスの確定分

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

function showScreen(id, title) {
  document.querySelectorAll('.screen').forEach((s) => {
    const active = s.id === id;
    s.classList.toggle('active', active);
    s.hidden = !active;
  });
  drawerItems.forEach((b) => b.classList.toggle('active', b.dataset.target === id));
  if (title) screenTitle.textContent = title;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (id === 'screen-home') updateHomeUI();
  if (id === 'screen-minutes') refreshAudioPanel();
}

/** 録音音声パネルの表示（音声の有無で再生カードと案内文を切替） */
function setAudioAvailable(has) {
  if (audioWrap) audioWrap.hidden = !has;
  if (audioEmptyNote) audioEmptyNote.hidden = has;
}
function refreshAudioPanel() { setAudioAvailable(!!recordedBlob); }

/* =========================================================
 * ホーム画面の表示状態（最小構成: 待機はマイクと点滅案内のみ）
 * =======================================================*/
let homeProcessing = false;
function updateHomeUI() {
  const hasText = liveTranscript.value.trim().length > 0;
  const hasAudio = !!recordedBlob;
  const showWave = recording || homeProcessing;

  waveWrap.hidden = !showWave;
  timerEl.hidden = !recording;
  idlePrompt.hidden = recording || homeProcessing || hasText || hasAudio;
  transcriptPanel.hidden = !(recording || hasText || hasAudio);
  transcriptPanel.classList.toggle('fade-old', recording || homeProcessing); // 文字起こし中は上側を薄く
  if (goMinutesFromHome) goMinutesFromHome.hidden = !(hasAudio && !recording && !homeProcessing); // 録音後は議事録への導線を出す
  updateFabState();

  if (showWave) startWave(); else stopWave();
}

/** 録音ボタンの段階変化: 録音 → 文字起こし中 → 議事録作成 → メール */
function updateFabState() {
  let state;
  if (recording) state = 'recording';
  else if (homeProcessing) state = 'processing';
  else {
    const hasText = liveTranscript.value.trim().length > 0;
    const hasMinutes = !!(secSummary.value.trim() || secDecisions.value.trim() || secTodos.value.trim());
    if (hasMinutes) state = 'mail';
    else if (hasText) state = 'minutes';
    else state = 'idle';
  }
  recordBtn.dataset.state = state;
  recordBtn.disabled = (state === 'processing');
  const labels = { idle: '', recording: '録音中… タップで停止', processing: '文字起こし中…', minutes: 'タップで議事録を作成', mail: 'タップでメールを作成' };
  const arias = { idle: '録音開始', recording: '録音停止', processing: '文字起こし中', minutes: '議事録を作成', mail: 'メールを作成' };
  recHint.textContent = labels[state] || '';
  recHint.hidden = (state === 'idle');
  recordBtn.setAttribute('aria-label', arias[state]);
}

/* =========================================================
 * Web Worker（Whisper）
 * =======================================================*/
const worker = new Worker('./worker.js', { type: 'module' });
let finalResolve = null;   // 高精度パス完了を待つ Promise

worker.onmessage = (e) => {
  const msg = e.data || {};
  switch (msg.type) {
    case 'progress':
      if (msg.data && typeof msg.data.progress === 'number') { lastDlProgress = performance.now(); setModelLoading(msg.data.progress); }
      break;
    case 'ready':
      setStatus('ready', 'モデル準備完了');
      break;
    case 'result':
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
        if (finalResolve) { finalResolve(); finalResolve = null; }
      } else {
        workerBusy = false;
      }
      showError('文字起こしエラー: ' + msg.message);
      break;
  }
};

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
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try { return (await Notification.requestPermission()) === 'granted'; } catch (_) { return false; }
}

/** 録音中の常駐通知を表示／更新（elapsed は "00:12" 形式） */
async function showRecordingNotification(elapsed) {
  if (!('serviceWorker' in navigator)) return;
  if (!(await ensureNotifyPermission())) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('● 録音中' + (elapsed ? '　' + elapsed : ''), {
      body: '画面を消しても録音は続きます。ここから停止できます。',
      tag: NOTIF_TAG, renotify: false, silent: true, requireInteraction: true,
      icon: './icons/icon-192.png', badge: './icons/favicon-48.png',
      actions: [{ action: 'stop', title: '■ 停止' }],
      data: { type: 'recording' },
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

// 通知の「停止」から送られてくるメッセージで録音を止める
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'stop-recording' && recording) stopRecording();
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

/* =========================================================
 * 録音
 * =======================================================*/
recordBtn.addEventListener('click', async () => {
  const st = recordBtn.dataset.state;
  if (st === 'recording') return stopRecording();
  if (st === 'processing') return;
  if (st === 'minutes') return showScreen('screen-minutes', '議事録');
  if (st === 'mail') { showScreen('screen-minutes', '議事録'); prepareMailFromMinutes(); scrollToEl('mailPanel'); return; }
  return startRecording();
});

async function startRecording() {
  hideError();
  activeEngine = engineSelect.value;
  acquireWakeLock(); // 設定がONなら画面を常時オンに（ユーザー操作の直後に要求）

  // --- Web Speech: ライブ認識 ＋ 並行して音声録音 ---
  if (activeEngine === 'webspeech') {
    if (!getSR()) {
      showError('このブラウザは Web Speech API（音声認識）に対応していません。設定でエンジンを「ブラウザ内Whisper」に切り替えてください。');
      return;
    }
    recordedBlob = null;
    setAudioAvailable(false);
    // 先に録音用マイクを確保してから認識を開始する。
    // （認識を先に始めてから getUserMedia するとブラウザによっては認識が止まり、
    //   録音中のライブ文字起こしが動かなくなるため、この順序が重要）
    await startWebSpeechAudioCapture();
    const ok = startWebSpeech();
    if (!ok) { teardownAudio(); return; } // 認識を開始できなければ後始末
    recording = true;
    sttActivity = 0.4;
    setStatus('working', '認識中…（Web Speech）');
    updateHomeUI();
    startTime = Date.now();
    updateTimer();
    timerInterval = setInterval(updateTimer, 250);
    return;
  }

  // --- Whisper: 録音（音声保存）＋停止後に高精度文字起こし ---
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

  const useLive = liveEnabled.checked;
  if (useLive) worker.postMessage({ type: 'load', model: liveModel.value });

  // MediaRecorder（再生・高精度再処理・音声出力用の音声を保持）
  // AI で共有しやすい m4a を優先し、非対応ブラウザでは最適な形式にフォールバック
  recordedBlobs = [];
  recordedBlob = null;
  try {
    const mime = pickAudioMime();
    mediaRecorder = mime ? new MediaRecorder(mediaStream, { mimeType: mime }) : new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedBlobs.push(e.data); };
    mediaRecorder.start();
  } catch (_) {
    try { mediaRecorder = new MediaRecorder(mediaStream); mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedBlobs.push(e.data); }; mediaRecorder.start(); }
    catch (_2) { mediaRecorder = null; }
  }

  // Web Audio（波形表示 + ライブ用 PCM を 16kHz で取得）
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  sourceNode = audioCtx.createMediaStreamSource(mediaStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  sourceNode.connect(analyser);

  if (useLive) {
    processorNode = audioCtx.createScriptProcessor(4096, 1, 1);
    processorNode.onaudioprocess = (e) => {
      if (!recording) return;
      pendingChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    const silent = audioCtx.createGain();
    silent.gain.value = 0;
    sourceNode.connect(processorNode);
    processorNode.connect(silent);
    silent.connect(audioCtx.destination);
  }

  recording = true;
  pendingChunks = [];
  recordedBlob = null;
  setAudioAvailable(false);

  setStatus('working', useLive ? '準備中…' : '録音中');

  updateHomeUI();

  startTime = Date.now();
  updateTimer();
  timerInterval = setInterval(updateTimer, 250);
  if (useLive) liveTimer = setInterval(() => maybeSendChunk(false), LIVE_INTERVAL_MS);
}

/**
 * Web Speech 認識中に、音声を並行して録音する（確認・保存用）。
 * マイク取得や MediaRecorder に失敗した場合は録音なしで認識のみ継続。
 */
async function startWebSpeechAudioCapture() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (_) { mediaStream = null; return; } // 認識は Web Speech 側の独自マイクで継続
  recordedBlobs = [];
  try {
    const mime = pickAudioMime();
    mediaRecorder = mime ? new MediaRecorder(mediaStream, { mimeType: mime }) : new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedBlobs.push(e.data); };
    mediaRecorder.start();
  } catch (_) { mediaRecorder = null; }
  // 波形を実際の音声レベルで動かす（取得できたときのみ）
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    sourceNode = audioCtx.createMediaStreamSource(mediaStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    sourceNode.connect(analyser);
  } catch (_) { analyser = null; }
}

async function stopRecording() {
  recording = false;
  recHint.hidden = true;
  timerEl.hidden = true;

  clearInterval(timerInterval);
  clearInterval(liveTimer); liveTimer = null;
  clearRecordingNotification();
  releaseWakeLock();

  if (activeEngine === 'webspeech') stopWebSpeech();

  // 録音した音声を確定
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    await new Promise((res) => { mediaRecorder.onstop = res; mediaRecorder.stop(); });
    if (recordedBlobs.length) {
      recordedBlob = new Blob(recordedBlobs, { type: recordedBlobs[0].type || 'audio/webm' });
      player.src = URL.createObjectURL(recordedBlob);
      audioSize.textContent = formatBytes(recordedBlob.size);
      setAudioAvailable(true);
      downloadAudio.disabled = false;
      downloadWav.disabled = false;
      // 保存ボタンに実際の拡張子を表示
      downloadAudio.innerHTML = `${ICO_DOWNLOAD} 音声を保存 (.${extFromMime(recordedBlob.type)})`;
    }
  }
  teardownAudio();

  if (activeEngine === 'webspeech') {
    // Web Speech はリアルタイムで確定済み。高精度パスは行わない。
    setStatus('ready', '認識完了');
    updateHomeUI();
  } else if (recordedBlob) {
    // Whisper: 音声全体を高精度で再処理して確定版に置き換え
    await runFinalPass(recordedBlob);
  } else {
    setStatus('ready', 'モデル準備完了');
    updateHomeUI();
  }
  checkTerms(); // 登録用語（会社名など）が含まれていれば確認ポップアップ
  // 文字起こし＋音声を自動的に履歴へ保存（最大10件）
  await autoSaveRecording();
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
  return beginRecognition();
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
  if (recording && activeEngine === 'webspeech') {
    commitSttSegment();
    setTimeout(() => { if (recording && activeEngine === 'webspeech') beginRecognition(); }, 200);
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
 * 録音停止後の高精度文字起こし（音声全体を 30 秒コンテキストで再処理）。
 * ライブの暫定テキストを、精度の高い確定版で置き換える。
 */
async function runFinalPass(blob) {
  recordBtn.disabled = true;
  homeProcessing = true;
  procProgress = 0;
  updateHomeUI();
  setStatus('working', '音声を準備中…');

  try {
    const audio = await decodeTo16kMono(blob);
    const level = rms(audio); // 音量チェック（無音だと誤認識・反復が起きやすい）

    // 所要時間を推定（音声長 × モデル係数）してETA表示に使う
    const durationSec = audio.length / SAMPLE_RATE;
    const factor = { 'Xenova/whisper-base': 2, 'Xenova/whisper-small': 4, 'Xenova/whisper-medium': 8 }[accuracyModel.value] || 4;
    const estTotal = Math.max(5, durationSec * factor);
    const procStart = Date.now();
    progressWrap.hidden = false;

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
          audio, model: accuracyModel.value, language: LANGUAGE },
        [audio.buffer]
      );
    });

    procProgress = 1;
    progressBar.style.width = '100%';
    setStatus('ready', '文字起こし完了');
    if (level < 0.008) {
      showError('録音の音量がかなり小さいようです。マイクに近づける／端末の録音音量を上げると精度が上がります。');
    }
  } catch (err) {
    showError('高精度処理に失敗しました: ' + (err && err.message ? err.message : err));
    setStatus('ready', 'モデル準備完了');
  } finally {
    clearInterval(procTimer); procTimer = null;
    progressWrap.hidden = true;
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

/** 句点（。．！？）で改行して読みやすく整形 */
function formatTranscript(text) {
  if (!text) return '';
  return text
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
async function decodeTo16kMono(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const tmp = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await tmp.decodeAudioData(arrayBuffer);
  tmp.close();
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
function maybeSendChunk(force) {
  if (workerBusy) return;
  const len = totalSamples(pendingChunks);
  if (len === 0) return;
  if (!force && len / SAMPLE_RATE < CHUNK_MIN_SEC) return;
  const audio = drainPending();
  workerBusy = true;
  if (recording) setStatus('working', '文字起こし中…（暫定）');
  worker.postMessage(
    { type: 'transcribe', id: ++reqId, mode: 'live', audio, model: liveModel.value, language: LANGUAGE },
    [audio.buffer]
  );
}
function appendTranscript(text) {
  const cur = liveTranscript.value.trimEnd();
  liveTranscript.value = formatTranscript(cur ? cur + ' ' + text : text);
  liveTranscript.scrollTop = liveTranscript.scrollHeight;
}
clearTranscript.addEventListener('click', () => { liveTranscript.value = ''; updateHomeUI(); });
if (goMinutesFromHome) goMinutesFromHome.addEventListener('click', () => showScreen('screen-minutes', '議事録'));
liveTranscript.addEventListener('input', updateHomeUI);

/* ===== タイマー ===== */
function updateTimer() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  timerEl.textContent = `${m}:${s}`;
  // 通知の経過時間は 5 秒ごとに更新（頻繁な再表示を避ける）
  if (recording && elapsed !== notifLastSec && (elapsed % 5 === 0)) {
    notifLastSec = elapsed;
    showRecordingNotification(`${m}:${s}`);
  }
}

/* ===== 上部のウェーブアニメーション ===== */
let waveRAF = null, wavePhase = 0, waveLevel = 0.14, waveActive = false;
let procProgress = 0;      // 高精度処理の推定進捗 0..1
let lastDlProgress = 0;    // 直近のモデルDL進捗の時刻
const waveBuf = new Uint8Array(1024);
function brandVar(n) { return (getComputedStyle(document.documentElement).getPropertyValue(n) || '').trim(); }
function resizeWave() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = wave.getBoundingClientRect();
  if (rect.width > 0) { wave.width = Math.round(rect.width * dpr); wave.height = Math.round(rect.height * dpr); }
}
function startWave() {
  if (waveActive) return;
  waveActive = true;
  resizeWave();
  waveLoop();
}
function stopWave() {
  waveActive = false;
  if (waveRAF) cancelAnimationFrame(waveRAF);
  waveRAF = null;
}
function waveLoop() {
  if (!waveActive) return;
  waveRAF = requestAnimationFrame(waveLoop);
  // 大きいほど速く揺れる（静かなときはゆっくり）
  wavePhase += 0.02 + waveLevel * 0.055;
  // 高精度処理中は「文字が打たれていく」別アニメーションを表示
  if (homeProcessing && !recording) { drawProcessingFrame(); return; }
  sttActivity *= 0.9;
  let target;
  if (recording && analyser) {
    analyser.getByteTimeDomainData(waveBuf);
    let s = 0;
    for (let i = 0; i < waveBuf.length; i++) { const x = (waveBuf[i] - 128) / 128; s += x * x; }
    const r = Math.sqrt(s / waveBuf.length);
    // ノイズゲート＋ゲイン: 静かなら凪(0)、声が大きいほど大きく（0〜1）
    const gated = Math.max(0, r - 0.008);
    target = Math.min(1, gated * 8);
  } else if (recording && activeEngine === 'webspeech') {
    target = sttActivity; // 音声解析なし → 発話イベントで揺らす
  } else {
    target = 0.14 + Math.sin(wavePhase * 1.4) * 0.05; // 処理中はゆるやかに揺れる
  }
  // アタックは速く、リリースはゆっくり → 自然な揺れ
  const k = target > waveLevel ? 0.4 : 0.06;
  waveLevel += (target - waveLevel) * k;
  drawWaveFrame();
}
/** 角丸矩形パス */
function rrect(ctx, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
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

function drawWaveFrame() {
  const ctx = wave.getContext('2d');
  const w = wave.width, h = wave.height, mid = h * 0.52;
  ctx.clearRect(0, 0, w, h);
  // 線で描く波。端に向かって振幅が細くなり、グロウで背景に溶け込む。
  const layers = [
    { amp: 0.42, freq: 1.3, speed: 0.8,  col: '#7c5cf6', a: 0.42 },
    { amp: 0.30, freq: 1.9, speed: -1.1, col: '#4f6ef7', a: 0.38 },
    { amp: 0.20, freq: 2.7, speed: 1.5,  col: '#ec4899', a: 0.30 },
  ];
  const step = Math.max(2, w / 240);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const L of layers) {
    ctx.beginPath();
    for (let x = 0; x <= w; x += step) {
      const t = x / w;
      const env = Math.sin(t * Math.PI);   // 端で0 → 中央でふくらむ（溶け込み）
      const y = mid + Math.sin(t * Math.PI * 2 * L.freq + wavePhase * L.speed)
                    * (h * L.amp * (0.05 + waveLevel)) * env;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = L.col; ctx.globalAlpha = L.a;
    ctx.lineWidth = Math.max(2.5, w * 0.0045);
    ctx.shadowColor = L.col; ctx.shadowBlur = 14;
    ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}
window.addEventListener('resize', () => { if (waveActive) resizeWave(); });

/* =========================================================
 * 議事録化（簡易ロジック / スタブ）
 *   本番ではこの generateMinutes をサーバの Claude 呼び出しに差し替える。
 * =======================================================*/
function generateMinutes(transcript) {
  const text = (transcript || '').replace(/\s+/g, ' ').trim();
  if (!text) return { summary: [], decisions: [], todos: [] };
  const sentences = text.split(/(?<=[。．！？!?])\s*/).map((s) => s.trim()).filter(Boolean);

  const decisionKw = ['決定', '決めた', '決めま', '決まり', '合意', '承認', '方針', 'することにし', '確定', '採用'];
  const todoKw = ['ToDo', 'タスク', '対応し', '確認し', '準備', '実施', '送付', '送りま', '連絡', '作成', '提出',
                  'までに', '期限', 'お願いし', 'してくださ', '担当', '進めま', '検討し', 'フォロー', '共有し'];

  const decisions = [], todos = [], rest = [];
  for (const s of sentences) {
    if (decisionKw.some((k) => s.includes(k))) decisions.push(s);
    else if (todoKw.some((k) => s.includes(k))) todos.push(s);
    else rest.push(s);
  }
  let summary = rest.slice(0, 5);
  if (summary.length === 0) summary = sentences.slice(0, 3);
  return { summary: dedupe(summary), decisions: dedupe(decisions), todos: dedupe(todos) };
}
function dedupe(arr) {
  const seen = new Set();
  return arr.filter((x) => { const k = x.trim(); if (seen.has(k)) return false; seen.add(k); return true; });
}
function toBullets(arr) { return arr.map((x) => '・' + x).join('\n'); }
function fromBullets(str) { return (str || '').split('\n').map((l) => l.replace(/^[・\-*•]\s*/, '').trim()).filter(Boolean); }
function fillMinutesUI(m) {
  secSummary.value = toBullets(m.summary);
  secDecisions.value = toBullets(m.decisions);
  secTodos.value = toBullets(m.todos);
}
function runGenerate() {
  const src = liveTranscript.value.trim();
  if (!src) { showError('文字起こしが空です。先に録音するか、テキストを入力してください。'); showScreen('screen-home', '録音・文字起こし'); return; }
  hideError();
  ensureAutoTitle();  // タイトル未設定なら文字起こしから自動生成
  fillMinutesUI(generateMinutes(src));
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
/** タイトルが未入力なら、文字起こしから自動生成してフィールドへ反映 */
function ensureAutoTitle() {
  if (meetingName.value.trim()) return;
  const t = autoTitleFromTranscript(liveTranscript.value);
  if (t) { meetingName.value = t; updateMeetingSummary(); }
}
generateBtn.addEventListener('click', runGenerate);
regenerateBtn.addEventListener('click', runGenerate);

/* =========================================================
 * 出力（txt / md / docx / mailto）
 * =======================================================*/
function currentMinutes() {
  return {
    name: meetingName.value.trim() || autoTitleFromTranscript(liveTranscript.value) || '議事録',
    date: meetingDate.value || todayStr(),
    participants: participants.slice(),
    summary: fromBullets(secSummary.value),
    decisions: fromBullets(secDecisions.value),
    todos: fromBullets(secTodos.value),
  };
}
function participantLabel(p) { return p.dept ? (p.name ? `${p.dept} ${p.name}` : p.dept) : (p.name || ''); }
function participantsText(list) { return (list || []).map(participantLabel).filter(Boolean).join('、'); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function safeFileName(m) { return `${m.name}_${m.date}`.replace(/[\\/:*?"<>|\s]+/g, '_'); }

function buildPlainText(m) {
  const lines = [];
  lines.push(m.name);
  lines.push(`日付: ${formatDateJp(m.date)}`);
  if (m.participants && m.participants.length) lines.push(`参加者: ${participantsText(m.participants)}`);
  lines.push('', '■ 要点・見出し', m.summary.length ? toBullets(m.summary) : '（なし）');
  lines.push('', '■ 決定事項', m.decisions.length ? toBullets(m.decisions) : '（なし）');
  lines.push('', '■ ToDo', m.todos.length ? toBullets(m.todos) : '（なし）');
  return lines.join('\n');
}
function buildMarkdown(m) {
  const sec = (t, arr) => `## ${t}\n\n` + (arr.length ? arr.map((x) => `- ${x}`).join('\n') : '（なし）') + '\n';
  const parts = (m.participants && m.participants.length) ? `**参加者:** ${participantsText(m.participants)}\n\n` : '';
  return `# ${m.name}\n\n**日付:** ${formatDateJp(m.date)}\n\n${parts}` + sec('要点・見出し', m.summary) + '\n' + sec('決定事項', m.decisions) + '\n' + sec('ToDo', m.todos);
}
function download(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

exportTxt.addEventListener('click', () => { const m = currentMinutes(); download(`${safeFileName(m)}.txt`, buildPlainText(m), 'text/plain;charset=utf-8'); });
exportMd.addEventListener('click', () => { const m = currentMinutes(); download(`${safeFileName(m)}.md`, buildMarkdown(m), 'text/markdown;charset=utf-8'); });

exportDocx.addEventListener('click', async () => {
  const m = currentMinutes();
  if (!window.docx) { showError('Word 出力ライブラリの読み込みに失敗しました（オンライン環境で再読み込みしてください）。'); return; }
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = window.docx;
  const bulletParas = (arr) => arr.length
    ? arr.map((t) => new Paragraph({ text: t, bullet: { level: 0 } }))
    : [new Paragraph({ children: [new TextRun({ text: '（なし）', italics: true })] })];
  const doc = new Document({ sections: [{ children: [
    new Paragraph({ text: m.name, heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun({ text: `日付: ${formatDateJp(m.date)}`, bold: true })] }),
    ...(m.participants && m.participants.length ? [new Paragraph({ children: [new TextRun({ text: `参加者: ${participantsText(m.participants)}` })] })] : []),
    new Paragraph({ text: '要点・見出し', heading: HeadingLevel.HEADING_1 }), ...bulletParas(m.summary),
    new Paragraph({ text: '決定事項', heading: HeadingLevel.HEADING_1 }), ...bulletParas(m.decisions),
    new Paragraph({ text: 'ToDo', heading: HeadingLevel.HEADING_1 }), ...bulletParas(m.todos),
  ] }] });
  try {
    const blob = await Packer.toBlob(doc);
    download(`${safeFileName(m)}.docx`, blob, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  } catch (err) { showError('Word 出力に失敗しました: ' + (err && err.message ? err.message : err)); }
});


/* =========================================================
 * メール作成（既定メーラー / Gmail / Outlook / .eml）
 * =======================================================*/
function buildMailSubject(m) { return `【議事録】${m.name}（${formatDateJp(m.date)}）`; }
function prepareMailFromMinutes() {
  const m = currentMinutes();
  if (!mailSubject.value.trim()) mailSubject.value = buildMailSubject(m);
  if (!mailBody.value.trim()) mailBody.value = buildPlainText(m);
}
mailFromMinutes.addEventListener('click', () => {
  const m = currentMinutes();
  mailSubject.value = buildMailSubject(m);
  mailBody.value = buildPlainText(m);
});
mailThunderbird.addEventListener('click', () => {
  const to = mailTo.value.trim();
  const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(mailSubject.value)}&body=${encodeURIComponent(mailBody.value)}`;
  window.location.href = href;
});
mailGmail.addEventListener('click', () => {
  const u = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(mailTo.value.trim())}&su=${encodeURIComponent(mailSubject.value)}&body=${encodeURIComponent(mailBody.value)}`;
  window.open(u, '_blank', 'noopener');
});
mailOutlook.addEventListener('click', () => {
  const u = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(mailTo.value.trim())}&subject=${encodeURIComponent(mailSubject.value)}&body=${encodeURIComponent(mailBody.value)}`;
  window.open(u, '_blank', 'noopener');
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
  const ok = await copyText(mailBody.value);
  showError(ok ? '' : '本文のコピーに失敗しました。');
  if (ok) { hideError(); }
});

/* =========================================================
 * 用語の確認・修正（会社名など）＋辞書
 * =======================================================*/
const TERM_KEY = 'noteloop_terms';
let termDict = [];
function loadTermDict() { try { termDict = JSON.parse(localStorage.getItem(TERM_KEY)) || []; } catch (_) { termDict = []; } }
function saveTermDict() { localStorage.setItem(TERM_KEY, JSON.stringify(termDict)); }
function replaceAllInTranscript(wrong, right) {
  if (!wrong) return 0;
  const before = liveTranscript.value;
  const after = before.split(wrong).join(right);
  const n = before === after ? 0 : (before.split(wrong).length - 1);
  if (n > 0) { liveTranscript.value = after; updateHomeUI(); }
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
    li.querySelector('.wrong').textContent = t.wrong;
    li.querySelector('.right').textContent = t.right;
    li.querySelector('.t-apply').addEventListener('click', () => { const n = replaceAllInTranscript(t.wrong, t.right); showTermNote(`「${t.wrong}」を ${n} 件置換しました。`); });
    li.querySelector('.t-del').addEventListener('click', () => { termDict.splice(i, 1); saveTermDict(); renderTermDict(); });
    termDictList.appendChild(li);
  });
}
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
openTermFix.addEventListener('click', () => openTermModal());
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
  if (!termDict.some((t) => t.wrong === w)) termDict.push({ wrong: w, right: r });
  saveTermDict(); renderTermDict();
  showTermNote(`辞書に登録しました。以後、録音後に「${w}」を自動でチェックします。`);
});
termApplyAll.addEventListener('click', () => {
  let total = 0;
  for (const t of termDict) total += replaceAllInTranscript(t.wrong, t.right);
  showTermNote(`登録用語をすべて適用しました（計 ${total} 件置換）。`);
});
/** 録音後に登録用語が含まれていれば確認ポップアップを開く */
function checkTerms() {
  if (!termDict.length) return;
  const text = liveTranscript.value;
  const found = termDict.filter((t) => text.includes(t.wrong));
  if (found.length) {
    openTermModal(`「${found.map((t) => t.wrong).join('」「')}」が見つかりました。正しい語に一括修正できます。`);
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
downloadWav.addEventListener('click', async () => {
  if (!recordedBlob) { showError('変換できる音声がありません。先に録音してください。'); return; }
  hideError();
  downloadWav.disabled = true;
  downloadWav.textContent = '変換中…';
  try {
    const arrayBuffer = await recordedBlob.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    ctx.close();
    const m = currentMinutes();
    download(`${safeFileName(m)}.wav`, audioBufferToWav(audioBuffer), 'audio/wav');
  } catch (err) {
    showError('WAV への変換に失敗しました: ' + (err && err.message ? err.message : err));
  } finally {
    downloadWav.disabled = false;
    downloadWav.innerHTML = `${ICO_MUSIC} WAVに変換`;
  }
});
function audioBufferToWav(buffer) {
  const numCh = buffer.numberOfChannels, sampleRate = buffer.sampleRate, channels = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
  const frames = buffer.length, bytesPerSample = 2, blockAlign = numCh * bytesPerSample, dataSize = frames * blockAlign;
  const arr = new ArrayBuffer(44 + dataSize), view = new DataView(arr);
  const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeStr(8, 'WAVE');
  writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true);
  writeStr(36, 'data'); view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true); offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

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
  if (pt) html += `<br>参加者: ${escapeHtml(pt)}`;
  meetingSummary.innerHTML = html;
}
function openMeetingModal() {
  meetingModal.hidden = false;
  requestAnimationFrame(() => meetingModal.classList.add('show'));
}
function closeMeetingModal() {
  meetingModal.classList.remove('show');
  setTimeout(() => { if (!meetingModal.classList.contains('show')) meetingModal.hidden = true; }, 260);
  updateMeetingSummary();
}
openMeetingInfo.addEventListener('click', openMeetingModal);
openMeetingInfoHome.addEventListener('click', openMeetingModal);
meetingModalClose.addEventListener('click', closeMeetingModal);
meetingModalDone.addEventListener('click', closeMeetingModal);
meetingModal.addEventListener('click', (e) => { if (e.target === meetingModal) closeMeetingModal(); });
meetingName.addEventListener('input', updateMeetingSummary);
meetingDate.addEventListener('input', updateMeetingSummary);

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
async function autoSaveRecording() {
  const transcript = liveTranscript.value.trim();
  if (!transcript) { updateHomeUI(); return; }
  ensureAutoTitle();  // タイトル未設定なら文字起こしから自動生成
  const m = currentMinutes();
  const gen = generateMinutes(transcript);
  const id = 'rec-' + Date.now() + '-' + Math.floor(performance.now());
  let audio = null;
  if (recordedBlob) {
    try { await idbPut(id, recordedBlob); audio = { ext: extFromMime(recordedBlob.type), size: recordedBlob.size }; }
    catch (_) { audio = null; }
  }
  const entry = {
    id, name: m.name, date: m.date, participants: m.participants,
    transcript, summary: gen.summary, decisions: gen.decisions, todos: gen.todos,
    audio, ts: Date.now(), auto: true,
  };
  const list = loadStore();
  list.push(entry);
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
function seedIfEmpty() {
  let list = loadStore();
  if (list.length === 0) {
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
    const excerpt = item.transcript || [...(item.decisions || []), ...(item.summary || [])][0] || '（内容なし）';
    const meta = formatDateJp(item.date) + (item.participants && item.participants.length ? ' ・ ' + participantsText(item.participants) : '') + (item.audio ? ' ・ 音声あり' : '');
    li.innerHTML = `<h3></h3><span class="meta"></span><span class="excerpt"></span>
      <div class="history-actions">
        <button class="audio icon-btn" type="button" aria-label="音声を保存" hidden>${ICO_HEADPHONES}</button>
        <button class="del icon-btn" type="button" aria-label="削除">${ICO_TRASH}</button>
      </div>`;
    li.querySelector('h3').textContent = item.name + (item._sample ? '（サンプル）' : '');
    li.querySelector('.meta').textContent = meta;
    li.querySelector('.excerpt').textContent = excerpt;
    // カードをタップ / Enter で開く
    li.addEventListener('click', () => openMinutes(item));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMinutes(item); } });
    const audioBtn = li.querySelector('.audio');
    if (item.audio) { audioBtn.hidden = false; audioBtn.addEventListener('click', (e) => { e.stopPropagation(); downloadHistoryAudio(item); }); }
    li.querySelector('.del').addEventListener('click', (e) => { e.stopPropagation(); deleteMinutes(item.id); });
    historyList.appendChild(li);
  }
}
async function downloadHistoryAudio(item) {
  try {
    const blob = await idbGet(item.id);
    if (!blob) { showError('保存された音声が見つかりませんでした。'); return; }
    hideError();
    download(`${safeFileName(item)}.${(item.audio && item.audio.ext) || 'webm'}`, blob, blob.type || 'audio/webm');
  } catch (_) { showError('音声の読み込みに失敗しました。'); }
}
function openMinutes(item) {
  meetingName.value = item.name || '';
  meetingDate.value = item.date || '';
  participants = (item.participants || []).map((p) => ({ dept: p.dept || '', name: p.name || '' }));
  renderParticipants();
  updateMeetingSummary();
  fillMinutesUI({ summary: item.summary || [], decisions: item.decisions || [], todos: item.todos || [] });
  if (item.transcript) liveTranscript.value = item.transcript;
  showScreen('screen-minutes', '議事録');
}
function deleteMinutes(id) {
  const item = loadStore().find((x) => x.id === id);
  if (item && item.audio) idbDel(id);
  saveStore(loadStore().filter((x) => x.id !== id));
  renderHistory();
}

saveMinutes.addEventListener('click', () => {
  const m = currentMinutes();
  if (!m.summary.length && !m.decisions.length && !m.todos.length) { showError('保存する議事録が空です。先に生成してください。'); return; }
  hideError();
  const list = loadStore();
  const id = 'm-' + Date.now() + '-' + Math.floor(performance.now());
  list.push({ id, name: m.name, date: m.date, participants: m.participants, transcript: liveTranscript.value.trim(), summary: m.summary, decisions: m.decisions, todos: m.todos });
  while (list.length > 10) { const removed = list.shift(); if (removed && removed.audio) idbDel(removed.id); }
  saveStore(list);
  renderHistory();
  showScreen('screen-history', '過去の議事録');
});

/* =========================================================
 * Claude 連携（1クリックでプロンプトをコピー → Claudeを開く）
 * =======================================================*/
const CLAUDE_URL = 'https://claude.ai/new';
const CLAUDE_INSTR_KEY = 'noteloop_claude_instruction';
const DEFAULT_CLAUDE_INSTRUCTION =
`以下の会議の文字起こしから、正確で読みやすい議事録を作成してください。

【出力形式】この見出しで、箇条書き中心にまとめてください。
## 要点・見出し
## 決定事項
## ToDo（担当・期限がわかれば「― 担当/期限」の形で併記）

【作成の指示】
- 文字起こしの誤変換・言い間違いは、文脈から自然に補正してください。
- 重要な数値・固有名詞・日付・金額は必ず保持してください。
- 相槌や言い直し、雑談は省き、簡潔にまとめてください。
- 決定事項とToDo（未確定の宿題）は明確に区別してください。
- 判断できない箇所は「（要確認）」と明記してください。`;

function loadInstruction() {
  return localStorage.getItem(CLAUDE_INSTR_KEY) || DEFAULT_CLAUDE_INSTRUCTION;
}

/** Claude に渡すプロンプトを組み立てる（指示 ＋ 会議情報 ＋ 下書き ＋ 文字起こし） */
function buildClaudePrompt() {
  const m = currentMinutes();
  const transcript = liveTranscript.value.trim();
  const instr = (claudeInstruction.value || DEFAULT_CLAUDE_INSTRUCTION).trim();

  let draft = '';
  if (m.summary.length || m.decisions.length || m.todos.length) {
    draft = `\n\n【アプリの下書き（参考・必要なら修正してください）】\n` +
      `■ 要点・見出し\n${m.summary.length ? toBullets(m.summary) : '（なし）'}\n` +
      `■ 決定事項\n${m.decisions.length ? toBullets(m.decisions) : '（なし）'}\n` +
      `■ ToDo\n${m.todos.length ? toBullets(m.todos) : '（なし）'}`;
  }

  const partLine = (m.participants && m.participants.length) ? `\n参加者: ${participantsText(m.participants)}` : '';
  return `${instr}

【会議情報】
会議名: ${m.name}
日付: ${formatDateJp(m.date)}${partLine}${draft}

【文字起こし】
${transcript}`;
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* フォールバックへ */ }
  // 旧方式フォールバック
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) { return false; }
}

function setClaudeStatus(kind, html) {
  claudeStatus.hidden = false;
  claudeStatus.className = 'claude-status' + (kind ? ' ' + kind : '');
  claudeStatus.innerHTML = html;
}

function ensureTranscript() {
  const t = liveTranscript.value.trim();
  if (!t) {
    showError('文字起こしが空です。先に「録音」画面で録音するか、テキストを入力してください。');
    showScreen('screen-home', '録音・文字起こし');
    return false;
  }
  return true;
}

// コピーしてClaudeを開く
claudeSend.addEventListener('click', async () => {
  if (!ensureTranscript()) return;
  hideError();
  const prompt = buildClaudePrompt();
  claudePromptPreview.value = prompt;
  // 短いプロンプトは ?q= で事前入力を試みる（URL長の制限があるため長い場合は /new）。
  // どちらでもクリップボードにコピーしておき、貼り付けでも送れるようにする。
  const url = prompt.length <= 6000 ? `${CLAUDE_URL}?q=${encodeURIComponent(prompt)}` : CLAUDE_URL;
  const win = window.open(url, '_blank');
  if (win) { try { win.opener = null; } catch (_) {} }
  claudeOpen.href = url;
  claudeOpen.hidden = false; // 手動フォールバックのリンクは常に表示
  const copied = await copyText(prompt);
  if (!win) {
    setClaudeStatus('warn', 'ポップアップがブロックされました。下の「→ Claudeを開く」を押してください（プロンプトはコピー済みです）。');
  } else if (copied) {
    setClaudeStatus('ok', '✓ Claudeを開きました。プロンプトが未入力の場合は入力欄で <strong>貼り付け（⌘/Ctrl+V）→ 送信</strong>（コピー済み）。');
  } else {
    setClaudeStatus('warn', 'Claudeを開きました。未入力なら下の「送信するプロンプトを確認」から手動でコピーしてください。');
  }
});

// プロンプトをコピーのみ
claudeCopy.addEventListener('click', async () => {
  if (!ensureTranscript()) return;
  hideError();
  const prompt = buildClaudePrompt();
  claudePromptPreview.value = prompt;
  const copied = await copyText(prompt);
  claudeOpen.hidden = false;
  if (copied) setClaudeStatus('ok', '✓ プロンプトをコピーしました。「→ Claudeを開く」から貼り付けて送信してください。');
  else setClaudeStatus('warn', '⚠ 自動コピーできませんでした。下の「送信するプロンプトを確認」から手動でコピーしてください。');
});

// 指示テンプレートの保存・リセット
claudeInstruction.addEventListener('input', () => {
  localStorage.setItem(CLAUDE_INSTR_KEY, claudeInstruction.value);
});
claudeInstructionReset.addEventListener('click', () => {
  claudeInstruction.value = DEFAULT_CLAUDE_INSTRUCTION;
  localStorage.setItem(CLAUDE_INSTR_KEY, DEFAULT_CLAUDE_INSTRUCTION);
});

/* =========================================================
 * 設定・エラー・初期化
 * =======================================================*/
liveEnabled.addEventListener('change', () => { liveModelField.style.display = liveEnabled.checked ? '' : 'none'; });

// 画面常時オン設定の保存 / 即時反映（録音中に切り替えたら取得・解放）
if (keepAwake) {
  keepAwake.addEventListener('change', () => {
    localStorage.setItem(WAKE_KEY, keepAwake.checked ? '1' : '0');
    if (recording) { keepAwake.checked ? acquireWakeLock() : releaseWakeLock(); }
  });
}

const ENGINE_KEY = 'noteloop_engine';
function applyEngineUI() {
  const ws = engineSelect.value === 'webspeech';
  whisperSettings.style.display = ws ? 'none' : '';
  engineHint.textContent = ws
    ? 'ブラウザ標準の音声認識。リアルタイムで高精度ですが、音声はブラウザ経由でクラウド（Chromeは Google、Edgeは Azure）へ送信され、インターネット接続が必要です。'
    : '音声を端末内で処理します（外部送信なし・オフライン可）。初回はモデルをダウンロードします。';
  if (!recording) setStatus('', ws ? 'Web Speech（要ネット）' : 'モデル未読み込み');
  localStorage.setItem(ENGINE_KEY, engineSelect.value);
}
engineSelect.addEventListener('change', applyEngineUI);

function showError(msg) { errorBox.textContent = msg; errorBox.hidden = false; }
function hideError() { errorBox.hidden = true; errorBox.textContent = ''; }

meetingDate.value = todayStr();
downloadAudio.disabled = true;
downloadWav.disabled = true;
setAudioAvailable(false);
if (keepAwake) { const kw = localStorage.getItem(WAKE_KEY); if (kw === '0') keepAwake.checked = false; }
liveModelField.style.display = liveEnabled.checked ? '' : 'none';
claudeInstruction.value = loadInstruction();
// エンジンの復元 + Web Speech 非対応ブラウザの表示
const savedEngine = localStorage.getItem(ENGINE_KEY);
if (savedEngine === 'webspeech' || savedEngine === 'whisper') engineSelect.value = savedEngine;
if (!getSR()) {
  const opt = engineSelect.querySelector('option[value="webspeech"]');
  if (opt) opt.textContent = 'Web Speech API（このブラウザは非対応）';
  if (engineSelect.value === 'webspeech') engineSelect.value = 'whisper'; // 非対応なら Whisper に
}
applyEngineUI();
updateHomeUI();
renderParticipants();
loadTermDict();
drawerVerMain.textContent = APP_VERSION;
drawerVerSub.textContent = APP_UPDATED;
seedIfEmpty();

// Service Worker 登録（アプリとしてインストール可能に / 起動を高速化）
// 新しい版が出たら自動で反映されるよう、更新検出→再読み込みまで行う。
if ('serviceWorker' in navigator) {
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
  // Web Speech が停止していれば再開
  if (activeEngine === 'webspeech' && !recognition) { try { beginRecognition(); } catch (_) {} }
  if (!wakeLock) acquireWakeLock(); // 画面復帰時にロックを取り直す（非表示中に自動解放されるため）
  notifLastSec = -1; // 次のtickで通知を更新
});
