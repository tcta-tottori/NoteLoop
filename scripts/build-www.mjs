// Web アプリ一式を www/ へ集める。
// Capacitor は webDir 配下だけを APK に取り込むため、配信用ファイルをここへ複製する。
// リポジトリのルートは GitHub Pages の配信元でもあるので、構成は変えずにコピーで済ませる。
import { cp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'www');

const FILES = ['index.html', 'app.js', 'styles.css', 'worker.js', 'manifest.webmanifest'];
const DIRS = ['icons'];

await rm(www, { recursive: true, force: true });
await mkdir(www, { recursive: true });

for (const f of FILES) {
  if (existsSync(join(root, f))) await cp(join(root, f), join(www, f));
}
for (const d of DIRS) {
  if (existsSync(join(root, d))) await cp(join(root, d), join(www, d), { recursive: true });
}

// Service Worker はネイティブアプリでは不要（アセットは APK に同梱済みで、
// capacitor:// 配信下では更新検出も働かない）。登録ごと無効化する。
const swPath = join(www, 'sw.js');
await writeFile(swPath, '// ネイティブアプリでは Service Worker を使わない\n');

// index.html 内の SW 登録を打ち消すフラグを埋め込む
let html = await readFile(join(www, 'index.html'), 'utf8');
html = html.replace('<head>', '<head>\n  <script>window.NOTELOOP_NATIVE_BUILD = true;</script>');
await writeFile(join(www, 'index.html'), html);

console.log('www/ を作成しました');
