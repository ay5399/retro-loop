"use client";

import { useActionState } from "react";
import { runReflection, type RunReflectionState } from "./actions";

// AI問い返しの実行ボタン。実行中表示とAI失敗時のエラー文言を出す。
export function RunReflection({
  teamId,
  retroId,
  hasRun,
}: {
  teamId: string;
  retroId: string;
  hasRun: boolean;
}) {
  const action = runReflection.bind(null, teamId, retroId);
  const [state, formAction, pending] = useActionState<RunReflectionState, FormData>(
    action,
    { error: null },
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
          {pending ? "問い返し中…" : hasRun ? "もう一度 問い返す" : "AIに問い返してもらう"}
        </button>
      </form>
      {state.error && <p className="text-xs text-problem">{state.error}</p>}
    </div>
  );
}
