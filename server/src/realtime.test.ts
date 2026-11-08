import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import WebSocket from 'ws';

test('todo updates do not send unknown entity types to older clients or viewers', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neugier-realtime-'));
  process.env.DATA_DIR = directory;
  process.env.DEV_LOGIN = 'true';
  const { api } = await import('./api');
  const { db } = await import('./db');
  const { attachRealtime } = await import('./realtime');
  const app = express();
  app.use('/api', api());
  const server = http.createServer(app);
  attachRealtime(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const sockets: WebSocket[] = [];
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
    const request = (url: string, method: string, body: unknown) => fetch(`${base}${url}`, { method, headers: { cookie: admin.cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await request(`/admin/users/${viewer.user.id}`, 'PUT', { role: 'viewer' });
    const trip = await (await request('/trips', 'POST', { name: 'Test' })).json() as { id: string };
    const connect = async (cookie: string) => {
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { headers: { cookie } });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      const subscribed = new Promise<void>((resolve) => socket.on('message', (raw) => { if (JSON.parse(String(raw)).type === 'geocoding') resolve(); }));
      socket.send(JSON.stringify({ type: 'subscribe', tripId: trip.id }));
      await subscribed;
      return socket;
    };
    const editorSocket = await connect(admin.cookie);
    const viewerSocket = await connect(viewer.cookie);
    const messages: unknown[] = [];
    editorSocket.on('message', (raw) => messages.push(JSON.parse(String(raw))));
    const editorTodo = new Promise<any>((resolve) => editorSocket.on('message', (raw) => { const data = JSON.parse(String(raw)); if (data.type === 'todos') resolve(data); }));
    const viewerSnapshot = new Promise<any>((resolve) => viewerSocket.on('message', (raw) => { const data = JSON.parse(String(raw)); if (data.type === 'state') resolve(data); }));
    const todo = { id: 'todo', dayId: null, targetId: null, targetType: null, title: 'Test', done: false, createdAt: new Date().toISOString() };
    const response = await request(`/trips/${trip.id}/ops`, 'POST', { ops: [{ op: 'update', type: 'trip', id: trip.id, patch: { name: 'Changed' } }, { op: 'create', type: 'todo', data: todo }] });
    assert.equal(response.status, 200);
    assert.equal((await editorTodo).todos[0].title, 'Test');
    assert.equal((await viewerSnapshot).state.todos.length, 0);
    const regular = messages.find((message: any) => message.type === 'changes') as { changes: { type: string }[] };
    assert.ok(regular);
    assert.deepEqual(regular.changes.map((change) => change.type), ['trip']);
  } finally {
    for (const socket of sockets) socket.terminate();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});