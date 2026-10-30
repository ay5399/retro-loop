"use client";

import { useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, generateId, type UIMessage, type UIMessageChunk } from "ai";

// Lifecycle streams require finish. The existing standalone text writer emits
// no lifecycle events, so accept EOF only after all of its text blocks close.
class CompleteChatTransport extends DefaultChatTransport<UIMessage> {
  protected processResponseStream(stream: ReadableStream<Uint8Array<ArrayBufferLike>>) {
    let finished = false;
    let textOnly = true;
    let closedText = false;
    const openText = new Set<string>();
    return super.processResponseStream(stream).pipeThrough(
      new TransformStream<UIMessageChunk, UIMessageChunk>({
        transform(chunk, controller) {
          if (chunk.type === "finish") finished = true;
          if (chunk.type === "text-start") openText.add(chunk.id);
          else if (chunk.type === "text-end") {
            closedText = openText.delete(chunk.id) || closedText;
          } else if (chunk.type !== "text-delta") textOnly = false;
          controller.enqueue(chunk);
        },
        flush() {
          const completeStandaloneText = textOnly && closedText && openText.size === 0;
          if (!finished && !completeStandaloneText) throw new Error("Incomplete chat response");
        },
      }),
    );
  }
}

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
  const pending = useRef<{ id: string; text: string } | null>(null);
  const sending = useRef(false);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  function restoreDraft() {
    if (!pending.current) return;
    setInput(pending.current.text);
    setFailedId(pending.current.id);
  }
  const { messages, sendMessage, status, stop } = useChat({
    transport: new CompleteChatTransport({
      api: "/api/chat",
      body: { retroId, teamId },
    }),
    onError: restoreDraft,
    onFinish: ({ isAbort, isDisconnect, isError, finishReason }) => {
      if (isAbort || isDisconnect || isError || finishReason === "error") {
        restoreDraft();
        setStopped(isAbort);
      } else {
        pending.current = null;
      }
    },
  });

  const busy = status === "submitted" || status === "streaming";
  const hasDraft = input.length > 0;
  const failedIndex = failedId ? messages.findIndex((message) => message.id === failedId) : -1;

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || sending.current) return;
    sending.current = true;
    const id = failedId ?? generateId();
    // Keep the exact draft for recovery; preserve the existing trimmed payload.
    pending.current = { id, text };
    setFailedId(null);
    setStopped(false);
    setInput("");
    // Replacing the failed user turn also discards its incomplete response.
    const request = failedId
      ? sendMessage({ text: trimmed, messageId: failedId })
      : sendMessage({ id, role: "user", parts: [{ type: "text", text: trimmed }] });
    void request.catch(restoreDraft).finally(() => { sending.current = false; });
  }

  function submitSuggestion(text: string) {
    if (hasDraft) return;
    submit(text);
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
                  onClick={() => submitSuggestion(s)}
                  disabled={busy || hasDraft}
                  aria-describedby={hasDraft ? "consultation-draft-guard" : undefined}
                >
                  {s}
                </button>
              ))}
            </div>
            {hasDraft ? (
              <p id="consultation-draft-guard" className="text-sm text-muted">
                入力中の相談文を守るため、候補は使えません。入力欄の送信から相談できます。
              </p>
            ) : null}
          </div>
        ) : (
          <ul className="space-y-3">
            {messages.map((m, index) => {
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
                    {!isUser && failedIndex >= 0 && index > failedIndex ? (
                      <p className="text-xs text-muted">未完了の応答です。再送すると置き換わります。</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {failedId ? (
        <p role={stopped ? "status" : "alert"} data-chat-error className={stopped ? "text-sm text-muted" : "text-sm text-red-700"}>
          {stopped ? "応答を中止しました。" : "AIの応答を完了できませんでした。"}相談文を入力欄に戻しました。内容を確認・編集して「送信」を押してください。自動では再送しません。
        </p>
      ) : null}
      {busy ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void stop(); }}>
          応答を中止
        </button>
      ) : null}
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
