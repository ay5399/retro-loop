# RetroLoop — データモデル（MVP）たたき台

最終更新：2026-07-05 / ステータス：**確定（全論点レビュー済み）**

> `docs/REQUIREMENTS.md` の要件から導いたデータモデル。
> ここをレビュー・確定してから `prisma/schema.prisma` に落とす。
> **［要レビュー］** は私（Claude）の設計判断。

## 変更履歴
- v2（2026-07-05）: 中心概念を **Sprint → Retrospective（ふりかえり）に一般化**（スプリント以外の振り返りでも使う）。前後関係を **明示リンク `previousRetrospectiveId`** で保持。Retrospective の status を廃止。

---

## 1. 全体像（ER 概観）

```
User ──< Membership >── Team ──< Retrospective ──< Note
                          │            │  │
                          │            │  └──< Reflection (AIの1回の応答)
                          │            └─ previousRetrospectiveId (自己リンク: 前回のふりかえり)
                          │
                          └──< Action ──< ActionEvaluation
                               (改善策)     (各ふりかえりでの効果判定・1件ずつ)
```

- **Retrospective（ふりかえり）** が中心単位。スプリントレトロに限らず、月次・プロジェクト・インシデント振り返り等でも使えるよう一般化。
- 前後関係は **`previousRetrospectiveId`（自己リンク）** で明示。＝ 時系列順に依存せず、複数の振り返り系列（例：スプリント系列と月次系列）が並行しても正しく辿れる。
- **認証系**（User / Account / Session / VerificationToken）は Auth.js 用。既に schema にある。

---

## 2. エンティティ定義

### Team（チーム）
ふりかえりを行う単位。
| フィールド | 型 | 説明 |
|---|---|---|
| id | string (cuid) | PK |
| name | string | チーム名 |
| createdAt / updatedAt | datetime | |

関連：`Membership[]`, `Retrospective[]`, `Action[]`

---

### Membership（所属）
User と Team の関連。MVPは権限を分けない。
| フィールド | 型 | 説明 |
|---|---|---|
| id | string | PK |
| userId | string (FK User) | |
| teamId | string (FK Team) | |
| createdAt | datetime | |

制約：`@@unique([userId, teamId])`
［要レビュー］role は持たない（全員同権限）。将来の権限管理で追加。

---

### Retrospective（ふりかえり）★中心単位
ふりかえり1回＝1レコード。スプリントレトロ以外の振り返りにも使える。
| フィールド | 型 | 説明 |
|---|---|---|
| id | string | PK |
| teamId | string (FK Team) | |
| name | string | 例「Sprint 12 振り返り」「10月 月次振り返り」。自由入力 |
| previousRetrospectiveId | string? (FK 自己) | **前回のふりかえり**を明示リンク。効果追跡はこの前回のOPENアクションを対象にする。最初の回は null |
| createdAt / updatedAt | datetime | |

関連：`Note[]`, `Reflection[]`, `Action[]`(createdInRetro), `ActionEvaluation[]`(evaluatedInRetro), `previous`(自己), `nexts[]`(自己逆参照)
- ［要レビュー：status廃止］OPEN/CLOSED は持たない（前回レビューで「いらない」）。
- ［要レビュー：previous の選び方］新規作成時、既定で「同チームの直近のふりかえり」を previous に自動セット。ユーザーが別の系列を追いたい場合は選び直せる（UIはMVPでは自動セットのみでも可）。
- ［要レビュー：将来拡張］振り返りの種類（スプリント/月次/PJ 等）を区別したくなったら `kind` を後で足す。MVPでは持たない。

---

### Note（付箋 / KPT）
| フィールド | 型 | 説明 |
|---|---|---|
| id | string | PK |
| retrospectiveId | string (FK Retrospective) | |
| authorId | string (FK User) | 誰が書いたか |
| kind | enum NoteKind | KEEP / PROBLEM / TRY |
| content | string (text) | 本文 |
| createdAt / updatedAt | datetime | |

---

### Reflection（AI問い返しの1回の応答）
ボタン押下1回＝1レコード（再実行すると増える＝履歴が残る）。
| フィールド | 型 | 説明 |
|---|---|---|
| id | string | PK |
| retrospectiveId | string (FK Retrospective) | どのふりかえりで実行したか |
| model | string | 使ったClaudeモデル名（再現性・監査用） |
| questions | json | 「その再発防止、形骸化してない?」等の問い返し文（構造化） |
| rawOutput | json | AIの構造化出力まるごと（判定・問い返し・アクション案）を保存 |
| createdAt | datetime | |

AIの生出力を rawOutput に丸ごと残す（振り返り・プロンプト改善・監査に使える）。→ 前回レビューOK。

---

