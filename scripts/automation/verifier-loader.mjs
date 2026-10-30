import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Execute the reviewed candidate source with the controller's installed dependencies
// and fixture paths. Candidate worktrees intentionally contain only static SDK docs.
export async function loadCandidateVerifier(repositoryRoot, sourceRoot) {
  const relative = 'scripts/automation/verify-live-chat-ui.mjs';
  const source = await readFile(path.join(sourceRoot, relative), 'utf8');
  const url = pathToFileURL(path.join(repositoryRoot, relative));
  url.searchParams.set('candidate', randomUUID());
  const target = url.href;
  const hooks = registerHooks({ load(url, context, nextLoad) {
    return url === target ? { format: 'module', source, shortCircuit: true } : nextLoad(url, context);
  } });
  try { return await import(target); }
  finally { hooks.deregister(); }
}
