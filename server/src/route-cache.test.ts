import assert from 'node:assert/strict';
import test from 'node:test';

test('route cache isolates users and expires at local 2 a.m.', async () => {
  const fakeIndexedDb = 'fake-indexeddb/auto';
  await import(fakeIndexedDb);
  const modulePath = '../../web/src/routeCache';
  const { lastRouteReset, nextRouteReset, pruneRouteCache, readCachedRoute, saveCachedRoute } = await import(modulePath);
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'Pacific/Auckland';
  try {
    const beforeReset = new Date(2026, 8, 27, 1, 59, 0).getTime();
    const afterReset = nextRouteReset(beforeReset);
    assert.equal(new Date(afterReset).getHours(), 3);
    assert.equal(new Date(lastRouteReset(beforeReset)).getHours(), 2);
    assert.equal(lastRouteReset(afterReset), afterReset);
    assert.equal(new Date(nextRouteReset(afterReset)).getHours(), 2);
    const result = { path: [{ lat: 1, lng: 2 }], legs: [{ durationSec: 60, distanceMeters: 100, path: [{ lat: 1, lng: 2 }] }], fallback: false, cacheTtlMs: 21_600_000 };
    const saved = await saveCachedRoute('alice', 'main', result, beforeReset - 10_000, beforeReset);
    assert.equal(saved.freshUntil, beforeReset + 21_590_000);
    assert.deepEqual((await readCachedRoute('alice', 'main', beforeReset)).result.path, result.path);
    assert.equal(await readCachedRoute('bob', 'main', beforeReset), undefined);
    await pruneRouteCache(beforeReset - 1);
    assert.ok(await readCachedRoute('alice', 'main', beforeReset));
    assert.equal(await readCachedRoute('alice', 'main', afterReset), undefined);
    assert.equal(await saveCachedRoute('alice', 'main', { ...result, stale: true }, afterReset, afterReset), undefined);
    assert.equal(await saveCachedRoute('alice', 'main', { ...result, cacheTtlMs: undefined }, afterReset, afterReset), undefined);
    assert.equal(await saveCachedRoute('alice', 'main', result, beforeReset, afterReset), undefined);
    assert.equal(await saveCachedRoute('alice', 'main', { ...result, cacheTtlMs: 100 }, afterReset, afterReset + 101), undefined);
    for (let index = 0; index < 31; index++) await saveCachedRoute('alice', `route-${index}`, result, afterReset + index, afterReset + index);
    assert.equal(await readCachedRoute('alice', 'route-0', afterReset + 31), undefined);
    assert.ok(await readCachedRoute('alice', 'route-30', afterReset + 31));
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});