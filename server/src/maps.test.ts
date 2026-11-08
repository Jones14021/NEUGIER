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
  const { computeRoute, geocodeMissing } = await import('./maps');
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
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});