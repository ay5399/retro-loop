"use client";

import { useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

// ふりかえり画面に併設するAIチャットアシスタント（ストリーミング表示）。
// Vercel AI SDK の useChat と /api/chat を接続する。
// - transport の body で retroId / teamId をサーバへ渡す（認可に使用）
// - 入力状態は自前で管理し sendMessage({ text }) で送信（AI SDK v5+ の作法）
const SUGGESTIONS = [
  "今回の総括をして",
  "前回からの積み残しを指摘して",
  "次に試すべきことは?",
];

// ツール名 → チャットに出す実行中ラベル
const TOOL_LABELS: Record<string, string> = {
  summarizeRetro: "今回の付箋を集計中…",
  flagRecurringIssues: "前回までの積み残しを確認中…",
};

export function AiChat({ teamId, retroId, ownProblems = [] }: {
  teamId: string;
  retroId: string;
  ownProblems?: { id: string; content: string }[];
}) {
  const [input, setInput] = useState("");
  const [problemId, setProblemId] = useState("");
  const [retrying, setRetrying] = useState(false);
  const retryLock = useRef(false);
  const { messages, sendMessage, status, error, regenerate } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: { retroId, teamId },
    }),
  });

  const busy = retrying || status === "submitted" || status === "streaming";

  async function retry() {
    if (!error || busy || retryLock.current) return;
    retryLock.current = true;
    setRetrying(true);
    try {
      await regenerate();
    } finally {
      retryLock.current = false;
      setRetrying(false);
    }
  }

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendMessage({ text: trimmed });
    setInput("");
  }

  return (
    <div className="card space-y-4" data-ai-chat>
      <div className="space-y-2">
        {ownProblems.length > 0 ? (
          <>
            <label className="block text-sm" htmlFor="consultation-problem">自分のProblemから相談する</label>
            <select id="consultation-problem" className="field w-full" value={problemId}
              onChange={(e) => setProblemId(e.target.value)} disabled={busy}>
              <option value="">Problemを選択</option>
              {ownProblems.map((problem) => <option key={problem.id} value={problem.id}>{problem.content}</option>)}
            </select>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !problemId}
              onClick={() => {
                const problem = ownProblems.find((p) => p.id === problemId);
                if (!problem) return;
                const draft = `自分のProblem：\n${problem.content}\n\n自分が実行するアクションを一つ考えたいです。行動・担当・日付の未確定項目は補完せず、私に質問してください。保存前に内容を確認したいです。`;
                setInput((current) => current ? `${current}\n\n${draft}` : draft);
                setProblemId("");
              }}>相談文の下書きに追加</button>
          </>
        ) : <p className="text-sm text-muted">自分のProblemはまだありません。通常の相談も利用できます。</p>}
        <p className="text-xs text-muted">下書きは編集できます。「送信」を押すまでAIには送信されません。アクションは自動保存されません。</p>
      </div>
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
              // ツール呼び出し部分（type が "tool-<name>" / "dynamic-tool"）を拾う
              const toolNames = m.parts
                .filter(
                  (p) => typeof p.type === "string" && p.type.startsWith("tool-"),
                )
                .map((p) => (p.type as string).replace(/^tool-/, ""));
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
                        : "max-w-[85%] space-y-1.5 rounded-2xl bg-surface-2 px-4 py-2 text-sm whitespace-pre-wrap"
                    }
                  >
                    {!isUser && toolNames.length > 0 ? (
                      <div className="space-y-0.5">
                        {toolNames.map((name, i) => (
                          <p
                            key={`${name}-${i}`}
                            className="text-xs text-muted"
                            data-tool-call={name}
                          >
                            🔧 {TOOL_LABELS[name] ?? name}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    {text || (busy && !isUser && toolNames.length === 0 ? "…" : "")}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {(error || retrying) && (
        <div className="space-y-2">
          {error && <p role="alert" className="text-sm">AIの応答を受け取れませんでした。相談内容は会話に残っています。時間をおいて再試行してください。</p>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={retry} disabled={busy}>
            同じ相談で再試行
          </button>
        </div>
      )}

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <textarea
          className="field flex-1"
          rows={4}
          aria-label="AIへの相談文"
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
