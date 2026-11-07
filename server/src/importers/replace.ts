import type { AnyEntity, Day, Op, TripState, TypedEntity } from '@neugier/shared';
import { newId } from '@neugier/shared';
import { db } from '../db';
import { REF } from '../merge';
import { applyOps } from '../store';

export function replaceWithImport(state: TripState, incoming: TypedEntity[]): number {
  const keys = incoming.map((item) => item.data.key);
  const days = incoming.filter((item) => item.type === 'day').map((item) => item.data as Day);
  if (!days.length || keys.some((key) => !key) || new Set(keys).size !== keys.length) {
    throw new Error('Import enthält keine Tage oder doppelte Schlüssel');
  }
  const oldDays = new Map(state.days.map((day) => [day.date, day.id]));
  const ids = new Map(incoming.map((item) => [item.data.key!, item.type === 'day' ? oldDays.get((item.data as Day).date) ?? newId() : newId()]));
  const ops: Op[] = [
    ...state.comments.map((item): Op => ({ op: 'delete', type: 'comment', id: item.id })),
    ...state.memories.map((item): Op => ({ op: 'delete', type: 'memory', id: item.id })),
    ...state.expenses.map((item): Op => ({ op: 'delete', type: 'expense', id: item.id })),
    ...state.stops.map((item): Op => ({ op: 'delete', type: 'stop', id: item.id })),
    ...state.days.map((item): Op => ({ op: 'delete', type: 'day', id: item.id })),
  ];
  for (const item of incoming) {
    const data = { ...item.data, id: ids.get(item.data.key!)! } as unknown as Record<string, unknown>;
    for (const field of ['dayId', 'stopId', 'targetId']) {
      const value = data[field];
      if (typeof value === 'string' && value.startsWith(REF)) {
        const id = ids.get(value.slice(REF.length));
        if (!id) throw new Error(`Unbekannte Import-Referenz: ${value}`);
        data[field] = id;
      }
    }
    ops.push({ op: 'create', type: item.type, data: data as unknown as AnyEntity });
  }
  const dates = days.map((day) => day.date).sort();
  ops.push({ op: 'update', type: 'trip', id: state.trip.id, patch: { startDate: dates[0], endDate: dates[dates.length - 1] } });
  return applyOps(state.trip.id, ops, { userName: 'Excel-Import', userId: '', source: 'import', label: 'Reise durch Excel ersetzt' }, () => {
    db.prepare('DELETE FROM import_base WHERE trip_id = ?').run(state.trip.id);
    const insert = db.prepare('INSERT INTO import_base (trip_id, source, key, type, data) VALUES (?, ?, ?, ?, ?)');
    for (const item of incoming) insert.run(state.trip.id, 'excel', item.data.key!, item.type, JSON.stringify(item.data));
  }).length;
}