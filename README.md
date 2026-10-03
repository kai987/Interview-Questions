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
- AivisSpeech録音の再生・一時停止・位置指定と、ブラウザの日本語音声
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

登録済みのAivisSpeech録音を優先して再生します。15秒以内に読み込めない場合やログイン・録音の問題がある場合は、理由と「録音を再試行」を表示します。読み込み中の再クリックや回答切り替えではダウンロードも中断します。

録音を利用できない場合は「ブラウザ音声で読む」を選べます。Web Speech API (`speechSynthesis`) の日本語音声はブラウザ・OSに依存し、事前の実測時長や位置指定には対応しません。

## Main files

- `index.html` - ページ構造とセキュリティポリシー
- `bootstrap.js` - Supabase接続、認証、題庫・質問・個人データの読み込み
- `app.js` - 検索、候補表示、音声、テーマ、カテゴリ表示
- `training.js` - ランダム練習、タイマー、掌握度、自分の回答
- `privacy-ui.js` - ログイン保護と学習状態同期
- `sync-store.js` - アカウント・質問・変更単位の未同期キュー
- `state-migration.js` - 旧端末データの安全な移行
- `practice-session-store.js` - アカウント・題庫ごとの模擬面接の進行保存
- `ui-controls.css` - 表示切り替え・分段ボタン・回答時長表示の共通スタイル
- `library.css` - 題庫切り替えUI

## Guided practice and save recovery

- ランダム練習は逆質問を除く面接質問から最大10問を選び、一問ずつ表示します。自己評価またはスキップで次へ進み、終了後に復習候補を確認できます。
- 進行中の題目順・現在の質問・自己評価をアカウントと題庫ごとに端末へ保存します。再読込後は「前回の続きから」で再開でき、タイマーと音声は自動再生しません。検索やカテゴリ移動では進行を残し、明示的な終了・全問完了で消去します。学習状態の読み込みに失敗した場合は、再読み込みに成功してから再開できます。
- 「今日の復習」は、模擬面接での最終評価から「まだ」1日、「普通」3日、「自信あり」7日を目安に再出題します。未評価の質問も対象です。
- `sync-store.js` はアカウント・質問・変更単位で未同期データを端末に残します。変更したフィールドだけを送信し、対応ブラウザでは Web Locks によって同じ質問の送信を複数タブ間でも直列化します。失敗時は表示、オンライン復帰・次回起動・再試行時に再送します。旧形式のキューは保存に成功してから切り替えます。
- 旧端末データの移行も同じ未同期キューを使います。クラウドに一部の質問だけがある場合も、残りの端末回答・復習日時を保持し、既存のクラウドデータと新しい編集を優先します。
- UIキャッシュの書き込みに失敗しても、今回の入力値を直接同期キューへ渡します。ほかの題庫に残る未移行の草稿は、現在の題庫のキャッシュ更新で消去しません。別タブでログイン・アカウント切り替えが起きたときだけ再初期化し、同じアカウントのトークン更新では練習を中断しません。
- Web Locks が利用できないブラウザでも端末の未同期記録は個別に保持しますが、複数タブからの送信順序は保証しません。同じフィールドを複数端末から編集した場合の履歴・競合解決機能はありません。
- 「端末保存済み」と「クラウドに保存済み」を分けています。未同期データが残る場合は、明示的なログアウト前に再送します。ブラウザデータの削除や複数端末の同時編集に対する履歴・競合解決機能ではありません。
- 回答例は「結論／標準／深掘り」で `answer_variants.short` / `answer_variants.standard` / `answer_variants.full`（未設定時は既存の `answer`）を切り替えます。各ボタンの時長は質問を含む録音の実測値です。逆質問は時間別回答へ変換しません。
- 短縮版・標準版・全文それぞれの録音と実測時長を使用します。録音は、質問と現在選択中の回答のSHA-256が登録値と一致した場合のみ再生します。同じ本文の版は録音を共用し、未生成の版は「ブラウザ音声で読む」を選んで練習できます。

