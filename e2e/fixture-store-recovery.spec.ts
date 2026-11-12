import { test, expect } from "@playwright/test";
import { cp, copyFile, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { runBrowserProbe } from "../scripts/automation/verify-live-chat-ui.mjs";
import { actionScenario } from "../scripts/automation/live-scenario.mjs";

test("候補storeの本人Try保存記録を同じブラウザーの保存内容と再表示で照合する", async ({}, testInfo) => {
  test.setTimeout(360_000);
  const root = await realpath(".");
  const sourceRoot = testInfo.outputPath("candidate-checkout");
  const dir = testInfo.outputPath("probe");
  await mkdir(path.join(sourceRoot, "scripts/automation"), { recursive: true });
  await mkdir(dir, { recursive: true });
  await cp(path.join(root, "src"), path.join(sourceRoot, "src"), { recursive: true });
  for (const name of ["live-ui-entry.tsx", "live-ui-store.ts"]) {
    await copyFile(path.join(root, "scripts/automation", name), path.join(sourceRoot, "scripts/automation", name));
  }
  expect(await realpath(sourceRoot)).not.toBe(root);
  const scenario = actionScenario();
  expect(scenario.date > new Date().toISOString().slice(0, 10)).toBe(true);
  const action = scenario.saved.split("／行動：")[1];
  expect(action).toBeTruthy();
  const expectedContent = `行動：${action}\n担当：自分（付箋の作成者）\n日付：${scenario.date}\n元Problem：コードレビューの待ち時間が長い`;
  const auditKey = "fixture-store-recovery-audit";
  const expectedAudit = { source: "candidate-store-only", action, date: scenario.date, problemId: "problem-fixture", problemContent: "コードレビューの待ち時間が長い" };
  // Instrument only the disposable candidate store, immediately before its real save.
  const storePath = path.join(sourceRoot, "scripts/automation/live-ui-store.ts");
  const store = await readFile(storePath, "utf8");
  const save = "await addNote(teamId, retroId, 'TRY', data);";
  expect(store.split(save)).toHaveLength(2);
  await writeFile(storePath, store.replace(save, `localStorage.setItem(${JSON.stringify(auditKey)}, JSON.stringify([{ source: "candidate-store-only", action: String(form.get('action')).trim(), date: String(form.get('date')), problemId, problemContent: source?.content }]));\n  ${save}`), "utf8");
  // The candidate entry checks the audit in the SAME browser on save and reload.
  // Falling back to the root store leaves no audit and prevents the note rendering.
  const entryPath = path.join(sourceRoot, "scripts/automation/live-ui-entry.tsx");
  const entry = await readFile(entryPath, "utf8");
  const importLine = "import { getNotes } from './live-ui-store';";
  expect(entry.split(importLine)).toHaveLength(2);
  await writeFile(entryPath, entry.replace(importLine, `import { getNotes as readNotes } from './live-ui-store';
function getNotes() {
  const notes = readNotes();
  const confirmed = notes.filter(note => note.content.includes('元Problem：'));
  const audit = JSON.parse(localStorage.getItem(${JSON.stringify(auditKey)}) ?? '[]');
  const expected = confirmed.map(() => (${JSON.stringify(expectedAudit)}));
  const contents = confirmed.map(note => note.content);
  const expectedContents = confirmed.map(() => ${JSON.stringify(expectedContent)});
  if (JSON.stringify(audit) !== JSON.stringify(expected) || JSON.stringify(contents) !== JSON.stringify(expectedContents)) {
    throw new Error('Candidate store audit must match the saved own Try');
  }
  return notes;
}`), "utf8");
  const replies = [
    "レビュー待ちのどの場面で困っていますか。自分で変えられることを教えてください。",
    "担当者や期限はまだ未定ですね。自分で実行する行動と具体的な日付を教えてください。",
    `保存前の確認案です。${scenario.saved}。未保存です。確認して自分でTry付箋に追加してください。`,
  ];
  const report: {
    transcripts: { input: string; text: string }[];
    browser?: { status: string; ownTryContextReappeared: boolean; savedNoteReappeared: boolean; liveCalls: number };
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
  await mkdir(path.join(root, "e2e/__screens__"), { recursive: true });
  for (const phase of ["before", "after"]) {
    const screenshot = path.join(dir, `ui-${phase}.png`);
    expect((await stat(screenshot)).size).toBeGreaterThan(0);
    await copyFile(screenshot, path.join(root, `e2e/__screens__/fixture-store-recovery-${phase}.png`));
    await testInfo.attach(`fixture-store-recovery-${phase}`, { path: screenshot, contentType: "image/png" });
  }
});
