# Problemから作成した未送信相談文の復元

## 観測と選択

2026-11-02 JST。添付のai-chat、board-color、board-group、board-vote画像では、Problem選択、相談文入力、本人Try入力が同じ画面にある。ソースでは本人TryにsessionStorage保持がある一方、相談文はuseStateだけで、再読み込みによって失われる。消失の実利用頻度、現行CIの合否は未確認。相談をやり直す負担が減るという効果は仮説であり、インタビューや利用実績はない。

候補Aは未送信相談文の復元。本人Problemから行動を決める入口を保護でき、DB変更なしで小さく実装できる。候補Bは保存行動の未着手／完了管理。優先方針に直接寄与するが、現在のTry付箋からの構造化・DB設計が必要になる。承認済み計画に従いAだけを実装した。競合との機能一致自体は目的にしない。

## 調査（2026-11-02閲覧）

- https://help.teamretro.com/article/166-retrospective-review-step : 元アイデアで行動をまとめ、担当・期限を設定し、以前の行動もレビューできる。公式機能説明であって利用効果の測定ではない。
- https://www.goretro.ai/help-articles/create-follow-up-on-action-items : カードから行動を作成し、担当・期限を設定でき、一覧には状態も含まれる。公式説明であり、未送信相談文の復元への直接的な需要証拠ではない。
- https://www.scrum.org/resources/blog/ditch-unfinished-action-items : 実践者Stefan Wolpersの記事（2024-10-21）は、未完了行動の蓄積とフォロー不足を指摘し、1〜3件への限定と明確な担当・日付を勧める。実践者の見解であり、RetroLoop利用者を対象とした調査ではない。記事中の効果倍率は本改善の根拠には採用しない。
- https://nextjs.org/docs/app/api-reference/directives/use-client : 同梱のnode_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.mdを参照。ブラウザーAPIはclient境界内のeffect・イベントで扱う。
- https://ai-sdk.dev/docs/ai-sdk-ui/chatbot : 同梱Chatbot文書、aiのUIMessage型、@ai-sdk/react/src/use-chat.tsを静的確認。入力はアプリ側管理、送信と中止は既存SDK経路を維持する。
- https://playwright.dev/docs/api/class-page#page-screenshot : 新規テストで候補コード上の再読み込み前後を撮影する。旧SHAの画像を生成したとは扱わない。

## 変更前後と境界

変更前は手入力・Problem追加・失敗復帰した相談文が再読み込みで消失する。変更後は本人・チーム・回をJSON配列にしたバージョン付きキーで、原文だけをsessionStorageに保持する。初期読取前に入力と送信を無効化し、初期空文字を書き込まない。スコープ変更でコンポーネントも再作成する。明示送信で削除し、既存の失敗・中止復帰で原文を再保持する。自動送信と自動Try保存はない。

復元・会話履歴非復元・タブ終了時の制限を表示し、明示破棄を提供する。Storage例外時も入力は可能で、コピーと古い下書き残存の可能性を案内する。Storage削除が失敗した場合の消去保証はない。会話履歴・送信中の原文・別端末への同期は対象外。本人が文脈を確認して再送する必要がある。DB・認可・本番停止・プロバイダー・費用境界は変更していない。

## 回帰と成功条件

既存テスト本文とassertionは変更せず、e2e/chat-draft-recovery.spec.tsを追加。

- 本人Problemから作成し編集した相談文が、改行と前後空白まで再読込後に一致する。復元だけではAI要求もTry保存も発生しない。
- 本人が修正して明示送信し、行動・本人担当・日付を確認してTryを一件保存、再読込後も表示する。成功送信後は相談文が復元されない。
- 別本人・別回・別チームのキーを読まない。明示破棄後は復元しない。
- 通信失敗・中止で戻した原文も復元する。不正JSON・文字列以外・Storage例外から編集を続けられる。

証跡はテストが生成する予定の次の2枚だけ。候補コード上の再読込前／復元後であり、旧SHAとの差分画像ではない。

- e2e/__screens__/chat-draft-recovery-before.png
- e2e/__screens__/chat-draft-recovery-after.png

