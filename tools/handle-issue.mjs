// アプリから送られた依頼（GitHub Issue）を処理する。
// 本文は暗号化されているので、パスワードを知らない人の依頼は無視される。
// 種類: request（準備を依頼）, add（URLで動画を追加）, transcript（文字起こしを送る）, subscribe（通知の登録）
import fs from 'node:fs';
import path from 'node:path';
import { loadMeta, readSealed, writeSealed, open, fileIdFor, menuOf, DATA } from './lib/crypto.mjs';

const ev = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const body = ev.issue?.body || '';
const out = (k, v) => fs.appendFileSync(process.env.GITHUB_OUTPUT || '/dev/null', `${k}=${v}\n`);

async function main() {
  if (!body.trim()) { out('result', 'empty'); return; }
  const m = body.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || body.match(/(\{"v":1[\s\S]*\})/);
  if (!m) { out('result', 'invalid'); return; }
  const { meta, key } = await loadMeta();
  let msg;
  try { msg = await open(key, JSON.parse(m[1])); } catch { out('result', 'invalid'); return; }
  const now = new Date().toISOString();

  if (msg.type === 'subscribe') {
    if (!msg.subscription?.endpoint) { out('result', 'invalid'); return; }
    await writeSealed(key, 'push.enc.json', { subscription: msg.subscription, at: now });
    out('result', 'subscribed'); return;
  }
  const cat = await readSealed(key, 'catalog.enc.json', { v: 1, videos: [] });
  const validId = /^[\w-]{11}$/.test(msg.youtubeId || '');
  const find = () => cat.videos.find(x => x.youtubeId === msg.youtubeId);
  // 一覧にない動画は先頭に入れる（一覧から消えた動画の依頼も受け付ける）
  // タイトルとチャンネル名はすぐ一覧に出したいので、ここで YouTube に問い合わせる（失敗しても週1回の更新で入る）
  const insert = async status => {
    const v = { youtubeId: msg.youtubeId, menu: menuOf(msg.menu), title: msg.title || '', status, addedBy: 'user', addedAt: now };
    if (status === 'requested') v.requestedAt = now;
    try {
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + msg.youtubeId)}`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) { const o = await r.json(); v.title ||= o.title; v.channel = o.author_name; v.embeddable = true; v.checkedAt = now; }
    } catch {}
    cat.videos.unshift(v);
    return v;
  };
  const markRequested = v => { if (v.status !== 'ready') { v.status = 'requested'; v.requestedAt = now; } };

  if (msg.type === 'request') {
    if (!validId) { out('result', 'notfound'); return; }
    const v = find();
    if (!v) await insert('requested'); else markRequested(v);
  } else if (msg.type === 'add') {
    if (!validId) { out('result', 'invalid'); return; }
    const v = find();
    if (!v) await insert(msg.request ? 'requested' : 'pending');
    else { v.addedBy ||= 'user'; if (msg.request) markRequested(v); }
  } else if (msg.type === 'transcript') {
    let text = String(msg.text || '').trim();
    if (!validId || !text) { out('result', 'invalid'); return; }
    const fid = await fileIdFor(msg.youtubeId, meta.salt);
    // 長い文字起こしは何回かに分けて届く（sid が同じ part 1..parts）。全部そろったらつなげる
    const parts = Number(msg.parts) || 1;
    if (parts > 1) {
      const part = Number(msg.part);
      if (!(part >= 1 && part <= parts) || !/^[0-9a-f]{6,32}$/.test(msg.sid || '')) { out('result', 'invalid'); return; }
      const pname = `transcripts/${fid}.parts.enc.json`;
      let p = await readSealed(key, pname, null);
      if (!p || p.sid !== msg.sid || p.parts !== parts) p = { sid: msg.sid, parts, got: {} };
      p.got[part] = String(msg.text || '');
      const have = Object.keys(p.got).length;
      if (have < parts) {
        await writeSealed(key, pname, p);
        // 一覧にも「何回目まで届いたか」を残す（アプリが「残りを送ってください」と出す。朝の準備でも分かる）
        let v = find();
        if (!v) v = await insert('pending');
        v.addedBy ||= 'user'; v.transcriptParts = `${have}/${parts}`; v.transcriptPartsAt = now;
        await writeSealed(key, 'catalog.enc.json', cat);
        out('result', 'transcriptpart'); out('detail', `${have}/${parts}`); return;
      }
      text = Array.from({ length: parts }, (_, i) => p.got[i + 1]).join('\n').trim();
      fs.rmSync(path.join(DATA, pname), { force: true });
    }
    if (text.length < 20) { out('result', 'invalid'); return; }
    // 文字起こしは動画ごとに1つ。送り直したら上書きする
    await writeSealed(key, `transcripts/${fid}.enc.json`, { youtubeId: msg.youtubeId, menu: menuOf(msg.menu), title: msg.title || '', text, at: now });
    let v = find();
    if (!v) v = await insert('requested'); else { v.addedBy ||= 'user'; markRequested(v); }
    v.transcript = fid; v.transcriptAt = now;
    delete v.transcriptParts; delete v.transcriptPartsAt;
  } else { out('result', 'invalid'); return; }
  await writeSealed(key, 'catalog.enc.json', cat);
  out('result', msg.type);
}
main().catch(e => { console.error(e.message); out('result', 'error'); process.exitCode = 1; });
