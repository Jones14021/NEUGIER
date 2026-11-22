import { useEffect, useMemo, useState } from 'react';
import type { Day, RouteLeg, RouteResult, Stop } from '@neugier/shared';
import { todayIso } from '@neugier/shared';
import { api } from './api';
import { lastRouteReset, makeCachedRoute, nextRouteReset, readCachedRoute, routeCacheId, saveCachedRoute, type CachedRoute } from './routeCache';

type Pt = Pick<Stop, 'name' | 'lat' | 'lng' | 'placeId' | 'address'> & { routeBreakBefore?: boolean };

const cache = new Map<string, CachedRoute>();
const pendingRoutes = new Map<string, Promise<RouteResult>>();

function rememberRoute(key: string, route: CachedRoute) {
  cache.delete(key);
  cache.set(key, route);
  if (cache.size > 30) cache.delete(cache.keys().next().value!);
}

export function routeKey(points: Pt[], region: string): string {
  return JSON.stringify([region, points.map((point) => [
    point.lat != null && point.lng != null ? ['coordinates', point.lat, point.lng]
      : point.placeId ? ['place', point.placeId] : ['address', point.address || point.name],
    !!point.routeBreakBefore,
  ])]);
}

export function requestRoute(key: string, points: Pt[], region: string): Promise<RouteResult> {
  const pending = pendingRoutes.get(key);
  if (pending) return pending;
  const body = points.map(({ name, lat, lng, placeId, address, routeBreakBefore }) => ({ name, lat, lng, placeId, address, routeBreakBefore }));
  const request = api<RouteResult>('/maps/route', { body: { points: body, region }, signal: AbortSignal.timeout(30_000) })
    .finally(() => pendingRoutes.delete(key));
  pendingRoutes.set(key, request);
  return request;
}

/** Autoroute über den Server (Google Routes API, etappenweise, serverseitig gecacht). */
export function useRoute(points: Pt[], region: string, enabled = true, owner = ''): RouteResult | null {
  const key = useMemo(
    () => routeKey(points, region),
    [points, region],
  );
  const scopedKey = routeCacheId(owner, key);
  const [res, setRes] = useState<{ key: string; r: RouteResult } | null>(null);
  useEffect(() => {
    if (!enabled || points.length < 2 || !owner) return;
    let alive = true;
    let loading = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (when: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => { void update(); }, Math.max(1000, Math.min(when - Date.now(), 60_000)));
    };
    const update = async () => {
      if (!alive || loading) return;
      loading = true;
      let stored = cache.get(scopedKey);
      const now = Date.now();
      if (stored && (stored.storedAt < lastRouteReset(now) || stored.storedAt > now)) {
        cache.delete(scopedKey);
        stored = undefined;
        setRes(null);
      }
      if (!stored) {
        try { stored = await readCachedRoute(owner, key, now); } catch {}
        const checkedAt = Date.now();
        if (stored && (stored.storedAt < lastRouteReset(checkedAt) || stored.storedAt > checkedAt)) stored = undefined;
        if (stored) rememberRoute(scopedKey, stored);
      }
      if (!alive) return;
      if (stored) setRes({ key: scopedKey, r: { ...stored.result, stale: stored.freshUntil <= Date.now() } });
      if (stored && stored.freshUntil > Date.now()) {
        loading = false;
        schedule(Math.min(stored.freshUntil, nextRouteReset(Date.now())));
        return;
      }
      const requestedAt = Date.now();
      try {
        const route = await requestRoute(scopedKey, points, region);
        if (!alive) return;
        if (requestedAt < lastRouteReset(Date.now())) {
          setRes(null);
          loading = false;
          schedule(Date.now() + 1000);
          return;
        }
        const saved = makeCachedRoute(owner, key, route, requestedAt);
        const expiredInTransit = !route.fallback && !route.stale && route.cacheTtlMs !== undefined && !saved;
        if (!route.fallback || !stored) setRes({ key: scopedKey, r: expiredInTransit ? { ...route, stale: true } : route });
        if (!route.fallback && !route.stale) {
          if (saved) rememberRoute(scopedKey, saved);
          try {
            await saveCachedRoute(owner, key, route, requestedAt);
          } catch {}
        }
      } catch {
        if (alive && !stored) setRes({ key: scopedKey, r: { path: [], legs: points.slice(1).map(() => ({ distanceMeters: 0, durationSec: 0, path: [] })), fallback: true } });
      }
      loading = false;
      const currentTime = Date.now();
      const freshUntil = cache.get(scopedKey)?.freshUntil ?? 0;
      if (alive) schedule(Math.min(freshUntil > currentTime ? freshUntil : currentTime + 60_000, nextRouteReset(currentTime)));
    };
    const check = () => { void update(); };
    void update();
    addEventListener('focus', check);
    addEventListener('online', check);
    return () => {
      alive = false;
      clearTimeout(timer);
      removeEventListener('focus', check);
      removeEventListener('online', check);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, owner]);
  if (!enabled || points.length < 2) return null;
  // Nie ein Ergebnis für eine veraltete Punkteliste zurückgeben
  return res?.key === scopedKey ? res.r : null;
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
    const check = () => setOn(navigator.onLine);
    const timer = setInterval(check, 3000);
    addEventListener('online', check);
    addEventListener('offline', check);
    addEventListener('focus', check);
    addEventListener('pageshow', check);
    document.addEventListener('visibilitychange', check);
    check();
    return () => {
      clearInterval(timer);
      removeEventListener('online', check);
      removeEventListener('offline', check);
      removeEventListener('focus', check);
      removeEventListener('pageshow', check);
      document.removeEventListener('visibilitychange', check);
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
