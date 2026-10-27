import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generationBudget, taskAdmissionBudget, TASK_TIMING } from './budget.mjs';
const minute = 60_000;

test('shared actual review/live/release limits and generation caps fit a 90 minute normal run', () => {
  assert.equal(TASK_TIMING.reviewMs, 5 * minute);
  assert.equal(TASK_TIMING.liveAiMs, 7 * minute);
  assert.equal(TASK_TIMING.releaseMs, 45 * minute);
  assert.equal(taskAdmissionBudget({ deadline: 90 * minute, now: 0, mode: 'normal' }).admitted, true);
  for (const [stage, timeoutMs] of [['planning', 120_000], ['implementation', 360_000], ['fix', 240_000]]) assert.deepEqual(generationBudget({ deadline: 90 * minute, now: 3 * minute, stage }), { timeoutMs });
});

test('generation leaves enough for actual review/live AI/both CI/artifacts/publication and release gate', () => {
  const deadline = 90 * minute, now = 24 * minute;
  const { timeoutMs } = generationBudget({ deadline, now, stage: 'implementation' });
  assert.equal(timeoutMs, minute);
  const nonRelease = 2 * TASK_TIMING.minCiMs + TASK_TIMING.reviewMs + TASK_TIMING.liveAiMs + TASK_TIMING.artifactMs + TASK_TIMING.publishMs;
  assert.equal(deadline - (now + timeoutMs + nonRelease), TASK_TIMING.releaseMs);
  assert.throws(() => generationBudget({ deadline, now: 25 * minute, stage: 'fix' }), /Checkpoint.*unresolved/);
});

test('planning reserves its own independent review and following full implementation', () => {
  assert.deepEqual(generationBudget({ deadline: 90 * minute, now: 13 * minute, stage: 'planning' }), { timeoutMs: minute });
  assert.throws(() => generationBudget({ deadline: 90 * minute, now: 14 * minute, stage: 'planning' }), /Insufficient time/);
  // A second/third proposal receives the same admission test instead of consuming downstream reserve.
  assert.throws(() => generationBudget({ deadline: 90 * minute, now: 20 * minute, stage: 'planning' }), /Insufficient time/);
});

test('longer measured CI and review are reserved; shorter estimates cannot weaken actual limits', () => {
  assert.throws(() => generationBudget({ deadline: 66 * minute, now: 0, stage: 'fix', ciMs: 5 * minute }), /Insufficient time/);
  assert.deepEqual(generationBudget({ deadline: 66 * minute, now: 0, stage: 'fix', ciMs: 1, reviewMs: 1, releaseMs: 1 }), { timeoutMs: minute });
  assert.throws(() => generationBudget({ deadline: 66 * minute, now: 0, stage: 'fix', reviewMs: 10 * minute }), /Insufficient time/);
});

test('mutation admission includes baseline, all three plan reviews, implementation and two verification workflows', () => {
  const admission = taskAdmissionBudget({ deadline: 90 * minute, now: 0, mode: 'mutation' });
  assert.equal(admission.requiredMs, 50 * minute);
  assert.equal(admission.admitted, true);
  assert.equal(taskAdmissionBudget({ deadline: 50 * minute, now: 0, mode: 'mutation' }).admitted, true);
  assert.equal(taskAdmissionBudget({ deadline: 49 * minute, now: 0, mode: 'mutation' }).admitted, false);
  // The former 15 minute admission omitted baseline and repeated plan review entirely.
  assert.equal(taskAdmissionBudget({ deadline: 15 * minute, now: 0, mode: 'mutation' }).admitted, false);
  assert.deepEqual(generationBudget({ deadline: 25 * minute, now: 0, mode: 'mutation', stage: 'implementation' }), { timeoutMs: 300_000 });
});

