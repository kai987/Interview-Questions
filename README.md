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
python3 scripts/serve_local.py --port 8000
```

その後 `http://127.0.0.1:8000` を開いてください。ローカルサーバーはGitHub Pages用のLiquidヘッダーを展開します。

## Speech

音声読み上げには Web Speech API (`speechSynthesis`) を利用しています。利用可能な日本語音声はブラウザ・OSに依存します。

## Main files

- `index.html` - ページ構造とセキュリティポリシー
- `bootstrap.js` - Supabase接続、認証、題庫・質問・個人データの読み込み
- `app.js` - 検索、候補表示、音声、テーマ、カテゴリ表示
- `training.js` - ランダム練習、タイマー、掌握度、自分の回答
- `privacy-ui.js` - ログイン保護と学習状態同期
- `library.css` - 題庫切り替えUI

## Guided practice and save recovery

- ランダム練習は逆質問を除く面接質問から最大10問を選び、一問ずつ表示します。自己評価またはスキップで次へ進み、終了後に復習候補を確認できます。
- 「今日の復習」は、模擬面接での最終評価から「まだ」1日、「普通」3日、「自信あり」7日を目安に再出題します。未評価の質問も対象です。
- `sync-store.js` はアカウント別の未同期データを端末に残し、同じ質問の送信を直列化します。失敗時は表示、オンライン復帰・次回起動・再試行時に再送します。
- 「端末保存済み」と「クラウドに保存済み」を分けています。未同期データが残る場合は、明示的なログアウト前に再送します。ブラウザデータの削除や複数端末の同時編集に対する履歴・競合解決機能ではありません。
- 回答例は `answer_variants.short` / `answer_variants.standard` / 既存の `answer`（全文）を切り替えます。30秒・60秒は目安です。逆質問は時間別回答へ変換しません。
- 短縮版はブラウザ音声で読み上げます。録音は、質問と全文のSHA-256が登録値と一致した場合のみ再生します。

2026-09-08 に Supabase migration `interview_practice_variants_and_review` を適用しました（既存RLSを維持）。再構築時に必要な追加列：

2026-09-13 に `add_interview_audio_duration_seconds` を適用し、既存の録音61件へ測定済みの時長を補完しました。`duration_seconds` は生成・アップロード時に音声ハッシュと一緒に登録され、画面は音声をダウンロードせず総時間を表示します。未登録の場合のみ従来のメタデータ読込を使用します。

```sql
alter table public.interview_private_content
  add column if not exists answer_variants jsonb not null default '{}'::jsonb,
  add column if not exists audio_text_hash text;
alter table public.interview_private_content
  add column if not exists duration_seconds numeric(12,6)
  check (duration_seconds > 0 and duration_seconds < 'Infinity'::numeric);
alter table public.interview_user_state
  add column if not exists last_practiced_at timestamptz;
```

個人向けの回答本文・短縮版はSupabaseに保存し、Gitには含めません。

保存処理の回帰テスト：`node --test tests/*.test.mjs`（Node.js 22.18以降）。
