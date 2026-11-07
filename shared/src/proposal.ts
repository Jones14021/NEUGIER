import type { Op, ProposedChange, Stop, TripState } from './types';
import { defaultScope } from './labels';
import { dayStops, newId } from './util';

/**
 * Wandelt (akzeptierte) KI-Vorschläge in Operationen um.
 * Wird im Client für die Diff-Vorschau und beim Übernehmen genutzt.
 */
export function proposalToOps(state: TripState, changes: ProposedChange[]): Op[] {
  // Arbeitskopie, damit aufeinander aufbauende Vorschläge korrekt sortiert werden
  const stops = state.stops.map((s) => ({ ...s }));
  const dayByDate = new Map(state.days.map((d) => [d.date, d]));
  const touched = new Set<string>();
  const created = new Set<string>();
  const removed = new Set<string>();

  const insert = (stop: Stop, dayId: string | null, afterStopId: string | null) => {
    stop.dayId = dayId;
    const list = dayId ? dayStops(stops, dayId).filter((s) => s.id !== stop.id) : [];
    const idx = afterStopId ? list.findIndex((s) => s.id === afterStopId) + 1 : 0;
    list.splice(idx, 0, stop);
    list.forEach((s, i) => {
      if (s.order !== i) {
        s.order = i;
        touched.add(s.id);
      }
    });
    touched.add(stop.id);
  };

  for (const c of changes) {
    if (c.action === 'add') {
      const dayId = c.date ? (dayByDate.get(c.date)?.id ?? null) : null;
      const stop: Stop = {
        id: newId(),
        dayId,
        order: 0,
        kind: c.stop.kind || 'other',
        scope: c.stop.scope || defaultScope(c.stop.kind || 'other'),
        name: c.stop.name,
        notes: [c.stop.notes, c.reason ? `KI: ${c.reason}` : ''].filter(Boolean).join('\n'),
        lat: c.stop.lat,
        lng: c.stop.lng,
        placeId: c.stop.placeId,
        address: c.stop.address,
        time: c.stop.time ?? '',
        duration: c.stop.duration ?? '',
        links: [],
        booking: '',
      };
      stops.push(stop);
      created.add(stop.id);
      insert(stop, dayId, c.afterStopId);
    } else {
      const stop = stops.find((s) => s.id === c.stopId);
      if (!stop) continue;
      if (c.action === 'update') {
        Object.assign(stop, c.patch);
        touched.add(stop.id);
      } else if (c.action === 'move') {
        const dayId = c.date ? (dayByDate.get(c.date)?.id ?? null) : null;
        insert(stop, dayId, c.afterStopId);
      } else if (c.action === 'remove') {
        removed.add(stop.id);
      }
    }
  }

  const ops: Op[] = [];
  for (const id of removed) ops.push({ op: 'delete', type: 'stop', id });
  for (const s of stops) {
    if (removed.has(s.id) || !touched.has(s.id)) continue;
    ops.push(created.has(s.id) ? { op: 'create', type: 'stop', data: s } : { op: 'put', type: 'stop', data: s });
  }
  return ops;
}

/** Wendet Ops lokal auf einen State an (für Vorschau/optimistische Updates). */
export function applyOpsLocal(state: TripState, ops: Op[]): TripState {
  const next: TripState = {
    trip: state.trip,
    days: [...state.days],
    stops: [...state.stops],
    expenses: [...state.expenses],
    memories: [...state.memories],
    comments: [...state.comments],
  };
  const listKey = { day: 'days', stop: 'stops', expense: 'expenses', memory: 'memories', comment: 'comments' } as const;
  for (const op of ops) {
    if (op.type === 'trip') {
      if (op.op === 'update') next.trip = { ...next.trip, ...op.patch };
      else if (op.op !== 'delete') next.trip = op.data as TripState['trip'];
      continue;
    }
    const k = listKey[op.type];
    const list = next[k] as { id: string }[];
    const id = op.op === 'create' || op.op === 'put' ? op.data.id : op.id;
    const i = list.findIndex((e) => e.id === id);
    if (op.op === 'delete') {
      if (i >= 0) list.splice(i, 1);
    } else if (op.op === 'update') {
      if (i >= 0) list[i] = { ...list[i], ...op.patch };
    } else if (i >= 0) list[i] = op.data;
    else list.push(op.data);
  }
  return next;
}
