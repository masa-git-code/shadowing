// Claude 用：YouTube の「文字起こしを表示」から貼られた文字を、時刻つきの断片に分ける。
// 例: "0:05\nHello everyone\n0:08\nthanks for..." → [{start:5, text:"Hello everyone"}, ...]
// 画面の文字（「4 seconds」「Sync to video time」など）は捨てる。チャプター見出しが文に混ざることがあるので、断片を見て直す。
// 使い方: node tools/parse-transcript.mjs pasted.txt > segments.json
import fs from 'node:fs';
const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const toSec = t => t.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
const timeRe = /^((?:\d{1,2}:)?\d{1,2}:\d{2})\s*(.*)$/;
const junk = /^(Sync to video time|Transcript|Search in video|Show transcript|文字起こし|動画の時間に同期)$|^(\d+ (hours?|minutes?|seconds?),? ?)+$|^(\d+\s*(時間|分|秒)\s*)+$|^(チャプター|Chapter) \d+[:：]/i;
// 新しい YouTube の画面では時刻のすぐ後ろに読み上げ用の長さ（「1 分 4 秒」「1 minute, 4 seconds」）がつく
const spoken = /^(\d+\s*(時間|分|秒)\s*)+|^(\d+ (hours?|minutes?|seconds?),? ?)+/i;
const decode = t => t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
if (lines.some(l => /-->/.test(l))) { console.error('VTT/SRT 形式です。YouTube の「文字起こしを表示」からコピーした文字を使ってください'); process.exit(1); }
const segs = [];
// 次の時刻の行（本文ではなさそうなもの）の秒数
const nextTime = i => { for (let j = i + 1; j < lines.length; j++) { const m = !junk.test(lines[j]) && lines[j].match(timeRe); if (m) return toSec(m[1]); } return null; };
for (const [i, l] of lines.entries()) {
  if (junk.test(l)) continue;
  const m = l.match(timeRe);
  // 時刻が前に戻る行や、急に先へ飛んで次の時刻でまた戻る行（「2:30 in the morning」のような本文）は前の断片の続きとして扱う
  const prev = segs.at(-1)?.start;
  const asText = m && segs.length && (toSec(m[1]) < prev || (toSec(m[1]) > prev + 60 && (nextTime(i) ?? Infinity) <= prev + 60));
  if (asText) { segs.at(-1).text = (segs.at(-1).text + ' ' + decode(l)).trim(); continue; }
  if (m) segs.push({ start: toSec(m[1]), text: decode((m[2] || '').replace(spoken, '')).trim() });
  else if (segs.length) segs.at(-1).text = (segs.at(-1).text + ' ' + decode(l)).trim();
}
for (let i = 0; i < segs.length; i++) segs[i].end = segs[i + 1]?.start ?? segs[i].start + 4;
console.log(JSON.stringify(segs.filter(s => s.text), null, 1));
