import { useMemo, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import type { ProposedChange, Stop, TripState } from '@neugier/shared';
import { applyOpsLocal, dayStops, fmtDate, hasCoords, KIND_ICON, KIND_LABEL, newId, proposalToOps, sortedDays } from '@neugier/shared';
import { MapView, type MapMarker, type MapPath } from './MapView';
import { StopEditor } from './StopEditor';

type Decision = 'accept' | 'reject';

const ACTION_LABEL = { add: 'Neu', update: 'Ändern', move: 'Verschieben', remove: 'Entfernen' } as const;

/**
 * Diff-Ansicht für KI-Vorschläge: pro Vorschlag annehmen/ablehnen/ändern,
 * Vorschau der betroffenen Tage (vorher/nachher) als Liste und auf der Karte.
 */
export function ProposalDiff({
  state,
  proposal,
  onApply,
  onCancel,
}: {
  state: TripState;
  proposal: ProposedChange[];
  onApply: (changes: ProposedChange[]) => void;
  onCancel: () => void;
}) {
  const [changes, setChanges] = useState(proposal);
  const [dec, setDec] = useState<Decision[]>(proposal.map(() => 'accept'));
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const accepted = changes.filter((_, i) => dec[i] === 'accept');
  const after = useMemo(() => applyOpsLocal(state, proposalToOps(state, accepted)), [state, accepted]);
  const stopName = (id: string) => state.stops.find((s) => s.id === id)?.name ?? id;

  // Betroffene Tage (vorher und nachher)
  const affected = useMemo(() => {
    const ids = new Set<string>();
    const byDate = new Map(state.days.map((d) => [d.date, d.id]));
    for (const c of changes) {
      if ((c.action === 'add' || c.action === 'move') && c.date) ids.add(byDate.get(c.date) ?? '');
      if (c.action !== 'add') {
        const s = state.stops.find((x) => x.id === c.stopId);
        if (s?.dayId) ids.add(s.dayId);
      }
    }
    return sortedDays(state.days.filter((d) => ids.has(d.id)));
  }, [changes, state]);

  const { markers, paths } = useMemo(() => {
    const markers: MapMarker[] = [];
    const paths: MapPath[] = [];
    for (const d of affected) {
      const before = dayStops(state.stops, d.id).filter(hasCoords);
      const now = dayStops(after.stops, d.id).filter(hasCoords);
      const beforeIds = new Set(before.map((s) => s.id));
      const nowIds = new Set(now.map((s) => s.id));
      if (before.length > 1) paths.push({ id: `b-${d.id}`, path: before, color: '#94a3b8', dashed: true, weight: 3 });
      if (now.length > 1) paths.push({ id: `a-${d.id}`, path: now, color: '#2563eb', weight: 4 });
      for (const s of now)
        markers.push({ id: s.id, lat: s.lat, lng: s.lng, label: beforeIds.has(s.id) ? KIND_ICON[s.kind] : '+', color: beforeIds.has(s.id) ? '#64748b' : '#16a34a', title: s.name, active: !beforeIds.has(s.id) });
      for (const s of before)
        if (!nowIds.has(s.id)) markers.push({ id: s.id, lat: s.lat, lng: s.lng, label: '−', color: '#dc2626', title: `${s.name} (entfernt)` });
    }
    return { markers, paths };
  }, [affected, state.stops, after.stops]);

  const editStop = (i: number): Stop | null => {
    const c = changes[i];
    if (c.action !== 'add') return null;
    return { id: newId(), dayId: null, order: 0, links: [], booking: '', time: '', duration: '', ...c.stop } as Stop;
  };

  return (
    <div className="diff">
      <div className="diff-map">
        <MapView markers={markers} paths={paths} fitKey={`diff-${markers.length}`} />
      </div>

      <div className="stack">
        {changes.map((c, i) => (
          <div key={i} className={`diff-item ${dec[i]}`}>
            <span className={`badge ${c.action === 'add' ? 'green' : c.action === 'remove' ? 'red' : 'orange'}`}>{ACTION_LABEL[c.action]}</span>
            <div className="grow small">
              {c.action === 'add' && (
                <>
                  <strong>
                    {KIND_ICON[c.stop.kind] ?? '•'} {c.stop.name}
                  </strong>{' '}
                  ({KIND_LABEL[c.stop.kind] ?? c.stop.kind}, {c.stop.scope === 'main' ? 'Hauptroute' : 'Tagesroute'}) →{' '}
                  {c.date ? fmtDate(c.date) : 'Ideen-Pool'}
                  {c.afterStopId && <> nach „{stopName(c.afterStopId)}"</>}
                  {c.stop.notes && <div className="muted">{c.stop.notes}</div>}
                </>
              )}
              {c.action === 'update' && (
                <>
                  <strong>{stopName(c.stopId)}</strong>:{' '}
                  {Object.entries(c.patch).map(([k, v]) => (
                    <span key={k}>
                      {k} → „{String(v)}"{' '}
                    </span>
                  ))}
                </>
              )}
              {c.action === 'move' && (
                <>
                  <strong>{stopName(c.stopId)}</strong> → {c.date ? fmtDate(c.date) : 'Ideen-Pool'}
                </>
              )}
              {c.action === 'remove' && <strong className="strike">{stopName(c.stopId)}</strong>}
              {c.reason && <div className="muted">💡 {c.reason}</div>}
            </div>
            <div className="diff-actions">
              <button className={`icon-btn${dec[i] === 'accept' ? ' sel-green' : ''}`} title="Annehmen" onClick={() => setDec(dec.map((d, j) => (j === i ? 'accept' : d)))}>
                <Check size={16} />
              </button>
              <button className={`icon-btn${dec[i] === 'reject' ? ' sel-red' : ''}`} title="Ablehnen" onClick={() => setDec(dec.map((d, j) => (j === i ? 'reject' : d)))}>
                <X size={16} />
              </button>
              {c.action === 'add' && (
                <button className="icon-btn" title="Ändern" onClick={() => setEditIdx(i)}>
                  <Pencil size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {affected.map((d) => {
        const before = dayStops(state.stops, d.id);
        const now = dayStops(after.stops, d.id);
        const nowIds = new Set(now.map((s) => s.id));
        const beforeById = new Map(before.map((s) => [s.id, s]));
        return (
          <div key={d.id} className="diff-day">
            <div className="small muted">
              {fmtDate(d.date)} · {d.title}
            </div>
            <div className="diff-cols">
              <div>
                <div className="small muted">Vorher</div>
                {before.map((s) => (
                  <div key={s.id} className={`diff-stop${nowIds.has(s.id) ? '' : ' removed'}`}>
                    {KIND_ICON[s.kind]} {s.name}
                  </div>
                ))}
              </div>
              <div>
                <div className="small muted">Nachher</div>
                {now.map((s) => {
                  const b = beforeById.get(s.id);
                  const cls = !b ? ' added' : JSON.stringify({ ...b, order: 0 }) !== JSON.stringify({ ...s, order: 0 }) ? ' changed' : '';
                  return (
                    <div key={s.id} className={`diff-stop${cls}`}>
                      {KIND_ICON[s.kind]} {s.name}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}

      <div className="row">
        <button className="btn" onClick={onCancel}>
          Alle ablehnen
        </button>
        <span className="grow" />
        <button className="btn primary" disabled={!accepted.length} onClick={() => onApply(accepted)}>
          {accepted.length} Änderung{accepted.length === 1 ? '' : 'en'} übernehmen
        </button>
      </div>

      {editIdx != null && editStop(editIdx) && (
        <StopEditor
          stop={editStop(editIdx)!}
          isNew={false}
          onClose={() => setEditIdx(null)}
          onSave={(s) => {
            setChanges(changes.map((c, j) => (j === editIdx && c.action === 'add' ? { ...c, stop: { ...c.stop, ...s } } : c)));
            setEditIdx(null);
          }}
        />
      )}
    </div>
  );
}
