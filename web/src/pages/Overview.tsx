import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, ExternalLink, Navigation, Plus, Tent, Trash } from 'lucide-react';
import type { Day, RouteLeg, Stop } from '@neugier/shared';
import {
  dayCamp,
  camperPosition,
  fmtDate,
  fmtHours,
  fmtKm,
  hasCoords,
  insertDayOps,
  isFlightStop,
  KIND_COLOR,
  moveDayOps,
  plannedCamperStop,
  removeDayOps,
  routeLink,
  sortedDays,
  todayIso,
  tripDate,
} from '@neugier/shared';
import { facilityBadges, FacilityIcons } from '../components/Facilities';
import { api } from '../api';
import { MapView, midpoint, type MapLabel, type MapMarker, type MapPath } from '../components/MapView';
import { findToday, legsByDest, useRoute } from '../hooks';
import { useTrip } from '../store';

const PASSED = '#9aa9a0';
const UPCOMING = '#2f7d4f';

type Overnight = { day: Day; index: number; camp: Stop & { lat: number; lng: number } };

/**
 * Gesamtreise: ein Pin pro Tag am Übernachtungsziel (mit Ausstattungs-Icons), Fahrzeit zwischen den Zielen
 * aus Google Maps, Camper-Symbol an der aktuellen Position, zurückliegende Route blasser.
 */
