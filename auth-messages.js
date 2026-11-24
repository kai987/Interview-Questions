// Present actionable Japanese messages without exposing raw provider errors,
 // credentials, account-existence checks, or internal service information.
const titles = {
  password: 'ログインできませんでした',
  magic: 'ログインリンクを送信できませんでした',
  reset: '再設定メールを送信できませんでした',
  update: 'パスワードを更新できませんでした'
};

export function authErrorNotice(error, action) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const status = Number(error?.status);
  const message = typeof error?.message === 'string' ? error.message.trim().toLowerCase() : '';
  const title = titles[action] || '認証処理に失敗しました';
  const mail = action === 'magic' || action === 'reset';
  if (status === 429 || ['over_request_rate_limit', 'over_email_send_rate_limit'].includes(code)) {
    return { title: mail ? 'メールの送信回数が上限に達しました' : 'しばらく時間をおいてください',
      detail: mail ? 'すでに届いたメールもご確認ください。数分おいてから、もう一度お試しください。' : '短時間に何度も操作したため制限されています。数分おいてから、もう一度お試しください。' };
  }
  if (action === 'password' && (['invalid_credentials', 'user_not_found', 'email_not_confirmed', 'user_banned'].includes(code) || (!code && message === 'invalid login credentials'))) {
    return { title, detail: 'メールアドレスとパスワードを確認してください。ブラウザーに保存された古いパスワードが入力されていないかもご確認ください。パスワードが分からない場合は、下の「Magic Linkを送信」または「パスワードを忘れた方」をお試しください。' };
  }
  if (action === 'update' && code === 'same_password') {
    return { title, detail: '現在のパスワードとは異なる新しいパスワードを入力してください。' };
  }
  if (action === 'update' && (code === 'weak_password' || error?.name === 'AuthWeakPasswordError')) {
    return { title, detail: '推測されにくい、より強いパスワードに変更してください。8文字以上で、文字や数字などを組み合わせてください。' };
  }
  if (action === 'update' && ['otp_expired', 'flow_state_expired', 'session_not_found', 'session_expired'].includes(code)) {
    return { title, detail: '再設定の有効期限が切れた可能性があります。新しいパスワード再設定メールをリクエストしてください。' };
  }
  if (error?.name === 'AuthRetryableFetchError' || error?.name === 'TypeError' || status === 0 || [502, 503, 504].includes(status) || ['failed to fetch', 'networkerror when attempting to fetch resource.', 'load failed'].includes(message)) {
    return { title: '接続できませんでした', detail: 'インターネット接続を確認し、少し時間をおいてから、もう一度お試しください。' };
  }
  return { title, detail: mail ? 'メールアドレスと接続を確認し、少し時間をおいてから再度お試しください。' :
    action === 'update' ? '新しいパスワードを確認し、もう一度お試しください。' :
    '接続を確認して、もう一度お試しください。パスワードが分からない場合は、下のログインリンク送信またはパスワード再設定をご利用ください。' };
}
