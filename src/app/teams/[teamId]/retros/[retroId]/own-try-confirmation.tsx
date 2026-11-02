"use client";

import { useEffect, useRef, useState } from "react";
import { saveOwnTry } from "./actions";

type Problem = { id: string; content: string };
export function OwnTryConfirmation({ teamId, retroId, userId, ownProblems = [] }: { teamId: string; retroId: string; userId: string; ownProblems?: Problem[] }) {
  const storageKey = `retroloop:own-try-draft:v1:${JSON.stringify([userId, teamId, retroId])}`;
  return <OwnTryDraft key={storageKey} teamId={teamId} retroId={retroId} storageKey={storageKey} ownProblems={ownProblems} />;
}

function OwnTryDraft({ teamId, retroId, storageKey, ownProblems }: { teamId: string; retroId: string; storageKey: string; ownProblems: Problem[] }) {
  const [source, setSource] = useState<Problem | null>(null);
  const [sourceError, setSourceError] = useState(false);
  const [action, setAction] = useState("");
  const [date, setDate] = useState("");
  const [ready, setReady] = useState(false);
  const [draftNotice, setDraftNotice] = useState("");
  useEffect(() => {
    let cancelled = false;
    // Hydration starts with empty fields; never write them over the stored draft.
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw !== null) {
          const draft: unknown = JSON.parse(raw);
          if (typeof draft === "object" && draft !== null && "action" in draft && "date" in draft &&
              typeof draft.action === "string" && typeof draft.date === "string" &&
              (draft.date === "" || /^\d{4}-\d{2}-\d{2}$/.test(draft.date))) {
            if ("source" in draft && typeof draft.source === "object" && draft.source !== null &&
                "id" in draft.source && "content" in draft.source && typeof draft.source.id === "string" && typeof draft.source.content === "string") {
              setSource({ id: draft.source.id, content: draft.source.content });
            }
            setAction(draft.action);
            setDate(draft.date);
            setDraftNotice("未保存の下書きを復元しました。内容を確認してください。");
          } else {
            sessionStorage.removeItem(storageKey);
          }
        }
      } catch {
        setDraftNotice("下書きを復元できませんでした。通常の入力・確認・保存は利用できます。");
      }
      setReady(true);
    });
    return () => { cancelled = true; };
  }, [storageKey]);

  function persistDraft(nextAction: string, nextDate: string, nextSource = source) {
    try {
      // Keep the v1 draft shape compatible when no Problem is selected.
      if (nextAction || nextDate || nextSource) sessionStorage.setItem(storageKey, JSON.stringify({ action: nextAction, date: nextDate, ...(nextSource ? { source: nextSource } : {}) }));
      else sessionStorage.removeItem(storageKey);
      setDraftNotice(nextAction || nextDate || nextSource ? "このタブに一時保持しています。Try付箋としては未保存です。" : "");
    } catch {
      setDraftNotice("このタブに下書きを保持できません。再読み込み前にTry付箋として保存してください。");
    }
  }
  const [step, setStep] = useState<"edit" | "confirm" | "saved">("edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const valid = action.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);

  function confirm() {
    if (!valid) return;
    setError(false);
    setSourceError(false);
    const current = ownProblems.find((problem) => problem.id === source?.id);
    if (source && !current) {
      setSourceError(true);
      return;
    }
    if (current) {
      setSource(current);
      persistDraft(action, date, current);
    }
    setStep("confirm");
  }

  async function save() {
    if (!valid || step !== "confirm" || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(false);
    const data = new FormData();
    data.set("action", action);
    data.set("date", date);
    data.set("problemId", source?.id ?? "");
    data.set("problemContent", source?.content ?? "");
    try {
      const result = await saveOwnTry(teamId, retroId, data);
      if (result.problemChanged) {
        setSourceError(true);
        setStep("edit");
        return;
      }
      setSource(null);
      persistDraft("", "", null);
      setStep("saved");
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <section aria-label="自分のTryを確認・保存" className="space-y-3 border-t pt-4">
      <h2 className="font-semibold">自分で決めた行動をTryに残す</h2>
      <p className="text-sm text-muted">相談で決めた行動と日付を自分で入力してください。担当はログイン中の本人です。AIの応答からは自動入力しません。</p>
      {step === "edit" ? (
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); confirm(); }}>
          <label className="block">元Problem（任意）
            <select className="field w-full" disabled={!ready} value={source?.id ?? ""} onChange={(event) => {
              const next = ownProblems.find((problem) => problem.id === event.target.value) ?? null;
              setSource(next); setSourceError(false); persistDraft(action, date, next);
            }}>
              <option value="">元Problemを記録しない</option>
              {source && !ownProblems.some((problem) => problem.id === source.id) ? <option value={source.id}>削除済み・選び直してください</option> : null}
              {ownProblems.map((problem) => <option key={problem.id} value={problem.id}>{problem.content}</option>)}
            </select>
          </label>
          {source ? <p className="whitespace-pre-wrap">元Problem：{source.content}</p> : null}
          <label className="block">実行する行動
            <textarea className="field w-full" required disabled={!ready} value={action} onChange={(event) => { setAction(event.target.value); persistDraft(event.target.value, date); }} />
          </label>
          <label className="block">実行する日付
            <input className="field" type="date" required disabled={!ready} value={date} onChange={(event) => { setDate(event.target.value); persistDraft(action, event.target.value); }} />
          </label>
          <p className="text-sm">担当：自分（ログイン中の本人）</p>
          <button className="btn btn-ghost" type="submit" disabled={!valid}>保存内容を確認</button>
          <p className="text-sm text-muted">まだ保存されていません。</p>
          <p className="text-xs text-muted">下書きの保持はこのタブ内だけです。タブを閉じると失われます。</p>
          <button className="btn btn-ghost" type="button" disabled={!ready || (!action && !date && !source)} onClick={() => { setAction(""); setDate(""); setSource(null); setSourceError(false); setError(false); persistDraft("", "", null); }}>下書きを破棄</button>
        </form>
      ) : step === "confirm" ? (
        <div className="space-y-3">
          <p className="whitespace-pre-wrap">元Problem：{source?.content ?? "記録しない"}</p>
          <p className="whitespace-pre-wrap">行動：{action.trim()}</p>
          <p>担当：自分（ログイン中の本人）</p>
          <p>日付：{date}</p>
          <p className="text-sm text-muted">まだ保存されていません。確認後、Try付箋として保存してください。</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => { setError(false); setStep("edit"); }}>修正する</button>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => { void save(); }}>{saving ? "保存中…" : "Try付箋として保存"}</button>
          </div>
        </div>
      ) : (
        <p role="status">Try付箋として保存しました。KPTのTry欄で確認できます。</p>
      )}
      {sourceError ? <p role="alert">元Problemが変更・削除されたか、利用できません。選び直して保存内容を再確認してください。入力内容は保持しています。</p> : null}
      {saving ? <p role="status">Try付箋を保存しています。</p> : null}
      {step !== "saved" && draftNotice ? <p className="text-sm text-muted" data-own-try-draft-notice>{draftNotice}</p> : null}
      {error ? <p role="alert">保存を確認できませんでした。入力内容は保持しています。Try欄を確認してから再操作してください。</p> : null}
    </section>
  );
}
