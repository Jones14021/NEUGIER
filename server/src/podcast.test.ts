import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import express from 'express';

test('podcasts preserve privacy, permissions, model choices and server-side regeneration', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neugier-podcast-test-'));
  const googleVariables = ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_TTS_CLIENT_EMAIL', 'GOOGLE_TTS_PRIVATE_KEY', 'GOOGLE_TTS_AGENT_LOCATION'] as const;
  const previousGoogleEnvironment = Object.fromEntries(googleVariables.map((name) => [name, process.env[name]]));
  for (const name of googleVariables) delete process.env[name];
  process.env.DATA_DIR = directory;
  process.env.DEV_LOGIN = 'true';
  process.env.PODCAST_ENABLED = 'true';
  process.env.LLM_PROVIDER = 'openai';
  process.env.LLM_BASE_URL = 'https://llm.example.invalid/v1';
  process.env.LLM_API_KEY = 'test-key';
  process.env.LLM_WEB_SEARCH = 'off';
  const { db, setSetting } = await import('./db');
  setSetting('podcast.prompt', 'Ein alter gespeicherter Prompt');
  setSetting('podcast.model', 'gemini-3.1-flash-tts-preview');
  const { api } = await import('./api');
  const { DEFAULT_PODCAST_PROMPT } = await import('./llm');
  const { ensurePodcastSchema, startPodcastWorker } = await import('./podcast');
  const { googlePodcastAuth, splitDialogue, synthesizePodcast } = await import('./podcast-tts');
  const { generateExample } = await import('./podcast-example');
  const app = express();
  app.use('/api', api());
  const server = app.listen(0);
  const originalFetch = globalThis.fetch;
  const contexts: string[] = [];
  const synthModels: string[] = [];
  let releaseFirst!: () => void;
  let notifyFirst!: () => void;
  const firstStarted = new Promise<void>((resolve) => { notifyFirst = resolve; });
  const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api`;
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith('https://llm.example.invalid/')) {
        contexts.push(JSON.parse(String(init?.body)).messages[1].content);
        return Response.json({ choices: [{ message: { content: JSON.stringify({ dialogue: 'Sam: [laughing] Hallo!\nAlex: [sigh] Guten Tag.', sources: [] }) } }] });
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
    const request = (url: string, method: string, cookie: string, body?: unknown, headers?: Record<string, string>) => fetch(`${base}${url}`, {
      method, headers: { cookie, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    await request(`/admin/users/${editor.user.id}`, 'PUT', admin.cookie, { role: 'editor' });
    await request(`/admin/users/${viewer.user.id}`, 'PUT', admin.cookie, { role: 'viewer' });
    const settings = await (await request('/admin/settings', 'GET', admin.cookie)).json() as { podcastPrompt: string; podcastModel: string };
    assert.equal(settings.podcastPrompt, DEFAULT_PODCAST_PROMPT);
    assert.equal(settings.podcastModel, 'gemini-3.8-flash-tts');
    assert.equal((await request('/admin/settings', 'PUT', admin.cookie, { podcastModel: 'new-model' })).status, 400);
    assert.equal((await request('/admin/settings', 'PUT', editor.cookie, { podcastModel: 'new-model', regeneratePodcasts: true })).status, 403);
    const trip = await (await request('/trips', 'POST', admin.cookie, { name: 'Test', region: 'Neuseeland' })).json() as { id: string };
    const day = { id: 'day-one', date: '2026-01-01', title: 'Erster Tag', times: 'Geheim', notes: 'Privat', shower: { status: 'unklar', note: '' } };
    const publicStop = { id: 'public-stop', dayId: day.id, order: 0, name: 'Öffentlicher Ort', scope: 'main', kind: 'campsite', notes: 'Geheime Notiz', time: '', duration: '', links: [], booking: '' };
    const privateStop = { ...publicStop, id: 'private-stop', name: 'Privater Ausflug', scope: 'day' };
    assert.equal((await request(`/trips/${trip.id}/ops`, 'POST', admin.cookie, { ops: [{ op: 'create', type: 'day', data: day }, { op: 'create', type: 'stop', data: publicStop }, { op: 'create', type: 'stop', data: privateStop }] })).status, 200);
    startPodcastWorker({ synthesize: async (dialogue, model) => {
      assert.match(dialogue, /Sam:/);
      synthModels.push(model);
      if (synthModels.length === 1) { notifyFirst(); await firstRelease; }
      return Buffer.from(`audio-${model}`);
    } });
    const prefix = `/trips/${trip.id}/podcasts/${day.id}`;
    const waitForModel = async (model: string) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const info = await (await request(prefix, 'GET', admin.cookie)).json() as { status: string; model: string };
        if (info.status === 'ready' && info.model === model) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.fail(`Podcast für ${model} wurde nicht fertig`);
    };
    await firstStarted;
    assert.equal((await request(`/trips/${trip.id}/ops`, 'POST', admin.cookie, { ops: [{ op: 'update', type: 'stop', id: publicStop.id, patch: { name: 'Neuer öffentlicher Ort' } }] })).status, 200);
    assert.equal((await request(`${prefix}/regenerate`, 'POST', admin.cookie)).status, 202);
    releaseFirst();
    await waitForModel(settings.podcastModel);
    assert.match(contexts[0], /Öffentlicher Ort/);
    assert.match(contexts[1], /Neuer öffentlicher Ort/);
    assert.doesNotMatch(contexts[0], /Privater Ausflug|Geheime Notiz|Privat|Geheim/);
    assert.equal((await request(`${prefix}/regenerate`, 'POST', viewer.cookie)).status, 403);
    assert.equal((await request(`${prefix}/regenerate`, 'POST', editor.cookie)).status, 403);
    const audio = await request(`${prefix}/audio`, 'GET', viewer.cookie, undefined, { range: 'bytes=0-4' });
    assert.equal(audio.status, 206);
    assert.equal(audio.headers.get('cache-control'), 'private, no-store');
    assert.equal(await audio.text(), 'audio');
    assert.equal((await request(`${prefix}/audio`, 'GET', viewer.cookie, undefined, { range: 'bytes=-0' })).status, 416);
    assert.equal((await request(`/trips/${trip.id}/podcasts/missing/audio`, 'GET', viewer.cookie)).status, 404);
    assert.equal((await request('/admin/settings', 'PUT', admin.cookie, { podcastModel: 'new-model', regeneratePodcasts: false })).status, 200);
    ensurePodcastSchema();
    assert.equal((await (await request('/admin/settings', 'GET', admin.cookie)).json() as { podcastModel: string }).podcastModel, 'new-model');
    assert.equal((await (await request(prefix, 'GET', viewer.cookie)).json() as { model: string }).model, settings.podcastModel);
    assert.equal(synthModels.length, 2);
    assert.equal((await request(`${prefix}/regenerate`, 'POST', admin.cookie)).status, 202);
    await waitForModel('new-model');
    assert.equal((await request('/admin/settings', 'PUT', admin.cookie, { podcastModel: 'another-model', regeneratePodcasts: true })).status, 200);
    await waitForModel('another-model');
    assert.deepEqual(synthModels, [settings.podcastModel, settings.podcastModel, 'new-model', 'another-model']);
    assert.deepEqual(splitDialogue('Sam: Hallo.\nAlex: Guten Tag.', true).map((part) => part.speaker), ['Sam', 'Alex']);
    const inlineAuth = googlePodcastAuth({ GOOGLE_CLOUD_PROJECT: 'test-project', GOOGLE_TTS_CLIENT_EMAIL: 'test@example.invalid', GOOGLE_TTS_PRIVATE_KEY: 'first\\nsecond\\n' });
    const inlineClient = await inlineAuth.getClient();
    assert.equal('email' in inlineClient && inlineClient.email, 'test@example.invalid');
    assert.equal('key' in inlineClient && inlineClient.key, 'first\nsecond');
    assert.throws(() => googlePodcastAuth({ GOOGLE_TTS_CLIENT_EMAIL: 'test@example.invalid' }), /müssen beide gesetzt sein/);
    assert.throws(() => googlePodcastAuth({ GOOGLE_TTS_CLIENT_EMAIL: 'test@example.invalid', GOOGLE_TTS_PRIVATE_KEY: 'key' }), /GOOGLE_CLOUD_PROJECT/);
    const envFile = path.join(directory, 'example.env');
    fs.writeFileSync(envFile, "GOOGLE_CLOUD_PROJECT=test-project\nGOOGLE_TTS_CLIENT_EMAIL=test@example.invalid\nGOOGLE_TTS_PRIVATE_KEY='first\\nsecond\\n'\n");
    process.loadEnvFile(envFile);
    const envClient = await googlePodcastAuth().getClient();
    assert.equal('key' in envClient && envClient.key, 'first\nsecond');
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_TTS_CLIENT_EMAIL;
    delete process.env.GOOGLE_TTS_PRIVATE_KEY;
    assert.ok(splitDialogue(`Sam: ${'Ä'.repeat(1800)}.\nAlex: Hallo.`, false).every((part) => Buffer.byteLength(part.text) <= 3800));
    assert.match(splitDialogue('Sam: Das sind 2.5 km, z.B. bis zum See.\nAlex: Genau!', false)[0].text, /2\.5 km, z\.B\./);
    const mp3 = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '0.1', '-f', 'mp3', 'pipe:1']);
    const requests: { input: { text: string }; voice: { name?: string; modelName: string; multiSpeakerVoiceConfig?: unknown } }[] = [];
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), 'https://texttospeech.googleapis.com/v1/text:synthesize');
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ audioContent: mp3.toString('base64') });
    };
    const multi = await synthesizePodcast('Sam: Hallo.\nAlex: Guten Tag.', 'gemini-3.1-flash-tts-preview', { project: 'test-project', token: 'test-token' });
    assert.ok(multi.length > 0);
    assert.ok(requests[0].voice.multiSpeakerVoiceConfig);
    requests.length = 0;
    const lite = await synthesizePodcast('Sam: Hallo.\nAlex: Guten Tag.', 'gemini-2.5-flash-lite-preview-tts', { project: 'test-project', token: 'test-token' });
    assert.ok(lite.length > 0);
    assert.deepEqual(requests.map((request) => request.voice.name), ['Kore', 'Charon']);
    assert.ok(requests.every((request) => !request.voice.multiSpeakerVoiceConfig));
    const wav = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '0.1', '-f', 'wav', 'pipe:1']);
    let agentBody: { contents: { parts: { text: string; speechMetadata: { speaker: string; style: string } }[] }[]; generationConfig: { speechConfig: { multiSpeakerVoiceConfig: { speakerVoiceConfigs: { speaker: string }[] } } } } | undefined;
    process.env.GOOGLE_TTS_AGENT_LOCATION = 'eu';
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), 'https://aiplatform.eu.rep.googleapis.com/v1/projects/test-project/locations/eu/publishers/google/models/gemini-3.8-flash-tts:generateContent');
      agentBody = JSON.parse(String(init?.body));
      return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }] } }] });
    };
    const agent = await synthesizePodcast('Sam: [laughing] Hallo!\nAlex: [whispering] [sigh] Guten Tag.', 'gemini-3.8-flash-tts', { project: 'test-project', token: 'test-token' });
    assert.ok(agent.length > 0);
    assert.equal(agentBody!.contents[0].parts[0].text, '<laugh> Hallo!');
    assert.equal(agentBody!.contents[0].parts[1].text, '<sigh> Guten Tag.');
    assert.equal(agentBody!.contents[0].parts[1].speechMetadata.style, 'whispering');
    assert.deepEqual(agentBody!.generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs.map((voice) => voice.speaker), ['Sam', 'Alex']);
    assert.match(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=format_name', '-of', 'default=noprint_wrappers=1', '-i', 'pipe:0'], { input: agent }).toString(), /mp3/);
    delete process.env.GOOGLE_TTS_AGENT_LOCATION;
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.GOOGLE_TTS_CLIENT_EMAIL = 'test@example.invalid';
    process.env.GOOGLE_TTS_PRIVATE_KEY = 'test-private-key';
    const exampleFile = path.join(directory, 'example.mp3');
    let exampleModel = '';
    assert.equal(await generateExample(['3.1', exampleFile], async (_dialogue, model) => { exampleModel = model; return mp3; }), exampleFile);
    assert.equal(exampleModel, 'gemini-3.1-flash-tts-preview');
    assert.deepEqual(fs.readFileSync(exampleFile), mp3);
    const agentExampleFile = path.join(directory, 'agent-example.mp3');
    await generateExample(['3.8', agentExampleFile], async (_dialogue, model) => { exampleModel = model; return agent; });
    assert.equal(exampleModel, 'gemini-3.8-flash-tts');
    assert.deepEqual(fs.readFileSync(agentExampleFile), agent);
    await assert.rejects(generateExample(['3.8', exampleFile]), /existiert bereits/);
    await assert.rejects(generateExample(['unknown']), /Aufruf/);
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_TTS_CLIENT_EMAIL;
    delete process.env.GOOGLE_TTS_PRIVATE_KEY;
    globalThis.fetch = originalFetch;
    const backup = await request('/admin/backup', 'GET', admin.cookie);
    assert.equal(backup.status, 200);
    const form = new FormData();
    form.append('file', new Blob([await backup.arrayBuffer()]), 'backup.db');
    const restored = await fetch(`${base}/admin/backup/restore`, { method: 'POST', headers: { cookie: admin.cookie }, body: form });
    assert.equal(restored.status, 200);
    assert.equal(await (await request(`${prefix}/audio`, 'GET', viewer.cookie)).text(), 'audio-another-model');
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of googleVariables) {
      const value = previousGoogleEnvironment[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});