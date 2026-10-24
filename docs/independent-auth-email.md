# 認証メールの独立運用

Interview Questionsの発信者名とメール内容を他のアプリから独立させるため、専用のSupabaseプロジェクトを使用します。SMTP、認証メールテンプレート、Site URL、リダイレクト許可リストは、そのプロジェクト内で設定します。

## メールの設定

発信者名は`Interview Questions｜面接練習`です。Gmailを使う場合は、SMTP Hostを`smtp.gmail.com`、Portを`465`とし、Sender email addressとUsernameに使用するGmailアドレスを指定します。専用のGoogleアプリパスワードを作成してPasswordへ入力し、保存します。他のアプリのパスワードは削除・置換しないでください。

SMTPアカウントを同じGmailにしても、Supabaseプロジェクトが別なら発信者名とテンプレートは別に保存されます。送信元メールアドレス自体も分けたい場合は、別の送信アカウントを使用してください。パスワードをソース、テンプレート、ログやチャットに記載しないでください。

カスタムSMTPを有効にしてから、Authentication → Emails → Templatesで次の件名と本文を設定します。件名は[`subjects.json`](../supabase/email-templates/subjects.json)にまとめています。

| Supabaseのテンプレート | 本文 |
| --- | --- |
| Magic link or OTP | [magic-link.html](../supabase/email-templates/magic-link.html) |
| Reset password | [reset-password.html](../supabase/email-templates/reset-password.html) |
| Confirm sign up | [confirm-sign-up.html](../supabase/email-templates/confirm-sign-up.html) |
| Invite user | [invite-user.html](../supabase/email-templates/invite-user.html) |
| Change email address | [change-email.html](../supabase/email-templates/change-email.html) |
| Reauthentication | [reauthentication.html](../supabase/email-templates/reauthentication.html) |

リンク式の本文には`{{ .ConfirmationURL }}`を保持します。本人確認コードは`{{ .Token }}`です。トークンを固定URLに埋め込んだり、メール確認を飛ばしてSite URLへ直接リンクしたりしないでください。任意のセキュリティ通知を有効にする場合も、専用の件名・本文を設定します。

Site URLと本番リダイレクト許可先は`https://kai987.github.io/Interview-Questions/`です。ローカル開発のURLは必要なものだけ別途登録します。別アプリのURLをコピーしないでください。

## 移行と切り替え

新プロジェクトは認証ユーザー、テーブル、Storageも独立しています。接続先だけを変更すると、既存の個人回答や録音を読み込めなくなります。

1. 元プロジェクトの対象アカウント、4つの`interview_*`テーブル、対象の音声オブジェクト一覧を非公開の場所にバックアップします。元の題庫と録音は残します。
2. 空の移行先に[`schema.sql`](../supabase/schema.sql)を適用します。RLSを維持し、匿名ユーザーは公開題庫・質問の参照だけを許可します。
3. 対象アカウントを移行し、所有者IDと個人データの関係を維持します。ユーザーIDが変わる場合は、音声パスと端末内のアカウント別データも対応付けます。旧セッションは新プロジェクトで利用できません。
4. 題庫・質問・個人回答・学習状態を移行します。音声のバケットは非公開、上限20 MiB、許可MIMEは`audio/mpeg`とします。ファイルはStorage APIで転送し、メタデータ行のコピーだけで済ませないでください。
5. 件数と内容、回答別の音声ハッシュ・時長・ファイル実体を照合し、別ユーザーと匿名アクセスの拒否を確認します。
6. 専用SMTPでログインメールとパスワード再設定メールを実際に受信し、件名、発信者名、遷移先と画面の操作を確認します。送信APIの成功だけで完了と判断しないでください。
7. `bootstrap.js`、`audio-player.js`、`index.html`のCSP、音声スクリプトの接続先をまとめて切り替えます。ブラウザにはpublishable keyだけを使用します。新プロジェクト用に音声スクリプトのセッションも再取得します。
8. 非公開題庫、全回答版、音声再生、学習記録の保存を確認してから公開します。未同期の端末データがある場合は、移行直前の同期と最終差分の転送を行います。

移行のバックアップと検証記録は非公開の場所に保存します。元プロジェクトは、他のアプリの運用と切り戻しのために残します。転送専用の一時エンドポイントを使用した場合は、転送後に閉じ、認証情報を無効化します。

## パスワードを忘れた場合

ログイン画面でメールアドレスを入力し、「パスワードを忘れた方」を押します。受信したメールのリンクを開くと「パスワードの再設定」が表示されます。8文字以上の新しいパスワードを2回入力して保存してください。新しいパスワードの入力と保存は本人が行います。

再設定画面は、Supabaseから`PASSWORD_RECOVERY`イベントを受け取った対象アカウントにのみ表示します。URLの文字列だけでは表示しません。リンクの期限が切れた場合は、再設定メールを再送してください。

## 参照

- [Supabase: Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase: Email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase: Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Google: アプリパスワード](https://support.google.com/mail/answer/185833)
