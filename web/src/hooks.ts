import { useEffect, useMemo, useState } from 'react';
import type { Day, RouteResult, Stop } from '@neugier/shared';
import { todayIso } from '@neugier/shared';
import { api } from './api';

type Pt = Pick<Stop, 'name' | 'lat' | 'lng' | 'placeId' | 'address'>;

const cache = new Map<string, RouteResult>();

/** Berechnet eine Autoroute über den Server (Google Routes API, gecached). */
export function useRoute(points: Pt[], region: string, enabled = true): RouteResult | null {
  const key = useMemo(
    () => JSON.stringify(points.map((p) => [p.lat, p.lng, p.placeId, p.lat == null ? p.address || p.name : ''])),
    [points],
  );
  const [res, setRes] = useState<RouteResult | null>(cache.get(key) ?? null);
  useEffect(() => {
    if (!enabled || points.length < 2) {
      setRes(null);
      return;
    }
    if (cache.has(key)) {
      setRes(cache.get(key)!);
      return;
    }
    let alive = true;
    api<RouteResult>('/maps/route', { body: { points, region } })
      .then((r) => {
        cache.set(key, r);
        if (alive) setRes(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, region, enabled]);
  return res;
}

/** Tag, der "heute" ist – vor der Reise der erste, danach der letzte Tag. */
export function findToday(days: Day[]): Day | undefined {
  if (!days.length) return undefined;
  const t = todayIso();
  return days.find((d) => d.date === t) ?? (t < days[0].date ? days[0] : days[days.length - 1]);
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
