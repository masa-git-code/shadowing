// Claude 用：YouTube の「文字起こしを表示」から貼られた文字を、時刻つきの断片に分ける。
// 例: "0:05\nHello everyone\n0:08\nthanks for..." → [{start:5, text:"Hello everyone"}, ...]
// 使い方: node tools/parse-transcript.mjs pasted.txt > segments.json
import fs from 'node:fs';
const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const toSec = t => t.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
const segs = [];
const re = /^(\d{1,2}:)?\d{1,2}:\d{2}$/;
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^((?:\d{1,2}:)?\d{1,2}:\d{2})\s*(.*)$/);
  if (m && (re.test(m[1]))) {
    const text = m[2] || '';
    segs.push({ start: toSec(m[1]), text });
  } else if (segs.length) segs.at(-1).text = (segs.at(-1).text + ' ' + lines[i]).trim();
}
for (let i = 0; i < segs.length; i++) segs[i].end = segs[i + 1]?.start ?? segs[i].start + 4;
console.log(JSON.stringify(segs.filter(s => s.text), null, 1));
