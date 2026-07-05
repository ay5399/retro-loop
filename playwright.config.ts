import { defineConfig, devices } from "@playwright/test";

// RetroLoop E2E（実ブラウザでの動作確認）
// - 開発サーバ(npm run dev)を自動起動して http://localhost:3000 に対してテストする
// - スクリーンショットは各テスト内で明示的に取得（開発中の目視確認用）
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  // 初回のサーバアクションは dev サーバのコンパイル＋DBコールドで遅くなるため長めに
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
    // E2Eは決定論的に（＆無料枠を消費しないように）モックLLMで走らせる
    env: { LLM_PROVIDER: "mock" },
  },
});
