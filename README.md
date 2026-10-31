# Shadowing

英語のシャドーイング用アプリ（iPhone のホーム画面に追加して使う Web アプリ）。

- メニュー：Chloe Chua／TED／単語帳
- 練習画面：チャプターごと・1文ごとの再生、無限リピート、英文と日本語訳、発音のヒント、WPM で速度設定
- 単語帳：忘却曲線にもとづく復習（1・2・4・7・15・30日後）、毎朝9時の通知
- 動画は YouTube の公式プレーヤーで再生。文字起こしと訳はパスワードで暗号化して保存

## 初期設定（最初の1回だけ）

1. **パスワードを登録**：Settings → Secrets and variables → Actions → New repository secret
   - Name: `SHADOWING_PASSWORD`
   - Secret: 12文字以上のパスワード（アプリのログインにも使う）
2. **GitHub Pages を有効にする**：Settings → Pages → Source を「Deploy from a branch」、Branch を `main` / `(root)` にして Save
3. **動画一覧を作る**：Actions → 「Update catalog」→ Run workflow
4. **iPhone で開く**：Safari で `https://masa-git-code.github.io/shadowing/` を開き、共有ボタン →「ホーム画面に追加」
5. ホーム画面のアイコンから開いてログインし、設定 →「通知をオンにする」

## しくみ

| ファイル | 内容 |
| --- | --- |
| `index.html` `app.js` `style.css` `sw.js` | アプリ本体 |
| `data/meta.json` | 暗号の設定（パスワードは含まない） |
| `data/catalog.enc.json` | 動画一覧（暗号化） |
| `data/videos/*.enc.json` | 練習データ（暗号化） |
| `config/sources.json` | 新着を集めるチャンネル |
| `.github/workflows/` | 一覧の更新、アプリからの依頼の処理、毎朝の通知 |
| `tools/` | 上の処理と、Claude がデータを作るための道具 |
