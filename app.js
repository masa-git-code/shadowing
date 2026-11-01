'use strict';
// Shadowing アプリ本体（ビルド不要の素の JavaScript）

// ---------- 基本設定 ----------
const REPO = (() => {
  const h = location.hostname;
  if (h.endsWith('.github.io')) return { owner: h.split('.')[0], name: location.pathname.split('/')[1] || 'shadowing' };
  return { owner: 'masa-git-code', name: 'shadowing' };
})();
const INTERVALS = [1, 2, 4, 7, 15, 30]; // 忘却曲線にもとづく復習の間隔（日）
const MENUS = { chloe: 'Chloe Chua', ted: 'TED' };
const DEFAULT_SETTINGS = { showEn: true, showJa: true, showHints: false, mode: 'continuous', targetWpm: null };

// ---------- 小さな道具 ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const today = () => ymd(new Date());
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const mdLabel = s => s ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : '';
const mmss = t => `${Math.floor(t / 60)}:${pad2(Math.floor(t % 60))}`;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.tm); toast.tm = setTimeout(() => { t.hidden = true; }, ms);
}
function modal(html, bind) {
  $('#modalBody').innerHTML = html; $('#modal').hidden = false;
  bind && bind($('#modalBody'));
}
function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

// ---------- IndexedDB（iPhoneの中の保存場所） ----------
const idb = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('shadowing', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async get(k) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
  async del(k) { const db = await this.open(); return new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = () => res(); }); },
};

