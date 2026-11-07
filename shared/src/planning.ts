import type { Day, Op, Stop, TripState } from './types';
import { newId, sortedDays } from './util';

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** "3,5 h" bzw. "45 min" – wie die Routenvorschau in Google Maps, nur kompakter. */
export function fmtHours(sec: number): string {
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} min`;
  return `${(Math.round(sec / 1800) / 2).toString().replace('.', ',')} h`;
}

/** Neuen Tag nach `afterDayId` einfügen; alle späteren Tage rutschen einen Tag nach hinten. */
export function insertDayOps(state: Pick<TripState, 'trip' | 'days'>, afterDayId: string | null): { ops: Op[]; day: Day } {
  const days = sortedDays(state.days);
  const idx = afterDayId ? days.findIndex((d) => d.id === afterDayId) : -1;
  const date = idx >= 0 ? addDays(days[idx].date, 1) : days[0] ? days[0].date : state.trip.startDate;
  const ops: Op[] = [];
  // Von hinten verschieben, damit nie zwei Tage dasselbe Datum haben
  for (const d of days.slice(idx + 1).reverse()) ops.push({ op: 'update', type: 'day', id: d.id, patch: { date: addDays(d.date, 1) } });
  const day: Day = {
    id: newId(),
    date,
    title: 'Neuer Tag',
    times: '',
    notes: '',
    shower: { status: 'unklar', note: '' },
    facilities: { power: 'unklar', water: 'unklar', dump: 'unklar' },
  };
  ops.push({ op: 'create', type: 'day', data: day });
  const last = days[days.length - 1];
  const end = last ? addDays(last.date, 1) : date;
  if (end > state.trip.endDate) ops.push({ op: 'update', type: 'trip', id: state.trip.id, patch: { endDate: end } });
  return { ops, day };
}

/** Tag löschen; Stopps wandern in den Ideen-Pool, spätere Tage rücken einen Tag nach vorne. */
export function removeDayOps(state: Pick<TripState, 'trip' | 'days' | 'stops'>, dayId: string): Op[] {
  const days = sortedDays(state.days);
  const idx = days.findIndex((d) => d.id === dayId);
  if (idx < 0) return [];
  const ops: Op[] = [];
  for (const s of state.stops.filter((x) => x.dayId === dayId)) ops.push({ op: 'update', type: 'stop', id: s.id, patch: { dayId: null } });
  ops.push({ op: 'delete', type: 'day', id: dayId });
  for (const d of days.slice(idx + 1)) ops.push({ op: 'update', type: 'day', id: d.id, patch: { date: addDays(d.date, -1) } });
  if (days.length > 1) ops.push({ op: 'update', type: 'trip', id: state.trip.id, patch: { endDate: addDays(days[days.length - 1].date, -1) } });
  return ops;
}

/** Tag mit Nachbarn tauschen (Inhalte wandern, Datum bleibt in Reihenfolge). */
export function moveDayOps(state: Pick<TripState, 'days'>, dayId: string, dir: -1 | 1): Op[] {
  const days = sortedDays(state.days);
  const i = days.findIndex((d) => d.id === dayId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= days.length) return [];
  return [
    { op: 'update', type: 'day', id: days[i].id, patch: { date: days[j].date } },
    { op: 'update', type: 'day', id: days[j].id, patch: { date: days[i].date } },
  ];
}

/** Stopp an Position `toIndex` eines Tages (oder Ideen-Pool) setzen und Reihenfolge neu nummerieren. */
export function moveStopOps(stops: Stop[], stopId: string, dayId: string | null, toIndex: number): Op[] {
  const stop = stops.find((s) => s.id === stopId);
  if (!stop) return [];
  const list = stops.filter((s) => s.dayId === dayId && s.id !== stopId).sort((a, b) => a.order - b.order);
  list.splice(Math.max(0, Math.min(toIndex, list.length)), 0, { ...stop, dayId });
  const ops: Op[] = [];
  list.forEach((s, i) => {
    const orig = stops.find((x) => x.id === s.id)!;
    if (orig.order !== i || orig.dayId !== dayId) ops.push({ op: 'update', type: 'stop', id: s.id, patch: { order: i, dayId } });
  });
  return ops;
}

export interface PlanChange {
  kind: 'add' | 'remove' | 'change';
  type: 'stop' | 'day';
  id: string;
  label: string;
  op: Op;
}

/** Unterschiede zwischen echter Planung und Spielplatz (Tage + Stopps) als einzeln wählbare Änderungen. */
export function diffPlans(real: TripState, draft: TripState): PlanChange[] {
  const out: PlanChange[] = [];
  const strip = (e: object) => {
    const { updatedAt: _a, updatedBy: _b, ...rest } = e as Record<string, unknown>;
    return JSON.stringify(rest);
  };
  for (const type of ['day', 'stop'] as const) {
    const a = (type === 'day' ? real.days : real.stops) as (Day | Stop)[];
    const b = (type === 'day' ? draft.days : draft.stops) as (Day | Stop)[];
    const byId = new Map(a.map((x) => [x.id, x]));
    const name = (x: Day | Stop) => ('name' in x ? x.name : `${x.date} ${x.title}`);
    for (const x of b) {
      const o = byId.get(x.id);
      if (!o) out.push({ kind: 'add', type, id: x.id, label: name(x), op: { op: 'create', type, data: x } });
      else if (strip(o) !== strip(x)) out.push({ kind: 'change', type, id: x.id, label: name(x), op: { op: 'put', type, data: x } });
    }
    const inDraft = new Set(b.map((x) => x.id));
    for (const x of a) if (!inDraft.has(x.id)) out.push({ kind: 'remove', type, id: x.id, label: name(x), op: { op: 'delete', type, id: x.id } });
  }
  return out;
}
