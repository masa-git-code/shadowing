# Shadowing アプリ（Claude 向けメモ）

Masa さんの英語シャドーイング用 Web アプリ。GitHub Pages で公開し、iPhone のホーム画面から使う。
ビルド不要（index.html / app.js / style.css / sw.js）。データはすべてパスワードで暗号化（AES-GCM、tools/lib/crypto.mjs と app.js の同じ方式）。

## Claude の作業
暗号化には環境変数 `SHADOWING_PASSWORD` が必要（クラウド環境の Secret）。パスワードを会話・ファイル・コミットに書かない。

- 依頼された動画を見る: `node tools/dump.mjs requested`（一覧全体は `node tools/dump.mjs`）
- 文字起こし
  - TED: カタログの `tedUrl`（なければ ted.com で検索）から公式の文字起こしを取る
  - Chloe Chua など YouTube: Masa さんがチャットに貼ったものを `node tools/parse-transcript.mjs pasted.txt` で断片にする（非公式な字幕取得はしない）
- 平文の JSON を `work/` に作る（形式は docs/data-format.md）→ `node tools/seal-video.mjs work/xxx.json`
- `data/videos/*.enc.json` を main に push すると、GitHub Actions が一覧を「練習できる」に更新する
- Teams の表現: `{"items":[{phrase, meaning, example, exampleJa, tip}]}` を作り `node tools/seal-inbox.mjs work/pack.json`。アプリを開くと単語帳に入る
- 平文（work/）は絶対にコミットしない

## GitHub Actions
- Update catalog: 毎週月曜 9:00 JST、data/videos 変更時、手動。新着動画を config/sources.json のチャンネルから集める
- Handle app request: アプリからの Issue（準備の依頼・動画追加・通知登録、中身は暗号化）を処理して閉じる。持ち主の Issue だけ
- Daily review reminder: 毎朝 9:00 JST に Web Push
