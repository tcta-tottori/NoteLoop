// app.js — NoteLoop メインロジック
// 録音（MediaRecorder + Web Audio）→ ブラウザ内 Whisper 文字起こし（worker.js）
// → 議事録整形（簡易ロジック / 差し替え可能）→ txt / md / docx / メール下書き出力
'use strict';

/* =========================================================
 * 要素の取得
 * =======================================================*/
const $ = (id) => document.getElementById(id);

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

const langSelect     = $('langSelect');
const modelSelect    = $('modelSelect');
const settingsToggle = $('settingsToggle');
const settingsPanel  = $('settingsPanel');

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

/* =========================================================
 * 状態
 * =======================================================*/
const SAMPLE_RATE = 16000;         // Whisper が期待するサンプルレート
const CHUNK_MIN_SEC = 4;           // ライブ文字起こしを走らせる最小の溜まり秒数
const LIVE_INTERVAL_MS = 3000;     // ライブ文字起こしの間隔

let recording = false;
let mediaStream = null;
let mediaRecorder = null;
let recordedBlobs = [];
let audioCtx = null;
let sourceNode = null;
let processorNode = null;
let analyser = null;
let recordedBlob = null;   // 録音した音声（再生・ダウンロード用）
let rafId = null;
let liveTimer = null;
let startTime = 0;
let timerInterval = null;

// 文字起こし用の PCM バッファ
let pendingChunks = [];   // まだワーカーへ送っていない Float32Array 群
let workerBusy = false;
let reqId = 0;
let finalizing = false;
let finalizeResolve = null;

/* =========================================================
 * Web Worker（Whisper）
 * =======================================================*/
const worker = new Worker('./worker.js', { type: 'module' });
let modelReady = false;

worker.onmessage = (e) => {
  const msg = e.data || {};
  switch (msg.type) {
    case 'progress': {
      // モデルファイルのダウンロード進捗
      if (msg.data && typeof msg.data.progress === 'number') {
        setModelLoading(msg.data.progress, msg.data.file);
      }
      break;
    }
    case 'ready': {
      modelReady = true;
      setModelReady();
      break;
    }
    case 'result': {
      workerBusy = false;
      if (msg.text) appendTranscript(msg.text);
      // まだ溜まっていれば続けて処理
      maybeSendChunk(finalizing);
      if (finalizing && pendingChunks.length === 0 && !workerBusy) {
        if (finalizeResolve) { finalizeResolve(); finalizeResolve = null; }
      }
      updateWorkingChip();
      break;
    }
    case 'error': {
      workerBusy = false;
      showError('文字起こしエラー: ' + msg.message);
      if (finalizing && finalizeResolve) { finalizeResolve(); finalizeResolve = null; }
      updateWorkingChip();
      break;
    }
  }
};

function setModelLoading(progress, file) {
  modelReady = false;
  modelStatus.textContent = 'モデル読み込み中…';
  modelStatus.className = 'status-chip loading';
  progressWrap.hidden = false;
  progressBar.style.width = Math.max(2, Math.min(100, progress)).toFixed(0) + '%';
}
function setModelReady() {
  modelStatus.textContent = 'モデル準備完了';
  modelStatus.className = 'status-chip ready';
  progressWrap.hidden = true;
}
function updateWorkingChip() {
  if (!modelReady) return;
  if (workerBusy) {
    modelStatus.textContent = '文字起こし中…';
    modelStatus.className = 'status-chip working';
  } else {
    setModelReady();
  }
}

/** 現在選択中のモデルを読み込む（初回のみダウンロード） */
function ensureModelLoaded() {
  worker.postMessage({ type: 'load', model: modelSelect.value });
}

/* =========================================================
 * 録音
 * =======================================================*/
