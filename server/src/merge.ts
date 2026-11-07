import type { AnyEntity, EntityType, Op, TripState, TypedEntity } from '@neugier/shared';
import { newId } from '@neugier/shared';
import { db } from './db';

/** Präfix für Referenzen auf andere importierte Objekte (über deren `key`). */
export const REF = '@key:';

const META = new Set(['id', 'key', 'updatedAt', 'updatedBy']);
const REF_FIELDS = new Set(['dayId', 'stopId', 'targetId']);

export type Pick = 'incoming' | 'current';

export interface FieldDiff {
  field: string;
  base: unknown;
  current: unknown;
  incoming: unknown;
  /** Automatisch entschieden (null = Konflikt, Nutzer muss wählen). */
  auto: Pick | null;
}

export interface MergeItem {
  key: string;
  type: EntityType;
  label: string;
  status: 'new' | 'update' | 'conflict' | 'removed' | 'deleted-local';
  fields: FieldDiff[];
}

export interface MergePlan {
  items: MergeItem[];
  unchanged: number;
}

export interface Resolution {
  /** key -> field -> Auswahl (überschreibt `auto`). */
  fields?: Record<string, Record<string, Pick>>;
  /** key -> übernehmen? (für new / removed / deleted-local) */
  accept?: Record<string, boolean>;
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function all(state: TripState): TypedEntity[] {
  return [
    ...state.days.map((data) => ({ type: 'day' as const, data })),
    ...state.stops.map((data) => ({ type: 'stop' as const, data })),
    ...state.expenses.map((data) => ({ type: 'expense' as const, data })),
    ...state.memories.map((data) => ({ type: 'memory' as const, data })),
    ...state.comments.map((data) => ({ type: 'comment' as const, data })),
  ];
}

function keyOf(e: AnyEntity): string {
  return e.key || `id:${e.id}`;
}

function labelOf(t: TypedEntity): string {
  const d = t.data as unknown as Record<string, unknown>;
  return String(d.name ?? d.title ?? d.date ?? d.text ?? keyOf(t.data)).slice(0, 80);
}

function loadBase(tripId: string, source: string): Map<string, TypedEntity> {
  const rows = db.prepare('SELECT key, type, data FROM import_base WHERE trip_id = ? AND source = ?').all(tripId, source) as {
    key: string;
    type: EntityType;
    data: string;
  }[];
  return new Map(rows.map((r) => [r.key, { type: r.type, data: JSON.parse(r.data) }]));
}

/**
 * 3-Wege-Vergleich: Basis (letzter Import) / aktueller Stand / neue Datei.
 * - nur in Datei geändert  -> Datei übernehmen
 * - nur lokal geändert     -> lokal behalten
 * - beides geändert        -> Konflikt (manuell lösen)
 */
export function planMerge(state: TripState, incoming: TypedEntity[], source: string): MergePlan {
  const base = loadBase(state.trip.id, source);
  const current = new Map(all(state).map((t) => [keyOf(t.data), t]));
  const items: MergeItem[] = [];
  let unchanged = 0;
  const seen = new Set<string>();

  for (const inc of incoming) {
    const key = keyOf(inc.data);
    seen.add(key);
    const cur = current.get(key);
    const b = base.get(key);
    if (!cur) {
      items.push({
        key,
        type: inc.type,
        label: labelOf(inc),
        status: b ? 'deleted-local' : 'new',
        fields: [],
      });
      continue;
    }
    const fields: FieldDiff[] = [];
    const curData = resolveRefsToKeys(cur.data, state) as unknown as Record<string, unknown>;
    const incData = inc.data as unknown as Record<string, unknown>;
    const baseData = b?.data as unknown as Record<string, unknown> | undefined;
    for (const field of Object.keys(incData)) {
      if (META.has(field)) continue;
      const vi = incData[field];
      const vc = curData[field];
      if (eq(vi, vc)) continue;
      const vb = baseData?.[field];
      let auto: Pick | null = null;
      if (baseData && eq(vc, vb)) auto = 'incoming';
      else if (baseData && eq(vi, vb)) auto = 'current';
      fields.push({ field, base: vb, current: vc, incoming: vi, auto });
    }
    const relevant = fields.filter((f) => f.auto !== 'current');
    if (!relevant.length) {
      unchanged++;
      continue;
    }
    items.push({
      key,
      type: inc.type,
      label: labelOf(inc),
      status: fields.some((f) => f.auto === null) ? 'conflict' : 'update',
      fields,
    });
  }

  for (const [key, b] of base) {
    if (seen.has(key) || !current.has(key)) continue;
    items.push({ key, type: b.type, label: labelOf(b), status: 'removed', fields: [] });
  }

  return { items, unchanged };
}

/** Ersetzt echte IDs in Referenzfeldern durch `@key:`-Referenzen (für den Vergleich). */
function resolveRefsToKeys(e: AnyEntity, state: TripState): AnyEntity {
  const keyById = new Map(all(state).map((t) => [t.data.id, keyOf(t.data)]));
  const out = { ...e } as unknown as Record<string, unknown>;
  for (const f of REF_FIELDS) {
    const v = out[f];
    if (typeof v === 'string' && keyById.get(v)) out[f] = `${REF}${keyById.get(v)}`;
  }
  return out as unknown as AnyEntity;
}

/** Wandelt eine eigene JSON-Exportdatei in importierbare Objekte mit `@key:`-Referenzen um. */
export function fromExport(entities: TypedEntity[]): TypedEntity[] {
  const keyById = new Map(entities.map((t) => [t.data.id, keyOf(t.data)]));
  return entities.map((t) => {
    const data = { ...t.data } as unknown as Record<string, unknown>;
    for (const f of REF_FIELDS) {
      const v = data[f];
      if (typeof v === 'string' && keyById.has(v)) data[f] = `${REF}${keyById.get(v)}`;
    }
    return { type: t.type, data: data as unknown as AnyEntity };
  });
}

/** Erzeugt die Operationen aus Plan + Entscheidungen und aktualisiert die Import-Basis. */
export function buildMergeOps(
  state: TripState,
  incoming: TypedEntity[],
  plan: MergePlan,
  res: Resolution,
  source: string,
): Op[] {
  const current = new Map(all(state).map((t) => [keyOf(t.data), t]));
  const idByKey = new Map<string, string>();
  for (const [k, t] of current) idByKey.set(k, t.data.id);

  const incByKey = new Map(incoming.map((t) => [keyOf(t.data), t]));

  // Neue Objekte bekommen vorab IDs, damit Referenzen aufgelöst werden können
  for (const item of plan.items) {
    if ((item.status === 'new' || item.status === 'deleted-local') && accepted(item, res)) {
      const inc = incByKey.get(item.key)!;
      idByKey.set(item.key, inc.data.id && !inc.data.id.startsWith(REF) ? inc.data.id : newId());
    }
  }

  const deref = (v: unknown): unknown =>
    typeof v === 'string' && v.startsWith(REF) ? (idByKey.get(v.slice(REF.length)) ?? null) : v;

  const ops: Op[] = [];
  for (const item of plan.items) {
    const inc = incByKey.get(item.key);
    if (item.status === 'removed') {
      if (res.accept?.[item.key]) ops.push({ op: 'delete', type: item.type, id: idByKey.get(item.key)! });
      continue;
    }
    if (!inc) continue;
    if (item.status === 'new' || item.status === 'deleted-local') {
      if (!accepted(item, res)) continue;
      const data = { ...inc.data, id: idByKey.get(item.key)! } as unknown as Record<string, unknown>;
      for (const f of REF_FIELDS) if (f in data) data[f] = deref(data[f]);
      ops.push({ op: 'create', type: item.type, data: data as unknown as AnyEntity });
      continue;
    }
    const patch: Record<string, unknown> = {};
    for (const f of item.fields) {
      const choice = res.fields?.[item.key]?.[f.field] ?? f.auto ?? 'current';
      if (choice === 'incoming') patch[f.field] = REF_FIELDS.has(f.field) ? deref(f.incoming) : f.incoming;
    }
    if (Object.keys(patch).length) ops.push({ op: 'update', type: item.type, id: idByKey.get(item.key)!, patch });
  }

  // Basis = komplette neue Datei (auch abgelehnte Änderungen gelten als "gesehen")
  const tripId = state.trip.id;
  db.prepare('DELETE FROM import_base WHERE trip_id = ? AND source = ?').run(tripId, source);
  const ins = db.prepare('INSERT INTO import_base (trip_id, source, key, type, data) VALUES (?, ?, ?, ?, ?)');
  for (const t of incoming) ins.run(tripId, source, keyOf(t.data), t.type, JSON.stringify(t.data));

  return ops;
}

function accepted(item: MergeItem, res: Resolution): boolean {
  // Neue Objekte standardmäßig übernehmen, lokal gelöschte standardmäßig nicht
  return res.accept?.[item.key] ?? item.status === 'new';
}