// ---------- 暗号（tools/lib/crypto.mjs と同じ方式） ----------
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64e = buf => { let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
async function deriveKey(pass, saltB64, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64d(saltB64), iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { v: 1, iv: b64e(iv), ct: b64e(ct) };
}
async function unseal(key, env) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(env.iv) }, key, b64d(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function fetchJSON(path) {
  const r = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function fetchSealed(path) { const env = await fetchJSON(path); return env ? unseal(S.key, env) : null; }

// ---------- 状態 ----------
const S = {
  key: null, meta: null, catalog: { videos: [] }, vocab: [], progress: {}, adjust: {}, settings: { ...DEFAULT_SETTINGS },
  localReq: {}, video: null, player: null, tick: null, chapter: 0, cur: -1, loopIdx: null, stopAt: null, revealed: new Set(),
};
const saveVocab = async () => { await idb.set('vocab', S.vocab); updateBadge(); };
const saveSettings = () => idb.set('settings', S.settings);

// ---------- 起動 ----------
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.storage?.persist?.();
  try { S.meta = await fetchJSON('data/meta.json'); } catch { S.meta = null; }
  S.key = await idb.get('key');
  if (S.key && S.meta) {
    try { await unseal(S.key, S.meta.check); } catch { S.key = null; await idb.del('key'); }
  }
  if (!S.key) return renderLogin();
  await start();
}

async function start() {
  S.vocab = (await idb.get('vocab')) || [];
  S.progress = (await idb.get('progress')) || {};
  S.adjust = (await idb.get('adjust')) || {};
  S.settings = { ...DEFAULT_SETTINGS, ...((await idb.get('settings')) || {}) };
  S.localReq = (await idb.get('localReq')) || {};
  $('#tabbar').hidden = false;
  updateBadge();
  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = '#/chloe';
  route();
  loadCatalog().then(() => { if (/^#\/(chloe|ted)?$/.test(location.hash)) route(); });
  importInbox();
}

function renderLogin(errMsg = '') {
  $('#tabbar').hidden = true; $('#backBtn').hidden = true; $('#title').textContent = 'Shadowing';
  if (!S.meta) {
    $('#main').innerHTML = `<div class="login"><img src="icons/icon-192.png" alt=""><h2>初期設定がまだです</h2>
      <p class="muted">GitHubでパスワードを登録し、「Update catalog」を実行すると使えるようになります。手順はリポジトリの README を見てください。</p>
      <button class="btn secondary" onclick="location.reload()">もう一度読み込む</button></div>`;
    return;
  }
  $('#main').innerHTML = `<form class="login" id="loginForm"><img src="icons/icon-192.png" alt=""><h2>Shadowing</h2>
    <p class="muted">パスワードを入力してください</p>
    <input type="password" id="pw" autocomplete="current-password" placeholder="パスワード" required>
    <p class="err">${esc(errMsg)}</p>
    <button class="btn block" id="loginBtn">ログイン</button></form>`;
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    $('#loginBtn').disabled = true; $('#loginBtn').textContent = '確認中…';
    try {
      const key = await deriveKey($('#pw').value, S.meta.salt, S.meta.iter);
      await unseal(key, S.meta.check);
      S.key = key; await idb.set('key', key);
      await start();
    } catch { renderLogin('パスワードが違います'); }
  };
}

async function loadCatalog() {
  try {
    const c = await fetchSealed('data/catalog.enc.json');
    if (c) S.catalog = c;
  } catch (e) { toast('動画一覧を読み込めませんでした'); }
}

// Claude が用意した表現（Teamsの表現など）を単語帳に取り込む
async function importInbox() {
  try {
    const inbox = await fetchSealed('data/inbox.enc.json');
    if (!inbox) return;
    const done = new Set((await idb.get('importedPacks')) || []);
    let n = 0;
    for (const p of inbox.packs || []) {
      if (done.has(p.id)) continue;
      for (const it of p.items || []) { if (addVocab({ ...it, source: it.source || { label: 'Claudeから' } }, true)) n++; }
      done.add(p.id);
    }
    await idb.set('importedPacks', [...done]);
    if (n) { await saveVocab(); toast(`${n}個の表現を単語帳に追加しました`); }
  } catch {}
}

// ---------- 画面の切り替え ----------
function setChrome(title, tab, back) {
  $('#title').textContent = title;
  document.querySelectorAll('#tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  const b = $('#backBtn'); b.hidden = !back; b.onclick = back ? () => { location.hash = back; } : null;
}
function route() {
  S.routeId = (S.routeId || 0) + 1;
  stopPlayer();
  document.body.classList.remove('video-mode');
  closeModal();
  window.scrollTo(0, 0);
  const [, page, arg] = location.hash.split('/');
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  if (page === 'ted' || page === 'chloe') return renderList(page);
  if (page?.startsWith('video')) return renderVideo((arg || '').split('?')[0], Number(q.get('t')) || null);
  if (page === 'vocab') return renderVocab();
  if (page === 'review') return renderReview();
  if (page === 'settings') return renderSettings();
  location.hash = '#/chloe';
}

// ---------- 動画の一覧 ----------
function statusOf(v) { return v.status === 'ready' ? 'ready' : (S.localReq[v.youtubeId] || v.status === 'requested') ? 'requested' : 'pending'; }
function renderList(menu) {
  setChrome(MENUS[menu], menu);
  const vids = (S.catalog.videos || []).filter(v => v.menu === menu && v.embeddable !== false);
  const ready = vids.filter(v => v.status === 'ready');
  const waiting = vids.filter(v => v.status !== 'ready').sort((a, b) => (statusOf(a) === 'requested' ? -1 : 0) - (statusOf(b) === 'requested' ? -1 : 0));
  const card = v => {
    const st = statusOf(v);
    const p = S.progress[v.file];
    const info = st === 'ready'
      ? [v.durationSec ? `${Math.round(v.durationSec / 60)}分` : '', v.wpm ? `${v.wpm} WPM` : '', v.chapters ? `${v.chapters}チャプター` : ''].filter(Boolean).join(' · ')
      : (v.channel || '') + (v.publishedAt ? ` · ${v.publishedAt.slice(0, 10)}` : '');
    const inner = `<img loading="lazy" src="https://i.ytimg.com/vi/${esc(v.youtubeId)}/mqdefault.jpg" alt="">
      <div><div class="t">${esc(v.title || v.youtubeId)}</div>${v.titleJa ? `<div class="tj">${esc(v.titleJa)}</div>` : ''}
      <div class="muted">${esc(info)}</div>
      <div style="margin-top:4px"><span class="badge ${st}">${st === 'ready' ? '練習できる' : st === 'requested' ? '依頼済み' : '準備中'}</span>
      ${p ? `<span class="muted"> 練習 ${p.count || 1}回 · ${mdLabel(p.at)}</span>` : ''}</div></div>`;
    if (st === 'ready') return `<a class="card vid" href="#/video/${esc(v.file)}">${inner}</a>`;
    return `<div class="card"><div class="vid">${inner}</div>
      <div class="vid-actions">${st === 'pending' ? `<button class="btn secondary" data-req="${esc(v.youtubeId)}">準備を依頼</button>` : `<button class="btn ghost" data-req="${esc(v.youtubeId)}">依頼の方法を見る</button>`}
      <a class="btn ghost" href="https://www.youtube.com/watch?v=${esc(v.youtubeId)}" target="_blank" rel="noopener">YouTubeで見る</a></div></div>`;
  };
  $('#main').innerHTML = `
    <div class="section-title">練習できる（${ready.length}）</div>
    ${ready.map(card).join('') || `<div class="card empty">まだありません。下の「準備中」から動画を選んで依頼してください。</div>`}
    <div class="section-title">準備中（${waiting.length}）</div>
    ${waiting.map(card).join('') || `<div class="card empty">${S.catalog.updatedAt ? '新しい動画はありません' : '動画一覧はまだ作られていません'}</div>`}
    <button class="btn secondary block" id="addUrl" style="margin-top:14px">＋ URLで動画を追加</button>
    ${S.catalog.updatedAt ? `<p class="muted" style="text-align:center">一覧の更新：${mdLabel(S.catalog.updatedAt)}（毎週月曜に自動更新）</p>` : ''}`;
  $('#main').querySelectorAll('[data-req]').forEach(b => { b.onclick = () => requestVideo(vids.find(v => v.youtubeId === b.dataset.req)); });
  $('#addUrl').onclick = () => addByUrl(menu);
}

// アプリからの依頼は GitHub の Issue として送る（中身は暗号化）
// iPhoneは、ボタンを押してから時間のかかる処理をはさむと画面を開けないので、
// 準備ができたらリンクのボタンを出して、もう一度押してもらう
async function openIssue(title, payload, onSent) {
  const env = await seal(S.key, payload);
  const body = `アプリからの依頼です（中身は暗号化されています）。\n\n\`\`\`json\n${JSON.stringify(env)}\n\`\`\``;
  const url = `https://github.com/${REPO.owner}/${REPO.name}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  modal(`<h2>GitHubで送信（${esc(title)}）</h2>
    <p>下のボタンでGitHubが開きます。画面の<b>いちばん下の緑のボタン</b>（「Create」または「Submit new issue」）を押すと送信されます。</p>
    <a class="btn block" id="ghLink" href="${esc(url)}" target="_blank" rel="noopener">GitHubを開く</a>
    <p class="muted">GitHubのログイン画面が出たら、ログインしてから、もう一度アプリからやり直してください。</p>
    <button class="btn ghost block" id="cancel">閉じる</button>`, el => {
    el.querySelector('#ghLink').onclick = () => { setTimeout(() => { closeModal(); onSent && onSent(); }, 400); };
    el.querySelector('#cancel').onclick = closeModal;
  });
}

function requestVideo(v) {
  const isTed = v.menu === 'ted';
  modal(`<h2>準備を依頼</h2><p><b>${esc(v.title || v.youtubeId)}</b></p>
    ${isTed ? `<p>GitHubで依頼を送ると、Claudeが文字起こし・翻訳・チャプター・発音のヒントを用意します。</p>`
      : `<p>Chloe ChuaのYouTube動画は、文字起こしをMacからClaudeに渡す必要があります。</p>
      <ol><li>MacのブラウザでこのYouTube動画を開く</li><li>説明欄の下の「文字起こしを表示」を押す</li><li>文字起こしを全部選んでコピー</li><li>Claudeのチャットに、動画名と一緒に貼る</li></ol>
      <p>下のボタンで依頼も送っておくと、一覧に「依頼済み」と表示されます。</p>`}
    <p class="muted">GitHubにログインしていない場合は、先にログインしてください。</p>
    <div class="row" style="margin-top:12px"><button class="btn" id="go">GitHubで依頼を送る</button><button class="btn ghost" id="cancel">閉じる</button></div>`, el => {
    el.querySelector('#cancel').onclick = closeModal;
    el.querySelector('#go').onclick = async () => {
      await openIssue('準備の依頼', { type: 'request', youtubeId: v.youtubeId }, async () => {
        S.localReq[v.youtubeId] = Date.now(); await idb.set('localReq', S.localReq); route();
      });
    };
  });
}

function parseYouTubeId(s) {
  s = (s || '').trim();
  const m = s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/) || s.match(/^([\w-]{11})$/);
  return m ? m[1] : null;
}
function addByUrl(menu) {
  modal(`<h2>URLで動画を追加</h2>
    <label class="field">YouTubeのURL<input type="url" id="u" placeholder="https://www.youtube.com/watch?v=..."></label>
    <label class="field">メニュー<select id="m"><option value="chloe" ${menu === 'chloe' ? 'selected' : ''}>Chloe Chua</option><option value="ted" ${menu === 'ted' ? 'selected' : ''}>TED</option></select></label>
    <label class="row" style="font-size:14px;margin:10px 0"><input type="checkbox" id="r" checked style="width:auto"> 準備の依頼もする</label>
    <p class="err" id="e"></p>
    <div class="row"><button class="btn" id="go">GitHubで送る</button><button class="btn ghost" id="cancel">閉じる</button></div>`, el => {
    el.querySelector('#cancel').onclick = closeModal;
    el.querySelector('#go').onclick = async () => {
      const id = parseYouTubeId(el.querySelector('#u').value);
      if (!id) { el.querySelector('#e').textContent = 'YouTubeのURLを確認してください'; return; }
      const request = el.querySelector('#r').checked;
      await openIssue('動画の追加', { type: 'add', youtubeId: id, menu: el.querySelector('#m').value, request }, async () => {
        if (request) { S.localReq[id] = Date.now(); await idb.set('localReq', S.localReq); }
        toast('送信すると、数分で一覧に入ります', 4000);
      });
    };
  });
}

// ---------- 練習画面 ----------
function loadYouTubeAPI() {
  if (window.YT?.Player) return Promise.resolve();
  if (loadYouTubeAPI.p) return loadYouTubeAPI.p;
  loadYouTubeAPI.p = new Promise((res, rej) => {
    window.onYouTubeIframeAPIReady = res;
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.onerror = rej;
    document.head.appendChild(s);
  });
  return loadYouTubeAPI.p;
}
const sentAt = i => {
  const s = S.video.sentences[i], a = (S.adjust[S.video.file] || {})[i] || {};
  return { ...s, start: Math.max(0, s.start + (a.ds || 0)), end: s.end + (a.de || 0) };
};
const chapterOf = i => S.video.chapters.findIndex(c => i >= c.from && i <= c.to);
const chapAt = c => { const ch = S.video.chapters[c]; return { ...ch, start: sentAt(ch.from).start, end: sentAt(ch.to).end }; };

async function renderVideo(file, startAt) {
  const entry = (S.catalog.videos || []).find(v => v.file === file);
  setChrome(entry?.title || '練習', entry?.menu || 'chloe', `#/${entry?.menu || 'chloe'}`);
  $('#main').innerHTML = `<div class="empty">読み込み中…</div>`;
  let d;
  const rid = S.routeId;
  try { d = await fetchSealed(`data/videos/${file}.enc.json`); } catch { d = null; }
  if (rid !== S.routeId) return;
  if (!d) { $('#main').innerHTML = `<div class="card empty">練習データを読み込めませんでした。</div>`; return; }
  document.body.classList.add('video-mode');
  d.file = file; S.video = d; S.revealed = new Set(); S.loopIdx = null; S.stopAt = null; S.cur = -1;
  setChrome(d.title, d.menu, `#/${d.menu}`);
  const p = S.progress[file];
  let startIdx = 0;
  if (startAt != null) startIdx = Math.max(0, d.sentences.findIndex(s => s.end > startAt));
  else if (p?.sentence != null) startIdx = p.sentence;
  S.chapter = Math.max(0, chapterOf(startIdx));

  $('#main').innerHTML = `
    <div class="player-wrap"><div class="ratio"><div id="yt"></div></div></div>
    <div class="toggles"><button data-t="showEn">英文</button><button data-t="showJa">訳</button><button data-t="showHints">ヒント</button></div>
    <div class="controls">
      <div class="seg" id="modes">
        <button data-m="continuous">続けて再生</button><button data-m="stop">1文で止める</button><button data-m="sentence">1文リピート</button><button data-m="chapter">チャプター</button>
      </div>
      <div class="ctl-row">
        <div class="speed"><button id="slower" aria-label="遅く">−</button><button class="val" id="speedVal" aria-label="等速に戻す"></button><button id="faster" aria-label="速く">＋</button></div>
        <div class="transport"><button id="prev" aria-label="前の文">⏮</button><button id="play" class="play" aria-label="再生">▶︎</button><button id="next" aria-label="次の文">⏭</button></div>
      </div>
    </div>
    <div class="chapters" id="chapters"></div>
    <div id="sents"></div>`;

  // 操作
  $('#play').onclick = () => { if (!S.player?.getPlayerState) return; const st = S.player.getPlayerState(); st === 1 ? S.player.pauseVideo() : S.player.playVideo(); };
  $('#prev').onclick = () => playSentence(Math.max(0, (S.cur < 0 ? 0 : S.cur) - 1));
  $('#next').onclick = () => playSentence(Math.min(d.sentences.length - 1, (S.cur < 0 ? 0 : S.cur) + 1));
  $('#modes').onclick = e => {
    const m = e.target.dataset.m; if (!m) return;
    S.settings.mode = m; saveSettings(); S.stopAt = null;
    if (m === 'sentence') S.loopIdx = S.cur >= 0 ? S.cur : d.chapters[S.chapter].from;
    paintControls();
  };
  document.querySelector('.toggles').onclick = e => {
    const t = e.target.dataset.t; if (!t) return;
    S.settings[t] = !S.settings[t]; saveSettings(); S.revealed = new Set(); paintControls(); renderSentences();
  };
  $('#slower').onclick = () => changeWpm(-10);
  $('#faster').onclick = () => changeWpm(+10);
  $('#speedVal').onclick = () => { S.settings.targetWpm = null; saveSettings(); applyRate(); };

  renderChapters(); renderSentences(); paintControls();
  try { await loadYouTubeAPI(); } catch { toast('YouTubeに接続できません'); return; }
  if (S.video !== d) return; // 途中で別の画面に移った
  const first = sentAt(startIdx);
  S.player = new YT.Player('yt', {
    videoId: d.youtubeId,
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(first.start), origin: location.origin },
    events: {
      onReady: () => { applyRate(); },
      onStateChange: ev => {
        $('#play').textContent = ev.data === 1 ? '⏸' : '▶︎';
        if (ev.data === 1) { keepAwake(true); markPracticed(); applyRate(); } else keepAwake(false);
      },
      onError: ev => toast(`再生できません（${ev.data}）。YouTubeで開いてください`, 4000),
    },
  });
  S.tick = setInterval(onTick, 100);
}

function renderChapters() {
  const d = S.video;
  $('#chapters').innerHTML = d.chapters.map((c, i) => `<button class="chap ${i === S.chapter ? 'on' : ''}" data-c="${i}">
    <span class="n">${i + 1}. ${esc(c.titleJa || c.title || '')}</span><span class="w">${c.wpm ? c.wpm + ' WPM · ' : ''}${c.to - c.from + 1}文</span></button>`).join('');
  $('#chapters').onclick = e => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    S.chapter = Number(b.dataset.c); renderChapters(); renderSentences(); applyRate();
    playSentence(d.chapters[S.chapter].from);
  };
  $('#chapters').querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function hintHtml(s) {
  const h = s.hints; if (!h) return '';
  const rows = [];
  if (h.linking?.length) rows.push(`<div><span class="k">つながる</span>${h.linking.map(esc).join('、 ')}</div>`);
  if (h.reductions?.length) rows.push(`<div><span class="k">音の変化</span>${h.reductions.map(r => typeof r === 'string' ? esc(r) : `${esc(r.from)} → <b>${esc(r.to)}</b>`).join('、 ')}</div>`);
  if (h.tip) rows.push(`<div><span class="k">コツ</span>${esc(h.tip)}</div>`);
  return rows.length ? `<div class="hints">${rows.join('')}</div>` : '';
}
// ヒント表示中は「/」で意味のかたまりを、太字で強く読む語を示す
function enHtml(s) {
  const showH = S.settings.showHints && s.hints;
  let text = showH && s.hints.chunks ? s.hints.chunks : s.en;
  let html = esc(text);
  if (showH && s.hints.stress?.length) {
    for (const w of s.hints.stress) {
      const re = new RegExp(`(^|[^\\w'])(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=[^\\w']|$)`, 'i');
      html = html.replace(re, '$1<span class="stress">$2</span>');
    }
  }
  if (showH) html = html.replace(/ \/ /g, ' <span class="chunk-sep">/</span> ');
  return html;
}
function renderSentences() {
  const d = S.video, ch = d.chapters[S.chapter];
  const vocabKeys = new Set(S.vocab.map(v => v.phrase.toLowerCase()));
  let html = `<div class="section-title">${S.chapter + 1}. ${esc(ch.title || '')}${ch.titleJa ? ` — ${esc(ch.titleJa)}` : ''}</div>`;
  for (let i = ch.from; i <= ch.to; i++) {
    const s = d.sentences[i], t = sentAt(i);
    const hideEn = !S.settings.showEn && !S.revealed.has(i);
    html += `<div class="sent ${i === S.cur ? 'active' : ''}" id="s${i}" data-i="${i}">
      <div class="en ${hideEn ? 'hide' : ''}" data-act="play">${enHtml(s)}</div>
      <div class="ja ${S.settings.showJa ? '' : 'hide'}" data-act="play">${esc(s.ja)}</div>
      ${S.settings.showHints ? hintHtml(s) : ''}
      ${s.phrases?.length ? `<div class="phrases">${s.phrases.map((p, k) => `<button class="phrase ${vocabKeys.has(p.text.toLowerCase()) ? 'added' : ''}" data-act="phrase" data-k="${k}">${esc(p.text)} ${vocabKeys.has(p.text.toLowerCase()) ? '✓' : '＋'}</button>`).join('')}</div>` : ''}
      <div class="sent-foot">${mmss(t.start)}<span class="spacer"></span>${hideEn ? `<button data-act="reveal">英文を見る</button>` : ''}<button data-act="speak">🔊</button><button data-act="adjust">位置を調整</button></div></div>`;
  }
  $('#sents').innerHTML = html;
  $('#sents').onclick = e => {
    const el = e.target.closest('[data-act]'), box = e.target.closest('.sent'); if (!el || !box) return;
    const i = Number(box.dataset.i), s = d.sentences[i];
    const act = el.dataset.act;
    if (act === 'play') { if (!S.settings.showEn && !S.revealed.has(i) && el.classList.contains('en')) { S.revealed.add(i); renderSentences(); } playSentence(i); }
    if (act === 'reveal') { S.revealed.add(i); renderSentences(); }
    if (act === 'speak') speak(s.en);
    if (act === 'adjust') adjustSentence(i);
    if (act === 'phrase') {
      const p = s.phrases[Number(el.dataset.k)];
      const ok = addVocab({ phrase: p.text, meaning: p.meaning, note: p.note, example: s.en, exampleJa: s.ja, tip: s.hints?.tip,
        source: { file: d.file, youtubeId: d.youtubeId, title: d.title, start: sentAt(i).start, end: sentAt(i).end } });
      if (ok) { saveVocab(); toast(`「${p.text}」を単語帳に追加しました`); renderSentences(); } else toast('もう単語帳に入っています');
    }
  };
}

function paintControls() {
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.m === S.settings.mode));
  document.querySelectorAll('.toggles button').forEach(b => b.classList.toggle('on', !!S.settings[b.dataset.t]));
  paintSpeed();
}
function rateFor() {
  const ch = S.video.chapters[S.chapter], orig = ch.wpm || S.video.wpm;
  if (!S.settings.targetWpm || !orig) return { rate: 1, orig };
  const rates = S.player?.getAvailablePlaybackRates?.() || [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const want = S.settings.targetWpm / orig;
  const rate = rates.reduce((a, b) => Math.abs(b - want) < Math.abs(a - want) ? b : a, 1);
  return { rate, orig };
}
function paintSpeed() {
  const { rate, orig } = rateFor();
  $('#speedVal').innerHTML = S.settings.targetWpm
    ? `${S.settings.targetWpm} WPM<small>元 ${orig || '?'} · ${rate}倍</small>`
    : `等速<small>${orig || '?'} WPM</small>`;
}
function changeWpm(delta) {
  const orig = S.video.chapters[S.chapter].wpm || S.video.wpm || 150;
  S.settings.targetWpm = Math.max(60, Math.min(260, (S.settings.targetWpm || Math.round(orig / 10) * 10) + delta));
  saveSettings(); applyRate();
}
function applyRate() {
  paintSpeed();
  if (S.player?.setPlaybackRate) S.player.setPlaybackRate(rateFor().rate);
}

function playSentence(i) {
  if (!S.player?.seekTo) return;
  const c = chapterOf(i);
  if (c !== S.chapter && c >= 0) { S.chapter = c; renderChapters(); renderSentences(); applyRate(); }
  if (S.settings.mode === 'sentence') S.loopIdx = i;
  S.stopAt = S.settings.mode === 'stop' ? sentAt(i).end : null;
  S.player.seekTo(sentAt(i).start, true);
  S.player.playVideo();
  setCurrent(i);
}

function setCurrent(i) {
  if (i === S.cur) return;
  document.getElementById('s' + S.cur)?.classList.remove('active');
  S.cur = i;
  const el = document.getElementById('s' + i);
  if (el) {
    el.classList.add('active');
    const pb = document.querySelector('.player-wrap')?.getBoundingClientRect().bottom || 0;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - pb - 10, behavior: 'smooth' });
  }
  if (i >= 0) { const p = S.progress[S.video.file] ||= {}; p.sentence = i; p.chapter = S.chapter; idb.set('progress', S.progress); }
}

