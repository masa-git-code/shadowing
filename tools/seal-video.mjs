// Claude 用：練習データ（平文のJSON）を暗号化して data/videos/ に置く。
// 使い方: SHADOWING_PASSWORD=... node tools/seal-video.mjs work/video.json
import fs from 'node:fs';
import path from 'node:path';
import { DATA, loadMeta, seal, writeJSON, fileIdFor } from './lib/crypto.mjs';

const src = process.argv[2];
const d = JSON.parse(fs.readFileSync(src, 'utf8'));
for (const k of ['youtubeId', 'menu', 'title', 'sentences', 'chapters']) if (!d[k]) throw new Error(`${k} がありません`);
// 形式を確かめる（間違いがあるとアプリで正しく再生できない）
const n = d.sentences.length, bad = [];
if (!['ted', 'chloe'].includes(d.menu)) bad.push('menu は "ted" か "chloe"');
if (!n || !d.chapters.length) bad.push('sentences と chapters が空です');
d.sentences.forEach((s, i) => {
  if (typeof s.start !== 'number' || typeof s.end !== 'number' || !(s.end > s.start)) bad.push(`sentences[${i}]: start < end の数字にしてください`);
  if (!s.en || !s.ja) bad.push(`sentences[${i}]: en と ja が必要です`);
});
d.chapters.forEach((c, i) => {
  if (!Number.isInteger(c.from) || !Number.isInteger(c.to) || c.from < 0 || c.from > c.to || c.to >= n) bad.push(`chapters[${i}]: from/to は 0〜${n - 1} の整数で from ≦ to`);
});
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
// WPM を計算（チャプターごとと全体）
const words = s => s.en.trim().split(/\s+/).filter(Boolean).length;
for (const c of d.chapters) {
  const ss = d.sentences.slice(c.from, c.to + 1);
  const dur = (ss.at(-1).end - ss[0].start) / 60;
  c.start = ss[0].start; c.end = ss.at(-1).end;
  c.wpm = dur > 0 ? Math.round(ss.reduce((n, s) => n + words(s), 0) / dur) : null;
}
const total = d.sentences.reduce((n, s) => n + words(s), 0);
d.durationSec = Math.round(d.sentences.at(-1).end - d.sentences[0].start);
d.wpm = Math.round(total / (d.durationSec / 60));
const { meta, key } = await loadMeta();
const id = await fileIdFor(d.youtubeId, meta.salt);
writeJSON(path.join(DATA, 'videos', id + '.enc.json'), await seal(key, d));
console.log(`data/videos/${id}.enc.json を作成（${d.sentences.length}文、${d.chapters.length}チャプター、${d.wpm} WPM）`);
