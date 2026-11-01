// アプリから送られた依頼（GitHub Issue）を処理する。
// 本文は暗号化されているので、パスワードを知らない人の依頼は無視される。
// 種類: request（準備を依頼）, add（URLで動画を追加）, subscribe（通知の登録）
import fs from 'node:fs';
import { loadMeta, readSealed, writeSealed, open } from './lib/crypto.mjs';

const ev = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const body = ev.issue?.body || '';
const out = (k, v) => fs.appendFileSync(process.env.GITHUB_OUTPUT || '/dev/null', `${k}=${v}\n`);

async function main() {
  const m = body.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || body.match(/(\{"v":1[\s\S]*\})/);
  if (!m) { out('result', 'invalid'); return; }
  const { key } = await loadMeta();
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
  if (msg.type === 'request') {
    const v = cat.videos.find(x => x.youtubeId === msg.youtubeId);
    if (!v) {
      // 一覧から消えた動画でも、依頼は受け付ける
      if (!validId) { out('result', 'notfound'); return; }
      cat.videos.unshift({ youtubeId: msg.youtubeId, menu: msg.menu === 'ted' ? 'ted' : 'chloe', title: '', status: 'requested', addedBy: 'user', addedAt: now, requestedAt: now });
    } else if (v.status !== 'ready') { v.status = 'requested'; v.requestedAt = now; }
  } else if (msg.type === 'add') {
    if (!validId) { out('result', 'invalid'); return; }
    const v = cat.videos.find(x => x.youtubeId === msg.youtubeId);
    if (!v) {
      cat.videos.unshift({ youtubeId: msg.youtubeId, menu: msg.menu === 'ted' ? 'ted' : 'chloe', title: '', status: msg.request ? 'requested' : 'pending', addedBy: 'user', addedAt: now, requestedAt: msg.request ? now : undefined });
    } else {
      v.addedBy ||= 'user';
      if (msg.request && v.status !== 'ready') { v.status = 'requested'; v.requestedAt = now; }
    }
  } else { out('result', 'invalid'); return; }
  await writeSealed(key, 'catalog.enc.json', cat);
  out('result', msg.type);
}
main().catch(e => { console.error(e.message); out('result', 'error'); process.exitCode = 1; });