### Action（改善アクション）★このプロダクトの主役
ふりかえりで生まれ、以降のふりかえりで効果を追跡され続ける。
| フィールド | 型 | 説明 |
|---|---|---|
| id | string | PK |
| teamId | string (FK Team) | ナレッジはチーム単位で追う |
| createdInRetrospectiveId | string (FK Retrospective) | 生まれたふりかえり |
| sourceReflectionId | string? (FK Reflection) | どのAI応答由来か（手動追加なら null） |
| content | string (text) | アクション内容（AI案を人が編集して確定） |
| status | enum ActionStatus | OPEN(追跡中) / DONE(効いた→完了) / DROPPED(打ち切り) |
| createdAt / updatedAt | datetime | |

**現在の効果**＝最新の ActionEvaluation.outcome（Actionに最新結果は持たせず都度算出）。→ 前回レビューOK。

---

### ActionEvaluation（効果判定：ふりかえりごとに1件）★効果追跡ループの心臓
「あるアクションを、あるふりかえりでどう評価したか」を1レコードで表す。
次のふりかえりで再評価すると新しい行が増える＝**判定の履歴が残る**（＝ナレッジになる）。
| フィールド | 型 | 説明 |
|---|---|---|
| id | string | PK |
| actionId | string (FK Action) | 対象アクション |
| evaluatedInRetrospectiveId | string (FK Retrospective) | どのふりかえりでの判定か |
| outcome | enum ActionOutcome? | WORKED / NOT_WORKED / NOT_DONE。**null = 確認中**（AIが判定できずユーザに問い返し中） |
| source | enum EvaluationSource | AI（自動判定）/ HUMAN（人が確定・上書き） |
| reason | string? (text) | 判定理由（AIの根拠、または人のコメント） |
| question | string? | AIが判定できずユーザに投げた問い返し文（outcome=null のとき） |
| createdAt / updatedAt | datetime | |

制約：`@@unique([actionId, evaluatedInRetrospectiveId])`（1ふりかえりにつき1アクション1判定。上書きは同じ行を更新）→ 前回レビュー「いったんOK」。

**状態の流れ**：
- 次のふりかえりのAI問い返し実行 → 前回ふりかえりの OPEN アクションごとに ActionEvaluation を作る
  - 付箋に手がかりあり → outcome を AI がセット（source=AI, reason=根拠）
  - 手がかり無し → outcome=null + question をセット（＝確認中）。ユーザが答える → outcome セット, source=HUMAN
- 人が上書き → 同行を outcome 更新, source=HUMAN
- outcome=WORKED → Action.status=DONE。NOT_WORKED/NOT_DONE → 人が繰り越し(OPEN維持) or 打ち切り(DROPPED)

---

## 3. Enum 一覧

| Enum | 値 |
|---|---|
| NoteKind | KEEP, PROBLEM, TRY |
| ActionStatus | OPEN, DONE, DROPPED |
| ActionOutcome | WORKED（効いた）, NOT_WORKED（効いてない）, NOT_DONE（未着手） |
| EvaluationSource | AI, HUMAN |

（SprintStatus は廃止。ActionOutcome の「確認中」は ActionEvaluation.outcome = null で表現）

---

## 4. ナレッジの持ち方（要件§7-8）

MVPは**専用テーブルを作らない**。ナレッジ＝既存テーブルからの読み出しで構成：
- そのチームの過去 Action ＋ 各 ActionEvaluation（outcome/reason）＋ 過去 Reflection.questions
- これらを集めてAI問い返しの入力に渡す。

AIが要約した KnowledgeDigest テーブルは v1 で追加。→ 前回レビューOK。

---

## 5. ループがテーブルにどう乗るか（具体例）

```
ふりかえり#12「Sprint 12 振り返り」 (previous = #11):
  Note(PROBLEM, "レビュー滞留")、Note(TRY, "レビュー担当を輪番に")
  → Reflection 実行
  → Action A「レビュー担当を輪番制にする」status=OPEN, createdInRetro=#12

ふりかえり#13「Sprint 13 振り返り」 (previous = #12):
  Note(KEEP, "レビューが速くなった") 等を書く
  → Reflection 実行。previous(#12) の OPEN アクション A を付箋から WORKED と判定
     → ActionEvaluation(actionA, evaluatedInRetro=#13, outcome=WORKED, source=AI, reason="Keepでレビュー改善に言及")
     → Action A.status=DONE
  → 付箋に手がかり無ければ outcome=null, question="輪番制は機能しましたか?" → ユーザ回答で確定
  → 新しい Action B が生まれる … 以降ループ
```
*previous リンクで辿るので、#12→#13 がスプリント連番でなく「月次振り返り」等でも同じように機能する。*

---

## 6. 設計判断（すべて確定済み）

- ★ previous は新規作成時に同チーム直近を自動リンク（別系列は選び直せる。MVPは自動セットのみでも可）
- ★ 振り返り種別 `kind` はMVPでは持たず、必要時に追加
- ★（旧論点）status廃止 / 明示リンク採用 / rawOutput保存 / 最新結果キャッシュ列なし / evaluation unique / ナレッジ専用テーブルなし

---

## 7. 次アクション
確定したら `prisma/schema.prisma` にドメインモデルを追記 → `prisma migrate dev` でDBへ。
