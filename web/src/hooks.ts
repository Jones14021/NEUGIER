import { useEffect, useMemo, useState } from 'react';
import type { Day, RouteLeg, RouteResult, Stop } from '@neugier/shared';
import { todayIso } from '@neugier/shared';
import { api } from './api';

type Pt = Pick<Stop, 'name' | 'lat' | 'lng' | 'placeId' | 'address'> & { routeBreakBefore?: boolean };

const cache = new Map<string, RouteResult>();

/** Autoroute über den Server (Google Routes API, etappenweise, serverseitig gecacht). */
export function useRoute(points: Pt[], region: string, enabled = true): RouteResult | null {
  const key = useMemo(
    () => JSON.stringify([region, points.map((p) => [p.lat, p.lng, p.placeId, p.lat == null ? p.address || p.name : '', p.routeBreakBefore])]),
    [points, region],
  );
  const [res, setRes] = useState<{ key: string; r: RouteResult } | null>(null);
  useEffect(() => {
    if (!enabled || points.length < 2 || cache.has(key)) return;
    let alive = true;
    const body = points.map(({ name, lat, lng, placeId, address, routeBreakBefore }) => ({ name, lat, lng, placeId, address, routeBreakBefore }));
    api<RouteResult>('/maps/route', { body: { points: body, region } })
      .then((r) => {
        cache.set(key, r);
        if (alive) setRes({ key, r });
      })
      .catch(() => {
        if (alive) setRes({ key, r: { path: [], legs: points.slice(1).map(() => ({ distanceMeters: 0, durationSec: 0, path: [] })), fallback: true } });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  if (!enabled || points.length < 2) return null;
  // Nie ein Ergebnis für eine veraltete Punkteliste zurückgeben
  return cache.get(key) ?? (res?.key === key ? res.r : null);
}

/** Etappe je Zielpunkt (Etappe k führt von points[k] nach points[k+1]). */
export function legsByDest<T extends { id: string }>(points: T[], route: RouteResult | null): Map<string, RouteLeg> {
  const m = new Map<string, RouteLeg>();
  if (!route || route.legs.length !== points.length - 1) return m;
  route.legs.forEach((l, k) => m.set(points[k + 1].id, l));
  return m;
}

/** Tag, der "heute" ist – vor der Reise der erste, danach der letzte Tag. */
export function findToday(days: Day[]): Day | undefined {
  if (!days.length) return undefined;
  const t = todayIso();
  return days.find((d) => d.date === t) ?? (t < days[0].date ? days[0] : days[days.length - 1]);
}

export function useOnline(): boolean {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    addEventListener('online', up);
    addEventListener('offline', down);
    return () => {
      removeEventListener('online', up);
      removeEventListener('offline', down);
    };
  }, []);
  return on;
}

/** Live-Standort des Geräts (nur solange `enabled`). */
export function useGeoWatch(enabled: boolean): { pos: { lat: number; lng: number; timestamp: number } | null; error: string } {
  const [pos, setPos] = useState<{ lat: number; lng: number; timestamp: number } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) {
      setPos(null);
      setError('');
      return;
    }
    if (!('geolocation' in navigator)) {
      setError('Standort wird nicht unterstützt');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError('');
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, timestamp: p.timestamp });
      },
      (e) => setError(e.message || 'Standort nicht verfügbar'),
      { enableHighAccuracy: false, maximumAge: 60000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return { pos, error };
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}
