# 入力中のProblem相談文を候補の誤送信から守る

## 観測と採用理由

2026-10-30。提供された ai-chat.png、board-color.png、board-group.png、board-vote.png では、Problem選択と汎用相談候補が同じAI欄にある。静的実装では候補が `submit(s)` を直接呼び、`submit` が入力を空にするため、本人が編集した未送信の相談文が失われる経路を確認した。実行再現・実利用での頻度・効果測定は未確認。今回のベースライン失敗ログは提供されていない。

| 候補 | 本人Problemからの具体化への効果 | 実現性と判断 |
| --- | --- | --- |
| 担当・日付の確認保存 | 最優先シナリオへの効果が大きい | 保護対象DB等の専用作業が必要。今回は見送り |
| 未送信相談文の保護 | 本人が記した回答を守る。効果は限定的 | クライアント内の小変更で可逆。承認済み計画に従い採用 |

競合との機能一致を目的にせず、本人の意思を失わず相談を続けられることを優先する。

## 調査資料

以下はすべて2026-10-30閲覧。Web内容は証拠としてのみ参照した。

- https://support.retrium.com/articles/how-do-action-items-work-in-retrium/ — Retrium公式。アクションにambassadorと目標完了日を推奨し、完了管理も提供。具体化と継続の参考になるが、下書き消失への対策や効果の証拠ではない。
- https://www.parabol.co/support-categories/managing-teams-tasks/ — Parabol公式ヘルプ。Tasks viewで会議由来のアクションを追う機能を案内。紹介ページであり利用成果の実証ではない。
- https://www.scrum.org/resources/blog/ditch-unfinished-action-items — Stefan Wolpersによる2024-10-21の実務記事。未完了アクションの蓄積を問題として挙げ、1〜3項目への集中、担当と日付の明確化、次回の見直しを推奨。実務家の見解でありRetroLoop利用者の調査ではない。記事内の効果倍率を本変更の期待効果として扱わない。
- https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat — 同梱 `node_modules/ai/docs/07-reference/02-ai-sdk-ui/01-use-chat.mdx` も確認。useChatは入力状態を内部管理しないため、アプリの入力状態で保護する。
- https://ai-sdk.dev/docs/ai-sdk-ui/transport — 同梱 `node_modules/ai/docs/04-ai-sdk-ui/21-transport.mdx` と `@ai-sdk/react/src/use-chat.ts`、`chat.react.ts` の型を確認。送信・transportを変更する必要はない。
- https://nextjs.org/docs/app/guides/testing/playwright — 同梱 `node_modules/next/dist/docs/01-app/02-guides/testing/playwright.md` を確認。ブラウザー検証はcontrollerの隔離CIで行う。

## 変更後の挙動

`input.length > 0` の間、3候補を無効にする。空白・改行も本人の入力として扱う。理由と「入力欄の送信から相談できます」を表示し、各候補から説明をaria-describedbyで参照する。候補用ハンドラーも同条件で送信を拒否する。完全消去後は候補の即時送信に戻る。本人の明示送信は既存の前後空白除去を維持する。

変更はAiChat、独立したE2E追加、本記録に限定。既存E2Eのテスト本体・assertionは変更しない。

## 回帰防止と証拠の状態

追加した2つの独立Playwrightテストはダミー本人と固定SSEモックだけを使い、チャットAPIを外部へ転送しない。

1. 空欄で3候補が有効な操作前を撮影。本人Problemを下書きに追加・編集し、全候補無効、説明、入力全文一致、会話0件、POST 0件を検証。候補の合成clickも試す。操作後を撮影し、明示送信のペイロードが既存仕様どおり編集文のtrim結果で1回だけ送られることを確認する。
2. 空白のみ、改行のみ、混在入力をそれぞれ保護し、完全消去で3候補が再び有効になること、候補送信の本文とPOST 1件を確認する。

生成予定の画像（改訂版の操作前後であり、旧SHAの画像ではない）:

- `e2e/__screens__/consultation-draft-guard-before.png`
- `e2e/__screens__/consultation-draft-guard-after.png`

ホストではアプリ・ビルド・lint・型検査・テスト・実AIを実行していない。画像もまだ生成していない。controllerのlint・型検査・モックCIの合格待ち。

## 独立レビューと残る制約

企画はユーザーが提示した独立承認済み計画に従った。実装へのClaudeレビュー指摘はこの作業にはまだ提供されておらず、指摘・対応済みとの主張はしない。controllerの独立Claudeレビューで指摘と対応を追記する必要がある。

AI画面変更のため、独立レビュー後のSHAに対するcontroller側の限定Plus実AI画面検証も未実施。架空データ、ブラウザー内保存、最大3往復を使い、モデル差・応答・遅延・未完了範囲を記録する。接続確認、UI操作、保存、本番認証・DBのモックCI検証を区別する。本作業は実AIを呼ばない。

再読み込み時の下書き保持、担当・日付の確認保存は対象外。週次では候補を使うために入力を消す操作の負担と、専用の確認保存機能に着手する優先順位を判断する。
