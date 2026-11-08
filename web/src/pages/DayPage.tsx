import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ExternalLink, FlaskConical, History, Lightbulb, Navigation, Plus } from 'lucide-react';
import type { Day, Stop } from '@neugier/shared';
import { dayCamp, dayStops, daysUntilNextShower, fmtDate, fmtHours, fmtKm, hasCoords, isFlightStop, KIND_ICON, moveStopOps, newId, routeLink, sortedDays, supermarketLink, todayIso } from '@neugier/shared';
import { Comments } from '../components/Comments';
import { CoverImage } from '../components/CoverImage';
import { DayExpenses } from '../components/DayExpenses';
import { useDayMap } from '../components/DayMap';
import { EditableText } from '../components/EditableText';
import { FacilityToggles } from '../components/Facilities';
import { HistoryPanel } from '../components/HistoryPanel';
import { MapView } from '../components/MapView';
import { EditableRichText } from '../components/RichText';
import { StopEditor } from '../components/StopEditor';
import { StopList } from '../components/StopList';
import { TodoButton } from '../components/TodoButton';
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
  const [extraMinutes, setExtraMinutes] = useState('0');

  useEffect(() => {
    setFocusDay(dayId ?? null);
    return () => setFocusDay(null);
  }, [dayId, setFocusDay]);

  useEffect(() => { setExtraMinutes(String(day?.extraTravel?.minutes ?? 0)); }, [day?.id, day?.extraTravel?.minutes]);

  const dm = useDayMap(state, day, active, canEdit);

  if (!day) return <div className="center muted">Tag nicht gefunden</div>;

  const flightDay = dm.stops.some(isFlightStop);
  const navigable = flightDay ? dm.stops.filter((stop) => stop.kind !== 'transport' || /fähre|ferry/i.test(stop.name)) : dm.stops;
  const navAll = routeLink(flightDay ? navigable : dm.routePts.length ? dm.routePts : navigable, state.trip.region);
  const navFromHere = routeLink(navigable, state.trip.region, true);
  const daysToShower = daysUntilNextShower(state.days, state.stops, day.date);
  const camp = dayCamp(state.stops, day.id);
  const shoppingLocation = camp && hasCoords(camp) ? camp : [...dayStops(state.stops, day.id)].reverse().find(hasCoords) ?? camp ?? day.title;
  const updateDay = (patch: Partial<Day>, label = 'Tag bearbeitet') => apply([{ op: 'update', type: 'day', id: day.id, patch }], label);

  const saveStop = (s: Stop, isNew: boolean) => {
    apply([isNew ? { op: 'create', type: 'stop', data: s } : { op: 'put', type: 'stop', data: s }], `${isNew ? 'Stopp hinzugefügt' : 'Stopp bearbeitet'}: ${s.name}`);
    setEdit(null);
  };

  const deleteStop = (s: Stop) => {
    if (confirm(`„${s.name}“ löschen? (über die Historie wiederherstellbar)`)) {
      apply([{ op: 'delete', type: 'stop', id: s.id }], `Stopp gelöscht: ${s.name}`);
      setEdit(null);
    }
  };

  // Marker auf der Karte ziehen = neuer Ort (Adresse wird beim nächsten Speichern aktualisiert)
  const dragStop = (id: string, p: { lat: number; lng: number }) => {
    const s = state.stops.find((x) => x.id === id);
    if (!s) return;
    apply([{ op: 'update', type: 'stop', id, patch: { lat: p.lat, lng: p.lng, placeId: undefined, address: `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`, geoFailed: false } }], `Ort verschoben: ${s.name}`);
  };

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

  const bias = dm.routePts[0];
  const pool = state.stops.filter((s) => !s.dayId);
  const openTodos = (state.todos ?? []).filter((todo) => !todo.done);
  const todoStopIds = new Set(openTodos.flatMap((todo) => todo.targetType === 'stop' && todo.targetId ? [todo.targetId] : todo.targetType === 'comment' ? [state.comments.find((comment) => comment.id === todo.targetId)?.targetId ?? ''] : []));

  return (
    <div className="split">
      <MapView
        markers={dm.markers}
        paths={dm.paths}
        labels={dm.labels}
        fitKey={`day-${day.id}-${dm.markers.length}`}
        onMarkerClick={(id) => setActive(id)}
        onMarkerDrag={canEdit ? dragStop : undefined}
      >
        <div className="map-actions">
          {navAll && (
            <a className="chip primary" href={navAll} target="_blank" rel="noreferrer">
              <Navigation size={16} /> Tagesroute
            </a>
          )}
          {navFromHere && dm.stops.length > 0 && (
            <a className="chip" href={navFromHere} target="_blank" rel="noreferrer">
              <Navigation size={16} /> Ab hier
            </a>
          )}
          {canEdit && (
            <Link className="chip" to={`/spielplatz?tag=${day.id}`}>
              <FlaskConical size={16} /> Ausprobieren
            </Link>
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
            <EditableText value={day.title} placeholder="Titel" className="day-title" disabled={!canEdit} onSave={(title) => updateDay({ title })} />
          </div>
          <button className="icon-btn" disabled={idx >= days.length - 1} onClick={() => navigate(`/tag/${days[idx + 1].id}`)}>
            <ChevronRight size={22} />
          </button>
        </div>

        <div className="panel-scroll">
          <CoverImage day={day} />

          {(day.times || canEdit) && (
            <EditableText value={day.times} placeholder="Feste Termine (z. B. Fähre 08:45)" className="times accent small" disabled={!canEdit} onSave={(times) => updateDay({ times })} />
          )}

          {dm.totalSec > 0 && (
            <p className="small muted">
              🚐 {fmtHours(dm.totalSec)} Fahrzeit · {fmtKm(dm.totalM)} <span className="muted">(Google Maps)</span>
              {(day.extraTravel?.minutes ?? 0) > 0 && ` + ${day.extraTravel!.minutes} Min. = ${fmtHours(dm.totalSec + day.extraTravel!.minutes * 60)}`}
            </p>
          )}
          {dm.loading && <p className="small muted">Fahrzeiten werden berechnet …</p>}
          {dm.unavailable && <p className="small muted">Einige Fahrzeiten sind derzeit nicht verfügbar.</p>}
          <div className="extra-travel">
            <label>Zusätzliche Fahrzeit (Minuten)<input type="number" min="0" max="1440" step="5" disabled={!canEdit} value={extraMinutes} onChange={(event) => setExtraMinutes(event.target.value)} onBlur={() => {
              const parsed = Number(extraMinutes);
              const minutes = Number.isFinite(parsed) ? Math.min(1440, Math.max(0, Math.round(parsed))) : 0;
              setExtraMinutes(String(minutes));
              if (minutes !== (day.extraTravel?.minutes ?? 0)) updateDay({ extraTravel: { minutes, note: day.extraTravel?.note ?? '' } }, 'Zusätzliche Fahrzeit geändert');
            }} /></label>
            <label>Grund<EditableText value={day.extraTravel?.note ?? ''} placeholder="z. B. Fähre oder Tunnel" disabled={!canEdit} onSave={(note) => updateDay({ extraTravel: { minutes: day.extraTravel?.minutes ?? 0, note } }, 'Fahrzeitgrund geändert')} /></label>
            {day.extraTravel?.source && <a className="small" href={day.extraTravel.source} target="_blank" rel="noreferrer">Quelle prüfen</a>}
          </div>

          <h3>Ausstattung</h3>
          <FacilityToggles day={day} disabled={!canEdit} onChange={(patch) => updateDay(patch, 'Ausstattung geändert')} />
          <p className="small muted">Tage bis zur nächsten Dusche: {daysToShower === null ? 'keine geplant' : daysToShower === 0 ? 'heute' : daysToShower}</p>
          <EditableText
            value={day.shower.note}
            placeholder="Wo duschen? (z. B. Campingplatz Tutukaka)"
            className="small"
            disabled={!canEdit}
            onSave={(note) => updateDay({ shower: { ...day.shower, note } }, 'Dusche geplant')}
          />
          {canEdit && openTodos.some((todo) => todo.dayId === day.id) && <div className="day-todos"><strong>Offene Todos</strong>{openTodos.filter((todo) => todo.dayId === day.id).map((todo) => <label key={todo.id} className="row"><input type="checkbox" checked={false} onChange={() => void apply([{ op: 'update', type: 'todo', id: todo.id, patch: { done: true } }], 'Todo erledigt')} />{todo.title}</label>)}</div>}

          <div className="section-head">
            <h3>Stopps</h3>
            {canEdit && <TodoButton dayId={day.id} targetId={day.id} targetType="day" initialTitle={day.title} />}
            <button className="icon-btn" title="Historie dieses Tages" onClick={() => setHistory('day')}>
              <History size={18} />
            </button>
          </div>

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
            region={state.trip.region}
            legs={dm.legs}
            activeId={active}
            canEdit={canEdit}
            todoDayId={day.id}
            todoStopIds={todoStopIds}
            onReorder={(id, to) => apply(moveStopOps(state.stops, id, day.id, to), 'Reihenfolge geändert')}
            onEdit={(s) => setEdit({ stop: s, isNew: false })}
            onDelete={deleteStop}
            onSelect={(s) => setActive(s.id)}
            onHistory={(s) => setHistory(s.id)}
            extra={(s) => <Comments targetId={s.id} compact />}
          />
          {dm.stops.length === 0 && <p className="muted small">Noch keine Stopps geplant.</p>}
          {canEdit && dm.stops.length > 1 && <p className="small muted">Tipp: Stopps am Griff ⋮⋮ ziehen, Pins auf der Karte verschieben.</p>}

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
              {pool.length === 0 && <p className="muted small pad">Ideen-Pool ist leer (Mehr → Ideen).</p>}
              {pool.map((s) => (
                <button
                  key={s.id}
                  className="result"
                  onClick={() => {
                    apply(moveStopOps(state.stops, s.id, day.id, dm.stops.length), `Aus Ideen eingeplant: ${s.name}`);
                    setShowPool(false);
                  }}
                >
                  <strong>
                    {KIND_ICON[s.kind]} {s.name}
                  </strong>
                  <span className="muted small">{s.notes.slice(0, 120)}</span>
                </button>
              ))}
            </div>
          )}

          <section className="shopping-section">
            <h3>Einkaufsmöglichkeiten</h3>
            <a className="btn" href={supermarketLink(shoppingLocation, state.trip.region)} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Supermärkte in Google Maps</a>
          </section>

          <h3>Notizen</h3>
          <EditableRichText value={day.notes} placeholder="Notizen zum Tag …" className="notes" disabled={!canEdit} onSave={(notes) => updateDay({ notes })} />

          <h3>Ausgaben</h3>
          <DayExpenses dayId={day.id} />

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
          onDelete={edit.isNew ? undefined : () => deleteStop(edit.stop)}
          onClose={() => setEdit(null)}
        />
      )}
      {history && <HistoryPanel entityId={history === 'day' ? undefined : history} dayId={day.id} onClose={() => setHistory(null)} />}
    </div>
  );
}
