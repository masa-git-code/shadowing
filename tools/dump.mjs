// Claude 用：暗号化したファイルの中身を表示する。
// 使い方: node tools/dump.mjs catalog.enc.json  /  node tools/dump.mjs requested
//         node tools/dump.mjs transcript <YouTubeのID>   … アプリから送られた文字起こし（平文）を表示
import { loadMeta, readSealed, fileIdFor } from './lib/crypto.mjs';
const { meta, key } = await loadMeta();
const arg = process.argv[2] || 'catalog.enc.json';
if (arg === 'requested') {
  const c = await readSealed(key, 'catalog.enc.json', { videos: [] });
  console.log(JSON.stringify(c.videos.filter(v => v.status === 'requested'), null, 1));
} else if (arg === 'transcript') {
  const id = process.argv[3];
  const t = await readSealed(key, `transcripts/${await fileIdFor(id, meta.salt)}.enc.json`, null);
  if (!t) { console.error('文字起こしがありません: ' + id); process.exit(1); }
  console.log(t.text);
} else console.log(JSON.stringify(await readSealed(key, arg, null), null, 1));
