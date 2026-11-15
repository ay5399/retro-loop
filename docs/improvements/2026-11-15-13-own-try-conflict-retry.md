# 本人Try保存の一時的なDB競合を限定再試行する

調査・実装日：2026-11-15。独立承認済み計画の実装。

## 観測と選択

添付のai-chat、board-color、board-group、board-vote画面には、本人が行動・日付・元Problemを確認して保存する導線がある。静的に確認したsaveOwnTryは元Problemの所属・本人所有・本文の照合とTry作成をSerializableトランザクションで実行するが、競合を再試行しない。P2034なら保存エラーとなり本人の再操作が必要になる構造だった。今回の失敗ログや競合発生率は提示されていない。実利用の頻度・改善効果は未測定である。

| 候補 | 所有者の優先シナリオへの適合 | 実現性・影響 | 判断 |
| --- | --- | --- | --- |
| A：保存競合の限定再試行 | 本人が確認した行動を保存する終点に直結 | Server Action内の小変更。競合時の再操作を減らす仮説 | 採用 |
| B：未着手／完了の専用状態管理 | 次回の行動確認に有用 | データ設計を含む広い変更が必要 | 今回は延期 |

競合製品との機能一致自体を目的にせず、保存を完了する経路の改善を選んだ。

## 調査資料

以下のURLは2026-11-15に閲覧した。Webの記述を実装指示として扱っていない。

- https://easyretro.io/whats-new/ ：2026-08-31更新に、未完了行動の本文・担当・期限・元ボードへのリンクを表示する機能がある。行動を残して再確認する価値の参考。公式の製品説明であり、RetroLoop利用者の効果の証拠ではない。
- https://www.parabol.co/resources/retrospective-meetings/ ：議論から行動計画を作り、新規タスクをダッシュボードや次回Check-Inで扱う説明がある。保存から次回へつなぐ設計の参考。効果の独立検証ではない。
- https://www.reddit.com/r/agile/comments/13cj3w7/how_do_you_track_action_points_from_the_retro/ ：遠隔チームで行動項目を追跡・可視化し、スプリント表示を煩雑にしない方法を尋ねる公開投稿。課題の存在を示す個人の経験で、代表性・本人確認・RetroLoopへの一般化は保証できない。競合復旧の要望を直接示すものではない。
- https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions ：Transaction timing issues節で、Serializableの書き込み競合・デッドロック時のP2034とトランザクションの再試行を説明。導入済みPrisma 6に対応する一次資料。
- https://www.postgresql.org/docs/current/transaction-iso.html ：Serializableでも直列化失敗を処理してトランザクション全体を再試行する必要がある。DB実装の一般的な根拠であり、今回の実DB競合を観測したものではない。

実装前にAGENTS.md、PRODUCT_DIRECTION.md、LIVE_AI_VERIFICATION.md、インストール済みNextのuse-serverガイド、aiのuseChat資料・convertToModelMessages実装、@ai-sdk/reactのUseChatHelpers型を静的に確認した。SDK・アプリコードのホスト実行はしていない。

## 変更前後と境界

変更前はP2034で直ちに失敗する。変更後はPrismaClientKnownRequestErrorでcodeがP2034の場合だけ、初回を含め最大3回実行する。再試行対象はトランザクション全体とし、元Problemの照合も毎回やり直す。変更された本文や無効な元Problemは既存のproblemChanged結果に戻す。他のエラー・3回目の競合は同じエラーを伝播する。

認証・チーム認可・分離レベル・AI・費用境界を維持。revalidateはトランザクションが結果を返した後に一度だけ実行し、その失敗は再試行しない。元Problem変更時の再確認結果についても既存同様に一度revalidateする。DB・依存関係・UI・プロンプトは変更しない。通信切断後の二重送信防止や、継続的な高競合への対策は対象外。即時再試行のため競合が続く可能性があり、その場合は3回で停止する。

## 回帰シナリオと未完了の検証

新規e2e/own-try-conflict-retry.spec.tsを追加し、既存E2E本文・assertionは変更していない。

隔離テストは実Server Actionをbundleして読み込み、認証・DB・cache境界だけを置換する。Prismaのエラー型とアプリの他ヘルパーは実物を使う。DB境界はトランザクションcallback完了後のcommit失敗とrollbackを模擬する。

1. P2034→成功：照合2回、確定1件、通知1回。
2. P2034継続：3回で元エラーを伝播、確定0件、通知0回。
3. 3回目の成功：照合3回、確定1件、通知1回。
4. 別Prismaエラー・一般エラー・codeだけのオブジェクト：1回で伝播。
5. 再試行時の元Problem変更：再確認結果、確定0件。

別のブラウザーシナリオは実Server ActionとダミーPostgreSQLで、本人の行動・日付・元Problemの確認、Try確定1件、再読み込み後の同一内容を検証する。AI呼び出しを追加しない。次のPNGを改修後SHAで生成する予定で、旧SHAの画像や競合発生を示す画像ではない。

- e2e/__screens__/own-try-conflict-retry-before.png：保存内容確認後・保存前。
- e2e/__screens__/own-try-conflict-retry-after.png：保存・再読み込み後。

実DBでの競合を注入するブラウザーテストではないため、実PostgreSQLのrollback動作自体はこの隔離テストでは証明しない。画像は通常保存の利用導線の証拠として扱う。

ホストではアプリ・サーバー・build・テストを実行していない。git diff --checkの静的確認のみ実施。hosted CIでlint・型検査・上記Playwrightを含む既存回帰の実行が必要。合格結果・生成済みPNGはまだない。

## 独立レビュー・実AI・週次判断

ユーザーが独立承認済みの計画を提供した。Claudeの具体的指摘原文と実装SHAのレビュー結果はこの作業時点では未提供。指摘・対応済みと捏造せず、controllerによる独立Claudeレビュー後に実際の指摘と対応を追記する。

承認済み計画に従い、controllerが独立レビュー後のSHAで既存Plus経路・架空データ・最大3往復の一時画面検証を別途行う。本作業では実AIを呼んでいない。モデル差・応答・遅延・未完了範囲を記録し、本番認証・DB保存のモックCIと区別する。

週次では競合対策の価値（発生頻度は未測定）、限定再試行の制約、専用の未着手／完了状態管理を次に扱うかを判断する。
