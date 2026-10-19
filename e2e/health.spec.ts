import { test, expect } from "@playwright/test";

test("内部ヘルス情報は認証なしでは取得できない", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(401);
  expect(await response.text()).not.toContain("keysPresent");
});

test("内部ヘルス情報は誤った認証を拒否する", async ({ request }) => {
  const response = await request.get("/api/health", { headers: { Authorization: "Bearer incorrect" } });
  expect(response.status()).toBe(401);
});

test("内部ヘルス情報で実キーと外部呼び出しの無効化を確認できる", async ({ request }) => {
  const response = await request.get("/api/health", { headers: { Authorization: "Bearer e2e-only-health-token" } });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ sha: "e2e", liveLlm: false, liveEmail: false, keysPresent: false });
  expect(response.headers()["cache-control"]).toBe("no-store");
});
