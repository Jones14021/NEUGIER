import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

test('service worker activates automatically after caching and preserves non-shell caches', async () => {
  const source = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/sw.js'), 'utf8');
  const handlers: Record<string, (event: any) => void> = {};
  const deleted: string[] = [];
  const navigated: string[] = [];
  let skips = 0;
  const context = {
    self: { addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; }, skipWaiting: async () => { skips++; }, clients: { claim: async () => {}, matchAll: async () => [{ url: 'https://example.test/todos', navigate: async (url: string) => { navigated.push(url); } }] } },
    caches: { open: async () => ({ addAll: async () => {} }), keys: async () => ['neugier-shell-old', 'neugier-data-v1', 'neugier-media-v1', 'other'], delete: async (key: string) => { deleted.push(key); } },
    URL,
  };
  vm.runInNewContext(source, context);
  let pending: Promise<unknown> = Promise.resolve();
  handlers.install({ waitUntil: (value: Promise<unknown>) => { pending = value; } });
  await pending;
  assert.equal(skips, 1);
  handlers.message({ data: { type: 'SKIP_WAITING' }, waitUntil: (value: Promise<unknown>) => { pending = value; } });
  await pending;
  assert.equal(skips, 2);
  handlers.activate({ waitUntil: (value: Promise<unknown>) => { pending = value; } });
  await pending;
  assert.deepEqual(deleted, ['neugier-shell-old']);
  assert.deepEqual(navigated, ['https://example.test/todos']);
});