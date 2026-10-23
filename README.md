# Interview Questions

日本語面接に向けて、質問と回答例を会社・職種ごとに整理し、音声練習・模擬面接・復習を行うWebアプリです。

**[サイトを開く](https://kai987.github.io/Interview-Questions/)** · [テストの実行状況](https://github.com/kai987/Interview-Questions/actions/workflows/tests.yml) · [MITライセンス](LICENSE)

公開題庫はログインせずに閲覧できます。非公開題庫・個人向け回答・学習状態のクラウド保存には、登録済みアカウントでのログインが必要です。公開題庫がない場合は、ログインするまで質問が表示されません。

## 主な機能

| 機能 | 内容 |
| --- | --- |
| 会社・職種別の題庫 | 公開題庫と、自分のアカウントで利用できる非公開題庫を切り替え |
| 検索・絞り込み | 質問、日本語回答、中国語訳、タグの横断検索とカテゴリ表示 |
| 回答例の切り替え | 登録済みの「結論・標準・深掘り」と、全文・キーワード表示を切り替え |
| 音声練習 | AivisSpeech録音の再生・一時停止・続きからの再開・再生位置の調整 |
| 再生時間の表示 | 再生前から総時間を表示し、再生中は「現在の時間 / 総時間」を更新 |
| 模擬面接 | 逆質問を除く最大10問を出題。重点・未練習・今日の復習からも選択可能 |
| 回答タイマー | 30秒・60秒・90秒を選んで、自分の回答を練習 |
| 学習記録 | 重点、練習済み、習熟度、自分の回答、最終練習日時を保存・同期 |
| 続きから練習 | アカウントと題庫ごとに模擬面接の進行を端末へ保存 |
| 表示設定 | 昼夜モード、文字サイズ、中国語ヒント、PC・スマートフォン向けレイアウト |

回答版や録音が未登録の質問では、利用できる内容だけを表示します。音声の総時間は**質問を含む録音の実測値**です。自分で回答する際の目標時間とは異なります。

## 使い方

1. 題庫を選び、検索やカテゴリで練習したい質問を探します。
2. 回答例とキーワードを確認し、登録されている場合は「結論・標準・深掘り」を切り替えます。
3. 「音声で練習」で録音を聞き、タイマーを使って自分でも答えます。
4. 重点・練習済み・習熟度や、自分の回答を記録します。
5. 「10問出題」で模擬面接を行い、復習候補を確認します。

「今日の復習」は、模擬面接での最終評価から「まだ」は1日、「普通」は3日、「自信あり」は7日を目安に出題します。未評価の質問も対象です。

進行中の模擬面接は、再読み込み後に「前回の続きから」で再開できます。再開時にタイマーや音声が自動で動き出すことはありません。

## 技術構成とデータの保存先

フロントエンドはHTML・CSS・JavaScriptで構成し、GitHub Pagesで配信しています。画面表示にビルド処理は不要です。題庫や個人データは、起動時にSupabaseから読み込みます。

| 保存先・技術 | 役割 |
| --- | --- |
| GitHub Pages | 画面、スタイル、JavaScript、アイコンの配信 |
| Supabase Auth | 登録済みアカウントの認証 |
| `interview_sets` | 会社・職種ごとの題庫と公開範囲 |
| `interview_questions` | 質問、中国語訳、カテゴリ、表示順 |
| `interview_private_content` | 個人向け回答、キーワード、タグ、回答版、音声メタデータ |
| `interview_user_state` | 重点、練習済み、習熟度、自分の回答、練習日時 |
| Supabase Storage | 本人限定のMP3録音（`interview-audio`バケット） |
| AivisSpeech・FFmpeg | ローカルでの音声合成とMP3変換・時長測定 |
| Playwright・Node.js・Python | 表示、操作、保存、音声関連処理の回帰テスト |

題庫や質問を追加する際は、既存のデータ構造に合わせてSupabaseへ登録します。会社ごとの内容をJavaScriptへ埋め込む必要はありません。

### 個人データと同期

- 非公開題庫・個人向け回答・学習記録は、認証とRow Level Security（RLS）でアクセスを制限します。
- 個人回答、生成音声、認証セッションを公開Gitへ含めません。`local-audio/`、`.env`、依存パッケージ、キャッシュ類はGit管理対象外です。
- 画面は「端末保存済み」と「クラウドに保存済み」を分けて表示します。未同期の変更は端末に残し、オンライン復帰・次回起動・手動再試行で再送します。
- 同じアカウントの認証トークン更新では練習を中断せず、アカウントが変わった場合はデータを読み直します。
- 旧形式の端末データは、既存のクラウドデータと新しい編集を優先しながら移行します。

同期は変更したフィールド単位で行い、対応ブラウザではWeb Locksを使って複数タブからの送信を直列化します。複数端末で同じ項目を編集した場合の履歴管理・競合解決や、ブラウザデータを削除した際の復元機能はありません。

## ローカル開発

### 画面を起動する

Python 3とインターネット接続を用意します。

```bash
git clone https://github.com/kai987/Interview-Questions.git
cd Interview-Questions
python3 scripts/serve_local.py --port 8000
```

ブラウザで **<http://127.0.0.1:8000>** を開いてください。

ローカルサーバーは、GitHub Pages向けのLiquidヘッダーとアセットのバージョン表記を展開します。`index.html`を`file://`で直接開く方法では動作しません。画面の起動だけなら、npmパッケージやAivisSpeechのインストールは不要です。

現在のコードは既存のSupabaseプロジェクトへ接続します。非公開データの利用には、その環境の登録済みアカウントが必要です。

### 自分のSupabase環境へ接続する

フォーク先で独立して運用する場合は、次の設定が必要です。

1. Supabase側で題庫・質問・個人回答・学習状態のテーブル、認証、RLSを用意します。録音を使う場合は非公開の`interview-audio`バケットも設定します。
2. `bootstrap.js`と`audio-player.js`のプロジェクトURL・publishable keyなどの接続設定を、自分の環境に合わせます。
3. `index.html`のContent Security Policyにある接続先と、Supabase Authの許可リダイレクト先を合わせます。
4. 題庫・質問・回答を登録し、公開・非公開それぞれのアクセスを確認します。

フロントエンドの接続設定はソース内に定義されており、`.env`から自動で読み込む構成ではありません。ブラウザにはpublishable keyを使用し、`service_role`などの秘密鍵を含めないでください。

このリポジトリのmigrationは**既存テーブル向けの追加変更**です。データベース全体を新規構築する一式ではありません。

## 音声の生成と管理

録音は、選択中の回答と一致するものを優先して再生します。

- ローカル開発では`local-audio/<set-slug>/`を確認し、利用できなければログイン中のアカウントで非公開Storageへ接続します。
- 質問と回答の本文ハッシュを確認し、音声ファイルのSHA-256が登録されている場合は再生時に照合します。
- 「結論・標準・深掘り」はそれぞれの録音と実測時長を持ち、同じ本文の版は録音を共用できます。
- MP3の時長は生成・アップロード時に測定して保存します。録音未登録・本文変更後の旧録音には`--:--`を表示します。
- 新しいアップロードは本文と音声バイトのハッシュを含む別オブジェクトとして保存し、全バイトの検証後に参照を切り替えます。
- 読み込みに失敗した場合は理由と「録音を再試行」を表示します。読み込み中の再クリックや回答切り替えではダウンロードを中断します。

録音を使えない場合は「ブラウザ音声で読む」を選べます。Web Speech APIの音声はブラウザ・OSに依存し、事前の実測時長や再生位置の指定には対応していません。

音声生成には、起動中のAivisSpeechエンジンとFFmpeg／ffprobeを使用します。生成、セッションの取り込み、再アップロードの手順は[ローカル音声生成ガイド](AIVIS_LOCAL_AUDIO.md)を参照してください。

`local-audio/`はローカル再生と再アップロードにも使います。整理する際は、現在の参照先とファイルのハッシュを確認し、必要な音声と`manifest.json`を残してください。

## 主なファイル

| ファイル・ディレクトリ | 役割 |
| --- | --- |
| `index.html` | ページ構造、アイコン、セキュリティポリシー |
| `bootstrap.js` | 認証、題庫・質問・個人データの読み込み |
| `app.js` | 質問カード、検索、カテゴリ、テーマ |
| `answer-variants.js` | 回答版の選択、本文と時長表示の同期 |
| `audio-player.js` | 録音の検証・再生、ブラウザ音声、進捗表示 |
| `training.js` | 模擬面接、回答タイマー、習熟度、自分の回答 |
| `practice-session-store.js` | アカウント・題庫ごとの練習進行の保存 |
| `sync-store.js` / `privacy-ui.js` | 学習状態の同期、未同期キュー、保存状態の表示 |
| `state-migration.js` | 旧端末データの移行 |
| `styles.css` / `ui-*.css` / `auth.css` / `library.css` | 画面、学習操作、認証、題庫選択のスタイル |
| `scripts/` | ローカルサーバー、音声生成、時長補完 |
| `supabase/migrations/` | 既存DBへの追加migration |
| `tests/` | Node.js・Python・ブラウザ・SQLの回帰検査 |
| `docs/` | 題庫の参考資料と回答作成・検証の手順 |

## テスト

CIではNode.js 24、Python 3.13、FFmpeg／ffprobeを使用します。ローカルでも同等の環境を用意してください。

```bash
npm ci
npx playwright install chromium firefox webkit
npm test
npm run test:python
npm run test:e2e
```

| コマンド | 検査対象 |
| --- | --- |
| `npm test` | 未同期キュー、データ移行、模擬面接の進行保存 |
| `npm run test:python` | 音声の時長測定、回答版、アップロード用メタデータ |
| `npm run test:e2e` | PC・スマートフォン表示、認証、検索、練習、保存、音声操作 |

ブラウザテストはChromiumのPC・スマートフォン構成に加え、主要な操作をFirefox・WebKitでも確認します。合成データとモックAPIを使い、実際のアカウントやクラウドデータは変更しません。失敗時のスクリーンショットとトレースはOSの一時フォルダへ出力します。

[GitHub Actions](.github/workflows/tests.yml)でも、push・pull request時に同じ検査を実行します。

## 公開方法

GitHub Pagesは`main`ブランチのルートから、GitHub標準のJekyllパイプラインで公開します。`index.html`と`bootstrap.js`のfront matterを維持してください。

CSS・JavaScriptのURLにはビルド時のコミットSHAが付き、動的importにも同じ値を使用します。手動でバージョン番号を上げる必要はありません。詳細は[アセットキャッシュの更新方式](CACHE_BUSTING.md)を参照してください。

## 関連ドキュメント

- [ローカル音声生成ガイド](AIVIS_LOCAL_AUDIO.md)：AivisSpeechでのMP3生成、認証セッションの取り込み、アップロード、時長補完。
- [アセットキャッシュの更新方式](CACHE_BUSTING.md)：GitHub Pagesでのアセットのバージョン管理。
- [Micron Production DX Engineer（JR88130）面接35問](docs/micron-production-dx-jr88130-interview.md)：非公式の面接体験談17問と職種特化18問の参考資料。現在の題庫・個人回答はSupabaseで管理します。
- [面接回答の品質ゲート](docs/interview-answer-quality-gate.md)：回答の構成、具体例・根拠、個人回答の保護、反映後の確認手順。

## 既存環境向けのスキーマ補足

回答版と音声メタデータには、次の列を使用します。既存テーブルへの追加例であり、テーブル作成やRLS設定は含みません。

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

`audio_variants`には版ごとの本文ハッシュ、音声SHA-256、実測時長、必要に応じて`object_path`を保存します。旧録音向けのフラットフィールドも引き続き読み込みます。

[音声更新のバージョン管理migration](supabase/migrations/20261003133053_version_interview_audio_updates.sql)は、回答更新時と質問文変更時に`updated_at`を進め、音声登録時の同時変更を検出します。本文が変わっている場合は登録を停止します。[SQL検査](tests/sql/audio-versioning.sql)では検証用の変更をロールバックして確認します。

## ライセンス

[MIT License](LICENSE)
