# Interview Questions

面接対策用の質問・回答練習サイトです。

## Features

- 36件の面接質問と日本語の回答例をカテゴリ別に整理
- 7件の逆質問と、その質問を使う意図も収録
- 質問・中国語訳・回答・タグを横断検索
- 検索候補から該当する具体的な問答へ直接ジャンプ
- 各問答をブラウザの日本語音声で読み上げ
- 昼夜モード（設定を localStorage に保存）
- PC / タブレット / スマートフォン対応
- 外部ライブラリ・APIキー不要

## Usage

`index.html` をブラウザで開くだけで利用できます。

ローカルサーバーを使う場合：

```bash
python3 -m http.server 8000
```

その後 `http://localhost:8000` を開いてください。

## Speech

音声読み上げには Web Speech API (`speechSynthesis`) を利用しています。利用可能な日本語音声はブラウザ・OSに依存します。

## Files

- `index.html` - ページ構造
- `styles.css` - レスポンシブUIと昼夜テーマ
- `data-1.js` ～ `data-4.js` - 面接質問・回答データ
- `app.js` - 検索、候補表示、音声、テーマ切替、カテゴリ表示
