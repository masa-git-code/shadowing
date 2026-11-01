// Claude 用：YouTube の「文字起こしを表示」から貼られた文字を、時刻つきの断片に分ける。
// 例: "0:05\nHello everyone\n0:08\nthanks for..." → [{start:5, text:"Hello everyone"}, ...]
// 画面の文字（「4 seconds」「Sync to video time」など）は捨てる。チャプター見出しが文に混ざることがあるので、断片を見て直す。
// 使い方: node tools/parse-transcript.mjs pasted.txt > segments.json
import fs from 'node:fs';
const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const toSec = t => t.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
const timeRe = /^((?:\d{1,2}:)?\d{1,2}:\d{2})\s*(.*)$/;
const junk = /^(Sync to video time|Transcript|Search in video|Show transcript)$|^(\d+ (hours?|minutes?|seconds?),? ?)+$/i;
const segs = [];
for (const l of lines) {
  if (junk.test(l)) continue;
  const m = l.match(timeRe);
  if (m) segs.push({ start: toSec(m[1]), text: m[2] || '' });
  else if (segs.length) segs.at(-1).text = (segs.at(-1).text + ' ' + l).trim();
}
for (let i = 0; i < segs.length; i++) segs[i].end = segs[i + 1]?.start ?? segs[i].start + 4;
console.log(JSON.stringify(segs.filter(s => s.text), null, 1));
