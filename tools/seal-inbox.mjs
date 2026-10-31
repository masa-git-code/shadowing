// Claude 用：単語帳に入れる表現（Teamsの表現など）を data/inbox.enc.json に追加する。
// アプリは開いた時に新しいパックを単語帳に取り込む。
// 使い方: node tools/seal-inbox.mjs work/pack.json   （中身: {"items":[{phrase, meaning, example, exampleJa, tip}]}）
import fs from 'node:fs';
import { loadMeta, readSealed, writeSealed, randomB64 } from './lib/crypto.mjs';
const pack = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { key } = await loadMeta();
const inbox = await readSealed(key, 'inbox.enc.json', { packs: [] });
inbox.packs.push({ id: randomB64(9).replace(/[+/=]/g, ''), createdAt: new Date().toISOString(), items: pack.items });
await writeSealed(key, 'inbox.enc.json', inbox);
console.log(`${pack.items.length}個の表現を追加しました`);
