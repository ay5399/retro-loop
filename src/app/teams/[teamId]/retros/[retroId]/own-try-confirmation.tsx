"use client";

import { useEffect, useRef, useState } from "react";
import { addNote } from "./actions";

export function OwnTryConfirmation({ teamId, retroId, userId }: { teamId: string; retroId: string; userId: string }) {
  const storageKey = `retroloop:own-try-draft:v1:${JSON.stringify([userId, teamId, retroId])}`;
  return <OwnTryDraft key={storageKey} teamId={teamId} retroId={retroId} storageKey={storageKey} />;
}

function OwnTryDraft({ teamId, retroId, storageKey }: { teamId: string; retroId: string; storageKey: string }) {
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

  function persistDraft(nextAction: string, nextDate: string) {
    try {
      if (nextAction || nextDate) sessionStorage.setItem(storageKey, JSON.stringify({ action: nextAction, date: nextDate }));
      else sessionStorage.removeItem(storageKey);
      setDraftNotice(nextAction || nextDate ? "このタブに一時保持しています。Try付箋としては未保存です。" : "");
    } catch {
      setDraftNotice("このタブに下書きを保持できません。再読み込み前にTry付箋として保存してください。");
    }
  }
  const [step, setStep] = useState<"edit" | "confirm" | "saved">("edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const valid = action.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);

  async function save() {
    if (!valid || step !== "confirm" || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(false);
    const data = new FormData();
    data.set("content", `行動：${action.trim()}\n担当：自分（付箋の作成者）\n日付：${date}`);
    try {
      await addNote(teamId, retroId, "TRY", data);
      persistDraft("", "");
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
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (valid) { setError(false); setStep("confirm"); } }}>
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
          <button className="btn btn-ghost" type="button" disabled={!ready || (!action && !date)} onClick={() => { setAction(""); setDate(""); setError(false); persistDraft("", ""); }}>下書きを破棄</button>
        </form>
      ) : step === "confirm" ? (
        <div className="space-y-3">
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
      {saving ? <p role="status">Try付箋を保存しています。</p> : null}
      {step !== "saved" && draftNotice ? <p className="text-sm text-muted" data-own-try-draft-notice>{draftNotice}</p> : null}
      {error ? <p role="alert">保存を確認できませんでした。入力内容は保持しています。Try欄を確認してから再操作してください。</p> : null}
    </section>
  );
}
