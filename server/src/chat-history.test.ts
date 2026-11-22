import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

test('conversation history is private, persistent and continues with prior messages', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neugier-chat-'));
  process.env.DATA_DIR = directory;
  process.env.DEV_LOGIN = 'true';
  process.env.LLM_PROVIDER = 'openai';
  process.env.LLM_BASE_URL = 'https://llm.example.invalid/v1';
  process.env.LLM_API_KEY = 'test-key';
  process.env.LLM_WEB_SEARCH = 'off';
  const { api } = await import('./api');
  const { db } = await import('./db');
  const app = express();
  app.use('/api', api());
  const server = app.listen(0);
  const originalFetch = globalThis.fetch;
  const histories: { role: string; content: string }[][] = [];
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api`;
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith('https://llm.example.invalid/')) {
        histories.push(JSON.parse(String(init?.body)).messages);
        return Response.json({ choices: [{ message: { content: 'Antwort' } }] });
      }
      return originalFetch(input, init);
    };
    const login = async (email: string) => {
      const response = await fetch(`${base}/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
      return { cookie: response.headers.get('set-cookie')!.split(';')[0], user: await response.json() as { id: string } };
    };
    const admin = await login('admin@example.invalid');
    const editor = await login('editor@example.invalid');
    const viewer = await login('viewer@example.invalid');
    const request = (url: string, method: string, cookie: string, body?: unknown) => fetch(`${base}${url}`, {
      method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    await request(`/admin/users/${editor.user.id}`, 'PUT', admin.cookie, { role: 'editor' });
    await request(`/admin/users/${viewer.user.id}`, 'PUT', admin.cookie, { role: 'viewer' });
    const defaults = await (await request('/admin/settings', 'GET', admin.cookie)).json() as { podcastPrompt: string };
    assert.match(defaults.podcastPrompt, /Sam:.*Alex:/);
    assert.match(defaults.podcastPrompt, /\[laughing\].*\[sigh\]/);
    assert.equal((await request('/admin/settings', 'PUT', admin.cookie, { assistantPrompt: 'Antworte wie ein sachlicher Reiseführer.', podcastPrompt: 'Podcast über Kultur und Geschichte.' })).status, 200);
    const settings = await (await request('/admin/settings', 'GET', admin.cookie)).json() as { assistantPrompt: string; podcastPrompt: string };
    assert.equal(settings.assistantPrompt, 'Antworte wie ein sachlicher Reiseführer.');
    assert.equal(settings.podcastPrompt, 'Podcast über Kultur und Geschichte.');
    assert.equal((await request('/admin/settings', 'PUT', admin.cookie, { podcastPrompt: '' })).status, 200);
    const reset = await (await request('/admin/settings', 'GET', admin.cookie)).json() as { podcastPrompt: string };
    assert.equal(reset.podcastPrompt, defaults.podcastPrompt);
    assert.equal((await request('/admin/settings', 'GET', editor.cookie)).status, 403);
    const trip = await (await request('/trips', 'POST', admin.cookie, { name: 'Test' })).json() as { id: string };
    const day = { id: 'day-one', date: '2026-01-01', title: 'Erster Tag', times: '', notes: '', shower: { status: 'unklar', note: '' } };
    assert.equal((await request(`/trips/${trip.id}/ops`, 'POST', admin.cookie, { ops: [{ op: 'create', type: 'day', data: day }], label: 'Tag' })).status, 200);
    const prefix = `/trips/${trip.id}/conversations`;
    assert.equal((await request(prefix, 'POST', admin.cookie, { messages: [{ role: 'system', content: 'invalid' }] })).status, 400);
    assert.equal((await request(prefix, 'POST', admin.cookie, { messages: [{ role: 'assistant', content: 'invalid', sources: [{ title: 'unsafe', url: 'javascript:alert(1)' }] }] })).status, 400);
    const imported = await (await request(prefix, 'POST', editor.cookie, { messages: [{ role: 'user', content: 'Alter Chat' }, { role: 'assistant', content: 'Alte Antwort', sources: [{ title: 'Quelle', url: 'https://example.com' }] }] })).json() as { id: string; messages: unknown[] };
    assert.equal(imported.messages.length, 2);
    assert.equal((await request(`${prefix}/${imported.id}`, 'GET', admin.cookie)).status, 404);
    const createdResponse = await fetch(`${base}${prefix}`, { method: 'POST', headers: { cookie: admin.cookie } });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { id: string };
    const otherTrip = await (await request('/trips', 'POST', admin.cookie, { name: 'Andere Reise' })).json() as { id: string };
    assert.equal((await request(`/trips/${otherTrip.id}/conversations/${created.id}`, 'GET', admin.cookie)).status, 404);
    const sent = await request(`${prefix}/${created.id}/messages`, 'POST', admin.cookie, { content: 'Erste Frage', dayId: day.id });
    assert.equal(sent.status, 200);
    assert.equal(sent.headers.get('cache-control'), 'no-store');
    assert.match(histories[0][0].content, /sachlicher Reiseführer/);
    assert.match(histories[0][0].content, /JSON-Block/);
    await request(`${prefix}/${created.id}/messages`, 'POST', admin.cookie, { content: 'Zweite Frage' });
    assert.deepEqual(histories[1].slice(-3).map((message) => message.content), ['Erste Frage', 'Antwort', 'Zweite Frage']);
    assert.match(histories[1][1].content, /aktuell geöffneter Tag/);
    const saved = await (await request(`${prefix}/${created.id}`, 'GET', admin.cookie)).json() as { title: string; messages: unknown[] };
    assert.equal(saved.title, 'Erste Frage');
    assert.equal(saved.messages.length, 4);
    globalThis.fetch = async (input, init) => String(input).startsWith('https://llm.example.invalid/') ? new Response('unavailable', { status: 503 }) : originalFetch(input, init);
    assert.equal((await request(`${prefix}/${created.id}/messages`, 'POST', admin.cookie, { content: 'Erneuter Versuch' })).status, 500);
    globalThis.fetch = async (input, init) => String(input).startsWith('https://llm.example.invalid/') ? Response.json({ choices: [{ message: { content: 'Wieder erreichbar' } }] }) : originalFetch(input, init);
    const retried = await (await request(`${prefix}/${created.id}/messages`, 'POST', admin.cookie, { retry: true })).json() as { messages: { content: string }[] };
    assert.equal(retried.messages.length, 6);
    assert.equal(retried.messages.at(-2)?.content, 'Erneuter Versuch');
    assert.equal(retried.messages.at(-1)?.content, 'Wieder erreichbar');
    let release!: (response: Response) => void;
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    globalThis.fetch = async (input, init) => {
      if (!String(input).startsWith('https://llm.example.invalid/')) return originalFetch(input, init);
      notifyStarted();
      return new Promise<Response>((resolve) => { release = resolve; });
    };
    const pending = request(`${prefix}/${created.id}/messages`, 'POST', admin.cookie, { content: 'Gleichzeitig' });
    await started;
    assert.equal((await request(`${prefix}/${created.id}/messages`, 'POST', admin.cookie, { content: 'Doppelt' })).status, 409);
    release(Response.json({ choices: [{ message: { content: 'Fertig' } }] }));
    assert.equal((await pending).status, 200);
    globalThis.fetch = async (input, init) => String(input).startsWith('https://llm.example.invalid/')
      ? Response.json({ choices: [{ message: { content: 'Vorschlag\n```json\n{"changes":[{"action":"add","date":"2026-01-01","afterStopId":null,"stop":{"name":"Café","kind":"food","scope":"day","notes":""},"reason":"Pause"}]}\n```' } }] })
      : originalFetch(input, init);
    const proposed = await (await request(`${prefix}/${created.id}/messages`, 'POST', admin.cookie, { content: 'Schlag etwas vor' })).json() as { messages: { proposal?: unknown[] }[] };
    const index = proposed.messages.length - 1;
    assert.equal(proposed.messages[index].proposal?.length, 1);
    const applied = await (await request(`${prefix}/${created.id}/messages/${index}/applied`, 'POST', admin.cookie)).json() as { messages: { proposal?: unknown[] }[] };
    assert.deepEqual(applied.messages[index].proposal, []);
    assert.deepEqual((await (await request(`${prefix}/${created.id}`, 'GET', admin.cookie)).json() as { messages: { proposal?: unknown[] }[] }).messages[index].proposal, []);
    assert.equal(((await (await request(prefix, 'GET', editor.cookie)).json()) as unknown[]).length, 1);
    assert.equal((await request(`${prefix}/${created.id}`, 'GET', editor.cookie)).status, 404);
    assert.equal((await request(`${prefix}/${created.id}`, 'DELETE', editor.cookie)).status, 404);
    assert.equal((await request(prefix, 'GET', viewer.cookie)).status, 403);
    assert.equal((await request(`${prefix}/${created.id}`, 'DELETE', admin.cookie)).status, 200);
    assert.equal((await request(`${prefix}/${created.id}`, 'GET', admin.cookie)).status, 404);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});