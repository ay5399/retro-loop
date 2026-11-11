import { test, expect } from "@playwright/test";
import { cp, copyFile, mkdir, readFile, realpath, stat, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { runBrowserProbe } from "../scripts/automation/verify-live-chat-ui.mjs";
import { actionScenario } from "../scripts/automation/live-scenario.mjs";

test("別実パスの候補fixtureで3往復から本人Tryの確認保存・再表示まで検査する", async ({}, testInfo) => {
  test.setTimeout(360_000);
  const root = await realpath(".");
  const candidate = testInfo.outputPath("candidate-checkout");
  const sourceRoot = testInfo.outputPath("candidate-link");
  const dir = testInfo.outputPath("probe");
  await mkdir(path.join(candidate, "scripts/automation"), { recursive: true });
  await mkdir(dir, { recursive: true });
  await cp(path.join(root, "src"), path.join(candidate, "src"), { recursive: true });
  for (const name of ["live-ui-entry.tsx", "live-ui-store.ts"]) {
    await copyFile(path.join(root, "scripts/automation", name), path.join(candidate, "scripts/automation", name));
  }
  // A rendered attribute proves the browser bundle consumed the copied component.
  // Only this disposable candidate is marked; the checkout component is untouched.
  const chat = path.join(candidate, "src/app/teams/[teamId]/retros/[retroId]/ai-chat.tsx");
  const original = await readFile(chat, "utf8");
  expect(original).toContain("data-ai-chat>");
  const marker = "fixture-recovery-candidate-component";
  await writeFile(chat, original.replace("data-ai-chat>", `data-ai-chat data-recovery-source="${marker}">`), "utf8");
  await symlink(candidate, sourceRoot, "junction");
  try {
    expect(await realpath(sourceRoot)).toBe(await realpath(candidate));
    expect(await realpath(sourceRoot)).not.toBe(root);
    const scenario = actionScenario();
    expect(scenario.date > new Date().toISOString().slice(0, 10)).toBe(true);
    const replies = [
      "レビュー待ちのどの場面で困っていますか。自分で変えられることを教えてください。",
      "担当者や期限はまだ未定ですね。自分で実行する行動と具体的な日付を教えてください。",
      `保存前の確認案です。${scenario.saved}。未保存です。確認して自分でTry付箋に追加してください。`,
    ];
    const report: {
      transcripts: { input: string; text: string }[];
      browser?: { status: string; ownTryContextReappeared: boolean; savedNoteReappeared: boolean; liveCalls: number; persistence: string };
      inferenceFailed?: boolean;
    } = { transcripts: [] };
    let calls = 0;
    await runBrowserProbe({
      sourceRoot, dir, report, inputs: scenario.inputs, saved: scenario.saved,
      signal: AbortSignal.timeout(330_000), expiresAt: Date.now() + 330_000,
      complete: async (input: string, delta: (text: string) => void) => {
        expect(calls).toBeLessThan(3);
        expect(input).toBe(scenario.inputs[calls]);
        const text = replies[calls++];
        await new Promise(resolve => setTimeout(resolve, 150));
        delta(text.slice(0, 12));
        delta(text.slice(12));
        return { text };
      },
    });
    expect(calls).toBe(3);
    expect(report.inferenceFailed).toBeUndefined();
    expect(report.transcripts).toEqual(scenario.inputs.map((input: string, i: number) => ({ input, text: replies[i] })));
    expect(report.browser).toMatchObject({ status: "passed", ownTryContextReappeared: true, savedNoteReappeared: true, liveCalls: 3 });
    expect(report.browser?.persistence).toContain("synthetic localStorage");
    expect(await readFile(path.join(dir, "app.js"), "utf8")).toContain(marker);
    await mkdir(path.join(root, "e2e/__screens__"), { recursive: true });
    for (const phase of ["before", "after"]) {
      const screenshot = path.join(dir, `ui-${phase}.png`);
      expect((await stat(screenshot)).size).toBeGreaterThan(0);
      await copyFile(screenshot, path.join(root, `e2e/__screens__/fixture-recovery-confirm-${phase}.png`));
      await testInfo.attach(`fixture-recovery-${phase}`, { path: screenshot, contentType: "image/png" });
    }
  } finally {
    // Unlink only the candidate link; retain the copied source in test artifacts.
    await unlink(sourceRoot);
  }
});
