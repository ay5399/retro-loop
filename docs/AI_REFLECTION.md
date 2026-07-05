# AI問い返し（Reflection）設計

最終更新：2026-07-05 / ステータス：**ドラフト（相原さんレビュー待ち）**

> 差別化の核。AIに「何を渡し」「どんなJSONで返させ」「どう保存するか」を定義する。
> ペルソナ＝作者のSM実績（形骸化を問い続ける習慣）を落とし込む所。

## 1. AIに渡す入力

1回のふりかえりで「AI問い返し」ボタンを押すと、次を渡す：
- **今回のKPT付箋**：Keep / Problem / Try（本文の配列）
- **前回のOPENアクション**：`{id, content}` の配列（効果を判定する対象）
- **ナレッジ**：これまでの確定アクション＋その判定＋過去の問い返し（チーム単位の履歴。件数が多ければ要約）

## 2. AIに返させる構造（JSON）

```jsonc
{
  // (a) 前回アクションの効果判定（前回OPENアクションごとに1件）
  "evaluations": [
    {
      "actionId": "対象アクションのid",
      "outcome": "WORKED | NOT_WORKED | NOT_DONE | null", // null=付箋から判断できない
      "reason": "判定の根拠（今回の付箋のどこから読み取ったか）",
      "question": "outcome=null のとき、ユーザーへの確認質問（例：輪番制は機能しましたか?）",
      "suggestion": "continue | revise | drop | null" // 効いてない/未着手のときの扱い提案
    }
  ],
  // (b) 問い返し（形骸化チェック＝この製品の顔）
  "probes": [
    { "question": "その再発防止、形骸化してない?", "focus": "何について問うているか" }
  ],
  // (c) 新しい改善アクション案
  "proposedActions": [
    { "content": "具体的なアクション", "rationale": "なぜこれか（どのProblem/Tryに効くか）" }
  ]
}
```

## 3. ペルソナ（システム指示）

> あなたは経験豊富なスクラムマスターです。チームのふりかえりに同席し、**過去を整理するのではなく、改善が本当に根付くかを問い続ける**役割を担います。
>
> 守ること：
> - **前回のアクションの効果は、今回の付箋（KPT）を根拠に判定**する。付箋に手がかりがあれば WORKED/NOT_WORKED/NOT_DONE を選び、根拠(reason)を必ず示す。**手がかりが無ければ推測せず、outcome を null にしてユーザーに確認の質問(question)を投げる**。
> - **問い返し(probes)は、耳あたりの良い要約をしない**。「そのアクションは本当に再発防止になっているか」「形だけになっていないか」「効果をどう確かめるのか」を、具体的な付箋・アクションに紐づけて突く。
> - 新アクション案(proposedActions)は、**Problem に効く具体・検証可能なもの**を出す。精神論や『気をつける』の類は出さない。
> - 断定しすぎない。チームが自分で気づけるよう問いを立てる。日本語で、簡潔に。

## 4. 保存とループ（データモデルへの反映）

ボタン実行時：
1. **Reflection** を1件作成（model名 + probes + rawOutput 全体を保存）。
2. **evaluations** を前回アクションごとに **ActionEvaluation** として保存（evaluatedInRetro=今回, source=AI, outcome/reason/question）。
   - outcome=WORKED → 対象 Action.status=DONE。
   - outcome=null → 確認中（ユーザーが後で回答して確定）。
3. **proposedActions** は表示。ユーザーが「採用」すると **Action**（status=OPEN, sourceReflection=今回）を作成 → 次回の判定対象になる＝**ループが閉じる**。

## 5. 実装の段取り（ブラウザ検証しながら）
- Step1（本コミット）：ボタン→AI実行→結果表示（判定/問い返し/案）＋Reflection保存＋AI自動判定の保存。検証は `LLM_PROVIDER=mock` で全フロー。
- Step2：proposedActions の「採用」→ Action 作成（ループを閉じる）。
- Step3：AI判定のユーザー上書き／確認質問への回答／繰り越し・打ち切り。
- 最後：`GEMINI_API_KEY` 設定 → `LLM_PROVIDER=gemini` に切替え、本物の問い返しの質を確認。

## 6. レビューしてほしい点
- ペルソナの語り口・厳しさの度合い（もっと厳しく/優しく？）
- probes は何個くらい返させる？（既定：1〜3）
- proposedActions の個数（既定：1〜3）
