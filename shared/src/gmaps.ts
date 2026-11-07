import type { Stop } from './types';

type Point = Pick<Stop, 'name' | 'lat' | 'lng' | 'placeId' | 'address'>;

function loc(p: Point, region: string): string {
  if (p.lat != null && p.lng != null) return `${p.lat},${p.lng}`;
  const q = p.address || p.name;
  return region && !q.toLowerCase().includes(region.toLowerCase()) ? `${q}, ${region}` : q;
}

/** Link, der einen Ort in Google Maps öffnet. */
export function placeLink(p: Point, region = ''): string {
  const u = new URL('https://www.google.com/maps/search/');
  u.searchParams.set('api', '1');
  u.searchParams.set('query', p.lat != null ? `${p.lat},${p.lng}` : loc(p, region));
  if (p.placeId) u.searchParams.set('query_place_id', p.placeId);
  return u.toString();
}

/**
 * Navigations-Link für Google Maps (App auf Android, sonst Web).
 * Ohne `fromCurrent` ist der erste Punkt der Start, sonst der aktuelle Standort.
 */
export function routeLink(points: Point[], region = '', fromCurrent = false): string | null {
  if (points.length === 0) return null;
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  const list = [...points];
  if (!fromCurrent && list.length > 1) {
    const origin = list.shift()!;
    u.searchParams.set('origin', loc(origin, region));
    if (origin.placeId) u.searchParams.set('origin_place_id', origin.placeId);
  }
  const dest = list.pop()!;
  u.searchParams.set('destination', loc(dest, region));
  if (dest.placeId) u.searchParams.set('destination_place_id', dest.placeId);
  // Google Maps erlaubt max. 9 Wegpunkte in URLs
  const wps = list.slice(0, 9);
  if (wps.length) u.searchParams.set('waypoints', wps.map((p) => loc(p, region)).join('|'));
  u.searchParams.set('travelmode', 'driving');
  return u.toString();
}
