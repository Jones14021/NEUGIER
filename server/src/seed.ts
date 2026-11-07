import type { CampType, Day, Expense, Op, Stop, Trip } from '@neugier/shared';
import { defaultScope, newId } from '@neugier/shared';
import { getSetting, setSetting } from './db';
import { applyOps, getState, listTrips } from './store';
import { SEED_DAYS, SEED_TRIP, SEED_VERSION, type SeedDay, type SeedStop } from './seed-data';

/**
 * Leere DB: Reise anlegen. Neue SEED_VERSION: Tage/Stopps/Ausgaben der ersten Reise durch die Seed-Daten ersetzen
 * (ein Batch in der Historie, also rückgängig machbar). Erinnerungen und Kommentare bleiben erhalten.
 */
export function seedIfEmpty(): void {
  const current = Number(getSetting('seed.version') ?? 0);
  const trips = listTrips();
  if (trips.length && current >= SEED_VERSION) return;

  const existing = trips[0] ? getState(trips[0].id) : null;
  const tripId = existing?.trip.id ?? newId();
  const ops: Op[] = [];

  if (existing) {
    for (const d of existing.days) ops.push({ op: 'delete', type: 'day', id: d.id });
    for (const s of existing.stops) ops.push({ op: 'delete', type: 'stop', id: s.id });
    for (const e of existing.expenses) ops.push({ op: 'delete', type: 'expense', id: e.id });
    ops.push({ op: 'put', type: 'trip', data: { ...existing.trip, ...SEED_TRIP, members: existing.trip.members, id: tripId } });
  } else {
    ops.push({ op: 'create', type: 'trip', data: { id: tripId, ...SEED_TRIP } as Trip });
  }

  const oldDayByDate = new Map(existing?.days.map((d) => [d.date, d]) ?? []);
  for (const d of SEED_DAYS) {
    // Gleiche Tag-ID behalten, damit Erinnerungen/Kommentare am Tag hängen bleiben
    const old = oldDayByDate.get(d.date);
    const dayId = old?.id ?? newId();
    ops.push({ op: 'put', type: 'day', data: toDay(d, dayId, old?.cover) });
    d.stops.forEach((s, i) => ops.push({ op: 'create', type: 'stop', data: toStop(s, dayId, i, d.date) }));
    for (const e of d.expenses ?? []) ops.push({ op: 'create', type: 'expense', data: toExpense(e, dayId, d.date) });
  }

  applyOps(tripId, ops, {
    userName: 'System',
    userId: '',
    source: 'seed',
    label: existing ? `Daten aus Excel aktualisiert (v${SEED_VERSION})` : 'Initiale Daten aus Excel',
  });
  setSetting('seed.version', String(SEED_VERSION));
  console.log(`Seed v${SEED_VERSION}: ${SEED_DAYS.length} Tage ${existing ? 'aktualisiert' : 'angelegt'}`);
}

function toDay(d: SeedDay, id: string, cover?: string): Day {
  return {
    id,
    key: `xl:day:${d.date}`,
    date: d.date,
    title: d.title,
    times: d.times ?? '',
    notes: d.notes ?? '',
    shower: { status: d.shower?.[0] ?? 'unklar', note: d.shower?.[1] ?? '' },
    facilities: { power: d.power ?? 'unklar', water: d.water ?? 'unklar', dump: d.dump ?? 'unklar' },
    cover,
  };
}

function toStop(s: SeedStop, dayId: string, order: number, date: string): Stop {
  const stop: Stop = {
    id: newId(),
    key: s.kind === 'campsite' || s.kind === 'accommodation' ? `xl:camp:${date}` : undefined,
    dayId,
    order,
    scope: s.scope ?? defaultScope(s.kind),
    kind: s.kind,
    name: s.name,
    notes: s.notes ?? '',
    lat: s.at?.[0],
    lng: s.at?.[1],
    time: s.time ?? '',
    duration: s.duration ?? '',
    links: s.links ?? [],
    booking: s.booking ?? '',
  };
  if (s.kind === 'campsite' || s.kind === 'accommodation') stop.camp = { type: (s.camp ?? '') as CampType };
  return stop;
}

function toExpense(e: NonNullable<SeedDay['expenses']>[number], dayId: string, date: string): Expense {
  return {
    id: newId(),
    key: `seed:exp:${date}:${e.title}`,
    dayId,
    stopId: null,
    title: e.title,
    amount: e.amount,
    currency: e.currency ?? 'EUR',
    paidBy: e.paidBy ?? '',
    splitBetween: [],
    note: e.note ?? '',
  };
}
