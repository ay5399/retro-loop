import path from 'node:path';
import { lstat, readFile, realpath } from 'node:fs/promises';

const textExtensions = /\.(?:[cm]?[jt]sx?|json|mdx?|txt|html|css|scss|ya?ml|toml|xml|svg|sh|ps1|sql|prisma|env|csv)$/i;
const issue = (file, line, reason, guidance) => ({ file, line, reason, guidance });

export async function validateCandidateTextFiles(root, files) {
  const diagnostics = [];
  const base = await realpath(root);
  for (const file of files) {
    const parts = file.replaceAll('\\', '/').split('/');
    if (path.isAbsolute(file) || /^[A-Za-z]:/.test(file) || parts.some(part => !part || part === '..' || part === '.' || part.includes(':') || part.includes(String.fromCharCode(0)))) {
      diagnostics.push(issue(file, 1, 'Unsafe candidate path', 'Use a repository-relative path without traversal.')); continue;
    }
    let target = base, invalid = false;
    for (const part of parts) {
      target = path.join(target, part);
      try {
        if ((await lstat(target)).isSymbolicLink()) { invalid = true; break; }
      } catch (error) { if (error.code === 'ENOENT') break; throw error; }
    }
    if (invalid) { diagnostics.push(issue(file, 1, 'Candidate path contains a symbolic link', 'Replace the symlink with an ordinary repository file.')); continue; }
    if (!textExtensions.test(file) && !/(?:^|\/)\.[^/]+$/.test(file)) continue;
    let bytes;
    try { bytes = await readFile(target); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch {
      // Find the first invalid byte using a streaming fatal decoder, preserving line context.
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let line = 1;
      for (const byte of bytes) { try { decoder.decode(Uint8Array.of(byte), { stream: true }); } catch { break; } if (byte === 10) line++; }
      diagnostics.push(issue(file, line, 'Invalid UTF-8 encoding', 'Rewrite the file as UTF-8 from the original text; do not replace undecodable bytes with replacement characters.')); continue;
    }
    content.split('\n').forEach((line, index) => {
      if (line.includes('\uFFFD')) diagnostics.push(issue(file, index + 1, 'Unicode replacement character (U+FFFD)', 'Restore the original Japanese/text and save as UTF-8; do not leave replacement characters.'));
      if (/^(?:<{7}(?:\s|$)|={7}\s*$|>{7}(?:\s|$))/.test(line)) diagnostics.push(issue(file, index + 1, 'Unresolved merge conflict marker', 'Resolve the recovery merge conflict while preserving current main changes and the intended candidate; remove all conflict markers before review.'));
    });
  }
  return diagnostics;
}

export function validateCandidateDiff(diff) {
  const diagnostics = [];
  let file = '(diff)', line = 0, inHunk = false;
  for (const entry of diff.split('\n')) {
    if (entry.startsWith('diff --git ')) { inHunk = false; file = '(diff)'; continue; }
    // Added source text may itself start with ++/--. Only metadata outside a
    // hunk can name a file or be skipped as a header.
    if (!inHunk && entry.startsWith('--- a/')) { file = entry.slice(6).replace(/\r$/, ''); continue; }
    if (!inHunk && entry.startsWith('+++ b/')) { file = entry.slice(6).replace(/\r$/, ''); continue; }
    const hunk = entry.match(/^@@ .* \+(\d+)/);
    if (hunk) { line = Number(hunk[1]); inHunk = true; continue; }
    if (!inHunk) continue;
    if (entry.startsWith('-')) {
      if (file.startsWith('e2e/') && /expect\(|assert\.|test\(/.test(entry)) diagnostics.push(issue(file, line, 'Removing browser test coverage', 'Preserve existing assertions and repair the behavior or deterministic test synchronization.'));
      continue;
    }
    if (!entry.startsWith('+')) { if (entry.startsWith(' ')) line++; continue; }
    const text = entry.slice(1);
    const add = (reason, guidance) => diagnostics.push(issue(file, line, reason, guidance));
    if (/["']use server["']/.test(text)) add('New server action', 'Use the existing approved server interface; new server actions require owner approval.');
    if (/(?:AIza[\w-]{25,}|sk-(?:ant-)?[\w-]{20,}|gh[pousr]_[\w]{20,})/.test(text)) add('Possible credential in candidate', 'Remove the credential from the candidate and use the existing approved configuration.');
    if (/test\.(?:skip|fixme)|test\.describe\.skip/.test(text)) add('Disabled browser test', 'Keep the test enabled and fix the failure.');
    if (/^(?:src|public|e2e)\//.test(file)) {
      if (/process\s*(?:\.\s*env|\[\s*["']env["']\s*\])/.test(text)) add('Runtime environment or credential access', file.startsWith('e2e/') ? 'Do not add environment switches to bypass baseline assertions. Use recorded existing baseline screenshots and preserve assertions.' : 'Use existing approved configuration; do not introduce runtime credential access.');
      if (/\bfetch\s*\(|\brequire\s*\(|\bimport\s*\(|from\s+["'](?:@.*sdk|.*genai|node:child_process|child_process)/.test(text)) add('New network call, dynamic code loading, or SDK access', 'Use the existing mock interface and approved imports; do not add fetch calls, including loopback fetch calls.');
      const urls = text.match(/https?:\/\/[^\s"'`<>)]*/g) ?? [];
      // Only a complete standalone comparison of the existing baseURL variable
      // is exempt. Assertion callbacks, calls, compound statements, and navigation
      // are never evidence that a URL is merely a comparison literal.
      const comparison = text.match(/^\s*expect\s*\(\s*baseURL\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*(["'])(http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s"'\\]*)?)\1\s*\)\s*;?\s*$/);
      for (const url of urls) {
        const literalLoopbackAssertion = file.startsWith('e2e/') && comparison?.[2] === url;
        if (!literalLoopbackAssertion) add('New URL in runtime or browser test', 'Use the existing baseURL and mock fixtures; only literal loopback assertions are allowed without owner approval.');
      }
    }
    line++;
  }
  return diagnostics;
}

export function formatCandidateDiagnostics(diagnostics) {
  return diagnostics.map(({ file, line, reason, guidance }) => `${file}:${line}: ${reason}. ${guidance}`).join('\n');
}

export function assertCandidateValid(diagnostics) {
  if (diagnostics.length) throw new Error(`Candidate validation failed:\n${formatCandidateDiagnostics(diagnostics)}`);
}
