import type { Day, Stop, TripState } from './types';

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export function fmtDate(iso: string, withWeekday = true): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${withWeekday ? WD[dt.getDay()] + ', ' : ''}${d}. ${MON[m - 1]}`;
}

export function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

export function fmtKm(m: number): string {
  return m >= 10000 ? `${Math.round(m / 1000)} km` : `${(m / 1000).toFixed(1)} km`;
}

export function sortedDays(days: Day[]): Day[] {
  return [...days].sort((a, b) => a.date.localeCompare(b.date));
}

export function dayStops(stops: Stop[], dayId: string): Stop[] {
  return stops.filter((s) => s.dayId === dayId).sort((a, b) => a.order - b.order);
}

/** Übernachtungsziel des Tages (letzter Hauptrouten-Stopp mit Übernachtung). */
export function dayCamp(stops: Stop[], dayId: string): Stop | undefined {
  return dayStops(stops, dayId)
    .filter((s) => s.scope === 'main' && (s.kind === 'campsite' || s.kind === 'accommodation'))
    .pop();
}

/** Alle Hauptrouten-Stopps in Reihenfolge der Tage. */
export function mainRoute(state: Pick<TripState, 'days' | 'stops'>): { day: Day; stop: Stop }[] {
  const out: { day: Day; stop: Stop }[] = [];
  for (const day of sortedDays(state.days)) {
    for (const stop of dayStops(state.stops, day.id)) if (stop.scope === 'main') out.push({ day, stop });
  }
  return out;
}

/**
 * Tagesroute: Start am Übernachtungsort des Vortags, dann alle Stopps des Tages.
 */
export function dayRoute(state: Pick<TripState, 'days' | 'stops'>, day: Day): { start?: Stop; stops: Stop[] } {
  const days = sortedDays(state.days);
  const idx = days.findIndex((d) => d.id === day.id);
  let start: Stop | undefined;
  for (let i = idx - 1; i >= 0 && !start; i--) start = dayCamp(state.stops, days[i].id);
  const stops = dayStops(state.stops, day.id);
  // Bleibt man am selben Platz, keinen doppelten Start anzeigen
  if (start && stops.length && sameplace(start, stops[0])) start = undefined;
  return { start, stops };
}

function sameplace(a: Stop, b: Stop): boolean {
  if (a.placeId && a.placeId === b.placeId) return true;
  if (a.lat != null && b.lat != null) return Math.abs(a.lat - b.lat!) < 1e-4 && Math.abs(a.lng! - b.lng!) < 1e-4;
  return a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}

export function hasCoords(s: Stop): s is Stop & { lat: number; lng: number } {
  return s.lat != null && s.lng != null;
}
