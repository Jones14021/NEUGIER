import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Plus, RotateCcw, Sparkles, X } from 'lucide-react';
import type { ChatResponse, Op, ProposedChange, Stop, TripState } from '@neugier/shared';
import {
  applyOpsLocal,
  dayCamp,
  diffPlans,
  fmtDate,
  fmtHours,
  hasCoords,
  insertDayOps,
  moveStopOps,
  newId,
  proposalToOps,
  removeDayOps,
  sortedDays,
  type PlanChange,
} from '@neugier/shared';
import { api } from '../api';
import { useDayMap } from '../components/DayMap';
import { MapView } from '../components/MapView';
import { ProposalDiff } from '../components/ProposalDiff';
import { RichTextView } from '../components/RichText';
import { StopEditor } from '../components/StopEditor';
import { StopList } from '../components/StopList';
import { findToday, legsByDest, useRoute } from '../hooks';
import { useTrip } from '../store';

const KEY = 'neugier.playground';

/**
 * Spielplatz: Kopie der Planung, in der man frei Stopps/Tage ändert und sofort sieht,
 * wie sich Fahrzeiten verschieben. Übernahme in die echte Planung einzeln oder komplett.
 */
export function Playground() {
  const { state: real, apply, toast, config } = useTrip();
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState<TripState>(() => {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as TripState | null;
    return saved && saved.trip.id === real.trip.id ? saved : real;
  });
  const [edit, setEdit] = useState<{ stop: Stop; isNew: boolean } | null>(null);
  const [review, setReview] = useState<{ busy: boolean; res?: ChatResponse; error?: string } | null>(null);
  const [showApply, setShowApply] = useState(false);

  useEffect(() => sessionStorage.setItem(KEY, JSON.stringify(draft)), [draft]);

  const days = useMemo(() => sortedDays(draft.days), [draft.days]);
  const dayId = params.get('tag') ?? findToday(days)?.id ?? days[0]?.id;
  const idx = days.findIndex((d) => d.id === dayId);
  const day = days[idx];
  const dm = useDayMap(draft, day, null, true);
  const changes = useMemo(() => diffPlans(real, draft), [real, draft]);

  const change = (ops: Op[]) => setDraft((d) => applyOpsLocal(d, ops));
  const goto = (id: string) => setParams({ tag: id }, { replace: true });

  const dragStop = (id: string, p: { lat: number; lng: number }) =>
    change([{ op: 'update', type: 'stop', id, patch: { lat: p.lat, lng: p.lng, placeId: undefined, address: `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` } }]);

  const checkWithAi = async () => {
    setReview({ busy: true });
    try {
      const res = await api<ChatResponse>(`/trips/${real.trip.id}/chat`, {
        body: {
          mode: 'review',
          dayId: day?.id,
          state: draft,
          messages: [{ role: 'user', content: `Prüfe meinen Spielplatz-Entwurf${day ? `, Fokus auf ${day.date} (${day.title}) und die Tage davor/danach` : ''}. Was kann ich verbessern?` }],
        },
      });
      setReview({ busy: false, res });
    } catch (e) {
      setReview({ busy: false, error: (e as Error).message });
    }
  };

  const applyAll = async (selected: PlanChange[]) => {
    await apply(
      selected.map((c) => c.op),
      `Spielplatz übernommen (${selected.length})`,
    );
    setShowApply(false);
    toast('In die Planung übernommen – rückgängig über die Historie');
  };

  if (!day) return <div className="center muted">Keine Tage</div>;

  const newStop = (): Stop => ({
    id: newId(),
    dayId: day.id,
    order: dm.stops.length,
    scope: 'day',
    kind: 'other',
    name: '',
    notes: '',
    time: '',
    duration: '',
    links: [],
    booking: '',
  });

  return (
    <div className="split">
      <MapView markers={dm.markers} paths={dm.paths} labels={dm.labels} fitKey={`pg-${day.id}-${dm.markers.length}`} onMarkerDrag={dragStop}>
        <div className="map-actions">
          <span className="chip playground-chip">🧪 Spielplatz – nicht gespeichert</span>
        </div>
      </MapView>

      <div className="panel">
        <div className="day-nav">
          <button className="icon-btn" disabled={idx <= 0} onClick={() => goto(days[idx - 1].id)}>
            <ChevronLeft size={22} />
          </button>
          <div className="grow center-text">
            <div className="small muted">
              Spielplatz · Tag {idx + 1} · {fmtDate(day.date)}
            </div>
            <input className="day-title-input" value={day.title} onChange={(e) => change([{ op: 'update', type: 'day', id: day.id, patch: { title: e.target.value } }])} />
          </div>
          <button className="icon-btn" disabled={idx >= days.length - 1} onClick={() => goto(days[idx + 1].id)}>
            <ChevronRight size={22} />
          </button>
        </div>

        <div className="panel-scroll">
          <div className="pg-bar">
            <button className="btn small primary" disabled={!changes.length} onClick={() => setShowApply(true)}>
              <Check size={14} /> Übernehmen ({changes.length})
            </button>
            <button className="btn small" disabled={!config.llmConfigured || review?.busy} onClick={checkWithAi} title={config.llmConfigured ? '' : 'Kein KI-Key hinterlegt'}>
              <Sparkles size={14} /> {review?.busy ? 'KI prüft …' : 'Vorschlag mit KI prüfen'}
            </button>
            <button className="btn small" disabled={!changes.length} onClick={() => confirm('Spielplatz auf echte Planung zurücksetzen?') && setDraft(real)}>
              <RotateCcw size={14} /> Zurücksetzen
            </button>
          </div>

          <Timeline draft={draft} real={real} activeDay={day.id} onSelect={goto} />

          <p className="small muted">
            {dm.totalSec > 0 ? `🚐 ${fmtHours(dm.totalSec)} Fahrzeit an diesem Tag` : dm.loading ? 'Fahrzeiten werden berechnet …' : ''}
            {' · '}Pins ziehen, Stopps umsortieren, Cafés einfügen – alles nur hier.
          </p>

          {dm.start && (
            <div className="stop start">
              <span className="stop-icon" style={{ background: '#64748b' }}>
                ⌂
              </span>
              <div className="grow">
                <div className="small muted">Start (Übernachtung Vortag)</div>
                <div>{dm.start.name}</div>
              </div>
            </div>
          )}
          <StopList
            stops={dm.stops}
            region={draft.trip.region}
            legs={dm.legs}
            canEdit
            onReorder={(id, to) => change(moveStopOps(draft.stops, id, day.id, to))}
            onEdit={(s) => setEdit({ stop: s, isNew: false })}
            onDelete={(s) => change([{ op: 'delete', type: 'stop', id: s.id }])}
          />
          <div className="row wrap">
            <button className="btn" onClick={() => setEdit({ stop: newStop(), isNew: true })}>
              <Plus size={16} /> Stopp / Café
            </button>
            <button className="btn" onClick={() => change(insertDayOps(draft, day.id).ops)}>
              <Plus size={16} /> Tag danach
            </button>
            <button className="btn danger" onClick={() => change(removeDayOps(draft, day.id))}>
              Tag entfernen
            </button>
          </div>

          {review && !review.busy && (
            <div className="card ai-review">
              <div className="row">
                <strong className="grow">✨ KI-Prüfung</strong>
                <button className="icon-btn" onClick={() => setReview(null)}>
                  <X size={16} />
                </button>
              </div>
              {review.error && <p className="error small">{review.error}</p>}
              {review.res && <RichTextView text={review.res.content} className="small" />}
              {review.res?.sources.length ? (
                <div className="sources small">
                  {review.res.sources.map((s) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                      {s.title || s.url}
                    </a>
                  ))}
                </div>
              ) : null}
              {review.res && review.res.proposal.length > 0 && (
                <ProposalDiff
                  state={draft}
                  proposal={review.res.proposal}
                  applyLabel="In den Spielplatz übernehmen"
                  onApply={(c: ProposedChange[]) => {
                    change(proposalToOps(draft, c));
                    setReview(null);
                    toast('KI-Vorschlag im Spielplatz übernommen – prüfen und dann in die Planung übernehmen');
                  }}
                  onCancel={() => setReview(null)}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {edit && (
        <StopEditor
          stop={edit.stop}
          isNew={edit.isNew}
          bias={dm.routePts[0]}
          onSave={(s) => {
            change([edit.isNew ? { op: 'create', type: 'stop', data: s } : { op: 'put', type: 'stop', data: s }]);
            setEdit(null);
            // Ohne Koordinaten: im Spielplatz direkt per Google suchen (Server speichert nichts)
            if (s.lat == null) {
              api<{ lat: number; lng: number; placeId: string; address: string }[]>(
                `/maps/search?${new URLSearchParams({ q: [s.address || s.name, draft.trip.region].join(', ') })}`,
              )
                .then(([hit]) => hit && change([{ op: 'update', type: 'stop', id: s.id, patch: { lat: hit.lat, lng: hit.lng, placeId: hit.placeId, address: s.address || hit.address } }]))
                .catch(() => {});
            }
          }}
          onDelete={edit.isNew ? undefined : () => (change([{ op: 'delete', type: 'stop', id: edit.stop.id }]), setEdit(null))}
          onClose={() => setEdit(null)}
        />
      )}
      {showApply && <ApplyDialog changes={changes} onApply={applyAll} onClose={() => setShowApply(false)} />}
    </div>
  );
}

/** Fahrzeiten aller Tage: echte Planung vs. Spielplatz (zeigt, wie sich alles verschiebt). */
function Timeline({ draft, real, activeDay, onSelect }: { draft: TripState; real: TripState; activeDay: string; onSelect: (id: string) => void }) {
  const legs = useOvernightLegs(draft);
  const realLegs = useOvernightLegs(real);
  const days = sortedDays(draft.days);
  const realDates = new Map(real.days.map((d) => [d.id, d.date]));
  return (
    <div className="timeline">
      {days.map((d, i) => {
        const sec = legs.get(d.id)?.durationSec ?? 0;
        const realSec = realLegs.get(d.id)?.durationSec ?? 0;
        const diff = sec - realSec;
        const shifted = realDates.has(d.id) && realDates.get(d.id) !== d.date;
        const isNew = !realDates.has(d.id);
        return (
          <button key={d.id} className={`tl-day${d.id === activeDay ? ' active' : ''}${isNew ? ' new' : ''}`} onClick={() => onSelect(d.id)} title={d.title}>
            <span className="tl-no">{i + 1}</span>
            <span className="tl-bar" style={{ height: `${Math.min(100, (sec / (6 * 3600)) * 100)}%` }} />
            <span className="tl-time">{sec ? fmtHours(sec) : '–'}</span>
            {Math.abs(diff) >= 300 && <span className={`tl-diff ${diff > 0 ? 'up' : 'down'}`}>{diff > 0 ? '+' : '−'}{fmtHours(Math.abs(diff))}</span>}
            {shifted && <span className="tl-diff shift">📅</span>}
          </button>
        );
      })}
    </div>
  );
}

function useOvernightLegs(s: TripState) {
  const pts = useMemo(
    () =>
      sortedDays(s.days).flatMap((d) => {
        const c = dayCamp(s.stops, d.id);
        return c && hasCoords(c) ? [{ ...c, id: d.id }] : [];
      }),
    [s.days, s.stops],
  );
  const route = useRoute(pts, s.trip.region);
  return useMemo(() => legsByDest(pts, route), [pts, route]);
}

function ApplyDialog({ changes, onApply, onClose }: { changes: PlanChange[]; onApply: (c: PlanChange[]) => void; onClose: () => void }) {
  const [sel, setSel] = useState(() => new Set(changes.map((c) => `${c.type}:${c.id}`)));
  const key = (c: PlanChange) => `${c.type}:${c.id}`;
  const selected = changes.filter((c) => sel.has(key(c)));
  const LABEL = { add: ['Neu', 'green'], remove: ['Entfernt', 'red'], change: ['Geändert', 'orange'] } as const;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Spielplatz in Planung übernehmen</h3>
          <button className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="stack">
          {changes.map((c) => (
            <label key={key(c)} className="check apply-row">
              <input
                type="checkbox"
                checked={sel.has(key(c))}
                onChange={(e) => {
                  const n = new Set(sel);
                  if (e.target.checked) n.add(key(c));
                  else n.delete(key(c));
                  setSel(n);
                }}
              />
              <span className={`badge ${LABEL[c.kind][1]}`}>{LABEL[c.kind][0]}</span>
              <span className="small muted">{c.type === 'day' ? 'Tag' : 'Stopp'}</span>
              <span className="grow">{c.label}</span>
            </label>
          ))}
        </div>
        <div className="modal-foot">
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" disabled={!selected.length} onClick={() => onApply(selected)}>
            {selected.length} übernehmen
          </button>
        </div>
      </div>
    </div>
  );
}