2026-09-08 に Supabase migration `interview_practice_variants_and_review` を適用しました（既存RLSを維持）。再構築時に必要な追加列：

2026-09-13 に `add_interview_audio_duration_seconds` を適用し、既存の録音61件へ測定済みの時長を補完しました。`duration_seconds` は生成・アップロード時に音声ハッシュと一緒に登録され、画面は音声をダウンロードせず総時間を表示します。

2026-10-03 に `add_private_audio_variants` を適用しました。`audio_variants` は `short` / `standard` / `full` ごとに `audio_text_hash`、`audio_sha256`、実測の `duration_seconds` を保持します。既存の全文フィールドも引き続き読み込みます。録音未登録・本文変更後の旧録音は `--:--` と表示し、推定時間を実測値として表示しません。既存の本人限定RLSは維持します。新しいフロントエンドを配信する前に、この列を追加してください。

```sql
alter table public.interview_private_content
  add column if not exists answer_variants jsonb not null default '{}'::jsonb,
  add column if not exists audio_text_hash text;
alter table public.interview_private_content
  add column if not exists duration_seconds numeric(12,6)
  check (duration_seconds > 0 and duration_seconds < 'Infinity'::numeric);
alter table public.interview_private_content
  add column if not exists audio_variants jsonb not null default '{}'::jsonb
  check (jsonb_typeof(audio_variants) = 'object');
alter table public.interview_user_state
  add column if not exists last_practiced_at timestamptz;
```

個人向けの回答本文・短縮版はSupabaseに保存し、Gitには含めません。

新しいアップロードは `audio_variants` に `object_path` も記録します。音声バイトのSHAを含む別ファイルを作成し、アップロード後に全バイトを検証してから参照を切り替えます。既存の録音は上書きしません。途中で失敗した場合は `--upload-only` で再開でき、すでに存在するファイルもバイト検証後に再利用します。旧ファイル名も引き続き再生できます。新形式で録音を登録する前に、対応フロントエンドを配信してください。

`supabase/migrations/20261003133053_version_interview_audio_updates.sql` は既存テーブル向けの追加migrationです。回答データの更新時と質問文の変更時に `updated_at` を進め、アップロード後の登録時に同時変更を検出します。衝突時は最新情報を読み直し、ほかの回答版を保ったまま最大3回再試行します。本文が変わっていれば登録を停止します。既存テーブルのRLSは変更せず、トリガーは呼び出し元の権限で実行します。`tests/sql/audio-versioning.sql` で版の更新と衝突拒否を確認できます（検証用の変更はロールバックされます）。

題庫の読込失敗は「題庫がない」状態と分けて表示します。個人データだけの失敗時は質問を残し、学習状態を再読み込みするまで保存操作を無効にします。「再読み込み」で再試行できます。

重点・練習済みの切り替えはカードを作り直さず、開閉状態と音声操作を維持します。回答タイマーは終了後に `00:00` を保持し、バックグラウンドから戻った場合も経過時間で補正します。

## Regression tests

Node.js 24、Python 3、MP3検証用の `ffmpeg` / `ffprobe` を使用します。

```bash
npm ci
npx playwright install chromium firefox webkit
npm test
npm run test:python
npm run test:e2e
```

- Node: 複数タブの未同期キュー、送信競合、旧データ移行、端末保存失敗、模擬面接の進行保存・範囲検証。
- Python: 音声時長の測定とアップロード用メタデータ。
- Playwright: ChromiumのPC・スマートフォン幅でボタン、スクロール、タイマー、同期、認証、音声復旧、練習の再開を検証します。FirefoxとWebKitでも、ネイティブ操作や時長・色・レイアウトの主要な回帰を確認します。
- ブラウザテストは合成の題庫・回答・音声とモックAPIを使用し、実際のアカウントやクラウドデータを変更しません。スクリーンショット・トレースはOSの一時フォルダへ出力します。
- `.github/workflows/tests.yml` が push / pull request 時に同じ検証を実行します。
