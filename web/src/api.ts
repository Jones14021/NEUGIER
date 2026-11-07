import type { Change, Op } from '@neugier/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
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
}

export function sendOps(tripId: string, ops: Op[], label: string, source: 'user' | 'ai' = 'user') {
  return api<{ changes: Change[] }>(`/trips/${tripId}/ops`, { body: { ops, label, source } });
}

export async function uploadPhotos(files: FileList | File[]): Promise<string[]> {
  const form = new FormData();
  for (const f of Array.from(files)) form.append('photos', f);
  return api<string[]>('/uploads', { form });
}
