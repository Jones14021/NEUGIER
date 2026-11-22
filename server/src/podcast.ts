import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { GoogleAuth } from 'google-auth-library';
import { dayStops, type TripState } from '@neugier/shared';
import { db, getSetting, setSetting } from './db';
import { DEFAULT_PODCAST_PROMPT, llmSettings, podcastScript } from './llm';
import { events, getState, listTrips } from './store';

export const DEFAULT_PODCAST_MODEL = 'gemini-3.1-flash-tts-preview';
const STYLE = 'Zwei Hosts sprechen auf Deutsch natürlich, neugierig und lebendig miteinander. Sam klingt begeistert, Alex ruhig und kenntnisreich. Variiere Tempo und Betonung passend zum Inhalt, sprich Ortsnamen sorgfältig und nutze Lachen und Pausen sparsam.';
const enabled = process.env.PODCAST_ENABLED === 'true';
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
let running = false;
let started = false;
let databaseVersion = 0;
let scanTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

interface PodcastRow {
  trip_id: string;
  day_id: string;
  desired_hash: string;
  completed_hash: string;
  revision: number;
  attempts: number;
  next_attempt: number;
  status: string;
  model: string;
  available: number;
  sources: string;
  error: string;
  updated_at: string;
}

export function ensurePodcastSchema(): void {
  db.exec(`CREATE TABLE IF NOT EXISTS podcasts (
    trip_id TEXT NOT NULL, day_id TEXT NOT NULL, desired_hash TEXT NOT NULL,
    completed_hash TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1, attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued', model TEXT NOT NULL DEFAULT '',
    audio BLOB, sources TEXT NOT NULL DEFAULT '[]', error TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL, PRIMARY KEY (trip_id, day_id)
  )`);
  const columns = db.prepare('PRAGMA table_info(podcasts)').all() as { name: string }[];
  if (!columns.some((column) => column.name === 'attempts')) db.exec('ALTER TABLE podcasts ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
  if (!columns.some((column) => column.name === 'next_attempt')) db.exec('ALTER TABLE podcasts ADD COLUMN next_attempt INTEGER NOT NULL DEFAULT 0');
  if (getSetting('podcast.prompt.version') !== '2') {
    setSetting('podcast.prompt', DEFAULT_PODCAST_PROMPT);
    setSetting('podcast.prompt.version', '2');
  }
}

ensurePodcastSchema();

export function podcastModel(): string { return getSetting('podcast.model') || DEFAULT_PODCAST_MODEL; }
export function podcastEnabled(): boolean { return enabled; }

export function podcastContext(state: TripState, dayId: string): string {
  const day = state.days.find((item) => item.id === dayId);
  if (!day) throw Object.assign(new Error('Tag nicht gefunden'), { status: 404 });
  const stops = dayStops(state.stops, dayId).filter((stop) => stop.scope === 'main').map((stop) => ({ name: stop.name, kind: stop.kind }));
  return JSON.stringify({ reise: state.trip.name, region: state.trip.region, datum: day.date, tag: day.title, stopps: stops });
}

function fingerprint(state: TripState, dayId: string): string {
  return crypto.createHash('sha256').update(JSON.stringify([podcastContext(state, dayId), llmSettings().podcastPrompt])).digest('hex');
}

function rowFor(tripId: string, dayId: string): PodcastRow | undefined {
  return db.prepare('SELECT trip_id, day_id, desired_hash, completed_hash, revision, attempts, next_attempt, status, model, audio IS NOT NULL AS available, sources, error, updated_at FROM podcasts WHERE trip_id = ? AND day_id = ?').get(tripId, dayId) as unknown as PodcastRow | undefined;
}

export function podcastInfo(tripId: string, dayId: string) {
  const row = rowFor(tripId, dayId);
  return { enabled, status: row?.status ?? 'missing', available: !!row?.available, stale: !!row?.available && (row.completed_hash !== row.desired_hash || row.status !== 'ready'), model: row?.model ?? '', error: row?.error ?? '', updatedAt: row?.updated_at ?? '', sources: row ? JSON.parse(row.sources) as { title: string; url: string }[] : [] };
}

export function podcastAudio(tripId: string, dayId: string): Buffer | null {
  const row = db.prepare('SELECT audio FROM podcasts WHERE trip_id = ? AND day_id = ?').get(tripId, dayId) as { audio: Uint8Array | null } | undefined;
  const audio = row?.audio;
  return audio ? Buffer.from(audio) : null;
}

export function queuePodcast(state: TripState, dayId: string, force = false): void {
  const hash = fingerprint(state, dayId);
  const row = rowFor(state.trip.id, dayId);
  if (row && !force && row.desired_hash === hash) return;
  db.prepare(`INSERT INTO podcasts (trip_id, day_id, desired_hash, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(trip_id, day_id) DO UPDATE SET desired_hash = excluded.desired_hash,
    revision = podcasts.revision + 1, attempts = 0, next_attempt = 0, status = 'queued', error = '', updated_at = excluded.updated_at`)
    .run(state.trip.id, dayId, hash, new Date().toISOString());
  wake();
}

export function refreshExistingPodcasts(): void {
  const rows = db.prepare('SELECT trip_id, day_id FROM podcasts WHERE audio IS NOT NULL').all() as unknown as { trip_id: string; day_id: string }[];
  for (const row of rows) {
    const state = getState(row.trip_id);
    if (state?.days.some((day) => day.id === row.day_id)) queuePodcast(state, row.day_id, true);
  }
}

export function scanPodcasts(): void {
  if (!enabled) return;
  for (const trip of listTrips()) {
    const state = getState(trip.id);
    if (state) for (const day of state.days) queuePodcast(state, day.id);
  }
  db.prepare("DELETE FROM podcasts WHERE NOT EXISTS (SELECT 1 FROM entities WHERE type = 'day' AND entities.id = podcasts.day_id AND entities.trip_id = podcasts.trip_id)").run();
  wake();
}

export function startPodcastWorker(options: { synthesize?: (dialogue: string, model: string) => Promise<Buffer> } = {}): void {
  if (started) return;
  started = true;
  if (options.synthesize) synthesizer = options.synthesize;
  db.prepare("UPDATE podcasts SET status = 'queued' WHERE status = 'generating'").run();
  events.on('change', ({ changes }: { changes: { type: string }[] }) => {
    if (!changes.some((change) => ['trip', 'day', 'stop'].includes(change.type))) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanPodcasts, 1500);
    scanTimer.unref();
  });
  events.on('database-restored', () => { databaseVersion++; ensurePodcastSchema(); db.prepare("UPDATE podcasts SET status = 'queued' WHERE status = 'generating'").run(); scanPodcasts(); });
  scanPodcasts();
}

