import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const runner = fileURLToPath(new URL('./run.mjs', import.meta.url));
const policy = await readFile(new URL('../../automation/policy.json', import.meta.url), 'utf8');
test('unverified billing stops real runner before model execution, DB creation or deployment; slots deduplicate', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'retro-runner-test-'));
  try {
    const fake = path.join(dir, 'fake.mjs');
    await writeFile(fake, `import { appendFileSync } from 'node:fs';
const [name,...args] = process.argv.slice(2);
appendFileSync(process.env.RETRO_AUTOMATION_HOME + '/calls.txt', name + ' ' + args.join(' ') + '\\n');
if(name==='codex' && args.join(' ')==='login status') console.log('Logged in using ChatGPT');
else if(name==='claude' && args.join(' ')==='auth status') console.log('{"loggedIn":true}');
else if(name==='gh' && args[0]==='repo') console.log('{"visibility":"PUBLIC","defaultBranchRef":{"name":"main"}}');
else if(name==='gh' && args[0]==='issue' && args[1]==='create') console.log('https://github.com/ay5399/retro-loop/issues/999');
else { console.error('FORBIDDEN: '+name+' '+args.join(' ')); process.exit(1); }
`);
    const commands = Object.fromEntries(['codex', 'claude', 'gh', 'git', 'npm'].map(name => [name, { file: process.execPath, args: [fake, name] }]));
    await writeFile(path.join(dir, 'installation.json'), JSON.stringify({ repositoryPath: dir, commands }));
    await writeFile(path.join(dir, 'policy.json'), policy);
    const env = { ...process.env, RETRO_AUTOMATION_HOME: dir };
    await exec(process.execPath, [runner], { env });
    const calls = await readFile(path.join(dir, 'calls.txt'), 'utf8');
    assert.match(calls, /codex login status/);
    assert.doesNotMatch(calls, /codex .*exec|docker run|git |workflow|claude -p/);
    assert.equal(calls.match(/issue create/g)?.length, 1);
    await exec(process.execPath, [runner], { env });
    assert.equal(await readFile(path.join(dir, 'calls.txt'), 'utf8'), calls);
    const runs = await readdir(path.join(dir, 'runs'));
    const result = JSON.parse(await readFile(path.join(dir, 'runs', runs[0], 'result.json')));
    assert.equal(result.status, 'blocked');
    assert.ok(result.problems.some(p => p.includes('unverified')));
    // An active process lock must stop even the prerequisite checks.
    await writeFile(path.join(dir, 'runner.lock'), String(process.pid));
    const locked = await exec(process.execPath, [runner, '--dry-run'], { env });
    assert.match(locked.stdout, /Another run is active/);
    assert.equal(await readFile(path.join(dir, 'calls.txt'), 'utf8'), calls);
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
});
