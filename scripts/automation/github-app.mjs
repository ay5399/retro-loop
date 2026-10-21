import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';

export const appPermissions = Object.freeze({ contents: 'write', actions: 'write', issues: 'write', pull_requests: 'write', checks: 'write', metadata: 'read', administration: 'read', environments: 'read' });
export function validateInstallation(installation, config, repository) {
  const [owner] = repository.split('/');
  if (String(installation.app_id) !== String(config.appId) || installation.account?.login !== owner || installation.repository_selection !== 'selected' || installation.suspended_at) throw new Error('GitHub App installation must be active and limited to selected repositories under the repository owner.');
  for (const [name, level] of Object.entries(installation.permissions ?? {})) {
    if (!appPermissions[name] || level !== appPermissions[name]) throw new Error(`GitHub App has excessive or invalid permission: ${name}`);
  }
  for (const [name, level] of Object.entries(appPermissions)) {
    if (installation.permissions?.[name] !== level) throw new Error(`GitHub App requires ${name}: ${level}`);
  }
}

export function createAppAuth(config, repository, { request = fetch, clock = Date.now } = {}) {
  let cached;
  async function api(endpoint, token, body) {
    const response = await request(`https://api.github.com${endpoint}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'RetroLoop-Automation' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`GitHub App API ${endpoint}: HTTP ${response.status}`);
    return response.json();
  }
  return async function token({ minValidityMs = 300_000 } = {}) {
    if (cached && Date.parse(cached.expires_at) > clock() + minValidityMs) return cached.token;
    if (!config?.appId || !/^\d+$/.test(String(config.installationId)) || !config.privateKeyPath) throw new Error('Configure GitHub App appId, installationId and privateKeyPath in the private runtime github-app.json.');
    const key = await readFile(config.privateKeyPath, 'utf8');
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const seconds = Math.floor(clock() / 1000);
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: seconds - 60, exp: seconds + 540, iss: String(config.appId) })}`;
    const jwt = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(key, 'base64url')}`;
    const installation = await api(`/app/installations/${config.installationId}`, jwt);
    validateInstallation(installation, config, repository);
    const issued = await api(`/app/installations/${config.installationId}/access_tokens`, jwt, { repositories: [repository.split('/')[1]], permissions: appPermissions });
    if (!issued.token || !Number.isFinite(Date.parse(issued.expires_at)) || Date.parse(issued.expires_at) <= clock() + minValidityMs) throw new Error('GitHub App token missing or already expiring.');
    const repos = await api('/installation/repositories?per_page=100', issued.token);
    if (repos.total_count !== 1 || repos.repositories?.[0]?.full_name !== repository) throw new Error('GitHub App token must access only the configured repository.');
    cached = issued;
    return cached.token;
  };
}