function wake(): void {
  if (!started || !enabled || running) return;
  clearTimeout(retryTimer);
  running = true;
  void work().catch((error) => console.error('Podcast-Worker:', error)).finally(() => {
    running = false;
    const next = db.prepare("SELECT MIN(next_attempt) AS due FROM podcasts WHERE status = 'queued'").get() as { due: number | null };
    if (next.due != null) { retryTimer = setTimeout(wake, Math.max(1000, next.due - Date.now())); retryTimer.unref(); }
  });
}

async function work(): Promise<void> {
  while (true) {
    const row = db.prepare("SELECT trip_id, day_id, desired_hash, completed_hash, revision, attempts, next_attempt, status, model, audio IS NOT NULL AS available, sources, error, updated_at FROM podcasts WHERE status = 'queued' AND next_attempt <= ? ORDER BY updated_at LIMIT 1").get(Date.now()) as unknown as PodcastRow | undefined;
    if (!row) return;
    const state = getState(row.trip_id);
    if (!state || !state.days.some((day) => day.id === row.day_id)) {
      db.prepare('DELETE FROM podcasts WHERE trip_id = ? AND day_id = ?').run(row.trip_id, row.day_id);
      continue;
    }
    const model = podcastModel();
    const generation = databaseVersion;
    db.prepare("UPDATE podcasts SET status = 'generating' WHERE trip_id = ? AND day_id = ? AND revision = ?").run(row.trip_id, row.day_id, row.revision);
    try {
      const script = await podcastScript(podcastContext(state, row.day_id));
      const audio = await synthesizer(script.dialogue, model);
      if (databaseVersion !== generation) continue;
      const current = getState(row.trip_id);
      if (!current || !current.days.some((day) => day.id === row.day_id)) continue;
      if (fingerprint(current, row.day_id) !== row.desired_hash) { queuePodcast(current, row.day_id); continue; }
      db.prepare("UPDATE podcasts SET audio = ?, sources = ?, model = ?, completed_hash = desired_hash, status = 'ready', attempts = 0, next_attempt = 0, error = '', updated_at = ? WHERE trip_id = ? AND day_id = ? AND revision = ?")
        .run(audio, JSON.stringify(script.sources), model, new Date().toISOString(), row.trip_id, row.day_id, row.revision);
    } catch (error) {
      if (databaseVersion !== generation) continue;
      const attempts = row.attempts + 1;
      const nextAttempt = Date.now() + Math.min(300_000, 30_000 * 4 ** (attempts - 1));
      db.prepare('UPDATE podcasts SET status = ?, attempts = ?, next_attempt = ?, error = ?, updated_at = ? WHERE trip_id = ? AND day_id = ? AND revision = ?')
        .run(attempts < 3 ? 'queued' : 'failed', attempts, nextAttempt, String((error as Error).message).slice(0, 500), new Date().toISOString(), row.trip_id, row.day_id, row.revision);
    }
  }
}

