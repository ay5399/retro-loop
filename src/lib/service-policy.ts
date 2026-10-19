// External calls are opt-in. Test runs never inherit permission to spend.
export function externalServiceEnabled(service: "llm" | "email"): boolean {
  if (process.env.AUTOMATION_TEST === "1") return false;
  return process.env[service === "llm" ? "ALLOW_LIVE_LLM" : "ALLOW_LIVE_EMAIL"] === "true";
}

export function isMockLlm(): boolean {
  return process.env.LLM_PROVIDER === "mock";
}

// This protects one process; provider-side hard limits are required as well,
// since serverless instances do not share memory.
const windows = new Map<string, { count: number; until: number }>();
export function allowRequest(key: string, limit: number, now = Date.now()): boolean {
  for (const [id, entry] of windows) if (entry.until <= now) windows.delete(id);
  const entry = windows.get(key) ?? { count: 0, until: now + 60_000 };
  if (entry.count >= limit || (!windows.has(key) && windows.size >= 10_000)) return false;
  entry.count++;
  windows.set(key, entry);
  return true;
}
