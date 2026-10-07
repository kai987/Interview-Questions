# 面接回答の品質ゲート（題庫追加・改稿用）

新しい会社・職種の面接題庫を追加するとき、**質問数と回答数だけの確認を完了条件にしない**。回答は実際に口頭で使えることを基準に検査する。

## 3段階回答の役割

| 版 | 目的 | 目安（実測ではない） |
| --- | --- | --- |
| `short`（結論） | 主要結論と背景を簡潔に伝える | 15～30秒 |
| `standard`（標準） | 面接の一次回答として、本人の行動・具体例・結果まで説明 | 45～80秒 |
| `full`（深掘り） | STAR・技術判断・トレードオフ・検証内容などを補足 | 80～150秒 |

時間は話す速度で変わる。**音声録音の実測時間として扱わない**。年収・入社時期・逆質問などは無理に長くしない。

## 内容チェック

1. **実務／大学院／個人開発／想定提案を区別**する。実験したことと製造現場で実運用したことを混同しない。
2. 『結論 → 背景・具体的な課題 → 自分の役割・行動 → 確認できる成果または学び』を優先し、実績のない数値を作らない。
3. 技術質問はキーワードの羅列で終わらず、具体的なデータ、処理、判断基準、検証方法を説明する。
4. `standard` は `short` の単なる水増しにしない。`full` も `standard` に1文足すだけでは不十分。異なる深さの情報を提供する。
5. **話す回答の本文に、学習者向けのメタ指示を書かない**。『ここは希望額を置き換える』『面接前に準備する』などは `outline` へ記録する。
6. 不明な希望年収、退職の細かな事情、未確認の改善率は、本人確認待ちと明記する。

## DB反映のチェックリスト

- 本人限定回答は `interview_private_content` に保存し、公開Gitへ個人用回答を掲載しない。
- `answer` と `answer_variants.standard` を同期する。
- `short`、`standard`、`full` が全て存在し、内容と長さが異なることを確認する。
- 対象の `set_id`、`user_id`、既存データの更新時刻を確認し、他社の回答を上書きしない。
- `interview_user_state` と既存の学習記録を変更しない。
- 録音があれば本文のハッシュ不一致時は再生不可となる点を確認し、再録音が必要なら別の作業として扱う。
- 行数や文字数の検査に加え、**最低5件を意味・一貫性・日本語の自然さで抜き取り確認**する。退職理由、成功・失敗、技術的な弱点、志望動機は特に重点確認。

## 読み取り専用のQA例

```sql
select
  count(*) as question_count,
  count(*) filter (where answer_variants ? 'short'
                       and answer_variants ? 'standard'
                       and answer_variants ? 'full') as versioned,
  count(*) filter (where answer = answer_variants->>'standard') as default_synced,
  round(avg(char_length(answer_variants->>'short'))) as avg_short_chars,
  round(avg(char_length(answer_variants->>'standard'))) as avg_standard_chars,
  round(avg(char_length(answer_variants->>'full'))) as avg_full_chars
from public.interview_private_content
where question_id in (
  select q.id
  from public.interview_questions q
  join public.interview_sets s on s.id = q.set_id
  where s.slug = 'micron-japan-production-dx-jr88130'
);
```

**注**：文字数は品質検査の補助指標であり、話せる内容の質を保証するものではない。上記SQLは閲覧権限のあるアカウントで実行する。

## 2026-10-08 Micron題庫の是正記録

初回は35件すべてに回答が存在することだけを確認し、`standard` / `full` の内容が薄いまま公開に反映してしまった。

35件すべての日本語回答を再点検し、実際の職歴・大学院・個人開発を用いて説明を補充した。3段階の内容を区別し、読上げる回答と学習用メモを分離して修正。

検証結果：**35/35件に3バージョン、`answer` と `standard` の同期35/35件、平均約95 / 354 / 538文字**（結論／標準／深掘り、計測時点の値）。保存済みの他社題庫の質問数は変更していない。これはDB検証であり、ログインしたブラウザの表示・音声を実機検証したものではない。
