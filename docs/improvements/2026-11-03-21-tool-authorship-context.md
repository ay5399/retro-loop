# AI補助ツールにも作成者区分を引き継ぐ

## 観測・候補比較

添付ai-chat画面には本人と別メンバーのProblemが混在する。静的調査では初期文脈のbuildChatNoteContextは区別していたが、summarizeRetroの本文・票数とflagRecurringIssuesの本文配列には区分がなかった。実際の誤帰属は未観測であり、改善効果は仮説。

候補①補助ツールの区分保持は「自分のProblemから自分の行動を決める」に直結し、既存authorIdで小さく実装できる。候補②保存失敗後の重複防止は利用者への影響が大きいが、通信断をまたぐ保証には永続的識別子等の広い変更が必要。独立承認済み計画に従い①のみ実装。競合機能の一致は目的にしない。

## 調査（2026-11-03アクセス）

- https://help.teamretro.com/article/166-retrospective-review-step — 公式ヘルプ。現在・過去の行動、担当・期限、元アイデアの文脈を確認できる。作成者＝担当という意味ではない。
- https://www.goretro.ai/help-articles/create-follow-up-on-action-items — 公式ヘルプ。カードに関連する行動を作り、担当・期限・説明を保存、過去ボードの行動も参照できる。
- https://www.reddit.com/r/scrum/comments/1kwpsdx/how_to_manage_action_items_from_retrospectives_on/ — 投稿者が、振り返り後に何をタスクにして次にどう進めるか迷うと記述。自己申告の公開投稿であり代表性は不明。RetroLoopの利用者調査ではない。

競合資料は機能説明であり、上記投稿とともに本改善の効果を実証しない。インタビューや利用指標は得ていない。

技術資料：

- https://nextjs.org/docs/app/api-reference/file-conventions/route
- https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
- https://ai-sdk.dev/docs/ai-sdk-ui/chatbot

実装前に導入済みnode_modules/next/dist/docsのroute.md、ai/docsのtools-and-tool-callingとchatbot、@ai-sdk/react/src/use-chat.ts、ai/src/ui/ui-messages.tsを静的に確認した。RouteはRequest/Responseで処理し、ツールexecuteの返値はモデルへ渡される材料になる。今回SDKやストリーム仕様を変更しない。

## 変更と境界

認証・チーム認可後のRouteから本人IDをクロージャーで両ツールへ渡す。総括は各付箋へkind・authorを追加し、履歴参照ではtries/problemsの本文配列を、kind・content・votes・authorを持つ構造化配列として返す。authorはサーバーで「ログイン本人／他メンバー」に判定する。既存集計呼び出しはIDを渡さなければ従来の形を保つ。票順・件数・履歴上限3件も維持する。

モデル材料に氏名・メール・生IDを追加しない。本文・グループ名に利用者自身が記した情報の除去は対象外。改行・偽ラベルは本文の値に閉じ込め、外側のauthorを上書きしない。既存の「作成者は実行担当者ではない」「本人の未指定項目を補完しない」指示を維持する。これはモデルの指示耐性や帰属判断の成功を保証しない。

## 回帰・証拠

既存E2E本文・assertionは変更せず、独立した二つのシナリオを追加。

- e2e/chat-tool-authorship.spec.ts：架空の二人、同文Problem/Try、改行・偽ラベル、現在と過去4件を用意。実データ取得関数で両区分、票順、従来APIの形、履歴3件、履歴なし、ID非出力を検査。モック相談→行動・日付が空→本人入力→確認→保存→DB上の本人帰属→再読み込みで一件表示も検査。
- e2e/chat-tool-route.spec.ts：隔離した実Routeをバンドルし、モデル・認証・DB・外部サービスをスタブに置換。既存のキー読取はバンドル内のみダミーへ置換する。両ツールexecuteを呼び、要求中の偽userIdではなく認証済み本人IDと履歴上限3が渡ることを検査。本番キー・通信は使わない。

新しい候補上で相談前／保存再表示後に作成するPNG：

- e2e/__screens__/chat-tool-authorship-before.png
- e2e/__screens__/chat-tool-authorship-after.png

旧SHAの比較画像ではない。PNG生成・テスト成功は未確認。ホスト上ではアプリ・SDK・ビルド・テストを実行していない。静的差分確認のみ行った。controllerの使い捨てGitHub runnerでダミーPostgreSQL・モックAIのCIを予定する。ブラウザーのモック応答は補助ツールを呼ばないため、配線検査とデータ検査を別に置いた。モック成功を実AI品質合格としない。

## レビューと実AIの未完了範囲

提供された独立承認済み計画の指示を反映：既存集計API保持、構造化区分、Routeから本人IDを渡す、既存E2E保持、隔離配線検査を実装した。Claudeの具体的な指摘原文・候補SHAの実装レビュー結果は未提供であり、承認済み計画から推測して記録しない。controllerの独立Claudeレビュー後に指摘と対応・対象SHAを追記する必要がある。

独立レビュー後の正確なSHAで、controllerが既存Plus・架空データ・最大3往復の限定実AI検証を行う予定。モデル・応答・遅延・未完了範囲を記録する。今回この検証は未実行。一時画面が実際の補助ツール結果をモデルに渡さない場合、今回の帰属品質の検証は未完了と明記する。接続確認、ブラウザー内保存、本番認証・DBのモックCIは別の証拠である。本番Geminiとのモデル差も残る。

