import crypto from 'node:crypto';
import type { PlaceResult, RouteLeg, RouteResult, Stop } from '@neugier/shared';
import { config } from './config';
import { db } from './db';
import { applyOps, getEntity, getState } from './store';

type Pt = Pick<Stop, 'name' | 'lat' | 'lng' | 'placeId' | 'address'> & { routeBreakBefore?: boolean };

function waypoint(p: Pt, region: string) {
  if (p.lat != null && p.lng != null) return { location: { latLng: { latitude: p.lat, longitude: p.lng } } };
  if (p.placeId) return { placeId: p.placeId };
  return { address: [p.address || p.name, region].filter(Boolean).join(', ') };
}

function coords(p: Pt): { lat: number; lng: number }[] {
  return p.lat != null && p.lng != null ? [{ lat: p.lat, lng: p.lng }] : [];
}

/** Eine Etappe A→B über die Google Routes API (gecacht). null = keine Straßenroute (z. B. Flug). */
async function computeLeg(a: Pt, b: Pt, region: string): Promise<RouteLeg | null> {
  const wa = waypoint(a, region);
  const wb = waypoint(b, region);
  const hash = crypto.createHash('sha1').update(JSON.stringify(['leg', wa, wb])).digest('hex');
  const cached = db.prepare('SELECT data FROM route_cache WHERE hash = ?').get(hash) as { data: string } | undefined;
  if (cached) return JSON.parse(cached.data);

  const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': config.mapsServerKey,
      'X-Goog-FieldMask': 'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration',
    },
    body: JSON.stringify({ origin: wa, destination: wb, travelMode: 'DRIVE', languageCode: 'de' }),
  });
  if (!r.ok) {
    console.warn('Routes API', r.status, (await r.text()).slice(0, 200));
    return null;
  }
  const data = (await r.json()) as {
    routes?: { polyline: { encodedPolyline: string }; distanceMeters?: number; duration?: string }[];
  };
  const route = data.routes?.[0];
  const leg: RouteLeg | null = route
    ? { distanceMeters: route.distanceMeters ?? 0, durationSec: parseInt(route.duration ?? '0'), path: decodePolyline(route.polyline.encodedPolyline) }
    : null;
  // Auch "keine Route" cachen, damit z. B. Flugetappen nicht immer wieder angefragt werden
  db.prepare('INSERT OR REPLACE INTO route_cache (hash, data) VALUES (?, ?)').run(hash, JSON.stringify(leg));
  return leg;
}

/**
 * Route über alle Punkte, etappenweise berechnet. Etappen ohne Straßenroute werden als Luftlinie
 * (durationSec = 0, distanceMeters = 0) geliefert; `fallback` = mindestens eine Etappe ohne echte Route.
 */
export async function computeRoute(points: Pt[], region: string): Promise<RouteResult> {
  if (points.length < 2) return { path: points.flatMap(coords), legs: [], fallback: true };
  const pairs = points.slice(1).map((b, i) => [points[i], b] as const);
  const legs: RouteLeg[] = [];
  let fallback = !config.mapsServerKey;
  // Begrenzte Parallelität, um API-Limits zu schonen
  for (let i = 0; i < pairs.length; i += 6) {
    const chunk = await Promise.all(
      pairs.slice(i, i + 6).map(async ([a, b]) => b.routeBreakBefore
        ? { distanceMeters: 0, durationSec: 0, path: [] }
        : (config.mapsServerKey ? computeLeg(a, b, region).catch(() => null) : null)),
    );
    chunk.forEach((leg, j) => {
      const [a, b] = pairs[i + j];
      if (!leg) fallback = true;
      legs.push(leg ?? { distanceMeters: 0, durationSec: 0, path: [...coords(a), ...coords(b)] });
    });
  }
  return { path: legs.flatMap((l) => l.path ?? []), legs, fallback };
}

const geoRunning = new Set<string>();
const geoAgain = new Set<string>();

/**
 * Ergänzt Koordinaten für Stopps ohne lat/lng (z. B. nach Adressänderung oder Import).
 * Läuft im Hintergrund; Ergebnis kommt per Live-Update bei allen Clients an.
 */
export async function geocodeMissing(tripId: string): Promise<void> {
  if (!config.mapsServerKey) return;
  if (geoRunning.has(tripId)) {
    geoAgain.add(tripId);
    return;
  }
  geoRunning.add(tripId);
  try {
    const state = getState(tripId);
    if (!state) return;
    for (const s of state.stops.filter((x) => x.lat == null && !x.geoFailed && (x.address || x.name))) {
      if (!s.address && s.kind !== 'transport' && /^(restday|reisetag|reise\s*&\s*strandtag|strand(?:tag)?\b|größere wanderung|fahrt zu einer weiteren bucht|dumpling essen)/i.test(s.name.trim())) {
        applyOps(tripId, [{ op: 'update', type: 'stop', id: s.id, patch: { geoFailed: true } }], {
          userName: 'Google Maps', userId: '', source: 'user', label: `Ort nicht eindeutig: ${s.name}`,
        });
        continue;
      }
      const q = [s.address || s.name, s.kind === 'transport' ? '' : state.trip.region].filter(Boolean).join(', ');
      let hit: PlaceResult | undefined;
      try {
        [hit] = await searchPlaces(q);
      } catch (error) {
        console.warn('Geokodierung unterbrochen:', (error as Error).message);
        break;
      }
      const current = getEntity('stop', s.id) as Stop | null;
      if (!current || current.lat != null || current.lng != null || current.name !== s.name || current.address !== s.address) continue;
      const patch = hit
        ? { lat: hit.lat, lng: hit.lng, placeId: hit.placeId, address: s.address || hit.address, geoFailed: false }
        : { geoFailed: true };
      applyOps(tripId, [{ op: 'update', type: 'stop', id: s.id, patch }], {
        userName: 'Google Maps',
        userId: '',
        source: 'user',
        label: hit ? `Koordinaten ergänzt: ${s.name}` : `Ort nicht gefunden: ${s.name}`,
      });
    }
  } finally {
    geoRunning.delete(tripId);
    if (geoAgain.delete(tripId)) void geocodeMissing(tripId);
  }
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
    throw new Error(`Places API: HTTP ${r.status}`);
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
