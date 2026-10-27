/** Dispatch once, then discover only the uniquely named run belonging to this request. */
export async function dispatchWorkflow({ gh, repository, workflow, ref = 'main', fields = {}, expectedTitle, deadline, onDispatch = async () => {}, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), pollIntervalMs = 2000 }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !workflow || !expectedTitle || !Number.isFinite(deadline)) throw new Error('Invalid workflow dispatch parameters');
  if (now() >= deadline) throw new Error('Workflow dispatch deadline reached before dispatch');
  const urlFor = id => `https://github.com/${repository}/actions/runs/${id}`;
  const identity = value => {
    const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/([1-9]\d*)\/?$/.exec(value);
    if (!match || match[1].toLowerCase() !== repository.toLowerCase() || !Number.isSafeInteger(Number(match[2]))) throw new Error('Workflow run URL does not match the repository');
    return { databaseId: Number(match[2]), url: urlFor(match[2]) };
  };
  // Persist intent before making the external write. A crash is an uncertain dispatch,
  // never permission to dispatch the same request a second time.
  await onDispatch({ status: 'dispatching', repository, workflow, ref, expectedTitle });
  let output = '', dispatchError;
  try {
    output = await gh(['workflow', 'run', workflow, '--repo', repository, '--ref', ref, ...Object.entries(fields).flatMap(([key, value]) => ['-f', `${key}=${value}`])]);
  } catch (error) { dispatchError = error; }
  await onDispatch({ status: dispatchError ? 'uncertain' : 'acknowledged', repository, workflow, ref, expectedTitle });
  let metadata;
  try { metadata = JSON.parse(String(output)); } catch { /* gh normally prints a human-readable run URL. */ }
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata) && (metadata.databaseId || metadata.id)) {
    const id = metadata.databaseId ?? metadata.id;
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid returned workflow run ID');
    if ((metadata.event && metadata.event !== 'workflow_dispatch') || (metadata.headBranch && metadata.headBranch !== ref) || (metadata.repository?.full_name && metadata.repository.full_name.toLowerCase() !== repository.toLowerCase())) throw new Error('Returned workflow metadata does not match the dispatch');
    const result = identity(metadata.url || metadata.html_url || urlFor(id));
    if (result.databaseId !== id) throw new Error('Workflow run ID does not match its URL');
    await onDispatch({ status: 'discovered', ...result, repository, workflow, ref, expectedTitle });
    return result;
  }
  const urls = String(output).match(/https:\/\/github\.com\/[^\s)]+\/actions\/runs\/\d+\/?/g) ?? [];
  if (urls.length) {
    const ids = urls.map(identity);
    if (ids.some(run => run.databaseId !== ids[0].databaseId)) throw new Error('Dispatch returned ambiguous workflow runs');
    await onDispatch({ status: 'discovered', ...ids[0], repository, workflow, ref, expectedTitle });
    return ids[0];
  }
  let lastError = dispatchError;
  while (now() < deadline) {
    let runs;
    try {
      runs = JSON.parse(await gh(['run', 'list', '--repo', repository, '--workflow', workflow, '--event', 'workflow_dispatch', '--branch', ref, '--json', 'databaseId,displayTitle,url,event,headBranch', '--limit', '100']));
      if (!Array.isArray(runs)) throw new Error('Invalid workflow run listing');
    } catch (error) { lastError = error; }
    if (runs) {
      const matches = runs.filter(run => run.displayTitle === expectedTitle && (!run.event || run.event === 'workflow_dispatch') && (!run.headBranch || run.headBranch === ref));
      if (matches.length > 1) throw new Error('Multiple workflow runs match the unique request title; refusing to select one');
      if (matches.length === 1) {
        const run = matches[0], result = identity(run.url || urlFor(run.databaseId));
        if (result.databaseId !== run.databaseId) throw new Error('Workflow run ID does not match its URL');
        await onDispatch({ status: 'discovered', ...result, repository, workflow, ref, expectedTitle });
        return result;
      }
    }
    const remaining = deadline - now();
    if (remaining > 0) await sleep(Math.min(pollIntervalMs, remaining));
  }
  throw new Error(`Workflow run discovery deadline reached; dispatch was ${dispatchError ? 'uncertain' : 'acknowledged'} and must not be repeated.${lastError ? ` Last error: ${lastError.message}` : ''}`);
}
