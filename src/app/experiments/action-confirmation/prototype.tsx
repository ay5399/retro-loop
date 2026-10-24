"use client";

import { useEffect, useRef, useState } from "react";

const problem = "レビュー待ちが長く、自分の作業が止まる";
const questions = [
  "あなた自身が変えられる行動を一つ教えてください。",
  "その行動を実行する日付はいつですか？未定なら未定のままで大丈夫です。",
  "自分が担当する行動と日付を確認してください。未定の項目は保存せず、後で考えられます。",
];
type Action = { problem: string; action: string; date: string; owner: string; retro: string; done: boolean };

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
}

export default function Prototype() {
  const [user, setUser] = useState("架空メンバーA");
  const [retro, setRetro] = useState("架空ふりかえり1");
  const [comparison, setComparison] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    // Keep experiment switches inert until React has attached their handlers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, []);
  return <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
    <p className="eyebrow">RetroLoop / 隔離プロトタイプ</p>
    <h1 className="text-2xl font-bold">自分のProblemから、一つのアクションへ</h1>
    <p>実験用・固定モック応答のみ。架空データ専用です。保存先はこのブラウザー内で、本番には保存しません。</p>
    <fieldset disabled={!hydrated} className="flex flex-wrap gap-4" aria-label="実験条件">
      <label>実験ユーザー<select className="field" value={user} onChange={e => setUser(e.target.value)}><option>架空メンバーA</option><option>架空メンバーB</option></select></label>
      <label>実験ふりかえり<select className="field" value={retro} onChange={e => setRetro(e.target.value)}><option>架空ふりかえり1</option><option>架空ふりかえり2</option></select></label>
      <label className="self-end"><input type="checkbox" checked={comparison} onChange={e => setComparison(e.target.checked)} /> 自由文のみの比較画面</label>
    </fieldset>
    <Session key={`${user}:${retro}:${comparison}`} user={user} retro={retro} comparison={comparison} />
  </main>;
}

function Session({ user, retro, comparison }: { user: string; retro: string; comparison: boolean }) {
  const key = `retroloop:experiment:action-v1:${user}:${retro}`;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Action | null>(null);
  const locked = useRef(false);
  const [answers, setAnswers] = useState<string[]>([]);
  const [answer, setAnswer] = useState("");
  const [action, setAction] = useState("");
  const [date, setDate] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    // Hydration must finish before reading browser-only storage. No automatic writes.
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== "object" || !("owner" in value) || value.owner !== user ||
          !("problem" in value) || value.problem !== problem || !("action" in value) || typeof value.action !== "string" || !value.action.trim() ||
          !("date" in value) || typeof value.date !== "string" || !validDate(value.date) ||
          !("retro" in value) || value.retro !== retro || !("done" in value) || typeof value.done !== "boolean") throw new Error("Invalid record");
        setSaved(value as Action);
        locked.current = true;
      }
      setReady(true);
    } catch { setError("保存内容を読み込めません。上書きせず、この実験を停止しました。"); }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [key, user, retro]);

  function persist(value: Action) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      setSaved(value);
      setError("");
      return true;
    } catch { setError("保存できませんでした。ブラウザーの保存設定を確認し、再試行してください。"); return false; }
  }

  return <>
    <section className="card space-y-3 p-5">
      <h2 className="font-bold">自分のProblem</h2><p>{problem}</p>
      <p className="text-sm text-muted">担当候補：{user}（架空の本人）</p>
    </section>
    {error && <p role="alert">{error}</p>}
    {saved ? <section className="card space-y-4 p-5" aria-label="保存済みアクション">
      <h2 className="font-bold">このブラウザーに保存済み</h2>
      <dl className="space-y-2"><dt>元Problem</dt><dd>{saved.problem}</dd><dt>行動</dt><dd>{saved.action}</dd><dt>担当</dt><dd>{saved.owner}</dd><dt>日付</dt><dd>{saved.date}</dd><dt>状態</dt><dd>{saved.done ? "完了" : "未着手"}</dd></dl>
      <button className="btn btn-ghost" onClick={() => persist({ ...saved, done: !saved.done })}>{saved.done ? "未着手に戻す" : "完了にする"}</button>
    </section> : <>
      <section className="card space-y-4 p-5" aria-label="固定モック対話">
        <h2 className="font-bold">問い返し（固定モック・最大3往復）</h2>
        <ol className="space-y-3">{answers.map((text, i) => <li key={i}><p>モック：{questions[i]}</p><p className="rounded-lg bg-iris-soft p-3">自分：{text}</p></li>)}</ol>
        {answers.length < 3 ? <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!ready || !answer.trim() || answers.length >= 3) return; setAnswers([...answers, answer.trim()]); setAnswer(""); }}>
          <p>{questions[answers.length]}</p>
          <label className="block">本人の返答<textarea className="field" value={answer} onChange={e => setAnswer(e.target.value)} /></label>
          <button className="btn btn-primary" disabled={!ready || !answer.trim()}>返答する</button>
        </form> : <p>3往復が終了しました。未確定なら保存せず、考え直してください。</p>}
      </section>
      {comparison ? <p>比較条件：自由文の相談のみ。行動の確認・保存はありません（既存画面の再現ではなく比較用の簡略画面）。</p> : <section className="card space-y-4 p-5" aria-label="本人の確認カード">
        <h2 className="font-bold">自分で確認して保存</h2>
        <p className="text-sm text-muted">返答から自動入力しません。行動と日付を自分で記入し、修正してください。未定なら空欄のままにできます。</p>
        <label className="block">実行する行動<textarea className="field" value={action} onChange={e => { setAction(e.target.value); setConfirmed(false); }} /></label>
        <label className="block">実行する日付<input type="date" className="field" value={date} onChange={e => { setDate(e.target.value); setConfirmed(false); }} /></label>
        <label className="block"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> {user}本人が担当し、この行動と日付で実行することを確認しました</label>
        <p className="text-sm">未保存。一つのProblemにつき、一件を保存します。</p>
        <button className="btn btn-primary" disabled={!ready || !action.trim() || !validDate(date) || !confirmed || answers.length === 0} onClick={() => {
          if (locked.current || !ready || !action.trim() || !validDate(date) || !confirmed || answers.length === 0) return;
          locked.current = true;
          if (!persist({ problem, action: action.trim(), date, owner: user, retro, done: false })) locked.current = false;
        }}>確認してブラウザーに保存</button>
      </section>}
    </>}
  </>;
}
