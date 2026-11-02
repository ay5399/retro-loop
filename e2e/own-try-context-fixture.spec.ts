import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { runBrowserProbe } from "../scripts/automation/verify-live-chat-ui.mjs";
import { actionScenario } from "../scripts/automation/live-scenario.mjs";

test("合成fixtureでも元Problem付き確認フォームの保存・再表示を通す", async ({}, testInfo) => {
  test.setTimeout(360_000);
  const dir = testInfo.outputPath("context-fixture");
  await mkdir(dir, { recursive: true });
  const scenario = actionScenario();
  const report = { transcripts: [], browser: undefined } as {
    transcripts: { input: string; text: string }[];
    browser?: { ownTryContextReappeared: boolean; liveCalls: number };
  };
  let calls = 0;
  await runBrowserProbe({ dir, report, inputs: scenario.inputs, saved: scenario.saved,
    signal: AbortSignal.timeout(330_000), expiresAt: Date.now() + 330_000,
    complete: async (input: string, delta: (text: string) => void) => {
      expect(input).toBe(scenario.inputs[calls]);
      expect(calls).toBeLessThan(3);
      const text = ++calls === 3
        ? `保存前の確認案です。${scenario.saved}。未保存です。自分でTry付箋に追加してください。`
        : "自分で実行できる行動と日付を教えてください。担当や期限をこちらでは決めません。";
      await new Promise(resolve => setTimeout(resolve, 150));
      delta(text);
      return { text };
    },
  });
  expect(calls).toBe(3);
  expect(report.browser).toMatchObject({ ownTryContextReappeared: true, liveCalls: 3 });
});
