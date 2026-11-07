import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

test('viewers cannot write comments or trip data', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neugier-permissions-'));
  process.env.DATA_DIR = directory;
  process.env.DEV_LOGIN = 'true';
  const { api } = await import('./api');
  const { db } = await import('./db');
  const { events, getState } = await import('./store');
  const app = express();
  app.use('/api', api());
  const server = app.listen(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api`;
    const login = async (email: string) => {
      const response = await fetch(`${base}/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
      return { cookie: response.headers.get('set-cookie')!.split(';')[0], user: await response.json() as { id: string } };
    };
    const admin = await login('admin@example.invalid');
    const viewer = await login('viewer@example.invalid');
    const request = (url: string, method: string, cookie: string, body: unknown) => fetch(`${base}${url}`, {
      method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    await request(`/admin/users/${viewer.user.id}`, 'PUT', admin.cookie, { role: 'viewer' });
    const trip = await (await request('/trips', 'POST', admin.cookie, { name: 'Test' })).json() as { id: string };
    const prefix = `/trips/${trip.id}`;
    assert.equal((await request(`${prefix}/comments`, 'POST', viewer.cookie, { targetId: trip.id, text: 'forbidden' })).status, 403);
    assert.equal((await request(`${prefix}/ops`, 'POST', viewer.cookie, { ops: [], label: 'forbidden' })).status, 403);
    assert.equal((await request(`${prefix}/comments`, 'POST', admin.cookie, { targetId: trip.id, text: 'allowed' })).status, 200);
    const timestamp = Date.now();
    const point = { lat: -36.8, lng: 174.7, timestamp };
    assert.equal((await request(`${prefix}/location`, 'POST', viewer.cookie, point)).status, 403);
    assert.equal((await request(`${prefix}/location`, 'POST', admin.cookie, { ...point, lat: 91 })).status, 400);
    assert.equal((await request(`${prefix}/location`, 'POST', admin.cookie, { ...point, timestamp: timestamp - 180_000 })).status, 400);
    assert.equal((await request(`${prefix}/location`, 'POST', admin.cookie, { ...point, timestamp: timestamp + 120_000 })).status, 400);
    let broadcast: unknown;
    events.once('location', (event) => { broadcast = event; });
    assert.equal((await request(`${prefix}/location`, 'POST', admin.cookie, point)).status, 200);
    const expected = { lat: point.lat, lng: point.lng, capturedAt: new Date(timestamp).toISOString() };
    assert.deepEqual(broadcast, { tripId: trip.id, location: expected });
    assert.deepEqual(getState(trip.id)?.liveLocation, expected);
    const viewerState = await (await fetch(`${base}${prefix}`, { headers: { cookie: viewer.cookie } })).json() as { liveLocation: unknown };
    assert.deepEqual(viewerState.liveLocation, expected);
    const older = await (await request(`${prefix}/location`, 'POST', admin.cookie, { ...point, lat: -37, timestamp: timestamp - 1000 })).json() as { updated: boolean };
    assert.equal(older.updated, false);
    assert.deepEqual(getState(trip.id)?.liveLocation, expected);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});