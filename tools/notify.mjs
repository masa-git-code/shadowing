// 毎朝の復習の通知を送る。通知の中身（復習の数）は iPhone 側で数える。
import { loadMeta, readSealed } from './lib/crypto.mjs';
import webpush from 'web-push';

const { meta, key } = await loadMeta();
const push = await readSealed(key, 'push.enc.json', null);
if (!push) { console.log('通知の登録がまだありません'); process.exit(0); }
const vapid = await readSealed(key, 'vapid.enc.json', null);
webpush.setVapidDetails('mailto:noreply@example.com', vapid.publicKey, vapid.privateKey);
try {
  await webpush.sendNotification(push.subscription, JSON.stringify({ type: 'daily' }), { TTL: 6 * 3600, urgency: 'normal' });
  console.log('通知を送りました');
} catch (e) {
  console.error('通知を送れませんでした', e.statusCode, e.body);
  if (e.statusCode === 404 || e.statusCode === 410) console.error('iPhoneのアプリの設定で、通知をもう一度オンにしてください');
  process.exit(1);
}
