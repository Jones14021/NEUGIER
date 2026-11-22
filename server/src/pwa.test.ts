import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

test('service worker activates automatically after caching and preserves non-shell caches', async () => {
  const source = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/sw.js'), 'utf8')
    .replace('"__BUILD_ASSETS__"', '"/assets/app.js", "/assets/app.css"');
  const handlers: Record<string, (event: any) => void> = {};
  const deleted: string[] = [];
  const navigated: string[] = [];
  let skips = 0;
  const context = {
    self: { addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; }, skipWaiting: async () => { skips++; }, clients: { claim: async () => {}, matchAll: async () => [{ url: 'https://example.test/todos', navigate: async (url: string) => { navigated.push(url); } }] } },
    caches: { open: async () => ({ addAll: async () => {}, match: async (key: string) => key === '/' ? { text: async () => '<script src="/assets/app.js"></script><link href="/assets/app.css">' } : { headers: { get: () => key.endsWith('.js') ? 'text/javascript' : 'text/css' } } }), keys: async () => ['neugier-shell-old', 'neugier-data-v1', 'neugier-media-v1', 'other'], delete: async (key: string) => { deleted.push(key); } },
    URL,
  };
  vm.runInNewContext(source, context);
  let pending: Promise<unknown> = Promise.resolve();
  handlers.install({ waitUntil: (value: Promise<unknown>) => { pending = value; } });
  await pending;
  assert.equal(skips, 1);
  assert.equal(handlers.message, undefined);
  handlers.activate({ waitUntil: (value: Promise<unknown>) => { pending = value; } });
  await pending;
  assert.deepEqual(deleted, ['neugier-shell-old']);
  assert.deepEqual(navigated, ['https://example.test/todos']);
});

test('service worker serves navigations from its own cached shell', async () => {
  const source = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/sw.js'), 'utf8');
  const handlers: Record<string, (event: any) => void> = {};
  const shell = { body: 'matching shell' };
  let fetches = 0;
  const context = {
    self: { addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; } },
    location: { origin: 'https://example.test' },
    caches: { open: async () => ({ match: async (key: string) => key === '/' ? shell : undefined }) },
    fetch: async () => { fetches++; throw new Error('offline'); },
    URL,
  };
  vm.runInNewContext(source, context);
  let response: Promise<unknown> = Promise.reject(new Error('no response'));
  response.catch(() => {});
  for (const url of ['https://example.test/tag/1', 'https://example.test/teilen?text=example']) {
    handlers.fetch({ request: { method: 'GET', url, mode: 'navigate' }, respondWith: (value: Promise<unknown>) => { response = value; } });
    assert.equal(await response, shell);
  }
  assert.equal(fetches, 0);
});

test('service worker does not activate a mismatched or invalid build', async () => {
  const source = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/sw.js'), 'utf8')
    .replace('"__BUILD_ASSETS__"', '"/assets/app.js"');
  for (const [html, contentType] of [
    ['<script src="/assets/other.js"></script>', 'text/javascript'],
    ['<script src="/assets/app.js"></script>', 'text/html'],
  ]) {
    const handlers: Record<string, (event: any) => void> = {};
    let skips = 0;
    const context = {
      self: { addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; }, skipWaiting: async () => { skips++; } },
      caches: { open: async () => ({ addAll: async () => {}, match: async (key: string) => key === '/' ? { text: async () => html } : { headers: { get: () => contentType } } }) },
      URL,
    };
    vm.runInNewContext(source, context);
    let pending: Promise<unknown> = Promise.resolve();
    handlers.install({ waitUntil: (value: Promise<unknown>) => { pending = value; } });
    await assert.rejects(pending);
    assert.equal(skips, 0);
  }
});

test('service worker does not intercept Google Maps JavaScript', () => {
  const source = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/sw.js'), 'utf8');
  const handlers: Record<string, (event: any) => void> = {};
  const context = {
    self: { addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; } },
    location: { origin: 'https://example.test' },
    URL,
  };
  vm.runInNewContext(source, context);
  for (const url of [
    'https://maps.googleapis.com/maps/api/js?key=example',
    'https://maps.googleapis.com/maps/api/js/AuthenticationService.Authenticate',
    'https://maps.googleapis.com/maps-api-v3/api/js/66/13d/main.js',
  ]) {
    let intercepted = false;
    handlers.fetch({ request: { method: 'GET', url }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, url);
  }
});

test('service worker never caches private conversation history', () => {
  const source = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/sw.js'), 'utf8');
  const handlers: Record<string, (event: any) => void> = {};
  const context = {
    self: { addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; } },
    location: { origin: 'https://example.test' },
    URL,
  };
  vm.runInNewContext(source, context);
  for (const url of ['https://example.test/api/trips/trip/conversations', 'https://example.test/api/trips/trip/conversations/chat', 'https://example.test/api/admin/settings', 'https://example.test/api/trips/trip/podcasts', 'https://example.test/api/trips/trip/podcasts/day/audio']) {
    let intercepted = false;
    handlers.fetch({ request: { method: 'GET', url }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false);
  }
});

test('service worker keeps cached build assets instead of revalidating them', async () => {
  const source = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/sw.js'), 'utf8');
  const handlers: Record<string, (event: any) => void> = {};
  const asset = { body: 'matching asset' };
  let fetches = 0;
  const context = {
    self: { addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; } },
    location: { origin: 'https://example.test' },
    caches: { open: async () => ({ match: async () => asset }) },
    fetch: async () => { fetches++; throw new Error('offline'); },
    URL,
  };
  vm.runInNewContext(source, context);
  let response: Promise<unknown> = Promise.reject(new Error('no response'));
  response.catch(() => {});
  handlers.fetch({ request: { method: 'GET', url: 'https://example.test/assets/index-old.js', mode: 'cors' }, respondWith: (value: Promise<unknown>) => { response = value; } });
  assert.equal(await response, asset);
  assert.equal(fetches, 0);
});