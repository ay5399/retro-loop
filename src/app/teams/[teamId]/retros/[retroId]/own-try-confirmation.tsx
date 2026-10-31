"use client";

import { useRef, useState } from "react";
import { addNote } from "./actions";

export function OwnTryConfirmation({ teamId, retroId }: { teamId: string; retroId: string }) {
  const [action, setAction] = useState("");
  const [date, setDate] = useState("");
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
            <textarea className="field w-full" required value={action} onChange={(event) => setAction(event.target.value)} />
          </label>
          <label className="block">実行する日付
            <input className="field" type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <p className="text-sm">担当：自分（ログイン中の本人）</p>
          <button className="btn btn-ghost" type="submit" disabled={!valid}>保存内容を確認</button>
          <p className="text-sm text-muted">まだ保存されていません。</p>
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
      {error ? <p role="alert">保存を確認できませんでした。入力内容は保持しています。Try欄を確認してから再操作してください。</p> : null}
    </section>
  );
}
