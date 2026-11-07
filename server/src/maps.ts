import crypto from 'node:crypto';
import type { PlaceResult, RouteResult, Stop } from '@neugier/shared';
import { config } from './config';
import { db } from './db';

type Pt = Pick<Stop, 'name' | 'lat' | 'lng' | 'placeId' | 'address'>;

function waypoint(p: Pt, region: string) {
  if (p.lat != null && p.lng != null) return { location: { latLng: { latitude: p.lat, longitude: p.lng } } };
  if (p.placeId) return { placeId: p.placeId };
  return { address: [p.address || p.name, region].filter(Boolean).join(', ') };
}

/** Routenberechnung über die Google Routes API (mit Cache). Fallback: Luftlinie. */
export async function computeRoute(points: Pt[], region: string): Promise<RouteResult> {
  const straight = (): RouteResult => {
    const path = points.filter((p) => p.lat != null).map((p) => ({ lat: p.lat!, lng: p.lng! }));
    return { path, legs: [], fallback: true };
  };
  if (points.length < 2 || !config.mapsServerKey) return straight();

  const hash = crypto.createHash('sha1').update(JSON.stringify(points.map((p) => waypoint(p, region)))).digest('hex');
  const cached = db.prepare('SELECT data FROM route_cache WHERE hash = ?').get(hash) as { data: string } | undefined;
  if (cached) return JSON.parse(cached.data);

  const wps = points.map((p) => waypoint(p, region));
  const body = {
    origin: wps[0],
    destination: wps[wps.length - 1],
    intermediates: wps.slice(1, -1).slice(0, 25),
    travelMode: 'DRIVE',
    languageCode: 'de',
  };
  const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': config.mapsServerKey,
      'X-Goog-FieldMask': 'routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    console.warn('Routes API', r.status, await r.text());
    return straight();
  }
  const data = (await r.json()) as {
    routes?: { polyline: { encodedPolyline: string }; legs: { distanceMeters?: number; duration?: string }[] }[];
  };
  const route = data.routes?.[0];
  if (!route) return straight();
  const result: RouteResult = {
    path: decodePolyline(route.polyline.encodedPolyline),
    legs: route.legs.map((l) => ({ distanceMeters: l.distanceMeters ?? 0, durationSec: parseInt(l.duration ?? '0') })),
    fallback: false,
  };
  db.prepare('INSERT OR REPLACE INTO route_cache (hash, data) VALUES (?, ?)').run(hash, JSON.stringify(result));
  return result;
}

/** Ortssuche über Places API (New) – Text Search. */
export async function searchPlaces(q: string, bias?: { lat: number; lng: number }): Promise<PlaceResult[]> {
  if (!config.mapsServerKey || !q.trim()) return [];
  const body: Record<string, unknown> = { textQuery: q, languageCode: 'de', pageSize: 8 };
  if (bias) body.locationBias = { circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 50000 } };
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': config.mapsServerKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    console.warn('Places API', r.status, await r.text());
    return [];
  }
  const data = (await r.json()) as {
    places?: {
      id: string;
      displayName?: { text: string };
      formattedAddress?: string;
      location: { latitude: number; longitude: number };
      types?: string[];
    }[];
  };
  return (data.places ?? []).map((p) => ({
    placeId: p.id,
    name: p.displayName?.text ?? '',
    address: p.formattedAddress ?? '',
    lat: p.location.latitude,
    lng: p.location.longitude,
    types: p.types ?? [],
  }));
}

function decodePolyline(str: string): { lat: number; lng: number }[] {
  const out: { lat: number; lng: number }[] = [];
  let i = 0,
    lat = 0,
    lng = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0,
        result = 0,
        b: number;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d;
      else lng += d;
    }
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}
