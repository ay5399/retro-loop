import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readUIMessageStream } from 'ai';

test('mock chat route emits a complete consumable UI message on every turn', async () => {
  // Execute the real handler with in-memory auth/data and policy stubs. No DB,
  // credentials, network, or environment changes are needed for this fixture.
  const stubs = {
    '@/auth': 'export async function auth() { return { user: { id: "fixture-user" } }; }',
    '@/lib/prisma': 'export const prisma = { retrospective: { async findFirst() { return { id: "fixture-retro", notes: [] }; } } };',
    '@/lib/service-policy': 'export function isMockLlm() { return true; } export function externalServiceEnabled() { throw new Error("Live policy must not be used"); } export function allowRequest() { throw new Error("Live policy must not be used"); }',
    '@/lib/llm/retro-tools': 'export function buildRetroSummary() { throw new Error("No live tools"); } export const buildRecurringIssues = buildRetroSummary;',
    '@/lib/llm/chat-guidance': 'export const ACTION_GUIDANCE = "";',
    '@ai-sdk/google': 'export function createGoogleGenerativeAI() { throw new Error("No live provider"); }',
  };
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../../src/app/api/chat/route.ts', import.meta.url))],
    bundle: true, packages: 'external', platform: 'node', format: 'cjs', write: false,
    plugins: [{ name: 'isolated-route-fixture', setup(builder) {
      builder.onResolve({ filter: /^(?:@\/|@ai-sdk\/google$)/ }, ({ path }) => {
        assert.ok(Object.hasOwn(stubs, path), `Unexpected application import: ${path}`);
        return { path, namespace: 'fixture' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: stubs[path], loader: 'js' }));
    } }],
  });
  const fixtureModule = { exports: {} };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), fixtureModule, fixtureModule.exports);
  const messages = [], ids = [];
  for (const input of ['??1', '??2']) {
    messages.push({ id: `user-${messages.length}`, role: 'user', parts: [{ type: 'text', text: input }] });
    const response = await fixtureModule.exports.POST(new Request('http://localhost/api/chat', {
      method: 'POST', body: JSON.stringify({ messages, retroId: 'fixture-retro', teamId: 'fixture-team' }),
    }));
    assert.equal(response.status, 200);
    const events = (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6));
    assert.equal(events.at(-1), '[DONE]');
    const chunks = events.slice(0, -1).map(value => JSON.parse(value));
    assert.equal(chunks[0].type, 'start');
    assert.ok(chunks[0].messageId);
    ids.push(chunks[0].messageId);
    assert.deepEqual(chunks.at(-1), { type: 'finish', finishReason: 'stop' });
    assert.equal(chunks.filter(chunk => chunk.type === 'finish').length, 1);
    assert.equal(chunks.at(-2).type, 'text-end');
    const stream = new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } });
    let message;
    for await (const update of readUIMessageStream({ stream, terminateOnError: true })) message = update;
    assert.equal(message.id, chunks[0].messageId);
    assert.equal(message.role, 'assistant');
    assert.ok(message.parts.some(part => part.type === 'text' && part.text.length > 0 && part.state === 'done'));
    messages.push(message);
  }
  assert.equal(new Set(ids).size, 2);
});
