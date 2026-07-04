import Anthropic from "@anthropic-ai/sdk";

// Claude API クライアント（サーバ側専用）。
// 「問い返し」は tool use による構造化出力で受け取る方針（docs/DECISIONS.md）。
// ANTHROPIC_API_KEY は .env で設定する。
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// 既定モデル。用途に応じて呼び出し側で上書き可。
export const CLAUDE_MODEL = "claude-sonnet-5";
