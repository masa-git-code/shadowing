// 動画一覧（data/catalog.enc.json）を更新する。GitHub Actions から毎週実行。
// 1. 初回は meta.json（暗号の設定）と通知用の鍵を作る
// 2. チャンネルの新着（RSS）を集める
// 3. 埋め込み再生できるか確かめる
// 4. data/videos/ にある練習データを一覧に反映する
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DATA, loadMeta, readSealed, writeSealed, readJSON, writeJSON, open, fileIdFor } from './lib/crypto.mjs';

const UA = { 'User-Agent': 'Mozilla/5.0 (shadowing-app catalog bot)', 'Accept-Language': 'en' };
const log = (...a) => console.log(...a);

async function get(url) {
  const r = await fetch(url, { headers: UA });
  return { status: r.status, text: r.ok ? await r.text() : '' };
}

async function oembed(id) {
  const r = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`);
  if (r.status === 200) return { ok: true, ...JSON.parse(r.text) };
  return { ok: false, status: r.status };
}

async function resolveChannelId(ch, cache) {
  if (ch.channelId) return ch.channelId;
  const k = ch.url || ('video:' + ch.fromVideo);
  if (cache[k]) return cache[k];
  let url = ch.url;
  if (!url && ch.fromVideo) {
    const o = await oembed(ch.fromVideo);
    url = o.author_url;
  }
  if (!url) return null;
  const r = await get(url);
  const m = r.text.match(/"(?:channelId|externalId)":"(UC[\w-]{22})"/) || r.text.match(/channel\/(UC[\w-]{22})/);
  if (m) cache[k] = m[1];
  return m ? m[1] : null;
}

function parseFeed(xml) {
  const out = [];
  for (const e of xml.split('<entry>').slice(1)) {
    const id = (e.match(/<yt:videoId>([^<]+)</) || [])[1];
    const title = (e.match(/<title>([^<]*)</) || [])[1] || '';
    const published = (e.match(/<published>([^<]+)</) || [])[1];
    if (id) out.push({ id, title: decode(title), published });
  }
  return out;
}
const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

async function ensureVapid(key) {
  const p = path.join(DATA, 'vapid.enc.json');
  if (fs.existsSync(p)) return;
  const webpush = (await import('web-push')).default;
  const keys = webpush.generateVAPIDKeys();
  await writeSealed(key, 'vapid.enc.json', keys);
  const meta = readJSON(path.join(DATA, 'meta.json'));
  meta.vapidPublicKey = keys.publicKey;
  writeJSON(path.join(DATA, 'meta.json'), meta);
  log('通知用の鍵を作成しました');
}

async function main() {
  const { meta, key, created } = await loadMeta({ create: true });
  if (created) log('data/meta.json を作成しました');
  await ensureVapid(key);

  const sources = readJSON(path.join(ROOT, 'config/sources.json'));
  const seed = readJSON(path.join(ROOT, 'config/seed.json'), { videos: [] });
  const cat = await readSealed(key, 'catalog.enc.json', { v: 1, videos: [], channelCache: {} });
  cat.channelCache ||= {};
  const byId = new Map(cat.videos.map(v => [v.youtubeId, v]));
  const now = new Date().toISOString();

  const add = (v) => {
    if (byId.has(v.youtubeId)) return;
    const e = { status: 'pending', addedAt: now, ...v };
    byId.set(v.youtubeId, e); cat.videos.push(e);
    log('追加:', v.menu, v.title || v.youtubeId);
  };

  // 最初から入れておく動画
  for (const s of seed.videos || []) add({ youtubeId: s.youtubeId, menu: s.menu, title: s.title || '', tedUrl: s.tedUrl });

  // チャンネルの新着
  for (const ch of sources.channels) {
    try {
      const cid = await resolveChannelId(ch, cat.channelCache);
      if (!cid) { log('チャンネルが見つかりません:', ch.name); continue; }
      const r = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${cid}`);
      if (r.status !== 200) { log('RSS取得失敗:', ch.name, r.status); continue; }
      for (const it of parseFeed(r.text)) {
        if (ch.filter && !it.title.toLowerCase().includes(ch.filter.toLowerCase())) continue;
        if (/#shorts/i.test(it.title)) continue;
        add({ youtubeId: it.id, menu: ch.menu, title: it.title, channel: ch.name, publishedAt: it.published });
      }
    } catch (e) { log('エラー:', ch.name, e.message); }
  }

  // 埋め込み再生できるか、タイトルとチャンネル名
  for (const v of cat.videos) {
    if (v.checkedAt) continue;
    let o;
    try { o = await oembed(v.youtubeId); } catch (e) { log('確認できませんでした:', v.youtubeId, e.message); continue; }
    if (o.ok) { v.title ||= o.title; v.channel ||= o.author_name; v.embeddable = true; }
    else if ([401, 403, 404].includes(o.status)) { v.embeddable = false; v.checkError = o.status; log('再生できない動画:', v.youtubeId, o.status); }
    else { log('確認できませんでした:', v.youtubeId, o.status); continue; }
    v.checkedAt = now;
  }

  // 練習データ（data/videos/*.enc.json）を反映
  const dir = path.join(DATA, 'videos');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.enc.json')) : [];
  for (const f of files) {
    try {
      const d = await open(key, readJSON(path.join(dir, f)));
      const fid = f.replace('.enc.json', '');
      let v = byId.get(d.youtubeId);
      if (!v) { add({ youtubeId: d.youtubeId, menu: d.menu, title: d.title }); v = byId.get(d.youtubeId); }
      Object.assign(v, {
        status: 'ready', file: fid, title: d.title || v.title, titleJa: d.titleJa, menu: d.menu || v.menu,
        durationSec: d.durationSec, wpm: d.wpm, chapters: (d.chapters || []).length, sentences: (d.sentences || []).length,
        readyAt: v.readyAt || now, embeddable: v.embeddable !== false,
      });
    } catch (e) { log('読めない練習データ:', f, e.message); }
  }

  // 準備中が増えすぎないように、メニューごとに新しい順で残す
  const keep = sources.keepPendingPerMenu || 40;
  const ts = v => v.publishedAt || v.addedAt || '';
  for (const menu of ['chloe', 'ted']) {
    const pend = cat.videos.filter(v => v.menu === menu && v.status === 'pending').sort((a, b) => ts(b).localeCompare(ts(a)));
    const drop = new Set(pend.slice(keep).map(v => v.youtubeId));
    cat.videos = cat.videos.filter(v => !drop.has(v.youtubeId));
  }
  cat.videos.sort((a, b) => ts(b).localeCompare(ts(a)));
  cat.updatedAt = now;
  await writeSealed(key, 'catalog.enc.json', cat);
  log(`一覧: ${cat.videos.length}本（練習できる ${cat.videos.filter(v => v.status === 'ready').length}本）`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
