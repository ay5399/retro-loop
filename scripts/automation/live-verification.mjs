// Store allowlisted diagnostics only: upstream messages may contain account data.
export function providerFailure(error) {
  const info = error?.codexErrorInfo;
  const code = typeof info === 'string' ? info : info && typeof info === 'object' ? Object.keys(info)[0] : '';
  const compact = code.replaceAll('_', '').toLowerCase();
  const status = info && typeof info === 'object' ? Object.values(info)[0]?.httpStatusCode : undefined;
  const category = compact === 'usagelimitexceeded' || status === 429 ? 'usage-limit'
    : /connection|streamdisconnected|toomanyfailedattempts|internalservererror/.test(compact) || status >= 500 ? 'provider-unavailable'
      : 'verification-unresolved';
  return { category, ...( /^[a-z_]{1,64}$/i.test(code) ? { code } : {}), ...(Number.isInteger(status) ? { httpStatus: status } : {}) };
}

export function exhaustedWindow(result, now = Date.now()) {
  const limits = result?.rateLimitsByLimitId?.codex ?? result?.rateLimits;
  const exhausted = [limits?.primary, limits?.secondary].filter(window => Number.isFinite(window?.usedPercent) && window.usedPercent >= 100);
  if (!exhausted.length) return null;
  const resets = exhausted.map(window => window.resetsAt * 1000).filter(value => Number.isSafeInteger(value) && value > now);
  return { category: 'usage-limit', code: 'UsageLimitExceeded', ...(resets.length === exhausted.length ? { retryAfter: new Date(Math.max(...resets)).toISOString() } : {}) };
}

export function liveRetryAllowed(task, { now = Date.now(), manual = false } = {}) {
  if (manual) return true; // Explicit diagnostic retry, never an approval override.
  if ((task.liveVerificationRetries ?? 0) >= 2) return false;
  const failure = task.liveFailure;
  if (failure?.category === 'provider-unavailable') return true;
  return failure?.category === 'usage-limit' && Number.isFinite(Date.parse(failure.retryAfter)) && now >= Date.parse(failure.retryAfter);
}
