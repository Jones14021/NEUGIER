import { openDB } from 'idb';
import type { RouteResult } from '@neugier/shared';

export interface CachedRoute {
  id: string;
  storedAt: number;
  freshUntil: number;
  result: RouteResult;
}

const MAX_ROUTES = 30;
const CLOCK_SKEW_TOLERANCE = 60_000;
const database = () => openDB('neugier-routes-v1', 1, {
  upgrade(db) { db.createObjectStore('routes', { keyPath: 'id' }); },
});

export function lastRouteReset(now: number): number {
  const reset = new Date(now);
  reset.setHours(2, 0, 0, 0);
  if (reset.getTime() > now) {
    reset.setDate(reset.getDate() - 1);
    reset.setHours(2, 0, 0, 0);
  }
  return reset.getTime();
}

export function nextRouteReset(now: number): number {
  const reset = new Date(now);
  reset.setHours(2, 0, 0, 0);
  if (reset.getTime() <= now) {
    reset.setDate(reset.getDate() + 1);
    reset.setHours(2, 0, 0, 0);
  }
  return reset.getTime();
}

export function routeCacheId(owner: string, key: string): string {
  return JSON.stringify([owner, key]);
}

export async function pruneRouteCache(now = Date.now()): Promise<void> {
  const db = await database();
  try {
    const transaction = db.transaction('routes', 'readwrite');
    const store = transaction.objectStore('routes');
    const routes = await store.getAll() as CachedRoute[];
    const valid = routes.filter((route) => route.storedAt >= lastRouteReset(now) && route.storedAt <= now + CLOCK_SKEW_TOLERANCE);
    valid.sort((first, second) => second.storedAt - first.storedAt);
    const keep = new Set(valid.slice(0, MAX_ROUTES).map((route) => route.id));
    for (const route of routes) if (!keep.has(route.id)) await store.delete(route.id);
    await transaction.done;
  } finally { db.close(); }
}

export async function readCachedRoute(owner: string, key: string, now = Date.now()): Promise<CachedRoute | undefined> {
  await pruneRouteCache(now);
  const db = await database();
  try {
    const route = await db.get('routes', routeCacheId(owner, key)) as CachedRoute | undefined;
    if (!route) return;
    return { ...route, result: { ...route.result, path: route.result.legs.flatMap((leg) => leg.path ?? []) } };
  } finally { db.close(); }
}

export function makeCachedRoute(owner: string, key: string, result: RouteResult, requestedAt: number, now = Date.now()): CachedRoute | undefined {
  if (result.fallback || result.stale || !Number.isFinite(result.cacheTtlMs) || result.cacheTtlMs! <= 0 || requestedAt > now || requestedAt < lastRouteReset(now)) return;
  const freshUntil = now + Math.max(0, result.cacheTtlMs! - (now - requestedAt));
  if (freshUntil <= now) return;
  return { id: routeCacheId(owner, key), storedAt: now, freshUntil, result };
}

export async function saveCachedRoute(owner: string, key: string, result: RouteResult, requestedAt: number, now = Date.now()): Promise<CachedRoute | undefined> {
  const route = makeCachedRoute(owner, key, result, requestedAt, now);
  if (!route) return;
  const db = await database();
  try { await db.put('routes', { ...route, result: { ...result, path: [] } }); }
  finally { db.close(); }
  await pruneRouteCache(now);
  return route;
}