export function splitDialogue(dialogue: string, singleSpeaker: boolean): { text: string; speaker?: 'Sam' | 'Alex' }[] {
  const chunks: { text: string; speaker?: 'Sam' | 'Alex' }[] = [];
  for (const line of dialogue.split('\n')) {
    const match = /^(Sam|Alex):\s*(.+)$/.exec(line);
    if (!match) throw new Error('Ungültiger Sprecher im Podcast-Skript.');
    const speaker = match[1] as 'Sam' | 'Alex';
    const sentences = match[2].split(/(?<=[.!?])\s+/u);
    for (const sentence of sentences) {
      const content = sentence.trim();
      if (!content) continue;
      const text = singleSpeaker ? content : `${speaker}: ${content}`;
      if (Buffer.byteLength(text, 'utf8') > 3800) throw new Error('Ein Satz im Podcast-Skript ist zu lang.');
      const previous = chunks.at(-1);
      if (previous && (!singleSpeaker || previous.speaker === speaker) && Buffer.byteLength(`${previous.text}\n${text}`, 'utf8') <= 3800) previous.text += `\n${text}`;
      else chunks.push({ text, ...(singleSpeaker ? { speaker } : {}) });
    }
  }
  if (!chunks.length) throw new Error('Das Podcast-Skript ist leer.');
  return chunks;
}

export async function synthesizePodcast(dialogue: string, model: string, credentials?: { project: string; token: string }): Promise<Buffer> {
  const singleSpeaker = model === 'gemini-2.5-flash-lite-preview-tts';
  const chunks = splitDialogue(dialogue, singleSpeaker);
  const project = credentials?.project || process.env.GOOGLE_CLOUD_PROJECT || await auth.getProjectId();
  const token = credentials?.token || await auth.getAccessToken();
  if (!token || !project) throw new Error('Google Cloud ADC oder Projekt-ID für TTS fehlt.');
  const audio: Buffer[] = [];
  for (const chunk of chunks) {
    const voice = singleSpeaker
      ? { languageCode: 'de-DE', modelName: model, name: chunk.speaker === 'Sam' ? 'Kore' : 'Charon' }
      : { languageCode: 'de-DE', modelName: model, multiSpeakerVoiceConfig: { speakerVoiceConfigs: [{ speakerAlias: 'Sam', speakerId: 'Kore' }, { speakerAlias: 'Alex', speakerId: 'Charon' }] } };
    const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': project, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { prompt: STYLE, text: chunk.text }, voice, audioConfig: { audioEncoding: 'MP3' } }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) throw new Error(`Google TTS (${response.status}): ${(await response.text()).slice(0, 300)}`);
    const result = await response.json() as { audioContent?: string };
    if (!result.audioContent) throw new Error('Google TTS hat kein Audio zurückgegeben.');
    audio.push(Buffer.from(result.audioContent, 'base64'));
  }
  if (audio.length === 1) return audio[0];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neugier-podcast-'));
  try {
    audio.forEach((part, index) => fs.writeFileSync(path.join(directory, `${index}.mp3`), part, { mode: 0o600 }));
    fs.writeFileSync(path.join(directory, 'files.txt'), audio.map((_part, index) => `file '${index}.mp3'`).join('\n'), { mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      const process = spawn('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'concat', '-safe', '1', '-i', path.join(directory, 'files.txt'), '-c', 'copy', path.join(directory, 'result.mp3')]);
      let stderr = '';
      process.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      process.on('error', reject);
      process.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Audio-Zusammenführung fehlgeschlagen: ${stderr.slice(0, 300)}`)));
    });
    return fs.readFileSync(path.join(directory, 'result.mp3'));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

let synthesizer = synthesizePodcast;