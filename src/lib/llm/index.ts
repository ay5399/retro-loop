import { geminiProvider } from "./gemini";
import { externalServiceEnabled } from "@/lib/service-policy";
import type { LlmProvider, StructuredRequest } from "./types";

export type { LlmProvider, StructuredRequest } from "./types";

// LLM_PROVIDER 環境変数でプロバイダを選ぶ（既定 gemini）。
// 差し替えたいときはここに case を足すだけ（例：claude）。
export function getLlm(): LlmProvider {
  if (process.env.LLM_PROVIDER === "mock") {
    return { name: "mock", model: "mock", async generateJson() {
      return JSON.stringify({ evaluations: [], probes: [], proposedActions: [] });
    } };
  }
  if (!externalServiceEnabled("llm")) throw new Error("AIは費用設定の確認待ちです。");
  const provider = process.env.LLM_PROVIDER ?? "gemini";
  switch (provider) {
    case "gemini":
      return geminiProvider();
    // case "claude":
    //   return claudeProvider();
    default:
      throw new Error(`未知の LLM_PROVIDER: ${provider}`);
  }
}

// 構造化（JSON）生成の共通入口。呼び出し側はプロバイダを意識しない。
export async function generateStructured<T>(req: StructuredRequest): Promise<T> {
  const llm = getLlm();
  const text = await llm.generateJson(req);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `LLM 応答を JSON として解釈できませんでした（先頭200字）: ${text.slice(0, 200)}`,
    );
  }
}
