// Gemini 疎通テスト: .env の GEMINI_API_KEY で小さくJSONを1回生成する。
import { readFileSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";

// .env を素朴に読む
const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const key = env.GEMINI_API_KEY;
const model = env.GEMINI_MODEL || "gemini-2.5-flash";
console.log("key prefix:", key ? key.slice(0, 6) + "..." : "(none)", "| model:", model);

try {
  const ai = new GoogleGenAI({ apiKey: key });
  const res = await ai.models.generateContent({
    model,
    contents: 'JSONで {"ok": true, "greeting": "..."} を返して。greetingは短い日本語で。',
    config: { responseMimeType: "application/json" },
  });
  console.log("OK response:", res.text);
} catch (e) {
  console.error("ERROR:", e?.message ?? e);
}
