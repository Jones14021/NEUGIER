import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Stop, Trip } from '@neugier/shared';

test('geocoding retries API failures instead of marking stops as not found', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neugier-maps-'));
  process.env.DATA_DIR = directory;
  process.env.GOOGLE_MAPS_SERVER_KEY = 'test-key';
  const { db } = await import('./db');
  const { applyOps, events, getState } = await import('./store');
  const { computeRoute, geocodeMissing, refreshRouteCache } = await import('./maps');
  const originalFetch = globalThis.fetch;
  try {
    const trip: Trip = { id: 'trip', name: 'Test', region: 'Neuseeland', startDate: '', endDate: '', currency: 'EUR', members: [], notes: '' };
    const stop: Stop = { id: 'stop', dayId: null, order: 0, scope: 'main', kind: 'campsite', name: 'Test', notes: '', time: '', duration: '', links: [], booking: '' };
    applyOps(trip.id, [{ op: 'create', type: 'trip', data: trip }, { op: 'create', type: 'stop', data: stop }], { userName: 'Test', userId: '', source: 'user', label: 'Test' });
    globalThis.fetch = async () => new Response('', { status: 403 });
    const active: boolean[] = [];
    const listener = (event: { active: boolean }) => active.push(event.active);
    events.on('geocoding', listener);
    await geocodeMissing(trip.id);
    events.off('geocoding', listener);
    assert.deepEqual(active, [true, false]);
    assert.equal(getState(trip.id)!.stops[0].geoFailed, undefined);
    globalThis.fetch = async () => Response.json({ places: [{ id: 'place', displayName: { text: 'Test' }, formattedAddress: 'Test address', location: { latitude: -36, longitude: 174 } }] });
    await geocodeMissing(trip.id);
    assert.equal(getState(trip.id)!.stops[0].lat, -36);
    assert.equal(getState(trip.id)!.stops[0].lng, 174);

    const another: Stop = { ...stop, id: 'another', name: 'Before' };
    applyOps(trip.id, [{ op: 'create', type: 'stop', data: another }], { userName: 'Test', userId: '', source: 'user', label: 'Test' });
    let finish!: (response: Response) => void;
    globalThis.fetch = async () => new Promise<Response>((resolve) => { finish = resolve; });
    const pending = geocodeMissing(trip.id);
    applyOps(trip.id, [{ op: 'update', type: 'stop', id: another.id, patch: { name: 'After', lat: -41, lng: 175 } }], { userName: 'Test', userId: '', source: 'user', label: 'Test' });
    finish(Response.json({ places: [{ id: 'old', displayName: { text: 'Before' }, formattedAddress: 'Old address', location: { latitude: -36, longitude: 174 } }] }));
    await pending;
    const edited = getState(trip.id)!.stops.find((item) => item.id === another.id)!;
    assert.equal(edited.name, 'After');
    assert.equal(edited.lat, -41);
    assert.equal(edited.lng, 175);

    const flight: Stop = { ...stop, id: 'flight', kind: 'transport', name: 'Rückflug ab Singapur' };
    applyOps(trip.id, [{ op: 'create', type: 'stop', data: flight }], { userName: 'Test', userId: '', source: 'user', label: 'Test' });
    globalThis.fetch = async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).textQuery, 'Rückflug ab Singapur');
      return Response.json({ places: [{ id: 'airport', displayName: { text: 'Singapore Changi Airport' }, formattedAddress: 'Singapore', location: { latitude: 1.35, longitude: 103.99 } }] });
    };
    await geocodeMissing(trip.id);
    assert.equal(getState(trip.id)!.stops.find((item) => item.id === flight.id)!.lat, 1.35);

    let routeRequests = 0;
    globalThis.fetch = async () => {
      routeRequests++;
      return Response.json({ routes: [{ distanceMeters: 1200, duration: '300s', polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' } }] });
    };
    const points = [getState(trip.id)!.stops.find((item) => item.id === stop.id)!, edited];
    const route = await computeRoute(points, trip.region);
    assert.equal(route.fallback, false);
    assert.equal(route.legs[0].distanceMeters, 1200);
    assert.equal(route.legs[0].durationSec, 300);
    assert.deepEqual(route.path[0], { lat: 38.5, lng: -120.2 });
    await computeRoute(points, trip.region);
    assert.equal(routeRequests, 1);
    const flightRoute = await computeRoute([points[0], { ...points[1], routeBreakBefore: true }], trip.region);
    assert.equal(flightRoute.legs[0].path?.length, 0);
    assert.equal(routeRequests, 1);

    let finishRoute!: (response: Response) => void;
    globalThis.fetch = async (_url, init) => {
      routeRequests++;
      assert.ok(init?.signal);
      return new Promise<Response>((resolve) => { finishRoute = resolve; });
    };
    const newPoints = [points[0], { ...points[1], lat: -42 }];
    const first = computeRoute(newPoints, trip.region);
    const second = computeRoute(newPoints, trip.region);
    assert.equal(routeRequests, 2);
    finishRoute(Response.json({ routes: [{ distanceMeters: 1200, duration: '300s', polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' } }] }));
    assert.deepEqual(await first, await second);

    db.prepare('UPDATE route_cache_meta SET updated_at = ?').run(Date.now() - 7 * 60 * 60 * 1000);
    const routeReplies: ((response: Response) => void)[] = [];
    globalThis.fetch = async () => {
      routeRequests++;
      return new Promise<Response>((resolve) => { routeReplies.push(resolve); });
    };
    const refresh = refreshRouteCache();
    assert.equal(refreshRouteCache(), refresh);
    for (const reply of routeReplies) reply(Response.json({ routes: [{ distanceMeters: 1500, duration: '400s', polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' } }] }));
    await refresh;
    assert.equal(routeRequests, 4);
    const refreshed = await computeRoute(points, trip.region);
    assert.equal(refreshed.legs[0].durationSec, 400);
    assert.ok(refreshed.cacheTtlMs! > 5 * 60 * 60 * 1000);
    assert.equal(refreshed.stale, false);

    db.prepare('UPDATE route_cache_meta SET updated_at = ?').run(Date.now() - 7 * 60 * 60 * 1000);
    let failedRequests = 0;
    globalThis.fetch = async () => { failedRequests++; return new Response('', { status: 503 }); };
    const stale = await computeRoute(points, trip.region);
    assert.equal(stale.legs[0].durationSec, 400);
    assert.equal(stale.stale, true);
    assert.equal(stale.cacheTtlMs, 0);
    await computeRoute(points, trip.region);
    assert.equal(failedRequests, 1);
    db.exec('DELETE FROM route_cache_meta');
    const legacy = await computeRoute(points, trip.region);
    assert.equal(legacy.stale, true);
    assert.equal((db.prepare('SELECT count(*) AS count FROM route_cache_meta').get() as { count: number }).count, 1);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});