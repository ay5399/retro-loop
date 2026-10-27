export const TASK_TIMING = Object.freeze({ reviewMs: 300_000, liveAiMs: 420_000, releaseMs: 45 * 60_000, minCiMs: 180_000, artifactMs: 60_000, publishMs: 60_000, minGenerationMs: 30_000 });
const caps = { planning: 120_000, implementation: 360_000, fix: 240_000 };

function durations({ deadline, now = Date.now(), mode = 'normal', ciMs = TASK_TIMING.minCiMs, releaseMs = TASK_TIMING.releaseMs, reviewMs = TASK_TIMING.reviewMs, liveAiMs = TASK_TIMING.liveAiMs }) {
  if (!['normal', 'mutation'].includes(mode)) throw new Error(`Unknown generation mode: ${mode}`);
  if (![deadline, now, ciMs, releaseMs, reviewMs, liveAiMs].every(Number.isFinite) || [ciMs, releaseMs, reviewMs, liveAiMs].some(value => value < 0)) throw new Error('Generation budget requires finite timestamps and nonnegative duration estimates');
  return { remainingMs: deadline - now, ciMs: Math.max(TASK_TIMING.minCiMs, ciMs), reviewMs: Math.max(TASK_TIMING.reviewMs, reviewMs), liveAiMs, releaseMs: mode === 'mutation' ? 0 : Math.max(TASK_TIMING.releaseMs, releaseMs) };
}

/** Initial work reserves release; corrections finish review/validation before deferring the same PR if needed. */
export function generationBudget(options) {
  const { stage } = options;
  if (!Object.hasOwn(caps, stage)) throw new Error(`Unknown generation stage: ${stage}`);
  const timing = durations(options);
  const releaseReserveMs = stage === 'fix' ? 0 : timing.releaseMs;
  const reservedMs = 2 * timing.ciMs + releaseReserveMs + timing.reviewMs + timing.liveAiMs + TASK_TIMING.artifactMs + TASK_TIMING.publishMs + (stage === 'planning' ? timing.reviewMs + caps.implementation : 0);
  const availableMs = timing.remainingMs - reservedMs;
  if (availableMs < TASK_TIMING.minGenerationMs) throw new Error(`Insufficient time for ${options.mode ?? 'normal'} ${stage}: remaining ${timing.remainingMs}ms; required at least ${reservedMs + TASK_TIMING.minGenerationMs}ms (CI, independent review, live AI, artifacts, publishing and release reserved). Checkpoint the current work, failure diagnostics and verification evidence as unresolved; do not claim completion.`);
  return { timeoutMs: Math.min(caps[stage], Math.floor(availableMs)) };
}

/** Admission precedes baseline CI. Mutation includes all three possible plan/review attempts. */
export function taskAdmissionBudget(options) {
  const timing = durations(options);
  const planAttempts = options.mode === 'mutation' ? 3 : 1;
  const requiredMs = 3 * timing.ciMs + planAttempts * (caps.planning + timing.reviewMs) + caps.implementation + timing.reviewMs + timing.liveAiMs + TASK_TIMING.artifactMs + TASK_TIMING.publishMs + timing.releaseMs;
  return { admitted: timing.remainingMs >= requiredMs, remainingMs: timing.remainingMs, requiredMs };
}