recordBtn.addEventListener('click', async () => {
  if (recording) {
    await stopRecording();
  } else {
    await startRecording();
  }
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

  // モデルの読み込みを開始（未読み込みなら）
  ensureModelLoaded();

  // --- MediaRecorder（再生用の音声を保持） ---
  recordedBlobs = [];
  try {
    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedBlobs.push(e.data); };
    mediaRecorder.start();
  } catch (_) {
    mediaRecorder = null; // 再生用は無くても録音・文字起こしは続行
  }

  // --- Web Audio（文字起こし用 PCM を 16kHz で取得 + 波形表示） ---
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  sourceNode = audioCtx.createMediaStreamSource(mediaStream);

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  sourceNode.connect(analyser);

  processorNode = audioCtx.createScriptProcessor(4096, 1, 1);
  processorNode.onaudioprocess = (e) => {
    if (!recording) return;
    const input = e.inputBuffer.getChannelData(0);
    pendingChunks.push(new Float32Array(input));
  };
  // フィードバック回避のため gain 0 を経由して destination へ接続
  const silent = audioCtx.createGain();
  silent.gain.value = 0;
  sourceNode.connect(processorNode);
  processorNode.connect(silent);
  silent.connect(audioCtx.destination);

  // 状態更新
  recording = true;
  pendingChunks = [];
  finalizing = false;
  audioWrap.hidden = true;
  recordBtn.classList.add('recording');
  recordBtn.setAttribute('aria-label', '録音停止');
  recHint.textContent = '録音中… タップで停止';

  startTime = Date.now();
  updateTimer();
  timerInterval = setInterval(updateTimer, 250);

  drawWaveform();
  liveTimer = setInterval(() => maybeSendChunk(false), LIVE_INTERVAL_MS);
}

async function stopRecording() {
  recording = false;
  recordBtn.classList.remove('recording');
  recordBtn.setAttribute('aria-label', '録音開始');
  recHint.textContent = '文字起こしを処理中…';

  clearInterval(timerInterval);
  clearInterval(liveTimer);
  liveTimer = null;
  cancelAnimationFrame(rafId);

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    await new Promise((res) => { mediaRecorder.onstop = res; mediaRecorder.stop(); });
    if (recordedBlobs.length) {
      recordedBlob = new Blob(recordedBlobs, { type: recordedBlobs[0].type || 'audio/webm' });
      player.src = URL.createObjectURL(recordedBlob);
      audioSize.textContent = formatBytes(recordedBlob.size);
      audioWrap.hidden = false;
      downloadAudio.disabled = false;
      downloadWav.disabled = false;
    }
  }

  // 残りの音声を最終処理
  finalizing = true;
  await new Promise((resolve) => {
    finalizeResolve = resolve;
    maybeSendChunk(true);
    // 送るものが無ければ即完了
    if (!workerBusy && pendingChunks.length === 0) {
      finalizeResolve = null;
      resolve();
    }
  });
  finalizing = false;
  recHint.textContent = 'タップして録音開始';

  // オーディオ資源の解放
  teardownAudio();
}

function teardownAudio() {
  try { if (processorNode) processorNode.disconnect(); } catch (_) {}
  try { if (sourceNode) sourceNode.disconnect(); } catch (_) {}
  try { if (analyser) analyser.disconnect(); } catch (_) {}
  try { if (audioCtx) audioCtx.close(); } catch (_) {}
  processorNode = sourceNode = analyser = audioCtx = null;
  if (mediaStream) { mediaStream.getTracks().forEach((t) => t.stop()); mediaStream = null; }
}

/* =========================================================
 * ライブ文字起こしのチャンク送信
 * =======================================================*/
function totalSamples(arr) { return arr.reduce((s, a) => s + a.length, 0); }

function drainPending() {
  const len = totalSamples(pendingChunks);
  const out = new Float32Array(len);
  let off = 0;
  for (const a of pendingChunks) { out.set(a, off); off += a.length; }
  pendingChunks = [];
  return out;
}

/**
 * 溜まった音声をワーカーへ送る。
 * force=true（録音停止時）は短くても最後の一片を処理する。
 */
