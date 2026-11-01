# チャット入力境界の検証

2026-11-01、承認済み計画の実装。変更はRoute Handlerと独立したE2Eの追加に限定する。

## 観測と選択

添付のai-chat、board-color、board-group、board-vote画面には、本人Problemの選択、相談、本人による行動・日付の入力と確認保存がある。静的コードでは、APIがJSONのmessagesをUIMessage[]と宣言するだけで、件数以外の構造検証がなかった。モックは不正な構造でも成功し、実モデル経路だけ変換に失敗する可能性があった。SDKはsystem roleを変換対象にする。実利用の障害件数や改善効果は未確認であり、ベースライン失敗とは断定しない。

候補①入力境界の修復は、相談継続の基盤を守り、許可されたサーバー範囲で小さく完結する。候補②選択Problemの構造化引継ぎは本人の相談への直接性が高いが、クライアント契約変更と広い検証を要する。静的に欠落を確認でき、影響範囲を限定できる①を選んだ。競合の機能一致を目的にしない。

## 調査

以下は2026-11-01閲覧。公式資料と実務ガイドであり、RetroLoop利用者のインタビューや利用指標ではない。

- https://help.teamretro.com/article/181-overview — 議論から担当・期限のあるアクションに進み、過去アクションを確認する流れを説明する。本人の判断を行動へつなぐ参考になるが、入力障害の発生を示さない。
- https://intercom.help/easyretro/en/articles/4993672-how-to-turn-your-cards-into-action-items — カードからアクションへ変換し、必要情報を入力して確定する。本人確認の導線の参考であり、効果測定ではない。
- https://docs.pagerduty.com/ops-guides/retrospectives/after — 進捗がないときは責任追及せず理由を確認し、行動を再定義・明確化する実務上の推奨。相談を継続できる基盤を支える根拠だが、RetroLoopでの課題は仮説にとどまる。
- https://ai-sdk.dev/docs/reference/ai-sdk-core/safe-validate-ui-messages — unknownを非例外形式で検証し、success/data/errorを返す。インストール済みaiの同資料とvalidate-ui-messages.ts、convert-to-model-messages.tsも静的確認した。
- https://ai-sdk.dev/docs/ai-sdk-ui/convert-to-model-messages — UI履歴からモデル形式への変換。静的ソースではURL変換が例外を投げうるため、構造検証後の変換も400へ変換する。
- https://nextjs.org/docs/app/getting-started/route-handlers — Web Request/ResponseによるRoute Handler。実装前にインストール済みNextの対応ガイドを読んだ。@ai-sdk/reactのuse-chat.tsも読み、送受信履歴と中止の型を確認した。

## 変更前後

変更前はIDの型やrole/partsを検証せず、モックが不正入力を成功扱いにした。変更後はJSONをunknownとして受け、IDの文字列型、既存の32,000文字・30件上限、SDK構造を確認し、ブラウザーからのsystem roleを拒否する。モデル形式への変換もモックより前に行う。認証・チーム認可・停止条件・モデル・費用制限は維持する。正規assistantのテキスト、途中応答、ツール結果の履歴は保持する。ツール入力・出力の業務内容の真正性はこの構造検証の対象ではない。

追加E2Eは未認証401、非メンバー403、不正構造・system・変換失敗400、文字数上限413、正常な複数往復・ツール履歴・中止後相当の途中履歴200を確認する。ブラウザーでは本人Problem送信前を撮影し、一度だけsystem roleへ差し替えた実API要求の拒否後に原文復元を確認する。修正再送後、本人が行動・日付を入力して確認保存し、再読み込みでTry一件を確認・撮影する。

生成予定PNG（同じ改修版の操作前後であり、旧SHAの画像ではない）:

- e2e/__screens__/chat-input-validation-before.png
- e2e/__screens__/chat-input-validation-after.png

## 検証・レビュー・制約

ホストでアプリ・SDK・ビルド・テストは実行していない。追加シナリオ、既存E2E、型検査、lint、ビルド、PNG生成はcontrollerの使い捨てrunnerで実行待ち。通常CIはモックAIとダミーデータを使う。

独立Claudeレビュー（対象SHA `907a14999437b7cbef733f103d48c1b5855dd68a`）はrevise。下記の修正を行ったが、修正後の同一SHAの独立承認・CIはcontroller待ち。企画はユーザー提示の独立承認済み計画を採用した。独立レビュー後の同一SHAを対象とするPlus一時画面検証もcontroller待ち。既存Plus・架空データ・最大3往復とし、モデル差、応答、遅延、未完了範囲を記録する。一時画面のブラウザー内保存は本番API・認可・DB保存の検証とは区別する。本番API境界はモックCIで確認する。

通常テキスト内の指示攻撃や偽造assistant履歴を全面的に防ぐ変更ではない。週次では正規相談の誤拒否がないか、次にProblem構造化引継ぎへ進むかを判断する。SDK更新時も正規履歴と不正入力を同じ実APIで確認することで、モックだけ成功する差の再発を防ぐ。

## 差戻し対応（2026-11-01、修正1）

- 指摘1：null本文の分割代入で500となる懸念。実ファイルにはJSON.parse直後のtry内にガードがあった。今回、その判定を分割代入の直前へ移し、`body === null`、非オブジェクト、配列を明示的に400へ返す形にした。既存のnullケースを保持し、別テストでも生のnullを送る。
- 指摘2：文字列`data: "{"`だけでは不正JSONの構文エラーを保証できない。既存テスト本文・アサーションを保持し、独立テストで`Buffer.from(raw, "utf8")`を送る。不正な生の`{`、null、配列、JSON文字列、数値、真偽値について400と本文を確認し、その後の正常要求200も確認する。既存文字列テストだけを構文エラーの証拠とは扱わない。
- SDK静的確認：インストール済み`ai/src/ui/validate-ui-messages.ts`のfile URLは文字列検証で、`convert-to-model-messages.ts`は通常fileを`new URL(part.url)`へ渡す。`invalid URL`はこの変換で拒否される想定を維持する。実Route Handlerの実行確認は未実施。
- 周辺確認：`playwright.config.ts`は`fullyParallel: false`、`workers: 1`。同ファイル内の共有fixtureは現在の設定で直列実行される。並列化する場合はfixture分離が必要。日付欄にはmin属性がなく、確認フォームと保存処理も過去日を拒否しないため、既存の固定日付とアサーションを保持した。エラー文言とTryフォームのラベルは静的に一致を確認した。空白・改行の完全復元、非メンバー403、保存再表示はcontrollerの実行で確認する。
- 残る境界：構造検証を通るhttps等のfile URLは引き続きモデルへ渡りうる。今回URL許可方針を拡張せず、週次判断に残す。画像は改修版の操作前後であり旧SHAの挙動証拠ではない。

この修正ではホスト上でアプリ、テスト、ビルド、実AIを実行していない。PNGも未生成。再発防止は追加した独立回帰シナリオによるものであり、合格実績ではない。
