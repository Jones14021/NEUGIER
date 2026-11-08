import type { Change, Op } from '@neugier/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const pendingWork = new Map<number, string>();
const workListeners = new Set<() => void>();
let workSequence = 0;
let workSnapshot = '';

export function subscribeWork(listener: () => void): () => void {
  workListeners.add(listener);
  return () => { workListeners.delete(listener); };
}

export function workStatus(): string { return workSnapshot; }

export function beginWork(label: string): () => void {
  const id = ++workSequence;
  pendingWork.set(id, label);
  workSnapshot = [...new Set(pendingWork.values())].join(' · ');
  workListeners.forEach((listener) => listener());
  return () => {
    pendingWork.delete(id);
    workSnapshot = [...new Set(pendingWork.values())].join(' · ');
    workListeners.forEach((listener) => listener());
  };
}

function workLabel(path: string): string {
  if (path.startsWith('/maps/route')) return 'Routen und Fahrzeiten werden geladen';
  if (path.startsWith('/maps/search')) return 'Orte werden gesucht';
  if (path.startsWith('/maps/resolve-share')) return 'Kartenlink wird aufgelöst';
  if (path.includes('/import/')) return 'Import wird verarbeitet';
  if (path.includes('/chat')) return 'KI antwortet';
  if (path.startsWith('/uploads')) return 'Fotos werden hochgeladen';
  return '';
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const label = workLabel(path);
  const end = label ? beginWork(label) : undefined;
  try {
    const r = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    credentials: 'same-origin',
  });
    const isJson = r.headers.get('content-type')?.includes('json');
    const data = isJson ? await r.json() : await r.text();
    if (!r.ok) throw new ApiError((data as { error?: string })?.error ?? String(data) ?? r.statusText, r.status);
    return data as T;
  } finally { end?.(); }
}

export function sendOps(tripId: string, ops: Op[], label: string, source: 'user' | 'ai' = 'user') {
  return api<{ changes: Change[] }>(`/trips/${tripId}/ops`, { body: { ops, label, source } });
}

export async function uploadPhotos(files: FileList | File[]): Promise<string[]> {
  const form = new FormData();
  for (const f of Array.from(files)) form.append('photos', f);
  return api<string[]>('/uploads', { form });
}
