import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  History,
  Lightbulb,
  Navigation,
  Pencil,
  Plus,
  ShowerHead,
} from 'lucide-react';
import type { Day, Op, ShowerStatus, Stop } from '@neugier/shared';
import {
  CAMP_LABEL,
  dayRoute,
  fmtDate,
  fmtDuration,
  fmtKm,
  hasCoords,
  KIND_COLOR,
  KIND_ICON,
  KIND_LABEL,
  newId,
  placeLink,
  routeLink,
  SHOWER_LABEL,
  sortedDays,
  todayIso,
} from '@neugier/shared';
import { Comments } from '../components/Comments';
import { HistoryPanel } from '../components/HistoryPanel';
import { MapView, type MapMarker, type MapPath } from '../components/MapView';
import { StopEditor } from '../components/StopEditor';
import { useRoute } from '../hooks';
import { useTrip } from '../store';

/** Tagesansicht: alle Stopps (Haupt- und Tagesroute) auf der Karte + Liste mit Navigation. */
export function DayPage() {
  const { dayId } = useParams();
  const { state, canEdit, apply, setFocusDay } = useTrip();
  const navigate = useNavigate();
  const days = useMemo(() => sortedDays(state.days), [state.days]);
  const idx = days.findIndex((d) => d.id === dayId);
  const day = days[idx];
  const [edit, setEdit] = useState<{ stop: Stop; isNew: boolean } | null>(null);
  const [history, setHistory] = useState<string | 'day' | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [showPool, setShowPool] = useState(false);

  useEffect(() => {
    setFocusDay(dayId ?? null);
    return () => setFocusDay(null);
  }, [dayId, setFocusDay]);

  const { start, stops } = useMemo(() => (day ? dayRoute(state, day) : { stops: [] as Stop[] }), [state, day]);
  const routePts = useMemo(() => [start, ...stops].filter((s): s is Stop => !!s), [start, stops]);
  const routed = useRoute(routePts.filter(hasCoords), state.trip.region);
  const mainPts = useMemo(
    () => [start, ...stops.filter((s) => s.scope === 'main')].filter((s): s is Stop & { lat: number; lng: number } => !!s && hasCoords(s)),
    [start, stops],
  );

  if (!day) return <div className="center muted">Tag nicht gefunden</div>;

  const markers: MapMarker[] = [];
  if (start && hasCoords(start)) {
    markers.push({ id: start.id, lat: start.lat, lng: start.lng, label: '⌂', color: '#64748b', title: `Start: ${start.name}`, muted: true });
  }
  stops.forEach((s, i) => {
    if (hasCoords(s)) {
      markers.push({
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        label: s.kind === 'campsite' ? '⛺' : String(i + 1),
        color: KIND_COLOR[s.kind],
        title: s.name,
        active: s.id === active,
        muted: s.scope === 'day' && s.kind === 'shower',
      });
    }
  });
  const paths: MapPath[] = [];
  if (routed) paths.push({ id: 'day', path: routed.path, color: '#2563eb', dashed: routed.fallback, weight: 5 });
  else if (mainPts.length > 1) paths.push({ id: 'main', path: mainPts, color: '#2f7d4f', dashed: true });

  const totalKm = routed?.legs.reduce((a, l) => a + l.distanceMeters, 0) ?? 0;
  const totalSec = routed?.legs.reduce((a, l) => a + l.durationSec, 0) ?? 0;
  const navAll = routeLink(routePts, state.trip.region);
  const navFromHere = routeLink(stops, state.trip.region, true);

  const updateDay = (patch: Partial<Day>, label = 'Tag bearbeitet') => apply([{ op: 'update', type: 'day', id: day.id, patch }], label);

  const move = (i: number, dir: -1 | 1) => {
    const list = [...stops];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const ops: Op[] = list.map((s, k) => ({ op: 'update', type: 'stop', id: s.id, patch: { order: k } }));
    apply(ops, `Reihenfolge geändert: ${list[j].name}`);
  };

  const saveStop = (s: Stop, isNew: boolean) => {
    apply([isNew ? { op: 'create', type: 'stop', data: s } : { op: 'put', type: 'stop', data: s }], `${isNew ? 'Stopp hinzugefügt' : 'Stopp bearbeitet'}: ${s.name}`);
    setEdit(null);
  };

  const addFromPool = (s: Stop) => {
    apply([{ op: 'update', type: 'stop', id: s.id, patch: { dayId: day.id, order: stops.length } }], `Aus Ideen-Pool eingeplant: ${s.name}`);
    setShowPool(false);
  };

  const newStop = (): Stop => ({
    id: newId(),
    dayId: day.id,
    order: stops.length,
    scope: 'day',
    kind: 'other',
    name: '',
    notes: '',
    time: '',
    duration: '',
    links: [],
    booking: '',
  });

  const bias = stops.find(hasCoords) ?? (start && hasCoords(start) ? start : undefined);
  const pool = state.stops.filter((s) => !s.dayId);
  const dayExpenses = state.expenses.filter((e) => e.dayId === day.id);

  return (
    <div className="split">
      <MapView markers={markers} paths={paths} fitKey={`day-${day.id}-${markers.length}`} onMarkerClick={setActive}>
        <div className="map-actions">
          {navAll && (
            <a className="chip primary" href={navAll} target="_blank" rel="noreferrer">
              <Navigation size={16} /> Tagesroute
            </a>
          )}
          {navFromHere && stops.length > 0 && (
            <a className="chip" href={navFromHere} target="_blank" rel="noreferrer">
              <Navigation size={16} /> Ab hier
            </a>
          )}
        </div>
      </MapView>

      <div className="panel">
        <div className="day-nav">
          <button className="icon-btn" disabled={idx <= 0} onClick={() => navigate(`/tag/${days[idx - 1].id}`)}>
            <ChevronLeft size={22} />
          </button>
          <div className="grow center-text">
            <div className="small muted">
              Tag {idx + 1} · {fmtDate(day.date)} {day.date === todayIso() && <span className="badge blue">Heute</span>}
            </div>
            <EditableText
              value={day.title}
              placeholder="Titel"
              className="day-title"
              disabled={!canEdit}
              onSave={(title) => updateDay({ title })}
            />
          </div>
          <button className="icon-btn" disabled={idx >= days.length - 1} onClick={() => navigate(`/tag/${days[idx + 1].id}`)}>
            <ChevronRight size={22} />
          </button>
        </div>

        <div className="panel-scroll">
          {(day.times || canEdit) && (
            <EditableText
              value={day.times}
              placeholder="Feste Termine (z. B. Fähre 08:45)"
              className="times accent small"
              disabled={!canEdit}
              onSave={(times) => updateDay({ times })}
            />
          )}

          {routed && !routed.fallback && totalKm > 0 && (
            <p className="small muted">
              🚐 {fmtKm(totalKm)} · {fmtDuration(totalSec)} Fahrzeit
            </p>
          )}

          <ShowerBox day={day} canEdit={canEdit} onSave={(shower) => updateDay({ shower }, 'Dusche geplant')} />

          <div className="section-head">
            <h3>Stopps</h3>
            <button className="icon-btn" title="Historie dieses Tages" onClick={() => setHistory('day')}>
              <History size={18} />
            </button>
          </div>

          {start && (
            <div className="stop start">
              <span className="stop-icon" style={{ background: '#64748b' }}>
                ⌂
              </span>
              <div className="grow">
                <div className="small muted">Start (Übernachtung Vortag)</div>
                <div>{start.name}</div>
              </div>
            </div>
          )}

          {stops.map((s, i) => (
            <StopRow
              key={s.id}
              stop={s}
              index={i}
              active={s.id === active}
              region={state.trip.region}
              prev={i === 0 ? start : stops[i - 1]}
              leg={routed && !routed.fallback ? routed.legs[(start ? 1 : 0) + i - 1] : undefined}
              canEdit={canEdit}
              onUp={() => move(i, -1)}
              onDown={() => move(i, 1)}
              onEdit={() => setEdit({ stop: s, isNew: false })}
              onHistory={() => setHistory(s.id)}
              onSelect={() => setActive(s.id)}
            />
          ))}
          {stops.length === 0 && <p className="muted small">Noch keine Stopps geplant.</p>}

          {canEdit && (
            <div className="row wrap">
              <button className="btn" onClick={() => setEdit({ stop: newStop(), isNew: true })}>
                <Plus size={16} /> Stopp
              </button>
              <button className="btn" onClick={() => setShowPool((v) => !v)}>
                <Lightbulb size={16} /> Aus Ideen ({pool.length})
              </button>
              <Link className="btn" to={`/assistent?tag=${day.id}`}>
                ✨ KI fragen
              </Link>
            </div>
          )}
          {showPool && (
            <div className="results">
              {pool.map((s) => (
                <button key={s.id} className="result" onClick={() => addFromPool(s)}>
                  <strong>
                    {KIND_ICON[s.kind]} {s.name}
                  </strong>
                  <span className="muted small">{s.notes}</span>
                </button>
              ))}
            </div>
          )}

          <h3>Notizen</h3>
          <EditableText
            value={day.notes}
            placeholder="Notizen zum Tag …"
            multiline
            className="notes"
            disabled={!canEdit}
            onSave={(notes) => updateDay({ notes })}
          />

          {dayExpenses.length > 0 && (
            <>
              <h3>Ausgaben</h3>
              {dayExpenses.map((e) => (
                <div key={e.id} className="small expense-mini">
                  <span className="grow">{e.title}</span>
                  <strong>{e.amount != null ? `${e.amount} ${e.currency}` : '–'}</strong>
                  <span className="muted">{e.paidBy || 'offen'}</span>
                </div>
              ))}
              <Link to="/ausgaben" className="link small">
                Alle Ausgaben →
              </Link>
            </>
          )}

          <h3>Kommentare</h3>
          <Comments targetId={day.id} />
        </div>
      </div>

      {edit && (
        <StopEditor
          stop={edit.stop}
          isNew={edit.isNew}
          bias={bias}
          onSave={(s) => saveStop(s, edit.isNew)}
          onDelete={
            edit.isNew
              ? undefined
              : () => {
                  if (confirm(`"${edit.stop.name}" löschen? (über die Historie wiederherstellbar)`)) {
                    apply([{ op: 'delete', type: 'stop', id: edit.stop.id }], `Stopp gelöscht: ${edit.stop.name}`);
                    setEdit(null);
                  }
                }
          }
          onClose={() => setEdit(null)}
        />
      )}
      {history && <HistoryPanel entityId={history === 'day' ? undefined : history} dayId={day.id} onClose={() => setHistory(null)} />}
    </div>
  );
}

