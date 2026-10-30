import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { fixtureSdkAliases, resolveFixtureActions } from "../scripts/automation/verify-live-chat-ui.mjs";

// Keep a static import: the original failure occurred while collecting tests.
test("検証ヘルパーを収集でき、既定ルートがリポジトリーに一致する", async () => {
  const root = await realpath(".");
  const installed = createRequire(path.join(root, "package.json"));
  const aliases: Record<string, string> = await fixtureSdkAliases();
  expect(Object.keys(aliases).sort()).toEqual(["@ai-sdk/react", "ai"]);
  for (const name of ["ai", "@ai-sdk/react"]) {
    expect(aliases[name]).toBe(await realpath(installed.resolve(name)));
  }

  const sourceDir = path.join(root, "src");
  const retroDir = path.join(sourceDir, "app/teams/[teamId]/retros/[retroId]");
  const store = await realpath(path.join(root, "scripts/automation/live-ui-store.ts"));
  for (const component of ["kpt-board.client.tsx", "own-try-confirmation.tsx"]) {
    const resolved = resolveFixtureActions(path.join(retroDir, component), sourceDir);
    expect(resolved).toEqual({ path: path.join(root, "scripts/automation/live-ui-store.ts") });
    if (!resolved) throw new Error("Allowed fixture component did not resolve");
    expect(await realpath(resolved.path)).toBe(store);
    expect(resolveFixtureActions(path.join(sourceDir, "other", component), sourceDir)).toBeUndefined();
  }
});

test("合成actionsの接続は指定候補の二つの実パスだけを許可する", async () => {
  const root = await realpath(".");
  const sourceDir = path.join(root, "src");
  const retroPath = "app/teams/[teamId]/retros/[retroId]";
  const otherSourceDir = path.join(root, "other-candidate", "src");
  for (const component of ["kpt-board.client.tsx", "own-try-confirmation.tsx"]) {
    const importer = path.join(sourceDir, retroPath, component);
    expect(resolveFixtureActions(importer, sourceDir)).toEqual({
      path: path.join(root, "scripts/automation/live-ui-store.ts"),
    });
    expect(resolveFixtureActions(importer, otherSourceDir)).toBeUndefined();
    expect(resolveFixtureActions(path.join(otherSourceDir, retroPath, component), sourceDir)).toBeUndefined();
    expect(resolveFixtureActions(`${importer}.backup`, sourceDir)).toBeUndefined();
    expect(resolveFixtureActions(path.join(sourceDir, "nested", retroPath, component), sourceDir)).toBeUndefined();
  }
  expect(resolveFixtureActions(path.join(sourceDir, retroPath, "actions.ts"), sourceDir)).toBeUndefined();
});
