# Interview Questions

面接対策用の質問・回答練習サイトです。

## Architecture

- GitHub Pages: フロントエンドのコードのみを配信
- Supabase `interview_sets`: 会社・職種ごとの題庫
- Supabase `interview_questions`: 質問・中国語訳・表示順
- Supabase `interview_private_content`: ログインユーザー専用の回答例・キーワード・タグ
- Supabase `interview_user_state`: 重点、練習済み、掌握度、自分の回答
- Supabase Auth + Row Level Security: 非公開題庫と個人データへのアクセス制御

面接データはGitHubのJavaScriptファイルへ直接埋め込まず、ページ起動時にSupabaseから読み込みます。

## Features

- 複数の会社・職種の面接題庫を切り替え
- 公開題庫とログインユーザー専用の非公開題庫
- 質問・中国語訳・回答・タグを横断検索
- 日本語回答例とキーワード表示の切り替え
- 面接練習モード、ランダム10問、回答タイマー
- 重点、練習済み、掌握度、自分の回答を保存
- ログイン時に学習状態をSupabaseへ同期
- ブラウザの日本語音声による読み上げ
- 昼夜モード、文字サイズ、レスポンシブUI

## Data flow

```text
GitHub Pages
    ↓
Supabase Auth
    ↓
interview_sets / interview_questions
    ↓
ログイン時のみ interview_private_content / interview_user_state
```

新しい面接題庫を追加する場合、GitHubのソースコードを変更する必要はありません。題庫・質問・個人向け回答をSupabaseへ追加すると、サイトの題庫切り替えに自動的に反映されます。

## Local development

Supabaseへ接続するため、`index.html` を `file://` で直接開くのではなくローカルHTTPサーバーを使用してください。

```bash
python3 -m http.server 8000
```

その後 `http://localhost:8000` を開いてください。

## Speech

音声読み上げには Web Speech API (`speechSynthesis`) を利用しています。利用可能な日本語音声はブラウザ・OSに依存します。

## Main files

- `index.html` - ページ構造とセキュリティポリシー
- `bootstrap.js` - Supabase接続、認証、題庫・質問・個人データの読み込み
- `app.js` - 検索、候補表示、音声、テーマ、カテゴリ表示
- `training.js` - ランダム練習、タイマー、掌握度、自分の回答
- `privacy-ui.js` - ログイン保護と学習状態同期
- `library.css` - 題庫切り替えUI