function maybeSendChunk(force) {
  if (workerBusy) return;
  const len = totalSamples(pendingChunks);
  const secs = len / SAMPLE_RATE;
  if (len === 0) return;
  if (!force && secs < CHUNK_MIN_SEC) return;
  if (force && secs < 0.4) { pendingChunks = []; return; } // ほぼ無音は破棄

  const audio = drainPending();
  workerBusy = true;
  updateWorkingChip();
  worker.postMessage(
    { type: 'transcribe', id: ++reqId, audio, model: modelSelect.value, language: langSelect.value },
    [audio.buffer]
  );
}

function appendTranscript(text) {
  const cur = liveTranscript.value.trimEnd();
  liveTranscript.value = cur ? cur + ' ' + text : text;
  liveTranscript.scrollTop = liveTranscript.scrollHeight;
}

clearTranscript.addEventListener('click', () => { liveTranscript.value = ''; });

/* =========================================================
 * タイマー & 波形
 * =======================================================*/
function updateTimer() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  timerEl.textContent = `${m}:${s}`;
}

function drawWaveform() {
  const ctx = waveform.getContext('2d');
  const buf = new Uint8Array(analyser.fftSize);
  const cssColor = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#3b5bdb';

  const render = () => {
    rafId = requestAnimationFrame(render);
    const w = waveform.width, h = waveform.height;
    analyser.getByteTimeDomainData(buf);
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = cssColor;
    ctx.beginPath();
    const slice = w / buf.length;
    let x = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i] / 128.0;
      const y = (v * h) / 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      x += slice;
    }
    ctx.lineTo(w, h / 2);
    ctx.stroke();
  };
  render();
}

/* =========================================================
 * 議事録化（簡易ロジック / スタブ）
 *   本番ではこの generateMinutes をサーバの Claude 呼び出しに差し替える。
 *   入出力の形（transcript → {summary, decisions, todos}）を保てば置き換え可能。
 * =======================================================*/
