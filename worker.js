// worker.js — ブラウザ内 Whisper 文字起こし (Transformers.js)
// 音声はすべてこの Web Worker 内で処理され、外部 API へは送信されません。

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// リモートモデルのみ利用（ローカルファイル探索を無効化）
env.allowLocalModels = false;

// モデルごとにパイプラインをキャッシュ（ライブ用 tiny と 高精度用 small を同時保持できる）
const cache = new Map();

function getTranscriber(model, onProgress) {
  if (!cache.has(model)) {
    const p = pipeline('automatic-speech-recognition', model, { progress_callback: onProgress });
    cache.set(model, p); // Promise をキャッシュ（二重ロード防止）
  }
  return cache.get(model);
}

self.onmessage = async (event) => {
  const msg = event.data || {};

  if (msg.type === 'load') {
    try {
      await getTranscriber(msg.model, (p) => self.postMessage({ type: 'progress', data: p }));
      self.postMessage({ type: 'ready', model: msg.model });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
    }
    return;
  }

  if (msg.type === 'transcribe') {
    try {
      const t = await getTranscriber(msg.model, (p) => self.postMessage({ type: 'progress', data: p }));
      const options = {
        task: 'transcribe',
        // 反復（「このように…」の暴走）を抑制する
        no_repeat_ngram_size: 3,
        repetition_penalty: 1.15,
      };
      if (msg.language && msg.language !== 'auto') options.language = msg.language;

      // 30 秒を超える音声だけチャンク分割＋オーバーラップで文脈を保つ。
      // 短い音声はチャンク/タイムスタンプを使わない方が安定する。
      const durationSec = (msg.audio && msg.audio.length ? msg.audio.length : 0) / 16000;
      if (msg.longform && durationSec > 28) {
        options.chunk_length_s = 30;
        options.stride_length_s = 5;
        options.return_timestamps = true;
      }

      const output = await t(msg.audio, options);
      const text = (output && output.text ? output.text : '').trim();
      self.postMessage({ type: 'result', id: msg.id, mode: msg.mode, text });
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, mode: msg.mode, message: String(err && err.message ? err.message : err) });
    }
  }
};
