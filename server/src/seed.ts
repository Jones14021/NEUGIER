import type { CampType, Day, Expense, Op, Stop, StopKind, Trip } from '@neugier/shared';
import { defaultScope, newId } from '@neugier/shared';
import { listTrips, applyOps } from './store';
import { SEED_DAYS, SEED_IDEAS, SEED_TRIP, type SeedStop } from './seed-data';

/** Befüllt eine leere Datenbank mit der Neuseeland-Reise (aus "Routenplanung.xlsx" übernommen). */
export function seedIfEmpty(): void {
  if (listTrips().length) return;
  const tripId = newId();
  const trip: Trip = { id: tripId, ...SEED_TRIP };
  const ops: Op[] = [{ op: 'create', type: 'trip', data: trip }];

  for (const d of SEED_DAYS) {
    const dayId = newId();
    const day: Day = {
      id: dayId,
      key: `xl:day:${d.date}`,
      date: d.date,
      title: d.title,
      times: d.times ?? '',
      notes: d.notes ?? '',
      shower: { status: d.shower?.[0] ?? 'unklar', note: d.shower?.[1] ?? '' },
    };
    ops.push({ op: 'create', type: 'day', data: day });
    d.stops.forEach((s, i) => ops.push({ op: 'create', type: 'stop', data: toStop(s, dayId, i, d.date) }));
    for (const e of d.expenses ?? []) {
      const exp: Expense = {
        id: newId(),
        key: `seed:exp:${d.date}:${e.title}`,
        dayId,
        stopId: null,
        title: e.title,
        amount: e.amount,
        currency: e.currency ?? 'EUR',
        paidBy: e.paidBy ?? '',
        splitBetween: [],
        note: e.note ?? '',
      };
      ops.push({ op: 'create', type: 'expense', data: exp });
    }
  }
  SEED_IDEAS.forEach((s, i) => ops.push({ op: 'create', type: 'stop', data: toStop(s, null, i, '') }));

  applyOps(tripId, ops, { userName: 'System', userId: '', source: 'seed', label: 'Initiale Daten aus Excel' });
  console.log(`Seed: Reise "${trip.name}" mit ${SEED_DAYS.length} Tagen angelegt`);
}

function toStop(s: SeedStop, dayId: string | null, order: number, date: string): Stop {
  const kind: StopKind = s.kind;
  const stop: Stop = {
    id: newId(),
    key: s.key ? s.key.replace('{date}', date) : undefined,
    dayId,
    order,
    scope: s.scope ?? defaultScope(kind),
    kind,
    name: s.name,
    notes: s.notes ?? '',
    lat: s.at?.[0],
    lng: s.at?.[1],
    time: s.time ?? '',
    duration: s.duration ?? '',
    links: s.links ?? [],
    booking: s.booking ?? '',
  };
  if (kind === 'campsite' || kind === 'accommodation') {
    stop.camp = { type: (s.camp ?? '') as CampType, powered: !!s.powered, shower: !!s.shower };
  }
  return stop;
}
