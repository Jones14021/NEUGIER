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

test('podcast player switches sources, ignores interrupted requests, and retries real errors', async () => {
  const modulePath = '../../web/src/components/Podcast';
  const { createPodcastPlayback } = await import(modulePath);
  const errors: string[] = [];
  const pending: { resolve: () => void; reject: (error: Error) => void }[] = [];
  const audio = {
    src: '', error: null as { code: number } | null, playbackRate: 1, loads: 0,
    pause() {},
    load() { this.loads++; },
    getAttribute(name: string) { return name === 'src' ? this.src || null : null; },
    removeAttribute(name: string) { if (name === 'src') this.src = ''; },
    play() { return new Promise<void>((resolve, reject) => pending.push({ resolve, reject })); },
  };
  const player = createPodcastPlayback(audio, (message: string) => errors.push(message));
  player.play('/first', 1);
  player.play('/second', 1.5);
  assert.equal(audio.src, '/second');
  assert.equal(audio.playbackRate, 1.5);
  assert.equal(audio.loads, 2);
  pending[0].reject(new Error('interrupted by new source'));
  pending[1].resolve();
  await Promise.resolve();
  assert.deepEqual(errors, []);
  player.play('/second', 1.5);
  player.close();
  audio.error = { code: 4 };
  player.mediaError();
  pending[2].reject(new Error('interrupted by close'));
  await Promise.resolve();
  assert.deepEqual(errors, []);
  player.play('/second', 1);
  audio.error = { code: 4 };
  player.mediaError();
  assert.deepEqual(errors, ['Podcast konnte nicht geladen werden.']);
  player.play('/second', 1);
  assert.equal(audio.loads, 5);
  pending[3].reject(new Error('superseded failure'));
  pending[4].reject(new Error('genuine failure'));
  await Promise.resolve();
  assert.deepEqual(errors, ['Podcast konnte nicht geladen werden.', 'Podcast konnte nicht abgespielt werden.']);
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

test('expenses sort by latest edit or trip date without mutating the source', async () => {
  const modulePath = '../../web/src/pages/Expenses';
  const { sortExpenses, removeTravelerOps } = await import(modulePath);
  const expenses = [
    { id: 'early', dayId: 'first', updatedAt: '2026-01-01T10:00:00Z' },
    { id: 'late', dayId: 'second', updatedAt: '2026-01-03T10:00:00Z' },
    { id: 'undated', dayId: null, updatedAt: '2026-01-02T10:00:00Z' },
  ];
  const days = [{ id: 'first', date: '2026-01-01' }, { id: 'second', date: '2026-01-02' }];
  assert.deepEqual(sortExpenses(expenses, days, 'updated').map((expense: { id: string }) => expense.id), ['late', 'undated', 'early']);
  assert.deepEqual(sortExpenses(expenses, days, 'date').map((expense: { id: string }) => expense.id), ['early', 'late', 'undated']);
  assert.deepEqual(expenses.map((expense) => expense.id), ['early', 'late', 'undated']);
  const ops = removeTravelerOps({ id: 'trip', members: ['Alice', 'Bob'] }, [{ id: 'shared', splitBetween: [] }, { id: 'explicit', splitBetween: ['Alice'] }], 'Bob');
  assert.deepEqual(ops, [
    { op: 'update', type: 'trip', id: 'trip', patch: { members: ['Alice'] } },
    { op: 'update', type: 'expense', id: 'shared', patch: { splitBetween: ['Alice', 'Bob'] } },
  ]);
});

test('overview search finds day titles and stops on their corresponding days', async () => {
  const modulePath = '../../web/src/pages/Overview';
  const { searchOverview } = await import(modulePath);
  const days = [{ id: 'one', title: 'Auckland', date: '2026-01-01' }, { id: 'two', title: 'Rotorua', date: '2026-01-02' }];
  const stops = [{ dayId: 'two', name: 'Hot Springs', address: 'Lake Road' }, { dayId: null, name: 'Hot Pool' }];
  assert.deepEqual(searchOverview(days, stops, 'HOT').map((result: { day: { id: string } }) => result.day.id), ['two']);
  assert.deepEqual(searchOverview(days, stops, 'auck').map((result: { day: { id: string } }) => result.day.id), ['one']);
  assert.deepEqual(searchOverview(days, stops, '   '), []);
});