// 0.1秒ごとに再生位置を見て、リピートや停止を行う
function onTick() {
  const P = S.player; if (!P?.getCurrentTime || !S.video) return;
  const t = P.getCurrentTime(), playing = P.getPlayerState() === 1;
  const n = S.video.sentences.length;
  let i = -1;
  for (let k = 0; k < n; k++) { const s = sentAt(k); if (t >= s.start && t < s.end) { i = k; break; } if (s.start > t) { i = Math.max(0, k - 1); break; } }
  if (i === -1 && n && t >= sentAt(n - 1).end) i = n - 1;
  if (!playing) return;
  const mode = S.settings.mode;
  if (mode === 'sentence' && S.loopIdx != null) {
    const s = sentAt(S.loopIdx);
    if (t >= s.end + 0.15 || t < s.start - 1.5) { P.seekTo(s.start, true); return; }
    setCurrent(S.loopIdx); return;
  }
  if (mode === 'chapter') {
    const ch = chapAt(S.chapter);
    if (t >= ch.end + 0.2 || t < ch.start - 1.5) { P.seekTo(ch.start, true); markPracticed(true); return; }
  }
  if (mode === 'stop') {
    if (S.stopAt == null && i >= 0) S.stopAt = sentAt(i).end;
    if (S.stopAt != null && t >= S.stopAt) { P.pauseVideo(); S.stopAt = null; return; }
  }
  if (i >= 0 && i !== S.cur) {
    const c = chapterOf(i);
    if (c !== S.chapter && c >= 0 && mode !== 'chapter') { S.chapter = c; renderChapters(); renderSentences(); applyRate(); }
    setCurrent(i);
  }
}

