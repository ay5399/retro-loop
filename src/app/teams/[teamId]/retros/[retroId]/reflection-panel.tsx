import { ActionOutcome } from "@prisma/client";
import { runReflection, adoptProposedAction } from "./actions";

type Evaluation = {
  actionContent: string;
  outcome: ActionOutcome | null;
  reason: string | null;
  question: string | null;
};
type Probe = { question: string; focus?: string };
type Proposed = { content: string; rationale: string };
type AdoptedAction = { id: string; content: string; status: string };

const OUTCOME: Record<string, { label: string; color: string }> = {
  WORKED: { label: "効いた", color: "text-keep" },
  NOT_WORKED: { label: "効いてない", color: "text-problem" },
  NOT_DONE: { label: "未着手", color: "text-muted" },
  CONFIRMING: { label: "確認中", color: "text-warn" },
};

function outcomeMeta(outcome: ActionOutcome | null) {
  return OUTCOME[outcome ?? "CONFIRMING"];
}

export function ReflectionPanel({
  teamId,
  retroId,
  hasRun,
  model,
  evaluations,
  probes,
  proposedActions,
  reflectionId,
  adoptedActions,
}: {
  teamId: string;
  retroId: string;
  hasRun: boolean;
  model: string | null;
  evaluations: Evaluation[];
  probes: Probe[];
  proposedActions: Proposed[];
  reflectionId: string | null;
  adoptedActions: AdoptedAction[];
}) {
  const run = runReflection.bind(null, teamId, retroId);
  const adopt = adoptProposedAction.bind(null, teamId, retroId);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="eyebrow">AI 問い返し</p>
        <form action={run}>
          <button type="submit" className="btn btn-primary btn-sm">
            {hasRun ? "もう一度 問い返す" : "AIに問い返してもらう"}
          </button>
        </form>
      </div>

      {!hasRun ? (
        <div className="card p-6 text-sm text-muted">
          付箋を書いたら「問い返してもらう」を押すと、AIが前回アクションの効果を判定し、
          形骸化していないかを問い返し、新しい改善案を出します。
        </div>
      ) : (
        <div className="space-y-4">
          {/* (a) 前回アクションの判定 */}
          {evaluations.length > 0 && (
            <div className="card p-5">
              <p className="eyebrow mb-3">前回アクションの判定</p>
              <ul className="space-y-3">
                {evaluations.map((ev, i) => {
                  const m = outcomeMeta(ev.outcome);
                  return (
                    <li key={i} className="border-l-2 border-line pl-3">
                      <div className="flex items-center gap-2">
                        <span className={`badge ${m.color}`}>{m.label}</span>
                        <span className="text-sm font-medium">{ev.actionContent}</span>
                      </div>
                      {ev.reason && (
                        <p className="mt-1 text-sm text-muted">{ev.reason}</p>
                      )}
                      {ev.question && (
                        <p className="mt-1 text-sm text-warn">? {ev.question}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* (b) 問い返し */}
          {probes.length > 0 && (
            <div className="card p-5">
              <p className="eyebrow mb-3">問い返し</p>
              <ul className="space-y-3">
                {probes.map((p, i) => (
                  <li key={i}>
                    <p className="font-display text-[0.95rem] font-medium leading-snug">
                      「{p.question}」
                    </p>
                    {p.focus && (
                      <p className="mt-0.5 text-xs text-muted">— {p.focus}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* (c) 新アクション案 */}
          {proposedActions.length > 0 && (
            <div className="card p-5">
              <p className="eyebrow mb-3">改善アクション案</p>
              <ul className="space-y-3">
                {proposedActions.map((a, i) => (
                  <li
                    key={i}
                    className="flex items-start justify-between gap-3 rounded-lg border border-line bg-surface-2 p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{a.content}</p>
                      <p className="mt-0.5 text-xs text-muted">{a.rationale}</p>
                    </div>
                    <form action={adopt} className="shrink-0">
                      <input type="hidden" name="content" value={a.content} />
                      <input type="hidden" name="reflectionId" value={reflectionId ?? ""} />
                      <button type="submit" className="btn btn-ghost btn-sm">
                        採用
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {model && (
            <p className="text-right text-xs text-muted">生成: {model}</p>
          )}
        </div>
      )}

      {/* 今回のアクション（採用済み。次回の判定対象になる） */}
      {adoptedActions.length > 0 && (
        <div className="card p-5">
          <p className="eyebrow mb-3">今回のアクション</p>
          <ul className="space-y-2">
            {adoptedActions.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-sm">
                <span className="badge text-iris">{a.status}</span>
                <span>{a.content}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
