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

計画は独立承認済み。Claudeの具体的な指摘原文は提供されていないため創作しない。実装後のClaude独立レビュー・指摘対応・正確な対象SHAはcontrollerの記録待ち。ホストでアプリ・ビルド・テスト・実AIを実行していない。静的な文書・型・ソース確認のみであり、CI成功やPNG生成を主張しない。

controllerがダミーPostgreSQL・モックAIで通常CIを実施する。独立レビュー後の正確なSHAで、架空データ・ブラウザー内保存・既存Plus認証・最大3往復の限定UI検証も必要。接続だけの成功とUIから保存までの成功を区別し、モデル差（本番Gemini）、応答、遅延、未完了範囲を記録する。本番認証とDB保存はモックCIの別検証であり、実AIブラウザー保存とは同一視しない。

週次では相談文消失の実例、復元による継続の有用性、会話履歴保持を別途優先すべきかを判断する。
