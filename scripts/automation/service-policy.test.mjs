import test from 'node:test';
import assert from 'node:assert/strict';
import { externalServiceEnabled, isMockLlm, allowRequest } from '../../src/lib/service-policy.ts';
test('live service gates require explicit permission and tests always win', () => {
  const original = { ...process.env };
  try {
    delete process.env.ALLOW_LIVE_LLM;
    assert.equal(externalServiceEnabled('llm'), false);
    process.env.ALLOW_LIVE_LLM = 'true';
    process.env.ALLOW_LIVE_EMAIL = 'true';
    process.env.AUTOMATION_TEST = '1';
    assert.equal(externalServiceEnabled('llm'), false);
    assert.equal(externalServiceEnabled('email'), false);
    delete process.env.AUTOMATION_TEST;
    assert.equal(externalServiceEnabled('llm'), true);
    process.env.LLM_PROVIDER = 'mock';
    assert.equal(isMockLlm(), true);
  } finally { process.env = original; }
});
test('request limiting rejects excess calls and resets after the minute', () => {
  assert.equal(allowRequest('test:rate', 2, 1000), true);
  assert.equal(allowRequest('test:rate', 2, 1001), true);
  assert.equal(allowRequest('test:rate', 2, 1002), false);
  assert.equal(allowRequest('test:rate', 2, 61001), true);
});