test('invalid stage/mode and nonfinite or negative estimates fail before work begins', () => {
  assert.throws(() => generationBudget({ deadline: 90 * minute, now: 0, stage: 'unknown' }), /Unknown/);
  assert.throws(() => taskAdmissionBudget({ deadline: 90 * minute, now: 0, mode: 'unknown' }), /Unknown/);
  for (const overrides of [{ ciMs: -1 }, { releaseMs: NaN }, { reviewMs: Infinity }, { deadline: Infinity }, { now: NaN }, { liveAiMs: -1 }]) assert.throws(() => generationBudget({ deadline: 90 * minute, now: 0, stage: 'fix', ...overrides }), /finite/);
});

test('actual mutation controller records insufficient admission as deferred without starting baseline', async () => {
  const source = await readFile(new URL('./run.mjs', import.meta.url), 'utf8');
  const from = source.indexOf('  const mutationBudget =');
  const to = source.indexOf("  await save(path.join(stateDir, 'tracking.json'), tracking);", from);
  assert.ok(from >= 0 && to > from);
  const outcomes = [], calls = [];
  const context = {
    taskAdmissionBudget, TASK_TIMING, admissionCiMs: 180_000, deadline: Date.now() + 15 * minute, deferCurrent: false, outcomes,
    runId: '2026-10-29-5', tracking: { experiments: [] }, now: new Date(), mutationDue: () => true,
    develop: async () => { calls.push('develop'); }, note: async () => { calls.push('note'); },
    save: async () => { calls.push('save'); }, jstDate: () => '2026-10-29', stateDir: 'unused', path: { join: (...parts) => parts.join('/') }
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(...Object.keys(context), source.slice(from, to))(...Object.values(context));
  assert.deepEqual(calls, []);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].phase, 'mutation');
  assert.equal(outcomes[0].status, 'deferred');
  assert.match(outcomes[0].reason, /before baseline/);
});

test('actual admission defers new normal work with 72 minutes after recovery using measured CI', async () => {
  const source = await readFile(new URL('./run.mjs', import.meta.url), 'utf8');
  const from = source.indexOf('  const admissionCiMs =');
  const to = source.indexOf('  for (const exp of', from);
  assert.ok(from >= 0 && to > from);
  const outcomes = [];
  const context = { recovered: { ciEstimateMs: 204_000 }, TASK_TIMING, taskAdmissionBudget, deadline: Date.now() + 72 * minute, outcomes };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(...Object.keys(context), source.slice(from, to))(...Object.values(context));
  assert.equal(outcomes[0].status, 'deferred');
  assert.equal(outcomes[0].ciEstimateMs, 204_000);
  assert.equal(taskAdmissionBudget({ deadline: 90 * minute, now: 0, mode: 'normal', ciMs: 869_000 }).admitted, false);
});

test('measured 204 second CI and 75 second review permit two correction rounds in the same normal run', () => {
  // https://github.com/ay5399/retro-loop/actions/runs/40574172129
  // 2026-10-27 20:00:32Z..20:03:56Z = 204 s; stability-review.json records ~75 s.
  // Three is the attempt ceiling, not permission to exceed 90 minutes: long CI
  // failures can consume the remaining reserve and must retain an unresolved checkpoint.
  const ciMs = 204_000, reviewElapsed = 75_000, deadline = 90 * minute;
  let now = ciMs;
  now += generationBudget({ deadline, now, stage: 'planning', ciMs }).timeoutMs + reviewElapsed;
  for (const stage of ['implementation', 'fix', 'fix']) {
    now += generationBudget({ deadline, now, stage, ciMs }).timeoutMs + reviewElapsed;
  }
  now += TASK_TIMING.liveAiMs + 2 * ciMs + TASK_TIMING.artifactMs + TASK_TIMING.publishMs;
  assert.ok(deadline - now >= TASK_TIMING.releaseMs);
  // Maximum-duration failures cannot be guaranteed three retries inside 90 minutes.
  // The same reserve check stops before generation would consume release time.
  assert.throws(() => generationBudget({ deadline, now: 30 * minute, stage: 'fix', ciMs }), /Checkpoint.*unresolved/);
});
