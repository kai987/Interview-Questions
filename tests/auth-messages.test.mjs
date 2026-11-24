import test from 'node:test';
import assert from 'node:assert/strict';
import { authErrorNotice } from '../auth-messages.js';

test('invalid credential notices are generic, Japanese and actionable', () => {
  const invalid = authErrorNotice({ code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' }, 'password');
  assert.match(invalid.title, /ログインできませんでした/);
  for (const text of ['メールアドレス', 'パスワード', 'Magic Linkを送信', 'パスワードを忘れた方']) assert.ok(invalid.detail.includes(text));
  for (const code of ['user_not_found', 'email_not_confirmed', 'user_banned']) {
    assert.deepEqual(authErrorNotice({ code }, 'password'), invalid);
  }
  assert.deepEqual(authErrorNotice({ message: 'Invalid login credentials' }, 'password'), invalid);
});

test('rate limits, network failures and recovery errors get specific safe messages', () => {
  assert.match(authErrorNotice({ code: 'over_email_send_rate_limit' }, 'magic').title, /送信回数/);
  assert.match(authErrorNotice({ status: 429 }, 'password').title, /時間/);
  assert.match(authErrorNotice(new TypeError('Failed to fetch'), 'password').title, /接続/);
  assert.match(authErrorNotice({ code: 'weak_password' }, 'update').detail, /強いパスワード/);
  assert.match(authErrorNotice({ code: 'same_password' }, 'update').detail, /異なる/);
  assert.match(authErrorNotice({ code: 'session_not_found' }, 'update').detail, /有効期限/);
  for (const action of ['password', 'magic', 'reset', 'update']) {
    assert.doesNotMatch(JSON.stringify(authErrorNotice({ message: 'PRIVATE RAW PROVIDER MESSAGE' }, action)), /PRIVATE RAW PROVIDER MESSAGE/);
  }
});
