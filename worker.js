// worker.js — ブラウザ内 Whisper 文字起こし (Transformers.js)
// 音声はすべてこの Web Worker 内で処理され、外部 API へは送信されません。

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// リモートモデルのみ利用（ローカルファイル探索を無効化）
env.allowLocalModels = false;

let transcriber = null;
let loadedModel = null;

/**
 * モデルを（必要なら）読み込み、パイプラインを返す。
 * 同じモデルなら再利用する。
 */
async function getTranscriber(model, onProgress) {
  if (transcriber && loadedModel === model) return transcriber;
  loadedModel = model;
  transcriber = await pipeline('automatic-speech-recognition', model, {
    progress_callback: onProgress,
  });
  return transcriber;
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
        chunk_length_s: 30,
        stride_length_s: 5,
      };
      // 'auto' の場合は language を指定せず自動判定させる
      if (msg.language && msg.language !== 'auto') {
        options.language = msg.language;
      }
      const output = await t(msg.audio, options);
      const text = (output && output.text ? output.text : '').trim();
      self.postMessage({ type: 'result', id: msg.id, text });
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, message: String(err && err.message ? err.message : err) });
    }
  }
};
