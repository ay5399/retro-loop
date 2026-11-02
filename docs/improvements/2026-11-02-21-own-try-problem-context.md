# 本人Tryに元Problemの文脈を残す（復旧 2026-11-03-5）

## 観測と復旧診断

添付のai-chat / board画面では相談用Problem選択と本人Try入力が分離しており、保存する行動の元Problemは確認できない。旧実装のOwnTryConfirmation呼出しにもownProblemsが渡らない。これは静的に確認した情報欠落であり、利用者が困った頻度や改善効果は未測定。

前回2026-11-02-21は実装処理のタイムアウトで未完了。承認済み計画では基準CI（2c6f3ab）は成功と報告されているが、今回はその実行を再確認していない。履歴ログ末尾と引継ぎ7ファイルを確認した。内部のタイムアウト原因は断定できず、現在のアプリの失敗を示すものでもない。提供スナップショットと現行verifierにはSDK固定解決と限定Action差替えが既に存在するため、それらを再修正しない。新たな機能へ広げず、この一改善を継続する。

## 調査・候補比較

すべて2026-11-03閲覧。競合との同等性自体を目的にしない。

| 根拠 | 具体的な所見 | 限界 |
| --- | --- | --- |
| [TeamRetro REVIEW](https://help.teamretro.com/article/166-retrospective-review-step) | 元アイデアによる行動のグループ化、担当・期限の確認が可能 | 公式機能説明であり、効果測定ではない |
| [EasyRetro公式ガイド](https://intercom.help/easyretro/en/articles/12386250-easyretro-guidelines-start-the-right-way) | カードを具体的なアクションへ変換する導線を案内 | ガイドの存在を確認。利用頻度は不明 |
| [Atlassian実践記事](https://www.atlassian.com/blog/development/retrospectives-atlassian) | ファシリテーターが合意した行動を復唱して確認し、担当者を尋ねて記録する実践を紹介。議論を解決へ導く必要を指摘 | 2014年の社内実践記事。RetroLoop利用者の調査ではない |

候補Aは元Problemを本人が任意選択して確認・保存本文に残す案。優先シナリオに直接沿い、既存Noteで実装可能で、引継ぎを活用できる。候補Bの未着手／完了管理は継続利用に役立つ仮説だが、専用状態・保存設計が必要。Aを選択し、Bは延期する。

## 変更

本人Problemを任意選択し、行動・本人担当・日付とともに確認する。AIから自動選択・補完しない。保存専用Server Actionは認証とチーム認可を維持し、同じ回の本人作成PROBLEMを照合する。Serializableトランザクション内で確認した本文と比較して、サーバーが取得した元ProblemをTry本文へ記録する。変更・削除・不正IDは保存せず入力を保持し、再確認へ戻す。未選択は従来の本文形式を維持する。

下書きは選択ID・本文もタブ内に保持し、復元後は編集画面から再確認する。合成fixtureも同じ確認フォームからブラウザー内保存・再表示まで通す。元の手動Try追加と応答assertionを残し、結果にownTryContextReappearedを記録する。SDK解決・通信隔離・最大3往復・330秒制限は変更しない。

## 回帰検証と証拠

既存E2E本文・assertionを移動削除していない。引継ぎのown-try-problem-context.spec.tsは選択変更、復元、一件保存・作成者・本文・再表示、確認後の編集／削除、不正ID（別本人・別回・別チーム・KEEP）、未選択を検査する。今回別テストとして元Problemだけ選んだ下書きの復元・破棄とDB未作成を追加した。

別ファイルown-try-context-fixture.spec.tsはモック3往復で実verifierを呼び、確認フォームで保存した文脈が再表示された結果を必須とする。これにより、一般Try追加だけの成功や部分的なfixture実装を完了扱いにしない。アプリ実行・ビルド・テストはホストで実施していない。git diff --checkは実施し問題なし。実行成功を主張しない。

候補上の選択前と保存再表示後を既存の追加E2Eが次へ撮影する予定（旧SHAの画像ではない）:

- e2e/__screens__/own-try-problem-context-before.png
- e2e/__screens__/own-try-problem-context-after.png

## レビューと未完了範囲

独立Claude実装レビューは今回未実施。指摘と対応はcontrollerの正確な対象SHAのレビュー後に追記が必要。架空DB・モックAIのhosted CIも未実施。失敗があればSHA・日時・原因を記録し、再現した原因だけ修正する。

レビュー後SHAのPlus限定実AI検証（最大3往復）も未実施。接続確認、応答内容・遅延・モデル差、確認フォームから合成保存・再表示までを区別して記録する必要がある。本番認証・PostgreSQLの検証はモックCIが担う。追加購入や従量APIへ切り替えない。

元Problemは本文スナップショットであり構造化関連ではない。状態管理・効果追跡は対象外。週次では文脈記録の有用性と専用Actionモデルへの移行時期を判断する。

静的技術参照: 導入済みNextの07-mutating-data.md（Server Action自身で認証・認可が必要）、ai/docs/04-ai-sdk-ui/02-chatbot.mdx、ai/dist/index.d.ts、@ai-sdk/react/src/use-chat.ts。公開参照は [Next Server Actions](https://nextjs.org/docs/app/guides/server-actions)、[AI SDK Chatbot](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot)。依存・DB・認証・運用制御は変更しない。
