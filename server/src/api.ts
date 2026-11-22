import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backup } from 'node:sqlite';
import compression from 'compression';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import type { AnyEntity, ChatMessage, Op, Role, Trip, TripExport, TripState, TypedEntity } from '@neugier/shared';
import { canSeePlanning, newId } from '@neugier/shared';
import { attachUser, deleteUser, listUsers, loginDev, loginGoogle, logout, requireRole, setRole } from './auth';
import { restoreDatabase, temporaryBackupPath } from './backup';
import { createConversation, deleteConversation, getConversation, listConversations, saveConversation, validateImportedMessages } from './chat-history';
import { config, uploadsDir } from './config';
import { db, setSetting } from './db';
import { toJson, toSplidCsv, toSplidText } from './exporters';
import { parseExcel } from './importers/excel';
import { chat, DEFAULT_PODCAST_PROMPT, llmSettings } from './llm';
import { computeRoute, geocodeMissing, searchPlaces } from './maps';
import { resolveMapShare } from './maps-share';
import { buildMergeOps, fromExport, planMerge, type Resolution } from './merge';
import { podcastAudio, podcastEnabled, podcastInfo, podcastModel, queuePodcast, refreshExistingPodcasts, scanPodcasts } from './podcast';
import { applyOps, events, getState, listChanges, listTrips, restoreVersion, rollbackBatch, updateLiveLocation } from './store';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const backupUploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neugier-restore-'));
process.on('exit', () => fs.rmSync(backupUploadsDir, { recursive: true, force: true }));
const backupUpload = multer({ storage: multer.diskStorage({ destination: backupUploadsDir, filename: (_req, _file, cb) => cb(null, `${newId()}.db`) }), limits: { fileSize: 1024 * 1024 * 1024 } });
const photoUpload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => cb(null, `${newId()}${path.extname(file.originalname).toLowerCase() || '.jpg'}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});
const pendingChats = new Set<string>();

/** Async-Handler-Wrapper: Fehler als JSON zurückgeben. */
const h =
  (fn: (req: Request, res: Response, next: NextFunction) => unknown) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res, next);
    } catch (e) {
      next(e);
    }
  };

function actor(req: Request) {
  return { userName: req.user!.name, userId: req.user!.id };
}

function state(req: Request) {
  const s = getState(String(req.params.tripId));
  if (!s) throw Object.assign(new Error('Reise nicht gefunden'), { status: 404 });
  return s;
}

/** Zuschauer: nur Reiseübersicht (Hauptroute, ohne Notizen/Ausgaben/Tagesplanung) + Erinnerungen. */
export function viewerState(s: TripState): TripState {
  const days = s.days.map((d) => ({ ...d, notes: '', times: '', extraTravel: undefined, shower: { ...d.shower, note: '' } }));
  const stops = s.stops
    .filter((x) => x.dayId && x.scope === 'main')
    .map((x) => ({ ...x, notes: '', links: [], booking: '' as const, time: '', duration: '' }));
  const visible = new Set([...days.map((d) => d.id)]);
  return {
    trip: { ...s.trip, notes: '', members: [] },
    liveLocation: s.liveLocation,
    days,
    stops,
    expenses: [],
    memories: s.memories,
    comments: s.comments.filter((c) => visible.has(c.targetId) || s.memories.some((m) => m.id === c.targetId)),
    todos: [],
  };
}

function stateFor(req: Request) {
  const s = state(req);
  return canSeePlanning(req.user!.role) ? s : viewerState(s);
}

/** Ausstehende Imports (Datei geparst, wartet auf Konfliktlösung). */
const pendingImports = new Map<string, { tripId: string; source: string; entities: TypedEntity[] }>();
let restoringBackup = false;

export function api(): express.Router {
  const r = express.Router();
  r.use(express.json({ limit: '20mb' }));
  r.use(attachUser);

  r.get('/config', (_req, res) => {
    res.json({
      googleClientId: config.googleClientId,
      devLogin: config.devLogin,
      mapsApiKey: config.mapsApiKey,
      mapId: config.mapId,
      llmConfigured: !!llmSettings().apiKey,
      webSearch: llmSettings().webSearch,
    });
  });

  // --- Auth ---
  r.get('/me', (req, res) => res.json(req.user ?? null));
  r.post('/auth/google', h(loginGoogle));
  r.post('/auth/dev', loginDev);
  r.post('/auth/logout', logout);

  // --- Admin ---
  r.get('/admin/backup', requireRole('admin'), h(async (_req, res, next) => {
    const temp = temporaryBackupPath();
    try {
      await backup(db, temp.file);
      res.setHeader('Cache-Control', 'no-store');
      res.download(temp.file, `neugier-backup-${new Date().toISOString().slice(0, 10)}.db`, (error) => {
        fs.rmSync(temp.directory, { recursive: true, force: true });
        if (error && !res.headersSent) next(error);
      });
    } catch (error) {
      fs.rmSync(temp.directory, { recursive: true, force: true });
      throw error;
    }
  }));
  r.post('/admin/backup/restore', requireRole('admin'), backupUpload.single('file'), h(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Keine Sicherungsdatei' });
    if (restoringBackup) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(409).json({ error: 'Wiederherstellung läuft bereits' });
    }
    restoringBackup = true;
    try {
      await restoreDatabase(req.file.path, path.join(config.dataDir, 'neugier.db'), db);
      pendingImports.clear();
      events.emit('database-restored');
      res.json({ ok: true });
    } finally {
      fs.rmSync(req.file.path, { force: true });
      restoringBackup = false;
    }
  }));
  r.get('/admin/users', requireRole('admin'), (_req, res) => res.json(listUsers()));
  r.put('/admin/users/:id', requireRole('admin'), (req, res) => {
    const role = req.body.role as Role;
    if (!['pending', 'viewer', 'editor', 'admin'].includes(role)) return res.status(400).json({ error: 'Ungültige Rolle' });
    setRole(String(req.params.id), role);
    res.json({ ok: true });
  });
  r.delete('/admin/users/:id', requireRole('admin'), (req, res) => {
    if (req.params.id === req.user!.id) return res.status(400).json({ error: 'Du kannst dich nicht selbst löschen' });
    deleteUser(String(req.params.id));
    res.json({ ok: true });
  });
  r.get('/admin/settings', requireRole('admin'), (_req, res) => {
    const s = llmSettings();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      llmProvider: s.provider,
      llmBaseUrl: s.baseUrl,
      llmModel: s.model,
      llmApiKeySet: !!s.apiKey,
      webSearch: s.webSearchMode,
      searchApiKeySet: !!s.searchApiKey,
      assistantPrompt: s.assistantPrompt,
      podcastPrompt: s.podcastPrompt,
      podcastModel: podcastModel(),
      podcastEnabled: podcastEnabled(),
    });
  });
  r.put('/admin/settings', requireRole('admin'), (req, res) => {
    const { llmProvider, llmBaseUrl, llmModel, llmApiKey, webSearch, searchApiKey, assistantPrompt, podcastPrompt, podcastModel: nextPodcastModel, regeneratePodcasts } = req.body as Record<string, string | boolean | undefined>;
    if ([assistantPrompt, podcastPrompt].some((prompt) => prompt !== undefined && (typeof prompt !== 'string' || prompt.length > 20_000))) return res.status(400).json({ error: 'Prompt darf höchstens 20000 Zeichen enthalten' });
    if (nextPodcastModel !== undefined && (typeof nextPodcastModel !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(nextPodcastModel))) return res.status(400).json({ error: 'Ungültiger Podcast-Modellname' });
    const modelChanged = typeof nextPodcastModel === 'string' && nextPodcastModel !== podcastModel();
    if (modelChanged && typeof regeneratePodcasts !== 'boolean') return res.status(400).json({ error: 'Bitte entscheiden, ob bestehende Podcasts neu erzeugt werden sollen.' });
    const promptChanged = typeof podcastPrompt === 'string' && (podcastPrompt.trim() || DEFAULT_PODCAST_PROMPT) !== llmSettings().podcastPrompt;
    if (llmProvider === 'copilot' || llmProvider === 'openai') setSetting('llm.provider', llmProvider);
    if (typeof llmBaseUrl === 'string') setSetting('llm.baseUrl', llmBaseUrl);
    if (typeof llmModel === 'string') setSetting('llm.model', llmModel);
    if (typeof llmApiKey === 'string' && llmApiKey) setSetting('llm.apiKey', llmApiKey);
    if (typeof webSearch === 'string') setSetting('llm.webSearch', webSearch);
    if (typeof searchApiKey === 'string' && searchApiKey) setSetting('search.apiKey', searchApiKey);
    if (typeof assistantPrompt === 'string') setSetting('llm.systemPrompt', assistantPrompt.trim());
    if (typeof podcastPrompt === 'string') setSetting('podcast.prompt', podcastPrompt.trim());
    if (typeof nextPodcastModel === 'string') setSetting('podcast.model', nextPodcastModel);
    if (modelChanged && regeneratePodcasts) refreshExistingPodcasts();
    if (promptChanged) scanPodcasts();
    res.json({ ok: true });
  });

  // --- Reisen ---
  r.get('/trips', requireRole('viewer'), (_req, res) => res.json(listTrips()));
  r.post(
    '/trips',
    requireRole('editor'),
    h((req, res) => {
      const trip: Trip = {
        id: newId(),
        name: req.body.name || 'Neue Reise',
        region: req.body.region || '',
        startDate: req.body.startDate || '',
        endDate: req.body.endDate || '',
        currency: req.body.currency || 'EUR',
        members: req.body.members || [],
        notes: '',
      };
      applyOps(trip.id, [{ op: 'create', type: 'trip', data: trip }], {
        ...actor(req),
        source: 'user',
        label: 'Reise angelegt',
      });
      res.json(trip);
    }),
  );
  r.get('/trips/:tripId', requireRole('viewer'), h((req, res) => res.json(stateFor(req))));

  r.get('/trips/:tripId/podcasts', requireRole('viewer'), h((req, res) => {
    const trip = state(req);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(Object.fromEntries(trip.days.map((day) => {
      const info = podcastInfo(trip.trip.id, day.id);
      return [day.id, req.user!.role === 'admin' ? info : { ...info, error: info.error ? 'Podcast-Erzeugung fehlgeschlagen' : '' }];
    })));
  }));
  r.get('/trips/:tripId/podcasts/:dayId', requireRole('viewer'), h((req, res) => {
    const trip = state(req);
    const dayId = String(req.params.dayId);
    if (!trip.days.some((day) => day.id === dayId)) return res.status(404).json({ error: 'Tag nicht gefunden' });
    const info = podcastInfo(trip.trip.id, dayId);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(req.user!.role === 'admin' ? info : { ...info, error: info.error ? 'Podcast-Erzeugung fehlgeschlagen' : '' });
  }));
  r.post('/trips/:tripId/podcasts/:dayId/regenerate', requireRole('admin'), h((req, res) => {
    if (!podcastEnabled()) return res.status(503).json({ error: 'Podcast-Erzeugung ist nicht aktiviert.' });
    const trip = state(req);
    queuePodcast(trip, String(req.params.dayId), true);
    res.status(202).json({ ok: true });
  }));
  r.get('/trips/:tripId/podcasts/:dayId/audio', requireRole('viewer'), h((req, res) => {
    const trip = state(req);
    const dayId = String(req.params.dayId);
    if (!trip.days.some((day) => day.id === dayId)) return res.status(404).json({ error: 'Tag nicht gefunden' });
    const audio = podcastAudio(trip.trip.id, dayId);
    if (!audio) return res.status(404).json({ error: 'Podcast noch nicht verfügbar' });
    res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes' });
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const suffix = match && !match[1] ? Number(match[2]) : 0;
      const start = match ? (suffix ? Math.max(0, audio.length - suffix) : Number(match[1])) : -1;
      const end = match && match[1] && match[2] ? Math.min(Number(match[2]), audio.length - 1) : audio.length - 1;
      if (!match || (!match[1] && (!match[2] || suffix === 0)) || start < 0 || start >= audio.length || end < start || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
        res.setHeader('Content-Range', `bytes */${audio.length}`);
        return res.sendStatus(416);
      }
      res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${audio.length}`, 'Content-Length': String(end - start + 1) });
      return res.end(audio.subarray(start, end + 1));
    }
    res.setHeader('Content-Length', String(audio.length));
    res.end(audio);
  }));

  r.post('/trips/:tripId/location', requireRole('editor'), h((req, res) => {
    const s = state(req);
    const { lat, lng, timestamp } = (req.body ?? {}) as { lat: unknown; lng: unknown; timestamp: unknown };
    const now = Date.now();
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
        typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180 ||
        typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < now - 120_000 || timestamp > now + 60_000) {
      return res.status(400).json({ error: 'Ungültiger oder veralteter Standort' });
    }
    const location = { lat, lng, capturedAt: new Date(timestamp).toISOString() };
    res.json({ updated: updateLiveLocation(s.trip.id, location) });
  }));

  r.post(
    '/trips/:tripId/ops',
    requireRole('editor'),
    h((req, res) => {
      const s = state(req);
      const ops = req.body.ops as Op[];
      const changes = applyOps(s.trip.id, ops, {
        ...actor(req),
        source: req.body.source === 'ai' ? 'ai' : 'user',
        label: String(req.body.label || 'Änderung'),
      });
      if (changes.some((c) => c.type === 'stop' && c.after && (c.after as { lat?: number }).lat == null)) {
        void geocodeMissing(s.trip.id);
      }
      res.json({ changes });
    }),
  );

  r.post(
    '/trips/:tripId/comments',
    requireRole('editor'),
    h((req, res) => {
      const s = state(req);
      const { id, targetId, text } = req.body as { id?: string; targetId: string; text: string };
      const now = new Date().toISOString();
      const existing = id ? s.comments.find((c) => c.id === id) : undefined;
      const data = existing
        ? { ...existing, text }
        : { id: newId(), targetId, text, author: req.user!.name, authorId: req.user!.id, createdAt: now };
      const op: Op = text.trim() ? { op: 'put', type: 'comment', data } : { op: 'delete', type: 'comment', id: data.id };
      applyOps(s.trip.id, [op], { ...actor(req), source: 'user', label: 'Kommentar' });
      res.json(data);
    }),
  );

  // --- Versionshistorie ---
  r.get(
    '/trips/:tripId/history',
    requireRole('editor'),
    h((req, res) => {
      res.json(listChanges(String(req.params.tripId), { entityId: req.query.entityId as string | undefined }));
    }),
  );
  r.post(
    '/trips/:tripId/history/rollback',
    requireRole('editor'),
    h((req, res) => {
      const tripId = state(req).trip.id;
      const changes = req.body.changeId
        ? restoreVersion(tripId, Number(req.body.changeId), actor(req))
        : rollbackBatch(tripId, String(req.body.batchId), actor(req));
      res.json({ changes });
    }),
  );

  // --- Export ---
  r.get(
    '/trips/:tripId/export.json',
    requireRole('editor'),
    h((req, res) => {
      const s = state(req);
      res.attachment(`${s.trip.name}.neugier.json`).json(toJson(s));
    }),
  );
  r.get(
    '/trips/:tripId/export/splid.csv',
    requireRole('editor'),
    h((req, res) => {
      const s = state(req);
      res.attachment(`${s.trip.name}-ausgaben-splid.csv`).type('text/csv').send(toSplidCsv(s));
    }),
  );
  r.get(
    '/trips/:tripId/export/splid.txt',
    requireRole('editor'),
    h((req, res) => res.type('text/plain').send(toSplidText(state(req)))),
  );

  // --- Import (2 Schritte: Analyse -> Konflikte lösen -> Übernehmen) ---
  r.post(
    '/trips/:tripId/import/analyze',
    requireRole('editor'),
    upload.single('file'),
    h(async (req, res) => {
      const s = state(req);
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'Keine Datei' });
      let entities: TypedEntity[];
      let source: string;
      if (/\.json$/i.test(file.originalname)) {
        const data = JSON.parse(file.buffer.toString('utf8')) as TripExport;
        if (data.format !== 'neugier-trip') throw new Error('Unbekanntes JSON-Format');
        entities = fromExport([
          ...data.days.map((d) => ({ type: 'day' as const, data: d as AnyEntity })),
          ...data.stops.map((d) => ({ type: 'stop' as const, data: d as AnyEntity })),
          ...data.expenses.map((d) => ({ type: 'expense' as const, data: d as AnyEntity })),
          ...data.memories.map((d) => ({ type: 'memory' as const, data: d as AnyEntity })),
          ...data.comments.map((d) => ({ type: 'comment' as const, data: d as AnyEntity })),
          ...(data.todos ?? []).map((d) => ({ type: 'todo' as const, data: d as AnyEntity })),
        ]);
        source = 'json';
      } else {
        entities = await parseExcel(file.buffer, { startDate: s.trip.startDate, currency: s.trip.currency });
        source = 'excel';
      }
      const plan = planMerge(s, entities, source);
      const importId = newId();
      pendingImports.set(importId, { tripId: s.trip.id, source, entities });
      res.json({ importId, source, ...plan });
    }),
  );
  r.post(
    '/trips/:tripId/import/apply',
    requireRole('editor'),
    h((req, res) => {
      const s = state(req);
      const pending = pendingImports.get(String(req.body.importId));
      if (!pending || pending.tripId !== s.trip.id) return res.status(404).json({ error: 'Import abgelaufen' });
      const plan = planMerge(s, pending.entities, pending.source);
      const ops = buildMergeOps(s, pending.entities, plan, req.body.resolution as Resolution, pending.source);
      const changes = applyOps(s.trip.id, ops, {
        ...actor(req),
        source: 'import',
        label: `Import (${pending.source === 'excel' ? 'Excel' : 'JSON'})`,
      });
      pendingImports.delete(String(req.body.importId));
      void geocodeMissing(s.trip.id);
      res.json({ changes: changes.length });
    }),
  );

  // --- Karten ---
  r.get('/maps/resolve-share', requireRole('editor'), h(async (req, res) => {
    res.json(await resolveMapShare(String(req.query.url ?? '')));
  }));
  r.post(
    '/maps/route',
    requireRole('viewer'),
    compression(),
    h(async (req, res) => res.json(await computeRoute(req.body.points ?? [], req.body.region ?? ''))),
  );
  r.get(
    '/maps/search',
    requireRole('viewer'),
    h(async (req, res) => {
      const lat = req.query.lat === undefined ? NaN : Number(req.query.lat);
      const lng = req.query.lng === undefined ? NaN : Number(req.query.lng);
      res.json(await searchPlaces(String(req.query.q ?? ''), Number.isFinite(lat) ? { lat, lng } : undefined));
    }),
  );

  // --- Fotos ---
  r.post('/uploads', requireRole('editor'), photoUpload.array('photos', 20), (req, res) => {
    const files = (req.files as Express.Multer.File[]) ?? [];
    res.json(files.map((f) => `/uploads/${f.filename}`));
  });

  // --- KI-Assistent ---
  r.get('/trips/:tripId/conversations', requireRole('editor'), h((req, res) => {
    state(req);
    res.setHeader('Cache-Control', 'no-store');
    res.json(listConversations(req.user!.id, String(req.params.tripId)));
  }));
  r.post('/trips/:tripId/conversations', requireRole('editor'), h((req, res) => {
    state(req);
    const messages = req.body?.messages === undefined ? undefined : validateImportedMessages(req.body.messages);
    const conversation = createConversation(req.user!.id, String(req.params.tripId));
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json(messages ? saveConversation(req.user!.id, String(req.params.tripId), conversation.id, messages) : conversation);
  }));
  r.get('/trips/:tripId/conversations/:conversationId', requireRole('editor'), h((req, res) => {
    state(req);
    res.setHeader('Cache-Control', 'no-store');
    res.json(getConversation(req.user!.id, String(req.params.tripId), String(req.params.conversationId)));
  }));
  r.delete('/trips/:tripId/conversations/:conversationId', requireRole('editor'), h((req, res) => {
    state(req);
    deleteConversation(req.user!.id, String(req.params.tripId), String(req.params.conversationId));
    res.json({ ok: true });
  }));
  r.post('/trips/:tripId/conversations/:conversationId/messages', requireRole('editor'), h(async (req, res) => {
    const trip = state(req);
    const userId = req.user!.id;
    const tripId = String(req.params.tripId);
    const id = String(req.params.conversationId);
    const text = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    const retry = req.body?.retry === true;
    if (!retry && (!text || text.length > 10_000)) return res.status(400).json({ error: 'Nachricht muss zwischen 1 und 10000 Zeichen enthalten' });
    const conversation = getConversation(userId, tripId, id);
    if (retry && conversation.messages.at(-1)?.role !== 'user') return res.status(400).json({ error: 'Keine unbeantwortete Nachricht vorhanden' });
    if (!retry && conversation.messages.length >= 1000) return res.status(400).json({ error: 'Dieser Chat ist voll. Bitte einen neuen Chat beginnen.' });
    if (pendingChats.has(id)) return res.status(409).json({ error: 'Dieser Chat wird bereits bearbeitet' });
    pendingChats.add(id);
    try {
      const previousDay = conversation.messages.findLast((message) => message.role === 'user' && message.dayId)?.dayId;
      const requestedDay = typeof req.body?.dayId === 'string' ? req.body.dayId : previousDay;
      const dayId = trip.days.some((day) => day.id === requestedDay) ? requestedDay : undefined;
      const messages: ChatMessage[] = retry ? conversation.messages : [...conversation.messages, { role: 'user', content: text, ...(dayId ? { dayId } : {}) }];
      if (!retry) saveConversation(userId, tripId, id, messages);
      const response = await chat(trip, messages, dayId);
      res.setHeader('Cache-Control', 'no-store');
      res.json(saveConversation(userId, tripId, id, [...messages, { role: 'assistant', ...response }]));
    } finally { pendingChats.delete(id); }
  }));
  r.post('/trips/:tripId/conversations/:conversationId/messages/:index/applied', requireRole('editor'), h((req, res) => {
    state(req);
    const userId = req.user!.id;
    const tripId = String(req.params.tripId);
    const id = String(req.params.conversationId);
    const index = Number(req.params.index);
    if (pendingChats.has(id)) return res.status(409).json({ error: 'Dieser Chat wird bereits bearbeitet' });
    const conversation = getConversation(userId, tripId, id);
    const message = conversation.messages[index];
    if (!Number.isInteger(index) || !message || message.role !== 'assistant' || !message.proposal?.length) return res.status(400).json({ error: 'Vorschlag nicht gefunden' });
    message.proposal = [];
    message.content += '\n\n✅ Übernommen';
    res.json(saveConversation(userId, tripId, id, conversation.messages));
  }));
  r.post(
    '/trips/:tripId/chat',
    requireRole('editor'),
    h(async (req, res) => {
      // Spielplatz schickt einen eigenen (nicht gespeicherten) Stand mit
      const s = req.body.state ? { ...(req.body.state as TripState), trip: state(req).trip } : state(req);
      res.json(await chat(s, req.body.messages as ChatMessage[], req.body.dayId, req.body.mode));
    }),
  );

  r.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(err.status ?? 500).json({ error: err.message });
  });
  return r;
}