function StopRow(p: {
  stop: Stop;
  index: number;
  active: boolean;
  region: string;
  prev?: Stop;
  leg?: { distanceMeters: number; durationSec: number };
  canEdit: boolean;
  onUp: () => void;
  onDown: () => void;
  onEdit: () => void;
  onHistory: () => void;
  onSelect: () => void;
}) {
  const { stop: s } = p;
  const nav = routeLink([s], p.region, true);
  return (
    <>
      {p.leg && p.leg.distanceMeters > 0 && (
        <div className="leg small muted">
          ↓ {fmtKm(p.leg.distanceMeters)} · {fmtDuration(p.leg.durationSec)}
        </div>
      )}
      <div className={`stop${p.active ? ' active' : ''}`} onClick={p.onSelect}>
        <span className="stop-icon" style={{ background: KIND_COLOR[s.kind] }}>
          {KIND_ICON[s.kind]}
        </span>
        <div className="grow">
          <div className="stop-title">
            {s.time && <span className="accent small">{s.time} </span>}
            <strong>{s.name}</strong>
          </div>
          <div className="small muted">
            {KIND_LABEL[s.kind]}
            {s.scope === 'main' ? ' · Hauptroute' : ''}
            {s.duration && ` · ${s.duration}`}
            {s.camp?.type && ` · ${CAMP_LABEL[s.camp.type]}`}
            {s.camp?.powered && ' · ⚡'}
            {s.camp?.shower && ' · 🚿'}
            {s.lat == null && ' · ohne Koordinaten'}
          </div>
          {s.booking && <span className={`badge ${s.booking === 'gebucht' ? 'green' : 'orange'}`}>{s.booking === 'gebucht' ? 'Gebucht' : 'Noch buchen'}</span>}
          {s.notes && <p className="small pre">{s.notes}</p>}
          {s.links.map((l) => (
            <a key={l} className="link small ellipsis" href={l} target="_blank" rel="noreferrer">
              <ExternalLink size={12} /> {new URL(l).hostname.replace('www.', '')}
            </a>
          ))}
          <Comments targetId={s.id} compact />
        </div>
        <div className="stop-actions" onClick={(e) => e.stopPropagation()}>
          {nav && (
            <a className="icon-btn nav" href={nav} target="_blank" rel="noreferrer" title="Navigation starten">
              <Navigation size={18} />
            </a>
          )}
          <a className="icon-btn" href={placeLink(s, p.region)} target="_blank" rel="noreferrer" title="In Google Maps öffnen">
            <ExternalLink size={16} />
          </a>
          {p.canEdit && (
            <>
              <button className="icon-btn" onClick={p.onEdit} title="Bearbeiten">
                <Pencil size={16} />
              </button>
              <button className="icon-btn" onClick={p.onUp} title="Nach oben">
                <ChevronUp size={16} />
              </button>
              <button className="icon-btn" onClick={p.onDown} title="Nach unten">
                <ChevronDown size={16} />
              </button>
            </>
          )}
          <button className="icon-btn" onClick={p.onHistory} title="Versionen">
            <History size={16} />
          </button>
        </div>
      </div>
    </>
  );
}