## レビューと検証状況

旧候補SHA `ca3792df47b6308594288875c1b6d3e5242ff5df` は独立Claudeレビューでapprove（静的承認のみ）。controllerの通常CIは `react-hooks/set-state-in-effect` で失敗し、typecheck以降・PNG生成の成功は未確認。この修正候補についてホストでアプリ・ビルド・テスト・実AIを実行していない。新しい正確なSHAでの独立レビューとcontroller再検証が必要。

controllerがダミーPostgreSQL・モックAIで通常CIを実施する。独立レビュー後の正確なSHAで、架空データ・ブラウザー内保存・既存Plus認証・最大3往復の限定UI検証も必要。接続だけの成功とUIから保存までの成功を区別し、モデル差（本番Gemini）、応答、遅延、未完了範囲を記録する。本番認証とDB保存はモックCIの別検証であり、実AIブラウザー保存とは同一視しない。

週次では相談文消失の実例、復元による継続の有用性、会話履歴保持を別途優先すべきかを判断する。

## correction 1: CI原因修正とClaude指摘への対応（2026-11-02）

React公式 https://react.dev/reference/react/useSyncExternalStore （2026-11-02閲覧）のブラウザーAPI購読・SSR・snapshotキャッシュ規約に従い、Effectでの同期setStateを撤去。本人・チーム・回で作り直すコンポーネント内に独立ストアを置き、購読開始時だけsessionStorageを読む。サーバーとhydrationには同じ未準備snapshotを返し、変更時だけsnapshotを置換する。初期化は保持値を上書きせず、明示編集だけが書き込み、復元時にAI要求もTry保存も行わない。lint無効化・タイマーでの先送り・依存変更は行っていない。同梱Next use-client文書、ai Chatbot文書、@ai-sdk/reactのuse-chat.tsと型も再確認した。

Claudeの注意点への対応:

1. ログアウトクリック後、ホームへの遷移とログアウトボタン消失を待ってから次のログインを開始するassertionを追加。
2. 固定日2026-11-09は既存テストを保持。現行OwnTryConfirmationは日付形式だけを検証し過去日を拒否しないため期限切れにはならない。別の独立回帰は実行日+7日/+8日で日付確認・修正を検査する。
3. 成功送信はレスポンス本文の完了と待機表示消失を待ってから従来assertionへ進む。確認画面の日付表示assertionを追加。
4. sessionStorageにはログアウト後も平文の相談文がタブ内に残る。画面に共有端末でのログアウト前破棄を案内し、週次では自動消去と復帰のどちらを優先するか判断する。他本人の画面へは復元しないが、端末内ストレージの機密保護ではない。
5. hasDraftは元からlength基準で空白も含む。空白のみの復元・送信禁止・明示破棄・再読込を独立テストで追加。即時破棄で元に戻せないことを画面で案内する。
6. PNGは候補上の再読込前後であり、旧SHA比較ではない。宣言した2枚以外を本テストから生成しない。

既存E2Eのassertion・本文を削除・移動せず、待機・assertionを追記し、追加の独立回帰を末尾に配置した。上記は静的な修正内容であり、lint・型・ブラウザー実行の合格報告ではない。

提供されたcontrollerの `normal-live-ai-1.log` は旧候補SHAについてPlus/chatgpt・local-codex-app-server・gpt-6.1-solで最大3往復を報告。初回は本人ができる行動を質問、2回目も担当・期限を補完せず問い返し、3回目は本人が指定した行動・担当・2026-11-09朝会後を確認案として整理し未保存と明記。初文字/完了は7.216/9.584秒、2.471/5.105秒、3.022/5.755秒。実AiChat/KptBoardClientから合成localStorageへの保存・再表示をpassedと報告している。これは提供ログの結果であり、こちらで再実行したものではない。本番Gemini・認証・PostgreSQLの実AI検証でも、下書き復元回帰の実行証明でもない。新候補の品質合格へ流用せず、再レビュー後の正確なSHAでcontrollerが限定実AI検証を再実施する。
