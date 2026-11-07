import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Navigation, ShowerHead, Tent } from 'lucide-react';
import type { Day, Stop } from '@neugier/shared';
import { dayCamp, fmtDate, hasCoords, KIND_COLOR, mainRoute, routeLink, sortedDays, todayIso } from '@neugier/shared';
import { MapView, type MapMarker } from '../components/MapView';
import { findToday, useRoute } from '../hooks';
import { useTrip } from '../store';

/** Gesamtreise: Karte mit Übernachtungszielen + horizontale Tageskarten. Nur Hauptroute. */
export function Overview() {
  const { state, presence } = useTrip();
  const navigate = useNavigate();
  const days = useMemo(() => sortedDays(state.days), [state.days]);
  const today = findToday(days);
  const [active, setActive] = useState<string | null>(today?.id ?? null);
  const listRef = useRef<HTMLDivElement>(null);

  const route = useMemo(() => mainRoute(state).map((r) => r.stop), [state]);
  const routed = useRoute(route.filter(hasCoords), state.trip.region);

  const markers: MapMarker[] = useMemo(() => {
    const out: MapMarker[] = [];
    days.forEach((d, i) => {
      const camp = dayCamp(state.stops, d.id);
      if (camp && hasCoords(camp)) {
        out.push({
          id: d.id,
          lat: camp.lat,
          lng: camp.lng,
          label: String(i + 1),
          color: d.id === active ? '#1d4ed8' : KIND_COLOR.campsite,
          title: `${fmtDate(d.date)} · ${camp.name}`,
          active: d.id === active,
        });
      }
    });
    return out;
  }, [days, state.stops, active]);

  const activeMarker = markers.find((m) => m.id === active);

  useEffect(() => {
    if (!active) return;
    listRef.current?.querySelector(`[data-day="${active}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [active]);

  const fullLink = routeLink(route, state.trip.region);

  return (
    <div className="split">
      <MapView
        markers={markers}
        paths={routed ? [{ id: 'main', path: routed.path, color: '#2f7d4f', dashed: routed.fallback, weight: 4 }] : []}
        fitKey={`overview-${markers.length}`}
        focus={activeMarker ?? null}
        onMarkerClick={setActive}
      >
        <div className="map-actions">
          {today && (
            <button className="chip" onClick={() => navigate(`/tag/${today.id}`)}>
              <Navigation size={16} /> Heute
            </button>
          )}
          {fullLink && (
            <a className="chip" href={fullLink} target="_blank" rel="noreferrer">
              <ExternalLink size={16} /> Route in Google Maps
            </a>
          )}
        </div>
      </MapView>
      <div className="panel">
        <div className="panel-head">
          <h2>Reiseverlauf</h2>
          <span className="muted small">
            {days.length} Tage · {fmtDate(state.trip.startDate, false)} – {fmtDate(state.trip.endDate, false)}
          </span>
        </div>
        <div className="day-list" ref={listRef}>
          {days.map((d, i) => (
            <DayCard
              key={d.id}
              day={d}
              index={i}
              camp={dayCamp(state.stops, d.id)}
              stops={state.stops.filter((s) => s.dayId === d.id).length}
              active={d.id === active}
              isToday={d.date === todayIso()}
              viewers={presence.filter((p) => p.dayId === d.id).map((p) => p.name)}
              onSelect={() => setActive(d.id)}
              onOpen={() => navigate(`/tag/${d.id}`)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DayCard(p: {
  day: Day;
  index: number;
  camp?: Stop;
  stops: number;
  active: boolean;
  isToday: boolean;
  viewers: string[];
  onSelect: () => void;
  onOpen: () => void;
}) {
  const { day, camp } = p;
  return (
    <div
      data-day={day.id}
      className={`card day-card${p.active ? ' active' : ''}${p.isToday ? ' today' : ''}`}
      onClick={() => (p.active ? p.onOpen() : p.onSelect())}
    >
      <div className="day-card-head">
        <span className="day-no">Tag {p.index + 1}</span>
        <span className="muted small">{fmtDate(day.date)}</span>
        {p.isToday && <span className="badge blue">Heute</span>}
      </div>
      <h3>{day.title || 'Ohne Titel'}</h3>
      {day.times && <p className="small accent">{day.times}</p>}
      <div className="day-card-meta">
        {camp ? (
          <span className="meta">
            <Tent size={14} /> {camp.name}
          </span>
        ) : (
          <span className="meta muted">
            <Tent size={14} /> kein Übernachtungsziel
          </span>
        )}
        <span className={`meta shower-${day.shower.status}`}>
          <ShowerHead size={14} /> {day.shower.status === 'ja' ? 'Dusche' : day.shower.status === 'nein' ? 'keine Dusche' : '?'}
        </span>
        <span className="meta muted">{p.stops} Stopps</span>
      </div>
      {p.viewers.length > 0 && <p className="small muted">👀 {p.viewers.join(', ')}</p>}
      {p.active && (
        <button className="btn small primary" onClick={(e) => (e.stopPropagation(), p.onOpen())}>
          Tag öffnen
        </button>
      )}
    </div>
  );
}