function markPracticed(loop) {
  const p = S.progress[S.video.file] ||= {};
  if (p.at !== today() || loop) { p.count = (p.count || 0) + (p.at === today() && !loop ? 0 : 1); p.at = today(); idb.set('progress', S.progress); }
}

function stopPlayer() {
  clearInterval(S.tick); S.tick = null;
  try { S.player?.destroy?.(); } catch {}
  S.player = null; S.video = null; keepAwake(false);
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}

function adjustSentence(i) {
  const file = S.video.file;
  const draw = el => {
    const t = sentAt(i);
    el.querySelector('#times').textContent = `${t.start.toFixed(1)}秒 〜 ${t.end.toFixed(1)}秒`;
  };
  modal(`<h2>この文の区切りを調整</h2><p class="muted">${esc(S.video.sentences[i].en)}</p>
    <p id="times" style="font-weight:600"></p>
    <div class="row wrap" style="margin:8px 0"><span style="width:3em">開始</span><button class="btn secondary" data-a="ds" data-v="-0.5">−0.5秒</button><button class="btn secondary" data-a="ds" data-v="0.5">＋0.5秒</button></div>
    <div class="row wrap" style="margin:8px 0"><span style="width:3em">終了</span><button class="btn secondary" data-a="de" data-v="-0.5">−0.5秒</button><button class="btn secondary" data-a="de" data-v="0.5">＋0.5秒</button></div>
    <div class="row" style="margin-top:12px"><button class="btn" id="test">聞いて確かめる</button><button class="btn ghost" id="reset">元に戻す</button><span class="spacer"></span><button class="btn ghost" id="close">閉じる</button></div>`, el => {
    draw(el);
    el.querySelectorAll('[data-a]').forEach(b => { b.onclick = () => {
      const a = ((S.adjust[file] ||= {})[i] ||= {}); a[b.dataset.a] = Math.round(((a[b.dataset.a] || 0) + Number(b.dataset.v)) * 10) / 10;
      idb.set('adjust', S.adjust); draw(el);
    }; });
    el.querySelector('#test').onclick = () => { const m = S.settings.mode; S.settings.mode = 'stop'; playSentence(i); S.settings.mode = m; S.stopAt = sentAt(i).end; };
    el.querySelector('#reset').onclick = () => { if (S.adjust[file]) delete S.adjust[file][i]; idb.set('adjust', S.adjust); draw(el); };
    el.querySelector('#close').onclick = () => { closeModal(); renderSentences(); };
  });
}

