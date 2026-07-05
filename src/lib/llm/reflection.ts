import { z } from "zod";
import { generateStructured, getLlm } from "./index";

// ── AI問い返しの構造（docs/AI_REFLECTION.md）───────────
// LLM によっては文字列配列で返すことがあるため、文字列でもオブジェクトでも受ける。
const ProbeSchema = z.union([
  z.string().transform((s) => ({ question: s, focus: "" })),
  z.object({ question: z.string(), focus: z.string().default("") }),
]);
const ProposedActionSchema = z.union([
  z.string().transform((s) => ({ content: s, rationale: "" })),
  z.object({ content: z.string(), rationale: z.string().default("") }),
]);

export const ReflectionResultSchema = z.object({
  // (a) 前回アクションの効果判定
  evaluations: z
    .array(
      z.object({
        actionId: z.string(),
        // null = 付箋から判断できない（question で確認する）
        outcome: z.enum(["WORKED", "NOT_WORKED", "NOT_DONE"]).nullable().default(null),
        reason: z.string().default(""),
        question: z.string().nullable().default(null),
        suggestion: z.enum(["continue", "revise", "drop"]).nullable().default(null),
      }),
    )
    .default([]),
  // (b) 問い返し（形骸化チェック）
  probes: z.array(ProbeSchema).default([]),
  // (c) 新しい改善アクション案
  proposedActions: z.array(ProposedActionSchema).default([]),
});
export type ReflectionResult = z.infer<typeof ReflectionResultSchema>;

export type ReflectionInput = {
  notes: { kind: "KEEP" | "PROBLEM" | "TRY"; content: string }[];
  previousActions: { id: string; content: string }[];
  knowledge: { action: string; outcome: string | null; reason?: string | null }[];
};

const SYSTEM = `あなたは経験豊富なスクラムマスターです。チームのふりかえりに同席し、過去を整理するのではなく、改善が本当に根付くかを問い続ける役割を担います。

守ること:
- 前回のアクションの効果は、今回の付箋(KPT)を根拠に判定する。付箋に手がかりがあれば WORKED/NOT_WORKED/NOT_DONE を選び、根拠(reason)を必ず示す。手がかりが無ければ推測せず、outcome を null にしてユーザーに確認の質問(question)を投げる。
- 問い返し(probes)は耳あたりの良い要約をしない。「そのアクションは本当に再発防止になっているか」「形だけになっていないか」「効果をどう確かめるのか」を、具体的な付箋やアクションに紐づけて突く。
- 新アクション案(proposedActions)は Problem に効く具体的で検証可能なものにする。精神論や「気をつける」の類は出さない。
- 日本語で簡潔に。断定しすぎず、チームが自分で気づける問いを立てる。`;

function buildPrompt(input: ReflectionInput): string {
  const notes = input.notes.map((n) => `- [${n.kind}] ${n.content}`).join("\n") || "（付箋なし）";
  const prev =
    input.previousActions.length > 0
      ? JSON.stringify(input.previousActions)
      : "[]";
  const knowledge =
    input.knowledge.length > 0
      ? JSON.stringify(input.knowledge)
      : "（履歴なし）";

  return `# 今回のふりかえりの付箋(KPT)
${notes}

# 前回のOPENアクション（このJSONの id をそのまま evaluations.actionId に使うこと）
${prev}

# これまでのナレッジ（過去のアクションと結果）
${knowledge}

上記をもとに、次の**厳密なJSON形式**で返してください（キー名・入れ子・型を守ること）:

{
  "evaluations": [
    { "actionId": "前回アクションのid", "outcome": "WORKED" | "NOT_WORKED" | "NOT_DONE" | null, "reason": "判定の根拠(今回の付箋のどこから読み取ったか)", "question": "outcomeがnullのときの確認質問、それ以外はnull", "suggestion": "continue" | "revise" | "drop" | null }
  ],
  "probes": [
    { "question": "問い返しの文", "focus": "何について問うているか" }
  ],
  "proposedActions": [
    { "content": "具体的な改善アクション", "rationale": "なぜこれか" }
  ]
}

制約: probes と proposedActions は必ず上記の**オブジェクト**の配列にする（文字列の配列にしない）。probes・proposedActions は各1〜3件。前回アクションが空なら evaluations は空配列にする。`;
}

// 本体：入力を組み立てて LLM に投げ、検証済みの構造を返す。
// LLM_PROVIDER=mock のときはキー無しで全フローを検証するためのダミーを返す。
export async function reflect(input: ReflectionInput): Promise<ReflectionResult> {
  if ((process.env.LLM_PROVIDER ?? "gemini") === "mock") {
    return mockReflection(input);
  }
  const raw = await generateStructured<unknown>({
    system: SYSTEM,
    prompt: buildPrompt(input),
  });
  return ReflectionResultSchema.parse(raw);
}

// 使用中のモデル表示名（Reflection.model に保存）
export function llmModelLabel(): string {
  if ((process.env.LLM_PROVIDER ?? "gemini") === "mock") return "mock";
  return getLlm().model;
}

// ── 検証用モック（キー無しで配線・画面・保存を確認する）──
function mockReflection(input: ReflectionInput): ReflectionResult {
  const problems = input.notes.filter((n) => n.kind === "PROBLEM").map((n) => n.content);

  const evaluations: ReflectionResult["evaluations"] = input.previousActions.map(
    (a, i) => {
      const mode = i % 3;
      if (mode === 0) {
        return {
          actionId: a.id,
          outcome: "WORKED" as const,
          reason: "今回の Keep に改善を示す言及があり、効果があったと読み取れる。",
          question: null,
          suggestion: null,
        };
      }
      if (mode === 1) {
        return {
          actionId: a.id,
          outcome: null,
          reason: "今回の付箋からは効果を判断できる手がかりが見つからない。",
          question: `「${a.content}」は実際に機能しましたか？`,
          suggestion: null,
        };
      }
      return {
        actionId: a.id,
        outcome: "NOT_WORKED" as const,
        reason: "同種の Problem が今回も挙がっており、改善が根付いていない可能性がある。",
        question: null,
        suggestion: "revise" as const,
      };
    },
  );

  const probes: ReflectionResult["probes"] = [
    {
      question:
        problems.length > 0
          ? `「${problems[0]}」の再発防止は、仕組みで防げていますか？それとも個人の注意頼みですか？`
          : "今回の Try は、効果をどうやって確かめるつもりですか？",
      focus: "形骸化のチェック",
    },
    {
      question: "前回うまくいった改善は、なぜうまくいったのか言語化できていますか？",
      focus: "成功の再現性",
    },
  ];

  const proposedActions: ReflectionResult["proposedActions"] =
    problems.length > 0
      ? [
          {
            content: `「${problems[0]}」を検知する仕組み（チェックリストや自動チェック）を1つ導入する`,
            rationale: "注意喚起でなく仕組みにすることで再発防止を形骸化させない。",
          },
        ]
      : [
          {
            content: "次スプリントで検証する指標を1つ決める",
            rationale: "効果を測れる形にして改善ループを閉じる。",
          },
        ];

  return { evaluations, probes, proposedActions };
}
