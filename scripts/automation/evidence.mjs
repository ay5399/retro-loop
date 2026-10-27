import path from 'node:path';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, readFile, mkdir, copyFile } from 'node:fs/promises';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_BATCH_BYTES = 20 * 1024 * 1024;

// Validate the entire declaration before publishing any evidence. Missing before
// screenshots must be repaired in the scenario, never replaced with after shots.
export async function collectEvidence({ dir, runDir, kind, screenshots }) {
  const problems = [], missingPaths = [], evidence = [];
  if (!/^[a-z0-9-]+$/i.test(kind ?? '')) throw new Error('Invalid evidence kind');
  if (!Array.isArray(screenshots) || screenshots.length === 0) throw new Error('Browser evidence declarations are required');
  let total = 0;
  for (const source of [...new Set(screenshots)]) {
    if (typeof source !== 'string' || !/^e2e\/__screens__\/.+\.png$/.test(source) || source.includes('\\') || source.includes(':') || /[\x00-\x1f<>"|?*]/.test(source) || source.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
      problems.push(`Unsafe browser evidence path: ${JSON.stringify(source)}`);
      continue;
    }
    const resolved = path.resolve(dir, source);
    try {
      let current = path.resolve(dir);
      for (const part of [null, ...source.split('/')]) {
        if (part !== null) current = path.join(current, part);
        const info = await lstat(current);
        if (info.isSymbolicLink()) throw new Error('symlink paths are forbidden');
      }
      const info = await lstat(resolved);
      if (!info.isFile() || info.size <= PNG_SIGNATURE.length) throw new Error('expected a nonempty PNG file');
      total += info.size;
      if (total > MAX_BATCH_BYTES) throw new Error('evidence batch exceeds 20 MiB');
      const bytes = await readFile(resolved);
      if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new Error('invalid PNG signature');
      const digest = createHash('sha256').update(source).digest('hex').slice(0, 16);
      const filename = `${kind}-${digest}.png`;
      evidence.push({ source, destination: path.resolve(runDir, filename), filename, bytes: info.size });
    } catch (error) {
      if (error.code === 'ENOENT') {
        missingPaths.push(source);
        problems.push(`Missing browser evidence: ${source}. The Playwright scenario must create this exact PNG path.`);
      } else problems.push(`Invalid browser evidence ${source}: ${error.message}`);
    }
  }
  if (problems.length) {
    const error = new Error(problems.join('\n'));
    error.code = 'EVIDENCE_INVALID';
    error.missingPaths = missingPaths;
    throw error;
  }
  await mkdir(runDir, { recursive: true });
  for (const item of evidence) {
    // Identical declarations on retries overwrite only their own deterministic file.
    await copyFile(path.resolve(dir, item.source), item.destination, constants.COPYFILE_FICLONE);
  }
  return evidence;
}
