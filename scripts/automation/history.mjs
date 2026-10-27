import { readdir, lstat, open } from 'node:fs/promises';
import path from 'node:path';

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_RUNS = 10000;
const successful = new Set(['released', 'no-change', 'success', 'succeeded', 'passed', 'completed', 'recovered', 'deferred']);
const ownerBoundary = new Set(['approval-required', 'awaiting-approval']);
const preflight = new Set(['preflight-passed', 'audit-passed', 'dry-run']);
const hasEvidence = evidence => typeof evidence === 'string' ? Boolean(evidence.trim()) : Array.isArray(evidence) ? evidence.length > 0 : Boolean(evidence && typeof evidence === 'object' && Object.keys(evidence).length);
const hasPrevention = outcome => typeof outcome?.prevention === 'string' && Boolean(outcome.prevention.trim());
const validatedProposal = outcome => outcome?.status === 'pending' && outcome.kind === 'mutation' && typeof outcome.sha === 'string' && Boolean(outcome.sha.trim()) && Boolean(outcome.pr) && hasEvidence(outcome.evidence);

function runTime(id) {
  const match = /^(\d{4}-\d{2}-\d{2})-(5|13|21)(?:-manual-([1-9]\d*))?$/.exec(id);
  if (!match) return null;
  const scheduled = Date.parse(`${match[1]}T${match[2].padStart(2, '0')}:00:00+09:00`);
  if (!Number.isFinite(scheduled) || new Date(scheduled + 9 * 3600000).toISOString().slice(0, 10) !== match[1]) return null;
  const timestamp = match[3] ? Number(match[3]) : scheduled;
  return Number.isSafeInteger(timestamp) ? timestamp : null;
}

async function boundedJson(file) {
  let handle;
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_JSON_BYTES) throw new Error('History JSON must be a bounded regular file');
    handle = await open(file, 'r');
    const buffer = Buffer.alloc(MAX_JSON_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_JSON_BYTES) throw new Error('History JSON exceeds size limit');
    return { value: JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) };
  } catch (error) {
    if (error.code === 'ENOENT') return { missing: true };
    return { error: error.message };
  } finally { await handle?.close(); }
}

async function inspect(dir, id) {
  const [resultRead, runRead, auditRead, taskRead] = await Promise.all(['result.json', 'run.json', 'observed-audit.json', 'task.json'].map(file => boundedJson(path.join(dir, file))));
  const result = resultRead.value;
  const start = [runRead.value?.startedAt, result?.startedAt, auditRead.value?.at].map(value => typeof value === 'string' ? Date.parse(value) : NaN).find(Number.isFinite);
  return { id, dir, time: start ?? runTime(id), result, resultRead, taskRead };
}

/** Read-only inspection. Recovery must preserve owner approval boundaries and supply new proof. */
export async function inspectPreviousRun({ runsDir, currentRunDir }) {
  const root = path.resolve(runsDir), current = path.resolve(currentRunDir);
  if (path.dirname(current) !== root || runTime(path.basename(current)) === null) throw new Error('Current run must be a real run directory immediately within runsDir');
  const currentInfo = await inspect(current, path.basename(current));
  const cutoff = Math.min(currentInfo.time, Date.now());
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (entries.length > MAX_RUNS) throw new Error('Run history exceeds inspection limit');
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || runTime(entry.name) === null) continue;
    const dir = path.join(root, entry.name);
    if (dir === current) continue;
    const candidate = await inspect(dir, entry.name);
    if (candidate.time >= cutoff) continue;
    const result = candidate.result;
    if (preflight.has(result?.status) || result?.dryRun === true || result?.auditOnly === true || result?.mode === 'dry-run' || result?.mode === 'audit') continue;
    candidates.push(candidate);
  }
  candidates.sort((a, b) => b.time - a.time || b.id.localeCompare(a.id));
  const latest = candidates[0];
  if (!latest) return null;
  const { id, dir, result, resultRead, taskRead } = latest;
  const outcomes = Array.isArray(result?.outcomes) ? result.outcomes : [];
  const statuses = [result?.status, ...outcomes.map(outcome => outcome?.status)];
  const failures = [result, ...outcomes].filter(outcome => !successful.has(outcome?.status) && !validatedProposal(outcome) && !(outcome !== result && successful.has(result?.status) && outcome?.status === 'pending' && outcome.phase === 'mutation' && outcome.pr)).map(outcome => outcome?.status);
  const needsRecovery = Boolean(resultRead.missing || resultRead.error || !result || typeof result !== 'object' || failures.length || taskRead.error);
  const ownerBlocked = needsRecovery && (statuses.some(status => ownerBoundary.has(status)) || ownerBoundary.has(taskRead.value?.stage) || taskRead.value?.verdict?.verdict === 'reject' || taskRead.value?.verdict?.risk === 'approval-required');
  const reason = ownerBlocked ? 'Previous run requires explicit owner approval; automatic recovery must not bypass this boundary.'
    : resultRead.missing ? 'Previous run has no result.json and may have been interrupted.'
      : resultRead.error ? `Previous result.json cannot be inspected: ${resultRead.error}`
        : taskRead.error ? `Previous task.json cannot be inspected: ${taskRead.error}`
          : needsRecovery ? `Previous run is incomplete: ${failures.map(status => status ?? 'missing status').join(', ')}${[result?.reason, ...outcomes.map(outcome => outcome?.reason)].filter(reason => typeof reason === 'string' && reason.trim()).map(reason => `. ${reason}`).join('')}`
            : 'Previous real run completed successfully.';
  return { id, dir, result: result ?? null, needsRecovery, ownerBlocked, reason, ...(taskRead.value !== undefined ? { task: taskRead.value } : {}) };
}

