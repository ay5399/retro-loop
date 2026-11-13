# 相談APIで未対応の添付ファイル入力を拒否する

## 観測と選択

添付された基準画面は文章による相談、本人による行動・日付の確認保存を提供している。相談APIはSDKの構造検証後にfile部品をモデル入力へ変換していた。既存回帰は不正URLを検査するが、有効なURLの添付拒否は検査していない。インストール済みaiの`ui-messages.ts`、`validate-ui-messages.ts`、`convert-to-model-messages.ts`ではfileとreasoning-fileがURLを保持し、変換後のモデル入力となる。外部取得や被害の発生を観測したものではない。

| 候補 | 本人のProblemから行動保存への関係 | 実現性・影響 | 判断 |
| --- | --- | --- | --- |
| A 未対応添付の拒否 | 本人が文章で相談する既存経路の入力境界を明確にする | APIの小さな可逆変更。未対応URLを変換前に拒否できる | 採用 |
| B 履歴ツールのチーム境界追加検査 | 相談時の履歴参照を守る | 通常の履歴作成は同一チームに限定済みで、今回の直接的影響は小さい | 延期 |

機能同等性は目的ではない。製品方針の行動確認・保存を維持し、添付対応の新設は行わない。

## 調査記録

閲覧日：2026-11-14。以下は公式説明・実践者記事であり、RetroLoop利用者へのインタビューや効果測定ではない。

- [TeamRetro REVIEW](https://help.teamretro.com/article/166-retrospective-review-step)：今回・過去の行動を確認し、担当・期限を指定、元アイデアでまとめられる。
- [GoRetro Action Items](https://www.goretro.ai/help-articles/create-follow-up-on-action-items)：カードから行動を作成し追跡する導線を提供する。製品説明は実利用での定着率を示さない。
- [Scrum.org 実践者記事](https://www.scrum.org/resources/blog/ditch-unfinished-action-items)：未完了行動、担当の明確化、毎回の進捗レビューを課題として挙げる。一般的な実践知であり、本製品の課題を実証しない。
- [AI SDK convertToModelMessages](https://ai-sdk.dev/docs/reference/ai-sdk-ui/convert-to-model-messages)：UIメッセージをstreamText用のモデル入力へ変換する。インストール済みSDKの静的文書・型・実装でも境界を確認した。
- [AI SDK streamText](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)：モデル入力を処理する後段API。ローカルSDKを実行したり外部URLを取得したりして確認していない。
- [Next.js Data Security](https://nextjs.org/docs/app/guides/data-security)：入力・認可の境界を確認する資料。インストール済みRoute Handlers/Data Securityガイドも読んだ。

## 変更前後と回帰防止

変更前は構造的に有効な添付URLをモデル入力へ変換できた。変更後はSDK検証直後に全メッセージのfile/reasoning-fileを400で拒否する。認証、チーム認可、既存の文章・ツール・中断後履歴の処理、費用停止条件を維持する。

既存テスト本文は変更しない。追加した`e2e/chat-file-input.spec.ts`は実APIに対して既存baseURL配下のURL/data URL × file/reasoning-file × user/assistantの拒否と文章の受理を検査する。添付値には既存のモック相談エンドポイントを使い、拒否対象の入力値としてのみ渡す。新しいホスト・ポート・取得先は追加しない。ブラウザーでは一度だけ送信にfileを付加し、400後の原文復元、文章での再送、本人の行動・日付の確認保存、再読み込み後のTry一件を検査する。

同specが生成する予定の画面：

- `e2e/__screens__/chat-file-input-before.png`：拒否後、再送前の原文復元。
- `e2e/__screens__/chat-file-input-after.png`：保存・再読み込み後のTry。

どちらも改修版で生成する画面であり、旧SHAの画面ではない。

追加した`e2e/chat-file-input-route.spec.ts`は実SDKの構造検証を使う隔離Routeで、添付拒否の応答文と変換・DB・providerの呼出しゼロを検査する。後段はスタブなのでネットワーク取得・実AIは行わない。正規ツール履歴と中断後履歴の受理は既存`chat-input-validation.spec.ts`の回帰を維持する。

## 検証・独立レビュー・残る制約

### controller修正要求2への対応（2026-11-14）

前回のリテラルなループバックHTTPSも、controllerが3箇所で新規URLとして拒否した。全3箇所の添付URLをPlaywrightの既存baseURL配下の`/api/chat`へ変更した。ブラウザーテスト2本にもbaseURLの存在確認を追加した。data URLのダミー内容と既存assertionは維持し、検査の削除・条件分岐・スキップは行っていない。URLの文字列分割などによる検査回避も行わない。隔離Routeは引き続き変換・DB・provider呼出しゼロを検査する。

既定baseURLはHTTPなので、今回のCIシナリオはHTTPS固有の動作を実証しない。拒否実装はURLのプロトコルを参照せず、SDK検証済みの添付部品の種類で一律拒否する。計画のHTTPS例をこの許可範囲に合わせて置換した制約を記録する。静的差分のみ確認し、controllerによる再検証結果は未取得。独立レビューは入力が`undefined`のため結果不明であり、合格とは扱わない。

### controller修正要求1への対応（2026-11-14）

controllerの候補検証は、新規テスト2本の4箇所にある新規URLを理由に失敗した。これはアプリ実行結果ではなく、テストコードの許可境界についての指摘である。添付値の外部ホストを許可されたリテラルのループバックHTTPSへ置換し、隔離RouteのRequest URLはPlaywrightの既存baseURLから作るよう修正した。data URLの架空内容、SDKの実検証、全組合せの400・応答文・後段呼出しゼロ、原文復元・再送・確認保存・再表示のassertionは維持した。新しい外部取得先は追加しない。静的差分で4箇所の修正とassertionの維持を確認したが、controllerの再検証は未実行。独立レビュー結果は今回の入力では`undefined`で、Claudeの指摘として扱わない。

ホストでアプリ、ビルド、テストは実行していない。静的差分確認のみ実施。PNGは未生成であり、controllerのモックAI・ダミーDBによるホストCI待ち。成功や被害防止の実証を先取りしない。

ユーザーから独立承認済みの計画が渡され、その範囲のみ実装した。この実装に対するClaudeの独立レビューは未実施であり、指摘内容を捏造しない。controllerで正確なSHAの独立レビュー後、指摘と対応を追記する必要がある。

実AI検証も未実施。独立レビュー後のSHAを対象に既存Plus経路、架空データ、最大3往復、ブラウザー内保存の限定UI検証を別工程で行う。モデル差、応答、遅延、未完了範囲を記録する。接続確認と画面から保存までの検証、本番認証・DB保存のモックCIを区別する。追加購入・従量APIへの切替はしない。

週次ではCI・独立レビュー・限定実AI検証の結果と未完了範囲、将来添付対応が本当に必要かを判断する。今回の拒否は未対応のトップレベル添付部品が対象で、全てのツール出力の意味内容を制限する変更ではない。
