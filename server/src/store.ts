import { EventEmitter } from 'node:events';
import type { AnyEntity, Change, ChangeSource, EntityType, Op, Trip, TripState } from '@neugier/shared';
import { newId } from '@neugier/shared';
import { db, tx } from './db';

export const ENTITY_TYPES: EntityType[] = ['trip', 'day', 'stop', 'expense', 'memory', 'comment'];

/** Emittiert `change` mit { tripId, changes } – wird vom WebSocket-Hub verteilt. */
export const events = new EventEmitter();

export interface Actor {
  userName: string;
  userId: string;
  source: ChangeSource;
  label: string;
}

function parse<T>(s: string | null | undefined): T | null {
  return s ? (JSON.parse(s) as T) : null;
}

export function getEntity(type: EntityType, id: string): AnyEntity | null {
  const row = db.prepare('SELECT data FROM entities WHERE type = ? AND id = ?').get(type, id) as
    | { data: string }
    | undefined;
  return parse<AnyEntity>(row?.data);
}

export function listTrips(): Trip[] {
  const rows = db.prepare("SELECT data FROM entities WHERE type = 'trip'").all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Trip).sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function getState(tripId: string): TripState | null {
  const rows = db.prepare('SELECT type, data FROM entities WHERE trip_id = ?').all(tripId) as {
    type: EntityType;
    data: string;
  }[];
  const state: Partial<TripState> = { days: [], stops: [], expenses: [], memories: [], comments: [] };
  for (const r of rows) {
    const d = JSON.parse(r.data);
    if (r.type === 'trip') state.trip = d;
    else if (r.type === 'day') state.days!.push(d);
    else if (r.type === 'stop') state.stops!.push(d);
    else if (r.type === 'expense') state.expenses!.push(d);
    else if (r.type === 'memory') state.memories!.push(d);
    else if (r.type === 'comment') state.comments!.push(d);
  }
  return state.trip ? (state as TripState) : null;
}

/**
 * Wendet Operationen atomar an, schreibt die Historie und benachrichtigt alle Clients.
 * Ein Aufruf = ein Batch (eine Zeile in der Versionshistorie, gemeinsam zurücksetzbar).
 */
export function applyOps(tripId: string, ops: Op[], actor: Actor): Change[] {
  const batchId = newId();
  const ts = new Date().toISOString();
  const changes: Change[] = tx(() => {
    const out: Change[] = [];
    for (const op of ops) {
      if (!ENTITY_TYPES.includes(op.type)) throw new Error(`Unbekannter Typ: ${op.type}`);
      const id = op.op === 'create' || op.op === 'put' ? op.data.id : op.id;
      const before = getEntity(op.type, id);
      let after: AnyEntity | null;
      if (op.op === 'delete') {
        if (!before) continue;
        after = null;
      } else if (op.op === 'update') {
        if (!before) throw new Error(`${op.type} ${id} nicht gefunden`);
        after = { ...before, ...op.patch, id } as AnyEntity;
      } else {
        after = op.data;
      }
      if (after) {
        after.updatedAt = ts;
        after.updatedBy = actor.userName;
      }
      if (JSON.stringify(stripMeta(before)) === JSON.stringify(stripMeta(after))) continue;

      if (after) {
        db.prepare(
          'INSERT INTO entities (type, id, trip_id, data) VALUES (?, ?, ?, ?) ON CONFLICT(type, id) DO UPDATE SET data = excluded.data',
        ).run(op.type, id, tripId, JSON.stringify(after));
      } else {
        db.prepare('DELETE FROM entities WHERE type = ? AND id = ?').run(op.type, id);
      }
      const info = db
        .prepare(
          'INSERT INTO changes (batch_id, trip_id, type, entity_id, before, after, user_name, source, label, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          batchId,
          tripId,
          op.type,
          id,
          before ? JSON.stringify(before) : null,
          after ? JSON.stringify(after) : null,
          actor.userName,
          actor.source,
          actor.label,
          ts,
        );
      out.push({
        id: Number(info.lastInsertRowid),
        batchId,
        type: op.type,
        entityId: id,
        before,
        after,
        userName: actor.userName,
        source: actor.source,
        label: actor.label,
        ts,
      });
    }
    return out;
  });
  if (changes.length) events.emit('change', { tripId, changes });
  return changes;
}

function stripMeta(e: AnyEntity | null): unknown {
  if (!e) return null;
  const { updatedAt: _a, updatedBy: _b, ...rest } = e;
  return rest;
}

interface ChangeRow {
  id: number;
  batch_id: string;
  type: EntityType;
  entity_id: string;
  before: string | null;
  after: string | null;
  user_name: string;
  source: ChangeSource;
  label: string;
  ts: string;
}

function rowToChange(r: ChangeRow): Change {
  return {
    id: r.id,
    batchId: r.batch_id,
    type: r.type,
    entityId: r.entity_id,
    before: parse(r.before),
    after: parse(r.after),
    userName: r.user_name,
    source: r.source,
    label: r.label,
    ts: r.ts,
  };
}

export function listChanges(tripId: string, opts: { entityId?: string; limit?: number } = {}): Change[] {
  const limit = opts.limit ?? 500;
  const rows = (
    opts.entityId
      ? db
          .prepare('SELECT * FROM changes WHERE trip_id = ? AND entity_id = ? ORDER BY id DESC LIMIT ?')
          .all(tripId, opts.entityId, limit)
      : db.prepare('SELECT * FROM changes WHERE trip_id = ? ORDER BY id DESC LIMIT ?').all(tripId, limit)
  ) as unknown as ChangeRow[];
  return rows.map(rowToChange);
}

/** Macht einen kompletten Batch rückgängig (setzt jedes Objekt auf seinen Vorher-Zustand). */
export function rollbackBatch(tripId: string, batchId: string, actor: Omit<Actor, 'source' | 'label'>): Change[] {
  const rows = db
    .prepare('SELECT * FROM changes WHERE trip_id = ? AND batch_id = ? ORDER BY id DESC')
    .all(tripId, batchId) as unknown as ChangeRow[];
  if (!rows.length) throw new Error('Version nicht gefunden');
  const ops: Op[] = rows.map((r) => {
    const c = rowToChange(r);
    return c.before ? { op: 'put', type: c.type, data: c.before } : { op: 'delete', type: c.type, id: c.entityId };
  });
  return applyOps(tripId, ops, { ...actor, source: 'rollback', label: `Rückgängig: ${rows[0].label}` });
}

/** Setzt ein einzelnes Objekt auf den Zustand nach einer bestimmten Änderung zurück. */
export function restoreVersion(tripId: string, changeId: number, actor: Omit<Actor, 'source' | 'label'>): Change[] {
  const r = db.prepare('SELECT * FROM changes WHERE trip_id = ? AND id = ?').get(tripId, changeId) as unknown as
    | ChangeRow
    | undefined;
  if (!r) throw new Error('Version nicht gefunden');
  const c = rowToChange(r);
  const op: Op = c.after ? { op: 'put', type: c.type, data: c.after } : { op: 'delete', type: c.type, id: c.entityId };
  return applyOps(tripId, [op], { ...actor, source: 'rollback', label: `Version wiederhergestellt (${c.ts.slice(0, 16)})` });
}
