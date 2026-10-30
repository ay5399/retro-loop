# Googleフォント生成に起因する起動失敗の修復

## 観測と範囲

2026-10-30のコントローラーログでは、Bricolage Grotesqueの生成CSSから `@vercel/turbopack-next/internal/font/google/font` を解決できず、`next/font/google queries have exactly one entry` が発生し、webServerが120秒でタイムアウトした。静的コードでもルートレイアウトのGoogleフォント3種を確認した。内部クエリエラーの詳細な発生条件やネットワーク障害は未確定であり、Next内部不具合そのものを修正したとは主張しない。

失敗したベースラインは成功した変更前比較ではない。提供された画像一覧は空で、変更前の画像証拠はない。前回の下書き保護案は実装せず、起動修復一件に限定した。保護された automation-result.json、自動化、依存関係、認証、DBは変更しない。

## 候補と採用理由

| 候補 | 所有者の優先シナリオとの関係 | 実現性・利用者への影響 |
| --- | --- | --- |
| Googleフォントを除きシステム書体へ変更 | Problemから相談するための入口を復旧する | 資産取得や依存変更が不要。小さく可逆。OSにより字形・改行が変わる |
| next/font/localへ変更 | 同じ入口を復旧し、書体を維持できる | フォント資産がなく、取得・ライセンス確認が必要 |

承認済みの第一案を実装。layout.tsxからGoogleフォントimport・初期化・生成クラスを除去し、globals.cssのdisplay/sans/monoを既存のシステムフォント列へ変更した。製品機能や保存動作の追加はない。

## 技術調査（2026-10-30閲覧）

- https://nextjs.org/docs/app/getting-started/fonts : Googleフォントを自動で自己ホストし、localはファイルを指定する方式。ブラウザーからGoogleへの通信がないことと、生成時の処理は区別する。
- https://nextjs.org/docs/app/api-reference/components/font : GoogleのCSS・フォントファイルはビルド時に取得する。本ログの内部クエリ障害の詳細原因までは説明しない。
- https://playwright.dev/docs/api/class-page#page-goto : gotoはHTTP 404/500だけでは例外にならないため、応答statusを明示検証する。
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/font-family : 書体候補は優先順に評価され、汎用ファミリーをフォールバックにできる。OS間で同じ字形は保証されない。

実装前に同梱Nextの `13-fonts.md` と `testing/playwright.md`、aiのuseChat資料・UIMessageソース型、@ai-sdk/reactのuseChatソース型・配布型を静的確認した。useChatは入力状態を内部管理しないAPIだが、今回はAI関連コードを変更しない。ベースライン修復限定のため競合機能調査や新機能選定は行わない。利用者のインタビュー・使用頻度・改善効果は観測していない。

## 回帰防止と検証状況

新規 `e2e/font-startup.spec.ts` にホーム→ログインリンク→ログイン画面→再読込を追加した。ホーム文書、ログイン文書の別途GET、再読込のHTTP 200と、日本語見出し・ログインリンク・メール入力欄を無条件で検証する。Nextのクライアント遷移はプリフェッチを利用しうるため、リンク操作の表示確認と文書GETを区別する。送信や認証、AI呼出しは行わない。

既存テスト本文・アサーション・webServer起動チェックは保持した。同じ起動障害ならテスト開始前の起動待機が失敗する。追加テストが作成するPNGは `e2e/__screens__/font-repair-home.png` と `e2e/__screens__/font-repair-signin.png`。どちらも改訂版の画面で、旧SHAの前後比較ではない。

ホストでアプリ・SDK・ビルド・テストを実行していない。上記は実装済みの検証シナリオであり、成功実績ではない。コントローラーの隔離CIで追加テスト、既存の認証・ボード・モックAIテスト、型検査が通ることが受入条件。独立Claudeレビューの実装後結果は未受領で、指摘・対応は未記録。レビュー・CIが完了するまで復旧成功や品質合格とは扱わない。

週次判断: システム書体による字形・改行差を許容できるか、専用作業でローカル書体を導入する必要があるか。共有スタイル変更の実AI画面検証を含む後続判定はコントローラー側に残り、本実装では実AIを呼び出していない。
