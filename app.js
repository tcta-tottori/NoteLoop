// app.js — NoteLoop メインロジック
// 録音（MediaRecorder + Web Audio）→ ブラウザ内 Whisper 文字起こし（worker.js）
//   ・録音中: 軽量モデルで暫定表示（ライブ）
//   ・停止後: 音声全体を高精度モデルで再処理して確定版に置き換え（精度重視）
// → 議事録整形（簡易ロジック / 差し替え可）→ txt / md / docx / メール / 音声 出力
'use strict';

const $ = (id) => document.getElementById(id);

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
const player         = $('player');
const audioSize      = $('audioSize');
const downloadAudio  = $('downloadAudio');
const downloadWav    = $('downloadWav');
const liveTranscript = $('liveTranscript');
const clearTranscript= $('clearTranscript');
const toMinutes      = $('toMinutes');

const LANGUAGE       = 'japanese';   // 日本語固定
const engineSelect   = $('engineSelect');
const engineHint     = $('engineHint');
const whisperSettings= $('whisperSettings');
const accuracyModel  = $('accuracyModel');
const liveEnabled    = $('liveEnabled');
const liveModel      = $('liveModel');
const liveModelField = $('liveModelField');

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
const exportMail     = $('exportMail');
const saveMinutes    = $('saveMinutes');
const historyList    = $('historyList');
const screenTitle    = $('screenTitle');

const claudeSend           = $('claudeSend');
const claudeCopy           = $('claudeCopy');
const claudeStatus         = $('claudeStatus');
const claudeOpen           = $('claudeOpen');
const claudePromptPreview  = $('claudePromptPreview');
const claudeInstruction    = $('claudeInstruction');
const claudeInstructionReset = $('claudeInstructionReset');

const appVersionEl   = $('appVersion');
const partDept       = $('partDept');
const partDeptOther  = $('partDeptOther');
const partName       = $('partName');
const partAdd        = $('partAdd');
const partList       = $('partList');

// バージョン / 更新日
const APP_VERSION = 'v1.1';
const APP_UPDATED = '2026/07/15 20:30';

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
let sttBase = '';               // 録音開始時点の既存テキスト
let sttFinal = '';              // 今回の録音で確定した認識結果

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
  setTimeout(() => { if (!drawer.classList.contains('open')) drawerBackdrop.hidden = true; }, 300);
}
menuToggle.addEventListener('click', () => {
  drawer.classList.contains('open') ? closeDrawer() : openDrawer();
});
drawerBackdrop.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
drawerItems.forEach((it) => it.addEventListener('click', () => {
  showScreen(it.dataset.target, it.dataset.title);
  closeDrawer();
}));

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
}
toMinutes.addEventListener('click', () => showScreen('screen-minutes', '議事録'));

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
  recHint.hidden = !recording;
  idlePrompt.hidden = recording || homeProcessing || hasText || hasAudio;
  transcriptPanel.hidden = !(recording || hasText || hasAudio);
  toMinutes.hidden = !(!recording && !homeProcessing && hasText);

  if (showWave) startWave(); else stopWave();
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
        // 高精度パスの結果で置き換え（反復ハルシネーションを後処理で除去）
        if (msg.text) liveTranscript.value = cleanupTranscript(msg.text);
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
 * 録音
 * =======================================================*/
recordBtn.addEventListener('click', async () => {
  if (recording) await stopRecording();
  else await startRecording();
});

