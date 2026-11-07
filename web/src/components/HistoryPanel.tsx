import { useEffect, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import type { Change, Stop } from '@neugier/shared';
import { api } from '../api';
import { useTrip } from '../store';

const SOURCE_LABEL: Record<Change['source'], string> = {
  user: '',
  ai: 'KI',
  import: 'Import',
  rollback: 'Rollback',
  seed: 'Start',
};

/**
 * Versionshistorie mit Rollback. Mit `entityId` nur für ein Objekt (einzelne Version wiederherstellen),
 * sonst als Liste von Batches (ganze Änderung rückgängig machen).
 */
export function HistoryPanel({ entityId, dayId, onClose }: { entityId?: string; dayId?: string; onClose: () => void }) {
  const { state, canEdit, toast } = useTrip();
  const [list, setList] = useState<Change[] | null>(null);

  const load = () =>
    api<Change[]>(`/trips/${state.trip.id}/history${entityId ? `?entityId=${entityId}` : ''}`).then(setList);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  const dayStopIds = dayId ? new Set(state.stops.filter((s) => s.dayId === dayId).map((s) => s.id)) : null;
  const relevant = (list ?? []).filter(
    (c) =>
      !dayStopIds ||
      c.entityId === dayId ||
      dayStopIds.has(c.entityId) ||
      (c.type === 'stop' && ((c.before as Stop | null)?.dayId === dayId || (c.after as Stop | null)?.dayId === dayId)),
  );

  // Für Gesamt-/Tageshistorie nach Batch gruppieren
  const groups = new Map<string, Change[]>();
  for (const c of relevant) groups.set(c.batchId, [...(groups.get(c.batchId) ?? []), c]);

  const rollback = async (body: { batchId?: string; changeId?: number }) => {
    if (!confirm('Diese Änderung zurücksetzen?')) return;
    try {
      await api(`/trips/${state.trip.id}/history/rollback`, { body });
      toast('Zurückgesetzt');
      load();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Versionshistorie</h3>
          <button className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {!list && <p className="muted">Lädt …</p>}
        {list && groups.size === 0 && <p className="muted">Keine Änderungen.</p>}
        <div className="history">
          {[...groups.values()].map((g) => {
            const c = g[0];
            return (
              <div key={c.batchId} className="history-item">
                <div className="grow">
                  <div className="small">
                    <strong>{c.label}</strong> {SOURCE_LABEL[c.source] && <span className="badge">{SOURCE_LABEL[c.source]}</span>}
                  </div>
                  <div className="small muted">
                    {c.userName} · {new Date(c.ts).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
                  </div>
                  <ul className="small diff-list">
                    {g.slice(0, 6).map((x) => (
                      <li key={x.id}>{describe(x)}</li>
                    ))}
                    {g.length > 6 && <li className="muted">… und {g.length - 6} weitere</li>}
                  </ul>
                </div>
                {canEdit && c.source !== 'seed' && (
                  <button
                    className="btn small"
                    title={entityId ? 'Diese Version wiederherstellen' : 'Änderung rückgängig machen'}
                    onClick={() => rollback(entityId ? { changeId: c.id } : { batchId: c.batchId })}
                  >
                    <RotateCcw size={14} /> {entityId ? 'Wiederherstellen' : 'Rückgängig'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function name(e: unknown): string {
  const d = e as Record<string, unknown> | null;
  return String(d?.name ?? d?.title ?? d?.text ?? d?.date ?? '').slice(0, 60);
}

function describe(c: Change): string {
  if (!c.before) return `+ ${name(c.after)}`;
  if (!c.after) return `− ${name(c.before)}`;
  const b = c.before as unknown as Record<string, unknown>;
  const a = c.after as unknown as Record<string, unknown>;
  const fields = Object.keys(a).filter(
    (k) => !['updatedAt', 'updatedBy'].includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]),
  );
  return `~ ${name(c.after)} (${fields.join(', ')})`;
}
