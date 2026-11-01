import { test, expect } from "@playwright/test";
import { mkdir, realpath, stat, symlink, unlink } from "node:fs/promises";
import path from "node:path";
import { runBrowserProbe } from "../scripts/automation/verify-live-chat-ui.mjs";
import { actionScenario } from "../scripts/automation/live-scenario.mjs";

test("実プローブが候補リンクからモック3往復とTry保存・再表示を検証する", async ({}, testInfo) => {
  test.setTimeout(360_000);
  const root = await realpath(".");
  const sourceRoot = testInfo.outputPath("candidate-source");
  const dir = path.join(root, "e2e/__screens__/own-try-probe-recovery");
  await mkdir(testInfo.outputDir, { recursive: true });
  await mkdir(dir, { recursive: true });
  // A junction is also a directory symlink on the hosted Linux runner.
  await symlink(root, sourceRoot, "junction");
  try {
    expect(await realpath(sourceRoot)).toBe(root);
    const scenario = actionScenario();
    const replies = [
      "まず、レビュー待ちのどの場面で困っていますか。自分で変えられそうなことを教えてください。",
      "担当者や期限はまだ未定ですね。あなた自身が実行する行動と、実行できる日付を教えてください。",
      `保存前の確認案です。${scenario.saved}。まだ未保存です。内容を確認し、自分でTry付箋に追加してください。`,
    ];
    const report: {
      transcripts: { input: string; text: string }[];
      browser?: { status: string; savedNoteReappeared: boolean; liveCalls: number; persistence: string };
      inferenceFailed?: boolean;
    } = { transcripts: [] };
    let calls = 0;
    await runBrowserProbe({
      sourceRoot, dir, report, inputs: scenario.inputs, saved: scenario.saved,
      signal: AbortSignal.timeout(330_000),
      expiresAt: Date.now() + 330_000,
      complete: async (input: string, delta: (text: string) => void) => {
        expect(calls).toBeLessThan(3);
        expect(input).toBe(scenario.inputs[calls]);
        const text = replies[calls++];
        // Keep the busy state observable without changing the real probe assertions.
        await new Promise(resolve => setTimeout(resolve, 150));
        delta(text.slice(0, 12));
        delta(text.slice(12));
        return { text };
      },
    });
    expect(calls).toBe(3);
    expect(report.inferenceFailed).toBeUndefined();
    expect(report.transcripts).toEqual(scenario.inputs.map((input: string, i: number) => ({ input, text: replies[i] })));
    expect(report.browser).toMatchObject({ status: "passed", savedNoteReappeared: true, liveCalls: 3 });
    expect(report.browser?.persistence).toContain("synthetic localStorage");
    for (const name of ["ui-before.png", "ui-after.png"]) {
      expect((await stat(path.join(dir, name))).size).toBeGreaterThan(0);
      await testInfo.attach(name, { path: path.join(dir, name), contentType: "image/png" });
    }
  } finally {
    // Remove only the directory link, never traverse or remove its checkout target.
    await unlink(sourceRoot);
  }
});