週次判断：ツール結果を使う相談でも他メンバーの付箋を本人の確定事項にしないか、本人の行動・日付を補完しないか、追加情報が会話を煩雑にしないかを判断する。

## 2026-11-04-13 復旧チェックポイント（未完了）

前回2026-11-04-5から引き継いだ差分は、本書、独立E2E二件、チャットRoute、retro-toolsの5ファイル。同じ一改善を維持し、新機能や運用制御の変更は追加しない。

提供された履歴では2026-11-03-21は実装エージェントのタイムアウト、2026-11-04-5は残り4,975,794msに対し必要4,991,902msで停止した。これは候補の機能テスト失敗を示すログではなく、検証時間の予約不足である。運用側の原因修正は許可範囲外のため未解決とする。履歴ベースラインSHA dcbdff0e552ac77c1ae3a5cfc0fced8df51a95b4のCI run 41708565876は提供記録上成功しているが、今回の候補の成功証拠には転用しない。

履歴の参照先：https://github.com/ay5399/retro-loop/actions/runs/41708565876 （今回ログを取得・実行していない）。

現行verify-live-chat-ui.mjsを静的に確認し、提示された保守済みスナップショットと同様にfixtureSdkAliasesによるロック版照合・SDK解決先固定とresolveFixtureActionsによる合成保存アダプター接続があることを確認した。過去の障害が現在もあるとは判断できず、検証スクリプトは変更しない。既存の応答assertion、通信隔離、往復数・時間上限、合成保存を維持する。

2026-11-04に上記TeamRetro、GoRetro、公開Scrum投稿のURLを再閲覧した。担当・期限・元カードの文脈を保存する競合機能と、振り返り後の行動の扱いに迷う公開投稿を確認。候補比較と選択は変わらない。競合の機能説明と投稿者の自己申告であり、RetroLoopでの誤帰属や改善効果の実証ではない。

### 復旧時の独立した回帰確認シナリオ

controllerが使い捨てrunnerで次を確認する。これは実行手順であり、成功記録ではない。

1. 候補のchat-tool-route.spec.tsを実行し、両executeが要求本文の偽IDではなく認証済みIDを受け取り、既存ステップ上限2を維持することを確認する。
2. chat-tool-authorship.spec.tsを実行し、同文・改行・偽ラベルを含む本人と他メンバーの現在／過去付箋で区分・票順・履歴3件・従来APIを確認する。本人入力から確認・保存・再表示まで通し、同テスト内の二つのPNGを生成する。既存テスト本文とassertionは変更しない。
3. controllerの独立Claude実装レビューで指摘・対応と対象SHAを記録し、その正確なSHAを新たに検証する。企画承認を実装レビュー完了として扱わない。
4. 限定実AI画面が今回の両ツール結果をモデルに渡すかを確認する。現行runBrowserProbeのPOST処理は入力文をcompleteへ渡す構成であり、今回のツールexecute経由の帰属品質を確認した証拠はない。接続・対話・ブラウザー内保存が成功しても、ツール帰属品質は別途未完了として残す。

この復旧作業で行ったのは資料・ソース・差分の静的確認と記録の追記のみ。ホストでアプリ、SDK、ビルド、テスト、実AIを実行していない。候補CI、独立Claude実装レビュー、実AI応答・モデル・遅延、PNG生成はcontrollerの新しい証拠待ち。時間不足の運用問題も未解決であり、復旧完了・品質合格・公開済みとは報告しない。

### 2026-11-04-13 controller修正要求1：隔離テストのURL

今回の候補検証は `e2e/chat-tool-route.spec.ts:49` の新規URLで拒否された。原因は、通信しない隔離Requestにも独自の `fixture.invalid` を指定し、既存baseURLとモックfixtureを使う制約に違反したこと。歴史的なタイムアウトとは別の、今回修正できるテスト指定の問題である。

同テストにPlaywrightのbaseURL fixtureを注入し、`new URL("/api/chat", baseURL)` でRequestを作るよう修正した。設定が欠けた場合は明示的に失敗し、別ホストへフォールバックしない。Requestは従来どおり隔離POST関数へ直接渡し、fetch・ブラウザー通信を追加しない。認証・認可・モデル・DBのスタブ、両executeの認証済みID検査、既存assertionは保持する。保護された設定・運用制御・検証スクリプトは変更していない。

独立した再発確認シナリオ（controllerで実行予定、未実行）：

1. 新しい候補差分のURL検査で、独自の外部originが追加されておらず、既存baseURLを使用することを確認する。
2. 既存Playwright設定でchat-tool-route.spec.tsを実行する。両executeが認証済みIDを受け取り、要求中の偽IDを使わず、ステップ上限2と作成者に関する指示を維持することを既存assertionで検査する。
3. chat-tool-authorship.spec.tsで現在・過去の作成者区分と本人入力から保存再表示までを検査し、上記二つのPNGを生成する。この修正で既存のテスト本文・assertionの移動、削除、条件化はしていない。

導入済みNext Route資料、aiのtool calling／chatbot資料、@ai-sdk/reactのuse-chat.ts、UIMessage型を今回も静的に確認した。ホスト上でSDK・アプリ・ビルド・テストは実行していない。今回提供された独立レビュー結果はundefinedで、具体的なClaude指摘はない。新しい候補のcontroller検証・独立レビュー・限定実AI検証は未完了。現在の一時画面が両ツール結果をモデルへ渡さない制約と、過去の時間予約不足は引き続き未解決として記録する。
