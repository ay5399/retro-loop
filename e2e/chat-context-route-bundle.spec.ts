import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

test("隔離したチャットRouteに実際の付箋文脈ヘルパーが含まれる", async () => {
  // Keep the same boundary as the existing isolated mock-route test: only
  // auth, DB, policy, tools, guidance and the provider are stubbed.
  // The pure context helper must resolve and bundle as real application code.
  const stubs: Record<string, string> = {
    "@/auth": 'export async function auth() { return { user: { id: "fixture-user" } }; }',
    "@/lib/prisma": 'export const prisma = { retrospective: { async findFirst() { return { id: "fixture-retro", notes: [] }; } } };',
    "@/lib/service-policy": 'export function isMockLlm() { return true; } export function externalServiceEnabled() { throw new Error("No live policy"); } export const allowRequest = externalServiceEnabled;',
    "@/lib/llm/retro-tools": 'export function buildRetroSummary() { throw new Error("No live tools"); } export const buildRecurringIssues = buildRetroSummary;',
    "@/lib/llm/chat-guidance": 'export const ACTION_GUIDANCE = "";',
    "@ai-sdk/google": 'export function createGoogleGenerativeAI() { throw new Error("No live provider"); }',
  };
  const result = await build({
    entryPoints: [path.resolve("src/app/api/chat/route.ts")],
    bundle: true, packages: "external", platform: "node", format: "cjs",
    write: false, metafile: true,
    plugins: [{ name: "isolated-context-route", setup(builder) {
      builder.onResolve({ filter: /^(?:@\/|@ai-sdk\/google$)/ }, ({ path: importPath }) => {
        expect(Object.hasOwn(stubs, importPath)).toBe(true);
        return { path: importPath, namespace: "fixture" };
      });
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: importPath }) => ({
        contents: stubs[importPath], loader: "js",
      }));
    } }],
  });
  const contextInputs = Object.keys(result.metafile!.inputs).filter((input) =>
    input.replaceAll("\\", "/").endsWith("src/lib/llm/chat-note-context.ts"));
  expect(contextInputs).toHaveLength(1);
  expect(result.metafile!.inputs[contextInputs[0]].imports).toEqual([]);
});
