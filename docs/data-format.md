# 練習データの形式（Claude 用）

練習データは平文の JSON を作り、`tools/seal-video.mjs` で暗号化して `data/videos/` に置く。
平文はリポジトリに入れない（`work/` は .gitignore 済み）。

```json
{
  "youtubeId": "R1vskiVDwl4",
  "menu": "ted",                       // "ted" か "chloe"
  "title": "Celeste Headlee: 10 ways to have a better conversation",
  "titleJa": "より良い会話をする10の方法",
  "chapters": [
    { "title": "Intro", "titleJa": "はじめに", "from": 0, "to": 5 }   // from/to は sentences の番号（両端を含む）
  ],
  "sentences": [
    {
      "start": 12.3, "end": 15.8,      // 秒。次の文の start と同じでよい
      "en": "What are you going to do about it?",
      "ja": "それについてどうするつもり？",
      "hints": {
        "chunks": "What are you going to do / about it?",   // 意味のかたまりを " / " で区切る
        "linking": ["about‿it"],                            // つながる音
        "reductions": [{ "from": "going to", "to": "gonna" }],
        "stress": ["do", "about"],                          // 強く読む語
        "tip": "t が母音にはさまれるとラ行のように聞こえる（米国英語）"
      },
      "phrases": [ { "text": "do about", "meaning": "〜に対処する", "note": "" } ]  // 単語帳に追加できる表現
    }
  ]
}
```

- 1文ごとに区切る。YouTube の字幕の切れ目はつなぎ直す。時刻は字幕の時刻から取り、文の途中で切れる場合は単語数で按分する。
- チャプターは話題ごと。1つは 30秒〜2分程度。
- `phrases` は句動詞、コロケーション、知っている単語の別の意味など、会議で役立つものを優先（単語帳に載る基本語は避ける）。
- WPM と長さは `seal-video.mjs` が計算する。
