import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectPreviousRun, reconcileStartup } from './history.mjs';

async function fixture(callback) {
  const root = await mkdtemp(path.join(tmpdir(), 'retro-history-'));
  const add = async (id, result, files = {}) => {
    const dir = path.join(root, id);
    await mkdir(dir);
    if (result !== undefined) await writeFile(path.join(dir, 'result.json'), JSON.stringify(result));
    for (const [file, value] of Object.entries(files)) await writeFile(path.join(dir, file), JSON.stringify(value));
    return dir;
  };
  try { await callback({ root, add, inspect: currentRunDir => inspectPreviousRun({ runsDir: root, currentRunDir }) }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('orders 5, 13, 21 numerically and excludes current and future runs', async () => fixture(async ({ add, inspect }) => {
  await add('2026-10-25-5', { status: 'released' });
  await add('2026-10-25-13', { status: 'failed' });
  const current = await add('2026-10-25-21', { status: 'released' });
  await add('2026-10-26-5', { status: 'released' });
  const previous = await inspect(current);
  assert.equal(previous.id, '2026-10-25-13');
  assert.equal(previous.needsRecovery, true);
}));
test('manual timestamp and real start metadata determine actual ordering', async () => fixture(async ({ add, inspect }) => {
  await add('2026-10-25-5', { status: 'failed' }, { 'run.json': { startedAt: '2026-10-25T05:00:00Z' } });
  await add(`2026-10-25-13-manual-${Date.parse('2026-10-25T04:30:00Z')}`, { status: 'released' });
  const current = await add('2026-10-25-21', { status: 'released' });
  assert.equal((await inspect(current)).id, '2026-10-25-5');
}));
test('manual run is included with its task and latest suffix milliseconds', async () => fixture(async ({ add, inspect }) => {
  await add('2026-10-25-13', { status: 'released' });
  const manual = `2026-10-25-13-manual-${Date.parse('2026-10-25T05:00:00Z')}`;
  await add(manual, { status: 'failed' }, { 'task.json': { sha: 'exact-source', kind: 'normal' } });
  const previous = await inspect(await add('2026-10-25-21', { status: 'released' }));
  assert.equal(previous.id, manual);
  assert.equal(previous.task.sha, 'exact-source');
}));
test('a failed outcome is not hidden by a successful top-level status', async () => fixture(async ({ add, inspect }) => {
  await add('2026-10-25-5', { status: 'released', outcomes: [{ status: 'failed', reason: 'verification failed' }] });
  const previous = await inspect(await add('2026-10-25-13'));
  assert.equal(previous.needsRecovery, true);
  assert.match(previous.reason, /failed/);
  assert.match(previous.reason, /verification failed/);
}));
test('missing result is interrupted; dry runs and arbitrary names cannot clear it', async () => fixture(async ({ add, inspect }) => {
  await add('2026-10-25-5');
  await add('2026-10-25-13-preflight-1234', { status: 'preflight-passed' });
  await add('2026-10-25-13', { status: 'released', dryRun: true });
  await add('unrelated-directory', { status: 'released' });
  const previous = await inspect(await add('2026-10-25-21'));
  assert.equal(previous.id, '2026-10-25-5');
  assert.equal(previous.needsRecovery, true);
  assert.match(previous.reason, /interrupted/);
}));
test('successful real run remains successful without inventing recovery proof', async () => fixture(async ({ add, inspect }) => {
  await add('2026-10-25-5', { status: 'released', outcomes: [{ status: 'released' }] });
  const previous = await inspect(await add('2026-10-25-13'));
  assert.equal(previous.needsRecovery, false);
  assert.equal(previous.ownerBlocked, false);
}));
test('awaiting release and blocked require recovery while approvals preserve owner boundary', async () => {
  for (const status of ['awaiting-release', 'blocked', 'approval-required', 'awaiting-approval']) await fixture(async ({ add, inspect }) => {
    await add('2026-10-25-5', { status });
    const previous = await inspect(await add('2026-10-25-13'));
    assert.equal(previous.needsRecovery, true);
    assert.equal(previous.ownerBlocked, status.includes('approval'));
  });
});
test('invalid or oversized result is visible as recovery needed', async () => fixture(async ({ add, inspect }) => {
  const previousDir = await add('2026-10-25-5');
  await writeFile(path.join(previousDir, 'result.json'), 'x'.repeat(1024 * 1024 + 1));
  const previous = await inspect(await add('2026-10-25-13'));
  assert.equal(previous.needsRecovery, true);
  assert.match(previous.reason, /cannot be inspected/);
}));
test('result completion time never reorders runs and invalid calendar dates are ignored', async () => fixture(async ({ add, inspect }) => {
  await add('2026-10-25-5', { status: 'released', at: '2026-10-25T12:00:00Z' });
  await add('2026-10-25-13', { status: 'failed' });
  await add('2026-02-31-21', { status: 'released' });
  assert.equal((await inspect(await add('2026-10-25-21'))).id, '2026-10-25-13');
}));
test('first real run has no previous execution', async () => fixture(async ({ add, inspect }) => {
  assert.equal(await inspect(await add('2026-10-25-5')), null);
}));

const failedPrevious = { id: '2026-10-25-5', dir: '/runs/2026-10-25-5', result: { status: 'failed' }, needsRecovery: true, reason: 'Failed verification' };
test('startup records checked without repair for no previous run or successful previous run', async () => {
  for (const previous of [null, { ...failedPrevious, needsRecovery: false }]) {
    const records = [];
    assert.equal(await reconcileStartup({ previous, repair: () => assert.fail('Unexpected repair'), record: async entry => records.push(entry) }), null);
    assert.equal(records[0].status, 'checked');
  }
});
test('startup requires released repair and prevention before current work begins', async () => {
  const order = [];
  const outcome = { status: 'released', sha: 'verified-sha', pr: 123, prevention: 'Regression test verifies workflow run discovery', proof: { ci: 'passed' } };
  const actual = await reconcileStartup({ previous: failedPrevious, repair: async previous => { assert.equal(previous, failedPrevious); order.push('repair'); return outcome; }, record: async entry => order.push(entry.status) });
  order.push('current');
  assert.equal(actual, outcome);
  assert.deepEqual(order, ['repairing', 'repair', 'resolved', 'current']);
});
test('unresolved recovery blocks current work including no-change or missing prevention', async () => {
  for (const outcome of [{ status: 'failed' }, { status: 'no-change' }, { status: 'awaiting-release' }, { status: 'awaiting-approval' }, { status: 'released', prevention: '  ' }, { status: 'released' }]) {
    const records = [];
    await assert.rejects(reconcileStartup({ previous: failedPrevious, repair: async () => outcome, record: async entry => records.push(entry) }), /recovery is unresolved/);
    assert.deepEqual(records.map(entry => entry.status), ['repairing', 'unresolved']);
    assert.ok(!records.some(entry => entry.status === 'resolved'));
  }
});
test('owner approval boundary is recorded and never calls repair', async () => {
  for (const previous of [{ ...failedPrevious, ownerBlocked: true }, { ...failedPrevious, result: { status: 'awaiting-approval' } }, { ...failedPrevious, result: { status: 'failed', outcomes: [{ status: 'approval-required' }] } }]) {
    const records = [];
    await assert.rejects(reconcileStartup({ previous, repair: () => assert.fail('Owner boundary bypassed'), record: async entry => records.push(entry) }), /explicit owner approval/);
    assert.deepEqual(records.map(entry => entry.status), ['awaiting-approval']);
  }
});
test('current real preflight can resolve previous development block without editing prior history', async () => {
  const previous = { ...failedPrevious, result: { status: 'blocked', stage: 'development' } };
  const original = structuredClone(previous), records = [];
  assert.equal(await reconcileStartup({ previous, repair: () => assert.fail('Preflight already fixed prerequisites'), record: async entry => records.push(entry), prerequisitesPassed: true }), null);
  assert.deepEqual(previous, original);
  assert.equal(records[0].status, 'resolved');
  assert.deepEqual(records[0].proof, { type: 'current-preflight', prerequisitesPassed: true });
});
test('failed prerequisites cannot silently resolve prior development block', async () => {
  const records = [];
  await assert.rejects(reconcileStartup({ previous: { ...failedPrevious, result: { status: 'blocked', stage: 'development' } }, repair: async () => ({ status: 'failed' }), record: async entry => records.push(entry), prerequisitesPassed: false }), /unresolved/);
  assert.deepEqual(records.map(entry => entry.status), ['repairing', 'unresolved']);
});
test('passing preflight cannot erase unfinished task carried through a development block', async () => {
  const previous = { ...failedPrevious, result: { status: 'blocked', stage: 'development' }, task: { branch: 'automation/original', kind: 'normal', stage: 'awaiting-release' } };
  const records = [];
  let repairs = 0;
  await reconcileStartup({ previous, repair: async prior => { repairs++; assert.equal(prior.task.branch, 'automation/original'); return { status: 'released', prevention: 'Original task resumed after prerequisite recheck' }; }, record: async entry => records.push(entry), prerequisitesPassed: true });
  assert.equal(repairs, 1);
  assert.deepEqual(records.map(entry => entry.status), ['repairing', 'resolved']);
});
test('repair exception is recorded unresolved and preserved', async () => {
  const records = [], failure = new Error('repair verification failed');
  await assert.rejects(reconcileStartup({ previous: failedPrevious, repair: async () => { throw failure; }, record: async entry => records.push(entry) }), error => error === failure);
  assert.deepEqual(records.map(entry => entry.status), ['repairing', 'unresolved']);
  assert.equal(records[1].reason, failure.message);
});
test('recovered and deferred are terminal only when no failed outcomes remain', async () => {
  for (const status of ['recovered', 'deferred']) await fixture(async ({ add, inspect }) => {
    await add('2026-10-25-5', { status });
    assert.equal((await inspect(await add('2026-10-25-13'))).needsRecovery, false);
  });
  await fixture(async ({ add, inspect }) => {
    await add('2026-10-25-5', { status: 'deferred', outcomes: [{ status: 'failed', reason: 'still unresolved' }] });
    assert.equal((await inspect(await add('2026-10-25-13'))).needsRecovery, true);
  });
});
test('recovery evidence is preserved as proof when no separate proof field exists', async () => {
  const records = [], evidence = { screenshots: ['verified.png'] };
  await reconcileStartup({ previous: failedPrevious, repair: async () => ({ status: 'released', prevention: 'Regression coverage', evidence }), record: async entry => records.push(entry) });
  assert.deepEqual(records.at(-1).proof, evidence);
});
test('mutation recovery resolves with validated isolated Draft PR proof and never requires merging', async () => {
  const previous = { ...failedPrevious, task: { kind: 'mutation' } }, records = [];
  const outcome = { kind: 'mutation', status: 'pending', sha: 'verified-sha', pr: 55, evidence: { ci: 'passed', screenshots: ['proof.png'] }, prevention: 'Regression validation' };
  assert.equal(await reconcileStartup({ previous, repair: async () => outcome, record: async entry => records.push(entry) }), outcome);
  assert.deepEqual(records.map(entry => entry.status), ['repairing', 'resolved']);
  assert.equal(records[1].proof.type, 'validated-isolated-proposal');
});
test('normal pending and mutation proposals without evidence or prevention remain unresolved', async () => {
  const valid = { kind: 'mutation', status: 'pending', sha: 'verified-sha', pr: 55, evidence: { ci: 'passed' }, prevention: 'Regression test' };
  for (const [previous, outcome] of [[failedPrevious, valid], [{ ...failedPrevious, task: { kind: 'mutation' } }, { ...valid, evidence: {} }], [{ ...failedPrevious, task: { kind: 'mutation' } }, { ...valid, prevention: '' }], [{ ...failedPrevious, task: { kind: 'mutation' } }, { ...valid, status: 'released' }]]) {
    const records = [];
    await assert.rejects(reconcileStartup({ previous, repair: async () => outcome, record: async entry => records.push(entry) }), /unresolved/);
    assert.equal(records.at(-1).status, 'unresolved');
  }
});
test('stored reviewer rejection and approval risk cannot be bypassed by startup recovery', async () => {
  for (const verdict of [{ verdict: 'reject' }, { verdict: 'approve', risk: 'approval-required' }]) {
    const records = [];
    await assert.rejects(reconcileStartup({ previous: { ...failedPrevious, task: { verdict } }, repair: () => assert.fail('Rejected work must not be retried'), record: async entry => records.push(entry) }), /owner approval/);
    assert.equal(records[0].status, 'awaiting-approval');
    await fixture(async ({ add, inspect }) => {
      await add('2026-10-25-5', { status: 'failed' }, { 'task.json': { verdict } });
      assert.equal((await inspect(await add('2026-10-25-13'))).ownerBlocked, true);
    });
  }
});
test('stored awaiting-approval checkpoint stage is an owner boundary even with a reversible review', async () => {
  const records = [];
  await assert.rejects(reconcileStartup({ previous: { ...failedPrevious, task: { stage: 'awaiting-approval', verdict: { verdict: 'approve', risk: 'reversible' } } }, repair: () => assert.fail('Approval checkpoint bypassed'), record: async entry => records.push(entry) }), /owner approval/);
  assert.equal(records[0].status, 'awaiting-approval');
});
test('successful ordinary run and validated pending experiment do not trigger recovery from stored reviewer verdict', async () => fixture(async ({ add, inspect }) => {
  await add('2026-10-25-5', { status: 'released', outcomes: [{ status: 'released' }, { kind: 'mutation', status: 'pending', sha: 'verified-sha', pr: 55, evidence: { ci: 'passed' } }] }, { 'task.json': { verdict: { verdict: 'reject' } } });
  const previous = await inspect(await add('2026-10-25-13'));
  assert.equal(previous.needsRecovery, false);
  assert.equal(previous.ownerBlocked, false);
}));
test('ordinary release with controller-recorded pending mutation remains successful', async () => fixture(async ({ add, inspect }) => {
  await add('2026-10-25-5', { status: 'released', outcomes: [{ status: 'released' }, { status: 'pending', phase: 'mutation', pr: 55 }] });
  assert.equal((await inspect(await add('2026-10-25-13'))).needsRecovery, false);
}));
