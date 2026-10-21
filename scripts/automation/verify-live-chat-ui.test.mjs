import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertSafeStylesheet } from './verify-live-chat-ui.mjs';

test('live fixture rejects CSS that can load host code or additional files', () => {
  for (const css of ['@plugin "./host.js";', '@config "./host.js";', '@source "../../private";', '@import "./host.css";', '@reference "./host.css";', '@pl\\75gin "./host.js";']) {
    assert.throws(() => assertSafeStylesheet(css), /may not load/);
  }
});
test('current CSS and ordinary Tailwind variants remain usable', async () => {
  assert.doesNotThrow(() => assertSafeStylesheet('@import \'tailwindcss\'; @custom-variant dark (&:where(.dark, .dark *)); @utility tab-4 { tab-size: 4; } @variant dark { color: black; } @font-face { font-family: test; }'));
  const current = await readFile(new URL('../../src/app/globals.css', import.meta.url), 'utf8');
  assert.doesNotThrow(() => assertSafeStylesheet(current));
});
