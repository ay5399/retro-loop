import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { convertToModelMessages, streamText, stepCountIs, tool, type UIMessage } from "ai";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { buildRetroSummary, buildRecurringIssues } from "@/lib/llm/retro-tools";

// ふりかえり画面のAIチャットアシスタント（ストリーミング）。
// Vercel AI SDK（ai@7 / @ai-sdk/react の useChat）と接続する Route Handler。
// - 認証必須（未ログインは 401）
// - retroId が「そのユーザーがメンバーのチームの retro」であることを prisma で確認
// - 付箋(KPT)を system プロンプトに載せて Gemini でストリーミング応答
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { messages?: UIMessage[]; retroId?: string; teamId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const { messages, retroId, teamId } = body;
  if (!messages || !retroId || !teamId) {
    return new Response("Bad Request", { status: 400 });
  }

  // 認可：この retro が「ユーザーがメンバーのチームの retro」か確認（既存の where パターン）
  const retro = await prisma.retrospective.findFirst({
    where: {
      id: retroId,
      teamId,
      team: { memberships: { some: { userId: session.user.id } } },
    },
    include: {
      notes: { orderBy: [{ kind: "asc" }, { order: "asc" }] },
    },
  });
  if (!retro) {
    return new Response("Forbidden", { status: 403 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response("GEMINI_API_KEY が未設定です。", { status: 500 });
  }

  const notesText =
    retro.notes.length > 0
      ? retro.notes.map((n) => `[${n.kind}] ${n.content}`).join("\n")
      : "（まだ付箋はありません）";

  const system = [
    "あなたはレトロ（ふりかえり）を支援するアシスタントです。",
    `対象のふりかえり: 「${retro.name}」`,
    "以下は今回のKPT付箋です:",
    notesText,
    "チームの総括・助言・質問対応を日本語で簡潔に行ってください。",
    "",
    "ツールを使えます（必ず日本語で自然に結果を要約して返すこと）:",
    "- summarizeRetro: 「今回の総括」「まとめて」等を求められたら使う。投票数の多い付箋を重視して要約する。",
    "- flagRecurringIssues: 「横断」「前回からの積み残し」「放置されてないか」「再発」等を問われたら使う。前回までの Try が今回も未定着でないか、同じ Problem が繰り返されていないかを指摘する。",
  ].join("\n");

  // @ai-sdk/google の既定 env は GOOGLE_GENERATIVE_AI_API_KEY のため、既存キーを明示的に渡す
  const google = createGoogleGenerativeAI({ apiKey });

  const result = streamText({
    model: google("gemini-2.5-flash"),
    system,
    messages: await convertToModelMessages(messages),
    // ツール（読み取り専用・盤面非破壊）。引数は取らず、現在の retro を対象にする。
    tools: {
      summarizeRetro: tool({
        description:
          "今回のふりかえりの付箋を投票数つき・グループつきで取得し、総括の材料にする。",
        inputSchema: z.object({}),
        execute: async () => (await buildRetroSummary(retro.id)) ?? { note: "付箋がありません" },
      }),
      flagRecurringIssues: tool({
        description:
          "前回までのふりかえり（最大3件遡る）の Try / Problem を取得し、未定着の Try や再発している Problem を横断で指摘する材料にする。",
        inputSchema: z.object({}),
        execute: async () => buildRecurringIssues(retro.id),
      }),
    },
    // ツール呼び出し→結果を踏まえた応答、の複数ステップを許可（無料枠保護に上限は低め）
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