export function Overview() {
  const { state, presence, canPlan, apply, liveSharing, setLiveSharing, geo } = useTrip();
  const navigate = useNavigate();
  const days = useMemo(() => sortedDays(state.days), [state.days]);
  const today = findToday(days);
  const todayIdx = today ? days.indexOf(today) : -1;
  const [active, setActive] = useState<string | null>(today?.id ?? null);
  const [currentTripDate, setCurrentTripDate] = useState(() => tripDate(state.trip));
  const [resolvedCamp, setResolvedCamp] = useState<{ key: string; lat: number; lng: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const refresh = () => setCurrentTripDate(tripDate(state.trip));
    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  }, [state.trip]);

  // Übernachtungsziele in Reihenfolge (Tage ohne Ziel/Koordinaten werden übersprungen)
  const overnights: Overnight[] = useMemo(
    () =>
      days.flatMap((day, index) => {
        const camp = dayCamp(state.stops, day.id);
        return camp && hasCoords(camp) ? [{ day, index, camp }] : [];
      }),
    [days, state.stops],
  );
  const routePts = useMemo(() => overnights.map((overnight, index) => {
    const previous = overnights[index - 1];
    const routeBreakBefore = !!previous && days.slice(previous.index + 1, overnight.index + 1)
      .some((day) => state.stops.some((stop) => stop.dayId === day.id && isFlightStop(stop)));
    return { ...overnight.camp, id: overnight.day.id, routeBreakBefore };
  }), [overnights, days, state.stops]);
  const route = useRoute(routePts, state.trip.region);
  const legByDay = useMemo(() => legsByDest(routePts, route), [routePts, route]);

  const planned = useMemo(() => plannedCamperStop(state, currentTripDate), [state, currentTripDate]);
  const position = useMemo(() => camperPosition(state, currentTripDate), [state, currentTripDate]);
  const locationKey = planned ? JSON.stringify([state.trip.id, planned.id, planned.address, planned.name, state.trip.region]) : '';
  useEffect(() => {
    if (position || !planned || hasCoords(planned)) return;
    let active = true;
    const query = [planned.address || planned.name, state.trip.region].filter(Boolean).join(', ');
    api<{ lat: number; lng: number }[]>(`/maps/search?${new URLSearchParams({ q: query })}`)
      .then(([place]) => { if (active && place) setResolvedCamp({ key: locationKey, lat: place.lat, lng: place.lng }); })
      .catch(() => {});
    return () => { active = false; };
  }, [position, planned, locationKey, state.trip.region]);
  const camper = position ?? (planned && resolvedCamp?.key === locationKey
    ? { lat: resolvedCamp.lat, lng: resolvedCamp.lng, title: `Geplant: ${planned.name}`, live: false }
    : null);

  const paths: MapPath[] = useMemo(() => {
    const t = todayIso();
    return overnights.slice(1).flatMap((o, k) => {
      if (routePts[k + 1].routeBreakBefore) return [];
      const prev = overnights[k];
      const leg = legByDay.get(o.day.id);
      const passed = o.day.date < t;
      const straight = !leg || !leg.durationSec;
      return [{
        id: o.day.id,
        path: leg?.path?.length ? leg.path : [prev.camp, o.camp],
        color: passed ? PASSED : UPCOMING,
        opacity: passed ? 0.7 : 0.95,
        dashed: straight,
        weight: passed ? 3 : 4,
      }];
    });
  }, [overnights, routePts, legByDay]);

  const labels: MapLabel[] = useMemo(
    () =>
      overnights.flatMap((o) => {
        const leg = legByDay.get(o.day.id);
        const at = leg?.path?.length ? midpoint(leg.path) : null;
        return leg?.durationSec && at ? [{ id: o.day.id, at, text: fmtHours(leg.durationSec) }] : [];
      }),
    [overnights, legByDay],
  );

  const markers: MapMarker[] = useMemo(() => {
    const t = todayIso();
    return overnights.map((o) => ({
      id: o.day.id,
      lat: o.camp.lat,
      lng: o.camp.lng,
      label: String(o.index + 1),
      color: o.day.id === active ? '#1d4ed8' : o.day.date < t ? PASSED : KIND_COLOR.campsite,
      title: `${fmtDate(o.day.date)} · ${o.camp.name}`,
      active: o.day.id === active,
      muted: o.day.date < t && o.day.id !== active,
      badges: facilityBadges(o.day),
    }));
  }, [overnights, active]);

  const activeMarker = markers.find((m) => m.id === active);

  useEffect(() => {
    if (!active) return;
    listRef.current?.querySelector(`[data-day="${active}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [active]);

  const segments = routePts.reduce<(typeof routePts)[]>((groups, point) => {
    if (!groups.length || point.routeBreakBefore) groups.push([]);
    groups[groups.length - 1].push(point);
    return groups;
  }, []);
  const fullLink = routeLink(segments.sort((first, second) => second.length - first.length)[0] ?? [], state.trip.region);
  const totalSec = route?.legs.reduce((a, l) => a + l.durationSec, 0) ?? 0;
  const totalM = route?.legs.reduce((a, l) => a + l.distanceMeters, 0) ?? 0;
  const open = (d: Day) => canPlan && navigate(`/tag/${d.id}`);

  return (
    <div className="split">
      <MapView
        markers={markers}
        paths={paths}
        labels={labels}
        camper={camper}
        fitKey={`overview-${markers.length}`}
        fullscreenControl
        scaleMarkers
        focus={activeMarker ?? null}
        onMarkerClick={setActive}
      >
        <div className="map-actions">
          {canPlan && today && (
            <button className="chip" onClick={() => navigate(`/tag/${today.id}`)}>
              <Navigation size={16} /> Heute
            </button>
          )}
          {canPlan && <button className={`chip${liveSharing ? ' primary' : ''}`} onClick={() => setLiveSharing(!liveSharing)} title="GPS-Standort mit der Reise teilen">
            🚐 {liveSharing ? (geo.error ? 'GPS-Fehler' : geo.pos ? 'Live' : 'Suche GPS …') : 'Live-Standort'}
          </button>}
          {fullLink && (
            <a className="chip" href={fullLink} target="_blank" rel="noreferrer">
              <ExternalLink size={16} /> Google Maps
            </a>
          )}
        </div>
      </MapView>
      <div className="panel">
        <div className="panel-head">
          <h2>Reiseverlauf</h2>
          <span className="muted small">
            {days.length} Tage{totalSec > 0 && ` · ${fmtHours(totalSec)} Fahrt · ${fmtKm(totalM)}`}
          </span>
        </div>
        <div className="day-list" ref={listRef}>
          {days.map((d, i) => (
            <DayCard
              key={d.id}
              day={d}
              index={i}
              camp={dayCamp(state.stops, d.id)}
              leg={legByDay.get(d.id)}
              stops={state.stops.filter((s) => s.dayId === d.id).length}
              active={d.id === active}
              passed={i < todayIdx}
              isToday={d.date === todayIso()}
              viewers={presence.filter((p) => p.dayId === d.id).map((p) => p.name)}
              canPlan={canPlan}
              onSelect={() => setActive(d.id)}
              onOpen={() => open(d)}
              onInsert={() => {
                const { ops, day } = insertDayOps(state, d.id);
                apply(ops, 'Tag eingefügt').then(() => setActive(day.id));
              }}
              onMove={(dir) => apply(moveDayOps(state, d.id, dir), `Tag verschoben: ${d.title}`)}
              onDelete={() =>
                confirm(`Tag „${d.title}“ löschen? Stopps landen im Ideen-Pool, spätere Tage rücken nach vorne.`) &&
                apply(removeDayOps(state, d.id), `Tag gelöscht: ${d.title}`)
              }
            />
          ))}
          {canPlan && (
            <button className="btn add-day" onClick={() => apply(insertDayOps(state, days[days.length - 1]?.id ?? null).ops, 'Tag angehängt')}>
              <Plus size={16} /> Tag anhängen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DayCard(p: {
  day: Day;
  index: number;
  camp?: Stop;
  leg?: RouteLeg;
  stops: number;
  active: boolean;
  passed: boolean;
  isToday: boolean;
  viewers: string[];
  canPlan: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onInsert: () => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const { day, camp, leg } = p;
  return (
    <div
      data-day={day.id}
      className={`card day-card${p.active ? ' active' : ''}${p.isToday ? ' today' : ''}${p.passed ? ' passed' : ''}`}
      onClick={() => (p.active ? p.onOpen() : p.onSelect())}
    >
      {day.cover && <img className="day-card-cover" src={day.cover} alt="" loading="lazy" />}
      <div className="day-card-head">
        <span className="day-no">Tag {p.index + 1}</span>
        <span className="muted small">{fmtDate(day.date)}</span>
        {p.isToday && <span className="badge blue">Heute</span>}
        <span className="grow" />
        {leg && leg.durationSec > 0 && (
          <span className="badge drive" title={`${fmtKm(leg.distanceMeters)} laut Google Maps`}>
            🚐 {fmtHours(leg.durationSec)}
          </span>
        )}
      </div>
      <h3>{day.title || 'Ohne Titel'}</h3>
      {day.times && <p className="small accent">{day.times}</p>}
      <div className="day-card-meta">
        <span className={`meta${camp ? '' : ' muted'}`}>
          <Tent size={14} /> {camp ? camp.name : 'kein Übernachtungsziel'}
        </span>
        <FacilityIcons day={day} />
        {p.canPlan && <span className="meta muted">{p.stops} Stopps</span>}
      </div>
      {p.viewers.length > 0 && <p className="small muted">👀 {p.viewers.join(', ')}</p>}
      {p.active && p.canPlan && (
        <div className="row day-card-actions" onClick={(e) => e.stopPropagation()}>
          <button className="btn small primary" onClick={p.onOpen}>
            Tag öffnen
          </button>
          <span className="grow" />
          <button className="icon-btn" title="Früher" onClick={() => p.onMove(-1)}>
            <ChevronUp size={16} />
          </button>
          <button className="icon-btn" title="Später" onClick={() => p.onMove(1)}>
            <ChevronDown size={16} />
          </button>
          <button className="icon-btn" title="Tag danach einfügen" onClick={p.onInsert}>
            <Plus size={16} />
          </button>
          <button className="icon-btn" title="Tag löschen" onClick={p.onDelete}>
            <Trash size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
