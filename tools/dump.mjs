// Claude 用：暗号化したファイルの中身を表示する。
// 使い方: node tools/dump.mjs catalog.enc.json  /  node tools/dump.mjs requested
import { loadMeta, readSealed } from './lib/crypto.mjs';
const { key } = await loadMeta();
const arg = process.argv[2] || 'catalog.enc.json';
if (arg === 'requested') {
  const c = await readSealed(key, 'catalog.enc.json', { videos: [] });
  console.log(JSON.stringify(c.videos.filter(v => v.status === 'requested'), null, 1));
} else console.log(JSON.stringify(await readSealed(key, arg, null), null, 1));
