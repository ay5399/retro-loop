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

独立Claude実装レビュー：SHA `c4666464f8e77524755b59f8527386112680014e` は静的レビューでapprove。サーバー側の帰属判定、個人識別情報の非追加、JSONによる構造保持、認証・認可・費用境界の維持を確認。レビューで未確認とされたauthorId取得とsession.user.idの存在は、静的にnotes全体のincludeと冒頭の認証ガードを確認した。画面セレクター・保存形式・削除cascadeの実行確認はモックCIに残る。承認は実行成功を意味しない。

## correction 1：隔離テストのimport解決修正（2026-11-03）

controller提供のnormal-after-1-checks.logでは203件中202件成功、1件失敗。失敗は既存scripts/automation/mock-chat.test.mjsのesbuild隔離プラグインが、新しい`@/lib/llm/chat-note-context`を未知のアプリimportとして拒否したビルドエラーだった。Playwright・PNG生成・通常CI全体の成功は確認できていない。

esbuild公式 https://esbuild.github.io/plugins/#on-resolve と https://esbuild.github.io/api/#bundle （アクセス日2026-11-03）は、onResolveのfilterに一致するimportをプラグインが解決し、それ以外を通常のバンドル解決へ渡す仕組みを説明している。今回の原因はSDKのストリーム仕様ではなく、新規aliasと既存隔離境界の不整合。Routeから純粋ヘルパーへのimportだけを相対パスに修正した。既存テスト・許可リスト・検証条件を緩めず、実ヘルパーをバンドルへ含める。認証・DB・providerのスタブ境界は維持する。

独立したe2e/chat-context-route-bundle.spec.tsを追加し、同じalias許可境界でRouteをバンドルできること、実ヘルパーが入力グラフに一つ含まれ追加の依存を持たないことを検査する。既存のmock-chat.test.mjsが実ハンドラーの2往復ストリーム消費を引き続き検証する。既存E2E本文とassertionは変更していない。ホストではテスト・ビルドを実行せず、この修正の合格は新しい正確なSHAの独立レビューとcontroller再検証待ち。

## controller提供の旧SHA実AI結果と限界

normal-live-ai-1.logは上記旧SHAについて、2026-11-03 04:12 UTC、local-codex-app-server・chatgpt認証・Plus・gpt-6.1-solで3往復と画面保存再表示がpassedと記録している。実コンポーネントはAiChat・KptBoardClient・OwnTryConfirmation、保存先は架空データのlocalStorage。応答は①本人が試せる行動を質問、②未確定の担当・期限を補わず本人が変えられる行動を質問、③本人指定の2026-11-10朝会後のPR共有を確認案にまとめ、未保存と手動追加を案内した。最初の文字まで5.826／2.556／4.370秒、完了まで8.323／5.217／6.804秒。

これは接続だけでなくUIでの保存再表示の証拠だが、本番チャットRoute・Gemini・認証・PostgreSQLの実AI検証ではない。提供された対話ログだけでは同文の本人／他メンバー付箋や偽ラベルを含む文脈が実モデルに渡ったことを確認できず、帰属混同の改善効果は未検証。新しいSHAでもcontrollerによる独立レビュー後の限定実AI再検証が必要。上記旧SHAの成功を修正後の成功として転用しない。

週次判断：帰属情報が対話の混同を減らすか、追加文脈が会話を煩雑にしないか。誤帰属の改善効果は未実証であり、利用指標・インタビューはない。
