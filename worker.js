// worker.js — ブラウザ内 Whisper 文字起こし (Transformers.js v3 / WebGPU 対応)
// 音声はすべてこの Web Worker 内で処理され、外部 API へは送信されません。

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

// リモートモデルのみ利用（ローカルファイル探索を無効化）
env.allowLocalModels = false;

// モデル×バックエンドごとにパイプラインをキャッシュ
// （ライブ用 tiny/WebGPU と 高精度用 turbo/WebGPU を同時保持できる）
const cache = new Map();
const keyFor = (model, device) => `${device}::${model}`;

/**
 * バックエンドごとの量子化(dtype)を選ぶ。
 * - WebGPU: デコーダを q8 にすると文字化けする既知バグ (transformers.js #1317) を避けるため、
 *   エンコーダ fp32 ＋ デコーダ q4 のハイブリッド量子化を使う（公式 turbo WebGPU デモと同構成）。
 * - WASM(CPU): q8 で十分・軽量（このバグは WebGPU 限定）。
 */
function dtypeFor(device) {
  if (device === 'webgpu') return { encoder_model: 'fp32', decoder_model_merged: 'q4' };
  return 'q8';
}

/**
 * パイプラインを取得（無ければ生成）。
 * WebGPU で生成に失敗した場合は WASM へ自動フォールバックし、実際に使うバックエンドを返す。
 */
async function loadPipeline(model, device, onProgress) {
  const key = keyFor(model, device);
  if (!cache.has(key)) {
    const promise = pipeline('automatic-speech-recognition', model, {
      device,
      dtype: dtypeFor(device),
      progress_callback: onProgress,
    });
    cache.set(key, promise); // Promise をキャッシュ（二重ロード防止）
  }
  try {
    const pipe = await cache.get(key);
    return { pipe, device };
  } catch (err) {
    cache.delete(key); // 失敗はキャッシュしない（次回リトライ可能に）
    if (device === 'webgpu') {
      // WebGPU が使えない/初期化に失敗 → WASM へ自動フォールバック
      self.postMessage({
        type: 'fallback', from: 'webgpu', to: 'wasm',
        message: String(err && err.message ? err.message : err),
      });
      return loadPipeline(model, 'wasm', onProgress);
    }
    throw err;
  }
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  const device = msg.device === 'webgpu' ? 'webgpu' : 'wasm';
  const onProgress = (p) => self.postMessage({ type: 'progress', data: p });

  if (msg.type === 'load') {
    try {
      const { device: used } = await loadPipeline(msg.model, device, onProgress);
      self.postMessage({ type: 'ready', model: msg.model, device: used });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
    }
    return;
  }

  if (msg.type === 'transcribe') {
    try {
      const { pipe, device: used } = await loadPipeline(msg.model, device, onProgress);
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

      const output = await pipe(msg.audio, options);
      const text = (output && output.text ? output.text : '').trim();
      self.postMessage({ type: 'result', id: msg.id, mode: msg.mode, text, device: used });
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, mode: msg.mode, message: String(err && err.message ? err.message : err) });
    }
  }
};