function generateMinutes(transcript) {
  const text = (transcript || '').replace(/\s+/g, ' ').trim();
  if (!text) return { summary: [], decisions: [], todos: [] };

  // 文単位に分割（。！？改行）
  const sentences = text
    .split(/(?<=[。．！？!?])\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const decisionKw = ['決定', '決めた', '決めま', '決まり', '合意', '承認', '方針', 'することにし', '確定', '採用'];
  const todoKw     = ['ToDo', 'タスク', '対応し', '確認し', '準備', '実施', '送付', '送りま', '連絡', '作成', '提出',
                      'までに', '期限', 'お願いし', 'してくださ', '担当', '進めま', '検討し', 'フォロー', '共有し'];

  const decisions = [];
  const todos = [];
  const rest = [];

  for (const s of sentences) {
    if (decisionKw.some((k) => s.includes(k))) decisions.push(s);
    else if (todoKw.some((k) => s.includes(k))) todos.push(s);
    else rest.push(s);
  }

  // 要点・見出し: 決定/ToDo に振り分けられなかった文から代表を数点
  let summary = rest.slice(0, 5);
  if (summary.length === 0) summary = sentences.slice(0, 3);

  return {
    summary: dedupe(summary),
    decisions: dedupe(decisions),
    todos: dedupe(todos),
  };
}

function dedupe(arr) {
  const seen = new Set();
  return arr.filter((x) => { const k = x.trim(); if (seen.has(k)) return false; seen.add(k); return true; });
}

function toBullets(arr) {
  return arr.map((x) => '・' + x).join('\n');
}
function fromBullets(str) {
  return (str || '').split('\n').map((l) => l.replace(/^[・\-*•]\s*/, '').trim()).filter(Boolean);
}

function fillMinutesUI(m) {
  secSummary.value   = toBullets(m.summary);
  secDecisions.value = toBullets(m.decisions);
  secTodos.value     = toBullets(m.todos);
}

function runGenerate() {
  const src = liveTranscript.value.trim();
  if (!src) { showError('文字起こしが空です。先に録音するか、テキストを入力してください。'); return; }
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

function safeFileName(m) {
  return `${m.name}_${m.date}`.replace(/[\\/:*?"<>|\s]+/g, '_');
}

function buildPlainText(m) {
  const lines = [];
  lines.push(`${m.name}`);
  lines.push(`日付: ${m.date}`);
  lines.push('');
  lines.push('■ 要点・見出し');
  lines.push(m.summary.length ? toBullets(m.summary) : '（なし）');
  lines.push('');
  lines.push('■ 決定事項');
  lines.push(m.decisions.length ? toBullets(m.decisions) : '（なし）');
  lines.push('');
  lines.push('■ ToDo');
  lines.push(m.todos.length ? toBullets(m.todos) : '（なし）');
  return lines.join('\n');
}

function buildMarkdown(m) {
  const sec = (title, arr) => `## ${title}\n\n` + (arr.length ? arr.map((x) => `- ${x}`).join('\n') : '（なし）') + '\n';
  return `# ${m.name}\n\n**日付:** ${m.date}\n\n` +
    sec('要点・見出し', m.summary) + '\n' +
    sec('決定事項', m.decisions) + '\n' +
    sec('ToDo', m.todos);
}

function download(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

exportTxt.addEventListener('click', () => {
  const m = currentMinutes();
  download(`${safeFileName(m)}.txt`, buildPlainText(m), 'text/plain;charset=utf-8');
});

exportMd.addEventListener('click', () => {
  const m = currentMinutes();
  download(`${safeFileName(m)}.md`, buildMarkdown(m), 'text/markdown;charset=utf-8');
});

exportDocx.addEventListener('click', async () => {
  const m = currentMinutes();
  if (!window.docx) { showError('Word 出力ライブラリの読み込みに失敗しました（オンライン環境で再読み込みしてください）。'); return; }
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = window.docx;

  const bulletParas = (arr) => arr.length
    ? arr.map((t) => new Paragraph({ text: t, bullet: { level: 0 } }))
    : [new Paragraph({ children: [new TextRun({ text: '（なし）', italics: true })] })];

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: m.name, heading: HeadingLevel.TITLE }),
        new Paragraph({ children: [new TextRun({ text: `日付: ${m.date}`, bold: true })] }),
        new Paragraph({ text: '要点・見出し', heading: HeadingLevel.HEADING_1 }),
        ...bulletParas(m.summary),
        new Paragraph({ text: '決定事項', heading: HeadingLevel.HEADING_1 }),
        ...bulletParas(m.decisions),
        new Paragraph({ text: 'ToDo', heading: HeadingLevel.HEADING_1 }),
        ...bulletParas(m.todos),
      ],
    }],
  });

  try {
    const blob = await Packer.toBlob(doc);
    download(`${safeFileName(m)}.docx`, blob, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  } catch (err) {
    showError('Word 出力に失敗しました: ' + (err && err.message ? err.message : err));
  }
});

