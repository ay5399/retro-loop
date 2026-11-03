# AIへ渡す付箋に本人・他メンバーの区別を付ける

## 観測と選択

添付のai-chat.pngには本人と別メンバーのProblemと「自分のProblemから相談する」がある。変更前の/api/chatは認可済みの全付箋を`[種別] 本文`として渡し、作成者を区別していなかった。実際の誤帰属を観測した証拠はなく、品質上のリスク仮説である。

候補①はAI文脈の作成者区別。本人のProblemから本人の行動を決める優先シナリオに直結し、既存authorIdだけで実装できる。候補②は未完了アクションの次回提示。行動の見失いには有用だが状態管理等が広く、今回の本人確認・保存より優先度が低い。小さく戻せる①を承認済み計画どおり採用した。競合との機能一致自体は目的としない。

## 調査（アクセス日：2026-11-03）

- Parabol公式：https://www.parabol.co/resources/retrospective-meetings/ — 議論から行動計画を作り、タスクをダッシュボード・次回チェックインへ持ち越す。製品説明であり利用効果の実証ではない。
- TeamRetro公式：https://help.teamretro.com/article/166-retrospective-review-step — 現在・過去のアクションを確認し、担当・期限を設定、元のアイデア単位で文脈を確認できる。作成者と担当を同一とする根拠ではない。
- 公開利用者投稿：https://community.atlassian.com/forums/discussion/3257129/how-does-your-team-keep-retrospective-action-items-from-disappearing — 行動が数スプリント後に見えなくなるという投稿と、担当・次回再確認を使う実践談がある。製品関係者の発言・宣伝を含む自己申告で、RetroLoop利用者の調査でも代表性のある調査でもない。
- 技術資料：https://nextjs.org/docs/app/getting-started/route-handlers 、https://ai-sdk.dev/docs/ai-sdk-ui/chatbot 。導入済みNextのRoute Handlers資料、ai/docsのChatbot、@ai-sdk/react/src/use-chat.ts、ai/src/ui/ui-messages.tsも実装前に静的に読んだ。サーバー側systemとクライアントUIMessageの境界を維持する。

## 変更後

Route Handlerは既存の認証・チーム認可で取得した付箋とsession.user.idだけをヘルパーへ渡す。JSON配列の各要素をkind・author（ログイン本人／他メンバー）・contentに限定する。氏名・メール・生のIDはメタデータに追加しない。本文中に本人が書いた個人情報を除去する機能ではない。

複数行と偽の帰属ラベルはJSON文字列内の本文として保持する。これは構造を保つ措置であり、モデルのプロンプトインジェクション耐性を保証しない。作成者は実行担当者ではないこと、他メンバーのProblemも相談材料になること、本人が述べない担当・行動・日付を補完しないことを指示した。既存ツールには帰属がないため、その結果から帰属を推測しない指示も付ける。ツールの変更は今回の範囲外。

## 再発防止と検証の境界

新規e2e/chat-authorship-context.spec.tsに、同文の本人／他メンバー・改行・JSON風の偽ラベル・ID非出力・空配列の独立回帰検査を追加した。別の新規ブラウザーシナリオで、ダミーの2メンバーが同文Problemを持つ状態から本人Problem選択→モック相談→空の行動・日付を本人入力→確認・保存→DB上の本人帰属→再読み込み表示を検査する。既存テスト本文は変更していない。

候補SHAで操作前と保存再表示後に以下を作成する予定。旧SHAの比較画像ではない。

- e2e/__screens__/chat-authorship-context-before.png
- e2e/__screens__/chat-authorship-context-after.png

ホスト上ではアプリ・SDK・テスト・ビルドを実行していない。静的なdiff確認のみ実施。実行成功・PNG生成は未確認で、controllerの使い捨てGitHub runnerによるモックCIを待つ。モック経路は実モデル用systemを送らないため、モック成功は保存導線とヘルパーの決定論的検査の証拠に限定し、実モデルへの配線・対話品質の成功とは扱わない。

独立Claude実装レビューと指摘対応：controllerによる実施待ち。承認済み企画から追加の機能変更はない。

独立レビュー後の正確なSHAで、controllerが既存Plus・架空データ・ブラウザー内保存・最大3往復の限定実AI検証を実施する。本人と他メンバーの同文Problem、本文中の偽ラベル、未指定の行動・日付を用い、帰属の混同と項目の捏造がないか確認する。接続成功とUI保存成功を区別し、対象SHA・モデル・応答・遅延・未完了範囲を記録する。本番Geminiとの差は残る。今回実AIは未実行。

週次判断：帰属情報が対話の混同を減らすか、追加文脈が会話を煩雑にしないか。誤帰属の改善効果は未実証であり、利用指標・インタビューはない。
