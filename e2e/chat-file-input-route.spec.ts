import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";

test("実SDK検証後の添付拒否は変換・DB・providerへ進まない", async ({ baseURL }) => {
  expect(baseURL).toBeDefined();
  const boundary = { conversions: 0, database: 0, providers: 0 };
  const stubs: Record<string, string> = {
    "@/auth": 'export async function auth() { return { user: { id: "fixture-self" } }; }',
    "@/lib/prisma": 'export const prisma = { retrospective: { async findFirst() { boundary.database++; throw Error("unexpected DB"); } } };',
    "@/lib/service-policy": 'export function isMockLlm() { throw Error("unexpected policy"); } export const externalServiceEnabled = isMockLlm; export const allowRequest = isMockLlm;',
    "@/lib/llm/retro-tools": 'export function buildRetroSummary() { throw Error("unexpected tools"); } export const buildRecurringIssues = buildRetroSummary;',
    "@/lib/llm/chat-guidance": 'export const ACTION_GUIDANCE = "";',
    "@ai-sdk/google": 'export function createGoogleGenerativeAI() { boundary.providers++; throw Error("unexpected provider"); }',
    ai: `export { safeValidateUIMessages } from "fixture-real-ai";
      export function convertToModelMessages() { boundary.conversions++; throw Error("unexpected conversion"); }
      export function streamText() { boundary.providers++; throw Error("unexpected stream"); }
      export function tool() { throw Error("unexpected tool"); }
      export const stepCountIs = tool;
      export const createUIMessageStream = tool;
      export const createUIMessageStreamResponse = tool;`,
  };
  const bundle = await build({
    entryPoints: [path.resolve("src/app/api/chat/route.ts")],
    bundle: true, packages: "external", platform: "node", format: "cjs", write: false,
    plugins: [{ name: "file-input-boundary", setup(builder) {
      builder.onResolve({ filter: /^fixture-real-ai$/ }, () => ({ path: "ai", external: true }));
      builder.onResolve({ filter: /^(?:@\/|@ai-sdk\/google$|ai$)/ }, ({ path: name }) => {
        expect(Object.hasOwn(stubs, name)).toBe(true);
        return { path: name, namespace: "fixture" };
      });
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: name }) => ({ contents: stubs[name], loader: "js" }));
    } }],
  });
  const loaded = { exports: {} as { POST(req: Request): Promise<Response> } };
  new Function("module", "exports", "require", "boundary", bundle.outputFiles[0].text)(
    loaded, loaded.exports, createRequire(path.resolve("package.json")), boundary,
  );
  for (const type of ["file", "reasoning-file"]) {
    for (const role of ["user", "assistant"]) {
      for (const url of [`${baseURL}/api/chat`, "data:text/plain;base64,ZHVtbXk="]) {
        const response = await loaded.exports.POST(new Request(`${baseURL}/api/chat`, {
          method: "POST", body: JSON.stringify({ teamId: "fixture-team", retroId: "fixture-retro",
            messages: [{ id: "attachment", role, parts: [{ type, mediaType: "text/plain", url }] }],
          }),
        }));
        expect(response.status).toBe(400);
        expect(await response.text()).toBe("添付ファイルには対応していません。文章で相談してください。");
        expect(boundary).toEqual({ conversions: 0, database: 0, providers: 0 });
      }
    }
  }
});
