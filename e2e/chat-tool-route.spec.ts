import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

test("隔離Routeの両ツールexecuteに認証済み本人IDが渡る", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Playwrightの既存baseURLが必要です");
  const stubs: Record<string, string> = {
    "@/auth": 'export async function auth() { return { user: { id: "authenticated-self" } }; }',
    "@/lib/prisma": `export const prisma = { retrospective: { async findFirst(query) {
      if (query.where.team.memberships.some.userId !== "authenticated-self") throw Error("authorization lost");
      return { id: "authorized-retro", name: "架空", notes: [] };
    } } };`,
    "@/lib/service-policy": 'export function isMockLlm() { return false; } export function externalServiceEnabled() { return true; } export const allowRequest = externalServiceEnabled;',
    "@/lib/llm/retro-tools": 'export async function buildRetroSummary(...args) { return args; } export async function buildRecurringIssues(...args) { return args; }',
    "@/lib/llm/chat-guidance": 'export const ACTION_GUIDANCE = "";',
    "@ai-sdk/google": 'export function createGoogleGenerativeAI() { return () => "isolated-model"; }',
    ai: `export async function safeValidateUIMessages({ messages }) { return { success: true, data: messages }; }
      export async function convertToModelMessages(messages) { return messages; }
      export const tool = value => value;
      export const stepCountIs = value => value;
      export function createUIMessageStream() { throw Error("unexpected mock path"); }
      export const createUIMessageStreamResponse = createUIMessageStream;
      export function streamText({ tools, system, stopWhen }) {
        return { async toUIMessageStreamResponse() {
          return Response.json({ summary: await tools.summarizeRetro.execute(),
            recurring: await tools.flagRecurringIssues.execute(), system, stopWhen });
        } };
      }`,
  };
  const bundle = await build({
    entryPoints: [path.resolve("src/app/api/chat/route.ts")],
    bundle: true, packages: "external", platform: "node", format: "cjs", write: false,
    plugins: [{ name: "isolated-tool-route", setup(builder) {
      builder.onLoad({ filter: /[\\/]api[\\/]chat[\\/]route\.ts$/ }, async ({ path: file }) => ({
        // Replace the existing credential read in this isolated bundle only.
        contents: (await readFile(file, "utf8")).replace(/const apiKey = [^;]+;/, 'const apiKey = "dummy-not-a-credential";'),
        loader: "ts",
      }));
      builder.onResolve({ filter: /^(?:@\/|@ai-sdk\/google$|ai$)/ }, ({ path: name }) => {
        expect(Object.hasOwn(stubs, name)).toBe(true);
        return { path: name, namespace: "fixture" };
      });
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: name }) => ({ contents: stubs[name], loader: "js" }));
    } }],
  });
  const loaded = { exports: {} as { POST(req: Request): Promise<Response> } };
  new Function("module", "exports", "require", bundle.outputFiles[0].text)(loaded, loaded.exports, createRequire(path.resolve("package.json")));
  const response = await loaded.exports.POST(new Request(new URL("/api/chat", baseURL), {
    method: "POST", body: JSON.stringify({ retroId: "authorized-retro", teamId: "dummy-team",
      userId: "untrusted-other", messages: [{ role: "user", parts: [{ type: "text", text: "総括と前回を確認" }] }] }),
  }));
  expect(response.status).toBe(200);
  const output = await response.json();
  expect(output.summary).toEqual(["authorized-retro", "authenticated-self"]);
  expect(output.recurring).toEqual(["authorized-retro", 3, "authenticated-self"]);
  expect(output.stopWhen).toBe(2);
  expect(output.system).toContain("付箋の作成者は行動の実行担当者を意味しません");
});
