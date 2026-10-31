# 本人Tryの編集・再保存でも改行形式を維持する

対象：2026-10-31 21時 JST の承認済み改善案。小さな可逆変更。

## 観測と選択

添付のai-chat／board-color／board-group／board-vote画面には付箋の編集導線と本人アクション入力がある。ただし画像から改行形式の不具合や入力消失は確認できない。静的には、addNoteがCRLF／CRをLFへ正規化する一方、updateNoteはtrimだけだった。編集フォームもFormDataを送信するため、同じ本文でも編集後に保存形式が変わる可能性がある。ブラウザーでの再現は未実施。

| 候補 | 本人の具体的アクション保存への関係 | 実現性・影響 |
| --- | --- | --- |
| 編集時の改行正規化（採用） | 保存した行動を本人が修正し、再保存する経路を一貫させる | 許可された業務Server Action内の小変更。利用者への影響は限定的で、実害は未実証 |
| 未保存入力の再読み込み警告（見送り） | 保存前の入力消失を防ぐ可能性 | 今回はクライアント変更の許可根拠がなく、観測された消失事例もない |

競合と同じ機能を増やすことを目的にせず、承認済みの①だけを実装した。

## 調査（アクセス日：2026-10-31）

- https://support.retrium.com/articles/how-do-action-items-work-in-retrium/ ：行動本文、担当役、目標完了日を指定し、完了を記録できる。具体的アクションを残す優先方針の参考。
- https://www.parabol.co/resources/retrospective-meetings/ ：議論からアクションを作り、タスクをダッシュボードや次回Check-Inへつなげる。保存後に再確認できることの参考。
- https://www.retrium.com/ultimate-guide-to-agile-retrospectives/the-one-about-follow-through ：実践ガイドは適切な行動選択、担当役の引受け、継続的な進捗確認を扱う。実践者向けの課題整理であり、ベンダー発信の限界がある。RetroLoop利用者の観測、独立した利用者調査、改行修正の効果の証拠ではない。インタビュー・利用指標は収集していない。
- https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#multipart-form-data ：承認案のフォーム改行に関する技術参照先。今回の取得はタイムアウト。取得できた資料としては扱わない。
- https://nextjs.org/docs/app/getting-started/updating-data ：承認案の参照先は今回404。同梱の `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md` を確認し、フォームのServer Action呼出し、認証・認可要件を確認した。
- 同梱 `ai/docs/04-ai-sdk-ui/02-chatbot.mdx`、`ai/dist/index.d.ts` のUIMessage、`@ai-sdk/react/dist/index.d.ts` のuseChatも静的確認。SDKの実行はしていない。

## 変更と回帰防止

updateNoteにもaddNoteと同じ `replace(/\r\n?/g, "\n").trim()` を適用。認証・チーム所属を含む更新条件、再検証、AI・費用境界は既存のまま。既存データの一括更新はしない。共通の付箋更新処理なのでKeep／Problemの編集にも同じ正規化が適用される。

独立した `e2e/own-try-edit-newlines.spec.ts` を追加。本人Tryの確認・保存から始め、通常の編集UIで空行を含む行動へ修正し、DB本文の完全一致とCR不在、作成者、Try種別、所属ふりかえりを検証する。担当・日付は本文の完全一致で確認し、再読み込み後はtextContentの完全一致で空行も確認する。その後の単一行編集・再保存・再表示も検証する。既存specの本文・アサーションは変更しない。

候補版で生成するPNG：

- `e2e/__screens__/own-try-edit-newlines-input.png`（編集入力）
- `e2e/__screens__/own-try-edit-newlines-reloaded.png`（再保存後の再表示）

これらは製品の修正前後の比較ではなく、同じ候補版内の操作前後。画像ではCRLF差を証明できないため、DB完全一致が主証拠。

## 検証・独立レビューと残る制約

ホストではアプリ、ビルド、テスト、SDKを実行していない。現時点の検証は静的な差分確認のみで、ランタイム成功は未確認。AI画面・プロンプト・共有部品の変更はなく、実AI呼出しも行っていない。

コントローラーでの予定：同一の独立specを実装前SHA `e93be8103c29198be64026fdde4c919a6f3d69c5` と独立レビュー後の候補SHAへ別々に適用し、使い捨てDBとモックAIのCIで実行する。旧SHAで正規化アサーションが失敗し、候補版で成功するかを記録する。旧版用フラグ・条件分岐は追加していない。再現しなければ不具合修正を実証済みとせず、採否を再検討する。

企画はユーザー提示の独立承認済み案に従う。Claudeの具体的な指摘文は提示されていないため捏造しない。実装SHAへのClaude独立レビュー、指摘・対応、およびCIの旧版／候補版結果はコントローラーによる追記待ち。

週次判断：DB改行形式の差が実際に再現したか、利用者への影響の小ささに見合う改善だったかを確認する。次は本人Problemから具体的アクションへ至る優先シナリオのどこに実証された障害があるかを判断する。
