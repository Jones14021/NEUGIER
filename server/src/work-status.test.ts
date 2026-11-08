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