import { timingSafeEqual } from "node:crypto";
import { externalServiceEnabled } from "@/lib/service-policy";

// Internal release verification: no database access and no public configuration leak.
export async function GET(request: Request) {
  const expected = process.env.HEALTHCHECK_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!expected || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json({
    sha: process.env.AUTOMATION_RELEASE_SHA ?? null,
    liveLlm: externalServiceEnabled("llm"),
    liveEmail: externalServiceEnabled("email"),
    keysPresent: ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "AUTH_RESEND_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"].some(key => Boolean(process.env[key])),
  }, { headers: { "Cache-Control": "no-store" } });
}
