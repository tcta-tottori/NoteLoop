// app.js の APP_VERSION を唯一の版数として、Android の versionName / versionCode に反映する。
// アプリ内更新は versionCode の大小で新旧を判断するため、ここがずれると更新を検知できない。
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const appJs = await readFile(join(root, 'app.js'), 'utf8');
const m = appJs.match(/APP_VERSION = 'Ver\.([0-9]+)\.([0-9]+)'/);
if (!m) throw new Error('app.js から APP_VERSION を読み取れませんでした');

const [, major, minor] = m;
const versionName = `${major}.${minor}`;
// 5.8 → 50800。将来パッチ版を足せるよう下2桁を空けておく。
const versionCode = Number(major) * 10000 + Number(minor) * 100;

const gradlePath = join(root, 'android/app/build.gradle');
let gradle = await readFile(gradlePath, 'utf8');
gradle = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`);
await writeFile(gradlePath, gradle);

// 更新確認用。Release に添付して、アプリから参照する。
const info = {
  version: versionName,
  versionCode,
  apk: 'https://github.com/tcta-tottori/NoteLoop/releases/latest/download/NOTELOOP.apk',
};
await writeFile(join(root, 'version.json'), JSON.stringify(info, null, 2) + '\n');

console.log(`versionName=${versionName} versionCode=${versionCode}`);
