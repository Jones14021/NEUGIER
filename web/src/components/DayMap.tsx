import { useMemo } from 'react';
import type { Day, RouteLeg, Stop, TripState } from '@neugier/shared';
import { dayRoute, fmtHours, hasCoords, isFlightStop, KIND_COLOR } from '@neugier/shared';
import { legsByDest, useRoute } from '../hooks';
import { midpoint, type MapLabel, type MapMarker, type MapPath } from './MapView';

/**
 * Tagesroute (Start = Übernachtung Vortag, dann alle Stopps) inkl. Google-Fahrzeiten.
 * Wird von Tagesansicht und Spielplatz genutzt – im Spielplatz mit dem Entwurfsstand.
 */
export function useDayMap(state: TripState, day: Day | undefined, activeId?: string | null, draggable = false) {
  const { start, stops } = useMemo(() => (day ? dayRoute(state, day) : { start: undefined, stops: [] as Stop[] }), [state, day]);
  const routePts = useMemo(() => {
    const flightDay = stops.some(isFlightStop);
    return [start, ...stops].filter((stop): stop is Stop => !!stop)
      .filter((stop) => !flightDay || stop.kind !== 'transport' || /fähre|ferry/i.test(stop.name))
      .filter(hasCoords);
  }, [start, stops]);
  const route = useRoute(routePts, state.trip.region, !!day);
  const legs: Map<string, RouteLeg> = useMemo(() => legsByDest(routePts, route), [routePts, route]);

  const markers: MapMarker[] = useMemo(() => {
    const out: MapMarker[] = [];
    if (start && hasCoords(start)) out.push({ id: `start-${start.id}`, lat: start.lat, lng: start.lng, label: '⌂', color: '#64748b', title: `Start: ${start.name}`, muted: true });
    stops.forEach((s, i) => {
      if (!hasCoords(s)) return;
      out.push({
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        label: s.kind === 'campsite' ? '⛺' : String(i + 1),
        color: KIND_COLOR[s.kind],
        title: s.name,
        active: s.id === activeId,
        draggable,
      });
    });
    return out;
  }, [start, stops, activeId, draggable]);

  const paths: MapPath[] = useMemo(
    () =>
      routePts.slice(1).map((p, k) => {
        const leg = legs.get(p.id);
        return {
          id: p.id,
          path: leg?.path?.length ? leg.path : [routePts[k], p],
          color: '#2563eb',
          dashed: !leg?.durationSec,
          weight: 5,
        };
      }),
    [routePts, legs],
  );

  const labels: MapLabel[] = useMemo(
    () =>
      routePts.slice(1).flatMap((p) => {
        const leg = legs.get(p.id);
        const at = leg?.path?.length ? midpoint(leg.path) : null;
        return leg?.durationSec && at ? [{ id: p.id, at, text: fmtHours(leg.durationSec) }] : [];
      }),
    [routePts, legs],
  );

  const totalSec = route?.legs.reduce((a, l) => a + l.durationSec, 0) ?? 0;
  const totalM = route?.legs.reduce((a, l) => a + l.distanceMeters, 0) ?? 0;
  return { start, stops, routePts, legs, markers, paths, labels, totalSec, totalM, loading: routePts.length > 1 && !route };
}
