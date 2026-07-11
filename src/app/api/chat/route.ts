import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

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
  ].join("\n");

  // @ai-sdk/google の既定 env は GOOGLE_GENERATIVE_AI_API_KEY のため、既存キーを明示的に渡す
  const google = createGoogleGenerativeAI({ apiKey });

  const result = streamText({
    model: google("gemini-2.5-flash"),
    system,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