// ---------- 読み上げ ----------
function speak(text, rate = 0.9) {
  if (!('speechSynthesis' in window)) return toast('この端末は読み上げに対応していません');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US'; u.rate = rate;
  const v = speechSynthesis.getVoices().find(v => v.lang === 'en-US' && /Samantha|Ava|Allison|Google US/i.test(v.name)) || speechSynthesis.getVoices().find(v => v.lang === 'en-US');
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

// ---------- 単語帳 ----------
function addVocab(item, silent) {
  if (!item.phrase) return false;
  if (S.vocab.some(v => v.phrase.toLowerCase() === item.phrase.toLowerCase())) return false;
  S.vocab.unshift({ id: uid(), phrase: item.phrase, meaning: item.meaning || '', note: item.note || '', example: item.example || '', exampleJa: item.exampleJa || '', tip: item.tip || '',
    source: item.source || null, stage: 0, due: addDays(1), mastered: false, createdAt: new Date().toISOString(), history: [] });
  return true;
}
const dueList = () => S.vocab.filter(v => !v.mastered && v.due && v.due <= today());
function updateBadge() {
  const n = dueList().length, b = $('#dueBadge');
  b.hidden = !n; b.textContent = n;
  try { n ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.(); } catch {}
}

function renderVocab() {
  setChrome('単語帳', 'vocab');
  const due = dueList(), mastered = S.vocab.filter(v => v.mastered).length;
  $('#main').innerHTML = `
    <div class="card review-cta"><div><div class="muted">今日の復習</div><div class="num">${due.length}<span style="font-size:15px">個</span></div></div>
      <span class="spacer"></span><button class="btn" id="startReview" ${due.length ? '' : 'disabled'}>復習を始める</button></div>
    <div class="row" style="margin:6px 4px 10px"><span class="muted">全部 ${S.vocab.length}個 · 習得済み ${mastered}個</span><span class="spacer"></span><button class="btn secondary" id="addV">＋ 表現を追加</button></div>
    <input type="text" id="q" placeholder="検索">
    <div id="vlist" style="margin-top:10px"></div>
    <p class="muted" style="margin-top:14px">復習は 1日後 → 2日後 → 4日後 → 7日後 → 15日後 → 30日後。忘れていたら最初からやり直します。Teamsで拾った表現は、Claudeのチャットに貼れば意味と例文をつけて自動で追加します。</p>`;
  const draw = () => {
    const q = $('#q').value.trim().toLowerCase();
    const list = S.vocab.filter(v => !q || (v.phrase + v.meaning).toLowerCase().includes(q));
    $('#vlist').innerHTML = list.map(v => `<button class="vocab-item" data-id="${v.id}"><span class="d">${v.mastered ? '習得済み' : v.due <= today() ? '今日' : '次 ' + mdLabel(v.due)}</span>
      <div class="p">${esc(v.phrase)}</div><div class="m">${esc(v.meaning)}</div></button>`).join('') || `<div class="card empty">${q ? '見つかりません' : '練習画面の「＋」がついた表現をタップすると、ここに追加されます'}</div>`;
  };
  draw();
  $('#q').oninput = draw;
  $('#vlist').onclick = e => { const b = e.target.closest('[data-id]'); if (b) showVocab(b.dataset.id); };
  $('#startReview').onclick = () => { location.hash = '#/review'; };
  $('#addV').onclick = () => editVocab(null);
}

function vocabBody(v) {
  return `<div class="p">${esc(v.phrase)} <button class="speak" data-say="p">🔊</button></div>
    <div class="m">${esc(v.meaning)}</div>${v.note ? `<div class="muted" style="margin-top:6px">${esc(v.note)}</div>` : ''}
    ${v.example ? `<div class="ex">${esc(v.example)} <button class="speak" data-say="e">🔊</button></div><div class="exj">${esc(v.exampleJa)}</div>` : ''}
    ${v.tip ? `<div class="hints" style="text-align:left"><span class="k">発音</span>${esc(v.tip)}</div>` : ''}
    ${v.source?.file ? `<div style="margin-top:12px"><a class="btn secondary" href="#/video/${esc(v.source.file)}?t=${v.source.start}">▶ 動画のこの場面を見る</a></div>` : ''}`;
}
function bindSay(el, v) {
  el.querySelectorAll('[data-say]').forEach(b => { b.onclick = () => speak(b.dataset.say === 'p' ? v.phrase : v.example); });
}
function showVocab(id) {
  const v = S.vocab.find(x => x.id === id); if (!v) return;
  modal(`<div class="flash" style="padding:8px 0">${vocabBody(v)}</div>
    <p class="muted">${v.mastered ? '習得済み' : `次の復習：${mdLabel(v.due)}（${v.stage + 1}段階目／6）`}</p>
    <div class="row"><button class="btn secondary" id="edit">編集</button><button class="btn danger" id="del">削除</button><span class="spacer"></span><button class="btn ghost" id="close">閉じる</button></div>`, el => {
    bindSay(el, v);
    el.querySelector('#close').onclick = closeModal;
    el.querySelector('#edit').onclick = () => editVocab(v);
    el.querySelector('#del').onclick = function () {
      if (this.dataset.sure) { S.vocab = S.vocab.filter(x => x.id !== id); saveVocab(); closeModal(); renderVocab(); }
      else { this.dataset.sure = 1; this.textContent = 'もう一度押すと削除'; }
    };
    el.querySelectorAll('a[href^="#/video"]').forEach(a => { a.onclick = closeModal; });
  });
}
function editVocab(v) {
  const f = v || {};
  modal(`<h2>${v ? '表現を編集' : '表現を追加'}</h2>
    <label class="field">単語・熟語<input type="text" id="fp" value="${esc(f.phrase)}"></label>
    <label class="field">意味<input type="text" id="fm" value="${esc(f.meaning)}"></label>
    <label class="field">例文（英語）<textarea id="fe">${esc(f.example)}</textarea></label>
    <label class="field">例文の訳<textarea id="fj">${esc(f.exampleJa)}</textarea></label>
    <label class="field">発音のコツ・メモ<input type="text" id="ft" value="${esc(f.tip)}"></label>
    <div class="row"><button class="btn" id="save">保存</button><button class="btn ghost" id="cancel">閉じる</button></div>`, el => {
    el.querySelector('#cancel').onclick = closeModal;
    el.querySelector('#save').onclick = () => {
      const val = id => el.querySelector(id).value.trim();
      if (!val('#fp')) return toast('単語・熟語を入れてください');
      if (v) Object.assign(v, { phrase: val('#fp'), meaning: val('#fm'), example: val('#fe'), exampleJa: val('#fj'), tip: val('#ft') });
      else if (!addVocab({ phrase: val('#fp'), meaning: val('#fm'), example: val('#fe'), exampleJa: val('#fj'), tip: val('#ft'), source: { label: '手入力' } })) return toast('もう単語帳に入っています');
      saveVocab(); closeModal(); renderVocab();
    };
  });
}

// 復習（フラッシュカード）
function renderReview() {
  setChrome('今日の復習', 'vocab', '#/vocab');
  const queue = dueList().sort(() => Math.random() - 0.5);
  let idx = 0, shown = false;
  const total = queue.length;
  const draw = () => {
    if (idx >= total) {
      $('#main').innerHTML = `<div class="card flash"><div class="p">🎉</div><div class="m">${total ? `${total}個の復習が終わりました` : '今日の復習はありません'}</div>
        <div style="margin-top:18px"><a class="btn" href="#/vocab">単語帳に戻る</a></div></div>`;
      updateBadge(); return;
    }
    const v = queue[idx];
    $('#main').innerHTML = `<div class="progressbar"><i style="width:${(idx / total) * 100}%"></i></div>
      <p class="muted" style="text-align:center">${idx + 1} / ${total}</p>
      <div class="card flash">${shown ? vocabBody(v) : `<div class="p">${esc(v.phrase)} <button class="speak" data-say="p">🔊</button></div><p class="muted" style="margin-top:16px">意味を思い出してから、答えを見てください</p>`}</div>
      ${shown ? `<div class="row"><button class="btn danger block" id="ng" style="flex:1">忘れていた</button><button class="btn block" id="ok" style="flex:1">覚えていた</button></div>`
        : `<button class="btn block" id="show">答えを見る</button>`}`;
    bindSay($('#main'), v);
    $('#main').querySelectorAll('a[href^="#/video"]').forEach(a => a.remove()); // 復習中は動画に移動しない
    if (!shown) $('#show').onclick = () => { shown = true; draw(); };
    else {
      $('#ok').onclick = () => grade(v, true);
      $('#ng').onclick = () => grade(v, false);
    }
  };
  const grade = (v, ok) => {
    v.history.push({ d: today(), ok });
    if (ok) {
      if (v.stage >= INTERVALS.length - 1) { v.mastered = true; v.due = null; }
      else { v.stage += 1; v.due = addDays(INTERVALS[v.stage]); }
    } else { v.stage = 0; v.due = addDays(INTERVALS[0]); }
    saveVocab(); idx++; shown = false; draw();
  };
  draw();
}

// ---------- 設定 ----------
const isStandalone = () => window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
function urlB64ToUint8(s) { const p = '='.repeat((4 - s.length % 4) % 4); return b64d((s + p).replace(/-/g, '+').replace(/_/g, '/')); }

async function renderSettings() {
  setChrome('設定', 'settings');
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  // 通知の登録は、GitHub側に登録ファイルがあるかで判断する
  let pushOn = false;
  try { pushOn = (await fetch(`data/push.enc.json?t=${Date.now()}`, { method: 'HEAD', cache: 'no-store' })).ok; } catch {}
  if (!location.hash.startsWith('#/settings')) return;
  $('#main').innerHTML = `
    <div class="section-title">毎朝9時の復習の通知</div>
    <div class="card">
      <p class="muted" style="margin-top:0">${!isStandalone() ? 'ホーム画面に追加したアプリから開くと、通知を使えます（Safariの共有ボタン →「ホーム画面に追加」）。'
        : perm === 'unsupported' ? 'この端末は通知に対応していません（iOS 16.4以降が必要です）。'
        : pushOn ? '登録済みです。毎朝9時に届きます。届かない時は、もう一度登録してください。' : 'まだ登録されていません。「通知をオンにする」を押し、GitHubで送信すると登録されます（反映まで数分かかります）。'}</p>
      <div class="row wrap"><button class="btn" id="pushOn" ${!isStandalone() || perm === 'unsupported' || !S.meta?.vapidPublicKey ? 'disabled' : ''}>${pushOn ? 'もう一度登録' : '通知をオンにする'}</button>
      <button class="btn ghost" id="pushTest" ${perm === 'granted' ? '' : 'disabled'}>テスト表示</button></div>
    </div>
    <div class="section-title">データ</div>
    <div class="card">
      <div class="row wrap"><button class="btn secondary" id="reload">動画一覧を更新</button><button class="btn secondary" id="export">バックアップを書き出す</button><button class="btn secondary" id="import">バックアップを読み込む</button></div>
      <input type="file" id="importFile" accept="application/json,.json" hidden>
      <p class="muted">単語帳と練習の記録はこのiPhoneの中だけにあります。アプリをホーム画面から消すと消えるので、月に1回はバックアップを書き出してください。</p>
    </div>
    <div class="section-title">使い方</div>
    <div class="card" style="font-size:14px">
      <ol style="margin:0;padding-left:1.3em">
        <li>「訳」だけ表示して、意味を確かめながら聞く</li>
        <li>英文を見ながら、音と文字を合わせて聞く</li>
        <li>「ヒント」で、かたまり・つながる音・強く読む語を確かめる</li>
        <li>「1文で止める」にして、1文ずつまねて言う</li>
        <li>英文を見ながら、音声にかぶせて言う</li>
        <li>英文を隠して、音声だけでシャドーイング</li>
        <li>速さ（WPM）を上げて、会議の速さに慣れる</li>
      </ol>
    </div>
    <div class="section-title">アカウント</div>
    <div class="card"><button class="btn danger" id="logout">ログアウト</button>
      <p class="muted">ログアウトしても、単語帳と記録は消えません。</p></div>
    <p class="muted" style="text-align:center">Shadowing · ${REPO.owner}/${REPO.name}</p>`;

  $('#pushOn').onclick = async () => {
    try {
      const p = await Notification.requestPermission();
      if (p !== 'granted') return toast('通知が許可されませんでした。iPhoneの設定 → 通知 から許可してください', 4000);
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      // パスワードを変えると通知用の鍵も変わるので、古い登録は消して作り直す
      const key = sub?.options?.applicationServerKey;
      if (sub && key && b64e(key) !== b64e(urlB64ToUint8(S.meta.vapidPublicKey))) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(S.meta.vapidPublicKey) });
      await openIssue('通知の登録', { type: 'subscribe', subscription: sub.toJSON() }, () => toast('送信すると、数分で登録されます', 4000));
    } catch (e) { toast('通知を登録できませんでした：' + e.message, 4000); }
  };
  $('#pushTest').onclick = async () => {
    const reg = await navigator.serviceWorker.ready; const n = dueList().length;
    reg.showNotification('Shadowing', { body: n ? `今日の復習：${n}個` : '今日の復習はありません', icon: 'icons/icon-192.png', data: { url: './#/review' } });
  };
  $('#reload').onclick = async () => { await loadCatalog(); await importInbox(); toast('更新しました'); };
  $('#export').onclick = exportBackup;
  $('#import').onclick = () => $('#importFile').click();
  $('#importFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!Array.isArray(d.vocab)) throw new Error('形式が違います');
      const have = new Set(S.vocab.map(v => v.phrase.toLowerCase()));
      const add = d.vocab.filter(v => !have.has(v.phrase.toLowerCase()));
      S.vocab.push(...add);
      S.progress = { ...d.progress, ...S.progress }; S.adjust = { ...d.adjust, ...S.adjust };
      await saveVocab(); await idb.set('progress', S.progress); await idb.set('adjust', S.adjust);
      toast(`読み込みました（新しい表現 ${add.length}個）`);
    } catch (err) { toast('読み込めませんでした：' + err.message); }
  };
  $('#logout').onclick = async () => { await idb.del('key'); location.hash = ''; location.reload(); };
}

async function exportBackup() {
  const data = { app: 'shadowing', v: 1, exportedAt: new Date().toISOString(), vocab: S.vocab, progress: S.progress, adjust: S.adjust, settings: S.settings };
  const name = `shadowing-backup-${today()}.json`;
  const file = new File([JSON.stringify(data, null, 1)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && S.key) updateBadge(); });
boot();