async function startRecording() {
  hideError();
  activeEngine = engineSelect.value;

  // --- Web Speech: 認識専用（getUserMedia を使わずマイク競合を回避） ---
  if (activeEngine === 'webspeech') {
    const ok = startWebSpeech();
    if (!ok) return; // startWebSpeech がエラー表示
    recording = true;
    recordedBlob = null;
    sttActivity = 0.4;
    audioWrap.hidden = true;
    recordBtn.classList.add('recording');
    recordBtn.setAttribute('aria-label', '録音停止');
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
  audioWrap.hidden = true;
  recordBtn.classList.add('recording');
  recordBtn.setAttribute('aria-label', '録音停止');

  setStatus('working', useLive ? '準備中…' : '録音中');

  updateHomeUI();

  startTime = Date.now();
  updateTimer();
  timerInterval = setInterval(updateTimer, 250);
  if (useLive) liveTimer = setInterval(() => maybeSendChunk(false), LIVE_INTERVAL_MS);
}

async function stopRecording() {
  recording = false;
  recordBtn.classList.remove('recording');
  recordBtn.setAttribute('aria-label', '録音開始');
  recHint.hidden = true;
  timerEl.hidden = true;

  clearInterval(timerInterval);
  clearInterval(liveTimer); liveTimer = null;

  if (activeEngine === 'webspeech') stopWebSpeech();

  // 録音した音声を確定
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    await new Promise((res) => { mediaRecorder.onstop = res; mediaRecorder.stop(); });
    if (recordedBlobs.length) {
      recordedBlob = new Blob(recordedBlobs, { type: recordedBlobs[0].type || 'audio/webm' });
      player.src = URL.createObjectURL(recordedBlob);
      audioSize.textContent = formatBytes(recordedBlob.size);
      audioWrap.hidden = false;
      downloadAudio.disabled = false;
      downloadWav.disabled = false;
      // 保存ボタンに実際の拡張子を表示
      downloadAudio.innerHTML = `<span aria-hidden="true">⬇</span> 音声を保存 (.${extFromMime(recordedBlob.type)})`;
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
  sttFinal = '';
  return beginRecognition();
}

function onSpeechResult(e) {
  let interim = '';
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const r = e.results[i];
    if (r.isFinal) sttFinal += r[0].transcript;
    else interim += r[0].transcript;
  }
  liveTranscript.value = joinStt(sttBase, sttFinal + interim);
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

function onSpeechEnd() {
  // 録音継続中に認識が切れたら、新しいインスタンスで再開（無音や時間制限対策）
  if (recording && activeEngine === 'webspeech') {
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
  liveTranscript.value = joinStt(sttBase, sttFinal.trim());
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

/** Whisper の反復ハルシネーションを後処理で除去 */
function cleanupTranscript(text) {
  if (!text) return '';
  let t = text.replace(/\s+/g, ' ').trim();
  // 短い文字列の連続反復（例: 「5.5.5.5」「このようにこのように」）を 2 回までに圧縮
  t = t.replace(/(.{1,12}?)\1{3,}/g, '$1$1');
  // 句読点で区切り、直前と同じ断片が連続したら間引く
  const segs = t.split(/(?<=[。．！？!?、,])/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  let rep = 0;
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (prev && s === prev) { rep++; if (rep >= 1) continue; } else { rep = 0; }
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
  liveTranscript.value = cur ? cur + ' ' + text : text;
  liveTranscript.scrollTop = liveTranscript.scrollHeight;
}
clearTranscript.addEventListener('click', () => { liveTranscript.value = ''; updateHomeUI(); });
liveTranscript.addEventListener('input', updateHomeUI);

/* ===== タイマー ===== */
function updateTimer() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  timerEl.textContent = `${m}:${s}`;
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
  fillMinutesUI(generateMinutes(src));
}
generateBtn.addEventListener('click', runGenerate);
regenerateBtn.addEventListener('click', runGenerate);

/* =========================================================
 * 出力（txt / md / docx / mailto）
 * =======================================================*/
function currentMinutes() {
  return {
    name: meetingName.value.trim() || '議事録',
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
  lines.push(`日付: ${m.date}`);
  if (m.participants && m.participants.length) lines.push(`参加者: ${participantsText(m.participants)}`);
  lines.push('', '■ 要点・見出し', m.summary.length ? toBullets(m.summary) : '（なし）');
  lines.push('', '■ 決定事項', m.decisions.length ? toBullets(m.decisions) : '（なし）');
  lines.push('', '■ ToDo', m.todos.length ? toBullets(m.todos) : '（なし）');
  return lines.join('\n');
}
function buildMarkdown(m) {
  const sec = (t, arr) => `## ${t}\n\n` + (arr.length ? arr.map((x) => `- ${x}`).join('\n') : '（なし）') + '\n';
  const parts = (m.participants && m.participants.length) ? `**参加者:** ${participantsText(m.participants)}\n\n` : '';
  return `# ${m.name}\n\n**日付:** ${m.date}\n\n${parts}` + sec('要点・見出し', m.summary) + '\n' + sec('決定事項', m.decisions) + '\n' + sec('ToDo', m.todos);
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
    new Paragraph({ children: [new TextRun({ text: `日付: ${m.date}`, bold: true })] }),
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

exportMail.addEventListener('click', () => {
  const m = currentMinutes();
  const subject = `【議事録】${m.name}（${m.date}）`;
  const body = buildPlainText(m);
  const MAX = 1800;
  const trimmed = body.length > MAX ? body.slice(0, MAX) + '\n…（以下省略。txt/Word をご利用ください）' : body;
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(trimmed)}`;
});

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
    downloadWav.innerHTML = '<span aria-hidden="true">🎵</span> WAVに変換';
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
    const excerpt = item.transcript || [...(item.decisions || []), ...(item.summary || [])][0] || '（内容なし）';
    const meta = item.date + (item.participants && item.participants.length ? ' ・ ' + participantsText(item.participants) : '') + (item.audio ? ' ・ 🎧' : '');
    li.innerHTML = `<h3></h3><span class="meta"></span><span class="excerpt"></span>
      <div class="history-actions"><button class="open" type="button">開く</button><button class="audio" type="button" hidden>🎧 音声</button><button class="del" type="button">削除</button></div>`;
    li.querySelector('h3').textContent = item.name + (item._sample ? '（サンプル）' : '');
    li.querySelector('.meta').textContent = meta;
    li.querySelector('.excerpt').textContent = excerpt;
    li.querySelector('.open').addEventListener('click', () => openMinutes(item));
    const audioBtn = li.querySelector('.audio');
    if (item.audio) { audioBtn.hidden = false; audioBtn.addEventListener('click', () => downloadHistoryAudio(item)); }
    li.querySelector('.del').addEventListener('click', () => deleteMinutes(item.id));
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
日付: ${m.date}${partLine}${draft}

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
  // ジェスチャーを保つため先にウィンドウを開く（noopener は付けず、参照取得後に opener を切る）
  const win = window.open(CLAUDE_URL, '_blank');
  if (win) { try { win.opener = null; } catch (_) {} }
  claudeOpen.hidden = false; // 手動フォールバックのリンクは常に表示
  const copied = await copyText(prompt);
  if (!win) {
    setClaudeStatus('warn', 'ポップアップがブロックされました。下の「→ Claudeを開く」を押してください（プロンプトはコピー済みです）。');
  } else if (copied) {
    setClaudeStatus('ok', '✓ プロンプトをコピーしました。開いた Claude の入力欄に <strong>貼り付け（⌘/Ctrl+V）→ 送信</strong> してください。');
  } else {
    setClaudeStatus('warn', '⚠ 自動コピーできませんでした。下の「送信するプロンプトを確認」を開いて、内容を手動でコピーしてください。');
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
appVersionEl.innerHTML = `${APP_VERSION}<br>${APP_UPDATED}`;
seedIfEmpty();

// Service Worker 登録（アプリとしてインストール可能に / 起動を高速化）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* 失敗しても通常動作に影響なし */ });
  });
}
