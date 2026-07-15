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
const waveform       = $('waveform');
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

/* =========================================================
 * 画面切り替え（下部メニュー）
 * =======================================================*/
const navBtns = Array.from(document.querySelectorAll('.nav-btn'));
navBtns.forEach((btn) => {
  btn.addEventListener('click', () => showScreen(btn.dataset.target, btn.dataset.title));
});
function showScreen(id, title) {
  document.querySelectorAll('.screen').forEach((s) => {
    const active = s.id === id;
    s.classList.toggle('active', active);
    s.hidden = !active;
  });
  navBtns.forEach((b) => b.classList.toggle('active', b.dataset.target === id));
  if (title) screenTitle.textContent = title;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
toMinutes.addEventListener('click', () => showScreen('screen-minutes', '議事録'));

/* =========================================================
 * Web Worker（Whisper）
 * =======================================================*/
const worker = new Worker('./worker.js', { type: 'module' });
let finalResolve = null;   // 高精度パス完了を待つ Promise

worker.onmessage = (e) => {
  const msg = e.data || {};
  switch (msg.type) {
    case 'progress':
      if (msg.data && typeof msg.data.progress === 'number') setModelLoading(msg.data.progress);
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
  audioWrap.hidden = true;
  recordBtn.classList.add('recording');
  recordBtn.setAttribute('aria-label', '録音停止');
  recHint.textContent = '録音中… タップで停止';
  if (useLive) setStatus('working', '準備中…'); else setStatus('', '録音中');

  startTime = Date.now();
  updateTimer();
  timerInterval = setInterval(updateTimer, 250);
  drawWaveform();
  if (useLive) liveTimer = setInterval(() => maybeSendChunk(false), LIVE_INTERVAL_MS);
}

async function stopRecording() {
  recording = false;
  recordBtn.classList.remove('recording');
  recordBtn.setAttribute('aria-label', '録音開始');

  clearInterval(timerInterval);
  clearInterval(liveTimer); liveTimer = null;
  cancelAnimationFrame(rafId);

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

  // 高精度パス: 音声全体を再処理して確定版に置き換え
  if (recordedBlob) {
    await runFinalPass(recordedBlob);
  } else {
    setStatus('ready', 'モデル準備完了');
  }
  recHint.textContent = 'タップして録音開始';
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
  const procStart = Date.now();
  setStatus('working', '高精度で文字起こし中…');
  procTimer = setInterval(() => {
    const s = Math.floor((Date.now() - procStart) / 1000);
    setStatus('working', `高精度で文字起こし中…（${s}秒）`);
  }, 1000);

  try {
    const audio = await decodeTo16kMono(blob);
    // 音量チェック（無音・小音量だと誤認識・反復が起きやすい）
    const level = rms(audio);
    await new Promise((resolve) => {
      finalResolve = resolve;
      worker.postMessage(
        { type: 'transcribe', id: ++reqId, mode: 'final', longform: true,
          audio, model: accuracyModel.value, language: LANGUAGE },
        [audio.buffer]
      );
    });
    setStatus('ready', '文字起こし完了');
    if (level < 0.008) {
      showError('録音の音量がかなり小さいようです。マイクに近づける／端末の録音音量を上げると精度が上がります。');
    }
  } catch (err) {
    showError('高精度処理に失敗しました: ' + (err && err.message ? err.message : err));
    setStatus('ready', 'モデル準備完了');
  } finally {
    clearInterval(procTimer); procTimer = null;
    recordBtn.disabled = false;
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
clearTranscript.addEventListener('click', () => { liveTranscript.value = ''; });

/* ===== タイマー & 波形 ===== */
function updateTimer() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  timerEl.textContent = `${m}:${s}`;
}
function drawWaveform() {
  const ctx = waveform.getContext('2d');
  const buf = new Uint8Array(analyser.fftSize);
  const color = (getComputedStyle(document.documentElement).getPropertyValue('--brand1') || '#4f6ef7').trim();
  const render = () => {
    rafId = requestAnimationFrame(render);
    const w = waveform.width, h = waveform.height;
    analyser.getByteTimeDomainData(buf);
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.beginPath();
    const slice = w / buf.length; let x = 0;
    for (let i = 0; i < buf.length; i++) {
      const y = (buf[i] / 128.0 * h) / 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      x += slice;
    }
    ctx.lineTo(w, h / 2); ctx.stroke();
  };
  render();
}

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
    summary: fromBullets(secSummary.value),
    decisions: fromBullets(secDecisions.value),
    todos: fromBullets(secTodos.value),
  };
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function safeFileName(m) { return `${m.name}_${m.date}`.replace(/[\\/:*?"<>|\s]+/g, '_'); }

function buildPlainText(m) {
  const lines = [];
  lines.push(m.name);
  lines.push(`日付: ${m.date}`);
  lines.push('', '■ 要点・見出し', m.summary.length ? toBullets(m.summary) : '（なし）');
  lines.push('', '■ 決定事項', m.decisions.length ? toBullets(m.decisions) : '（なし）');
  lines.push('', '■ ToDo', m.todos.length ? toBullets(m.todos) : '（なし）');
  return lines.join('\n');
}
function buildMarkdown(m) {
  const sec = (t, arr) => `## ${t}\n\n` + (arr.length ? arr.map((x) => `- ${x}`).join('\n') : '（なし）') + '\n';
  return `# ${m.name}\n\n**日付:** ${m.date}\n\n` + sec('要点・見出し', m.summary) + '\n' + sec('決定事項', m.decisions) + '\n' + sec('ToDo', m.todos);
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
    const excerpt = [...(item.decisions || []), ...(item.summary || [])][0] || '（内容なし）';
    li.innerHTML = `<h3></h3><span class="meta"></span><span class="excerpt"></span>
      <div class="history-actions"><button class="open" type="button">開く</button><button class="del" type="button">削除</button></div>`;
    li.querySelector('h3').textContent = item.name + (item._sample ? '（サンプル）' : '');
    li.querySelector('.meta').textContent = item.date;
    li.querySelector('.excerpt').textContent = excerpt;
    li.querySelector('.open').addEventListener('click', () => openMinutes(item));
    li.querySelector('.del').addEventListener('click', () => deleteMinutes(item.id));
    historyList.appendChild(li);
  }
}
function openMinutes(item) {
  meetingName.value = item.name || '';
  meetingDate.value = item.date || '';
  fillMinutesUI({ summary: item.summary || [], decisions: item.decisions || [], todos: item.todos || [] });
  showScreen('screen-minutes', '議事録');
}
function deleteMinutes(id) { saveStore(loadStore().filter((x) => x.id !== id)); renderHistory(); }

saveMinutes.addEventListener('click', () => {
  const m = currentMinutes();
  if (!m.summary.length && !m.decisions.length && !m.todos.length) { showError('保存する議事録が空です。先に生成してください。'); return; }
  hideError();
  const list = loadStore();
  const id = 'm-' + Date.now() + '-' + Math.floor(performance.now());
  list.push({ id, name: m.name, date: m.date, summary: m.summary, decisions: m.decisions, todos: m.todos });
  saveStore(list);
  renderHistory();
  showScreen('screen-history', '過去の議事録');
});

/* =========================================================
 * 設定・エラー・初期化
 * =======================================================*/
liveEnabled.addEventListener('change', () => { liveModelField.style.display = liveEnabled.checked ? '' : 'none'; });

function showError(msg) { errorBox.textContent = msg; errorBox.hidden = false; }
function hideError() { errorBox.hidden = true; errorBox.textContent = ''; }

meetingDate.value = todayStr();
downloadAudio.disabled = true;
downloadWav.disabled = true;
liveModelField.style.display = liveEnabled.checked ? '' : 'none';
seedIfEmpty();

// Service Worker 登録（アプリとしてインストール可能に / 起動を高速化）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* 失敗しても通常動作に影響なし */ });
  });
}
