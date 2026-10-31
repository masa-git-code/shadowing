// 暗号化の共通処理（アプリの app.js と同じ方式）
// パスワード → PBKDF2-SHA256 → AES-256-GCM
import { webcrypto as crypto } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const DATA = path.join(ROOT, 'data');

const b64e = buf => Buffer.from(buf).toString('base64');
const b64d = s => new Uint8Array(Buffer.from(s, 'base64'));

export function password() {
  const p = process.env.SHADOWING_PASSWORD;
  if (!p) throw new Error('SHADOWING_PASSWORD が設定されていません');
  return p;
}

export async function deriveKey(pass, saltB64, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64d(saltB64), iterations: iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { v: 1, iv: b64e(iv), ct: b64e(ct) };
}

export async function open(key, env) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(env.iv) }, key, b64d(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

export const randomB64 = n => b64e(crypto.getRandomValues(new Uint8Array(n)));

// 動画ファイル名は YouTube の ID がわからないようにハッシュにする
export async function fileIdFor(youtubeId, saltB64) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(saltB64 + ':' + youtubeId));
  return Buffer.from(h).toString('hex').slice(0, 16);
}

export const readJSON = (p, fallback) => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback;
export const writeJSON = (p, obj) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 1) + '\n'); };

// meta.json がなければ作る（初回だけ）
export async function loadMeta({ create = false } = {}) {
  const p = path.join(DATA, 'meta.json');
  let meta = readJSON(p, null);
  if (!meta) {
    if (!create) throw new Error('data/meta.json がありません。先に「Update catalog」を実行してください');
    meta = { v: 1, salt: randomB64(16), iter: 310000 };
    const key = await deriveKey(password(), meta.salt, meta.iter);
    meta.check = await seal(key, 'shadowing-ok');
    writeJSON(p, meta);
    return { meta, key, created: true };
  }
  const key = await deriveKey(password(), meta.salt, meta.iter);
  try { await open(key, meta.check); } catch { throw new Error('パスワードが data/meta.json と一致しません'); }
  return { meta, key, created: false };
}

export async function readSealed(key, name, fallback) {
  const p = path.join(DATA, name);
  if (!fs.existsSync(p)) return fallback;
  return open(key, readJSON(p));
}
export async function writeSealed(key, name, obj) {
  writeJSON(path.join(DATA, name), await seal(key, obj));
}
