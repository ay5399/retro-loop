import { GoogleGenAI } from "@google/genai";
import type { LlmProvider, StructuredRequest } from "./types";

// Gemini（Google AI Studio 無料枠）プロバイダ。
// responseMimeType=application/json で JSON 出力を強制する。
export function geminiProvider(): LlmProvider {
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

  return {
    name: "gemini",
    model,
    async generateJson(req: StructuredRequest): Promise<string> {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error(
          "GEMINI_API_KEY が未設定です。https://aistudio.google.com で取得して .env に設定してください。",
        );
      }

      const ai = new GoogleGenAI({ apiKey });
      const res = await ai.models.generateContent({
        model,
        contents: req.prompt,
        config: {
          systemInstruction: req.system,
          responseMimeType: "application/json",
        },
      });

      const text = res.text;
      if (!text) throw new Error("Gemini から空の応答が返りました。");
      return text;
    },
  };
}