/** Duschen getrennt vom Campen: eigener Status pro Tag. */
function ShowerBox({ day, canEdit, onSave }: { day: Day; canEdit: boolean; onSave: (s: Day['shower']) => void }) {
  return (
    <div className={`shower-box shower-${day.shower.status}`}>
      <ShowerHead size={18} />
      <div className="grow">
        {canEdit ? (
          <div className="seg small">
            {(['ja', 'nein', 'unklar'] as ShowerStatus[]).map((st) => (
              <button key={st} className={day.shower.status === st ? 'sel' : ''} onClick={() => onSave({ ...day.shower, status: st })}>
                {SHOWER_LABEL[st]}
              </button>
            ))}
          </div>
        ) : (
          <strong className="small">{SHOWER_LABEL[day.shower.status]}</strong>
        )}
        <EditableText
          value={day.shower.note}
          placeholder="Wo duschen? (z. B. Campingplatz Tutukaka)"
          className="small"
          disabled={!canEdit}
          onSave={(note) => onSave({ ...day.shower, note })}
        />
      </div>
    </div>
  );
}

export function EditableText(p: {
  value: string;
  placeholder: string;
  className?: string;
  multiline?: boolean;
  disabled?: boolean;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(p.value);
  useEffect(() => setV(p.value), [p.value]);
  if (!editing || p.disabled) {
    return (
      <div
        className={`editable ${p.className ?? ''}${p.disabled ? '' : ' can'}${p.multiline ? ' pre' : ''}`}
        onClick={() => !p.disabled && setEditing(true)}
      >
        {p.value || <span className="muted">{p.disabled ? '' : p.placeholder}</span>}
      </div>
    );
  }
  const done = () => {
    setEditing(false);
    if (v !== p.value) p.onSave(v);
  };
  return p.multiline ? (
    <textarea autoFocus rows={Math.max(4, v.split('\n').length + 1)} value={v} onChange={(e) => setV(e.target.value)} onBlur={done} />
  ) : (
    <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={done} onKeyDown={(e) => e.key === 'Enter' && done()} />
  );
}
