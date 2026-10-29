# 相談失敗復帰の修復（2026-10-29）

## correction 2：正常な単独テキスト終端との互換性

今回提供されたnormal-recovery-after-2-checks.logはSHA 8a13e30a6647a2f2d6167c9cf43111a329378fa1で40 passed／1 failedを報告する。失敗は既存の本人Problem明示送信テストの入力消去期待値。保護対象のchat routeを読み取ると、モックはcreateUIMessageStreamのwriterからtext-start／delta／endのみを書き、start／finishを書かない。固定版create-ui-message-stream.tsとhandle-ui-message-stream-finish.tsもそれらを自動補完しない。一律のfinish必須検査が正常応答を失敗扱いにして下書きを復元したのが原因。前段の「finishがないEOFはすべて失敗」はこの既存形式を見落としていたため、以下の狭い互換条件に訂正する。

今回の修正は、テキストイベントだけで構成され、少なくとも一つのtext-endがあり、すべての開始済みテキストが閉じた場合だけ、finishなしの正常EOFを受け入れる。start等を含むライフサイクル形式には引き続きfinishを要求する。空ストリーム、閉じていないテキスト、start＋text-endだけの応答は未完了。プロバイダー・環境変数・モック本文による分岐は設けない。保護対象APIを変更せず、既存テストの期待値を保持する。独立した3例の固定応答回帰を追加し、各例の入力値・通知数・未完了表示数・POST1回を必ず検証する。既存のfinishReasonなし成功、503連続失敗、SSEエラー、finish欠落テストも保持する。

2026-10-29にhttps://ai-sdk.dev/docs/reference/ai-sdk-ui/create-ui-message-stream とuseChat公式資料を閲覧した。最新公式例はstartを明示し、writerでイベントを構成する。最新公開仕様には固定版と異なるAPIがあるため、既存形式の挙動はインストール済み静的ソースを根拠とした。実行成功の証拠ではない。

独立Claudeレビューは上記SHAを静的approveとしたが、単独テキスト形式との互換性は見逃され、controllerが検出した。今回の修正後SHAへの承認はまだない。提供されたlive-ai-2.logは同じ旧SHAでPlus／gpt-6.1-solの3往復、実AiChatとKptBoardClient、架空localStorage保存再表示のpassedを報告する。最初の文字まで7.338／2.953／2.724秒、完了まで9.932／4.478／5.958秒。本人の行動を問い返し、指定された担当・日付・行動を確認用に整理し過去日付を確認した。本番Gemini・認証・DB保存と通信障害復帰の実AI証拠ではない。修正後SHAの検証を代替しない。

ホストでアプリ・ビルド・テスト・実AIを実行していない。修正後の型検査、全E2E、画像生成、独立レビューと限定Plus検証はcontrollerでの再確認が必要。ログのDndDescribedBy hydration警告は別ボードの既存問題として観測されたが、提示ログで該当ボードテストは成功している。本件の入力復元原因とは区別し、別改善を混在させない。週次では再検証結果と単独テキスト互換条件の妥当性、担当・日付保存の専用作業への着手を判断する。

## 対象と選択

本人のProblemからアクションを具体化する途中で、通信失敗により相談文を失う問題を対象とする。添付4画面は正常相談・ボード操作の外観を示すが、通信失敗の実行証拠ではない。離脱低減は仮説であり、利用者インタビュー・失敗頻度・利用率の実測はない。

|候補|優先シナリオへの寄与|実現性と判断|
|---|---|---|
|担当・日付の確認カードと保存|具体的な本人アクションの保存に直接寄与|保護対象DBを含む専用作業が必要。今回は対象外|
|相談失敗の通知・全文復元・編集再送|具体化途中の本人の回答を守る|クライアント内の可逆的変更。未完了作業の修復を優先して選択|

変更前は送信直後に入力を消し、失敗を通知しなかった。変更後は空白・改行を含む全文を復元し、本人の明示操作で編集再送する。送信ペイロードのみ従来どおりtrimする。以前の完了会話を保持し、再送は失敗ターン以降を置換する。不完全応答は未完了と表示し、生例外を公開しない。finishイベントのない正常EOFも失敗扱いとするが、finishReason省略は成功扱いとする。

## 今回の検証停止原因と修正

提供されたnormal-recovery-after-1-checks.logは、SHA bb8cacf0daff4bb1f3b8f1c71def306d2f24b09eのlint段階後、typecheckでTS2314とTS2351により終了している。直接原因はCompleteChatTransportが、型引数を必須とするDefaultChatTransport<UI_MESSAGE extends UIMessage>を引数なしで継承していたこと。コンストラクターのエラーはこの不正な継承と整合する。

固定版ai 7.0.22のsrc/ui/default-chat-transport.tsと@ai-sdk/react 4.0.23のsrc/use-chat.tsを照合し、継承をDefaultChatTransport<UIMessage>へ修正した。引数やコンストラクターを迂回せず、useChatの既定メッセージ型と一致させる。SDK同梱use-chat/chatbot資料、同梱Nextの01-app/02-guides/testing/playwright.md、AGENTS.md、製品方針、実AI検証方針も編集前に確認した。

独立した単回成功回帰テストに、POST内のユーザーロール・空でないID・本文partsの無条件検証を追加した。既存テスト本体・アサーションは削除・移動・再インデントしていない。再試行や条件付き検証が残る既存正常テストは保持し、独立テストで単回成功を検証する。過去の「既存正常テストを単回化」「test.stepで整理」という記述は撤回し、混同を避けるため旧試行の重複説明を本記録から除いた。

