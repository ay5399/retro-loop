# 判定コントロール設計仕様（前回アクションの判定 行内）

reflection-panel.tsx の「前回アクションの判定」各行 `<li>` に、AI 判定を人間が
**確認 / 上書き / 繰り越し / 打ち切り**するための対話コントロールを足す。
JS 不要。サーバアクションの `<form>` + hidden input で完結（`採用`ボタンと同じ流儀）。
新しい色・トークン・クラスは足さない。既存クラスのみ。

## データ要件（前提）

行を描くのに、現行 `Evaluation` 型へ次の 3 つを追加して渡す:

- `evaluationId: string` … `setEvaluationOutcome` の hidden `evaluationId`
- `actionId: string` … `carryOverAction` / `dropAction` の hidden `actionId`
- `actionStatus: "OPEN" | "DONE" | "DROPPED"` … 追跡状態の表示に使う

サーバアクションは既存のものをそのまま使う（新規実装不要）:
`setEvaluationOutcome`（outcome=WORKED/NOT_WORKED/NOT_DONE）、`carryOverAction`、`dropAction`。

## 行レイアウト（既存構造を踏襲）

```
<li> … border-l-2 border-line pl-3     ← 既存のまま
  ├ [1] 見出し行  flex items-center gap-2
  │     └ <span class="badge {色}">判定ラベル</span> + <span class="text-sm font-medium">アクション文</span>
  ├ [2] reason    mt-1 text-sm text-muted            ← 既存のまま（あれば）
  ├ [3] コントロール域  mt-2                          ← 今回の追加。状態で中身が変わる
```

コントロール域のボタン群は 1 本の行に:
`<div class="mt-2 flex flex-wrap items-center gap-2">`
先頭に小ラベルを置く場合は `<span class="eyebrow">回答</span>` を同 flex 内に。

## 状態 → コントロール 対応表

| 状態 | 判定バッジ | コントロール域 [3] の中身 |
|---|---|---|
| **確認中**（outcome=null かつ question あり） | `badge text-warn`「確認中」 | question を `text-sm text-warn` で表示（既存）。直下に **3択回答** を常時展開 |
| **効いた**（WORKED） | `badge text-keep`「効いた」 | `badge text-keep`「完了」の状態表示のみ。上書き用 `<details>` |
| **効いてない**（NOT_WORKED） | `badge text-problem`「効いてない」 | **繰り越す / 打ち切る** ＋ 追跡状態バッジ。上書き用 `<details>` |
| **未着手**（NOT_DONE） | `badge text-muted`「未着手」 | **繰り越す / 打ち切る** ＋ 追跡状態バッジ。上書き用 `<details>` |

確定済み（WORKED/NOT_WORKED/NOT_DONE）は上書き導線を `<details>` に畳む。確認中は 3 択を露出。

## 追跡状態バッジ（action.status）

見出し行 [1] の末尾、または コントロール域の先頭に置く。

| status | ラベル | クラス |
|---|---|---|
| OPEN | 追跡中 | `badge text-iris` |
| DROPPED | 打ち切り済 | `badge text-muted` |
| DONE | 完了 | `badge text-keep` |

## パーツ仕様

### A. 3択回答（確認中で露出／確定済みは details 内）

`setEvaluationOutcome` へ 1 フォーム・3 送信ボタン。ボタン自身が `name="outcome"` で値を運ぶので
hidden は evaluationId のみ。

```
<form action={setOutcome} class="flex flex-wrap items-center gap-2">
  <input type="hidden" name="evaluationId" value={ev.evaluationId} />
  <button type="submit" name="outcome" value="WORKED"     class="btn btn-ghost btn-sm">効いた</button>
  <button type="submit" name="outcome" value="NOT_WORKED" class="btn btn-ghost btn-sm">効いてない</button>
  <button type="submit" name="outcome" value="NOT_DONE"   class="btn btn-ghost btn-sm">未着手</button>
</form>
```

- `setOutcome = setEvaluationOutcome.bind(null, teamId, retroId)`
- 3 ボタンは色付けしない（`btn-ghost` のみ）。意味色は判定バッジが担う。primary は使わない（画面主 CTA「問い返す」に予約）。

### B. 上書き導線（確定済みの行）

既存の「JS 不要 `<details>`」パターン。要約に「判定を変える」。開くと A の 3択フォームを出す。

```
<details class="mt-2">
  <summary class="eyebrow cursor-pointer select-none">判定を変える</summary>
  <div class="mt-2">
    {/* A. 3択フォーム（同じ markup） */}
  </div>
</details>
```

### C. 繰り越す / 打ち切る（NOT_WORKED・NOT_DONE の行）

`carryOverAction` / `dropAction` へそれぞれ別フォーム。hidden は actionId。

```
<div class="flex flex-wrap items-center gap-2">
  <span class="badge {追跡状態の色}">{追跡状態ラベル}</span>
  <form action={carryOver}><input type="hidden" name="actionId" value={ev.actionId} />
    <button type="submit" class="btn btn-ghost btn-sm">繰り越す</button></form>
  <form action={drop}><input type="hidden" name="actionId" value={ev.actionId} />
    <button type="submit" class="btn btn-ghost btn-sm">打ち切る</button></form>
</div>
```

- `carryOver = carryOverAction.bind(null, teamId, retroId)` / `drop = dropAction.bind(null, teamId, retroId)`
- 既に DROPPED の行は「打ち切る」を出さず「繰り越す」のみ（元に戻せる）。
- 上書き `<details>`（B）はこの下に併置。

### D. 効いた（WORKED）の行

追跡状態バッジ `badge text-keep`「完了」を表示するのみ。繰り越す/打ち切るは出さない。
誤判定に備え、上書き導線 B（`判定を変える`）だけ残す。

## 余白・文言まとめ

- コントロール域の上マージン: `mt-2`（reason と同じリズム）。ボタン間: `gap-2`。
- `<details>` の要約は `eyebrow`（モノスペース小見出し）で控えめに。
- ボタン文言: 効いた / 効いてない / 未着手 / 繰り越す / 打ち切る / 判定を変える。
- 追跡状態ラベル: 追跡中 / 打ち切り済 / 完了。
- ボタンは全て `btn btn-ghost btn-sm`。強調色はバッジのみが担う。