/** Interim startup backstop: current work cannot begin until repair and prevention have proof. */
export async function reconcileStartup({ previous, repair, record, prerequisitesPassed = true, infrastructureGatesPassed = false }) {
  if (typeof record !== 'function') throw new Error('Startup reconciliation requires a durable record callback');
  const identity = previous ? { previousId: previous.id, previousDir: previous.dir } : {};
  if (!previous || !previous.needsRecovery) {
    await record({ status: 'checked', ...identity, reason: previous?.reason ?? 'No preceding real execution.' });
    return null;
  }
  if (previous.ownerBlocked || ownerBoundary.has(previous.task?.stage) || previous.task?.verdict?.verdict === 'reject' || previous.task?.verdict?.risk === 'approval-required' || [previous.result?.status, ...(Array.isArray(previous.result?.outcomes) ? previous.result.outcomes : []).map(outcome => outcome?.status)].some(status => ownerBoundary.has(status))) {
    await record({ status: 'awaiting-approval', ...identity, reason: previous.reason });
    throw new Error('Previous execution requires explicit owner approval; startup recovery cannot bypass approval.');
  }
  if (previous.result?.status === 'blocked' && previous.result.stage === 'development' && !previous.task && prerequisitesPassed === true) {
    await record({ status: 'resolved', ...identity, prevention: 'Development prerequisites are checked before every execution.', proof: { type: 'current-preflight', prerequisitesPassed: true }, reason: 'Current execution passed the development prerequisites that blocked the previous execution.' });
    return null;
  }
  if (previous.result?.gate === 'infrastructure' && !previous.task && infrastructureGatesPassed === true) {
    await record({ status: 'resolved', ...identity, prevention: 'All infrastructure safety gates are checked before each execution and gate failures retain their classification.', proof: { type: 'current-infrastructure-gates', infrastructureGatesPassed: true }, reason: 'Current authentication, repository rules, incident, release lease, halt, budget and fetch gates passed; the preceding stop had no unfinished implementation task.' });
    return null;
  }
  await record({ status: 'repairing', ...identity, reason: previous.reason });
  let outcome;
  try {
    if (typeof repair !== 'function') throw new Error('Previous execution needs repair but no repair callback was supplied');
    outcome = await repair(previous);
  } catch (error) {
    await record({ status: 'unresolved', ...identity, reason: error.message });
    throw error;
  }
  const isolatedProposal = previous.task?.kind === 'mutation' && validatedProposal(outcome);
  const resolved = previous.task?.kind === 'mutation' ? isolatedProposal : outcome?.status === 'released';
  if (!resolved || !hasPrevention(outcome)) {
    const requirement = previous.task?.kind === 'mutation' ? 'a validated isolated Draft PR with SHA, evidence and concrete recurrence prevention' : 'a released repair and concrete recurrence prevention';
    const reason = `Previous execution recovery is unresolved: ${outcome?.status ?? 'missing outcome'}; ${requirement} is required before current work.`;
    await record({ status: 'unresolved', ...identity, outcome, reason });
    throw new Error(reason);
  }
  await record({ status: 'resolved', ...identity, sha: outcome.sha, pr: outcome.pr, prevention: outcome.prevention, proof: isolatedProposal ? { type: 'validated-isolated-proposal', evidence: outcome.evidence } : outcome.proof ?? outcome.evidence, outcome });
  return outcome;
}