## 独立レビューと提供された実行証拠

ClaudeはSHA bb8cacf0daff4bb1f3b8f1c71def306d2f24b09eを静的approveとした。CI・coverage・画像・Plusの成功を保証する承認ではない。必須型引数がない点はレビューで見逃され、controllerの型検査が検出した。今回の修正後SHAには再レビューが必要。

指摘と対応:

- 記録の旧試行との矛盾：現在の実装・提供ログを中心に本記録を整理した。
- ローカルSDK配布物不足：過去のバンドル失敗の記録。今回提供されたrunnerの直接停止原因は型エラーであり、依存不足と同一視しない。依存・自動化設定・packageは変更しない。
- Plus実AI検証の不足：下記の旧SHAの成功ログが今回提供された。修正後SHAの検証を代替しない。
- 以前のrole=alertの曖昧さ：専用data-chat-error属性で失敗通知のみ検証する処理を維持。
- 既存coverage削除拒否：既存本体を保持し、独立した追加テストで補う。controllerの基準SHAによる再判定は未確認。

提供されたnormal-recovery-live-ai-1.logは上記SHAについて、local-codex-app-server、ChatGPT Plus、gpt-6.1-solで最大3往復を報告する。実AiChat/KptBoardClient、架空データ、ブラウザーlocalStorage保存で、付箋の再表示までpassed。最初の文字まで10.723／5.137／3.359秒、完了まで13.200／7.084／6.945秒。最初の2応答は本人ができる行動を質問し、最終応答は本人指定の担当・行動・日付を確認用に整理、過去日付を問い返し、未保存と明記した。これは提供ログによる観測であり、今回私が実行したものではない。

本番Gemini、認証、チャットAPI、PostgreSQL保存を通した実AI検証ではなく、通信失敗復帰の実AI検証でもない。これらの認証・DB経路はモックCIで別途確認する。修正後の正確なSHAのPlus検証、typecheck、E2E、coverage判定、PNG生成は未確認。ホストでアプリ・ビルド・テスト・ライブAPIは実行していない。保護対象は変更していない。

## 回帰検証と再発防止

controllerの使い捨てrunner、ダミーDB、モックAIで次を確認する。以下は実装済みのテストの期待値であり、今回の実行成功ではない。

- 単回成功：固定SSEをPromiseで保留し、送信中の入力・ボタン無効と応答中表示を確認してfinallyで解放。正しいteamId/retroId、ユーザーID・ロール・本文、POST1回、会話各1件、入力消去、通知なし、finishReasonなしのfinish成功を検証する。
- 503連続失敗：空白・改行を含む全文復元、編集後の再失敗で最新全文復元、自動再送なしを確認する。
- 部分応答後のSSEエラーとfinish欠落：内部例外非表示、未完了表示、以前の完了会話保持を確認する。
- 明示再送：失敗ターン置換、不完全応答除去、正しいペイロード、送信中無効化、成功後通知解消を確認する。
- 既存の正常送信・401・403を保持する。既存テストの書き換えでcoverage拒否を招かず、環境変数分岐・skip・条件付きアサーションを追加しない。

型引数の再欠落は通常のtypecheckで検出する。ブラウザー回帰でtransportの構築から成功・失敗復帰まで通す。静的レビューの承認だけで型検査・E2E合格と扱わない。

503ケースが同じ改訂版の操作前後に作成するPNG（未生成・旧版画像ではない）:

- e2e/__screens__/chat-failure-recovery-ready.png
- e2e/__screens__/chat-failure-recovery-restored.png

## 調査資料と限界

2026-10-29に公式useChatを再閲覧し、transport、sendMessage、完了通知を確認した。公開最新資料は固定版と差があるため、今回の型修正は固定版ソースを根拠とする。DefaultChatTransport単独リファレンスURLは取得できず、根拠にしない。失敗修復を優先し、新規の競合機能調査は追加していない。競合・実務記事は前段の2026-10-28の調査記録を引き継ぎ、今回再閲覧したとは扱わない。

- https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat — 2026-10-29アクセス。transport・状態・メッセージ置換の仕様。実行成功の証拠ではない。
- https://ai-sdk.dev/docs/ai-sdk-ui/chatbot — 前段2026-10-29調査。エラーを一般的な文面で通知する参考。同梱資料も確認。
- https://playwright.dev/docs/network — 前段2026-10-29調査。routeによる応答制御の参考。
- https://nextjs.org/docs/app/guides/testing/playwright — 同梱Nextガイドと照合するブラウザー検証の参考。
- https://support.retrium.com/articles/how-do-action-items-work-in-retrium/ — 前段2026-10-28調査。ambassador・目標日・完了管理。機能の証拠であり効果の実証ではない。
- https://www.parabol.co/support-categories/managing-teams-tasks/ — 前段2026-10-28調査。会議後タスク管理のヘルプ導線。失敗復帰の操作比較ではない。
- https://www.scrum.org/resources/blog/ditch-unfinished-action-items — 前段2026-10-28調査。担当・期日・継続確認の不足を論じる実務家の見解。RetroLoop利用者の観測ではない。

週次では修正後SHAの検証結果と復帰導線の価値、専用の担当・日付確認保存への着手を判断する。会話の再読み込み後保持と専用アクション保存は今回の対象外。
