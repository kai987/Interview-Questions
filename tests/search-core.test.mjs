import assert from 'node:assert/strict';
import test from 'node:test';
import { normalize, matches, highlight } from '../search-core.js';

test('search covers every answer version, legacy answer, outline, tags and both question languages', () => {
  const item = {
    question: '日本語質問専用', questionZh: '中文问题专用', answer: '旧回答専用',
    answerVariants: { short: '結論専用', standard: '標準専用', full: '深掘り専用', future: '追加版専用' },
    outline: '提綱専用 → 具体例', tags: ['タグ専用']
  };
  for (const query of ['日本語質問専用', '中文问题专用', '旧回答専用', '結論専用', '標準専用', '深掘り専用', '追加版専用', '提綱専用', 'タグ専用']) {
    assert.equal(matches(item, query), true, query);
  }
  assert.equal(matches(item, '存在しない語'), false);
  assert.equal(matches({ question: item.question, answer: '' }, '深掘り専用'), false);
});

test('normalization agrees across searching and original-text highlighting', () => {
  const text = 'ＡＩ\t  活用と ｶﾞｲﾄﾞ、ﬃ、カ\u3099イド';
  assert.equal(normalize('  ＡＩ\n 活用 '), 'ai 活用');
  for (const query of ['ai 活用', 'ガイド', 'ffi']) assert.equal(matches({ answer: text }, query), true);
  assert.equal(highlight('ＡＩ\t  活用', 'ai 活用'), '<mark>ＡＩ\t  活用</mark>');
  assert.equal(highlight('ｶﾞｲﾄﾞ', 'ガイド'), '<mark>ｶﾞｲﾄﾞ</mark>');
  assert.equal(highlight('カ\u3099イド', 'ガイド'), '<mark>カ\u3099イド</mark>');
  assert.equal(highlight('ﬃ', 'f'), '<mark>ﬃ</mark>');
});

test('highlighting treats query metacharacters literally and escapes original HTML', () => {
  const source = '<img src=x onerror=alert(1)> & A+B [x]';
  assert.equal(highlight(source, 'A+B'), '&lt;img src=x onerror=alert(1)&gt; &amp; <mark>A+B</mark> [x]');
  assert.equal(highlight('&amp; &', '&'), '<mark>&amp;</mark>amp; <mark>&amp;</mark>');
  assert.equal(highlight('<script>', '<script>'), '<mark>&lt;script&gt;</mark>');
  assert.equal(highlight('[x]', '[x]'), '<mark>[x]</mark>');
  assert.equal(highlight('plain', '   '), 'plain');
});

test('highlights preserve full source text and contextual lowercase matches', () => {
  assert.equal(highlight('A😀B', '😀'), 'A<mark>😀</mark>B');
  assert.equal(highlight('ΟΣ', 'ος'), '<mark>ΟΣ</mark>');
  assert.equal(highlight('İ', 'i'), '<mark>İ</mark>');
  assert.equal(highlight(null, 'test'), '');
  assert.equal(matches({ answerVariants: null, tags: null }, 'test'), false);
});