exportMail.addEventListener('click', () => {
  const m = currentMinutes();
  const subject = `【議事録】${m.name}（${m.date}）`;
  const body = buildPlainText(m);
  // mailto は本文長に制限があるため長すぎる場合は切り詰める
  const MAX = 1800;
  const trimmed = body.length > MAX ? body.slice(0, MAX) + '\n…（以下省略。txt/Word をご利用ください）' : body;
  const href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(trimmed)}`;
  window.location.href = href;
});

/* =========================================================
 * 音声ファイルの出力（ネイティブ形式 / WAV 変換）
 * =======================================================*/
function formatBytes(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
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

// 録音した音声をそのままの形式でダウンロード
downloadAudio.addEventListener('click', () => {
  if (!recordedBlob) { showError('保存できる音声がありません。先に録音してください。'); return; }
  hideError();
  const m = currentMinutes();
  const ext = extFromMime(recordedBlob.type);
  download(`${safeFileName(m)}.${ext}`, recordedBlob, recordedBlob.type || 'audio/webm');
});

// 録音した音声を WAV に変換してダウンロード（互換性の高い形式）
downloadWav.addEventListener('click', async () => {
  if (!recordedBlob) { showError('変換できる音声がありません。先に録音してください。'); return; }
  hideError();
  const original = downloadWav.textContent;
  downloadWav.disabled = true;
  downloadWav.textContent = '変換中…';
  try {
    const arrayBuffer = await recordedBlob.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const wavBlob = audioBufferToWav(audioBuffer);
    ctx.close();
    const m = currentMinutes();
    download(`${safeFileName(m)}.wav`, wavBlob, 'audio/wav');
  } catch (err) {
    showError('WAV への変換に失敗しました: ' + (err && err.message ? err.message : err));
  } finally {
    downloadWav.disabled = false;
    downloadWav.innerHTML = '<span aria-hidden="true">🎵</span> WAVに変換';
  }
});

// AudioBuffer → WAV(16bit PCM) Blob
function audioBufferToWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const channels = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));

  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = frames * blockAlign;
  const arr = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arr);

  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);        // PCM chunk size
  view.setUint16(20, 1, true);         // format = PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);        // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      let s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

/* =========================================================
 * 過去の議事録一覧（localStorage）
 * =======================================================*/
const STORE_KEY = 'noteloop_minutes_v1';

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
  catch (_) { return []; }
}
function saveStore(list) {
  localStorage.setItem(STORE_KEY, JSON.stringify(list));
}

function seedIfEmpty() {
  let list = loadStore();
  if (list.length === 0) {
    list = [
      {
        id: 'seed-1', name: '週次定例MTG', date: '2026-07-14',
        summary: ['来月のリリース計画について協議した'],
        decisions: ['リリースを1週間延期することを決定', 'QA体制を再確認する方針で合意'],
        todos: ['テスト計画を更新する（担当: 田中）', 'QA体制の調整を進める（担当: 佐藤）', '関係者へ共有する（担当: 鈴木）'],
        _sample: true,
      },
      {
        id: 'seed-2', name: '開発キックオフ', date: '2026-07-11',
        summary: ['新規プロジェクトの体制とスケジュールを確認した'],
        decisions: ['開発は2週間スプリントで進めることを決定'],
        todos: ['環境構築を今週中に実施する', '要件一覧を作成して共有する'],
        _sample: true,
      },
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
    li.innerHTML = `
      <h3></h3>
      <span class="meta"></span>
      <span class="excerpt"></span>
      <div class="history-actions">
        <button class="open" type="button">開く</button>
        <button class="del" type="button">削除</button>
      </div>`;
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
  fillMinutesUI({
    summary: item.summary || [],
    decisions: item.decisions || [],
    todos: item.todos || [],
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deleteMinutes(id) {
  const list = loadStore().filter((x) => x.id !== id);
  saveStore(list);
  renderHistory();
}

saveMinutes.addEventListener('click', () => {
  const m = currentMinutes();
  if (!m.summary.length && !m.decisions.length && !m.todos.length) {
    showError('保存する議事録が空です。先に生成してください。');
    return;
  }
  hideError();
  const list = loadStore();
  const id = 'm-' + Date.now() + '-' + Math.floor(performance.now());
  list.push({ id, name: m.name, date: m.date, summary: m.summary, decisions: m.decisions, todos: m.todos });
  saveStore(list);
  renderHistory();
});

/* =========================================================
 * 設定・エラー・初期化
 * =======================================================*/
settingsToggle.addEventListener('click', () => {
  const open = settingsPanel.hidden;
  settingsPanel.hidden = !open;
  settingsToggle.setAttribute('aria-expanded', String(open));
});

// モデルを切り替えたら再読み込みできるようフラグをリセット
modelSelect.addEventListener('change', () => {
  modelReady = false;
  modelStatus.textContent = 'モデル未読み込み';
  modelStatus.className = 'status-chip';
});

function showError(msg) { errorBox.textContent = msg; errorBox.hidden = false; }
function hideError() { errorBox.hidden = true; errorBox.textContent = ''; }

// 初期化
meetingDate.value = todayStr();
downloadAudio.disabled = true;
downloadWav.disabled = true;
seedIfEmpty();
