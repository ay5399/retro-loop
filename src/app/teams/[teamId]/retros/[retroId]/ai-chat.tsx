"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

// ふりかえり画面に併設するAIチャットアシスタント（ストリーミング表示）。
// Vercel AI SDK の useChat と /api/chat を接続する。
// - transport の body で retroId / teamId をサーバへ渡す（認可に使用）
// - 入力状態は自前で管理し sendMessage({ text }) で送信（AI SDK v5+ の作法）
const SUGGESTIONS = ["今回の総括をして", "改善のヒントをちょうだい", "次に試すべきことは?"];

export function AiChat({ teamId, retroId }: { teamId: string; retroId: string }) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: { retroId, teamId },
    }),
  });

  const busy = status === "submitted" || status === "streaming";

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendMessage({ text: trimmed });
    setInput("");
  }

  return (
    <div className="card space-y-4" data-ai-chat>
      <div className="flex flex-col gap-3">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              KPTの付箋をもとに、総括や助言をAIに相談できます。
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => submit(s)}
                  disabled={busy}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {messages.map((m) => {
              const text = m.parts
                .filter((p) => p.type === "text")
                .map((p) => (p as { text: string }).text)
                .join("");
              const isUser = m.role === "user";
              return (
                <li
                  key={m.id}
                  className={isUser ? "flex justify-end" : "flex justify-start"}
                >
                  <div
                    className={
                      isUser
                        ? "max-w-[85%] rounded-2xl bg-iris px-4 py-2 text-sm text-iris-ink whitespace-pre-wrap"
                        : "max-w-[85%] rounded-2xl bg-surface-2 px-4 py-2 text-sm whitespace-pre-wrap"
                    }
                  >
                    {text || (busy && !isUser ? "…" : "")}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <input
          className="field flex-1"
          placeholder="AIアシスタントに相談…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          data-chat-input
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || input.trim().length === 0}
          data-chat-send
        >
          {busy ? "応答中…" : "送信"}
        </button>
      </form>
    </div>
  );
}
