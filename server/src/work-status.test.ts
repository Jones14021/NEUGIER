import assert from 'node:assert/strict';
import test from 'node:test';
test('loading status tracks overlapping requests and clears on success or error', async () => {
  const modulePath = '../../web/src/api';
  const { api, workStatus } = await import(modulePath);
  const original = globalThis.fetch;
  const replies: ((value: Response) => void)[] = [];
  try {
    globalThis.fetch = async () => new Promise<Response>((resolve) => replies.push(resolve));
    const route = api('/maps/route', { body: {} });
    const search = api('/maps/search?q=camp');
    assert.match(workStatus(), /Routen/);
    assert.match(workStatus(), /Orte/);
    replies[0](Response.json({}));
    await route;
    assert.doesNotMatch(workStatus(), /Routen/);
    assert.match(workStatus(), /Orte/);
    replies[1](Response.json({ error: 'failed' }, { status: 500 }));
    await assert.rejects(search);
    assert.equal(workStatus(), '');
  } finally { globalThis.fetch = original; }
});

test('identical route requests share work while changed routes remain independent', async () => {
  const modulePath = '../../web/src/hooks';
  const { requestRoute, routeKey } = await import(modulePath);
  const original = globalThis.fetch;
  const replies: ((value: Response) => void)[] = [];
  try {
    globalThis.fetch = async () => new Promise<Response>((resolve) => replies.push(resolve));
    const points = [{ name: 'A', lat: 1, lng: 2 }, { name: 'B', lat: 3, lng: 4 }];
    const draft = [...points, { name: 'C', lat: 5, lng: 6 }];
    const mainKey = routeKey(points, 'region');
    const draftKey = routeKey(draft, 'region');
    assert.notEqual(mainKey, draftKey);
    assert.notEqual(mainKey, routeKey([...points].reverse(), 'region'));
    assert.notEqual(mainKey, routeKey([points[0], { ...points[1], routeBreakBefore: true }], 'region'));
    assert.notEqual(routeKey([{ name: 'A', lat: 1 }], 'region'), routeKey([{ name: 'B', lat: 1 }], 'region'));
    const main = requestRoute(mainKey, points, 'region');
    const identical = requestRoute(routeKey([...points], 'region'), points, 'region');
    const playground = requestRoute(draftKey, draft, 'region');
    assert.equal(main, identical);
    assert.equal(replies.length, 2);
    replies[0](Response.json({ path: [], legs: [{ durationSec: 10 }], fallback: false }));
    replies[1](Response.json({ path: [], legs: [{ durationSec: 20 }], fallback: false }));
    assert.equal((await main).legs[0].durationSec, 10);
    assert.equal((await playground).legs[0].durationSec, 20);
  } finally { globalThis.fetch = original; }
});