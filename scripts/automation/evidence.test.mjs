import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, rm } from 'node:fs/promises';
import { collectEvidence } from './evidence.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1kAAAAASUVORK5CYII=', 'base64');
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retro-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'repo'), runDir = path.join(root, 'run');
  await mkdir(path.join(dir, 'e2e', '__screens__'), { recursive: true });
  return { dir, runDir, kind: 'normal', screenshots: ['e2e/__screens__/before.png'] };
}
async function put(options, source, bytes = png) {
  const target = path.join(options.dir, source);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

test('copies declared PNGs and returns exact source and destination metadata', async t => {
  const options = await fixture(t);
  await put(options, options.screenshots[0]);
  const result = await collectEvidence(options);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, options.screenshots[0]);
  assert.equal(result[0].bytes, png.length);
  assert.deepEqual(await readFile(result[0].destination), png);
  assert.equal(path.basename(result[0].destination), result[0].filename);
  assert.deepEqual(await collectEvidence(options), result);
});

test('reports exact missing before path without publishing after as a substitute', async t => {
  const options = await fixture(t);
  options.screenshots.push('e2e/__screens__/after.png');
  await put(options, options.screenshots[1]);
  await assert.rejects(collectEvidence(options), error => {
    assert.equal(error.code, 'EVIDENCE_INVALID');
    assert.deepEqual(error.missingPaths, ['e2e/__screens__/before.png']);
    assert.match(error.message, /Missing browser evidence: e2e\/__screens__\/before\.png/);
    return true;
  });
  await assert.rejects(readdir(options.runDir), { code: 'ENOENT' });
});

test('rejects traversal, absolute paths, Windows aliases and wrong extensions', async t => {
  const options = await fixture(t);
  for (const source of ['../before.png', '/e2e/__screens__/x.png', 'C:/e2e/__screens__/x.png', 'e2e\\__screens__\\x.png', 'e2e/__screens__/../x.png', 'e2e/__screens__/./x.png', 'e2e/__screens__//x.png', 'e2e/__screens__/x.png:stream', 'e2e/__screens__/x.jpg', 'e2e/__screens__/x.PNG']) {
    await assert.rejects(collectEvidence({ ...options, screenshots: [source] }), /Unsafe browser evidence path/);
  }
});

test('rejects empty, signature-only, and renamed non-PNG content', async t => {
  const options = await fixture(t);
  for (const bytes of [Buffer.alloc(0), png.subarray(0, 8), Buffer.from('not a PNG image')]) {
    await put(options, options.screenshots[0], bytes);
    await assert.rejects(collectEvidence(options), /nonempty PNG|invalid PNG signature/);
  }
});

test('equal basenames from different scenario folders cannot overwrite each other', async t => {
  const options = await fixture(t);
  options.screenshots = ['e2e/__screens__/one/before.png', 'e2e/__screens__/two/before.png'];
  for (const source of options.screenshots) await put(options, source);
  const result = await collectEvidence(options);
  assert.notEqual(result[0].destination, result[1].destination);
  assert.equal((await readdir(options.runDir)).length, 2);
});

test('rejects symlink file', async t => {
  const options = await fixture(t);
  await put(options, 'e2e/__screens__/real.png');
  try {
    await symlink(path.join(options.dir, 'e2e', '__screens__', 'real.png'), path.join(options.dir, 'e2e', '__screens__', 'before.png'));
  } catch (error) {
    if (error.code === 'EPERM') { t.skip('Windows symlink permission unavailable'); return; }
    throw error;
  }
  await assert.rejects(collectEvidence(options), /symlink paths are forbidden/);
});

test('rejects symlink ancestor directory (Windows junctions included)', async t => {
  const options = await fixture(t);
  await put(options, 'e2e/__screens__/real.png');
  await symlink(path.join(options.dir, 'e2e', '__screens__'), path.join(options.dir, 'e2e', '__screens__', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(collectEvidence({ ...options, screenshots: ['e2e/__screens__/linked/real.png'] }), /symlink paths are forbidden/);
});

test('caps combined evidence size before publishing', async t => {
  const options = await fixture(t);
  options.screenshots = ['e2e/__screens__/first.png', 'e2e/__screens__/second.png'];
  const large = Buffer.alloc(11 * 1024 * 1024);
  png.copy(large);
  for (const source of options.screenshots) await put(options, source, large);
  await assert.rejects(collectEvidence(options), /exceeds 20 MiB/);
  await assert.rejects(readdir(options.runDir), { code: 'ENOENT' });
});
